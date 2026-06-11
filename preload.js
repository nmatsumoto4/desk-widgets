// レンダラーに最小限の API だけを公開する
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetAPI', {
  // 新しいウィジェットウィンドウを開く（mode: '2048' | 'puyo' | 'rush'）
  newWidget: (mode) => ipcRenderer.send('new-widget', mode)
});
