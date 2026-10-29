/* ============================================================================
 * 风月酿研所 — 12 酵母数据库
 * ----------------------------------------------------------------------------
 * 关键概念：
 *   att     表观衰减度（Apparent Attenuation）。**决定 FG，从而决定酒精度和酒体。**
 *           定义：ADF = (OG − FG) / (OG − 1) × 100%
 *           注意"表观"二字：酒精的存在让比重偏低，所以表观衰减度会比真实
 *           衰减度高出 3–5 个百分点。配方预测用表观值就够。
 *   temp    发酵温度区间。低于下限酵母休眠（可能停滞），高于上限产高级醇
 *           （上头、溶剂味）。这是最容易翻车的地方，比原料用量更敏感。
 *   floc    絮凝性。低絮凝 = 酒体浑浊、需要更长时间沉降；高絮凝 = 酒清得快，
 *           但可能"提前沉降"导致发酵不彻底。
 *
 * 接种量说明（计算依据）：
 *   艾尔 0.75 M cells/mL/°P，拉格 1.5 M cells/mL/°P。
 *   20L、12°P 的艾尔 = 0.75 × 12 × 20000 = 1800 亿个细胞。
 *   一包 11g 干酵母约 1000–1500 亿活细胞（按 10 亿/克 估算），所以 20L 常规
 *   艾尔用 1–1.2 包即可；拉格要翻倍；高浓度要 2 包以上或做扩培。
 *
 * 文案层（v1.4 追加）：
 *   craft = 酿造要点，只解释本条已有的 att / tempMin / tempMax / floc / abvTol 意味着什么。
 *   story = 来历，只给 6 株有明确记载的菌株（Chico 系、魏恩施蒂凡系、Dupont 系、
 *           WLP644 的重新分类），其余留空——通用菌株没有单独的来历可讲。
 *   catGuides = 品类导览，按"上面发酵 / 小麦与比利时酚香 / 下面发酵 / 野菌与酸啤"
 *               四组写，keys 对应本表的 type 值（一个分组可覆盖多个 type）。
 *
 * v1.7 追加的参数层（**全部选填**）：
 *   phenolic    POF+ / POF−   是否产 4-乙烯基愈创木酚（丁香酚）。POF+ 的菌别和
 *                             干净拉格共用发酵罐/塑料桶，酚味几乎洗不掉。
 *   ester       酯香风格（文字）决定这株做"干净"还是"果香"，选菌时的第一直觉。
 *   pitchRate   建议接种率 M cells/mL/°P，与 BREW.DB.pitchRates 的类型默认值一致。
 *   rehydration 是否需活化：干酵母写厂商是否允许直接撒；液体酵母不适用，留空。
 * 填写范围：13 株新菌全填；老菌里只给 POF 状态可确证的 5 株（US-05 / S-04 /
 * WB-06 / 3068 / WLP300）补 phenolic，其余 41 株留空——厂商没公开声明就不猜。
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  BREW.DB = BREW.DB || {};

  /* type: ale 艾尔 | lager 拉格 | wheat 小麦 | belgian 比利时 | sour 酸啤 | brett 布雷特
   * form: dry 干粉 | liquid 液体
   * floc: low | med | high | veryhigh */
  BREW.DB.yeasts = [
    /* ================= 干粉酵母：新手最省事，无需扩培 ================= */
    { id: 'y-us05', name: 'US-05 加州艾尔', en: 'SafAle US-05', lab: 'Fermentis', type: 'ale', form: 'dry',
      att: 79.5, attMin: 77, attMax: 82, tempMin: 15, tempMax: 24, abvTol: 11, floc: 'med',
      code: 'US-05', primDays: [4, 7], secDays: [7, 14],
      notes: '主发 4–7 天走完（18–20°C），后熟 1–2 周只为了沉降与双乙酰还原；它衰减快，多放不会更干。',
      flavor: '极干净中性，微微的桃子酯香，几乎不掩盖酒花',
      styles: ['美式IPA', '淡色艾尔', '世涛', '几乎所有美式风格'],
      craft: '18–20°C 发酵最中性，超过 22°C 明显出桃酯；att 79.5 意味着 12°P 麦汁的 FG 约在 1.010 附近，想更干就掺糖或提高比例。',
      story: 'Fermentis 的干粉艾尔酵母。家酿圈普遍认为它与 WLP001、Wyeast 1056 同属 Chico 系，源头指向美国加州的艾尔酒厂；干净、耐操、几乎不盖酒花，是很多人的第一包酵母。',
      conf: 'A', src: 'Fermentis 官方技术数据表 77-82%',
      /* v1.7：只给 POF 状态可以确证的几株经典菌填 phenolic。
         没填的不是"不知道它中性"，而是厂商没有公开声明——留空比猜好。 */
      phenolic: 'POF−',
      note: '家酿第一包酵母。18°C 发酵最中性，超过 22°C 会明显出酯' },

    { id: 'y-s04', name: 'S-04 英式艾尔', en: 'SafAle S-04', lab: 'Fermentis', type: 'ale', form: 'dry',
      att: 76, attMin: 74, attMax: 78, tempMin: 15, tempMax: 20, abvTol: 10, floc: 'high',
      code: 'S-04', primDays: [3, 5], secDays: [7, 10],
      notes: '絮凝极快，主发 3–5 天就沉底；后熟超过两周容易酵母自溶出肉汤味，所以二发反而短。',
      flavor: '英式果酯（梨、苹果）、收口干脆',
      styles: ['英式苦啤', '波特', '世涛', '英式IPA'],
      craft: '15–20°C 是舒适区，低于 15°C 容易停滞；att 76 加上高絮凝，FG 偏高，别指望它做出干爽的酒。',
      conf: 'A', src: 'Fermentis 官方 74-78%', phenolic: 'POF−',
      note: '絮凝快、酒清快；但发酵可能"提早收工"，装瓶前务必确认两天比重不变' },

    { id: 'y-wb06', name: 'WB-06 小麦', en: 'SafAle WB-06', lab: 'Fermentis', type: 'wheat', form: 'dry',
      att: 88, attMin: 86, attMax: 90, tempMin: 18, tempMax: 24, abvTol: 9, floc: 'low',
      code: 'WB-06', primDays: [4, 7], secDays: [10, 14],
      notes: '小麦啤要留浑浊，后熟只做 10–14 天低温沉降；再久酚香会散，酒也会变"薄"。',
      flavor: '香蕉、丁香、面包，典型德式小麦',
      styles: ['德式小麦白啤', ' Dunkelweizen', '柏林白啤（需另接乳酸菌）'],
      craft: '18°C 偏丁香、22°C 偏香蕉——温度就是风味旋钮；att 88 收口干，但低温发酵会同时带来明显硫味。',
      conf: 'A', src: 'Fermentis 官方 86-90%', phenolic: 'POF+',
      note: '低温（17-18°C）偏丁香，高温（22-24°C）偏香蕉，温度就是风味旋钮' },

    { id: 'y-be134', name: 'BE-134 赛松', en: 'SafAle BE-134', lab: 'Fermentis', type: 'belgian', form: 'dry',
      att: 91, attMin: 89, attMax: 93, tempMin: 18, tempMax: 28, abvTol: 12, floc: 'low',
      code: 'BE-134', primDays: [5, 10], secDays: [14, 21],
      notes: '衰减 89–93% 意味着它要把糖吃到见底，主发后段还得 2–3 周才能收到 1.004，急不得。',
      flavor: '胡椒、柠檬、干爽收口，酚香明显',
      styles: ['赛松', '比利时金艾', '农舍艾尔'],
      craft: 'att 91 会把 FG 压到 1.004 以下：想要酒体就把糖化温度提到 66–68°C；18–28°C 都能工作，前期可放任升温。',
      conf: 'A', src: 'Fermentis 官方 89-93%',
      note: '酵母标称衰减度极高，FG 会低到 1.004 以下；想让酒体厚一点就提高糖化温度' },

    { id: 'y-k97', name: 'K-97 德式艾尔', en: 'SafAle K-97', lab: 'Fermentis', type: 'ale', form: 'dry',
      att: 82, attMin: 80, attMax: 84, tempMin: 15, tempMax: 20, abvTol: 10, floc: 'low',
      code: 'K-97', primDays: [4, 7], secDays: [10, 14],
      notes: '科隆式低温熟成是风格要求：主发 4–7 天后降到 8–10°C 放 10–14 天，果酯才会收敛成"干净"。',
      flavor: '干净、微辛、比 US-05 更有骨架',
      styles: ['科隆', '德式艾尔', '金色艾尔'],
      craft: '15–20°C 给干净的微辛骨架，att 82 比 US-05 更干；低絮凝意味着要靠冷降或澄清剂才清。',
      conf: 'A', src: 'Fermentis 官方 80-84%' },

    { id: 'y-t58', name: 'T-58 比利时', en: 'SafAle T-58', lab: 'Fermentis', type: 'belgian', form: 'dry',
      att: 72.5, attMin: 70, attMax: 75, tempMin: 15, tempMax: 24, abvTol: 11, floc: 'med',
      code: 'T-58', primDays: [4, 7], secDays: [14, 21],
      notes: '比利时酚香需要时间整合，二发 2–3 周让胡椒与丁香从"冲"变"圆"。',
      flavor: '胡椒、丁香、微香蕉的比利时酚香',
      styles: ['比利时小麦白啤', '比利时金艾', '双料'],
      craft: 'att 72.5 残糖偏高：适合 6–8% 的比利时风格，做淡色酒会显甜腻；18–22°C 酚香最平衡。',
      conf: 'A', src: 'Fermentis 官方 70-75%',
      note: '酵母标称衰减度偏低，FG 较高，甜感明显；适合 6-8% 的比利时风格' },

    { id: 'y-s33', name: 'S-33 通用', en: 'SafAle S-33', lab: 'Fermentis', type: 'ale', form: 'dry',
      att: 72.5, attMin: 70, attMax: 75, tempMin: 15, tempMax: 24, abvTol: 10, floc: 'med',
      code: 'S-33', primDays: [4, 7], secDays: [10, 14],
      notes: '通用型菌株，主发一周内结束；后熟两周足够，它本来就没有多少酯需要发展。',
      flavor: '较中性，略带果酯，酒体偏厚',
      styles: ['英式艾尔', '棕艾尔', '通用'],
      craft: 'att 72.5、酒体偏厚：英式与棕艾尔的稳妥选择，超过 22°C 会有明显果酯。',
      conf: 'B', src: 'Fermentis 官方 70-75%' },

    { id: 'y-w3470', name: 'W-34/70 拉格', en: 'SafLager W-34/70', lab: 'Fermentis', type: 'lager', form: 'dry',
      att: 82, attMin: 80, attMax: 84, tempMin: 9, tempMax: 15, abvTol: 11, floc: 'high',
      code: 'W-34/70', primDays: [7, 12], secDays: [21, 42],
      notes: '拉格低温发酵慢：9–12°C 主发 7–12 天，再 21–42 天后熟（越接近 0°C 越久），硫与双乙酰靠这段时间消失。',
      flavor: '干净、微甜麦芽、极低酯香',
      styles: ['德式皮尔森', '慕尼黑拉格', '博克', '几乎所有拉格'],
      craft: '9–15°C 是拉格区间，12°C 最稳；18°C 也能做「假拉格」，发酵更快但会出微酯——这是用温度换时间。',
      story: '编号源自德国弗赖辛魏恩施蒂凡酵母研究所的 34/70 菌株，是世界上最广泛使用的拉格酵母之一。它宽容、干净，几乎所有拉格风格都可以从它起步。',
      conf: 'A', src: 'Fermentis 官方 80-84%',
      note: '最宽容的拉格酵母。12°C 是稳妥点；18°C 也能做"假拉格"（发酵更快但有微酯）' },

    { id: 'y-s23', name: 'S-23 拉格', en: 'SafLager S-23', lab: 'Fermentis', type: 'lager', form: 'dry',
      att: 82, attMin: 80, attMax: 84, tempMin: 9, tempMax: 15, abvTol: 11, floc: 'high',
      code: 'S-23', primDays: [8, 12], secDays: [21, 35],
      notes: '比 34/70 多一点果香，也稍慢；后熟 3–5 周是拉格化（lagering）的下限。',
      flavor: '比 34/70 多一点果香，适合英式拉格',
      styles: ['国际拉格', '英式拉格'],
      craft: '与 34/70 同级但多一点果香，适合英式拉格；9–15°C，低于 9°C 发酵时间会明显拉长。',
      conf: 'A', src: 'Fermentis 官方 80-84%' },

    { id: 'y-s189', name: 'S-189 拉格', en: 'SafLager S-189', lab: 'Fermentis', type: 'lager', form: 'dry',
      att: 84, attMin: 82, attMax: 86, tempMin: 9, tempMax: 14, abvTol: 11, floc: 'high',
      code: 'S-189', primDays: [8, 12], secDays: [21, 42],
      notes: '极干型拉格菌，收口要彻底，后熟给满 3–6 周才不会留硫味。',
      flavor: '极干净、干爽，适合干型拉格',
      styles: ['捷克皮尔森', '干型拉格'],
      craft: 'att 84 收口极干，是捷克皮尔森与干型拉格的取向；温度上限只到 14°C，温控不稳容易出双乙酰。',
      conf: 'A', src: 'Fermentis 官方 82-86%' },

    { id: 'y-nottingham', name: '诺丁汉', en: 'Nottingham', lab: 'Lallemand', type: 'ale', form: 'dry',
      att: 79.5, attMin: 77, attMax: 82, tempMin: 14, tempMax: 21, abvTol: 12, floc: 'high',
      code: '', primDays: [3, 5], secDays: [7, 10],
      notes: '发酵极快、絮凝极好：主发 3–5 天，后熟一周就清；再放下去只会氧化。',
      flavor: '非常干净、干爽，几乎无酯',
      styles: ['英式艾尔', '美式艾尔', '世涛'],
      craft: '14–16°C 也能工作，是没有温控的夏天的保险；att 79.5 加高絮凝，酒清得快、口感干爽。',
      conf: 'A', src: 'Lallemand 官方 77-82%',
      note: '低温（14-16°C）也能工作，适合没有温控的夏天；絮凝极好，酒很清' },

    { id: 'y-windsor', name: '温莎', en: 'Windsor', lab: 'Lallemand', type: 'ale', form: 'dry',
      att: 75, attMin: 73, attMax: 77, tempMin: 15, tempMax: 22, abvTol: 9, floc: 'low',
      code: '', primDays: [4, 7], secDays: [7, 10],
      notes: '低絮凝，主发后酒液仍浑；后熟 1–2 周配合冷降才清，但别指望它自己沉降。',
      flavor: '明显的英式果酯，酒体饱满偏甜',
      styles: ['英式苦啤', '淡色艾尔', '棕艾尔'],
      craft: 'att 75 且低絮凝：酒体饱满偏甜、酒液浑浊，需要冷降或澄清剂；不适合做清爽型。',
      conf: 'A', src: 'Lallemand 官方 73-77%',
      note: '低絮凝，酒浑浊，需要冷降或澄清剂；不适合做清爽型' },

    { id: 'y-bry97', name: 'BRY-97 美式西海岸', en: 'BRY-97 West Coast Ale', lab: 'Lallemand', type: 'ale', form: 'dry',
      att: 78.5, attMin: 77, attMax: 80, tempMin: 15, tempMax: 22, abvTol: 12, floc: 'high',
      code: 'BRY-97', primDays: [4, 7], secDays: [7, 14],
      notes: '沉降比 US-05 快，后熟 1–2 周即可装瓶；IPA 想保香气就别拖太久。',
      flavor: '干净、酒花表现力强，与 US-05 类似但沉降更快',
      styles: ['西海岸IPA', '淡色艾尔'],
      craft: '与 US-05 相近的干净度，但沉降更快：15–22°C，想缩短澄清时间时选它。',
      conf: 'A', src: 'Lallemand 官方 77-80%' },

    { id: 'y-munich', name: '慕尼黑小麦', en: 'Munich Classic Wheat', lab: 'Lallemand', type: 'wheat', form: 'dry',
      att: 78.5, attMin: 77, attMax: 80, tempMin: 17, tempMax: 22, abvTol: 9, floc: 'low',
      code: '', primDays: [4, 7], secDays: [10, 14],
      notes: '小麦菌要保留浑浊与酚香，后熟只做 10–14 天低温；过滤或久置会把风格特征做没。',
      flavor: '香蕉与丁香的平衡，比 WB-06 更柔和',
      styles: ['德式小麦', ' Dunkelweizen'],
      craft: '17–22°C 给香蕉与丁香的平衡，att 78.5 比 WB-06 收口更圆；低絮凝，浑浊是设计目标。',
      conf: 'A', src: 'Lallemand 官方 77-80%' },

    { id: 'y-bellesaison', name: '美丽赛松', en: 'Belle Saison', lab: 'Lallemand', type: 'belgian', form: 'dry',
      att: 89, attMin: 86, attMax: 92, tempMin: 18, tempMax: 30, abvTol: 14, floc: 'low',
      code: '', primDays: [5, 10], secDays: [14, 28],
      notes: '赛松后段要靠升温把 FG 拉到 1.008 以下，二发 2–4 周是"吃完残糖"的必要时间。',
      flavor: '胡椒、柠檬、干爽、微酸',
      styles: ['赛松', '农舍艾尔', '比利时金艾'],
      craft: '耐高温到 30°C：前期放任升温获取复杂度，att 89 收口干脆；低于 18°C 反而会停顿。',
      conf: 'A', src: 'Lallemand 官方 86-92%',
      note: '耐高温，30°C 也不怕；发酵前期可以放任升温以获取复杂度' },

    { id: 'y-abbaye', name: '修道院', en: 'Abbaye', lab: 'Lallemand', type: 'belgian', form: 'dry',
      att: 81, attMin: 78, attMax: 84, tempMin: 18, tempMax: 25, abvTol: 12, floc: 'med',
      code: '', primDays: [5, 10], secDays: [21, 35],
      notes: '修道院高浓度风格需要 3–5 周二发：酒精整合与碳酸化都在这一步完成。',
      flavor: '丰富的果酯与酚香（李子、丁香、蜂蜜）',
      styles: ['比利时双料', '三料', '四料'],
      craft: '18–22°C 起步、收尾升到 24–25°C 才能把 att 81 走完；中途降温会留下明显残糖。',
      conf: 'A', src: 'Lallemand 官方 78-84%' },

    { id: 'y-verdant', name: '翠绿 IPA', en: 'Verdant IPA', lab: 'Lallemand', type: 'ale', form: 'dry',
      att: 80, attMin: 78, attMax: 82, tempMin: 18, tempMax: 23, abvTol: 12, floc: 'med',
      code: '', primDays: [4, 7], secDays: [7, 12],
      notes: '浑浊 IPA 的后熟要短：一周左右就降温干投、尽快装瓶，久放浑浊会失稳、香气会跑。',
      flavor: '热带水果酯香突出，专为浑浊 IPA 设计',
      styles: ['NEIPA', '浑浊淡艾'],
      craft: '18–23°C、att 80：专为浑浊 IPA 设计，会生物转化酒花萜烯；浑浊是目标，不必刻意澄清。',
      conf: 'A', src: 'Lallemand 官方 78-82%',
      note: '它会"生物转化"酒花萜烯，干投后香气更爆；但酒体浑浊是设计目标不是缺陷' },

    { id: 'y-diamond', name: '钻石拉格', en: 'Diamond Lager', lab: 'Lallemand', type: 'lager', form: 'dry',
      att: 82, attMin: 80, attMax: 84, tempMin: 10, tempMax: 16, abvTol: 12, floc: 'high',
      code: '', primDays: [8, 12], secDays: [21, 35],
      notes: '拉格菌，10–16°C 主发 8–12 天；后熟 3–5 周把硫压下去，麦芽感才会显出来。',
      flavor: '干净、麦芽感略强于 34/70',
      styles: ['德式拉格', '博克'],
      craft: '10–16°C、att 82：比 34/70 多一点麦芽感，适合德式拉格与博克；高絮凝，酒清得快。',
      conf: 'A', src: 'Lallemand 官方 80-84%' },

    { id: 'y-phillysour', name: '费城酸', en: 'Philly Sour', lab: 'Lallemand', type: 'sour', form: 'dry',
      att: 78.5, attMin: 75, attMax: 82, tempMin: 20, tempMax: 25, abvTol: 9, floc: 'high',
      code: '', primDays: [7, 10], secDays: [10, 14],
      notes: '产乳酸与酒精同步进行：主发 7–10 天 pH 到 3.4 就该降温终止酸化，二发只做 10–14 天。',
      flavor: '产乳酸的酵母：干净酸度 + 桃子/杏的酯香',
      styles: ['酸小麦', '柏林白啤', '果酸艾尔'],
      craft: '20–25°C 一发即成酸：一株同时产乳酸与酒精，att 78.5；酸度靠温度与时间控制，pH 到 3.4 左右就该降温。',
      conf: 'A', src: 'Lallemand 官方 75-82%',
      note: '**一株酵母同时完成糖化发酵与酸化**，不需要单独接乳酸菌，避免设备污染' },

    /* ================= 液体酵母：White Labs ================= */
    { id: 'y-wlp001', name: 'WLP001 加州艾尔', en: 'WLP001 California Ale', lab: 'White Labs', type: 'ale', form: 'liquid',
      att: 76.5, attMin: 73, attMax: 80, tempMin: 20, tempMax: 22, abvTol: 12, floc: 'med',
      code: 'WLP001', primDays: [4, 7], secDays: [7, 14],
      notes: 'Chico 系标准节奏：18–20°C 主发 4–7 天，后熟 1–2 周；IPA 尽量缩短后熟以保香气。',
      flavor: '干净中性，酒花友好', styles: ['美式IPA', '淡色艾尔'],
      craft: '官方温度只给 20–22°C，温控要稳；att 76.5，做 IPA 想更干就掺 5–10% 糖。',
      conf: 'A', src: 'White Labs 官方 73-80%' },

    { id: 'y-wlp002', name: 'WLP002 英式艾尔', en: 'WLP002 English Ale', lab: 'White Labs', type: 'ale', form: 'liquid',
      att: 66.5, attMin: 63, attMax: 70, tempMin: 18, tempMax: 20, abvTol: 9, floc: 'veryhigh',
      code: 'WLP002', primDays: [3, 5], secDays: [7, 10],
      notes: '絮凝极高、衰减极低：主发 3–5 天就结块沉底，后熟一周；放久了酵母味会出来。',
      flavor: '明显果酯、酒体厚、残糖多', styles: ['英式苦啤', '温和艾尔', '波特'],
      craft: 'att 66.5 是全库最低：残糖多、酒体厚，做英式苦啤与波特合适，做 IPA 会甜得压住酒花；絮凝极高，会结成块状沉降。',
      conf: 'A', src: 'White Labs 官方 63-70%',
      note: '絮凝性极高，会结成布丁状酵母块；衰减低，别指望做出干爽的酒' },

    { id: 'y-wlp004', name: 'WLP004 爱尔兰艾尔', en: 'WLP004 Irish Ale', lab: 'White Labs', type: 'ale', form: 'liquid',
      att: 71.5, attMin: 69, attMax: 74, tempMin: 18, tempMax: 20, abvTol: 10, floc: 'high',
      code: 'WLP004', primDays: [4, 7], secDays: [10, 14],
      notes: '爱尔兰世涛/红艾的干净果酯：主发一周，后熟 10–14 天，酒清得快但别过度冷降。',
      flavor: '干净的英式果酯，收口略干', styles: ['爱尔兰世涛', '爱尔兰红艾'],
      craft: '18–20°C、att 71.5：爱尔兰世涛的干净果酯，收口略干，与深色麦芽的苦很搭。',
      conf: 'A', src: 'White Labs 官方 69-74%' },

    { id: 'y-wlp007', name: 'WLP007 干英式艾尔', en: 'WLP007 Dry English Ale', lab: 'White Labs', type: 'ale', form: 'liquid',
      att: 75, attMin: 70, attMax: 80, tempMin: 18, tempMax: 20, abvTol: 12, floc: 'high',
      code: 'WLP007', primDays: [3, 6], secDays: [7, 14],
      notes: '比 WLP002 干、发酵力强：主发 3–6 天，后熟 1–2 周；英式 IPA 要收干就靠它。',
      flavor: '比 WLP002 更干、更中性，发酵力强', styles: ['英式IPA', '美式艾尔'],
      craft: '比 WLP002 干、比它中性：att 75、絮凝高，英式 IPA 想收干又不想丢果酯时用它。',
      conf: 'A', src: 'White Labs 官方 70-80%' },

    { id: 'y-wlp029', name: 'WLP029 德式科隆', en: 'WLP029 German/Kolsch Ale', lab: 'White Labs', type: 'ale', form: 'liquid',
      att: 75, attMin: 72, attMax: 78, tempMin: 16, tempMax: 20, abvTol: 9, floc: 'med',
      code: 'WLP029', primDays: [4, 7], secDays: [14, 21],
      notes: '科隆菌要低温熟成：主发一周后 8–10°C 放 2–3 周，果酯收敛、收口变干脆。',
      flavor: '极干净、微果香、收口干爽', styles: ['科隆', '金色艾尔'],
      craft: '16–20°C 极干净、微果香，科隆风格的取向；超过 20°C 果酯会上来，盖掉它本来的清爽。',
      conf: 'A', src: 'White Labs 官方 72-78%' },

    { id: 'y-wlp090', name: 'WLP090 圣地亚哥超级', en: 'WLP090 San Diego Super', lab: 'White Labs', type: 'ale', form: 'liquid',
      att: 79.5, attMin: 76, attMax: 83, tempMin: 18, tempMax: 20, abvTol: 12, floc: 'high',
      code: 'WLP090', primDays: [3, 6], secDays: [7, 12],
      notes: '发酵比 US-05 快约三成：主发 3–6 天，后熟一周；高浓度酒也能在两周内收干。',
      flavor: '干净、发酵快、沉降快', styles: ['双料IPA', '美式艾尔'],
      craft: '发酵比 US-05 快约三成，但超过 21°C 会出明显溶剂味；att 79.5、高絮凝，双料 IPA 的省时选择。',
      conf: 'A', src: 'White Labs 官方 76-83%',
      note: '发酵速度比 US-05 快约 30%，但超过 21°C 会产生明显的溶剂味' },

    { id: 'y-wlp099', name: 'WLP099 超高浓度', en: 'WLP099 Super High Gravity', lab: 'White Labs', type: 'ale', form: 'liquid',
      att: 89, attMin: 78, attMax: 100, tempMin: 18, tempMax: 22, abvTol: 25, floc: 'med',
      code: 'WLP099', primDays: [7, 14], secDays: [30, 60],
      notes: '超高浓度专用：主发就要 1–2 周，二发 1–2 个月让 15% 以上的酒精融合，急不得。',
      flavor: '中性，能啃完别人啃不动的糖', styles: ['大麦酒', '帝国世涛'],
      craft: 'att 89、耐酒精 25%：需要分阶段充氧与多代扩培，普通家酿一包直投很容易中途停滞。',
      conf: 'A', src: 'White Labs 官方 78-100%',
      note: '酒精耐受 25%，但需要分阶段充氧与多代扩培；普通家酿慎碰' },

    { id: 'y-wlp300', name: 'WLP300 小麦', en: 'WLP300 Hefeweizen Ale', lab: 'White Labs', type: 'wheat', form: 'liquid',
      att: 74, attMin: 72, attMax: 76, tempMin: 20, tempMax: 22, abvTol: 9, floc: 'low',
      code: 'WLP300', primDays: [4, 7], secDays: [10, 14],
      notes: '德式小麦标杆：主发 4–7 天保留浑浊，后熟 10–14 天；久放香蕉会散成"香蕉水"。',
      flavor: '典型香蕉+丁香，德式小麦的标杆', styles: ['德式小麦', ' Dunkelweizen'],
      craft: '20–22°C 给典型香蕉加丁香，att 74 保留饱满酒体；低于 18°C 丁香转强、香蕉消失。',
      conf: 'A', src: 'White Labs 官方 72-76%', phenolic: 'POF+' },

    { id: 'y-wlp400', name: 'WLP400 比利时白啤', en: 'WLP400 Belgian Wit Ale', lab: 'White Labs', type: 'belgian', form: 'liquid',
      att: 76, attMin: 74, attMax: 78, tempMin: 19, tempMax: 23, abvTol: 10, floc: 'low',
      code: 'WLP400', primDays: [4, 7], secDays: [10, 14],
      notes: '比利时白啤：主发一周，后熟 10–14 天低温；橙皮与芫荽的香气在这段时间稳定。',
      flavor: '橙皮、芫荽、柔和的酚香', styles: ['比利时小麦白啤'],
      craft: '19–23°C、att 76：橙皮与芫荽的酚香和比利时白啤的香料是协同关系；低絮凝，浑浊正常。',
      conf: 'A', src: 'White Labs 官方 74-78%' },

    { id: 'y-wlp500', name: 'WLP500 修道院', en: 'WLP500 Trappist Ale', lab: 'White Labs', type: 'belgian', form: 'liquid',
      att: 77.5, attMin: 75, attMax: 80, tempMin: 18, tempMax: 22, abvTol: 12, floc: 'med',
      code: 'WLP500', primDays: [5, 10], secDays: [21, 35],
      notes: '修道院菌：主发 5–10 天、末段升温，二发 3–5 周让樱桃与李子的酯香整合。',
      flavor: '樱桃、李子、丁香，修道院风格的复杂度', styles: ['双料', '三料', '四料'],
      craft: '18–22°C 起步、收尾升到 24°C 才能走完 att 77.5；李子樱桃的果酯来自偏高的发酵温度。',
      conf: 'A', src: 'White Labs 官方 75-80%' },

    { id: 'y-wlp530', name: 'WLP530 修道院艾尔', en: 'WLP530 Abbey Ale', lab: 'White Labs', type: 'belgian', form: 'liquid',
      att: 76, attMin: 74, attMax: 78, tempMin: 19, tempMax: 22, abvTol: 14, floc: 'med',
      code: 'WLP530', primDays: [5, 10], secDays: [21, 35],
      notes: '耐 14% 酒精：高浓度风格主发 1–2 周，二发 3–5 周；收尾升温到 24°C 才不留残糖。',
      flavor: '更干、更辛香，酒精耐受更高', styles: ['比利时金艾', '三料', '四料'],
      craft: '耐酒精 14%、比 WLP500 更干更辛：高浓度比利时风格收尾时升到 24°C，能避免残糖发腻。',
      conf: 'A', src: 'White Labs 官方 74-78%' },

    { id: 'y-wlp565', name: 'WLP565 比利时赛松', en: 'WLP565 Belgian Saison I', lab: 'White Labs', type: 'belgian', form: 'liquid',
      att: 72, attMin: 69, attMax: 75, tempMin: 20, tempMax: 24, abvTol: 12, floc: 'med',
      code: 'WLP565', primDays: [5, 10], secDays: [21, 35],
      notes: '著名的"停滞"品种：主发到 1.030 会停，升温轻摇后再拖 3–5 周才能收干。',
      flavor: '胡椒、辛香、饱满的酚香', styles: ['赛松'],
      craft: '著名的停滞品种：到 1.030 会停，需升温到 24°C 并轻摇才继续；att 72 要靠耐心而不是降温走完。',
      story: 'White Labs 的 565 通常被认为源自比利时的 Dupont 酒厂——赛松风格的标杆。它风味复杂，也以「发到一半停住」闻名，是耐心与温控的试金石。',
      conf: 'A', src: 'White Labs 官方 69-75%',
      note: '著名的"发酵停滞"品种：到 1.030 会停，升温到 24°C 并轻摇才继续' },

    { id: 'y-wlp800', name: 'WLP800 皮尔森拉格', en: 'WLP800 Pilsner Lager', lab: 'White Labs', type: 'lager', form: 'liquid',
      att: 72.5, attMin: 69, attMax: 76, tempMin: 10, tempMax: 13, abvTol: 10, floc: 'high',
      code: 'WLP800', primDays: [8, 12], secDays: [28, 42],
      notes: '捷克皮尔森菌：10–13°C 主发 8–12 天，后熟 4–6 周；短了会留硫与双乙酰。',
      flavor: '干净的捷克风格，麦芽与酒花平衡', styles: ['波西米亚皮尔森'],
      craft: '10–13°C、att 72.5：捷克皮尔森的麦芽与酒花平衡靠它，温度高于 14°C 会失去干净度。',
      conf: 'A', src: 'White Labs 官方 69-76%' },

    { id: 'y-wlp833', name: 'WLP833 德式博克拉格', en: 'WLP833 German Bock Lager', lab: 'White Labs', type: 'lager', form: 'liquid',
      att: 73, attMin: 70, attMax: 76, tempMin: 9, tempMax: 13, abvTol: 12, floc: 'high',
      code: 'WLP833', primDays: [8, 12], secDays: [28, 42],
      notes: '博克/三月节要保留麦芽甜，后熟 4–6 周让酒体圆润；它不像皮尔森菌那样追求"干"。',
      flavor: '麦芽感突出、干净的拉格', styles: ['博克', '三月节', '慕尼黑拉格'],
      craft: '9–13°C、att 73 保留麦芽甜：博克与三月节要的就是这份不干的收口，做皮尔森会显厚。',
      conf: 'A', src: 'White Labs 官方 70-76%' },

    { id: 'y-wlp840', name: 'WLP840 美式拉格', en: 'WLP840 American Lager', lab: 'White Labs', type: 'lager', form: 'liquid',
      att: 77.5, attMin: 75, attMax: 80, tempMin: 10, tempMax: 13, abvTol: 10, floc: 'high',
      code: 'WLP840', primDays: [7, 12], secDays: [21, 35],
      notes: '美式拉格菌：主发 7–12 天，后熟 3–5 周；它几乎不产风味，所以要的是"干净"而不是"久"。',
      flavor: '极干净、几乎无味，纯粹的载体', styles: ['美式拉格', '淡爽拉格'],
      craft: '极干净、几乎无性格：att 77.5 收口干，美式拉格要的就是没有酵母味，10–13°C。',
      conf: 'A', src: 'White Labs 官方 75-80%' },

    { id: 'y-wlp644', name: 'WLP644 布雷特三号', en: 'WLP644 Brettanomyces bruxellensis Trois', lab: 'White Labs', type: 'brett', form: 'liquid',
      att: 85, attMin: 80, attMax: 90, tempMin: 20, tempMax: 25, abvTol: 12, floc: 'low',
      code: 'WLP644', primDays: [14, 28], secDays: [30, 90],
      notes: '布雷特发酵极慢：主发就要 2–4 周，二发 1–3 个月；比重还在降就装瓶会过气甚至爆瓶。',
      flavor: '菠萝、芒果、热带水果，**没有典型布雷特的马厩味**',
      styles: ['布雷特IPA', '野菌艾尔'],
      craft: 'att 85、20–25°C：没有马厩味的热带果香，适合干净的布雷特 IPA；低絮凝，需要时间沉降。',
      story: 'White Labs 在 2014 年把它从布雷特（Brettanomyces bruxellensis）重新归类为酿酒酵母（Saccharomyces cerevisiae）。它不产马厩味，因此成了「干净的野菌」；库里仍按布雷特归类，是因为用法与野菌一致。',
      conf: 'A', src: 'White Labs 官方 80-90%',
      note: '这株不产 4-EP，所以不会有"马毯/马厩"味，可以放心做干净的热带风格' },

    /* ================= 液体酵母：Wyeast ================= */
    { id: 'y-1056', name: '1056 美式艾尔', en: 'Wyeast 1056 American Ale', lab: 'Wyeast', type: 'ale', form: 'liquid',
      att: 75, attMin: 73, attMax: 77, tempMin: 18, tempMax: 22, abvTol: 11, floc: 'med',
      code: '1056', primDays: [4, 7], secDays: [7, 14],
      notes: 'Chico 系液体版：主发 4–7 天，后熟 1–2 周；与 US-05 / WLP001 同一节奏。',
      flavor: '干净中性', styles: ['美式IPA', '淡色艾尔'],
      craft: '18–22°C、att 75：美式艾尔的标准答案，干净到能当对照组；温度超过 23°C 就会出酯。',
      story: 'Wyeast 的 1056 是 Chico 系液体酵母的代表，与 WLP001、US-05 风味表现高度一致。三者在美式 IPA 里常被互相替换，也因此成了「美式艾尔酵母」口味的基准线。',
      conf: 'A', src: 'Wyeast 官方 73-77%' },

    { id: 'y-1084', name: '1084 爱尔兰艾尔', en: 'Wyeast 1084 Irish Ale', lab: 'Wyeast', type: 'ale', form: 'liquid',
      att: 73, attMin: 71, attMax: 75, tempMin: 16, tempMax: 22, abvTol: 10, floc: 'med',
      code: '1084', primDays: [4, 7], secDays: [10, 14],
      notes: '爱尔兰艾尔：主发一周，后熟 10–14 天；深色酒多放两周让烘烤感变柔。',
      flavor: '柔和的果酯，适合深色酒', styles: ['爱尔兰世涛', '波特'],
      craft: '16–22°C、att 73：柔和果酯配深色麦芽，爱尔兰世涛与波特的稳妥选择，沉降中等，酒清得慢一些。',
      conf: 'A', src: 'Wyeast 官方 71-75%' },

    { id: 'y-1098', name: '1098 英式艾尔', en: 'Wyeast 1098 British Ale', lab: 'Wyeast', type: 'ale', form: 'liquid',
      att: 74, attMin: 73, attMax: 75, tempMin: 17, tempMax: 22, abvTol: 10, floc: 'high',
      code: '1098', primDays: [3, 6], secDays: [7, 14],
      notes: '高絮凝英式菌：主发 3–6 天，后熟 1–2 周；酒清得快，装瓶前记得确认比重稳定。',
      flavor: '干净、收口干爽的英式', styles: ['英式苦啤', '英式IPA'],
      craft: 'att 74、高絮凝：英式苦啤收口干爽又清得快，17–22°C 是它的舒适区，装瓶前澄清很快。',
      conf: 'A', src: 'Wyeast 官方 73-75%' },

    { id: 'y-1318', name: '1318 伦敦艾尔三号', en: 'Wyeast 1318 London Ale III', lab: 'Wyeast', type: 'ale', form: 'liquid',
      att: 73, attMin: 71, attMax: 75, tempMin: 17, tempMax: 22, abvTol: 10, floc: 'high',
      code: '1318', primDays: [4, 7], secDays: [7, 14],
      notes: '浑浊 IPA 经典选择：主发 4–7 天，后熟只 1–2 周且不冷降，悬浮酵母是风格的一部分。',
      flavor: '柔和的果酯、饱满酒体、轻微甜感',
      styles: ['NEIPA', '英式艾尔', '浑浊IPA'],
      craft: '17–22°C、att 73：果酯加悬浮酵母让浑浊 IPA 更柔；高絮凝但酒体仍然浑，这是风格要求。',
      conf: 'A', src: 'Wyeast 官方 71-75%',
      note: '**浑浊 IPA 的经典选择**：果酯与酒花协同，且悬浮酵母让酒体更柔' },

    { id: 'y-3068', name: '3068 魏恩施蒂凡小麦', en: 'Wyeast 3068 Weihenstephan Weizen', lab: 'Wyeast', type: 'wheat', form: 'liquid',
      att: 75, attMin: 73, attMax: 77, tempMin: 18, tempMax: 22, abvTol: 9, floc: 'low',
      code: '3068', primDays: [4, 7], secDays: [10, 14],
      notes: '德式小麦最经典菌株：主发 4–7 天，后熟 10–14 天；低温久放会让丁香压过香蕉。',
      flavor: '香蕉、丁香（4-乙烯基愈创木酚）', styles: ['德式小麦白啤'],
      craft: '17°C 偏丁香、22°C 偏香蕉：4-乙烯基愈创木酚的产量由温度决定，att 75 保留小麦啤的饱满。',
      story: '编号里的 3068 指向德国弗赖辛的魏恩施蒂凡酵母研究所，这株是德式小麦白啤最经典的菌株。香蕉与丁香的配比，几乎成了小麦啤的教科书。',
      conf: 'A', src: 'Wyeast 官方 73-77%', phenolic: 'POF+',
      note: '17°C 偏丁香、22°C 偏香蕉；这是德式小麦最经典的菌株' },

    { id: 'y-3711', name: '3711 法国赛松', en: 'Wyeast 3711 French Saison', lab: 'Wyeast', type: 'belgian', form: 'liquid',
      att: 80, attMin: 77, attMax: 83, tempMin: 18, tempMax: 25, abvTol: 12, floc: 'med',
      code: '3711', primDays: [5, 10], secDays: [14, 28],
      notes: '比 3724 稳：主发 5–10 天不会停滞，二发 2–4 周把 FG 收到 1.006 以下。',
      flavor: '胡椒、柑橘、干爽，比 3724 更易用', styles: ['赛松', '农舍艾尔'],
      craft: '18–25°C、att 80 且不会停滞：新手做赛松比 3724 稳，干爽收口靠它自己走完。',
      conf: 'A', src: 'Wyeast 官方 77-83%',
      note: '不会像 WLP565 那样停滞，是新手做赛松的更稳选择' },

    { id: 'y-3724', name: '3724 比利时赛松', en: 'Wyeast 3724 Belgian Saison', lab: 'Wyeast', type: 'belgian', form: 'liquid',
      att: 78, attMin: 76, attMax: 80, tempMin: 21, tempMax: 27, abvTol: 12, floc: 'med',
      code: '3724', primDays: [7, 14], secDays: [21, 35],
      notes: '必须 24°C 以上：主发 1–2 周，容易停在 1.030，要靠升温与轻摇再走 3–5 周。',
      flavor: '强烈胡椒与辛香，复杂度高于 3711', styles: ['比利时赛松'],
      craft: '必须在 24°C 以上发酵：低温会停在 1.030，之后升温也难救；att 78 的复杂度值这份耐心。',
      conf: 'A', src: 'Wyeast 官方 76-80%',
      note: '**必须在 24°C 以上发酵**，低温会停滞在 1.030；怕麻烦就用 3711' },

    { id: 'y-2124', name: '2124 波西米亚拉格', en: 'Wyeast 2124 Bohemian Lager', lab: 'Wyeast', type: 'lager', form: 'liquid',
      att: 75, attMin: 73, attMax: 77, tempMin: 9, tempMax: 13, abvTol: 11, floc: 'high',
      code: '2124', primDays: [8, 12], secDays: [28, 42],
      notes: '波西米亚皮尔森：低温主发 8–12 天，后熟 4–6 周；这是"麦芽甜与酒花平衡"的必要代价。',
      flavor: '干净的捷克拉格', styles: ['波西米亚皮尔森'],
      craft: '9–13°C、att 75：波西米亚皮尔森的麦芽甜与酒花苦靠它平衡，温度波动会出双乙酰。',
      conf: 'A', src: 'Wyeast 官方 73-77%' },

    { id: 'y-2206', name: '2206 巴伐利亚拉格', en: 'Wyeast 2206 Bavarian Lager', lab: 'Wyeast', type: 'lager', form: 'liquid',
      att: 75, attMin: 73, attMax: 77, tempMin: 8, tempMax: 13, abvTol: 11, floc: 'high',
      code: '2206', primDays: [8, 12], secDays: [28, 42],
      notes: '巴伐利亚拉格：主发 8–12 天，后熟 4–6 周；柔和麦芽感需要时间才立得住。',
      flavor: '干净的德式拉格，麦芽感柔和', styles: ['慕尼黑拉格', '三月节', '博克'],
      craft: '8–13°C 也能稳定工作：巴伐利亚拉格的柔和麦芽感，适合慕尼黑拉格与三月节，后熟时间要留足。',
      conf: 'A', src: 'Wyeast 官方 73-77%' },

    /* ================= 液体酵母：Mangrove Jack's ================= */
    { id: 'y-m44', name: 'M44 西海岸', en: "Mangrove Jack's M44 West Coast", lab: "Mangrove Jack's", type: 'ale', form: 'dry',
      att: 77.5, attMin: 75, attMax: 80, tempMin: 15, tempMax: 23, abvTol: 12, floc: 'high',
      code: 'M44', primDays: [4, 7], secDays: [7, 14],
      notes: '西海岸干粉：主发 4–7 天，后熟 1–2 周；絮凝高，酒清得快，适合 IPA 赶时间。',
      flavor: '干净、酒花表现好，性价比高', styles: ['西海岸IPA', '淡色艾尔'],
      craft: '15–23°C、att 77.5：与 US-05 相近但更便宜，高絮凝让酒清得快，适合西海岸 IPA。',
      conf: 'B', src: '官方 75-80%' },

    { id: 'y-m21', name: 'M21 比利时小麦', en: "Mangrove Jack's M21 Belgian Wit", lab: "Mangrove Jack's", type: 'belgian', form: 'dry',
      att: 75, attMin: 72, attMax: 78, tempMin: 18, tempMax: 25, abvTol: 9, floc: 'low',
      code: 'M21', primDays: [4, 7], secDays: [10, 14],
      notes: '比利时小麦：主发一周，后熟 10–14 天；低絮凝，浑浊是设计目标，不必久置澄清。',
      flavor: '橙皮、芫荽、柔和酚香', styles: ['比利时小麦白啤'],
      craft: '18–25°C、att 75：橙皮与芫荽的酚香，比利时小麦白啤的省事选择；低絮凝，浑浊正常。',
      conf: 'B', src: '官方 72-78%' },

    /* ==========================================================================
     * v1.7 追加：主流厂商的常用菌株（干/液都有）
     * --------------------------------------------------------------------------
     * 选的是"家酿店常年有货、配方里真的会写"的 13 株，不是把厂商目录抄一遍。
     * att / 温度 一律取厂商标称区间（src 写明厂商），att 取区间中值，与库里既有
     * 46 条的算法完全一致 —— 这样 FG 预测的偏差方向和别的酵母是同一种。
     *
     * 新增参数（全部选填）：
     *   phenolic   POF+ / POF−：会不会产 4-乙烯基愈创木酚（丁香酚）。
     *              POF+ 的菌不要和"干净拉格"共用发酵罐，酚味洗不掉。
     *   ester      酯香风格（文字）：决定这株适合做"干净"还是"果香"。
     *   pitchRate  建议接种率 M cells/mL/°P：与 BREW.DB.pitchRates 的类型默认值一致，
     *              写出来是为了让用户在一行里看到"这株要不要多投"。
     *   rehydration 是否需活化：干酵母写厂商是否允许直接撒；液体酵母不适用，留空。
     * ========================================================================*/

    { id: 'y-koln', name: '科隆（Kölsch）', en: 'LalBrew Köln', lab: 'Lallemand', type: 'ale', form: 'dry',
      att: 74, attMin: 72, attMax: 76, tempMin: 15, tempMax: 20, abvTol: 12, floc: 'low',
      code: '', primDays: [4, 7], secDays: [14, 21],
      notes: '科隆要"低温熟成"：主发一周后降到 8–10°C 放 2–3 周，果酯才会收成淡淡的梨香。',
      flavor: '干净的淡果酯、微酒花香，收口偏干',
      styles: ['科隆', '淡色艾尔', '金色艾尔', '奶油艾尔'],
      craft: '15–17°C 才"干净"，上到 20°C 果酯明显就往艾尔跑了。低絮凝是它的本性：装瓶前冷降 2–3 天或加澄清剂。',
      phenolic: 'POF−', ester: '低，淡果酯', pitchRate: 0.75, rehydration: '厂商允许直接撒',
      conf: 'B', src: 'Lallemand 官方 72-76%、15-20°C' },

    { id: 'y-londonesb', name: '伦敦 ESB', en: 'LalBrew London ESB', lab: 'Lallemand', type: 'ale', form: 'dry',
      att: 68, attMin: 65, attMax: 72, tempMin: 18, tempMax: 22, abvTol: 10, floc: 'high',
      code: '', primDays: [3, 6], secDays: [10, 14],
      notes: '絮凝强、主发 3–6 天就结束；后熟 10–14 天让苹果与李子的酯香稳定下来。',
      flavor: '明显英式果酯（苹果、李子），收口圆润偏甜',
      styles: ['英式苦啤', 'ESB', '波特', '温和艾尔'],
      craft: '衰减只有 65–72%，是"故意留甜"的菌：做 ESB 与波特很对，做 IPA 会甜到发腻。想干爽就掺 5–8% 转化糖浆。',
      phenolic: 'POF−', ester: '中高，苹果/李子', pitchRate: 0.75, rehydration: '厂商允许直接撒',
      conf: 'B', src: 'Lallemand 官方 65-72%、18-22°C' },

    { id: 'y-voss', name: '沃斯（Kveik）', en: 'LalBrew Voss Kveik', lab: 'Lallemand', type: 'ale', form: 'dry',
      att: 78, attMin: 75, attMax: 82, tempMin: 25, tempMax: 40, abvTol: 12, floc: 'high',
      code: '', primDays: [2, 3], secDays: [3, 7],
      notes: 'Kveik 在 30–40°C 下 2–3 天到 FG；后熟一周足够，这是它唯一比别的菌省时间的地方。',
      flavor: '橙皮、热带水果；温度越高越"橘"',
      styles: ['农家艾尔', 'IPA', '淡色艾尔', '夏季快发'],
      craft: '25–40°C 正常发酵，夏天不用控温，2–3 天就能到 FG；代价是酯香很抢，做干净拉格不合适。挪威传统做法本来就少投，0.5 M 就够。',
      phenolic: 'POF−', ester: '高，橙皮/热带', pitchRate: 0.5, rehydration: '厂商允许直接撒',
      conf: 'B', src: 'Lallemand 官方 75-82%、25-40°C' },

    { id: 'y-newengland', name: '新英格兰艾尔', en: 'LalBrew New England', lab: 'Lallemand', type: 'ale', form: 'dry',
      att: 78, attMin: 75, attMax: 82, tempMin: 17, tempMax: 22, abvTol: 11, floc: 'low',
      code: '', primDays: [5, 8], secDays: [7, 14],
      notes: '为浑浊 IPA 选育：主发 5–8 天，后熟只 1–2 周且不冷降，浑浊与果酯都要留着。',
      flavor: '桃子、柑橘酯，帮助浑浊稳定',
      styles: ['浑浊 IPA', 'NEIPA', '果味淡艾'],
      craft: '专为浑浊 IPA 选育：低絮凝让浑浊留得住，桃酯替酒花补一层"果汁感"。17–20°C 最平衡，超过 22°C 酯会盖住干投。',
      phenolic: 'POF−', ester: '中高，桃/柑橘', pitchRate: 0.75, rehydration: '厂商允许直接撒',
      conf: 'B', src: 'Lallemand 官方 75-82%、17-22°C' },

    { id: 'y-be256', name: 'BE-256 修道院', en: 'SafAle BE-256', lab: 'Fermentis', type: 'belgian', form: 'dry',
      att: 84, attMin: 82, attMax: 86, tempMin: 15, tempMax: 20, abvTol: 12, floc: 'high',
      code: 'BE-256', primDays: [5, 10], secDays: [14, 21],
      notes: '衰减 82–86%，收尾快但容易"提早收工"；二发 2–3 周顺便确认比重不再下降。',
      flavor: '干爽、胡椒与丁香，果酯比 T-58 克制',
      styles: ['比利时双料', '比利时金艾', '修道院风格'],
      craft: '衰减 82–86%，把双料做成"烈而干"；15–20°C 运行，末段可升到 22°C 收尾。絮凝高，酒清得快，但也容易提早收工。',
      phenolic: 'POF+', ester: '中，胡椒/干果', pitchRate: 0.75, rehydration: '厂商允许直接撒',
      conf: 'C', src: 'Fermentis 官方区间约 82-86%，未取得第二来源交叉——查当年数据表' },

    { id: 'y-1968', name: '1968 伦敦 ESB', en: 'Wyeast 1968 London ESB Ale', lab: 'Wyeast', type: 'ale', form: 'liquid',
      att: 69, attMin: 67, attMax: 71, tempMin: 18, tempMax: 22, abvTol: 10, floc: 'veryhigh',
      code: '1968', primDays: [3, 5], secDays: [7, 14],
      notes: '絮凝极强，主发 3–5 天就沉底；装瓶前必须连续两天比重不变，否则瓶内继续发酵会过气。',
      flavor: '干净的英式果酯，沉降极快、酒体圆润',
      styles: ['ESB', '英式苦啤', '波特', '棕色艾尔'],
      craft: '絮凝极强，主发 3–4 天就沉底，最容易"提前收工"：装瓶前务必确认连续两天比重不变，否则瓶内继续发酵会过气。',
      phenolic: 'POF−', ester: '中，干净果酯', pitchRate: 0.75,
      conf: 'B', src: 'Wyeast 官方 67-71%、18-22°C' },

    { id: 'y-3787', name: '3787 特拉皮斯特高浓', en: 'Wyeast 3787 Trappist High Gravity', lab: 'Wyeast', type: 'belgian', form: 'liquid',
      att: 76, attMin: 74, attMax: 78, tempMin: 18, tempMax: 25, abvTol: 13, floc: 'med',
      code: '3787', primDays: [5, 10], secDays: [21, 35],
      notes: '高浓度修道院菌：主发 5–10 天，末段升温后再给 3–5 周二发，酒精与酚香才会融合。',
      flavor: '丁香、香蕉、酒精暖感，收口干',
      styles: ['比利时双料', '四料', '修道院风格', '比利时金艾'],
      craft: '18°C 起发、末段升到 24–25°C 收尾才不留双乙酰；耐 13% 酒精，做四料不用换菌。升温太早会出一股溶剂味。',
      phenolic: 'POF+', ester: '高，丁香/香蕉', pitchRate: 0.75,
      conf: 'B', src: 'Wyeast 官方 74-78%、18-25°C' },

    { id: 'y-3944', name: '3944 比利时白啤', en: 'Wyeast 3944 Belgian Witbier', lab: 'Wyeast', type: 'belgian', form: 'liquid',
      att: 74, attMin: 72, attMax: 76, tempMin: 17, tempMax: 24, abvTol: 10, floc: 'med',
      code: '3944', primDays: [4, 7], secDays: [10, 14],
      notes: '白啤要保留浑浊与香料感，二发 10–14 天低温即可；澄清过度反而不像。',
      flavor: '橙皮、芫荽、柔和酚香，浑浊是特征',
      styles: ['比利时小麦白啤', '比利时淡艾'],
      craft: '和橙皮、芫荽是天生一对：17–20°C 酚香最平衡，超过 22°C 会从"香料"滑向"香蕉"。别过度澄清，浑浊是风格的一部分。',
      phenolic: 'POF+', ester: '中，橙皮/芫荽', pitchRate: 0.75,
      conf: 'B', src: 'Wyeast 官方 72-76%、17-24°C' },

    { id: 'y-2278', name: '2278 捷克皮尔森', en: 'Wyeast 2278 Czech Pils', lab: 'Wyeast', type: 'lager', form: 'liquid',
      att: 72, attMin: 70, attMax: 74, tempMin: 10, tempMax: 14, abvTol: 10, floc: 'med',
      code: '2278', primDays: [8, 12], secDays: [28, 42],
      notes: '捷克皮尔森要长后熟：8–12°C 主发后转 1–3°C 放 4–6 周，硫与双乙酰才彻底消失。',
      flavor: '干净、微硫、收口留麦芽甜',
      styles: ['波西米亚皮尔森', '捷克淡色拉格', '深色拉格'],
      craft: '10–12°C 主发，双乙酰休止 15–18°C 两天；它比 W-34/70 留更多麦芽甜与硫味，这正是波西米亚皮尔森和德式皮尔森的区别。',
      phenolic: 'POF−', ester: '低，干净', pitchRate: 1.5,
      conf: 'B', src: 'Wyeast 官方 70-74%、10-14°C' },

    { id: 'y-1007', name: '1007 德式艾尔', en: 'Wyeast 1007 German Ale', lab: 'Wyeast', type: 'ale', form: 'liquid',
      att: 75, attMin: 73, attMax: 77, tempMin: 13, tempMax: 20, abvTol: 10, floc: 'low',
      code: '1007', primDays: [5, 8], secDays: [14, 21],
      notes: '低温艾尔（Altbier 路线）：主发 5–8 天，再 14–21 天低温熟成才够"干净"。',
      flavor: '极干净、微酸、几乎无酯',
      styles: ['德式淡色艾尔', 'Altbier', '科隆', '奶油艾尔'],
      craft: '13–16°C 发酵像"假拉格"：干净、微酸，是 Altbier 的传统温度。低絮凝，要冷降才清；温度上到 20°C 就会跑出艾尔酯。',
      phenolic: 'POF−', ester: '极低，微酸', pitchRate: 0.75,
      conf: 'B', src: 'Wyeast 官方 73-77%、13-20°C' },

    { id: 'y-wlp810', name: 'WLP810 旧金山拉格', en: 'WLP810 San Francisco Lager', lab: 'White Labs', type: 'lager', form: 'liquid',
      att: 67, attMin: 65, attMax: 70, tempMin: 14, tempMax: 18, abvTol: 10, floc: 'high',
      code: 'WLP810', primDays: [7, 12], secDays: [14, 21],
      notes: '蒸汽啤酒允许较高温发酵，主发 7–12 天；后熟只需 2–3 周，久了会把那点微果酯磨掉。',
      flavor: '干净、麦芽突出，允许较高发酵温度',
      styles: ['蒸汽啤酒（California Common）', '美式拉格', '琥珀拉格'],
      craft: '"蒸汽啤酒"菌：14–18°C 就能做出接近拉格的干净，不必压到 10°C。衰减只有 65–70%，FG 偏高，做淡爽型要掺糖。',
      phenolic: 'POF−', ester: '低，干净', pitchRate: 1.5,
      conf: 'B', src: 'White Labs 官方 65-70%、14-18°C' },

    { id: 'y-wlp550', name: 'WLP550 比利时艾尔', en: 'WLP550 Belgian Ale', lab: 'White Labs', type: 'belgian', form: 'liquid',
      att: 81, attMin: 78, attMax: 85, tempMin: 20, tempMax: 25, abvTol: 12, floc: 'med',
      code: 'WLP550', primDays: [5, 10], secDays: [14, 28],
      notes: '高衰减比利时菌：主发 5–10 天，二发 2–4 周让辛香与干爽收口同时到位。',
      flavor: '酚香、辛香、干爽收口',
      styles: ['比利时金艾', '双料', '赛松', '比利时淡艾'],
      craft: '高衰减 + 高酚香，比利时金艾与双料的通用菌：20°C 起发、25°C 收尾。它比 3787 少一点香蕉、多一点辛香。',
      phenolic: 'POF+', ester: '中高，辛香/果', pitchRate: 0.75,
      conf: 'B', src: 'White Labs 官方 78-85%、20-25°C' },

    { id: 'y-wlp028', name: 'WLP028 爱丁堡苏格兰艾尔', en: 'WLP028 Edinburgh Scottish Ale', lab: 'White Labs', type: 'ale', form: 'liquid',
      att: 72, attMin: 70, attMax: 75, tempMin: 16, tempMax: 22, abvTol: 12, floc: 'med',
      code: 'WLP028', primDays: [4, 7], secDays: [10, 14],
      notes: '苏格兰艾尔的"低调"菌，几乎不出酯；主发 4–7 天、后熟两周，让焦糖麦芽说话。',
      flavor: '干净的麦芽甜、几乎无酯',
      styles: ['苏格兰艾尔', '80/-', '世涛', '棕色艾尔'],
      craft: '苏格兰艾尔的"低调"菌：几乎不出酯，让焦糖麦芽与烘烤味说话。16–18°C 最干净；耐 12% 酒精，做苏格兰烈性艾尔不用换菌。',
      phenolic: 'POF−', ester: '低，几乎无酯', pitchRate: 0.75,
      conf: 'B', src: 'White Labs 官方 70-75%、16-22°C' }
  ];

  BREW.DB.yeastCats = {
    ale:     { zh: '艾尔', desc: '顶部发酵，18–22°C，风味丰富，发酵快', color: '#be9558' },
    lager:   { zh: '拉格', desc: '底部发酵，8–15°C，干净纯粹，需低温与耐心', color: '#7398ab' },
    wheat:   { zh: '小麦', desc: '产香蕉/丁香酚香，低絮凝，浑浊是特征', color: '#ab9f73' },
    belgian: { zh: '比利时', desc: '高酚香与果酯，耐高酒精，常需升温收尾', color: '#a17852' },
    sour:    { zh: '酸啤', desc: '产乳酸，直接酸化，避免设备染菌', color: '#869d73' },
    brett:   { zh: '布雷特', desc: '野菌，发酵极慢，风味从热带水果到马厩', color: '#86738f' }
  };

  /** 推荐接种率（百万细胞 / mL / °P） */
  BREW.DB.pitchRates = {
    ale: 0.75, lager: 1.5, wheat: 0.75, belgian: 0.75, sour: 0.5, brett: 0.5
  };

  /** 干酵母活细胞估算（十亿细胞 / 克），用于把克数换算成细胞数。
   *  厂商标称通常 ≥6e9/g（Fermentis），实测新鲜干酵母可达 15–20e9/g。
   *  取 15 作为中值：既不会让新手觉得"要多投一倍"，也不会低估陈化损失。
   *  **过期或高温存放的酵母应视为 5e9/g 甚至更低。** */
  BREW.DB.dryYeastCellsPerGram = 15;

  /* ==========================================================================
   * 品类导览（第一层文案）——按发酵类型分四组
   * --------------------------------------------------------------------------
   * keys 里写的是本表 type 的值，一个分组可以覆盖多个 type（小麦与比利时合并，
   * 布雷特与酸啤合并），因为用户关心的是"这株怎么发"，不是分类学。
   * ========================================================================*/
  BREW.DB.catGuides = BREW.DB.catGuides || {};
  BREW.DB.catGuides.yeast = [
    {
      key: 'top', zh: '上面发酵（艾尔）', keys: ['ale'],
      lead: '18–22°C、发酵快、风味丰富，家酿的主战场。',
      what: '酿酒酵母的上面发酵类型，发酵时酵母浮到液面，温度比拉格高、代谢快。这一族覆盖了从"几乎无味"的 Chico 系（US-05、WLP001、1056）到果酯明显的英式系（S-04、WLP002、1318）。',
      role: '温度是这类酵母唯一的风味旋钮：同一株在 17°C 与 22°C 可以做出"干净"与"果香"两款酒。温度每高 1°C，酯与高级醇都会上升；超过上限 2–3°C 就是溶剂味与上头。',
      dose: '一包 11g 干酵母覆盖 20L 常规浓度艾尔；OG 超过 1.070 或酵母已过期，就要两包或扩培。液体酵母的活细胞数随时间下降，用前看生产日期。',
      mistakes: [
        '发酵温度跟着室温走：室温 26°C 时罐内能到 29°C，果酯与高级醇一起爆。',
        '不控温却怪酵母"有怪味"：多数所谓家酿味是温度问题，不是菌株问题。',
        '高絮凝菌株提前沉降就以为发完了：装瓶前必须连续两天比重不变。'
      ]
    },
    {
      key: 'phenolic', zh: '小麦与比利时酚香', keys: ['wheat', 'belgian'],
      lead: '香蕉、丁香、胡椒：酚香是被温度"调"出来的。',
      what: '德式小麦酵母（WB-06、WLP300、3068）与比利时系（T-58、Abbaye、WLP500、赛松）都会产生明显的酚类物质：前者以 4-乙烯基愈创木酚（丁香）为主，后者叠加胡椒与果酯。它们的高衰减常常伴随"发酵停在中途"的坏名声。',
      role: '小麦酵母 17–18°C 偏丁香、22–24°C 偏香蕉；比利时系 18–22°C 起步、收尾升到 24–25°C 才走得完高衰减，赛松甚至要 25–30°C。接种量与艾尔同为 0.75，但高浓度风格建议略高并保证前期充氧。',
      dose: '一包 11g 干酵母够 20L 常规浓度；OG 1.075 以上、或用的是低絮凝的赛松菌株，加一包或做一次扩培，能显著降低中途停滞的概率。',
      mistakes: [
        '比利时系中途降温：残糖留在酒里，最后甜得发腻。',
        '小麦啤发酵温度太低：丁香压倒香蕉，还会带明显硫味。',
        '把浑浊当缺陷：小麦与比利时白啤的低絮凝是设计目标，澄清了反而不像。'
      ]
    },
    {
      key: 'lager', zh: '下面发酵（拉格）', keys: ['lager'],
      lead: '8–15°C、干净纯粹，也最考验温控与耐心。',
      what: '下面发酵酵母在低温下工作，代谢慢、酯类生成少，所以酒体干净、麦芽与酒花更突出。代价是发酵周期长、双乙酰需要时间还原，接种量还要翻倍——这是拉格比艾尔"难"的全部原因，不是菌株娇气。',
      role: '9–13°C 是主流区间，12°C 最稳。低于下限酵母休眠、发酵停滞；高于 15°C 会出果酯，变成"假拉格"——不是不能喝，只是不再是拉格。接种率 1.5 百万细胞/mL/°P：20L、12°P 约需 3600 亿细胞，等于两包以上干酵母。',
      dose: '两包 11g 干酵母起步，或用一包做扩培；温度越低、OG 越高，越要按上限投。主发酵结束后留 2–3 天 15–18°C 做双乙酰还原，再冷降。',
      mistakes: [
        '投一包干酵母就发 20L 拉格：接种不足会让发酵拖长，双乙酰与硫味残留。',
        '主发酵一结束就冷降：双乙酰没还原，酒里会留黄油味。',
        '频繁开盖查比重：拉格对氧气更敏感，氧化味（纸板）比艾尔明显得多。'
      ]
    },
    {
      key: 'wild', zh: '布雷特与酸啤', keys: ['brett', 'sour'],
      lead: '慢、脏、不可预测——也是复杂度最高的一类。',
      what: '布雷特（Brettanomyces）与产乳酸菌株（如 Philly Sour）是两类完全不同的东西：前者发酵极慢、能吃掉普通酵母吃不动的糖，风味从热带水果到马厩；后者直接把糖转成乳酸，一次发酵就得到干净的酸。放在一组只因为用法都需要隔离。',
      role: '布雷特 20–25°C，周期以月计；产乳酸酵母 20–25°C，pH 到 3.4 左右就该降温终止酸化，否则会酸到发尖。接种率可以低（0.5 百万细胞/mL/°P），但要留足时间与罐顶空间。',
      dose: '布雷特按 0.5 接种率即可，重点是时间不是量；Philly Sour 按常规艾尔量投，一株完成糖化发酵与酸化，省掉单独的乳酸菌步骤与染菌风险。',
      mistakes: [
        '用同一套塑料设备做布雷特与常规酒：野菌会藏进划痕，之后每一批都可能被感染。',
        '比重还在降就装瓶：布雷特收尾极慢，等两周不变再装，否则过气甚至爆瓶。',
        '把"酸"和"布雷特"混为一谈：布雷特不必然产酸，酸度通常来自乳酸菌或酸化麦芽。'
      ]
    }
  ];

})(typeof window !== 'undefined' ? window : globalThis);
