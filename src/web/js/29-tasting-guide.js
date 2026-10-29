/* ============================================================================
 * 风月酿研所 — 29 品鉴指引的查询接口（Tasting Guide Query）
 * ----------------------------------------------------------------------------
 * 职责：把 21-data-tasting.js 里那张静态数据表变成「按风格查」的接口：
 *       给一个 styleId，返回这个风格最该优先排查的缺陷、基本不会出现的缺陷、
 *       以及其余缺陷。
 *
 * 为什么单独一个文件而不是塞进 21：
 *   21 是**纯数据**（audit 直接 require 它做体检，里面没有逻辑）。
 *   一旦在里面写函数，它就既不是数据也不是模块，audit 的"只加载数据"边界就破了。
 *
 * 纯度：只读自己的数据表 `BREW.DB.tastingGuide`，**不查 `DB.styles`**。
 *   "styles 里写的风格 id 是否存在"是数据完整性问题，归 audit 管（那里已经加断言）。
 *   本模块不取时间、不读 Store、不写任何东西。
 *
 * 前置依赖：21-data-tasting.js（缺了就让 forStyle 返回全空并给 note，不抛错）
 * 加载位置：应在 js/28-share-code.js 之后、js/30-recipe.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var TastingGuide = BREW.TastingGuide = {};

  function guide() {
    return (BREW.DB && BREW.DB.tastingGuide) || null;
  }

  function list(v) { return Array.isArray(v) ? v : []; }

  var EMPTY = { styleId: '', common: [], rare: [], others: [], total: 0, note: '' };

  /**
   * 按风格查缺陷。
   * @param {string} styleId BJCP 风格 id（如 '5D' / '21B-NEIPA' / '20C'）
   * @returns {{styleId:string, common:Array, rare:Array, others:Array, total:number, note:string}}
   *   common = 这类酒最值得优先排查的
   *   rare   = 结构上几乎不会出现的（陈放还原 / 烘烤掩盖）
   *   others = 其余（不是"不会发生"，只是不是首选怀疑对象）
   *   三个数组加起来 = total。返回的是**原对象引用**，只读，别改。
   */
  TastingGuide.forStyle = function (styleId) {
    var g = guide();
    if (!g) {
      return {
        styleId: String(styleId || ''), common: [], rare: [], others: [], total: 0,
        note: '品鉴指引未加载（21-data-tasting.js），无法按风格筛选'
      };
    }

    var id = String(styleId === null || styleId === undefined ? '' : styleId);
    /* 2021 改过编号（21B-NEIPA → 21C）：老批次里存的还是旧 id。
       这里用风格表的 altIds 归一化一次，否则按旧 id 查会静默返回"没登记优先缺陷"，
       界面上看起来像"这风格没缺陷可查"，其实是 id 没对上。 */
    var st = (BREW.DB && BREW.DB.getStyle) ? BREW.DB.getStyle(id) : null;
    if (st && st.id) id = st.id;
    var faults = list(g.faults);
    var common = [], rare = [], others = [];

    for (var i = 0; i < faults.length; i++) {
      var f = faults[i];
      if (!f) continue;
      var inCommon = list(f.styles).indexOf(id) >= 0;
      var inRare = list(f.rare).indexOf(id) >= 0;
      /* 同一风格不可能既"最该查"又"基本不会有"；真出现就是数据写错了，
         这里以 styles 优先（宁可多查一项，也不要让人跳过） */
      if (inCommon) common.push(f);
      else if (inRare) rare.push(f);
      else others.push(f);
    }

    var note = '';
    if (!id) note = '未指定风格，全部缺陷按"其他"排列';
    else if (!common.length) note = '这个风格没有登记"最该优先排查"的缺陷，下面的通用清单仍然适用';

    return {
      styleId: id,
      common: common,
      rare: rare,
      others: others,
      total: faults.length,
      note: note
    };
  };

  /** 按 id 取一条缺陷（界面深链接用） */
  TastingGuide.fault = function (id) {
    var g = guide();
    if (!g) return null;
    var faults = list(g.faults);
    for (var i = 0; i < faults.length; i++) {
      if (faults[i] && faults[i].id === id) return faults[i];
    }
    return null;
  };

  /** 按 id 取一个评分段（12/3/20/5/10） */
  TastingGuide.section = function (id) {
    var g = guide();
    if (!g) return null;
    var secs = list(g.sections);
    for (var i = 0; i < secs.length; i++) {
      if (secs[i] && secs[i].id === id) return secs[i];
    }
    return null;
  };

  /* ======================================================================
   * 自检
   * ====================================================================*/
  TastingGuide.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    var g = guide();
    ok('指引数据已加载', !!g);
    if (!g) return { ok: false, total: total, errors: errors, warns: warns };

    var faults = list(g.faults);
    ok('缺陷表非空', faults.length >= 12, String(faults.length));

    /* 1. 每条都要有 styles，且 rare 不能和 styles 重叠 */
    var noStyles = 0, overlap = 0;
    for (var i = 0; i < faults.length; i++) {
      var f = faults[i] || {};
      if (!list(f.styles).length) noStyles++;
      var dup = list(f.styles).filter(function (s) { return list(f.rare).indexOf(s) >= 0; });
      if (dup.length) overlap++;
    }
    ok('每条缺陷都有风格关联', noStyles === 0, noStyles + ' 条缺 styles');
    ok('styles 与 rare 不重叠', overlap === 0, overlap + ' 条重叠');

    /* 2. 拉格：双乙酰 / DMS / 硫化物 必须进 common */
    var pils = TastingGuide.forStyle('5D');
    ok('5D 德式皮尔森 common 含双乙酰', pils.common.some(function (x) { return x.id === 'diacetyl'; }));
    ok('5D common 含 DMS', pils.common.some(function (x) { return x.id === 'dms'; }));
    ok('5D common 含硫化物', pils.common.some(function (x) { return x.id === 'sulfur'; }));

    /* 3. 帝国世涛：氧化 / 涩口 / 高级醇 进 common，DMS 进 rare */
    var stout = TastingGuide.forStyle('20C');
    ok('20C common 含氧化', stout.common.some(function (x) { return x.id === 'oxidation'; }));
    ok('20C common 含涩口', stout.common.some(function (x) { return x.id === 'astringent'; }));
    ok('20C rare 含 DMS', stout.rare.some(function (x) { return x.id === 'dms'; }));

    /* 4. 浑浊 IPA：氧化 / 脂肪消光 / 光照臭 进 common */
    var neipa = TastingGuide.forStyle('21B-NEIPA');
    ok('NEIPA common 含氧化', neipa.common.some(function (x) { return x.id === 'oxidation'; }));
    ok('NEIPA common 含脂肪消光', neipa.common.some(function (x) { return x.id === 'lipid'; }));
    ok('NEIPA common 含光照臭', neipa.common.some(function (x) { return x.id === 'lightstruck'; }));

    /* 5. 三组互斥且总数守恒 */
    ok('common+rare+others = total',
      pils.common.length + pils.rare.length + pils.others.length === pils.total,
      pils.common.length + '+' + pils.rare.length + '+' + pils.others.length + ' vs ' + pils.total);
    var ids = {};
    pils.common.concat(pils.rare, pils.others).forEach(function (x) { ids[x.id] = (ids[x.id] || 0) + 1; });
    ok('每个缺陷只出现一次', Object.keys(ids).every(function (k) { return ids[k] === 1; }));

    /* 6. 未知风格：不崩，全进 others */
    var unknown = TastingGuide.forStyle('zzz');
    ok('未知风格 common 为空', unknown.common.length === 0);
    ok('未知风格 others = 全部', unknown.others.length === unknown.total);
    ok('未知风格有说明', /通用清单/.test(unknown.note), unknown.note);
    ok('空 id 不崩', TastingGuide.forStyle(null).others.length === faults.length);

    /* 7. 取单条 */
    ok('fault(id) 可取', TastingGuide.fault('diacetyl') && TastingGuide.fault('diacetyl').zh.indexOf('双乙酰') >= 0);
    ok('fault(不存在) 返回 null', TastingGuide.fault('nope') === null);
    ok('section(id) 可取', TastingGuide.section('flavor') && TastingGuide.section('flavor').max === 20);

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
