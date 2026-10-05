import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { DesktopTunnel } from "@rakazo/contracts";

export type TunnelPhase =
  | "starting"
  | "signing-in"
  | "connected"
  | "reconnecting"
  | "failed"
  | "stopped";

export interface TunnelState {
  phase: TunnelPhase;
  /** Why the tunnel failed: the command's last line of output, when it printed one. */
  message?: string;
}

/** A running command. `stop` ends it with everything it started. */
export interface TunnelProcess {
  exited: Promise<void>;
  stop: () => void;
}

export interface TunnelDeps {
  tunnel: DesktopTunnel;
  /** True when the server answers through the tunnel. */
  healthy: () => Promise<boolean>;
  onState: (state: TunnelState) => void;
  run?: (command: string, onLine: (line: string) => void) => TunnelProcess;
  wait?: (ms: number) => Promise<void>;
}

const CONNECT_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;
const MONITOR_INTERVAL_MS = 15_000;
/** A connected tunnel counts as dropped after this many failed checks in a row. */
const MONITOR_MISSES = 2;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** A first connection tries twice: once as configured, once after signing in. */
const CONNECT_DELAYS_MS = [0, 0] as const;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;
const STOPPED_MESSAGE = "The tunnel was stopped.";
const NO_OUTPUT_MESSAGE = "The connection command stopped before the server answered.";

/**
 * Runs a user-configured tunnel command (an SSH or cloud port-forward, for example) and keeps
 * it up: it starts the command, waits until the server answers through it, restarts it with
 * backoff when it stops or the server stops answering, and runs the optional sign-in command
 * once per attempt series when the tunnel cannot connect.
 */
export class TunnelSupervisor {
  private readonly stopped = new AbortController();
  private process: TunnelProcess | null = null;
  private lastLine = "";
  private current: TunnelState = { phase: "starting" };
  /** Ends the wait before the next reconnect attempt, while there is one. */
  private retryNow: (() => void) | null = null;

  constructor(private readonly deps: TunnelDeps) {}

  get tunnel(): DesktopTunnel {
    return this.deps.tunnel;
  }

  state(): TunnelState {
    return this.current;
  }

  /** Resolves with null once the server answers through the tunnel, or with why it could not. */
  async connect(): Promise<string | null> {
    const error = await this.establish("starting", CONNECT_DELAYS_MS);
    if (error === null) void this.supervise();
    return error;
  }

  /**
   * Ends the current command; supervision then reconnects as after any drop. While it is
   * already waiting to reconnect, it tries again right away instead.
   */
  restart(): void {
    this.process?.stop();
    this.retryNow?.();
  }

  stop(): void {
    this.stopped.abort();
    this.process?.stop();
    this.process = null;
    this.setState({ phase: "stopped" });
  }

  private get isStopped() {
    return this.stopped.signal.aborted;
  }

  private setState(state: TunnelState) {
    this.current = state;
    this.deps.onState(state);
  }

  private wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return (this.deps.wait ?? defaultWait)(ms);
  }

  private backoff(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.retryNow = resolve;
      void this.wait(ms).then(resolve);
    }).finally(() => {
      this.retryNow = null;
    });
  }

  private run(command: string): TunnelProcess {
    return (this.deps.run ?? runShellCommand)(command, (line) => {
      if (line.trim() !== "") this.lastLine = line.trim();
    });
  }

  private async supervise(): Promise<void> {
    while (!this.isStopped) {
      await this.untilDropped();
      if (this.isStopped) return;
      const error = await this.establish("reconnecting", RECONNECT_DELAYS_MS);
      if (error !== null) return;
    }
  }

  /** Tries until the server answers, signing in once after the first failed attempt. */
  private async establish(
    phase: "starting" | "reconnecting",
    delays: readonly number[],
  ): Promise<string | null> {
    let signedIn = false;
    for (const delay of delays) {
      this.setState({ phase });
      await this.backoff(delay);
      if (this.isStopped) return STOPPED_MESSAGE;
      if (await this.attempt()) {
        this.setState({ phase: "connected" });
        return null;
      }
      const { signInCommand } = this.deps.tunnel;
      if (signInCommand !== undefined && !signedIn && !this.isStopped) {
        signedIn = true;
        this.setState({ phase: "signing-in" });
        await this.signIn(signInCommand);
      }
    }
    if (this.isStopped) return STOPPED_MESSAGE;
    const message = this.lastLine || NO_OUTPUT_MESSAGE;
    this.setState({ phase: "failed", message });
    return message;
  }

  /** Starts the command and keeps it when the server answers before it exits or times out. */
  private async attempt(): Promise<boolean> {
    this.lastLine = "";
    const running = this.run(this.deps.tunnel.command);
    this.process = running;
    let exited = false;
    void running.exited.then(() => {
      exited = true;
    });
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    while (!exited && !this.isStopped && Date.now() < deadline) {
      if (await this.deps.healthy()) return !exited && !this.isStopped;
      await Promise.race([this.wait(HEALTH_POLL_MS), running.exited]);
    }
    running.stop();
    return false;
  }

  private async signIn(command: string): Promise<void> {
    const running = this.run(command);
    await Promise.race([running.exited, this.wait(SIGN_IN_TIMEOUT_MS)]);
    running.stop();
  }

  /** Resolves when the command exits or the server stops answering through it. */
  private async untilDropped(): Promise<void> {
    const running = this.process;
    if (running === null) return;
    let exited = false;
    void running.exited.then(() => {
      exited = true;
    });
    let misses = 0;
    while (!exited && !this.isStopped && misses < MONITOR_MISSES) {
      await Promise.race([this.wait(MONITOR_INTERVAL_MS), running.exited]);
      if (exited || this.isStopped) break;
      misses = (await this.deps.healthy()) ? 0 : misses + 1;
    }
    running.stop();
  }
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a command the way the user's terminal would: through their login shell, so tools and
 * profiles set up there (an AWS CLI on a Homebrew PATH, say) are found from a desktop app too.
 */
export function runShellCommand(command: string, onLine: (line: string) => void): TunnelProcess {
  const windows = process.platform === "win32";
  const child = windows
    ? spawn(command, { shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(process.env.SHELL || "/bin/sh", ["-lc", command], {
        // Its own process group, so stopping it also ends what the command started.
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
  for (const stream of [child.stdout, child.stderr]) {
    if (stream !== null) createInterface({ input: stream }).on("line", onLine);
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", (error) => {
      onLine(error.message);
      resolve();
    });
  });
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
    try {
      if (windows) child.kill();
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  };
  return { exited, stop };
}
