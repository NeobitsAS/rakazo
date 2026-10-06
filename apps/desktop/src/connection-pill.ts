import path from "node:path";
import { type BrowserWindow, WebContentsView } from "electron";
import { DragHoles } from "./drag-holes.js";
import { type PillSize, parsePillSize, pillBounds } from "./pill-layout.js";

/** What the pill says about the connection to the open server; hidden while all is well. */
export type ConnectionStatus = "hidden" | "reconnecting" | "connected" | "lost";

/** How long "Connected" stays up before the pill fades out. */
const CONNECTED_MS = 2_000;
/** Matches the fade-out transition in pill.css. */
const FADE_MS = 200;

/**
 * A small status pill drawn by the desktop shell over the top of an app window. It lives in
 * its own view, so it stays put while the server's page reloads or cannot load at all.
 */
export class ConnectionPill {
  private readonly view: WebContentsView;
  private readonly loaded: Promise<unknown>;
  private status: ConnectionStatus = "hidden";
  private size: PillSize | null = null;
  private hideTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly win: BrowserWindow,
    /** The refresh button on "Connection lost": tries to connect again. */
    reconnect: () => void,
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: path.join(import.meta.dirname, "pill-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.view.setBackgroundColor("#00000000");
    this.view.setVisible(false);
    win.contentView.addChildView(this.view);

    const contents = this.view.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    // The page reports its size after drawing each status; only then is the pill shown.
    contents.ipc.on("desktop.pill.resize", (_event, width: unknown, height: unknown) => {
      this.size = parsePillSize(width, height);
      this.place();
      if (this.size !== null && this.status !== "hidden") this.view.setVisible(true);
      this.syncDragHole();
    });
    contents.ipc.on("desktop.pill.reconnect", () => {
      if (this.status === "lost") reconnect();
    });
    win.on("resize", () => this.place());
    win.once("closed", () => {
      clearTimeout(this.hideTimer);
      contents.close();
    });
    this.loaded = contents.loadFile(path.join(import.meta.dirname, "pill.html")).catch(() => {});
  }

  /** "Connected" is only announced when the pill was showing a problem. */
  show(status: ConnectionStatus): void {
    if (status === this.status) return;
    if (status === "connected" && this.status === "hidden") return;
    clearTimeout(this.hideTimer);
    this.status = status;
    void this.loaded.then(() => {
      if (!this.view.webContents.isDestroyed()) {
        this.view.webContents.send("desktop.pill.status", status);
      }
    });
    if (status === "hidden") {
      this.hideTimer = setTimeout(() => {
        this.view.setVisible(false);
        this.syncDragHole();
      }, FADE_MS);
    } else if (status === "connected") {
      this.hideTimer = setTimeout(() => this.show("hidden"), CONNECTED_MS);
    }
  }

  private place() {
    if (this.size === null || this.win.isDestroyed()) return;
    this.view.setBounds(pillBounds(this.win.getContentBounds().width, this.size));
    this.syncDragHole();
  }

  private syncDragHole() {
    if (this.win.isDestroyed()) return;
    DragHoles.for(this.win).set(
      "connection-pill",
      this.view.getVisible() ? this.view.getBounds() : null,
    );
  }
}
