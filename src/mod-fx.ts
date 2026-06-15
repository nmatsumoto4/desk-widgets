// FX トレーディング・シミュレータ ウィジェット（ドル円・実データ再生）
//
// ・実際のドル円（USD/JPY）日次終値（ECB 参照レート, src/fxdata.ts）を再生する。
// ・デフォルトの AI モードは移動平均クロスで「次に上がるか下がるか」を予測し、
//   ロング/ショートを取って収益最大化を狙う（常に相場に張る）。
// ・人間も買い/売り/決済の注文ができる（フッターのボタン or フォーカス中の矢印キー）。
// ・含み損益・確定損益・総収益（資産）を表示。データ終端で次の区間へ自動リスタート。

interface Trade { i: number; price: number; dir: number; }

window.createWidgetFX = function (ctx: WidgetCtx): WidgetModule {
  const TICK_MS = 33;
  const BEST_KEY = 'widgetFX.best';
  const WIN = 90;            // チャートに表示する本数
  const RUN_LEN = 420;       // 1 区間の本数（終わったら別区間へ）
  const UNITS = 10000;       // 取引数量（USD）。1 円動くと ¥10,000 の損益
  const SPREAD = 0.02;       // 売買時のスプレッド（円）
  const START_EQUITY = 1000000;

  const wrapEl = document.getElementById('fx') as HTMLElement;
  const canvas = document.getElementById('fx-canvas') as HTMLCanvasElement;
  const g2d = canvas.getContext('2d') as CanvasRenderingContext2D;
  const ctrlEl = document.getElementById('fx-ctrl') as HTMLElement;

  const DATA = (window as any).FXDATA as { pair: string; dates: string[]; prices: number[] };
  const prices: number[] = DATA ? DATA.prices : [100];
  const dates: string[] = DATA ? DATA.dates : ['-'];

  let runStart = 0, runEnd = 0, i = 0;
  let pos = 0;              // +1 ロング / -1 ショート / 0 ノーポジ
  let entry = 0;           // 建値
  let realized = 0;        // 確定損益（円）
  let trades: Trade[] = [];
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let session = 0, barCd = 0, clock = 0;
  let humanPaused = false; // 人間が操作中は AI を止める
  let flash = 0, flashDir = 0;
  let auto = false, timer: any = null;

  const price = () => prices[i];
  const unrealized = () => pos === 0 ? 0 : pos * UNITS * (price() - entry);
  const equity = () => START_EQUITY + realized + unrealized();
  const totalPnL = () => equity() - START_EQUITY;

  function newRun() {
    const maxStart = Math.max(1, prices.length - 60);
    runStart = 40 + ((Math.random() * Math.max(1, maxStart - 60)) | 0);
    runEnd = Math.min(prices.length - 1, runStart + RUN_LEN);
    i = runStart;
    pos = 0; entry = 0; realized = 0; trades = [];
    humanPaused = false; flash = 0;
    session++;
    updateScores(); render();
  }

  function fmt(n: number) {
    const s = n >= 0 ? '+' : '-'; const a = Math.abs(Math.round(n));
    return s + '¥' + a.toLocaleString('en-US');
  }
  function updateScores() {
    const t = totalPnL();
    if (t > best) { best = t; localStorage.setItem(BEST_KEY, String(Math.round(best))); }
    const p = pos > 0 ? 'L' : pos < 0 ? 'S' : '—';
    ctx.setScores(fmt(t), fmt(best), `${p} ${price().toFixed(2)}`);
  }

  // ポジションを target（+1/-1/0）へ。差分は確定損益に反映し、建値を更新
  function setPosition(target: number) {
    if (target === pos) return;
    if (pos !== 0) realized += pos * UNITS * (price() - entry) - UNITS * SPREAD; // 決済（スプレッド控除）
    if (target !== 0) { entry = price() + 0; realized -= UNITS * SPREAD; trades.push({ i, price: price(), dir: target }); }
    pos = target;
    updateScores();
  }

  // ---- AI：移動平均クロスで方向を予測（短期 > 長期 ならロング、その逆はショート）----
  function avg(end: number, n: number) { let s = 0, c = 0; for (let k = end; k > end - n && k >= 0; k--) { s += prices[k]; c++; } return s / Math.max(1, c); }
  function aiThink() {
    if (i < 22) return;
    const shortMA = avg(i, 5), longMA = avg(i, 22);
    const gap = (shortMA - longMA) / longMA;
    // デッドバンドで小刻みな反転（だまし）を抑える
    if (gap > 0.0008 && pos <= 0) setPosition(1);
    else if (gap < -0.0008 && pos >= 0) setPosition(-1);
  }

  // ---- 人間の注文 ----
  function buy() { humanPaused = true; setPosition(1); render(); }
  function sell() { humanPaused = true; setPosition(-1); render(); }
  function flat() { humanPaused = true; setPosition(0); render(); }
  function resumeAI() { humanPaused = false; render(); }

  // フッターの注文ボタンを配線
  document.getElementById('fx-buy')?.addEventListener('click', buy);
  document.getElementById('fx-sell')?.addEventListener('click', sell);
  document.getElementById('fx-flat')?.addEventListener('click', flat);
  document.getElementById('fx-ai')?.addEventListener('click', resumeAI);

  // ---- 進行 ----
  function tick() {
    const dt = auto ? 2 : 1;          // AI 自動運転時は倍速
    clock += TICK_MS / 1000;
    flash = Math.max(0, flash - TICK_MS / 1000);
    barCd -= dt;
    if (barCd <= 0) {
      barCd = auto ? 5 : 10;          // 何ティックで 1 本進めるか
      if (i >= runEnd) { newRun(); return; }
      const prev = price();
      i++;
      flashDir = Math.sign(price() - prev); flash = 0.5;
      if (auto && !humanPaused) aiThink();
      updateScores();
    }
    render();
  }

  // ---- 描画 ----
  let W = 300, H = 380;
  function relayout() {
    const rect = wrapEl.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    W = canvas.width; H = canvas.height;
    render();
  }

  function render() {
    g2d.clearRect(0, 0, W, H);
    g2d.fillStyle = '#0c1018'; g2d.fillRect(0, 0, W, H);
    const pad = Math.round(W * 0.04);
    const headH = Math.round(H * 0.15);
    const chartTop = headH, chartH = Math.round(H * 0.46), chartBot = chartTop + chartH;
    const up = '#26c281', down = '#e0533d';

    // ----- ヘッダー：通貨ペア・日付・現在値 -----
    g2d.textAlign = 'left'; g2d.textBaseline = 'alphabetic';
    g2d.fillStyle = '#9fb0c0'; g2d.font = `bold ${Math.round(headH * 0.30)}px sans-serif`;
    g2d.fillText('USD/JPY', pad, chartTop - headH * 0.42);
    g2d.fillStyle = '#5f6b78'; g2d.font = `${Math.round(headH * 0.22)}px sans-serif`;
    g2d.fillText(dates[i] || '', pad, chartTop - headH * 0.14);
    const col = flashDir > 0 ? up : flashDir < 0 ? down : '#e8edf2';
    g2d.textAlign = 'right'; g2d.fillStyle = col; g2d.font = `bold ${Math.round(headH * 0.5)}px sans-serif`;
    g2d.fillText(price().toFixed(3), W - pad, chartTop - headH * 0.18);

    // ----- チャート（表示窓） -----
    const a = Math.max(runStart, i - WIN), b = i;
    let lo = Infinity, hi = -Infinity;
    for (let k = a; k <= b; k++) { if (prices[k] < lo) lo = prices[k]; if (prices[k] > hi) hi = prices[k]; }
    if (pos !== 0) { lo = Math.min(lo, entry); hi = Math.max(hi, entry); }
    const span = Math.max(0.05, hi - lo), m = span * 0.12; lo -= m; hi += m;
    const X = (k: number) => pad + (b === a ? 0 : (k - a) / (b - a)) * (W - pad * 2);
    const Y = (p: number) => chartTop + (1 - (p - lo) / (hi - lo)) * chartH;

    // 枠・グリッド
    g2d.strokeStyle = 'rgba(120,150,180,0.12)'; g2d.lineWidth = 1;
    for (let gl = 0; gl <= 4; gl++) { const yy = chartTop + (gl / 4) * chartH; g2d.beginPath(); g2d.moveTo(pad, yy); g2d.lineTo(W - pad, yy); g2d.stroke(); g2d.fillStyle = '#46505c'; g2d.textAlign = 'left'; g2d.font = `${Math.round(headH * 0.18)}px sans-serif`; g2d.fillText((hi - (gl / 4) * (hi - lo)).toFixed(2), pad + 2, yy - 2); }

    // 建値ライン
    if (pos !== 0) {
      g2d.strokeStyle = pos > 0 ? 'rgba(38,194,129,0.6)' : 'rgba(224,83,61,0.6)'; g2d.lineWidth = 1; g2d.setLineDash([5, 4]);
      g2d.beginPath(); g2d.moveTo(pad, Y(entry)); g2d.lineTo(W - pad, Y(entry)); g2d.stroke(); g2d.setLineDash([]);
    }

    // 価格ライン（含み損益で色付け：建値より上=緑/下=赤 を簡易にラインで）
    g2d.strokeStyle = '#7fb0e0'; g2d.lineWidth = Math.max(1.5, W * 0.006); g2d.lineJoin = 'round';
    g2d.beginPath(); for (let k = a; k <= b; k++) { const x = X(k), y = Y(prices[k]); if (k === a) g2d.moveTo(x, y); else g2d.lineTo(x, y); } g2d.stroke();
    // 直近価格点（発光）
    g2d.save(); g2d.shadowColor = col; g2d.shadowBlur = W * 0.03; g2d.fillStyle = col; g2d.beginPath(); g2d.arc(X(b), Y(price()), Math.max(2.5, W * 0.012), 0, Math.PI * 2); g2d.fill(); g2d.restore();

    // 売買マーカー（表示窓内）
    for (const t of trades) { if (t.i < a || t.i > b) continue; const x = X(t.i), y = Y(t.price); g2d.fillStyle = t.dir > 0 ? up : down; g2d.beginPath(); if (t.dir > 0) { g2d.moveTo(x, y - W * 0.02); g2d.lineTo(x - W * 0.014, y + W * 0.01); g2d.lineTo(x + W * 0.014, y + W * 0.01); } else { g2d.moveTo(x, y + W * 0.02); g2d.lineTo(x - W * 0.014, y - W * 0.01); g2d.lineTo(x + W * 0.014, y - W * 0.01); } g2d.closePath(); g2d.fill(); }

    // ----- 損益パネル -----
    const py = chartBot + Math.round(H * 0.03);
    const u = unrealized(), tot = totalPnL();
    const posLabel = pos > 0 ? 'ロング ▲' : pos < 0 ? 'ショート ▼' : 'ノーポジ';
    const posCol = pos > 0 ? up : pos < 0 ? down : '#9fb0c0';
    g2d.textAlign = 'left'; g2d.fillStyle = '#6b7785'; g2d.font = `${Math.round(H * 0.026)}px sans-serif`;
    g2d.fillText('ポジション', pad, py + H * 0.03);
    g2d.fillStyle = posCol; g2d.font = `bold ${Math.round(H * 0.04)}px sans-serif`;
    g2d.fillText(posLabel + (pos !== 0 ? `  @ ${entry.toFixed(2)}` : ''), pad, py + H * 0.075);

    const row = (label: string, val: number, yy: number, big = false) => {
      g2d.textAlign = 'left'; g2d.fillStyle = '#6b7785'; g2d.font = `${Math.round(H * 0.026)}px sans-serif`; g2d.fillText(label, pad, yy);
      g2d.textAlign = 'right'; g2d.fillStyle = val >= 0 ? up : down; g2d.font = `bold ${Math.round(H * (big ? 0.046 : 0.034))}px sans-serif`; g2d.fillText(fmt(val), W - pad, yy);
    };
    row('含み損益', u, py + H * 0.135);
    row('確定損益', realized, py + H * 0.18);
    g2d.strokeStyle = 'rgba(120,150,180,0.15)'; g2d.beginPath(); g2d.moveTo(pad, py + H * 0.20); g2d.lineTo(W - pad, py + H * 0.20); g2d.stroke();
    row('総収益', tot, py + H * 0.255, true);
    g2d.textAlign = 'left'; g2d.fillStyle = '#46505c'; g2d.font = `${Math.round(H * 0.024)}px sans-serif`;
    g2d.fillText(`資産 ¥${Math.round(equity()).toLocaleString('en-US')}  (${(tot / START_EQUITY * 100).toFixed(1)}%)`, pad, py + H * 0.30);
    g2d.textAlign = 'right'; g2d.fillStyle = humanPaused ? '#e0a93d' : '#3d7fe0';
    g2d.fillText(humanPaused ? '手動' : 'AI 運転', W - pad, py + H * 0.30);
  }

  // ---- 共通インターフェース ----
  return {
    name: 'fx',
    show() {
      wrapEl.style.display = 'flex'; ctrlEl.style.display = 'inline-flex';
      if (i === 0) newRun();
      relayout(); updateScores();
      if (timer === null) timer = setInterval(tick, TICK_MS);
    },
    hide() { clearInterval(timer); timer = null; wrapEl.style.display = 'none'; ctrlEl.style.display = 'none'; },
    setAuto(on: boolean) { auto = on; if (on) humanPaused = false; },
    key(e: KeyboardEvent) {
      if (e.key === 'ArrowUp') { buy(); return true; }
      if (e.key === 'ArrowDown') { sell(); return true; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { flat(); return true; }
      return false;
    },
    relayout, reset: newRun, isOver: () => false,
    _tick: tick,
    _state: () => ({ i, date: dates[i], price: price(), pos, entry, realized: Math.round(realized), unrealized: Math.round(unrealized()), total: Math.round(totalPnL()), equity: Math.round(equity()), session, best: Math.round(best), trades: trades.length }),
  };
};
