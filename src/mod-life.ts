// ライフゲーム ウィジェットモジュール（Conway's Game of Life）
//
// ・初期値はランダム。盤面はトーラス（端がつながる）で B3/S23。
// ・世代をまたいで動かなくなった／停滞したら、ランダムに細胞を足して動きを復活させる。
// ・フッターのセレクトで有名プリセット（グライダー銃・パルサー等）をセットできる。
// ・常に自動で世代が進む（眺める系ウィジェット）。手動時：← → プリセット切替、Space でランダム追加。

window.createWidgetLife = function (ctx) {
  const TICK_MS = 33;
  const STEP_TICKS = 3;       // 何ティックごとに 1 世代進めるか（約 10 世代/秒）
  const CELL_TARGET = 6;      // 1 マスの目安 px（小さめ＝多数の細胞。グライダー銃が収まる幅を確保）
  const STALL_LIMIT = 30;     // 低活性がこの世代続いたらランダム注入
  const CYCLE_LIMIT = 6;      // 周期 1/2 のループがこの世代続いたらランダム注入
  const BEST_KEY = 'widgetLife.peak';

  const wrapEl = document.getElementById('life');
  const canvas = document.getElementById('life-canvas') as HTMLCanvasElement;
  const g2d = canvas.getContext('2d');
  const ctrlEl = document.getElementById('life-ctrl');
  const presetSel = document.getElementById('life-preset') as HTMLSelectElement;

  let COLS = 32, ROWS = 36;
  let cell: any = [];             // Uint8 alive
  let age: any = [];              // 生存世代数（色付け用）
  let generation = 0, population = 0, peak = Number(localStorage.getItem(BEST_KEY) || 0);
  let stall = 0;
  let hashPrev = 0, hashPrev2 = 0, cycleHits = 0; // 周期ループ検出用
  let stepAccum = 0;
  let auto = false, timer = null;
  let presetIdx = 0;

  // ---- プリセット（[r,c] の相対座標） ----
  const PRESETS = [
    { id: 'random', label: 'ランダム' },
    { id: 'glider', label: 'グライダー', cells: [[0,1],[1,2],[2,0],[2,1],[2,2]] },
    { id: 'lwss', label: '軽量宇宙船', cells: [[0,1],[0,4],[1,0],[2,0],[2,4],[3,0],[3,1],[3,2],[3,3]] },
    { id: 'rpent', label: 'R-ペントミノ', cells: [[0,1],[0,2],[1,0],[1,1],[2,1]] },
    { id: 'acorn', label: 'どんぐり', cells: [[0,1],[1,3],[2,0],[2,1],[2,4],[2,5],[2,6]] },
    { id: 'pulsar', label: 'パルサー', cells: [
      [0,2],[0,3],[0,4],[0,8],[0,9],[0,10],
      [2,0],[2,5],[2,7],[2,12],[3,0],[3,5],[3,7],[3,12],[4,0],[4,5],[4,7],[4,12],
      [5,2],[5,3],[5,4],[5,8],[5,9],[5,10],
      [7,2],[7,3],[7,4],[7,8],[7,9],[7,10],
      [8,0],[8,5],[8,7],[8,12],[9,0],[9,5],[9,7],[9,12],[10,0],[10,5],[10,7],[10,12],
      [12,2],[12,3],[12,4],[12,8],[12,9],[12,10] ] },
    { id: 'pentadeca', label: 'ペンタデカスロン', cells: [
      [0,2],[0,7],
      [1,0],[1,1],[1,3],[1,4],[1,5],[1,6],[1,8],[1,9],
      [2,2],[2,7] ] },
    { id: 'gun', label: 'グライダー銃', cells: [
      [5,1],[5,2],[6,1],[6,2],
      [5,11],[6,11],[7,11],[4,12],[8,12],[3,13],[9,13],[3,14],[9,14],
      [6,15],[4,16],[8,16],[5,17],[6,17],[7,17],[6,18],
      [3,21],[4,21],[5,21],[3,22],[4,22],[5,22],[2,23],[6,23],
      [1,25],[2,25],[6,25],[7,25],[3,35],[4,35],[3,36],[4,36] ] }
  ];

  const idx = (r, c) => r * COLS + c;

  function allocGrids() {
    cell = new Uint8Array(ROWS * COLS);
    age = new Uint16Array(ROWS * COLS);
  }

  function randomSoup(density) {
    for (let i = 0; i < cell.length; i++) {
      cell[i] = Math.random() < density ? 1 : 0;
      age[i] = cell[i];
    }
  }

  // 既存盤面にランダム細胞を散布（停滞の打破）
  function injectSoup(amount) {
    for (let i = 0; i < amount; i++) {
      const k = (Math.random() * cell.length) | 0;
      if (!cell[k]) { cell[k] = 1; age[k] = 1; }
    }
  }

  function placePreset(p) {
    cell.fill(0); age.fill(0);
    if (p.id === 'random' || !p.cells) {
      randomSoup(0.28);
    } else {
      const maxR = Math.max(...p.cells.map((c) => c[0]));
      const maxC = Math.max(...p.cells.map((c) => c[1]));
      // 銃は左上寄せ、その他は中央寄せ
      const startR = p.id === 'gun' ? 2 : Math.max(0, ((ROWS - maxR) / 2) | 0);
      const startC = p.id === 'gun' ? 2 : Math.max(0, ((COLS - maxC) / 2) | 0);
      for (const [dr, dc] of p.cells) {
        const r = startR + dr, c = startC + dc;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) { cell[idx(r, c)] = 1; age[idx(r, c)] = 1; }
      }
    }
    generation = 0; stall = 0;
    hashPrev = 0; hashPrev2 = 0; cycleHits = 0;
    countPop();
    updateScores();
    render();
  }

  // 盤面のハッシュ（周期検出用）
  function hashGrid(arr) {
    let h = 2166136261;
    for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // 手動ランダム追加（ボタン／Space 用）
  function manualRandom() {
    injectSoup(Math.max(16, (cell.length * 0.05) | 0));
    countPop();
    updateScores();
    render();
  }

  function setPreset(id) {
    const i = PRESETS.findIndex((p) => p.id === id);
    presetIdx = i < 0 ? 0 : i;
    presetSel.value = PRESETS[presetIdx].id;
    placePreset(PRESETS[presetIdx]);
  }

  function countPop() {
    let n = 0;
    for (let i = 0; i < cell.length; i++) n += cell[i];
    population = n;
    if (n > peak) { peak = n; localStorage.setItem(BEST_KEY, String(peak)); }
  }

  function updateScores() {
    ctx.setScores(population, peak, `第${generation}世代`);
  }

  // ---- 1 世代進める（トーラス・B3/S23） ----
  function stepGen() {
    const next = new Uint8Array(ROWS * COLS);
    let changed = 0, pop = 0;
    for (let r = 0; r < ROWS; r++) {
      const rUp = (r - 1 + ROWS) % ROWS, rDn = (r + 1) % ROWS;
      for (let c = 0; c < COLS; c++) {
        const cL = (c - 1 + COLS) % COLS, cR = (c + 1) % COLS;
        const n = cell[idx(rUp, cL)] + cell[idx(rUp, c)] + cell[idx(rUp, cR)] +
                  cell[idx(r, cL)] + cell[idx(r, cR)] +
                  cell[idx(rDn, cL)] + cell[idx(rDn, c)] + cell[idx(rDn, cR)];
        const alive = cell[idx(r, c)];
        const live = alive ? (n === 2 || n === 3) : (n === 3);
        const k = idx(r, c);
        if (live) {
          next[k] = 1; pop++;
          age[k] = alive ? Math.min(65535, age[k] + 1) : 1;
        } else {
          next[k] = 0; age[k] = 0;
        }
        if (next[k] !== alive) changed++;
      }
    }
    cell = next;
    generation++;
    population = pop;
    if (pop > peak) { peak = pop; localStorage.setItem(BEST_KEY, String(peak)); }

    // 周期 1/2 ループ検出（2 世代前と一致＝点滅で止まっている状態）
    const h = hashGrid(cell);
    const looping = (h === hashPrev || h === hashPrev2);
    hashPrev2 = hashPrev; hashPrev = h;

    // 停滞検出 → ランダム注入で動きを復活
    const big = Math.max(14, (cell.length * 0.035) | 0);
    const lowAct = changed < Math.max(3, (cell.length * 0.015) | 0);
    let injected = false;
    if (pop === 0 || changed === 0) {           // 完全停止・全滅
      injectSoup(big); injected = true;
    } else if (looping) {                        // 周期 1/2 のループ
      if (++cycleHits >= CYCLE_LIMIT) { injectSoup(big); injected = true; }
    } else {
      cycleHits = 0;
    }
    if (!injected) {                             // 長く続く低活性
      if (lowAct) { if (++stall >= STALL_LIMIT) { injectSoup(big); injected = true; } }
      else stall = 0;
    }
    if (injected) { stall = 0; cycleHits = 0; hashPrev = 0; hashPrev2 = 0; }
  }

  function tick() {
    if (++stepAccum >= STEP_TICKS) {
      stepAccum = 0;
      stepGen();
      updateScores();
    }
    render();
  }

  // ---- 描画（ドット） ----
  let scale = 8, offX = 0, offY = 0;

  function applyGridSize() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // グライダー銃（幅約 39）が常に収まるよう最小 40 列を確保
    const cols = Math.max(40, Math.min(80, Math.round(rect.width / CELL_TARGET)));
    const rows = Math.max(30, Math.min(90, Math.round(rect.height / CELL_TARGET)));
    if (cols !== COLS || rows !== ROWS || cell.length === 0) {
      COLS = cols; ROWS = rows;
      allocGrids();
      placePreset(PRESETS[presetIdx]);
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

  function ageColor(a) {
    const hue = Math.min(190, 60 + a * 11);   // 若い=黄緑 → 古い=シアン
    const light = Math.max(45, 64 - a * 2);
    return `hsl(${hue}, 72%, ${light}%)`;
  }

  function render() {
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    const bg = g2d.createLinearGradient(0, offY, 0, offY + ROWS * scale);
    bg.addColorStop(0, '#0a0d16'); bg.addColorStop(1, '#11151f');
    g2d.fillStyle = bg;
    g2d.fillRect(offX, offY, COLS * scale, ROWS * scale);
    const r = Math.max(1, scale * 0.42);

    // ネオンの発光（加算合成のハロー）。重い shadowBlur を避け、数が多い時はスキップ
    if (population <= 1600) {
      g2d.globalCompositeOperation = 'lighter';
      g2d.globalAlpha = 0.35;
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const k = idx(row, col);
          if (!cell[k]) continue;
          g2d.fillStyle = ageColor(age[k]);
          g2d.beginPath();
          g2d.arc(offX + col * scale + scale / 2, offY + row * scale + scale / 2, r * 2, 0, Math.PI * 2);
          g2d.fill();
        }
      }
      g2d.globalAlpha = 1;
      g2d.globalCompositeOperation = 'source-over';
    }

    // 本体
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const k = idx(row, col);
        if (!cell[k]) continue;
        g2d.fillStyle = ageColor(age[k]);
        const x = offX + col * scale, y = offY + row * scale;
        g2d.beginPath();
        g2d.arc(x + scale / 2, y + scale / 2, r, 0, Math.PI * 2);
        g2d.fill();
      }
    }
  }

  presetSel.addEventListener('change', () => setPreset(presetSel.value));
  document.getElementById('life-random').addEventListener('click', manualRandom);

  // ---- 共通インターフェース ----
  return {
    name: 'life',
    show() {
      wrapEl.style.display = 'flex';
      ctrlEl.style.display = 'inline-flex';
      if (presetSel.options.length === 0) {
        for (const p of PRESETS) {
          const o = document.createElement('option');
          o.value = p.id; o.textContent = p.label;
          presetSel.appendChild(o);
        }
      }
      presetSel.value = PRESETS[presetIdx].id;
      relayout();
      updateScores();
      if (timer === null) timer = setInterval(tick, TICK_MS);
    },
    hide() {
      clearInterval(timer); timer = null;
      wrapEl.style.display = 'none';
      ctrlEl.style.display = 'none';
    },
    setAuto(on) { auto = on; }, // ライフは常に進行（眺める系）
    key(e) {
      if (e.key === 'ArrowRight') setPreset(PRESETS[(presetIdx + 1) % PRESETS.length].id);
      else if (e.key === 'ArrowLeft') setPreset(PRESETS[(presetIdx - 1 + PRESETS.length) % PRESETS.length].id);
      else if (e.key === ' ') manualRandom();
      else return false;
      return true;
    },
    relayout,
    reset: () => setPreset('random'),
    isOver: () => false,
    _tick: tick,
    _step: stepGen,
    _setCells: (list) => {
      cell.fill(0); age.fill(0);
      for (const [r, c] of list) { cell[idx(r, c)] = 1; age[idx(r, c)] = 1; }
      generation = 0; stall = 0; cycleHits = 0; hashPrev = 0; hashPrev2 = 0;
      countPop();
    },
    _state: () => ({ generation, population, peak, stall, cycleHits, cols: COLS, rows: ROWS,
                     preset: PRESETS[presetIdx].id })
  };
};
