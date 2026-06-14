// ウィジェット共通コントローラ
// モード切替（2048 ⇄ ぷよぷよ）・フォーカスによる手動/AI 切替・
// ウィジェット複製・スコア表示・オーバーレイを一元管理する

(() => {
  const MODE_KEY = 'widget.mode';
  const MODE_ORDER = ['2048', 'puyo', 'rush', 'invaders', 'bomber', 'tetris', 'snake', 'life', 'breakout'];
  const GAME_TITLES = { '2048': '2048', puyo: 'ぷよぷよ', rush: 'Rush Hour', invaders: 'インベーダー', bomber: 'ボンバーマン', tetris: 'テトリス', snake: 'スネーク', life: 'ライフゲーム', breakout: 'ブロック崩し' };
  const GAME_SHORT = { '2048': '2048', puyo: 'ぷよ', rush: 'Rush', invaders: 'INV', bomber: 'ボム', tetris: 'テト', snake: 'スネク', life: 'ライフ', breakout: 'ブロック' };

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const infoEl = document.getElementById('games-count');
  const modeIndicatorEl = document.getElementById('mode-indicator');
  const overlayEl = document.getElementById('overlay');
  const overlayTitleEl = document.getElementById('overlay-title');
  const overlaySubEl = document.getElementById('overlay-sub');
  const modeSelectEl = document.getElementById('mode-select');
  const addBtn = document.getElementById('add-btn');
  const closeBtn = document.getElementById('close-btn');

  const ctx = {
    showOverlay(title, sub) {
      overlayTitleEl.textContent = title;
      overlaySubEl.textContent = sub;
      overlayEl.classList.add('visible');
    },
    hideOverlay() {
      overlayEl.classList.remove('visible');
    },
    setScores(score, best, info) {
      scoreEl.textContent = score;
      bestEl.textContent = best;
      infoEl.textContent = info || '';
    }
  };

  const widgets = {
    '2048': window.createWidget2048(ctx),
    puyo: window.createWidgetPuyo(ctx),
    rush: window.createWidgetRush(ctx),
    invaders: window.createWidgetInvaders(ctx),
    bomber: window.createWidgetBomber(ctx),
    tetris: window.createWidgetTetris(ctx),
    snake: window.createWidgetSnake(ctx),
    life: window.createWidgetLife(ctx),
    breakout: window.createWidgetBreakout(ctx)
  };

  // 起動モード：URL パラメータ > 前回の選択 > 2048
  const params = new URLSearchParams(location.search);
  let mode = params.get('mode') || localStorage.getItem(MODE_KEY) || '2048';
  if (!widgets[mode]) mode = '2048';
  let active = widgets[mode];
  let manual = false;

  // セレクトボックスにゲーム一覧を登録
  for (const m of MODE_ORDER) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = GAME_TITLES[m];
    modeSelectEl.appendChild(opt);
  }

  function nextMode() {
    return MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length];
  }

  function applyLabels() {
    modeSelectEl.value = mode;
  }

  function setManual(m) {
    manual = m;
    document.body.classList.toggle('focused', m);
    active.setAuto(!m);
    modeIndicatorEl.textContent = m ? '手動モード（Space / クリックで AI 再開）' : 'AI 自動運転中';
    modeIndicatorEl.classList.toggle('manual', m);
  }

  // 指定したゲームに切り替える（セレクトボックス・テスト共通）
  function setMode(newMode) {
    if (!widgets[newMode] || newMode === mode) { modeSelectEl.value = mode; return; }
    active.hide();
    ctx.hideOverlay();
    mode = newMode;
    localStorage.setItem(MODE_KEY, mode);
    active = widgets[mode];
    applyLabels();
    active.show();
    active.setAuto(!manual);
  }

  function switchMode() { setMode(nextMode()); }

  modeSelectEl.addEventListener('change', () => setMode(modeSelectEl.value));

  addBtn.addEventListener('click', () => {
    if (window.widgetAPI) {
      window.widgetAPI.newWidget(mode);
    } else {
      // ブラウザで開いている場合のフォールバック
      window.open(`${location.pathname}?mode=${mode}`, '_blank',
        'width=280,height=360');
    }
  });

  document.getElementById('hide-btn').addEventListener('click', () => {
    if (window.widgetAPI) window.widgetAPI.toggleHideAll();
  });

  closeBtn.addEventListener('click', () => window.close());

  // フッターの表示はボタンを兼ねる：手動モード中にクリックすると AI を再開
  modeIndicatorEl.addEventListener('click', () => {
    if (manual) setManual(false);
  });

  window.addEventListener('focus', () => setManual(true));
  window.addEventListener('blur', () => setManual(false));

  window.addEventListener('keydown', (e) => {
    // セレクトボックス操作中はキーをゲームに奪わせない
    if (document.activeElement === modeSelectEl) return;
    // Space は「AI モード再開」に統一（手動操作中に押すと自動運転へ戻る）
    if (e.key === ' ') {
      e.preventDefault();
      if (manual) setManual(false);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    // 矢印キーを押したら手動モードに（フォーカス中のみ届く）
    if (!manual) setManual(true);
    active.key(e);
  });

  // ウィンドウリサイズ（DnD でのサイズ変更）に追従
  // ※ rAF は非表示時に発火しないため setTimeout でデバウンスする
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => active.relayout(), 50);
  });

  // ---- 起動 ----
  applyLabels();
  active.show();
  setManual(document.hasFocus());

  // テスト・デバッグ用フック（UI からは使わない）
  window.__widget = {
    widgets,
    get mode() { return mode; },
    get active() { return active; },
    switchMode,
    setMode,
    setManual
  };
})();
