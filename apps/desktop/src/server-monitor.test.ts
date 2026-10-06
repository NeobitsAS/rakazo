import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerMonitor } from "./server-monitor.js";

function harness(results: boolean[] = []) {
  const health = { ok: true };
  const onDropped = vi.fn();
  const healthy = vi.fn(async () => results.shift() ?? health.ok);
  const monitor = new ServerMonitor({
    healthy,
    onDropped,
    // Yield to the event loop so checks run back to back without real delays.
    wait: () => new Promise((resolve) => setImmediate(resolve)),
  });
  return { monitor, health, onDropped, healthy };
}

let active: ServerMonitor | null = null;
afterEach(() => {
  active?.stop();
  active = null;
});

describe("ServerMonitor", () => {
  it("stays quiet while the server answers", async () => {
    const { monitor, onDropped } = harness();
    active = monitor;

    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onDropped).not.toHaveBeenCalled();
  });

  it("does not report a single failed check", async () => {
    const results = [false, true];
    const { monitor, onDropped } = harness(results);
    active = monitor;

    monitor.start();
    await vi.waitFor(() => expect(results).toEqual([]));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onDropped).not.toHaveBeenCalled();
  });

  it("reports a drop once, then stops checking", async () => {
    const { monitor, health, onDropped, healthy } = harness();
    active = monitor;
    monitor.start();

    health.ok = false;
    await vi.waitFor(() => expect(onDropped).toHaveBeenCalledTimes(1));
    const checks = healthy.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(healthy.mock.calls.length).toBe(checks);
  });

  it("watches again once a check on request finds the server back", async () => {
    const { monitor, health, onDropped, healthy } = harness();
    active = monitor;
    monitor.start();
    health.ok = false;
    await vi.waitFor(() => expect(onDropped).toHaveBeenCalledTimes(1));

    await expect(monitor.check()).resolves.toBe(false);
    health.ok = true;
    await expect(monitor.check()).resolves.toBe(true);
    const checks = healthy.mock.calls.length;

    await vi.waitFor(() => expect(healthy.mock.calls.length).toBeGreaterThan(checks));
    health.ok = false;
    await vi.waitFor(() => expect(onDropped).toHaveBeenCalledTimes(2));
  });
});
