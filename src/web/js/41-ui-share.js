/* ============================================================================
 * 风月酿研所 — 41-ui-share.js
 * ----------------------------------------------------------------------------
 * 职责：**分享中心**（一个模态框，三块：选类型 / 生成 / 导入）。
 *
 * v1.7 之前这里只是"配方分享码"的一进一出。用户的原话是"把分享码提升为
 * 一级菜单"——所以它现在是一个**什么都能分享**的中心：配方、四类原料、
 * 原料库、批次、酿造日、酒标、分析快照、库存，共 11 种对象。
 * 编码与解析仍在 28-share-code.js（BREW.ShareCode），本文件一行编解码都不写；
 * 「导入以后写到哪」那种必须碰 Store 的事放在本文件（28 保持纯函数）。
 *
 * 为什么不做二维码：file:// 下没有网络也没有第三方库，手写 QR 编码器要
 * 1500 行且容易在纠错级别上出错；纯文本码可以走任何聊天工具，且十年后
 * 还能读。
 *
 * 导入的两步走（v1.7）：
 *   粘贴/输入 → **只识别 + 预览**（不写任何东西）→ 用户点「确认导入」才落库。
 *   为什么改成两步：剪贴板里可能还是上一次的东西，用户只是点开看看。
 *   一步到底的实现里，"打开对话框"和"覆盖我的数据"之间没有任何一道确认。
 *
 * 依赖：BREW.UI（esc/attr/num/fmt/icon/recipe/setRecipe/pool/store/uid）
 *       BREW.UI.Shell（modal/toast）、BREW.ShareCode（**可缺**：缺了只提示）
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  var Share = UI.Share = UI.Share || {};

  /* 最近一次导出到文件里的信封（v1.8）。
     为什么要留这一个引用：分享码超限时，界面要能"用同一份 parts 改走文件"。
     留着它，测试就能断言"导出的确实是刚才勾的那几块"，而不是重新收集一遍
     （重新收集会带上这期间新增的数据，两份内容就此不一致）。 */
  var lastExport = null;

  function toast(msg, kind, ms) {
    if (UI.Shell && UI.Shell.toast) UI.Shell.toast(msg, kind || 'info', ms || 2600);
  }
  function store() { return BREW.Store || null; }

  /* ======================================================================
   * A. 剪贴板
   * ----------------------------------------------------------------------
   * navigator.clipboard 在 file:// 下属于"不安全上下文"，Chrome 会直接拒绝，
   * 所以必须有 execCommand('copy') 的退路——否则双击打开的软件里"复制"是死的。
   * ====================================================================*/

  /** 老接口：临时 textarea + select + execCommand。返回是否成功 */
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    /* 不能用 display:none —— 隐藏元素选不中，execCommand 会返回 false */
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select();
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    return ok;
  }

  /** 复制文本；两条路都失败才报错。done(ok) 可能同步也可能异步调用 */
  function copyText(text, done) {
    var nav = root.navigator || {};
    if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      try {
        var p = nav.clipboard.writeText(text);
        if (p && typeof p.then === 'function') {
          p.then(function () { done(true); }, function () { done(legacyCopy(text)); });
          return;
        }
        done(true);
        return;
      } catch (e) {
        /* 落到老接口 */
      }
    }
    done(legacyCopy(text));
  }

  /** 从只读文本域里兜底取文本（部分浏览器 select() 后 execCommand 更稳） */
  function copyFromField(field, done) {
    if (!field) { done(false); return; }
    try {
      field.focus();
      field.select();
      if (legacyCopy(field.value)) { done(true); return; }
    } catch (e) { /* ignore */ }
    copyText(field.value, done);
  }

  /* ======================================================================
   * B. 错误翻译
   * ----------------------------------------------------------------------
   * 28 号模块抛出来的可能是底层异常（atob / JSON.parse / 越界），直接显示
   * "InvalidCharacterError: Failed to execute 'atob'" 对用户毫无意义，
   * 而且会让人以为软件坏了。这里按 code → 关键字两道匹配翻人话，
   * 全部匹配不上时才给一句"这不是分享码"的兜底。
   * ====================================================================*/

  /* 错误码 → 人话。28 号模块给了 err.code 枚举，**按 code 翻，不匹配中文串**——
     文案改一个字，匹配就失效，那是最典型的一类"看起来能跑"的隐性故障。
     message 只作为兜底：它本身已经是写给人看的中文，直接透出比丢掉更好。 */
  var ERR_TEXT = {
    'empty': '分享码是空的，先把对方发的那段粘进来。',
    'not-share-code': '这不是 BrewLab 分享码。分享码是一长串字母数字，开头带 BL1. 或 BL2. 前缀。',
    'bad-version': '这个分享码来自更新版本的 BrewLab，当前软件还不认识。请升级后再导入。',
    'too-large': '这段文本太长了，不像是分享码。确认复制的是分享码，而不是导出的 JSON 文件。',
    'crc': '码不完整，可能粘贴时被截断了（校验没通过）。请让对方重新完整复制一次。',
    'bad-payload': '码的中段解不开，多半是复制时漏了一段。请重新复制。',
    'bad-json': '码的内容损坏，解出来不是有效数据。请重新复制。',
    'bad-content': '这个码的内部格式当前版本读不了，可能是更早或更晚的版本生成的。',
    'bad-type': '这个码里的对象类型当前版本不认识，请升级后再试。',
    'formula-code': '这是公式分享码（BF1），请到公式编辑器里导入。',
    'kind-mismatch': '这串码是配方分享码（BL1），不是 v2 对象码。'
  };

  function humanError(e) {
    var code = String((e && (e.code || e.reason)) || '');
    if (ERR_TEXT[code]) return ERR_TEXT[code];

    var msg = String((e && e.message) || '');
    /* 兜底一：模块的 message 是中文人话，直接用（不是"显示异常对象"） */
    if (/[\u4e00-\u9fa5]/.test(msg)) return msg;
    /* 兜底二：老版本按英文关键字认，认不出就给一句能指导行动的 */
    var all = msg.toLowerCase();
    if (all.indexOf('version') > -1) return ERR_TEXT['bad-version'];
    if (all.indexOf('crc') > -1 || all.indexOf('checksum') > -1) return ERR_TEXT['crc'];
    if (all.indexOf('truncat') > -1 || all.indexOf('incomplete') > -1 ||
      all.indexOf('length') > -1 || all.indexOf('end of') > -1) return ERR_TEXT['crc'];
    if (all.indexOf('atob') > -1 || all.indexOf('base64') > -1) return ERR_TEXT['bad-payload'];
    if (all.indexOf('json') > -1) return ERR_TEXT['bad-json'];
    return ERR_TEXT['not-share-code'];
  }

  /* ======================================================================
   * C. 类型表与数据来源
   * ----------------------------------------------------------------------
   * 11 种类型里，有些是"当前上下文里就那一个"（配方 / 分析 / 库存），
   * 有些是"库里有很多条，得让用户挑一条"（单条原料 / 单个批次 / 单张酒标）。
   * 后者统一用同一颗下拉框（#share-pick），不按类型各造一套控件。
   * ====================================================================*/

  var KIND_OF = { malt: 'malts', hop: 'hops', yeast: 'yeasts', adjunct: 'adjuncts' };

  function types() {
    if (BREW.ShareCode && typeof BREW.ShareCode.types === 'function') return BREW.ShareCode.types();
    /* 28 没载入时的兜底：至少让弹窗能开、能说清楚缺什么 */
    return [{ t: 'recipe', label: '配方', icon: 'recipe', hint: '' }];
  }
  function typeMeta(t) {
    var list = types();
    for (var i = 0; i < list.length; i++) if (list[i].t === t) return list[i];
    return null;
  }
  function typeLabel(t) {
    /* 「自定义」不是 11 种对象之一（它是"几块装一个信封"），28 的 types() 里没有它 */
    if (t === 'bundle') return '分享包';
    var m = typeMeta(t);
    return m ? m.label : String(t || '未知');
  }

  function recipeName() {
    var r = UI.recipe() || {};
    return String(r.name || '未命名配方');
  }

  function ogText(r) {
    var t = (r && r.targets) || {};
    return t.og ? ' · OG ' + fmt(t.og, 3) : '';
  }

  /**
   * 取"要分享的那份数据"。
   * @returns {{ok:boolean, data:*, summary:string, picks:Array, pick:number, note:string, reason:string}}
   *   picks 非空时界面会显示下拉框；pick 是默认选中项的下标。
   */
  /* 打开分享中心时若有调用方递进来的配方（42 的「分享」按钮），生成区就用它。
     不写进工作副本，见 openModal 里的注释。 */
  var pendingRecipe = null;

  function currentRecipe() {
    return pendingRecipe || UI.recipe() || {};
  }

  function gather(type, pickId) {
    var r = currentRecipe();
    var i, list;

    if (type === 'recipe') {
      return {
        ok: true, data: r, picks: [],
        summary: '配方：' + recipeName() + ' · ' + fmt(num(r.batchSize, 0), 0) + ' L' + ogText(r)
      };
    }

    if (KIND_OF[type]) {
      var kind = KIND_OF[type];
      var pool = (UI.pool && UI.pool(kind)) || [];
      if (!pool.length) {
        return { ok: false, reason: '「' + typeLabel(type) + '」库里一条都没有，先在「原料库」里加一条' };
      }
      var picks = pool.map(function (x, idx) {
        return { id: String(x.id || ('#' + idx)), name: String(x.name || x.id || ('第 ' + (idx + 1) + ' 条')), raw: x };
      });
      var at = 0;
      for (i = 0; i < picks.length; i++) if (picks[i].id === pickId) { at = i; break; }
      var row = picks[at].raw;
      var extra = '';
      if (kind === 'malts') extra = ' · ' + fmt(num(row.ppg, 0), 0) + ' ppg / ' + fmt(num(row.lov, 0), 0) + ' °L';
      else if (kind === 'hops') extra = ' · α ' + fmt(num(row.aa, 1), 1) + '%';
      else if (kind === 'yeasts') extra = ' · 衰减 ' + fmt(UI.yeastAtt(row, 75), 1) + '%';   /* v2.0：老码可能只有 atten */
      else extra = ' · ' + fmt(num(row.useMin, 0), 0) + '–' + fmt(num(row.useMax, 0), 0) + (row.unit || 'g');
      return {
        ok: true, data: row, picks: picks, pick: at,
        summary: typeLabel(type) + '：' + picks[at].name + extra
      };
    }

    if (type === 'library') {
      var lib = libraryOf();
      var n = lib.malts.length + lib.hops.length + lib.yeasts.length + lib.adjuncts.length;
      if (!n) return { ok: false, reason: '还没有自建原料可分享：内置的几百条不属于你，自建的才算' };
      return {
        ok: true, data: lib, picks: [],
        summary: '原料库：' + n + ' 条自建原料（麦芽 ' + lib.malts.length + ' / 酒花 ' + lib.hops.length +
          ' / 酵母 ' + lib.yeasts.length + ' / 辅料 ' + lib.adjuncts.length + '）'
      };
    }

    if (type === 'batches') {
      list = (store() && store().listBatches()) || [];
      if (!list.length) return { ok: false, reason: '还没有批次可分享：先去「记录」建一锅' };
      return {
        ok: true, data: list, picks: [],
        summary: '批次列表：' + list.length + ' 锅 · 最近 ' +
          String((list[list.length - 1] || {}).brewDate || '—')
      };
    }

    if (type === 'brewday') {
      list = (store() && store().listBatches()) || [];
      if (!list.length) return { ok: false, reason: '还没有批次可分享：先去「记录」建一锅' };
      var bpicks = list.map(function (b) {
        return { id: String(b.id), name: (b.batchNo || '—') + ' ' + batchName(b), raw: b };
      });
      var bat = 0;
      for (i = 0; i < bpicks.length; i++) if (bpicks[i].id === pickId) { bat = i; break; }
      var bb = bpicks[bat].raw;
      var bd = bb.brewday || {};
      var stepN = (bd.steps && bd.steps.length) || 0;
      return {
        ok: true, data: bb, picks: bpicks, pick: bat,
        summary: '酿造日：' + bpicks[bat].name + ' · ' + (stepN ? stepN + ' 个步骤' : '还没开始酿造日看板') +
          ' · 读数 ' + ((bb.readings || []).length) + ' 条',
        note: stepN ? '' : '这一锅还没点「开始酿造」，分享出去的只有批次与实测值'
      };
    }

    if (type === 'label') {
      var all = (store() && store().get('labels', {})) || {};
      var key = labelKeyOf(r);
      var labels = Array.isArray(all[key]) ? all[key] : [];
      if (!labels.length) {
        return { ok: false, reason: '当前配方还没有酒标设计：去「交付 · 打开酒标设计器」做一张' };
      }
      var lpicks = labels.map(function (x, idx) {
        return { id: String(x.id || ('#' + idx)), name: String(x.name || ('酒标 ' + (idx + 1))), raw: x };
      });
      var lat = 0;
      for (i = 0; i < lpicks.length; i++) if (lpicks[i].id === pickId) { lat = i; break; }
      var lb = lpicks[lat].raw;
      return {
        ok: true, data: lb, picks: lpicks, pick: lat,
        summary: '酒标：' + lpicks[lat].name + ' · ' + (lb.format || 'square') +
          ' · 元素 ' + ((lb.elements || []).length) + ' 个',
        note: lb.bg && lb.bg.imageId ? '这张标用了背景图，图片本体不会随码传输（对方要自己重新选图）' : ''
      };
    }

    if (type === 'analysis') {
      list = (store() && store().listBatches()) || [];
      if (!list.length) return { ok: false, reason: '还没有批次，算不出年度统计' };
      if (!BREW.Stats) return { ok: false, reason: '统计模块未载入（js/37-calc-stats.js）' };
      var snap = analysisOf(list);
      if (!snap) return { ok: false, reason: '统计模块没算出东西：先去「分析」看一眼' };
      var A = snap.annual;
      return {
        ok: true, data: snap, picks: [],
        summary: '分析快照：' + (A.year || '—') + ' 年 · ' + (A.count || 0) + ' 锅 · 合计 ' +
          fmt(A.volumeL || 0, 1) + ' L',
        note: '只带数字，不带原始批次：对方看到的是你的年度统计，不是你的每一锅记录'
      };
    }
    if (type === 'inventory') {
      var inv = (store() && store().get('inventory', null)) || null;
      if (!inv || !(inv.items || []).length) return { ok: false, reason: '库存是空的：先去「原料库 · 库存」录两笔' };
      return {
        ok: true, data: inv, picks: [],
        summary: '库存：' + (inv.items || []).length + ' 种物料 / ' + (inv.moves || []).length + ' 笔流水'
      };
    }

    return { ok: false, reason: '未知的分享类型' };
  }

  function batchName(b) {
    return String((b && (b.name || (b.recipeSnapshot || {}).name)) || '未命名批次');
  }

  function labelKeyOf(recipe) {
    var S = store();
    if (S && typeof S.labelKeyOf === 'function') {
      try { return S.labelKeyOf(recipe || {}); } catch (e) { /* 落到兜底 */ }
    }
    return (recipe && recipe.id) || '__draft__';
  }

  /** 自建原料（内置的几百条不属于用户，分享整库时只带自建） */
  function libraryOf() {
    var out = { malts: [], hops: [], yeasts: [], adjuncts: [] };
    var kinds = ['malts', 'hops', 'yeasts', 'adjuncts'];
    for (var i = 0; i < kinds.length; i++) {
      var arr = (UI.customList && UI.customList(kinds[i])) || [];
      out[kinds[i]] = arr.filter(function (x) { return x && (x.custom !== false); });
    }
    return out;
  }

  /** 分析快照（年度 + 花费）。单类型分享与分享包共用一份，别写两遍。 */
  function analysisOf(list) {
    if (!list || !list.length) return null;
    if (!BREW.Stats) return null;
    try {
      return { annual: BREW.Stats.annual(list, 0), cost: BREW.Stats.annualCost(list, 0) };
    } catch (e) {
      return null;
    }
  }

  /** 当前配方最近的一张酒标（酒标是按配方 id 存的数组，追加式） */
  function latestLabelOf(recipe) {
    var all = (store() && store().get('labels', {})) || {};
    var arr = all[labelKeyOf(recipe)];
    return (Array.isArray(arr) && arr.length) ? arr[arr.length - 1] : null;
  }

  /* ======================================================================
   * C2. 分享包：可分享的本地设置白名单（v1.8）
   * ----------------------------------------------------------------------
   * 为什么是白名单而不是"把 settings 整个带走"：
   *   settings 里混着两类东西 —— **偏好**（单位、字号、IBU 模型，换台机器
   *   也应该一样）和 **本机状态**（分隔条宽度 `settings.resizer.*`、侧栏/功能区
   *   折叠、知识卡看到第几条、上次提示时间）。后者跟着码跑到对方机器上，
   *   表现是"导入一个分享包，自己的左栏宽度和功能区高度被改了"，用户完全
   *   想不到是被分享码改的。所以这里逐键列出，且**不包含**任何 resizer /
   *   collapsed / 临时态。
   * 加了新设置项要同步这张表（漏掉的表现是"设置没跟着分享过去"，
   * 不会报错，所以宁可写成显式数组让 review 看得见）。
   * ====================================================================*/
  var SHARE_SETTING_KEYS = [
    'units', 'defaultBatchSize', 'defaultEfficiency', 'restoreLastEdit',
    'annotateTerms', 'hoverGlossary', 'hoverDelay', 'showUsageRange',
    'brewdaySound', 'lowStockWarn', 'labelFormat', 'resPreset', 'fontScale',
    'ibuModel', 'styleTolerance', 'usageWarn', 'usageWarnMinLevel',
    'tipsEnabled', 'tipsFrequency', 'tipsCats',
    'termShowFormula', 'termShowSource'
  ];

  function settingsPart() {
    var out = {};
    var S = BREW.UI.Settings;
    for (var i = 0; i < SHARE_SETTING_KEYS.length; i++) {
      var k = SHARE_SETTING_KEYS[i];
      var v;
      if (S && typeof S.get === 'function') {
        try { v = S.get(k); } catch (e) { v = undefined; }
      } else {
        v = store() ? store().get('settings.' + k, undefined) : undefined;
      }
      if (v === undefined || v === null) continue;
      out[k] = v;
    }
    return out;
  }

  function applySettingsPart(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    var n = 0;
    var S = BREW.UI.Settings;
    for (var i = 0; i < SHARE_SETTING_KEYS.length; i++) {
      var k = SHARE_SETTING_KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      try {
        if (S && typeof S.set === 'function') S.set(k, obj[k]);
        else if (store()) store().set('settings.' + k, obj[k]);
        n++;
      } catch (e) { /* 单项写不进去不影响其它项 */ }
    }
    return n;
  }

  /* ======================================================================
   * C3. 分享包的 12 个块（v1.8）
   * ----------------------------------------------------------------------
   * 用户的原话："出来一个框，有个原料、辅料、记录、产出或者本地设置等等
   * 本软件涉及到的可勾选的框。然后用户任意选中几个之后，能够将这几块的
   * 信息分享出去。"
   *
   * 每块都写清楚数据从哪来（同目录的哪个文件），因为"这块到底带了什么"
   * 是用户最容易被吓到的地方 —— 勾一个"记录"就把全部批次发出去，
   * 而界面上只写"记录"两个字，那是欺骗。
   * ====================================================================*/
  function bundleBlocks() {
    var r = currentRecipe();
    var lib = libraryOf();
    var S = store();
    var batches = (S && S.listBatches()) || [];
    var saved = (S && S.listRecipes()) || [];
    var inv = (S && S.get('inventory', null)) || null;
    var ana = analysisOf(batches);
    var lb = latestLabelOf(r);
    var out = [
      { key: 'malts', group: '原料', label: '自建麦芽', unit: '条', count: lib.malts.length, data: lib.malts },
      { key: 'hops', group: '原料', label: '自建酒花', unit: '条', count: lib.hops.length, data: lib.hops },
      { key: 'yeasts', group: '原料', label: '自建酵母', unit: '条', count: lib.yeasts.length, data: lib.yeasts },
      { key: 'adjuncts', group: '原料', label: '自建辅料', unit: '条', count: lib.adjuncts.length, data: lib.adjuncts },
      {
        key: 'recipe', group: '配方', label: '当前配方', unit: '份', count: 1, data: r,
        name: recipeName()
      },
      {
        key: 'recipes', group: '配方', label: '已保存配方', unit: '份', count: saved.length, data: saved,
        name: saved.length ? ('共 ' + saved.length + ' 份，' + String((saved[0] || {}).name || '') + ' 起') : ''
      },
      {
        key: 'batches', group: '记录', label: '批次列表', unit: '锅', count: batches.length, data: batches,
        name: batches.length ? ('含实测、装瓶、品鉴、花费；配方只带名字与关键值') : ''
      },
      {
        key: 'brewday', group: '记录', label: '酿造日记录', unit: '锅',
        count: 0, data: null, pick: true, name: ''
      },
      {
        key: 'label', group: '产出', label: '酒标', unit: '张', count: lb ? 1 : 0, data: lb,
        name: lb ? String(lb.name || '未命名酒标') + '（图片本体不随包传输）' : ''
      },
      {
        key: 'analysis', group: '产出', label: '分析快照', unit: '份', count: ana ? 1 : 0, data: ana,
        name: ana ? '只带数字，不带原始批次' : ''
      },
      {
        key: 'inventory', group: '产出', label: '库存', unit: '项',
        count: inv ? ((inv.items || []).length || 0) : 0, data: inv,
        name: (inv && (inv.items || []).length)
          ? ((inv.items || []).length + ' 种物料 / ' + (inv.moves || []).length + ' 笔流水') : ''
      },
      {
        key: 'settings', group: '设置', label: '本地设置', unit: '项',
        count: (function () { var n = 0, k; var o = settingsPart(); for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n++; return n; })(),
        data: settingsPart(),
        name: '单位、字号、分辨率、IBU 模型等偏好（不含分隔条宽度、折叠状态等本机记忆）'
      }
    ];
    return out;
  }

  /** 酿造日这块要"某一锅"：默认取最近一锅有工艺时间轴或读数的 */
  function brewdayPick(list, wantId) {
    if (!list || !list.length) return null;
    var i, b;
    if (wantId) {
      for (i = 0; i < list.length; i++) if (String(list[i].id) === String(wantId)) return list[i];
    }
    for (i = list.length - 1; i >= 0; i--) {
      b = list[i] || {};
      var steps = ((b.brewday || {}).steps || []).length;
      if (steps || (b.readings || []).length) return b;
    }
    return list[list.length - 1];
  }

  /** 勾选面板 → 交给 28 号编码器的 parts（键名与 28 的 PART_ORDER 一一对应） */
  function bundleParts(sel, brewdayId) {
    var blocks = bundleBlocks();
    var list = (store() && store().listBatches()) || [];
    var parts = {};
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!sel[b.key]) continue;
      if (b.key === 'brewday') {
        var bb = brewdayPick(list, brewdayId);
        if (bb) parts.brewday = bb;
        continue;
      }
      if (!b.count) continue;
      parts[b.key] = b.data;
    }
    return parts;
  }

  /** 单类型 → 分享包的 parts（「导出 JSON」在非自定义模式下也走同一条路） */
  function partsOfType(type, data) {
    if (type === 'library') {
      var lib = data || {};
      return { malts: lib.malts || [], hops: lib.hops || [], yeasts: lib.yeasts || [], adjuncts: lib.adjuncts || [] };
    }
    var map = { malt: 'malts', hop: 'hops', yeast: 'yeasts', adjunct: 'adjuncts' };
    if (map[type]) {
      var o = {};
      o[map[type]] = [data];
      return o;
    }
    var same = { recipe: 'recipe', batches: 'batches', brewday: 'brewday', label: 'label',
      analysis: 'analysis', inventory: 'inventory' };
    if (same[type]) {
      var p = {};
      p[same[type]] = data;
      return p;
    }
    return {};
  }

  /** 分享包 → 一个码（28 号模块内部自动在 BZ1 / BL2 之间挑短的那个）。
   *  返回 {ok:true, res} / {ok:false, err}：**不在这里 toast**，
   *  因为"超限"要落到结果区那张卡片上（只弹 toast 等于把用户扔在死胡同里）。 */
  function tryBundle(parts, at) {
    try {
      return { ok: true, res: BREW.ShareCode.encodeBundle(parts, { at: at || new Date().toISOString() }) };
    } catch (e) {
      return { ok: false, err: e || null };
    }
  }

  /** 同一份 parts 直接出 JSON（只出文件，不算码 —— 算了也发不出去） */
  function bundleJSONOnly(parts, at) {
    return BREW.ShareCode.encodeBundle(parts, {
      at: at || new Date().toISOString(),
      jsonOnly: true
    });
  }

  /* ======================================================================
   * D. 生成
   * ====================================================================*/
  /**
   * 生成分享码。
   * @returns {{text,chars,bytes,sizeLevel,message,notes,type}|null} 失败返回 null（已 toast）
   */
  /* 最近一次生成失败的错误。**只为"超限 → 改走 JSON 文件"那条出路**留着：
     卡片要显示"这段内容 67,653 字符 / 上限 4,000"，那两个数字只在 Error 上。 */
  var lastCodeError = null;

  function buildCode(type, data, opts) {
    lastCodeError = null;
    var out;
    try {
      out = BREW.ShareCode.encodeAny(type, data, opts);
    } catch (e) {
      lastCodeError = e || null;
      /* 超限错误自带"当前 X / 上限 Y"，humanError 会原样透出（它已经是人话）。
         用 warn 而不是 error：超限不是"软件坏了"，是"这份内容不适合用码发"——
         真正给出路的是下面那张卡片，不是这条 toast。 */
      toast('生成分享码失败：' + humanError(e),
        e && e.code === 'too-large' ? 'warn' : 'error', 5200);
      return null;
    }
    if (!out || !out.text) {
      toast('生成分享码失败：编码器没有返回内容', 'error', 4200);
      return null;
    }
    return {
      text: String(out.text),
      type: String(out.type || type),
      chars: num(out.chars, String(out.text).length),
      bytes: num(out.bytes, String(out.text).length),
      sizeLevel: String(out.sizeLevel || 'ok'),
      message: String(out.message || ''),
      notes: Array.isArray(out.notes) ? out.notes.slice() : []
    };
  }

  /* ======================================================================
   * E. 导入：预览 + 落库
   * ----------------------------------------------------------------------
   * **预览不写任何东西**。写入只在 applyImport 里发生，而它由「确认导入」调用。
   * ====================================================================*/

  /** 把一份解出来的对象描述成"人要看的几行" */
  function describe(got) {
    var d = got.data || {};
    var rows = [];
    var title = '';
    var t = got.type;

    if (t === 'recipe') {
      title = '配方：' + String(d.name || '未命名');
      if (d.styleId) rows.push(['风格', String(d.styleId)]);
      rows.push(['产量', fmt(num(d.batchSize, 0), 0) + ' L']);
      var tg = d.targets || {};
      if (tg.og) rows.push(['目标 OG', fmt(tg.og, 3)]);
      if (tg.ibu) rows.push(['苦度', fmt(tg.ibu, 0) + ' IBU']);
      rows.push(['原料', (d.fermentables || []).length + ' 麦芽 / ' + (d.hops || []).length +
        ' 酒花 / ' + (d.yeasts || []).length + ' 酵母']);
    } else if (KIND_OF[t]) {
      title = typeLabel(t) + '：' + String(d.name || '未命名');
      if (t === 'malt') rows.push(['参数', fmt(num(d.ppg, 0), 0) + ' ppg / ' + fmt(num(d.lov, 0), 0) + ' °L / ' + (d.cat || '—')]);
      else if (t === 'hop') rows.push(['参数', 'α ' + fmt(num(d.aa, 1), 1) + '% / ' + (d.origin || '—') + ' / ' + (d.type || '—')]);
      else if (t === 'yeast') rows.push(['参数', '衰减 ' + fmt((BREW.UI && BREW.UI.yeastAtt) ? BREW.UI.yeastAtt(d, 75) : num(d.att, 1), 1) + '% / ' + (d.type || '—') + ' / ' + (d.form || '—')]);   /* v2.0：兼容老字段 */
      else rows.push(['用量', fmt(num(d.useMin, 0), 0) + '–' + fmt(num(d.useMax, 0), 0) + (d.unit || 'g') + ' / ' + (d.cat || '—')]);
    } else if (t === 'library') {
      var n = 0, k;
      for (k in d) if (Array.isArray(d[k])) n += d[k].length;
      title = '原料库：' + n + ' 条';
      rows.push(['麦芽', String((d.malts || []).length)]);
      rows.push(['酒花', String((d.hops || []).length)]);
      rows.push(['酵母', String((d.yeasts || []).length)]);
      rows.push(['辅料', String((d.adjuncts || []).length)]);
    } else if (t === 'batches') {
      var items = (d && d.items) || [];
      title = '批次列表：' + items.length + ' 锅';
      rows.push(['第一锅', String((items[0] || {}).name || '未命名')]);
      rows.push(['批次号', String((items[0] || {}).batchNo || '—')]);
      rows.push(['配方快照', '只带名字与关键值（不含配方全文）']);
    } else if (t === 'brewday') {
      title = '酿造日：' + String(d.batchNo || '') + ' ' + String(d.name || '');
      rows.push(['步骤', String(((d.brewday || {}).steps || []).length) + ' 个']);
      rows.push(['读数', String((d.readings || []).length) + ' 条']);
      rows.push(['酿造日', String(d.brewDate || '—')]);
    } else if (t === 'label') {
      title = '酒标：' + String(d.name || '未命名');
      rows.push(['版式', String(d.format || '—')]);
      rows.push(['元素', String((d.elements || []).length) + ' 个']);
      rows.push(['图片', d.bg && d.bg.imageId ? '用图了，但图片本体不在码里' : '没用图']);
    } else if (t === 'analysis') {
      var A = d.annual || {};
      title = '分析快照：' + String(A.year || '—') + ' 年';
      rows.push(['批次', String(A.count || 0) + ' 锅 / 完成 ' + String(A.completedCount || 0)]);
      rows.push(['产量', fmt(num(A.volumeL, 0), 1) + ' L']);
      if (A.avgEfficiency) rows.push(['平均效率', fmt(A.avgEfficiency, 1) + '%']);
      if ((d.cost || {}).total) rows.push(['花费合计', fmt(d.cost.total, 0) + ' 元']);
    } else if (t === 'inventory') {
      title = '库存：' + String((d.items || []).length) + ' 种物料';
      rows.push(['流水', String((d.moves || []).length) + ' 笔']);
    } else if (t === 'bundle') {
      /* 分享包要知道的是"里面有几块、每块多少条" —— 用户点确认之前
         唯一能判断"是不是我要发的那几块"的依据。 */
      var blocks = got.blocks || [];
      title = '分享包：' + blocks.length + ' 块';
      for (var bi = 0; bi < blocks.length; bi++) {
        rows.push([blocks[bi].label, blocks[bi].count + ' ' + (blocks[bi].unit || '条')]);
      }
      if (got.at) rows.push(['导出时间', String(got.at).slice(0, 10)]);
    } else {
      title = typeLabel(t);
    }

    return { title: title, rows: rows };
  }

  /** 描述里"会发生什么"，让用户点确认之前就知道后果 */
  function consequence(got) {
    switch (got.type) {
      case 'recipe': return '会替换当前编辑中的配方（工作副本）。原配方若没保存请先取消、回去保存。';
      case 'malt': case 'hop': case 'yeast': case 'adjunct':
        return '会作为一条自建原料加进原料库，不动任何配方。';
      case 'library': return '会把码里的自建原料并入原料库；同 id 的条目以码里为准。';
      case 'batches': return '会把码里的批次追加成新批次（换新 id），不会覆盖已有的那几锅。';
      case 'brewday': return '会把工艺时间轴与实测写进本机同一批次号的那一锅。';
      case 'label': return '会给当前配方加一张酒标设计（每个配方最多 3 张，超出时替换最早那张）。';
      case 'analysis': return '分析快照是只读的：只显示，不写入任何数据。';
      case 'inventory': return '会把码里的物料与流水并入库存；同 key 的物料以码里为准。';
      case 'bundle': return '会按块分别写入：原料并入原料库、当前配方载入工作副本、' +
        '已保存配方存成新副本、批次追加为新锅、酿造日写进同批次号那一锅、' +
        '酒标加到当前配方、设置立即生效；分析快照只读。';
      default: return '';
    }
  }

  /** 落库。返回一句给用户看的结果；失败返回 null（已 toast） */
  function applyImport(got) {
    var d = got.data;

    if (got.type === 'bundle') return applyBundle(got);

    if (got.type === 'recipe') {
      UI.setRecipe(d);
      /* 只刷新顶栏与视图，不落盘工作副本（persist:false）：用户还没确认
         这是他要的那份。真正的「保存配方」仍要他自己点。 */
      try { UI.publish({ persist: false }); } catch (e) { /* 计算失败不阻断导入 */ }
      if (UI.Shell && UI.Shell.activeId && UI.Shell.activeId() === 'recipe' && UI.Shell.refresh) {
        UI.Shell.refresh();
      }
      return '已载入《' + String(d.name || '未命名') + '》。关掉窗口后点「另存为」给它一个新名字。';
    }

    if (KIND_OF[got.type]) {
      saveIngredient(KIND_OF[got.type], d);
      return '已把「' + String(d.name || '未命名') + '」作为自建原料加进原料库。';
    }

    if (got.type === 'library') {
      var n = 0;
      var kinds = ['malts', 'hops', 'yeasts', 'adjuncts'];
      for (var i = 0; i < kinds.length; i++) {
        var arr = Array.isArray(d[kinds[i]]) ? d[kinds[i]] : [];
        for (var j = 0; j < arr.length; j++) { saveIngredient(kinds[i], arr[j]); n++; }
      }
      return '已并入 ' + n + ' 条自建原料。';
    }

    if (got.type === 'batches') {
      var items = (d && d.items) || [];
      var B = BREW.Batch;
      var added = 0;
      for (var k = 0; k < items.length; k++) {
        var src = items[k] || {};
        /* 用 blank() 起底：它带全部必填段（actual / packaging / tasting / cost /
           failure / statusHistory），少一个字段界面就会在某处读 undefined。 */
        var nb = (B && typeof B.blank === 'function') ? B.blank(null) : {};
        nb.id = UI.uid('b');
        nb.batchNo = String(src.batchNo || '');
        nb.brewDate = String(src.brewDate || '');
        nb.status = String(src.status || 'plan');
        if (!Array.isArray(nb.statusHistory) || !nb.statusHistory.length) {
          nb.statusHistory = [{ status: nb.status, at: Date.now() }];
        }
        if (src.actual) nb.actual = src.actual;
        if (src.packaging) nb.packaging = src.packaging;
        if (src.tasting) nb.tasting = src.tasting;
        if (src.cost) nb.cost = src.cost;
        if (src.notes) nb.notes = String(src.notes);
        if (Array.isArray(src.readings)) nb.readings = src.readings;
        nb.recipeSnapshot = Object.assign({}, nb.recipeSnapshot || {}, src.snap || {},
          { name: src.name || '', styleId: src.styleId || '' });
        nb.recipeId = null;
        try {
          store().saveBatch(nb);
          added++;
        } catch (e2) {
          toast('有一锅没存进去：' + humanError(e2), 'warn', 4200);
        }
      }
      if (UI.Shell && UI.Shell.refresh) { try { UI.Shell.refresh(); } catch (e3) { /* ignore */ } }
      return '已追加 ' + added + ' 锅批次；批次号重复的会自动改号。';
    }

    if (got.type === 'brewday') {
      var list = (store() && store().listBatches()) || [];
      var hit = null;
      for (var m = 0; m < list.length; m++) {
        if (String(list[m].batchNo || '') === String(d.batchNo || '') &&
          String(d.batchNo || '') !== '') { hit = list[m]; break; }
      }
      if (!hit) {
        toast('本机没有批次号 ' + String(d.batchNo || '（空）') + ' 的那一锅：先「新建批次」，再导入工艺记录', 'warn', 5200);
        return null;
      }
      hit.brewday = d.brewday || hit.brewday;
      if (d.actual) hit.actual = Object.assign({}, hit.actual || {}, d.actual);
      if (Array.isArray(d.readings) && d.readings.length) hit.readings = d.readings;
      store().saveBatch(hit);
      if (UI.Shell && UI.Shell.refresh) { try { UI.Shell.refresh(); } catch (e4) { /* ignore */ } }
      return '已把工艺时间轴写进批次 ' + String(d.batchNo || '') + '。';
    }

    if (got.type === 'label') {
      var r = UI.recipe() || {};
      var key = labelKeyOf(r);
      var all = (store() && store().get('labels', {})) || {};
      var arr = Array.isArray(all[key]) ? all[key].slice() : [];
      var copy = JSON.parse(JSON.stringify(d || {}));
      copy.id = UI.uid('lb');
      copy.at = Date.now();
      if (!copy.name) copy.name = '导入的酒标';
      arr.push(copy);
      /* 每个配方最多 3 张（与 49 的 MAX_PER_RECIPE 同口径）。超了丢最早的那张，
         并明说——静默丢弃用户的酒标比报错更难查。 */
      while (arr.length > 3) arr.shift();
      all[key] = arr;
      store().set('labels', all);
      if (UI.Shell && UI.Shell.refresh) { try { UI.Shell.refresh(); } catch (e5) { /* ignore */ } }
      return '已给当前配方加一张酒标（每个配方最多 3 张）。';
    }

    if (got.type === 'analysis') {
      /* 只读：不进库。这不是"没实现"，是设计——分析快照是别人的结论，
         混进自己的统计表里会让数字变得无法解释。 */
      return '分析快照已读出（只读，不写入任何数据）。';
    }

    if (got.type === 'inventory') {
      var inv = (store() && store().get('inventory', null)) || { items: [], moves: [] };
      var items = Array.isArray(inv.items) ? inv.items.slice() : [];
      var moves = Array.isArray(inv.moves) ? inv.moves.slice() : [];
      var byKey = {};
      for (var x = 0; x < items.length; x++) byKey[items[x].key] = x;
      var addedI = 0;
      var srcItems = Array.isArray(d.items) ? d.items : [];
      for (var y = 0; y < srcItems.length; y++) {
        var it = srcItems[y];
        if (!it || !it.key) continue;
        if (byKey[it.key] !== undefined) items[byKey[it.key]] = it;
        else { byKey[it.key] = items.length; items.push(it); }
        addedI++;
      }
      var have = {};
      for (var z = 0; z < moves.length; z++) if (moves[z] && moves[z].id) have[moves[z].id] = 1;
      var addedM = 0;
      var srcMoves = Array.isArray(d.moves) ? d.moves : [];
      for (var w = 0; w < srcMoves.length; w++) {
        var mv = srcMoves[w];
        if (!mv || !mv.id || have[mv.id]) continue;
        moves.push(mv);
        addedM++;
      }
      store().set('inventory', { items: items, moves: moves });
      if (UI.Shell && UI.Shell.refresh) { try { UI.Shell.refresh(); } catch (e6) { /* ignore */ } }
      return '已并入 ' + addedI + ' 种物料、' + addedM + ' 笔流水。';
    }

    return null;
  }

  function saveIngredient(kind, item) {
    if (!item || typeof item !== 'object') return null;
    var copy = JSON.parse(JSON.stringify(item));
    copy.id = UI.uid('ing');
    copy.custom = true;
    UI.saveCustom(kind, copy);
    return copy;
  }

  /* ----------------------------------------------------------------------
   * E2. 分享包落库（v1.8）
   * ----------------------------------------------------------------------
   * 一块也不新写：原料走 saveIngredient、批次 / 酿造日 / 酒标 / 库存直接
   * 复调 applyImport 自己的分支。分享包只是"一次调用多个分支"，
   * 不是第二套写入逻辑 —— 否则同一个块从单类型码进来和从包进来会走出
   * 两种行为，那种分叉平时看不出来，只在某一侧先修了 bug 之后暴露。
   * --------------------------------------------------------------------*/
  function applyBundle(got) {
    var parts = (got.data && got.data.parts) || {};
    var done = [];
    var kinds = ['malts', 'hops', 'yeasts', 'adjuncts'];
    var i, j, n;

    n = 0;
    for (i = 0; i < kinds.length; i++) {
      var arr = Array.isArray(parts[kinds[i]]) ? parts[kinds[i]] : [];
      for (j = 0; j < arr.length; j++) { saveIngredient(kinds[i], arr[j]); n++; }
    }
    if (n) done.push('自建原料 ' + n + ' 条');

    if (parts.recipe) {
      UI.setRecipe(parts.recipe);
      try { UI.publish({ persist: false }); } catch (e0) { /* 计算失败不阻断导入 */ }
      done.push('当前配方《' + String(parts.recipe.name || '未命名') + '》');
    }

    if (Array.isArray(parts.recipes) && parts.recipes.length) {
      n = importRecipes(parts.recipes);
      if (n) done.push('配方 ' + n + ' 份');
    }

    if (Array.isArray(parts.batches) && parts.batches.length) {
      applyImport({ type: 'batches', data: parts.batches });
      done.push('批次 ' + parts.batches.length + ' 锅');
    }

    if (parts.brewday) {
      /* 酿造日要求本机有同批次号的那一锅；没有时 applyImport 会 toast 说明，
         这里不再重复报错，但也不假装成功。 */
      var bd = applyImport({ type: 'brewday', data: parts.brewday });
      if (bd) done.push('酿造日 ' + String(parts.brewday.batchNo || ''));
    }

    if (parts.label) {
      applyImport({ type: 'label', data: parts.label });
      done.push('酒标 1 张');
    }

    if (parts.inventory) {
      applyImport({ type: 'inventory', data: parts.inventory });
      done.push('库存 ' + ((parts.inventory.items || []).length) + ' 项');
    }

    if (parts.settings) {
      n = applySettingsPart(parts.settings);
      if (n) done.push('设置 ' + n + ' 项');
    }

    var ana = parts.analysis ? '；分析快照只读出、不写入' : '';
    if (UI.Shell && UI.Shell.refresh) { try { UI.Shell.refresh(); } catch (e9) { /* ignore */ } }
    if (!done.length) return '这个分享包里没有可写入的内容' + ana + '。';
    return '已按块导入：' + done.join('、') + ana + '。';
  }

  /** 已保存配方 → 存成新副本（换 id，名字加"（导入）"，不覆盖本机同名配方） */
  function importRecipes(list) {
    var S = store();
    if (!S || typeof S.saveRecipe !== 'function') return 0;
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var src = list[i];
      if (!src || typeof src !== 'object') continue;
      var copy = JSON.parse(JSON.stringify(src));
      copy.id = UI.uid('r');
      copy.name = String(copy.name || '未命名配方').replace(/（导入）$/, '') + '（导入）';
      copy.parentId = null;
      copy.createdAt = Date.now();
      copy.updatedAt = Date.now();
      try { S.saveRecipe(copy); n++; } catch (e) { /* 单份失败不带走整包 */ }
    }
    return n;
  }

  /* ======================================================================
   * F. 模态框（分享中心）
   * ====================================================================*/

  var SRC_TEXT = {
    recipe: '把当前编辑中的配方打包成码。码里有配方名、原料用量、设备参数与目标值，不含批次记录。',
    malt: '分享一条麦芽的完整参数（ppg / 色度 / 是否糖化 / 风味与用法）。',
    hop: '分享一条酒花的 α 酸、型别、香气描述与替代品种。',
    yeast: '分享一颗酵母的衰减区间、温度区间、絮凝性与风格适配。',
    adjunct: '分享一条辅料的用量区间、投放阶段与注意事项。',
    library: '把自建原料整库打包。内置的几百条是公共数据，不重复传输。',
    batches: '分享批次列表（批次号、日期、状态、实测、装瓶、品鉴、花费）。配方只带名字与关键值。',
    brewday: '分享一锅的工艺时间轴：步骤、投料时刻与读数。',
    label: '分享酒标设计（版式、元素、配色）。图片本体不随码传输 —— 一张图约 26 万字符，塞进去码就废了。',
    analysis: '分享年度统计与花费的数值快照。只带数字，不带原始批次。',
    inventory: '分享库存物料与出入库流水，对方并入后能看到同样的库存。'
  };

  function meter(cur, max) {
    var pct = max > 0 ? Math.min(100, Math.round(cur * 100 / max)) : 0;
    var cls = cur > max ? ' is-over' : (pct >= 60 ? ' is-warn' : '');
    return '<div class="sh-meter' + cls + '" role="img" aria-label="已用 ' + pct + '%，' + cur +
      ' 字符，上限 ' + max + ' 字符"><i style="width:' + pct + '%"></i></div>' +
      '<div class="sh-meter__num">' + cur + ' 字符 / 上限 ' + max + '（' + pct + '%）</div>';
  }

  /**
   * UI.Share.openModal(recipeOrOpts)
   *   openModal(recipe)            —— 42 号配方页的「分享」按钮（老调用，保持兼容）
   *   openModal({type:'batches'})  —— 功能区「分享」页签里的入口（预选类型）
   */
  Share.openModal = function (recipeOrOpts) {
    /* 纯计算模块可能晚于本文件落盘。守卫放在入口而不是文件顶层，
       这样"先打开软件、后补文件"也不会被判定为缺失。 */
    if (!BREW.ShareCode) {
      toast('分享模块未载入（js/28-share-code.js）', 'warn', 3800);
      return null;
    }

    var opts = {};
    var presetRecipe = null;
    if (recipeOrOpts && typeof recipeOrOpts === 'object' && typeof recipeOrOpts.type === 'string') {
      opts = recipeOrOpts;
    } else {
      presetRecipe = recipeOrOpts || null;
    }
    /* 传进来的配方只作为"生成区的数据来源"，**不调用 setRecipe**：
       打开一个对话框不该改动工作副本。之前想过"传进来的不是当前副本就切过去"，
       但那样一来，42 传一份旧克隆就会把用户没保存的编辑静默覆盖 ——
       为了修一个"显示的不是手上这份"，制造一个"写到一半没了"，不值。 */

    var state = {
      type: (typeMeta(opts.type) ? opts.type : 'recipe'),
      pickId: opts.pickId || '',
      code: null,
      preview: null,
      previewFor: '',     /* 预览对应的是哪一段文本，避免"改过输入框却拿旧预览确认" */
      previewKind: 'code',/* 'code' | 'json'：两条入口共用同一份预览与同一颗确认按钮 */
      /* 分享包的勾选状态（v1.8）。默认不勾 —— 打开就全选会让"生成"变成
         一按就把全部家当打包，那是最容易误发的一种默认。 */
      bundleSel: {},
      bundleBrewdayId: '',
      blockChars: {},     /* key → 只选这一块时的码长（打开时算一次，切换时只算总数） */
      escapeParts: null   /* 超限卡片"导出 JSON"用的那一份 parts（生成时的快照） */
    };
    pendingRecipe = presetRecipe;

    var api = UI.Shell.modal({
      title: '分享中心',
      sub: '选对象 → 生成一段码；或把收到的码粘进来（识别后才写入）',
      size: 'wide',
      body:
        /* 这 11 颗是"选一个对象"，不是切换三块面板 —— 所以是 role=group + aria-pressed，
           不是 tablist/tab（那个语义要求每颗 tab 控制一个 tabpanel，这里没有）。
           第 12 颗「自定义」是 v1.8 加的：它不分享"一个对象"，而是让用户勾几块
           装进一个分享包 —— 语义确实不同，但它与那 11 颗是**互斥的选择**，
           所以放在同一组里、用同一个 aria-pressed，比另起一个按钮更不容易点错。 */
        '<div class="sh-types" id="share-pills" role="group" aria-label="分享对象"></div>' +
        '<div class="share-grid">' +
          '<section class="share-block">' +
            '<h3 class="share-block__title">生成</h3>' +
            '<p class="share-block__desc" id="share-src-desc"></p>' +
            '<div class="sh-pick" id="share-pick-wrap"></div>' +
            '<div class="sh-src" id="share-src"></div>' +
            '<div id="share-bundle" class="shb" hidden></div>' +
            '<textarea class="input share-code" id="share-code-out" readonly rows="6" ' +
              'aria-label="分享码" placeholder="点下方按钮生成…"></textarea>' +
            '<div id="share-out-meta" class="share-meta"></div>' +
            '<div id="share-out-meter" class="sh-meterwrap"></div>' +
            '<div class="row mt-8">' +
              '<button type="button" class="btn btn-primary btn-sm" data-share="gen">' +
                icon('sparkle', 13) + '生成</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-share="copy" disabled>' +
                icon('copy', 13) + '复制</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-share="tojson">' +
                icon('save', 13) + '导出 JSON 文件</button>' +
            '</div>' +
            /* sizeLevel==='long' 时的黄条落点：文案由 28 号模块给，这里只负责显示 */
            '<div id="share-out-warn" class="mt-8"></div>' +
          '</section>' +
          '<section class="share-block">' +
            '<h3 class="share-block__title">导入</h3>' +
            '<p class="share-block__desc">把收到的码整段粘进来，或选一个 .json 分享文件。' +
              '两条入口走同一个预览：粘进来 / 选文件都只会识别，点「确认导入」才写入。</p>' +
            '<textarea class="input share-code" id="share-code-in" rows="6" ' +
              'aria-label="粘贴分享码" placeholder="粘贴分享码…（BL1. / BL2. / BZ1. / BF1.）"></textarea>' +
            '<div class="row mt-8">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-share="paste">' +
                icon('down', 13) + '从剪贴板粘贴</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-share="detect">' +
                icon('search', 13) + '识别</button>' +
              '<button type="button" class="btn btn-primary btn-sm" data-share="parse">' +
                icon('arrow', 13) + '确认导入</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-share="fromjson">' +
                icon('save', 13) + '选择 JSON 文件</button>' +
            '</div>' +
            /* 文件入口藏在按钮后面：file:// 下没有拖拽 API 的稳定行为，
               但 <input type=file> 在所有内核里都能用，且不依赖权限 */
            '<input type="file" id="share-file-in" accept=".json,application/json" hidden>' +
            '<div id="share-in-detect" class="sh-detect"></div>' +
            '<div id="share-in-msg" class="mt-8"></div>' +
          '</section>' +
        '</div>',
      actions: [{ label: '关闭', kind: 'ghost' }],
      onMount: function (a) {
        var pills = a.query('#share-pills');
        var desc = a.query('#share-src-desc');
        var pickWrap = a.query('#share-pick-wrap');
        var srcBox = a.query('#share-src');
        var out = a.query('#share-code-out');
        var meta = a.query('#share-out-meta');
        var meterBox = a.query('#share-out-meter');
        var outWarn = a.query('#share-out-warn');
        var input = a.query('#share-code-in');
        var detectBox = a.query('#share-in-detect');
        var msg = a.query('#share-in-msg');
        var btnCopy = a.query('[data-share="copy"]');
        var bundleBox = a.query('#share-bundle');
        var fileIn = a.query('#share-file-in');

        var LIM = (BREW.ShareCode.limits && BREW.ShareCode.limits()) || { warn: 1200, max: 4000 };

        /* ---------- 类型胶囊 ---------- */
        function paintPills() {
          if (!pills) return;
          var list = types();
          var h = '';
          for (var i = 0; i < list.length; i++) {
            var on = list[i].t === state.type;
            h += '<button type="button" class="sh-type' + (on ? ' is-on' : '') + '" ' +
              'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
              'data-sh-type="' + attr(list[i].t) + '" title="' + attr(list[i].hint || list[i].label) + '">' +
              icon(list[i].icon, 13) + '<span>' + esc(list[i].label) + '</span></button>';
          }
          /* 第 12 颗：自定义（勾几块装进一个包）。它不来自 28 的 TYPES
             —— 那张表是"11 种对象"，加进去会污染 encodeAny 的类型判定。 */
          var bon = state.type === 'bundle';
          h += '<button type="button" class="sh-type sh-type--bundle' + (bon ? ' is-on' : '') + '" ' +
            'aria-pressed="' + (bon ? 'true' : 'false') + '" data-sh-type="bundle" ' +
            'title="自己勾几块内容，合成一个分享码或一个 JSON 文件">' +
            icon('layers', 13) + '<span>自定义</span></button>';
          pills.innerHTML = h;
        }

        /* ---------- 数据来源（摘要 + 可选下拉） ---------- */
        function paintSource() {
          if (state.type === 'bundle') return paintBundle();

          /* 从「自定义」切回单类型时要还原三块显示，否则会留下一个空壳面板 */
          if (bundleBox) { bundleBox.hidden = true; bundleBox.innerHTML = ''; bundleBox.removeAttribute('data-built'); }
          if (srcBox) srcBox.hidden = false;

          var got = gather(state.type, state.pickId);
          if (desc) desc.textContent = SRC_TEXT[state.type] || '';
          if (pickWrap) {
            if (got.picks && got.picks.length) {
              var h = '<label class="sh-pick__label" for="share-pick">分享哪一条</label>' +
                '<select class="input sh-pick__sel" id="share-pick" aria-label="分享哪一条">';
              for (var i = 0; i < got.picks.length; i++) {
                var on = (i === (got.pick || 0)) ? ' selected' : '';
                h += '<option value="' + attr(got.picks[i].id) + '"' + on + '>' +
                  esc(got.picks[i].name) + '</option>';
              }
              h += '</select>';
              pickWrap.innerHTML = h;
              pickWrap.hidden = false;
            } else {
              pickWrap.innerHTML = '';
              pickWrap.hidden = true;
            }
          }
          if (srcBox) {
            srcBox.innerHTML = got.ok
              ? '<span class="sh-src__ok">' + icon('check', 13) + '<b>将要分享</b>' + esc(got.summary) + '</span>' +
                (got.note ? '<span class="sh-src__note">' + esc(got.note) + '</span>' : '')
              : '<span class="sh-src__bad">' + icon('alert', 13) + esc(got.reason) + '</span>';
          }
          return got;
        }

        function showCode(res) {
          if (!out) return;
          out.value = res.text;
          if (meta) {
            if (res.blocks) {
              /* 分享包不摆"X 字符 / 上限 4000"那个表：它的量级是几百到几万，
                 表永远是满的，等于没有信息。换成"压缩比"，那才是用户关心的。 */
              var ratio = res.plainChars > 0 ? Math.round(res.chars * 100 / res.plainChars) : 100;
              meta.innerHTML =
                '<span class="share-meta__item">' + icon('layers', 12) + res.chars + ' 字符</span>' +
                '<span class="share-meta__item">' + icon('scale', 12) +
                  (res.format === 'BZ1'
                    ? ('已压缩 · 明文的 ' + ratio + '%（' + res.plainChars + ' → ' + res.packedChars + '）')
                    : ('未压缩（压了反而更长）· 明文 ' + res.plainChars)) + '</span>' +
                '<span class="share-meta__item">' + esc(res.blocks.length) + ' 块</span>';
            } else {
              meta.innerHTML = '<span class="share-meta__item">' + icon('layers', 12) + res.chars + ' 字符</span>' +
                '<span class="share-meta__item">' + icon('scale', 12) + '约 ' + fmt(res.bytes / 1024, 1) + ' KB</span>' +
                '<span class="share-meta__item">' + esc(typeLabel(res.type)) + '</span>';
            }
          }
          if (meterBox) meterBox.innerHTML = res.blocks ? '' : meter(res.chars, LIM.max);
          if (btnCopy) btnCopy.disabled = false;
          if (outWarn) {
            var notes = (res.notes || []).slice();
            /* 分享包的长码提示由下面那张"改成 JSON 文件"的卡片负责，
               这里不再重复一遍（同一句话出现两次，用户会以为漏看了什么） */
            if (!res.blocks && res.sizeLevel === 'long' && res.message) notes.unshift(res.message);
            outWarn.innerHTML = notes.length
              ? '<div class="alert alert--warn"><span class="alert__icon">' + icon('alert', 13) +
                '</span><span>' + esc(notes.join('；')) + '</span></div>'
              : '';
          }
        }

        /* ---------- 超限时的出路：同一份 parts，改成发一个 JSON 文件 ----------
           为什么必须是一张卡片而不是一句 toast：
             用户勾了 8 块，压缩后 67,653 字符，分享码根本发不出去。这时
             只弹"太大，不能生成"= 把他扔在死胡同里，他还得自己想办法。
             用户的原话是"最终给出的分享码**或者是 JSON 文件**最好都是一个"——
             所以"太大了"应该**换一种交付形式**，而不是结束。
           为什么按钮点下去不能再收集一遍：这一秒的 store 和刚才那一秒可能
             不一样（用户可能在别的窗口又存了一条原料）。重新收集 = 导出的
             文件与卡片上写的那一份不是同一份内容。
        ---------------------------------------------------------------- */
        function escapeCard(parts, chars, max, hard) {
          state.escapeParts = parts;
          if (!outWarn) return;
          var box = document.createElement('div');
          box.className = 'shb-esc';
          box.innerHTML =
            '<div class="shb-esc__t">' +
              (hard ? '内容太大：' : '码很长：') + '<b>' + (chars || 0) + '</b> 字符' +
              (max ? '，超过分享码上限 <b>' + max + '</b>' : '') +
            '</div>' +
            '<div class="shb-esc__p">分享码只适合传小块内容。同样的内容可以直接导出成' +
              '<b>一个 JSON 文件</b>发给对方，对方用「选择 JSON 文件」还原 —— 内容与分享码完全一致。</div>' +
            '<button type="button" class="btn btn-primary btn-sm" data-share="tojson-now">' +
              icon('save', 13) + '导出 JSON 文件</button>';
          outWarn.appendChild(box);
          /* 勾选到此为止了：把列表收窄，给卡片腾地方 */
          if (bundleBox) bundleBox.classList.add('is-compact');
          /* 卡片是本屏真正要用户点的那一下，所以它必须自己滚进可视区 ——
             "生成了但按钮在折线下面"和"只弹一句报错"是同一类失败：
             用户看到结论，却够不着出路。 */
          try { box.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 老内核没有这个参数，忽略 */ }
        }

        /* ---------- 分享包：勾选面板 ---------- */
        /* 估算时用的固定时间戳：真实生成用当前时间，但两者都是 ISO 串、
           长度完全相同 —— 用常量是为了让"同样的勾选永远显示同一个数字"，
           否则每隔一秒刷新一次估算，数字会莫名其妙地跳。 */
        var EST_AT = '2026-01-01T00:00:00.000Z';

        function selCount() {
          var n = 0, k;
          for (k in state.bundleSel) if (state.bundleSel[k]) n++;
          return n;
        }

        function selectedParts() {
          return bundleParts(state.bundleSel, state.bundleBrewdayId);
        }

        /* 每一块"只选它一个"时的码长。打开面板算一次就够 —— 数据在这期间
           不会变（用户在这个框里改不了原料和批次），每勾一下就重算 12 次
           编码会让"全选"卡住半秒。 */
        function measureBlocks(blocks) {
          state.blockChars = {};
          var list = (store() && store().listBatches()) || [];
          for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i];
            var one = {};
            if (b.key === 'brewday') {
              var bd = brewdayPick(list, state.bundleBrewdayId);
              if (!bd) continue;
              one.brewday = bd;
            } else {
              if (!b.count) continue;
              one[b.key] = b.data;
            }
            try {
              state.blockChars[b.key] = BREW.ShareCode.encodeBundle(one, { at: EST_AT }).chars;
            } catch (e) {
              state.blockChars[b.key] = -1;   /* -1 = 单独一块就超上限 */
            }
          }
        }

        function paintBundle() {
          if (!bundleBox) return { ok: true };
          bundleBox.hidden = false;
          if (pickWrap) { pickWrap.innerHTML = ''; pickWrap.hidden = true; }
          if (srcBox) srcBox.innerHTML = '';
          if (desc) {
            desc.textContent = '勾几块都只出一个分享码（或一个 JSON 文件）。';
          }

          var blocks = bundleBlocks();
          if (!bundleBox.getAttribute('data-built')) {
            measureBlocks(blocks);
            bundleBox.setAttribute('data-built', '1');
          }

          var batches = (store() && store().listBatches()) || [];
          var bdPick = brewdayPick(batches, state.bundleBrewdayId);
          state.bundleBrewdayId = bdPick ? String(bdPick.id) : '';

          var h = '<div class="shb__bar">' +
            '<label class="shb__all"><input type="checkbox" id="shb-all"> 全选</label>' +
            '<button type="button" class="btn btn-quiet btn-sm" data-share="bundle-none">清空</button>' +
            '<span class="shb__est" id="shb-est">尚未选择</span>' +
            '</div><div class="shb__list" id="shb-list">';

          var group = '';
          var total = 0;
          for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i];
            if (b.group !== group) {
              group = b.group;
              h += '<div class="shb__group">' + esc(group) + '</div>';
            }
            var has = b.key === 'brewday' ? !!bdPick : b.count > 0;
            var on = !!state.bundleSel[b.key] && has;
            if (on) total++;
            var chars = state.blockChars[b.key];
            var charsText = !has ? '—' :
              (chars === -1 ? '超出上限' : (chars > 0 ? '≈' + chars + ' 字符' : '—'));

            h += '<label class="shb__row' + (has ? '' : ' is-off') + (on ? ' is-on' : '') + '"' +
              (has ? '' : ' title="本机还没有这类数据"') + '>' +
              '<input type="checkbox" data-shb="' + attr(b.key) + '"' +
              (on ? ' checked' : '') + (has ? '' : ' disabled') + '>' +
              '<span class="shb__name">' + esc(b.label) + '</span>' +
              '<span class="shb__n">' + (has ? (b.key === 'brewday' ? '1 锅' : (b.count + ' ' + (b.unit || '条'))) : '无数据') + '</span>' +
              '<span class="shb__c">' + esc(charsText) + '</span>' +
              (b.name ? '<span class="shb__note">' + esc(b.name) + '</span>' : '') +
              '</label>';

            if (b.key === 'brewday' && has) {
              h += '<div class="shb__sub"><label class="shb__sub-label" for="shb-brewday">选哪一锅</label>' +
                '<select class="input shb__sel" id="shb-brewday" aria-label="分享哪一锅的酿造日">';
              for (var j = 0; j < batches.length; j++) {
                var bb = batches[j] || {};
                var sel = String(bb.id) === state.bundleBrewdayId ? ' selected' : '';
                h += '<option value="' + attr(String(bb.id)) + '"' + sel + '>' +
                  esc(String(bb.batchNo || '—') + ' ' + batchName(bb)) + '</option>';
              }
              h += '</select></div>';
            }
          }
          h += '</div>';
          bundleBox.innerHTML = h;

          var all = bundleBox.querySelector('#shb-all');
          if (all) {
            var avail = 0;
            for (var k = 0; k < blocks.length; k++) {
              if (blocks[k].key === 'brewday' ? !!bdPick : blocks[k].count > 0) avail++;
            }
            all.checked = avail > 0 && total === avail;
            all.indeterminate = total > 0 && total < avail;
          }
          refreshEstimate();
          return { ok: true };
        }

        /* 实时估算：整包重新编一次（一次编码，不是 12 次）。
           时间戳固定成一个常量，保证"同样的勾选 = 同样的字符数"。 */
        function refreshEstimate() {
          var est = bundleBox && bundleBox.querySelector('#shb-est');
          if (!est) return;
          var parts = selectedParts();
          var n = 0, k;
          for (k in parts) if (Object.prototype.hasOwnProperty.call(parts, k)) n++;
          var boxes = bundleBox.querySelectorAll('[data-shb]');
          var total = boxes.length;
          if (!n) {
            est.textContent = '尚未选择（共 ' + total + ' 块）';
            est.className = 'shb__est';
            return;
          }
          try {
            var res = BREW.ShareCode.encodeBundle(parts, { at: EST_AT });
            /* 这一行必须单行放下：换行会把「生成」按钮顶到弹窗可视区之外 ——
               主操作看不见，比少显示一个压缩比严重得多。压缩比在生成后的
               meta 行里还有一份（那里宽度足够）。 */
            est.textContent = '已选 ' + n + '/' + total + ' 块 · 预计 ' + res.chars + ' 字符';
            est.className = 'shb__est' + (res.sizeLevel === 'long' ? ' is-long' : '');
          } catch (e) {
            est.textContent = '已选 ' + n + '/' + total + ' 块 · 超出上限';
            est.className = 'shb__est is-over';
          }
        }

        /* ---------- 预览（分享码与 JSON 文件共用这一份渲染） ---------- */
        function previewHTML(got, sizeText) {
          var info = describe(got);
          return '<div class="sh-preview">' +
            '<div class="sh-preview__title">' + icon('check', 13) + esc(info.title) + '</div>' +
            '<div class="sh-preview__rows">' +
            info.rows.map(function (r) {
              return '<span class="sh-preview__k">' + esc(r[0]) + '</span>' +
                '<span class="sh-preview__v">' + esc(r[1]) + '</span>';
            }).join('') +
            '<span class="sh-preview__k">体量</span><span class="sh-preview__v">' + esc(sizeText) + '</span>' +
            '</div>' +
            (got.imagesStripped
              ? '<div class="sh-preview__note">' + icon('alert', 12) +
                '这份包里的图片本体被去掉了（对方要自己重新选图）</div>' : '') +
            '<div class="sh-preview__con">' + esc(consequence(got)) + '</div>' +
            '</div>';
        }

        /* ---------- 导入：识别（不写） ---------- */
        function detect() {
          var raw = String((input && input.value) || '').trim();
          state.preview = null;
          state.previewFor = raw;
          state.previewKind = 'code';
          if (!raw) {
            if (detectBox) detectBox.innerHTML = '';
            if (msg) msg.innerHTML = '';
            return null;
          }
          var got = BREW.ShareCode.decodeAny(raw);
          var kind = BREW.ShareCode.detect(raw);
          var head = '';
          if (kind === 'BL1') head = '我认出这是一段配方（BL1 老码）';
          else if (kind === 'BZ1') head = '我认出这是一段压缩分享包（BZ1）';
          else if (kind === 'BL2') head = '我认出这是一段 ' + typeLabel(got.type || '') + '（BL2）';
          else if (kind === 'BF1') head = '我认出这是一段公式码（BF1）';
          else head = '我认不出这是什么';

          if (detectBox) {
            detectBox.innerHTML = '<span class="sh-detect__kind">' + esc(head.replace(/\*\*/g, '')) + '</span>';
          }
          if (!got.ok) {
            if (msg) {
              msg.innerHTML = '<div class="alert alert--warn"><span class="alert__icon">' +
                icon('alert', 13) + '</span><span>' + esc(got.reason || '这段码读不了') + '</span></div>';
              /* v1.8：认出是公式码（BF1）时给一条真出路。
                 用户第 2 条要的是"通过区分不同的分享码，自行判定是配方还是公式"——
                 判定本身早就有了，但原来到这句话就断了（只说"请到公式编辑器里导入"，
                 没有任何可以点的东西），用户只能自己关掉这个框、去找入口、再粘一次。
                 现在直接给按钮，并且把这段码先塞进剪贴板，少一步操作。 */
              if (kind === 'BF1') {
                var jump = document.createElement('button');
                jump.type = 'button';
                jump.className = 'btn btn-primary btn-sm';
                jump.style.marginTop = '8px';
                jump.innerHTML = icon('sparkle', 13) + '打开公式编辑器并导入这段码';
                jump.addEventListener('click', function () {
                  try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                      navigator.clipboard.writeText(raw);
                    }
                  } catch (e) { /* 剪贴板被拒不影响跳转 */ }
                  try {
                    if (BREW.Formula && BREW.Formula.UI && BREW.Formula.UI.open) {
                      BREW.Formula.UI.open();
                      toast('公式编辑器已打开；这段码已放进剪贴板，粘到「我的版本 → 导入」即可', 'info', 5200);
                    } else {
                      toast('公式模块没有加载，无法打开编辑器', 'warn', 3600);
                    }
                  } catch (e2) {
                    toast('打开公式编辑器失败：' + ((e2 && e2.message) || e2), 'error', 4200);
                  }
                });
                msg.appendChild(jump);
              }
            }
            return null;
          }
          state.preview = got;
          if (msg) msg.innerHTML = previewHTML(got, raw.length + ' 字符');
          return got;
        }

        /* ---------- 导入：JSON 文件（与分享码同一条预览 → 同一颗确认按钮） ---------- */
        function previewJSON(text, fileName) {
          state.preview = null;
          state.previewKind = 'json';
          state.previewFor = 'FILE:' + String(fileName || '') + ':' + String(text.length);

          var obj = null;
          try {
            obj = JSON.parse(text);
          } catch (e) {
            obj = undefined;      /* undefined = 连 JSON 都不是 */
          }

          if (obj === undefined) {
            if (detectBox) detectBox.innerHTML = '<span class="sh-detect__kind">这个文件读不出内容</span>';
            if (msg) {
              msg.innerHTML = '<div class="alert alert--warn"><span class="alert__icon">' + icon('alert', 13) +
                '</span><span>这个文件不是 JSON 文本（可能是图片、压缩包，或者存坏了）：' +
                '请让对方在「分享中心 → 导出 JSON 文件」重新导出一份</span></div>';
            }
            return null;
          }

          var got = BREW.ShareCode.readBundle
            ? BREW.ShareCode.readBundle(obj)
            : { ok: false, reason: '分享模块太旧，读不了 JSON 分享文件' };

          if (detectBox) {
            detectBox.innerHTML = '<span class="sh-detect__kind">' +
              esc(got.ok ? ('我认出这是一个分享文件：' + String(fileName || '')) : '这个文件不是本软件的分享文件') +
              '</span>';
          }
          if (!got.ok) {
            if (msg) {
              msg.innerHTML = '<div class="alert alert--warn"><span class="alert__icon">' + icon('alert', 13) +
                '</span><span>' + esc(got.reason || '这个文件读不了') + '</span></div>';
            }
            return null;
          }
          state.preview = got;
          if (msg) msg.innerHTML = previewHTML(got, fmt(text.length / 1024, 1) + ' KB');
          return got;
        }

        /* ---------- 导出 JSON 文件 ---------- */
        function dateStamp() {
          var d = new Date();
          function p2(v) { return (v < 10 ? '0' : '') + v; }
          return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
        }

        function downloadJSON(res) {
          var text = JSON.stringify(res.env, null, 2);
          var name = 'BrewLab-分享-' + dateStamp() + '.json';
          /* 留一份给"导出的到底是哪几块"这类断言用（见 Share.lastExport） */
          lastExport = res.env;
          try {
            var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            var url = (root.URL || root.webkitURL).createObjectURL(blob);
            var aEl = document.createElement('a');
            aEl.href = url;
            aEl.download = name;
            aEl.style.display = 'none';
            document.body.appendChild(aEl);
            aEl.click();
            document.body.removeChild(aEl);
            /* 立刻 revoke 会让部分内核拿不到数据；1.2 s 足够下载开始 */
            root.setTimeout(function () { try { (root.URL || root.webkitURL).revokeObjectURL(url); } catch (e) { } }, 1200);
            toast('已导出 ' + name + '（' + res.blocks.length + ' 块，' + fmt(text.length / 1024, 1) + ' KB）',
              'ok', 4200);
          } catch (e2) {
            /* file:// 下极少数内核禁 Blob 下载：退一步把内容塞进只读框，用户自己另存 */
            if (out) {
              out.value = text;
              out.setAttribute('aria-label', '分享包 JSON（复制后存成 .json 文件）');
            }
            toast('这个浏览器不允许直接下载文件：已把 JSON 放进上面的框，复制出来存成 ' + name,
              'warn', 7000);
          }
        }

        /* ---------- 事件 ---------- */
        a.body.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('[data-share], [data-sh-type]') : null;
          if (!btn) return;

          var typeBtn = btn.getAttribute('data-sh-type');
          if (typeBtn) {
            state.type = typeBtn;
            state.pickId = '';
            state.code = null;
            state.preview = null;
            if (out) out.value = '';
            if (meta) meta.innerHTML = '';
            if (meterBox) meterBox.innerHTML = '';
            if (outWarn) outWarn.innerHTML = '';
            if (btnCopy) btnCopy.disabled = true;
            paintPills();
            paintSource();
            return;
          }

          var act = btn.getAttribute('data-share');

          if (act === 'gen') {
            /* 自定义模式：勾几块 → 仍然只出一个码 */
            if (state.type === 'bundle') {
              var parts = selectedParts();
              var nk = 0, kk;
              for (kk in parts) if (Object.prototype.hasOwnProperty.call(parts, kk)) nk++;
              if (!nk) { toast('先勾至少一块内容（左边那些框）', 'warn', 4200); return; }
              var t = tryBundle(parts, new Date().toISOString());
              if (!t.ok) {
                var er = t.err;
                if (er && er.code === 'too-large') {
                  /* 不拦在这里：给出 JSON 这条活路 */
                  escapeCard(parts, er.chars || 0, er.max || 0, true);
                  toast('内容太大（' + (er.chars || 0) + ' 字符）：下方可以直接导出 JSON 文件', 'warn', 5600);
                } else {
                  toast('生成分享包失败：' + humanError(er), 'error', 5200);
                }
                if (out) out.value = '';
                if (meta) meta.innerHTML = '';
                if (meterBox) meterBox.innerHTML = '';
                if (btnCopy) btnCopy.disabled = true;
                return;
              }
              var bres = t.res;
              state.code = bres;
              if (bundleBox) bundleBox.classList.remove('is-compact');
              showCode(bres);
              state.escapeParts = parts;
              if (bres.sizeLevel === 'long') {
                /* 码能生成，但太长 —— 两个出路都给：左边能复制，下面能存文件 */
                escapeCard(parts, bres.chars, LIM.max, false);
              }
              toast('已生成 1 个分享包（' + bres.blocks.length + ' 块，' + bres.format + '）',
                (bres.notes && bres.notes.length) ? 'warn' : 'ok', 3600);
              return;
            }

            var got = paintSource();
            if (!got || !got.ok) {
              toast(got && got.reason ? got.reason : '当前类型没有可分享的内容', 'warn', 4200);
              return;
            }
            var res = buildCode(state.type, got.data, { at: new Date().toISOString() });
            if (!res) {
              /* 单类型超限（例如整库 4000 字符装不下）：同一条出路 */
              if (lastCodeError && lastCodeError.code === 'too-large') {
                escapeCard(partsOfType(state.type, got.data), lastCodeError.chars || 0,
                  lastCodeError.max || 0, true);
              }
              if (out) out.value = '';
              if (meta) meta.innerHTML = '';
              if (meterBox) meterBox.innerHTML = '';
              if (btnCopy) btnCopy.disabled = true;
              return;
            }
            state.code = res;
            showCode(res);
            toast((res.notes && res.notes.length) ? '已生成分享码（注意下面的提示）' : '已生成分享码',
              (res.notes && res.notes.length) ? 'warn' : 'ok', (res.notes && res.notes.length) ? 5200 : 1800);
            return;
          }

          if (act === 'copy') {
            if (!out || !out.value) { toast('先点「生成」', 'warn'); return; }
            copyFromField(out, function (ok) {
              toast(ok ? '分享码已复制到剪贴板' : '浏览器不允许自动复制，请手动全选复制',
                ok ? 'ok' : 'warn', ok ? 1800 : 4200);
            });
            return;
          }

          /* 导出 JSON：与生成分享码用的是**同一个信封**（parts 一模一样），
             只是序列化成文件。两种载体，一份内容。 */
          if (act === 'tojson') {
            var jparts;
            if (state.type === 'bundle') {
              jparts = selectedParts();
              var jn = 0, jk;
              for (jk in jparts) if (Object.prototype.hasOwnProperty.call(jparts, jk)) jn++;
              if (!jn) { toast('先勾至少一块内容（左边那些框）', 'warn', 4200); return; }
            } else {
              var jgot = gather(state.type, state.pickId);
              if (!jgot.ok) { toast(jgot.reason || '当前类型没有可分享的内容', 'warn', 4200); return; }
              jparts = partsOfType(state.type, jgot.data);
            }
            var jres;
            try {
              jres = BREW.ShareCode.encodeBundle(jparts, { at: new Date().toISOString() });
            } catch (e) {
              toast('导出失败：' + humanError(e), 'error', 5200);
              return;
            }
            downloadJSON(jres);
            return;
          }

          if (act === 'fromjson') {
            if (fileIn) { fileIn.value = ''; fileIn.click(); }
            else toast('这个浏览器的文件选择器打不开，请把 JSON 内容贴到上面的框里', 'warn', 3600);
            return;
          }

          /* 超限卡片上的那颗按钮：**用生成那一刻的 parts**，不重新收集 */
          if (act === 'tojson-now') {
            var ep = state.escapeParts;
            if (!ep) {
              toast('这一段内容已经不在了：请重新勾选后再生成', 'warn', 4200);
              return;
            }
            try {
              downloadJSON(bundleJSONOnly(ep));
            } catch (e3) {
              toast('导出失败：' + humanError(e3), 'error', 5200);
            }
            return;
          }

          if (act === 'bundle-none') {
            state.bundleSel = {};
            state.escapeParts = null;
            if (bundleBox) { bundleBox.classList.remove('is-compact'); bundleBox.removeAttribute('data-built'); }
            paintBundle();
            state.code = null;
            if (out) out.value = '';
            if (meta) meta.innerHTML = '';
            if (meterBox) meterBox.innerHTML = '';
            if (outWarn) outWarn.innerHTML = '';
            if (btnCopy) btnCopy.disabled = true;
            return;
          }

          if (act === 'paste') {
            var nav = root.navigator || {};
            if (!nav.clipboard || typeof nav.clipboard.readText !== 'function') {
              toast('当前浏览器不支持读取剪贴板，请手动粘贴（Ctrl+V）', 'warn', 3600);
              if (input) input.focus();
              return;
            }
            nav.clipboard.readText().then(function (t) {
              if (input) { input.value = String(t || ''); input.focus(); }
              /* 粘贴**只识别**，绝不落库 */
              detect();
            }, function () {
              toast('读取剪贴板被拒绝，请手动粘贴（Ctrl+V）', 'warn', 3600);
              if (input) input.focus();
            });
            return;
          }

          if (act === 'detect') {
            if (!input || !String(input.value || '').trim()) { toast('先把分享码粘贴到框里', 'warn'); return; }
            var d1 = detect();
            if (d1) toast('已识别，确认无误后点「确认导入」', 'info', 2600);
            return;
          }

          if (act === 'parse') {
            /* JSON 文件进来的预览：不再读输入框（那是空的），直接落库 */
            if (state.previewKind === 'json') {
              if (!state.preview) { toast('先选一个 JSON 分享文件', 'warn'); return; }
              finishImport();
              return;
            }
            /* 输入框改过（或还没识别过）就先识别一遍再落库 —— 「确认导入」这个动作
               本身就是确认，不再要求用户点两下。 */
            var raw = String((input && input.value) || '').trim();
            if (!raw) { toast('先把分享码粘贴到框里', 'warn'); return; }
            if (!state.preview || state.previewFor !== raw) {
              var got2 = detect();
              if (!got2) return;         /* 识别失败已经给出人话 */
            }
            finishImport();
            return;
          }
        });

        /** 落库并收尾。分享码与 JSON 文件走同一份：预览已经存进 state.preview。 */
        function finishImport() {
          var done = applyImport(state.preview);
          if (!done) return;
          toast(done, 'ok', 5200);
          if (msg) {
            msg.innerHTML = '<div class="alert alert--ok"><span class="alert__icon">' +
              icon('check', 13) + '</span><span>' + esc(done) + '</span></div>';
          }
          /* 单个配方导入后关窗（用户接下来要在配方页改/另存）；其余类型留着，
             让他能接着看预览、或再粘一段。分享包可能带配方也可能不带 ——
             一律留着，因为用户还要看"哪几块成功了"。 */
          if (state.preview.type === 'recipe') {
            a.close();
          } else {
            state.preview = null;
            state.previewKind = 'code';
            if (input) input.value = '';
            if (detectBox) detectBox.innerHTML = '';
          }
        }

        /* 输入框里改内容 → 重新识别（不写库）。这是"粘贴完不自动写入"的落地：
           这个监听只做识别，落库只发生在「确认导入」。 */
        if (input) {
          input.addEventListener('input', function () { detect(); });
          input.addEventListener('paste', function () { root.setTimeout(detect, 0); });
        }

        /* 下拉换了一条 → 重新算摘要（不自动生成码：用户点「生成」就是要那颗按钮） */
        if (pickWrap) {
          pickWrap.addEventListener('change', function (e) {
            var sel = e.target;
            if (!sel || sel.id !== 'share-pick') return;
            state.pickId = sel.value || '';
            paintSource();
            state.code = null;
            if (out) out.value = '';
            if (meta) meta.innerHTML = '';
            if (meterBox) meterBox.innerHTML = '';
            if (btnCopy) btnCopy.disabled = true;
          });
        }

        /* 勾选 / 全选 / 换酿造日那一锅 —— 都只更新估算，不自动生成码。 */
        if (bundleBox) {
          bundleBox.addEventListener('change', function (e) {
            var t = e.target;
            if (!t) return;
            if (t.id === 'shb-all') {
              var on = !!t.checked;
              var boxes = bundleBox.querySelectorAll('[data-shb]');
              for (var i = 0; i < boxes.length; i++) {
                var bx = boxes[i];
                var has = !bx.disabled;
                bx.checked = has && on;
                state.bundleSel[bx.getAttribute('data-shb')] = has && on;
                if (bx.parentNode && bx.parentNode.classList) {
                  bx.parentNode.classList.toggle('is-on', has && on);
                }
              }
              refreshEstimate();
            } else if (t.getAttribute('data-shb')) {
              var key = t.getAttribute('data-shb');
              state.bundleSel[key] = !!t.checked;
              var row = t.parentNode;
              if (row && row.classList) row.classList.toggle('is-on', !!t.checked);
              var allBox = bundleBox.querySelector('#shb-all');
              if (allBox) {
                var boxes2 = bundleBox.querySelectorAll('[data-shb]:not([disabled])');
                var checked = 0;
                for (var j = 0; j < boxes2.length; j++) if (boxes2[j].checked) checked++;
                allBox.checked = boxes2.length > 0 && checked === boxes2.length;
                allBox.indeterminate = checked > 0 && checked < boxes2.length;
              }
              refreshEstimate();
            } else if (t.id === 'shb-brewday') {
              state.bundleBrewdayId = String(t.value || '');
              bundleBox.removeAttribute('data-built');
              paintBundle();
            }
            /* 勾选一变，之前生成的码就过期了 —— 清掉，别让人复制走旧的 */
            state.code = null;
            state.escapeParts = null;
            if (bundleBox) bundleBox.classList.remove('is-compact');
            if (out) out.value = '';
            if (meta) meta.innerHTML = '';
            if (meterBox) meterBox.innerHTML = '';
            if (outWarn) outWarn.innerHTML = '';
            if (btnCopy) btnCopy.disabled = true;
          });
        }

        /* JSON 文件 → 读文本 → 与分享码同一条预览 */
        if (fileIn) {
          fileIn.addEventListener('change', function () {
            var f = fileIn.files && fileIn.files[0];
            if (!f) return;
            var fr = new FileReader();
            fr.onload = function () {
              previewJSON(String(fr.result || ''), f.name);
            };
            fr.onerror = function () {
              if (msg) {
                msg.innerHTML = '<div class="alert alert--warn"><span class="alert__icon">' + icon('alert', 13) +
                  '</span><span>读不了这个文件：可能是权限或编码问题，换个位置再试一次</span></div>';
              }
            };
            try {
              fr.readAsText(f, 'utf-8');
            } catch (e) {
              toast('这个浏览器读不了本地文件', 'warn', 4200);
            }
          });
        }

        paintPills();
        var first = paintSource();
        /* 打开就先把码生成出来（配方类型）：用户点「分享」就是想拿到码。
           其余类型不自动生成 —— 生成区会显示"将要分享什么"，让他先看清内容。 */
        if (first && first.ok && state.type === 'recipe') {
          var res0 = buildCode(state.type, first.data, { at: new Date().toISOString() });
          if (res0) { state.code = res0; showCode(res0); }
        } else if (meta) {
          /* 没有可分享内容时，上面那颗黄的「将要分享」已经把原因说清楚了，
             这里不再重复一遍 —— 同一句话出现两次，用户会以为漏看了什么。 */
          meta.innerHTML = (first && first.ok)
            ? '<span class="share-meta__item">点「生成」拿到码</span>'
            : '';
        }
        if (input) input.focus();
      }
    });

    return api;
  };

  /** 供功能区 / 其它模块调用：只要码文本，不弹窗（保持 v1.2 的旧签名） */
  Share.codeOf = function (recipe) {
    if (!BREW.ShareCode || typeof BREW.ShareCode.encode !== 'function') return '';
    try {
      var out = BREW.ShareCode.encode(recipe || UI.recipe());
      return (out && out.text) ? String(out.text) : '';
    } catch (e) {
      return '';
    }
  };

  /** 任意类型 → 码文本（不弹窗）。供测试与将来的批量导出用 */
  Share.codeOfAny = function (type, data, opts) {
    if (!BREW.ShareCode || typeof BREW.ShareCode.encodeAny !== 'function') return '';
    try {
      var out = BREW.ShareCode.encodeAny(type, data, opts || {});
      return (out && out.text) ? String(out.text) : '';
    } catch (e) {
      return '';
    }
  };

  Share.available = function () { return !!BREW.ShareCode; };
  /** 供功能区「分享」页签的入口：按类型打开分享中心 */
  Share.open = function (type, pickId) { return Share.openModal({ type: type, pickId: pickId }); };

  /** 最近一次"导出成文件"的信封（没有导出过时是 null）。
   *  存在的理由只有一个：让"导出的到底是哪几块"这件事可被验证。
   *  界面上看不出来（文件已经写到磁盘），但它是"超限改走文件"那条出路的
   *  **唯一可断言结果** —— 否则那条路只能靠"没报错"来判定，等于没测。 */
  Share.lastExport = function () { return lastExport; };

})(typeof window !== 'undefined' ? window : globalThis);
