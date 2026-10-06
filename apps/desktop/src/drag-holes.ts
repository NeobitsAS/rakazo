import type { BrowserWindow, Rectangle } from "electron";

const windows = new WeakMap<BrowserWindow, DragHoles>();

/**
 * Keeps the server page's window drag areas from taking clicks meant for the shell's overlays.
 * Electron gives a click to the first view whose drag area contains it, and an overlay cannot
 * mark itself as not draggable over a page that is, so the page's preload marks the spots the
 * overlays cover instead.
 */
export class DragHoles {
  private readonly holes = new Map<string, Rectangle>();

  private constructor(private readonly win: BrowserWindow) {
    // A full page load starts a new document, which needs the holes again.
    win.webContents.on("dom-ready", () => this.send());
  }

  static for(win: BrowserWindow): DragHoles {
    let holes = windows.get(win);
    if (holes === undefined) {
      holes = new DragHoles(win);
      windows.set(win, holes);
    }
    return holes;
  }

  /** Marks what an overlay covers as not draggable, or clears it with null. */
  set(overlay: string, bounds: Rectangle | null): void {
    if (bounds === null) this.holes.delete(overlay);
    else this.holes.set(overlay, bounds);
    this.send();
  }

  private send() {
    if (this.win.isDestroyed()) return;
    this.win.webContents.send("desktop.dragHoles", [...this.holes.values()]);
  }
}
