'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  versionsList: () => ipcRenderer.invoke('versions:list'),
  offlineLogin: (nick) => ipcRenderer.invoke('account:offline', nick),
  microsoftLogin: () => ipcRenderer.invoke('account:microsoft'),
  getAccount: () => ipcRenderer.invoke('account:get'),
  logout: () => ipcRenderer.invoke('account:logout'),
  launch: (opts) => ipcRenderer.invoke('game:launch', opts),
  killGame: () => ipcRenderer.invoke('game:kill'),
  javaList: () => ipcRenderer.invoke('java:list'),
  downloadJava: (opts) => ipcRenderer.invoke('java:download', opts),
  openGameDir: () => ipcRenderer.invoke('paths:open'),
  gameDir: () => ipcRenderer.invoke('paths:gameDir'),
  onStatus: (cb) => ipcRenderer.on('game:status', (_e, p) => cb(p)),
  onLog: (cb) => ipcRenderer.on('game:log', (_e, t) => cb(t)),
  onExit: (cb) => ipcRenderer.on('game:exit', (_e, p) => cb(p)),
});
