// デスクトップ猫の本体：行動エンジン・操作・吹き出し・メニュー
//
// Electron では透明ウィンドウ自体が猫と一緒に画面を移動する（catAPI 経由）。
// ブラウザで開いた場合はページ内を仮想デスクトップとして動くフォールバック。
//
// 将来のイベント連携：localStorage の 'cat.eventPing' に {type, ts} を書くと
// 全ての猫が storage イベント経由で反応する（cat-settings.js のテストボタン参照）。

(() => {
  const SETTINGS_KEY = 'cat.settings';
  const EVENT_KEY = 'cat.eventPing';

  const DEFAULTS = {
    type: 'mike',
    name: 'たま',
    scale: 1,
    follow: true,
    alwaysOnTop: true,
    autostart: false,
    notify: true
  };

  const CLICK_LINES = ['にゃー', 'にゃ?', 'ゴロゴロ…', 'なでて', 'にゃーん♪'];
  const MUTTER_LINES = ['…', 'じーっ', 'ひまだにゃ', 'おつかれさま', 'なんか見つけたにゃ'];

  let S = loadSettings();

  function loadSettings() {
    try {
      return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
    } catch { return { ...DEFAULTS }; }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
  }

  // ---- DOM ----
  const rootEl = document.getElementById('cat-root');
  const canvas = document.getElementById('cat-canvas');
  const g2d = canvas.getContext('2d');
  const bubbleEl = document.getElementById('bubble');
  const menuEl = document.getElementById('menu');

  const dpr = window.devicePixelRatio || 1;
  function applyScale() {
    canvas.width = CatSprite.W * dpr;
    canvas.height = CatSprite.H * dpr;
    canvas.style.width = `${CatSprite.W * S.scale}px`;
    canvas.style.height = `${CatSprite.H * S.scale}px`;
  }

  function typeCfg() {
    return CAT_TYPES.find((t) => t.id === S.type) || CAT_TYPES[0];
  }

  // ---- ステージアダプタ（Electron: ウィンドウ移動 / ブラウザ: ページ内移動） ----
  const isApp = !!window.catAPI;
  let pos = { x: 100, y: 100 };  // ウィンドウ（またはルート要素）の左上
  let winW = 190, winH = 230;
  let wa = { x: 0, y: 0, width: 1440, height: 800 };
  let cursor = { x: -9999, y: -9999 };

  async function initStage() {
    if (isApp) {
      const info = await catAPI.info();
      pos = { x: info.bounds.x, y: info.bounds.y };
      winW = info.bounds.width; winH = info.bounds.height;
      wa = info.workArea;
      setInterval(async () => { cursor = await catAPI.cursor(); }, 140);
    } else {
      wa = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
      window.addEventListener('resize', () => {
        wa = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
      });
      window.addEventListener('mousemove', (e) => {
        cursor = { x: e.clientX, y: e.clientY };
      });
      rootEl.style.position = 'fixed';
      pos = { x: wa.width * 0.5, y: wa.height - winH };
    }
    moveTo(pos.x, pos.y, true);
  }

  let lastMoveSent = 0;
  function moveTo(x, y, force) {
    pos.x = Math.max(wa.x, Math.min(wa.x + wa.width - winW, x));
    pos.y = Math.max(wa.y, Math.min(wa.y + wa.height - winH, y));
    const now = performance.now();
    if (!force && now - lastMoveSent < 33) return;
    lastMoveSent = now;
    if (isApp) catAPI.moveTo(Math.round(pos.x), Math.round(pos.y));
    else {
      rootEl.style.left = `${pos.x}px`;
      rootEl.style.top = `${pos.y}px`;
    }
  }

  // 猫の中心（画面座標）
  const catCX = () => pos.x + winW / 2;
  const catCY = () => pos.y + winH - 60 * S.scale;

  // ---- 行動エンジン ----
  let state = 'idle';      // idle | walk | chase | flee | sleep | react | held
  let mood = 'normal';     // normal | happy | sleepy | curious | grumpy
  let energy = 80;
  let stateT = 0;          // 現在の状態の経過秒
  let stateDur = 2;        // 状態の予定継続時間
  let dir = 1;
  let walkTarget = null;
  let speed = 40;
  let lastInteraction = Date.now();
  let heartT = -10, sweatT = -10, perkT = -10;
  let prevTs = performance.now();

  function setState(s, dur) {
    state = s;
    stateT = 0;
    stateDur = dur;
  }

  function decide() {
    const idleMin = (Date.now() - lastInteraction) / 60000;
    // 気分のゆらぎ
    const r = Math.random();
    if (energy < 30 || idleMin > 3) mood = 'sleepy';
    else if (r < 0.18) mood = 'curious';
    else if (r < 0.26) mood = 'grumpy';
    else if (r < 0.5) mood = 'normal';

    if (mood === 'sleepy') { setState('sleep', 18 + Math.random() * 25); return; }
    if (mood === 'curious' && S.follow && Math.random() < 0.6) {
      setState('chase', 4 + Math.random() * 4);
      speed = 95;
      return;
    }
    if (Math.random() < 0.45) {
      walkTarget = {
        x: wa.x + Math.random() * (wa.width - winW),
        y: wa.y + Math.max(0, wa.height * 0.3) + Math.random() * (wa.height * 0.7 - winH)
      };
      speed = 42;
      setState('walk', 12);
      return;
    }
    if (Math.random() < 0.18) say(MUTTER_LINES[Math.floor(Math.random() * MUTTER_LINES.length)]);
    setState('idle', 2.5 + Math.random() * 4);
  }

  function update(dt) {
    stateT += dt;
    energy = Math.max(0, Math.min(100, energy + (state === 'sleep' ? 0.8 : -0.012) * dt * 10));

    const dx = cursor.x - catCX();
    const dy = cursor.y - catCY();
    const cursorDist = Math.hypot(dx, dy);

    // 不機嫌なときはカーソルから逃げる（睡眠・ドラッグ中以外）
    if (mood === 'grumpy' && cursorDist < 130 && !['sleep', 'held', 'flee', 'react'].includes(state)) {
      setState('flee', 2.2);
      speed = 130;
    }

    switch (state) {
      case 'walk': {
        if (!walkTarget) { setState('idle', 2); break; }
        const tx = walkTarget.x - pos.x, ty = walkTarget.y - pos.y;
        const d = Math.hypot(tx, ty);
        if (d < 8 || stateT > stateDur) { walkTarget = null; decide(); break; }
        dir = tx >= 0 ? 1 : -1;
        moveTo(pos.x + (tx / d) * speed * dt, pos.y + (ty / d) * speed * dt);
        break;
      }
      case 'chase': {
        if (!S.follow || stateT > stateDur) { decide(); break; }
        if (cursorDist > 46) {
          dir = dx >= 0 ? 1 : -1;
          moveTo(pos.x + (dx / cursorDist) * speed * dt,
                 pos.y + (dy / cursorDist) * speed * dt);
        }
        break;
      }
      case 'flee': {
        if (stateT > stateDur || cursorDist > 240) { setState('idle', 2); break; }
        if (cursorDist > 1) {
          dir = dx >= 0 ? -1 : 1;
          moveTo(pos.x - (dx / cursorDist) * speed * dt,
                 pos.y - (dy / cursorDist) * speed * dt);
        }
        break;
      }
      case 'sleep': {
        if (stateT > stateDur && energy > 60) { mood = 'normal'; decide(); }
        break;
      }
      case 'react': {
        if (stateT > stateDur) { setState('idle', 2); }
        break;
      }
      case 'held':
        break;
      default: { // idle
        if (stateT > stateDur) decide();
      }
    }
  }

  function frameSpec(now) {
    const t = now / 1000;
    const dxc = cursor.x - catCX();
    const cursorNear = Math.hypot(dxc, cursor.y - catCY()) < 90 * S.scale + 40;

    let pose = 'sit', eyes = 'open';
    if (state === 'walk' || state === 'chase' || state === 'flee') pose = 'walk';
    if (state === 'sleep') pose = 'sleep';
    if (state === 'react') pose = 'react';

    if (state === 'sleep') eyes = 'closed';
    else if (state === 'react' || mood === 'happy') eyes = 'happy';
    else if (mood === 'grumpy') eyes = 'line';
    else if (state === 'held') eyes = 'wide';
    else if (Math.sin(t * 0.7) > 0.985) eyes = 'closed'; // まばたき

    return {
      pose,
      t,
      dir,
      eyes,
      earPerk: (cursorNear || t - perkT < 1.2) ? 1 : 0,
      lookX: cursorNear ? Math.max(-1, Math.min(1, dxc / 120)) * dir : 0,
      jump: state === 'react' ? Math.abs(Math.sin(stateT * Math.PI / Math.max(stateDur, 0.4))) : 0,
      heart: t - heartT < 1.6,
      sweat: t - sweatT < 3.5,
      zzz: state === 'sleep'
    };
  }

  function loop(now) {
    const dt = Math.min(0.1, (now - prevTs) / 1000);
    prevTs = now;
    if (state !== 'held') update(dt);
    g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    CatSprite.drawCat(g2d, typeCfg(), frameSpec(now));
    requestAnimationFrame(loop);
  }

  // ---- 吹き出し ----
  let bubbleTimer = null;
  function say(text, ms = 2600) {
    bubbleEl.textContent = text;
    bubbleEl.classList.add('visible');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove('visible'), ms);
  }

  // ---- インタラクション ----
  let dragging = false, dragMoved = false, grabOff = { x: 0, y: 0 };

  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    dragMoved = false;
    grabOff = { x: e.screenX - pos.x, y: e.screenY - pos.y };
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    // Electron はウィンドウごと動かすので画面座標、ブラウザはページ内座標
    const nx = isApp ? e.screenX - grabOff.x : e.clientX - winW / 2;
    const ny = isApp ? e.screenY - grabOff.y : e.clientY - winH + 50;
    if (!dragMoved && Math.hypot(nx - pos.x, ny - pos.y) > 6) {
      dragMoved = true;
      setState('held', 999);
    }
    if (dragMoved) moveTo(nx, ny);
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    if (dragMoved) { setState('idle', 2); return; }
    onClick();
  });

  let lastClickTs = 0;
  function onClick() {
    lastInteraction = Date.now();
    const now = performance.now();
    if (now - lastClickTs < 350) { lastClickTs = 0; openMenu(); return; }
    lastClickTs = now;

    if (state === 'sleep') {
      setState('idle', 3);
      say('…にゃ!? 起きたにゃ');
      return;
    }
    mood = 'happy';
    energy = Math.min(100, energy + 5);
    heartT = now / 1000;
    setState('react', 0.9);
    say(CLICK_LINES[Math.floor(Math.random() * CLICK_LINES.length)]);
    setTimeout(() => { if (mood === 'happy') mood = 'normal'; }, 6000);
  }

  // ---- メニュー ----
  function openMenu() {
    menuEl.innerHTML = '';
    const items = [
      ['🐱 猫を変更', () => {
        const i = CAT_TYPES.findIndex((t) => t.id === S.type);
        S.type = CAT_TYPES[(i + 1) % CAT_TYPES.length].id;
        saveSettings();
        say(`${typeCfg().name}になったにゃ`);
      }],
      ['✏️ 名前・設定…', () => openSettings()],
      [state === 'sleep' ? '⏰ 起こす' : '💤 寝かせる', () => {
        if (state === 'sleep') { setState('idle', 3); say('おはようにゃ'); }
        else { setState('sleep', 9999); say('おやすみにゃ…'); }
      }],
      ['➕ もう 1 匹', () => {
        if (isApp) catAPI.newCat();
        else window.open(location.pathname, '_blank', 'width=190,height=230');
      }],
      ['❌ さよなら', () => window.close()]
    ];
    for (const [label, fn] of items) {
      const div = document.createElement('div');
      div.className = 'menu-item';
      div.textContent = label;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        fn();
      });
      menuEl.appendChild(div);
    }
    menuEl.classList.add('visible');
  }

  function closeMenu() {
    menuEl.classList.remove('visible');
  }

  document.addEventListener('click', (e) => {
    if (!menuEl.contains(e.target) && e.target !== canvas) closeMenu();
  });

  function openSettings() {
    if (isApp) catAPI.openSettings();
    else window.open('cat-settings.html', '_blank', 'width=320,height=560');
  }

  // ---- 設定変更・イベント（storage イベントをバスとして使う） ----
  window.addEventListener('storage', (e) => {
    if (e.key === SETTINGS_KEY) {
      const prevAot = S.alwaysOnTop;
      S = loadSettings();
      applyScale();
      if (isApp && S.alwaysOnTop !== prevAot) catAPI.setAlwaysOnTop(S.alwaysOnTop);
    }
    if (e.key === EVENT_KEY && e.newValue) {
      try { handleEvent(JSON.parse(e.newValue).type); } catch {}
    }
  });

  function handleEvent(type) {
    if (!S.notify) return;
    lastInteraction = Date.now();
    const now = performance.now() / 1000;
    switch (type) {
      case 'task-start':
        mood = 'curious';
        say('お仕事はじめるにゃ');
        walkTarget = { x: wa.x + Math.random() * (wa.width - winW), y: pos.y };
        speed = 110;
        setState('walk', 6);
        break;
      case 'task-done':
        mood = 'happy';
        heartT = now;
        setState('react', 1.2);
        say('完了したにゃ！えらいにゃ！');
        break;
      case 'error':
        sweatT = now;
        mood = 'grumpy';
        say('にゃ!? エラーだにゃ…');
        setState('idle', 4);
        break;
      case 'message':
        perkT = now;
        say('なんか来たにゃ');
        break;
      case 'idle-long':
        say('ちょっと休むにゃ…');
        setState('sleep', 30);
        break;
    }
  }

  // 公開 API（将来の AI エージェント連携用）：window.catEvent('task-done') など
  window.catEvent = handleEvent;

  // ---- 起動 ----
  applyScale();
  if (isApp && S.alwaysOnTop === false) catAPI.setAlwaysOnTop(false);
  initStage().then(() => {
    say(`${S.name}だにゃ`, 2000);
    decide();
    requestAnimationFrame(loop);
  });

  // テスト用フック
  window.__cat = {
    get state() { return state; },
    get mood() { return mood; },
    get pos() { return { ...pos }; },
    setState, decide, handleEvent, say,
    settings: () => S,
    setType(id) { S.type = id; saveSettings(); applyScale(); }
  };
})();
