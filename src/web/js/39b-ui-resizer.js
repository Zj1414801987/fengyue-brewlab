/* ============================================================================
 * 风月酿研所 — 39b-ui-resizer.js
 * ----------------------------------------------------------------------------
 * 职责：可拖动的分隔条（侧栏调宽、功能区调高）。
 *
 * 为什么要抽成组件而不是各写一遍：
 *   全站有三处要拖（左导航、酒标右侧面板、酿造记录的批次列表），
 *   另外功能区要能上下拖。四处的差别只有"轴 + 方向 + 上下限 + 存哪个键"，
 *   各写一遍就会出现"这一处能双击复位、那一处不能""这一处的键盘能调、
 *   那一处按了没反应"——用户不会觉得是四处的实现差异，只会觉得软件有的地方灵有的地方不灵。
 *
 * 四条统一行为：
 *   ① 拖：pointerdown 起算，setPointerCapture 保证手指移出元素也不丢
 *   ② 双击：回到默认值（默认值由调用方给，不猜）
 *   ③ 键盘：← → ↑ ↓ 各 16px，Shift 加速到 64px（无鼠标也能调，且不依赖拖拽）
 *   ④ 记忆：写 Store 的 settings.resizer.<key>，下次打开还是这个宽度
 *
 * 边界：min/max 是**像素**，由调用方按自己的场景给。滚动条一出现就会挤压内容，
 *   所以 min 不该小于"内部最窄控件 + 两侧内边距"，这个数只有调用方知道。
 *
 * 依赖：BREW.Store（可缺失，缺了就只生效不记忆）
 * 对外：BREW.UI.Resizer.attach(opts) → { el, set, get, reset, destroy }
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var R = UI.Resizer = UI.Resizer || {};

  var KEY_PREFIX = 'settings.resizer.';
  var STEP = 16;        /* 键盘单次 */
  var STEP_FAST = 64;   /* Shift + 方向键 */

  function store() { return BREW.Store || null; }

  function readSaved(key) {
    var s = store();
    if (!s || !key) return null;
    try {
      var v = s.get(KEY_PREFIX + key);
      return (typeof v === 'number' && isFinite(v)) ? v : null;
    } catch (e) { return null; }
  }

  function writeSaved(key, px) {
    var s = store();
    if (!s || !key) return;
    try { s.set(KEY_PREFIX + key, Math.round(px)); } catch (e) { /* 记不住不影响使用 */ }
  }

  function clamp(v, lo, hi) {
    if (lo !== undefined && v < lo) v = lo;
    if (hi !== undefined && v > hi) v = hi;
    return v;
  }

  /**
   * @param {Object} o
   *   handle   抓取条元素（必填）
   *   target   尺寸变化的目标元素（必填）
   *   axis     'x' 调宽 | 'y' 调高（默认 'x'）
   *   dir      1 = 向右/下拖变大；-1 = 反向（右侧面板的左手柄）（默认 1）
   *   min/max  像素上下限
   *   def      双击/复位用的默认值（必填，不猜）
   *   key      记忆键后缀（不给则只生效不记忆）
   *   prop     写到 target 的哪个样式属性，默认按 axis 取 width/height
   *   onResize 回调 (px) —— 画布类元素需要它自己重绘
   *   label    无障碍名称，如「调整左侧导航宽度」
   */
  R.attach = function (o) {
    if (!o || !o.handle || !o.target) return null;

    var handle = o.handle, target = o.target;
    var axis = o.axis === 'y' ? 'y' : 'x';
    var dir = o.dir === -1 ? -1 : 1;
    var prop = o.prop || (axis === 'x' ? 'width' : 'height');
    /* def 可以是数字，也可以是函数。
       函数形式解决"默认值随分辨率档变化"的问题：功能区在 1080 档是 92px、
       1440 档 96px、720 档 84px，侧栏同理。写死一个数字，双击复位时
       会把 720 档的 84 拽成 92——用户会以为复位是"乱跳"。
       传函数时每次复位都重新问一次"现在这一档的自然尺寸是多少"。 */
    var defArg = (o.def === undefined) ? null : o.def;
    function defValue() {
      if (typeof defArg === 'function') {
        try { return defArg(); } catch (e) { return null; }
      }
      return (typeof defArg === 'number') ? defArg : null;
    }
    /* 要量的元素可以不是要写的元素：
       左导航的宽度由 .app 的 grid-template-columns 读 --sidebar-w 决定，
       所以"写"要写 :root 的自定义属性，而"量"必须量 .sidebar 的实际宽度。
       两件事在同一个元素上做不成，所以分开。默认相同。 */
    var probe = o.measure || target;
    /* 自定义属性（--x）不能用 style[prop] 赋值，必须走 setProperty */
    var isVar = prop.indexOf('--') === 0;

    var cur = 0;
    var dragging = false;
    var startPos = 0, startSize = 0;

    function sizeOf() {
      var r = probe.getBoundingClientRect();
      return axis === 'x' ? r.width : r.height;
    }

    function write(px) {
      if (isVar) target.style.setProperty(prop, px + 'px');
      else target.style[prop] = px + 'px';
    }

    function apply(px, save) {
      cur = clamp(Math.round(px), o.min, o.max);
      write(cur);
      /* 拖动中的元素不该有过渡，否则手指停了它还在追。
         过渡写在目标元素上，所以清的是目标元素的 transition。 */
      if (dragging) target.style.transition = 'none';
      else target.style.transition = '';
      if (save) writeSaved(o.key, cur);
      if (typeof o.onResize === 'function') {
        try { o.onResize(cur); } catch (e) { /* 回调抛错不该让拖动卡住 */ }
      }
      return cur;
    }

    function onDown(e) {
      /* 只接主键 / 单指。右键菜单与双指缩放不参与拖动 */
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      startPos = axis === 'x' ? e.clientX : e.clientY;
      startSize = sizeOf();
      try { handle.setPointerCapture(e.pointerId); } catch (e2) { /* 老浏览器忽略 */ }
      handle.classList.add('is-dragging');
      document.body.classList.add(axis === 'x' ? 'is-resizing-x' : 'is-resizing-y');
      e.preventDefault();
    }

    function onMove(e) {
      if (!dragging) return;
      var now = axis === 'x' ? e.clientX : e.clientY;
      apply(startSize + (now - startPos) * dir, false);
      e.preventDefault();
    }

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (e2) { /* ignore */ }
      handle.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing-x', 'is-resizing-y');
      apply(cur, true);
    }

    function onDbl() {
      var d = defValue();
      if (d === null) return;
      apply(d, true);
    }

    function onKey(e) {
      var dec = (axis === 'x' && e.key === 'ArrowLeft') || (axis === 'y' && e.key === 'ArrowUp');
      var inc = (axis === 'x' && e.key === 'ArrowRight') || (axis === 'y' && e.key === 'ArrowDown');
      if (!dec && !inc) {
        /* Home 复位：比双击更好记，也不用摸鼠标 */
        if (e.key === 'Home') {
          var dh = defValue();
          if (dh !== null) { apply(dh, true); e.preventDefault(); }
        }
        return;
      }
      var step = e.shiftKey ? STEP_FAST : STEP;
      apply(cur + (inc ? step : -step) * dir, true);
      e.preventDefault();
    }

    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
    handle.addEventListener('dblclick', onDbl);
    handle.addEventListener('keydown', onKey);

    /* 无障碍：拖拽条是可聚焦的 separator。
       没有这两个属性时，键盘用户永远调不到它——只能看着鼠标用户调。 */
    if (!handle.hasAttribute('tabindex')) handle.setAttribute('tabindex', '0');
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
    if (o.label) handle.setAttribute('aria-label', o.label);

    /* 初始值：**存过才写，没存过什么都不写。**
       这一条踩过坑：原来无脑把当前尺寸写成内联值，于是"用户没拖过"也变成了
       "用户拖到了这个宽度"——预设分辨率里的侧栏 200px / 功能区 84px 从此失效，
       切档时界面不动。表现是"设置里换了分辨率，界面没反应"，
       而实际原因在一个八百行外的拖动组件里。
       没存过就只记下当前值（供双击复位的基准用），让 CSS 说了算。 */
    var saved = readSaved(o.key);
    if (saved !== null) apply(saved, false);
    else cur = Math.round(sizeOf());

    return {
      el: handle,
      get: function () { return cur; },
      set: function (px) { return apply(px, true); },
      reset: function () {
        var dv = defValue();
        if (dv !== null) apply(dv, true);
        return cur;
      },
      /** 换分辨率档时用：把当前宽度夹进新的带宽，保留用户拖过的意图，
          但不允许"在 720P 上留 420px 侧栏"这种把正文挤没的情况。 */
      clampTo: function (lo, hi) {
        var v = clamp(cur, lo, hi);
        return (v === cur) ? cur : apply(v, true);
      },
      destroy: function () {
        handle.removeEventListener('pointerdown', onDown);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        handle.removeEventListener('dblclick', onDbl);
        handle.removeEventListener('keydown', onKey);
      }
    };
  };

  /** 拖动中给 body 加光标与禁选，避免拖到一半把文字选蓝 */
  R.installGlobalStyle = function () {
    if (document.getElementById('resizer-global-style')) return;
    var st = document.createElement('style');
    st.id = 'resizer-global-style';
    st.textContent =
      'body.is-resizing-x,body.is-resizing-x *{cursor:col-resize!important;user-select:none!important}' +
      'body.is-resizing-y,body.is-resizing-y *{cursor:row-resize!important;user-select:none!important}' +
      '.resizer{position:relative;flex:0 0 auto;touch-action:none}' +
      '.resizer::after{content:"";position:absolute;inset:0;background:transparent;transition:background 120ms}' +
      '.resizer:hover::after,.resizer:focus-visible::after,.resizer.is-dragging::after{background:var(--amber-line)}' +
      '.resizer:focus-visible{outline:2px solid var(--amber);outline-offset:-2px}' +
      '.resizer--x{width:5px;cursor:col-resize;margin-right:-3px;z-index:3}' +
      '.resizer--y{height:5px;cursor:row-resize;margin-bottom:-3px;z-index:3}';
    document.head.appendChild(st);
  };

})(typeof window !== 'undefined' ? window : globalThis);
