export interface ServerMonitorDeps {
  /** True when the server answers. */
  healthy: () => Promise<boolean>;
  /** Called when the server stops answering, and again when it answers after that. */
  onReachable: (reachable: boolean) => void;
  wait?: (ms: number) => Promise<void>;
}

const CHECK_INTERVAL_MS = 15_000;
/** While the server is not answering, check more often so recovery shows up quickly. */
const RETRY_INTERVAL_MS = 3_000;
/** The server counts as unreachable after this many failed checks in a row. */
const MISSES = 2;

/**
 * Watches a server the app reaches directly (no tunnel) so the app can show when the
 * connection drops and when it comes back. One slow check is not reported as a drop.
 */
export class ServerMonitor {
  private readonly stopped = new AbortController();

  constructor(private readonly deps: ServerMonitorDeps) {}

  start(): void {
    void this.watch();
  }

  stop(): void {
    this.stopped.abort();
  }

  private get isStopped() {
    return this.stopped.signal.aborted;
  }

  private async watch(): Promise<void> {
    const wait = this.deps.wait ?? defaultWait;
    let reachable = true;
    let misses = 0;
    while (!this.isStopped) {
      await wait(reachable ? CHECK_INTERVAL_MS : RETRY_INTERVAL_MS);
      if (this.isStopped) return;
      const healthy = await this.deps.healthy();
      if (this.isStopped) return;
      misses = healthy ? 0 : misses + 1;
      if (reachable && misses >= MISSES) {
        reachable = false;
        this.deps.onReachable(false);
      } else if (!reachable && healthy) {
        reachable = true;
        this.deps.onReachable(true);
      }
    }
  }
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
