// Rush Hour ゲームロジック（描画なし・純粋ロジック）
// 6x6 の盤面。vehicles[0] が赤い車（脱出対象、3 行目・水平・長さ 2）で、
// 右端の出口（EXIT_ROW）から脱出させる。

(() => {
  const N = 6;
  const EXIT_ROW = 2;
  const MAX_VISITED = 200000; // BFS の探索上限（実質無制限だが暴走防止）

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

  // BFS で最短手順（1 マス移動の列）を探索する。解けなければ null
  function solve(vehicles) {
    const startPos = vehicles.map((v) => (v.horiz ? v.c : v.r));
    const goal = N - vehicles[0].len;
    const encode = (pos) => pos.join(',');

    const startKey = encode(startPos);
    const parent = new Map([[startKey, null]]); // key -> [prevKey, move]
    const queue = [startPos];
    let qi = 0;

    while (qi < queue.length && parent.size < MAX_VISITED) {
      const pos = queue[qi++];
      if (pos[0] === goal) {
        // 経路復元
        const moves = [];
        let key = encode(pos);
        while (parent.get(key)) {
          const [prevKey, move] = parent.get(key);
          moves.push(move);
          key = prevKey;
        }
        return moves.reverse();
      }

      // この状態の車配置を再構築
      const vs = vehicles.map((v, i) => (
        v.horiz ? { ...v, c: pos[i] } : { ...v, r: pos[i] }
      ));
      const grid = buildGrid(vs);
      const key = encode(pos);

      for (let i = 0; i < vs.length; i++) {
        for (const delta of [-1, 1]) {
          if (!canMove(vs, i, delta, grid)) continue;
          const npos = pos.slice();
          npos[i] += delta;
          const nkey = encode(npos);
          if (parent.has(nkey)) continue;
          parent.set(nkey, [key, { idx: i, delta }]);
          queue.push(npos);
        }
      }
    }
    return null;
  }

  // 車をランダム配置（重なりなし）。失敗したら null
  function tryPlace(numCars, rng) {
    const occupied = new Set();
    const mark = (v) => cellsOf(v).forEach(([r, c]) => occupied.add(r * N + c));
    const fits = (v) => {
      if (v.horiz && v.c + v.len > N) return false;
      if (!v.horiz && v.r + v.len > N) return false;
      return cellsOf(v).every(([r, c]) => !occupied.has(r * N + c));
    };

    // 赤い車：出口行の左寄り（難しくなりやすい）
    const red = { r: EXIT_ROW, c: Math.floor(rng() * 2), len: 2, horiz: true };
    mark(red);
    const vehicles = [red];

    for (let i = 1; i < numCars; i++) {
      let placed = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const horiz = rng() < 0.5;
        const len = rng() < 0.72 ? 2 : 3;
        // 出口行に水平車を置くと絶対に解けないので避ける
        const r = horiz
          ? (() => { let rr; do { rr = Math.floor(rng() * N); } while (rr === EXIT_ROW); return rr; })()
          : Math.floor(rng() * (N - len + 1));
        const c = horiz
          ? Math.floor(rng() * (N - len + 1))
          : Math.floor(rng() * N);
        const v = { r, c, len, horiz };
        if (!fits(v)) continue;
        mark(v);
        vehicles.push(v);
        placed = true;
        break;
      }
      if (!placed) return null;
    }
    return vehicles;
  }

  // 可解でなるべく手数の長い問題を時間予算内で生成する
  // 戻り値: { vehicles, sol } （sol は最短手順）
  function genPuzzle(numCars, { target = 16, budgetMs = 600 } = {}) {
    const deadline = Date.now() + budgetMs;
    const rng = Math.random;
    let best = null;

    while (Date.now() < deadline) {
      const vehicles = tryPlace(numCars, rng);
      if (!vehicles) continue;
      const sol = solve(vehicles);
      if (!sol || sol.length < 4) continue; // 自明すぎる問題は捨てる
      if (!best || sol.length > best.sol.length) best = { vehicles, sol };
      if (best.sol.length >= target) break;
    }
    return best;
  }

  window.Rush = { N, EXIT_ROW, cellsOf, buildGrid, canMove, solve, genPuzzle };
})();
