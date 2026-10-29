/* ============================================================================
 * 风月酿研所 — 39a-field-rules.js
 * ----------------------------------------------------------------------------
 * 职责：**输入值的合理范围**，全站唯一一份。
 *
 * 为什么必须只有一份：
 *   同一个"糖化效率"，配方页有一个输入框、批次页有一个实测框、导出 JSON 里
 *   还有一个字段、图表轴上还有一个刻度。如果范围判断散在四处，
 *   迟早出现"框是红的、下面没提示"或者"框不红、计算却报警"——
 *   用户会以为软件在抽风，然后开始不信所有红色。
 *
 * 三档，不是两档：
 *   ok    正常
 *   soft  可能但异常 —— **琥珀色**，只提醒，照常计算、照常保存
 *   hard  物理上不可能 —— **红色**，说明原因，但**仍然允许保存**
 *
 * 为什么 hard 也不拦保存：
 *   家酿里"我要酿一个 45 IBU 的皮尔森"是合法意图，只是不像皮尔森。
 *   软件的职责是把"你这锅酒会变成什么样"说清楚，不是替人决定能不能酿。
 *   唯一例外是**会让后续计算变成 NaN 的值**（负数体积、0 批次量），
 *   那种由 20-calc 自己的守卫兜，不靠这里。
 *
 * 数据口径：下面所有区间的依据是 BJCP 风格区间 + 家酿设备常识 + 水化学教材
 *   的通行建议，**是经验值不是法律**。每条都带 why，是为了让用户看到红字时
 *   知道"凭什么红"，而不是被一个不解释的红框拦住。
 *
 * 依赖：无（纯函数，可在 node 里直接测）
 * 对外：BREW.FieldRules.get / test / relation / list
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};

  var FR = BREW.FieldRules = BREW.FieldRules || {};

  /* ---------------------------------------------------------------------
   * 规则表
   *   lo / hi        hard 边界（超出＝物理不可能）
   *   sLo / sHi      soft 边界（超出＝可能但异常）
   *   unit           显示用单位
   *   why            红/琥珀时给人看的一句话（必须能回答"凭什么"）
   *   hardMsg        可选：hard 时的专用说明（默认用 why）
   * -------------------------------------------------------------------*/
  var RULES = {

    /* ---- 批次与设备 ---- */
    batchSize: {
      label: '批次量', unit: 'L', lo: 1, hi: 200, sLo: 5, sHi: 60,
      why: '家酿常见 5–60L。小于 5L 时蒸发与热损失占比过大，效率会明显偏低；大于 60L 通常已不是家用设备'
    },
    efficiency: {
      label: '糖化效率', unit: '%', lo: 1, hi: 100, sLo: 55, sHi: 90,
      why: '三桶系统通常 65–80%，BIAB 略低。低于 55% 多半是粉碎太粗或洗糟不足；高于 90% 只在高浓度糖化或反复洗糟时出现，这时要怀疑测量有误'
    },
    boilTime: {
      label: '煮沸时长', unit: 'min', lo: 5, hi: 240, sLo: 60, sHi: 90,
      why: '60 分钟是默认值（足以把 DMS 驱净并完成异构化）。90 分钟用于高浓度麦汁或皮尔森麦芽；少于 30 分钟 DMS 前体会残留'
    },
    /* 煮沸蒸发率。
       注意单位是 **%/h（每小时蒸发掉煮沸前体积的百分比）**，不是 L/h。
       20-calc.js:122 拿它除以 100 再乘小时数，42-ui-recipe.js:980 的单位也写 %/h，
       42 的输入框用 'f-evap' + data-path="evaporationRate"。
       这里曾经叫 boilOff、单位写 L/h —— 全库没有任何字段叫 boilOff（grep 只有这一处），
       真正的字段是 evaporationRate，于是 42 的 RULE_BY_PATH / RULE_BY_ID 找不到它，
       那个输入框填什么都不标红。改名后本条才有被查到的可能。

       ⚠️ 生效前提：42-ui-recipe.js 的 RULE_BY_PATH（42:459-465）目前**没有**
       evaporationRate → 'evaporationRate' 的映射，RULE_BY_ID（42:479-486）也没有
       'f-evap'。本文件先把规则就位，那两处映射要由 42 的负责人补 ——
       补上之前，这条规则仍不会在配方页上标红/标黄。 */
    evaporationRate: {
      label: '煮沸蒸发率', unit: '%/h', lo: 0, hi: 40, sLo: 4, sHi: 20,
      why: '敞口家酿锅常态 8–12%/h。低于 4%/h 多半是盖着煮（DMS 前体驱不净），高于 20%/h 通常是敞口大锅或火力过猛，糖化浓度会被动升高、批次量收不住'
    },
    trubLoss: {
      label: '沉渣损失', unit: 'L', lo: 0, hi: 20, sLo: 0.5, sHi: 4,
      why: '常规 1–2L。设成 0 会让"批次量"算多（其实进罐的更少），实际装瓶时才发现少了一升'
    },

    /* ---- 原料 ---- */
    fermAmount: {
      label: '麦芽用量', unit: 'kg', lo: 0, hi: 200, sLo: 0.01, sHi: 30,
      why: '单行超过 30kg 在 20L 批次里意味着 OG 会超过 1.15，需要按高浓度折减效率'
    },
    hopAmount: {
      label: '酒花用量', unit: 'g', lo: 0, hi: 5000, sLo: 1, sHi: 300,
      why: '单次投放超过 300g（20L）通常只出现在双倍干投或 IPA 的 whirlpool，苦度会超过 100 IBU'
    },
    hopTime: {
      label: '投放时点', unit: 'min', lo: 0, hi: 600, sLo: 0, sHi: 90,
      why: '以煮沸结束为 0 分钟倒计时。大于 90 分钟没有额外异构化收益，只会多损失香气'
    },
    hopAA: {
      label: 'α 酸', unit: '%', lo: 0, hi: 30, sLo: 2, sHi: 18,
      why: '常见酒花 3–15%。超过 18% 只有少数高 α 品种（如 Magnum、Warrior），填错会让 IBU 高估一倍'
    },
    yeastAmount: {
      label: '接种量', unit: '', lo: 0, hi: 5000, sLo: 1, sHi: 500,
      why: '干酵母一包 11g 足够 20L 常规浓度；高浓度需要两包或扩培'
    },
    mashTemp: {
      label: '糖化温度', unit: '°C', lo: 0, hi: 100, sLo: 60, sHi: 78,
      why: '62–65°C 偏干爽，66–68°C 偏饱满，70°C 以上 β-淀粉酶失活、可发酵性骤降。超过 78°C 会溶出多酚与单宁'
    },
    mashMinutes: {
      label: '休止时长', unit: 'min', lo: 0, hi: 600, sLo: 20, sHi: 120,
      why: '常规 60 分钟。少于 20 分钟转化不完全；超过 2 小时对常规麦芽没有额外收益'
    },

    /* ---- 糖化之后的三个工艺段（v1.9） ---------------------------------
       落点：recipe.targets.process.<段>.<字段>（回旋温度除外，它是酒花行自己的
       hops[].whirlpoolTemp）。为什么不是 recipe.meta：40 的 normalizeRecipe
       是白名单重建，未知顶层键在每次读盘时都会丢；targets 是它唯一声明
       "不做归一"的容器。详见 42-ui-recipe.js 里 PROC_DEFAULTS 上方的注释。
       这七条都在 42 的 RULE_BY_PATH 里做了映射，映射漏了规则就是死的。 */

    /* 回旋沉淀。这个数直接进 20-calc 的 effectiveMinutes：≥90°C 折算 50%
       的等效煮沸时间、80–89 折算 35%、70–79 折算 15%、更低 5%，没填按 40%。
       所以它不是展示字段，改 5°C 就会改 IBU。 */
    whirlpoolTemp: {
      label: '回旋温度', unit: '°C', lo: 0, hi: 100, sLo: 70, sHi: 95,
      why: '回旋投花靠余温继续异构化：85–95°C 保温是通行做法（苦度贡献约为同量煮沸投花的 35–50%）。低于 70°C 基本只留香气、几乎不加苦；填到 100°C 说明还没降温就投了花，等同于晚投煮沸'
    },
    chillTargetC: {
      label: '冷却目标温度', unit: '°C', lo: -2, hi: 40, sLo: 8, sHi: 22,
      why: '艾尔接种 18–20°C、拉格 8–12°C。低于 8°C 只有拉格酵母还工作，艾尔会长时间不启动；高于 22°C 接种，前 12 小时的酯香与高级醇会明显超标'
    },
    chillMinutes: {
      label: '冷却时长', unit: 'min', lo: 0, hi: 240, sLo: 10, sHi: 40,
      why: '板换冷却 20L 通常 15–25 分钟。少于 10 分钟只在冰浴 + 强力循环下出现；超过 40 分钟意味着麦汁在 60°C 以下停留过久，DMS 前体仍在转化、感染窗口也拉长'
    },
    chillO2: {
      label: '目标溶氧', unit: 'ppm', lo: 0, hi: 25, sLo: 6, sHi: 14,
      why: '常规浓度 8–10 ppm；OG ≥ 1.080 才需要 12–15 ppm，而且只有纯氧做得到——空气泵与摇桶在常压下最多溶到 8 ppm 左右'
    },
    matureDays: {
      label: '后熟天数', unit: '天', lo: 0, hi: 365, sLo: 7, sHi: 30,
      why: '艾尔后熟 7–14 天（2–4°C）足以让酵母沉降、双乙酰还原；拉格按周算（3–6 周）。少于 7 天双乙酰常没还原完，喝起来像黄油'
    },
    matureTempC: {
      label: '后熟温度', unit: '°C', lo: -2, hi: 30, sLo: 0, sHi: 6,
      why: '2–4°C 是后熟常规。高于 6°C 酵母仍在缓慢工作，不叫后熟；低于 0°C 有结冰风险（酒精度 5% 的啤酒冰点约 −2°C）'
    },
    coldCrashTemp: {
      label: '冷降温度', unit: '°C', lo: -2, hi: 20, sLo: 0, sHi: 4,
      why: '0–4°C 放置 2–4 天让酵母与浑浊物沉降。必须低于后熟温度才降得下去；低于 −2°C 对常规酒精度有结冰风险'
    },
    coldCrashDays: {
      label: '冷降天数', unit: '天', lo: 0, hi: 60, sLo: 2, sHi: 7,
      why: '2–3 天足够沉降；超过一周对澄清收益很小，反而多一次氧化与吸味的机会'
    },

    /* ---- 成品指标 ---- */
    og: {
      label: '初始比重', unit: 'SG', lo: 0.95, hi: 1.3, sLo: 1.02, sHi: 1.12,
      why: '常规 1.040–1.070。超过 1.12 属高浓度，酵母接种量与充氧都要按高浓度另算'
    },
    fg: {
      label: '终比重', unit: 'SG', lo: 0.95, hi: 1.2, sLo: 1.0, sHi: 1.04,
      why: '低于 1.000 只在加了糖化酶或野生酵母时出现；高于 1.04 多半是发酵停滞，不是配方问题'
    },
    abv: {
      label: '酒精度', unit: '%', lo: 0, hi: 25, sLo: 2, sHi: 12,
      why: '超过 12% 需要耐酒精菌株 + 足量接种 + 多次充氧，否则一定停在半路'
    },
    ibu: {
      label: '苦度', unit: 'IBU', lo: 0, hi: 300, sLo: 8, sHi: 100,
      why: '超过 100 已接近啤酒花溶解度上限（约 100–120），再算出来的数字不可信'
    },
    srm: {
      label: '色度', unit: 'SRM', lo: 0, hi: 80, sLo: 2, sHi: 50,
      why: '公式在 SRM 50 以上开始明显低估实际颜色，深色酒请以实物为准'
    },
    attenuation: {
      label: '酵母标称衰减度', unit: '%', lo: 0, hi: 110, sLo: 60, sHi: 90,
      why: '常规艾尔 72–80%，拉格 78–85%。超过 95% 只可能来自糖化酶或布雷特酵母'
    },
    /* 碳化度（vol，1 体积 = 1 L CO₂ 溶于 1 L 酒）。
       软区间是"跨所有风格都说得通"的合用区间，不是任何一个风格的窗口：
       下限 1.5 给英式艾尔/木桶低碳酸，上限 4.5 给小麦与比利时。

       本库口径（四处文案必须逐字一致：本文件 / 17-glossary-process.js:336,339 /
       22-tips-data.js:121 / 50-ui-tools.js:248,1625）：
         英式艾尔   1.5–2.2
         美式艾尔   2.2–2.8
         小麦       3.3–4.5
         比利时     2.0–4.5（含修道院）

       ⚠️ 这些是**文案口径，不是机器校验**：15-data-style.js 目前没有 carbonation
       字段，所以没有任何代码按 styleId 去比对窗口。这里的 1.5–4.5 只判"这个数本身
       离谱不离谱"，判不了"这锅酒该不该是这个数"。别以为它被自动校验了。

       3.0 vol 是**普通玻璃瓶的安全线**，不是风格上限 —— 小麦与比利时的窗口本来就
       跨过了它，那些酒必须用厚壁瓶（比利时/香槟瓶）或直接桶装碳化。 */
    carbonation: {
      label: '碳化度', unit: 'vol', lo: 0, hi: 8, sLo: 1.5, sHi: 4.5,
      why: '英式艾尔 1.5–2.2、美式艾尔 2.2–2.8、小麦 3.3–4.5、比利时 2.0–4.5（含修道院）。3.0 vol 是普通玻璃瓶的安全线，超过就得用厚壁瓶（比利时/香槟瓶）或桶装碳化'
    },

    /* ---- 水化学 ---- */
    wCa: { label: '钙', unit: 'ppm', lo: 0, hi: 1000, sLo: 0, sHi: 200,
      why: '20–150 是常规。超过 200 会有矿物涩感，且与碳酸盐一起沉淀' },
    wMg: { label: '镁', unit: 'ppm', lo: 0, hi: 500, sLo: 0, sHi: 40,
      why: '10–30 足够（酵母需要镁）。超过 50 开始有苦味与泻药感' },
    wNa: { label: '钠', unit: 'ppm', lo: 0, hi: 1000, sLo: 0, sHi: 100,
      why: '低于 100 才安全。超过 150 明显咸味，超过 250 无法入口' },
    wCl: { label: '氯', unit: 'ppm', lo: 0, hi: 1000, sLo: 0, sHi: 250,
      why: '50–150 让酒体圆润。超过 250 出现咸味与金属感，还会加剧腐蚀' },
    wSO4: { label: '硫酸盐', unit: 'ppm', lo: 0, hi: 1500, sLo: 0, sHi: 350,
      why: '50–350 是常规（IPA 偏高）。超过 400 有明显干涩与"火柴头"味' },
    wHCO3: { label: '碳酸氢盐', unit: 'ppm', lo: 0, hi: 1500, sLo: 0, sHi: 300,
      why: '深色酒可到 200–300，浅色拉格应低于 50。过高会把糖化 pH 顶到 5.8 以上' },
    mashPh: { label: '糖化 pH', unit: '', lo: 3, hi: 9, sLo: 5.2, sHi: 5.6,
      why: '5.2–5.6 是目标区间。低于 5.0 酶活受抑、发酵变慢；高于 5.8 萃取多酚，酒发涩且色深' },

    /* ---- 实测与批次 ---- */
    measureTemp: {
      label: '温度', unit: '°C', lo: -5, hi: 60, sLo: 5, sHi: 30,
      why: '艾尔主发酵 18–22°C，拉格 8–12°C。低于 5°C 酵母休眠，高于 30°C 会产生大量高级醇与酯'
    },
    measurePh: {
      label: 'pH', unit: '', lo: 2, hi: 10, sLo: 3.5, sHi: 5.5,
      why: '麦汁 5.2–5.6，发酵液 4.0–4.5。成品高于 4.6 有微生物风险'
    },
    pkgVolume: {
      label: '装瓶量', unit: 'L', lo: 0, hi: 200, sLo: 0.5, sHi: 60,
      why: '应略小于批次量（发酵损失 + 发酵罐残液）。大于批次量说明有人在填估算值'
    },
    costAmount: {
      label: '金额', unit: '¥', lo: 0, hi: 100000, sLo: 0, sHi: 3000,
      why: '单批超过 3000 元在 20L 家酿里通常意味着填的是整袋原料的价格，不是本批用量'
    },

    /* ---- 原料库自建条目 ---- */
    ingPpg: { label: 'ppg', unit: '', lo: 0, hi: 50, sLo: 20, sHi: 40,
      why: '麦芽 30–38，糖类 40–46，提取物 35–44。填错会直接扭曲 OG' },
    ingLov: { label: '色度', unit: '°L', lo: 0, hi: 800, sLo: 0, sHi: 500,
      why: '超过 500 只有 roasted barley / black patent 一类，用量通常不超过 5%' },
    ingAA: { label: 'α 酸', unit: '%', lo: 0, hi: 30, sLo: 2, sHi: 18,
      why: '3–15% 为常见范围' },
    ingAtt: { label: '酵母标称衰减度', unit: '%', lo: 0, hi: 110, sLo: 65, sHi: 88,
      why: '艾尔 72–78%，拉格 78–85%，葡萄酒酵母可到 95% 以上' }
  };

  /* ---------------------------------------------------------------------
   * 关系规则：判的不是单值，而是两个数之间的关系
   *   这些是"错误最难被发现"的地方——单看每个数都正常，合起来说不通。
   * -------------------------------------------------------------------*/
  var RELATIONS = {
    buGu: {
      label: '苦甜比（BU:GU）',
      sLo: 0.25, sHi: 1.3,
      why: 'BU:GU = IBU ÷ (OG 点数 − 1)。0.3 以下偏麦芽，0.5 平衡，0.8 以上明显偏苦。超过 1.3 只有双倍 IPA 才合理',
      test: function (c) {
        var pts = (c.og - 1) * 1000;
        if (!(pts > 0) || !(c.ibu >= 0)) return null;
        return { value: c.ibu / pts };
      }
    },
    so4cl: {
      label: 'SO₄ : Cl',
      sLo: 0.3, sHi: 3.0,
      why: '低于 0.5 偏麦芽圆润（英式），1 附近平衡，2 以上偏干苦（IPA）。超过 4 会明显涩',
      test: function (c) {
        if (!(c.cl > 0)) return null;
        return { value: c.so4 / c.cl };
      }
    },
    darkGrainPct: {
      label: '深色麦芽占比',
      sHi: 20,
      why: '结晶 + 烘烤麦芽合计超过 20% 会发涩、发苦，且残糖过高。世涛里 10–15% 已足够深到 40 SRM',
      test: function (c) {
        if (!(c.totalKg > 0)) return null;
        return { value: (c.darkKg / c.totalKg) * 100 };
      }
    },
    pkgVsBatch: {
      label: '装瓶量 vs 批次量',
      hard: function (c) {
        if (!(c.pkgL > 0) || !(c.batchL > 0)) return null;
        return c.pkgL > c.batchL * 1.02 ? '装瓶量 ' + c.pkgL + ' L 大于批次量 ' + c.batchL + ' L' : null;
      },
      why: '装瓶量必然小于批次量——发酵会带走一批（酵母泥、干投酒花吸液、取样）'
    },
    fgVsOg: {
      label: 'FG vs OG',
      hard: function (c) {
        if (!(c.fg > 0) || !(c.og > 0)) return null;
        return c.fg > c.og + 0.0005 ? '终比重 ' + c.fg + ' 高于初始比重 ' + c.og : null;
      },
      why: '发酵只会让比重下降。FG 高于 OG 只有两种可能：两个数有一个填错了，或者那是另一锅酒的数据'
    }
  };

  /* ---------------------------------------------------------------------
   * 判定
   * -------------------------------------------------------------------*/
  function toNum(v) {
    var n = (typeof v === 'number') ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  /** 取规则；key 不存在返回 null（调用方据此决定"这个字段不校验"） */
  FR.get = function (key) {
    return Object.prototype.hasOwnProperty.call(RULES, key) ? RULES[key] : null;
  };

  /**
   * 判一个值。
   * @returns {{level:'ok'|'soft'|'hard'|'empty', msg:string, rule:object|null}}
   *   empty = 没填或不是数字。**没填不算错**，不要标红——
   *   空输入框标红会让整页一打开就是一片红，用户会先把红色忽略掉。
   */
  FR.test = function (key, value) {
    var r = FR.get(key);
    if (!r) return { level: 'ok', msg: '', rule: null };
    var n = toNum(value);
    if (n === null) return { level: 'empty', msg: '', rule: r };

    var lo = r.lo, hi = r.hi, sLo = r.sLo, sHi = r.sHi;
    if ((lo !== undefined && n < lo) || (hi !== undefined && n > hi)) {
      return { level: 'hard', msg: r.hardMsg || r.why, rule: r };
    }
    if ((sLo !== undefined && n < sLo) || (sHi !== undefined && n > sHi)) {
      return { level: 'soft', msg: r.why, rule: r };
    }
    return { level: 'ok', msg: '', rule: r };
  };

  /**
   * 判关系。ctx 是"当前表单里取得到的数"的普通对象。
   * @returns {{key, label, level, value, msg}}
   */
  FR.relation = function (key, ctx) {
    var rel = RELATIONS[key];
    if (!rel) return { key: key, level: 'ok', value: null, msg: '' };
    ctx = ctx || {};

    /* 硬关系优先：它是"不可能"，不是"不常见" */
    if (typeof rel.hard === 'function') {
      var bad = rel.hard(ctx);
      if (bad) return { key: key, label: rel.label, level: 'hard', value: null, msg: bad + '。' + rel.why };
    }
    if (typeof rel.test !== 'function') return { key: key, label: rel.label, level: 'ok', value: null, msg: '' };

    var res = rel.test(ctx);
    if (!res || !isFinite(res.value)) return { key: key, label: rel.label, level: 'empty', value: null, msg: '' };

    var v = res.value;
    if ((rel.sLo !== undefined && v < rel.sLo) || (rel.sHi !== undefined && v > rel.sHi)) {
      return {
        key: key, label: rel.label, level: 'soft', value: v,
        msg: rel.label + ' = ' + (Math.round(v * 100) / 100) + '，' + rel.why
      };
    }
    return { key: key, label: rel.label, level: 'ok', value: v, msg: '' };
  };

  /** 列出所有规则键，给设置页/自检用 */
  FR.list = function () {
    var out = [];
    for (var k in RULES) if (Object.prototype.hasOwnProperty.call(RULES, k)) out.push(k);
    return out;
  };

  FR.relationList = function () {
    var out = [];
    for (var k in RELATIONS) if (Object.prototype.hasOwnProperty.call(RELATIONS, k)) out.push(k);
    return out;
  };

  FR.RULES = RULES;
  FR.RELATIONS = RELATIONS;

})(typeof window !== 'undefined' ? window : globalThis);
