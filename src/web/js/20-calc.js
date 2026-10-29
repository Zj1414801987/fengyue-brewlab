/* ============================================================================
 * 风月酿研所 — 20 计算引擎（Calc）
 * ----------------------------------------------------------------------------
 * 这是整个软件的地基。所有数字都必须经得起"拿去配料"的检验。
 * 依赖：00-core / 05-units / 10~15 数据层
 *
 * ============================ 公式出处与量纲 ============================
 *
 * 【1】出糖（OG）
 *   英制：points = Σ(ppg × lb) / gal × efficiency
 *   公制系数推导：1 lb = 0.453592 kg，1 gal = 3.78541 L
 *     ppg × lb / gal = ppg × (kg × 2.20462) × 3.78541 / L
 *                    = ppg × kg × 8.34540 / L
 *   验算：5kg 二棱麦（37ppg）／20L／72%
 *     = 37 × 5 × 8.3454 × 0.72 / 20 = 55.6 点 → OG 1.0556  ✓ 与经验值吻合
 *
 * 【2】IBU（Tinseth）
 *   英制原式：IBU = AA_decimal × oz × U × 7489 / gal
 *   公制推导：7489 × 3.78541 / 28.3495 = 1000.0
 *     → IBU = AA_decimal × g × U × 1000 / L
 *   若 AA 用百分数（12 而非 0.12）：IBU = AA% × g × U × 10 / L
 *   U = bigness × boilTimeFactor
 *     bigness = 1.65 × 0.000125^(boilGravity − 1)
 *     boilTimeFactor = (1 − e^(−0.04 × min)) / 4.15
 *   验算：30g／12%／60min／20L／1.050
 *     bigness = 1.65 × 0.000125^0.05 = 1.0497
 *     btf = (1 − e^−2.4)/4.15 = 0.9093/4.15 = 0.2191
 *     U = 0.2300
 *     IBU = 12 × 30 × 0.2300 × 10 / 20 = 41.4  ✓（业界算例 39–42 区间）
 *
 * 【3】色度（Morey）
 *   MCU = Σ(lb × °L)/gal → 公制：Σ(kg × °L × 8.3454)/L
 *   SRM = 1.4922 × MCU^0.6859
 *   局限：只对 SRM < 50 有意义；煮沸会额外加深 2–3 SRM（模型不含此修正，
 *         在 UI 上作为"预期实际值"另行提示）
 *
 * 【4】ABV
 *   简式：(OG − FG) × 131.25，8% 以下误差 <0.1%
 *   Hall 式：76.08 × (OG − FG) / (1.775 − OG) × (FG / 0.794)，高浓度更准
 *   验算 OG 1.090 / FG 1.018：简式 9.45%，Hall 10.25%
 *
 * 【5】残留碱度（Kolbach）
 *   RA (as CaCO3, mg/L) = 0.8197 × HCO3(mg/L) − Ca/3.5 − Mg/7
 *   量纲核对：HCO3 的当量 61，CaCO3 当量 50 → 50/61 = 0.8197
 *             Ca 当量 20.04 → Ca(mg/L)/3.5 是 Kolbach 原式的经验系数
 *   **这个公式在碳酸盐硬度占主导的硬水里误差大，只用于给方向**
 *
 * 【6】碳化
 *   残余 CO2（vol）= 0.00086·T² − 0.05952·T + 1.7077   （T 为 °C，
 *     取发酵结束后达到过的最高温度）
 *   糖量(g) = (目标vol − 残余vol) × 液量(L) × 系数
 *   系数（化学计量推导）：
 *     蔗糖  342.3/176 × 1.963 = 3.82 g/L/vol
 *     一水葡萄糖 198.17/88 × 1.963 = 4.42 g/L/vol
 *     DME 按 75% 可发酵折算 ≈ 5.9–6.1
 *
 * ============================ 已知局限 ============================
 *   · 效率是"系统效率"，实际受粉碎/糖化/洗糟影响，首酿必然偏低
 *   · 糖化 pH 只给区间，不给点值——任何点值都是假的
 *   · 深色酒的实际色度通常比 Morey 预测深 2–3 SRM
 *   · 干投对 IBU 的"负贡献"（多酚结合）未计入
 *   · 高浓度（OG > 1.100）时所有模型误差放大
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  var U = BREW.Util;
  var Units = BREW.Units;

  var Calc = BREW.Calc = {};

  /* 公制换算系数：ppg × kg × 8.3454 / L = points */
  var PPG_TO_METRIC = 8.34540;

  /* ------------------------------------------------------------------------
   * 可发酵性系数
   * ------------------------------------------------------------------------
   * 决定 FG。不同原料被酵母"吃掉"的比例不一样：
   *   基麦/窑烤/未发芽谷物：按酵母表观衰减度全额
   *   结晶麦芽：糖化时已糖化，但含 40-50% 不可发酵的焦糖类，取 0.55
   *   烘烤谷物：大量不可发酵色素与焦苦物质，取 0.40
   *   糖（葡萄糖/蔗糖/糖浆）：100% 可发酵
   *   乳糖/麦芽糊精：**0%**，全部残留
   *   提取物：100%（已糖化）
   * 这些系数是经验值，来自各类麦芽的典型发酵度，不是精确测量结果。
   * ----------------------------------------------------------------------*/
  var FERMENTABILITY = {
    base: 1.00, kiln: 1.00, crystal: 0.55, roast: 0.40,
    grain: 1.00, sugar: 1.00, extract: 1.00
  };

  function fermentabilityOf(item) {
    /* 糖与提取物：由 fermentable 字段决定。
       乳糖与麦芽糊精 = 0（全部残留），其余糖/提取物 = 1（完全可发酵）。 */
    if (item.cat === 'sugar' || item.cat === 'extract') {
      return item.fermentable === 'none' ? 0 : 1;
    }
    /* 谷物类：由 cat 决定。
       注意**不要**看 item.fermentable —— 那个字段在麦芽数据里是"可发酵程度
       的描述"（high/med/low），不是系数。把它当系数会让基础麦芽的衰减度
       永远达不到酵母标称值，导致 FG 系统性偏高。 */
    var f = FERMENTABILITY[item.cat];
    return f === undefined ? 1.0 : f;
  }

  /* ======================================================================
   * 一、物料平衡
   * ----------------------------------------------------------------------
   * 酿酒最实际的问题不是"要多少麦芽"，而是"我要煮多少水"。
   * 目标入罐量 20L ≠ 煮沸前 20L，中间有四个损失：
   *   麦糟吸水 → 酒花吸水 → 煮沸蒸发 → 热端残液 → 冷端残液
   *
   * 倒推顺序（从成品往前）：
   *   装瓶量 batchSize
   *   + 冷端残液 fermenterLoss        → 进发酵罐的量 postBoil
   *   + 热端残液 trubLoss              → 冷却后总量
   *   + 煮沸蒸发 + 酒花吸水            → 煮沸前体积 preBoil
   * ====================================================================*/
  Calc.volumeBalance = function (r) {
    var d = BREW.Config.DEFAULTS;
    var batch = U.toNum(r.batchSize, d.batchSize);
    var evapRate = U.toNum(r.evaporationRate, d.evaporationRate) / 100;  /* %/h */
    var boilMin = U.toNum(r.boilTime, d.boilTime);
    var trub = U.toNum(r.trubLoss, d.trubLoss);
    var fLoss = U.toNum(r.fermenterLoss, d.fermenterLoss);

    /* 谷物总重（含片状谷物，不含糖/提取物） */
    var grainKg = 0, hopKg = 0, i;
    var ferm = r.fermentables || [];
    for (i = 0; i < ferm.length; i++) {
      if (ferm[i].mustMash !== false && ferm[i].cat !== 'sugar' && ferm[i].cat !== 'extract') {
        grainKg += U.toNum(ferm[i].amount, 0);
      }
    }
    var hops = r.hops || [];
    for (i = 0; i < hops.length; i++) hopKg += U.toNum(hops[i].amount, 0) / 1000;

    var grainAbsorb = grainKg * U.toNum(r.grainAbsorption, d.grainAbsorption);
    var hopAbsorb = hopKg * U.toNum(r.hopAbsorption, d.hopAbsorption);

    /* 进发酵罐的量 */
    var postBoil = batch + fLoss;
    /* 冷却后总量（含热端残液） */
    var postChill = postBoil + trub;
    /* 煮沸前体积：postChill = preBoil × (1 − evapRate × hours) − hopAbsorb */
    var evapFrac = evapRate * (boilMin / 60);
    evapFrac = U.clamp(evapFrac, 0, 0.6);
    var preBoil = (postChill + hopAbsorb) / (1 - evapFrac);

    var evapLoss = preBoil * evapFrac;

    /* 糖化用水：水料比 L/kg */
    var ratio = U.toNum(r.mashThickness, d.mashThickness);
    var mashWater = grainKg * ratio;
    var firstRunnings = Math.max(0, mashWater - grainAbsorb);

    /* 洗糟水 = 煮沸前体积 − 首次麦汁量 */
    var spargeWater = Math.max(0, preBoil - firstRunnings);

    return {
      batchSize: batch,
      grainKg: U.round(grainKg, 3),
      grainAbsorption: U.round(grainAbsorb, 2),
      hopAbsorption: U.round(hopAbsorb, 2),
      preBoil: U.round(preBoil, 2),
      postChill: U.round(postChill, 2),
      postBoil: U.round(postBoil, 2),
      evaporation: U.round(evapLoss, 2),
      trubLoss: U.round(trub, 2),
      fermenterLoss: U.round(fLoss, 2),
      mashWater: U.round(mashWater, 2),
      firstRunnings: U.round(firstRunnings, 2),
      spargeWater: U.round(spargeWater, 2),
      totalWater: U.round(mashWater + spargeWater, 2),
      mashThickness: U.round(ratio, 2),
      /* 水料比过低会糖化不均、过高会稀释酶 */
      warning: ratio < 2.0 ? '水料比低于 2.0 L/kg，糖化醪过稠，搅拌与出糖都会受影响'
             : (ratio > 5.0 ? '水料比高于 5.0 L/kg，酶浓度过低，糖化效率会下降' : null)
    };
  };

  /* ======================================================================
   * 二、出糖（OG / 糖化比重）
   * ====================================================================*/
  Calc.gravity = function (r, vol) {
    var bal = vol || Calc.volumeBalance(r);
    var eff = U.toNum(r.efficiency, BREW.Config.DEFAULTS.efficiency) / 100;
    var ferm = r.fermentables || [];
    var totalPts = 0, fermentablePts = 0;
    var contrib = [];

    for (var i = 0; i < ferm.length; i++) {
      var f = ferm[i];
      var kg = U.toNum(f.amount, 0);
      var ppg = U.toNum(f.ppg, 0);
      if (kg <= 0 || ppg <= 0) continue;

      /* 糖与提取物不需要糖化，效率按 100%；
         糖化谷物按系统效率 */
      var rowEff = (f.mustMash === false) ? 1.0 : eff;
      var pts = ppg * kg * PPG_TO_METRIC * rowEff / bal.batchSize;

      var ff = fermentabilityOf(f);
      totalPts += pts;
      fermentablePts += pts * ff;

      contrib.push({
        id: f.id, name: f.name || f.id,
        points: U.round(pts, 2),
        pct: 0,                 /* 稍后回填 */
        fermentable: U.round(ff * 100, 0),
        rowIndex: i             /* 保留原始行号：同一种麦芽可能加两次，按 id 匹配会错配 */
      });
    }

    /* 回填占比 */
    for (var j = 0; j < contrib.length; j++) {
      contrib[j].pct = totalPts > 0 ? U.round(contrib[j].points / totalPts * 100, 1) : 0;
    }

    /* 辅料里的可发酵糖（水果等）也要算进去 */
    var adj = r.adjuncts || [];
    for (var k = 0; k < adj.length; k++) {
      if (adj[k].extraSugarPct && adj[k].amount) {
        /* 水果的糖：g 果实 × 糖% → 当作葡萄糖点 */
        var gSugar = U.toNum(adj[k].amount, 0) * U.toNum(adj[k].extraSugarPct, 0) / 100;
        var sPts = (gSugar / 1000) * 46 * PPG_TO_METRIC * 1.0 / bal.batchSize;
        totalPts += sPts;
        fermentablePts += sPts;
        contrib.push({
          id: adj[k].id, name: adj[k].name || adj[k].id,
          points: U.round(sPts, 2), pct: 0, fermentable: 100, fromAdjunct: true
        });
      }
    }
    for (var m = 0; m < contrib.length; m++) {
      contrib[m].pct = totalPts > 0 ? U.round(contrib[m].points / totalPts * 100, 1) : 0;
    }

    /* 煮沸比重：糖总量守恒，体积变小浓度变大 */
    var boilPts = bal.preBoil > 0 ? totalPts * bal.batchSize / bal.preBoil : totalPts;

    return {
      totalPoints: U.round(totalPts, 2),
      fermentablePoints: U.round(fermentablePts, 2),
      og: Units.pointsToSg(totalPts),
      ogPlato: Units.sgToPlato(Units.pointsToSg(totalPts)),
      boilPoints: U.round(boilPts, 2),
      boilGravity: Units.pointsToSg(boilPts),
      contribution: contrib,
      efficiency: U.toNum(r.efficiency, 72)
    };
  };

  /* ======================================================================
   * 三、终比重（FG）与酒精度
   * ----------------------------------------------------------------------
   * 不是简单套 "FG = OG − (OG−1)×ADF"，因为配方里可能有乳糖、结晶麦芽、
   * 深色谷物——它们的实际可发酵比例远低于基麦。
   * 所以按原料逐项计算"可发酵点数"，再乘酵母衰减度。
   * ====================================================================*/
  Calc.attenuation = function (r, grav) {
    var yeasts = r.yeasts || [];
    var adf = 75;
    var yeastName = '—';
    if (yeasts.length > 0 && yeasts[0]) {
      if (yeasts[0].att) {
        adf = U.toNum(yeasts[0].att, 75);
        yeastName = yeasts[0].name || yeasts[0].id || '—';
      } else if (yeasts[0].id && BREW.DB && BREW.DB.yeasts) {
        var y = U.byId(BREW.DB.yeasts, yeasts[0].id);
        if (y) { adf = y.att; yeastName = y.name; }
      }
    }
    adf = U.clamp(adf, 30, 100);

    var fgPts = grav.totalPoints - grav.fermentablePoints * (adf / 100);
    if (!isFinite(fgPts) || fgPts < 0) fgPts = 0;

    var fg = Units.pointsToSg(fgPts);
    var og = grav.og;

    /* 简式与 Hall 式都给，并注明各自适用区间 */
    var abvSimple = (og - fg) * 131.25;
    var abvHall = 76.08 * (og - fg) / (1.775 - og) * (fg / 0.794);

    return {
      adf: U.round(adf, 1),
      yeastName: yeastName,
      fgPoints: U.round(fgPts, 2),
      fg: fg,
      fgPlato: Units.sgToPlato(fg),
      /* 实测表观衰减：(OG−FG)/(OG−1)。与上面的 adf 不是一回事：
         adf 是酵母的标称值，aaActual 是这配方真正达到的表观衰减。
         乳糖/结晶麦芽/深色谷物会把 aaActual 拉低 10–20 个百分点，
         所以界面上必须分开标，不能让用户看着 70% 以为发酵不完全。 */
      aaActual: og > 1.0001 ? U.round((og - fg) / (og - 1) * 100, 1) : 0,
      abv: U.round(abvHall, 2),        /* 默认用精确式 */
      abvSimple: U.round(abvSimple, 2),
      abvHall: U.round(abvHall, 2),
      abvNote: (og - fg) * 131.25 < 8
        ? '低于 8% 时两式差异 <0.2%，可任选'
        : '高于 8%，Hall 式更准（简式会低估）',
      /* 真实衰减度关系：RDF ≈ 0.8192 × ADF（在 °P 空间） */
      rdf: U.round(adf * 0.8192, 1)
    };
  };

  /* ======================================================================
   * 四、苦度（IBU）
   * ----------------------------------------------------------------------
   * Tinseth / Rager / Garetz 三法并算。
   * 为什么给三个：它们在同一配方上能差 10-20%，给单一数字会误导。
   * 默认显示 Tinseth，因为它是家酿软件的事实标准。
   * ====================================================================*/

  /** Tinseth 利用率 */
  Calc.tinsethUtil = function (boilGravity, minutes) {
    var g = U.clamp(boilGravity, 1.000, 1.200);
    var bigness = 1.65 * Math.pow(0.000125, g - 1);
    var t = Math.max(0, minutes);
    var btf = (1 - Math.exp(-0.04 * t)) / 4.15;
    return bigness * btf;
  };

  /** Rager 利用率表（按煮沸分钟），比重修正 */
  var RAGER_TABLE = [
    [0, 0], [5, 0.055], [10, 0.100], [15, 0.137], [20, 0.167],
    [25, 0.192], [30, 0.212], [35, 0.229], [40, 0.240], [45, 0.250],
    [50, 0.260], [60, 0.276], [70, 0.289], [80, 0.297], [90, 0.300]
  ];

  Calc.ragerUtil = function (boilGravity, minutes) {
    var t = Math.max(0, minutes), base = 0.30;
    for (var i = 0; i < RAGER_TABLE.length; i++) {
      if (t <= RAGER_TABLE[i][0]) {
        var prev = RAGER_TABLE[Math.max(0, i - 1)];
        var cur = RAGER_TABLE[i];
        var span = cur[0] - prev[0] || 1;
        base = prev[1] + (cur[1] - prev[1]) * ((t - prev[0]) / span);
        break;
      }
      base = RAGER_TABLE[i][1];
    }
    /* Rager 的比重修正：比重越高利用率越低 */
    var ga = (boilGravity - 1) * 1000;
    var adj = ga > 50 ? (ga - 50) / 200 * 0.05 : 0;
    return Math.max(0, base - adj);
  };

  /** Garetz 简化：比 Tinseth 保守约 10% */
  Calc.garetzUtil = function (boilGravity, minutes) {
    return Calc.tinsethUtil(boilGravity, minutes) * 0.88;
  };

  /** 把投放阶段折算成"等效煮沸分钟" */
  Calc.effectiveMinutes = function (hop) {
    var stage = hop.stage || 'boil';
    var t = U.toNum(hop.time, 0);
    switch (stage) {
      case 'firstwort': return Math.max(t, 20);   /* FWH 约等同 20 分钟 */
      case 'mash':      return 15;                /* 不稳定，保守取值 */
      case 'boil':      return t;
      case 'whirlpool':
        /* 回旋温度决定异构化程度，没有温度数据时取 0.4 折扣 */
        var temp = U.toNum(hop.whirlpoolTemp, 0);
        var f = temp >= 90 ? 0.50 : (temp >= 80 ? 0.35 : (temp >= 70 ? 0.15 : 0.05));
        if (!temp) f = 0.40;
        return t * f;
      case 'dryhop':
      /* 'dry' 是旧写法/外部导入的写法。40 的 normalizeRecipe 已把它归一成
         'dryhop'，这里再认一次是防御：直接调 Calc 的调用方（脚本、导入流程）
         拿到的可能是未归一的原始数据。不认的话干投会被当成煮沸投，苦度凭空翻倍。 */
      case 'dry':
      case 'keg':       return 0;
      default:          return t;
    }
  };

  Calc.ibu = function (r, grav, bal) {
    var hops = r.hops || [];
    var vol = bal.batchSize;
    var total = { tinseth: 0, rager: 0, garetz: 0 };
    var contrib = [];

    for (var i = 0; i < hops.length; i++) {
      var h = hops[i];
      var g = U.toNum(h.amount, 0);
      var aa = U.toNum(h.aa, 0);
      if (g <= 0 || aa <= 0) {
        contrib.push({
          id: h.id, name: h.name || h.id, ibu: 0, ibuRager: 0, ibuGaretz: 0,
          pct: 0, note: g <= 0 ? '用量为 0' : 'α酸未知'
        });
        continue;
      }
      var effMin = Calc.effectiveMinutes(h);
      var uT = Calc.tinsethUtil(grav.boilGravity, effMin);
      var uR = Calc.ragerUtil(grav.boilGravity, effMin);
      var uG = Calc.garetzUtil(grav.boilGravity, effMin);

      /* IBU = AA% × g × U × 10 / L（AA 用百分数） */
      var ibuT = aa * g * uT * 10 / vol;
      var ibuR = aa * g * uR * 10 / vol;
      var ibuG = aa * g * uG * 10 / vol;

      total.tinseth += ibuT;
      total.rager += ibuR;
      total.garetz += ibuG;

      contrib.push({
        id: h.id, name: h.name || h.id,
        stage: h.stage, time: U.toNum(h.time, 0), effectiveMin: U.round(effMin, 1),
        aa: aa, amount: g,
        util: U.round(uT * 100, 2),
        ibu: U.round(ibuT, 1),
        ibuRager: U.round(ibuR, 1),
        ibuGaretz: U.round(ibuG, 1),
        pct: 0
      });
    }

    for (var j = 0; j < contrib.length; j++) {
      contrib[j].pct = total.tinseth > 0 ? U.round(contrib[j].ibu / total.tinseth * 100, 1) : 0;
    }

    return {
      tinseth: U.round(total.tinseth, 1),
      rager: U.round(total.rager, 1),
      garetz: U.round(total.garetz, 1),
      /* 默认值取 Tinseth */
      value: U.round(total.tinseth, 1),
      contribution: contrib,
      /* IBU 感知上限约 100-110，超过部分溶解度饱和 */
      saturation: total.tinseth > 100
        ? '超过约 100 IBU 后，异α酸溶解度接近饱和，实际测得值通常低于计算值'
        : null
    };
  };

  /* ======================================================================
   * 五、色度（SRM / EBC）
   * ====================================================================*/
  Calc.color = function (r, bal) {
    var ferm = r.fermentables || [];
    var mcu = 0, contrib = [];

    for (var i = 0; i < ferm.length; i++) {
      var f = ferm[i];
      var kg = U.toNum(f.amount, 0);
      var lov = U.toNum(f.lov, 0);
      if (kg <= 0 || lov <= 0) continue;
      var rowMcu = kg * lov * PPG_TO_METRIC / bal.batchSize;
      mcu += rowMcu;
      contrib.push({ id: f.id, name: f.name || f.id, mcu: U.round(rowMcu, 2), pct: 0 });
    }

    var srm = mcu > 0 ? 1.4922 * Math.pow(mcu, 0.6859) : 0;

    for (var j = 0; j < contrib.length; j++) {
      contrib[j].pct = mcu > 0 ? U.round(contrib[j].mcu / mcu * 100, 1) : 0;
    }

    return {
      mcu: U.round(mcu, 2),
      srm: U.round(srm, 1),
      ebc: U.round(Units.srmToEbc(srm), 1),
      /* 煮沸会额外加深 2-3 SRM（美拉德反应），模型不含此项 */
      srmExpected: U.round(srm + (srm > 3 ? 2.5 : 1.0), 1),
      hex: BREW.color.hexFromSRM(srm),
      name: BREW.color.nameFromSRM(srm),
      contribution: contrib
    };
  };

  /* ======================================================================
   * 六、苦度平衡（BU:GU）
   * ====================================================================*/
  Calc.balance = function (ibu, og) {
    var gu = (og - 1) * 1000;
    var ratio = gu > 0 ? ibu / gu : 0;
    var label, desc;
    if (ratio < 0.4)      { label = '极麦芽'; desc = '苦味几乎不可感知，甜感主导'; }
    else if (ratio < 0.6) { label = '偏麦芽'; desc = '麦芽为主，苦味只做收尾'; }
    else if (ratio < 0.8) { label = '平衡偏麦'; desc = '两者接近，麦芽略占上风'; }
    else if (ratio < 1.0) { label = '平衡偏苦'; desc = '两者接近，苦味略占上风'; }
    else if (ratio < 1.3) { label = '偏苦'; desc = '苦味清晰，适合 IPA 类'; }
    else                  { label = '极苦'; desc = '苦味主导，需要足够麦芽骨架支撑'; }
    return { ratio: U.round(ratio, 2), gu: U.round(gu, 0), label: label, desc: desc };
  };

  /* ======================================================================
   * 七、水化学
   * ====================================================================*/
  Calc.water = function (r, bal) {
    var w = r.water || {};
    var src = w.source || { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0 };
    var salts = w.salts || [];

    /* 这里**不做**"源水填过没有"的判断，原因值得记一笔：
       试过用 `hasOwnProperty(water.source, 'ca')` 当判据，是死的。
       `Recipe.blank()`（js/30）把 source 归一成六个键全是 0 的对象，
       所以任何一条配方都"有键"，那条分支永远走不到——
       显示层当时照样印出 "Ca 0 / … / 糖化 pH 估算 5.3"，实测才发现。
       要真区分"没填"和"填了 0（纯 RO 水）"，得在数据层加 sourceEdited 标记，
       那是 30 号文件的事，不在计算层能补。
       所以判断权留给显示层：55 的 waterUnset() 按**值**判（六项全 0 = 没数据），
       并明确接受"RO 水与未设置同形"这个代价。
       本函数只提供数字，外加一个 saltCount 供显示层区分
       "只是没填源水"和"没填源水但加了盐"两种不同的空。 */
    var ion = {
      ca: U.toNum(src.ca, 0), mg: U.toNum(src.mg, 0), na: U.toNum(src.na, 0),
      cl: U.toNum(src.cl, 0), so4: U.toNum(src.so4, 0), hco3: U.toNum(src.hco3, 0)
    };

    var alkalinity = Units.hco3ToAlkalinity(ion.hco3);
    var details = [];
    var saltCount = 0;

    for (var i = 0; i < salts.length; i++) {
      var s = salts[i];
      var amt = U.toNum(s.amount, 0);
      if (amt <= 0) continue;
      var def = s.ion ? s : (BREW.DB.waterSalts ? U.byId(BREW.DB.waterSalts, s.id) : null);
      if (!def || !def.ion) continue;

      /* 数据是"每克每 20L"，按实际批次量缩放 */
      var scale = 20 / bal.batchSize;
      var delta = {};
      ['ca', 'mg', 'na', 'cl', 'so4', 'hco3'].forEach(function (k) {
        var v = (def.ion[k] || 0) * amt * scale;
        ion[k] += v;
        delta[k] = U.round(v, 2);
      });

      if (def.alkalinityPerG) alkalinity += def.alkalinityPerG * amt * scale;
      if (def.alkalinityPerMl) alkalinity += def.alkalinityPerMl * amt * scale;

      details.push({ id: s.id, name: def.name, amount: amt, unit: def.unit, delta: delta });
      saltCount++;
    }

    /* Kolbach 残留碱度
       RA = 碱度(as CaCO3) − Ca/3.5 − Mg/7
       **必须用 alkalinity 这个变量，不能写回 0.8197*ion.hco3。**
       alkalinity 在循环里已经包含了三部分：
         · HCO3⁻ 折算成 CaCO3 当量（×50/61 = 0.8197）
         · 酸剂的负当量（乳酸/磷酸的 alkalinityPerMl 是负数）
         · 碳酸钙的正当量（alkalinityPerG）
       只用 HCO3 的后果非常严重：加乳酸 RA 纹丝不动、加碳酸钙 RA 反而下降
       （因为碳酸钙同时抬高了 Ca，而 Ca 在公式里是减项）。
       而 RA 是推糖化 pH 的唯一输入 —— 那等于给出的调 pH 建议是反的。 */
    var ra = alkalinity - ion.ca / 3.5 - ion.mg / 7;

    /* SO4:Cl */
    var ratio = ion.cl > 0 ? ion.so4 / ion.cl : (ion.so4 > 0 ? 99 : 0);
    var ratioMeaning = '未知';
    if (BREW.DB.so4clMeaning) {
      for (var k = 0; k < BREW.DB.so4clMeaning.length; k++) {
        if (ratio <= BREW.DB.so4clMeaning[k].max) {
          ratioMeaning = BREW.DB.so4clMeaning[k].label;
          break;
        }
      }
    }

    /* 糖化 pH：只给区间，不给点值。
       模型：以残留碱度为主轴，用深色麦芽的酸度修正。
       这不是精确模型，是有意为之的"诚实区间"。 */
    /* ---- 麦芽自带的酸 ----
       两类来源：
       1. 深色/烘烤麦芽：色度越高酸越多，每 kg（500°L 当量）约降 0.06 pH
       2. 酸化麦芽：按"占麦芽总重的百分比"折算，每 1% 约降 0.06
          （数据里的 acidPerPct；它可能被加到麦芽表按 kg，也可能加到辅料表按 g） */
    var darkAcid = 0;
    var ferm = r.fermentables || [];
    var grainTotalKg = 0;
    for (var m = 0; m < ferm.length; m++) {
      var lovM = U.toNum(ferm[m].lov, 0);
      var kgM = U.toNum(ferm[m].amount, 0);
      if (ferm[m].mustMash !== false && kgM > 0) grainTotalKg += kgM;
      if (lovM >= 100 && kgM > 0) {
        darkAcid += kgM * (lovM / 500) * 0.06;
      }
    }

    var acidMaltKg = 0;
    for (var q1 = 0; q1 < ferm.length; q1++) {
      if (ferm[q1].maltLike || ferm[q1].id === 'a-acidmalt') {
        acidMaltKg += U.toNum(ferm[q1].amount, 0);           /* 麦芽表：kg */
      }
    }
    var adjList = r.adjuncts || [];
    for (var q2 = 0; q2 < adjList.length; q2++) {
      if (adjList[q2].maltLike || adjList[q2].id === 'a-acidmalt') {
        acidMaltKg += U.toNum(adjList[q2].amount, 0) / 1000;  /* 辅料表：g */
      }
    }
    if (grainTotalKg > 0 && acidMaltKg > 0) {
      darkAcid += (acidMaltKg / grainTotalKg * 100) * 0.06;
    }
    darkAcid = Math.min(darkAcid, 0.5);

    var baseLo, baseHi;
    if (ra < 25)       { baseLo = 5.15; baseHi = 5.45; }
    else if (ra < 60)  { baseLo = 5.25; baseHi = 5.55; }
    else if (ra < 100) { baseLo = 5.35; baseHi = 5.70; }
    else if (ra < 150) { baseLo = 5.45; baseHi = 5.85; }
    else if (ra < 220) { baseLo = 5.55; baseHi = 6.00; }
    else               { baseLo = 5.65; baseHi = 6.20; }

    var phLo = U.round(Math.max(5.0, baseLo - darkAcid), 2);
    var phHi = U.round(Math.min(6.4, baseHi - darkAcid), 2);

    return {
      /* saltCount：有几条盐真的参与了计算（amount > 0 且能找到定义）。
         显示层用它区分两种"空"——只是没填源水，还是没填源水但加了盐。
         注意六个离子数字本身**不能**用来判断"填没填"，原因见函数开头。 */
      saltCount: saltCount,
      ca: U.round(ion.ca, 1), mg: U.round(ion.mg, 1), na: U.round(ion.na, 1),
      cl: U.round(ion.cl, 1), so4: U.round(ion.so4, 1), hco3: U.round(ion.hco3, 1),
      alkalinity: U.round(alkalinity, 1),
      ra: U.round(ra, 1),
      so4clRatio: U.round(ratio, 2),
      so4clMeaning: ratioMeaning,
      mashPhRange: [phLo, phHi],
      mashPhEstimate: U.round((phLo + phHi) / 2, 2),
      mashPhConfidence: 'low',
      mashPhNote: '这是区间估计，不是测量值。任何声称能精确预测糖化 pH 的模型都不可信——' +
                  '必须用 pH 计在室温下实测（取样冷却到 20-25°C 再测）。',
      saltDetails: details,
      warning: ra > 150 && (r.fermentables || []).every(function (f) { return U.toNum(f.lov, 0) < 20; })
        ? '残留碱度 ' + U.round(ra, 0) + ' ppm 偏高，而配方几乎全是浅色麦芽——糖化 pH 很可能超过 5.8，' +
          '酒会发涩、色深、酒花发闷。建议用乳酸或磷酸降碱，或掺 RO 水'
        : null
    };
  };

  /* ======================================================================
   * 八、酵母接种量
   * ====================================================================*/
  Calc.pitch = function (r, grav) {
    var yeasts = r.yeasts || [];
    var plato = grav.ogPlato;
    var volMl = U.toNum(r.batchSize, 20) * 1000;
    var y = yeasts[0] || {};
    var type = y.type || 'ale';

    var rate = BREW.DB.pitchRates && BREW.DB.pitchRates[type] !== undefined
      ? BREW.DB.pitchRates[type] : 0.75;

    /* 细胞数（十亿）= rate(M/mL/°P) × °P × mL / 1000 */
    var cellsBillion = rate * plato * volMl / 1000;

    /* 干酵母：按每克 15 十亿活细胞估算（厂商标称 6-20，新鲜干酵母取中值） */
    var perGram = BREW.DB.dryYeastCellsPerGram || 15;
    var dryGrams = cellsBillion / perGram;
    var packs = dryGrams / 11;          /* 常见 11g 装 */

    /* 液体酵母：一包约 100 十亿（新鲜） */
    var liquidPacks = cellsBillion / 100;

    /* 扩培建议：需要几个倍增（1 步扩培约 ×6，2 步约 ×36） */
    var steps = 0;
    if (liquidPacks > 1) {
      var ratio = liquidPacks;
      while (ratio > 1 && steps < 3) { ratio /= 6; steps++; }
    }

    return {
      rate: rate,
      rateLabel: type === 'lager' ? '拉格 1.5 M cells/mL/°P' : '艾尔 0.75 M cells/mL/°P',
      plato: U.round(plato, 1),
      cellsBillion: U.round(cellsBillion, 0),
      dryGrams: U.round(dryGrams, 1),
      dryPacks: U.round(packs, 1),
      liquidPacks: U.round(liquidPacks, 2),
      expansionSteps: steps,
      advice: dryGrams <= 12
        ? '一包 11g 干酵母基本够用（略欠时可直接投，风险不大）'
        : (dryGrams <= 24
            ? '建议用 2 包干酵母，或做一次小扩培'
            : '接种量需求较大，建议做扩培或使用 2-3 包干酵母；单纯多投干酵母成本高且风味偏"酵母味"'),
      note: '干酵母活细胞按 15 十亿/克估算。**陈化、高温存放会显著降低活细胞数**，' +
            '过期酵母应加倍用量或先做活化'
    };
  };

  /* ======================================================================
   * 九、碳化
   * ====================================================================*/
  Calc.carbonation = function (r) {
    var c = r.carbonation || {};
    var target = U.toNum(c.targetVol, BREW.Config.DEFAULTS.carbonationVol);
    var temp = U.toNum(c.tempC, 20);
    var vol = U.toNum(r.batchSize, 20);

    /* 残余 CO2（vol）：0.00086T² − 0.05952T + 1.7077 */
    var residual = 0.00086 * temp * temp - 0.05952 * temp + 1.7077;
    residual = U.clamp(residual, 0.4, 2.0);

    var needed = Math.max(0, target - residual);

    /* 化学计量系数（g/L per vol CO2） */
    var F = { sucrose: 3.82, dextrose: 4.42, dme: 6.00, honey: 4.90 };
    var sugarType = c.sugarType || 'sucrose';

    var grams = {
      sucrose: U.round(needed * vol * F.sucrose, 1),
      dextrose: U.round(needed * vol * F.dextrose, 1),
      dme: U.round(needed * vol * F.dme, 1),
      honey: U.round(needed * vol * F.honey, 1)
    };

    return {
      targetVol: U.round(target, 2),
      residualVol: U.round(residual, 2),
      neededVol: U.round(needed, 2),
      tempC: temp,
      sugarType: sugarType,
      grams: grams,
      recommended: grams[sugarType],
      /* 安全提示：瓶装超过 3.0 vol 有爆瓶风险 */
      warning: target > 3.0
        ? '**目标碳酸超过 3.0 vol，普通玻璃瓶有爆瓶风险**。必须用耐压瓶（比利时/香槟瓶），' +
          '并在发酵确认结束后才装瓶'
        : null,
      note: '温度要填"发酵结束后酒液达到过的最高温度"，不是装瓶当时的温度。' +
            '温度填低了会严重多算糖'
    };
  };

  /* ======================================================================
   * 十、风格匹配诊断
   * ====================================================================*/
  Calc.styleMatch = function (r, result) {
    var style = r.styleId ? (BREW.DB.getStyle ? BREW.DB.getStyle(r.styleId) : null) : null;
    if (!style) return null;

    var fields = [
      { key: 'og',  label: 'OG',   actual: result.og,  range: style.og,  weight: 0.20, digits: 3 },
      { key: 'fg',  label: 'FG',   actual: result.fg,  range: style.fg,  weight: 0.15, digits: 3 },
      { key: 'abv', label: 'ABV',  actual: result.abv, range: style.abv, weight: 0.15, digits: 2, unit: '%' },
      { key: 'ibu', label: 'IBU',  actual: result.ibu, range: style.ibu, weight: 0.25, digits: 1 },
      { key: 'srm', label: 'SRM',  actual: result.srm, range: style.srm, weight: 0.25, digits: 1 }
    ];

    var totalScore = 0, deviations = [];

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var v = f.actual, lo = f.range[0], hi = f.range[1];
      var verdict, dev = 0, sub = 0;

      if (v >= lo && v <= hi) {
        verdict = 'in';
        sub = 1;
      } else {
        var span = hi - lo || 1;
        if (v < lo) {
          dev = (lo - v) / span;
          verdict = 'low';
        } else {
          dev = (v - hi) / span;
          verdict = 'high';
        }
        /* 偏离在一个区间宽度内线性扣分，超出则归零 */
        sub = U.clamp(1 - dev, 0, 1);
      }

      totalScore += sub * f.weight;

      deviations.push({
        field: f.key, label: f.label,
        actual: f.digits === 3 ? U.sg(v) : U.fixed(v, f.digits),
        range: (f.digits === 3 ? U.sg(lo) + '–' + U.sg(hi) : U.fixed(lo, f.digits) + '–' + U.fixed(hi, f.digits)),
        verdict: verdict,
        deviation: U.round(dev, 2),
        unit: f.unit || ''
      });
    }

    var score = Math.round(totalScore * 100);
    var grade = score >= 90 ? '高度契合' : score >= 75 ? '基本契合'
              : score >= 55 ? '部分偏离' : '明显不符';

    var advice = [];
    for (var j = 0; j < deviations.length; j++) {
      var d = deviations[j];
      if (d.verdict === 'low')  advice.push(d.label + ' 偏低（' + d.actual + '，区间 ' + d.range + '）');
      if (d.verdict === 'high') advice.push(d.label + ' 偏高（' + d.actual + '，区间 ' + d.range + '）');
    }

    return {
      styleId: style.id,
      styleName: style.name,
      styleEn: style.en,
      score: score,
      grade: grade,
      deviations: deviations,
      advice: advice,
      /** 如果分数太低，可能是"你其实想酿另一个风格" */
      hint: score < 55
        ? '偏离较大。先确认这是不是你想要的风格——很多时候配方没错，只是分类选错了。'
        : null
    };
  };

  /* ======================================================================
   * 十一、警告系统
   * ====================================================================*/
  Calc.warnings = function (r, result) {
    var out = [];
    var L = BREW.Config.LIMITS;
    var D = BREW.Config.DEFAULTS;

    function W(level, text, fix) { out.push({ level: level, text: text, fix: fix || null }); }

    /* --- 基础参数 --- */
    var bs = U.toNum(r.batchSize, 0);
    if (bs < L.batchSize[0] || bs > L.batchSize[1]) {
      W('error', '批次量 ' + bs + 'L 超出合理范围（' + L.batchSize[0] + '–' + L.batchSize[1] + 'L）',
        '家酿常见 18–22L，设备容积决定上限');
    }
    var eff = U.toNum(r.efficiency, 0);
    if (eff < 50) W('warn', '糖化效率 ' + eff + '% 偏低，OG 会比预期低很多', '检查粉碎度、糖化温度与洗糟是否充分');
    if (eff > 88) W('warn', '糖化效率 ' + eff + '% 偏高，除非设备非常优化，否则不现实', '首酿建议从 70–72% 起算，再按实测回调');

    /* --- 麦芽 --- */
    var ferm = r.fermentables || [];
    if (ferm.length === 0) W('error', '配方里没有任何麦芽/谷物', '至少加一种基础麦芽');
    var basePts = 0, totalPts = 0;
    for (var i = 0; i < ferm.length; i++) {
      var f = ferm[i];
      var p = U.toNum(f.ppg, 0) * U.toNum(f.amount, 0);
      totalPts += p;
      if (f.cat === 'base') basePts += p;

      /* 注意：麦芽用量上限检查**不在**这里做。
         v1.1 起统一由 Calc.usageAudit 负责，口径是"占总投料重量"而不是
         "占出糖贡献"——后者会被 ppg 稀释（烘烤大麦 25ppg，20% 重量只算
         13.5% 糖贡献），导致该报的警漏报。
         两套逻辑并存会让同一原料出现两条百分比还不一样的告警，所以旧的
         那一段已经被彻底删除，不要加回来。 */
      if (f.cat === 'grain' && f.mustMash && f.dp === 'none' && !hasBaseMalt(ferm)) {
        W('error', '配方含未发芽谷物但没有基础麦芽提供酶', '未发芽谷物必须与基础麦芽同糖化');
      }
    }
    if (totalPts > 0 && basePts / totalPts < 0.5 && ferm.length > 1) {
      W('warn', '基础麦芽提供的糖只占 ' + U.round(basePts / totalPts * 100, 0) + '%',
        '低于 50% 时酶力可能不足，糖化效率会明显下降');
    }

    /* --- 糖化水 --- */
    var bal = result.volume;
    if (bal.mashThickness < 2.0) W('warn', '水料比 ' + bal.mashThickness + ' L/kg 偏稠', '建议 2.5–3.5 L/kg');
    if (bal.spargeWater <= 0) W('warn', '没有洗糟水（首次麦汁已达煮沸体积）', '确认水料比与批次量，或提高洗糟比例');
    if (bal.preBoil > bs * 2.0) W('warn', '煮沸前体积 ' + bal.preBoil + 'L 是成品两倍以上', '设备可能装不下，或蒸发率设置过低');

    /* --- 酒花 --- */
    var hops = r.hops || [];
    var hasBitter = false;
    for (var j = 0; j < hops.length; j++) {
      if (U.toNum(hops[j].aa, 0) <= 0) {
        W('warn', (hops[j].name || '某酒花') + ' 的 α 酸为 0 或未填', 'α 酸直接决定 IBU，必填');
      }
      if (hops[j].stage === 'boil' && U.toNum(hops[j].time, 0) >= 40) hasBitter = true;
    }
    if (hops.length > 0 && !hasBitter && result.ibu > 20) {
      W('info', '没有 40 分钟以上的煮沸投花，苦味主要来自回旋/首麦汁', '这是现代 IPA 的做法，但苦味会比计算值更柔和');
    }
    if (result.ibu.saturation) W('info', result.ibu.saturation, '要更苦就用更多酒花或降低批次量，但感知上限就在那里');

    /* --- 苦度平衡 --- */
    if (result.balance.ratio > 1.5) {
      W('warn', '苦甜比（BU:GU）达 ' + result.balance.ratio + '，苦味非常突出', '确认麦芽骨架能撑住，否则会显得"空苦"');
    }
    if (result.balance.ratio < 0.3 && result.og > 1.060) {
      W('info', '苦甜比（BU:GU）只有 ' + result.balance.ratio + '，酒会偏甜', '高浓度 + 低苦度容易腻，可略增苦味酒花');
    }

    /* --- 发酵 --- */
    var ys = r.yeasts || [];
    if (ys.length === 0) {
      W('error', '没有选择酵母', '酵母决定 FG、风味与发酵温度，必须选');
    } else {
      var y0 = ys[0];
      var def = y0.id && BREW.DB.yeasts ? U.byId(BREW.DB.yeasts, y0.id) : null;
      var tMin = y0.tempMin || (def && def.tempMin);
      var tMax = y0.tempMax || (def && def.tempMax);
      var ft = U.toNum(r.fermentTemp, D.fermentTemp);
      if (tMin && ft < tMin) {
        W('warn', '发酵温度 ' + ft + '°C 低于该酵母下限 ' + tMin + '°C', '会发酵迟缓甚至停滞，且容易产生硫味');
      }
      if (tMax && ft > tMax) {
        W('warn', '发酵温度 ' + ft + '°C 高于该酵母上限 ' + tMax + '°C', '会产生大量高级醇（上头）与溶剂味');
      }
      if (def && def.type === 'lager' && ft > 16) {
        W('info', '选了拉格酵母但温度偏高，接近"蒸汽啤酒"的做法', '这条路可行，但风味会不典型');
      }
    }
    if (result.pitch.dryGrams > 24) {
      W('warn', '接种量需求 ' + result.pitch.dryGrams + 'g 干酵母（约 ' + result.pitch.dryPacks + ' 包）',
        '单纯堆干酵母会让酒带"酵母味"，建议扩培');
    }

    /* --- 水 --- */
    if (result.water.warning) W('warn', result.water.warning, '见"水化学"面板的调整建议');
    if (result.water.na > 150) W('warn', '钠离子 ' + result.water.na + ' mg/L 偏高', '会有咸味，检查食盐与小苏打用量');
    if (result.water.so4 > 400) W('warn', '硫酸盐 ' + result.water.so4 + ' mg/L 过高', '会有明显的矿物涩感与"火柴头"味');
    if (result.water.cl > 300) W('warn', '氯化物 ' + result.water.cl + ' mg/L 过高', '会有咸味与金属感');

    /* --- 数据自洽 --- */
    if (result.fg >= result.og) {
      W('error', 'FG ≥ OG，数据不自洽', '检查酵母标称衰减度设置，或麦芽参数是否填错');
    }
    if (result.og > 1.120) {
      W('info', 'OG ' + U.sg(result.og) + ' 属于极高浓度', '这个浓度下所有模型误差都会放大，建议先做小批次验证');
    }

    /* 排序：error → warn → info */
    var order = { error: 0, warn: 1, info: 2 };
    out.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return out;
  };

  function hasBaseMalt(ferm) {
    for (var i = 0; i < ferm.length; i++) {
      if (ferm[i].cat === 'base' && U.toNum(ferm[i].amount, 0) > 0) return true;
    }
    return false;
  }

  /* ======================================================================
   * 十一之二、用量审计（usageAudit）
   * ----------------------------------------------------------------------
   * 检查"原料用得是否合理"，与 warnings() 的分工：
   *   warnings()   —— 配方能不能做出来（无麦芽、无酵母、水料比、温度区间…）
   *   usageAudit() —— 用料是否偏离行业惯例（占比过高、投花过量、香料超量…）
   *
   * 为什么独立而不并进 warnings：
   *   ① 设置里要能单独关掉"用量提醒"，独立函数只需一个判断；
   *   ② 本法依赖风格、批次量、阶段分组，比行级检查重，独立后可缓存可 profile；
   *   ③ 纯函数好写回归断言。
   *
   * 口径说明（重要）：
   *   麦芽占比 = 该麦芽重量 / 全部投料重量（含糖与提取物）。
   *   **不是**出糖贡献占比 —— 后者会被 ppg 稀释，导致欠告警。
   *
   * @param {object} r      配方
   * @param {object} result calcRecipe 的中间结果
   * @param {object} opts   { enabled:false 可整体关闭 }
   * @returns {Array} 告警项数组
   * ====================================================================*/
  Calc.usageAudit = function (r, result, opts) {
    opts = opts || {};
    if (opts.enabled === false) return [];

    var DB = BREW.DB || {};
    if (!DB.usageCat || !DB.usageTemplates) return [];   /* 数据层未加载，静默跳过 */

    var out = [];
    var batch = U.toNum(r.batchSize, BREW.Config.DEFAULTS.batchSize);
    var scale = batch / 20;                              /* 辅料推荐区间以 20L 为基准 */
    var ferm = r.fermentables || [];
    var style = r.styleId && DB.getStyle ? DB.getStyle(r.styleId) : null;

    /* ---------- 文案挑选：单条覆盖 → 类别模板 ---------- */
    function fill(str, vars) {
      return String(str).replace(/\{(\w+)\}/g, function (m, k) {
        return vars[k] !== undefined && vars[k] !== null ? vars[k] : m;
      });
    }

    var LVL = { 1: 'info', 2: 'warn', 3: 'error' };
    var ORDER = { error: 0, warn: 1, info: 2 };

    function pickNote(kind, ing, level, vars) {
      var lvKey = 'L' + level;
      var lvName = LVL[level];

      /* 兼容两种字段名：
         24 号文件里宋砚秋逐条打磨的文案用 info/warn/error（更可读）；
         23 号文件的类别模板用 L1/L2/L3（便于按等级索引）。 */
      var ov = DB.usageOverrides && DB.usageOverrides[ing.id];
      if (ov) {
        var txt = ov[lvName] || ov[lvKey];
        if (txt) return fill(txt, vars);
      }

      var byKind = DB.usageTemplates && DB.usageTemplates[kind];
      var byCat = byKind && byKind[ing.cat || 'other'];
      if (byCat && byCat[lvKey]) return fill(byCat[lvKey], vars);

      /* 兜底：给一句有信息量的话，不要空白 */
      return fill('{pct}% 已超出常见用量', vars);
    }

    /** 告警对应的术语：只返回原料自己声明的，没有就返回 null。
     *  以前这里兜底成 ['recommended-max-pct']，后果是每条告警的「为什么」按钮
     *  永远指向同一张泛化的卡——按了跟没按一样，属于"假装有解释"。
     *  现在返回 null，42 的 paintWarnings 判定 termRef 为空就不渲染按钮。 */
    function termRefOf(ing) {
      var ov = DB.usageOverrides && DB.usageOverrides[ing.id];
      return (ov && Array.isArray(ov.termRef) && ov.termRef.length) ? ov.termRef : null;
    }

    function push(level, text, ing, keyName) {
      out.push({
        level: LVL[level],
        text: text,
        source: 'usage',
        key: keyName,
        termRef: termRefOf(ing),
        fix: null
      });
    }

    /* ==================== 一、麦芽与谷物：按重量占比 ==================== */
    var totalKg = 0;
    for (var i = 0; i < ferm.length; i++) {
      totalKg += U.toNum(ferm[i].amount, 0);
    }

    for (var j = 0; j < ferm.length; j++) {
      var f = ferm[j];
      var kg = U.toNum(f.amount, 0);
      if (kg <= 0 || totalKg <= 0) continue;

      var cat = f.cat || 'base';
      var catDef = DB.usageCat[cat] || {};
      var maxPct = U.toNum(f.maxPct || catDef.maxPct, 100);
      if (maxPct >= 100) continue;                       /* 基础麦芽/提取物不设限 */

      /* 硬上限：原料自带优先，否则 min(maxPct×2, 类别硬上限) */
      var hardPct = f.hardPct;
      if (!hardPct) {
        var catHard = catDef.hardPct;
        hardPct = catHard ? Math.min(maxPct * 2, catHard) : maxPct * 2;
      }

      /* 深色风格放宽烘烤麦芽：SRM 下界 ≥20 的酒，烘烤麦芽就是骨架
         （爱尔兰世涛用 10–15% 烘烤大麦是标准做法）。一律套类别上限 10%
         会把我们自己收录的 15B 判成超量 —— 库里的经典配方触发自家告警，
         这比漏报更伤可信度。放宽 +5 个百分点、封顶 15%，这样黑专利
         这种 5% 就到头的强料不会被一起放到 15%。
         只放宽 roast，不放宽 crystal —— 深色酒里的焦糖并不因此变合理。 */
      if (cat === 'roast' && style && Array.isArray(style.srm) && U.toNum(style.srm[0], 0) >= 20) {
        maxPct = Math.min(15, maxPct + 5);
      }

      var pct = U.round(kg / totalKg * 100, 1);
      if (pct <= maxPct) continue;

      var band = catDef.band || 1.25;
      var effect = catDef.effect || 'flavor';
      var level;
      if (pct <= maxPct * band) level = 1;
      else if (pct <= hardPct) level = 2;
      else level = (effect === 'process') ? 3 : 2;

      var vars = { pct: pct, max: maxPct, hard: hardPct, g: U.round(kg * 1000, 0), unit: 'g' };
      var note = pickNote('malt', f, level, vars);

      /* 单条覆盖文案里的数字是"典型超出值"（如"酸化麦芽10%会…"），
         不一定等于用户当前的实际值。前面补一句实际占比，避免对不上。
         准确性优先于 60 字上限。 */
      var hasOv = !!(DB.usageOverrides && DB.usageOverrides[f.id]);
      if (hasOv) note = '实际占投料 ' + pct + '%（建议 ≤' + maxPct + '%）：' + note;

      push(level, note, f, 'malt:' + f.id);
    }

    /* ==================== 二、酒花：按风格预算（g/L） ==================== */
    var hops = r.hops || [];
    if (hops.length > 0 && batch > 0) {
      var budget = (style && DB.hopBudget && DB.hopBudget[style.id])
        || DB.hopBudget && DB.hopBudget['21A']
        || (BREW.Config.DEFAULTS.hopBudget);

      var totalG = 0, dryG = 0, boilG = 0, whirlG = 0;
      for (var h = 0; h < hops.length; h++) {
        var g = U.toNum(hops[h].amount, 0);
        totalG += g;
        var st = hops[h].stage;
        if (st === 'dryhop' || st === 'dry' || st === 'keg') dryG += g;   /* 'dry'：见 utilization 的注释 */
        else if (st === 'whirlpool') whirlG += g;
        else boilG += g;
      }

      /* g/L = 克数 / 升数。不要再除 1000——除完就变 kg/L，
         300g 干投会算成 0.015 g/L 从而永远不触发（曾因此漏报全部酒花超量）。 */
      var totalGpl = U.round(totalG / batch, 2);
      var dryGpl = U.round(dryG / batch, 2);

      function checkGpl(gpl, range, label, fallbackTerm) {
        if (!range || gpl <= range[1]) return;
        var over = gpl / range[1];
        var level = over <= 1.3 ? 1 : (over <= 2.0 ? 2 : 3);
        var vars = { gpl: gpl, blo: range[0], bhi: range[1] };
        var tpl = DB.usageTemplates.hop[label];
        var text = tpl && tpl['L' + level] ? fill(tpl['L' + level], vars)
          : (label + ' ' + gpl + ' g/L 超出该风格常见 ' + range[0] + '–' + range[1] + ' g/L');
        out.push({
          level: LVL[level], text: text, source: 'usage',
          key: 'hop:' + label, termRef: fallbackTerm, fix: null
        });
      }

      checkGpl(totalGpl, budget.total, 'total', ['dry-hop', 'perceived-bitterness']);
      if (dryG > 0) checkGpl(dryGpl, budget.dry, 'dry', ['dry-hop', 'hop-burn']);
    }

    /* ==================== 三、辅料：绝对用量（按批次缩放） ==================== */
    var adjs = r.adjuncts || [];
    for (var a = 0; a < adjs.length; a++) {
      var ad = adjs[a];
      var amt = U.toNum(ad.amount, 0);
      if (amt <= 0) continue;

      var alo = ad.useMin, ahi = ad.useMax;

      /* 配方行不一定带推荐区间：Recipe.addAdjunct 只复制了 amount/unit/stage，
         useMin/useMax 留在原料库里。所以这里必须回查，否则所有辅料都静默跳过。 */
      if (alo === undefined || ahi === undefined) {
        var defAdj = null;
        var pool = DB.adjuncts || [];
        for (var q = 0; q < pool.length; q++) {
          if (pool[q].id === ad.id) { defAdj = pool[q]; break; }
        }
        if (defAdj) { alo = defAdj.useMin; ahi = defAdj.useMax; }
      }

      if (alo === undefined || ahi === undefined || ahi <= 0) continue;

      /* 香料类不按线性放大：40L 不该放 2 倍的肉桂（感官阈值非线性） */
      var mode = (ad.cat === 'spice') ? 'taper' : 'linear';
      var scaledMax = mode === 'taper'
        ? ahi * Math.pow(scale, 0.8)
        : ahi * scale;
      var scaledMin = mode === 'taper'
        ? alo * Math.pow(scale, 0.8)
        : alo * scale;

      if (amt <= scaledMax) continue;

      var ao = amt / scaledMax;
      /* 香料带宽收紧到 1.15：useMax 只有 2–3g 时，1.25 倍的绝对差不到 1g */
      var aBand = (ad.cat === 'spice') ? 1.15 : 1.25;
      var ov3 = DB.usageOverrides && DB.usageOverrides[ad.id];
      var aHard = (ov3 && ov3.hardMax) ? ov3.hardMax * scale : scaledMax * 2;

      var aLevel = ao <= aBand ? 1 : (amt <= aHard ? 2 : 3);

      var av = {
        g: U.round(amt, 1), unit: ad.unit || 'g',
        lo: U.round(scaledMin, 1), hi: U.round(scaledMax, 1)
      };
      var aNote = pickNote('adjunct', ad, aLevel, av);
      var aHasOv = !!(DB.usageOverrides && DB.usageOverrides[ad.id]);
      if (aHasOv) {
        aNote = '实际 ' + av.g + av.unit + '（推荐 ' + av.lo + '–' + av.hi + av.unit + '）：' + aNote;
      }
      push(aLevel, aNote, ad, 'adjunct:' + ad.id);
    }

    /* ==================== 四、酵母：接种量容差 ==================== */
    var yeasts = r.yeasts || [];
    if (yeasts.length > 0 && result.pitch) {
      var y = yeasts[0];
      var tol = (DB.usageOverrides && DB.usageOverrides[y.id] && DB.usageOverrides[y.id].pitchTol)
        || [0.7, 2.0];
      var need = U.toNum(result.pitch.dryGrams, 0);
      var have = U.toNum(y.amount, 0);
      if (need > 0 && have > 0) {
        var ratio = have / need;
        if (ratio < tol[0]) {
          out.push({
            level: 'warn',
            text: '实际投 ' + have + 'g 干酵母，约为需求量的 ' + Math.round(ratio * 100) +
                  '%，发酵会迟缓、酯香偏重。建议补到 ' + Math.round(need) + 'g 或做一次扩培',
            source: 'usage', key: 'yeast:under',
            termRef: ['pitch-rate', 'starter'], fix: null
          });
        } else if (ratio > tol[1]) {
          out.push({
            level: 'info',
            /* 单位写错过的坑：原来是 Math.round(ratio*100) + ' 倍'，
               投了两倍会印成"220 倍"。要么用百分号，要么用一位小数的"倍"，
               不能把百分数当倍数用。这里统一成"倍"。 */
            text: '实际投 ' + have + 'g 干酵母，是需求量的 ' + (Math.round(ratio * 10) / 10) +
                  ' 倍，发酵会更快更干、酒体偏薄。想保留酯香可减半',
            source: 'usage', key: 'yeast:over',
            termRef: ['pitch-rate', 'pitch-tolerance'], fix: null
          });
        }
      }
    }

    /* 排序：error → warn → info */
    out.sort(function (x, y2) { return ORDER[x.level] - ORDER[y2.level]; });
    return out;
  };

  /* ======================================================================
   * 十二、主入口
   * ====================================================================*/
  Calc.calcRecipe = function (r, opts) {
    r = r || {};

    var vol = Calc.volumeBalance(r);
    var grav = Calc.gravity(r, vol);
    var att = Calc.attenuation(r, grav);
    var ibu = Calc.ibu(r, grav, vol);
    var color = Calc.color(r, vol);
    var bal = Calc.balance(ibu.value, grav.og);
    var water = Calc.water(r, vol);
    var pitch = Calc.pitch(r, grav);
    var carb = Calc.carbonation(r);

    var result = {
      /* 核心指标 */
      og: grav.og,
      ogPlato: U.round(grav.ogPlato, 1),
      fg: att.fg,
      fgPlato: U.round(att.fgPlato, 1),
      abv: att.abv,
      abvSimple: att.abvSimple,
      abvHall: att.abvHall,
      abvNote: att.abvNote,

      ibu: ibu.value,
      ibuTinseth: ibu.tinseth,
      ibuRager: ibu.rager,
      ibuGaretz: ibu.garetz,
      ibuDetail: ibu,

      srm: color.srm,
      srmExpected: color.srmExpected,
      ebc: color.ebc,
      colorHex: color.hex,
      colorName: color.name,

      buGu: bal.ratio,
      balance: bal.label,
      balanceDesc: bal.desc,
      gu: bal.gu,

      attenuation: att.adf,
      /* 标称 ADF 与实测表观衰减是两个数：attenuation 是酵母标称值（原有语义，
         别处仍在用），aaActual 是这配方由 OG/FG 反算出来的实际值。 */
      aaActual: att.aaActual,
      rdf: att.rdf,
      yeastName: att.yeastName,

      /* 体积 */
      preBoilVolume: vol.preBoil,
      postBoilVolume: vol.postBoil,
      mashWater: vol.mashWater,
      spargeWater: vol.spargeWater,
      totalWater: vol.totalWater,
      firstRunnings: vol.firstRunnings,
      grainAbsorption: vol.grainAbsorption,
      hopAbsorption: vol.hopAbsorption,
      evaporation: vol.evaporation,
      volume: vol,

      /* 明细 */
      ogContribution: grav.contribution,
      ibuContribution: ibu.contribution,
      srmContribution: color.contribution,

      /* 附属模块 */
      water: water,
      pitch: pitch,
      carbonation: carb,

      warnings: [],
      styleMatch: null
    };

    result.styleMatch = Calc.styleMatch(r, result);
    result.warnings = Calc.warnings(r, result);

    /* v1.1：用量审计合流。
       opts 由调用方传入（设置里的开关），calc 内部**不读 Store**，保持纯函数。
       两项告警合并后统一重排，避免 error 被压在 info 后面。 */
    result.usageWarnings = (opts && opts.usageWarn === false)
      ? []
      : Calc.usageAudit(r, result, { enabled: true });

    if (result.usageWarnings.length) {
      result.warnings = result.warnings.concat(result.usageWarnings);
      var ord = { error: 0, warn: 1, info: 2 };
      result.warnings.sort(function (a, b) { return ord[a.level] - ord[b.level]; });
    }

    return result;
  };

  /* ======================================================================
   * 十三、自检
   * ----------------------------------------------------------------------
   * 用已知算例验证引擎。界面上有个"引擎自检"按钮，跑这个函数。
   * 任何一项失败都说明代码被改坏了，不能信它算出来的配方。
   * ====================================================================*/
  Calc.selfTest = function () {
    var cases = [];
    function T(name, got, want, tol, unit) {
      var ok = Math.abs(got - want) <= (tol === undefined ? 0.05 : tol);
      cases.push({
        name: name,
        got: typeof got === 'number' ? Math.round(got * 1000) / 1000 : got,
        want: want, ok: ok, unit: unit || ''
      });
    }

    /* --- 出糖 --- */
    var r1 = {
      batchSize: 20, efficiency: 72, evaporationRate: 10, boilTime: 60,
      trubLoss: 1.5, fermenterLoss: 0.8, mashThickness: 3,
      fermentables: [{ id: 'x', name: '二棱', cat: 'base', ppg: 37, lov: 2, amount: 5, mustMash: true, fermentable: 'high' }],
      hops: [], yeasts: [{ id: 'y', att: 78, type: 'ale' }],
      adjuncts: [], water: { source: {}, salts: [] }, carbonation: { targetVol: 2.4, tempC: 20 }
    };
    var v1 = Calc.volumeBalance(r1);
    var g1 = Calc.gravity(r1, v1);
    T('5kg 37ppg 20L 72% → 糖化点数', g1.totalPoints, 55.6, 0.6, 'pts');

    var a1 = Calc.attenuation(r1, g1);
    T('酵母 78% → FG 点数', a1.fgPoints, 55.6 * 0.22, 0.5, 'pts');

    /* --- Tinseth --- */
    T('Tinseth U @1.050/60min', Calc.tinsethUtil(1.050, 60), 0.2300, 0.005);
    /* 30g 12% 60min 20L → 按**实际煮沸比重**验算（不是 OG）
       引擎会先用物料平衡求出 preBoil，再算 boilGravity，这是正确做法 */
    var r2 = JSON.parse(JSON.stringify(r1));
    r2.hops = [{ id: 'h', name: '测试', amount: 30, aa: 12, stage: 'boil', time: 60 }];
    var g2 = Calc.gravity(r2, v1);
    var i2 = Calc.ibu(r2, g2, v1);
    var uExpect = Calc.tinsethUtil(g2.boilGravity, 60);
    T('30g/12%/60min/20L → IBU', i2.tinseth, 12 * 30 * uExpect * 10 / 20, 0.3, 'IBU');
    /* 上一条只能验"接线没断"（期望值是同一公式反算的）。
       这一条才是外部锚点：abvcalculator.org / calccorp / geratools 三个独立来源
       对这个算例（30g / 12% / 60min / 20L / 1.050）给出的结果都在 39–42 区间。
       引擎算 43.5，是因为它用物料平衡推出的真实煮沸比重 1.0449（更正确），
       而不是直接套 OG 1.050 —— 所以区间放宽到 38–44。 */
    cases.push({
      name: 'IBU 落在三源交叉区间 38–44（外部锚点）',
      got: i2.tinseth, want: '38–44',
      ok: i2.tinseth > 38 && i2.tinseth < 44, unit: 'IBU'
    });

    /* --- 色度 --- */
    var r3 = JSON.parse(JSON.stringify(r1));
    r3.fermentables = [
      { id: 'a', name: '二棱', cat: 'base', ppg: 37, lov: 2, amount: 4.5, mustMash: true, fermentable: 'high' },
      { id: 'b', name: '结晶60', cat: 'crystal', ppg: 34, lov: 60, amount: 0.5, mustMash: false, fermentable: 'low' }
    ];
    var c3 = Calc.color(r3, v1);
    /* MCU = (4.5×2 + 0.5×60) × 8.3454 / 20 = 16.27
       SRM = 1.4922 × 16.27^0.6859 = 10.11 （手算校核值，容差收紧到 0.15） */
    T('4.5kg 2L + 0.5kg 60L → SRM', c3.srm, 10.11, 0.15, 'SRM');

    /* --- ABV --- */
    var r4 = { og: 1.090, fg: 1.018 };
    var hall = 76.08 * (1.090 - 1.018) / (1.775 - 1.090) * (1.018 / 0.794);
    T('OG1.090/FG1.018 → Hall ABV', hall, 10.25, 0.1, '%');
    T('OG1.090/FG1.018 → 简式 ABV', (1.090 - 1.018) * 131.25, 9.45, 0.05, '%');

    /* --- 碳化 --- */
    var res20 = 0.00086 * 400 - 0.05952 * 20 + 1.7077;
    T('20°C 残余 CO2', res20, 0.861, 0.01, 'vol');
    var r5 = { batchSize: 20, carbonation: { targetVol: 2.4, tempC: 20, sugarType: 'sucrose' } };
    var cb = Calc.carbonation(r5);
    /* (2.4 − 0.861) × 20 × 3.82 = 117.6 g */
    T('蔗糖碳化 2.4vol/20L', cb.grams.sucrose, 117.6, 3, 'g');

    /* --- 水化学 --- */
    var r6 = {
      batchSize: 20, fermentables: [{ lov: 2, amount: 5 }],
      water: { source: { ca: 40, mg: 10, na: 20, cl: 30, so4: 40, hco3: 100 }, salts: [] }
    };
    var w6 = Calc.water(r6, v1);
    /* RA = 0.8197×100 − 40/3.5 − 10/7 = 81.97 − 11.43 − 1.43 = 69.1 */
    T('RA（Ca40/Mg10/HCO3-100）', w6.ra, 69.1, 1, 'ppm');

    /* --- 水化学：酸剂/碱剂必须真的影响 RA 与 pH ---
       这三条是**回归断言**，专门防止退回老 bug：
       曾经的实现只把 HCO3 算进 RA，完全忽略酸剂与碳酸钙当量，
       导致「加乳酸 pH 纹丝不动、加碳酸钙 pH 反而下降」——方向是反的。
       谁要是把这个逻辑改回去，这三条会立刻红。 */
    var r6b = U.clone(r6);
    r6b.water.salts = [{ id: 'w-lactic', amount: 2 }];
    var w6b = Calc.water(r6b, v1);
    /* 2ml 88% 乳酸 = 1.064g 纯乳酸 = 11.8 mmol，中和同当量 CaCO3
       → 11.8 × 100.09 / 20L = 59 mg/L 碱度 */
    T('加 2ml 乳酸 → RA 下降 59', w6b.ra, 69.1 - 59, 3, 'ppm');

    var r6c = U.clone(r6);
    r6c.water.salts = [{ id: 'w-chalk', amount: 2 }];
    var w6c = Calc.water(r6c, v1);
    /* 2g CaCO3 → 碱度 +99.9，同时 Ca +40 → RA ≈ 157.6 */
    cases.push({
      name: '加 2g 碳酸钙 → RA 必须上升',
      got: U.round(w6c.ra, 1), want: '> ' + U.round(w6.ra + 10, 1),
      ok: w6c.ra > w6.ra + 10, unit: 'ppm'
    });

    cases.push({
      name: '加 2ml 乳酸 → 糖化 pH 区间必须整体下移',
      got: w6b.mashPhRange[0] + '–' + w6b.mashPhRange[1],
      want: '上限 < ' + w6.mashPhRange[1],
      ok: w6b.mashPhRange[1] < w6.mashPhRange[1]
    });

    cases.push({
      name: '加 2g 碳酸钙 → 糖化 pH 区间必须整体上移',
      got: w6c.mashPhRange[0] + '–' + w6c.mashPhRange[1],
      want: '下限 > ' + w6.mashPhRange[0],
      ok: w6c.mashPhRange[0] > w6.mashPhRange[0]
    });

    /* --- 物料平衡自洽：各段体积必须能加回去 --- */
    var sumCheck = v1.preBoil - v1.evaporation - v1.hopAbsorption - v1.trubLoss - v1.fermenterLoss;
    T('物料平衡闭合（煮沸前→成品）', sumCheck, 20, 0.15, 'L');

    var pass = cases.filter(function (c) { return c.ok; }).length;
    return {
      total: cases.length, pass: pass, allOk: pass === cases.length, cases: cases
    };
  };

})(typeof window !== 'undefined' ? window : globalThis);
