import { afterEach, describe, expect, it, vi } from "vitest";
import { type TunnelProcess, type TunnelState, TunnelSupervisor } from "./tunnel.js";

const COMMAND = "aws ssm start-session --target i-0123456789abcdef0";
const SIGN_IN = "aws sso login --profile tools";

class FakeProcess implements TunnelProcess {
  readonly exited: Promise<void>;
  stopped = false;
  private resolveExit = () => {};

  constructor(readonly command: string) {
    this.exited = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  exit() {
    this.resolveExit();
  }

  stop = () => {
    this.stopped = true;
    this.exit();
  };
}

function harness(options: {
  signInCommand?: string;
  /** Called for every started command; print lines or end it here. */
  onRun?: (process: FakeProcess, print: (line: string) => void) => void;
  wait?: (ms: number) => Promise<void>;
}) {
  const runs: FakeProcess[] = [];
  const states: TunnelState[] = [];
  const health = { ok: false };
  const supervisor = new TunnelSupervisor({
    tunnel: { command: COMMAND, signInCommand: options.signInCommand },
    healthy: async () => health.ok,
    onState: (state) => states.push(state),
    run: (command, onLine) => {
      const process = new FakeProcess(command);
      runs.push(process);
      options.onRun?.(process, onLine);
      return process;
    },
    // Yield to the event loop so a healthy tunnel's monitor loop cannot spin forever.
    wait: options.wait ?? (() => new Promise((resolve) => setImmediate(resolve))),
  });
  return { supervisor, runs, states, health };
}

let active: TunnelSupervisor | null = null;
afterEach(() => {
  active?.stop();
  active = null;
});

describe("TunnelSupervisor", () => {
  it("connects once the server answers through the started command", async () => {
    const { supervisor, runs, health } = harness({});
    active = supervisor;
    health.ok = true;

    await expect(supervisor.connect()).resolves.toBeNull();

    expect(runs.map((run) => run.command)).toEqual([COMMAND]);
    expect(supervisor.state()).toEqual({ phase: "connected" });
  });

  it("reports the command's last output when it cannot connect", async () => {
    const { supervisor, runs } = harness({
      onRun: (process, print) => {
        print("An error occurred (ExpiredTokenException)");
        print("");
        process.exit();
      },
    });
    active = supervisor;

    const error = await supervisor.connect();

    expect(error).toBe("An error occurred (ExpiredTokenException)");
    expect(runs).toHaveLength(2);
    expect(supervisor.state()).toEqual({ phase: "failed", message: error });
  });

  it("signs in once after a failed attempt, then connects", async () => {
    const { supervisor, runs, states, health } = harness({
      signInCommand: SIGN_IN,
      onRun: (process) => {
        if (process.command === SIGN_IN) {
          health.ok = true;
          process.exit();
        } else if (!health.ok) {
          process.exit();
        }
      },
    });
    active = supervisor;

    await expect(supervisor.connect()).resolves.toBeNull();

    expect(runs.map((run) => run.command)).toEqual([COMMAND, SIGN_IN, COMMAND]);
    expect(states.map((state) => state.phase)).toContain("signing-in");
  });

  it("reconnects after the command stops", async () => {
    const { supervisor, runs, states, health } = harness({});
    active = supervisor;
    health.ok = true;
    await supervisor.connect();

    runs[0]!.exit();

    await vi.waitFor(() => expect(runs).toHaveLength(2));
    await vi.waitFor(() => expect(supervisor.state()).toEqual({ phase: "connected" }));
    expect(states.map((state) => state.phase)).toContain("reconnecting");
  });

  it("retries right away when restarted while waiting to reconnect", async () => {
    const { supervisor, runs, health } = harness({
      // Every reconnect delay lasts until the test ends; health polls run straight away.
      wait: (ms) =>
        ms >= 1_000 ? new Promise(() => {}) : new Promise((resolve) => setImmediate(resolve)),
    });
    active = supervisor;
    health.ok = true;
    await supervisor.connect();
    runs[0]!.exit();
    await vi.waitFor(() => expect(supervisor.state()).toEqual({ phase: "reconnecting" }));

    supervisor.restart();

    await vi.waitFor(() => expect(supervisor.state()).toEqual({ phase: "connected" }));
    expect(runs).toHaveLength(2);
  });

  it("ends the command and stays stopped", async () => {
    const { supervisor, runs, health } = harness({});
    health.ok = true;
    await supervisor.connect();

    supervisor.stop();

    expect(runs[0]!.stopped).toBe(true);
    expect(supervisor.state()).toEqual({ phase: "stopped" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(runs).toHaveLength(1);
  });
});
