const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('videoHubDesktop', Object.freeze({
  platform: process.platform,
  isDesktop: true,
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  update: Object.freeze({
    getState: () => ipcRenderer.invoke('update:get-state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    openLog: () => ipcRenderer.invoke('update:open-log'),
    onStateChange: callback => subscribe('update:state', callback),
  }),
}));
