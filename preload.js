// レンダラーに最小限の API だけを公開する
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetAPI', {
  // 新しいウィジェットウィンドウを開く（mode: '2048' | 'puyo' | 'rush' ...）
  newWidget: (mode) => ipcRenderer.send('new-widget', mode),
  // すべてのウィジェットを一括で隠す／再表示する
  toggleHideAll: () => ipcRenderer.send('toggle-hide-all'),
  widgetsVisibleCount: () => ipcRenderer.invoke('widgets-visible-count')
});
