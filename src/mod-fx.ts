// FX トレーディング ウィジェット（ドル円）。2 モード:
//  ・過去シミュレーション(sim)：実ドル円ヒストリカル（src/fxdata.ts）を再生し、AI が
//    移動平均クロスで方向を予測してロング/ショートし収益最大化を狙う。区間終端で別区間へ。
//  ・ライブ(live)：実際の“今”のドル円を取得して眺める。直近の実履歴チャートに現在値を表示し、
//    定期的に最新レートを再取得して更新。AI 予測・人間の注文も可能。
// 共通：含み損益・確定損益・総収益（資産・%）を表示。買/売/決済ボタンと矢印キーで人間も注文可。

interface Trade { i: number; price: number; dir: number; }

window.createWidgetFX = function (ctx: WidgetCtx): WidgetModule {
  const TICK_MS = 33;
  const BEST_KEY = 'widgetFX.best';
  const CUM_KEY = 'widgetFX.cum';        // 確定損益の生涯累計（アプリを閉じても保持）
  const MODE_KEY = 'widgetFX.mode';
  const WIN = 90;
  const CP = 3;              // ローソク 1 本に集約する終値の本数（実終値から始/高/安/終を作る）
  const MA1 = 5, MA2 = 25;   // 移動平均（短期 / 長期）
  const RUN_LEN = 420;
  const UNITS = 10000;       // 取引数量(USD)。1 円動くと ¥10,000 の損益
  const SPREAD = 0.02;
  const START_EQUITY = 1000000;
  const POLL_TICKS = Math.round(30000 / TICK_MS);   // ライブ再取得間隔（約 30 秒）

  const wrapEl = document.getElementById('fx') as HTMLElement;
  const canvas = document.getElementById('fx-canvas') as HTMLCanvasElement;
  const g2d = canvas.getContext('2d') as CanvasRenderingContext2D;
  const ctrlEl = document.getElementById('fx-ctrl') as HTMLElement;
  const modeBtn = document.getElementById('fx-mode') as HTMLButtonElement;

  const DATA = window.FXDATA;
  const histPrices: number[] = DATA ? DATA.prices : [100];
  const histDates: string[] = DATA ? DATA.dates : ['-'];

  let mode: 'sim' | 'live' = (localStorage.getItem(MODE_KEY) as any) === 'live' ? 'live' : 'sim';

  // sim 用
  let runStart = 0, runEnd = 0, i = 0, barCd = 0, session = 0;
  // live 用
  let liveSeries: number[] = [], liveDates: string[] = [];
  let liveStatus: '—' | '取得中…' | 'LIVE' | '取得失敗' = '—';
  let liveUpdated = '', pollCd = 0, fetching = false;

  // 口座。lifePnL（確定損益の生涯累計）は localStorage に保存し、アプリを閉じても引き継ぐ
  let pos = 0, entry = 0, trades: Trade[] = [];
  let lifePnL = Number(localStorage.getItem(CUM_KEY) || 0);
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let humanPaused = false, flash = 0, flashDir = 0, clock = 0;
  let auto = false, timer: any = null;

  // ---- モード非依存アクセサ ----
  const S = () => (mode === 'sim' ? histPrices : liveSeries);
  const Dt = () => (mode === 'sim' ? histDates : liveDates);
  const cur = () => (mode === 'sim' ? i : liveSeries.length - 1);
  const price = () => S()[cur()] ?? 0;
  const unrealized = () => (pos === 0 ? 0 : pos * UNITS * (price() - entry));
  const total = () => lifePnL + unrealized();          // 累計確定 ＋ 現在の含み
  const equity = () => START_EQUITY + total();
  const persist = () => localStorage.setItem(CUM_KEY, String(Math.round(lifePnL)));

  function resetAccount() { pos = 0; entry = 0; trades = []; humanPaused = false; flash = 0; }
  // 現在のポジションを今の価格で決済し、損益を生涯累計へ確定（保存）
  function closePosition() { if (pos !== 0) { lifePnL += pos * UNITS * (price() - entry) - UNITS * SPREAD; pos = 0; entry = 0; persist(); } }

  function newRun() {
    closePosition();
    const maxStart = Math.max(1, histPrices.length - 60);
    runStart = 40 + ((Math.random() * Math.max(1, maxStart - 60)) | 0);
    runEnd = Math.min(histPrices.length - 1, runStart + RUN_LEN);
    i = runStart; session++;
    resetAccount(); updateScores(); render();
  }

  function startLive() {
    closePosition();
    const n = WIN + 8;
    liveSeries = histPrices.slice(-n).slice();
    liveDates = histDates.slice(-n).slice();
    liveSeries.push(liveSeries[liveSeries.length - 1]);   // 「現在値」プレースホルダ
    liveDates.push('現在');
    liveStatus = '取得中…'; liveUpdated = ''; pollCd = 0;
    resetAccount(); updateScores(); render();
    fetchLive();
  }

  async function fetchLive() {
    if (fetching) return;
    fetching = true;
    let v: number | null = null, when = '';
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD');
      const j = await r.json();
      if (j && j.rates && typeof j.rates.JPY === 'number') { v = j.rates.JPY; when = j.time_last_update_utc || ''; }
    } catch (e) { /* fallback */ }
    if (v == null) {
      try { const r2 = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY'); const j2 = await r2.json(); if (j2 && j2.rates && typeof j2.rates.JPY === 'number') { v = j2.rates.JPY; when = j2.date || ''; } } catch (e) { /* */ }
    }
    if (v != null && mode === 'live') {
      const last = liveSeries.length - 1, prev = liveSeries[last];
      liveSeries[last] = v;
      flashDir = Math.sign(v - prev); flash = 0.6;
      liveStatus = 'LIVE';
      liveUpdated = when ? when.replace('+0000', 'UTC').replace(/^\w+,\s*/, '') : '';
      if (auto && !humanPaused) aiThink();
      updateScores();
    } else if (mode === 'live') { liveStatus = '取得失敗'; }
    fetching = false;
  }

  function setFxMode(m: 'sim' | 'live') {
    if (m === mode) return;
    closePosition();                                 // モード切替前に今の価格で決済（累計へ確定）
    mode = m; localStorage.setItem(MODE_KEY, m);
    if (m === 'sim') { newRun(); } else { startLive(); }
    syncModeBtn();
  }
  function syncModeBtn() { if (modeBtn) modeBtn.textContent = mode === 'sim' ? '過去' : 'ライブ'; }

  function fmt(n: number) { const s = n >= 0 ? '+' : '-'; return s + '¥' + Math.abs(Math.round(n)).toLocaleString('en-US'); }
  function updateScores() {
    const t = total();
    if (t > best) { best = t; localStorage.setItem(BEST_KEY, String(Math.round(best))); }
    const p = pos > 0 ? 'L' : pos < 0 ? 'S' : '—';
    ctx.setScores(fmt(t), fmt(best), `${p} ${price().toFixed(2)}`);
  }

  function setPosition(target: number) {
    if (target === pos) return;
    if (pos !== 0) lifePnL += pos * UNITS * (price() - entry) - UNITS * SPREAD;   // 決済を累計へ確定
    if (target !== 0) { entry = price(); lifePnL -= UNITS * SPREAD; trades.push({ i: cur(), price: price(), dir: target }); }
    pos = target; persist(); updateScores();
  }

  // ---- AI：移動平均クロスで方向予測 ----
  function avg(end: number, n: number) { const s = S(); let sum = 0, c = 0; for (let k = end; k > end - n && k >= 0; k--) { sum += s[k]; c++; } return sum / Math.max(1, c); }
  function aiThink() {
    const c = cur(); if (c < 22) return;
    const shortMA = avg(c, 5), longMA = avg(c, 22), gap = (shortMA - longMA) / longMA;
    if (gap > 0.0008 && pos <= 0) setPosition(1);
    else if (gap < -0.0008 && pos >= 0) setPosition(-1);
  }

  // ---- 人間の注文 ----
  function buy() { humanPaused = true; setPosition(1); render(); }
  function sell() { humanPaused = true; setPosition(-1); render(); }
  function flat() { humanPaused = true; setPosition(0); render(); }
  function resumeAI() { humanPaused = false; render(); }
  document.getElementById('fx-buy')?.addEventListener('click', buy);
  document.getElementById('fx-sell')?.addEventListener('click', sell);
  document.getElementById('fx-flat')?.addEventListener('click', flat);
  document.getElementById('fx-ai')?.addEventListener('click', resumeAI);
  modeBtn?.addEventListener('click', () => setFxMode(mode === 'sim' ? 'live' : 'sim'));

  // ---- 進行 ----
  function tick() {
    clock += TICK_MS / 1000;
    flash = Math.max(0, flash - TICK_MS / 1000);
    if (mode === 'sim') {
      const dt = auto ? 2 : 1;
      barCd -= dt;
      if (barCd <= 0) {
        barCd = auto ? 5 : 10;
        if (i >= runEnd) { newRun(); return; }
        const prev = price(); i++;
        flashDir = Math.sign(price() - prev); flash = 0.5;
        if (auto && !humanPaused) aiThink();
        updateScores();
      }
    } else {
      pollCd--;
      if (pollCd <= 0) { pollCd = POLL_TICKS; fetchLive(); }
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
    W = canvas.width; H = canvas.height; render();
  }

  function render() {
    g2d.clearRect(0, 0, W, H);
    g2d.fillStyle = '#0c1018'; g2d.fillRect(0, 0, W, H);
    const s = S(), d = Dt(), c = cur();
    if (!s.length) return;
    const pad = Math.round(W * 0.04);
    const headH = Math.round(H * 0.15);
    const chartTop = headH, chartH = Math.round(H * 0.46), chartBot = chartTop + chartH;
    const up = '#26c281', down = '#e0533d';

    // ヘッダー
    g2d.textAlign = 'left'; g2d.textBaseline = 'alphabetic';
    g2d.fillStyle = '#9fb0c0'; g2d.font = `bold ${Math.round(headH * 0.30)}px sans-serif`;
    g2d.fillText('USD/JPY', pad, chartTop - headH * 0.42);
    if (mode === 'live') { g2d.fillStyle = liveStatus === 'LIVE' ? '#26c281' : '#e0a93d'; g2d.font = `bold ${Math.round(headH * 0.2)}px sans-serif`; g2d.fillText('● ' + liveStatus, pad + Math.round(headH * 1.7), chartTop - headH * 0.44); }
    g2d.fillStyle = '#5f6b78'; g2d.font = `${Math.round(headH * 0.2)}px sans-serif`;
    g2d.fillText(mode === 'sim' ? ('過去ｼﾐｭﾚｰｼｮﾝ  ' + (d[c] || '')) : ('ライブ  ' + (liveUpdated || '取得中')), pad, chartTop - headH * 0.14);
    const col = flashDir > 0 ? up : flashDir < 0 ? down : '#e8edf2';
    g2d.textAlign = 'right'; g2d.fillStyle = col; g2d.font = `bold ${Math.round(headH * 0.5)}px sans-serif`;
    g2d.fillText(price().toFixed(3), W - pad, chartTop - headH * 0.18);

    // チャート
    const a = Math.max(0, c - WIN), b = c;
    let lo = Infinity, hi = -Infinity;
    for (let k = a; k <= b; k++) { if (s[k] < lo) lo = s[k]; if (s[k] > hi) hi = s[k]; }
    if (pos !== 0) { lo = Math.min(lo, entry); hi = Math.max(hi, entry); }
    const sp = Math.max(0.05, hi - lo), mg = sp * 0.12; lo -= mg; hi += mg;
    const X = (k: number) => pad + (b === a ? 0 : (k - a) / (b - a)) * (W - pad * 2);
    const Y = (p: number) => chartTop + (1 - (p - lo) / (hi - lo)) * chartH;

    g2d.strokeStyle = 'rgba(120,150,180,0.12)'; g2d.lineWidth = 1;
    for (let gl = 0; gl <= 4; gl++) { const yy = chartTop + (gl / 4) * chartH; g2d.beginPath(); g2d.moveTo(pad, yy); g2d.lineTo(W - pad, yy); g2d.stroke(); g2d.fillStyle = '#46505c'; g2d.textAlign = 'left'; g2d.font = `${Math.round(headH * 0.18)}px sans-serif`; g2d.fillText((hi - (gl / 4) * (hi - lo)).toFixed(2), pad + 2, yy - 2); }

    if (pos !== 0) { g2d.strokeStyle = pos > 0 ? 'rgba(38,194,129,0.6)' : 'rgba(224,83,61,0.6)'; g2d.lineWidth = 1; g2d.setLineDash([5, 4]); g2d.beginPath(); g2d.moveTo(pad, Y(entry)); g2d.lineTo(W - pad, Y(entry)); g2d.stroke(); g2d.setLineDash([]); }

    // ローソク足（実終値を CP 本ごとに集約：始=最初/高=最大/安=最小/終=最後）
    const pixPerDay = (W - pad * 2) / Math.max(1, b - a);
    const bodyW = Math.max(2, pixPerDay * CP * 0.66);
    for (let g0 = a; g0 <= b; g0 += CP) {
      const g1 = Math.min(g0 + CP - 1, b);
      let o = s[g0], cl = s[g1], h = -Infinity, l = Infinity;
      for (let k = g0; k <= g1; k++) { if (s[k] > h) h = s[k]; if (s[k] < l) l = s[k]; }
      const cx = X((g0 + g1) / 2), cc2 = cl >= o ? up : down;
      g2d.strokeStyle = cc2; g2d.lineWidth = Math.max(1, W * 0.004);
      g2d.beginPath(); g2d.moveTo(cx, Y(h)); g2d.lineTo(cx, Y(l)); g2d.stroke();
      g2d.fillStyle = cc2;
      const yo = Y(o), yc = Y(cl);
      g2d.fillRect(cx - bodyW / 2, Math.min(yo, yc), bodyW, Math.max(1.5, Math.abs(yc - yo)));
    }

    // 移動平均線（終値ベース）
    const drawMA = (n: number, color: string) => {
      g2d.strokeStyle = color; g2d.lineWidth = Math.max(1.2, W * 0.0045); g2d.lineJoin = 'round'; g2d.beginPath(); let started = false;
      for (let k = a; k <= b; k++) { if (k < n - 1) continue; let sum = 0; for (let j = k - n + 1; j <= k; j++) sum += s[j]; const x = X(k), y = Y(sum / n); if (!started) { g2d.moveTo(x, y); started = true; } else g2d.lineTo(x, y); }
      g2d.stroke();
    };
    drawMA(MA1, '#5bc8ff'); drawMA(MA2, '#f0b24a');

    // 現在値の発光ドット
    g2d.save(); g2d.shadowColor = col; g2d.shadowBlur = W * (mode === 'live' ? 0.05 : 0.03) * (1 + flash); g2d.fillStyle = col; g2d.beginPath(); g2d.arc(X(b), Y(price()), Math.max(2.5, W * 0.012), 0, Math.PI * 2); g2d.fill(); g2d.restore();

    // 売買マーカー
    for (const t of trades) { if (t.i < a || t.i > b) continue; const x = X(t.i), y = Y(t.price); g2d.fillStyle = t.dir > 0 ? up : down; g2d.beginPath(); if (t.dir > 0) { g2d.moveTo(x, y - W * 0.02); g2d.lineTo(x - W * 0.014, y + W * 0.01); g2d.lineTo(x + W * 0.014, y + W * 0.01); } else { g2d.moveTo(x, y + W * 0.02); g2d.lineTo(x - W * 0.014, y - W * 0.01); g2d.lineTo(x + W * 0.014, y - W * 0.01); } g2d.closePath(); g2d.fill(); }

    // MA 凡例
    g2d.textAlign = 'right'; g2d.font = `${Math.round(headH * 0.18)}px sans-serif`;
    g2d.fillStyle = '#5bc8ff'; g2d.fillText('MA' + MA1, W - pad - Math.round(headH * 0.9), chartTop + headH * 0.2);
    g2d.fillStyle = '#f0b24a'; g2d.fillText('MA' + MA2, W - pad, chartTop + headH * 0.2);

    // 損益パネル
    const py = chartBot + Math.round(H * 0.03);
    const u = unrealized(), tot = total();
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
    row('確定損益(累計)', lifePnL, py + H * 0.18);
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
      wrapEl.style.display = 'flex'; ctrlEl.style.display = 'inline-flex'; syncModeBtn();
      if (mode === 'sim') { if (i === 0) newRun(); } else { if (liveSeries.length === 0) startLive(); }
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
    relayout, reset: () => { if (mode === 'sim') newRun(); else startLive(); }, isOver: () => false,
    _tick: tick,
    _state: () => ({ mode, i: cur(), date: Dt()[cur()], price: price(), pos, entry, lifePnL: Math.round(lifePnL), unrealized: Math.round(unrealized()), total: Math.round(total()), equity: Math.round(equity()), session, best: Math.round(best), trades: trades.length, liveStatus, liveUpdated }),
  };
};
