// Rush Hour ゲームロジック（描画なし・純粋ロジック）
// 6x6 の盤面。vehicles[0] が赤い車（脱出対象、3 行目・水平・長さ 2）で、
// 右端の出口（EXIT_ROW）から脱出させる。

(() => {
  const N = 12;               // 12x12（従来 6x6 の約 4 倍のマス数）
  const EXIT_ROW = 6;
  const MAX_VISITED = 18000;  // A*（手動介入後の再計画用）の探索上限。大盤面では素早く見切る

  // vehicle: { r, c, len, horiz }
  function cellsOf(v) {
    const cells = [];
    for (let i = 0; i < v.len; i++) {
      cells.push(v.horiz ? [v.r, v.c + i] : [v.r + i, v.c]);
    }
    return cells;
  }

  function buildGrid(vehicles) {
    const grid = Array.from({ length: N }, () => new Array(N).fill(-1));
    vehicles.forEach((v, i) => {
      for (const [r, c] of cellsOf(v)) grid[r][c] = i;
    });
    return grid;
  }

  // 車 i を delta（±1）動かせるか
  function canMove(vehicles, i, delta, grid = null) {
    const g = grid || buildGrid(vehicles);
    const v = vehicles[i];
    let r, c;
    if (v.horiz) {
      r = v.r;
      c = delta > 0 ? v.c + v.len : v.c - 1;
    } else {
      r = delta > 0 ? v.r + v.len : v.r - 1;
      c = v.c;
    }
    if (r < 0 || r >= N || c < 0 || c >= N) return false;
    return g[r][c] === -1;
  }

  // 二分ヒープ（A* 用の優先度付きキュー）
  function makeHeap() {
    const fa = []; const da = []; // f 値 / データ（pos）
    const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (fa[p] <= fa[i]) break; [fa[p], fa[i]] = [fa[i], fa[p]]; [da[p], da[i]] = [da[i], da[p]]; i = p; } };
    const down = (i) => { const n = fa.length; for (;;) { let s = i, l = i * 2 + 1, r = l + 1; if (l < n && fa[l] < fa[s]) s = l; if (r < n && fa[r] < fa[s]) s = r; if (s === i) break; [fa[s], fa[i]] = [fa[i], fa[s]]; [da[s], da[i]] = [da[i], da[s]]; i = s; } };
    return {
      get size() { return fa.length; },
      push(f, d) { fa.push(f); da.push(d); up(fa.length - 1); },
      pop() { const d = da[0], f = fa.pop(); const x = da.pop(); if (fa.length) { fa[0] = f; da[0] = x; down(0); } return d; },
    };
  }

  // A*（赤車の経路をふさぐ縦車の台数＋1 をヒューリスティックに）で最短手順を探索。解けなければ null
  function solve(vehicles) {
    const startPos = vehicles.map((v) => (v.horiz ? v.c : v.r));
    const goal = N - vehicles[0].len;
    const redLen = vehicles[0].len;
    const encode = (pos) => pos.join(',');

    // ヒューリスティック：赤車の右側の列で EXIT_ROW を跨ぐ縦車の数（+1）。下限見積りで admissible
    const heur = (pos) => {
      const rc = pos[0]; if (rc === goal) return 0;
      let b = 0;
      for (let i = 1; i < vehicles.length; i++) {
        const v = vehicles[i]; if (v.horiz) continue;
        const col = v.c; if (col < rc + redLen || col >= N) continue;
        const r0 = pos[i], r1 = pos[i] + v.len - 1;
        if (r0 <= EXIT_ROW && EXIT_ROW <= r1) b++;
      }
      return b + 1;
    };

    const startKey = encode(startPos);
    const gScore = new Map([[startKey, 0]]);
    const parent = new Map([[startKey, null]]);
    const heap = makeHeap();
    heap.push(heur(startPos), startPos);
    let visited = 0;

    while (heap.size && visited < MAX_VISITED) {
      const pos = heap.pop(); visited++;
      const key = encode(pos); const g = gScore.get(key);
      if (pos[0] === goal) {
        const moves = []; let k = key;
        while (parent.get(k)) { const [pk, mv] = parent.get(k); moves.push(mv); k = pk; }
        return moves.reverse();
      }
      const vs = vehicles.map((v, i) => (v.horiz ? { ...v, c: pos[i] } : { ...v, r: pos[i] }));
      const grid = buildGrid(vs);
      for (let i = 0; i < vs.length; i++) {
        for (const delta of [-1, 1]) {
          if (!canMove(vs, i, delta, grid)) continue;
          const npos = pos.slice(); npos[i] += delta;
          const nkey = encode(npos); const ng = g + 1;
          const old = gScore.get(nkey);
          if (old !== undefined && old <= ng) continue;
          gScore.set(nkey, ng); parent.set(nkey, [key, { idx: i, delta }]);
          heap.push(ng + heur(npos), npos);
        }
      }
    }
    return null;
  }

  // 構築生成：赤車の前（出口までの経路）に必ず minBlockers 台以上の縦車を置き、
  // 各ブロッカーには「出口行から外れるための退避レーン」を確保しておく（＝必ず解ける）。
  // 飾りの車は出口行を塞がない位置にだけ置く。解は「塞いでいる車だけをどかして赤を直進」。
  function construct(numCars, minBlockers, rng) {
    const occupied = new Set();
    const mark = (v) => cellsOf(v).forEach(([r, c]) => occupied.add(r * N + c));
    const used = (r, c) => occupied.has(r * N + c);
    const fits = (v) => {
      if (v.r < 0 || v.c < 0) return false;
      if (v.horiz && v.c + v.len > N) return false;
      if (!v.horiz && v.r + v.len > N) return false;
      return cellsOf(v).every(([r, c]) => !used(r, c));
    };

    const red = { r: EXIT_ROW, c: (rng() * 3) | 0, len: 2, horiz: true };
    mark(red);
    const vehicles = [red];
    const sol = [];

    // 赤の右側の列をシャッフルし、縦のブロッカーを置く（各々に退避レーンを予約）
    const cols = [];
    for (let c = red.c + red.len; c <= N - 1; c++) cols.push(c);
    for (let i = cols.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = cols[i]; cols[i] = cols[j]; cols[j] = t; }
    const want = Math.min(cols.length, Math.max(minBlockers, minBlockers + ((rng() * 3) | 0)));
    let blockers = 0;
    for (const c of cols) {
      if (blockers >= want) break;
      const len = rng() < 0.5 ? 2 : 3;
      const rlo = Math.max(0, EXIT_ROW - len + 1), rhi = Math.min(N - len, EXIT_ROW);
      for (let a = 0; a < 10; a++) {
        const r = rlo + ((rng() * (rhi - rlo + 1)) | 0);
        const v = { r, c, len, horiz: false };
        if (!fits(v)) continue;
        const r1 = r + len - 1;
        const upSteps = r1 - EXIT_ROW + 1, downSteps = EXIT_ROW - r + 1;
        const upLane = [], downLane = [];
        for (let rr = r - 1; rr >= r - upSteps; rr--) upLane.push(rr);
        for (let rr = r1 + 1; rr <= r1 + downSteps; rr++) downLane.push(rr);
        const upOK = (r - upSteps) >= 0 && upLane.every((rr) => !used(rr, c));
        const downOK = (r1 + downSteps) <= N - 1 && downLane.every((rr) => !used(rr, c));
        let dir = 0, steps = 0, lane = null;
        if (upOK && (!downOK || rng() < 0.5)) { dir = -1; steps = upSteps; lane = upLane; }
        else if (downOK) { dir = 1; steps = downSteps; lane = downLane; }
        else continue;
        const vi = vehicles.length;
        mark(v); for (const rr of lane) occupied.add(rr * N + c);   // 退避レーンを予約（飾りが入らないように）
        vehicles.push(v);
        for (let s = 0; s < steps; s++) sol.push({ idx: vi, delta: dir });
        blockers++; break;
      }
    }
    if (blockers < minBlockers) return null;   // 前に十分な障害物を置けなければ作り直し

    // 飾りの車：出口行は絶対に塞がない（＝動かす必要のない車）
    let guard = 0;
    while (vehicles.length < numCars && guard < numCars * 50) {
      guard++;
      const horiz = rng() < 0.5;
      const len = rng() < 0.7 ? 2 : 3;
      let r, c;
      if (horiz) { do { r = (rng() * N) | 0; } while (r === EXIT_ROW); c = (rng() * (N - len + 1)) | 0; }
      else { c = (rng() * N) | 0; r = (rng() * (N - len + 1)) | 0; if (r <= EXIT_ROW && EXIT_ROW <= r + len - 1) continue; } // 出口行を跨がない
      const v = { r, c, len, horiz };
      if (!fits(v)) continue;
      mark(v); vehicles.push(v);
    }

    // ブロッカーを全部どかしたら、赤は何も動かさず出口まで直進
    const goal = N - red.len;
    for (let cc = red.c; cc < goal; cc++) sol.push({ idx: 0, delta: 1 });
    return { vehicles, sol };
  }

  // 問題を時間予算内で生成（構築生成なので必ず可解）。戻り値: { vehicles, sol }
  function genPuzzle(numCars, { minBlockers = 5, budgetMs = 400 } = {}) {
    const deadline = Date.now() + budgetMs;
    const rng = Math.random;
    let best = null;
    while (Date.now() < deadline) {
      const res = construct(numCars, minBlockers, rng);
      if (!res) continue;
      if (!best || res.sol.length > best.sol.length) best = res;
      if (best.sol.length >= 14) break;
    }
    return best;
  }

  window.Rush = { N, EXIT_ROW, cellsOf, buildGrid, canMove, solve, genPuzzle };
})();
