/* ============================================================================
 * 风月酿研所 — 26 酵母分步扩培（Step Starter）
 * ----------------------------------------------------------------------------
 * 职责：按目标接种量反算「需要几步、每步多少麦汁、多少 DME、预计收获多少细胞」。
 *
 * 为什么单独一个模块：20-calc 的 Calc.pitch 只回答「要几包」，而高浓度配方
 * （帝国世涛、大麦酒、双料博克）必须扩培。扩培是多步的，步与步之间体积会变，
 * 而且活性随酵母生产日期衰减——这些都不该塞进 Calc.pitch。
 *
 * 模型口径（保守，给的是可用方案而不是理论最大值）：
 *   · 每步增长倍率：磁力搅拌 2.4×、静置 1.6×（实际区间 2.4–3.0 / 1.5–2.0）
 *   · 每步麦汁目标比重 1.038（10 °P 附近），约 95 g DME / L
 *   · 每步体积比不超过 1:4（再大溶氧与营养跟不上，细胞反而长得少）
 *   · 活性衰减：每满一个月约降 10%，下限 10%
 *
 * 纯度：只吃入参、只吐返回值。**不取当前时间**——需要判断"酵母放了多久"时，
 *       由调用方把 now 传进来（不传就按新鲜算并给警告）。
 *
 * 前置依赖：00-core（可用可不用）、12-data-yeast.js（读 pitchRates 与干酵母细胞数，缺失时用内置常量）
 * 加载位置：应在 js/24-data-usage-overrides.js 之后、js/30-recipe.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var Starter = BREW.Starter = {};

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

  var DEFAULT_RATES = { ale: 0.75, lager: 1.5, wheat: 0.75, belgian: 0.75, hybrid: 1.0, sour: 0.5, brett: 0.5 };
  var DME_PER_LITER = 95;        /* 达到 1.038 大约需要 95 g/L DME */
  var STARTER_GRAVITY = 1.038;
  var MONTH_MS = 30 * 24 * 3600 * 1000;

  /** SG → °P（ASBC 多项式，与 05-units 同式，避免为了一个换算去依赖 05） */
  function sgToPlato(sg) {
    var s = U.toNum(sg, 1.04);
    return -616.868 + 1111.14 * s - 630.272 * s * s + 135.997 * s * s * s;
  }

  function rateOf(type) {
    var rates = (BREW.DB && BREW.DB.pitchRates) || DEFAULT_RATES;
    var t = String(type || 'ale').toLowerCase();
    if (t === 'hybrid') t = 'ale';
    var r = rates[t];
    if (!isFinite(r)) r = t === 'lager' ? 1.5 : 0.75;
    return r;
  }

  function dryCellsPerGram() {
    var v = BREW.DB && BREW.DB.dryYeastCellsPerGram;
    return isFinite(v) && v > 0 ? v : 15;
  }

  /**
   * 生产日期 → 时间戳。支持毫秒数与 'YYYY-MM-DD'。
   * 这里只用 Date.parse 解析**用户给的日期**，不读当前时间，保持纯函数。
   */
  function timeOf(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number' && isFinite(v)) return v > 1e12 ? v : v * 1000;
    var t = Date.parse(String(v));
    return isFinite(t) ? t : 0;
  }

  /* ======================================================================
   * 主函数
   * ----------------------------------------------------------------------
   * @param {object} opts
   *   volumeL   批次体积（L）
   *   og        目标起始比重
   *   form      'liquid' | 'dry'
   *   packs     现有包数（干酵母按 11g/包，液体按 100B/包）
   *   producedAt 生产日期（毫秒时间戳或 'YYYY-MM-DD'，可选）
   *   now       评估基准时间（毫秒时间戳，可选；不传=按新鲜算）
   *   stirPlate 是否磁力搅拌（默认 true）
   *   maxSteps  最多几步（默认 3，上限 6）
   *   type      酵母类型 ale/lager/hybrid（可选，默认 ale）
   * @returns {{
   *   steps:Array<{volL:number,dmeG:number,startB:number,endB:number,gravity:number}>,
   *   totalDmeG:number, warnings:string[],
   *   requiredB:number, startB:number, finalB:number, viability:number, growth:number, note:string
   * }}
   * ====================================================================*/
  Starter.plan = function (opts) {
    opts = opts || {};

    var warnings = [];
    var volumeL = U.clamp(U.toNum(opts.volumeL, 20), 1, 200);
    var og = U.clamp(U.toNum(opts.og, 1.050), 1.005, 1.200);
    var form = String(opts.form || 'liquid') === 'dry' ? 'dry' : 'liquid';
    var packs = Math.max(0, U.toNum(opts.packs, 1));
    var stirPlate = opts.stirPlate !== false;
    var maxSteps = Math.floor(U.clamp(U.toNum(opts.maxSteps, 3), 1, 6));
    var type = opts.type || 'ale';

    /* ---- 活性 ---- */
    var now = timeOf(opts.now);
    var produced = timeOf(opts.producedAt);
    var viability = 1, months = 0;
    if (now > 0 && produced > 0 && now > produced) {
      months = (now - produced) / MONTH_MS;
      viability = U.clamp(1 - months * 0.10, 0.10, 1);
    } else if (produced > 0 && now === 0) {
      warnings.push('没有传入评估基准时间（now），按新鲜酵母计算。实际请按生产日期折算活性——' +
        '放了半年的液体酵母可能只剩一半活细胞');
    }

    /* ---- 现有细胞数（十亿） ---- */
    var startB = form === 'dry'
      ? packs * 11 * dryCellsPerGram() * viability
      : packs * 100 * viability;

    /* ---- 需求细胞数（十亿） ---- */
    var plato = sgPlatoSafe(og);
    var rate = rateOf(type);
    var requiredB = rate * plato * volumeL;

    var growth = stirPlate ? 2.4 : 1.6;
    var out = {
      steps: [],
      totalDmeG: 0,
      warnings: warnings,
      requiredB: U.round(requiredB, 0),
      startB: U.round(startB, 1),
      finalB: U.round(startB, 1),
      viability: U.round(viability, 2),
      growth: growth,
      note: '扩培倍率与是否搅拌强相关：静置 1.5–2.0×、磁力搅拌 2.4–3.0×。' +
        '本方案按' + (stirPlate ? '搅拌 2.4×（保守）' : '静置 1.6×（保守）') + '估算。'
    };

    if (!(startB > 0)) {
      warnings.push('没有可用酵母（packs=0），无法给出扩培方案');
      return out;
    }

    if (months > 6) {
      warnings.push('酵母出厂已约 ' + Math.round(months) + ' 个月，活细胞可能不足 30%，' +
        '不建议扩培（扩培会放大染菌与突变风险），建议直接买新酵母');
    } else if (viability < 0.6) {
      warnings.push('按生产日期估算活性约 ' + U.round(viability * 100, 0) + '%，' +
        '建议先做一步小扩培确认起发，再决定是否继续');
    }

    if (og >= 1.080) {
      warnings.push('OG ' + U.round(og, 3) + ' 属高糖麦汁：接种量应上浮 20–50%，' +
        '并在接种时充分充氧（高糖麦汁溶氧不足是发酵停滞的头号原因）');
    }

    if (startB >= requiredB) {
      warnings.push('现有酵母约 ' + U.round(startB, 0) + ' B，已达到需求 ' +
        U.round(requiredB, 0) + ' B，不需要扩培');
      return out;
    }

    /* ---- 逐步推进 ---- */
    var cur = startB;
    var vol = 1.0;                       /* 首步麦汁 1L，之后翻倍，最大 4L */
    var guard = 0;
    while (cur < requiredB && out.steps.length < maxSteps && guard < 20) {
      guard++;
      var next = cur * growth;
      var stepVol = Math.min(vol, 4);
      out.steps.push({
        volL: U.round(stepVol, 1),
        dmeG: Math.round(DME_PER_LITER * stepVol),
        startB: U.round(cur, 1),
        endB: U.round(next, 1),
        gravity: STARTER_GRAVITY
      });
      out.totalDmeG += Math.round(DME_PER_LITER * stepVol);
      cur = next;
      vol = Math.min(vol * 2, 4);
      if (vol > 4) vol = 4;
    }

    out.finalB = U.round(cur, 1);

    if (cur < requiredB) {
      warnings.push('受 maxSteps=' + maxSteps + ' 限制，扩培后约 ' + U.round(cur, 0) +
        ' B，仍差 ' + U.round(requiredB - cur, 0) + ' B。' +
        '可以加一步、换更大容器，或补一包同菌株酵母');
    }

    return out;
  };

  function sgPlatoSafe(sg) {
    var p = sgToPlato(sg);
    return isFinite(p) && p > 0 ? p : 12;
  }

  /* ======================================================================
   * 自检
   * ====================================================================*/
  Starter.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    /* 1. 正常值：20L 1.050 艾尔，一包液体酵母 */
    var a = Starter.plan({ volumeL: 20, og: 1.050, form: 'liquid', packs: 1, stirPlate: true, type: 'ale' });
    ok('20L/1.050 艾尔需要 1 步', a.steps.length === 1, 'steps=' + a.steps.length);
    ok('需求细胞数约 180B', Math.abs(a.requiredB - 180) <= 10, String(a.requiredB));
    ok('每步 DME 为正', a.steps[0].dmeG > 0 && a.totalDmeG === a.steps[0].dmeG);
    ok('每步比重是 1.038', a.steps[0].gravity === 1.038);
    ok('细胞数单调递增', a.steps[0].endB > a.steps[0].startB);

    /* 2. 边界：maxSteps 用尽仍不够 → warnings 非空、steps 非空 */
    var b = Starter.plan({
      volumeL: 40, og: 1.100, form: 'liquid', packs: 1, stirPlate: false, maxSteps: 1, type: 'lager'
    });
    ok('maxSteps 用尽仍有步骤', b.steps.length === 1);
    ok('maxSteps 用尽必须有警告', b.warnings.length > 0);
    ok('maxSteps 用尽 finalB 仍低于需求', b.finalB < b.requiredB);

    /* 3. 边界：已有酵母足够 → 0 步 */
    var c = Starter.plan({ volumeL: 10, og: 1.040, form: 'dry', packs: 2, maxSteps: 3 });
    ok('酵母足够时不出步骤', c.steps.length === 0);
    ok('酵母足够时有提示', c.warnings.length > 0);

    /* 4. 脏输入：packs=0 / 全 null / 字符串 */
    var d = Starter.plan({ packs: 0 });
    ok('packs=0 不崩且不循环', d.steps.length === 0 && d.warnings.length > 0);
    var e = Starter.plan(null);
    ok('null 入参不崩', e && Array.isArray(e.steps));
    var f = Starter.plan({ volumeL: '20', og: '1.052', packs: '2', form: 'dry', type: 'lager' });
    ok('字符串入参能消化', f.requiredB > 0 && f.startB > 0);

    /* 5. 活性衰减可复现（不读当前时间：now 由入参传入） */
    var now = 1700000000000;
    var old = Starter.plan({
      volumeL: 20, og: 1.060, form: 'liquid', packs: 1, now: now, producedAt: now - 180 * 24 * 3600 * 1000
    });
    ok('半年前的酵母活性约 0.4', Math.abs(old.viability - 0.4) < 0.02, String(old.viability));
    ok('陈酵母有提醒', old.warnings.some(function (w) { return /活性|个月/.test(w); }));

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
