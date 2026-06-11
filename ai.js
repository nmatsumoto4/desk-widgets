// Expectimax 探索による 2048 AI
// 「最大タイルを伸ばす」ことを目的に、単調性・空きマス・角寄せを評価する

(() => {
  const SIZE = window.GAME_SIZE;

  // ---- 評価関数 ----

  function evaluate(grid) {
    let empty = 0;
    let maxVal = 0;
    let maxAtCorner = false;
    let smoothness = 0;
    let monotonicity = 0;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = grid[r][c];
        if (v === 0) {
          empty++;
          continue;
        }
        if (v > maxVal) {
          maxVal = v;
          maxAtCorner =
            (r === 0 || r === SIZE - 1) && (c === 0 || c === SIZE - 1);
        }
        const lv = Math.log2(v);
        // 滑らかさ：隣接タイルとの値の差が小さいほど良い
        if (c + 1 < SIZE && grid[r][c + 1] !== 0)
          smoothness -= Math.abs(lv - Math.log2(grid[r][c + 1]));
        if (r + 1 < SIZE && grid[r + 1][c] !== 0)
          smoothness -= Math.abs(lv - Math.log2(grid[r + 1][c]));
      }
    }

    // 単調性：各行・各列が単調（昇順または降順）に近いほど良い
    for (let r = 0; r < SIZE; r++) {
      monotonicity += lineMonotonicity(grid[r]);
    }
    for (let c = 0; c < SIZE; c++) {
      monotonicity += lineMonotonicity(grid.map((row) => row[c]));
    }

    return (
      empty * 270 +
      smoothness * 30 +
      monotonicity * 47 +
      Math.log2(maxVal || 1) * 100 +
      (maxAtCorner ? 700 : 0)
    );
  }

  function lineMonotonicity(line) {
    let inc = 0;
    let dec = 0;
    for (let i = 0; i + 1 < SIZE; i++) {
      const a = line[i] ? Math.log2(line[i]) : 0;
      const b = line[i + 1] ? Math.log2(line[i + 1]) : 0;
      if (a > b) dec -= a - b;
      else inc -= b - a;
    }
    return Math.max(inc, dec);
  }

  // ---- Expectimax 本体 ----

  function expectimax(grid, depth, isPlayerTurn) {
    if (depth === 0) return evaluate(grid);

    if (isPlayerTurn) {
      let best = -Infinity;
      for (const dir of ['up', 'right', 'down', 'left']) {
        const { grid: g, moved } = Game.simulateMove(grid, dir);
        if (!moved) continue;
        best = Math.max(best, expectimax(g, depth - 1, false));
      }
      return best === -Infinity ? evaluate(grid) - 100000 : best;
    }

    // 確率ノード：空きマスに 2 (90%) / 4 (10%) が湧く期待値
    const empty = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (grid[r][c] === 0) empty.push([r, c]);

    if (empty.length === 0) return evaluate(grid);

    // 空きが多いときは全列挙すると重いのでサンプリングする
    let cells = empty;
    if (empty.length > 6) {
      cells = [];
      const pool = empty.slice();
      for (let i = 0; i < 6; i++) {
        cells.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
    }

    let total = 0;
    for (const [r, c] of cells) {
      for (const [val, prob] of [[2, 0.9], [4, 0.1]]) {
        grid[r][c] = val;
        total += prob * expectimax(grid, depth - 1, true);
        grid[r][c] = 0;
      }
    }
    return total / cells.length;
  }

  // 空きマス数に応じて探索深さを変える（終盤ほど深く読む）
  function pickDepth(grid) {
    let empty = 0;
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) if (grid[r][c] === 0) empty++;
    if (empty <= 3) return 5;
    if (empty <= 7) return 4;
    return 3;
  }

  // 最善手を返す。動ける手がなければ null
  function bestMove(grid) {
    const depth = pickDepth(grid);
    let best = null;
    let bestScore = -Infinity;
    for (const dir of ['up', 'right', 'down', 'left']) {
      const { grid: g, moved } = Game.simulateMove(grid, dir);
      if (!moved) continue;
      const score = expectimax(g, depth - 1, false);
      if (score > bestScore) {
        bestScore = score;
        best = dir;
      }
    }
    return best;
  }

  window.AI = { bestMove };
})();
