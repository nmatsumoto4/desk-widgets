// スネーク ウィジェットモジュール（AI 自動プレイ・ドット絵・大きめグリッド）
//
// ・AI は「エサへの最短路 → ただし進んだ後に十分な空間が残る時だけ採用」し、
//   危険なら最も広い空間が残る方向へ逃げる（自分で詰まないための定番手法）。
// ・エサを食べるたびに伸び、一定数ごとにレベルアップして移動が速くなる（難易度上昇）。
// ・壁／自分に当たると少し待って自動リスタートし、永遠に動き続ける。
// ・手動：矢印キーで進行方向を変える。

window.createWidgetSnake = function (ctx) {
  const TICK_MS = 33;
  const CELL_TARGET = 13;     // 1 マスの目安 px（小さめ＝マス数が多い＝大きめの盤面）
  const BEST_KEY = 'widgetSnake.best';
  const RESTART_TICKS = Math.round(1100 / TICK_MS);
  const FOODS_PER_LEVEL = 4;

  const wrapEl = document.getElementById('snake');
  const canvas = document.getElementById('snake-canvas');
  const g2d = canvas.getContext('2d');

  let COLS = 20, ROWS = 24;
  let snake = [];             // [{r,c}] 先頭が head
  let dir = { r: 0, c: 1 };
  let pendingDir = null;      // 手動入力
  let food = null;
  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let level = 1, foods = 0;
  let moveAccum = 0;
  let auto = false;
  let timer = null;
  let over = false;
  let restartCountdown = -1;
  let animClock = 0;

  const DIRS = [{ r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 }];
  const key = (r, c) => r * COLS + c;
  const inB = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

  function moveIntervalTicks() {
    return Math.max(2, 7 - level); // レベルが上がるほど速い
  }

  function newGame() {
    const cr = Math.floor(ROWS / 2), cc = Math.floor(COLS / 2);
    snake = [{ r: cr, c: cc }, { r: cr, c: cc - 1 }, { r: cr, c: cc - 2 }];
    dir = { r: 0, c: 1 };
    pendingDir = null;
    score = 0; level = 1; foods = 0;
    over = false;
    restartCountdown = -1;
    moveAccum = 0;
    spawnFood();
    updateScores();
    render();
  }

  function spawnFood() {
    const occupied = new Set(snake.map((s) => key(s.r, s.c)));
    const free = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (!occupied.has(key(r, c))) free.push({ r, c });
    food = free.length ? free[(Math.random() * free.length) | 0] : null;
    if (!food) { over = true; } // 盤面が全て埋まった（実質クリア）
  }

  function updateScores() {
    if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
    ctx.setScores(score, best, `Lv.${level} ・長さ${snake.length}`);
  }

  // ---- AI ----
  // body を障害物にした BFS。goal への第一歩 {r,c} を返す（無ければ null）
  function bfsStep(sr, sc, gr, gc, blocked) {
    const prev = new Int32Array(ROWS * COLS).fill(-2);
    prev[key(sr, sc)] = -1;
    const q = [sr * COLS + sc];
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const r = (cur / COLS) | 0, c = cur % COLS;
      if (r === gr && c === gc) {
        // 第一歩まで遡る
        let p = cur;
        while (prev[p] !== -1 && prev[prev[p]] !== -1) p = prev[p];
        const fr = (p / COLS) | 0, fc = p % COLS;
        return { r: fr - sr, c: fc - sc };
      }
      for (const d of DIRS) {
        const nr = r + d.r, nc = c + d.c;
        if (!inB(nr, nc)) continue;
        const k = key(nr, nc);
        if (prev[k] !== -2) continue;
        if (blocked.has(k) && !(nr === gr && nc === gc)) continue;
        prev[k] = cur;
        q.push(k);
      }
    }
    return null;
  }

  // (sr,sc) から到達できる空きマス数（blocked を壁とする）
  function floodArea(sr, sc, blocked) {
    if (blocked.has(key(sr, sc))) return 0;
    const seen = new Uint8Array(ROWS * COLS);
    const q = [sr * COLS + sc];
    seen[key(sr, sc)] = 1;
    let head = 0, count = 0;
    while (head < q.length) {
      const cur = q[head++];
      const r = (cur / COLS) | 0, c = cur % COLS;
      count++;
      for (const d of DIRS) {
        const nr = r + d.r, nc = c + d.c;
        if (!inB(nr, nc)) continue;
        const k = key(nr, nc);
        if (seen[k] || blocked.has(k)) continue;
        seen[k] = 1;
        q.push(k);
      }
    }
    return count;
  }

  function bodyBlocked(excludeTail) {
    const b = new Set(snake.map((s) => key(s.r, s.c)));
    if (excludeTail) b.delete(key(snake[snake.length - 1].r, snake[snake.length - 1].c));
    return b;
  }

  function decideDir() {
    const head = snake[0];
    const blocked = bodyBlocked(true); // 尻尾は次に空くので通行可

    // 1) エサへ最短路。進んだ先から十分広い空間にアクセスできる時だけ採用
    //    （floodArea は新頭マスから到達できる空きマス数。尻尾は次に空くので障害物から除外）
    const step = bfsStep(head.r, head.c, food.r, food.c, blocked);
    if (step) {
      const nh = { r: head.r + step.r, c: head.c + step.c };
      if (floodArea(nh.r, nh.c, blocked) >= snake.length) return step;
    }

    // 2) 生存モード：逆走以外で、最も広い空間にアクセスできる方向へ
    let bestD = null, bestArea = -1;
    for (const d of DIRS) {
      if (d.r === -dir.r && d.c === -dir.c) continue; // 逆走禁止
      const nr = head.r + d.r, nc = head.c + d.c;
      if (!inB(nr, nc)) continue;
      if (blocked.has(key(nr, nc))) continue;
      const area = floodArea(nr, nc, blocked);
      if (area > bestArea) { bestArea = area; bestD = d; }
    }
    return bestD; // null なら詰み（次の移動で死亡）
  }

  function step() {
    if (auto) {
      const d = decideDir();
      if (d) dir = d;
    } else if (pendingDir && !(pendingDir.r === -dir.r && pendingDir.c === -dir.c)) {
      dir = pendingDir;
    }
    pendingDir = null;

    const nh = { r: snake[0].r + dir.r, c: snake[0].c + dir.c };
    // 壁・自分（尻尾は動くので除く）に当たれば死亡
    const hitsSelf = snake.slice(0, -1).some((s) => s.r === nh.r && s.c === nh.c);
    if (!inB(nh.r, nh.c) || hitsSelf) { gameOver(); return; }

    snake.unshift(nh);
    if (food && nh.r === food.r && nh.c === food.c) {
      foods++;
      score += 10 * level;
      level = 1 + Math.floor(foods / FOODS_PER_LEVEL);
      if (window.SFX) SFX.eat();
      spawnFood();
      updateScores();
    } else {
      snake.pop();
    }
  }

  function gameOver() {
    over = true;
    restartCountdown = RESTART_TICKS;
    if (window.SFX) SFX.die();
    if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
    ctx.showOverlay('GAME OVER', auto ? `Lv.${level} ・自動リスタート…` : `Lv.${level} ・キーで再開`);
  }

  function tick() {
    animClock += TICK_MS / 1000;
    if (over) {
      if (auto && restartCountdown >= 0 && --restartCountdown <= 0) { newGame(); ctx.hideOverlay(); }
      render();
      return;
    }
    if (++moveAccum >= moveIntervalTicks()) {
      moveAccum = 0;
      step();
    }
    render();
  }

  // ---- 描画（ドット絵） ----
  let scale = 14, offX = 0, offY = 0;

  function applyGridSize() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cols = Math.max(14, Math.min(30, Math.round(rect.width / CELL_TARGET)));
    const rows = Math.max(16, Math.min(40, Math.round(rect.height / CELL_TARGET)));
    if (cols !== COLS || rows !== ROWS || snake.length === 0) {
      COLS = cols; ROWS = rows;
      newGame();
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

  const sx = (c) => offX + c * scale;
  const sy = (r) => offY + r * scale;

  function roundRect(x, y, w, h, rad) {
    g2d.beginPath();
    g2d.moveTo(x + rad, y);
    g2d.arcTo(x + w, y, x + w, y + h, rad);
    g2d.arcTo(x + w, y + h, x, y + h, rad);
    g2d.arcTo(x, y + h, x, y, rad);
    g2d.arcTo(x, y, x + w, y, rad);
    g2d.closePath();
  }

  function render() {
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    // 盤面背景＋市松
    g2d.fillStyle = '#10131a';
    g2d.fillRect(offX, offY, COLS * scale, ROWS * scale);
    g2d.fillStyle = '#161a24';
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if ((r + c) % 2 === 0) g2d.fillRect(sx(c), sy(r), scale + 0.5, scale + 0.5);

    // エサ（リンゴ風）
    if (food) {
      const x = sx(food.c), y = sy(food.r);
      const pulse = 1 + 0.08 * Math.sin(animClock * 6);
      const rad = scale * 0.34 * pulse;
      g2d.fillStyle = '#e74c3c';
      g2d.beginPath(); g2d.arc(x + scale / 2, y + scale * 0.56, rad, 0, Math.PI * 2); g2d.fill();
      g2d.fillStyle = '#6ab04c';
      g2d.fillRect(x + scale * 0.46, y + scale * 0.12, scale * 0.08, scale * 0.22);
      g2d.fillStyle = 'rgba(255,255,255,0.55)';
      g2d.beginPath(); g2d.arc(x + scale * 0.4, y + scale * 0.46, rad * 0.28, 0, Math.PI * 2); g2d.fill();
    }

    // スネーク（頭→尾でグラデーション、ドット風の角丸ブロック）
    const n = snake.length;
    for (let i = n - 1; i >= 0; i--) {
      const s = snake[i];
      const x = sx(s.c), y = sy(s.r);
      const t = n > 1 ? i / (n - 1) : 0; // 0=head, 1=tail
      const lightness = 58 - t * 26;
      g2d.fillStyle = `hsl(140, 65%, ${lightness}%)`;
      const pad = scale * 0.08;
      roundRect(x + pad, y + pad, scale - pad * 2, scale - pad * 2, scale * 0.28);
      g2d.fill();
      if (i === 0) drawHead(x, y);
    }
    if (over) {
      g2d.fillStyle = 'rgba(0,0,0,0.25)';
      g2d.fillRect(offX, offY, COLS * scale, ROWS * scale);
    }
  }

  function drawHead(x, y) {
    // 進行方向に目を向ける
    const cx = x + scale / 2, cy = y + scale / 2;
    const ex = dir.c * scale * 0.16, ey = dir.r * scale * 0.16;
    // 垂直方向のオフセット（目を左右に振り分ける）
    const px = dir.r !== 0 ? scale * 0.2 : 0;
    const py = dir.c !== 0 ? scale * 0.2 : 0;
    for (const sgn of [-1, 1]) {
      const eyeX = cx + ex + sgn * px;
      const eyeY = cy + ey + sgn * py;
      g2d.fillStyle = '#fff';
      g2d.beginPath(); g2d.arc(eyeX, eyeY, scale * 0.12, 0, Math.PI * 2); g2d.fill();
      g2d.fillStyle = '#16202a';
      g2d.beginPath(); g2d.arc(eyeX + dir.c * scale * 0.05, eyeY + dir.r * scale * 0.05, scale * 0.06, 0, Math.PI * 2); g2d.fill();
    }
  }

  // ---- 共通インターフェース ----
  return {
    name: 'snake',
    show() {
      wrapEl.style.display = 'flex';
      relayout();
      updateScores();
      if (timer === null) timer = setInterval(tick, TICK_MS);
    },
    hide() {
      clearInterval(timer); timer = null;
      wrapEl.style.display = 'none';
    },
    setAuto(on) { auto = on; },
    key(e) {
      if (over) { newGame(); ctx.hideOverlay(); return true; }
      if (e.key === 'ArrowUp') pendingDir = { r: -1, c: 0 };
      else if (e.key === 'ArrowDown') pendingDir = { r: 1, c: 0 };
      else if (e.key === 'ArrowLeft') pendingDir = { r: 0, c: -1 };
      else if (e.key === 'ArrowRight') pendingDir = { r: 0, c: 1 };
      else return false;
      return true;
    },
    relayout,
    reset: newGame,
    isOver: () => over,
    _tick: tick,
    _state: () => ({ over, level, foods, score, len: snake.length, auto, cols: COLS, rows: ROWS })
  };
};
