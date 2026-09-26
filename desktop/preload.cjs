const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('videoHubDesktop', Object.freeze({
  platform: process.platform,
  isDesktop: true,
  version: process.env.npm_package_version || '1.0.0',
}));
