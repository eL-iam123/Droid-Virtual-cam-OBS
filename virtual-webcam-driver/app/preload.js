const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  start: () => ipcRenderer.invoke('start-webcam'),
  stop: () => ipcRenderer.invoke('stop-webcam'),
});