const { contextBridge, ipcRenderer } = require("electron");

/** Listen for a main-process signal without handing the IPC event to the renderer. */
function subscribe(channel) {
  return (listener) => {
    const handler = () => listener();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  };
}

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
  nativeWindowFrame: process.platform === "win32",
  badge: {
    set: (count) => ipcRenderer.invoke("desktop.badge.set", count),
  },
  computer: {
    managesHostChoice: true,
    requestAccess: () => ipcRenderer.invoke("desktop.computer.requestAccess"),
    revokeAccess: () => ipcRenderer.invoke("desktop.computer.revokeAccess"),
    onConfigure: subscribe("desktop.computer.configure"),
  },
  settings: {
    onOpen: subscribe("desktop.settings.open"),
  },
  device: {
    state: () => ipcRenderer.invoke("desktop.device.state"),
    setAllowed: (allowed) => ipcRenderer.invoke("desktop.device.setAllowed", allowed),
  },
  menu: {
    onCommand: (listener) => {
      // The IpcRendererEvent stays in the preload: the renderer only sees the command.
      const handler = (_event, command) => listener(command);
      ipcRenderer.on("desktop.menu.command", handler);
      return () => ipcRenderer.off("desktop.menu.command", handler);
    },
  },
  monitoring: {
    enabled: () => ipcRenderer.invoke("desktop.monitoring.enabled"),
  },
  passkeys: {
    rpIds: () => ipcRenderer.invoke("desktop.passkeys.rpIds"),
  },
  // Only macOS ships a system recognizer helper; elsewhere dictation keeps its provider path.
  ...(process.platform === "darwin"
    ? {
        speech: {
          start: (language, session) =>
            ipcRenderer.invoke("desktop.speech.start", language, session),
          stop: (session) => ipcRenderer.invoke("desktop.speech.stop", session),
          abort: (session) => ipcRenderer.invoke("desktop.speech.abort", session),
          onEvent: (listener) => {
            // The IpcRendererEvent stays in the preload: the renderer only sees the payload.
            const handler = (_event, payload) => listener(payload);
            ipcRenderer.on("desktop.speech.event", handler);
            return () => ipcRenderer.off("desktop.speech.event", handler);
          },
        },
      }
    : {}),
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
