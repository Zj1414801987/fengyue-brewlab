/* ============================================================================
 * 风月酿研所 — 58-ui-settings.js
 * ----------------------------------------------------------------------------
 * 职责：设置视图。表驱动：一张 SCHEMA 数组渲染出全部行，加两个只读组（数据 / 关于）。
 *
 * 存储口径（与 00-core 的 Store 点号下钻对齐）：
 *   settings 是**扁平**结构，key 里不带点。
 *     读 Store.get('settings.hoverDelay')   写 Store.set('settings.hoverDelay', v)
 *   v1.0 的 5 个老字段（theme / defaultBatchSize / defaultEfficiency / units /
 *   waterProfile）原地保留，本页只改它们的值，不迁移结构。
 *   SCHEMA 里的 group 只用于分组显示，不拼进存储路径。
 *
 * 所有改动即时生效并落盘，没有"保存"按钮。
 * 「恢复默认设置」只重置 settings，绝不动 recipes / batches / custom。
 *
 * 依赖：BREW.UI（esc/fmt/icon/modal/confirm/store/publish）、BREW.Store
 *       BREW.UI.Terms（可选）、BREW.UI.Tips（可选）、BREW.Calc（可选）
 * 对外：BREW.UI.SettingsView、BREW.UI.Settings.{get,set,getDefault,all,resetAll}
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  var Store = function () { return BREW.Store; };

  function rawGet(path) {
    try {
      if (BREW.Store && typeof BREW.Store.get === 'function') return BREW.Store.get(path);
    } catch (e) { /* 存储不可用时退回 UI.store */ }
    try { return UI.store.get(path); } catch (e2) { return undefined; }
  }

  function rawSet(path, val) {
    try {
      if (BREW.Store && typeof BREW.Store.set === 'function') { BREW.Store.set(path, val); return true; }
    } catch (e) { /* 落到 UI.store */ }
    try { UI.store.set(path, val); return true; } catch (e2) { return false; }
  }

  /* ======================================================================
   * A. SCHEMA —— 唯一事实来源
   * ----------------------------------------------------------------------
   * type: bool | number | select | multi | hidden
   * hidden 的项不渲染，但仍然参与"补默认值"与"恢复默认"。
   * ====================================================================*/

  var SCHEMA = [
    /* ---------------- 通用 ---------------- */
    {
      group: '通用', key: 'defaultBatchSize', type: 'number', d: 20,
      label: '默认批次量', unit: 'L', min: 5, max: 60, step: 0.5,
      desc: '新建配方时的初始批次量'
    },
    {
      group: '通用', key: 'defaultEfficiency', type: 'number', d: 72,
      label: '默认糖化效率', unit: '%', min: 40, max: 95, step: 1,
      desc: '新建配方时的初始效率。第一次用建议先按 70–72 算，实测两次后再调'
    },
    {
      group: '通用', key: 'restoreLastEdit', type: 'bool', d: true,
      label: '启动时恢复上次编辑',
      desc: '关闭后每次打开都是空配方（已保存的配方不会丢）'
    },

    /* ---------------- 界面 ---------------- */
    {
      group: '界面', key: 'annotateTerms', type: 'bool', d: true,
      label: '术语自动标注',
      desc: '正文里的专业术语加虚线下划线，悬停或点击可看释义'
    },
    {
      group: '界面', key: 'hoverGlossary', type: 'bool', d: true,
      label: '悬停显示术语速览',
      desc: '关闭后需要点击才能看到完整释义卡'
    },
    {
      group: '界面', key: 'hoverDelay', type: 'select', d: 400,
      label: '悬停延迟',
      desc: '浮层出现的等待时间。太短容易误触发，太长会以为没反应',
      opts: [
        { v: 200, t: '快 · 200 ms' },
        { v: 400, t: '标准 · 400 ms' },
        { v: 700, t: '慢 · 700 ms' }
      ]
    },
    {
      group: '界面', key: 'showUsageRange', type: 'bool', d: true,
      label: '显示建议用量区间',
      desc: '原料表里标出该原料的行业惯例用量范围'
    },
    /* --- v1.2 追加三项 ---
       都是"呈现方式"而不是"算法口径"，所以归在界面组。
       group 只有通用/界面/计算/知识/术语五个合法值，新增项**不新建分组**。 */
    {
      group: '界面', key: 'brewdaySound', type: 'bool', d: true,
      label: '酿造日到点提示音',
      desc: '酿造时间轴上每个节点到点时响一声（Web Audio 现场合成，不依赖音频文件）。酿造日视图随下一版上线，届时生效'
    },
    {
      group: '界面', key: 'lowStockWarn', type: 'bool', d: true,
      label: '原料低于补货阈值时提醒',
      desc: '原料库「库存」页与配方页行首的库存徽章会标出缺口；关掉后只在库存页显示'
    },
    {
      group: '界面', key: 'labelFormat', type: 'select', d: 'square',
      label: '酒标默认尺寸',
      desc: '导出酒标时用的版式：方形适合 6×6 cm 贴纸，4×6 竖版适合打在不干胶纸上。酒标设计器随下一版上线',
      opts: [
        { v: 'square', t: '方形（1:1）' },
        { v: 'a6', t: '4×6 竖版' },
        { v: 'round', t: '圆标' }
      ]
    },
    /* --- v1.4：界面密度 ---
       这一项调的是**本界面自己的密度**（字号 / 侧栏宽 / 顶栏高 / 功能区按钮），
       不是浏览器窗口大小 —— 网页没有改窗口的权限，写成"改分辨率"会让人
       点了发现窗口没动而以为坏了。desc 里必须把这句话说清楚。 */
    {
      group: '界面', key: 'resPreset', type: 'select', d: '1080',
      label: '分辨率预设',
      desc: '按你的屏幕大小选一档，调的是界面密度（字号、侧栏与顶栏尺寸、功能区按钮），' +
        '不会改变浏览器窗口。换档立即生效，不用刷新',
      opts: [
        { v: '1080', t: '1920×1080（默认）· 16.5px / 侧栏 232' },
        { v: '1440', t: '2560×1440（2K）· 17px / 侧栏 248' },
        { v: '720', t: '1280×720（720P）· 14px / 侧栏 200' }
      ]
    },
    {
      group: '界面', key: 'fontScale', type: 'select', d: 'std',
      label: '字号',
      desc: '标准 / 大。选"大"时整个主区与侧栏一起放大 8%（相当于系统缩放，不是只放大正文）',
      opts: [
        { v: 'std', t: '标准' },
        { v: 'lg', t: '大 · 放大 8%' }
      ]
    },
    /* 下面四项是"界面状态的记忆"，不在设置页里渲染（hidden）：
       它们是功能区与侧栏自己的开关，界面上已经有按钮了，
       设置页再放一遍就会出现"两个开关同一状态"的同步问题。
       但必须留在 SCHEMA 里：那样才会被补默认值、也才会被「恢复默认设置」归位。 */
    { group: '界面', key: 'ribbonCollapsed', type: 'hidden', d: false },
    { group: '界面', key: 'sidebarCollapsed', type: 'hidden', d: false },

    /* ---------------- 计算 ---------------- */
    {
      group: '计算', key: 'ibuModel', type: 'select', d: 'tinseth',
      label: '默认 IBU 模型',
      desc: '三种模型结果可差 20% 以上。顶栏与指标卡都取这里选的值',
      opts: [
        { v: 'tinseth', t: 'Tinseth（通用，默认）' },
        { v: 'rager', t: 'Rager（偏高，老配方常用）' },
        { v: 'garetz', t: 'Garetz（偏低，考虑麦汁浓度）' }
      ]
    },
    {
      group: '计算', key: 'styleTolerance', type: 'select', d: 'normal',
      label: '风格判定宽容度',
      desc: '偏差在缓冲区内的项算"可接受"，不再显示为出界',
      opts: [
        { v: 'strict', t: '严格 · 出界即提示' },
        { v: 'normal', t: '常规 · ±5% 缓冲' },
        { v: 'loose', t: '宽松 · ±10% 缓冲' }
      ]
    },
    {
      group: '计算', key: 'usageWarn', type: 'bool', d: true,
      label: '用量提醒',
      desc: '关闭后配方页不再检查原料用量是否偏离惯例'
    },
    {
      group: '计算', key: 'usageWarnMinLevel', type: 'select', d: 'info',
      label: '用量提醒门槛',
      desc: '决定多严重的偏离才值得打断你',
      opts: [
        { v: 'info', t: '全部提醒' },
        { v: 'warn', t: '只看"谨慎"' },
        { v: 'error', t: '只看"必须改"' }
      ]
    },

    /* ---------------- 知识 ---------------- */
    {
      group: '知识', key: 'tipsEnabled', type: 'bool', d: true,
      label: '显示知识卡',
      desc: '保存配方、切换视图时在左下角弹出一条实务 / 历史 / 冷知识'
    },
    {
      group: '知识', key: 'tipsFrequency', type: 'select', d: 'normal',
      label: '提示频率',
      desc: '低频 30 分钟一次（每次会话最多 2 条）／高频 4 分钟一次（最多 8 条）',
      opts: [
        { v: 'low', t: '低 · 30 分钟' },
        { v: 'normal', t: '正常 · 10 分钟' },
        { v: 'high', t: '高 · 4 分钟' }
      ]
    },
    {
      group: '知识', key: 'tipsCats', type: 'multi', d: ['practical', 'history', 'trivia'],
      label: '参与的知识类别',
      desc: '至少选一项，否则什么都不会弹',
      opts: [
        { v: 'practical', t: '酿造实务' },
        { v: 'history', t: '啤酒史' },
        { v: 'trivia', t: '冷知识' }
      ]
    },
    {
      group: '知识', key: 'tipsPreview', type: 'action', d: null,
      label: '试弹一条',
      desc: '不必等触发条件，立刻弹一张看看效果。点一次换一条，反复点会依次翻过整库；预览不计入"看过的"，不会把后面的自动提示消耗掉',
      btn: '现在弹一条'
    },
    { group: '知识', key: 'tipsSeen', type: 'hidden', d: {} },
    { group: '知识', key: 'tipsSnoozeUntil', type: 'hidden', d: 0 },
    { group: '知识', key: 'tipsOffCats', type: 'hidden', d: [] },
    { group: '知识', key: 'tipsLastShownAt', type: 'hidden', d: 0 },

    /* ---------------- 术语 ---------------- */
    {
      group: '术语', key: 'termShowFormula', type: 'bool', d: true,
      label: '术语卡显示公式',
      desc: '完整术语卡里展示计算公式（有公式的术语才显示）'
    },
    {
      group: '术语', key: 'termShowSource', type: 'bool', d: true,
      label: '术语卡显示出处',
      desc: '展示标准出处（ASBC / EBC / BJCP / 文献），写论文时有用'
    }
  ];

  /* 老 5 个扁平字段的默认值。恢复默认时一起归位，但不参与渲染 */
  var LEGACY_DEFAULTS = {
    theme: 'dark',
    defaultBatchSize: 20,
    defaultEfficiency: 72,
    units: 'metric',
    waterProfile: null
  };

  var GROUP_HINT = {
    '通用': '新建配方时的初始值。改的是"起点"，不影响已有配方。',
    '界面': '阅读体验相关。关掉标注不会影响计算，只是正文不再有下划线。',
    '计算': '三种模型/判定口径的选择。这里的改动立即反映到顶栏与指标卡。',
    '知识': '知识卡与术语卡的呈现方式。抽不到合适内容时不会硬弹。',
    '术语': '只影响完整术语卡里的内容块，不影响悬停速览。'
  };

  var GROUP_ICON = {
    '通用': 'tools',
    '界面': 'edit',
    '计算': 'scale',
    '知识': 'sparkle',
    '术语': 'record'
  };

  /* ======================================================================
   * B. 读写 API
   * ====================================================================*/

  function index() {
    var m = {};
    for (var i = 0; i < SCHEMA.length; i++) m[SCHEMA[i].key] = SCHEMA[i];
    return m;
  }

  var BY_KEY = index();

  function getDefault(key) {
    var s = BY_KEY[key];
    if (!s) return undefined;
    return (typeof s.d === 'object' && s.d !== null) ? JSON.parse(JSON.stringify(s.d)) : s.d;
  }

  function get(key) {
    var s = BY_KEY[key];
    var v = rawGet('settings.' + key);
    if (v === undefined || v === null) {
      if (s) return getDefault(key);
      /* 非 schema 里的老字段：直接给默认值 */
      return LEGACY_DEFAULTS[key];
    }
    return v;
  }

  /** 类型归一：输入框里永远是字符串，存进去必须是数字/布尔/数组 */
  function coerce(s, val) {
    if (!s) return val;
    if (s.type === 'bool') return !!val;
    if (s.type === 'number') {
      var n = parseFloat(val);
      if (!isFinite(n)) n = num(s.d, 0);
      if (isFinite(s.min) && n < s.min) n = s.min;
      if (isFinite(s.max) && n > s.max) n = s.max;
      return n;
    }
    if (s.type === 'multi') {
      if (!Array.isArray(val)) return getDefault(s.key);
      var out = [];
      for (var i = 0; i < val.length; i++) if (out.indexOf(val[i]) < 0) out.push(val[i]);
      return out;
    }
    return val;
  }

  function set(key, val) {
    var s = BY_KEY[key];
    var v = coerce(s, val);
    rawSet('settings.' + key, v);
    apply(key, v);
    return v;
  }

  /* ======================================================================
   * C. 副作用：把设置真正接到行为上
   * ====================================================================*/

  function republish() {
    try {
      if (typeof UI.publish === 'function') UI.publish({ persist: false });
    } catch (e) { /* 计算失败不影响设置保存 */ }
    try {
      if (BREW.Bus && typeof BREW.Bus.emit === 'function') {
        BREW.Bus.emit('settingsChanged', {});
      }
    } catch (e2) { /* 事件总线异常同上 */ }
  }

  function apply(key, val) {
    if (key === 'annotateTerms') {
      var T = UI.Terms;
      if (T && typeof T.setEnabled === 'function') T.setEnabled(!!val);
      return;
    }
    if (key === 'tipsEnabled') {
      var P = UI.Tips;
      if (P && typeof P.hide === 'function') P.hide();     /* 关掉时立刻收走当前卡 */
      return;
    }
    if (key === 'ibuModel' || key === 'styleTolerance' ||
        key === 'usageWarn' || key === 'usageWarnMinLevel') {
      republish();
      return;
    }
    /* v1.4 界面密度四项：都直接交给 40-ui-shell 的 setter。
       分辨率/字号/侧栏是"立刻生效"的（改 html 上的 data-* 属性，CSS 用属性
       选择器接管），所以这里不需要刷新页面；功能区折叠同理。
       为什么不在本文件里直接写 document.documentElement.setAttribute：
       同一个状态只能有一个写入点，否则设置页与功能区两处迟早分叉。 */
    if (key === 'resPreset' || key === 'fontScale' ||
        key === 'sidebarCollapsed' || key === 'ribbonCollapsed') {
      var S = UI.Shell;
      if (S && typeof S.applyUiSetting === 'function') S.applyUiSetting(key, val);
      return;
    }
    /* 其余项在下次使用时自然生效（悬停延迟、术语卡内容块等），不需要重算 */
  }

  /* ---------------- 计算钩子 ---------------- */
  /* 1) 用量提醒开关 → 透传给 Calc.calcRecipe 的 opts（它读 opts.usageWarn，不读 Store） */
  function hookCalcRecipe() {
    var C = BREW.Calc;
    if (!C || typeof C.calcRecipe !== 'function' || C.calcRecipe.__v11) return;
    var orig = C.calcRecipe;
    var wrapped = function (r, opts) {
      var o = {};
      if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
      if (o.usageWarn === undefined) o.usageWarn = get('usageWarn') !== false;

      var res = orig.call(C, r, o);

      /* 门槛过滤：usageWarnings 里的对象与 warnings 里的引用相同，按引用剔除 */
      try {
        var min = String(get('usageWarnMinLevel') || 'info');
        var rank = { info: 0, warn: 1, error: 2 };
        var floor = rank[min] || 0;
        if (floor > 0 && res && Array.isArray(res.usageWarnings) && Array.isArray(res.warnings)) {
          var usage = res.usageWarnings;
          res.warnings = res.warnings.filter(function (w) {
            if (usage.indexOf(w) < 0) return true;
            return (rank[w.level] || 0) >= floor;
          });
        }
      } catch (e) { /* 过滤失败就用原样结果 */ }
      return res;
    };
    wrapped.__v11 = true;
    C.calcRecipe = wrapped;
  }

  /* 2) IBU 模型 + 风格宽容度 → 包一层 UI.calc，所有取数方无需改动 */
  function hookUiCalc() {
    if (typeof UI.calc !== 'function' || UI.calc.__v11) return;
    var orig = UI.calc;
    var wrapped = function (recipe) {
      var c = orig.call(UI, recipe);
      try {
        var model = String(get('ibuModel') || 'tinseth');
        if (model === 'rager' && isFinite(num(c.ibuRager, NaN))) c.ibu = num(c.ibuRager, c.ibu);
        else if (model === 'garetz' && isFinite(num(c.ibuGaretz, NaN))) c.ibu = num(c.ibuGaretz, c.ibu);
        c.ibuModel = model;
        relaxStyleMatch(c);
      } catch (e) { /* 钩子失败不能影响计算本身 */ }
      return c;
    };
    wrapped.__v11 = true;
    UI.calc = wrapped;
  }

  /**
   * 风格判定缓冲：把"刚出界一点点"的项标成可接受。
   * 注意入参是 UI.calc 归一化之后的 styleMatch：deviations 里
   *   field 是标签（'OG'/'FG'/'ABV'/'IBU'/'SRM'）
   *   range 是 { lo, hi } 数字
   *   verdict 是 'ok' | 'low' | 'high'
   * 缓冲宽度取区间跨度的 ±5% / ±10%，但对比重类字段设绝对下限（2–4 个比重点）：
   * OG 的区间跨度只有 0.010，5% 只有 0.0005，对用户等于没有缓冲。
   */
  var TOL_FLOOR = {
    og:  { normal: 0.002, loose: 0.004 },
    fg:  { normal: 0.002, loose: 0.004 },
    abv: { normal: 0.2,   loose: 0.4 },
    ibu: { normal: 2,     loose: 4 },
    srm: { normal: 1,     loose: 2 }
  };

  function fieldKeyOf(label) {
    var s = String(label || '').toLowerCase();
    if (s.indexOf('og') === 0) return 'og';
    if (s.indexOf('fg') === 0) return 'fg';
    if (s.indexOf('abv') === 0) return 'abv';
    if (s.indexOf('ibu') === 0) return 'ibu';
    if (s.indexOf('srm') === 0) return 'srm';
    return s;
  }

  function relaxStyleMatch(c) {
    var sm = c && c.styleMatch;
    if (!sm || !Array.isArray(sm.deviations)) return;
    var mode = String(get('styleTolerance') || 'normal');
    var pct = mode === 'loose' ? 0.10 : mode === 'normal' ? 0.05 : 0;
    sm.tolerance = mode;
    if (!pct) return;

    var allOk = true;
    for (var i = 0; i < sm.deviations.length; i++) {
      var d = sm.deviations[i];
      var lo = num(d.range && d.range.lo, NaN);
      var hi = num(d.range && d.range.hi, NaN);
      if (!isFinite(lo) || !isFinite(hi)) { allOk = false; continue; }

      if (d.verdict === 'ok') continue;

      var actual = num(d.actual, lo);
      var span = Math.abs(hi - lo);
      var absDev = d.verdict === 'low' ? (lo - actual) : (actual - hi);

      var fm = TOL_FLOOR[fieldKeyOf(d.field)];
      var floor = fm ? fm[mode === 'loose' ? 'loose' : 'normal'] : 0;

      if (absDev <= Math.max(span * pct, floor)) {
        d.verdict = 'ok';
        d.tolerant = true;
      } else {
        allOk = false;
      }
    }
    /* 全部项都可接受 → 分数给满，否则保留引擎算的加权分 */
    if (allOk) sm.score = 100;
  }

  /* 3) 默认批次量 / 效率 → 新建配方的初值 */
  function hookBlankRecipe() {
    if (typeof UI.blankRecipe !== 'function' || UI.blankRecipe.__v11) return;
    var orig = UI.blankRecipe;
    var wrapped = function () {
      var r = orig.apply(UI, arguments);
      r.batchSize = num(get('defaultBatchSize'), 20);
      r.efficiency = num(get('defaultEfficiency'), 72);
      return r;
    };
    wrapped.__v11 = true;
    UI.blankRecipe = wrapped;
  }

  /* 4) 启动时恢复上次编辑 */
  function hookLoadWorking() {
    if (typeof UI.loadWorking !== 'function' || UI.loadWorking.__v11) return;
    var orig = UI.loadWorking;
    var wrapped = function () {
      if (get('restoreLastEdit') !== false) return orig.apply(UI, arguments);
      /* 不恢复工作副本：给一份空配方，已保存的配方一进「配方设计」就能载入 */
      var r = UI.blankRecipe();
      return UI.setRecipe(r);
    };
    wrapped.__v11 = true;
    UI.loadWorking = wrapped;
  }

  function installHooks() {
    hookCalcRecipe();
    hookUiCalc();
    hookBlankRecipe();
    hookLoadWorking();
  }

  /* ======================================================================
   * D. 渲染
   * ====================================================================*/

  function groups() {
    var order = [], map = {};
    for (var i = 0; i < SCHEMA.length; i++) {
      var s = SCHEMA[i];
      if (s.type === 'hidden') continue;
      if (!map[s.group]) { map[s.group] = []; order.push(s.group); }
      map[s.group].push(s);
    }
    return { order: order, map: map };
  }

  function control(s) {
    var v = get(s.key);

    /* 动作型：不是设置项，没有值可读写，只渲染一个按钮。
     * 走 data-act 而不是 data-set，避免被 readControl 当成可存字段。 */
    if (s.type === 'action') {
      return '<button type="button" class="btn btn-ghost btn-sm" data-act="' +
        attr(s.key) + '">' + icon('sparkle', 13) + esc(s.btn || s.label) + '</button>';
    }

    if (s.type === 'bool') {
      return '<label class="switch">' +
        '<input type="checkbox" data-set="' + attr(s.key) + '"' + (v ? ' checked' : '') + '>' +
        '<span class="switch__track" aria-hidden="true"><i></i></span>' +
        '<span class="u-sr">' + esc(s.label) + '</span>' +
        '</label>';
    }

    if (s.type === 'number') {
      return '<span class="set-num">' +
        '<input class="input input--num" type="number" data-set="' + attr(s.key) + '" ' +
        'value="' + attr(fmt(v, 1).replace(/\.0$/, '')) + '" ' +
        'min="' + attr(s.min) + '" max="' + attr(s.max) + '" step="' + attr(s.step || 1) + '">' +
        (s.unit ? '<span class="set-num__unit">' + esc(s.unit) + '</span>' : '') +
        '</span>';
    }

    if (s.type === 'select') {
      var opts = '';
      for (var i = 0; i < s.opts.length; i++) {
        var o = s.opts[i];
        opts += '<option value="' + attr(o.v) + '"' +
          (String(o.v) === String(v) ? ' selected' : '') + '>' + esc(o.t) + '</option>';
      }
      return '<select class="select select--sm" data-set="' + attr(s.key) + '">' + opts + '</select>';
    }

    if (s.type === 'multi') {
      var arr = Array.isArray(v) ? v : [];
      var html = '<div class="set-multi" data-multi="' + attr(s.key) + '">';
      for (var j = 0; j < s.opts.length; j++) {
        var op = s.opts[j];
        var on = arr.indexOf(op.v) >= 0;
        html += '<label class="chip' + (on ? ' is-on' : '') + '">' +
          '<input type="checkbox" data-set="' + attr(s.key) + '" data-multi-item="1" ' +
          'value="' + attr(op.v) + '"' + (on ? ' checked' : '') + '>' +
          '<span>' + esc(op.t) + '</span></label>';
      }
      return html + '</div>';
    }
    return '';
  }

  function row(s) {
    return '<div class="set-row">' +
      '<div class="set-row__label">' +
        '<span class="set-row__name">' + esc(s.label) + '</span>' +
        (s.desc ? '<span class="set-row__desc">' + esc(s.desc) + '</span>' : '') +
      '</div>' +
      '<div class="set-row__ctrl">' + control(s) + '</div>' +
      '</div>';
  }

  function groupCard(name, rows) {
    var body = '';
    for (var i = 0; i < rows.length; i++) body += row(rows[i]);
    return '<section class="card set-group">' +
      '<div class="card__head">' +
        '<span class="set-group__icon" aria-hidden="true">' + icon(GROUP_ICON[name] || 'info', 15) + '</span>' +
        '<h2>' + esc(name) + '</h2>' +
        '<span class="spacer"></span>' +
        '<span class="u-xs u-dim">' + rows.length + ' 项</span>' +
      '</div>' +
      '<div class="card__body card__body--flush">' + body + '</div>' +
      (GROUP_HINT[name] ? '<div class="card__hint">' + esc(GROUP_HINT[name]) + '</div>' : '') +
      '</section>';
  }

  /* ---------------- 数据组 ---------------- */

  /* 存储占用。只显示 "X KB" 没意义——用户不知道离满还有多远。
     实测容量从 Store.levels().capacity 取（不要手抄数字，那条规矩是宋砚秋立的：
     阈值和容量只能有一个来源）。拿不到就退回只报绝对值，不猜。 */
  function usageText() {
    var kb = null;
    try {
      if (BREW.Store && typeof BREW.Store.usageKB === 'function') kb = BREW.Store.usageKB();
    } catch (e) { kb = null; }
    if (kb === null) {
      try {
        var s = JSON.stringify(BREW.Store ? BREW.Store.all() : {});
        /* 与 Store.usageKB 同口径：字符数 × 2（UTF-16） */
        return fmt(s.length * 2 / 1024, 1) + ' KB（估算）';
      } catch (e2) { return '—'; }
    }
    var cap = 0;
    try {
      var lv = BREW.Store.levels ? BREW.Store.levels() : null;
      cap = (lv && lv.capacity) ? lv.capacity * 2 / 1024 : 0;
    } catch (e3) { cap = 0; }
    if (!cap) return fmt(kb, 1) + ' KB';
    var pct = kb / cap * 100;
    return fmt(kb, 1) + ' KB / ' + fmt(cap, 0) + ' KB（' +
      fmt(pct, pct < 1 ? 2 : 1) + '%）';
  }

  function countRecipes() {
    try { return UI.store.recipes().length; } catch (e) { return 0; }
  }

  function countBatches() {
    try { return UI.store.batches().length; } catch (e) { return 0; }
  }

  /* 数据一致性两行（v1.2 补）。
     这两个数一直在 meta 里被算出来，但**没有任何地方展示** —— 记了不显示
     等于半成品，也最容易被后人当成死字段删掉。
       · inventoryUnitMismatch：流水的单位与物料登记不一致的条数（归一化时重算，
         不是累计值）。不做换算是有意的：kg 与 g 混记时，替用户换算比不换更危险。
       · droppedRecords：导入时被丢弃的坏记录条数（累计）。
     都为 0 时不显示整块 —— 正常情况下这两行永远不该出现，出现就是有事。 */
  function consistencyRow() {
    var m = null;
    try { m = (BREW.Store && BREW.Store.get) ? BREW.Store.get('meta') : null; } catch (e) { m = null; }
    if (!m || typeof m !== 'object') return '';
    var unit = num0(m.inventoryUnitMismatch);
    var drop = num0(m.droppedRecords);
    if (!unit && !drop) return '';
    var bits = [];
    if (unit) bits.push(unit + ' 条流水的单位与物料登记不一致（未做换算，请核对）');
    if (drop) bits.push('累计丢弃 ' + drop + ' 条坏记录（导入时结构不合法的行）');
    return '<div class="set-row">' +
      '<div class="set-row__label"><span class="set-row__name">数据一致性</span>' +
        '<span class="set-row__desc">' + bits.map(esc).join('；') + '</span></div>' +
      '<div class="set-row__ctrl"><b class="u-mono" style="color:var(--warn,#d08a2a)">需核对</b></div>' +
      '</div>';
  }

  function num0(v) { var n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; }

  function dataCard() {
    var ro = isReadonly();
    return '<section class="card set-group">' +
      '<div class="card__head">' +
        '<span class="set-group__icon" aria-hidden="true">' + icon('save', 15) + '</span>' +
        '<h2>数据</h2>' +
        '<span class="spacer"></span>' +
        '<span class="u-xs u-dim">' + (ro ? '只读' : '本地 · 不上传') + '</span>' +
      '</div>' +
      '<div class="card__body card__body--flush">' +
        readonlyRow() +
        '<div class="set-row">' +
          '<div class="set-row__label"><span class="set-row__name">存储占用（估算）</span>' +
            /* 口径修正（v1.2 实测）：原来写"上限约 5 MB，中文实际占用约为字符数的 2 倍"，
               会让人以为字符预算只有 2.5 M。实测（tools/test-quota.js）Chrome 的
               预算就是 5 242 867 个字符 —— 配额按 UTF-16 编码单元算，一个汉字和一个
               字母一样占 1 个单元，落盘时都占 2 字节。所以"字符数"才是那个 5 M 的量纲。 */
            '<span class="set-row__desc">浏览器 localStorage 实测上限约 524 万字符' +
              '（配额按 UTF-16 编码单元计，汉字与字母等价）</span></div>' +
          '<div class="set-row__ctrl"><b class="u-mono">' + esc(usageText()) + '</b></div>' +
        '</div>' +
        '<div class="set-row">' +
          '<div class="set-row__label"><span class="set-row__name">数据条数</span>' +
            '<span class="set-row__desc">已保存的配方与酿造批次</span></div>' +
          '<div class="set-row__ctrl"><span class="u-mono">配方 ' + countRecipes() +
            ' · 批次 ' + countBatches() + '</span></div>' +
        '</div>' +
        consistencyRow() +
        '<div class="card__head set-subhead"><h2>历史备份</h2>' +
          '<span class="spacer"></span>' +
          '<span class="u-xs u-dim">本地 · 可恢复</span>' +
        '</div>' +
        /* 动作放在最前面：用户来这一块通常是想"存一份"或"拿回来"，
           先给动作再给清单，比让他先读三行记录再找按钮顺手 */
        '<div class="card__body card__body--flush">' +
          '<div class="set-row">' +
            '<div class="set-row__label"><span class="set-row__name">现在备份一份</span>' +
              '<span class="set-row__desc">把当前数据原样存成一份可恢复的快照。' +
                '自动备份只在数据已经损坏时才生成（存下来的是坏掉的串），' +
                '所以想留一份"好的"，要在这里手动存</span></div>' +
            '<div class="set-row__ctrl">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-act="backupNow"' +
                (ro ? ' disabled title="只读状态：写盘被拒绝，已禁用"' : '') + '>' +
                icon('save', 13) + ' 现在备份一份</button>' +
            '</div>' +
          '</div>' +
          backupRowsHtml() +
        '</div>' +
        '<div class="set-row">' +
          '<div class="set-row__label"><span class="set-row__name">备份</span>' +
            '<span class="set-row__desc">导出一份 JSON 存到硬盘；导入按 id 合并，同 id 保留较新的</span></div>' +
          '<div class="set-row__ctrl">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="export">' + icon('down', 13) + ' 导出全部数据</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="import"' +
              (ro ? ' disabled title="只读状态：导入会写盘，已禁用"' : '') + '>' + icon('save', 13) + ' 导入</button>' +
          '</div>' +
        '</div>' +
        '<div class="set-row">' +
          '<div class="set-row__label"><span class="set-row__name">恢复默认设置</span>' +
            '<span class="set-row__desc">只重置上面的设置项，配方与批次不受影响</span></div>' +
          '<div class="set-row__ctrl">' +
            '<button type="button" class="btn btn-ghost btn-sm set-danger" data-act="reset"' +
              (ro ? ' disabled title="只读状态：写不进设置，已禁用"' : '') + '>恢复默认设置</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="card__hint">' +
        (ro
          ? '只读状态：本次会话不会写入任何数据。需要先升级软件，才能继续保存。'
          : '清空浏览器数据会把这里的一切抹掉，重要配方请定期导出。') +
      '</div>' +
      '</section>';
  }

  /* ---------------- 只读（降级保护）与历史备份（v1.4） ----------------
   * 这两块是同一个故事的两半：
   *   · 只读：本机版本比数据旧 → 拒绝加载，页面能开、能看、能导出，但一个字节都写不进去；
   *   · 历史备份：数据真坏过、或者恢复错了 → 从这里把某一份拿回来。
   * 之前备份是"只写不读"的（存了 broken.* 却没有任何入口），
   * 用户看到的是"数据没了"，其实备份就躺在他自己的浏览器里。
   * ------------------------------------------------------------------ */

  var PENDING_TOAST_KEY = 'brewlab.pendingToast';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 备份时间。旧版单槽备份没有时间戳（at=0），如实说明，不编一个假时间 */
  function fmtTime(at) {
    if (!at) return '旧版备份（无时间戳）';
    var d = new Date(at);
    if (!isFinite(d.getTime()) || !d.getTime()) return '旧版备份（无时间戳）';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function readonlyInfo() {
    try {
      return (BREW.Store && typeof BREW.Store.readonlyInfo === 'function')
        ? BREW.Store.readonlyInfo() : null;
    } catch (e) { return null; }
  }

  function isReadonly() { return !!readonlyInfo(); }

  /** 只读横幅（页面顶部那条）之外的**内容区**说明。
   *  横幅是全局的、跟着视口跑；这一行在设置页里，用户来查"我数据怎么了"时能读到细节。 */
  function readonlyRow() {
    var info = readonlyInfo();
    if (!info) return '';
    return '<div class="set-row">' +
      '<div class="set-row__label">' +
        '<span class="set-row__name" style="color:var(--warn,#d08a2a)">只读 · 拒绝了更新版本的数据</span>' +
        '<span class="set-row__desc">' +
          esc('这份数据来自更新的版本（v' + info.from + ' > 本机 v' + info.current + '）。' +
            '为了不丢字段，已拒绝加载，原数据没有被改动。请升级软件后再打开。') +
        '</span>' +
        '<span class="set-row__desc u-mono">' +
          esc('原数据 ' + info.chars + ' 字符 · 指纹 ' + info.hash) +
        '</span>' +
        '<span class="set-row__desc">' +
          esc('下面「数据条数」显示 0 是因为没有把数据读进内存——数据本身还在，' +
            '升级软件后原样打开') +
        '</span>' +
      '</div>' +
      '<div class="set-row__ctrl"><span class="badge badge--bad">只读</span></div>' +
      '</div>';
  }

  /** 两类备份的抬头。**必须分区显示**：
   *  证据（损坏现场）和药（手动/恢复前快照）混在一张表里，用户不知道该点哪个。 */
  var BACKUP_KINDS = {
    auto: {
      label: '自动备份（损坏时的现场）',
      hint: '数据坏掉那一刻的原始串。多数本身是坏串（不可恢复），但它是"当时到底怎么了"的唯一证据；' +
        '少数情况（迁移出错）它其实是好的，能直接恢复',
      badge: 'neutral'
    },
    snap: {
      label: '手动 / 恢复前快照',
      hint: '你最需要的那一类：数据还好着的时候点「现在备份一份」，以及每次「恢复」之前自动留的那一份。' +
        '保留最近 3 份、合计不超过 120 万字符',
      badge: 'amber'
    }
  };

  /** 快照分区的说明**必须说实话**：
   *  小库写"保留最近 3 份"没问题；大库受配额压制只能留 1 份时还这么写，
   *  用户会以为我们弄丢了他的备份。宁可写明"只留了 1 份 + 请导出到硬盘"。 */
  function snapHint() {
    var info = null;
    try {
      info = (BREW.Store && typeof BREW.Store.snapInfo === 'function') ? BREW.Store.snapInfo() : null;
    } catch (e) { info = null; }
    var base = BACKUP_KINDS.snap.hint;
    if (!info || !info.limited) return base;
    return '当前库较大（主键约 ' + Math.round(info.mainChars / 10000) + ' 万字符），' +
      '受配额限制只保留最近 ' + info.maxCount + ' 份快照。历史快照请导出到硬盘。';
  }

  /** 一条备份。valid=false 的也列出来（标红 + 说明原因 + 按钮禁用），
   *  能被看见的坏备份才有价值 —— 用户可能只想从里面抄一条配方名。 */
  function backupRowHtml(b) {
    var time = fmtTime(b.at);
    var bits = [b.chars + ' 字符',
      '配方 ' + b.recs + ' / 批次 ' + b.batches];
    if (b.schemaVersion) bits.push('schema v' + b.schemaVersion);
    if (!b.valid) bits.push('不可恢复：' + (b.reason || '结构不合法'));
    var badge = b.valid
      ? '<span class="badge badge--a">可恢复</span>'
      : '<span class="badge badge--bad">不可恢复</span>';
    var ro = isReadonly();
    var btn;
    if (!b.valid) {
      btn = '<button type="button" class="btn btn-ghost btn-sm" disabled ' +
        'title="' + attr('不能恢复：' + (b.reason || '结构不合法')) + '">恢复</button>';
    } else if (ro) {
      btn = '<button type="button" class="btn btn-ghost btn-sm" disabled ' +
        'title="' + attr('只读状态：恢复会覆盖原数据，已禁用') + '">恢复</button>';
    } else {
      btn = '<button type="button" class="btn btn-ghost btn-sm" data-act="restore" ' +
        'data-key="' + attr(b.key) + '">恢复</button>';
    }
    /* 只有"现场备份"可以删：它是证据，删掉只是少了追查材料；
       快照是药，不给手滑的机会（Store.deleteBackup 也会再拦一次）。 */
    var del = '';
    if (b.kind === 'auto' && !ro) {
      del = '<button type="button" class="btn btn-ghost btn-sm set-danger" ' +
        'data-act="delBackup" data-key="' + attr(b.key) + '" ' +
        'title="' + attr('删掉这份现场备份，腾出 ' + b.chars + ' 字符配额') + '">删除</button>';
    }
    return '<div class="set-row set-row--tight">' +
      '<div class="set-row__label">' +
        '<span class="set-row__name u-mono">' + esc(time) + '</span>' +
        '<span class="set-row__desc">' + esc(bits.join(' · ')) + '</span>' +
      '</div>' +
      '<div class="set-row__ctrl">' + badge + btn + del + '</div>' +
      '</div>';
  }

  /** 一个分区：抬头（名称 + 说明 + 份数）+ 该区自己的空态 + 条目 */
  function backupSectionHtml(kind, list) {
    var meta = BACKUP_KINDS[kind];
    var hint = (kind === 'snap') ? snapHint() : meta.hint;
    var head = '<div class="set-row set-row--tight">' +
      '<div class="set-row__label">' +
        '<span class="set-row__name">' + esc(meta.label) + '</span>' +
        '<span class="set-row__desc">' + esc(hint) + '</span>' +
      '</div>' +
      '<div class="set-row__ctrl">' +
        '<span class="badge badge--' + meta.badge + '">' + list.length + ' 份</span>' +
      '</div>' +
      '</div>';
    if (!list.length) {
      /* 空态不是错误，是好事：自动备份只在数据损坏时生成 */
      var empty = (kind === 'auto')
        ? '还没有历史备份。备份只在数据损坏时自动生成——这是好事。'
        : '还没有手动备份。数据还好着的时候点上面的「现在备份一份」，恢复才有药可用。';
      return head + '<div class="set-row set-row--tight">' +
        '<div class="set-row__label"><span class="set-row__desc">' + esc(empty) + '</span></div>' +
        '<div class="set-row__ctrl"></div>' +
        '</div>';
    }
    var html = '';
    for (var i = 0; i < list.length; i++) html += backupRowHtml(list[i]);
    return head + html;
  }

  function backupRowsHtml() {
    var list = [];
    try {
      list = (BREW.Store && typeof BREW.Store.listBackups === 'function')
        ? BREW.Store.listBackups() : [];
    } catch (e) { list = []; }

    var autos = [], snaps = [], i;
    for (i = 0; i < list.length; i++) {
      (list[i].kind === 'snap' ? snaps : autos).push(list[i]);
    }
    return backupSectionHtml('auto', autos) + backupSectionHtml('snap', snaps);
  }

  /** 恢复成功后、刷新页面之前，把提示存进 sessionStorage：
   *  location.reload() 会把当前内存里的 toast 一起清掉，
   *  不这么做用户会看到"页面闪了一下，什么都没说"。 */
  function stashPendingToast(msg) {
    try { root.sessionStorage.setItem(PENDING_TOAST_KEY, msg); } catch (e) { /* 隐私模式没有 sessionStorage */ }
  }

  function flushPendingToast() {
    var msg = null;
    try { msg = root.sessionStorage.getItem(PENDING_TOAST_KEY); } catch (e) { msg = null; }
    if (!msg) return;
    try { root.sessionStorage.removeItem(PENDING_TOAST_KEY); } catch (e2) {}
    toast(msg);
  }

  /* ---------------- 工具台组（v1.6） ---------------- */

  /* 把全部工具做成"一行一个按钮"的直达入口。
     三条约束：
       ① 清单只从 BREW.UI.Toolbox.list() 取 —— 50-ui-tools 是唯一真相，
          这里绝不再维护第二份（清单分家必然漂移）；
       ② 不用 SCHEMA：SCHEMA 是"可存进 Store 的设置项"，工具台不存任何值；
       ③ 不用 data-act：bind() 里那条 data-act 分支会把不认识的动作直接吞掉，
          工具台走 data-tool 这条独立通道，跟既有动作互不干扰。
     位置：整页最前面（见 render 里的说明）。它是"你去用的东西"，
     不是"你会改的东西"，但入口必须一进来就看见。 */
  function toolboxCard() {
    var T = (BREW.UI && BREW.UI.Toolbox) || null;
    var list = (T && typeof T.list === 'function') ? T.list() : [];
    if (!list.length) return '';

    var body = '';
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      body += '<div class="set-row" data-toolrow="' + attr(t.id) + '">' +
        '<div class="set-row__label">' +
          '<span class="set-row__name">' + esc(t.title) +
            (t.isNew
              ? ' <span style="font-size:10px;font-family:var(--num);letter-spacing:.6px;' +
                'padding:1px 5px;border-radius:99px;background:var(--amber-tint-2);' +
                'color:var(--amber-soft);vertical-align:2px">v1.6</span>'
              : '') +
          '</span>' +
          '<span class="set-row__desc">' + esc(t.ask) + '</span>' +
        '</div>' +
        '<div class="set-row__ctrl">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-tool="' + attr(t.id) + '" ' +
            'aria-label="打开' + esc(t.title) + '">打开</button>' +
        '</div>' +
      '</div>';
    }

    return '<section class="card set-group" data-toolbox="1">' +
      '<div class="card__head">' +
        '<span class="set-group__icon" aria-hidden="true">' + icon('tools', 15) + '</span>' +
        '<h2>工具台</h2>' +
        '<span class="spacer"></span>' +
        '<span class="u-xs u-dim">' + list.length + ' 个</span>' +
      '</div>' +
      '<div class="card__body card__body--flush">' + body + '</div>' +
      '<div class="card__hint">' +
        '每一行都写清"它回答什么问题"——不写清楚就不该占一个按钮。' +
        '带 v1.6 的是本轮新增（比色卡 / 碳化三联表 / 酒花替换 / 糖化温度→酒体）。' +
        '同一批工具在「工具集」视图里也有卡片版，两边是同一份清单。' +
      '</div>' +
      '</section>';
  }

  /* ---------------- 关于组 ---------------- */

  function dbCount(name) {
    var d = BREW.DB || {};
    return Array.isArray(d[name]) ? d[name].length : 0;
  }

  function aboutCard() {
    var ver = (BREW.Config && BREW.Config.VERSION) ? BREW.Config.VERSION : '—';
    var verLabel = (BREW.Config && BREW.Config.VERSION_LABEL) ? BREW.Config.VERSION_LABEL : ('v' + ver);
    var viewCount = (UI.Shell && typeof UI.Shell.views === 'function') ? UI.Shell.views().length : 7;
    var kbd = [
      ['Alt + 1 … ' + viewCount, '按顺序切换左侧视图'],
      ['Ctrl + F1', '收起 / 展开顶部功能区（再按一次回来）'],
      ['Esc', '关闭对话框 / 取消当前浮层'],
      ['Tab / Shift+Tab', '在对话框内循环切换焦点'],
      ['Enter / 空格', '在术语下划线上打开完整释义卡'],
      ['点击术语', '同样打开完整释义卡（触屏用）']
    ];
    var rows = '';
    for (var i = 0; i < kbd.length; i++) {
      rows += '<div class="set-row set-row--tight">' +
        '<div class="set-row__label"><kbd class="kbd">' + esc(kbd[i][0]) + '</kbd></div>' +
        '<div class="set-row__ctrl u-sm u-muted">' + esc(kbd[i][1]) + '</div>' +
        '</div>';
    }

    var dataRows = [
      ['原料', dbCount('malts') + ' 麦芽 · ' + dbCount('hops') + ' 酒花 · ' +
        dbCount('yeasts') + ' 酵母 · ' + dbCount('adjuncts') + ' 辅料'],
      ['水盐与风格', dbCount('waterSalts') + ' 盐类 · ' + dbCount('styles') + ' 个 BJCP 风格'],
      ['术语', dbCount('glossary') + ' 条（含误解与出处）'],
      ['知识卡', dbCount('tips') + ' 条'],
      ['经典配方', dbCount('classicRecipes') + ' 个']
    ];
    var dHtml = '';
    for (var j = 0; j < dataRows.length; j++) {
      dHtml += '<div class="set-row set-row--tight">' +
        '<div class="set-row__label"><span class="set-row__name">' + esc(dataRows[j][0]) + '</span></div>' +
        '<div class="set-row__ctrl u-sm u-muted u-mono">' + esc(dataRows[j][1]) + '</div>' +
        '</div>';
    }

    return '<section class="card set-group">' +
      '<div class="card__head">' +
        '<span class="set-group__icon" aria-hidden="true">' + icon('beer', 15) + '</span>' +
        '<h2>关于</h2>' +
        '<span class="spacer"></span>' +
        '<span class="badge badge--neutral">' + esc(verLabel) + '</span>' +
      '</div>' +
      '<div class="card__body card__body--flush">' +
        '<div class="set-row set-row--tight">' +
          '<div class="set-row__label"><span class="set-row__name">版本</span>' +
            '<span class="set-row__desc">风月酿研所 · ' + esc(verLabel) + ' 界面包</span></div>' +
          '<div class="set-row__ctrl u-sm u-muted u-mono">' + esc(ver) + '</div>' +
        '</div>' +
        dHtml +
      '</div>' +
      '<div class="card__head set-subhead"><h2>快捷键</h2></div>' +
      '<div class="card__body card__body--flush">' + rows + '</div>' +
      '<div class="card__hint">' +
        '所有计算在浏览器本地完成，不联网、不上传配方。数据只存在这台机器的 localStorage 里。' +
      '</div>' +
      '</section>';
  }

  /* ======================================================================
   * E. 数据操作
   * ====================================================================*/

  function toast(msg, kind) {
    if (UI.Shell && UI.Shell.toast) UI.Shell.toast(msg, kind || 'ok', 3200);
  }

  function exportAll() {
    var text;
    try {
      text = (BREW.Store && typeof BREW.Store.exportJSON === 'function')
        ? BREW.Store.exportJSON()
        : JSON.stringify(BREW.Store ? BREW.Store.all() : {}, null, 2);
    } catch (e) {
      toast('导出失败：' + ((e && e.message) || '未知错误'), 'error');
      return;
    }
    var name = 'fengyue-backup-' + (UI.Util ? UI.Util.today() : 'data') + '.json';

    /* 优先走 Blob 下载；file:// 下个别浏览器禁用下载，退回"复制文本"弹窗 */
    try {
      var Blob = root.Blob;
      if (!Blob || !root.URL || !root.URL.createObjectURL) throw new Error('no-blob');
      var url = root.URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      root.setTimeout(function () {
        try { root.URL.revokeObjectURL(url); } catch (e2) { /* ignore */ }
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 200);
      toast('已导出 ' + name + '（约 ' + fmt(text.length / 1024, 1) + ' KB）');
    } catch (e3) {
      UI.Shell.modal({
        title: '导出数据',
        sub: '当前浏览器不支持直接下载，请手动复制下面的内容',
        size: 'wide',
        body: '<p class="u-sm u-muted" style="margin-bottom:8px">用记事本存成 .json 文件即可，' +
          '以后在「设置 → 导入」里选回来。</p>' +
          '<textarea class="input" readonly rows="14" style="width:100%;font-family:var(--mono);font-size:12.5px">' +
          esc(text) + '</textarea>',
        actions: [{ label: '关闭', kind: 'ghost' }]
      });
    }
  }

  function importData() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) { removeInput(); return; }

      var reader = new root.FileReader();
      reader.onerror = function () {
        toast('读文件失败，请确认文件可读', 'error');
        removeInput();
      };
      reader.onload = function () {
        var text = String(reader.result || '');
        removeInput();
        UI.Shell.confirm({
          title: '导入数据',
          message: '将把「' + file.name + '」合并进现有数据。',
          detail: '同 id 的配方/批次保留更新时间较新的那份；现有数据不会被删除。',
          okLabel: '合并导入'
        }, function () {
          try {
            var r = BREW.Store.importJSON(text, 'merge');
            if (UI.invalidateDB) UI.invalidateDB();
            toast('导入完成：配方 ' + (r && r.recipes || 0) + ' 份、批次 ' + (r && r.batches || 0) + ' 个', 'ok');
            if (UI.Shell && UI.Shell.refresh) UI.Shell.refresh();
          } catch (e) {
            toast('导入失败：' + ((e && e.message) || '文件格式不对'), 'error');
          }
        });
      };
      reader.readAsText(file, 'utf-8');
    });

    document.body.appendChild(input);
    input.click();

    function removeInput() {
      if (input.parentNode) input.parentNode.removeChild(input);
    }
  }

  function resetDefaults() {
    UI.Shell.confirm({
      title: '恢复默认设置',
      message: '全部设置项（通用 / 界面 / 计算 / 知识 / 术语）都会回到出厂值。',
      detail: '已保存的配方、酿造批次、自定义原料一律不动。',
      okLabel: '恢复默认',
      danger: true
    }, function () {
      for (var i = 0; i < SCHEMA.length; i++) {
        if (SCHEMA[i].type === 'action') continue;   /* 动作项没有值，跳过 */
        set(SCHEMA[i].key, getDefault(SCHEMA[i].key));
      }
      for (var k in LEGACY_DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(LEGACY_DEFAULTS, k)) {
          var dv = LEGACY_DEFAULTS[k];
          rawSet('settings.' + k, (dv && typeof dv === 'object') ? JSON.parse(JSON.stringify(dv)) : dv);
        }
      }
      if (UI.Terms && UI.Terms.setEnabled) UI.Terms.setEnabled(get('annotateTerms') !== false);
      republish();
      toast('设置已恢复默认');
      if (UI.Shell && UI.Shell.refresh) UI.Shell.refresh();
    });
  }

  /** 手动存一份可恢复的备份 */
  function doBackupNow() {
    if (isReadonly()) {
      toast('只读状态：写盘被拒绝，这次没有生成备份', 'warn', 4800);
      return;
    }
    var r = null;
    try {
      r = BREW.Store.backupNow('手动备份');
    } catch (e) {
      toast('备份失败：' + ((e && e.message) || '未知错误'), 'error', 4800);
      return;
    }
    if (!r || !r.ok) {
      toast('备份失败：' + ((r && r.reason) || '未知原因'), 'error', 5200);
      return;
    }
    toast('已备份一份（' + r.chars + ' 字符 · 配方 ' + r.recs + ' · 批次 ' + r.batches + '）', 'ok', 3600);
    if (UI.Shell && UI.Shell.refresh) UI.Shell.refresh();
  }

  /** 删除一份「现场备份」（自动备份）。
   *  两级确认，但只在**真的危险**时才给第二级：
   *    · 第一级（每次都问）：说清"删掉的是什么、代价是什么"；
   *    · 第二级（只在"这是最后一份现场 + 当前库里没数据"时问）：
   *      "删了就再没有证据了"。不搞层层确认——每次都要点两下，
   *      用户就会闭眼点"确定"，确认框等于没有。 */
  function deleteBackupFlow(key) {
    var list = [];
    try { list = BREW.Store.listBackups(); } catch (e) { list = []; }
    var b = null;
    for (var i = 0; i < list.length; i++) if (list[i].key === key) { b = list[i]; break; }
    if (!b) { toast('这份备份已经不在列表里了，请刷新页面重看', 'error'); return; }
    if (b.kind !== 'auto') {
      toast('快照不能删 —— 它是你唯一能把数据拿回来的那一份', 'warn', 5200);
      return;
    }
    if (isReadonly()) {
      toast('只读状态：写盘被拒绝，删不了。' +
        (BREW.Store.readonlyMessage ? BREW.Store.readonlyMessage() : ''), 'warn', 5200);
      return;
    }

    var when = fmtTime(b.at);
    UI.Shell.confirm({
      title: '删除这份现场备份？',
      message: '删掉后，这次损坏的现场就没了（它多半本来就是坏的，只用于追查）。确定删除？',
      detail: when + ' · ' + b.chars + ' 字符 · 配方 ' + b.recs + ' / 批次 ' + b.batches +
        '。删除只释放配额，不动你的配方、批次和快照。',
      okLabel: '删除这份',
      danger: true
    }, function () {
      /* 加重确认的判据：删完 auto 剩 0 份，而且当前库里压根没有可恢复的数据 */
      var autos = 0;
      for (var k = 0; k < list.length; k++) if (list[k].kind === 'auto') autos++;
      var empty = false;
      try {
        empty = BREW.Store.listRecipes().length === 0 && BREW.Store.listBatches().length === 0;
      } catch (e) { empty = false; }

      if (autos <= 1 && empty) {
        UI.Shell.confirm({
          title: '这是最后一份现场备份',
          message: '当前库里没有可恢复的数据，删掉这是最后一份现场。',
          detail: '删了就再也没有"当时到底怎么了"的线索了。建议先「导出全部数据」到硬盘。',
          okLabel: '仍然删除',
          danger: true
        }, function () { doDeleteBackup(key); });
        return;
      }
      doDeleteBackup(key);
    });
  }

  function doDeleteBackup(key) {
    var r = null;
    try {
      r = BREW.Store.deleteBackup(key);
    } catch (e) {
      toast('删除失败：' + ((e && e.message) || '未知错误'), 'error', 5200);
      return;
    }
    if (!r || !r.ok) {
      toast('删除失败：' + ((r && r.reason) || '未知原因'), 'error', 5600);
      return;
    }
    /* 删完立刻重算并把可用空间念出来 —— 用户要知道"配额腾出来了"，
       否则他不知道为什么下一次备份就成功了。 */
    var free = 0;
    try {
      var info = BREW.Store.snapInfo();
      free = info.freeChars;
    } catch (e2) { free = 0; }
    toast('已删除这份现场备份（释放 ' + r.chars + ' 字符），当前可用 ' + free + ' 字符', 'ok', 4200);
    if (UI.Shell && UI.Shell.refresh) UI.Shell.refresh();
  }

  /** 从某一份备份恢复。
   *  确认框必须把两件事说清：① 用哪份覆盖；② 当前数据会先被另存。
   *  不说②，用户会以为这是一次不可逆操作而不敢点；真点了又后悔。 */
  function restoreFrom(key) {
    var list = [];
    try { list = BREW.Store.listBackups(); } catch (e) { list = []; }
    var b = null;
    for (var i = 0; i < list.length; i++) if (list[i].key === key) { b = list[i]; break; }
    if (!b) { toast('这份备份已经不在列表里了，请刷新页面重看', 'error'); return; }

    if (isReadonly()) {
      toast('只读状态：恢复会覆盖原数据，已拒绝。请先升级软件', 'warn', 5200);
      return;
    }
    if (!b.valid) {
      toast('这份备份结构不合法，无法恢复：' + (b.reason || '未知原因'), 'error', 4800);
      return;
    }

    var when = fmtTime(b.at);
    UI.Shell.confirm({
      title: '从这份备份恢复？',
      message: '会用 ' + when + ' 的备份覆盖当前数据，当前数据会先被存成一份新备份。',
      detail: '这份备份：' + b.chars + ' 字符 · 配方 ' + b.recs + ' 个 · 批次 ' + b.batches +
        ' 个。恢复后页面会自动刷新；如果恢复错了，刚才那份"恢复前"的备份还在列表里。',
      okLabel: '恢复这份',
      danger: true
    }, function () {
      var r = null;
      try {
        r = BREW.Store.restoreBackup(key, { reload: false });
      } catch (e) {
        toast('恢复失败：' + ((e && e.message) || '未知错误'), 'error', 5200);
        return;
      }
      if (!r || !r.ok) {
        toast('恢复失败：' + ((r && r.reason) || '未知原因'), 'error', 5600);
        return;
      }
      /* 先落 prompt，再刷新：reload 会把内存里的 toast 一起冲掉 */
      stashPendingToast('已从 ' + when + ' 的备份恢复：配方 ' + r.recs + ' 个、批次 ' +
        r.batches + ' 个。恢复前的数据已另存为一份新备份' +
        (r.snapshotKey ? '（' + r.snapshotChars + ' 字符）' : ''));
      toast('已从 ' + when + ' 的备份恢复，当前数据已另存', 'ok', 2400);
      root.setTimeout(function () {
        try { root.location.reload(); } catch (e) {}
      }, 900);
    });
  }

  /** 设置页「试弹一条」。用户是显式点按钮，所以不看冷却、不看开关、不看已读——
   *  点了就必须有反应，否则用户会以为功能坏了。
   *  真正的抽取与去重逻辑在 57-ui-tips.js 的 Tips.showOne 里，
   *  这里只负责把"没弹出来"翻译成人话。 */
  function previewTip() {
    var T = UI.Tips;
    if (!T || typeof T.showOne !== 'function') {
      toast('知识卡模块还没载入，稍后再试');
      return;
    }
    if (!T.count || T.count() === 0) {
      toast('知识卡数据未载入，暂时没有可展示的内容');
      return;
    }
    if (!T.showOne()) toast('没有可展示的知识卡');
  }

  /* ======================================================================
   * F. 交互绑定
   * ====================================================================*/

  function readControl(el) {
    var key = el.getAttribute('data-set');
    if (!key) return;
    var s = BY_KEY[key];

    if (s && s.type === 'multi') {
      var wrap = el.parentNode;
      while (wrap && wrap !== document.body && !(wrap.getAttribute && wrap.getAttribute('data-multi'))) {
        wrap = wrap.parentNode;
      }
      var scope = wrap || document;
      var boxes = scope.querySelectorAll('[data-set="' + key + '"][data-multi-item]');
      var vals = [];
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) vals.push(boxes[i].value);
      set(key, vals);
      /* 高亮跟着勾选状态走，不整页重绘 */
      for (var j = 0; j < boxes.length; j++) {
        var lab = boxes[j].parentNode;
        if (lab && lab.classList) lab.classList.toggle('is-on', !!boxes[j].checked);
      }
      return;
    }

    if (s && s.type === 'bool') { set(key, !!el.checked); return; }
    if (s && s.type === 'number') {
      set(key, el.value);
      /* 离开输入框时把越界值回写成夹紧后的真实值，否则框里显示 999、存的是 60 */
      el.value = String(get(key));
      return;
    }
    set(key, el.value);
  }

  function bind(el) {
    if (el.__setBound) return;
    el.__setBound = true;

    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-set')) readControl(t);
    });

    /* 数字框：边打边生效，但只接受合法数字，避免把清空的一瞬间写成 0 */
    el.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var key = t.getAttribute('data-set');
      var s = key ? BY_KEY[key] : null;
      if (!s || s.type !== 'number') return;
      if (t.value === '' || !isFinite(parseFloat(t.value))) return;
      set(key, t.value);
    });

    el.addEventListener('click', function (e) {
      var btn = e.target;
      while (btn && btn !== el && btn.nodeType === 1) {
        var act = btn.getAttribute && btn.getAttribute('data-act');
        if (act) {
          /* 只读状态下 import / reset 的按钮已 disabled，但键盘/脚本仍可能触发，
             所以这里再挡一层（disabled 只是视觉与鼠标，不是权限） */
          if (isReadonly() && (act === 'import' || act === 'reset' || act === 'backupNow')) {
            toast('只读状态：这次没有写入任何数据。' + (BREW.Store.readonlyMessage ? BREW.Store.readonlyMessage() : ''), 'warn', 5200);
            return;
          }
          if (act === 'export') exportAll();
          else if (act === 'import') importData();
          else if (act === 'reset') resetDefaults();
          else if (act === 'tipsPreview') previewTip();
          else if (act === 'backupNow') doBackupNow();
          else if (act === 'delBackup') deleteBackupFlow(btn.getAttribute('data-key'));
          else if (act === 'restore') restoreFrom(btn.getAttribute('data-key'));
          return;
        }
        btn = btn.parentNode;
      }
    });

    /* v1.6 工具台：行内「打开」按钮 → 直接调出对应工具。
       走 data-tool 而不是 data-act：上面那条 data-act 分支遇到不认识的动作
       会 return 掉（它只服务数据组的六个动作），塞进去只会让两边都难读。 */
    el.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-tool]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-tool');
      if (!id) return;
      try {
        if (BREW.UI.Toolbox) BREW.UI.Toolbox.open(id);
      } catch (err) {
        toast('工具打不开：' + ((err && err.message) || '未知错误'), 'warn', 4000);
      }
    });
  }

  /* ======================================================================
   * G. 视图
   * ====================================================================*/

  function render(el) {
    var g = groups();
    /* 工具台放在最前面（v1.6）。理由：
       设置项的改法是一次性的（单位、模型），工具是天天要用的；
       把入口埋在五个分组后面，用户会以为"设置里没有这个东西"。
       代价是改配置时要先划过工具台——这个代价比"找不到工具"小。 */
    var html = toolboxCard();

    for (var i = 0; i < g.order.length; i++) {
      var name = g.order[i];
      html += groupCard(name, g.map[name]);
    }
    html += dataCard() + aboutCard();

    el.innerHTML =
      '<div class="section-title">' +
        '<h2>设置</h2>' +
        '<p>改动即时生效并保存在本机，没有"保存"按钮</p>' +
      '</div>' +
      '<div class="settings-wrap">' + html + '</div>';

    bind(el);
    /* 恢复备份后页面会 reload，提示靠 sessionStorage 接力到这里再弹 */
    flushPendingToast();
  }

  installHooks();

  /* ======================================================================
   * 只读状态下的"假成功"过滤器（v1.4）
   * ----------------------------------------------------------------------
   * 问题：Store 的写入口在只读状态返回 false（正确），但**上游不查返回值**。
   *   42-ui-recipe 保存后无条件 `UI.Shell.toast('已保存《x》')`，
   *   46/45 的批次同理。于是用户会同时看到两句互相矛盾的话：
   *   "只读模式：没有保存" 和 "已保存《酒花炸弹》"。
   *   后者是谎话，而且是最坏的那种谎话——它让用户关掉页面走人。
   *
   * 做法：在只读状态下拦掉"以 已保存/已记录/已更新/已导入/已复制/已另存 开头"
   *   的成功提示，别的文案一律透传。为什么改 toast 而不是改 42：
   *   42/46/45 不归本次改动管（见交付报告），而 toast 是**唯一**的出口，
   *   在这里拦一次等于把所有视图的谎话一次拦掉。
   *   真正的解释由 Store 的 refuseWrite 给（每类操作只给一次），
   *   所以这里只需要**吞掉**，不需要补一句。
   * -------------------------------------------------------------------- */
  var FALSE_SUCCESS = /^已(保存|记录|更新|导入|复制|另存|恢复|删除|清空)/;

  (function installReadonlyToastGuard() {
    var S = BREW.UI && BREW.UI.Shell;
    if (!S || typeof S.toast !== 'function' || S.__readonlyGuard) return;
    var orig = S.toast;
    S.toast = function (msg, kind, ms) {
      var ro = false;
      try { ro = !!(BREW.Store && BREW.Store.isReadonly && BREW.Store.isReadonly()); } catch (e) { ro = false; }
      if (ro && kind !== 'error' && FALSE_SUCCESS.test(String(msg == null ? '' : msg))) return;
      return orig.apply(S, arguments);
    };
    S.__readonlyGuard = true;
  })();

  /* 补默认值：只补 undefined，绝不覆盖用户已改过的值 */
  (function seedDefaults() {
    /* 只读状态下这些写入一定会被 Store 拒绝，跑它们只会白占一次提示机会 */
    if (isReadonly()) return;
    for (var i = 0; i < SCHEMA.length; i++) {
      var s = SCHEMA[i];
      if (s.type === 'action') continue;   /* 按钮不是可存字段，别往设置里塞 undefined */
      if (rawGet('settings.' + s.key) === undefined) {
        var d = getDefault(s.key);
        rawSet('settings.' + s.key, d);
      }
    }
  })();

  BREW.UI.Settings = {
    get: get,
    set: set,
    getDefault: getDefault,
    all: function () {
      var o = {};
      for (var i = 0; i < SCHEMA.length; i++) {
        if (SCHEMA[i].type === 'action') continue;
        o[SCHEMA[i].key] = get(SCHEMA[i].key);
      }
      return o;
    },
    resetAll: resetDefaults,
    schema: SCHEMA
  };

  BREW.UI.SettingsView = {
    id: 'settings',
    label: '设置',
    icon: 'gear',
    group: '系统',
    order: 8,
    render: render
  };

})(typeof window !== 'undefined' ? window : globalThis);
