// ぷよぷよ ウィジェットモジュール（描画・進行ループ・操作）
// app.js から共通インターフェース（show/hide/setAuto/key/relayout/reset）で呼ばれる

window.createWidgetPuyo = function (ctx) {
  const { W, H, CHILD_D, CHAIN_BONUS } = window.Puyo;
  const TICK_MS = 33;          // 滑らかなアニメのため細かく刻む
  const AI_STEP_TICKS = 3;     // AI/落下の操作間隔（約 100ms）
  const MANUAL_FALL_TICKS = 16;// 手動時の自然落下間隔
  const RESTART_TICKS = 24;
  const POP_TICKS = 10;        // 消去エフェクトの長さ
  const CHAIN_LABEL_TICKS = 22;// 「n 連鎖!」表示
  const BEST_KEY = 'widgetPuyo.best';
  const GAMES_KEY = 'widgetPuyo.games';
  const MAXCHAIN_KEY = 'widgetPuyo.maxChain';
  const REPLAY_KEY = 'widgetPuyo.replay'; // 最大連鎖時の盤面（再現用）
  const SPAWN_COL = Math.floor((W - 1) / 2);

  const wrapEl = document.getElementById('puyo');
  const canvas = document.getElementById('puyo-canvas') as HTMLCanvasElement;
  const g2d = canvas.getContext('2d');
  const ctrlEl = document.getElementById('puyo-ctrl');
  const replayBtn = document.getElementById('puyo-replay') as HTMLButtonElement;

  // 最大連鎖の盤面を読み込んで連鎖を再生する
  function playReplay() {
    let data;
    try { data = JSON.parse(localStorage.getItem(REPLAY_KEY)); } catch { data = null; }
    if (!data || !data.grid || data.grid.length !== H || data.grid[0].length !== W) return;
    grid = data.grid.map((row) => row.slice());
    voff = makeVoff();
    cur = null; popping = []; chainNum = 0; chainSeed = null;
    over = false; replaying = true; restartCountdown = -1;
    ctx.hideOverlay();
    state = 'check';
    render();
  }
  replayBtn.addEventListener('click', playReplay);
  const PUYO_COLORS = ['', '#e74c3c', '#27ae60', '#3498db', '#f1c40f'];

  // ぷよ（スライム）のドット絵（14×14）。B=本体 / D=影 / H=ツヤ / G=光沢 / W=白目 / P=瞳 / .=透明
  // 角を丸めて艶やかなスライム感に。辺は概ね埋めて同色は隣接でつながる
  const PUYO_SPRITE = [
    '..BBBBBBBBBB..',
    '.BBBBBBBBBBBB.',
    'BBBBBBBBBBBBBB',
    'BGHHBBBBBBBBBB',
    'BHHHBBBBBBBBBB',
    'BBBBBBBBBBBBBB',
    'BWWWBBBBWWWBBB',
    'BWPWBBBBWPWBBB',
    'BWWWBBBBWWWBBB',
    'BBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBB',
    'DDBBBBBBBBBBDD',
    '.DDDDDDDDDDDD.',
    '..DDDDDDDDDD..'
  ];

  function shadeDark(hex) {
    const n = parseInt(hex.slice(1), 16), f = 0.62;
    return `rgb(${Math.round((n >> 16 & 255) * f)},${Math.round((n >> 8 & 255) * f)},${Math.round((n & 255) * f)})`;
  }
  function shadeLight(hex) {
    const n = parseInt(hex.slice(1), 16), m = (v) => Math.round(v + (255 - v) * 0.55);
    return `rgb(${m(n >> 16 & 255)},${m(n >> 8 & 255)},${m(n & 255)})`;
  }

  // sxs/sys は接地中心（下端中央）まわりのスクワッシュ&ストレッチ倍率
  function drawPuyoSprite(x, y, size, color, alpha = 1, sxs = 1, sys = 1) {
    const base = PUYO_COLORS[color];
    const colMap = { B: base, D: shadeDark(base), H: shadeLight(base), G: '#ffffff', W: '#ffffff', P: '#3a3a3a' };
    const dot = size / 14;
    const cx = x + size / 2, by = y + size;
    const dw = dot * sxs + 0.6, dh = dot * sys + 0.6;
    g2d.globalAlpha = alpha;
    for (let pr = 0; pr < 14; pr++) {
      const row = PUYO_SPRITE[pr];
      for (let pc = 0; pc < 14; pc++) {
        const ch = row[pc];
        if (ch === '.') continue;
        g2d.fillStyle = colMap[ch];
        const px = cx + (x + pc * dot - cx) * sxs;
        const py = by + (y + pr * dot - by) * sys;
        g2d.fillRect(px, py, dw, dh);
      }
    }
    g2d.globalAlpha = 1;
  }

  let grid = window.Puyo.emptyGrid();
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
  let aiCounter = 0;       // AI/落下操作の間引き
  let restartCountdown = -1;
  let chainLabelTicks = 0; // 「n 連鎖!」表示の残りティック
  const makeVoff = () => Array.from({ length: H }, () => new Array(W).fill(0));
  let voff = makeVoff();   // 各セルの落下アニメ用オフセット（行単位・負=上）
  let vvel = makeVoff();   // 落下アニメの速度（スプリング・スライム挙動用）
  let chainSeed = null;    // 連鎖シーケンス開始時の盤面（記録用）
  let replaying = false;   // リプレイ再生中フラグ

  function rndPair() {
    const r = () => 1 + Math.floor(Math.random() * window.Puyo.NUM_COLORS);
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

  // 重力を適用しつつ、動いたぷよに落下オフセット（負＝上）を設定して滑らかに落とす
  function applyGravityAnimated() {
    for (let c = 0; c < W; c++) {
      const colors = [], froms = [];
      for (let r = 0; r < H; r++) {
        if (grid[r][c] !== 0) { colors.push(grid[r][c]); froms.push(r); }
        grid[r][c] = 0; voff[r][c] = 0; vvel[r][c] = 0;
      }
      let r = H - 1;
      for (let i = colors.length - 1; i >= 0; i--) {
        grid[r][c] = colors[i];
        voff[r][c] = froms[i] - r; // <= 0（元の高い位置から落ちてくる）
        vvel[r][c] = 0;
        r--;
      }
    }
  }

  function lock() {
    for (const [r, c, color] of pairCells(cur)) {
      if (r >= 0) grid[r][c] = color;
    }
    cur = null;
    chainNum = 0;
    if (window.SFX) window.SFX.land();
    applyGravityAnimated();
    state = 'settle';
  }

  function gameOver() {
    over = true;
    games++;
    localStorage.setItem(GAMES_KEY, String(games));
    restartCountdown = RESTART_TICKS;
    ctx.showOverlay('GAME OVER', auto ? '自動リスタート…' : '矢印キーでリスタート');
  }

  function reset() {
    grid = window.Puyo.emptyGrid();
    voff = makeVoff();
    vvel = makeVoff();
    queue = [rndPair(), rndPair()];
    cur = null;
    over = false;
    score = 0;
    chainNum = 0;
    popping = [];
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
        if (grid[0][SPAWN_COL] !== 0 || grid[1][SPAWN_COL] !== 0) { gameOver(); break; }
        cur = { colors: queue.shift(), r: 1, c: SPAWN_COL, rot: 0 };
        queue.push(rndPair());
        target = auto ? window.PuyoAI.bestPlacement(grid, cur.colors, maxChain) : null;
        gravCounter = 0;
        state = 'falling';
        break;
      }
      case 'falling': {
        if (!cur) { state = 'spawn'; break; }
        if (auto && target) {
          if (++aiCounter < AI_STEP_TICKS) break;
          aiCounter = 0;
          // 1 操作ずつ：回転 → 横移動 → 高速落下（2 段）
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
      case 'settle': {
        // スプリングで 0 へ（少しオーバーシュート＝スライムがぷるっと着地）
        // AI 自動運転中は更に速く落とす（観賞テンポ重視）
        const stiff = auto ? 0.9 : 0.5, damp = auto ? 0.38 : 0.58, eps = auto ? 0.12 : 0.05;
        let moving = false;
        for (let r = 0; r < H; r++) {
          for (let c = 0; c < W; c++) {
            if (voff[r][c] !== 0 || vvel[r][c] !== 0) {
              vvel[r][c] += (-voff[r][c]) * stiff;
              vvel[r][c] *= damp;
              voff[r][c] += vvel[r][c];
              if (Math.abs(voff[r][c]) < eps && Math.abs(vvel[r][c]) < eps) { voff[r][c] = 0; vvel[r][c] = 0; }
              else moving = true;
            }
          }
        }
        if (!moving) state = 'check';
        break;
      }
      case 'check': {
        const groups = window.Puyo.findGroups(grid);
        if (groups.length === 0) {
          if (replaying) { replaying = false; reset(); break; } // リプレイ後は新しくランダムに始め直す
          state = 'spawn';
        } else {
          if (chainNum === 0) chainSeed = grid.map((row) => row.slice()); // 連鎖開始盤面を記録
          chainNum++;
          if (window.SFX) window.SFX.pop(chainNum);
          chainLabelTicks = CHAIN_LABEL_TICKS;
          popping = groups.flat();
          popGain = popping.length * 10 *
            CHAIN_BONUS[Math.min(chainNum - 1, CHAIN_BONUS.length - 1)];
          popTicks = POP_TICKS;
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
            // 最大連鎖を更新 → その連鎖を生んだ盤面を保存（再現用）
            if (chainSeed && !replaying) {
              localStorage.setItem(REPLAY_KEY, JSON.stringify({ chain: maxChain, grid: chainSeed }));
              replayBtn.disabled = false;
            }
          }
          applyGravityAnimated();
          updateScores();
          state = 'settle';
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
    drawPuyoSprite(c * cell, (r - 1) * cell, cell, color, alpha);
  }

  // 消えるエフェクト：縮んで白く光り、リングと粒が弾ける
  function drawPop(r, c, color, p) {
    if (r < 1) return;
    const cx = c * cell + cell / 2, cy = (r - 1) * cell + cell / 2;
    const rad = cell * 0.46 * (1 - p);
    if (rad > 0.5) {
      g2d.globalAlpha = 1;
      g2d.fillStyle = PUYO_COLORS[color];
      g2d.beginPath(); g2d.arc(cx, cy, rad, 0, Math.PI * 2); g2d.fill();
      g2d.fillStyle = `rgba(255,255,255,${0.45 + 0.55 * p})`;
      g2d.beginPath(); g2d.arc(cx, cy, rad * 0.78, 0, Math.PI * 2); g2d.fill();
    }
    g2d.globalAlpha = Math.max(0, 1 - p);
    g2d.strokeStyle = '#ffffff';
    g2d.lineWidth = Math.max(1, cell * 0.06);
    g2d.beginPath(); g2d.arc(cx, cy, cell * 0.28 + cell * 0.5 * p, 0, Math.PI * 2); g2d.stroke();
    g2d.fillStyle = PUYO_COLORS[color];
    const dist = cell * 0.55 * p, s = cell * 0.12;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      g2d.fillRect(cx + Math.cos(a) * dist - s / 2, cy + Math.sin(a) * dist - s / 2, s, s);
    }
    g2d.globalAlpha = 1;
  }

  function render() {
    const fieldW = W * cell;
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    // フィールド背景（縦グラデ）
    const bg = g2d.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, '#534338'); bg.addColorStop(1, '#352c25');
    g2d.fillStyle = bg;
    g2d.fillRect(0, 0, fieldW, canvas.height);

    const popSet = new Set(popping.map(([r, c]) => `${r},${c}`));
    for (let r = 1; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (grid[r][c] === 0 || popSet.has(`${r},${c}`)) continue;
        // 落下速度からスクワッシュ&ストレッチ（落下中は縦伸び、着地の跳ねで縦縮み）
        const v = vvel[r][c] || 0;
        const sys = 1 + Math.max(-0.28, Math.min(0.36, v * 0.4));
        const sxs = 1 - Math.max(-0.28, Math.min(0.36, v * 0.4)) * 0.7;
        drawPuyoSprite(c * cell, (r - 1) * cell + voff[r][c] * cell, cell, grid[r][c], 1, sxs, sys);
      }
    }
    // 消去エフェクト
    if (popping.length) {
      const p = 1 - popTicks / POP_TICKS;
      for (const [r, c] of popping) drawPop(r, c, grid[r][c], p);
    }
    if (cur) for (const [r, c, color] of pairCells(cur)) drawPuyo(r, c, color);

    // NEXT パネル
    const px = fieldW + cell * 0.3;
    g2d.fillStyle = '#776e65';
    g2d.font = `bold ${Math.floor(cell * 0.42)}px sans-serif`;
    g2d.fillText('NEXT', px, cell * 0.6);
    const next = queue[0];
    if (next) {
      drawPuyoSprite(px + cell * 0.1, cell * 0.95, cell * 0.9, next[1]); // 子ぷよ
      drawPuyoSprite(px + cell * 0.1, cell * 1.9, cell * 0.9, next[0]); // 軸ぷよ
    }

    // 連鎖表示（ポップインしてフェードアウト）
    if (chainLabelTicks > 0 && chainNum > 0) {
      chainLabelTicks--;
      const age = 1 - chainLabelTicks / CHAIN_LABEL_TICKS;     // 0→1
      const scale = age < 0.25 ? 0.5 + (age / 0.25) * 0.6 : 1.1; // 出だしに拡大
      const alpha = chainLabelTicks < 6 ? chainLabelTicks / 6 : 1; // 末尾でフェード
      g2d.save();
      g2d.globalAlpha = alpha;
      g2d.translate(fieldW / 2, canvas.height * 0.4);
      g2d.scale(scale, scale);
      g2d.fillStyle = '#fff';
      g2d.strokeStyle = 'rgba(0,0,0,0.35)';
      g2d.lineWidth = cell * 0.08;
      g2d.font = `bold ${Math.floor(cell * 0.95)}px sans-serif`;
      g2d.textAlign = 'center';
      g2d.strokeText(`${chainNum} 連鎖!`, 0, 0);
      g2d.fillText(`${chainNum} 連鎖!`, 0, 0);
      g2d.restore();
      g2d.textAlign = 'left';
    }
  }

  // ---- 共通インターフェース ----

  return {
    name: 'puyo',
    show() {
      wrapEl.style.display = 'flex';
      ctrlEl.style.display = 'inline-flex';
      replayBtn.disabled = !localStorage.getItem(REPLAY_KEY);
      relayout();
      updateScores();
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
      if (on) {
        // 落下途中で AI に切替わったら、そこから最善手を再計算
        if (state === 'falling' && cur) target = window.PuyoAI.bestPlacement(grid, cur.colors, maxChain);
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
    _replay: playReplay,
    _state: () => ({ state, score, chainNum, maxChain, over, auto, replaying,
                     W, H, filled: grid.flat().filter(Boolean).length })
  };
};
