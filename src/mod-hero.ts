// ヒーローのくせに生意気だ ウィジェットモジュール
// （『勇者のくせになまいきだ。』の仕様を調査して反映したダンジョン生態系シム）
//
// 本家準拠の要点:
//  ・プレイヤー＝破壊神。つるはしで岩を掘る（掘削力を消費）だけ。モンスターは命令できず自律する。
//  ・資源は 2 種類で土（セル）に宿る：
//      養分(nutrient) … 総量保存。新規流入はヒーローの死のみ。
//      魔分(magic)    … 初期ゼロ。ヒーローの詠唱・死亡でのみ発生。
//  ・「運搬役（ポンプ）」が資源を吸って別の土へ吐き出し“濃縮”する：
//      ニジリゴケ→養分、エレメント→魔分。濃縮した土から上位種が湧く（定石）。
//  ・2 系統の食物連鎖：
//      養分系  ニジリゴケ → ガジガジムシ → トカゲおとこ
//      魔力系  エレメント → リリス → ドラゴン（多量の魔分の土から最大級が湧く）
//  ・死んだ生物・ヒーローは保有資源を周囲の土へ飛散（保存則）。
//  ・侵入は“少数精鋭”：1 回 1〜3 人の強いヒーロー。数より個の強さが日々上がる。
//  ・負け＝ヒーローが魔王を掴んで入口へ運び出す（運搬中も逃げず戦う＝道中で討てば救出）。

type CKey = 'moss' | 'insect' | 'lizard' | 'element' | 'lilith' | 'dragon';
interface CDef { name: string; chain: 'nut' | 'mag'; tier: number; hp: number; atk: number; color: string; r: number; speed: number; eats: CKey[]; pump?: boolean; fly?: boolean; ranged?: boolean; fire?: boolean; }
interface Creature { type: CKey; x: number; y: number; tr: number; tc: number; hp: number; maxhp: number; atk: number; fed: number; carry: number; stored: number; cd: number; flash: number; fly: boolean; dead?: boolean; }
interface HDef { name: string; hp: number; atk: number; color: string; r: number; speed: number; mp: number; mage?: boolean; }
interface Hero { x: number; y: number; tr: number; tc: number; cls: string; def: HDef; hp: number; maxhp: number; atk: number; speed: number; mp: number; cd: number; castcd: number; flash: number; carrying: boolean; dead?: boolean; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; }
interface FloatTxt { x: number; y: number; life: number; text: string; color: string; }

window.createWidgetHero = function (ctx: WidgetCtx): WidgetModule {
  const TICK_MS = 33;
  const CELL_TARGET = 15;
  const RESTART_TICKS = Math.round(1800 / TICK_MS);
  const BEST_KEY = 'widgetHero.bestWave';

  const wrapEl = document.getElementById('hero') as HTMLElement;
  const canvas = document.getElementById('hero-canvas') as HTMLCanvasElement;
  const g2d = canvas.getContext('2d') as CanvasRenderingContext2D;

  // 生態系（2 系統）。pump=運搬役（資源を吸って濃縮）
  const C: Record<CKey, CDef> = {
    // モンスターは“仲間は攻撃せず”勇者だけを迎撃する（捕食は廃止）。種類は土の濃さで湧く
    moss:    { name: 'ニジリゴケ',   chain: 'nut', tier: 1, hp: 14,  atk: 2,  color: '#7fd05a', r: 0.24, speed: 1.0, eats: [], pump: true },
    insect:  { name: 'ガジガジムシ', chain: 'nut', tier: 2, hp: 26,  atk: 9,  color: '#d8c24a', r: 0.30, speed: 1.6, eats: [] },
    lizard:  { name: 'トカゲおとこ', chain: 'nut', tier: 3, hp: 72,  atk: 20, color: '#5fa86a', r: 0.40, speed: 1.25, eats: [] },
    element: { name: 'エレメント',   chain: 'mag', tier: 1, hp: 16,  atk: 5,  color: '#6fd6ea', r: 0.26, speed: 1.5, eats: [], pump: true, fly: true },
    lilith:  { name: 'リリス',       chain: 'mag', tier: 2, hp: 40,  atk: 16, color: '#c87fe0', r: 0.32, speed: 1.5, eats: [], fly: true, ranged: true },
    dragon:  { name: 'ドラゴン',     chain: 'mag', tier: 3, hp: 190, atk: 30, color: '#e05a7a', r: 0.55, speed: 1.7, eats: [], fly: true, ranged: true, fire: true }, // 火を吹く（範囲）
  };
  // 土の資源濃度で湧く閾値（濃縮するほど上位種）
  const NUT_T = { insect: 9, lizard: 22 };
  const MAG_T = { lilith: 8, dragon: 18 };

  // ヒーロー（本家の中核 3 職＋勇者/大勇者）。少数精鋭で個が強い
  const H: Record<string, HDef> = {
    swordsman: { name: '剣士',   hp: 40,  atk: 9,  color: '#e6d6b0', r: 0.32, speed: 1.8, mp: 0 },
    warrior:   { name: '戦士',   hp: 76,  atk: 14, color: '#c8a06a', r: 0.36, speed: 1.5, mp: 0 },
    mage:      { name: '魔法使い', hp: 46, atk: 18, color: '#9aa6f4', r: 0.32, speed: 1.5, mp: 30, mage: true },
    hero:      { name: '勇者',   hp: 150, atk: 24, color: '#ffd24a', r: 0.40, speed: 1.9, mp: 20 },
    champ:     { name: '大勇者', hp: 380, atk: 40, color: '#ff7a3a', r: 0.54, speed: 1.7, mp: 40 },
  };

  let COLS = 18, ROWS = 28;
  let cellType: Uint8Array = new Uint8Array(0);   // 0=岩(土) 1=通路 2=巣
  let nutrient: Float64Array = new Float64Array(0);
  let magic: Float64Array = new Float64Array(0);
  let distCore: Int32Array = new Int32Array(0);
  let distEntr: Int32Array = new Int32Array(0);
  let path: { r: number; c: number }[] = [];
  let entranceR = 0, entranceC = 0;

  let creatures: Creature[] = [], heroes: Hero[] = [], particles: Particle[] = [], floats: FloatTxt[] = [];
  let beams: { x1: number; y1: number; x2: number; y2: number; life: number; color: string }[] = [];
  let overlord = { r: 0, c: 0, x: 0, y: 0, state: 'nest' as 'nest' | 'carried' | 'dropped', carrier: null as Hero | null, dropT: 0 };
  let digPower = 45, level = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let toSpawn: string[] = [], spawnCd = 0, digCd = 0, ecoCd = 0, waveGap = 0, clock = 0;
  let lastDig = { r: -1, c: -1, t: 0 };
  let state: 'play' | 'gameover' = 'play';
  let restartCountdown = -1;
  let auto = false, timer: any = null;

  const idx = (r: number, c: number) => r * COLS + c;
  const inB = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const ri = (a: number, b: number) => (a + Math.random() * (b - a + 1)) | 0;
  const dl = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
  const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const NB8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  // 養分・魔分は「壁(土)」にのみ存在し、魔物・勇者は「通路」だけを通る
  function wallNbrs(cell: number): number[] { const r = (cell / COLS) | 0, c = cell % COLS, out: number[] = []; for (const [dr, dc] of NB) { const nr = r + dr, nc = c + dc; if (inB(nr, nc) && cellType[idx(nr, nc)] === 0) out.push(idx(nr, nc)); } return out; }
  function floorNbr(cell: number): number { const r = (cell / COLS) | 0, c = cell % COLS; const opts: number[] = []; for (const [dr, dc] of NB) { const nr = r + dr, nc = c + dc; if (inB(nr, nc) && cellType[idx(nr, nc)] !== 0) opts.push(idx(nr, nc)); } return opts.length ? opts[(Math.random() * opts.length) | 0] : -1; }
  function randomWall(): number { for (let i = 0; i < 50; i++) { const k = ri(0, COLS * ROWS - 1); if (cellType[k] === 0) return k; } return -1; }
  function richestWall(res: Float64Array): number { let bi = -1, bv = 0; for (let i = 0; i < res.length; i++) if (cellType[i] === 0 && res[i] > bv) { bv = res[i]; bi = i; } return bi; }

  // ---- ダンジョン生成 ----
  function buildDungeon() {
    cellType = new Uint8Array(COLS * ROWS);
    nutrient = new Float64Array(COLS * ROWS);
    magic = new Float64Array(COLS * ROWS);
    distCore = new Int32Array(COLS * ROWS);
    distEntr = new Int32Array(COLS * ROWS);
    path = [];
    const pset = new Set<number>();
    const carve = (r: number, c: number) => {
      if (!inB(r, c)) return;
      if (cellType[idx(r, c)] === 0) cellType[idx(r, c)] = 1;
      if (!pset.has(idx(r, c))) { pset.add(idx(r, c)); path.push({ r, c }); }
    };
    const rowsList: number[] = [];
    for (let r = 1; r < ROWS - 2; r += 3) rowsList.push(r);
    let right = true;
    for (let i = 0; i < rowsList.length; i++) {
      const r = rowsList[i];
      const from = right ? 1 : COLS - 2, to = right ? COLS - 2 : 1, dir = right ? 1 : -1;
      for (let c = from; right ? c <= to : c >= to; c += dir) carve(r, c);
      if (i < rowsList.length - 1) { const nr = rowsList[i + 1]; for (let rr = r + 1; rr <= nr; rr++) carve(rr, to); }
      right = !right;
    }
    entranceR = path[0].r; entranceC = path[0].c;
    const end = path[path.length - 1];
    overlord.r = Math.min(ROWS - 2, end.r + 1); overlord.c = end.c;
    overlord.x = overlord.c + 0.5; overlord.y = overlord.r + 0.5;
    overlord.state = 'nest'; overlord.carrier = null; overlord.dropT = 0;
    carve(overlord.r, overlord.c); cellType[idx(overlord.r, overlord.c)] = 2;
    for (const [dr, dc] of NB) { const r = overlord.r + dr, c = overlord.c + dc; if (inB(r, c) && cellType[idx(r, c)] === 0) cellType[idx(r, c)] = 1; }

    // 養分の鉱脈（総量はここで固定＝以後は保存・循環）。魔分は初期ゼロ
    const veins = 5 + ((COLS * ROWS) / 220 | 0);
    for (let v = 0; v < veins; v++) {
      const cr = ri(2, ROWS - 3), cc = ri(1, COLS - 2), amt = rnd(22, 50), rad = rnd(1.6, 3.2);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const d = dl(c, r, cc, cr); if (d > rad) continue;
        nutrient[idx(r, c)] += amt * Math.exp(-(d * d) / rad);
      }
    }
    // 養分は壁(土)にのみ宿る：通路に乗った分は隣接する壁へ移す（道に養分は無い）
    for (let i = 0; i < cellType.length; i++) {
      if (cellType[i] !== 0 && nutrient[i] > 0) { const w = wallNbrs(i); if (w.length) { const e = nutrient[i] / w.length; for (const k of w) nutrient[k] += e; } nutrient[i] = 0; }
    }
    recomputeFields();
  }

  function bfsField(field: Int32Array, src: number) {
    field.fill(-1); const q = [src]; field[src] = 0; let h = 0;
    while (h < q.length) {
      const cur = q[h++]; const r = (cur / COLS) | 0, c = cur % COLS;
      for (const [dr, dc] of NB) { const nr = r + dr, nc = c + dc; if (!inB(nr, nc)) continue; const ni = idx(nr, nc); if (cellType[ni] === 0 || field[ni] !== -1) continue; field[ni] = field[cur] + 1; q.push(ni); }
    }
  }
  function recomputeFields() { bfsField(distCore, idx(overlord.r, overlord.c)); bfsField(distEntr, idx(entranceR, entranceC)); }

  function newGame() {
    creatures = []; heroes = []; particles = []; floats = []; beams = []; fires = [];
    digPower = 50; level = 0;
    state = 'play'; restartCountdown = -1; waveGap = 0;
    ctx.hideOverlay();
    buildDungeon();
    for (let i = 0; i < 6; i++) spawnCreature('moss', randomTunnel());
    for (let i = 0; i < 4; i++) spawnCreature('insect', randomTunnel());
    for (let i = 0; i < 4; i++) spawnCreature('lizard', nearNestTunnel());
    nextWave();
    updateScores();
    render();
  }

  // 少数精鋭：1 回 1〜3 人＋節目に勇者/大勇者。個の強さが日々上がる
  function nextWave() {
    level++;
    if (level > best) { best = level; localStorage.setItem(BEST_KEY, String(best)); }
    digPower = Math.min(140, digPower + 16 + level * 2);
    toSpawn = [];
    const party = Math.min(1 + Math.floor((level - 1) / 3), 3);
    for (let i = 0; i < party; i++) {
      const roll = Math.random();
      let t = 'swordsman';
      if (level >= 3 && roll < 0.3) t = 'mage';
      else if (level >= 2 && roll < 0.6) t = 'warrior';
      toSpawn.push(t);
    }
    if (level % 5 === 0) toSpawn.push('hero');
    if (level % 10 === 0) toSpawn.push('champ');
    spawnCd = 0.5; waveGap = 3.6;
    updateScores();
  }

  function updateScores() {
    let drag = 0; for (const c of creatures) if (!c.dead && c.type === 'dragon') drag++;
    const od = overlord.state === 'nest' ? '魔王' : overlord.state === 'carried' ? '⚠拉致' : '落下';
    ctx.setScores(level, best, `${od} ⛏${digPower | 0} 🐉${drag} 👾${creatures.length}`);
  }

  // ---- 生成ヘルパ ----
  function randomTunnel(): number { for (let i = 0; i < 40; i++) { const k = ri(0, COLS * ROWS - 1); if (cellType[k] !== 0) return k; } return idx(overlord.r, overlord.c); }
  function nearNestTunnel(): number { for (let i = 0; i < 40; i++) { const k = ri(0, COLS * ROWS - 1); if (cellType[k] !== 0 && distCore[k] >= 0 && distCore[k] < 7) return k; } return idx(overlord.r, overlord.c); }
  function countType(t: CKey) { let n = 0; for (const c of creatures) if (!c.dead && c.type === t) n++; return n; }
  function typeCap(t: CKey): number {
    const cap = creatureCap();
    if (t === 'moss') return Math.floor(cap * 0.26);
    if (t === 'insect') return Math.floor(cap * 0.34);
    if (t === 'element') return Math.floor(cap * 0.16);
    if (t === 'lilith') return Math.min(8, 2 + Math.floor(level / 4));
    if (t === 'dragon') return Math.min(6, 1 + Math.floor(level / 5)); // 希少な頂点捕食者
    return cap;                                                        // トカゲ＝主力（残り枠）
  }
  function creatureCap() { return Math.min(76, 34 + level * 2.2) | 0; }
  function spawnCreature(type: CKey, cell: number, cost = 0) {
    if (creatures.length >= creatureCap() || countType(type) >= typeCap(type)) return;
    const r = (cell / COLS) | 0, c = cell % COLS, def = C[type], hpScale = 1 + level * 0.05;
    // cost = 土から消費して湧いた資源量。死亡時にそのまま壁へ還す（保存則）
    creatures.push({ type, x: c + 0.5, y: r + 0.5, tr: r, tc: c, hp: def.hp * hpScale, maxhp: def.hp * hpScale, atk: def.atk, fed: 0, carry: 0, stored: cost, cd: 0, flash: 0, fly: !!def.fly });
  }
  function spawnHero(cls: string) {
    const def = H[cls], hpScale = 1 + level * 0.34, atkScale = 1 + level * 0.19;
    heroes.push({ x: entranceC + 0.5, y: entranceR + 0.5, tr: entranceR, tc: entranceC, cls, def, hp: def.hp * hpScale, maxhp: def.hp * hpScale, atk: def.atk * atkScale, speed: def.speed, mp: def.mp, cd: 0, castcd: rnd(1, 3), flash: 0, carrying: false });
  }

  function burst(x: number, y: number, color: string, n = 7) { for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), s = rnd(1.5, 4.5); particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.6), color }); } }
  function floatText(x: number, y: number, text: string, color: string) { floats.push({ x, y, life: 0.95, text, color }); }

  // 保存則：死亡時、保有資源を周囲の「壁(土)」へ飛散（道には残らない）
  function scatter(cell: number, res: Float64Array, amt: number) {
    if (amt <= 0) return;
    const r = (cell / COLS) | 0, c = cell % COLS;
    const tgts: number[] = [];
    for (const [dr, dc] of NB8) { const nr = r + dr, nc = c + dc; if (inB(nr, nc) && cellType[idx(nr, nc)] === 0) tgts.push(idx(nr, nc)); }
    if (tgts.length === 0) return;          // 壁が無ければ霧散（簡略）
    const each = amt / tgts.length;
    for (const t of tgts) res[t] = Math.min(48, res[t] + each);   // 1 マスに溜め込みすぎない
  }

  // ---- 破壊神 AI：鉱脈は掘らず“その隣”を掘って露出させる（養分を保ったまま湧かせる定石）----
  function aiDig() {
    if (digPower < 1) return;
    if (path.length > COLS * ROWS * 0.46) return;   // 掘りすぎない（土＝養分の貯蔵を残す）
    const frontier: number[] = [];
    for (const p of path) for (const [dr, dc] of NB) { const r = p.r + dr, c = p.c + dc; if (inB(r, c) && cellType[idx(r, c)] === 0) frontier.push(idx(r, c)); }
    if (frontier.length === 0) return;
    // 「養分の薄い土」かつ「隣に濃い鉱脈がある」マスを優先 → 鉱脈を温存しつつ通路へ露出
    let cell = frontier[(Math.random() * frontier.length) | 0], bs = -Infinity;
    for (let i = 0; i < 20; i++) {
      const f = frontier[(Math.random() * frontier.length) | 0];
      let mx = 0; for (const wn of wallNbrs(f)) if (nutrient[wn] > mx) mx = nutrient[wn];
      const score = mx - nutrient[f] * 2 + Math.random() * 2;
      if (score > bs) { bs = score; cell = f; }
    }
    // 掘る壁の(僅かな)資源は隣接する壁へ逃がす（道に養分は残さない）
    if (nutrient[cell] > 0) { scatter(cell, nutrient, nutrient[cell]); nutrient[cell] = 0; }
    if (magic[cell] > 0) { scatter(cell, magic, magic[cell]); magic[cell] = 0; }
    cellType[cell] = 1; path.push({ r: (cell / COLS) | 0, c: cell % COLS });
    digPower -= 1;
    const r = (cell / COLS) | 0, c = cell % COLS;
    lastDig = { r, c, t: clock };
    burst(c + 0.5, r + 0.5, '#caa86a', 4);
    recomputeFields();
  }
  // 運搬役（ポンプ）と防衛線を維持
  function aiManage() {
    if (countType('moss') < 3 && digPower >= 2) { digPower -= 2; spawnCreature('moss', randomTunnel()); }
    // 魔分が溜まっていてエレメントが居なければ湧かせる（魔力系の起点）
    let totalMag = 0; for (let i = 0; i < magic.length; i++) totalMag += magic[i];
    if (totalMag > 4 && countType('element') < 3 && digPower >= 2) { const w = richestWall(magic); const t = w >= 0 ? floorNbr(w) : randomTunnel(); if (t >= 0) { digPower -= 2; spawnCreature('element', t); } }
    // 脅威に応じて迎撃役（トカゲ）を道沿いに補充
    let fighters = 0; for (const c of creatures) if (!c.dead && c.type !== 'moss' && c.type !== 'element') fighters++;
    const target = Math.min(creatureCap() - 4, 8 + level * 2);
    if (fighters < target && digPower >= 4) { digPower -= 4; const p = path[(Math.random() * path.length) | 0]; spawnCreature(level >= 4 && Math.random() < 0.5 ? 'lizard' : 'insect', idx(p.r, p.c)); }
  }

  // 濃縮した「壁(土)」から、面した通路へ上位種が湧く（定石の自動化）
  function densitySpawn() {
    // 魔分は揮発性：余剰はゆっくり散逸（溜め込み暴走を防ぐ。養分は保存）
    for (let i = 0; i < magic.length; i++) if (cellType[i] === 0 && magic[i] > 0) magic[i] *= 0.996;
    upTier(richestWall(nutrient), nutrient, 'lizard', 'insect', NUT_T.lizard, NUT_T.insect);
    upTier(richestWall(magic), magic, 'dragon', 'lilith', MAG_T.dragon, MAG_T.lilith);
    for (let k = 0; k < 8; k++) { const w = randomWall(); upTier(w, nutrient, 'lizard', 'insect', NUT_T.lizard, NUT_T.insect); upTier(w, magic, 'dragon', 'lilith', MAG_T.dragon, MAG_T.lilith); }
  }
  function upTier(wcell: number, res: Float64Array, hi: CKey, lo: CKey, hiT: number, loT: number) {
    if (wcell < 0 || cellType[wcell] !== 0) return;
    const t = floorNbr(wcell); if (t < 0) return;          // 通路に面した壁からのみ湧く
    if (res[wcell] >= hiT && countType(hi) < typeCap(hi)) { spawnCreature(hi, t, hiT); res[wcell] -= hiT; if (hi === 'dragon') floatText((t % COLS) + 0.5, ((t / COLS) | 0) + 0.5, 'ドラゴン誕生!', '#e05a7a'); }
    else if (res[wcell] >= loT && countType(lo) < typeCap(lo)) { const cost = loT * 0.6; spawnCreature(lo, t, cost); res[wcell] -= cost; }
  }

  // ---- 移動 ----
  function stepToward(e: { x: number; y: number }, tr: number, tc: number, dt: number, speed: number): boolean {
    const tx = tc + 0.5, ty = tr + 0.5, dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy), step = speed * dt;
    if (d <= step) { e.x = tx; e.y = ty; return true; }
    e.x += dx / d * step; e.y += dy / d * step; return false;
  }
  function curCell(e: { x: number; y: number }) { return { r: Math.max(0, Math.min(ROWS - 1, Math.floor(e.y))), c: Math.max(0, Math.min(COLS - 1, Math.floor(e.x))) }; }
  function atCenter(e: { x: number; y: number }, tr: number, tc: number) { return Math.abs(e.x - (tc + 0.5)) < 0.06 && Math.abs(e.y - (tr + 0.5)) < 0.06; }
  const passable = (_cr: Creature, r: number, c: number) => inB(r, c) && cellType[idx(r, c)] !== 0; // 魔物も勇者も通路のみ
  function gradientNext(e: { x: number; y: number }, field: Int32Array) {
    const { r, c } = curCell(e);
    let bv = field[idx(r, c)] < 0 ? Infinity : field[idx(r, c)], br = r, bc = c;
    for (const [dr, dc] of NB) { const nr = r + dr, nc = c + dc; if (!inB(nr, nc) || cellType[idx(nr, nc)] === 0) continue; const dd = field[idx(nr, nc)]; if (dd >= 0 && dd < bv) { bv = dd; br = nr; bc = nc; } }
    return { r: br, c: bc };
  }

  // ---- 進行 ----
  function tick() {
    const dt = TICK_MS / 1000 * (auto ? 1.7 : 1);
    clock += dt;
    digPower = Math.min(140, digPower + (auto ? 6 : 4) * dt);

    if (state === 'gameover') { if (auto && restartCountdown >= 0 && --restartCountdown <= 0) newGame(); decayFx(dt); render(); return; }

    if (toSpawn.length > 0) { spawnCd -= dt; if (spawnCd <= 0) { spawnHero(toSpawn.shift() as string); spawnCd = Math.max(0.4, 0.9 - level * 0.01); } }
    else if (heroes.length === 0) { waveGap -= dt; if (waveGap <= 0) nextWave(); }

    updateHeroes(dt);
    updateCreatures(dt);
    creatures = creatures.filter((c) => !c.dead);
    heroes = heroes.filter((h) => !h.dead);

    if (overlord.state === 'dropped') { overlord.dropT -= dt; if (overlord.dropT <= 0) { overlord.state = 'nest'; overlord.x = overlord.c + 0.5; overlord.y = overlord.r + 0.5; burst(overlord.x, overlord.y, '#c050ff', 12); } }

    digCd -= dt;
    if (digCd <= 0) {
      digCd = 0.3;
      // 掘るかどうかのジレンマ：侵入中に掘ると道が増え勇者の探索・範囲攻撃が有利になる。
      // 平時（ウェーブ間）にだけ掘って配下を育て、勇者が来たら掘らずに待つ（つるはしを休める）。
      if (heroes.length === 0 && toSpawn.length === 0) aiDig();
      aiManage();   // 運搬役の維持・戦力補充は常時
    }
    ecoCd -= dt;
    if (ecoCd <= 0) { ecoCd = 0.4; densitySpawn(); }

    decayFx(dt); updateScores(); render();
  }

  function updateHeroes(dt: number) {
    for (const h of heroes) {
      if (h.dead) continue;
      h.flash = Math.max(0, h.flash - dt);
      const cc = curCell(h);
      if (!h.carrying && overlord.state === 'nest' && cc.r === overlord.r && cc.c === overlord.c) { h.carrying = true; overlord.state = 'carried'; overlord.carrier = h; floatText(h.x, h.y, '魔王を捕獲!', '#ff5050'); if (window.SFX) window.SFX.item && window.SFX.item(); }
      if (h.carrying) { overlord.x = h.x; overlord.y = h.y - 0.2; }
      if (h.carrying && cc.r === entranceR && cc.c === entranceC) { gameOver(); return; }
      // 魔法使い等は詠唱して魔分を撒く（運搬中も逃げず戦う＝近接交戦は継続）
      if (h.def.mage && h.mp > 0) { h.castcd -= dt; if (h.castcd <= 0) { h.castcd = rnd(1.6, 2.8); const spend = Math.min(h.mp, 6); h.mp -= spend; const mw = wallNbrs(idx(cc.r, cc.c)); if (mw.length) magic[mw[(Math.random() * mw.length) | 0]] = Math.min(48, magic[mw[(Math.random() * mw.length) | 0]] + spend); floatText(h.x, h.y, '魔法', '#9aa6f4'); // 周囲のモンスターへダメージ
        for (const cr of creatures) if (!cr.dead && dl(h.x, h.y, cr.x, cr.y) < 2.4) damageCreature(cr, h.atk * 0.8); } }
      // 隣接モンスターと交戦
      let foe: Creature | null = null, fd = 0.95;
      for (const cr of creatures) { if (cr.dead || cr.type === 'moss') continue; const d = dl(h.x, h.y, cr.x, cr.y); if (d < fd) { fd = d; foe = cr; } }
      if (foe) { h.cd -= dt; if (h.cd <= 0) { h.cd = 0.45; damageCreature(foe, h.atk); h.flash = 0.15; } }
      else { const field = h.carrying ? distEntr : distCore; if (atCenter(h, h.tr, h.tc)) { const nx = gradientNext(h, field); h.tr = nx.r; h.tc = nx.c; } stepToward(h, h.tr, h.tc, dt, h.carrying ? h.speed * 0.5 : h.speed); }
    }
  }

  function updateCreatures(dt: number) {
    for (const cr of creatures) {
      if (cr.dead) continue;
      cr.flash = Math.max(0, cr.flash - dt);
      const cc = curCell(cr), ci = idx(cc.r, cc.c), def = C[cr.type];

      if (def.pump) {
        // 運搬役：隣接する「壁(土)」の薄い方から資源を吸い、運んでいる分を濃い壁へ吐き出す＝濃縮
        const res = cr.type === 'moss' ? nutrient : magic;
        const walls = wallNbrs(ci);
        if (walls.length) {
          let hi = walls[0], lo = walls[0];
          for (const w of walls) { if (res[w] > res[hi]) hi = w; if (res[w] < res[lo]) lo = w; }
          if (cr.carry > 0) { const d = Math.min(cr.carry, 6 * dt + 0.04); res[hi] = Math.min(48, res[hi] + d); cr.carry -= d; }
          const a = Math.min(res[lo], 5 * dt); res[lo] -= a; cr.carry += a;
        }
        pumpMove(cr, dt);
      } else {
        combatMove(cr, dt, def);   // 戦闘員：勇者だけを迎撃（仲間は襲わない）
      }
    }
  }

  // 運搬役の移動：通路を徘徊して各所の壁を巡り、資源を運んで回る
  function pumpMove(cr: Creature, dt: number) {
    const cc = curCell(cr);
    if (atCenter(cr, cr.tr, cr.tc)) {
      const opts = NB.map(([dr, dc]) => [cc.r + dr, cc.c + dc]).filter(([r, c]) => passable(cr, r, c));
      if (opts.length) { const o = opts[(Math.random() * opts.length) | 0]; cr.tr = o[0]; cr.tc = o[1]; }
    }
    stepToward(cr, cr.tr, cr.tc, dt, C[cr.type].speed);
  }

  // 戦闘員の移動：近くのヒーローだけを狙って迎撃。ドラゴンは火を吹く（範囲）
  function combatMove(cr: Creature, dt: number, def: CDef) {
    const range = def.fire ? 3.4 : def.ranged ? 2.6 : 0.95;
    let target: Hero | null = null, td = range;
    for (const h of heroes) { if (h.dead) continue; const d = dl(cr.x, cr.y, h.x, h.y); if (d < td) { td = d; target = h; } }
    if (target) {
      cr.cd -= dt;
      if (cr.cd <= 0) { cr.cd = def.fire ? 1.1 : def.ranged ? 0.7 : 0.5; cr.flash = 0.15; if (def.fire) fireBreath(cr, target); else { damageHero(target, cr.atk); if (def.ranged) beam(cr, target); } }
      if (def.ranged || def.fire) return;   // 遠距離・火噴きは近づかずその場で撃つ
    }
    let tx = -1, ty = -1;
    { let best = 3.6, h: Hero | null = null; for (const hh of heroes) { if (hh.dead) continue; const d = dl(cr.x, cr.y, hh.x, hh.y); if (d < best) { best = d; h = hh; } } if (h) { tx = h.x; ty = h.y; } }
    const cc = curCell(cr);
    if (atCenter(cr, cr.tr, cr.tc)) {
      let br = cc.r, bc = cc.c, bv = Infinity;
      for (const [dr, dc] of NB) { const nr = cc.r + dr, nc = cc.c + dc; if (!passable(cr, nr, nc)) continue; const v = tx >= 0 ? dl(nc + 0.5, nr + 0.5, tx, ty) : Math.random() * 2; if (v < bv) { bv = v; br = nr; bc = nc; } }
      cr.tr = br; cr.tc = bc;
    }
    stepToward(cr, cr.tr, cr.tc, dt, def.speed);
  }

  function damageCreature(cr: Creature, dmg: number) {
    cr.hp -= dmg; cr.flash = 0.18;
    if (cr.hp <= 0 && !cr.dead) { cr.dead = true; const cc = curCell(cr); scatter(idx(cc.r, cc.c), C[cr.type].chain === 'mag' ? magic : nutrient, cr.stored + cr.carry); burst(cr.x, cr.y, C[cr.type].color, 8); if (window.SFX) window.SFX.pop && window.SFX.pop(); }
  }
  function damageHero(h: Hero, dmg: number) {
    h.hp -= dmg; h.flash = 0.18;
    if (h.hp <= 0 && !h.dead) {
      h.dead = true; const cc = curCell(h), dcell = idx(cc.r, cc.c);
      // しかばね：養分は周囲の壁へ飛散、魔分（残 MP の半分・最大30＋基本値）は隣接する一番濃い壁に集中
      // （壁に染み込み、エレメントが運び濃縮 → 魔力系の食物連鎖が育つ。本家の「しかばねの魔分」）
      scatter(dcell, nutrient, 10 + level * 0.6);
      const dw = wallNbrs(dcell);
      if (dw.length) { let hi = dw[0]; for (const w of dw) if (magic[w] > magic[hi]) hi = w; magic[hi] = Math.min(48, magic[hi] + Math.min(30, h.mp * 0.5) + 7); }
      burst(h.x, h.y, h.def.color, 12); floatText(h.x, h.y, '撃退!', '#ffd24a');
      if (window.SFX) window.SFX.explode && window.SFX.explode();
      if (h.carrying) { overlord.state = 'dropped'; overlord.dropT = 2.0; overlord.carrier = null; floatText(h.x, h.y, '魔王 奪還', '#c050ff'); }
      updateScores();
    }
  }

  function beam(cr: Creature, h: Hero) { beams.push({ x1: cr.x, y1: cr.y, x2: h.x, y2: h.y, life: 0.12, color: C[cr.type].color }); }

  // ドラゴンの火炎：対象を中心に範囲ダメージ＋炎の演出
  function fireBreath(cr: Creature, target: Hero) {
    const ang = Math.atan2(target.y - cr.y, target.x - cr.x);
    for (const h of heroes) { if (h.dead) continue; const d = dl(target.x, target.y, h.x, h.y); if (d < 1.7) { damageHero(h, cr.atk * (h === target ? 1 : 0.6)); h.flash = 0.2; } }
    fires.push({ x: cr.x, y: cr.y, ang, life: 0.3 });
    for (let i = 0; i < 10; i++) { const a = ang + rnd(-0.4, 0.4), s = rnd(3, 7); particles.push({ x: cr.x + Math.cos(ang) * 0.5, y: cr.y + Math.sin(ang) * 0.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.2, 0.5), color: i % 2 ? '#ff9a30' : '#ffd24a' }); }
    if (window.SFX) window.SFX.explode && window.SFX.explode();
  }
  let fires: { x: number; y: number; ang: number; life: number }[] = [];

  function decayFx(dt: number) {
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; } particles = particles.filter((p) => p.life > 0);
    for (const f of floats) { f.y -= dt * 1.2; f.life -= dt; } floats = floats.filter((f) => f.life > 0);
    for (const b of beams) b.life -= dt; beams = beams.filter((b) => b.life > 0);
    for (const fr of fires) fr.life -= dt; fires = fires.filter((fr) => fr.life > 0);
  }

  function gameOver() { state = 'gameover'; restartCountdown = RESTART_TICKS; if (window.SFX) window.SFX.die && window.SFX.die(); ctx.showOverlay('魔王 連れ去られ…', auto ? `Wave ${level} ・自動リスタート…` : `Wave ${level} ・キーで再開`); }

  // ---- 描画 ----
  let scale = 16, offX = 0, offY = 0;
  const TAU = Math.PI * 2;
  function applyGridSize() {
    const rect = wrapEl.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) return;
    const cols = Math.max(14, Math.min(26, Math.round(rect.width / CELL_TARGET)));
    const rows = Math.max(20, Math.min(40, Math.round(rect.height / CELL_TARGET)));
    if (cols !== COLS || rows !== ROWS || cellType.length === 0) { COLS = cols; ROWS = rows; newGame(); }
  }
  function relayout() {
    const rect = wrapEl.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) return;
    applyGridSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    scale = Math.min(canvas.width / COLS, canvas.height / ROWS);
    offX = (canvas.width - COLS * scale) / 2; offY = (canvas.height - ROWS * scale) / 2;
    render();
  }
  const sx = (c: number) => offX + c * scale, sy = (r: number) => offY + r * scale;

  function render() {
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    const bg = g2d.createLinearGradient(0, offY, 0, offY + ROWS * scale);
    bg.addColorStop(0, '#2a2030'); bg.addColorStop(1, '#140e1a');
    g2d.fillStyle = bg; g2d.fillRect(offX, offY, COLS * scale, ROWS * scale);

    // 掘った通路の床（暗い）を一面に敷く
    g2d.fillStyle = '#181018'; g2d.fillRect(offX, offY, COLS * scale, ROWS * scale);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = cellType[idx(r, c)], x = sx(c), y = sy(r);
      if (t === 0) {
        // 壁＝土ブロック（養分=緑／魔分=紫の染み）。資源は壁にのみ宿る
        const nut = nutrient[idx(r, c)], mag = magic[idx(r, c)];
        const sh = ((r * 73 + c * 19) % 6) - 2;
        let rr = 70 + sh, gg = 56 + sh, bb = 46 + sh;
        if (nut > 1) { const a = Math.min(0.85, nut / 26); rr = rr * (1 - a) + 110 * a; gg = gg * (1 - a) + 196 * a; bb = bb * (1 - a) + 90 * a; }
        if (mag > 0.5) { const a = Math.min(0.85, mag / 22); rr = rr * (1 - a) + 176 * a; gg = gg * (1 - a) + 111 * a; bb = bb * (1 - a) + 224 * a; }
        g2d.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
        g2d.fillRect(x + 0.5, y + 0.5, scale - 1, scale - 1);              // ブロック間に溝（グラウト）
        g2d.fillStyle = 'rgba(255,255,255,0.10)'; g2d.fillRect(x + 0.5, y + 0.5, scale - 1, scale * 0.18); // 上面ハイライト
        g2d.fillStyle = 'rgba(0,0,0,0.22)'; g2d.fillRect(x + 0.5, y + scale * 0.78, scale - 1, scale * 0.2); // 下影
      } else if (t === 2) {
        g2d.fillStyle = '#241430'; g2d.fillRect(x, y, scale + 0.5, scale + 0.5);
      }
    }
    g2d.fillStyle = '#f0d060'; g2d.fillRect(sx(entranceC) + scale * 0.2, sy(entranceR) + scale * 0.02, scale * 0.6, scale * 0.22);

    if (overlord.state !== 'carried') drawOverlord(overlord.x, overlord.y);
    for (const b of beams) { g2d.save(); g2d.shadowColor = b.color; g2d.shadowBlur = scale; g2d.strokeStyle = b.color; g2d.lineWidth = scale * 0.12; g2d.globalAlpha = Math.min(1, b.life * 9); g2d.beginPath(); g2d.moveTo(sx(b.x1), sy(b.y1)); g2d.lineTo(sx(b.x2), sy(b.y2)); g2d.stroke(); g2d.restore(); }
    // ドラゴンの火炎
    for (const fr of fires) { const a = Math.max(0, fr.life / 0.3), len = scale * 2.6 * (1.2 - a * 0.4); g2d.save(); g2d.globalAlpha = a; g2d.shadowColor = '#ff7a2a'; g2d.shadowBlur = scale; g2d.translate(sx(fr.x), sy(fr.y)); g2d.rotate(fr.ang); g2d.fillStyle = '#ffd24a'; g2d.beginPath(); g2d.moveTo(0, 0); g2d.lineTo(len, -scale * 0.8); g2d.lineTo(len, scale * 0.8); g2d.closePath(); g2d.fill(); g2d.fillStyle = '#ff7a2a'; g2d.beginPath(); g2d.moveTo(0, 0); g2d.lineTo(len * 0.66, -scale * 0.42); g2d.lineTo(len * 0.66, scale * 0.42); g2d.closePath(); g2d.fill(); g2d.restore(); }
    g2d.globalAlpha = 1;
    for (const cr of creatures) drawCreature(cr);
    for (const h of heroes) drawHero(h);
    if (overlord.state === 'carried') drawOverlord(overlord.x, overlord.y);
    if (clock - lastDig.t < 0.35 && lastDig.r >= 0) drawPick(lastDig.c + 0.5, lastDig.r + 0.5);

    for (const p of particles) { g2d.globalAlpha = Math.max(0, p.life * 2.2); g2d.fillStyle = p.color; g2d.fillRect(sx(p.x) - scale * 0.1, sy(p.y) - scale * 0.1, scale * 0.2, scale * 0.2); }
    g2d.globalAlpha = 1; g2d.textAlign = 'center'; g2d.font = `bold ${Math.max(8, scale * 0.55)}px sans-serif`;
    for (const f of floats) { g2d.globalAlpha = Math.max(0, f.life); g2d.fillStyle = f.color; g2d.fillText(f.text, sx(f.x), sy(f.y)); }
    g2d.globalAlpha = 1;
  }

  function drawOverlord(ox: number, oy: number) {
    const cx = sx(ox), cy = sy(oy), rad = scale * 0.42 * (1 + Math.sin(clock * 4) * 0.06);
    g2d.save(); g2d.shadowColor = '#c050ff'; g2d.shadowBlur = scale;
    const grd = g2d.createRadialGradient(cx, cy, scale * 0.08, cx, cy, rad);
    grd.addColorStop(0, '#ffd6ff'); grd.addColorStop(0.55, '#c050ff'); grd.addColorStop(1, '#5a18a0');
    g2d.fillStyle = grd; g2d.beginPath(); g2d.arc(cx, cy, rad, 0, TAU); g2d.fill(); g2d.restore();
    g2d.fillStyle = '#ffd24a'; g2d.beginPath(); g2d.moveTo(cx - rad * 0.7, cy - rad * 0.5); g2d.lineTo(cx - rad * 0.7, cy - rad); g2d.lineTo(cx - rad * 0.3, cy - rad * 0.6); g2d.lineTo(cx, cy - rad * 1.05); g2d.lineTo(cx + rad * 0.3, cy - rad * 0.6); g2d.lineTo(cx + rad * 0.7, cy - rad); g2d.lineTo(cx + rad * 0.7, cy - rad * 0.5); g2d.closePath(); g2d.fill();
    g2d.fillStyle = '#2a0f2a'; g2d.fillRect(cx - rad * 0.4, cy - rad * 0.1, rad * 0.3, rad * 0.34); g2d.fillRect(cx + rad * 0.12, cy - rad * 0.1, rad * 0.3, rad * 0.34);
  }

  // ドット絵スプライト（'.'=透明 o=輪郭 b=体色 d=陰 e=目 h=光 s=剣 g=盾 w=翼）
  const SPR: Record<CKey, string[]> = {
    moss: ['..ooo..', '.obbbo.', 'obbbbbo', 'obebebo', 'obbbbbo', '.odddo.', '..ooo..'],
    insect: ['o.....o', '.o...o.', '.obbbo.', 'obebebo', 'obbbbbo', '.odbdo.', 'o.o.o.o'],
    lizard: ['b.b...s', 'obbbo.s', 'obebbos', 'gbbbbbo', 'gobbbdo', '.obbbo.', '..o.o..'],
    element: ['...o...', '..obo..', '.obhbo.', 'obbhbbo', '.obbbo.', '..obo..', '...o...'],
    lilith: ['b.....b', 'woo.oow', 'wobebow', 'wobbbow', '.obbbo.', '..ooo..', '...o...'],
    dragon: ['b.......b', '.oo...oo.', 'wobbbbbow', 'wobebbbow', 'wobbbbbow', '.oobbboo.', '...ooo...'],
  };
  function darken(hex: string, f: number) { const n = parseInt(hex.slice(1), 16); return `rgb(${((n >> 16 & 255) * f) | 0},${((n >> 8 & 255) * f) | 0},${((n & 255) * f) | 0})`; }
  const DARK: Record<string, string> = {}; for (const k of Object.keys(C)) DARK[k] = darken(C[k as CKey].color, 0.58);
  function drawSprite(spr: string[], cx: number, cy: number, px: number, body: string, dark: string) {
    const w = spr[0].length, h = spr.length, ox = cx - w * px / 2, oy = cy - h * px / 2;
    for (let r = 0; r < h; r++) { const row = spr[r]; for (let c = 0; c < w; c++) { const ch = row[c]; if (ch === '.') continue;
      let col: string;
      switch (ch) { case 'o': col = '#160c16'; break; case 'b': case 'w': col = body; break; case 'd': col = dark; break; case 'e': col = '#ffffff'; break; case 'h': col = 'rgba(255,255,255,0.75)'; break; case 's': col = '#cfd6dd'; break; case 'g': col = '#9a6a3a'; break; default: col = body; }
      g2d.fillStyle = col; g2d.fillRect(ox + c * px, oy + r * px, px + 0.6, px + 0.6);
    } }
  }
  function drawCreature(cr: Creature) {
    const x = sx(cr.x), y = sy(cr.y), def = C[cr.type], spr = SPR[cr.type];
    const px = scale * (cr.type === 'dragon' ? 0.16 : 0.145);
    g2d.save();
    if (def.chain === 'mag' || cr.type === 'lizard') { g2d.shadowColor = def.color; g2d.shadowBlur = scale * 0.45; }
    drawSprite(spr, x, y, px, def.color, DARK[cr.type]);
    g2d.restore();
    if (cr.flash > 0) { g2d.save(); g2d.globalAlpha = 0.5 * (0.5 + 0.5 * Math.sin(clock * 40)); const w = spr[0].length * px, h = spr.length * px; g2d.fillStyle = '#fff'; g2d.fillRect(x - w / 2, y - h / 2, w, h); g2d.restore(); }
    if (cr.hp < cr.maxhp) hpBar(x, y - spr.length * px / 2 - scale * 0.16, cr.hp / cr.maxhp);
  }

  function drawHero(h: Hero) {
    const x = sx(h.x), y = sy(h.y), def = h.def, r = scale * def.r;
    g2d.save();
    if (h.flash > 0) { g2d.shadowColor = '#fff'; g2d.shadowBlur = scale * 0.5; }
    g2d.fillStyle = def.color; roundRect(x - r * 0.7, y - r * 0.4, r * 1.4, r * 1.3, r * 0.3); g2d.fill();
    g2d.fillStyle = '#f2d2a8'; g2d.beginPath(); g2d.arc(x, y - r * 0.6, r * 0.5, 0, TAU); g2d.fill();
    if (h.cls === 'hero' || h.cls === 'champ') { g2d.shadowColor = '#fff6a0'; g2d.shadowBlur = scale * 0.5; }
    if (def.mage) { g2d.strokeStyle = '#bcd0ff'; g2d.lineWidth = scale * 0.1; g2d.beginPath(); g2d.moveTo(x + r * 0.6, y + r * 0.7); g2d.lineTo(x + r * 0.6, y - r * 1.0); g2d.stroke(); g2d.fillStyle = '#bcd0ff'; g2d.beginPath(); g2d.arc(x + r * 0.6, y - r * 1.0, r * 0.22, 0, TAU); g2d.fill(); }
    else { g2d.strokeStyle = '#dfe6ee'; g2d.lineWidth = scale * 0.12; g2d.lineCap = 'round'; g2d.beginPath(); g2d.moveTo(x + r * 0.7, y + r * 0.6); g2d.lineTo(x + r * 1.1, y - r * 0.8); g2d.stroke(); }
    g2d.restore();
    if (h.hp < h.maxhp) hpBar(x, y - r - scale * 0.3, h.hp / h.maxhp);
  }

  function drawPick(ox: number, oy: number) {
    const x = sx(ox), y = sy(oy);
    g2d.save(); g2d.strokeStyle = '#e8e2d6'; g2d.lineWidth = scale * 0.12; g2d.lineCap = 'round';
    g2d.beginPath(); g2d.moveTo(x - scale * 0.3, y + scale * 0.3); g2d.lineTo(x + scale * 0.25, y - scale * 0.25); g2d.stroke();
    g2d.strokeStyle = '#bfc6cf'; g2d.beginPath(); g2d.moveTo(x + scale * 0.05, y - scale * 0.35); g2d.lineTo(x + scale * 0.45, y - scale * 0.15); g2d.stroke();
    g2d.restore();
  }

  function hpBar(x: number, y: number, f: number) {
    const w = scale * 0.8;
    g2d.fillStyle = 'rgba(0,0,0,0.5)'; g2d.fillRect(x - w / 2, y, w, scale * 0.12);
    g2d.fillStyle = f > 0.5 ? '#5fe07a' : f > 0.25 ? '#f0c040' : '#e85a5a'; g2d.fillRect(x - w / 2, y, w * Math.max(0, f), scale * 0.12);
  }
  function roundRect(x: number, y: number, w: number, h: number, r: number) { g2d.beginPath(); g2d.moveTo(x + r, y); g2d.arcTo(x + w, y, x + w, y + h, r); g2d.arcTo(x + w, y + h, x, y + h, r); g2d.arcTo(x, y + h, x, y, r); g2d.arcTo(x, y, x + w, y, r); g2d.closePath(); }

  return {
    name: 'hero',
    show() { wrapEl.style.display = 'flex'; relayout(); updateScores(); if (timer === null) timer = setInterval(tick, TICK_MS); },
    hide() { clearInterval(timer); timer = null; wrapEl.style.display = 'none'; },
    setAuto(on: boolean) { auto = on; },
    key() { if (state === 'gameover') { newGame(); return true; } return false; },
    relayout, reset: newGame, isOver: () => state === 'gameover',
    _tick: tick,
    _state: () => {
      const sp: Record<string, number> = {}; for (const cr of creatures) sp[cr.type] = (sp[cr.type] || 0) + 1;
      let tn = 0, tm = 0; for (let i = 0; i < nutrient.length; i++) { tn += nutrient[i]; tm += magic[i]; }
      return { state, level, digPower: digPower | 0, nutrient: tn | 0, magic: tm | 0, creatures: creatures.length, heroes: heroes.length, species: sp, overlord: overlord.state, best, cols: COLS, rows: ROWS };
    },
  };
};
