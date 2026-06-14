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
let onTop = true; // true=前面（常に最前面）/ false=背面（他ウィンドウの後ろ＝デスクトップ寄り）

// 前面/背面をウィンドウへ適用
function applyLayer(win) {
  if (onTop) win.setAlwaysOnTop(true, 'floating');
  else { win.setAlwaysOnTop(false); win.moveTop && win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); }
}
function setLayer(top) {
  onTop = top;
  for (const w of BrowserWindow.getAllWindows()) applyLayer(w);
  if (tray) tray.setContextMenu(buildTrayMenu());
}
function toggleLayer() { setLayer(!onTop); }

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
    alwaysOnTop: onTop,
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

  applyLayer(win);
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

// アーケード筐体（ゲーセン）風アイコンを矩形で描く。
// 22×22 論理（×2=44px）に対して上下左右へ余白を取り、画面をくり抜いて
// メニューバーで小さく・軽く見えるようにする。色は body のみ（画面は透明の穴）。
function buildCabinetIcon(body) {
  const U = 2, SZ = 22 * U;
  const buf = Buffer.alloc(SZ * SZ * 4); // BGRA, 透明
  const R = (lx, ly, lw, lh, on) => {
    for (let y = ly * U; y < (ly + lh) * U; y++) {
      for (let x = lx * U; x < (lx + lw) * U; x++) {
        if (x < 0 || y < 0 || x >= SZ || y >= SZ) continue;
        const i = (y * SZ + x) * 4;
        if (on) { buf[i] = body[2]; buf[i + 1] = body[1]; buf[i + 2] = body[0]; buf[i + 3] = 255; }
        else { buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0; }
      }
    }
  };
  R(4, 2, 14, 2, true);    // マーキー（看板）
  R(4, 5, 14, 11, true);   // 本体
  R(6, 7, 10, 5, false);   // 画面（くり抜き）
  R(6, 14, 10, 1, false);  // コントロールパネルのスリット
  R(6, 16, 10, 3, false);  // 脚の間を透明に
  R(4, 16, 2, 3, true);    // 左脚
  R(16, 16, 2, 3, true);   // 右脚
  return nativeImage.createFromBitmap(buf, { width: SZ, height: SZ });
}

function createTray() {
  try {
    const isMac = process.platform === 'darwin';
    // mac はテンプレート（黒）でメニューバーに自動適応。他 OS は視認できる色で
    const icon = isMac ? buildCabinetIcon([0, 0, 0]) : buildCabinetIcon([225, 225, 230]);
    if (isMac) icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip(APP_NAME);
    if (isMac) tray.setTitle(` ${APP_NAME}`); // メニューバーに名前を表示
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => setAllVisible(true));
    console.log('[retrocenter] tray created');
  } catch (e) {
    console.log('[retrocenter] tray failed:', e.message);
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: APP_NAME, enabled: false },
    { type: 'separator' },
    { label: 'ウィジェットを表示 / 隠す', click: toggleHideAll },
    { label: 'すべて表示', click: () => setAllVisible(true) },
    { type: 'separator' },
    { label: onTop ? '✓ 前面に表示' : '前面に表示', click: () => setLayer(true) },
    { label: !onTop ? '✓ 背面に表示（デスクトップ寄り）' : '背面に表示（デスクトップ寄り）', click: () => setLayer(false) },
    { type: 'separator' },
    { label: '新しいウィジェットを追加', click: () => createWindow() },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() }
  ]);
}

// グローバルショートカット（候補を順に試し、空いているものを登録）
function registerShortcut(cands, fn, label) {
  let chosen = null;
  for (const acc of cands) { if (globalShortcut.register(acc, fn)) { chosen = acc; break; } }
  console.log(`[retrocenter] ${label} shortcut:`, chosen || '(登録失敗)');
}
function registerShortcuts() {
  registerShortcut(['CommandOrControl+Shift+H', 'CommandOrControl+Alt+H', 'CommandOrControl+Shift+0'], toggleHideAll, 'hide-all');
  registerShortcut(['CommandOrControl+Shift+B', 'CommandOrControl+Alt+B', 'CommandOrControl+Shift+9'], toggleLayer, 'layer');
}

app.whenReady().then(() => {
  createWindow();
  registerShortcuts();
  createTray();
});

// Dock アイコン（macOS）クリックで復帰
app.on('activate', () => setAllVisible(true));

// 「＋」ボタン：現在のモードを引き継いだ新しいウィジェットを開く
ipcMain.on('new-widget', (_event, mode) => createWindow(mode));

// ボタンからの一括非表示トグル
ipcMain.on('toggle-hide-all', () => toggleHideAll());
// 前面/背面の切替・取得
ipcMain.on('toggle-layer', () => toggleLayer());
ipcMain.on('set-layer', (_e, top) => setLayer(!!top));
ipcMain.handle('layer-on-top', () => onTop);
// テスト・確認用：表示中ウィンドウ数
ipcMain.handle('widgets-visible-count', () => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length);

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
