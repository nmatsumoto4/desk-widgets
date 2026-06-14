// Rush Hour ウィジェットモジュール（描画・進行ループ・操作）
// AI は BFS の最短手順を再生し、クリアすると新しい問題を自動生成して解き続ける。
// 手動モードでは車をクリックで選択し、矢印キーでスライドする。

window.createWidgetRush = function (ctx) {
  const { N, EXIT_ROW } = window.Rush;
  const TICK_MS = 120;
  const MOVE_EVERY = 2;     // 何ティックごとに 1 手進めるか
  const CELEBRATE_TICKS = 10;
  const CARS_KEY = 'widgetRush.cars';
  const TOTAL_KEY = 'widgetRush.total';
  const CARS_MIN = 6, CARS_MAX = 12, CARS_DEFAULT = 10;

  const wrapEl = document.getElementById('rush');
  const canvas = document.getElementById('rush-canvas');
  const g2d = canvas.getContext('2d');
  const ctrlEl = document.getElementById('rush-ctrl');
  const carsLabelEl = document.getElementById('rush-cars-label');

  const CAR_COLORS = [
    '#e74c3c', // 0 = 赤い車（脱出対象）
    '#3498db', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c',
    '#34495e', '#d35400', '#7f8c8d', '#2980b9', '#16a085', '#8e44ad'
  ];

  let carCount = clampCars(Number(localStorage.getItem(CARS_KEY) || CARS_DEFAULT));
  let vehicles = [];
  let plan = [];
  let planPos = 0;
  let planDirty = false;
  let minMoves = 0;
  let movesUsed = 0;
  let session = 0;
  let total = Number(localStorage.getItem(TOTAL_KEY) || 0);
  let auto = false;
  let timer = null;
  let state = 'play'; // play | clearing | celebrate
  let selected = -1;
  let moveCounter = 0;
  let celebrateTicks = 0;

  function clampCars(n) {
    return Math.max(CARS_MIN, Math.min(CARS_MAX, isNaN(n) ? CARS_DEFAULT : n));
  }

  function newPuzzle() {
    // 目標手数は台数に応じて引き上げる（デフォルトで複雑な問題）
    let res = Rush.genPuzzle(carCount, { target: 12 + carCount, budgetMs: 700 });
    if (!res) res = Rush.genPuzzle(carCount, { target: 4, budgetMs: 1500 });
    if (!res) { // 理論上ほぼ到達しないが、台数を 1 減らして救済
      carCount = clampCars(carCount - 1);
      res = Rush.genPuzzle(carCount, { target: 4, budgetMs: 1500 });
    }
    vehicles = res.vehicles;
    plan = res.sol;
    planPos = 0;
    planDirty = false;
    minMoves = plan.length;
    movesUsed = 0;
    selected = -1;
    moveCounter = 0;
    state = 'play';
    ctx.hideOverlay();
    updateScores();
    updateCarsLabel();
    render();
  }

  function updateScores() {
    ctx.setScores(session, total, `${carCount} 台・最短 ${minMoves} 手`);
  }

  function updateCarsLabel() {
    carsLabelEl.textContent = `車 ${carCount} 台`;
  }

  function applyMove(idx, delta) {
    const v = vehicles[idx];
    if (v.horiz) v.c += delta; else v.r += delta;
    movesUsed++;
  }

  function tick() {
    if (state === 'clearing') {
      // 赤い車が出口から走り去るアニメーション
      vehicles[0].c++;
      if (vehicles[0].c > N) {
        state = 'celebrate';
        celebrateTicks = CELEBRATE_TICKS;
        session++;
        total++;
        localStorage.setItem(TOTAL_KEY, String(total));
        if (window.SFX) SFX.win();
        ctx.showOverlay('CLEAR!', `${movesUsed} 手（最短 ${minMoves} 手）`);
        updateScores();
      }
      render();
      return;
    }
    if (state === 'celebrate') {
      if (--celebrateTicks <= 0) newPuzzle();
      return;
    }

    // play
    if (vehicles[0].c === N - vehicles[0].len) {
      state = 'clearing';
      render();
      return;
    }
    if (!auto) return;
    if (++moveCounter < MOVE_EVERY) return;
    moveCounter = 0;

    // 手動操作などで盤面が計画とずれたら現在地から解き直す
    if (planDirty || planPos >= plan.length) {
      const sol = Rush.solve(vehicles);
      if (!sol) { newPuzzle(); return; } // 起こり得ないが保険
      plan = sol;
      planPos = 0;
      planDirty = false;
      if (plan.length === 0) return; // 既に出口（次ティックの判定で clearing へ）
    }
    const mv = plan[planPos++];
    applyMove(mv.idx, mv.delta);
    render();
  }

  // ---- 描画 ----

  let cell = 30;

  function relayout() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    // 右側に出口分の余白 0.4 マス
    cell = Math.floor(Math.min(
      (rect.width * dpr) / (N + 0.4),
      (rect.height * dpr) / N
    ));
    canvas.width = Math.floor(cell * (N + 0.4));
    canvas.height = Math.floor(cell * N);
    canvas.style.width = `${canvas.width / dpr}px`;
    canvas.style.height = `${canvas.height / dpr}px`;
    render();
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return `rgb(${ch((n >> 16 & 255) * f)},${ch((n >> 8 & 255) * f)},${ch((n & 255) * f)})`;
  }

  function render() {
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    const fieldW = N * cell;

    // 盤面（縦グラデ＋格子）
    const bg = g2d.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, '#3d362f'); bg.addColorStop(1, '#2a2521');
    g2d.fillStyle = bg;
    g2d.fillRect(0, 0, fieldW, canvas.height);
    g2d.strokeStyle = 'rgba(255,255,255,0.06)';
    g2d.lineWidth = 1;
    for (let i = 1; i < N; i++) {
      g2d.beginPath();
      g2d.moveTo(i * cell, 0); g2d.lineTo(i * cell, canvas.height);
      g2d.moveTo(0, i * cell); g2d.lineTo(fieldW, i * cell);
      g2d.stroke();
    }

    // 出口（矢印・発光）
    const ey = (EXIT_ROW + 0.5) * cell;
    g2d.save();
    g2d.shadowColor = '#2ecc71'; g2d.shadowBlur = cell * 0.4;
    g2d.fillStyle = '#2ecc71';
    g2d.beginPath();
    g2d.moveTo(fieldW + cell * 0.05, ey - cell * 0.24);
    g2d.lineTo(fieldW + cell * 0.34, ey);
    g2d.lineTo(fieldW + cell * 0.05, ey + cell * 0.24);
    g2d.closePath();
    g2d.fill();
    g2d.restore();

    // 車両（グラデ＋光沢、赤い車は発光）
    vehicles.forEach((v, i) => {
      const w = (v.horiz ? v.len : 1) * cell;
      const h = (v.horiz ? 1 : v.len) * cell;
      const x = v.c * cell, y = v.r * cell;
      const pad = cell * 0.08;
      const bx = x + pad, by = y + pad, bw = w - pad * 2, bh = h - pad * 2;
      const col = CAR_COLORS[i % CAR_COLORS.length];
      g2d.save();
      if (i === 0) { g2d.shadowColor = col; g2d.shadowBlur = cell * 0.45; }
      const g = g2d.createLinearGradient(bx, by, bx, by + bh);
      g.addColorStop(0, shade(col, 1.25)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, 0.7));
      g2d.fillStyle = g;
      roundRect(bx, by, bw, bh, cell * 0.22); g2d.fill();
      g2d.restore();
      // 上面ハイライト
      g2d.fillStyle = 'rgba(255,255,255,0.25)';
      roundRect(bx + cell * 0.12, by + cell * 0.1, bw - cell * 0.24, bh * 0.28, cell * 0.12); g2d.fill();
      if (i === selected) {
        g2d.strokeStyle = '#fff';
        g2d.lineWidth = Math.max(2, cell * 0.06);
        roundRect(bx, by, bw, bh, cell * 0.22); g2d.stroke();
      }
      if (i === 0) {
        g2d.fillStyle = 'rgba(255,255,255,0.95)';
        g2d.font = `bold ${Math.floor(cell * 0.42)}px sans-serif`;
        g2d.textAlign = 'center'; g2d.textBaseline = 'middle';
        g2d.fillText('★', x + w / 2, y + h / 2);
        g2d.textAlign = 'left'; g2d.textBaseline = 'alphabetic';
      }
    });
  }

  function roundRect(x, y, w, h, r) {
    g2d.beginPath();
    g2d.moveTo(x + r, y);
    g2d.arcTo(x + w, y, x + w, y + h, r);
    g2d.arcTo(x + w, y + h, x, y + h, r);
    g2d.arcTo(x, y + h, x, y, r);
    g2d.arcTo(x, y, x + w, y, r);
    g2d.closePath();
  }

  // ---- 操作 ----

  // 車をクリックで選択（手動モード用）
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const c = Math.floor(((e.clientX - rect.left) * dpr) / cell);
    const r = Math.floor(((e.clientY - rect.top) * dpr) / cell);
    selected = -1;
    const grid = Rush.buildGrid(vehicles);
    if (r >= 0 && r < N && c >= 0 && c < N && grid[r][c] >= 0) {
      selected = grid[r][c];
    }
    render();
  });

  function setCars(n) {
    carCount = clampCars(n);
    localStorage.setItem(CARS_KEY, String(carCount));
    newPuzzle();
  }

  document.getElementById('rush-minus').addEventListener('click', () => setCars(carCount - 1));
  document.getElementById('rush-plus').addEventListener('click', () => setCars(carCount + 1));

  // ---- 共通インターフェース ----

  return {
    name: 'rush',
    show() {
      wrapEl.style.display = 'flex';
      ctrlEl.style.display = 'inline-flex';
      if (vehicles.length === 0) newPuzzle();
      relayout();
      updateScores();
      updateCarsLabel();
      if (timer === null) timer = setInterval(tick, TICK_MS);
    },
    hide() {
      clearInterval(timer);
      timer = null;
      wrapEl.style.display = 'none';
      ctrlEl.style.display = 'none';
    },
    setAuto(on) {
      auto = on;
      if (on) planDirty = true; // 現在の盤面から解き直す
    },
    key(e) {
      if (state !== 'play') return true;
      if (selected < 0) selected = 0; // 未選択なら赤い車
      const v = vehicles[selected];
      let delta = 0;
      if (v.horiz && e.key === 'ArrowLeft') delta = -1;
      else if (v.horiz && e.key === 'ArrowRight') delta = 1;
      else if (!v.horiz && e.key === 'ArrowUp') delta = -1;
      else if (!v.horiz && e.key === 'ArrowDown') delta = 1;
      if (delta !== 0 && Rush.canMove(vehicles, selected, delta)) {
        applyMove(selected, delta);
        planDirty = true;
      }
      render();
      return true;
    },
    relayout,
    reset: newPuzzle,
    isOver: () => false, // Rush Hour に死はない（常に可解）
    // テスト用フック
    _tick: tick,
    _state: () => ({ state, movesUsed, minMoves, session, total, carCount,
                     redC: vehicles[0] ? vehicles[0].c : -1,
                     cars: vehicles.length, planLeft: plan.length - planPos })
  };
};
