/* ============================================================================
 * 风月酿研所 — 05 单位换算（Units）
 * ----------------------------------------------------------------------------
 * 职责：所有跨单位换算集中在这里，禁止在别处硬写系数。
 * 依赖：00-core.js
 *
 * 原则：每个函数都注明公式来源与适用区间，并给出验算基准点。
 *      换算本身不难，难的是"用错单位"——这是酿酒计算最常见的错误来源。
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  var U = BREW.Util;

  var Units = BREW.Units = {

    /* ======================================================================
     * 一、比重（Specific Gravity）↔ 柏拉图度（°P）
     * ----------------------------------------------------------------------
     * 这两个是同一件事的两种表达：SG 是密度比，°P 是质量分数（g 糖/100g 溶液）。
     * 精酿圈爱用 SG（1.050），欧洲/工业爱用 °P（12.4）。
     *
     * 正向用 ASBC 标准多项式（SG → °P），在 1.000–1.120 区间误差 < 0.05°P。
     * ====================================================================*/

    /** SG → °P。ASBC 多项式 */
    sgToPlato: function (sg) {
      var s = U.toNum(sg, 1);
      if (s <= 1) return 0;
      var p = 135.997 * s * s * s - 630.272 * s * s + 1111.14 * s - 616.868;
      return Math.max(0, p);
    },

    /** °P → SG。反解近似式，在 0–30°P 区间误差 < 0.001 */
    platoToSg: function (p) {
      var v = U.toNum(p, 0);
      if (v <= 0) return 1;
      return 1 + v / (258.6 - 0.8796 * v);
    },

    /** SG → 比重点数（gravity points），即 1.050 → 50 */
    sgToPoints: function (sg) {
      return (U.toNum(sg, 1) - 1) * 1000;
    },

    /** 点数 → SG */
    pointsToSg: function (pts) {
      return 1 + U.toNum(pts, 0) / 1000;
    },

    /* ======================================================================
     * 二、Brix（白利度）与折射仪修正
     * ----------------------------------------------------------------------
     * 重要提醒：折射仪在"有酒精的液体"里读数会严重偏高，因为酒精的折射率
     * 和糖不一样。发酵开始后再用折射仪测，必须做酒精修正，否则 FG 会
     * 高出一大截，让人误以为发酵停滞。
     *
     * 使用 Novotny 修正式，输入是"原始 Brix（发酵前）"和"当前 Brix 读数"。
     * 这个模型在 OG 1.030–1.090 区间误差约 ±0.002 SG，超出这个范围会飘。
     * ====================================================================*/

    /** 未发酵麦汁：Brix ≈ °P（实际 Brix 比 °P 高约 0.2–0.4，此处按通行近似处理） */
    brixToPlato: function (brix) {
      return U.toNum(brix, 0) * 0.995;   /* 经验修正，避免把 Brix 直接当 °P 用 */
    },

    /**
     * 折射仪发酵中读数修正
     * @param {number} ob  发酵前的 Brix 读数（原始麦汁）
     * @param {number} fb  当前 Brix 读数（含酒精）
     * @returns {number}   修正后的 SG
     */
    refractometerFG: function (ob, fb) {
      var o = U.toNum(ob, 0), f = U.toNum(fb, 0);
      if (o <= 0) return 1;
      var sg = 1.001843
             - 0.002318474 * o - 0.000007775 * o * o - 0.000000034 * o * o * o
             + 0.00574 * f + 0.00003344 * f * f + 0.000000003 * f * f * f;
      return U.clamp(sg, 0.990, 1.120);
    },

    /** 由原始/当前 Brix 直接估 ABV（%，粗估，误差 ±0.4） */
    brixToAbv: function (ob, fb) {
      var o = U.toNum(ob, 0), f = U.toNum(fb, 0);
      if (o <= 0) return 0;
      return Math.max(0, (o - f) * 0.511);
    },

    /* ======================================================================
     * 三、色度：Lovibond ↔ SRM ↔ EBC
     * ----------------------------------------------------------------------
     * 三个刻度测的是同一件事，但换算关系不一样：
     *   - SRM 与 EBC 是同一测量方法的不同单位，转换是精确定义：EBC = SRM × 1.97
     *   - Lovibond 是 19 世纪的目视比色法，与 SRM 只是近似拟合：
     *     SRM ≈ 1.3546 × °L − 0.76
     * 关键：麦芽袋上印的是 Lovibond（或 EBC），啤酒测出来的是 SRM。
     *       把麦芽的 °L 直接当 SRM 用会算深 1–3 个色度单位。
     * ====================================================================*/

    lovibondToSrm: function (lov) {
      return U.clamp(1.3546 * U.toNum(lov, 0) - 0.76, 0, 80);
    },

    srmToLovibond: function (srm) {
      return U.clamp((U.toNum(srm, 0) + 0.76) / 1.3546, 0, 80);
    },

    srmToEbc: function (srm) { return U.toNum(srm, 0) * 1.97; },

    ebcToSrm: function (ebc) { return U.toNum(ebc, 0) / 1.97; },

    /** 麦芽 EBC → 用于 MCU 计算的 Lovibond */
    ebcToLovibond: function (ebc) { return this.srmToLovibond(this.ebcToSrm(ebc)); },

    /* ======================================================================
     * 四、酒精度：ABV ↔ ABW ↔ 标准杯
     * ====================================================================*/

    /** ABV(%) → ABW(%)：ABW = ABV × 0.789 / 密度(溶液) ，用通行近似 0.796 */
    abvToAbw: function (abv) { return U.toNum(abv, 0) * 0.796; },

    abwToAbv: function (abw) { return U.toNum(abw, 0) / 0.796; },

    /** 一个 330ml 杯里含有多少毫升纯酒精 */
    abvToMlPerServing: function (abv, ml) {
      return U.toNum(abv, 0) / 100 * U.toNum(ml, 330);
    },

    /** 标准 drink（美国标准 14g 纯酒精）数量 */
    servings: function (abv, ml) {
      var mlAlcohol = this.abvToMlPerServing(abv, ml);
      return mlAlcohol * 0.789 / 14;
    },

    /* ======================================================================
     * 五、体积与重量
     * ====================================================================*/
    kgToLb: function (kg) { return U.toNum(kg, 0) * 2.20462; },
    lbToKg: function (lb) { return U.toNum(lb, 0) / 2.20462; },
    lToGal: function (l) { return U.toNum(l, 0) / 3.78541; },     /* 美制加仑 */
    galToL: function (gal) { return U.toNum(gal, 0) * 3.78541; },
    lToUkGal: function (l) { return U.toNum(l, 0) / 4.54609; },   /* 英制加仑，注意区别 */
    lToOz: function (l) { return U.toNum(l, 0) * 33.814; },
    ozToL: function (oz) { return U.toNum(oz, 0) / 33.814; },
    gToOz: function (g) { return U.toNum(g, 0) / 28.3495; },

    /* ======================================================================
     * 六、温度
     * ====================================================================*/
    cToF: function (c) { return U.toNum(c, 0) * 9 / 5 + 32; },
    fToC: function (f) { return (U.toNum(f, 32) - 32) * 5 / 9; },

    /* ======================================================================
     * 七、水的密度（用于比重计温度校正）
     * ----------------------------------------------------------------------
     * 比重计只在标定温度（通常 20°C）读得准。热麦汁密度低，读数会偏低，
     * 把 60°C 的 1.040 当成真值，会误判糖化效率差了 30%。
     *
     * 下表是水的密度（g/cm³），线性插值。纯水在 4°C 时密度最大。
     * ====================================================================*/
    _waterDensity: [
      [0, 0.99987], [4, 1.00000], [10, 0.99973], [15, 0.99913], [20, 0.99823],
      [25, 0.99707], [30, 0.99568], [35, 0.99403], [40, 0.99225], [45, 0.99025],
      [50, 0.98807], [55, 0.98573], [60, 0.98324], [65, 0.98059], [70, 0.97781],
      [75, 0.97489], [80, 0.97182], [85, 0.96862], [90, 0.96535], [95, 0.96192],
      [100, 0.95840]
    ],

    waterDensity: function (c) {
      var t = U.clamp(U.toNum(c, 20), 0, 100);
      var tbl = this._waterDensity;
      for (var i = 0; i < tbl.length - 1; i++) {
        if (t >= tbl[i][0] && t <= tbl[i + 1][0]) {
          var span = tbl[i + 1][0] - tbl[i][0] || 1;
          var k = (t - tbl[i][0]) / span;
          return tbl[i][1] + (tbl[i + 1][1] - tbl[i][1]) * k;
        }
      }
      return 0.99823;
    },

    /**
     * 比重计温度校正
     * @param {number} reading  比重计读数（SG）
     * @param {number} tempC    样品实际温度
     * @param {number} calC     比重计标定温度（一般 20，美制 15.6）
     * @returns {number}        校正到标定温度下的 SG
     *
     * 原理：读数是"液体密度 / 标定温度下水的密度"。样品温度高时液体密度低，
     *      读数偏低。所以要用两个温度下的水密度比把读数拉回。
     */
    correctHydrometer: function (reading, tempC, calC) {
      var r = U.toNum(reading, 1);
      var t = U.toNum(tempC, 20);
      var c = (calC === undefined) ? 20 : U.toNum(calC, 20);
      if (Math.abs(t - c) < 0.5) return r;
      var dT = this.waterDensity(t);
      var dC = this.waterDensity(c);
      /* 只校正糖的浮力部分（r-1），水本身的密度变化单独处理 */
      var pts = (r - 1) * 1000;
      var correctedPts = pts * (dC / dT) + (dC - dT) * 1000;
      return 1 + correctedPts / 1000;
    },

    /* ======================================================================
     * 八、压力（碳化用）
     * ====================================================================*/
    psiToBar: function (psi) { return U.toNum(psi, 0) * 0.0689476; },
    barToPsi: function (bar) { return U.toNum(bar, 0) / 0.0689476; },
    kpaToPsi: function (kpa) { return U.toNum(kpa, 0) * 0.145038; },

    /* ======================================================================
     * 九、水硬度表达
     * ----------------------------------------------------------------------
     * 同一份水，德国硬度、法国硬度、ppm as CaCO3 是三种说法。
     * 家酿统一用 ppm as CaCO3，因为 Kolbach 残留碱度公式用它。
     * ====================================================================*/
    dHToPpm: function (dh) { return U.toNum(dh, 0) * 17.848; },
    ppmToDH: function (ppm) { return U.toNum(ppm, 0) / 17.848; },
    fHToPpm: function (fh) { return U.toNum(fh, 0) * 10; },

    /** 碳酸氢根 HCO3⁻（mg/L）→ 碱度（as CaCO3, mg/L） */
    hco3ToAlkalinity: function (hco3) {
      return U.toNum(hco3, 0) * (50 / 61);   /* 61 是 HCO3 当量，50 是 CaCO3 当量 */
    },

    /** 碱度（as CaCO3）→ HCO3⁻ */
    alkalinityToHco3: function (alk) {
      return U.toNum(alk, 0) * (61 / 50);
    },

    /* ======================================================================
     * 十、自检：这些系数必须能被验算，否则整个引擎都不可信
     * ====================================================================*/
    selfTest: function () {
      var cases = [];
      var T = function (name, got, want, tol) {
        var ok = Math.abs(got - want) <= (tol === undefined ? 0.02 : tol);
        cases.push({ name: name, got: got, want: want, ok: ok });
      };

      T('1.050 → °P', this.sgToPlato(1.050), 12.39, 0.05);
      T('12.39°P → SG', this.platoToSg(12.39), 1.050, 0.001);
      T('1.000 → °P', this.sgToPlato(1.000), 0, 0.01);
      T('EBC 20 → SRM', this.srmToEbc(10), 19.7, 0.05);
      T('SRM 10 → EBC', this.ebcToSrm(19.7), 10, 0.05);
      T('40°L → SRM', this.lovibondToSrm(40), 53.4, 0.5);
      T('ABV 5 → ABW', this.abvToAbw(5), 3.98, 0.02);
      T('20°C 水密度', this.waterDensity(20), 0.99823, 0.0001);
      T('HCO3 100 → 碱度', this.hco3ToAlkalinity(100), 81.97, 0.1);
      T('kg 1 → lb', this.kgToLb(1), 2.20462, 0.001);
      T('gal 5 → L', this.galToL(5), 18.927, 0.01);

      /* 折射仪：OG Brix 12 / 当前 6 → 应该在 1.006–1.012 之间 */
      var fg = this.refractometerFG(12, 6);
      cases.push({ name: '折射仪 12/6 → SG', got: fg, want: '1.006-1.012',
                   ok: fg > 1.005 && fg < 1.013 });

      var pass = cases.filter(function (c) { return c.ok; }).length;
      return { total: cases.length, pass: pass, cases: cases };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
