// テトリス ウィジェットモジュール（AI 自動プレイ・レベルアップ）
//
// ・10×20 の標準フィールド。AI は全ての（回転×左右位置）を評価して最善手を選ぶ
//   （集約高さ・消去ライン・穴・凸凹の重み付き評価。よく知られた強い heuristic）。
// ・ラインを消すほどレベルが上がり、落下・操作が速くなる（難易度上昇）。
// ・積み上がって出せなくなると少し待って自動リスタートし、永遠に動き続ける。
// ・手動：← → 移動、↑ 回転、↓ ソフトドロップ、Space ハードドロップ。

window.createWidgetTetris = function (ctx) {
  const COLS = 10, ROWS = 20;
  const TICK_MS = 33;
  const RESTART_TICKS = Math.round(1400 / TICK_MS);
  const BEST_KEY = 'widgetTetris.best';

  const wrapEl = document.getElementById('tetris');
  const canvas = document.getElementById('tetris-canvas');
  const g2d = canvas.getContext('2d');

  // 各ピースの基準形（[r,c]）と色
  const SHAPES = {
    I: { cells: [[1, 0], [1, 1], [1, 2], [1, 3]], color: '#3fd0d0' },
    O: { cells: [[0, 0], [0, 1], [1, 0], [1, 1]], color: '#f1c40f' },
    T: { cells: [[0, 1], [1, 0], [1, 1], [1, 2]], color: '#a259c4' },
    S: { cells: [[0, 1], [0, 2], [1, 0], [1, 1]], color: '#2ecc71' },
    Z: { cells: [[0, 0], [0, 1], [1, 1], [1, 2]], color: '#e74c3c' },
    J: { cells: [[0, 0], [1, 0], [1, 1], [1, 2]], color: '#3498db' },
    L: { cells: [[0, 2], [1, 0], [1, 1], [1, 2]], color: '#e67e22' }
  };
  const TYPES = Object.keys(SHAPES);

  function rotateCW(cells) {
    const maxR = Math.max(...cells.map((c) => c[0]));
    return cells.map(([r, c]) => [c, maxR - r]);
  }
  // 各ピースの全回転形を用意（重複除去）
  const ROTATIONS = {};
  for (const t of TYPES) {
    const rots = [];
    let cur = SHAPES[t].cells.map((c) => c.slice());
    for (let i = 0; i < 4; i++) {
      const norm = normalize(cur);
      if (!rots.some((rr) => sameShape(rr, norm))) rots.push(norm);
      cur = rotateCW(cur);
    }
    ROTATIONS[t] = rots;
  }
  function normalize(cells) {
    const minR = Math.min(...cells.map((c) => c[0]));
    const minC = Math.min(...cells.map((c) => c[1]));
    return cells.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  function sameShape(a, b) {
    return a.length === b.length && a.every((c, i) => c[0] === b[i][0] && c[1] === b[i][1]);
  }

  let board = [];            // ROWS×COLS, '' or color
  let cur = null;            // { type, rot, r, c }
  let nextType = null;
  let target = null;         // AI 目標 { rot, c }
  let score = 0, lines = 0, level = 1;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let auto = false, timer = null, over = false;
  let moveAccum = 0, gravityAccum = 0, restartCountdown = -1;
  let clearRows = [];        // 消去演出中の行
  let clearTimer = 0;        // 残り演出ティック
  const CLEAR_TICKS = 11;    // 消去エフェクトの長さ（約 0.36 秒）

  const emptyBoard = () => Array.from({ length: ROWS }, () => new Array(COLS).fill(''));
  const randType = () => TYPES[(Math.random() * TYPES.length) | 0];

  function moveIntervalTicks() { return Math.max(1, 4 - Math.floor(level / 3)); }
  function gravityTicks() { return Math.max(2, 14 - level); }

  function cellsOf(type, rot, r, c) {
    return ROTATIONS[type][rot % ROTATIONS[type].length].map(([dr, dc]) => [r + dr, c + dc]);
  }
  function collides(type, rot, r, c) {
    return cellsOf(type, rot, r, c).some(([rr, cc]) =>
      cc < 0 || cc >= COLS || rr >= ROWS || (rr >= 0 && board[rr][cc] !== ''));
  }

  function spawn() {
    const type = nextType || randType();
    nextType = randType();
    const rot = 0;
    const c = Math.floor((COLS - 4) / 2);
    cur = { type, rot, r: 0, c };
    if (collides(type, rot, cur.r, cur.c)) { gameOver(); return; }
    target = auto ? bestPlacement() : null;
    moveAccum = 0; gravityAccum = 0;
  }

  function lockPiece() {
    for (const [r, c] of cellsOf(cur.type, cur.rot, cur.r, cur.c))
      if (r >= 0) board[r][c] = SHAPES[cur.type].color;
    cur = null;
    // 揃った行があれば消去演出へ（実際の削除は performClear で）
    const full = [];
    for (let r = 0; r < ROWS; r++) if (board[r].every((v) => v !== '')) full.push(r);
    if (full.length) {
      clearRows = full;
      clearTimer = CLEAR_TICKS;
      if (window.SFX) SFX.clearLine();
    } else {
      if (window.SFX) SFX.land();
      spawn();
    }
  }

  function performClear() {
    const cleared = clearRows.length;
    clearRows.sort((a, b) => b - a).forEach((r) => {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(''));
    });
    score += [0, 100, 300, 500, 800][cleared] * level;
    lines += cleared;
    level = 1 + Math.floor(lines / 10);
    clearRows = [];
    updateScores();
    spawn();
  }

  // ---- AI（全配置を評価して最善を選ぶ） ----
  function columnHeights(b) {
    const h = new Array(COLS).fill(0);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) { if (b[r][c] !== '') { h[c] = ROWS - r; break; } }
    }
    return h;
  }
  function evaluate(b, clearedLines) {
    const h = columnHeights(b);
    const agg = h.reduce((a, v) => a + v, 0);
    let holes = 0;
    for (let c = 0; c < COLS; c++) {
      let block = false;
      for (let r = 0; r < ROWS; r++) {
        if (b[r][c] !== '') block = true;
        else if (block) holes++;
      }
    }
    let bump = 0;
    for (let c = 0; c < COLS - 1; c++) bump += Math.abs(h[c] - h[c + 1]);
    return -0.510066 * agg + 0.760666 * clearedLines - 0.35663 * holes - 0.184483 * bump;
  }
  function dropRow(type, rot, c) {
    let r = -2;
    while (!collides(type, rot, r + 1, c)) r++;
    return r;
  }
  function simulate(type, rot, c) {
    const r = dropRow(type, rot, c);
    if (r < -1) return null;
    const b = board.map((row) => row.slice());
    for (const [rr, cc] of cellsOf(type, rot, r, c)) {
      if (rr < 0) return null; // 天井外＝置けない
      b[rr][cc] = '#';
    }
    let cleared = 0;
    for (let rr = ROWS - 1; rr >= 0; rr--) {
      if (b[rr].every((v) => v !== '')) { b.splice(rr, 1); b.unshift(new Array(COLS).fill('')); cleared++; rr++; }
    }
    return { board: b, cleared };
  }
  function bestPlacement() {
    let best = null, bestScore = -Infinity;
    const rots = ROTATIONS[cur.type].length;
    for (let rot = 0; rot < rots; rot++) {
      for (let c = -3; c < COLS; c++) {
        if (collides(cur.type, rot, 0, c) && dropRow(cur.type, rot, c) < 0) continue;
        const sim = simulate(cur.type, rot, c);
        if (!sim) continue;
        const sc = evaluate(sim.board, sim.cleared);
        if (sc > bestScore) { bestScore = sc; best = { rot, c }; }
      }
    }
    return best;
  }

  function aiStep() {
    if (!cur || !target) return;
    if (cur.rot !== target.rot) {
      if (!collides(cur.type, cur.rot + 1, cur.r, cur.c)) cur.rot = (cur.rot + 1) % ROTATIONS[cur.type].length;
      else softDrop();
    } else if (cur.c !== target.c) {
      const dc = Math.sign(target.c - cur.c);
      if (!collides(cur.type, cur.rot, cur.r, cur.c + dc)) cur.c += dc;
      else softDrop();
    } else {
      // 位置確定 → 一気に落とす
      cur.r = dropRow(cur.type, cur.rot, cur.c);
      lockPiece();
    }
  }
  function softDrop() {
    if (!cur) return;
    if (!collides(cur.type, cur.rot, cur.r + 1, cur.c)) cur.r++;
    else lockPiece();
  }

  function gameOver() {
    over = true;
    restartCountdown = RESTART_TICKS;
    ctx.showOverlay('GAME OVER', auto ? `Lv.${level} ・自動リスタート…` : `Lv.${level} ・キーで再開`);
  }
  function reset() {
    board = emptyBoard();
    score = 0; lines = 0; level = 1;
    over = false; restartCountdown = -1;
    clearRows = []; clearTimer = 0;
    cur = null; nextType = randType();
    ctx.hideOverlay();
    spawn();
    updateScores();
    render();
  }
  function updateScores() {
    if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
    ctx.setScores(score, best, `Lv.${level} ・${lines}行`);
  }

  function tick() {
    if (over) {
      if (auto && restartCountdown >= 0 && --restartCountdown <= 0) reset();
      render();
      return;
    }
    if (clearTimer > 0) { // 消去エフェクト中は進行を止める
      if (--clearTimer <= 0) performClear();
      render();
      return;
    }
    if (auto) {
      if (++moveAccum >= moveIntervalTicks()) { moveAccum = 0; aiStep(); }
    } else {
      if (++gravityAccum >= gravityTicks()) { gravityAccum = 0; softDrop(); }
    }
    render();
  }

  // ---- 描画（ドット風ブロック） ----
  let scale = 16, offX = 0, offY = 0, sideW = 0;

  function relayout() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    // 右側に NEXT 用の余白（4 列分）
    scale = Math.min(canvas.width / (COLS + 4.5), canvas.height / ROWS);
    const boardW = COLS * scale, boardH = ROWS * scale;
    offX = Math.max(0, (canvas.width - (COLS + 4.5) * scale) / 2);
    offY = (canvas.height - boardH) / 2;
    sideW = scale * 4.5;
    render();
  }

  const sx = (c) => offX + c * scale;
  const sy = (r) => offY + r * scale;

  function block(x, y, color) {
    g2d.fillStyle = color;
    g2d.fillRect(x, y, scale, scale);
    g2d.fillStyle = 'rgba(255,255,255,0.28)';
    g2d.fillRect(x, y, scale, scale * 0.16);
    g2d.fillRect(x, y, scale * 0.16, scale);
    g2d.fillStyle = 'rgba(0,0,0,0.28)';
    g2d.fillRect(x, y + scale * 0.84, scale, scale * 0.16);
    g2d.fillRect(x + scale * 0.84, y, scale * 0.16, scale);
  }

  function render() {
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    const boardW = COLS * scale, boardH = ROWS * scale;
    g2d.fillStyle = '#0e1118';
    g2d.fillRect(sx(0), sy(0), boardW, boardH);
    // グリッド
    g2d.strokeStyle = 'rgba(255,255,255,0.05)';
    g2d.lineWidth = 1;
    for (let c = 1; c < COLS; c++) { g2d.beginPath(); g2d.moveTo(sx(c), sy(0)); g2d.lineTo(sx(c), sy(0) + boardH); g2d.stroke(); }
    for (let r = 1; r < ROWS; r++) { g2d.beginPath(); g2d.moveTo(sx(0), sy(r)); g2d.lineTo(sx(0) + boardW, sy(r)); g2d.stroke(); }

    // 固定ブロック（消去演出中の行は除く）
    for (let r = 0; r < ROWS; r++) {
      if (clearTimer > 0 && clearRows.includes(r)) continue;
      for (let c = 0; c < COLS; c++)
        if (board[r][c]) block(sx(c), sy(r), board[r][c]);
    }

    // ライン消去エフェクト：白フラッシュ＋中央から外へ消えていくワイプ
    if (clearTimer > 0) {
      const p = 1 - clearTimer / CLEAR_TICKS;        // 0→1 で進行
      const flash = 0.5 + 0.5 * Math.sin(clearTimer * 1.3);
      const reach = p * (COLS / 2 + 0.5);            // 中央からの消去到達幅
      for (const r of clearRows) {
        for (let c = 0; c < COLS; c++) {
          if (Math.abs(c - (COLS - 1) / 2) < reach) continue; // 既に消えた中央部
          block(sx(c), sy(r), board[r][c] || '#ffffff');
          g2d.fillStyle = `rgba(255,255,255,${0.65 * flash})`;
          g2d.fillRect(sx(c), sy(r), scale, scale);
        }
        // 端に残る光のライン
        g2d.fillStyle = `rgba(255,255,255,${0.25 * flash})`;
        g2d.fillRect(sx(0), sy(r) + scale * 0.45, COLS * scale, scale * 0.1);
      }
    }

    // ゴースト＋落下中ピース（落下中は発光）
    if (cur) {
      const gr = dropRow(cur.type, cur.rot, cur.c);
      g2d.globalAlpha = 0.22;
      for (const [r, c] of cellsOf(cur.type, cur.rot, gr, cur.c))
        if (r >= 0) block(sx(c), sy(r), SHAPES[cur.type].color);
      g2d.globalAlpha = 1;
      g2d.save();
      g2d.shadowColor = SHAPES[cur.type].color; g2d.shadowBlur = scale * 0.7;
      for (const [r, c] of cellsOf(cur.type, cur.rot, cur.r, cur.c))
        if (r >= 0) block(sx(c), sy(r), SHAPES[cur.type].color);
      g2d.restore();
    }

    // NEXT
    if (nextType) {
      const nx = sx(COLS) + scale * 0.6, ny = sy(0) + scale * 0.4;
      g2d.fillStyle = '#8a8f99';
      g2d.font = `bold ${Math.floor(scale * 0.6)}px sans-serif`;
      g2d.fillText('NEXT', nx, ny);
      const ns = scale * 0.8;
      for (const [r, c] of ROTATIONS[nextType][0]) {
        const x = nx + c * ns, y = ny + scale * 0.4 + r * ns;
        g2d.fillStyle = SHAPES[nextType].color;
        g2d.fillRect(x, y, ns - 1, ns - 1);
      }
    }
  }

  // ---- 共通インターフェース ----
  return {
    name: 'tetris',
    show() {
      wrapEl.style.display = 'flex';
      if (board.length === 0) reset();
      relayout();
      updateScores();
      if (timer === null) timer = setInterval(tick, TICK_MS);
    },
    hide() { clearInterval(timer); timer = null; wrapEl.style.display = 'none'; },
    setAuto(on) {
      auto = on;
      if (on && cur) target = bestPlacement();
    },
    key(e) {
      if (over) { reset(); return true; }
      if (!cur) return true;
      if (e.key === 'ArrowLeft') { if (!collides(cur.type, cur.rot, cur.r, cur.c - 1)) cur.c--; }
      else if (e.key === 'ArrowRight') { if (!collides(cur.type, cur.rot, cur.r, cur.c + 1)) cur.c++; }
      else if (e.key === 'ArrowUp') { if (!collides(cur.type, cur.rot + 1, cur.r, cur.c)) cur.rot = (cur.rot + 1) % ROTATIONS[cur.type].length; }
      else if (e.key === 'ArrowDown') softDrop();
      else if (e.key === ' ') { cur.r = dropRow(cur.type, cur.rot, cur.c); lockPiece(); }
      else return false;
      render();
      return true;
    },
    relayout,
    reset,
    isOver: () => over,
    _tick: tick,
    _state: () => ({ over, level, lines, score, auto, clearing: clearTimer > 0,
                     maxHeight: Math.max(...columnHeights(board)) })
  };
};
