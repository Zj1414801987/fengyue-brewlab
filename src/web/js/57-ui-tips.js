/* ============================================================================
 * 风月酿研所 — 57-ui-tips.js
 * ----------------------------------------------------------------------------
 * 职责：知识卡（Tips）的展示与"四层关闭"状态机。
 *   卡片内容 = 分类图标 + 标题 + 正文 + 三个动作（知道了 / 今天不再 / 不再这类）
 *
 * 四层关闭（语义严格区分，别混）：
 *   L1  × 或「知道了」   → 只移除 DOM，不记录任何状态（用户只是这会儿不想看）
 *   L2  「今天不再提示」  → tipsSnoozeUntil = 次日 0 点时间戳
 *   L3  「不再显示这类」  → tipsOffCats 追加该类目（并记 seen，重开该类也不再弹这条）
 *   L4  设置页总开关      → tipsEnabled = false
 *
 * 触发时机（不是随手乱弹）：
 *   recipeSaved / batchSaved → 只抽 practical
 *   viewChanged              → 抽 history / trivia
 *   首次进入 15 秒后          → 抽 history
 *
 * 冷却：全局 tipsLastShownAt + tipsFrequency 窗口（low 30min / normal 10min / high 4min），
 *      每会话上限 2/4/8，同一 viewId 5 分钟内不重复。
 * 去重：tipsSeen = { tipId: 时间戳 }，上限 200 条，超了裁最旧的。
 *
 * 位置：左下贴底通栏。右下被 .toasts{right:18px;bottom:18px;z-index:200} 占了，
 *      放过去必然叠在一起。
 *
 * 依赖：BREW.Store（settings.tips* 扁平键）、BREW.DB.tips（可缺失）
 *       BREW.Bus（可缺失）
 * 对外：BREW.UI.Tips.{init, hide, maybeShow, isEnabled}
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, icon = UI.icon;

  /* ======================================================================
   * A. 设置读写（扁平 key，与 58-ui-settings.js 的 SCHEMA 一一对应）
   * ====================================================================*/

  function cfg(key, def) {
    var S = UI.Settings;
    if (S && typeof S.get === 'function') {
      try { return S.get(key); } catch (e) { /* 落到直接读 */ }
    }
    try {
      var v = UI.store.get('settings.' + key, undefined);
      return (v === undefined) ? def : v;
    } catch (e2) { return def; }
  }

  function save(key, val) {
    var S = UI.Settings;
    if (S && typeof S.set === 'function') {
      try { S.set(key, val); return; } catch (e) { /* 落到直接写 */ }
    }
    try { UI.store.set('settings.' + key, val); } catch (e2) { /* 存储不可用就只在内存里生效 */ }
  }

  /* ======================================================================
   * B. 常量
   * ====================================================================*/

  var FREQ = {
    low:    { win: 30 * 60 * 1000, cap: 2, label: '低' },
    normal: { win: 10 * 60 * 1000, cap: 4, label: '正常' },
    high:   { win: 4 * 60 * 1000,  cap: 8, label: '高' }
  };

  var CAT_META = {
    practical: { zh: '酿造实务', icon: 'flask' },
    history:   { zh: '啤酒史',   icon: 'clock' },
    trivia:    { zh: '冷知识',   icon: 'sparkle' }
  };

  var ALL_CATS = ['practical', 'history', 'trivia'];
  var VIEW_GAP = 5 * 60 * 1000;   /* 同一视图 5 分钟内不重复 */
  var SEEN_MAX = 200;
  var START_GRACE = 8 * 1000;     /* 启动 8 秒内不因 viewChanged 弹卡，避免开机就砸脸 */

  /* ======================================================================
   * C. 会话内状态（不落盘）
   * ====================================================================*/

  var startedAt = Date.now();
  var sessionShown = 0;
  var lastViewAt = {};
  var cursor = 0;           /* 轮转游标：不用 Math.random，保证可复现 */
  var lastPreviewed = '';   /* 设置页"试弹"刚看过的那条，自动弹卡跳过它一次 */
  var cardEl = null;
  var currentTip = null;

  /* ======================================================================
   * D. 数据
   * ====================================================================*/

  function tipsPool() {
    var d = (BREW.DB = BREW.DB || {});
    return Array.isArray(d.tips) ? d.tips : [];
  }

  function seenMap() {
    var m = cfg('tipsSeen', {});
    return (m && typeof m === 'object') ? m : {};
  }

  function offCats() {
    var a = cfg('tipsOffCats', []);
    return Array.isArray(a) ? a : [];
  }

  function enabledCats() {
    var a = cfg('tipsCats', ALL_CATS.slice());
    if (!Array.isArray(a) || !a.length) return ALL_CATS.slice();
    return a;
  }

  function isEnabled() {
    return cfg('tipsEnabled', true) !== false;
  }

  /* ======================================================================
   * E. 冷却与筛选
   * ====================================================================*/

  function windowOf() {
    var f = String(cfg('tipsFrequency', 'normal'));
    return FREQ[f] || FREQ.normal;
  }

  function canShow(cats, viewId) {
    if (!isEnabled()) return false;
    if (!tipsPool().length) return false;

    /* 类别交集：调用方想要的 ∩ 用户勾选的 ∩ 未被禁用的 */
    var want = intersect(intersect(cats, enabledCats()), ALL_CATS);
    var off = offCats();
    var usable = [];
    for (var i = 0; i < want.length; i++) if (off.indexOf(want[i]) < 0) usable.push(want[i]);
    if (!usable.length) return false;

    var now = Date.now();
    if (now < num(cfg('tipsSnoozeUntil', 0), 0)) return false;

    var w = windowOf();
    if (now - num(cfg('tipsLastShownAt', 0), 0) < w.win) return false;
    if (sessionShown >= w.cap) return false;

    if (viewId) {
      var last = lastViewAt[viewId] || 0;
      if (now - last < VIEW_GAP) return false;
    }
    return true;
  }

  function intersect(a, b) {
    var out = [];
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) >= 0 && out.indexOf(a[i]) < 0) out.push(a[i]);
    return out;
  }

  /** 在可用池里轮转取一条；一条都抽不到就返回 null（不硬弹） */
  function pick(cats, viewId) {
    var off = offCats();
    var seen = seenMap();
    var now = Date.now();
    var all = tipsPool();
    var pool = [];

    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      if (!t || !t.id || !t.title) continue;
      if (cats.indexOf(t.cat) < 0) continue;
      if (off.indexOf(t.cat) >= 0) continue;
      if (seen[t.id]) continue;            /* 看过的永不再弹 */
      if (t.id === lastPreviewed) continue; /* 刚在设置页预览过的，跳过这一轮 */
      pool.push(t);
    }
    if (!pool.length) return null;

    /* 轮转而不是随机：同一条在池子里的位置稳定，用户不会觉得"怎么又是它" */
    cursor = (cursor + 1) % pool.length;
    var chosen = pool[cursor];

    /* 同一视图里刚弹过的同类，换个类别再试一次 */
    if (viewId && lastViewAt[viewId] && now - lastViewAt[viewId] < VIEW_GAP) {
      for (var j = 0; j < pool.length; j++) {
        var k = (cursor + j) % pool.length;
        if (pool[k].id !== chosen.id) { chosen = pool[k]; break; }
      }
    }
    return chosen;
  }

  function recordShow(tip, viewId) {
    var seen = seenMap();
    seen[tip.id] = Date.now();
    /* 上限 200：按时间戳裁最旧的那几条 */
    var keys = [];
    for (var k in seen) if (Object.prototype.hasOwnProperty.call(seen, k)) keys.push(k);
    if (keys.length > SEEN_MAX) {
      keys.sort(function (a, b) { return num(seen[a], 0) - num(seen[b], 0); });
      var drop = keys.length - SEEN_MAX;
      for (var i = 0; i < drop; i++) delete seen[keys[i]];
    }
    save('tipsSeen', seen);
    save('tipsLastShownAt', Date.now());
    sessionShown++;
    if (viewId) lastViewAt[viewId] = Date.now();
  }

  /* ======================================================================
   * F. 卡片
   * ====================================================================*/

  function hide() {
    if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    cardEl = null;
    currentTip = null;
  }

  function nextMidnight() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() + 24 * 60 * 60 * 1000;
  }

  function paint(tip) {
    hide();
    currentTip = tip;

    var meta = CAT_META[tip.cat] || { zh: '知识', icon: 'info' };
    var el = document.createElement('aside');
    el.className = 'tipcard';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', '酿造知识卡');

    el.innerHTML =
      '<button type="button" class="tipcard__close" aria-label="关闭提示" title="关闭提示">' +
        icon('x', 15) +
      '</button>' +
      '<div class="tipcard__icon" aria-hidden="true">' + icon(meta.icon, 17) + '</div>' +
      '<div class="tipcard__main">' +
        '<div class="tipcard__cat">' + esc(meta.zh) + '</div>' +
        '<h3 class="tipcard__title">' + esc(tip.title) + '</h3>' +
        '<p class="tipcard__body">' + UI.md(tip.body || '') + '</p>' +
        '<div class="tipcard__actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-tip-act="ok">知道了</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-tip-act="today">今天不再提示</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-tip-act="cat">不再显示这类</button>' +
        '</div>' +
      '</div>';

    el.addEventListener('click', function (e) {
      var btn = e.target;
      var act = null;
      while (btn && btn !== el && btn.nodeType === 1) {
        if (btn.getAttribute && btn.getAttribute('data-tip-act')) { act = btn.getAttribute('data-tip-act'); break; }
        if (btn.classList && btn.classList.contains('tipcard__close')) { act = 'ok'; break; }
        btn = btn.parentNode;
      }
      if (!act) return;
      dismiss(act);
    });

    document.body.appendChild(el);
    cardEl = el;
  }

  /* ======================================================================
   * G. 四层关闭状态机
   * ====================================================================*/

  function dismiss(act) {
    var tip = currentTip;

    if (act === 'today') {
      /* L2：只封到明天 0 点。不写 seen —— 这是"今天别烦我"，不是"这条别给我看" */
      save('tipsSnoozeUntil', nextMidnight());
      hide();
      if (UI.Shell && UI.Shell.toast) UI.Shell.toast('今天不再弹出知识卡', 'ok', 2000);
      return;
    }

    if (act === 'cat' && tip) {
      /* L3：整类关掉 + 这一条也记为看过（用户重新打开该类时不该再撞见同一张） */
      var list = offCats().slice();
      if (list.indexOf(tip.cat) < 0) list.push(tip.cat);
      save('tipsOffCats', list);

      var seen = seenMap();
      seen[tip.id] = Date.now();
      save('tipsSeen', seen);

      hide();
      var zh = (CAT_META[tip.cat] && CAT_META[tip.cat].zh) || tip.cat;
      if (UI.Shell && UI.Shell.toast) {
        UI.Shell.toast('不再显示「' + zh + '」类知识卡，可在设置里恢复', 'ok', 3200);
      }
      return;
    }

    /* L1：只移除 DOM，一个字节都不落盘 */
    hide();
  }

  /* ======================================================================
   * H. 对外入口
   * ====================================================================*/

  /**
   * @param {string[]} cats 允许的类别
   * @param {string}   why  触发来源（只用于调试，不落盘）
   * @param {string}   viewId 当前视图 id，用于 5 分钟内去重
   */
  function maybeShow(cats, why, viewId) {
    try {
      if (!canShow(cats, viewId)) return false;
      var want = intersect(intersect(cats, enabledCats()), ALL_CATS);
      var off = offCats();
      var usable = [];
      for (var i = 0; i < want.length; i++) if (off.indexOf(want[i]) < 0) usable.push(want[i]);
      if (!usable.length) return false;

      var tip = pick(usable, viewId);
      if (!tip) return false;

      paint(tip);
      recordShow(tip, viewId);
      return true;
    } catch (e) {
      /* 知识卡是锦上添花的功能，任何异常都不能影响主流程 */
      if (root.console && console.warn) console.warn('[BrewLab] 知识卡展示失败', e);
      return false;
    }
  }

  function currentViewId() {
    var S = UI.Shell;
    if (S && typeof S.activeId === 'function') {
      try {
        var id = S.activeId();
        if (id) return id;
      } catch (e) { /* 落到 hash */ }
    }
    var nav = document.querySelector ? document.querySelector('.nav-item.is-active[data-view]') : null;
    if (nav) return nav.getAttribute('data-view') || '';
    return String((root.location && root.location.hash) || '').replace(/^#\/?/, '');
  }

  /* ======================================================================
   * I. 启动
   * ====================================================================*/

  function init() {
    if (!BREW.Bus || typeof BREW.Bus.on !== 'function') return;

    /* 保存配方 / 批次：用户刚完成一件事，愿意读一段实务建议 */
    BREW.Bus.on('recipeSaved', function () {
      maybeShow(['practical'], 'recipeSaved', currentViewId());
    });
    BREW.Bus.on('batchSaved', function () {
      maybeShow(['practical'], 'batchSaved', currentViewId());
    });

    /* 切视图：人已经在"看"的状态，历史与冷知识更合适 */
    BREW.Bus.on('viewChanged', function (payload) {
      if (Date.now() - startedAt < START_GRACE) return;
      var id = (payload && payload.id) || currentViewId();
      maybeShow(['history', 'trivia'], 'viewChanged', id);
    });

    /* 首次进入 15 秒：先给一条来历，建立"这软件懂酒"的第一印象 */
    root.setTimeout(function () {
      maybeShow(['history'], 'firstEnter', currentViewId());
    }, 15000);

    /* 数据后到（DB.tips 可能比本文件晚就绪）时不必重试：下一次触发自然会抽到 */
  }

  BREW.UI.Tips = {
    init: init,
    hide: hide,
    maybeShow: maybeShow,
    isEnabled: isEnabled,
    count: function () { return tipsPool().length; },
    /** 调试用：立刻展示某条（忽略冷却） */
    showById: function (id) {
      var all = tipsPool();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id) { paint(all[i]); return true; }
      }
      return false;
    },
    /**
     * 设置页「试弹一条」：用户显式点了按钮，所以
     *   · 不看冷却、不看开关、不看已读 —— 点了就该有反应
     *   · 按游标轮转全库，反复点会依次翻过去，不会一直给同一条
     *   · **不写 tipsSeen** —— 这是预览，不是"已送达"。
     *     否则用户点十次就把十条消耗掉了，之后自动弹卡再也抽不到东西。
     *     代价是可能和下一次自动弹卡撞车，用 lastPreviewed 兜住一次即可。
     */
    showOne: function (cat) {
      try {
        var all = tipsPool();
        var pool = [];
        for (var i = 0; i < all.length; i++) {
          var t = all[i];
          if (!t || !t.id || !t.title) continue;
          if (cat && t.cat !== cat) continue;
          pool.push(t);
        }
        if (!pool.length) return false;
        cursor = (cursor + 1) % pool.length;
        var tip = pool[cursor];
        paint(tip);
        lastPreviewed = tip.id;
        return true;
      } catch (e) {
        if (root.console && console.warn) console.warn('[BrewLab] 知识卡预览失败', e);
        return false;
      }
    }
  };

  UI.ready(init);

})(typeof window !== 'undefined' ? window : globalThis);
