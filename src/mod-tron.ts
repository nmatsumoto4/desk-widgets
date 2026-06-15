// トロン（ライトサイクル）ウィジェットモジュール（AI 同士の対戦・到達領域評価・ドット絵）
//
// ・各サイクルは光の軌跡を残しながら走る。壁・軌跡・他機に当たると爆散。最後の 1 機が勝ち。
// ・AI は「直進/左折/右折」のうち、進んだ先から到達できる空きマスが最大になる手を選ぶ（自閉回避）。
// ・1 ラウンド終わるたびに即リスタート。ラウンドを重ねると速く・台数が増えて難化（永久に継続）。

interface Cycle { id: number; cr: number; cc: number; pcr: number; pcc: number; dr: number; dc: number; color: string; alive: boolean; }

window.createWidgetTron = function (ctx: WidgetCtx): WidgetModule {
  const TICK_MS = 33;
  const CELL_TARGET = 16;
  const BEST_KEY = 'widgetTron.best';

  const wrapEl = document.getElementById('tron') as HTMLElement;
  const canvas = document.getElementById('tron-canvas') as HTMLCanvasElement;
  const g2d = canvas.getContext('2d') as CanvasRenderingContext2D;

  let COLS = 24, ROWS = 32;
  let occ: Uint8Array = new Uint8Array(0);    // 0=空 1..N=各機の軌跡 255=壁
  let cycles: Cycle[] = [];
  let level = 0, round = 0, best = Number(localStorage.getItem(BEST_KEY) || 0);
  let particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  let moveAcc = 0, stepTime = 0.085, clock = 0;
  let state: 'play' | 'roundend' = 'play';
  let endTimer = 0;
  let auto = false, timer: any = null;

  const idx = (r: number, c: number) => r * COLS + c;
  const inB = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const COL = ['#34e1ff', '#ff5a8a', '#7dff5a', '#ffd24a', '#c78bff', '#ff9a3a'];
  const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function cycleCount() { return Math.min(6, 3 + Math.floor(round / 4)); }

  function newRound() {
    round++; level = round;
    if (round > best) { best = round; localStorage.setItem(BEST_KEY, String(best)); }
    stepTime = Math.max(0.04, 0.09 - round * 0.0015);
    occ = new Uint8Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1) occ[idx(r, c)] = 255;
    cycles = [];
    const n = cycleCount();
    // 外周近くに等間隔配置、内側を向ける
    const spots = [
      [2, 2, 0, 1], [ROWS - 3, COLS - 3, 0, -1], [2, COLS - 3, 1, 0], [ROWS - 3, 2, -1, 0],
      [(ROWS / 2) | 0, 2, 0, 1], [(ROWS / 2) | 0, COLS - 3, 0, -1],
    ];
    for (let i = 0; i < n; i++) {
      const [r, c, dr, dc] = spots[i];
      occ[idx(r, c)] = i + 1;
      cycles.push({ id: i, cr: r, cc: c, pcr: r, pcc: c, dr, dc, color: COL[i], alive: true });
    }
    moveAcc = 0; state = 'play'; particles = [];
    updateScores(); render();
  }

  function updateScores() {
    const alive = cycles.filter((c) => c.alive).length;
    ctx.setScores(round, best, `${alive}/${cycles.length} 機`);
  }

  // 指定マスから到達できる空きマス数（自閉回避の評価。上限付き BFS）
  function floodCount(sr: number, sc: number, limit: number): number {
    if (!inB(sr, sc) || occ[idx(sr, sc)] !== 0) return 0;
    const seen = new Uint8Array(COLS * ROWS); const q = [idx(sr, sc)]; seen[idx(sr, sc)] = 1; let h = 0, cnt = 0;
    while (h < q.length && cnt < limit) {
      const cur = q[h++]; cnt++; const r = (cur / COLS) | 0, c = cur % COLS;
      for (const [dr, dc] of NB) { const nr = r + dr, nc = c + dc; if (!inB(nr, nc)) continue; const ni = idx(nr, nc); if (seen[ni] || occ[ni] !== 0) continue; seen[ni] = 1; q.push(ni); }
    }
    return cnt;
  }
  function decide(cy: Cycle) {
    // 候補：直進・左折・右折（逆走はしない）
    const dirs = [[cy.dr, cy.dc], [-cy.dc, cy.dr], [cy.dc, -cy.dr]];
    let best = -1, bdir = [cy.dr, cy.dc];
    for (const [dr, dc] of dirs) {
      const nr = cy.cr + dr, nc = cy.cc + dc;
      if (!inB(nr, nc) || occ[idx(nr, nc)] !== 0) continue;          // 即死手は除外
      let space = floodCount(nr, nc, 300);
      space += rnd(0, 1.5);                                          // わずかな揺らぎ
      if (space > best) { best = space; bdir = [dr, dc]; }
    }
    cy.dr = bdir[0]; cy.dc = bdir[1];
  }

  function burst(cx: number, cy: number, color: string, n = 16) { for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), s = rnd(2, 6); particles.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.7), color }); } }

  function doMove() {
    const alive = cycles.filter((c) => c.alive);
    for (const cy of alive) decide(cy);
    const intent = alive.map((cy) => ({ cy, nr: cy.cr + cy.dr, nc: cy.cc + cy.dc }));
    // 壁・軌跡に当たる手は死
    for (const it of intent) if (!inB(it.nr, it.nc) || occ[idx(it.nr, it.nc)] !== 0) it.cy.alive = false;
    // 正面衝突（同じマスを奪い合う）→ 両者死
    for (let i = 0; i < intent.length; i++) for (let j = i + 1; j < intent.length; j++) { if (intent[i].cy.alive && intent[j].cy.alive && intent[i].nr === intent[j].nr && intent[i].nc === intent[j].nc) { intent[i].cy.alive = false; intent[j].cy.alive = false; } }
    // 生存機を前進＆軌跡を刻む
    for (const it of intent) { const cy = it.cy; if (!cy.alive) { burst(cy.cc + 0.5, cy.cr + 0.5, cy.color, 18); if (window.SFX) window.SFX.explode && window.SFX.explode(); continue; } cy.pcr = cy.cr; cy.pcc = cy.cc; cy.cr = it.nr; cy.cc = it.nc; occ[idx(it.nr, it.nc)] = cy.id + 1; }
    if (cycles.filter((c) => c.alive).length <= 1) { state = 'roundend'; endTimer = Math.round(1100 / TICK_MS); updateScores(); }
    else updateScores();
  }

  // ---- 進行 ----
  function tick() {
    const dt = TICK_MS / 1000 * (auto ? 1.4 : 1);
    clock += dt;
    if (state === 'roundend') { if (--endTimer <= 0) newRound(); decay(dt); render(); return; }
    moveAcc += dt;
    while (moveAcc >= stepTime) { moveAcc -= stepTime; if (state === 'play') doMove(); }
    decay(dt); render();
  }
  function decay(dt: number) { for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; } particles = particles.filter((p) => p.life > 0); }

  // ---- 描画 ----
  let scale = 16, offX = 0, offY = 0;
  const TAU = Math.PI * 2;
  function applyGridSize() {
    const rect = wrapEl.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) return;
    const cols = Math.max(16, Math.min(34, Math.round(rect.width / CELL_TARGET)));
    const rows = Math.max(20, Math.min(46, Math.round(rect.height / CELL_TARGET)));
    if (cols !== COLS || rows !== ROWS || occ.length === 0) { COLS = cols; ROWS = rows; round = 0; newRound(); }
  }
  function relayout() {
    const rect = wrapEl.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) return;
    applyGridSize();
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
    const bg = g2d.createLinearGradient(0, offY, 0, offY + ROWS * scale); bg.addColorStop(0, '#0a0f1e'); bg.addColorStop(1, '#05070f');
    g2d.fillStyle = bg; g2d.fillRect(offX, offY, COLS * scale, ROWS * scale);
    // グリッド線
    g2d.strokeStyle = 'rgba(60,90,140,0.16)'; g2d.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) { g2d.beginPath(); g2d.moveTo(sx(c), sy(0)); g2d.lineTo(sx(c), sy(ROWS)); g2d.stroke(); }
    for (let r = 0; r <= ROWS; r++) { g2d.beginPath(); g2d.moveTo(sx(0), sy(r)); g2d.lineTo(sx(COLS), sy(r)); g2d.stroke(); }
    // 外壁
    g2d.fillStyle = '#23406a'; g2d.fillRect(offX, offY, COLS * scale, scale); g2d.fillRect(offX, offY + (ROWS - 1) * scale, COLS * scale, scale); g2d.fillRect(offX, offY, scale, ROWS * scale); g2d.fillRect(offX + (COLS - 1) * scale, offY, scale, ROWS * scale);
    // 軌跡
    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) { const v = occ[idx(r, c)]; if (v === 0 || v === 255) continue; const col = COL[v - 1]; g2d.fillStyle = col; g2d.globalAlpha = 0.85; g2d.fillRect(sx(c) + scale * 0.12, sy(r) + scale * 0.12, scale * 0.76, scale * 0.76); }
    g2d.globalAlpha = 1;
    // ヘッド（補間して滑らかに）
    const prog = state === 'play' ? Math.min(1, moveAcc / stepTime) : 1;
    for (const cy of cycles) { if (!cy.alive) continue; const r = cy.pcr + (cy.cr - cy.pcr) * prog, c = cy.pcc + (cy.cc - cy.pcc) * prog; g2d.save(); g2d.shadowColor = cy.color; g2d.shadowBlur = scale * 0.9; g2d.fillStyle = '#fff'; g2d.fillRect(sx(c) + scale * 0.18, sy(r) + scale * 0.18, scale * 0.64, scale * 0.64); g2d.fillStyle = cy.color; g2d.globalAlpha = 0.6; g2d.fillRect(sx(c) + scale * 0.06, sy(r) + scale * 0.06, scale * 0.88, scale * 0.88); g2d.restore(); }
    g2d.globalAlpha = 1;
    for (const p of particles) { g2d.globalAlpha = Math.max(0, p.life * 1.8); g2d.fillStyle = p.color; g2d.fillRect(sx(p.x) - scale * 0.1, sy(p.y) - scale * 0.1, scale * 0.2, scale * 0.2); }
    g2d.globalAlpha = 1;
  }

  // ---- 共通インターフェース ----
  return {
    name: 'tron',
    show() { wrapEl.style.display = 'flex'; relayout(); if (occ.length === 0) newRound(); if (timer === null) timer = setInterval(tick, TICK_MS); },
    hide() { clearInterval(timer); timer = null; wrapEl.style.display = 'none'; },
    setAuto(on: boolean) { auto = on; },
    key() { if (state === 'roundend') { newRound(); return true; } return false; },
    relayout, reset: () => { round = 0; newRound(); }, isOver: () => false,
    _tick: tick,
    _state: () => ({ state, round, alive: cycles.filter((c) => c.alive).length, cycles: cycles.length, best, cols: COLS, rows: ROWS }),
  };
};
