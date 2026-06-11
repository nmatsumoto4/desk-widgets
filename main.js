const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

const WIDTH = 280;
const HEIGHT = 360;
const MARGIN = 16;
const GAP = 12;
const PER_ROW = 4; // 横に並べる最大数（超えたら一段上に積む）

let windowCount = 0;

function createWindow(mode) {
  const { workArea } = screen.getPrimaryDisplay();
  const idx = windowCount++;
  const col = idx % PER_ROW;
  const row = Math.floor(idx / PER_ROW);

  // 右下を起点に左へ、いっぱいになったら一段上へ並べる
  const x = Math.max(
    workArea.x,
    workArea.x + workArea.width - MARGIN - WIDTH - col * (WIDTH + GAP)
  );
  const y = Math.max(
    workArea.y,
    workArea.y + workArea.height - MARGIN - HEIGHT - row * (HEIGHT + GAP)
  );

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x, y,
    frame: false,
    // ウィンドウ端のドラッグでリサイズ可能（縦横比は固定）
    resizable: true,
    minWidth: 170,
    minHeight: 219,
    maxWidth: 440,
    maxHeight: 566,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // フォーカスなしで常時動くウィジェットなので、
      // バックグラウンド時のタイマー抑制を無効化する（これがないと
      // 非フォーカス時にゲームオーバー後の自動リスタート等が止まる）
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setAspectRatio(WIDTH / HEIGHT);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const query = mode ? { mode } : undefined;
  win.loadFile(path.join(__dirname, 'index.html'), { query });

  // フォーカスを奪わずに表示する → 起動直後から AI 自動運転で始まる
  win.once('ready-to-show', () => win.showInactive());
}

app.whenReady().then(() => createWindow());

// 「＋」ボタン：現在のモードを引き継いだ新しいウィジェットを開く
ipcMain.on('new-widget', (_event, mode) => createWindow(mode));

app.on('window-all-closed', () => app.quit());
