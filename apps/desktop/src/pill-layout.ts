export interface PillSize {
  width: number;
  height: number;
}

/** The page pads the pill by 10px for its shadow, so the pill itself sits 14px down. */
const TOP_OFFSET_PX = 4;
/** Upper bound for the size the page reports, so a bad report cannot cover the app. */
const MAX_SIZE: PillSize = { width: 480, height: 80 };

/** Centres the pill at the top of a window's content area. */
export function pillBounds(contentWidth: number, size: PillSize): Electron.Rectangle {
  return {
    x: Math.max(0, Math.round((contentWidth - size.width) / 2)),
    y: TOP_OFFSET_PX,
    width: size.width,
    height: size.height,
  };
}

/** Reads the size the pill page reports, rejecting anything that is not a sensible size. */
export function parsePillSize(width: unknown, height: unknown): PillSize | null {
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    width: Math.min(Math.ceil(width), MAX_SIZE.width),
    height: Math.min(Math.ceil(height), MAX_SIZE.height),
  };
}
