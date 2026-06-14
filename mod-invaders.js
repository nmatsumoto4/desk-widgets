// インベーダー ウィジェットモジュール（描画・進行ループ・AI 自動プレイ）
//
// ・自機が下部、敵編隊が上部。敵を全滅させるとウェーブクリア → レベルアップ。
// ・レベルが上がるほど敵が速く・多く・よく撃つようになり難易度が上がる。
// ・AI は「迫る敵弾を避ける」を最優先しつつ、敵の真下に回り込んで撃ち続ける。
// ・自機が全滅（残機 0）または敵が最下段に到達するとゲームオーバー →
//   少し待って Lv.1 から自動リスタートし、永遠に動き続ける。
// ・手動モード：← → 移動、↑ ショット。
//
// 論理座標は 100 × 130 の固定フィールド。canvas へはレターボックスで等倍スケール。

window.createWidgetInvaders = function (ctx) {
  const FW = 100, FH = 130;
  const TICK_MS = 33;
  const RESTART_TICKS = Math.round(1400 / TICK_MS);
  const BEST_KEY = 'widgetInv.best';
  const BESTLV_KEY = 'widgetInv.bestLevel';

  const wrapEl = document.getElementById('invaders');
  const canvas = document.getElementById('invaders-canvas');
  const g2d = canvas.getContext('2d');

  const COLS = 6;
  const INV_W = 9, INV_H = 6;
  const SPACE_X = 13.5, SPACE_Y = 10;
  const PLAYER_W = 11, PLAYER_H = 5;
  const PLAYER_Y = FH - 9;

  const ROW_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db'];

  // ピクセル絵（X=塗り）。2 フレームで脚を動かす
  const INV_FRAMES = [
    [
      '..X..X..',
      '.XXXXXX.',
      'XX.XX.XX',
      'XXXXXXXX',
      '.X.XX.X.',
      'X.X..X.X'
    ],
    [
      '..X..X..',
      '.XXXXXX.',
      'XX.XX.XX',
      'XXXXXXXX',
      '..X..X..',
      '.X.XX.X.'
    ]
  ];
  const SHIP = [
    '....XX....',
    '...XXXX...',
    '.XXXXXXXX.',
    'XXXXXXXXXX'
  ];

  let level = 1, score = 0, lives = 3;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let bestLevel = Number(localStorage.getItem(BESTLV_KEY) || 1);
  let player = { x: FW / 2, dir: 0 };
  let invaders = [];
  let swarmDir = 1;
  let pBullets = [];
  let iBullets = [];
  let state = 'play';        // play | waveclear | gameover
  let auto = false;
  let timer = null;
  let lastT = 0;
  let fireCd = 0;            // 自機ショットのクールダウン（秒）
  let enemyFireCd = 1;       // 敵発砲タイマー（秒）
  let invuln = 0;            // 被弾後の無敵（秒）
  let animT = 0;
  let restartCountdown = -1;
  let waveTicks = 0;
  let manualFire = false;

  function rand(n) { return Math.floor(Math.random() * n); }

  function rowsForLevel(lv) {
    return Math.min(3 + Math.floor((lv - 1) / 3), 5);
  }

  function spawnWave() {
    invaders = [];
    const rows = rowsForLevel(level);
    const blockW = (COLS - 1) * SPACE_X;
    const startX = (FW - blockW) / 2;
    const startY = 11 + Math.min(level - 1, 6) * 0.7; // レベルが上がると少しずつ開始位置が下がる
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        invaders.push({
          x: startX + c * SPACE_X,
          y: startY + r * SPACE_Y,
          col: c, row: r, alive: true
        });
      }
    }
    swarmDir = 1;
    pBullets = [];
    iBullets = [];
    enemyFireCd = Math.max(0.5, 1.4 - level * 0.1);
  }

  function resetGame() {
    level = 1; score = 0; lives = 3;
    player.x = FW / 2;
    state = 'play';
    restartCountdown = -1;
    invuln = 0;
    ctx.hideOverlay();
    spawnWave();
    updateScores();
  }

  function updateScores() {
    if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
    if (level > bestLevel) { bestLevel = level; localStorage.setItem(BESTLV_KEY, String(bestLevel)); }
    const hearts = lives > 0 ? '♥'.repeat(lives) : '';
    ctx.setScores(score, best, `Lv.${level}  ${hearts}`);
  }

  function aliveInvaders() { return invaders.filter((v) => v.alive); }

  // 各列の最前（最も下）の敵だけが撃てる
  function frontLine() {
    const front = {};
    for (const v of invaders) {
      if (!v.alive) continue;
      if (!front[v.col] || v.y > front[v.col].y) front[v.col] = v;
    }
    return Object.values(front);
  }

  function enemyBulletSpeed() { return 24 + level * 2.2; }

  function swarmSpeed() {
    const alive = aliveInvaders().length;
    const total = COLS * rowsForLevel(level);
    const frac = total > 0 ? alive / total : 1;
    const base = 5 + level * 1.3;
    return base * (1 + (1 - frac) * 1.4); // 残りが少ないほど加速
  }

  function fireEnemy() {
    const front = frontLine();
    if (front.length === 0) return;
    const shots = 1 + (level >= 6 ? 1 : 0) + (level >= 12 ? 1 : 0);
    for (let i = 0; i < shots; i++) {
      const v = front[rand(front.length)];
      iBullets.push({ x: v.x + INV_W / 2, y: v.y + INV_H });
    }
  }

  // ---- AI ----
  // 位置 cx が敵弾に対して安全か（自機 Y に弾が届く頃に重ならないか）を判定する
  const SAFE_MARGIN = 9;       // 弾の x からこれ以上離れていれば安全
  const DANGER_TIME = 1.1;     // 何秒先までの弾を脅威とみなすか

  function dangerAt(cx) {
    // 直近で最も近い脅威までの距離（小さいほど危険）。脅威なしなら Infinity
    let worst = Infinity;
    const vy = enemyBulletSpeed();
    for (const b of iBullets) {
      const t = (PLAYER_Y - b.y) / vy;
      if (t < -0.05 || t > DANGER_TIME) continue; // すでに通過 or まだ遠い
      worst = Math.min(worst, Math.abs(cx - b.x));
    }
    return worst;
  }

  function aiThink(dt) {
    const cx = player.x + PLAYER_W / 2;
    const alive = aliveInvaders();

    // 候補位置：各敵の真下（撃つため）＋全幅スイープ（純粋回避用）
    const candidates = [];
    for (const v of alive) candidates.push(v.x + INV_W / 2);
    for (let x = PLAYER_W / 2; x <= FW - PLAYER_W / 2; x += 3) candidates.push(x);

    // 各候補位置で「狙える最も下段の敵」を求める
    function targetAt(c) {
      let t = null;
      for (const v of alive) {
        if (Math.abs(v.x + INV_W / 2 - c) < INV_W * 0.5) { // 確実に当たる幅だけ
          if (!t || v.y > t.y) t = v;
        }
      }
      return t;
    }

    // 安全（dangerAt > SAFE_MARGIN）な候補のうち、
    // 「最も下段の敵を撃てる位置」を優先し、同点なら現在地から近い位置を選ぶ
    let best = cx, bestCost = Infinity;
    for (const c of candidates) {
      if (c < PLAYER_W / 2 || c > FW - PLAYER_W / 2) continue;
      if (dangerAt(c) <= SAFE_MARGIN) continue; // 危険な位置は除外
      const t = targetAt(c);
      // 下段の敵ほど低コスト（撃って編隊の落下を食い止める）。撃てない位置は強い加点
      const cost = (t ? (FH - t.y) * 1.2 : 60) + Math.abs(c - cx) * 0.5;
      if (cost < bestCost) { bestCost = cost; best = c; }
    }

    // 安全地帯が無ければ「最も弾から遠い」位置へ逃げる
    if (bestCost === Infinity) {
      let far = -1;
      for (const c of candidates) {
        if (c < PLAYER_W / 2 || c > FW - PLAYER_W / 2) continue;
        const d = dangerAt(c);
        if (d > far) { far = d; best = c; }
      }
    }

    // 移動
    const speed = 74;
    const target = best - PLAYER_W / 2;
    if (Math.abs(target - player.x) > 0.4) {
      player.x += Math.sign(target - player.x) * Math.min(speed * dt, Math.abs(target - player.x));
    }

    // 発砲：今いる場所が安全で、敵の真下に概ね合っていれば撃つ
    if (fireCd <= 0 && dangerAt(player.x + PLAYER_W / 2) > SAFE_MARGIN) {
      const newCx = player.x + PLAYER_W / 2;
      if (alive.some((v) => Math.abs(v.x + INV_W / 2 - newCx) < INV_W * 0.45)) shoot();
    }
  }

  function shoot() {
    if (pBullets.length >= 4 || fireCd > 0) return;
    pBullets.push({ x: player.x + PLAYER_W / 2, y: PLAYER_Y - 1 });
    fireCd = 0.12;                 // 速射でなるべく早くクリア
    if (window.SFX) SFX.shoot();
  }

  function loseLife() {
    lives--;
    invuln = 1.2;
    iBullets = [];
    if (window.SFX) SFX.explode();
    updateScores();
    if (lives <= 0) gameOver();
  }

  function gameOver() {
    state = 'gameover';
    restartCountdown = RESTART_TICKS;
    ctx.showOverlay('GAME OVER', auto ? `Lv.${level} ・自動リスタート…` : `Lv.${level} ・キーで再開`);
  }

  // ---- 更新 ----
  function tick() {
    const now = (lastT || 0) + TICK_MS;
    // AI 自動運転中はゲーム全体をスピードアップ（早くクリアして次の面へ）
    const dt = TICK_MS / 1000 * (auto ? 1.9 : 1);
    lastT = now;
    animT += dt;

    if (state === 'gameover') {
      if (auto && restartCountdown >= 0 && --restartCountdown <= 0) resetGame();
      render();
      return;
    }
    if (state === 'waveclear') {
      if (--waveTicks <= 0) {
        level++;
        if (level % 3 === 0 && lives < 5) lives++; // 3 レベルごとに残機回復
        updateScores();
        spawnWave();
        ctx.hideOverlay();
        state = 'play';
      }
      render();
      return;
    }

    fireCd = Math.max(0, fireCd - dt);
    invuln = Math.max(0, invuln - dt);

    // AI / 手動
    if (auto) {
      aiThink(dt);
    } else {
      if (player.dir !== 0) player.x += player.dir * 60 * dt;
      if (manualFire) { shoot(); manualFire = false; }
      player.dir = 0;
    }
    player.x = Math.max(0, Math.min(FW - PLAYER_W, player.x));

    // 敵編隊の移動
    const alive = aliveInvaders();
    if (alive.length) {
      const dx = swarmDir * swarmSpeed() * dt;
      let minX = 1e9, maxX = -1e9;
      for (const v of alive) { minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x + INV_W); }
      if (minX + dx < 3 || maxX + dx > FW - 3) {
        // 端に当たったら下降して反転
        const drop = 2.5 + level * 0.25;
        for (const v of alive) v.y += drop;
        swarmDir *= -1;
      } else {
        for (const v of alive) v.x += dx;
      }
      // 自機の高さに到達したらゲームオーバー
      if (alive.some((v) => v.y + INV_H >= PLAYER_Y)) { gameOver(); render(); return; }
    }

    // 敵の発砲
    enemyFireCd -= dt;
    if (enemyFireCd <= 0) {
      fireEnemy();
      enemyFireCd = Math.max(0.4, 1.7 - level * 0.1) * (0.7 + Math.random() * 0.6);
    }

    // 弾の移動
    for (const b of pBullets) b.y -= 120 * dt;
    for (const b of iBullets) b.y += enemyBulletSpeed() * dt;

    // 衝突：自機弾 × 敵
    for (const b of pBullets) {
      for (const v of invaders) {
        if (!v.alive) continue;
        if (b.x >= v.x && b.x <= v.x + INV_W && b.y >= v.y && b.y <= v.y + INV_H) {
          v.alive = false;
          b.dead = true;
          if (window.SFX) SFX.hit();
          score += 10 + (rowsForLevel(level) - 1 - v.row) * 5;
          updateScores();
          break;
        }
      }
    }
    // 衝突：敵弾 × 自機
    if (invuln <= 0) {
      for (const b of iBullets) {
        if (b.x >= player.x && b.x <= player.x + PLAYER_W &&
            b.y >= PLAYER_Y && b.y <= PLAYER_Y + PLAYER_H) {
          b.dead = true;
          loseLife();
          break;
        }
      }
    }

    pBullets = pBullets.filter((b) => !b.dead && b.y > -2);
    iBullets = iBullets.filter((b) => !b.dead && b.y < FH + 2);

    // ウェーブクリア判定
    if (state === 'play' && aliveInvaders().length === 0) {
      score += 100 * level;
      if (window.SFX) SFX.levelup();
      updateScores();
      state = 'waveclear';
      waveTicks = Math.round((auto ? 320 : 900) / TICK_MS); // 自動運転中は素早く次の面へ
      ctx.showOverlay(`LEVEL ${level + 1}`, 'ウェーブクリア！');
    }

    render();
  }

  // ---- 描画 ----
  let scale = 3, offX = 0, offY = 0;

  function relayout() {
    const rect = wrapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    scale = Math.min(canvas.width / FW, canvas.height / FH);
    offX = (canvas.width - FW * scale) / 2;
    offY = (canvas.height - FH * scale) / 2;
    render();
  }

  function px(x) { return offX + x * scale; }
  function py(y) { return offY + y * scale; }

  function drawPattern(pat, x, y, w, h, color) {
    const cols = pat[0].length, rows = pat.length;
    const dw = (w * scale) / cols, dh = (h * scale) / rows;
    g2d.fillStyle = color;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (pat[r][c] === 'X') {
          g2d.fillRect(px(x) + c * dw, py(y) + r * dh, Math.ceil(dw), Math.ceil(dh));
        }
      }
    }
  }

  function render() {
    // 背景（キャンバス全体を宇宙色で塗りつぶし、レターボックスを目立たせない）
    g2d.fillStyle = '#0d0b1a';
    g2d.fillRect(0, 0, canvas.width, canvas.height);

    // 敵
    const frame = (Math.floor(animT * 2) % 2);
    for (const v of invaders) {
      if (!v.alive) continue;
      drawPattern(INV_FRAMES[frame], v.x, v.y, INV_W, INV_H, ROW_COLORS[v.row % ROW_COLORS.length]);
    }

    // 自機（被弾無敵中は点滅）
    if (!(invuln > 0 && Math.floor(animT * 12) % 2)) {
      drawPattern(SHIP, player.x, PLAYER_Y, PLAYER_W, PLAYER_H, '#e8e8f0');
    }

    // 弾
    g2d.fillStyle = '#9be8ff';
    for (const b of pBullets) g2d.fillRect(px(b.x) - scale * 0.4, py(b.y), scale * 0.8, scale * 3);
    g2d.fillStyle = '#ff7b7b';
    for (const b of iBullets) g2d.fillRect(px(b.x) - scale * 0.4, py(b.y), scale * 0.8, scale * 3);

    // 地上ライン
    g2d.fillStyle = '#3a8f4a';
    g2d.fillRect(px(0), py(PLAYER_Y + PLAYER_H + 1), FW * scale, scale * 0.8);
  }

  // ---- 共通インターフェース ----
  return {
    name: 'invaders',
    show() {
      wrapEl.style.display = 'flex';
      if (invaders.length === 0) resetGame();
      relayout();
      updateScores();
      lastT = 0;
      if (timer === null) timer = setInterval(tick, TICK_MS);
    },
    hide() {
      clearInterval(timer);
      timer = null;
      wrapEl.style.display = 'none';
    },
    setAuto(on) { auto = on; },
    key(e) {
      if (state === 'gameover') { resetGame(); return true; }
      if (state !== 'play') return true;
      if (e.key === 'ArrowLeft') player.dir = -1;
      else if (e.key === 'ArrowRight') player.dir = 1;
      else if (e.key === 'ArrowUp' || e.key === ' ') manualFire = true;
      else return false;
      return true;
    },
    relayout,
    reset: resetGame,
    isOver: () => state === 'gameover',
    // テスト用フック
    _tick: tick,
    _state: () => ({ state, level, score, lives, auto,
                     alive: aliveInvaders().length, pBullets: pBullets.length,
                     iBullets: iBullets.length, playerX: player.x })
  };
};
