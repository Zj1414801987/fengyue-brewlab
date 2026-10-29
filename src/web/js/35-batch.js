/* ============================================================================
 * 风月酿研所 — 35 批次模型（Batch）
 * ----------------------------------------------------------------------------
 * 职责：酿造批次的实际记录、测量点管理、发酵进程分析、设计与实测的偏差诊断。
 * 依赖：00-core / 05-units / 20-calc / 30-recipe
 *
 * 核心设计：**配方快照**
 *   批次创建时，把当时的配方关键信息完整复制一份存进 batch.recipeSnapshot。
 *   之后无论用户怎么改原配方，这个批次的数据都不会变。
 *   原因很实际：你三个月后回看"那批酒为什么苦"，需要的是当时用的配方，
 *   而不是现在被改过三版的配方。
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  var U = BREW.Util;
  var Units = BREW.Units;

  var Batch = BREW.Batch = {};

  /* 状态机：顺序推进，也允许跳回（比如失败） */
  Batch.STATUS_FLOW = ['plan', 'mash', 'lauter', 'boil', 'chill', 'ferment', 'dryhop', 'mature', 'package', 'done'];

  /* ======================================================================
   * 一、新建批次
   * ====================================================================*/
  Batch.blank = function (recipe) {
    var now = Date.now();
    var snap = null;
    var calc = null;

    if (recipe) {
      calc = BREW.Calc.calcRecipe(recipe);
      snap = {
        recipeId: recipe.id,
        name: recipe.name,
        styleId: recipe.styleId,
        styleName: (BREW.DB.getStyle && recipe.styleId && BREW.DB.getStyle(recipe.styleId))
          ? BREW.DB.getStyle(recipe.styleId).name : null,
        batchSize: recipe.batchSize,
        efficiency: recipe.efficiency,
        og: U.round(calc.og, 3),
        fg: U.round(calc.fg, 3),
        abv: calc.abv,
        ibu: calc.ibu,
        srm: calc.srm,
        /* 原料清单也存一份，用于"实际用量 vs 设计用量"对照 */
        fermentables: (recipe.fermentables || []).map(function (f) {
          return { name: f.name, amount: f.amount, unit: f.unit, cat: f.cat, ppg: f.ppg, lov: f.lov };
        }),
        hops: (recipe.hops || []).map(function (h) {
          return { name: h.name, amount: h.amount, unit: h.unit, aa: h.aa, stage: h.stage, time: h.time };
        }),
        yeasts: (recipe.yeasts || []).map(function (y) {
          return { name: y.name, amount: y.amount, att: y.att, type: y.type };
        }),
        adjuncts: (recipe.adjuncts || []).map(function (a) {
          return { name: a.name, amount: a.amount, unit: a.unit, stage: a.stage };
        }),
        water: U.clone(recipe.water || {}),
        mashSteps: U.clone((recipe.mash && recipe.mash.steps) || []),
        fermentTemp: recipe.fermentTemp,
        carbonation: U.clone(recipe.carbonation || {}),
        /* 煮沸时长（v1.2 补）。
           没有它，酿造日看板只能拿 max(hop.time) 去猜，而那是"最后一次投花
           的时间"——60 分钟苦花 + 5 分钟回旋，猜出来是 5 或 20，不是 60。
           快照是整体拷贝，加字段不需要改 normalizeBatch。 */
        boilTime: recipe.boilTime,
        /* 计算明细也快照，用于偏差归因 */
        expectedPreBoil: calc.preBoilVolume,
        expectedMashWater: calc.mashWater,
        expectedSpargeWater: calc.spargeWater,
        snapshotAt: now
      };
    }

    return {
      id: U.uid('b'),
      batchNo: Batch.nextBatchNo(),
      recipeId: recipe ? recipe.id : null,
      recipeSnapshot: snap,

      brewDate: U.today(),
      /* 酿造日看板状态（v1.2）。null = 还没开始。
         只为"真的点过开始酿造"的批次建对象，不做空壳：15 个批次 × 866 字符
         的空壳是白烧 13 K，而这些批次的清单永远用不上。 */
      brewday: null,
      status: 'plan',
      statusHistory: [{ status: 'plan', at: now }],

      /* 实测值（用户填） */
      actual: {
        og: null,
        fg: null,
        preBoilVolume: null,
        postBoilVolume: null,
        mashPh: null,
        boilPh: null,
        efficiency: null,
        mashWaterUsed: null,
        spargeWaterUsed: null,
        grainWeight: null,
        notes: ''
      },

      /* 测量点序列 */
      readings: [],

      /* 装瓶 */
      packaging: {
        date: null,
        volume: null,
        method: 'bottle',        /* bottle | keg */
        primingSugarType: 'sucrose',
        primingSugarGrams: null,
        co2Vol: null,
        bottles: null,
        notes: ''
      },

      /* 品鉴（BJCP 简化评分） */
      tasting: {
        date: null,
        aroma: null,        /* 0-12 */
        appearance: null,   /* 0-3 */
        flavor: null,       /* 0-20 */
        mouthfeel: null,    /* 0-5 */
        overall: null,      /* 0-10 */
        total: null,
        notes: '',
        /* BJCP 子项细则（v1.2）。null = 用户还没去打分。
           上面五个 section 分是**权威值**，detail 里的子项只是提示，
           不参与求和（子项相加 ≠ 直觉分是常态，程序不裁决）。
           键名由 team-lead 冻结为 detail（设计稿里曾叫 bjcp，以 detail 为准）。
           v1.2 期间一度计划改名 brewDay / tasting.bjcp，后因协调成本大于收益撤回；
           以 brewday / tasting.detail 为准，两个名字不要并存。 */
        detail: null
      },

      /* 失败档案（v1.4 · 负样本）。
         与 brewday 的处理相反：这里**永远给一份空壳**，不做"没失败就不建"。
         因为它是失败当时的记录容器——状态一变成 failed，界面要立刻能填，
         不该先判断字段在不在；而且三个字段全空就等于"没记"，读侧用
         Batch.failureOf() 会把它折成 null，不会污染聚合结果。 */
      failure: { type: null, note: '', learned: '' },

      cost: { ingredients: null, other: null, total: null },
      notes: '',
      createdAt: now,
      updatedAt: now
    };
  };

  /** 批次号：按日期 + 序号，如 20261022-01
   *  v1.2 修正：取"当天已用最大序号 + 1"，不是"数条数 + 1"。
   *  旧实现在删过批次后会撞号——实测建 01/02/03、删掉 02、再建又得到 03，
   *  于是两锅酒共用一个批次号，看板/报告/对比全按它做标识。 */
  Batch.nextBatchNo = function () {
    var prefix = U.today().replace(/-/g, '');
    var list = (BREW.Store && BREW.Store.listBatches) ? BREW.Store.listBatches() : [];
    var max = 0;
    for (var i = 0; i < list.length; i++) {
      var no = list[i] && list[i].batchNo;
      if (!no || String(no).indexOf(prefix + '-') !== 0) continue;
      var n = parseInt(String(no).slice(prefix.length + 1), 10);
      if (isFinite(n) && n > max) max = n;
    }
    return prefix + '-' + String(max + 1).padStart(2, '0');
  };

  /** 批次号唯一性（v1.2 · D16）。
   *  `nextBatchNo()` 只负责"算一个号"，它管不了"两次创建算到同一个号"：
   *  `Batch.blank()` 在**对象创建那一刻**就算号，而对象要等用户点确认才保存。
   *  保存之前连开两个，两个对象会拿到同一个号，先后落库就是两条重复。
   *  真正能保证唯一的地方只有写入边界，所以这里做三件事：
   *    1. 没有号 → 现算一个；
   *    2. 有号但**和别的批次撞了** → 重新分配（只发生在号从来没唯一过的情况）；
   *    3. 有号且唯一 → **一个字都不动**（"生成后不再变"，改 brewDate 也不重算）。
   *  @returns {{changed:boolean, from:string|null, to:string}} */
  Batch.ensureBatchNo = function (b, list) {
    if (!b) return { changed: false, from: null, to: '' };
    list = Array.isArray(list) ? list : [];
    var taken = {};
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o === b) continue;
      if (b.id && o.id === b.id) continue;     /* 自己不算冲突（改一条读数再存） */
      if (o.batchNo) taken[String(o.batchNo)] = 1;
    }
    var cur = b.batchNo ? String(b.batchNo) : '';
    if (cur && !taken[cur]) return { changed: false, from: cur, to: cur };

    var from = cur || null;
    var next = Batch.nextBatchNo();
    var guard = 0;
    while (taken[next] && guard++ < 99) {
      /* nextBatchNo 取的是"当天最大 +1"，正常不会撞；撞了说明表里混进了
         同日期的外来号（导入/多标签页），继续往后挪一个，别停在这里 */
      var parts = next.split('-');
      var n = parseInt(parts[1], 10);
      next = parts[0] + '-' + String((isFinite(n) ? n : 0) + 1).padStart(2, '0');
    }
    b.batchNo = next;
    return { changed: true, from: from, to: next };
  };

  /* ======================================================================
   * 一点五、状态枚举归一（v1.2）
   * ----------------------------------------------------------------------
   * 唯一事实来源是 Config.STAGES 的 id（plan/mash/…/done/failed），因为
   * STATUS_FLOW / stageDurations / toTextReport 已经依赖它。
   * 46 早期自造的 planned/mashing/…/finished 一律映射过来。
   *
   * 这个函数要给两处用：
   *   ① 迁移时改写历史数据（一次性）
   *   ② **每次读 b.status 时兜底** —— 因为用户可能降级用旧版跑了一遍，
   *      旧版会把 'planned' 写回来，而 schemaVersion 已经是 2，不会再迁移。
   * ====================================================================*/
  Batch.normalizeStatus = function (v) {
    return BREW.Config.normalizeStatus(v);
  };

  /* ======================================================================
   * 二、状态流转
   * ====================================================================*/
  Batch.setStatus = function (b, status) {
    if (!b || !status) return b;
    /* 入参先归一：调用方可能还拿着 'fermenting' 这类旧值（历史代码/降级数据） */
    status = Batch.normalizeStatus(status);
    var valid = Batch.STATUS_FLOW.indexOf(status) >= 0 || status === 'failed';
    if (!valid) return b;
    if (Batch.normalizeStatus(b.status) === status) return b;

    b.status = status;
    b.statusHistory = b.statusHistory || [];
    b.statusHistory.push({ status: status, at: Date.now() });
    b.updatedAt = Date.now();

    /* 状态推进时自动补一个测量点提示（不自动填数据，留给用户） */
    if (BREW.Bus) BREW.Bus.emit('batchStatusChanged', { batchId: b.id, status: status });
    return b;
  };

  /** 状态中文名。
   *  注意：这里**只做别名映射**，不做 normalizeStatus 的兜底——因为
   *  readings[].stage 存的是中文（'发酵'/'煮沸'），走 normalizeStatus 会被
   *  洗成 'plan'，CSV 导出的"阶段"整列变成"计划中"。 */
  Batch.statusLabel = function (status) {
    if (!status) return '未知';
    var s = BREW.Config.STATUS_ALIAS[status] || status;
    var stages = BREW.Config.STAGES || [];
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].id === s) return stages[i].zh;
    }
    return status;      /* 认不出就原样返回（中文阶段名走这条） */
  };

  /* ======================================================================
   * 三、测量点
   * ----------------------------------------------------------------------
   * 一个测量点是"某一时刻的一次观测"：比重、温度、pH。
   * 这是整个记录模块的原子数据，后面所有分析都从它派生。
   * ====================================================================*/
  Batch.addReading = function (b, reading) {
    if (!b) return null;
    var r = {
      id: U.uid('rd'),
      ts: reading.ts || Date.now(),
      /* at 是 ISO 时间别名。
         UI 层普遍用 new Date(rd.at) 与 rd.at 做时间轴，和内部的 ts（时间戳）
         格式不同但对 Date 构造等价。两个都写，避免任何一侧读到 undefined。
         曾经因为只写 ts，界面把"已发酵天数"算成 0。 */
      at: null,
      stage: reading.stage || b.status || 'ferment',
      /* 比重可以做温度校正，存原始值与校正值两个 */
      sgRaw: reading.sg === undefined || reading.sg === null ? null : U.toNum(reading.sg, 1),
      sg: reading.sg === undefined || reading.sg === null ? null : U.toNum(reading.sg, 1),
      sampleTemp: reading.sampleTemp === undefined ? null : U.toNum(reading.sampleTemp, 20),
      tempC: reading.tempC === undefined ? null : U.toNum(reading.tempC, null),
      ph: reading.ph === undefined ? null : U.toNum(reading.ph, null),
      note: reading.note || ''
    };
    r.at = new Date(r.ts).toISOString();

    /* 如果给了样品温度与比重，自动做比重计温度校正 */
    if (r.sgRaw !== null && r.sampleTemp !== null && Math.abs(r.sampleTemp - 20) > 0.5) {
      r.sg = U.round(Units.correctHydrometer(r.sgRaw, r.sampleTemp, 20), 4);
      r.corrected = true;
    }

    b.readings = b.readings || [];
    b.readings.push(r);
    /* 保持时间顺序 */
    b.readings.sort(function (x, y) { return x.ts - y.ts; });
    b.updatedAt = Date.now();

    if (BREW.Bus) BREW.Bus.emit('readingAdded', { batchId: b.id, reading: r });
    return r;
  };

  Batch.removeReading = function (b, id) {
    if (!b || !b.readings) return false;
    var before = b.readings.length;
    b.readings = b.readings.filter(function (r) { return r.id !== id; });
    b.updatedAt = Date.now();
    return b.readings.length < before;
  };

  /* ======================================================================
   * 四、发酵进程分析
   * ----------------------------------------------------------------------
   * 这是"数据"变成"洞察"的地方。用户记了一堆数字，软件的职责是告诉他：
   *   · 现在到哪一步了
   *   · 是不是停滞了
   *   · 大概什么时候能装瓶
   *   · 和设计差多少
   * ====================================================================*/

  /** 取比重序列（只保留有 sg 的点，按时间排序） */
  function sgSeries(b) {
    return (b.readings || [])
      .filter(function (r) { return r.sg !== null && r.sg !== undefined && isFinite(r.sg); })
      .map(function (r) { return { t: r.ts, sg: r.sg, stage: r.stage, tempC: r.tempC }; })
      .sort(function (a, c) { return a.t - c.t; });
  }

  Batch.sgSeries = sgSeries;

  /**
   * 发酵进程分析
   * @returns {object} 含当前状态、衰减度、停滞判断、预测 FG、预计完成时间
   */
  Batch.analyze = function (b) {
    var snap = b.recipeSnapshot || {};
    var series = sgSeries(b);
    var out = {
      hasData: series.length > 0,
      points: series.length,
      days: 0,
      currentSg: null,
      currentTemp: null,
      measuredOg: null,
      measuredFg: null,
      apparentAttenuation: null,
      abv: null,
      vsDesign: null,
      stalled: false,
      stallReason: '',
      prediction: null,
      tempStats: null,
      timeline: []
    };

    /* 实测 OG：优先用 actual.og，其次用第一个比重点 */
    if (b.actual && b.actual.og) out.measuredOg = U.toNum(b.actual.og, null);
    else if (series.length > 0) out.measuredOg = series[0].sg;

    /* 实测 FG：优先用 actual.fg，其次用最后一个点 */
    if (b.actual && b.actual.fg) out.measuredFg = U.toNum(b.actual.fg, null);
    else if (series.length > 0) out.measuredFg = series[series.length - 1].sg;

    if (series.length > 0) {
      var first = series[0], last = series[series.length - 1];
      out.currentSg = last.sg;
      out.currentTemp = last.tempC;
      out.days = U.round((last.t - first.t) / 86400000, 1);
      out.startedAt = first.t;
      out.lastReadingAt = last.t;
    }

    /* 表观衰减度 */
    if (out.measuredOg && out.currentSg && out.measuredOg > 1.000) {
      out.apparentAttenuation = U.round(
        (out.measuredOg - out.currentSg) / (out.measuredOg - 1.000) * 100, 1);
      out.abv = U.round((out.measuredOg - out.currentSg) * 131.25, 2);
    }

    /* 与设计值对比 */
    if (snap.og) {
      var ogDiff = out.measuredOg ? U.round((out.measuredOg - snap.og) * 1000, 0) : null;
      var effActual = null;
      if (out.measuredOg && snap.batchSize) {
        /* 反推实际效率：实测点数 / 理论最大点数 */
        var theoreticalPts = 0;
        (snap.fermentables || []).forEach(function (f) {
          var isSugar = (f.cat === 'sugar' || f.cat === 'extract');
          if (isSugar) return;      /* 糖不参与效率 */
          theoreticalPts += (f.ppg || 0) * (f.amount || 0) * 8.3454 / (snap.batchSize || 20);
        });
        if (theoreticalPts > 0) {
          effActual = U.round((out.measuredOg - 1) * 1000 / theoreticalPts * 100, 1);
        }
      }
      out.vsDesign = {
        ogDesign: snap.og,
        ogActual: out.measuredOg,
        ogDiffPoints: ogDiff,
        ogDiffPct: out.measuredOg ? U.round((out.measuredOg - snap.og) / (snap.og - 1) * 100, 1) : null,
        efficiencyDesign: snap.efficiency,
        efficiencyActual: effActual,
        fgDesign: snap.fg,
        fgActual: out.measuredFg,
        ibuDesign: snap.ibu,
        verdict: null,
        advice: null
      };

      /* 归因建议 */
      if (ogDiff !== null) {
        if (ogDiff <= -8) {
          out.vsDesign.verdict = 'OG 明显低于设计';
          out.vsDesign.advice = '实际效率约 ' + (effActual || '?') + '%，比设定的 ' + snap.efficiency + '% 低。' +
            '常见原因：粉碎过粗、糖化温度偏低、洗糟不充分、糖化醪过稠。' +
            '**下次把糖化效率改成实测值**，配方才会准。';
        } else if (ogDiff >= 8) {
          out.vsDesign.verdict = 'OG 明显高于设计';
          out.vsDesign.advice = '实际效率约 ' + (effActual || '?') + '%。' +
            '可能是粉碎更细、洗糟更充分，或批次量少于计划（煮沸蒸发过多）。' +
            '如果批次量确实少了，酒会比设计更浓更烈。';
        } else {
          out.vsDesign.verdict = 'OG 与设计吻合';
          out.vsDesign.advice = '效率设定准确，可以继续用这个数值做后续配方。';
        }
      }
    }

    /* ---- 停滞检测 ---- */
    if (series.length >= 2) {
      var n = series.length;
      var lastPt = series[n - 1];
      var prevPt = series[n - 2];
      var gapHours = (lastPt.t - prevPt.t) / 3600000;
      var deltaPts = (lastPt.sg - prevPt.sg) * 1000;

      /* 停滞定义：间隔 ≥48h 且比重变化 <2 点，且还没到预期 FG */
      var targetFg = snap.fg || 1.010;
      var stillFar = lastPt.sg - targetFg > 0.004;

      if (gapHours >= 48 && Math.abs(deltaPts) < 2 && stillFar) {
        out.stalled = true;
        out.stallReason = '最近 ' + U.round(gapHours, 0) + ' 小时内比重只变了 ' + U.round(deltaPts, 1) +
          ' 点，但距预期 FG（' + U.fmtTime(0) + '）还有 ' + U.round((lastPt.sg - targetFg) * 1000, 0) + ' 点。';
        out.stallReason = '最近 ' + U.round(gapHours, 0) + ' 小时内比重只变了 ' +
          U.round(deltaPts, 1) + ' 点，但仍高于预期 FG 约 ' +
          U.round((lastPt.sg - targetFg) * 1000, 0) + ' 点。';
      }

      /* 连续两次读数完全不变（间隔 >72h）→ 很可能真的结束了 */
      if (gapHours >= 72 && Math.abs(deltaPts) < 1 && !stillFar) {
        out.readyToPackage = true;
        out.packageNote = '比重已稳定（' + U.round(gapHours, 0) + ' 小时无变化）且接近预期 FG，可以考虑装瓶。' +
          '**装瓶前请再确认一次**：两天内两次读数一致才安全。';
      }
    }

    /* ---- 预测最终比重（指数衰减拟合）----
       模型：SG(t) = FG∞ + (OG − FG∞) × exp(−k·t)
       用网格搜索找 (FG∞, k) 使残差平方和最小。
       优点：不依赖配方设定，纯从数据推断"它想去哪"。
       局限：数据点少于 4 个时不可靠；有"发酵暂停后重启"时会误判。 */
    if (series.length >= 4) {
      var t0 = series[0].t;
      var pts = series.map(function (p) {
        return { t: (p.t - t0) / 86400000, sg: p.sg };   /* 天为单位 */
      });
      var og = pts[0].sg;
      var lastSg = pts[pts.length - 1].sg;

      /* 物理约束下的 FG∞ 搜索范围。
         不加约束会出问题：数据尾段趋平时，SSE 对 FG∞ 很不敏感，
         拟合会一路漂到 1.000，给出"这锅酒会发到干透"的错误结论。
         约束依据：发酵不会在"昨天还降了 N 点"的情况下，接下来再降 2N 点以上。
         所以下界取 lastSg − max(6 点, 最后一段降幅 × 2)。 */
      var lastDelta = Math.abs(pts[pts.length - 1].sg - pts[pts.length - 2].sg) * 1000;
      var floorSpan = Math.max(0.006, lastDelta * 2 / 1000);
      var fgLowBound = Math.max(1.000, lastSg - floorSpan);

      var best = { fg: lastSg, k: 0.3, sse: Infinity };

      for (var fgTry = lastSg; fgTry >= fgLowBound - 1e-9; fgTry -= 0.001) {
        /* k 从 0.05 到 1.2，步长 0.02 */
        for (var kTry = 0.05; kTry <= 1.2; kTry += 0.02) {
          var sse = 0;
          for (var i = 0; i < pts.length; i++) {
            var pred = fgTry + (og - fgTry) * Math.exp(-kTry * pts[i].t);
            var e = pred - pts[i].sg;
            sse += e * e;
          }
          if (sse < best.sse) best = { fg: fgTry, k: kTry, sse: sse };
        }
      }

      /* 如果最优解贴在约束下界，说明数据本身指向"还会继续降"，
         但下界不允许，这时如实标注不确定性，而不是硬给一个数。 */
      var clamped = Math.abs(best.fg - fgLowBound) < 0.0005 && fgLowBound > 1.000 + 0.0005;

      var rms = Math.sqrt(best.sse / pts.length);

      /* 距离"还剩 1.5 个比重点"的时间。
         如果当前读数已经贴近预测 FG，直接给 0，不要返回 null（界面会显示"—"）。 */
      var daysToGo = 0;
      if (best.k > 0) {
        if (lastSg <= best.fg + 0.0015) {
          daysToGo = 0;
        } else {
          var ratio = 0.0015 / (og - best.fg);
          if (ratio > 0 && ratio < 1) {
            var tTarget = -Math.log(ratio) / best.k;
            daysToGo = U.round(Math.max(0, tTarget - pts[pts.length - 1].t), 1);
          }
        }
      }

      out.prediction = {
        fg: U.round(best.fg, 3),
        rate: U.round(best.k, 3),
        rms: U.round(rms * 1000, 2),     /* 残差（点数） */
        daysToGo: daysToGo,
        clamped: clamped,
        confidence: rms < 0.002 ? '较高' : (rms < 0.005 ? '中等' : '较低'),
        note: clamped
          ? '数据末段仍在明显下降，预测已触及合理下界；真实 FG 可能更低，建议再等 2–3 天取两次稳定读数'
          : (rms < 0.005
              ? '拟合良好，预测值可作参考'
              : '拟合残差偏大，说明发酵速率不规律（温度波动或有停滞），预测仅供参考')
      };
    }

    /* ---- 温度统计 ---- */
    var temps = (b.readings || [])
      .filter(function (r) { return r.tempC !== null && r.tempC !== undefined && isFinite(r.tempC); })
      .map(function (r) { return r.tempC; });
    if (temps.length > 0) {
      var min = Math.min.apply(null, temps);
      var max = Math.max.apply(null, temps);
      var sum = temps.reduce(function (a, c) { return a + c; }, 0);
      out.tempStats = {
        min: U.round(min, 1),
        max: U.round(max, 1),
        avg: U.round(sum / temps.length, 1),
        swing: U.round(max - min, 1),
        warning: (max - min) > 4
          ? '温度波动 ' + U.round(max - min, 1) + '°C 偏大。发酵期剧烈波动会产生杂醇与酯类失衡，' +
            '这是家酿最常见的风味缺陷来源之一'
          : null
      };
    }

    return out;
  };

  /* ======================================================================
   * 五、阶段耗时
   * ====================================================================*/
  Batch.stageDurations = function (b) {
    var hist = b.statusHistory || [];
    var out = [];
    for (var i = 0; i < hist.length - 1; i++) {
      var from = hist[i], to = hist[i + 1];
      out.push({
        status: from.status,
        label: Batch.statusLabel(from.status),
        hours: U.round((to.at - from.at) / 3600000, 1),
        days: U.round((to.at - from.at) / 86400000, 1)
      });
    }
    /* 最后一段到"现在" */
    if (hist.length > 0) {
      var last = hist[hist.length - 1];
      out.push({
        status: last.status,
        label: Batch.statusLabel(last.status),
        hours: U.round((Date.now() - last.at) / 3600000, 1),
        days: U.round((Date.now() - last.at) / 86400000, 1),
        ongoing: true
      });
    }
    return out;
  };

  /* ======================================================================
   * 六、品鉴评分（BJCP 简化版）
   * ----------------------------------------------------------------------
   * 满分 50：香气 12 + 外观 3 + 风味 20 + 口感 5 + 整体 10
   * ====================================================================*/
  Batch.calcTastingTotal = function (t) {
    if (!t) return null;
    var parts = [t.aroma, t.appearance, t.flavor, t.mouthfeel, t.overall];
    var hasAny = parts.some(function (v) { return v !== null && v !== undefined && isFinite(v); });
    if (!hasAny) return null;
    var total = 0;
    parts.forEach(function (v) { total += (isFinite(v) ? Number(v) : 0); });
    return U.round(total, 1);
  };

  Batch.tastingGrade = function (total) {
    if (total === null || total === undefined) return null;
    if (total >= 45) return { label: '优秀（可参赛获奖）', level: 'excellent' };
    if (total >= 38) return { label: '很好', level: 'great' };
    if (total >= 30) return { label: '良好', level: 'good' };
    if (total >= 21) return { label: '可接受，有缺陷', level: 'fair' };
    return { label: '有明显缺陷', level: 'poor' };
  };

  /* ======================================================================
   * 七、导出
   * ====================================================================*/

  /** 测量点导出为 CSV 文本。
   *  注意字段别名：UI 层归一化后的读数是 at / sg / tempC，
   *  引擎内部写的是 ts / sgRaw / sampleTemp。这里两套都认，
   *  否则从 46 导出的表会整列 Invalid Date、原始读数与样品温度空白。 */
  Batch.readingsToCSV = function (b) {
    var rows = [['时间', '阶段', '比重', '原始读数', '样品温度', '发酵温度', 'pH', '备注']];
    function isNil(v) { return v === null || v === undefined || v === ''; }

    (b.readings || []).forEach(function (r) {
      var at = r.ts || r.at;
      var sgRaw = isNil(r.sgRaw) ? r.sg : r.sgRaw;
      var sampleTemp = isNil(r.sampleTemp) ? r.tempC : r.sampleTemp;
      rows.push([
        at ? new Date(at).toLocaleString('zh-CN') : '',
        Batch.statusLabel(r.stage),
        isNil(r.sg) ? '' : r.sg,
        isNil(sgRaw) ? '' : sgRaw,
        isNil(sampleTemp) ? '' : sampleTemp,
        isNil(r.tempC) ? '' : r.tempC,
        isNil(r.ph) ? '' : r.ph,
        (r.note || '').replace(/"/g, '""')
      ]);
    });
    return rows.map(function (row) {
      return row.map(function (cell) {
        var s = String(cell === undefined || cell === null ? '' : cell);
        return /[",\n]/.test(s) ? '"' + s + '"' : s;
      }).join(',');
    }).join('\n');
  };

  /** 批次完整报告（纯文本，用于复制/打印） */
  Batch.toTextReport = function (b) {
    var a = Batch.analyze(b);
    var snap = b.recipeSnapshot || {};
    var lines = [];

    lines.push('═══════════════════════════════════════');
    lines.push('  风月酿研所 批次报告');
    lines.push('═══════════════════════════════════════');
    lines.push('');
    lines.push('批次号：' + b.batchNo);
    lines.push('配方：' + (snap.name || '—'));
    lines.push('风格：' + (snap.styleName || '—'));
    lines.push('酿造日期：' + b.brewDate);
    lines.push('状态：' + Batch.statusLabel(b.status));
    lines.push('批次量：' + (snap.batchSize || '—') + ' L');
    lines.push('');
    lines.push('─── 设计 vs 实测 ───');
    lines.push('OG：设计 ' + (snap.og || '—') + '  实测 ' + (a.measuredOg ? U.sg(a.measuredOg) : '—'));
    lines.push('FG：设计 ' + (snap.fg || '—') + '  实测 ' + (a.measuredFg ? U.sg(a.measuredFg) : '—'));
    lines.push('ABV：设计 ' + (snap.abv || '—') + '%  实测 ' + (a.abv ? a.abv + '%' : '—'));
    lines.push('IBU：设计 ' + (snap.ibu || '—'));
    lines.push('SRM：设计 ' + (snap.srm || '—'));
    lines.push('实测表观衰减：' + (a.apparentAttenuation !== null ? a.apparentAttenuation + '%' : '—'));

    if (a.vsDesign) {
      lines.push('');
      lines.push('─── 效率诊断 ───');
      lines.push('设定效率：' + a.vsDesign.efficiencyDesign + '%');
      lines.push('实际效率：' + (a.vsDesign.efficiencyActual !== null ? a.vsDesign.efficiencyActual + '%' : '—'));
      lines.push('结论：' + (a.vsDesign.verdict || '—'));
      if (a.vsDesign.advice) {
        lines.push('建议：' + a.vsDesign.advice);
      }
    }

    if (a.readings) {
      lines.push('');
      lines.push('─── 测量记录（' + (b.readings || []).length + ' 条）───');
      (b.readings || []).forEach(function (r) {
        lines.push('  ' + U.fmtTime(r.ts) + '  ' + Batch.statusLabel(r.stage) +
          '  比重 ' + (r.sg !== null ? U.sg(r.sg) : '—') +
          '  温度 ' + (r.tempC !== null ? r.tempC + '°C' : '—') +
          (r.ph !== null ? '  pH ' + r.ph : '') +
          (r.note ? '  // ' + r.note : ''));
      });
    }

    if (a.prediction) {
      lines.push('');
      lines.push('─── 发酵预测 ───');
      lines.push('预测 FG：' + U.sg(a.prediction.fg) + '（拟合置信度 ' + a.prediction.confidence + '）');
      if (a.prediction.daysToGo !== null) {
        lines.push('预计还需：约 ' + a.prediction.daysToGo + ' 天');
      }
    }

    if (a.tempStats) {
      lines.push('');
      lines.push('─── 温度 ───');
      lines.push('最低 ' + a.tempStats.min + '°C / 最高 ' + a.tempStats.max +
        '°C / 平均 ' + a.tempStats.avg + '°C，波动 ' + a.tempStats.swing + '°C');
      if (a.tempStats.warning) lines.push('提示：' + a.tempStats.warning);
    }

    if (b.tasting && b.tasting.total !== null) {
      lines.push('');
      lines.push('─── 品鉴 ───');
      lines.push('香气 ' + (b.tasting.aroma || 0) + '/12  外观 ' + (b.tasting.appearance || 0) + '/3' +
        '  风味 ' + (b.tasting.flavor || 0) + '/20  口感 ' + (b.tasting.mouthfeel || 0) + '/5' +
        '  整体 ' + (b.tasting.overall || 0) + '/10');
      var g = Batch.tastingGrade(b.tasting.total);
      lines.push('总分 ' + b.tasting.total + '/50  ' + (g ? g.label : ''));
      if (b.tasting.notes) lines.push('备注：' + b.tasting.notes);
    }

    if (b.notes) {
      lines.push('');
      lines.push('─── 批次备注 ───');
      lines.push(b.notes);
    }

    lines.push('');
    lines.push('由 ' + BREW.Config.APP_NAME + ' v' + BREW.Config.VERSION + ' 生成');

    return lines.join('\n');
  };

  /* ======================================================================
   * 八、全局统计（用于首页看板）
   * ====================================================================*/
  Batch.overview = function (batches) {
    batches = batches || [];
    var out = {
      total: batches.length,
      byStatus: {},
      totalVolume: 0,
      avgEfficiency: null,
      avgAttenuation: null,
      bestTasting: null,
      recent: null
    };

    var effs = [], atts = [];

    batches.forEach(function (b) {
      out.byStatus[b.status] = (out.byStatus[b.status] || 0) + 1;
      var snap = b.recipeSnapshot || {};
      out.totalVolume += U.toNum(snap.batchSize, 0);

      var a = Batch.analyze(b);
      if (a.vsDesign && a.vsDesign.efficiencyActual) effs.push(a.vsDesign.efficiencyActual);
      if (a.apparentAttenuation) atts.push(a.apparentAttenuation);

      if (b.tasting && b.tasting.total) {
        if (!out.bestTasting || b.tasting.total > out.bestTasting.total) {
          out.bestTasting = { batchNo: b.batchNo, name: snap.name, total: b.tasting.total };
        }
      }
    });

    if (effs.length) out.avgEfficiency = U.round(effs.reduce(function (a, c) { return a + c; }, 0) / effs.length, 1);
    if (atts.length) out.avgAttenuation = U.round(atts.reduce(function (a, c) { return a + c; }, 0) / atts.length, 1);
    out.totalVolume = U.round(out.totalVolume, 0);

    /* 最近一批 */
    var sorted = batches.slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    if (sorted.length) {
      out.recent = { batchNo: sorted[0].batchNo, name: (sorted[0].recipeSnapshot || {}).name };
    }

    return out;
  };

  /* ======================================================================
   * 九、时间归一（v1.4 · 事件流与失败档案共用）
   * ====================================================================*/

  /** 任意"时间" → 毫秒时间戳；认不出返回 **null**，不返回 0。
   *  0 是 1970 年，会被当成"真有这个时刻"排到时间轴最前面；
   *  "没记时刻"和"1970 年"是两件完全不同的事，混在一起就再也分不开。 */
  function eventMs(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return (isFinite(v) && v > 0) ? v : null;
    var t = new Date(v).getTime();
    return (isFinite(t) && t > 0) ? t : null;
  }

  /** 只有日期没有时刻（YYYY-MM-DD）→ 当地中午 12:00。
   *  直接 new Date('2026-10-22') 按 UTC 零点解析：UTC+8 显示成同一天 08:00，
   *  UTC-5 变成前一天 19:00——同一份数据在不同时区会落进不同的日分组。
   *  显式按本地中午构造，哪边看都是"那一天"。 */
  function dayNoonMs(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
    var t = d.getTime();
    return (isFinite(t) && t > 0) ? t : null;
  }

  /** 分钟数 → '45 分钟' / '1 小时 20 分钟' */
  function fmtMinutes(m) {
    var n = Math.abs(Math.round(U.toNum(m, 0)));
    if (n < 60) return n + ' 分钟';
    var h = Math.floor(n / 60);
    var r = n % 60;
    return h + ' 小时' + (r ? ' ' + r + ' 分钟' : '');
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function ymdOf(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function hhmmOf(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  var WEEK_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* ======================================================================
   * 十、失败档案（v1.4 · 负样本）
   * ----------------------------------------------------------------------
   * 失败以前只是列表里的一个红标签。可"这批为什么坏了"恰恰是最值钱的知识：
   * 抄一锅成功的酒只需要配方，一锅失败的酒才会告诉你设备的边界在哪。
   *
   * 所以给它三个字段：类型（可聚合计数）/ 现象（当时看到什么）/ 下次怎么改。
   * 枚举值是**冻结**的，不许随手加——加一个值等于把历史聚合结果拆成两半，
   * 用户看到的"污染 ×3"会突然变成"污染 ×2 + 霉斑 ×1"。
   * ====================================================================*/
  Batch.FAILURE_TYPES = [
    { v: 'infection',  zh: '污染',     hint: '酸臭、拉丝、液面白膜、不该有的浑浊' },
    { v: 'stalled',    zh: '发酵停滞', hint: '比重连续几天不动，却离预期 FG 还很远' },
    { v: 'oxidized',   zh: '氧化',     hint: '纸板味、雪利酒味、颜色发暗发褐' },
    { v: 'off-flavor', zh: '异味',     hint: '双乙酰、乙醛、硫味、溶剂味——不是污染但不对味' },
    { v: 'packaging',  zh: '装瓶问题', hint: '爆瓶、没气、瓶内氧化、封口漏气' },
    { v: 'recipe',     zh: '配方设计', hint: '比例失衡，苦度或酒体与目标风格不符' },
    { v: 'other',      zh: '其他',     hint: '都不贴切的原因' }
  ];

  /** 类型值 → 中文名；认不出返回 null（不返回 '其他'：
   *  把未知值悄悄归到"其他"会让用户以为自己的分类生效了） */
  Batch.failureLabel = function (v) {
    var list = Batch.FAILURE_TYPES;
    for (var i = 0; i < list.length; i++) if (list[i].v === v) return list[i].zh;
    return null;
  };

  /** 空档案。字段顺序固定，落盘后肉眼可读 */
  Batch.blankFailure = function () {
    return { type: null, note: '', learned: '' };
  };

  /** 补形状（原地）：老批次完全没有 failure 字段也要能读、能存。
   *  和 46 的 normalizeBatch 是两道口——一道给数据层，一道给界面层。 */
  Batch.normalizeFailure = function (obj) {
    var f = (obj && typeof obj === 'object') ? obj : {};
    if (f.type === undefined) f.type = null;
    if (f.note === undefined) f.note = '';
    if (f.learned === undefined) f.learned = '';
    f.note = String(f.note === null ? '' : f.note).slice(0, 200);
    f.learned = String(f.learned === null ? '' : f.learned).slice(0, 200);
    if (f.type !== null && !Batch.failureLabel(f.type)) f.type = null;   /* 脏值归一 */
    return f;
  };

  /** 读侧：返回一份归一后的**副本**（不改入参），三项全空则返回 null。
   *  null = "这锅没记失败档案"，和"记了但类型空着"（note/learned 有内容）
   *  是两种状态：前者不该出现在「我的坑」的明细里，后者要出现并标注"未分类"。 */
  Batch.failureOf = function (b) {
    var f = (b && typeof b === 'object' && b.failure && typeof b.failure === 'object')
      ? b.failure : null;
    if (!f) return null;
    var out = Batch.normalizeFailure({
      type: f.type === undefined ? null : f.type,
      note: f.note === undefined ? '' : f.note,
      learned: f.learned === undefined ? '' : f.learned
    });
    if (!out.type && !out.note && !out.learned) return null;
    return {
      type: out.type,
      typeLabel: out.type ? Batch.failureLabel(out.type) : null,
      note: out.note,
      learned: out.learned
    };
  };

  /** 这一批"什么时候失败的"：最后一条 status === failed 的历史时刻。
   *  没有历史（导入数据/降级数据）就退到 updatedAt / createdAt——
   *  排序要有个依据，但宁可退到"最后动过它的时间"也不编一个。 */
  function failedAt(b) {
    var hist = Array.isArray(b && b.statusHistory) ? b.statusHistory : [];
    var at = 0;
    for (var i = 0; i < hist.length; i++) {
      var h = hist[i] || {};
      if (Batch.normalizeStatus(h.status) !== 'failed') continue;
      var t = eventMs(h.at);
      if (t && t > at) at = t;
    }
    if (at) return at;
    return eventMs(b && b.updatedAt) || eventMs(b && b.createdAt) || 0;
  }
  Batch.failedAt = failedAt;

  /**
   * 「我的坑」：失败批次按类型聚合。
   *   · 计数按次数降序（并列看最近一次的时间，再并列按枚举顺序）
   *   · 每桶带最近一次的 learned（没有就是空字符串，文案由界面决定）
   *   · 没填类型的失败批次归到 type = null 一桶，label = '未分类'
   *     —— 宁可显示"未分类"，也不能让它们从总数里消失：
   *        否则"失败 5 次"下面只列出 3 项，差值没有任何解释。
   * @returns {{total:number, typed:number, untyped:number, rows:Array}}
   */
  Batch.failureStats = function (batches) {
    batches = Array.isArray(batches) ? batches : [];
    var order = [];
    var map = {};
    var total = 0;

    for (var i = 0; i < batches.length; i++) {
      var b = batches[i];
      if (!b || Batch.normalizeStatus(b.status) !== 'failed') continue;
      total++;

      var f = Batch.failureOf(b);
      var key = (f && f.type) ? f.type : '__untyped__';
      var at = failedAt(b);
      var bucket = map[key];
      if (!bucket) {
        bucket = map[key] = {
          type: (f && f.type) || null,
          label: (f && f.type) ? Batch.failureLabel(f.type) : '未分类',
          count: 0,
          learned: '',
          learnedAt: 0,
          note: '',
          noteAt: 0,
          lastAt: 0,
          lastBatchId: '',
          lastBatchNo: '',
          samples: []
        };
        order.push(key);
      }
      bucket.count++;
      if (bucket.samples.length < 5) bucket.samples.push(b.batchNo || b.name || '');

      /* "最近一次"= 失败时刻最大的那一条；learned 和 note 各自独立取最近，
         因为它们可能在不同的批次里分别写过 */
      if (f && f.learned && at >= bucket.learnedAt) {
        bucket.learned = f.learned;
        bucket.learnedAt = at;
      }
      if (f && f.note && at >= bucket.noteAt) {
        bucket.note = f.note;
        bucket.noteAt = at;
      }
      if (!bucket.lastBatchId || at >= bucket.lastAt) {
        bucket.lastAt = at;
        bucket.lastBatchId = b.id || '';
        bucket.lastBatchNo = b.batchNo || b.name || '';
      }
    }

    var enumRank = {};
    for (var e = 0; e < Batch.FAILURE_TYPES.length; e++) enumRank[Batch.FAILURE_TYPES[e].v] = e;

    var rows = order.map(function (k) { return map[k]; });
    rows.sort(function (x, y) {
      if (y.count !== x.count) return y.count - x.count;      /* ① 次数多的在前 */
      var ux = x.type === null ? 1 : 0, uy = y.type === null ? 1 : 0;
      if (ux !== uy) return ux - uy;                          /* ② 分过类的排在"未分类"前 */
      var rx = x.type === null ? 99 : enumRank[x.type];
      var ry = y.type === null ? 99 : enumRank[y.type];
      if (rx !== ry) return rx - ry;                          /* ③ 枚举顺序（稳定的观感） */
      return Math.max(y.learnedAt, y.noteAt) - Math.max(x.learnedAt, x.noteAt);
    });

    var untyped = 0;
    for (var r = 0; r < rows.length; r++) if (!rows[r].type) untyped += rows[r].count;

    return { total: total, typed: total - untyped, untyped: untyped, rows: rows };
  };

  /* ======================================================================
   * 十一、统一事件流（v1.4）
   * ----------------------------------------------------------------------
   * 一锅酒的信息散在四处：readings / brewday.steps / statusHistory / tasting。
   * 四处各有一块界面，却没有一个地方能回答"这一锅从头到尾发生了什么"。
   * 这个函数就是那条线：四类事件归一成同一种形状，按时间升序。
   *
   * ⚠️ 「缺失时刻」的处理（这条是硬规矩，别改）：
   *   brewday.steps[].at 是**预定**时刻，actualAt 才是**实际**发生。
   *   只有 actualAt 进事件流；没有 actualAt 的步骤不进，另存进 unrecorded，
   *   由界面如实写"还有 N 项没记实际时刻"。
   *   拿预定时刻冒充实际发生 = 把计划当历史：用户 11:20 才点开始，
   *   时间轴上却写"10:00 糖化进水"，这条线从第一格起就不可信了。
   *   同理：tasting 只有填了日期才进线；没日期的进 unrecorded。
   * ====================================================================*/

  /* 酿造日步骤的中文兜底名。存档里只留 key/actualAt/skipped/note（省空间），
     label 是拿 36 的 build() 反推的；36 没加载或 key 认不出时才用这张表。 */
  var STEP_LABELS = {
    strike: '糖化进水', heat: '升温', sparge: '洗糟', boil: '开始煮沸',
    whirlpool: '回旋沉淀', chill: '冷却至接种温度', pitch: '接种酵母'
  };

  /* 同一时刻多类事件时的排列：先"做了什么"，再"记了什么"，再"状态"，最后"品鉴"。
     排序是稳定的（ES2019 起 Array#sort 保证），同类同刻保持插入顺序。 */
  var KIND_PRIORITY = { brewstep: 0, reading: 1, status: 2, tasting: 3 };

  function stepLabelOf(key, planMap) {
    var hit = planMap && key ? planMap[key] : null;
    if (hit && hit.label) return hit.label;
    if (STEP_LABELS[key]) return STEP_LABELS[key];
    var m = /^rest-(\d+)$/.exec(String(key || ''));
    if (m) return '糖化休止 ' + (parseInt(m[1], 10) + 1);
    m = /^hop-(\d+)$/.exec(String(key || ''));
    if (m) return '第 ' + (parseInt(m[1], 10) + 1) + ' 次投花';
    return key ? String(key) : '酿造日步骤';
  }

  /** 用 36 的 build() 反推每个步骤的 label 与**预定**时刻。
   *  预定时刻只用来算"比计划晚/早多久"，绝不冒充实际发生时刻。 */
  function brewPlanMap(b) {
    var map = {};
    var bd = b && b.brewday;
    if (!bd || !Array.isArray(bd.steps) || !bd.steps.length) return map;
    var plan = null;
    try {
      if (BREW.BrewdayPlan && typeof BREW.BrewdayPlan.build === 'function') {
        plan = BREW.BrewdayPlan.build(b.recipeSnapshot || {}, U.toNum(bd.startedAt, 0));
      }
    } catch (e) { plan = null; }
    if (plan && plan.steps) {
      for (var i = 0; i < plan.steps.length; i++) {
        var s = plan.steps[i];
        if (s && s.key) map[s.key] = { label: s.label || '', at: s.at || null };
      }
    }
    return map;
  }

  function readingDetail(r) {
    var bits = [];
    if (r.sg !== null && r.sg !== undefined && isFinite(r.sg)) bits.push('SG ' + U.sg(r.sg));
    if (r.tempC !== null && r.tempC !== undefined && isFinite(r.tempC)) bits.push(U.round(r.tempC, 1) + ' °C');
    if (r.ph !== null && r.ph !== undefined && isFinite(r.ph)) bits.push('pH ' + U.round(r.ph, 2));
    var note = String(r.note || '').trim();
    if (!bits.length && !note) return '只记了时间，没填数值';
    return bits.join(' · ') + (note ? (bits.length ? '  //  ' : '') + note : '');
  }

  function buildTimeline(b) {
    var events = [];
    var unrecorded = [];
    var out = {
      events: events,
      unrecorded: unrecorded,
      count: 0,
      byKind: { reading: 0, brewstep: 0, status: 0, tasting: 0 },
      firstAt: null,
      lastAt: null,
      days: null
    };
    if (!b || typeof b !== 'object') return out;

    function push(at, kind, title, detail, tone) {
      events.push({ at: at, kind: kind, title: title, detail: detail || '', tone: tone || 'muted' });
      out.byKind[kind] = (out.byKind[kind] || 0) + 1;
    }

    /* ---- ① 酿造日步骤：只认 actualAt ---- */
    var bd = b.brewday;
    var planMap = brewPlanMap(b);
    var steps = (bd && Array.isArray(bd.steps)) ? bd.steps : [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i] || {};
      var label = stepLabelOf(s.key, planMap);
      var sAt = eventMs(s.actualAt);
      if (!sAt) {
        unrecorded.push({
          kind: 'brewstep',
          title: label,
          reason: s.skipped ? '标记为跳过，没有实际时刻' : '没记实际时刻'
        });
        continue;
      }
      var sBits = [];
      var planHit = s.key ? planMap[s.key] : null;
      var planAt = planHit ? eventMs(planHit.at) : null;
      if (planAt) {
        var dMin = Math.round((sAt - planAt) / 60000);
        /* ±1 分钟算准时：手点打勾的秒级抖动没有信息量 */
        sBits.push(Math.abs(dMin) <= 1 ? '按计划时刻'
          : (dMin > 0 ? '比计划晚 ' + fmtMinutes(dMin) : '比计划早 ' + fmtMinutes(-dMin)));
      }
      var sNote = String(s.note || '').trim();
      if (sNote) sBits.push(sNote);
      push(sAt, 'brewstep', label, sBits.join(' · '), 'info');
    }

    /* ---- ② 测量点 ---- */
    var readings = Array.isArray(b.readings) ? b.readings : [];
    for (var j = 0; j < readings.length; j++) {
      var r = readings[j] || {};
      /* ts 是引擎写的毫秒；at 是 ISO 别名。两个都认，两个都没有就不进线 */
      var rAt = eventMs(r.ts) || eventMs(r.at) || eventMs(r.time) || eventMs(r.date);
      if (!rAt) {
        unrecorded.push({ kind: 'reading', title: '一条读数', reason: '没有时间戳' });
        continue;
      }
      push(rAt, 'reading', (r.stage || '未标阶段'), readingDetail(r), 'amber');
    }

    /* ---- ③ 状态流转 ---- */
    var histRaw = Array.isArray(b.statusHistory) ? b.statusHistory : [];
    var hist = [];
    for (var k = 0; k < histRaw.length; k++) {
      var hAt = eventMs(histRaw[k] && histRaw[k].at);
      if (!hAt) continue;
      hist.push({ status: Batch.normalizeStatus(histRaw[k].status), at: hAt });
    }
    hist.sort(function (x, y) { return x.at - y.at; });

    /* 压掉"连续两条同状态"：那不是一个转换，是重复记录。
       不压的话时间轴上会出现"从「发酵中」转来"两次，而实际上什么也没发生。 */
    var lastStatus = null;
    for (var m = 0; m < hist.length; m++) {
      var st = hist[m].status;
      if (st === lastStatus) continue;
      var tone = st === 'failed' ? 'bad' : (st === 'done' ? 'ok' : 'muted');
      push(hist[m].at, 'status',
        Batch.statusLabel(st),
        lastStatus === null ? '批次建立时的状态' : '从「' + Batch.statusLabel(lastStatus) + '」转来',
        tone);
      lastStatus = st;
    }

    /* ---- ④ 品鉴 ---- */
    var t = (b.tasting && typeof b.tasting === 'object') ? b.tasting : null;
    var tTotal = t ? Batch.calcTastingTotal(t) : null;
    var tHas = !!t && (tTotal !== null || String(t.notes || '').trim() !== '');
    if (tHas) {
      var tAt = dayNoonMs(t.date) || eventMs(t.date);
      if (!tAt) {
        unrecorded.push({
          kind: 'tasting',
          title: '品鉴记录',
          reason: tTotal !== null ? '有评分但没填品鉴日期' : '没填品鉴日期'
        });
      } else {
        var tBits = [];
        var tTitle = '只写了备注';
        if (tTotal !== null) {
          tTitle = '得分 ' + tTotal + ' / 50';
          var g = Batch.tastingGrade(tTotal);
          if (g) tBits.push(g.label);
        }
        var tNote = String(t.notes || '').trim();
        if (tNote) tBits.push(tNote);
        push(tAt, 'tasting', tTitle, tBits.join(' · '),
          (tTotal !== null && tTotal < 21) ? 'bad' : 'ok');
      }
    }

    /* ---- 排序：时间升序；同刻按 kind 优先级 ---- */
    events.sort(function (x, y) {
      if (x.at !== y.at) return x.at - y.at;
      var px = KIND_PRIORITY[x.kind];
      var py = KIND_PRIORITY[y.kind];
      return (px === undefined ? 9 : px) - (py === undefined ? 9 : py);
    });

    out.count = events.length;
    if (events.length) {
      out.firstAt = events[0].at;
      out.lastAt = events[events.length - 1].at;
      out.days = U.round((out.lastAt - out.firstAt) / 86400000, 1);
    }
    return out;
  }

  /** 统一事件流：四类事件归一成 {at, kind, title, detail, tone}，时间升序。
   *  kind ∈ 'reading' | 'brewstep' | 'status' | 'tasting'
   *  tone ∈ 'amber'（读数）| 'info'（酿造日）| 'muted'（普通状态）
   *        | 'ok'（完成 / 品鉴）| 'bad'（失败 / 低分）
   *  @returns {Array<{at:number, kind:string, title:string, detail:string, tone:string}>} */
  Batch.timelineOf = function (b) {
    return buildTimeline(b).events;
  };

  /** 同一次计算的全量结果（事件 + 未记录项 + 分类型计数 + 首尾时刻）。
   *  界面要"共 N 天 · M 条记录"和"还有 N 项没记时刻"，都从这里取，
   *  免得为了几个计数字段再遍历一遍。 */
  Batch.timelineSummary = function (b) {
    return buildTimeline(b);
  };

  /** 事件流 → Markdown（导出的正文）。
   *  表头四项是硬要求：批次名 / 配方 / 酿造日期 / 起止；正文按日期分组。
   *  0 条事件也照常出文件：写明"还没有时刻"，而不是导一个空文件让人猜。 */
  Batch.timelineToMarkdown = function (b) {
    var tl = buildTimeline(b);
    var snap = (b && b.recipeSnapshot) || {};
    function cell(s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';
    }

    var L = [];
    L.push('# 批次时间轴 · ' + ((b && b.name) ? String(b.name) : '未命名批次'));
    L.push('');
    L.push('| 项 | 内容 |');
    L.push('| --- | --- |');
    L.push('| 批次名 | ' + cell((b && b.name) || '未命名批次') + ' |');
    L.push('| 批次号 | ' + cell((b && b.batchNo) || '—') + ' |');
    L.push('| 配方 | ' + cell(snap.name || '—') + ' |');
    L.push('| 酿造日期 | ' + cell((b && b.brewDate) || '—') + ' |');
    L.push('| 起止 | ' + cell(tl.count
      ? (ymdOf(tl.firstAt) + ' ' + hhmmOf(tl.firstAt) + ' → ' +
         ymdOf(tl.lastAt) + ' ' + hhmmOf(tl.lastAt))
      : '还没有记录') + ' |');
    L.push('| 记录 | ' + (tl.count
      ? tl.count + ' 条（读数 ' + tl.byKind.reading + ' / 酿造日 ' + tl.byKind.brewstep +
        ' / 状态 ' + tl.byKind.status + ' / 品鉴 ' + tl.byKind.tasting + '）'
      : '0 条') + ' |');
    L.push('');

    if (!tl.count) {
      L.push('这条时间轴还没有任何时刻。记一条读数、在酿造日打一个勾、或推进一次状态，');
      L.push('这里就会长出第一格。');
      L.push('');
      L.push('---');
      L.push('');
      L.push('*由 ' + BREW.Config.APP_NAME + ' v' + BREW.Config.VERSION + ' 导出。*');
      return L.join('\n');
    }

    var lastDay = '';
    var KIND_ZH = { reading: '读数', brewstep: '酿造日', status: '状态', tasting: '品鉴' };
    for (var i = 0; i < tl.events.length; i++) {
      var e = tl.events[i];
      var day = ymdOf(e.at);
      if (day !== lastDay) {
        /* 日期标题前留空行：紧跟列表的 '## ' 在多数渲染器里会被当成列表项的一部分 */
        if (L[L.length - 1] !== '') L.push('');
        L.push('## ' + day + ' ' + WEEK_ZH[new Date(e.at).getDay()]);
        L.push('');
        lastDay = day;
      }
      L.push('- **' + hhmmOf(e.at) + '**　' + (KIND_ZH[e.kind] || e.kind) + ' · ' + e.title +
        (e.detail ? ' —— ' + e.detail : ''));
    }
    L.push('');

    if (tl.unrecorded.length) {
      L.push('## 没有实际时刻的记录');
      L.push('');
      L.push('下面这些项没有记录"什么时候发生"，所以不进上面的时间轴。');
      L.push('按预定时刻补进去是不诚实的，所以这里只如实列出：');
      L.push('');
      for (var u = 0; u < tl.unrecorded.length; u++) {
        L.push('- ' + tl.unrecorded[u].title + ' —— ' + tl.unrecorded[u].reason);
      }
      L.push('');
    }

    L.push('---');
    L.push('');
    L.push('*由 ' + BREW.Config.APP_NAME + ' v' + BREW.Config.VERSION + ' 导出。' +
      '时间为本机时区。*');
    return L.join('\n');
  };

})(typeof window !== 'undefined' ? window : globalThis);
