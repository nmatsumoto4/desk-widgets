// タワーディフェンス ウィジェットモジュール（AI 自動防衛・多兵器・レベルで難化・ドット絵＋演出）
//
// ・細かいマス目の盤面に蛇行する道。敵が入口→出口へ歩く。出口到達でライフ減。
// ・AI が所持金で道沿いにタワー（兵器）を建設・強化し、自動で迎撃し続ける。
// ・ウェーブ（レベル）を重ねるほど敵が増え・固く・速く・多彩になる。ライフ 0 で自動リスタート。
// ・兵器は多種（アロー/キャノン/フロスト/レーザー/スナイパー/テスラ/ミサイル/ポイズン）。

window.createWidgetTD = function (ctx) {
  const TICK_MS = 33;
  const CELL_TARGET = 15;      // 1 マス目安 px（小さめ＝細かい盤面）
  const RESTART_TICKS = Math.round(1600 / TICK_MS);
  const BEST_KEY = 'widgetTD.bestWave';

  const wrapEl = document.getElementById('td');
  const canvas = document.getElementById('td-canvas');
  const g2d = canvas.getContext('2d');

  // 兵器（タワー）の種類
  const TOWERS = {
    arrow:  { name: 'アロー',   cost: 45,  range: 3.0, dmg: 7,  rate: 0.45, mode: 'proj',  color: '#7fd8ff', proj: '#d6f2ff' },
    cannon: { name: 'キャノン', cost: 85,  range: 2.9, dmg: 20, rate: 1.3,  mode: 'proj',  color: '#e0843a', proj: '#ffc070', splash: 1.4 },
    frost:  { name: 'フロスト', cost: 70,  range: 2.6, dmg: 2,  rate: 0.5,  mode: 'aura',  color: '#6fe6e6', slow: 0.55 },
    laser:  { name: 'レーザー', cost: 120, range: 3.3, dmg: 4,  rate: 0.07, mode: 'beam',  color: '#ff5fa6' },
    sniper: { name: 'スナイパー', cost: 130, range: 6.2, dmg: 46, rate: 1.7, mode: 'proj', color: '#b78bff', proj: '#e6d2ff' },
    tesla:  { name: 'テスラ',   cost: 150, range: 2.9, dmg: 15, rate: 0.95, mode: 'chain', color: '#ffe14d', chain: 3 },
    missile:{ name: 'ミサイル', cost: 190, range: 4.8, dmg: 34, rate: 2.0,  mode: 'proj',  color: '#aab0b8', proj: '#ffd6d6', splash: 1.7, homing: true },
    poison: { name: 'ポイズン', cost: 100, range: 2.8, dmg: 3,  rate: 1.0,  mode: 'proj',  color: '#8fc04c', proj: '#c4e878', dot: 7 }
  };
  const TOWER_KEYS = Object.keys(TOWERS);
  // AI が目指す兵器構成比（多彩さを保証する）
  const TARGET = { arrow: 0.26, cannon: 0.16, frost: 0.10, poison: 0.11, laser: 0.12, tesla: 0.10, sniper: 0.09, missile: 0.06 };

  // 敵の種類
  const ENEMIES = {
    basic: { hp: 22,  speed: 2.3, bounty: 7,   color: '#e85a5a', r: 0.34 },
    fast:  { hp: 15,  speed: 4.3, bounty: 9,   color: '#f0c64a', r: 0.30 },
    tank:  { hp: 90,  speed: 1.5, bounty: 20,  color: '#8a78d6', r: 0.44 },
    swarm: { hp: 8,   speed: 3.0, bounty: 4,   color: '#5fd07a', r: 0.24 },
    boss:  { hp: 650, speed: 1.2, bounty: 130, color: '#d24fa0', r: 0.6 }
  };

  let COLS = 18, ROWS = 24;
  let path = [], pathSet = new Set(), buildSpots = [];
  let towers = [], enemies = [], projectiles = [], particles = [], beams = [];
  let money = 0, lives = 0, level = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let toSpawn = [], spawnCd = 0, aiCd = 0, clock = 0;
  let state = 'play';         // play | gameover
  let restartCountdown = -1;
  let auto = false, timer = null;

  const key = (r, c) => r * COLS + c;
  const inB = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  // ---- 盤面・道の生成（蛇行）----
  function buildPath() {
    path = []; pathSet = new Set();
    const add = (r, c) => { if (inB(r, c) && !pathSet.has(key(r, c))) { path.push({ r, c }); pathSet.add(key(r, c)); } };
    const rowsList = [];
    for (let r = 2; r < ROWS - 2; r += 3) rowsList.push(r);
    let right = true;
    for (let i = 0; i < rowsList.length; i++) {
      const r = rowsList[i];
      const from = right ? 1 : COLS - 2, to = right ? COLS - 2 : 1, dir = right ? 1 : -1;
      for (let c = from; right ? c <= to : c >= to; c += dir) add(r, c);
      if (i < rowsList.length - 1) { const nr = rowsList[i + 1]; for (let rr = r + 1; rr <= nr; rr++) add(rr, to); }
      right = !right;
    }
    // 建設可能：道に隣接する非道セル
    buildSpots = [];
    const seen = new Set();
    for (const p of path) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const r = p.r + dr, c = p.c + dc;
        if (!inB(r, c) || pathSet.has(key(r, c)) || seen.has(key(r, c))) continue;
        seen.add(key(r, c)); buildSpots.push({ r, c });
      }
    }
    // 各建設マスの「要所度」＝周辺(±2)に通る道セル数。AI が要所を優先設置するのに使う
    for (const s of buildSpots) {
      let cov = 0;
      for (const p of path) if (Math.abs(p.r - s.r) <= 2 && Math.abs(p.c - s.c) <= 2) cov++;
      s.cov = cov;
    }
  }

  function newGame() {
    towers = []; enemies = []; projectiles = []; particles = []; beams = [];
    money = 130; lives = 20; level = 0;
    state = 'play'; restartCountdown = -1;
    buildPath();
    nextWave();
    updateScores();
    render();
  }

  function nextWave() {
    level++;
    if (level > best) { best = level; localStorage.setItem(BEST_KEY, String(best)); }
    money += 25 + level * 6;          // ウェーブクリアボーナス
    const n = Math.min(6 + level * 2, 44);
    toSpawn = [];
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      let t = 'basic';
      if (level >= 7 && roll < 0.28) t = 'swarm';
      else if (level >= 5 && roll < 0.45) t = 'tank';
      else if (level >= 3 && roll < 0.62) t = 'fast';
      toSpawn.push(t);
    }
    if (level % 5 === 0) toSpawn.push('boss');
    spawnCd = 0.4;
    updateScores();
  }

  function spawnEnemy(type) {
    const def = ENEMIES[type];
    const hpScale = 1 + level * 0.26;
    enemies.push({
      type, def, hp: def.hp * hpScale, maxhp: def.hp * hpScale,
      t: 0, x: path[0].c + 0.5, y: path[0].r + 0.5, slowT: 0
    });
  }

  function updateScores() {
    ctx.setScores(level, best, `❤${lives} $${money}`);
  }

  // ---- AI：建設・強化 ----
  function towerCost(t) { return Math.round(TOWERS[t.type].cost * Math.pow(1.6, t.level - 1)); } // 強化費
  function spotFree(r, c) { return !towers.some((t) => t.r === r && t.c === c); }

  function aiThink() {
    const free = buildSpots.filter((s) => spotFree(s.r, s.c));
    const fullish = free.length < buildSpots.length * 0.15;

    // 強化：盤面が埋まってきたら強化に資金を回す。低レベルで高価な兵器を優先
    const upChance = fullish ? 0.82 : 0.3;
    if (towers.length > 0 && Math.random() < upChance) {
      let t = null, bv = -Infinity;
      for (let i = 0; i < 6; i++) {
        const c = towers[(Math.random() * towers.length) | 0];
        if (c.level >= 5) continue;
        const v = TOWERS[c.type].cost * 0.01 - c.level + Math.random();
        if (v > bv) { bv = v; t = c; }
      }
      if (t) { const up = towerCost(t); if (money >= up) { money -= up; t.level++; updateScores(); return; } }
    }
    if (free.length === 0) return;

    // 兵器選択：目標構成比から最も不足している種類を選び、多彩さを担保する
    const counts = {};
    for (const t of towers) counts[t.type] = (counts[t.type] || 0) + 1;
    const total = towers.length || 1;
    let wanted = null, deficit = -Infinity;
    for (const k of TOWER_KEYS) {
      const d = (TARGET[k] || 0.1) - (counts[k] || 0) / total + Math.random() * 0.05;
      if (d > deficit) { deficit = d; wanted = k; }
    }
    // 欲しい兵器が高くて買えない時は基本は貯金して高級兵器を狙う。
    // 代替で建てるのは「買える中でまだ目標比に不足している種類」だけ（アロー偏重を防ぐ）
    if (TOWERS[wanted].cost > money) {
      const affordable = TOWER_KEYS.filter((k) => TOWERS[k].cost <= money);
      if (affordable.length === 0) return;
      let alt = null, ad = -Infinity;
      for (const k of affordable) {
        const d = (TARGET[k] || 0.1) - (counts[k] || 0) / total;
        if (d > ad) { ad = d; alt = k; }
      }
      if (ad < 0) return;                 // 買える兵器がどれも過剰なら貯金
      if (Math.random() < 0.7) return;    // 多くは貯金して欲しい高級兵器を狙う
      wanted = alt;
    }

    // 設置：道のカバー数が多い要所マスを優先（数カ所サンプルして最良を選ぶ）
    let spot = null, sv = -1;
    const sample = Math.min(free.length, 26);
    for (let i = 0; i < sample; i++) {
      const s = free[(Math.random() * free.length) | 0];
      const v = (s.cov || 0) + Math.random() * 2;
      if (v > sv) { sv = v; spot = s; }
    }
    towers.push({ type: wanted, r: spot.r, c: spot.c, level: 1, cd: 0, angle: -Math.PI / 2, beamT: 0 });
    money -= TOWERS[wanted].cost;
    updateScores();
  }

  // ---- 戦闘 ----
  function enemyPos(e) { return { x: e.x, y: e.y }; }

  function damage(e, dmg) {
    e.hp -= dmg;
    if (e.hp <= 0 && !e.dead) {
      e.dead = true;
      money += e.def.bounty;
      burst(e.x, e.y, e.def.color);
      updateScores();
    }
  }
  function splashDamage(x, y, radius, dmg, dotAmt) {
    for (const e of enemies) {
      if (e.dead) continue;
      if (dist(x, y, e.x, e.y) <= radius) { damage(e, dmg); if (dotAmt) e.dot = Math.max(e.dot || 0, dotAmt), e.dotT = 3; }
    }
  }
  function burst(x, y, color) {
    for (let i = 0; i < 7; i++) {
      const a = rnd(0, Math.PI * 2), s = rnd(1.5, 4.5);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.55), color });
    }
  }

  function fireTower(t, dt) {
    const def = TOWERS[t.type];
    const range = def.range * (1 + (t.level - 1) * 0.08);
    const dmg = def.dmg * (1 + (t.level - 1) * 0.35);
    const cx = t.c + 0.5, cy = t.r + 0.5;

    // aura（フロスト）は射程内の敵を常時スロー＋微ダメ
    if (def.mode === 'aura') {
      let any = false;
      for (const e of enemies) {
        if (e.dead) continue;
        if (dist(cx, cy, e.x, e.y) <= range) { e.slowT = 0.25; e.slowAmt = def.slow; any = true; }
      }
      t.cd -= dt;
      if (any && t.cd <= 0) {
        t.cd = def.rate;
        for (const e of enemies) if (!e.dead && dist(cx, cy, e.x, e.y) <= range) damage(e, dmg);
      }
      return;
    }

    t.cd -= dt;
    if (t.cd > 0) return;
    // 射程内で最も先行している敵を狙う
    let target = null, bestT = -1;
    for (const e of enemies) {
      if (e.dead) continue;
      if (dist(cx, cy, e.x, e.y) <= range && e.t > bestT) { bestT = e.t; target = e; }
    }
    if (!target) return;
    t.cd = def.rate;
    t.angle = Math.atan2(target.y - cy, target.x - cx);

    if (def.mode === 'beam') {
      damage(target, dmg);
      beams.push({ x1: cx, y1: cy, x2: target.x, y2: target.y, life: 0.09, color: def.color, w: 0.18 });
    } else if (def.mode === 'chain') {
      let cur = target; const hit = new Set(); const pts = [{ x: cx, y: cy }];
      for (let i = 0; i < def.chain && cur; i++) {
        hit.add(cur); damage(cur, dmg); pts.push({ x: cur.x, y: cur.y });
        // 近くの未ヒット敵へ連鎖
        let nx = null, nd = 2.4;
        for (const e of enemies) { if (e.dead || hit.has(e)) continue; const d = dist(cur.x, cur.y, e.x, e.y); if (d < nd) { nd = d; nx = e; } }
        cur = nx;
      }
      beams.push({ chain: pts, life: 0.12, color: def.color, w: 0.14 });
    } else {
      // proj（誘導弾）
      projectiles.push({ x: cx, y: cy, target, tx: target.x, ty: target.y, speed: 11, dmg, color: def.proj, splash: def.splash || 0, dot: def.dot || 0, homing: def.homing });
    }
  }

  // ---- 進行 ----
  function tick() {
    const dt = TICK_MS / 1000 * (auto ? 1.6 : 1); // AI 自動運転時は高速
    clock += dt;

    if (state === 'gameover') {
      if (auto && restartCountdown >= 0 && --restartCountdown <= 0) newGame();
      render(); return;
    }

    // 敵スポーン
    if (toSpawn.length > 0) {
      spawnCd -= dt;
      if (spawnCd <= 0) { spawnEnemy(toSpawn.shift()); spawnCd = Math.max(0.18, 0.7 - level * 0.012); }
    } else if (enemies.length === 0) {
      nextWave();
    }

    // 敵移動
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.dotT > 0) { e.dotT -= dt; damage(e, (e.dot || 0) * dt); }
      let sp = e.def.speed * (1 + level * 0.015);
      if (e.slowT > 0) { e.slowT -= dt; sp *= (1 - (e.slowAmt || 0.5)); }
      e.t += sp * dt;
      const seg = Math.floor(e.t);
      if (seg >= path.length - 1) { e.reached = true; e.dead = true; lives--; updateScores(); if (lives <= 0) gameOver(); continue; }
      const a = path[seg], b = path[seg + 1], f = e.t - seg;
      e.x = (a.c + 0.5) + ((b.c) - (a.c)) * f;
      e.y = (a.r + 0.5) + ((b.r) - (a.r)) * f;
    }
    enemies = enemies.filter((e) => !e.dead);

    // タワー
    for (const t of towers) fireTower(t, dt);

    // 弾
    for (const p of projectiles) {
      const tgt = p.target && !p.target.dead ? p.target : null;
      if (tgt && p.homing) { p.tx = tgt.x; p.ty = tgt.y; }
      const d = dist(p.x, p.y, p.tx, p.ty);
      const step = p.speed * dt;
      if (d <= step + 0.2) {
        if (p.splash) splashDamage(p.tx, p.ty, p.splash, p.dmg, p.dot);
        else if (tgt) { damage(tgt, p.dmg); if (p.dot) { tgt.dot = Math.max(tgt.dot || 0, p.dot); tgt.dotT = 3; } }
        p.done = true;
        if (p.splash) burst(p.tx, p.ty, p.color);
      } else { p.x += (p.tx - p.x) / d * step; p.y += (p.ty - p.y) / d * step; }
    }
    projectiles = projectiles.filter((p) => !p.done);

    // ビーム・パーティクル寿命
    for (const b of beams) b.life -= dt;
    beams = beams.filter((b) => b.life > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);

    // AI 思考
    aiCd -= dt;
    if (aiCd <= 0) { aiCd = 0.35; aiThink(); }

    render();
  }

  function gameOver() {
    state = 'gameover';
    restartCountdown = RESTART_TICKS;
    ctx.showOverlay('GAME OVER', auto ? `Wave ${level} ・自動リスタート…` : `Wave ${level} ・キーで再開`);
  }

  // ---- 描画 ----
  let scale = 16, offX = 0, offY = 0;
  function applyGridSize() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cols = Math.max(14, Math.min(26, Math.round(rect.width / CELL_TARGET)));
    const rows = Math.max(18, Math.min(38, Math.round(rect.height / CELL_TARGET)));
    if (cols !== COLS || rows !== ROWS || path.length === 0) {
      COLS = cols; ROWS = rows; newGame();
    }
  }
  function relayout() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    applyGridSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    scale = Math.min(canvas.width / COLS, canvas.height / ROWS);
    offX = (canvas.width - COLS * scale) / 2;
    offY = (canvas.height - ROWS * scale) / 2;
    render();
  }
  const sx = (c) => offX + c * scale, sy = (r) => offY + r * scale;

  function roundRect(x, y, w, h, r) {
    g2d.beginPath();
    g2d.moveTo(x + r, y); g2d.arcTo(x + w, y, x + w, y + h, r);
    g2d.arcTo(x + w, y + h, x, y + h, r); g2d.arcTo(x, y + h, x, y, r);
    g2d.arcTo(x, y, x + w, y, r); g2d.closePath();
  }

  function render() {
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    // 草地（グラデ）
    const bg = g2d.createLinearGradient(0, offY, 0, offY + ROWS * scale);
    bg.addColorStop(0, '#2c3a26'); bg.addColorStop(1, '#1f2b1c');
    g2d.fillStyle = bg;
    g2d.fillRect(offX, offY, COLS * scale, ROWS * scale);

    // 道
    g2d.fillStyle = '#caa86a';
    for (const p of path) g2d.fillRect(sx(p.c), sy(p.r), scale + 0.5, scale + 0.5);
    g2d.fillStyle = 'rgba(0,0,0,0.10)';
    for (const p of path) g2d.fillRect(sx(p.c), sy(p.r) + scale * 0.7, scale + 0.5, scale * 0.3);

    // 入口/出口
    g2d.fillStyle = '#e74c3c'; g2d.fillRect(sx(path[0].c), sy(path[0].r), scale, scale);
    const last = path[path.length - 1];
    g2d.fillStyle = '#2ecc71'; g2d.fillRect(sx(last.c), sy(last.r), scale, scale);

    // タワー
    for (const t of towers) drawTower(t);

    // 弾
    for (const p of projectiles) {
      g2d.save(); g2d.shadowColor = p.color; g2d.shadowBlur = scale * 0.6;
      g2d.fillStyle = p.color;
      g2d.beginPath(); g2d.arc(sx(p.x), sy(p.y), scale * 0.16, 0, Math.PI * 2); g2d.fill();
      g2d.restore();
    }
    // ビーム/連鎖
    for (const b of beams) {
      g2d.save(); g2d.shadowColor = b.color; g2d.shadowBlur = scale; g2d.strokeStyle = b.color;
      g2d.lineWidth = scale * b.w; g2d.lineCap = 'round'; g2d.globalAlpha = Math.min(1, b.life * 9);
      g2d.beginPath();
      if (b.chain) { g2d.moveTo(sx(b.chain[0].x), sy(b.chain[0].y)); for (let i = 1; i < b.chain.length; i++) g2d.lineTo(sx(b.chain[i].x), sy(b.chain[i].y)); }
      else { g2d.moveTo(sx(b.x1), sy(b.y1)); g2d.lineTo(sx(b.x2), sy(b.y2)); }
      g2d.stroke(); g2d.restore();
    }
    g2d.globalAlpha = 1;

    // 敵
    for (const e of enemies) drawEnemy(e);

    // パーティクル
    for (const p of particles) {
      g2d.globalAlpha = Math.max(0, p.life * 2.5);
      g2d.fillStyle = p.color;
      g2d.fillRect(sx(p.x) - scale * 0.12, sy(p.y) - scale * 0.12, scale * 0.24, scale * 0.24);
    }
    g2d.globalAlpha = 1;
  }

  function drawTower(t) {
    const def = TOWERS[t.type];
    const cx = sx(t.c) + scale / 2, cy = sy(t.r) + scale / 2;
    // 台座
    g2d.fillStyle = '#2a2a31';
    roundRect(sx(t.c) + scale * 0.1, sy(t.r) + scale * 0.1, scale * 0.8, scale * 0.8, scale * 0.2); g2d.fill();
    // 砲身
    g2d.save();
    g2d.translate(cx, cy); g2d.rotate(t.angle);
    g2d.fillStyle = def.color;
    g2d.fillRect(0, -scale * 0.1, scale * 0.42, scale * 0.2);
    g2d.restore();
    // 砲塔（発光）
    g2d.save(); g2d.shadowColor = def.color; g2d.shadowBlur = scale * 0.5;
    g2d.fillStyle = def.color;
    g2d.beginPath(); g2d.arc(cx, cy, scale * 0.26, 0, Math.PI * 2); g2d.fill();
    g2d.restore();
    // 強化レベルのピップ
    g2d.fillStyle = '#fff';
    for (let i = 0; i < t.level; i++) g2d.fillRect(sx(t.c) + scale * 0.16 + i * scale * 0.16, sy(t.r) + scale * 0.78, scale * 0.1, scale * 0.1);
  }

  function drawEnemy(e) {
    const x = sx(e.x), y = sy(e.y), r = scale * e.def.r;
    g2d.save();
    if (e.type === 'boss') { g2d.shadowColor = e.def.color; g2d.shadowBlur = scale; }
    g2d.fillStyle = e.def.color;
    g2d.beginPath(); g2d.arc(x, y, r, 0, Math.PI * 2); g2d.fill();
    g2d.restore();
    if (e.slowT > 0) { g2d.fillStyle = 'rgba(120,220,255,0.5)'; g2d.beginPath(); g2d.arc(x, y, r, 0, Math.PI * 2); g2d.fill(); }
    // 目
    g2d.fillStyle = '#fff';
    g2d.fillRect(x - r * 0.45, y - r * 0.2, r * 0.3, r * 0.4);
    g2d.fillRect(x + r * 0.15, y - r * 0.2, r * 0.3, r * 0.4);
    // HP バー
    const w = scale * 0.8, hpf = Math.max(0, e.hp / e.maxhp);
    g2d.fillStyle = 'rgba(0,0,0,0.5)'; g2d.fillRect(x - w / 2, y - r - scale * 0.28, w, scale * 0.14);
    g2d.fillStyle = hpf > 0.5 ? '#5fe07a' : hpf > 0.25 ? '#f0c040' : '#e85a5a';
    g2d.fillRect(x - w / 2, y - r - scale * 0.28, w * hpf, scale * 0.14);
  }

  // ---- 共通インターフェース ----
  return {
    name: 'td',
    show() {
      wrapEl.style.display = 'flex';
      relayout();
      updateScores();
      if (timer === null) timer = setInterval(tick, TICK_MS);
    },
    hide() { clearInterval(timer); timer = null; wrapEl.style.display = 'none'; },
    setAuto(on) { auto = on; },
    key(e) { if (state === 'gameover') { newGame(); return true; } return false; },
    relayout, reset: newGame, isOver: () => state === 'gameover',
    _tick: tick,
    _state: () => {
      const mix = {};
      for (const t of towers) mix[t.type] = (mix[t.type] || 0) + 1;
      return { state, level, lives, money, towers: towers.length, enemies: enemies.length,
               cols: COLS, rows: ROWS, best, mix };
    }
  };
};
