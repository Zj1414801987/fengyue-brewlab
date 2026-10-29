/* ============================================================================
 * 风月酿研所 — 麦芽与谷物数据库
 * ----------------------------------------------------------------------------
 * 数据口径说明（务必先读）：
 *   1. ppg = Points Per Pound Per Gallon，即 1 磅该谷物在 1 加仑水中
 *      100% 转化时能贡献的比重点数。这是配方计算的地基。
 *      公制换算：OG点数 = Σ(ppg × 公斤 × 8.3454 × 效率) / 升
 *   2. lov = 色度（°Lovibond）。EBC ≈ lov × 1.97，SRM ≈ 1.3546 × lov − 0.76。
 *      注意：麦芽袋上印的可能是 Lovibond 也可能是 EBC，两者不能直接混用。
 *   3. mustMash = 是否必须参与糖化。糖/提取物不需要，且效率系数按 100% 计。
 *   4. conf 置信度：
 *        A = 多来源交叉验证（≥2 个独立参考表一致）
 *        B = 单一权威源 / 行业通行值（误差通常 <5%）
 *        C = 估值区间中位数，**必须查厂商 COA 后使用**
 *      本库宁可标 C 也不编一个精确到小数点的假数字。
 *   5. 实际出糖率受粉碎度、糖化方案、麦芽批次影响，库内是"标称值"。
 *      第一次用某个品牌，建议按 70-75% 系统效率试算，再按实测回调。
 *   6. 文案层（v1.4 追加，与数值分层）：
 *        craft = 酿造要点，只解释本条已有物理字段的含义（dp / maxPct / lov / 是否需糖化），
 *                不引入新的产地、年份、工艺约定。211 条一条不缺。
 *        story = 来历，只给在酿酒史上有明确记载的条目（本类 8 条）。
 *                通用品类（"结晶麦芽 40L"这类）没有来历可讲，宁可留空——
 *                界面对空值会显示"这一条是通用品类"，空着比编好。
 *        catGuides = 品类导览，按 cat 分组写的通识长文（7 篇），给列表顶部与详情面板用。
 *
 * v1.7 追加的参数层（**全部选填**，没填就是没填，界面显示「—」而不是 0）：
 *   moisture   水分 %        影响储存霉变与按干物质折算的实际出糖
 *   protein    总蛋白 %      影响泡沫厚度、浑浊与过滤难度
 *   dpLintner  糖化力 °L     比 dp（high/med）更细，辅料多时判断还要不要补酶
 *   friability 脆度 %        反映溶解度与粉碎难易，<80 说明这批麦溶解不足
 *   kolbach    Kolbach 指数% 蛋白溶解度，36-42 为溶解良好
 *   extractFG  细粉浸出率 %  理论 ppg 的上限，实测出糖偏低时先查它
 *   ebc        色度 EBC      袋上标 EBC 时直接对照，省得除以 1.97
 *   psrc       参数出处      仅在本条新填了上面某项时写，说明是哪份规格表
 * 诚实原则不变：没有厂商规格表就留空。目前 70 条里只有 m-2row / m-pilsner
 * 两条有完整规格表（Briess / Weyermann），其余 68 条这六项全空，这是对的。
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  BREW.DB = BREW.DB || {};

  /* cat 分类：base 基础 | kiln 窑烤 | crystal 结晶 | roast 烘烤
   *          grain 未发芽谷物 | sugar 糖 | extract 提取物 */
  BREW.DB.malts = [
    /* ---------------- 基础麦芽：构成糖化主体，自身酶系完整 ---------------- */
    { id: 'm-2row', name: '淡色艾尔麦芽（二棱）', en: '2-Row Pale Malt', cat: 'base', origin: '美国',
      ppg: 37, lov: 2, mustMash: true, maxPct: 100, dp: 'high', fermentable: 'high',
      flavor: '清淡谷物、微甜、干净的底色', use: '美式艾尔、IPA、拉格的通用基石',
      craft: 'dp 高、上限 100%，可以单独完成糖化；风味中性，是美式风格最干净的画布。ppg 按 37 计，实际随粉碎度与糖化方案浮动。',
      conf: 'A', src: 'Brewing.net / CaptainBrew / GeraTools 三源一致',
      /* v1.7 参数层：只补这一条，因为 Briess 的 2-Row 规格表是业内公开且稳定的。
         其余 70 条不填——没有厂商规格表就留空，界面上是「—」不是 0。 */
      psrc: 'Briess Brewers 2-Row 规格：水分 4.5% / 蛋白 11.5% / DP 140 °Lintner / 浸出率 80%',
      moisture: 4.5, protein: 11.5, dpLintner: 140, extractFG: 80 },

    { id: 'm-marisotter', name: '马里斯奥特（英式淡色艾尔麦芽）', en: 'Maris Otter Pale Ale Malt', cat: 'base', origin: '英国',
      ppg: 37, lov: 3, mustMash: true, maxPct: 100, dp: 'high', fermentable: 'high',
      flavor: '饼干、坚果、蜂蜜般圆润的麦芽骨架', use: '英式苦啤、波特、世涛的传统基麦',
      craft: '酶系完整、可 100% 作基麦；lov 3 带来的饼干与坚果是风格本身，不是杂质。同一配方只换基麦，英式与美式的差别就有了一半。',
      story: '英国剑桥郡的植物育种机构在 20 世纪 60 年代推出，以抗倒伏和稳定出糖著称，之后成为英式艾尔的默认基麦。它的饼干与坚果底味，被很多英国酒厂当成「英式」的定义之一。',
      conf: 'A', src: 'Brewing.net 37ppg/3L；CaptainBrew 38ppg' },

    { id: 'm-pilsner', name: '皮尔森麦芽', en: 'Pilsner Malt', cat: 'base', origin: '德国/捷克',
      ppg: 37, lov: 1.8, mustMash: true, maxPct: 100, dp: 'high', fermentable: 'high',
      flavor: '极淡的蜂蜜与苏打饼干，最浅的基麦', use: '皮尔森、科隆、比利时艾尔的底味',
      craft: '酶系完整、色度最低（lov 1.8），但 DMS 前体高：必须敞开锅盖剧烈煮沸 60–90 分钟，收尾别盖盖焖。',
      story: '1842 年，波希米亚皮尔森市的市民酿酒厂用当地软水、浅色麦芽与萨兹酒花做出第一桶下层发酵的浅色啤酒。皮尔森麦芽从此成为世界上最浅的基麦，也是所有浅色拉格的起点。',
      conf: 'A', src: 'Brewing.net 37ppg/1.8L',
      psrc: 'Weyermann Pilsner Malt 质量参数：水分 ≤5.5% / 蛋白 10-11.5% / Kolbach 38-42% / 脆度 ≥80% / 浸出率 ≥80%',
      moisture: 5.5, protein: 11, kolbach: 40, friability: 82, extractFG: 81, ebc: 3.5,
      note: 'DMS 前体高，必须敞开锅盖剧烈煮沸 60-90 分钟' },

    { id: 'm-goldenpromise', name: '黄金诺言麦芽', en: 'Golden Promise', cat: 'base', origin: '英国（苏格兰）',
      ppg: 37, lov: 2.5, mustMash: true, maxPct: 100, dp: 'high', fermentable: 'high',
      flavor: '比 MO 更干净、更甜，饼干味淡而蜂蜜味显', use: '苏格兰艾尔、IPA，追求饱满酒体',
      craft: '与 Maris Otter 同为可 100% 使用的英式基麦，lov 2.5 更浅、甜感更直接；做苏格兰艾尔时替掉 MO 会更干净。',
      story: '20 世纪 60 年代苏格兰培育的大麦品种，耐寒、出糖稳定，是苏格兰艾尔与 80 年代英式 IPA 复兴里常见的基麦；相比 Maris Otter 更甜、饼干味更淡。',
      conf: 'B', src: 'Brewing.net 37ppg/2.5L' },

    { id: 'm-6row', name: '六棱淡色麦芽', en: '6-Row Pale Malt', cat: 'base', origin: '美国',
      ppg: 35, lov: 2, mustMash: true, maxPct: 100, dp: 'veryhigh', fermentable: 'med',
      flavor: '谷壳感更强、略带涩味，ppg 低于二棱', use: '高辅料比例配方（酶力补充）',
      craft: 'dp 为 veryhigh，酶力就是它存在的理由：玉米、大米等辅料超过 30% 时用它补酶。壳厚单宁多，纯六棱配方会有明显谷壳涩感。',
      conf: 'A', src: 'Brewing.net 35ppg/2L；CaptainBrew 35ppg',
      note: '酶力高，含 30% 以上玉米/大米辅料时用它补酶' },

    { id: 'm-wheat', name: '小麦麦芽', en: 'Wheat Malt', cat: 'base', origin: '德国',
      ppg: 37, lov: 2, mustMash: true, maxPct: 70, dp: 'high', fermentable: 'high',
      flavor: '面包香、微酸、蛋白质高', use: '小麦啤、柏林白啤、增稠与泡沫',
      craft: '上限 70% 是过滤极限：无壳小麦超过这条线滤槽必堵，配方里加 3–5% 稻壳可缓解。蛋白质高带来永久浑浊与厚泡沫，这是小麦啤的特征不是缺陷。',
      conf: 'A', src: 'Brewing.net 37ppg/2L（上限 70%）',
      note: '蛋白质高，需加米糠/稻壳防滤槽堵塞；通常伴随永久性浑浊' },

    { id: 'm-rye', name: '黑麦麦芽', en: 'Rye Malt', cat: 'base', origin: '德国',
      ppg: 36, lov: 3.5, mustMash: true, maxPct: 30, dp: 'high', fermentable: 'high',
      flavor: '干爽、胡椒般的辛辣、油滑口感', use: '黑麦 IPA、罗格啤酒',
      craft: '上限 30%，β-葡聚糖高：超量麦醪会像水泥，必须加稻壳并做 45°C 蛋白质休止。风味是干爽的胡椒辛辣，不提供甜。',
      conf: 'A', src: 'Brewing.net 36ppg/3.5L（上限 30%）',
      note: 'β-葡聚糖高，必须加稻壳并做 45°C 蛋白质休止，否则滤槽像水泥' },

    { id: 'm-vienna', name: '维也纳麦芽', en: 'Vienna Malt', cat: 'base', origin: '德国',
      ppg: 35, lov: 3.5, mustMash: true, maxPct: 100, dp: 'high', fermentable: 'medhigh',
      flavor: '浅烤面包、金色、温和的坚果感', use: '维也纳拉格、三月节、琥珀艾尔',
      craft: 'dp 高、可 100% 作基麦，但发酵度中等偏上、lov 3.5 带浅烤面包感；做维也纳拉格时全用它即可，不必再掺淡色麦芽。',
      story: '1840 年代，维也纳酿酒师安东·德雷尔把英国的窑烤技术带回奥地利，做出了比传统深色麦芽浅得多的维也纳麦芽。它与琥珀色维也纳拉格一起，成为 19 世纪中欧拉格的一极。',
      conf: 'A', src: 'Brewing.net 36ppg/3.5L；CaptainBrew 35ppg' },

    { id: 'm-munich', name: '慕尼黑麦芽（浅）', en: 'Munich Malt (Light)', cat: 'base', origin: '德国',
      ppg: 35, lov: 10, mustMash: true, maxPct: 100, dp: 'med', fermentable: 'med',
      flavor: '面包皮、扎实的麦芽甜，无焦糖感', use: '慕尼黑拉格、博克、琥珀艾尔',
      craft: 'dp 中等，满比例使用时糖化时间要留足 60 分钟以上；lov 10 是「麦芽味」最直接的来源，10–30% 就能明显加厚骨架。',
      story: '在皮尔森出现之前，慕尼黑一带的拉格以深色、麦芽感厚重著称，慕尼黑麦芽就是为这种酒发展出来的窑烤麦芽。它至今仍是「让麦芽味更足」最有效的单一原料。',
      conf: 'A', src: 'Brewing.net 35ppg/10L',
      note: '让"麦芽味更足"最有效的单一原料' },

    { id: 'm-munich-dark', name: '深慕尼黑麦芽', en: 'Dark Munich Malt', cat: 'base', origin: '德国',
      ppg: 34, lov: 20, mustMash: true, maxPct: 60, dp: 'med', fermentable: 'med',
      flavor: '更深的烤面包皮、淡淡太妃糖', use: '深色博克、双料博克',
      craft: '上限 60%、dp 中等：超过这条线酶不足且甜得发闷。lov 20 已接近浅色结晶的色度，但带来的是面包皮而非焦糖。',
      conf: 'B', src: 'Brewing.net 34ppg/20L（上限 60%）' },

    { id: 'm-belgian-pale', name: '比利时淡色艾尔麦芽', en: 'Belgian Pale Ale Malt', cat: 'base', origin: '比利时',
      ppg: 36, lov: 3.5, mustMash: true, maxPct: 100, dp: 'high', fermentable: 'high',
      flavor: '柔和、微甜、比英式基麦更中性', use: '比利时金色艾尔、三料、塞松',
      craft: '置信度 C：各厂 ppg 差异大，投料前按实际 COA 换算。lov 3.5 风味中性，适合当比利时风格的干净底味。',
      conf: 'C', src: '厂商差异大（Dingemans/Castle 不同），取通行区间', },

    /* ---------------- 窑烤麦芽：有颜色有风味，多数仍可自转化 ---------------- */
    { id: 'm-melanoidin', name: '美拉德麦芽', en: 'Melanoidin Malt', cat: 'kiln', origin: '德国',
      ppg: 33, lov: 30, mustMash: true, maxPct: 10, dp: 'med', fermentable: 'med',
      flavor: '浓郁的麦芽香、红琥珀色，模拟双醪煮沸的效果', use: '替代复杂煮出糖化工艺',
      craft: '上限 10%：它是「浓缩麦芽香」，5–10% 就能模拟煮出糖化的圆润感；超过上限会甜得发闷，还压住酵母的酚香。',
      conf: 'A', src: 'Brewing.net 33ppg/30L（上限 10%）' },

    { id: 'm-biscuit', name: '饼干麦芽', en: 'Biscuit Malt', cat: 'kiln', origin: '比利时',
      ppg: 35, lov: 25, mustMash: true, maxPct: 10, dp: 'low', fermentable: 'med',
      flavor: '烤面包、消化饼干的干香', use: '英式苦啤、琥珀艾尔提味',
      craft: 'dp low、上限 10%：不承担糖化主力，5–8% 给英式苦啤加饼干边；用量过高会出现干涩的面粉感。',
      conf: 'A', src: 'Brewing.net 35ppg/25L（上限 10%）' },

    { id: 'm-victory', name: '胜利麦芽', en: 'Victory Malt', cat: 'kiln', origin: '美国',
      ppg: 34, lov: 28, mustMash: true, maxPct: 15, dp: 'low', fermentable: 'med',
      flavor: '坚果、吐司，比饼干麦甜一点', use: '美式琥珀、棕艾尔',
      craft: '上限 15%；lov 28 比饼干麦深一档、更偏吐司与坚果，美式琥珀与棕艾尔里 5–10% 最舒服。',
      conf: 'A', src: 'Brewing.net 34ppg/28L（上限 15%）' },

    { id: 'm-aromatic', name: '芳香麦芽', en: 'Aromatic Malt', cat: 'kiln', origin: '比利时',
      ppg: 35, lov: 20, mustMash: true, maxPct: 10, dp: 'low', fermentable: 'med',
      flavor: '强烈而带花香的麦芽气息，像浓缩慕尼黑', use: '比利时浓烈型啤酒',
      craft: '上限 10%，风味浓度接近慕尼黑的两倍：比利时浓烈型里 3–5% 就够，多了会压住酵母的酚香。',
      conf: 'A', src: 'Brewing.net 35ppg/20L（上限 10%）' },

    { id: 'm-amber', name: '琥珀麦芽', en: 'Amber Malt', cat: 'kiln', origin: '英国',
      ppg: 32, lov: 25, mustMash: true, maxPct: 15, dp: 'low', fermentable: 'med',
      flavor: '干爽的烤面包、微苦的饼干边', use: '英式波特、历史配方',
      craft: '置信度 C（区间 30–34ppg）：lov 25 带干爽的烤面包与微苦收口，英式历史配方常用；现代配方多改用结晶麦芽。',
      conf: 'C', src: 'Dingemans/Simpsons 区间 30-34ppg，取 32' },

    { id: 'm-brown', name: '棕色麦芽', en: 'Brown Malt', cat: 'kiln', origin: '英国',
      ppg: 32, lov: 65, mustMash: true, maxPct: 20, dp: 'low', fermentable: 'med',
      flavor: '烤面包皮、可可、淡淡咖啡', use: '伦敦波特的核心特色麦芽',
      craft: 'lov 65、上限 20%：伦敦波特的性格麦芽，8–15% 给可可与烤面包皮；过量会让酒体发干并带灰味。',
      conf: 'B', src: 'CaptainBrew 32ppg' },

    { id: 'm-honey', name: '蜂蜜麦芽', en: 'Honey Malt', cat: 'kiln', origin: '加拿大',
      ppg: 31, lov: 25, mustMash: true, maxPct: 15, dp: 'low', fermentable: 'med',
      flavor: '蜂蜜甜香、柔和圆润', use: '增甜与香气，不增酒精感',
      craft: '置信度 C 的估值：甜感来自麦芽糖而不是蜂蜜，15% 以内增甜不增酒精感，多了会腻。',
      conf: 'C', src: 'Gambrinus 产品区间 30-32ppg' },

    { id: 'm-coffee', name: '咖啡麦芽', en: 'Coffee Malt', cat: 'kiln', origin: '英国',
      ppg: 30, lov: 165, mustMash: true, maxPct: 10, dp: 'none', fermentable: 'low',
      flavor: '烘焙咖啡、黑巧克力', use: '世涛、波特',
      craft: 'dp none，不参与糖化反应，只贡献色与味；lov 165 已进入烘烤区间，3–8% 足够，过量出焦苦。',
      conf: 'C', src: '区间估值，需查厂商' },

    /* ---------------- 结晶麦芽：糖化时已糖化，只贡献糖与色 ---------------- */
    { id: 'm-carapils', name: '卡拉皮尔森（泡沫麦芽）', en: 'Carafoam / CaraPils', cat: 'crystal', origin: '德国',
      ppg: 33, lov: 2, mustMash: false, maxPct: 20, dp: 'none', fermentable: 'low',
      flavor: '几乎无味，专门增强泡沫持久度与酒体', use: '任何想改善挂杯的配方',
      craft: 'mustMash 为否、几乎无味：它只做一件事——增加泡沫蛋白与酒体，5–15% 不影响风味，也几乎不改颜色。',
      conf: 'A', src: 'Brewing.net 上限 20%；Oculyze 32-34ppg' },

    { id: 'm-c10', name: '结晶麦芽 10L', en: 'Crystal 10L', cat: 'crystal', origin: '美国',
      ppg: 35, lov: 10, mustMash: false, maxPct: 20, dp: 'none', fermentable: 'low',
      flavor: '极浅的焦糖甜、蜜瓜', use: '淡色艾尔的轻甜',
      craft: '最浅的结晶麦芽：lov 10 只给一点蜜瓜甜，5–10% 用在淡色艾尔里不会明显加深颜色。',
      conf: 'B', src: 'CaptainBrew Light Crystal 35ppg' },

    { id: 'm-c20', name: '结晶麦芽 20L', en: 'Crystal 20L', cat: 'crystal', origin: '美国',
      ppg: 34, lov: 20, mustMash: false, maxPct: 20, dp: 'none', fermentable: 'low',
      flavor: '焦糖、蜂蜜、葡萄干边', use: '琥珀艾尔调色',
      craft: 'lov 20、甜感清爽：适合需要一点圆润又不想变色的配方，8–12% 是舒适区。',
      conf: 'B', src: 'Oculyze 34-36ppg' },

    { id: 'm-c40', name: '结晶麦芽 40L', en: 'Crystal 40L', cat: 'crystal', origin: '美国',
      ppg: 34, lov: 40, mustMash: false, maxPct: 15, dp: 'none', fermentable: 'low',
      flavor: '明显的焦糖、太妃糖、轻微坚果', use: '美式琥珀、棕艾尔',
      craft: 'lov 40 是焦糖最标准的色度：美式琥珀 5–10%，超过上限 15% 甜感会盖过酒花。',
      conf: 'A', src: 'Oculyze 33-35ppg；CaptainBrew 34ppg' },

    { id: 'm-c60', name: '结晶麦芽 60L', en: 'Crystal 60L', cat: 'crystal', origin: '美国',
      ppg: 34, lov: 60, mustMash: false, maxPct: 15, dp: 'none', fermentable: 'low',
      flavor: '浓厚焦糖、葡萄干、隐约巧克力', use: 'IPA 的酒体支撑、棕艾尔',
      craft: 'lov 60 带葡萄干与隐约巧克力，IPA 里 3–6% 撑酒体；超过 15% 会让 IPA 发甜、苦感被压下去。',
      conf: 'A', src: 'Brewing.net 34ppg/60L；Oculyze 32-34ppg' },

    { id: 'm-c80', name: '结晶麦芽 80L', en: 'Crystal 80L', cat: 'crystal', origin: '美国',
      ppg: 33, lov: 80, mustMash: false, maxPct: 12, dp: 'none', fermentable: 'low',
      flavor: '深焦糖、红枣、烤糖', use: '棕艾尔、波特',
      craft: '上限 12%：lov 80 已经很深，5–8% 给棕艾尔与波特红枣调；再多就抢了烘烤谷物的位置。',
      conf: 'A', src: 'Oculyze 31-33ppg' },

    { id: 'm-c120', name: '结晶麦芽 120L', en: 'Crystal 120L', cat: 'crystal', origin: '美国',
      ppg: 33, lov: 120, mustMash: false, maxPct: 10, dp: 'none', fermentable: 'low',
      flavor: '浓烈干果、糖蜜、微苦', use: '世涛、老艾尔，少量即够',
      craft: '上限 10%、lov 120：干果与糖蜜感浓，3–5% 即可；过量会带来明显焦苦与涩口。',
      conf: 'A', src: 'Oculyze 30-32ppg；Brewing.net 33ppg' },

    { id: 'm-c150', name: '深焦糖麦芽 150L', en: 'Crystal 150L', cat: 'crystal', origin: '英国',
      ppg: 32, lov: 150, mustMash: false, maxPct: 8, dp: 'none', fermentable: 'low',
      flavor: '黑糖蜜、焦苦、葡萄干', use: '深色英式艾尔',
      craft: '上限 8%、置信度 C：已接近烘烤区间，2–5% 提供黑糖蜜与焦苦，超过就有灰烬感。',
      conf: 'C', src: '区间估值' },

    { id: 'm-specialb', name: '特殊 B 麦芽', en: 'Special B', cat: 'crystal', origin: '比利时',
      ppg: 31, lov: 145, mustMash: false, maxPct: 10, dp: 'none', fermentable: 'low',
      flavor: '极浓的深色水果（李子、葡萄干）、焦糖', use: '比利时双料、四料、修道院艾尔',
      craft: 'lov 145、上限 10%：数值上它是「浓味小剂量」的典型，比利时时 5% 就已明显，超过 10% 会腻。',
      story: '比利时厂商的深色结晶麦芽代表作，在 20 世纪后期比利时修道院风格的复兴中被广泛采用。它几乎成了双料、四料「深色果味」的代名词。',
      conf: 'A', src: 'CaptainBrew 31ppg；Oculyze 32-34ppg',
      note: '5% 就能明显改变风味，是比利时风格的性格麦芽' },

    /* ---------------- 烘烤谷物：色深味重，用量小 ---------------- */
    { id: 'm-chocolate', name: '巧克力麦芽', en: 'Chocolate Malt', cat: 'roast', origin: '英国',
      ppg: 28, lov: 350, mustMash: false, maxPct: 10, dp: 'none', fermentable: 'low',
      flavor: '黑巧克力、咖啡、坚果皮', use: '波特、世涛',
      craft: 'lov 350、dp none：色度极高，超过 10% 会带来焦苦与涩感，通常 3–5% 就够压深颜色；它不提供可发酵糖。',
      conf: 'A', src: 'Brewing.net 28ppg/350L；CaptainBrew 28ppg' },

    { id: 'm-chocolate-uk', name: '巧克力麦芽（英式深）', en: 'Chocolate Malt (UK 450L)', cat: 'roast', origin: '英国',
      ppg: 28, lov: 450, mustMash: false, maxPct: 8, dp: 'none', fermentable: 'low',
      flavor: '更深、更干、带焦苦', use: '爱尔兰世涛',
      craft: 'lov 450 比常规巧克力麦更干更焦，上限 8%；爱尔兰世涛里 5–7% 是常见位置，再多就苦得发涩。',
      conf: 'B', src: 'Brewmybeer 300-400L 区间上沿；各厂差异大' },

    { id: 'm-blackpatent', name: '黑专利麦芽', en: 'Black Patent Malt', cat: 'roast', origin: '英国',
      ppg: 25, lov: 500, mustMash: false, maxPct: 5, dp: 'none', fermentable: 'none',
      flavor: '尖锐的焦苦、烟熏、灰烬感', use: '世涛的"骨架苦"，1-3% 足够',
      craft: '上限 5%、可发酵性为零：尖锐焦苦，1–3% 就够。它同时会把糖化醪 pH 拉低，深色配方要相应调整水质。',
      story: '1817 年，英国人丹尼尔·惠勒取得用滚筒烘烤麦芽的专利，「黑专利麦芽」因此得名。它让酿酒师第一次能稳定地拿到极深色、几乎炭化的麦芽。',
      conf: 'A', src: 'Brewing.net 25ppg；Oculyze 25-29ppg' },

    { id: 'm-roastedbarley', name: '烘烤大麦（未发芽）', en: 'Roasted Barley', cat: 'roast', origin: '英国',
      ppg: 25, lov: 300, mustMash: false, maxPct: 10, dp: 'none', fermentable: 'none',
      flavor: '干爽的咖啡焦苦，爱尔兰世涛的灵魂', use: '爱尔兰世涛、世涛外销版',
      craft: '未发芽、无酶，不产生可发酵糖；lov 300 的干爽咖啡苦是骨架，5–10% 足够，再多会涩。',
      story: '未发芽大麦直接高温烘烤，是爱尔兰世涛传统上的色与苦来源。爱尔兰酒厂长期用它而不是黑专利麦芽，干爽的咖啡苦因此成了爱尔兰风格与英式世涛的分界。',
      conf: 'A', src: 'Brewing.net 25ppg；Oculyze 25-29ppg',
      note: '未发芽，不产生酶；贡献大量不可发酵色度物质' },

    { id: 'm-carafa2', name: '卡拉法二号（去壳黑麦芽）', en: 'Carafa Special II', cat: 'roast', origin: '德国',
      ppg: 27, lov: 430, mustMash: false, maxPct: 10, dp: 'none', fermentable: 'low',
      flavor: '柔和的巧克力与咖啡，几乎没有焦苦', use: '黑 IPA、黑皮尔森、需要上色不要焦味',
      craft: '去壳处理：同样的 lov 430，却几乎没有焦苦与涩，上限 10%；黑 IPA 想要颜色不要涩时选它。',
      conf: 'C', src: 'Weermann 产品区间 26-28ppg',
      note: '去壳处理，是"只想要颜色不想要涩"时的标准答案' },

    { id: 'm-midnightwheat', name: '午夜小麦（去苦）', en: 'Midnight Wheat', cat: 'roast', origin: '美国',
      ppg: 25, lov: 550, mustMash: false, maxPct: 10, dp: 'none', fermentable: 'low',
      flavor: '极柔和的烘烤感、顺滑', use: '黑 IPA、深色小麦啤调色',
      craft: 'lov 550 却极柔和：小麦去壳后单宁少，上限 10%，适合黑 IPA 与深色小麦啤调色。',
      conf: 'C', src: 'Briess 产品区间 24-26ppg' },

    /* ---------------- 未发芽谷物与片状谷物 ---------------- */
    { id: 'm-flakedoats', name: '燕麦片', en: 'Flaked Oats', cat: 'grain', origin: '—',
      ppg: 32, lov: 2, mustMash: true, maxPct: 30, dp: 'none', fermentable: 'med',
      flavor: '丝滑油润的酒体、绵密泡沫', use: '燕麦世涛、NEIPA 的顺滑感',
      craft: 'dp none，必须与基麦同糖化；β-葡聚糖高，接近上限 30% 时加 5% 稻壳，否则滤槽会堵。',
      conf: 'A', src: 'Brewing.net 33ppg；CaptainBrew 32ppg',
      note: '无酶，必须与基础麦芽同糖化；β-葡聚糖高，加稻壳防堵' },

    { id: 'm-flakedwheat', name: '小麦片', en: 'Flaked Wheat', cat: 'grain', origin: '—',
      ppg: 36, lov: 2, mustMash: true, maxPct: 40, dp: 'none', fermentable: 'high',
      flavor: '面包感、轻微浑浊与泡沫', use: '小麦啤、兰比克',
      craft: 'dp none、上限 40%：给小麦啤提供浑浊与泡沫，超过 40% 过滤会非常吃力，洗糟时间明显变长。',
      conf: 'B', src: 'CaptainBrew 36ppg' },

    { id: 'm-flakedbarley', name: '大麦片', en: 'Flaked Barley', cat: 'grain', origin: '—',
      ppg: 32, lov: 2, mustMash: true, maxPct: 20, dp: 'none', fermentable: 'med',
      flavor: '厚重酒体、极佳泡沫、微谷物味', use: '爱尔兰世涛增加"奶油感"',
      craft: 'dp none、上限 20%：爱尔兰世涛里 5–10% 提供奶油般的酒体与极稳的泡沫，代价是洗糟稍慢。',
      conf: 'A', src: 'Brewing.net 32ppg；CaptainBrew 32ppg' },

    { id: 'm-flakedcorn', name: '玉米片', en: 'Flaked Corn (Maize)', cat: 'grain', origin: '—',
      ppg: 39, lov: 1, mustMash: true, maxPct: 40, dp: 'none', fermentable: 'high',
      flavor: '中性、轻微甜玉米，稀释麦芽味', use: '美式拉格、奶油艾尔',
      craft: 'ppg 39 高于多数麦芽，但 dp none：它稀释麦芽味、提高可发酵糖比例，美式拉格常 20–30%。',
      conf: 'A', src: 'CaptainBrew 39ppg；Oculyze 35-37ppg' },

    { id: 'm-flakedrice', name: '大米片', en: 'Flaked Rice', cat: 'grain', origin: '—',
      ppg: 38, lov: 1, mustMash: true, maxPct: 40, dp: 'none', fermentable: 'high',
      flavor: '极度中性、干爽收口', use: '美式淡爽拉格',
      craft: 'dp none、风味极中性：美式淡爽拉格用它把酒体做薄，20–30%；接近上限 40% 会显得空洞。',
      conf: 'A', src: 'CaptainBrew 38ppg；Oculyze 30-32ppg' },

    { id: 'm-unmaltedwheat', name: '生小麦（未发芽）', en: 'Unmalted Wheat', cat: 'grain', origin: '—',
      ppg: 36, lov: 2, mustMash: true, maxPct: 50, dp: 'none', fermentable: 'high',
      flavor: '更生的谷物感、浑浊与泡沫', use: '比利时小麦白啤、兰比克',
      craft: 'dp none、上限 50%：比利时小麦白啤常与小麦麦芽各半，生小麦给更生的谷物感与更重的浑浊。',
      conf: 'B', src: '通行值 36ppg' },

    { id: 'm-oatsmalt', name: '燕麦麦芽', en: 'Oat Malt', cat: 'grain', origin: '英国',
      ppg: 32, lov: 2, mustMash: true, maxPct: 20, dp: 'low', fermentable: 'med',
      flavor: '比燕麦片更有坚果与谷物层次', use: '精酿世涛提升复杂度',
      craft: 'dp low：能自转化但酶力弱，上限 20%；比燕麦片多一层坚果香，代价是过滤更慢、更容易堵。',
      conf: 'C', src: '区间估值 30-34ppg' },

    { id: 'm-ryehull', name: '稻壳（滤槽助剂）', en: 'Rice Hulls', cat: 'grain', origin: '—',
      ppg: 0, lov: 0, mustMash: true, maxPct: 5, dp: 'none', fermentable: 'none',
      flavor: '无味，纯粹为了让麦醪疏松', use: '高小麦/燕麦/黑麦配方的必备保险',
      craft: 'ppg 为 0，不贡献糖度，只在物料平衡里占体积；高小麦、燕麦、黑麦配方加 3–5% 就够疏松滤层。',
      conf: 'A', src: '公认无糖贡献', note: '不计算糖度，只在物料平衡里占体积' },

    /* ---------------- 糖与糖浆：100% 可发酵，不受糖化效率影响 ---------------- */
    { id: 'm-dextrose', name: '葡萄糖（玉米糖）', en: 'Dextrose (Corn Sugar)', cat: 'sugar', origin: '—',
      ppg: 46, lov: 0, mustMash: false, maxPct: 20, dp: 'none', fermentable: 'full',
      flavor: '中性，纯粹增酒精与干爽感', use: '双料 IPA 提干、装瓶碳化',
      craft: 'ppg 46 且 100% 可发酵：上限 20% 以内提干，再多酒体变薄。装瓶碳化时注意它是一水合物，含约 9% 结晶水。',
      conf: 'A', src: 'CaptainBrew 46ppg；化学计量 4.42g/L/vol CO2',
      note: '一水合物，含约 9% 结晶水，所以碳化用量比蔗糖多' },

    { id: 'm-sucrose', name: '蔗糖（白砂糖）', en: 'Sucrose (Table Sugar)', cat: 'sugar', origin: '—',
      ppg: 46, lov: 0, mustMash: false, maxPct: 15, dp: 'none', fermentable: 'full',
      flavor: '完全中性，超过 10% 会有苹果般的酯香', use: '比利时风格增干、装瓶碳化',
      craft: 'ppg 46、完全可发酵：上限 15%，超过 10% 会出苹果般的酯香；比利时风格常 10–15% 用来增干。',
      conf: 'A', src: 'CaptainBrew 46ppg；化学计量 3.82g/L/vol CO2' },

    { id: 'm-candiclear', name: '比利时透明糖浆', en: 'Candi Syrup (Clear)', cat: 'sugar', origin: '比利时',
      ppg: 40, lov: 0, mustMash: false, maxPct: 20, dp: 'none', fermentable: 'full',
      flavor: '中性偏甜，比白糖多一点圆润', use: '比利时金色艾尔',
      craft: '置信度 C，各品牌含水率不同：按 40ppg 试算后用实测比重回调。风味中性，主要作用是增干。',
      conf: 'C', src: '区间估值 38-42ppg，各品牌含水率不同' },

    { id: 'm-candid180', name: '比利时深色糖浆 D-180', en: 'Candi Syrup D-180', cat: 'sugar', origin: '比利时',
      ppg: 32, lov: 180, mustMash: false, maxPct: 20, dp: 'none', fermentable: 'full',
      flavor: '黑糖蜜、李子、烤糖，带轻微苦韵', use: '比利时四料、深色烈性艾尔',
      craft: 'lov 180 而 ppg 只有 32（含水与焦糖化损耗）：给黑糖蜜与李子，比利时四料常 10–20%。',
      conf: 'C', src: 'Dark Candi 产品区间 30-34ppg' },

    { id: 'm-lactose', name: '乳糖', en: 'Lactose', cat: 'sugar', origin: '—',
      ppg: 43, lov: 0, mustMash: false, maxPct: 10, dp: 'none', fermentable: 'none',
      flavor: '不可发酵的奶甜，增加酒体与甜度', use: '牛奶世涛、甜味果啤',
      craft: '可发酵性为零：酵母完全不吃，43ppg 全部留在酒里变成甜度与热量，OG 预测时要把它算进去。',
      conf: 'A', src: '公认不可发酵；43ppg 为通行值',
      note: '酵母无法利用，全部残留在酒里，热量也算进去' },

    { id: 'm-maltodextrin', name: '麦芽糊精', en: 'Maltodextrin', cat: 'sugar', origin: '—',
      ppg: 40, lov: 0, mustMash: false, maxPct: 10, dp: 'none', fermentable: 'none',
      flavor: '几乎无味，纯粹加厚酒体', use: '想让 4% 酒精度喝起来像 5%',
      craft: '可发酵性为零、几乎无味：只加酒体不加甜，5–8% 能让 4% 的酒喝起来像 5%。',
      conf: 'B', src: '通行值 40ppg' },

    /* ---------------- 提取物：免糖化，效率按 100% ---------------- */
    { id: 'm-dme-light', name: '淡色干麦芽提取物', en: 'Light Dry Malt Extract (DME)', cat: 'extract', origin: '—',
      ppg: 44, lov: 2, mustMash: false, maxPct: 100, dp: 'none', fermentable: 'high',
      flavor: '干净的麦芽甜，略带提取物特有的圆钝', use: '提取物酿造、补糖度、扩培酵母',
      craft: 'ppg 44、效率按 100%：可 100% 作为糖来源；补糖度时 0.5–2kg 直接溶解，不必进糖化锅。',
      conf: 'A', src: 'Brewing.net 44ppg' },

    { id: 'm-lme-light', name: '淡色液态麦芽提取物', en: 'Light Liquid Malt Extract (LME)', cat: 'extract', origin: '—',
      ppg: 36, lov: 2, mustMash: false, maxPct: 100, dp: 'none', fermentable: 'high',
      flavor: '同上，但含水约 20%', use: '新手首酿最省事的选择',
      craft: 'ppg 36 比 DME 低 8 点，因为含约 20% 水：同重量换用要按 36/44 折算，否则 OG 会低一截。',
      conf: 'A', src: 'Brewing.net 36ppg',
      note: 'LME 含约 20% 水，同重量比 DME 少约 18% 糖；开封后易吸潮结块' },

    { id: 'm-rmalt', name: '米糖糖浆固体', en: 'Rice Syrup Solids', cat: 'extract', origin: '—',
      ppg: 43, lov: 0, mustMash: false, maxPct: 30, dp: 'none', fermentable: 'full',
      flavor: '几乎完全中性', use: '美式淡爽型增酒精',
      craft: '置信度 C、风味几乎中性：上限 30% 用来提酒精而不加麦芽味，美式淡爽型常用。',
      conf: 'C', src: '区间估值 42-44ppg' },

    /* ==========================================================================
     * v1.7 追加：家酿者买得到、但 v1.5 之前库里没有的品类
     * --------------------------------------------------------------------------
     * 选取标准是"国外家酿店常备 + 国内精酿圈在用"，不是凑数：
     *   · 英国基础麦：Mild Ale Malt（温和艾尔），英式苦啤的传统基麦
     *   · 德国 Weyermann 焦糖/烘烤系列：CaraHell / CaraRed / CaraMunich I /
     *     CaraAmber / CaraWheat / Carafa Special III / Roasted Wheat
     *   · 小麦与黑麦的细分：Dark Wheat / Spelt / Chocolate Rye / Flaked Rye
     *   · 烟熏类：Beechwood（榉木）/ Peated（泥煤），两者酶力与酚强度完全不同
     *   · 工艺型：Chit Malt（改性不足、专为泡沫）、Torrified Wheat（焦化小麦）
     *   · 去苦深色：Blackprinz（Briess）
     *   · 糖：Invert No.2（英国转化糖浆）、Candi D-90
     * 每条都写了 src；色度若来自 EBC，已按 EBC ÷ 1.97 换算成 lov 并在 src 注明原值。
     * ========================================================================*/

    { id: 'm-mild', name: '温和艾尔麦芽', en: 'Mild Ale Malt', cat: 'base', origin: '英国',
      ppg: 37, lov: 5, mustMash: true, maxPct: 100, dp: 'high', fermentable: 'high',
      flavor: '烤面包皮、坚果、比 Maris Otter 更干一点', use: '英式温和艾尔、苦啤、棕色艾尔的基麦',
      craft: '酶系完整、可 100% 作基麦；lov 5 比淡色艾尔深一档，风味是"烤过的饼干皮"而不是焦糖。用它替 MO，酒会更干、更少蜂蜜甜。',
      conf: 'B', src: 'Simpsons / Thomas Fawcett 产品规格 5-7 EBC（≈3-3.5 lov），ppg 37 为英式基麦通行值',
      ebc: 6 },

    { id: 'm-chit', name: '吉特麦芽（改性不足）', en: 'Chit Malt', cat: 'kiln', origin: '比利时/德国',
      ppg: 31, lov: 2, mustMash: true, maxPct: 15, dp: 'med', fermentable: 'med',
      flavor: '生青谷物、几乎不甜，作用是泡沫与酒体', use: '浑浊 IPA / NEIPA 加泡沫挂杯与浑浊度',
      craft: '只轻微发芽、刻意不充分改性：蛋白与 β-葡聚糖高，5-10% 就能明显加厚泡沫。ppg 只有 31，别拿它当基麦；超过 15% 洗糟变慢。',
      conf: 'C', src: 'Bestmalz / Weyermann Chit Malt 规格方向（低浸出、高蛋白），未取得双源数值——按批次 COA' },

    { id: 'm-spelt', name: '斯佩尔特麦芽', en: 'Spelt Malt', cat: 'base', origin: '德国',
      ppg: 36, lov: 2, mustMash: true, maxPct: 30, dp: 'high', fermentable: 'high',
      flavor: '面包、坚果、微微的辛香，比小麦更"野"', use: '赛松、农家艾尔、混合谷物配方',
      craft: '酶力够用、可作基麦，但蛋白高、壳薄，超过 30% 洗糟会拖。风味比小麦多一层坚果与辛香，是赛松里最省事的"杂粮感"来源。',
      conf: 'B', src: 'Weyermann Spelt Malt：3.5-6.5 EBC、浸出率约 78%（≈36 ppg）',
      ebc: 5, extractFG: 78 },

    { id: 'm-darkwheat', name: '深色小麦麦芽', en: 'Dark Wheat Malt', cat: 'kiln', origin: '德国',
      ppg: 37, lov: 9, mustMash: true, maxPct: 15, dp: 'high', fermentable: 'high',
      flavor: '面包皮、淡焦糖边、深色小麦啤的骨架', use: '邓克尔小麦（Dunkelweizen）、深色小麦博克',
      craft: 'lov 9 给邓克尔小麦上色却不带烘烤苦；它仍算小麦，和小麦基麦合起来别超过总谷物的一半，否则滤槽必堵。',
      conf: 'B', src: 'Weyermann Dark Wheat Malt：15-20 EBC（≈8-10 lov）',
      ebc: 17 },

    { id: 'm-carahell', name: '卡拉海尔（浅焦糖）', en: 'Carahell', cat: 'crystal', origin: '德国',
      ppg: 35, lov: 11, mustMash: true, maxPct: 15, dp: 'none', fermentable: 'low',
      flavor: '蜂蜜、淡焦糖、圆润酒体', use: '拉格与淡色艾尔的"加体不加色"',
      craft: '最浅的焦糖麦芽之一：给酒体与蜂蜜甜，色度几乎看不出来。结晶类无酶，上限 15%，再多会腻且 FG 抬高。',
      conf: 'B', src: 'Weyermann Carahell：20-30 EBC（≈10-15 lov）、浸出率 75%',
      ebc: 25, extractFG: 75 },

    { id: 'm-carared', name: '卡拉红', en: 'CaraRed', cat: 'crystal', origin: '德国',
      ppg: 34, lov: 19, mustMash: true, maxPct: 15, dp: 'none', fermentable: 'low',
      flavor: '红色果脯、焦糖、暖色调', use: '爱尔兰红艾、红色艾尔',
      craft: 'lov 19 正好卡在"红"而不是"棕"：8-12% 能把酒染成宝石红，再多就转成厚重的焦糖味。',
      conf: 'B', src: 'Weyermann CaraRed：40-60 EBC（≈20-30 lov）、浸出率 75%',
      ebc: 50, extractFG: 75 },

    { id: 'm-caramunich1', name: '卡拉慕尼黑一型', en: 'CaraMunich Type I', cat: 'crystal', origin: '德国',
      ppg: 34, lov: 34, mustMash: true, maxPct: 15, dp: 'none', fermentable: 'low',
      flavor: '焦糖、葡萄干、烤面包 crust', use: '慕尼黑风格、琥珀艾尔、博克',
      craft: '比 CaraRed 深一档，给的是"慕尼黑麦芽的焦糖面"：8-10% 就有明显琥珀色和葡萄干味，做深色博克时它比结晶 60L 更"欧洲"。',
      conf: 'B', src: 'Weyermann CaraMunich Type I：80-100 EBC（≈40-50 lov）',
      ebc: 90 },

    { id: 'm-caraamber', name: '卡拉琥珀', en: 'CaraAmber', cat: 'crystal', origin: '德国',
      ppg: 34, lov: 30, mustMash: true, maxPct: 15, dp: 'none', fermentable: 'low',
      flavor: '烤面包、蜂蜜焦糖、琥珀色', use: '琥珀艾尔、十月节、英式苦啤',
      craft: '色度与 CaraMunich I 接近，但风味更偏"烤面包"、甜感更直接；做十月节时它比慕尼黑麦芽省事（不用占基麦比例）。',
      conf: 'B', src: 'Weyermann CaraAmber：60-80 EBC（≈30-40 lov）',
      ebc: 70 },

    { id: 'm-carawheat', name: '焦糖小麦麦芽', en: 'Caramel Wheat Malt', cat: 'crystal', origin: '德国',
      ppg: 34, lov: 45, mustMash: true, maxPct: 15, dp: 'none', fermentable: 'low',
      flavor: '焦糖化的小麦面包、微酸', use: '小麦博克、深色小麦啤',
      craft: '结晶化的小麦：同时给小麦的面包香和焦糖，做小麦博克比"小麦 + 结晶麦芽"两步更干净。上限仍按结晶类算。',
      conf: 'B', src: 'Weyermann Caramel Wheat：80-100 EBC（≈40-50 lov）',
      ebc: 90 },

    { id: 'm-carafa3', name: '卡拉法三号（去壳去苦）', en: 'Carafa Special III', cat: 'roast', origin: '德国',
      ppg: 29, lov: 525, mustMash: true, maxPct: 10, dp: 'none', fermentable: 'low',
      flavor: '黑咖啡、可可，几乎没有涩与烟熏', use: '黑啤上色、需要"黑而不苦"的风格',
      craft: '"Special"是去壳脱苦工艺：同样深却几乎没有黑麦芽的涩与烟熏。lov 525 极深，3-5% 就够；超 10% 仍会发苦，只是苦得晚。',
      conf: 'B', src: 'Weyermann Carafa Special III：1200-1400 EBC（≈610-710 lov，取中值偏保守）',
      ebc: 1300 },

    { id: 'm-chocrye', name: '巧克力黑麦麦芽', en: 'Chocolate Rye Malt', cat: 'roast', origin: '美国/德国',
      ppg: 30, lov: 200, mustMash: true, maxPct: 10, dp: 'none', fermentable: 'low',
      flavor: '黑巧克力、黑麦辛辣、收口干', use: '黑麦世涛、黑麦波特',
      craft: '黑麦的辛辣烘烤后变成"黑巧克力 + 胡椒"：5-8% 就够，它比同色巧克力麦芽更干、更不甜。',
      conf: 'C', src: 'Briess Chocolate Rye 188-231 °L（取中值 200）；ppg 30 为烘烤麦芽区间估算' },

    { id: 'm-roastwheat', name: '烘烤小麦（去壳）', en: 'Roasted Wheat', cat: 'roast', origin: '德国',
      ppg: 33, lov: 450, mustMash: true, maxPct: 10, dp: 'none', fermentable: 'low',
      flavor: '深烘面包、可可、比大麦烘烤更"圆"', use: '深色小麦啤、世涛的柔性深色',
      craft: '烘烤小麦的苦比烘烤大麦软，适合"要黑但不要焦"的深色小麦啤；3-6% 足够，多了同样是炭味。',
      conf: 'C', src: 'Weyermann Roasted Wheat 800-1000 EBC（≈406-508 lov，取 450）；ppg 33 为区间估值' },

    { id: 'm-blackprinz', name: '黑王子（去苦深色）', en: 'Blackprinz Malt', cat: 'roast', origin: '美国',
      ppg: 28, lov: 500, mustMash: true, maxPct: 10, dp: 'none', fermentable: 'low',
      flavor: '温和烤谷物、可可，苦味很低', use: '黑 IPA、需要颜色不要焦苦的配方',
      craft: 'Briess 的去苦深色麦芽：lov 500 但单宁低，黑 IPA 里 5% 就有黑色而不带焦糊。ppg 只有 28，上色同时会拉低 OG。',
      conf: 'B', src: 'Briess Blackprinz：500 °L、浸出率约 61%（≈28 ppg）',
      ebc: 985 },

    { id: 'm-beechwood', name: '榉木烟熏麦芽', en: 'Beechwood Smoked Malt', cat: 'base', origin: '德国',
      ppg: 37, lov: 2, mustMash: true, maxPct: 100, dp: 'high', fermentable: 'high',
      flavor: '干净的木烟、火腿般的烟熏，不刺鼻', use: '德国烟熏啤（Rauchbier）、波特、烟熏世涛',
      craft: '它是完整的基麦（酶系齐全），班贝格烟熏啤可以 100% 用它；烟熏强度近似线性叠加，30% 已经很明显，50% 以上就是"液体培根"。',
      conf: 'B', src: 'Weyermann Beechwood Smoked Malt：3-6 EBC（≈1.5-3 lov），基麦级酶力',
      ebc: 4.5 },

    { id: 'm-peated', name: '泥煤烟熏麦芽', en: 'Peated Malt', cat: 'kiln', origin: '英国（苏格兰）',
      ppg: 36, lov: 2.5, mustMash: true, maxPct: 10, dp: 'high', fermentable: 'high',
      flavor: '泥煤、碘酒、药味，强度远高于榉木烟熏', use: '苏格兰艾尔、世涛的"泥煤"版本',
      craft: '酚值（ppm）按批次差异极大，这是它只能标 C 的原因。5% 就有明显泥煤，超过 10% 会盖住麦芽与酒花，且酚味和酵母酯香容易打架。',
      conf: 'C', src: 'Simpsons Peated Malt 规格 2-4 EBC；酚值 ppm 各批不同，必须看批次单' },

    { id: 'm-torrifiedwheat', name: '焦化小麦（未发芽）', en: 'Torrified Wheat', cat: 'grain', origin: '英国',
      ppg: 36, lov: 1.8, mustMash: true, maxPct: 20, dp: 'none', fermentable: 'high',
      flavor: '清淡谷物、几乎不甜，撑泡沫与口感', use: '英式苦啤、淡色艾尔的泡沫与酒体',
      craft: '未发芽、无酶，必须和基麦一起糖化。英国苦啤里 5-10% 是传统做法：它带壳，比小麦片好过滤，20% 以内不会堵。',
      conf: 'B', src: '英国麦芽商通行规格：1.5-2.5 EBC（≈0.8-1.3 lov）、36 ppg',
      ebc: 3.5 },

    { id: 'm-flakedrye', name: '黑麦片', en: 'Flaked Rye', cat: 'grain', origin: '美国',
      ppg: 34, lov: 2, mustMash: true, maxPct: 20, dp: 'none', fermentable: 'high',
      flavor: '油滑、干爽、胡椒般的辛辣', use: '黑麦 IPA、罗格、农场艾尔',
      craft: '比黑麦麦芽少了麦芽甜、多了油滑口感；β-葡聚糖同样高，超 20% 要配 3-5% 稻壳并做蛋白质休止。',
      conf: 'B', src: 'Briess / 家酿通行值 34 ppg、2 °L' },

    { id: 'm-invert2', name: '转化糖浆二号', en: 'Invert Sugar No.2', cat: 'sugar', origin: '英国',
      ppg: 36, lov: 8, mustMash: false, maxPct: 20, dp: 'none', fermentable: 'full',
      flavor: '淡淡焦糖、干净的甜，收口快', use: '英式苦啤、温和艾尔、老艾尔',
      craft: '英国传统酿造糖：100% 可发酵，会把酒体做薄——这正是英式苦啤"一杯接一杯"的来源。No.2 带浅琥珀色，替白糖能多一层焦糖。',
      conf: 'C', src: 'Ragus 转化糖浆产品区间（No.2 浅琥珀，糖度约 80%），色度按等级估',
      ebc: 16 },

    { id: 'm-candid90', name: '比利时深色糖浆 D-90', en: 'Candi Syrup D-90', cat: 'sugar', origin: '比利时/美国',
      ppg: 32, lov: 90, mustMash: false, maxPct: 20, dp: 'none', fermentable: 'full',
      flavor: '枣、焦糖、轻微烘烤，收口干', use: '比利时双料、四料、深色烈性艾尔',
      craft: 'D-90 比 D-180 温和：给双料上色与枣香，同时 100% 可发酵，让 9% 的酒"烈而干"。10-20% 是常规区间，超过 20% 会明显"糖浆味"。',
      conf: 'B', src: 'Candi Syrup Inc. D-90：90 °L、32 ppg',
      ebc: 177 }
  ];

  /* 分类中文名，给 UI 用 */
  BREW.DB.maltCats = {
    base:    { zh: '基础麦芽', desc: '构成配方主体，酶系完整可自转化', color: '#bea973' },
    kiln:    { zh: '窑烤麦芽', desc: '增加颜色与麦芽香气，多数仍可自转化', color: '#b5925f' },
    crystal: { zh: '结晶麦芽', desc: '糖化前已完成糖化，主要贡献甜度与色度', color: '#a97c53' },
    roast:   { zh: '烘烤谷物', desc: '高温烘烤，用量小、风味强，贡献焦苦与色深', color: '#695647' },
    grain:   { zh: '未发芽谷物', desc: '无酶，必须与基础麦芽同糖化，需防滤槽堵塞', color: '#a2987c' },
    sugar:   { zh: '糖与糖浆', desc: '完全可发酵（乳糖/糊精除外），不受糖化效率影响', color: '#c4c4c4' },
    extract: { zh: '麦芽提取物', desc: '免糖化，直接溶于水，效率按 100% 计', color: '#988462' }
  };

  /* ==========================================================================
   * 品类导览（第一层文案）
   * --------------------------------------------------------------------------
   * 用户拿着筛出来的一屏"基础麦芽"时，最缺的不是参数，而是"这一类到底怎么用"。
   * 这里按 cat 分组各写一篇：是什么 / 在配方里干什么 / 用多少 / 最容易错在哪。
   * 只写有把握的工艺通识：不点年份、不点酒厂、不点培育者。数字全部引用本表的
   * maxPct / lov / dp / ppg 口径，不另造一套。
   * ========================================================================*/
  BREW.DB.catGuides = BREW.DB.catGuides || {};
  BREW.DB.catGuides.malt = [
    {
      key: 'base', zh: '基础麦芽', keys: ['base'],
      lead: '占配方的 60–100%，其余麦芽都是围着它转的配角。',
      what: '基础麦芽是浸麦、发芽后再低温干燥的谷物，干燥温度低，淀粉酶与蛋白酶都保留了下来。它同时提供两样东西：可被糖化的淀粉，和能切开淀粉的酶。后者最容易被忽略——特种麦芽也有淀粉或糖，却几乎没有酶。本库这一类 ppg 集中在 35–37、色度 2–3.5L、dp 标 high 或 veryhigh。',
      role: '它决定 OG 的上限、决定发酵度的大致范围，也决定酒里那层"麦芽底味"。Maris Otter 的饼干、Golden Promise 的蜂蜜甜、慕尼黑的烤面包皮，都是基麦自己在说话。换基麦比加香料更能改变一款酒的国籍，因为它是 60% 以上的体积。',
      dose: '常规 70–100%。辅料（玉米、大米、糖）越多，基麦比例越低，酶力越要留余量。小麦基麦不超过 70%、黑麦不超过 30%，不是为了风味，而是为了滤槽还能过滤。',
      mistakes: [
        '全用特种麦芽：没有酶，糖化效率会掉到一半以下，最后只能靠提取物救场。',
        '把基麦当"没味道的填充"：英式、德式、美式的差别有一半在基麦，一律用最便宜的二棱，风格就没了。',
        '忽略不同基麦的 ppg 差：35 与 37 差 5%，20L 的 5kg 配方就是 0.25kg 糖，OG 会偏 1–2 点。'
      ]
    },
    {
      key: 'kiln', zh: '窑烤麦芽', keys: ['kiln'],
      lead: '给麦芽骨架加中段风味：烤面包、饼干、坚果，色度 20–30L。',
      what: '基础麦芽再进窑炉烘一段，温度比结晶麦芽低、时间更长，所以淀粉还在、酶还剩一部分（dp 多为 med 或 low）。色度落在 20–30L，正好是"有颜色但不黑"的区间。美拉德麦芽是特例，它模拟的是长时间剧烈煮沸带来的美拉德反应。',
      role: '它补的是基麦与结晶麦芽之间的空档：结晶给甜、烘烤给苦，窑烤给"烤过的谷物香"。想要更厚的麦芽骨架又不想加甜，加它比加结晶麦芽合适；想替代复杂的煮出糖化，就用美拉德麦芽。',
      dose: '5–15%。美拉德、饼干、芳香这三类上限只有 10%，dp 为 low 的品种超过 15% 会明显拖慢糖化，糖化效率也会降。',
      mistakes: [
        '指望它给深色：20–30L 堆到 20% 也只有琥珀，要黑得靠烘烤谷物或深色结晶。',
        '当基麦用到 50% 以上：dp low 的酶不够，糖化时间翻倍，糖化效率还下降。',
        '与结晶麦芽叠加却不减量：两类都带明显甜香，加起来容易"甜得发闷"。'
      ]
    },
    {
      key: 'crystal', zh: '结晶麦芽', keys: ['crystal'],
      lead: '糖已经替你做好了：直接给甜、给色、给酒体。',
      what: '麦粒在湿润状态下先升温糖化，把淀粉转成糖，再烘到干脆——糖被锁在玻璃质的胚乳里。所以这一类 mustMash 为否、dp 为 none：它不依赖你的糖化方案，投多少就贡献多少甜与色，比任何基麦都可预测。',
      role: '甜度、酒体、颜色三件事一次完成，是英式苦啤、琥珀艾尔、IPA 酒体支撑的主力。色度从 10L 到 150L 是一条连续的梯子：浅的给蜜瓜与蜂蜜，深的给葡萄干、黑糖蜜与焦苦。同一个色度下不同厂商的残糖与苦韵也不一样。',
      dose: '3–15%；120L 以上 3–8%，150L 以上 2–5%。它贡献的是不可发酵糖，用量会直接抬高 FG——这是它和糖、和基麦最本质的区别。',
      mistakes: [
        '拿结晶麦芽代替基麦：无酶，超过 20% 糖化效率与发酵度会同时下降。',
        '只盯着颜色挑：两支同为 60L 的结晶麦，甜感与苦韵可以差很多，色度不是风味的全部。',
        '深色结晶用过量：120L、150L 带焦苦，超过 8% 会把酒花的柑橘香压成一片模糊的甜苦。'
      ]
    },
    {
      key: 'roast', zh: '烘烤谷物', keys: ['roast'],
      lead: '1–10% 决定这杯酒是"深色"还是"黑"。',
      what: '高温烘烤到 300–550L，淀粉与酶基本被破坏：dp 为 none，可发酵性多为 none 或 low。它贡献色度、焦苦、咖啡与巧克力，以及大量类黑精与酸性物质。去壳品种（Carafa Special、Midnight Wheat）把谷壳去掉，同样的色度却几乎没有涩味。',
      role: '世涛与波特的骨架。除了味与色，它还有一个常被忽略的作用：把糖化醪的 pH 拉低。深色配方里 5% 的黑专利，可能让 pH 掉 0.1–0.2，酶活性与酒花苦感都会跟着变。',
      dose: '带壳烘烤麦芽 3–10%，黑专利 1–3%，去壳品种可到 10%。这一类用量按百分点算：5kg 谷物的 1% 就是 50g，比重称到克即可，不必纠结小数点。',
      mistakes: [
        '认为越多越黑越好：超过 10% 出灰烬、焦油与明显涩口，酒体反而变薄。',
        '分不清带壳与去壳：同样的色度，去壳品种几乎没有涩味，黑 IPA 用错就会又苦又涩。',
        '忽略 pH：深色配方照搬浅色酒的水质，糖化 pH 掉到 5.0 以下，糖化效率与风味一起受损。'
      ]
    },
    {
      key: 'grain', zh: '未发芽谷物', keys: ['grain'],
      lead: '没有酶，只出糖化锅里的"口感"与"过滤难度"。',
      what: '燕麦片、小麦片、玉米片、大米片、生小麦——压片或生谷物，dp 全为 none。它们必须和基麦一起糖化，靠基麦的酶把淀粉切开；单独糖化只会得到一锅淀粉糊。稻壳是唯一的例外：它不贡献任何糖，只为让麦醪疏松。',
      role: '调节口感与泡沫：燕麦给丝滑，大麦片给奶油感与极稳的泡沫，小麦给浑浊，玉米与大米把酒体做薄、把麦芽味稀释。想在某一个维度做加法又不想动色度时，这一类比结晶麦芽干净；但它们不提供酶力，不能算进"基麦"比例里。',
      dose: '5–40%：玉米片与大米片可到 40%，燕麦片 30%，生小麦 50%。超过 20% 的高 β-葡聚糖谷物，配 3–5% 稻壳，洗糟才不会变成体力活。',
      mistakes: [
        '单独糖化或直接撒进煮沸锅：没有酶，淀粉不会被转化，等于白投。',
        '不加稻壳又堆到上限：燕麦、小麦、黑麦一起上，滤槽会堵到怀疑人生。',
        '忘记它们也算总谷物重：吸水率、洗糟水量、糖化锅容积都要按总重算，否则第一批麦汁就溢出来。'
      ]
    },
    {
      key: 'sugar', zh: '糖与糖浆', keys: ['sugar'],
      lead: '把"麦芽甜"换成"酒精"，顺便把酒体做薄。',
      what: '蔗糖、葡萄糖、比利时糖浆、乳糖、麦芽糊精：mustMash 全为否、效率按 100% 计。ppg 46 的意思是 1 磅糖在 1 加仑水里贡献 46 点比重。乳糖与麦芽糊精是例外——它们不可发酵，会全部留在酒里变成甜度与热量。',
      role: '三件事：提干（FG 更低、酒精更高、酒体更薄）、调色（D-180 这类深色糖浆带色带味）、保留甜度（乳糖让牛奶世涛甜而不腻）。比利时风格用它把 8% 的酒做得像 6% 一样易饮，这就是"增干"的价值。',
      dose: '5–20%。比利时金艾、双料常 10–20%，超过 20% 会出现明显"糖味"与苹果酯。乳糖 5–10%，糊精 5–8%。',
      mistakes: [
        '糖替代太多基麦：麦芽香与酒体被一起稀释，喝起来像兑了水。',
        '把乳糖、糊精当可发酵糖算 OG：它们不发酵，FG 会比预测高、酒精比预测低。',
        '装瓶碳化混用葡萄糖与蔗糖的系数：葡萄糖是一水合物，含约 9% 结晶水，同体积碳化要加得更多。'
      ]
    },
    {
      key: 'extract', zh: '麦芽提取物', keys: ['extract'],
      lead: '别人替你糖化好了，你只负责溶解。',
      what: '麦芽汁真空浓缩后的粉末（DME）或糖浆（LME），mustMash 为否、效率 100%。DME 约 44ppg；LME 含约 20% 水，所以只有 36ppg——同重量换用必须折算，否则 OG 会低一截。',
      role: '新手第一锅最省事的路径，也是补糖度、扩培酵母时的干净培养基。它的问题不是"不纯"，而是风味层次单一：提取物缺少糖化过程带来的多样糖谱与微量物质，做出来的酒容易圆钝，FG 也常比全麦芽配方略高。',
      dose: '可以 100% 作为糖来源；补糖度时 0.5–2kg。替换部分基麦时按 ppg 等量换算：1kg DME 约等于 1.2kg 常规基麦。',
      mistakes: [
        '把 LME 按 DME 的 44ppg 算：结果是 OG 系统性偏低，而且每次都低。',
        '高比例提取物却不加酵母营养盐：缺游离氨基氮与锌，发酵容易停滞或出硫。',
        '为了"有味道"狂加特种麦芽：提取物配方本身发酵度偏低，再堆结晶麦芽会又甜又腻。'
      ]
    }
  ];

})(typeof window !== 'undefined' ? window : globalThis);
