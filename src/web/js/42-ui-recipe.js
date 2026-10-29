/* ============================================================================
 * 风月酿研所 — 42-ui-recipe.js
 * ----------------------------------------------------------------------------
 * 职责：配方编辑器视图（应用核心）。
 *   · 基本信息 / 麦芽 / 酒花 / 酵母 / 辅料 / 水化学 / 糖化方案
 *   · 右侧实时指标面板：OG FG ABV IBU SRM BU:GU + 色块 + 风格匹配 + 占比条
 *   · 配方保存 / 另存为 / 复制 / 删除 / 载入基线
 * 本文件同时向 UI 暴露可复用的原料选择器：UI.combo / UI.bindCombos / UI.onComboPick
 *
 * 数据模型与 BREW.Recipe 完全一致（fermentables[].amount、hops[].amount+time、
 * yeasts[].att、water.source、water.salts、mash.steps[].minutes）
 *
 * 依赖：BREW.UI（esc/num/fmt/calc/publish/recipe/store）、BREW.Recipe.add*（可选）
 *       BREW.DB.malts/hops/yeasts/adjuncts/waterSalts/styles（缺失时降级为空态）
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  /* ======================================================================
   * A. 原料选择器（带搜索的下拉，全应用复用）
   * ====================================================================*/

  /**
   * UI.combo(kind, value, opts) → HTML
   *   kind  : 'malts' | 'hops' | 'yeasts' | 'adjuncts' | 'waterSalts'
   *   value : 当前选中的 id
   *   opts  : {path:'fermentables.0.id', placeholder:'选择麦芽'}
   *
   * 只渲染按钮，选项列表在第一次打开时才生成——配方页有 10 个选择器，
   * 每个 50-75 个选项的话，一次性铺出来是 600+ 节点，首屏会明显发涩。
   *
   * v1.7：列表本身**不再长在这里**。`.combo > .combo__list` 这个结构保留，
   *   但它只是个占位（恒 display:none），真正的选项列表挂在 body 上的唯一浮层里。
   *   原因见下面 A2 段：`.table-wrap` 的 `overflow-x:auto` 会把它裁成一条缝。
   *   保留占位是为了让 40 处调用方（UI.combo 的返回值只被拼进 <td>）一行都不用改。
   */
  UI.combo = function (kind, value, opts) {
    opts = opts || {};
    var cur = UI.byId(kind, value) || null;
    if (!cur && value) {
      var custom = UI.customList(kind);
      for (var i = 0; i < custom.length; i++) if (custom[i].id === value) cur = custom[i];
    }
    var label = cur ? cur.name : (opts.placeholder || '选择原料');
    var sub = cur ? (cur.en || '') : '';

    return '<div class="combo" data-combo data-kind="' + attr(kind) + '" data-path="' + attr(opts.path || '') + '" ' +
      'data-value="' + attr(value || '') + '">' +
      '<button type="button" class="btn-combo' + (cur ? '' : ' is-empty') + '" data-combo-btn ' +
      'aria-haspopup="listbox" aria-expanded="false" title="' + attr(label + (sub ? ' / ' + sub : '')) + '">' +
      '<span>' + esc(label) + '</span>' + icon('chevron', 12) +
      '</button>' +
      /* inline display:none 是必须的：css/style.css 有一条
         `.combo.is-open .combo__list { display:block }`，而 .combo 展开时会带
         is-open（aria 与按钮态要用），这条既有规则会让这个空占位冒出一个 300px
         宽的空盒子。inline 比样式表优先，且不用去改既有类。 */
      '<div class="combo__list" role="listbox" style="display:none"></div>' +
      '</div>';
  };

  /* ======================================================================
   * A2. 浮层：唯一实例 + body 挂载 + position:fixed
   * ----------------------------------------------------------------------
   * 为什么非这样不可（这是 v1.7 修的那个"下拉只露出一条缝"）：
   *   `.combo__list` 原来是 `.combo` 的子元素，`.combo` 落在 `.table-wrap` 里，
   *   而 `.table-wrap` 写的是 `overflow-x:auto; overflow-y:visible`。按 CSS 规范，
   *   一轴是 auto 时另一轴的 visible 会被**计算成 auto** —— 于是 .table-wrap 成为
   *   滚动裁剪容器，绝对定位的面板被它和自己的 .card 一路裁下去。
   *   实测（1680×1050，祖先裁剪后真正看得见的高度）：第一个麦芽行 203px、
   *   中间酒花行 251px、最后一行 **0px**（自然高 280）。越靠页面下方越惨。
   *   项目里早就定过这条规矩（.term-pop，style.css:2155 的注释）：浮动面板必须
   *   body 挂载 + position:fixed，坐标在展开时算。
   *
   * 为什么只有一个浮层实例（而不是每个 .combo 一个）：
   *   一屏最多只会展开一个下拉；10 个选择器各建一个，等于 10 份 50–75 行的
   *   DOM 常驻。复用一个元素 + 每次展开重填 innerHTML 最省，也不会有"关掉之后
   *   忘了隐藏"的第二种状态。
   *
   * 为什么状态放模块级而不是 bindCombos 的闭包里：
   *   bindCombos 每次 render 都会被调一次（切配方、加一行原料、换视图）。
   *   状态挂在闭包里，第二次 render 就是一份新状态，上一个浮层再也没人收 ——
   *   典型症状是"页面上留着一个关不掉的下拉"。
   *
   * ⚠️ 事件委托的陷阱（踩过就会静默失效）：
   *   列表挪到 body 之后就不再是 container 的后代，原来挂在 container 上的
   *   委托（选选项、搜索、Escape）**一条都收不到**，表现为"点选项没反应"。
   *   所以：面板自己挂一套监听（click / input / keydown），container 那套只负责
   *   按钮开合；"选中一个原料"的逻辑抽成 pickOption()，两处共用同一份实现。
   * ====================================================================*/

  var panel = null;        /* 浮层元素（document.body 的子节点） */
  var panelBox = null;     /* 浮层当前服务于哪个 .combo；null = 没展开 */
  var comboBound = false;  /* 文档级监听只挂一次（重复挂 = 一次点击开两次） */

  function clampNum(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function hidePanel() {
    if (!panel) return;
    panel.style.display = 'none';
    panelBox = null;
  }

  /** 收掉所有展开态。except 是"要保留的那个 .combo"（点按钮切换时用）。 */
  function closeAll(except) {
    /* 不能用 bindCombos 闭包里的 container：宿主可能已经被 render 换掉了，
       而面板里还指着旧的 .combo。查 document 才收得干净。 */
    var all = document.querySelectorAll('.combo.is-open');
    for (var i = 0; i < all.length; i++) {
      if (all[i] === except) continue;
      all[i].classList.remove('is-open');
      var b = all[i].querySelector('[data-combo-btn]');
      if (b) b.setAttribute('aria-expanded', 'false');
    }
    if (panelBox !== except) hidePanel();
  }

  /** 建浮层（只建一次），监听挂在浮层自己身上 —— 它已经不是 container 的后代 */
  function ensurePanel() {
    /* 判"挂在 body 上"而不是"有 parentNode"：节点被别人带走/整棵子树被替换后，
       parentNode 仍然非 null，但那个浮层已经不在文档里了 —— 用它就永远不显示。 */
    if (panel && panel.parentNode === document.body) return panel;
    panel = document.createElement('div');
    panel.className = 'combo__list combo__list--fixed';
    panel.setAttribute('role', 'listbox');
    panel.style.display = 'none';
    document.body.appendChild(panel);

    panel.addEventListener('click', function (e) {
      var opt = e.target.closest ? e.target.closest('[data-opt]') : null;
      if (!opt || !panelBox) return;
      pickOption(panelBox, opt);
    });

    panel.addEventListener('input', function (e) {
      var s = e.target.closest ? e.target.closest('[data-combo-search]') : null;
      if (!s) return;
      filterOpts(panel, s.value.trim().toLowerCase());
    });

    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.stopPropagation();   /* 别让 Escape 一路冒到 Shell 的全局快捷键上 */
        closeAll(null);
      }
    });

    return panel;
  }

  /**
   * 把浮层贴到按钮旁边。
   * 浮层挂在 body 上，和按钮没有父子关系，所以只能展开那一刻用
   * getBoundingClientRect() 算一次 fixed 坐标（视口为基准）。
   *
   * 三条硬约束（缺一条就会"浮层跑出屏幕"）：
   *   ① 宽度至少 300px —— 原料名 + 右侧参数（ppg·L）一行放得下；
   *      按钮本身可能只有 150px（表格列窄），跟按钮同宽会把名字挤成省略号。
   *   ② 左右不越界：靠近右边缘的列（水盐那几行）必须往左挪。
   *   ③ 上下翻转：下方放不下面板就翻到按钮上方，并把高度钳到那一侧的实际空间。
   *      "下方不足 240px" 是阈值 —— 240 约等于搜索框 + 一行选项，再矮就没有
   *      可选性了；此时只要上方更宽裕就翻。
   */
  function positionPanel(btn) {
    var r = btn.getBoundingClientRect();
    var vw = root.innerWidth || document.documentElement.clientWidth;
    var vh = root.innerHeight || document.documentElement.clientHeight;

    var width = Math.max(r.width, 300);
    var left = clampNum(r.left, 8, Math.max(8, vw - width - 8));
    panel.style.width = width + 'px';
    panel.style.left = Math.round(left) + 'px';

    /* 先解除高度钳制再量：否则量到的是"上一次展开时"的高度。
       浮层的 padding(4+4) 与边框(1+1) 共 10px 不算在 max-height 里，但占视口。 */
    var CHROME = 10;
    panel.style.maxHeight = 'none';
    var natural = panel.offsetHeight;

    var spaceBelow = vh - r.bottom - 10;
    var spaceAbove = r.top - 10;
    var cap = Math.min(360, natural);

    var up = (spaceBelow < Math.min(cap, 240) && spaceAbove > spaceBelow);
    var side = up ? spaceAbove : spaceBelow;
    var maxH = Math.min(cap, Math.max(60, side - CHROME));
    maxH = Math.min(maxH, Math.max(60, vh - 60));
    panel.style.maxHeight = Math.round(maxH) + 'px';

    /* 应用 max-height 之后再量外框高（此时已含 padding / 边框），
       向上翻的 top 必须用这个数，否则会压住按钮或顶出视口。 */
    var h = panel.offsetHeight;
    var top = up ? (r.top - h - 4) : (r.bottom + 4);
    top = clampNum(top, 8, Math.max(8, vh - h - 8));
    panel.style.top = Math.round(top) + 'px';

    /* is-up 只影响进场动画方向（v17-combo.css），不影响布局 */
    if (up) panel.classList.add('is-up');
    else panel.classList.remove('is-up');
  }

  /** 选一个原料。container 与 panel 两处共用这一份实现（见 A2 段头的陷阱说明） */
  function pickOption(box, optEl) {
    if (!box || !optEl) return;
    var path = box.getAttribute('data-path');
    var kind = box.getAttribute('data-kind');
    var id = optEl.getAttribute('data-opt');
    var labelEl = optEl.querySelector('b');
    var btn = box.querySelector('[data-combo-btn]');
    var span = btn ? btn.querySelector('span') : null;

    box.setAttribute('data-value', id);
    if (span && labelEl) span.textContent = labelEl.textContent;
    /* 原来空态时按钮文字是灰的（.btn-combo.is-empty）。选完不摘这个类，
       文字会一直是"未选"的灰 —— 用户会以为没选上。 */
    if (btn) btn.classList.remove('is-empty');
    closeAll(null);
    if (typeof comboPickHandler === 'function') comboPickHandler(path, id, kind);
  }

  /**
   * 生成选项列表 HTML（首次展开时惰性生成，缓存在 box 上）。
   * 缓存必须按 box 存、不能缓存在 panel 上：panel 是全局复用的，
   * 缓存挪到它身上就会出现"打开酒花下拉，看到的是上一行麦芽的列表"。
   */
  function fillCombo(box) {
    if (!box) return '';
    if (box.__filled && box.__html != null) return box.__html;

    var kind = box.getAttribute('data-kind');
    var cur = box.getAttribute('data-value') || '';
    var pool = UI.pool(kind);

    if (!pool.length) {
      box.__filled = true;
      box.__html = '<div class="combo__empty">原料库未载入，稍后重试</div>';
      return box.__html;
    }
    var html = '<div style="padding:4px 4px 6px">' +
      '<input class="input" type="search" data-combo-search placeholder="搜索名称 / 英文名…" ' +
      'aria-label="搜索原料" style="font-size:12px;padding:5px 8px"></div><div data-combo-opts>';
    for (var j = 0; j < pool.length; j++) {
      var it = pool[j];
      var meta = comboMeta(kind, it);
      html += '<div class="combo__opt" role="option" data-opt="' + attr(it.id) + '" ' +
        'aria-selected="' + (it.id === cur ? 'true' : 'false') + '" ' +
        'data-search="' + attr(((it.name || '') + ' ' + (it.en || '')).toLowerCase()) + '">' +
        '<b>' + esc(it.name || it.id) + '</b>' +
        (meta ? '<small>' + esc(meta) + '</small>' : '') +
        '</div>';
    }
    html += '</div>';
    box.__filled = true;
    box.__html = html;
    return html;
  }

  /** 展开某个 combo 的浮层 */
  function openCombo(box, btn) {
    ensurePanel();
    closeAll(box);
    panelBox = box;
    box.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');

    panel.innerHTML = fillCombo(box);
    /* 缓存的 HTML 里 aria-selected 是"上次生成时"的状态（选过之后就不对了），
       展开时按当前 data-value 重刷一遍，免得高亮停在旧的那一行上。 */
    var opts = panel.querySelectorAll('[data-opt]');
    var cur = box.getAttribute('data-value') || '';
    for (var i = 0; i < opts.length; i++) {
      opts[i].setAttribute('aria-selected', opts[i].getAttribute('data-opt') === cur ? 'true' : 'false');
    }
    panel.style.display = 'block';
    positionPanel(btn);

    var s = panel.querySelector('[data-combo-search]');
    if (s) {
      s.value = '';
      filterOpts(panel, '');
      /* 展开后再聚焦：先聚焦会让某些浏览器把浮层滚进视口，坐标就白算了 */
      root.setTimeout(function () { if (panelBox === box && s.parentNode) s.focus(); }, 10);
    }
  }

  function comboMeta(kind, it) {
    if (kind === 'malts') return fmt(it.ppg, 0) + 'ppg · ' + fmt(it.lov, 0) + 'L';
    if (kind === 'hops') return fmt(it.aa, 1) + '% α酸' + (it.origin ? ' · ' + it.origin : '');
    /* v2.0：走 UI.yeastAtt——自建酵母的老存档可能只有 atten，只读 att 会显示成没有衰减度 */
    if (kind === 'yeasts') return (it.lab || '') + ' · ' + fmt(UI.yeastAtt(it), 0) + '%';
    if (kind === 'adjuncts') return it.cat || '';
    if (kind === 'waterSalts') return it.formula || '';
    return '';
  }

  var combosBound = false;
  var comboPickHandler = null;

  UI.onComboPick = function (fn) { comboPickHandler = fn; };

  /**
   * UI.bindCombos(container)
   *   container 每次 render 都会换一份 DOM 内容，所以这里**不能**再"只绑第一次"。
   *
   * 关闭时机（漏一个就会留个鬼影浮层盖在别的控件上）：
   *   ① 选中选项 —— pickOption 里 closeAll
   *   ② 点页面其他地方 —— 文档级 click
   *   ③ Escape —— 文档级 keydown
   *   ④ 任意祖先滚动 —— 文档级 scroll 且 **capture=true**（滚动事件不冒泡，
   *      不加捕获就收不到 .table-wrap / 右栏这类内部滚动容器的滚动）
   *   ⑤ 窗口 resize —— 依附在按钮坐标上的浮层，尺寸一变就必须重算；直接关更省事
   *   ⑥ 视图切换 / 重渲染 —— bindCombos 一进来就 closeAll：旧 DOM 马上要被替换，
   *      浮层背后的 .combo 没了，留着它就是一个点不动的空壳
   */
  UI.bindCombos = function (container) {
    /* 宿主要被换掉了：先收浮层（这里必须是 closeAll，不能只 hide）。
       container 参数保留只为兼容调用方（render 里一路传下来），
       监听已经全部挪到 document —— 委托到 container 会随着重渲染失效。 */
    closeAll(null);

    if (combosBound) return;
    combosBound = true;

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      /* 浮层内部的点击由浮层自己的监听处理（pickOption）。
         这里若再处理一遍会变成"选一次、回调两次"。 */
      if (panel && panel.contains(t)) return;

      var btn = t.closest('[data-combo-btn]');
      if (btn) {
        var box = btn.closest('.combo');
        if (!box) return;
        /* 已经是展开态：再点按钮 = 收起。这就是 toggle 语义。 */
        if (box.classList.contains('is-open')) closeAll(null);
        else openCombo(box, btn);
        return;
      }

      /* 点在 combo 之外（或点在本行其他单元格上）就全收 */
      if (!t.closest('.combo')) closeAll(null);
    });

    document.addEventListener('input', function (e) {
      var s = e.target.closest ? e.target.closest('[data-combo-search]') : null;
      if (!s) return;
      filterOpts(panel, s.value.trim().toLowerCase());
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') closeAll(null);
    });

    /* capture=true：滚动事件不冒泡，只有捕获阶段能看到所有滚动容器
       （页面、.table-wrap、右栏）。 */
    document.addEventListener('scroll', function (e) {
      /* 例外：浮层自己在滚。浮层是 body 的子节点，它滚动同样会被捕获到，
         不排除的话"往下翻原料列表"会当场把列表关掉——比不关更糟。 */
      if (panel && (e.target === panel || panel.contains(e.target))) return;
      closeAll(null);
    }, true);

    root.addEventListener('resize', function () { closeAll(null); });
  };

  /** 搜索过滤。参数改成"列表容器"（现在是浮层，不再是 .combo） */
  function filterOpts(box, q) {
    if (!box) return;
    var opts = box.querySelectorAll('[data-opt]');
    var shown = 0;
    for (var i = 0; i < opts.length; i++) {
      var hit = !q || (opts[i].getAttribute('data-search') || '').indexOf(q) > -1;
      opts[i].style.display = hit ? '' : 'none';
      if (hit) shown++;
    }
    var host2 = box.querySelector('[data-combo-opts]');
    var old = box.querySelector('.combo__empty--dyn');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!shown && host2) {
      var d = document.createElement('div');
      d.className = 'combo__empty combo__empty--dyn';
      d.textContent = '没有匹配的原料';
      host2.appendChild(d);
    }
  }

  /* ======================================================================
   * B. 视图状态与工具
   * ====================================================================*/

  var host = null;
  var bound = false;

  var STAGES = [
    { v: 'firstwort', t: '首麦汁' },
    { v: 'mash', t: '糖化' },
    { v: 'boil', t: '煮沸' },
    { v: 'whirlpool', t: '回旋' },
    { v: 'dryhop', t: '干投' }
  ];

  UI.stageLabel = function (v) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].v === v) return STAGES[i].t;
    var map = { flameout: '熄火', fermenter: '发酵罐', packaging: '装瓶', other: '其他' };
    return map[v] || v || '—';
  };

  function setPath(obj, path, val) {
    var parts = String(path).split('.');
    var o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (o[k] === undefined || o[k] === null) o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      o = o[k];
    }
    o[parts[parts.length - 1]] = val;
  }

  /* ======================================================================
   * B2. 数值字段：按内容收窄 + 填写时的范围提示（v1.5）
   * ----------------------------------------------------------------------
   * 两个诉求放在一起做，因为它们读的是同一份「这个 input 是什么字段」的映射：
   *   ① 宽度按字符数给（data-w → --wch），一个「72」不该占满 200px；
   *   ② 不合理值当场标红/标黄，并把「凭什么红」写在框下面。
   *
   * 为什么宽度映射按 path 而不是按行号/位置：
   *   表格行会增删、配方会切换，同一个「麦芽用量」在不同行下标不同，
   *   只有 data-path 的最后两段（表名 + 字段名）是稳定的。
   *
   * 为什么 42 里要放一份给 46 用的实现（UI.FieldHint）：
   *   46 的「酿造实测 / 装瓶 / 成本」是同一批数值输入，范围表也只有一份
   *   （39a）。两处各写一套判定，迟早出现「配方页红了、批次页不红」。
   *   42 先于 46 加载（index.html 181 → 185），所以 46 直接调用即可。
   *
   * 长数值的三层兜底（缺一不可）：
   *   a. 常态窄——宽度只够 data-w 个字符；
   *   b. 聚焦时量真实文本像素宽并撑开，失焦后若仍溢出就保持撑开 + is-wide；
   *   c. 溢出时 title 写全值。
   *   input 不能换行，也没有「省略号但能读全」的办法——数值被 … 截断时
   *   用户会照着错的数去投料，所以宁可变宽，也不截断。
   * ====================================================================*/
  var FH = UI.FieldHint = UI.FieldHint || {};

  /* 路径 → 字符数。名单来自 v1.5 需求：用量类 6、常规参数 5、比重 7、金额 8 */
  var W_BY_PATH = {
    batchSize: 6,
    efficiency: 5,
    boilTime: 5,
    evaporationRate: 5,
    trubLoss: 5,
    mashThickness: 5,
    fermentTemp: 5,
    'carbonation.targetVol': 5,
    /* v1.9 三个新工艺段（落点见 PROC_DEFAULTS 上方的注释） */
    'targets.process.chill.targetC': 5,
    'targets.process.chill.minutes': 5,
    'targets.process.chill.o2ppm': 5,
    'targets.process.mature.days': 5,
    'targets.process.mature.tempC': 5,
    'targets.process.mature.ccTempC': 5,
    'targets.process.mature.ccDays': 5
  };
  var RULE_BY_PATH = {
    batchSize: 'batchSize',
    efficiency: 'efficiency',
    boilTime: 'boilTime',
    evaporationRate: 'evaporationRate',
    trubLoss: 'trubLoss',
    'carbonation.targetVol': 'carbonation',
    /* v1.9：新字段必须在 39a 登记**并且**在这里映射，否则输入框填什么都不标红。
       evaporationRate 就是前车之鉴：39a 有规则、这里缺映射，%／h 那个框填 50
       也不标红——v2.0 已补上本行，规则随之生效。 */
    'targets.process.chill.targetC': 'chillTargetC',
    'targets.process.chill.minutes': 'chillMinutes',
    'targets.process.chill.o2ppm': 'chillO2',
    'targets.process.mature.days': 'matureDays',
    'targets.process.mature.tempC': 'matureTempC',
    'targets.process.mature.ccTempC': 'coldCrashTemp',
    'targets.process.mature.ccDays': 'coldCrashDays'
  };

  /* 46 与 42 里那些由 UI.unitWrap 生成、只有 id 没有 data-path 的框。
     id 是渲染时写死的（f-vol / ac-og / pk-volume…），比位置稳定。 */
  var W_BY_ID = {
    'f-vol': 6, 'f-eff': 5, 'f-evap': 5, 'f-boil': 5, 'f-carb': 5, 'f-trub': 5,
    'f-thick': 5, 'f-ftemp': 5,
    'r-sg': 7, 'r-temp': 5, 'r-ph': 5,
    'ac-og': 7, 'ac-fg': 7, 'ac-mash-water': 6, 'ac-sparge-water': 6,
    'ac-grain': 6, 'ac-ph': 5, 'ac-eff': 5,
    'pk-volume': 6, 'pk-bottles': 5, 'pk-co2': 5, 'pk-sugar': 6,
    'co-ing': 8, 'co-other': 8,
    'nb-vol': 6
  };
  var RULE_BY_ID = {
    'f-vol': 'batchSize', 'f-eff': 'efficiency', 'f-boil': 'boilTime',
    'f-carb': 'carbonation', 'f-trub': 'trubLoss',
    'r-temp': 'measureTemp', 'r-ph': 'measurePh',
    'ac-og': 'og', 'ac-fg': 'fg', 'ac-ph': 'mashPh', 'ac-eff': 'efficiency',
    'pk-volume': 'pkgVolume', 'pk-co2': 'carbonation',
    'co-ing': 'costAmount', 'nb-vol': 'batchSize'
  };
  /* 水离子路径的最后一段 → 39a 的键名（大小写不是机械转换：wSO4 / wHCO3） */
  var ION_RULE = { ca: 'wCa', mg: 'wMg', na: 'wNa', cl: 'wCl', so4: 'wSO4', hco3: 'wHCO3' };

  function widthOfId(id) {
    if (!id) return 0;
    if (W_BY_ID[id]) return W_BY_ID[id];
    if (/^y-amt-\d+$/.test(id)) return 6;
    if (/^y-temp-\d+$/.test(id)) return 5;
    if (/^y-att-\d+$/.test(id)) return 5;
    return 0;
  }

  function ruleOfId(id) {
    if (!id) return '';
    if (RULE_BY_ID[id]) return RULE_BY_ID[id];
    if (/^y-amt-\d+$/.test(id)) return 'yeastAmount';
    if (/^y-att-\d+$/.test(id)) return 'attenuation';
    return '';
  }

  function widthOfPath(path) {
    if (!path) return 0;
    if (W_BY_PATH[path] !== undefined) return W_BY_PATH[path];
    if (/^fermentables\.\d+\.amount$/.test(path)) return 6;
    if (/^fermentables\.\d+\.(lov|ppg)$/.test(path)) return 5;
    if (/^hops\.\d+\.amount$/.test(path)) return 6;
    if (/^hops\.\d+\.(time|aa)$/.test(path)) return 5;
    if (/^hops\.\d+\.whirlpoolTemp$/.test(path)) return 5;
    if (/^adjuncts\.\d+\.amount$/.test(path)) return 5;
    if (/^water\.salts\.\d+\.amount$/.test(path)) return 6;
    if (/^water\.source\.(ca|mg|na|cl|so4|hco3)$/.test(path)) return 5;
    if (/^mash\.steps\.\d+\.(tempC|minutes)$/.test(path)) return 5;
    if (/^yeasts\.\d+\.amount$/.test(path)) return 6;
    if (/^yeasts\.\d+\.(tempC|att)$/.test(path)) return 5;
    return 0;
  }

  function ruleOfPath(path) {
    if (!path) return '';
    if (RULE_BY_PATH[path]) return RULE_BY_PATH[path];
    if (/^fermentables\.\d+\.amount$/.test(path)) return 'fermAmount';
    if (/^hops\.\d+\.amount$/.test(path)) return 'hopAmount';
    if (/^hops\.\d+\.time$/.test(path)) return 'hopTime';
    if (/^hops\.\d+\.aa$/.test(path)) return 'hopAA';
    /* v1.9：回旋温度是新暴露的可编辑字段（此前只有 30 的基线配方会写它，
       界面上没有任何入口）。范围见 39a 的 whirlpoolTemp。 */
    if (/^hops\.\d+\.whirlpoolTemp$/.test(path)) return 'whirlpoolTemp';
    if (/^yeasts\.\d+\.amount$/.test(path)) return 'yeastAmount';
    if (/^yeasts\.\d+\.att$/.test(path)) return 'attenuation';
    if (/^mash\.steps\.\d+\.tempC$/.test(path)) return 'mashTemp';
    if (/^mash\.steps\.\d+\.minutes$/.test(path)) return 'mashMinutes';
    var m = /^water\.source\.(ca|mg|na|cl|so4|hco3)$/.exec(path);
    if (m) return ION_RULE[m[1]] || '';
    return '';
  }

  /** 与 UI.unitWrap 同签名，额外把 .fld / data-w / data-rule 写进 input。
   *  不改 40-ui-shell.js：那边是别人负责的文件，而且 unitWrap 没有透传
   *  任意属性的入口，因此这里对返回的 HTML 做一次精确替换。 */
  UI.fldWrap = function (id, value, unit, opts) {
    opts = opts || {};
    var html = UI.unitWrap(id, value, unit, opts);
    var w = num(opts.w, 0) || widthOfPath(opts.path) || widthOfId(id) || 5;
    var rule = opts.rule || ruleOfPath(opts.path) || ruleOfId(id) || '';
    return html.replace(
      '<input class="input input--num"',
      '<input class="input input--num fld" data-w="' + attr(w) + '"' +
        (rule ? ' data-rule="' + attr(rule) + '"' : '')
    );
  };

  /* ---------- 文本像素宽测量：只用于「撑到内容宽」，不参与任何计算 ---------- */
  var measureSpan = null;
  function textPx(el, text) {
    if (!measureSpan) {
      measureSpan = document.createElement('span');
      measureSpan.setAttribute('aria-hidden', 'true');
      measureSpan.style.cssText = 'position:absolute;left:-99999px;top:-99999px;' +
        'visibility:hidden;white-space:pre;padding:0;border:0;margin:0';
      (document.body || document.documentElement).appendChild(measureSpan);
    }
    var cs = root.getComputedStyle ? root.getComputedStyle(el) : null;
    if (cs) {
      measureSpan.style.fontFamily = cs.fontFamily;
      measureSpan.style.fontSize = cs.fontSize;
      measureSpan.style.fontWeight = cs.fontWeight;
      measureSpan.style.letterSpacing = cs.letterSpacing;
      measureSpan.style.fontVariantNumeric = cs.fontVariantNumeric || 'normal';
    }
    measureSpan.textContent = text === '' ? '0' : text;
    return measureSpan.getBoundingClientRect().width;
  }

  function isNumericInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    return el.type === 'number' || el.getAttribute('data-num') === '1';
  }

  /** 按 base（常态宽）与真实文本宽决定是否撑开。focused=false 时若仍溢出
   *  就保持撑开并挂 is-wide——长数值在失焦后也必须能看全。 */
  function fitWidth(el) {
    if (!el.classList.contains('fld')) return;
    if (!el.__fldBase) {
      var prev = el.style.width;
      el.style.width = '';
      el.__fldBase = el.getBoundingClientRect().width;
      el.style.width = prev;
    }
    var base = el.__fldBase || 0;
    if (!base) return;
    var cs = root.getComputedStyle ? root.getComputedStyle(el) : null;
    var pad = 0;
    if (cs) {
      pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) +
        (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    }
    var txt = el.value === null || el.value === undefined ? '' : String(el.value);
    var need = textPx(el, txt) + pad + 2;
    var over = need > base + 0.5;

    if (over) {
      el.style.width = Math.ceil(need) + 'px';
      el.classList.add('is-wide');
      el.title = txt;
    } else {
      /* 放得下就回常态：无论聚焦与否。这样删掉长数字后不会留下一个
         永远撑着的空框，也不会让 is-wide 变成一次性状态。 */
      el.style.width = '';
      el.classList.remove('is-wide');
      if (el.title) el.removeAttribute('title');
    }
  }

  /* ---------- 提示元素：字段下方一条 <p class="fld-msg"> ---------- */
  var msgSeq = 0;

  function fieldKey(el) {
    if (el.__fldKey) return el.__fldKey;
    el.__fldKey = el.getAttribute('data-path') || el.id || ('f' + (++msgSeq));
    return el.__fldKey;
  }

  function findMsgEl(el) {
    var key = fieldKey(el);
    var tr = el.closest ? el.closest('tr[data-row]') : null;
    if (tr) {
      var row = tr.nextElementSibling;
      if (!row || !row.classList || !row.classList.contains('fld-msg-row')) return null;
      return row.querySelector('.fld-msg[data-for="' + cssKey(key) + '"]');
    }
    var field = el.closest ? el.closest('.field') : null;
    if (!field) {
      var next = el.nextElementSibling;
      return (next && next.classList && next.classList.contains('fld-msg')) ? next : null;
    }
    var all = field.querySelectorAll(':scope > .fld-msg');
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute('data-for') === key) return all[i];
    }
    return null;
  }

  /** 属性选择器里的值可能含点号/引号：这里只用来查我们自己写进去的 key，
   *  用 getAttribute 逐条比对更稳，所以 cssKey 只做最基础的处理。 */
  function cssKey(k) {
    return String(k).replace(/"/g, '\\"');
  }

  function removeMsg(el) {
    var p = findMsgEl(el);
    if (!p) return;
    var tr = p.closest ? p.closest('tr.fld-msg-row') : null;
    var field = p.parentNode;
    if (tr) {
      var cell = p.parentNode;
      cell.removeChild(p);
      if (!cell.querySelector('.fld-msg')) {
        if (tr.parentNode) tr.parentNode.removeChild(tr);
      }
      el.removeAttribute('aria-describedby');
      return;
    }
    if (field) field.removeChild(p);
    el.removeAttribute('aria-describedby');
  }

  function showMsg(el, res) {
    var key = fieldKey(el);
    var p = findMsgEl(el);
    var tr = el.closest ? el.closest('tr[data-row]') : null;
    var field = el.closest ? el.closest('.field') : null;

    if (!p) {
      p = document.createElement('p');
      p.className = 'fld-msg';
      p.setAttribute('data-for', key);
      if (tr) {
        var row = tr.nextElementSibling;
        if (!row || !row.classList || !row.classList.contains('fld-msg-row')) {
          row = document.createElement('tr');
          row.className = 'fld-msg-row';
          var cell = document.createElement('td');
          cell.setAttribute('colspan', String(tr.children.length || 1));
          row.appendChild(cell);
          tr.parentNode.insertBefore(row, tr.nextSibling);
        }
        row.firstChild.appendChild(p);
      } else if (field) {
        var anchor = el.closest('.input-wrap, .cell-unit-row');
        if (anchor && anchor.parentNode === field) field.insertBefore(p, anchor.nextSibling);
        else field.appendChild(p);
      } else {
        /* 兜底：没有 .field 外壳时也要插在输入框的"行"之后，而不是
           .input-wrap 内部——那是个 flex 行，插进去提示会横着排。 */
        var wrap = el.closest('.input-wrap, .cell-unit-row') || el;
        if (wrap.parentNode) wrap.parentNode.insertBefore(p, wrap.nextSibling);
      }
    }

    p.setAttribute('data-lvl', res.level);
    p.textContent = res.msg || '';
    if (!p.id) p.id = 'fld-msg-' + (++msgSeq);
    el.setAttribute('aria-describedby', p.id);
  }

  /** 判一个框：hard/soft 写 aria-invalid 与 data-lvl，ok/empty 移除提示。
   *  empty 不标红——见 39a 头部：一打开整页红，用户会先学会忽略红色。 */
  FH.validate = function (el) {
    if (!el || !el.getAttribute) return;
    var key = el.getAttribute('data-rule');
    if (!key || !BREW.FieldRules || typeof BREW.FieldRules.test !== 'function') return;
    var res = BREW.FieldRules.test(key, el.value);
    if (res.level === 'hard' || res.level === 'soft') {
      el.setAttribute('data-lvl', res.level);
      el.setAttribute('aria-invalid', res.level === 'hard' ? 'true' : 'false');
      showMsg(el, res);
    } else {
      el.setAttribute('data-lvl', '');
      el.setAttribute('aria-invalid', 'false');
      removeMsg(el);
    }
  };

  /** 给一屏里的数值框补 .fld / data-w / data-rule（unitWrap 生成的没有这些属性） */
  FH.decorate = function (rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return;
    var list = rootEl.querySelectorAll('input[type="number"], input[data-num="1"]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var w = num(el.getAttribute('data-w'), 0) ||
        widthOfPath(el.getAttribute('data-path')) || widthOfId(el.id) || 5;
      var rule = el.getAttribute('data-rule') ||
        ruleOfPath(el.getAttribute('data-path')) || ruleOfId(el.id) || '';
      el.classList.add('fld');
      if (!el.getAttribute('data-w')) el.setAttribute('data-w', String(w));
      if (rule && !el.getAttribute('data-rule')) el.setAttribute('data-rule', rule);
      el.__fldBase = 0;
    }
  };

  /** 重绘后：补属性 → 按当前值恢复校验态与长数值宽度。
   *  46 的 change 会整页重画，不跑这一遍，提示会在失焦后凭空消失。 */
  FH.afterRender = function (rootEl) {
    if (!rootEl) return;
    FH.decorate(rootEl);
    var list = rootEl.querySelectorAll('.fld');
    for (var i = 0; i < list.length; i++) {
      FH.validate(list[i]);
      fitWidth(list[i]);
    }
  };

  FH.wire = function () {
    /* 42 与 46 共用同一个 #view 容器。把监听挂在 #view 上、再用元素上的
       标记防重，会导致先渲染的那一页把后一页的监听吞掉；挂在 document
       上只装一次，两页都收得到，也不需要清理。 */
    if (FH.__wired) return;
    FH.__wired = true;
    var doc = document;

    /* focusin/focusout 用委托：42 的表格行和 46 的整页都会重建，
       逐个 addEventListener 会在重绘后全部丢失。 */
    doc.addEventListener('focusin', function (e) {
      if (!isNumericInput(e.target)) return;
      fitWidth(e.target);
      FH.validate(e.target);
    });
    doc.addEventListener('focusout', function (e) {
      if (!isNumericInput(e.target)) return;
      fitWidth(e.target);
      FH.validate(e.target);
    });
    doc.addEventListener('input', function (e) {
      if (!isNumericInput(e.target)) return;
      FH.validate(e.target);
      fitWidth(e.target);
    });
    doc.addEventListener('change', function (e) {
      if (!isNumericInput(e.target)) return;
      FH.validate(e.target);
      fitWidth(e.target);
    });
  };

  /* 给 46/42 的 unitWrap 调用点统一换名：保持调用签名不变 */
  var fldWrap = UI.fldWrap;

  /** 卡片外壳：统一标题条 + 内容区 + 可选页脚。表格类内容自动去内边距以贴边。
   *  headExtra（v1.2）：标题条右侧的额外按钮。只由 cardWater 传，其余调用方
   *  忽略第 5 个参数即可——不为了一个按钮去改七处调用。 */
  function card(title, icoHtml, body, foot, headExtra) {
    var flush = /^<div class="table-wrap"/.test(String(body).replace(/^\s+/, ''));
    return '<section class="card">' +
      '<div class="card__head">' +
        '<h2>' + (icoHtml ? '<span style="color:var(--amber-dim);display:inline-flex">' + icoHtml + '</span>' : '') +
        esc(title) + '</h2>' +
        '<span class="spacer"></span>' +
        (headExtra || '') +
      '</div>' +
      '<div class="card__body' + (flush ? ' card__body--flush' : '') + '">' + body + '</div>' +
      (foot ? '<div class="card__foot">' + foot + '</div>' : '') +
      '</section>';
  }

  function cellNum(path, value, unit, digits, placeholder, w) {
    var shown = (digits >= 1) ? fmt(value, digits) : fmt(value, 0);
    var rule = ruleOfPath(path);
    return '<div class="cell-unit-row">' +
      '<input class="cell-input fld" type="number" step="' + (digits >= 2 ? '0.01' : '1') + '" min="0" ' +
      'value="' + attr(shown) + '" data-path="' + attr(path) + '" data-num="1" ' +
      'data-w="' + attr(num(w, 0) || widthOfPath(path) || 5) + '"' +
      (rule ? ' data-rule="' + attr(rule) + '"' : '') +
      (placeholder ? ' placeholder="' + attr(placeholder) + '"' : '') +
      ' aria-label="' + attr(path) + '">' +
      (unit ? '<span class="cell-unit">' + esc(unit) + '</span>' : '') +
      '</div>';
  }

  /* ======================================================================
   * C. 渲染
   * ====================================================================*/

  /* 主列顺序 = 酿造流程顺序（v1.9 重排）：
       基本信息（配方是什么）→ 麦芽 → 酒花 → 辅料 → 水化学（配方由什么构成）
       → 糖化 → 回旋沉淀 → 冷却与充氧 → 酵母与发酵 → 后熟与冷降（怎么走）。
     v1.8 之前"酵母与发酵"排在第 4 位（紧跟酒花），而它描述的是**糖化之后**的
     工序，读起来像"先选酵母再糖化"。用户的原话是"应该把酵母与发酵往后放，
     放到糖化后面"。新区插在糖化与酵母之间，是因为回旋/冷却本身也在糖化之后、
     接种之前；后熟在发酵之后。左侧面板「当前配方结构」与「工艺」树必须**同序**
     （js/39c 的 LP_STRUCT / LP_PROCESS 两张表），测试里有显式有序断言。 */
  function render(el) {
    host = el;
    var r = UI.recipe();

    el.innerHTML =
      '<div class="split">' +
        '<div class="stack">' +
          cardBasic(r) +
          cardMalts(r) +
          cardHops(r) +
          cardAdjuncts(r) +
          cardWater(r) +
          cardMash(r) +
          cardWhirlpool(r) +
          cardChill(r) +
          cardYeast(r) +
          cardMature(r) +
        '</div>' +
        '<div class="stack sticky-panel">' +
          cardMetrics() +
          cardActions() +
        '</div>' +
      '</div>';

    UI.bindCombos(el);
    bindEvents(el);
    repaint();
    /* 宽度属性在 HTML 里已写好，但 unitWrap 那批只有 id；校验态也要按
       当前值恢复一次（切配方/切视图回来时不能丢）。 */
    FH.wire();
    FH.afterRender(el);
  }

  /* ---------------------------------------------------------- 基本信息 */

  /**
   * 紧凑字段：标签一行，**输入框与 hint 同一行**。
   *
   * 为什么改（v1.6）：原来是「标签 / 输入框 / hint」三行竖排，而数值框按 .fld
   * 只占 5–6ch（约 63–73px），一列有 200–387px 宽 —— 每个字段右边的空白比输入框
   * 本身还宽，hint 却另起一行占掉 20px。六个字段两行铺开就是 194px，
   * 而它们承载的信息只有 6 个数。
   *
   * 现在把 hint 挪到输入框右侧：占的正是原来那段空白，字段高从 91.1 → 65.9。
   * hint **不删也不藏**：它是这个软件"教用户"的部分（为什么是 20 而不是 5）。
   * 放不下时单行省略，全文走 title —— 见 lead 允许的降级方式。
   */
  function compactField(id, labelText, value, unit, opts, hintText, hintId) {
    var html = fldWrap(id, value, unit, opts).replace(
      '<div class="input-wrap">', '<div class="input-wrap" style="flex:0 0 auto">');
    return '<div class="field">' +
      '<label class="field__label" for="' + attr(id) + '">' + esc(labelText) + '</label>' +
      '<div style="display:flex;align-items:center;gap:8px;min-width:0">' +
        html +
        /* 单行省略：min-width:0 + nowrap + ellipsis 三件套缺一不可，
           少一个 flex 子项就会撑破栅格。title 兜住被省略的部分。 */
        '<span class="field__hint"' + (hintId ? ' id="' + attr(hintId) + '"' : '') +
          ' style="flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;' +
          'text-overflow:ellipsis" title="' + attr(hintText) + '">' + esc(hintText) + '</span>' +
      '</div>' +
    '</div>';
  }

  /**
   * 「这套参数会把这锅酒变成什么样」—— 四个派生量。
   *
   * 定位（lead 划的线）：不是又一个计算器，而是**从上面那 6 个输入直接推出来的后果**。
   * 所以这里没有一个可填的框，全部只读，且每个数都来自计算内核（见 paintBasicDerived）。
   *
   * 为什么是 4 个而不是 6 个：每个都必须能回答一个"看到之后会改输入"的问题
   * （锅装不装得下 / 麦还差多少 / 称多少糖 / 备多少水）。
   * 候选里被砍掉的两个写在 paintBasicDerived 的注释里。
   */
  function derivedStrip() {
    var wrap = 'style="grid-column:1/-1;display:grid;' +
      'grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:1px;' +
      'background:var(--line);border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden"';
    return '<div id="basic-derived" ' + wrap + ' role="group" aria-label="由上面六个参数推出的结果">' +
      derivedCell('boil', '锅至少装得下', '煮沸前体积：批次量 + 沉渣损失 + 发酵罐残液 + 蒸发 + 酒花吸水。买锅 / 选锅看的是这个数，不是批次量。') +
      derivedCell('malt', '麦量还要调多少', '风格 OG 区间中值 − 当前麦单实际能到的 OG，按同一配比等比换算成麦量。') +
      derivedCell('sugar', '装瓶要称多少糖', '按碳化度与发酵后残压算出还需补的 CO₂，再折成糖重。装瓶时按这个数称。') +
      derivedCell('water', '一共要备多少水', '糖化水 + 洗糟水。既是要备的水量，也是水质调节（调离子 / 除氯）的用量基数。') +
    '</div>';
  }

  function derivedCell(key, question, why) {
    return '<div style="background:var(--bg-2);padding:6px 10px;min-width:0">' +
      '<div class="metric__label" style="font-size:12.5px;letter-spacing:.3px;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis" title="' + attr(why) + '">' + esc(question) + '</div>' +
      /* 值 + 单位用现成的 .metric__val：.metric__val.is-flash 的琥珀闪烁是已有的，
         不新造动效。副标题单独一个 <small>，它不闪（闪的是"变了"这件事，
         副标题只是背景信息）。 */
      '<div style="display:flex;align-items:baseline;gap:6px;min-width:0">' +
        '<span class="metric__val" id="dv-' + key + '" data-dv="' + attr(key) + '" ' +
          'style="font-size:16.5px;letter-spacing:-.2px;white-space:nowrap">—</span>' +
        '<small id="dv-' + key + '-sub" style="font-size:12.5px;color:var(--tx-3);font-variant-numeric:tabular-nums;' +
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></small>' +
      '</div>' +
    '</div>';
  }

  /**
   * 「载入入门配方」按钮的文案。
   *
   * 为什么文案要跟着风格走（v1.7）：按钮原来固定写"载入一套入门配方"、
   * 点了却总是塞一份美式琥珀艾尔。用户在风格下拉里选了 21A 美式 IPA，
   * 载入后风格匹配条立刻整片标红——第一反应是"这软件算错了"，
   * 而不是"原来基线是固定的"。所以：选了风格就说清载入哪一档，
   * 没选才退回泛称。
   */
  function starterLabel(styleId) {
    var st = styleId ? UI.byId('styles', styleId) : null;
    return st ? ('载入「' + (st.name || st.id) + '」入门配方') : '载入一套入门配方';
  }

  /** 风格下拉 change 后刷新按钮文案（不重渲染整个基本信息卡，只改这一个文本） */
  function refreshStarterLabel(styleId) {
    var btn = document.querySelector('[data-act="load-default"]');
    if (!btn) return;
    btn.textContent = starterLabel(styleId);
    btn.title = styleId
      ? '按 20 L 生成一份该风格的可酿基线，载入后可继续改'
      : '当前未指定风格，载入一份通用的可酿基线';
  }

  function cardBasic(r) {
    var styles = UI.pool('styles');
    var styleOpts = '<option value="">— 未指定风格 —</option>';
    for (var i = 0; i < styles.length; i++) {
      var s = styles[i];
      styleOpts += '<option value="' + attr(s.id) + '"' + (s.id === r.styleId ? ' selected' : '') + '>' +
        esc((s.code ? s.code + ' · ' : '') + (s.name || s.id)) + '</option>';
    }

    return card('基本信息', icon('edit', 14),
      /* row-gap 8 而不是全局的 12：六个数排成两行，行距只用来分组，
         12px 会让"同一组参数"读起来像三组。12 → 8 省 8px，视觉也更成组。 */
      '<div class="grid-3" style="row-gap:8px">' +
        '<div class="field" style="grid-column:span 2">' +
          '<label class="field__label" for="f-name">配方名称 <span class="req">*</span></label>' +
          '<input class="input" id="f-name" type="text" maxlength="60" value="' + attr(r.name) + '" ' +
          'data-path="name" placeholder="例如：秋分琥珀艾尔">' +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label" for="f-style">啤酒风格</label>' +
          '<select class="select" id="f-style" data-path="styleId">' + styleOpts + '</select>' +
          /* 按钮从卡片页脚挪到这里（v1.7）：它是"按所选风格生成基线"，
             离风格下拉越近，因果关系越明显。页脚那个位置在右上角，
             跟"啤酒风格"隔了整整一张卡，用户会以为它跟本页内容无关。 */
          '<button type="button" class="btn btn-ghost btn-sm" data-act="load-default" ' +
            'style="margin-top:6px;width:100%;justify-content:center" ' +
            'title="按 20 L 生成一份该风格的可酿基线，载入后可继续改">' +
            esc(starterLabel(r.styleId)) + '</button>' +
        '</div>' +
        compactField('f-vol', '批次量', fmt(r.batchSize, 1), 'L',
          { path: 'batchSize', step: '0.5', min: 1, max: 200 }, '家用常规 18–22 L', 'hint-vol') +
        compactField('f-eff', '糖化效率', fmt(r.efficiency, 0), '%',
          { path: 'efficiency', step: '1', min: 10, max: 100 }, '首次设备建议 70–75%') +
        compactField('f-evap', '蒸发率', fmt(r.evaporationRate, 0), '%/h',
          { path: 'evaporationRate', step: '1', min: 0, max: 40 }, '敞口锅约 8–12%') +
        compactField('f-boil', '煮沸时长', fmt(r.boilTime, 0), 'min',
          { path: 'boilTime', step: '5', min: 5, max: 240 }, '皮尔森类建议 90') +
        compactField('f-carb', '碳化度', fmt(num(r.carbonation.targetVol, 2.4), 1), 'vol',
          { path: 'carbonation.targetVol', step: '0.1', min: 1, max: 5 }, '英式艾尔 1.8–2.2') +
        compactField('f-trub', '沉渣损失', fmt(r.trubLoss, 1), 'L',
          { path: 'trubLoss', step: '0.1', min: 0, max: 10 }, '热渣与酵母泥占用') +
        derivedStrip() +
        '<div class="field" style="grid-column:1/-1">' +
          '<label class="field__label" for="f-notes">备注 / 设计意图</label>' +
          '<textarea class="textarea" id="f-notes" rows="2" data-path="notes" ' +
          'placeholder="为什么这样配：想突出什么风味、参考了哪款酒…">' + esc(r.notes) + '</textarea>' +
        '</div>' +
      '</div>' +
      (styles.length ? '' : '<p class="card__hint">风格库尚未载入，风格匹配与区间校验暂不可用。可先按自由配方继续编辑。</p>'),
      '<span class="u-xs u-dim">没有头绪时，先拿一套可酿的基线改</span>');
  }

  /**
   * 派生量的取数与展示。
   *
   * ⚠️ 规矩：**这里不许出现任何酿酒公式**。所有值要么直接读 UI.lastCalc
   *    （= BREW.Calc.calcRecipe 的结果），要么是对它的**线性换算**
   *    （麦量 ↔ OG 只差一个比例系数，见下面 maltNeed 的注释）。
   *    这个项目已经因为"同一件事两处实现"翻过车（SRM↔EBC 各写一份），
   *    所以这里宁可少一个数，也不抄一遍 Tinseth 之类的算式。
   *
   * 被砍掉的候选（都算过，但不符合"看到会改输入"这一条）：
   *   · 煮沸浓缩比（preBoil → postBoil 的 OG 抬升）：信息性，看到之后不会改任何输入，
   *     而且 preBoil 已经在 1 号格里给了；它只是同一个数的另一种说法。
   *   · 装瓶数（20 L ≈ 40 瓶 500ml）：只是个除法，跟这 6 个参数没有酿造学关系，
   *     属于"看起来很贴心但没人看"。批次数不等于瓶数，还取决于瓶型。
   */
  function paintBasicDerived(c, r) {
    c = c || {};
    var carb = c.carbonation || {};

    /* ① 煮沸前体积：直接读内核的 volumeBalance 结果 */
    var pre = num(c.preBoilVolume, 0);
    flashIfChanged('dv-boil', pre > 0 ? fmt(pre, 1) + ' L' : '—');
    setText('dv-boil-sub', pre > 0 ? '含蒸发 ' + fmt(c.evaporation, 1) + ' L' : '');
    var boilTitle = pre > 0
      ? '批次量 ' + fmt(r.batchSize, 1) + ' L + 沉渣损失 ' + fmt(r.trubLoss, 1) +
        ' L + 发酵罐残液 ' + fmt(r.fermenterLoss, 1) + ' L + 蒸发 ' +
        fmt(c.evaporation, 1) + ' L + 酒花吸水 ' + fmt(c.hopAbsorption, 1) + ' L = ' + fmt(pre, 1) + ' L。' +
        '锅容要往上留一点余量，否则沸腾时容易溢。'
      : '加了麦芽之后才有煮沸前体积。';
    setAttr('dv-boil', 'title', boilTitle);

    /* ② 麦量还差多少：OG 对麦量是线性的（points = Σ ppg×kg×K×效率/批次量），
       所以"要多少麦"= 现麦量 × 目标点数 / 现点数。OG 本身仍是内核算的。 */
    var mn = maltNeed(r, c);
    if (!mn) {
      flashIfChanged('dv-malt', '—');
      setText('dv-malt-sub', '还没有麦芽');
      setAttr('dv-malt', 'title', '先在麦芽表里加基础麦芽，才谈得上"差多少"。');
    } else if (mn.noStyle) {
      flashIfChanged('dv-malt', '—');
      setText('dv-malt-sub', '先选风格');
      setAttr('dv-malt', 'title', '没有风格就没有靶子。上面选一个风格，这里会算出"按现在的麦单还差多少 kg"。');
    } else {
      var d = mn.delta;
      var absTxt = Math.abs(d) < 0.05 ? '刚好' : (d > 0 ? '+' : '−') + fmt(Math.abs(d), 2) + ' kg';
      flashIfChanged('dv-malt', absTxt);
      setText('dv-malt-sub', absTxt === '刚好' ? '在区间内' : '要 ' + fmt(mn.kgNeed, 2) + ' kg');
      setAttr('dv-malt', 'title',
        (mn.styleName ? mn.styleName + ' 的' : '风格的') + ' OG 区间 ' + UI.sg(mn.range.lo) + '–' + UI.sg(mn.range.hi) +
        '，按中值 ' + UI.sg(mn.target) + ' 计。现在这张麦单（' + fmt(mn.kgNow, 2) + ' kg）在这套效率下出 ' +
        UI.sg(mn.ogNow) + '。等比放大整张麦单到 ' + fmt(mn.kgNeed, 2) + ' kg 即可落进区间；' +
        '不想加麦的话，降批次量或提高糖化效率是等效的两条路。');
    }

    /* ③ 装瓶糖量：直接用内核 carbonation() 的结果，这里只做单位与文案 */
    var type = carb.sugarType || (r.carbonation && r.carbonation.sugarType) || 'sucrose';
    var g = carb.grams ? num(carb.grams[type], NaN) : NaN;
    if (!isFinite(g)) g = num(carb.recommended, NaN);
    var sugarName = { sucrose: '蔗糖', dextrose: '葡萄糖', dme: '麦芽提取物', honey: '蜂蜜' }[type] || '糖';
    flashIfChanged('dv-sugar', isFinite(g) && g > 0 ? fmt(g, 0) + ' g' : '—');
    setText('dv-sugar-sub', isFinite(g) && g > 0
      ? fmt(carb.targetVol, 1) + ' vol ' + sugarName : '');
    setAttr('dv-sugar', 'title', isFinite(g) && g > 0
      ? '目标 ' + fmt(carb.targetVol, 1) + ' vol，发酵后残压 ' + fmt(carb.residualVol, 2) + ' vol，' +
        '还差 ' + fmt(carb.neededVol, 2) + ' vol；按 ' + sugarName + ' 折算是 ' + fmt(g, 0) + ' g ' +
        '(' + fmt(num(r.batchSize, 0), 1) + ' L)。' + (carb.warning ? '⚠ ' + carb.warning : '')
      : '碳化度或批次量算不出糖量。');

    /* ④ 总用水：糖化水 + 洗糟水，同样直读内核 */
    var tw = num(c.totalWater, 0);
    flashIfChanged('dv-water', tw > 0 ? fmt(tw, 1) + ' L' : '—');
    setText('dv-water-sub', tw > 0 ? '洗糟 ' + fmt(c.spargeWater, 1) + ' L' : '');
    setAttr('dv-water', 'title', tw > 0
      ? '糖化水 ' + fmt(c.mashWater, 1) + ' L + 洗糟水 ' + fmt(c.spargeWater, 1) + ' L = ' + fmt(tw, 1) + ' L。' +
        '一次把水备齐，水质调节按这个总量算——只按批次量备水是最常见的低估。'
      : '还没有可算的用水量（需要麦芽与批次量）。');
  }

  /**
   * 「按现在的麦单，离风格 OG 还差多少麦」。
   * 只用两条：内核给的 og、以及 OG 对麦量的线性关系。不重算 gravity。
   */
  function maltNeed(r, c) {
    var ogNow = num(c.og, 0);
    if (!(ogNow > 1.0001)) return null;
    var kgNow = 0;
    var ferm = r.fermentables || [];
    for (var i = 0; i < ferm.length; i++) kgNow += Math.max(0, num(ferm[i].amount, 0));
    if (kgNow <= 0) return null;

    var style = r.styleId ? UI.byId('styles', r.styleId) : null;
    var rg = style && UI.styleRange ? UI.styleRange(style, 'og') : null;
    if (!rg || !isFinite(rg.lo) || !isFinite(rg.hi) || !(rg.hi > 0)) return { noStyle: true };

    var target = (rg.lo + rg.hi) / 2;
    var k = (target - 1) / (ogNow - 1);
    if (!isFinite(k) || k <= 0) return { noStyle: true };
    return {
      target: target, range: rg, kgNow: kgNow, ogNow: ogNow,
      kgNeed: kgNow * k, delta: kgNow * k - kgNow,
      styleName: style.code ? (style.code + ' ' + (style.name || '')) : (style.name || '')
    };
  }

  function setAttr(id, name, value) {
    var el = document.getElementById(id);
    if (el) el.setAttribute(name, value == null ? '' : String(value));
  }

  /* -------------------------------------------------------------- 麦芽表 */
  function cardMalts(r) {
    var rows = '';
    if (!r.fermentables.length) {
      rows = '<tr><td colspan="6">' + UI.emptyState('还没有麦芽',
        '配方的地基：先加一款基础麦芽（淡色艾尔 / 皮尔森 / 马里斯奥特），再叠加结晶与烘烤麦芽。',
        { small: true, art: 'beer', size: 48 }) + '</td></tr>';
    } else {
      for (var i = 0; i < r.fermentables.length; i++) rows += maltRow(r.fermentables[i], i, r);
    }

    return card('麦芽与谷物', icon('sack', 14),
      '<div class="table-wrap"><table class="table table--compact">' +
        '<thead><tr>' +
          '<th style="min-width:190px">原料</th>' +
          '<th class="u-right" style="width:92px">用量</th>' +
          '<th style="width:108px">占比</th>' +
          '<th class="u-right" style="width:74px">色度 °L</th>' +
          '<th class="u-right" style="width:66px">ppg</th>' +
          '<th class="col-act"></th>' +
        '</tr></thead>' +
        '<tbody data-rows="fermentables">' + rows + '</tbody>' +
        '<tfoot><tr>' +
          '<td>合计</td>' +
          '<td class="num" id="malt-total">—</td>' +
          '<td colspan="4" id="malt-foot-note" class="u-xs u-dim"></td>' +
        '</tr></tfoot>' +
          '</table></div>' +
        /* v1.5：深色麦芽占比（结晶 + 烘烤）提示。放在合计行下方，
           不塞进任何单元格——它判的是整张表，不是某一行。 */
        '<div class="fld-rel" id="malt-rel"></div>',
      '<button type="button" class="btn btn-ghost btn-sm" data-act="add-malt">' + icon('plus', 13) + '添加麦芽</button>' +
      '<span class="u-xs u-dim" id="malt-hint"></span>');
  }

  /** 是否显示"建议 ≤X%"的行业惯例区间。设置项 showUsageRange 的唯一消费点。
   *  注意它跟超量告警（usageWarn）是两件事：关掉区间只是不提示惯例上限，
   *  真的超了该报警还是报——那是安全网，不能跟显示偏好绑在一起。 */
  function showUsageRange() {
    try {
      if (BREW.Store && BREW.Store.get) return BREW.Store.get('settings.showUsageRange', true) !== false;
    } catch (e) { /* 设置读不出来就按默认显示 */ }
    return true;
  }

  /**
   * 行首库存徽章（v1.2）。**四态**，不是两态：
   *   未录库存（灰） / 单位不符（黄） / 够（绿 ✓） / 缺（红 ✗ 缺 1.2kg）
   * 为什么要分四态：「没录过库存」和「确实不够」是两件事。第一次打开软件时
   * 库存是空的，如果一律红叉，用户会以为软件算错了而不是自己还没录数据。
   * 库存是增强信息，任何一步算不出来都返回空串，不能把配方表撑坏。
   */
  function stockFlag(kind, id, need, unit) {
    if (!UI.InventoryPanel || typeof UI.InventoryPanel.check !== 'function') return '';
    if (!id) return '';
    var res = null;
    try {
      res = UI.InventoryPanel.check(kind, id, need, unit);
    } catch (e) {
      return '';
    }
    if (!res) return '';
    /* tracked:false 有两种情况：设置关了（什么都不显示）或从没记过账（灰点） */
    if (!res.tracked) {
      if (res.suppressed) return '';
      return '<span class="stock-flag stock-flag--none" title="这个原料还没有任何出入库记录，' +
        '所以不算缺货。到「原料库 → 库存」记一笔入库即可">未录库存</span>';
    }
    if (res.unitMismatch) {
      return '<span class="stock-flag stock-flag--warn" title="库存记的单位是 ' +
        attr(String(res.haveUnit || '—')) + '，这一行要的是 ' + attr(unit) + '，不能直接换算">单位不符</span>';
    }
    if (res.enough) {
      return '<span class="stock-flag stock-flag--ok" title="库存 ' + attr(fmt(res.have, 2) + ' ' + unit) + '">' +
        icon('check', 10) + '</span>';
    }
    return '<span class="stock-flag stock-flag--short" title="库存 ' + attr(fmt(res.have, 2) + ' ' + unit) +
      '，这一行要 ' + attr(fmt(need, 2) + ' ' + unit) + '">' +
      icon('x', 10) + '缺 ' + esc(fmt(res.short, 1) + unit) + '</span>';
  }

  function maltRow(m, i, r) {
    var cats = UI.db().maltCats || {};
    var cat = cats[m.cat];
    var total = 0;
    for (var t = 0; t < r.fermentables.length; t++) total += num(r.fermentables[t].amount, 0);
    var pct = total > 0 ? num(m.amount, 0) / total * 100 : 0;
    var over = m.maxPct && pct > m.maxPct + 0.01;
    var col = cat && cat.color ? cat.color : '#c47a35';
    var cap = num(m.maxPct, 0);
    var rangeHint = (showUsageRange() && cap > 0 && cap < 100)
      ? '<div class="weightbar__range">建议 ≤' + esc(fmt(cap, 0)) + '%</div>'
      : '';

    return '<tr data-row="fermentables" data-idx="' + i + '">' +
      '<td>' + stockFlag('malts', m.id, num(m.amount, 0), 'kg') +
        UI.combo('malts', m.id, { path: 'fermentables.' + i + '.id', placeholder: '选择麦芽' }) + '</td>' +
      '<td>' + cellNum('fermentables.' + i + '.amount', num(m.amount, 0), 'kg', 2) + '</td>' +
      '<td>' +
        '<div class="weightbar">' +
          '<div class="weightbar__track"><div class="weightbar__fill" style="width:' +
            attr(Math.min(100, pct)) + '%;background:' + attr(col) + '"></div></div>' +
          '<div class="weightbar__col">' +
            '<div class="weightbar__pct"' + (over ? ' style="color:var(--warn)"' : '') + '>' + fmt(pct, 1) + '%</div>' +
            rangeHint +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td>' + cellNum('fermentables.' + i + '.lov', num(m.lov, 0), '', 0) + '</td>' +
      '<td>' + cellNum('fermentables.' + i + '.ppg', num(m.ppg, 0), '', 0) + '</td>' +
      '<td class="col-act"><button type="button" class="btn btn-quiet btn-icon" data-act="del-malt" ' +
        'data-idx="' + i + '" title="删除这一行" aria-label="删除第 ' + (i + 1) + ' 行麦芽">' + icon('trash', 14) + '</button></td>' +
      '</tr>';
  }

  /* -------------------------------------------------------------- 酒花表 */
  function cardHops(r) {
    var rows = '';
    if (!r.hops.length) {
      rows = '<tr><td colspan="7">' + UI.emptyState('还没有酒花',
        '苦度来自煮沸阶段的 α 酸异构化。典型做法：60 min 一次苦化 + 5 min 一次风味 + 熄火回旋一次香气。',
        { small: true, art: 'beer', size: 48 }) + '</td></tr>';
    } else {
      for (var i = 0; i < r.hops.length; i++) rows += hopRow(r.hops[i], i);
    }

    return card('酒花', icon('drop', 14),
      '<div class="table-wrap"><table class="table table--compact">' +
        '<thead><tr>' +
          '<th style="min-width:180px">酒花</th>' +
          '<th class="u-right" style="width:84px">用量</th>' +
          '<th style="width:104px">阶段</th>' +
          '<th class="u-right" style="width:76px">时间</th>' +
          '<th class="u-right" style="width:70px">α酸 %</th>' +
          '<th class="u-right" style="width:70px">IBU</th>' +
          '<th class="col-act"></th>' +
        '</tr></thead>' +
        '<tbody data-rows="hops">' + rows + '</tbody>' +
        '<tfoot><tr>' +
          '<td>合计</td>' +
          '<td class="num" id="hop-total">—</td>' +
          '<td colspan="3" id="hop-foot-note" class="u-xs u-dim"></td>' +
          '<td class="num" id="hop-ibu">—</td>' +
          '<td></td>' +
        '</tr></tfoot>' +
      '</table></div>',
      '<button type="button" class="btn btn-ghost btn-sm" data-act="add-hop" style="display:inline-flex;align-items:center;gap:6px">' +
        icon('plus', 13) + '添加酒花</button>' +
      '<span class="u-xs u-dim">时间：煮沸=分钟，干投=天，回旋=分钟</span>');
  }

  function hopRow(h, i) {
    var stageSel = '';
    for (var s = 0; s < STAGES.length; s++) {
      stageSel += '<option value="' + STAGES[s].v + '"' + (STAGES[s].v === h.stage ? ' selected' : '') + '>' +
        STAGES[s].t + '</option>';
    }
    return '<tr data-row="hops" data-idx="' + i + '">' +
      '<td>' + stockFlag('hops', h.id, num(h.amount, 0), 'g') +
        UI.combo('hops', h.id, { path: 'hops.' + i + '.id', placeholder: '选择酒花' }) + '</td>' +
      '<td>' + cellNum('hops.' + i + '.amount', num(h.amount, 0), 'g', 1) + '</td>' +
      '<td><select class="select select--sm" data-path="hops.' + i + '.stage" aria-label="投放阶段">' +
        stageSel + '</select>' +
        /* v1.9：回旋投花的温度在这里**只读**显示一行。可编辑的框只有一个，
           在「回旋沉淀」区；两处读的都是 hops[i].whirlpoolTemp，
           各存一份的话 20-calc 只会认其中一个（见 mirrorWhirlpool）。 */
        (String(h.stage) === 'whirlpool'
          ? '<div class="u-xs u-dim" data-wp="' + i + '"' +
            ' style="margin-top:2px;font-variant-numeric:tabular-nums"></div>'
          : '') +
      '</td>' +
      '<td>' + cellNum('hops.' + i + '.time', num(h.time, 0), 'min', 0) + '</td>' +
      '<td>' + cellNum('hops.' + i + '.aa', num(h.aa, 0), '%', 1) + '</td>' +
      '<td class="num u-muted" data-ibu="' + i + '">—</td>' +
      '<td class="col-act"><button type="button" class="btn btn-quiet btn-icon" data-act="del-hop" ' +
        'data-idx="' + i + '" title="删除这一行" aria-label="删除第 ' + (i + 1) + ' 行酒花">' + icon('trash', 14) + '</button></td>' +
      '</tr>';
  }

  /* ---------------------------------------------------------------- 酵母 */
  function cardYeast(r) {
    var body = '';
    if (!r.yeasts.length) {
      body = UI.emptyState('还没有选酵母',
        '酵母决定发酵度与酯香走向：英式艾尔偏果香、美式偏干净、比利时偏酚香、拉格需低温长时间。',
        { small: true, art: 'beer', size: 48 });
    } else {
      for (var i = 0; i < r.yeasts.length; i++) {
        var y = r.yeasts[i];
        var range = (y.tempMin && y.tempMax) ? '推荐 ' + y.tempMin + '–' + y.tempMax + ' °C' : '';
        body += '<div style="border-bottom:1px solid var(--line);padding:10px 14px">' +
          '<div class="grid-3" style="grid-template-columns:1.6fr 1fr 1fr 1fr 44px">' +
            '<div class="field">' +
              '<label class="field__label">菌株</label>' +
              UI.combo('yeasts', y.id, { path: 'yeasts.' + i + '.id', placeholder: '选择酵母' }) +
            '</div>' +
            '<div class="field">' +
              '<label class="field__label">接种量</label>' +
              fldWrap('y-amt-' + i, fmt(y.amount, 1), 'g',
                { path: 'yeasts.' + i + '.amount', step: '0.5', min: 0 }) +
            '</div>' +
            '<div class="field">' +
              '<label class="field__label">发酵温度</label>' +
              fldWrap('y-temp-' + i, fmt(y.tempC, 0), '°C',
                { path: 'yeasts.' + i + '.tempC', step: '0.5', min: 5, max: 40, ariaLabel: '发酵温度' }) +
            '</div>' +
            '<div class="field">' +
              '<label class="field__label">酵母标称 ADF</label>' +
              fldWrap('y-att-' + i, fmt(y.att, 0), '%',
                { path: 'yeasts.' + i + '.att', step: '1', min: 30, max: 100, ariaLabel: '酵母标称表观发酵度' }) +
            '</div>' +
            '<div class="field">' +
              '<label class="field__label">删</label>' +
              '<button type="button" class="btn btn-quiet btn-icon" data-act="del-yeast" data-idx="' + i + '" ' +
              'aria-label="删除这株酵母">' + icon('trash', 14) + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="row row--tight u-xs u-dim mt-8">' +
            '<span>干酵母常见 11 g/包，液体酵母约 100 mL</span>' +
            (range ? '<span>·</span><span>' + esc(range) + '</span>' : '') +
          '</div>' +
        '</div>';
      }
    }

    return card('酵母与发酵', icon('flask', 14), body,
      '<button type="button" class="btn btn-ghost btn-sm" data-act="add-yeast">' + icon('plus', 13) + '添加菌株</button>' +
      '<span class="u-xs u-dim">混合发酵可按比例分配接种量</span>');
  }

  /* ---------------------------------------------------------------- 辅料 */
  function cardAdjuncts(r) {
    var rows = '';
    if (!r.adjuncts.length) {
      rows = '<tr><td colspan="5" class="table-empty">' +
        '无辅料。澄清剂（爱尔兰苔 / 硅藻土）、酵母营养盐、香料、果泥等加在这里。' +
        '</td></tr>';
    } else {
      for (var i = 0; i < r.adjuncts.length; i++) {
        var a = r.adjuncts[i];
        rows += '<tr data-row="adjuncts" data-idx="' + i + '">' +
          '<td>' + UI.combo('adjuncts', a.id, { path: 'adjuncts.' + i + '.id', placeholder: '选择辅料' }) + '</td>' +
          '<td>' + cellNum('adjuncts.' + i + '.amount', num(a.amount, 0), a.unit || 'g', 1) + '</td>' +
          '<td><select class="select select--sm" data-path="adjuncts.' + i + '.stage" aria-label="添加阶段">' +
            stageOptions(a.stage, ['mash', 'boil', 'whirlpool', 'fermenter', 'packaging']) +
          '</select></td>' +
          '<td><input class="cell-input cell-input--left" type="text" placeholder="备注" aria-label="备注" ' +
            'value="' + attr(a.note || '') + '" data-path="adjuncts.' + i + '.note"></td>' +
          '<td class="col-act"><button type="button" class="btn btn-quiet btn-icon" data-act="del-adj" data-idx="' + i + '" ' +
            'aria-label="删除第 ' + (i + 1) + ' 行辅料">' + icon('trash', 14) + '</button></td>' +
          '</tr>';
      }
    }

    return card('辅料与其他添加', icon('layers', 14),
      '<div class="table-wrap"><table class="table table--compact">' +
        '<thead><tr><th style="min-width:180px">辅料</th>' +
        '<th class="u-right" style="width:84px">用量</th>' +
        '<th style="width:110px">阶段</th>' +
        '<th>备注</th><th class="col-act"></th></tr></thead>' +
        '<tbody data-rows="adjuncts">' + rows + '</tbody></table></div>',
      '<button type="button" class="btn btn-ghost btn-sm" data-act="add-adj">' + icon('plus', 13) + '添加辅料</button>');
  }

  function stageOptions(current, list) {
    var html = '';
    for (var i = 0; i < list.length; i++) {
      html += '<option value="' + list[i] + '"' + (list[i] === current ? ' selected' : '') + '>' +
        UI.stageLabel(list[i]) + '</option>';
    }
    return html;
  }

  /* -------------------------------------------------------------- 水化学 */
  function cardWater(r) {
    var src = r.water.source;
    var ions = [
      { k: 'ca', label: '钙 Ca²⁺', hint: '50–150' },
      { k: 'mg', label: '镁 Mg²⁺', hint: '10–30' },
      { k: 'na', label: '钠 Na⁺', hint: '< 100' },
      { k: 'cl', label: '氯化物 Cl⁻', hint: '50–150' },
      { k: 'so4', label: '硫酸盐 SO₄²⁻', hint: '50–350' },
      { k: 'hco3', label: '碳酸氢盐 HCO₃⁻', hint: '< 250' }
    ];
    var ionHtml = '';
    for (var i = 0; i < ions.length; i++) {
      ionHtml += '<div class="field">' +
        '<label class="field__label" for="w-' + ions[i].k + '">' + esc(ions[i].label) +
        ' <span class="u-dim u-xs">' + esc(ions[i].hint) + '</span></label>' +
        fldWrap('w-' + ions[i].k, fmt(src[ions[i].k], 0), 'ppm',
          { path: 'water.source.' + ions[i].k, step: '1', min: 0 }) +
        '</div>';
    }

    var saltRows = '';
    if (!r.water.salts.length) {
      saltRows = '<tr><td colspan="3" class="table-empty">未添加盐类。用石膏 / 氯化钙调整 SO₄:Cl 比值。</td></tr>';
    } else {
      for (var j = 0; j < r.water.salts.length; j++) {
        var s = r.water.salts[j];
        saltRows += '<tr data-row="salts" data-idx="' + j + '">' +
          '<td>' + UI.combo('waterSalts', s.id, { path: 'water.salts.' + j + '.id', placeholder: '选择盐类' }) + '</td>' +
          /* 单位必须按盐种取：乳酸/磷酸是 ml，其它是 g。
             硬写 'g' 会让用户把 2ml 乳酸当 2g 称——88% 乳酸密度 1.2，
             那是 20% 的误差，而这是往酒里加酸。 */
          '<td>' + cellNum('water.salts.' + j + '.amount', num(s.amount, 0), (function () {
            var sd = s.id ? UI.byId('waterSalts', s.id) : null;
            return (sd && sd.unit) || s.unit || 'g';
          })(), 1) + '</td>' +
          '<td class="col-act"><button type="button" class="btn btn-quiet btn-icon" data-act="del-salt" data-idx="' + j + '" ' +
            'aria-label="删除第 ' + (j + 1) + ' 种盐">' + icon('trash', 14) + '</button></td>' +
          '</tr>';
      }
    }

    return card('水化学', icon('drop', 14),
      '<div class="grid-2" style="align-items:start">' +
        '<div>' +
          '<div class="row row--between" style="margin-bottom:8px">' +
            '<span class="u-xs u-dim" style="letter-spacing:.6px">源水离子（mg/L）</span>' +
            '<button type="button" class="btn btn-quiet btn-xs" data-act="water-clear">清零</button>' +
          '</div>' +
          '<div class="grid-3" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + ionHtml + '</div>' +
        '</div>' +
        '<div>' +
          '<div class="row row--between" style="margin-bottom:8px">' +
            '<span class="u-xs u-dim" style="letter-spacing:.6px">盐类添加（全批）</span>' +
            '<button type="button" class="btn btn-quiet btn-xs" data-act="add-salt">' + icon('plus', 11) + ' 添加</button>' +
          '</div>' +
          '<div class="table-wrap"><table class="table table--compact">' +
            '<thead><tr><th>盐</th><th class="u-right" style="width:84px">用量</th><th class="col-act"></th></tr></thead>' +
            '<tbody data-rows="salts">' + saltRows + '</tbody>' +
          '</table></div>' +
          '<div id="water-summary" class="mt-12"></div>' +
        '</div>' +
      '</div>',
      '',
      /* v1.2 头部按钮：水质匹配。它是"读当前离子 → 找相近水型"的查询动作，
         不改配方，所以放卡片标题条右侧而不是内容区里 */
      '<button type="button" class="btn btn-quiet btn-xs" data-act="water-match" ' +
        'title="按当前源水离子匹配历史名城水型，并给出差值">' +
        icon('drop', 12) + ' 水质匹配</button>');
  }

  /* -------------------------------------------------------------- 糖化方案 */
  function cardMash(r) {
    var steps = r.mash.steps;
    var rows = '';
    if (!steps.length) {
      rows = '<tr><td colspan="3" class="table-empty">未设置糖化步骤。</td></tr>';
    } else {
      for (var i = 0; i < steps.length; i++) {
        rows += '<tr data-row="steps" data-idx="' + i + '">' +
          '<td><input class="cell-input cell-input--left" type="text" value="' + attr(steps[i].name || '') +
            '" data-path="mash.steps.' + i + '.name" aria-label="步骤名称" placeholder="糖化 / 出糖"></td>' +
          '<td>' + cellNum('mash.steps.' + i + '.tempC', num(steps[i].tempC, 66), '°C', 0) + '</td>' +
          '<td>' + cellNum('mash.steps.' + i + '.minutes', num(steps[i].minutes, 60), 'min', 0) + '</td>' +
          '<td class="col-act"><button type="button" class="btn btn-quiet btn-icon" data-act="del-mash" data-idx="' + i + '" ' +
            'aria-label="删除第 ' + (i + 1) + ' 步">' + icon('trash', 14) + '</button></td>' +
          '</tr>';
      }
    }

    return card('糖化方案', icon('thermo', 14),
      '<div class="row" style="margin-bottom:10px">' +
        '<div class="field" style="max-width:170px">' +
          '<label class="field__label" for="f-thick">水料比</label>' +
          fldWrap('f-thick', fmt(r.mashThickness, 1), 'L/kg',
            { path: 'mashThickness', step: '0.1', min: 1.5, max: 6 }) +
        '</div>' +
        '<div class="field" style="max-width:170px">' +
          '<label class="field__label" for="f-ftemp">发酵温度</label>' +
          fldWrap('f-ftemp', fmt(r.fermentTemp, 0), '°C',
            { path: 'fermentTemp', step: '0.5', min: 5, max: 40 }) +
        '</div>' +
        '<span class="u-xs u-dim" style="align-self:flex-end;padding-bottom:8px">' +
          '水料比 3 L/kg 起步；小麦/燕麦配方可升到 3.5 防结块</span>' +
      '</div>' +
      '<div class="table-wrap"><table class="table table--compact">' +
        '<thead><tr>' +
          '<th>步骤</th>' +
          '<th class="u-right" style="width:90px">休止温度</th>' +
          '<th class="u-right" style="width:90px">时间</th>' +
          '<th class="col-act"></th>' +
        '</tr></thead><tbody data-rows="steps">' + rows + '</tbody></table></div>' +
      '<div id="mash-summary" class="card__hint"></div>',
      '<button type="button" class="btn btn-ghost btn-sm" data-act="add-mash">' + icon('plus', 13) + '添加休止</button>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-act="mash-single">单步 67°C</button>');
  }

  /* ======================================================================
   * 糖化之后、接种之前、发酵之后：三个工艺段（v1.9 新增）
   * ----------------------------------------------------------------------
   * 为什么是这三段，而不是"把流程里每一步都做成区"——判据三条，缺一不做：
   *   ① 数据模型里有落点（可读写，或能由现有字段算出）；
   *   ② 不与已有区重复（干投已在「酒花」的阶段里、装瓶碳化已在「交付」里）；
   *   ③ 有能给出"可改的决定"的数字（只显示一句话就不该单独成区）。
   * 被这三条挡掉的候选与理由，写在 docs 与交付报告里（洗糟 / 煮沸 / 干投 /
   * 接种 / 装瓶碳化 / 水处理）。
   * ====================================================================*/

  /* ---- 工艺段参数的落点（**加字段前必读**）-----------------------------
   *
   * ⚠️ 一、不能用 recipe.meta，也不能加任何新的顶层字段。
   *    40-ui-shell.js:523 的 normalizeRecipe() 是**白名单式重建**：
   *        var r = { id, name, styleId, author, notes, createdAt, updatedAt, rev,
   *                  parentId, batchSize, efficiency, evaporationRate, boilTime,
   *                  trubLoss, fermenterLoss, grainAbsorption, hopAbsorption,
   *                  mashThickness, fermentTemp, fermentables, hops, yeasts,
   *                  adjuncts, water, mash, carbonation, targets }
   *    —— 就这 27 个键（顺序见 40:538-600）。不在名单里的顶层键，在**每一次**
   *    UI.setRecipe 上都会被静默丢掉：写进去看得见、改完能算、切视图还在
   *    （内存里是同一个对象），但只要 autosave 落盘后刷新
   *    （loadWorking → setRecipe → normalizeRecipe），它就没了。
   *    **没有任何断言会红**，用户只会觉得"我填过，怎么又空了"。
   *    实测：挂在 recipe.meta.chill 上，改完刷新就回默认值。
   *
   *    同一层陷阱还出现在**行级**：normalizeRecipe 里的 fermentables/hops/
   *    yeasts/adjuncts/water.salts 各行都过 snapshotXxx（40:402 / 426 / 464…），
   *    那些也是逐字段重建（hops 行只留 id/name/en/type/amount/unit/aa/stage/
   *    time/whirlpoolTemp/custom）。给酒花行加字段一样会被吃掉 —— 本条
   *    正是 whirlpoolTemp 当年一度静默丢失、IBU 凭空偏高 1.5 的根因。
   *
   *    所以——**以后要给配方加顶层字段，必须先去改 40 的这份白名单**；
   *    要给原料行加字段，必须同时改 40 的 snapshotXxx。40 本轮禁改，
   *    故本轮走第二条路。
   *
   * ⚠️ 二、为什么 targets 能存住：它是白名单里唯一**显式不做归一**的容器
   *    （40:595 原文"targets **故意不做归一**：它是自由结构…将来可能加别的
   *    目标"），对象按引用原样透传，嵌套键不会被裁。故工艺参数落在
   *    targets.process.<段>.<字段>。代价是语义上它叫"设计目标"，所以只放
   *    工艺参数，不放原料、不放计算输入。
   *
   *    老存档/新配方没有这一段 → procOf() 一律回落下面的 DEFAULTS，
   *    不报错、不显示 NaN；写的时候 setPath 会自动建出 targets.process.chill。
   *    区内还有一行浅色提示（见 paintChill / paintMature），告诉用户
   *    "这锅还没填过，下面是默认值"——空着和坏了要能分开。
   *
   * ⚠️ 三、已知降级（都属"换一锅新的酒"，按默认值重新开始可接受）：
   *    · 载入入门配方：30 的 fromStyle() 会整个重写 r.targets（30:699）；
   *    · BL1 分享码往返：28 只编码 targets 的 og/fg/abv/ibu/srm 五个键。
   *    两条都不在 28/30 里加字段（那两个文件本轮禁改），但界面上有提示，
   *    不静默。
   * ------------------------------------------------------------------- */
  var PROC_DEFAULTS = {
    /* 冷却与充氧。默认值取家酿通行做法：艾尔冷却到 19°C、板换、纯氧 10 ppm */
    chill: { targetC: 19, method: 'plate', oxygen: 'pure', o2ppm: 10, minutes: 25 },
    /* 后熟与冷降：7–14 天 @ 2–4°C 是艾尔的后熟常态；拉格要按周算，用户自己改 */
    mature: { days: 10, tempC: 3, coldCrash: 'yes', ccTempC: 2, ccDays: 3 }
  };

  var CHILL_METHODS = [
    { v: 'plate', t: '板式换热器' },
    { v: 'immersion', t: '浸入式盘管' },
    { v: 'counterflow', t: '逆流盘管' },
    { v: 'natural', t: '自然冷却（no-chill）' }
  ];
  var CHILL_OXYGEN = [
    { v: 'pure', t: '纯氧（O₂ 瓶）' },
    { v: 'air', t: '空气泵 / 气石' },
    { v: 'shake', t: '摇桶 / 落差' }
  ];

  /** 读一段工艺参数：缺字段回落到默认值，绝不返回 undefined 给 input */
  function procOf(r, key) {
    var p = (r && r.targets && typeof r.targets.process === 'object' && r.targets.process)
      ? r.targets.process : {};
    var cur = (p[key] && typeof p[key] === 'object') ? p[key] : {};
    var def = PROC_DEFAULTS[key] || {};
    var out = {};
    for (var k in def) {
      if (!Object.prototype.hasOwnProperty.call(def, k)) continue;
      var v = cur[k];
      out[k] = (v === undefined || v === null || v === '') ? def[k] : v;
    }
    return out;
  }

  /** 'yes'/'no' 这类开关：老存档可能是 true/false 或 1/0，一律认 */
  function isOn(v, def) {
    if (v === undefined || v === null || v === '') return !!def;
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    var s = String(v).toLowerCase();
    return !(s === 'no' || s === 'false' || s === '0' || s === 'off');
  }

  /** 这一段**真的被填过吗**（不回落默认值）。
   *  procOf 永远返回一套值，分不出"用户填的"和"默认值"；而界面上必须分得出
   *  ——否则刚载入入门配方、或老分享码导入后，用户会以为"我填过，被吃掉了"。
   *  返回 null = 这段还没写过（含 targets 整个被重写的情况）。 */
  function procRaw(r, key) {
    var p = (r && r.targets && typeof r.targets.process === 'object' && r.targets.process)
      ? r.targets.process : null;
    if (!p) return null;
    var seg = p[key];
    if (!seg || typeof seg !== 'object') return null;
    for (var k in seg) {
      if (Object.prototype.hasOwnProperty.call(seg, k)) {
        if (seg[k] !== null && seg[k] !== undefined && seg[k] !== '') return seg;
      }
    }
    return null;
  }

  function optHtml(list, cur) {
    var html = '';
    for (var i = 0; i < list.length; i++) {
      html += '<option value="' + attr(list[i].v) + '"' +
        (String(cur) === String(list[i].v) ? ' selected' : '') + '>' + esc(list[i].t) + '</option>';
    }
    return html;
  }

  function optLabel(list, v) {
    for (var i = 0; i < list.length; i++) if (String(list[i].v) === String(v)) return list[i].t;
    return String(v || '—');
  }

  /* 给左侧面板（39c）用的只读出口。39c 加载在 42 之前，但它渲染在全部脚本
     之后，所以这里挂的是"渲染时才取用"的函数；39c 侧仍做了存在性判断。
     共享的是**读法**（回落默认值这一层），不是数值本身 —— 让 39c 自己再抄一份
     默认值，迟早出现"左面板说 19°C、配方页说 18°C"。 */
  UI.recipeProc = procOf;
  UI.procLabel = {
    chillMethod: function (v) { return optLabel(CHILL_METHODS, v); },
    chillOxygen: function (v) { return optLabel(CHILL_OXYGEN, v); }
  };

  /* ------------------------------------------------------- 回旋沉淀（区 7） */

  /** 本配方所有"回旋"阶段的酒花行（含原始下标，回写时要用） */
  function wpRows(r) {
    var out = [];
    var hops = (r && r.hops) || [];
    for (var i = 0; i < hops.length; i++) {
      if (hops[i] && String(hops[i].stage) === 'whirlpool') out.push({ i: i, h: hops[i] });
    }
    return out;
  }

  /** 把温度/时长写到**每一行**回旋投花。
   *  ⚠️ 这里是"一处存"的关键：卡上的两个框不是独立字段，写的是 hops[].whirlpoolTemp
   *  与 hops[].time —— 和「酒花」区同一份数据。各存一份的话，20-calc 的
   *  effectiveMinutes 只会读其中一个，另一处就变成装饰。 */
  function mirrorWhirlpool(r, field, val) {
    var rows = wpRows(r);
    for (var i = 0; i < rows.length; i++) rows[i].h[field] = val;
    return rows.length;
  }

  function cardWhirlpool(r) {
    var rows = wpRows(r);
    var body;

    if (!rows.length) {
      body = UI.emptyState('还没有回旋投花',
        '回旋沉淀 = 熄火后让麦汁在 85–95°C 低速旋转 15–30 分钟，把热渣聚成锥体再冷却。这个阶段投花主要取香气，只带少量苦味：20-calc 按回旋温度折算异构化率（≥90°C 约 50%、80–89 约 35%、70–79 约 15%），所以温度填多少会直接改 IBU。',
        { small: true, art: 'beer', size: 48 });
    } else {
      var t0 = num(rows[0].h.whirlpoolTemp, 0);
      var m0 = num(rows[0].h.time, 0);
      var diffT = false, diffM = false;
      for (var i = 1; i < rows.length; i++) {
        if (Math.abs(num(rows[i].h.whirlpoolTemp, 0) - t0) > 0.001) diffT = true;
        if (Math.abs(num(rows[i].h.time, 0) - m0) > 0.001) diffM = true;
      }
      /* 温度空着是常态（老配方只有 stage=whirlpool 没有温度，20-calc 会
         退回 0.40 折扣）。空的时候显示 0 而不是 85 —— 不替用户编一个数。 */
      body =
        '<div class="row" style="margin-bottom:10px;align-items:flex-end;gap:14px;flex-wrap:wrap">' +
          '<div class="field" style="max-width:150px">' +
            '<label class="field__label" for="wp-temp">回旋温度</label>' +
            fldWrap('wp-temp', fmt(t0, 0), '°C',
              { path: 'hops.' + rows[0].i + '.whirlpoolTemp', step: '1', min: 0, max: 100,
                ariaLabel: '回旋温度（写入本配方所有回旋投花行）' }) +
          '</div>' +
          '<div class="field" style="max-width:150px">' +
            '<label class="field__label" for="wp-min">保温时长</label>' +
            fldWrap('wp-min', fmt(m0, 0), 'min',
              { path: 'hops.' + rows[0].i + '.time', step: '1', min: 0, max: 180,
                ariaLabel: '回旋保温时长（写入本配方所有回旋投花行）' }) +
          '</div>' +
          '<span class="u-xs u-dim" style="padding-bottom:8px;min-width:0;flex:1 1 240px">' +
            (diffT || diffM
              ? '本配方的 ' + rows.length + ' 行回旋投花' + (diffT ? ' 温度' : '') + (diffM ? ' 时长' : '') +
                '不一致，改这两个框会把它们统一；想保留分行差异，请直接改「酒花」区的时间和温度列。'
              : '85–95°C 保温 15–30 分钟是通行区间（低于 70°C 基本只留香气，几乎不加苦）') +
          '</span>' +
        '</div>' +
        '<div id="wp-detail"></div>';
    }

    return card('回旋沉淀', icon('beaker', 14), body,
      '<button type="button" class="btn btn-ghost btn-sm" data-act="add-whirlpool-hop">' +
        icon('plus', 13) + '添加回旋投花</button>' +
      '<span class="u-xs u-dim">温度与时长都存在酒花行上，「酒花」区显示的是同一份数据</span>');
  }

  /** 只读明细：本配方在回旋阶段投了什么、各贡献多少 IBU。
   *  每次 repaint 重画（内容是纯只读，不存在抢焦点的问题）。 */
  function wpDetailHtml(c, r) {
    var rows = wpRows(r);
    if (!rows.length) {
      return '<div class="u-xs u-dim">—</div>';
    }
    var contrib = (c && c.ibuContribution) || [];
    var sameLen = contrib.length === r.hops.length;
    var g = 0, ibu = 0, html = '';

    for (var i = 0; i < rows.length; i++) {
      var h = rows[i].h;
      var amt = num(h.amount, 0);
      g += amt;
      var ib = sameLen && contrib[rows[i].i] ? num(contrib[rows[i].i].ibu, 0) : 0;
      ibu += ib;
      var tp = num(h.whirlpoolTemp, 0);
      html += '<tr>' +
        '<td>' + esc(h.name || h.id || '未选酒花') + '</td>' +
        '<td class="num">' + fmt(amt, 0) + ' g</td>' +
        '<td class="num u-muted">' + (tp > 0 ? fmt(tp, 0) + ' °C' : '未设') + '</td>' +
        '<td class="num u-muted">' + fmt(num(h.time, 0), 0) + ' min</td>' +
        '<td class="num u-muted">' + (ib > 0 ? fmt(ib, 1) : '—') + '</td>' +
        '</tr>';
    }

    var totalIbu = num(c && c.ibu, 0);
    var pct = totalIbu > 0 ? (ibu / totalIbu * 100) : 0;
    return '<div class="table-wrap"><table class="table table--compact">' +
        '<thead><tr><th>酒花</th>' +
          '<th class="u-right" style="width:76px">用量</th>' +
          '<th class="u-right" style="width:78px">温度</th>' +
          '<th class="u-right" style="width:70px">时长</th>' +
          '<th class="u-right" style="width:66px">IBU</th>' +
        '</tr></thead><tbody>' + html + '</tbody>' +
        '<tfoot><tr><td>合计</td><td class="num">' + fmt(g, 0) + ' g</td>' +
          '<td colspan="2" class="u-xs u-dim">占全配方苦度约 ' + fmt(pct, 0) + '%</td>' +
          '<td class="num">' + fmt(ibu, 1) + '</td></tr></tfoot>' +
      '</table></div>';
  }

  /* --------------------------------------------------- 冷却与充氧（区 8） */

  function cardChill(r) {
    var p = procOf(r, 'chill');
    var body =
      '<div class="grid-3" style="row-gap:8px">' +
        '<div class="field">' +
          '<label class="field__label" for="ch-target">冷却目标温度</label>' +
          fldWrap('ch-target', fmt(p.targetC, 0), '°C',
            { path: 'targets.process.chill.targetC', step: '0.5', min: 0, max: 40,
              ariaLabel: '冷却目标温度' }) +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label" for="ch-method">冷却方式</label>' +
          '<select class="select" id="ch-method" data-path="targets.process.chill.method">' +
            optHtml(CHILL_METHODS, p.method) + '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label" for="ch-min">预计冷却时长</label>' +
          fldWrap('ch-min', fmt(p.minutes, 0), 'min',
            { path: 'targets.process.chill.minutes', step: '1', min: 0, max: 180,
              ariaLabel: '预计冷却时长' }) +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label" for="ch-oxygen">充氧方式</label>' +
          '<select class="select" id="ch-oxygen" data-path="targets.process.chill.oxygen">' +
            optHtml(CHILL_OXYGEN, p.oxygen) + '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label" for="ch-o2">目标溶氧</label>' +
          fldWrap('ch-o2', fmt(p.o2ppm, 0), 'ppm',
            { path: 'targets.process.chill.o2ppm', step: '1', min: 0, max: 25,
              ariaLabel: '目标溶氧' }) +
        '</div>' +
        '<div class="field" style="justify-content:flex-end">' +
          '<span class="u-xs u-dim">充氧只在接种前做一次；发酵开始后加氧只会促氧化</span>' +
        '</div>' +
      '</div>' +
      '<div id="chill-note" class="card__hint"></div>';

    return card('冷却与充氧', icon('thermo', 14), body, '');
  }

  /* ------------------------------------------------ 后熟与冷降（区 10） */

  function cardMature(r) {
    var p = procOf(r, 'mature');
    var body =
      '<div class="grid-3" style="row-gap:8px">' +
        '<div class="field">' +
          '<label class="field__label" for="mt-days">后熟天数</label>' +
          fldWrap('mt-days', fmt(p.days, 0), '天',
            { path: 'targets.process.mature.days', step: '1', min: 0, max: 180,
              ariaLabel: '后熟天数' }) +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label" for="mt-temp">后熟温度</label>' +
          fldWrap('mt-temp', fmt(p.tempC, 0), '°C',
            { path: 'targets.process.mature.tempC', step: '0.5', min: -2, max: 30,
              ariaLabel: '后熟温度' }) +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label" for="mt-cc">是否冷降</label>' +
          '<select class="select" id="mt-cc" data-path="targets.process.mature.coldCrash">' +
            optHtml([{ v: 'yes', t: '冷降（降到 0–4°C 沉淀酵母）' }, { v: 'no', t: '不冷降' }], p.coldCrash) +
          '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label" for="mt-cctemp">冷降温度</label>' +
          fldWrap('mt-cctemp', fmt(p.ccTempC, 0), '°C',
            { path: 'targets.process.mature.ccTempC', step: '0.5', min: -2, max: 20,
              ariaLabel: '冷降温度' }) +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label" for="mt-ccdays">冷降天数</label>' +
          fldWrap('mt-ccdays', fmt(p.ccDays, 0), '天',
            { path: 'targets.process.mature.ccDays', step: '1', min: 0, max: 30,
              ariaLabel: '冷降天数' }) +
        '</div>' +
        '<div class="field" style="justify-content:flex-end">' +
          '<span class="u-xs u-dim">后熟 7–14 天 @ 2–4°C 是艾尔常态；拉格按周算</span>' +
        '</div>' +
      '</div>' +
      '<div id="mature-eta" class="card__hint"></div>';

    return card('后熟与冷降', icon('clock', 14), body, '');
  }

  /* ---------------------------------------------------------- 右侧指标面板 */
  function cardMetrics() {
    return '<div class="card">' +
      '<div class="card__head"><h2>实时指标</h2><span class="spacer"></span>' +
        '<span class="u-xs u-dim" id="engine-tag"></span></div>' +
      '<div class="card__body card__body--tight">' +
        '<div class="metrics">' +
          metricCell('og', '初始比重 OG', 'metric--og', 'og-sub') +
          metricCell('fg', '终比重 FG', '', 'fg-sub') +
          metricCell('abv', '酒精度 ABV', 'metric--abv', 'abv-sub') +
          metricCell('ibu', '苦度 IBU', '', 'ibu-sub') +
          metricCell('srm', '色度 SRM', 'metric--srm', 'srm-sub') +
          metricCell('bugu', '苦甜比（BU:GU）', '', 'bugu-sub') +
          /* 第 7 格（v1.2）：感知苦度区间。metric--wide 横跨两列，
             副标题**必须**同时给出原始 IBU —— 只给感知值，用户会以为
             上面的 IBU 算错了。 */
          metricCell('perceived', '感知苦度（模型估算）', 'metric--wide', 'perc-sub') +
        '</div>' +
        /* v1.5 关系规则：BU:GU / SO₄:Cl 只在超出经验区间时出现一条，
           位置紧贴现有 BU:GU 那一行。空的时候 :empty 不占高度。 */
        '<div class="fld-rel" id="rel-metrics"></div>' +
        /* disclaimer 的落点：title 属性键盘与触屏都不可达，而这句"不是测量值"
           是硬口径，必须看得见。11px 小字，不抢指标的位置。 */
        '<div class="u-xs u-dim mt-8" id="perc-note"></div>' +
        '<div class="mt-12">' +
          '<div class="swatch" id="color-swatch" style="background:#3a2a14">' +
            '<span class="swatch__label" id="swatch-label">—</span>' +
          '</div>' +
        '</div>' +
        '<div class="mt-12" id="style-match"></div>' +
        '<div class="mt-12" id="contrib-block"></div>' +
        '<div class="mt-12" id="water-block"></div>' +
        /* no-annotate：告警块每次重绘都整块重建，且正文用「为什么」按钮而不是
           行内下划线（见 paintWarnings 的注释）。这两条都成立，所以这里显式排除。 */
        '<div class="mt-12 no-annotate" id="warn-block"></div>' +
      '</div>' +
      '<div class="card__foot" style="flex-wrap:wrap;gap:6px">' +
        '<span class="u-xs u-dim" id="vol-balance"></span>' +
      '</div>' +
    '</div>';
  }

  function metricCell(key, label, cls, subId) {
    return '<div class="metric ' + cls + '" data-metric="' + key + '">' +
      '<div class="metric__label">' + esc(label) + '</div>' +
      '<div class="metric__val" id="m-' + key + '">—</div>' +
      '<div class="metric__sub" id="' + subId + '"></div>' +
      '</div>';
  }

  function cardActions() {
    return '<div class="card">' +
      '<div class="card__head"><h2>配方管理</h2></div>' +
      '<div class="card__body card__body--tight">' +
        '<div class="grid-2">' +
          '<button type="button" class="btn btn-primary" data-act="save">' + icon('save', 14) + '保存</button>' +
          '<button type="button" class="btn btn-ghost" data-act="saveas">另存为</button>' +
          '<button type="button" class="btn btn-ghost" data-act="duplicate">' + icon('copy', 14) + '复制</button>' +
          '<button type="button" class="btn btn-ghost" data-act="report">' + icon('report', 14) + '配方卡</button>' +
          /* v1.2：两个只读动作，不改配方内容，所以放最下面一行 */
          '<button type="button" class="btn btn-ghost" data-act="diff">' + icon('layers', 14) + '版本对比</button>' +
          '<button type="button" class="btn btn-ghost" data-act="share">' + icon('sparkle', 14) + '分享</button>' +
        '</div>' +
        '<div class="divider"></div>' +
        '<div class="field">' +
          '<label class="field__label" for="f-open">打开已保存配方</label>' +
          '<select class="select select--sm" id="f-open"></select>' +
        '</div>' +
        '<button type="button" class="btn btn-danger btn-sm w-full mt-8" data-act="delete">' + icon('trash', 13) + '删除当前配方</button>' +
      '</div>' +
      '<div class="card__hint" id="recipe-meta"></div>' +
    '</div>';
  }

  /* ======================================================================
   * D. 指标重绘
   * ====================================================================*/

  var lastVals = {};

  function flashIfChanged(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    var changed = lastVals[id] !== undefined && lastVals[id] !== text;
    el.textContent = text;
    if (changed) {
      el.classList.add('is-flash');
      root.setTimeout(function () { el.classList.remove('is-flash'); }, 240);
    }
    lastVals[id] = text;
  }

  function repaint() {
    var c = UI.publish();
    var r = UI.recipe();

    flashIfChanged('m-og', UI.sg(c.og));
    flashIfChanged('m-fg', UI.sg(c.fg));
    flashIfChanged('m-abv', fmt(c.abv, 1) + '%');
    flashIfChanged('m-ibu', fmt(c.ibu, 0));
    flashIfChanged('m-srm', fmt(c.srm, 1));
    flashIfChanged('m-bugu', fmt(c.buGu, 2));

    setText('og-sub', fmt(c.ogPlato, 1) + ' °P');
    setText('fg-sub', fmt(c.fgPlato, 1) + ' °P');
    /* 表观衰减显示两个数，各有出处：
       · aaActual = (OG−FG)/(OG−1)，这份配方真正达到的表观衰减；
       · attenuation = 酵母的标称 ADF，是"这株酵母在标准麦汁里能做到多少"。
       以前这里显示的是后者却标"表观衰减"，牛奶世涛会显示 70%（标称）而实际 54%，
       差 16 个百分点，属于会误导判断的错误标注。 */
    var aaReal = (typeof c.aaActual === 'number' && isFinite(c.aaActual)) ? c.aaActual : c.attenuation;
    setText('abv-sub', '表观衰减（实测） ' + fmt(aaReal, 1) + '%｜酵母标称 ADF ' + fmt(c.attenuation, 0) + '%');
    /* IBU 副标题：显示"另外两种模型"的值，动态排除当前选中的那个。
       写死 "Rager / Garetz" 的问题：用户把默认模型切成 Rager 后，
       主数值是 Rager、副标题又以 Rager 开头，等于重复显示且看不到 Tinseth。 */
    (function () {
      var cur = 'tinseth';
      /* 键路径是 settings.ibuModel，不是根级的 ibuModel。原来少写了 settings.
         前缀，Store.get 永远返回 undefined，副标题就永远按 Tinseth 算——
         用户切到 Rager 后主值变了、副标题还在以 Rager 开头，等于重复显示。 */
      try {
        if (BREW.Store && BREW.Store.get) cur = String(BREW.Store.get('settings.ibuModel', 'tinseth') || 'tinseth');
      } catch (e) { cur = 'tinseth'; }
      var others = [];
      if (cur !== 'tinseth') others.push('Tinseth ' + fmt(c.ibuTinseth, 0));
      if (cur !== 'rager') others.push('Rager ' + fmt(c.ibuRager, 0));
      if (cur !== 'garetz') others.push('Garetz ' + fmt(c.ibuGaretz, 0));
      setText('ibu-sub', others.join(' / '));
    })();
    setText('srm-sub', fmt(c.ebc, 0) + ' EBC' + (c.colorName ? ' · ' + c.colorName : ''));
    setText('bugu-sub', c.balance || '');

    var tag = document.getElementById('engine-tag');
    if (tag) {
      tag.textContent = c.__engine === 'calc' ? '计算内核 v1' : '内置估算';
      tag.title = c.__engine === 'calc'
        ? '由 BREW.Calc.calcRecipe 计算'
        : 'BREW.Calc 未就绪或返回异常，当前为界面内置估算（Tinseth / Morey）';
    }

    var sw = document.getElementById('color-swatch');
    if (sw) sw.style.background = c.colorHex || '#3a2a14';
    setText('swatch-label', fmt(c.srm, 1) + ' SRM');

    paintStyleMatch(c);
    paintContrib(c, r);
    paintWater(c);
    paintWarnings(c);
    paintRelMetrics(c);
    paintMaltRel(c, r);
    paintMaltFoot(c, r);
    paintHopFoot(c, r);
    paintMashSummary(c, r);
    paintHopRowIbu(c, r);
    /* v1.9 三个新工艺段：只刷只读节点（明细 / 建议 / 可饮日期）。
       回旋温度在「酒花」区是一份只读镜像，改完温度、切完阶段都要跟着动。 */
    paintWhirlpool(c, r);
    paintHopWpTemp(c, r);
    paintChill(c, r);
    paintMature(c, r);
    paintPerceived(c, r);
    /* 基本信息卡里的四个派生量。放在这里而不是 bindEvents 里，是因为它必须
       跟着**每一次**重算走：改麦量、换酵母、切配方、载入基线都会经由 repaint。 */
    paintBasicDerived(c, r);
    /* 批次量的 hint 文案带区间判定，重绘/切配方后要按当前值恢复一次
       （原来只在 input 事件里跑，切配方后还停在上一条配方的判断上）。 */
    checkVolumeHint();

    var vb = document.getElementById('vol-balance');
    if (vb) {
      vb.textContent = '糖化水 ' + fmt(c.mashWater, 1) + ' L · 洗糟 ' + fmt(c.spargeWater, 1) +
        ' L · 煮沸前 ' + fmt(c.preBoilVolume, 1) + ' L';
    }

    var meta = document.getElementById('recipe-meta');
    if (meta) {
      meta.innerHTML = '配方 ID <span class="u-mono">' + esc(String(r.id).slice(-10)) + '</span>' +
        ' · 最后修改 ' + esc(UI.dt(r.updatedAt, true));
    }

    var sel = document.getElementById('f-open');
    if (sel) {
      var list = UI.store.recipes();
      var html = '<option value="">— 选择已保存的配方（' + list.length + '）—</option>';
      for (var i = 0; i < list.length; i++) {
        html += '<option value="' + attr(list[i].id) + '"' +
          (list[i].id === r.id ? ' selected' : '') + '>' + esc(list[i].name || '未命名') + '</option>';
      }
      sel.innerHTML = html;
    }
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text == null ? '' : text;
  }

  /** 风格档案里的一个列表段；空数组返回空串（整段跳过）。
   *  文案走 UI.md（数据里整体/要点/缺陷都带 ** 强调标记）。 */
  function dossierList(title, arr, extraCls) {
    if (!arr || !arr.length) return '';
    var li = '';
    for (var i = 0; i < arr.length; i++) {
      if (!arr[i]) continue;
      li += '<li>' + UI.md(arr[i]) + '</li>';
    }
    if (!li) return '';
    return '<div class="style-dossier__block">' +
      '<h4>' + esc(title) + '</h4>' +
      '<ul class="style-dossier__list' + (extraCls ? ' ' + extraCls : '') + '">' + li + '</ul>' +
      '</div>';
  }

  /**
   * 风格档案（overall / key / fault / ex）。
   * 这四组字段在 styles 库里有，但此前全站一次都没渲染过；用户选完风格只看得到
   * 五条数值区间，看不到"这风格什么味、容易出什么错、市面上谁在做"。
   * 四段任何一个字段缺失就跳掉那一段，全缺则整块不渲染。
   */
  function styleDossier(styleId) {
    var st = styleId ? UI.byId('styles', styleId) : null;
    if (!st) return '';

    var lead = st.overall ? '<p class="style-dossier__lead">' + UI.md(st.overall) + '</p>' : '';
    var keys = dossierList('要点', st.key, '');
    var faults = dossierList('常见缺陷', st.fault, 'style-dossier__list--fault');

    var exs = '';
    if (st.ex && st.ex.length) {
      var chips = '';
      for (var i = 0; i < st.ex.length; i++) {
        if (!st.ex[i]) continue;
        chips += '<span class="chip">' + esc(st.ex[i]) + '</span>';
      }
      if (chips) {
        exs = '<div class="style-dossier__block">' +
          '<h4>商业参考</h4>' +
          '<div class="style-dossier__chips">' + chips + '</div></div>';
      }
    }

    if (!lead && !keys && !faults && !exs) return '';
    return '<details class="style-dossier">' +
      '<summary>风格档案 · 要点 / 缺陷 / 商业参考</summary>' +
      '<div class="style-dossier__body">' + lead + keys + faults + exs + '</div>' +
      '</details>';
  }

  function paintStyleMatch(c) {
    var box = document.getElementById('style-match');
    if (!box) return;
    var m = c.styleMatch;
    if (!m) {
      box.innerHTML = '<div class="u-xs u-dim">' +
        (UI.list('styles').length
          ? '选择一个风格，即可看到 OG / IBU / SRM 与区间标准的偏差。'
          : '风格库未载入。') + '</div>';
      return;
    }
    /* 档案是 <details>，整体覆写会把展开态重置成收起；
       用户一边看档案一边改麦芽量时每敲一个数字就自动合上，体验很差。
       所以覆写前先记住 open，覆写后写回。 */
    var prevDossier = box.querySelector('.style-dossier');
    var wasOpen = !!(prevDossier && prevDossier.open);
    var dossier = styleDossier(m.styleId || (UI.recipe() || {}).styleId);

    var score = num(m.score, 0);
    var color = score >= 85 ? '#376f31' : score >= 60 ? '#d9873f' : '#a83628';
    var C = 2 * Math.PI * 16;
    var dash = (score / 100) * C;

    var devs = '';
    var arr2 = m.deviations || [];
    for (var i = 0; i < arr2.length; i++) {
      var d = arr2[i];
      var rg = d.range || { lo: 0, hi: 1 };
      var lo = num(rg.lo, 0), hi = num(rg.hi, 1);
      var span = Math.max(0.0001, hi - lo);
      var tLo = lo - span, tHi = hi + span, tSpan = tHi - tLo;
      var rLeft = (lo - tLo) / tSpan * 100;
      var rWidth = (hi - lo) / tSpan * 100;
      var pinPos = Math.min(100, Math.max(0, (num(d.actual, 0) - tLo) / tSpan * 100));
      devs += '<div class="dev-row">' +
        '<span class="dev-row__label">' + esc(d.field) + '</span>' +
        '<span class="dev-row__track">' +
          '<span class="dev-row__range" style="left:' + attr(rLeft) + '%;width:' + attr(rWidth) + '%"></span>' +
          '<span class="dev-row__pin' + (d.verdict === 'ok' ? '' : ' is-off') + '" style="left:' + attr(pinPos) + '%"></span>' +
        '</span>' +
        '<span class="dev-row__val">' + esc(fmtVal(d.field, d.actual)) +
          '<span class="u-dim"> / ' + esc(fmtVal(d.field, lo)) + '–' + esc(fmtVal(d.field, hi)) + '</span></span>' +
        '</div>';
    }

    /* rangeSource:'local' 的条目（28A/29A/30A/33A）：官方对这类风格写的是
       "varies by base style"，没给数值窗口，库里的区间是本库自定的。
       不标出来，用户会以为红/绿是 BJCP 判定。 */
    var stSel = m.styleId ? UI.byId('styles', m.styleId) : null;
    var localRange = !!(stSel && stSel.rangeSource === 'local');
    var localNote = localRange
      ? '<p class="u-xs u-dim mt-8">区间为本库自定窗口（官方原文 varies by base style），不是 BJCP 值。</p>'
      : '';

    box.innerHTML =
      '<div class="match">' +
        '<svg class="match__ring" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">' +
          '<circle cx="20" cy="20" r="16" fill="none" stroke="#e3d9c6" stroke-width="3.5"/>' +
          '<circle cx="20" cy="20" r="16" fill="none" stroke="' + color + '" stroke-width="3.5" ' +
            'stroke-linecap="round" stroke-dasharray="' + attr(dash) + ' ' + attr(C) + '" ' +
            'transform="rotate(-90 20 20)"/>' +
          '<text x="20" y="24" text-anchor="middle" font-size="11" font-family="monospace" fill="' +
            color + '">' + esc(fmt(score, 0)) + '</text>' +
        '</svg>' +
        '<div class="match__meta">' +
          '<b>' + esc(m.styleName) + '</b>' +
          '<span>风格匹配度 ' + esc(fmt(score, 0)) + '%</span>' +
        '</div>' +
      '</div>' +
      localNote +
      (devs ? '<div class="deviations mt-8">' + devs + '</div>' : '') +
      (score < 60 ? '<p class="u-xs u-dim mt-8">多数指标落在区间外，可按偏差条微调麦芽量或酒花投放。</p>' : '') +
      dossier;

    if (wasOpen) {
      var reopened = box.querySelector('.style-dossier');
      if (reopened) reopened.open = true;
    }
  }

  function fmtVal(field, v) {
    if (field === 'OG' || field === 'FG') return UI.sg(v);
    if (field === 'ABV') return fmt(v, 1);
    return fmt(v, 0);
  }

  function paintContrib(c, r) {
    var box = document.getElementById('contrib-block');
    if (!box) return;
    var total = 0;
    for (var i = 0; i < r.fermentables.length; i++) total += num(r.fermentables[i].amount, 0);
    if (total <= 0) { box.innerHTML = ''; return; }

    var segs = '', legend = '', catOf = {};
    var cats = UI.db().maltCats || {};
    for (var j = 0; j < r.fermentables.length; j++) {
      var m = r.fermentables[j];
      var cat = m.cat || 'base';
      var col = cats[cat] && cats[cat].color ? cats[cat].color : '#a9762a';
      var pct = num(m.amount, 0) / total * 100;
      if (pct <= 0) continue;
      segs += '<div class="bar-stack__seg" style="width:' + attr(pct) + '%;background:' + attr(col) + '" ' +
        'title="' + attr((m.name || '') + ' ' + fmt(pct, 1) + '%') + '"></div>';
      catOf[cat] = (catOf[cat] || 0) + pct;
    }
    for (var key in catOf) {
      if (!Object.prototype.hasOwnProperty.call(catOf, key)) continue;
      var cc = cats[key] && cats[key].color ? cats[key].color : '#a9762a';
      legend += '<span class="legend__item"><span class="legend__sw" style="background:' + attr(cc) + '"></span>' +
        esc(cats[key] ? cats[key].zh : key) + ' ' + esc(fmt(catOf[key], 0)) + '%</span>';
    }

    box.innerHTML = '<div class="u-xs u-dim" style="letter-spacing:.6px;margin-bottom:6px">麦芽构成</div>' +
      '<div class="bar-stack">' + segs + '</div>' +
      '<div class="legend mt-8">' + legend + '</div>';
  }

  function paintWater(c) {
    var box = document.getElementById('water-summary');
    if (!box) return;
    var w = c.water || {};
    var ph = num(w.mashPhEstimate, 5.4);
    var cls = (ph < 5.2 || ph > 5.6) ? 'alert--warn' : 'alert--ok';
    box.innerHTML = '<div class="alert ' + cls + '">' +
      '<span class="alert__icon">' + icon('thermo', 13) + '</span>' +
      '<span>糖化 pH 估算 <b class="u-mono">' + esc(fmt(ph, 2)) + '</b>' +
      '（目标 5.2–5.6）· 残留碱度 ' + esc(fmt(w.ra, 0)) + ' ppm · SO₄/Cl ' + esc(fmt(w.so4clRatio, 2)) + '</span>' +
      '</div>';
  }

  /** 一条关系规则的提示 HTML。ok / empty 一律空串：
   *  空表单不是错误，把"还没填"标黄等于训练用户忽略黄色。 */
  function relMsg(rel) {
    if (!rel || !rel.msg) return '';
    if (rel.level !== 'hard' && rel.level !== 'soft') return '';
    var lvl = rel.level === 'hard' ? 'hard' : 'soft';
    return '<p class="fld-msg fld-msg--rel" data-lvl="' + lvl + '" data-rel="' +
      attr(rel.key || '') + '">' + esc(rel.msg) + '</p>';
  }

  /** 实时指标卡里的两条关系：BU:GU 与 SO₄:Cl。
   *  它们和 20-calc 的告警不重复：20-calc 说的是"苦味非常突出"，
   *  这里给的是比例本身与经验区间（0.25–1.3 / 0.3–3.0）。 */
  function paintRelMetrics(c) {
    var box = document.getElementById('rel-metrics');
    if (!box) return;
    if (!BREW.FieldRules || typeof BREW.FieldRules.relation !== 'function') {
      box.innerHTML = '';
      return;
    }
    var w = c.water || {};

    /* BU:GU 不在这里画文字块，改成把指标格里那个数字本身标黄 + 悬停给区间。
       原因：20-calc 在 BU:GU > 1.5 时已经会报"苦味非常突出 · 确认麦芽骨架能撑住"
       （那是诊断，带建议）；这里再画一块"BU:GU = 1.79，区间 0.25–1.3"，
       同一屏两块黄字讲同一件事，用户会开始无视黄色。
       而"比例关系"这个需求本身不能丢，所以保留判定、只改呈现：
       数字变黄是比文字块更强的提示（它就在被评价的那个数上），也不占地方。 */
    var bg = BREW.FieldRules.relation('buGu', { og: c.og, ibu: c.ibu });
    var bgEl = document.getElementById('m-bugu');
    if (bgEl) {
      if (bg.level === 'soft' || bg.level === 'hard') {
        bgEl.setAttribute('data-lvl', bg.level);
        bgEl.setAttribute('title', bg.msg);
      } else {
        bgEl.removeAttribute('data-lvl');
        bgEl.removeAttribute('title');
      }
    }

    var html = relMsg(BREW.FieldRules.relation('so4cl', { cl: w.cl, so4: w.so4 }));
    /* 只在真的变了的时候写 innerHTML：repaint 每 150ms 一次，
       无条件重建会让这条提示在用户眼前闪。 */
    if (box.__html !== html) {
      box.innerHTML = html;
      box.__html = html;
    }
  }

  /** 深色麦芽占比：结晶 + 烘烤占全部投料的比例。
   *  这是"每一行都正常、合起来发涩"的典型，所以只看整表合计。 */
  function paintMaltRel(c, r) {
    var box = document.getElementById('malt-rel');
    if (!box) return;
    if (!BREW.FieldRules || typeof BREW.FieldRules.relation !== 'function') {
      box.innerHTML = '';
      return;
    }
    var totalKg = 0, darkKg = 0;
    for (var i = 0; i < r.fermentables.length; i++) {
      var m = r.fermentables[i];
      var kg = num(m.amount, 0);
      totalKg += kg;
      if (m.cat === 'crystal' || m.cat === 'roast') darkKg += kg;
    }
    var rel = BREW.FieldRules.relation('darkGrainPct', { totalKg: totalKg, darkKg: darkKg });
    var html = relMsg(rel);
    if (box.__html !== html) {
      box.innerHTML = html;
      box.__html = html;
    }
  }

  function paintWarnings(c) {    var box = document.getElementById('warn-block');
    if (!box) return;
    var list = c.warnings || [];
    if (!list.length) {
      box.innerHTML = '<div class="alert alert--ok"><span class="alert__icon">' + icon('check', 13) +
        '</span><span>未发现明显问题。</span></div>';
      return;
    }
    var html = '';
    var order = { error: 0, warn: 1, info: 2 };
    var sorted = list.slice().sort(function (a, b) { return (order[a.level] || 3) - (order[b.level] || 3); });
    for (var i = 0; i < sorted.length; i++) {
      var w = sorted[i];
      var ic = w.level === 'error' ? 'alert' : w.level === 'warn' ? 'alert' : 'info';
      /* 「为什么」按钮只在告警带 termRef 时出现。不给告警正文做术语标注：
         本函数每次 repaint()（150ms 防抖、每次输入变更）都整块重建 innerHTML，
         标注上去会立刻被冲掉。按钮由 56-ui-terms.js 的全局委托接管。 */
      html += '<div class="alert alert--' + attr(w.level) + '">' +
        '<span class="alert__icon">' + icon(ic, 13) + '</span>' +
        '<span>' + esc(w.text) +
        (w.termRef && w.termRef.length
          ? ' <button type="button" class="btn-link u-xs" data-term-link="' +
            attr(w.termRef[0]) + '">为什么</button>'
          : '') +
        '</span></div>';
    }
    box.innerHTML = '<div class="u-xs u-dim" style="letter-spacing:.6px;margin-bottom:6px">检查项 · ' +
      list.length + '</div><div class="alerts">' + html + '</div>';
  }

  function paintMaltFoot(c, r) {
    var total = 0;
    for (var i = 0; i < r.fermentables.length; i++) total += num(r.fermentables[i].amount, 0);
    var el = document.getElementById('malt-total');
    if (el) el.textContent = fmt(total, 2) + ' kg';

    var note = document.getElementById('malt-foot-note');
    if (note) {
      var m = (c.ogContribution || []).slice().sort(function (a, b) { return b.points - a.points; })[0];
      note.innerHTML = '水料比 ' + esc(fmt(r.mashThickness, 1)) + ' L/kg' +
        (m ? ' · 主要糖源：' + esc(m.name) : '');
    }
    var hint = document.getElementById('malt-hint');
    if (hint) {
      hint.textContent = total > 0
        ? ('总投料 ' + fmt(total, 2) + ' kg，麦糟吸水约 ' + fmt(c.grainAbsorption, 1) + ' L')
        : '';
    }
  }

  function paintHopFoot(c, r) {
    var g = 0;
    for (var i = 0; i < r.hops.length; i++) g += num(r.hops[i].amount, 0);
    var el = document.getElementById('hop-total');
    if (el) el.textContent = fmt(g, 0) + ' g';
    var ibu = document.getElementById('hop-ibu');
    if (ibu) ibu.textContent = fmt(c.ibu, 1);
    var note = document.getElementById('hop-foot-note');
    if (note) {
      var perL = c.postBoilVolume > 0 ? g / c.postBoilVolume : 0;
      note.textContent = '约 ' + fmt(perL, 1) + ' g/L · 苦甜比 ' + fmt(c.buGu, 2) +
        '（' + (c.balance || '') + '）';
    }
  }

  function paintHopRowIbu(c, r) {
    var contrib = c.ibuContribution || [];
    for (var i = 0; i < r.hops.length; i++) {
      var cell = host ? host.querySelector('[data-ibu="' + i + '"]') : null;
      if (!cell) continue;
      var v = '';
      /* 贡献项与酒花行同序；长度不一致时按名称+克数回退匹配 */
      if (contrib.length === r.hops.length && contrib[i]) v = fmt(contrib[i].ibu, 1);
      else {
        for (var k = 0; k < contrib.length; k++) {
          if (contrib[k].name === r.hops[i].name &&
            Math.abs(num(contrib[k].amount, 0) - num(r.hops[i].amount, 0)) < 0.001) {
            v = fmt(contrib[k].ibu, 1);
            break;
          }
        }
      }
      cell.textContent = (v === '' || num(v, -1) <= 0) ? '—' : v;
    }
  }

  /* ---- 三个新工艺段的刷新 ------------------------------------------------
   * 都只改**只读**节点（没有任何输入框由这里回写），所以可以放心地每次重画。
   * 一旦某个 paint 去写输入框的 value，用户打字打到一半就会被覆盖 —— 这是
   * 42 里所有 paint* 的共同约定。 */

  /** 回旋沉淀：投花明细 + 合计。数字全部来自 hops 行与 c.ibuContribution。 */
  function paintWhirlpool(c, r) {
    var box = document.getElementById('wp-detail');
    if (!box) return;
    var html = wpDetailHtml(c, r);
    if (box.__html !== html) { box.innerHTML = html; box.__html = html; }
  }

  /** 酒花区里回旋行的温度只读显示（同一份 hops[].whirlpoolTemp）。
   *  阶段改成回旋 / 在回旋沉淀区改温度，都会走到这里。 */
  function paintHopWpTemp(c, r) {
    if (!host) return;
    var cells = host.querySelectorAll('[data-wp]');
    for (var k = 0; k < cells.length; k++) {
      var i = num(cells[k].getAttribute('data-wp'), -1);
      var h = (i >= 0 && r.hops[i]) ? r.hops[i] : null;
      var tp = h ? num(h.whirlpoolTemp, 0) : 0;
      cells[k].textContent = tp > 0 ? (fmt(tp, 0) + ' °C') : '未设温度';
      cells[k].title = '回旋温度（与「回旋沉淀」区是同一个数）：' +
        (tp > 0 ? fmt(tp, 0) + ' °C' : '还没填，20-calc 按 0.40 的默认折扣算苦度');
    }
  }

  /** 冷却目标温度 vs 发酵温度：给一条可点的同步建议。
   *  这是"冷却目标真的有用"的地方 —— 否则它只是一个存下来的数字。 */
  function paintChill(c, r) {
    var box = document.getElementById('chill-note');
    if (!box) return;
    var p = procOf(r, 'chill');
    var target = num(p.targetC, 19);
    var ferm = num(r.fermentTemp, 19);
    var diff = Math.round((ferm - target) * 10) / 10;
    var html = '';

    /* 这段从来没填过（新配方 / 刚载入入门配方 / 老分享码导入）时，先明说
       "下面是默认值"。不弹窗、不 toast，就区内一行字 —— 目的是让用户分得清
       "这块是空的"和"软件坏了"。 */
    if (!procRaw(r, 'chill')) {
      html += '<div style="margin-bottom:6px">这锅还没填过冷却参数，下面是行业常见默认值（19°C / 板换 / 纯氧 10 ppm / 25 分钟）；改任一项就会存进本配方。</div>';
    }

    if (Math.abs(diff) >= 0.5) {
      html += '<div class="row row--tight" style="gap:8px;flex-wrap:wrap">' +
        '<span>发酵温度设成 <b>' + fmt(ferm, 1) + '°C</b>，与冷却目标 <b>' + fmt(target, 1) + '°C</b> 差 ' +
          fmt(Math.abs(diff), 1) + '°C。</span>' +
        '<button type="button" class="btn btn-quiet btn-xs" data-act="sync-ferment-temp">' +
          '把发酵温度同步为 ' + fmt(target, 1) + '°C</button>' +
        '<span class="u-dim u-xs">接种温度与发酵温度不一致时，前 12 小时会多产酯</span></div>';
    } else {
      html += '<div>发酵温度 ' + fmt(ferm, 1) + '°C 与冷却目标一致（差 ' + fmt(Math.abs(diff), 1) + '°C）。</div>';
    }

    /* 溶氧建议：按当前 OG 给区间。规则写在这里而不是计算内核，因为它是
       "该充多少氧"的经验区间，不参与任何指标计算（内核也不该被它影响）。 */
    var og = num(c && c.og, 0);
    var lo = 8, hi = 10, why = '常规浓度 8–10 ppm 足够';
    if (og >= 1.080) { lo = 12; hi = 15; why = 'OG ≥ 1.080 的高浓度麦汁，酵母合成甾醇需要更多氧'; }
    else if (og >= 1.060) { lo = 10; hi = 12; why = 'OG 1.060–1.080，10–12 ppm 比较稳'; }
    var ppm = num(p.o2ppm, 10);
    var airLike = (p.oxygen === 'air' || p.oxygen === 'shake');
    html += '<div class="mt-8">' +
      (og > 0 ? ('按当前 OG ' + fmt(og, 3) + '，建议 ' + lo + '–' + hi + ' ppm（' + why + '）。') : '') +
      (airLike && ppm > 9
        ? ' <span class="u-warn">空气 / 摇桶在常压下最多溶到 8 ppm 左右，填 ' + fmt(ppm, 0) + ' ppm 是做不到的 —— 要么改成纯氧，要么把目标降到 8。</span>'
        : '') +
      '</div>';

    var mMin = num(p.minutes, 25);
    if (mMin > 45) {
      html += '<div class="mt-8 u-warn">冷却 ' + fmt(mMin, 0) + ' 分钟偏长：麦汁在 60°C 以下停留越久，' +
        'DMS 前体仍在转化、感染窗口也越长。板换做 20 L 通常 15–25 分钟。</div>';
    }

    if (box.__html !== html) { box.innerHTML = html; box.__html = html; }
  }

  /** 后熟与冷降：可饮日期。
   *  ⚠️ 这里的日期是**加法**，不是发酵模型：后熟天数 / 冷降天数是用户填的，
   *  主发酵剩余天数若有在酿批次就取 Batch.analyze 的预测（和左面板
   *  「发酵计划」是同一个来源），没有就明写"未接入在酿批次"，不编一个 7 天。 */
  function paintMature(c, r) {
    var box = document.getElementById('mature-eta');
    if (!box) return;
    var p = procOf(r, 'mature');
    var days = num(p.days, 10);
    var ccOn = isOn(p.coldCrash, true);
    var cc = ccOn ? num(p.ccDays, 3) : 0;
    var fermDays = null;

    try {
      var list = UI.store.batches() || [];
      var best = null;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (!b || b.recipeId !== r.id) continue;
        var s = (BREW.Batch && BREW.Batch.normalizeStatus) ? BREW.Batch.normalizeStatus(b.status) : b.status;
        if (s === 'done' || s === 'failed') continue;
        if (!best || num(b.createdAt, 0) > num(best.createdAt, 0)) best = b;
      }
      if (best) {
        var an = BREW.Batch.analyze(best);
        var dg = (an && an.prediction) ? an.prediction.daysToGo : null;
        if (dg !== null && dg !== undefined && isFinite(dg)) fermDays = Math.max(0, num(dg, 0));
      }
    } catch (e) { fermDays = null; }

    var total = days + cc + (fermDays === null ? 0 : fermDays);
    var when = new Date(Date.now() + Math.round(total * 86400000));
    var html = '';
    /* 同 paintChill：没填过就明说"下面是默认值"，别让空值和故障长得一样。 */
    if (!procRaw(r, 'mature')) {
      html += '<div style="margin-bottom:6px">这锅还没填过后熟参数，下面是行业常见默认值（10 天 @ 3°C、冷降 3 天）；改任一项就会存进本配方。</div>';
    }
    html += '<div>' +
      (fermDays === null
        ? '未接入在酿批次，按本配方从今天算：'
        : '在酿批次主发酵还剩约 ' + fmt(fermDays, 0) + ' 天（按最近读数拟合），加：') +
      '后熟 ' + fmt(days, 0) + ' 天' +
      (ccOn ? ' + 冷降 ' + fmt(cc, 0) + ' 天' : '（不冷降）') +
      ' → <b>约 ' + fmt(total, 0) + ' 天后可饮（' + esc(UI.dt(when.getTime())) + '）</b>' +
      '</div>';

    var warn = '';
    if (ccOn && num(p.ccTempC, 2) >= num(p.tempC, 3)) {
      warn = '冷降温度（' + fmt(num(p.ccTempC, 2), 1) + '°C）不低于后熟温度（' + fmt(num(p.tempC, 3), 1) +
        '°C），这样降不下去酵母不会沉降。';
    } else if (num(p.tempC, 3) > 10) {
      warn = '后熟温度高于 10°C 时更像"继续发酵"而不是后熟：酵母不沉降、风味不收敛。';
    }
    if (warn) html += '<div class="mt-8 u-warn">' + warn + '</div>';

    if (box.__html !== html) { box.innerHTML = html; box.__html = html; }
  }

  /**
   * 第 7 格：感知苦度（v1.2）。
   * 显示的是**区间**（38–46）而不是点值：模型输入本身有 ±10% 的不确定度，
   * 给一个精确到个位的数字是假精度。副标题固定带上原始 IBU，否则用户
   * 会以为上面的 IBU 卡算错了。
   * 模块缺失时退成「—」，不隐藏卡片——布局跳一下比留个空位更让人困惑。
   */
  function paintPerceived(c, r) {
    var cellEl = document.getElementById('m-perceived');
    if (!cellEl) return;
    var sub = document.getElementById('perc-sub');
    var note = document.getElementById('perc-note');
    var ibuTxt = '模型估算区间 · IBU ' + fmt(c.ibu, 0);

    if (!BREW.Perceived || typeof BREW.Perceived.estimate !== 'function') {
      flashIfChanged('m-perceived', '—');
      if (sub) sub.textContent = '模型未载入';
      if (note) note.textContent = '';
      return;
    }

    var est = null;
    try { est = BREW.Perceived.estimate(c, r); } catch (e) { est = null; }
    if (!est) {
      flashIfChanged('m-perceived', '—');
      if (sub) sub.textContent = ibuTxt + ' · 估算失败';
      if (note) note.textContent = '';
      return;
    }

    /* 25 号模块的字段是 low / high / mid（不是 lo / hi）。区间宽 10–18%，
       随因子贴边数变化；拿不到区间时才退回单点。 */
    var lo = num(est.low, NaN), hi = num(est.high, NaN), mid = num(est.mid, NaN);
    var text = (isFinite(lo) && isFinite(hi)) ? (fmt(lo, 0) + '–' + fmt(hi, 0))
      : (isFinite(mid) ? fmt(mid, 0) : '—');
    flashIfChanged('m-perceived', text);
    /* 副标题 = 模块给的 label + 原始 IBU。原始 IBU 必须在场，否则用户会以为
       上面那张 IBU 卡算错了；label 也必须在场，否则区间会被读成测量值。 */
    if (sub) sub.textContent = (est.label || '模型估算区间') + ' · IBU ' + fmt(c.ibu, 0);

    /* disclaimer 放在指标卡下方一行小字（键盘/触屏都能看到），不是只塞进 title。
       模块要求这句话原样透出，不许把估算写成"感知苦度 54 IBU"。 */
    if (note) note.textContent = String(est.disclaimer || (isFinite(mid) ? '中值 ' + fmt(mid, 0) : ''));

    var tip = [];
    if (isFinite(mid)) tip.push((est.label || '模型估算区间') + '：中值 ' + fmt(mid, 0));
    if (est.disclaimer) tip.push(est.disclaimer);
    cellEl.title = tip.join('\n');
  }

  function paintMashSummary(c, r) {
    var el = document.getElementById('mash-summary');
    if (!el) return;
    var steps = r.mash.steps || [];
    var text = '糖化水 <b class="u-mono">' + fmt(c.mashWater, 1) + ' L</b> · 洗糟水 <b class="u-mono">' +
      fmt(c.spargeWater, 1) + ' L</b> · 总用水 <b class="u-mono">' + fmt(c.totalWater, 1) + ' L</b>';
    if (steps.length) {
      var parts = [];
      for (var i = 0; i < steps.length; i++) {
        parts.push(fmt(steps[i].tempC, 0) + '°C/' + fmt(steps[i].minutes, 0) + '′');
      }
      text += '<br>休止序列：<span class="u-mono">' + esc(parts.join(' → ')) + '</span>';
      var hasMashOut = false;
      for (var j = 0; j < steps.length; j++) if (num(steps[j].tempC, 0) >= 75) hasMashOut = true;
      if (!hasMashOut) text += ' · 建议补一步 76°C 10 分钟糖化终止，降低黏度、提高收率';
    }
    el.innerHTML = text;
  }

  /* ======================================================================
   * E. 事件绑定（全部委托到视图根节点）
   * ====================================================================*/

  function bindEvents(el) {
    UI.onComboPick(function (path, id) {
      var seg = String(path).split('.');
      if (!path) return;
      /* 选择器只负责给出 id，写模型 + 换参数快照都在这里做，
         否则按钮文字变了、算出来的还是旧原料 */
      var r = UI.recipe();
      setPath(r, path, id);
      syncRowSnapshot(path, id);
      if (seg.length === 3 && (seg[0] === 'fermentables' || seg[0] === 'hops')) {
        structuralRepaint(seg[0], num(seg[1], 0));
      } else if (seg.length === 3) {
        render(host);
      }
      scheduleRepaint();
    });

    if (bound) return;
    bound = true;

    el.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.hasAttribute('data-combo-search')) return;

      var path = t.getAttribute('data-path');
      if (!path) return;

      var r = UI.recipe();
      var numeric = t.getAttribute('data-num') === '1' || t.type === 'number';
      var val;
      if (numeric) {
        var raw = t.value.trim();
        val = raw === '' ? 0 : num(raw, 0);
      } else {
        val = t.value;
      }
      setPath(r, path, val);

      /* 回旋沉淀区的两个框代表**整段**回旋：写回所有回旋投花行，而不是
         另存一份"段级温度"。同一份数据只在这里与「酒花」区共用。 */
      if (t.id === 'wp-temp') mirrorWhirlpool(r, 'whirlpoolTemp', val);
      if (t.id === 'wp-min') mirrorWhirlpool(r, 'time', val);

      /* 换了原料：同步该行快照参数（否则计算仍用旧原料的 ppg） */
      if (/\.id$/.test(path)) {
        syncRowSnapshot(path, val);
      }
      scheduleRepaint();
      if (path === 'batchSize') checkVolumeHint();
    });

    el.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var path = t.getAttribute('data-path');
      if (!path) return;
      var r = UI.recipe();
      if (t.tagName === 'SELECT') {
        setPath(r, path, t.value);
        if (/\.id$/.test(path)) syncRowSnapshot(path, t.value);
        /* 风格变了，「载入入门配方」按钮的文案要跟着变（v1.7）。
           这里加一行而不是另开一套监听：data-path 的 change 已经统一走这个口子，
           再来一个 document 级监听就会出现"同一件事两处实现"的老问题。 */
        if (path === 'styleId') refreshStarterLabel(t.value);
        /* 酒花行改成/改离「回旋」会改变两个区的**结构**（酒花行多一行温度、
           回旋沉淀区从空态变成有明细），只刷数值不够，整页重画一次。 */
        if (/^hops\.\d+\.stage$/.test(path)) { render(host); return; }
        scheduleRepaint();
        return;
      }
      if (t.type === 'number') {
        var raw = t.value.trim();
        var nv = raw === '' ? 0 : num(raw, 0);
        setPath(r, path, nv);
        if (t.id === 'wp-temp') mirrorWhirlpool(r, 'whirlpoolTemp', nv);
        if (t.id === 'wp-min') mirrorWhirlpool(r, 'time', nv);
        scheduleRepaint();
      }
    });

    el.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      handleAction(btn.getAttribute('data-act'), num(btn.getAttribute('data-idx'), -1), btn, e);
    });

    el.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || t.id !== 'f-open' || !t.value) return;
      loadRecipe(t.value);
    });

    BREW.Bus.on('requestSave', function () { if (host) saveRecipe(); });
    BREW.Bus.on('requestNew', function () { if (host) newRecipe(); });
  }

  var repaintDebounced = null;
  function scheduleRepaint() {
    if (!repaintDebounced) repaintDebounced = UI.debounce(function () { repaint(); }, 150);
    repaintDebounced();
  }

  /** 换原料后把库里的参数快照写进该行（ppg / lov / aa / att / mustMash / 名称） */
  function syncRowSnapshot(path, id) {
    var seg = String(path).split('.');
    var r = UI.recipe();
    var idx = num(seg[1], 0);

    if (seg[0] === 'fermentables') {
      var m = r.fermentables[idx];
      var mi = findIng('malts', id);
      if (!m || !mi) return;
      m.id = mi.id;
      m.name = mi.name;
      m.en = mi.en || '';
      m.cat = mi.cat || 'base';
      m.origin = mi.origin || '';
      m.ppg = num(mi.ppg, 0);
      m.lov = num(mi.lov, 0);
      m.mustMash = mi.mustMash !== false;
      m.fermentable = mi.fermentable || null;
      m.maxPct = mi.maxPct || null;
      if (!num(m.amount, 0)) m.amount = mi.cat === 'base' ? 4 : 0.4;
    } else if (seg[0] === 'hops') {
      var h = r.hops[idx];
      var hi = findIng('hops', id);
      if (!h || !hi) return;
      h.id = hi.id; h.name = hi.name; h.en = hi.en || '';
      h.type = hi.type || '';
      h.aa = num(hi.aa, 0);
      if (!num(h.amount, 0)) h.amount = 20;
    } else if (seg[0] === 'yeasts') {
      var y = r.yeasts[idx];
      var yi = findIng('yeasts', id);
      if (!y || !yi) return;
      y.id = yi.id; y.name = yi.name; y.en = yi.en || '';
      y.lab = yi.lab || ''; y.type = yi.type || 'ale';
      y.att = UI.yeastAtt(yi, 75);   /* v2.0：老自建酵母可能只有 atten */
      y.tempMin = yi.tempMin || null;
      y.tempMax = yi.tempMax || null;
      if (yi.tempMin && yi.tempMax) y.tempC = Math.round((yi.tempMin + yi.tempMax) / 2);
    } else if (seg[0] === 'adjuncts') {
      var a = r.adjuncts[idx];
      var ai = findIng('adjuncts', id);
      if (!a || !ai) return;
      a.id = ai.id; a.name = ai.name; a.en = ai.en || '';
      a.cat = ai.cat || 'other';
      a.unit = ai.unit || 'g';
      if (ai.stage) a.stage = ai.stage;
      if (!num(a.amount, 0)) a.amount = num(ai.useMin, 5);
    } else if (seg[0] === 'water' && seg[1] === 'salts') {
      var s = r.water.salts[idx];
      var si = findIng('waterSalts', id);
      if (!s || !si) return;
      s.id = si.id; s.name = si.name;
      if (!num(s.amount, 0)) s.amount = 2;
    }
  }

  function findIng(kind, id) {
    var found = UI.byId(kind, id);
    if (found) return found;
    var cu = UI.customList(kind);
    for (var i = 0; i < cu.length; i++) if (cu[i].id === id) return cu[i];
    return null;
  }

  /** 增删行 / 换原料后重绘该表 */
  function structuralRepaint(kind, idx) {
    var r = UI.recipe();
    if (kind === 'fermentables' || kind === 'malts') {
      var tb = host ? host.querySelector('[data-rows="fermentables"]') : null;
      if (!tb) { render(host); return; }
      tb.innerHTML = r.fermentables.length
        ? r.fermentables.map(function (m, i) { return maltRow(m, i, r); }).join('')
        : '<tr><td colspan="6">' + UI.emptyState('还没有麦芽', '先加一款基础麦芽。', { small: true, size: 48 }) + '</td></tr>';
      FH.afterRender(host);
      return;
    }
    if (kind === 'hops') {
      var tb2 = host ? host.querySelector('[data-rows="hops"]') : null;
      if (!tb2) { render(host); return; }
      tb2.innerHTML = r.hops.length
        ? r.hops.map(function (h, i) { return hopRow(h, i); }).join('')
        : '<tr><td colspan="7">' + UI.emptyState('还没有酒花', '加一次 60 分钟苦化投放。', { small: true, size: 48 }) + '</td></tr>';
      FH.afterRender(host);
      return;
    }
    render(host);
  }

  function handleAction(act, idx, btn, ev) {
    var r = UI.recipe();
    var Recipe = BREW.Recipe;

    switch (act) {
      case 'add-malt':
        addRow('fermentables', pickDefault('malts'));
        break;
      case 'del-malt':
        r.fermentables.splice(idx, 1);
        render(host);
        break;

      case 'add-hop':
        addRow('hops', pickDefault('hops'));
        break;
      case 'del-hop':
        r.hops.splice(idx, 1);
        render(host);
        break;

      /* v1.9：回旋沉淀区的「添加回旋投花」。走的是同一条 addHop —— 不另造
         "回旋投花对象"，所以它在「酒花」区就是一行普通的 whirlpool 酒花。 */
      case 'add-whirlpool-hop':
        (function () {
          var hid = pickDefault('hops');
          var ing = hid ? findIng('hops', hid) : null;
          if (Recipe && Recipe.addHop && ing) {
            var row = Recipe.addHop(r, ing, 30, 'whirlpool', 20);
            if (row) row.whirlpoolTemp = 85;
          } else if (hid) {
            r.hops.push({ id: hid, amount: 30, stage: 'whirlpool', time: 20, whirlpoolTemp: 85 });
          }
          UI.setRecipe(r);
          render(host);
          scheduleRepaint();
        })();
        break;

      /* 冷却目标温度 → 发酵温度的一次性同步。只在这里改 fermentTemp，
         不反向自动写：用户可能刻意用不同的接种温度。 */
      case 'sync-ferment-temp':
        (function () {
          var p = procOf(r, 'chill');
          r.fermentTemp = num(p.targetC, 19);
          render(host);
          scheduleRepaint();
          if (UI.Shell && UI.Shell.toast) {
            UI.Shell.toast('发酵温度已同步为 ' + fmt(r.fermentTemp, 1) + '°C', 'ok', 2000);
          }
        })();
        break;

      case 'add-yeast':
        addRow('yeasts', pickDefault('yeasts'));
        break;
      case 'del-yeast':
        r.yeasts.splice(idx, 1);
        render(host);
        break;

      case 'add-adj':
        addRow('adjuncts', pickDefault('adjuncts'));
        break;
      case 'del-adj':
        r.adjuncts.splice(idx, 1);
        render(host);
        break;

      case 'add-salt':
        /* 单位必须按盐种取：乳酸/磷酸是 ml，不是 g。原来这里硬写 'g'，
           显示层读的是库里的 unit（看起来没错），但分享码/导出/打印读的是
           这一行自己的 unit——于是"2ml 乳酸"在导出的配方里变成"2g"。
           这里就按库写对，别把错误留给下游去猜。 */
        (function () {
          var sid = pickDefault('waterSalts');
          var sdef = sid ? UI.byId('waterSalts', sid) : null;
          r.water.salts.push({ id: sid, amount: 2, unit: (sdef && sdef.unit) || 'g' });
        })();
        render(host);
        break;
      case 'del-salt':
        r.water.salts.splice(idx, 1);
        render(host);
        break;

      case 'water-clear':
        r.water.source = { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0 };
        render(host);
        break;

      case 'add-mash':
        r.mash.steps.push({ name: '休止', tempC: 66, minutes: 20 });
        render(host);
        break;
      case 'del-mash':
        r.mash.steps.splice(idx, 1);
        render(host);
        break;
      case 'mash-single':
        r.mash.steps = [
          { name: '糖化', tempC: 67, minutes: 60 },
          { name: '出糖', tempC: 76, minutes: 10 }
        ];
        render(host);
        UI.Shell.toast('已切换为标准两步糖化（67°C → 76°C）', 'ok', 1800);
        break;

      case 'save': saveRecipe(); break;
      case 'saveas': saveAs(); break;
      case 'duplicate': duplicateRecipe(); break;
      case 'delete': deleteRecipe(); break;
      case 'report':
        if (UI.Shell) UI.Shell.go('report');
        break;
      case 'load-default': loadStarter(UI.recipe().styleId); break;

      /* v1.2 三个新动作。全部带存在性守卫：对应的模块由别的分支并行开发，
         没落盘时只能少一个功能，不能让整页点一下就报错。 */
      case 'diff':
        if (UI.Diff && typeof UI.Diff.open === 'function') UI.Diff.open();
        else UI.Shell.toast('版本对比模块未载入', 'warn', 3200);
        break;
      case 'share':
        if (UI.Share && typeof UI.Share.openModal === 'function') UI.Share.openModal(r);
        else UI.Shell.toast('分享模块未载入', 'warn', 3200);
        break;
      case 'water-match':
        openWaterMatch();
        break;

      default: break;
    }
  }

  /**
   * 水质匹配（v1.2）：把源水离子丢给 BREW.WaterMatch，列前三个相近水型与差值，
   * 并对最接近的那个出一份盐类建议。
   *
   * v1.2 收口补的三件事（原来这里只有"看"，没有"用"）：
   *   ① 可以直接粘贴水质报告 —— 否则 27 的 parseReport 只在工具集里活着，关掉就没了；
   *   ② 盐建议给到「盐名 / 克数 / 加到多少升 / 各离子涨多少 ppm」四列，
   *      不给"把硫酸盐提到 150"这种只有方向没有量的话；
   *   ③ 两个出口：写进本配方的 `water.source`、存进 Store 的 `userWater`。
   *
   * 为什么写 `water.source` 而不是新加 `water.ions`：
   *   `recipe.water` 的既有形状是 `{profileId, source:{6 离子}, salts:[]}`，
   *   20-calc 与整个配方页读的都是 `water.source`。再开一个 `ions` 字段
   *   就是"同一件事两份表示"，两份迟早分叉（docs/00 §7⑪ 就是这么来的）。
   *
   * 口径提醒：match() 返回的 diff 是「水型 − 我的」，不是「我的 − 水型」。
   * 符号搞反会让"我还差多少钙"整个反过来，所以界面上写清楚是拿谁的减谁。
   */
  function openWaterMatch() {
    if (!BREW.WaterMatch || typeof BREW.WaterMatch.match !== 'function') {
      UI.Shell.toast('水质匹配模块未载入（js/27-calc-water-match.js）', 'warn', 3600);
      return;
    }
    var WM = BREW.WaterMatch;
    var r = UI.recipe();
    var IONS = [
      { k: 'ca', label: 'Ca²⁺' }, { k: 'mg', label: 'Mg²⁺' }, { k: 'na', label: 'Na⁺' },
      { k: 'cl', label: 'Cl⁻' }, { k: 'so4', label: 'SO₄²⁻' }, { k: 'hco3', label: 'HCO₃⁻' }
    ];
    var VOL = num(r.batchSize, 20);

    /** 配方里现有的源水，补成六个数字（缺的按 0，与 20-calc 口径一致） */
    function recipeSource() {
      var s0 = (r.water || {}).source || {};
      var o = {};
      for (var i = 0; i < IONS.length; i++) o[IONS[i].k] = num(s0[IONS[i].k], 0);
      return o;
    }

    var parsed = null;            /* 最近一次粘贴的解析结果（null = 没粘） */
    var ions = recipeSource();    /* 当前参与匹配的"我的水" */

    function ionLabel(k) {
      for (var i = 0; i < IONS.length; i++) if (IONS[i].k === k) return IONS[i].label;
      return k;
    }

    /** 粘了报告就用报告（解析到的项覆盖），没粘就用配方源水 */
    function resolveIons() {
      if (!parsed || !parsed.found.length) return recipeSource();
      var base = recipeSource();
      for (var i = 0; i < IONS.length; i++) {
        var k = IONS[i].k;
        if (parsed.ions[k] !== null && parsed.ions[k] !== undefined) base[k] = parsed.ions[k];
      }
      return base;
    }

    function mineHtml() {
      var h = '';
      for (var i = 0; i < IONS.length; i++) {
        var v = ions[IONS[i].k];
        var miss = (parsed && parsed.found.length &&
          (parsed.ions[IONS[i].k] === null || parsed.ions[IONS[i].k] === undefined));
        h += '<div class="wm-ion"><span class="wm-ion__k">' + esc(IONS[i].label) + '</span>' +
          '<span class="wm-ion__v">' + esc(fmt(v, 0)) +
          (miss ? ' <span class="u-xs u-dim">沿用</span>' : '') + '</span></div>';
      }
      return h;
    }

    /** 粘贴区下方的解析回执：认到了什么、没认出什么 */
    function parsedHtml() {
      if (!parsed) return '';
      if (!parsed.found.length) {
        return '<div class="alert alert--warn"><span class="alert__icon">' + icon('alert', 13) + '</span>' +
          '<span>' + esc(parsed.message || '没认出任何离子') + '</span></div>';
      }
      var extra = '';
      var notes = Array.isArray(parsed.notes) ? parsed.notes : [];
      for (var n = 0; n < notes.length; n++) extra += '<p class="u-xs u-dim">' + esc(String(notes[n])) + '</p>';
      var cls = parsed.missingZh && parsed.missingZh.length ? 'alert alert--info' : 'alert alert--ok';
      return '<div class="' + cls + '"><span class="alert__icon">' + icon('check', 13) + '</span>' +
        '<span>认到 ' + parsed.found.length + '/6 个离子' +
        (parsed.missingZh && parsed.missingZh.length ? '；' + esc(parsed.message) : '') +
        '</span></div>' + (extra ? '<div class="mt-8">' + extra + '</div>' : '');
    }

    /** 盐建议：四列 + 不可达时的那句话 */
    function saltHtml(sug) {
      if (!sug) return '';
      var head = '<div class="wm-card"><div class="wm-card__head">' +
        '<b>对齐到「' + esc(String(sug.targetName || '目标水')) + '」要加的盐</b>' +
        '<span class="u-xs u-dim">按 ' + esc(fmt(VOL, 0)) + ' L 计</span></div>' +
        '<p class="u-xs u-dim" style="margin:2px 0 8px">' + esc(String(sug.headline || '')) + '</p>';

      var body = '';
      if (Array.isArray(sug.salts) && sug.salts.length) {
        var rows = '';
        for (var i = 0; i < sug.salts.length; i++) {
          var s1 = sug.salts[i] || {};
          var dl = s1.deltas || {};
          var bits = [];
          for (var j = 0; j < IONS.length; j++) {
            var kk = IONS[j].k;
            if (dl[kk] === undefined || dl[kk] === null) continue;
            if (Math.abs(num(dl[kk], 0)) < 0.5) continue;
            bits.push(esc(ionLabel(kk)) + ' +' + esc(fmt(dl[kk], 1)));
          }
          rows += '<tr>' +
            '<td>' + esc(String(s1.name || s1.id || '')) + '</td>' +
            '<td class="num u-mono">' + esc(fmt(s1.grams, 1)) + ' ' + esc(s1.unit || 'g') + '</td>' +
            '<td class="num u-mono u-sm">' + esc(fmt(num(s1.volL, VOL), 0)) + ' L</td>' +
            '<td class="u-sm u-muted">' + (bits.join('、') || '—') + '</td>' +
            '</tr>';
        }
        body += '<div class="table-wrap" style="border:0"><table class="table table--compact">' +
          '<thead><tr><th>盐</th><th class="num" style="width:88px">用量</th>' +
          '<th class="num" style="width:64px">加到</th><th>各离子增量（mg/L）</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div>';
        body += '<p class="u-xs u-dim" style="margin-top:6px">' +
          '增量 = 该克数加进 ' + esc(fmt(VOL, 0)) + ' L 后的实测浓度变化，不是"建议区间"。</p>';
      } else {
        body += '<p class="u-xs u-dim">这个目标不需要加盐：现状已经落在可调范围内。' +
          '想按某个风格调水（例如「西海岸 IPA」要把 SO₄ 拉到 250），请在上面把目标换成那个风格。</p>';
      }

      /* 不可达：必须点名差得最多的是谁，否则用户会以为方案没做完 */
      if (sug.reachable === false) {
        var w = sug.worst;
        var say = '这组离子用这几种盐调不到目标';
        if (w) {
          say += '：差得最多的是 ' + String(w.label || w.ion) +
            (w.over
              ? '（已超出 ' + Math.abs(num(w.left, 0)) + ' ppm，加盐只会更超，只能兑 RO 水稀释）'
              : '（还差 ' + Math.abs(num(w.left, 0)) + ' ppm）');
        }
        body += '<div class="alert alert--warn" style="margin-top:8px">' +
          '<span class="alert__icon">' + icon('alert', 13) + '</span><span>' + esc(say) + '</span></div>';
      } else {
        var rrows = '';
        var resList = Array.isArray(sug.residual) ? sug.residual : [];
        for (var q = 0; q < resList.length; q++) {
          var ri = resList[q] || {};
          var left = num(ri.left, 0);
          if (Math.abs(left) <= 10) continue;
          rrows += '<div class="wm-diff' + (Math.abs(left) > 40 ? ' is-far' : '') + '">' +
            '<span>' + esc(String(ri.label || ri.ion || '')) + '</span>' +
            '<span>' + esc(fmt(ri.target, 0)) + ' ← ' + esc(fmt(ri.got, 0)) + '</span>' +
            '<span>还差 ' + (left > 0 ? '+' : '') + esc(fmt(left, 0)) + '</span>' +
            '</div>';
        }
        if (rrows) body += '<div class="u-xs u-dim" style="margin-top:8px">加完还差（&gt;10 ppm 才列）</div>' + rrows;
      }

      if (sug.note) body += '<p class="u-xs u-dim mt-8">' + esc(String(sug.note)) + '</p>';
      return '<div class="mt-12">' + head + body + '</div>';
    }

    function cardsHtml(list) {
      var out = '';
      for (var j = 0; j < list.length; j++) {
        var m = list[j] || {};
        var diff = m.diff || {};
        var diffsHtml = '';
        for (var d = 0; d < IONS.length; d++) {
          if (diff[IONS[d].k] === undefined) continue;
          var delta = num(diff[IONS[d].k], 0);
          if (Math.abs(delta) < 1) continue;
          var theirs = num(ions[IONS[d].k], 0) + delta;
          diffsHtml += '<div class="wm-diff' + (Math.abs(delta) > 40 ? ' is-far' : '') + '">' +
            '<span>' + esc(IONS[d].label) + '</span>' +
            '<span>' + esc(fmt(ions[IONS[d].k], 0)) + ' → ' + esc(fmt(theirs, 0)) + '</span>' +
            '<span>' + (delta > 0 ? '+' : '') + esc(fmt(delta, 0)) + '</span>' +
            '</div>';
        }
        out += '<div class="wm-card">' +
          '<div class="wm-card__head"><b>' + esc(String(m.name || m.profileId || '水型 ' + (j + 1))) + '</b>' +
          '<span class="u-xs u-dim u-mono">距离 ' + esc(fmt(m.distance, 2)) +
          (m.compared && m.compared < 6 ? ' · 只比了 ' + m.compared + ' 项' : '') + '</span>' +
          '</div>' +
          (diffsHtml || '<div class="u-xs u-dim">六个离子都在 ±1 ppm 内</div>') +
          '</div>';
      }
      return out;
    }

    /** 重算 + 重绘动态区。粘一次报告只重绘这一块，不重建整个模态（否则输入框丢焦点） */
    function repaint(api) {
      ions = resolveIons();
      var list = [], sug = null;
      try { list = WM.match(ions, 3) || []; } catch (e) { list = []; }
      var top = list[0];

      /* 目标水从下拉读：`auto` = 最接近的那个历史水型（原来写死的口径），
         或者用户点名的风格目标 / 具体水型。
         为什么必须能选：**拿"最接近的水型"当目标，等于拿你自己当目标**，
         于是永远"不需要加盐"——用户看到的就是"只有方向没有量"。
         要给具体盐量，目标是"你想变成的那套水"，不是"你现在的样子"。 */
      var selEl = api && api.query ? api.query('#wm-target') : null;
      var want = selEl ? String(selEl.value || 'auto') : 'auto';
      var targetId = (want === 'auto') ? (top && top.profileId) : want;

      if (targetId && typeof WM.suggest === 'function') {
        try { sug = WM.suggest(ions, targetId, VOL); } catch (e2) { sug = null; }
      }
      var box = api.query('#wm-parsed');
      if (box) box.innerHTML = parsedHtml();
      var res = api.query('#wm-result');
      if (res) {
        res.innerHTML =
          '<div class="wm-mine"><div class="u-xs u-dim" style="letter-spacing:.6px;margin-bottom:6px">' +
            '当前使用的水（mg/L）' + (parsed && parsed.found.length ? ' · 来自粘贴的报告' : ' · 来自本配方源水') +
          '</div><div class="wm-ionrow">' + mineHtml() + '</div></div>' +
          (cardsHtml(list) || '<div class="alert alert--info mt-12"><span class="alert__icon">' +
            icon('info', 13) + '</span><span>没有匹配到相近水型：可能是源水离子还全是 0。</span></div>') +
          saltHtml(sug);
      }
    }

    /** 目标水下拉：8 个风格目标 + 12 个具体水型，默认「自动 = 最接近的水型」 */
    function targetSelectHtml() {
      var h = '<select class="select" id="wm-target" aria-label="目标水">' +
        '<option value="auto">自动：最接近的历史水型（等于你现在的水平，通常不需要加盐）</option>';
      var wts = (BREW.DB && BREW.DB.waterTargets) || [];
      if (wts.length) {
        h += '<optgroup label="按风格目标（SO₄ / Cl 区间中值）">';
        for (var i = 0; i < wts.length; i++) {
          h += '<option value="' + attr(wts[i].id) + '">' + esc(String(wts[i].name || wts[i].id)) + '</option>';
        }
        h += '</optgroup>';
      }
      var wps = (BREW.DB && BREW.DB.waterProfiles) || [];
      if (wps.length) {
        h += '<optgroup label="按具体水型（六离子全给）">';
        for (var j = 0; j < wps.length; j++) {
          if (wps[j].id === 'wp-custom') continue;
          h += '<option value="' + attr(wps[j].id) + '">' + esc(String(wps[j].name || wps[j].id)) + '</option>';
        }
        h += '</optgroup>';
      }
      return h + '</select>';
    }

    /** 解析粘贴的文本；空文本 = 清空，退回配方源水 */
    function parseNow(api) {
      var ta = api.query('#wm-report');
      var text = ta ? String(ta.value || '') : '';
      if (!text.trim()) { parsed = null; repaint(api); return; }
      try { parsed = WM.parseReport(text); } catch (e) { parsed = null; }
      repaint(api);
    }

    var api = UI.Shell.modal({
      title: '水质匹配',
      sub: '粘一份水质报告，或直接用配方里已有的源水',
      size: 'wide',
      autoFocus: '#wm-report',
      body:
        '<div class="field">' +
          '<label class="field__label" for="wm-report">水质报告（可直接粘贴原文，留空则用配方源水）</label>' +
          '<textarea class="input" id="wm-report" rows="3" ' +
            'placeholder="例如：pH 7.4　钙 42　镁 9　钠 28　氯 35　硫酸盐 40　碳酸氢盐 95（mg/L）">' +
          '</textarea>' +
          '<span class="field__hint">一行多列、一行多个离子、mmol/L · meq/L · °dH 都能认；' +
            '碱度会折成 HCO₃⁻，总硬度不会当成碱度用</span>' +
        '</div>' +
        '<div class="field mt-12">' +
          '<label class="field__label" for="wm-target">要对齐到哪套水</label>' +
          targetSelectHtml() +
          '<span class="field__hint">盐量是"从你现在的水平走到这个目标"的差值。' +
            '选「自动」拿到的是最接近你的水型，所以通常不需要加盐——那是参照，不是目标。</span>' +
        '</div>' +
        '<div id="wm-parsed" class="mt-8"></div>' +
        '<div id="wm-result" class="mt-12"></div>' +
        '<p class="u-xs u-dim mt-16">差值 = 水型值 − 当前值（正数表示这个水型比你多）。' +
        '|Δ| &gt; 40 ppm 的项标黄。盐建议只动 SO₄ / Cl / Ca / Mg，不碰调 pH 的小苏打与乳酸——' +
        '那是糖化 pH 的活，混在一起会互相打架。</p>',
      actions: [
        {
          label: '用于本配方',
          kind: 'primary',
          close: false,
          act: function (api2) {
            if (!parsed || !parsed.found.length) {
              UI.Shell.toast('先在上面粘一段水质报告：没解析出离子，就没有能写进配方的数', 'warn', 3600);
              return false;
            }
            if (!r.water) r.water = {};
            if (!r.water.source) r.water.source = {};
            var wrote = 0, kept = [];
            for (var i = 0; i < IONS.length; i++) {
              var k = IONS[i].k;
              var v = parsed.ions[k];
              if (v === null || v === undefined || !isFinite(v)) { kept.push(ION_LABEL(k)); continue; }
              r.water.source[k] = num(v, 0);
              wrote++;
            }
            try { UI.publish(); } catch (e) { /* 落盘异常不该挡住提示 */ }
            if (wrote) {
              UI.Shell.toast('已写入本配方 ' + wrote + ' 项' +
                (kept.length ? '；' + kept.join('、') + ' 保持原值（报告里没认出来）' : ''), 'ok', 3800);
            } else {
              UI.Shell.toast('一项都没写：报告里没有可用的离子数值', 'warn', 3600);
            }
            render(host);
            return false;
          }
        },
        {
          label: '存为我的水源',
          kind: 'ghost',
          close: false,
          act: function () {
            if (!parsed || !parsed.found.length) {
              UI.Shell.toast('先粘一段水质报告，再存', 'warn', 3000);
              return false;
            }
            var st = UI.store;
            if (!st || typeof st.set !== 'function') {
              UI.Shell.toast('存储不可用（BREW.Store 未载入），这次没能保存', 'error', 3600);
              return false;
            }
            var list = st.get('userWater', []);
            if (!Array.isArray(list)) list = [];
            var d = new Date();
            var pad = function (n2) { return n2 < 10 ? '0' + n2 : '' + n2; };
            var name = '我的水源 ' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
              pad(d.getHours()) + ':' + pad(d.getMinutes());
            var entry = {
              id: UI.uid('uw'),
              name: name,
              at: d.getTime(),
              ions: {
                ca: parsed.ions.ca, mg: parsed.ions.mg, na: parsed.ions.na,
                cl: parsed.ions.cl, so4: parsed.ions.so4, hco3: parsed.ions.hco3
              },
              missing: parsed.missing.slice()
            };
            list.push(entry);
            /* 只留最近 20 条：这条键没有界面管理入口，无限长会变成隐藏垃圾 */
            if (list.length > 20) list = list.slice(list.length - 20);
            try {
              st.set('userWater', list);
            } catch (e) {
              UI.Shell.toast('保存失败：' + ((e && e.message) || '本地存储写入被拒绝'), 'error', 4200);
              return false;
            }
            UI.Shell.toast('已存为「' + name + '」，共 ' + list.length + ' 条我的水源', 'ok', 3200);
            return false;
          }
        },
        { label: '关闭', kind: 'ghost' }
      ],
      onMount: function (api2) {
        var ta = api2.query('#wm-report');
        var timer = 0;
        if (ta) {
          ta.addEventListener('input', function () {
            if (timer) root.clearTimeout(timer);
            timer = root.setTimeout(function () { timer = 0; parseNow(api2); }, 260);
          });
        }
        var sel = api2.query('#wm-target');
        if (sel) sel.addEventListener('change', function () { repaint(api2); });
        repaint(api2);
      }
    });

    if (!api) return;

    function ION_LABEL(k) {
      for (var i = 0; i < IONS.length; i++) if (IONS[i].k === k) return IONS[i].label;
      return k;
    }
  }

  /** 新增一行：优先用 BREW.Recipe 的工厂函数（带完整参数快照） */
  function addRow(kind, ingId) {
    var r = UI.recipe();
    var Recipe = BREW.Recipe;
    var ing = findIng({ fermentables: 'malts', hops: 'hops', yeasts: 'yeasts', adjuncts: 'adjuncts' }[kind], ingId);

    if (kind === 'fermentables') {
      var kg = ing && ing.cat === 'base' ? 4 : (ing && num(ing.maxPct, 10) <= 8 ? 0.15 : 0.4);
      if (Recipe && Recipe.addFermentable && ing) Recipe.addFermentable(r, ing, kg);
      else r.fermentables.push({ id: ingId, amount: kg });
    } else if (kind === 'hops') {
      var isAroma = ing && String(ing.type || '').toLowerCase() === 'aroma';
      if (Recipe && Recipe.addHop && ing) Recipe.addHop(r, ing, 20, 'boil', isAroma ? 5 : 60);
      else r.hops.push({ id: ingId, amount: 20, stage: 'boil', time: 60 });
    } else if (kind === 'yeasts') {
      var grams = ing && ing.form === 'liquid' ? 100 : 11;
      if (Recipe && Recipe.addYeast && ing) Recipe.addYeast(r, ing, grams);
      else r.yeasts.push({ id: ingId, amount: grams, tempC: 19, att: 75 });
    } else if (kind === 'adjuncts') {
      if (Recipe && Recipe.addAdjunct && ing) Recipe.addAdjunct(r, ing);
      else r.adjuncts.push({ id: ingId, amount: 5, stage: 'boil' });
    }
    UI.setRecipe(r);
    render(host);
  }

  function pickDefault(kind) {
    var pool = UI.pool(kind);
    if (!pool.length) return '';
    if (kind === 'malts') {
      for (var i = 0; i < pool.length; i++) if (pool[i].cat === 'base') return pool[i].id;
    }
    if (kind === 'waterSalts') {
      for (var k = 0; k < pool.length; k++) {
        if (/gypsum|石膏/i.test((pool[k].name || '') + (pool[k].en || ''))) return pool[k].id;
      }
    }
    return pool[0].id;
  }

  function checkVolumeHint() {
    var r = UI.recipe();
    var el = document.getElementById('hint-vol');
    if (!el) return;
    var v = num(r.batchSize, 20);
    var off = v < 18 || v > 22;
    el.textContent = off ? '注意：偏离家用常见区间 18–22 L' : '家用常规 18–22 L';
    /* v1.6：hint 改成单行省略，长文案（"注意：偏离…"）在窄列上会被截掉尾部。
       title 必须跟着 textContent 一起走，不然标题还停在上一次的文案上。 */
    el.title = el.textContent;
    el.classList.toggle('is-warn', off);
  }

  /* ======================================================================
   * F. 配方增删改
   * ====================================================================*/

  function saveRecipe() {
    var r = UI.recipe();
    if (!r.name || !r.name.trim()) {
      UI.Shell.toast('先给配方起个名字再保存', 'warn');
      var nameEl = document.getElementById('f-name');
      if (nameEl) nameEl.focus();
      return;
    }
    try {
      r.updatedAt = Date.now();
      /* 传**深拷贝**而不是 r 本身。原因：Store.saveRecipe 是把对象收进数组
         （`d.recipes[i] = merged`，merged 的数组字段直接引用 r 的数组），
         所以传 r 等于让"已保存版本"和"工作副本"共用一份 fermentables。
         后果是用户保存后继续改量，库里那份跟着一起变——版本对比永远显示
         "完全一致"，而这正是 v1.2 要修的问题。给一份快照最省事。 */
      UI.store.saveRecipe(UI.clone(r));
      UI.Shell.toast('已保存《' + r.name + '》', 'ok');
      repaint();
    } catch (e) {
      UI.reportError(e, 'saveRecipe');
    }
  }

  function saveAs() {
    var r = UI.recipe();
    UI.Shell.modal({
      title: '另存为新配方',
      size: 'narrow',
      body: '<div class="field">' +
        '<label class="field__label" for="as-name">新配方名称</label>' +
        '<input class="input" id="as-name" type="text" value="' + attr(r.name + ' 副本') + '">' +
        '</div>',
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '保存为新配方', kind: 'primary',
          act: function (api) {
            var input = api.query('#as-name');
            var name = input ? input.value.trim() : '';
            if (!name) { UI.Shell.toast('名称不能为空', 'warn'); return false; }
            var copy = UI.clone(UI.recipe());
            copy.id = UI.uid('r');
            copy.name = name;
            copy.createdAt = Date.now();
            copy.updatedAt = Date.now();
            copy.parentId = UI.recipe().id;
            UI.store.saveRecipe(copy);
            UI.setRecipe(copy);
            render(host);
            UI.Shell.toast('已另存为《' + name + '》', 'ok');
          }
        }
      ]
    });
  }

  function duplicateRecipe() {
    var copy = UI.clone(UI.recipe());
    copy.id = UI.uid('r');
    copy.name = UI.recipe().name + ' 副本';
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    /* 谱系：复制出来的配方必须记住"我从谁身上复制来的"。
       这里以前漏了 parentId，而 Recipe.clone 与"另存为"都写了——
       结果同一个动作换条路径就断链，配方谱系树（v1.2）会缺一支。 */
    copy.parentId = UI.recipe().id;
    copy.rev = 1;
    UI.store.saveRecipe(copy);
    UI.setRecipe(copy);
    render(host);
    UI.Shell.toast('已复制并切换到副本', 'ok');
  }

  function deleteRecipe() {
    var r = UI.recipe();
    var saved = false;
    var list = UI.store.recipes();
    for (var i = 0; i < list.length; i++) if (list[i].id === r.id) saved = true;

    UI.Shell.confirm({
      title: '删除这个配方？',
      message: saved
        ? '《' + r.name + '》将从本地存储中移除，不可恢复。'
        : '这个配方还没有保存过，删除只会清空当前编辑内容。',
      detail: '建议先导出配方卡留档。',
      okLabel: '删除',
      danger: true
    }, function () {
      if (saved) UI.store.removeRecipe(r.id);
      UI.setRecipe(UI.blankRecipe());
      render(host);
      UI.Shell.toast('已删除', 'ok');
    });
  }

  function loadRecipe(id) {
    var list = UI.store.recipes();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        UI.setRecipe(list[i]);
        render(host);
        UI.Shell.toast('已打开《' + (list[i].name || '未命名') + '》', 'ok');
        return;
      }
    }
  }

  function newRecipe() {
    var r = UI.recipe() || {};
    var malts = (r.fermentables || r.malts || []);
    var hasContent = malts.length || (r.hops || []).length ||
                     (r.yeasts || []).length || (r.adjuncts || []).length;

    if (!hasContent) { doNew(); return; }

    /* 顶栏"新建"就在"保存配方"左边，误点一下就是一次演示事故。
       所以有内容时先确认；未保存时用红色按钮并把后果写清楚。 */
    var savedList = (UI.store && UI.store.recipes) ? UI.store.recipes() : [];
    var isSaved = false;
    for (var i = 0; i < savedList.length; i++) {
      if (savedList[i].id === r.id) { isSaved = true; break; }
    }

    if (!UI.Shell || typeof UI.Shell.confirm !== 'function') {
      /* 兜底：没有确认框组件就直接新建，不能因为缺组件卡住流程 */
      doNew();
      return;
    }

    UI.Shell.confirm({
      title: '新建配方',
      message: isSaved
        ? '当前配方「' + (r.name || '未命名') + '」已经保存过，新建不会影响它。继续吗？'
        : '当前配方「' + (r.name || '未命名') + '」还没有保存，新建会把它丢掉。',
      detail: isSaved ? '' : '建议先点右上角「保存配方」，再新建',
      okLabel: isSaved ? '新建' : '丢弃并新建',
      danger: !isSaved
    }, function () {
      doNew();
    });
  }

  function doNew() {
    UI.setRecipe(UI.blankRecipe());
    render(host);
    UI.Shell.toast('已新建空白配方', 'ok', 1800);
  }

  /* ======================================================================
   * F. 「载入入门配方」—— 跟着「啤酒风格」下拉走
   * ----------------------------------------------------------------------
   * 为什么不再写死一份美式琥珀艾尔（v1.7）：
   *   原来按钮文案是"载入一套入门配方"，点下去却永远是一锅琥珀艾尔。
   *   用户在风格下拉里选 21A 美式 IPA，载入后风格匹配条整片标红 ——
   *   第一反应是"这软件算错了"，第二反应才是"基线是死的"。
   *   基线必须等于用户选的那个风格的基线，否则这个按钮在教人犯错。
   *
   * 取配方的顺序（能复用就不重算，顺序本身就是设计）：
   *   ① 经典配方库里有这个风格 → 深拷贝一条，按 20 L 等比缩放。
   *      50 条经典配方覆盖 40+ 个风格，麦芽骨架 / 酒花节奏 / 酵母都是成熟组合，
   *      比任何临时合成更像"能酿的酒"。
   *   ② 没有 → 交给 BREW.Recipe.fromStyle()（30 号的规则引擎：按风格区间
   *      中值取麦量、按 IBU 目标反算酒花、按风格给酵母与特种麦芽）。
   *      **这里绝不另写一套 OG / IBU / SRM 公式。** 这个项目已经因为
   *      "同一件事两处实现"翻过车（SRM↔EBC 各写一份），规则引擎就是
   *      唯一实现；它一次估出来的 OG 可能差几个点，所以允许用内核试算微调。
   *   ③ 风格库 / 配方库都没载入 → 退回原来的通用基线，并在 toast 里说明原因，
   *      不能让用户以为"选了风格但系统给了别的风格"。
   * ====================================================================*/

  /** 新的工作副本 id：载入的配方必须是一个新 id，否则保存时会顶掉经典配方那条 */
  function freshRecipeId() {
    try {
      if (BREW.Util && typeof BREW.Util.uid === 'function') return BREW.Util.uid('r');
    } catch (e) { /* 落到下面 */ }
    return 'r' + Date.now().toString(36);
  }

  function roundTo(v, d) {
    var m = Math.pow(10, d);
    return Math.round(v * m) / m;
  }

  /**
   * 把一份配方等比缩放到 20 L。
   * 麦芽 kg / 酒花 g / 酵母 g / 辅料 / 水盐 全部按同一个系数走 ——
   * 等比缩放是"同一锅酒换个量"，比例不变，所以 OG / IBU / SRM 都不会漂。
   * 设备参数（沉渣损失、蒸发率、糖化水比）不缩放：它们属于设备，不属于配方量。
   */
  function scaleTo20(r) {
    var from = num(r.batchSize, 20) || 20;
    var k = 20 / from;
    if (Math.abs(k - 1) < 1e-6) { r.batchSize = 20; return r; }

    var i;
    for (i = 0; i < (r.fermentables || []).length; i++) {
      r.fermentables[i].amount = roundTo(num(r.fermentables[i].amount, 0) * k, 2);
    }
    for (i = 0; i < (r.hops || []).length; i++) {
      r.hops[i].amount = roundTo(num(r.hops[i].amount, 0) * k, 1);
    }
    for (i = 0; i < (r.adjuncts || []).length; i++) {
      r.adjuncts[i].amount = roundTo(num(r.adjuncts[i].amount, 0) * k, 1);
    }
    for (i = 0; i < (r.yeasts || []).length; i++) {
      r.yeasts[i].amount = roundTo(num(r.yeasts[i].amount, 0) * k, 1);
    }
    if (r.water && r.water.salts) {
      for (i = 0; i < r.water.salts.length; i++) {
        r.water.salts[i].amount = roundTo(num(r.water.salts[i].amount, 0) * k, 2);
      }
    }
    r.batchSize = 20;
    return r;
  }

  /**
   * 按目标 OG 微调基础麦芽用量。
   *
   * 为什么用试算而不是解析式：
   *   OG 与麦量的关系里夹着体积平衡（蒸发、沉渣、吸水）与效率，
   *   解析式要和内核保持一字不差才能对齐；直接让内核算完再按比例修正，
   *   用的是同一个 calcRecipe，不存在"两套公式"的漂移。
   *
   * 每次只做一次线性外推（OG 与麦量在固定效率下近似成正比），
   * 正常情况下 1–2 次就到位；40 次只是兜底上限，防某个配方卡在平台区。
   */
  function refineToOg(r, target) {
    if (!BREW.Calc || typeof BREW.Calc.calcRecipe !== 'function') return r;
    var base = null;
    for (var i = 0; i < (r.fermentables || []).length; i++) {
      if ((r.fermentables[i].cat || 'base') === 'base') { base = r.fermentables[i]; break; }
    }
    if (!base) return r;

    for (var k = 0; k < 40; k++) {
      var c = BREW.Calc.calcRecipe(r);
      var diff = target - num(c.og, 1);
      if (!isFinite(diff) || Math.abs(diff) < 0.0008) break;
      var pts = num(c.og, 1) - 1;
      if (pts <= 0.004) break;                        /* 比例外推没有意义了 */
      var next = num(base.amount, 0) * (pts + diff) / pts;
      base.amount = roundTo(Math.max(0.2, next), 2);
    }
    return r;
  }

  /** 工单兜底的通用基线：原来的美式琥珀艾尔，仅在没有风格可选时使用 */
  function amberBaseline() {
    var r = UI.blankRecipe();
    r.name = '新手基线 · 美式琥珀艾尔';
    r.batchSize = 20;
    r.efficiency = 72;
    r.evaporationRate = 10;
    r.boilTime = 60;
    r.mashThickness = 3;
    r.carbonation.targetVol = 2.3;
    r.notes = '一套跑通流程用的基线配方：发酵干净、苦度适中，先建立糖化效率的实测基准。';
    r.styleId = '';

    var malts = UI.pool('malts');
    function findMalt(re, cat) {
      for (var i = 0; i < malts.length; i++) {
        if (re.test((malts[i].name || '') + ' ' + (malts[i].en || ''))) return malts[i];
      }
      if (cat) for (var j = 0; j < malts.length; j++) if (malts[j].cat === cat) return malts[j];
      return malts[0] || null;
    }
    var hopPool = UI.pool('hops');
    function findHop(re) {
      for (var i = 0; i < hopPool.length; i++) {
        if (re.test((hopPool[i].name || '') + ' ' + (hopPool[i].en || ''))) return hopPool[i];
      }
      return hopPool[0] || null;
    }
    var yeastPool = UI.pool('yeasts');
    function findYeast(re) {
      for (var i = 0; i < yeastPool.length; i++) {
        if (re.test((yeastPool[i].name || '') + ' ' + (yeastPool[i].en || '') + ' ' + (yeastPool[i].lab || ''))) {
          return yeastPool[i];
        }
      }
      return yeastPool[0] || null;
    }

    var Recipe = BREW.Recipe;
    function pushMalt(ing, kg) {
      if (!ing) return;
      if (Recipe && Recipe.addFermentable) Recipe.addFermentable(r, ing, kg);
      else r.fermentables.push({ id: ing.id, amount: kg });
    }
    function pushHop(ing, g, stage, min) {
      if (!ing) return;
      if (Recipe && Recipe.addHop) Recipe.addHop(r, ing, g, stage, min);
      else r.hops.push({ id: ing.id, amount: g, stage: stage, time: min });
    }
    function pushYeast(ing, grams) {
      if (!ing) return;
      if (Recipe && Recipe.addYeast) Recipe.addYeast(r, ing, grams);
      else r.yeasts.push({ id: ing.id, amount: grams, tempC: 19, att: 75 });
    }

    pushMalt(findMalt(/二棱|2-Row/i, 'base'), 4.2);
    pushMalt(findMalt(/慕尼黑.*浅|Munich Malt \(Light\)/i, 'base'), 0.8);
    pushMalt(findMalt(/结晶麦芽 40|Crystal 40/i, 'crystal'), 0.35);

    var cascade = findHop(/卡斯卡特|Cascade/i);
    pushHop(cascade, 20, 'boil', 60);
    pushHop(cascade, 15, 'boil', 15);
    pushHop(cascade, 25, 'whirlpool', 15);

    pushYeast(findYeast(/US-05|SafAle US-05|加州艾尔/i), 11);

    r.mash.steps = [
      { name: '糖化', tempC: 67, minutes: 60 },
      { name: '出糖', tempC: 76, minutes: 10 }
    ];
    r.water.source = { ca: 70, mg: 12, na: 30, cl: 55, so4: 110, hco3: 60 };

    /* 顺手选一个风格：这份配方本来就是 19A 美式琥珀艾尔的骨架 */
    var styles = UI.pool('styles');
    for (var s = 0; s < styles.length; s++) {
      if (/amber|琥珀/i.test((styles[s].name || '') + ' ' + (styles[s].en || ''))) {
        r.styleId = styles[s].id;
        break;
      }
    }
    return r;
  }

  /** 从经典配方库挑一条该风格的（优先 conf A，多选时取第一条） */
  function classicForStyle(styleId) {
    var list = (BREW.DB && BREW.DB.classicRecipes) || [];
    var hit = null;
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || !list[i].recipe || list[i].styleId !== styleId) continue;
      if (!hit) hit = list[i];
      if (list[i].conf === 'A') return list[i];   /* 有公开资料可对照的那条优先 */
    }
    return hit;
  }

  function loadStarter(styleId) {
    var style = styleId ? UI.byId('styles', styleId) : null;
    var r = null;
    var source = '';

    if (!styleId || !style) {
      /* 没选风格（或风格库没载入）：给通用基线，但**不留**用户没选过的风格码。
         toast 要把"为什么是通用基线"说准：没选风格 / 库里没有 / 编号查不到
         是三种不同的处境，写成同一句会让人以为风格库坏了。 */
      r = amberBaseline();
      var why;
      if (!styleId) why = '未指定风格，已载入通用基线';
      else if (!UI.pool('styles').length) why = '风格库未载入，已载入通用基线';
      else why = '风格数据缺失，已载入通用基线';
      finishStarter(r, null, why);
      return;
    }

    /* ---------- ① 经典配方库 ---------- */
    var classic = classicForStyle(style.id);
    if (classic) {
      try {
        r = JSON.parse(JSON.stringify(classic.recipe));
      } catch (e) { r = null; }
      if (r) {
        scaleTo20(r);
        r.id = freshRecipeId();
        r.parentId = null;
        r.rev = 1;
        r.createdAt = Date.now();
        r.updatedAt = Date.now();
        r.name = '入门 · ' + (style.name || style.id);
        r.styleId = style.id;
        r.notes = '基于经典配方「' + (classic.name || classic.id) + '」按 20 L 缩放，作为可酿基线。' +
          (r.notes ? ' ' + r.notes : '');
        finishStarter(r, style, '');
        return;
      }
    }

    /* ---------- ② 规则引擎：按风格区间合成 ---------- */
    if (BREW.Recipe && typeof BREW.Recipe.fromStyle === 'function') {
      r = BREW.Recipe.fromStyle(style.id, { batchSize: 20, efficiency: 72 });
    }
    if (r && r.fermentables && r.fermentables.length) {
      r.id = freshRecipeId();
      r.parentId = null;
      r.rev = 1;
      r.createdAt = Date.now();
      r.updatedAt = Date.now();
      r.name = '入门 · ' + (style.name || style.id);
      r.styleId = style.id;
      var ogLo = (style.og && style.og[0]) || 1;
      var ogHi = (style.og && style.og[1]) || ogLo;
      refineToOg(r, (ogLo + ogHi) / 2);
      r.notes = '风格库里没有这个风格的经典配方，按区间中值合成：OG ' + fmt(ogLo, 3) + '–' +
        fmt(ogHi, 3) + '，IBU ' + fmt(style.ibu && style.ibu[0], 0) + '–' +
        fmt(style.ibu && style.ibu[1], 0) + '，SRM ' + fmt(style.srm && style.srm[0], 0) + '–' +
        fmt(style.srm && style.srm[1], 0) + '（取自风格库，由规则引擎 30 号生成）。' +
        '目标 OG 已用计算内核试算校准到区间中值；酒花的苦/香分配与特种麦芽比例可直接改。';
      finishStarter(r, style, '');
      return;
    }

    /* ---------- ③ 什么都取不到 ---------- */
    r = amberBaseline();
    finishStarter(r, null, '风格数据缺失，已载入通用基线');
  }

  /**
   * 载入收尾：写模型 → 重渲染（重渲染会经 repaint 刷新 UI.lastCalc 与
   * 基本信息卡里的四格派生后果条）→ 说清楚载入的是什么。
   */
  function finishStarter(r, style, warn) {
    UI.setRecipe(r);
    render(host);
    var msg = '已载入 ' + (r.name || '基线配方') + (style ? '（' + style.id + '）' : '');
    if (typeof UI.Shell.toast === 'function') UI.Shell.toast(warn || msg, 'ok', 2800);
  }

  BREW.UI.RecipeView = {
    id: 'recipe',
    label: '配方设计',
    icon: 'recipe',
    group: '设计',
    order: 1,
    render: render,
    onEnter: function () { if (host) repaint(); }
  };

})(typeof window !== 'undefined' ? window : globalThis);
