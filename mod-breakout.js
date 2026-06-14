// ブロック崩し ウィジェットモジュール（AI 自動プレイ・レベルアップ・アイテム・モダン演出）
//
// ・AI がパドルでボールを受け、ブロックを全部消すとレベルアップ（速く・多く・硬く）。
// ・開始レベルはフッターの −/＋ で指定可。一定レベル以降はステージをランダム生成。
// ・アイテム：分裂（マルチボール）/ ボール巨大化 / パドル拡大 / 残機 + / スロー。
// ・モダンな演出：ボールの残像・グロー・ブロック破壊のパーティクル・レベルアップ表示。

window.createWidgetBreakout = function (ctx) {
  const FW = 100, FH = 134;
  const TICK_MS = 16;            // ≈60fps（なめらかなボール）
  const RESTART_TICKS = Math.round(1500 / TICK_MS);
  const RANDOM_FROM = 5;         // このレベル以降はランダムステージ
  const COLS = 9;
  const START_KEY = 'widgetBreakout.startLevel';
  const BEST_KEY = 'widgetBreakout.best';

  const wrapEl = document.getElementById('breakout');
  const canvas = document.getElementById('breakout-canvas');
  const g2d = canvas.getContext('2d');
  const ctrlEl = document.getElementById('breakout-ctrl');
  const lvLabelEl = document.getElementById('breakout-lv-label');

  const PADDLE_Y = FH - 7, PADDLE_W0 = 18, PADDLE_H = 3, BALL_R0 = 1.7;

  let startLevel = Math.max(1, Number(localStorage.getItem(START_KEY) || 1));
  let level = startLevel, score = 0, lives = 3;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let paddle = { x: FW / 2, w: PADDLE_W0 };
  let balls = [], bricks = [], items = [], particles = [];
  let state = 'play';           // play | levelup | gameover
  let auto = false, timer = null;
  let restartCountdown = -1, levelupTicks = 0, slowTimer = 0;
  let flash = 0;                // 画面フラッシュ（被弾/レベルアップ）
  let aimT = 0;                 // AI が受ける位置を振るための位相

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function ballSpeed() { return Math.min(165, 60 + level * 4.5); }
  function paddleSpeed() { return 72 + level * 2.6; }
  function rowsForLevel(lv) { return Math.min(3 + Math.floor(lv / 2), 7); }

  function spawnBall(onPaddle) {
    const sp = ballSpeed();
    const ang = rnd(-0.5, 0.5) - Math.PI / 2; // 上向き
    balls.push({
      x: onPaddle ? paddle.x : rnd(20, FW - 20),
      y: PADDLE_Y - 3,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      r: BALL_R0, trail: []
    });
  }

  function buildLevel() {
    bricks = []; items = []; particles = [];
    const rows = rowsForLevel(level);
    const gap = 0.8;
    const bw = (FW - 6) / COLS;
    const bh = 4.2;
    const top = 10;
    const maxHp = Math.min(3, 1 + Math.floor(level / 4));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        let alive = true, hp = 1;
        if (level >= RANDOM_FROM) {
          alive = Math.random() < 0.68;
          hp = 1 + (Math.random() < (level - RANDOM_FROM + 1) * 0.08 ? Math.floor(rnd(1, maxHp + 1)) : 0);
        } else {
          hp = (level >= 3 && r === 0) ? 2 : 1;
        }
        if (!alive) continue;
        bricks.push({
          x: 3 + c * bw, y: top + r * (bh + gap), w: bw - gap, h: bh,
          hp, maxhp: hp, hue: (r * 40 + 200) % 360
        });
      }
    }
    if (bricks.length < 6) buildLevel(); // 少なすぎたら作り直し
  }

  function startLevelPlay(resetLives) {
    paddle = { x: FW / 2, w: PADDLE_W0 };
    balls = [];
    spawnBall(true);
    slowTimer = 0;
    if (resetLives) lives = 3;
    buildLevel();
    state = 'play';
    levelupTicks = 0;
    updateScores();
    updateLvLabel();
  }

  function newGame() {
    level = startLevel; score = 0;
    restartCountdown = -1;
    ctx.hideOverlay();
    startLevelPlay(true);
    render();
  }

  function updateScores() {
    if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
    ctx.setScores(score, best, `Lv.${level} ・♥${lives}`);
  }
  function updateLvLabel() { lvLabelEl.textContent = `開始Lv ${startLevel}`; }

  // ---- アイテム ----
  const ITEMS = [
    { t: 'multi', w: 30, col: '#e74c3c', ch: 'M' },
    { t: 'big', w: 18, col: '#f39c12', ch: 'B' },
    { t: 'wide', w: 18, col: '#3498db', ch: 'W' },
    { t: 'life', w: 10, col: '#2ecc71', ch: '+' },
    { t: 'slow', w: 18, col: '#9b59b6', ch: 'S' }
  ];
  function maybeDropItem(x, y) {
    if (Math.random() > 0.14) return;
    const total = ITEMS.reduce((a, i) => a + i.w, 0);
    let r = Math.random() * total, pick = ITEMS[0];
    for (const it of ITEMS) { if ((r -= it.w) <= 0) { pick = it; break; } }
    items.push({ x, y, vy: 30, type: pick.t, col: pick.col, ch: pick.ch });
  }
  function applyItem(type) {
    flash = 1;
    if (type === 'multi') {
      const cur = balls.slice();
      for (const b of cur) {
        if (balls.length >= 8) break;
        const sp = Math.hypot(b.vx, b.vy), a = Math.atan2(b.vy, b.vx) + rnd(-0.6, 0.6);
        balls.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: b.r, trail: [] });
      }
    } else if (type === 'big') {
      for (const b of balls) b.r = Math.min(3.4, b.r * 1.4);
    } else if (type === 'wide') {
      paddle.w = Math.min(38, paddle.w * 1.4);
    } else if (type === 'life') {
      lives = Math.min(6, lives + 1); updateScores();
    } else if (type === 'slow') {
      slowTimer = 5;
    }
  }

  function burst(x, y, hue) {
    for (let i = 0; i < 9; i++) {
      const a = rnd(0, Math.PI * 2), s = rnd(8, 34);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, life: rnd(0.3, 0.6), col: `hsl(${hue},75%,60%)` });
    }
  }

  // ---- 物理 ----
  function moveBall(b, dt) {
    const steps = 3, h = dt / steps;
    for (let s = 0; s < steps; s++) {
      b.x += b.vx * h; b.y += b.vy * h;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
      if (b.x > FW - b.r) { b.x = FW - b.r; b.vx = -Math.abs(b.vx); }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); }
      // パドル
      if (b.vy > 0 && b.y + b.r >= PADDLE_Y && b.y - b.r <= PADDLE_Y + PADDLE_H &&
          b.x >= paddle.x - paddle.w / 2 - b.r && b.x <= paddle.x + paddle.w / 2 + b.r) {
        const off = (b.x - paddle.x) / (paddle.w / 2); // -1..1
        const sp = ballSpeed();
        const ang = -Math.PI / 2 + clamp(off, -1, 1) * 1.05;
        b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp;
        b.y = PADDLE_Y - b.r - 0.1;
      }
      // ブロック
      for (const br of bricks) {
        if (!br.hp) continue;
        if (b.x + b.r < br.x || b.x - b.r > br.x + br.w || b.y + b.r < br.y || b.y - b.r > br.y + br.h) continue;
        // めり込みの浅い軸で反射
        const ox = Math.min(b.x + b.r - br.x, br.x + br.w - (b.x - b.r));
        const oy = Math.min(b.y + b.r - br.y, br.y + br.h - (b.y - b.r));
        if (ox < oy) b.vx = -b.vx; else b.vy = -b.vy;
        br.hp--;
        score += 10 * level;
        if (br.hp <= 0) {
          burst(br.x + br.w / 2, br.y + br.h / 2, br.hue);
          maybeDropItem(br.x + br.w / 2, br.y + br.h / 2);
        }
        updateScores();
        break;
      }
    }
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 7) b.trail.shift();
  }

  function tick() {
    const dt = TICK_MS / 1000;
    if (flash > 0) flash = Math.max(0, flash - dt * 3);

    if (state === 'gameover') {
      if (auto && restartCountdown >= 0 && --restartCountdown <= 0) newGame();
      render(); return;
    }
    if (state === 'levelup') {
      if (--levelupTicks <= 0) { level++; startLevelPlay(false); }
      render(); return;
    }

    if (slowTimer > 0) slowTimer -= dt;
    const bdt = dt * (slowTimer > 0 ? 0.62 : 1);

    // パドル（AI / 手動）
    if (auto) {
      let best = null, bestY = -1;
      for (const b of balls) if (b.vy > 0 && b.y > bestY) { bestY = b.y; best = b; }
      let tgt = paddle.x;
      if (best) {
        // 受ける位置を中央から振って跳ね返り角を散らす（縦トンネル防止）
        const off = 0.6 * Math.sin(aimT);
        tgt = predictX(best) - off * (paddle.w / 2);
      }
      aimT += dt * 1.7;
      const sp = paddleSpeed();
      paddle.x += clamp(tgt - paddle.x, -sp * dt, sp * dt);
    }
    paddle.x = clamp(paddle.x, paddle.w / 2, FW - paddle.w / 2);

    for (const b of balls) moveBall(b, bdt);
    balls = balls.filter((b) => b.y - b.r < FH);
    if (balls.length === 0) {
      lives--;
      updateScores();
      if (lives <= 0) { gameOver(); render(); return; }
      flash = 1; spawnBall(true);
    }

    // アイテム
    for (const it of items) it.y += it.vy * dt;
    for (const it of items) {
      if (it.y >= PADDLE_Y - 1 && it.y <= PADDLE_Y + PADDLE_H + 2 &&
          it.x >= paddle.x - paddle.w / 2 && it.x <= paddle.x + paddle.w / 2) {
        applyItem(it.type); it.dead = true;
      }
    }
    items = items.filter((it) => !it.dead && it.y < FH);

    // パーティクル
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);

    // クリア判定
    if (bricks.every((br) => br.hp <= 0)) {
      state = 'levelup';
      levelupTicks = Math.round(900 / TICK_MS);
      flash = 1;
      ctx.showOverlay(`LEVEL ${level + 1}`, 'クリア！');
    }
    render();
  }

  function predictX(b) {
    if (b.vy <= 0) return b.x;
    const t = (PADDLE_Y - b.r - b.y) / b.vy;
    if (t < 0) return b.x;
    let x = b.x + b.vx * t;
    const span = FW;
    let m = ((x % (2 * span)) + 2 * span) % (2 * span);
    if (m > span) m = 2 * span - m;
    return m;
  }

  function gameOver() {
    state = 'gameover';
    restartCountdown = RESTART_TICKS;
    ctx.showOverlay('GAME OVER', auto ? `Lv.${level} ・自動リスタート…` : `Lv.${level} ・キーで再開`);
  }

  // ---- 描画 ----
  let scale = 3, offX = 0, offY = 0;
  function relayout() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    scale = Math.min(canvas.width / FW, canvas.height / FH);
    offX = (canvas.width - FW * scale) / 2;
    offY = (canvas.height - FH * scale) / 2;
    render();
  }
  const sx = (x) => offX + x * scale, sy = (y) => offY + y * scale;

  function roundRect(x, y, w, h, r) {
    g2d.beginPath();
    g2d.moveTo(x + r, y);
    g2d.arcTo(x + w, y, x + w, y + h, r);
    g2d.arcTo(x + w, y + h, x, y + h, r);
    g2d.arcTo(x, y + h, x, y, r);
    g2d.arcTo(x, y, x + w, y, r);
    g2d.closePath();
  }

  function render() {
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    // 背景（縦グラデ）
    const grad = g2d.createLinearGradient(0, offY, 0, offY + FH * scale);
    grad.addColorStop(0, '#10131f'); grad.addColorStop(1, '#1b2030');
    g2d.fillStyle = grad;
    g2d.fillRect(offX, offY, FW * scale, FH * scale);

    // ブロック
    for (const br of bricks) {
      if (br.hp <= 0) continue;
      const dim = br.hp < br.maxhp ? 38 : 52;
      g2d.fillStyle = `hsl(${br.hue},70%,${dim}%)`;
      roundRect(sx(br.x), sy(br.y), br.w * scale, br.h * scale, scale * 0.8);
      g2d.fill();
      g2d.fillStyle = 'rgba(255,255,255,0.22)';
      g2d.fillRect(sx(br.x) + scale * 0.4, sy(br.y) + scale * 0.4, (br.w - 0.8) * scale, br.h * scale * 0.28);
    }

    // パーティクル
    for (const p of particles) {
      g2d.globalAlpha = Math.max(0, p.life * 2);
      g2d.fillStyle = p.col;
      g2d.fillRect(sx(p.x) - scale * 0.5, sy(p.y) - scale * 0.5, scale, scale);
    }
    g2d.globalAlpha = 1;

    // アイテム（グロー）
    for (const it of items) {
      g2d.save();
      g2d.shadowColor = it.col; g2d.shadowBlur = scale * 2.5;
      g2d.fillStyle = it.col;
      roundRect(sx(it.x) - scale * 2.2, sy(it.y) - scale * 1.6, scale * 4.4, scale * 3.2, scale * 0.8);
      g2d.fill();
      g2d.restore();
      g2d.fillStyle = '#fff';
      g2d.font = `bold ${Math.floor(scale * 2.4)}px sans-serif`;
      g2d.textAlign = 'center'; g2d.textBaseline = 'middle';
      g2d.fillText(it.ch, sx(it.x), sy(it.y) + scale * 0.1);
      g2d.textAlign = 'left'; g2d.textBaseline = 'alphabetic';
    }

    // パドル（グロー）
    g2d.save();
    g2d.shadowColor = '#4ad0ff'; g2d.shadowBlur = scale * 2.5;
    g2d.fillStyle = '#7fe3ff';
    roundRect(sx(paddle.x - paddle.w / 2), sy(PADDLE_Y), paddle.w * scale, PADDLE_H * scale, PADDLE_H * scale / 2);
    g2d.fill();
    g2d.restore();

    // ボール（残像＋グロー）
    for (const b of balls) {
      for (let i = 0; i < b.trail.length; i++) {
        const t = b.trail[i];
        g2d.globalAlpha = (i / b.trail.length) * 0.4;
        g2d.fillStyle = '#bfefff';
        g2d.beginPath(); g2d.arc(sx(t.x), sy(t.y), b.r * scale * (i / b.trail.length), 0, Math.PI * 2); g2d.fill();
      }
      g2d.globalAlpha = 1;
      g2d.save();
      g2d.shadowColor = '#9fe8ff'; g2d.shadowBlur = scale * 2.5;
      g2d.fillStyle = '#ffffff';
      g2d.beginPath(); g2d.arc(sx(b.x), sy(b.y), b.r * scale, 0, Math.PI * 2); g2d.fill();
      g2d.restore();
    }

    // フラッシュ
    if (flash > 0) {
      g2d.fillStyle = `rgba(255,255,255,${flash * 0.18})`;
      g2d.fillRect(offX, offY, FW * scale, FH * scale);
    }
  }

  function setStart(lv) {
    startLevel = clamp(lv, 1, 30);
    localStorage.setItem(START_KEY, String(startLevel));
    newGame();
  }
  document.getElementById('breakout-minus').addEventListener('click', () => setStart(startLevel - 1));
  document.getElementById('breakout-plus').addEventListener('click', () => setStart(startLevel + 1));

  // ---- 共通インターフェース ----
  return {
    name: 'breakout',
    show() {
      wrapEl.style.display = 'flex';
      ctrlEl.style.display = 'inline-flex';
      if (bricks.length === 0) newGame();
      relayout();
      updateScores(); updateLvLabel();
      if (timer === null) timer = setInterval(tick, TICK_MS);
    },
    hide() {
      clearInterval(timer); timer = null;
      wrapEl.style.display = 'none';
      ctrlEl.style.display = 'none';
    },
    setAuto(on) { auto = on; },
    key(e) {
      if (state === 'gameover') { newGame(); return true; }
      const sp = 7;
      if (e.key === 'ArrowLeft') paddle.x = clamp(paddle.x - sp, paddle.w / 2, FW - paddle.w / 2);
      else if (e.key === 'ArrowRight') paddle.x = clamp(paddle.x + sp, paddle.w / 2, FW - paddle.w / 2);
      else return false;
      return true;
    },
    relayout, reset: newGame, isOver: () => state === 'gameover',
    _tick: tick,
    _balls: () => balls.map((b) => ({ x: +b.x.toFixed(1), y: +b.y.toFixed(1), vx: +b.vx.toFixed(1), vy: +b.vy.toFixed(1) })),
    _state: () => ({ state, level, startLevel, score, lives, auto,
                     balls: balls.length, bricks: bricks.filter((b) => b.hp > 0).length,
                     items: items.length })
  };
};
