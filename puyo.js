// ぷよぷよ ゲームロジック（描画なし・純粋ロジック）
// グリッドは grid[r][c]（r=0 が最上段・隠し段、r=1..12 が可視 12 段）
// 値は 0=空き、1..4=色

(() => {
  const W = 6;
  const H = 13; // 可視 12 段 + 最上段の隠し段
  const NUM_COLORS = 4;

  // rot: 0=子が軸の上, 1=右, 2=下, 3=左
  const CHILD_D = [[-1, 0], [0, 1], [1, 0], [0, -1]];

  // 連鎖ボーナス（簡略版：本家の連鎖倍率に近い伸び方）
  const CHAIN_BONUS = [1, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320];

  function emptyGrid() {
    return Array.from({ length: H }, () => new Array(W).fill(0));
  }

  // 各列の最上段の埋まり位置（行番号）。空列は H
  function colHeights(grid) {
    const hs = new Array(W).fill(H);
    for (let c = 0; c < W; c++) {
      for (let r = 0; r < H; r++) {
        if (grid[r][c] !== 0) { hs[c] = r; break; }
      }
    }
    return hs;
  }

  // ペア（colors=[軸色, 子色]）を col / rot で落とした結果のグリッドを返す。置けなければ null
  function dropPair(grid, col, rot, colors) {
    const [dr, dc] = CHILD_D[rot];
    const c2 = col + dc;
    if (col < 0 || col >= W || c2 < 0 || c2 >= W) return null;

    const g = grid.map((row) => row.slice());
    const hs = colHeights(g);

    if (rot === 0) {
      // 子が上：軸が先に着地
      const r1 = hs[col] - 1, r2 = r1 - 1;
      if (r2 < 0) return null;
      g[r1][col] = colors[0];
      g[r2][col] = colors[1];
    } else if (rot === 2) {
      // 子が下：子が先に着地
      const r2 = hs[col] - 1, r1 = r2 - 1;
      if (r1 < 0) return null;
      g[r2][col] = colors[1];
      g[r1][col] = colors[0];
    } else {
      const r1 = hs[col] - 1, r2 = hs[c2] - 1;
      if (r1 < 0 || r2 < 0) return null;
      g[r1][col] = colors[0];
      g[r2][c2] = colors[1];
    }
    return g;
  }

  // 4 個以上つながった同色グループを列挙（隠し段 r=0 は連結に含めない）
  function findGroups(grid) {
    const seen = Array.from({ length: H }, () => new Array(W).fill(false));
    const groups = [];
    for (let r = 1; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const color = grid[r][c];
        if (color === 0 || seen[r][c]) continue;
        const stack = [[r, c]];
        const cells = [];
        seen[r][c] = true;
        while (stack.length) {
          const [cr, cc] = stack.pop();
          cells.push([cr, cc]);
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nr = cr + dr, nc = cc + dc;
            if (nr < 1 || nr >= H || nc < 0 || nc >= W) continue;
            if (seen[nr][nc] || grid[nr][nc] !== color) continue;
            seen[nr][nc] = true;
            stack.push([nr, nc]);
          }
        }
        if (cells.length >= 4) groups.push(cells);
      }
    }
    return groups;
  }

  function applyGravity(grid) {
    for (let c = 0; c < W; c++) {
      const col = [];
      for (let r = H - 1; r >= 0; r--) {
        if (grid[r][c] !== 0) col.push(grid[r][c]);
      }
      for (let r = H - 1; r >= 0; r--) {
        grid[r][c] = col[H - 1 - r] || 0;
      }
    }
  }

  // 連鎖を最後まで解決する（AI シミュレーション用・アニメーションなし）
  function resolve(grid) {
    const g = grid.map((row) => row.slice());
    let chains = 0;
    let score = 0;
    while (true) {
      const groups = findGroups(g);
      if (groups.length === 0) break;
      chains++;
      let popped = 0;
      for (const cells of groups) {
        popped += cells.length;
        for (const [r, c] of cells) g[r][c] = 0;
      }
      score += popped * 10 * CHAIN_BONUS[Math.min(chains - 1, CHAIN_BONUS.length - 1)];
      applyGravity(g);
    }
    return { grid: g, chains, score };
  }

  window.Puyo = {
    W, H, NUM_COLORS, CHILD_D, CHAIN_BONUS,
    emptyGrid, colHeights, dropPair, findGroups, applyGravity, resolve
  };
})();
