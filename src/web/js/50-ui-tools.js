/* ============================================================================
 * 风月酿研所 — 50-ui-tools.js
 * ----------------------------------------------------------------------------
 * 职责：工具集视图。卡片网格 + 点击打开模态框计算器，输入即时出结果。
 *   1 糖度换算（SG / °P / Brix + 折射仪酒精修正）
 *   2 稀释与浓缩
 *   3 装瓶碳化糖量
 *   4 酵母接种量与扩培
 *   5 水化学盐类添加
 *   6 单位换算（重量 / 体积 / 温度 / 色度）
 *   7 酒精单位换算（ABV / ABW / 标准杯）
 *   --- v1.2 追加 ---
 *   8 酵母扩培（多步扩培计划的体积 / DME / 细胞数）
 *   9 感知苦度（IBU → 喝起来多苦，带因子明细）
 *  10 水质匹配（粘贴水质报告 → 最近的历史名城水型）
 *
 * 依赖：BREW.UI（esc/num/fmt/icon/modal/recipe）
 * 设计说明：每个工具的公式都写在代码注释里，用户点开能看到口径，
 *           不把黑箱结果当成"权威"。
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  /* ======================================================================
   * 通用小部件
   * ====================================================================*/

  function field(name, label, value, unit, opts) {
    opts = opts || {};
    return '<div class="field">' +
      '<label class="field__label" for="t-' + attr(name) + '">' + esc(label) + '</label>' +
      '<div class="input-wrap">' +
        '<input class="input input--num" id="t-' + attr(name) + '" data-in="' + attr(name) + '" type="number" ' +
        'step="' + attr(opts.step || 'any') + '" value="' + attr(value) + '"' +
        (unit ? '' : ' style="padding-right:10px"') + '>' +
        (unit ? '<span class="input-wrap__unit">' + esc(unit) + '</span>' : '') +
      '</div>' +
      (opts.hint ? '<span class="field__hint">' + esc(opts.hint) + '</span>' : '') +
      '</div>';
  }

  function selectField(name, label, options, value) {
    var opts = '';
    for (var i = 0; i < options.length; i++) {
      var o = options[i];
      var v = typeof o === 'string' ? o : o.v;
      var t = typeof o === 'string' ? o : o.t;
      opts += '<option value="' + attr(v) + '"' + (v === value ? ' selected' : '') + '>' + esc(t) + '</option>';
    }
    return '<div class="field">' +
      '<label class="field__label" for="t-' + attr(name) + '">' + esc(label) + '</label>' +
      '<select class="select" id="t-' + attr(name) + '" data-in="' + attr(name) + '">' + opts + '</select></div>';
  }

  function val(api, name) {
    var el = api.query('[data-in="' + name + '"]');
    return el ? el.value : '';
  }
  function n(api, name, def) { return num(val(api, name), def === undefined ? 0 : def); }
  function s(api, name) { return val(api, name); }

  /** 结果区：rows = [{k, v, hero, hint}] */
  function resultBox(rows, note) {
    var html = '<div class="result-box"><div class="result-box__label">计算结果</div>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<div class="result-row' + (r.hero ? ' result-row--hero' : '') + '">' +
        '<span class="result-row__k">' + esc(r.k) + '</span>' +
        '<span class="result-row__v">' + r.v + '</span></div>';
      if (r.hint) html += '<div class="u-xs u-dim" style="padding:0 0 4px">' + esc(r.hint) + '</div>';
    }
    html += '</div>';
    if (note) html += '<p class="u-xs u-dim mt-8" style="line-height:1.6">' + note + '</p>';
    return html;
  }

  function warnBox(text, level) {
    return '<div class="alert alert--' + (level || 'warn') + ' mt-8">' +
      '<span class="alert__icon">' + icon(level === 'ok' ? 'check' : 'alert', 13) + '</span>' +
      '<span>' + esc(text) + '</span></div>';
  }

  /* ======================================================================
   * 数学工具
   * ====================================================================*/

  /** SG → °Plato（ASBC 精确多项式） */
  function sgToPlato(sgVal) {
    var s1 = num(sgVal, 1);
    return -616.868 + 1111.14 * s1 - 630.272 * s1 * s1 + 135.997 * s1 * s1 * s1;
  }
  /** °Plato → SG（牛顿迭代，比查表干净） */
  function platoToSg(p) {
    var target = num(p, 0), sgVal = 1 + target / 250;
    for (var i = 0; i < 12; i++) {
      var f = sgToPlato(sgVal) - target;
      var d = 1111.14 - 1260.544 * sgVal + 407.991 * sgVal * sgVal;
      if (Math.abs(d) < 1e-9) break;
      sgVal -= f / d;
    }
    return sgVal;
  }

  /** 残余 CO₂（体积倍数）随最高发酵温度查表 + 线性插值 */
  var CO2_TABLE = [
    [0, 1.70], [2, 1.60], [4, 1.50], [6, 1.40], [8, 1.30], [10, 1.20],
    [12, 1.12], [14, 1.02], [16, 0.95], [18, 0.89], [20, 0.84],
    [22, 0.78], [24, 0.73], [26, 0.68], [30, 0.60]
  ];
  function residualCO2(tempC) {
    var t = num(tempC, 20);
    if (t <= CO2_TABLE[0][0]) return CO2_TABLE[0][1];
    for (var i = 0; i < CO2_TABLE.length - 1; i++) {
      var a = CO2_TABLE[i], b = CO2_TABLE[i + 1];
      if (t >= a[0] && t <= b[0]) {
        var r = (t - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * r;
      }
    }
    return CO2_TABLE[CO2_TABLE.length - 1][1];
  }

  /* ======================================================================
   * 工具定义
   * ====================================================================*/

  var TOOLS = [];

  /* ------------------------------------------------------------ 1 糖度换算 */
  TOOLS.push({
    id: 'gravity',
    icon: 'flask',
    title: '糖度换算',
    desc: 'SG ↔ °P ↔ Brix，含折射仪在含酒精溶液中的修正',
    build: function () {
      var r = UI.recipe();
      return '<div class="grid-2">' +
        field('sg', '比重 SG', '1.050', '', { step: '0.001', hint: '20°C 下的相对密度' }) +
        field('obrix', '起始 Brix（原始麦汁）', '12.5', '°Bx', { step: '0.1', hint: '用折射仪测发酵前麦汁' }) +
        field('fbrix', '当前 Brix（含酒精）', '6.5', '°Bx', { step: '0.1', hint: '发酵中读数会被酒精抬高' }) +
        field('vol', '批次量（可选）', fmt(num(r.batchSize, 20), 1), 'L', { step: '0.5' }) +
        '</div>';
    },
    calc: function (api) {
      var sgVal = n(api, 'sg', 1.05);
      var p = sgToPlato(sgVal);

      var rows = [
        { k: '比重 SG', v: esc(sgVal.toFixed(3)), hero: true },
        { k: '柏拉图度 °P', v: esc(fmt(p, 2)) + ' °P' },
        { k: '每公升糖量（近似）', v: esc(fmt(p * 10.2, 1)) + ' g/L' },
        { k: '1 °P 约合', v: '≈ 4 个比重点（1.001 / °P）' }
      ];

      var note = '°P 用 ASBC 三次多项式由比重反算，是酿酒业的法定口径；Brix 与 °P 在纯糖液中接近，' +
        '但折射仪测含酒精溶液时读数会显著偏高，必须修正。';

      /* 折射仪修正：Terrill 式 */
      var ob = n(api, 'obrix', 0);
      var fb = n(api, 'fbrix', 0);
      if (ob > 0 && fb > 0) {
        var fg = 1.0000
          - 0.0044993 * fb + 0.011774 * ob
          + 0.00027581 * fb * fb - 0.0012717 * ob * ob
          - 0.0000072800 * fb * fb * fb + 0.000063293 * ob * ob * ob;
        var ogFromBrix = 1 + (ob / (258.6 - (ob / 258.2) * 227.1));
        var abv = (ogFromBrix - fg) * 131.25;
        rows.push({ k: '折射仪修正后终比重', v: esc(fg.toFixed(4)), hero: false });
        rows.push({ k: '由起始 Brix 反推 OG', v: esc(ogFromBrix.toFixed(3)) });
        rows.push({ k: '折算酒精度 ABV', v: esc(fmt(abv, 2)) + '%', hero: true });
        if (fg > ogFromBrix) {
          return resultBox(rows, note) + warnBox('估算 FG 高于 OG，说明输入的两个 Brix 不构成同一批发酵，请检查读数。', 'error');
        }
        return resultBox(rows, note) +
          '<p class="u-xs u-dim mt-8">修正式：Terrill / Novotny 折射仪多项式，对 1.040–1.080 的常规艾尔误差通常 &lt; 0.002。</p>';
      }
      return resultBox(rows, note);
    }
  });

  /* ---------------------------------------------------------- 2 稀释与浓缩 */
  TOOLS.push({
    id: 'dilution',
    icon: 'drop',
    title: '稀释与浓缩',
    desc: '高糖度尾洗回收、煮沸浓缩、兑水降度',
    build: function () {
      return '<div class="grid-2">' +
        field('v1', '当前体积', '20', 'L', { step: '0.1' }) +
        field('sg1', '当前比重', '1.060', '', { step: '0.001' }) +
        field('v2', '目标体积', '23', 'L', { step: '0.1', hint: '兑水或蒸发后的体积' }) +
        field('sgt', '目标比重', '1.052', '', { step: '0.001' }) +
        '</div>';
    },
    calc: function (api) {
      var v1 = n(api, 'v1', 20), sg1 = n(api, 'sg1', 1.05);
      var v2 = n(api, 'v2', 20), sgt = n(api, 'sgt', 1.05);
      var pts1 = (sg1 - 1) * 1000;

      if (v1 <= 0 || pts1 <= 0) {
        return warnBox('当前体积与比重必须大于 0，否则无法做物料平衡。', 'error');
      }

      /* 糖总量守恒：pts × V = const */
      var sg2 = 1 + (pts1 * v1) / Math.max(0.01, v2) / 1000;
      var vForTarget = (pts1 * v1) / Math.max(0.1, (sgt - 1) * 1000);
      var delta = v2 - v1;

      var rows = [
        { k: '稀释/浓缩到 ' + fmt(v2, 1) + ' L 后比重', v: esc(sg2.toFixed(3)), hero: true },
        { k: '该比重对应 °P', v: esc(fmt(sgToPlato(sg2), 1)) + ' °P' },
        {
          k: delta >= 0 ? '需要加水量' : '需要蒸发量',
          v: esc(fmt(Math.abs(delta), 2)) + ' L'
        },
        {
          k: '达到 ' + sgt.toFixed(3) + ' 所需体积',
          v: esc(fmt(vForTarget, 1)) + ' L',
          hint: vForTarget > v1 ? '需兑水 ' + fmt(vForTarget - v1, 2) + ' L'
            : '需煮沸蒸发 ' + fmt(v1 - vForTarget, 2) + ' L'
        }
      ];

      var warn = '';
      if (sg2 < 1.005) warn = warnBox('算出来接近 1.000，相当于把酒兑成了水，请确认输入。', 'error');
      else if (delta > 0 && delta / v1 > 0.4) warn = warnBox('兑水超过原体积 40%，风味会被明显稀释，同时要注意氧化。', 'warn');

      return resultBox(rows,
        '依据糖总量守恒：比重点数 × 体积 = 常数。煮沸浓缩时忽略蒸发带走的微量糖与酒花苦味变化。') + warn;
    }
  });

  /* ------------------------------------------------------------ 3 碳化糖量 */
  TOOLS.push({
    id: 'carbonation',
    icon: 'beer',
    title: '装瓶碳化糖量',
    desc: '按目标 CO₂ 体积与最高发酵温度算糖，含容器安全提示',
    build: function () {
      var r = UI.recipe();
      return '<div class="grid-2">' +
        field('vol', '装瓶体积', fmt(num(r.batchSize, 20), 1), 'L', { step: '0.5' }) +
        field('target', '碳化度', fmt(num(r.carbonation.targetVol, 2.4), 1), 'vol', { step: '0.1', hint: '英式艾尔 1.5–2.2 / 美式艾尔 2.2–2.8 / 小麦 3.3–4.5 / 比利时 2.0–4.5' }) +
        field('temp', '发酵最高温度', '20', '°C', { step: '0.5', hint: '取双乙酰还原结束时的温度' }) +
        selectField('sugar', '糖的种类', [
          { v: 'sucrose', t: '蔗糖（白砂糖）3.82 g/L·vol' },
          { v: 'dextrose', t: '葡萄糖（玉米糖）4.42 g/L·vol' },
          { v: 'dme', t: '干麦芽提取物 5.6 g/L·vol' }
        ], 'sucrose') +
        '</div>';
    },
    calc: function (api) {
      var vol = n(api, 'vol', 20);
      var target = n(api, 'target', 2.4);
      var temp = n(api, 'temp', 20);
      var kind = s(api, 'sugar') || 'sucrose';

      var residual = residualCO2(temp);
      var need = Math.max(0, target - residual);
      var factor = kind === 'dextrose' ? 4.42 : kind === 'dme' ? 5.6 : 3.82;
      var perL = need * factor;
      var total = perL * vol;

      var rows = [
        { k: '总用糖量', v: esc(fmt(total, 1)) + ' g', hero: true },
        { k: '每升用糖', v: esc(fmt(perL, 2)) + ' g/L' },
        { k: '温度 ' + fmt(temp, 1) + '°C 的残余 CO₂', v: esc(fmt(residual, 2)) + ' vol' },
        { k: '需要补足的 CO₂', v: esc(fmt(need, 2)) + ' vol' },
        { k: '折合每 500 mL 瓶', v: esc(fmt(total / Math.max(1, vol / 0.5), 2)) + ' g' }
      ];

      var warn = '';
      if (target > 3.6) {
        warn += warnBox('目标 ' + fmt(target, 1) + ' vol 已超出普通玻璃瓶的安全范围（约 3.5 vol），' +
          '必须用厚壁瓶或直接桶装碳化，否则有爆瓶风险。', 'error');
      }
      if (need <= 0.02) {
        warn += warnBox('残余 CO₂ 已接近目标，不需要额外加糖；再加会过碳化。', 'warn');
      }

      return resultBox(rows,
        '残余 CO₂ 由发酵最高温度决定（气体溶解度随温度下降），所以降温后不要再按低温重算——' +
        '酵母已经在高温下把 CO₂ 放光了。') + warn;
    }
  });

  /* -------------------------------------------------------- 4 酵母接种量 */
  TOOLS.push({
    id: 'pitch',
    icon: 'flask',
    title: '酵母接种量',
    desc: '按体积与糖度算细胞数，换算成包数或扩培步数',
    build: function () {
      var r = UI.recipe();
      return '<div class="grid-2">' +
        field('vol', '批次量', fmt(num(r.batchSize, 20), 1), 'L', { step: '0.5' }) +
        field('og', '初始比重 OG', '1.052', '', { step: '0.001' }) +
        selectField('type', '发酵类型', [
          { v: 'ale', t: '艾尔（0.75 M/mL/°P）' },
          { v: 'lager', t: '拉格（1.50 M/mL/°P）' },
          { v: 'hybrid', t: '混合/小麦（1.00 M/mL/°P）' }
        ], 'ale') +
        selectField('form', '酵母形态', [
          { v: 'dry', t: '活性干酵母（约 10 B/g 保守）' },
          { v: 'liquid', t: '液体酵母（约 100 B/包）' }
        ], 'dry') +
        '</div>';
    },
    calc: function (api) {
      var vol = n(api, 'vol', 20);
      var og = n(api, 'og', 1.05);
      var p = sgToPlato(og);
      var type = s(api, 'type');
      var form = s(api, 'form');

      var rate = type === 'lager' ? 1.5 : type === 'hybrid' ? 1.0 : 0.75;  // 百万细胞/mL/°P
      var cells = rate * vol * 1000 * p;                                   // 百万细胞
      var cellsB = cells / 1000;                                            // 十亿细胞

      var rows = [
        { k: '所需酵母细胞数', v: esc(fmt(cellsB, 0)) + ' B（十亿）', hero: true },
        { k: '麦汁糖度', v: esc(fmt(p, 1)) + ' °P' },
        { k: '接种率', v: esc(fmt(rate, 2)) + ' M/mL/°P' }
      ];

      var warn = '';
      if (form === 'dry') {
        var grams = cellsB / 10;              // 保守按 10 B/g
        var packs = grams / 11;
        rows.push({ k: '活性干酵母接种量', v: esc(fmt(grams, 1)) + ' g' });
        rows.push({ k: '折合 11 g 装', v: esc(fmt(packs, 2)) + ' 包', hero: true });
        if (packs > 1.2) {
          rows.push({ k: '建议', v: '直接投 ' + Math.ceil(packs) + ' 包，或做一次扩培' });
        }
        if (p >= 18) warn += warnBox('OG 折合 ' + fmt(p, 1) + ' °P，属高糖麦汁：接种量应上浮 20–50%，' +
          '并保证充氧，否则容易发酵停滞、产生大量酯香。', 'warn');
      } else {
        var needPacks = cellsB / 100;
        rows.push({ k: '液体酵母（100 B/包）', v: esc(fmt(needPacks, 2)) + ' 包' });
        /* 每步扩培按 2.4 倍保守增长估算 */
        var steps = 0, have = 100;
        while (have * Math.pow(2.4, steps) < cellsB && steps < 6) steps++;
        rows.push({
          k: '扩培步数建议', v: steps === 0 ? '无需扩培' : steps + ' 步（每步约 2.4 倍）', hero: true,
          hint: steps > 0 ? '起始 100 B → ' + fmt(100 * Math.pow(2.4, steps), 0) + ' B' : ''
        });
        warn += warnBox('扩培倍率与是否用磁力搅拌器强相关：静置培养通常只有 1.5–2 倍/' + '步，搅拌可到 3 倍。', 'info');
      }

      return resultBox(rows,
        '接种率参考 White Labs / Wyeast 的通行建议。温度、麦汁营养、酵母代数都会影响实际起发速度，' +
        '第一次用某株酵母建议取上限。') + warn;
    }
  });

  /* -------------------------------------------------------- 5 水化学盐类 */
  TOOLS.push({
    id: 'water',
    icon: 'drop',
    title: '水化学盐类',
    desc: '按目标离子增量反算石膏 / 氯化钙 / 食盐克数',
    build: function () {
      var r = UI.recipe();
      return '<div class="grid-2">' +
        field('vol', '处理水量', fmt(num(r.batchSize, 20), 1), 'L', { step: '0.5' }) +
        field('ca', '目标增加 Ca²⁺', '60', 'ppm', { step: '1' }) +
        field('so4', '目标增加 SO₄²⁻', '120', 'ppm', { step: '1', hint: '提高"干苦感"' }) +
        field('cl', '目标增加 Cl⁻', '60', 'ppm', { step: '1', hint: '提高"圆润甜感"' }) +
        '</div>';
    },
    calc: function (api) {
      var vol = n(api, 'vol', 20);
      var caT = n(api, 'ca', 0), so4T = n(api, 'so4', 0), clT = n(api, 'cl', 0);

      /* 各盐的离子质量分数（含结晶水） */
      var GYPSUM = { ca: 0.2328, so4: 0.5579 };   // CaSO₄·2H₂O
      var CACL2 = { ca: 0.2726, cl: 0.4822 };     // CaCl₂·2H₂O

      var gypG = so4T > 0 ? (so4T * vol) / (GYPSUM.so4 * 1000) : 0;
      var caFromGyp = gypG * GYPSUM.ca * 1000 / vol;
      var caLeft = Math.max(0, caT - caFromGyp);
      var caclG = caLeft > 0 ? (caLeft * vol) / (CACL2.ca * 1000) : 0;
      var clFromCacl = caclG * CACL2.cl * 1000 / vol;
      var clLeft = Math.max(0, clT - clFromCacl);
      var naclG = clLeft > 0 ? (clLeft * vol) / (0.6066 * 1000) : 0;

      var rows = [
        { k: '石膏 CaSO₄·2H₂O', v: esc(fmt(gypG, 2)) + ' g', hero: true },
        { k: '氯化钙 CaCl₂·2H₂O', v: esc(fmt(caclG, 2)) + ' g', hero: true },
        { k: '食盐 NaCl', v: esc(fmt(naclG, 2)) + ' g' },
        { k: '实际增加 Ca²⁺', v: esc(fmt(caFromGyp + caclG * CACL2.ca * 1000 / vol, 0)) + ' ppm' },
        { k: '实际增加 SO₄²⁻', v: esc(fmt(gypG * GYPSUM.so4 * 1000 / vol, 0)) + ' ppm' },
        { k: '实际增加 Cl⁻', v: esc(fmt(clFromCacl + naclG * 0.6066 * 1000 / vol, 0)) + ' ppm' }
      ];

      var ratio = clFromCacl + naclG * 0.6066 * 1000 / vol > 0
        ? (gypG * GYPSUM.so4 * 1000 / vol) / (clFromCacl + naclG * 0.6066 * 1000 / vol)
        : 0;
      rows.push({ k: 'SO₄ / Cl 比值', v: ratio > 0 ? esc(fmt(ratio, 2)) : '—', hero: true });
      rows.push({
        k: '风味指向', v: ratio >= 2 ? '干、苦感突出（IPA / 苦啤）'
          : ratio >= 1 ? '平衡偏干' : ratio > 0 ? '圆润、麦芽甜突出' : '—'
      });

      var warn = '';
      if (caFromGyp + caclG * CACL2.ca * 1000 / vol > 200) {
        warn += warnBox('钙超过 200 ppm 会有明显的矿物涩感，并可能抑制酵母。', 'warn');
      }
      if (gypG + caclG + naclG > 20) {
        warn += warnBox('总盐量超过 20 g，建议分次加入并边加边测 pH，不要一次性全倒进糖化锅。', 'info');
      }

      return resultBox(rows,
        '离子质量分数来自摩尔质量比：石膏 172.17 g/mol（Ca 40.08 / SO₄ 96.06），' +
        '氯化钙二水 147.01 g/mol。实际糖化时约 30–50% 的钙会被麦糟吸附，投料量可上浮 20%。') + warn;
    }
  });

  /* ---------------------------------------------------------- 6 单位换算 */
  TOOLS.push({
    id: 'units',
    icon: 'scale',
    title: '单位换算',
    desc: '重量 / 体积 / 温度 / 色度，跨洋配方必备',
    build: function () {
      return '<div style="display:grid;gap:14px">' +
        '<div>' +
          '<div class="u-xs u-dim" style="letter-spacing:.6px;margin-bottom:6px">重量</div>' +
          '<div class="grid-2">' +
            field('w', '数值', '1', '') +
            selectField('wu', '单位', ['kg', 'g', 'lb', 'oz'], 'kg') +
          '</div>' +
          '<div class="mt-8" id="o-w"></div>' +
        '</div>' +
        '<div>' +
          '<div class="u-xs u-dim" style="letter-spacing:.6px;margin-bottom:6px">体积</div>' +
          '<div class="grid-2">' +
            field('v', '数值', '20', '') +
            selectField('vu', '单位', ['L', 'mL', 'gal(US)', 'gal(UK)', 'fl oz(US)'], 'L') +
          '</div>' +
          '<div class="mt-8" id="o-v"></div>' +
        '</div>' +
        '<div>' +
          '<div class="u-xs u-dim" style="letter-spacing:.6px;margin-bottom:6px">温度</div>' +
          '<div class="grid-2">' +
            field('t', '数值', '20', '') +
            selectField('tu', '单位', ['°C', '°F'], '°C') +
          '</div>' +
          '<div class="mt-8" id="o-t"></div>' +
        '</div>' +
        '<div>' +
          '<div class="u-xs u-dim" style="letter-spacing:.6px;margin-bottom:6px">色度</div>' +
          '<div class="grid-2">' +
            field('c', '数值', '8', '') +
            selectField('cu', '单位', ['SRM', 'EBC', 'Lovibond'], 'SRM') +
          '</div>' +
          '<div class="mt-8" id="o-c"></div>' +
        '</div>' +
        '</div>';
    },
    calc: function (api) {
      /* 各维度独立换算，结果直接写进对应占位 */
      var out = {};

      /* 重量：基准 kg */
      var wv = n(api, 'w', 0), wu = s(api, 'wu') || 'kg';
      var kg = wu === 'kg' ? wv : wu === 'g' ? wv / 1000 : wu === 'lb' ? wv * 0.45359237 : wv * 0.0283495231;
      out['o-w'] = miniRows([
        ['kg', fmt(kg, 3)], ['g', fmt(kg * 1000, 1)],
        ['lb', fmt(kg / 0.45359237, 3)], ['oz', fmt(kg / 0.0283495231, 2)]
      ]);

      /* 体积：基准 L */
      var vv = n(api, 'v', 0), vu = s(api, 'vu') || 'L';
      var L = vu === 'L' ? vv : vu === 'mL' ? vv / 1000
        : vu === 'gal(US)' ? vv * 3.785411784
          : vu === 'gal(UK)' ? vv * 4.54609
            : vv * 0.0295735296;
      out['o-v'] = miniRows([
        ['L', fmt(L, 3)], ['mL', fmt(L * 1000, 0)],
        ['gal (US)', fmt(L / 3.785411784, 3)], ['gal (UK)', fmt(L / 4.54609, 3)],
        ['fl oz (US)', fmt(L / 0.0295735296, 1)]
      ]);

      /* 温度 */
      var tv = n(api, 't', 0), tu = s(api, 'tu') || '°C';
      var c = tu === '°C' ? tv : (tv - 32) * 5 / 9;
      out['o-t'] = miniRows([
        ['°C', fmt(c, 2)], ['°F', fmt(c * 9 / 5 + 32, 2)]
      ]);

      /* 色度：以 SRM 为基准。换算走 srmToEbc / srmToLov ——
         v1.6 起与比色卡共用同一组函数，不再各写一份式子 */
      var cv = n(api, 'c', 0), cu = s(api, 'cu') || 'SRM';
      var srm = cu === 'SRM' ? cv : cu === 'EBC' ? ebcToSrm(cv) : lovToSrm(cv);
      var lov = srmToLov(srm);
      out['o-c'] = miniRows([
        ['SRM', fmt(srm, 2)], ['EBC', fmt(srmToEbc(srm), 1)], ['Lovibond °L', fmt(lov, 2)]
      ]) + '<div class="swatch mt-8" style="height:18px;background:' + attr(UI.colorOfSrm(srm)) + '"></div>';

      return out;
    },
    /* 该工具的结果分散写入多个占位，需要单独处理 */
    render: function (api) {
      var out = this.calc(api);
      for (var id in out) {
        if (!Object.prototype.hasOwnProperty.call(out, id)) continue;
        var el = api.query('#' + id);
        if (el) el.innerHTML = out[id];
      }
    }
  });

  function miniRows(pairs) {
    var html = '<div class="result-box" style="padding:6px 10px">';
    for (var i = 0; i < pairs.length; i++) {
      html += '<div class="result-row" style="padding:3px 0">' +
        '<span class="result-row__k">' + esc(pairs[i][0]) + '</span>' +
        '<span class="result-row__v">' + esc(pairs[i][1]) + '</span></div>';
    }
    return html + '</div>';
  }

  /* -------------------------------------------------------- 7 酒精单位 */
  TOOLS.push({
    id: 'abv',
    icon: 'beer',
    title: '酒精单位换算',
    desc: 'ABV ↔ ABW ↔ 纯酒精克数 ↔ 标准杯',
    build: function () {
      return '<div class="grid-2">' +
        field('abv', '酒精度 ABV', '5.6', '%', { step: '0.1', hint: '体积百分比' }) +
        field('vol', '单份体积', '330', 'mL', { step: '10' }) +
        field('sg', '成品比重（可选）', '1.010', '', { step: '0.001', hint: '影响 ABW 精度' }) +
        '</div>';
    },
    calc: function (api) {
      var abv = n(api, 'abv', 0);
      var vol = n(api, 'vol', 330);
      var sgFinal = n(api, 'sg', 1.01);
      if (sgFinal < 1) sgFinal = 1;

      /* ABW = ABV × 乙醇密度 / 溶液密度；乙醇密度 0.789 */
      var abw = (abv / 100) * 0.789 / Math.max(0.9, sgFinal) * 100;
      var pureG = vol * (abv / 100) * 0.789;
      var stdCn = pureG / 10;    // 中国膳食指南 / WHO 以 10 g 纯酒精为一个标准杯
      var stdUs = pureG / 14;    // 美国 14 g

      var rows = [
        { k: '纯酒精量', v: esc(fmt(pureG, 1)) + ' g', hero: true },
        { k: '酒精度 ABW（质量）', v: esc(fmt(abw, 2)) + '%' },
        { k: '标准杯（10 g / 杯）', v: esc(fmt(stdCn, 2)) + ' 杯', hero: true },
        { k: '标准杯（14 g / 杯）', v: esc(fmt(stdUs, 2)) + ' 杯' },
        { k: '热量（酒精本身）', v: esc(fmt(pureG * 7, 0)) + ' kcal' }
      ];

      var warn = '';
      if (stdCn > 2) {
        warn += warnBox('单份已超过 2 个标准杯。一次饮用超过 2 杯会影响判断力，' +
          '长期过量与肝损伤相关——精酿的酒精度常常比工业啤酒高 1–2 倍，容易低估。', 'warn');
      }
      if (abv > 12) {
        warn += warnBox('ABV ' + fmt(abv, 1) + '% 属烈性啤酒，接近葡萄酒。按同样速度喝容易过量。', 'info');
      }

      return resultBox(rows,
        'ABV 是世界通用的体积百分比；ABW 是质量百分比，美国部分州要求标注 ABW，' +
        '两者换算约为 ABW ≈ ABV × 0.79（忽略比重影响时）。') + warn;
    }
  });

  /* ======================================================================
   * v1.2 追加的三个计算器
   * ----------------------------------------------------------------------
   * 它们的"算"都在独立模块里（26-calc-starter / 25-calc-perceived /
   * 27-calc-water-match），本文件只负责摆输入、摆输出。
   * 三个都带存在性守卫：模块没落盘时给出"模块未载入"而不是抛异常。
   * ====================================================================*/

  /* ------------------------------------------------------ 8 酵母扩培 */
  TOOLS.push({
    id: 'starter',
    icon: 'flask',
    title: '酵母扩培',
    desc: '几步扩培、每步多少水与 DME、收获多少细胞',
    build: function () {
      var r = UI.recipe();
      return '<div class="grid-2">' +
        field('vol', '批次量', fmt(num(r.batchSize, 20), 1), 'L', { step: '0.5' }) +
        field('og', '初始比重 OG', '1.052', '', { step: '0.001' }) +
        selectField('type', '酵母类型', [
          { v: 'ale', t: '艾尔 · 0.75 M/mL/°P' },
          { v: 'hybrid', t: '混合/小麦 · 1.00 M/mL/°P' },
          { v: 'lager', t: '拉格 · 1.50 M/mL/°P' }
        ], 'ale') +
        selectField('form', '形态', [
          { v: 'liquid', t: '液体酵母（100 B/包）' },
          { v: 'dry', t: '活性干酵母（11 g/包）' }
        ], 'liquid') +
        field('packs', '现有包数', '1', '包', { step: '1' }) +
        /* 生产日期决定活性衰减：不填就按新鲜算（会少一条重要提醒），所以给个显式输入 */
        '<div class="field">' +
          '<label class="field__label" for="t-prod">酵母生产日期（可选）</label>' +
          '<input class="input" id="t-prod" data-in="prod" type="date">' +
          '<span class="field__hint">留空＝按新鲜酵母算；填了会按每月 −10% 活性折减</span>' +
        '</div>' +
        selectField('stir', '扩培方式', [
          { v: 'stir', t: '磁力搅拌 · 2.4×/步' },
          { v: 'still', t: '静置 · 1.6×/步' }
        ], 'stir') +
        field('steps', '最多几步', '3', '步', { step: '1', hint: '上限 6，再多不如买新酵母' }) +
        '</div>';
    },
    calc: function (api) {
      if (!BREW.Starter || typeof BREW.Starter.plan !== 'function') {
        return warnBox('扩培模块未载入（js/26-calc-starter.js），这一步暂时算不了。' +
          '界面已经就位，模块落盘后刷新即可用。', 'warn');
      }
      var plan = null;
      try {
        plan = BREW.Starter.plan({
          volumeL: n(api, 'vol', 20),
          og: n(api, 'og', 1.052),
          type: s(api, 'type') || 'ale',
          form: s(api, 'form') || 'liquid',
          packs: n(api, 'packs', 1),
          producedAt: s(api, 'prod') || undefined,
          /* now 必须传：26 号模块是纯函数、不许自己取时间。
             不传就等于用户填的生产日期白填——活性衰减那部分根本不生效。 */
          now: Date.now(),
          stirPlate: s(api, 'stir') !== 'still',
          maxSteps: Math.max(1, n(api, 'steps', 3))
        });
      } catch (e) {
        return warnBox('扩培计算失败：' + ((e && e.message) || '未知错误'), 'error');
      }
      if (!plan) return warnBox('扩培模块没有返回方案。', 'warn');

      var rows = [
        { k: '需要细胞数', v: esc(fmt(plan.requiredB, 0)) + ' B（十亿）', hero: true },
        { k: '现有细胞数', v: esc(fmt(plan.startB, 1)) + ' B' },
        { k: '扩培后细胞数', v: esc(fmt(plan.finalB, 1)) + ' B', hero: true },
        { k: '总 DME', v: esc(fmt(plan.totalDmeG, 0)) + ' g' }
      ];

      var warn = '';
      var ws = Array.isArray(plan.warnings) ? plan.warnings : [];
      for (var w = 0; w < ws.length; w++) {
        if (!ws[w]) continue;
        /* 26 号模块把"不需要扩培"也写在 warnings 里，那不是警告，别渲染成黄条 */
        var isInfo = /不需要扩培|已达到需求/.test(String(ws[w]));
        warn += warnBox(String(ws[w]), isInfo ? 'ok' : 'warn');
      }

      var tbody = '';
      var steps = Array.isArray(plan.steps) ? plan.steps : [];
      for (var i = 0; i < steps.length; i++) {
        var st = steps[i] || {};
        tbody += '<tr>' +
          '<td class="num">' + (i + 1) + '</td>' +
          '<td class="num u-mono">' + esc(fmt(st.volL, 1)) + '</td>' +
          '<td class="num u-mono">' + esc(fmt(st.dmeG, 0)) + '</td>' +
          '<td class="num u-mono u-sm">' + esc(fmt(st.startB, 1)) + ' → ' + esc(fmt(st.endB, 1)) + '</td>' +
          '<td class="num u-mono">' + esc(fmt(st.gravity, 3)) + '</td>' +
          '<td class="num u-mono">' + esc(fmt(num(st.volL, 0) * 2, 1)) + '</td>' +
          '</tr>';
      }

      return resultBox(rows, esc(plan.note || '')) + warn +
        (tbody
          ? '<div class="result-box mt-12"><div class="result-box__label">扩培步骤</div>' +
            '<div class="table-wrap" style="border:0"><table class="table table--compact">' +
            '<thead><tr><th class="num" style="width:44px">步</th>' +
            '<th class="num">麦汁 L</th><th class="num">DME g</th>' +
            '<th class="num">细胞数 B</th><th class="num">比重</th>' +
            '<th class="num">容器 ≥ L</th></tr></thead>' +
            '<tbody>' + tbody + '</tbody></table></div></div>'
          : '') +
        '<p class="u-xs u-dim mt-8" style="line-height:1.6">每 1 L 水配 100 g DME 约为 1.040 的扩培液；' +
        '容器容积按液量的 2 倍留泡沫空间（模块不给这个数，是我们按液量留的余量）。细胞数是模型估算，不是计数板实测。</p>';
    }
  });

  /* ------------------------------------------------------ 9 感知苦度 */
  TOOLS.push({
    id: 'perceived',
    icon: 'beer',
    title: '感知苦度',
    desc: '残糖 / 硫酸盐 / 干投 / 碳化度把 IBU 折算成喝起来多苦',
    build: function () {
      var r = UI.recipe();
      var c = UI.calc(r) || {};
      return '<div class="grid-2">' +
        '<div class="field"><label class="field__label">分析对象</label>' +
          '<div class="input-wrap"><input class="input" type="text" readonly value="' +
            attr(r.name || '当前配方') + '"><span class="input-wrap__unit">当前配方</span></div>' +
          '<span class="field__hint">模型要读整份配方（干投量、水、碳化度），所以只算当前配方</span>' +
        '</div>' +
        '<div class="field"><label class="field__label">原始 IBU</label>' +
          '<div class="input-wrap"><input class="input" type="text" readonly value="' +
            attr(fmt(c.ibu, 0)) + '"><span class="input-wrap__unit">IBU</span></div>' +
        '</div>' +
        '</div>';
    },
    calc: function (api) {
      if (!BREW.Perceived || typeof BREW.Perceived.estimate !== 'function') {
        return warnBox('感知苦度模块未载入（js/25-calc-perceived.js），这一步暂时算不了。', 'warn');
      }
      var r = UI.recipe();
      var c = null;
      try { c = UI.calc(r); } catch (e) { c = null; }
      if (!c) return warnBox('配方都算不出来，先回配方页补几行原料。', 'warn');

      var est = null;
      try { est = BREW.Perceived.estimate(c, r); } catch (e2) { est = null; }
      if (!est) return warnBox('感知苦度估算失败，模型可能对这份配方无解。', 'error');

      var low = num(est.low, NaN), high = num(est.high, NaN), mid = num(est.mid, NaN);
      var rangeTxt = (isFinite(low) && isFinite(high))
        ? fmt(low, 0) + ' – ' + fmt(high, 0)
        : fmt(mid, 0);

      var rows = [
        { k: est.label || '模型估算区间', v: esc(rangeTxt) + '（原始 IBU ' + esc(fmt(c.ibu, 0)) + '）', hero: true },
        { k: '中值', v: esc(fmt(mid, 1)) }
      ];
      /* 输入快照：让人知道模型到底看到了什么数，算错时能自己核对 */
      var inp = est.inputs || {};
      if (inp.fg !== undefined) rows.push({ k: '用的 FG', v: esc(fmt(inp.fg, 3)) });
      if (inp.so4 !== undefined) rows.push({ k: '用的 SO₄²⁻', v: esc(fmt(inp.so4, 0)) + ' ppm' });
      if (inp.dryHopGPerL !== undefined) rows.push({ k: '干投量', v: esc(fmt(inp.dryHopGPerL, 2)) + ' g/L' });
      if (inp.carbonationVol !== undefined) rows.push({ k: '碳化度', v: esc(fmt(inp.carbonationVol, 2)) + ' vol' });

      var facts = Array.isArray(est.factors) ? est.factors : [];
      var frows = '';
      for (var i = 0; i < facts.length; i++) {
        var f = facts[i] || {};
        var mult = num(f.mult, 1);
        var cls = mult > 1.02 ? 'diff-delta--big' : '';
        frows += '<tr>' +
          '<td>' + esc(String(f.label || f.key || '因子 ' + (i + 1))) + '</td>' +
          '<td class="num u-mono ' + cls + '">×' + esc(fmt(mult, 2)) + '</td>' +
          '<td class="u-sm u-muted">' + esc(String(f.why || '')) + '</td>' +
          '</tr>';
      }

      var warn = '';
      var ws = Array.isArray(est.warnings) ? est.warnings : [];
      for (var w = 0; w < ws.length; w++) if (ws[w]) warn += warnBox(String(ws[w]), 'warn');

      return resultBox(rows, esc(est.disclaimer || '')) + warn +
        (frows
          ? '<div class="result-box mt-12"><div class="result-box__label">因子明细</div>' +
            '<div class="table-wrap" style="border:0"><table class="table table--compact">' +
            '<thead><tr><th style="width:150px">因子</th><th class="num" style="width:80px">倍率</th>' +
            '<th>原因</th></tr></thead><tbody>' + frows + '</tbody></table></div></div>'
          : '') +
        warnBox('模型估算，非测量值。不同人的苦味受体敏感度差 2–3 倍，这里的数字只用来做配方之间的相对比较。', 'info');
    }
  });

  /* ------------------------------------------------------ 10 水质匹配 */
  TOOLS.push({
    id: 'watermatch',
    icon: 'drop',
    title: '水质匹配',
    desc: '粘贴水质报告，匹配最接近的历史名城水型',
    build: function () {
      return '<div class="field">' +
        '<label class="field__label" for="t-report">水质报告（直接粘贴原文）</label>' +
        '<textarea class="input" id="t-report" data-in="report" rows="5" ' +
        'placeholder="例如：pH 7.4　钙 42　镁 9　钠 28　氯 35　硫酸盐 40　碳酸氢盐 95（mg/L）">' +
        '</textarea>' +
        '<span class="field__hint">能认出 Ca / Mg / Na / Cl / SO₄ / HCO₃ 六个数就够，mmol/L 与 meq/L 会自动换算</span>' +
        '</div>';
    },
    calc: function (api) {
      if (!BREW.WaterMatch) {
        return warnBox('水质匹配模块未载入（js/27-calc-water-match.js），这一步暂时算不了。', 'warn');
      }
      var text = String(s(api, 'report') || '');
      if (!text.trim()) {
        return '<p class="u-sm u-dim">把水质报告里的六个离子数值粘到上面，下面会列出最接近的三个水型。</p>';
      }
      if (typeof BREW.WaterMatch.parseReport !== 'function') {
        return warnBox('水质模块缺少 parseReport()，无法解析报告文本。', 'warn');
      }

      var parsed = null;
      try {
        parsed = BREW.WaterMatch.parseReport(text);
      } catch (e) {
        return warnBox('报告解析失败：' + ((e && e.message) || '格式没认出来'), 'error');
      }
      var ions = (parsed && parsed.ions) || {};
      var found = (parsed && parsed.found) || [];
      if (!found.length) {
        return warnBox('没从这段文字里认出离子数值。试试保留"钙 / 镁 / 钠 / 氯 / 硫酸盐 / 碳酸氢盐"这类词，' +
          '或者只粘「Ca 42」这样的行。', 'warn');
      }

      var IONS = [
        { k: 'ca', label: 'Ca²⁺' }, { k: 'mg', label: 'Mg²⁺' }, { k: 'na', label: 'Na⁺' },
        { k: 'cl', label: 'Cl⁻' }, { k: 'so4', label: 'SO₄²⁻' }, { k: 'hco3', label: 'HCO₃⁻' }
      ];
      var mineRows = '';
      for (var i = 0; i < IONS.length; i++) {
        var v = ions[IONS[i].k];
        var unknownIon = (v === null || v === undefined);
        mineRows += '<span class="tag">' + esc(IONS[i].label) + ' <b class="u-mono">' +
          (unknownIon ? '<span class="u-dim">未测</span>' : esc(fmt(v, 0))) + '</b></span>';
      }

      var list = [];
      try { list = BREW.WaterMatch.match(ions, 3) || []; } catch (e2) { list = []; }

      var rows = '';
      for (var j = 0; j < list.length; j++) {
        var m = list[j] || {};
        var diff = m.diff || {};
        var bits = [];
        for (var d = 0; d < IONS.length; d++) {
          var dv = diff[IONS[d].k];
          if (dv === undefined || Math.abs(num(dv, 0)) < 1) continue;
          bits.push(IONS[d].label + ' ' + (num(dv, 0) > 0 ? '+' : '') + fmt(dv, 0));
        }
        rows += '<tr>' +
          '<td><b>' + esc(String(m.name || m.profileId || '水型 ' + (j + 1))) + '</b></td>' +
          '<td class="num u-mono">' + esc(fmt(m.distance, 2)) + '</td>' +
          '<td class="u-sm u-muted">' + esc(bits.join(' · ') || '几乎一致') + '</td>' +
          '</tr>';
      }

      var notes = (parsed && Array.isArray(parsed.notes)) ? parsed.notes : [];
      var noteHtml = '';
      for (var n = 0; n < notes.length; n++) noteHtml += '<p class="u-xs u-dim">' + esc(String(notes[n])) + '</p>';

      return '<div class="result-box"><div class="result-box__label">读到的离子（mg/L）</div>' +
          '<div class="row row--tight" style="flex-wrap:wrap;gap:6px">' + mineRows + '</div>' +
          (noteHtml ? '<div class="mt-8">' + noteHtml + '</div>' : '') +
        '</div>' +
        (rows
          ? '<div class="result-box mt-12"><div class="result-box__label">最接近的水型</div>' +
            '<div class="table-wrap" style="border:0"><table class="table table--compact">' +
            '<thead><tr><th>水型</th><th class="num" style="width:80px">距离</th>' +
            '<th>主要偏差（水型 − 你的）</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>'
          : '') +
        '<p class="u-xs u-dim mt-8" style="line-height:1.6">只回答"我离谁最近"。' +
        '要加多少盐，请到配方页的水质面板点「水质匹配」——那里能拿到按批次量缩放的盐量。</p>';
    }
  });

  /* ======================================================================
   * v1.4 追加：第 11 张卡 —— 反向查询「我的水能酿什么酒」
   * ----------------------------------------------------------------------
   * 正推（第 10 张卡）是「粘贴水质报告 → 匹配水型 → 建议加盐」。
   * 家酿的第一问其实是反的：**我这儿的水能做什么酒**。先有水源，再谈选风格。
   *
   * 计算全在 27 的 WaterMatch.reverseLookup()，这里只负责摆输入、摆输出。
   * 三条界面纪律：
   *   ① 空输入不给数字：六个数一个都没填时，界面上不能出现"最像伯顿"这种
   *      看起来像结论的东西（全按 0 比，答案永远是纯水）；
   *   ② 相似度必须带定语：写"相对相似度 / 像不像"，**不许**写成"匹配度 92%"
   *      或"你的水 92 分"——那不是这个数能承担的意思；
   *   ③ 推荐风格要能点进经典配方库；库里没有该风格条目时**不装成能点**，
   *      而是明说"经典库暂无"，免得点出一片空白。
   * ====================================================================*/

  var REVERSE_IONS = [
    { k: 'ca', label: 'Ca²⁺ 钙', hint: '必填 · 20–80 常见' },
    { k: 'mg', label: 'Mg²⁺ 镁', hint: '必填 · 通常 < 30' },
    { k: 'na', label: 'Na⁺ 钠', hint: '选填 · > 100 会咸' },
    { k: 'cl', label: 'Cl⁻ 氯化物', hint: '必填 · 与 SO₄ 一起定风味' },
    { k: 'so4', label: 'SO₄²⁻ 硫酸盐', hint: '必填 · 高则苦味干脆' },
    { k: 'hco3', label: 'HCO₃⁻ 碳酸氢盐', hint: '选填 · 碱度，深色酒要高' }
  ];

  function styleMeta(id) {
    var list = (BREW.DB && BREW.DB.styles) || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  /** 经典配方库里有没有这个风格的条目（决定"能不能点"） */
  function classicHasStyle(styleId) {
    var list = (BREW.DB && BREW.DB.classicRecipes) || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].styleId === styleId) return true;
    return false;
  }

  /**
   * 跳到经典配方库并按风格筛出来。
   * 为什么不改写 52 的模块状态：那是它的私有 state，从这里伸手进去等于
   * 让两个视图共享隐式变量。走"渲染完 → 填搜索框 → 派发 input"这条路，
   * 用的是 52 自己已有的输入处理，不多一条耦合路径。
   */
  function jumpToClassicStyle(styleId) {
    var st = styleMeta(styleId);
    if (!st) {
      UI.Shell.toast('风格库里没有编号 ' + styleId, 'warn', 3200);
      return;
    }
    if (!classicHasStyle(styleId)) {
      UI.Shell.toast('经典配方库里还没有「' + st.name + '」（' + styleId + '）的条目，' +
        '可以去配方设计里以它为目标从零配一份', 'warn', 4200);
      return;
    }
    if (UI.Shell && typeof UI.Shell.closeModal === 'function') UI.Shell.closeModal();
    UI.Shell.go('classic');
    /* hash 路由是异步的（hashchange 里才真正 render），所以这里轮询等搜索框出现，
       最多等 12 次 × 80ms。用固定 sleep 会在慢机器上偶发失败。 */
    var tries = 0;
    (function wait() {
      tries++;
      var q = document.getElementById('classic-q');
      if (q) {
        q.value = st.name;
        var ev = null;
        try { ev = new root.Event('input', { bubbles: true }); } catch (e) {
          ev = root.document.createEvent('Event');
          ev.initEvent('input', true, true);
        }
        q.dispatchEvent(ev);
        return;
      }
      if (tries < 12) root.setTimeout(wait, 80);
    })();
  }

  /** 读一个可用的"已有水源"。返回 {name, ions} 或 null */
  function readSavedSource(value) {
    var v = String(value || '');
    if (v === 'recipe') {
      var src = (UI.recipe() || {}).water || {};
      src = src.source || {};
      var any = false, o1 = {};
      for (var i = 0; i < REVERSE_IONS.length; i++) {
        var k1 = REVERSE_IONS[i].k;
        var n1 = num(src[k1], 0);
        o1[k1] = n1;
        if (n1 > 0) any = true;
      }
      return any ? { name: '本配方源水', ions: o1 } : null;
    }
    if (v.indexOf('uw:') === 0) {
      var id = v.slice(3);
      var st = UI.store;
      var list = (st && typeof st.get === 'function') ? st.get('userWater', []) : [];
      if (!Array.isArray(list)) return null;
      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        if (!e || e.id !== id) continue;
        var ions = e.ions || {};
        var o2 = {};
        for (var m = 0; m < REVERSE_IONS.length; m++) {
          var k2 = REVERSE_IONS[m].k;
          var raw = ions[k2];
          o2[k2] = (raw === null || raw === undefined || !isFinite(num(raw, NaN))) ? null : num(raw, 0);
        }
        return { name: String(e.name || '我的水源'), ions: o2 };
      }
    }
    return null;
  }

  /** 输入框里读一个离子：空 = null（"没测"），0 是有效值（RO 水就该填 0） */
  function ionInput(api, k) {
    var el = api.query('[data-in="' + k + '"]');
    if (!el) return null;
    var raw = String(el.value === null || el.value === undefined ? '' : el.value).trim();
    if (!raw) return null;
    var v = parseFloat(raw);
    if (!isFinite(v) || v < 0) return null;
    return v;
  }

  TOOLS.push({
    id: 'waterreverse',
    icon: 'drop',
    title: '我的水能酿什么酒',
    desc: '填六个离子（或读已有水源），反推最适合的风格与最像的水型',
    build: function () {
      var r = UI.recipe();

      /* 「从已有数据读入」：配方源水 + Store 里存过的水源（v1.2 的
         「水质匹配 → 存为我的水源」就写在这里，结构见 42-ui-recipe.js） */
      var srcOpts = [{ v: 'manual', t: '手动输入（默认）' }];
      var src0 = ((r || {}).water || {}).source || {};
      var hasSrc = false;
      for (var i0 = 0; i0 < REVERSE_IONS.length; i0++) {
        if (num(src0[REVERSE_IONS[i0].k], 0) > 0) hasSrc = true;
      }
      if (hasSrc) srcOpts.push({ v: 'recipe', t: '本配方源水（《' + String(r.name || '当前配方') + '》）' });
      var saved = [];
      try {
        var st = UI.store;
        saved = (st && typeof st.get === 'function') ? st.get('userWater', []) : [];
      } catch (e) { saved = []; }
      if (!Array.isArray(saved)) saved = [];
      for (var i1 = 0; i1 < saved.length; i1++) {
        var ent = saved[i1];
        if (!ent || !ent.id) continue;
        srcOpts.push({ v: 'uw:' + ent.id, t: '我的水源 · ' + String(ent.name || ent.id) });
      }

      /* 加盐建议的目标水型：auto = 让算法挑一套和你明显不同的 */
      var tOpts = [{ v: 'auto', t: '自动：挑一套和你明显不同的水型' }];
      var profs = (BREW.DB && BREW.DB.waterProfiles) || [];
      for (var i2 = 0; i2 < profs.length; i2++) {
        if (!profs[i2] || profs[i2].id === 'wp-custom') continue;
        tOpts.push({ v: profs[i2].id, t: String(profs[i2].name || profs[i2].id) });
      }

      var fields = '';
      for (var i3 = 0; i3 < REVERSE_IONS.length; i3++) {
        var ion = REVERSE_IONS[i3];
        fields += field(ion.k, ion.label, '', 'mg/L', { step: '1', hint: ion.hint });
      }
      fields += field('vol', '批次量（盐量基准）', fmt(num(r.batchSize, 20), 1), 'L', { step: '0.5' });

      return '<div class="grid-2">' + fields + '</div>' +
        '<p class="u-xs u-dim mt-8" style="line-height:1.6">' +
          '空着 = 没测（不参与比较）；<b>RO 纯水请明确填 0</b>——两者在算法里不是一回事。' +
          '至少填 Ca / Mg / SO₄ / Cl 四项，Na 与 HCO₃ 有就填。' +
        '</p>' +
        (srcOpts.length > 1
          ? selectField('src', '从已有数据读入（选一次会把数值填进上面六个框）', srcOpts, 'manual')
          : '') +
        selectField('target', '想往哪套水靠（只影响下面的加盐建议）', tOpts, 'auto');
    },
    calc: function (api) {
      if (!BREW.WaterMatch || typeof BREW.WaterMatch.reverseLookup !== 'function') {
        return warnBox('反向查询需要 js/27-calc-water-match.js 里的 reverseLookup()，' +
          '模块未载入或版本过旧，这一步暂时算不了。', 'warn');
      }

      /* ① 「从已有数据读入」只在**选择变化**时填一次。
         每次 calc 都回填的话，用户手改的数值会被立刻冲掉（输入事件 → 重算 → 回填）。 */
      var srcVal = s(api, 'src') || 'manual';
      if (srcVal !== 'manual' && this.__srcApplied !== srcVal) {
        var got = readSavedSource(srcVal);
        if (got) {
          for (var f = 0; f < REVERSE_IONS.length; f++) {
            var fk = REVERSE_IONS[f].k;
            var el = api.query('[data-in="' + fk + '"]');
            if (!el) continue;
            el.value = (got.ions[fk] === null || got.ions[fk] === undefined) ? '' : String(got.ions[fk]);
          }
          this.__srcApplied = srcVal;
          this.__srcName = got.name;
        }
      }
      if (srcVal === 'manual') { this.__srcApplied = ''; this.__srcName = ''; }

      /* ② 读六个离子 */
      var ions = {}, filled = 0;
      for (var i = 0; i < REVERSE_IONS.length; i++) {
        var k = REVERSE_IONS[i].k;
        ions[k] = ionInput(api, k);
        if (ions[k] !== null) filled++;
      }

      /* ③ 一个都没填：不给数字，给"该填什么"。算出一堆 0 只会得到"你最像纯水" */
      if (!filled) {
        return '<div class="alert alert--info mt-8">' +
          '<span class="alert__icon">' + icon('info', 13) + '</span>' +
          '<span>还没有可算的数。先填至少 <b>Ca / Mg / SO₄ / Cl</b> 四项（mg/L），' +
          '然后下面会出现"最像的 3 个水型"和"这水适合做的 8–12 个风格"。</span></div>' +
          '<p class="u-xs u-dim mt-8" style="line-height:1.6">' +
          '不知道自己的水质？先到第 10 张卡「水质匹配」粘一份供水公司报告，' +
          '再点「存为我的水源」，回头在这里选「从已有数据读入」即可。' +
          '六个框全空时任何水型都能"最像"（都按 0 比），所以这里不硬算。' +
          '</p>';
      }

      var tgtVal = s(api, 'target') || 'auto';
      var res = null;
      try {
        res = BREW.WaterMatch.reverseLookup(ions, {
          volumeL: n(api, 'vol', 20),
          adjustTarget: (tgtVal === 'auto' ? '' : tgtVal)
        });
      } catch (e) {
        return warnBox('反向查询出错：' + ((e && e.message) || '未知错误'), 'error');
      }
      if (!res) return warnBox('反向查询没有返回结果。', 'warn');

      if (!res.nearest || !res.nearest.length) {
        return warnBox(res.message || '算不出最接近的水型：可能是离子全为 0，或者水型库为空。', 'warn') +
          '<p class="u-xs u-dim mt-8">' + esc(res.note || '') + '</p>';
      }

      return reverseResultHtml(res);
    },
    onPick: function (val) {
      if (String(val).indexOf('style:') === 0) jumpToClassicStyle(String(val).slice(6));
    }
  });

  /** 反向查询的结果区：水型 3 个 + 风格 8–12 个 + 加盐建议 */
  function reverseResultHtml(res) {
    var html = '';

    /* ---- A. 最像的 3 个水型 ---- */
    var near = '';
    for (var i = 0; i < res.nearest.length; i++) {
      var n = res.nearest[i];
      var ionBits = '';
      for (var j = 0; j < REVERSE_IONS.length; j++) {
        var rk = REVERSE_IONS[j].k;
        ionBits += '<span class="wm-ion"><span class="wm-ion__k">' +
          esc(REVERSE_IONS[j].label.split(' ')[0]) + '</span>' +
          '<span>' + esc(fmt(n.ions[rk], 0)) + '</span></span>';
      }
      near += '<div class="wm-card">' +
        '<div class="wm-card__head">' +
          '<b>' + esc(String(n.name || n.id)) + '</b>' +
          '<span class="u-xs u-dim u-mono">像 ' + esc(fmt(n.fitPercent, 0)) + '%' +
            (n.compared < 6 ? ' · 只比了 ' + n.compared + ' 项' : '') + '</span>' +
        '</div>' +
        (n.desc ? '<p class="u-xs u-dim" style="margin:0 0 6px;line-height:1.55">' + esc(String(n.desc)) + '</p>' : '') +
        '<div class="wm-ionrow">' + ionBits +
          '<span class="u-xs u-dim" style="align-self:center">mg/L</span></div>' +
        '</div>';
    }
    html += '<div class="result-box"><div class="result-box__label">' +
      '最像的 3 个水型（"像多少"＝相对相似度，不是水质达标率）</div>' + near + '</div>';

    /* ---- B. 推荐的风格 ---- */
    var recRows = '';
    var list = res.recommended || [];
    for (var a = 0; a < list.length; a++) {
      var rc = list[a];
      var clickable = classicHasStyle(rc.styleId);
      var nameCell = clickable
        ? '<button type="button" class="btn btn-ghost btn-sm" data-pick="style:' + attr(rc.styleId) + '">' +
          esc(rc.styleId + ' · ' + rc.nameZh) + '</button>'
        : '<span class="tag">' + esc(rc.styleId + ' · ' + rc.nameZh) + '</span>' +
          '<span class="u-xs u-dim"> 经典库暂无</span>';
      recRows += '<tr>' +
        '<td style="white-space:nowrap">' + nameCell + '</td>' +
        '<td class="u-sm u-muted">' + esc(String(rc.why || '')) + '</td>' +
        '<td class="u-sm u-dim" style="white-space:nowrap">' + esc(String(rc.profileName || '')) +
          ' · ' + esc(fmt(rc.fitPercent, 0)) + '%</td>' +
        '</tr>';
    }
    html += '<div class="result-box mt-12"><div class="result-box__label">' +
      '这水适合做的风格（' + list.length + ' 个 · 点风格名跳到经典配方库）</div>' +
      '<div class="table-wrap" style="border:0"><table class="table table--compact">' +
      '<thead><tr><th style="width:190px">风格</th><th>为什么这水适合</th>' +
      '<th class="num" style="width:176px">来自水型</th></tr></thead>' +
      '<tbody>' + recRows + '</tbody></table></div>' +
      '<p class="u-xs u-dim mt-8" style="line-height:1.6">' +
      '这些对应关系是<b>产区水型与代表风格的常识性对应</b>，不是打分算出来的：' +
      '风格库里没有水质区间数据，所以这里不给风格打"水质分"。' +
      '换个风格只要水能调到位都能酿，这张表说的是"你这水不用大调就能酿什么"。</p></div>';

    /* ---- C. 加盐建议 ---- */
    if (res.adjust) {
      var ad = res.adjust;
      var saltsHtml = '';
      if (ad.salts && ad.salts.length) {
        var srows = '';
        for (var b = 0; b < ad.salts.length; b++) {
          var s1 = ad.salts[b] || {};
          var dl = s1.deltas || {};
          var dbs = [];
          for (var d = 0; d < REVERSE_IONS.length; d++) {
            var dk = REVERSE_IONS[d].k;
            if (dl[dk] === undefined || dl[dk] === null) continue;
            if (Math.abs(num(dl[dk], 0)) < 0.5) continue;
            dbs.push(esc(REVERSE_IONS[d].label.split(' ')[0]) + ' +' + esc(fmt(dl[dk], 1)));
          }
          srows += '<tr>' +
            '<td>' + esc(String(s1.name || s1.id || '')) + '</td>' +
            '<td class="num u-mono">' + esc(fmt(s1.grams, 1)) + ' ' + esc(s1.unit || 'g') + '</td>' +
            '<td class="num u-mono u-sm">' + esc(fmt(num(s1.volL, ad.volumeL), 0)) + ' L</td>' +
            '<td class="u-sm u-muted">' + (dbs.join('、') || '—') + '</td>' +
            '</tr>';
        }
        saltsHtml = '<div class="table-wrap" style="border:0;margin-top:6px">' +
          '<table class="table table--compact">' +
          '<thead><tr><th>盐</th><th class="num" style="width:80px">用量</th>' +
          '<th class="num" style="width:64px">加到</th><th>各离子增量（mg/L）</th></tr></thead>' +
          '<tbody>' + srows + '</tbody></table></div>';
      }
      html += '<div class="result-box mt-12"><div class="result-box__label">' +
        '想更接近「' + esc(String(ad.profileName || ad.profileId)) + '」，加盐能做到哪一步' +
        (ad.auto ? '（自动挑的目标）' : '（你选的目标）') + '</div>' +
        '<p class="u-sm" style="margin:2px 0 0;line-height:1.65">' + esc(String(ad.note || '')) + '</p>' +
        saltsHtml +
        (ad.detail ? '<p class="u-xs u-dim mt-8" style="line-height:1.6">' + esc(String(ad.detail)) + '</p>' : '') +
        '<p class="u-xs u-dim mt-8">目标可以改成任意一套水型——上面「想往哪套水靠」那一栏。</p>' +
        '</div>';
    }

    /* ---- D. 口径声明（这一段不是客套：不给的话用户会把百分数当验收结论） ---- */
    html += '<p class="u-xs u-dim mt-12" style="line-height:1.65">' + esc(String(res.caveat || '')) + '</p>';
    if (res.note) html += '<p class="u-xs u-dim mt-8" style="line-height:1.65">' + esc(String(res.note)) + '</p>';
    return html;
  }

  /* ======================================================================
   * v1.6 新增四件（11 → 15）：比色卡 / 碳化三联表 / 酒花替换 / 糖化温度→酒体
   * ----------------------------------------------------------------------
   * 入选标准（三条同时满足才写）：
   *   ① 家酿会**重复用**，不是"看起来专业"；
   *   ② 数据在库里，或有确定公式/可引用的表，**不编经验系数**；
   *   ③ 与现有工具互补，不是换皮。
   * 被否掉的候选（苦度平衡尺 / 海拔修正 / 酵母代次 / 柏拉图三联 / 比重计
   * 温度校正）与理由写在交付报告，这里不留半成品。
   *
   * 样式：不改 css/*.css、不改 index.html，全部走"面板内 <style>"，
   * 选择器带 srmc- / tbx- / blp- 前缀，面板关掉即随 DOM 一起消失。
   * ====================================================================*/

  /* ------------------------------------------------------------ 色度换算
     EBC = SRM × 1.97（EBC 与 SRM 的法定换算式）
     °Lovibond = SRM × 1.3546 − 0.76：单位换算工具里一直在用的同一条式子，
       本次提成函数让两处共用一个实现——"同一件事两处实现"是这个项目
       已经踩过的坑（见 40-ui-shell 里 hexFromSrm 那段注释），不再复现。 */
  function srmToEbc(srm) { return num(srm, 0) * 1.97; }
  function ebcToSrm(ebc) { return num(ebc, 0) / 1.97; }
  function srmToLov(srm) { return num(srm, 0) * 1.3546 - 0.76; }
  function lovToSrm(lov) { return (num(lov, 0) + 0.76) / 1.3546; }

  /** SRM → 中文色名。颜色本身走 UI.colorOfSrm()（唯一实现），这里只取名字 */
  function srmName(srm) {
    var C = BREW.color;
    if (C && typeof C.nameFromSRM === 'function') return C.nameFromSRM(srm);
    return '';
  }

  /** 风格 id 的排序键：让 '21B-Rye' 排在 '21A' 之后，而不是按字符串排到 '2B' 前面 */
  function cmpStyleId(a, b) {
    var ma = String((a && a.id) || '').match(/^\d+/), mb = String((b && b.id) || '').match(/^\d+/);
    var na = num(ma ? ma[0] : '', 999), nb = num(mb ? mb[0] : '', 999);
    if (na !== nb) return na - nb;
    var ia = String((a && a.id) || ''), ib = String((b && b.id) || '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  }

  /**
   * 落在某个 SRM 的风格 —— 反查的唯一实现。
   * 数据只从 BREW.DB.styles[].srm（[lo, hi]）读，界面不许出现手抄的区间：
   * 15-data-style 改一格，这里立刻跟着变。
   */
  function stylesAtSrm(v) {
    var list = (BREW.DB && BREW.DB.styles) || [], out = [], i;
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || !Array.isArray(s.srm) || s.srm.length < 2) continue;
      if (v >= s.srm[0] - 1e-9 && v <= s.srm[1] + 1e-9) out.push(s);
    }
    /* 28A/29A/30A/33A 是"随基酒而变"的分类，本库给了自定窗口（2–20 / 2–30）。
       它们会在**每一格**都命中，排前面会把真正的例子挤掉，所以统一沉到末尾。 */
    out.sort(function (a, b) {
      var la = a.rangeSource === 'local' ? 1 : 0, lb = b.rangeSource === 'local' ? 1 : 0;
      if (la !== lb) return la - lb;
      return cmpStyleId(a, b);
    });
    return out;
  }

  /** 该色度上"最典型"的风格：取色度窗口最窄的那条（窗口越窄越说明它的颜色是特征） */
  function typicalStyle(hits) {
    var best = null, bw = Infinity, i;
    for (i = 0; i < hits.length; i++) {
      if (hits[i].rangeSource === 'local') continue;
      var w = hits[i].srm[1] - hits[i].srm[0];
      if (w < bw) { bw = w; best = hits[i]; }
    }
    return best || hits[0] || null;
  }

  /** 本库最浅的风格色度（用于解释"为什么 SRM 1 一条都没有"） */
  function minStyleSrm() {
    var list = (BREW.DB && BREW.DB.styles) || [], m = 99, i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && Array.isArray(list[i].srm) && list[i].srm[0] < m) m = list[i].srm[0];
    }
    return m === 99 ? 0 : m;
  }

  /** 当前配方的色度（算不出就给 null，界面上不装作有数） */
  function currentRecipeSrm() {
    var r = null, c = null;
    try { r = UI.recipe(); } catch (e) { r = null; }
    if (!r) return null;
    try { c = UI.calc(r); } catch (e2) { c = null; }
    if (!c || !isFinite(num(c.srm, NaN))) return null;
    return { name: String(r.name || '当前配方'), srm: num(c.srm, 0) };
  }

  /* ------------------------------------------------------------ 打印（面板级）
   * 纪律：只在"工具面板打开 + 本次打印由面板发起"时生效。
   *   ① 所有规则都挂在 body.blp-on 上，且用 :has(#modal-root:not([hidden]))
   *      再锁一道——万一类没摘干净，也不会把配方卡的打印整页变白；
   *   ② 不写 @page、不写宽度/字号给 .report-sheet，配方卡 186mm / 1 页
   *      那套几何一个数都不碰；
   *   ③ 打印完立刻摘类（print() 在 Chrome 同步返回，afterprint 兜底）。 */
  var PRINT_CSS = [
    '@media print {',
    '  body.blp-on:has(#modal-root:not([hidden])) #app,',
    '  body.blp-on:has(#modal-root:not([hidden])) .toasts { display:none !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) #modal-root {',
    '    position:static !important; inset:auto !important; display:block !important;',
    '    padding:0 !important; background:#fff !important; animation:none !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .modal {',
    '    width:auto !important; max-width:none !important; max-height:none !important;',
    '    border:0 !important; border-radius:0 !important; box-shadow:none !important;',
    '    overflow:visible !important; animation:none !important; background:#fff !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .modal__head {',
    '    padding:0 0 3mm !important; border:0 !important; background:#fff !important; }',
    /* 标题与副标题在纸上改上下排：横排时副标题会飘到纸的右边缘，
       和标题隔了 18cm，看起来像两条无关的文字 */
    '  body.blp-on:has(#modal-root:not([hidden])) .modal__head { display:block !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .modal__head h2 { font-size:13pt !important; color:#000 !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .modal__sub { display:block !important; margin-top:1mm !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .modal__sub { font-size:8pt !important; color:#333 !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .modal__body {',
    '    padding:0 !important; overflow:visible !important; max-height:none !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .modal__foot,',
    '  body.blp-on:has(#modal-root:not([hidden])) [data-close],',
    '  body.blp-on:has(#modal-root:not([hidden])) .blp-noprint { display:none !important; }',
    '  /* 色块是 background，不强制彩色打印的话纸上会是一片白 */',
    '  body.blp-on:has(#modal-root:not([hidden])) * {',
    '    -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .card { border-color:#bbb !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .srmc-cell { border-color:transparent !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .srmc-cell.is-sel { border-color:#000 !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .srmc-grid { gap:1.2mm !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .srmc-chip { height:9mm !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .srmc-n { font-size:7pt !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .srmc-ebc,',
    '  body.blp-on:has(#modal-root:not([hidden])) .srmc-name,',
    '  body.blp-on:has(#modal-root:not([hidden])) .srmc-ex { font-size:5.6pt !important; line-height:1.25 !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .srmc-ex { max-height:none !important; }',
    '  /* 带内页宽 182mm = 688px，会命中 @media (max-width:800px)：.grid-2 被压成',
    '     单列，90 条风格的对照表会从 2 页涨到 5 页。这里只针对面板内还原成双列。 */',
    '  body.blp-on:has(#modal-root:not([hidden])) .modal .grid-2 {',
    '    grid-template-columns:repeat(2, minmax(0,1fr)) !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .tbx-tb { font-size:6.4pt !important; }',
    '  body.blp-on:has(#modal-root:not([hidden])) .tbx-tb td,',
    '  body.blp-on:has(#modal-root:not([hidden])) .tbx-tb th { padding:0.7mm 1mm !important; }',
    '}'
  ].join('\n');

  /** 打印当前面板。返回值给 Shell.modal 的 act 用：false = 别关面板 */
  function printPanel() {
    var doc = root.document, body = doc && doc.body;
    if (!body) return false;
    body.classList.add('blp-on');
    var cleaned = false;
    function clean() {
      if (cleaned) return;
      cleaned = true;
      body.classList.remove('blp-on');
      try { root.removeEventListener('afterprint', clean); } catch (e) { /* ignore */ }
    }
    try { root.addEventListener('afterprint', clean); } catch (e2) { /* ignore */ }
    try { root.print(); } catch (e3) { clean(); throw e3; }
    /* 无头环境里 print() 直接返回、也不发 afterprint；30s 兜底防止类常驻。
       对话框开着时 JS 是被阻塞的，所以这个定时器不会在打印中途插进来。 */
    root.setTimeout(clean, 30000);
    return false;
  }

  var SRM_PANEL_CSS = [
    '.srmc-grid { display:grid; grid-template-columns:repeat(10, minmax(0,1fr)); gap:5px; }',
    '.srmc-cell { display:flex; flex-direction:column; align-items:stretch; gap:0;',
    '  padding:0 0 3px; border:1px solid transparent; border-radius:7px; background:transparent;',
    '  font:inherit; color:inherit; cursor:pointer; text-align:left; min-width:0; }',
    '.srmc-cell:hover { border-color:var(--line-3); background:var(--bg-1); }',
    '.srmc-cell.is-sel { border-color:var(--amber); background:var(--amber-tint); }',
    /* 「当前」做成压在色块右上角的小标签：写在数字行里会把 EBC 挤出去，
       实测 8 号那格变成"8 当前 15.8 EBC"三样东西抢一行 */
    '.srmc-cell.is-cur { position:relative; box-shadow:0 0 0 1px var(--amber) inset; }',
    '.srmc-cell.is-cur .srmc-chip::after { content:"当前"; position:absolute; top:2px; right:2px;',
    '  font-size:8.5px; line-height:1.5; padding:0 3px; border-radius:3px;',
    '  background:rgba(0,0,0,.55); color:#fff; font-family:inherit; }',
    '.srmc-chip { position:relative; }',
    '.srmc-chip { display:block; height:30px; border-radius:5px 5px 2px 2px;',
    '  border:1px solid rgba(0,0,0,.22); box-shadow:inset 0 1px 0 rgba(255,255,255,.25); margin-bottom:3px; }',
    /* 色阶号与 EBC 同一行：把省下来的那一行让给风格举例，例子才不会被截成"美式淡爽拉…" */
    '.srmc-top { display:flex; align-items:baseline; justify-content:space-between; gap:2px; padding:0 3px; line-height:1.5; }',
    '.srmc-n { font-family:var(--num); font-size:11.5px; color:var(--tx-1); }',
    '.srmc-ebc { font-family:var(--num); font-size:9px; color:var(--tx-3); white-space:nowrap; }',
    '.srmc-name { font-size:10px; color:var(--tx-2); padding:0 3px; line-height:1.45;',
    '  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.srmc-ex { font-size:9.5px; color:var(--tx-3); padding:0 3px; line-height:1.45;',
    '  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.srmc-ex b { font-weight:400; color:var(--tx-2); }',
    '.tbx-tb { font-family:var(--num); font-variant-numeric:tabular-nums; }',
    '.tbx-tb td, .tbx-tb th { padding:2px 5px; font-size:12px; text-align:right; }',
    '.tbx-tb th:first-child, .tbx-tb td:first-child { text-align:left; }',
    '.tbx-axis { position:relative; height:30px; border-radius:6px; overflow:hidden;',
    '  display:flex; border:1px solid var(--line-2); }',
    '.tbx-axis__seg { height:100%; }',
    '.tbx-axis__mark { position:absolute; top:-4px; bottom:-4px; width:2px; background:var(--tx-1); }',
    '.tbx-axis__mark::after { content:""; position:absolute; top:50%; left:-4px; width:8px; height:8px;',
    '  margin-top:-4px; border-radius:50%; background:var(--amber); border:1px solid #fff; }'
  ].join('\n');

  /* ------------------------------------------------------ 12 SRM 比色卡 */
  TOOLS.push({
    id: 'srmcard',
    icon: 'layers',
    title: 'SRM 比色卡',
    desc: 'SRM 1–40 全谱对照，输入色度反查落在窗口里的风格，可打印带走',
    build: function () {
      var cur = currentRecipeSrm();
      this.__cur = cur;
      var start = cur ? Math.max(1, Math.min(40, Math.round(cur.srm))) : 8;

      return '<style>' + SRM_PANEL_CSS + '\n' + PRINT_CSS + '</style>' +
        '<div class="blp-noprint">' +
          '<div class="row" style="align-items:flex-end;gap:14px;flex-wrap:wrap">' +
            '<div class="field" style="width:118px">' +
              '<label class="field__label" for="t-srm">色度 SRM</label>' +
              '<input class="input input--num" id="t-srm" data-in="srm" type="number" ' +
                'min="1" max="40" step="0.5" value="' + attr(start) + '">' +
            '</div>' +
            '<div class="field" style="flex:1 1 280px">' +
              '<label class="field__label" for="t-srmr">拖动查色 1 → 40</label>' +
              '<input class="input" id="t-srmr" data-in="srmr" type="range" ' +
                'min="1" max="40" step="0.5" value="' + attr(start) + '" ' +
                'style="height:36px;padding:0 10px">' +
            '</div>' +
          '</div>' +
          (cur
            ? '<p class="u-xs u-dim" style="margin:8px 0 0">当前配方《' + esc(cur.name) + '》算出来是 ' +
              '<b class="u-mono">' + fmt(cur.srm, 1) + ' SRM</b>' +
              (cur.srm < 1 || cur.srm > 40
                ? '（超出 1–40 的显示范围，色卡按边界显示）'
                : '，色卡上带「当前」的那一格就是它') + '</p>'
            : '') +
          '<p class="u-xs u-dim" style="margin:6px 0 0">' +
            '点任意一格 = 把那一档选成"当前色度"，下面的风格反查跟着变；点风格名可以跳到经典配方库。' +
            '打印按钮只印色卡本身，控件不会出现在纸上。</p>' +
        '</div>';
    },
    calc: function (api) {
      var v = Math.max(1, Math.min(40, num(n(api, 'srm', 8), 8)));
      var hits = stylesAtSrm(v);
      var out = '';

      out += '<div class="row" style="gap:14px;align-items:baseline;margin:14px 0 10px;flex-wrap:wrap">' +
        '<b class="u-mono" style="font-size:26px;line-height:1.1;color:var(--amber-soft)">' + fmt(v, 1) + '</b>' +
        '<span class="u-sm u-muted">SRM · ' + fmt(srmToEbc(v), 1) + ' EBC · ' + fmt(srmToLov(v), 1) + ' °Lovibond</span>' +
        '<span class="chip is-on" style="cursor:default"><span>' + esc(srmName(v)) + '</span></span>' +
        '<span style="flex:1"></span>' +
        '<span class="u-xs u-dim">这一档落在 ' + hits.length + ' 个风格的色度窗口内</span>' +
        '</div>';

      out += srmGridHtml(v, this.__cur);
      out += srmReverseHtml(v, hits);
      out += srmStyleTableHtml();
      return out;
    },
    render: function (api) {
      /* 数字框与滑块互相同步。直接绑在元素上（target 阶段先于 body 上的
         通用 input 委托），所以通用重算读到的永远是同步后的值。 */
      if (!api.__srmWired) {
        api.__srmWired = true;
        var numEl = api.query('[data-in="srm"]');
        var rngEl = api.query('[data-in="srmr"]');
        if (numEl && rngEl) {
          rngEl.addEventListener('input', function () { numEl.value = rngEl.value; });
          numEl.addEventListener('input', function () {
            var v = parseFloat(numEl.value);
            if (isFinite(v)) rngEl.value = String(Math.max(1, Math.min(40, v)));
          });
        }
      }
      var out = api.query('#tool-out');
      if (out) out.innerHTML = this.calc(api);
    },
    onPick: function (val, hit, api) {
      var s = String(val);
      if (s.indexOf('srm:') === 0) {
        var v = num(s.slice(4), 8);
        var numEl = api.query('[data-in="srm"]');
        var rngEl = api.query('[data-in="srmr"]');
        if (numEl) numEl.value = String(v);
        if (rngEl) rngEl.value = String(v);
        this.render(api);
        return;
      }
      if (s.indexOf('style:') === 0) jumpToClassicStyle(s.slice(6));
    },
    actions: function () {
      return [{ label: '打印色卡', kind: 'primary', act: function () { return printPanel(); } }];
    }
  });

  /** 40 格色卡。每一格除了颜色还带"这个色度最典型的风格"，例从库里现算 */
  function srmGridHtml(sel, cur) {
    var html = '<div class="srmc-grid">';
    var curV = cur ? Math.round(cur.srm) : -1;
    for (var v = 1; v <= 40; v++) {
      var hits = stylesAtSrm(v);
      var ex = typicalStyle(hits);
      var cls = 'srmc-cell' + (Math.abs(sel - v) < 0.5 ? ' is-sel' : '') + (curV === v ? ' is-cur' : '');
      var tip = 'SRM ' + v + '（' + fmt(srmToEbc(v), 1) + ' EBC）' + srmName(v) + '：' +
        (hits.length
          ? hits.slice(0, 6).map(function (x) { return x.id + ' ' + x.name; }).join('、') +
            (hits.length > 6 ? ' 等 ' + hits.length + ' 种' : '')
          : '本库最浅的风格是 SRM ' + minStyleSrm() + '，这一档没有对应风格');
      html += '<button type="button" class="' + cls + '" data-pick="srm:' + v + '" title="' + attr(tip) + '">' +
        '<span class="srmc-chip" style="background:' + attr(UI.colorOfSrm(v)) + '"></span>' +
        '<span class="srmc-top"><span class="srmc-n">' + v + '</span>' +
          '<span class="srmc-ebc">' + fmt(srmToEbc(v), 1) + ' EBC</span></span>' +
        '<span class="srmc-name">' + esc(srmName(v)) + '</span>' +
        /* 举例只放名字，不放"+N 种"：79px 宽的格子里塞不下两个信息，
           塞了就会变成"美式淡爽拉…"。总数在 title 与下方反查区里都有。 */
        '<span class="srmc-ex">' + (ex ? '<b>' + esc(ex.name) + '</b>' : '—') + '</span>' +
        '</button>';
    }
    return html + '</div>';
  }

  /** 反查结果：落在该色度的全部风格，可点进经典配方库 */
  function srmReverseHtml(v, hits) {
    var html = '<div class="card mt-16">' +
      '<div class="card__head"><h2>SRM ' + fmt(v, 1) + ' 落在这些风格的色度窗口里</h2>' +
        '<span class="spacer"></span><span class="u-xs u-dim">' + hits.length + ' 条</span></div>' +
      '<div class="card__body">';

    if (!hits.length) {
      html += '<p class="u-sm" style="line-height:1.7">本库最浅的风格是 <b>SRM ' + fmt(minStyleSrm(), 1) + '</b>，' +
        '比它更浅的色度没有对应的风格窗口（SRM 1 接近纯水色，实际啤酒很少低于 2）。</p>';
    } else {
      html += '<div class="row" style="gap:8px">';
      for (var i = 0; i < hits.length; i++) {
        var s = hits[i];
        html += '<button type="button" class="chip" data-pick="style:' + attr(s.id) + '" title="' +
          attr(s.id + ' ' + s.name + ' · ' + fmt(s.srm[0], 1) + '–' + fmt(s.srm[1], 1) + ' SRM' +
            (s.rangeSource === 'local' ? '（本库自定窗口）' : '')) + '">' +
          '<span>' + esc((s.rangeSource === 'local' ? '* ' : '') + s.id + ' ' + s.name) + '</span></button>';
      }
      html += '</div>';
      html += '<p class="u-xs u-dim mt-8" style="line-height:1.6">' +
        '区间来自风格库的 srm 字段（BJCP 2021 口径），不是这张卡手写的。' +
        '带 <b>*</b> 的是"随基酒而变"的分类（28A/29A/30A/33A），本库给了自定窗口，界面上标注为自定。' +
        '点风格会跳到经典配方库并按风格筛选；库里没有该风格条目时会明说，不会点出一片空白。</p>';
    }
    return html + '</div>';
  }

  /** 全库 90 条风格的色度窗口，按色度升序、双列排（给屏幕查，不印在纸上） */
  function srmStyleTableHtml() {
    var list = ((BREW.DB && BREW.DB.styles) || []).filter(function (s) {
      return s && Array.isArray(s.srm) && s.srm.length >= 2;
    });
    list.sort(function (a, b) {
      var la = a.rangeSource === 'local' ? 1 : 0, lb = b.rangeSource === 'local' ? 1 : 0;
      if (la !== lb) return la - lb;
      if (a.srm[0] !== b.srm[0]) return a.srm[0] - b.srm[0];
      if (a.srm[1] !== b.srm[1]) return a.srm[1] - b.srm[1];
      return cmpStyleId(a, b);
    });

    function rows(from, to) {
      var h = '<table class="table table--compact tbx-tb"><tbody>';
      for (var i = from; i < to; i++) {
        var s = list[i];
        h += '<tr><td>' + fmt(s.srm[0], 1) + '–' + fmt(s.srm[1], 1) + '</td>' +
          '<td style="text-align:left;color:var(--tx-3)">' + esc(s.id) + (s.rangeSource === 'local' ? '*' : '') + '</td>' +
          '<td style="text-align:left">' + esc(s.name) + '</td></tr>';
      }
      return h + '</tbody></table>';
    }
    var half = Math.ceil(list.length / 2);

    /* blp-noprint：这 90 行只在屏幕上给，不印。
       实测印出来是 3 页多（表高 296mm ×2），而纸上真正要对的是色卡本身；
       要查某个色度有哪些风格，点选那一格再打印，反查清单会跟着印。 */
    return '<div class="card mt-16 blp-noprint">' +
      '<div class="card__head"><h2>全部 ' + list.length + ' 条风格的色度窗口</h2>' +
        '<span class="spacer"></span><span class="u-xs u-dim">按 SRM 升序</span></div>' +
      '<div class="card__body"><div class="grid-2" style="gap:8px 18px;align-items:start">' +
        rows(0, half) + rows(half, list.length) +
      '</div></div>' +
      '<div class="card__hint">左列 SRM 区间，中间是风格编号。带 * 的四条（28A/29A/30A/33A）' +
        '官方口径是"随基酒而变"，区间由本库自定。</div>' +
      '</div>';
  }

  /* ------------------------------------------------- 13 碳化三联表（桶碳化）
   * 回答的是"桶放 4°C、目标 2.4 vol，表压打多少"——装瓶糖量那个工具回答不了
   * 这个问题（它是瓶内二次发酵的口径），两者不重复。
   *
   * 公式出处：ASBC 碳化表的二次回归式（AHA 的碳化图与多数家酿计算器用的
   * 都是这一条），温度代 °F、体积倍数代 vol，结果是**表压 psi**：
   *   psi = -16.6999 + 0.0101059·T + 0.00116512·T² + 0.173354·T·V
   *         + 4.24267·V - 0.0684226·V²
   * 它是对查表数据的拟合，不是理论式：0–24°C、1.6–3.2 vol 内与 ASBC 表
   * 相差 1–2 psi（冷端低温高档位偏差稍大，0°C/3.2 vol 约差 1.6 psi）。
   * 所以显示到 0.1 psi，但别当成 0.1 psi 的精度。 */
  function carbPsiAt(tempC, vol) {
    var T = num(tempC, 4) * 9 / 5 + 32;
    var V = num(vol, 2.4);
    return -16.6999
      + 0.0101059 * T + 0.00116512 * T * T
      + 0.173354 * T * V + 4.24267 * V - 0.0684226 * V * V;
  }

  TOOLS.push({
    id: 'carbtable',
    icon: 'beer',
    title: '碳化三联表',
    desc: '温度 × 目标 CO₂ 体积 → 表压 psi，附整张对照表与耗气量',
    build: function () {
      var r = UI.recipe();
      return '<style>' + SRM_PANEL_CSS + '\n' + PRINT_CSS + '</style>' +
        '<div class="blp-noprint">' +
          '<div class="grid-3">' +
            field('temp', '酒液温度', '4', '°C', { step: '0.5', hint: '碳化时桶里的实际温度' }) +
            field('vol', '目标 CO₂', '2.4', 'vol', { step: '0.1', hint: '英式 1.5–2.2 / 美式 2.2–2.8 / 小麦 3.3–4.5' }) +
            field('batch', '批次量', fmt(num(r.batchSize, 20), 1), 'L', { step: '0.5' }) +
          '</div>' +
          '<p class="u-xs u-dim" style="margin:8px 0 0">' +
            '表压 = 钢瓶减压表上读到的压力（gauge），不是绝压。自然碳化（set and forget）' +
            '就按这个压力放着，强制碳化（摇桶）会过冲，两者最终压力一样。</p>' +
        '</div>';
    },
    calc: function (api) {
      var t = num(n(api, 'temp', 4), 4);
      var v = num(n(api, 'vol', 2.4), 2.4);
      var L = Math.max(0.5, num(n(api, 'batch', 20), 20));
      var psi = carbPsiAt(t, v);
      var bar = psi * 0.0689476;
      /* 残余气：复用本文件里既有的 residualCO2（温度 → 常压饱和体积），
         不另造一张溶解度表 */
      var rest = residualCO2(20);
      var need = Math.max(0, v - rest);

      var rows = [
        { k: '表压（psi）', v: esc(fmt(psi, 1)) + ' psi', hero: true },
        { k: '折合 bar', v: esc(fmt(bar, 1)) + ' bar' },
        { k: '折合 kPa', v: esc(fmt(bar * 100, 0)) + ' kPa' },
        { k: '20°C 常压下的残余 CO₂', v: esc(fmt(rest, 2)) + ' vol', hint: '发酵结束后酒里本来就有的气' },
        { k: '需要额外压进去的 CO₂', v: esc(fmt(need, 2)) + ' vol' },
        { k: '理论耗气（' + fmt(L, 1) + ' L）', v: esc(fmt(need * 1.977 * L, 1)) + ' g' }
      ];

      var warn = '';
      if (v > 3.6) warn += warnBox('3.6 vol 以上普通玻璃瓶会爆，只能走桶装或不锈钢。', 'error');
      if (psi < 0) warn += warnBox('这个温度下目标体积低于饱和值，不需要加压——把酒降温或降低目标。', 'warn');
      if (psi > 30) warn += warnBox('30 psi 以上已经很猛，接管前先把压力卸到 10 psi 以内。', 'warn');

      var html = resultBox(rows,
        '公式是 ASBC 碳化表的二次回归（温度 °F、体积 vol），与 ASBC 表比通常差 1–2 psi——' +
        '它够用来设减压表，不够用来当标准值。理论耗气按 1 vol = 1 L CO₂/L 酒、' +
        'CO₂ 密度 1.977 g/L 算，<b>不含吹扫与管路残气的损耗</b>，所以实际用气一定比这个数多——' +
        '这里只给下限，不拿经验倍数去猜。') + warn;

      /* 整张表：行是温度 0–24°C（每 2°C），列是 1.6–3.2 vol（每 0.2） */
      var vols = [], temps = [], i, j;
      for (i = 16; i <= 32; i += 2) vols.push(i / 10);
      for (i = 0; i <= 24; i += 2) temps.push(i);

      /* 高亮"离你填的数最近"的那一格：不做阈值判断，
         否则填 2.5 vol 时整张表一格都不亮，看起来像没算 */
      var rowOn = 0, colOn = 0;
      for (i = 1; i < temps.length; i++) if (Math.abs(temps[i] - t) < Math.abs(temps[rowOn] - t)) rowOn = i;
      for (j = 1; j < vols.length; j++) if (Math.abs(vols[j] - v) < Math.abs(vols[colOn] - v)) colOn = j;

      var th = '<tr><th>°C</th>';
      for (j = 0; j < vols.length; j++) th += '<th' + (j === colOn ? ' style="color:var(--amber-soft)"' : '') + '>' + fmt(vols[j], 1) + '</th>';
      th += '</tr>';

      var tb = '';
      for (i = 0; i < temps.length; i++) {
        tb += '<tr><td' + (i === rowOn ? ' style="color:var(--amber-soft)"' : '') + '><b>' + temps[i] + '</b></td>';
        for (j = 0; j < vols.length; j++) {
          var p = carbPsiAt(temps[i], vols[j]);
          var on = (i === rowOn && j === colOn);
          tb += '<td' + (on ? ' style="background:var(--amber-tint-2);font-weight:700;box-shadow:inset 0 0 0 1px var(--amber)"' : '') + '>' +
            fmt(p, 1) + '</td>';
        }
        tb += '</tr>';
      }

      html += '<div class="card mt-16 blp-card"><div class="card__head"><h2>温度 × 体积 → 表压（psi）</h2>' +
          '<span class="spacer"></span><span class="u-xs u-dim">高亮 = 你填的档位附近</span></div>' +
        '<div class="card__body card__body--tight">' +
          '<div class="table-wrap"><table class="table table--compact tbx-tb"><thead>' + th + '</thead><tbody>' + tb + '</tbody></table></div>' +
        '</div>' +
        '<div class="card__hint">列头是碳化度（vol CO₂），行是酒温。' +
          '把这张表印出来贴进酒柜，比每次掏手机快。</div>' +
        '</div>';

      return html;
    },
    actions: function () {
      return [{ label: '打印这张表', kind: 'primary', act: function () { return printPanel(); } }];
    }
  });

  /* ------------------------------------------------------- 14 酒花替换换算
   * 回答"配方写 30 g Cascade，我手上只有 Citra，该放多少克"。
   * 公式：同一次投放、同等利用率的条件下 IBU ∝ α酸% × 质量，所以
   *   等价质量 = 原质量 × α原 / α替
   * 这是比例关系，不是经验系数。α 取 11-data-hop 的 aa（该库口径是
   * 两套参考表的交集区间中值），区间换算用 aaMin/aaMax 给上下限。
   * 必须说清的一点：它只保证**苦度当量**，不保证香气——所以下面同时给
   * 香型分组与更接近的替代品种（都从库里现算）。 */
  function hopById(id) {
    var list = (BREW.DB && BREW.DB.hops) || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  function hopSelectOptions(selected) {
    var list = ((BREW.DB && BREW.DB.hops) || []).slice();
    list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'); });
    var opts = [], i;
    for (i = 0; i < list.length; i++) {
      var h = list[i];
      opts.push({ v: h.id, t: h.name + ' ' + (h.en || '') + ' · α' + fmt(h.aa, 1) + '%' });
    }
    /* 选中的品种不在库里，补一条进去（否则下拉框会静默跳到第一项） */
    var found = false;
    for (i = 0; i < opts.length; i++) if (opts[i].v === selected) found = true;
    if (!found && selected) opts.unshift({ v: selected, t: selected });
    return opts;
  }

  TOOLS.push({
    id: 'hopswap',
    icon: 'arrow',
    title: '酒花替换换算',
    desc: 'α 酸等价换量：手上没有配方里那种酒花时，另一种该放多少克',
    build: function () {
      var r = UI.recipe();
      var from = 'h-cascade', to = 'h-citra', g = 30;
      /* 默认值取当前配方的第一支酒花，用户点开就是自己的场景 */
      var hops = (r && r.hops) || [];
      if (hops.length && hopById(hops[0].hopId)) from = hops[0].hopId;
      if (hops.length > 1 && hopById(hops[1].hopId)) to = hops[1].hopId;
      if (g && hops.length && num(hops[0].amount, 0) > 0) g = Math.round(num(hops[0].amount, 0) * 10) / 10;

      return '<div class="grid-3">' +
        selectField('from', '配方里的酒花', hopSelectOptions(from), from) +
        field('g', '配方用量', String(g), 'g', { step: '0.5', hint: '同一次投放（煮沸/回旋/干投）里的克数' }) +
        selectField('to', '我手上的酒花', hopSelectOptions(to), to) +
        '</div>';
    },
    calc: function (api) {
      var a = hopById(s(api, 'from')), b = hopById(s(api, 'to'));
      var g = num(n(api, 'g', 30), 30);
      if (!a || !b) return warnBox('没读到酒花数据，先确认酒花库已载入。', 'error');
      if (!(num(b.aa, 0) > 0) || !(num(a.aa, 0) > 0)) {
        return warnBox('这两种酒花的 α 酸数据不完整，没法做等价换算。', 'warn');
      }
      if (!(g > 0)) return warnBox('用量要大于 0。', 'error');

      var eq = g * num(a.aa, 0) / num(b.aa, 0);
      /* 区间：最坏情况是两个区间朝相反方向取端点 */
      var lo = g * num(a.aaMin, a.aa) / num(b.aaMax, b.aa);
      var hi = g * num(a.aaMax, a.aa) / num(b.aaMin, b.aa);

      var sameGrp = (a.grp && b.grp) ? (a.grp === b.grp) : null;
      var rows = [
        { k: '换成 ' + b.name + ' 需要', v: esc(fmt(eq, 1)) + ' g', hero: true },
        { k: 'α 酸区间推出来的范围', v: esc(fmt(lo, 1)) + ' – ' + esc(fmt(hi, 1)) + ' g',
          hint: '两端取最不利的 α 值，用来判断"差这么多能不能接受"' },
        { k: '原品种 α 酸', v: esc(fmt(num(a.aa, 0), 1)) + '%（' + esc(fmt(num(a.aaMin, 0), 1)) + '–' + esc(fmt(num(a.aaMax, 0), 1)) + '%）' },
        { k: '替代品种 α 酸', v: esc(fmt(num(b.aa, 0), 1)) + '%（' + esc(fmt(num(b.aaMin, 0), 1)) + '–' + esc(fmt(num(b.aaMax, 0), 1)) + '%）' },
        { k: '苦度当量', v: '相同（同煮沸时间、同条件下 IBU 不变）' },
        { k: '香型', v: esc((a.aroma || []).join('、') || '—') + ' → ' + esc((b.aroma || []).join('、') || '—') }
      ];

      var html = resultBox(rows,
        '依据是 IBU ∝ α酸% × 质量（同一次投放、利用率相同的条件下），所以质量与 α 酸成反比，' +
        '这是比例关系，不是经验系数。<b>它只能保证苦度当量，香气会变</b>：' +
        (sameGrp === true ? '这两种同属「' + esc(String(a.grp)) + '」香型，接得住。'
          : sameGrp === false ? '这两种香型不同族，苦度能对上，但香气方向会明显不同。'
            : '香型分组数据不全，下面请自己按香气描述判断。'));

      /* 更接近的替代：同香型、α 酸最接近的 3 个品种（从库里现算，不手写清单） */
      var list = (BREW.DB && BREW.DB.hops) || [], picks = [], i;
      for (i = 0; i < list.length; i++) {
        /* 排除"从"和"到"这两支本身：把卡斯卡特列成卡斯卡特的替代是废话 */
        if (list[i].id === b.id || list[i].id === a.id || !a.grp || list[i].grp !== a.grp) continue;
        picks.push(list[i]);
      }
      picks.sort(function (x, y) {
        return Math.abs(num(x.aa, 0) - num(a.aa, 0)) - Math.abs(num(y.aa, 0) - num(a.aa, 0));
      });
      if (picks.length) {
        var chips = '';
        for (i = 0; i < Math.min(4, picks.length); i++) {
          chips += '<button type="button" class="chip" data-pick="hop:' + attr(picks[i].id) + '">' +
            '<span>' + esc(picks[i].name) + ' α' + fmt(num(picks[i].aa, 0), 1) + '%</span></button>';
        }
        html += '<div class="card mt-12"><div class="card__head"><h2>与「' + esc(a.name) + '」同香型、α 酸最接近的品种</h2>' +
          '<span class="spacer"></span><span class="u-xs u-dim">点一下换成它</span></div>' +
          '<div class="card__body"><div class="row" style="gap:8px">' + chips + '</div>' +
          '<p class="u-xs u-dim mt-8" style="line-height:1.6">' + esc(a.name) + ' 自己的替代建议（库内记录）：' +
            esc(String(a.subs || '无')) + '</p></div></div>';
      }

      html += '<p class="u-xs u-dim mt-8" style="line-height:1.6">' +
        '不同年份、不同农场的同一品种 α 酸能差 ±30%，所以换算完请看上面那个区间，' +
        '别把 15.6 g 当成精确值；真正的口径永远是你手上那包酒花袋子上的 α 酸。</p>';
      return html;
    },
    onPick: function (val, hit, api) {
      var s2 = String(val);
      if (s2.indexOf('hop:') !== 0) return;
      var el = api.query('[data-in="to"]');
      if (el) el.value = s2.slice(4);
      this.render(api);
    },
    render: function (api) {
      var out = api.query('#tool-out');
      if (out) out.innerHTML = this.calc(api);
    }
  });

  /* -------------------------------------------------- 15 糖化温度 → 酒体
   * 回答"糖化定在 68°C，出来是干还是饱满"。
   *
   * 口径声明（很重要）：这一张是**定性对照**，不给数字。
   *   · 硬事实：β-淀粉酶最适 60–65°C、70°C 以上快速失活；α-淀粉酶最适
   *     72–75°C、80°C 以上失活；麦芽淀粉糊化约 60–65°C。出自糖化生化
   *     教科书（Kunze《Technology Brewing and Malting》糖化一章、
   *     Palmer《How to Brew》糖化温度一节，两者一致）。
   *   · "干 / 饱满"这类描述是教科书里的定性说法，**不是本软件算出来的**。
   *     所以这里不出现"68°C 会得到 1.014 FG"这种数——那取决于麦芽配比
   *     与酵母，光有温度算不出来。 */
  var MASH_BANDS = [
    { lo: 40, hi: 45, name: '酸休止 / 植酸休止', enz: '酶尚未启动',
      body: '不直接影响酒体', note: '降 pH、改善酶作用环境。现代改性麦芽通常不需要这一步。' },
    { lo: 45, hi: 55, name: '蛋白质休止', enz: '蛋白酶活跃',
      body: '影响小，主要影响泡沫与澄清', note: '小麦/燕麦/未发芽谷物比例高时有意义；时间过长会损失泡沫蛋白。' },
    { lo: 55, hi: 60, name: 'β 起步', enz: 'β 活跃 · α 刚启动',
      body: '偏干', note: '可发酵糖开始大量生成，收口会越来越干净。' },
    { lo: 60, hi: 65, name: 'β 最适', enz: 'β 最适 · α 活跃',
      body: '最干爽', note: '可发酵性最高的一档，适合赛松、干型世涛、美式淡爽这类要"收得干"的酒。' },
    { lo: 65, hi: 68, name: '双酶重叠', enz: 'β 收尾 · α 主导',
      body: '平衡', note: '多数艾尔的默认落点：既有骨架又不拖尾。' },
    { lo: 68, hi: 72, name: 'α 主导', enz: 'β 快速失活 · α 活跃',
      body: '饱满、甜感更明显', note: '英式艾尔、世涛、大麦酒这类要"挂口"的酒常用这一档；代价是收口偏甜。' },
    { lo: 72, hi: 75, name: 'α 最适', enz: 'α 最适 · β 基本失活',
      body: '很饱满', note: '残糖多、可发酵性低；糖化效率开始下降，比 65°C 更低。' },
    { lo: 75, hi: 80, name: '出糖 / 酶失活', enz: '酶快速失活（>78°C 基本停止）',
      body: '不再变化', note: '这是 mash-out 的温度，用来终止糖化、降低黏度，不是用来定酒体的。' }
  ];

  function mashBandAt(t) {
    for (var i = 0; i < MASH_BANDS.length; i++) {
      if (t >= MASH_BANDS[i].lo && t < MASH_BANDS[i].hi) return MASH_BANDS[i];
    }
    if (t < MASH_BANDS[0].lo) return null;
    return MASH_BANDS[MASH_BANDS.length - 1];
  }

  TOOLS.push({
    id: 'mashbody',
    icon: 'thermo',
    title: '糖化温度 → 酒体',
    desc: '62/65/68/70/72°C 各是什么酒体，并标出当前配方的休止温度',
    build: function () {
      var r = UI.recipe();
      var steps = ((r && r.mash && r.mash.steps) || []).slice();
      var main = 66;
      /* 取第一个落在糖化温度带的休止作为默认值（出糖 76°C 不算糖化） */
      for (var i = 0; i < steps.length; i++) {
        var t = num(steps[i].tempC, 0);
        if (t >= 40 && t < 75) { main = t; break; }
      }
      var stepTxt = '';
      for (var j = 0; j < steps.length; j++) {
        stepTxt += (j ? ' · ' : '') + esc(String(steps[j].name || '休止')) + ' ' +
          '<b class="u-mono">' + fmt(num(steps[j].tempC, 0), 0) + '°C</b>' +
          (num(steps[j].minutes, 0) > 0 ? '（' + fmt(num(steps[j].minutes, 0), 0) + ' 分钟）' : '');
      }

      return '<style>' + SRM_PANEL_CSS + '</style>' +
        '<div class="grid-2">' +
          field('t', '糖化温度', fmt(main, 0), '°C', { step: '0.5', hint: '淀粉休止的温度，不是出糖温度' }) +
          '<div class="field"><label class="field__label">当前配方的休止</label>' +
            '<div class="u-sm" style="line-height:1.6;padding-top:6px">' +
              (stepTxt || '<span class="u-dim">当前配方没有糖化步骤</span>') + '</div></div>' +
        '</div>';
    },
    calc: function (api) {
      var t = num(n(api, 't', 66), 66);
      var band = mashBandAt(t);
      var out = '';

      /* A. 结论 */
      if (!band) {
        out += warnBox('低于 40°C 不是糖化温度：淀粉酶在这个区间几乎不工作。', 'warn');
      } else {
        var beta = t >= 60 && t < 66 ? '最适' : (t >= 55 && t < 70 ? '活跃' : (t >= 70 ? '已失活' : '未启动'));
        var alpha = t >= 70 && t < 76 ? '最适' : (t >= 60 && t < 80 ? '活跃' : (t >= 80 ? '失活' : '未启动'));
        var rows = [
          { k: '落在', v: esc(fmt(band.lo, 0) + '–' + fmt(band.hi, 0) + '°C · ' + band.name), hero: true },
          { k: '酒体（定性）', v: esc(band.body), hero: true },
          { k: '酶的状态', v: esc(band.enz) },
          { k: 'β-淀粉酶（最适 60–65°C）', v: esc(beta) },
          { k: 'α-淀粉酶（最适 72–75°C）', v: esc(alpha) }
        ];
        out += resultBox(rows, esc(band.note));
      }

      /* B. 温度轴：8 段色带 + 当前指针
         配色是"冷=干、暖=饱满"：β 区偏蓝（可发酵糖多、收口干），α 区偏琥珀
         （残糖多、挂口）。两端的休止/失活段用中性灰——它们不决定酒体。
         只用 rgba，不引入裸 hex（裸 hex 只允许出现在 css/style.css 的变量区）。 */
      var bandTint = {
        '酸休止 / 植酸休止': 'rgba(0,0,0,.05)',
        '蛋白质休止': 'rgba(0,0,0,.05)',
        'β 起步': 'rgba(56,120,190,.12)',
        'β 最适': 'rgba(56,120,190,.24)',
        '双酶重叠': 'rgba(120,110,90,.16)',
        'α 主导': 'rgba(156,93,14,.18)',
        'α 最适': 'rgba(156,93,14,.30)',
        '出糖 / 酶失活': 'rgba(0,0,0,.06)'
      };
      var total = 80 - 40;
      var segs = '', i;
      for (i = 0; i < MASH_BANDS.length; i++) {
        var b2 = MASH_BANDS[i];
        var w = (b2.hi - b2.lo) / total * 100;
        var on = band === b2;
        segs += '<span class="tbx-axis__seg" style="flex:0 0 ' + fmt(w, 2) + '%;' +
          'background:' + (bandTint[b2.name] || 'rgba(0,0,0,.05)') + ';' +
          (on ? 'box-shadow:inset 0 -3px 0 var(--amber);' : '') +
          'border-right:1px solid var(--line)"></span>';
      }
      var left = Math.max(0, Math.min(100, (t - 40) / total * 100));
      /* 刻度按百分比绝对定位：用 justify-between 排的话 55°C 会跑到 33% 的位置上，
         和它在那条轴上的真实位置（37.5%）对不上——刻度最忌讳"看着像但其实不准" */
      var ticks = [40, 45, 55, 60, 65, 70, 75, 80], tickHtml = '';
      for (i = 0; i < ticks.length; i++) {
        tickHtml += '<span style="position:absolute;left:' + fmt((ticks[i] - 40) / total * 100, 2) + '%;' +
          'transform:translateX(-50%)">' + ticks[i] + '</span>';
      }
      out += '<div class="mt-16">' +
        '<div class="tbx-axis">' + segs +
          '<span class="tbx-axis__mark" style="left:' + fmt(left, 2) + '%"></span>' +
        '</div>' +
        '<div class="u-xs u-dim" style="position:relative;height:16px;margin-top:3px">' + tickHtml + '</div>' +
        '<p class="u-xs u-dim" style="margin:2px 0 0">' +
          '蓝色区 = β-淀粉酶工作带（可发酵糖多、收口干）· 琥珀区 = α-淀粉酶工作带（残糖多、挂口）· 灰区不决定酒体。</p>' +
        '</div>';

      /* C. 整张对照表 */
      var tr = '';
      for (i = 0; i < MASH_BANDS.length; i++) {
        var b3 = MASH_BANDS[i];
        var isOn = band === b3;
        tr += '<tr' + (isOn ? ' style="background:var(--amber-tint)' : '') + '>' +
          '<td class="u-mono" style="white-space:nowrap">' + b3.lo + '–' + b3.hi + '</td>' +
          '<td>' + esc(b3.name) + '</td>' +
          '<td>' + esc(b3.enz) + '</td>' +
          '<td>' + esc(b3.body) + '</td>' +
          '<td class="u-xs u-dim">' + esc(b3.note) + '</td></tr>';
      }
      out += '<div class="card mt-16"><div class="card__head"><h2>温度档位对照</h2>' +
        '<span class="spacer"></span><span class="u-xs u-dim">定性，不给数字</span></div>' +
        '<div class="card__body card__body--tight"><div class="table-wrap">' +
        '<table class="table table--compact"><thead><tr>' +
        '<th>温度带</th><th>叫法</th><th>酶</th><th>酒体</th><th>说明</th>' +
        '</tr></thead><tbody>' + tr + '</tbody></table></div></div></div>';

      /* D. 风险提示 */
      if (t < 60) {
        out += warnBox('60°C 以下淀粉糊化不充分（麦芽淀粉糊化约 60–65°C），糖化效率会明显偏低，' +
          '而且蛋白分解过头会伤泡沫。这个温度只适合做蛋白休止，不适合当糖化主休止。', 'warn');
      } else if (t >= 76) {
        out += warnBox('76°C 以上酶基本停止工作：这一档是出糖（mash-out），不是糖化。' +
          '如果主休止也放在这里，糖化会停在很低的转化率上。', 'warn');
      } else if (t >= 72) {
        out += warnBox('72°C 以上可发酵性很低，残糖多、收口甜；同时糖化效率会掉，' +
          '同样的麦量算出来的 OG 会偏低。', 'warn');
      }

      /* E. 口径 */
      out += '<p class="u-xs u-dim mt-12" style="line-height:1.7">' +
        '这张表是**定性对照**，不是模型。可靠的只有三件事：β-淀粉酶最适 60–65°C、70°C 以上快速失活；' +
        'α-淀粉酶最适 72–75°C、80°C 以上失活；麦芽淀粉糊化约 60–65°C。' +
        '「干 / 饱满」是教科书里的定性说法（Kunze 糖化一章、Palmer《How to Brew》糖化温度一节）。' +
        '本软件不给"用 68°C 就能得到 1.014 FG"这种数字——那取决于麦芽配比与酵母，光有温度算不出来。</p>';

      return out;
    }
  });

  /* ------------------------------------------------- 17 公式编辑器（v1.7） */
  /* 这一个不是计算器，是"把计算摊开给你看"。所以它没有输入框：
     build() 给三条用途，calc() 给一个入口按钮，点开走 Formula.UI。
     为什么仍然放进 TOOLS：工具集视图的卡片网格与设置页的清单都从 TOOLS 生成，
     单开一份清单会漂移（这个项目已经为此吃过一次亏）。 */
  TOOLS.push({
    id: 'formula',
    icon: 'beaker',
    title: '公式编辑器',
    desc: '每个指标怎么算出来的摊开看，可调常量、存自己的版本、用 BF1. 码分享',
    build: function () {
      /* 报数必须**现取**，不能写死。
         这张卡的结果区（calc）用的是 out.length，文案一旦写死，就会出现
         "上半句 45、下面结果表里 44"——同一屏两个数，用户自己能数出来。
         写死 44 只对到下一次往 REGISTRY 加条目为止，而 v1.8 的三条缺口里
         至少两条会动条目结构（whirlpool_temp 列、多 Σ 逐行表）。
         取不到时不报数（改成中性写法），**绝不留一个可能过时的具体数字**：
         宁可不说数，不可说错数。 */
      var nReg = (BREW.Formula && BREW.Formula.REGISTRY) ? BREW.Formula.REGISTRY.length : 0;
      var cntTxt = nReg > 0 ? (esc(String(nReg)) + ' 个量，每条都给') : '每个量都给';
      return '<p class="u-sm u-muted" style="line-height:1.7;margin:0 0 12px">' +
          '「苦度 34.2 IBU」不是天上掉下来的：它由 α 酸、克数、等效煮沸时长、煮沸比重、' +
          '批次量五个数算出来。公式编辑器把它们一位一位摊开，你可以照着按计算器复核。' +
        '</p>' +
        '<div class="tool-grid">' +
          '<div class="card"><div class="card__body">' +
            '<b class="u-sm">① 看得见</b>' +
            '<p class="u-xs u-dim mt-8" style="line-height:1.65">' + cntTxt + '代入串、' +
            '参数表（名称 / 符号 / 单位 / 当前值）、文献出处，以及"什么情况下会偏"。</p>' +
          '</div></div>' +
          '<div class="card"><div class="card__body">' +
            '<b class="u-sm">② 改得动</b>' +
            '<p class="u-xs u-dim mt-8" style="line-height:1.65">30 个数值系数可以改，' +
            '改完立刻显示它影响最大的三个量（"改这个：IBU 34.2 → 37.6"）。</p>' +
          '</div></div>' +
          '<div class="card"><div class="card__body">' +
            '<b class="u-sm">③ 存得下 / 传得出</b>' +
            '<p class="u-xs u-dim mt-8" style="line-height:1.65">常量配置可以存成自己的版本，' +
            '也能生成 BF1. 开头的分享码发给别人。</p>' +
          '</div></div>' +
        '</div>' +
        '<p class="u-xs u-dim mt-12" style="line-height:1.7">' +
          '两条硬规矩：<b>内核值不会被替换</b>——面板里永远是"内核值 / 你的公式值"两列并排，' +
          '你改出来的偏差看得见；<b>分享码不会自动生效</b>——导入前先列出它要改什么，' +
          '你确认了才应用。' +
        '</p>';
    },
    calc: function () {
      var r = UI.recipe();
      var n = 0, changed = 0;
      try {
        if (BREW.Formula && BREW.Formula.evaluate) {
          var out = BREW.Formula.evaluate(r, {
            consts: (BREW.Formula.OVERRIDES && BREW.Formula.OVERRIDES.consts) ?
              BREW.Formula.OVERRIDES.consts() : {}
          });
          n = out.length;
          for (var i = 0; i < out.length; i++) if (out[i].edited) changed++;
        }
      } catch (e) { n = 0; }

      var rows = [
        { k: '当前配方', v: esc(r.name || '未命名') },
        { k: '可查公式', v: esc(String(n)) + ' 条' },
        { k: '被你的常量改过的', v: changed ? esc(String(changed)) + ' 条' : '0 条（与内核一致）' }
      ];
      return resultBox(rows,
        '点下面的按钮打开编辑器。面板里的"内核值"永远来自计算内核，' +
        '你自己的常量只影响"你的公式值"那一列——两者不一致时会有红色徽章。') +
        '<div class="mt-12">' +
          '<button type="button" class="btn btn-primary" data-pick="open">' +
            icon('beaker', 14) + '打开公式编辑器</button>' +
        '</div>';
    },
    onPick: function (key, el, api) {
      if (key !== 'open') return;
      if (!BREW.Formula || !BREW.Formula.UI || typeof BREW.Formula.UI.open !== 'function') {
        UI.Shell.toast('公式模块还没加载（43a-formulas.js）', 'warn', 3600);
        return;
      }
      api.close();
      BREW.Formula.UI.open();
    }
  });

  /* ======================================================================
   * 打开工具模态框
   * ====================================================================*/

  function openTool(tool) {
    /* 工具自带动作（打印）排在最前，"关闭"永远在最后一位：
       按钮顺序是"做事 → 走人"，和确认框的规矩一致。 */
    var acts = [];
    if (typeof tool.actions === 'function') acts = acts.concat(tool.actions());
    acts.push({ label: '关闭', kind: 'ghost' });

    var api = UI.Shell.modal({
      title: tool.title,
      sub: tool.desc,
      size: 'wide',
      body: (tool.build ? tool.build() : '') +
        (tool.id === 'units' ? '' : '<div class="mt-16" id="tool-out"></div>'),
      actions: acts,
      onMount: function (a) {
        function run() {
          try {
            if (tool.render) {
              tool.render.call(tool, a);
            } else {
              var out = a.query('#tool-out');
              if (out) out.innerHTML = tool.calc(a);
            }
          } catch (e) {
            var out2 = a.query('#tool-out');
            if (out2) out2.innerHTML = warnBox('计算出错：' + ((e && e.message) || '未知错误'), 'error');
          }
        }
        a.body.addEventListener('input', run);
        a.body.addEventListener('change', run);
        /* 结果区里的可点条目（v1.4：「我的水能酿什么酒」里的风格跳转）。
           只有声明了 onPick 的工具才绑，其它 10 个工具的行为一个字都不变——
           给所有工具都挂一个全局 click 监听，等于给每个工具加一条它不需要的路径。 */
        if (typeof tool.onPick === 'function') {
          a.body.addEventListener('click', function (e) {
            var node = e.target, hit = null;
            while (node && node !== a.body && node.nodeType === 1) {
              if (node.getAttribute && node.getAttribute('data-pick') !== null) { hit = node; break; }
              node = node.parentNode;
            }
            if (!hit) return;
            try { tool.onPick(String(hit.getAttribute('data-pick')), hit, a); }
            catch (err) { UI.Shell.toast('跳转失败：' + ((err && err.message) || '未知错误'), 'warn', 3200); }
          });
        }
        run();
      }
    });
    return api;
  }

  /* ======================================================================
   * 工具台（v1.6）：给设置页一个"直达入口"
   * ----------------------------------------------------------------------
   * 与「工具集」视图的分工（两者互补，不是替代）：
   *   · 工具集视图 = 卡片网格，适合"看看有什么"；
   *   · 工具台     = 一行一个按钮，适合"我知道我要哪个，别让我找"。
   * 两者共用同一份 TOOLS —— 不建第二份清单，清单分家迟早漂移
   * （这个项目已经因为"同一件事两处实现"出过色标恒为同一棕色的 bug）。
   *
   * TOOL_ASK 是每个工具"回答什么问题"的一句话。工具台显示它、而不是 desc：
   *   desc 说的是"算什么"，ASK 说的是"什么时候该点它"。
   * 缺 ASK 回落成 desc，不会出现空白行；探针会检查 15 条都不为空。
   * ====================================================================*/
  var TOOL_ASK = {
    /* --- v1.6 新增 --- */
    srmcard: '我的酒倒进杯里是什么颜色？这个色度上通常有哪些风格？',
    carbtable: '桶放在 4°C，要打到几 psi 才正好 2.4 个体积的 CO₂？',
    hopswap: '配方写 30 g Cascade，我手上只有 Citra，该放多少克？',
    mashbody: '糖化定在 68°C，出来是干爽还是饱满？',
    /* --- v1.0–v1.5 --- */
    gravity: '比重计 / 折射仪的读数，换算成糖度到底是多少？',
    dilution: '这锅糖度高了，兑多少水？或者煮多久能到目标？',
    carbonation: '装瓶要加多少糖，才不会爆瓶？',
    pitch: '这锅要投几包酵母？不够的话怎么扩培？',
    water: '想让水的离子到位，石膏、氯化钙各加几克？',
    units: '这份美制配方里的 lb / gal / °F 换成公制是多少？',
    abv: '这杯酒多少度？折合几个标准杯？',
    starter: '一包酵母够不够？不够要分几步扩培到多少升？',
    perceived: '配方写 60 IBU，喝起来真的有那么苦吗？',
    watermatch: '我这份水质报告，最像哪座历史名城的水？',
    waterreverse: '我这边的水，适合酿哪些风格？',
    /* --- v1.7 --- */
    formula: '这个 IBU 是怎么算出来的？我想把它调成我设备实际的苦度'
  };

  /* 工具台顺序：新增四件在前，其余按工具集里的原顺序。
     不在这个数组里的工具会自动追加到末尾 —— 以后加工具不会从工具台里漏掉。 */
  var TOOLBOX_ORDER = [
    'srmcard', 'carbtable', 'hopswap', 'mashbody',
    'gravity', 'dilution', 'carbonation', 'pitch', 'water', 'units',
    'abv', 'starter', 'perceived', 'watermatch', 'waterreverse',
    /* v1.7：公式编辑器不是"算一个数"，放在最后 ——
       工具台前 15 行是"我现在手上缺个数"，它是"我想知道那个数哪来的"，
       两种意图不该混排。 */
    'formula'
  ];
  var NEW_TOOL_IDS = ['srmcard', 'carbtable', 'hopswap', 'mashbody', 'formula'];

  function toolById(id) {
    for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].id === id) return TOOLS[i];
    return null;
  }

  function askOf(t) {
    return TOOL_ASK[t.id] || t.desc || '';
  }

  BREW.UI.Toolbox = {
    /** 给设置页渲染用的清单（只有纯数据，DOM 由 58 自己拼） */
    list: function () {
      var out = [], seen = {}, i, t;
      for (i = 0; i < TOOLBOX_ORDER.length; i++) {
        t = toolById(TOOLBOX_ORDER[i]);
        if (!t) continue;
        seen[t.id] = 1;
        out.push({
          id: t.id, title: t.title, ask: askOf(t), icon: t.icon,
          isNew: NEW_TOOL_IDS.indexOf(t.id) >= 0
        });
      }
      for (i = 0; i < TOOLS.length; i++) {
        if (seen[TOOLS[i].id]) continue;
        out.push({ id: TOOLS[i].id, title: TOOLS[i].title, ask: askOf(TOOLS[i]), icon: TOOLS[i].icon, isNew: false });
      }
      return out;
    },
    /** 按 id 直接打开（设置页每一行按钮走这里）；找不到返回 null 而不是抛错 */
    open: function (id) {
      var t = toolById(String(id || ''));
      if (!t) { UI.Shell.toast('没有这个工具：' + id, 'warn', 3000); return null; }
      return openTool(t);
    },
    count: function () { return TOOLS.length; }
  };

  /* ======================================================================
   * 视图
   * ====================================================================*/

  function render(el) {
    var cards = '';
    for (var i = 0; i < TOOLS.length; i++) {
      var t = TOOLS[i];
      cards += '<button type="button" class="tool-card" data-tool="' + attr(t.id) + '">' +
        '<span class="tool-card__icon">' + icon(t.icon, 16) + '</span>' +
        '<h3>' + esc(t.title) + '</h3>' +
        '<p>' + esc(t.desc) + '</p>' +
        '</button>';
    }

    var r = UI.recipe();
    el.innerHTML =
      '<div class="section-title">' +
        '<h2>工具集</h2>' +
        /* 数量改成现算：原来写死"十一个"，v1.6 加了四件之后就会说谎 */
        '<p>' + TOOLS.length + ' 个现场计算器，输入即出结果（设置页也有同一份清单的直达入口）</p>' +
      '</div>' +
      '<div class="tool-grid">' + cards + '</div>' +
      '<div class="card mt-16">' +
        '<div class="card__head"><h2>当前配方快捷入口</h2></div>' +
        '<div class="card__body">' +
          '<div class="row">' +
            '<span class="u-sm u-muted">以《' + esc(r.name) + '》为默认值：</span>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-tool="carbonation">算碳化糖量</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-tool="pitch">算酵母接种量</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-tool="water">算糖化水盐</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-tool="dilution">算稀释用水</button>' +
          '</div>' +
        '</div>' +
        '<div class="card__hint">' +
          '所有换算都在浏览器本地完成，不联网、不上传配方。公式口径写在每个工具的注释里，' +
          '若与厂商 COA 或你设备的实测值冲突，以你的实测为准。' +
        '</div>' +
      '</div>';

    if (!el.__toolsBound) {
      el.__toolsBound = true;
      el.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-tool]') : null;
        if (!btn) return;
        var id = btn.getAttribute('data-tool');
        for (var i = 0; i < TOOLS.length; i++) {
          if (TOOLS[i].id === id) { openTool(TOOLS[i]); return; }
        }
      });
    }
  }

  BREW.UI.ToolsView = {
    id: 'tools',
    label: '工具集',
    icon: 'tools',
    group: '工具',
    order: 4,
    render: render
  };

})(typeof window !== 'undefined' ? window : globalThis);
