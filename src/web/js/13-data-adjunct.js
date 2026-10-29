/* ============================================================================
 * 风月酿研所 — 13 辅料数据库
 * ----------------------------------------------------------------------------
 * 辅料是"配方性格"的来源，但也是最容易毁酒的地方：
 *   - 香料类过量会变成药水味（肉桂、丁香尤甚）
 *   - 果类会带来额外可发酵糖，让 FG 比预期低、酒精度比预期高
 *   - 澄清剂用量过大反而会带走泡沫蛋白
 *
 * 用量单位：20L 批次的推荐区间。UI 会按实际 batchSize 等比缩放。
 * 投放阶段：boil 煮沸末 | whirlpool 回旋 | primary 主发酵 | secondary 二发
 *           | packaging 装瓶前 | mash 糖化
 *
 * 文案层（v1.4 追加）：
 *   craft = 酿造要点，只解释本条已有的 useMin / useMax / unit / stage / extraSugarPct。
 *   story = 来历，这一类几乎都是通用商品（芫荽籽、明胶、PVPP），只有酸化麦芽
 *           有可说的德国传统，所以只写 1 条，其余留空——空着比编好。
 *   catGuides = 品类导览，按用途合并成 5 篇（香料与果实 / 澄清剂与单宁 / 酸剂 /
 *               发酵助剂与酶 / 橡木与抗氧剂），keys 对应本表 cat 值。
 *
 * v1.7 追加的参数层（**全部选填**）：
 *   extractYield   可发酵浸出物 %  投多少会抬多少 OG；果泥、蜂蜜、糖蜜用它
 *   fermentability 可发酵性        high/med/low/none —— 变酒精，还是留成甜与口感
 *   allergen       过敏原（文字）  贴标与待客时必须能说出来（甲壳类 / 亚硫酸盐）
 * 香料、澄清剂不填这三项：它们不是浸出物，硬填 0 是假精确。目前只有糖蜜与
 * 果泥/蜂蜜类有数（5 条 extractYield），2 条写过敏原，其余留空。
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  BREW.DB = BREW.DB || {};

  /* cat: spice 香料 | fruit 水果 | clarifier 澄清剂 | acid 酸剂
   *      nutrient 营养盐 | oak 橡木 | enzyme 酶 | other 其他 */
  BREW.DB.adjuncts = [
    /* ================= 香料：比利时白啤与冬季特酿的核心 ================= */
    { id: 'a-coriander', name: '芫荽籽', en: 'Coriander Seed', cat: 'spice',
      useMin: 5, useMax: 15, unit: 'g', stage: 'whirlpool',
      flavor: '柑橘皮、胡椒、微微的柠檬草',
      note: '比利时白啤的灵魂。**必须轻压碎**释放精油，整粒投放效果减半。超过 20g/20L 会有肥皂味',
      craft: '5–15g/20L，回旋阶段投放；整粒轻压碎才出精油，接近上限 15g 时柑橘皮感会转成肥皂味。',
      conf: 'A' },

    { id: 'a-orangepeel', name: '苦橙皮', en: 'Bitter Orange Peel', cat: 'spice',
      useMin: 10, useMax: 30, unit: 'g', stage: 'whirlpool',
      flavor: '橙皮苦香、清新柑橘',
      note: '用干燥苦橙皮，不要用甜橙皮（太甜腻）。回旋阶段投放保留香气，煮沸超过 15 分钟香气会跑光',
      craft: '10–30g/20L 回旋投放；煮沸超过 15 分钟香气基本跑光，苦橙皮比甜橙皮更干爽。',
      conf: 'A' },

    { id: 'a-sweetorange', name: '甜橙皮', en: 'Sweet Orange Peel', cat: 'spice',
      useMin: 10, useMax: 25, unit: 'g', stage: 'whirlpool',
      flavor: '甜橙、柔和果香', note: '比苦橙皮甜，适合美式小麦与果啤', craft: '10–25g/20L、回旋阶段；甜橙皮甜感强，果啤与美式小麦里比苦橙皮更讨喜，别用糖渍橙皮。',
      conf: 'B' },

    { id: 'a-cinnamon', name: '肉桂（桂皮）', en: 'Cinnamon', cat: 'spice',
      useMin: 2, useMax: 8, unit: 'g', stage: 'boil',
      flavor: '甜辛香、木质暖感',
      note: '**极易过量**。2g/20L 已经是明显肉桂味，8g 会盖住一切。冬季特酿常用 3-5g',
      craft: '2–8g/20L：2g 已经明显，8g 会盖住一切；冬季特酿 3–5g，整根比粉末好控制。',
      conf: 'A' },

    { id: 'a-clove', name: '丁香', en: 'Clove', cat: 'spice',
      useMin: 0.5, useMax: 2, unit: 'g', stage: 'boil',
      flavor: '强烈丁香酚、药感',
      note: '**最危险的香料**。1g/20L 就足够，超过 3g 会让整批酒像漱口水。建议用整颗不用粉',
      craft: '0.5–2g/20L 就是全部余量：超过 3g 整批像漱口水；用整颗、装袋，煮沸 10 分钟内取出。',
      conf: 'A' },

    { id: 'a-star-anise', name: '八角', en: 'Star Anise', cat: 'spice',
      useMin: 1, useMax: 4, unit: 'g', stage: 'boil',
      flavor: '甘草、茴香、甜辛', note: '1-2 颗足够 20L，适合深色烈性艾尔', craft: '1–4g/20L，1–2 颗即可；甘草感强，深色烈性艾尔里超过 4g 会发苦，整颗投放更好控。',
      conf: 'B' },

    { id: 'a-ginger', name: '生姜', en: 'Ginger', cat: 'spice',
      useMin: 10, useMax: 40, unit: 'g', stage: 'boil',
      flavor: '辛辣、清新、微微的柠檬',
      note: '鲜姜切片，煮沸 10 分钟。干姜粉味道更冲且带土味，不推荐', craft: '10–40g/20L 鲜姜切片，煮沸 10 分钟；干姜粉味道更冲且带土味，不推荐。',
      conf: 'A' },

    { id: 'a-blackpepper', name: '黑胡椒粒', en: 'Black Peppercorn', cat: 'spice',
      useMin: 2, useMax: 8, unit: 'g', stage: 'whirlpool',
      flavor: '辛香、木质、微辣', note: '轻压碎，赛松与比利时风格常用；整粒投放更柔和', craft: '2–8g/20L 轻压碎回旋投放；整粒更柔，赛松与比利时风格 4–6g 最平衡。',
      conf: 'B' },

    { id: 'a-grainsparadise', name: '天堂椒', en: 'Grains of Paradise', cat: 'spice',
      useMin: 1, useMax: 4, unit: 'g', stage: 'whirlpool',
      flavor: '胡椒、豆蔻、柑橘、微微的姜',
      note: '比利时历史配方（如 Witbier 前身）的隐藏武器，比黑胡椒更复杂', craft: '1–4g/20L 回旋投放；胡椒豆蔻柑橘的复合感，超过 4g 会转成药感，轻压碎即可出味。',
      conf: 'B' },

    { id: 'a-cardamom', name: '小豆蔻', en: 'Cardamom', cat: 'spice',
      useMin: 1, useMax: 3, unit: 'g', stage: 'whirlpool',
      flavor: '花香、樟脑、柑橘', note: '极易过量，1g 就能明显感知', craft: '1–3g/20L 就够：1g 已明显感知，超过 3g 像中药；配橙皮是常见组合。',
      conf: 'B' },

    { id: 'a-vanilla', name: '香草荚', en: 'Vanilla Bean', cat: 'spice',
      useMin: 2, useMax: 6, unit: 'g', stage: 'secondary',
      flavor: '香草、奶油、甜香',
      note: '剖开刮籽，连荚一起泡在二发罐里 3-7 天。煮沸会损失大部分香气',
      craft: '2–6g/20L 剖开刮籽，二发浸泡 3–7 天；煮沸会损失大部分香气，泡过 7 天出涩。',
      conf: 'A' },

    { id: 'a-cocoa', name: '可可碎（低脂）', en: 'Cocoa Nibs', cat: 'spice',
      useMin: 30, useMax: 100, unit: 'g', stage: 'secondary',
      flavor: '黑巧克力、坚果、微苦',
      note: '含脂肪，过量会让泡沫消散（脂肪消泡）。30-50g/20L 是稳妥区间',
      craft: '30–100g/20L，30–50g 是稳妥区间；含脂肪会消泡，接近上限时泡沫明显变差。',
      conf: 'A' },

    { id: 'a-coffee', name: '咖啡豆（粗磨）', en: 'Coffee Beans (coarse)', cat: 'spice',
      useMin: 20, useMax: 80, unit: 'g', stage: 'secondary',
      flavor: '咖啡、巧克力、烘焙',
      note: '**冷萃液比整豆更好控制**：用 100g 豆冷萃出 200ml 浓缩液，装瓶前按口味加。整豆浸泡超过 3 天会出涩味',
      craft: '20–80g/20L 粗磨短泡或冷萃；整豆浸泡超过 3 天出涩，冷萃液在装瓶前按口味加更好控。',
      conf: 'A' },

    /* ================= 水果：注意额外糖分 ================= */
    { id: 'a-raspberry', name: '覆盆子（果泥）', en: 'Raspberry Puree', cat: 'fruit',
      useMin: 500, useMax: 1500, unit: 'g', stage: 'secondary',
      flavor: '鲜明酸香、红色果味',
      note: '**含可发酵糖约 5-7%**，会让酒精度上升 0.5-1.5%。果泥比整果出味快，但渣多需二次过滤',
      craft: '500–1500g/20L 果泥，含约 6% 可发酵糖：投料后 OG 与酒精都会上升，要按 extraSugarPct 计入预算。',
      conf: 'A', extraSugarPct: 6 },

    { id: 'a-cherry', name: '酸樱桃（果泥/整果）', en: 'Sour Cherry', cat: 'fruit',
      useMin: 1000, useMax: 3000, unit: 'g', stage: 'secondary',
      flavor: '酸、杏仁、深红果香',
      note: '比利时樱桃啤酒的标配。整果需去核（核有苦杏仁味）。典型用量 1-2kg/20L',
      craft: '1–3kg/20L，含约 8% 糖；整果必须去核（核带苦杏仁味），果泥出味快但渣多。',
      conf: 'A', extraSugarPct: 8 },

    { id: 'a-peach', name: '桃子（果泥）', en: 'Peach Puree', cat: 'fruit',
      useMin: 800, useMax: 2000, unit: 'g', stage: 'secondary',
      flavor: '甜桃、花香、柔和', note: '桃味在发酵中容易"跑掉"，建议留 20% 在装瓶前添加',
      craft: '800–2000g/20L，含约 7% 糖；桃香容易在发酵中跑掉，留 20% 装瓶前补。',
      conf: 'B', extraSugarPct: 7 },

    { id: 'a-mango', name: '芒果（果泥）', en: 'Mango Puree', cat: 'fruit',
      useMin: 800, useMax: 2000, unit: 'g', stage: 'secondary',
      flavor: '热带、甜、微树脂', note: '与 Citra/Mosaic 干投协同极好', craft: '800–2000g/20L，含约 12% 糖（果泥里最高一档）：OG 与酒精升幅明显，配 Citra 干投协同好。',
      conf: 'B', extraSugarPct: 12 },

    { id: 'a-passionfruit', name: '百香果（果肉）', en: 'Passionfruit', cat: 'fruit',
      useMin: 300, useMax: 1000, unit: 'g', stage: 'secondary',
      flavor: '强烈热带酸香、冲击力强', note: '**香气极强**，300g/20L 已足够主导风味，过量会盖住酒花',
      craft: '300–1000g/20L，含约 10% 糖；300g 已足够主导风味，加满上限会盖掉酒花。',
      conf: 'A', extraSugarPct: 10 },

    { id: 'a-lemon', name: '柠檬皮/汁', en: 'Lemon Peel / Juice', cat: 'fruit',
      useMin: 20, useMax: 60, unit: 'g', stage: 'whirlpool',
      flavor: '明亮酸香', note: '只取黄色表皮，白色海绵层会带来苦味。果汁降 pH 需注意',
      craft: '20–60g/20L 只取黄色表皮，白色海绵层带苦；果汁会降 pH，用量大时要复测成品酸感。',
      conf: 'B', extraSugarPct: 3 },

    { id: 'a-grapefruit', name: '葡萄柚皮', en: 'Grapefruit Peel', cat: 'fruit',
      useMin: 20, useMax: 50, unit: 'g', stage: 'whirlpool',
      flavor: '苦柑橘、清新', note: '与 Cascade/Chinook 的葡萄柚调性高度协同', craft: '20–50g/20L 表皮回旋；与 Cascade、Chinook 的葡萄柚调叠加，超过 50g 会出明显皮苦。',
      conf: 'B' },

    /* ================= 澄清剂与工艺助剂 ================= */
    { id: 'a-irishmoss', name: '爱尔兰苔（卡拉胶）', en: 'Irish Moss', cat: 'clarifier',
      useMin: 1, useMax: 2, unit: 'g', stage: 'boil',
      flavor: '无味', note: '煮沸最后 15 分钟加。促蛋白凝聚，冷却后形成明显"热凝固物"。过量无益',
      craft: '1–2g/20L，煮沸最后 15 分钟；促蛋白凝聚形成热凝固物，过量无益还会带走泡沫蛋白。',
      conf: 'A' },

    { id: 'a-whirlfloc', name: '澄清片（Whirlfloc）', en: 'Whirlfloc Tablet', cat: 'clarifier',
      useMin: 0.5, useMax: 1, unit: '片', stage: 'boil',
      flavor: '无味', note: '爱尔兰苔的精制版，效果更强。半片/20L 足够，煮沸最后 10-15 分钟',
      craft: '0.5–1 片/20L，煮沸最后 10–15 分钟；效果比爱尔兰苔强，过量会让泡沫变差。',
      conf: 'A' },

    { id: 'a-gelatin', name: '明胶', en: 'Gelatin', cat: 'clarifier',
      useMin: 1, useMax: 2, unit: 'g', stage: 'packaging',
      flavor: '无味',
      note: '**冷降后使用**：先用 100ml 冷水泡开，加热到 65°C 溶解（不要煮沸），倒入 4°C 的酒里静置 2-3 天。非素食',
      craft: '1–2g/20L：冷水泡开、加热到 65°C 溶解（不煮沸），倒入 4°C 的酒静置 2–3 天；非素食。',
      conf: 'A' },

    { id: 'a-isinglass', name: '鱼胶', en: 'Isinglass', cat: 'clarifier',
      useMin: 0.5, useMax: 1.5, unit: 'g', stage: 'packaging',
      flavor: '无味', note: '英式传统澄清剂，对酵母沉降特别有效。非素食', craft: '0.5–1.5g/20L，装瓶前加入；对酵母沉降特别有效，是英式桶啤传统的澄清手段。',
      conf: 'B' },

    { id: 'a-silica', name: '硅胶（Silica Sol）', en: 'Silica Gel', cat: 'clarifier',
      useMin: 1, useMax: 3, unit: 'g', stage: 'packaging',
      flavor: '无味', note: '吸附蛋白，与明胶配合效果更好（蛋白+单宁双管齐下）', craft: '1–3g/20L 吸附蛋白，与明胶配合（蛋白加单宁双管）比单用效果好；过量会让口感变薄。',
      conf: 'B' },

    { id: 'a-pvpp', name: 'PVPP（聚乙烯聚吡咯烷酮）', en: 'PVPP', cat: 'clarifier',
      useMin: 1, useMax: 4, unit: 'g', stage: 'packaging',
      flavor: '无味',
      note: '吸附多酚，专治"涩口"和深色酒的粗糙感。**但也会带走部分酒花香气**，IPA 慎用',
      craft: '1–4g/20L 吸附多酚，专治涩口；但它同时带走酒花香气，IPA 与干投重的酒慎用。',
      conf: 'B' },

    { id: 'a-tannin', name: '单宁（酿酒单宁）', en: 'Brewing Tannin', cat: 'clarifier',
      useMin: 0.5, useMax: 2, unit: 'g', stage: 'packaging',
      flavor: '干涩、结构感',
      note: '与蛋白结合沉降。**过量会明显涩口**，果啤和蜂蜜酒用它补"骨架"',
      craft: '0.5–2g/20L 与蛋白结合沉降；超过 2g 会明显涩口，果啤与蜂蜜酒用它补骨架。',
      conf: 'B' },

    /* ================= 酸剂：调 pH 用 ================= */
    { id: 'a-lactic', name: '乳酸 88%', en: 'Lactic Acid 88%', cat: 'acid',
      useMin: 1, useMax: 8, unit: 'ml', stage: 'mash',
      flavor: '柔和酸味',
      note: '糖化水调 pH 的首选。**1ml/20L 大约降 0.1 pH（取决于碱度）**，必须边加边测。过量会有酸奶味',
      craft: '1–8ml/20L 调糖化水 pH：1ml 大约降 0.1（取决于碱度），必须边加边测，过量出酸奶味。',
      conf: 'A' },

    { id: 'a-phosphoric', name: '磷酸 85%', en: 'Phosphoric Acid 85%', cat: 'acid',
      useMin: 0.5, useMax: 5, unit: 'ml', stage: 'mash',
      flavor: '几乎无味', note: '不引入乳酸风味，适合清爽型拉格。同样必须实测 pH', craft: '0.5–5ml/20L，不引入乳酸风味，适合清爽拉格；同样必须实测 pH，不能按公式盲加。',
      conf: 'A' },

    { id: 'a-citric', name: '柠檬酸', en: 'Citric Acid', cat: 'acid',
      useMin: 1, useMax: 5, unit: 'g', stage: 'packaging',
      flavor: '柑橘酸',
      note: '适合果啤调酸，但不适合作为糖化酸（会被酵母代谢）。少量即可',
      craft: '1–5g/20L 装瓶前调酸；不适合当糖化酸（会被酵母代谢），果啤里 2–3g 已明显。',
      conf: 'B' },

    { id: 'a-acidmalt', name: '酸化麦芽', en: 'Acidulated Malt', cat: 'acid',
      useMin: 50, useMax: 300, unit: 'g', stage: 'mash',
      flavor: '清爽乳酸',
      note: '**按麦芽表处理**：占麦芽总重 1-3% 可降糖化 pH 约 0.1-0.2。德国传统做法，法规允许',
      craft: '50–300g 按麦芽表处理：占总麦芽重 1–3% 可降糖化 pH 约 0.1–0.2，德国传统做法，法规允许。',
      story: '酸化麦芽（Sauermalz）是德国的传统做法：用乳酸菌把麦芽本身酸化后再干燥，因此仍算「麦芽」，在《纯净法》下也允许使用。1–3% 就能明显降低糖化 pH。',
      conf: 'A', maltLike: true, acidPerPct: 0.06 },

    /* ================= 酵母营养与酶 ================= */
    { id: 'a-nutrient', name: '酵母营养盐', en: 'Yeast Nutrient', cat: 'nutrient',
      useMin: 1, useMax: 2, unit: 'g', stage: 'boil',
      flavor: '无味',
      note: '**高浓度配方、蜂蜜酒、果啤必加**。提供游离氨基氮与微量元素，防止发酵停滞与硫味。煮沸最后 10 分钟',
      craft: '1–2g/20L，煮沸最后 10 分钟；高浓度、蜂蜜酒、果啤必加，缺它容易停滞与出硫。',
      conf: 'A' },

    { id: 'a-dap', name: '磷酸二铵（DAP）', en: 'Diammonium Phosphate', cat: 'nutrient',
      useMin: 0.5, useMax: 1.5, unit: 'g', stage: 'boil',
      flavor: '无味', note: '纯氮源，酵母后期不吃，**只在前 1/3 发酵加**', craft: '0.5–1.5g/20L，只在前 1/3 发酵加；后期加酵母已不吃，反而残留无机氮。',
      conf: 'A' },

    { id: 'a-pecenzyme', name: '果胶酶', en: 'Pectinase', cat: 'enzyme',
      useMin: 0.5, useMax: 2, unit: 'g', stage: 'secondary',
      flavor: '无味',
      note: '分解果胶，果啤必备，显著改善澄清。**发酵结束后加，温度 15-25°C 才有效**',
      craft: '0.5–2g/20L，发酵结束后加，15–25°C 才有效；温度低时酶活几乎为零，加了等于没加。',
      conf: 'A' },

    { id: 'a-glucoamylase', name: '葡萄糖淀粉酶', en: 'Glucoamylase', cat: 'enzyme',
      useMin: 1, useMax: 3, unit: 'ml', stage: 'primary',
      flavor: '无味',
      note: '**Brut IPA 的关键**：把不可发酵的糊精切成葡萄糖，FG 能低到 0.996。与酵母同时投入',
      craft: '1–3ml/20L 与酵母同时投入：把糊精切成葡萄糖，FG 能低到 0.996，Brut IPA 的关键。',
      conf: 'B' },

    /* ================= 橡木与其他 ================= */
    { id: 'a-oakchips', name: '橡木片（中度烘烤）', en: 'Oak Chips (Medium Toast)', cat: 'oak',
      useMin: 20, useMax: 60, unit: 'g', stage: 'secondary',
      flavor: '香草、椰子、木质、单宁',
      note: '**接触时间比用量更重要**：3-7 天风味最佳，超过 14 天会变"木屑水"。用前用酒液或热水泡 10 分钟去生木味',
      craft: '20–60g/20L，接触 3–7 天风味最佳；超过 14 天会变木屑水，用前热水泡 10 分钟去生木味。',
      conf: 'A' },

    { id: 'a-oakspiral', name: '橡木 spirals（重烘）', en: 'Oak Spirals (Heavy Toast)', cat: 'oak',
      useMin: 20, useMax: 50, unit: 'g', stage: 'secondary',
      flavor: '烟熏、香草、焦糖', note: '表面积小于木片，需更长时间（2-4 周），风味更细腻', craft: '20–50g/20L 需 2–4 周（表面积小于木片）；风味更细腻，但时间必须盯着。',
      conf: 'B' },

    { id: 'a-ascorbic', name: '抗坏血酸（维生素C）', en: 'Ascorbic Acid', cat: 'other',
      useMin: 0.5, useMax: 2, unit: 'g', stage: 'packaging',
      flavor: '无味',
      note: '抗氧化剂，装瓶前加可延缓氧化。**但它同时也是还原剂，过量会促进反式-2-壬烯醛生成（纸板味）**，宁少勿多',
      craft: '0.5–2g/20L 装瓶前抗氧化；过量会促进反式-2-壬烯醛生成（纸板味），宁少勿多。',
      conf: 'B' },

    { id: 'a-camden', name: '焦亚硫酸钾（Campden）', en: 'Campden Tablet', cat: 'other',
      useMin: 0.2, useMax: 0.5, unit: '片', stage: 'packaging',
      flavor: '无味',
      note: '**家酿啤酒一般不需要**：啤酒的酒精与酒花已有足够抗氧化力。仅在长时间桶陈或果啤时用。一片/20L 会产生约 30ppm SO2',
      craft: '0.2–0.5 片/20L：一片约产生 30ppm SO2，家酿啤酒一般不需要，只在长桶陈与果啤时用。',
      conf: 'B' },

    /* ==========================================================================
     * v1.7 追加：糖与糖浆 / 香料 / 水果 / 澄清 / 酶 五类各补几条
     * --------------------------------------------------------------------------
     * 选取标准同样是"家酿店买得到、配方里真的会写"，并且尽量覆盖国内能买到的
     * 风味（桂花、花椒、洛神花、柚子皮）。每条都写 src；用量是 20L 批次口径。
     *
     * 新增参数（全部选填）：
     *   extractYield  可发酵浸出物 %：投了它 OG 会涨多少，按"占重量百分比 × pg"折算
     *   fermentability 可发酵性 high/med/low/none：决定它变酒精、还是留在酒里当甜/口感
     *   allergen      过敏原（文字）：贴标与给客人解释时用（甲壳类、亚硫酸盐、乳糖…）
     * 香料与澄清剂这三项绝大多数留空——它们不是"浸出物"，硬填 0 是假精确。
     * ========================================================================*/

    /* ---------------- 糖与糖浆：会实实在在抬高 OG 的辅料 ---------------- */
    { id: 'a-honey', name: '蜂蜜', en: 'Honey', cat: 'other',
      useMin: 300, useMax: 1000, unit: 'g', stage: 'whirlpool',
      flavor: '花香与蜜甜，但发酵后只剩三成',
      note: '蜂蜜约 80% 是糖：**先把它算进 OG，再谈风味**。超过 10% 可发酵糖来源会让酒体变薄，蜂蜜酒式的香气却留不住',
      craft: '300–1000g/20L。可发酵性极高（约 95%），相当于"带香味的糖"；回旋或主发结束后加，煮沸会把最贵的花香吹走。',
      extractYield: 80, fermentability: 'high',
      conf: 'B', src: 'USDA 蜂蜜成分（糖约 80%、水约 17%）' },

    { id: 'a-maple', name: '枫糖浆', en: 'Maple Syrup', cat: 'other',
      useMin: 200, useMax: 800, unit: 'g', stage: 'whirlpool',
      flavor: '焦糖、木质、淡淡香草',
      note: '风味物质在发酵中损失很大：想留枫味，一半在回旋加、一半在装瓶前用灭菌糖浆补',
      craft: '200–800g/20L。固形物约 66%，以蔗糖为主，几乎全部可发酵；它比蜂蜜"耐发酵"，木质感能留一部分到成品。',
      extractYield: 66, fermentability: 'high',
      conf: 'B', src: '枫糖浆通行成分（固形物 66%、以蔗糖为主）' },

    { id: 'a-molasses', name: '糖蜜', en: 'Molasses', cat: 'other',
      useMin: 100, useMax: 400, unit: 'g', stage: 'boil',
      flavor: '焦糖、甘草、明显的矿物与微苦',
      note: '**含大量不可发酵物与灰分**：超过 8% 会出现"铁锈/甘草"后味，且发酵会变慢（缺可同化氮）',
      craft: '100–400g/20L。糖分只有 50–60%，其余是灰分与胶体，所以它同时"提酒精"和"加厚口感"；英式老艾尔与世涛的传统用法。',
      extractYield: 55, fermentability: 'med', allergen: '部分等级含亚硫酸盐',
      conf: 'B', src: '糖蜜通行成分表（总糖 50-60%、灰分 8-12%）' },

    /* ---------------- 香料：国内能买到、且在精酿里真的在用 ---------------- */
    { id: 'a-juniper', name: '杜松子', en: 'Juniper Berries', cat: 'spice',
      useMin: 5, useMax: 15, unit: 'g', stage: 'boil',
      flavor: '松木、树脂、微苦的清凉',
      note: '北欧 Gruit 与赛松的传统香料。**必须轻压碎**，整粒几乎不出味；超过 15g 会有"松节油"感',
      craft: '5–15g/20L，煮沸最后 10 分钟。松木与树脂调很强势，建议和芫荽、橙皮搭配，别单打。',
      conf: 'B', src: '北欧 Gruit 传统配方与家酿通行用量 5-15g/20L' },

    { id: 'a-elderflower', name: '接骨木花（干）', en: 'Elderflower', cat: 'spice',
      useMin: 10, useMax: 30, unit: 'g', stage: 'whirlpool',
      flavor: '麝香葡萄、荔枝、花粉般的甜香',
      note: '香气极轻，**只在回旋或干投**；煮沸 5 分钟就只剩草味。整花比碎末好过滤',
      craft: '10–30g/20L 回旋。它的麝香葡萄调是"白葡萄酒感"的来源，适合赛松与小麦啤；和柠檬皮同投会更亮。',
      conf: 'B', src: '英式接骨木花糖浆传统与家酿通行用量' },

    { id: 'a-hibiscus', name: '洛神花（干萼）', en: 'Hibiscus', cat: 'spice',
      useMin: 20, useMax: 60, unit: 'g', stage: 'whirlpool',
      flavor: '酸、莓果、玫瑰般的红色',
      note: '**会明显降 pH 并带来酸感**：超过 60g 的酸度足以让酒喝起来像果酸饮料，配方里的乳酸/磷酸要相应减量',
      craft: '20–60g/20L 回旋或二发。它是"红色 + 酸感"的双料辅料：颜色几乎全部来自它，酸度也会实际改变口感。',
      conf: 'B', src: '洛神花（木槿萼）在酸啤与果啤中的通行用量 20-60g/20L' },

    { id: 'a-osmanthus', name: '桂花（干）', en: 'Osmanthus', cat: 'spice',
      useMin: 5, useMax: 20, unit: 'g', stage: 'whirlpool',
      flavor: '杏子、蜂蜜、花香，甜而不腻',
      note: '国产香料里最"讨喜"的一支。**别用糖渍桂花**（带糖与防腐剂）；干桂花香气易挥发，回旋温度降到 80°C 再投',
      craft: '5–20g/20L 回旋。风味是杏与蜜，和小麦啤、淡色艾尔、赛松都合；超过 20g 会出现"香水味"。',
      conf: 'C', src: '国内精酿通行用量 5-20g/20L，缺公开定量研究——从 5g 起试' },

    { id: 'a-sichuan', name: '花椒', en: 'Sichuan Pepper', cat: 'spice',
      useMin: 2, useMax: 8, unit: 'g', stage: 'boil',
      flavor: '柠檬皮、麻感、木质辛香',
      note: '麻感来自羟基山椒素，**在酒里会与气泡叠加**：3g 已经有明显"电麻"，超过 8g 会让舌头失去对其他风味的感知',
      craft: '2–8g/20L，最后 5 分钟。它给的是"柠檬皮 + 麻"，适合赛松与小麦啤；麻感在低碳酸时更明显。',
      conf: 'C', src: '国内精酿通行用量 2-8g/20L，无权威定量研究' },

    /* ---------------- 水果：果泥为主，注意它有糖 ---------------- */
    { id: 'a-yuzu', name: '柚子皮（香柚）', en: 'Yuzu Peel', cat: 'fruit',
      useMin: 15, useMax: 40, unit: 'g', stage: 'whirlpool',
      flavor: '柚子、青柠、花香，皮比汁更香',
      note: '**只取黄色表皮，别带白色海绵层**（苦）。干皮比鲜皮稳定，鲜皮要先用高度酒浸 24 小时杀菌',
      craft: '15–40g/20L 回旋。香气在表皮精油里，煮久了会变"洗洁精"；和少量盐（0.5g/L）一起会更像日式柚子。',
      conf: 'B', src: '日式柚子皮在精酿中的通行用量 15-40g/20L' },

    { id: 'a-guava', name: '番石榴果泥', en: 'Guava Puree', cat: 'fruit',
      useMin: 500, useMax: 1500, unit: 'g', stage: 'secondary',
      flavor: '番石榴、草莓、热带果香，酸度低',
      note: '果泥含 8–12% 糖，**会二次发酵**：装瓶前必须确认比重稳定，否则过气或爆瓶。果胶多，建议配果胶酶',
      craft: '500–1500g/20L 二发。低酸高香，是"果味但不酸"的少数选择；果泥会带走一部分酒液，计划时按 5–8% 损耗算。',
      extractYield: 10, fermentability: 'high',
      conf: 'B', src: '果泥厂商（Oregon/Wilderness）通行糖度 8-12%、家酿用量 25-75g/L' },

    { id: 'a-pineapple', name: '菠萝（果肉/果泥）', en: 'Pineapple', cat: 'fruit',
      useMin: 500, useMax: 1500, unit: 'g', stage: 'secondary',
      flavor: '菠萝、酸、热带，发酵后有"罐头"感',
      note: '**含菠萝蛋白酶**，会分解泡沫蛋白：想要泡沫就别超过 50g/L，或先用 70°C 加热 10 分钟灭酶（会损失部分鲜香）',
      craft: '500–1500g/20L 二发。酸度与糖都高，发酵会把"鲜菠萝"变成"罐头菠萝"；想留鲜味就一半二发、一半装瓶前加灭菌汁。',
      extractYield: 12, fermentability: 'high',
      conf: 'B', src: '菠萝果肉糖度 10-14%、家酿用量 25-75g/L；蛋白酶对泡沫的影响见果啤工艺通识' },

    /* ---------------- 澄清与酶：工艺型辅料 ---------------- */
    { id: 'a-chitosan', name: '壳聚糖（甲壳素澄清剂）', en: 'Chitosan', cat: 'clarifier',
      useMin: 0.5, useMax: 2, unit: 'g', stage: 'packaging',
      flavor: '无味',
      note: '**正电荷澄清剂，必须与负电荷的硅溶胶配对**才有效（先硅后壳，间隔 1 小时）。甲壳类来源 = 过敏原，素食者不可用',
      craft: '0.5–2g/20L，装瓶前 2–3 天。它抓酵母与浑浊蛋白，单用效果差一半；过量会把泡沫蛋白一起带走。',
      allergen: '甲壳类（ shellfish）',
      conf: 'B', src: '壳聚糖-硅溶胶配对澄清的厂商推荐剂量（1-4 g/hL）' },

    { id: 'a-glucanase', name: 'β-葡聚糖酶', en: 'Beta-Glucanase', cat: 'enzyme',
      useMin: 1, useMax: 5, unit: 'g', stage: 'mash',
      flavor: '无味',
      note: '高比例燕麦/小麦/黑麦配方的"防堵保险"。**糖化投，55–60°C 活性最高**；超过 65°C 会迅速失活',
      craft: '1–5g/20L 糖化时投。把 β-葡聚糖切成短链，麦醪黏度下降、洗糟变快；它不改变可发酵糖，所以 OG 不受影响。',
      conf: 'B', src: 'β-葡聚糖酶制剂（Ultraflo / Brewzyme 类）厂商推荐剂量与 55-60°C 活性区间' },

    { id: 'a-oakcubes', name: '橡木块（中度烘烤）', en: 'Oak Cubes (Medium Toast)', cat: 'oak',
      useMin: 30, useMax: 80, unit: 'g', stage: 'secondary',
      flavor: '香草、椰子、淡烟熏、单宁',
      note: '块的萃取比片慢但更"干净"：**2–4 周**是常规窗口。用前蒸 10 分钟杀菌，别用开水久煮（会把香气煮掉）',
      craft: '30–80g/20L 二发 2–4 周。中度烘烤给香草与椰子；它同时带来单宁与微氧，陈放久了会转成"木头味"。',
      conf: 'B', src: '橡木制品厂商（Fermax/Oak Solutions）推荐的 1.5-4 g/L 与 2-4 周窗口' }
  ];

  BREW.DB.adjunctCats = {
    spice:     { zh: '香料', desc: '极少量即可主导风味，过量会毁酒', color: '#a68658' },
    fruit:     { zh: '水果', desc: '注意额外可发酵糖会改变 FG 与酒精度', color: '#a1697c' },
    clarifier: { zh: '澄清剂', desc: '改善外观与口感，不影响风味', color: '#738fa1' },
    acid:      { zh: '酸剂', desc: '调糖化与成品 pH，必须实测', color: '#869d73' },
    nutrient:  { zh: '营养盐', desc: '防止发酵停滞，高浓度配方必备', color: '#8f8f73' },
    enzyme:    { zh: '酶制剂', desc: '改变糖谱，影响酒体与终比重', color: '#867ca1' },
    oak:       { zh: '橡木', desc: '接触时间比用量更关键', color: '#86735f' },
    other:     { zh: '其他', desc: '抗氧化与特殊工艺助剂', color: '#7c7c7c' }
  };

  /* ==========================================================================
   * 品类导览（第一层文案）——按用途合并成五组
   * --------------------------------------------------------------------------
   * 八个小 cat 合并成五篇：香料与果实都是"强香少量"，澄清剂与单宁都靠吸附，
   * 营养盐与酶都是"保证发酵走完"，橡木与抗氧剂都靠时间和剂量。分太细每篇就只剩一句。
   * ========================================================================*/
  BREW.DB.catGuides = BREW.DB.catGuides || {};
  BREW.DB.catGuides.adjunct = [
    {
      key: 'seasoning', zh: '香料与果实', keys: ['spice', 'fruit'],
      lead: '极少量就能主导风味，也最容易毁酒。',
      what: '香料（芫荽、橙皮、肉桂、丁香）与果实（果泥、果皮、果汁）逻辑相同：香气物质浓度高，投料以克计，而基酒是公斤级——20L 里 1g 丁香所有人都尝得出。',
      role: '香料给风格身份（比利时白啤的芫荽橙皮、冬季特酿的肉桂），果实给颜色、酸度与果香，同时带来额外可发酵糖。',
      dose: '香料 0.5–30g/20L，丁香 1g 已能主导；果实 300g–3kg/20L，果泥含糖 6–12%，会改变 OG 与酒精。',
      mistakes: [
        '香料加倍以求明显：肉桂、丁香、豆蔻都是线性过头，多一倍就是药水味。',
        '果实不折算糖：果泥里的糖会被酵母吃掉，FG 与酒精都会偏离预测。',
        '香料煮沸太久：几乎所有香气都怕久煮，最后 5 分钟或回旋才是它们的舞台。'
      ]
    },
    {
      key: 'clarifier', zh: '澄清剂与单宁', keys: ['clarifier'],
      lead: '只管外观与口感，不参与风味设计。',
      what: '爱尔兰苔、澄清片、明胶、鱼胶、硅胶、PVPP 与单宁：前几种靠电荷中和或蛋白凝聚把悬浮物拉下来，单宁则与蛋白结合沉降，同时给酒"骨架"，只改外观与口感，不改发酵。',
      role: '缩短澄清时间、改善外观与口感。硅胶吸蛋白、PVPP 吸多酚，两者配对能同时处理浑浊与涩口；单宁在果啤与蜂蜜酒里补结构，让薄酒显得有骨架。',
      dose: '爱尔兰苔 1–2g、澄清片半片到 1 片、明胶 1–2g、PVPP 1–4g，全部按 20L 计，明胶与鱼胶在装瓶前用、需低温才有效。',
      mistakes: [
        '过量使用：澄清剂会连泡沫蛋白一起带走，泡沫变得又薄又短。',
        'PVPP 用在 IPA 上：它吸多酚不分好坏，酒花香气会一起被削掉。',
        '明胶直接撒进热麦汁：必须先冷水泡开、65°C 溶解，再倒进 4°C 的酒里。'
      ]
    },
    {
      key: 'acid', zh: '酸剂', keys: ['acid'],
      lead: '调 pH 的工具，必须边加边测。',
      what: '乳酸、磷酸、柠檬酸与酸化麦芽。前三者是外加酸，酸化麦芽是"用麦芽自己带的乳酸"——它仍算麦芽，所以在德国《纯净法》下也允许使用。四者的目标都是 pH，不是"酸味"。',
      role: '把糖化醪拉到 5.2–5.4（浅色酒）或 5.4–5.6（深色酒），改善酶活性、酒花苦感与澄清度；pH 合适时同一份酒花会显得更干净。',
      dose: '乳酸 1–8ml/20L，1ml 大约降 0.1pH（取决于水的碱度）；酸化麦芽按麦芽总重 1–3% 降 0.1–0.2。',
      mistakes: [
        '按公式盲加不看水质：碱度不同，同样 1ml 乳酸的效果可以差三倍。',
        '用柠檬酸调糖化：它会被酵母代谢，pH 在发酵过程中会漂回去。',
        '乳酸过量：超过 5ml/20L 会出明显酸奶味，清爽型拉格尤其藏不住。'
      ]
    },
    {
      key: 'process', zh: '发酵助剂与酶', keys: ['nutrient', 'enzyme'],
      lead: '不改变风味方向，只保证发酵能走完。',
      what: '酵母营养盐、DAP、果胶酶、葡萄糖淀粉酶。前两者补氮与微量元素，后两者切多糖：果胶酶切果胶（改善澄清），葡萄糖淀粉酶切糊精。它们作用于"过程"，不直接给味道。',
      role: '营养盐防停滞与硫味，高浓度、蜂蜜酒、果啤必加；酶制剂改变糖谱，直接改变 FG 与酒体——Brut IPA 的 0.996 就是淀粉酶的功劳。',
      dose: '营养盐 1–2g/20L；DAP 0.5–1.5g，只在前 1/3 发酵加；果胶酶 0.5–2g，发酵结束后 15–25°C 使用；葡萄糖淀粉酶 1–3ml，与酵母同时投。',
      mistakes: [
        'DAP 在发酵后期加：酵母已经不吃无机氮，残留反而招杂菌。',
        '果胶酶在低温下用：15–25°C 才有活性，冷降后加等于没加。',
        '用淀粉酶却不调整预期：FG 会掉到 1.000 以下，酒体变薄、杀口感变强。'
      ]
    },
    {
      key: 'wood', zh: '橡木与抗氧剂', keys: ['oak', 'other'],
      lead: '接触时间与剂量都要盯着，过量比不加更糟。',
      what: '橡木片、橡木 spirals 提供香草、椰子、烟熏与单宁；抗坏血酸与焦亚硫酸钾是抗氧化剂，一个还原、一个释放 SO2。前者是"加法"，后者是"刹车"，都容易过量。',
      role: '橡木给"桶陈"的错觉，适合世涛、大麦酒、比利时深色；抗氧剂用于长时间桶陈或果啤，常规酒本身有酒精与酒花的抗氧化力，不需要它们。',
      dose: '橡木片 20–60g/20L 接触 3–7 天；spirals 20–50g 需 2–4 周；抗坏血酸 0.5–2g，Campden 0.2–0.5 片（一片约 30ppm SO2）。',
      mistakes: [
        '橡木泡两周以上：单宁析出过多，酒会变成"木屑水"。',
        '抗坏血酸当保险多放：过量会促进反式-2-壬烯醛生成，反而出纸板味。',
        '常规啤酒也加 Campden：SO2 会掩盖酒花香气，还可能让瓶内二次发酵发不起来。'
      ]
    }
  ];

})(typeof window !== 'undefined' ? window : globalThis);
