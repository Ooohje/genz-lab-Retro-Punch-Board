// 화면 쪽 코드가 쓸 수 있는 기능만 골라서 내어 줍니다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (data) => ipcRenderer.invoke('state:save', data),
  setFullscreen: (on) => ipcRenderer.invoke('win:setFullscreen', on),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),
  quit: () => ipcRenderer.invoke('app:quit'),
  exportText: (opts) => ipcRenderer.invoke('file:exportText', opts),
  importText: (opts) => ipcRenderer.invoke('file:importText', opts),
  pickImage: () => ipcRenderer.invoke('file:pickImage')
});
