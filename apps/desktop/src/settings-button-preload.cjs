const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoSettingsButton", {
  open: () => ipcRenderer.send("desktop.settingsButton.open"),
});
