const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoSetup", {
  platform: process.platform,
  state: () => ipcRenderer.invoke("desktop.setup.state"),
  test: (url, tunnel) => ipcRenderer.invoke("desktop.setup.test", url, tunnel),
  save: (setup) => ipcRenderer.invoke("desktop.setup.save", setup),
  cancel: () => ipcRenderer.invoke("desktop.setup.cancel"),
  openLink: (link) => ipcRenderer.invoke("desktop.setup.openLink", link),
  stack: {
    state: () => ipcRenderer.invoke("desktop.setup.stack.state"),
    start: () => ipcRenderer.invoke("desktop.setup.stack.start"),
    onChange: (listener) => {
      ipcRenderer.on("desktop.setup.stack.changed", (_event, state) => listener(state));
    },
  },
});
