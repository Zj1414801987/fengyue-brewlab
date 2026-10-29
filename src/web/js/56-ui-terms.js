/* ============================================================================
 * 风月酿研所 — 56-ui-terms.js
 * ----------------------------------------------------------------------------
 * 职责：术语的"两层阅读"。
 *   1. 悬停速览浮层（brief，延迟可配，400ms 默认）
 *   2. 完整术语卡（定义 / 作用 / 常见误解 / 公式 / 出处 / 相关术语）
 *
 * 边界：本文件**不负责**把正文里的词标成 <abbr class="term" data-term="…">，
 *       那是 BREW.Annotate（19-terms-annotate.js）的职责；这里只监听标注元素
 *       的事件并展示内容。另外还接管告警行尾的「为什么」按钮
 *       （[data-term-link]，由 42-ui-recipe.js 的 paintWarnings 渲染）。
 *
 * 依赖：BREW.UI（esc/icon/modal/store）、BREW.DB.glossary、BREW.DB.glossaryCats、
 *       BREW.Annotate.{hydrate,strip,setEnabled,getTerm}（缺失时只是没有标注）
 * 对外：BREW.UI.Terms.{setEnabled, hydrateNow, open, hidePreview, count, catName}
 *       BREW.UI.openTerm(id)
 *
 * 关键实现约束（架构结论）：
 *   浮层必须挂在 document.body + position:fixed。容器里的 .table-wrap{overflow-x:auto}
 *   与 .card{overflow:hidden} 会裁掉任何内部绝对定位元素，挂在视图里必被切。
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num;

  /* ======================================================================
   * A. 设置读取（58-ui-settings.js 提供默认值表，缺失时用本文件的兜底值）
   * ====================================================================*/

  function setting(key, def) {
    var S = UI.Settings;
    if (S && typeof S.get === 'function') {
      try { return S.get(key); } catch (e) { /* 落到下面的兜底 */ }
    }
    try {
      var v = UI.store.get('settings.' + key, undefined);
      return (v === undefined) ? def : v;
    } catch (e2) { return def; }
  }

  /* ======================================================================
   * B. 术语数据
   * ====================================================================*/

  var CAT_ZH = {
    mash: '糖化',
    ferment: '发酵',
    metric: '指标',
    process: '工艺',
    ingredient: '原料',
    water: '水化学',
    style: '风格'
  };

  /** 分类名优先取引擎里的 BREW.DB.glossaryCats（带配色），缺失时用本文件的兜底表 */
  function catMeta(cat) {
    var cats = (BREW.DB && BREW.DB.glossaryCats) || null;
    var m = cats && cats[cat];
    return {
      zh: (m && m.zh) ? m.zh : (CAT_ZH[cat] || (cat ? String(cat) : '术语')),
      color: (m && m.color) ? m.color : ''
    };
  }

  function glossary() {
    var d = (BREW.DB = BREW.DB || {});
    return Array.isArray(d.glossary) ? d.glossary : [];
  }

  function termById(id) {
    if (!id) return null;
    var A = BREW.Annotate;
    if (A && typeof A.getTerm === 'function') {
      try {
        var t0 = A.getTerm(id);
        if (t0) return t0;
      } catch (e) { /* 落到本地查找 */ }
    }
    var list = glossary();
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  /* ======================================================================
   * C. 文本处理
   * ----------------------------------------------------------------------
   * 术语库正文里用 **强调** 标注关键句（例如"**绝对浓度同样重要**"）。
   * 直接 esc 会把星号原样显示，所以转成 <strong>；顺序必须是先 esc 再替换，
   * 否则数据里的尖括号会变成标签。
   * ====================================================================*/

  function rich(text) {
    if (!text) return '';
    return esc(text)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function plain(text) {
    if (!text) return '';
    return String(text).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  }

  function subOf(t) {
    var parts = [];
    if (t.zh) parts.push(t.zh);
    if (t.en) parts.push(t.en);
    return parts.join(' · ');
  }

  /* ======================================================================
   * D. 悬停浮层
   * ====================================================================*/

  var pop = null;            /* 延迟创建的浮层节点 */
  var currentAnchor = null;  /* 当前浮层指向的标注元素 */
  var pendingAnchor = null;  /* 已排队但还没到点的锚点（用来确认定时器没白跑） */
  var hoverTimer = 0;
  var enabled = true;

  function ensurePop() {
    if (pop && pop.parentNode) return pop;
    pop = document.createElement('div');
    pop.className = 'term-pop';
    pop.setAttribute('role', 'tooltip');
    pop.hidden = true;
    document.body.appendChild(pop);
    return pop;
  }

  function clearHover() {
    if (hoverTimer) { root.clearTimeout(hoverTimer); hoverTimer = 0; }
    pendingAnchor = null;
  }

  function hidePreview() {
    clearHover();
    currentAnchor = null;
    if (pop) pop.hidden = true;
  }

  /** 碰撞处理：先 flip（上下翻转），再 shift（左右平移），最后贴边兜底 */
  function place(anchor) {
    if (!pop || pop.hidden) return;
    var r = anchor.getBoundingClientRect();
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    var vw = root.innerWidth || document.documentElement.clientWidth || 1024;
    var vh = root.innerHeight || document.documentElement.clientHeight || 768;
    var gap = 10;
    var edge = 8;

    /* 默认放在上方，放不下就翻到下方 */
    var above = r.top - ph - gap;
    var below = r.bottom + gap;
    var top, flipped = false;
    if (above >= edge) {
      top = above;
    } else if (below + ph <= vh - edge) {
      top = below;
      flipped = true;
    } else {
      /* 上下都放不下（视口极矮）：贴住视口上边，保证内容可见 */
      top = edge;
    }
    /* 视口极小时（窗口被拖到只剩一条缝）不要把自己推出屏幕外 */
    if (vh > ph + edge * 2 && top > vh - ph - edge) top = vh - ph - edge;

    var left = r.left + r.width / 2 - pw / 2;
    /* 用 max 兜底：视口比浮层还窄时，宁可贴着左边也不能出现负坐标 */
    var maxLeft = Math.max(edge, vw - pw - edge);
    if (left < edge) left = edge;
    if (left > maxLeft) left = maxLeft;

    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
    pop.classList.toggle('is-below', flipped);

    /* 箭头跟着锚点水平中心走，但不出浮层圆角 */
    var arrow = pop.querySelector('.term-pop__arrow');
    if (arrow) {
      var ax = (r.left + r.width / 2) - left;
      ax = Math.max(14, Math.min(pw - 14, ax));
      arrow.style.left = Math.round(ax) + 'px';
    }
  }

  function showPreview(anchor) {
    if (!enabled) return;
    if (!setting('hoverGlossary', true)) return;
    var t = termById(anchor.getAttribute('data-term'));
    if (!t) return;

    var p = ensurePop();
    p.innerHTML =
      '<div class="term-pop__head">' +
        '<b>' + esc(t.term || t.id) + '</b>' +
        (t.zh ? '<span>' + esc(t.zh) + '</span>' : '') +
      '</div>' +
      '<p class="term-pop__brief">' + esc(plain(t.brief || t.def || '')) + '</p>' +
      /* v1.8：悬停里补公式。用户第 8 条原话是"悬停简要说明那一段，
         最好能加一些公式、更准确更正式的说明"。
         原来公式只在点开的完整卡里，悬停只有一句大白话——
         而"这个数怎么来的"恰恰是悬停时最想立刻知道的。
         只在有 formula 字段时出现（27 条有，其余不占位、不留空行）。 */
      (t.formula ? '<p class="term-pop__formula"><span class="term-pop__flabel">公式</span>' +
        esc(plain(t.formula)) + '</p>' : '') +
      '<div class="term-pop__hint">点击查看完整释义</div>' +
      '<i class="term-pop__arrow" aria-hidden="true"></i>';

    currentAnchor = anchor;
    p.hidden = false;
    /* 先显示再量尺寸：display:none 的元素 offsetWidth 是 0，没法定位 */
    place(anchor);
  }

  function schedulePreview(anchor, delay) {
    if (!enabled) return;
    clearHover();
    pendingAnchor = anchor;
    var ms = Math.max(0, num(delay, 400));
    if (!ms) { showPreview(anchor); return; }
    hoverTimer = root.setTimeout(function () {
      hoverTimer = 0;
      /* 定时器触发时鼠标可能已经移走了：pendingAnchor 已被 hidePreview 清空则作废 */
      if (pendingAnchor === anchor) showPreview(anchor);
    }, ms);
  }

  /* ======================================================================
   * E. 完整术语卡
   * ====================================================================*/

  function cardHtml(t) {
    var showFormula = !!setting('termShowFormula', true);
    var showSource = !!setting('termShowSource', true);
    var cat = catMeta(t.cat);

    var html = '<div class="term-card">' +
      '<div class="term-card__meta">' +
        '<span class="badge badge--amber"' +
          (cat.color ? ' style="border-color:' + attr(cat.color) + '66;color:' + attr(cat.color) + '"' : '') +
        '>' + esc(cat.zh) + '</span>' +
      '</div>';

    if (t.brief) {
      html += '<p class="term-card__lead">' + rich(t.brief) + '</p>';
    }

    if (t.def) {
      html += '<section class="term-sec">' +
        '<h3 class="term-sec__h">定义</h3>' +
        '<p class="term-sec__p">' + rich(t.def) + '</p></section>';
    }

    if (t.role) {
      html += '<section class="term-sec">' +
        '<h3 class="term-sec__h">在酿造中的作用</h3>' +
        '<p class="term-sec__p">' + rich(t.role) + '</p></section>';
    }

    /* 常见误解用警示色块：这是术语库里最容易被忽略、也最容易踩坑的部分 */
    if (t.myth) {
      html += '<section class="term-sec term-myth">' +
        '<h3 class="term-sec__h term-myth__h">' +
          '<span class="term-myth__icon" aria-hidden="true">' + UI.icon('alert', 13) + '</span>' +
          '常见误解</h3>' +
        '<p class="term-sec__p">' + rich(t.myth) + '</p></section>';
    }

    if (showFormula && t.formula) {
      html += '<section class="term-sec">' +
        '<h3 class="term-sec__h">计算公式</h3>' +
        '<pre class="term-formula">' + esc(t.formula) + '</pre></section>';
    }

    if (showSource && t.src) {
      html += '<section class="term-sec term-src">' +
        '<h3 class="term-sec__h">出处</h3>' +
        '<p class="term-src__p">' + rich(t.src) + '</p></section>';
    }

    var rel = Array.isArray(t.related) ? t.related : [];
    var relHtml = '';
    for (var i = 0; i < rel.length; i++) {
      var rt = termById(rel[i]);
      if (!rt) continue;
      relHtml += '<button type="button" class="chip term-rel" data-rel="' + attr(rt.id) + '">' +
        esc(rt.term || rt.id) +
        (rt.zh ? '<span class="term-rel__zh">' + esc(rt.zh) + '</span>' : '') +
        '</button>';
    }
    if (relHtml) {
      html += '<section class="term-sec">' +
        '<h3 class="term-sec__h">相关术语</h3>' +
        '<div class="term-rel-list">' + relHtml + '</div></section>';
    }

    return html + '</div>';
  }

  function open(id) {
    var t = termById(id);
    if (!t) {
      if (UI.Shell && UI.Shell.toast) UI.Shell.toast('术语数据未载入，暂时看不到「' + id + '」的释义', 'warn');
      return null;
    }
    hidePreview();

    var api = UI.Shell.modal({
      title: t.term || t.id,
      sub: subOf(t),
      body: cardHtml(t),
      actions: [{ label: '关闭', kind: 'ghost' }],
      onMount: function (a) {
        /* 相关术语：原地换内容，不关框再开框（关框会丢滚动位置、也会闪一下） */
        a.body.addEventListener('click', function (e) {
          var hit = closestRel(e.target, a.body);
          if (!hit) return;
          var nt = termById(hit.getAttribute('data-rel'));
          if (!nt) return;
          a.body.innerHTML = cardHtml(nt);
          a.body.scrollTop = 0;
          var h = a.el.querySelector('.modal__head h2');
          if (h) h.textContent = nt.term || nt.id;
          var s = a.el.querySelector('.modal__sub');
          if (s) s.textContent = subOf(nt);
        });
      }
    });
    return api;
  }

  function closestRel(node, stop) {
    while (node && node !== stop && node.nodeType === 1) {
      if (node.getAttribute && node.getAttribute('data-rel') !== null) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* ======================================================================
   * F. 事件委托（一次性绑在 document 上，不给每个 .term 单独绑）
   * ----------------------------------------------------------------------
   * 标注元素是随时被 BREW.Annotate 增删的（视图重绘就换一批节点），
   * 逐个绑定必然会漏；委托是唯一不会漏的做法。
   * ====================================================================*/

  function closestTerm(node) {
    while (node && node.nodeType === 1) {
      if (node.getAttribute && node.getAttribute('data-term') !== null) return node;
      if (node.classList && node.classList.contains('term')) return node;
      node = node.parentNode;
    }
    return null;
  }

  /** 向上找带某属性的祖先（老浏览器未必有 closest，且选择器语法各引擎不一致） */
  function closestAttr(node, name) {
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 40) {
      if (node.getAttribute && node.getAttribute(name) !== null) return node;
      node = node.parentNode;
    }
    return null;
  }

  function bindOnce() {
    if (bindOnce.done) return;
    bindOnce.done = true;

    document.addEventListener('mouseover', function (e) {
      if (!enabled) return;
      var a = closestTerm(e.target);
      if (!a) return;
      if (a === currentAnchor && pop && !pop.hidden) return; /* 已在显示，不重置 */
      var from = e.relatedTarget;
      if (from && a.contains(from)) return;                  /* 在自身内部移动 */
      schedulePreview(a, setting('hoverDelay', 400));
    });

    document.addEventListener('mouseout', function (e) {
      var a = closestTerm(e.target);
      if (!a) return;
      var to = e.relatedTarget;
      if (to && a.contains(to)) return;
      clearHover();
      hidePreview();
    });

    document.addEventListener('focusin', function (e) {
      if (!enabled) return;
      var a = closestTerm(e.target);
      if (!a) return;
      /* 键盘用户没有"悬停"，聚焦即展示速览，秒出才不打断阅读节奏 */
      schedulePreview(a, 0);
    });

    document.addEventListener('focusout', function (e) {
      if (!closestTerm(e.target)) return;
      hidePreview();
    });

    document.addEventListener('click', function (e) {
      /* 告警行尾的「为什么」按钮：data-term-link 由 42 的 paintWarnings 渲染。
         那个容器每次输入都会整块重建，所以只能在这里统一委托。 */
      var why = closestAttr(e.target, 'data-term-link');
      if (why) {
        e.preventDefault();
        open(why.getAttribute('data-term-link') || '');
        return;
      }
      var a = closestTerm(e.target);
      if (!a) return;
      e.preventDefault();
      open(a.getAttribute('data-term') || '');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var a = closestTerm(e.target);
      if (!a) return;
      e.preventDefault();
      open(a.getAttribute('data-term') || '');
    });

    /* 滚动/缩放后浮层位置会错得离谱，直接收起来比跟着漂移更干净 */
    root.addEventListener('scroll', hidePreview, true);
    root.addEventListener('resize', hidePreview);
  }

  /* ======================================================================
   * G. 标注开关
   * ====================================================================*/

  function viewRoot() {
    return document.getElementById('view') || document.body;
  }

  /* v1.9：顶栏那排指标药丸（`#top-pills` 里的 OG / FG / ABV / IBU / SRM）。
     它是 `<header class="topbar">` 的子节点，和 `main#view` 是**兄弟**——
     只在 `#view` 上跑标注，这五个缩写永远扫不到。
     而它们恰好是用户第一眼看到的一组缩写（用户原话点名就是这五个、这个顺序）。
     单独作为一个 root 传进去，而不是把根换成 body：body 会把侧栏、顶栏按钮、
     弹窗全部拉进 TreeWalker，成本远大于收益。 */
  function pillRoot() {
    return document.getElementById('top-pills');
  }

  function hydrateNow() {
    if (!enabled) return;
    var A = BREW.Annotate;
    if (!A || typeof A.hydrate !== 'function') return; /* 引擎未就绪：只是没有标注，不是错误 */
    try {
      A.hydrate(viewRoot());
      var pills = pillRoot();
      if (pills) A.hydrate(pills);
    } catch (e) {
      if (root.console && console.warn) console.warn('[BrewLab] 术语标注失败', e);
    }
  }

  /* 顶栏药丸由 40-ui-shell 的 syncTopbar 在每次指标变化时**整块重建**
     （`host.innerHTML = …`），标上去的 .term 会被一起冲掉。
     不能靠 recipeChanged 的 900ms 补标——那样每敲一个字药丸就先掉一次下划线。
     用 MutationObserver 盯 `#top-pills` 的直接子节点：重建发生在同一帧，
     回调里补标，用户看不到中间态。
     只观察 childList（不观察 subtree）：hydrate 改的是药丸**内部**的文本节点，
     不会回触发自己，没有自激循环。 */
  var pillObserver = null;

  function watchPills() {
    if (typeof MutationObserver !== 'function') return;
    var pills = pillRoot();
    if (!pills) return;
    if (pillObserver && pillObserver.__brewlabFor === pills) return;
    if (pillObserver) pillObserver.disconnect();
    pillObserver = new MutationObserver(function () {
      if (!enabled) return;
      var A = BREW.Annotate;
      if (A && typeof A.hydrate === 'function') A.hydrate(pills);
    });
    pillObserver.__brewlabFor = pills;
    pillObserver.observe(pills, { childList: true });
  }

  function setEnabled(on) {
    enabled = !!on;
    var A = BREW.Annotate;
    if (!enabled) {
      hidePreview();
      /* 两步都要做：引擎开关阻止后续标注，strip 把已经标上的去掉 */
      if (A && typeof A.setEnabled === 'function') {
        try { A.setEnabled(false); } catch (e) { /* 引擎异常不影响关闭这个动作 */ }
      }
      if (A && typeof A.strip === 'function') {
        try { A.strip(document.body); } catch (e2) { /* 同上 */ }
      }
      return;
    }
    if (A && typeof A.setEnabled === 'function') {
      try { A.setEnabled(true); } catch (e3) { /* 保持默认开启 */ }
    }
    hydrateNow();
  }

  /* ======================================================================
   * H. 启动
   * ====================================================================*/

  function init() {
    bindOnce();
    ensurePop();
    watchPills();

    var on = !!setting('annotateTerms', true);
    setEnabled(on);

    if (BREW.Bus && typeof BREW.Bus.on === 'function') {
      /* 视图重绘会冲掉上一次的标注，所以每次切换视图后补一次 */
      BREW.Bus.on('viewChanged', function () {
        root.setTimeout(hydrateNow, 60);
      });
      BREW.Bus.on('dataReady', function () {
        root.setTimeout(hydrateNow, 200);
      });
      /* 保存是个自然的"停下来看一眼"的时刻，此时补标注不会打断输入 */
      BREW.Bus.on('recipeSaved', function () { root.setTimeout(hydrateNow, 120); });
      BREW.Bus.on('batchSaved', function () { root.setTimeout(hydrateNow, 120); });

      /* 配方页有 8 个容器是增量重绘的（风格匹配、水质摘要、贡献度分解、告警块…），
         每次改参数都整块重建 innerHTML，标上去的 .term 会被一起冲掉。
         早先考虑过给这些容器挂 .no-annotate 永不标注 —— 放弃了，因为其中
         风格档案、水质摘要恰恰是文字最多、最需要"悬停查一下"的地方，
         永久关掉等于把新功能从最有用的位置摘走。
         改成"停手后再标"：输入期间不标（不闪），停手 900ms 后补一次。
         hydrate 会跳过已存在的 .term，且只作用于 #view，所以重复调用是安全的。 */
      var rehydrateTimer = 0;
      BREW.Bus.on('recipeChanged', function () {
        if (!enabled) return;
        if (rehydrateTimer) root.clearTimeout(rehydrateTimer);
        rehydrateTimer = root.setTimeout(function () {
          rehydrateTimer = 0;
          hydrateNow();
        }, 900);
      });
    }
  }

  BREW.UI.Terms = {
    init: init,
    setEnabled: setEnabled,
    hydrateNow: hydrateNow,
    open: open,
    hidePreview: hidePreview,
    /** 供设置页统计用 */
    count: function () { return glossary().length; },
    catName: function (c) { return catMeta(c).zh; }
  };

  /* 术语卡也可以被外部直接打开（例如设置页的"看看术语卡长什么样"） */
  BREW.UI.openTerm = open;

  UI.ready(init);

})(typeof window !== 'undefined' ? window : globalThis);
