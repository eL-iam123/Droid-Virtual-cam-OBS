const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  updateSettings: (patch) => ipcRenderer.invoke('update-settings', patch),
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  start: () => ipcRenderer.invoke('start-webcam'),
  stop: () => ipcRenderer.invoke('stop-webcam'),
  launchObs: () => ipcRenderer.invoke('launch-obs'),
  setPreviewStatus: (status) => ipcRenderer.invoke('set-preview-status', status),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('state-updated', listener);
    return () => ipcRenderer.removeListener('state-updated', listener);
  },
  onLog: (handler) => {
    const listener = (_event, entry) => handler(entry);
    ipcRenderer.on('log-entry', listener);
    return () => ipcRenderer.removeListener('log-entry', listener);
  }
});
