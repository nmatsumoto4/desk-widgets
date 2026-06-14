// 効果音（Web Audio でその場生成・アセット不要）。各ゲームから window.SFX.xxx() を呼ぶ。
// 常時自動プレイなので音量は控えめ＋同種は間引き、ミュート切替を用意する。

window.SFX = (() => {
  const MUTE_KEY = 'widget.muted';
  let ctx = null, master = null;
  let muted = localStorage.getItem(MUTE_KEY) === '1';
  const last = {};

  function ensure() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.20;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }
  function resumeIfNeeded() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  // 単音（周波数スライド・波形指定可）
  function tone(freq, dur, type, vol, slideTo?) {
    if (muted) return;
    ensure(); if (!ctx) return; resumeIfNeeded();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // ノイズ（爆発・破壊感）
  function noise(dur, vol, cutoff) {
    if (muted) return;
    ensure(); if (!ctx) return; resumeIfNeeded();
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.max(1, (ctx.sampleRate * dur) | 0), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff || 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(master);
    n.start(t); n.stop(t + dur);
  }
  // 同種の連発を間引く
  function thr(key, ms, fn) {
    let now;
    try { now = performance.now(); } catch (e) { now = Date.now(); }
    if (now - (last[key] || 0) < ms) return;
    last[key] = now; fn();
  }
  const seq = (notes) => notes.forEach(([f, d, delay]) => setTimeout(() => tone(f, d, 'square', 0.5), delay));

  return {
    setMuted(m) { muted = m; localStorage.setItem(MUTE_KEY, m ? '1' : '0'); if (!m) ensure(); },
    isMuted() { return muted; },
    toggle() { this.setMuted(!muted); return muted; },

    // ---- 共通/各ゲーム用 ----
    merge(v) { tone(280 + Math.min(10, Math.log2(v || 2)) * 90, 0.12, 'sine', 0.7); }, // 2048
    move() { thr('move', 70, () => tone(160, 0.04, 'square', 0.22)); },
    land() { thr('land', 50, () => tone(150, 0.07, 'sine', 0.4)); },              // 着地
    pop(chain) { tone(360 + (chain || 1) * 80, 0.13, 'square', 0.6, 540 + (chain || 1) * 110); }, // ぷよ消し（連鎖で上昇）
    shoot() { thr('shoot', 80, () => tone(880, 0.06, 'sawtooth', 0.25, 280)); },  // インベーダー
    hit() { thr('hit', 30, () => tone(420, 0.05, 'square', 0.35, 180)); },        // 命中
    explode() { thr('explode', 40, () => noise(0.28, 0.55, 700)); },              // 爆発
    eat() { tone(560, 0.07, 'sine', 0.55, 880); },                               // スネーク
    die() { tone(320, 0.45, 'sawtooth', 0.5, 70); },                             // ミス/ゲームオーバー
    bounce() { thr('bounce', 45, () => tone(430, 0.035, 'square', 0.2)); },       // ブロック崩し反射
    brick() { thr('brick', 22, () => tone(500, 0.045, 'square', 0.35, 660)); },   // ブロック破壊
    item() { tone(660, 0.15, 'sine', 0.5, 1180); },                              // アイテム取得
    clearLine() { tone(480, 0.18, 'square', 0.5, 1000); },                       // テトリス消去
    levelup() { seq([[523, 0.1, 0], [784, 0.14, 90]]); },                         // レベルアップ
    win() { seq([[523, 0.1, 0], [659, 0.1, 100], [784, 0.2, 200]]); }            // クリア/勝利
  };
})();
