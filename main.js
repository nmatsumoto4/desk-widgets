const { app, BrowserWindow, screen, ipcMain, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const APP_NAME = 'THE RETRO CENTER';
app.setName(APP_NAME);

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

// すべてのウィジェットを一括で隠す／再表示する
function setAllVisible(visible) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (visible) w.showInactive();
    else w.hide();
  }
}
function toggleHideAll() {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length === 0) return;
  setAllVisible(!wins.some((w) => w.isVisible()));
}

// メニューバー（トレイ）アイコン：ショートカット以外で復帰できる導線
let tray = null;

// アーケード筐体（ゲーセン）風のドット絵アイコンを生成する
// '#'=本体 / 'S'=画面（光る）/ '.'=透明。16×16 を scale 倍で描く
const CABINET = [
  '..############..', // マーキー（光る看板）上枠
  '..#SSSSSSSSSS#..', // マーキーの光
  '..############..',
  '.##############.', // 本体の肩
  '.##.SSSSSSSS.##.', // 画面
  '.##.SSSSSSSS.##.',
  '.##.SSSSSSSS.##.',
  '.##.SSSSSSSS.##.',
  '.##############.', // 画面下
  '.##############.', // コントロールパネル／本体
  '.##############.',
  '.##############.',
  '.##############.',
  '.##..........##.', // 脚
  '.##..........##.',
  '.##..........##.'
];

function buildCabinetIcon(body, screen) {
  const P = 2;            // 拡大率（くっきり用）
  const S = 16 * P;
  const buf = Buffer.alloc(S * S * 4); // BGRA, 透明
  const set = (x, y, col) => {
    const i = (y * S + x) * 4;
    buf[i] = col[2]; buf[i + 1] = col[1]; buf[i + 2] = col[0]; buf[i + 3] = 255;
  };
  for (let r = 0; r < 16; r++) {
    const row = CABINET[r] || '';
    for (let c = 0; c < 16; c++) {
      const ch = row[c] || '.';
      if (ch === '.') continue;
      const col = ch === 'S' ? screen : body;
      for (let dy = 0; dy < P; dy++)
        for (let dx = 0; dx < P; dx++)
          set(c * P + dx, r * P + dy, col);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
}

function createTray() {
  try {
    const isMac = process.platform === 'darwin';
    // mac はテンプレート（黒）でメニューバーに自動適応。他 OS は視認できる色で
    const icon = isMac
      ? buildCabinetIcon([0, 0, 0], [0, 0, 0])
      : buildCabinetIcon([225, 225, 230], [80, 200, 255]);
    if (isMac) icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip(APP_NAME);
    if (isMac) tray.setTitle(` ${APP_NAME}`); // メニューバーに名前を表示
    const menu = Menu.buildFromTemplate([
      { label: APP_NAME, enabled: false },
      { type: 'separator' },
      { label: 'ウィジェットを表示 / 隠す', click: toggleHideAll },
      { label: 'すべて表示', click: () => setAllVisible(true) },
      { type: 'separator' },
      { label: '新しいウィジェットを追加', click: () => createWindow() },
      { type: 'separator' },
      { label: '終了', click: () => app.quit() }
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => setAllVisible(true));
    console.log('[retrocenter] tray created');
  } catch (e) {
    console.log('[retrocenter] tray failed:', e.message);
  }
}

// 一括非表示のグローバルショートカット（候補を順に試し、空いているものを登録）
let hideAllAccelerator = null;
function registerHideShortcut() {
  for (const acc of ['CommandOrControl+Shift+H', 'CommandOrControl+Alt+H', 'CommandOrControl+Shift+0']) {
    if (globalShortcut.register(acc, toggleHideAll)) { hideAllAccelerator = acc; break; }
  }
  console.log('[deskwidgets] hide-all shortcut:', hideAllAccelerator || '(登録失敗)');
}

app.whenReady().then(() => {
  createWindow();
  registerHideShortcut();
  createTray();
});

// Dock アイコン（macOS）クリックで復帰
app.on('activate', () => setAllVisible(true));

// 「＋」ボタン：現在のモードを引き継いだ新しいウィジェットを開く
ipcMain.on('new-widget', (_event, mode) => createWindow(mode));

// ボタンからの一括非表示トグル
ipcMain.on('toggle-hide-all', () => toggleHideAll());
// テスト・確認用：表示中ウィンドウ数
ipcMain.handle('widgets-visible-count', () => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length);

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
