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

// ---- デスクトップ猫 ----

const CAT_W = 190;
const CAT_H = 230;
let catCount = 0;
let settingsWin = null;

function createCatWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const idx = catCount++;
  const win = new BrowserWindow({
    width: CAT_W,
    height: CAT_H,
    x: workArea.x + Math.floor(workArea.width * 0.45) + (idx % 5) * 60,
    y: workArea.y + workArea.height - CAT_H,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'cat.html'));
  win.once('ready-to-show', () => win.showInactive());
  return win;
}

function openCatSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  settingsWin = new BrowserWindow({
    width: 320,
    height: 560,
    x: workArea.x + Math.floor((workArea.width - 320) / 2),
    y: workArea.y + Math.floor((workArea.height - 560) / 2),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'cat-settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

app.whenReady().then(() => {
  createWindow();
  createCatWindow(); // 起動と同時に猫もデスクトップに常駐させる
});

// 「＋」ボタン：現在のモードを引き継いだ新しいウィジェットを開く
ipcMain.on('new-widget', (_event, mode) => createWindow(mode));

// 猫関連 IPC
ipcMain.on('new-cat', () => createCatWindow());
ipcMain.on('open-cat-settings', () => openCatSettings());
ipcMain.handle('cursor-point', () => screen.getCursorScreenPoint());
ipcMain.handle('cat-info', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const bounds = win.getBounds();
  return { bounds, workArea: screen.getDisplayMatching(bounds).workArea };
});
ipcMain.on('cat-move-to', (event, x, y) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setPosition(Math.round(x), Math.round(y));
});
ipcMain.on('cat-aot', (event, on) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setAlwaysOnTop(!!on, 'floating');
});
ipcMain.on('cat-autostart', (_event, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
});

app.on('window-all-closed', () => app.quit());
