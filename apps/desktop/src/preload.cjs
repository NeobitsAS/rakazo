const { contextBridge, ipcRenderer } = require("electron");

// The shell draws its own controls over this page (see drag-holes.ts). Where the page marks
// those spots as window drag areas, the window would take the clicks, so they are marked as
// not draggable. Elements later in the document override earlier drag areas.
let dragHoles = null;
ipcRenderer.on("desktop.dragHoles", (_event, rects) => {
  if (document.body === null) return;
  if (dragHoles === null) {
    dragHoles = document.createElement("div");
    dragHoles.setAttribute("aria-hidden", "true");
  }
  dragHoles.replaceChildren(
    ...rects.map((rect) => {
      const hole = document.createElement("div");
      hole.style.cssText = `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;-webkit-app-region:no-drag`;
      return hole;
    }),
  );
  document.body.append(dragHoles);
});

contextBridge.exposeInMainWorld("rakazoDesktop", {
  platform: process.platform,
  localSettings: {
    request: (pathname, body) =>
      ipcRenderer.invoke("desktop.localSettings.request", pathname, body),
  },
  window: {
    close: () => ipcRenderer.invoke("desktop.window.close"),
    minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
    toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
    state: () => ipcRenderer.invoke("desktop.window.state"),
  },
  update: {
    state: () => ipcRenderer.invoke("desktop.update.state"),
    check: () => ipcRenderer.invoke("desktop.update.check"),
    download: () => ipcRenderer.invoke("desktop.update.download"),
    install: () => ipcRenderer.invoke("desktop.update.install"),
  },
  oauth: {
    open: (url) => ipcRenderer.invoke("desktop.oauth.open", url),
    cancel: (url) => ipcRenderer.invoke("desktop.oauth.cancel", url),
    onCallback: (listener) => {
      // The IpcRendererEvent stays in the preload: the renderer only sees the code.
      const handler = (_event, callback) => listener(callback);
      ipcRenderer.on("desktop.oauth.callback", handler);
      return () => ipcRenderer.off("desktop.oauth.callback", handler);
    },
  },
});
