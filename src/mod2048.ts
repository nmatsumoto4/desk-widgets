// 2048 ウィジェットモジュール（旧 renderer.js のゲーム部分）
// app.js から共通インターフェース（show/hide/setAuto/key/relayout/reset）で呼ばれる

window.createWidget2048 = function (ctx) {
  const SIZE = window.GAME_SIZE;
  const GAP = 6;
  const AI_INTERVAL_MS = 120;
  const RESTART_TICKS = 7;
  const BEST_KEY = 'widget2048.best';
  const GAMES_KEY = 'widget2048.games';

  const boardEl = document.getElementById('board');

  const game = new Game();
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let games = Number(localStorage.getItem(GAMES_KEY) || 0);
  let timer = null;
  let restartCountdown = -1;
  const tileEls = new Map();

  function cellSize() {
    return (boardEl.clientWidth - GAP * (SIZE + 1)) / SIZE;
  }

  function cellPos(r, c, size) {
    return { left: GAP + c * (size + GAP), top: GAP + r * (size + GAP) };
  }

  function buildBackground() {
    boardEl.querySelectorAll('.cell-bg').forEach((el) => el.remove());
    const size = cellSize();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const el = document.createElement('div');
        el.className = 'cell-bg';
        const { left, top } = cellPos(r, c, size);
        Object.assign(el.style, {
          width: `${size}px`, height: `${size}px`,
          left: `${left}px`, top: `${top}px`
        });
        boardEl.appendChild(el);
      }
    }
  }

  function fontSize(value, size) {
    const len = String(value).length;
    if (len <= 2) return size * 0.45;
    if (len === 3) return size * 0.38;
    if (len === 4) return size * 0.3;
    return size * 0.24;
  }

  function render() {
    const size = cellSize();
    const alive = new Set();

    for (const t of game.tiles) {
      alive.add(t.id);
      let el = tileEls.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tile' + (t.isNew ? ' tile-new' : '');
        boardEl.appendChild(el);
        tileEls.set(t.id, el);
      }
      el.textContent = t.value;
      el.dataset.v = t.value;
      el.classList.toggle('tile-super', t.value > 32768);
      const { left, top } = cellPos(t.r, t.c, size);
      Object.assign(el.style, {
        width: `${size}px`, height: `${size}px`,
        left: `${left}px`, top: `${top}px`,
        fontSize: `${fontSize(t.value, size)}px`
      });
    }

    for (const [id, el] of tileEls) {
      if (!alive.has(id)) {
        el.remove();
        tileEls.delete(id);
      }
    }

    if (game.score > best) {
      best = game.score;
      localStorage.setItem(BEST_KEY, String(best));
    }
    ctx.setScores(game.score, best, games > 0 ? `${games} 周目` : '');
  }

  function reset() {
    game.reset();
    tileEls.forEach((el) => el.remove());
    tileEls.clear();
    restartCountdown = -1;
    ctx.hideOverlay();
    render();
  }

  function aiStep() {
    if (game.over) {
      // 永遠に動き続ける：AI ループ自身のティックで数えて自動リスタート
      if (restartCountdown < 0) {
        games++;
        localStorage.setItem(GAMES_KEY, String(games));
        ctx.showOverlay('GAME OVER', '自動リスタート…');
        restartCountdown = RESTART_TICKS;
      } else if (--restartCountdown <= 0) {
        reset();
      }
      return;
    }

    const dir = window.AI.bestMove(game.grid());
    if (dir) {
      const before = game.score;
      game.move(dir);
      if (window.SFX && game.score > before) window.SFX.merge(game.maxTile());
      render();
    } else {
      game.over = true;
    }
  }

  const KEY_DIRS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'
  };

  return {
    name: '2048',
    show() {
      boardEl.style.display = 'block';
      buildBackground();
      render();
    },
    hide() {
      clearInterval(timer);
      timer = null;
      boardEl.style.display = 'none';
    },
    setAuto(on) {
      if (on) {
        if (timer === null) timer = setInterval(aiStep, AI_INTERVAL_MS);
      } else {
        clearInterval(timer);
        timer = null;
        if (game.over) ctx.showOverlay('GAME OVER', '矢印キーでリスタート');
      }
    },
    key(e) {
      const dir = KEY_DIRS[e.key];
      if (!dir) return false;
      if (game.over) {
        reset();
      } else {
        game.move(dir);
        if (game.over) ctx.showOverlay('GAME OVER', '矢印キーでリスタート');
        render();
      }
      return true;
    },
    relayout() {
      buildBackground();
      render();
    },
    reset,
    isOver: () => game.over
  };
};
