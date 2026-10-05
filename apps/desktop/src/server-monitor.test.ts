import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerMonitor } from "./server-monitor.js";

function harness() {
  const changes: boolean[] = [];
  const health = { ok: true };
  const monitor = new ServerMonitor({
    healthy: async () => health.ok,
    onReachable: (reachable) => changes.push(reachable),
    // Yield to the event loop so checks run back to back without real delays.
    wait: () => new Promise((resolve) => setImmediate(resolve)),
  });
  return { monitor, changes, health };
}

let active: ServerMonitor | null = null;
afterEach(() => {
  active?.stop();
  active = null;
});

describe("ServerMonitor", () => {
  it("stays quiet while the server answers", async () => {
    const { monitor, changes } = harness();
    active = monitor;

    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(changes).toEqual([]);
  });

  it("reports a drop once the server stops answering, then its return", async () => {
    const { monitor, changes, health } = harness();
    active = monitor;
    monitor.start();

    health.ok = false;
    await vi.waitFor(() => expect(changes).toEqual([false]));
    health.ok = true;

    await vi.waitFor(() => expect(changes).toEqual([false, true]));
  });

  it("does not report a single failed check", async () => {
    const changes: boolean[] = [];
    const results = [false, true];
    const monitor = new ServerMonitor({
      healthy: async () => results.shift() ?? true,
      onReachable: (reachable) => changes.push(reachable),
      wait: () => new Promise((resolve) => setImmediate(resolve)),
    });
    active = monitor;

    monitor.start();
    await vi.waitFor(() => expect(results).toEqual([]));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(changes).toEqual([]);
  });

  it("stops checking once stopped", async () => {
    const healthy = vi.fn(async () => false);
    const monitor = new ServerMonitor({
      healthy,
      onReachable: () => {},
      wait: () => new Promise((resolve) => setImmediate(resolve)),
    });
    monitor.start();
    await vi.waitFor(() => expect(healthy).toHaveBeenCalled());

    monitor.stop();
    const checks = healthy.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(healthy.mock.calls.length).toBeLessThanOrEqual(checks + 1);
  });
});
