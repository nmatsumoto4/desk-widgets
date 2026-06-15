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

  // 逆生成：赤車を「出口にある＝解けた状態」から、有効な手をランダムに巻き戻して問題を作る。
  // こうして得た配置は構成上“必ず解ける”。walkSol（巻き戻しの逆順＝正しい解）も返す。
  function reverseGen(numCars, steps, rng) {
    const occupied = new Set();
    const mark = (v) => cellsOf(v).forEach(([r, c]) => occupied.add(r * N + c));
    const unmark = (v) => cellsOf(v).forEach(([r, c]) => occupied.delete(r * N + c));
    const fits = (v) => {
      if (v.r < 0 || v.c < 0) return false;
      if (v.horiz && v.c + v.len > N) return false;
      if (!v.horiz && v.r + v.len > N) return false;
      return cellsOf(v).every(([r, c]) => !occupied.has(r * N + c));
    };
    // 赤車は出口（右端）に置く＝ゴール状態
    const red = { r: EXIT_ROW, c: N - 2, len: 2, horiz: true };
    mark(red);
    const vehicles = [red];
    // 他の車をランダム配置（出口行に水平車は置かない）
    let guard = 0;
    while (vehicles.length < numCars && guard < numCars * 40) {
      guard++;
      const horiz = rng() < 0.45;
      const len = rng() < 0.7 ? 2 : 3;
      const r = horiz ? (() => { let rr; do { rr = Math.floor(rng() * N); } while (rr === EXIT_ROW); return rr; })() : Math.floor(rng() * (N - len + 1));
      const c = horiz ? Math.floor(rng() * (N - len + 1)) : Math.floor(rng() * N);
      const v = { r, c, len, horiz };
      if (!fits(v)) continue;
      mark(v); vehicles.push(v);
    }
    if (vehicles.length < 5) return null;

    // ランダムウォークで巻き戻す（赤を左へ寄せる弱いバイアス＋直前手の即取消は避ける）
    const applied = [];
    let lastIdx = -1, lastDelta = 0;
    for (let s = 0; s < steps; s++) {
      const grid = buildGrid(vehicles);
      const moves = [];
      for (let i = 0; i < vehicles.length; i++) for (const d of [-1, 1]) { if (!canMove(vehicles, i, d, grid)) continue; if (i === lastIdx && d === -lastDelta) continue; moves.push([i, d]); }
      if (!moves.length) break;
      // 赤を左へ動かす手があれば優先的に（35%）選ぶ
      let pick;
      const redLeft = moves.find((m) => m[0] === 0 && m[1] === -1);
      if (redLeft && rng() < 0.35) pick = redLeft; else pick = moves[(rng() * moves.length) | 0];
      const v = vehicles[pick[0]]; unmark(v); if (v.horiz) v.c += pick[1]; else v.r += pick[1]; mark(v);
      applied.push({ idx: pick[0], delta: pick[1] });
      lastIdx = pick[0]; lastDelta = pick[1];
    }
    // 赤が出口から十分離れていなければ自明扱いで捨てる
    if (vehicles[0].c > N - 2 - 3) return null;
    const walkSol = applied.slice().reverse().map((m) => ({ idx: m.idx, delta: -m.delta }));
    return { vehicles, walkSol };
  }

  // 可解でなるべく歯ごたえのある問題を時間予算内で生成する（逆生成で“必ず解ける”）
  // 戻り値: { vehicles, sol } （sol は A* の最短手順。見つからなければ巻き戻しの逆＝確実な手順）
  function genPuzzle(numCars, { target = 22, budgetMs = 500 } = {}) {
    const deadline = Date.now() + budgetMs;
    const rng = Math.random;
    let best = null;
    // 逆生成の手数 ≒ 巻き戻し歩数。target 前後を狙って巻き戻す
    while (Date.now() < deadline) {
      const gen = reverseGen(numCars, target + ((rng() * 10) | 0), rng);
      if (!gen) continue;
      const sol = gen.walkSol;                  // 構成上“必ず解ける”確実な手順（A* 不要）
      if (sol.length < 8) continue;             // 自明すぎる問題は捨てる
      if (!best || sol.length > best.sol.length) best = { vehicles: gen.vehicles, sol };
      if (best.sol.length >= target) break;
    }
    return best;
  }

  window.Rush = { N, EXIT_ROW, cellsOf, buildGrid, canMove, solve, genPuzzle };
})();
