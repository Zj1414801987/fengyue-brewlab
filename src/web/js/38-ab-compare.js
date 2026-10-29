/* ============================================================================
 * 风月酿研所 — 38 多批次 A/B 对比（A/B Compare）
 * ----------------------------------------------------------------------------
 * 职责：把 2–4 个批次的发酵记录对齐到同一张图所需的坐标系，并把"设计与实测"
 *       分成两列给出。——这两件事都是算法，不该埋在画图的 DOM 代码里。
 *
 * 四条口径（每一条都有代价，写在这里是为了以后不要再吵一遍）：
 *   1. **X 轴是「距接种天数」，不是绝对日期**。跨月批次放在日期轴上会挤成一团。
 *      t0 取该批次自己的第一个读数（通常就是接种当天）。
 *   2. **温度只给第一条序列**。四条温度线叠在一起等于没有。其余序列的 tempC
 *      一律置 null，轴范围仍按全部批次算——把这条约束放进数据而不是界面，
 *      界面就没有机会"不小心"画出四条温度线。
 *   3. **设计与实测分两列**（planned / actual），不合并。46 号的批次状态机吃过
 *      混口径的亏：一个数既像设计又像实测，最后谁都不信。
 *   4. **缺读数不补 0**。0 会让曲线掉到地板，看起来像发酵失败。缺就是空点 + gaps。
 *
 * 纯度：只吃入参、只吐返回值。不读 Store / DOM，不取当前时间。
 *
 * 前置依赖：00-core（可选，只用 Util.round）
 * 加载位置：应在 js/35-batch.js 之后、js/40-ui-shell.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var ABCompare = BREW.ABCompare = {};

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

  var MAX_SERIES = 4;
  var MIN_SERIES = 2;
  var GAP_DAYS = 3;            /* 相邻两个读数间隔超过 3 天才算缺口：家酿常两三天测一次，
                                  阈值取 2 会让正常取样节奏全变成"缺口" */
  var DAY_MS = 86400000;

  function num(v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  }

  function statusOf(b) {
    var s = String((b && b.status) || '');
    if (BREW.Config && typeof BREW.Config.normalizeStatus === 'function') {
      return BREW.Config.normalizeStatus(s);
    }
    return s;
  }

  function batchName(b, i) {
    var snap = (b && b.recipeSnapshot) || {};
    return (b && b.name) || snap.name || ('批次 ' + (i + 1));
  }

  function sortedReadings(b) {
    var arr = (b && Array.isArray(b.readings)) ? b.readings : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (!r) continue;
      var t = new Date(r.at).getTime();
      if (!isFinite(t)) continue;
      out.push(r);
    }
    out.sort(function (a, b2) { return new Date(a.at).getTime() - new Date(b2.at).getTime(); });
    return out;
  }

  /* ======================================================================
   * 一、对齐到"距接种天数"
   * ----------------------------------------------------------------------
   * @param {Array} batches 2–4 个批次（多了截断并警告）
   * @returns {{
   *   series:Array<{batchId,name,points:Array<{day,sg,tempC,ph}>,days,finished,gaps}>,
   *   xMax:number, yRange:{min,max}|null, tempRange:{min,max}|null,
   *   warnings:string[]
   * }}
   * ====================================================================*/
  ABCompare.align = function (batches) {
    var all = Array.isArray(batches) ? batches.filter(function (b) { return !!b; }) : [];
    var warnings = [];

    if (all.length < MIN_SERIES) {
      warnings.push('至少选择两个批次才能对比（当前 ' + all.length + ' 个）');
    }
    if (all.length > MAX_SERIES) {
      warnings.push('最多同时对比 ' + MAX_SERIES + ' 个批次，多出的已忽略');
      all = all.slice(0, MAX_SERIES);
    }

    var series = [];
    var xMax = 0;
    var sgMin = null, sgMax = null;
    var tMin = null, tMax = null;

    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      var rs = sortedReadings(b);
      var points = [];
      var gaps = [];
      var t0 = rs.length ? new Date(rs[0].at).getTime() : 0;

      for (var j = 0; j < rs.length; j++) {
        var r = rs[j];
        var t = new Date(r.at).getTime();
        var day = U.round((t - t0) / DAY_MS, 1);
        var sg = num(r.sg, null);

        /* 温度轴范围按所有批次算，但只有第一条序列带温度值 */
        var tp = num(r.tempC, null);
        if (tp !== null) {
          if (tMin === null || tp < tMin) tMin = tp;
          if (tMax === null || tp > tMax) tMax = tp;
        }

        if (sg === null) {
          /* 只有温度没有比重的点：不进曲线，但仍要影响温度轴 */
          continue;
        }

        points.push({
          day: day,
          sg: U.round(sg, 3),
          tempC: i === 0 ? tp : null,
          ph: num(r.ph, null) === null ? null : U.round(num(r.ph, 0), 2)
        });

        if (sgMin === null || sg < sgMin) sgMin = sg;
        if (sgMax === null || sg > sgMax) sgMax = sg;
      }

      /* 缺口：相邻两个有效点间隔 > GAP_DAYS。UI 用它在曲线上画虚线 */
      for (var g = 1; g < points.length; g++) {
        var d = points[g].day - points[g - 1].day;
        if (d > GAP_DAYS) {
          gaps.push({
            fromDay: points[g - 1].day,
            toDay: points[g].day,
            days: U.round(d, 1)
          });
        }
      }

      var days = points.length ? points[points.length - 1].day : 0;
      if (days > xMax) xMax = days;

      if (!points.length) {
        warnings.push('「' + batchName(b, i) + '」没有可用的比重读数，曲线为空（不要用 0 填充）');
      }

      series.push({
        batchId: String((b && b.id) || ('#' + i)),
        name: batchName(b, i),
        points: points,
        days: days,
        finished: isFinished(b, points),
        gaps: gaps
      });
    }

    return {
      series: series,
      xMax: U.round(xMax, 1),
      yRange: (sgMin === null) ? null : {
        min: U.round(Math.max(0.99, sgMin - 0.003), 3),
        max: U.round(sgMax + 0.003, 3)
      },
      tempRange: (tMin === null) ? null : {
        min: U.round(tMin - 1, 1),
        max: U.round(tMax + 1, 1)
      },
      warnings: warnings
    };
  };

  /** 发酵是否结束：状态已完成，或最后两个点比重基本不动 */
  function isFinished(b, points) {
    var st = statusOf(b);
    if (st === 'done' || st === 'package') return true;
    if (points.length < 2) return false;
    var last = points[points.length - 1].sg;
    var prev = points[points.length - 2].sg;
    return Math.abs(last - prev) <= 0.002;
  }

  /* ======================================================================
   * 二、指标并排（设计与实测分列）
   * ----------------------------------------------------------------------
   * @param {Array} batches 批次数组（与 align 同序）
   * @param {Array|object} calcs  每个批次的 Calc.calcRecipe 结果：数组按同序，
   *                              或 {batchId: calc} 的映射；缺就只给实测值
   * @returns {{rows:Array, summary:object}}
   * ====================================================================*/
  var ROWS = [
    { key: 'og', label: 'OG', unit: '', d: 3, better: 'none' },
    { key: 'fg', label: 'FG', unit: '', d: 3, better: 'none' },
    { key: 'abv', label: 'ABV', unit: '%', d: 2, better: 'none' },
    { key: 'attenuation', label: '实测表观衰减', unit: '%', d: 1, better: 'higher' },
    { key: 'ibu', label: 'IBU', unit: '', d: 1, better: 'none' },
    { key: 'srm', label: 'SRM', unit: '', d: 1, better: 'none' },
    { key: 'peakTemp', label: '峰值温度', unit: '°C', d: 1, better: 'none' }
  ];

  function calcFor(b, i, calcs) {
    if (!calcs) return null;
    if (Array.isArray(calcs)) return calcs[i] || null;
    if (typeof calcs === 'object' && b && b.id && calcs[b.id]) return calcs[b.id];
    return null;
  }

  /** 从批次自身推出实测值（不依赖 Batch.analyze，保持纯函数） */
  function actualOf(b) {
    var ac = (b && b.actual) || {};
    var rs = sortedReadings(b);
    var firstSg = null, lastSg = null, peak = null;

    for (var i = 0; i < rs.length; i++) {
      var sg = num(rs[i].sg, null);
      if (sg !== null) {
        if (firstSg === null) firstSg = sg;
        lastSg = sg;
      }
      var tp = num(rs[i].tempC, null);
      if (tp !== null && (peak === null || tp > peak)) peak = tp;
    }

    var og = num(ac.og, null);
    if (og === null) og = firstSg;
    var fg = num(ac.fg, null);
    if (fg === null) fg = lastSg;

    var abv = null, att = null;
    if (og !== null && fg !== null && og > 1.000) {
      abv = (og - fg) * 131.25;
      att = (og - fg) / (og - 1.000) * 100;
    }

    return { og: og, fg: fg, abv: abv, attenuation: att, peakTemp: peak };
  }

  ABCompare.metrics = function (batches, calcs) {
    var list = Array.isArray(batches) ? batches.filter(function (b) { return !!b; }).slice(0, MAX_SERIES) : [];
    var warnings = [];

    var rows = ROWS.map(function (def) {
      var values = [];
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        var snap = (b && b.recipeSnapshot) || {};
        var calc = calcFor(b, i, calcs);
        var act = actualOf(b);

        var planned = null, actual = null;

        if (def.key === 'peakTemp') {
          planned = num(snap.fermentTemp, null);
          actual = act.peakTemp;
        } else if (def.key === 'ibu' || def.key === 'srm') {
          /* 这两项没有便携的实测手段：实际值恒为 null，只对比设计值 */
          planned = calc ? num(calc[def.key], null) : num(snap[def.key], null);
          actual = null;
        } else {
          planned = calc ? num(calc[def.key], null) : null;
          if (planned === null) planned = num(snap[def.key], null);
          actual = act[def.key];
        }

        var delta = null, pct = null;
        if (planned !== null && actual !== null) {
          delta = U.round(actual - planned, def.d);
          if (planned !== 0) pct = U.round(delta / planned * 100, 1);
        }

        values.push({
          batchId: String((b && b.id) || ('#' + i)),
          planned: planned === null ? null : U.round(planned, def.d),
          actual: actual === null ? null : U.round(actual, def.d),
          delta: delta,
          deltaPct: pct
        });
      }

      return {
        key: def.key,
        label: def.label,
        unit: def.unit,
        better: def.better,
        values: values
      };
    });

    if (!list.length) warnings.push('没有可对比的批次');
    if (!calcs) warnings.push('没有传入设计侧的计算结果（calcs），设计列只有快照里有的那几项');

    /* 表观衰减最高的那批（"哪一锅发得最彻底"是这个表最常被问的问题） */
    var bestId = null, bestVal = null;
    var attRow = rows.filter(function (r) { return r.key === 'attenuation'; })[0];
    if (attRow) {
      attRow.values.forEach(function (v) {
        if (v.actual === null) return;
        if (bestVal === null || v.actual > bestVal) { bestVal = v.actual; bestId = v.batchId; }
      });
    }

    return {
      rows: rows,
      summary: {
        batchCount: list.length,
        rowCount: rows.length,
        bestAttenuation: bestId,
        bestAttenuationValue: bestVal,
        warnings: warnings
      }
    };
  };

  /* ======================================================================
   * 自检
   * ====================================================================*/
  ABCompare.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    var D0 = 1760000000000;
    var day = function (n) { return D0 + n * DAY_MS; };

    var bA = {
      id: 'bA', name: 'A 批次', status: 'done',
      recipeSnapshot: { name: 'IPA', batchSize: 20, og: 1.056, fg: 1.011, ibu: 45, srm: 6, fermentTemp: 19, efficiency: 72 },
      actual: { og: 1.058, fg: 1.012 },
      readings: [
        { at: day(0), sg: 1.058, tempC: 19 },
        { at: day(1), sg: 1.040, tempC: 21 },
        { at: day(3), sg: 1.020, tempC: 22 },
        { at: day(6), sg: 1.014, tempC: 21 },
        { at: day(9), sg: 1.012, tempC: 20 }
      ]
    };
    var bB = {
      id: 'bB', name: 'B 批次', status: 'ferment',
      recipeSnapshot: { name: 'IPA', batchSize: 20, og: 1.056, fg: 1.011, ibut: 45, fermentTemp: 20 },
      actual: {},
      readings: [
        { at: day(0), sg: 1.054, tempC: 20 },
        { at: day(2), sg: 1.030, tempC: 23 },
        /* 中间断了 6 天 */
        { at: day(8), sg: 1.016, tempC: 22 }
      ]
    };

    /* 1. 对齐 */
    var a = ABCompare.align([bA, bB]);
    ok('两条序列', a.series.length === 2, String(a.series.length));
    ok('A 有 5 个点', a.series[0].points.length === 5, String(a.series[0].points.length));
    ok('day 从 0 起', a.series[0].points[0].day === 0);
    ok('第 2 个点 day = 1', a.series[0].points[1].day === 1, String(a.series[0].points[1].day));
    ok('最后一天 = 9', a.series[0].days === 9, String(a.series[0].days));
    ok('xMax = 9', a.xMax === 9, String(a.xMax));

    /* 2. 温度只给第一条 */
    ok('A 带温度', a.series[0].points[0].tempC === 19, String(a.series[0].points[0].tempC));
    ok('B 的温度置 null', a.series[1].points.every(function (p) { return p.tempC === null; }));
    ok('温度轴仍覆盖全部批次', a.tempRange && a.tempRange.max >= 23, JSON.stringify(a.tempRange));

    /* 3. 缺口 */
    ok('B 有 1 个缺口', a.series[1].gaps.length === 1, JSON.stringify(a.series[1].gaps));
    ok('缺口天数 = 6', a.series[1].gaps[0].days === 6, String(a.series[1].gaps[0].days));
    ok('A 无缺口', a.series[0].gaps.length === 0);

    /* 4. yRange 覆盖所有比重 */
    ok('yRange 下界 <= 1.012', a.yRange.min <= 1.012, JSON.stringify(a.yRange));
    ok('yRange 上界 >= 1.058', a.yRange.max >= 1.058, JSON.stringify(a.yRange));

    /* 5. 完成判定 */
    ok('A 已完成（状态 done）', a.series[0].finished === true);
    ok('B 未完成', a.series[1].finished === false);

    /* 6. 指标并排 */
    var calcs = [{ og: 1.056, fg: 1.011, abv: 5.9, attenuation: 80.4, ibu: 45, srm: 6 }];
    var m = ABCompare.metrics([bA, bB], calcs);
    var ogRow = m.rows.filter(function (r) { return r.key === 'og'; })[0];
    ok('OG 设计/实测分列', ogRow.values[0].planned === 1.056 && ogRow.values[0].actual === 1.058,
      JSON.stringify(ogRow.values[0]));
    ok('OG Δ = +0.002', Math.abs(ogRow.values[0].delta - 0.002) < 1e-9, String(ogRow.values[0].delta));
    var attRow = m.rows.filter(function (r) { return r.key === 'attenuation'; })[0];
    ok('衰减实测由 OG/FG 推', Math.abs(attRow.values[0].actual - 79.3) < 0.2, String(attRow.values[0].actual));
    var ibuRow = m.rows.filter(function (r) { return r.key === 'ibu'; })[0];
    ok('IBU 没有实测值', ibuRow.values[0].actual === null && ibuRow.values[0].planned === 45);
    ok('峰值温度来自读数', m.rows.filter(function (r) { return r.key === 'peakTemp'; })[0].values[0].actual === 22);
    ok('找出衰减最高的一批', m.summary.bestAttenuation === 'bA', String(m.summary.bestAttenuation));

    /* 7. 脏输入 */
    var empty = ABCompare.align([]);
    ok('空数组：0 序列 + 警告', empty.series.length === 0 && empty.warnings.length > 0);
    ok('空数组 yRange 为 null', empty.yRange === null);
    var one = ABCompare.align([bA]);
    ok('只给一个批次要警告', one.warnings.some(function (w) { return /至少/.test(w); }));
    var noRead = ABCompare.align([bA, { id: 'x', name: '空批次', readings: [] }]);
    ok('无读数批次：points 为空', noRead.series[1].points.length === 0);
    ok('无读数批次：不补 0', noRead.series[1].days === 0);
    ok('无读数有警告', noRead.warnings.some(function (w) { return /没有可用的比重读数/.test(w); }));
    ok('null 入参不崩', ABCompare.align(null).series.length === 0);
    ok('metrics 空入参不崩', ABCompare.metrics(null, null).rows.length === 7);

    /* 8. 超过 4 条要截断 */
    var five = ABCompare.align([bA, bB, bA, bB, bA]);
    ok('超过 4 条被截断', five.series.length === 4, String(five.series.length));
    ok('截断有警告', five.warnings.some(function (w) { return /最多/.test(w); }));

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
