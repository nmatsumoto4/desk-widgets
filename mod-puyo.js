// ぷよぷよ ウィジェットモジュール（描画・進行ループ・操作）
// app.js から共通インターフェース（show/hide/setAuto/key/relayout/reset）で呼ばれる

window.createWidgetPuyo = function (ctx) {
  const { W, H, CHILD_D, CHAIN_BONUS } = window.Puyo;
  const TICK_MS = 90;
  const MANUAL_FALL_TICKS = 6; // 手動時の自然落下間隔（ティック数）
  const RESTART_TICKS = 9;
  const BEST_KEY = 'widgetPuyo.best';
  const GAMES_KEY = 'widgetPuyo.games';
  const MAXCHAIN_KEY = 'widgetPuyo.maxChain';

  const wrapEl = document.getElementById('puyo');
  const canvas = document.getElementById('puyo-canvas');
  const g2d = canvas.getContext('2d');
  const PUYO_COLORS = ['', '#e74c3c', '#27ae60', '#3498db', '#f1c40f'];

  let grid = Puyo.emptyGrid();
  let queue = [rndPair(), rndPair()];
  let cur = null;          // 落下中ペア {colors:[軸,子], r, c, rot}
  let state = 'spawn';     // spawn | falling | check | popping
  let auto = false;
  let timer = null;
  let over = false;
  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let games = Number(localStorage.getItem(GAMES_KEY) || 0);
  let maxChain = Number(localStorage.getItem(MAXCHAIN_KEY) || 0);
  let chainNum = 0;        // 進行中の連鎖数
  let target = null;       // AI の目標 {col, rot}
  let popping = [];        // 消滅アニメ中のセル
  let popTicks = 0;
  let popGain = 0;
  let gravCounter = 0;
  let restartCountdown = -1;
  let chainLabelTicks = 0; // 「n 連鎖!」表示の残りティック

  function rndPair() {
    const r = () => 1 + Math.floor(Math.random() * Puyo.NUM_COLORS);
    return [r(), r()];
  }

  function pairCells(p) {
    const [dr, dc] = CHILD_D[p.rot];
    return [
      [p.r, p.c, p.colors[0]],
      [p.r + dr, p.c + dc, p.colors[1]]
    ];
  }

  function cellFree(r, c) {
    if (c < 0 || c >= W || r >= H) return false;
    if (r < 0) return true; // 盤面より上は通過可
    return grid[r][c] === 0;
  }

  function canPlace(p) {
    return pairCells(p).every(([r, c]) => cellFree(r, c));
  }

  function tryMove(dc) {
    if (!cur) return false;
    const moved = { ...cur, c: cur.c + dc };
    if (!canPlace(moved)) return false;
    cur = moved;
    return true;
  }

  function tryRotate() {
    if (!cur) return false;
    const rotated = { ...cur, rot: (cur.rot + 1) % 4 };
    if (canPlace(rotated)) { cur = rotated; return true; }
    // 壁キック：左右に 1 マスずらして試す
    for (const kick of [-1, 1]) {
      const kicked = { ...rotated, c: rotated.c + kick };
      if (canPlace(kicked)) { cur = kicked; return true; }
    }
    return false;
  }

  function tryFall() {
    if (!cur) return false;
    const fallen = { ...cur, r: cur.r + 1 };
    if (!canPlace(fallen)) return false;
    cur = fallen;
    return true;
  }

  function lock() {
    for (const [r, c, color] of pairCells(cur)) {
      if (r >= 0) grid[r][c] = color;
    }
    cur = null;
    chainNum = 0;
    Puyo.applyGravity(grid);
    state = 'check';
  }

  function gameOver() {
    over = true;
    games++;
    localStorage.setItem(GAMES_KEY, String(games));
    restartCountdown = RESTART_TICKS;
    ctx.showOverlay('GAME OVER', auto ? '自動リスタート…' : '矢印キーでリスタート');
  }

  function reset() {
    grid = Puyo.emptyGrid();
    queue = [rndPair(), rndPair()];
    cur = null;
    over = false;
    score = 0;
    chainNum = 0;
    state = 'spawn';
    restartCountdown = -1;
    ctx.hideOverlay();
    updateScores();
    render();
  }

  function updateScores() {
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
    }
    const info = [];
    if (games > 0) info.push(`${games} 周目`);
    if (maxChain > 0) info.push(`最大 ${maxChain} 連鎖`);
    ctx.setScores(score, best, info.join('・'));
  }

  function tick() {
    if (over) {
      if (auto && restartCountdown >= 0 && --restartCountdown <= 0) reset();
      return;
    }

    switch (state) {
      case 'spawn': {
        if (grid[0][2] !== 0 || grid[1][2] !== 0) { gameOver(); break; }
        cur = { colors: queue.shift(), r: 1, c: 2, rot: 0 };
        queue.push(rndPair());
        target = auto ? PuyoAI.bestPlacement(grid, cur.colors) : null;
        gravCounter = 0;
        state = 'falling';
        break;
      }
      case 'falling': {
        if (!cur) { state = 'spawn'; break; }
        if (auto && target) {
          // 1 ティックに 1 アクション：回転 → 横移動 → 高速落下（2 段/tick）
          if (cur.rot !== target.rot) {
            if (!tryRotate()) { if (!tryFall()) lock(); }
          } else if (cur.c !== target.col) {
            if (!tryMove(Math.sign(target.col - cur.c))) { if (!tryFall()) lock(); }
          } else {
            if (!tryFall()) { lock(); break; }
            if (!tryFall()) lock();
          }
        } else {
          if (++gravCounter >= MANUAL_FALL_TICKS) {
            gravCounter = 0;
            if (!tryFall()) lock();
          }
        }
        break;
      }
      case 'check': {
        const groups = Puyo.findGroups(grid);
        if (groups.length === 0) {
          state = 'spawn';
        } else {
          chainNum++;
          chainLabelTicks = 8;
          popping = groups.flat();
          let popped = popping.length;
          popGain = popped * 10 *
            CHAIN_BONUS[Math.min(chainNum - 1, CHAIN_BONUS.length - 1)];
          popTicks = 3;
          state = 'popping';
        }
        break;
      }
      case 'popping': {
        if (--popTicks <= 0) {
          for (const [r, c] of popping) grid[r][c] = 0;
          popping = [];
          score += popGain;
          if (chainNum > maxChain) {
            maxChain = chainNum;
            localStorage.setItem(MAXCHAIN_KEY, String(maxChain));
          }
          Puyo.applyGravity(grid);
          updateScores();
          state = 'check';
        }
        break;
      }
    }
    render();
  }

  // ---- 描画 ----

  let cell = 20; // 1 マスのデバイスピクセルサイズ（relayout で再計算）

  function relayout() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    // フィールド 6 列 + NEXT パネル 1.8 列分、可視 12 段
    const cols = W + 1.8;
    cell = Math.floor(Math.min(
      (rect.width * dpr) / cols,
      (rect.height * dpr) / (H - 1)
    ));
    canvas.width = Math.floor(cell * cols);
    canvas.height = Math.floor(cell * (H - 1));
    canvas.style.width = `${canvas.width / dpr}px`;
    canvas.style.height = `${canvas.height / dpr}px`;
    render();
  }

  function drawPuyo(r, c, color, alpha = 1) {
    if (r < 1) return; // 隠し段は描かない
    const x = c * cell, y = (r - 1) * cell;
    g2d.globalAlpha = alpha;
    g2d.fillStyle = PUYO_COLORS[color];
    g2d.beginPath();
    g2d.arc(x + cell / 2, y + cell / 2, cell * 0.42, 0, Math.PI * 2);
    g2d.fill();
    // 目（ハイライト）
    g2d.fillStyle = 'rgba(255,255,255,0.85)';
    g2d.beginPath();
    g2d.arc(x + cell * 0.38, y + cell * 0.4, cell * 0.1, 0, Math.PI * 2);
    g2d.arc(x + cell * 0.62, y + cell * 0.4, cell * 0.1, 0, Math.PI * 2);
    g2d.fill();
    g2d.globalAlpha = 1;
  }

  function render() {
    const fieldW = W * cell;
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    // フィールド背景
    g2d.fillStyle = '#4a4139';
    g2d.fillRect(0, 0, fieldW, canvas.height);

    const popSet = new Set(popping.map(([r, c]) => `${r},${c}`));
    for (let r = 1; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (grid[r][c] === 0) continue;
        const isPopping = popSet.has(`${r},${c}`);
        drawPuyo(r, c, grid[r][c], isPopping && popTicks % 2 === 0 ? 0.25 : 1);
      }
    }
    if (cur) for (const [r, c, color] of pairCells(cur)) drawPuyo(r, c, color);

    // NEXT パネル
    const px = fieldW + cell * 0.3;
    g2d.fillStyle = '#776e65';
    g2d.font = `bold ${Math.floor(cell * 0.42)}px sans-serif`;
    g2d.fillText('NEXT', px, cell * 0.6);
    const next = queue[0];
    if (next) {
      g2d.fillStyle = PUYO_COLORS[next[1]];
      g2d.beginPath();
      g2d.arc(px + cell * 0.5, cell * 1.4, cell * 0.38, 0, Math.PI * 2);
      g2d.fill();
      g2d.fillStyle = PUYO_COLORS[next[0]];
      g2d.beginPath();
      g2d.arc(px + cell * 0.5, cell * 2.3, cell * 0.38, 0, Math.PI * 2);
      g2d.fill();
    }

    // 連鎖表示
    if (chainLabelTicks > 0 && chainNum > 0) {
      chainLabelTicks--;
      g2d.fillStyle = 'rgba(255,255,255,0.92)';
      g2d.font = `bold ${Math.floor(cell * 0.9)}px sans-serif`;
      g2d.textAlign = 'center';
      g2d.fillText(`${chainNum} 連鎖!`, fieldW / 2, canvas.height * 0.4);
      g2d.textAlign = 'left';
    }
  }

  // ---- 共通インターフェース ----

  return {
    name: 'puyo',
    show() {
      wrapEl.style.display = 'flex';
      relayout();
      updateScores();
      if (timer === null) timer = setInterval(tick, TICK_MS);
    },
    hide() {
      clearInterval(timer);
      timer = null;
      wrapEl.style.display = 'none';
    },
    setAuto(on) {
      auto = on;
      if (on) {
        // 落下途中で AI に切替わったら、そこから最善手を再計算
        if (state === 'falling' && cur) target = PuyoAI.bestPlacement(grid, cur.colors);
      }
    },
    key(e) {
      if (over) { reset(); return true; }
      if (state !== 'falling' || !cur) return true;
      if (e.key === 'ArrowLeft') tryMove(-1);
      else if (e.key === 'ArrowRight') tryMove(1);
      else if (e.key === 'ArrowUp') tryRotate();
      else if (e.key === 'ArrowDown') { if (!tryFall()) lock(); }
      else return false;
      render();
      return true;
    },
    relayout,
    reset,
    isOver: () => over,
    // テスト用フック：ティックを直接駆動し内部状態を覗く
    _tick: tick,
    _grid: () => grid,
    _state: () => ({ state, score, chainNum, maxChain, over, auto,
                     filled: grid.flat().filter(Boolean).length })
  };
};
