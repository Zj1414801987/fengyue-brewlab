/* ============================================================================
 * 风月酿研所 — 11 酒花数据库
 * ----------------------------------------------------------------------------
 * 关键概念说明：
 *   aa    α酸（Alpha Acid）质量百分比。**这是 IBU 计算的唯一原料输入**，
 *         同一品种不同年份、不同产地能差 ±30%，所以配方里必须允许手动覆盖。
 *   beta  β酸。影响"陈化后的苦味稳定性"，对新鲜酒花影响不大。
 *   coh   合葎草酮（Cohumulone）占总 α酸的比例。越高，苦味越"尖锐粗粝"；
 *         越低越"圆润柔和"。贵族酒花通常 <25%，CTZ 系可到 40%+。
 *
 * 数据口径：aa 取两套独立参考表的交集区间中值（见各条 src）。
 *          标 C 级的品种**必须查当年厂商 COA**，不同年份能差 3 个百分点。
 *
 * 文案层（v1.4 追加，与数值分层）：
 *   grp   = 香型分组（noble/citrus/resin/floral/earthy/highaa/exp），品类导览按它分篇，
 *           与 type（苦花/香花/双用途）是两个正交的维度，别混用。
 *   craft = 酿造要点，只解释本条已有的 aa / coh / beta / type 意味着什么，不引入新事实。
 *   story = 来历，只给有明确记载的 11 个品种；其余留空，界面对空值有说明文案。
 *
 * v1.7 追加的参数层（**全部选填**）：
 *   totalOil      总精油 mL/100g   香气强度上限；干投能出多少香，先看它
 *   myrcene       月桂烯 %油       柑橘/松针前体，高则香气外放、也更容易氧化
 *   humulene      葎草烯 %油       辛香与"酒花香"的骨架，低则香气偏单薄
 *   caryophyllene 石竹烯 %油       胡椒与木质调，与 humulene 一起决定"贵族感"
 *   hsi           储存指数 %       20°C 放 6 个月后 α 的保留率；低 = 要趁新鲜用
 *   year          年份             酒花是农产品，配方里应按当年批次记录
 * 这六项**绝大多数留空**：它们随年份/产地波动比 α 更大，没有 COA 就写死等于编。
 * 全库只有 Cascade / Citra / Saaz 三条填了 totalOil，且标了"C 级估值"。
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  BREW.DB = BREW.DB || {};

  /* type: bitter 苦花 | aroma 香花 | dual 双用途 */
  BREW.DB.hops = [
    /* ================= 美式柑橘/热带水果系（新世纪主流） ================= */
    { id: 'h-cascade', name: '卡斯卡特', en: 'Cascade', origin: '美国', type: 'dual',
      aa: 6.5, aaMin: 5.5, aaMax: 7.5, beta: 5.5, coh: 33,
      aroma: ['葡萄柚', '柑橘', '花香'], use: '美式淡色艾尔的标志性酒花，干投与回旋都合适',
      subs: 'Centennial（更强烈）、Amarillo（更甜）',
      grp: 'citrus',
      craft: 'α 6.5% 属中低，撑 60 分钟主苦要很大用量；它的价值在 15 分钟之后与干投，葡萄柚香只有后段才留得住。',
      story: '1972 年由美国农业部在俄勒冈州推出，亲本是英国的 Fuggle 与俄国的 Serebrianka。它定义了美式淡色艾尔的葡萄柚香气，也是 80 年代美式精酿起步时最容易买到的香花。',
      /* v1.7：精油只给最常被引用的三支（Cascade / Citra / Saaz），且一律标 C 级估值 */
      psrc: '总精油 0.7-1.5 mL/100g，取中值（C 级，查当年 COA）', totalOil: 1.1,
      conf: 'A', src: 'Brew-Engine 5.5-7.5 / HandWiki 4.5-6 取交集上沿' },

    { id: 'h-centennial', name: '世纪', en: 'Centennial', origin: '美国', type: 'dual',
      aa: 10, aaMin: 9, aaMax: 11.5, beta: 4.5, coh: 29,
      aroma: ['柑橘', '柠檬', '松针'], use: '被称为"超级卡斯卡特"，IPA 主力',
      subs: 'Cascade、Chinook', grp: 'citrus',
      craft: 'α 10% 可兼任主苦与后段；coh 29 让苦味偏圆润，20L 里 15–20g 做 60 分钟主苦不会粗粝。',
      conf: 'A',
      src: 'Brew-Engine 9-11 / HandWiki 9.5-11.5' },

    { id: 'h-citra', name: '西楚', en: 'Citra', origin: '美国', type: 'dual',
      aa: 12.5, aaMin: 11.3, aaMax: 14, beta: 4.5, coh: 22,
      aroma: ['百香果', '荔枝', '柑橘', '热带水果'], use: 'NEIPA 的灵魂，干投量可以很激进',
      subs: 'Mosaic、Galaxy', grp: 'citrus',
      craft: 'α 12.5 而 coh 仅 22，苦味柔和不刺；干投可以很激进，但超过 10g/L 时植物多酚带来的涩与青味会盖过果香。',
      story: '2007 年由美国 Hop Breeding Company 推出（代号 HBC 394），亲本含 Hallertau Mittelfrüh 一系。它把「热带水果」写进 IPA 的主流语言，也带火了浑浊 IPA。',
      psrc: '总精油 2.0-3.0 mL/100g，取中值（C 级，查当年 COA）', totalOil: 2.5,
      conf: 'A',
      src: 'Brew-Engine 11.3-14 / HandWiki 11-13' },

    { id: 'h-mosaic', name: '马赛克', en: 'Mosaic', origin: '美国', type: 'dual',
      aa: 12.5, aaMin: 11.5, aaMax: 13.5, beta: 4.4, coh: 24,
      aroma: ['蓝莓', '芒果', '柑橘', '松针', '泥土'], use: '复杂度极高，单一品种也能撑起一款酒',
      subs: 'Citra、Simcoe', grp: 'citrus',
      craft: 'α 12.5、coh 24：单一品种就能覆盖苦、香、干投三段；后段用量大时要留意总多酚，双料 IPA 里也要控总量。',
      story: '2012 年推出的美式双用途品种（代号 HBC 369），亲本之一是 Simcoe。它常被当作「单一品种也能撑起一款酒」的样本，蓝莓与泥土调在美式 IPA 里辨识度很高。',
      conf: 'A',
      src: 'Brew-Engine 11.5-13.5（两表一致）' },

    { id: 'h-simcoe', name: '西姆科', en: 'Simcoe', origin: '美国', type: 'dual',
      aa: 13, aaMin: 12, aaMax: 14, beta: 4.5, coh: 22,
      aroma: ['松针', '柑橘', '百香果', '泥土'], use: '西海岸 IPA 的骨架香气',
      subs: 'Mosaic、Chinook', grp: 'resin',
      craft: 'α 13 但 coh 22，苦味干净；松针与百香果集中在干投，60 分钟投入只留苦味，别指望香气。',
      conf: 'A',
      src: 'Brew-Engine 12-14 / HandWiki 12-14' },

    { id: 'h-chinook', name: '奇努克', en: 'Chinook', origin: '美国', type: 'dual',
      aa: 12.5, aaMin: 10, aaMax: 14, beta: 3.5, coh: 33,
      aroma: ['松针', '葡萄柚', '辛香'], use: '苦味干净有力，适合做 60 分钟主苦',
      subs: 'Columbus、Nugget', grp: 'resin',
      craft: 'coh 33 偏粗，适合 60 分钟主苦；干投会出强烈的松针与辛香，一般控制在 3g/L 以内更稳。',
      story: '1985 年由美国农业部推出，名字来自北美原住民的奇努克部族。高 α 与强烈的松针辛香，让它成了 90 年代美式 IPA 的骨架之一。',
      conf: 'A',
      src: 'Brew-Engine 10-14 / HandWiki 12-14' },

    { id: 'h-columbus', name: '哥伦布（CTZ）', en: 'Columbus / CTZ', origin: '美国', type: 'bitter',
      aa: 15.5, aaMin: 14.5, aaMax: 16, beta: 5, coh: 40,
      aroma: ['辛香', '草本', '柑橘', '强烈药草味'], use: '廉价高效的主苦花，双料 IPA 常客',
      subs: 'Tomahawk、Zeus（三者常混称 CTZ）', grp: 'resin',
      craft: 'α 15.5、coh 40：极省用量但苦味尖锐，20L 主苦 15–20g 就够；不喜欢粗粝感就换 Magnum。',
      conf: 'A',
      src: 'Brew-Engine 14.5-16 / HandWiki 14-18',
      note: '合葎草酮高达 40%，苦味偏尖锐；不喜欢粗粝苦感就换 Magnum' },

    { id: 'h-amarillo', name: '阿马里洛', en: 'Amarillo', origin: '美国', type: 'dual',
      aa: 9.5, aaMin: 8, aaMax: 11, beta: 5.5, coh: 24,
      aroma: ['橙子', '杏', '花香'], use: '柔和的橙香，适合大量干投',
      subs: 'Cascade、Centennial', grp: 'citrus',
      craft: 'α 9.5、coh 24 柔和：适合大量干投做橙香，主苦效率一般，通常交给高 α 品种承担。',
      conf: 'A',
      src: 'Brew-Engine 8-11 / HandWiki 8-11' },

    { id: 'h-galaxy', name: '银河', en: 'Galaxy', origin: '澳大利亚', type: 'dual',
      aa: 13.5, aaMin: 11, aaMax: 16, beta: 5.5, coh: 35,
      aroma: ['百香果', '桃子', '柑橘'], use: '澳洲主力，热带水果爆发力极强',
      subs: 'Citra、Nelson Sauvin', grp: 'citrus',
      craft: 'α 区间 11–16%，同年不同批次能差 3 个点：投料前必须按实际 α 重算 IBU，不要用库里中值直接下料。',
      story: '2009 年由澳大利亚 Hop Products Australia 推出，亲本含澳洲本土品种。α 含量随年份大幅波动（11–16%），这也是它必须查批次 COA 的原因。',
      conf: 'A',
      src: 'Brew-Engine 11-16 / HandWiki 14.9',
      note: '年份波动极大（11%-16%），用前必查批次' },

    { id: 'h-nelson', name: '尼尔森·索维浓', en: 'Nelson Sauvin', origin: '新西兰', type: 'dual',
      aa: 12.5, aaMin: 12, aaMax: 13.5, beta: 7, coh: 24,
      aroma: ['白葡萄酒', '醋栗', '热带水果'], use: '新西兰风格 IPA、赛松，独特到无法替代',
      subs: 'Nelson 无真正替代；可混 Galaxy 模拟部分热带感', grp: 'citrus',
      craft: 'β 7 偏高，陈化后苦味比低 β 品种更稳；白葡萄酒香只在后段与干投出现，久煮会只剩醋栗般的苦。',
      story: '2000 年由新西兰的园艺研究机构推出，因长相思葡萄般的醋栗与白葡萄酒香得名 Sauvin。它让「新西兰风格 IPA」成为一个独立说法。',
      conf: 'A',
      src: 'Brew-Engine 12-13 / HandWiki 12-14' },

    { id: 'h-motueka', name: '莫图伊卡', en: 'Motueka', origin: '新西兰', type: 'aroma',
      aa: 7.5, aaMin: 6.5, aaMax: 8.5, beta: 5.5, coh: 29,
      aroma: ['柠檬', '青柠', '热带水果'], use: '清爽的柠檬调，适合皮尔森与淡艾',
      subs: 'Saaz + Cascade 混合模拟', grp: 'citrus',
      craft: 'α 7.5 偏低，别指望它撑 IBU；柠檬青柠调适合 5–10 分钟与干投，用量 1.5–3g/L 才明显。',
      conf: 'A',
      src: 'Brew-Engine 6.5-8.5（两表一致）' },

    { id: 'h-riwaka', name: '里瓦卡', en: 'Riwaka', origin: '新西兰', type: 'aroma',
      aa: 5.5, aaMin: 4.5, aaMax: 6.5, beta: 5, coh: 29,
      aroma: ['葡萄柚', '百香果', '柑橘'], use: '低 α 高香，干投专用',
      subs: 'Motueka、Cascade', grp: 'citrus',
      craft: 'α 5.5，主苦效率极低：它天生是干投品种，20L 用 30–50g 才够香，别当苦花买。',
      conf: 'B', src: 'HandWiki 4.5-6.5' },

    { id: 'h-pacificjade', name: '太平洋翡翠', en: 'Pacific Jade', origin: '新西兰', type: 'dual',
      aa: 13, aaMin: 12, aaMax: 14, beta: 7.5, coh: 24,
      aroma: ['柑橘', '黑胡椒', '草本'], use: '带辛辣感的苦花',
      subs: 'Pacific Gem', grp: 'earthy',
      craft: 'α 13、coh 24：能当苦花也能做后段，黑胡椒感在回旋与干投阶段最明显，主苦用它不亏。',
      conf: 'B', src: 'HandWiki 12-14' },

    { id: 'h-pacificgem', name: '太平洋宝石', en: 'Pacific Gem', origin: '新西兰', type: 'bitter',
      aa: 14.25, aaMin: 13.5, aaMax: 15, beta: 8, coh: 39,
      aroma: ['黑莓', '木质', '柑橘'], use: '高效苦花',
      subs: 'Pacific Jade', grp: 'highaa',
      craft: 'coh 39 偏尖、α 14.25 很省量：只做 60 分钟主苦；后段投放的黑莓木质调并不讨喜。',
      conf: 'B', src: 'Brew-Engine 13.5-15' },

    { id: 'h-southerncross', name: '南十字', en: 'Southern Cross', origin: '新西兰', type: 'dual',
      aa: 12.5, aaMin: 11, aaMax: 14, beta: 5, coh: 25,
      aroma: ['柠檬', '松针', '香料'], use: '新西兰系苦香兼用',
      subs: 'Pacific Jade', grp: 'resin',
      craft: 'α 12.5、coh 25：苦香兼用，柠檬松针在中后段才明显，60 分钟只贡献干净的苦。',
      conf: 'B', src: 'HandWiki 11-14' },

    { id: 'h-topaz', name: '托帕兹', en: 'Topaz', origin: '澳大利亚', type: 'dual',
      aa: 16, aaMin: 14, aaMax: 18, beta: 5, coh: 47,
      aroma: ['热带水果', '草本', '树脂'], use: '澳洲苦花',
      subs: 'Galaxy', grp: 'highaa',
      craft: 'α 16、coh 47 是全库最粗的苦之一：只适合当主苦，10–15g/20L，干投会有刺鼻的树脂味。',
      conf: 'B', src: 'HandWiki 14-18' },

    /* ================= 贵族酒花（欧陆传统） ================= */
    { id: 'h-saaz', name: '萨兹', en: 'Saaz', origin: '捷克', type: 'aroma',
      aa: 3.75, aaMin: 3, aaMax: 4.5, beta: 4.5, coh: 25,
      aroma: ['草本', '辛香', '泥土', '花香'], use: '波西米亚皮尔森的定义性酒花',
      subs: 'Tettnanger、Hallertau（不完全等价）', grp: 'noble',
      craft: 'α 3.75% 意味着用量大：20L 皮尔森常需 80–120g。低 α 也让它久煮不出粗苦，香气则集中在最后 10 分钟。',
      story: '萨兹的名字来自捷克 Žatec（德语 Saaz）产区，这一带种酒花的历史可上溯到中世纪，19 世纪起随波西米亚皮尔森一起成为贵族酒花的样板。',
      conf: 'A',
      src: 'Brew-Engine 3-4.5 / HandWiki 3-4.5',
      psrc: '总精油 0.4-0.8 mL/100g，取中值（C 级，查当年 COA）', totalOil: 0.6,
      note: '贵族酒花四君子之一。低 α 意味着用量大，20L 皮尔森常需 80-120g' },

    { id: 'h-hallertau', name: '哈拉道密特弗吕', en: 'Hallertau Mittelfrüh', origin: '德国', type: 'aroma',
      aa: 4.5, aaMin: 3.5, aaMax: 5.5, beta: 5, coh: 23,
      aroma: ['花香', '草本', '辛香', '蜂蜜'], use: '德式皮尔森、小麦啤、科隆',
      subs: 'Hersbrucker、Saphir', grp: 'noble',
      craft: 'α 4.5、coh 23：花香与草本要在最后 10 分钟内投放才留得住，主苦则要 100g 以上才够 IBU。',
      conf: 'A',
      src: 'Brew-Engine 3.5-5.5 / HandWiki 3.5-5.5' },

    { id: 'h-tettnanger', name: '泰特南', en: 'Tettnanger', origin: '德国', type: 'aroma',
      aa: 4.5, aaMin: 4, aaMax: 5, beta: 4.5, coh: 22,
      aroma: ['花香', '草本', '微辛'], use: '德式拉格、小麦啤，比 Hallertau 更柔和',
      subs: 'Saaz、Hallertau', grp: 'noble',
      craft: 'α 4.5 与 Hallertau 同级，但花香更柔；德式拉格后段 1–2g/L，过量会盖掉麦芽的甜。',
      conf: 'A',
      src: 'Brew-Engine 4-5 / HandWiki 3.5-5.5' },

    { id: 'h-spalt', name: '施帕尔特', en: 'Spalt', origin: '德国', type: 'aroma',
      aa: 4, aaMin: 2.5, aaMax: 5.5, beta: 4.5, coh: 22,
      aroma: ['草本', '花香', '辛香'], use: '德式传统拉格，产量小价格高',
      subs: 'Tettnanger、Saaz', grp: 'noble',
      craft: 'α 4 且产量小：适合做 5 分钟与回旋的细致草本香，拿来当主苦成本太高，也不容易买到新鲜的。',
      conf: 'A',
      src: 'Brew-Engine 2.5-5.5（两表一致）' },

    { id: 'h-hersbrucker', name: '赫斯布鲁克', en: 'Hersbrucker', origin: '德国', type: 'aroma',
      aa: 3.5, aaMin: 2, aaMax: 5, beta: 5.5, coh: 20,
      aroma: ['草本', '花香', '温和'], use: '德式拉格的柔和香气，耐陈化',
      subs: 'Hallertau Mittelfrüh', grp: 'noble',
      craft: 'α 3.5、coh 20：最柔和的贵族香之一，耐陈化，适合要长期存放的拉格用，也适合做干投。',
      conf: 'A',
      src: 'Brew-Engine 2-5 / HandWiki 3-5.5' },

    { id: 'h-ekg', name: '东肯特戈尔丁', en: 'East Kent Golding (EKG)', origin: '英国', type: 'aroma',
      aa: 5.2, aaMin: 4.5, aaMax: 6.5, beta: 2.5, coh: 27,
      aroma: ['花香', '蜂蜜', '草本', '泥土'], use: '英式苦啤、波特、世涛的传统香气',
      subs: 'Styrian Goldings、Fuggle', grp: 'floral',
      craft: 'α 5.2：英式苦啤里 60 分钟给主苦、10 分钟给花香蜂蜜，两段都用它才够「英式」。',
      story: '东肯特戈尔丁得名于 19 世纪初肯特郡 Golding 家族选出的品种，后来 East Kent 成了产区与品质的双重标识。英式苦啤的花香与蜂蜜调，多半来自它。',
      conf: 'A',
      src: 'Brew-Engine 4.5-6.5 / HandWiki 4-5.5' },

    { id: 'h-fuggle', name: '法格尔', en: 'Fuggle', origin: '英国', type: 'aroma',
      aa: 4.75, aaMin: 4, aaMax: 5.5, beta: 2.5, coh: 28,
      aroma: ['泥土', '木质', '花香'], use: '英式深色艾尔的经典泥土调',
      subs: 'Willamette（美式替代，更柔）、EKG', grp: 'earthy',
      craft: 'α 4.75、泥土木质调：深色英式艾尔在最后 5 分钟投放，主苦要靠它得用两三倍量。',
      story: '1861 年由肯特郡的理查德·法格尔选出并推广，是 20 世纪上半叶英国种植面积最大的酒花之一。它的泥土与木质调，成了英式深色艾尔的底色。',
      conf: 'A',
      src: 'Brew-Engine 4-5.5 / HandWiki 4-5.5' },

    { id: 'h-willamette', name: '威拉米特', en: 'Willamette', origin: '美国', type: 'aroma',
      aa: 5, aaMin: 4, aaMax: 6, beta: 3.5, coh: 30,
      aroma: ['花香', '泥土', '微辛辣'], use: '美式 Fuggle，英式风格的低价替代',
      subs: 'Fuggle、EKG', grp: 'earthy',
      craft: 'Fuggle 的美式替代：α 5、价格低、风味更柔；主苦与后段都能用，但缺少 EKG 的花香层次。',
      conf: 'A',
      src: 'Brew-Engine 4-6 / HandWiki 4-6' },

    { id: 'h-styrian', name: '施蒂利亚戈尔丁', en: 'Styrian Goldings', origin: '斯洛文尼亚', type: 'aroma',
      aa: 5.25, aaMin: 4.5, aaMax: 6, beta: 3, coh: 25,
      aroma: ['花香', '辛香', '木质'], use: '英式与比利时风格的桥梁',
      subs: 'EKG、Fuggle', grp: 'floral',
      craft: 'α 5.25：英式与比利时风格之间的桥梁，后段给花香与辛香，主苦效率一般，适合混投。',
      conf: 'A', src: 'Brew-Engine 4.5-6（两表一致）' },

    { id: 'h-bobek', name: '施蒂利亚博贝克', en: 'Styrian Bobek', origin: '斯洛文尼亚', type: 'aroma',
      aa: 5, aaMin: 3.5, aaMax: 7, beta: 3, coh: 26,
      aroma: ['花香', '柑橘', '香料'], use: '比利时艾尔、赛松',
      subs: 'Styrian Goldings', grp: 'floral',
      craft: 'α 5、区间 3.5–7 波动大：按批次 α 调整用量，比利时艾尔后段 1–2g/L。',
      conf: 'B', src: 'HandWiki 3.5-7' },

    { id: 'h-aurora', name: '极光（施蒂利亚）', en: 'Styrian Aurora', origin: '斯洛文尼亚', type: 'dual',
      aa: 8.25, aaMin: 7, aaMax: 9.5, beta: 4, coh: 29,
      aroma: ['柑橘', '花香', '香料'], use: '高香高苦的斯洛文尼亚品种',
      subs: 'Styrian Goldings', grp: 'floral',
      craft: 'α 8.25：斯洛文尼亚系里少见的苦香兼用，60 分钟与 10 分钟各投一半比较平衡。',
      conf: 'B', src: 'HandWiki 7-9.5' },

    { id: 'h-strisselspalt', name: '斯特里斯帕尔特', en: 'Strisselspalt', origin: '法国', type: 'aroma',
      aa: 2.2, aaMin: 1.8, aaMax: 2.5, beta: 5, coh: 23,
      aroma: ['草本', '花香', '辛香'], use: '法式阿尔萨斯风格，极低 α',
      subs: 'Hallertau、Saaz', grp: 'noble',
      craft: 'α 2.2 是全库最低：只做后段与干投，主苦要 200g 以上，实际不现实；用量 2–3g/L 起。',
      conf: 'A',
      src: 'Brew-Engine 1.8-2.5（两表一致）' },

    /* ================= 高 α 苦花（效率优先） ================= */
    { id: 'h-magnum-de', name: '马格努姆（德）', en: 'Magnum (German)', origin: '德国', type: 'bitter',
      aa: 11.5, aaMin: 10, aaMax: 12.6, beta: 5, coh: 24,
      aroma: ['干净的苦味', '极淡草本'], use: '现代家酿最推荐的通用主苦花，苦味圆润',
      subs: 'Warrior、Horizon', grp: 'highaa',
      craft: 'α 11.5 而 coh 仅 24：高 α 却不粗粝的少数品种，20L 主苦 20–25g 就能撑起 40 IBU 上下。',
      conf: 'A',
      src: 'Brew-Engine 10-12.6 / HandWiki 11-16',
      note: '合葎草酮仅 24%，是"高 α 但不粗粝"的少数品种，强烈推荐' },

    { id: 'h-magnum-us', name: '马格努姆（美）', en: 'Magnum (US)', origin: '美国', type: 'bitter',
      aa: 13, aaMin: 10.9, aaMax: 15.6, beta: 5, coh: 25,
      aroma: ['干净苦味'], use: '美式高 α 主苦',
      subs: 'German Magnum', grp: 'highaa',
      craft: 'α 13、coh 25：与德产同系，用量还能再省一点；只做苦花，后段投放没有香气回报。',
      conf: 'B', src: 'Brew-Engine 10.9-15.6' },

    { id: 'h-warrior', name: '勇士', en: 'Warrior', origin: '美国', type: 'bitter',
      aa: 16, aaMin: 15, aaMax: 17, beta: 4.5, coh: 24,
      aroma: ['极干净的苦味', '微弱柑橘'], use: '追求"只苦不香"的主苦花',
      subs: 'Magnum、Horizon', grp: 'highaa',
      craft: 'α 16、coh 24：只苦不香的典型，20L 主苦 15g 左右；后段投放纯属浪费。',
      conf: 'A',
      src: 'Brew-Engine 15-17 / HandWiki 15-17' },

    { id: 'h-nugget', name: '肉豆蔻', en: 'Nugget', origin: '美国', type: 'bitter',
      aa: 13.5, aaMin: 12.5, aaMax: 14.5, beta: 5, coh: 27,
      aroma: ['草本', '辛香', '苦'], use: '廉价高效主苦，也可兼作香气',
      subs: 'Galena、Columbus', grp: 'highaa',
      craft: 'α 13.5、coh 27：可兼作香气，但草本辛香偏重，后段用量别超过 1g/L。',
      conf: 'A',
      src: 'Brew-Engine 12.5-14.5（两表一致）' },

    { id: 'h-galena', name: '加莱纳', en: 'Galena', origin: '美国', type: 'bitter',
      aa: 12, aaMin: 10, aaMax: 14, beta: 4.5, coh: 37,
      aroma: ['干净苦', '柑橘', '黑加仑'], use: '美式廉价苦花',
      subs: 'Nugget、Cluster', grp: 'highaa',
      craft: 'coh 37 偏尖：廉价主苦，60 分钟 20g/20L；干投会有明显的黑加仑与粗苦。',
      conf: 'A',
      src: 'Brew-Engine 10-14 / HandWiki 12-14' },

    { id: 'h-horizon', name: '地平线', en: 'Horizon', origin: '美国', type: 'dual',
      aa: 12.5, aaMin: 11, aaMax: 14, beta: 6.5, coh: 28,
      aroma: ['花香', '柑橘', '辛香'], use: '苦香兼用，与 Magnum 类似',
      subs: 'Magnum', grp: 'highaa',
      craft: 'α 12.5、coh 28：与 Magnum 类似的通用苦花，也能在后段给一点花香，属于不容易出错的选择。',
      conf: 'A',
      src: 'Brew-Engine 11-14 / HandWiki 11-13' },

    { id: 'h-millennium', name: '千禧', en: 'Millennium', origin: '美国', type: 'bitter',
      aa: 15.5, aaMin: 14.5, aaMax: 16.5, beta: 4.5, coh: 30,
      aroma: ['草本', '花香', '苦'], use: '高 α 通用苦花',
      subs: 'Nugget、Columbus', grp: 'highaa',
      craft: 'α 15.5：主苦极省量，15–18g/20L 即可；coh 30 的苦比 CTZ 干净，但后段香气平庸。',
      conf: 'A',
      src: 'Brew-Engine 14.5-16.5 / HandWiki 15.5' },

    { id: 'h-cluster', name: '克拉克斯特', en: 'Cluster', origin: '美国', type: 'bitter',
      aa: 7, aaMin: 5.5, aaMax: 8.5, beta: 4.5, coh: 39,
      aroma: ['粗犷', '辛香', '黑加仑'], use: '美国历史品种，老式拉格',
      subs: 'Galena', grp: 'earthy',
      craft: 'α 7 却有 coh 39：老式美式苦花，苦味粗犷；适合复原历史配方，现代 IPA 不合适。',
      story: '美国最老的商业酒花品种之一，19 世纪起在纽约州与西海岸种植，长期是美式拉格的主苦花。今天它更多出现在历史配方复原里，是现代 IPA 不会去碰的味道。',
      conf: 'A',
      src: 'Brew-Engine 5.5-8.5 / HandWiki 5.5-8.5' },

    { id: 'h-northernbrewer', name: '北酿', en: 'Northern Brewer', origin: '德国/英国', type: 'dual',
      aa: 8.5, aaMin: 7, aaMax: 10, beta: 5, coh: 28,
      aroma: ['木质', '松针', '薄荷'], use: '加州蒸汽啤酒、英式艾尔',
      subs: 'Perle、Challenger', grp: 'resin',
      craft: 'α 8.5：木质松针调，加州蒸汽啤酒的传统选择；主苦与后段都能用，但薄荷感容易过量。',
      story: '1934 年由英国 Wye College 推出，是 Brewers Gold 与本土品种的杂交后代。它耐寒、α 稳定，后来成了加州蒸汽啤酒的标志性酒花。',
      conf: 'A',
      src: 'Brew-Engine 7-10 / HandWiki 8-10' },

    { id: 'h-perle', name: '佩尔勒', en: 'Perle', origin: '德国', type: 'dual',
      aa: 7.5, aaMin: 6, aaMax: 9, beta: 4.5, coh: 27,
      aroma: ['花香', '薄荷', '辛香'], use: '德式拉格、小麦啤，也可做主苦',
      subs: 'Northern Brewer', grp: 'noble',
      craft: 'α 7.5：德式拉格与小麦啤的通用花，可做主苦也可后段，花香比 Hallertau 更直接。',
      conf: 'A',
      src: 'Brew-Engine 6-9 / HandWiki 6-10' },

    { id: 'h-target', name: '目标', en: 'Target', origin: '英国', type: 'bitter',
      aa: 11, aaMin: 8.5, aaMax: 13.5, beta: 5.5, coh: 37,
      aroma: ['辛香', '草本', '强烈苦'], use: '英式高 α 苦花',
      subs: 'Challenger', grp: 'highaa',
      craft: 'α 11、coh 37：英式高 α 苦花，苦味强而粗，主苦 15–20g/20L，后段不推荐。',
      conf: 'A',
      src: 'Brew-Engine 8.5-13.5（两表一致）' },

    { id: 'h-challenger', name: '挑战者', en: 'Challenger', origin: '英国', type: 'dual',
      aa: 7.75, aaMin: 6.5, aaMax: 9, beta: 4.5, coh: 25,
      aroma: ['花香', '辛香', '柑橘'], use: '英式双用途，苦味柔和',
      subs: 'Northern Brewer、Target', grp: 'floral',
      craft: 'α 7.75、coh 25：英式双用途的平衡点，60 分钟主苦加 10 分钟花香，一支可以兼顾两段。',
      conf: 'A',
      src: 'Brew-Engine 6.5-9 / HandWiki 6.5-8.5' },

    { id: 'h-firstgold', name: '第一金', en: 'First Gold', origin: '英国', type: 'dual',
      aa: 8.25, aaMin: 6.5, aaMax: 10, beta: 3.5, coh: 33,
      aroma: ['橙子', '花香', '辛香'], use: '英式艾尔，带明显的橙皮感',
      subs: 'EKG、Challenger', grp: 'floral',
      craft: 'α 8.25：橙皮感在最后 10 分钟最明显，主苦效率尚可；干投过量会出橘皮苦。',
      conf: 'A',
      src: 'Brew-Engine 6.5-10 / HandWiki 6.5-8.5' },

    { id: 'h-bramling', name: '布拉姆林十字', en: 'Bramling Cross', origin: '英国', type: 'dual',
      aa: 7, aaMin: 6, aaMax: 8, beta: 3.5, coh: 33,
      aroma: ['黑加仑', '柠檬', '木质'], use: '英式深色艾尔，独特的黑加仑调',
      subs: 'Brewer\'s Gold', grp: 'earthy',
      craft: 'α 7：黑加仑调独特，适合英式深色艾尔后段；主苦效率一般，通常与其他苦花搭配，别单用。',
      conf: 'A',
      src: 'Brew-Engine 6-8 / HandWiki 5-7' },

    { id: 'h-brewersgold', name: '酿酒师金', en: "Brewer's Gold", origin: '英国', type: 'bitter',
      aa: 9, aaMin: 8, aaMax: 10, beta: 5, coh: 40,
      aroma: ['黑加仑', '辛香', '果香'], use: '老式苦花，苦味较粗',
      subs: 'Bramling Cross', grp: 'earthy',
      craft: 'coh 40：老式苦花里最粗的一档，只适合主苦；黑加仑香在久煮后基本留不住，别指望它给香气。',
      conf: 'A',
      src: 'Brew-Engine 8-10 / HandWiki 7.1-11.3' },

    { id: 'h-progress', name: '进步', en: 'Progress', origin: '英国', type: 'dual',
      aa: 6.75, aaMin: 6, aaMax: 7.5, beta: 3, coh: 30,
      aroma: ['花香', '草本', '微甜'], use: '英式艾尔的 Fuggle 替代',
      subs: 'Fuggle、EKG', grp: 'floral',
      craft: 'α 6.75：Fuggle 的现代替代，苦味比 Fuggle 干净，英式艾尔里可替掉一半 Fuggle 用量。',
      conf: 'A',
      src: 'Brew-Engine 6-7.5 / HandWiki 5-7' },

    { id: 'h-sovereign', name: '君主', en: 'Sovereign', origin: '英国', type: 'aroma',
      aa: 5.5, aaMin: 4.5, aaMax: 6.5, beta: 3, coh: 28,
      aroma: ['花香', '草本', '柑橘'], use: '英式艾尔香气',
      subs: 'EKG、First Gold', grp: 'floral',
      craft: 'α 5.5：纯香花定位，后段 1–1.5g/L 给花香；主苦要用 100g 以上，不划算。',
      conf: 'B', src: 'Brew-Engine 4.5-6.5' },

    { id: 'h-admiral', name: '海军上将', en: 'Admiral', origin: '英国', type: 'bitter',
      aa: 14.5, aaMin: 13, aaMax: 16, beta: 5, coh: 37,
      aroma: ['橙子', '辛香', '草本'], use: '英式高 α 苦花',
      subs: 'Target', grp: 'highaa',
      craft: 'α 14.5、coh 37：英式高 α 主苦，15g/20L 就有明显苦度；橙香只在后段留一点。',
      conf: 'B', src: 'Brew-Engine 13-16' },

    { id: 'h-pilgrim', name: '朝圣者', en: 'Pilgrim', origin: '英国', type: 'bitter',
      aa: 11, aaMin: 9, aaMax: 13, beta: 5, coh: 37,
      aroma: ['柑橘', '辛香', '苦'], use: '英式高 α',
      subs: 'Target、Challenger', grp: 'highaa',
      craft: 'α 11、coh 37：与 Target 同级的英式苦花，主苦 18–22g/20L，苦味偏直接。',
      conf: 'B', src: 'Brew-Engine 9-13' },

    { id: 'h-pioneer', name: '先锋', en: 'Pioneer', origin: '英国', type: 'dual',
      aa: 9.25, aaMin: 8, aaMax: 10.5, beta: 4, coh: 33,
      aroma: ['柠檬', '草本', '辛香'], use: '英式通用双用途',
      subs: 'Challenger', grp: 'earthy',
      craft: 'α 9.25：英式通用双用途，柠檬草本在后段；coh 33 意味着别指望它做出细腻的苦。',
      conf: 'B', src: 'Brew-Engine 8-10.5' },

    { id: 'h-wgv', name: '惠特布莱德戈尔丁', en: 'Whitbread Golding Variety', origin: '英国', type: 'aroma',
      aa: 6.25, aaMin: 5, aaMax: 7.5, beta: 3, coh: 30,
      aroma: ['花香', '泥土', '木质'], use: '英式老配方复原',
      subs: 'EKG、Fuggle', grp: 'floral',
      craft: 'α 6.25：Golding 系的老品种，做英式历史配方复原时用它；后段花香比 EKG 更粗一些。',
      conf: 'B', src: 'Brew-Engine 5-7.5' },

    { id: 'h-northdown', name: '诺斯当', en: 'Northdown', origin: '英国', type: 'dual',
      aa: 8.5, aaMin: 7, aaMax: 10, beta: 5, coh: 33,
      aroma: ['草本', '辛香', '黑加仑'], use: '英式双用途',
      subs: 'Challenger', grp: 'earthy',
      craft: 'α 8.5：英式双用途，草本辛香在后段；主苦效率中等，适合与 Challenger 搭配。',
      conf: 'B', src: 'Brew-Engine 7-10' },

    /* ================= 特色品种 ================= */
    { id: 'h-sorachi', name: '空知王牌', en: 'Sorachi Ace', origin: '日本', type: 'dual',
      aa: 13, aaMin: 10, aaMax: 16, beta: 7, coh: 25,
      aroma: ['柠檬', '莳萝', '椰子', '奶油'], use: '风味极端，要么极爱要么极恨；适合赛松',
      subs: '无真正替代', grp: 'exp',
      craft: 'α 13 但风味极端：莳萝与椰子 1g/L 就已明显，过量会变得像柠檬洗洁精，建议只做后段。',
      conf: 'A',
      src: 'HandWiki 10-16',
      note: '日本培育，柠檬+莳萝的独特组合，用量宜克制（<1g/L）' },

    { id: 'h-summit', name: '顶峰', en: 'Summit', origin: '美国', type: 'bitter',
      aa: 17.75, aaMin: 17, aaMax: 18.5, beta: 5, coh: 36,
      aroma: ['橙子', '洋葱', '大蒜', '强烈'], use: '极高效苦花，香气争议大',
      subs: 'Columbus', grp: 'highaa',
      craft: 'α 17.75：主苦极省量（10–12g/20L）；干投超过 2g/L 会出洋葱大蒜味，这是品种特性不是变质。',
      conf: 'A',
      src: 'Brew-Engine 17-18.5 / HandWiki 17-19',
      note: '干投过量会产生明显的洋葱/大蒜味，这是品种特性不是变质' },

    { id: 'h-ahtanum', name: '阿塔努姆', en: 'Ahtanum', origin: '美国', type: 'aroma',
      aa: 6, aaMin: 5.7, aaMax: 6.3, beta: 5.5, coh: 30,
      aroma: ['柑橘', '花香', '树脂'], use: '美式淡艾的柔和香气',
      subs: 'Cascade、Amarillo', grp: 'citrus',
      craft: 'α 6：柔和的柑橘花香，适合当 Cascade 的「低音量」版本；主苦效率低，后段 1–2g/L。',
      conf: 'A',
      src: 'Brew-Engine 5.7-6.3（两表一致）' },

    { id: 'h-crystal', name: '水晶', en: 'Crystal', origin: '美国', type: 'aroma',
      aa: 3.75, aaMin: 3, aaMax: 4.5, beta: 5, coh: 22,
      aroma: ['花香', '辛香', '草本'], use: '低 α 香气，类似 Hallertau',
      subs: 'Hallertau、Liberty', grp: 'noble',
      craft: 'α 3.75、coh 22：美式贵族风格的香花，后段给花香与辛香；主苦不现实，别用它算 IBU。',
      conf: 'A',
      src: 'Brew-Engine 3-4.5 / HandWiki 3.5-5.5' },

    { id: 'h-liberty', name: '自由', en: 'Liberty', origin: '美国', type: 'aroma',
      aa: 4.5, aaMin: 3, aaMax: 6, beta: 5, coh: 24,
      aroma: ['花香', '草本', '辛香'], use: '美式贵族风格，Hallertau 替代',
      subs: 'Hallertau Mittelfrüh', grp: 'noble',
      craft: 'α 4.5：Hallertau 的美式替身，花香干净；德式拉格后段 1–1.5g/L 即可。',
      conf: 'A',
      src: 'Brew-Engine 3-6 / HandWiki 3-5' },

    { id: 'h-mthood', name: '胡德山', en: 'Mount Hood', origin: '美国', type: 'aroma',
      aa: 4.5, aaMin: 3, aaMax: 6, beta: 5.5, coh: 22,
      aroma: ['草本', '花香', '微辛'], use: '美式拉格、小麦啤',
      subs: 'Hallertau、Liberty', grp: 'noble',
      craft: 'α 4.5、coh 22：柔和草本，适合美式拉格与小麦啤后段；主苦效率极低，用量 1–2g/L。',
      conf: 'A',
      src: 'Brew-Engine 3-6 / HandWiki 5-8' },

    { id: 'h-santiam', name: '桑蒂安', en: 'Santiam', origin: '美国', type: 'aroma',
      aa: 6, aaMin: 5, aaMax: 7, beta: 5, coh: 22,
      aroma: ['花香', '草本', '辛香'], use: '德式风格的美式替代',
      subs: 'Tettnanger、Hallertau', grp: 'noble',
      craft: 'α 6、coh 22：德式风格的柔和替代，苦味圆润；后段 1–2g/L 给草本花香。',
      conf: 'A',
      src: 'Brew-Engine 5-7 / HandWiki 5-7' },

    { id: 'h-glacier', name: '冰川', en: 'Glacier', origin: '美国', type: 'dual',
      aa: 5.5, aaMin: 5, aaMax: 6, beta: 5, coh: 22,
      aroma: ['柑橘', '草本', '木质'], use: '低 α 双用途',
      subs: 'Willamette', grp: 'citrus',
      craft: 'α 5.5：低 α 双用途，60 分钟给柔和苦、后段给柑橘草本；用量大是它的主要缺点。',
      conf: 'A',
      src: 'Brew-Engine 5-6 / HandWiki 5.5' },

    { id: 'h-palisade', name: '帕利塞德', en: 'Palisade', origin: '美国', type: 'aroma',
      aa: 8, aaMin: 6.6, aaMax: 9.5, beta: 5.5, coh: 28,
      aroma: ['杏', '花香', '草本'], use: '果香型香气',
      subs: 'Amarillo', grp: 'citrus',
      craft: 'α 8：杏与花香突出，后段 1–1.5g/L；主苦效率中等，适合与高 α 品种分工。',
      conf: 'A',
      src: 'Brew-Engine 6.6-9.5（两表一致）' },

    { id: 'h-greenbullet', name: '绿弹', en: 'Green Bullet', origin: '新西兰', type: 'bitter',
      aa: 12.5, aaMin: 11, aaMax: 14, beta: 7, coh: 40,
      aroma: ['树脂', '木质', '柑橘'], use: '新西兰苦花',
      subs: 'Pacific Gem', grp: 'highaa',
      craft: 'coh 40、α 12.5：新西兰粗苦代表，只做 60 分钟主苦；后段会有明显的树脂与木质。',
      conf: 'A',
      src: 'Brew-Engine 11-14 / HandWiki 11-14' },

    { id: 'h-waimea', name: '怀梅阿', en: 'Waimea', origin: '新西兰', type: 'bitter',
      aa: 17.5, aaMin: 16, aaMax: 19, beta: 8, coh: 38,
      aroma: ['松针', '柑橘', '香料'], use: '新西兰高 α',
      subs: 'Pacific Gem', grp: 'highaa',
      craft: 'α 17.5 是全库第二高：主苦 10–12g/20L 就够，coh 38 的苦偏尖，别在后段用。',
      conf: 'B', src: 'HandWiki 16-19' },

    { id: 'h-pacifica', name: '太平洋', en: 'Pacifica', origin: '新西兰', type: 'aroma',
      aa: 5.5, aaMin: 5, aaMax: 6, beta: 6, coh: 25,
      aroma: ['橙子', '柑橘', '花香'], use: '新西兰橙香',
      subs: 'Motueka', grp: 'citrus',
      craft: 'α 5.5：橙花香集中在中后段，20L 用 30–50g 才明显；主苦不划算，适合与 Motueka 混。',
      conf: 'B', src: 'HandWiki 5-6' },

    { id: 'h-herkules', name: '赫拉克勒斯', en: 'Herkules', origin: '德国', type: 'bitter',
      aa: 14.5, aaMin: 12, aaMax: 17, beta: 5, coh: 36,
      aroma: ['干净苦味', '微弱草本'], use: '德国高 α 主苦',
      subs: 'Magnum', grp: 'highaa',
      craft: 'α 14.5、coh 36：德国高 α 主苦，15–18g/20L；比 Magnum 粗，后段没有价值。',
      conf: 'B', src: 'HandWiki 12-17' },

    { id: 'h-saphir', name: '蓝宝石', en: 'Saphir', origin: '德国', type: 'aroma',
      aa: 3.5, aaMin: 2, aaMax: 4.5, beta: 5, coh: 25,
      aroma: ['柑橘', '花香', '草本'], use: '德式拉格的精致香气',
      subs: 'Hallertau', grp: 'noble',
      craft: 'α 3.5：德式精致香花，10 分钟与回旋各一半；用量 1.5–2.5g/L，主苦不现实。',
      conf: 'B', src: 'HandWiki 2-4.5' },

    { id: 'h-opal', name: '欧泊', en: 'Opal', origin: '德国', type: 'aroma',
      aa: 4.5, aaMin: 3.5, aaMax: 5.5, beta: 5, coh: 23,
      aroma: ['辛香', '花香', '草本'], use: '德式拉格',
      subs: 'Hallertau', grp: 'noble',
      craft: 'α 4.5：辛香花香，德式拉格后段 1–2g/L；与 Saphir 类似，但更偏香料一侧。',
      conf: 'B', src: 'HandWiki 3.5-5.5' },

    { id: 'h-tradition', name: '传统', en: 'Tradition', origin: '德国', type: 'aroma',
      aa: 6, aaMin: 5, aaMax: 7, beta: 5, coh: 24,
      aroma: ['花香', '草本', '辛香'], use: 'Hallertau 的改良系',
      subs: 'Hallertau Mittelfrüh', grp: 'noble',
      craft: 'α 6：Hallertau 改良系，香气接近但更稳定；后段 1–2g/L，主苦效率一般。',
      conf: 'A',
      src: 'Brew-Engine 5-7 / HandWiki 5-7' },

    { id: 'h-taurus', name: '金牛', en: 'Taurus', origin: '德国', type: 'bitter',
      aa: 14.5, aaMin: 12, aaMax: 17, beta: 5, coh: 36,
      aroma: ['干净苦'], use: '德国高 α',
      subs: 'Magnum、Herkules', grp: 'highaa',
      craft: 'α 14.5、coh 36：与 Herkules 同级的纯苦花，主苦 15g/20L，后段投放没有回报。',
      conf: 'B', src: 'HandWiki 12-17' },

    { id: 'h-zeus', name: '宙斯', en: 'Zeus', origin: '美国', type: 'bitter',
      aa: 16.5, aaMin: 15, aaMax: 18, beta: 5.5, coh: 40,
      aroma: ['强烈药草', '柑橘', '辛香'], use: 'CTZ 家族，粗粝苦',
      subs: 'Columbus、Tomahawk', grp: 'highaa',
      craft: 'α 16.5、coh 40：CTZ 家族的粗苦代表，主苦 10–12g/20L；干投会有强烈的药草与辛辣。',
      conf: 'B', src: 'HandWiki 15-18' },

    { id: 'h-apollo', name: '阿波罗', en: 'Apollo', origin: '美国', type: 'bitter',
      aa: 20.5, aaMin: 20, aaMax: 21, beta: 6, coh: 35,
      aroma: ['强烈柑橘', '树脂'], use: '最高 α 之一，极省用量',
      subs: 'Warrior、Summit', grp: 'highaa',
      craft: 'α 20.5 是全库最高：主苦 8–10g/20L 就够，称量差 1g 就是 3–4 IBU 的偏差，建议用克秤。',
      conf: 'A',
      src: 'HandWiki 20-21（区间极窄，可信）' },

    { id: 'h-eldorado', name: '黄金国', en: 'El Dorado', origin: '美国', type: 'dual',
      aa: 14, aaMin: 13, aaMax: 16, beta: 5, coh: 28,
      aroma: ['菠萝', '梨', '西瓜', '糖果'], use: '强烈的热带水果糖感',
      subs: 'Citra、Galaxy', grp: 'exp',
      craft: '置信度 C、α 区间 13–16：投料前必须查批次。主苦与干投都可用，菠萝糖果感在干投时最浓。',
      conf: 'C',
      src: '未取得双源交叉，取厂商公开区间中值——**务必查批次 COA**' },

    { id: 'h-ekuanot', name: '伊库阿诺特', en: 'Ekuanot', origin: '美国', type: 'dual',
      aa: 14, aaMin: 13, aaMax: 15, beta: 5, coh: 30,
      aroma: ['青柠', '浆果', '青椒', '草本'], use: '风味复杂，适合混投',
      subs: 'Mosaic', grp: 'exp',
      craft: '置信度 C、α 区间 13–15：青椒与浆果调，适合混投（单用容易菜味压过果香）；后段 1–2g/L。',
      conf: 'C',
      src: '未取得双源交叉，取厂商公开区间中值——**务必查批次 COA**' },

    { id: 'h-idaho7', name: '爱达荷7号', en: 'Idaho 7', origin: '美国', type: 'dual',
      aa: 12, aaMin: 11, aaMax: 13, beta: 4.5, coh: 30,
      aroma: ['葡萄柚', '芒果', '松针', '黑茶'], use: 'NEIPA 的"茶感"来源',
      subs: 'Simcoe、Mosaic', grp: 'exp',
      craft: '置信度 C、α 区间 11–13：黑茶与葡萄柚，NEIPA 里 2–3g/L 干投；煮沸超过 20 分钟只剩苦。',
      conf: 'C',
      src: '未取得双源交叉——**务必查批次 COA**' },

    { id: 'h-sabro', name: '萨布罗', en: 'Sabro', origin: '美国', type: 'dual',
      aa: 14, aaMin: 12, aaMax: 16, beta: 5, coh: 28,
      aroma: ['椰子', '菠萝', '奶油', '木质'], use: '椰子感极突出，用于热带风格',
      subs: '无真正替代', grp: 'exp',
      craft: '置信度 C、α 区间 12–16：椰子奶油感极强，1–2g/L 已主导风味，与 Citra 混投比单用更平衡。',
      conf: 'C',
      src: '未取得双源交叉——**务必查批次 COA**' },

    { id: 'h-strata', name: '斯特拉塔', en: 'Strata', origin: '美国', type: 'dual',
      aa: 12, aaMin: 11, aaMax: 13, beta: 5, coh: 30,
      aroma: ['百香果', '草莓', '大麻', '柑橘'], use: '现代 IPA 新宠',
      subs: 'Citra、Mosaic', grp: 'exp',
      craft: '置信度 C、α 区间 11–13：百香果与草莓，干投 2–4g/L；青草与树脂的青味对用量很敏感。',
      conf: 'C',
      src: '未取得双源交叉——**务必查批次 COA**' },

    { id: 'h-talus', name: '塔卢斯', en: 'Talus', origin: '美国', type: 'aroma',
      aa: 9, aaMin: 8, aaMax: 10, beta: 5, coh: 28,
      aroma: ['玫瑰', '柑橘', '木质', '松针'], use: '花香型新星',
      subs: 'EKG + Citra 混投模拟', grp: 'exp',
      craft: '置信度 C、α 区间 8–10：玫瑰与柑橘，后段 1.5–2.5g/L；α 不高，主苦要交给别的品种。',
      conf: 'C',
      src: '未取得双源交叉——**务必查批次 COA**' },

    /* ==========================================================================
     * v1.7 追加：近 5–15 年发布的商业品种 + 经典但库里缺的 + 国产
     * --------------------------------------------------------------------------
     * 为什么这批大多是 conf B：α 只取自**育种方/经销商公布的单一区间**，
     * 没有第二张独立表可交叉。单源 = B（不是 A），这是本表一贯的口径。
     * src 里写清"单源"二字，用户看到就知道该按当年 COA 复核。
     * 唯一一条 C 是青岛大花：国内产区数据不公开，只有区间。
     *
     * β 酸 / 合葎草酮 / 精油三项这次**没有补**：它们随年份与产地变化比 α 更大，
     * 没有第二来源就写死数字等于编。界面上这三项对这批品种显示「—」。
     * ========================================================================*/

    { id: 'h-azacca', name: '阿扎卡', en: 'Azacca', origin: '美国', type: 'dual',
      aa: 14.5, aaMin: 12.5, aaMax: 16.5,
      aroma: ['芒果', '木瓜', '柑橘', '松针'], use: 'IPA 干投，Citra 的性价比替代',
      subs: 'Citra、El Dorado', grp: 'citrus',
      craft: 'α 14.5 可以兼主苦；香气以芒果与木瓜为主，干投 5–8g/L 就饱满，超过 10g/L 会出现青椒般的绿味。',
      conf: 'B', src: 'Yakima Chief / Hopsteiner 公布区间 12.5-16.5%，取中值（单源）' },

    { id: 'h-cashmere', name: '羊绒', en: 'Cashmere', origin: '美国', type: 'dual',
      aa: 8.5, aaMin: 7.5, aaMax: 9.5,
      aroma: ['椰子', '青柠', '甜瓜', '奶油'], use: '浑浊 IPA 干投混搭',
      subs: 'Sabro（同为椰香系）', grp: 'citrus',
      craft: 'α 只有 8.5，做主苦要很大用量；价值在椰奶与青柠，适合与 Citra/Mosaic 混投压住它的"奶油甜"。',
      conf: 'B', src: 'Yakima Chief 公布区间 7.5-9.5%，取中值（单源）' },

    { id: 'h-loral', name: '洛拉', en: 'Loral', origin: '美国', type: 'dual',
      aa: 11, aaMin: 10, aaMax: 12,
      aroma: ['花香', '胡椒', '柠檬', '茶'], use: '拉格、赛松、比利时风格的"新世界贵族"',
      subs: 'Hallertau Mittelfrüh + Citra 混投', grp: 'floral',
      craft: '定位是新世界贵族：花香与胡椒，α 11 够用但不冲。做拉格时 15 分钟投入比干投更出彩，干投会放大"茶感"。',
      conf: 'B', src: 'Hopsteiner 公布区间 10-12%，取中值（单源）' },

    { id: 'h-eureka', name: '尤里卡', en: 'Eureka', origin: '美国', type: 'bitter',
      aa: 18, aaMin: 17, aaMax: 19,
      aroma: ['松针', '黑加仑', '木质', '柑橘'], use: '高苦度 IPA 的主苦',
      subs: 'Columbus、Warrior', grp: 'resin',
      craft: 'α 18 属高苦花，20L 里 15g 做 60 分钟主苦就够；它也有香气但偏松针与黑加仑，干投会带来草本苦。',
      conf: 'B', src: 'Hopsteiner 公布区间 17-19%，取中值（单源）' },

    { id: 'h-sultana', name: '苏丹娜（原 Denali）', en: 'Sultana', origin: '美国', type: 'dual',
      aa: 14, aaMin: 13, aaMax: 15,
      aroma: ['菠萝', '柑橘', '松针'], use: '单一品种 IPA',
      subs: 'Denali（同一品种旧名）', grp: 'citrus',
      craft: '原代号 Denali，后来改名 Sultana：菠萝感强，单一品种也能撑一款 IPA，但苦味偏直、余味短。',
      conf: 'B', src: 'Hopsteiner 公布区间 13-15%，取中值（单源）' },

    { id: 'h-comet', name: '彗星', en: 'Comet', origin: '美国', type: 'dual',
      aa: 10, aaMin: 9, aaMax: 11,
      aroma: ['葡萄柚', '野莓', '青草'], use: '复古美式 IPA、小麦啤',
      subs: 'Cascade（更柔和）', grp: 'citrus',
      craft: '1960 年代的老品种在 2010 年代被重新捡起：葡萄柚很足，但带明显青草，后段用量要克制，否则像"割过的草坪"。',
      conf: 'B', src: 'USDA 系谱系与经销商区间 9-11%，取中值（单源）' },

    { id: 'h-mandarinabavaria', name: '巴伐利亚蜜橘', en: 'Mandarina Bavaria', origin: '德国', type: 'aroma',
      aa: 8.5, aaMin: 7, aaMax: 10,
      aroma: ['蜜橘', '橙皮', '甜瓜'], use: '小麦啤、淡色艾尔、拉格',
      subs: 'Huell Melon、Cascade', grp: 'citrus',
      craft: '德国"蜜橘"系（2012 年发布）：柑橘是甜橘皮，不是美式的葡萄柚，所以做小麦啤与拉格更贴合。α 8.5 只能做后段。',
      conf: 'B', src: 'HVG / Hopsteiner 公布区间 7-10%，取中值（单源）' },

    { id: 'h-huellmelon', name: '蜜瓜', en: 'Huell Melon', origin: '德国', type: 'aroma',
      aa: 7, aaMin: 6, aaMax: 8,
      aroma: ['甜瓜', '草莓', '蜂蜜'], use: '小麦啤、赛松、果味淡艾',
      subs: 'Mandarina Bavaria、Ella', grp: 'floral',
      craft: '蜜瓜与草莓是招牌，α 只有 7：别拿它做主苦，后段 10 分钟与干投才划算。和酵母的香蕉酯混在一起会变成"水果糖"。',
      conf: 'B', src: 'HVG 公布区间 6-8%，取中值（单源）' },

    { id: 'h-polaris', name: '北极星', en: 'Polaris', origin: '德国', type: 'bitter',
      aa: 20, aaMin: 18, aaMax: 23,
      aroma: ['薄荷', '松针', '柑橘', '八角'], use: '德式高苦度、黑啤',
      subs: 'Hercules、Magnum', grp: 'highaa',
      craft: 'α 20 的德国高苦花，薄荷与八角样的凉感很特别：20L 主苦只要 12–16g。它的香气两极分化，别在淡色酒里大量干投。',
      conf: 'B', src: 'Hopsteiner 公布区间 18-23%，取中值（单源）' },

    { id: 'h-callista', name: '卡莉斯塔', en: 'Callista', origin: '德国', type: 'aroma',
      aa: 6, aaMin: 5, aaMax: 7,
      aroma: ['柑橘', '黑加仑', '蜜桃'], use: '淡色拉格、小麦啤、果味艾尔',
      subs: 'Mandarina Bavaria', grp: 'citrus',
      craft: '2016 年才商业化的德国新香花，α 6 只能做后段；柑橘与黑加仑偏"软"，适合低苦度风格，做主苦会又费量又没层次。',
      conf: 'B', src: 'Hopsteiner 公布区间 5-7%，取中值（单源）' },

    { id: 'h-jester', name: '杰斯特', en: 'Jester', origin: '英国', type: 'dual',
      aa: 8, aaMin: 7, aaMax: 9,
      aroma: ['黑加仑', '葡萄柚', '热带水果'], use: '英式 IPA、金色艾尔',
      subs: 'Harlequin、Citra', grp: 'citrus',
      craft: '英国 2010 年代新品种，黑加仑与葡萄柚是英式酒花里少见的"新世界"组合；α 8 可苦可香，做英式 IPA 一支就够。',
      conf: 'B', src: 'British Hop Association 公布区间 7-9%，取中值（单源）' },

    { id: 'h-harlequin', name: '哈利奎因', en: 'Harlequin', origin: '英国', type: 'aroma',
      aa: 9, aaMin: 8, aaMax: 10,
      aroma: ['黑加仑', '荔枝', '葡萄柚'], use: '英式淡艾、浑浊 IPA',
      subs: 'Jester、Citra', grp: 'citrus',
      craft: '英国近年最"新世界"的香花：荔枝与黑加仑很足。后段 10 分钟或干投，煮沸超过 30 分钟就只剩草味。',
      conf: 'B', src: 'British Hop Association 公布区间 8-10%，取中值（单源）' },

    { id: 'h-ella', name: '艾拉', en: 'Ella', origin: '澳大利亚', type: 'dual',
      aa: 14.5, aaMin: 13, aaMax: 16,
      aroma: ['花香', '葡萄柚', '八角', '薄荷'], use: '澳洲风格 IPA、干投',
      subs: 'Galaxy、Vic Secret', grp: 'floral',
      craft: '澳洲高 α 香花，花香与八角感辨识度极高；α 14.5 能兼主苦，但它的苦偏硬，做淡色酒时把主苦交给别的品种更稳。',
      conf: 'B', src: 'Hop Products Australia 公布区间 13-16%，取中值（单源）' },

    { id: 'h-vicsecret', name: '维多利亚的秘密', en: 'Vic Secret', origin: '澳大利亚', type: 'dual',
      aa: 17, aaMin: 15, aaMax: 19,
      aroma: ['菠萝', '百香果', '松针'], use: '双料 IPA、干投',
      subs: 'Galaxy、Ella', grp: 'citrus',
      craft: 'α 高、香气浓，但植物物质多：干投超过 8g/L 容易出涩与"绿味"，建议 3–5 天就收，别泡一周。',
      conf: 'B', src: 'Hop Products Australia 公布区间 15-19%，取中值（单源）' },

    { id: 'h-enigma', name: '谜', en: 'Enigma', origin: '澳大利亚', type: 'dual',
      aa: 17.5, aaMin: 16, aaMax: 19,
      aroma: ['红醋栗', '甜瓜', '松针', '葡萄'], use: '澳洲 IPA、酸啤干投',
      subs: 'Galaxy、Nelson Sauvin', grp: 'citrus',
      craft: '红醋栗与甜瓜的组合，是澳洲系里最"果酱"的一支；干投表现远好于煮沸，煮久了只剩树脂苦。',
      conf: 'B', src: 'Hop Products Australia 公布区间 16-19%，取中值（单源）' },

    { id: 'h-wakatu', name: '瓦卡图', en: 'Wakatu', origin: '新西兰', type: 'aroma',
      aa: 7.5, aaMin: 6.5, aaMax: 8.5,
      aroma: ['青柠', '花香', '蜜瓜'], use: '拉格、皮尔森、比利时白啤',
      subs: 'Motueka、Hallertau', grp: 'floral',
      craft: '新西兰老品种（原 Hallertau Aroma）：青柠与花香，α 7.5 适合收尾。拉格与白啤里比美式香花更"软"，不会压住麦芽。',
      conf: 'B', src: 'NZ Hops 公布区间 6.5-8.5%，取中值（单源）' },

    { id: 'h-waiiti', name: '怀伊蒂', en: 'Wai-iti', origin: '新西兰', type: 'aroma',
      aa: 3, aaMin: 2.5, aaMax: 4,
      aroma: ['青柠', '蜜桃', '柑橘'], use: '低苦度淡艾、小麦啤、无酒精啤酒',
      subs: 'Motueka、Mandarina Bavaria', grp: 'citrus',
      craft: 'α 只有 3，几乎不能做主苦：它是给"低苦度、高香气"风格用的。20L 干投 30g 也不苦，这就是它的价值。',
      conf: 'B', src: 'NZ Hops 公布区间 2.5-4%，取中值（单源）' },

    { id: 'h-sladek', name: '斯拉德克', en: 'Sladek', origin: '捷克', type: 'aroma',
      aa: 5, aaMin: 4, aaMax: 6,
      aroma: ['草本', '香料', '柑橘'], use: '捷克拉格、皮尔森的"第二支酒花"',
      subs: 'Saaz、Kazbek', grp: 'noble',
      craft: '捷克育成的萨兹替身，α 5 略高于 Saaz：传统做法是 Saaz 主香、Sladek 补苦，全用 Sladek 会比纯 Saaz 硬一点。',
      conf: 'B', src: '捷克 Hop Research Institute 公布区间 4-6%，取中值（单源）' },

    { id: 'h-kazbek', name: '卡兹贝克', en: 'Kazbek', origin: '捷克', type: 'aroma',
      aa: 5.5, aaMin: 4.5, aaMax: 6.5,
      aroma: ['柠檬', '草本', '辛香'], use: '捷克拉格、比利时艾尔',
      subs: 'Saaz、Sladek', grp: 'noble',
      craft: '2008 年登记的捷克新品种，柠檬感比 Saaz 明显；做拉格时与 Saaz 各半，会得到"熟悉但更新鲜"的贵族香。',
      conf: 'B', src: '捷克 Hop Research Institute 公布区间 4.5-6.5%，取中值（单源）' },

    { id: 'h-tsingtao', name: '青岛大花', en: 'Qingdao Da Hua', origin: '中国（新疆/山东）', type: 'aroma',
      aa: 6.5, aaMin: 5, aaMax: 8,
      aroma: ['草本', '泥土', '辛香'], use: '国产拉格补苦、工业风格',
      subs: 'Cluster、Northern Brewer', grp: 'earthy',
      craft: '国内种植面积最大的老品种，α 随产地与年份波动很大（5–8%）；草本与泥土调为主，做拉格补苦够用，做香花则层次单薄。',
      conf: 'C', src: '国内产区公开区间 5-8%，无厂商技术表——**务必查当年 COA**' }
  ];

  BREW.DB.hopCats = {
    bitter: { zh: '苦花', desc: 'α 酸高，追求单位重量最大苦度，香气次要', color: '#ab695f' },
    aroma:  { zh: '香花', desc: 'α 酸低，精油含量高，用于后段与干投', color: '#769873' },
    dual:   { zh: '双用途', desc: '苦香兼用，现代 IPA 的主力', color: '#be9558' }
  };

  /** 投放阶段：impact = 是否对 IBU 有贡献，factor = 该阶段默认利用率系数（相对 60min 煮沸） */
  BREW.DB.hopStages = [
    { id: 'firstwort', zh: '首麦汁',   ibu: true,  defaultMin: 20, note: '洗糟时投入，IBU 贡献约等同 20 分钟煮沸，但苦味更平滑' },
    { id: 'mash',      zh: '糖化',     ibu: true,  defaultMin: 30, note: '少用，会损失部分香气，IBU 贡献不稳定' },
    { id: 'boil',      zh: '煮沸',     ibu: true,  defaultMin: 60, note: '主苦来源，60 分钟达利用率平台' },
    { id: 'whirlpool', zh: '回旋/静置', ibu: true,  defaultMin: 20, note: '80°C 以上仍有异构化，按下 15-20 分钟等效计入' },
    { id: 'dryhop',    zh: '干投',     ibu: false, defaultMin: 0,  note: '几乎不贡献 IBU，但多酚会降低感知苦度' },
    { id: 'keg',       zh: '桶中干投',  ibu: false, defaultMin: 0,  note: '装桶后追加香气' }
  ];

  /* ==========================================================================
   * 品类导览（第一层文案）——按香型分组，不按苦花/香花/双用途分
   * --------------------------------------------------------------------------
   * 理由：用户挑酒花时先想"我要什么味"，再想"用它当苦花还是香花"。
   * 一个品种的 type 只说明它适合怎么投，grp 才说明它是什么味。
   * 每篇：香气特征 / 什么时候投 / 用量与 IBU 的关系 / 常见误用。
   * ========================================================================*/
  BREW.DB.catGuides = BREW.DB.catGuides || {};
  BREW.DB.catGuides.hop = [
    {
      key: 'noble', zh: '贵族香花', keys: ['noble'],
      lead: '低 α、低 coh、香得克制：欧洲传统拉格与小麦啤的骨架。',
      what: '萨兹、哈拉道、泰特南、施帕尔特这一系，α 多在 2–6%，coh 20–25%，香气以草本、花香、辛香为主。它们的共同点不是"香得浓"，而是"香得克制"——低 α 意味着必须用很大用量，反过来说，你可以放心地大量投放而不会把苦味做粗。',
      when: '主苦在 60 分钟（20L 皮尔森常要 80–120g）；香气的关键在最后 10 分钟与回旋；干投也可以，但要 2–4g/L 才明显。',
      ibu: '同样重量，α 4% 的萨兹只有 α 12% 的品种三分之一的苦度。用贵族酒花做 40 IBU，投料量会是高 α 品种的三倍，苦味却更圆润——这是风格要求，不是浪费。',
      mistakes: [
        '按高 α 品种的克数投料，结果 IBU 只有目标的三分之一，酒寡淡得像兑了水。',
        '60 分钟猛煮之后指望香气：精油在那一小时里基本跑光，香气必须靠后段补。',
        '把"贵族"当"高级"：它们撑不起美式 IPA 的果香，用错风格只会显得没味道。'
      ]
    },
    {
      key: 'citrus', zh: '柑橘与热带水果', keys: ['citrus'],
      lead: '新世界的主流语言：葡萄柚、百香果、荔枝、白葡萄酒。',
      what: '卡斯卡特、世纪、西楚、马赛克、银河、尼尔森这一族，α 多在 6–14%，coh 22–35%。香气来自高含量的萜烯与含硫化合物，后者是"百香果/醋栗"这类味道的来源。它们的辨识度极高：一杯酒只要用了西楚，几乎瞒不过去，也因此常被用来做单一品种的表达。',
      when: '主苦可以交给族里的高 α 成员，但香气必须留在最后 10 分钟、回旋与干投。干投是这类酒花的主场，2–8g/L 都有人用，浑浊 IPA 甚至更高。',
      ibu: 'α 跨度大（6.5–14），同一克数能差一倍苦度；同一品种不同年份还能差 3 个点。换批次必须重算 IBU，不要拿去年的用量套今年。',
      mistakes: [
        '全部在 60 分钟投入：只剩苦，果香一点不剩。',
        '干投过量又不控时间：超过 3–5 天，植物多酚带来的涩与青味会盖过果香。',
        '用它替换贵族酒花做皮尔森：风格会从"干净"直接变成"果汁"。'
      ]
    },
    {
      key: 'resin', zh: '松脂与树脂', keys: ['resin'],
      lead: '西海岸 IPA 的骨架：松针、树脂、木质。',
      what: '西姆科、奇努克、哥伦布、北酿这一系，香气指向松针、树脂、木质与药草，coh 常在 33–40%，苦味比同 α 的贵族系更硬。那种常被形容为 dank 的气息来自含硫化合物，是美式 IPA 的标志之一。',
      when: '60 分钟做主苦最划算；后段与干投可以给骨架感，但用量要克制，1–3g/L 已经很明显，再多就是松节油。',
      ibu: '高 α 加高 coh：20L 里 15–20g 就能贡献 40 IBU 上下。苦味是"有力"而不是"圆润"，与麦芽甜对抗时很占优势，做双料 IPA 尤其合适。',
      mistakes: [
        '拿它做清爽型拉格：树脂感会显得脏，把麦芽的干净全盖住。',
        '干投超量：松针与药草会盖掉一切，喝起来像松节油。',
        '忽略 coh：同样 12% α，coh 40 的品种比 coh 24 的明显更"刺"，换品种等于换了苦味形状。'
      ]
    },
    {
      key: 'floral', zh: '花香', keys: ['floral'],
      lead: '英式与欧陆的花香蜂蜜调，最适合做收尾。',
      what: '东肯特戈尔丁、挑战者、第一金、施蒂利亚戈尔丁这一系，香气偏向花香、蜂蜜、橙皮，α 多在 5–8%，coh 25–33%。英式艾尔那层"优雅"多半由它们提供，比利时风格也常用它们做香气的中间层。它们几乎不带热带水果，所以和果香型酒花混投时不会打架，适合做"骨架香"。',
      when: '最后 10 分钟与回旋。主苦也能用，但 α 不高，通常是和高 α 苦花分工：一个管苦，一个管香。',
      ibu: 'α 5–8% 属于中间地带：既能贡献一部分苦度，又不至于把用量推到夸张。英式苦啤常用同一支酒花同时做 60 分钟与 10 分钟两段，风格一致性最好。',
      mistakes: [
        '用花香型去撑双料 IPA 的苦度：用量会大到带出草本涩味。',
        '把"花香"理解成"浓香"：它其实很轻，配方里其他原料一多就被盖住。',
        '干投时间过长：花香是最先散的一层，2–3 天足够。'
      ]
    },
    {
      key: 'earthy', zh: '泥土与辛香', keys: ['earthy'],
      lead: '泥土、木质、黑加仑、胡椒：英式深色酒的底色。',
      what: '法格尔、威拉米特、布拉姆林十字、北唐这一系，香气指向泥土、木质、黑加仑与辛香，α 多在 4–9%。它们不"亮"，但能让深色麦芽的苦变得有层次，是波特与世涛里最不出错的一类香花；浅色酒里只当配角，用量一克都别多。',
      when: '最后 5–15 分钟，深色艾尔与波特尤其合适；做主苦需要两到三倍用量，效率不高。干投也行，但 1–2g/L 已经足够，再多会显得土腥。',
      ibu: 'α 4–9%，主苦效率一般。它们的价值在"苦味形状"：与烘烤谷物的焦苦叠在一起时，会显得更完整，而不是更苦，这是深色配方里最难替代的一环。把它换掉，酒会突然变得没有底。',
      mistakes: [
        '在浅色酒里用太多：泥土感会显得土腥，把酒花的柑橘香压住。',
        '期待它给果香：这一族的果味是黑加仑式的暗色果，不是柑橘。',
        '与大量烘烤麦芽叠加却不减量：双重苦涩会让收口发干。'
      ]
    },
    {
      key: 'highaa', zh: '高 α 双用途与苦花', keys: ['highaa'],
      lead: '效率优先：用最少的克数拿到想要的 IBU。',
      what: '马格努姆、勇士、CTZ、阿波罗这一族，α 从 11% 到 20% 以上，coh 跨度 24–47%。它们的存在意义是"省"：同样的 IBU，投料量可能只有贵族酒花的四分之一，酒花糟也少得多。coh 低的（如马格努姆 24）还能兼一点香气。',
      when: '60 分钟。后段价值取决于 coh：coh 24–28 的还能在后段给干净的香，coh 37–47 的后段只剩粗苦，不如省下来。',
      ibu: 'α 每差 1 个百分点，20L 里 20g 投料就差约 3 IBU。高 α 品种的称量误差被放大，建议用 0.1g 精度的秤，而不是"一撮"。',
      mistakes: [
        '按"高 α 就少放"估个大概：差 2g 就是 5 IBU，苦度会跑出风格区间。',
        '拿高 coh 品种做干投：药草与粗苦会毁掉酒花香气，这是最常见的浪费。',
        '只用一个高 α 品种贯穿全程：苦有了，香气层次没有。'
      ]
    },
    {
      key: 'exp', zh: '实验与新世界品种', keys: ['exp'],
      lead: '2000 年之后的新品种：风味强、数据弱，先查 COA。',
      what: '这一类多是 2010 年前后由育种公司推出的商业品种，风味指向非常具体（椰子、青椒、玫瑰、莳萝）。本库里它们的置信度多为 C，因为公开的 α 区间窄、但年份波动大，厂商之间的数据也不完全一致——先查 COA，再谈配方。',
      when: '后段与干投为主。它们的设计目标就是"香气辨识度"，主苦交给成熟的高 α 品种更稳、也更便宜，后段用量也要压住。',
      ibu: 'α 多在 8–16%，但 C 级意味着你手里的数字可能差 1–2 个点。按批次 COA 重算，别用库里中值直接下料。',
      mistakes: [
        '不看批次直接用中值：C 级数据的误差会原样变成 IBU 偏差。',
        '单一品种大剂量：这类酒花风味极强，1–2g/L 就可能主导整杯酒。',
        '期待它"像 Citra"：它们的价值恰恰是不像。'
      ]
    }
  ];

})(typeof window !== 'undefined' ? window : globalThis);
