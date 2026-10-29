/* ============================================================================
 * 风月酿研所 — 60-app.js
 * ----------------------------------------------------------------------------
 * 职责：启动引导。
 *   1. 恢复上次编辑的工作副本（或从已保存配方、空白配方开始）
 *   2. 把各视图注册进 Shell，渲染导航与首屏
 *   3. 全局错误捕获：任何未处理异常都变成 Toast，绝不白屏
 *   4. 数据后到（dataReady）时刷新当前视图
 *
 * 依赖：BREW.UI（40~55 全部界面模块）；BREW.DB 可缺失
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;

  var started = false;

  /* ======================================================================
   * 全局错误兜底
   * ====================================================================*/

  var recentErrors = {};

  function softError(msg) {
    var key = String(msg).slice(0, 60);
    var now = Date.now();
    if (recentErrors[key] && now - recentErrors[key] < 4000) return;
    recentErrors[key] = now;
    if (UI.Shell && UI.Shell.toast) UI.Shell.toast(msg, 'error');
  }

  function installErrorHandlers() {
    root.addEventListener('error', function (e) {
      /* 资源加载失败（如某个 js 文件缺失）也走这里 */
      if (e && e.target && e.target.tagName) {
        var src = e.target.src || e.target.href || '';
        /* favicon 之类的浏览器自动请求失败不需要打扰用户 */
        if (/favicon/.test(src)) return;
        if (src) {
          softError('资源加载失败：' + src.split('/').pop() + '（功能可能不完整）');
          return;
        }
      }
      var msg = e && e.message ? e.message : '未知脚本错误';
      softError('脚本错误：' + msg);
    }, true);

    root.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      softError('异步错误：' + ((r && r.message) || String(r)));
    });

    /* 兜底：应用若在 3 秒内仍未就绪，给出可读提示而不是停在 loading */
    root.setTimeout(function () {
      if (started) return;
      var boot = document.getElementById('boot');
      if (!boot) return;
      var t = boot.querySelector('.boot__text');
      if (t) t.textContent = '初始化超时，请刷新页面重试';
      var s = boot.querySelector('.boot__sub');
      if (s) s.textContent = '若反复出现，请确认 js/ 与 css/ 目录完整';
    }, 3000);
  }

  /* ======================================================================
   * 启动
   * ====================================================================*/

  function init() {
    if (started) return;
    started = true;

    var app = document.getElementById('app');
    if (app) app.setAttribute('aria-busy', 'false');

    /* ---- 1. 恢复工作副本 ---- */
    try {
      UI.loadWorking();
    } catch (e) {
      UI.reportError(e, 'loadWorking');
      UI.setRecipe(UI.blankRecipe());
    }

    /* ---- 1b. 首次使用：载入一份可酿的示例配方 ----
       空配方首屏满屏都是 0，用户不知道这软件能干什么。
       直接给一份真实可酿的配方，看得见的原料表和算出来的指标，
       比任何引导文案都有效。注意：**只放进编辑器，不写进已保存配方**，
       用户点"保存"才算他自己的。 */
    try {
      var cur = UI.recipe();
      var curMaltRows = (cur && (cur.fermentables || cur.malts)) || [];
      var curHopRows = (cur && cur.hops) || [];
      var savedCount = UI.store.recipes().length;
      if (savedCount === 0 && curMaltRows.length === 0 && curHopRows.length === 0) {
        if (BREW.Recipe && typeof BREW.Recipe.presets === 'function') {
          var presets = BREW.Recipe.presets();
          if (presets && presets.length) {
            UI.setRecipe(presets[0]);
          }
        }
      }
    } catch (e0) {
      /* 示例配方载入失败不影响正常使用，静默跳过 */
      if (root.console && console.warn) console.warn('[BrewLab] 示例配方载入失败', e0);
    }

    /* ---- 2. 注册视图 ---- */
    var Shell = UI.Shell;
    if (!Shell || typeof Shell.registerView !== 'function') {
      var view = document.getElementById('view');
      if (view) {
        view.innerHTML = '<div class="card"><div class="card__body">' +
          UI.emptyState('界面模块未载入', 'js/40-ui-shell.js 没有成功执行，请检查文件是否完整。', { art: 'beer' }) +
          '</div></div>';
      }
      return;
    }

    /* 数组顺序 = order = Alt+1..9 的映射。
       v1.1 的两个新视图必须追加在末位：v1.0 的 5 个视图位置一动，
       用户练出来的快捷键肌肉记忆就全废了（Alt+3 从"批次记录"变成别的，
       是会让人当场骂人的那种改动）。分组靠 group 字段表达，与顺序无关。
       v1.6：左侧导航已删除，这份顺序同时决定功能区「视图」页签里
       10 个按钮的排列与角标（40 的 viewGroup() 从注册表现场生成）——
       所以"往中间插一个"现在还会把界面上按钮的角标全部挪位，代价比 v1.5 更大。 */
    var defs = [
      { v: BREW.UI.RecipeView, group: '设计' },
      { v: BREW.UI.IngredientView, group: '设计' },
      { v: BREW.UI.BatchView, group: '记录' },
      { v: BREW.UI.ToolsView, group: '工具' },
      { v: BREW.UI.ReportView, group: '交付' },
      { v: BREW.UI.ClassicView, group: '参考' },     /* Alt+6 */
      { v: BREW.UI.SettingsView, group: '系统' },    /* Alt+7 */
      /* v1.2：酿造日只能追加在末位（Alt+8）。理由同上——把 Alt+7 从"设置"
         挪走，等于把用户的肌肉记忆废掉。
         group 字段（v1.6 起）不再决定"导航分组标题"（导航没了），
         但仍被 Shell.views() 往外传、设置页与测试会读，保持语义即可。 */
      { v: BREW.UI.BrewdayView, group: '现场' },
      /* v1.2：品鉴（Alt+9）。与酿造日同属「现场」——都是开锅那天与开瓶那天的活。 */
      { v: BREW.UI.TastingView, group: '现场' },
      /* v1.2：分析（第 10 位 → Alt+0）。一年最多攒 20 批，看得少、但要看得深，
         所以放末位。快捷键盘位是 Alt+0 而不是 Alt+10：40-ui-shell 的
         parseInt 映射里 d===0 单独判为第 10 项，角标也显示 0。 */
      { v: BREW.UI.AnalysisView, group: '分析' }
    ];

    var registered = 0;
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      if (!d.v || typeof d.v.render !== 'function') continue;
      Shell.registerView({
        id: d.v.id,
        label: d.v.label,
        icon: d.v.icon,
        group: d.group,
        order: i + 1,
        render: d.v.render,
        onEnter: d.v.onEnter,
        onLeave: d.v.onLeave
      });
      registered++;
    }

    if (!registered) {
      softError('没有任何视图注册成功，界面无法渲染');
      return;
    }

    /* ---- 3. 渲染骨架 ---- */
    try {
      Shell.init();
    } catch (e2) {
      UI.reportError(e2, 'shell.init');
      return;
    }

    /* ---- 3b. 左面板（v1.6）：搜索 + 配方/工艺/实操三棵树 ----
       放在 Shell.init 之后：它要读 Shell.activeId / UI.recipe，
       而且第一棵树里的"当前配方结构"必须有配方才画得对（第 1/1b 步已就位）。
       坏了也不能拖垮整个应用 —— 左侧是辅助，正文是主体。 */
    try {
      if (UI.LeftPanel && typeof UI.LeftPanel.init === 'function') UI.LeftPanel.init();
    } catch (eLp) {
      UI.reportError(eLp, 'leftpanel.init');
    }

    /* 折叠态要在首屏说一次"它去哪了"。
       v1.5 的用户可能收起过左侧（那时它是一条 62px 的图标导航，收起来仍然能用）；
       v1.6 起同一个开关折的是整块面板 —— 面板会彻底消失。不说一声，
       用户会以为新版本把左侧功能删了。不强行展开：那是用户自己设的偏好。 */
    try {
      if (document.documentElement.getAttribute('data-nav') === 'rail') {
        root.setTimeout(function () {
          Shell.toast('左侧面板处于折叠状态：点顶栏最左的按钮，或按 Ctrl+B 展开', 'info', 6400);
        }, 1200);
      }
    } catch (eRail) { /* 提示失败不影响启动 */ }

    /* ---- 4. 首屏计算 ---- */
    try {
      UI.publish({ persist: false });
    } catch (e3) {
      UI.reportError(e3, 'publish');
    }

    /* ---- 5. 侧栏数据摘要 ---- */
    try {
      paintSidebarFoot();
    } catch (e4) { /* 装饰性内容，失败不影响使用 */ }

    /* ---- 6. 数据状态提示 ---- */
    checkData();

    /* 首次进入给一句引导，避免空白页无处下手 */
    var recipes = UI.store.recipes();
    if (!recipes.length) {
      root.setTimeout(function () {
        var r = UI.recipe();
        /* 麦芽数组在标准配方里叫 fermentables，旧字段/视图模型里可能叫 malts，
           两个都认，且必须防 undefined（曾因只读 malts 抛过 TypeError） */
        var maltRows = (r && (r.fermentables || r.malts)) || [];
        var hopRows = (r && r.hops) || [];
        var isEmpty = !maltRows.length && !hopRows.length;
        if (isEmpty) {
          Shell.toast('还没有配方：在「配方设计」里点"载入一套入门配方"可以立刻开始', 'info', 5200);
        }
      }, 900);
    }

    /* ---- 7. 数据后到时刷新 ---- */
    if (BREW.Bus && typeof BREW.Bus.on === 'function') {
      BREW.Bus.on('dataReady', function () {
        UI.invalidateDB();
        paintSidebarFoot();
      });
      /* v1.6：这条数据卡上写着"已存配方 N 份"。原来只在启动与 dataReady 时画，
         用户存完一份配方，数字还停在旧值上 —— 一块自称"本地数据"的卡片
         显示了过期数字，比不显示更糟。存/删各补一次。 */
      BREW.Bus.on('recipeSaved', function () { try { paintSidebarFoot(); } catch (e) { /* 装饰性内容 */ } });
      BREW.Bus.on('recipeDeleted', function () { try { paintSidebarFoot(); } catch (e) { /* 装饰性内容 */ } });
    }

    /* 收尾：确认真实数据已就绪，否则广播一次（让视图有机会重新取数） */
    if (BREW.DB && Array.isArray(BREW.DB.malts) && BREW.DB.malts.length &&
      BREW.Bus && typeof BREW.Bus.emit === 'function') {
      root.setTimeout(function () { BREW.Bus.emit('dataReady', { source: 'app' }); }, 0);
    }

    /* 初始化成功：仅此一条日志 */
    if (root.console && console.log) {
      var maltN = (BREW.DB && BREW.DB.malts) ? BREW.DB.malts.length : 0;
      console.log('[风月酿研所] 就绪 · 麦芽 ' + maltN + ' 条 · 视图 ' + registered +
        ' 个 · 计算内核 ' + (BREW.Calc && BREW.Calc.calcRecipe ? '外部' : '内置估算'));
    }
  }

  function paintSidebarFoot() {
    var db = BREW.DB || {};
    var maltN = Array.isArray(db.malts) ? db.malts.length : 0;
    var hopN = Array.isArray(db.hops) ? db.hops.length : 0;
    var yeastN = Array.isArray(db.yeasts) ? db.yeasts.length : 0;
    var styleN = Array.isArray(db.styles) ? db.styles.length : 0;
    var adjN = Array.isArray(db.adjuncts) ? db.adjuncts.length : 0;
    var saltN = Array.isArray(db.waterSalts) ? db.waterSalts.length : 0;
    var totalN = maltN + hopN + yeastN + adjN + saltN + styleN;
    var recipeN = UI.store.recipes().length;

    /* v1.6：这块从 4 行压到 2 行。
       左侧多了一整列"当前状态"（配方/工艺/实操三棵树），540px 高的视口里
       每一像素都要用在树上；而四行"麦芽51·酒花75·酵母46…"是**只读一次的
       环境信息**，看完一次就永远不需要再看。明细拆到 title 里，
       悬停能看全，平时只占两行。 */
    var html = '<div class="hint-box hint-box--slim" title="' +
      '麦芽 ' + maltN + ' · 酒花 ' + hopN + ' · 酵母 ' + yeastN + ' · 辅料 ' + adjN +
      ' · 水盐 ' + saltN + ' · 风格 ' + styleN + '（合计 ' + totalN + ' 条）">' +
      '<p>原料库 <b class="u-mono">' + totalN + '</b> 条 · 已存配方 <b class="u-mono">' + recipeN + '</b> 份</p>' +
      '</div>';
    UI.Shell.refreshSidebarFoot(html);
  }

  function checkData() {
    var db = BREW.DB || {};
    var missing = [];
    if (!Array.isArray(db.malts) || !db.malts.length) missing.push('麦芽');
    if (!Array.isArray(db.hops) || !db.hops.length) missing.push('酒花');
    if (!Array.isArray(db.yeasts) || !db.yeasts.length) missing.push('酵母');
    if (!Array.isArray(db.styles) || !db.styles.length) missing.push('风格');

    if (missing.length === 4) {
      UI.Shell.toast('原料库未载入：界面可正常操作，但下拉选项与计算结果会缺失', 'warn', 6000);
    } else if (missing.length) {
      UI.Shell.toast('部分数据未就绪（' + missing.join('、') + '），相关下拉会暂时为空', 'warn', 5000);
    }
  }

  /* ======================================================================
   * 对外接口
   * ====================================================================*/

  BREW.App = {
    init: init,
    isStarted: function () { return started; },
    /** 调试用：把当前状态打到控制台 */
    dump: function () {
      return {
        recipe: UI.recipe(),
        calc: UI.calc(UI.recipe()),
        recipes: UI.store.recipes(),
        batches: UI.store.batches()
      };
    }
  };

  /* 暴露给调试台 */
  root.BREW = BREW;

  installErrorHandlers();
  UI.ready(init);

})(typeof window !== 'undefined' ? window : globalThis);
