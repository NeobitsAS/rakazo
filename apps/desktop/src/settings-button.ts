import path from "node:path";
import { type BrowserWindow, WebContentsView } from "electron";
import { DragHoles } from "./drag-holes.js";
import { settingsButtonBounds, showsSettingsButton } from "./settings-button-layout.js";

/**
 * A settings button the desktop shell draws in the top-right corner of the app window while it
 * shows a signed-out page, so setup stays reachable before anyone signs in. The shell draws it
 * rather than the server's page: setup is kept off the bridge a connected server can call.
 */
export class SettingsButton {
  private readonly view: WebContentsView;

  constructor(
    private readonly win: BrowserWindow,
    serverOrigin: string,
    openSettings: () => void,
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: path.join(import.meta.dirname, "settings-button-preload.cjs"),
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
    contents.ipc.on("desktop.settingsButton.open", () => openSettings());

    const update = (pageUrl: string) => {
      this.view.setVisible(showsSettingsButton(pageUrl, serverOrigin));
      this.syncDragHole();
    };
    win.webContents.on("did-navigate", (_event, pageUrl) => update(pageUrl));
    win.webContents.on("did-navigate-in-page", (_event, pageUrl, isMainFrame) => {
      if (isMainFrame) update(pageUrl);
    });
    win.on("resize", () => this.place());
    win.once("closed", () => contents.close());
    this.place();
    void contents.loadFile(path.join(import.meta.dirname, "settings-button.html")).catch(() => {});
  }

  private place() {
    if (this.win.isDestroyed()) return;
    this.view.setBounds(settingsButtonBounds(this.win.getContentBounds().width));
    this.syncDragHole();
  }

  private syncDragHole() {
    DragHoles.for(this.win).set(
      "settings-button",
      this.view.getVisible() ? this.view.getBounds() : null,
    );
  }
}
