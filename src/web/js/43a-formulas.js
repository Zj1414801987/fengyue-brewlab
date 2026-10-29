/* ============================================================================
 * 风月酿研所 — 43a 公式模块（Formula）
 * ----------------------------------------------------------------------------
 * 职责：把「界面上的每个数字是怎么算出来的」变成看得见、可以调、可以分享的东西。
 *   ① REGISTRY  只读公式层：每个量一条，带表达式、参数、常量、出处、适用边界
 *   ② CONSTANTS 可调常量：公式里的数值系数抽出来，允许用户改
 *   ③ OVERRIDES 用户版本：常量覆盖存档（复用 BREW.Store 的持久化）
 *   ④ 安全求值器：tokenizer + 调度场（shunting-yard）→ RPN → 求值，**不用 eval**
 *   ⑤ 分享码：BF1.<crc16>.<base64url(JSON)>，与配方的 BL1. 并行
 *   ⑥ UI：三页签模态（公式一览 / 常量 / 我的版本）
 *
 * ============================================================================
 * 这个模块存在的**唯一前提**（先写在这里，改代码前先读这一段）
 * ----------------------------------------------------------------------------
 * js/20-calc.js 是全站唯一的计算真值源。项目已经因为"同一件事两处实现"
 * 翻过两次车（SRM↔EBC 各写一份、40-ui-shell 的 fallbackCalc 成了第二套引擎）。
 * 所以本模块**不是**第二套引擎，而是一份"对内核行为的可读描述"：
 *
 *   铁律：不覆盖任何常量时，REGISTRY 里每一条算出来的数，
 *        必须与 BREW.Calc 的同名结果一致（精确比 1e-9，或按内核的舍入位比）。
 *        两者出现分歧时以**内核**为准，并让断言炸掉（tools/test-formula.js）。
 *
 * 为了让这条铁律真的能成立，表达式必须与内核**同构**，包括那些看起来像
 * 笔误的地方。已知的四处"必须跟着内核走"的细节，都单独写了注释：
 *   ① 煮沸比重点数用的是**舍到 0.01 的**煮沸前体积（volumeBalance 返回值），
 *      不是未舍入的内部值 —— 见 boil_points
 *   ② 终比重点数用的是**舍到 0.01 的**总点数与可发酵点数（gravity 返回值）——
 *      见 fg_points（不套这一层会差 8e-5 个比重点，断言当场抓到）
 *   ③ 真实衰减 RDF 用的是**舍到 0.1 的**酵母标称 ADF（attenuation 返回值），
 *      而 FG 用的是未舍入的那一个 —— 见 rdf / fg_points
 *   ④ BU:GU 的分子是**舍到 0.1 的** IBU（balance() 收到的是 ibu.value）
 *
 * 另一个实测到的坑：**等效煮沸时长不能按 hop.id 缓存**。同一种酒花可以出现
 * 在两行（回旋 20 min 与干投 0 min），id 相同而等效时长不同。按 id 缓存会让
 * 干投那 60 g 拿到回旋的 7 min，凭空多算 23.2 IBU —— 在"西海岸 IPA"预设上
 * 一条就差了三分之一。自造的三条配方永远测不出来（它们不会让同一种酒花
 * 出现两次），所以 tools/test-formula.js 里有一段"全库扫一遍"：115 条配方 ×
 * 43 个量 = 4942 个比对点。
 *
 * ============================================================================
 * 为什么不复用配方的 BL1. 分享码（这是本模块最重要的架构决定）
 * ----------------------------------------------------------------------------
 * BL1 的载荷里**没有类型字段**：`{v:1, n:…, f:…}`，老客户端拿到什么都会当
 * 配方解析（28 的 expand() 只看 v）。把一份公式的常量塞进 BL1 发给用旧版的
 * 人，旧版会把它解成一条"空配方"，然后写进配方库 —— 用户的配方被静默覆盖，
 * 而且没有任何报错。
 *
 * 所以公式码**换前缀**：BF1.（B=BrewLab，F=Formula，1=格式版本）。
 * 结构完全同构：`BF1.<crc16 4 位十六进制>.<base64url(payload)>`。
 * 老版本看到 BF1. 会直接报"不是分享码"（28 的正则 `^BL\d` 不匹配），
 * 失败方式是**安全的**：什么都不写。
 * 反过来，新版把 BL1. 喂给 Formula.parseShare() 会明确回一句
 * "这是配方分享码，不是公式分享码"——两边的失败都能说人话。
 *
 * 编码原语（utf8 / base64url / CRC-16-CCITT-FALSE）**优先用 28 导出的那一份**
 * `BREW.ShareCode.primitives`，拿不到才回落到本文件里的兜底实现（见 §8 的
 * 「取用层」）。留兜底是因为 43a 必须能在 28 缺席时工作（只验计算链的 node
 * 套件、单文件引用、任何一份 js 加载失败），但**两份不许悄悄漂移**：
 * tools/test-formula.js 用一组向量（'123456789' → 0x29B1 / 空串 / 含中文与
 * 代理对的多字节串）对两条路径逐项对账，并且断言 28 的导出确实存在。
 *
 * ============================================================================
 * 纯度（时间、随机、DOM）
 * ----------------------------------------------------------------------------
 * 核心（REGISTRY / CONSTANTS / evaluate / 求值器 / 分享码）只吃入参、只吐返回值：
 *   · 不读 DOM、不读 Store（OVERRIDES 是显式的一层，可不用）
 *   · **不取当前时间**。createdAt 由调用方通过 opts.now 传入 —— 与 26-calc-starter
 *     同一条规矩，为了测试可复现。只有 UI 层的一处会读时钟（取一个给人看的
 *     交付时间），核心不碰。
 *
 * 依赖：00-core（Util / Store）、05-units（仅读 sgToPlato 的算式出处，不调用）、
 *      20-calc（**只作为真值源**，本模块从不修改它）
 * 加载位置：43 之前、42 之后（index.html 已排好）
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var Formula = BREW.Formula = BREW.Formula || {};

  /* ==========================================================================
   * §0 小工具
   * ======================================================================*/

  var MAX_EXPR = 500;      /* 单条表达式字符上限 */
  var MAX_DEPTH = 32;      /* 括号 / 求值栈深度上限 */

  function toNum(v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (d === undefined ? 0 : d);
  }
  function rnd(v, d) {
    var p = Math.pow(10, d || 0);
    return Math.round(v * p) / p;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function ferr(msg, code) {
    var e = new Error(msg);
    e.code = code || 'expr';
    e.formula = true;
    return e;
  }

  /** 数 → 展示串。disp 决定有效位：比重 3 位、百分比 1 位、IBU 1 位、体积 1–2 位 */
  function show(v, disp) {
    if (!isNum(v)) return '—';
    var neg = v < 0 ? '−' : '';
    var a = Math.abs(v), s;
    switch (disp) {
      case 'sg':   s = a.toFixed(3); break;
      case 'pct':  s = a.toFixed(1); break;
      case 'ibu':  s = a.toFixed(1); break;
      case 'vol':  s = a < 10 ? a.toFixed(2) : a.toFixed(1); break;
      case 'int':  s = a.toFixed(0); break;
      case 'pts':  s = a.toFixed(2); break;
      default:
        /* num：小数量要看得见有效位（0.000125 不能被印成 0.0001，那会让用户
           照着自己的界面按计算器却算不出同一个数）。大的整数不要拖一串零。 */
        if (a >= 100) s = a.toFixed(2);
        else if (a >= 1) s = a.toFixed(4);
        else if (a >= 0.01) s = a.toFixed(4);
        else s = a.toFixed(6);
        if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
        break;
    }
    return neg + s;
  }

  /* ==========================================================================
   * §1 NAMES —— 全模块唯一的"名字表"
   * ----------------------------------------------------------------------
   * 为什么要有它：用户的原话是"参数名称全篇要一致，不能前后不一样"。
   * 项目刚做过一轮全库命名统一，所以这里的每个中文名都不是我发明的，而是
   * 从现有界面里抄下来的（出处写在每组注释里）。所有显示名只能从这张表取，
   * 断言：① 同一个 key 只有一条（结构上保证）；② 不同 key 不许共用一个中文名
   * （那会让参数表里出现两个一模一样的名字）。
   *
   * 出处对照：
   *   批次量 / 糖化效率 / 蒸发率 / 煮沸时长 / 碳化度 / 沉渣损失   → 42-ui-recipe 基础参数区
   *   水料比 / 发酵温度                                        → 42-ui-recipe 糖化方案卡
   *   发酵罐残液                                               → 42-ui-recipe 体积推导说明
   *   初始比重 OG / 终比重 FG / 酒精度 ABV / 苦度 IBU / 色度 SRM → 42-ui-recipe 实时指标
   *   苦甜比（BU:GU） / 残留碱度 / SO₄/Cl                      → 42-ui-recipe 指标与水质行
   *   表观衰减（实测）                                         → 42-ui-recipe（v1.5 修正过的标注）
   *   麦糟吸水 / 酒花吸水                                      → 42-ui-recipe 体积推导说明
   *
   * 一个刻意的取舍：**不叫"出糖率"**。出糖率是 ppg（每磅每加仑多少点），
   * 是原料属性；用户能调的 % 是"糖化效率"。混用就是事实错误。
   * ======================================================================*/

  var NAMES = {
    /* ---- 配方字段（= 用户能改的输入） ---- */
    batch:           { name: '批次量',            unit: 'L',              disp: 'num' },
    eff_pct:         { name: '糖化效率',          unit: '%',              disp: 'pct' },
    evap_rate:       { name: '蒸发率',            unit: '%/h',            disp: 'num' },
    boil_min:        { name: '煮沸时长',          unit: 'min',            disp: 'num' },
    trub:            { name: '沉渣损失',          unit: 'L',              disp: 'vol' },
    floss:           { name: '发酵罐残液',        unit: 'L',              disp: 'vol' },
    grain_abs_rate:  { name: '麦糟吸水率',        unit: 'L/kg',           disp: 'num' },
    hop_abs_rate:    { name: '酒花吸水率',        unit: 'L/kg',           disp: 'num' },
    thickness:       { name: '水料比',            unit: 'L/kg',           disp: 'num' },
    carb_target:     { name: '碳化度',            unit: 'vol',            disp: 'num' },
    carb_temp:       { name: '碳化温度',          unit: '°C',             disp: 'num' },
    yeast_att:       { name: '酵母标称衰减度',    unit: '%',              disp: 'pct' },
    pitch_rate:      { name: '推荐接种率',        unit: 'M cells/mL/°P',  disp: 'num' },

    /* ---- 水化学末端值（含盐类贡献，来自内核水的计算结果） ---- */
    alk:  { name: '总碱度（以 CaCO₃ 计）', unit: 'mg/L', disp: 'num' },
    ca:   { name: '钙离子 Ca²⁺',          unit: 'mg/L', disp: 'num' },
    mg:   { name: '镁离子 Mg²⁺',          unit: 'mg/L', disp: 'num' },
    so4:  { name: '硫酸盐 SO₄²⁻',         unit: 'mg/L', disp: 'num' },
    cl:   { name: '氯化物 Cl⁻',           unit: 'mg/L', disp: 'num' },

    /* ---- 逐行参数（原料行的字段） ---- */
    kg:            { name: '麦芽用量',        unit: 'kg',  disp: 'num' },
    ppg:           { name: '出糖率',          unit: 'ppg', disp: 'num' },
    lov:           { name: '色度',            unit: '°L',  disp: 'num' },
    h_g:           { name: '酒花用量',        unit: 'g',   disp: 'num' },
    aa:            { name: 'α 酸',            unit: '%',   disp: 'num' },
    emin:          { name: '等效煮沸时长',    unit: 'min', disp: 'num' },
    adj_g:         { name: '辅料用量',        unit: 'g',   disp: 'num' },
    sugar_pct:     { name: '含糖率',          unit: '%',   disp: 'pct' },
    row_eff:       { name: '该行糖化效率',    unit: '—',   disp: 'num' },
    row_ff:        { name: '该行可发酵比例',  unit: '—',   disp: 'num' },

    /* ---- 中间派生量 ---- */
    avg_ppg:    { name: '加权平均出糖率',      unit: 'ppg', disp: 'num' },
    target_pts: { name: '目标糖化点数',        unit: 'pts', disp: 'pts' },

    /* ---- 汇总行（逐行求值后相加） ---- */
    A_grain:    { name: '糖化麦量合计',        unit: 'kg',  disp: 'num' },
    A_hopkg:    { name: '酒花总量合计',        unit: 'kg',  disp: 'num' },
    A_fpts:     { name: '麦芽糖化点数合计',    unit: 'pts', disp: 'num' },
    A_ffpts:    { name: '可发酵点数合计',      unit: 'pts', disp: 'num' },
    A_apts:     { name: '辅料糖点数合计',      unit: 'pts', disp: 'num' },
    A_mcu:      { name: '麦芽色度负荷合计',    unit: 'MCU', disp: 'num' },
    A_ibu:      { name: '苦度合计',            unit: 'IBU', disp: 'num' },
    A_mashpts:  { name: '糖化麦点数合计',      unit: 'pts', disp: 'num' },
    A_mashw:    { name: '糖化麦重量合计',      unit: 'kg',  disp: 'num' },
    A_mashext:  { name: '糖化麦出糖总量合计',  unit: 'ppg·kg', disp: 'num' },

    /* ---- 结果量（REGISTRY 每一条自己的名字；与现有界面的叫法对齐） ---- */
    grain_kg:        { name: '糖化麦量',            unit: 'kg',       disp: 'num' },
    grain_absorb:    { name: '麦糟吸水量',          unit: 'L',        disp: 'vol' },
    hop_absorb:      { name: '酒花吸水量',          unit: 'L',        disp: 'vol' },
    post_boil:       { name: '进发酵罐体积',        unit: 'L',        disp: 'vol' },
    post_chill:      { name: '冷却后体积',          unit: 'L',        disp: 'vol' },
    evap_frac:       { name: '蒸发比例',            unit: '—',        disp: 'num' },
    pre_boil:        { name: '煮沸前体积',          unit: 'L',        disp: 'vol' },
    evaporation:     { name: '蒸发量',              unit: 'L',        disp: 'vol' },
    mash_water:      { name: '糖化用水量',          unit: 'L',        disp: 'vol' },
    first_runnings:  { name: '首次麦汁量',          unit: 'L',        disp: 'vol' },
    sparge_water:    { name: '洗糟水量',            unit: 'L',        disp: 'vol' },
    total_water:     { name: '总用水量',            unit: 'L',        disp: 'vol' },

    og_points:       { name: '糖化点数',            unit: 'pts',      disp: 'num' },
    og:              { name: '初始比重 OG',         unit: 'SG',       disp: 'sg' },
    og_plato:        { name: '初始柏拉图度',        unit: '°P',       disp: 'num' },
    boil_points:     { name: '煮沸比重点数',        unit: 'pts',      disp: 'num' },
    boil_gravity:    { name: '煮沸比重',            unit: 'SG',       disp: 'sg' },
    ferm_pts:        { name: '可发酵点数',          unit: 'pts',      disp: 'num' },
    fg_points:       { name: '终比重点数',          unit: 'pts',      disp: 'num' },
    fg:              { name: '终比重 FG',           unit: 'SG',       disp: 'sg' },
    fg_plato:        { name: '终点柏拉图度',        unit: '°P',       disp: 'num' },

    adf:             { name: '酵母标称 ADF',        unit: '%',        disp: 'pct' },
    aa_actual:       { name: '表观衰减（实测）',    unit: '%',        disp: 'pct' },
    rdf:             { name: '真实衰减 RDF',        unit: '%',        disp: 'pct' },
    abv_hall:        { name: '酒精度（Hall 式）',   unit: '%vol',     disp: 'num' },
    abv_simple:      { name: '酒精度（简式）',      unit: '%vol',     disp: 'num' },

    ibu:             { name: '苦度 IBU',            unit: 'IBU',      disp: 'ibu' },
    gu:              { name: '原麦汁浓度 GU',       unit: 'GU',       disp: 'int' },
    bu_gu:           { name: '苦甜比（BU:GU）',     unit: '—',        disp: 'num' },

    mcu:             { name: '色度负荷 MCU',        unit: 'MCU',      disp: 'num' },
    srm:             { name: '色度 SRM',            unit: 'SRM',      disp: 'num' },
    ebc:             { name: '色度 EBC',            unit: 'EBC',      disp: 'num' },

    ra:              { name: '残留碱度 RA',         unit: 'ppm',      disp: 'num' },
    so4cl:           { name: 'SO₄/Cl',              unit: '—',        disp: 'num' },

    pitch_cells:     { name: '接种量',              unit: '十亿细胞', disp: 'int' },
    pitch_dry_g:     { name: '干酵母用量',          unit: 'g',        disp: 'num' },

    carb_residual:   { name: '残余 CO₂',            unit: 'vol',      disp: 'num' },
    carb_needed:     { name: '需补 CO₂',            unit: 'vol',      disp: 'num' },
    carb_sucrose:    { name: '蔗糖用量',            unit: 'g',        disp: 'num' },
    carb_dextrose:   { name: '一水葡萄糖用量',      unit: 'g',        disp: 'num' },
    carb_dme:        { name: 'DME 用量',            unit: 'g',        disp: 'num' },
    carb_honey:      { name: '蜂蜜用量',            unit: 'g',        disp: 'num' },

    malt_need:       { name: '麦量反算',            unit: 'kg',       disp: 'num' },
    boil_intensity:  { name: '煮沸强度',            unit: '%/h',      disp: 'num' }
  };

  /* 名字冲突检查：不同 key 共用一个中文名 → 参数表里会出现两个同名项，用户没法分辨。
     这是模块初始化时跑一次的静态检查，结果挂到 Formula.__nameClash 供测试读取。 */
  Formula.__nameClash = (function () {
    var seen = {}, clash = [], k;
    for (k in NAMES) {
      if (!Object.prototype.hasOwnProperty.call(NAMES, k)) continue;
      var n = NAMES[k].name;
      if (seen[n]) clash.push(seen[n] + ' / ' + k + ' 都叫「' + n + '」');
      else seen[n] = k;
      if (!NAMES[k].unit && NAMES[k].unit !== '') clash.push(k + ' 没有单位');
    }
    return clash;
  })();

  function nameOf(k) {
    var d = NAMES[k];
    return d ? d.name : k;
  }
  function unitOf(k) {
    var d = NAMES[k];
    return d ? d.unit : '';
  }
  function dispOf(k) {
    var d = NAMES[k];
    return d ? d.disp : 'num';
  }

  /* ==========================================================================
   * §2 CONSTANTS —— 可调常量（第二层）
   * ----------------------------------------------------------------------
   * 抽取原则：**只抽"口径选择"，不抽"单位换算的定义式"**。
   *   · Tinseth / Morey / Hall / Kolbach 的系数是经验拟合，改它等于换口径 → 可调
   *   · 8.34540 是 2.20462 × 3.78541 推导出来的，改它等于把公制当英制 → 也放进来，
   *     但 doc 里写明"这不是经验值，动它一定是笔误"
   *   · ASBC 的 °P 三次多项式系数**不抽**：那是一份标准定义，抽成可调会让人以为
   *     "调一调更准"。它的四个系数直接写在表达式里，出处写在 entry.source。
   *
   * 越界不阻止保存：项目一贯做法（39a-field-rules 的三级告警里，hard 也不拦保存）。
   * 拦下来只会让用户去改别的地方绕过它；显红 + 说清后果，比锁死有用。
   * ======================================================================*/

  var CONSTANTS = [
    {
      key: 'ppg_metric', name: 'ppg → 公制点数系数', value: 8.34540, def: 8.34540,
      unit: 'pts·L/(ppg·kg)', min: 8.0, max: 8.7,
      doc: '2.20462 lb/kg × 3.78541 L/gal 推出来的纯换算系数，不是经验拟合。' +
           '它不是"调参旋钮"——改它等于把公制配方按英制算，OG 会整体偏掉。' +
           '只有在核对别人的英制算例时才有理由动（且要同步改回来）。'
    },
    {
      key: 'tinseth_b', name: 'Tinseth 苦度饱和系数', value: 1.65, def: 1.65,
      unit: '—', min: 0.8, max: 3.5,
      doc: 'bigness = 1.65 × 0.000125^(BG−1) 里的 1.65。它整体缩放苦度利用率，' +
           '所以 IBU 与它**成正比**：×1.1 就是 IBU 全体 +10%。' +
           '真实区间：文献原值 1.65，商业软件因颗粒花修正常用到 1.8 上下。' +
           '改它会让全库 50 条经典配方的 IBU 落点整体平移（docs/05 §3.1 明确不这么做）。'
    },
    {
      key: 'tinseth_base', name: 'Tinseth 比重底数', value: 0.000125, def: 0.000125,
      unit: '—', min: 0.00002, max: 0.0004,
      doc: '0.000125^(BG−1) 的底数，描述"麦汁每浓 1 个比重单位，利用率掉多少"。' +
           '它是**指数底**，动一点点就会让高浓度配方剧烈变化：1.050 与 1.090 之间的' +
           '差距由它决定。真实区间 1e-4 ~ 1.5e-4；超出这个范围，高浓度酒的 IBU 会失真。'
    },
    {
      key: 'tinseth_k', name: 'Tinseth 煮沸时间常数', value: 0.04, def: 0.04,
      unit: '1/min', min: 0.01, max: 0.12,
      doc: '(1 − e^(−k·t)) 里的 k，控制"苦味多久接近饱和"。0.04 意味着 60 min 达到' +
           '理论最大值的 91%。调大 → 短时间投花更苦；调小 → 需要更长时间才出苦。' +
           '真实区间 0.03–0.05。'
    },
    {
      key: 'tinseth_div', name: 'Tinseth 时间归一化除数', value: 4.15, def: 4.15,
      unit: '—', min: 2.0, max: 8.0,
      doc: '(1 − e^(−k·t)) / 4.15 里的 4.15，把"最大利用率"归一到一个具体数值上。' +
           '与 tinseth_b 一样是整体缩放，改它 IBU 全体反向变化。真实区间 3.5–5.0。'
    },
    {
      key: 'ibu_unit', name: 'IBU 单位换算系数', value: 10, def: 10,
      unit: '—', min: 9.9, max: 10.1,
      doc: 'IBU = α酸% × 克数 × U × 10 / L 里的 10。推导：英制 7489 × 3.78541 / 28.3495 ≈ 1000，' +
           '再除以 α酸百分数（100）得 10。这是单位换算，允许 9.9–10.1 只是给你核对' +
           '别人的算例留的余量，不该改。'
    },
    {
      key: 'morey_a', name: 'Morey 色度前置系数', value: 1.4922, def: 1.4922,
      unit: '—', min: 1.0, max: 2.2,
      doc: 'SRM = 1.4922 × MCU^0.6859 的乘数。整体缩放色度，改 10% 深色酒会明显偏。' +
           'Morey 原值 1.4922；部分软件用 1.4922 的变体 1.3546（那是 Lovibond 换算，别混）。'
    },
    {
      key: 'morey_b', name: 'Morey 色度指数', value: 0.6859, def: 0.6859,
      unit: '—', min: 0.5, max: 0.9,
      doc: 'MCU^0.6859 的指数，决定"色度随麦芽色度增长得多快"。小于 1 表示次线性：' +
           'MCU 翻倍，SRM 只涨 1.6 倍。改小 → 深色酒偏浅；改大 → 深色酒偏深。' +
           'Morey 在 SRM > 50 之后误差本身就大（±2 SRM 量级），别指望调它能修好。'
    },
    {
      key: 'srm_ebc', name: 'SRM → EBC 系数', value: 1.97, def: 1.97,
      unit: '—', min: 1.96, max: 1.98,
      doc: 'EBC = SRM × 1.97 是两种测量方法之间的**定义式**，不是拟合。' +
           '区间给 1.96–1.98 只是因为不同资料写 1.97 / 1.9702。改它没有物理依据。'
    },
    {
      key: 'abv_hall_a', name: 'Hall 式分子系数', value: 76.08, def: 76.08,
      unit: '—', min: 70, max: 82,
      doc: 'ABV = 76.08 × (OG−FG) / (1.775 − OG) × (FG / 0.794) 的 76.08。' +
           'Hall（1995）原文值。它整体缩放酒精度，改 1% 就整体偏 1%。'
    },
    {
      key: 'abv_hall_b', name: 'Hall 式 OG 修正项', value: 1.775, def: 1.775,
      unit: 'SG', min: 1.6, max: 1.95,
      doc: '(1.775 − OG) 这一项在 OG 越接近 1.775 时把酒精度推向无穷 —— ' +
           '这是 Hall 式的适用边界，不是 bug。OG > 1.120 之后这个式子的误差开始放大，' +
           'OG > 1.150 基本不能信。把 1.775 改小会让高浓度酒算出荒谬的值。'
    },
    {
      key: 'abv_hall_c', name: 'Hall 式终比重除数', value: 0.794, def: 0.794,
      unit: 'SG', min: 0.75, max: 0.85,
      doc: '(FG / 0.794) 是对"酒精水溶液的密度"的修正：0.794 是纯乙醇的比重。' +
           '这是物理常数，不是拟合值，正常不该动。'
    },
    {
      key: 'abv_simple_k', name: '简式酒精度系数', value: 131.25, def: 131.25,
      unit: '—', min: 125, max: 136,
      doc: '(OG−FG) × 131.25 的简式。8% 以下与 Hall 式差 <0.2%，高浓度会低估' +
           '（OG 1.090 时低估 0.8 个百分点）。界面默认显示 Hall 式，这个只作对照。'
    },
    {
      key: 'kolbach_ca', name: 'Kolbach 钙除数', value: 3.5, def: 3.5,
      unit: 'mg/L per ppm', min: 2.5, max: 5.0,
      doc: 'RA = 碱度 − Ca/3.5 − Mg/7 里的 3.5。它是"每 3.5 ppm 钙抵消 1 ppm 碱度"的' +
           '经验换算（Ca 当量 20.04，碳酸钙当量 50，理论值 2.5；Kolbach 取了更保守的 3.5）。' +
           '改大 → 钙降碱度的作用被削弱 → 算出的 pH 偏高。'
    },
    {
      key: 'kolbach_mg', name: 'Kolbach 镁除数', value: 7, def: 7,
      unit: 'mg/L per ppm', min: 4, max: 10,
      doc: 'Mg/7 里的 7，与钙同理但镁的降碱能力只有钙的一半。' +
           '镁超过 40 mg/L 会有苦涩味，所以这一项在实践中很少主导 RA。'
    },
    {
      key: 'hco3_alk', name: 'HCO₃⁻ → 碱度当量比', value: 0.8197, def: 0.8197,
      unit: '—', min: 0.80, max: 0.84,
      doc: '50/61 = 0.8197：把 HCO₃⁻ 的 mg/L 折成"以 CaCO₃ 计的碱度"。' +
           '61 是 HCO₃⁻ 当量，50 是 CaCO₃ 当量，两个都是化学定义值。不该改。'
    },
    {
      key: 'rdf_ratio', name: 'RDF ≈ ADF 换算比', value: 0.8192, def: 0.8192,
      unit: '—', min: 0.78, max: 0.85,
      doc: '真实衰减 RDF ≈ 0.8192 × 表观衰减 ADF（在 °P 空间）。行业经验关系，' +
           '区间 0.81–0.82。它只是把标称 ADF 折算成"实际被吃掉的比例"，' +
           '不参与 FG 的计算（FG 走逐原料可发酵点数）。'
    },
    {
      key: 'adf_lo', name: 'ADF 下限', value: 30, def: 30,
      unit: '%', min: 20, max: 45,
      doc: '内核把酵母标称衰减度夹在 30–100 之间。低于 30% 的酵母不存在（那是没发酵），' +
           '多半是输入错误。夹住比算出 FG 高于 OG 更安全。'
    },
    {
      key: 'adf_hi', name: 'ADF 上限', value: 100, def: 100,
      unit: '%', min: 90, max: 105,
      doc: '上限 100%：再高就意味着"比完全发酵还彻底"，没有物理意义。' +
           '酒香酵母（Brett）实测表观衰减可以超过 100%，但那是因为它吃掉了多糖，' +
           '本模型不表达这种情况。'
    },
    {
      key: 'carb_res_a', name: '残余 CO₂ 二次项', value: 0.00086, def: 0.00086,
      unit: 'vol/°C²', min: 0.0005, max: 0.0015,
      doc: '残余 CO₂ = a·T² + b·T + c 里的 a。这条曲线是 Zahm & Nagel / ASBC 溶解度' +
           '数据的常用拟合，只在 0–30 °C 有效。外推到低温会高估残余量 → 少算糖 → 欠气。'
    },
    {
      key: 'carb_res_b', name: '残余 CO₂ 一次项', value: -0.05952, def: -0.05952,
      unit: 'vol/°C', min: -0.09, max: -0.03,
      doc: '一次项 b（负值：温度越高，能溶的 CO₂ 越少）。它与 a、c 是一组，' +
           '单独改一个会破坏拟合曲线的形状（比如 0 °C 与 20 °C 同时失真）。'
    },
    {
      key: 'carb_res_c', name: '残余 CO₂ 常数项', value: 1.7077, def: 1.7077,
      unit: 'vol', min: 1.4, max: 2.0,
      doc: '常数项 c，也即 T=0 时的外推残余量。真实冰镇啤酒约 1.7 vol，' +
           '所以这个数不是随便拟合出来的。'
    },
    {
      key: 'carb_res_lo', name: '残余 CO₂ 下限', value: 0.4, def: 0.4,
      unit: 'vol', min: 0, max: 1.0,
      doc: '内核把残余量夹在 0.4–2.0 vol 之间。夹下限是为了防止低温+高温输入错乱时' +
           '算出负数（负数会让糖量凭空变大 → 爆瓶）。'
    },
    {
      key: 'carb_res_hi', name: '残余 CO₂ 上限', value: 2.0, def: 2.0,
      unit: 'vol', min: 1.5, max: 3.0,
      doc: '夹上限 2.0：常压发酵液在 0 °C 也到不了 2.0 vol 以上。' +
           '超过说明温度输入有误（比如把华氏度填进了摄氏度）。'
    },
    {
      key: 'sugar_sucrose', name: '蔗糖碳化系数', value: 3.82, def: 3.82,
      unit: 'g/L per vol', min: 3.4, max: 4.2,
      doc: '化学计量：342.3/176 × 1.963 = 3.82。即"每升酒每提高 1 vol CO₂ 需要 3.82 g 蔗糖"。' +
           '1.963 是 CO₂ 在 20 °C 的密度（g/L）。这是推导值，不是拟合值。'
    },
    {
      key: 'sugar_dextrose', name: '一水葡萄糖碳化系数', value: 4.42, def: 4.42,
      unit: 'g/L per vol', min: 4.0, max: 4.8,
      doc: '198.17/88 × 1.963 = 4.42。玉米糖（corn sugar）就是一水葡萄糖，' +
           '分子量比蔗糖大且只产一半的糖，所以要放更多。' +
           '把玉米糖按蔗糖的量放，气会不足 15% —— 这是家酿最常见的欠气原因。'
    },
    {
      key: 'sugar_dme', name: 'DME 碳化系数', value: 6.00, def: 6.00,
      unit: 'g/L per vol', min: 5.2, max: 6.8,
      doc: 'DME 约 75% 可发酵，按 3.82 / 0.75 ≈ 5.1 起算，实测口径取 6.00（含水分与' +
           '非发酵糖）。用它碳化会有轻微的酒体/风味影响，不如蔗糖干净。'
    },
    {
      key: 'sugar_honey', name: '蜂蜜碳化系数', value: 4.90, def: 4.90,
      unit: 'g/L per vol', min: 4.2, max: 6.0,
      doc: '蜂蜜含水约 17%、果糖葡萄糖为主，按 3.82 / 0.78 ≈ 4.9 估。' +
           '**这一项的离散度最大**：不同蜜源的含水量能差 5 个百分点，' +
           '用它碳化建议先按 4.9 算、再留 10% 余量观察。'
    },
    {
      key: 'dry_cells_g', name: '干酵母活细胞数', value: 15, def: 15,
      unit: '十亿/g', min: 5, max: 25,
      doc: '厂商标称 ≥6 十亿/g，新鲜干酵母实测 15–20。取 15 是中值。' +
           '**过期或高温存放的酵母应按 5 算**——那一档下接种量要三倍。' +
           '改小 → 算出需要更多克数；改大 → 建议投得更少。'
    },
    {
      key: 'evap_cap', name: '蒸发比例上限', value: 0.6, def: 0.6,
      unit: '—', min: 0.3, max: 0.8,
      doc: '内核把"蒸发量/煮沸前体积"夹在 0–60% 之间。防止蒸发率 × 时长算出 100% 以上' +
           '（那会让煮沸前体积变成无穷大）。4 小时煮沸 + 20%/h 就会撞到这个上限。'
    }
  ];

  var CINDEX = {};
  (function () {
    for (var i = 0; i < CONSTANTS.length; i++) {
      var c = CONSTANTS[i];
      c.order = i;
      CINDEX[c.key] = c;
    }
  })();

  Formula.CONSTANTS = CONSTANTS;
  Formula.constDef = function (key) { return CINDEX[key] || null; };

  /** 取常量的实际生效值：用户覆盖优先，否则用默认。非有限数一律回落默认。 */
  function cval(key, overrides) {
    var d = CINDEX[key];
    if (!d) return NaN;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
      var v = parseFloat(overrides[key]);
      if (isFinite(v)) return v;
    }
    return d.value;
  }
  Formula.cval = cval;

  /** 越界判定。**不阻止保存**，只告诉界面标红。 */
  Formula.constStatus = function (key, v) {
    var d = CINDEX[key];
    if (!d) return { ok: false, level: 'bad', text: '没有这个常量' };
    var x = parseFloat(v);
    if (!isFinite(x)) return { ok: false, level: 'bad', text: '不是数字' };
    if (x < d.min || x > d.max) {
      return {
        ok: false, level: 'bad',
        text: '超出经验区间 ' + d.min + '–' + d.max + '，仍可保存，但结果不再代表这个模型'
      };
    }
    return { ok: true, level: 'ok', text: '' };
  };

  /* ==========================================================================
   * §3 安全求值器
   * ----------------------------------------------------------------------
   * 为什么自己写：用户能编辑表达式（分享码里带的是表达式字符串），
   * 一旦用 eval / new Function，一段 `alert(1)` 或死循环就能把应用打死，
   * 而这是一个"双击 index.html 就能跑"的离线软件，没有 CSP 兜底。
   *
   * 流程：tokenize → 调度场算法（shunting-yard）→ RPN → 栈求值。
   * 支持：+ − × ÷ ^ ( ) 、一元负号、数字、标识符、函数
   *       exp / ln / log(以 10 为底) / sqrt / abs / min / max / pow / round
   *
   * `round(x, d)` 不在最初的函数清单里，但必须加：内核在好几处把中间值
   * 舍到固定精度再往下传（煮沸前体积 → 煮沸点数、ADF → RDF、IBU → BU:GU）。
   * 表达不了"舍入"这件事，"与内核逐位一致"就是一句空话。
   *
   * 几个约定（都会体现在 substituted 里，用户能看见）：
   *   · `^` 右结合：2^3^2 = 512，不是 64（数学惯例；Excel 是左结合，这里不跟）
   *   · `^` 比一元负号紧：−2^2 = −4
   *   · 除零 / 结果非有限 → 返回 null，界面显示"—"。**绝不返回 Infinity**
   *   · 未知标识符 → 抛出带名字的错误（"未知参数：foo"），不当 0 吞掉
   * ======================================================================*/

  var FN = {
    exp: [1, 1], ln: [1, 1], log: [1, 1], sqrt: [1, 1], abs: [1, 1],
    min: [2, 64], max: [2, 64], pow: [2, 2], round: [1, 2]
  };

  function tokenize(src) {
    if (typeof src !== 'string') throw ferr('表达式必须是字符串', 'type');
    if (!src.length) throw ferr('表达式是空的', 'empty');
    if (src.length > MAX_EXPR) {
      throw ferr('表达式过长（' + src.length + ' 字符，上限 ' + MAX_EXPR + '）', 'too-long');
    }
    var toks = [], i = 0, depth = 0;
    while (i < src.length) {
      var ch = src.charAt(i);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '　') { i++; continue; }

      if ((ch >= '0' && ch <= '9') || ch === '.') {
        var j = i, dots = 0;
        while (j < src.length) {
          var c = src.charAt(j);
          if (c >= '0' && c <= '9') { j++; continue; }
          if (c === '.') { dots++; if (dots > 1) break; j++; continue; }
          if ((c === 'e' || c === 'E') && j + 1 < src.length &&
              /[0-9+\-]/.test(src.charAt(j + 1)) && j > i) {
            j += 2;
            while (j < src.length && src.charAt(j) >= '0' && src.charAt(j) <= '9') j++;
            continue;
          }
          break;
        }
        var lit = src.slice(i, j), nv = Number(lit);
        if (!isFinite(nv)) throw ferr('不是合法的数字：' + lit, 'number');
        toks.push({ t: 'num', v: nv, s: lit });
        i = j;
        continue;
      }

      if (/[A-Za-z_\u4e00-\u9fa5\u0391-\u03c9]/.test(ch)) {
        var j2 = i;
        while (j2 < src.length && /[A-Za-z0-9_\u4e00-\u9fa5]/.test(src.charAt(j2))) j2++;
        toks.push({ t: 'id', v: src.slice(i, j2) });
        i = j2;
        continue;
      }

      if ('+-*/^(),'.indexOf(ch) >= 0) {
        if (ch === '(') {
          depth++;
          if (depth > MAX_DEPTH) throw ferr('括号嵌套过深（上限 ' + MAX_DEPTH + ' 层）', 'depth');
        }
        if (ch === ')') {
          depth--;
          if (depth < 0) throw ferr('括号不配对：多了一个「)」', 'paren');
        }
        toks.push({ t: 'op', v: ch });
        i++;
        continue;
      }

      throw ferr('不认识的字符「' + ch + '」', 'char');
    }
    if (depth !== 0) throw ferr('括号不配对：少了 ' + depth + ' 个「)」', 'paren');
    return toks;
  }

  var PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
  var UNARY_PREC = 3;

  function toRPN(toks) {
    var out = [], stack = [], prev = null, i, tk;

    for (i = 0; i < toks.length; i++) {
      tk = toks[i];

      if (tk.t === 'num') { out.push(tk); prev = 'val'; continue; }

      if (tk.t === 'id') {
        var nx = toks[i + 1];
        if (nx && nx.t === 'op' && nx.v === '(') {
          if (!FN[tk.v]) throw ferr('未知函数：' + tk.v, 'fn');
          stack.push({ t: 'fn', v: tk.v, argc: 1 });
          prev = 'fn';
          continue;
        }
        out.push({ t: 'var', v: tk.v });
        prev = 'val';
        continue;
      }

      var o = tk.v;

      if (o === '(') { stack.push({ t: 'op', v: '(' }); prev = 'op'; continue; }

      if (o === ')') {
        while (stack.length && !(stack[stack.length - 1].t === 'op' && stack[stack.length - 1].v === '(')) {
          out.push(stack.pop());
        }
        if (!stack.length) throw ferr('括号不配对：多了一个「)」', 'paren');
        stack.pop();
        if (stack.length && stack[stack.length - 1].t === 'fn') out.push(stack.pop());
        prev = 'val';
        continue;
      }

      if (o === ',') {
        while (stack.length && !(stack[stack.length - 1].t === 'op' && stack[stack.length - 1].v === '(')) {
          out.push(stack.pop());
        }
        if (!stack.length) throw ferr('逗号只能出现在函数参数里', 'comma');
        var f = stack[stack.length - 2];
        if (!f || f.t !== 'fn') throw ferr('逗号只能出现在函数参数里', 'comma');
        f.argc++;
        prev = 'op';
        continue;
      }

      var unary = (o === '-' || o === '+') && (prev === null || prev === 'op' || prev === 'fn');
      if (unary) {
        if (o === '+') { prev = 'op'; continue; }        /* 一元正号直接吃掉 */
        stack.push({ t: 'u', v: '-' });
        prev = 'op';
        continue;
      }

      var p = PREC[o];
      if (p === undefined) throw ferr('不认识的运算符「' + o + '」', 'op');
      var rightAssoc = (o === '^');
      while (stack.length) {
        var s = stack[stack.length - 1];
        if (s.t === 'op' && s.v === '(') break;
        if (s.t === 'fn') break;                        /* 函数调用比二元运算紧 */
        var sp = (s.t === 'u') ? UNARY_PREC : (PREC[s.v] === undefined ? 0 : PREC[s.v]);
        if (sp > p || (sp === p && !rightAssoc)) out.push(stack.pop());
        else break;
      }
      stack.push({ t: 'op', v: o });
      prev = 'op';
    }

    while (stack.length) {
      var top = stack.pop();
      if (top.t === 'op' && top.v === '(') throw ferr('括号不配对：多了一个「(」', 'paren');
      out.push(top);
    }
    return out;
  }

  /** 只验语法，不解析标识符（分享码导入时用：表达式里出现什么变量是另一回事）。
   *  除了 tokenizer / 调度场，还要**模拟一遍栈高度**：
   *  `1 +` 这种式子能通过调度场（它只是把 '+' 弹到输出队列），
   *  只有算一遍才知道操作数不够。不在这一步拦住，用户会拿到一条
   *  "语法合法"、一算就报错的公式。 */
  function parseExpr(src) {
    var rpn = toRPN(tokenize(src));
    var h = 0, i, it;
    for (i = 0; i < rpn.length; i++) {
      it = rpn[i];
      if (it.t === 'num' || it.t === 'var') { h += 1; continue; }
      if (it.t === 'u') {
        if (h < 1) throw ferr('表达式不完整（一元负号后面没有东西）', 'incomplete');
        continue;
      }
      if (it.t === 'fn') {
        var def = FN[it.v] || [1, 1];
        if (it.argc < def[0] || it.argc > def[1]) {
          throw ferr('函数 ' + it.v + ' 的参数个数不对（给了 ' + it.argc + ' 个）', 'arity');
        }
        if (h < it.argc) throw ferr('表达式不完整（' + it.v + ' 缺参数）', 'incomplete');
        h -= it.argc - 1;
        continue;
      }
      if (h < 2) throw ferr('表达式不完整（「' + it.v + '」缺操作数）', 'incomplete');
      h -= 1;
    }
    if (h !== 1) throw ferr('表达式结构不对（剩下 ' + h + ' 个值）', 'shape');
    return rpn;
  }

  var ZERO_DIV = { zero: true };

  function evalRPN(rpn, vars) {
    var st = [], i, it;
    for (i = 0; i < rpn.length; i++) {
      it = rpn[i];

      if (it.t === 'num') { st.push(it.v); continue; }

      if (it.t === 'var') {
        if (!Object.prototype.hasOwnProperty.call(vars, it.v)) {
          throw ferr('未知参数：' + it.v, 'unknown-var');
        }
        var val = vars[it.v];
        if (typeof val !== 'number') throw ferr('参数 ' + it.v + ' 不是数字', 'bad-var');
        st.push(val);
        continue;
      }

      if (it.t === 'u') {
        if (!st.length) throw ferr('表达式不完整（一元负号后面没有东西）', 'incomplete');
        st.push(-st.pop());
        continue;
      }

      if (it.t === 'fn') {
        var def = FN[it.v] || [1, 1];
        var n = it.argc;
        if (n < def[0] || n > def[1]) {
          throw ferr('函数 ' + it.v + ' 的参数个数不对（给了 ' + n + ' 个）', 'arity');
        }
        if (st.length < n) throw ferr('表达式不完整（' + it.v + ' 缺参数）', 'incomplete');
        var args = st.splice(st.length - n, n);
        var r = applyFn(it.v, args);
        if (r === ZERO_DIV || !isFinite(r)) return null;
        st.push(r);
        continue;
      }

      /* 二元运算符 */
      if (st.length < 2) throw ferr('表达式不完整（「' + it.v + '」缺操作数）', 'incomplete');
      var b = st.pop(), a = st.pop(), out;
      if (it.v === '+') out = a + b;
      else if (it.v === '-') out = a - b;
      else if (it.v === '*') out = a * b;
      else if (it.v === '/') { if (b === 0) return null; out = a / b; }
      else if (it.v === '^') {
        out = Math.pow(a, b);
        /* 负数开非整数次方 = NaN，按"算不出来"处理，不返回 NaN 让界面印出来 */
      } else throw ferr('不认识的运算符「' + it.v + '」', 'op');
      if (!isFinite(out)) return null;
      st.push(out);

      if (st.length > MAX_DEPTH * 4) throw ferr('表达式求值栈过深', 'depth');
    }

    if (st.length !== 1) throw ferr('表达式结构不对（剩下 ' + st.length + ' 个值）', 'shape');
    var fin = st[0];
    if (!isFinite(fin)) return null;
    return fin;
  }

  function applyFn(name, a) {
    switch (name) {
      case 'exp':   return Math.exp(a[0]);
      case 'ln':    return Math.log(a[0]);
      case 'log':   return Math.log(a[0]) / Math.LN10;
      case 'sqrt':  return a[0] < 0 ? NaN : Math.sqrt(a[0]);
      case 'abs':   return Math.abs(a[0]);
      case 'min':   return Math.min.apply(null, a);
      case 'max':   return Math.max.apply(null, a);
      case 'pow':   return Math.pow(a[0], a[1]);
      case 'round': return rnd(a[0], a.length > 1 ? a[1] : 0);
      default:      return NaN;
    }
  }

  /**
   * 求值。返回 number | null。
   * 语法错误 / 未知标识符 / 参数个数错 → **抛错**（带 message，界面标红显示原文）
   * 除零 / NaN / Infinity → **返回 null**（界面显示"—"）
   */
  function evalExpr(src, vars) {
    return evalRPN(parseExpr(src), vars || {});
  }

  Formula.evalExpr = evalExpr;
  Formula.checkSyntax = function (src) {
    try { parseExpr(src); return { ok: true, error: null }; }
    catch (e) { return { ok: false, error: e.message, code: e.code || 'expr' }; }
  };
  /** 把 RPN 再算一遍需要的函数表（测试用） */
  Formula.__fn = FN;

  /* ----------------------------------------------------------------------
   * substituted：把实际数值代进表达式，生成人话串
   *   1.65 × 0.000125^(1.048−1) × (1−e^(−0.04×60)) / 4.15 = 34.2
   * 用 × ÷ − 而不是 * / -，指数写 ^，自然对数底写 e^(...)。
   * 这一列是用户最想看的东西：它必须能让人拿计算器一位一位跟着按。
   * -------------------------------------------------------------------- */
  function substitute(src, vars, extra) {
    var toks;
    try { toks = tokenize(src); } catch (e) { return '表达式有误：' + e.message; }
    var out = [], i, tk;

    for (i = 0; i < toks.length; i++) {
      tk = toks[i];

      if (tk.t === 'num') { out.push(tk.s); continue; }

      if (tk.t === 'id') {
        var nx = toks[i + 1];
        if (nx && nx.t === 'op' && nx.v === '(') {
          /* exp(x) 显示成 e^(x)；其它函数照抄名字 */
          out.push(tk.v === 'exp' ? 'e^' : tk.v);
          continue;
        }
        var v = (extra && Object.prototype.hasOwnProperty.call(extra, tk.v))
          ? extra[tk.v] : vars[tk.v];
        if (v === undefined) out.push(tk.v);
        else out.push(show(v, dispOf(tk.v)));
        continue;
      }

      var o = tk.v;
      if (o === '*') out.push('×');
      else if (o === '/') out.push('÷');
      else if (o === '-') out.push('−');
      else out.push(o);
    }

    /* 在运算符两侧补空格，只补二元符号。
       一元负号不能补——−0.04 变成 "− 0.04" 会被读成"减 0.04"。
       判据：左边是数字/右括号、右边是数字/左括号或字母，才当二元减号。 */
    var s = out.join('');
    s = s.replace(/([^(\^,\s])([×÷+])/g, '$1 $2 ');
    s = s.replace(/([\d)])\s*−\s*(?=[\d(A-Za-z])/g, '$1 − ');
    return s;
  }
  Formula.substitute = substitute;

  /* ==========================================================================
   * §4 AGGS —— 逐行求和（"Σ 每行"这件事本身不是公式，是一个折叠）
   * ----------------------------------------------------------------------
   * 说明白：像 IBU、MCU、糖化点数这类量，内核的做法是"对每个原料行套同一个式子
   * 再加起来"。本模块把这件事拆成两层：
   *   · 行内表达式（expr）由**同一个求值器**算，所以它是一份真公式；
   *   · 求和是折叠，与内核的 for 循环逐字同构（跳过哪些行也照抄）。
   * 这样断言才有意义：行内公式错一个系数，总和一定对不上。
   *
   * `after` 用来表达依赖：ibu 的行内式子要用煮沸比重，而煮沸比重是第 17 条
   * 算出来的，所以这一组求和必须等那条之后再跑。
   * ======================================================================*/

  var FERM_TABLE = { base: 1.00, kiln: 1.00, crystal: 0.55, roast: 0.40,
                     grain: 1.00, sugar: 1.00, extract: 1.00 };

  /** 与 20-calc.js 的 fermentabilityOf() 同构：糖/提取物看 fermentable 字段，
   *  谷物看 cat。**不看 item.fermentable**（它在麦芽数据里是 high/med/low 的描述，
   *  不是系数——内核那里有一段长注释解释过这个坑，这里照抄结论，不重犯）。 */
  function fermentabilityOf(x) {
    if (x.cat === 'sugar' || x.cat === 'extract') {
      return x.fermentable === 'none' ? 0 : 1;
    }
    var f = FERM_TABLE[x.cat];
    return f === undefined ? 1.0 : f;
  }

  function isMashable(x) {
    return x.mustMash !== false && x.cat !== 'sugar' && x.cat !== 'extract';
  }

  var AGGS = [
    { as: 'A_grain', rows: 'fermentables', after: null,
      expr: 'kg',
      row: function (x) { return isMashable(x) ? { kg: toNum(x.amount, 0) } : null; } },

    { as: 'A_hopkg', rows: 'hops', after: null,
      expr: 'h_g / 1000',
      row: function (x) { return { h_g: toNum(x.amount, 0) }; } },

    { as: 'A_fpts', rows: 'fermentables', after: null,
      expr: 'ppg * kg * ppg_metric * row_eff / batch',
      row: function (x, v) {
        var kg = toNum(x.amount, 0), ppg = toNum(x.ppg, 0);
        if (kg <= 0 || ppg <= 0) return null;
        return { kg: kg, ppg: ppg, row_eff: (x.mustMash === false) ? 1 : (v.eff_pct / 100) };
      } },

    { as: 'A_ffpts', rows: 'fermentables', after: null,
      expr: 'ppg * kg * ppg_metric * row_eff / batch * row_ff',
      row: function (x, v) {
        var kg = toNum(x.amount, 0), ppg = toNum(x.ppg, 0);
        if (kg <= 0 || ppg <= 0) return null;
        return {
          kg: kg, ppg: ppg,
          row_eff: (x.mustMash === false) ? 1 : (v.eff_pct / 100),
          row_ff: fermentabilityOf(x)
        };
      } },

    { as: 'A_apts', rows: 'adjuncts', after: null,
      expr: 'adj_g * sugar_pct / 100 / 1000 * 46 * ppg_metric / batch',
      row: function (x) {
        var g = toNum(x.amount, 0), sp = toNum(x.extraSugarPct, 0);
        if (!sp || !g) return null;
        return { adj_g: g, sugar_pct: sp };
      } },

    { as: 'A_mashpts', rows: 'fermentables', after: null,
      expr: 'ppg * kg * ppg_metric * row_eff / batch',
      row: function (x, v) {
        if (!isMashable(x)) return null;
        var kg = toNum(x.amount, 0), ppg = toNum(x.ppg, 0);
        return { kg: kg, ppg: ppg, row_eff: (x.mustMash === false) ? 1 : (v.eff_pct / 100) };
      } },

    { as: 'A_mashw', rows: 'fermentables', after: null,
      expr: 'kg',
      row: function (x) { return isMashable(x) ? { kg: toNum(x.amount, 0) } : null; } },

    { as: 'A_mashext', rows: 'fermentables', after: null,
      expr: 'ppg * kg',
      row: function (x) {
        if (!isMashable(x)) return null;
        var kg = toNum(x.amount, 0), ppg = toNum(x.ppg, 0);
        if (kg <= 0 || ppg <= 0) return null;
        return { kg: kg, ppg: ppg };
      } },

    { as: 'A_mcu', rows: 'fermentables', after: null,
      expr: 'kg * lov * ppg_metric / batch',
      row: function (x) {
        var kg = toNum(x.amount, 0), lov = toNum(x.lov, 0);
        if (kg <= 0 || lov <= 0) return null;
        return { kg: kg, lov: lov };
      } },

    /* 苦度必须等 boil_gravity（拓扑序会自动排在它后面） */
    { as: 'A_ibu', rows: 'hops', after: 'boil_gravity',
      expr: 'aa * h_g * (tinseth_b * tinseth_base^(min(max(boil_gravity, 1), 1.2) - 1) * ' +
            '(1 - exp(-tinseth_k * emin)) / tinseth_div) * ibu_unit / batch',
      row: function (x, v) {
        var g = toNum(x.amount, 0), aa = toNum(x.aa, 0);
        if (g <= 0 || aa <= 0) return null;
        return { aa: aa, h_g: g, emin: v.eminOf(x) };
      } }
  ];

  var AINDEX = {};
  (function () { for (var i = 0; i < AGGS.length; i++) AINDEX[AGGS[i].as] = AGGS[i]; })();

  /* 逐行参数的名字表（与 NAMES 里的 key 一致）。抽出来是因为两处都要用：
     ① linkRegistry 判定标识符类型；② 界面上"每一行各自用了什么"的表格列顺序。 */
  var ROW_KEYS = ['kg', 'ppg', 'lov', 'h_g', 'aa', 'emin', 'adj_g', 'sugar_pct',
                  'row_eff', 'row_ff'];

  /* ==========================================================================
   * §5 REGISTRY —— 只读公式层
   * ----------------------------------------------------------------------
   * 每条的字段：
   *   key/name/unit/group  身份（name/unit 从 NAMES 取，不在这里重写）
   *   expr                 与内核同构的表达式（变量名 = NAMES 的 key）
   *   source               出处（能追到 docs/05 的哪一行、哪篇文献）
   *   note                 为什么这么算 / 什么情况下会偏
   *   digits               内核对这个量舍到几位（null = 不舍）
   *   cmp                  'exact' 1e-9 | 'rounded' 按 digits | 'noise' 见 eps | 'none'
   *   kernel(k)            从内核取真值（只读，绝不改写内核）
   *   editable:false       只读层：不提供逐条改表达式的入口
   *                         （用户要改的是常量；改整条式子会让它与内核脱钩，
   *                          那正是这个模块存在的反面）
   * ======================================================================*/

  var REGISTRY = [
    /* ------------------------------ 物料平衡 ------------------------------ */
    {
      key: 'grain_kg', group: '物料平衡',
      expr: 'A_grain',
      source: '物料平衡：只累加"需要糖化"的谷物（不含糖与提取物）',
      note: '糖与提取物不进糖化锅，所以不计入麦糟吸水与糖化用水；' +
            '它们的效率在出糖式里按 100% 处理。这个"算不算麦"的判据与内核一致：' +
            'mustMash !== false 且 cat 不是 sugar / extract。',
      digits: 3, cmp: 'rounded',
      kernel: function (k) { return k.vol.grainKg; }
    },
    {
      key: 'grain_absorb', group: '物料平衡',
      expr: 'A_grain * grain_abs_rate',
      source: '麦糟吸水 = 麦量 × 吸水率（默认 0.9 L/kg，家酿常见 0.8–1.1）',
      note: '吸水率是设备属性：粉碎越细、麦糟越厚，带走的水越多。' +
            '这一项漏算，煮沸前体积会系统性偏小 → 煮沸后糖度偏高。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.vol.grainAbsorption; }
    },
    {
      key: 'hop_absorb', group: '物料平衡',
      expr: 'A_hopkg * hop_abs_rate',
      source: '酒花吸水 = 酒花总量(kg) × 4.0 L/kg（干投另算，内核未计）',
      note: '4 L/kg 是整花/颗粒花的经验中值。干投量大的配方（>8 g/L）' +
            '实际损失会明显超过这个数——内核没有干投吸水项，所以高干投配方' +
            '的真实入罐量会比算出来的少。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.vol.hopAbsorption; }
    },
    {
      key: 'post_boil', group: '物料平衡',
      expr: 'batch + floss',
      source: '物料平衡：进发酵罐的量 = 装瓶量 + 冷端残液',
      note: '倒推的起点。所有体积都从这里往上游加回去，所以这一条错了，' +
            '后面每一条都会跟着错。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.vol.postBoil; }
    },
    {
      key: 'post_chill', group: '物料平衡',
      expr: 'post_boil + trub',
      source: '物料平衡：冷却后总量 = 进罐量 + 热端残液',
      note: '沉渣（热渣 + 回旋沉淀）留在锅里，不进发酵罐。' +
            '用 whirlfloc / 快速冷却会让沉渣更紧实，这一项可以调小。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.vol.postChill; }
    },
    {
      key: 'evap_frac', group: '物料平衡',
      expr: 'min(max(evap_rate / 100 * boil_min / 60, 0), evap_cap)',
      source: '蒸发比例 = 蒸发率(%/h) × 煮沸小时数，并夹在 0–60%',
      note: '注意它是**比例**不是体积：同样 10%/h，煮沸前体积越大，绝对蒸发越多。' +
            '内核在 60% 处封顶（防止 4 小时煮沸算出 100%）。' +
            '这一条内核不单独返回，所以不参与零覆盖断言——它由' +
            '「煮沸前体积」和「蒸发量」两条同时锁住（两个方程解一个未知数）。',
      digits: null, cmp: 'none',
      kernel: null
    },
    {
      key: 'pre_boil', group: '物料平衡',
      expr: '(post_chill + hop_absorb) / (1 - evap_frac)',
      source: '物料平衡倒推：preBoil × (1 − 蒸发比例) − 酒花吸水 = 冷却后总量',
      note: '买锅看的是这个数，不是批次量。经验：20 L 成品 + 10%/h × 60 min' +
            '大约需要 24–25 L 的锅。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.vol.preBoil; }
    },
    {
      key: 'evaporation', group: '物料平衡',
      expr: 'pre_boil * evap_frac',
      source: '蒸发量 = 煮沸前体积 × 蒸发比例',
      note: '内核按"每小时固定百分比"建模，不是固定升数——所以小批次与大批次' +
            '的绝对蒸发量不同。这与真实敞口锅的表现基本一致（表面积/体积比决定）。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.vol.evaporation; }
    },
    {
      key: 'mash_water', group: '物料平衡',
      expr: 'A_grain * thickness',
      source: '糖化用水量 = 麦量 × 水料比（L/kg）',
      note: '水料比 2.5–3.5 L/kg 是常规区间。低于 2.0 醪太稠、搅拌与出糖都受影响；' +
            '高于 5.0 酶浓度被稀释，效率反而下降（内核在这两头都会报警）。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.vol.mashWater; }
    },
    {
      key: 'first_runnings', group: '物料平衡',
      expr: 'max(0, mash_water - grain_absorb)',
      source: '首次麦汁量 = 糖化用水 − 麦糟吸水',
      note: '夹 0 是因为麦糟吸水可能大于糖化用水（水料比很低时），' +
            '那时候根本没有"首次麦汁"，只有一锅稠醪。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.vol.firstRunnings; }
    },
    {
      key: 'sparge_water', group: '物料平衡',
      expr: 'max(0, pre_boil - first_runnings)',
      source: '洗糟水 = 煮沸前体积 − 首次麦汁量',
      note: '洗糟水为 0 说明首次麦汁已经够煮沸体积了——那意味着水料比偏高，' +
            '糖化效率会掉。内核会给一条 warn。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.vol.spargeWater; }
    },
    {
      key: 'total_water', group: '物料平衡',
      expr: 'mash_water + sparge_water',
      source: '总用水 = 糖化用水 + 洗糟水',
      note: '这既是"要备多少水"，也是水质调节（调离子 / 除氯 / 调 pH）的用量基数。' +
            '只按批次量备水是最常见的低估。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.vol.totalWater; }
    },

    /* -------------------------------- 出糖 -------------------------------- */
    {
      key: 'og_points', group: '出糖',
      expr: 'A_fpts + A_apts',
      source: '出糖：points = Σ(ppg × kg × 8.34540 × 效率) / L，见 docs/05 §2 第 1 行',
      note: '8.34540 = 2.20462 lb/kg × 3.78541 L/gal，是纯单位换算。' +
            '糖与提取物（mustMash === false）效率按 100%，因为它们的糖已经在那里了。' +
            '辅料里的水果按"果实重量 × 含糖率"折成葡萄糖点（每 kg 46 点）。',
      digits: null, cmp: 'exact',
      kernel: function (k) { return (k.grav.og - 1) * 1000; }
    },
    {
      key: 'og', group: '出糖',
      expr: '1 + og_points / 1000',
      source: '比重点数 → 比重：SG = 1 + points / 1000',
      note: '这个换算本身没有近似（点是定义出来的）。但"点"这个单位只在' +
            '1.000–1.120 区间好用：点数与真实密度之间其实是非线性的。',
      digits: null, cmp: 'exact',
      kernel: function (k) { return k.grav.og; }
    },
    {
      key: 'og_plato', group: '出糖',
      expr: 'max(0, 135.997 * og^3 - 630.272 * og^2 + 1111.14 * og - 616.868)',
      source: 'ASBC 标准多项式（SG → °P），1.000–1.120 区间误差 < 0.05 °P',
      note: '四个系数是**标准定义**，所以没有抽成可调常量——抽出来只会让人' +
            '以为"调一调更准"。欧洲配方用 °P 计价，这里给的是同一件事的另一种写法。',
      digits: null, cmp: 'exact',
      kernel: function (k) { return k.grav.ogPlato; }
    },
    {
      key: 'boil_points', group: '出糖',
      expr: 'og_points * batch / round(pre_boil, 2)',
      source: '煮沸比重：糖总量守恒，体积变小浓度变大（points × 批次量 / 煮沸前体积）',
      note: '⚠️ 这里用 **round(pre_boil, 2)** 不是笔误：内核的 gravity() 拿到的是' +
            'volumeBalance() 的**返回值**，而那个值已经舍到 0.01 了。用未舍入的' +
            '内部值会让煮沸比重差出 1e-5，再经 Tinseth 放大到 IBU 的 0.01 量级。',
      digits: null, cmp: 'exact',
      kernel: function (k) { return (k.grav.boilGravity - 1) * 1000; }
    },
    {
      key: 'boil_gravity', group: '出糖',
      expr: '1 + boil_points / 1000',
      source: '煮沸比重（Tinseth 用的就是它，不是 OG）',
      note: '大多数表格拿 OG 去查苦度利用率，那是错的：煮沸时体积还没到成品量，' +
            '麦汁更浓、利用率更低。内核用物料平衡推出真实煮沸比重，所以比' +
            '"直接套 OG"的软件算得略低——这是内核更准的地方。',
      digits: null, cmp: 'exact',
      kernel: function (k) { return k.grav.boilGravity; }
    },
    {
      key: 'ferm_pts', group: '出糖',
      expr: 'A_ffpts + A_apts',
      source: '可发酵点数 = Σ(该行点数 × 该行可发酵比例)；水果糖按 100% 可发酵',
      note: '可发酵比例表（基麦 1.0 / 结晶 0.55 / 烘烤 0.40 / 乳糖 0）是可发酵性的' +
            '**原料属性**，不是公式系数，所以不放进可调常量——要改就改原料数据。' +
            '乳糖与麦芽糊精取 0：它们全部残留，这正是牛奶世涛 FG 偏高的原因。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.grav.fermentablePoints; }
    },
    {
      key: 'fg_points', group: '出糖',
      expr: 'max(0, round(og_points, 2) - round(ferm_pts, 2) * adf / 100)',
      source: 'FG 点数 = 总点数 − 可发酵点数 × 酵母衰减度，见 docs/05 §2 第 5 行',
      note: '为什么不是 "FG = OG − (OG−1)×ADF"：那样会把乳糖、结晶麦芽、深色谷物' +
            '一起按基麦的发酵度算，牛奶世涛的 FG 会算低 0.01 以上。' +
            '夹 0 是防"衰减度 100% + 乳糖"这种组合算出负点数。' +
            '⚠️ 两个输入都套了 round(…, 2)：内核的 attenuation() 收到的是 gravity() 的**返回值**，' +
            '而那个返回值里 totalPoints / fermentablePoints 已经舍到 2 位了。' +
            '（这条是断言抓出来的：不套 round 会差 8e-5 个比重点。）',
      digits: null, cmp: 'exact',
      kernel: function (k) { return (k.att.fg - 1) * 1000; }
    },
    {
      key: 'fg', group: '出糖',
      expr: '1 + fg_points / 1000',
      source: '终比重：与 OG 同一套点数换算',
      note: 'FG 决定酒体与甜感，也是"发酵是否完成"的判据。' +
            '注意它用的是酵母**标称**衰减度——真实发酵会因糖化温度、溶氧、' +
            '酵母代数而偏离，双乙酰还原结束后再测一次才准。',
      digits: null, cmp: 'exact',
      kernel: function (k) { return k.att.fg; }
    },
    {
      key: 'fg_plato', group: '出糖',
      expr: 'max(0, 135.997 * fg^3 - 630.272 * fg^2 + 1111.14 * fg - 616.868)',
      source: 'ASBC 标准多项式（与 og_plato 同一式）',
      note: '低浓度端（< 2 °P）多项式的绝对误差很小但相对误差大，' +
            '所以我把负值夹成 0——负数柏拉图度没有物理意义。',
      digits: null, cmp: 'exact',
      kernel: function (k) { return k.att.fgPlato; }
    },

    /* -------------------------------- 发酵 -------------------------------- */
    {
      key: 'adf', group: '发酵',
      expr: 'min(max(yeast_att, adf_lo), adf_hi)',
      source: '酵母标称表观衰减度，夹在 30–100% 之间',
      note: '这是**菌株属性**（标准麦汁里能做到多少），不是这份配方的实际衰减。' +
            '两者可以差 15 个百分点以上，界面上必须分开标——' +
            '这正是 docs/05 §4 专门写一节的原因。',
      digits: 1, cmp: 'rounded',
      kernel: function (k) { return k.att.adf; }
    },
    {
      key: 'aa_actual', group: '发酵',
      expr: '(og - fg) / (og - 1) * 100',
      source: '表观衰减（实测）的定义式（ASBC 口径），见 docs/05 §2 第 5c 行',
      note: '这份配方**真正**达到的表观衰减。乳糖、结晶麦芽、深色谷物会把' +
            '它拉低 10–20 个百分点。看 70% 以为发酵不完全，其实是配方设计如此。' +
            '内核只在 OG > 1.0001 时才计算，否则给 0（除零防护）。',
      digits: 1, cmp: 'rounded',
      /* OG = 1.000 时 (OG−1) = 0，比值没有意义。内核给 0（除零防护），
         本模块返回"—"。这是有意保留的语义差异：0% 表观衰减会被当成
         "发酵完全停滞"，而"没有数据"和"0"在酿酒里是两件事。 */
      skipIf: function (v) { return !(v.og > 1.0001); },
      kernel: function (k) { return k.att.aaActual; }
    },
    {
      key: 'rdf', group: '发酵',
      expr: 'round(adf, 1) * rdf_ratio',
      source: 'RDF ≈ 0.8192 × ADF（°P 空间），行业经验关系',
      note: '⚠️ 这里再套一层 round(adf, 1)：内核的 attenuation() 返回的 adf 已经' +
            '舍到 0.1，而 RDF 是用**那个**值算的。用未舍入的 adf 会差 0.04 —— ' +
            '小，但它会让人怀疑整张表。',
      digits: 1, cmp: 'rounded',
      kernel: function (k) { return k.att.rdf; }
    },
    {
      key: 'abv_hall', group: '发酵',
      expr: 'abv_hall_a * (og - fg) / (abv_hall_b - og) * (fg / abv_hall_c)',
      source: 'Hall 式（Hall, M.，*Brew by the Numbers*，Zymurgy 1995），docs/05 §2 第 4 行',
      note: '界面默认显示的就是它。高浓度（> 8%）比简式准，因为分母 (1.775 − OG) ' +
            '补偿了"酒精体积占比"的非线性。注意 OG 越接近 1.775 越离谱——' +
            '1.120 以上开始不可信，1.150 以上基本是错的。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.att.abvHall; }
    },
    {
      key: 'abv_simple', group: '发酵',
      expr: '(og - fg) * abv_simple_k',
      source: '简式 (OG−FG) × 131.25（业界通用近似）',
      note: '8% 以下与 Hall 式差 <0.2%，所以低度酒用哪个都行。' +
            '高浓度会**系统性低估**（OG 1.090 差 0.8 个百分点），' +
            '所以它只作对照，不作默认。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.att.abvSimple; }
    },

    /* -------------------------------- 苦度 -------------------------------- */
    {
      key: 'ibu', group: '苦度',
      expr: 'A_ibu',
      source: 'Tinseth（1995）：U = 1.65 × 0.000125^(BG−1) × (1−e^(−0.04t)) / 4.15，' +
              'IBU = α酸% × g × U × 10 / L。见 docs/05 §2 第 2 行',
      note: 't 是**等效煮沸时长**，不是投放阶段写的时间：首麦汁投花按 20 min、' +
            '糖化投花按 15 min、回旋沉淀按温度打 0.05–0.50 的折扣、干投按 0 min。' +
            '这张映射表由内核给出（每行参数表里的"等效煮沸时长"就是它），' +
            '本模块不复刻——复刻一次就是第二套实现的开始。' +
            '已知偏差：干投对 IBU 的**负贡献**（多酚结合异α酸）未计入，' +
            '高干投配方的实测苦度会低于计算值；超过 100 IBU 后溶解度接近饱和。',
      digits: 1, cmp: 'rounded',
      kernel: function (k) { return k.ibu.tinseth; }
    },
    {
      key: 'gu', group: '苦度',
      expr: '(og - 1) * 1000',
      source: 'GU（Gravity Unit）= 原麦汁比重点数 = (OG − 1) × 1000',
      note: '它就是"原麦汁浓度"的另一种说法，只是单位不同。' +
            '苦甜比的分母用它，因为酿酒界讨论平衡时一律用点数不用比重。',
      digits: 0, cmp: 'rounded',
      kernel: function (k) { return k.bal.gu; }
    },
    {
      key: 'bu_gu', group: '苦度',
      expr: 'round(ibu, 1) / gu',
      source: '苦甜比 BU:GU = IBU / GU，分级阈值见 20-calc.js balance()',
      note: '⚠️ 分子是 **舍到 0.1 的 IBU**：内核 balance() 收到的是 ibu.value' +
            '（已舍入），不是原始累加值。差 0.05 的 IBU 在 GU 50 上就是 0.001，' +
            '足够让两位小数的比值翻一格。' +
            '阈值：<0.4 极麦芽 / 0.4–0.6 偏麦芽 / 0.6–0.8 平衡偏麦 / ' +
            '0.8–1.0 平衡偏苦 / 1.0–1.3 偏苦 / >1.3 极苦。',
      digits: 2, cmp: 'rounded',
      /* GU = 0（空配方）时比值无意义；内核给 0，本模块给"—" */
      skipIf: function (v) { return !(v.gu > 0); },
      kernel: function (k) { return k.bal.ratio; }
    },

    /* -------------------------------- 色度 -------------------------------- */
    {
      key: 'mcu', group: '色度',
      expr: 'A_mcu',
      source: 'MCU = Σ(kg × °L × 8.3454) / L，见 docs/05 §2 第 3 行',
      note: 'MCU（Malt Color Unit）是中间量：它只看"麦芽色度 × 用量"，' +
            '还没做非线性校正。所以两份 MCU 相同的配方，SRM 一定相同——' +
            '但两份 SRM 相同的配方，MCU 可能不同（色度来源不同，观感也不同）。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.color.mcu; }
    },
    {
      key: 'srm', group: '色度',
      expr: 'morey_a * mcu^morey_b',
      source: 'Morey：SRM = 1.4922 × MCU^0.6859（Morey, D.，1990s；Beersmith/Promash 采用）',
      note: '只对 SRM < 50 有意义。煮沸会额外加深 2–3 SRM（美拉德），' +
            '模型不含这项修正——所以界面另有一个"预期实测色度"，' +
            '但**不喂进风格判定**（docs/05 §3.3 解释了为什么：会造出 16 条误报）。' +
            '深色酒实测通常比预测深，这是模型的已知方向性偏差。',
      digits: 1, cmp: 'rounded',
      kernel: function (k) { return k.color.srm; }
    },
    {
      key: 'ebc', group: '色度',
      expr: 'srm * srm_ebc',
      source: 'EBC = SRM × 1.97（两种测量方法之间的定义式），docs/05 §2 第 3b 行',
      note: '这是**换算**不是**换算成另一种模型**：SRM 与 EBC 是同一测量结果的两种刻度，' +
            '所以两者永远同增同减。项目早期曾经两处各写一份换算，' +
            '结果色标与数值对不上——现在只有 Units.srmToEbc 与这一处常量。',
      digits: 1, cmp: 'rounded',
      kernel: function (k) { return k.color.ebc; }
    },

    /* ------------------------------- 水化学 ------------------------------- */
    {
      key: 'ra', group: '水化学',
      expr: 'alk - ca / kolbach_ca - mg / kolbach_mg',
      source: 'Kolbach 残留碱度：RA = 碱度(as CaCO₃) − Ca/3.5 − Mg/7，docs/05 §2 第 6 行',
      note: '三个输入（总碱度 / 钙 / 镁）都是**含盐类贡献之后的末端值**，' +
            '所以加乳酸、加石膏都会反映到这里。千万别把它写回 "0.8197 × HCO₃"：' +
            '那样加酸 RA 不动、加碳酸钙 RA 反而下降，方向是反的（内核为这个 bug ' +
            '留了一段长注释，界面上有回归断言）。' +
            '已知偏差：碳酸盐硬度占主导的硬水里误差大，RA 只用来给方向，不给点值。',
      digits: 1, cmp: 'noise', eps: 0.15,
      kernel: function (k) { return k.water.ra; }
    },
    {
      key: 'so4cl', group: '水化学',
      expr: 'so4 / cl',
      source: 'SO₄/Cl = 硫酸盐 / 氯化物（质量浓度比），分级见 14-data-water 的 so4clMeaning',
      note: '这个比值描述"苦感 / 圆润感"的取向：<0.5 偏圆润（麦芽、浑浊 IPA 常用），' +
            '>2 偏干苦（西海岸 IPA）。**核心里 Cl = 0 时返回 99 当哨兵**，' +
            '本模块返回"—"：分母为 0 的比值没有意义，印一个 99 只会让人以为水很硬。' +
            '这个语义差异是故意的，测试里对 Cl = 0 的配方跳过这一条的比对。',
      digits: 2, cmp: 'noise', eps: 0.02,
      skipIf: function (v) { return !(v.cl > 0); },
      kernel: function (k) { return k.water.so4clRatio; }
    },

    /* -------------------------------- 接种 -------------------------------- */
    {
      key: 'pitch_cells', group: '接种',
      expr: 'pitch_rate * og_plato * batch',
      source: '细胞数(十亿) = 接种率(M/mL/°P) × °P × 体积(mL) / 1000，' +
              '化简即 rate × °P × 升数。见 docs/05 §2 第 8 行',
      note: '接种率来自酵母类型：艾尔 0.75、拉格 1.5、酸啤/布雷特 0.5 M cells/mL/°P' +
            '（White & Zainasheff, *Yeast*, 2010）。' +
            '低于标称 70% 会发酵迟缓、酯香偏重；高于 2 倍会发酵过快、酒体偏薄。',
      digits: 0, cmp: 'rounded',
      kernel: function (k) { return k.pitch.cellsBillion; }
    },
    {
      key: 'pitch_dry_g', group: '接种',
      expr: 'pitch_cells / dry_cells_g',
      source: '干酵母克数 = 细胞数 / 每克活细胞数（默认 15 十亿/g）',
      note: '厂商标称 ≥6 十亿/g，实测新鲜干酵母 15–20。取 15 是中值。' +
            '**过期或高温存放的酵母活细胞数会掉到 5 以下**——那时候这个数要乘以 3。' +
            '一包 11 g 是常见规格，所以"几包"就是它除以 11。',
      digits: 1, cmp: 'rounded',
      kernel: function (k) { return k.pitch.dryGrams; }
    },

    /* -------------------------------- 碳化 -------------------------------- */
    {
      key: 'carb_residual', group: '碳化',
      expr: 'min(max(carb_res_a * carb_temp^2 + carb_res_b * carb_temp + carb_res_c, ' +
            'carb_res_lo), carb_res_hi)',
      source: '残余 CO₂(vol) = 0.00086·T² − 0.05952·T + 1.7077（Zahm & Nagel / ASBC 拟合）',
      note: 'T 必须是**发酵结束后酒液达到过的最高温度**，不是装瓶当时的温度。' +
            '填低了会严重多算糖 —— 这是家酿爆瓶最常见的原因。' +
            '夹 0.4–2.0 是防温度输入错误（比如把华氏度填进摄氏度）。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.carb.residualVol; }
    },
    {
      key: 'carb_needed', group: '碳化',
      expr: 'max(0, carb_target - carb_residual)',
      source: '还需补的 CO₂ = 目标碳化度 − 残余量',
      note: '为 0 说明酒里已有的 CO₂ 已经够了（或者目标填得太低），' +
            '这时候按它算糖量会得到 0 —— 那是正确结果，不是算错。',
      digits: 2, cmp: 'rounded',
      kernel: function (k) { return k.carb.neededVol; }
    },
    {
      key: 'carb_sucrose', group: '碳化',
      expr: 'carb_needed * batch * sugar_sucrose',
      source: '糖量(g) = 需补体积 × 液量 × 3.82。系数推导：342.3/176 × 1.963 = 3.82',
      note: '蔗糖（白砂糖）是默认选择：干净、便宜、称量方便。' +
            '**它是三种糖里单位产气效率最高的**，所以用量最少。' +
            '沸水化开后冷却再加，直接撒粉容易结块、分布不均。',
      digits: 1, cmp: 'rounded',
      kernel: function (k) { return k.carb.grams.sucrose; }
    },
    {
      key: 'carb_dextrose', group: '碳化',
      expr: 'carb_needed * batch * sugar_dextrose',
      source: '一水葡萄糖（玉米糖）：198.17/88 × 1.963 = 4.42 g/L/vol',
      note: '"玉米糖"（corn sugar）在中文语境里就是指一水葡萄糖。' +
            '分子量比蔗糖大、只产一半的糖，所以要多放 16%。' +
            '按蔗糖的量放玉米糖，气会不足 15%——这是欠气最常见的单一原因。',
      digits: 1, cmp: 'rounded',
      kernel: function (k) { return k.carb.grams.dextrose; }
    },
    {
      key: 'carb_dme', group: '碳化',
      expr: 'carb_needed * batch * sugar_dme',
      source: 'DME（干麦芽提取物）：按约 75% 可发酵折算，实测口径 6.00 g/L/vol',
      note: '用它碳化会带一点麦芽风味（对淡色酒是干扰，对深色酒无所谓），' +
            '而且它不完全溶解、容易在瓶底留渣。只在手边没有糖时用。',
      digits: 1, cmp: 'rounded',
      kernel: function (k) { return k.carb.grams.dme; }
    },
    {
      key: 'carb_honey', group: '碳化',
      expr: 'carb_needed * batch * sugar_honey',
      source: '蜂蜜：含水约 17%，按 3.82 / 0.78 ≈ 4.90 g/L/vol',
      note: '离散度最大的一项：不同蜜源含水量差 5 个百分点，' +
            '所以它只能当"起点值"。用蜂蜜碳化建议先按 4.9 算、留 10% 余量，' +
            '第一批少放一点观察。',
      digits: 1, cmp: 'rounded',
      kernel: function (k) { return k.carb.grams.honey; }
    },

    /* ----------------------------- 反算与强度 ----------------------------- */
    {
      key: 'malt_need', group: '反算与强度',
      expr: 'target_pts * batch / (avg_ppg * ppg_metric * eff_pct / 100)',
      source: '出糖式的反解：麦量 = 目标点数 × 体积 / (加权平均出糖率 × 8.3454 × 效率)',
      note: '把「糖化效率 → 麦量」这条链反过来用。默认目标 = 当前配方的糖化点数，' +
            '此时它必须**恰好等于麦单里的糖化麦总量**（自洽检验）；' +
            '给它一个目标 OG 就是反算"还差多少麦"。' +
            '注意：反算只按当前配比等比缩放，不改变各麦芽的相对比例——' +
            '想调比例得回配方页改。糖与提取物不参与反算（它们不进糖化锅）。',
      digits: 3, cmp: 'exact',
      /* 没有糖化谷物（或效率为 0）时反算无意义：分母为 0。内核给 grainKg = 0，
         本模块给"—"，理由同 aa_actual。 */
      skipIf: function (v) { return !(v.avg_ppg > 0 && v.eff_pct > 0); },
      kernel: function (k) { return k.vol.grainKg; }
    },
    {
      key: 'boil_intensity', group: '反算与强度',
      expr: 'evaporation / round(pre_boil, 2) * 60 / boil_min * 100',
      source: '煮沸强度 = 每小时蒸发的体积百分比 = 蒸发量 / 煮沸前体积 / 时长',
      note: '按定义它**恒等于**配方里的「蒸发率」，所以这两个数看起来一样是对的——' +
            '列出来是为了让口径可见：模型按"每小时固定比例"处理蒸发，' +
            '不是"每小时固定升数"。真实敞口锅接近前者（表面积/体积比主导），' +
            '所以大批次小批次都能用同一个 %/h。' +
            '这条用内核舍到 0.01 的两个体积相除，两个舍入值再相除会把误差放大到 0.02 量级' +
            '（实测 8%/h 的拉格差 0.013），所以允差给 0.05——它不是公式差。',
      digits: 2, cmp: 'noise', eps: 0.05,
      kernel: function (k, ctx) {
        var pb = k.vol.preBoil;
        if (!(pb > 0)) return null;
        return k.vol.evaporation / pb * 60 / toNum(ctx.recipe.boilTime, 60) * 100;
      }
    }
  ];

  /* ----------------------------------------------------------------------
   * linkRegistry：把 expr 里的标识符接到 NAMES / CONSTANTS 上
   * ----------------------------------------------------------------------
   * 分两遍，因为**声明顺序 ≠ 求值顺序**：
   *   酵母标称 ADF 在展示上属于"发酵"组（排在出糖之后），但 FG 点数要用它。
   *   所以第一遍只登记 key 与标识符，第二遍才判类型；最后跑一次**稳定拓扑排序**
   *   得到求值顺序（Formula.__order），声明顺序原样留给界面。
   *
   * 这样做的代价是多 20 行；收益是以后往 REGISTRY 里插一条公式时，
   * 不需要人工算"它必须放在谁后面"——排序会自动做对，
   * 真有循环依赖则当场抛错（那说明公式体系自相矛盾，必须改设计而不是改顺序）。
   * -------------------------------------------------------------------- */
  var EVAL_ORDER = [];
  /* 配方侧标量输入（由 evaluate 从配方字段填进作用域）与两个派生标量。
     单独列出来是为了让"expr 里出现的每个标识符都必须有来源"这条检查可执行——
     少了它，一个拼错的变量名会一路静默跑到运行时。 */
  var SCALARS = ['batch', 'eff_pct', 'evap_rate', 'boil_min', 'trub', 'floss',
                 'grain_abs_rate', 'hop_abs_rate', 'thickness',
                 'carb_target', 'carb_temp', 'yeast_att', 'pitch_rate',
                 'alk', 'ca', 'mg', 'so4', 'cl', 'avg_ppg', 'target_pts'];

  (function linkRegistry() {
    var types = {}, i, j;
    var rowKeys = ROW_KEYS;
    for (i = 0; i < rowKeys.length; i++) types[rowKeys[i]] = 'row';
    for (i = 0; i < AGGS.length; i++) types[AGGS[i].as] = 'agg';
    for (i = 0; i < SCALARS.length; i++) types[SCALARS[i]] = 'input';

    /* ---- 第一遍：身份 + 标识符 ---- */
    for (i = 0; i < REGISTRY.length; i++) {
      var e = REGISTRY[i];
      if (types[e.key]) throw ferr('REGISTRY 里 key 重复：' + e.key, 'dup-key');
      if (CINDEX[e.key]) throw ferr('条目 key 与常量 key 撞了：' + e.key, 'dup-key');

      var nm = NAMES[e.key];
      if (!nm) throw ferr('条目 ' + e.key + ' 在 NAMES 里没有名字', 'no-name');
      e.name = nm.name;
      e.unit = nm.unit;
      e.editable = false;
      e.__ids = idsOf(e.expr);
      if (!e.source) throw ferr('条目 ' + e.key + ' 缺少 source', 'no-source');
      if (!e.note) throw ferr('条目 ' + e.key + ' 缺少 note', 'no-note');
      if (e.cmp === undefined) e.cmp = 'rounded';
      types[e.key] = 'entry';
    }

    /* ---- 第二遍：分类 ---- */
    for (i = 0; i < REGISTRY.length; i++) {
      var en = REGISTRY[i];
      en.params = [];
      en.consts = [];
      for (j = 0; j < en.__ids.length; j++) {
        var id = en.__ids[j];
        if (CINDEX[id]) { en.consts.push(id); continue; }
        var kind = types[id];
        if (!kind) {
          throw ferr('条目 ' + en.key + ' 用了未定义的标识符：' + id, 'unknown-id');
        }
        en.params.push({ k: id, name: nameOf(id), unit: unitOf(id), kind: kind });
      }
      delete en.__ids;
    }

    /* ---- 汇总行里用到的常量也要记到条目头上 ----
       为什么：ibu 的表达式只有一个 A_ibu，真正的系数（tinseth_b 等）藏在
       AGGS 的行内式里。不补这一步，改 tinseth_b 之后 IBU 的数值变了、
       但"已改"标记与"影响几条"都还是 0 —— 界面上会自相矛盾。 */
    var aggConsts = {};
    for (i = 0; i < AGGS.length; i++) {
      var aids = idsOf(AGGS[i].expr), ac = [];
      for (j = 0; j < aids.length; j++) if (CINDEX[aids[j]]) ac.push(aids[j]);
      aggConsts[AGGS[i].as] = ac;
    }
    for (i = 0; i < REGISTRY.length; i++) {
      var re = REGISTRY[i];
      for (j = 0; j < re.params.length; j++) {
        if (re.params[j].kind !== 'agg') continue;
        var list = aggConsts[re.params[j].k] || [];
        for (var q2 = 0; q2 < list.length; q2++) {
          if (re.consts.indexOf(list[q2]) < 0) re.consts.push(list[q2]);
        }
      }
    }

    /* ---- 稳定拓扑排序 ---- */
    var done = {}, order = [], guard = 0;
    while (order.length < REGISTRY.length) {
      var moved = false;
      for (i = 0; i < REGISTRY.length; i++) {
        var r = REGISTRY[i];
        if (done[r.key]) continue;
        var ready = true;
        for (j = 0; j < r.params.length; j++) {
          var pk = r.params[j].k;
          if (r.params[j].kind === 'entry' && !done[pk]) { ready = false; break; }
        }
        if (!ready) continue;
        done[r.key] = true;
        order.push(r);
        moved = true;
      }
      if (!moved) {
        var left = [];
        for (i = 0; i < REGISTRY.length; i++) if (!done[REGISTRY[i].key]) left.push(REGISTRY[i].key);
        throw ferr('REGISTRY 存在循环依赖，无法确定求值顺序：' + left.join(' / '), 'cycle');
      }
      if (++guard > REGISTRY.length + 2) throw ferr('REGISTRY 排序未收敛', 'cycle');
    }
    EVAL_ORDER = order;

    /* 纯汇总条目：把行内式里用到的**全局**变量（批次量 / 煮沸比重 …）也补进
       参数表。不补的话，IBU 的参数表只有一行"苦度合计 Σ"——用户看不到
       "原来还要除以 20 L"。逐行参数在 rowsTable 里，全局参数在这里。 */
    for (i = 0; i < REGISTRY.length; i++) {
      var ae = REGISTRY[i];
      var ag0 = AINDEX[ae.expr.trim()];
      if (!ag0) continue;
      var extra = idsOf(ag0.expr);
      for (j = 0; j < extra.length; j++) {
        var ek = extra[j];
        if (ROW_KEYS.indexOf(ek) >= 0) continue;
        if (CINDEX[ek]) continue;
        var kk = types[ek];
        if (!kk) continue;
        var dup = false;
        for (var q3 = 0; q3 < ae.params.length; q3++) if (ae.params[q3].k === ek) dup = true;
        if (dup) continue;
        ae.params.push({ k: ek, name: nameOf(ek), unit: unitOf(ek), kind: kk });
      }
    }

    /* 常量 → 受影响条目（含间接），供"改这个会影响什么"用 */
    for (i = 0; i < CONSTANTS.length; i++) CONSTANTS[i].affects = [];
    for (i = 0; i < REGISTRY.length; i++) {
      var e2 = REGISTRY[i];
      for (j = 0; j < e2.consts.length; j++) {
        var cd = CINDEX[e2.consts[j]];
        if (cd && cd.affects.indexOf(e2.key) < 0) cd.affects.push(e2.key);
      }
    }
    /* 传递闭包：常量 → 直接受影响的条目 → 依赖这些条目的条目 */
    for (i = 0; i < CONSTANTS.length; i++) {
      var c = CONSTANTS[i], changed = true;
      while (changed) {
        changed = false;
        for (j = 0; j < REGISTRY.length; j++) {
          var rr = REGISTRY[j];
          if (c.affects.indexOf(rr.key) >= 0) continue;
          for (var p = 0; p < rr.params.length; p++) {
            if (rr.params[p].kind === 'entry' && c.affects.indexOf(rr.params[p].k) >= 0) {
              c.affects.push(rr.key);
              changed = true;
              break;
            }
          }
        }
      }
    }
  })();

  function idsOf(src) {
    var tk = tokenize(src), ids = [];
    for (var q = 0; q < tk.length; q++) {
      if (tk[q].t !== 'id') continue;
      var nx = tk[q + 1];
      if (nx && nx.t === 'op' && nx.v === '(') continue;   /* 函数名 */
      if (ids.indexOf(tk[q].v) < 0) ids.push(tk[q].v);
    }
    return ids;
  }

  Formula.REGISTRY = REGISTRY;
  Formula.NAMES = NAMES;
  Formula.nameOf = nameOf;
  Formula.show = show;
  Formula.__order = function () { return EVAL_ORDER.map(function (e) { return e.key; }); };

  /* ==========================================================================
   * §6 evaluate —— 把一条配方跑过整个 REGISTRY
   * ----------------------------------------------------------------------
   * 返回数组，每条：
   *   { key, name, unit, group, expr, source, note, digits, cmp,
   *     kernel:{value}, mine:{value, raw, error}, edited, delta, status,
   *     substituted, params:[{k,name,unit,value,text,kind}], consts:[…] }
   *
   * 两列并排是**硬要求**：内核值 / 你的公式值。用户改错常量时要能看见，
   * 不许静默替换内核值。
   *
   * ⚠️ 常量来源（这条决定了它**不是**无副作用纯函数，必须写在这里而不是
   *    藏在实现里）：
   *      · evaluate(recipe)                → 用当前生效的用户版本（OVERRIDES）
   *      · evaluate(recipe, {consts:{}})   → 一个常量都不覆盖 = 纯内核原样
   *      · evaluate(recipe, {consts:{…}})  → 用给定的一组
   *    为什么要默认读用户版本：需求原话是"覆盖生效后 evaluate 用覆盖算，
   *    Calc.calcRecipe() 仍用内核算"。如果默认不读，用户点了"应用版本"之后
   *    面板上两列还一模一样，那个功能就等于没生效。
   *    要可复现（测试、离线复算），就显式传 `{}`。
   *    测试锁住的是两件事：默认读版本时数值确实变了；
   *    传 `{}` 时逐位等于 Calc.calcRecipe（tools/test-formula.js §用户版本）。
   * ======================================================================*/

  function yeastAttOf(r) {
    var ys = r.yeasts || [];
    var y = ys[0];
    if (!y) return 75;
    if (y.att) return toNum(y.att, 75);
    if (y.id && BREW.DB && BREW.DB.yeasts) {
      var d = null;
      for (var i = 0; i < BREW.DB.yeasts.length; i++) {
        if (BREW.DB.yeasts[i].id === y.id) { d = BREW.DB.yeasts[i]; break; }
      }
      if (d && d.att !== undefined) return toNum(d.att, 75);
    }
    return 75;
  }

  function pitchRateOf(r) {
    var y = (r.yeasts || [])[0] || {};
    var type = y.type || 'ale';
    var rates = BREW.DB && BREW.DB.pitchRates;
    if (rates && rates[type] !== undefined) return toNum(rates[type], 0.75);
    return 0.75;
  }

  function calcParts(r) {
    var Calc = BREW.Calc;
    var vol = Calc.volumeBalance(r);
    var grav = Calc.gravity(r, vol);
    var att = Calc.attenuation(r, grav);
    var ibu = Calc.ibu(r, grav, vol);
    var color = Calc.color(r, vol);
    var water = Calc.water(r, vol);
    var pitch = Calc.pitch(r, grav);
    var carb = Calc.carbonation(r);
    var bal = Calc.balance(ibu.value, grav.og);
    return { vol: vol, grav: grav, att: att, ibu: ibu, color: color,
             water: water, pitch: pitch, carb: carb, bal: bal };
  }

  /**
   * @param {object} recipe  配方（不会被修改）
   * @param {object} [opts]  { consts:{key:value}, targetOg:number }
   */
  Formula.evaluate = function (recipe, opts) {
    opts = opts || {};
    var r = recipe || {};
    /* 常量来源，必须说清楚（它决定了这个函数是不是纯的）：
       · opts.consts **给出来就用它** —— 传 `{}` 表示"一个常量都不覆盖"，
         此时 mine 列必须逐位等于 kernel 列（测试与自检走这条路）；
       · **不给**（undefined）则用当前生效的用户版本 —— 这正是需求里那句
         "覆盖生效后 evaluate 用覆盖算，Calc.calcRecipe 仍用内核算"。
       想让调用完全不依赖用户状态，就显式传 {}。 */
    var ov = (opts.consts === undefined) ? OV.consts() : (opts.consts || {});
    var D = (BREW.Config && BREW.Config.DEFAULTS) || {};

    /* ---- 内核真值（只读） ---- */
    var K = null, kerr = null;
    try { K = calcParts(r); } catch (e) { kerr = e; }

    /* kernel(k, ctx)：k 是内核各子函数的结果包，ctx 只带配方原文（个别式子要用原始字段） */
    var kctx = { recipe: r };

    /* ---- 变量作用域 ---- */
    var vars = {};
    function set(k, v) { vars[k] = v; }

    set('batch', toNum(r.batchSize, D.batchSize === undefined ? 20 : D.batchSize));
    set('eff_pct', toNum(r.efficiency, D.efficiency === undefined ? 72 : D.efficiency));
    set('evap_rate', toNum(r.evaporationRate, D.evaporationRate === undefined ? 10 : D.evaporationRate));
    set('boil_min', toNum(r.boilTime, D.boilTime === undefined ? 60 : D.boilTime));
    set('trub', toNum(r.trubLoss, D.trubLoss === undefined ? 1.5 : D.trubLoss));
    set('floss', toNum(r.fermenterLoss, D.fermenterLoss === undefined ? 0.8 : D.fermenterLoss));
    set('grain_abs_rate', toNum(r.grainAbsorption, D.grainAbsorption === undefined ? 0.9 : D.grainAbsorption));
    set('hop_abs_rate', toNum(r.hopAbsorption, D.hopAbsorption === undefined ? 4.0 : D.hopAbsorption));
    set('thickness', toNum(r.mashThickness, D.mashThickness === undefined ? 3.0 : D.mashThickness));
    var carb = r.carbonation || {};
    set('carb_target', toNum(carb.targetVol, D.carbonationVol === undefined ? 2.4 : D.carbonationVol));
    set('carb_temp', toNum(carb.tempC, 20));
    set('yeast_att', yeastAttOf(r));
    set('pitch_rate', pitchRateOf(r));

    /* 水化学末端值：内核已算好含盐贡献的离子浓度。
       这里读内核而**不是**自己累加盐类——一张盐类离子表复制两份，迟早不一致。 */
    if (K) {
      set('alk', K.water.alkalinity);
      set('ca', K.water.ca);
      set('mg', K.water.mg);
      set('so4', K.water.so4);
      set('cl', K.water.cl);
    } else {
      set('alk', 0); set('ca', 0); set('mg', 0); set('so4', 0); set('cl', 0);
    }

    /* 逐行求值需要的"等效煮沸时长"由内核给（见 ibu 的 note）。
       ⚠️ **不要按 hop.id 缓存**：同一种酒花可以出现在两行（回旋 20 min 与干投 0 min），
       id 相同而等效时长不同。按 id 缓存会让干投那一行拿到回旋的 7 min，
       于是干投的 60 g 凭空产生 23 IBU —— 实测在"西海岸 IPA"预设上差 23.2 IBU。
       Calc.effectiveMinutes 是纯映射、常数时间，不缓存也不慢。 */
    function eminOf(hop) {
      try { return BREW.Calc.effectiveMinutes(hop); } catch (e) { return 0; }
    }
    vars.eminOf = eminOf;   /* 不参与表达式，只给 AGGS 的 row() 用 */

    /* ---- 常量并入作用域 ---- */
    var scope = {};
    for (var ci = 0; ci < CONSTANTS.length; ci++) {
      scope[CONSTANTS[ci].key] = cval(CONSTANTS[ci].key, ov);
    }

    /* ---- 汇总行 ---- */
    var aggRows = {};       /* as → 每行 [{vars, value}]，供 substituted 展开 */
    var pending = AGGS.slice();

    function evalAgg(a) {
      var rows = r[a.rows] || [];
      var sum = 0, detail = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row) continue;
        var rv = a.row(row, vars);
        if (!rv) continue;
        var local = {};
        for (var gk in vars) {
          if (!Object.prototype.hasOwnProperty.call(vars, gk)) continue;
          local[gk] = vars[gk];
        }
        for (var rk in rv) if (Object.prototype.hasOwnProperty.call(rv, rk)) local[rk] = rv[rk];
        for (var ck in scope) if (Object.prototype.hasOwnProperty.call(scope, ck)) local[ck] = scope[ck];
        var v = evalExpr(a.expr, local);
        if (v === null) continue;
        sum += v;
        detail.push({ vars: local, value: v, row: row });
      }
      vars[a.as] = sum;
      aggRows[a.as] = detail;
    }

    function ensureAggs() {
      var moved = true;
      while (moved) {
        moved = false;
        for (var i = pending.length - 1; i >= 0; i--) {
          var a = pending[i];
          if (a.after && !(a.after in vars)) continue;
          evalAgg(a);
          pending.splice(i, 1);
          moved = true;
        }
      }
      if (vars.avg_ppg === undefined && vars.A_mashw !== undefined) {
        /* 没有糖化谷物时给 0（下游是除法 → 返回 null → 界面显示"—"），
           而不是留 undefined（那会让求值器抛"未知参数"，红色错误满天飞） */
        vars.avg_ppg = vars.A_mashw > 0 ? (vars.A_mashext / vars.A_mashw) : 0;
      }
      if (vars.target_pts === undefined) {
        vars.target_pts = (opts.targetOg !== undefined && opts.targetOg !== null)
          ? (toNum(opts.targetOg, 1.05) - 1) * 1000
          : vars.A_mashpts;
      }
    }

    /* ---- 逐条求值（顺序 = 拓扑序；输出顺序 = 声明序，界面按声明序分组） ---- */
    var resMap = {};
    var editedSet = {};
    for (var ei = 0; ei < EVAL_ORDER.length; ei++) {
      var e = EVAL_ORDER[ei];
      ensureAggs();

      var local2 = {};
      var gk2;
      for (gk2 in vars) if (Object.prototype.hasOwnProperty.call(vars, gk2)) local2[gk2] = vars[gk2];
      for (var ck2 in scope) if (Object.prototype.hasOwnProperty.call(scope, ck2)) local2[ck2] = scope[ck2];

      var raw = null, errMsg = null;
      try { raw = evalExpr(e.expr, local2); }
      catch (er) { errMsg = er.message; }
      if (raw !== null && raw !== undefined) vars[e.key] = raw;

      var kres = { value: null, error: kerr ? kerr.message : null };
      if (K && typeof e.kernel === 'function') {
        try {
          var kv = e.kernel(K, kctx);
          kres.value = (typeof kv === 'number' && isFinite(kv)) ? kv : null;
        } catch (e2) { kres.error = e2.message; }
      }

      /* 只看"我改过的常量是否影响这条"（含间接依赖） */
      var touched = false;
      for (var p2 = 0; p2 < e.consts.length; p2++) {
        if (Object.prototype.hasOwnProperty.call(ov, e.consts[p2])) touched = true;
      }
      for (var p3 = 0; p3 < e.params.length; p3++) {
        var pk = e.params[p3].k;
        if (e.params[p3].kind === 'entry' && editedSet[pk]) touched = true;
      }
      if (touched) editedSet[e.key] = true;

      var mineVal = raw;
      if (raw !== null && e.digits !== null && e.digits !== undefined) mineVal = rnd(raw, e.digits);

      /* skipIf：这一条在这个配方上没有意义（比如 Cl = 0 时的 SO₄/Cl） */
      var skipped = false;
      if (typeof e.skipIf === 'function') {
        try { skipped = !!e.skipIf(vars); } catch (e3) { skipped = false; }
      }

      var status = 'ok';
      if (errMsg) status = 'error';
      else if (raw === null) status = 'empty';
      else if (touched) status = 'edited';
      if (skipped) status = 'skip';
      else if (!errMsg && kres.value !== null && mineVal !== null) {
        var dd = Math.abs(mineVal - kres.value);
        var eps = e.cmp === 'noise' ? toNum(e.eps, 0.05) : 1e-9;
        if (dd > eps) status = (status === 'edited') ? 'edited' : 'diff';
      }

      resMap[e.key] = {
        key: e.key, name: e.name, unit: e.unit, group: e.group,
        expr: e.expr, source: e.source, note: e.note,
        digits: e.digits, cmp: e.cmp, eps: e.eps || null,
        editable: e.editable,
        kernel: kres,
        mine: { value: mineVal, raw: raw, error: errMsg },
        edited: touched,
        skipped: skipped,
        status: status,
        params: e.params.map(function (pp) {
          var v = vars[pp.k];
          return {
            k: pp.k, name: pp.name, unit: pp.unit, kind: pp.kind,
            value: (typeof v === 'number') ? v : null,
            text: show(v, dispOf(pp.k))
          };
        }),
        consts: e.consts.map(function (ck) {
          var cd = CINDEX[ck];
          return {
            k: ck, name: cd.name, unit: cd.unit,
            value: scope[ck], def: cd.value,
            changed: Math.abs(scope[ck] - cd.value) > 1e-12
          };
        }),
        substituted: buildSubstituted(e, vars, scope, aggRows),
        rowsTable: (AINDEX[e.expr.trim()] ? buildRowsTable(AINDEX[e.expr.trim()], aggRows[AINDEX[e.expr.trim()].as], e.key) : null)
      };
    }

    var out = [];
    for (var oi = 0; oi < REGISTRY.length; oi++) out.push(resMap[REGISTRY[oi].key]);
    return out;
  };

  /* ----------------------------------------------------------------------
   * 逐行表：纯汇总条目（IBU / MCU / 各点数合计）在界面上要能"一行一行看"。
   * 为什么必须有这张表：这类量的参数是**每行各一份**的（30g 60min 与 60g 干投
   * 的等效时长不同），只给一个 Σ 等于什么都没说。用户问"我这 60 g 干投贡献了
   * 多少 IBU"，答案只能从这张表里读出来。
   * -------------------------------------------------------------------- */
  function buildRowsTable(ag, detail, aggKey) {
    if (!detail || !detail.length) return null;
    var cols = [], ids = idsOf(ag.expr), i, k;
    for (i = 0; i < ids.length; i++) {
      k = ids[i];
      if (ROW_KEYS.indexOf(k) < 0) continue;
      cols.push({ k: k, name: nameOf(k), unit: unitOf(k) });
    }
    if (!cols.length) return null;
    var rows = [], total = 0;
    for (i = 0; i < detail.length; i++) {
      var d = detail[i];
      var cells = [];
      for (var c = 0; c < cols.length; c++) {
        cells.push(show(d.vars[cols[c].k], dispOf(cols[c].k)));
      }
      rows.push({
        label: String((d.row && (d.row.name || d.row.id)) || ('第 ' + (i + 1) + ' 行')),
        cells: cells,
        value: d.value,
        valueText: show(d.value, dispOf(aggKey))
      });
      total += d.value;
    }
    return { cols: cols, rows: rows, total: total, totalText: show(total, dispOf(aggKey)) };
  }

  /** 生成代入串。纯汇总行（expr 就是一个 Σ）会把每行展开，最多 4 行。 */
  function buildSubstituted(e, vars, scope, aggRows) {
    var body;
    var aggOnly = AINDEX[e.expr.trim()];
    var extra = {};

    if (aggOnly) {
      var rows = aggRows[aggOnly.as] || [];
      if (rows.length && rows.length <= 4) {
        var parts = [];
        for (var i = 0; i < rows.length; i++) {
          parts.push(substitute(aggOnly.expr, rows[i].vars, null));
        }
        body = parts.join(' + ');
      } else if (rows.length > 4) {
        body = substitute(aggOnly.expr, rows[0].vars, null) +
               ' + …（共 ' + rows.length + ' 行，合计 ' + show(vars[aggOnly.as], 'num') + '）';
      } else {
        body = substitute(e.expr, vars, null);
      }
    } else {
      /* 不是纯汇总：Σ 用一个合计值代替（避免句子被展开成流水账），
         常量也要代进值里——不然"改一个常量"在代入串上完全看不出来 */
      for (var a in aggRows) {
        if (!Object.prototype.hasOwnProperty.call(aggRows, a)) continue;
        extra[a] = vars[a];
      }
      for (var sck in scope) {
        if (!Object.prototype.hasOwnProperty.call(scope, sck)) continue;
        extra[sck] = scope[sck];
      }
      body = substitute(e.expr, vars, extra);
    }

    var res = e.digits === null || e.digits === undefined
      ? (isNum(vars[e.key]) ? show(vars[e.key], dispOf(e.key)) : '—')
      : show(vars[e.key], dispOf(e.key));

    if (body.length > 700) body = body.slice(0, 696) + ' …';
    return body + ' = ' + res + (e.unit ? ' ' + e.unit : '');
  }

  /** 便捷：只取一条（界面展开时用） */
  Formula.one = function (recipe, key, opts) {
    var all = Formula.evaluate(recipe, opts);
    for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
    return null;
  };

  /** 麦量反算：给定目标 OG，返回需要的糖化麦总量（kg）。UI 与文档都走这里。 */
  Formula.grainForOg = function (recipe, targetOg, opts) {
    var all = Formula.evaluate(recipe, { consts: (opts && opts.consts) || {},
                                         targetOg: targetOg });
    for (var i = 0; i < all.length; i++) {
      if (all[i].key === 'malt_need') return all[i].mine.value;
    }
    return null;
  };

  /** 改一个常量，返回受影响最大的 n 条（界面上"改这个 → IBU 34.2 → 37.6"） */
  Formula.affected = function (recipe, constKey, newValue, opts) {
    opts = opts || {};
    var base = opts.consts || {};
    var a = Formula.evaluate(recipe, { consts: base, targetOg: opts.targetOg });
    var ov = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) ov[k] = base[k];
    ov[constKey] = newValue;
    var b = Formula.evaluate(recipe, { consts: ov, targetOg: opts.targetOg });

    var map = {};
    for (var i = 0; i < a.length; i++) map[a[i].key] = a[i];

    var list = [];
    for (var j = 0; j < b.length; j++) {
      var before = map[b[j].key];
      if (!before) continue;
      var v0 = before.mine.value, v1 = b[j].mine.value;
      if (!isNum(v0) || !isNum(v1)) continue;
      var dv = v1 - v0;
      if (Math.abs(dv) < 1e-9) continue;
      list.push({
        key: b[j].key, name: b[j].name, unit: b[j].unit,
        from: v0, to: v1, delta: dv,
        rel: Math.abs(v0) > 1e-12 ? Math.abs(dv / v0) : Math.abs(dv),
        fromText: show(v0, dispOf(b[j].key)) + (b[j].unit ? ' ' + b[j].unit : ''),
        toText: show(v1, dispOf(b[j].key)) + (b[j].unit ? ' ' + b[j].unit : '')
      });
    }
    list.sort(function (x, y) { return y.rel - x.rel; });
    return opts.limit ? list.slice(0, opts.limit) : list;
  };

  /* ==========================================================================
   * §7 OVERRIDES —— 用户版本（第三层）
   * ----------------------------------------------------------------------
   * 存储：复用 BREW.Store（顶层新键 `formulas`），SCHEMA_VERSION 保持 2。
   *   · 老数据加载后这个键不存在 → loadState() 归一成空状态（容忍缺失）
   *   · 只存**被改过的**常量（差量），默认值永不入库
   *   · 配额：整块 ≤ 20000 字符（存的是文本，不是图）。超了拒绝保存并报当前占用
   *
   * 为什么不用 PUT 整表覆盖：Store.set 会把对象按引用放进库，之后 UI 再改
   * 这个对象就是"没保存却已生效"。所以每次写都先克隆一份。
   * ======================================================================*/

  var LIMIT = 20000;
  var STORE_KEY = 'formulas';

  var STATE = { active: null, consts: {}, items: [], loaded: false };

  /* 内置模板。id 以 tpl- 开头，不可删、不可覆盖。
     「偏高苦度」只动 tinseth_b：U ∝ tinseth_b，所以 IBU 整体 +10%。
     把 base / div / k 也各乘 1.1 得到的是 +2.6%（指数与指数项会互相抵消掉一部分），
     那样名字里的"+10%"就在说谎 —— 名字必须对得上它真正干的事。 */
  var BUILTIN = [
    {
      id: 'tpl-default', name: '默认（与内核一致）', builtin: true,
      desc: '一个常量都不改。此时每一行的"你的公式值"必须等于"内核值"。',
      consts: {}
    },
    {
      id: 'tpl-bitter', name: '偏高苦度（Tinseth 利用率 +10%）', builtin: true,
      desc: '只把 tinseth_b 从 1.65 调到 1.815。苦度利用率与它成正比，' +
            '所以 IBU 整体上浮 10% —— 同一配方 34.2 → 37.6 IBU。' +
            '用途：你的设备实际苦度总比计算值高一点时，用它对齐经验值。',
      consts: { tinseth_b: 1.815 }
    }
  ];

  function blankState() {
    return { active: null, consts: {}, items: [] };
  }

  function normalizeState(o) {
    var s = blankState();
    if (!o || typeof o !== 'object') return s;
    if (typeof o.active === 'string') s.active = o.active;
    if (o.consts && typeof o.consts === 'object') {
      for (var k in o.consts) {
        if (!Object.prototype.hasOwnProperty.call(o.consts, k)) continue;
        if (!CINDEX[k]) continue;                       /* 认不出的常量一律丢掉 */
        var v = parseFloat(o.consts[k]);
        if (isFinite(v)) s.consts[k] = v;
      }
    }
    if (Array.isArray(o.items)) {
      for (var i = 0; i < o.items.length; i++) {
        var it = o.items[i];
        if (!it || typeof it !== 'object' || !it.id) continue;
        s.items.push({
          id: String(it.id),
          name: String(it.name || '未命名版本'),
          createdAt: String(it.createdAt || ''),
          updatedAt: String(it.updatedAt || it.createdAt || ''),
          note: String(it.note || ''),
          consts: sanitizeConsts(it.consts),
          exprs: (it.exprs && typeof it.exprs === 'object') ? it.exprs : {}
        });
      }
    }
    return s;
  }

  function sanitizeConsts(o) {
    var out = {};
    if (!o || typeof o !== 'object') return out;
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      if (!CINDEX[k]) continue;
      var v = parseFloat(o[k]);
      if (isFinite(v)) out[k] = v;
    }
    return out;
  }

  function loadState() {
    if (STATE.loaded) return STATE;
    STATE.loaded = true;
    var raw = null;
    try {
      raw = (BREW.Store && BREW.Store.get) ? BREW.Store.get(STORE_KEY, null) : null;
    } catch (e) { raw = null; }
    var s = normalizeState(raw);
    STATE.active = s.active;
    STATE.consts = s.consts;
    STATE.items = s.items;
    return STATE;
  }

  function snapshot() {
    return { active: STATE.active, consts: STATE.consts, items: STATE.items };
  }

  /** 序列化后的字符数（= localStorage 里真正占的长度，UTF-16 每个字符算 1） */
  function sizeOf(obj) {
    try { return JSON.stringify(obj || snapshot()).length; } catch (e) { return 0; }
  }

  function persist() {
    var payload = JSON.parse(JSON.stringify(snapshot()));
    var chars = sizeOf(payload);
    if (chars > LIMIT) {
      return {
        ok: false, code: 'TOO_LARGE', chars: chars, limit: LIMIT,
        reason: '公式数据已占 ' + chars + ' 字符，超过上限 ' + LIMIT + '（存的是文本）。' +
                '请先删掉几个不用的版本，或把常量恢复默认。'
      };
    }
    if (BREW.Store && BREW.Store.isReadonly && BREW.Store.isReadonly()) {
      return { ok: false, code: 'READONLY', chars: chars,
               reason: '当前是只读模式（数据来自更新的版本），这次修改没有落盘' };
    }
    try {
      if (BREW.Store && BREW.Store.set) BREW.Store.set(STORE_KEY, payload);
    } catch (e) {
      return { ok: false, code: 'WRITE_FAILED', chars: chars,
               reason: '写入失败：' + ((e && e.message) || '未知原因') };
    }
    return { ok: true, chars: chars };
  }

  var OV = Formula.OVERRIDES = {
    LIMIT: LIMIT,

    /** 当前生效的常量覆盖（只含被改过的） */
    consts: function () {
      loadState();
      var out = {};
      for (var k in STATE.consts) {
        if (Object.prototype.hasOwnProperty.call(STATE.consts, k)) out[k] = STATE.consts[k];
      }
      return out;
    },

    /** 改一个常量。value 非有限数 → 视为恢复默认（等价于清除覆盖）。 */
    setConst: function (key, value) {
      loadState();
      if (!CINDEX[key]) return { ok: false, reason: '没有这个常量：' + key };
      var v = parseFloat(value);
      var saved = Object.assign ? Object.assign({}, STATE.consts) : JSON.parse(JSON.stringify(STATE.consts));
      if (!isFinite(v) || Math.abs(v - CINDEX[key].def) < 1e-12) delete STATE.consts[key];
      else STATE.consts[key] = v;
      var res = persist();
      if (!res.ok) { STATE.consts = saved; return res; }
      res.status = isFinite(v) ? Formula.constStatus(key, v) : { ok: true, level: 'ok', text: '' };
      return res;
    },

    /** 恢复出厂：清空所有覆盖，active 归位到"默认"模板 */
    reset: function () {
      loadState();
      STATE.consts = {};
      STATE.active = null;
      return persist();
    },

    size: function () { loadState(); return sizeOf(snapshot()); },

    /** 版本列表：内置模板在前，用户版本按更新时间倒序 */
    list: function () {
      loadState();
      var out = [], i;
      for (i = 0; i < BUILTIN.length; i++) {
        var b = BUILTIN[i];
        out.push({
          id: b.id, name: b.name, desc: b.desc, builtin: true,
          consts: b.consts, count: Object.keys(b.consts).length,
          createdAt: '', updatedAt: '', active: STATE.active === b.id ||
            (STATE.active === null && b.id === 'tpl-default')
        });
      }
      var items = STATE.items.slice().sort(function (x, y) {
        return String(y.updatedAt || y.createdAt).localeCompare(String(x.updatedAt || x.createdAt));
      });
      for (i = 0; i < items.length; i++) {
        var it = items[i];
        out.push({
          id: it.id, name: it.name, desc: it.note, builtin: false,
          consts: it.consts, count: Object.keys(it.consts).length,
          createdAt: it.createdAt, updatedAt: it.updatedAt,
          active: STATE.active === it.id
        });
      }
      return out;
    },

    /**
     * 把当前覆盖存成一个版本。
     * @param {string} name
     * @param {object} opts { now:'ISO 字符串', note, id }
     *   **now 必须由调用方给**：本模块不取当前时间（见文件头「纯度」）。
     */
    save: function (name, opts) {
      loadState();
      opts = opts || {};
      if (!opts.now) {
        throw ferr('缺少 now 参数：本模块不取当前时间，请由调用方传入（ISO 字符串）', 'no-now');
      }
      var now = String(opts.now);
      var nm = String(name || '').trim();
      if (!nm) return { ok: false, reason: '版本名不能为空' };
      if (nm.length > 40) return { ok: false, reason: '版本名最多 40 个字' };

      var cons = {};
      for (var k in STATE.consts) {
        if (Object.prototype.hasOwnProperty.call(STATE.consts, k)) cons[k] = STATE.consts[k];
      }
      if (!Object.keys(cons).length) {
        return { ok: false, code: 'EMPTY', reason: '还没有改过任何常量，存下来会和「默认」一模一样' };
      }

      var id = opts.id || ('fx-' + Math.abs(hash32(nm + now)).toString(36));
      var existing = null, i;
      for (i = 0; i < STATE.items.length; i++) {
        if (STATE.items[i].id === id) existing = STATE.items[i];
      }
      if (!existing) {
        for (i = 0; i < STATE.items.length; i++) {
          if (STATE.items[i].name === nm) existing = STATE.items[i];
        }
      }

      var prev = JSON.stringify(snapshot());
      if (existing) {
        existing.name = nm;
        existing.consts = cons;
        existing.note = String(opts.note || existing.note || '');
        existing.updatedAt = now;
        id = existing.id;
      } else {
        STATE.items.push({
          id: id, name: nm, consts: cons, exprs: {},
          note: String(opts.note || ''), createdAt: now, updatedAt: now
        });
      }
      STATE.active = id;

      var res = persist();
      if (!res.ok) {
        /* 回滚：不留下"看起来存了、其实没落盘"的状态 */
        var back = JSON.parse(prev);
        STATE.active = back.active; STATE.consts = back.consts; STATE.items = back.items;
        return res;
      }
      res.id = id;
      return res;
    },

    /** 应用一个版本（内置模板也行） */
    apply: function (id) {
      loadState();
      var i;
      for (i = 0; i < BUILTIN.length; i++) {
        if (BUILTIN[i].id !== id) continue;
        STATE.active = id;
        STATE.consts = JSON.parse(JSON.stringify(BUILTIN[i].consts));
        return persist();
      }
      for (i = 0; i < STATE.items.length; i++) {
        if (STATE.items[i].id !== id) continue;
        STATE.active = id;
        STATE.consts = JSON.parse(JSON.stringify(STATE.items[i].consts));
        return persist();
      }
      return { ok: false, reason: '没有这个版本：' + id };
    },

    /** 删除用户版本（内置模板拒绝） */
    del: function (id) {
      loadState();
      var i;
      for (i = 0; i < BUILTIN.length; i++) {
        if (BUILTIN[i].id === id) return { ok: false, reason: '内置模板不能删' };
      }
      for (i = 0; i < STATE.items.length; i++) {
        if (STATE.items[i].id !== id) continue;
        var name = STATE.items[i].name;
        STATE.items.splice(i, 1);
        if (STATE.active === id) STATE.active = null;
        var res = persist();
        res.name = name;
        return res;
      }
      return { ok: false, reason: '没有这个版本：' + id };
    },

    /** 取一个版本的完整配置（分享用） */
    get: function (id) {
      loadState();
      var i;
      for (i = 0; i < BUILTIN.length; i++) {
        if (BUILTIN[i].id === id) {
          return { id: id, name: BUILTIN[i].name, consts: BUILTIN[i].consts,
                   note: BUILTIN[i].desc, createdAt: '', exprs: {}, builtin: true };
        }
      }
      for (i = 0; i < STATE.items.length; i++) {
        if (STATE.items[i].id === id) return JSON.parse(JSON.stringify(STATE.items[i]));
      }
      return null;
    },

    /** 测试/导入用：直接把整块状态塞进来（会先跑 normalize） */
    load: function (raw) {
      var s = normalizeState(raw);
      STATE.loaded = true;
      STATE.active = s.active;
      STATE.consts = s.consts;
      STATE.items = s.items;
      return snapshot();
    }
  };

  function hash32(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h | 0;
  }

  /* ==========================================================================
   * §8 分享码 BF1. —— 为什么不复用 BL1.（再强调一次，见文件头）
   * ----------------------------------------------------------------------
   * BL1 的载荷没有类型字段，老客户端把它当配方写进配方库 = 静默覆盖用户配方。
   * BF1. 在老客户端里会直接报"不是分享码"，失败方式安全。
   * 结构：BF1.<crc16 4 位十六进制>.<base64url(JSON)>
   *
   * 载荷：{ app:'BrewLab', schema:2, type:'formula', v:1,
   *         name, createdAt, consts:{}, exprs:{} }
   *   · **只放常量数值与表达式字符串**，不放任何可执行内容
   *   · 表达式导入时**不自动启用**：先过语法校验，再由 UI 列出"要改什么"
   *     让用户确认后才生效（parseShare 只返回 changes，不写状态）
   *   · createdAt 由调用方给（本模块不取当前时间）
   * ======================================================================*/

  var F_PREFIX = 'BF1';
  var F_PAYLOAD_MAX = 20000;

  function utf8EncodeLocal(str) {
    var out = [], i, c, c2, cp;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                   0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
        } else {
          out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
      } else if (c >= 0xD800 && c <= 0xDFFF) {
        throw ferr('文本里有不完整的代理对，无法编码', 'utf8');
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function utf8DecodeLocal(bytes) {
    var s = '', i = 0, b, cp;
    while (i < bytes.length) {
      b = bytes[i++];
      if (b < 0x80) s += String.fromCharCode(b);
      else if (b >= 0xC0 && b < 0xE0) {
        if (i + 1 > bytes.length) throw ferr('内容不完整（UTF-8 被截断）', 'utf8');
        s += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
      } else if (b >= 0xE0 && b < 0xF0) {
        if (i + 2 > bytes.length) throw ferr('内容不完整（UTF-8 被截断）', 'utf8');
        s += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      } else if (b >= 0xF0) {
        if (i + 3 > bytes.length) throw ferr('内容不完整（UTF-8 被截断）', 'utf8');
        cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) |
             ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        cp -= 0x10000;
        s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023));
      } else throw ferr('内容损坏（非法 UTF-8 字节 ' + b + '）', 'utf8');
    }
    return s;
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function b64uEncodeLocal(bytes) {
    var out = '', i, b0, b1, b2;
    for (i = 0; i < bytes.length; i += 3) {
      b0 = bytes[i]; b1 = bytes[i + 1]; b2 = bytes[i + 2];
      out += B64.charAt(b0 >> 2);
      out += B64.charAt(((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4));
      if (b1 === undefined) break;
      out += B64.charAt(((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6));
      if (b2 === undefined) break;
      out += B64.charAt(b2 & 63);
    }
    return out;
  }

  function b64uDecodeLocal(str) {
    var out = [], i, buf = 0, bits = 0;
    for (i = 0; i < str.length; i++) {
      var idx = B64.indexOf(str.charAt(i));
      if (idx < 0) throw ferr('内容损坏（含非法字符「' + str.charAt(i) + '」）', 'b64');
      buf = (buf << 6) | idx;
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xFF); }
    }
    return out;
  }

  function crc16Local(str) {
    var crc = 0xFFFF, i, j;
    for (i = 0; i < str.length; i++) {
      crc ^= (str.charCodeAt(i) & 0xFF) << 8;
      for (j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
      }
    }
    return crc;
  }

  /* ----------------------------------------------------------------------
   * 编码原语的取用层：优先用 28 导出的那一份，拿不到才用本文件的兜底
   * ----------------------------------------------------------------------
   * 为什么要有这一层（而不是干脆用 28 的、或者干脆留自己那份）：
   *   两份 CRC 各自都能过测试，却可能在边界（空串、代理对、末尾字符）
   *   上给出不同结果 —— 那时 BL1 与 BF1 会互相读不了，而且**错得无声无息**。
   *   这个项目已经因为"同一件事两处实现"翻过两次车，不能再加一处。
   *
   * 为什么还必须留兜底（这不是偷懒，是三条真实路径）：
   *   ① 43a 单独被加载（node 套件只验计算链时，28 不一定在）；
   *   ② 28 被"降级拒绝加载"挡掉（数据来自更新版本时 Store 会拒写，
   *      但更直接的是：任何一份 js 加载失败，后面的文件仍然会继续跑）；
   *   ③ 加载顺序 —— index.html 里 28 在 43a 之前，但把 43a 单独拿去用、
   *      或将来调整顺序，都不该让公式码直接失效。
   *   所以取用是**每次调用时现查**的（惰性），不是模块初始化时抓一次快照：
   *   快照会让"28 晚一步加载"变成永久降级，而没人会注意到。
   *
   * 两条路径的等价性不靠"我保证"，靠 tools/test-formula.js 里那组向量对账
   * （'123456789' → 0x29B1 / 空串 / 含中文与代理对的多字节串）。
   * -------------------------------------------------------------------- */
  var PRIM_NAMES = ['crc16', 'utf8Encode', 'utf8Decode', 'b64uEncode', 'b64uDecode'];

  /** 取 28 的同名原语；没有就返回 null（调用点各自回落） */
  function prim(name) {
    var S = BREW.ShareCode;
    var p = S && S.primitives;
    if (!p) return null;
    var f = p[name];
    return (typeof f === 'function') ? f : null;
  }

  /** 当前用的是哪一份（给测试与自检看，别在生产逻辑里依赖它） */
  Formula.primitiveSource = function () {
    return prim('crc16') ? 'ShareCode.primitives' : 'local';
  };

  function utf8Encode(str) {
    var f = prim('utf8Encode');
    return f ? f(str) : utf8EncodeLocal(str);
  }
  function utf8Decode(bytes) {
    var f = prim('utf8Decode');
    return f ? f(bytes) : utf8DecodeLocal(bytes);
  }
  function b64uEncode(bytes) {
    var f = prim('b64uEncode');
    return f ? f(bytes) : b64uEncodeLocal(bytes);
  }
  function b64uDecode(str) {
    var f = prim('b64uDecode');
    return f ? f(str) : b64uDecodeLocal(str);
  }
  function crc16(str) {
    var f = prim('crc16');
    return f ? f(str) : crc16Local(str);
  }

  function crcHex(str) {
    var h = crc16(str).toString(16);
    while (h.length < 4) h = '0' + h;
    return h;
  }

  /** 只放常量数值与表达式串；未知常量一律剔除（不认识的键绝不进载荷） */
  function compactProfile(profile) {
    var o = {
      app: 'BrewLab',
      schema: 2,
      type: 'formula',
      v: 1,
      name: String((profile && profile.name) || '未命名公式版本'),
      createdAt: String((profile && profile.createdAt) || ''),
      consts: sanitizeConsts(profile && profile.consts)
    };
    if (profile && profile.note) o.note = String(profile.note).slice(0, 200);
    var ex = {};
    if (profile && profile.exprs && typeof profile.exprs === 'object') {
      for (var k in profile.exprs) {
        if (!Object.prototype.hasOwnProperty.call(profile.exprs, k)) continue;
        if (!CINDEX[k] && !REG_MAP[k]) continue;
        var s = String(profile.exprs[k]);
        if (s.length > MAX_EXPR) continue;
        ex[k] = s;
      }
      if (Object.keys(ex).length) o.exprs = ex;
    }
    return o;
  }

  var REG_MAP = {};
  (function () { for (var i = 0; i < REGISTRY.length; i++) REG_MAP[REGISTRY[i].key] = REGISTRY[i]; })();

  /**
   * 版本 → 分享码
   * @param {object} profile { name, createdAt, consts, exprs, note }
   * @returns {{text, chars, payload, bytes}}
   */
  Formula.encode = function (profile) {
    var o = compactProfile(profile);
    var json = JSON.stringify(o);
    var payload = b64uEncode(utf8Encode(json));
    if (payload.length > F_PAYLOAD_MAX) {
      throw ferr('这个版本太大（' + payload.length + ' 字符），不像是一份公式配置', 'too-large');
    }
    var text = F_PREFIX + '.' + crcHex(payload) + '.' + payload;
    return { text: text, chars: text.length, payload: payload, bytes: json.length };
  };

  /** 便捷：存好的版本 → 码 */
  Formula.share = function (id) {
    var p = OV.get(id);
    if (!p) return { ok: false, reason: '没有这个版本：' + id };
    var enc = Formula.encode(p);
    enc.ok = true;
    enc.name = p.name;
    return enc;
  };

  /** 只看前缀，不解析。用于"用户粘了一段码，先判断该走哪个导入流程" */
  Formula.detect = function (code) {
    var s = String(code === null || code === undefined ? '' : code).replace(/[\s\u3000]+/g, '');
    if (/^BF\d{1,2}\./i.test(s)) return 'formula';
    if (/^BL\d{1,2}\./i.test(s)) return 'recipe';
    return 'unknown';
  };

  /**
   * 分享码 → 配置（**不写状态、不自动应用**）
   * @returns {{ok:true, profile, changes:[]} | {ok:false, reason, code}}
   *   changes 是给用户确认用的："原麦汁苦度系数 1.65 → 1.815"
   */
  Formula.parseShare = function (code) {
    var s = String(code === null || code === undefined ? '' : code).replace(/[\s\u3000]+/g, '');
    if (!s) return { ok: false, code: 'empty', reason: '这段码是空的' };

    if (/^BL\d{1,2}\./i.test(s)) {
      return {
        ok: false, code: 'is-recipe',
        reason: '这是配方分享码，不是公式分享码。它要贴到「导入配方」里，' +
                '贴到公式面板不会生效（也正因为前缀不同，两边不会互相覆盖）。'
      };
    }
    var m = /^BF(\d{1,2})\.([0-9a-fA-F]{4})\.([A-Za-z0-9_-]+)$/.exec(s);
    if (!m) {
      return {
        ok: false, code: 'not-share-code',
        reason: '这不是公式分享码。公式码以 BF1. 开头，形如 BF1.1a2b.<一长串>'
      };
    }
    var ver = parseInt(m[1], 10);
    if (ver !== 1) {
      return { ok: false, code: 'bad-version',
               reason: '这个公式码的格式版本是 ' + ver + '，当前软件只认 BF1。请升级后再导入' };
    }
    var payload = m[3];
    if (payload.length > F_PAYLOAD_MAX) {
      return { ok: false, code: 'too-large', reason: '这段码太长（' + payload.length + ' 字符），不像公式码' };
    }
    if (crcHex(payload) !== m[2].toLowerCase()) {
      return { ok: false, code: 'crc',
               reason: '校验位不符：复制时可能少了字符，或者码被人改过。请让对方重新完整复制一次' };
    }

    var o;
    try {
      o = JSON.parse(utf8Decode(b64uDecode(payload)));
    } catch (e) {
      return { ok: false, code: 'bad-payload',
               reason: '码的中段解不开（' + ((e && e.message) || '解码失败') + '）。请重新复制' };
    }
    if (!o || typeof o !== 'object') {
      return { ok: false, code: 'bad-json', reason: '码里不是一份有效数据' };
    }
    if (o.type !== 'formula') {
      return { ok: false, code: 'bad-type',
               reason: '这段码里装的不是公式配置（type=' + String(o.type) + '）' };
    }
    if (o.schema !== undefined && Number(o.schema) > 2) {
      return { ok: false, code: 'bad-schema',
               reason: '这份配置来自更新版本的 BrewLab（schema ' + o.schema + '），当前版本读不了' };
    }
    if (o.v !== 1) {
      return { ok: false, code: 'bad-content', reason: '码的内容版本不符（期望 v=1）' };
    }

    var ignored = [], unknown = [];
    var cons = {};
    if (o.consts && typeof o.consts === 'object') {
      for (var k in o.consts) {
        if (!Object.prototype.hasOwnProperty.call(o.consts, k)) continue;
        var v = parseFloat(o.consts[k]);
        if (!CINDEX[k]) { unknown.push(k); continue; }
        if (!isFinite(v)) { ignored.push(k); continue; }
        cons[k] = v;
      }
    }

    /* 表达式：**先过语法校验**，不合法就整条拒收（不静默丢弃一条用户以为生效的公式） */
    var exprs = {};
    if (o.exprs && typeof o.exprs === 'object') {
      for (var ek in o.exprs) {
        if (!Object.prototype.hasOwnProperty.call(o.exprs, ek)) continue;
        if (!CINDEX[ek] && !REG_MAP[ek]) continue;
        var chk = Formula.checkSyntax(String(o.exprs[ek]));
        if (!chk.ok) {
          return { ok: false, code: 'bad-expr',
                   reason: '码里有一条公式的写法不合法（' + ek + '：' + chk.error + '），' +
                           '整份没有导入。这样做是为了不让半份配置生效' };
        }
        exprs[ek] = String(o.exprs[ek]);
      }
    }

    return {
      ok: true,
      profile: {
        name: String(o.name || '导入的公式版本'),
        createdAt: String(o.createdAt || ''),
        note: String(o.note || ''),
        consts: cons,
        exprs: exprs
      },
      changes: describeChanges(cons),
      ignored: ignored,
      unknown: unknown
    };
  };

  /** 常量差量 → 人话变更清单（导入前给用户看，看完才允许生效） */
  function describeChanges(cons) {
    var out = [];
    for (var k in cons) {
      if (!Object.prototype.hasOwnProperty.call(cons, k)) continue;
      var d = CINDEX[k];
      if (!d) continue;
      var from = cval(k, null), to = cons[k];
      var st = Formula.constStatus(k, to);
      out.push({
        key: k, name: d.name, unit: d.unit,
        from: from, to: to,
        fromText: show(from, 'num') + (d.unit && d.unit !== '—' ? ' ' + d.unit : ''),
        toText: show(to, 'num') + (d.unit && d.unit !== '—' ? ' ' + d.unit : ''),
        outOfRange: !st.ok, warn: st.text,
        affects: (d.affects || []).slice(0, 6).map(function (key) {
          var e = REG_MAP[key];
          return e ? e.name : key;
        })
      });
    }
    out.sort(function (x, y) { return x.name.localeCompare(y.name, 'zh'); });
    return out;
  }
  Formula.describeChanges = describeChanges;

  /* 供测试读的内部件（不是公开 API，改它们不算破坏契约） */
  Formula.__internals = {
    crcHex: crcHex,
    crc16: crc16,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    b64uEncode: b64uEncode,
    b64uDecode: b64uDecode,
    /* 兜底实现单独暴露：测试要拿"优先路径 vs 兜底路径"逐向量对账。
       这两个名字不是公开 API，只给 tools/test-formula.js 用。 */
    local: {
      crc16: crc16Local,
      utf8Encode: utf8EncodeLocal,
      utf8Decode: utf8DecodeLocal,
      b64uEncode: b64uEncodeLocal,
      b64uDecode: b64uDecodeLocal
    },
    primNames: PRIM_NAMES,
    tokenize: tokenize,
    toRPN: toRPN,
    parseExpr: parseExpr,
    substitute: substitute,
    normalizeState: normalizeState,
    compactProfile: compactProfile,
    state: function () { loadState(); return snapshot(); },
    resetState: function () { STATE.loaded = false; STATE.active = null; STATE.consts = {}; STATE.items = []; }
  };

  /* ==========================================================================
   * §8b UI —— 三页签模态（公式一览 / 常量 / 我的版本）
   * ----------------------------------------------------------------------
   * 三条界面规矩，都是被这个项目的既往 bug 逼出来的：
   *   ① 两列并排，**内核值不许被静默替换**。用户改错常量时要能一眼看出
   *      "你的公式值"偏离了内核值多少。只有一列的话，界面会替用户把错误藏起来。
   *   ② 常量改了就立刻重算，但**只管当前这个输入框所在的行**：
   *      整表重绘会丢焦点与光标，用户敲 "1.815" 会变成 "1.85"（中间那次重绘
   *      把 "1." 吃掉了）。这是本文件唯一一处刻意不做整页刷新的地方。
   *   ③ 分享码导入**先列清单再生效**。载荷里带的是表达式字符串，虽然只过我们
   *      自己的求值器，但"粘贴一段码就悄悄改了你的算法"仍然是不能接受的默认。
   * ======================================================================*/

  var UIx = Formula.UI = {};
  var S = {
    tab: 'list',
    onlyEdited: false,
    open: {},          /* 展开状态 { entryKey: true } —— 重绘后要恢复 */
    share: null,       /* { id, name, code } */
    lastConst: null    /* 上一次改的常量，用于"改这个影响什么" */
  };

  function esc0(s) {
    var u = BREW.UI && BREW.UI.esc;
    if (typeof u === 'function') return u(s);
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function attr0(s) { return esc0(s); }
  function ico(name, size) {
    return (BREW.UI && BREW.UI.icon) ? BREW.UI.icon(name, size) : '';
  }
  function toast(msg, kind, ms) {
    if (BREW.UI && BREW.UI.Shell && BREW.UI.Shell.toast) BREW.UI.Shell.toast(msg, kind, ms || 3000);
    else if (root.console) console.warn('[Formula]', msg);
  }
  function recipeNow() {
    try { return (BREW.UI && BREW.UI.recipe) ? BREW.UI.recipe() : {}; }
    catch (e) { return {}; }
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* 全模块**唯一**读时钟的地方，只在 UI 层，且只在"人点了保存/分享"时调用。
     核心（REGISTRY / evaluate / 分享码）一律由调用方传 now，保持纯函数、可复现。
     写成 root.Date 而不是 Date，是为了让"核心不取当前时间"这条能被 grep 验住。 */
  function nowIso() {
    var d = new root.Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      '.' + String(d.getMilliseconds() + 1000).slice(1);
  }

  function fmtVal(key, v) {
    var nm = NAMES[key];
    return show(v, nm ? nm.disp : 'num');
  }
  function unitOfKey(key) {
    var nm = NAMES[key];
    return (nm && nm.unit && nm.unit !== '—') ? nm.unit : '';
  }

  function activeName() {
    var id = STATE.active;
    if (!id) return '默认（与内核一致）';
    for (var i = 0; i < BUILTIN.length; i++) if (BUILTIN[i].id === id) return BUILTIN[i].name;
    for (var j = 0; j < STATE.items.length; j++) if (STATE.items[j].id === id) return STATE.items[j].name;
    return '默认（与内核一致）';
  }
  function activeId() {
    loadState();
    return STATE.active || 'tpl-default';
  }

  /* ------------------------------- 一览 ------------------------------- */

  function rowsTableHtml(it) {
    var rt = it.rowsTable;
    if (!rt) return '';
    var head = '<tr><th>原料</th>' + rt.cols.map(function (c) {
      return '<th class="u-right">' + esc0(c.name) +
        (c.unit && c.unit !== '—' ? '<small>' + esc0(c.unit) + '</small>' : '') + '</th>';
    }).join('') + '<th class="u-right">本行 ' + esc0(it.name) + '</th></tr>';

    var body = rt.rows.map(function (r) {
      return '<tr><td class="fx-rowname">' + esc0(r.label) + '</td>' +
        r.cells.map(function (t) { return '<td class="u-right fx-num">' + esc0(t) + '</td>'; }).join('') +
        '<td class="u-right fx-num fx-strong">' + esc0(r.valueText) + '</td></tr>';
    }).join('');

    return '<div class="fx-block"><div class="fx-block__t">逐行明细（每行各算一次，再加起来）</div>' +
      '<table class="fx-params fx-rowtable"><thead>' + head + '</thead><tbody>' + body + '</tbody>' +
      '<tfoot><tr><td colspan="' + (rt.cols.length + 1) + '">合计</td>' +
      '<td class="u-right fx-num fx-strong">' + esc0(rt.totalText) + '</td></tr></tfoot>' +
      '</table></div>';
  }

  function renderEntry(it) {
    var k = it.kernel.value, m = it.mine.value;
    var diff = (k !== null && m !== null && Math.abs(k - m) > 1e-9);
    var cls = 'fx-entry' + (it.edited ? ' is-edited' : '') +
      (diff ? ' is-diff' : '') + (S.open[it.key] ? ' is-open' : '');
    var openAttr = S.open[it.key] ? ' open' : '';

    var kTxt = (it.cmp === 'none') ? '—' : (k === null ? '—' : fmtVal(it.key, k));
    var mTxt = (m === null) ? '—' : fmtVal(it.key, m);

    var body =
      '<code class="fx-sub">' + esc0(it.substituted) + '</code>' +
      (it.mine.error ? '<p class="fx-err">' + esc0(it.mine.error) + '</p>' : '') +
      rowsTableHtml(it) +
      '<div class="fx-block"><div class="fx-block__t">参与计算的参数</div>' +
        '<table class="fx-params"><thead><tr>' +
          '<th>名称</th><th>符号</th><th class="u-right">当前值</th><th>单位</th>' +
        '</tr></thead><tbody>' +
          it.params.map(function (p) {
            return '<tr><td>' + esc0(p.name) + '</td>' +
              '<td><code>' + esc0(p.k) + '</code>' +
              (p.kind === 'agg' ? '<span class="fx-tag">Σ</span>' : '') +
              (p.kind === 'row' ? '<span class="fx-tag">逐行</span>' : '') +
              '</td>' +
              '<td class="u-right fx-num">' + esc0(p.text) + '</td>' +
              '<td class="fx-unit">' + esc0(p.unit === '—' ? '' : p.unit) + '</td></tr>';
          }).join('') +
        '</tbody></table></div>' +
      (it.consts.length ?
        '<div class="fx-block"><div class="fx-block__t">用到的常量</div>' +
          '<div class="fx-chips">' + it.consts.map(function (c) {
            return '<span class="fx-chip' + (c.changed ? ' is-changed' : '') + '" title="' +
              attr0(c.name) + '">' + esc0(c.name) + ' <b>' + esc0(show(c.value, 'num')) + '</b>' +
              (c.changed ? '<i>默认 ' + esc0(show(c.def, 'num')) + '</i>' : '') + '</span>';
          }).join('') + '</div></div>' : '') +
      '<p class="fx-src"><b>出处</b>' + esc0(it.source) + '</p>' +
      '<p class="fx-note"><b>为什么这么算</b>' + esc0(it.note) + '</p>';

    return '<details class="' + cls + '" data-fx-key="' + attr0(it.key) + '"' + openAttr + '>' +
      '<summary class="fx-entry__head">' +
        '<span class="fx-entry__name">' + esc0(it.name) +
          (it.edited ? '<span class="fx-badge">已改</span>' : '') +
          (diff ? '<span class="fx-badge fx-badge--bad">偏离内核</span>' : '') +
        '</span>' +
        '<span class="fx-entry__vals">' +
          '<span class="fx-v fx-v--k"><i>内核</i>' + esc0(kTxt) + '</span>' +
          '<span class="fx-v fx-v--m"><i>你的公式</i>' + esc0(mTxt) + '</span>' +
          '<span class="fx-entry__unit">' + esc0(unitOfKey(it.key)) + '</span>' +
        '</span>' +
      '</summary>' +
      '<div class="fx-entry__body">' + body + '</div>' +
    '</details>';
  }

  function paneList() {
    var out = Formula.evaluate(recipeNow(), { consts: OV.consts() });
    var editedN = 0, diffN = 0;
    out.forEach(function (x) { if (x.edited) editedN++; if (x.status === 'diff') diffN++; });

    var head = '<div class="fx-toolbar">' +
      '<label class="fx-check"><input type="checkbox" data-fx-only="1"' +
        (S.onlyEdited ? ' checked' : '') + '> 只看我改过的</label>' +
      '<span class="fx-hint">' + out.length + ' 条公式 · 已改 ' + editedN + ' 条' +
        (diffN ? ' · <b class="fx-bad">' + diffN + ' 条偏离内核</b>' : '') +
        ' · 当前版本：' + esc0(activeName()) + '</span>' +
      '</div>';

    var groups = [], order = [];
    out.forEach(function (it) {
      if (S.onlyEdited && !it.edited) return;
      if (order.indexOf(it.group) < 0) { order.push(it.group); groups.push({ g: it.group, list: [] }); }
    });
    out.forEach(function (it) {
      if (S.onlyEdited && !it.edited) return;
      for (var i = 0; i < groups.length; i++) if (groups[i].g === it.group) groups[i].list.push(it);
    });

    if (!groups.length) {
      return head + '<p class="fx-empty">这个配方上没有一条公式被你改过。' +
        '「只看我改过的」是筛选，不是统计——把勾去掉就能看到全部 ' + out.length + ' 条。</p>';
    }

    var html = head;
    groups.forEach(function (grp) {
      html += '<div class="fx-group"><div class="fx-group__t">' + esc0(grp.g) +
        '<span>' + grp.list.length + '</span></div>' + grp.list.map(renderEntry).join('') + '</div>';
    });
    return html;
  }

  /* ------------------------------- 常量 ------------------------------- */

  function constRowsHtml() {
    var cur = OV.consts();
    var rows = CONSTANTS.map(function (c) {
      var has = Object.prototype.hasOwnProperty.call(cur, c.key);
      var v = has ? cur[c.key] : c.value;
      var st = Formula.constStatus(c.key, v);
      var affN = c.affects.length;
      return '<tr data-fx-crow="' + attr0(c.key) + '"' + (st.ok ? '' : ' class="is-bad"') + '>' +
        '<td class="fx-cname">' + esc0(c.name) +
          /* 徽章**始终渲染**、用 class 控制显隐：改回默认值时只切 class，
             不必整表重绘 —— 整表重绘会抢走输入框焦点（见文件内 §8b 规矩②） */
          '<span class="fx-badge fx-badge--edit' + (has ? '' : ' is-hidden') + '">已改</span>' +
          '<div class="fx-cdoc" title="' + attr0(c.doc) + '">' + esc0(c.doc) + '</div></td>' +
        '<td class="fx-cval"><input class="input fx-input" type="number" step="any" ' +
          'data-fx-const="' + attr0(c.key) + '" value="' + attr0(v) + '" ' +
          'aria-label="' + attr0(c.name) + '"></td>' +
        '<td class="fx-unit">' + esc0(c.unit === '—' ? '' : c.unit) + '</td>' +
        '<td class="fx-cdef">' + esc0(show(c.def, 'num')) + '</td>' +
        '<td class="fx-crange">' + esc0(String(c.min)) + '–' + esc0(String(c.max)) + '</td>' +
        '<td class="fx-caff">' + (affN ? affN + ' 项' : '—') + '</td>' +
      '</tr>';
    }).join('');

    return '<table class="fx-table"><thead><tr>' +
      '<th>常量</th><th>当前值</th><th>单位</th><th class="u-right">默认</th>' +
      '<th class="u-right">经验区间</th><th class="u-right">影响</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function impactHtml() {
    if (!S.lastConst) {
      return '<p class="fx-dim">改一个常量，这里会立刻算出它影响最大的几个量。' +
        '越界不会阻止保存，但会标红并说明后果——拦下来只会逼用户去别处绕过它。</p>';
    }
    var c = CINDEX[S.lastConst.key];
    var cur = OV.consts();
    var val = Object.prototype.hasOwnProperty.call(cur, S.lastConst.key)
      ? cur[S.lastConst.key] : c.value;
    var st = Formula.constStatus(S.lastConst.key, val);
    var list = Formula.affected(recipeNow(), S.lastConst.key, val, { consts: withoutKey(cur, S.lastConst.key), limit: 3 });

    var h = '<div class="fx-impact__head">改「' + esc0(c.name) + '」→ ' +
      esc0(show(val, 'num')) + (c.unit !== '—' ? ' ' + esc0(c.unit) : '') + '</div>';
    if (!st.ok) h += '<p class="fx-bad">' + esc0(st.text) + '</p>';
    if (!list.length) {
      h += '<p class="fx-dim">这个值在当前配方上没有改变任何量（可能是被夹住了，或配方没用到它的分支）。</p>';
    } else {
      h += '<ul class="fx-impact__list">' + list.map(function (a) {
        return '<li><span>' + esc0(a.name) + '</span>' +
          '<b>' + esc0(a.fromText) + '</b><i>→</i><b class="fx-strong">' + esc0(a.toText) + '</b></li>';
      }).join('') + '</ul>';
    }
    return h;
  }

  function withoutKey(obj, key) {
    var o = {};
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (k === key) continue;
      o[k] = obj[k];
    }
    return o;
  }

  function paneConsts() {
    return '<div class="fx-impact" id="fx-impact">' + impactHtml() + '</div>' +
      '<div class="fx-constwrap">' + constRowsHtml() + '</div>' +
      '<p class="fx-foot">' +
        '这些是公式里的数值系数，不是配方参数——改它们等于换一套计算口径，' +
        '50 条经典配方的落点会跟着动。改完记得在「我的版本」里存一份，' +
        '否则下次打开就回到默认了。' +
      '</p>';
  }

  /* ------------------------------ 我的版本 ----------------------------- */

  function paneMine() {
    var list = OV.list();
    var rows = list.map(function (v) {
      var when = v.updatedAt || v.createdAt;
      return '<div class="fx-ver' + (v.active ? ' is-active' : '') + '" data-fx-ver="' + attr0(v.id) + '">' +
        '<div class="fx-ver__main">' +
          '<div class="fx-ver__name">' + esc0(v.name) +
            (v.builtin ? '<span class="fx-tag">内置</span>' : '') +
            (v.active ? '<span class="fx-badge">正在用</span>' : '') +
          '</div>' +
          '<div class="fx-ver__meta">' + v.count + ' 个常量被改' +
            (when ? ' · ' + esc0(String(when).replace('T', ' ').slice(0, 16)) : '') +
            (v.desc ? ' · ' + esc0(String(v.desc).slice(0, 60)) : '') +
          '</div>' +
        '</div>' +
        '<div class="fx-ver__acts">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-fx-act="apply" data-fx-id="' +
            attr0(v.id) + '">应用</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-fx-act="share" data-fx-id="' +
            attr0(v.id) + '">生成码</button>' +
          (v.builtin ? '' :
            '<button type="button" class="btn btn-quiet btn-icon" data-fx-act="del" data-fx-id="' +
              attr0(v.id) + '" aria-label="删除 ' + attr0(v.name) + '">' + ico('trash', 14) + '</button>') +
        '</div>' +
      '</div>';
    }).join('');

    var shareBox = '';
    if (S.share) {
      shareBox = '<div class="fx-share">' +
        '<div class="fx-block__t">「' + esc0(S.share.name) + '」的公式码（' + S.share.code.length + ' 字符）</div>' +
        '<textarea class="textarea fx-code" rows="3" readonly data-fx-code>' +
          esc0(S.share.code) + '</textarea>' +
        '<div class="fx-row">' +
          '<button type="button" class="btn btn-primary btn-sm" data-fx-act="copy">' + ico('copy', 13) + '复制</button>' +
          '<span class="fx-dim">前缀是 BF1.，不是配方的 BL1.。贴到旧版会提示"不是分享码"，' +
            '不会把你的配方覆盖掉。</span>' +
        '</div></div>';
    }

    return '<div class="fx-vers">' + rows + '</div>' +
      '<div class="fx-save">' +
        '<div class="fx-block__t">把当前常量存成一个版本</div>' +
        '<div class="fx-row">' +
          '<input class="input fx-input" type="text" maxlength="40" data-fx-name ' +
            'placeholder="例如：我的设备（IBU 偏高 10%）" value="' + attr0(S.name) + '">' +
          '<button type="button" class="btn btn-primary btn-sm" data-fx-act="save">' +
            ico('save', 13) + '保存</button>' +
          '<span class="fx-dim">只存被改过的常量；占用 ' + OV.size() + ' / ' + OV.LIMIT + ' 字符</span>' +
        '</div>' +
      '</div>' + shareBox +
      '<div class="fx-save">' +
        '<div class="fx-block__t">导入别人的公式码</div>' +
        '<textarea class="textarea fx-code" rows="2" data-fx-import ' +
          'placeholder="粘贴 BF1. 开头的公式码。导入前会先列出它要改什么，确认后才生效。"></textarea>' +
        '<div class="fx-row">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-fx-act="import">校验并预览</button>' +
          '<span class="fx-dim">表达式只做语法校验，不会自动执行任何东西。</span>' +
        '</div>' +
      '</div>';
  }

  /* -------------------------------- 骨架 -------------------------------- */

  function tabBtn(id, label) {
    return '<button type="button" class="tab' + (S.tab === id ? ' is-on' : '') + '" role="tab" ' +
      'aria-selected="' + (S.tab === id) + '" data-fx-tab="' + id + '">' + esc0(label) + '</button>';
  }

  function paint(api) {
    var pane = api.query('[data-fx-pane]');
    if (!pane) return;
    pane.innerHTML = S.tab === 'consts' ? paneConsts()
      : (S.tab === 'mine' ? paneMine() : paneList());

    var tabs = api.queryAll('[data-fx-tab]');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-fx-tab') === S.tab;
      tabs[i].classList.toggle('is-on', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }

    /* 恢复展开状态：<details> 重绘会全部收起，用户刚点开的那条会自己合上 */
    var ds = pane.querySelectorAll('details[data-fx-key]');
    for (var j = 0; j < ds.length; j++) {
      if (S.open[ds[j].getAttribute('data-fx-key')]) ds[j].open = true;
    }
  }

  function refreshConst(api, key) {
    var cur = OV.consts();
    var c = CINDEX[key];
    var v = Object.prototype.hasOwnProperty.call(cur, key) ? cur[key] : c.value;
    var st = Formula.constStatus(key, v);

    var tr = api.query('[data-fx-crow="' + key + '"]');
    if (tr) tr.classList.toggle('is-bad', !st.ok);
    if (tr) {
      var bd = tr.querySelector('.fx-badge--edit');
      if (bd) bd.classList.toggle('is-hidden', !Object.prototype.hasOwnProperty.call(cur, key));
    }

    S.lastConst = { key: key };
    var box = api.query('#fx-impact');
    if (box) box.innerHTML = impactHtml();
  }

  function bind(api) {
    var body = api.body;

    body.addEventListener('click', function (e) {
      var tab = e.target.closest ? e.target.closest('[data-fx-tab]') : null;
      if (tab) { S.tab = tab.getAttribute('data-fx-tab'); paint(api); return; }

      var act = e.target.closest ? e.target.closest('[data-fx-act]') : null;
      if (!act) return;
      var id = act.getAttribute('data-fx-id');
      switch (act.getAttribute('data-fx-act')) {
        case 'apply': onApply(api, id); break;
        case 'del': onDelete(api, id); break;
        case 'share': onShare(api, id); break;
        case 'save': onSave(api); break;
        case 'copy': onCopy(); break;
        case 'import': onImport(api); break;
        default: break;
      }
    });

    body.addEventListener('input', function (e) {
      var t = e.target;

      if (t.getAttribute && t.getAttribute('data-fx-only') !== null) {
        S.onlyEdited = !!t.checked;
        paint(api);
        return;
      }
      if (t.getAttribute && t.getAttribute('data-fx-name') !== null) {
        S.name = t.value;
        return;
      }
      var ck = t.getAttribute ? t.getAttribute('data-fx-const') : null;
      if (!ck) return;
      var raw = parseFloat(t.value);
      if (!isFinite(raw)) return;              /* 敲到一半（"-"、""）不动状态 */
      var res = OV.setConst(ck, raw);
      if (!res.ok) { toast(res.reason, 'warn', 5200); return; }
      refreshConst(api, ck);
    });

    /* 展开状态记下来，重绘后恢复 */
    body.addEventListener('toggle', function (e) {
      var d = e.target;
      if (d && d.getAttribute && d.getAttribute('data-fx-key')) {
        S.open[d.getAttribute('data-fx-key')] = !!d.open;
      }
    }, true);
  }

  function onApply(api, id) {
    var res = OV.apply(id);
    if (!res.ok) { toast(res.reason, 'warn'); return; }
    toast('已应用「' + activeName() + '」', 'ok');
    paint(api);
  }

  function onDelete(api, id) {
    var res0 = OV.get(id);
    var name = res0 ? res0.name : id;
    BREW.UI.Shell.confirm({
      title: '删除这个版本？',
      message: '「' + name + '」会被删掉，常量覆盖同时失效（回到默认）。',
      detail: '配方数据不受影响。',
      danger: true,
      okLabel: '删除'
    }, function () {
      var res = OV.del(id);
      if (!res.ok) { toast(res.reason, 'warn'); return; }
      if (S.share && S.share.id === id) S.share = null;
      toast('已删除「' + (res.name || name) + '」', 'ok');
      paint(api);
    });
  }

  function onShare(api, id) {
    var res = Formula.share(id);
    if (!res.ok) { toast(res.reason, 'warn'); return; }
    S.share = { id: id, name: res.name, code: res.text };
    if (S.tab !== 'mine') S.tab = 'mine';
    paint(api);
  }

  function onSave(api) {
    var nm = S.name || '';
    if (!nm.trim()) {
      toast('先给这个版本起个名字（例如"我的设备"）', 'warn');
      var inp = api.query('[data-fx-name]');
      if (inp && inp.focus) inp.focus();
      return;
    }
    var res;
    try {
      res = OV.save(nm, { now: nowIso() });
    } catch (e) {
      toast(e.message, 'bad', 4200);
      return;
    }
    if (!res.ok) { toast(res.reason, 'warn', 5200); return; }
    toast('已存为「' + nm.trim() + '」', 'ok');
    paint(api);
  }

  function onCopy() {
    if (!S.share) return;
    copyText(S.share.code, function (okCopy) {
      toast(okCopy ? '公式码已复制' : '复制被浏览器拦下了，请手动选中文本框里的码复制',
        okCopy ? 'ok' : 'warn', 3600);
    });
  }

  /* 复制：file:// 下 navigator.clipboard 属于不安全上下文，Chrome 会直接拒绝，
     所以必须有 execCommand 的退路（与 41-ui-share 的做法一致） */
  function copyText(text, done) {
    function legacy() {
      var ta = root.document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      root.document.body.appendChild(ta);
      var ok = false;
      try {
        ta.select();
        ta.setSelectionRange(0, text.length);
        ok = root.document.execCommand('copy');
      } catch (e) { ok = false; }
      if (ta.parentNode) ta.parentNode.removeChild(ta);
      done(ok);
    }
    var nav = root.navigator || {};
    if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      try {
        var p = nav.clipboard.writeText(text);
        if (p && typeof p.then === 'function') {
          p.then(function () { done(true); }, legacy);
          return;
        }
        done(true);
        return;
      } catch (e2) { /* 落到老接口 */ }
    }
    legacy();
  }

  function onImport(api) {
    var ta = api.query('[data-fx-import]');
    var text = ta ? ta.value : '';
    var res = Formula.parseShare(text);
    if (!res.ok) { toast(res.reason, 'warn', 6000); return; }

    var lines = res.changes.map(function (c) {
      return '<li><span>' + esc0(c.name) + '</span>' +
        '<b>' + esc0(c.fromText) + '</b><i>→</i>' +
        '<b class="fx-strong">' + esc0(c.toText) + '</b>' +
        (c.outOfRange ? '<em class="fx-bad">越界</em>' : '') +
        (c.affects.length ? '<small>会动到：' + esc0(c.affects.join('、')) + '</small>' : '') +
      '</li>';
    }).join('');

    if (!res.changes.length) {
      toast('这串码里没有要改的常量（可能和当前一致）', 'info', 4200);
      return;
    }

    BREW.UI.Shell.modal({
      title: '导入前先看一眼',
      sub: res.profile.name || '',
      size: 'narrow',
      body: '<p class="fx-dim">这串码要改 ' + res.changes.length + ' 个常量。' +
        '确认后会被存成一个新版本，随时能切回默认。</p>' +
        '<ul class="fx-impact__list">' + lines + '</ul>' +
        (res.unknown.length ?
          '<p class="fx-bad">有 ' + res.unknown.length + ' 个常量当前版本不认识，已忽略：' +
            esc0(res.unknown.join('、')) + '</p>' : ''),
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '应用并保存', kind: 'primary',
          act: function () {
            var applied = 0;
            for (var k in res.profile.consts) {
              if (!Object.prototype.hasOwnProperty.call(res.profile.consts, k)) continue;
              var r1 = OV.setConst(k, res.profile.consts[k]);
              if (r1.ok) applied++;
            }
            var nm = (res.profile.name || '导入的公式') + '';
            var saved;
            try {
              saved = OV.save(nm, { now: nowIso(), note: '从分享码导入（来源时间 ' +
                (res.profile.createdAt || '未标注') + '）' });
            } catch (e) { saved = { ok: false, reason: e.message }; }

            if (!saved.ok) {
              toast('常量已生效，但没存成版本：' + saved.reason, 'warn', 5600);
            } else {
              toast('已导入「' + nm + '」，共改 ' + applied + ' 个常量', 'ok', 4200);
            }
            if (ta) ta.value = '';
            paint(api);
          }
        }
      ]
    });
  }

  UIx.open = function () {
    if (!BREW.UI || !BREW.UI.Shell || typeof BREW.UI.Shell.modal !== 'function') {
      if (root.console) console.warn('[Formula] 界面层未加载，公式面板打不开');
      return null;
    }
    loadState();
    S.tab = 'list';
    S.onlyEdited = false;
    S.share = null;
    S.lastConst = null;

    return BREW.UI.Shell.modal({
      title: '公式编辑器',
      sub: '每个数字怎么算出来的 · 常量可调 · 存自己的版本 · 用 BF1. 码分享',
      size: 'wide',
      body: '<div class="fx">' +
        '<div class="tabs fx-tabs" role="tablist" aria-label="公式面板页签">' +
          tabBtn('list', '公式一览') + tabBtn('consts', '常量') + tabBtn('mine', '我的版本') +
        '</div>' +
        '<div class="fx-pane" data-fx-pane></div>' +
      '</div>',
      actions: [{ label: '关闭', kind: 'ghost' }],
      onMount: function (api) { bind(api); paint(api); }
    });
  };

  /* 工具台卡片（50-ui-tools）用这两条：图标名与一句话定位 */
  UIx.icon = 'beaker';
  UIx.ask = '这个 34.2 IBU 是怎么算出来的？我能不能改公式？';

  /* ==========================================================================
   * §9 自检（界面上的"引擎自检"按钮跑这个）
   * ----------------------------------------------------------------------
   * 结构上刻意做成**声明式表**（CHECK_LIST），而不是一串 T(...) 调用：
   *   · 一条 `T(...)` 抛异常会中断整个自检块，后面那些断言**压根不跑**，
   *     而函数照样返回 {pass: N}，看上去是绿的 —— 这种"绿"最危险。
   *     现在每条独立 try/catch，一条炸了只记它自己失败，其余照跑。
   *   · total 永远等于表的长度（结构决定），不存在"中途 return 导致少数"。
   *   · Formula.selfTest.expected 直接暴露表长，套件拿它和实际执行数对账。
   * ======================================================================*/

  var CHECK_LIST = [
    {
      name: '求值 1+2*3', want: 7,
      run: function () { return evalExpr('1 + 2 * 3', {}); }
    },
    {
      name: '2^3^2 右结合', want: 512,
      run: function () { return evalExpr('2^3^2', {}); }
    },
    {
      name: '−2^2 指数优先于一元负号', want: -4,
      run: function () { return evalExpr('-2^2', {}); }
    },
    {
      name: '除零返回 null', want: null,
      run: function () { return evalExpr('1/0', {}); }
    },
    {
      name: '函数 exp(0)', want: 1,
      run: function () { return evalExpr('exp(0)', {}); }
    },
    {
      name: '嵌套 min/max', want: 2,
      run: function () { return evalExpr('min(3, max(1, 2))', {}); }
    },
    {
      name: 'round 两位', want: 1.23,
      run: function () { return evalExpr('round(1.2345, 2)', {}); }
    },
    {
      name: '前缀识别 BF1', want: 'formula',
      run: function () { return Formula.detect('BF1.0000.abc'); }
    },
    {
      name: '前缀识别 BL1', want: 'recipe',
      run: function () { return Formula.detect('BL1.0000.abc'); }
    },
    {
      name: '前缀识别 乱码', want: 'unknown',
      run: function () { return Formula.detect('hello'); }
    },
    {
      name: 'CRC-16/CCITT-FALSE 标准向量', want: 0x29B1,
      run: function () { return crc16('123456789'); }
    },
    {
      name: 'NAMES 无重名（同 key 只有一个中文名）', want: 0,
      run: function () { return Formula.__nameClash.length; }
    },
    {
      /* 这条是给"初始化顺序 / 名字表有两份"这类 bug 用的：
         linkRegistry 跑完之后，每条都必须真的拿到了 name 与 params。 */
      name: 'REGISTRY 每条都有 name / unit / params', want: 0,
      run: function () {
        var bad = 0;
        for (var i = 0; i < REGISTRY.length; i++) {
          var e = REGISTRY[i];
          if (!e.name || !e.unit || !e.params || !e.params.length) bad++;
        }
        return bad;
      }
    },
    {
      name: 'BF1 编解码往返', want: true,
      run: function () {
        var enc = Formula.encode({ name: '自检', createdAt: '', consts: { tinseth_b: 1.8 } });
        var back = Formula.parseShare(enc.text);
        return back.ok === true && Math.abs(back.profile.consts.tinseth_b - 1.8) < 1e-12;
      }
    },
    {
      name: '空配方也能跑完 evaluate（不抛异常）', want: true,
      run: function () {
        var out = Formula.evaluate({}, { consts: {} });
        return out.length === REGISTRY.length;
      }
    }
  ];

  Formula.selfTest = function () {
    var cases = [], i;
    for (i = 0; i < CHECK_LIST.length; i++) {
      var c = CHECK_LIST[i], got = null, err = null;
      try {
        got = c.run();
      } catch (e) {
        err = (e && e.message) || String(e);
        got = null;
      }
      var okv;
      if (err) okv = false;
      else if (typeof c.want === 'number') okv = (typeof got === 'number') && Math.abs(got - c.want) <= 1e-9;
      else okv = (got === c.want);
      cases.push({ name: c.name, got: got, want: c.want, ok: okv, error: err });
    }
    var pass = 0;
    for (i = 0; i < cases.length; i++) if (cases[i].ok) pass++;
    return {
      total: cases.length,
      expected: CHECK_LIST.length,
      pass: pass,
      allOk: pass === cases.length,
      complete: cases.length === CHECK_LIST.length,
      cases: cases
    };
  };
  Formula.selfTest.expected = CHECK_LIST.length;

})(typeof window !== 'undefined' ? window : globalThis);
