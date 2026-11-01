const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoSettingsButton", {
  open: () => ipcRenderer.send("desktop.settingsButton.open"),
  onLabel: (listener) => {
    ipcRenderer.on("desktop.settingsButton.label", (_event, label) => listener(label));
  },
});
