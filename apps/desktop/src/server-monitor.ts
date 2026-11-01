export interface ServerMonitorDeps {
  /** True when the server answers. */
  healthy: () => Promise<boolean>;
  /** Called once when the server stops answering. */
  onDropped: () => void;
  wait?: (ms: number) => Promise<void>;
}

const CHECK_INTERVAL_MS = 15_000;
/** The server counts as unreachable after this many failed checks in a row. */
const MISSES = 2;

/**
 * Watches a server the app reaches directly (no tunnel) so the app can show when the
 * connection drops. One slow check is not reported as a drop. After a drop it stops checking:
 * reconnecting is the user's call, through `check`.
 */
export class ServerMonitor {
  private readonly stopped = new AbortController();
  private watching = false;

  constructor(private readonly deps: ServerMonitorDeps) {}

  start(): void {
    if (this.watching || this.isStopped) return;
    this.watching = true;
    void this.watch();
  }

  /** Checks the server once; when it answers, watching starts again. */
  async check(): Promise<boolean> {
    const healthy = await this.deps.healthy();
    if (healthy) this.start();
    return healthy;
  }

  stop(): void {
    this.stopped.abort();
  }

  private get isStopped() {
    return this.stopped.signal.aborted;
  }

  private async watch(): Promise<void> {
    const wait = this.deps.wait ?? defaultWait;
    let misses = 0;
    while (!this.isStopped && misses < MISSES) {
      await wait(CHECK_INTERVAL_MS);
      if (this.isStopped) return;
      misses = (await this.deps.healthy()) ? 0 : misses + 1;
    }
    this.watching = false;
    if (!this.isStopped) this.deps.onDropped();
  }
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
