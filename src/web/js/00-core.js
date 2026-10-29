/* ============================================================================
 * 风月酿研所 — 00 内核（Core）
 * ----------------------------------------------------------------------------
 * 职责：命名空间、可复现随机数、工具函数、事件总线、本地存储。
 * 依赖：无。本文件必须是第一个被加载的脚本。
 *
 * 为什么自己写这些而不引库：
 *   file:// 协议下不能 fetch 本地 JSON、不能用 ES Module，任何外链库都可能
 *   因为断网而让整个应用变成白屏。这个软件的目标是"十年后双击还能跑"。
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};

  /* ==========================================================================
   * 一、全局配置
   * ======================================================================*/
  BREW.Config = {
    APP_NAME: '风月酿研所',
    APP_NAME_ZH: '酿研所',
    VERSION: '2.0.0',
    /* 界面上露出的版本号。**只有这一处**：配方卡页脚、酒标页脚、设置页、顶栏徽章
       全部读它。v1.3 之前这些地方各写各的（页脚写 v1.0、徽章写 v1.2、设置写 v1.2
       界面包），同一版软件在三个地方报三个版本号——用户拿到 PDF 来问"我这是哪个
       版本"，没法答。分隔符用点号两段，与目录名保持一致。 */
    VERSION_LABEL: 'v2.0',
    /* 存储结构版本。与 APP VERSION 解耦：改数据形状升这个，改功能不升。
       v2（1.2）：新增顶层 versions / labels / userWater / inventory / shopping / meta，
                  并把批次状态枚举归一（见 STATUS_ALIAS）
       1.3 / 1.4 一路**没升**，是有意的：新增的 packaging / cost / plan 字段全部
       是"缺了就当没有"的可选字段，老数据直接能读（见 validateStructure 的默认填充），
       升了反而会让 v1.2 打开 v1.4 存档时误判为"高版本数据"进只读态。 */
    SCHEMA_VERSION: 2,

    /* 家酿场景默认值。这些数字是"20L 批次 + 家用三桶系统"的经验中值 */
    DEFAULTS: {
      batchSize: 20,          // L，目标入罐量
      efficiency: 72,         // %，糖化+洗糟总效率
      evaporationRate: 10,    // %/h，煮沸蒸发率
      boilTime: 60,           // min
      trubLoss: 1.5,          // L，热端残液（沉渣）
      fermenterLoss: 0.8,     // L，冷端残液（酵母泥）
      grainAbsorption: 0.9,   // L/kg，麦糟吸水
      hopAbsorption: 4.0,     // L/kg，酒花吸水（干投另算）
      mashThickness: 3.0,     // L/kg，水料比
      spargeRatio: 1.6,       // 洗糟水 ≈ 麦糟重 × 该系数（物料平衡校核用）
      fermentTemp: 20,        // °C
      carbonationVol: 2.4     // vol CO2
    },

    /* 合理区间。UI 用它做输入校验，计算引擎用它做警告 */
    LIMITS: {
      batchSize:     [5, 60],
      efficiency:    [40, 95],
      evaporation:   [2, 25],
      boilTime:      [15, 180],
      mashThickness: [1.5, 6],
      mashTemp:      [35, 80],
      fermentTemp:   [5, 35],
      og:            [1.010, 1.160],
      fg:            [1.000, 1.060],
      ibu:           [0, 150],
      srm:           [1, 60],
      abv:           [0, 18]
    },

    STORAGE_KEY: 'brewlab.studio.v1',

    /* 酿造阶段枚举，顺序即时间顺序。批次记录与时间线都用它 */
    STAGES: [
      { id: 'plan',     zh: '计划中',   short: '计划' },
      { id: 'mash',     zh: '糖化',     short: '糖化' },
      { id: 'lauter',   zh: '洗糟',     short: '洗糟' },
      { id: 'boil',     zh: '煮沸',     short: '煮沸' },
      { id: 'chill',    zh: '冷却',     short: '冷却' },
      { id: 'ferment',  zh: '主发酵',   short: '发酵' },
      { id: 'dryhop',   zh: '干投',     short: '干投' },
      { id: 'mature',   zh: '熟成',     short: '熟成' },
      { id: 'package',  zh: '装瓶/装桶', short: '装瓶' },
      { id: 'done',     zh: '已饮完',   short: '完成' },
      { id: 'failed',   zh: '失败',     short: '失败' }
    ],

    /* ---- 状态枚举归一（v1.2 新增） ----------------------------------
     * 历史包袱：35 的 Batch.STATUS_FLOW 用 plan/mash/.../done，
     * 而 46 的 UI 早期自己造了一套 planned/mashing/.../finished，除 failed
     * 外零重合。两套并存会让"按状态筛选"静默漏数（不报错，数字就是错的）。
     *
     * 定案：**唯一事实来源是上面 STAGES 的 id**，因为
     *   Batch.STATUS_FLOW / stageDurations / toTextReport 已经依赖它。
     * 这张表只负责把旧值映射过来，不新增枚举。
     *
     * 用法：
     *   - 迁移时改写 batches[].status（一次性）
     *   - 读取时兜底（防"降级用旧版 → 又把 'planned' 写回来"）
     * 注意：它只处理 batch.status。reading.stage 存的是中文（'发酵'），
     *      不要拿这个函数去洗，会把中文洗成 'plan'。
     * ---------------------------------------------------------------- */
    STATUS_ALIAS: {
      planned: 'plan',
      mashing: 'mash',
      fermenting: 'ferment',
      conditioning: 'mature',
      packaged: 'package',
      finished: 'done'
    },

    /** 任意历史状态值 → 规范 id。认不出的兜底 'plan'（audit 会另外报警） */
    normalizeStatus: function (v) {
      if (!v) return 'plan';
      var s = String(v);
      if (BREW.Config.STATUS_ALIAS[s]) return BREW.Config.STATUS_ALIAS[s];
      for (var i = 0; i < BREW.Config.STAGES.length; i++) {
        if (BREW.Config.STAGES[i].id === s) return s;
      }
      return 'plan';
    }
  };

  /* ==========================================================================
   * 二、可复现随机数（mulberry32）
   * ------------------------------------------------------------------------
   * 模拟与"随机推荐配方"必须可复现：同一个种子必须给出同一个结果，
   * 否则用户没法对比两次实验。所以全局禁用 Math.random()。
   * ======================================================================*/
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  BREW.RNG = {
    _seed: 20261024,
    _fn: mulberry32(20261024),
    seed: function (s) {
      this._seed = (s >>> 0) || 1;
      this._fn = mulberry32(this._seed);
      return this._seed;
    },
    /** 返回 [0,1) */
    next: function () { return this._fn(); },
    /** 返回 [min,max) */
    range: function (min, max) { return min + this._fn() * (max - min); },
    /** 返回 [min,max] 整数 */
    int: function (min, max) { return Math.floor(min + this._fn() * (max - min + 1)); },
    /** 按权重取一项：items 为 [{w:权重, ...}] */
    pick: function (items, weightKey) {
      var k = weightKey || 'w';
      var total = 0, i;
      for (i = 0; i < items.length; i++) total += (items[i][k] || 1);
      var r = this._fn() * total;
      for (i = 0; i < items.length; i++) {
        r -= (items[i][k] || 1);
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    /** 从数组随机取一个 */
    one: function (arr) { return arr[Math.floor(this._fn() * arr.length)]; }
  };

  /* ==========================================================================
   * 三、通用工具
   * ======================================================================*/
  var U = BREW.Util = {
    /** HTML 转义。导入的 JSON 可能含恶意字符串，所有插入 innerHTML 的用户数据都要过一遍 */
    esc: function (s) {
      if (s === null || s === undefined) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    /** 数字格式化，自动去尾零 */
    num: function (v, digits) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      var d = (digits === undefined) ? 1 : digits;
      var s = Number(v).toFixed(d);
      if (d > 0) s = s.replace(/\.?0+$/, '');
      return s;
    },

    /** 固定小数位，不删零（用于表格对齐） */
    fixed: function (v, d) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      return Number(v).toFixed(d === undefined ? 1 : d);
    },

    /** 比重显示：1.056 而不是 1.1 */
    sg: function (v) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      return Number(v).toFixed(3);
    },

    clamp: function (v, min, max) {
      return v < min ? min : (v > max ? max : v);
    },

    round: function (v, d) {
      var p = Math.pow(10, d || 0);
      return Math.round(v * p) / p;
    },

    /** 安全取数值，非数字返回默认值 */
    toNum: function (v, def) {
      var n = parseFloat(v);
      return isFinite(n) ? n : (def === undefined ? 0 : def);
    },

    /** 深拷贝。数据全部是纯 JSON 结构，所以 JSON 往返足够且最快 */
    clone: function (o) {
      if (o === null || typeof o !== 'object') return o;
      return JSON.parse(JSON.stringify(o));
    },

    /** 短 id。用时间戳 + 计数器，避免 Math.random */
    uid: function (prefix) {
      BREW.Util._c = (BREW.Util._c || 0) + 1;
      return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + BREW.Util._c;
    },

    /** 防抖：配方输入时每敲一个键都重算会卡，150ms 后只算一次 */
    debounce: function (fn, ms) {
      var t = null;
      return function () {
        var self = this, args = arguments;
        if (t) clearTimeout(t);
        t = setTimeout(function () { t = null; fn.apply(self, args); }, ms || 150);
      };
    },

    /** 节流：存储写入用它，最多每 ms 毫秒落盘一次 */
    throttle: function (fn, ms) {
      var last = 0, timer = null, lastArgs = null;
      return function () {
        var now = Date.now(), self = this;
        lastArgs = arguments;
        if (now - last >= ms) {
          last = now;
          fn.apply(self, lastArgs);
        } else if (!timer) {
          timer = setTimeout(function () {
            timer = null;
            last = Date.now();
            fn.apply(self, lastArgs);
          }, ms - (now - last));
        }
      };
    },

    /** 今日日期字符串 YYYY-MM-DD（本地时区，不要用 toISOString 会有时差） */
    today: function () {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
             '-' + String(d.getDate()).padStart(2, '0');
    },

    /** 时间戳 → 'MM-DD HH:mm' */
    fmtTime: function (ts) {
      if (!ts) return '—';
      var d = new Date(ts);
      return String(d.getMonth() + 1).padStart(2, '0') + '-' +
             String(d.getDate()).padStart(2, '0') + ' ' +
             String(d.getHours()).padStart(2, '0') + ':' +
             String(d.getMinutes()).padStart(2, '0');
    },

    /** 日期差（天） */
    daysBetween: function (a, b) {
      return Math.abs(new Date(b) - new Date(a)) / 86400000;
    },

    /** 百分比字符串 */
    pct: function (v, d) { return U.fixed(v, d === undefined ? 1 : d) + '%'; },

    /** 数组按 key 求和 */
    sumBy: function (arr, fn) {
      var t = 0;
      for (var i = 0; i < arr.length; i++) t += (fn ? fn(arr[i], i) : arr[i]) || 0;
      return t;
    },

    /** 在数组里按 id 找 */
    byId: function (arr, id) {
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
      return null;
    },

    /** 模糊匹配：中文子串 + 英文小写子串 + 首字母缩写 */
    match: function (item, q) {
      if (!q) return true;
      var s = String(q).toLowerCase().trim();
      if (!s) return true;
      var fields = [item.name, item.en, item.id, item.origin, item.use, item.flavor];
      for (var i = 0; i < fields.length; i++) {
        if (fields[i] && String(fields[i]).toLowerCase().indexOf(s) >= 0) return true;
      }
      return false;
    }
  };

  /* ==========================================================================
   * 四、SRM → 颜色
   * ------------------------------------------------------------------------
   * 这是一张经验色表（0–40 SRM），用于在 UI 上把色度画成色块。
   * 它只服务视觉呈现，不参与任何计算。超过 40 SRM 一律按黑色处理，
   * 因为实际 Beer-Lambert 吸收早已饱和，人眼分辨不出差别。
   * ======================================================================*/
  var SRM_TABLE = [
    [0,  [255, 255, 255]], [1,  [255, 230, 153]], [2,  [255, 216, 120]],
    [3,  [255, 202, 90]],  [4,  [255, 191, 66]],  [5,  [251, 177, 35]],
    [6,  [248, 166, 0]],   [7,  [243, 156, 0]],   [8,  [234, 143, 0]],
    [9,  [229, 133, 0]],   [10, [222, 124, 0]],   [11, [215, 114, 0]],
    [12, [207, 105, 0]],   [13, [203, 98, 0]],    [14, [195, 89, 0]],
    [15, [187, 81, 0]],    [16, [181, 76, 0]],    [17, [176, 69, 0]],
    [18, [166, 62, 0]],    [19, [161, 55, 0]],    [20, [155, 50, 0]],
    [21, [149, 45, 0]],    [22, [142, 41, 0]],    [23, [136, 35, 0]],
    [24, [130, 30, 0]],    [25, [123, 26, 0]],    [26, [119, 25, 0]],
    [27, [112, 20, 0]],    [28, [106, 14, 0]],    [29, [102, 13, 0]],
    [30, [94, 11, 0]],     [31, [90, 10, 2]],     [32, [86, 9, 3]],
    [33, [79, 8, 4]],      [34, [75, 7, 4]],      [35, [71, 5, 4]],
    [36, [66, 4, 3]],      [37, [60, 3, 1]],      [38, [53, 2, 0]],
    [39, [48, 1, 0]],      [40, [40, 0, 0]]
  ];

  BREW.color = {
    /** SRM → 'rgb(r,g,b)'，线性插值 */
    fromSRM: function (srm) {
      var s = U.clamp(U.toNum(srm, 4), 0, 40);
      var lo = SRM_TABLE[0], hi = SRM_TABLE[SRM_TABLE.length - 1];
      for (var i = 0; i < SRM_TABLE.length - 1; i++) {
        if (s >= SRM_TABLE[i][0] && s <= SRM_TABLE[i + 1][0]) {
          lo = SRM_TABLE[i]; hi = SRM_TABLE[i + 1];
          break;
        }
      }
      var span = (hi[0] - lo[0]) || 1;
      var t = (s - lo[0]) / span;
      return 'rgb(' +
        Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t) + ',' +
        Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t) + ',' +
        Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t) + ')';
    },

    /** SRM → '#rrggbb' */
    hexFromSRM: function (srm) {
      var rgb = this.fromSRM(srm).match(/\d+/g);
      var h = '#';
      for (var i = 0; i < 3; i++) {
        h += ('0' + parseInt(rgb[i], 10).toString(16)).slice(-2);
      }
      return h;
    },

    /** SRM → 中文色名，用于文案 */
    nameFromSRM: function (srm) {
      var s = U.toNum(srm, 4);
      if (s < 2)  return '极浅稻草';
      if (s < 4)  return '淡金色';
      if (s < 6)  return '金色';
      if (s < 9)  return '浅琥珀';
      if (s < 13) return '琥珀';
      if (s < 17) return '铜色';
      if (s < 21) return '深铜/红棕';
      if (s < 26) return '棕色';
      if (s < 31) return '深棕';
      if (s < 36) return '极深棕';
      return '墨黑';
    }
  };

  /* ==========================================================================
   * 五、事件总线
   * ------------------------------------------------------------------------
   * 模块之间不直接互相调用 UI，一律通过事件解耦：
   *   数据层 emit('recipeChanged') → UI 层各自 on 并重绘
   * 这样加一个新视图不需要改任何已有代码。
   * ======================================================================*/
  BREW.Bus = (function () {
    var handlers = {};

    return {
      on: function (evt, fn) {
        (handlers[evt] = handlers[evt] || []).push(fn);
        return function () { BREW.Bus.off(evt, fn); };
      },
      once: function (evt, fn) {
        var wrap = function (payload) {
          BREW.Bus.off(evt, wrap);
          fn(payload);
        };
        this.on(evt, wrap);
      },
      off: function (evt, fn) {
        var list = handlers[evt];
        if (!list) return;
        var i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      },
      emit: function (evt, payload) {
        var list = handlers[evt];
        if (!list) return;
        /* 复制一份再遍历：handler 内部可能 off 自己，直接遍历会漏掉后面的 */
        var copy = list.slice();
        for (var i = 0; i < copy.length; i++) {
          try {
            copy[i](payload);
          } catch (e) {
            /* 一个视图报错不能把其它视图带崩 */
            if (root.console) console.error('[Bus] handler error on "' + evt + '":', e);
          }
        }
      },
      clear: function (evt) {
        if (evt) delete handlers[evt];
        else handlers = {};
      }
    };
  })();

  /* ==========================================================================
   * 六、本地存储
   * ------------------------------------------------------------------------
   * 结构：一个键存整个数据库。
   * 为什么不拆多键：localStorage 的读写在同步主线程，拆十几个键反而更慢；
   * 而且"主键写成功、版本键写失败"这种半成功状态最难跟用户解释。
   * 实测典型用户（20 配方 / 15 批次 / 每配方 5 版）= 336 K 字符 ≈ 0.64 MiB
   * （localStorage 配额按 UTF-16 计，5 MB ≈ 2.5 M 字符），单键完全够用。
   *
   * 写入策略：throttle 400ms。用户连续敲字不会每次都写盘。
   * 读取前检查 schemaVersion，旧数据自动迁移（逐版本累进，只加键）。
   *
   * ⚠️ v1.2 起的新数据结构一律放**顶层独立键**，绝不挂 recipes[i].xxx：
   *    UI 层的 normalizeRecipe()（40-ui-shell.js）是白名单，saveRecipe 原本
   *    又是整体替换，挂在配方对象上的新字段会在"打开→保存"后静默丢失。
   *    批次侧相反（normalizeBatch 是深拷贝 + 补默认），可以挂在 batch 上。
   * ======================================================================*/
  BREW.Store = (function () {
    var KEY = BREW.Config.STORAGE_KEY;
    /* 两类备份，两个命名空间，两套配额。**别合并**，理由见 §备份的两类：
     *   broken. —— 损坏现场的"证据"：数据坏掉那一刻的原始串，通常是坏串；
     *   snap.   —— 用户自己留的"药"：数据还好着的时候主动存的一份，
     *              以及 restoreBackup 写入前那份"恢复前"快照。
     * 混在一个命名空间里会被同一套剪枝规则处理，结果是剪枝先删掉药、留下证据
     * （按时间一刀切时，最早的那份往往正是用户动手前留的好数据）。 */
    var BROKEN_PREFIX = KEY + '.broken';
    var BROKEN_KEEP = 2;          /* 损坏备份保留份数（3N 配额预算，见 WATER_L2 注释） */
    var SNAP_PREFIX = KEY + '.snap';
    var SNAP_KEEP = 3;            /* 手动/恢复前快照保留份数（小库的待遇，见 snapBudget） */
    var SNAP_CHARS = 1200000;     /* 小库的快照总字符封顶 */
    /* 写快照前必须留出的余量。不是给快照的，是给**主键随后的增长**的：
       写完快照后用户继续编辑，主键还要长；把最后一格塞满快照，
       下一次正常保存就会撞 QuotaExceeded，那才是真的把用户坑了。
       ⚠️ 12 万是**判断，不是实测**：它≈典型库（20 配方 / 15 批次，33 万字符）的
       1/3，够撑几十次保存。定太大，大库用户的快照更容易被拒；定太小，快照写完
       主键再长一点就炸。要改先想清楚这两头，别只调一个数。 */
    var QUOTA_RESERVE = 120000;
    var BANNER_ID = 'fengyue-readonly-banner';
    var _data = null;
    var _dirty = false;
    var _reject = null;           /* 降级保护状态，见 §降级保护 */
    /* 只读提示的两个一次性开关。为什么是"两个"而不是一个：
       开机时 40 的 autosave/settings 补默认值也会走写入口，如果和"保存配方"
       共用同一个标志，用户真去点保存时提示已经被开机内部操作吃掉了——
       那正好是任务要求里必须看到提示的那一次。内部工作副本落盘则完全静默。 */
    var _warnedSave = false;
    var _warnedSet = false;

    /* ---------------- 小工具 ---------------- */
    function isPlainObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
    function isArr(v) { return Array.isArray(v); }
    function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

    function backfill() {
      return {
        versions: {},     /* { recipeId: [版本条目] } */
        labels: {},       /* { recipeId: [酒标] } */
        userWater: [],    /* 用户自建水源档案 */
        inventory: { items: [], moves: [] },
        shopping: {},     /* { scopeKey: timestamp } 采购清单勾选 */
        meta: {}          /* migratedAt / migrateError / statusNormalized … */
      };
    }

    function blankDB() {
      var d = {
        schemaVersion: BREW.Config.SCHEMA_VERSION,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        recipes: [],
        batches: [],
        custom: { malts: [], hops: [], yeasts: [], adjuncts: [] },
        settings: {
          theme: 'dark',
          defaultBatchSize: BREW.Config.DEFAULTS.batchSize,
          defaultEfficiency: BREW.Config.DEFAULTS.efficiency,
          units: 'metric',
          waterProfile: null
        }
      };
      var extra = backfill();
      for (var k in extra) if (has(extra, k)) d[k] = extra[k];
      return d;
    }

    /* ==================================================================
     * 结构校验
     * ----------------------------------------------------------------
     * 为什么单独拎出来：`{schemaVersion:1}` 这种"版本号对但字段缺"的库，
     * 旧版 migrate 会原样放行 → listRecipes() 返回 undefined →
     * Batch.nextBatchNo() 里 undefined.length 直接抛异常，界面白屏。
     *
     * 判据分两级：
     *   fatal  —— 类型错到无法修复（recipes 是对象、settings 是数组）→ 备份 + 空库
     *   repair —— 只是缺键（recipes 缺失）→ 补默认值，不当成损坏
     * ================================================================== */
    function validateStructure(d) {
      var fatal = [], repair = [];
      if (!isPlainObj(d)) return { ok: false, fatal: ['根节点不是对象'], repair: [] };

      ['recipes', 'batches'].forEach(function (k) {
        if (!has(d, k) || d[k] === null || d[k] === undefined) repair.push(k + ' 缺失');
        else if (!isArr(d[k])) fatal.push(k + ' 不是数组');
      });
      ['settings', 'custom'].forEach(function (k) {
        if (!has(d, k) || d[k] === null || d[k] === undefined) repair.push(k + ' 缺失');
        else if (!isPlainObj(d[k])) fatal.push(k + ' 不是对象');
      });
      if (has(d, 'working') && d.working !== null && !isPlainObj(d.working)) {
        repair.push('working 不是对象');
      }
      return { ok: fatal.length === 0, fatal: fatal, repair: repair };
    }

    /* 只补缺失/类型可修的键，不动任何已有值 */
    function repairStructure(d) {
      var r = { fixed: [] };
      if (!isArr(d.recipes)) { d.recipes = []; r.fixed.push('recipes'); }
      if (!isArr(d.batches)) { d.batches = []; r.fixed.push('batches'); }
      if (!isPlainObj(d.custom)) {
        d.custom = { malts: [], hops: [], yeasts: [], adjuncts: [] };
        r.fixed.push('custom');
      } else {
        ['malts', 'hops', 'yeasts', 'adjuncts'].forEach(function (k) {
          if (!isArr(d.custom[k])) { d.custom[k] = []; r.fixed.push('custom.' + k); }
        });
      }
      if (!isPlainObj(d.settings)) {
        d.settings = blankDB().settings;
        r.fixed.push('settings');
      }
      if (d.working !== undefined && d.working !== null && !isPlainObj(d.working)) {
        delete d.working;
        r.fixed.push('working');
      }
      /* 记录级：非对象的元素直接剔除（它们在任何地方都不可用，留着只会让
         filter/map 抛异常）。剔除数量记进 meta，audit 会报出来。 */
      var dropped = 0;
      d.recipes = d.recipes.filter(function (x) { if (isPlainObj(x)) return true; dropped++; return false; });
      d.batches = d.batches.filter(function (x) { if (isPlainObj(x)) return true; dropped++; return false; });
      if (dropped) {
        d.meta = isPlainObj(d.meta) ? d.meta : {};
        d.meta.droppedRecords = (d.meta.droppedRecords || 0) + dropped;
      }
      return r;
    }

    /* ==================================================================
     * 版本迁移：逐版本累进，不按目标版本分支
     * ----------------------------------------------------------------
     * 累进的好处：加 v3 时只写一个新函数，不需要补 1→3、2→3 这些组合，
     * 且每一步只要"只加键"就天然幂等（抛异常后重跑安全）。
     * 代价：不能表达"跨版本重命名"——真需要改名时另开一次性脚本。
     * ================================================================== */
    /** 补 v2 的顶层新键（缺就补、类型不对就重置）。
     *  抽出来是因为两条路径都要用：
     *    ① v1 → v2 迁移
     *    ② **导入一份"自称 v2 但缺键"的文件**（比如手工裁过的 JSON）——
     *       它 schemaVersion 已经是 2，迁移循环一步都不跑，如果只在迁移里补，
     *       导入完 `versions` 就是 undefined，界面一读就炸。
     *  只加不改，幂等。 */
    function ensureBackfillKeys(d) {
      var extra = backfill();
      for (var k in extra) {
        if (!has(extra, k)) continue;
        if (k === 'inventory') {
          if (!isPlainObj(d.inventory)) d.inventory = extra.inventory;
          else {
            if (!isArr(d.inventory.items)) d.inventory.items = [];
            if (!isArr(d.inventory.moves)) d.inventory.moves = [];
          }
        } else if (isArr(extra[k])) {
          if (!isArr(d[k])) d[k] = extra[k];
        } else if (!isPlainObj(d[k])) {
          d[k] = extra[k];
        }
      }
    }

    /** 批次状态归一（幂等）。迁移、合并导入、替换导入三处都要走一遍：
     *  导入不经过迁移循环，一份 v1.1 备份里的 'packaged' 会原样进来，
     *  而年度统计只认 done/package —— 这类批次既不算完成也不算失败，静默少数。 */
    function normalizeBatchStatuses(d) {
      if (!isArr(d.batches)) return 0;
      var n = 0;
      for (var i = 0; i < d.batches.length; i++) {
        var b = d.batches[i];
        if (!isPlainObj(b)) continue;
        var to = BREW.Config.normalizeStatus(b.status);
        if (b.status !== to) { b.status = to; n++; }
      }
      return n;
    }

    var MIGRATIONS = {
      /* v0/v1 → v2：只加顶层新键 + 归一批次状态枚举 */
      2: function (d, from) {
        ensureBackfillKeys(d);
        if (!isPlainObj(d.meta)) d.meta = {};
        d.meta.migratedAt = Date.now();
        d.meta.migratedFrom = from;

        /* 唯一一处"改既有记录"：状态枚举归一。
           不做的后果是年度统计/看板/对比全部静默漏数（不报错，数字就是错的）。
           只改字符串，可逆，且幂等（已经是新值的不会再变）。 */
        var changed = normalizeBatchStatuses(d);
        if (changed) d.meta.statusNormalized = (d.meta.statusNormalized || 0) + changed;
      }
    };

    function migrate(d, fromOverride) {
      if (!d || typeof d !== 'object') return blankDB();
      var from = (fromOverride === undefined) ? (Number(d.schemaVersion) || 0) : fromOverride;

      /* 从未来版本打开（降级）：只标记，一个字节都不动。
         返回后仍可正常读，旧版忽略它不认识的键 —— 但用户一保存配方，
         白名单就会把新字段吃掉。所以新数据结构一律放顶层（见文件头注释）。 */
      if (from > BREW.Config.SCHEMA_VERSION) {
        d.__schemaFromFuture = from;
        return d;
      }

      var v0 = validateStructure(d);
      if (!v0.ok) {
        /* 结构坏到修不了。交给调用方决定要不要 blankDB —— 这里抛，
           是因为 importJSON 也复用 migrate，静默 blank 会把导入失败伪装成成功。 */
        var err = new Error('数据结构损坏：' + v0.fatal.join('；'));
        err.code = 'BREW_SCHEMA_BROKEN';
        throw err;
      }
      repairStructure(d);
      /* 已迁到 v2 但缺键的库（手工裁过的 JSON、更早的 v1.2 草稿）也要补齐：
         迁移循环只在 from<2 时跑，不补这一步，`versions` 会是 undefined。 */
      ensureBackfillKeys(d);

      /* 库存形状归一放在迁移循环之外：v2 的老库（本版之前建的）也要过一遍，
         否则"版本号已经是 2 但 inventory 里是早期字段名"的数据永远修不到。
         它只捏形状、不改数值，幂等，所以每次 load 跑都没问题。 */
      normalizeInventory(d);

      for (var v = from + 1; v <= BREW.Config.SCHEMA_VERSION; v++) {
        var step = MIGRATIONS[v];
        if (typeof step === 'function') step(d, from);
        d.schemaVersion = v;        /* 每步成功才推进 */
      }
      return d;
    }

    /* ==================================================================
     * 损坏备份：带时间戳、保留最近 N 份
     * ----------------------------------------------------------------
     * 旧实现是单槽 `KEY + '.broken'`，第二次损坏会把第一次的备份覆盖掉——
     * 而那往往是最后一次救命机会。保留 2 份是有意的：再多就占配额了。
     * ================================================================== */
    function stamp() {
      var d = new Date();
      function p(n) { return String(n).padStart(2, '0'); }
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
             p(d.getHours()) + p(d.getMinutes());
    }

    /** 某个前缀下的全部键（`<prefix>.<stamp>` 形式；旧版单槽 `<prefix>` 也算） */
    function keysUnder(prefix) {
      var out = [];
      var ls;
      try { ls = root.localStorage; } catch (e) { return out; }
      if (!ls) return out;
      try {
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (!k) continue;
          if (k === prefix || k.indexOf(prefix + '.') === 0) out.push(k);
        }
      } catch (e2) { /* 读不到就当没有，绝不让设置页因为备份挂掉 */ }
      return out;
    }

    /** 一个备份串是否"可恢复"：能 parse 且结构合法 */
    function backupValid(raw) {
      try {
        var d = JSON.parse(raw);
        return isPlainObj(d) && validateStructure(d).ok;
      } catch (e) { return false; }
    }

    /* ------------------------------------------------------------------
     * 剪枝：两个命名空间各管各的
     * ----------------------------------------------------------------
     * broken.（证据）：总数封顶 BROKEN_KEEP 份，3N 配额预算不变。
     *   但删的顺序讲优先级：**先删坏串，再删可恢复的**。
     *   旧实现只留最新 2 份，最早那份（常常正是能恢复的那份）第一个被删——
     *   留着两份再也读不出来的串，删掉唯一一份能用的。
     *   代价是每次损坏多解析几份（≤4 次 JSON.parse），只发生在数据已经坏了的
     *   时刻，不在热路径上。
     *
     * snap.（药）：**完全不受 pruneBroken 影响**。
     *   它有自己的配额：保留最近 SNAP_KEEP 份、总字符 ≤ SNAP_CHARS。
     *   按份数一刀切不行：一份大库就 1.6 M，三份能把配额吃死。
     *   也永远不删"刚写进去的那份"——哪怕它一个人就超预算（大库在最紧水位下
     *   本来就能到 1.6 M），删了它等于这次备份白做。
     * ------------------------------------------------------------------ */
    function pruneBroken() {
      try {
        var ls = root.localStorage, keys = keysUnder(BROKEN_PREFIX);
        if (!keys.length) return;
        var bad = [], good = [];
        for (var j = 0; j < keys.length; j++) {
          var raw = ls.getItem(keys[j]) || '';
          (backupValid(raw) ? good : bad).push(keys[j]);
        }
        bad.sort();                        /* 时间戳格式可直接字典序排 */
        good.sort();
        /* 先删坏串：证据可以少一份，药不能 */
        while (bad.length + good.length > BROKEN_KEEP && bad.length) {
          ls.removeItem(bad.shift());
        }
        /* 全是可恢复的还超（只有"迁移异常"才会产生这种备份），才从最旧的删 */
        while (bad.length + good.length > BROKEN_KEEP && good.length) {
          ls.removeItem(good.shift());
        }
      } catch (e) { /* 清不动就算了，不能因为清理失败再抛一次 */ }
    }

    /* ---------------- 配额账本：写快照前先算清楚 ----------------
     * 三个量互相咬合，缺一个就会写出"看起来成功、下次保存就炸"的状态：
     *   mainChars()   主键现在多大（快照的体积约等于它）
     *   usedChars()   localStorage 一共占了多少（键 + 值，UTF-16 编码单元）
     *   snapBudget()  快照允许占多少 —— **自适应**，不是一个死数
     * ------------------------------------------------------------ */

    function mainChars() {
      try {
        var raw = root.localStorage ? root.localStorage.getItem(KEY) : null;
        return raw ? raw.length : 0;
      } catch (e) { return 0; }
    }

    function usedChars() {
      var ls;
      try { ls = root.localStorage; } catch (e) { return 0; }
      if (!ls) return 0;
      var n = 0;
      try {
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (!k) continue;
          n += k.length + (ls.getItem(k) || '').length;
        }
      } catch (e2) { /* 读一半失败就报已读到的，宁可低估已用也不能抛 */ }
      return n;
    }

    function freeChars() { return QUOTA_CHARS - usedChars(); }

    /** 快照的有效预算。
     *  小库：SNAP_CHARS（120 万）——三份常规库的快照都装得下。
     *  大库：**至少容得下一份与主库等大的快照**（×1.05 给时间戳/边界）。
     *  为什么不能写死 1.2 M：一份 160 万字符的库做出来的快照就是 160 万，
     *  1.2 M 的预算对它是死条文，实际只会退化成"一份都留不下"——
     *  那不是保守，是把功能关掉还说它开着。 */
    function snapBudget() {
      var main = mainChars();
      var adaptive = Math.round(main * 1.05);
      return Math.max(SNAP_CHARS, adaptive);
    }

    /** 写前腾地方：**只删最旧的 snap**，绝不动 broken、绝不动 keepKey。
     *  返回 true = 腾够了；false = 腾完仍不够（调用方必须放弃写入，不许硬写）。
     *
     *  为什么"提前腾"比"写到一半失败再报"好：`setItem` 撞配额时，
     *  我们对浏览器内部残留状态没有任何保证；而"删掉一份旧快照"是我们
     *  完全可控的动作。先算 need、再动手，也避免"删完了才发现还差一点"。 */
    function ensureRoomFor(chars, keepKey) {
      var need = chars + QUOTA_RESERVE;
      if (freeChars() >= need) return true;
      var keys = keysUnder(SNAP_PREFIX).sort();       /* 旧 → 新 */
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] === keepKey) continue;
        try { root.localStorage.removeItem(keys[i]); } catch (e) { continue; }
        if (freeChars() >= need) return true;
      }
      return freeChars() >= need;
    }

    /** 快照自己的配额：份数 ≤ SNAP_KEEP、总字符 ≤ snapBudget()、且给主键留出余量。
     *  三条里任何一条破了都从最旧的删，但**永不删 keepKey**、**至少留一份**。 */
    function pruneSnapshots(keepKey) {
      try {
        var ls = root.localStorage, keys = keysUnder(SNAP_PREFIX);
        if (!keys.length) return;
        var rows = [], i;
        for (i = 0; i < keys.length; i++) {
          rows.push({ key: keys[i], chars: (ls.getItem(keys[i]) || '').length });
        }
        rows.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
        var total = 0;
        for (i = 0; i < rows.length; i++) total += rows[i].chars;
        var budget = snapBudget();

        var r = 0;
        while (r < rows.length) {
          if (rows.length <= 1) break;                       /* 至少留一份 */
          var overCount = rows.length > SNAP_KEEP;
          var overBudget = total > budget;
          var tight = freeChars() < QUOTA_RESERVE;            /* 余量被吃光也要收 */
          if (!overCount && !overBudget && !tight) break;
          var victim = rows[r];
          if (victim.key === keepKey) { r++; continue; }      /* 刚写的那份永远不删 */
          try { ls.removeItem(victim.key); } catch (e) { r++; continue; }
          total -= victim.chars;
          rows.splice(r, 1);                                  /* 不 r++：同位置是下一条 */
        }
      } catch (e) { /* 同上：清理失败不许影响主流程 */ }
    }

    /** 备份原始字符串（**损坏现场**）。返回备份键名；失败返回 null（但绝不影响主流程） */
    function backupBroken(raw, reason) {
      if (!raw) return null;
      try {
        /* v1.4：改用一个"找一个没被占的键"的函数，不再只试一次 `-2`。
           旧写法 `if (占用了) key += '-2'` 在同分钟**第三次**损坏时
           会 setItem 覆盖掉 `-2` 那份 —— 备份看着有两份，其实是同一份被写了两次。
           而"打开 → 修 → 又坏"本来就容易在同一分钟里发生，
           那正是最需要多份备份的场景。 */
        var key = freshSnapshotKey(BROKEN_PREFIX);
        root.localStorage.setItem(key, raw);
        pruneBroken();
        return key;
      } catch (e) {
        /* 配额不足时退回单槽（旧行为），至少留一份 */
        try { root.localStorage.setItem(BROKEN_PREFIX, raw); return BROKEN_PREFIX; } catch (e2) {}
        if (root.console && console.warn) {
          console.warn('[Store] 备份失败（' + reason + '）：' + (e && e.message));
        }
        return null;
      }
    }

    /** 写一份**快照**（手动备份 / 恢复前的后悔药），进 snap. 命名空间。
     *  顺序：① 腾地方（只删旧 snap）② 写 ③ 剪枝。
     *  ①失败就抛 SNAP_NO_ROOM —— **绝不硬写**：宁可这次备份失败并明说，
     *  也不要把主键周围的最后一点空间吃掉，让用户下一次正常保存炸掉。 */
    function writeSnapshot(raw) {
      if (!ensureRoomFor(raw.length)) {
        var e = new Error('可用空间不足（写完快照后就没地方给主键增长了）');
        e.code = 'SNAP_NO_ROOM';
        throw e;
      }
      var key = freshSnapshotKey(SNAP_PREFIX);
      root.localStorage.setItem(key, raw);      /* 仍可能抛 QuotaExceeded（别的标签页抢了）→ 交给调用方 */
      pruneSnapshots(key);
      return key;
    }

    /* ==================================================================
     * 备份的读与恢复（v1.4）
     * ----------------------------------------------------------------
     * v1.3 之前备份是"只写不读"的：坏数据被存成 `…broken.<stamp>`，
     * 但界面上没有任何入口能把它拿回来。用户看到的是"数据没了"，
     * 而备份就躺在他自己的浏览器里——记了不用，等于没记。
     *
     * 两条纪律：
     *   ① `listBackups()` 必须把**坏备份也列出来并标红**。坏备份不代表没用：
     *      用户可能只想从里面抄一条配方名字，或者导出后手工修。
     *      悄悄不显示，等于替用户决定"这个你不需要"。
     *   ② `restoreBackup()` 先给当前主键留一份快照，再写。
     *      恢复本身也必须可撤销——否则"救错备份"这一个误操作
     *      就把最后一份好数据也覆盖掉了。
     * ================================================================== */

    /** 从备份键名里解析时间。认 `…broken.<YYYYMMDD-HHmm>[-n]` 与
     *  `…snap.<YYYYMMDD-HHmm>[-n]`；旧版单槽 `…broken`（无时间戳）给 at=0，排在最后。 */
    function backupStampOf(key) {
      var m = /\.(?:broken|snap)\.(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(?:-(\d+))?$/.exec(String(key));
      if (!m) return { at: 0, seq: 0 };
      var at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4]), Number(m[5])).getTime();
      return { at: isFinite(at) ? at : 0, seq: m[6] ? Number(m[6]) : 1 };
    }

    /** 键属于哪一类：'auto'（损坏现场）| 'snap'（手动 / 恢复前快照） */
    function kindOfKey(key) {
      return String(key).indexOf(SNAP_PREFIX) === 0 ? 'snap' : 'auto';
    }

    /**
     * 列出全部备份，按时间倒序。两类都列，用 kind 区分：
     *   'auto' —— 损坏现场（pruneBroken 管，≤ BROKEN_KEEP 份）
     *   'snap' —— 手动备份 / 恢复前快照（pruneSnapshots 管，≤ SNAP_KEEP 份、≤ SNAP_CHARS 字符）
     * 返回 [{ key, kind, at, chars, schemaVersion, valid, recs, batches, reason }]
     *   valid  —— validateStructure() 通过才算"可恢复"
     *   reason —— 不可恢复的原因（界面直接展示，不许静默）
     */
    function listBackups() {
      var ls;
      try { ls = root.localStorage; } catch (e) { return []; }
      if (!ls) return [];
      var keys = keysUnder(BROKEN_PREFIX).concat(keysUnder(SNAP_PREFIX)), out = [];
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i], raw = null;
        try { raw = ls.getItem(key); } catch (e2) { raw = null; }
        if (typeof raw !== 'string' || !raw) continue;
        var st = backupStampOf(key);
        var item = {
          key: key, kind: kindOfKey(key), at: st.at, seq: st.seq, chars: raw.length,
          schemaVersion: null, valid: false, recs: 0, batches: 0, reason: ''
        };
        var d, parsedOk = true;
        try { d = JSON.parse(raw); } catch (e3) { parsedOk = false; }
        if (!parsedOk) {
          item.reason = '不是合法 JSON';
        } else if (!isPlainObj(d)) {
          item.reason = '根节点不是对象';
        } else {
          item.schemaVersion = Number(d.schemaVersion) || 0;
          var v = validateStructure(d);
          if (!v.ok) {
            item.reason = v.fatal.join('；');
          } else {
            item.valid = true;
            item.recs = isArr(d.recipes) ? d.recipes.length : 0;
            item.batches = isArr(d.batches) ? d.batches.length : 0;
          }
        }
        out.push(item);
      }
      out.sort(function (a, b) {
        if (b.at !== a.at) return b.at - a.at;
        if (b.seq !== a.seq) return b.seq - a.seq;
        return a.key < b.key ? 1 : (a.key > b.key ? -1 : 0);
      });
      return out;
    }

    /** 在某个前缀下找一个没被占的键名（同一分钟内多次备份/恢复要能共存） */
    function freshSnapshotKey(prefix) {
      var ls = root.localStorage;
      var base = (prefix || BROKEN_PREFIX) + '.' + stamp();
      if (ls.getItem(base) === null) return base;
      for (var n = 2; n <= 9; n++) {
        if (ls.getItem(base + '-' + n) === null) return base + '-' + n;
      }
      return base + '-9';           /* 极端情况：覆盖 9 号，但不抛异常打断恢复 */
    }

    /** 把当前主键另存一份快照（进 snap.）。返回 { ok, key, chars, reason }。
     *  为什么进 snap. 而不是 broken.：broken. 由 pruneBroken() 按"证据"的配额剪，
     *  而这份是"恢复前"的后悔药。放在一起的后果是"用户刚点过恢复，再坏一次，
     *  那份后悔药被自动剪枝删掉"——最需要它的时候刚好不在。 */
    function snapshotCurrent() {
      var ls;
      try { ls = root.localStorage; } catch (e) { return { ok: false, reason: 'localStorage 不可用' }; }
      if (!ls) return { ok: false, reason: 'localStorage 不可用' };
      var raw = null;
      try { raw = ls.getItem(KEY); } catch (e2) { return { ok: false, reason: '读不到当前数据' }; }
      if (!raw) return { ok: true, key: null, chars: 0 };   /* 空库没什么可备份的 */
      try {
        var k = writeSnapshot(raw);
        return { ok: true, key: k, chars: raw.length };
      } catch (e3) {
        return { ok: false, code: 'SNAP_NO_ROOM',
                 reason: '空间不足或写入被拒绝（' + ((e3 && e3.message) || e3) + '）' };
      }
    }

    /**
     * 从备份恢复。
     * @param {string} key  备份键名（来自 listBackups()）
     * @param {object} [opts] { reload:false } 时不自动刷新页面（测试用）
     * @returns {{ok:boolean, code?:string, reason?:string, key?:string,
     *            chars?:number, recs?:number, batches?:number,
     *            snapshotKey?:string|null, snapshotChars?:number}}
     *
     * 失败一律返回明确原因，**不静默**：key 不存在 / 不是备份键 /
     * JSON 坏了 / 结构非法 / 快照写不进去 / 写入失败，每种一个 code。
     *
     * ⚠️ 已知且**接受**的一个窗口（不是没想到）：
     *   本函数第一步会 `load()`。如果此刻主键正坏着（数据在开机之后才坏，
     *   或用户在损坏发生后还没刷新过页面），`load()` 会先备份 + `pruneBroken()`，
     *   而 `pruneBroken()` 可能正好把用户点的那个键剪掉 → 表现为 `NOT_FOUND`。
     *   没修的理由：正常路径上开机时就已经备份+剪枝完，撞不到；
     *   为它加"恢复期间冻结剪枝"的状态机会把这条路径复杂化，
     *   而复杂度本身是数据路径上更大的风险。失败时给的是明确原因 + 原数据未动。
     */
    function restoreBackup(key, opts) {
      var o = opts || {};
      /* 先确保读过盘：拒绝状态是 load() 判出来的，不先读就可能漏判。 */
      try { load(); } catch (e0) { /* 读盘失败不影响下面的逐步校验 */ }
      /* 只读（降级）状态禁止恢复：此时主键里躺着的是**更新版本**的数据，
         任何写入都可能把它覆盖掉。宁可让用户升级软件，也不接这个赌。 */
      if (_reject) {
        return {
          ok: false, code: 'READONLY',
          reason: readonlyMessage() + '（恢复备份会覆盖原数据，已拒绝）'
        };
      }
      if (!key || typeof key !== 'string') {
        return { ok: false, code: 'BAD_KEY', reason: '没有指定要恢复哪一份备份' };
      }
      if (key !== BROKEN_PREFIX && key.indexOf(BROKEN_PREFIX + '.') !== 0 &&
          key !== SNAP_PREFIX && key.indexOf(SNAP_PREFIX + '.') !== 0) {
        return { ok: false, code: 'BAD_KEY', reason: '「' + key + '」不是备份键，拒绝写入' };
      }
      var ls;
      try { ls = root.localStorage; } catch (e) { ls = null; }
      if (!ls) return { ok: false, code: 'NO_STORAGE', reason: 'localStorage 不可用，无法恢复' };

      var raw = null;
      try { raw = ls.getItem(key); } catch (e2) { raw = null; }
      if (typeof raw !== 'string' || !raw) {
        return { ok: false, code: 'NOT_FOUND', reason: '这份备份已经不在了（可能已被清理），没有可恢复的内容' };
      }

      var parsed, parsedOk = true;
      try { parsed = JSON.parse(raw); } catch (e3) { parsedOk = false; }
      if (!parsedOk) {
        return { ok: false, code: 'BROKEN_JSON', reason: '这份备份不是合法 JSON，无法恢复（可以先导出再手工修）' };
      }
      var v = validateStructure(parsed);
      if (!v.ok) {
        return { ok: false, code: 'BAD_STRUCTURE', reason: '这份备份结构非法：' + v.fatal.join('；') + '，无法恢复' };
      }

      /* ① 先留后悔药。写不进去就**不做**恢复 —— 一次不可撤销的恢复
            不叫恢复，叫赌博。 */
      var snap = snapshotCurrent();
      if (!snap.ok) {
        return {
          ok: false, code: 'SNAPSHOT_FAILED',
          reason: '没能保存「恢复前」的快照（' + snap.reason + '），已取消恢复。当前数据没有任何改动'
        };
      }

      /* ② 写入备份内容 */
      try {
        ls.setItem(KEY, raw);
      } catch (e4) {
        return {
          ok: false, code: 'WRITE_FAILED',
          reason: '写入失败（' + ((e4 && e4.message) || e4) + '），当前数据未被替换'
        };
      }

      var recs = isArr(parsed.recipes) ? parsed.recipes.length : 0;
      var batches = isArr(parsed.batches) ? parsed.batches.length : 0;

      /* ③ 内存树作废：下次 load() 重新读盘、重新迁移 */
      _data = null;
      _dirty = false;
      _reject = null;
      _warnedSave = false;
      _warnedSet = false;

      var out = {
        ok: true, code: 'OK', key: key, chars: raw.length,
        recs: recs, batches: batches,
        snapshotKey: snap.key, snapshotChars: snap.chars,
        at: backupStampOf(key).at
      };
      try { BREW.Bus.emit('dataRestored', out); } catch (e5) {}

      if (o.reload !== false) {
        try {
          if (root.location && typeof root.location.reload === 'function') root.location.reload();
        } catch (e6) { /* 刷新不了就让调用方重新渲染 */ }
      }
      return out;
    }

    /**
     * 删除一份**自动备份**（损坏现场）。
     * ----------------------------------------------------------------
     * 为什么需要它：极端情况下用户会被自己的保护关在屋里 ——主键 1.6M +
     * 两份 1.6M 的坏串把配额占满，快照写不进去（`WRITE_FAILED`），而坏串
     * 在界面上删不掉，他只剩"清空站点数据"一条路（那等于把证据也扔了）。
     * 一条保护如果让用户无路可走，它就从保护变成了陷阱。
     *
     * 为什么**只准删 auto**：snap. 是药，不给手滑的机会。
     * 想腾地方请先「导出全部数据」——删药永远不是正确的第一步。
     *
     * @returns {{ok:boolean, code?:string, reason?:string, key?:string,
     *            chars?:number, freed?:number}}
     *   code: OK | READONLY | BAD_KEY | DELETE_DENIED | NOT_FOUND | DELETE_FAILED
     */
    function deleteBackup(key) {
      try { load(); } catch (e0) { /* 读盘失败不影响下面的判断 */ }
      if (_reject) {
        return { ok: false, code: 'READONLY', reason: readonlyMessage() };
      }
      if (!key || typeof key !== 'string') {
        return { ok: false, code: 'BAD_KEY', reason: '没有指定要删除哪一份备份' };
      }
      /* 先判 snap：它是"不该删"，与"不是备份键"是两件事，code 要分开 */
      if (key === SNAP_PREFIX || key.indexOf(SNAP_PREFIX + '.') === 0) {
        return {
          ok: false, code: 'DELETE_DENIED',
          reason: '快照（手动 / 恢复前）不能删 —— 它是你唯一能把数据拿回来的那一份。' +
            '要腾地方，请先「导出全部数据」到硬盘'
        };
      }
      if (key !== BROKEN_PREFIX && key.indexOf(BROKEN_PREFIX + '.') !== 0) {
        return { ok: false, code: 'BAD_KEY', reason: '「' + key + '」不是备份键，拒绝删除' };
      }
      var raw = null;
      try { raw = root.localStorage.getItem(key); } catch (e1) { raw = null; }
      if (typeof raw !== 'string' || !raw) {
        return { ok: false, code: 'NOT_FOUND', reason: '这份备份已经不在了（可能已被清理）' };
      }
      var chars = raw.length;
      try {
        root.localStorage.removeItem(key);
      } catch (e2) {
        return { ok: false, code: 'DELETE_FAILED', reason: '删不掉：' + ((e2 && e2.message) || e2) };
      }
      var out = { ok: true, code: 'OK', key: key, chars: chars, freed: chars + key.length };
      try { BREW.Bus.emit('backupDeleted', out); } catch (e3) {}
      return out;
    }

    /** 手动备份（设置页「现在备份一份」）。
     *  为什么需要它：自动备份只会在**数据已经坏了的那一刻**生成，
     *  存下来的是坏掉的原始串——它是证据，不是药。也就是说，只靠自动备份，
     *  「从备份恢复」这个功能一年也用不上一次（列表里全是 valid:false）。
     *  让用户在数据还好着的时候主动存一份，恢复才有意义。
     *  放进同一个 broken 命名空间：它就是"此刻主键的原始字节"，
     *  与损坏备份同形，列表/校验/恢复三条路径都不必分叉。 */
    function backupNow(reason) {
      try { load(); } catch (e) { /* 读盘失败不影响下面的判断 */ }
      if (_reject) {
        return { ok: false, code: 'READONLY', reason: readonlyMessage() };
      }
      var raw = null;
      try { raw = root.localStorage ? root.localStorage.getItem(KEY) : null; } catch (e2) { raw = null; }
      if (typeof raw !== 'string' || !raw) {
        return { ok: false, code: 'EMPTY', reason: '当前没有数据可备份' };
      }
      var recs = 0, batches = 0;
      try {
        var d = JSON.parse(raw);
        recs = isArr(d.recipes) ? d.recipes.length : 0;
        batches = isArr(d.batches) ? d.batches.length : 0;
      } catch (e3) { /* 坏数据也能备份（留档），只是条数报 0 */ }
      var k;
      try {
        k = writeSnapshot(raw);          /* 进 snap.，与损坏现场的 broken. 分开 */
      } catch (e5) {
        /* 腾完地方仍然不够（或浏览器自己抛了配额）：明确失败，主键一个字节没动。
           reason 里带上真实原因，别让用户以为"备份功能坏了"。 */
        return {
          ok: false, code: 'WRITE_FAILED',
          reason: '空间不足，这份备份没写成（' + ((e5 && e5.message) || '配额已满') +
            '）。请先「导出全部数据」到硬盘，再删掉旧批次或历史版本'
        };
      }
      var out = { ok: true, code: 'OK', key: k, chars: raw.length, recs: recs, batches: batches };
      try { BREW.Bus.emit('backupCreated', out); } catch (e4) {}
      return out;
    }

    /* ==================================================================
     * 降级保护（v1.4）：数据来自更新的版本 → 拒绝加载，绝不写盘
     * ----------------------------------------------------------------
     * 场景：用户在新版里存了 v3 的数据，又用旧版（本机 v2）打开同一个键。
     *
     * v1.3 及以前的旧行为有两个洞：
     *   ① `migrate()` 只给 d 打一个 `__schemaFromFuture` 标记就原样放行 →
     *      界面看起来完全正常，用户随手点一次保存，40 的白名单
     *      normalizeRecipe() 就把 v3 的新字段吃掉，而下次 flush 一写，
     *      **原数据被静默覆盖**。用户不会收到任何提示。
     *   ② 更糟的是顺序：`validateStructure()` 跑在版本判定之前。只要 v3 把
     *      recipes / settings 换了形状（对象、数组、新包装），旧版会判
     *      "结构损坏" → `backupBroken()` + `blankDB()` → **主键当场被清空**。
     *      丢字段还能靠备份捡回来，主键被清空是用户的数据直接消失。
     *
     * 现在的规则，顺序不能改（先判版本，再判结构）：
     *   JSON 解析成功 → 取 schemaVersion → 比本机大？
     *     · 不 migrate / 不 repair / 不 backupBroken / 不 flush —— 一个字节都不写
     *     · 内存里给一份空库，只为让界面能起来（不允许白屏）
     *     · 顶部挂常驻横幅，写清"已拒绝加载，原数据没有被改动"
     *     · 所有写入口一律返回失败，第一次拦到时给一次 toast
     * ================================================================== */

    /** 内容指纹：长度无关的两路 32 位哈希（FNV-1a + djb2 变体）。
     *  只用来证明"前后是同一串"，不是防篡改。两路走不同路径，
     *  单一算法的碰撞（同一个 32 位值）不会同时命中。 */
    function fingerprint(s) {
      var str = String(s === undefined || s === null ? '' : s);
      var h1 = 0x811c9dc5, h2 = 0x01000193;
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        h1 ^= c;
        h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
        h2 = (((h2 << 5) + h2) ^ c) >>> 0;
      }
      return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
    }

    /** 拒绝状态的统一文案。界面上（横幅 / 设置页 / toast）只能从这里取，
     *  免得三个地方各写一句、有一天互相矛盾。 */
    function readonlyMessage() {
      var s = _reject || { from: 0, current: BREW.Config.SCHEMA_VERSION };
      return '这份数据来自更新的版本（v' + s.from + ' > 本机 v' + s.current + '）。' +
        '为了不丢字段，已拒绝加载，原数据没有被改动。请升级软件后再打开。';
    }

    /** 所有写入口的统一出口：返回 false，并且**每类操作整个会话只提示一次**。
     *  @param {string} what 人话动作名（"保存配方"）
     *  @param {string} [kind] 'save'（默认，用户点的按钮）| 'set'（设置项）| 'quiet'（内部自动落盘）
     *
     *  为什么只一次：用户连点五次保存，该看到一次"为什么没存进去"，
     *  而不是五次弹窗——五次弹窗会把顶部横幅那张真正的说明挤没。 */
    function refuseWrite(what, kind) {
      var k = kind || 'save';
      if (k === 'quiet') return false;
      if (k === 'set' ? _warnedSet : _warnedSave) return false;
      if (k === 'set') _warnedSet = true; else _warnedSave = true;

      var msg = '只读模式：「' + what + '」没有保存。' + readonlyMessage();
      var shown = false;
      try {
        if (BREW.UI && BREW.UI.Shell && typeof BREW.UI.Shell.toast === 'function') {
          BREW.UI.Shell.toast(msg, 'warn', 5600);
          shown = true;
        }
      } catch (e) { shown = false; }
      if (!shown) {
        try { BREW.Bus.emit('readonlyWriteBlocked', { message: msg, what: what }); } catch (e2) {}
      }
      if (root.console && console.warn) console.warn('[Store] 拒绝写入（' + what + '）：' + readonlyMessage());
      return false;
    }

    /** 顶部常驻横幅。用内联样式是有意的：css/ 不归本文件管，
     *  而且这条横幅必须在"任何样式表都没生效"的极端情况下也看得见。
     *
     *  v1.6：原来写的是 #4a2d0c 深棕底 + #ffe3b8 浅黄字 + #d08a2a 橙线，
     *  那是 v1.5 深色主题的配色。纸面主题上突然盖一条深棕色色带，读起来
     *  像"另一个软件弹的窗口"。现在改走令牌：浅纸底 + 主字 + 一道 --warn 的
     *  下边框 —— 这条横幅的语义就是"注意，写入被拒了"，用 warn 而不是 bad，
     *  因为它不是错误，是保护。
     *  ⚠️ 每个 var() 都带兜底值：样式表没加载时（本函数存在的理由）
     *  var() 解析失败会整条声明作废，横幅就变成透明浮字。 */
    function installReadonlyBanner() {
      var doc = root.document;
      if (!doc || !_reject) return;
      if (doc.getElementById(BANNER_ID)) return;

      var paint = function () {
        if (!doc.body || doc.getElementById(BANNER_ID)) return;
        var s = _reject;
        var el = doc.createElement('div');
        el.id = BANNER_ID;
        el.setAttribute('role', 'alert');
        el.style.cssText = [
          'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
          'padding:9px 14px',
          'background:var(--bg-3, #f3eeea)', 'color:var(--tx-1, #2d2823)',
          'border-bottom:2px solid var(--warn, #93410a)',
          'font:13px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif',
          'box-shadow:var(--sh-2, 0 4px 14px rgba(74,58,38,.10))'
        ].join(';');
        el.innerHTML =
          '<div style="font-weight:700;font-size:13.5px">' +
            '只读 · 数据来自更新的版本（v' + s.from + ' &gt; 本机 v' + s.current + '）</div>' +
          '<div>' + readonlyMessage() + '</div>' +
          '<div style="opacity:.78;font-variant-numeric:tabular-nums">' +
            '原数据 ' + s.chars + ' 字符 · 指纹 ' + s.hash +
            ' · 本次会话的保存一律被拒绝（含导入、恢复备份、恢复默认）</div>';
        if (doc.body.firstChild) doc.body.insertBefore(el, doc.body.firstChild);
        else doc.body.appendChild(el);

        /* 横幅是 fixed，会盖住顶栏。把 .app 顶下去并把高度扣掉，
           否则页面右下会多出一条滚动条（.app 是 100dvh 的网格）。
           窄屏下 .app 是 height:auto/min-height，只挪不改高。 */
        var h = el.offsetHeight || 0;
        var app = doc.getElementById('app');
        if (app && h) {
          app.style.marginTop = h + 'px';
          try {
            if (root.innerWidth > 900) app.style.height = 'calc(100dvh - ' + h + 'px)';
          } catch (e) { /* 旧内核不认 calc，就让它多一条滚动条 */ }
        }
      };

      if (doc.body) paint();
      else if (doc.addEventListener) doc.addEventListener('DOMContentLoaded', paint);
    }

    /* ==================================================================
     * 读取
     * ================================================================== */
    function load() {
      if (_data) return _data;
      var raw = null;
      try {
        raw = root.localStorage ? root.localStorage.getItem(KEY) : null;
      } catch (e) {
        console.warn('[Store] localStorage 不可用，进入内存模式（刷新后数据会丢）');
      }
      if (!raw) {
        _data = blankDB();
        return _data;
      }

      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        /* 连 JSON 都不是：唯一能做的就是留档 + 空库 */
        var k1 = backupBroken(raw, 'JSON 解析失败');
        console.error('[Store] 数据不是合法 JSON，已备份到 ' + (k1 || '（备份也失败了）') + '，新建空库');
        _data = blankDB();
        return _data;
      }

      /* ⚠️ 顺序铁律（v1.4）：版本判定必须跑在 validateStructure / migrate /
         repairStructure / backupBroken 之前。放到后面，等于"先把更新的数据
         判成坏数据、备份一份、再把主键清空"——那才是真正的丢数据。
         先判版本，未来版本的数据就永远不会被旧版判成"损坏"。 */
      var fromV = 0;
      try {
        fromV = (parsed && typeof parsed === 'object')
          ? (Number(parsed.schemaVersion) || 0) : 0;
      } catch (e) { fromV = 0; }

      if (fromV > BREW.Config.SCHEMA_VERSION) {
        /* 拒绝加载：不 migrate、不 repair、不备份、不 flush。
           _data 给一份空库只为界面能起来；它是内存里的临时对象，
           任何写入口都会在落盘前被拦住（见 flush / writeNow / refuseWrite）。 */
        _reject = {
          from: fromV,
          current: BREW.Config.SCHEMA_VERSION,
          chars: raw.length,
          hash: fingerprint(raw),
          at: Date.now(),
          raw: raw                     /* 只读保留，供 exportJSON 原样导出 */
        };
        _data = blankDB();
        _dirty = false;
        installReadonlyBanner();
        if (root.console && console.error) {
          console.error('[Store] 拒绝加载：数据 schemaVersion=' + fromV +
            ' 高于本机 ' + BREW.Config.SCHEMA_VERSION +
            '（' + raw.length + ' 字符，指纹 ' + _reject.hash + '）。原样保留，未做任何写入。');
        }
        try {
          BREW.Bus.emit('dataRejected', {
            from: fromV, current: BREW.Config.SCHEMA_VERSION,
            chars: raw.length, hash: _reject.hash
          });
        } catch (e3) { /* 没有监听方也不影响拒绝状态 */ }
        return _data;
      }

      var chk = validateStructure(parsed);
      if (!chk.ok) {
        var k2 = backupBroken(raw, '结构损坏');
        console.error('[Store] ' + chk.fatal.join('；') + '，已备份到 ' + (k2 || '（备份失败）') + '，新建空库');
        _data = blankDB();
        return _data;
      }

      try {
        _data = migrate(parsed);
      } catch (e) {
        /* 迁移步骤抛异常 ≠ 丢数据。
           本设计的迁移只做加法，此刻 d 至少是"原数据 + 部分新键"，可读。
           所以：备份原始串、记错误、schemaVersion 不推进（下次打开重试），
           把数据交还给用户 —— 只是新功能降级，而不是白屏。 */
        var k3 = backupBroken(raw, '迁移异常');
        try {
          parsed.meta = isPlainObj(parsed.meta) ? parsed.meta : {};
          parsed.meta.migrateError = String((e && e.message) || e);
          parsed.schemaVersion = Number(parsed.schemaVersion) || 0;
        } catch (e2) {}
        console.error('[Store] 迁移失败（已备份到 ' + (k3 || '失败') + '），按原结构继续运行：', e);
        _data = parsed;
      }

      if (chk.repair.length) {
        _data.meta = isPlainObj(_data.meta) ? _data.meta : {};
        _data.meta.repairedAt = Date.now();
        _data.meta.repairedKeys = chk.repair;
      }
      return _data;
    }

    /* ==================================================================
     * 写入
     * ================================================================== */
    function isQuotaError(e) {
      return !!(e && (e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014));
    }

    /* ==================================================================
     * 库存形状归一（v1.2）
     * ----------------------------------------------------------------
     * 契约（冻结，写在这里是因为"字段名"本身也是一种迁移）：
     *
     *   inventory.items[] = { key, kind, refId, name, unit, qty, par, price, updatedAt }
     *   inventory.moves[] = { id, key, kind, refId, at, delta, unit, reason, batchId, note }
     *
     *   key    = kind + ':' + refId，主键
     *   kind   ∈ malts | hops | yeasts | adjuncts
     *   delta  带符号：入库正、出库负。**唯一**的量表示，不许 qty+dir 双表示
     *   qty    **只是缓存快照**，权威永远是 Σ moves.delta；读端不许拿它算余额
     *   move.unit 必须等于 items[key].unit，不等不换算（换算要有密度/含水率，
     *   这里没有，硬换就是编数据）
     *
     * 为什么需要这个函数：items/moves 的形状虽然早定了 {items:[],moves:[]}，
     * 但**字段名**从来没被写下来过，计算侧和界面侧各猜一半、靠"宽容读取"糊着。
     * 只要有一方写成第三种叫法，库存就静默算成 0——不报错，只是配方行永远
     * 显示"未录库存"、采购清单永远空。这类"数字对但语义错"的故障最难查。
     *
     * 职责是**把数据捏成唯一形状**，不是校验报错：
     *   · 缺 key 但有 kind+refId → 拼出来
     *   · 只有 key → 按第一个 ':' 拆
     *   · key 与 kind+refId 冲突 → **以 key 为准**，覆盖后两者
     *   · 真修不了的（delta 非有限数/为 0、kind 非法、键格式坏）→ 丢弃并记数
     *   · **绝不发明数值**：缺 qty 就是 null，不当 0
     * 幂等：跑两次结果逐字节一致（test-migrate 有断言）。
     * ================================================================== */
    var INV_KINDS = { malts: 1, hops: 1, yeasts: 1, adjuncts: 1 };

    function splitInvKey(key) {
      var s = String(key === undefined || key === null ? '' : key);
      var i = s.indexOf(':');
      if (i <= 0 || i === s.length - 1) return null;    /* 不能是 '' / 'abc' / 'a:' / ':b' */
      return { kind: s.slice(0, i), refId: s.slice(i + 1) };
    }

    /** 把一条 entry 的 key/kind/refId 捏一致；捏不动返回 null（调用方丢弃） */
    function settleKey(entry) {
      var key = (typeof entry.key === 'string' && entry.key) ? entry.key : null;
      if (!key && entry.kind && entry.refId) key = String(entry.kind) + ':' + String(entry.refId);
      if (!key) return null;
      var sp = splitInvKey(key);
      if (!sp || !INV_KINDS[sp.kind]) return null;
      /* key 为准：不一致时用它覆盖后两者 */
      entry.key = key;
      entry.kind = sp.kind;
      entry.refId = sp.refId;
      return sp;
    }

    function normalizeInventory(d) {
      var db = d || load();
      var dropped = 0, unitMismatch = 0;

      if (!isPlainObj(db.inventory)) db.inventory = { items: [], moves: [] };
      var inv = db.inventory;
      var items = isArr(inv.items) ? inv.items : [];
      var moves = isArr(inv.moves) ? inv.moves : [];

      /* ---- 物料主数据 ---- */
      var unitOf = {};          /* key → unit，给流水做单位一致性检查 */
      var outItems = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!isPlainObj(it)) { dropped++; continue; }
        var sp = settleKey(it);
        if (!sp) { dropped++; continue; }
        if (typeof it.unit !== 'string' || !it.unit) it.unit = null;   /* 不猜单位 */
        if (!('qty' in it)) it.qty = null;                              /* 0 是有意义的数，null 才是"没数" */
        if (it.qty !== null && (typeof it.qty !== 'number' || !isFinite(it.qty))) it.qty = null;
        unitOf[it.key] = it.unit;
        outItems.push(it);
      }

      /* ---- 流水（账） ---- */
      var outMoves = [];
      for (var j = 0; j < moves.length; j++) {
        var mv = moves[j];
        if (!isPlainObj(mv)) { dropped++; continue; }
        var sp2 = settleKey(mv);
        if (!sp2) { dropped++; continue; }

        var dl = Number(mv.delta);
        if (!isFinite(dl) || dl === 0) { dropped++; continue; }   /* 0 的流水没有信息量，只会让账变脏 */
        mv.delta = dl;

        if (typeof mv.unit !== 'string' || !mv.unit) mv.unit = null;
        else if (unitOf[mv.key] && mv.unit !== unitOf[mv.key]) {
          /* 单位不一致：**不丢数据、也不换算**（换算要密度/含水率，我们没有）。
             只记数交给 audit 去追。账可以脏，但不能被程序悄悄改。 */
          unitMismatch++;
        }
        /* 缺 id 就没法去重（合并导入按 id 并），补一个确定性的：
           同一份数据跑两次得到同一个 id，所以幂等不破。 */
        if (!mv.id) mv.id = 'mv-' + String(mv.at === undefined ? 'na' : mv.at) + '-' + (j + 1);
        outMoves.push(mv);
      }

      inv.items = outItems;
      inv.moves = outMoves;

      if (dropped) {
        db.meta = isPlainObj(db.meta) ? db.meta : {};
        db.meta.droppedRecords = (db.meta.droppedRecords || 0) + dropped;
      }
      if (unitMismatch) {
        db.meta = isPlainObj(db.meta) ? db.meta : {};
        /* 出口：设置页「数据」卡的「数据一致性」行（58-ui-settings.js 的
           consistencyRow()）。两个计数都为 0 时该行整块不渲染 —— 正常情况下
           它永远不该出现，出现就说明有东西要核对。
           注意它是"当前不一致条数"（每次归一重算），不是累计值。
           早期这里是 TODO 且没有任何展示；记了不显示等于半成品，也容易被后人
           当成死字段删掉。tools/test-views.js 有断言钉住这个出口。 */
        db.meta.inventoryUnitMismatch = unitMismatch;
      }
      return db.inventory;
    }

    /* ==================================================================
     * 库存余额（v1.2）
     * ----------------------------------------------------------------
     * → { malts: { 'm-2row': { qty: 4.5, unit: 'kg' } }, hops: {…}, yeasts: {…}, adjuncts: {…} }
     *
     * 为什么放在 Store 而不是 33-inventory：
     *   不是"因为它公共"——是因为它读的是 Store 自己的数据。
     *   放在 33 里，33 就从"只吃入参的纯函数"退化成"要读库的混合体"，
     *   而 33 的纯函数性是它最好的性质（node 里能直接测）。
     *
     * 三条硬约束：
     *   ① **只从 moves 算**。items[].qty 是缓存，读它 = 允许同一笔账被算两遍，
     *      这正是"余额莫名其妙翻倍"那类 bug 的成因。
     *   ② unit 取 items[].unit；没有就取流水自己的；都没有就是 null。
     *      **不要瞎猜 'kg'** —— 猜错单位的后果比"不知道"严重得多。
     *   ③ 纯读：不改数据、不 emit、不 touch。调用它不该产生任何副作用。
     * ================================================================== */
    function inventoryBalance() {
      var d = load();
      var inv = isPlainObj(d.inventory) ? d.inventory : {};
      var out = { malts: {}, hops: {}, yeasts: {}, adjuncts: {} };
      var unitOf = {};

      /* 第一遍：items 只贡献"这个物料存在"和它的单位 */
      var items = isArr(inv.items) ? inv.items : [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!isPlainObj(it)) continue;
        var sp = splitInvKey(it.key);
        if (!sp || !out[sp.kind]) continue;
        var k1 = sp.kind + ':' + sp.refId;
        if (unitOf[k1] === undefined && it.unit) unitOf[k1] = it.unit;
        if (!out[sp.kind][sp.refId]) {
          out[sp.kind][sp.refId] = { qty: 0, unit: (unitOf[k1] || null) };
        } else if (!out[sp.kind][sp.refId].unit && it.unit) {
          out[sp.kind][sp.refId].unit = it.unit;
        }
      }

      /* 第二遍：moves 是唯一权威 */
      var moves = isArr(inv.moves) ? inv.moves : [];
      for (var j = 0; j < moves.length; j++) {
        var mv = moves[j];
        if (!isPlainObj(mv)) continue;
        var sp2 = splitInvKey(mv.key);
        if (!sp2 || !out[sp2.kind]) continue;
        var k2 = sp2.kind + ':' + sp2.refId;
        var entry = out[sp2.kind][sp2.refId];
        if (!entry) {
          entry = out[sp2.kind][sp2.refId] = { qty: 0, unit: null };
        }
        if (!entry.unit) entry.unit = mv.unit || unitOf[k2] || null;
        var dl = Number(mv.delta);
        if (!isFinite(dl)) continue;
        entry.qty += dl;
      }

      /* 0.1 + 0.2 = 0.30000000000000004 这种不该出现在界面和测试里。
         取 4 位小数：克级精度到 0.0001，够用且不会掩盖真实误差。 */
      for (var kind in out) {
        if (!has(out, kind)) continue;
        for (var refId in out[kind]) {
          if (has(out[kind], refId)) out[kind][refId].qty = U.round(out[kind][refId].qty, 4);
        }
      }
      return out;
    }

    /* ==================================================================
     * 草稿桶（v1.2，修 D5）
     * ----------------------------------------------------------------
     * 问题：工作副本（还没保存过的配方）的 id 是 UI.blankRecipe() 现发的
     * 一个随机 uid，每刷新一次就换一个。挂在它名下的数据（酒标）等于写进
     * 一个下一次就再也找不到的抽屉——数据还在 localStorage 里，只是没人能
     * 引用到它。实测：settings.restoreLastEdit=false 时，存一张标 → 刷新 →
     * 标就"没了"。
     *
     * 修法：未保存的配方统一用一个**固定**的占位键 '__draft__'。
     *   · 不能用时间戳/随机 id —— 那每次刷新还是新键，等于没修；
     *   · 不能用空串 —— 空键在 JSON 里合法但极容易被 `if (!key)` 当成"没有"。
     *
     * 第一次真正保存时，把 __draft__ 名下那批迁到真 id 下，然后删掉空壳。
     * 迁移必须幂等：重复调用不重复、不丢。
     * ================================================================== */
    var DRAFT_KEY = '__draft__';

    function findRecipeIn(d, id) {
      if (!id || !isArr(d.recipes)) return null;
      for (var i = 0; i < d.recipes.length; i++) {
        if (d.recipes[i] && d.recipes[i].id === id) return d.recipes[i];
      }
      return null;
    }

    /** 一份配方该用哪个键存它的衍生物（酒标）。
     *  已保存过（库里有）→ 真 id；否则（工作副本、临时 uid、空 id）→ '__draft__'。
     *  判定标准是"库里有没有"，不是"id 长什么样"——工作副本的 uid 也长得很像真的。 */
    function labelKeyOf(recipe) {
      var id = recipe && recipe.id;
      if (!id) return DRAFT_KEY;
      var d = load();
      return findRecipeIn(d, id) ? String(id) : DRAFT_KEY;
    }

    /** 把 __draft__ 名下的酒标迁到真 id 下。幂等；返回迁移条数 */
    function adoptDraftLabels(newId) {
      if (!newId || newId === DRAFT_KEY) return 0;
      var d = load();
      if (!isPlainObj(d.labels)) return 0;
      var draft = d.labels[DRAFT_KEY];
      if (!isArr(draft) || !draft.length) {
        if (has(d.labels, DRAFT_KEY)) delete d.labels[DRAFT_KEY];
        return 0;
      }
      var cur = isArr(d.labels[newId]) ? d.labels[newId].slice() : [];
      var seen = {};
      for (var i = 0; i < cur.length; i++) if (cur[i] && cur[i].id) seen[cur[i].id] = 1;
      var moved = 0;
      for (var j = 0; j < draft.length; j++) {
        var x = draft[j];
        if (!x) continue;
        /* 按 id 去重：重入时同一张标不会被搬两遍 */
        if (x.id && seen[x.id]) continue;
        if (x.id) seen[x.id] = 1;
        cur.push(x);
        moved++;
      }
      d.labels[newId] = cur;
      delete d.labels[DRAFT_KEY];
      return moved;
    }

    /* ==================================================================
     * 版本历史（v1.2）
     * ----------------------------------------------------------------
     * 形状：versions[recipeId] = [{ rev, at, hash, notesHash, notesLen, partial, rec }]
     *
     * 三条硬规则，改代码前先读：
     *   ① hash 必须用**合并后**的对象算。入参 r 是 UI 的工作副本，来自
     *      normalizeRecipe 白名单，缺字段是常态；拿它算 hash 会把
     *      "字段缺失"当成"内容变化"，每次保存都建一个假版本。
     *   ② notes 不存原文，只存 hash + 长度。diff 能说"备注 320→410 字，有改动"
     *      就够了；存原文会让每条约 2 K 的版本再胖 15%，而备注的逐字 diff
     *      是这一版里价值最低的信息。
     *   ③ rev 的语义是"不同内容的第 N 版"，不是"保存次数"。内容没变就不建版本、
     *      也不推进 rev —— 否则用户连点两次保存，历史里就多一条完全一样的记录。
     * ================================================================== */
    var VERSIONS_MAX = 5;        /* 每配方常规保留条数 */
    var VERSIONS_TIGHT = 2;      /* L1 水位 */
    var VERSIONS_MIN = 1;        /* L2 水位 / 配额兜底 */
    /* 水位阈值（v1.2 实测后定稿）。单位是"字符数"，不是字节。
     *
     * 实测配额（tools/test-quota.js，Chrome 新版 / file://）：5 242 867 字符。
     * 约束不是"主键 + 一份备份"，是 **3N**：
     *   主键 N + 旧 broken N + 新 broken N（BROKEN_KEEP = 2）
     * 一旦 3N 超配额，`backupBroken()` 会退回单槽、单槽也失败就 return null——
     * 用户在最需要备份的那一刻一份都拿不到，然后主键被重置为空库。
     * 所以：3 × 1.6 M = 4.8 M，给 settings / inventory / working / labels
     * 和 JSON 开销留 0.44 M 余量。
     *
     * ⚠️ 不要再往上抬。历史版本的边际价值远低于"库炸了还能捞回来"。 */
    var WATER_L0 = 1100000;      /* 开始削旧版 */
    var WATER_L1 = 1400000;      /* 每配方 2 条 */
    var WATER_L2 = 1600000;      /* 每配方 1 条；超过就冻结不再记新版本 */
    /* 浏览器配额（字符数）。**这是实测值，不是规范值**：
       tools/test-quota.js 用 64 K 粗灌 + 4 K/256/16/1 精修到 1 字符，量出
       Chrome 在 file:// 下的 localStorage 上限是 5 242 867 个字符
       （= 5 × 1024 × 1024，按 UTF-16 编码单元计，汉字与字母等价，落盘各占 2 字节）。
       旧文档写的"约 5 MB / 2.5 M 字符"已作废——那是把字节预算当成了字符预算。
       换浏览器或换内核时这个数会变，所以只用来算占用百分比给人看，
       **不用它做任何裁剪决策**（裁剪决策只看 WATER_L0/L1/L2）。 */
    var QUOTA_CHARS = 5242867;
    var REC_MAX_CHARS = 8000;    /* 单版本超这个长度就裁剪 */
    var REC_HARD_MAX = 16000;    /* 裁完还超这个长度，就只记账不存快照 */

    /* 版本快照里**不要**的字段：身份、时间戳、版本号、谱系、作者、备注 */
    var REC_SKIP = {
      id: 1, createdAt: 1, updatedAt: 1, rev: 1, parentId: 1, author: 1, notes: 1
    };

    /** FNV-1a 32 位 → 定长 7 位 base36。只做变更检测，不是防篡改 */
    function fnv1a(str) {
      var h = 0x811c9dc5;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        /* 等价于 h *= 16777619，但用移位避免 double 精度丢失 */
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return ('0000000' + (h >>> 0).toString(36)).slice(-7);
    }

    /** 版本快照正文：黑名单式拷贝（新加的配方字段自动进版本，不用回来改这里） */
    function versionRec(recipe) {
      var rec = U.clone(recipe) || {}, k;
      for (k in REC_SKIP) if (has(REC_SKIP, k)) delete rec[k];
      var body = JSON.stringify(rec) || '';
      if (body.length > REC_MAX_CHARS) {
        /* 用户贴了巨型自建原料表。只留原料与目标值，其余段落标 partial。
           ⚠️ 但裁剪往往救不了这种配方——**大头就是原料表本身**：
           实测 240 行假麦芽的 rec 原 32 K，裁完仍然 31 K（只掉了 water/mash
           这一千多字符）。所以再加一道硬顶：裁完还超 REC_HARD_MAX，就
           只记账不存快照（rec:null + oversize:true）。否则 5 版 × 32 K
           能让一个配方独占 160 K，直接把水位从 L0 顶到 L1。
           时间轴上仍然有这条（rev/at/hash 都在），只是点开看不到内容。 */
        var slim = { partialOf: 'recipe', fermentables: rec.fermentables,
                     hops: rec.hops, yeasts: rec.yeasts, adjuncts: rec.adjuncts,
                     targets: rec.targets };
        if ((JSON.stringify(slim) || '').length > REC_HARD_MAX) {
          return { rec: null, partial: true, oversize: true };
        }
        return { rec: slim, partial: true };
      }
      return { rec: rec, partial: false };
    }

    /** 内容指纹：正文 + 备注哈希。备注改了也算"内容变了" */
    function versionHash(rec, notesHash) {
      return fnv1a((JSON.stringify(rec) || '') + '#' + notesHash);
    }

    function latestVersion(d, recipeId) {
      if (!isPlainObj(d.versions)) return null;
      var arr = d.versions[recipeId];
      return (isArr(arr) && arr.length) ? arr[arr.length - 1] : null;
    }

    /** 把 versions 整体压到「每配方 perRecipe 条」，返回释放掉的条数 */
    function trimVersions(d, perRecipe) {
      var n = 0;
      if (!isPlainObj(d.versions)) return 0;
      for (var id in d.versions) {
        if (!has(d.versions, id)) continue;
        var arr = d.versions[id];
        if (!isArr(arr)) { d.versions[id] = []; continue; }
        if (arr.length > perRecipe) {
          n += arr.length - perRecipe;
          d.versions[id] = arr.slice(-perRecipe);   /* 永远留最新的 */
        }
      }
      if (n) {
        d.meta = isPlainObj(d.meta) ? d.meta : {};
        d.meta.trimmedAt = Date.now();
        d.meta.trimmedCount = (d.meta.trimmedCount || 0) + n;
      }
      return n;
    }

    /** 当前水位：0 常规 / 1 紧 / 2 最紧 / 3 冻结（不再记新版本） */
    function waterLevel(chars) {
      if (chars < WATER_L0) return 0;
      if (chars < WATER_L1) return 1;
      if (chars <= WATER_L2) return 2;
      return 3;
    }

    /** 按当前水位把已有版本压到位。返回水位值 */
    function applyWaterLevel(d) {
      /* 走 api.estimatedChars 而不是内部 treeChars：测试要能打桩，
         也方便将来把它换成"增量维护的字符计数"而不改这里 */
      var chars = 0;
      try { chars = api.estimatedChars(); } catch (e) { chars = 0; }
      var lvl = waterLevel(chars);
      if (lvl >= 1) trimVersions(d, lvl === 1 ? VERSIONS_TIGHT : VERSIONS_MIN);
      return lvl;
    }

    /** 追加一条版本。水位 3 时不写，并只 emit 一次 versionsFrozen */
    function pushVersion(d, recipe) {
      if (!isPlainObj(d.versions)) d.versions = {};
      var id = recipe.id;

      var lvl = applyWaterLevel(d);          /* 先看水位，再决定要不要写 */
      if (lvl >= 3) {
        d.meta = isPlainObj(d.meta) ? d.meta : {};
        if (!d.meta.versionsFrozenAt) {
          d.meta.versionsFrozenAt = Date.now();
          BREW.Bus.emit('versionsFrozen', {
            message: '数据量已达上限，不再记录新的配方版本；请导出后归档旧批次'
          });
        }
        return null;
      }

      var notes = (typeof recipe.notes === 'string') ? recipe.notes : '';
      var notesHash = fnv1a(notes);
      var built = versionRec(recipe);
      var entry = {
        rev: recipe.rev,
        at: Date.now(),
        hash: versionHash(built.rec, notesHash),
        notesHash: notesHash,
        notesLen: notes.length,
        partial: built.partial,
        rec: built.rec
      };
      if (built.oversize) entry.oversize = true;

      if (!isArr(d.versions[id])) d.versions[id] = [];
      var arr = d.versions[id];
      arr.push(entry);
      /* 每配方上限。这里只做常规上限，水位裁剪在上面已经做过，
         但压完可能又超（水位刚好卡在边界），所以再来一次保险 */
      while (arr.length > VERSIONS_MAX) arr.shift();
      if (lvl >= 1) trimVersions(d, lvl === 1 ? VERSIONS_TIGHT : VERSIONS_MIN);
      return entry;
    }

    /** 紧急瘦身：只动 versions，永远不动 recipes / batches。返回是否真的腾出了空间 */
    function emergencyTrim(d) {
      /* 与水位裁剪共用同一个函数——两份实现必然走偏，
         配额兜底时也该走同一套规则，只是目标压到最低 */
      var n = trimVersions(d, VERSIONS_MIN);
      if (n) {
        d.meta = isPlainObj(d.meta) ? d.meta : {};
        d.meta.emergencyTrimAt = Date.now();
      }
      return n > 0;
    }

    function writeNow(d) {
      /* 兜底的第二道闸。正常情况下 flush() 已经在前面拦住，
         这里再拦一次是因为 writeNow 是**唯一**碰主键的地方——
         将来谁绕开 flush 直接调它，也不会把只读状态写穿。 */
      if (_reject) {
        var e0 = new Error('只读模式：拒绝写入主键（' + readonlyMessage() + '）');
        e0.code = 'READONLY';
        throw e0;
      }
      root.localStorage.setItem(KEY, JSON.stringify(d));
    }

    /** 写盘。返回**是否真的写进去了**——调用方（尤其是导入）需要知道结果，
     *  "没写进去但函数正常返回"是静默丢数据的标准形态。 */
    var flush = function () {
      /* 降级保护：只读状态下不写盘，也不改 _dirty。
         返回 false 是契约的一部分：persistOrThrow() 会据此抛给界面。 */
      if (_reject) return false;
      if (!_dirty) return true;
      var d = load();
      d.updatedAt = Date.now();
      try {
        writeNow(d);
        _dirty = false;
        return true;
      } catch (e) {
        if (!isQuotaError(e)) {
          console.error('[Store] 写入失败', e);
          return false;
        }
        /* 配额满：先瘦身 versions 再试一次，仍失败才惊动用户。
           现状是"只 emit 一个 Toast，数据留在内存里，用户继续编辑，
           下次刷新全丢"——这条最多算提示，不叫保护。 */
        var freed = emergencyTrim(d);
        if (freed) {
          try {
            writeNow(d);
            _dirty = false;
            BREW.Bus.emit('storageTrimmed', { message: '存储接近上限，已把历史版本压缩到最新一版' });
            return true;
          } catch (e2) { /* 落到下面统一报满 */ }
        }
        BREW.Bus.emit('storageFull', { message: '本地存储已满（约 5MB），请先导出，再删除旧批次或旧版本' });
        return false;
      }
    };

    /** 立即写盘；写不进去就抛。
     *  为什么"保存"这条路径必须抛：`storageFull` 事件目前**一个监听方都没有**
     *  （全库 grep 为空），所以静默失败 = 用户看到"已保存"、关掉页面就没了。
     *  抛出去至少能落到已有的 try/catch 上（42 的保存有 catch → toast），
     *  而且此时数据还在内存里，用户立刻导出备份就能救回来。 */
    function persistOrThrow(what) {
      if (flush()) return true;
      var e = new Error('本地存储已满，这次' + what + '没能写进磁盘' +
        '（改动还在内存里，关掉页面会丢）。请先「导出」备份，再删掉旧批次或历史版本');
      e.code = 'STORAGE_FULL';
      throw e;
    }

    var scheduleFlush = U.throttle(flush, 400);

    function touch() {
      if (_reject) return;      /* 只读：连节流队列都不进，省得 400ms 后白跑一次 */
      _dirty = true;
      scheduleFlush();
    }

    /* 注意这里是 var api = {...} 而不是直接 return {...}：
       applyWaterLevel() 要能调到 api.estimatedChars()，测试也靠它打桩。
       直接 return 字面量的话，那些函数只能调内部实现，没法在测试里替换水位。 */
    var api = {
      /** 取整个库（只读用，改结构请用下面的业务方法） */
      all: function () { return load(); },

      get: function (path, def) {
        var cur = load(), parts = String(path).split('.');
        for (var i = 0; i < parts.length; i++) {
          if (cur === null || cur === undefined) return def;
          cur = cur[parts[i]];
        }
        return cur === undefined ? def : cur;
      },

      set: function (path, val) {
        /* 文案里不写内部路径（'settings.theme' 这种）：用户看不懂，也不该看到。
           路径留在 console.warn 里，排查时去控制台看。 */
        if (_reject) return refuseWrite('修改设置', path === 'working' ? 'quiet' : 'set');
        var d = load(), parts = String(path).split('.'), cur = d;
        for (var i = 0; i < parts.length - 1; i++) {
          if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = val;
        touch();
        return val;
      },

      /* ---------------- 配方 ---------------- */
      listRecipes: function () { return load().recipes; },

      getRecipe: function (id) {
        var list = load().recipes;
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
      },

      saveRecipe: function (r) {
        if (_reject) return refuseWrite('保存配方');
        var d = load();
        r.updatedAt = Date.now();
        if (!r.createdAt) r.createdAt = r.updatedAt;
        for (var i = 0; i < d.recipes.length; i++) {
          if (d.recipes[i].id !== r.id) continue;

          var prev = d.recipes[i];
          var prevRev = Number(prev.rev) || 1;

          /* ⚠️ 合并写，不是整体替换。
             r 通常来自 UI.recipe()，而 40-ui-shell.js 的 normalizeRecipe()
             是**白名单**，不认识的键一律产出不了。整体替换等于"凡是我不知道
             的字段，用户一保存就被我删了"——跨版本、第三方导入、将来加的
             任何新字段都中招，而且不报错。
             合并之后，UI 只能改它能改的，改不掉它不认识的。
             注意剔除 undefined：Object.assign 会把 undefined 也覆盖上去，
             而 JSON.stringify 会把它丢掉，等于隔一次保存删一个字段。 */
          var merged = {}, k;
          for (k in prev) if (has(prev, k)) merged[k] = prev[k];
          for (k in r) if (has(r, k) && r[k] !== undefined) merged[k] = r[k];

          /* 版本判定必须在 merged 上做（见文件内 §版本历史 规则①） */
          var notesStr = (typeof merged.notes === 'string') ? merged.notes : '';
          var built = versionRec(merged);
          var h = versionHash(built.rec, fnv1a(notesStr));
          var last = latestVersion(d, merged.id);
          var changed = !(last && last.hash === h);

          merged.rev = changed ? prevRev + 1 : prevRev;

          /* ⚠️ 入库的必须是**独立副本**。
             merged 是浅合并：数组字段（fermentables/hops/…）仍然指向 r 的
             同一批对象，而 r 是 UI 的工作副本、用户接着还会改它。
             按引用入库 = "保存"这件事根本没发生，库里的配方跟着草稿一起变。
             症状：已保存版本永远等于当前内容 → 版本对比永远显示"完全一致"、
             版本历史里两条快照读出来是同一个值。这类 bug 不报错，只是结论错。
             工作副本是草稿，草稿继续被改不该影响已保存的版本 ——
             这是 diff 与版本历史成立的前提。 */
          var stored = U.clone(merged);
          d.recipes[i] = stored;
          if (changed) pushVersion(d, stored);
          r.rev = stored.rev;        /* 让工作副本的 rev 跟库一致（旧行为） */
          touch();
          persistOrThrow('配方');
          BREW.Bus.emit('recipeSaved', stored);
          return stored;
        }
        /* 新配方：rev=1，并且**必须建基线**——否则用户改完第一版没有可比对象。
           同样按独立副本入库，理由同上。 */
        r.rev = 1;
        /* 草稿桶里的酒标迁到这个新 id 下（第一次真正保存时才搬） */
        var adopted = adoptDraftLabels(r.id);
        var fresh = U.clone(r);
        d.recipes.push(fresh);
        pushVersion(d, fresh);
        if (adopted) {
          d.meta = isPlainObj(d.meta) ? d.meta : {};
          d.meta.labelsAdopted = (d.meta.labelsAdopted || 0) + adopted;
        }
        touch();
        persistOrThrow('配方');
        BREW.Bus.emit('recipeSaved', fresh);
        return fresh;
      },

      deleteRecipe: function (id) {
        if (_reject) return refuseWrite('删除配方');
        var d = load();
        d.recipes = d.recipes.filter(function (x) { return x.id !== id; });
        /* 级联：版本与酒标都是以 recipeId 为键的衍生物，
           不删就是永久占位的孤儿（用户再也看不见它们，但它们一直占配额） */
        if (isPlainObj(d.versions) && has(d.versions, id)) delete d.versions[id];
        if (isPlainObj(d.labels) && has(d.labels, id)) delete d.labels[id];
        touch();
        BREW.Bus.emit('recipeDeleted', { id: id });
      },

      /** 别名：UI 层惯用 remove* 命名，两个都保留，避免调用方踩空 */
      removeRecipe: function (id) { return this.deleteRecipe(id); },

      /* ---------------- 批次 ---------------- */
      listBatches: function () { return load().batches; },

      getBatch: function (id) {
        var list = load().batches;
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
      },

      saveBatch: function (b) {
        if (_reject) return refuseWrite('保存批次记录');
        var d = load();
        b.updatedAt = Date.now();
        if (!b.createdAt) b.createdAt = Date.now();
        /* 批次号唯一性只能在写入边界保证：blank() 是"对象创建时"算号，
           连开两个再分别保存会拿到同一个号（D16）。交给 35 去算，
           它保证"缺失或撞号才重算，唯一则一个字不动"。 */
        if (BREW.Batch && typeof BREW.Batch.ensureBatchNo === 'function') {
          var fix = BREW.Batch.ensureBatchNo(b, d.batches);
          if (fix.changed) {
            d.meta = isPlainObj(d.meta) ? d.meta : {};
            d.meta.batchNoFixed = (d.meta.batchNoFixed || 0) + 1;
          }
        }
        /* 与 saveRecipe 同一个道理：入库独立副本。
           目前 46 每次渲染都会 normalizeBatch 出一个新对象，所以现在没踩到；
           但"调用方还拿着这个引用继续改"是迟早的事（改一条读数、切状态都会），
           那时候库里的批次会跟着变，而且同样不报错。多一次 3.6 K 的拷贝，
           换掉一整类 bug。 */
        for (var i = 0; i < d.batches.length; i++) {
          if (d.batches[i].id === b.id) {
            var storedB = U.clone(b);
            d.batches[i] = storedB;
            touch();
            persistOrThrow('批次记录');
            BREW.Bus.emit('batchSaved', storedB);
            return storedB;
          }
        }
        var freshB = U.clone(b);
        d.batches.push(freshB);
        touch();
        persistOrThrow('批次记录');
        BREW.Bus.emit('batchSaved', freshB);
        return freshB;
      },

      deleteBatch: function (id) {
        if (_reject) return refuseWrite('删除批次记录');
        var d = load();
        d.batches = d.batches.filter(function (x) { return x.id !== id; });
        touch();
        BREW.Bus.emit('batchDeleted', { id: id });
      },

      /** 别名，同 removeRecipe */
      removeBatch: function (id) { return this.deleteBatch(id); },

      /* ---------------- 自定义原料 ---------------- */
      addCustom: function (kind, item) {
        if (_reject) return refuseWrite('新增自定义原料');
        var d = load();
        if (!d.custom[kind]) d.custom[kind] = [];
        item.custom = true;
        d.custom[kind].push(item);
        touch();
        BREW.Bus.emit('customIngredientAdded', { kind: kind, item: item });
        return item;
      },

      removeCustom: function (kind, id) {
        if (_reject) return refuseWrite('删除自定义原料');
        var d = load();
        if (!d.custom[kind]) return;
        d.custom[kind] = d.custom[kind].filter(function (x) { return x.id !== id; });
        touch();
        BREW.Bus.emit('customIngredientRemoved', { kind: kind, id: id });
      },

      /* ---------------- 导入导出 ---------------- */
      exportJSON: function () {
        /* 只读状态：导出**原数据原样**（进 load() 时那串字符，一字不改）。
           为什么不能走下面的常规路径：常规路径会序列化 load() 返回的空库，
           用户以为"我备份好了"，拿到手的却是一份空文件 —— 那比不给备份更糟。
           这是只读状态下唯一的"逃生口"：升级软件之前先把新数据存到硬盘。 */
        if (_reject && typeof _reject.raw === 'string') return _reject.raw;
        var d = load();
        d.updatedAt = Date.now();
        /* 不导出 working（当前编辑中的工作副本）。
           它不是用户数据，而是"上次没关掉的编辑器状态"；带进别人的机器后，
           对方一进软件就看到"有未保存内容"，还会跟自己的配方抢编辑器。
           v2 起的顶层新键（versions/labels/…）要一起导出，这里是浅拷贝后删键，
           别写成白名单——白名单就是下一个"新字段被悄悄丢掉"的地方。 */
        var out = {}, k;
        for (k in d) if (has(d, k)) out[k] = d[k];
        delete out.working;
        return JSON.stringify(out, null, 2);
      },

      importJSON: function (text, mode) {
        /* 只读状态：直接抛给调用方（58 的导入有 catch → toast），
           而且绝不下载入/合并的那一步 —— 一旦合并进内存再"稍后落盘"，
           就成了"看起来导进来了、其实没有"的经典静默失败。 */
        if (_reject) {
          var eRO = new Error(readonlyMessage() + '（导入已取消，原数据没有被改动）');
          eRO.code = 'READONLY';
          throw eRO;
        }
        var incoming;
        try {
          incoming = JSON.parse(text);
        } catch (e) {
          throw new Error('JSON 解析失败：' + e.message);
        }
        if (!incoming || typeof incoming !== 'object') throw new Error('文件内容不是一个有效的对象');
        var d = load();

        if (mode === 'replace') {
          /* 替换导入是**唯一**会把整库丢掉的操作：`_data = migrate(incoming)`
             一行就把现有配方/批次/版本全换成文件里的。所以先留一份后悔药
             （和 restoreBackup 同一条纪律）。留不下来就别做——
             一次不可撤销的替换导入，用户点错一次就是全部数据。
             注意：这份快照是 valid 的（此刻主键还完好），
             所以它会出现在「历史备份」里，随时能恢复回来。 */
          if (_dirty) { try { flush(); } catch (e0) { /* 写不进去就备份盘上那一版 */ } }
          var snap = snapshotCurrent();
          if (!snap.ok) {
            var eSnap = new Error('没能保存「导入前」的快照（' + snap.reason +
              '），已取消替换导入。当前数据没有任何改动；请先导出到硬盘，再重试');
            eSnap.code = 'SNAPSHOT_FAILED';
            throw eSnap;
          }
          _data = migrate(incoming);
          _data.updatedAt = Date.now();
        } else {
          /* 合并导入。两条规则，别混：
           *
           * ① **「共享内容」必须逐个罗列命名空间，漏一个就丢一个。**
           *    这里不用 for..in 遍历 incoming：白名单能保证"我不认识的键不会
           *    覆盖本机数据"，代价是每加一个顶层键都得来这里补一行。
           *    已知漏过一次：v1.2 的 inventory。加新顶层键的人请回来补。
           *
           * ② **「本机行为痕迹」一律不合并。**
           *    versions / labels / userWater / shopping 描述的是"这台机器上
           *    发生过什么"（谁的第几版、我设计的酒标、我测的水质、我勾掉的
           *    采购项）。合并别人的文件时把它们盖过来，等于把别人的操作历史
           *    写进我的账本 —— 比丢数据更糟，因为它看起来是对的。
           *
           * settings 同理不合并：那是本机偏好（主题、默认批次量），
           * 导入一份别人的文件不该顺手改我的界面。
           */
          var mergeList = function (target, src, keyField) {
            var kf = keyField || 'id';
            (src || []).forEach(function (item) {
              if (!item || !item[kf]) return;
              var idx = -1;
              for (var i = 0; i < target.length; i++) {
                if (target[i][kf] === item[kf]) { idx = i; break; }
              }
              if (idx < 0) target.push(item);
              else if ((item.updatedAt || 0) > (target[idx].updatedAt || 0)) target[idx] = item;
            });
          };
          mergeList(d.recipes, incoming.recipes);
          mergeList(d.batches, incoming.batches);
          if (incoming.custom) {
            ['malts', 'hops', 'yeasts', 'adjuncts'].forEach(function (k) {
              mergeList(d.custom[k] = d.custom[k] || [], (incoming.custom || {})[k]);
            });
          }
          /* 库存：主数据按 key（'<kind>:<refId>'）去重，流水按 id 去重。
             两边都没 updatedAt 时保留本机那份（本地优先）——库存在本地是
             "我实际有几公斤"，比导入文件里的更可信。 */
          if (isPlainObj(incoming.inventory)) {
            if (!isPlainObj(d.inventory)) d.inventory = { items: [], moves: [] };
            if (!isArr(d.inventory.items)) d.inventory.items = [];
            if (!isArr(d.inventory.moves)) d.inventory.moves = [];
            mergeList(d.inventory.items, incoming.inventory.items, 'key');
            mergeList(d.inventory.moves, incoming.inventory.moves, 'id');
          }
        }
        /* 归一的是 `_data` 不是 `d`：replace 分支会把 `_data` 整个换成 incoming，
           此时 `d` 还指着旧库，对它归一等于什么都没做（第一版就踩了这个坑，
           实测发现 replace 导入的 'packaged' 仍然原样留着）。 */
        normalizeBatchStatuses(_data);
        /* 导入进来的库存可能是"只有 key"或"只有 kind+refId"的半形状，
           立刻捏一次，别让不一致活到下一次 load */
        normalizeInventory(_data);
        _dirty = true;
        /* ⚠️ 写不进去必须抛，不能笑着返回条数。
           配额满时 `flush()` 内部会吞掉 QuotaExceeded（只 emit 一个事件），
           如果这里不看返回值，界面会提示"导入完成：配方 8 份"——
           用户关掉页面，那 8 份全在内存里，蒸发。实测在真浏览器里
           把配额压满再导入，就是这个结果。 */
        var persisted = flush();
        if (!persisted) {
          throw new Error('本地存储已满，这份文件没能写进去（数据仍在内存里，' +
            '关掉页面就没了）。请先导出备份、删掉旧批次或历史版本，再重新导入');
        }
        BREW.Bus.emit('dataImported', { mode: mode || 'merge' });
        return { recipes: (_data.recipes || []).length, batches: (_data.batches || []).length };
      },

      /* ---------------- 维护 ---------------- */
      /** 立即落盘，返回是否真的写进去了（false = 配额满/不可用） */
      flushNow: function () { return flush(); },

      /** 整棵树的字符数。容量水位判断（§4.3 的 L0–L3）用它，不重复序列化 */
      estimatedChars: function () {
        /* 只读状态：内存里是空库，序列化出来只有几百字符。
            报那个数等于告诉用户"你的数据没了"——报原串长度才是真的。 */
        if (_reject) return _reject.chars;
        try {
          return JSON.stringify(load()).length;
        } catch (e) { return 0; }
      },

      /** 估算占用（KiB），用于设置页提示。
       *  口径修正：localStorage 配额按 UTF-16 计，一个字符 ≈ 2 字节；
       *  旧实现用"字符数 / 1024"当 KB，对中文内容少报一半（实测典型库
       *  95 K 字符其实占 ~186 KB）。返回 KiB，界面标注"估算"。 */
      usageKB: function () {
        if (_reject) return Math.round((_reject.chars * 2 / 1024) * 10) / 10;
        try {
          return Math.round((JSON.stringify(load()).length * 2 / 1024) * 10) / 10;
        } catch (e) { return 0; }
      },

      /** 仅供体检/测试：结构校验结果（不修改任何东西） */
      validateStructure: function (d) { return validateStructure(d === undefined ? load() : d); },

      /** 水位与版本条数阈值（只读）。
       *  导出出来是为了**别在别处再抄一遍数字**：设置页要显示"还剩多少"、
       *  test-quota 要按 L2 建树并验 3N，任何一处手抄都迟早和这里走偏。
       *  谁要调阈值就改这里，改完全库跟着动。 */
      levels: function () {
        return {
          L0: WATER_L0, L1: WATER_L1, L2: WATER_L2,
          versionsMax: VERSIONS_MAX, versionsTight: VERSIONS_TIGHT, versionsMin: VERSIONS_MIN,
          brokenKeep: BROKEN_KEEP,
          snapKeep: SNAP_KEEP, snapChars: SNAP_CHARS, quotaReserve: QUOTA_RESERVE,
          /* 实测容量（字符数）。只给界面算"用了百分之几"，不参与裁剪决策 */
          capacity: QUOTA_CHARS
        };
      },

      /** 仅供体检/测试：对一份普通对象跑迁移（不落盘、不影响内存库） */
      migrate: function (d, fromOverride) { return migrate(d, fromOverride); },

      /* ---------------- 降级保护（v1.4） ---------------- */
      /** 只读状态：null = 正常；否则 { from, current, chars, hash, at }。
       *  界面（横幅 / 设置页）和测试都用它判断，别自己去比 schemaVersion。
       *  先 load() 一次：拒绝状态是"第一次读盘"时才判出来的，
       *  不先读就会在还没人碰过 Store 的时刻返回 null（假阴性）。 */
      readonlyInfo: function () {
        try { load(); } catch (e) { /* 读盘炸了也不该让调用方崩 */ }
        if (!_reject) return null;
        return {
          from: _reject.from, current: _reject.current,
          chars: _reject.chars, hash: _reject.hash, at: _reject.at
        };
      },
      isReadonly: function () {
        try { load(); } catch (e) {}
        return !!_reject;
      },
      /** 拒绝加载的完整文案（横幅 / 设置页 / toast 共用一份，不许各写一句） */
      readonlyMessage: function () { return _reject ? readonlyMessage() : ''; },
      /** 仅供测试：任意字符串的指纹（和拒绝状态里用的是同一个函数） */
      fingerprint: function (s) { return fingerprint(s); },

      /* ---------------- 备份与恢复（v1.4） ---------------- */
      /** 历史备份列表，按时间倒序；坏备份也列出（valid:false + reason） */
      listBackups: function () { return listBackups(); },
      /** 从备份恢复。先给当前数据留快照，再写入；失败返回明确 reason */
      restoreBackup: function (key, opts) { return restoreBackup(key, opts); },
      /** 手动存一份可恢复的备份（当前主键的原始字节） */
      backupNow: function (reason) { return backupNow(reason); },
      /** 删除一份**自动备份**（损坏现场）。snap 一律 DELETE_DENIED */
      deleteBackup: function (key) { return deleteBackup(key); },
      /** 快照配额现状。界面靠它决定"说几句实话"：
       *  maxCount < keep 就说明这个大库受配额压制，只能留 maxCount 份。 */
      snapInfo: function () {
        var list = listBackups(), snaps = [], i;
        for (i = 0; i < list.length; i++) if (list[i].kind === 'snap') snaps.push(list[i]);
        var biggest = 0;
        for (i = 0; i < snaps.length; i++) if (snaps[i].chars > biggest) biggest = snaps[i].chars;
        var budget = snapBudget();
        var maxCount = biggest > 0 ? Math.floor(budget / biggest) : SNAP_KEEP;
        if (maxCount > SNAP_KEEP) maxCount = SNAP_KEEP;
        if (maxCount < 1) maxCount = 1;
        return {
          count: snaps.length, keep: SNAP_KEEP, chars: SNAP_CHARS,
          budget: budget, mainChars: mainChars(), usedChars: usedChars(),
          freeChars: freeChars(), maxCount: maxCount,
          limited: maxCount < SNAP_KEEP
        };
      },

      /** 库存余额表。**只从 moves 算**，纯读、无副作用。
       *  形状：{ malts:{ id:{qty,unit} }, hops:{…}, yeasts:{…}, adjuncts:{…} }
       *  与 33-inventory 的 Inventory.deficits() 入参同形。 */
      inventoryBalance: function () { return inventoryBalance(); },

      /* ---------------- 草稿桶（D5） ---------------- */
      /** 未保存配方的固定占位键 */
      DRAFT_KEY: DRAFT_KEY,

      /** 这份配方的衍生物（酒标）该存在哪个键下。
       *  已保存 → 真 id；未保存（工作副本）→ '__draft__'，刷新后仍是同一个键。 */
      labelKeyOf: function (recipe) { return labelKeyOf(recipe); },

      /** 把 __draft__ 名下的酒标迁到真 id 下。幂等，返回迁移条数。
       *  saveRecipe 建新配方时会自动调一次；也可以手动调。 */
      adoptDraftLabels: function (newId) { return adoptDraftLabels(newId); },

      /** 仅供体检/测试：把库存捏成唯一形状。传对象就地改并返回 inventory；
       *  不传则对当前内存库执行（不落盘） */
      normalizeInventory: function (d) { return normalizeInventory(d || load()); },

      reset: function () {
        if (_reject) return refuseWrite('恢复默认');
        _data = blankDB();
        _dirty = true;
        flush();
        BREW.Bus.emit('dataReset', {});
      }
    };

    return api;
  })();

  /* 页面关闭前强制落盘，避免节流窗口内丢数据 */
  if (root.addEventListener) {
    root.addEventListener('beforeunload', function () { BREW.Store.flushNow(); });
    root.addEventListener('visibilitychange', function () {
      if (root.document && root.document.visibilityState === 'hidden') BREW.Store.flushNow();
    });
  }

})(typeof window !== 'undefined' ? window : globalThis);
