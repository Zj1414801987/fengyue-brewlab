/* ============================================================================
 * 风月酿研所 — 30 配方模型（Recipe）
 * ----------------------------------------------------------------------------
 * 职责：配方对象的创建、校验、克隆、原料行增删，以及"按风格生成起点配方"。
 * 依赖：00-core / 05-units / 10~15 数据层
 *
 * 设计原则（很重要）：
 *   **配方必须自包含**。每一行原料都把关键参数（ppg / 色度 / α酸 / 衰减度）
 *   冗余存在配方里，而不是只存一个 id 去查库。
 *   原因：原料库会更新（某个酒花今年的 α 酸从 12% 变成 14%），
 *   但三年前那批酒的配方不能被"追溯修改"。历史必须可复现。
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  var U = BREW.Util;
  var D = BREW.Config.DEFAULTS;

  var Recipe = BREW.Recipe = {};

  /* ======================================================================
   * 一、空配方
   * ====================================================================*/
  Recipe.blank = function (opts) {
    opts = opts || {};
    var bs = opts.batchSize || D.batchSize;
    return {
      id: U.uid('r'),
      name: opts.name || '未命名配方',
      styleId: opts.styleId || null,
      author: '',
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      rev: 1,
      parentId: null,          /* 血统追溯：这个配方从哪个配方改来的 */

      /* 设备参数 */
      batchSize: bs,
      efficiency: D.efficiency,
      evaporationRate: D.evaporationRate,
      boilTime: D.boilTime,
      trubLoss: D.trubLoss,
      fermenterLoss: D.fermenterLoss,
      grainAbsorption: D.grainAbsorption,
      hopAbsorption: D.hopAbsorption,
      mashThickness: D.mashThickness,
      fermentTemp: D.fermentTemp,

      /* 原料表 */
      fermentables: [],
      hops: [],
      yeasts: [],
      adjuncts: [],

      /* 水化学 */
      water: {
        profileId: null,
        source: { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0 },
        salts: []
      },

      /* 糖化方案 */
      mash: {
        steps: [
          { name: '糖化', tempC: 66, minutes: 60 },
          { name: '出糖', tempC: 76, minutes: 10 }
        ]
      },

      /* 碳化 */
      carbonation: {
        targetVol: D.carbonationVol,
        tempC: 20,
        sugarType: 'sucrose'
      },

      /* 设计目标（用户填的"我想要什么样"，与实际计算值对照） */
      targets: { og: null, fg: null, abv: null, ibu: null, srm: null }
    };
  };

  /* ======================================================================
   * 二、克隆
   * ====================================================================*/
  Recipe.clone = function (r, newName) {
    var c = U.clone(r);
    c.id = U.uid('r');
    c.name = newName || (r.name + ' 副本');
    c.createdAt = Date.now();
    c.updatedAt = Date.now();
    c.rev = 1;
    c.parentId = r.id;          /* 记录来源，形成配方谱系 */
    return c;
  };

  /* ======================================================================
   * 二点五、谱系引用解析（v1.2，接口已冻结，Wave 3 直接用）
   * ----------------------------------------------------------------------
   * parentId 的取值域只有三种，这是 30 / 42 / 52 三处写入点共同约定的：
   *   null                  → 根节点（自己起的配方）
   *   '<recipe.id>'         → 派生自某份本地配方
   *   'classic:<classicId>' → 派生自经典配方库（52-ui-classic.js 写入）
   *
   * 为什么单独抽一个函数：谱系树要区分"这根枝有主"和"这根枝来自资料库"，
   * 而 'classic:xxx' 里带冒号，直接拿 parentId 去 recipes[] 里查永远是找不到的
   * —— 少了这一层，画出来的树会把所有经典配方的后代挂成孤儿。
   *
   * **纯函数**：不读 Store、不读 DB、不校验 id 是否真实存在（那需要 DB，
   * 由调用方按 kind 去对应集合里查）。这样 audit / Node 测试都能直接调。
   * ====================================================================*/
  var CLASSIC_PREFIX = 'classic:';

  Recipe.parentRef = function (parentId) {
    if (parentId === null || parentId === undefined || parentId === '') {
      return { kind: 'root', id: null };
    }
    var s = String(parentId);
    if (s.indexOf(CLASSIC_PREFIX) === 0) {
      var cid = s.slice(CLASSIC_PREFIX.length);
      /* 'classic:' 后面是空串属于脏数据，当根节点处理，别制造一个空 id 的节点 */
      return cid ? { kind: 'classic', id: cid } : { kind: 'root', id: null };
    }
    return { kind: 'recipe', id: s };
  };

  Recipe.CLASSIC_PREFIX = CLASSIC_PREFIX;

  /* ======================================================================
   * 三、原料行
   * ----------------------------------------------------------------------
   * 每行都从库条目"快照"关键参数。这样即使库被改了，老配方也不变。
   * ====================================================================*/

  /** 加麦芽/谷物。默认 0.5kg */
  Recipe.addFermentable = function (r, malt, kg, pctOfTotal) {
    if (!malt) return null;
    var amount = kg;

    /* 支持"按总麦芽比例"添加：给 pct 时反算 kg */
    if (pctOfTotal && amount === undefined) {
      var totalKg = U.sumBy(r.fermentables, function (f) { return f.amount; });
      if (totalKg > 0) amount = totalKg * pctOfTotal / (100 - pctOfTotal);
      else amount = 0.5;
    }

    var row = {
      id: malt.id,
      name: malt.name,
      en: malt.en || '',
      cat: malt.cat || 'base',
      origin: malt.origin || '',
      amount: U.round(amount === undefined ? 0.5 : amount, 3),
      unit: 'kg',
      ppg: U.toNum(malt.ppg, 0),
      lov: U.toNum(malt.lov, 0),
      mustMash: malt.mustMash !== false,
      fermentable: malt.fermentable || null,
      maxPct: malt.maxPct || null,
      dp: malt.dp || null,
      custom: !!malt.custom
    };
    r.fermentables.push(row);
    return row;
  };

  /** 加酒花。默认 20g，α酸取库值 */
  Recipe.addHop = function (r, hop, grams, stage, minutes) {
    if (!hop) return null;
    var row = {
      id: hop.id,
      name: hop.name,
      en: hop.en || '',
      amount: U.round(grams === undefined ? 20 : grams, 1),
      unit: 'g',
      aa: U.toNum(hop.aa, 0),
      aaMin: hop.aaMin || null,
      aaMax: hop.aaMax || null,
      stage: stage || 'boil',
      time: minutes === undefined ? 60 : minutes,
      whirlpoolTemp: null,
      custom: !!hop.custom
    };
    r.hops.push(row);
    return row;
  };

  /** 加酵母 */
  Recipe.addYeast = function (r, yeast, grams) {
    if (!yeast) return null;
    var row = {
      id: yeast.id,
      name: yeast.name,
      en: yeast.en || '',
      lab: yeast.lab || '',
      amount: U.round(grams === undefined ? 11 : grams, 1),
      unit: 'g',
      att: U.toNum(yeast.att, 75),
      type: yeast.type || 'ale',
      tempMin: yeast.tempMin || null,
      tempMax: yeast.tempMax || null,
      floc: yeast.floc || null,
      custom: !!yeast.custom
    };
    r.yeasts.push(row);
    return row;
  };

  /** 加辅料 */
  Recipe.addAdjunct = function (r, adj, amount) {
    if (!adj) return null;
    var row = {
      id: adj.id,
      name: adj.name,
      en: adj.en || '',
      cat: adj.cat || 'other',
      amount: U.round(amount === undefined ? (adj.useMin || 10) : amount, 1),
      unit: adj.unit || 'g',
      stage: adj.stage || 'boil',
      extraSugarPct: adj.extraSugarPct || 0,
      custom: !!adj.custom
    };
    r.adjuncts.push(row);
    return row;
  };

  /** 删除某类原料中的某行 */
  Recipe.removeRow = function (r, kind, index) {
    var map = { fermentables: 'fermentables', hops: 'hops', yeasts: 'yeasts', adjuncts: 'adjuncts' };
    var key = map[kind];
    if (!key || !r[key]) return false;
    if (index < 0 || index >= r[key].length) return false;
    r[key].splice(index, 1);
    return true;
  };

  /* ======================================================================
   * 四、校验
   * ====================================================================*/
  Recipe.validate = function (r) {
    var errs = [], warns = [];

    if (!r.name || !String(r.name).trim()) errs.push('配方需要一个名字');

    var bs = U.toNum(r.batchSize, 0);
    if (bs <= 0) errs.push('批次量必须大于 0');
    if (bs < 5 || bs > 60) warns.push('批次量 ' + bs + 'L 超出家酿常见范围（5–60L）');

    if (!r.fermentables || r.fermentables.length === 0) {
      errs.push('至少需要一种麦芽或谷物');
    } else {
      var total = U.sumBy(r.fermentables, function (f) { return U.toNum(f.amount, 0); });
      if (total <= 0) errs.push('麦芽总重量为 0');

      /* 必须有能提供酶的基础麦芽 */
      var hasEnzyme = r.fermentables.some(function (f) {
        return f.mustMash && (f.cat === 'base' || f.dp === 'high' || f.dp === 'veryhigh') &&
               U.toNum(f.amount, 0) > 0;
      });
      var hasUnmalted = r.fermentables.some(function (f) {
        return f.mustMash && f.dp === 'none' && U.toNum(f.amount, 0) > 0;
      });
      if (hasUnmalted && !hasEnzyme) {
        errs.push('配方含未发芽谷物但没有能提供酶的基础麦芽，糖化无法进行');
      }

      /* 单行用量为 0 */
      r.fermentables.forEach(function (f, i) {
        if (U.toNum(f.amount, 0) <= 0) warns.push('第 ' + (i + 1) + ' 行麦芽（' + f.name + '）用量为 0');
        if (U.toNum(f.ppg, 0) <= 0) errs.push(f.name + ' 的 ppg 为 0，无法计算');
      });
    }

    if (!r.yeasts || r.yeasts.length === 0) {
      warns.push('还没有选酵母，FG 与酒精度无法预测');
    } else {
      r.yeasts.forEach(function (y) {
        var a = U.toNum(y.att, 0);
        if (a <= 0) warns.push(y.name + ' 的衰减度为 0');
        if (a > 100) errs.push(y.name + ' 的衰减度不能超过 100%');
      });
    }

    if (r.hops) {
      r.hops.forEach(function (h) {
        if (U.toNum(h.amount, 0) > 0 && U.toNum(h.aa, 0) <= 0) {
          warns.push(h.name + ' 未填 α 酸，IBU 会算成 0');
        }
      });
    }

    if (U.toNum(r.efficiency, 0) <= 0) errs.push('糖化效率必须大于 0');

    return { ok: errs.length === 0, errors: errs, warnings: warns };
  };

  /* ======================================================================
   * 五、按风格生成起点配方（离线规则引擎）
   * ----------------------------------------------------------------------
   * 这不是"AI"，是一套明确的酿造学规则：
   *   1. 取风格区间的中值作为目标
   *   2. 按风格大类选麦芽构成模板（这是各风格的行业惯例）
   *   3. 按 IBU 目标反算苦花用量，按惯例分配后段与干投
   *   4. 按风格类型选酵母
   *   5. 按风格匹配水质建议
   *
   * 输出的是"可以拿去酿第一版的起点"，不是"完美配方"。
   * 用户必须在自己的设备上跑一次，用实测效率回调。
   * ====================================================================*/

  /* 麦芽构成模板：以"占麦芽总重百分比"描述 */
  var GRAIN_TEMPLATES = {
    /* 拉格系 */
    lager: [
      { id: 'm-pilsner', pct: 92 },
      { id: 'm-munich', pct: 8 }
    ],
    'lager-dark': [
      { id: 'm-munich', pct: 75 },
      { id: 'm-pilsner', pct: 15 },
      { id: 'm-c40', pct: 6 },
      { id: 'm-chocolate', pct: 4 }
    ],
    /* 德式小麦 */
    wheat: [
      { id: 'm-wheat', pct: 58 },
      { id: 'm-pilsner', pct: 42 }
    ],
    'wheat-dark': [
      { id: 'm-wheat', pct: 55 },
      { id: 'm-munich-dark', pct: 35 },
      { id: 'm-c40', pct: 10 }
    ],
    /* 英式 */
    british: [
      { id: 'm-marisotter', pct: 90 },
      { id: 'm-c60', pct: 8 },
      { id: 'm-chocolate', pct: 2 }
    ],
    'british-dark': [
      { id: 'm-marisotter', pct: 78 },
      { id: 'm-c80', pct: 10 },
      { id: 'm-chocolate', pct: 7 },
      { id: 'm-roastedbarley', pct: 5 }
    ],
    /* 美式 */
    american: [
      { id: 'm-2row', pct: 88 },
      { id: 'm-munich', pct: 7 },
      { id: 'm-c40', pct: 5 }
    ],
    'american-dark': [
      { id: 'm-2row', pct: 78 },
      { id: 'm-c60', pct: 9 },
      { id: 'm-chocolate', pct: 7 },
      { id: 'm-roastedbarley', pct: 6 }
    ],
    /* 帝国世涛：浓度越高，深色麦芽的绝对量越大，色度会冲爆区间。
       所以专门降比例 + 加 2% 糖提干（否则 FG 也会超标）。 */
    'imperial-dark': [
      { id: 'm-2row', pct: 74 },
      { id: 'm-munich', pct: 10 },
      { id: 'm-c60', pct: 6 },
      { id: 'm-chocolate', pct: 5 },
      { id: 'm-roastedbarley', pct: 3 },
      { id: 'm-dextrose', pct: 2 }
    ],
    'american-ipa': [
      { id: 'm-2row', pct: 90 },
      { id: 'm-munich', pct: 7 },
      { id: 'm-c40', pct: 3 }
    ],
    /* 比利时 */
    belgian: [
      { id: 'm-pilsner', pct: 85 },
      { id: 'm-aromatic', pct: 8 },
      { id: 'm-dextrose', pct: 7 }
    ],
    'belgian-dark': [
      { id: 'm-pilsner', pct: 72 },
      { id: 'm-munich', pct: 12 },
      { id: 'm-specialb', pct: 6 },
      { id: 'm-candid180', pct: 10 }
    ],
    /* 深色重口 */
    stout: [
      { id: 'm-marisotter', pct: 74 },
      { id: 'm-flakedoats', pct: 10 },
      { id: 'm-c80', pct: 6 },
      { id: 'm-chocolate', pct: 6 },
      { id: 'm-roastedbarley', pct: 4 }
    ],
    /* 酸啤 */
    sour: [
      { id: 'm-pilsner', pct: 55 },
      { id: 'm-wheat', pct: 45 }
    ]
  };

  /* 风格 id → 模板 + 酵母类型 + 水质目标 */
  var STYLE_RULES = {
    '1A': { grain: 'lager',        yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '1B': { grain: 'lager',        yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '1C': { grain: 'american',     yeast: 'ale',     hops: 'noble',    water: 'wt-pils' },
    '1D': { grain: 'wheat',        yeast: 'ale',     hops: 'citrus',   water: 'wt-wheat' },
    '2A': { grain: 'lager',        yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '2B': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '2C': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-stout' },
    '3A': { grain: 'lager',        yeast: 'lager',   hops: 'saaz',     water: 'wt-pils' },
    '3B': { grain: 'lager',        yeast: 'lager',   hops: 'saaz',     water: 'wt-pils' },
    '3C': { grain: 'lager-dark',   yeast: 'lager',   hops: 'saaz',     water: 'wt-pils' },
    '3D': { grain: 'lager-dark',   yeast: 'lager',   hops: 'saaz',     water: 'wt-stout' },
    '4A': { grain: 'lager',        yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '4B': { grain: 'lager',        yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '4C': { grain: 'lager',        yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '5A': { grain: 'lager',        yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '5B': { grain: 'lager',        yeast: 'ale',     hops: 'noble',    water: 'wt-pils' },
    '5C': { grain: 'lager',        yeast: 'lager',   hops: 'noble',    water: 'wt-english' },
    '5D': { grain: 'lager',        yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '6A': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '6B': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-pils', smoke: true },
    '6C': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-stout' },
    '7A': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '7B': { grain: 'lager-dark',   yeast: 'ale',     hops: 'noble',    water: 'wt-english' },
    '8A': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-stout' },
    '8B': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-stout' },
    '9A': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-stout' },
    '9B': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-stout' },
    '9C': { grain: 'lager-dark',   yeast: 'lager',   hops: 'noble',    water: 'wt-stout' },
    '10A': { grain: 'wheat',       yeast: 'wheat',   hops: 'noble',    water: 'wt-wheat' },
    '10B': { grain: 'wheat-dark',  yeast: 'wheat',   hops: 'noble',    water: 'wt-wheat' },
    '10C': { grain: 'wheat',       yeast: 'wheat',   hops: 'noble',    water: 'wt-wheat' },
    '11A': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '11B': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '11C': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '12A': { grain: 'british',     yeast: 'ale',     hops: 'citrus',   water: 'wt-english' },
    '12B': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '12C': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-ipa' },
    '13A': { grain: 'british-dark', yeast: 'ale',    hops: 'english',  water: 'wt-english' },
    '13B': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '13C': { grain: 'british-dark', yeast: 'ale',    hops: 'english',  water: 'wt-stout' },
    '14A': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '14B': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '14C': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '15A': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '15B': { grain: 'british-dark', yeast: 'ale',    hops: 'english',  water: 'wt-stout' },
    '15C': { grain: 'british-dark', yeast: 'ale',    hops: 'english',  water: 'wt-stout' },
    '16A': { grain: 'stout',       yeast: 'ale',     hops: 'english',  water: 'wt-stout' },
    '16B': { grain: 'stout',       yeast: 'ale',     hops: 'english',  water: 'wt-stout' },
    '16C': { grain: 'stout',       yeast: 'ale',     hops: 'english',  water: 'wt-stout' },
    '16D': { grain: 'stout',       yeast: 'ale',     hops: 'english',  water: 'wt-stout' },
    '17A': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '17B': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '17C': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '17D': { grain: 'british',     yeast: 'ale',     hops: 'english',  water: 'wt-english' },
    '18A': { grain: 'american',    yeast: 'ale',     hops: 'citrus',   water: 'wt-pils' },
    '18B': { grain: 'american',    yeast: 'ale',     hops: 'citrus',   water: 'wt-ipa' },
    '19A': { grain: 'american',    yeast: 'ale',     hops: 'citrus',   water: 'wt-ipa' },
    '19B': { grain: 'american',    yeast: 'lager',   hops: 'noble',    water: 'wt-pils' },
    '19C': { grain: 'american-dark', yeast: 'ale',   hops: 'citrus',   water: 'wt-stout' },
    '20A': { grain: 'american-dark', yeast: 'ale',   hops: 'citrus',   water: 'wt-stout' },
    '20B': { grain: 'american-dark', yeast: 'ale',   hops: 'citrus',   water: 'wt-stout' },
    '20C': { grain: 'imperial-dark', yeast: 'ale',   hops: 'citrus',   water: 'wt-stout' },
    '21A': { grain: 'american-ipa', yeast: 'ale',    hops: 'citrus',   water: 'wt-ipa' },
    /* 2021 编号迁移（v1.5）：21C = 浑浊 IPA；22A 双料 IPA / 22B 烈性艾尔 /
       22C 大麦酒 / 22D 小麦酒。旧 id '21B-NEIPA' 已由 21C 接手，
       下面这几行的**数值规则**没动，只是键名跟着风格编号一起挪。 */
    '21C': { grain: 'american-ipa', yeast: 'ale', hops: 'citrus', water: 'wt-neipa' },
    '21B-Black': { grain: 'american-dark', yeast: 'ale', hops: 'citrus', water: 'wt-ipa' },
    '21B-Rye': { grain: 'american-ipa', yeast: 'ale', hops: 'citrus',   water: 'wt-ipa' },
    '22A': { grain: 'american-ipa', yeast: 'ale',    hops: 'citrus',   water: 'wt-ipa' },
    '22B': { grain: 'american',    yeast: 'ale',     hops: 'citrus',   water: 'wt-ipa' },
    '22C': { grain: 'american',    yeast: 'ale',     hops: 'citrus',   water: 'wt-ipa' },
    '22D': { grain: 'wheat',       yeast: 'ale',     hops: 'citrus',   water: 'wt-wheat' },
    '23A': { grain: 'sour',        yeast: 'sour',    hops: 'noble',    water: 'wt-pils' },
    '23B': { grain: 'belgian-dark', yeast: 'belgian', hops: 'noble',   water: 'wt-belgian' },
    '23C': { grain: 'belgian-dark', yeast: 'belgian', hops: 'noble',   water: 'wt-belgian' },
    '23D': { grain: 'sour',        yeast: 'brett',   hops: 'noble',    water: 'wt-pils' },
    '23E': { grain: 'sour',        yeast: 'brett',   hops: 'noble',    water: 'wt-pils' },
    '23G': { grain: 'sour',        yeast: 'sour',    hops: 'noble',    water: 'wt-pils' },
    '24A': { grain: 'wheat',       yeast: 'belgian', hops: 'noble',    water: 'wt-wheat', spice: true },
    '24B': { grain: 'belgian',     yeast: 'belgian', hops: 'noble',    water: 'wt-belgian' },
    '24C': { grain: 'belgian',     yeast: 'belgian', hops: 'noble',    water: 'wt-belgian' },
    '25A': { grain: 'belgian',     yeast: 'belgian', hops: 'noble',    water: 'wt-belgian' },
    '25B': { grain: 'belgian',     yeast: 'belgian', hops: 'noble',    water: 'wt-saison' },
    '25C': { grain: 'belgian',     yeast: 'belgian', hops: 'noble',    water: 'wt-belgian' },
    '26A': { grain: 'belgian',     yeast: 'belgian', hops: 'noble',    water: 'wt-belgian' },
    '26B': { grain: 'belgian-dark', yeast: 'belgian', hops: 'noble',   water: 'wt-belgian' },
    '26C': { grain: 'belgian',     yeast: 'belgian', hops: 'noble',    water: 'wt-belgian' },
    '26D': { grain: 'belgian-dark', yeast: 'belgian', hops: 'noble',   water: 'wt-belgian' },
    '28A': { grain: 'american',    yeast: 'brett',   hops: 'citrus',   water: 'wt-ipa' },
    '29A': { grain: 'american',    yeast: 'ale',     hops: 'citrus',   water: 'wt-pils' },
    '30A': { grain: 'american',    yeast: 'ale',     hops: 'noble',    water: 'wt-pils' },
    '33A': { grain: 'american-dark', yeast: 'ale',   hops: 'citrus',   water: 'wt-stout' }
  };

  /* 酒花方案：按 IBU 目标分配。bitter 主苦，flavor 风味，aroma 回旋，dry 干投 */
  var HOP_PLANS = {
    noble:   { bitter: 1.00, flavor: 0,    aroma: 0,    dry: 0,    bitterHop: 'h-hallertau', flavorHop: 'h-hallertau', aromaHop: 'h-hallertau' },
    saaz:    { bitter: 0.70, flavor: 0.20, aroma: 0.10, dry: 0,    bitterHop: 'h-saaz', flavorHop: 'h-saaz', aromaHop: 'h-saaz' },
    english: { bitter: 0.80, flavor: 0.15, aroma: 0.05, dry: 0,    bitterHop: 'h-ekg', flavorHop: 'h-ekg', aromaHop: 'h-ekg' },
    citrus:  { bitter: 0.45, flavor: 0.10, aroma: 0.20, dry: 0.25, bitterHop: 'h-magnum-de', flavorHop: 'h-citra', aromaHop: 'h-citra', dryHop: 'h-citra' }
  };

  /* 风格 → 推荐酵母 */
  var YEAST_BY_TYPE = {
    lager:   ['y-w3470', 'y-s189'],
    ale:     ['y-us05', 'y-s04'],
    wheat:   ['y-wb06', 'y-munich'],
    belgian: ['y-abbaye', 'y-belle-saison'],
    sour:    ['y-phillysour'],
    brett:   ['y-wlp644']
  };

  /** 在库里按 id 找条目，找不到返回 null */
  function findIn(dbArr, id) {
    if (!dbArr) return null;
    for (var i = 0; i < dbArr.length; i++) if (dbArr[i].id === id) return dbArr[i];
    return null;
  }

  /**
   * 按风格生成起点配方
   * @param {string} styleId
   * @param {object} opts {batchSize, efficiency}
   * @returns {object} 配方对象
   */
  Recipe.fromStyle = function (styleId, opts) {
    opts = opts || {};
    var style = BREW.DB.getStyle ? BREW.DB.getStyle(styleId) : null;
    if (!style) return null;

    var bs = U.toNum(opts.batchSize, D.batchSize);
    var eff = U.toNum(opts.efficiency, D.efficiency);
    var rule = STYLE_RULES[styleId] || { grain: 'american', yeast: 'ale', hops: 'citrus' };

    var r = Recipe.blank({ name: style.name + '（自动生成起点）', styleId: styleId, batchSize: bs });
    r.efficiency = eff;
    r.author = '风月酿研所 规则引擎';

    /* ---------- 1. 目标 OG：取区间中值 ---------- */
    var targetOg = (style.og[0] + style.og[1]) / 2;
    var targetPts = (targetOg - 1) * 1000;

    /* 反算需要的麦芽总量：pts = Σ(ppg × kg × 8.3454 × eff) / bs
       用加权平均 ppg 估算，先取 36 作为典型值再迭代一次 */
    var template = GRAIN_TEMPLATES[rule.grain] || GRAIN_TEMPLATES.american;

    /* 模板里有糖（如葡萄糖/糖浆）时，糖不参与糖化，效率按 100% */
    var weightedPpg = 0, weightedEff = 0, totalPct = 0;
    template.forEach(function (t) {
      var m = findIn(BREW.DB.malts, t.id);
      if (!m) return;
      var isSugar = (m.cat === 'sugar' || m.cat === 'extract');
      weightedPpg += m.ppg * t.pct;
      weightedEff += (isSugar ? 1 : eff / 100) * t.pct;
      totalPct += t.pct;
    });
    if (totalPct <= 0) return r;
    weightedPpg /= totalPct;
    weightedEff /= totalPct;

    /* kg = pts × bs / (ppg × 8.3454 × effFactor) */
    var totalKg = targetPts * bs / (weightedPpg * 8.3454 * weightedEff);
    totalKg = U.round(U.clamp(totalKg, 2, 14), 2);

    /* ---------- 2. 按模板分配麦芽 ---------- */
    var leftover = totalKg;
    template.forEach(function (t, i) {
      var m = findIn(BREW.DB.malts, t.id);
      if (!m) return;
      var kg = (i === template.length - 1)
        ? leftover                                    /* 最后一项吃掉余量，避免四舍五入误差 */
        : U.round(totalKg * t.pct / 100, 2);
      kg = Math.max(0.02, kg);
      leftover = U.round(leftover - kg, 2);
      if (kg > 0.02) Recipe.addFermentable(r, m, kg);
    });

    /* ---------- 3. 酒花：按 IBU 目标反算 ---------- */
    var targetIbu = (style.ibu[0] + style.ibu[1]) / 2;
    var plan = HOP_PLANS[rule.hops] || HOP_PLANS.citrus;

    /* 先算一次"当前配方在 60 分钟投 100g 苦花时的 IBU"，得到单位换算系数 */
    var probe = U.clone(r);
    probe.hops = [];
    var probeHop = findIn(BREW.DB.hops, plan.bitterHop) || BREW.DB.hops[0];
    Recipe.addHop(probe, probeHop, 100, 'boil', 60);
    var probeResult = BREW.Calc.calcRecipe(probe);
    var ibuPer100g = probeResult.ibuTinseth;

    if (ibuPer100g > 0.5) {
      /* 苦花用量 = 目标IBU × 苦花份额 / 单位IBU */
      var bitterGrams = targetIbu * plan.bitter / ibuPer100g * 100;
      bitterGrams = U.clamp(bitterGrams, 3, 120);

      if (plan.bitter > 0 && bitterGrams >= 3) {
        Recipe.addHop(r, probeHop, U.round(bitterGrams, 0), 'boil', 60);
      }

      /* 风味花：15 分钟，利用率约为 60 分钟的 1/3，所以同样 IBU 需要约 3 倍重量 */
      if (plan.flavor > 0) {
        var flavorHop = findIn(BREW.DB.hops, plan.flavorHop) || probeHop;
        var fGrams = targetIbu * plan.flavor / ibuPer100g * 100 * 3;
        if (fGrams >= 3) {
          Recipe.addHop(r, flavorHop, U.round(U.clamp(fGrams, 3, 150), 0), 'boil', 15);
        }
      }

      /* 回旋花：按时间 20 分钟、85°C，等效利用率低，按 5 倍换算 */
      if (plan.aroma > 0) {
        var aromaHop = findIn(BREW.DB.hops, plan.aromaHop) || probeHop;
        var aGrams = targetIbu * plan.aroma / ibuPer100g * 100 * 5;
        if (aGrams >= 3) {
          var h = Recipe.addHop(r, aromaHop, U.round(U.clamp(aGrams, 3, 150), 0), 'whirlpool', 20);
          h.whirlpoolTemp = 85;
        }
      }

      /* 干投：不贡献 IBU，按风格给一个合理量（g/L） */
      if (plan.dry > 0) {
        var dryHop = findIn(BREW.DB.hops, plan.dryHop || plan.aromaHop) || probeHop;
        /* 2021 编号：21C 是浑浊 IPA（干投重），22A 是双料 IPA。旧写法里
           三者都挤在 '21B-NEIPA' / '21C' 上，迁移时必须一起改，
           否则浑浊 IPA 会掉进"5 g/L"档、干投量直接砍半。 */
        var gPerL = styleId === '21C' ? 8 : (styleId === '21A' || styleId === '22A' ? 5 : 2);
        Recipe.addHop(r, dryHop, U.round(gPerL * bs, 0), 'dryhop', 0);
      }
    }

    /* ---------- 4. 酵母 ---------- */
    var yList = YEAST_BY_TYPE[rule.yeast] || YEAST_BY_TYPE.ale;
    var yeast = findIn(BREW.DB.yeasts, yList[0]);
    if (yeast) {
      var pitch = BREW.Calc.pitch(r, { ogPlato: BREW.Units.sgToPlato(targetOg) });
      Recipe.addYeast(r, yeast, U.round(pitch.dryGrams, 0));
    }

    /* ---------- 5. 辅料（白啤的橙皮芫荽、烟熏的烟熏麦芽） ---------- */
    if (rule.spice) {
      var cori = findIn(BREW.DB.adjuncts, 'a-coriander');
      var peel = findIn(BREW.DB.adjuncts, 'a-orangepeel');
      if (cori) Recipe.addAdjunct(r, cori, 10);
      if (peel) Recipe.addAdjunct(r, peel, 20);
    }
    if (rule.smoke) {
      var smoke = findIn(BREW.DB.malts, 'm-munich');
      if (smoke) {
        /* 烟熏风格：用烟熏麦芽替代部分基麦（此处用慕尼黑近似，实际应换烟熏麦芽） */
        r.notes = '本风格需要烟熏麦芽（Rauchmalz），请把部分基麦替换为烟熏麦芽（20-60%）。' +
                  '原料库里没有烟熏麦芽条目，需自行在"原料库"里添加。';
      }
    }

    /* ---------- 6. 水质 ---------- */
    if (rule.water) {
      var wp = findIn(BREW.DB.waterProfiles, 'wp-ro');
      if (wp) {
        r.water.profileId = 'wp-ro';
        r.water.source = { ca: wp.ca, mg: wp.mg, na: wp.na, cl: wp.cl, so4: wp.so4, hco3: wp.hco3 };
      }
      /* 按目标水型加盐：算出达到区间中值所需的石膏/氯化钙 */
      var wt = null, wts = BREW.DB.waterTargets || [];
      for (var i = 0; i < wts.length; i++) {
        if (wts[i].id === rule.water) { wt = wts[i]; break; }
      }
      if (wt) {
        var targetSo4 = (wt.so4[0] + wt.so4[1]) / 2;
        var targetCl = (wt.cl[0] + wt.cl[1]) / 2;
        /* 石膏每克每 20L 贡献 27.9 SO4；氯化钙每克贡献 24.1 Cl */
        var gypsumG = targetSo4 / 27.90 * (bs / 20);
        var caclG = targetCl / 24.10 * (bs / 20);
        if (gypsumG >= 0.5) r.water.salts.push({ id: 'w-gypsum', amount: U.round(gypsumG, 1) });
        if (caclG >= 0.5) r.water.salts.push({ id: 'w-cacl2', amount: U.round(caclG, 1) });
      }
    }

    /* ---------- 7. 糖化方案：按风格给温度 ---------- */
    var mashTemp = 66;
    if (styleId === '25B' || styleId === '23A' || styleId === '3B') mashTemp = 63;  /* 干爽型 */
    else if (style.og[0] > 1.070) mashTemp = 65;
    else if (styleId === '16A' || styleId === '20C') mashTemp = 68;                  /* 需要残糖 */
    r.mash.steps = [
      { name: '糖化', tempC: mashTemp, minutes: 60 },
      { name: '出糖', tempC: 76, minutes: 10 }
    ];
    r.fermentTemp = yeast ? U.round((yeast.tempMin + yeast.tempMax) / 2, 0) : 20;

    /* ---------- 8. 碳化目标：按风格给 ---------- */
    var carbVol = 2.4;
    if (styleId.indexOf('10') === 0 || styleId === '24A') carbVol = 3.0;   /* 小麦类高碳酸 */
    else if (styleId === '25B' || styleId === '25C') carbVol = 3.2;        /* 赛松/比利时金色 */
    else if (styleId.indexOf('11') === 0 || styleId.indexOf('13') === 0) carbVol = 1.9;  /* 英式低碳酸 */
    else if (styleId === '23A') carbVol = 3.4;
    r.carbonation.targetVol = carbVol;

    /* ---------- 9. 计算目标值，写进 targets 供对照 ---------- */
    var res = BREW.Calc.calcRecipe(r);
    r.targets = {
      og: U.round(res.og, 3),
      fg: U.round(res.fg, 3),
      abv: U.round(res.abv, 1),
      ibu: U.round(res.ibu, 0),
      srm: U.round(res.srm, 1)
    };

    r.notes = (r.notes ? r.notes + '\n\n' : '') +
      '这是按 BJCP ' + style.id + ' ' + style.name + ' 的区间中值与行业惯例生成的**起点配方**。\n' +
      '生成依据：麦芽构成模板 + IBU 反算 + 酵母类型匹配 + 水质区间。\n' +
      '**第一版务必按你自己的糖化效率（而不是 72%）重算，并按实测结果回调。**';

    return r;
  };

  /* ======================================================================
   * 六、预设配方（打开就能看到"能酿的东西"）
   * ====================================================================*/
  Recipe.presets = function () {
    var out = [];

    /* ---- 1. 西海岸 IPA ---- */
    (function () {
      var r = Recipe.blank({ name: '西海岸 IPA · 柑橘炸弹', styleId: '21A' });
      r.author = '风月酿研所 示例';
      r.notes = '20L 批次的经典西海岸 IPA。主苦用马格努姆（干净不粗粝），' +
                '香气全部来自回旋与双倍干投。水质偏硫酸盐，让苦味更"脆"。';
      r.efficiency = 72; r.fermentTemp = 19;
      r.mash.steps = [{ name: '糖化', tempC: 65, minutes: 60 }, { name: '出糖', tempC: 76, minutes: 10 }];
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-2row'), 5.0);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-munich'), 0.5);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-c40'), 0.25);
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-magnum-de'), 32, 'boil', 60);
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-centennial'), 20, 'boil', 15);
      var h1 = Recipe.addHop(r, findIn(BREW.DB.hops, 'h-citra'), 30, 'whirlpool', 20);
      if (h1) h1.whirlpoolTemp = 85;
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-citra'), 60, 'dryhop', 0);
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-mosaic'), 40, 'dryhop', 0);
      Recipe.addYeast(r, findIn(BREW.DB.yeasts, 'y-us05'), 13);
      r.water.source = { ca: 40, mg: 8, na: 30, cl: 35, so4: 40, hco3: 90 };
      r.water.salts = [{ id: 'w-gypsum', amount: 5 }, { id: 'w-cacl2', amount: 1.5 }];
      r.carbonation.targetVol = 2.5;
      out.push(r);
    })();

    /* ---- 2. 德式小麦 ---- */
    (function () {
      var r = Recipe.blank({ name: '巴伐利亚小麦 · 香蕉与丁香', styleId: '10A' });
      r.author = '风月酿研所 示例';
      r.notes = 'WB-06 在 20°C 发酵，香蕉（乙酸异戊酯）与丁香（4-乙烯基愈创木酚）最平衡。' +
                '**不要为了"清澈"而过滤或冷降过度**——浑浊是风格的一部分。';
      r.efficiency = 72; r.fermentTemp = 20;
      r.mash.steps = [{ name: '蛋白质休止', tempC: 45, minutes: 15 },
                      { name: '糖化', tempC: 66, minutes: 60 },
                      { name: '出糖', tempC: 76, minutes: 10 }];
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-wheat'), 2.5);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-pilsner'), 1.8);
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-hallertau'), 30, 'boil', 60);
      /* WB-06 标称 86-90%，但德式小麦常用 66-68°C 糖化，实际衰减度落在 82-84%。
         这个覆盖比"改库里的酵母参数"更正确：变的是工艺，不是酵母。 */
      var wy = Recipe.addYeast(r, findIn(BREW.DB.yeasts, 'y-wb06'), 12);
      if (wy) wy.att = 83;
      r.carbonation.targetVol = 3.2;
      out.push(r);
    })();

    /* ---- 3. 赛松 ---- */
    (function () {
      var r = Recipe.blank({ name: '农舍赛松 · 胡椒与干爽', styleId: '25B' });
      r.author = '风月酿研所 示例';
      r.notes = 'BE-134 衰减度 89-93%，FG 会低到 1.004 以下。' +
                '发酵前期可以放任升温到 26-28°C 获取复杂度。**FG 低是这个风格的生命线**。';
      r.efficiency = 72; r.fermentTemp = 24;
      r.mash.steps = [{ name: '糖化', tempC: 63, minutes: 75 }, { name: '出糖', tempC: 76, minutes: 10 }];
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-pilsner'), 4.0);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-wheat'), 0.5);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-vienna'), 0.3);
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-ekg'), 20, 'boil', 60);
      var h = Recipe.addHop(r, findIn(BREW.DB.hops, 'h-saaz'), 30, 'whirlpool', 20);
      if (h) h.whirlpoolTemp = 85;
      Recipe.addYeast(r, findIn(BREW.DB.yeasts, 'y-be134'), 12);
      Recipe.addAdjunct(r, findIn(BREW.DB.adjuncts, 'a-blackpepper'), 3);
      r.carbonation.targetVol = 3.2;
      out.push(r);
    })();

    /* ---- 4. 牛奶世涛 ---- */
    (function () {
      var r = Recipe.blank({ name: '牛奶世涛 · 巧克力与咖啡', styleId: '16A' });
      r.author = '风月酿研所 示例';
      r.notes = '乳糖 0.5kg 在煮沸最后 10 分钟加入（不参与糖化、不可发酵）。' +
                '它提供甜味与酒体，所以苦味必须够，否则会像巧克力奶。';
      r.efficiency = 72; r.fermentTemp = 19;
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-marisotter'), 3.2);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-flakedoats'), 0.5);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-chocolate'), 0.35);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-c80'), 0.25);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-roastedbarley'), 0.25);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-lactose'), 0.45);
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-ekg'), 40, 'boil', 60);
      Recipe.addYeast(r, findIn(BREW.DB.yeasts, 'y-s04'), 12);
      r.carbonation.targetVol = 2.0;   /* 世涛低碳酸 */
      out.push(r);
    })();

    /* ---- 5. 捷克皮尔森 ---- */
    (function () {
      var r = Recipe.blank({ name: '波西米亚皮尔森 · 萨兹三重奏', styleId: '3B' });
      r.author = '风月酿研所 示例';
      r.notes = '三次萨兹添加（60/20/回旋），苦味圆润绵长。' +
                '**水的碱度必须低**，否则颜色发深、酒花发闷。用 RO 水或乳酸降碱。' +
                '拉格酵母 12°C 发酵，双乙酰还原期要够（升温到 16-18°C 两天）。';
      r.efficiency = 70; r.fermentTemp = 12;
      r.mash.steps = [{ name: '糖化', tempC: 65, minutes: 60 },
                      { name: '出糖', tempC: 76, minutes: 10 }];
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-pilsner'), 4.4);
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-saaz'), 60, 'boil', 60);
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-saaz'), 30, 'boil', 20);
      var h = Recipe.addHop(r, findIn(BREW.DB.hops, 'h-saaz'), 30, 'whirlpool', 20);
      if (h) h.whirlpoolTemp = 85;
      var y = Recipe.addYeast(r, findIn(BREW.DB.yeasts, 'y-w3470'), 22);
      if (y) y.att = 80;    /* 糖化 65°C 时实际衰减度略低于酵母标称值 */
      r.water.profileId = 'wp-pilsen';
      r.water.source = { ca: 7, mg: 2, na: 2, cl: 4, so4: 5, hco3: 15 };
      r.carbonation.targetVol = 2.5;
      out.push(r);
    })();

    /* ---- 6. NEIPA ---- */
    (function () {
      var r = Recipe.blank({ name: '浑浊 IPA · 果汁感', styleId: '21C' });
      r.author = '风月酿研所 示例';
      r.notes = '**几乎不煮沸投花**，苦味全靠回旋与少量 15 分钟添加。' +
                '水质高氯低硫（SO4:Cl < 1）让酒体圆润如果汁。' +
                '干投 8g/L 是这类酒的常态。氧化是最大敌人——装瓶时尽量少接触空气。';
      r.efficiency = 72; r.fermentTemp = 19;
      r.mash.steps = [{ name: '糖化', tempC: 67, minutes: 60 }, { name: '出糖', tempC: 76, minutes: 10 }];
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-2row'), 4.8);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-flakedoats'), 0.9);
      Recipe.addFermentable(r, findIn(BREW.DB.malts, 'm-wheat'), 0.6);
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-columbus'), 12, 'boil', 60);
      var h1 = Recipe.addHop(r, findIn(BREW.DB.hops, 'h-citra'), 40, 'whirlpool', 20);
      if (h1) h1.whirlpoolTemp = 80;
      var h2 = Recipe.addHop(r, findIn(BREW.DB.hops, 'h-mosaic'), 40, 'whirlpool', 20);
      if (h2) h2.whirlpoolTemp = 80;
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-citra'), 80, 'dryhop', 0);
      Recipe.addHop(r, findIn(BREW.DB.hops, 'h-mosaic'), 80, 'dryhop', 0);
      Recipe.addYeast(r, findIn(BREW.DB.yeasts, 'y-verdant'), 13);
      r.water.source = { ca: 60, mg: 8, na: 30, cl: 80, so4: 50, hco3: 60 };
      r.water.salts = [{ id: 'w-cacl2', amount: 4 }, { id: 'w-gypsum', amount: 1 }];
      r.carbonation.targetVol = 2.4;
      out.push(r);
    })();

    return out;
  };

  /* ======================================================================
   * 七、统计辅助
   * ====================================================================*/

  /** 麦芽按重量占比 */
  Recipe.grainBillPct = function (r) {
    var total = U.sumBy(r.fermentables || [], function (f) { return U.toNum(f.amount, 0); });
    return (r.fermentables || []).map(function (f) {
      return {
        name: f.name, amount: f.amount, cat: f.cat,
        pct: total > 0 ? U.round(U.toNum(f.amount, 0) / total * 100, 1) : 0
      };
    });
  };

  /** 总酒花用量（g）与干投量 */
  Recipe.hopStats = function (r) {
    var total = 0, dry = 0, whirl = 0, bitter = 0;
    (r.hops || []).forEach(function (h) {
      var g = U.toNum(h.amount, 0);
      total += g;
      if (h.stage === 'dryhop' || h.stage === 'keg') dry += g;
      else if (h.stage === 'whirlpool') whirl += g;
      else if (h.stage === 'boil' && U.toNum(h.time, 0) >= 40) bitter += g;
    });
    return {
      total: U.round(total, 0),
      dry: U.round(dry, 0),
      whirlpool: U.round(whirl, 0),
      bitter: U.round(bitter, 0),
      gPerL: U.round(total / (U.toNum(r.batchSize, 20)), 1),
      dryGPerL: U.round(dry / (U.toNum(r.batchSize, 20)), 1)
    };
  };

  /** 估算原料成本（元）。库里的价格字段不全，所以这里只做粗估 */
  Recipe.estimateCost = function (r) {
    var grainCost = U.sumBy(r.fermentables || [], function (f) {
      /* 基础麦芽约 12 元/kg，特种麦芽约 20 元/kg，糖约 15 元/kg */
      var unit = f.cat === 'base' ? 12 : (f.cat === 'sugar' ? 15 : 20);
      return U.toNum(f.amount, 0) * unit;
    });
    var hopCost = U.sumBy(r.hops || [], function (h) {
      /* 酒花按 0.25 元/g 粗估（约 250 元/kg） */
      return U.toNum(h.amount, 0) * 0.25;
    });
    var yeastCost = (r.yeasts || []).length * 30;
    var total = grainCost + hopCost + yeastCost;
    return {
      grain: U.round(grainCost, 0),
      hop: U.round(hopCost, 0),
      yeast: U.round(yeastCost, 0),
      total: U.round(total, 0),
      perLiter: U.round(total / U.toNum(r.batchSize, 20), 2),
      note: '按国内家酿原料零售价粗估（麦芽 12-20 元/kg、酒花约 250 元/kg、酵母约 30 元/包），' +
            '仅用于预算参考，不是报价'
    };
  };

  /* ======================================================================
   * 八、版本改动意图 intent（v1.4）
   * ----------------------------------------------------------------------
   * 要解决的问题：v1.3 能回答"改了什么"（32 的 diff），回答不了"为什么改"。
   *   一串快照只是快照；补上理由，谱系才是一条有因果的演化链。
   *
   * 存在哪里：**版本条目上**（versions[recipeId][i].intent），不是配方对象上。
   *   理由描述的是"第 N 版相对第 N-1 版"，它是**某一条快照的属性**。
   *   放到配方上会立刻出错：配方只有一份，用户改第三次时第二次留下的理由
   *   就被覆盖，历史里那一条永远显示"最新那句话"——比没有更坏，因为它看着像真的。
   *
   * 与内容指纹（00-core 的 hash）的关系：intent **不参与** hash。
   *   只补一句理由、内容一个字没动，不应该催生第 N+1 版；反过来若把 intent
   *   算进 hash，用户"补写理由"就会凭空多出一个版本、rev 也会跳。
   *
   * 兼容：v1.4 之前存的版本条目没有 intent 字段。读的时候一律当 ''（=未填写），
   *   **绝不去重写历史版本**——历史条目是"当时存下来的东西"，补字段等于篡改。
   * ====================================================================*/

  var INTENT_MAX = 60;

  /** 按 Unicode 码点截断：一个 emoji 算一个字，不截半个代理对（会显示成 �） */
  function cutByCodePoint(str, max) {
    var out = '', n = 0, i = 0;
    while (i < str.length && n < max) {
      var c = str.charCodeAt(i);
      var step = (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) ? 2 : 1;
      out += str.substr(i, step);
      i += step;
      n++;
    }
    return out;
  }

  function codePointLen(str) {
    var n = 0, i = 0;
    while (i < str.length) {
      var c = str.charCodeAt(i);
      i += (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) ? 2 : 1;
      n++;
    }
    return n;
  }

  Recipe.INTENT_MAX = INTENT_MAX;

  /**
   * 归一化：折叠所有空白（含换行、全角空格）成单个空格、去首尾、截到 60 字。
   * 为什么要折叠换行：这句话最终显示在版本对比页的一行摘要和谱系节点的一行
   * 悬浮提示里。粘一段多行笔记进去，会把那一行撑成三行，也把那行的位置挤没。
   */
  Recipe.normIntent = function (v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/[\s\u3000]+/g, ' ');
    /* 不用 trim()：老内核的 trim 不处理全角空格 + BOM，而这里刚把
       \u3000 换成了半角空格，所以手写首尾去空格更稳 */
    s = s.replace(/^[ ]+/, '').replace(/[ ]+$/, '');
    return cutByCodePoint(s, INTENT_MAX);
  };

  /** 字数（码点）。输入框的 "23/60" 用它，别用 String.length——
      一个 emoji 在 length 里算 2，用户会看到"明明没超却红了" */
  Recipe.intentLen = function (v) {
    return codePointLen(String(v === null || v === undefined ? '' : v));
  };

  /** 读一条版本条目的意图。老条目没有该字段 → ''（=未填写），不报错、不补写 */
  Recipe.intentOfVersion = function (entry) {
    if (!entry || typeof entry !== 'object') return '';
    return Recipe.normIntent(entry.intent);
  };

  /** 某配方的版本数组（活对象；改它等于改库，只给本文件与 intent 写入用） */
  function versionsOf(recipeId) {
    if (!recipeId || !BREW.Store || typeof BREW.Store.get !== 'function') return [];
    try {
      var arr = BREW.Store.get('versions.' + recipeId, null);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function latestEntryOf(recipeId) {
    var arr = versionsOf(recipeId);
    return arr.length ? arr[arr.length - 1] : null;
  }

  Recipe.versionsOf = versionsOf;

  /** 这份配方**最新一版**的理由；没有版本或没填 → '' */
  Recipe.intentOf = function (recipeId) {
    return Recipe.intentOfVersion(latestEntryOf(recipeId));
  };

  /**
   * 把理由写进某条版本条目并落盘。返回写入后的字符串（'' = 已清空）。
   * 清空时**删掉字段**而不是写空串：JSON 少一个键更省配额（水位 1.1M 是硬的），
   * 语义上也更准确——"没填"就是没有这个键，和 v1.3 的老条目天然同形。
   */
  function writeIntent(recipeId, entry, text) {
    if (!entry) return '';
    var v = Recipe.normIntent(text);
    if (v) entry.intent = v;
    else if (entry.intent !== undefined) delete entry.intent;

    /* entry 是 Store 内存树里的活对象，改完必须标脏 + 落盘，否则刷新就没了。
       走 Store.set('versions', …) 只为复用它的 touch()（Store 没有对外暴露
       markDirty）；值是同一棵树，所以这一步等于"只标脏"。 */
    try {
      if (BREW.Store && typeof BREW.Store.set === 'function') {
        BREW.Store.set('versions', BREW.Store.get('versions', {}));
      }
      if (BREW.Store && typeof BREW.Store.flushNow === 'function') BREW.Store.flushNow();
    } catch (e) {
      /* 写不进去不打断保存：配方本身已经落盘了，丢的只是一句话，
         而且还在内存里，下一次成功落盘会一起写进去 */
      if (root.console && root.console.warn) root.console.warn('[Recipe] 改动意图落盘失败', e);
    }

    if (BREW.Bus && typeof BREW.Bus.emit === 'function') {
      BREW.Bus.emit('versionIntent', { recipeId: recipeId, rev: entry.rev, intent: v });
    }
    return v;
  }

  /**
   * 写某条版本的理由。两种调用形式：
   *   setVersionIntent(recipeId, entry, text)   指定条目（对比页/谱系页用）
   *   setVersionIntent(recipeId, text)          写最新一版
   */
  Recipe.setVersionIntent = function (recipeId, entry, text) {
    if (text === undefined && typeof entry === 'string') {
      return writeIntent(recipeId, latestEntryOf(recipeId), entry);
    }
    return writeIntent(recipeId, entry || latestEntryOf(recipeId), text);
  };

  /* ---------------------------------------------------------------- §八.2
   * 保存钩子：给 Store.saveRecipe 补一个可选的第二参数 { intent }
   * ------------------------------------------------------------------
   * 为什么是装饰器、而不是直接改 00-core 的签名：
   *   `pushVersion()` 在 js/00-core.js 里造条目，那是唯一的写入点；
   *   本版 00-core 不归本文件动（见交付报告）。装饰器的收益是**零假设**：
   *   42 / 40 里现有的 `Store.saveRecipe(r)` 一行都不用改、行为完全不变，
   *   想带理由的调用方写 `Store.saveRecipe(r, { intent: '…' })` 即可。
   *
   * ⚠️ 这是**接缝**，不是终点。三个理由：
   *   · 时序敏感：30 必须在 00 之后、任何保存之前执行（当前加载顺序成立）；
   *   · 语义上"版本归档的入参"属于 00，不属于模型层；
   *   · v1.4 期间 00-core 正在被别人改（降级保护 + 备份恢复），那时改它的
   *     签名会打架，所以这版先不动它。
   *   正式做法是把 opts 加进 00-core 的 saveRecipe 签名、透传给 pushVersion，
   *   然后删掉下面这十几行。已写进 v1.4 交付报告的建议回填清单。
   *
   * 只给"这次真的建出来的版本"打标：
   *   内容没变时 saveRecipe 不建新版本（00-core 规则③），此时写 intent
   *   会把理由贴到**上一版**身上，历史就变成一句错话。判据是末条目
   *   是否换成了新对象——比"比时间戳"可靠（同毫秒两次保存在测试里很常见）。
   *
   * 复制 / 另存为 / 导入 的语义（调用方不传 opts 就自动是这个行为）：
   *   · 另存为 / 复制：新配方 + 新 id + 新的第 1 版，**不带**源配方的理由。
   *     源配方的理由回答的是"源配方为什么改成那样"，挂到新配方上就是张冠李戴。
   *   · 单配方导入：导入的是"当前内容"，从来不带 versions（历史是这台机器的），
   *     所以理由自然为空——这是对的，别人的理由不该出现在你的谱系里。
   * ---------------------------------------------------------------- */
  function installSaveIntentHook() {
    var Store = BREW.Store;
    if (!Store || typeof Store.saveRecipe !== 'function') return false;
    if (Store.__intentHooked) return true;

    var orig = Store.saveRecipe;
    Store.saveRecipe = function (r, opts) {
      var want = Recipe.normIntent(opts && opts.intent);
      var id = (r && r.id) ? String(r.id) : '';
      var before = id ? latestEntryOf(id) : null;
      var out = orig.apply(this, arguments);
      if (want && out && out.id) {
        var after = latestEntryOf(out.id);
        if (after && after !== before) writeIntent(out.id, after, want);
      }
      return out;
    };
    Store.__intentHooked = true;
    return true;
  }

  Recipe.installSaveIntentHook = installSaveIntentHook;
  installSaveIntentHook();

  /** 便捷调用：等价于 Store.saveRecipe(r, {intent: …})，给测试与将来的一处调用点用 */
  Recipe.saveWithIntent = function (r, intent) {
    if (!BREW.Store || typeof BREW.Store.saveRecipe !== 'function') return null;
    return BREW.Store.saveRecipe(r, { intent: intent });
  };

})(typeof window !== 'undefined' ? window : globalThis);
