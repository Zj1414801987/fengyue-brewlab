/* ============================================================================
 * 风月酿研所 — 15 风格库（90 条）
 * ----------------------------------------------------------------------------
 * 用途：给配方一个"靶子"。
 *
 * ⚠ 这里**不是**「BJCP 2021 全量」，构成写清楚：
 *
 *   · 框架与绝大多数区间来自 **BJCP 2015**；
 *   · 2021 相对 2015 改过的区间已按字段逐条迁移。逐字段统计（官方 2015→2021）：
 *       OG 0 条、FG 0 条（所以 49 条经典配方的麦量与糖化模型不需要重调）、
 *       IBU 3 条、ABV 9 条、SRM 30 条（=24 条纯 SRM + 6 条 SRM 与 ABV/IBU 同时变）。
 *     注意 27G 本库未收录，所以 SRM 实际写入 24 条、5 条本库已是新值；
 *     口径与明细见 docs/05 §5（"30 条"是官方两版对照的字段级计数，
 *     与"本库现状 vs 2021 有 46 条差异"不是同一个比较基准，别相加）；
 *   · 编号用 **2021**：21C = Hazy IPA（本库旧 id `21B-NEIPA` 已归位，
 *     保留在 altIds 里供老配方解析）、22A–22D = 双料 IPA / 美式烈性艾尔 /
 *     美式大麦酒 / 小麦酒；
 *   · 28A / 29A / 30A / 33A 四项官方原文是 "varies by base style"，没有数值窗口，
 *     库里的区间是**本库自定**（字段 rangeSource:'local'，界面会标注不是 BJCP 值）；
 *   · 覆盖 90 条 / 官方 122 条，整类未收录 27 历史啤酒 / 31 替代发酵原料 /
 *     32 烟熏 / 34 特色啤酒。
 *
 * 改任何区间前先读 docs/05：改完必须重跑 tools/audit-data.js（区间 lo<=hi）
 * 与 tools/test-recipe.js，并数一遍 49 条经典配方的越界数——区间动一格，
 * 界面上只是几个小字变红，没人会注意。
 *
 * 关键理解（UI 文案会引用）：
 *   - 区间是"参赛判定"的边界，不是"好喝"的边界。稍微出界不代表酒坏了，
 *     只代表它不该投这个分类。
 *   - 一个配方可以在 OG 上落在区间内、IBU 上出界，此时最该做的是判断
 *     "我想酿的其实是另一个风格"，而不是硬把数字塞进去。
 *   - ABV 区间与 OG/FG 不是独立的：三者互相约束，引擎会用 OG/FG 反算校验。
 *
 * 字段：og/fg 为比重，abv 为 %，ibu 为 IBU，srm 为 SRM。数组均为 [min, max]。
 *      altIds（可选）：旧编号别名。rangeSource:'local'：本库自定窗口。
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  BREW.DB = BREW.DB || {};

  BREW.DB.styles = [
    /* ============ 1. 美式标准啤酒 ============ */
    { id: '1A', name: '美式淡爽拉格', en: 'American Light Lager', cat: '美式', group: 1,
      og: [1.028, 1.040], fg: [0.998, 1.008], abv: [2.8, 4.2], ibu: [8, 12], srm: [2, 3],
      overall: '极度清爽、几乎无味的解渴型拉格，任何瑕疵都藏不住',
      key: ['麦芽骨架极淡，酒花只做微弱平衡', '要求极高的发酵卫生与控温', '碳酸感活跃，收口干脆'],
      fault: ['温度失控产生乙醛（青苹果）或双乙酰（黄油）', '氧化后出现纸板味，因为没有任何风味可以掩盖'],
      ex: ['Bud Light', 'Coors Light', 'Miller Lite'] },

    { id: '1B', name: '美式拉格', en: 'American Lager', cat: '美式', group: 1,
      og: [1.040, 1.050], fg: [1.004, 1.010], abv: [4.2, 5.3], ibu: [8, 18], srm: [2, 3.5],
      overall: '干净、淡麦芽、轻酒花的日常拉格，比淡爽版多一点骨架',
      key: ['常用玉米/大米辅料稀释麦芽味', '发酵必须干净，无酯无硫', '泡沫细腻，酒体轻'],
      fault: ['辅料比例过高导致寡淡', '拉格化时间不足，有硫味'],
      ex: ['Budweiser', 'Heineken（荷式风格略偏）'] },

    { id: '1C', name: '奶油艾尔', en: 'Cream Ale', cat: '美式', group: 1,
      og: [1.042, 1.055], fg: [1.006, 1.012], abv: [4.2, 5.6], ibu: [8, 20], srm: [2, 5],
      overall: '用艾尔酵母酿出拉格般干净的金色啤酒，轻微果酯是特征',
      key: ['常掺 10-20% 玉米增干爽', '可用拉格/艾尔混合发酵', '收口比美式拉格更圆润'],
      fault: ['为了"奶油感"加乳糖——那不是本风格', '发酵温度过高产生明显果酯'],
      ex: ['Genesee Cream Ale', 'Little Kings Cream Ale'] },

    { id: '1D', name: '美式小麦啤', en: 'American Wheat Beer', cat: '美式', group: 1,
      og: [1.040, 1.055], fg: [1.008, 1.013], abv: [4.0, 5.5], ibu: [15, 30], srm: [3, 6],
      overall: '清爽的小麦啤酒，**没有德式小麦的香蕉丁香**，酒花可以更突出',
      key: ['用中性艾尔酵母，不是德式小麦酵母', '小麦占比 30-50%，口感柔和', '常配柑橘类酒花或果皮'],
      fault: ['用了 WB-06/3068 就变成德式小麦了', '小麦比例过高导致浑浊且滤槽堵塞'],
      ex: ['Bell\'s Oberon', 'Widmer Hefeweizen'] },

    /* ============ 2. 国际拉格 ============ */
    { id: '2A', name: '国际淡色拉格', en: 'International Pale Lager', cat: '国际', group: 2,
      og: [1.042, 1.050], fg: [1.008, 1.012], abv: [4.5, 6.0], ibu: [18, 25], srm: [2, 3],
      overall: '介于美式拉格与皮尔森之间的全球化风格，干净、易饮',
      key: ['比美式拉格多一点麦芽与酒花', '强调易饮性而非个性', '各国版本差异大'],
      fault: ['过度追求"有个性"反而偏离', '控温不当出酯'],
      ex: ['Peroni', 'Birra Moretti', 'Tsingtao（青岛经典）'] },

    { id: '2B', name: '国际琥珀拉格', en: 'International Amber Lager', cat: '国际', group: 2,
      og: [1.042, 1.055], fg: [1.008, 1.014], abv: [4.5, 6.0], ibu: [8, 25], srm: [6, 14],
      overall: '琥珀色的易饮拉格，焦糖麦芽带来温和甜感',
      key: ['结晶麦芽提供色与甜', '酒花通常很低调', '适合作为"入门深色啤酒"'],
      fault: ['焦糖麦芽过量导致甜腻', '色度靠深色麦芽硬拉，风味不匹配'],
      ex: ['Dos Equis Amber', 'Samuel Adams Boston Lager（边界）'] },

    { id: '2C', name: '国际深色拉格', en: 'International Dark Lager', cat: '国际', group: 2,
      og: [1.044, 1.056], fg: [1.008, 1.012], abv: [4.2, 6.0], ibu: [8, 20], srm: [14, 30],
      overall: '深色但不厚重，烘烤感柔和，比世涛轻得多',
      key: ['用去苦黑麦芽上色，避免焦苦', '酒体清爽，回甘明显', '常见于南美与加勒比'],
      fault: ['用黑专利麦芽过量，变成"稀世涛"', '误以为深色=重口味'],
      ex: ['Negra Modelo', 'Xingu Black Beer'] },

    /* ============ 3. 捷克拉格 ============ */
    { id: '3A', name: '捷克淡色拉格', en: 'Czech Pale Lager', cat: '捷克', group: 3,
      og: [1.028, 1.044], fg: [1.008, 1.014], abv: [3.0, 4.1], ibu: [20, 35], srm: [3, 5],
      overall: '比皮尔森更轻的捷克日常拉格，萨兹酒花清晰',
      key: ['全部用萨兹系酒花', '可采用三次煮出糖化增加麦芽深度', '苦味柔和绵长'],
      fault: ['用高 α 苦花替代萨兹，苦味变尖锐', '忽略水的低碱度要求'],
      ex: ['Pilsner Urquell 的轻版', 'Bernard Svetly Lezak'] },

    { id: '3B', name: '捷克优质淡色拉格（皮尔森）', en: 'Czech Premium Pale Lager', cat: '捷克', group: 3,
      og: [1.044, 1.060], fg: [1.010, 1.017], abv: [4.2, 6.0], ibu: [30, 45], srm: [3.5, 6],
      overall: '**世界啤酒的基准风格之一**：金色、清亮、萨兹酒花的辛香与柔和苦味',
      key: ['萨兹酒花 3-4 次添加，苦味圆润不刺', '极软水（皮尔森水质）', '低温长时间拉格化，双乙酰必须归零'],
      fault: ['用 Cascade 等美式酒花会完全跑偏', '拉格化时间不足残留双乙酰（黄油味）', '水的碱度没降，颜色发深、酒花发钝'],
      ex: ['Pilsner Urquell', 'Budvar (Czechvar)', 'Kout na Šumavě'] },

    { id: '3C', name: '捷克琥珀拉格', en: 'Czech Amber Lager', cat: '捷克', group: 3,
      og: [1.048, 1.060], fg: [1.010, 1.017], abv: [4.4, 6.0], ibu: [18, 30], srm: [10, 16],
      overall: '琥珀色的捷克拉格，焦糖麦芽与萨兹形成独特的"甜-辛"平衡',
      key: ['捷克特色，国际上少见', '麦芽甜与酒花香并重', '酒体中等偏饱满'],
      fault: ['焦糖过重盖住萨兹', '与维也纳拉格混淆（后者更干、更偏德式）'],
      ex: ['U Fleků Flekovský', 'Kout na Šumavě 18°'] },

    { id: '3D', name: '捷克深色拉格', en: 'Czech Dark Lager', cat: '捷克', group: 3,
      og: [1.048, 1.060], fg: [1.012, 1.020], abv: [4.4, 6.0], ibu: [18, 34], srm: [17, 35],
      overall: '深棕至黑色，但口感意外轻盈，烘烤感柔和带果香',
      key: ['与世涛的区别：酒体更薄、烘烤更柔、回甘明显', '常用三次煮出糖化', '萨兹酒花收尾'],
      fault: ['做成"小世涛"，酒体过厚', '烘烤麦芽过量导致焦苦'],
      ex: ['U Fleků Tmavé', 'Kozel Dark'] },

    /* ============ 4. 淡色麦芽型欧陆拉格 ============ */
    { id: '4A', name: '慕尼黑清亮啤酒', en: 'Munich Helles', cat: '德式', group: 4,
      og: [1.044, 1.048], fg: [1.006, 1.012], abv: [4.7, 5.4], ibu: [16, 22], srm: [3, 5],
      overall: '德式"清亮"拉格：淡金色、麦芽甜柔和、苦味极低',
      key: ['麦芽是主角，酒花只做平衡', '必须干净无酯', '比皮尔森更柔、更甜'],
      fault: ['酒花过量就变成皮尔森', '麦芽品种单薄，喝起来像"淡啤酒"'],
      ex: ['Augustiner Lagerbier Hell', 'Weihenstephaner Original'] },

    { id: '4B', name: '三月节啤酒（Festbier）', en: 'Festbier', cat: '德式', group: 4,
      og: [1.054, 1.060], fg: [1.010, 1.014], abv: [5.8, 6.3], ibu: [18, 25], srm: [4, 6],
      overall: '慕尼黑啤酒节的现代主力：比三月啤酒更淡、更易饮',
      key: ['金色到浅琥珀，麦芽饱满但不甜腻', '酒精度高于普通拉格', '极易饮，危险'],
      fault: ['与 Märzen 混为一谈（Märzen 更深更麦芽）', '酒精度高但酒体单薄，显得"水' ],
      ex: ['Augustiner Festbier', 'Paulaner Festbier'] },

    { id: '4C', name: '清亮博克', en: 'Helles Bock / Maibock', cat: '德式', group: 4,
      og: [1.064, 1.072], fg: [1.011, 1.018], abv: [6.3, 7.4], ibu: [23, 35], srm: [6, 9],
      overall: '淡色高浓度拉格，麦芽甜强但发酵彻底，收口仍干净',
      key: ['"五月博克"，春季饮用', '麦芽感强、酒精度高、酒花略增', '不能甜腻'],
      fault: ['残糖过高变成糖水', '发酵不彻底，双乙酰明显'],
      ex: ['Ayinger Maibock', 'Einbecker Mai-Urbock'] },

    /* ============ 5. 淡色苦味欧陆啤酒 ============ */
    { id: '5A', name: '德式轻啤', en: 'German Leichtbier', cat: '德式', group: 5,
      og: [1.026, 1.034], fg: [1.006, 1.010], abv: [2.4, 3.6], ibu: [15, 28], srm: [1.5, 4],
      overall: '低酒精度的德式拉格，麦芽与酒花被"压缩"但仍保持平衡',
      key: ['酒精度 2.4-3.6%，适合长饮', '不能因为低酒精度就寡淡', '德式"轻啤"不是"低卡"'],
      fault: ['稀释过度，风味全失', '为补风味加糖，反而失衡'],
      ex: ['Ayinger Leichtbier', 'Weihenstephaner Leicht'] },

    { id: '5B', name: '科隆啤酒', en: 'Kölsch', cat: '德式', group: 5,
      og: [1.044, 1.050], fg: [1.007, 1.011], abv: [4.4, 5.2], ibu: [18, 30], srm: [3.5, 5],
      overall: '**上层发酵却像拉格一样干净**的淡金色啤酒，柔和果酯是唯一线索',
      key: ['用科隆类酵母，18-20°C 发酵后低温熟成', '果酯极淡（梨、苹果），不能有香蕉', '收口干脆，酒花柔和'],
      fault: ['用 US-05 虽然也能做，但缺少那一点果酯', '发酵温度过高导致酯香过头'],
      ex: ['Früh Kölsch', 'Reissdorf Kölsch', 'Gaffel'] },

    { id: '5C', name: '德式出口啤酒', en: 'German Helles Exportbier', cat: '德式', group: 5,
      og: [1.048, 1.056], fg: [1.010, 1.015], abv: [5.0, 6.0], ibu: [20, 30], srm: [4, 6],
      overall: '多特蒙德风格的出口拉格：比清亮啤酒更有矿感与骨架',
      key: ['原产多特蒙德，硬水带来矿物感', '麦芽与酒花都比 Helles 更明显', '酒体中等'],
      fault: ['用纯软水就失去风格特征', '硫酸盐过高变涩'],
      ex: ['Dortmunder Union', 'DAB Export'] },

    { id: '5D', name: '德式皮尔森', en: 'German Pils', cat: '德式', group: 5,
      og: [1.044, 1.050], fg: [1.008, 1.013], abv: [4.4, 5.2], ibu: [22, 40], srm: [2, 4],
      overall: '比捷克皮尔森更干、更脆、苦味更明确，酒花更"锋利"',
      key: ['德式酒花（Hallertau/Tettnanger）', '苦味清晰但干净，不回苦', '极干的收口'],
      fault: ['苦味过重变成"苦水"', '水的碱度未降，酒花味发闷'],
      ex: ['Jever Pilsener', 'Bitburger', 'Victory Prima Pils'] },

    /* ============ 6. 琥珀麦芽型欧陆拉格 ============ */
    { id: '6A', name: '三月啤酒（Märzen）', en: 'Märzen', cat: '德式', group: 6,
      og: [1.054, 1.060], fg: [1.010, 1.014], abv: [5.6, 6.3], ibu: [18, 24], srm: [8, 17],
      overall: '琥珀色、烤面包香的经典啤酒节啤酒，麦芽圆润',
      key: ['慕尼黑/维也纳麦芽主导', '酒花低，只做平衡', '酒体饱满但收口干净'],
      fault: ['焦糖麦芽过量变甜腻', '与 Festbier 混淆（后者更淡）'],
      ex: ['Paulaner Oktoberfest Märzen', 'Hacker-Pschorr'] },

    { id: '6B', name: '烟熏啤酒', en: 'Rauchbier', cat: '德式', group: 6,
      og: [1.050, 1.057], fg: [1.012, 1.016], abv: [4.8, 6.0], ibu: [20, 30], srm: [12, 22],
      overall: '班贝格特产：用烟熏麦芽酿的琥珀拉格，培根/篝火般的烟熏味',
      key: ['烟熏麦芽占 20-60%，用山毛榉木熏', '烟熏是主角但不能刺鼻', '底层是干净的琥珀拉格'],
      fault: ['烟熏过量变成"液体培根"', '用液体烟熏剂，味道像化学药水'],
      ex: ['Aecht Schlenkerla Rauchbier Märzen', 'Spezial Rauchbier'] },

    { id: '6C', name: '深色博克', en: 'Dunkels Bock', cat: '德式', group: 6,
      og: [1.064, 1.072], fg: [1.013, 1.019], abv: [6.3, 7.2], ibu: [20, 27], srm: [14, 25],
      overall: '深色高浓度拉格，烤面包与焦糖，麦芽甜丰满',
      key: ['慕尼黑麦芽为主，可加少量烘烤麦芽', '酒精度高但平衡', '冬季/春季饮用'],
      fault: ['烘烤过重变成世涛', '甜腻不干'],
      ex: ['Ayinger Altbairisch Dunkel', 'Weltenburger Kloster Asam-Bock'] },

    /* ============ 7. 琥珀苦味欧陆啤酒 ============ */
    { id: '7A', name: '维也纳拉格', en: 'Vienna Lager', cat: '德式', group: 7,
      og: [1.048, 1.055], fg: [1.010, 1.014], abv: [4.7, 5.5], ibu: [18, 30], srm: [9, 15],
      overall: '琥珀至铜色，烤面包与轻柔焦糖，比 Märzen 更干更脆',
      key: ['维也纳麦芽提供独特的"烤面包"感', '收口比 Märzen 干', '墨西哥版本（Dos Equis）是变体'],
      fault: ['焦糖过重变甜', '与琥珀艾尔混淆（后者有果酯）'],
      ex: ['Devils Backbone Vienna Lager', 'Cuauhtémoc Noche Buena'] },

    { id: '7B', name: '老啤酒（Altbier）', en: 'Altbier', cat: '德式', group: 7,
      og: [1.044, 1.052], fg: [1.008, 1.014], abv: [4.3, 5.5], ibu: [25, 35], srm: [9, 17],
      overall: '杜塞尔多夫特产：铜色、上层发酵但低温熟成，干净中带一点果酯',
      key: ['艾尔酵母 + 低温熟成（"alt"=老式）', '苦味清晰，收口干', '酒花中等，偏草本'],
      fault: ['发酵温度过高失去"干净"', '苦味不足显得寡淡'],
      ex: ['Diebels Alt', 'Uerige Alt', 'Füchschen'] },

    /* ============ 8. 深色欧陆拉格 ============ */
    { id: '8A', name: '慕尼黑深色拉格', en: 'Munich Dunkel', cat: '德式', group: 8,
      og: [1.048, 1.056], fg: [1.010, 1.016], abv: [4.5, 5.6], ibu: [18, 28], srm: [17, 28],
      overall: '深棕色的慕尼黑日常拉格，烤面包、巧克力边、无焦苦',
      key: ['慕尼黑麦芽主导，不加烘烤麦芽也够色', '麦芽香是核心，酒花低调', '比世涛轻、比琥珀拉格深'],
      fault: ['用烘烤麦芽硬拉色度，出焦苦', '酒体过薄撑不起色度'],
      ex: ['Ayinger Altbairisch Dunkel', 'Weihenstephaner Dunkel'] },

    { id: '8B', name: '黑啤（Schwarzbier）', en: 'Schwarzbier', cat: '德式', group: 8,
      og: [1.046, 1.052], fg: [1.010, 1.016], abv: [4.4, 5.4], ibu: [20, 35], srm: [19, 30],
      overall: '**黑色但轻盈**：看起来像世涛，喝起来像拉格',
      key: ['烘烤麦芽提供色与淡咖啡味，但不能有焦苦', '酒体清爽、收口干', '这是"深色不等于厚重"的最好证明'],
      fault: ['做成"小世涛"，酒体过厚过甜', '烘烤麦芽过量，出现灰烬味'],
      ex: ['Köstritzer Schwarzbier', 'Einbecker Schwarzbier'] },

    /* ============ 9. 高浓度欧陆啤酒 ============ */
    { id: '9A', name: '双料博克', en: 'Doppelbock', cat: '德式', group: 9,
      og: [1.072, 1.112], fg: [1.016, 1.024], abv: [7.0, 10.0], ibu: [16, 26], srm: [6, 25],
      overall: '浓缩的液体面包：极浓的麦芽甜、深色果香、高酒精度',
      key: ['修道士"液体面包"，名字常以 -ator 结尾', '麦芽甜是核心，但不能腻', '酒精度高，需长时间熟成'],
      fault: ['发酵不彻底导致甜腻发齁', '酒精感刺鼻（发酵温度过高）'],
      ex: ['Paulaner Salvator', 'Ayinger Celebrator', 'Spaten Optimator'] },

    { id: '9B', name: '冰博克', en: 'Eisbock', cat: '德式', group: 9,
      og: [1.078, 1.120], fg: [1.020, 1.035], abv: [9.0, 14.0], ibu: [25, 35], srm: [17, 30],
      overall: '冷冻浓缩的双料博克：更浓、更甜、更烈，带明显的酒精暖感',
      key: ['把发酵完的酒冷冻后移除冰晶浓缩', '风味极浓缩，甜与酒精并存', '家酿难以精确控制'],
      fault: ['浓缩过度，甜到无法入口', '氧化味被一起浓缩放大'],
      ex: ['Schneider Aventinus Eisbock', 'Kulmbacher Eisbock'] },

    { id: '9C', name: '波罗的海波特', en: 'Baltic Porter', cat: '德式', group: 9,
      og: [1.060, 1.090], fg: [1.016, 1.024], abv: [6.5, 9.5], ibu: [20, 40], srm: [17, 30],
      overall: '用拉格酵母酿的波特：深色、浓麦芽、干净、带焦糖与干果',
      key: ['**拉格酵母**是它与英式波特的关键区别', '酒体比英式波特更干净圆润', '常用糖浆增干'],
      fault: ['用艾尔酵母就丢了风格核心', '烘烤过重变世涛'],
      ex: ['Sinebrychoff Porter', 'Okocim Porter', 'Zywiec Porter'] },

    /* ============ 10. 德式小麦 ============ */
    { id: '10A', name: '德式小麦白啤', en: 'Weissbier / Hefeweizen', cat: '德式小麦', group: 10,
      og: [1.044, 1.052], fg: [1.010, 1.014], abv: [4.3, 5.6], ibu: [8, 15], srm: [2, 6],
      overall: '**香蕉与丁香的教科书**：浑浊、泡沫极佳、清爽解渴',
      key: ['特殊酵母产 4-乙烯基愈创木酚（丁香）与乙酸异戊酯（香蕉）', '小麦占比 ≥50%', '低酒花、高碳酸'],
      fault: ['发酵温度过低→只有丁香没有香蕉；过高→只有香蕉', '为了澄清而过滤，丢了风格'],
      ex: ['Weihenstephaner Hefeweissbier', 'Schneider Weisse', 'Paulaner Hefe'] },

    { id: '10B', name: '德式深色小麦', en: 'Dunkels Weissbier', cat: '德式小麦', group: 10,
      og: [1.044, 1.056], fg: [1.010, 1.014], abv: [4.3, 5.6], ibu: [8, 15], srm: [14, 23],
      overall: '深色版德式小麦：香蕉丁香之上叠加焦糖与淡淡巧克力',
      key: ['在 Weissbier 基础上加慕尼黑/结晶麦芽', '酵母特征仍是主角', '色深但酒体不重'],
      fault: ['烘烤麦芽压住酵母酚香', '色度与风味不匹配'],
      ex: ['Weihenstephaner Hefeweissbier Dunkel', 'Franziskaner Dunkel'] },

    { id: '10C', name: '小麦博克', en: 'Weizenbock', cat: '德式小麦', group: 10,
      og: [1.064, 1.090], fg: [1.015, 1.022], abv: [6.5, 9.0], ibu: [15, 30], srm: [6, 25],
      overall: '高浓度小麦啤酒：香蕉丁香 + 浓郁麦芽 + 高酒精度',
      key: ['小麦酵母特征必须保留', '酒精度高，需熟成', '有淡色与深色两版'],
      fault: ['酒精度压过酵母香', '发酵不彻底'],
      ex: ['Schneider Aventinus', 'Weihenstephaner Vitus'] },

    /* ============ 11. 英式苦啤 ============ */
    { id: '11A', name: '普通苦啤', en: 'Ordinary Bitter', cat: '英式', group: 11,
      og: [1.030, 1.039], fg: [1.007, 1.011], abv: [3.2, 3.8], ibu: [25, 35], srm: [8, 14],
      overall: '低酒精度但风味饱满的英式日常啤酒，苦味清晰',
      key: ['**低酒精度不等于寡淡**：靠麦芽与苦味平衡撑起风味', '英式酵母的果酯是灵魂', '桶中饮用（cask）最佳'],
      fault: ['为了"有味道"加料，失去易饮性', '碳酸过高（英式应低碳酸）'],
      ex: ['Fuller\'s London Pride（边界）', 'Brains Bitter'] },

    { id: '11B', name: '优质苦啤', en: 'Best Bitter', cat: '英式', group: 11,
      og: [1.040, 1.048], fg: [1.008, 1.012], abv: [3.8, 4.6], ibu: [25, 40], srm: [8, 16],
      overall: '英式苦啤的主力档位：麦芽、果酯、苦味三者平衡',
      key: ['Maris Otter 是标准基麦', 'EKG/Fuggle 收尾', '碳酸低、温度 11-13°C 饮用'],
      fault: ['美式酒花过量，变成"英式IPA"', '碳酸过高'],
      ex: ['Fuller\'s London Pride', 'Timothy Taylor Landlord（更接近 Strong）'] },

    { id: '11C', name: '强苦啤', en: 'Strong Bitter / ESB', cat: '英式', group: 11,
      og: [1.046, 1.060], fg: [1.010, 1.016], abv: [4.6, 6.2], ibu: [30, 50], srm: [8, 18],
      overall: '英式苦啤的加强版：更浓的麦芽、更高的酒精度与苦味',
      key: ['ESB = Extra Special Bitter', '麦芽甜与苦味都要够', '酒体饱满'],
      fault: ['酒精度上去了但平衡没跟上', '碳化度过高'],
      ex: ['Fuller\'s ESB', 'Samuel Smith\'s Old Brewery Pale Ale'] },

    /* ============ 12. 淡色英联邦啤酒 ============ */
    { id: '12A', name: '英式金艾', en: 'British Golden Ale', cat: '英式', group: 12,
      og: [1.038, 1.053], fg: [1.006, 1.012], abv: [3.8, 5.0], ibu: [20, 45], srm: [2, 5],
      overall: '英国人对"淡色拉格"的回应：金色、清爽、酒花偏新世界',
      key: ['比苦啤更淡、更干、更清爽', '可用新世界酒花（但别过火）', '适合夏天'],
      fault: ['酒花过量变 IPA', '麦芽单薄'],
      ex: ['Oakham Citra', 'Hop Back Summer Lightning'] },

    { id: '12B', name: '澳式起泡艾', en: 'Australian Sparkling Ale', cat: '英联邦', group: 12,
      og: [1.038, 1.050], fg: [1.004, 1.006], abv: [4.5, 6.0], ibu: [20, 35], srm: [4, 7],
      overall: '澳洲经典：高碳酸、极干、果酯明显，瓶内二次发酵的浑浊感',
      key: ['**FG 极低（1.004-1.006）**，收口极干', '高碳酸是关键特征', '常带酵母浑浊'],
      fault: ['FG 没做下去，变甜腻', '碳酸不足就失去"起泡"'],
      ex: ['Cooper\'s Sparkling Ale', 'Little Creatures Pale Ale（边界）'] },

    { id: '12C', name: '英式 IPA', en: 'English IPA', cat: '英式', group: 12,
      og: [1.050, 1.075], fg: [1.010, 1.018], abv: [5.0, 7.5], ibu: [40, 60], srm: [6, 14],
      overall: '历史 IPA：比美式 IPA 更麦芽、更干、酒花更"土"',
      key: ['英式酒花（EKG/Fuggle/Target）', '麦芽骨架明显，不能只有酒花', '高硫酸盐水质是历史特征'],
      fault: ['用美式酒花就变成美式 IPA', '过度干投（历史上干投很少）'],
      ex: ['Fuller\'s Bengal Lancer', 'Meantime India Pale Ale'] },

    /* ============ 13. 棕色英式啤酒 ============ */
    { id: '13A', name: '深色温和啤酒', en: 'Dark Mild', cat: '英式', group: 13,
      og: [1.030, 1.038], fg: [1.008, 1.013], abv: [3.0, 3.8], ibu: [10, 25], srm: [14, 25],
      overall: '低酒精度、低苦味的英式深色日常啤酒，麦芽甜与焦糖为主',
      key: ['**极低酒精度但风味完整**', '苦味很低，麦芽为主', '英式pub文化代表'],
      fault: ['苦味过高就不"温和"了', '酒体过薄撑不起深色'],
      ex: ['Theakston Mild', 'Brains Dark'] },

    { id: '13B', name: '英式棕艾尔', en: 'British Brown Ale', cat: '英式', group: 13,
      og: [1.040, 1.052], fg: [1.008, 1.013], abv: [4.2, 5.9], ibu: [20, 30], srm: [12, 22],
      overall: '棕色、坚果与焦糖、苦味中等的英式艾尔',
      key: ['坚果感来自琥珀/棕色麦芽', '比波特轻、比苦啤深', '平衡为要'],
      fault: ['烘烤过量变波特', '美式酒花喧宾夺主'],
      ex: ['Newcastle Brown Ale', 'Samuel Smith Nut Brown Ale'] },

    { id: '13C', name: '英式波特', en: 'English Porter', cat: '英式', group: 13,
      og: [1.040, 1.052], fg: [1.008, 1.014], abv: [4.0, 5.4], ibu: [18, 35], srm: [20, 30],
      overall: '深棕至黑色，巧克力与焦糖，比世涛更柔和更"可饮"',
      key: ['棕色麦芽（Brown Malt）是历史特征', '烘烤感柔，不能有灰烬味', '酒体中等'],
      fault: ['做成世涛（过重过苦）', '用黑专利过量'],
      ex: ['Fuller\'s London Porter', 'Samuel Smith Taddy Porter'] },

    /* ============ 14. 苏格兰艾尔 ============ */
    { id: '14A', name: '苏格兰淡啤', en: 'Scottish Light', cat: '苏格兰', group: 14,
      og: [1.030, 1.035], fg: [1.010, 1.013], abv: [2.5, 3.3], ibu: [10, 20], srm: [17, 25],
      overall: '低酒精度、麦芽甜、几乎无酒花苦味的苏格兰日常啤酒',
      key: ['**苦味极低**是苏格兰风格特征', '焦糖与烤面包为主', '冷却麦汁工艺（历史上）'],
      fault: ['按英式苦啤的苦味去做', '酒体过薄'],
      ex: ['Belhaven 60/-', 'Traquair House Ale（更强的版本）'] },

    { id: '14B', name: '苏格兰中啤', en: 'Scottish Heavy', cat: '苏格兰', group: 14,
      og: [1.035, 1.040], fg: [1.010, 1.014], abv: [3.3, 3.9], ibu: [10, 20], srm: [12, 20],
      overall: '中档苏格兰艾尔：麦芽甜、酒体中等、苦味低',
      key: ['与 14A 同族，浓度更高', '焦糖麦芽带来甜感', '低碳酸'],
      fault: ['苦味过头', '甜而腻'],
      ex: ['Belhaven 70/-', 'McEwan\'s Export'] },

    { id: '14C', name: '苏格兰出口啤', en: 'Scottish Export', cat: '苏格兰', group: 14,
      og: [1.040, 1.060], fg: [1.010, 1.016], abv: [3.9, 6.0], ibu: [15, 30], srm: [12, 20],
      overall: '苏格兰艾尔的出口档：麦芽饱满、苦味中等、收口偏甜',
      key: ['80/- 是常见标识', '麦芽复杂度高于前两档', '苦味仍低于同浓度英式'],
      fault: ['按 ESB 的思路做', '过度碳酸'],
      ex: ['Belhaven 80/-', 'Orkney Dark Island（边界）'] },

    /* ============ 15. 爱尔兰啤酒 ============ */
    { id: '15A', name: '爱尔兰红艾', en: 'Irish Red Ale', cat: '爱尔兰', group: 15,
      og: [1.036, 1.046], fg: [1.010, 1.014], abv: [3.8, 5.0], ibu: [18, 28], srm: [9, 14],
      overall: '红铜色、麦芽甜、轻微烘烤收尾的爱尔兰艾尔',
      key: ['红色来自少量烘烤大麦', '苦味低，麦芽为主', '收口比英式更干一点'],
      fault: ['用大量结晶麦芽硬拉红色，变甜腻', '烘烤过量变深色'],
      ex: ['Smithwick\'s', 'O\'Hara\'s Irish Red'] },

    { id: '15B', name: '爱尔兰世涛', en: 'Irish Stout', cat: '爱尔兰', group: 15,
      og: [1.036, 1.044], fg: [1.007, 1.011], abv: [3.8, 5.0], ibu: [25, 45], srm: [25, 40],
      overall: '**黑色但酒体轻盈**：干爽、咖啡焦苦、收口干脆',
      key: ['烘烤大麦（未发芽）是灵魂', '酒体比看起来轻得多', '氮气版本口感如奶油'],
      fault: ['做成厚重的帝国世涛', '甜度过高（本风格必须干）'],
      ex: ['Guinness Draught', 'Murphy\'s Irish Stout', 'Beamish'] },

    { id: '15C', name: '爱尔兰浓世涛', en: 'Irish Extra Stout', cat: '爱尔兰', group: 15,
      og: [1.052, 1.062], fg: [1.010, 1.014], abv: [5.0, 6.5], ibu: [35, 50], srm: [30, 40],
      overall: '爱尔兰世涛的加强版：更浓、更苦、更饱满',
      key: ['比 Irish Stout 浓度高', '烘烤与苦味都更强', '仍是干爽收口'],
      fault: ['变甜变腻', '酒体过厚失平衡'],
      ex: ['Guinness Extra Stout', 'Foreign Extra（更强）'] },

    /* ============ 16. 深色英式啤酒 ============ */
    { id: '16A', name: '甜世涛（牛奶世涛）', en: 'Sweet Stout / Milk Stout', cat: '英式', group: 16,
      og: [1.044, 1.060], fg: [1.012, 1.024], abv: [4.0, 6.0], ibu: [20, 40], srm: [30, 40],
      overall: '加乳糖的甜世涛：奶甜、巧克力、酒体厚',
      key: ['**乳糖不可发酵**，提供甜味与酒体', 'FG 明显偏高是设计目标', '苦味必须够以平衡甜'],
      fault: ['乳糖过量，甜到发腻', '苦味不足，像巧克力奶'],
      ex: ['Left Hand Milk Stout', 'Mackeson\'s XXX Stout'] },

    { id: '16B', name: '燕麦世涛', en: 'Oatmeal Stout', cat: '英式', group: 16,
      og: [1.045, 1.065], fg: [1.010, 1.018], abv: [4.2, 5.9], ibu: [25, 40], srm: [22, 40],
      overall: '燕麦带来丝滑口感与绵密泡沫的世涛',
      key: ['燕麦 5-20%，提供 β-葡聚糖的"油润感"', '比甜世涛干', '泡沫极佳'],
      fault: ['燕麦过量导致滤槽堵塞（加稻壳）', '燕麦太少喝不出区别'],
      ex: ['Samuel Smith Oatmeal Stout', 'Anderson Valley Barney Flats'] },

    { id: '16C', name: '热带世涛', en: 'Tropical Stout', cat: '英式', group: 16,
      og: [1.056, 1.075], fg: [1.010, 1.018], abv: [5.5, 8.0], ibu: [30, 50], srm: [30, 40],
      overall: '为热带市场酿的高浓度世涛：甜、果香、酒体厚',
      key: ['历史上面向加勒比/非洲市场', '比英式世涛更甜更浓', '常带深色果干香'],
      fault: ['按干世涛的思路做', '酒精感刺鼻'],
      ex: ['Lion Stout', 'Dragon Stout'] },

    { id: '16D', name: '外销浓世涛', en: 'Foreign Extra Stout', cat: '英式', group: 16,
      og: [1.056, 1.075], fg: [1.010, 1.018], abv: [6.3, 8.0], ibu: [50, 70], srm: [30, 40],
      overall: '高浓度高苦度的世涛，历史上为长途运输而酿',
      key: ['苦味明显高于其他世涛（50-70 IBU）', '酒精度高', '烘烤感强烈'],
      fault: ['苦味不足', '酒体单薄'],
      ex: ['Guinness Foreign Extra Stout', 'ABC Extra Stout'] },

    /* ============ 17. 英式烈性艾尔 ============ */
    { id: '17A', name: '英式烈性艾尔', en: 'British Strong Ale', cat: '英式', group: 17,
      og: [1.055, 1.080], fg: [1.015, 1.022], abv: [5.5, 8.0], ibu: [30, 60], srm: [8, 22],
      overall: '英式的高浓度艾尔：麦芽复杂、果酯、酒花中等',
      key: ['介于 ESB 与大麦酒之间', '麦芽与果酯并重', '适合冬季'],
      fault: ['酒精度高但风味单薄', '过度碳酸'],
      ex: ['Fuller\'s 1845', 'Samuel Smith Winter Welcome'] },

    { id: '17B', name: '老艾尔', en: 'Old Ale', cat: '英式', group: 17,
      og: [1.055, 1.088], fg: [1.015, 1.022], abv: [5.5, 9.0], ibu: [30, 60], srm: [10, 22],
      overall: '经过长期陈酿的英式艾尔，带氧化产生的干果与葡萄酒般复杂感',
      key: ['适度氧化是**特征不是缺陷**（与其他风格相反）', '常与年轻酒液混合', '干果、雪利、焦糖'],
      fault: ['氧化过度变纸板味', '没有陈酿就装瓶，缺少复杂度'],
      ex: ['Theakston Old Peculier', 'Fuller\'s Vintage Ale'] },

    { id: '17C', name: '苏格兰重艾（Wee Heavy）', en: 'Wee Heavy / Scotch Ale', cat: '苏格兰', group: 17,
      og: [1.070, 1.130], fg: [1.018, 1.040], abv: [6.5, 10.0], ibu: [17, 35], srm: [14, 25],
      overall: '极浓的苏格兰艾尔：焦糖、深色果干、低苦味、酒体厚重',
      key: ['**长时间煮沸**（2-3h）产生焦糖化', '苦味低、甜度高', '酒精度高但顺口'],
      fault: ['苦味过高破坏苏格兰特征', '发酵不彻底，甜到发齁'],
      ex: ['Traquair House Ale', 'Belhaven Wee Heavy', 'Founders Dirty Bastard'] },

    { id: '17D', name: '英式大麦酒', en: 'English Barleywine', cat: '英式', group: 17,
      og: [1.080, 1.120], fg: [1.018, 1.030], abv: [8.0, 12.0], ibu: [35, 70], srm: [8, 22],
      overall: '英式最强的艾尔之一：浓郁麦芽、深色果干、高酒精度',
      key: ['麦芽主导（与美式大麦酒的酒花主导相反）', '需要数月到数年熟成', '酒精度高但酒精感应被麦芽包裹'],
      fault: ['发酵不彻底，甜腻', '酒精度高但风味不足'],
      ex: ['Thomas Hardy\'s Ale', 'Fuller\'s Golden Pride'] },

    /* ============ 18. 淡色美式艾尔 ============ */
    { id: '18A', name: '金发艾尔', en: 'Blonde Ale', cat: '美式', group: 18,
      og: [1.038, 1.054], fg: [1.008, 1.013], abv: [3.8, 5.5], ibu: [15, 28], srm: [3, 6],
      overall: '易饮的金色艾尔，麦芽轻甜、酒花柔和，是"精酿入门款"',
      key: ['风味温和，适合大众', '可有轻微果酯', '不能寡淡'],
      fault: ['过于保守，喝起来像淡拉格', '酒花过量失去易饮性'],
      ex: ['Kona Big Wave', 'Firestone 805'] },

    { id: '18B', name: '美式淡色艾尔（APA）', en: 'American Pale Ale', cat: '美式', group: 18,
      og: [1.045, 1.060], fg: [1.010, 1.015], abv: [4.5, 6.2], ibu: [30, 50], srm: [5, 10],
      overall: '**美式精酿的基石**：柑橘酒花 + 干净麦芽 + 平衡苦味',
      key: ['Cascade 是历史标志，现代可用 Citra/Mosaic', '酒花明显但不压倒麦芽', '收口干爽'],
      fault: ['酒花过量变 IPA', '麦芽过重变琥珀艾尔'],
      ex: ['Sierra Nevada Pale Ale', 'Deschutes Mirror Pond'] },

    /* ============ 19. 琥珀与棕色美式 ============ */
    { id: '19A', name: '美式琥珀艾尔', en: 'American Amber Ale', cat: '美式', group: 19,
      og: [1.045, 1.060], fg: [1.010, 1.015], abv: [4.4, 6.1], ibu: [25, 40], srm: [11, 17],
      overall: '琥珀色的美式艾尔：焦糖麦芽 + 美式酒花，比 APA 更甜更厚',
      key: ['结晶麦芽提供焦糖与色', '酒花仍明显', '酒体中等偏饱满'],
      fault: ['焦糖过量变甜腻', '与 APA 的区别只在颜色而无风味差异'],
      ex: ['Fat Tire', 'Anderson Valley Boont Amber'] },

    { id: '19B', name: '加州蒸汽啤酒', en: 'California Common', cat: '美式', group: 19,
      og: [1.048, 1.054], fg: [1.011, 1.014], abv: [4.5, 5.5], ibu: [30, 45], srm: [9, 14],
      overall: '用拉格酵母在较高温度（15-20°C）发酵的独特风格',
      key: ['"蒸汽啤酒"因开放式发酵桶冒蒸汽得名', '拉格酵母 + 温暖发酵 = 干净中带微果酯', 'Northern Brewer 是传统酒花'],
      fault: ['温度过高产生明显酯香', '用艾尔酵母就失去风格核心'],
      ex: ['Anchor Steam Beer'] },

    { id: '19C', name: '美式棕艾尔', en: 'American Brown Ale', cat: '美式', group: 19,
      og: [1.045, 1.060], fg: [1.010, 1.016], abv: [4.3, 6.2], ibu: [20, 30], srm: [18, 35],
      overall: '棕色、坚果巧克力、酒花明显的浓味美式艾尔',
      key: ['比英式棕艾更重口、酒花更多', '巧克力与焦糖', '酒体饱满'],
      fault: ['烘烤过量变波特', '酒花不足显得沉闷'],
      ex: ['Bell\'s Best Brown', 'Brooklyn Brown Ale'] },

    /* ============ 20. 美式波特与世涛 ============ */
    { id: '20A', name: '美式波特', en: 'American Porter', cat: '美式', group: 20,
      og: [1.050, 1.070], fg: [1.012, 1.018], abv: [4.8, 6.5], ibu: [25, 50], srm: [22, 35],
      overall: '比英式波特更浓、更苦、酒花更明显的美式版本',
      key: ['烘烤麦芽 + 美式酒花', '酒体比英式厚', '可带明显酒花香气'],
      fault: ['烘烤过重变世涛', '酒花与烘烤冲突'],
      ex: ['Deschutes Black Butte Porter', 'Founders Porter'] },

    { id: '20B', name: '美式世涛', en: 'American Stout', cat: '美式', group: 20,
      og: [1.050, 1.075], fg: [1.010, 1.022], abv: [5.0, 7.0], ibu: [35, 75], srm: [30, 40],
      overall: '比英式世涛更苦、酒花更明显、酒体更厚',
      key: ['烘烤与酒花双强', '苦味高于英式世涛', '可带明显柑橘酒花'],
      fault: ['苦味与烘烤叠加过度，变"焦水"', '酒体过薄撑不起'],
      ex: ['Sierra Nevada Stout', 'Rogue Shakespeare Stout'] },

    { id: '20C', name: '帝国世涛', en: 'Imperial Stout', cat: '美式', group: 20,
      og: [1.075, 1.115], fg: [1.018, 1.030], abv: [8.0, 12.0], ibu: [50, 90], srm: [30, 40],
      overall: '**最强的啤酒风格之一**：极高的浓度、复杂的烘烤与干果、高酒精度',
      key: ['历史上为俄国宫廷酿造', '需要长时间熟成（数月到数年）', '可过桶、加香草/咖啡/巧克力'],
      fault: ['发酵不彻底，甜到发腻', '酒精感刺鼻（发酵温度过高或酵母不足）', '氧化后变酱油味'],
      ex: ['Russian River Pliny the Elder 不是此风格；参考 North Coast Old Rasputin', 'Samuel Smith Imperial Stout'] },

    /* ============ 21. IPA ============ */
    { id: '21A', name: '美式 IPA', en: 'American IPA', cat: 'IPA', group: 21,
      og: [1.056, 1.070], fg: [1.008, 1.014], abv: [5.5, 7.5], ibu: [40, 70], srm: [6, 14],
      overall: '**精酿的图腾**：强烈的柑橘/松针酒花 + 干净的麦芽骨架 + 干爽收口',
      key: ['酒花是主角，麦芽只做支撑', '收口必须干（FG 1.008-1.014）', '干投是香气的关键'],
      fault: ['麦芽过重压住酒花', '氧化后酒花变"纸板+猫尿"', '苦味与香气脱节（只有苦没有香）'],
      ex: ['Russian River Blind Pig', 'Bell\'s Two Hearted', 'Stone IPA'] },

    { id: '21B-Black', name: '黑 IPA', en: 'Black IPA / Cascadian Dark Ale', cat: 'IPA', group: 21,
      og: [1.050, 1.085], fg: [1.010, 1.018], abv: [5.5, 9.0], ibu: [50, 90], srm: [25, 40],
      overall: '看起来像世涛、喝起来像 IPA：深色但无烘烤苦味',
      key: ['必须用**去苦黑麦芽**（Carafa Special / Midnight Wheat）', '烘烤味只能有一点，不能压酒花', '酒花特征与美式 IPA 一致'],
      fault: ['用普通黑麦芽，出焦苦与酒花打架', '烘烤味过重变"酒花世涛"'],
      ex: ['Deschutes Hop in the Dark', 'Stone Sublimely Self-Righteous'] },

    { id: '21B-Rye', name: '黑麦 IPA', en: 'Rye IPA', cat: 'IPA', group: 21,
      og: [1.056, 1.075], fg: [1.010, 1.016], abv: [5.5, 8.0], ibu: [50, 75], srm: [6, 14],
      overall: '黑麦带来的辛辣与干爽，与酒花形成独特的"锐利"组合',
      key: ['黑麦 15-30%，带来胡椒般辛辣', '必须加稻壳防滤槽堵塞', '酒花偏松针/树脂'],
      fault: ['黑麦过多导致口感粗糙发涩', '不做蛋白质休止，滤糟'],
      ex: ['Bear Republic Hop Rod Rye', 'Founders Red\'s Rye IPA'] },

    /* 2021 把"浑浊 IPA"从 21B 特别 IPA 里单列成 21C（2015 没有这一条）。
       本库原先把它挂在自造 id '21B-NEIPA' 下，而它填的数字窗口本来就是
       官方 21C 的窗口（1.060-1.085 / 1.010-1.015 / 6-9% / 25-60 / 3-7），
       所以迁移只是归位编号，不动任何数值。altIds 保留旧 id，
       让早先按 '21B-NEIPA' 写的配方、品鉴关联与水质匹配表继续解析得到。 */
    { id: '21C', name: '新英格兰浑浊 IPA（Hazy IPA）', en: 'Hazy IPA', cat: 'IPA', group: 21,
      altIds: ['21B-NEIPA'],
      og: [1.060, 1.085], fg: [1.010, 1.015], abv: [6.0, 9.0], ibu: [25, 60], srm: [3, 7],
      overall: '**果汁般的浑浊 IPA**：大量干投、低苦味、柔滑酒体',
      key: ['高氯低硫的水（SO4:Cl < 1）', '大量回旋与干投，几乎不煮沸投花', '蛋白质浑浊是设计目标', '酵母选择很关键（London III / Verdant）'],
      fault: ['氧化后变"紫褐色"且风味崩塌', '苦味过高就变成浑浊版西海岸', '为了浑浊加面粉——那是作弊且会沉淀'],
      ex: ['Tree House Julius', 'Trillium Congress Street', 'Hill Farmstead Edward'] },

    /* ============ 22. 强美式艾尔 ============
     * 2021 编号：22A 双料 IPA / 22B 美式烈性艾尔 / 22C 美式大麦酒 / 22D 小麦酒。
     * 本库原来整体错位一格：双料 IPA 占了 21C，烈性/大麦酒/小麦酒各前移一号
     * （22A/22B/22C）。那个编排与 2015 和 2021 都不一致，这次按 2021 归位。 */
    { id: '22A', name: '双料 IPA', en: 'Double IPA', cat: '美式', group: 22,
      og: [1.065, 1.085], fg: [1.008, 1.018], abv: [7.5, 10.0], ibu: [60, 100], srm: [6, 14],
      overall: '**酒花与酒精的双重冲击**：极高 IBU、高酒精度，但必须保持可饮',
      key: ['麦芽要够厚以平衡酒精与苦味', '加糖（10-20%）提干，避免过甜', '大量干投', '酵母接种量要足'],
      fault: ['甜腻（残糖过高）', '酒精灼烧感', '氧化极快，家酿难以长期保存'],
      ex: ['Russian River Pliny the Elder', 'Dogfish Head 90 Minute IPA'] },

    { id: '22B', name: '美式烈性艾尔', en: 'American Strong Ale', cat: '美式', group: 22,
      og: [1.062, 1.090], fg: [1.014, 1.024], abv: [6.3, 10.0], ibu: [35, 70], srm: [7, 18],
      overall: '高酒精度的美式艾尔，麦芽与酒花都强，风格边界宽',
      key: ['介于双料 IPA 与大麦酒之间', '麦芽与酒花都要够', '酒精感需被包裹'],
      fault: ['风格定位模糊导致"什么都像一点"', '酒精刺鼻'],
      ex: ['Arrogant Bastard Ale', 'Lagunitas Undercover'] },

    { id: '22C', name: '美式大麦酒', en: 'American Barleywine', cat: '美式', group: 22,
      og: [1.080, 1.120], fg: [1.016, 1.030], abv: [8.0, 12.0], ibu: [50, 100], srm: [9, 18],
      overall: '美式的最强艾尔：**酒花主导**的大麦酒（与英式相反）',
      key: ['酒花强度高于英式大麦酒', '麦芽仍要够厚', '需要长期熟成'],
      fault: ['酒花与麦芽都过强，变成"苦甜混乱"', '发酵不足，糖浆感'],
      ex: ['Sierra Nevada Bigfoot', 'Anchor Old Foghorn'] },

    { id: '22D', name: '小麦酒', en: 'Wheatwine', cat: '美式', group: 22,
      og: [1.080, 1.120], fg: [1.016, 1.030], abv: [8.0, 12.0], ibu: [30, 60], srm: [6, 14],
      overall: '用小麦做大麦酒：柔和、圆润、带面包感的高浓度艾尔',
      key: ['小麦占比 ≥50%', '比大麦酒更柔和圆润', '酒花中等'],
      fault: ['小麦蛋白质导致浑浊且滤槽难', '酒体过厚失平衡'],
      ex: ['Rubicon Winter Wheatwine', 'The Bruery White Oak（边界）'] },

    /* ============ 23. 欧洲酸啤 ============ */
    { id: '23A', name: '柏林白啤', en: 'Berliner Weisse', cat: '酸啤', group: 23,
      og: [1.028, 1.032], fg: [1.003, 1.006], abv: [2.8, 3.8], ibu: [3, 8], srm: [2, 3],
      overall: '极低酒精度、清爽酸味、活跃碳酸的德国酸小麦',
      key: ['乳酸菌 + 酵母的混合发酵', '极低 IBU（酒花会抑制乳酸菌）', '传统加木莓/车叶草糖浆饮用'],
      fault: ['酒花过量抑制乳酸菌', '酸度过高变醋'],
      ex: ['Schneider Weisse Tap 4', 'Bayerischer Bahnhof Berliner Style Weisse'] },

    { id: '23B', name: '佛兰德斯红艾', en: 'Flanders Red Ale', cat: '酸啤', group: 23,
      og: [1.048, 1.057], fg: [1.002, 1.012], abv: [4.6, 6.5], ibu: [10, 25], srm: [10, 17],
      overall: '**比利时红酒般的酸啤**：酸、果香、橡木、复杂的微生物作用',
      key: ['混合发酵（酵母+乳酸菌+醋酸菌+布雷特）', '橡木桶长期陈酿', '常混合不同年份'],
      fault: ['醋酸过头变醋', '卫生失控（这是"受控的污染"）'],
      ex: ['Rodenbach Grand Cru', 'Duchesse de Bourgogne'] },

    { id: '23C', name: '老棕啤', en: 'Oud Bruin', cat: '酸啤', group: 23,
      og: [1.040, 1.074], fg: [1.008, 1.012], abv: [4.0, 8.0], ibu: [20, 25], srm: [17, 22],
      overall: '佛兰德斯棕色酸啤：比红艾更麦芽、更少醋酸',
      key: ['麦芽甜与酸度的平衡', '醋酸感弱于 Flanders Red', '干果与焦糖'],
      fault: ['酸度过高', '氧化过头'],
      ex: ['Liefmans Goudenband', 'Petrus Oud Bruin'] },

    { id: '23D', name: '兰比克', en: 'Lambic', cat: '酸啤', group: 23,
      og: [1.040, 1.054], fg: [1.001, 1.010], abv: [5.0, 6.5], ibu: [0, 10], srm: [3, 6],
      overall: '比利时自然发酵：空气中的野生菌，酸、霉香、复杂到难以描述',
      key: ['**自然发酵**（开放式冷却），不接种商业酵母', '陈年酒花（防腐但不苦）', '至少 1 年橡木桶陈酿'],
      fault: ['家酿几乎无法复制（环境菌群不同）', '卫生失控变腐败'],
      ex: ['Cantillon Gueuze', 'Drie Fonteinen Oude Geuze'] },

    { id: '23E', name: '贵兹', en: 'Gueuze', cat: '酸啤', group: 23,
      og: [1.040, 1.060], fg: [1.000, 1.006], abv: [5.0, 8.0], ibu: [0, 10], srm: [5, 6],
      overall: '年轻与陈年兰比克的混合，瓶中二次发酵，气泡细腻',
      key: ['1/2/3 年兰比克混合', '瓶中二次发酵产生复杂碳酸', '酸、霉、果、木的层次'],
      fault: ['单一比例混合，缺乏层次', '碳酸不足'],
      ex: ['Cantillon Gueuze 100% Lambic', 'Boon Oude Geuze'] },

    { id: '23G', name: '戈斯', en: 'Gose', cat: '酸啤', group: 23,
      og: [1.036, 1.056], fg: [1.006, 1.010], abv: [4.2, 4.8], ibu: [5, 12], srm: [3, 4],
      overall: '德国酸小麦：酸、咸、香菜籽，独特的三重刺激',
      key: ['**加盐**（传统用高矿化水）', '芫荽籽', '乳酸发酵'],
      fault: ['盐过量变盐水', '酸度不足'],
      ex: ['Ritterguts Gose', 'Anderson Valley The Kimmie'] },

    /* ============ 24. 比利时艾尔 ============ */
    { id: '24A', name: '比利时小麦白啤', en: 'Witbier', cat: '比利时', group: 24,
      og: [1.044, 1.052], fg: [1.008, 1.012], abv: [4.5, 5.5], ibu: [8, 20], srm: [2, 4],
      overall: '**橙皮与芫荽**的清爽小麦啤酒，浑浊、微酸、极易饮',
      key: ['未发芽小麦 30-50%', '橙皮 + 芫荽籽是定义性辅料', '低苦味、高碳酸'],
      fault: ['香料过量变"香水"', '过滤后失去浑浊特征'],
      ex: ['Hoegaarden', 'Blue Moon（美式变体）', 'Allagash White'] },

    { id: '24B', name: '比利时淡色艾尔', en: 'Belgian Pale Ale', cat: '比利时', group: 24,
      og: [1.048, 1.054], fg: [1.010, 1.014], abv: [4.8, 5.5], ibu: [20, 30], srm: [8, 14],
      overall: '比利时日常艾尔：麦芽、果酯、柔和酒花，比英式更"香料感"',
      key: ['比利时酵母的酚香', '比英式苦啤更干', '酒花偏欧陆'],
      fault: ['用英式酵母失去酚香', '酚香过重变药味'],
      ex: ['Palm Speciale', 'De Koninck'] },

    { id: '24C', name: '法国北省啤酒（Bière de Garde）', en: 'Bière de Garde', cat: '比利时', group: 24,
      og: [1.060, 1.080], fg: [1.008, 1.016], abv: [6.0, 8.5], ibu: [18, 28], srm: [6, 19],
      overall: '法国北部的"窖藏啤酒"：麦芽饱满、干爽、带 cellar 般的复杂',
      key: ['名字意为"保存的啤酒"，为冬季窖藏而酿', '常用拉格或艾尔酵母', '麦芽感强但收口干'],
      fault: ['氧化过度', '酒体过甜'],
      ex: ['Jenlain Ambrée', 'Castelain Ch\'ti'] },

    /* ============ 25. 比利时烈性艾尔 ============ */
    { id: '25A', name: '比利时金艾', en: 'Belgian Blond Ale', cat: '比利时', group: 25,
      og: [1.062, 1.075], fg: [1.008, 1.016], abv: [6.0, 7.5], ibu: [15, 30], srm: [4, 6],
      overall: '金色、干爽、果酯与蜂蜜般甜感，比利时的"日常烈性"',
      key: ['比三料轻、比淡艾重', '干爽收口', '酵母果酯（梨、香蕉）'],
      fault: ['过甜', '酚香过重'],
      ex: ['Leffe Blonde', 'Duvel 6.66（边界）'] },

    { id: '25B', name: '赛松', en: 'Saison', cat: '比利时', group: 25,
      og: [1.048, 1.065], fg: [1.002, 1.008], abv: [5.0, 7.0], ibu: [20, 35], srm: [5, 14],
      overall: '**农舍艾尔**：极干、胡椒辛香、高碳酸，夏季田间饮用的解渴酒',
      key: ['FG 必须很低（1.002-1.008）', '酵母产胡椒/辛香（不是香蕉）', '高碳酸', '可加香料/果皮'],
      fault: ['FG 没做下去，变甜', '用德式小麦酵母产香蕉味', '碳酸不足'],
      ex: ['Saison Dupont', 'Fantôme Saison'] },

    { id: '25C', name: '比利时金色烈性艾尔', en: 'Belgian Golden Strong Ale', cat: '比利时', group: 25,
      og: [1.070, 1.095], fg: [1.005, 1.016], abv: [7.5, 10.5], ibu: [22, 35], srm: [3, 6],
      overall: '**"魔鬼的酒"**：金色、极干、高酒精度却几乎无酒精感',
      key: ['加糖提干（15-20%）', '高温发酵获取果酯', '酒精感必须隐藏'],
      fault: ['酒精灼烧（发酵温度失控）', '残糖过高失去"干"的特征'],
      ex: ['Duvel', 'Delirium Tremens'] },

    /* ============ 26. 修道院艾尔 ============ */
    { id: '26A', name: '比利时单料艾尔', en: 'Belgian Single', cat: '比利时', group: 26,
      og: [1.044, 1.054], fg: [1.004, 1.010], abv: [4.8, 6.0], ibu: [25, 45], srm: [3, 5],
      overall: '修道院日常饮用的低度版：干爽、酒花明显、酵母酚香',
      key: ['修道院风格的"入门档"', '比三料更苦更干', '高碳酸'],
      fault: ['按三料思路做，太重', '酚香过强'],
      ex: ['Westmalle Extra', 'De Koningshoeven Isid\'or'] },

    { id: '26B', name: '比利时双料', en: 'Belgian Dubbel', cat: '比利时', group: 26,
      og: [1.062, 1.075], fg: [1.008, 1.018], abv: [6.0, 7.6], ibu: [15, 25], srm: [10, 17],
      overall: '棕色、深色果干、焦糖、酒体中等偏厚的修道院艾尔',
      key: ['深色糖浆（D-90/D-180）提供色与风味', '干果（葡萄干、李子）', '苦味低，靠发酵控制平衡'],
      fault: ['过甜（残糖高）', '用烘烤麦芽硬上色，出焦苦'],
      ex: ['Westmalle Dubbel', 'Chimay Rouge'] },

    { id: '26C', name: '比利时三料', en: 'Belgian Tripel', cat: '比利时', group: 26,
      og: [1.075, 1.085], fg: [1.008, 1.014], abv: [7.5, 9.5], ibu: [20, 40], srm: [4.5, 7],
      overall: '金色、高酒精、干爽、辛辣酚香，修道院风格的"力量型"',
      key: ['加糖提干', '酒精度高但易饮', '酚香（丁香、胡椒）'],
      fault: ['酒精感刺鼻', '过甜'],
      ex: ['Westmalle Tripel', 'Chimay Triple', 'La Trappe Tripel'] },

    { id: '26D', name: '比利时深色烈性艾尔', en: 'Belgian Dark Strong Ale', cat: '比利时', group: 26,
      og: [1.075, 1.110], fg: [1.010, 1.024], abv: [8.0, 12.0], ibu: [20, 35], srm: [15, 22],
      overall: '**修道院风格的最高档**：深色、复杂果香、高酒精、长时间熟成',
      key: ['四料（Quadrupel）常归此类', '深色糖浆 + 复杂果酯', '需要数月熟成'],
      fault: ['酒精灼烧', '过甜', '发酵不足'],
      ex: ['Westvleteren XII', 'Rochefort 10', 'St. Bernardus Abt 12'] },

    /* ============ 28. 美式野菌 ============
     * 官方 28A/29A/30A/33A 的"关键数据"写的是 varies by base style，
     * 没有给 OG/FG/ABV/IBU/SRM 窗口。这里的区间是本库自定窗口
     * （rangeSource: 'local'），不是 BJCP 值，界面与 docs 都会这么标。 */
    { id: '28A', name: '布雷特啤酒', en: 'Brett Beer', cat: '野菌', group: 28,
      rangeSource: 'local',
      og: [1.040, 1.070], fg: [1.000, 1.010], abv: [4.0, 8.0], ibu: [0, 30], srm: [3, 20],
      overall: '用布雷特酵母发酵：干爽、热带水果或马厩味，视菌株而定',
      key: ['**布雷特能发酵糊精**，FG 极低', '需要很长时间（数月）', '菌株决定风味方向'],
      fault: ['过早装瓶导致过碳酸（它还在慢慢吃糖）', '与普通酵母混用比例失控'],
      ex: ['Orval（含布雷特）', 'Russian River Sanctification'] },

    /* ============ 29/30 果啤与香料啤 ============ */
    { id: '29A', name: '果啤（基酒可变）', en: 'Fruit Beer', cat: '特色', group: 29,
      rangeSource: 'local',
      og: [1.030, 1.070], fg: [1.006, 1.018], abv: [3.0, 8.0], ibu: [5, 40], srm: [2, 20],
      overall: '在基酒上叠加水果风味，水果必须可辨识且自然',
      key: ['**水果要能喝出来，但不能像果汁**', '注意水果带来的额外糖分', '基酒风格要与水果匹配'],
      fault: ['水果味像"香精"', '水果过量为变果酒', '颜色与风味脱节'],
      ex: ['视基酒而定'] },

    { id: '30A', name: '香料/草本/蔬菜啤酒', en: 'Spice, Herb, or Vegetable Beer', cat: '特色', group: 30,
      rangeSource: 'local',
      og: [1.030, 1.070], fg: [1.006, 1.018], abv: [3.0, 8.0], ibu: [5, 40], srm: [2, 20],
      overall: '在基酒上叠加香料，香料要"可辨识但不主导"',
      key: ['**香料宁少勿多**', '要与基酒风格协调', '多种香料要有主次'],
      fault: ['香料过量变药水', '香料与酒花冲突', '喝不出基酒是什么'],
      ex: ['视基酒而定'] },

    /* ============ 33. 木桶陈酿 ============ */
    { id: '33A', name: '木桶陈酿啤酒', en: 'Wood-Aged Beer', cat: '特色', group: 33,
      rangeSource: 'local',
      og: [1.030, 1.100], fg: [1.006, 1.024], abv: [4.0, 12.0], ibu: [5, 70], srm: [2, 30],
      overall: '在木桶中陈酿，获得香草、香料、单宁与微氧化',
      key: ['木桶提供香草（内酯）、单宁、微氧', '**接触时间比木材种类更重要**', '基酒要够强以承受木味'],
      fault: ['木味压过基酒', '过度氧化', '桶中染菌（也可能是好事）'],
      ex: ['Firestone Walker Parabola', 'Goose Island Bourbon County Stout'] }
  ];

  /* 风格大类，用于 UI 分组 */
  BREW.DB.styleCats = [
    { id: '美式',     order: 1 },
    { id: '国际',     order: 2 },
    { id: '捷克',     order: 3 },
    { id: '德式',     order: 4 },
    { id: '德式小麦', order: 5 },
    { id: '英式',     order: 6 },
    { id: '英联邦',   order: 7 },
    { id: '苏格兰',   order: 8 },
    { id: '爱尔兰',   order: 9 },
    { id: '美式',     order: 10 },
    { id: 'IPA',      order: 11 },
    { id: '比利时',   order: 12 },
    { id: '酸啤',     order: 13 },
    { id: '野菌',     order: 14 },
    { id: '特色',     order: 15 }
  ];

  /** 按 id 取风格。altIds 是旧编号别名：BJCP 改编号后，早先存下的配方
   *  与关联表仍按旧 id 写，这里一并解析，避免它们变成"指向不存在风格"。 */
  BREW.DB.getStyle = function (id) {
    for (var i = 0; i < BREW.DB.styles.length; i++) {
      if (BREW.DB.styles[i].id === id) return BREW.DB.styles[i];
    }
    for (var j = 0; j < BREW.DB.styles.length; j++) {
      var alt = BREW.DB.styles[j].altIds;
      if (alt && alt.indexOf(id) >= 0) return BREW.DB.styles[j];
    }
    return null;
  };

})(typeof window !== 'undefined' ? window : globalThis);
