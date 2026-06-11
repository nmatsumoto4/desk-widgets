// レンダラーに最小限の API だけを公開する
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetAPI', {
  // 新しいウィジェットウィンドウを開く（mode: '2048' | 'puyo' | 'rush'）
  newWidget: (mode) => ipcRenderer.send('new-widget', mode),
  // デスクトップ猫を呼ぶ
  newCat: () => ipcRenderer.send('new-cat')
});

// デスクトップ猫ウィンドウ用 API
contextBridge.exposeInMainWorld('catAPI', {
  info: () => ipcRenderer.invoke('cat-info'),
  cursor: () => ipcRenderer.invoke('cursor-point'),
  moveTo: (x, y) => ipcRenderer.send('cat-move-to', x, y),
  setAlwaysOnTop: (on) => ipcRenderer.send('cat-aot', on),
  setAutostart: (on) => ipcRenderer.send('cat-autostart', on),
  openSettings: () => ipcRenderer.send('open-cat-settings'),
  newCat: () => ipcRenderer.send('new-cat')
});
