// レンダラーに最小限の API だけを公開する
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetAPI', {
  // 新しいウィジェットウィンドウを開く（mode: '2048' | 'puyo' | 'rush' ...）
  newWidget: (mode) => ipcRenderer.send('new-widget', mode),
  // すべてのウィジェットを一括で隠す／再表示する
  toggleHideAll: () => ipcRenderer.send('toggle-hide-all'),
  widgetsVisibleCount: () => ipcRenderer.invoke('widgets-visible-count'),
  // 前面/背面の切替
  toggleLayer: () => ipcRenderer.send('toggle-layer'),
  setLayer: (top) => ipcRenderer.send('set-layer', top),
  layerOnTop: () => ipcRenderer.invoke('layer-on-top'),
  // 一括ミュート
  toggleMute: () => ipcRenderer.send('toggle-mute'),
  getMuted: () => ipcRenderer.invoke('get-muted'),
  onMutedChanged: (cb) => ipcRenderer.on('muted-changed', (_e, m) => cb(m))
});
