/* ============================================================================
 * 风月酿研所 — 25 感知苦度模型（Perceived Bitterness）
 * ----------------------------------------------------------------------------
 * 职责：把「IBU 数字」翻译成「喝起来有多苦」的区间估计。
 *
 * 为什么需要它：70 IBU 的浑浊 IPA 和 70 IBU 的西海岸 IPA 喝起来完全不同。
 *   IBU 是异 α 酸的化学量，而苦感还取决于：
 *     · 残糖（FG）—— 糖会包裹苦味，干型酒苦感更"露"
 *     · 硫酸盐 —— SO4 拉高苦味的清晰度与锐利度
 *     · 干投量 —— 大量多酚与酒花基质会把苦感"糊"住，反而降低感知苦度
 *     · 碳化度 —— 气泡的刺痛感会放大苦感
 *
 * 口径（必须原样传给界面，不许改写成"测量值"）：
 *   这是**模型估算区间**，不是测量值，也不是感官校准过的结果。
 *   方向有文献与酿造实践支撑，倍率是工程近似。
 *
 * 纯度：只吃入参、只吐返回值。不读 DOM / Store / Calc 全局状态，不取当前时间。
 *
 * 前置依赖：00-core（可选：只用它的 Util；缺失时用本文件内置兜底）
 * 加载位置：应在 js/24-data-usage-overrides.js 之后、js/30-recipe.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var Perceived = BREW.Perceived = {};

  /* 00 未加载时（例如单独 require 本文件）用内置兜底，保证"单独加载不报错" */
  var U = (BREW.Util && typeof BREW.Util.round === 'function') ? BREW.Util : {
    toNum: function (v, d) {
      var n = parseFloat(v);
      return isFinite(n) ? n : (d === undefined ? 0 : d);
    },
    round: function (v, d) {
      var p = Math.pow(10, d || 0);
      return Math.round(v * p) / p;
    },
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); }
  };

  var MODEL = 'perceived-bitterness-v1';

  /* ======================================================================
   * 一、因子定义
   * ----------------------------------------------------------------------
   * 每个因子都返回 { key, label, mult, why }：
   *   mult 是乘在 IBU 上的系数，why 是给人看的一句话（必须带具体数值，
   *   否则用户没法判断这个结论是不是针对他的配方）。
   * 所有 mult 都夹在 [0.70, 1.30] 内——超出这个范围的修正已经不是"感知差异"，
   * 而是模型在替用户编故事。
   * ====================================================================*/

  /** 残糖因子：以 FG 1.014 为中性点，每高 0.004 降 4%，每低 0.004 升 3% */
  function factorResidual(fg) {
    var steps = (fg - 1.014) / 0.004;
    var m = 1 - steps * 0.04;
    m = U.clamp(m, 0.82, 1.10);
    var why;
    if (fg > 1.018) {
      why = '残糖偏高（FG ' + U.round(fg, 3) + '），糖体包裹苦味，实际苦感低于 IBU 数字';
    } else if (fg < 1.010) {
      why = '收口很干（FG ' + U.round(fg, 3) + '），苦味没有糖体缓冲，苦感更"露"';
    } else {
      why = '残糖居中（FG ' + U.round(fg, 3) + '），对苦感基本中性';
    }
    return { key: 'residual', label: '残糖', mult: U.round(m, 3), why: why };
  }

  /** 硫酸盐因子：150–250 为"清晰"区间（×1.05），>350 到 ×1.12，<100 略微钝化 */
  function factorSulfate(so4) {
    var m;
    if (so4 <= 100) m = 0.95;
    else if (so4 <= 150) m = 0.95 + (so4 - 100) / 50 * 0.10;      /* 0.95 → 1.05 */
    else if (so4 <= 250) m = 1.05;
    else if (so4 <= 350) m = 1.05 + (so4 - 250) / 100 * 0.07;     /* 1.05 → 1.12 */
    else m = 1.12;
    m = U.clamp(m, 0.95, 1.12);
    var why;
    if (so4 >= 350) why = '硫酸盐 ' + U.round(so4, 0) + ' ppm 很高，苦味锐利、收口干（注意别过 400，会涩）';
    else if (so4 >= 150) why = '硫酸盐 ' + U.round(so4, 0) + ' ppm，苦味清晰度被拉高';
    else why = '硫酸盐 ' + U.round(so4, 0) + ' ppm 偏低，苦味偏"圆"、不够锐';
    return { key: 'sulfate', label: '硫酸盐', mult: U.round(m, 3), why: why };
  }

  /** 干投因子：>3 g/L 开始压低苦感，>8 g/L 到 0.85 */
  function factorDryHop(gPerL) {
    var m;
    if (gPerL <= 3) m = 1;
    else if (gPerL <= 8) m = 1 - (gPerL - 3) / 5 * 0.15;          /* 1.00 → 0.85 */
    else m = 0.85;
    m = U.clamp(m, 0.85, 1);
    var why = gPerL > 0.05
      ? '干投 ' + U.round(gPerL, 1) + ' g/L' + (gPerL > 3
        ? '，酒花基质与多酚把苦感"糊"住，喝起来比 IBU 低'
        : '，对苦感影响很小')
      : '没有干投，苦感不被酒花基质遮蔽';
    return { key: 'dryhop', label: '干投量', mult: U.round(m, 3), why: why };
  }

  /** 碳化因子：2.2 vol 以下中性，2.6 以上气泡刺痛放大苦感，最高 ×1.06 */
  function factorCarbonation(vol) {
    var m;
    if (vol <= 2.2) m = 1;
    else if (vol <= 3.0) m = 1 + (vol - 2.2) / 0.8 * 0.06;         /* 1.00 → 1.06 */
    else m = 1.06;
    m = U.clamp(m, 1, 1.06);
    var why = vol > 2.6
      ? '碳化 ' + U.round(vol, 1) + ' vol 偏高，气泡的刺痛感会放大苦味'
      : '碳化 ' + U.round(vol, 1) + ' vol，对苦感影响可忽略';
    return { key: 'carbonation', label: '碳化度', mult: U.round(m, 3), why: why };
  }

  /* ======================================================================
   * 二、取数（只读入参）
   * ====================================================================*/

  /** 优先用 calc.water 已算好的离子；没有就按配方自己推一遍（与 20-calc 同口径） */
  function ionOf(calc, recipe, k) {
    if (calc && calc.water && isFinite(calc.water[k])) return U.toNum(calc.water[k], 0);

    var w = (recipe && recipe.water) || {};
    var src = w.source || {};
    var v = U.toNum(src[k], 0);

    var vol = U.toNum(recipe && recipe.batchSize, 20);
    if (vol <= 0) vol = 20;
    var salts = w.salts || [];
    var pool = (BREW.DB && BREW.DB.waterSalts) || [];

    for (var i = 0; i < salts.length; i++) {
      var s = salts[i] || {};
      var def = s.ion ? s : null;
      if (!def) {
        for (var j = 0; j < pool.length; j++) if (pool[j].id === s.id) { def = pool[j]; break; }
      }
      if (!def || !def.ion) continue;
      /* 数据是"每克每 20L"，按实际批次量缩放 */
      v += (def.ion[k] || 0) * U.toNum(s.amount, 0) * (20 / vol);
    }
    return v;
  }

  function dryHopRate(recipe) {
    var hops = (recipe && recipe.hops) || [];
    var vol = U.toNum(recipe && recipe.batchSize, 20);
    if (vol <= 0) vol = 20;
    var g = 0;
    for (var i = 0; i < hops.length; i++) {
      if (!hops[i]) continue;
      if (String(hops[i].stage || '') !== 'dryhop') continue;
      g += U.toNum(hops[i].amount, 0);
    }
    return g / vol;
  }

  /* ======================================================================
   * 三、主函数
   * ----------------------------------------------------------------------
   * @param {object} calc    Calc.calcRecipe 的返回值（至少要有 ibu / fg / water）
   * @param {object} recipe  配方对象（取 batchSize / hops / carbonation / water）
   * @returns {{
   *   low:number, high:number, mid:number,
   *   factors:Array<{key:string,label:string,mult:number,why:string}>,
   *   confidence:'low',
   *   label:string, disclaimer:string, inputs:object, warnings:string[]
   * }}
   *   ⚠️ 这是**模型估算区间**。界面必须原样显示 label 与 disclaimer，
   *      不许把它写成"感知苦度 54 IBU"这种看起来像测量值的说法。
   * ====================================================================*/
  Perceived.estimate = function (calc, recipe) {
    calc = calc || {};
    recipe = recipe || {};

    var warnings = [];
    var ibu = U.toNum(calc.ibu, 0);
    var fg = U.toNum(calc.fg, 1.012);
    var so4 = ionOf(calc, recipe, 'so4');
    var dh = dryHopRate(recipe);
    var carb = U.toNum((recipe.carbonation || {}).targetVol, 2.4);

    if (ibu <= 0) warnings.push('IBU 为 0（没加酒花或计算缺数据），感知苦度无意义');
    if (!isFinite(calc.fg)) warnings.push('缺少 FG，残糖因子按 1.012 计算');

    var factors = [
      factorResidual(fg),
      factorSulfate(so4),
      factorDryHop(dh),
      factorCarbonation(carb)
    ];

    var product = 1;
    for (var i = 0; i < factors.length; i++) product *= factors[i].mult;

    var mid = U.round(ibu * product, 1);
    /* 区间宽度：基准 ±10%，因子被夹到边界时（说明配方在极端区间）再加 3%，最多 ±18% */
    var atCap = 0;
    if (factors[0].mult <= 0.821 || factors[0].mult >= 1.099) atCap++;
    if (factors[1].mult >= 1.119 || factors[1].mult <= 0.951) atCap++;
    if (factors[2].mult <= 0.851) atCap++;
    var spread = U.clamp(0.10 + 0.03 * atCap, 0.10, 0.18);

    var low = U.round(mid * (1 - spread), 1);
    var high = U.round(mid * (1 + spread), 1);
    if (low < 0) low = 0;
    if (high < low) high = low;

    return {
      low: low,
      high: high,
      mid: mid,
      factors: factors,
      confidence: 'low',

      /* ---- 展示用增强字段（未改契约签名，只是附加） ---- */
      model: MODEL,
      label: '模型估算区间',
      disclaimer: '这是按残糖、硫酸盐、干投量与碳化度做的模型估算，不是测量值，' +
        '也没有经过感官校准。原始 IBU ' + U.round(ibu, 1) + ' 才是可对照的化学量。',
      inputs: {
        ibu: U.round(ibu, 1),
        fg: U.round(fg, 3),
        so4: U.round(so4, 1),
        dryHopGPerL: U.round(dh, 2),
        carbonationVol: U.round(carb, 2)
      },
      warnings: warnings
    };
  };

  /* ======================================================================
   * 四、自检（供 tools/selftest.js 与 tools/test-calc-v12.js 调用）
   * ====================================================================*/
  Perceived.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    /* 1. 正常值：70 IBU 的浑浊 IPA —— 残糖偏高 + 干投量大 → 苦感明显低于 IBU */
    var r1 = Perceived.estimate(
      { ibu: 70, fg: 1.018, water: { so4: 80 } },
      { batchSize: 20, hops: [{ stage: 'dryhop', amount: 240 }], carbonation: { targetVol: 2.4 } }
    );
    ok('浑浊 IPA 感知苦度应低于 70', r1.mid < 70 && r1.mid > 40, 'mid=' + r1.mid);
    ok('区间有序 low<=mid<=high', r1.low <= r1.mid && r1.mid <= r1.high);
    ok('四个因子齐全', r1.factors.length === 4);
    ok('confidence 恒为 low', r1.confidence === 'low');

    /* 1b. 反例：同样的 70 IBU，干型 + 高硫酸盐 + 几乎不干投 → 苦感高于 IBU。
           这一条是模型的核心主张，必须能演示出来，不能只做"往低里算"。 */
    var r1b = Perceived.estimate(
      { ibu: 70, fg: 1.008, water: { so4: 300 } },
      { batchSize: 20, hops: [], carbonation: { targetVol: 2.6 } }
    );
    ok('干型高硫 IPA 感知苦度应高于 70', r1b.mid > 70, 'mid=' + r1b.mid);

    /* 2. 边界：0 IBU 不该崩，也不该出负数 */
    var r2 = Perceived.estimate({ ibu: 0, fg: 1.020 }, {});
    ok('0 IBU 结果非负', r2.low >= 0 && r2.mid === 0 && r2.high === 0);
    ok('0 IBU 有警告', r2.warnings.length > 0);

    /* 3. 脏输入：null / undefined / 字符串数值 */
    var r3 = Perceived.estimate(null, null);
    ok('null 入参不崩', r3 && r3.mid === 0 && r3.factors.length === 4);
    var r4 = Perceived.estimate({ ibu: '55', fg: '1.008' }, { batchSize: '20' });
    ok('字符串数值能消化', r4.mid > 0 && isFinite(r4.mid));

    /* 4. 因子取值域 */
    var r5 = Perceived.estimate({ ibu: 100, fg: 1.030, water: { so4: 600 } }, {
      batchSize: 20, hops: [{ stage: 'dryhop', amount: 300 }], carbonation: { targetVol: 4 }
    });
    for (var i = 0; i < r5.factors.length; i++) {
      var m = r5.factors[i].mult;
      if (!(m >= 0.7 && m <= 1.3)) errors.push('因子 ' + r5.factors[i].key + ' 越界：' + m);
    }
    total++;

    /* 5. 单调性：其它不变，FG 越高苦感越低 */
    var dry = Perceived.estimate({ ibu: 60, fg: 1.006 }, {});
    var sweet = Perceived.estimate({ ibu: 60, fg: 1.026 }, {});
    ok('FG 越高感知苦度越低', sweet.mid < dry.mid, dry.mid + ' vs ' + sweet.mid);

    /* 6. 免责声明必须存在（界面的硬要求） */
    ok('带 label 与 disclaimer', r1.label === '模型估算区间' && /不是测量值/.test(r1.disclaimer));

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
