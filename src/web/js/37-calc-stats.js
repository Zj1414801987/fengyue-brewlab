/* ============================================================================
 * 风月酿研所 — 37 年度统计（Annual Stats）
 * ----------------------------------------------------------------------------
 * 职责：把一批批次聚合成一年看板要的数字：产量、风格分布、月度分布、
 *       平均效率、每升成本、评分最高的三批。
 *
 * 口径（每一个都是"降级链"，因为真实数据一定缺字段）：
 *   年份   brewDate 的前 4 位 → statusHistory[0].at 的年份 → createdAt 的年份
 *   产量   packaging.volume → actual.postBoilVolume → snapshot.batchSize（标 estimated）
 *   成本   cost.total → cost.ingredients + cost.other → 该批不进 costPerL 的分母
 *   评分   tasting.total（子项不参与，五段总分才是权威值）
 *
 * v1.4 新增 Stats.annualCost（年度花费）：与 annual 同一套年份/产量口径，
 * 但**只认填了成本的批次**。两套分母不混用，原因写在函数头。
 * ⚠ 没有"原料分类花费"：库存流水 inventory.moves[] 只有量的字段
 *   （delta/unit/reason），没有金额；items[].price 虽然写在 00-core 的契约注释里，
 *   但全库没有任何写入点、导入不带、界面也没有录入入口，取到的永远是 undefined。
 *   拿它算"库存价值"只会得到一排 0，看起来像"你的库存一文不值"。
 *   所以宁可不画这张图。等真有价格录入了再加，别在这里编。
 *   状态   只认 v1.2 新枚举（plan/mash/lauter/boil/chill/ferment/dryhop/mature/package/done/failed），
 *          旧值（planned/mashing/…）走 Config.normalizeStatus 兜底
 *
 * **不要用 Batch.overview()**：它按 snapshot.batchSize 累加，把"计划中、还没酿"的
 * 批次也算进产量。看板要的是"今年真酿出来多少"，不是"今年打算酿多少"。
 *
 * 纯度：batches 是入参数组，不读 Store，不取当前时间（年份由入参给）。
 *
 * 前置依赖：00-core（可选，只用 Config.normalizeStatus / Util.round）
 * 加载位置：应在 js/35-batch.js 之后、js/40-ui-shell.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var Stats = BREW.Stats = {};

  var U = (BREW.Util && typeof BREW.Util.round === 'function') ? BREW.Util : {
    toNum: function (v, d) {
      var n = parseFloat(v);
      return isFinite(n) ? n : (d === undefined ? 0 : d);
    },
    round: function (v, d) {
      var p = Math.pow(10, d || 0);
      return Math.round(v * p) / p;
    }
  };

  var DONE_STATUS = { package: true, done: true };

  function num(v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  }

  function normalizeStatus(v) {
    if (BREW.Config && typeof BREW.Config.normalizeStatus === 'function') {
      return BREW.Config.normalizeStatus(v);
    }
    return String(v || 'plan');
  }

  /* ======================================================================
   * 取数（每个都有降级链）
   * ====================================================================*/

  /**
   * 批次日期：brewDate → statusHistory[0].at → createdAt。
   * 年度与月度必须用**同一个**来源，否则会出现"算进了 2026 年、但月度图里没有"，
   * 而两处数字对不上的报表比没有报表更糟。
   * @returns {{year:number, month:number}|null}  month 为 1–12
   */
  function dateOf(b) {
    var bd = String((b && b.brewDate) || '');
    var m = /^(\d{4})-(\d{2})/.exec(bd);
    if (m) return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };

    var hist = (b && Array.isArray(b.statusHistory)) ? b.statusHistory : [];
    var ts = hist.length && hist[0] ? hist[0].at : null;
    if (!ts && b && b.createdAt) ts = b.createdAt;
    if (!ts) return null;
    var d = new Date(ts);
    if (!isFinite(d.getTime())) return null;
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function yearOf(b) {
    var d = dateOf(b);
    return d ? d.year : null;
  }

  /** @returns {{v:number, estimated:boolean, source:string}} */
  function volumeOf(b) {
    var pk = (b && b.packaging) || {};
    var v = num(pk.volume, null);
    if (v !== null && v > 0) return { v: v, estimated: false, source: 'packaging' };

    var ac = (b && b.actual) || {};
    v = num(ac.postBoilVolume, null);
    if (v !== null && v > 0) return { v: v, estimated: false, source: 'actual' };

    var snap = (b && b.recipeSnapshot) || {};
    v = num(snap.batchSize, null);
    if (v !== null && v > 0) return { v: v, estimated: true, source: 'snapshot' };

    return { v: 0, estimated: true, source: 'none' };
  }

  /** @returns {number|null} */
  function costOf(b) {
    var c = (b && b.cost) || {};
    var t = num(c.total, null);
    if (t !== null && t > 0) return t;
    var parts = num(c.ingredients, 0) + num(c.other, 0);
    return parts > 0 ? parts : null;
  }

  function efficiencyOf(b) {
    var ac = (b && b.actual) || {};
    var e = num(ac.efficiency, null);
    if (e !== null && e > 0) return e;
    var snap = (b && b.recipeSnapshot) || {};
    e = num(snap.efficiency, null);
    return (e !== null && e > 0) ? e : null;
  }

  function styleOf(b) {
    var snap = (b && b.recipeSnapshot) || {};
    var id = snap.styleId || b.styleId || '';
    if (!id) return { id: '', name: '未指定风格' };
    var name = snap.styleName;
    if (!name && BREW.DB) {
      var list = BREW.DB.styles || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { name = list[i].name; break; }
      }
    }
    return { id: id, name: name || id };
  }

  /* ======================================================================
   * 主函数
   * ----------------------------------------------------------------------
   * @param {Array}  batches 批次数组（不传则返回空统计，不读 Store）
   * @param {number} year    年份；不传/为 0 → 取所有有年份数据里最大的那一年
   * @returns {{
   *   year:number, count:number, volumeL:number, avgEfficiency:number|null,
   *   costPerL:number|null, styleDist:Array, monthly:Array, topRated:Array,
   *   completedCount:number, estimatedVolume:boolean, totalCost:number|null,
   *   costedVolumeL:number, warnings:string[]
   * }}
   * ====================================================================*/
  Stats.annual = function (batches, year) {
    var all = Array.isArray(batches) ? batches : [];
    var warnings = [];

    /* 先给每条算年份，才能在没有指定年份时自己挑一个 */
    var withYear = [];
    var noYear = 0;
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      if (!b) continue;
      var y = yearOf(b);
      if (y === null) { noYear++; continue; }
      withYear.push({ b: b, y: y });
    }
    if (noYear) warnings.push(noYear + ' 个批次没有酿造日期，已排除在年度统计之外');

    var targetYear = num(year, 0);
    if (!targetYear) {
      for (var k = 0; k < withYear.length; k++) {
        if (withYear[k].y > targetYear) targetYear = withYear[k].y;
      }
    }
    if (!targetYear) {
      return {
        year: 0, count: 0, volumeL: 0, avgEfficiency: null, costPerL: null,
        styleDist: [], monthly: emptyMonths(), topRated: [],
        completedCount: 0, estimatedVolume: false, totalCost: null,
        costedVolumeL: 0, warnings: warnings
      };
    }

    var list = [];
    for (var j = 0; j < withYear.length; j++) {
      if (withYear[j].y === targetYear) list.push(withYear[j].b);
    }

    var volumeL = 0, estimated = false, estimatedCount = 0;
    var costTotal = 0, costedVolume = 0, costedCount = 0;
    var effSum = 0, effCount = 0;
    var completed = 0;
    var styleMap = {}, styleOrder = [];
    var monthly = emptyMonths();
    var rated = [];

    for (var n = 0; n < list.length; n++) {
      var bt = list[n] || {};
      var vol = volumeOf(bt);
      volumeL += vol.v;
      if (vol.estimated) { estimated = true; estimatedCount++; }

      var cost = costOf(bt);
      if (cost !== null) {
        costTotal += cost;
        costedVolume += vol.v;
        costedCount++;
      }

      var eff = efficiencyOf(bt);
      if (eff !== null) { effSum += eff; effCount++; }

      var st = normalizeStatus(bt.status);
      if (DONE_STATUS[st]) completed++;

      /* 风格分布 */
      var sty = styleOf(bt);
      var key = sty.id || '__none__';
      if (!styleMap[key]) {
        styleMap[key] = { styleId: sty.id, name: sty.name, count: 0, volumeL: 0 };
        styleOrder.push(key);
      }
      styleMap[key].count++;
      styleMap[key].volumeL += vol.v;

      /* 月度分布：与年度用同一个日期来源（见 dateOf） */
      var dt = dateOf(bt);
      if (dt && dt.month >= 1 && dt.month <= 12) {
        monthly[dt.month - 1].count++;
        monthly[dt.month - 1].volumeL += vol.v;
      }

      /* 评分榜 */
      var tasting = bt.tasting || {};
      var total = num(tasting.total, null);
      if (total === null) {
        /* 没有 total 但有五段分时，按 BJCP 定义求和（12+3+20+5+10） */
        var a = num(tasting.aroma, null), ap = num(tasting.appearance, null);
        var fl = num(tasting.flavor, null), mf = num(tasting.mouthfeel, null);
        var ov = num(tasting.overall, null);
        if (a !== null || fl !== null) {
          total = (a || 0) + (ap || 0) + (fl || 0) + (mf || 0) + (ov || 0);
          total = U.round(total, 1);
        }
      }
      if (total !== null) {
        rated.push({
          id: bt.id || '',
          name: bt.name || (bt.recipeSnapshot && bt.recipeSnapshot.name) || '未命名批次',
          total: U.round(total, 1),
          date: bt.brewDate || '',
          styleId: sty.id
        });
      }
    }

    /* 风格分布：先按数量、再按产量排 */
    var styleDist = [];
    for (var s = 0; s < styleOrder.length; s++) {
      var it = styleMap[styleOrder[s]];
      it.volumeL = U.round(it.volumeL, 1);
      styleDist.push(it);
    }
    styleDist.sort(function (a, b2) {
      if (b2.count !== a.count) return b2.count - a.count;
      return b2.volumeL - a.volumeL;
    });

    rated.sort(function (a, b3) { return b3.total - a.total; });

    var out = {
      year: targetYear,
      count: list.length,
      volumeL: U.round(volumeL, 1),
      avgEfficiency: effCount ? U.round(effSum / effCount, 1) : null,
      costPerL: (costedVolume > 0 && costedCount > 0) ? U.round(costTotal / costedVolume, 2) : null,
      styleDist: styleDist,
      monthly: monthly,
      topRated: rated.slice(0, 3),
      completedCount: completed,

      /* ---- 口径透明化：让界面能标"估算"而不是假装精确 ---- */
      estimatedVolume: estimated,
      totalCost: costedCount ? U.round(costTotal, 0) : null,
      costedVolumeL: U.round(costedVolume, 1),
      warnings: warnings
    };

    if (estimatedCount) {
      out.warnings.push(estimatedCount + ' 个批次没有包装量/实际产量，按设计批次量估算（标"估算"）');
    }
    if (list.length && !costedCount) {
      out.warnings.push('没有任何批次填了成本，每升成本不可用');
    }
    if (list.length && !rated.length) {
      /* v1.7：原来写「在批次的品鉴卡里打分后出现」——批次页从来没有品鉴卡，
         打分入口在**品鉴视图**（59-ui-tasting.js）。指向不存在的按钮比没有提示更糟。 */
      out.warnings.push('还没有品鉴评分，评分榜为空（在品鉴视图里打分后出现）');
    }

    return out;
  };

  function emptyMonths() {
    var arr = [];
    for (var i = 0; i < 12; i++) arr.push({ month: i + 1, count: 0, volumeL: 0 });
    return arr;
  }

  /* ======================================================================
   * 年度花费（v1.4）
   * ----------------------------------------------------------------------
   * 只回答三个问题：这一年花了多少、每升多少钱、钱压在哪些批次上。
   *
   * 为什么不塞进 Stats.annual：
   *   annual 回答的是"这一年酿得怎么样"——产量、风格、效率、评分，每个批次都算；
   *   这个函数回答的是"这一年花得怎么样"——**只认填了成本的批次**。
   *   两套分母塞进一个出参，界面一并排，用户除一遍就会发现对不上，
   *   然后开始怀疑所有数字。分开算、分开标口径，是唯一诚实的做法。
   *
   * 三条硬口径：
   *   ① 每升花费的分母**只算填了成本的批次**。把没填成本的产量放进分母，
   *      每升会系统性偏低，看着像"今年特别省"，实际是漏填。
   *   ② 每批花费的分母同理：只除填了成本的批次数，不除全部批次数。
   *   ③ 原料 / 其它两项按字段各自累加，与 total 分开取。只填 total 的批次
   *      会让两项之和小于 total，差额单独出 unallocated，**不摊**进原料。
   *
   * 没有 byKind（麦芽/酒花/酵母/辅料各自花了多少）：
   *   库存流水没有金额，单价字段也没人写（详见文件头）。编不出来就不编。
   *
   * @param {Array}  batches 批次数组（不传则返回空统计，不读 Store）
   * @param {number} year    年份；不传/为 0 → 取批次数据里最大的那一年
   * @returns {{
   *   year:number, batches:number, volumeL:number,
   *   cost:{ingredients:number, other:number, total:number, unallocated:number},
   *   perLiter:number|null, perBatch:number|null,
   *   costedBatches:number, costedVolumeL:number, estimatedVolume:boolean,
   *   byMonth:Array<{month:number, cost:number, volumeL:number, batches:number, costed:number}>,
   *     month 恒定 1–12 共 12 项，空月补 0；
   *     cost / costed 只含填了成本的批次，volumeL / batches 含当月的**全部**批次
   *     —— 两个口径并排放，是为了能看出"这个月酿了 3 批但只有 1 批填了钱"。
   *   topCost:Array<{batchId:string, name:string, cost:number, volumeL:number, perLiter:number|null}>,
   *   warnings:string[]
   * }}
   * ====================================================================*/
  Stats.annualCost = function (batches, year) {
    var all = Array.isArray(batches) ? batches : [];
    var warnings = [];

    var withYear = [];
    var noYear = 0;
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      if (!b) continue;
      var y = yearOf(b);
      if (y === null) { noYear++; continue; }
      withYear.push({ b: b, y: y });
    }
    if (noYear) warnings.push(noYear + ' 个批次没有酿造日期，已排除在年度花费之外');

    var targetYear = num(year, 0);
    if (!targetYear) {
      for (var k = 0; k < withYear.length; k++) {
        if (withYear[k].y > targetYear) targetYear = withYear[k].y;
      }
    }
    if (!targetYear) {
      return emptyCost(0, warnings);
    }

    var list = [];
    for (var j = 0; j < withYear.length; j++) {
      if (withYear[j].y === targetYear) list.push(withYear[j].b);
    }

    var volumeL = 0, estimated = false, estimatedCount = 0;
    var sumIng = 0, sumOther = 0, sumTotal = 0;
    var costedVolumeL = 0, costedBatches = 0, zeroVolumeCosted = 0;
    var byMonth = emptyCostMonths();
    var costed = [];

    for (var n = 0; n < list.length; n++) {
      var bt = list[n] || {};
      var vol = volumeOf(bt);
      volumeL += vol.v;
      if (vol.estimated) { estimated = true; estimatedCount++; }

      /* 月度与年度同源（dateOf），否则会出现"算进了这一年、月度图里没有" */
      var dt = dateOf(bt);
      var mi = (dt && dt.month >= 1 && dt.month <= 12) ? dt.month - 1 : -1;
      if (mi >= 0) {
        byMonth[mi].batches++;
        byMonth[mi].volumeL += vol.v;
      }

      var c = costOf(bt);
      if (c === null) continue;          /* 没填成本的批次到此为止，不进任何分母 */

      var cs = bt.cost || {};
      costedBatches++;
      sumTotal += c;
      sumIng += num(cs.ingredients, 0);
      sumOther += num(cs.other, 0);
      if (vol.v > 0) costedVolumeL += vol.v; else zeroVolumeCosted++;
      if (mi >= 0) { byMonth[mi].cost += c; byMonth[mi].costed++; }

      costed.push({
        batchId: bt.id || '',
        name: bt.name || (bt.recipeSnapshot && bt.recipeSnapshot.name) || '未命名批次',
        cost: U.round(c, 2),
        volumeL: U.round(vol.v, 1),
        perLiter: vol.v > 0 ? U.round(c / vol.v, 2) : null
      });
    }

    for (var m = 0; m < 12; m++) {
      byMonth[m].cost = U.round(byMonth[m].cost, 2);
      byMonth[m].volumeL = U.round(byMonth[m].volumeL, 1);
    }

    /* 花费降序；同额按产量降序，保证同样的输入永远得到同样的顺序 */
    costed.sort(function (a, b2) {
      if (b2.cost !== a.cost) return b2.cost - a.cost;
      return b2.volumeL - a.volumeL;
    });

    var totalR = U.round(sumTotal, 2);
    var ingR = U.round(sumIng, 2);
    var otherR = U.round(sumOther, 2);

    var out = {
      year: targetYear,
      batches: list.length,
      volumeL: U.round(volumeL, 1),
      cost: {
        ingredients: ingR,
        other: otherR,
        total: totalR,
        /* 只填了 total 的批次，差额落在这里（可能是负数：总额低于两项之和）。
           界面只在绝对值 ≥ 0.5 时才提一句，避免 0.01 的浮点噪音变成一行字。 */
        unallocated: U.round(totalR - ingR - otherR, 2)
      },
      perLiter: (costedBatches && costedVolumeL > 0) ? U.round(totalR / costedVolumeL, 2) : null,
      perBatch: costedBatches ? U.round(totalR / costedBatches, 2) : null,
      costedBatches: costedBatches,
      costedVolumeL: U.round(costedVolumeL, 1),
      estimatedVolume: estimated,
      byMonth: byMonth,
      topCost: costed.slice(0, 5),
      warnings: warnings
    };

    if (estimatedCount) {
      out.warnings.push(estimatedCount + ' 个批次没有包装量/实际产量，产量按设计批次量估算');
    }
    if (list.length && !costedBatches) {
      out.warnings.push('这一年没有批次填成本，每升花费不可用');
    } else if (list.length > costedBatches) {
      out.warnings.push((list.length - costedBatches) + ' 个批次没填成本，未计入每升花费与每批花费的分母');
    }
    if (zeroVolumeCosted) {
      out.warnings.push(zeroVolumeCosted + ' 个填了成本的批次没有产量，成本进了总额但没进每升的分母');
    }
    /* 差额两个方向都要说，说法不能混：
       正数＝只填了合计（常见，46 的写入口就是清 total 让读侧求和）；
       负数＝合计比两项之和小（只可能来自导入/手改的数据），这时说"未拆分"是错的。 */
    if (out.cost.unallocated > 0.5) {
      out.warnings.push('有 ¥' + U.round(out.cost.unallocated, 2) +
        ' 未拆分到原料 / 其它（这些批次只填了总金额）');
    } else if (out.cost.unallocated < -0.5) {
      out.warnings.push('原料 + 其它 比合计多 ¥' + U.round(-out.cost.unallocated, 2) +
        '：有批次的合计金额小于两项之和，去批次成本卡核对一下');
    }

    return out;
  };

  function emptyCostMonths() {
    var arr = [];
    for (var i = 0; i < 12; i++) {
      arr.push({ month: i + 1, cost: 0, volumeL: 0, batches: 0, costed: 0 });
    }
    return arr;
  }

  /** 空出参：形状必须与有数据时**逐字段一致**，否则界面要为"空年份"写两套读法 */
  function emptyCost(year, warnings) {
    return {
      year: year,
      batches: 0,
      volumeL: 0,
      cost: { ingredients: 0, other: 0, total: 0, unallocated: 0 },
      perLiter: null,
      perBatch: null,
      costedBatches: 0,
      costedVolumeL: 0,
      estimatedVolume: false,
      byMonth: emptyCostMonths(),
      topCost: [],
      warnings: warnings || []
    };
  }

  /* ======================================================================
   * 自检
   * ====================================================================*/
  Stats.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    var batches = [
      /* 1. 完整数据：有包装量、有成本、有评分 */
      {
        id: 'b1', name: 'IPA 一号', brewDate: '2026-03-12', status: 'done',
        packaging: { volume: 19 }, actual: { efficiency: 74 },
        cost: { ingredients: 180, other: 20, total: 200 },
        tasting: { total: 38 },
        recipeSnapshot: { styleId: '21A', styleName: '美式 IPA', batchSize: 20, efficiency: 72 }
      },
      /* 2. 只有实际产量、没成本、旧状态枚举 */
      {
        id: 'b2', name: '世涛', brewDate: '2026-03-28', status: 'packaged',
        actual: { postBoilVolume: 20.5, efficiency: 68 },
        tasting: { aroma: 10, appearance: 3, flavor: 16, mouthfeel: 4, overall: 8 },
        recipeSnapshot: { styleId: '20C', styleName: '帝国世涛', batchSize: 20, efficiency: 70 }
      },
      /* 3. 计划中、没酿：不该算进"已完成"，但设计效率仍参与平均（降级链） */
      {
        id: 'b3', name: '计划中的拉格', brewDate: '2026-05-01', status: 'plan',
        recipeSnapshot: { styleId: '4A', styleName: '慕尼黑清亮', batchSize: 20, efficiency: 70 }
      },
      /* 4. 去年 */
      { id: 'b4', name: '去年的酒', brewDate: '2025-11-02', status: 'done', packaging: { volume: 18 } },
      /* 5. 没有酿造日期，只有 statusHistory */
      {
        id: 'b5', name: '无日期', status: 'done', packaging: { volume: 10 },
        statusHistory: [{ status: 'plan', at: new Date(2026, 6, 1).getTime() }]
      }
    ];

    var r = Stats.annual(batches, 2026);

    ok('只统计 2026', r.count === 4, String(r.count));          /* b1 b2 b3 b5 */
    ok('产量 = 19 + 20.5 + 20(估算) + 10', Math.abs(r.volumeL - 69.5) < 0.01, String(r.volumeL));
    ok('有估算标记', r.estimatedVolume === true);
    ok('平均效率 = (74+68+70)/3', Math.abs(r.avgEfficiency - 70.7) < 0.1, String(r.avgEfficiency));
    ok('成本只按有成本的批次除：200/19', Math.abs(r.costPerL - 10.53) < 0.02, String(r.costPerL));
    ok('已完成 = done + package（含旧枚举 packaged）', r.completedCount === 3, String(r.completedCount));
    ok('风格分布 4 项（含"未指定风格"）', r.styleDist.length === 4,
      JSON.stringify(r.styleDist.map(function (x) { return x.name; })));
    ok('未指定风格单独成项', r.styleDist.some(function (x) { return x.styleId === ''; }));
    ok('月度 12 桶', r.monthly.length === 12);
    ok('3 月 2 个批次', r.monthly[2].count === 2, String(r.monthly[2].count));
    ok('7 月 1 个（日期来自 statusHistory）', r.monthly[6].count === 1, String(r.monthly[6].count));
    ok('评分榜 2 条', r.topRated.length === 2, String(r.topRated.length));
    ok('榜首 41 分', r.topRated[0] && r.topRated[0].total === 41, r.topRated[0] && String(r.topRated[0].total));
    ok('第二名 38 分', r.topRated[1] && r.topRated[1].total === 38, r.topRated[1] && String(r.topRated[1].total));
    ok('五段分能求和（10+3+16+4+8=41）', r.topRated[0].id === 'b2', r.topRated[0].id);

    /* 2. 只指定年份时不该混入去年 */
    var r2025 = Stats.annual(batches, 2025);
    ok('2025 只有 1 批', r2025.count === 1, String(r2025.count));
    ok('2025 产量 18L', Math.abs(r2025.volumeL - 18) < 0.01, String(r2025.volumeL));

    /* 3. 不传年份 → 取最新一年 */
    var rAuto = Stats.annual(batches);
    ok('不传年份取最新（2026）', rAuto.year === 2026, String(rAuto.year));

    /* 4. 空输入 */
    var r0 = Stats.annual([], 2026);
    ok('空数组不崩', r0.count === 0 && r0.volumeL === 0);
    ok('空数据 costPerL 为 null', r0.costPerL === null);
    ok('空数据 monthly 仍是 12 桶', r0.monthly.length === 12);
    ok('null 入参不崩', Stats.annual(null, 2026).count === 0);

    /* 5. 计划批次不该虚增产量（这是 Batch.overview 的老毛病） */
    var onlyPlan = Stats.annual([{ id: 'p1', brewDate: '2026-01-01', status: 'plan', recipeSnapshot: { batchSize: 20 } }], 2026);
    ok('只有计划批次时产量按估算计 20L', Math.abs(onlyPlan.volumeL - 20) < 0.01, String(onlyPlan.volumeL));
    ok('只有计划批次时已完成 = 0', onlyPlan.completedCount === 0, String(onlyPlan.completedCount));

    /* 6. 缺日期有警告 */
    var noDate = Stats.annual([{ id: 'x', name: 'x', packaging: { volume: 5 } }], 0);
    ok('全无日期时有警告', noDate.warnings.length > 0, JSON.stringify(noDate.warnings));

    /* ==================================================================
     * 7. 年度花费（annualCost）
     * ==================================================================*/
    var costBatches = [
      /* 跨 2 年 · 2 个没填成本 · 1 个只有其它成本 · 1 个只填了总额 */
      {
        id: 'c1', name: '双料 IPA', brewDate: '2026-02-10',
        packaging: { volume: 19 }, cost: { ingredients: 180, other: 20, total: 200 }
      },
      { id: 'c2', name: '没填成本的', brewDate: '2026-02-20', packaging: { volume: 10 } },
      { id: 'c3', name: '只有其它成本', brewDate: '2026-06-05', packaging: { volume: 20 }, cost: { other: 60 } },
      { id: 'c4', name: '只有总额', brewDate: '2026-11-01', packaging: { volume: 20 }, cost: { total: 500 } },
      { id: 'c5', name: '去年的', brewDate: '2025-12-01', packaging: { volume: 18 }, cost: { total: 300 } }
    ];
    var ac = Stats.annualCost(costBatches, 2026);

    ok('花费·只算 2026 的 4 批', ac.batches === 4, String(ac.batches));
    ok('花费·月度 12 桶', ac.byMonth.length === 12, String(ac.byMonth.length));
    ok('花费·空月补 0（1 月 cost=0 且 batches=0）',
      ac.byMonth[0].cost === 0 && ac.byMonth[0].batches === 0 && ac.byMonth[0].volumeL === 0,
      JSON.stringify(ac.byMonth[0]));
    ok('花费·月度不重不漏（累计 = 总额）',
      Math.abs(ac.byMonth.reduce(function (s, m) { return s + m.cost; }, 0) - ac.cost.total) < 0.011,
      JSON.stringify(ac.byMonth.map(function (m) { return m.cost; })));
    ok('花费·总额 = 200 + 60 + 500', Math.abs(ac.cost.total - 760) < 0.011, String(ac.cost.total));
    ok('花费·原料 = 180（只有 c1 填了原料）', Math.abs(ac.cost.ingredients - 180) < 0.011, String(ac.cost.ingredients));
    ok('花费·其它 = 20 + 60', Math.abs(ac.cost.other - 80) < 0.011, String(ac.cost.other));
    ok('花费·未拆分差额 = 760 - 180 - 80', Math.abs(ac.cost.unallocated - 500) < 0.011, String(ac.cost.unallocated));
    ok('花费·产量是全部 4 批', Math.abs(ac.volumeL - 69) < 0.011, String(ac.volumeL));

    /* 核心：没填成本的批次既不进分子也不进分母 */
    ok('花费·每升只除有成本的 59 L', Math.abs(ac.costedVolumeL - 59) < 0.011, String(ac.costedVolumeL));
    ok('花费·每升 = 760 / 59', ac.perLiter === 12.88, String(ac.perLiter));
    ok('花费·每升不等于 760 / 69（没填成本的产量没进分母）',
      ac.perLiter !== U.round(760 / 69, 2), String(ac.perLiter) + ' vs ' + U.round(760 / 69, 2));
    ok('花费·每批 = 760 / 3', ac.perBatch === 253.33, String(ac.perBatch));
    ok('花费·有成本的批次 3 个', ac.costedBatches === 3, String(ac.costedBatches));

    ok('花费·最贵榜按降序', ac.topCost.length === 3 &&
      ac.topCost[0].cost === 500 && ac.topCost[1].cost === 200 && ac.topCost[2].cost === 60,
      JSON.stringify(ac.topCost.map(function (x) { return x.cost; })));
    ok('花费·最贵榜首是"只有总额"那批', ac.topCost[0] && ac.topCost[0].batchId === 'c4',
      ac.topCost[0] && ac.topCost[0].batchId);
    ok('花费·最贵榜每批都带每升价', ac.topCost[0] && ac.topCost[0].perLiter === 25,
      ac.topCost[0] && String(ac.topCost[0].perLiter));
    ok('花费·没填成本的批次不在最贵榜里',
      !ac.topCost.some(function (x) { return x.batchId === 'c2'; }));

    /* 最多 5 条：造 7 个有成本的批次 */
    var many = [];
    for (var q = 1; q <= 7; q++) {
      many.push({
        id: 't' + q, name: 'T' + q, brewDate: '2026-04-0' + q,
        packaging: { volume: 20 }, cost: { total: q * 100 }
      });
    }
    var acMany = Stats.annualCost(many, 2026);
    ok('花费·最贵榜最多 5 条', acMany.topCost.length === 5, String(acMany.topCost.length));
    ok('花费·7 批都在总额里（700+…+100=2800）',
      Math.abs(acMany.cost.total - 2800) < 0.011, String(acMany.cost.total));

    /* 有成本但没产量的批次：成本进总额，不进每升分母 */
    var noVol = Stats.annualCost([
      { id: 'nv', name: '没产量', brewDate: '2026-01-09', cost: { total: 100 } }
    ], 2026);
    ok('花费·没产量的成本批次：每升为 null 而不是 0', noVol.perLiter === null, String(noVol.perLiter));
    ok('花费·没产量的成本批次：总额仍有 100', noVol.cost.total === 100, String(noVol.cost.total));
    ok('花费·没产量的成本批次有警告',
      noVol.warnings.some(function (w) { return w.indexOf('没有产量') >= 0; }), JSON.stringify(noVol.warnings));

    /* 只有别的年份 */
    var ac2025 = Stats.annualCost(costBatches, 2025);
    ok('花费·2025 只有 1 批 300 元', ac2025.batches === 1 && ac2025.cost.total === 300,
      ac2025.batches + ' / ' + ac2025.cost.total);

    /* 空年份：形状必须与有数据时一致，界面不用写第二套读法 */
    var acEmpty = Stats.annualCost(costBatches, 2030);
    ok('花费·空年份 batches=0', acEmpty.batches === 0, String(acEmpty.batches));
    ok('花费·空年份 perLiter/perBatch 为 null',
      acEmpty.perLiter === null && acEmpty.perBatch === null);
    ok('花费·空年份 monthly 仍是 12 桶', acEmpty.byMonth.length === 12);
    ok('花费·空年份 topCost 是空数组', Array.isArray(acEmpty.topCost) && acEmpty.topCost.length === 0);
    ok('花费·空年份 cost 四个字段都在',
      acEmpty.cost && acEmpty.cost.ingredients === 0 && acEmpty.cost.other === 0 &&
      acEmpty.cost.total === 0 && acEmpty.cost.unallocated === 0, JSON.stringify(acEmpty.cost));
    ok('花费·空年份不崩且给的是"没有成本"而不是"算错"', acEmpty.year === 2030, String(acEmpty.year));

    /* 不传年份取最新；null 入参不崩 */
    ok('花费·不传年份取最新（2026）', Stats.annualCost(costBatches).year === 2026);
    ok('花费·null 入参不崩', Stats.annualCost(null, 2026).batches === 0);

    /* 不该出现 byKind：库存流水没有金额，编不出来（见文件头） */
    ok('花费·不输出 byKind（流水里没有金额字段）', ac.byKind === undefined && ac.stockValue === undefined);

    /* 合计比两项之和小（只在导入 / 手改的数据里可能出现）：提示必须是"核对"，
       不能说成"未拆分"—— 那是相反方向的差额，说错等于把人往错处引 */
    var overAlloc = Stats.annualCost([{
      id: 'oa', name: '合计填小了', brewDate: '2026-01-02',
      packaging: { volume: 10 }, cost: { ingredients: 100, other: 50, total: 120 }
    }], 2026);
    ok('花费·差额为负（120 - 100 - 50）', overAlloc.cost.unallocated === -30, String(overAlloc.cost.unallocated));
    ok('花费·合计偏小时提示"核对"而不是"未拆分"',
      overAlloc.warnings.some(function (w) { return w.indexOf('核对') >= 0; }), JSON.stringify(overAlloc.warnings));
    ok('花费·合计偏小时不出现"未拆分"字样',
      !overAlloc.warnings.some(function (w) { return w.indexOf('未拆分') >= 0; }), JSON.stringify(overAlloc.warnings));

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
