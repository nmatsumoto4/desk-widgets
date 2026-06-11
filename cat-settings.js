// 猫の設定画面。localStorage に保存し、storage イベント経由で全猫に即時反映される。

(() => {
  const SETTINGS_KEY = 'cat.settings';
  const EVENT_KEY = 'cat.eventPing';

  const DEFAULTS = {
    type: 'mike', name: 'たま', scale: 1,
    follow: true, alwaysOnTop: true, autostart: false, notify: true
  };

  function load() {
    try {
      return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
    } catch { return { ...DEFAULTS }; }
  }

  let S = load();

  const typeSel = document.getElementById('set-type');
  for (const t of CAT_TYPES) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    typeSel.appendChild(opt);
  }

  const nameInput = document.getElementById('set-name');
  const scaleSel = document.getElementById('set-scale');
  const followCb = document.getElementById('set-follow');
  const aotCb = document.getElementById('set-aot');
  const autostartCb = document.getElementById('set-autostart');
  const notifyCb = document.getElementById('set-notify');

  function syncForm() {
    typeSel.value = S.type;
    nameInput.value = S.name;
    scaleSel.value = String(S.scale);
    followCb.checked = S.follow;
    aotCb.checked = S.alwaysOnTop;
    autostartCb.checked = S.autostart;
    notifyCb.checked = S.notify;
  }

  function save() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
    if (window.catAPI) {
      window.catAPI.setAutostart(S.autostart);
    }
  }

  typeSel.addEventListener('change', () => { S.type = typeSel.value; save(); });
  nameInput.addEventListener('change', () => { S.name = nameInput.value || 'たま'; save(); });
  scaleSel.addEventListener('change', () => { S.scale = Number(scaleSel.value); save(); });
  followCb.addEventListener('change', () => { S.follow = followCb.checked; save(); });
  aotCb.addEventListener('change', () => { S.alwaysOnTop = aotCb.checked; save(); });
  autostartCb.addEventListener('change', () => { S.autostart = autostartCb.checked; save(); });
  notifyCb.addEventListener('change', () => { S.notify = notifyCb.checked; save(); });

  // イベントテスト：localStorage に書き込むと storage イベントで全猫が反応する
  document.getElementById('event-btns').addEventListener('click', (e) => {
    const ev = e.target.dataset && e.target.dataset.ev;
    if (!ev) return;
    localStorage.setItem(EVENT_KEY, JSON.stringify({ type: ev, ts: Date.now() }));
  });

  document.getElementById('close-btn').addEventListener('click', () => window.close());

  // 他ウィンドウ（猫のメニュー等）からの変更を反映
  window.addEventListener('storage', (e) => {
    if (e.key === SETTINGS_KEY) { S = load(); syncForm(); }
  });

  syncForm();
})();
