// ウィジェット共通コントローラ
// モード切替（2048 ⇄ ぷよぷよ）・フォーカスによる手動/AI 切替・
// ウィジェット複製・スコア表示・オーバーレイを一元管理する

(() => {
  const MODE_KEY = 'widget.mode';
  const MODE_ORDER = ['2048', 'puyo', 'invaders', 'bomber', 'tetris', 'snake', 'life', 'breakout', 'td', 'hero', 'pac', 'tron', 'fx'];
  const GAME_TITLES = { '2048': '2048', puyo: 'ぷよぷよ', invaders: 'インベーダー', bomber: 'ボンバーマン', tetris: 'テトリス', snake: 'スネーク', life: 'ライフゲーム', breakout: 'ブロック崩し', td: 'タワーディフェンス', hero: 'ヒーローのくせに生意気だ', pac: 'パックマン', tron: 'トロン', fx: 'FX ドル円' };
  const GAME_SHORT = { '2048': '2048', puyo: 'ぷよ', invaders: 'INV', bomber: 'ボム', tetris: 'テト', snake: 'スネク', life: 'ライフ', breakout: 'ブロック', td: 'TD', hero: '生意気', pac: 'パック', tron: 'トロン', fx: 'FX' };

  // 各ゲームの遊び方 / AI のアルゴリズム（？ボタンで表示）
  const HELP: Record<string, { how: string; ai: string }> = {
    '2048': { how: '矢印の方向に全タイルを寄せ、同じ数字どうしを合体させて大きな数を作る。2048 を超えても無限に続き、動けなくなると終了。', ai: 'Expectimax 探索。数手先まで読み、「空きマスの多さ・単調な並び・合体のしやすさ」で盤面を評価して期待値が最大の方向を選ぶ。' },
    puyo: { how: '4 色のぷよを操作して落とし、同色 4 つ以上で消去。消えた上から降ってきて連鎖が起こる。', ai: '各列の置き方を試して盤面を評価し、自己最大連鎖の更新を狙って土台を構築。記録を超える発火だけ優先し、死なない範囲で大連鎖を伸ばす。' },
    invaders: { how: '自機で敵編隊を撃ち、敵弾を避ける。全滅でレベルアップし敵が増え速く強くなる。', ai: '敵弾の軌道を予測して回避しつつ、最下段の敵から効率良く撃ち落として早期クリアを狙う。' },
    bomber: { how: '4 体が爆弾を置き合う対戦。爆風でブロックや相手を破壊し、最後の 1 体を目指す。', ai: '爆風の到達時間から危険マップを作って退避し、安全な逃げ道がある時だけ爆弾を設置する。' },
    tetris: { how: '落ちてくるブロックを積み、横一列を揃えて消す。積み切ると終了、ライン消去でレベルアップ。', ai: '全ての回転×位置を試し、「集約高さ・消去ライン数・穴・凸凹」を重み付け評価（El-Tetris 風）して最善手を選ぶ。' },
    snake: { how: '蛇が餌を食べて伸びる。壁や自分の体に当たると終了。', ai: '餌への最短路（BFS）を進みつつ、進んだ先に十分な空間が残るか（フラッドフィル）を確認して自滅を回避する。' },
    life: { how: 'コンウェイのライフゲーム。各セルは周囲の生存数で誕生/生存/死滅する（B3/S23）。', ai: 'AI ではなくセルオートマトン。停滞・全滅・周期ループを検出するとランダムに細胞を足して動きを復活させる。' },
    breakout: { how: 'パドルでボールを弾き、全ブロックを崩すとレベルアップ（速く・多く・硬く）。アイテムも出現。', ai: 'ボールの落下点へパドルを動かして受け、跳ね返す角度で最も低い未破壊ブロックを狙う。詰まりを検出して打開する。' },
    td: { how: '道を進む敵を、要所に建てた兵器で迎撃する。倒すと資金が増え、ウェーブで敵が強化される。', ai: '8 種の兵器を目標構成比に沿って選び、道のカバー数が多い要所へ建設・強化。高級兵器のために貯金もする。' },
    hero: { how: '破壊神となり岩を掘ってダンジョンを作る。湧いた魔物が自律して、侵入する勇者から魔王を守る。', ai: '養分の濃い壁の隣を掘って露出させ生態系（2 系統の食物連鎖）を育成＋戦力を補充。勇者は距離場で魔王へ誘導される。' },
    pac: { how: '迷路の餌を全て食べるとレベルアップ。幽霊に捕まると残機が減る。パワー餌中は幽霊を食べられる。', ai: '幽霊の近くを避けるコストを足した BFS で最寄りの餌へ。危険時はパワー餌で逆転するか逃走し、怯えた幽霊を狩る。' },
    tron: { how: '光の軌跡を残して走る対戦。壁・軌跡・他機に当たると爆散、最後の 1 機が勝ち。ラウンドで難化。', ai: '直進/左折/右折のうち、進んだ先から到達できる空きマスが最大になる手を選ぶ（フラッドフィルで自閉を回避）。' },
    fx: { how: '実際のドル円データでトレード。フッターの過去/ライブでモード切替、買/売/決済ボタンや矢印キーで人間も注文できる。確定損益は累計保存。', ai: '移動平均クロスで方向を予測（短期＞長期でロング、その逆でショート）。常に相場に張って収益最大化を狙う。' },
  };

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const infoEl = document.getElementById('games-count');
  const modeIndicatorEl = document.getElementById('mode-indicator');
  const overlayEl = document.getElementById('overlay');
  const overlayTitleEl = document.getElementById('overlay-title');
  const overlaySubEl = document.getElementById('overlay-sub');
  const modeSelectEl = document.getElementById('mode-select') as HTMLSelectElement;
  const addBtn = document.getElementById('add-btn');
  const closeBtn = document.getElementById('close-btn');
  const helpBtn = document.getElementById('help-btn');
  const helpEl = document.getElementById('help');
  const helpBodyEl = document.getElementById('help-body');
  const helpCloseEl = document.getElementById('help-close');

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
    invaders: window.createWidgetInvaders(ctx),
    bomber: window.createWidgetBomber(ctx),
    tetris: window.createWidgetTetris(ctx),
    snake: window.createWidgetSnake(ctx),
    life: window.createWidgetLife(ctx),
    breakout: window.createWidgetBreakout(ctx),
    td: window.createWidgetTD(ctx),
    hero: window.createWidgetHero(ctx),
    pac: window.createWidgetPac(ctx),
    tron: window.createWidgetTron(ctx),
    fx: window.createWidgetFX(ctx)
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
    if (helpEl.classList.contains('visible')) renderHelp();   // ヘルプ表示中はゲーム説明も更新
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

  const muteBtn = document.getElementById('mute-btn');
  function refreshMute() { muteBtn.textContent = window.SFX && window.SFX.isMuted() ? '🔇' : '🔊'; }
  muteBtn.addEventListener('click', () => {
    if (window.widgetAPI) window.widgetAPI.toggleMute();   // 全ウィジェット一括
    else if (window.SFX) { window.SFX.toggle(); refreshMute(); }
  });
  if (window.widgetAPI) {
    // メイン管理の一括ミュート状態に同期
    window.widgetAPI.onMutedChanged((m) => { if (window.SFX) window.SFX.setMuted(m); refreshMute(); });
    window.widgetAPI.getMuted().then((m) => { if (window.SFX) window.SFX.setMuted(m); refreshMute(); });
  }
  refreshMute();

  closeBtn.addEventListener('click', () => window.close());

  // 遊び方・AI 解説パネル
  function renderHelp() {
    const h = HELP[mode] || { how: '', ai: '' };
    helpBodyEl.innerHTML =
      `<span class="tag">遊び方・AI 解説</span>` +
      `<h2>${GAME_TITLES[mode]}</h2>` +
      `<h3>遊び方</h3><p>${h.how}</p>` +
      `<h3>AI のアルゴリズム</h3><p>${h.ai}</p>` +
      `<h3>操作</h3><p>クリックでフォーカスすると手動操作（矢印キー）。Space かフォーカスを外すと AI 自動運転に戻る。ヘッダーの ＋ で複製、？ でこのヘルプ表示。</p>`;
  }
  function toggleHelp(show?: boolean) {
    const on = show === undefined ? !helpEl.classList.contains('visible') : show;
    if (on) renderHelp();
    helpEl.classList.toggle('visible', on);
  }
  helpBtn.addEventListener('click', () => toggleHelp());
  helpCloseEl.addEventListener('click', () => toggleHelp(false));
  helpEl.addEventListener('click', (e) => { if (e.target === helpEl) toggleHelp(false); }); // 背景クリックで閉じる

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
