// 2048 ゲームロジック（描画なし・純粋ロジック）
// タイルは {id, value, r, c} のオブジェクトで管理し、アニメーション用に id を保持する

const SIZE = 4;
const DIRS = { up: 0, right: 1, down: 2, left: 3 };

class Game {
  tiles: any[];
  score: number;
  over: boolean;
  _nextId: number;

  constructor() {
    this.reset();
  }

  reset() {
    this.tiles = [];
    this.score = 0;
    this.over = false;
    this._nextId = 1;
    this._spawn();
    this._spawn();
  }

  // 4x4 の数値グリッド（空きは 0）を返す。AI 探索用
  grid() {
    const g = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
    for (const t of this.tiles) g[t.r][t.c] = t.value;
    return g;
  }

  maxTile() {
    return this.tiles.reduce((m, t) => Math.max(m, t.value), 0);
  }

  _emptyCells() {
    const g = this.grid();
    const empty = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (g[r][c] === 0) empty.push([r, c]);
    return empty;
  }

  _spawn() {
    const empty = this._emptyCells();
    if (empty.length === 0) return null;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    const tile = {
      id: this._nextId++,
      value: Math.random() < 0.9 ? 2 : 4,
      r, c,
      isNew: true
    };
    this.tiles.push(tile);
    return tile;
  }

  // dir: 'up' | 'right' | 'down' | 'left'
  // 動いたら true。タイルの r/c を更新し、マージ結果を反映する
  move(dir) {
    if (this.over) return false;

    const vec = {
      up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1]
    }[dir];

    // 移動方向の奥側から処理するためのトラバース順
    const rows = [...Array(SIZE).keys()];
    const cols = [...Array(SIZE).keys()];
    if (vec[0] === 1) rows.reverse();
    if (vec[1] === 1) cols.reverse();

    const cellMap = new Map(); // "r,c" -> tile
    for (const t of this.tiles) {
      t.isNew = false;
      t.mergedFrom = null;
      cellMap.set(`${t.r},${t.c}`, t);
    }

    let moved = false;
    const mergedIds = new Set();
    const removed = [];

    for (const r of rows) {
      for (const c of cols) {
        const tile = cellMap.get(`${r},${c}`);
        if (!tile) continue;

        // 進めるところまで進む
        let [nr, nc] = [tile.r, tile.c];
        while (true) {
          const [tr, tc] = [nr + vec[0], nc + vec[1]];
          if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) break;
          const blocker = cellMap.get(`${tr},${tc}`);
          if (!blocker) {
            [nr, nc] = [tr, tc];
            continue;
          }
          // 同値かつそのターン未マージならマージ
          if (blocker.value === tile.value && !mergedIds.has(blocker.id)) {
            [nr, nc] = [tr, tc];
          }
          break;
        }

        if (nr === tile.r && nc === tile.c) continue;

        const target = cellMap.get(`${nr},${nc}`);
        cellMap.delete(`${tile.r},${tile.c}`);

        if (target) {
          // マージ：target を倍にし、tile は消える（renderer が消滅アニメに使えるよう記録）
          target.value *= 2;
          target.mergedFrom = tile.id;
          mergedIds.add(target.id);
          this.score += target.value;
          removed.push(tile.id);
          tile.r = nr;
          tile.c = nc;
        } else {
          tile.r = nr;
          tile.c = nc;
          cellMap.set(`${nr},${nc}`, tile);
        }
        moved = true;
      }
    }

    if (!moved) return false;

    this.tiles = this.tiles.filter((t) => !removed.includes(t.id));
    this._spawn();

    if (!Game.anyMovePossible(this.grid())) this.over = true;
    return true;
  }

  // ---- 静的ヘルパー（AI からも使う） ----

  // グリッドに対して dir 方向の移動をシミュレートする
  // 戻り値: { grid, score, moved }
  static simulateMove(grid, dir) {
    const g = grid.map((row) => row.slice());
    let score = 0;
    let moved = false;

    // 行単位の左寄せ処理に正規化する
    const lines = [];
    for (let i = 0; i < SIZE; i++) {
      const line = [];
      for (let j = 0; j < SIZE; j++) {
        if (dir === 'left') line.push(g[i][j]);
        else if (dir === 'right') line.push(g[i][SIZE - 1 - j]);
        else if (dir === 'up') line.push(g[j][i]);
        else line.push(g[SIZE - 1 - j][i]); // down
      }
      lines.push(line);
    }

    for (const line of lines) {
      const orig = line.slice();
      const packed = line.filter((v) => v !== 0);
      const out = [];
      for (let k = 0; k < packed.length; k++) {
        if (k + 1 < packed.length && packed[k] === packed[k + 1]) {
          const merged = packed[k] * 2;
          out.push(merged);
          score += merged;
          k++;
        } else {
          out.push(packed[k]);
        }
      }
      while (out.length < SIZE) out.push(0);
      for (let j = 0; j < SIZE; j++) {
        line[j] = out[j];
        if (out[j] !== orig[j]) moved = true;
      }
    }

    // 正規化を元に戻す
    for (let i = 0; i < SIZE; i++) {
      for (let j = 0; j < SIZE; j++) {
        if (dir === 'left') g[i][j] = lines[i][j];
        else if (dir === 'right') g[i][SIZE - 1 - j] = lines[i][j];
        else if (dir === 'up') g[j][i] = lines[i][j];
        else g[SIZE - 1 - j][i] = lines[i][j];
      }
    }

    return { grid: g, score, moved };
  }

  static anyMovePossible(grid) {
    for (const dir of ['up', 'right', 'down', 'left']) {
      if (Game.simulateMove(grid, dir).moved) return true;
    }
    return false;
  }
}

window.Game = Game;
window.GAME_SIZE = SIZE;
