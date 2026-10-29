/* ============================================================================
 * 风月酿研所 — 40-ui-shell.js
 * ----------------------------------------------------------------------------
 * 职责：
 *   1. 兼容层：当 00-core / 20-calc 等模块尚未就绪时，提供最小可用的
 *      Bus / Store / 计算内核，保证界面永不白屏（外部模块一旦存在则优先使用）。
 *   2. 全局工具：HTML 转义、数字格式化、原料查表、图标库。
 *   3. 应用骨架：导航注册与切换、顶栏指标胶囊、Toast、模态框、确认框。
 *
 * 依赖：无（本文件是 UI 层第一个加载的文件，必须自给自足）
 * 对外：BREW.UI.{esc,num,fmt,icon,db,byId,calc,publish,recipe,setRecipe,
 *                 store,debounce}
 *       BREW.UI.Shell.{registerView,go,refresh,toast,modal,confirm,syncTopbar}
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var Shell = UI.Shell = UI.Shell || {};

  /* ======================================================================
   * A. 兼容层
   * ====================================================================*/

  /* ---- A1. 事件总线 ---- */
  function makeBus() {
    var map = {};
    return {
      on: function (evt, fn) {
        if (typeof fn !== 'function') return;
        (map[evt] || (map[evt] = [])).push(fn);
      },
      off: function (evt, fn) {
        var arr = map[evt];
        if (!arr) return;
        if (!fn) { delete map[evt]; return; }
        var i = arr.indexOf(fn);
        if (i > -1) arr.splice(i, 1);
      },
      emit: function (evt, payload) {
        var arr = (map[evt] || []).slice();
        for (var i = 0; i < arr.length; i++) {
          try { arr[i](payload); } catch (e) { reportError(e, 'bus:' + evt); }
        }
        var all = (map['*'] || []).slice();
        for (var j = 0; j < all.length; j++) {
          try { all[j](evt, payload); } catch (e2) { reportError(e2, 'bus:*'); }
        }
      }
    };
  }
  if (!BREW.Bus || typeof BREW.Bus.emit !== 'function') BREW.Bus = makeBus();
  var Bus = BREW.Bus;

  /* ---- A2. 存储：优先用核心层 Store，缺失则退回 localStorage ---- */
  var LS_PREFIX = 'brewlab.v1.';

  function lsGet(key, def) {
    try {
      var raw = root.localStorage.getItem(LS_PREFIX + key);
      if (raw === null || raw === undefined) return def;
      return JSON.parse(raw);
    } catch (e) { return def; }
  }
  function lsSet(key, val) {
    try {
      root.localStorage.setItem(LS_PREFIX + key, JSON.stringify(val));
      return true;
    } catch (e) { return false; }
  }

  var store = UI.store = {
    get: function (key, def) {
      try { if (BREW.Store && typeof BREW.Store.get === 'function') {
        var v = BREW.Store.get(key, def);
        return (v === undefined) ? def : v;
      } } catch (e) { /* 落到本地实现 */ }
      return lsGet(key, def);
    },
    set: function (key, val) {
      try { if (BREW.Store && typeof BREW.Store.set === 'function') {
        BREW.Store.set(key, val);
        return true;
      } } catch (e) { /* 落到本地实现 */ }
      return lsSet(key, val);
    },

    recipes: function () {
      try {
        if (BREW.Store && typeof BREW.Store.listRecipes === 'function') {
          var a = BREW.Store.listRecipes();
          if (Array.isArray(a)) return a;
        }
      } catch (e) { /* ignore */ }
      var b = lsGet('recipes', []);
      return Array.isArray(b) ? b : [];
    },
    saveRecipe: function (r) {
      if (!r || !r.id) return false;
      try {
        if (BREW.Store && typeof BREW.Store.saveRecipe === 'function') {
          BREW.Store.saveRecipe(r);
          return true;
        }
      } catch (e) { /* ignore */ }
      var list = this.recipes().slice();
      var hit = -1;
      for (var i = 0; i < list.length; i++) { if (list[i] && list[i].id === r.id) { hit = i; break; } }
      if (hit > -1) list[hit] = r; else list.unshift(r);
      return lsSet('recipes', list);
    },
    removeRecipe: function (id) {
      try {
        if (BREW.Store && typeof BREW.Store.removeRecipe === 'function') BREW.Store.removeRecipe(id);
      } catch (e) { /* ignore */ }
      /* 若核心层实现未真正删掉（或无此 API），用列表过滤兜底 */
      var list = this.recipes();
      var left = [];
      var found = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) found = true; else left.push(list[i]);
      }
      if (found) lsSet('recipes', left);
      return true;
    },

    batches: function () {
      try {
        if (BREW.Store && typeof BREW.Store.listBatches === 'function') {
          var a = BREW.Store.listBatches();
          if (Array.isArray(a)) return a;
        }
      } catch (e) { /* ignore */ }
      var b = lsGet('batches', []);
      return Array.isArray(b) ? b : [];
    },
    saveBatch: function (b) {
      if (!b || !b.id) return false;
      try {
        if (BREW.Store && typeof BREW.Store.saveBatch === 'function') {
          BREW.Store.saveBatch(b);
          return true;
        }
      } catch (e) { /* ignore */ }
      var list = this.batches().slice();
      var hit = -1;
      for (var i = 0; i < list.length; i++) { if (list[i] && list[i].id === b.id) { hit = i; break; } }
      if (hit > -1) list[hit] = b; else list.unshift(b);
      return lsSet('batches', list);
    },
    removeBatch: function (id) {
      try {
        if (BREW.Store && typeof BREW.Store.removeBatch === 'function') BREW.Store.removeBatch(id);
      } catch (e) { /* ignore */ }
      var list = this.batches();
      var left = [];
      var found = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) found = true; else left.push(list[i]);
      }
      if (found) lsSet('batches', left);
      return true;
    }
  };

  /* ---- A3. 错误上报（放在最前，供各模块调用） ---- */
  function reportError(err, where) {
    var msg = (err && err.message) ? err.message : String(err);
    if (root.console && console.error) console.error('[BrewLab' + (where ? ' ' + where : '') + ']', err);
    if (Shell.toast && Shell._ready) Shell.toast('出错了：' + msg, 'error');
  }
  UI.reportError = reportError;

  /* 这里原来还有一份 PNG 写 pHYs 的实现（作者：team-lead）。
     后来发现 49-ui-label.js 已经有同一份实现（pngWithDpi → UI.pngWithDpi，
     还带自检：写完再解析一遍确认 ppm 与 IHDR 尺寸没变）。
     按"同一个映射只允许一个实现"的规矩，删掉这一份，统一用 49 的。
     它产出的是 data URL（不是 blob URL），调用方 55 也用同一个契约。 */

  /* ======================================================================
   * B. 通用工具
   * ====================================================================*/

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }
  UI.esc = esc;

  /** 属性值转义（比 esc 更严格：控制字符一律剔除） */
  function attr(s) {
    return esc(String(s === null || s === undefined ? '' : s).replace(/[\u0000-\u001f]/g, ''));
  }
  UI.attr = attr;

  /** 渲染带 **强调** 标记的富文本：先整体转义，再把 **x** 变成 <strong>x</strong>。
   *  原料 / 风格 / 知识卡 / 经典配方几个数据文件里大量使用了 Markdown 式的
   *  双星号强调（15-data-style 的 overall / key / fault，13-data-adjunct 的 note，
   *  14-data-water 的 effect / limit …）。直接 esc() 会在界面上露出星号，
   *  而这几个字段的文案是产品门面，不能带符号。所有可能含 ** 的字段都走这里。 */
  function md(s) {
    return esc(s).replace(/\*\*([^*\n]{1,80})\*\*/g, '<strong>$1</strong>');
  }
  UI.md = md;

  /** 同上，但剥成纯文本：给 title / aria-label / textContent 这类放不了标签的位置 */
  function plain(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/\*\*/g, '');
  }
  UI.plain = plain;

  /** 安全取数：非有限数一律回落默认值 */
  function num(v, def) {
    var n = (typeof v === 'number') ? v : parseFloat(v);
    return (isFinite(n)) ? n : (def === undefined ? 0 : def);
  }
  UI.num = num;

  /** 定点格式化，去掉无意义的尾零 */
  function fmt(v, digits) {
    var n = num(v, NaN);
    if (!isFinite(n)) return '—';
    var d = (digits === undefined) ? 1 : digits;
    var s = n.toFixed(d);
    if (d > 0 && s.indexOf('.') > -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  UI.fmt = fmt;

  /** 比重三位小数显示：1.056 */
  function sg(v) {
    var n = num(v, NaN);
    if (!isFinite(n) || n <= 0) return '—';
    return n.toFixed(3);
  }
  UI.sg = sg;

  /** 日期 → 2023-08-14 14:05 */
  function dt(ts, withTime) {
    var d = (ts instanceof Date) ? ts : new Date(ts);
    if (isNaN(d.getTime())) return '—';
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    var s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    if (withTime) s += ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    return s;
  }
  UI.dt = dt;

  function todayInput() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  UI.todayInput = todayInput;

  function uid(prefix) {
    var rnd = Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + rnd;
  }
  UI.uid = uid;

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, num(v, lo))); }
  UI.clamp = clamp;

  function debounce(fn, ms) {
    var t = 0;
    return function () {
      var args = arguments, self = this;
      if (t) root.clearTimeout(t);
      t = root.setTimeout(function () { t = 0; fn.apply(self, args); }, ms || 150);
    };
  }
  UI.debounce = debounce;

  function sum(arr, pick) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += num(pick ? pick(arr[i], i) : arr[i], 0);
    return t;
  }
  UI.sum = sum;

  /* ======================================================================
   * C. 原料库访问（全部做空值防护，数据未加载时返回空数组）
   * ====================================================================*/

  var DB_KEYS = ['malts', 'hops', 'yeasts', 'adjuncts', 'waterSalts', 'styles',
    'maltCats', 'hopCats', 'yeastCats', 'adjunctCats', 'saltCats'];

  function db() { return (BREW.DB = BREW.DB || {}); }
  UI.db = db;

  UI.list = function (kind) {
    var d = db();
    var arr = d[kind];
    return Array.isArray(arr) ? arr : [];
  };

  var idCache = null;
  function idMaps() {
    if (idCache) return idCache;
    idCache = {};
    var kinds = ['malts', 'hops', 'yeasts', 'adjuncts', 'waterSalts', 'styles'];
    for (var i = 0; i < kinds.length; i++) {
      var m = {}, arr = UI.list(kinds[i]);
      for (var j = 0; j < arr.length; j++) {
        if (arr[j] && arr[j].id) m[arr[j].id] = arr[j];
      }
      /* 旧编号别名（目前只有 styles 用）：BJCP 改编号后，用户早先存下的配方
         里 styleId 还是旧 id。不建这个索引，下拉框会显示成空、风格匹配永远缺失，
         而数据本身是对的——这类"静默降级"最难发现。 */
      for (var a = 0; a < arr.length; a++) {
        var alts = arr[a] && arr[a].altIds;
        if (!alts) continue;
        for (var b = 0; b < alts.length; b++) {
          if (alts[b] && !m[alts[b]]) m[alts[b]] = arr[a];
        }
      }
      /* 自建原料覆盖同名（自建优先，用户可能用自建值修正内置值） */
      if (i < 4) {
        var cu = UI.customList(kinds[i]);
        for (var c = 0; c < cu.length; c++) {
          if (cu[c] && cu[c].id) m[cu[c].id] = cu[c];
        }
      }
      idCache[kinds[i]] = m;
    }
    return idCache;
  }
  UI.invalidateDB = function () { idCache = null; };

  /** byId('malts', 'm-2row') → 原料对象或 null */
  UI.byId = function (kind, id) {
    var maps = idMaps();
    return (maps[kind] && maps[kind][id]) || null;
  };

  /** 取原料显示名，找不到时给出可读占位而不是 undefined */
  UI.nameOf = function (kind, id) {
    var o = UI.byId(kind, id);
    return o ? o.name : (id ? '（缺失：' + id + '）' : '未选择');
  };

  /* 允许用户自建原料覆盖内置库 */
  var CUSTOM_KEY = 'customIngredients';
  UI.customList = function (kind) {
    var all = store.get(CUSTOM_KEY, {}) || {};
    var arr = all[kind];
    return Array.isArray(arr) ? arr : [];
  };
  UI.saveCustom = function (kind, item) {
    var all = store.get(CUSTOM_KEY, {}) || {};
    var arr = Array.isArray(all[kind]) ? all[kind].slice() : [];
    var found = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === item.id) { arr[i] = item; found = true; break; }
    }
    if (!found) arr.unshift(item);
    all[kind] = arr;
    store.set(CUSTOM_KEY, all);
    UI.invalidateDB();
  };
  /** 内置 + 自建，用于下拉检索 */
  UI.pool = function (kind) {
    return UI.list(kind).concat(UI.customList(kind));
  };
  /* ======================================================================
   * D. 配方状态（当前工作副本）
   * ----------------------------------------------------------------------
   * 字段与 BREW.Recipe / BREW.Calc 完全一致：
   *   fermentables[].amount / hops[].amount+time / yeasts[].att /
   *   water.source + water.salts / mash.steps[].minutes / carbonation.targetVol
   * 不再自带一套别名，否则计算公式与保存结果会对不上。
   * normalizeRecipe 负责把任何来源（旧版 localStorage、外部模块）
   * 的对象补齐成安全可渲染的形状，每一行都带参数快照。
   * ====================================================================*/

  var BLANK = {
    id: '', name: '未命名配方', styleId: '', author: '', notes: '',
    createdAt: 0, updatedAt: 0, rev: 1, parentId: null,

    /* 设备参数 */
    batchSize: 20, efficiency: 72, evaporationRate: 10, boilTime: 60,
    trubLoss: 1.5, fermenterLoss: 0.8, grainAbsorption: 0.85,
    hopAbsorption: 1.6, mashThickness: 3, fermentTemp: 19,

    fermentables: [], hops: [], yeasts: [], adjuncts: [],

    water: { profileId: null, source: { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0 }, salts: [] },
    mash: { steps: [] },
    carbonation: { targetVol: 2.4, tempC: 20, sugarType: 'sucrose' },
    targets: { og: null, fg: null, abv: null, ibu: null, srm: null }
  };

  function arr(v) { return Array.isArray(v) ? v : []; }

  /** 从库里补齐一行原料缺失的快照字段（老配方或外部来源可能没写全） */
  function snapshotFermentable(row) {
    var id = row.id || row.ingId || row.maltId || '';
    var ing = id ? UI.byId('malts', id) : null;
    return {
      id: id,
      name: row.name || (ing ? ing.name : '') || '（未知原料）',
      en: row.en || (ing ? ing.en || '' : ''),
      cat: row.cat || (ing ? ing.cat : '') || 'base',
      origin: row.origin || (ing ? ing.origin || '' : ''),
      amount: Math.max(0, num(row.amount !== undefined ? row.amount : row.kg, 0)),
      unit: row.unit || 'kg',
      ppg: isFinite(num(row.ppg, NaN)) ? num(row.ppg, 0) : (ing ? num(ing.ppg, 0) : 0),
      lov: isFinite(num(row.lov, NaN)) ? num(row.lov, 0) : (ing ? num(ing.lov, 0) : 0),
      mustMash: row.mustMash !== undefined ? !!row.mustMash : (ing ? ing.mustMash !== false : true),
      fermentable: row.fermentable !== undefined ? row.fermentable : (ing ? ing.fermentable : null),
      maxPct: row.maxPct !== undefined ? row.maxPct : (ing ? ing.maxPct : null),
      custom: !!row.custom
    };
  }

  function snapshotHop(row) {
    var id = row.id || row.ingId || row.hopId || '';
    var ing = id ? UI.byId('hops', id) : null;
    /* 阶段词表归一。**这里是全项目唯一的收口点**：
       数据/旧配方/外部导入里 'dry' 与 'dryhop' 两种写法都出现过
       （31 曾有一条 ['h-cascade', 20, 'dry', 0]），而 42 的阶段下拉只有
       value='dryhop'、20-calc 的干投判定也只认 'dryhop'。
       不归一的话，那一行在下拉里匹配不到选项会显示成"煮沸"——
       用户会以为这 20g 是煮沸投的，照着做就多了一锅苦。
       统一成 'dryhop' 之后，下拉、IBU、干投量预算三处才对得上。 */
    var stage = String(row.stage || 'boil');
    if (stage === 'dry' || stage === 'dry_hop' || stage === 'dryHop') stage = 'dryhop';
    return {
      id: id,
      name: row.name || (ing ? ing.name : '') || '（未知酒花）',
      en: row.en || (ing ? ing.en || '' : ''),
      type: row.type || (ing ? ing.type : ''),
      amount: Math.max(0, num(row.amount !== undefined ? row.amount : row.g, 0)),
      unit: row.unit || 'g',
      aa: isFinite(num(row.aa, NaN)) ? num(row.aa, 0) : (ing ? num(ing.aa, 0) : 0),
      stage: stage,
      time: num(row.time !== undefined ? row.time : row.min,
        stage === 'dryhop' ? 3 : 60),
      /* v1.7：回旋温度必须带下去。20-calc 的利用率按它分两档（85°C 以上 0.35 /
         以下 0.40 量级），丢了它 = 每一份经典配方的 IBU 都偏高一截，
         而且**不报错**：数字看起来仍然合理。这条是 tools/test-combo.js 抓到的
         （入门配方 66.5 IBU vs 经典 65.0 IBU，同一份配方只差一次 normalize）。 */
      whirlpoolTemp: (row.whirlpoolTemp === null || row.whirlpoolTemp === undefined || row.whirlpoolTemp === '')
        ? null : num(row.whirlpoolTemp, 0),
      custom: !!row.custom
    };
  }

  /**
   * @param {object} row        配方里的酵母行
   * @param {number} recipeTemp 配方级发酵温度（°C）。**必须由调用方传进来**：
   *   snapshotYeast 在 normalizeRecipe 之前定义、拿不到半成品配方对象，
   *   而这一行的"温度"语义就是"这锅酒的发酵温度"，配方级没给就该继承配方级。
   *   原来这里读的是 `row.fermentTemp`（酵母行自己的字段，代码里从没有人赋值），
   *   于是 49 条经典配方在详情页一律显示 19°C——连 10–12°C 的拉格也一样，
   *   那不是"显示不准"，是会让人照着做错（拉格在 19°C 发酵是另一款酒）。
   */
  /* 酵母衰减度的**唯一取数口**（v2.0）。
     为什么需要它：内置酵母（12-data-yeast）字段叫 `att`，而**早期版本的自建条目
     存的是 `atten`**，两个名字指的是同一件事（表观衰减度 ADF%）。
     任何一处只读 `row.att` 而不回退 `atten`，遇到那种老数据就会静默按默认 75% 算——
     FG 与 ABV 跟着错，而且不报错、不标红，用户只会觉得"这软件算得不对"。
     所以：**新代码一律走这里**，不要再在别处写 `x.att !== undefined ? x.att : x.atten`。
     @param {Object} row      酵母行 / 自建条目 / 经典库里的酵母对象，都可以
     @param {number} fallback 都没有时用（默认 75）
     @returns {number} 0–100 之间的数
  */
  UI.yeastAtt = function (row, fallback) {
    var fb = isFinite(num(fallback, NaN)) ? num(fallback, 75) : 75;
    if (!row || typeof row !== 'object') return fb;
    var v = (row.att !== undefined && row.att !== null) ? row.att
      : (row.atten !== undefined && row.atten !== null) ? row.atten
        : NaN;
    if (!isFinite(num(v, NaN))) return fb;
    return clamp(num(v, fb), 0, 100);
  };

  function snapshotYeast(row, recipeTemp) {
    var id = row.id || row.ingId || row.yeastId || '';
    var ing = id ? UI.byId('yeasts', id) : null;
    return {
      id: id,
      name: row.name || (ing ? ing.name : '') || '（未选菌株）',
      en: row.en || (ing ? ing.en || '' : ''),
      lab: row.lab || (ing ? ing.lab || '' : ''),
      type: row.type || (ing ? ing.type : 'ale') || 'ale',
      /* 走唯一取数口：行上的 att / 老字段 atten / 原料库里的 att，三级回落都在里面 */
      att: UI.yeastAtt(row, ing ? num(ing.att, 75) : 75),
      amount: Math.max(0, num(row.amount, 11)),
      unit: row.unit || 'g',
      /* 优先级：行自己填过的温度 > 行级 fermentTemp（老数据可能这么写）> 配方级 > 19 */
      tempC: num(row.tempC !== undefined ? row.tempC
        : (row.fermentTemp !== undefined ? row.fermentTemp : recipeTemp), 19),
      tempMin: row.tempMin !== undefined ? row.tempMin : (ing ? ing.tempMin : null),
      tempMax: row.tempMax !== undefined ? row.tempMax : (ing ? ing.tempMax : null),
      custom: !!row.custom
    };
  }

  function snapshotAdjunct(row) {
    var id = row.id || row.ingId || '';
    var ing = id ? UI.byId('adjuncts', id) : null;
    return {
      id: id,
      name: row.name || (ing ? ing.name : '') || '（未知辅料）',
      en: row.en || (ing ? ing.en || '' : ''),
      cat: row.cat || (ing ? ing.cat : '') || 'other',
      amount: Math.max(0, num(row.amount !== undefined ? row.amount : row.g, 0)),
      unit: row.unit || (ing ? ing.unit || 'g' : 'g'),
      stage: row.stage || (ing ? ing.stage : '') || 'boil',
      note: row.note || '',
      extraSugarPct: num(row.extraSugarPct, 0),
      custom: !!row.custom
    };
  }

  function snapshotSalt(row) {
    var id = row.id || row.ingId || '';
    var ing = id ? UI.byId('waterSalts', id) : null;
    return {
      id: id,
      name: row.name || (ing ? ing.name : '') || '（未知盐类）',
      amount: Math.max(0, num(row.amount !== undefined ? row.amount : row.g, 0)),
      /* 单位必须跟着**库里的盐**走，不能硬编码 'g'：
         w-lactic / w-phosphoric 在 14-data-water.js 里是 'ml'，88% 乳酸密度约 1.2，
         把 2 ml 写成 2 g 等于少算 20%——而调 pH 的加酸量本来就该精确到 0.1 ml。
         优先级：**库 > 行 > 'g'**。库优先是有意的：这个字段不是用户可编辑的
         （42 的水化学表只让改克数，单位是跟着盐种显示的），所以对已知盐种，
         行里那个 unit 往往是流程里顺手写进来的 'g'（42 的 add-salt 原来就这么写），
         让行优先会把乳酸又写回 'g'。未知盐种（自定义）才退回行里的值。 */
      unit: (ing && ing.unit) ? ing.unit
        : ((row.unit === 'ml' || row.unit === 'g') ? row.unit : 'g')
    };
  }

  function normalizeRecipe(src) {
    var s = (src && typeof src === 'object') ? src : {};

    /* 兼容旧字段：malts / evapRate / carbVol / mashSteps / water 平铺离子 */
    var srcMalts = arr(s.fermentables).length ? s.fermentables : arr(s.malts);
    var srcMash = arr(s.mash && s.mash.steps).length ? s.mash.steps : arr(s.mashSteps);
    var srcSalts = arr(s.water && s.water.salts).length ? s.water.salts : arr(s.salts);
    var srcWater = (s.water && s.water.source) ? s.water.source : (s.water || {});
    var srcCarb = s.carbonation || {};

    /* 配方级发酵温度：算一次，既给字段用、也给酵母行的温度兜底用。
       **不能在 snapshotYeast 里自己去读 Store 或再 normalize 一遍**——
       那样同一锅酒会出现两个"配方级温度"。 */
    var fermentTempC = clamp(num(s.fermentTemp, 19), 5, 40);

    var r = {
      id: s.id || uid('recipe'),
      name: s.name || '未命名配方',
      styleId: s.styleId || '',
      author: s.author || '',
      notes: s.notes || '',
      createdAt: num(s.createdAt, 0) || Date.now(),
      updatedAt: num(s.updatedAt, 0) || Date.now(),
      rev: num(s.rev, 1),
      parentId: s.parentId || null,

      batchSize: clamp(num(s.batchSize, 20), 1, 500),
      efficiency: clamp(num(s.efficiency, 72), 10, 100),
      evaporationRate: clamp(num(s.evaporationRate !== undefined ? s.evaporationRate : s.evapRate, 10), 0, 40),
      boilTime: clamp(num(s.boilTime, 60), 5, 240),
      trubLoss: clamp(num(s.trubLoss, 1.5), 0, 20),
      fermenterLoss: clamp(num(s.fermenterLoss, 0.8), 0, 20),
      grainAbsorption: clamp(num(s.grainAbsorption, 0.85), 0.3, 2),
      hopAbsorption: clamp(num(s.hopAbsorption, 1.6), 0, 10),
      mashThickness: clamp(num(s.mashThickness, 3), 1.5, 6),
      fermentTemp: fermentTempC,

      fermentables: srcMalts.map(snapshotFermentable),
      hops: arr(s.hops).map(snapshotHop),
      /* 把配方级温度传进去：酵母行的"温度"就是这锅酒的发酵温度 */
      yeasts: arr(s.yeasts || s.yeast).map(function (y) { return snapshotYeast(y, fermentTempC); }),
      adjuncts: arr(s.adjuncts).map(snapshotAdjunct),

      water: {
        profileId: (s.water && s.water.profileId) || null,
        source: {
          ca: num(srcWater.ca, 0), mg: num(srcWater.mg, 0), na: num(srcWater.na, 0),
          cl: num(srcWater.cl, 0), so4: num(srcWater.so4, 0), hco3: num(srcWater.hco3, 0)
        },
        salts: srcSalts.map(snapshotSalt)
      },

      mash: {
        steps: srcMash.map(function (m) {
          return {
            name: m.name || '休止',
            tempC: num(m.tempC !== undefined ? m.tempC : m.temp, 66),
            minutes: num(m.minutes !== undefined ? m.minutes : m.min, 60)
          };
        })
      },

      carbonation: {
        targetVol: clamp(num(srcCarb.targetVol !== undefined ? srcCarb.targetVol : s.carbVol, 2.4), 0.5, 6),
        /* 这里的 20 和 fermentTemp 的 19 **不是同一个东西，也不该统一**：
           它是"算残余 CO₂ 时假设的发酵最高温度"，按偏高的 20°C 估更保守
           （残余 CO₂ 估高了 → 需要补的糖就估少了 → 不容易过碳化）。
           发酵温度（fermentTemp）是实际工艺参数，缺省 19°C。两者语义不同。 */
        tempC: num(srcCarb.tempC, 20),
        sugarType: srcCarb.sugarType || 'sucrose'
      },

      /* targets **故意不做归一**：它是自由结构（现在放 og/fg/abv/ibu/srm，
         将来可能加别的目标），逐字段 num 化会把未知字段吃掉。
         代价是外部导入的字符串会原样带下去——读的地方一律过 num() 兜底即可。 */
      targets: s.targets && typeof s.targets === 'object' ? s.targets
        : { og: null, fg: null, abv: null, ibu: null, srm: null }
    };

    if (!r.name) r.name = '未命名配方';
    return r;
  }
  UI.normalizeRecipe = normalizeRecipe;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  UI.clone = clone;

  var currentRecipe = null;

  UI.recipe = function () {
    if (!currentRecipe) currentRecipe = UI.blankRecipe();
    return currentRecipe;
  };
  UI.setRecipe = function (r) {
    currentRecipe = normalizeRecipe(r);
    return currentRecipe;
  };

  /** 新建空白配方：优先用 BREW.Recipe.blank()，但必经归一化 */
  UI.blankRecipe = function () {
    var raw = null;
    try {
      if (BREW.Recipe && typeof BREW.Recipe.blank === 'function') raw = BREW.Recipe.blank();
    } catch (e) { raw = null; }
    var r = normalizeRecipe(raw || clone(BLANK));
    r.id = uid('r');
    r.createdAt = Date.now();
    r.updatedAt = Date.now();
    /* 空白配方给一套单步糖化，避免用户面对空表无从下手 */
    if (!r.mash.steps.length) {
      r.mash.steps = [
        { name: '糖化', tempC: 66, minutes: 60 },
        { name: '出糖', tempC: 76, minutes: 10 }
      ];
    }
    return r;
  };

  /** 计算并广播：所有视图改完配方都调这一个函数 */
  UI.publish = function (opts) {
    var r = UI.recipe();
    r.updatedAt = Date.now();
    var c = UI.calc(r);
    UI.lastCalc = c;
    if (Shell.syncTopbar) Shell.syncTopbar(r, c);
    Bus.emit('recipeChanged', { recipe: r, calc: c });
    if (!opts || opts.persist !== false) UI.autosave();
    return c;
  };

  /* 工作副本自动落盘（防止刷新丢内容），正式保存仍需按钮 */
  var autosaveTimer = 0;
  UI.autosave = function () {
    if (autosaveTimer) root.clearTimeout(autosaveTimer);
    autosaveTimer = root.setTimeout(function () {
      autosaveTimer = 0;
      try { store.set('working', UI.recipe()); } catch (e) { /* 配额满等异常忽略 */ }
    }, 400);
  };
  UI.loadWorking = function () {
    var saved = store.get('working', null);
    if (saved && typeof saved === 'object') return UI.setRecipe(saved);
    var list = store.recipes();
    if (list.length) return UI.setRecipe(list[0]);
    return UI.setRecipe(UI.blankRecipe());
  };

  /* ======================================================================
   * E. 计算内核（BREW.Calc 优先；缺失或不合理时用内置估算兜底）
   * ====================================================================*/

  function stageGlue(stage) {
    /* 投放阶段 → 等效煮沸接触时间系数（内置 Tinseth 估算用） */
    var s = String(stage || '').toLowerCase();
    if (s === 'firstwort' || s === 'fwh' || s === 'first_wort') return { mult: 1.12, fixed: 0 };
    if (s === 'mash') return { mult: 1.0, fixed: 0 };
    if (s === 'whirlpool' || s === 'flameout') return { mult: 0, fixed: 0.06 };
    if (s === 'dryhop' || s === 'dry') return { mult: 0, fixed: 0 };
    return null;
  }
  UI.stageGlue = stageGlue;

  /* SRM → 屏幕色。
     ⚠️ v1.2 修（顾图南发现，顺手把重复表也删了）：
     这段原来自己维护一张 14 个色标的表，插值写成
        Math.round(ca[0] + (cb[0] - ca[0]) * t)
     而 ca/cb 来自 'rgb(...)'.match(/\d+/g)，是**字符串**。字符串 + 数字 =
     字符串拼接，于是 '255' + 44 得到 '25544'，Math.round('255-30.25') 得到 NaN。
     结果这个函数从上线起**没产出过一个正确颜色**：不是 NaN 就是两万多的通道值。
     一直没人发现，是因为非法 CSS 会被浏览器静默丢弃（色点变透明），
     而 toHex() 遇到 m.length<3 又会兜底成同一个棕色 —— 于是"淡色拉格"和
     "帝国世涛"的颜色标记长得一模一样，看起来像刻意的设计。

     修法不是把那段算式改对，而是**删掉这张表**：00-core 的 BREW.color
     早就有一份正确实现（数值数组 + clamp 0–40），20-calc 和 48-charts
     都在用它。两份表并存 = 同一锅酒在配方卡和图表上是两个颜色。
     现在统一走 BREW.color，40/48/55 三处终于同色。

     另：顾图南指出返回值是 'rgb(r,g,b)' 而函数叫 hexFromSrm，名不符实
     （光看名字会以为能直接塞进 canvas 或 JSON）。这个名字已被 44 / 50 / 55
     和几个测试脚本调用，直接改名牵动面太大，所以：
       · 诚实名 UI.colorOfSrm() 是唯一实现，**新代码一律用它**；
       · hexFromSrm 只保留为别名转发，不再有自己的实现。 */
  function colorOfSrm(srm) {
    var C = (BREW && BREW.color) || null;
    if (C && typeof C.fromSRM === 'function') return C.fromSRM(srm);
    /* 00-core 没载入时的兜底：不猜颜色，给一个中性沙色 */
    return 'rgb(200,134,47)';
  }
  UI.colorOfSrm = colorOfSrm;
  /** @deprecated 用 UI.colorOfSrm()。返回 rgb() 字符串，不是 hex。 */
  UI.hexFromSrm = colorOfSrm;

  function toHex(rgb) {
    var m = String(rgb).match(/\d+/g);
    if (!m || m.length < 3) return '#c8862f';
    return '#' + m.slice(0, 3).map(function (x) {
      /* 夹到 0–255：不夹的话 2550 会 toString(16) 成 '9f6'，拼出 '#9f6....'
         这种长度错位的非法色值，比兜底色更难查 */
      var n = Math.max(0, Math.min(255, Math.round(num(x, 0))));
      var h = n.toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }

  /** 风格区间字段兼容读取（15-data-style 的字段命名可能是数组或成对字段） */
  function styleRange(style, field) {
    if (!style) return null;
    var v = style[field];
    if (Array.isArray(v) && v.length >= 2) return { lo: num(v[0], NaN), hi: num(v[1], NaN) };
    if (v && typeof v === 'object') {
      if (v.min !== undefined && v.max !== undefined) return { lo: num(v.min, NaN), hi: num(v.max, NaN) };
      if (v.lo !== undefined && v.hi !== undefined) return { lo: num(v.lo, NaN), hi: num(v.hi, NaN) };
    }
    if (style[field + 'Min'] !== undefined && style[field + 'Max'] !== undefined) {
      return { lo: num(style[field + 'Min'], NaN), hi: num(style[field + 'Max'], NaN) };
    }
    if (style[field + 'Range'] && Array.isArray(style[field + 'Range'])) {
      return { lo: num(style[field + 'Range'][0], NaN), hi: num(style[field + 'Range'][1], NaN) };
    }
    return null;
  }
  UI.styleRange = styleRange;

  /** 内置估算内核：口径与 20-calc 一致（Tinseth / Morey / 糖总量守恒） */
  function fallbackCalc(r) {
    /* v1.7：数组先兜底。这不是"防御式编程洁癖"——真的有对象会缺这几段：
       分享码导进来的批次，它的 recipeSnapshot 由对方的数据重建；跨版本导入的
       配方也可能只有若干行。原来这里直接 r.fermentables.length，缺一个就抛
       TypeError，被 UI.calc 兜住后整份计算退化成全 0，同时往控制台写一条
       [BrewLab fallbackCalc]。计算退化还能忍，"控制台有错"会让每一次验收
       都失去意义。 */
    var fermentables = r && r.fermentables ? r.fermentables : [];
    var hops = r && r.hops ? r.hops : [];
    var adjuncts = r && r.adjuncts ? r.adjuncts : [];
    var yeasts = r && r.yeasts ? r.yeasts : [];
    var V = clamp(num(r.batchSize, 20), 1, 500);
    var eff = clamp(num(r.efficiency, 72), 10, 100) / 100;
    var evapPctPerH = clamp(num(r.evaporationRate, 10), 0, 40) / 100;
    var boilMin = clamp(num(r.boilTime, 60), 5, 240);
    var evapFrac = evapPctPerH * (boilMin / 60);
    var postBoil = V;
    var preBoil = postBoil / Math.max(0.55, 1 - evapFrac);

    var totalGrainKg = 0, ogPoints = 0, mcu = 0;
    var ogContribution = [], srmContribution = [], warnings = [];

    for (var i = 0; i < fermentables.length; i++) {
      var m = fermentables[i];
      var kg = Math.max(0, num(m.amount, 0));
      if (kg <= 0) continue;
      totalGrainKg += kg;
      var ppg = num(m.ppg, 0);
      var lov = num(m.lov, 0);
      var factor = m.mustMash === false ? 1 : eff;
      var pts = ppg * kg * 8.345 * factor / postBoil;
      ogPoints += pts;
      ogContribution.push({ id: m.id, name: m.name, points: pts, amount: kg });
      var mcuVal = lov * kg * 2.20462 / (postBoil / 3.78541);
      mcu += mcuVal;
      srmContribution.push({ id: m.id, name: m.name, mcu: mcuVal });

      if (m.maxPct) {
        var pct = totalGrainKg > 0 ? kg / totalGrainKg * 100 : 0;
        if (pct > m.maxPct + 0.01) {
          warnings.push({
            level: 'warn',
            text: m.name + ' 占比 ' + fmt(pct, 1) + '%，超过建议上限 ' + m.maxPct + '%'
          });
        }
      }
    }

    var og = 1 + ogPoints / 1000;
    var srm = mcu > 0 ? 1.4922 * Math.pow(mcu, 0.6859) : 0;

    var ye = yeasts[0];
    var atten = ye ? clamp(num(ye.att, 75), 30, 100) : 75;
    var fg = 1 + (og - 1) * (1 - atten / 100);
    var abv = (og - fg) * 131.25;
    var abwHall = 76.08 * (og - fg) / (1.775 - og);
    var abvHall = abwHall * (fg / 0.794);

    /* Tinseth：以煮沸后比重为基准，与 20-calc 一致 */
    var ibu = 0, ibuContribution = [];
    var boilPts = preBoil > 0 ? ogPoints * postBoil / preBoil : ogPoints;
    var bigness = 1.65 * Math.pow(0.000125, boilPts / 1000) / 4.25;
    for (var j = 0; j < hops.length; j++) {
      var h = hops[j];
      var g = Math.max(0, num(h.amount, 0));
      if (g <= 0) continue;
      var aa = num(h.aa, 0);
      var min = num(h.time, 60);
      var glue = stageGlue(h.stage);
      var util;
      if (glue && glue.fixed > 0) util = glue.fixed;
      else if (glue && glue.mult === 0) util = 0;
      else util = bigness * (1 - Math.exp(-0.04 * min * (glue ? glue.mult : 1)));
      var ibuVal = (g * (aa / 100) * 1000 / postBoil) * util;
      ibu += ibuVal;
      ibuContribution.push({
        id: h.id, name: h.name, amount: g, aa: aa, time: min,
        stage: h.stage, ibu: ibuVal
      });
    }

    var grainAbsorption = totalGrainKg * num(r.grainAbsorption, 0.85);
    var hopG = 0;
    for (var k = 0; k < hops.length; k++) hopG += Math.max(0, num(hops[k].amount, 0));
    var hopAbsorption = hopG / 1000 * num(r.hopAbsorption, 1.6);
    var mashWater = totalGrainKg > 0 ? totalGrainKg * clamp(num(r.mashThickness, 3), 1.5, 6) : 0;
    var spargeWater = Math.max(0, preBoil + grainAbsorption - mashWater);
    var totalWater = mashWater + spargeWater;
    var evaporation = Math.max(0, preBoil - postBoil);

    /* 水化学：盐离子口径是"每克每 20L"，按批次量缩放 */
    var src = r.water.source;
    var ion = {
      ca: num(src.ca, 0), mg: num(src.mg, 0), na: num(src.na, 0),
      cl: num(src.cl, 0), so4: num(src.so4, 0), hco3: num(src.hco3, 0)
    };
    for (var s2 = 0; s2 < r.water.salts.length; s2++) {
      var sl = r.water.salts[s2];
      var amt = Math.max(0, num(sl.amount, 0));
      if (amt <= 0) continue;
      var def = UI.byId('waterSalts', sl.id);
      if (!def || !def.ion) continue;
      var scale = 20 / postBoil;
      ['ca', 'mg', 'na', 'cl', 'so4', 'hco3'].forEach(function (key) {
        ion[key] += num(def.ion[key], 0) * amt * scale;
      });
    }
    var ra = 0.8197 * ion.hco3 - ion.ca / 3.5 - ion.mg / 7;
    var so4cl = ion.cl > 0 ? ion.so4 / ion.cl : (ion.so4 > 0 ? 99 : 0);
    var mashPh = clamp(5.4 + (ra / 100) * 0.32 - Math.min(0.55, srm * 0.0075), 4.7, 6.2);

    var targetVol = clamp(num(r.carbonation.targetVol, 2.4), 1, 5);
    var carbTemp = num(r.carbonation.tempC, 20);
    var residual = 0.00086 * carbTemp * carbTemp - 0.05952 * carbTemp + 1.7077;
    var need = Math.max(0, targetVol - residual);
    var carbonation = {
      targetVol: targetVol, residualVol: residual,
      grams: {
        sucrose: need * postBoil * 3.82,
        dextrose: need * postBoil * 4.42,
        dme: need * postBoil * 5.6
      },
      sugarGrams: {
        sucrose: need * postBoil * 3.82,
        dextrose: need * postBoil * 4.42,
        dme: need * postBoil * 5.6
      }
    };

    /* 风格匹配 */
    var styleMatch = null;
    var style = r.styleId ? UI.byId('styles', r.styleId) : null;
    if (style) {
      var checks = [
        { field: 'og', label: 'OG', actual: og, weight: 1.2, kind: 'sg' },
        { field: 'fg', label: 'FG', actual: fg, weight: 0.6, kind: 'sg' },
        { field: 'ibu', label: 'IBU', actual: ibu, weight: 1.1, kind: 'num' },
        { field: 'srm', label: 'SRM', actual: srm, weight: 0.9, kind: 'num' },
        { field: 'abv', label: 'ABV', actual: abv, weight: 1.0, kind: 'num' }
      ];
      var devs = [], got = 0, total = 0;
      for (var c1 = 0; c1 < checks.length; c1++) {
        var ck = checks[c1];
        var rg = styleRange(style, ck.field);
        if (!rg || !isFinite(rg.lo) || !isFinite(rg.hi)) continue;
        total += ck.weight;
        var ok = ck.actual >= rg.lo && ck.actual <= rg.hi;
        var span = Math.max(0.0001, rg.hi - rg.lo);
        var over = ck.actual < rg.lo ? (rg.lo - ck.actual) : (ck.actual - rg.hi);
        var score = ok ? 1 : Math.max(0, 1 - over / span);
        got += score * ck.weight;
        devs.push({
          field: ck.label, actual: ck.actual, range: rg,
          verdict: ok ? 'ok' : (ck.actual < rg.lo ? 'low' : 'high'), score: score
        });
      }
      styleMatch = {
        styleId: r.styleId,
        styleName: style.name || r.styleId,
        score: total > 0 ? Math.round(got / total * 100) : 0,
        deviations: devs
      };
    }

    if (!fermentables.length || totalGrainKg <= 0) {
      warnings.unshift({ level: 'error', text: '还没有麦芽，无法计算糖度。先在麦芽表里添加基础麦芽。' });
    }
    if (!yeasts.length) {
      warnings.push({ level: 'warn', text: '未选择酵母，衰减度按 75% 默认值估算。' });
    }
    if (!hops.length) {
      warnings.push({ level: 'info', text: '没有酒花，苦度将为 0；多数风格需要至少一次苦化投放。' });
    }
    if (V < 18 || V > 22) {
      warnings.push({ level: 'info', text: '批次量 ' + fmt(V, 1) + ' L 偏离家用设备常见区间 18–22 L，注意锅具容量。' });
    }
    if (og > 1.095) {
      warnings.push({ level: 'warn', text: 'OG 达到 ' + sg(og) + '，需注意酵母接种量与溶氧，建议做酵母扩培。' });
    }

    var buGu = ogPoints > 0 ? ibu / ogPoints : 0;

    return {
      og: og, ogPlato: 0, fg: fg, fgPlato: 0,
      abv: abv, abvSimple: (og - fg) * 131, abvHall: abvHall,
      ibu: ibu, ibuTinseth: ibu, ibuRager: ibu * 1.13, ibuGaretz: ibu * 0.94,
      srm: srm, ebc: srm * 1.97, colorHex: toHex(colorOfSrm(srm)),
      buGu: buGu,
      balance: buGu < 0.4 ? '麦芽主导' : (buGu < 0.6 ? '较平衡' : (buGu < 0.9 ? '偏苦' : '强苦')),
      attenuation: atten,
      /* 与 20-calc 的 aaActual 同口径：(OG−FG)/(OG−1)。
         这里是第二套实现，Calc 缺失时界面用它；漏了这个字段，
         界面就会在降级状态下显示 "表观衰减（实测） undefined%"。 */
      aaActual: og > 1.0001 ? Math.round((og - fg) / (og - 1) * 1000) / 10 : 0,
      preBoilVolume: preBoil, postBoilVolume: postBoil,
      preBoilGravity: preBoil > 0 ? 1 + (og - 1) * postBoil / preBoil : og,
      mashWater: mashWater, spargeWater: spargeWater, totalWater: totalWater,
      grainAbsorption: grainAbsorption, hopAbsorption: hopAbsorption,
      evaporation: evaporation,
      ogContribution: ogContribution,
      ibuContribution: ibuContribution,
      srmContribution: srmContribution,
      warnings: warnings,
      styleMatch: styleMatch,
      water: {
        ca: ion.ca, mg: ion.mg, na: ion.na, cl: ion.cl, so4: ion.so4, hco3: ion.hco3,
        ra: ra, so4clRatio: so4cl,
        mashPhEstimate: mashPh, mashPhRange: [mashPh - 0.12, mashPh + 0.12]
      },
      carbonation: carbonation,
      __engine: 'builtin'
    };
  }

  /** SG → °Plato（ASBC 多项式） */
  function plato(sgVal) {
    var s = num(sgVal, 1);
    return -616.868 + 1111.14 * s - 630.272 * s * s + 135.997 * s * s * s;
  }
  UI.plato = plato;

  function mergeCalc(fb, ext) {
    for (var k in ext) {
      if (!Object.prototype.hasOwnProperty.call(ext, k)) continue;
      if (ext[k] === undefined || ext[k] === null) continue;
      fb[k] = ext[k];
    }
    return fb;
  }

  /** "1.040–1.050" / "20-40" → {lo, hi}。容忍各种破折号与百分号 */
  function parseRange(v) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v) && v.length >= 2) return { lo: num(v[0], NaN), hi: num(v[1], NaN) };
    if (typeof v === 'object') {
      if (v.min !== undefined) return { lo: num(v.min, NaN), hi: num(v.max, NaN) };
      if (v.lo !== undefined) return { lo: num(v.lo, NaN), hi: num(v.hi, NaN) };
      return null;
    }
    var s = String(v);
    var parts = s.split(/[–—\-~至]/);
    if (parts.length < 2) return null;
    var lo = parseFloat(parts[0].replace(/[^\d.\-]/g, ''));
    var hi = parseFloat(parts[1].replace(/[^\d.\-]/g, ''));
    if (!isFinite(lo) || !isFinite(hi)) return null;
    return { lo: lo, hi: hi };
  }

  /**
   * 把外部 Calc 的 styleMatch 归一化成界面统一形状：
   *   deviations: [{ field, actual:number, range:{lo,hi}, verdict:'ok'|'low'|'high' }]
   * 外部实现可能是 range 字符串、actual 字符串、verdict 用 'in'
   */
  function normalizeStyleMatch(sm) {
    if (!sm || typeof sm !== 'object') return sm;
    var out = {
      styleId: sm.styleId,
      styleName: sm.styleName || sm.styleId,
      score: clamp(num(sm.score, 0), 0, 100),
      grade: sm.grade || '',
      advice: Array.isArray(sm.advice) ? sm.advice : [],
      hint: sm.hint || '',
      deviations: []
    };
    var list = Array.isArray(sm.deviations) ? sm.deviations : [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i] || {};
      var rg = parseRange(d.range);
      if (!rg) continue;
      var actual = (typeof d.actual === 'number') ? d.actual : parseFloat(String(d.actual).replace(/[^\d.\-]/g, ''));
      var verdict = d.verdict === 'in' || d.verdict === 'ok' || d.ok === true ? 'ok'
        : d.verdict === 'low' ? 'low' : d.verdict === 'high' ? 'high'
          : (actual < rg.lo ? 'low' : actual > rg.hi ? 'high' : 'ok');
      out.deviations.push({
        field: d.label || d.field || '',
        actual: isFinite(actual) ? actual : rg.lo,
        range: rg,
        verdict: verdict
      });
    }
    return out;
  }
  UI.normalizeStyleMatch = normalizeStyleMatch;

  /** 计算入口：BREW.Calc 优先；结果不合理（如全是 1.000）则回落内置估算 */
  UI.calc = function (recipe) {
    var r = recipe || UI.recipe();
    var fb;
    try {
      fb = fallbackCalc(r);
    } catch (e) {
      reportError(e, 'fallbackCalc');
      fb = {
        og: 1, fg: 1, abv: 0, ibu: 0, srm: 0, colorHex: '#c8862f', buGu: 0,
        attenuation: 75, warnings: [{ level: 'error', text: '计算失败：' + ((e && e.message) || '未知错误') }],
        ogContribution: [], ibuContribution: [], srmContribution: [],
        water: { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0, ra: 0, so4clRatio: 0, mashPhEstimate: 5.4 },
        carbonation: { targetVol: 2.4, residualVol: 0.86, grams: { sucrose: 0, dextrose: 0, dme: 0 }, sugarGrams: { sucrose: 0, dextrose: 0, dme: 0 } },
        styleMatch: null, preBoilVolume: 0, postBoilVolume: num(r.batchSize, 20),
        mashWater: 0, spargeWater: 0, totalWater: 0, grainAbsorption: 0, hopAbsorption: 0,
        evaporation: 0, balance: '—', preBoilGravity: 1
      };
    }

    var ext = null;
    try {
      if (BREW.Calc && typeof BREW.Calc.calcRecipe === 'function') ext = BREW.Calc.calcRecipe(r);
    } catch (e2) {
      ext = null;
      reportError(e2, 'calc');
    }

    if (ext && typeof ext === 'object') {
      var extOg = num(ext.og, 0);
      var sane = extOg > 1.0005 && extOg < 1.35;
      /* 配方里有麦芽却算出 1.000 → 字段契约不匹配，弃用外部结果 */
      if (sane && fb.og > 1.005 && extOg <= 1.0015) sane = false;
      if (sane) {
        mergeCalc(fb, ext);
        fb.__engine = 'calc';
      }
    }

    /* 派生量兜底：任何情况下都要有值，界面不做二次判断 */
    fb.styleMatch = normalizeStyleMatch(fb.styleMatch);
    if (!isFinite(num(fb.ogPlato, NaN)) || !fb.ogPlato) fb.ogPlato = plato(fb.og);
    if (!isFinite(num(fb.fgPlato, NaN)) || !fb.fgPlato) fb.fgPlato = plato(fb.fg);
    if (!fb.colorHex) fb.colorHex = toHex(colorOfSrm(fb.srm));
    if (!Array.isArray(fb.warnings)) fb.warnings = [];
    if (!fb.water) fb.water = { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0, ra: 0, so4clRatio: 0, mashPhEstimate: 5.4 };
    if (fb.carbonation && !fb.carbonation.sugarGrams && fb.carbonation.grams) {
      fb.carbonation.sugarGrams = fb.carbonation.grams;
    }
    if (fb.carbonation && !fb.carbonation.grams && fb.carbonation.sugarGrams) {
      fb.carbonation.grams = fb.carbonation.sugarGrams;
    }
    return fb;
  };


  /* ======================================================================
   * F. 图标库（内联 SVG，不依赖任何图标字体）
   * ====================================================================*/

  var ICONS = {
    recipe: '<path d="M9 3h6M10 3v5.4L5.6 16.9A2.2 2.2 0 0 0 7.5 20h9a2.2 2.2 0 0 0 1.9-3.1L14 8.4V3"/><path d="M7.6 14.5h8.8"/>',
    sack: '<path d="M8 7h8l-.6 3.1c1.7 1 2.6 2.6 2.6 4.4 0 3-2.7 5.5-6 5.5s-6-2.5-6-5.5c0-1.8.9-3.4 2.6-4.4L8 7z"/><path d="M8.4 7V5.3A2.5 2.5 0 0 1 10.9 2.8h2.2A2.5 2.5 0 0 1 15.6 5.3V7"/>',
    record: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4M8.6 9.5h6.8M8.6 13.5h6.8M8.6 17.5h3.6"/>',
    tools: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M8 7h8M8.6 11.6h.01M12 11.6h.01M15.4 11.6h.01M8.6 15.6h.01M12 15.6h.01M15.4 15.6h.01"/>',
    report: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.6 12h5.8M9.6 15.6h5.8"/>',
    /* v1.2 分析视图用的柱状图。放在这里而不是让视图自己挑一个相近的图标：
       UI.icon() 对不存在的键会静默回落成 info 圆圈，不报错——那种"看起来
       也能显示"的降级最难发现。 */
    chart: '<path d="M4 20.5h16"/><path d="M7.2 20.5v-6M12 20.5v-10.5M16.8 20.5v-4"/>',
    /* 四角展开，给「全屏」用。不要拿 arrow/chevron 凑——
       全屏是一个有固定国际惯例的图标，凑出来的没人认得。 */
    expand: '<path d="M9.5 4.5H4.5v5M14.5 4.5h5v5M9.5 19.5H4.5v-5M14.5 19.5h5v-5"/>',
    /* 一摞硬币，给「年度花费」用。不要拿 chart 硬凑：
       统计和花费是两张不同的纸，功能区的图标是它们唯一的视觉区别。 */
    coins: '<ellipse cx="12" cy="6.8" rx="6.2" ry="3"/><path d="M5.8 6.8v4.4c0 1.66 2.78 3 6.2 3s6.2-1.34 6.2-3V6.8"/><path d="M5.8 11.2v4.4c0 1.66 2.78 3 6.2 3s6.2-1.34 6.2-3v-4.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    trash: '<path d="M4 7h16M9.5 7V4.6h5V7M6.6 7l.9 13h9l.9-13M10.2 11v5.6M13.8 11v5.6"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.6A1.6 1.6 0 0 0 13.9 4H5.6A1.6 1.6 0 0 0 4 5.6v8.3a1.6 1.6 0 0 0 1.6 1.6h2.9"/>',
    save: '<path d="M5 4.5h10.5L19 8v11.5H5z"/><path d="M8.5 4.5v5h7v-5M8.5 19.5v-5.5h7v5.5"/>',
    search: '<circle cx="11" cy="11" r="6.2"/><path d="M15.6 15.6L20 20"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevron: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
    down: '<path d="M12 4.5v11M7.6 11.4L12 15.8l4.4-4.4M5 20h14"/>',
    printer: '<path d="M7 8.5V4h10v4.5M7 17.5H5V9.5h14v8h-2M7 13.5h10V21H7z"/>',
    check: '<path d="M5 12.8l4.6 4.6L19 6.8"/>',
    alert: '<path d="M12 4.2l9 16.3H3L12 4.2z"/><path d="M12 10v4.2M12 17.1h.01"/>',
    info: '<circle cx="12" cy="12" r="8.8"/><path d="M12 11.2v5M12 8.1h.01"/>',
    drop: '<path d="M12 3.5c3.3 4 5.6 6.8 5.6 9.6a5.6 5.6 0 0 1-11.2 0c0-2.8 2.3-5.6 5.6-9.6z"/>',
    flask: '<path d="M10 3h4M10.6 3v6.2l-3.4 8.3A2 2 0 0 0 9 20.2h6a2 2 0 0 0 1.8-2.7l-3.4-8.3V3"/>',
    scale: '<path d="M12 4v16M6 20h12M4 8h16M7.5 8l-3 6h6l-3-6zM16.5 8l-3 6h6l-3-6z"/>',
    clock: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7.2V12l3.4 2"/>',
    thermo: '<path d="M14 13.6V5.4a2 2 0 1 0-4 0v8.2a4 4 0 1 0 4 0z"/><path d="M12 9.5V16"/>',
    sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5z"/>',
    beaker: '<path d="M6.5 4h11M8 4v6l-4 9.6h16L16 10V4"/><path d="M5.2 15.4h13.6"/>',
    arrow: '<path d="M5 12h13M13 6.8l5.2 5.2-5.2 5.2"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16v4z"/><path d="M14.5 8.5l4 4"/>',
    beer: '<path d="M7 8h10l-1 12H8L7 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M7.4 13h9.2"/>',
    home: '<path d="M4 11l8-6.5 8 6.5M6.5 9.5V20h11V9.5"/>',
    layers: '<path d="M12 3.5l8 4.2-8 4.2-8-4.2 8-4.2z"/><path d="M4 12.2l8 4.2 8-4.2M4 16.6l8 4.2 8-4.2"/>',
    /* v1.1 追加：设置页需要一个齿轮，原来没有，之前只能借用 tools 造成两个导航项同图标 */
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.1 14.6a1.5 1.5 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.5 1.5 0 0 0-1.7-.3 1.5 1.5 0 0 0-.9 1.4V21a2 2 0 1 1-4 0v-.1a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.5 1.5 0 0 0 .3-1.7 1.5 1.5 0 0 0-1.4-.9H3a2 2 0 1 1 0-4h.1a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.5 1.5 0 0 0 1.7.3H9a1.5 1.5 0 0 0 .9-1.4V3a2 2 0 1 1 4 0v.1a1.5 1.5 0 0 0 .9 1.4 1.5 1.5 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.5 1.5 0 0 0-.3 1.7V9a1.5 1.5 0 0 0 1.4.9H21a2 2 0 1 1 0 4h-.1a1.5 1.5 0 0 0-1.4 1z"/>'
  };

  /**
   * icon('plus', 16) → SVG 字符串
   * 统一 currentColor 描边，尺寸由参数控制（默认 16）。
   */
  function icon(name, size) {
    var d = ICONS[name];
    if (!d) d = ICONS.info;
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }
  UI.icon = icon;

  /* 空状态插画：啤酒杯轮廓（描边风格，与整体一致） */
  UI.emptyArt = function (kind, size) {
    var s = size || 68;
    var art = kind === 'search'
      ? '<circle cx="34" cy="30" r="13"/><path d="M43.5 39.5L54 50"/>'
      : kind === 'chart'
        ? '<path d="M12 54V26M26 54V16M40 54V34M54 54V22"/><path d="M8 58h50"/>'
        : '<path d="M22 14h20l-2.4 10.8C46 29 49 34.4 49 40.5 49 50.5 41.5 58 34 58S19 50.5 19 40.5c0-6.1 3-11.5 9.4-15.7L22 14z"/>' +
          '<path d="M20.4 41.6c8-4.6 19.2-4.6 27.2 0" /><circle cx="28" cy="33" r="1.7" fill="currentColor" stroke="none"/>' +
          '<circle cx="34" cy="36.4" r="1.7" fill="currentColor" stroke="none"/>' +
          '<circle cx="38.6" cy="30.6" r="1.4" fill="currentColor" stroke="none"/>';
    return '<svg class="empty__art" viewBox="0 0 68 68" width="' + s + '" height="' + s + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">' + art + '</svg>';
  };

  /* ======================================================================
   * G. 应用骨架：导航 / 视图切换
   * ====================================================================*/

  var views = [];
  var activeId = null;
  var elView = null, elBoot = null;

  /* v1.8 页面级领域色：视图 id → --dom-* 令牌名（不含前缀）。
     为什么是一张显式的表而不是按 id 拼字符串：好几个视图的领域色与 id 不同名
     （ingredient→malt、classic→malt、report→delivery、brewday→process），
     拼字符串会静默落回默认值——"配方页是青的、原料页也是青的"这种错
     在屏幕上不刺眼，但整套分区就白做了。 */
  var VIEW_DOMAIN = {
    recipe: 'recipe', ingredient: 'malt', classic: 'malt', inventory: 'malt',
    batch: 'batch', lineage: 'batch', ab: 'batch',
    analysis: 'analysis', tasting: 'analysis',
    report: 'delivery', label: 'delivery',
    tools: 'process', brewday: 'process',
    settings: 'system'
  };

  Shell._ready = false;
  Shell.views = function () { return views.slice(); };
  Shell.activeId = function () { return activeId; };

  Shell.registerView = function (def) {
    if (!def || !def.id) return;
    var existing = -1;
    for (var i = 0; i < views.length; i++) if (views[i].id === def.id) existing = i;
    var v = {
      id: def.id,
      label: def.label || def.id,
      icon: def.icon || 'info',
      group: def.group || '',
      order: num(def.order, views.length + 1),
      render: def.render,
      onEnter: def.onEnter,
      onLeave: def.onLeave
    };
    if (existing > -1) views[existing] = v; else views.push(v);
    views.sort(function (a, b) { return a.order - b.order; });
    /* v1.6：左侧导航没了，视图注册后要重画的是**功能区的「视图」页签**
       （它的 10 个入口是现场从 views 读的，不是静态表）。 */
    rerenderRibbonViews();
    /* 视图在激活后注册也要能显示出来 */
    if (activeId === v.id) renderView(v.id, true);
  };

  /* v1.6：renderNav / syncNavActive 整块删除。
     左侧不再是视图列表，10 个入口搬到了功能区「视图」页签（见 viewGroup）。
     保留这两个空壳函数只会让下一个人以为导航还在（点进去发现没有 #nav）；
     删除是不可逆的，但"看着存在、实际不工作"更贵。 */

  function renderView(id, force) {
    elView = document.getElementById('view');
    if (!elView) return;
    var v = null;
    for (var i = 0; i < views.length; i++) if (views[i].id === id) v = views[i];
    if (!v) v = views[0];
    if (!v) return;

    if (activeId === v.id && !force) return;
    var prev = activeId;
    activeId = v.id;

    /* 读屏切换视图时只会说"main"，用户不知道自己在哪一页。
       aria-label 跟着当前视图走，是这一句唯一的落点。 */
    try { elView.setAttribute('aria-label', (v.label || v.id || '')); } catch (e0) { /* 老浏览器忽略 */ }

    var prevView = null;
    for (var j = 0; j < views.length; j++) if (views[j].id === prev) prevView = views[j];
    if (prevView && typeof prevView.onLeave === 'function') {
      try { prevView.onLeave(); } catch (e) { reportError(e, 'onLeave:' + prev); }
    }

    if (elBoot) {
      var b = document.getElementById('boot');
      if (b && b.parentNode) b.parentNode.removeChild(b);
      elBoot = null;
    }

    elView.innerHTML = '';
    try {
      if (typeof v.render === 'function') v.render(elView);
      else elView.innerHTML = emptyState('该视图尚未实现', '模块 ' + v.id + ' 缺少 render 方法。');
    } catch (e) {
      reportError(e, 'render:' + v.id);
      elView.innerHTML = '<div class="card"><div class="card__body">' +
        '<div class="empty">' + UI.emptyArt('beer') +
        '<div class="empty__title">视图渲染失败</div>' +
        '<div class="empty__desc">' + esc((e && e.message) || '未知错误') + '</div>' +
        '</div></div></div>';
    }
    /* v1.8：给 #view 打页面级领域色（recipe/malt/batch/… 见 --dom-* 令牌）。
       顶栏底线与功能区活动页签的下划线读它，于是"你在哪一页"有一处
       一直存在的色，而不是只有切页那一瞬间的动画。
       同一份值同时写到 <html> 上：那两条线在 #view 之外（.topbar / .ribbon
       是兄弟节点），CSS 变量只能沿祖先继承，写在 #view 上它们看不见。
       两个属性同一个来源，不要只改一处。 */
    var domainOf = VIEW_DOMAIN[v.id] || 'recipe';
    try {
      elView.setAttribute('data-domain', domainOf);
      document.documentElement.setAttribute('data-domain', domainOf);
    } catch (e0) { /* 老浏览器忽略 */ }
    /* v1.6：原来这里 syncNavActive() 高亮左侧导航项。
       现在"你在哪一页"由功能区里的 data-go 按钮（aria-current="page"）表达，
       那件事在 syncRibbonState 里做，viewChanged 时也会再跑一遍。 */
    syncRibbonState();
    if (typeof v.onEnter === 'function') {
      try { v.onEnter(); } catch (e2) { reportError(e2, 'onEnter:' + v.id); }
    }
    elView.scrollTop = 0;
    try { elView.focus({ preventScroll: true }); } catch (e3) { /* 老浏览器忽略 */ }
    Bus.emit('viewChanged', { id: v.id });
  }

  Shell.go = function (id) {
    if (!id) return;
    var hash = '#/' + id;
    if (root.location && root.location.hash !== hash) {
      /* 用 hash 承载路由，便于刷新后回到同一视图 */
      root.location.hash = hash;
      return; // hashchange 里再真正切换
    }
    renderView(id);
  };

  Shell.refresh = function () {
    if (activeId) renderView(activeId, true);
    else if (views.length) Shell.go(views[0].id);
  };

  Shell.refreshSidebarFoot = function (text) {
    var el = document.getElementById('sidebar-foot');
    if (!el) return;
    if (!text) { el.innerHTML = ''; return; }
    el.innerHTML = text;
  };

  /* ======================================================================
   * H. 顶栏指标胶囊
   * ====================================================================*/

  var pillPrev = {};
  var pillFlashTimer = 0;

  Shell.syncTopbar = function (recipe, calc) {
    var nameEl = document.getElementById('top-recipe-name');
    if (nameEl) {
      var fullName = (recipe && recipe.name) || '未命名配方';
      nameEl.textContent = fullName;
      /* v1.6：拖到最宽仍可能不够（长配方名 + 720 档），省略号保留 ——
         但全名必须能拿到。title 是这一条的唯一出口，别删。 */
      nameEl.setAttribute('title', fullName);
    }

    var host = document.getElementById('top-pills');
    if (!host) return;
    if (!calc) {
      host.innerHTML = '<span class="pill pill--muted">尚无计算数据</span>';
      return;
    }

    var items = [
      { key: 'vol', label: '批次', value: fmt(recipe.batchSize, 0), unit: 'L', key2: true },
      { key: 'og', label: 'OG', value: sg(calc.og), unit: '' },
      { key: 'fg', label: 'FG', value: sg(calc.fg), unit: '' },
      { key: 'abv', label: 'ABV', value: fmt(calc.abv, 1), unit: '%', key2: true },
      { key: 'ibu', label: 'IBU', value: fmt(calc.ibu, 1), unit: '' },
      {
        /* 1 位小数：取整会和右侧实时面板对不上（7.5 显示成 8），
           同一屏两个数不一致最容易被当成 bug */
        key: 'srm', label: 'SRM', value: fmt(calc.srm, 1), unit: '',
        dot: calc.colorHex
      }
    ];

    var changed = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (pillPrev[it.key] !== undefined && pillPrev[it.key] !== it.value) changed[it.key] = true;
      pillPrev[it.key] = it.value;
    }

    var html = '';
    for (var j = 0; j < items.length; j++) {
      var x = items[j];
      html += '<span class="pill' + (x.key2 ? ' pill--key' : '') + '" data-pill="' + x.key + '">' +
        (x.dot ? '<i class="status-dot" style="background:' + attr(x.dot) + '"></i>' : '') +
        '<i>' + esc(x.label) + '</i><b>' + esc(x.value) + '</b>' +
        (x.unit ? '<i>' + esc(x.unit) + '</i>' : '') +
        '</span>';
    }
    host.innerHTML = html;

    var keys = Object.keys(changed);
    if (keys.length) {
      for (var k = 0; k < keys.length; k++) {
        var el = host.querySelector('[data-pill="' + keys[k] + '"]');
        if (el) el.classList.add('is-flash');
      }
      if (pillFlashTimer) root.clearTimeout(pillFlashTimer);
      pillFlashTimer = root.setTimeout(function () {
        pillFlashTimer = 0;
        var flashed = host.querySelectorAll('.pill.is-flash');
        for (var m = 0; m < flashed.length; m++) flashed[m].classList.remove('is-flash');
      }, 220);
    }
  };

  /* ======================================================================
   * I. Toast
   * ====================================================================*/

  var toastSeq = 0;
  Shell.toast = function (msg, type, ms) {
    var host = document.getElementById('toasts');
    if (!host) return null;
    type = type || 'info';
    var t = document.createElement('div');
    t.className = 'toast toast--' + type;
    t.setAttribute('role', 'status');
    var ic = type === 'ok' ? 'check' : type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'info';
    t.innerHTML = '<span class="toast__icon">' + icon(ic, 15) + '</span>' +
      '<div class="toast__body"><div class="toast__msg">' + esc(msg) + '</div></div>' +
      '<button type="button" class="toast__close" aria-label="关闭提示">' + icon('x', 13) + '</button>';

    function kill() {
      if (!t.parentNode) return;
      t.classList.add('is-out');
      root.setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 180);
    }
    t.querySelector('.toast__close').addEventListener('click', kill);
    host.appendChild(t);

    /* 最多同时 4 条，超出移除最旧的 */
    while (host.children.length > 4) host.removeChild(host.firstChild);

    var id = ++toastSeq;
    root.setTimeout(kill, num(ms, type === 'error' ? 5200 : 3000));
    t.setAttribute('data-toast', String(id));
    return t;
  };

  /* ======================================================================
   * J. 模态框
   * ====================================================================*/

  var modalStack = [];
  var lastFocus = null;

  /**
   * 模态打开时把背景标成 inert：焦点与读屏都进不去。
   * 不支持的浏览器会把它当成一个普通未知属性，不会报错（所以不必特性检测）。
   * 只改 #app —— modal-root / toasts 是它的兄弟节点，必须留在外面。
   */
  function setBackgroundInert(on) {
    var app = document.getElementById('app');
    if (!app) return;
    try {
      if (on) app.setAttribute('inert', '');
      else app.removeAttribute('inert');
    } catch (e) { /* ignore */ }
  }

  /**
   * Shell.modal({title, sub, body, actions, size, onMount})
   *   body     : HTML 字符串或 DOM 节点
   *   actions  : [{label, kind:'primary'|'ghost'|'danger', act(api) → false 阻止关闭, close:false}]
   * 返回 {el, close(), query()}
   */
  Shell.modal = function (opt) {
    opt = opt || {};
    var rootEl = document.getElementById('modal-root');
    if (!rootEl) return null;

    if (!modalStack.length) lastFocus = document.activeElement;

    var wrap = document.createElement('div');
    wrap.className = 'modal' + (opt.size === 'wide' ? ' modal--wide' : opt.size === 'narrow' ? ' modal--narrow' : '');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', opt.title || '对话框');

    var actionsHtml = '';
    var acts = Array.isArray(opt.actions) ? opt.actions : [{ label: '关闭', kind: 'ghost' }];
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i];
      actionsHtml += '<button type="button" class="btn btn-' + (a.kind || 'ghost') + '" data-act="' + i + '">' +
        esc(a.label) + '</button>';
    }

    wrap.innerHTML =
      '<div class="modal__head">' +
        '<h2>' + esc(opt.title || '') + '</h2>' +
        (opt.sub ? '<span class="modal__sub">' + esc(opt.sub) + '</span>' : '') +
        '<button type="button" class="btn btn-quiet btn-icon" data-close aria-label="关闭">' + icon('x', 15) + '</button>' +
      '</div>' +
      '<div class="modal__body" data-body></div>' +
      (actionsHtml ? '<div class="modal__foot"><div class="spacer"></div>' + actionsHtml + '</div>' : '');

    var bodyEl = wrap.querySelector('[data-body]');
    if (opt.body instanceof Node) bodyEl.appendChild(opt.body);
    else bodyEl.innerHTML = opt.body || '';

    rootEl.hidden = false;
    rootEl.appendChild(wrap);
    setBackgroundInert(true);

    var api = {
      el: wrap,
      body: bodyEl,
      query: function (sel) { return wrap.querySelector(sel); },
      queryAll: function (sel) { return wrap.querySelectorAll(sel); },
      close: close
    };

    function close() {
      var idx = modalStack.indexOf(api);
      if (idx > -1) modalStack.splice(idx, 1);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (!modalStack.length) {
        setBackgroundInert(false);
        rootEl.classList.add('is-closing');
        rootEl.hidden = true;
        rootEl.classList.remove('is-closing');
        if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignore */ } }
      } else {
        /* 还有下一层模态：焦点别留在已经移除的节点上 */
        var top = modalStack[modalStack.length - 1];
        if (top && top.el && top.el.focus) { try { top.el.focus(); } catch (e3) { /* ignore */ } }
      }
    }

    modalStack.push(api);

    wrap.querySelector('[data-close]').addEventListener('click', close);
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var idx = num(btn.getAttribute('data-act'), -1);
      var def = acts[idx];
      if (!def) return;
      var keep = false;
      if (typeof def.act === 'function') {
        var res = def.act(api, e);
        keep = (res === false);
      }
      if (def.close === false) keep = true;
      if (!keep) close();
    });

    /* 点遮罩空白处关闭：监听器**只绑一次**，绑在 Shell.init 里（见 init）。
       原来每开一次模态就在这里 addEventListener 一次：20 次之后 20 个同源监听，
       每改一次关闭逻辑都要在 N 个实例上验证。 */

    if (typeof opt.onMount === 'function') {
      try { opt.onMount(api); } catch (e) { reportError(e, 'modal:mount'); }
    }

    /* 自动聚焦：三段兜底。
       原来只找 `input, select, textarea, .btn-primary`——**纯展示型模态一个都匹配不到**
       （水质匹配就是），焦点留在背后那个触发按钮上，键盘与读屏都进不来。
       现在：① 正文里的可交互元素 ② 正文没有 → 焦点给对话框本身（tabindex=-1），
       读屏会先播报标题；不要退而求其次去聚焦底部的「关闭」——那样读屏只会念一句
       "关闭 按钮"，用户不知道弹的是什么。
       opt.autoFocus 可以是选择器，用来覆盖默认（确认框靠它把焦点放到「取消」上）。 */
    root.setTimeout(function () {
      var sel = 'input:not([type=hidden]), select, textarea, .btn-primary, button, [href], [tabindex="0"]';
      var first = null;
      if (typeof opt.autoFocus === 'string') {
        try { first = wrap.querySelector(opt.autoFocus); } catch (eSel) { first = null; }
      }
      if (!first) first = bodyEl.querySelector(sel);
      if (!first) {
        wrap.setAttribute('tabindex', '-1');
        first = wrap;
      }
      if (first && first.focus) {
        try {
          first.focus();
          if (first.select && first.type !== 'checkbox' &&
            (first.tagName === 'INPUT' || first.tagName === 'TEXTAREA')) first.select();
        } catch (e) { /* ignore */ }
      }
    }, 30);

    return api;
  };

  Shell.closeModal = function () {
    var top = modalStack[modalStack.length - 1];
    if (top) top.close();
  };

  Shell.confirm = function (opt, onOk) {
    opt = opt || {};
    return Shell.modal({
      title: opt.title || '确认操作',
      size: 'narrow',
      /* 危险操作的确认框，默认焦点必须落在「取消」上。
         原来靠模态的默认自动聚焦，而它对 danger 框匹配不到任何元素
         （按钮是 btn-danger 不是 btn-primary），对普通框则直接聚焦「确认」——
         等于"打开后按回车就执行"。取消永远是 actions[0]，所以这里按 data-act 定位。 */
      autoFocus: '[data-act="0"]',
      body: '<p style="font-size:13px;line-height:1.65;color:var(--tx-2)">' + esc(opt.message || '') + '</p>' +
        (opt.detail ? '<p class="u-sm u-dim mt-8">' + esc(opt.detail) + '</p>' : ''),
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: opt.okLabel || '确认', kind: opt.danger ? 'danger' : 'primary',
          act: function (api) { if (typeof onOk === 'function') onOk(api); }
        }
      ]
    });
  };

  /* 全局键盘：Esc 关模态框 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalStack.length) {
      e.preventDefault();
      Shell.closeModal();
      return;
    }
    /* Tab 焦点循环约束在模态框内。
       原来的逻辑只在"焦点正好在首/尾"时回绕——一旦焦点落到 body（点模态空白处、
       或上面那种没进过焦点的情况），这里就完全不拦截，Tab 会走到背景控件上。
       现在先判"焦点在不在框里"，不在就拉回第一个。 */
    if (e.key === 'Tab' && modalStack.length) {
      var wrap = modalStack[modalStack.length - 1].el;
      var f = wrap.querySelectorAll('button, [href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!f.length) { e.preventDefault(); try { wrap.focus(); } catch (e4) { /* ignore */ } return; }
      if (!wrap.contains(document.activeElement)) {
        e.preventDefault();
        try { f[0].focus(); } catch (e5) { /* ignore */ }
        return;
      }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ======================================================================
   * K. 通用片段（各视图复用的小组件）
   * ====================================================================*/

  UI.emptyState = function (title, desc, opts) {
    opts = opts || {};
    return '<div class="empty' + (opts.small ? ' empty--sm' : '') + '">' +
      UI.emptyArt(opts.art || 'beer', opts.size || 66) +
      '<div class="empty__title">' + esc(title || '暂无数据') + '</div>' +
      (desc ? '<div class="empty__desc">' + esc(desc) + '</div>' : '') +
      (opts.action ? '<div class="mt-8">' + opts.action + '</div>' : '') +
      '</div>';
  };

  UI.badgeConf = function (conf) {
    var c = String(conf || '').toUpperCase();
    if (c === 'A') return '<span class="badge badge--a" title="多来源交叉验证">A 级 · 多源</span>';
    if (c === 'B') return '<span class="badge badge--b" title="单一权威源 / 行业通行值">B 级 · 单一源</span>';
    if (c === 'C') return '<span class="badge badge--c" title="估值区间，需查厂商 COA">C 级 · 查 COA</span>';
    return '<span class="badge badge--neutral">—</span>';
  };

  UI.unitWrap = function (id, value, unit, opts) {
    opts = opts || {};
    return '<div class="input-wrap">' +
      '<input class="input input--num" id="' + attr(id) + '" type="' +
      attr(opts.type || 'number') + '"' +
      (opts.step ? ' step="' + attr(opts.step) + '"' : '') +
      (opts.min !== undefined ? ' min="' + attr(opts.min) + '"' : '') +
      (opts.max !== undefined ? ' max="' + attr(opts.max) + '"' : '') +
      ' value="' + attr(value) + '"' +
      (opts.path ? ' data-path="' + attr(opts.path) + '" data-num="1"' : '') +
      (opts.ariaLabel ? ' aria-label="' + attr(opts.ariaLabel) + '"' : '') +
      (opts.inputmode ? ' inputmode="' + attr(opts.inputmode) + '"' : '') +
      '>' +
      (unit ? '<span class="input-wrap__unit">' + esc(unit) + '</span>' : '') +
      '</div>';
  };

  /* ======================================================================
   * M. 功能区（v1.4）
   * ----------------------------------------------------------------------
   * 结构：页签条（固定 30px，永远在）+ 面板（92px，可折叠为 0）。
   *
   * 三条设计约束，改之前先读：
   *   ① 功能区**现在是 10 个视图的唯一入口**（v1.6 起 —— 左侧导航已删除）。
   *      视图类按钮一律走 Shell.go(id)，Alt+1..9/0 是键盘侧的同一个入口。
   *      「视图」页签的第一个分区由 viewGroup() 从注册表现场生成，
   *      顺序与 Alt 键位同源，不要另写一份清单。
   *   ② 功能区里的按钮**不能用 data-view**（见 index.html 注释）：
   *      tools/ 下多个脚本按 data-view 找元素，功能区若同名会抢走那次点击。
   *      视图跳转用 data-go。
   *   ③ 每个按钮都必须有真实去处。视图内已有的动作（另存为 / PNG / 打印 /
   *      新建批次 / 库存 / 采购 / 页签）不去重写一份实现，而是导航到该视图后
   *      **点它自己的按钮**（视图内部都是事件委托，el.click() 就会被处理）。
   *      这样"同名两处功能"永远只有一个实现，不会各改一半。
   * ====================================================================*/

  var RB_TABS = [
    {
      /* v1.7 分区整理：文件只剩两类动作 —— 「配方」（新建/保存/另存为）与
         「交换」（导出/导入 JSON）。分享与打印都搬走了：
           · 分享搬去新的「分享」页签（用户原话：把它提升为一级菜单）；
           · 打印搬去「交付」—— 配方卡那三颗按钮本来就是干这个的，
             同一个 act 挂两处入口只会让人以为两处有区别。 */
      id: 'file', label: '文件', groups: [
        {
          name: '配方', items: [
            { label: '新建', icon: 'plus', act: 'new' },
            { label: '保存', icon: 'save', act: 'save' },
            { label: '另存为', icon: 'copy', act: 'saveAs' }
          ]
        },
        {
          name: '交换', items: [
            { label: '导出', icon: 'down', act: 'exportJson', title: '导出 JSON 文件' },
            { label: '导入', icon: 'save', act: 'importJson', title: '导入 JSON 文件' }
          ]
        }
      ]
    },
    {
      id: 'design', label: '设计', groups: [
        {
          name: '配方', items: [
            { label: '配方设计', icon: 'recipe', go: 'recipe' },
            { label: '原料库', icon: 'sack', go: 'ingredient' }
          ]
        },
        /* v1.6「校验」：运行 / 下一步 / 重置。
           为什么放在「设计」页签、紧跟「配方」而不是单开一个页签：
           它是设计过程的收尾动作（Aspen 的 Run 也在 Home 的最右边），
           而不是另一个功能域。三个动作的语义写在 41b 的文件头，这里只是入口。 */
        {
          name: '校验', items: [
            { label: '运行检查', icon: 'check', act: 'runCheck' },
            { label: '下一步', icon: 'arrow', act: 'runNext' },
            { label: '重置', icon: 'trash', act: 'runReset' }
          ]
        },
        {
          name: '原料', items: [
            { label: '库存', icon: 'layers', act: 'stock' },
            { label: '采购', icon: 'scale', act: 'shopping' }
          ]
        },
        { name: '参考', items: [{ label: '经典配方库', icon: 'beer', go: 'classic', short: '经典配方' }] }
      ]
    },
    {
      id: 'record', label: '记录', groups: [
        {
          name: '批次', items: [
            { label: '新建批次', icon: 'plus', act: 'newBatch' },
            { label: '批次列表', icon: 'record', go: 'batch' }
          ]
        },
        { name: '现场', items: [{ label: '酿造日', icon: 'clock', go: 'brewday' }] },
        /* v1.7：标签从「装瓶与成本」改成「装瓶记录」。成本不在这张卡里算 ——
           它是分析视图的年度花费（下面 title 直接指路），两件事挂在一个名字上
           会让人以为点进去能改钱。**只改标签与分组，不拆功能。** */
        {
          name: '收尾', items: [{
            label: '装瓶记录', icon: 'beer', act: 'packaging',
            title: '装瓶记录（成本统计在「分析 · 年度花费」）'
          }]
        }
      ]
    },
    {
      id: 'analysis', label: '分析', groups: [
        {
          name: '统计', items: [
            { label: '年度统计', icon: 'chart', act: 'stats' },
            { label: '年度花费', icon: 'coins', act: 'cost' }
          ]
        },
        {
          name: '对比', items: [
            { label: '批次对比', icon: 'scale', act: 'ab', title: '多批次 A-B 对比' },
            { label: '配方谱系', icon: 'layers', act: 'lineage' }
          ]
        },
        /* v1.7：计算工具集从「设计」搬到这里。它回答的是"我这锅的数字是多少"，
           不是"配方怎么设计"，放在设计流程里等于把计算器摆在绘图板上。 */
        {
          name: '工具', items: [{ label: '计算工具', icon: 'tools', go: 'tools', title: '计算工具集' }]
        },
        { name: '体检', items: [{ label: '数据体检', icon: 'check', act: 'health' }] }
      ]
    },
    {
      /* v1.7 新增第 5 个页签「分享」，位置在「分析」之后、「交付」之前。
         理由是动作的时间顺序：分析完 → 把结果发出去 → 打印与酒标这种物理产出。
         11 个入口就是 11 种可分享对象（见 28 的 TYPES），点哪个就在分享中心里
         预选哪个类型 —— 页签本身不复制一份界面，只做"带着类型打开"。 */
      id: 'share', label: '分享', groups: [
        { name: '配方', items: [{ label: '分享配方', icon: 'sparkle', act: 'shareRecipe' }] },
        {
          name: '原料', items: [
            { label: '麦芽', icon: 'sack', act: 'shareMalt' },
            { label: '酒花', icon: 'flask', act: 'shareHop' },
            { label: '酵母', icon: 'beaker', act: 'shareYeast' }
          ]
        },
        {
          name: '辅料', items: [
            { label: '辅料', icon: 'drop', act: 'shareAdjunct' },
            { label: '原料库', icon: 'layers', act: 'shareLibrary', title: '分享自建原料整库' }
          ]
        },
        {
          name: '记录', items: [
            { label: '批次', icon: 'record', act: 'shareBatches', title: '分享批次列表' },
            { label: '酿造日', icon: 'clock', act: 'shareBrewday' }
          ]
        },
        {
          name: '产出', items: [
            { label: '酒标', icon: 'sparkle', act: 'shareLabel' },
            { label: '分析', icon: 'chart', act: 'shareAnalysis', title: '分享年度统计与花费的数值快照' },
            { label: '库存', icon: 'home', act: 'shareInventory' }
          ]
        }
      ]
    },
    {
      id: 'delivery', label: '交付', groups: [
        {
          /* 「打印配方卡」唯一的一处入口就在这里。v1.6 之前「文件 · 打印」
             还有一份，同一个 act 两个入口，用户以为有区别。 */
          name: '配方卡', items: [
            { label: '打开', icon: 'report', go: 'report' },
            { label: '导出PNG', icon: 'down', act: 'reportPng', title: '导出 PNG 图片' },
            { label: '打印', icon: 'printer', act: 'printCard', title: '打印配方卡' }
          ]
        },
        { name: '酒标', items: [{ label: '酒标', icon: 'sparkle', act: 'label', title: '打开酒标设计器' }] }
      ]
    },
    {
      id: 'view', label: '视图', groups: [
        {
          name: '功能区', items: [
            { label: '折叠', icon: 'chevron', act: 'ribbonToggle', title: '收起 / 展开功能区（Ctrl+F1）' }
          ]
        },
        {
          /* 分辨率按钮只写"1080P"这种短标签：横排后一个字的位置都要算，
             完整分辨率放在 title 里。 */
          name: '分辨率', items: [
            { label: '1080P', icon: 'layers', act: 'res1080', title: '1920×1080' },
            { label: '1440P', icon: 'layers', act: 'res1440', title: '2560×1440' },
            { label: '720P', icon: 'layers', act: 'res720', title: '1280×720' }
          ]
        },
        {
          name: '字号', items: [
            { label: '标准', icon: 'edit', act: 'fontStd' },
            { label: '大', icon: 'edit', act: 'fontLg' }
          ]
        },
        {
          /* v1.6：名字从「侧栏」改成「左面板」——
             它现在折的是"整块左面板"，不再是一条导航。 */
          name: '左面板', items: [
            { label: '展开', icon: 'arrow', act: 'navOpen' },
            { label: '收起', icon: 'chevron', act: 'navRail' }
          ]
        }
      ]
    }
  ];

  /* 自定义页签放最后：它是"我自己拼的"，天然属于序末；
     放在中间会让"文件/设计/记录/分析/分享/交付/视图"这条固定路径被打断。 */
  RB_TABS.push({ id: 'custom', label: '自定义', groups: [] });

  /* ======================================================================
   * 自定义功能区（v1.5）
   * ----------------------------------------------------------------------
   * 用户可以自己拼一个页签：若干分区、每分区若干按钮、每个按钮指向一个**已有动作**。
   *
   * 为什么只能引用已有动作，不能自己写：
   *   一旦允许用户定义"这个按钮干什么"，这里就变成插件运行时——要沙箱、要版本
   *   兼容、要为每个用户脚本兜异常。那是另一个产品的规模。用户真正缺的是
   *   "把常用的五个键放在一起"，不是"写一个宏"。
   *
   * 目录（CATALOG）是**唯一一份**可选动作清单：编辑器下拉、默认预设、存档校验
   *   三处都读它。新加一个动作只改这里一行，不用改编辑器也不用改文档。
   *
   * 失效容忍：存档里若有当前版本不存在的动作（降级、或以后删了某动作），
   *   不报错也不静默丢——渲染成一颗禁用按钮，悬停说明"这个动作在当前版本不存在"。
   *   静默丢掉会让用户以为"我加过的按钮自己没了"，那比报错更难查。
   * ====================================================================*/
  var CUSTOM_CATALOG = [
    { act: 'new', label: '新建配方', icon: 'plus' },
    { act: 'save', label: '保存配方', icon: 'save' },
    { act: 'saveAs', label: '另存为', icon: 'copy' },
    { act: 'exportJson', label: '导出 JSON', icon: 'down' },
    { act: 'importJson', label: '导入 JSON', icon: 'down' },
    /* v1.7：分享从"一个按钮"变成 11 个按钮（一个对象一个）。
       旧的 'share' 不放回目录（用户在新目录里找不到重复项），
       但 ACTIONS 里仍然留着它 —— 老的自定义存档里那一颗按钮必须继续能点。 */
    { act: 'shareRecipe', label: '分享配方', icon: 'sparkle' },
    { act: 'shareMalt', label: '分享麦芽', icon: 'sack' },
    { act: 'shareHop', label: '分享酒花', icon: 'flask' },
    { act: 'shareYeast', label: '分享酵母', icon: 'beaker' },
    { act: 'shareAdjunct', label: '分享辅料', icon: 'drop' },
    { act: 'shareLibrary', label: '分享原料库', icon: 'layers' },
    { act: 'shareBatches', label: '分享批次', icon: 'record' },
    { act: 'shareBrewday', label: '分享酿造日', icon: 'clock' },
    { act: 'shareLabel', label: '分享酒标', icon: 'sparkle' },
    { act: 'shareAnalysis', label: '分享分析快照', icon: 'chart' },
    { act: 'shareInventory', label: '分享库存', icon: 'home' },
    { act: 'printCard', label: '打印配方卡', icon: 'printer' },
    { act: 'reportPng', label: '导出 PNG', icon: 'down' },
    { act: 'label', label: '酒标', icon: 'sparkle' },
    { act: 'stock', label: '库存', icon: 'sack' },
    { act: 'shopping', label: '采购清单', icon: 'sack' },
    { act: 'newBatch', label: '新建批次', icon: 'plus' },
    { act: 'packaging', label: '装瓶记录', icon: 'beer' },
    { act: 'stats', label: '年度统计', icon: 'chart' },
    { act: 'cost', label: '年度花费', icon: 'coins' },
    { act: 'lineage', label: '配方谱系', icon: 'layers' },
    { act: 'ab', label: '多批次 A-B', icon: 'scale' },
    { act: 'health', label: '数据体检', icon: 'check' },
    /* v1.6：运行面板三个动作。加进目录是为了让用户能把「运行检查」钉在
       自定义页签上——它才是这个软件里按得最勤的一颗按钮。 */
    { act: 'runCheck', label: '运行检查', icon: 'check' },
    { act: 'runNext', label: '下一步', icon: 'arrow' },
    { act: 'runReset', label: '重置到已保存', icon: 'trash' },
    { act: 'ribbonToggle', label: '收起功能区', icon: 'chevron' },
    { act: 'fullscreen', label: '全屏', icon: 'expand' }
  ];

  /* 预设只给一个「常用」分区。
     不要一上来给六个分区——用户第一次点开「自定义」时该看到一屏能认全的东西，
     不是一个待整理的仓库。 */
  var DEFAULT_CUSTOM = {
    groups: [
      {
        id: 'g-common', name: '常用', items: [
          { act: 'new', label: '新建配方', icon: 'plus' },
          { act: 'printCard', label: '打印配方卡', icon: 'printer' },
          { act: 'label', label: '酒标', icon: 'sparkle' },
          { act: 'cost', label: '年度花费', icon: 'coins' },
          { act: 'health', label: '数据体检', icon: 'check' }
        ]
      }
    ]
  };

  var CUSTOM_KEY = 'settings.ribbonCustom';

  function catalogOf(act) {
    for (var ci = 0; ci < CUSTOM_CATALOG.length; ci++) {
      if (CUSTOM_CATALOG[ci].act === act) return CUSTOM_CATALOG[ci];
    }
    return null;
  }

  /** 动作是否真的可执行。fullscreen 不走 ACTIONS 表，单判。 */
  function actExists(act) {
    if (act === 'fullscreen') return true;
    return !!(ACTIONS && ACTIONS[act]);
  }

  function cloneDefaultCustom() {
    return JSON.parse(JSON.stringify(DEFAULT_CUSTOM));
  }

  /** 读存档。形状有任何一处不对就整体回落默认——
      半信半疑地用一半配置，比干脆用默认更难排查。 */
  function readCustom() {
    var v = null;
    try { v = UI.store.get(CUSTOM_KEY); } catch (e) { v = null; }
    if (!v || !Array.isArray(v.groups) || !v.groups.length) return cloneDefaultCustom();
    for (var i = 0; i < v.groups.length; i++) {
      var g = v.groups[i];
      if (!g || typeof g.name !== 'string' || !Array.isArray(g.items)) return cloneDefaultCustom();
    }
    return v;
  }

  function writeCustom(obj) {
    try { UI.store.set(CUSTOM_KEY, obj); } catch (e) { toast('自定义功能区没存下来', 'warn'); }
  }

  /** 渲染自定义页签的分区（复用普通页签的 .rb-group 结构，外观完全一致） */
  function customGroupsHtml() {
    var cfg = readCustom();
    var html = '';
    for (var i = 0; i < cfg.groups.length; i++) {
      var g = cfg.groups[i];
      if (!g.items.length) continue;
      var btns = '';
      for (var k = 0; k < g.items.length; k++) {
        var it = g.items[k];
        var cat = catalogOf(it.act);
        var ic = it.icon || (cat && cat.icon) || 'arrow';
        var label = it.label || (cat && cat.label) || it.act;
        if (!actExists(it.act)) {
          btns += '<button type="button" class="rb-btn is-missing" disabled ' +
            'title="这个动作在当前版本不存在（' + attr(it.act) + '），可以到「编辑」里换成别的">' +
            icon('alert', 13) + '<span>' + esc(label) + '</span></button>';
        } else {
          btns += '<button type="button" class="rb-btn" ' +
            (it.act === 'fullscreen' ? 'data-rb-fs="1"' : 'data-act="' + attr(it.act) + '"') +
            ' title="' + attr(label) + '">' +
            icon(ic, 13) + '<span>' + esc(label) + '</span></button>';
        }
      }
      /* 与普通页签同一套结构（v1.8 复原 v1.4）：
         按钮在上按列堆积、分区名在下。自定义页签不该长得跟别的页签不一样。 */
      html += '<div class="rb-group"><div class="rb-rows">' + btns + '</div>' +
        '<div class="rb-group__name">' + esc(g.name) + '</div></div>';
    }
    /* 尾部分区「管理」永远在，且不可删。
       否则用户把自定义清空之后就没有入口再改回来了。 */
    html += '<div class="rb-group"><div class="rb-rows">' +
      '<button type="button" class="rb-btn" data-act="customEdit" title="编辑自定义功能区">' +
      icon('edit', 13) + '<span>编辑</span></button>' +
      '<button type="button" class="rb-btn" data-act="customReset" title="恢复成预设的「常用」分区">' +
      icon('trash', 13) + '<span>恢复预设</span></button>' +
      '</div><div class="rb-group__name">管理</div></div>';
    return html;
  }

  /* ---------------------------------------------------------------------
   * 编辑器
   * 用"全量重绘"而不是局部同步：这里有增删改排四类操作，
   * 局部同步一旦漏一处就会出现"界面上还有、存档里没有"，
   * 而重绘的代价只是几十个节点，不值得为它引入状态同步 bug。
   * -------------------------------------------------------------------*/
  var customDraft = null;

  function openCustomEditor() {
    customDraft = readCustom();
    var m = Shell.modal({
      title: '自定义功能区',
      sub: '每个按钮只能指向一个已有动作；不能写脚本',
      body: '<div id="ce-body"></div>',
      actions: [
        { label: '取消', kind: 'ghost' },
        { label: '恢复预设', kind: 'ghost', act: function () { customDraft = cloneDefaultCustom(); paintCustomEditor(m); return false; } },
        {
          label: '保存', kind: 'primary', act: function () {
            var before = customDraft.groups.length;
            /* 校验：空分区丢掉、空动作丢掉、名字兜底。**不静默修改用户的东西**——
               丢掉几条要明确告诉他。 */
            var dropped = 0, groups = [];
            for (var i = 0; i < customDraft.groups.length; i++) {
              var g = customDraft.groups[i];
              var items = [];
              for (var k = 0; k < (g.items || []).length; k++) {
                var it = g.items[k];
                if (!it || !it.act) { dropped++; continue; }
                var cat = catalogOf(it.act);
                items.push({
                  act: it.act,
                  label: (it.label || (cat && cat.label) || it.act).slice(0, 20),
                  icon: it.icon || (cat && cat.icon) || 'arrow'
                });
              }
              if (!items.length) { dropped++; continue; }
              groups.push({ id: g.id || ('g-' + Date.now().toString(36) + '-' + i), name: (g.name || '未命名分区').slice(0, 10), items: items });
            }
            if (!groups.length) {
              toast('至少要留一个分区、分区里至少一个按钮', 'warn', 3600);
              return false;  /* 不关弹窗，让用户接着改 */
            }
            writeCustom({ groups: groups });
            rerenderRibbon();
            if (dropped) toast('已保存；有 ' + dropped + ' 个空分区或空按钮被跳过', 'info', 3600);
            else toast('自定义功能区已保存', 'ok', 2400);
            return undefined;   /* 交回弹窗自己关 */
          }
        }
      ]
    });
    paintCustomEditor(m);
    /* 点击委托**只绑一次**，绑在 #ce-body 这个不会被替换的容器上。
       之前写在 paintCustomEditor 里配 {once:true}：每重绘一次就多一个
       "还没被触发过"的监听，点一下会被执行 N 次（删一个按钮变成删三个）。
       这类 bug 在只有一两次重绘时完全看不出来。 */
    bindCustomEditorClicks(m);
  }

  function bindCustomEditorClicks(m) {
    var box = m.query('#ce-body');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-ce]') : null;
      if (!b) return;
      var op = b.getAttribute('data-ce');
      var gi = num(b.getAttribute('data-g'), 0);
      var ii = num(b.getAttribute('data-i'), 0);
      var gs = customDraft.groups;
      if (op === 'gadd') {
        gs.push({ id: 'g-' + Date.now().toString(36), name: '新分区', items: [{ act: 'new', label: '新建配方', icon: 'plus' }] });
      } else if (op === 'iadd') {
        if (gs[gi]) gs[gi].items.push({ act: 'new', label: '新建配方', icon: 'plus' });
      } else if (op === 'gdel') {
        if (gs.length <= 1) { toast('至少要留一个分区', 'warn', 2600); return; }
        gs.splice(gi, 1);
      } else if (op === 'idel') {
        if (gs[gi]) gs[gi].items.splice(ii, 1);
      } else if (op === 'gup' && gi > 0) {
        var t = gs[gi - 1]; gs[gi - 1] = gs[gi]; gs[gi] = t;
      } else if (op === 'gdown' && gi < gs.length - 1) {
        var t2 = gs[gi + 1]; gs[gi + 1] = gs[gi]; gs[gi] = t2;
      } else {
        return;
      }
      paintCustomEditor(m);
    });
  }

  function paintCustomEditor(m) {
    var box = m.query('#ce-body');
    if (!box) return;
    var h = '';
    for (var i = 0; i < customDraft.groups.length; i++) {
      var g = customDraft.groups[i];
      h += '<section class="ce-group" data-g="' + i + '">' +
        '<div class="ce-group__head">' +
          '<input class="input ce-name" data-g="' + i + '" maxlength="10" value="' + attr(g.name || '') + '" aria-label="分区名" placeholder="分区名">' +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn btn-quiet btn-icon" data-ce="gup" data-g="' + i + '" title="上移">↑</button>' +
          '<button type="button" class="btn btn-quiet btn-icon" data-ce="gdown" data-g="' + i + '" title="下移">↓</button>' +
          '<button type="button" class="btn btn-quiet btn-icon" data-ce="gdel" data-g="' + i + '" title="删除这个分区">' + icon('trash', 14) + '</button>' +
        '</div>';
      for (var k = 0; k < g.items.length; k++) {
        var it = g.items[k];
        var opts = '';
        for (var c = 0; c < CUSTOM_CATALOG.length; c++) {
          var ca = CUSTOM_CATALOG[c];
          opts += '<option value="' + attr(ca.act) + '"' + (ca.act === it.act ? ' selected' : '') + '>' +
            esc(ca.label) + '</option>';
        }
        h += '<div class="ce-item" data-g="' + i + '" data-i="' + k + '">' +
          '<input class="input ce-label" data-g="' + i + '" data-i="' + k + '" maxlength="20" value="' + attr(it.label || '') + '" aria-label="按钮文字" placeholder="按钮文字">' +
          '<select class="input ce-act" data-g="' + i + '" data-i="' + k + '" aria-label="指向的动作">' + opts + '</select>' +
          '<button type="button" class="btn btn-quiet btn-icon" data-ce="idel" data-g="' + i + '" data-i="' + k + '" title="删除这个按钮">' + icon('x', 14) + '</button>' +
          '</div>';
      }
      h += '<button type="button" class="btn btn-ghost ce-add-item" data-ce="iadd" data-g="' + i + '">' +
        icon('plus', 13) + ' 加一个按钮</button>' +
        '</section>';
    }
    h += '<button type="button" class="btn btn-ghost" data-ce="gadd">' + icon('plus', 13) + ' 加一个分区</button>' +
      '<p class="ce-hint">按钮只能指向软件已有的动作。如果你想要的功能不在列表里，那说明它还没做出来——' +
      '这一版的自定义只负责"摆放"，不负责"发明"。</p>';
    box.innerHTML = h;

    /* 输入：实时写回草稿，但**不重绘**（重绘会把输入框焦点丢掉，
       打字打到一半光标跳走是这类编辑器最典型的坏体验）。 */
    box.querySelectorAll('.ce-name').forEach(function (el) {
      el.addEventListener('input', function () {
        var gi = num(el.getAttribute('data-g'), 0);
        if (customDraft.groups[gi]) customDraft.groups[gi].name = el.value;
      });
    });
    box.querySelectorAll('.ce-label').forEach(function (el) {
      el.addEventListener('input', function () {
        var gi = num(el.getAttribute('data-g'), 0), ii = num(el.getAttribute('data-i'), 0);
        var g = customDraft.groups[gi];
        if (g && g.items[ii]) g.items[ii].label = el.value;
      });
    });
    box.querySelectorAll('.ce-act').forEach(function (el) {
      el.addEventListener('change', function () {
        var gi = num(el.getAttribute('data-g'), 0), ii = num(el.getAttribute('data-i'), 0);
        var g = customDraft.groups[gi];
        if (!g || !g.items[ii]) return;
        var cat = catalogOf(el.value);
        g.items[ii].act = el.value;
        g.items[ii].icon = (cat && cat.icon) || 'arrow';
        /* 换动作时，若按钮文字还是上一个动作的默认文字，就跟着换——
           用户改了名字的不动他。 */
        if (cat && (!g.items[ii].label || g.items[ii].label === (catalogOf(g.items[ii].act) || {}).label)) {
          g.items[ii].label = cat.label;
        }
        paintCustomEditor(m);
      });
    });

  }

  /** 重绘整条功能区（自定义改动后调用）。
      innerHTML 换掉的是 #ribbon 的子节点，绑在 #ribbon 上的点击委托是父节点，
      不会跟着丢；但子节点里的拖动条会重建，所以要把 resizer 重新接一次。 */
  function rerenderRibbon() {
    var host = document.getElementById('ribbon');
    if (!host) return;
    host.innerHTML = ribbonHtml();
    selectTab(rbState.tab, false);
    setCollapsed(rbState.collapsed, false);
    syncRibbonState();
    syncFsUi();
    initLayoutResizers();
  }
  Shell.rerenderRibbon = rerenderRibbon;

  /** 视图注册后只重画功能区（v1.6：「视图」页签的 10 个入口从 views 现读）。
   *  没 initRibbon 之前不能画：那时 #ribbon 还没有页签条，也没有 rbState 的
   *  任何初始化（分辨率/折叠都是默认值），提前画一次只会把状态画错，
   *  然后 initRibbon 再画一次盖掉 —— 中间那一帧是闪的。 */
  function rerenderRibbonViews() {
    if (!rbReady) return;
    rerenderRibbon();
  }

  /* 当前视图 → 应当高亮的页签。
   *
   * 只有两个判断值得解释，其余是字面对应：
   *   · tasting（品鉴）→ 分析：品鉴产出的是**事后**才看的数据（感官分、缺陷描述），
   *     和「分析」页签里的 A-B 对比、年度统计是同一类动作；
   *     「记录」页签里的四项全是"事情正在发生时往里填"（批次、酿造日、装瓶），
   *     品鉴放进去会让那一列变成两类动作混排。所以归「分析」。
   *   · settings → 视图：设置页本身不产出内容，用户去那里通常就是调界面
   *     （分辨率 / 字号 / 侧栏都在这一页），与「视图」页签是同一件事。
   *   · tools / classic 归「设计」：这两个页签里的"工具集 / 经典配方库"按钮
   *     指向的就是这两个视图，页签必须跟着走，否则高亮与按钮对不上。
   */
  var TAB_OF_VIEW = {
    recipe: 'design', ingredient: 'design', tools: 'design', classic: 'design',
    batch: 'record', brewday: 'record',
    report: 'delivery',
    analysis: 'analysis', tasting: 'analysis',
    settings: 'view'
  };

  var rbState = { tab: 'file', collapsed: false, res: '1080', font: 'std', rail: false, pin: false };
  /* initRibbon 是否已经画过一遍。视图注册（60-app）发生在 initRibbon 之前，
     那时不能重画功能区 —— 见 rerenderRibbonViews 的注释。 */
  var rbReady = false;

  function readSetting(key, def) {
    try {
      var v = UI.store.get('settings.' + key);
      return (v === undefined || v === null) ? def : v;
    } catch (e) { return def; }
  }

  /* 首屏前先把 html 上的三个属性写对，避免"先按 1080 排一遍、再跳成 720"的闪动。
     本文件在 body 末尾执行，此时 00-core 的 Store 已可读。 */
  (function earlyUiAttrs() {
    var h = document.documentElement;
    if (!h) return;
    var r = String(readSetting('resPreset', '1080'));
    h.setAttribute('data-res', (r === '1440' || r === '720') ? r : '1080');
    h.setAttribute('data-font', String(readSetting('fontScale', 'std')) === 'lg' ? 'lg' : 'std');
    h.setAttribute('data-nav', readSetting('sidebarCollapsed', false) ? 'rail' : 'open');
  })();

  /* ---------------------------------------------------------- M1. 渲染 */

  /**
   * 「视图」页签的第一个分区：10 个视图入口（v1.6）。
   *
   * 为什么现场从 views 生成而不是写进 RB_TABS：
   *   ① 静态表在模块加载时求值，那时注册表还是空的（60-app 之后才填）；
   *   ② 顺序必须是注册顺序 —— 那个顺序同时就是 Alt+1..9/0 的键位映射，
   *      两份顺序一旦分叉，界面上写着「配方卡」的按钮按 Alt+5 会跳到别处。
   * 角标（kbd）不是装饰：左侧导航删掉后，这是用户唯一看得见快捷键的地方。
   */
  function viewGroup() {
    if (!views.length) return null;
    var items = [];
    for (var i = 0; i < views.length; i++) {
      var v = views[i];
      items.push({
        label: v.label || v.id,
        /* v1.7 横排后一个字的位置都要算：视图名保持原样进 title，
           按钮上最多 4 个字（"经典配方库"→"经典配方"）。 */
        short: String(v.label || v.id).slice(0, 4),
        icon: v.icon || 'info',
        go: v.id,
        kbd: (i === 9 ? '0' : String(i + 1))
      });
    }
    /* 分区名从"转到视图（Alt+1…0）"缩成"转到"：横排布局里分区名是行内的一小段字，
       十几个字的分区名会把整行顶掉。Alt 提示保留在每个按钮的 title 里。 */
    return { name: '转到', items: items };
  }

  /** 某个页签要渲染的分区列表（视图页签的第一个分区是动态的） */
  function groupsOfTab(t) {
    if (!t) return [];
    if (t.id === 'custom') return [];
    if (t.id === 'view') {
      var g = viewGroup();
      return g ? [g].concat(t.groups || []) : (t.groups || []).slice();
    }
    return t.groups || [];
  }

  function ribbonHtml() {
    var tabsHtml = '', panelsHtml = '';
    for (var i = 0; i < RB_TABS.length; i++) {
      var t = RB_TABS[i];
      tabsHtml += '<button type="button" class="ribbon__tab" role="tab" ' +
        'id="rb-tab-' + attr(t.id) + '" data-rb-tab="' + attr(t.id) + '" ' +
        'aria-controls="rb-panel-' + attr(t.id) + '" aria-selected="false">' +
        esc(t.label) + '</button>';

      /* 自定义页签的分区不在静态表里，现场从存档读。 */
      if (t.id === 'custom') {
        panelsHtml += '<div class="ribbon__panel rb-panel" id="rb-panel-' + attr(t.id) + '" ' +
          'role="tabpanel" aria-labelledby="rb-tab-' + attr(t.id) + '" ' +
          'data-rb-panel="' + attr(t.id) + '">' + customGroupsHtml() + '</div>';
        continue;
      }

      var groups = groupsOfTab(t);
      var groupsHtml = '';
      for (var j = 0; j < groups.length; j++) {
        var g = groups[j];
        var btns = '';
        for (var k = 0; k < g.items.length; k++) {
          var it = g.items[k];
          /* kbd 走 <kbd class="rb-btn__kbd">：视图按钮上的 Alt 角标。
             title 里也带一次（读屏与悬停都能拿到）。 */
          var hint = it.kbd ? '（Alt+' + it.kbd + '）' : '';
          /* 按钮宽度由内容决定（列方向的列宽 = 该列最宽的那颗）。
             长名字仍走 short：视图名在某些档下带 Alt 角标，一行塞不下。 */
          var face = it.short || it.label;
          var full = it.title || it.label;
          btns += '<button type="button" class="rb-btn" ' +
            (it.go ? 'data-go="' + attr(it.go) + '"' : 'data-act="' + attr(it.act) + '"') +
            (it.kbd ? ' data-kbd="' + attr(it.kbd) + '"' : '') +
            ' title="' + attr(full + hint) + '">' +
            icon(it.icon, 13) + '<span>' + esc(face) + '</span>' +
            (it.kbd ? '<kbd class="rb-btn__kbd" aria-hidden="true">' + esc(it.kbd) + '</kbd>' : '') +
            '</button>';
        }
        /* v1.8：复原 v1.4「Aspen Plus 那一版」的形态 —— 按钮在上、分区名在下。
           用户原话："功能区实在太丑了，还是调回之前参考 aspen plus 那一版吧，
           只是布局适当紧凑一点"，所以结构回到 v1.4，只有尺寸令牌比 v1.4 小一档
           （按钮 24 / 按钮区 50 / 面板 78，v1.4 是 26 / 54 / 92）。
           .rb-rows 是 flex 列方向自动换行：3 颗按钮自然排成 2+1 两列，
           分区名因此能对齐在同一水平线上（Aspen 的分组名也在下方）。 */
        groupsHtml += '<div class="rb-group"><div class="rb-rows">' + btns + '</div>' +
          '<div class="rb-group__name">' + esc(g.name) + '</div></div>';
      }

      panelsHtml += '<div class="ribbon__panel rb-panel" id="rb-panel-' + attr(t.id) + '" ' +
        'role="tabpanel" aria-labelledby="rb-tab-' + attr(t.id) + '" ' +
        'data-rb-panel="' + attr(t.id) + '">' + groupsHtml + '</div>';
    }

    /* 右端两个工具：全屏 + 收起。
       全屏放在这里而不是顶栏，是因为它跟「功能区收不收起」是同一类"给正文腾地方"的操作；
       顶栏右侧已经有三颗按钮（新建/保存/…），再塞一颗会挤。 */
    return '<div class="ribbon__tabs" role="tablist" aria-label="功能区">' + tabsHtml +
      '<div class="ribbon__tools">' +
        '<button type="button" class="ribbon__fs" id="ribbon-fs" ' +
        'aria-pressed="false" title="全屏（Ctrl+Shift+F）">' +
        icon('expand', 13) + '<span id="ribbon-fs-label">全屏</span></button>' +
        '<button type="button" class="ribbon__toggle" id="ribbon-toggle" ' +
        'aria-expanded="true" aria-controls="ribbon-panels" title="收起功能区（Ctrl+F1）">' +
        icon('chevron', 13) + '<span id="ribbon-toggle-label">收起</span></button>' +
      '</div>' +
      '</div>' +
      '<div class="ribbon__panels" id="ribbon-panels">' + panelsHtml + '</div>' +
      /* 面板下缘的拖动条：上下拉改变功能区高度。
         它自己带样式（39b 的 installGlobalStyle），这里只给定位类。 */
      '<div class="resizer resizer--y ribbon__resizer" id="ribbon-resizer" ' +
      'tabindex="0" aria-label="调整功能区高度（双击复位）"></div>';
  }

  function findTab(id) {
    for (var i = 0; i < RB_TABS.length; i++) if (RB_TABS[i].id === id) return RB_TABS[i];
    return null;
  }

  function selectTab(id, expand) {
    if (!findTab(id)) return;
    rbState.tab = id;
    var host = document.getElementById('ribbon');
    if (host) {
      var tabs = host.querySelectorAll('[data-rb-tab]');
      for (var i = 0; i < tabs.length; i++) {
        var on = tabs[i].getAttribute('data-rb-tab') === id;
        tabs[i].classList.toggle('is-on', on);
        tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      var panels = host.querySelectorAll('[data-rb-panel]');
      for (var j = 0; j < panels.length; j++) {
        panels[j].classList.toggle('is-on', panels[j].getAttribute('data-rb-panel') === id);
      }
    }
    /* 折叠状态下点页签 = 用户想让面板出来，所以顺手展开（并落盘） */
    if (expand && rbState.collapsed) setCollapsed(false, true);
  }

  function setCollapsed(on, persist) {
    rbState.collapsed = !!on;
    var host = document.getElementById('ribbon');
    if (host) host.classList.toggle('is-collapsed', rbState.collapsed);
    var toggle = document.getElementById('ribbon-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', rbState.collapsed ? 'false' : 'true');
      toggle.title = (rbState.collapsed ? '展开功能区' : '收起功能区') + '（Ctrl+F1）';
      var lab = document.getElementById('ribbon-toggle-label');
      if (lab) lab.textContent = rbState.collapsed ? '展开' : '收起';
    }
    if (persist) persistSetting('ribbonCollapsed', rbState.collapsed);
    else syncRibbonState();
  }

  function setRes(k) {
    rbState.res = (k === '1440' || k === '720') ? k : '1080';
    try { document.documentElement.setAttribute('data-res', rbState.res); } catch (e) { /* 老浏览器忽略 */ }
    syncRibbonState();
    /* 用户拖过侧栏之后再换分辨率：把他的宽度夹进这一档的合理带宽。
       不直接复位——那是把用户刚做的动作当没发生；
       也不放任不管——720 档留 420px 侧栏会把正文挤没。 */
    var band = NAV_BAND[rbState.res] || NAV_BAND['1080'];
    if (navResizer) { try { navResizer.clampTo(band[0], band[1]); } catch (e2) { /* ignore */ } }
    /* 分辨率档换了，顶栏的按钮/胶囊尺寸也换了 → 名字能拖到的上限跟着变 */
    refreshTopNameMax();
  }

  function setFont(k) {
    rbState.font = (String(k) === 'lg') ? 'lg' : 'std';
    try { document.documentElement.setAttribute('data-font', rbState.font); } catch (e) { /* ignore */ }
    syncRibbonState();
  }

  /* v1.6：rail 的语义从"导航收成 62px 图标条"改成"整块左面板折叠为 0 宽"。
     左侧已经不是导航了（10 个视图入口搬到了功能区「视图」页签），
     62px 的图标条没有任何东西可放；而搜索框和树折到 62px 等于全废。
     属性名 data-nav 与存档键 sidebarCollapsed 保持不变：
     改名字会让老用户"折叠着面板"的偏好失效，升级后突然被 232px 挤一下。 */
  function setRail(on) {
    rbState.rail = !!on;
    try { document.documentElement.setAttribute('data-nav', rbState.rail ? 'rail' : 'open'); } catch (e) { /* ignore */ }
    syncRailBtn();
    syncRibbonState();
    /* 这里**不要**去动 navResizer 的值：折叠是"临时让出宽度"，不是"把宽度改成 0"。
       用户折叠前拖到 300px，展开回来必须还是 300px（宽度写在
       settings.resizer.navW 里）。折叠态的 0 由 CSS 的 !important 负责，
       与拖动记录的 --sidebar-w 是两件事。 */
  }

  /** 顶栏那颗左面板开合按钮的视觉状态（v1.6）。
   *  它是折叠后"回来的路"，所以状态必须与 data-nav 同步，而不是靠点击计数。 */
  function syncRailBtn() {
    var btn = document.getElementById('top-btn-left');
    if (!btn) return;
    btn.setAttribute('aria-pressed', rbState.rail ? 'false' : 'true');
    btn.title = (rbState.rail ? '显示' : '隐藏') + '左侧面板（Ctrl+B）';
  }

  /* is-on：当前视图 / 当前档位。功能区只有这一处"状态 → 视觉"的映射，
     新增带状态的按钮时改这里一处即可。 */
  function isActOn(act) {
    if (act === 'res1080') return rbState.res === '1080';
    if (act === 'res1440') return rbState.res === '1440';
    if (act === 'res720') return rbState.res === '720';
    if (act === 'fontStd') return rbState.font === 'std';
    if (act === 'fontLg') return rbState.font === 'lg';
    if (act === 'navOpen') return !rbState.rail;
    if (act === 'navRail') return rbState.rail;
    return false;
  }

  function syncRibbonState() {
    var host = document.getElementById('ribbon');
    if (!host) return;
    var btns = host.querySelectorAll('.rb-btn');
    for (var i = 0; i < btns.length; i++) {
      var go = btns[i].getAttribute('data-go');
      var act = btns[i].getAttribute('data-act');
      var on = go ? (go === activeId) : (act ? isActOn(act) : false);
      btns[i].classList.toggle('is-on', !!on);
      /* 视图类按钮表示"你在这一页"（aria-current），档位类按钮表示"这一档被选中"
         （aria-pressed）。两种语义不能都用 aria-pressed。 */
      if (go) {
        if (on) btns[i].setAttribute('aria-current', 'page');
        else btns[i].removeAttribute('aria-current');
      } else {
        btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
  }

  /* ---------------------------------------------------------- M2. 动作 */

  function toast(msg, kind, ms) {
    if (typeof Shell.toast === 'function') Shell.toast(msg, kind || 'info', ms || 3200);
  }

  /**
   * 等目标视图就绪后再执行。
   *
   * 为什么不用 setTimeout 一把梭：Shell.go() 走 hash，renderView 在 hashchange
   * 里才发生，中间隔着一次事件循环；写死 200ms 在不同机器上会时快时慢。
   * 这里轮询"视图 id 已激活 + 目标元素已出现"，两条都满足才动手，
   * 超时就给一句人话提示，绝不静默什么都不发生（死按钮是最难查的 bug）。
   */
  function whenReady(viewId, sel, label, fn) {
    var tries = 0;
    function attempt() {
      if (activeId === viewId) {
        var el = sel ? document.querySelector(sel) : null;
        if (!sel || el) {
          try { fn(el); } catch (e) { reportError(e, 'ribbon:' + (label || sel)); }
          return;
        }
      } else if (tries === 0) {
        /* 功能区自己发起的跳转：这一次不要因为 viewChanged 把页签切走
           （用户正在「文件」里点保存，不该被弹到「设计」） */
        if (activeId !== viewId) rbState.pin = true;
        Shell.go(viewId);
      }
      if (++tries > 45) {
        toast('「' + (label || '目标') + '」没有打开：请先在功能区「视图」页签进入对应视图再试', 'warn', 4000);
        return;
      }
      root.setTimeout(attempt, 45);
    }
    attempt();
  }

  function clickIn(viewId, sel, label, done) {
    whenReady(viewId, sel, label, function (el) {
      if (el) el.click();
      if (typeof done === 'function') done(el);
    });
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function fileSafe(s) {
    return String(s || 'recipe').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'recipe';
  }

  /** Blob 下载；file:// 下个别浏览器禁下载 → 返回 false，调用方退回"复制文本"弹窗 */
  function saveTextFile(name, text, mime) {
    try {
      var Blob = root.Blob;
      if (!Blob || !root.URL || !root.URL.createObjectURL) return false;
      var url = root.URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      root.setTimeout(function () {
        try { root.URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 200);
      return true;
    } catch (e) { return false; }
  }

  function copyFallback(title, sub, text) {
    Shell.modal({
      title: title,
      sub: sub,
      size: 'wide',
      body: '<p class="u-sm u-muted" style="margin-bottom:8px">当前浏览器不支持直接下载，' +
        '请手动复制下面内容，用记事本存成 .json 文件。</p>' +
        '<textarea class="input" readonly rows="14" style="width:100%;font-family:var(--mono);font-size:12.5px">' +
        esc(text) + '</textarea>',
      actions: [{ label: '关闭', kind: 'ghost' }]
    });
  }

  /* 单配方 JSON：结构与「设置 → 导出全部数据」的整包不同，用 kind 区分，
     导入时两种都认（见 adoptJson）。 */
  function exportRecipeJSON() {
    var r = UI.recipe();
    if (!r) { toast('还没有配方可导出', 'warn'); return; }
    var payload = {
      app: 'BrewLab Studio',
      kind: 'recipe',
      version: (BREW.Config && BREW.Config.VERSION) || '',
      exportedAt: new Date().toISOString(),
      recipe: r
    };
    var text = JSON.stringify(payload, null, 2);
    var name = 'fengyue-' + fileSafe(r.name) + '-' + stamp() + '.json';
    if (saveTextFile(name, text)) {
      toast('已导出《' + (r.name || '未命名') + '》· ' + name + '（' + fmt(text.length / 1024, 1) + ' KB）', 'ok', 3800);
    } else {
      copyFallback('导出配方 JSON', '把下面这段存成 ' + name, text);
    }
  }

  function importRecipeJSON() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) { drop(); return; }
      var reader = new root.FileReader();
      reader.onerror = function () { drop(); toast('读文件失败，请确认文件可读', 'error'); };
      reader.onload = function () {
        drop();
        var parsed = null;
        try { parsed = JSON.parse(String(reader.result || '')); }
        catch (e) { toast('这不是合法的 JSON 文件', 'error', 3800); return; }
        adoptJson(parsed, file.name);
      };
      reader.readAsText(file, 'utf-8');
    });

    document.body.appendChild(input);
    input.click();

    function drop() { if (input.parentNode) input.parentNode.removeChild(input); }
  }

  /**
   * 认两种 JSON：
   *   · 单配方（本功能区「导出 JSON」产出的 {kind:'recipe', recipe:{...}}，
   *     或者直接扔进来一份配方对象）
   *   · 整包备份（「设置 → 导出全部数据」产出的 {recipes:[], batches:[], ...}）
   * 认不出就明说认不出，不要"看起来导入成功但其实什么都没进来"。
   */
  function adoptJson(parsed, fileName) {
    if (!parsed || typeof parsed !== 'object') { toast('文件内容不是对象，无法导入', 'error'); return; }

    var rec = (parsed.recipe && typeof parsed.recipe === 'object') ? parsed.recipe : null;
    if (!rec && (Array.isArray(parsed.fermentables) || Array.isArray(parsed.hops))) rec = parsed;

    if (rec) { adoptRecipe(rec, fileName); return; }

    if (Array.isArray(parsed.recipes)) {
      if (!BREW.Store || typeof BREW.Store.importJSON !== 'function') {
        toast('存储模块未载入，无法导入整包数据', 'error');
        return;
      }
      Shell.confirm({
        title: '导入整包数据',
        message: '这是一份 BrewLab 备份（配方 ' + parsed.recipes.length + ' 份），将合并进现有数据。',
        detail: '同 id 的配方/批次保留更新时间较新的那份；现有数据不会被删除。',
        okLabel: '合并导入'
      }, function () {
        try {
          BREW.Store.importJSON(JSON.stringify(parsed), 'merge');
          if (UI.invalidateDB) UI.invalidateDB();
          toast('整包导入完成', 'ok');
          if (activeId) renderView(activeId, true);
        } catch (e) {
          toast('导入失败：' + ((e && e.message) || '文件格式不对'), 'error', 4200);
        }
      });
      return;
    }

    toast('认不出这份 JSON：既不是单配方，也不是 BrewLab 备份', 'error', 4400);
  }

  function adoptRecipe(obj, fileName) {
    var r = obj;
    try { r = UI.normalizeRecipe(obj); } catch (e) { r = obj; }
    if (!r || typeof r !== 'object') { toast('配方结构不对，无法导入', 'error'); return; }

    /* 一律换新 id：导入是"加一份"，不是"覆盖同 id 的那份"。
       用户从别人那里拿到同一份配方的两个版本时，覆盖是最坏的结果。 */
    r.id = UI.uid('r');
    r.createdAt = Date.now();
    r.updatedAt = Date.now();
    r.rev = num(r.rev, 1);
    if (!r.name) r.name = String(fileName || '导入的配方').replace(/\.json$/i, '') || '导入的配方';

    Shell.confirm({
      title: '导入配方',
      message: '把「' + r.name + '」作为一份新配方加入，不会覆盖任何已保存的配方。',
      detail: '导入后会打开这份配方；当前编辑中的内容若没保存请先取消、回去保存。',
      okLabel: '导入并打开'
    }, function () {
      UI.setRecipe(r);
      try { UI.store.saveRecipe(UI.clone(UI.recipe())); } catch (e) { /* 存不下也要能打开 */ }
      if (activeId === 'recipe') renderView('recipe', true);
      else Shell.go('recipe');
      toast('已导入《' + UI.recipe().name + '》', 'ok', 3600);
    });
  }

  function openShare(type) {
    var S = UI.Share;
    if (!S || typeof S.openModal !== 'function') {
      toast('分享模块未载入（js/41-ui-share.js）', 'warn', 3800);
      return;
    }
    /* 传类型不传配方：分享中心自己会读当前工作副本。
       传一份快照反而会让"用户改了参数再点分享"拿到旧数据。 */
    S.openModal({ type: type || 'recipe' });
  }

  function analysisTab(id) {
    whenReady('analysis', null, '分析', function () {
      var A = UI.Analysis;
      if (A && typeof A.go === 'function') { A.go(id); return; }
      var btn = document.querySelector('#view [data-an-tab="' + id + '"]');
      if (btn) btn.click();
      else toast('分析页签打不开', 'warn');
    });
  }

  /* 「装瓶与成本」不是一个独立视图，它是批次详情里的两张卡（46-ui-batch）。
     所以这里滚到装瓶卡的第一个输入框（#pk-date），而不是新开一个页面。 */
  function openPackaging() {
    whenReady('batch', null, '酿造记录', function () {
      var el = document.getElementById('pk-date');
      if (!el) {
        toast('先在「新建批次」里建一锅，装瓶与成本才有地方填', 'info', 4200);
        return;
      }
      var card = (el.closest ? el.closest('.card') : null) || el;
      try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { card.scrollIntoView(); }
      try { el.focus({ preventScroll: true }); } catch (e2) { /* ignore */ }
    });
  }

  /* 「数据体检」在工程里唯一真实存在的出口是「设置 → 数据」卡：
     存储占用 / 数据条数 / 单位一致性（58-ui-settings 的 consistencyRow）。
     没有单独的自检模块，就不假造一个页面。 */
  function openHealth() {
    whenReady('settings', null, '设置', function () {
      var heads = document.querySelectorAll('#view .set-group .card__head h2');
      var card = null;
      for (var i = 0; i < heads.length; i++) {
        if ((heads[i].textContent || '').trim() === '数据') {
          card = heads[i].closest ? heads[i].closest('.set-group') : null;
          break;
        }
      }
      if (card) {
        try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { card.scrollIntoView(); }
        toast('数据体检：看「数据」卡里的存储占用、条数与单位一致性', 'info', 4200);
      } else {
        toast('设置页的数据卡没找到，请往下翻到「数据」', 'warn', 3600);
      }
    });
  }

  /* 设置写入口：58 载入后统一走 Settings.set（它会跑 apply 副作用），
     载入前（理论上不会发生）退回直接写 Store。
     无论走哪条路，最后都自己 applyLocal 一次 —— 视觉状态不能依赖
     "另一个文件里的 apply 分支记得处理这个 key"，那是两条独立的事实来源。 */
  function persistSetting(key, val) {
    var S = UI.Settings;
    if (S && typeof S.set === 'function') {
      S.set(key, val);
    } else {
      UI.store.set('settings.' + key, val);
    }
    applyLocal(key, val);
    /* 设置页开着时同步重绘：否则页签里的按钮与设置页的下拉会各说各话 */
    if (activeId === 'settings') renderView('settings', true);
  }

  function applyLocal(key, val) {
    if (key === 'resPreset') setRes(val);
    else if (key === 'fontScale') setFont(val);
    else if (key === 'sidebarCollapsed') setRail(val);
    else if (key === 'ribbonCollapsed') setCollapsed(!!val, false);
  }
  Shell.applyUiSetting = applyLocal;

  /* 「校验」三个入口的唯一转发点。
     为什么要这一层而不是直接在 ACTIONS 里调 UI.RunPanel：
     41b 万一没载入（旧缓存、单文件调试），按钮必须给一句人话，
     而不是抛 TypeError 之后什么都不发生——死按钮是最难查的故障。 */
  function runPanel(kind) {
    var R = UI.RunPanel;
    if (!R) { toast('运行面板未载入（js/41b-ui-runpanel.js），请刷新页面', 'warn', 4200); return; }
    if (kind === 'reset') { R.reset(); return; }
    if (kind === 'next') { R.open({ run: true, focusSteps: true }); return; }
    R.open({ run: true });
  }

  var ACTIONS = {
    /* ---- 文件 ---- */
    'new': function () { whenReady('recipe', null, '配方设计', function () { Bus.emit('requestNew'); }); },
    'save': function () { whenReady('recipe', null, '配方设计', function () { Bus.emit('requestSave'); }); },
    'saveAs': function () { clickIn('recipe', '[data-act="saveas"]', '另存为'); },
    'exportJson': function () { exportRecipeJSON(); },
    'importJson': function () { importRecipeJSON(); },
    'share': function () { openShare('recipe'); },   /* v1.2 的老键，老自定义存档还在用 */
    'printCard': function () {
      /* 先切到「配方卡」页签再点打印：停在「酒标」页签时直接点打印，
         打出来的是酒标 —— 按钮叫"打印配方卡"就必须打配方卡。 */
      clickIn('report', '[data-rtab="card"]', '配方卡', function () {
        root.setTimeout(function () {
          var b = document.querySelector('#view [data-act="print"]');
          if (b) b.click(); else toast('配方卡打印按钮没找到', 'warn');
        }, 80);
      });
    },

    /* ---- 设计 ---- */
    'stock': function () { clickIn('ingredient', '[data-mode="stock"]', '库存'); },
    'shopping': function () { clickIn('ingredient', '[data-mode="shopping"]', '采购'); },

    /* ---- 记录 ---- */
    'newBatch': function () { clickIn('batch', '[data-act="new-batch"]', '新建批次'); },
    'packaging': function () { openPackaging(); },

    /* ---- 分析 ---- */
    'stats': function () { analysisTab('stats'); },
    'cost': function () { analysisTab('cost'); },
    'lineage': function () { analysisTab('lineage'); },
    'ab': function () { analysisTab('ab'); },
    'health': function () { openHealth(); },

    /* ---- 交付 ---- */
    'reportPng': function () { clickIn('report', '[data-act="png"]', '导出 PNG'); },
    'label': function () { clickIn('report', '[data-rtab="label"]', '酒标'); },

    /* ---- 校验（v1.6，41b） ----
       三个动作都落在 UI.RunPanel 上：入口在功能区，实现在 41b。
       这里不做任何"跑一遍计算"的事——运行面板跑的是检查清单，
       计算本身是即时的（见 41b 文件头 §一）。 */
    'runCheck': function () { runPanel('open'); },
    'runNext': function () { runPanel('next'); },
    'runReset': function () { runPanel('reset'); },

    /* ---- 视图 ---- */
    'ribbonToggle': function () { setCollapsed(!rbState.collapsed, true); },
    'res1080': function () { persistSetting('resPreset', '1080'); },
    'res1440': function () { persistSetting('resPreset', '1440'); },
    'res720': function () { persistSetting('resPreset', '720'); },
    'fontStd': function () { persistSetting('fontScale', 'std'); },
    'fontLg': function () { persistSetting('fontScale', 'lg'); },
    'navOpen': function () { persistSetting('sidebarCollapsed', false); },
    'navRail': function () { persistSetting('sidebarCollapsed', true); },

    /* ---- 自定义功能区 ---- */
    'customEdit': function () { openCustomEditor(); },
    'customReset': function () {
      writeCustom(cloneDefaultCustom());
      rerenderRibbon();
      toast('自定义功能区已恢复成预设', 'ok', 2400);
    }
  };

  /* ---- 分享（v1.7）：11 种对象各一颗按钮 ----
     为什么一类型一个 act 键，而不是"一个 act + 一个参数"：
     自定义功能区的目录（CUSTOM_CATALOG）是**唯一一份**可选动作清单，
     编辑器里用户是从下拉里挑"动作"的，下拉的 value 就是 act。
     带参数的动作在这个数据结构里表达不出来（选了"分享"还得再选类型），
     所以拆成显式键；代价只是 ACTIONS 多十行，由下面的循环生成。 */
  var SHARE_ACT_TEXT = {
    shareRecipe: 'recipe', shareMalt: 'malt', shareHop: 'hop', shareYeast: 'yeast',
    shareAdjunct: 'adjunct', shareLibrary: 'library', shareBatches: 'batches',
    shareBrewday: 'brewday', shareLabel: 'label', shareAnalysis: 'analysis',
    shareInventory: 'inventory'
  };
  (function bindShareActions() {
    Object.keys(SHARE_ACT_TEXT).forEach(function (key) {
      ACTIONS[key] = (function (t) { return function () { openShare(t); }; })(SHARE_ACT_TEXT[key]);
    });
  })();

  /* ------------------------------------------------------- M3. 事件绑定 */

  function onRibbonClick(e) {
    var node = e.target;
    while (node && node !== document) {
      if (node.getAttribute) {
        if (node.id === 'ribbon-toggle') { setCollapsed(!rbState.collapsed, true); return; }

        var tab = node.getAttribute('data-rb-tab');
        if (tab) {
          /* 点当前页签 = 收起/展开整条面板（Office 里再点一次"开始"就收起来） */
          if (rbState.tab === tab) setCollapsed(!rbState.collapsed, true);
          else selectTab(tab, true);
          return;
        }

        var go = node.getAttribute('data-go');
        if (go) {
          if (activeId !== go) { rbState.pin = true; Shell.go(go); }
          return;
        }

        var act = node.getAttribute('data-act');
        if (act && ACTIONS[act]) { ACTIONS[act](); return; }
        /* 自定义页签里拖进来的「全屏」按钮走这条：它的动作不在 ACTIONS 表里
           （ACTIONS 是全站动作字典，全屏是 40 自己的事，硬塞进去会让字典多一个
           只有一处用的条目）。 */
        if (node.getAttribute('data-rb-fs')) { toggleFullscreen(); return; }
      }
      node = node.parentNode;
    }
  }

  function initRibbon() {
    var host = document.getElementById('ribbon');
    if (!host) return;

    host.innerHTML = ribbonHtml();
    host.addEventListener('click', onRibbonClick);

    setRes(readSetting('resPreset', '1080'));
    setFont(readSetting('fontScale', 'std'));
    setRail(readSetting('sidebarCollapsed', false));
    setCollapsed(readSetting('ribbonCollapsed', false), false);
    selectTab(rbState.tab, false);
    syncRibbonState();

    /* Ctrl+F1 收起/展开（Office 习惯）。Alt+1..0 那条监听在 init 里，
       它遇到 ctrlKey 直接 return，两边不会抢。 */
    document.addEventListener('keydown', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (String(e.key || '').toUpperCase() !== 'F1') return;
      e.preventDefault();
      setCollapsed(!rbState.collapsed, true);
    });

    /* 顶栏最左那颗"左面板开合"（v1.6）+ Ctrl+B。
       为什么要有它：左面板折叠后整块宽度为 0，功能区里那颗「展开」要三次点击
       （点「视图」页签 → 找分区 → 点按钮）才能回来。用户会以为面板被删了。
       这颗按钮常驻顶栏，收起后仍在原地，一秒就能回来。 */
    var btnLeft = document.getElementById('top-btn-left');
    if (btnLeft && !btnLeft._lpBound) {
      btnLeft._lpBound = true;
      btnLeft.addEventListener('click', function () {
        persistSetting('sidebarCollapsed', !rbState.rail);
      });
    }
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (String(e.key || '').toLowerCase() !== 'b') return;
      /* 焦点在输入框里时 Ctrl+B 是浏览器的"加粗"，不抢 */
      var t = e.target;
      if (t && t.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t && t.isContentEditable) return;
      e.preventDefault();
      persistSetting('sidebarCollapsed', !rbState.rail);
    });

    /* 视图变了，页签跟着走（功能区自己发起的跳转除外，见 rbState.pin） */
    Bus.on('viewChanged', function (p) {
      var id = p && p.id;
      if (rbState.pin) { rbState.pin = false; syncRibbonState(); return; }
      var tab = TAB_OF_VIEW[id];
      if (tab) selectTab(tab, false);
      syncRibbonState();
    });

    initFullscreen();
    initLayoutResizers();
    rbReady = true;
  }

  /* ======================================================================
   * 全屏（v1.5）
   * ----------------------------------------------------------------------
   * 为什么不用 F11：F11 是浏览器的，脚本抢不过来（preventDefault 对
   * 浏览器级快捷键无效），硬抢只会让用户以为快捷键坏了。用 Ctrl+Shift+F
   * 是 Adobe / VS Code 一系的习惯，不与浏览器冲突。
   *
   * 为什么还要处理失败：file:// 下一般可用，但页面若被套在 iframe 里
   * 而外层没给 allowfullscreen，requestFullscreen 会 reject。这时必须
   * 明说"当前环境不允许"，不能静默失败——用户会以为按钮是装饰。
   * ====================================================================*/
  function isFs() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function syncFsUi() {
    var btn = document.getElementById('ribbon-fs');
    var lab = document.getElementById('ribbon-fs-label');
    if (!btn) return;
    var on = isFs();
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (lab) lab.textContent = on ? '退出全屏' : '全屏';
    btn.setAttribute('title', on ? '退出全屏（Ctrl+Shift+F）' : '全屏（Ctrl+Shift+F）');
  }

  function toggleFullscreen() {
    var d = document;
    var el = d.documentElement;
    var on = isFs();
    try {
      if (!on) {
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!req) { toast('这个浏览器不支持全屏', 'warn', 3000); return; }
        var r = req.call(el);
        /* 有的实现返回 undefined，有的返回 Promise —— 两种都要接 */
        if (r && typeof r.then === 'function') {
          r.then(syncFsUi, function () {
            toast('当前环境不允许全屏（页面可能被外层窗口限制）', 'warn', 4200);
          });
        }
      } else {
        var exit = d.exitFullscreen || d.webkitExitFullscreen;
        if (exit) {
          var r2 = exit.call(d);
          if (r2 && typeof r2.then === 'function') r2.then(syncFsUi, function () { /* ignore */ });
        }
      }
    } catch (e) {
      toast('当前环境不允许全屏（页面可能被外层窗口限制）', 'warn', 4200);
    }
  }

  function initFullscreen() {
    var btn = document.getElementById('ribbon-fs');
    if (btn && !btn._fsBound) {
      btn._fsBound = true;
      btn.addEventListener('click', toggleFullscreen);
    }
    if (!document._fsBound) {
      document._fsBound = true;
      document.addEventListener('fullscreenchange', syncFsUi);
      document.addEventListener('webkitfullscreenchange', syncFsUi);
      document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
        if (String(e.key || '').toLowerCase() !== 'f') return;
        e.preventDefault();
        toggleFullscreen();
      });
    }
    syncFsUi();
  }

  /* ======================================================================
   * 可拖动的布局（v1.5）：左导航宽度 / 功能区高度
   * ----------------------------------------------------------------------
   * 两处都靠 CSS 自定义属性驱动，而不是直接写 width：
   *   · 左导航的宽度由 .app 的 grid-template-columns 读 --sidebar-w 决定，
   *     写 .sidebar 的 width 根本不生效（它是 grid item）；
   *   · 功能区面板高度由 --ribbon-panel-h 决定。
   * 直接写内联 height/width 会盖掉 .ribbon.is-collapsed 的 height:0，
   * 收起功能就废了；写自定义属性则两不相干。
   * ====================================================================*/
  var NAV_BAND = { '1080': [200, 340], '1440': [210, 360], '720': [170, 260] };
  var navResizer = null;

  /* ---- 顶栏配方名宽度（v1.6） ------------------------------------------
   * 三个数决定了用户能拖到哪：
   *   TOPNAME_MIN        再窄就只剩省略号，没有意义
   *   TOPNAME_PILLS_MIN  胶囊区的最小可读宽度（两颗胶囊 + 间隙）；
   *                      它是"被推向右"的那一方的底线 —— 标题再长也不能
   *                      把 IBU/SRM 挤成 0，那是关键数据不是装饰
   *   max                顶栏可用宽 − 眉标 − 按钮区 − 胶囊底线
   * 目标写的是 CSS 自定义属性 --topname-w（不是内联 width）：
   * 内联 width 会盖掉三档分辨率的自然宽度，切档时"名字宽度"不动，
   * 而旁边一切都动了。写变量则"用户拖过就听用户的、没拖过就听 CSS 的"。
   */
  var TOPNAME_MIN = 120;
  var TOPNAME_PILLS_MIN = 132;
  var nameResizer = null;
  var nameOpts = null;

  function topNameMax() {
    var tb = document.getElementById('topbar');
    var act = document.querySelector('.topbar__actions');
    if (!tb || !act) return 260;
    var cs = root.getComputedStyle ? root.getComputedStyle(tb) : null;
    var padL = cs ? (parseFloat(cs.paddingLeft) || 0) : 0;
    var padR = cs ? (parseFloat(cs.paddingRight) || 0) : 0;
    var gap = cs ? (parseFloat(cs.columnGap || cs.gap) || 16) : 16;
    var inner = tb.getBoundingClientRect().width - padL - padR;
    var btn = document.getElementById('top-btn-left');
    var eb = document.getElementById('top-eyebrow');
    var btnW = btn ? btn.getBoundingClientRect().width : 0;
    var actW = act.getBoundingClientRect().width;
    var ebW = eb ? eb.getBoundingClientRect().width : 0;
    /* 固定花销：左面板按钮 + 眉标 + 按钮区 + 3 个顶栏间距 + id 内间距 + 拖动条
       v1.9：眉标节点已从 HTML 删掉，所以 ebW 恒为 0（getElementById 返回 null
       走的就是这条空安全路径），"+8" 的那点内间距也不存在了。
       结果是配方名可拖的最大宽度自动多出约 70px —— 这正是删掉眉标该有的
       连带收益，不需要另写规则去补。 */
    var fixed = btnW + ebW + actW + gap * 3 + 8 + 7;
    return Math.max(TOPNAME_MIN, Math.round(inner - fixed - TOPNAME_PILLS_MIN));
  }

  /** 换档 / 改窗口大小后重算上限，并把当前宽度夹进去（不额外落盘就不会写） */
  function refreshTopNameMax() {
    if (!nameOpts || !nameResizer) return;
    nameOpts.max = topNameMax();
    if (nameResizer.get() > nameOpts.max) {
      try { nameResizer.clampTo(TOPNAME_MIN, nameOpts.max); } catch (e) { /* ignore */ }
    }
  }
  Shell.refreshTopNameMax = refreshTopNameMax;

  function initTopbarName() {
    var R = UI.Resizer;
    if (!R || typeof R.attach !== 'function') return;
    var h = document.getElementById('topbar-name-resizer');
    var box = document.getElementById('topbar-namebox');
    if (!h || !box || h._rz) return;
    h._rz = true;

    nameOpts = {
      handle: h,
      target: box,
      prop: '--topname-w',
      axis: 'x', dir: 1,
      min: TOPNAME_MIN,
      max: topNameMax(),
      key: 'topbarName',
      /* 自然宽度：临时撤掉内联变量，让 CSS 的三档值说话。
         和左面板那条 def() 是同一招 —— 只在双击/Home 时发生，重排一次可接受。 */
      def: function () {
        var prev = box.style.getPropertyValue('--topname-w');
        box.style.removeProperty('--topname-w');
        var v = 0;
        try {
          var cs = root.getComputedStyle ? root.getComputedStyle(box) : null;
          v = cs ? parseFloat(cs.getPropertyValue('--topname-w')) : 0;
        } catch (e) { v = 0; }
        if (!(v > 0)) v = box.getBoundingClientRect().width;
        if (prev) box.style.setProperty('--topname-w', prev);
        return Math.round(v);
      },
      label: '调整配方名宽度（双击或 Home 复位）'
    };
    nameResizer = R.attach(nameOpts);

    /* 窗口变了，可用的上限也变了。不重绑：一次装上就够。 */
    if (!root._topNameResizeBound) {
      root._topNameResizeBound = true;
      root.addEventListener('resize', refreshTopNameMax);
    }
  }

  function initLayoutResizers() {
    var R = UI.Resizer;
    if (!R || typeof R.attach !== 'function') return;   /* 39b 没载入就静默跳过 */

    R.installGlobalStyle();

    /* ---- 功能区高度 ---- */
    var panels = document.getElementById('ribbon-panels');
    var rh = document.getElementById('ribbon-resizer');
    if (panels && rh && !rh._rz) {
      rh._rz = R.attach({
        handle: rh, target: panels, prop: '--ribbon-panel-h',
        axis: 'y', dir: 1,
        /* v1.8：结构回到 v1.4（按钮两行 + 分区名一行），面板自然高度 = 78
           （按钮 24×2 + 4 间距 + 分区名 15 + 上下内边距）。它就是**下限**：
           再往下拖，第二行按钮或分区名就会被裁掉。
           上限 160 是"用户临时要看清楚某几个长名字"的余地，不是设计目标。 */
        min: 78, max: 160, key: 'ribbonH',
        /* 复位目标：按档给三个数，与 css/v18-shell.css 的 --ribbon-panel-h 一致。
           1440 档给 80 是因为它的按钮字号大一档（13.4px），行高多 2px。 */
        def: function () { return rbState.res === '1440' ? 80 : 78; },
        label: '调整功能区高度（双击或 Home 复位）'
      });
    }

    /* ---- 左导航宽度 ---- */
    var side = document.getElementById('sidebar');
    if (side && !document.getElementById('sidebar-resizer')) {
      var sh = document.createElement('div');
      sh.className = 'resizer resizer--x sidebar__resizer';
      sh.id = 'sidebar-resizer';
      sh.setAttribute('tabindex', '0');
      side.appendChild(sh);

      var band = NAV_BAND[rbState.res] || NAV_BAND['1080'];
      navResizer = R.attach({
        handle: sh,
        target: document.documentElement, prop: '--sidebar-w',
        measure: side,                       /* 写根变量，量侧栏实际宽度 */
        axis: 'x', dir: 1, min: band[0], max: band[1], key: 'navW',
        /* 自然宽度：临时撤掉内联变量量一次再写回（只在复位时发生，重排一次可接受） */
        def: function () {
          var prev = document.documentElement.style.getPropertyValue('--sidebar-w');
          document.documentElement.style.removeProperty('--sidebar-w');
          var v = Math.round(side.getBoundingClientRect().width);
          if (prev) document.documentElement.style.setProperty('--sidebar-w', prev);
          return v;
        },
        label: '调整左侧面板宽度（双击或 Home 复位）'
      });
    }

    /* ---- 顶栏配方名宽度 ---- */
    initTopbarName();
  }

  Shell.initLayoutResizers = initLayoutResizers;
  Shell.toggleFullscreen = toggleFullscreen;

  Shell.initRibbon = initRibbon;

  /* 供 58-ui-settings 的 apply() 调用；也供调试台直接改档 */
  Shell.setRes = setRes;
  Shell.setFont = setFont;
  Shell.setRail = setRail;
  Shell.setRibbonCollapsed = function (v) { setCollapsed(!!v, false); };
  Shell.ribbon = {
    state: function () {
      return { tab: rbState.tab, collapsed: rbState.collapsed, res: rbState.res, font: rbState.font, rail: rbState.rail };
    },
    /* 程序化切页签（测试与调试用；界面上走点击） */
    select: function (id) { selectTab(id, true); },
    /* 顶栏标题列的当前宽度与可拖范围（v1.6）。自省用：
       "用户能拖到多宽"这件事取决于顶栏里其他东西的宽度，只能现场算，
       所以不像其他常量那样写死在文档里 —— 想知道就调它。 */
    topName: function () {
      var box = document.getElementById('topbar-namebox');
      return {
        w: box ? Math.round(box.getBoundingClientRect().width) : 0,
        min: TOPNAME_MIN,
        max: topNameMax(),
        pillsMin: TOPNAME_PILLS_MIN
      };
    },
    /* 自省：返回每个页签的分区。
       自定义页签的 groups 不在静态表里（是从存档现场渲染的），直接回 t.groups
       会返回一个空数组——那等于对外宣称"这个页签里什么都没有"，
       而它明明有分区。所以这里对 custom 现读一次存档。 */
    tabs: function () {
      var out = [];
      for (var i = 0; i < RB_TABS.length; i++) {
        var t = RB_TABS[i];
        out.push({
          id: t.id,
          label: t.label,
          groups: (t.id === 'custom') ? readCustom().groups : groupsOfTab(t)
        });
      }
      return out;
    },
    /* 自检用：列出面板里所有按钮，说明每个按钮是不是真的有去处 */
    audit: function () {
      var host = document.getElementById('ribbon');
      var out = [];
      if (!host) return out;
      var btns = host.querySelectorAll('.rb-btn');
      for (var i = 0; i < btns.length; i++) {
        var act = btns[i].getAttribute('data-act');
        var go = btns[i].getAttribute('data-go');
        out.push({
          label: (btns[i].textContent || '').trim(),
          act: act || '',
          go: go || '',
          wired: go ? true : !!(act && ACTIONS[act])
        });
      }
      return out;
    }
  };

  /* ======================================================================
   * L. 启动
   * ====================================================================*/

  Shell.init = function () {
    elView = document.getElementById('view');
    elBoot = document.getElementById('boot');

    /* 顶栏徽章的版本号从 Config 读，不信任 HTML 里写死的那几个字。
       index.html 里仍保留 "v1.4" 作为兜底（脚本没跑起来时至少不是空白），
       但真值以 Config.VERSION_LABEL 为准——这样下次升版本只改一处。 */
    var elVer = document.getElementById('brand-ver');
    if (elVer && BREW.Config && BREW.Config.VERSION_LABEL) {
      elVer.textContent = BREW.Config.VERSION_LABEL;
    }

    /* 功能区必须在 route() 之前建好：首屏 renderView 会发 viewChanged，
       页签要靠这条事件才知道该高亮哪一个。 */
    try { initRibbon(); } catch (eRb) { reportError(eRb, 'ribbon.init'); }

    /* 点遮罩关闭：**只绑一次**。
       原来是每次 Shell.modal() 里 addEventListener——开 20 次就有 20 个同源监听，
       每改一次关闭逻辑都得在 N 个实例上验证。这里用"栈顶"代替闭包里的那个 api。 */
    var modalRoot = document.getElementById('modal-root');
    if (modalRoot && !modalRoot._backdropBound) {
      modalRoot._backdropBound = true;
      modalRoot.addEventListener('mousedown', function (e) {
        if (e.target !== modalRoot) return;
        var top = modalStack[modalStack.length - 1];
        if (top && typeof top.close === 'function') top.close();
      });
    }

    /* v1.6：导航点击委托整块删除（#nav 已不存在）。
       视图入口的唯一事件源是功能区面板上的 data-go，由 initRibbon 的委托处理。 */

    /* 顶层快捷：Alt+1..9 切视图 */
    document.addEventListener('keydown', function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      /* Alt+1..9 直达前 9 个视图，Alt+0 是第 10 个。
         以前这里写的是 `d < 1` 就直接 return，于是第 10 项在导航上显示「0」
         却按不出来——那种"看起来有快捷键、实际没有"最坑人。
         v1.2 视图到 10 个（含酿造日 / 品鉴 / 分析），所以必须真正支持 0。 */
      var d = parseInt(e.key, 10);
      if (!isFinite(d)) return;
      var idx = (d === 0) ? 9 : d - 1;
      if (idx < 0 || idx >= views.length) return;
      e.preventDefault();
      Shell.go(views[idx].id);
    });

    /* 路由 */
    function route() {
      var h = (root.location.hash || '').replace(/^#\/?/, '');
      var id = h || (views[0] && views[0].id);
      if (!id) return;
      var ok = false;
      for (var i = 0; i < views.length; i++) if (views[i].id === id) ok = true;
      renderView(ok ? id : (views[0] && views[0].id));
    }
    root.addEventListener('hashchange', route);
    Shell._route = route;
    Shell._rendered = true;
    route();

    /* 数据后到：重算并刷新当前视图与顶栏 */
    Bus.on('dataReady', function () {
      UI.invalidateDB();
      UI.publish({ persist: false });
      if (activeId) renderView(activeId, true);
    });

    /* 任何模块改了配方（不只是配方视图），顶栏都要跟着变 */
    Bus.on('recipeChanged', function (payload) {
      if (!payload) return;
      Shell.syncTopbar(payload.recipe || UI.recipe(), payload.calc || null);
    });

    /* 顶栏按钮（存在才绑） */
    var btnSave = document.getElementById('top-btn-save');
    if (btnSave) btnSave.addEventListener('click', function () {
      Bus.emit('requestSave');
    });
    var btnNew = document.getElementById('top-btn-new');
    if (btnNew) btnNew.addEventListener('click', function () {
      Bus.emit('requestNew');
    });

    Shell._ready = true;
    return Shell;
  };

  /* 已就绪的标记：构造函数层面允许多次调用 init（幂等） */
  UI.ready = function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  };

})(typeof window !== 'undefined' ? window : globalThis);
