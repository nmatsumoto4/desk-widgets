// ぷよぷよ AI
// 方針：「なるべく死なない範囲で多くの連鎖を狙う」
//  - 即死（3 列目が天井まで埋まる）になる置き方は最大限回避
//  - 通常時は発火を我慢して連鎖ポテンシャル（あと 1 個で何連鎖起きるか）を育てる
//  - 盤面が危険水位に達したら持っている連鎖を発火して凌ぐ

(() => {
  const { W, H, NUM_COLORS, colHeights, dropPair, resolve } = window.Puyo;

  // 1 個だけ落とした場合のグリッド（AI のポテンシャル評価用）
  function dropSingle(grid, col, color) {
    const hs = colHeights(grid);
    const r = hs[col] - 1;
    if (r < 0) return null;
    const g = grid.map((row) => row.slice());
    g[r][col] = color;
    return g;
  }

  // 連鎖ポテンシャル：任意の色 1 個をどこかに落として起きる最大連鎖数
  function potential(grid) {
    let best = 0;
    for (let color = 1; color <= NUM_COLORS; color++) {
      for (let c = 0; c < W; c++) {
        const g = dropSingle(grid, c, color);
        if (!g) continue;
        const res = resolve(g);
        if (res.chains > best) best = res.chains;
      }
    }
    return best;
  }

  // 同色隣接ペア数（連鎖の種の量。4 連結以上は resolve 済みなので存在しない）
  function linkScore(grid) {
    let links = 0;
    for (let r = 1; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const v = grid[r][c];
        if (v === 0) continue;
        if (c + 1 < W && grid[r][c + 1] === v) links++;
        if (r + 1 < H && grid[r + 1][c] === v) links++;
      }
    }
    return links;
  }

  function bestPlacement(grid, pairColors) {
    let best = null;
    let bestV = -Infinity;

    for (let rot = 0; rot < 4; rot++) {
      // 同色ペアは rot 0/2, 1/3 が等価なので半分に省く
      if (pairColors[0] === pairColors[1] && rot >= 2) break;

      for (let col = 0; col < W; col++) {
        const placed = dropPair(grid, col, rot, pairColors);
        if (!placed) continue;

        const res = resolve(placed);
        const hs = colHeights(res.grid);
        // 各列の埋まり高さ（0..13）
        const fh = hs.map((h) => H - h);

        let v;
        if (fh[2] >= H - 1) {
          // 次のスポーン（3 列目の上 2 マス）が塞がる＝死。発火数だけで比較する最終手段
          v = -1e9 + res.chains * 10;
        } else {
          const P = potential(res.grid);
          const maxFh = Math.max(...fh);
          const danger = fh[2] >= 8 || maxFh >= 10;

          v = 0;
          if (danger) {
            // 危険水位：生存最優先。持っている連鎖を惜しまず発火する
            v += res.chains * 2500 + res.chains * res.chains * 320;
          } else if (res.chains >= 4) {
            // 育った連鎖の発火は大きく評価
            v += res.chains * res.chains * 420;
          } else if (res.chains >= 1) {
            // 育成中の小連鎖発火は種の浪費なので抑制
            v -= 280;
          }
          // 連鎖ポテンシャルを育てる（高ポテンシャルほど加速度的に評価）
          v += P * 420 + P * P * 130;
          v += linkScore(res.grid) * 18;
          // 高さペナルティ（高く積みすぎない・3 列目は特に低く保つ）
          for (let c = 0; c < W; c++) {
            const over = Math.max(0, fh[c] - 8);
            v -= over * over * 30;
          }
          v -= fh[2] * 45;
          // 凸凹は操作の自由度を下げるので軽く減点
          for (let c = 0; c + 1 < W; c++) v -= Math.abs(fh[c] - fh[c + 1]) * 4;
        }

        if (v > bestV) {
          bestV = v;
          best = { col, rot };
        }
      }
    }
    return best;
  }

  window.PuyoAI = { bestPlacement, potential };
})();
