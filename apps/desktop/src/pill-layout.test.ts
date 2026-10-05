import { describe, expect, it } from "vitest";
import { parsePillSize, pillBounds } from "./pill-layout.js";

describe("connection pill layout", () => {
  it("centres the pill at the top of the window", () => {
    expect(pillBounds(1440, { width: 180, height: 40 })).toMatchObject({
      x: 630,
      width: 180,
      height: 40,
    });
  });

  it("keeps the pill on screen in a window narrower than it", () => {
    expect(pillBounds(100, { width: 180, height: 40 }).x).toBe(0);
  });

  it("accepts the size the page reports, rounded up and capped", () => {
    expect(parsePillSize(179.4, 39.2)).toEqual({ width: 180, height: 40 });
    expect(parsePillSize(5_000, 5_000)).toEqual({ width: 480, height: 80 });
  });

  it("rejects a size that is missing or not positive", () => {
    for (const [width, height] of [
      ["180", 40],
      [180, undefined],
      [0, 40],
      [Number.NaN, 40],
    ]) {
      expect(parsePillSize(width, height)).toBeNull();
    }
  });
});
