// ボンバーマン ウィジェットモジュール（4 体 AI 自動対戦・描画・操作）
//
// ・11×11 の格子。外周と (偶数,偶数) は破壊不能の壁、その他にソフトブロックを配置。
// ・4 隅から 4 体のボマーが登場し、AI が自動で爆弾を置き合って戦う。
// ・最後の 1 体になる（または全滅／時間切れ）と次ラウンドを自動開始し、永遠に戦い続ける。
// ・ソフトブロックを壊すとパワーアップ（爆弾数 / 火力 / スピード）が出ることがある。
// ・フッターの −/＋ でブロック量を変えて難易度調整。手動：← → ↑ ↓ 移動・Space 爆弾（プレイヤー1）。
//
// AI は爆風の到達時間マップ（連鎖込み）を計算し、危険なら最寄りの安全マスへ退避、
// 安全なら敵を狙う／ソフトブロックを壊す爆弾を「逃げ道がある時だけ」設置する。

window.createWidgetBomber = function (ctx) {
  let COLS = 11, ROWS = 11;  // 盤面サイズ。ウィンドウを広げると増える（可変）
  const CELL_TARGET = 26;    // 1 マスの目安サイズ（CSS px）。これで window から列数・行数を決める
  const TICK_MS = 33;
  const FUSE = 1.9;          // 爆弾の導火（秒）
  const FLAME_DUR = 0.5;     // 炎の持続（秒）
  const ROUND_LIMIT = 50;    // ラウンド最長（秒）。膠着防止
  const AUTO_BOOST = 1.7;    // AI 自動運転時だけ移動を高速化（手動は等倍）
  const SD_START = 16;       // この秒数を過ぎると外周からブロックが積まれて盤面が狭まる
  const RESTART_TICKS = Math.round(1600 / TICK_MS);
  const DENS_KEY = 'widgetBomber.dens';
  const ROUNDS_KEY = 'widgetBomber.rounds';

  const wrapEl = document.getElementById('bomber');
  const canvas = document.getElementById('bomber-canvas');
  const g2d = canvas.getContext('2d');
  const ctrlEl = document.getElementById('bomber-ctrl');
  const densLabelEl = document.getElementById('bomber-dens-label');

  const DENS = [
    { name: '少', p: 0.28 },
    { name: 'やや少', p: 0.42 },
    { name: '標準', p: 0.55 },
    { name: '多', p: 0.66 },
    { name: '最多', p: 0.76 }
  ];
  const P_COLORS = ['#ecf0f1', '#34495e', '#e74c3c', '#3498db'];
  const P_ACCENT = ['#bdc3c7', '#1b2631', '#922b21', '#1f618d'];

  // ドット絵ロボット（8×10）。B=本体色 / D=濃色 / E=目（発光）/ A=アンテナ
  // 2 フレームで脚を動かして歩行アニメにする
  const ROBOT_FRAMES = [
    [
      '...A....', '...D....', '.DDDDDD.', '.DBBBBD.', '.BEBBEB.',
      '.DBBBBD.', 'DDBBBBDD', '.BBBBBB.', '.DD..DD.', '.D....D.'
    ],
    [
      '...A....', '...D....', '.DDDDDD.', '.DBBBBD.', '.BEBBEB.',
      '.DBBBBD.', 'DDBBBBDD', '.BBBBBB.', '..DDDD..', '..D..D..'
    ]
  ];

  const savedDens = localStorage.getItem(DENS_KEY);
  let densIdx = savedDens === null ? 2 : clampDens(Number(savedDens));
  let grid = [];             // 0 空き / 1 ソフト / 2 壁
  let players = [];
  let bombs = [];
  let flames = [];
  let powerups = [];
  let state = 'play';        // play | roundover | gameover(未使用)
  let auto = false;
  let timer = null;
  let round = 0;
  let totalRounds = Number(localStorage.getItem(ROUNDS_KEY) || 0);
  let restartCountdown = -1;
  let roundTime = 0;
  let winnerText = '';
  let animClock = 0;        // 歩行アニメ用クロック（秒）
  let spiral = [];          // サドンデスでブロックを積む順（外周→内側の渦巻き）
  let sdIndex = 0;          // 次に積むブロックの番号
  let sdAccum = 0;          // サドンデスのタイマー
  let sdInterval = 0.4;     // 1 ブロック積むごとの間隔（盤面サイズで自動調整）
  const sdWalls = new Set();// サドンデスで積まれたブロック（描画の色分け用）

  function clampDens(n) {
    if (isNaN(n)) return 2;
    return Math.max(0, Math.min(DENS.length - 1, n));
  }

  // ---- 盤面生成 ----
  const isWallCell = (r, c) => r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1 ||
                               (r % 2 === 0 && c % 2 === 0);

  // 外周から内側へ渦巻き状にマスを並べる（恒久ピラーは除外）。サドンデスの積み順
  function buildSpiral() {
    const order = [];
    let top = 1, bottom = ROWS - 2, left = 1, right = COLS - 2;
    while (top <= bottom && left <= right) {
      for (let c = left; c <= right; c++) order.push([top, c]);
      for (let r = top + 1; r <= bottom; r++) order.push([r, right]);
      if (top < bottom) for (let c = right - 1; c >= left; c--) order.push([bottom, c]);
      if (left < right) for (let r = bottom - 1; r > top; r--) order.push([r, left]);
      top++; bottom--; left++; right--;
    }
    return order.filter(([r, c]) => !(r % 2 === 0 && c % 2 === 0)).map(([r, c]) => ({ r, c }));
  }

  // サドンデス：1 マスを壁にして、その上のプレイヤー・爆弾・アイテムを潰す
  function dropWall(cell) {
    const { r, c } = cell;
    if (grid[r][c] === 2) return;
    grid[r][c] = 2;
    sdWalls.add(`${r},${c}`);
    const pu = powerAt(r, c);
    if (pu) powerups.splice(powerups.indexOf(pu), 1);
    const bb = bombAt(r, c);
    if (bb) { const o = players[bb.owner]; if (o) o.bombs = Math.max(0, o.bombs - 1); bombs.splice(bombs.indexOf(bb), 1); }
    for (const pl of players) {
      if (!pl.alive) continue;
      const onCell = Math.floor(pl.x) === c && Math.floor(pl.y) === r;
      const intoCell = pl.moving && Math.round(pl.tx - 0.5) === c && Math.round(pl.ty - 0.5) === r;
      if (onCell || intoCell) pl.alive = false;
    }
    flames.push({ r, c, t: 0.18 }); // 着弾フラッシュ
  }

  // 現在のサイズから 4 隅スポーンを求める
  const spawnsFor = () => [
    { r: 1, c: 1 }, { r: 1, c: COLS - 2 },
    { r: ROWS - 2, c: 1 }, { r: ROWS - 2, c: COLS - 2 }
  ];

  function newRound() {
    const SPAWNS = spawnsFor();
    grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    // 壁
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (isWallCell(r, c)) grid[r][c] = 2;

    // スポーン周辺は空けておく
    const keep = new Set();
    for (const s of SPAWNS) {
      keep.add(`${s.r},${s.c}`);
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        keep.add(`${s.r + dr},${s.c + dc}`);
      }
    }
    // ソフトブロック配置
    const p = DENS[densIdx].p;
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (grid[r][c] !== 0) continue;
        if (keep.has(`${r},${c}`)) continue;
        if (Math.random() < p) grid[r][c] = 1;
      }
    }

    bombs = []; flames = []; powerups = [];
    players = SPAWNS.map((s, i) => ({
      id: i, color: P_COLORS[i], accent: P_ACCENT[i],
      x: s.c + 0.5, y: s.r + 0.5,
      alive: true, moving: false, tx: 0, ty: 0,
      maxBombs: 1, bombs: 0, power: 2, speed: 3.2,
      think: 0, lastDir: null
    }));
    // サドンデス準備：盤面が大きいほど 1 枚を速く積み、ROUND_LIMIT 手前で積み終える
    spiral = buildSpiral();
    sdIndex = 0;
    sdAccum = 0;
    sdWalls.clear();
    sdInterval = Math.max(0.12, (ROUND_LIMIT - 6 - SD_START) / Math.max(1, spiral.length));

    state = 'play';
    restartCountdown = -1;
    roundTime = 0;
    winnerText = '';
    ctx.hideOverlay();
    updateScores();
    updateDensLabel();
    render();
  }

  function resetGame() {
    round = 1;
    newRound();
  }

  function updateScores() {
    const alive = players.filter((p) => p.alive).length;
    ctx.setScores(round, totalRounds, `R${round} ・残り${alive}人`);
  }

  function updateDensLabel() {
    densLabelEl.textContent = `ブロック ${DENS[densIdx].name}`;
  }

  // ---- 盤面ヘルパー ----
  const inB = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const bombAt = (r, c) => bombs.find((b) => b.r === r && b.c === c);
  const flameAt = (r, c) => flames.some((f) => f.r === r && f.c === c);
  const powerAt = (r, c) => powerups.find((pu) => pu.r === r && pu.c === c);
  // 移動できるマス（空き・爆弾なし）
  const passable = (r, c) => inB(r, c) && grid[r][c] === 0 && !bombAt(r, c);

  // 爆弾 1 個の爆風が覆うマス（壁で停止・ソフトで停止・爆弾は貫通＝連鎖）
  function blastCells(r, c, power) {
    const cells = [`${r},${c}`];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      for (let k = 1; k <= power; k++) {
        const nr = r + dr * k, nc = c + dc * k;
        if (!inB(nr, nc) || grid[nr][nc] === 2) break;
        cells.push(`${nr},${nc}`);
        if (grid[nr][nc] === 1) break; // ソフトで停止
      }
    }
    return cells;
  }

  // 各マスが炎になるまでの最短時間（連鎖考慮）。安全なら Infinity
  function dangerMap(extra) {
    const list = extra ? bombs.concat([extra]) : bombs;
    const times = list.map((b) => b.fuse);
    const cover = list.map((b) => blastCells(b.r, b.c, b.power));
    // 連鎖：ある爆弾の爆風が別の爆弾を含むなら、より早い時刻に引きずられる
    for (let it = 0; it < list.length; it++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = 0; j < list.length; j++) {
          if (i === j) continue;
          if (cover[i].includes(`${list[j].r},${list[j].c}`) && times[i] < times[j]) {
            times[j] = times[i];
          }
        }
      }
    }
    const danger = new Map();
    for (let i = 0; i < list.length; i++) {
      for (const key of cover[i]) {
        danger.set(key, Math.min(danger.has(key) ? danger.get(key) : Infinity, times[i]));
      }
    }
    for (const f of flames) danger.set(`${f.r},${f.c}`, 0);
    return danger;
  }

  const dangerOf = (danger, r, c) => {
    const v = danger.get(`${r},${c}`);
    return v === undefined ? Infinity : v;
  };

  const DIRS = [[-1, 0, 'up'], [1, 0, 'down'], [0, -1, 'left'], [0, 1, 'right']];

  // BFS：goal(r,c)==true の最寄りマスへの第一歩。通過は passable かつ差し迫った危険でないマス
  function bfsStep(sr, sc, goalFn, danger, minSafeT) {
    const q = [[sr, sc]];
    const prev = new Map([[`${sr},${sc}`, null]]);
    let head = 0;
    while (head < q.length) {
      const [r, c] = q[head++];
      if ((r !== sr || c !== sc) && goalFn(r, c)) {
        // 経路を遡って第一歩を得る
        let cur = `${r},${c}`, step = cur;
        while (prev.get(cur) && prev.get(cur) !== `${sr},${sc}`) {
          step = cur; cur = prev.get(cur);
        }
        const [fr, fc] = (prev.get(cur) === `${sr},${sc}` ? cur : step).split(',').map(Number);
        return { r: fr, c: fc, dist: 1 };
      }
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        const key = `${nr},${nc}`;
        if (prev.has(key)) continue;
        if (!passable(nr, nc)) continue;
        if (flameAt(nr, nc)) continue;
        if (dangerOf(danger, nr, nc) < minSafeT) continue; // 間もなく爆発するマスは通らない
        prev.set(key, `${r},${c}`);
        q.push([nr, nc]);
      }
    }
    return null;
  }

  // 退避先（完全に安全＝Infinity）が存在し到達可能か
  function escapeExists(sr, sc, danger) {
    return !!bfsStep(sr, sc, (r, c) => dangerOf(danger, r, c) === Infinity, danger, 0.25);
  }

  // 敵に対して (r,c) から爆弾を置くと当てられるか（同一直線・射程内・壁に遮られない）
  function bombHitsEnemy(r, c, power, self) {
    const cells = new Set(blastCells(r, c, power));
    return players.some((p) => p.alive && p.id !== self.id &&
      cells.has(`${Math.floor(p.y)},${Math.floor(p.x)}`));
  }

  // ---- AI ----
  function aiDecide(pl) {
    const pr = Math.floor(pl.y), pc = Math.floor(pl.x);
    const danger = dangerMap();

    // 1) 今いるマスが危険 → 逃げる
    if (dangerOf(danger, pr, pc) < 1e9) {
      const step = bfsStep(pr, pc, (r, c) => dangerOf(danger, r, c) === Infinity, danger, 0.25);
      if (step) moveTo(pl, step.r, step.c);
      return;
    }

    // 2) 爆弾を置く判断（逃げ道がある時だけ）
    if (pl.bombs < pl.maxBombs && !bombAt(pr, pc)) {
      const adjSoft = DIRS.some(([dr, dc]) => inB(pr + dr, pc + dc) && grid[pr + dr][pc + dc] === 1);
      const canHit = bombHitsEnemy(pr, pc, pl.power, pl);
      // 敵が 2 マス以内に近づいたら圧をかけて置く（広い盤面での膠着を防ぐ）
      const enemyClose = players.some((p) => p.alive && p.id !== pl.id &&
        Math.abs(Math.floor(p.y) - pr) + Math.abs(Math.floor(p.x) - pc) <= 2);
      if (canHit || adjSoft || enemyClose) {
        const after = dangerMap({ r: pr, c: pc, power: pl.power, fuse: FUSE });
        if (dangerOf(after, pr, pc) >= 0 && escapeExists(pr, pc, after)) {
          placeBomb(pl, pr, pc);
          // 置いた直後に退避方向へ
          const step = bfsStep(pr, pc, (r, c) => dangerOf(after, r, c) === Infinity, after, 0.25);
          if (step) moveTo(pl, step.r, step.c);
          return;
        }
      }
    }

    // 3) 目標へ移動：最寄りの敵 → 無ければ最寄りのソフトブロック隣 → 無ければ徘徊
    let step = bfsStep(pr, pc, (r, c) => players.some(
      (p) => p.alive && p.id !== pl.id && Math.floor(p.y) === r && Math.floor(p.x) === c
    ), danger, 0.6);
    if (!step) {
      step = bfsStep(pr, pc, (r, c) =>
        DIRS.some(([dr, dc]) => inB(r + dr, c + dc) && grid[r + dr][c + dc] === 1), danger, 0.6);
    }
    if (!step) {
      // 安全な隣接マスへランダムに動く（膠着回避）
      const opts = DIRS.map(([dr, dc]) => [pr + dr, pc + dc])
        .filter(([r, c]) => passable(r, c) && !flameAt(r, c) && dangerOf(danger, r, c) > 0.6);
      if (opts.length) { const o = opts[(Math.random() * opts.length) | 0]; moveTo(pl, o[0], o[1]); }
      return;
    }
    moveTo(pl, step.r, step.c);
  }

  function moveTo(pl, r, c) {
    if (!passable(r, c)) return;
    pl.tx = c + 0.5; pl.ty = r + 0.5; pl.moving = true;
  }

  function placeBomb(pl, r, c) {
    if (pl.bombs >= pl.maxBombs || bombAt(r, c)) return;
    bombs.push({ r, c, owner: pl.id, power: pl.power, fuse: FUSE });
    pl.bombs++;
  }

  // ---- 爆発処理 ----
  function detonate(bomb) {
    const idx = bombs.indexOf(bomb);
    if (idx < 0) return;
    bombs.splice(idx, 1);
    if (window.SFX) SFX.explode();
    const owner = players[bomb.owner];
    if (owner) owner.bombs = Math.max(0, owner.bombs - 1);

    for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      for (let k = (dr === 0 && dc === 0) ? 0 : 1; k <= bomb.power; k++) {
        const nr = bomb.r + dr * k, nc = bomb.c + dc * k;
        if (!inB(nr, nc) || grid[nr][nc] === 2) break;
        flames.push({ r: nr, c: nc, t: FLAME_DUR });
        // 連鎖
        const chain = bombAt(nr, nc);
        if (chain) detonate(chain);
        if (grid[nr][nc] === 1) {
          grid[nr][nc] = 0;
          if (Math.random() < 0.38) {
            const types = ['bomb', 'fire', 'speed'];
            powerups.push({ r: nr, c: nc, type: types[(Math.random() * types.length) | 0] });
          }
          break; // ソフトで停止
        }
        if (dr === 0 && dc === 0) continue;
      }
    }
  }

  function applyPowerup(pl, pu) {
    if (window.SFX) SFX.item();
    if (pu.type === 'bomb') pl.maxBombs = Math.min(6, pl.maxBombs + 1);
    else if (pu.type === 'fire') pl.power = Math.min(7, pl.power + 1);
    else if (pu.type === 'speed') pl.speed = Math.min(6, pl.speed + 0.6);
  }

  // ---- 進行 ----
  function tick() {
    if (state === 'roundover') {
      if (auto && restartCountdown >= 0 && --restartCountdown <= 0) {
        round++; newRound();
      }
      render();
      return;
    }

    const dt = TICK_MS / 1000;
    roundTime += dt;
    animClock += dt;

    // 爆弾
    for (const b of bombs.slice()) {
      b.fuse -= dt;
      if (b.fuse <= 0) detonate(b);
    }
    // 炎
    for (const f of flames) f.t -= dt;
    flames = flames.filter((f) => f.t > 0);

    // プレイヤー
    for (const pl of players) {
      if (!pl.alive) continue;

      if (pl.moving) {
        const dx = pl.tx - pl.x, dy = pl.ty - pl.y;
        const d = Math.hypot(dx, dy);
        // AI 自動運転時のみ高速化。手動モード中は全員が通常速度
        const step = pl.speed * (auto ? AUTO_BOOST : 1) * dt;
        if (d <= step) { pl.x = pl.tx; pl.y = pl.ty; pl.moving = false; }
        else { pl.x += (dx / d) * step; pl.y += (dy / d) * step; }
      }

      // パワーアップ取得
      const pr = Math.floor(pl.y), pc = Math.floor(pl.x);
      const pu = powerAt(pr, pc);
      if (pu) { applyPowerup(pl, pu); powerups.splice(powerups.indexOf(pu), 1); }

      // 静止中は AI 判断（手動プレイヤーは除く）
      if (!pl.moving) {
        pl.think -= dt;
        if (pl.think <= 0) {
          pl.think = 0.05;
          if (auto || pl.id !== 0) aiDecide(pl);
        }
      }

      // 炎に触れたら死亡
      if (flameAt(Math.floor(pl.y), Math.floor(pl.x))) pl.alive = false;
    }

    // サドンデス：一定時間を過ぎると外周からブロックが積まれて盤面が狭まる
    if (roundTime > SD_START && sdIndex < spiral.length) {
      sdAccum += dt;
      while (sdAccum >= sdInterval && sdIndex < spiral.length) {
        sdAccum -= sdInterval;
        dropWall(spiral[sdIndex++]);
      }
    }

    // 決着判定
    const alive = players.filter((p) => p.alive);
    if (state === 'play' && (alive.length <= 1 || roundTime > ROUND_LIMIT)) {
      state = 'roundover';
      restartCountdown = RESTART_TICKS;
      totalRounds++;
      localStorage.setItem(ROUNDS_KEY, String(totalRounds));
      if (alive.length === 1) winnerText = `PLAYER ${alive[0].id + 1} WIN!`;
      else if (alive.length === 0) winnerText = '相打ち！';
      else winnerText = '時間切れ';
      ctx.showOverlay(winnerText, auto ? '次ラウンド…' : 'キーで次へ');
      updateScores();
    } else {
      updateScores();
    }

    render();
  }

  // ---- 描画 ----
  let scale = 20, offX = 0, offY = 0;

  // 値を [lo,hi] に収めつつ奇数にする（壁の格子と 4 隅スポーンのため奇数必須）
  function oddClamp(v, lo, hi) {
    v = Math.max(lo, Math.min(hi, v));
    if (v % 2 === 0) v = (v - 1 >= lo) ? v - 1 : v + 1;
    return v;
  }

  // ウィンドウの大きさからマス数（COLS×ROWS）を決める。広げるほどマスが増える
  function applyGridSize() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cols = oddClamp(Math.round(rect.width / CELL_TARGET), 11, 17);
    const rows = oddClamp(Math.round(rect.height / CELL_TARGET), 11, 19);
    if (cols !== COLS || rows !== ROWS || grid.length === 0) {
      COLS = cols; ROWS = rows;
      if (round === 0) round = 1;
      newRound(); // サイズが変わったらその大きさで作り直す
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

  function render() {
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    g2d.fillStyle = '#1d6a2e';
    g2d.fillRect(offX, offY, COLS * scale, ROWS * scale);

    // マス
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = sx(c), y = sy(r), t = grid[r][c];
        if (t === 0) {
          g2d.fillStyle = (r + c) % 2 ? '#2f8a40' : '#2a8038';
          g2d.fillRect(x, y, scale + 1, scale + 1);
        } else if (t === 2) {
          // サドンデスで積まれた壁は赤系で「迫ってくる」感を出す
          const sd = sdWalls.has(`${r},${c}`);
          g2d.fillStyle = sd ? '#8a4a4a' : '#6b7785';
          g2d.fillRect(x, y, scale, scale);
          g2d.fillStyle = sd ? '#a86060' : '#8893a0';
          g2d.fillRect(x + scale * 0.12, y + scale * 0.12, scale * 0.76, scale * 0.5);
        } else {
          g2d.fillStyle = '#9c6b3f';
          g2d.fillRect(x + scale * 0.06, y + scale * 0.06, scale * 0.88, scale * 0.88);
          g2d.fillStyle = '#b07f4e';
          g2d.fillRect(x + scale * 0.12, y + scale * 0.12, scale * 0.76, scale * 0.34);
        }
      }
    }

    // パワーアップ
    for (const pu of powerups) {
      const x = sx(pu.c), y = sy(pu.r);
      g2d.fillStyle = '#111';
      g2d.fillRect(x + scale * 0.2, y + scale * 0.2, scale * 0.6, scale * 0.6);
      g2d.fillStyle = pu.type === 'bomb' ? '#e74c3c' : pu.type === 'fire' ? '#f39c12' : '#2ecc71';
      g2d.font = `bold ${Math.floor(scale * 0.5)}px sans-serif`;
      g2d.textAlign = 'center'; g2d.textBaseline = 'middle';
      g2d.fillText(pu.type === 'bomb' ? 'B' : pu.type === 'fire' ? 'F' : 'S',
        x + scale * 0.5, y + scale * 0.56);
      g2d.textAlign = 'left'; g2d.textBaseline = 'alphabetic';
    }

    // 爆弾
    for (const b of bombs) {
      const x = sx(b.c) + scale / 2, y = sy(b.r) + scale / 2;
      const pulse = 0.34 + 0.05 * Math.sin(b.fuse * 12);
      g2d.fillStyle = '#15151a';
      g2d.beginPath(); g2d.arc(x, y, scale * pulse, 0, Math.PI * 2); g2d.fill();
      g2d.fillStyle = '#e74c3c';
      g2d.fillRect(x - scale * 0.05, y - scale * 0.4, scale * 0.1, scale * 0.12);
    }

    // 炎
    for (const f of flames) {
      const x = sx(f.c), y = sy(f.r);
      g2d.fillStyle = f.t > FLAME_DUR * 0.5 ? '#fff3b0' : '#ff8c1a';
      g2d.fillRect(x + scale * 0.08, y + scale * 0.08, scale * 0.84, scale * 0.84);
      g2d.fillStyle = '#ff5722';
      g2d.fillRect(x + scale * 0.24, y + scale * 0.24, scale * 0.52, scale * 0.52);
    }

    // プレイヤー（ドット絵ロボット）
    for (const pl of players) {
      if (pl.alive) drawRobot(pl);
    }
  }

  function drawRobot(pl) {
    const cols = 8, rows = ROBOT_FRAMES[0].length;
    // 歩行中だけ脚を動かし、わずかに上下する
    const stepping = pl.moving && (Math.floor(animClock / 0.1) % 2 === 1);
    const pat = ROBOT_FRAMES[stepping ? 1 : 0];
    const dot = scale * 0.135;
    const w = cols * dot, h = rows * dot;
    const bob = stepping ? -dot * 0.6 : 0;
    const cx = offX + pl.x * scale, cy = offY + pl.y * scale;
    const ox = cx - w / 2, oy = cy - h / 2 + bob;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = pat[r][c];
        if (ch === '.') continue;
        g2d.fillStyle = ch === 'B' ? pl.color : ch === 'D' ? pl.accent
          : ch === 'E' ? '#9fefff' : '#ff5252';
        g2d.fillRect(Math.floor(ox + c * dot), Math.floor(oy + r * dot),
          Math.ceil(dot), Math.ceil(dot));
      }
    }
  }

  // ---- 操作（手動：プレイヤー1） ----
  function manualMove(dr, dc) {
    const pl = players[0];
    if (!pl || !pl.alive || pl.moving) return;
    const pr = Math.floor(pl.y), pc = Math.floor(pl.x);
    moveTo(pl, pr + dr, pc + dc);
  }

  function setDens(i) {
    densIdx = clampDens(i);
    localStorage.setItem(DENS_KEY, String(densIdx));
    newRound();
  }

  document.getElementById('bomber-minus').addEventListener('click', () => setDens(densIdx - 1));
  document.getElementById('bomber-plus').addEventListener('click', () => setDens(densIdx + 1));

  // ---- 共通インターフェース ----
  return {
    name: 'bomber',
    show() {
      wrapEl.style.display = 'flex';
      ctrlEl.style.display = 'inline-flex';
      relayout(); // ウィンドウサイズからマス数を決めて盤面を生成（初回・サイズ変更時）
      updateScores();
      updateDensLabel();
      if (timer === null) timer = setInterval(tick, TICK_MS);
    },
    hide() {
      clearInterval(timer); timer = null;
      wrapEl.style.display = 'none';
      ctrlEl.style.display = 'none';
    },
    setAuto(on) { auto = on; },
    key(e) {
      if (state === 'roundover') { round++; newRound(); return true; }
      if (e.key === 'ArrowUp') manualMove(-1, 0);
      else if (e.key === 'ArrowDown') manualMove(1, 0);
      else if (e.key === 'ArrowLeft') manualMove(0, -1);
      else if (e.key === 'ArrowRight') manualMove(0, 1);
      else if (e.key === ' ') {
        const pl = players[0];
        if (pl && pl.alive) placeBomb(pl, Math.floor(pl.y), Math.floor(pl.x));
      } else return false;
      return true;
    },
    relayout,
    reset: resetGame,
    isOver: () => state === 'roundover',
    // テスト用フック
    _tick: tick,
    _state: () => ({ state, round, totalRounds, auto, roundTime,
                     alive: players.filter((p) => p.alive).length,
                     bombs: bombs.length, flames: flames.length,
                     softBlocks: grid.flat().filter((v) => v === 1).length,
                     densIdx, cols: COLS, rows: ROWS })
  };
};
