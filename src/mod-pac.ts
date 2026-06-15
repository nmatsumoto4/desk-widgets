// パックマン ウィジェットモジュール（AI 自動運転・迷路追跡・ドット絵）
//
// ・迷路の餌を全部食べたらレベルアップ（ゴーストが速く・パワー餌の効果が短く）。
// ・AI は「幽霊の近くを避けつつ最寄りの餌へ」BFS で進み、パワー餌中は怯えた幽霊を狩る。
// ・残機 0 で自動リスタート。クリックでフォーカス中のみ矢印キー手動。

interface Mover { x: number; y: number; tr: number; tc: number; dr: number; dc: number; }
interface Ghost extends Mover { id: number; mode: 'house' | 'chase' | 'scatter' | 'fright' | 'eaten'; color: string; relTimer: number; }

window.createWidgetPac = function (ctx: WidgetCtx): WidgetModule {
  const TICK_MS = 33;
  const COLS = 19, ROWS = 21;
  const BEST_KEY = 'widgetPac.best';

  const wrapEl = document.getElementById('pac') as HTMLElement;
  const canvas = document.getElementById('pac-canvas') as HTMLCanvasElement;
  const g2d = canvas.getContext('2d') as CanvasRenderingContext2D;

  // 0=通路 1=壁 2=ゴーストハウス（パックマンは入らない）
  let cell: Uint8Array = new Uint8Array(COLS * ROWS);
  let pellet: Uint8Array = new Uint8Array(COLS * ROWS);   // 0=なし 1=餌 2=パワー餌
  let pelletsLeft = 0;
  const houseR = (ROWS / 2) | 0, houseC = (COLS / 2) | 0;

  let pac: Mover = { x: 0, y: 0, tr: 0, tc: 0, dr: 0, dc: 0 };
  let ghosts: Ghost[] = [];
  let lives = 3, level = 0, score = 0, energized = 0, ghostCombo = 0;
  let modeTimer = 5; let ghostMode: 'scatter' | 'chase' = 'scatter';
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  let state: 'play' | 'dead' | 'gameover' = 'play';
  let resetTimer = -1, clock = 0;
  let auto = false, timer: any = null;

  const idx = (r: number, c: number) => r * COLS + c;
  const inB = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const wall = (r: number, c: number) => !inB(r, c) || cell[idx(r, c)] === 1;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const dl = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
  const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const GCOL = ['#ff5a5a', '#ffb8e0', '#7ff0ff', '#ffc24a'];     // 赤/桃/水/橙
  const CORNER = [[1, COLS - 2], [1, 1], [ROWS - 2, COLS - 2], [ROWS - 2, 1]];

  // ---- 迷路生成（柱の格子＝必ず連結）＋中央ゴーストハウス ----
  function buildMaze() {
    cell = new Uint8Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1) cell[idx(r, c)] = 1;       // 外壁
      else if (r % 2 === 0 && c % 2 === 0) cell[idx(r, c)] = 1;                               // 柱
    }
    // 少しだけ壁を足して単調さを消す（連結は柱格子なので保たれる：奇数行/列は必ず通路）
    for (let k = 0; k < 7; k++) {
      const r = 1 + ((Math.random() * (ROWS - 2)) | 0), c = 1 + ((Math.random() * (COLS - 2)) | 0);
      if ((r % 2 === 1) !== (c % 2 === 1)) cell[idx(r, c)] = 1; // 通路の「枝」だけ塞ぐ（交点は塞がない）
    }
    // ゴーストハウス（中央 3x3 を通路化して印を付ける）
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const r = houseR + dr, c = houseC + dc; if (inB(r, c)) cell[idx(r, c)] = 2; }
    cell[idx(houseR - 2, houseC)] = 0; cell[idx(houseR - 1, houseC)] = 0; // 出入口
  }

  function fillPellets() {
    pellet = new Uint8Array(COLS * ROWS); pelletsLeft = 0;
    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
      if (cell[idx(r, c)] !== 0) continue;
      pellet[idx(r, c)] = 1; pelletsLeft++;
    }
    for (const [r, c] of CORNER) { if (cell[idx(r, c)] === 0) { if (pellet[idx(r, c)] === 0) pelletsLeft++; pellet[idx(r, c)] = 2; } }
  }

  function placeActors() {
    pac = { x: houseC + 0.5, y: ROWS - 2 + 0.5, tr: ROWS - 2, tc: houseC, dr: 0, dc: -1 };
    if (pellet[idx(ROWS - 2, houseC)]) { pellet[idx(ROWS - 2, houseC)] = 0; pelletsLeft--; }
    ghosts = [];
    for (let i = 0; i < 4; i++) {
      const c = houseC - 1 + i % 3, r = houseR + (i === 3 ? 1 : 0);
      ghosts.push({ id: i, x: c + 0.5, y: r + 0.5, tr: r, tc: c, dr: -1, dc: 0, mode: 'house', color: GCOL[i], relTimer: i * 1.1 + 0.5 });
    }
  }

  function newGame() {
    lives = 3; level = 0; score = 0;
    state = 'play'; resetTimer = -1; particles = [];
    buildMaze(); startLevel();
    updateScores(); render();
  }
  function startLevel() {
    level++; energized = 0; ghostCombo = 0;
    modeTimer = 5; ghostMode = 'scatter';
    fillPellets(); placeActors();
    ctx.hideOverlay();
  }
  function resetAfterDeath() { energized = 0; placeActors(); state = 'play'; }

  function updateScores() {
    if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
    ctx.setScores(score, best, `Lv${level} ♥${Math.max(0, lives)}`);
  }

  // ---- 探索 ----
  const center = (m: Mover) => Math.abs(m.x - (m.tc + 0.5)) < 0.07 && Math.abs(m.y - (m.tr + 0.5)) < 0.07;
  function step(m: Mover, dt: number, speed: number) {
    const tx = m.tc + 0.5, ty = m.tr + 0.5, dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy), s = speed * dt;
    if (d <= s) { m.x = tx; m.y = ty; return true; }
    m.x += dx / d * s; m.y += dy / d * s; return false;
  }
  // パックマン：ゴースト回避コスト付き BFS で目標（餌/怯え幽霊）への最初の一歩を選ぶ
  function bfsDir(sr: number, sc: number, goalTest: (r: number, c: number) => boolean, avoid: boolean): number[] | null {
    const prev = new Int32Array(COLS * ROWS).fill(-2 as any);
    const danger = new Uint8Array(COLS * ROWS);
    if (avoid) for (const g of ghosts) { if (g.mode === 'fright' || g.mode === 'eaten') continue; const gr = Math.round(g.y - 0.5), gc = Math.round(g.x - 0.5); for (const [dr, dc] of [[0, 0], ...NB]) { const r = gr + dr, c = gc + dc; if (inB(r, c)) danger[idx(r, c)] = 1; } }
    const q: number[] = [idx(sr, sc)]; prev[idx(sr, sc)] = -1; let h = 0;
    let found = -1;
    while (h < q.length) {
      const cur = q[h++]; const r = (cur / COLS) | 0, c = cur % COLS;
      if (goalTest(r, c) && cur !== idx(sr, sc)) { found = cur; break; }
      for (const [dr, dc] of NB) { const nr = r + dr, nc = c + dc; if (wall(nr, nc) || cell[idx(nr, nc)] === 2) continue; const ni = idx(nr, nc); if (prev[ni] !== -2) continue; if (danger[ni] && !goalTest(nr, nc)) continue; prev[ni] = cur; q.push(ni); }
    }
    if (found < 0) return null;
    let cur = found; while (prev[cur] !== idx(sr, sc) && prev[cur] >= 0) cur = prev[cur];
    return [(cur / COLS) | 0, cur % COLS];
  }
  function fleeStep(sr: number, sc: number): number[] {
    let bd = -1, br = sr, bc = sc;
    for (const [dr, dc] of NB) { const r = sr + dr, c = sc + dc; if (wall(r, c) || cell[idx(r, c)] === 2) continue; let md = 99; for (const g of ghosts) if (g.mode === 'chase' || g.mode === 'scatter' || g.mode === 'house') md = Math.min(md, dl(c, r, g.x - 0.5, g.y - 0.5)); if (md > bd) { bd = md; br = r; bc = c; } }
    return [br, bc];
  }
  function pacThink() {
    const sr = pac.tr, sc = pac.tc;
    let threat = 99; for (const g of ghosts) if (g.mode === 'chase' || g.mode === 'scatter') threat = Math.min(threat, dl(sc, sr, g.x - 0.5, g.y - 0.5));
    let nxt: number[] | null = null;
    if (energized > 1) nxt = bfsDir(sr, sc, (r, c) => ghosts.some((g) => g.mode === 'fright' && Math.round(g.y - 0.5) === r && Math.round(g.x - 0.5) === c), false); // 怯え幽霊を狩る
    if (!nxt && threat < 4.5) {                                   // 脅威が近い：パワー餌で形勢逆転 or 逃走
      nxt = bfsDir(sr, sc, (r, c) => pellet[idx(r, c)] === 2, true) || bfsDir(sr, sc, (r, c) => pellet[idx(r, c)] === 2, false);
      if (!nxt) nxt = fleeStep(sr, sc);
    }
    if (!nxt) nxt = bfsDir(sr, sc, (r, c) => pellet[idx(r, c)] > 0, true);   // 安全に最寄りの餌
    if (!nxt) nxt = fleeStep(sr, sc);                              // 安全路なし→逃走（無理に取りにいかない）
    pac.tr = nxt[0]; pac.tc = nxt[1]; pac.dr = Math.sign(nxt[0] - sr); pac.dc = Math.sign(nxt[1] - sc);
  }

  // ゴースト：交点で目標タイルへ最も近づく方向を選ぶ（逆走しない）
  function ghostTarget(g: Ghost): number[] {
    const pr = pac.tr, pc = pac.tc;
    if (g.mode === 'scatter') return CORNER[g.id];
    if (g.mode === 'eaten') return [houseR, houseC];
    if (g.id === 0) return [pr, pc];                       // 赤：直接
    if (g.id === 1) return [pr + pac.dr * 4, pc + pac.dc * 4]; // 桃：先回り
    if (g.id === 2) return [pr - pac.dr * 3, pc - pac.dc * 3]; // 水：逆側
    return dl(g.x, g.y, pac.x, pac.y) > 5 ? [pr, pc] : CORNER[3]; // 橙：遠ければ追う
  }
  function ghostThink(g: Ghost) {
    const sr = g.tr, sc = g.tc;
    if (g.mode === 'house') { g.tr = houseR - 2; g.tc = houseC; return; }   // 上へ出る
    if (g.mode === 'eaten' && sr === houseR && sc === houseC) { g.mode = 'chase'; }
    const opts: number[][] = [];
    for (const [dr, dc] of NB) { const r = sr + dr, c = sc + dc; if (wall(r, c)) continue; if (cell[idx(r, c)] === 2 && g.mode !== 'eaten') continue; if (dr === -g.dr && dc === -g.dc) continue; opts.push([r, c]); }
    if (opts.length === 0) { g.tr = sr - g.dr; g.tc = sc - g.dc; }            // 行き止まりは逆走
    else if (g.mode === 'fright') { const o = opts[(Math.random() * opts.length) | 0]; g.tr = o[0]; g.tc = o[1]; }
    else { const t = ghostTarget(g); let bo = opts[0], bv = Infinity; for (const o of opts) { const v = dl(o[1], o[0], t[1], t[0]); if (v < bv) { bv = v; bo = o; } } g.tr = bo[0]; g.tc = bo[1]; }
    g.dr = Math.sign(g.tr - sr); g.dc = Math.sign(g.tc - sc);
  }

  function burst(x: number, y: number, color: string, n = 8) { for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), s = rnd(1.5, 4); particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.25, 0.5), color }); } }

  // ---- 進行 ----
  function tick() {
    const dt = TICK_MS / 1000 * (auto ? 1.5 : 1);
    clock += dt;
    if (state === 'gameover') { if (auto && resetTimer >= 0 && --resetTimer <= 0) newGame(); decay(dt); render(); return; }
    if (state === 'dead') { if (--resetTimer <= 0) { if (lives <= 0) gameOver(); else resetAfterDeath(); } decay(dt); render(); return; }

    if (energized > 0) energized -= dt;
    const pspeed = 4.8 + level * 0.2;
    const gspeed = 3.0 + level * 0.16;
    // チェイス↔スキャッターを周期で切替（スキャッター中は四隅へ退避＝パックに余裕）
    modeTimer -= dt;
    if (modeTimer <= 0) { ghostMode = ghostMode === 'scatter' ? 'chase' : 'scatter'; modeTimer = ghostMode === 'scatter' ? 7 : Math.min(20, 7 + level * 1.5); }

    // パックマン
    if (center(pac)) {
      // 餌
      const pi = idx(pac.tr, pac.tc);
      if (pellet[pi] === 1) { pellet[pi] = 0; pelletsLeft--; score += 10; updateScores(); if (window.SFX) window.SFX.eat && window.SFX.eat(); }
      else if (pellet[pi] === 2) { pellet[pi] = 0; pelletsLeft--; score += 50; energized = Math.max(2, 7 - level * 0.4); ghostCombo = 0; for (const g of ghosts) if (g.mode === 'chase' || g.mode === 'scatter') g.mode = 'fright'; updateScores(); if (window.SFX) window.SFX.item && window.SFX.item(); }
      if (pelletsLeft <= 0) { startLevel(); updateScores(); render(); return; }
      pacThink();
    }
    if (!auto) { /* 手動時は key() で tr/tc を設定 */ }
    step(pac, dt, pspeed);

    // ゴースト
    for (const g of ghosts) {
      g.relTimer -= dt;
      // 巣の中：時間が来たら出口（ドア）へ上り、外に出たら現在モードで追跡開始
      if (g.mode === 'house') {
        if (g.relTimer > 0) continue;
        if (center(g)) { const rr = Math.round(g.y - 0.5); if (rr <= houseR - 2) { g.mode = ghostMode; g.dr = -1; g.dc = 0; ghostThink(g); } else { g.tr = Math.max(houseR - 2, g.tr - 1); g.tc = houseC; } }
        step(g, dt, gspeed * 0.75); continue;
      }
      // 怯えが切れたら、また通常はモードに従う
      if (g.mode === 'fright') { if (energized <= 0) g.mode = ghostMode; }
      else if (g.mode !== 'eaten') g.mode = ghostMode;
      const speed = g.mode === 'eaten' ? gspeed * 1.9 : g.mode === 'fright' ? gspeed * 0.6 : gspeed;
      if (center(g)) {
        // 食べられた幽霊が巣に戻ったら再出撃
        if (g.mode === 'eaten' && g.tr === houseR && g.tc === houseC) { g.mode = 'house'; g.relTimer = 0.4; continue; }
        ghostThink(g);
      }
      step(g, dt, speed);
      // 当たり判定
      if (dl(g.x, g.y, pac.x, pac.y) < 0.6) {
        if (g.mode === 'fright') { ghostCombo++; score += 200 * ghostCombo; g.mode = 'eaten'; burst(g.x, g.y, g.color, 10); updateScores(); if (window.SFX) window.SFX.pop && window.SFX.pop(); }
        else if (g.mode !== 'eaten') { die(); return; }
      }
    }
    decay(dt); render();
  }

  function die() {
    lives--; state = 'dead'; resetTimer = Math.round(1100 / TICK_MS); burst(pac.x, pac.y, '#ffe24a', 14);
    if (window.SFX) window.SFX.die && window.SFX.die(); updateScores();
  }
  function gameOver() { state = 'gameover'; resetTimer = Math.round(1700 / TICK_MS); ctx.showOverlay('GAME OVER', auto ? `Lv${level}・自動リスタート…` : `Lv${level}・キーで再開`); }
  function decay(dt: number) { for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; } particles = particles.filter((p) => p.life > 0); }

  // ---- 描画 ----
  let scale = 16, offX = 0, offY = 0;
  const TAU = Math.PI * 2;
  function relayout() {
    const rect = wrapEl.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    scale = Math.min(canvas.width / COLS, canvas.height / ROWS);
    offX = (canvas.width - COLS * scale) / 2; offY = (canvas.height - ROWS * scale) / 2;
    render();
  }
  const sx = (c: number) => offX + c * scale, sy = (r: number) => offY + r * scale;

  function render() {
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    g2d.fillStyle = '#0a0a18'; g2d.fillRect(offX, offY, COLS * scale, ROWS * scale);
    // 壁
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = cell[idx(r, c)];
      if (t === 1) { g2d.fillStyle = '#1f33c0'; roundRect(sx(c) + scale * 0.12, sy(r) + scale * 0.12, scale * 0.76, scale * 0.76, scale * 0.25); g2d.fill(); g2d.fillStyle = 'rgba(120,150,255,0.35)'; roundRect(sx(c) + scale * 0.12, sy(r) + scale * 0.12, scale * 0.76, scale * 0.28, scale * 0.2); g2d.fill(); }
      else if (t === 2) { g2d.strokeStyle = 'rgba(120,150,255,0.4)'; g2d.lineWidth = 1; g2d.strokeRect(sx(c), sy(r), scale, scale); }
    }
    // 餌
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const p = pellet[idx(r, c)]; if (!p) continue;
      g2d.fillStyle = '#ffd9a0';
      if (p === 1) { g2d.beginPath(); g2d.arc(sx(c) + scale / 2, sy(r) + scale / 2, scale * 0.08, 0, TAU); g2d.fill(); }
      else { g2d.save(); g2d.globalAlpha = 0.6 + 0.4 * Math.sin(clock * 8); g2d.shadowColor = '#ffd9a0'; g2d.shadowBlur = scale * 0.5; g2d.beginPath(); g2d.arc(sx(c) + scale / 2, sy(r) + scale / 2, scale * 0.2, 0, TAU); g2d.fill(); g2d.restore(); }
    }
    // パックマン
    drawPac();
    // ゴースト
    for (const g of ghosts) drawGhost(g);
    for (const p of particles) { g2d.globalAlpha = Math.max(0, p.life * 2.2); g2d.fillStyle = p.color; g2d.fillRect(sx(p.x) - scale * 0.08, sy(p.y) - scale * 0.08, scale * 0.16, scale * 0.16); }
    g2d.globalAlpha = 1;
  }
  function drawPac() {
    const x = sx(pac.x), y = sy(pac.y), r = scale * 0.42;
    const ang = Math.atan2(pac.dr, pac.dc);
    const m = (state === 'play') ? Math.abs(Math.sin(clock * 12)) * 0.32 : 0.05;
    g2d.save(); g2d.shadowColor = '#ffe24a'; g2d.shadowBlur = scale * 0.4; g2d.fillStyle = '#ffe24a';
    g2d.translate(x, y); g2d.rotate(ang);
    g2d.beginPath(); g2d.moveTo(0, 0); g2d.arc(0, 0, r, m * Math.PI, (2 - m) * Math.PI); g2d.closePath(); g2d.fill();
    g2d.restore();
  }
  function drawGhost(g: Ghost) {
    const x = sx(g.x), y = sy(g.y), r = scale * 0.4;
    const body = g.mode === 'fright' ? (energized < 1.6 && ((clock * 8) | 0) % 2 ? '#ffffff' : '#3a52ff') : g.mode === 'eaten' ? null : g.color;
    if (body) { g2d.save(); g2d.shadowColor = body; g2d.shadowBlur = scale * 0.35; g2d.fillStyle = body;
      g2d.beginPath(); g2d.arc(x, y - r * 0.1, r, Math.PI, 0); g2d.lineTo(x + r, y + r * 0.7);
      for (let i = 0; i < 3; i++) { g2d.lineTo(x + r - (i * 2 + 1) * r / 3, y + r * 0.4); g2d.lineTo(x + r - (i * 2 + 2) * r / 3, y + r * 0.7); }
      g2d.closePath(); g2d.fill(); g2d.restore();
    }
    // 目
    const ex = g.mode === 'eaten' || g.mode === 'fright' ? 0 : g.dc * r * 0.16, ey = g.mode === 'eaten' || g.mode === 'fright' ? 0 : g.dr * r * 0.16;
    g2d.fillStyle = g.mode === 'fright' ? '#ffd9a0' : '#fff';
    g2d.beginPath(); g2d.arc(x - r * 0.35, y - r * 0.1, r * 0.22, 0, TAU); g2d.arc(x + r * 0.35, y - r * 0.1, r * 0.22, 0, TAU); g2d.fill();
    if (g.mode !== 'fright') { g2d.fillStyle = '#1a2bb0'; g2d.beginPath(); g2d.arc(x - r * 0.35 + ex, y - r * 0.1 + ey, r * 0.11, 0, TAU); g2d.arc(x + r * 0.35 + ex, y - r * 0.1 + ey, r * 0.11, 0, TAU); g2d.fill(); }
  }
  function roundRect(x: number, y: number, w: number, h: number, rr: number) { g2d.beginPath(); g2d.moveTo(x + rr, y); g2d.arcTo(x + w, y, x + w, y + h, rr); g2d.arcTo(x + w, y + h, x, y + h, rr); g2d.arcTo(x, y + h, x, y, rr); g2d.arcTo(x, y, x + w, y, rr); g2d.closePath(); }

  // ---- 共通インターフェース ----
  return {
    name: 'pac',
    show() { wrapEl.style.display = 'flex'; if (cell.every((v) => v === 0)) buildMaze(); newGame(); relayout(); if (timer === null) timer = setInterval(tick, TICK_MS); },
    hide() { clearInterval(timer); timer = null; wrapEl.style.display = 'none'; },
    setAuto(on: boolean) { auto = on; },
    key(e: KeyboardEvent) {
      if (state === 'gameover') { newGame(); return true; }
      const d: Record<string, number[]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      const v = d[e.key]; if (!v) return false;
      if (center(pac)) { const r = pac.tr + v[0], c = pac.tc + v[1]; if (!wall(r, c) && cell[idx(r, c)] !== 2) { pac.tr = r; pac.tc = c; pac.dr = v[0]; pac.dc = v[1]; } }
      return true;
    },
    relayout, reset: newGame, isOver: () => state === 'gameover',
    _tick: tick,
    _state: () => ({ state, level, score, lives, pelletsLeft, energized: energized > 0, ghosts: ghosts.length, best }),
  };
};
