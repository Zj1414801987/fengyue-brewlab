/* ============================================================================
 * 风月酿研所 — 51-ui-analysis.js
 * ----------------------------------------------------------------------------
 * 职责：
 *   1. 「分析」视图壳（Alt+0 —— 第 10 位，不是 Alt+9；Alt+9 是「品鉴」）：
 *      标题 + 页签条 + 内容区
 *   2. 页签注册表 BREW.UI.Analysis.addTab()，供 53 / 54 在**加载期**挂自己的页签
 *   3. 默认页签「年度统计」：吃 BREW.Stats.annual() 的出参画三张图 + 四个数字
 *   4. v1.4 新增页签「花费」：吃 BREW.Stats.annualCost()，回答"一年花了多少、
 *      每升多少钱、钱压在哪些批次上"。它和年度统计**共用年份下拉**（state.year），
 *      因为两个页签看的是同一段时间，切页签时年份跳回复选状态会很烦。
 *
 * 依赖：
 *   js/40-ui-shell.js    UI.esc/attr/num/fmt/icon/md/emptyState/store/reportError
 *   js/48-ui-charts.js   Charts.{donut,line,bar,autoRedraw}
 *   js/37-calc-stats.js  BREW.Stats.annual(batches, year) / annualCost(batches, year)
 *
 * 谁在调：
 *   js/60-app.js         注册本视图（defs 第 10 项 → Alt+0）
 *   js/53-ui-lineage.js / js/54-ui-ab.js 加载时调 UI.Analysis.addTab()
 *
 * 为什么是注册式而不是写死三个页签：
 *   53 / 54 是两份独立文件，任一缺失时另外两个页签仍必须能用。
 *   注册表让"缺席"表现为少一个页签，而不是白屏或 TypeError。
 *
 * 为什么页签状态不进 hash：
 *   40 的 route() 把 `#/analysis/lineage` 整串当视图 id 比对，匹配不到就回落
 *   到 views[0]。要让它认子路径，只能去碰 Shell._route / history.replaceState /
 *   加载期改 hash —— 三个都是拿私有或时序技巧补一个没设计好的地方。
 *   当前页签改记在 settings.analysisTab：刷新照样回到原页签，且一行代码都不用碰 40。
 *   代价：深链接（把某个页签发给别人）暂时做不到，v1.2 也没有分享视图的需求。
 *
 * 加载位置：js/50-ui-tools.js 之后（必须先于 53 / 54）
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  var TAB_KEY = 'settings.analysisTab';   /* 不在 58 的 SCHEMA 里 → 不参与"恢复默认"，可接受 */
  var DEFAULT_TAB = 'stats';

  /* 配色一律向 48 的令牌缓存要，这里不写第二份色值。
     （v1.5 在本文件里写死了 #9c5d0e / #8a5a2b / #2c6290 / #5b4a8c，
       CSS 换成 v1.6 配色后画布不跟，于是分析页还是黄的。）
     48 的 refreshColors() 是**就地改写** C 对象，所以这里每次现取也不会拿到过期引用。 */
  function col(key) {
    var c = BREW.Charts && BREW.Charts.COLORS;
    return c ? c[key] : '';
  }
  /* 系列色：0 琥珀 / 1 青 / 2 绿 / 3 红 / 4 蓝 / 5 紫 / 6 橄榄 / 7 中性灰。
     ⚠️ 只用于**有序**序列（折线、按时间的条形）：那里的位置有意义，
       第 4 条是"第 4 件东西"，用红不算错。 */
  function ser(i) {
    return (BREW.Charts && BREW.Charts.seriesColor) ? BREW.Charts.seriesColor(i) : '';
  }
  /* 分类占比（风格分布 / 花费构成）：走分类色表，跳过红，灰留给"其它"。
     两种取色语义必须分开——把分类扇区也按 seriesColor 排下去，
     第 4 个风格就会被涂成 --s4 红，读者会以为"这个风格有问题"。 */
  function cat(i) {
    return (BREW.Charts && BREW.Charts.categoricalColor) ? BREW.Charts.categoricalColor(i) : '';
  }

  var tabs = [];
  var seq = 0;
  var state = { tab: '', year: 0 };
  var resizeBound = false;

  /* ======================================================================
   * A. 页签注册表
   * ====================================================================*/

  var Analysis = UI.Analysis = UI.Analysis || {};
  Analysis.TAB_IDS = { stats: 'stats', cost: 'cost', lineage: 'lineage', ab: 'ab' };

  Analysis.tabs = function () {
    return tabs.map(function (t) { return { id: t.id, label: t.label, order: t.order }; });
  };

  Analysis.current = function () { return state.tab; };

  /**
   * 注册一个页签。返回 boolean，调用方不需要 try/catch。
   * 同 id 覆盖（便于热改），排序按 order，order 相同则按注册先后。
   */
  Analysis.addTab = function (def) {
    if (!def || !def.id || typeof def.render !== 'function') return false;
    var t = {
      id: String(def.id),
      label: def.label || String(def.id),
      order: num(def.order, 900),
      render: def.render,
      seq: ++seq
    };
    var hit = -1;
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === t.id) { hit = i; break; }
    if (hit > -1) { t.seq = tabs[hit].seq; tabs[hit] = t; } else { tabs.push(t); }
    tabs.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return a.seq - b.seq;
    });
    /* 视图已经挂在屏上时补画页签条；当前页签没变就不动内容区，避免打断用户 */
    if (document.getElementById('an-body')) {
      if (!findTab(state.tab)) state.tab = tabs.length ? tabs[0].id : '';
      paintTabs();
      paintBody();
    }
    return true;
  };

  Analysis.go = function (id) {
    var t = findTab(id) || tabs[0];
    if (!t) return;
    state.tab = t.id;
    saveTab(t.id);
    paintTabs();
    paintBody();
  };

  /** 外部（如 dataReady）要求重画当前页签 */
  Analysis.refresh = function () { if (document.getElementById('an-body')) paintBody(); };

  function findTab(id) {
    if (!id) return null;
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i];
    return null;
  }

  function saveTab(id) {
    try { UI.store.set(TAB_KEY, String(id)); } catch (e) { /* 配额满等异常时只是记不住页签 */ }
  }

  function readTab() {
    var v = '';
    try { v = UI.store.get(TAB_KEY, DEFAULT_TAB); } catch (e) { v = DEFAULT_TAB; }
    v = String(v || '');
    if (findTab(v)) return v;
    return tabs.length ? tabs[0].id : '';
  }

  /* ======================================================================
   * B. 视图壳
   * ====================================================================*/

  function tabsHtml() {
    var html = '';
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var on = (t.id === state.tab);
      html += '<button type="button" class="tab' + (on ? ' is-on' : '') + '" ' +
        'role="tab" aria-selected="' + (on ? 'true' : 'false') + '" ' +
        'data-an-tab="' + attr(t.id) + '">' + esc(t.label) + '</button>';
    }
    return html || '<span class="u-xs u-dim" style="padding:10px 14px">没有可用页签</span>';
  }

  function paintTabs() {
    var bar = document.getElementById('an-tabs');
    if (!bar) return;
    bar.innerHTML = tabsHtml();
  }

  function paintBody() {
    var box = document.getElementById('an-body');
    if (!box) return;
    var t = findTab(state.tab) || tabs[0];
    if (!t) {
      box.innerHTML = UI.emptyState('分析页签未载入',
        'js/53-ui-lineage.js 与 js/54-ui-ab.js 都没有注册页签，检查脚本是否按序加载。',
        { art: 'chart' });
      return;
    }
    state.tab = t.id;
    box.innerHTML = '';
    try {
      t.render(box);
    } catch (e) {
      /* 单个页签炸掉不能连累另外两个：这里兜住，页面上给一句人话 */
      UI.reportError(e, 'analysis.tab:' + t.id);
      box.innerHTML = UI.emptyState('这个页签没能画出来',
        '「' + t.label + '」渲染时报错：' + ((e && e.message) || '未知错误') + '。其余页签不受影响。',
        { art: 'chart', size: 52 });
    }
  }

  function render(el) {
    state.tab = readTab();
    el.innerHTML =
      '<div class="section-title">' +
        '<h2>分析</h2>' +
        '<p>年度看板 / 花费 / 配方谱系 / 多批次对比 —— 每个页签的脚注写明它的统计口径</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="tabs" id="an-tabs" role="tablist" aria-label="分析页签">' + tabsHtml() + '</div>' +
        '<div class="card__body" id="an-body"></div>' +
      '</div>';

    if (!el.__anBound) {
      el.__anBound = true;
      el.addEventListener('click', function (e) {
        var node = e.target, btn = null;
        while (node && node !== el && node.nodeType === 1) {
          if (node.getAttribute && node.getAttribute('data-an-tab') !== null) { btn = node; break; }
          node = node.parentNode;
        }
        if (!btn) return;
        Analysis.go(btn.getAttribute('data-an-tab'));
      });
      el.addEventListener('change', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute || t.getAttribute('data-an-role') !== 'year') return;
        state.year = num(t.value, 0);
        paintBody();   /* 只重画内容区，页签条与焦点都不动 */
      });
    }

    paintBody();
    bindResize();
  }

  /* 窗口变宽变窄要重画 canvas（48 的图表按 CSS 尺寸开画布，不会自适应）。
     autoRedraw 每次调用都新加一个 resize 监听，所以只绑一次。
     带图表的页签都要在这里登记，否则缩窗口后图会被拉扁。 */
  var CHART_TABS = { stats: 1, cost: 1 };
  function bindResize() {
    if (resizeBound) return;
    resizeBound = true;
    if (BREW.Charts && typeof BREW.Charts.autoRedraw === 'function') {
      BREW.Charts.autoRedraw(function () {
        if (CHART_TABS[state.tab] && document.getElementById('an-body')) paintBody();
      }, 200);
    }
  }

  /* ======================================================================
   * C. 年度统计页签
   * ====================================================================*/

  /* 与 37-calc-stats 的 dateOf 是同一条降级链，必须一致：
     两边算出的年份一旦不同，就会出现"算进了 2026 但月度图里没有"，
     那种报表比没有报表更糟。**改这里也要改 37**（它不导出 dateOf）。 */
  function dateParts(b) {
    var m = /^(\d{4})-(\d{2})/.exec(String((b && b.brewDate) || ''));
    if (m) return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };

    var hist = (b && Array.isArray(b.statusHistory)) ? b.statusHistory : [];
    var ts = (hist.length && hist[0]) ? hist[0].at : null;
    if (!ts && b && b.createdAt) ts = b.createdAt;
    if (!ts) return null;
    var d = new Date(ts);
    if (!isFinite(d.getTime())) return null;
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function yearsOf(list) {
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      var d = dateParts(list[i]);
      if (!d) continue;
      if (!seen[d.year]) { seen[d.year] = 1; out.push(d.year); }
    }
    out.sort(function (a, b) { return b - a; });   /* 新年份在前 */
    return out;
  }

  /**
   * 选年份。两个页签（年度统计 / 花费）共用同一个 state.year：
   *   · 用户选过、且这个年份确实有批次 → 用它（切页签不跳年份）
   *   · 否则用当年；当年没数据就退到有数据的最新一年
   *     —— 一进来就是空表，用户会以为功能坏了
   */
  function pickYear(years) {
    var nowYear = new Date().getFullYear();
    var y = (state.year && years.indexOf(state.year) >= 0) ? state.year
      : (years.indexOf(nowYear) >= 0 ? nowYear : years[0]);
    state.year = y;
    return y;
  }

  /** 年份下拉。id 每个页签一个（同屏只有一个页签，但 id 不能重复写死一份） */
  function yearSelectHtml(id, years, year) {
    var opt = '';
    for (var i = 0; i < years.length; i++) {
      opt += '<option value="' + attr(years[i]) + '"' +
        (years[i] === year ? ' selected' : '') + '>' + esc(years[i]) + ' 年</option>';
    }
    return '<label class="an-toolbar__label" for="' + attr(id) + '">年份</label>' +
      '<select class="select select--sm" id="' + attr(id) + '" data-an-role="year" ' +
      'aria-label="统计年份">' + opt + '</select>';
  }

  function effOf(b) {
    var ac = (b && b.actual) || {};
    var e = num(ac.efficiency, null);
    if (e !== null && e > 0) return e;
    var snap = (b && b.recipeSnapshot) || {};
    e = num(snap.efficiency, null);
    return (e !== null && e > 0) ? e : null;
  }

  /**
   * 月度平均效率。只放**有数据的月份**，不补 0——
   * 效率和产量不同，0% 会被读成"这个月酿废了"，实际只是没测。
   */
  function monthlyEfficiency(list, year) {
    var sum = [], cnt = [], i;
    for (i = 0; i < 12; i++) { sum.push(0); cnt.push(0); }
    for (i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b) continue;
      var d = dateParts(b);
      if (!d || d.year !== year || d.month < 1 || d.month > 12) continue;
      var e = effOf(b);
      if (e === null) continue;
      sum[d.month - 1] += e;
      cnt[d.month - 1]++;
    }
    var out = [];
    for (i = 0; i < 12; i++) {
      if (!cnt[i]) continue;
      out.push({ month: i + 1, value: Math.round(sum[i] / cnt[i] * 10) / 10, n: cnt[i] });
    }
    return out;
  }

  function statCard(k, v, sub) {
    return '<div class="an-stat">' +
      '<span class="an-stat__k">' + esc(k) + '</span>' +
      '<span class="an-stat__v">' + v + '</span>' +
      (sub ? '<span class="an-stat__sub">' + sub + '</span>' : '') +
      '</div>';
  }

  function styleName(id) {
    if (!id) return '未指定风格';
    var s = UI.byId('styles', id);
    return (s && s.name) ? s.name : id;
  }

  function topRatedHtml(r) {
    if (!r.topRated || !r.topRated.length) {
      /* 不要显示一张全 0 的表：那会被读成"三批都是 0 分" */
      return '<div class="table-empty">在批次里填品鉴分后出现</div>';
    }
    var body = '';
    for (var i = 0; i < r.topRated.length; i++) {
      var it = r.topRated[i];
      body += '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + esc(it.name || '未命名批次') + '</td>' +
        '<td class="u-dim">' + esc(styleName(it.styleId)) + '</td>' +
        '<td class="num an-score">' + esc(fmt(it.total, 1)) + '</td>' +
        '<td class="num u-dim">' + esc(it.date || '—') + '</td>' +
        '</tr>';
    }
    return '<table class="table table--compact"><thead><tr>' +
      '<th class="u-right" style="width:44px">#</th><th>批次</th><th>风格</th>' +
      '<th class="u-right" style="width:64px">评分</th>' +
      '<th class="u-right" style="width:104px">酿造日</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function notesHtml(list) {
    var html = '';
    for (var i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      html += '<li>' + esc(list[i]) + '</li>';
    }
    return html ? '<ul class="an-notes">' + html + '</ul>' : '';
  }

  function statsTab(box) {
    if (!BREW.Stats || typeof BREW.Stats.annual !== 'function') {
      box.innerHTML = UI.emptyState('统计模块未载入',
        'js/37-calc-stats.js 没有成功执行，年度统计无法计算。其余页签不受影响。',
        { art: 'chart' });
      return;
    }

    var batches = UI.store.batches();
    if (!batches.length) {
      box.innerHTML = UI.emptyState('还没有批次记录',
        '年度统计只吃批次数据。去「批次记录」建一锅并填上酿造日期，这里才有数字可看。',
        { art: 'beer' });
      return;
    }

    var years = yearsOf(batches);
    if (!years.length) {
      box.innerHTML = UI.emptyState('批次都没有日期',
        '统计要按酿造年份分组，但现有批次既没有 brewDate，也没有状态流转时间。' +
        '随便打开一锅补上酿造日期即可。', { art: 'chart' });
      return;
    }

    /* 默认当前年；当年没有批次时退到有数据的最新一年，
       否则一进来就是一张空表，用户会以为功能坏了 */
    var year = pickYear(years);

    var r;
    try {
      r = BREW.Stats.annual(batches, year);
    } catch (e) {
      UI.reportError(e, 'stats.annual');
      box.innerHTML = UI.emptyState('年度统计算不出来',
        'BREW.Stats.annual 抛错：' + ((e && e.message) || '未知错误'), { art: 'chart' });
      return;
    }

    var effTrend = monthlyEfficiency(batches, year);

    /* --- 工具栏（先单独拼出来：年份空态里也要留着它，否则用户没法换年份） --- */
    var barHtml = '<div class="an-toolbar">' +
      yearSelectHtml('an-year', years, year) +
      '<span class="spacer"></span>' +
      '<span class="u-xs u-dim">' + esc(year) + ' 年共 ' + fmt(r.count, 0) + ' 批' +
      (r.completedCount !== undefined ? '，其中已完成 ' + fmt(r.completedCount, 0) + ' 批' : '') +
      '</span>' +
      '</div>';

    /* 「这一年没有批次」和「还没有任何批次」是两件事：
       前者用户该去切年份，后者该去建批次。文案必须分开，否则用户会走错方向。 */
    if (!r.count) {
      box.innerHTML = barHtml + UI.emptyState(year + ' 年没有批次',
        '换个年份看看；如果这一年确实酿过酒，多半是那批的酿造日期还没填。',
        { art: 'chart', size: 56, small: true });
      return;
    }

    var html = barHtml;

    /* --- 四个关键数字 --- */
    html += '<div class="grid-4 an-stats">' +
      statCard('批次总数', esc(fmt(r.count, 0)) + '<i class="an-stat__unit">批</i>',
        '已完成 ' + esc(fmt(r.completedCount, 0)) + ' 批') +
      statCard('总产量', esc(fmt(r.volumeL, 1)) + '<i class="an-stat__unit">L</i>',
        r.estimatedVolume
          ? '含估算批次（缺包装量与实测产量，按设计批次量计）'
          : '按包装量 / 实测产量累加') +
      statCard('平均效率', (r.avgEfficiency === null ? '—' : esc(fmt(r.avgEfficiency, 1)) + '<i class="an-stat__unit">%</i>'),
        r.avgEfficiency === null ? '没有批次填了效率' : '只按填了效率的批次平均') +
      statCard('每升成本', (r.costPerL === null ? '—' : '¥' + esc(fmt(r.costPerL, 2))),
        r.costPerL === null
          ? '还没有批次填成本'
          : '合计 ¥' + esc(fmt(r.totalCost, 0)) + ' / 计费 ' + esc(fmt(r.costedVolumeL, 1)) + ' L') +
      '</div>';

    /* --- 三张图 --- */
    html += '<div class="an-charts">' +
      '<div class="an-panel">' +
        '<div class="an-panel__head"><h3>风格分布</h3>' +
          '<span class="u-xs u-dim">按批次数 · 同批可产多风格时归到它的快照风格</span></div>' +
        '<div class="an-panel__body"><canvas class="an-canvas" id="an-c-style" height="212"></canvas></div>' +
      '</div>' +
      '<div class="an-panel">' +
        '<div class="an-panel__head"><h3>效率趋势</h3>' +
          '<span class="u-xs u-dim">按月平均 · 只有测了效率的月份有点</span></div>' +
        '<div class="an-panel__body"><canvas class="an-canvas" id="an-c-eff" height="212"></canvas></div>' +
      '</div>' +
      '<div class="an-panel an-panel--wide">' +
        '<div class="an-panel__head"><h3>月度批次</h3>' +
          '<span class="u-xs u-dim">按月份 · 12 个月都在，条长＝批次数；没酿酒的月份是空条</span></div>' +
        '<div class="an-panel__body"><canvas class="an-canvas" id="an-c-month" height="318"></canvas></div>' +
      '</div>' +
      '</div>';

    /* --- 最好喝的三批 --- */
    html += '<div class="an-panel">' +
      '<div class="an-panel__head"><h3>最好喝的三批</h3>' +
        '<span class="u-xs u-dim">按品鉴总分（满分 50）</span></div>' +
      '<div class="an-panel__body an-panel__body--flush">' + topRatedHtml(r) + '</div>' +
      '</div>';

    html += notesHtml(r.warnings || []);

    /* --- 口径脚注：这功能唯一会吵架的地方 --- */
    /* 分母只算有成本的批次，所以"每升成本"会高于"总成本 ÷ 总产量"。
       不把两个数摆出来，用户一定自己除一遍然后说数字算错了。 */
    var costNote = (r.costPerL === null)
      ? '本年度没有任何批次填成本，每升成本不可用'
      : '本次计费 ' + fmt(r.costedVolumeL, 1) + ' L / 共 ' + fmt(r.volumeL, 1) + ' L';
    html += '<p class="an-foot">' +
      '<b>口径</b>：' +
      '年度按批次 <code>brewDate</code> 的年份归类，缺日期时依次退到状态流转首条时间、创建时间（仍无则不计入任何年份）；' +
      '产量优先取包装量 <code>packaging.volume</code>，其次实测 <code>actual.postBoilVolume</code>，' +
      '两者都没有时按配方快照的设计批次量计并标"估算"；' +
      '成本优先取 <code>cost.total</code>，其次是原料 + 其它两项之和，' +
      '<b>缺成本的批次不进每升成本的分母</b>（' + esc(costNote) + '），' +
      '所以每升成本会高于「总成本 ÷ 总产量」，别拿两个数相除去验算；' +
      '品鉴分取 <code>tasting.total</code>，没有总分但填了五段分时按 BJCP 定义求和；' +
      '月度效率平均与上方"平均效率"同源（<code>actual.efficiency</code> → 快照 <code>efficiency</code>）。' +
      '</p>';

    box.innerHTML = html;
    /* 画布尺寸的自愈在 48 里做（autoFit）：这里只管画一次，不要再补 rAF，
       否则两套机制并存，谁都不知道哪一次是必要的 */
    drawStatsCharts(box, batches, year, r, effTrend);
  }

  function drawStatsCharts(box, batches, year, r, effTrend) {
    var Ch = BREW.Charts;
    if (!Ch) return;

    /* 环形：风格分布 */
    var c1 = box.querySelector('#an-c-style');
    if (c1 && typeof Ch.donut === 'function') {
      var items = [];
      for (var i = 0; i < r.styleDist.length; i++) {
        /* color 显式给：48 的 donut 图例用的是同一个 items[].color，
           所以画布扇区与图例天然同源，不会出现"图例换个色、扇区没变"。 */
        items.push({
          label: r.styleDist[i].name || '未指定风格',
          value: r.styleDist[i].count,
          color: cat(i)
        });
      }
      try {
        Ch.donut(c1, items, {
          centerLabel: '批次',
          centerValue: String(r.count),
          emptyText: '这一年没有批次'
        });
      } catch (e) { UI.reportError(e, 'analysis.donut'); }
    }

    /* 折线：月度平均效率。X 是月份序号，必须 xIsTime:false，
       否则 48 会把 1、3、5 当时间戳格式化成 1/1、1/1、1/1 */
    var c2 = box.querySelector('#an-c-eff');
    if (c2 && typeof Ch.line === 'function') {
      var pts = [];
      for (var j = 0; j < effTrend.length; j++) {
        pts.push({ x: effTrend[j].month, y: effTrend[j].value });
      }
      try {
        Ch.line(c2, [{ name: '平均效率 %', points: pts, color: ser(0) }], {
          xIsTime: false,
          showPoints: true,
          fill: true,
          emptyText: '这一年没有测过效率'
        });
      } catch (e2) { UI.reportError(e2, 'analysis.line'); }
    }

    /* 条形：月度批次数。
       12 个月**全部传入**，没有的月份传 0 —— 缺月和"这个月没酿酒"是同一件事，
       跳过某个月会让 X 轴变形（1、3、4 月看起来像连续三个月）。
       sort:false 保住时间顺序（默认行为是按值降序，会把 3 月排到 1 月前面）。 */
    var c3 = box.querySelector('#an-c-month');
    if (c3 && typeof Ch.bar === 'function') {
      var bars = [];
      for (var k = 0; k < r.monthly.length; k++) {
        bars.push({
          label: r.monthly[k].month + ' 月',
          value: r.monthly[k].count,
          /* 有批次 = 青（数据/结构色），空月 = 发丝线浅灰。
             v1.5 空月用的是 #241f18（近黑），在轨道上留下 2px 深色短头，
             读起来像"这个月有 1 批"——和花费页签里"0 值给浅色"的注释自相矛盾。 */
          color: r.monthly[k].count ? ser(1) : col('axis')
        });
      }
      try {
        Ch.bar(c3, bars, {
          digits: 0, unit: ' 批', maxBars: 12, labelWidth: 64,
          sort: false, emptyText: '这一年没有批次'
        });
      } catch (e3) { UI.reportError(e3, 'analysis.bar'); }
    }
  }

  /* ======================================================================
   * C2. 花费页签（v1.4）
   * ----------------------------------------------------------------------
   * 三个问题，四个数字，两张图，一张表。多一个都不要。
   *
   * 这个页签最大的风险不是"算错"，是"读错"：
   *   每升均价的分母只含填了成本的批次，所以它一定 ≥「总花费 ÷ 总产量」。
   *   用户会自己除一遍，然后说数字错了。所以口径不是脚注里的一句话，
   *   而是**写在每个数字下面**——脚注只有人认真看的时候才有用。
   * ====================================================================*/

  function money(v) { return '¥' + fmt(v, 0); }
  function money2(v) { return '¥' + fmt(v, 2); }

  function topCostHtml(r) {
    if (!r.topCost || !r.topCost.length) {
      return '<div class="table-empty">这一年还没有填过成本的批次</div>';
    }
    var body = '';
    for (var i = 0; i < r.topCost.length; i++) {
      var it = r.topCost[i];
      body += '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + esc(it.name || '未命名批次') + '</td>' +
        '<td class="num an-score">' + esc(money(it.cost)) + '</td>' +
        '<td class="num u-dim">' + esc(fmt(it.volumeL, 1)) + ' L</td>' +
        '<td class="num">' + (it.perLiter === null ? '<span class="u-dim">—</span>' : esc(money2(it.perLiter))) + '</td>' +
        '</tr>';
    }
    return '<table class="table table--compact"><thead><tr>' +
      '<th class="u-right" style="width:34px">#</th><th>批次</th>' +
      '<th class="u-right" style="width:84px">花费</th>' +
      '<th class="u-right" style="width:72px">产量</th>' +
      '<th class="u-right" style="width:84px">每升</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  /**
   * 花费构成：原料 / 其它 / 未拆分。
   *
   * 原本这里画的是"累计花费折线"，实测不能用 48 的 line：
   *   它的 y 范围会**固定外扩 12%**（rangeOf 里的 padRatio），而金额序列从 0 起，
   *   于是最小刻度成了 -200 元、曲线在零点以下起笔。一张写着"负花费"的图，
   *   用户第一时间会当成 bug 来报。48 不归这次改动（有人在动图表与样式），
   *   与其凑合画一张需要解释的图，不如换成不需要 y 轴的环形图。
   *
   * 只拆到"原料 / 其它 / 未拆分"三层，**不拆到麦芽 / 酒花**：
   *   batch.cost 只有 ingredients / other 两个分项，库存流水没有金额字段。
   *   要看到"钱压在哪些麦芽上"，得先让批次成本按原料行记账 —— 那是数据模型的事。
   */
  function costMixItems(r) {
    /* 三块语义各不同，所以不能靠索引取色：
       原料 = 主数据（琥珀）／其它 = 真实存在但次要的一类（青）／
       未拆分 = **没归过类**的余额（中性灰，国际惯例"灰=未归类"）。
       用紫标"未拆分"会让人以为它是第三个成本科目，其实它是数据缺口。 */
    var items = [];
    if (r.cost.ingredients > 0) items.push({ label: '原料', value: r.cost.ingredients, color: cat(0) });
    if (r.cost.other > 0) items.push({ label: '其它（气电/清洗/瓶盖）', value: r.cost.other, color: cat(1) });
    /* 未拆分 = 没归过类的余额，不是第三个成本科目：从第 7 项起分类色表一律给中性灰 */
    if (r.cost.unallocated > 0.5) items.push({ label: '未拆分（只填了合计）', value: r.cost.unallocated, color: cat(6) });
    return items;
  }

  function costTab(box) {
    if (!BREW.Stats || typeof BREW.Stats.annualCost !== 'function') {
      box.innerHTML = UI.emptyState('花费统计未载入',
        'js/37-calc-stats.js 里的 Stats.annualCost 不存在，花费页签无法计算。' +
        '其余页签不受影响。', { art: 'chart' });
      return;
    }

    var batches = UI.store.batches();
    if (!batches.length) {
      box.innerHTML = UI.emptyState('还没有批次记录',
        '花费按批次上的「成本」卡汇总。去「批次记录」建一锅，填上成本与装瓶量，这里才有数字。',
        { art: 'beer' });
      return;
    }

    var years = yearsOf(batches);
    if (!years.length) {
      box.innerHTML = UI.emptyState('批次都没有日期',
        '花费要按酿造年份分组，但现有批次既没有 brewDate，也没有状态流转时间。' +
        '随便打开一锅补上酿造日期即可。', { art: 'chart' });
      return;
    }

    var year = pickYear(years);

    var r;
    try {
      r = BREW.Stats.annualCost(batches, year);
    } catch (e) {
      UI.reportError(e, 'cost.annualCost');
      box.innerHTML = UI.emptyState('年度花费算不出来',
        'BREW.Stats.annualCost 抛错：' + ((e && e.message) || '未知错误'), { art: 'chart' });
      return;
    }

    /* 工具栏先拼出来：两种空态里都要能换年份 */
    var barHtml = '<div class="an-toolbar">' +
      yearSelectHtml('an-cost-year', years, year) +
      '<span class="spacer"></span>' +
      '<span class="u-xs u-dim">' + esc(year) + ' 年共 ' + fmt(r.batches, 0) + ' 批，其中 ' +
      fmt(r.costedBatches, 0) + ' 批填了成本</span>' +
      '</div>';

    /* 「这一年没批次」和「有批次但没填成本」是两回事：
       前者去换年份，后者去批次详情填成本。文案分开写，否则用户会走错方向。 */
    if (!r.batches) {
      box.innerHTML = barHtml + UI.emptyState(year + ' 年没有批次',
        '换个年份看看；如果这一年确实酿过酒，多半是那批的酿造日期还没填。',
        { art: 'chart', size: 56, small: true });
      return;
    }
    if (!r.costedBatches) {
      box.innerHTML = barHtml + UI.emptyState('这一年还没有填过成本的批次',
        '这一年有 ' + r.batches + ' 个批次，但都没填成本。' +
        '到批次详情页的「成本」卡里填原料与其它成本，这里就会出数。',
        { art: 'chart', size: 56, small: true });
      return;
    }

    /* ---- 四个数字：每个都带口径，别只给人结果 ---- */
    /* 差额两个方向分开说：正数＝只填了合计（46 的写入口就是这样，正常）；
       负数＝合计比两项之和小（只可能来自导入或手改），这时叫"未拆分"是错的。 */
    var gap = r.cost.unallocated;
    var subCost = '原料 ' + money(r.cost.ingredients) + ' + 其它 ' + money(r.cost.other) +
      (gap > 0.5 ? ' + 未拆分 ' + money(gap)
        : (gap < -0.5 ? '（两项之和比合计多 ' + money(-gap) + '，去成本卡核对）' : '')) +
      ' · 只含填了成本的 ' + fmt(r.costedBatches, 0) + ' 批';
    var subVol = '按装瓶量计' + (r.estimatedVolume ? ' · 含估算批次（缺包装量与实测产量）' : '') +
      ' · 含没填成本的 ' + fmt(r.batches - r.costedBatches, 0) + ' 批';
    var subPerL = '分母只算填了成本的 ' + fmt(r.costedVolumeL, 1) + ' L（不是 ' +
      fmt(r.volumeL, 1) + ' L）';

    /* 有成本、但这些批次一个装瓶量都没有：perLiter 是 null，不是 0。
       显示 "¥0.00" 会被读成"酒是白送的"，比不显示更糟。 */
    var perLHtml = (r.perLiter === null) ? '—' : esc(money2(r.perLiter));
    var perLSub = (r.perLiter === null)
      ? '填了成本的批次都没有装瓶量，算不出每升多少钱'
      : subPerL;

    var html = barHtml;
    html += '<div class="grid-4 an-stats">' +
      statCard('今年总花费', esc(money(r.cost.total)), subCost) +
      statCard('总产量', esc(fmt(r.volumeL, 1)) + '<i class="an-stat__unit">L</i>', subVol) +
      statCard('每升均价', perLHtml, perLSub) +
      statCard('批次数', esc(fmt(r.batches, 0)) + '<i class="an-stat__unit">批</i>',
        '其中 ' + esc(fmt(r.costedBatches, 0)) + ' 批填了成本 · 每批均价 ' + esc(money2(r.perBatch))) +
      '</div>';

    /* ---- 两张图 + 最贵 5 批 ----
       48 的 bar 是水平条，没有"柱 + 折线"合一的画法；金额序列也不适合它的折线
       （原因见 costMixItems 上面的注释）。所以这里给的是"按月"＋"构成"两张图：
       前者回答"什么时候花的"，后者回答"花在什么上"。 */
    html += '<div class="an-charts">' +
      '<div class="an-panel an-panel--wide">' +
        '<div class="an-panel__head"><h3>按月花费</h3>' +
          '<span class="u-xs u-dim">单位：元 · 12 个月都在，空条＝那个月没花钱或没填成本</span></div>' +
        '<div class="an-panel__body"><canvas class="an-canvas" id="an-c-cost" height="318"></canvas></div>' +
      '</div>' +
      '<div class="an-panel">' +
        '<div class="an-panel__head"><h3>花费构成</h3>' +
          '<span class="u-xs u-dim">只有原料 / 其它两个分项 · 库存流水没有金额，拆不到麦芽酒花</span></div>' +
        '<div class="an-panel__body"><canvas class="an-canvas" id="an-c-mix" height="212"></canvas></div>' +
      '</div>' +
      '<div class="an-panel">' +
        '<div class="an-panel__head"><h3>最贵的 5 批</h3>' +
          '<span class="u-xs u-dim">按总花费排序 · 只有填了成本的批次上榜</span></div>' +
        '<div class="an-panel__body an-panel__body--flush">' + topCostHtml(r) + '</div>' +
      '</div>' +
      '</div>';

    html += notesHtml(r.warnings || []);

    /* ---- 口径脚注 ----
       "没填成本的批次不计入每升均价，否则会被拉低" 这句必须留在页面上：
       它解释了为什么用户自己拿计算器除出来的数比这里小。 */
    html += '<p class="an-foot">' +
      '<b>口径</b>：' +
      '<b>只统计填了成本的批次</b>；没填成本的批次不算钱、也不算产量分母，' +
      '否则每升均价会被白白拉低（本年度有 ' + fmt(r.batches - r.costedBatches, 0) +
      ' 个批次没填成本，未进入每升均价）。' +
      '每升均价 = 总花费 ÷ 填了成本的批次装瓶量（' + money(r.cost.total) + ' ÷ ' +
      fmt(r.costedVolumeL, 1) + ' L），' +
      '所以它一定 ≥「总花费 ÷ 总产量（' + fmt(r.volumeL, 1) + ' L）」，别拿两个数相除去验算；' +
      '每批均价 = 总花费 ÷ 填了成本的批次数（' + fmt(r.costedBatches, 0) + ' 批），不是除以全部批次。' +
      '花费优先取批次成本卡的合计，取不到时按原料 + 其它求和；' +
      '原料 / 其它两项按字段各自累加，只填了合计的批次差额单独算「未拆分」，不摊到原料头上' +
      '（合计反而小于两项之和时提示去核对，不硬拆）。' +
      '产量按装瓶量计，缺装瓶量时依次退到实测产量、设计批次量。' +
      '<b>这里没有"麦芽 / 酒花 / 酵母 / 辅料各花了多少"</b>：库存流水只记数量不记金额；' +
      '配方卡里那套成本估算是按类别拍的平均单价（麦芽 12–20 元/kg 等），是预算参考、' +
      '不是你这次的采购价，拿它拆分类花费等于编一个数。' +
      '</p>';

    box.innerHTML = html;
    drawCostCharts(box, r);
  }

  function drawCostCharts(box, r) {
    var Ch = BREW.Charts;
    if (!Ch) return;

    /* 条形：按月花费。12 个月全部传入（含 0）——跳过空月会让 X 轴变形；
       sort:false 保住时间顺序；0 值给浅色，避免出现一条像"有花费"的深色短条 */
    var c1 = box.querySelector('#an-c-cost');
    if (c1 && typeof Ch.bar === 'function') {
      var bars = [];
      for (var i = 0; i < r.byMonth.length; i++) {
        var m = r.byMonth[i];
        bars.push({
          label: m.month + ' 月',
          value: m.cost,
          color: m.cost > 0 ? ser(0) : col('axis')
        });
      }
      try {
        Ch.bar(c1, bars, {
          digits: 0, unit: '', maxBars: 12, labelWidth: 64,
          sort: false, emptyText: '这一年没有填过成本的批次'
        });
      } catch (e) { UI.reportError(e, 'analysis.costBar'); }
    }

    /* 环形：花费构成。centerValue 用总花费，和上面的数字卡对齐，
       否则用户会以为环里的合计是另一套口径。 */
    var c2 = box.querySelector('#an-c-mix');
    if (c2 && typeof Ch.donut === 'function') {
      try {
        Ch.donut(c2, costMixItems(r), {
          centerLabel: '合计',
          centerValue: money(r.cost.total),
          emptyText: '这一年没有填过成本的批次'
        });
      } catch (e2) { UI.reportError(e2, 'analysis.costMix'); }
    }
  }

  /* ======================================================================
   * D. 注册页签（53 / 54 自己注册谱系与 A-B）
   * ----------------------------------------------------------------------
   * 花费页签 order 15：紧挨年度统计（10），因为两者看的是同一年同一批数据；
   * 谱系 20 / A-B 30 是"跨批次"的视角，排在后面。
   * ====================================================================*/

  Analysis.addTab({ id: 'stats', label: '年度统计', order: 10, render: statsTab });
  Analysis.addTab({ id: 'cost', label: '花费', order: 15, render: costTab });

  UI.AnalysisView = {
    id: 'analysis',
    label: '分析',
    icon: 'chart',
    group: '分析',
    render: render,
    onEnter: function () {
      /* 从别的视图回来时批次可能被改过：重画一次当前页签（页签选择保持不变） */
      Analysis.refresh();
    }
  };

  /* 数据后到（dataReady）→ 重画，否则首屏那次拿到的是空批次 */
  if (BREW.Bus && typeof BREW.Bus.on === 'function') {
    BREW.Bus.on('dataReady', function () {
      if (document.getElementById('an-body')) paintBody();
    });
  }

})(typeof window !== 'undefined' ? window : globalThis);
