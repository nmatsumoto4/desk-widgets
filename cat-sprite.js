// 猫スプライト描画（ドット絵版）
// ポーズごとのドットパターンを文字グリッドで定義し、1 ドット = DOT px の矩形で描く。
// 文字 → 色の対応（種類ごとのパレットで差し替え）：
//   . 透明 / B 体色 / W お腹・胸 / A ぶちA / C ぶちB / S しま
//   P ピンク（耳の内側・鼻） / M 口・閉じ目などの暗色 / e 目 / T ネクタイ
//
// cat.js からの呼び出しインターフェース（drawCat(g, type, frame), W, H）は旧版と同一。

(() => {
  const W = 160, H = 140, GROUND = 134;
  const DOT = 6; // 1 ドットの論理ピクセルサイズ

  // ---- ドットパターン ----

  const SIT = [
    '......A........C......',
    '.....AAA......CCC.....',
    '.....APA......CPC.....',
    '....BAABBBBBBBBCCB....',
    '...BBBBBBBBBBBBBBBB...',
    '...BBeeBBBBBBBBeeBB...',
    '...BBeeBBBBBBBBeeBB...',
    '...BBBBBBBPPBBBBBBB...',
    '....BBBBBBMMBBBBBB....',
    '.....BBBBBBBBBBBB.....',
    '....BBBBWWWWWWCCBB....',
    '...BBBBWWWWWWWWCCBB...',
    '...BBBBWWTTTTWWBBBB...',
    '...ABBBWWTTTTWWBBBB...',
    '...SABBWWWWWWWWBBBS...',
    '...SBBBWWWWWWWWBBBS...',
    '....BBBB.BBBB.BBBB....',
    '....BBB...BB....BB....'
  ];

  const WALK1 = [
    '...............A....C..',
    '..............AAA..CCC.',
    '..............BBBBBBBB.',
    '..............BBBBBBBB.',
    '..............BeeBBeeB.',
    '..............BBBBPPBB.',
    '....BBBBBBBBBBBBBBMMBB.',
    '...BBBBBBBBBBBBBBBBBB..',
    '...BSBBSBBSBBBBBBBBB...',
    '...BBBBBBBBBBBBBBBB....',
    '...BBWWWWWWWWWWBBBB....',
    '....BBBBBBBBBBBBBB.....',
    '....BB...BB..BB..BB....',
    '....BB...BB..BB..BB....',
    '...BB...BB....BB..BB...'
  ];

  const WALK2 = [
    '...............A....C..',
    '..............AAA..CCC.',
    '..............BBBBBBBB.',
    '..............BBBBBBBB.',
    '..............BeeBBeeB.',
    '..............BBBBPPBB.',
    '....BBBBBBBBBBBBBBMMBB.',
    '...BBBBBBBBBBBBBBBBBB..',
    '...BSBBSBBSBBBBBBBBB...',
    '...BBBBBBBBBBBBBBBB....',
    '...BBWWWWWWWWWWBBBB....',
    '....BBBBBBBBBBBBBB.....',
    '.....BB..BB...BB.BB....',
    '.....BB...BB.BB...BB...',
    '......B....BB......B...'
  ];

  const SLEEP = [
    '.....A...C............',
    '....AA..CC............',
    '...BBBBBBBBBBBBBBB....',
    '..BBBBBBBBBBBBBBBBB...',
    '..BMMBBMMBBBBBBBBBB...',
    '..BBBPPBBBBBBBBBBBB...',
    '..BBBBBBBBBBBBBBBBBB..',
    '...BBBBBBBBBBBBBBBB...',
    '....SSBBBBBBBBBSS.....'
  ];

  // エフェクト用ミニパターン
  const HEART = [
    '.HH.HH.',
    'HHHHHHH',
    'HHHHHHH',
    '.HHHHH.',
    '..HHH..',
    '...H...'
  ];

  const ZED = [
    'ZZZZ',
    '..Z.',
    '.Z..',
    'ZZZZ'
  ];

  const DROP = [
    '.D.',
    'DDD',
    'DDD',
    '.D.'
  ];

  // ポーズごとのメタ情報：耳の先端（ピクッと立てる用）としっぽの付け根（ドット座標）
  const POSE_META = {
    sit:   { grid: () => SIT,   earTips: [[6, 0], [15, 0]], tail: { col: 19, row: 14, up: false } },
    walk:  { grid: (f) => (f % 2 ? WALK2 : WALK1), earTips: [[15, 0], [21, 0]], tail: { col: 4, row: 7, up: true } },
    sleep: { grid: () => SLEEP, earTips: [], tail: null },
    react: { grid: () => SIT,   earTips: [[6, 0], [15, 0]], tail: { col: 19, row: 14, up: false } }
  };

  function palette(t) {
    return {
      B: t.base,
      W: t.belly || lighten(t.base),
      A: t.patchA || t.base,
      C: t.patchB || t.patchA || t.base,
      S: t.stripes || t.base,
      P: '#e8a0a4',
      M: '#4a4440',
      T: t.tie ? t.tie : (t.belly || lighten(t.base)),
      e: null // 目は専用処理
    };
  }

  function drawCat(g, type, f) {
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;

    const meta = POSE_META[f.pose] || POSE_META.sit;
    const frameIdx = Math.floor(f.t * 6);
    const grid = meta.grid(frameIdx);
    const pal = palette(type);

    const gw = Math.max(...grid.map((r) => r.length));
    const gh = grid.length;
    const ox = Math.round((W - gw * DOT) / 2 / DOT) * DOT;
    // 歩きの上下バウンドも 1 ドット単位で
    const bobDots = f.pose === 'walk' && frameIdx % 2 ? 1 : 0;
    const jump = Math.round((f.jump || 0) * 3) * DOT;
    const oy = GROUND - gh * DOT - jump + bobDots * 0; // bob は脚パターン差で表現済み

    g.save();
    g.translate(W / 2, 0);
    if (f.dir < 0) g.scale(-1, 1);
    g.translate(-W / 2, 0);

    const dot = (col, row, color) => {
      g.fillStyle = color;
      g.fillRect(ox + col * DOT, oy + row * DOT, DOT, DOT);
    };

    // 目の領域（'e'）を集めて表情処理に使う
    const eyeCells = [];
    for (let r = 0; r < gh; r++) {
      const row = grid[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.' || ch === ' ') continue;
        if (ch === 'e') { eyeCells.push([c, r]); continue; }
        dot(c, r, pal[ch] || pal.B);
      }
    }

    // しっぽ（ドット単位でゆらゆら動かす）
    if (meta.tail) drawTail(g, type, meta.tail, f.t, ox, oy, dot);

    // 目：開＝瞳色ドット、閉/にこにこ/ジト目＝下段のみ暗色ライン
    const eyeMaxRow = Math.max(...eyeCells.map(([, r]) => r), 0);
    const lookShift = Math.round(Math.max(-1, Math.min(1, f.lookX || 0)));
    for (const [c, r] of eyeCells) {
      if (f.eyes === 'closed' || f.eyes === 'happy' || f.eyes === 'line') {
        if (r === eyeMaxRow) dot(c + lookShift, r, '#4a4440');
        else dot(c, r, pal.B);
      } else {
        // 目が 2 段あるポーズは上段＝瞳色（虹彩）、下段＝暗色（瞳孔）
        const eyeMinRow = Math.min(...eyeCells.map(([, rr]) => rr));
        const twoRows = eyeMinRow < eyeMaxRow;
        const color = twoRows && r === eyeMaxRow ? '#2e2b28' : (type.eye || '#3a3530');
        dot(c + lookShift, r, color);
        if (f.eyes === 'wide') dot(c + lookShift, r - 2, type.eye || '#3a3530');
      }
    }

    // 耳ピクッ（カーソルが近いとき先端に 1 ドット足す）
    if (f.earPerk > 0.5) {
      for (const [c, r] of meta.earTips) {
        const ch = grid[r] && grid[r][c];
        const color = ch === 'A' ? pal.A : ch === 'C' ? pal.C : pal.B;
        dot(c, r - 1, color);
      }
    }

    g.restore();

    // エフェクト（反転の影響を受けない）
    if (f.heart) drawPattern(g, HEART, '#e8606a', 100, 28 - ((f.t * 1.5) % 1) * 14, 3, 1 - ((f.t * 1.5) % 1) * 0.7);
    if (f.sweat) drawPattern(g, DROP, '#6db3e8', 114, 48 + ((f.t * 1.2) % 1) * 8, 3, 0.9);
    if (f.zzz) {
      for (let i = 0; i < 3; i++) {
        const p = (f.t * 0.45 + i * 0.33) % 1;
        drawPattern(g, ZED, '#8a93b8', 108 + p * 16 + i * 8, 92 - p * 36 - i * 5, 2 + i * 0.4, (1 - p) * 0.85);
      }
    }
  }

  function drawTail(g, type, tail, t, ox, oy, dot) {
    const color = type.stripes || darken(type.base);
    // 0 か 1 の 2 値で振ると、ドットの連続が切れない
    const sway = Math.sin(t * 3) > 0 ? 1 : 0;
    if (tail.up) {
      // 歩行時：後ろで立てたしっぽ
      const pts = [[0, 0], [-1, -1], [-1, -2], [-1 - sway, -3], [-1 - sway, -4]];
      for (const [dc, dr] of pts) dot(tail.col + dc, tail.row + dr, color);
    } else {
      // 座り：横から先だけゆらす
      const pts = [[0, 1], [1, 0], [2, -1], [2 + sway, -2], [2 + sway, -3]];
      for (const [dc, dr] of pts) dot(tail.col + dc, tail.row + dr, color);
    }
  }

  function drawPattern(g, pattern, color, x, y, size, alpha) {
    g.save();
    g.globalAlpha = Math.max(0, alpha);
    g.fillStyle = color;
    for (let r = 0; r < pattern.length; r++) {
      for (let c = 0; c < pattern[r].length; c++) {
        if (pattern[r][c] !== '.' ) g.fillRect(x + c * size, y + r * size, size, size);
      }
    }
    g.restore();
  }

  function lighten(hex) {
    const n = parseInt(hex.slice(1), 16);
    const l = (v) => Math.min(255, ((n >> v) & 255) + 36);
    return `rgb(${l(16)},${l(8)},${l(0)})`;
  }

  function darken(hex) {
    const n = parseInt(hex.slice(1), 16);
    const d = (v) => Math.max(0, ((n >> v) & 255) - 30);
    return `rgb(${d(16)},${d(8)},${d(0)})`;
  }

  window.CatSprite = { drawCat, W, H };
})();
