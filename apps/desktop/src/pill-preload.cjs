const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoPill", {
  onStatus: (listener) => {
    ipcRenderer.on("desktop.pill.status", (_event, status) => listener(status));
  },
  resize: (width, height) => ipcRenderer.send("desktop.pill.resize", width, height),
  activate: () => ipcRenderer.send("desktop.pill.activate"),
});
