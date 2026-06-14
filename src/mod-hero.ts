// ヒーローのくせに生意気だ ウィジェットモジュール
// （『勇者のくせになまいきだ。』風：破壊神となりダンジョンを発掘し、自律する生態系で
//   侵入ヒーローから魔王を守る AI 自動運転ゲーム）
//
// 仕様（本家準拠）:
//  ・プレイヤー＝破壊神。つるはし（カーソル）で岩を掘るだけ。モンスターは命令できず自律行動。
//  ・掘ると「掘削力」を消費。掘った養分の濃い土からモンスターが湧く。養分は総量保存（循環）。
//  ・2 系統の食物連鎖：
//      養分系  ニジリゴケ(苔) → ガジガジムシ(虫) → トカゲおとこ  （捕食・繁殖・餓死）
//      魔力系  エレメント → リリス → ドラゴン        （魔しずくで湧き、捕食で成長）
//  ・「魔しずく(マナ)」はヒーローの死・詠唱でのみ発生し、魔力系を育てる。
//  ・ヒーローは入口から侵入し通路を辿って魔王へ。魔王を掴んで“入口へ運び出す”と GAME OVER。
//    魔王は戦わず祈るだけ・自分では動かない。運搬中のヒーローを倒せば魔王は巣へ戻る。
//  ・ウェーブを重ねるほどヒーローが増え・強く・職業多彩に。負けたら自動リスタート。

type CKey = 'moss' | 'insect' | 'lizard' | 'element' | 'lilith' | 'dragon';
interface CDef { name: string; chain: 'nut' | 'mag'; hp: number; atk: number; color: string; r: number; speed: number; eats: CKey[]; eatsNutrient?: boolean; breed: number; matureTo?: CKey; mature?: number; fly?: boolean; ranged?: boolean; }
interface Creature { type: CKey; x: number; y: number; tr: number; tc: number; hp: number; maxhp: number; atk: number; fed: number; hunger: number; cd: number; flash: number; fly: boolean; dead?: boolean; }
interface HDef { name: string; hp: number; atk: number; color: string; r: number; speed: number; mana: number; mage?: boolean; }
interface Hero { x: number; y: number; tr: number; tc: number; cls: string; def: HDef; hp: number; maxhp: number; atk: number; speed: number; cd: number; flash: number; carrying: boolean; dead?: boolean; }
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

  // 生態系（2 系統の食物連鎖）
  const C: Record<CKey, CDef> = {
    moss:    { name: 'ニジリゴケ',   chain: 'nut', hp: 10,  atk: 2,  color: '#7fd05a', r: 0.24, speed: 0.8, eats: [], eatsNutrient: true, breed: 12 },
    insect:  { name: 'ガジガジムシ', chain: 'nut', hp: 22,  atk: 8,  color: '#d8c24a', r: 0.30, speed: 1.6, eats: ['moss'], breed: 20 },
    lizard:  { name: 'トカゲおとこ', chain: 'nut', hp: 64,  atk: 19, color: '#5fa86a', r: 0.40, speed: 1.25, eats: ['insect'], breed: 34 },
    element: { name: 'エレメント',   chain: 'mag', hp: 16,  atk: 5,  color: '#6fd6ea', r: 0.26, speed: 1.4, eats: [], eatsNutrient: true, breed: Infinity, matureTo: 'lilith', mature: 18, fly: true },
    lilith:  { name: 'リリス',       chain: 'mag', hp: 36,  atk: 15, color: '#c87fe0', r: 0.32, speed: 1.5, eats: ['insect', 'moss'], breed: Infinity, matureTo: 'dragon', mature: 40, fly: true, ranged: true },
    dragon:  { name: 'ドラゴン',     chain: 'mag', hp: 150, atk: 36, color: '#e05a7a', r: 0.54, speed: 1.7, eats: ['moss', 'insect', 'lizard', 'element', 'lilith'], breed: Infinity, fly: true },
  };

  // ヒーロー（職業）
  const H: Record<string, HDef> = {
    swordsman: { name: '剣士',   hp: 34,  atk: 8,  color: '#e6d6b0', r: 0.30, speed: 1.7, mana: 4 },
    warrior:   { name: '戦士',   hp: 56,  atk: 12, color: '#c8a06a', r: 0.34, speed: 1.4, mana: 6 },
    rogue:     { name: '盗賊',   hp: 26,  atk: 7,  color: '#8fe0a0', r: 0.27, speed: 2.5, mana: 5 },
    mage:      { name: '魔法使い', hp: 28, atk: 14, color: '#9aa6f4', r: 0.30, speed: 1.5, mana: 12, mage: true },
    cleric:    { name: '僧侶',   hp: 40,  atk: 6,  color: '#f0e8c0', r: 0.31, speed: 1.5, mana: 9 },
    hero:      { name: '勇者',   hp: 95,  atk: 18, color: '#ffd24a', r: 0.37, speed: 1.9, mana: 18 },
    champ:     { name: '大勇者', hp: 300, atk: 34, color: '#ff7a3a', r: 0.52, speed: 1.7, mana: 50 },
  };

  let COLS = 18, ROWS = 28;
  let cellType: Uint8Array = new Uint8Array(0);   // 0=岩(土) 1=通路 2=巣
  let nutrient: Float64Array = new Float64Array(0);
  let distCore: Int32Array = new Int32Array(0);   // 魔王巣までの通路距離
  let distEntr: Int32Array = new Int32Array(0);   // 入口までの通路距離
  let path: { r: number; c: number }[] = [];
  let entranceR = 0, entranceC = 0;

  let creatures: Creature[] = [], heroes: Hero[] = [], particles: Particle[] = [], floats: FloatTxt[] = [];
  let overlord = { r: 0, c: 0, x: 0, y: 0, state: 'nest' as 'nest' | 'carried' | 'dropped', carrier: null as Hero | null, dropT: 0 };
  let digPower = 40, mana = 0, level = 0;
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

  // ---- ダンジョン生成：蛇行する通路（入口→巣）＋周囲の土に養分の鉱脈を散布 ----
  function buildDungeon() {
    cellType = new Uint8Array(COLS * ROWS);
    nutrient = new Float64Array(COLS * ROWS);
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

    // 養分の鉱脈：いくつかの中心にガウス状に散布（総量はここで固定＝以後保存）
    const veins = 5 + ((COLS * ROWS) / 220 | 0);
    for (let v = 0; v < veins; v++) {
      const cr = ri(2, ROWS - 3), cc = ri(1, COLS - 2), amt = rnd(20, 46), rad = rnd(1.6, 3.2);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const d = dl(c, r, cc, cr); if (d > rad) continue;
        nutrient[idx(r, c)] += amt * Math.exp(-(d * d) / (rad)) ;
      }
    }
    recomputeFields();
  }

  function bfsField(field: Int32Array, sources: number[]) {
    field.fill(-1);
    const q: number[] = [];
    for (const s of sources) { field[s] = 0; q.push(s); }
    let h = 0;
    while (h < q.length) {
      const cur = q[h++]; const r = (cur / COLS) | 0, c = cur % COLS;
      for (const [dr, dc] of NB) {
        const nr = r + dr, nc = c + dc;
        if (!inB(nr, nc)) continue;
        const ni = idx(nr, nc);
        if (cellType[ni] === 0 || field[ni] !== -1) continue;
        field[ni] = field[cur] + 1; q.push(ni);
      }
    }
  }
  function recomputeFields() {
    bfsField(distCore, [idx(overlord.r, overlord.c)]);
    bfsField(distEntr, [idx(entranceR, entranceC)]);
  }

  function newGame() {
    creatures = []; heroes = []; particles = []; floats = [];
    digPower = 45; mana = 0; level = 0;
    state = 'play'; restartCountdown = -1; waveGap = 0;
    ctx.hideOverlay();
    buildDungeon();
    for (let i = 0; i < 8; i++) spawnCreature('moss', randomTunnel());
    for (let i = 0; i < 5; i++) spawnCreature('insect', randomTunnel());
    for (let i = 0; i < 5; i++) spawnCreature('lizard', nearNestTunnel());
    nextWave();
    updateScores();
    render();
  }

  function nextWave() {
    level++;
    if (level > best) { best = level; localStorage.setItem(BEST_KEY, String(best)); }
    digPower = Math.min(120, digPower + 18 + level * 2);
    const n = Math.min(1 + level, 30);
    toSpawn = [];
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      let t = 'swordsman';
      if (level >= 8 && roll < 0.12) t = 'hero';
      else if (level >= 6 && roll < 0.26) t = 'cleric';
      else if (level >= 4 && roll < 0.44) t = 'mage';
      else if (level >= 3 && roll < 0.60) t = 'warrior';
      else if (roll < 0.74) t = 'rogue';
      toSpawn.push(t);
    }
    if (level % 5 === 0) toSpawn.push('champ');
    spawnCd = 0.7;
    waveGap = 2.4;
    updateScores();
  }

  function updateScores() {
    const od = overlord.state === 'nest' ? '魔王' : overlord.state === 'carried' ? '⚠拉致' : '落下';
    ctx.setScores(level, best, `${od} ⛏${digPower | 0} 魔${mana | 0} 👾${creatures.length}`);
  }

  // ---- 生成ヘルパ ----
  function randomTunnel(): number {
    for (let i = 0; i < 40; i++) { const k = ri(0, COLS * ROWS - 1); if (cellType[k] !== 0) return k; }
    return idx(overlord.r, overlord.c);
  }
  // 巣の近く（最終防衛線）の通路セル
  function nearNestTunnel(): number {
    for (let i = 0; i < 40; i++) { const k = ri(0, COLS * ROWS - 1); if (cellType[k] !== 0 && distCore[k] >= 0 && distCore[k] < 7) return k; }
    return idx(overlord.r, overlord.c);
  }
  function countType(t: CKey) { let n = 0; for (const c of creatures) if (!c.dead && c.type === t) n++; return n; }
  function typeCap(t: CKey): number {
    const cap = creatureCap();
    if (t === 'moss') return Math.floor(cap * 0.30);     // 生産者は控えめ（戦力の枠を空ける）
    if (t === 'insect') return Math.floor(cap * 0.40);
    if (t === 'element') return Math.floor(cap * 0.15);
    if (t === 'lilith') return Math.floor(cap * 0.18);
    return cap;                                           // トカゲ・ドラゴン（戦力）は上限なし
  }
  function spawnCreature(type: CKey, cell: number) {
    if (creatures.length >= creatureCap() || countType(type) >= typeCap(type)) return;
    const r = (cell / COLS) | 0, c = cell % COLS, def = C[type];
    const hpScale = 1 + level * 0.05;
    creatures.push({ type, x: c + 0.5, y: r + 0.5, tr: r, tc: c, hp: def.hp * hpScale, maxhp: def.hp * hpScale, atk: def.atk, fed: 0, hunger: 0, cd: 0, flash: 0, fly: !!def.fly });
  }
  function creatureCap() { return Math.min(95, 40 + level * 3); }
  function spawnHero(cls: string) {
    const def = H[cls], hpScale = 1 + level * 0.12, atkScale = 1 + level * 0.06;
    heroes.push({ x: entranceC + 0.5, y: entranceR + 0.5, tr: entranceR, tc: entranceC, cls, def, hp: def.hp * hpScale, maxhp: def.hp * hpScale, atk: def.atk * atkScale, speed: def.speed, cd: 0, flash: 0, carrying: false });
  }

  function burst(x: number, y: number, color: string, n = 7) {
    for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), s = rnd(1.5, 4.5); particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.6), color }); }
  }
  function floatText(x: number, y: number, text: string, color: string) { floats.push({ x, y, life: 0.95, text, color }); }

  // ---- 破壊神 AI：掘って生態系を育てる（入口へ近づけつつ養分鉱脈へ枝を伸ばす）----
  function aiDig() {
    if (digPower < 1) return;
    // フロンティア＝通路に隣接する土
    const frontier: number[] = [];
    for (const p of path) for (const [dr, dc] of NB) { const r = p.r + dr, c = p.c + dc; if (inB(r, c) && cellType[idx(r, c)] === 0) frontier.push(idx(r, c)); }
    // 通路化済みも含め枝の先端も候補に（チャンバーを広げる）
    if (frontier.length === 0) return;
    // 養分の濃い土を優先的に掘る（配下を増やすため）
    let cell = frontier[(Math.random() * frontier.length) | 0];
    if (Math.random() < 0.7) {
      let bestN = -1;
      for (let i = 0; i < 16; i++) { const f = frontier[(Math.random() * frontier.length) | 0]; if (nutrient[f] > bestN) { bestN = nutrient[f]; cell = f; } }
    }
    cellType[cell] = 1; path.push({ r: (cell / COLS) | 0, c: cell % COLS });
    digPower -= 1;
    const r = (cell / COLS) | 0, c = cell % COLS;
    lastDig = { r, c, t: clock };
    burst(c + 0.5, r + 0.5, '#caa86a', 4);
    // 掘った土の養分濃度に応じてモンスターが湧く（養分は消費＝循環）
    const nut = nutrient[cell];
    if (nut >= 14 && Math.random() < 0.7) { spawnCreature('lizard', cell); nutrient[cell] = nut * 0.3; }
    else if (nut >= 6 && Math.random() < 0.75) { spawnCreature('insect', cell); nutrient[cell] = nut * 0.4; }
    else if (nut >= 1) { spawnCreature('moss', cell); nutrient[cell] = nut * 0.6; }
    recomputeFields();
  }

  // 魔しずく（マナ）で魔力系の底辺エレメントを湧かせる
  function manaSpawn() {
    if (mana >= 18 && creatures.length < creatureCap()) { mana -= 18; spawnCreature('element', randomTunnel()); }
  }
  // 脅威（ウェーブ）に応じて戦力を補充：掘削力で道沿いに迎撃役を湧かせる
  function aiReinforce() {
    let fighters = 0;
    for (const c of creatures) if (!c.dead && c.type !== 'moss' && c.type !== 'element') fighters++;
    const target = Math.min(creatureCap() - 4, 9 + level * 2);
    if (fighters >= target || digPower < 4) return;
    digPower -= 4;
    const p = path[(Math.random() * path.length) | 0];
    spawnCreature(level >= 4 && Math.random() < 0.5 ? 'lizard' : 'insect', idx(p.r, p.c));
  }

  // ---- 移動 ----
  function stepToward(e: { x: number; y: number }, tr: number, tc: number, dt: number, speed: number): boolean {
    const tx = tc + 0.5, ty = tr + 0.5, dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy), step = speed * dt;
    if (d <= step) { e.x = tx; e.y = ty; return true; }
    e.x += dx / d * step; e.y += dy / d * step; return false;
  }
  function curCell(e: { x: number; y: number }) { return { r: Math.max(0, Math.min(ROWS - 1, Math.floor(e.y))), c: Math.max(0, Math.min(COLS - 1, Math.floor(e.x))) }; }
  function atCenter(e: { x: number; y: number }, tr: number, tc: number) { return Math.abs(e.x - (tc + 0.5)) < 0.06 && Math.abs(e.y - (tr + 0.5)) < 0.06; }
  const passable = (cr: Creature, r: number, c: number) => inB(r, c) && (cr.fly || cellType[idx(r, c)] !== 0);

  // 勾配を下って目的セルへ（field 上）
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
    digPower = Math.min(120, digPower + (auto ? 7 : 4) * dt);

    if (state === 'gameover') {
      if (auto && restartCountdown >= 0 && --restartCountdown <= 0) newGame();
      decayFx(dt); render(); return;
    }

    // ヒーロー出現
    if (toSpawn.length > 0) {
      spawnCd -= dt;
      if (spawnCd <= 0) { spawnHero(toSpawn.shift() as string); spawnCd = Math.max(0.3, 1.0 - level * 0.02); }
    } else if (heroes.length === 0) {
      waveGap -= dt;
      if (waveGap <= 0) nextWave();
    }

    updateHeroes(dt);
    updateCreatures(dt);

    creatures = creatures.filter((c) => !c.dead);
    heroes = heroes.filter((h) => !h.dead);

    // 魔王の落下→巣へ復帰
    if (overlord.state === 'dropped') { overlord.dropT -= dt; if (overlord.dropT <= 0) { overlord.state = 'nest'; overlord.r = pathBottomNest(); overlord.x = overlord.c + 0.5; overlord.y = overlord.r + 0.5; burst(overlord.x, overlord.y, '#c050ff', 12); } }

    // 掘削・マナ
    digCd -= dt;
    if (digCd <= 0) { digCd = 0.26; aiDig(); manaSpawn(); aiReinforce(); }

    decayFx(dt);
    updateScores();
    render();
  }
  function pathBottomNest() { return overlord.r; }

  function updateHeroes(dt: number) {
    for (const h of heroes) {
      if (h.dead) continue;
      h.flash = Math.max(0, h.flash - dt);
      const cc = curCell(h);
      // 魔王を掴む / 運び出す
      if (!h.carrying && overlord.state === 'nest' && cc.r === overlord.r && cc.c === overlord.c) {
        h.carrying = true; overlord.state = 'carried'; overlord.carrier = h; floatText(h.x, h.y, '魔王を捕獲!', '#ff5050'); if (window.SFX) window.SFX.item && window.SFX.item();
      }
      if (h.carrying) { overlord.x = h.x; overlord.y = h.y - 0.2; }
      if (h.carrying && cc.r === entranceR && cc.c === entranceC) { gameOver(); return; }
      // 交戦（隣接する戦闘可能モンスター）
      let foe: Creature | null = null, fd = 0.95;
      for (const cr of creatures) { if (cr.dead || cr.type === 'moss') continue; const d = dl(h.x, h.y, cr.x, cr.y); if (d < fd) { fd = d; foe = cr; } }
      if (foe) {
        h.cd -= dt;
        if (h.cd <= 0) { h.cd = 0.45; damageCreature(foe, h.atk); h.flash = 0.15; if (h.def.mage) mana += 2; }
      } else {
        const field = h.carrying ? distEntr : distCore;
        if (atCenter(h, h.tr, h.tc)) { const nx = gradientNext(h, field); h.tr = nx.r; h.tc = nx.c; }
        stepToward(h, h.tr, h.tc, dt, h.carrying ? h.speed * 0.5 : h.speed); // 魔王運搬中は鈍足（道中で討たれやすい）
      }
    }
  }

  function updateCreatures(dt: number) {
    ecoCd -= dt; const ecoTick = ecoCd <= 0; if (ecoTick) ecoCd = 0.4;
    for (const cr of creatures) {
      if (cr.dead) continue;
      cr.flash = Math.max(0, cr.flash - dt);
      cr.hunger += dt;
      const cc = curCell(cr), ci = idx(cc.r, cc.c), def = C[cr.type];

      // 摂食：常に少し採餌（苔=光合成）＋養分セルから吸収。餓死はさせず個体数は上限と戦闘で調整
      cr.fed += (cr.type === 'moss' ? 0.8 : 0.45) * dt;
      if (def.eatsNutrient && nutrient[ci] > 0) { const eat = Math.min(nutrient[ci], 8 * dt); nutrient[ci] -= eat; cr.fed += eat; }
      if (def.eats.length) {
        for (const other of creatures) {
          if (other.dead || other === cr) continue;
          if (def.eats.indexOf(other.type) < 0) continue;
          if (dl(cr.x, cr.y, other.x, other.y) < 0.7) { other.dead = true; cr.fed += 8; cr.hp = Math.min(cr.maxhp, cr.hp + cr.maxhp * 0.12); burst(other.x, other.y, C[other.type].color, 5); break; }
        }
      }
      // 成長（魔力系の成熟）・繁殖
      if (def.matureTo && cr.fed >= (def.mature as number)) { matureInto(cr, def.matureTo); }
      else if (ecoTick && cr.fed >= def.breed && creatures.length < creatureCap()) { cr.fed -= def.breed; spawnCreature(cr.type, ci); }

      // ヒーローへの攻撃（苔以外）
      if (cr.type !== 'moss') {
        const range = def.ranged ? 2.6 : 0.95;
        let target: Hero | null = null, td = range;
        for (const h of heroes) { if (h.dead) continue; const d = dl(cr.x, cr.y, h.x, h.y); if (d < td) { td = d; target = h; } }
        if (target && td < (def.ranged ? range : 0.95)) {
          cr.cd -= dt;
          if (cr.cd <= 0) { cr.cd = def.ranged ? 0.7 : 0.5; damageHero(target, cr.atk); cr.flash = 0.15; if (def.ranged) beam(cr, target); }
          if (def.ranged) continue;            // 遠距離は近づかず撃つ
        }
        // 移動：近くのヒーローを狙う／いなければ獲物・徘徊
        moveCreature(cr, dt, def);
        continue;
      }
      // 苔：養分のある方へゆっくり徘徊
      moveCreature(cr, dt, def);
    }
  }

  function moveCreature(cr: Creature, dt: number, def: CDef) {
    // 目標：戦闘可能なら最寄りヒーロー、なければ最寄りの獲物、なければ通路勾配＋ゆらぎ
    let tx = -1, ty = -1;
    // 持ち場を離れて遠くを追わない（道全体に分散して迎撃させる）。近くのヒーロー優先
    if (cr.type !== 'moss') {
      let best = 3.6, h: Hero | null = null;
      for (const hh of heroes) { if (hh.dead) continue; const d = dl(cr.x, cr.y, hh.x, hh.y); if (d < best) { best = d; h = hh; } }
      if (h) { tx = h.x; ty = h.y; }
    }
    if (tx < 0 && def.eats.length) {
      let best = 4.5, p: Creature | null = null;
      for (const o of creatures) { if (o.dead || def.eats.indexOf(o.type) < 0) continue; const d = dl(cr.x, cr.y, o.x, o.y); if (d < best) { best = d; p = o; } }
      if (p) { tx = p.x; ty = p.y; }
    }
    const cc = curCell(cr);
    if (atCenter(cr, cr.tr, cr.tc)) {
      let br = cc.r, bc = cc.c, bv = Infinity;
      for (const [dr, dc] of NB) {
        const nr = cc.r + dr, nc = cc.c + dc; if (!passable(cr, nr, nc)) continue;
        let v: number;
        if (tx >= 0) v = dl(nc + 0.5, nr + 0.5, tx, ty);
        else v = Math.random() * 2;   // 獲物もヒーローも近くにいなければ持ち場でゆらゆら徘徊
        if (v < bv) { bv = v; br = nr; bc = nc; }
      }
      cr.tr = br; cr.tc = bc;
    }
    stepToward(cr, cr.tr, cr.tc, dt, def.speed);
  }

  function matureInto(cr: Creature, to: CKey) {
    cr.type = to; const def = C[to]; const hpScale = 1 + level * 0.05;
    cr.maxhp = def.hp * hpScale; cr.hp = cr.maxhp; cr.atk = def.atk; cr.fed = 0; cr.fly = !!def.fly; cr.flash = 0.3;
    burst(cr.x, cr.y, def.color, 11); floatText(cr.x, cr.y, def.name + '!', def.color);
    if (window.SFX) window.SFX.levelup && window.SFX.levelup();
  }

  function damageCreature(cr: Creature, dmg: number) {
    cr.hp -= dmg; cr.flash = 0.18;
    if (cr.hp <= 0 && !cr.dead) { cr.dead = true; burst(cr.x, cr.y, C[cr.type].color, 8); if (window.SFX) window.SFX.pop && window.SFX.pop(); }
  }
  function damageHero(h: Hero, dmg: number) {
    h.hp -= dmg; h.flash = 0.18;
    if (h.hp <= 0 && !h.dead) {
      h.dead = true; mana += h.def.mana; burst(h.x, h.y, h.def.color, 10);
      floatText(h.x, h.y, '魔' + h.def.mana, '#c87fe0');
      if (window.SFX) window.SFX.explode && window.SFX.explode();
      if (h.carrying) { overlord.state = 'dropped'; overlord.dropT = 2.2; overlord.carrier = null; floatText(h.x, h.y, '魔王 落下', '#ffd24a'); }
      updateScores();
    }
  }

  function beam(cr: Creature, h: Hero) { particles.push({ x: cr.x, y: cr.y, vx: 0, vy: 0, life: 0.0001, color: C[cr.type].color }); beams.push({ x1: cr.x, y1: cr.y, x2: h.x, y2: h.y, life: 0.12, color: C[cr.type].color }); }
  let beams: { x1: number; y1: number; x2: number; y2: number; life: number; color: string }[] = [];

  function decayFx(dt: number) {
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floats) { f.y -= dt * 1.2; f.life -= dt; }
    floats = floats.filter((f) => f.life > 0);
    for (const b of beams) b.life -= dt;
    beams = beams.filter((b) => b.life > 0);
  }

  function gameOver() {
    state = 'gameover'; restartCountdown = RESTART_TICKS;
    if (window.SFX) window.SFX.die && window.SFX.die();
    ctx.showOverlay('魔王 連れ去られ…', auto ? `Wave ${level} ・自動リスタート…` : `Wave ${level} ・キーで再開`);
  }

  // ---- 描画 ----
  let scale = 16, offX = 0, offY = 0;
  const TAU = Math.PI * 2;
  function applyGridSize() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cols = Math.max(14, Math.min(26, Math.round(rect.width / CELL_TARGET)));
    const rows = Math.max(20, Math.min(40, Math.round(rect.height / CELL_TARGET)));
    if (cols !== COLS || rows !== ROWS || cellType.length === 0) { COLS = cols; ROWS = rows; newGame(); }
  }
  function relayout() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
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

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = cellType[idx(r, c)], x = sx(c), y = sy(r), nut = nutrient[idx(r, c)];
      if (t === 0) {
        const h = ((r * 73 + c * 19) % 7) - 3;
        g2d.fillStyle = `rgb(${66 + h},${52 + h},${44 + h})`;
        g2d.fillRect(x, y, scale + 0.5, scale + 0.5);
        if (nut > 1) { g2d.save(); g2d.globalAlpha = Math.min(0.5, nut / 40); g2d.fillStyle = '#6fd05a'; g2d.fillRect(x, y, scale, scale); g2d.restore(); }
        g2d.fillStyle = 'rgba(0,0,0,0.18)'; g2d.fillRect(x, y + scale * 0.74, scale + 0.5, scale * 0.26);
      } else {
        g2d.fillStyle = '#221a28'; g2d.fillRect(x, y, scale + 0.5, scale + 0.5);
        if (nut > 0.5) { g2d.save(); g2d.globalAlpha = Math.min(0.5, nut / 18); g2d.fillStyle = '#7fe05a'; g2d.fillRect(x, y, scale, scale); g2d.restore(); }
      }
    }
    // 入口
    g2d.fillStyle = '#f0d060'; g2d.fillRect(sx(entranceC) + scale * 0.2, sy(entranceR) + scale * 0.02, scale * 0.6, scale * 0.22);

    if (overlord.state !== 'carried') drawOverlord(overlord.x, overlord.y);

    for (const b of beams) { g2d.save(); g2d.shadowColor = b.color; g2d.shadowBlur = scale; g2d.strokeStyle = b.color; g2d.lineWidth = scale * 0.12; g2d.globalAlpha = Math.min(1, b.life * 9); g2d.beginPath(); g2d.moveTo(sx(b.x1), sy(b.y1)); g2d.lineTo(sx(b.x2), sy(b.y2)); g2d.stroke(); g2d.restore(); }
    g2d.globalAlpha = 1;

    for (const cr of creatures) drawCreature(cr);
    for (const h of heroes) drawHero(h);
    if (overlord.state === 'carried') drawOverlord(overlord.x, overlord.y);

    // つるはし（最後に掘った位置に少しの間）
    if (clock - lastDig.t < 0.35 && lastDig.r >= 0) drawPick(lastDig.c + 0.5, lastDig.r + 0.5);

    for (const p of particles) { g2d.globalAlpha = Math.max(0, p.life * 2.2); g2d.fillStyle = p.color; g2d.fillRect(sx(p.x) - scale * 0.1, sy(p.y) - scale * 0.1, scale * 0.2, scale * 0.2); }
    g2d.globalAlpha = 1;
    g2d.textAlign = 'center'; g2d.font = `bold ${Math.max(8, scale * 0.55)}px sans-serif`;
    for (const f of floats) { g2d.globalAlpha = Math.max(0, f.life); g2d.fillStyle = f.color; g2d.fillText(f.text, sx(f.x), sy(f.y)); }
    g2d.globalAlpha = 1;
  }

  function drawOverlord(ox: number, oy: number) {
    const cx = sx(ox), cy = sy(oy), rad = scale * 0.42 * (1 + Math.sin(clock * 4) * 0.06);
    g2d.save(); g2d.shadowColor = '#c050ff'; g2d.shadowBlur = scale;
    const grd = g2d.createRadialGradient(cx, cy, scale * 0.08, cx, cy, rad);
    grd.addColorStop(0, '#ffd6ff'); grd.addColorStop(0.55, '#c050ff'); grd.addColorStop(1, '#5a18a0');
    g2d.fillStyle = grd; g2d.beginPath(); g2d.arc(cx, cy, rad, 0, TAU); g2d.fill(); g2d.restore();
    // 王冠
    g2d.fillStyle = '#ffd24a';
    g2d.beginPath(); g2d.moveTo(cx - rad * 0.7, cy - rad * 0.5); g2d.lineTo(cx - rad * 0.7, cy - rad); g2d.lineTo(cx - rad * 0.3, cy - rad * 0.6); g2d.lineTo(cx, cy - rad * 1.05); g2d.lineTo(cx + rad * 0.3, cy - rad * 0.6); g2d.lineTo(cx + rad * 0.7, cy - rad); g2d.lineTo(cx + rad * 0.7, cy - rad * 0.5); g2d.closePath(); g2d.fill();
    // 目
    g2d.fillStyle = '#2a0f2a'; g2d.fillRect(cx - rad * 0.4, cy - rad * 0.1, rad * 0.3, rad * 0.34); g2d.fillRect(cx + rad * 0.12, cy - rad * 0.1, rad * 0.3, rad * 0.34);
  }

  function drawCreature(cr: Creature) {
    const x = sx(cr.x), y = sy(cr.y), def = C[cr.type], r = scale * def.r;
    g2d.save();
    if (cr.flash > 0) g2d.globalAlpha = 0.5 + 0.5 * Math.sin(clock * 40);
    if (def.chain === 'mag' || cr.type === 'dragon') { g2d.shadowColor = def.color; g2d.shadowBlur = scale * 0.5; }
    g2d.fillStyle = def.color;
    if (cr.type === 'moss') {
      for (const [ox, oy] of [[-0.3, 0.1], [0.25, 0.0], [0, -0.25], [0.05, 0.28]]) { g2d.beginPath(); g2d.arc(x + ox * r * 2, y + oy * r * 2, r * 0.6, 0, TAU); g2d.fill(); }
    } else if (cr.type === 'insect') {
      g2d.beginPath(); g2d.ellipse(x, y, r, r * 0.7, 0, 0, TAU); g2d.fill();
      g2d.strokeStyle = def.color; g2d.lineWidth = r * 0.18; g2d.beginPath(); g2d.moveTo(x - r * 0.4, y - r * 0.5); g2d.lineTo(x - r * 0.7, y - r); g2d.moveTo(x + r * 0.4, y - r * 0.5); g2d.lineTo(x + r * 0.7, y - r); g2d.stroke();
    } else if (cr.type === 'lizard') {
      g2d.beginPath(); g2d.arc(x, y, r, 0, TAU); g2d.fill();
      g2d.fillStyle = '#cfd6dd'; g2d.fillRect(x + r * 0.5, y - r, r * 0.16, r * 1.5);   // 剣
      g2d.fillStyle = '#9a6a3a'; roundRect(x - r * 1.0, y - r * 0.5, r * 0.4, r, r * 0.1); g2d.fill(); // 盾
    } else if (cr.type === 'element') {
      g2d.beginPath(); g2d.moveTo(x, y - r); g2d.lineTo(x + r * 0.7, y); g2d.lineTo(x, y + r); g2d.lineTo(x - r * 0.7, y); g2d.closePath(); g2d.fill();
    } else if (cr.type === 'lilith') {
      g2d.beginPath(); g2d.arc(x, y, r * 0.8, 0, TAU); g2d.fill();
      g2d.beginPath(); g2d.moveTo(x - r * 0.6, y); g2d.lineTo(x - r * 1.5, y - r * 0.7); g2d.lineTo(x - r * 0.5, y - r * 0.6); g2d.closePath(); g2d.fill();
      g2d.beginPath(); g2d.moveTo(x + r * 0.6, y); g2d.lineTo(x + r * 1.5, y - r * 0.7); g2d.lineTo(x + r * 0.5, y - r * 0.6); g2d.closePath(); g2d.fill();
    } else { // dragon
      g2d.beginPath(); g2d.arc(x, y, r, 0, TAU); g2d.fill();
      g2d.beginPath(); g2d.moveTo(x - r, y); g2d.lineTo(x - r * 1.9, y - r * 0.7); g2d.lineTo(x - r * 0.8, y - r * 0.95); g2d.closePath(); g2d.fill();
      g2d.beginPath(); g2d.moveTo(x + r, y); g2d.lineTo(x + r * 1.9, y - r * 0.7); g2d.lineTo(x + r * 0.8, y - r * 0.95); g2d.closePath(); g2d.fill();
    }
    g2d.restore();
    if (cr.type !== 'moss') { g2d.fillStyle = '#1a0f1a'; g2d.fillRect(x - r * 0.38, y - r * 0.12, r * 0.24, r * 0.28); g2d.fillRect(x + r * 0.14, y - r * 0.12, r * 0.24, r * 0.28); }
    if (cr.hp < cr.maxhp) hpBar(x, y - r - scale * 0.2, cr.hp / cr.maxhp);
  }

  function drawHero(h: Hero) {
    const x = sx(h.x), y = sy(h.y), def = h.def, r = scale * def.r;
    g2d.save();
    if (h.flash > 0) { g2d.shadowColor = '#fff'; g2d.shadowBlur = scale * 0.5; }
    g2d.fillStyle = def.color; roundRect(x - r * 0.7, y - r * 0.4, r * 1.4, r * 1.3, r * 0.3); g2d.fill();
    g2d.fillStyle = '#f2d2a8'; g2d.beginPath(); g2d.arc(x, y - r * 0.6, r * 0.5, 0, TAU); g2d.fill();
    if (h.cls === 'hero' || h.cls === 'champ') { g2d.shadowColor = '#fff6a0'; g2d.shadowBlur = scale * 0.5; }
    if (h.def.mage) { g2d.strokeStyle = '#bcd0ff'; g2d.lineWidth = scale * 0.1; g2d.beginPath(); g2d.moveTo(x + r * 0.6, y + r * 0.7); g2d.lineTo(x + r * 0.6, y - r * 1.0); g2d.stroke(); g2d.fillStyle = '#bcd0ff'; g2d.beginPath(); g2d.arc(x + r * 0.6, y - r * 1.0, r * 0.22, 0, TAU); g2d.fill(); }
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
  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    g2d.beginPath(); g2d.moveTo(x + r, y); g2d.arcTo(x + w, y, x + w, y + h, r); g2d.arcTo(x + w, y + h, x, y + h, r); g2d.arcTo(x, y + h, x, y, r); g2d.arcTo(x, y, x + w, y, r); g2d.closePath();
  }

  // ---- 共通インターフェース ----
  return {
    name: 'hero',
    show() { wrapEl.style.display = 'flex'; relayout(); updateScores(); if (timer === null) timer = setInterval(tick, TICK_MS); },
    hide() { clearInterval(timer); timer = null; wrapEl.style.display = 'none'; },
    setAuto(on: boolean) { auto = on; },
    key() { if (state === 'gameover') { newGame(); return true; } return false; },
    relayout, reset: newGame, isOver: () => state === 'gameover',
    _tick: tick,
    _state: () => {
      const sp: Record<string, number> = {};
      for (const cr of creatures) sp[cr.type] = (sp[cr.type] || 0) + 1;
      return { state, level, digPower: digPower | 0, mana: mana | 0, creatures: creatures.length, heroes: heroes.length, species: sp, overlord: overlord.state, best, cols: COLS, rows: ROWS };
    },
  };
};
