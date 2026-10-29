/* ============================================================================
 * 风月酿研所 — 21 经典配方库
 * ----------------------------------------------------------------------------
 * 目标：每个主流风格至少一份"行业公认的标杆"配方，可直接载入改写。
 *
 * 数据纪律（很重要）：
 *   · story 只写有据可查的事实（酒厂、年份、工艺特征、历史地位）。
 *     拿不准的细节不写，绝不编"某某酒厂 1873 年首创"这种话。
 *   · 配方参数是"按风格反推的合理复原"，**不是**酒厂的保密配方。
 *     多数商业配方从未公开，这里的原料比例依据是该风格的通行做法
 *     与公开访谈/资料，属于"复刻思路"而非"原厂配方"。
 *     UI 上必须标明这一点，不能让用户以为是官方配方。
 *   · conf 字段沿用原料库的分级：A 有公开资料可对照 / B 按风格惯例复原。
 *
 * 结构：用 mk() 把"紧凑描述"展开成完整配方对象，避免每个配方写 40 行。
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  BREW.DB = BREW.DB || {};

  /* --------------------------------------------------------------------
   * 辅助：按 id 查原料
   * ------------------------------------------------------------------*/
  function find(kind, id) {
    var pool = (BREW.DB && BREW.DB[kind]) || [];
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].id === id) return pool[i];
    }
    return null;
  }

  /* --------------------------------------------------------------------
   * 辅助：把紧凑描述展开成完整配方
   * ------------------------------------------------------------------*/
  function mk(o) {
    var r = BREW.Recipe.blank({ name: o.name, styleId: o.styleId });
    r.author = o.brewery ? (o.brewery + (o.year ? ' · ' + o.year : (o.era ? ' · ' + o.era : ''))) : '风月酿研所 经典配方库';
    r.efficiency = o.eff || 72;
    r.fermentTemp = o.temp || 19;
    r.batchSize = 20;
    r.boilTime = o.boil || 60;
    r.evaporationRate = 10;

    /* 麦芽 */
    (o.malts || []).forEach(function (m) {
      var def = find('malts', m[0]);
      if (def) BREW.Recipe.addFermentable(r, def, m[1]);
    });

    /* 糖化方案 */
    if (o.mash) {
      r.mash.steps = o.mash.map(function (s) {
        return { name: s[0], tempC: s[1], minutes: s[2] };
      });
    } else {
      r.mash.steps = [
        { name: '糖化', tempC: o.mashTemp || 66, minutes: 60 },
        { name: '出糖', tempC: 76, minutes: 10 }
      ];
    }

    /* 酒花：[id, 克数, 阶段, 分钟, 回旋温度] */
    (o.hops || []).forEach(function (h) {
      var def = find('hops', h[0]);
      if (!def) return;
      var row = BREW.Recipe.addHop(r, def, h[1], h[2] || 'boil', h[3] === undefined ? 60 : h[3]);
      if (row && h[4]) row.whirlpoolTemp = h[4];
    });

    /* 辅料 */
    (o.adj || []).forEach(function (a) {
      var def = find('adjuncts', a[0]);
      if (def) BREW.Recipe.addAdjunct(r, def, a[1]);
    });

    /* 酵母 */
    if (o.yeast) {
      var y = find('yeasts', o.yeast[0]);
      if (y) {
        var yRow = BREW.Recipe.addYeast(r, y, o.yeast[1] || 11);
        if (yRow && o.att) yRow.att = o.att;   /* 糖化温度会影响实际衰减度 */
      }
    }

    /* 水 */
    if (o.water) {
      r.water.source = o.water;
    } else {
      r.water.source = { ca: 50, mg: 8, na: 25, cl: 45, so4: 60, hco3: 60 };
    }
    if (o.salts) {
      r.water.salts = o.salts.map(function (s) { return { id: s[0], amount: s[1] }; });
    }

    /* 碳化 */
    r.carbonation.targetVol = o.carb || 2.4;

    r.notes = o.notes || '';
    return r;
  }

  /* ====================================================================
   * 配方清单
   * ==================================================================*/
  var LIST = [

    /* ---------------- 美式与国际化 ---------------- */
    {
      id: 'c-american-lager', name: '美式拉格 · 工业标杆', en: 'American Lager',
      styleId: '1B', country: '美国', brewery: 'Budweiser 风格', year: 1876,
      story: '美式拉格的定型来自 19 世纪大量德裔移民酿酒师，以及美国本土六棱大麦与玉米的丰产。' +
             '用玉米或大米作辅料不是偷工减料，而是为了把麦芽味"削薄"到适合冰镇畅饮。',
      tags: ['拉格', '辅料', '清爽'], conf: 'B',
      eff: 72, temp: 12, mashTemp: 65, carb: 2.6,
      malts: [['m-6row', 3.4], ['m-flakedrice', 1.1]],
      hops: [['h-cluster', 18, 'boil', 60]],
      yeast: ['y-w3470', 22], att: 82,
      notes: '这是"风格复原"，不是百威的真实配方（其配方未公开）。要点在辅料比例与极干净的发酵。' +
             ' 色度说明：六棱麦芽本身的色度就决定这条配方落在 3.4 SRM，比 1B 的区间上限高 0.4；' +
             '要压到 3.0 必须换成二棱+大比例大米，但那会改掉这条配方的历史口径，所以按原样保留。'
    },
    {
      id: 'c-cream-ale', name: '奶油艾尔 · 拉格般干净的艾尔', en: 'Cream Ale',
      styleId: '1C', country: '美国', brewery: 'Genesee 风格', year: 1900,
      story: '奶油艾尔的诞生与 20 世纪初美国对"拉格"的偏爱有关：酿酒师用艾尔酵母在较低温度发酵，' +
             '再低温熟成，做出接近拉格的干净感。"奶油"指口感圆润，并非加了乳糖。',
      tags: ['艾尔', '玉米', '易饮'], conf: 'B',
      eff: 75, temp: 17, mashTemp: 66, carb: 2.6,
      /* 2026 收口：原 3.6 / 0.8 / 0.2 实算 1.054 / 1.013，FG 压在 1C 上界（1.012）
         外 0.001。奶油艾尔本来就是"低度、干、易饮"的酒，按风格把麦量收到
         1.048 一档：基麦 3.15、玉米 0.8 保持辅料约两成，结晶减到 0.1 只留色与一点圆润。 */
      malts: [['m-2row', 3.15], ['m-flakedcorn', 0.8], ['m-c10', 0.1]],
      hops: [['h-cluster', 20, 'boil', 60]],
      yeast: ['y-us05', 12], att: 78,
      notes: '低 IBU、干净收口。别加乳糖——那是牛奶世涛的做法。'
    },
    {
      id: 'c-american-wheat', name: '美式小麦 · 不带香蕉丁香', en: 'American Wheat',
      styleId: '1D', country: '美国', brewery: "Bell's Oberon 风格", year: 1992,
      story: '美式小麦与德式小麦最大的区别在酵母：用中性艾尔酵母，所以没有香蕉与丁香。' +
             '它把舞台让给酒花与小麦带来的柔和口感，是夏季最畅销的美式风格之一。',
      tags: ['小麦', '清爽', '柑橘'], conf: 'B',
      eff: 74, temp: 19, mashTemp: 66, carb: 2.7,
      malts: [['m-2row', 2.6], ['m-wheat', 1.8]],
      hops: [['h-cascade', 18, 'boil', 60], ['h-cascade', 20, 'whirlpool', 15, 85]],
      yeast: ['y-us05', 12], att: 78,
      notes: '关键：不要用 WB-06 或 3068，那是德式小麦酵母。'
    },

    /* ---------------- 捷克拉格 ---------------- */
    {
      id: 'c-czech-session', name: '捷克日常淡色拉格 · 10° 的口粮', en: 'Czech Pale Lager · Desítka',
      styleId: '3A', country: '捷克', brewery: '风格基准（10° 日常拉格）', era: 'modern', conf: 'B',
      story: '捷克人按原麦汁浓度叫酒：12° 是 dvanáctka（皮尔森那一档），10° 是 desítka——' +
             '酒馆里按杯续、一天喝几杯的日常口粮。它不是"稀释的皮尔森"：' +
             '麦汁更薄、酒花更少，但苦味要更圆，因为低度酒里任何尖锐的苦都会被放大。' +
             '这类酒在捷克以外几乎没有商业出口，所以只能自己酿。',
      tags: ['拉格', '萨兹', '低度', '日常'], conf: 'B',
      eff: 72, temp: 11, mashTemp: 66, carb: 2.4,
      /* 3A 的色度下限定在 3 SRM，而 100% 皮尔森在这个模型里只算到 2.9——
         真实的捷克 10° 靠煮出糖化把颜色拉上去，模型里没有煮出这一步。
         所以掺 7% 浅慕尼黑把色度做到 3.3（同时也带来一点面包皮，
         正好是 3A 比 3B "更软"的那部分）。 */
      malts: [['m-pilsner', 2.75], ['m-munich', 0.25], ['m-carapils', 0.12]],
      hops: [['h-saaz', 46, 'boil', 60], ['h-saaz', 12, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 76,
      water: { ca: 12, mg: 3, na: 5, cl: 8, so4: 12, hco3: 25 },
      notes: '和 3B 那两条（`c-pilsner-urquell` / `c-czech-pale`）的区别是**浓度与苦度**：' +
             '这条是 1.035 / 3.4% 的 10°，那两条是 1.048 上下的 12°。' +
             '所以别按皮尔森的比例投花——46g 萨兹在这里已经是 27 IBU，同样的量放到 12° 里只是中段。' +
             '控温 11°C，双乙酰还原做足；低度酒没有味道可以掩盖发酵瑕疵。'
    },
    {
      id: 'c-pilsner-urquell', name: '皮尔森之源 · 1842 年的发明', en: 'Pilsner Urquell · Plzeňský Prazdroj',
      styleId: '3B', country: '捷克', brewery: 'Plzeňský Prazdroj', year: 1842,
      story: '1842 年，皮尔森市民酿酒厂请来巴伐利亚酿酒师 Josef Groll，用当地极软的水、' +
             '捷克萨兹酒花与英国新式的间接加热技术，酿出世界上第一款金色清澈的拉格。' +
             '在此之前，绝大多数啤酒是深色浑浊的。这款酒定义了"皮尔森"这个整个风格。',
      tags: ['拉格', '萨兹', '三次煮出', '历史'], conf: 'A',
      eff: 70, temp: 11, carb: 2.5, boil: 90,
      /* 2026 收口：100% 皮尔森在本模型里只算到 3.4 SRM，而 3B 的下限是 3.5——
         真实酒厂靠三次煮出糖化的美拉德反应把颜色拉上去，模型不含煮出这一步，
         所以掺 0.1 kg 浅慕尼黑补到 3.7（也就是"煮出会带来的那点面包皮"）。
         同时把表观衰减从 80 收到 78：捷克皮尔森收口不是干到底，1.011 才是它的常态。 */
      malts: [['m-pilsner', 4.4], ['m-munich', 0.1]],
      mash: [['蛋白质休止', 50, 20], ['糖化 1', 63, 30], ['糖化 2', 72, 30], ['出糖', 76, 10]],
      hops: [['h-saaz', 55, 'boil', 90], ['h-saaz', 30, 'boil', 20], ['h-saaz', 30, 'whirlpool', 20, 85]],
      yeast: ['y-w3470', 22], att: 78,
      water: { ca: 7, mg: 2, na: 2, cl: 4, so4: 5, hco3: 15 },
      notes: '极软水是关键——碱度高了颜色会深、酒花会闷。传统用三次煮出糖化，家酿可简化为单步，' +
             '但要接受麦芽香会简单一些。双乙酰还原必须做足。' +
             ' 那 0.1 kg 浅慕尼黑是**补色用的，不是风味设计**：本模型不含煮出糖化的加深，' +
             '100% 皮尔森只算到 3.4 SRM（3B 下限 3.5），掺 2% 才回到 3.7；想换成 100% 皮尔森就得自己接受色度偏低。'
    },

    /* ---------------- 德式淡色 ---------------- */
    {
      id: 'c-helles', name: '慕尼黑清亮 · 麦芽的温柔', en: 'Munich Helles · Augustiner',
      styleId: '4A', country: '德国', brewery: 'Augustiner-Bräu 风格', year: 1894,
      story: 'Helles 是慕尼黑对"皮尔森冲击"的回应：1894 年 Spaten 推出第一款淡色拉格，' +
             '慕尼黑人没有照搬捷克的高苦度，而是把麦芽甜留在前面、苦味压到最低，' +
             '"Helles"就是"淡色"的意思。',
      tags: ['拉格', '麦芽', '低苦'], conf: 'B',
      eff: 72, temp: 10, carb: 2.5,
      /* 2026 收口：22g 哈勒道只算到 15.8 IBU，差 4A 下限 0.2；加到 24g 得 17.0，
         苦度仍在"低苦"的定位里（区间 16–22）。 */
      malts: [['m-pilsner', 3.6], ['m-munich', 0.5]],
      hops: [['h-hallertau', 24, 'boil', 60], ['h-hallertau', 10, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 82,
      notes: '苦度要压住（16–22 IBU），任何明显的酯香或双乙酰都是缺陷。'
    },
    {
      id: 'c-kolsch', name: '科隆啤酒 · 用艾尔酵母做拉格', en: 'Kölsch',
      styleId: '5B', country: '德国', brewery: 'Früh 风格', year: 1900,
      story: '科隆是德国少数保留上层发酵的城市。Kölsch 的合法性受《科隆公约》保护：' +
             '只有在科隆周边酿的、用上层发酵再低温熟成的，才能叫这个名字。' +
             '它的果酯极淡（梨、苹果），干净得像拉格，但确实不是拉格。',
      tags: ['艾尔', '低温熟成', '干净'], conf: 'B',
      eff: 74, temp: 17, carb: 2.6,
      /* v1.4 调：酒花 25→29g（原 16 IBU 低于 5B 下限 18）、加 0.07kg c10
         （原色度 3.2 SRM 低于下限 3.5；皮尔森+小麦撑不到 3.5，用 1.7% 浅结晶补色）。 */
      malts: [['m-pilsner', 3.8], ['m-wheat', 0.3], ['m-c10', 0.07]],
      hops: [['h-hallertau', 29, 'boil', 60], ['h-hallertau', 12, 'whirlpool', 15, 85]],
      yeast: ['y-k97', 12], att: 82,
      notes: '发酵 17°C 后降到 8–10°C 熟成 2–3 周。这个"低温熟成"是它与普通艾尔的区别。' +
             ' 余量提示：ABV 5.17%（上限 5.2）、SRM 3.5（下限 3.5）都贴线，' +
             '再往上加麦量会先把 ABV 顶出去，再减结晶麦芽会先把颜色掉出去。'
    },
    {
      id: 'c-german-pils', name: '德式皮尔森 · 锋利与干脆', en: 'German Pils · Jever 风格',
      styleId: '5D', country: '德国', brewery: 'Jever 风格', year: 1848,
      story: '德式皮尔森比捷克版更干、更苦、酒花更"锋利"。Jever 位于德国北部，' +
             '当地水质与更长的煮沸让它带出明显的干爽收口，被称为"最苦的德国皮尔森之一"。',
      tags: ['拉格', '干爽', '苦'], conf: 'B',
      eff: 72, temp: 10, carb: 2.6, boil: 75,
      malts: [['m-pilsner', 4.1]],
      hops: [['h-hallertau', 30, 'boil', 75], ['h-hallertau', 20, 'boil', 20], ['h-hallertau', 15, 'whirlpool', 15, 85]],
      yeast: ['y-w3470', 22], att: 82,
      notes: '目标 IBU 26–30，收口必须干（FG 1.008–1.011）。水要软，否则酒花发闷。'
    },
    /* v1.4 补：5C 原先没有条目，导致「我的水能酿什么酒」里多特蒙德那行推荐
       点不进经典配方库（只能显示"经典库暂无"）。补这一条是为了把那个死链填掉。 */
    {
      id: 'c-dortmunder-export', name: '多特蒙德出口啤 · 硬水也能做干净', en: 'German Helles Exportbier · Dortmunder Export',
      styleId: '5C', country: '德国', brewery: '风格基准（家酿复原）', era: 'modern', conf: 'B',
      story: 'Export（出口啤酒）来自 19 世纪的多特蒙德：那是一座工业城市，当地水的硬度与硫酸盐都偏高，' +
             '于是当地拉格比慕尼黑清亮啤酒更干、骨架更明显，麦芽与酒花各往前站一步。' +
             '它是"硬水也能酿出干净拉格"的证明——前提是碱度别跟着一起高，' +
             '碱度上去了酒花就会从清爽变成钝苦。',
      tags: ['拉格', '硬水', '平衡'], conf: 'B',
      eff: 72, temp: 11, mashTemp: 65, carb: 2.6, boil: 75,
      malts: [['m-pilsner', 3.6], ['m-munich', 0.85], ['m-carapils', 0.2]],
      hops: [['h-magnum-de', 14, 'boil', 75], ['h-spalt', 16, 'boil', 20], ['h-tettnanger', 12, 'whirlpool', 15, 85]],
      yeast: ['y-w3470', 22], att: 79,
      water: { ca: 200, mg: 20, na: 60, cl: 90, so4: 180, hco3: 140 },
      notes: '它和德式皮尔森的分岔在麦芽：Export 的麦芽更厚（15–20% 慕尼黑麦芽），苦度反而更低。' +
             '多特蒙德的原始报告里 SO₄ 到 240，这里收到 180——超过 200 苦味会发涩。' +
             '1.052 的拉格建议 2 包（22 g）起步，接种不足会停在 1.02 收不了尾。'
    },

    /* ---------------- 德式小麦 ---------------- */
    {
      id: 'c-weissbier', name: '巴伐利亚小麦 · 香蕉与丁香', en: 'Weissbier · Weihenstephaner',
      styleId: '10A', country: '德国', brewery: 'Weihenstephan 风格', year: 1040,
      story: 'Weihenstephan 修道院酒厂自称建于 1040 年，是世界现存最古老的酒厂之一。' +
             '德式小麦的香蕉（乙酸异戊酯）与丁香（4-乙烯基愈创木酚）来自特定酵母，' +
             '温度是唯一的风味旋钮：低温偏丁香，高温偏香蕉。',
      tags: ['小麦', '香蕉', '丁香'], conf: 'A',
      eff: 72, temp: 20, carb: 3.2,
      /* 2026 收口：WB-06 的 83% 衰减把 1.048 的麦汁拉到 1.008，低于 10A 的 FG 下限
         （1.010）——模型里糖化温度不参与计算，而真实小麦啤靠 45/66 两段糖化与
         小麦蛋白留下的糊精撑住收口。所以在麦芽侧补：基麦各减 0.2kg，
         加 0.45kg 泡沫麦芽（Carafoam，几乎无味、只给酒体与挂杯），
         实算 1.0495 / 1.0107，麦芽构成仍是小麦 53% + 皮尔森 33%。 */
      malts: [['m-wheat', 2.4], ['m-pilsner', 1.5], ['m-carapils', 0.45]],
      mash: [['蛋白质休止', 45, 15], ['糖化', 66, 60], ['出糖', 76, 10]],
      hops: [['h-hallertau', 20, 'boil', 60]],
      yeast: ['y-wb06', 12], att: 83,
      notes: '浑浊是风格特征，不要过滤、不要过度冷降。碳酸要高（3.0–3.5 vol）。'
    },

    /* ---------------- 德式深色 ---------------- */
    {
      id: 'c-marzen', name: '三月啤酒 · 啤酒节的起源', en: 'Märzen / Oktoberfest',
      styleId: '6A', country: '德国', brewery: 'Paulaner 风格', year: 1810,
      story: 'Märzen 意为"三月"，源于巴伐利亚 1553 年的酿酒法规：夏季禁止酿酒（怕杂菌），' +
             '所以三月要酿足存货。为了让酒熬过夏天，浓度做得更高、酒花也更多。' +
             '1810 年巴伐利亚王储婚礼的庆典让它与"啤酒节"绑定。',
      tags: ['拉格', '琥珀', '麦芽'], conf: 'B',
      eff: 72, temp: 10, carb: 2.6,
      /* 2026 收口：原 3.6 / 1.8 / 0.3 实算 1.061 / 6.43% / 17.8 IBU —— OG 与 ABV
         双双顶到 6A 上限之外、IBU 差下限 0.2。主麦减 0.25kg、维也纳减 0.1kg
         把浓度收回 1.057，苦花 34→36g 补到 19.4 IBU（区间 18–24，仍是"只做平衡"）。 */
      malts: [['m-munich', 3.35], ['m-vienna', 1.7], ['m-c40', 0.3]],
      hops: [['h-hallertau', 36, 'boil', 60]],
      yeast: ['y-w3470', 22], att: 80,
      notes: '重点在麦芽的"烤面包"感，酒花只做平衡。别用结晶麦芽堆甜。'
    },
    {
      id: 'c-rauchbier', name: '烟熏啤酒 · 培根与篝火', en: 'Rauchbier · Schlenkerla',
      styleId: '6B', country: '德国', brewery: 'Aecht Schlenkerla', year: 1678,
      story: '班贝格的 Schlenkerla 酒厂用山毛榉木直接熏烤麦芽，酿出的酒带明显的烟熏培根味。' +
             '这种工艺在别处早已消失，只有班贝格保留下来，成为啤酒世界里独一无二的存在。',
      tags: ['烟熏', '班贝格', '特殊'], conf: 'B',
      eff: 72, temp: 10, carb: 2.5,
      malts: [['m-munich', 3.4], ['m-pilsner', 1.6], ['m-chocolate', 0.2]],
      /* v1.4 调：32→37g。原 17.4 IBU 低于 6B 下限 20；烟熏酒苦度太低会显得肥腻。 */
      hops: [['h-hallertau', 37, 'boil', 60]],
      yeast: ['y-w3470', 22], att: 80,
      notes: '原料库里没有烟熏麦芽，需自建（把 30–50% 的慕尼黑麦芽替换为烟熏麦芽）。' +
             '烟熏是主角但不能刺鼻——超过 60% 会像液体培根。'
    },
    {
      id: 'c-schwarzbier', name: '黑啤 · 黑而不重', en: 'Schwarzbier · Köstritzer',
      styleId: '8B', country: '德国', brewery: 'Köstritzer 风格', year: 1543,
      story: 'Schwarzbier 是"看起来像世涛、喝起来像拉格"的最好例证。' +
             '它用少量烘烤麦芽上色，但酒体轻盈、收口干爽，是德国中部图林根地区的传统。',
      tags: ['拉格', '深色', '轻盈'], conf: 'B',
      eff: 72, temp: 10, carb: 2.5,
      malts: [['m-munich', 2.6], ['m-pilsner', 1.5], ['m-carafa2', 0.22]],
      /* v1.4 调：26g → 35g。原来的 26g 哈拉道（AA 4.5%）在 20L 里只有 15 IBU，
         比 8B 的区间下限 20 低 25%——黑啤"苦度太低"会显得像甜味拉格。 */
      hops: [['h-hallertau', 35, 'boil', 60]],
      yeast: ['y-w3470', 22], att: 80,
      notes: '关键在"只有颜色没有焦苦"——用去苦黑麦芽（Carafa Special）而不是黑专利。'
    },
    {
      id: 'c-doppelbock', name: '双料博克 · 液体面包', en: 'Doppelbock · Salvator',
      styleId: '9A', country: '德国', brewery: 'Paulaner Salvator', year: 1774,
      story: '双料博克由慕尼黑的圣方济各会修士酿造，用于斋戒期的"液体面包"。' +
             'Salvator 是这类酒最早的名字，后来其他酒厂都用 -ator 后缀致敬（Celebrator、Optimator）。',
      tags: ['拉格', '高浓度', '麦芽'], conf: 'B',
      eff: 68, temp: 10, carb: 2.4, boil: 90,
      /* v1.4 调：6.1kg → 8.1kg。原配方 OG 只有 1.061（9A 下限 1.072，差 11 个比重分），
         算出来 ABV 5.55% 比下限 7% 低 21%——那不是双料博克，是深色博克。
         顺带把 att 68→74（W-34/70 在 1.08 麦汁上正常能到 74% 上下），
         FG 才落得进 1.016–1.024；酒花 30→34g 抵消高浓度带来的利用率下降。 */
      malts: [['m-munich', 5.6], ['m-munich-dark', 2.2], ['m-c60', 0.3]],
      hops: [['h-hallertau', 34, 'boil', 90]],
      yeast: ['y-w3470', 26], att: 74,
      notes: 'OG 1.075–1.085，必须足量接种 + 充氧，否则会停在 1.030 收不了尾。' +
             ' 衰减说明：att 74% 是按 W-34/70 在 1.08 麦汁上的实际衰减取的，不是保守值——' +
             '68% 是 1.10 以上帝国世涛那种高浓度才用的保守假设，套到这里等于假设酵母干不到它实际能做到的事，' +
             '再靠多堆麦子去补，只会让配方越来越重而解决不了假设本身。'
    },

    /* ---------------- 英式 ---------------- */
    {
      id: 'c-best-bitter', name: '优质苦啤 · 英国酒吧的日常', en: 'Best Bitter · London Pride',
      styleId: '11B', country: '英国', brewery: "Fuller's London Pride", year: 1959,
      story: '英式苦啤的"苦"是相对当时的淡艾而言，今天看其实苦度并不高。' +
             '它的灵魂是 Maris Otter 麦芽的饼干香 + 英式酵母的果酯 + 低碳酸的柔顺口感。',
      tags: ['英式', '低碳酸', '果酯'], conf: 'B',
      eff: 74, temp: 19, carb: 1.9,
      /* 2026 收口：原 0.25kg c60 把 FG 抬到 1.013（上界 1.012）。结晶减到 0.1kg，
         基麦与巧克力不动（巧克力只留 0.05 的上色量），FG 落回 1.011；
         酒体变干之后苦度要跟上，60 分钟 EKG 30→33g，IBU 25.4→27.9。 */
      malts: [['m-marisotter', 3.6], ['m-c60', 0.1], ['m-chocolate', 0.05]],
      hops: [['h-ekg', 33, 'boil', 60], ['h-ekg', 15, 'boil', 15]],
      yeast: ['y-s04', 12], att: 75,
      notes: '碳酸要低（1.5–2.0 vol），温度 11–13°C 饮用。碳酸过高就毁了。'
    },
    {
      id: 'c-english-ipa', name: '英式 IPA · 为长途运输而生', en: 'English IPA',
      styleId: '12C', country: '英国', brewery: '历史风格复原', year: 1800,
      story: 'IPA 的"印度"来自 18 世纪末向印度出口的需求：高酒花、高浓度、长时间桶陈，' +
             '让酒能熬过六个月的航程。它比美式 IPA 更麦芽、更干、酒花更"土"。' +
             '伯顿的高硫酸盐水质是它的历史特征。',
      tags: ['英式', '高硫酸盐', '历史'], conf: 'B',
      eff: 74, temp: 19, carb: 2.0,
      malts: [['m-marisotter', 4.6], ['m-c40', 0.3]],
      hops: [['h-target', 35, 'boil', 60], ['h-ekg', 25, 'boil', 20], ['h-ekg', 20, 'dryhop', 0]],
      yeast: ['y-s04', 13], att: 76,
      water: { ca: 200, mg: 20, na: 25, cl: 40, so4: 250, hco3: 120 },
      notes: '目标 IBU 52–58。麦芽骨架要够，不能只剩酒花。'
    },
    {
      id: 'c-english-porter', name: '英式波特 · 伦敦的黑色血液', en: 'English Porter',
      styleId: '13C', country: '英国', brewery: "Fuller's London Porter", year: 1845,
      story: '波特在 18 世纪伦敦工人中流行，名字据说来自"河岸搬运工（porter）"最爱喝。' +
             '棕色麦芽（Brown Malt）是它的历史特征——那种干爽的烤面包与可可味，' +
             '用普通的巧克力麦芽替代不出来。',
      tags: ['英式', '棕色麦芽', '历史'], conf: 'B',
      eff: 74, temp: 19, carb: 2.2,
      /* 2026 收口：原 3.4 / 0.5 / 0.3 / 0.15 实算 FG 1.015（上界 1.014）。
         结晶砍半（0.3→0.15）换成棕色麦芽（0.5→0.6）——颜色由棕色麦芽扛，
         而它的可发酵性比结晶高、对 FG 的压力小。实算 1.0452 / 1.0132。 */
      malts: [['m-marisotter', 3.1], ['m-brown', 0.6], ['m-c60', 0.15], ['m-chocolate', 0.15]],
      hops: [['h-ekg', 35, 'boil', 60], ['h-ekg', 12, 'boil', 15]],
      yeast: ['y-s04', 12], att: 74,
      notes: '棕色麦芽是灵魂，别省。目标 SRM 20–27，但不能有灰烬般的焦苦。'
    },
    {
      id: 'c-irish-stout', name: '爱尔兰世涛 · 黑而轻', en: 'Irish Stout · Guinness',
      styleId: '15B', country: '爱尔兰', brewery: 'Guinness 风格', year: 1759,
      story: 'Guinness 在 1759 年签下都柏林 St. James\'s Gate 酒厂 9000 年的租约。' +
             '爱尔兰世涛最大的反直觉之处是：它看起来浓黑，酒体却轻盈、收口干脆，' +
             '因为用的是**未发芽烘烤大麦**而不是大量黑麦芽。',
      tags: ['世涛', '烘烤大麦', '干爽'], conf: 'A',
      eff: 76, temp: 19, carb: 1.8,
      /* 2026 收口：原 0.4kg 烘烤大麦 + 0.15kg 巧克力实算 FG 1.0118，超 15B 上界
         （1.011）；本模型里烘烤类的 40% 可发酵度会同时顶高色度与残糖，
         而 15B 的色度下限 25 SRM 又要求足够的烘烤投放，只能两头挤：
         巧克力减到 0.05、烘烤大麦加到 0.45（保住 26.8 SRM），
         表观衰减 78→80（这支酒本来就是 65°C 糖化、收口干净的干世涛）。 */
      malts: [['m-marisotter', 2.6], ['m-flakedbarley', 0.45], ['m-roastedbarley', 0.45], ['m-chocolate', 0.05]],
      hops: [['h-ekg', 38, 'boil', 60]],
      yeast: ['y-s04', 12], att: 80,
      water: { ca: 120, mg: 4, na: 12, cl: 19, so4: 55, hco3: 320 },
      notes: '高碱度水 + 大量烘烤大麦是历史组合。碳酸很低（1.6–2.0），氮气版本口感更柔。'
    },
    {
      id: 'c-milk-stout', name: '牛奶世涛 · 乳糖的甜', en: 'Milk Stout · Left Hand',
      styleId: '16A', country: '美国', brewery: 'Left Hand Brewing', year: 2001,
      story: '牛奶世涛源于 19 世纪末英国的"滋补世涛"（当时乳糖被认为有营养）。' +
             '乳糖不被酿酒酵母发酵，全部残留成甜味与酒体——它把世涛从"干苦"变成"甜润"。',
      tags: ['世涛', '乳糖', '甜'], conf: 'B',
      eff: 74, temp: 19, carb: 2.0,
      /* 2026 收口（重配）：原 0.45kg 乳糖实算 FG 1.027，超 16A 上界（1.024）
         0.003；同时 32g EKG 只有 19.8 IBU，差下限 0.2。乳糖是这支酒的身份，
         不能删，只能减：0.45→0.25kg（12.5 g/L，甜感仍在）保住 1.023 的收口，
         苦花同步加到 45g 得 28.5 IBU —— 正好落在说明里写的 25–35 档。 */
      malts: [['m-marisotter', 3.2], ['m-flakedoats', 0.4], ['m-c80', 0.3], ['m-chocolate', 0.3], ['m-roastedbarley', 0.2], ['m-lactose', 0.25]],
      hops: [['h-ekg', 45, 'boil', 60]],
      yeast: ['y-s04', 12], att: 70,
      notes: '乳糖让 FG 停在 1.020 以上，所以苦味必须够（25–35 IBU），否则像巧克力奶。'
    },
    {
      id: 'c-oatmeal-stout', name: '燕麦世涛 · 丝滑的泡沫', en: 'Oatmeal Stout · Samuel Smith',
      styleId: '16B', country: '英国', brewery: 'Samuel Smith 风格', year: 1890,
      story: '燕麦世涛在 19 世纪末作为"营养啤酒"流行，后来一度消失，' +
             '1980 年代由英国 Samuel Smith 复刻而复兴。燕麦的 β-葡聚糖带来独特的油润口感与绵密泡沫。',
      tags: ['世涛', '燕麦', '丝滑'], conf: 'B',
      eff: 72, temp: 19, carb: 2.1,
      malts: [['m-marisotter', 3.3], ['m-flakedoats', 0.7], ['m-c60', 0.35], ['m-chocolate', 0.28]],
      /* v1.4 调：EKG 34→39g。原 22 IBU 低于 16B 下限 25（-12%）。 */
      hops: [['h-ekg', 39, 'boil', 60]],
      yeast: ['y-s04', 12], att: 74,
      notes: '燕麦超过 20% 必须加稻壳，否则滤槽会堵。'
    },
    {
      id: 'c-wee-heavy', name: '苏格兰重艾 · 焦糖化的力量', en: 'Wee Heavy / Scotch Ale',
      styleId: '17C', country: '苏格兰', brewery: 'Traquair House 风格', year: 1960,
      story: '苏格兰艾尔的"重"来自长时间煮沸：传统上把第一道麦汁单独熬煮数小时，' +
             '让糖分焦糖化，得到深色、浓稠、带干果香的酒体。苦味刻意压得很低。',
      tags: ['苏格兰', '长煮沸', '低苦'], conf: 'B',
      eff: 68, temp: 18, carb: 1.9, boil: 120,
      /* v1.4 调：5.78kg → 7.18kg。原 OG 1.062（17C 下限 1.07，差 8 个比重分），
         ABV 5.64% 比下限 6.5% 低 13%——这个浓度做不出 Wee Heavy 的厚实感。
         酒花同时 25→32g（浓度上去后利用率下降，苦度会掉到区间外）。 */
      malts: [['m-marisotter', 6.5], ['m-c80', 0.6], ['m-roastedbarley', 0.08]],
      hops: [['h-ekg', 32, 'boil', 60]],
      yeast: ['y-s04', 14], att: 70,
      notes: '煮沸 120 分钟浓缩出焦糖感。苦味低（17–25 IBU），甜度高但不该腻。'
    },
    {
      id: 'c-english-barleywine', name: '英式大麦酒 · 麦芽的极致', en: 'English Barleywine',
      styleId: '17D', country: '英国', brewery: "Fuller's Golden Pride", year: 1968,
      story: '大麦酒是英国最强的艾尔之一，麦芽主导、酒花只做支撑（与美国大麦酒相反）。' +
             '它需要数月到数年的熟成，氧化带来的干果与雪利感是特征而非缺陷。',
      tags: ['大麦酒', '高浓度', '陈年'], conf: 'B',
      eff: 65, temp: 18, carb: 1.9, boil: 120,
      /* v1.4 调：麦量 7.8kg → 8.2kg、att 68→74。原 OG 1.080 正好压在下限上、
         att 68 让 ABV 只有 7.42%（17D 下限 8%）。英式菌株（S-04/1098 一类）
         在 1.08 麦汁上做足充氧与扩培能到 74%，FG 1.024 仍在 1.018–1.03 内。 */
      malts: [['m-marisotter', 7.2], ['m-munich', 0.6], ['m-c60', 0.4]],
      hops: [['h-target', 45, 'boil', 120], ['h-ekg', 20, 'boil', 30]],
      yeast: ['y-s04', 18], att: 74,
      notes: 'OG 1.084 必须做酵母扩培与两次充氧，否则收不了尾。至少熟成 3 个月。' +
             ' 衰减说明：att 74% 是按英式菌株（S-04 一类）在 1.08 麦汁上做足充氧与扩培后的实际衰减取的，不是保守值；' +
             'FG 1.024 仍在 17D 区间内，酒体依然偏甜。'
    },

    /* ---------------- 美式艾尔 ---------------- */
    {
      id: 'c-apa', name: '美式淡色艾尔 · 精酿的起点', en: 'American Pale Ale · Sierra Nevada',
      styleId: '18B', country: '美国', brewery: 'Sierra Nevada Pale Ale', year: 1980,
      story: '1980 年 Sierra Nevada 用 Cascade 酒花做出这款酒，' +
             '第一次让美国消费者尝到"葡萄柚般的酒花香"。它被广泛认为是美式精酿的起点，' +
             'Cascade 也因此成为最具标志性的美式酒花。',
      tags: ['美式', 'Cascade', '标杆'], conf: 'A',
      eff: 74, temp: 19, carb: 2.5,
      malts: [['m-2row', 4.2], ['m-c60', 0.35]],
      hops: [['h-cascade', 28, 'boil', 60], ['h-cascade', 30, 'boil', 10], ['h-cascade', 40, 'dryhop', 0]],
      yeast: ['y-us05', 12], att: 78,
      notes: '经典配置：Cascade 三段投。目标 IBU 30–33，SRM 8 上下。'
    },
    {
      id: 'c-california-common', name: '加州蒸汽啤酒 · 拉格酵母的温暖发酵', en: 'California Common · Anchor Steam',
      styleId: '19B', country: '美国', brewery: 'Anchor Brewing', year: 1896,
      story: '"蒸汽啤酒"得名于 19 世纪旧金山的做法：用浅盘开放式冷却，' +
             '发酵时表面冒出蒸汽般的白雾。它用拉格酵母在 15–20°C 发酵——' +
             '这在没有制冷的年代是唯一可行的选择，却意外造就了独特的微果酯。',
      tags: ['拉格酵母', '温暖发酵', '历史'], conf: 'B',
      eff: 74, temp: 17, carb: 2.4,
      malts: [['m-2row', 3.6], ['m-c60', 0.4], ['m-munich', 0.3]],
      hops: [['h-northernbrewer', 32, 'boil', 60], ['h-northernbrewer', 15, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 76,
      notes: '关键：拉格酵母 + 17°C。温度再高会出明显酯香，那就不是这个风格了。'
    },
    {
      id: 'c-american-porter', name: '美式波特 · 比英式更放肆', en: 'American Porter · Black Butte',
      styleId: '20A', country: '美国', brewery: 'Deschutes Black Butte', year: 1988,
      story: '美式波特把英式波特的酒体做厚、酒花做重，' +
             '烘烤麦芽与柑橘酒花同时存在。这种"又黑又香"的组合在 1990 年代成为美式精酿的标志之一。',
      tags: ['波特', '美式', '酒花'], conf: 'B',
      eff: 72, temp: 19, carb: 2.3,
      malts: [['m-2row', 3.2], ['m-munich', 0.7], ['m-c60', 0.4], ['m-chocolate', 0.3], ['m-roastedbarley', 0.15]],
      hops: [['h-cascade', 30, 'boil', 60], ['h-cascade', 20, 'whirlpool', 15, 85]],
      yeast: ['y-us05', 12], att: 76,
      notes: '比英式波特多一层酒花。目标 IBU 26–30。'
    },
    {
      id: 'c-imperial-stout', name: '帝国世涛 · 最强的啤酒之一', en: 'Imperial Stout · Old Rasutin 风格',
      styleId: '20C', country: '英国/美国', brewery: '历史风格复原', year: 1800,
      story: '帝国世涛最初是 18 世纪英国为俄国宫廷酿的高浓度世涛，' +
             '高酒精与高酒花让它能熬过波罗的海的运输。现代版本由美式精酿发扬，' +
             '并衍生出过桶、加咖啡与巧克力的变体。',
      tags: ['世涛', '高浓度', '陈年'], conf: 'B',
      eff: 65, temp: 18, carb: 2.2, boil: 90,
      /* v1.4 调（四处一起，否则调一个撞一个）：
         · 麦量 7.55kg → 9.6kg：原来 OG 1.078 / ABV 6.96%，比 20C 的 ABV 下限 8% 低 13%，
           那条 notes 自己写的是"OG 1.095+"，数据没跟上；
         · att 70→76：US-05 在 1.095 麦汁上做足充氧能到 76%，FG 才落进 1.018–1.03；
         · 酒花 55g+25g → 40g+20g：原配 55g 哥伦布（AA 15.5%）在 20L 里算出来 108 IBU，
           比 20C 上限 90 高 20%；
         · 深色麦芽同时压比例（chocolate 0.4→0.35、roasted 0.3→0.2）：
           麦量涨 27% 之后颜色会跟着涨，不改就会从 40 SRM 冲到 47。 */
      malts: [['m-marisotter', 7.4], ['m-munich', 1.2], ['m-c80', 0.45], ['m-chocolate', 0.35], ['m-roastedbarley', 0.2]],
      hops: [['h-columbus', 40, 'boil', 90], ['h-cascade', 20, 'boil', 20]],
      yeast: ['y-us05', 20], att: 76,
      notes: 'OG 1.095+，需要 20g 以上干酵母或扩培。至少熟成 2 个月，酒精感才会融合。'
    },

    /* ---------------- IPA ---------------- */
    {
      id: 'c-west-coast-ipa', name: '西海岸 IPA · 柑橘与松针', en: 'West Coast IPA',
      styleId: '21A', country: '美国', brewery: '西海岸风格', year: 1990,
      story: '西海岸 IPA 在 1990 年代定型：高苦度、极干收口、大量美式柑橘酒花，' +
             '加上高硫酸盐水质让苦味"脆"起来。它和美式淡艾的差距不只是酒花量，' +
             '还有"干"这个字。',
      tags: ['IPA', '干爽', '高硫酸盐'], conf: 'B',
      eff: 72, temp: 19, carb: 2.5,
      /* 2026 收口（重配）：原 35g 马格努姆算得 73 IBU（21A 上限 70），FG 1.0142
         也压在上界外。苦花减到 29g —— 后段 centennial / citra / mosaic 的量
         一点没动，香气结构不变，这款酒的"苦"本来就该来自 40–70 这一段而不是 73；
         结晶 0.2→0.15、慕尼黑 0.4→0.45 补回色度（6.5 SRM），
         表观衰减 79→80（低糖化温度、干爽收口是西海岸的骨架）。
         现算：OG 1.0624 / FG 1.0133 / 65.0 IBU。 */
      malts: [['m-2row', 5.0], ['m-munich', 0.45], ['m-c40', 0.15]],
      hops: [['h-magnum-de', 29, 'boil', 60], ['h-centennial', 25, 'boil', 15],
             ['h-citra', 30, 'whirlpool', 20, 85], ['h-citra', 50, 'dryhop', 0],
             ['h-mosaic', 40, 'dryhop', 0]],
      yeast: ['y-us05', 13], att: 80,
      water: { ca: 60, mg: 10, na: 30, cl: 50, so4: 180, hco3: 60 },
      salts: [['w-gypsum', 5], ['w-cacl2', 1]],
      notes: 'FG 必须低于 1.014，否则"甜"会压住酒花。硫酸盐 150–250 是甜点区。' +
             ' 苦度说明：本库唯一口径是 Tinseth，29g 马格努姆 + 25g 世纪算得 65 IBU，' +
             '落在 21A 的 40–70 区间内；换 Rager 会更高、Garetz 会更低，别拿别的模型反推这条配方。'
    },
    {
      id: 'c-neipa', name: '浑浊 IPA · 果汁般的柔和', en: 'Hazy IPA',
      styleId: '21C', country: '美国', brewery: 'Tree House / Trillium 风格', year: 2011,
      story: 'NEIPA 在 2010 年代初于美国东北部出现，核心不是"更香"，而是"更柔"：' +
             '几乎不煮沸投花、大量回旋与干投、高氯低硫的水、以及特意保留的蛋白质浑浊。' +
             '它把 IPA 从"苦"重新定义为"果汁感"。',
      tags: ['NEIPA', '浑浊', '高氯'], conf: 'B',
      eff: 72, temp: 19, carb: 2.4, mashTemp: 67,
      malts: [['m-2row', 4.8], ['m-flakedoats', 0.9], ['m-wheat', 0.6]],
      hops: [['h-columbus', 12, 'boil', 60],
             ['h-citra', 40, 'whirlpool', 20, 80], ['h-mosaic', 40, 'whirlpool', 20, 80],
             ['h-citra', 80, 'dryhop', 0], ['h-mosaic', 80, 'dryhop', 0]],
      yeast: ['y-verdant', 13], att: 80,
      water: { ca: 60, mg: 8, na: 30, cl: 150, so4: 50, hco3: 60 },
      salts: [['w-cacl2', 6], ['w-gypsum', 1]],
      notes: '氧化是最大敌人：干投后尽量少接触空气。浑浊来自蛋白质与酵母，别为了"清澈"冷降太久。'
    },
    {
      id: 'c-double-ipa', name: '双料 IPA · 酒花与酒精的双重冲击', en: 'Double IPA · Pliny the Elder',
      styleId: '22A', country: '美国', brewery: 'Russian River 风格', year: 2000,
      story: 'Pliny the Elder 被广泛认为是双料 IPA 的标杆：极高的酒花强度，' +
             '却靠加糖提干与足量酵母做到"烈而不腻"。它的配方公开过多个版本，' +
             '是少数有据可查的商业 IPA 配方之一。',
      tags: ['双料IPA', '高浓度', '干'], conf: 'A',
      eff: 70, temp: 19, carb: 2.5,
      malts: [['m-2row', 5.6], ['m-dextrose', 0.5], ['m-c40', 0.2]],
      /* v1.5 调（BJCP 2021 迁移）：22A 双料 IPA 的 IBU 上限从 120 收到 100。
         原配方的苦花（90min 哥伦布 45g + 30min 世纪 30g）算出 119.2 IBU，
         超出新上限 19 点。这里只减苦花：45→33g、30→26g（苦花总量 75→59g，−21%），
         算出 94.1 IBU，落在 60–100 内并留约 6 点余量。
         回旋（西姆科 35g）与干投（90g）**一克没动**——香气定位不变，
         这才是这套配方想表达的东西；苦度只是骨架。 */
      hops: [['h-columbus', 33, 'boil', 90], ['h-centennial', 26, 'boil', 30],
             ['h-simcoe', 35, 'whirlpool', 20, 85], ['h-columbus', 30, 'dryhop', 0],
             ['h-centennial', 30, 'dryhop', 0], ['h-simcoe', 30, 'dryhop', 0]],
      yeast: ['y-us05', 18], att: 82,
      water: { ca: 70, mg: 10, na: 30, cl: 55, so4: 200, hco3: 60 },
      notes: '加 0.5kg 葡萄糖把 FG 拉低，否则高浓度会让酒发甜。接种量要足。' +
             '苦花已按 2021 的 22A 上限（100 IBU）下调，Tinseth 口径算出 94 IBU；' +
             '想要更凶的版本，把 90 分钟哥伦布加回 45g 就回到 119，但那就不是 22A 了。'
    },
    {
      id: 'c-american-barleywine', name: '美式大麦酒 · 酒花主导的烈性艾尔', en: 'American Barleywine · Bigfoot',
      styleId: '22C', country: '美国', brewery: 'Sierra Nevada Bigfoot', year: 1983,
      story: '美式大麦酒与英式的关键区别是"酒花主导"：同样的高浓度，' +
             '但美式版本的 IBU 可以到 90 以上。Bigfoot 每年限量发售，' +
             '很多人会存几年再喝，看它从"凶"变"柔"。',
      tags: ['大麦酒', '酒花', '陈年'], conf: 'B',
      eff: 65, temp: 18, carb: 2.1, boil: 90,
      /* 2026 收口（重配）：原 6.6kg 实算 OG 1.0795 —— 差 22C 下限 1.080 一步、
         ABV 7.82% 差 8% 一步，而 60g 90 分钟 chinook 算得 100.9 IBU，压在上限 100 之外。
         三处一起动：基麦 6.6→6.85kg 把 OG 抬到 1.082（ABV 8.11%）；
         苦花 60→55g 得 92.2 IBU（40% 来自 90 分钟，后段与干投不动）。
         说明里"OG 1.095+"原来与数据对不上，一并改成 1.08 档的实话。 */
      malts: [['m-2row', 6.85], ['m-munich', 0.8], ['m-c60', 0.4]],
      hops: [['h-chinook', 55, 'boil', 90], ['h-cascade', 30, 'boil', 30], ['h-cascade', 25, 'dryhop', 0]],
      yeast: ['y-us05', 20], att: 72,
      notes: 'OG 1.082 属于 22C 的下缘，ABV 8.1%：仍要扩培（20g 干酵母起步）与两次充氧。' +
             '新鲜时酒花凶，存半年后更平衡。'
    },

    /* ---------------- 比利时 ---------------- */
    {
      id: 'c-witbier', name: '比利时白啤 · 橙皮与芫荽', en: 'Witbier · Hoegaarden',
      styleId: '24A', country: '比利时', brewery: 'Hoegaarden 风格', year: 1445,
      story: 'Hoegaarden 村在 15 世纪就开始用橙皮与芫荽酿小麦啤酒，' +
             '20 世纪中一度绝迹，1966 年由 Pierre Celis 在自家谷仓复刻而重生。' +
             '他的版本直接催生了现代 Witbier 这个风格。',
      tags: ['小麦', '香料', '浑浊'], conf: 'A',
      eff: 74, temp: 20, carb: 3.0,
      /* 2026 收口（重配）：2.2kg 皮尔森 + 1.4kg 未发芽小麦实算只有 1.043 / 4.34%，
         OG 差 24A 下限 0.001、ABV 差 0.16。整体抬 0.3kg（皮尔森 +0.2、小麦 +0.1），
         保持"皮尔森 60% / 未发芽小麦 40%"的原比例，实算 1.0466 / 4.71%。 */
      malts: [['m-pilsner', 2.4], ['m-unmaltedwheat', 1.5], ['m-flakedoats', 0.25]],
      mash: [['蛋白质休止', 45, 15], ['糖化', 66, 60], ['出糖', 76, 10]],
      hops: [['h-hallertau', 20, 'boil', 60]],
      yeast: ['y-wlp400', 12], att: 76,
      adj: [['a-coriander', 10], ['a-orangepeel', 20]],
      notes: '香料在回旋阶段加，别煮沸太久否则香气跑光。芫荽要轻压碎。'
    },
    {
      id: 'c-saison', name: '赛松 · 农舍的干爽', en: 'Saison · Saison Dupont',
      styleId: '25B', country: '比利时', brewery: 'Brasserie Dupont', year: 1844,
      story: '赛松原本是比利时南部农舍在冬季酿、夏季给农工解渴的酒，' +
             '所以必须"干"且耐放。Dupont 的版本被公认为标杆：' +
             '胡椒般的辛香、极高的碳酸、干到几乎无糖。',
      tags: ['赛松', '干爽', '高碳酸'], conf: 'A',
      eff: 72, temp: 24, carb: 3.2, mashTemp: 63,
      /* v1.4 调：加 0.3kg c20 提色（原 3.5 SRM 低于 25B 下限 5）、
         EKG 22→28g 提苦（原 17.5 IBU 低于下限 20）。
         赛松的骨架仍是皮尔森+小麦，结晶麦芽只占 6%，只负责把颜色拉进"金到琥珀"那一档。 */
      malts: [['m-pilsner', 4.2], ['m-wheat', 0.4], ['m-c20', 0.3]],
      hops: [['h-ekg', 28, 'boil', 60], ['h-saaz', 25, 'whirlpool', 20, 85]],
      yeast: ['y-bellesaison', 13], att: 90,
      notes: 'FG 必须低于 1.008——这是这个风格的生命线。发酵可以放任升温到 26–28°C。'
    },
    {
      id: 'c-belgian-golden', name: '比利时金色烈性 · 魔鬼的酒', en: 'Belgian Golden Strong · Duvel',
      styleId: '25C', country: '比利时', brewery: 'Duvel 风格', year: 1871,
      story: 'Duvel 意为"魔鬼"，因为它的酒精度高却几乎感觉不到。' +
             '它的秘诀是大量加糖提干 + 高温发酵获取果酯，' +
             '让 8.5% 的酒喝起来像 6%。',
      tags: ['比利时', '高浓度', '干'], conf: 'B',
      eff: 70, temp: 22, carb: 3.4,
      malts: [['m-pilsner', 5.4], ['m-dextrose', 0.9]],
      /* v1.4 调：saaz 38→48g。原 18.5 IBU 比 25C 下限 22 低 16%；
         25C 的苦度下限是为了压住 9% 酒精的甜，苦味不够会显腻。 */
      hops: [['h-saaz', 48, 'boil', 60], ['h-saaz', 18, 'boil', 15]],
      yeast: ['y-abbaye', 16], att: 88,
      notes: '加糖 12–15% 提干是核心。碳酸要高（3.2–3.6），否则显得扁平。'
    },
    {
      id: 'c-dubbel', name: '比利时双料 · 深色果干', en: 'Belgian Dubbel · Westmalle',
      styleId: '26B', country: '比利时', brewery: 'Westmalle 风格', year: 1856,
      story: 'Westmalle 修道院在 1856 年把这款深色艾尔定为"双料"，' +
             '成为修道院啤酒分级（单料/双料/三料）的源头之一。' +
             '深色糖浆带来的葡萄干与李子味是它的标志。',
      tags: ['修道院', '深色', '糖浆'], conf: 'B',
      eff: 72, temp: 20, carb: 2.8,
      malts: [['m-pilsner', 4.7], ['m-munich', 0.9], ['m-specialb', 0.15], ['m-candid180', 0.2]],
      hops: [['h-hallertau', 30, 'boil', 60]],
      yeast: ['y-abbaye', 14], att: 78,
      notes: '深色糖浆在煮沸末加。苦味刻意低（15–22），靠发酵控制平衡。'
    },
    {
      id: 'c-tripel', name: '比利时三料 · 金色与辛辣', en: 'Belgian Tripel · Westmalle',
      styleId: '26C', country: '比利时', brewery: 'Westmalle 风格', year: 1934,
      story: 'Westmalle 在 1934 年推出三料，把浓度再推高一档。' +
             '"三料"指的是糖化时用的麦芽量（相对单料），不是三次发酵。' +
             '它的酚香（丁香、胡椒）与高酒精度是修道院风格的"力量型"。',
      tags: ['修道院', '高浓度', '酚香'], conf: 'B',
      eff: 70, temp: 21, carb: 3.2,
      /* v1.4 调：加 0.12kg c20。三料靠糖提干、糖不带色，原色度 4.0 SRM 低于 26C 下限 4.5。 */
      malts: [['m-pilsner', 5.6], ['m-dextrose', 0.8], ['m-c20', 0.12]],
      hops: [['h-hallertau', 40, 'boil', 60], ['h-hallertau', 14, 'boil', 15]],
      yeast: ['y-abbaye', 16], att: 86,
      notes: '加糖提干 + 高温发酵。酒精度高但必须易饮，酒精刺鼻就是失败。' +
             ' 余量提示：SRM 4.6 只比 26C 下限 4.5 高 0.1，那 0.12kg c20 已经是最小有效量，' +
             '再减就掉出区间；要加深可以加，别往回减。'
    },
    {
      id: 'c-quadrupel', name: '比利时四料 · 修道院的顶点', en: 'Belgian Dark Strong / Quadrupel',
      styleId: '26D', country: '比利时', brewery: 'Westvleteren / Rochefort 风格', year: 1940,
      story: '四料是修道院风格里最浓的一档：深色、复杂果香、酒精度 10% 以上。' +
             'Westvleteren XII 与 Rochefort 10 被反复评为世界最佳啤酒，' +
             '它们的共同点是"浓而不燥"——酒精被麦芽与果酯完全包裹。',
      tags: ['修道院', '极浓', '陈年'], conf: 'B',
      eff: 65, temp: 20, carb: 2.8, boil: 90,
      /* 2026 收口：原 5.7kg 皮尔森实算 OG 1.0739，差 26D 下限 0.0011；ABV 8.05%
         也贴在下限上。皮尔森 5.7→6.0kg 抬到 1.0769 / 8.43%，
         苦花 40→43g 把 IBU 从 20.6 拉到 22.2（下限 20，别贴着）。
         说明里"OG 1.095+"与数据不符，改成实话。 */
      malts: [['m-pilsner', 6.0], ['m-munich', 1.0], ['m-specialb', 0.25], ['m-candid180', 0.3]],
      hops: [['h-hallertau', 43, 'boil', 90]],
      yeast: ['y-abbaye', 20], att: 80,
      notes: 'OG 1.077 是 26D 的下缘（修道院四料多在 1.090 以上），必须扩培。' +
             '至少熟成 3 个月，半年后风味才真正打开。'
    },

    /* ---------------- 酸啤与特色 ---------------- */
    {
      id: 'c-berliner', name: '柏林白啤 · 极低酒精的酸', en: 'Berliner Weisse',
      styleId: '23A', country: '德国', brewery: '历史风格复原', year: 1800,
      story: '柏林白啤在 19 世纪是柏林最流行的啤酒，日销量以百万升计。' +
             '它酒精度只有 3% 左右、极酸、碳酸极高，传统上会加木莓或车叶草糖浆中和酸度。' +
             '现代精酿把它从"柏林限定"变成了全球风格。',
      tags: ['酸啤', '低酒精', '乳酸'], conf: 'B',
      eff: 72, temp: 20, carb: 3.4, mashTemp: 65,
      /* 2026 收口：皮尔森 + 小麦全是可发酵谷物，80% 衰减下 1.030 的麦汁必然收到
         1.0060 —— 正压 23A 的 FG 上界（1.006），一点余量都没有。这支酒本来就该
         "酸到干"：Philly Sour 的乳酸菌会把可发酵糖吃得更彻底，衰减按 82 记，
         FG 落到 1.0054，OG / IBU / 色度全不动。 */
      malts: [['m-pilsner', 1.5], ['m-wheat', 1.2]],
      hops: [['h-hallertau', 8, 'boil', 30]],
      yeast: ['y-phillysour', 11], att: 82,
      notes: 'IBU 必须低于 10，否则乳酸菌被抑制。用 Philly Sour 可一株完成发酵与酸化。'
    },
    {
      id: 'c-gose', name: '戈斯 · 酸与咸的平衡', en: 'Gose',
      styleId: '23G', country: '德国', brewery: '历史风格复原', year: 1738,
      story: '戈斯来自德国 Goslar 附近，因当地高矿化水源而带天然咸味。' +
             '它一度几乎消失，2010 年代被美式精酿重新发掘，' +
             '现在常见的版本会加芫荽与海盐。',
      tags: ['酸啤', '咸', '芫荽'], conf: 'B',
      eff: 72, temp: 20, carb: 3.2,
      /* 2026 收口：10g 哈勒道 30 分钟只算 4.7 IBU，差 23G 下限 0.3。
         加到 13g 得 6.1 —— 仍是最低档的苦度，戈斯的苦味本来就只是乳酸之外的骨架。 */
      malts: [['m-pilsner', 2.2], ['m-wheat', 1.4]],
      hops: [['h-hallertau', 13, 'boil', 30]],
      yeast: ['y-phillysour', 11], att: 80,
      adj: [['a-coriander', 8]],
      notes: '盐在装瓶前按口味加（约 0.5–1 g/L），不要一开始就加足。'
    },

    /* ---------------- 野菌与过桶 ---------------- */
    {
      id: 'c-brett', name: '布雷特艾尔 · 干净的热带果香', en: 'Brett Beer',
      styleId: '28A', country: '比利时/美国', brewery: 'Orval 启发', year: 1931,
      story: 'Orval 是少数在装瓶时加入布雷特酵母的修道院酒，' +
             '干投的 Styrian 酒花与布雷特的果香形成独特组合。' +
             '现代美式版本更常用 B. bruxellensis Trois（不产马厩味）做出干净的热带果香。',
      tags: ['布雷特', '野菌', '干投'], conf: 'B',
      eff: 72, temp: 21, carb: 2.9,
      malts: [['m-pilsner', 4.0], ['m-munich', 0.5], ['m-c20', 0.2]],
      hops: [['h-styrian', 25, 'boil', 60], ['h-styrian', 20, 'dryhop', 0]],
      yeast: ['y-wlp644', 12], att: 85,
      notes: '布雷特发酵慢，FG 会继续下降，装瓶前必须确认比重稳定（建议观察 2 周）。'
    },
    {
      id: 'c-wood-aged', name: '过桶世涛 · 橡木与烈酒', en: 'Wood-Aged Imperial Stout',
      styleId: '33A', country: '美国', brewery: 'Bourbon County 风格', year: 1992,
      story: '过桶世涛在 1990 年代由美式精酿开创：把帝国世涛放进波本威士忌桶陈数月，' +
             '获得香草、椰子、焦糖与烈酒感。它的出现改变了人们对"啤酒能不能陈年"的看法。',
      tags: ['过桶', '帝国世涛', '陈年'], conf: 'B',
      eff: 65, temp: 18, carb: 2.0, boil: 90,
      /* 2026 收口：原配方实算 31.3 SRM，超 33A 上限（30）——本库自定的窗口只到 30，
         而巧克力 0.25kg 把它顶了出去。巧克力减到 0.15kg，实算 27.5 SRM，
         烘烤大麦照旧 0.2kg：这支酒的深色骨架来自烘烤大麦与结晶，不是巧克力。 */
      malts: [['m-marisotter', 5.0], ['m-munich', 0.8], ['m-c80', 0.4], ['m-chocolate', 0.15], ['m-roastedbarley', 0.2]],
      hops: [['h-columbus', 32, 'boil', 90]],
      yeast: ['y-us05', 20], att: 74,
      adj: [['a-oakchips', 50]],
      notes: '橡木片用重度烘烤，接触 7–14 天。时间比用量更重要——超过 14 天会变木屑水。'
    },

    /* ---------------- v1.3 补齐：拉格与欧陆经典 ---------------- */
    {
      id: 'c-american-light', name: '美式淡爽拉格 · 冰镇畅饮', en: 'American Light Lager',
      styleId: '1A', country: '美国', brewery: '风格基准（家酿复原）', era: 'modern', conf: 'B',
      story: '美式淡爽拉格是"辅料拉格"的极致：用大米或玉米把麦芽味压到最低，追求冰镇后的干净与解渴。' +
             '它不是"劣质啤酒"，而是对"越淡越难酿"这件事的挑战——任何一点发酵缺陷都藏不住。',
      tags: ['拉格', '辅料', '清爽'], eff: 76, temp: 12, mashTemp: 65, carb: 2.7,
      /* 2026 收口（重配）：2.4kg 二棱 + 0.9kg 大米在 84% 衰减下算得 OG 1.039 /
         ABV 4.29%，两项都在 1A 上限之外（1.040 / 4.2%）。1A 是全库最窄的一档，
         减 0.25kg 基麦得到 1.0361 / 3.95%；苦花同步 11.5→11g（10.7 IBU），
         保持"麦芽与苦味都恰到好处地少"这件事。 */
      malts: [['m-2row', 2.15], ['m-flakedrice', 0.9]],
      /* v1.5 调：1A 的 IBU 区间从 8–18 收到 8–12 之后，原来的 14g Cluster（13.4 IBU）
         正好落在窗口外——被 2 IBU 的判定容差盖住了，界面不变红，但"美式淡爽拉格"的
         标杆苦度不在这个风格里，迟早被当成 bug。
         减到 11.5g → Tinseth 11.0 IBU（窗口 8–12 的中段偏上，离上限留 1 点）。
         不压到 12：贴边的配方下一次任何改动都会再掉出去。
         只有一次苦花，没有香气投花/干投，所以这次调整不触碰风味定位。 */
      hops: [['h-cluster', 11, 'boil', 60]],
      yeast: ['y-w3470', 22], att: 84,
      notes: '全部功夫在控温与卫生：12°C 主酵、后熟 2 周。1.040 以下的酒没有味道可以掩盖缺陷。'
    },
    {
      id: 'c-intl-pale-lager', name: '国际淡色拉格 · 超市货架的另一端', en: 'International Pale Lager',
      styleId: '2A', country: '国际', brewery: '风格基准（家酿复原）', era: 'modern', conf: 'B',
      story: '这个风格描述的是全球最常见的商业拉格：比美式淡爽多一点麦香与苦味，但仍以"谁都喝得下"为目标。' +
             '它在家酿里的意义是练手——配方极简，全靠工艺。',
      tags: ['拉格', '易饮', '练手'], eff: 75, temp: 12, mashTemp: 66, carb: 2.6,
      /* v1.4 调：去掉 0.3kg c10、改成二棱+大米。2A 的颜色区间只有 2–3 SRM，
         0.3kg c10 就能把它顶到 4.2 SRM（+40%）。商业版国际淡色拉格普遍用 30–40% 大米/玉米
         稀释麦芽色与风味，这里的 38% 大米正是那个路子，不是凑数。 */
      malts: [['m-2row', 2.4], ['m-flakedrice', 1.5]],
      hops: [['h-magnum-us', 12, 'boil', 60], ['h-hallertau', 10, 'boil', 10]],
      yeast: ['y-w3470', 22], att: 80,
      notes: '一发结束做 2 周低温后熟（0–2°C），硫味会明显变干净。'
    },
    {
      id: 'c-czech-pale', name: '捷克优质淡色拉格 · 皮尔森的源头', en: 'Czech Premium Pale Lager',
      /* v1.5 改标：这条配方是 4.2kg 皮尔森麦芽 + 萨兹两次投、OG 1.049 / 5.0% ABV，
         内容就是 3B（捷克优质淡色拉格），不是 3A（1.028–1.044 / 3.0–4.1% 的
         session 档）。2021 把 3A 的窗口改小之后它掉出 3A，正确的处理是改标而不是
         减 19% 麦芽——减麦会把这个酒改成另一个东西。
         代价：3A 暂时没有经典配方，3B 有两条（另一条是 c-pilsner-urquell）。
         补一条真正的 3A（10–12°P 的日常捷克淡色拉格）已记进 docs/05 待办。 */
      styleId: '3B', country: '捷克', brewery: 'Plzeňský Prazdroj 风格', year: 1842,
      story: '1842 年皮尔森的下层发酵淡色啤酒改变了整个啤酒史：浅色麦芽、软水、萨兹酒花与低温拉格酵母，' +
             '第一次把"清爽"和"有味道"放在同一杯里。',
      tags: ['拉格', '萨兹', '皮尔森'], eff: 72, temp: 11, mashTemp: 64, carb: 2.5,
      /* 2026 收口：4.2kg 皮尔森 + 0.2kg 泡沫麦芽在本模型里只算到 3.4 SRM，
         差 3B 下限 0.1。加 0.1 kg 浅慕尼黑补到 3.7 —— 换来的那点面包皮，
         正是真实煮出糖化会给这支酒加上的东西（模型不含煮出）。 */
      malts: [['m-pilsner', 4.2], ['m-carapils', 0.2], ['m-munich', 0.1]],
      hops: [['h-saaz', 60, 'boil', 60], ['h-saaz', 20, 'boil', 10]],
      yeast: ['y-w3470', 22], att: 78,
      notes: '软水是关键（HCO₃⁻ 低）。萨兹分两次投，后段留住那点草药与香料感。' +
             ' 那 0.1 kg 浅慕尼黑同样只为补色（模型不算煮出糖化的加深），别把它当风味配方的一部分。'
    },
    {
      id: 'c-festbier', name: '三月节啤酒 · 慕尼黑的秋日', en: 'Festbier',
      styleId: '4B', country: '德国', brewery: '慕尼黑六大厂风格', year: 1990,
      story: 'Festbier 是慕尼黑十月节现在主要供应的淡色版本（深色版本叫 Märzen）。' +
             '它比日常拉格更饱满、酒精度更高，但仍要在帐篷里连喝一升——平衡比浓烈更难。',
      tags: ['拉格', '慕尼黑', '麦香'], eff: 73, temp: 11, mashTemp: 65, carb: 2.6,
      malts: [['m-pilsner', 2.6], ['m-vienna', 2.0], ['m-munich', 0.6]],
      hops: [['h-magnum-de', 15, 'boil', 60], ['h-hallertau', 12, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 78,
      notes: '维也纳麦芽给面包 crust 的香，慕尼黑给一点蜜甜。别用结晶麦芽，会腻。'
    },
    {
      id: 'c-vienna-lager', name: '维也纳拉格 · 琥珀色的红铜', en: 'Vienna Lager',
      styleId: '7A', country: '奥地利', brewery: '风格基准（家酿复原）', year: 1841,
      story: '维也纳麦芽在 19 世纪由 Anton Dreher 推广，这种浅色烘烤麦芽带来了红铜色与烤面包香。' +
             '今天这个风格在墨西哥保存得比在奥地利更好。',
      tags: ['拉格', '琥珀', '烤面包'], eff: 74, temp: 11, mashTemp: 65, carb: 2.5,
      /* v1.4 调：c40 0.2→0.35kg。原 8.1 SRM 比 7A 下限 9 低 10%。
         这样结晶麦芽总量约 8%，只补颜色，不靠它堆焦糖甜。 */
      malts: [['m-vienna', 3.2], ['m-munich', 0.9], ['m-c40', 0.35]],
      hops: [['h-perle', 20, 'boil', 60], ['h-hallertau', 10, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 78,
      notes: '目标不是"焦糖甜"，是"烤面包壳"。结晶麦芽超过 5% 就会跑偏成琥珀艾尔。'
    },

    /* ---------------- v1.3 补齐：英伦与美式艾尔 ---------------- */
    {
      id: 'c-english-golden', name: '英式金艾 · 好喝的日常', en: 'English Golden Ale',
      styleId: '12A', country: '英国', brewery: '风格基准（家酿复原）', era: 'modern', conf: 'B',
      story: '英式金艾是 1980 年代英国精酿对"拉格化"的回应：用英式麦芽与英式酒花，' +
             '做出比苦啤更清爽、比拉格更有性格的酒。它的全部难点是"没有难点"——干净、平衡、喝完还想再一杯。',
      tags: ['英式', '易饮', '金艾'], eff: 74, temp: 19, mashTemp: 66, carb: 2.3,
      /* 2026 收口：4.0kg 基麦 + 0.2kg c10 实算 FG 1.0127，超 12A 上界（1.012）。
         结晶是"不可发酵的甜"，减半到 0.1kg、基麦同步 4.0→3.75kg 把 FG 收到 1.0111，
         OG 1.0443 / 4.4% ABV 仍是这支酒"天天能喝"的档位。 */
      malts: [['m-marisotter', 3.75], ['m-c10', 0.1]],
      hops: [['h-ekg', 40, 'boil', 60], ['h-ekg', 15, 'boil', 10]],
      yeast: ['y-s04', 11], att: 76,
      notes: '英式酵母的酯香是这个风格的骨架，别为了"干净"降到 16°C 以下。'
    },
    {
      id: 'c-irish-red', name: '爱尔兰红艾 · 不是红色的世涛', en: 'Irish Red Ale',
      styleId: '15A', country: '爱尔兰', brewery: '风格基准（家酿复原）', era: 'modern', conf: 'B',
      story: '爱尔兰红艾常被误当成"淡版世涛"，其实它的烤麦芽用量只有世涛的零头：' +
             '红色来自少量烘烤大麦，苦味很轻，收口偏干而不是浓稠。',
      tags: ['爱尔兰', '红艾', '干爽'], eff: 75, temp: 19, mashTemp: 66, carb: 2.3,
      /* 2026 收口：3.9kg 基麦把 OG 顶到 1.0493，超 15A 上界（1.046）0.003。
         减 0.4kg 基麦 → 1.0447 / 1.0114 / 24.9 IBU，琥珀红与干爽收口都不变。 */
      malts: [['m-marisotter', 3.5], ['m-c60', 0.25], ['m-roastedbarley', 0.06]],
      hops: [['h-fuggle', 30, 'boil', 60], ['h-ekg', 15, 'boil', 20]],
      yeast: ['y-s04', 11], att: 78,
      notes: '烘烤大麦 60 g 就够上色，加到 150 g 就变干世涛了。'
    },
    {
      id: 'c-blonde-ale', name: '金发艾尔 · 家酿第一锅的标准答案', en: 'Blonde Ale',
      styleId: '18A', country: '美国', brewery: '风格基准（家酿复原）', era: 'modern', conf: 'B',
      story: '金发艾尔是美式精酿里最"没有门槛"的风格：单一基础麦芽、少量结晶、一次苦花，' +
             '发酵干净就算成功。正因如此，它最适合当第一锅酒——任何缺陷都会显形，改进方向也清楚。',
      tags: ['美式', '入门', '清爽'], eff: 75, temp: 19, mashTemp: 66, carb: 2.5,
      malts: [['m-2row', 4.2], ['m-c10', 0.25]],
      hops: [['h-cascade', 25, 'boil', 60], ['h-cascade', 10, 'boil', 10]],
      yeast: ['y-us05', 11], att: 78,
      notes: '第一次酿就选它。控好发酵温度（18–20°C），别急着装瓶。'
    },
    {
      id: 'c-american-amber', name: '美式琥珀艾尔 · 焦糖与柑橘的中间地带', en: 'American Amber Ale',
      styleId: '19A', country: '美国', brewery: '风格基准（家酿复原）', era: 'modern', conf: 'B',
      story: '美式琥珀艾尔坐在淡色艾尔与棕色艾尔之间：比淡色更有焦糖骨架，比棕色更少烘烤味。' +
             '1990 年代它是美式精酿的销量主力，后来被 IPA 挤到边上，但配方结构至今没变。',
      tags: ['美式', '琥珀', '焦糖'], eff: 74, temp: 19, mashTemp: 66, carb: 2.4,
      /* 2026 收口：0.5kg c60 + 0.15kg c120 实算 FG 1.0163（上界 1.015），
         而且结晶占比 13.4% 与说明里"控制在 10% 以内"自相矛盾。
         改成 c60 0.15 + c120 0.25（总量 0.4kg = 8.7%）：深色结晶顶色度、
         总残留糖反而更少，实算 1.0536 / 1.0142 / 11.6 SRM。 */
      malts: [['m-2row', 4.2], ['m-c60', 0.15], ['m-c120', 0.25]],
      hops: [['h-centennial', 22, 'boil', 60], ['h-cascade', 25, 'boil', 10], ['h-cascade', 20, 'dryhop', 0]],
      yeast: ['y-us05', 12], att: 77,
      notes: '结晶麦芽总量控制在 10% 以内，否则会盖掉酒花。'
    },
    {
      id: 'c-american-stout', name: '美式世涛 · 烘烤与酒花的对撞', en: 'American Stout',
      styleId: '20B', country: '美国', brewery: '风格基准（家酿复原）', era: 'modern', conf: 'B',
      story: '美式世涛与英式世涛的分岔在于酒花：美国人把西海岸的柑橘与松脂压进烘烤麦芽的框架里，' +
             '做出"又黑又亮"的版本。它比牛奶世涛干，比帝国世涛轻，是最适合练烘烤配比的一档。',
      tags: ['美式', '世涛', '烘烤'], eff: 72, temp: 19, mashTemp: 66, carb: 2.3,
      /* 2026 收口：0.45kg 巧克力 + 0.4kg c80 实算 FG 1.0231，超 20B 上界（1.022）。
         结晶 0.4→0.15kg 是主刀（结晶的 55% 可发酵度就是残糖来源），
         巧克力补 0.05kg 把色度守在 33.4 SRM。实算 1.0207 / 6.51% / 46.9 IBU。 */
      malts: [['m-2row', 5.3], ['m-chocolate', 0.4], ['m-c80', 0.15], ['m-roastedbarley', 0.2]],
      hops: [['h-chinook', 30, 'boil', 60], ['h-cascade', 20, 'boil', 10]],
      yeast: ['y-us05', 14], att: 75,
      notes: '烘烤麦芽总量约 10%（巧克力 0.4 + 烘烤大麦 0.2）；超过 15% 会发涩发苦，像在喝咖啡渣。'
    },

    /* ==================================================================
     * v1.7 扩库：同风格的第 2 条 + 原先 0 条的风格
     * ------------------------------------------------------------------
     * 为什么这样扩：v1.6 的 50 条里 49 个风格各 1 条、41 个风格 0 条。
     * 用户问"有没有别的做法"时无处可点，问"我想酿 25A"时库里是空的。
     *
     * 纪律（与上面 50 条完全一致）：
     *   · 参数仍是"按风格反推的合理复原"，不是酒厂保密配方；
     *   · OG / FG / ABV / IBU / SRM 全部用 BREW.Calc.calcRecipe() 实算校验，
     *     落在 15-data-style.js 的对应区间内（tools/test-library.js 会再验一遍）；
     *   · att 写的是**本配方实际衰减**（受糖化温度与麦芽组成影响），
     *     所以它会与酵母库的标称区间差几个点——界面列名因此改成"本配方衰减度"；
     *   · era 用于只有年代没有确切年份的酒（如 '1850s' / 'modern'）。
     * ==================================================================*/

    {
      id: 'c2-mexican-light', name: '墨西哥淡爽拉格 · 科罗娜式的冰镇口粮', en: 'Mexican Light Lager · Corona style',
      styleId: '1A', country: '墨西哥', brewery: 'Cervecería Modelo 风格', year: 1925,
      story: '墨西哥的拉格传统来自 19 世纪末的德裔移民，但真正定型是在 20 世纪：当地高碱度的水被石灰处理软化，玉米与大米把麦芽味压薄，做出适合烈日下加青柠饮用的淡爽酒。' +
             '它的技术难点不在配方，而在"什么都没有"——任何一点双乙酰或乙醛都无处可藏。',
      tags: ['拉格', '玉米', '冰镇', '淡爽'], conf: 'B',
      eff: 76, temp: 12, mashTemp: 65, carb: 2.8,
      malts: [['m-2row', 2.229], ['m-flakedcorn', 0.9]],
      hops: [['h-cluster', 10.3, 'boil', 60]],
      yeast: ['y-w3470', 22], att: 81.2,
      notes: 'OG 只有 1.036 上下，接种量反而要按上限给：低浓度麦汁里酵母的存活环境更差。' +
        ' 主发 12°C，双乙酰还原两天后降到 1°C 存两周，酒才会"没有味道"。'
    },

    {
      id: 'c2-japanese-dry', name: '日式超干拉格 · 干到没有余味', en: 'Japanese Dry Lager · Super Dry style',
      styleId: '1B', country: '日本', brewery: 'Asahi 风格', year: 1987,
      story: '1987 年日本市场出现"辛口"拉格，把发酵度推到极限：同样的麦汁浓度，残糖比传统拉格更低，收口干脆到几乎没有余味。' +
             '它靠的是高比例辅料 + 高衰减酵母 + 严格的低温发酵，不是靠加水稀释。' +
             '这种做法后来成了亚洲工业拉格的共同语言。',
      tags: ['拉格', '干爽', '大米', '日式'], conf: 'B',
      eff: 78, temp: 11, mashTemp: 64, carb: 2.7,
      malts: [['m-2row', 2.353], ['m-flakedrice', 1.4]],
      hops: [['h-magnum-de', 7.7, 'boil', 60],
             ['h-hallertau', 8, 'boil', 10]],
      yeast: ['y-w3470', 22], att: 82.5,
      notes: '大米占到 35%，麦芽骨架只负责"有酒味"。' +
        '糖化温度压到 64°C 让可发酵糖更多，配合 82% 的衰减把 FG 压到 1.008 附近；再低就空了。'
    },

    {
      id: 'c2-cream-ale-hybrid', name: '奶油艾尔 · 双菌混发的金色', en: 'Cream Ale · Hybrid Fermentation',
      styleId: '1C', country: '美国', brewery: '家酿混发实验', era: 'modern',
      story: '奶油艾尔在历史上就是"艾尔酵母 + 拉格工艺"的混血：前段用艾尔酵母快速起发，后段降温让拉格酵母收尾，得到既干净又带一点果酯的酒。' +
             '这条配方把两种菌按 2:1 投，是可复现的家酿做法，不是商业机密。',
      tags: ['艾尔', '混发', '干净', '金色'], conf: 'B',
      eff: 75, temp: 16, mashTemp: 66, carb: 2.6,
      malts: [['m-2row', 3.182], ['m-flakedcorn', 0.8], ['m-c20', 0.2]],
      hops: [['h-cluster', 13.2, 'boil', 60],
             ['h-cascade', 8, 'boil', 10]],
      yeast: ['y-us05', 12], att: 84,
      notes: '主发 16°C 三天后降到 10°C，模拟"混发"的后段；不必真的买两种酵母。' +
        ' 玉米 15% 是它的干爽来源，别超过 20%，否则麦芽味撑不住。'
    },

    {
      id: 'c2-american-wheat-orange', name: '血橙美式小麦 · 果皮与小麦的夏天', en: 'Blood Orange American Wheat',
      styleId: '1D', country: '美国', brewery: '家酿果皮版', year: 2014,
      story: '2010 年代美国精酿把"果皮 + 小麦"做成夏季标配：小麦给柔和口感，血橙皮给香气而不给甜味。' +
             '关键是**用皮不用汁**——果汁会带来可发酵糖和酸度，把一杯干净的夏日啤酒变成调味饮料。',
      tags: ['小麦', '柑橘', '果皮', '夏季'], conf: 'B',
      eff: 74, temp: 19, mashTemp: 66, carb: 2.8,
      malts: [['m-2row', 2.248], ['m-wheat', 1.8], ['m-c10', 0.15]],
      hops: [['h-cascade', 20, 'boil', 60],
             ['h-citra', 18, 'whirlpool', 15, 80]],
      yeast: ['y-us05', 12], att: 80,
      adj: [['a-orangepeel', 25]],
      notes: '血橙皮 25g 在回旋阶段加，别煮沸。' +
        '小麦 40% 已经够浑，不用刻意做浑浊。'
    },

    {
      id: 'c2-brahma-pale-lager', name: '南美淡色拉格 · 桑巴的日常', en: 'South American Pale Lager · Brahma style',
      styleId: '2A', country: '巴西', brewery: 'Brahma 风格', year: 1885,
      story: '南美的淡色拉格与北美同源，却因为当地大麦质量与高比例辅料走出了另一条路：酒体更薄、苦味更低、碳酸更高，为的是在热带的温度里一口接一口。' +
             '它在家酿里的价值是练"干净"——配方只有三样东西，骗不了人。',
      tags: ['拉格', '辅料', '南美', '易饮'], conf: 'B',
      eff: 76, temp: 12, mashTemp: 65, carb: 2.9,
      malts: [['m-pilsner', 2.911], ['m-flakedrice', 1]],
      hops: [['h-hallertau', 37, 'boil', 60]],
      yeast: ['y-w3470', 22], att: 78.4,
      notes: '目标苦度只有 22 IBU 上下：一克多余的苦花就会让它从"易饮"变成"寡淡的苦水"。'
    },

    {
      id: 'c2-czech-8', name: '捷克 8° 淡色拉格 · 一天三杯的那种', en: 'Czech Výčepní Pivo · Osmistupňové',
      styleId: '3A', country: '捷克', brewery: '风格基准（8° 酒馆档）', era: '1900s',
      story: '捷克按原麦汁浓度分档：8° 是酒馆里最便宜、喝得最多的一档，酒精只有 3% 出头。' +
             '它比 10° 更薄，所以苦味必须更"圆"——尖锐的苦在低度酒里会被放大成缺陷。' +
             '这类酒几乎不出口，只能自己酿。',
      tags: ['拉格', '萨兹', '低度', '日常'], conf: 'B',
      eff: 72, temp: 11, mashTemp: 67, carb: 2.3,
      malts: [['m-pilsner', 2.907], ['m-munich', 0.25], ['m-carapils', 0.12]],
      hops: [['h-saaz', 47.5, 'boil', 60],
             ['h-saaz', 10, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 71.4,
      water: {ca:12,mg:3,na:5,cl:8,so4:12,hco3:25},
      notes: '糖化温度 67°C 留一点糊精，低度酒最怕"水感"。' +
        '萨兹两次投，苦味要软。' +
        ' 这条与 3A 的另一条（10°）只差两三个比重点，是捷克酒馆的日常梯度。'
    },

    {
      id: 'c2-moravian-pils', name: '摩拉维亚皮尔森 · 更苦的那一半', en: 'Moravian Pilsner · Hopped Harder',
      styleId: '3B', country: '捷克', brewery: '摩拉维亚风格', era: '1890s',
      story: '波西米亚皮尔森以"柔和"著称，摩拉维亚的版本则把萨兹投得更狠：同样的麦汁浓度，苦度往上顶 5–8 个 IBU，收口更干。' +
             '它提醒人一件事——同一个风格里，"苦多少"是可以选的，而不是风格规定的。',
      tags: ['拉格', '萨兹', '更苦', '历史'], conf: 'B',
      eff: 71, temp: 11, mashTemp: 64, carb: 2.5, boil: 90,
      malts: [['m-pilsner', 4.551], ['m-carapils', 0.2]],
      hops: [['h-saaz', 54.7, 'boil', 90],
             ['h-saaz', 25, 'boil', 20],
             ['h-saaz', 20, 'whirlpool', 20, 85]],
      yeast: ['y-w3470', 22], att: 76.1,
      water: {ca:10,mg:2,na:3,cl:5,so4:8,hco3:18},
      notes: '90 分钟煮沸会把麦芽香做得更浓，也让苦味更"整"。' +
        '萨兹总量 115g 已经是 20L 的上限，再多就是苦水而不是皮尔森。'
    },

    {
      id: 'c2-helles-decoction', name: '慕尼黑清亮 · 煮出糖化的麦芽骨架', en: 'Munich Helles · Double Decoction',
      styleId: '4A', country: '德国', brewery: '巴伐利亚小厂风格', era: 'modern',
      story: 'Helles 的配方简单到只有两种麦芽，风味差距几乎全在工艺上：煮出糖化（decoction）把一部分醪液煮沸，产生美拉德反应，带来面包皮与蜂蜜般的麦芽香。' +
             '家酿可以只做一次煮出，效果已经明显好于单步糖化。',
      tags: ['拉格', '煮出糖化', '麦芽', '巴伐利亚'], conf: 'B',
      eff: 70, temp: 10, mash: [["蛋白质休止", 50, 20], ["糖化 1", 63, 30], ["糖化 2", 71, 25], ["出糖", 76, 10]], carb: 2.5, boil: 90,
      malts: [['m-pilsner', 3.838], ['m-munich', 0.32], ['m-melanoidin', 0.12]],
      hops: [['h-hallertau', 25.8, 'boil', 60],
             ['h-hallertau', 12, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 80.4,
      notes: '类黑精麦芽（Melanoidin）是家用替代煮出糖化的省事办法，0.25kg 就有面包皮。' +
        ' 苦度压在 18 IBU 左右，超过 22 就变成皮尔森了。'
    },

    {
      id: 'c2-festbier-tent', name: '慕尼黑啤酒节 · 大篷里的一升杯', en: 'Festbier · Wiesn Maß',
      styleId: '4B', country: '德国', brewery: '慕尼黑大篷风格', era: 'modern',
      story: '啤酒节帐篷里的酒要在 6% 酒精下仍然"喝得下去"，所以它的平衡点比普通拉格更窄：麦芽要甜但不腻，苦味要够但不抢。' +
             '大厂的做法是维也纳 + 慕尼黑双麦芽，几乎不用结晶麦芽。',
      tags: ['拉格', '慕尼黑', '麦芽', '节日'], conf: 'B',
      eff: 73, temp: 11, mashTemp: 66, carb: 2.7,
      malts: [['m-pilsner', 2.692], ['m-vienna', 2], ['m-munich', 0.5]],
      hops: [['h-magnum-de', 12.9, 'boil', 60],
             ['h-hallertau', 14, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 78.9,
      notes: '维也纳麦芽给"饼干"，慕尼黑给"蜜"；两者的比例就是各家大篷的差别所在。' +
        ' 别加结晶麦芽——一加就腻，一升杯会被喝出甜味疲劳。'
    },

    {
      id: 'c2-kolsch-american', name: '科隆 · 美式精酿的再解释', en: 'Kölsch-style Ale · American Craft Take',
      styleId: '5B', country: '美国', brewery: '美式精酿版本', year: 2010,
      story: '科隆之外不能叫 Kölsch，所以美国酒厂写"Kölsch-style"。' +
             '做法上他们更敢用新世界酒花：苦度不变，香气从梨与苹果换成柑橘与白花。' +
             '这类"借风格、换酒花"的做法，是理解风格边界最直观的练习。',
      tags: ['艾尔', '新世界酒花', '干净', '跨界'], conf: 'B',
      eff: 74, temp: 16, mashTemp: 65, carb: 2.6,
      malts: [['m-pilsner', 3.667], ['m-wheat', 0.35], ['m-c10', 0.1]],
      hops: [['h-hallertau', 31.9, 'boil', 60],
             ['h-citra', 16, 'whirlpool', 15, 80],
             ['h-citra', 20, 'dryhop', 0]],
      yeast: ['y-k97', 12], att: 82.1,
      notes: '酒花只在回旋与干投阶段用新世界品种，苦度仍交给欧陆花——这样"像科隆"和"有新意"能同时成立。'
    },

    {
      id: 'c2-export-sulfate', name: '多特蒙德出口 · 硫酸盐的骨架', en: 'Dortmunder Export · Sulfate Forward',
      styleId: '5C', country: '德国', brewery: '风格基准（高硫酸盐版）', era: 'modern',
      story: '出口啤酒的灵魂是水：多特蒙德的井水钙与硫酸盐都高，苦味因此显得"干而脆"。' +
             '家酿最容易犯的错是把水调得跟皮尔森一样软，那样做出来只是"浓一点的皮尔森"，丢掉了这个风格存在的理由。',
      tags: ['拉格', '硬水', '干爽', '骨架'], conf: 'B',
      eff: 72, temp: 11, mashTemp: 65, carb: 2.6, boil: 75,
      malts: [['m-pilsner', 3.668], ['m-munich', 0.9], ['m-carapils', 0.15]],
      hops: [['h-magnum-de', 13.1, 'boil', 75],
             ['h-spalt', 18, 'boil', 20]],
      yeast: ['y-w3470', 22], att: 77.5,
      water: {ca:180,mg:18,na:55,cl:80,so4:210,hco3:120},
      salts: [['w-gypsum', 4]],
      notes: 'SO₄ 200 上下是甜点：低于 150 苦味发闷，高于 250 会涩。' +
        '碱度必须压住，否则高硫酸盐会被高碱度抵消，白调一趟。'
    },

    {
      id: 'c2-northgerman-pils', name: '北德皮尔森 · 越苦越干', en: 'Northern German Pils · Bitter & Bone Dry',
      styleId: '5D', country: '德国', brewery: 'Jever 风格（更苦版）', era: 'modern',
      story: '北德的皮尔森比南德更苦、更干、碳酸更高，因为当地水质更硬、酿造历史更接近"汉萨同盟的贸易啤酒"。' +
             '它的苦不是"多一点苦花"，而是"苦味必须干净"——一点涩感都会被放大成缺陷。',
      tags: ['拉格', '苦', '干爽', '北德'], conf: 'B',
      eff: 72, temp: 10, mashTemp: 63, carb: 2.8, boil: 75,
      malts: [['m-pilsner', 4.255]],
      hops: [['h-perle', 20.8, 'boil', 75],
             ['h-hallertau', 22, 'boil', 20],
             ['h-hallertau', 18, 'whirlpool', 15, 85]],
      yeast: ['y-w3470', 22], att: 77.8,
      water: {ca:90,mg:10,na:30,cl:50,so4:150,hco3:40},
      notes: '100% 皮尔森麦芽不做任何修饰，全部风味来自酒花与发酵。' +
        '糖化 63°C 把酒体做薄，收口必须干到 1.010 以下。'
    },

    {
      id: 'c2-marzen-vienna', name: '三月啤酒 · 维也纳麦芽的烤面包', en: 'Märzen · Vienna Forward',
      styleId: '6A', country: '德国', brewery: '维也纳麦芽版', era: 'modern',
      story: '慕尼黑版本的三月啤酒以慕尼黑麦芽为主，维也纳版本则更"脆"：颜色偏红铜、烤面包味更清晰、收口更干。' +
             '同一风格的两条路，差别只在麦芽产地，这也是 19 世纪中欧啤酒最有意思的地方。',
      tags: ['拉格', '琥珀', '烤面包', '维也纳'], conf: 'B',
      eff: 72, temp: 10, mashTemp: 65, carb: 2.6,
      malts: [['m-vienna', 3.949], ['m-munich', 1.2], ['m-c40', 0.2]],
      hops: [['h-hallertau', 32.5, 'boil', 60],
             ['h-tettnanger', 12, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 80.8,
      notes: '维也纳麦芽占 70% 时才叫"维也纳版"；C40 只补 1 SRM 的深度，别超过 4%。'
    },

    {
      id: 'c2-rauchbock', name: '烟熏博克 · 篝火与麦芽的双重浓度', en: 'Rauchbock · Smoked Bock',
      styleId: '6B', country: '德国', brewery: 'Schlenkerla Urbock 风格', era: 'modern',
      story: '班贝格的烟熏传统不止做三月啤酒，也做浓度更高的博克版本：烟熏味在更高浓度的麦芽骨架里显得更"沉"，像篝火边的黑麦面包。' +
             '原料库里没有烟熏麦芽，所以这条配方用"慕尼黑 + 少量巧克力"打底，并注明了要自建烟熏麦芽替换。',
      tags: ['烟熏', '博克', '班贝格', '冬季'], conf: 'B',
      eff: 70, temp: 10, mashTemp: 66, carb: 2.5, boil: 75,
      malts: [['m-munich', 3.845], ['m-pilsner', 1.2], ['m-chocolate', 0.12]],
      hops: [['h-hallertau', 42.9, 'boil', 75]],
      yeast: ['y-w3470', 22], att: 75.1,
      notes: '要做真正的烟熏版：把 40% 的慕尼黑麦芽换成自建烟熏麦芽，其余不动。' +
        ' 烟熏比例超过 60% 就会盖掉麦芽甜，变成"液体培根"。'
    },

    {
      id: 'c2-vienna-single', name: '维也纳拉格 · 只用一种麦芽', en: 'Vienna Lager · Single Malt',
      styleId: '7A', country: '奥地利', brewery: '单一维也纳麦芽版', era: 'modern',
      story: '维也纳拉格最干净的表达是"100% 维也纳麦芽"：颜色、烤面包香、酒体全部由一种麦芽提供。' +
             '它看上去像偷懒，实际最难——没有第二种麦芽可以掩盖糖化或发酵的偏差。' +
             '这也是检验一台设备是否稳的好办法。',
      tags: ['拉格', '单一麦芽', '红铜', '烤面包'], conf: 'B',
      eff: 73, temp: 11, mashTemp: 66, carb: 2.5,
      malts: [['m-vienna', 3.8], ['m-munich', 0.5], ['m-c40', 0.4]],
      hops: [['h-perle', 22.9, 'boil', 60],
             ['h-hallertau', 10, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 80.7,
      notes: '100% 维也纳麦芽会自己撑到 9 SRM 附近；那 0.12kg C40 只是补偿家用设备的色度偏差，可以省。'
    },

    {
      id: 'c2-schwarz-thuringia', name: '黑啤 · 图林根的家酿版', en: 'Schwarzbier · Thuringian Homebrew',
      styleId: '8B', country: '德国', brewery: 'Köstritzer 风格（家酿复原）', era: 'modern',
      story: '黑啤的关键是"黑而无焦"：用去苦黑麦芽（Carafa Special）上色，麦芽甜仍在，酒体轻盈得像拉格。' +
             '图林根的家酿做法常在主发后多留一周低温，让烘烤感与硫味一起沉下去。',
      tags: ['拉格', '深色', '轻盈', '去苦黑麦芽'], conf: 'B',
      eff: 72, temp: 10, mashTemp: 66, carb: 2.5,
      malts: [['m-munich', 2.829], ['m-pilsner', 1.6], ['m-carafa3', 0.18]],
      hops: [['h-hallertau', 42.9, 'boil', 60],
             ['h-tettnanger', 10, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 75,
      notes: 'Carafa Special III 0.18kg 就够 23 SRM，别用黑专利（Black Patent）——那会带来灰烬味。'
    },

    {
      id: 'c2-doppelbock-dark', name: '双料博克 · 深色果干与焦糖', en: 'Doppelbock · Celebrator style',
      styleId: '9A', country: '德国', brewery: 'Ayinger Celebrator 风格', era: 'modern',
      story: 'Ayinger 的 Celebrator 是双料博克里"深色果干"一路的代表：大量慕尼黑与少量特种麦芽带来葡萄干、可可与焦糖，酒精被麦芽完全包住。' +
             '它证明"高浓度"不等于"高酒精感"——后者是发酵温度失控的结果。',
      tags: ['拉格', '高浓度', '果干', '麦芽'], conf: 'B',
      eff: 68, temp: 10, mashTemp: 66, carb: 2.4, boil: 90,
      malts: [['m-munich', 6.497], ['m-munich-dark', 2.2], ['m-specialb', 0.2]],
      hops: [['h-hallertau', 43.9, 'boil', 90]],
      yeast: ['y-w3470', 26], att: 78.4,
      notes: 'Special B 0.2kg 给葡萄干与可可边，多了会变成"液体梅子干"。' +
        ' 1.085 的麦汁要两包以上干酵母，18°C 起发四天后再慢慢降到 10°C。'
    },

    {
      id: 'c2-weissbier-banana', name: '德式小麦 · 香蕉推到顶', en: 'Weissbier · Banana Forward',
      styleId: '10A', country: '德国', brewery: '高温发酵版', era: 'modern',
      story: '同一株小麦酵母，22–23°C 发酵会明显偏香蕉，18°C 则偏丁香。' +
             '这条配方故意把温度推到上限，做一杯"香蕉面包"式的小麦啤：它不是更"正宗"，而是把温度这个旋钮拧到头，让人喝出旋钮的存在。',
      tags: ['小麦', '香蕉', '高温发酵', '巴伐利亚'], conf: 'B',
      eff: 72, temp: 23, mash: [["蛋白质休止", 45, 15], ["糖化", 66, 60], ["出糖", 76, 10]], carb: 3.2,
      malts: [['m-wheat', 2.494], ['m-pilsner', 1.6], ['m-munich', 0.3]],
      hops: [['h-hallertau', 20, 'boil', 60]],
      yeast: ['y-wlp300', 12], att: 75.3,
      notes: '温度每高 1°C，乙酸异戊酯就上一个台阶；23°C 是上限，再高会出现溶剂味。' +
        ' 浑浊与高碳酸都是风格要求，别冷降、别过滤。'
    },

    {
      id: 'c2-best-bitter-yorkshire', name: '约克郡优质苦啤 · 方形发酵罐的味道', en: 'Yorkshire Best Bitter · Square Fermenter',
      styleId: '11B', country: '英国', brewery: 'Timothy Taylor Landlord 风格', era: 'modern',
      story: '约克郡的酒厂传统上用方形敞口发酵罐（Yorkshire square），酵母浮到表面被撇走，酒液因此带一点独特的果酯与干爽收口。' +
             '家酿复制不了那套设备，但可以复制它的逻辑：低温起发、发酵后期升温、不走二次发酵。',
      tags: ['英式', '果酯', '干爽', '低碳酸'], conf: 'B',
      eff: 74, temp: 18, mashTemp: 65, carb: 1.8,
      malts: [['m-marisotter', 3.508], ['m-c60', 0.28], ['m-chocolate', 0.05]],
      hops: [['h-ekg', 38.6, 'boil', 60],
             ['h-styrian', 18, 'boil', 15]],
      yeast: ['y-s04', 12], att: 79.1,
      notes: 'Styrian Goldings 收尾是约克郡的常见做法，比 EKG 多一点辛香。' +
        ' 碳酸压到 1.8 vol——英式苦啤的气泡是"活着"而不是"冒泡"。'
    },

    {
      id: 'c2-golden-ale-citra', name: '英式金艾 · 新世界酒花的夏天', en: 'British Golden Ale · New World Hops',
      styleId: '12A', country: '英国', brewery: 'Oakham 风格（现代版）', year: 2002,
      story: '2000 年代英国小厂开始用 Citra、Nelson 这类新世界酒花做金艾：麦芽仍是英式饼干香，酒花换成热带水果。' +
             '它把"英式"从地理概念变成工艺概念——用英式麦芽与英式酵母，酒花可以来自任何地方。',
      tags: ['英式', '新世界酒花', '柑橘', '易饮'], conf: 'B',
      eff: 74, temp: 19, mashTemp: 65, carb: 2.3,
      malts: [['m-marisotter', 3.854], ['m-c10', 0.15]],
      hops: [['h-ekg', 35.5, 'boil', 60],
             ['h-citra', 25, 'whirlpool', 15, 80],
             ['h-citra', 30, 'dryhop', 0]],
      yeast: ['y-s04', 11], att: 82.3,
      notes: '苦花仍用 EKG 打底，新世界酒花只负责香气——全用 Citra 会变成"淡版 IPA"。'
    },

    {
      id: 'c2-english-ipa-burton', name: '伯顿英式 IPA · 高硫酸盐的老派', en: 'Burton IPA · Sulfate Heavy',
      styleId: '12C', country: '英国', brewery: '伯顿传统复原', year: 1820,
      story: '19 世纪伯顿的井水富含硫酸盐，苦味因此显得干而锐利，这是英式 IPA 与伦敦波特分道扬镳的关键。' +
             '历史上这类酒在木桶里陈放一年以上才装船，所以它比现代 IPA 更干、更"土"、气更少。',
      tags: ['英式', '高硫酸盐', '历史', '干'], conf: 'B',
      eff: 72, temp: 18, mashTemp: 64, carb: 2, boil: 90,
      malts: [['m-marisotter', 5.403], ['m-c40', 0.25]],
      hops: [['h-target', 26, 'boil', 90],
             ['h-ekg', 30, 'boil', 30],
             ['h-ekg', 18, 'dryhop', 0]],
      yeast: ['y-1098', 14], att: 80,
      water: {ca:260,mg:25,na:30,cl:40,so4:320,hco3:90},
      salts: [['w-gypsum', 8]],
      notes: 'SO₄ 300 以上是这条配方的全部个性：苦味会变得"脆"。' +
        ' 家酿别怕水硬，怕的是碱度高——碱度一高，苦味就从脆变钝。'
    },

    {
      id: 'c2-porter-brown-malt', name: '伦敦波特 · 棕色麦芽加强', en: 'London Porter · Brown Malt Forward',
      styleId: '13C', country: '英国', brewery: '历史复原（棕色麦芽 15%）', year: 1800,
      story: '18 世纪的波特几乎全靠棕色麦芽（Brown Malt）上色与调味，那种干爽的可可与烤面包边是黑麦芽替代不出来的。' +
             '这条配方把棕色麦芽提到 15%，是现代家酿能买到的材料里最接近历史的一版。',
      tags: ['英式', '棕色麦芽', '可可', '历史'], conf: 'B',
      eff: 73, temp: 19, mashTemp: 66, carb: 2.2,
      malts: [['m-marisotter', 3.047], ['m-brown', 0.65], ['m-c60', 0.25], ['m-chocrye', 0.12], ['m-chocolate', 0.12]],
      hops: [['h-fuggle', 36.8, 'boil', 60],
             ['h-ekg', 12, 'boil', 15]],
      yeast: ['y-1084', 12], att: 81.9,
      notes: '棕色麦芽 15% 是上限，再多会有"灰烬"感。' +
        '黑麦巧克力（Choc Rye）给一点辛辣的收尾。'
    },

    {
      id: 'c2-irish-red-export', name: '爱尔兰红艾 · 出口档的麦芽甜', en: 'Irish Red Ale · Export Strength',
      styleId: '15A', country: '爱尔兰', brewery: '风格基准（出口档）', era: 'modern',
      story: '爱尔兰红艾在国内常被当成"淡版世涛"，其实它更接近英式苦啤的干爽路线：红色来自极少量烘烤大麦，苦味低、收口干。' +
             '出口档把浓度提上来，麦芽甜更明显，但仍然不能有焦苦。',
      tags: ['爱尔兰', '红艾', '麦芽甜', '干爽'], conf: 'B',
      eff: 75, temp: 19, mashTemp: 66, carb: 2.3,
      malts: [['m-marisotter', 3.274], ['m-c60', 0.22], ['m-roastedbarley', 0.05]],
      hops: [['h-fuggle', 28.1, 'boil', 60],
             ['h-ekg', 12, 'boil', 20]],
      yeast: ['y-wlp004', 12], att: 74.2,
      notes: 'WLP004 的干净果酯与烘烤大麦很搭。' +
        '烘烤大麦 50g 是"红色"与"深色"的分界线。'
    },

    {
      id: 'c2-irish-stout-nitro', name: '爱尔兰世涛 · 氮气感的家酿做法', en: 'Irish Stout · Nitro Style',
      styleId: '15B', country: '爱尔兰', brewery: 'Guinness 风格（氮气版）', era: 'modern',
      story: '氮气世涛的绵密泡沫与"奶油感"来自 70/30 的氮气混合气与专用酒头，家酿没有那套设备，但可以用低碳酸 + 高比例烘烤大麦 + 小麦蛋白做出接近的口感。' +
             '这不是"假氮气"，是把能控制的部分控制住。',
      tags: ['世涛', '氮气', '干爽', '烘烤大麦'], conf: 'B',
      eff: 76, temp: 19, mashTemp: 66, carb: 1.5,
      malts: [['m-marisotter', 2.5], ['m-flakedbarley', 0.5], ['m-roastedbarley', 0.42], ['m-chocolate', 0.12]],
      hops: [['h-target', 23.5, 'boil', 60]],
      yeast: ['y-nottingham', 12], att: 84.9,
      water: {ca:120,mg:4,na:12,cl:19,so4:55,hco3:300},
      notes: '碳酸 1.5 vol 是故意的：低气泡才能让烘烤感显得"厚"。' +
        ' 装瓶时用氮气胶囊或直接接受"无氮气版"，别用高碳酸去模仿。'
    },

    {
      id: 'c2-milk-stout-choc', name: '牛奶世涛 · 巧克力与乳糖', en: 'Milk Stout · Chocolate Forward',
      styleId: '16A', country: '英国', brewery: 'Mackeson 风格（现代版）', era: 'modern',
      story: '乳糖不被酿酒酵母发酵，全部留在酒里变成甜味与酒体，这让牛奶世涛成了"甜世涛"这一支的起点。' +
             '现代版本常在发酵后加可可碎，把乳糖的奶甜与可可的苦香叠在一起，苦味必须够，否则就是巧克力奶。',
      tags: ['世涛', '乳糖', '可可', '甜'], conf: 'B',
      eff: 74, temp: 19, mashTemp: 67, carb: 2,
      malts: [['m-marisotter', 2.862], ['m-flakedoats', 0.35], ['m-c80', 0.3], ['m-chocolate', 0.35], ['m-roastedbarley', 0.15], ['m-lactose', 0.4]],
      hops: [['h-ekg', 46.8, 'boil', 60]],
      yeast: ['y-s04', 12], att: 76.5,
      adj: [['a-cocoa', 40]],
      notes: '乳糖 0.4kg 对应约 1.0% 的残糖与明显酒体，别再往上加。' +
        ' 可可碎在回旋阶段加 40g，煮沸会把它变成涩味。'
    },

    {
      id: 'c2-oatmeal-stout-big', name: '燕麦世涛 · 燕麦 20% 的丝滑', en: 'Oatmeal Stout · 20% Oats',
      styleId: '16B', country: '英国', brewery: 'Samuel Smith 风格（高燕麦版）', era: 'modern',
      story: '燕麦的 β-葡聚糖带来"油润"的口感与绵密泡沫，但超过 20% 就会让滤槽堵死。' +
             '这条配方正好压在上限：燕麦 20%、加稻壳、糖化温度偏高，做出世涛里少见的"柔"。',
      tags: ['世涛', '燕麦', '丝滑', '高酒体'], conf: 'B',
      eff: 72, temp: 19, mashTemp: 67, carb: 2.1,
      malts: [['m-marisotter', 3.451], ['m-flakedoats', 0.9], ['m-c60', 0.3], ['m-chocolate', 0.3], ['m-roastedbarley', 0.1]],
      hops: [['h-ekg', 46.1, 'boil', 60],
             ['h-fuggle', 12, 'boil', 15]],
      yeast: ['y-s04', 12], att: 81.7,
      adj: [['a-grainsparadise', 0]],
      notes: '必须加稻壳（0.3kg 起），否则麦汁流不出来。' +
        '燕麦 20% 是上限，再多就是"燕麦粥"。'
    },

    {
      id: 'c2-wee-heavy-long-boil', name: '苏格兰重艾 · 三小时煮沸', en: 'Wee Heavy · Three Hour Boil',
      styleId: '17C', country: '苏格兰', brewery: 'Traquair House 风格（长煮沸）', era: 'modern',
      story: '苏格兰重艾的焦糖化来自"长时间煮沸"而不是"多加结晶麦芽"：三小时把麦汁浓缩三分之一，糖与氨基酸发生美拉德反应，得到干果与太妃糖。' +
             '代价是颜色会自己变深，所以配方里的深色麦芽反而要减。',
      tags: ['苏格兰', '长煮沸', '焦糖', '低苦'], conf: 'B',
      eff: 66, temp: 18, mashTemp: 65, carb: 1.9, boil: 180,
      malts: [['m-marisotter', 8.498], ['m-c80', 0.5], ['m-roastedbarley', 0.06]],
      hops: [['h-ekg', 43.8, 'boil', 90]],
      yeast: ['y-wlp028', 12], att: 71.8,
      notes: '煮沸 180 分钟会让体积掉 25%，所以起始麦汁要按 26L 收； 颜色主要来自浓缩，不要再加巧克力麦芽。'
    },

    {
      id: 'c2-english-barleywine-vintage', name: '英式大麦酒 · 陈年三年', en: 'English Barleywine · Vintage',
      styleId: '17D', country: '英国', brewery: 'Thomas Hardy\'s Ale 风格', era: 'modern',
      story: 'Thomas Hardy 大麦酒以"可以存 25 年"闻名：高酒精度、高残糖、适度氧化，让它像雪利酒一样越陈越复杂。' +
             '这类酒的配方其实简单，难的是等——装瓶后至少一年才开始像样。',
      tags: ['大麦酒', '陈年', '雪利', '高浓度'], conf: 'B',
      eff: 64, temp: 18, mashTemp: 66, carb: 1.8, boil: 120,
      malts: [['m-marisotter', 8.686], ['m-munich', 0.7], ['m-c80', 0.35], ['m-invert2', 0.3]],
      hops: [['h-target', 39.2, 'boil', 120],
             ['h-ekg', 22, 'boil', 30]],
      yeast: ['y-1968', 18], att: 76,
      notes: '转化糖浆（Invert No.2）是英式历史配方里的常客，给干果与朗姆般的香。' +
        ' 装瓶后 12 个月再开，氧化带来的雪利感是特征不是缺陷。'
    },

    {
      id: 'c2-blonde-ale-session', name: '金发艾尔 · 4% 的夏日口粮', en: 'Blonde Ale · Session Strength',
      styleId: '18A', country: '美国', brewery: '家酿入门版', era: 'modern',
      story: '金发艾尔的低度版本是最适合"练手"的配方：酒精度 4% 出头，任何发酵缺陷都会被放大，但改起来也最快。' +
             '它同时也是最好的"社交酒"——不惊艳，但没有人会拒绝第二杯。',
      tags: ['美式', '入门', '低度', '易饮'], conf: 'B',
      eff: 75, temp: 19, mashTemp: 66, carb: 2.5,
      malts: [['m-2row', 3.5], ['m-c10', 0.3], ['m-munich', 0.2]],
      hops: [['h-cascade', 23.9, 'boil', 60],
             ['h-cascade', 12, 'whirlpool', 10, 80]],
      yeast: ['y-us05', 11], att: 81.1,
      notes: 'OG 1.047 上下，苦度 21 IBU 左右：这个浓度下苦味超过 25 就会显得"扎"。'
    },

    {
      id: 'c2-apa-citra', name: '美式淡色艾尔 · Citra 的单点突破', en: 'American Pale Ale · Citra Single Hop',
      styleId: '18B', country: '美国', brewery: '单酒花实验', era: 'modern',
      story: '单一酒花（single hop）配方是理解酒花性格最直接的办法：同一个麦芽骨架，只换酒花，就能喝出"葡萄柚"与"百香果"的差别。' +
             'Citra 是最适合做这个实验的品种，因为它的香气辨识度太高。',
      tags: ['美式', '单一酒花', '柑橘', '热带'], conf: 'B',
      eff: 74, temp: 19, mashTemp: 66, carb: 2.5,
      malts: [['m-2row', 4.113], ['m-c40', 0.3], ['m-wheat', 0.2]],
      hops: [['h-citra', 18, 'boil', 60],
             ['h-citra', 30, 'whirlpool', 20, 80],
             ['h-citra', 45, 'dryhop', 0]],
      yeast: ['y-us05', 12], att: 79.5,
      notes: '小麦 4% 只为让香气"挂"在酒体上。' +
        '干投 45g 已经够，超过 60g 会有草本青味。'
    },

    {
      id: 'c2-amber-rye', name: '美式琥珀艾尔 · 黑麦的辛辣骨架', en: 'American Amber Ale · Rye',
      styleId: '19A', country: '美国', brewery: '黑麦版本', era: 'modern',
      story: '黑麦在琥珀艾尔里干两件事：给胡椒般的辛辣，和把酒体"拉干"。' +
             '它和焦糖麦芽是互补关系——一个给甜，一个把甜切开。' +
             '缺点是滤槽容易堵，必须加稻壳。',
      tags: ['美式', '黑麦', '辛辣', '焦糖'], conf: 'B',
      eff: 72, temp: 19, mashTemp: 66, carb: 2.4,
      malts: [['m-2row', 3.561], ['m-rye', 0.6], ['m-c60', 0.4], ['m-c120', 0.1]],
      hops: [['h-centennial', 21.3, 'boil', 60],
             ['h-cascade', 22, 'boil', 10],
             ['h-cascade', 20, 'dryhop', 0]],
      yeast: ['y-us05', 12], att: 81.3,
      adj: [['a-grainsparadise', 0]],
      notes: '黑麦 15% 是舒适区，20% 以上口感会发涩。' +
        '加 0.25kg 稻壳保证流速。'
    },

    {
      id: 'c2-cal-common-homebrew', name: '加州蒸汽 · 用拉格酵母在 17°C 发酵', en: 'California Common · Warm Fermented Lager',
      styleId: '19B', country: '美国', brewery: 'Anchor Steam 风格（家酿版）', era: 'modern',
      story: '这条配方的全部乐趣在于"用错的温度做对的事"：拉格酵母在 17°C 本该出酯，但 Northern Brewer 的草本苦味正好把那些酯"接住"，变成独特的组合。' +
             '温度再高 2°C，它就只是"有怪味的拉格"。',
      tags: ['拉格酵母', '温暖发酵', '草本', '历史'], conf: 'B',
      eff: 74, temp: 17, mashTemp: 66, carb: 2.4,
      malts: [['m-2row', 3.664], ['m-c60', 0.5], ['m-munich', 0.25]],
      hops: [['h-northernbrewer', 28.6, 'boil', 60],
             ['h-northernbrewer', 14, 'boil', 15]],
      yeast: ['y-wlp810', 22], att: 78.7,
      notes: 'WLP810 是"蒸汽啤酒菌"，14–18°C 最舒服。' +
        '衰减只有 67–70%，想更干就把糖化温度压到 64°C。'
    },

    {
      id: 'c2-american-porter-oat', name: '美式波特 · 燕麦柔化版', en: 'American Porter · Oat Softened',
      styleId: '20A', country: '美国', brewery: 'Deschutes 风格（燕麦变体）', era: 'modern',
      story: '在美式波特里加 8% 燕麦，是 2010 年代很常见的"柔化"手法：它把烘烤麦芽的棱角磨掉，同时让泡沫更绵。' +
             '代价是酒体会略显"糊"，所以酒花要比标准版更硬一点。',
      tags: ['波特', '燕麦', '美式', '柔滑'], conf: 'B',
      eff: 72, temp: 19, mashTemp: 67, carb: 2.3,
      malts: [['m-2row', 3.635], ['m-flakedoats', 0.4], ['m-munich', 0.6], ['m-c60', 0.4], ['m-chocolate', 0.3], ['m-roastedbarley', 0.1]],
      hops: [['h-chinook', 23.4, 'boil', 60],
             ['h-cascade', 22, 'whirlpool', 15, 85]],
      yeast: ['y-us05', 12], att: 82.5,
      notes: '燕麦 8% 是"柔而不糊"的上限。' +
        '苦度 38 IBU 上下才能压住燕麦的甜。'
    },

    {
      id: 'c2-american-stout-cocoa', name: '美式世涛 · 可可 nibs 与柑橘酒花', en: 'American Stout · Cocoa & Citrus Hops',
      styleId: '20B', country: '美国', brewery: '家酿增味版', era: 'modern',
      story: '美式世涛的标志是"烘烤 + 酒花"双强。' +
             '加可可碎之后，这条路会变得更窄：可可的苦与酒花的苦会叠加，任何一边过量都会变成"焦水"。' +
             '所以这条配方把酒花从 40 IBU 压到 38，把香气交给回旋。',
      tags: ['美式', '世涛', '可可', '烘烤'], conf: 'B',
      eff: 72, temp: 19, mashTemp: 66, carb: 2.3,
      malts: [['m-2row', 4.671], ['m-chocolate', 0.45], ['m-c80', 0.35], ['m-roastedbarley', 0.18]],
      hops: [['h-chinook', 32.8, 'boil', 60],
             ['h-cascade', 18, 'boil', 10],
             ['h-cascade', 20, 'whirlpool', 15, 85]],
      yeast: ['y-us05', 14], att: 83.4,
      adj: [['a-cocoa', 60]],
      notes: '可可碎 60g 在回旋后加，浸泡 10 分钟足够；煮沸会带来涩与"粉笔味"。'
    },

    {
      id: 'c2-imperial-stout-coffee', name: '帝国世涛 · 咖啡与黑糖', en: 'Imperial Stout · Coffee & Dark Sugar',
      styleId: '20C', country: '美国', brewery: '家酿增味版', era: 'modern',
      story: '帝国世涛加咖啡是"风味叠加"的经典：烘烤麦芽给可可与焦苦，冷萃咖啡给果酸与香气，黑糖（candi 180）给干果与酒体。' +
             '三者叠加后酒精感反而被压住，这是高浓度酒最好玩的地方。',
      tags: ['世涛', '咖啡', '高浓度', '陈年'], conf: 'B',
      eff: 64, temp: 18, mashTemp: 66, carb: 2.2, boil: 90,
      malts: [['m-marisotter', 7.366], ['m-munich', 1.1], ['m-c80', 0.4], ['m-chocolate', 0.28], ['m-roastedbarley', 0.15], ['m-candid180', 0.25]],
      hops: [['h-columbus', 40.7, 'boil', 90],
             ['h-cascade', 18, 'boil', 20]],
      yeast: ['y-wlp090', 22], att: 79.6,
      adj: [['a-coffee', 50]],
      notes: '咖啡用冷萃液在装瓶前加（约 200mL/20L），别把粉直接丢进发酵罐。' +
        ' WLP090 发酵快、耐 12%，能把这个浓度收干到 1.024。'
    },

    {
      id: 'c2-westcoast-ipa-ddh', name: '西海岸 IPA · 双倍干投的低苦版', en: 'West Coast IPA · Double Dry Hopped',
      styleId: '21A', country: '美国', brewery: '现代西海岸版', era: 'modern',
      story: '2010 年代后期西海岸 IPA 出现"降苦提香"的转向：苦度从 70 降到 50 上下，干投量翻倍。' +
             '它仍然是干的、脆的、清晰的，只是把"苦"换成了"香"。' +
             '这条配方是那次转向的家酿版本。',
      tags: ['IPA', '干投', '柑橘', '松脂'], conf: 'B',
      eff: 72, temp: 19, mashTemp: 65, carb: 2.5,
      malts: [['m-2row', 4.682], ['m-munich', 0.35], ['m-c20', 0.3], ['m-dextrose', 0.2]],
      hops: [['h-magnum-de', 20.9, 'boil', 60],
             ['h-citra', 35, 'whirlpool', 20, 80],
             ['h-mosaic', 35, 'whirlpool', 20, 80],
             ['h-citra', 45, 'dryhop', 0],
             ['h-mosaic', 45, 'dryhop', 0]],
      yeast: ['y-bry97', 13], att: 85.3,
      notes: '两次干投（第 3 天与第 7 天）比一次 90g 更香，这是"双倍干投"的真正含义。' +
        ' FG 必须低于 1.014，否则甜会盖住香气。'
    },

    {
      id: 'c2-hazy-ipa-ddh', name: '浑浊 IPA · 双倍干投与高氯水', en: 'Hazy IPA · DDH & Chloride Forward',
      styleId: '21C', country: '美国', brewery: 'Tree House 风格（家酿版）', era: 'modern',
      story: '浑浊 IPA 的水化学与西海岸相反：氯离子高、硫酸盐低，让酒体显得"圆"而不是"脆"。' +
             '配合大量回旋与干投，目标是把苦味藏起来、把果汁感推到前面。',
      tags: ['NEIPA', '浑浊', '高氯', '热带'], conf: 'B',
      eff: 72, temp: 19, mashTemp: 67, carb: 2.4,
      malts: [['m-2row', 4.886], ['m-flakedoats', 0.9], ['m-wheat', 0.7], ['m-carapils', 0.2]],
      hops: [['h-columbus', 6.4, 'boil', 60],
             ['h-citra', 45, 'whirlpool', 20, 80],
             ['h-idaho7', 45, 'whirlpool', 20, 80],
             ['h-citra', 60, 'dryhop', 0],
             ['h-idaho7', 60, 'dryhop', 0]],
      yeast: ['y-newengland', 13], att: 84.4,
      water: {ca:70,mg:8,na:30,cl:180,so4:45,hco3:60},
      salts: [['w-cacl2', 7], ['w-gypsum', 1]],
      notes: '氯离子 180 是"柔"的来源，超过 200 会有咸感。' +
        ' 干投后必须避免氧气，否则三天内就会从"果汁"变成"紫褐色"。'
    },

    {
      id: 'c2-double-ipa-homebrew', name: '双料 IPA · 家酿简化版', en: 'Double IPA · Homebrew Simplified',
      styleId: '22A', country: '美国', brewery: '家酿简化版', era: 'modern',
      story: '双料 IPA 在家酿里最容易失败的地方不是配方，而是接种量与充氧：1.075 以上的麦汁，一包干酵母根本不够，发酵会在 1.030 停住，甜得没法喝。' +
             '这条配方把糖控制在 8%，让酵母少吃点苦。',
      tags: ['双料IPA', '高浓度', '干', '酒花'], conf: 'B',
      eff: 70, temp: 19, mashTemp: 65, carb: 2.5,
      malts: [['m-2row', 5.45], ['m-dextrose', 0.55], ['m-c20', 0.45]],
      hops: [['h-columbus', 30.9, 'boil', 60],
             ['h-centennial', 22, 'boil', 20],
             ['h-simcoe', 40, 'whirlpool', 20, 85],
             ['h-simcoe', 50, 'dryhop', 0],
             ['h-centennial', 40, 'dryhop', 0]],
      yeast: ['y-us05', 20], att: 86.1,
      notes: '两包 US-05 或一次扩培，充氧两次（接种时与 12 小时后）。' +
        ' 糖约 9% 是"干而不薄"的平衡点。'
    },

    {
      id: 'c2-american-barleywine-west', name: '美式大麦酒 · 西海岸酒花版', en: 'American Barleywine · West Coast Hops',
      styleId: '22C', country: '美国', brewery: 'Sierra Nevada 风格（家酿版）', era: 'modern',
      story: '美式大麦酒与英式的差别就一个字：酒花。' +
             '同样的 1.10 麦汁，英式用 EKG 收尾，美式用 Chinook、Columbus 把苦度顶到 90。' +
             '它年轻时"凶"，放两年后才显出麦芽的干果与焦糖。',
      tags: ['大麦酒', '酒花', '陈年', '高浓度'], conf: 'B',
      eff: 64, temp: 18, mashTemp: 66, carb: 2, boil: 90,
      malts: [['m-2row', 8.857], ['m-munich', 0.9], ['m-c60', 0.4]],
      hops: [['h-chinook', 39.4, 'boil', 90],
             ['h-columbus', 25, 'boil', 30],
             ['h-cascade', 30, 'dryhop', 0]],
      yeast: ['y-wlp001', 22], att: 79.4,
      notes: '1.10 的麦汁要 3 包干酵母或一次大扩培，否则糖会剩在麦汁里收不了尾。' +
        ' 苦度 75 IBU 上下，与麦芽甜打平；低于 60 就变成"甜酒"。'
    },

    {
      id: 'c2-berliner-acidmalt', name: '柏林白啤 · 酸化麦芽的一步法', en: 'Berliner Weisse · Acid Malt One-Step',
      styleId: '23A', country: '德国', brewery: '家酿一步法', era: 'modern',
      story: '柏林白啤的传统做法是"糖化醪自然酸化 + 酵母发酵"两段，家酿做起来容易染杂菌。' +
             '酸化麦芽（Acid Malt）把这条路简化成一步：酸度随麦芽一起进糖化锅，发酵只负责酒精度。' +
             '代价是酸味比传统版"平"，没有乳酸菌带来的那层复杂。',
      tags: ['酸啤', '低酒精', '酸化麦芽', '清爽'], conf: 'B',
      eff: 72, temp: 20, mashTemp: 65, carb: 3.4,
      malts: [['m-pilsner', 1.698], ['m-wheat', 1]],
      hops: [['h-hallertau', 6, 'boil', 30]],
      yeast: ['y-phillysour', 11], att: 83.3,
      adj: [['a-acidmalt', 250]],
      notes: '酸化麦芽占 10–15% 就能把 pH 压到 3.5 附近；超过 20% 会有"醋"的尖锐感。' +
        ' IBU 必须低于 8，否则乳酸菌被抑制。'
    },

    {
      id: 'c2-gose-passionfruit', name: '戈斯 · 百香果与海盐', en: 'Gose · Passionfruit & Sea Salt',
      styleId: '23G', country: '德国', brewery: '现代果味版', year: 2015,
      story: '2010 年代美式精酿把戈斯"水果化"：盐与芫荽打底，水果给香气。' +
             '百香果是最合拍的一种——它的酸与戈斯本身的乳酸是同一个方向，不会打架。' +
             '关键是水果要在发酵后加，否则香气会被 CO₂ 冲走。',
      tags: ['酸啤', '咸', '百香果', '热带'], conf: 'B',
      eff: 72, temp: 20, mashTemp: 65, carb: 3.2,
      malts: [['m-pilsner', 2.505], ['m-wheat', 1.3]],
      hops: [['h-hallertau', 13.8, 'boil', 60]],
      yeast: ['y-phillysour', 11], att: 81.3,
      adj: [['a-acidmalt', 200], ['a-coriander', 8], ['a-passionfruit', 300]],
      notes: '盐在装瓶前按 0.5–1 g/L 加，一开始就加足会抑制酵母。' +
        ' 百香果果泥 300g 在降温后加，浸泡两天再装瓶。'
    },

    {
      id: 'c2-witbier-american', name: '比利时白啤 · 美式版本', en: 'Witbier · American Take',
      styleId: '24A', country: '美国', brewery: 'Blue Moon 风格', year: 1995,
      story: '美式白啤把比利时白啤的香料感收了一点、橙味放了一点，做出更容易被大众接受的版本。' +
             '它常被批评"不够比利时"，但它确实让一整代美国人第一次喝到带橙皮与芫荽的啤酒。',
      tags: ['小麦', '橙皮', '芫荽', '易饮'], conf: 'B',
      eff: 74, temp: 20, mashTemp: 66, carb: 3,
      malts: [['m-pilsner', 2.649], ['m-unmaltedwheat', 1.3], ['m-flakedoats', 0.2], ['m-c10', 0.1]],
      hops: [['h-hallertau', 22.7, 'boil', 60],
             ['h-cascade', 8, 'whirlpool', 10, 80]],
      yeast: ['y-wlp400', 12], att: 80.3,
      adj: [['a-coriander', 7], ['a-orangepeel', 18]],
      notes: '香料减到比利时版的 70%，再加 8g Cascade 回旋——这就是"美式化"的全部。'
    },

    {
      id: 'c2-saison-dark', name: '深色赛松 · 农舍的冬天', en: 'Dark Saison · Farmhouse Winter',
      styleId: '25B', country: '比利时', brewery: '农舍冬季版', era: 'modern',
      story: '赛松原本是农舍在冬天酿、夏天喝的酒，所以深色版本一直存在：同样的高衰减与胡椒辛香，底色换成焦糖与可可边。' +
             '它比金色赛松更"圆"，但 FG 仍必须低——这是赛松的生命线。',
      tags: ['赛松', '深色', '胡椒', '农舍'], conf: 'B',
      eff: 72, temp: 24, mashTemp: 64, carb: 3,
      malts: [['m-pilsner', 4.229], ['m-munich', 0.7], ['m-specialb', 0.15], ['m-carafa2', 0.06]],
      hops: [['h-ekg', 39.5, 'boil', 60],
             ['h-saaz', 22, 'whirlpool', 20, 85]],
      yeast: ['y-bellesaison', 13], att: 93.3,
      notes: 'Special B 0.15kg 就够深色与干果，Carafa 只补色。' +
        ' FG 低于 1.008 才算赛松；温度放任升到 28°C 帮它收尾。'
    },

    {
      id: 'c2-belgian-golden-low', name: '比利时金色烈性 · 8% 的"魔鬼"', en: 'Belgian Golden Strong · Session Devil',
      styleId: '25C', country: '比利时', brewery: 'Duvel 6.66 风格', era: 'modern',
      story: '把金色烈性从 9.5% 降到 7.8%，看起来只是"少放点麦芽"，实际要重新配平：酒精少了，甜感会更突出，所以糖的比例要更高、苦度不能降太多。' +
             '这是一条"低度版",不是"加水版"。',
      tags: ['比利时', '高浓度', '干', '果酯'], conf: 'B',
      eff: 70, temp: 22, mashTemp: 63, carb: 3.4,
      malts: [['m-pilsner', 4.993], ['m-dextrose', 0.85], ['m-c20', 0.1]],
      hops: [['h-saaz', 61.8, 'boil', 60],
             ['h-saaz', 16, 'boil', 15]],
      yeast: ['y-abbaye', 15], att: 86.8,
      notes: '糖 15% 是"干"的来源，别减。' +
        '苦度 28 IBU 是低度版的补偿：酒精少了，苦味必须顶上，否则会显甜腻。'
    },

    {
      id: 'c2-dubbel-syrup', name: '比利时双料 · 深色糖浆加强', en: 'Belgian Dubbel · Dark Candi Syrup',
      styleId: '26B', country: '比利时', brewery: 'Westmalle 风格（糖浆版）', era: 'modern',
      story: '双料的颜色与风味几乎全部来自深色糖浆（D-90 / D-180），不是来自烘烤麦芽。' +
             '这个区别很重要：糖浆给葡萄干与朗姆，烘烤麦芽给焦苦。' +
             '用错了，双料就变成"小世涛"。',
      tags: ['修道院', '深色', '糖浆', '干果'], conf: 'B',
      eff: 72, temp: 20, mashTemp: 65, carb: 2.8,
      malts: [['m-pilsner', 4.892], ['m-munich', 0.75], ['m-specialb', 0.08], ['m-candid180', 0.2], ['m-candid90', 0.12]],
      hops: [['h-hallertau', 33.2, 'boil', 60],
             ['h-styrian', 10, 'boil', 20]],
      yeast: ['y-wlp500', 15], att: 81.3,
      notes: '糖浆总量 8–10% 是双料的常见比例；超过 12% 酒体会变薄。' +
        ' 20°C 起发，末段升到 24°C 收尾，FG 才能进 1.014。'
    },

    {
      id: 'c2-tripel-dryhop', name: '比利时三料 · 干投酒花的现代版', en: 'Belgian Tripel · Dry Hopped',
      styleId: '26C', country: '比利时', brewery: '现代修道院风格', era: 'modern',
      story: '传统三料不干投，但 2010 年代不少比利时小厂开始试：在 9% 的酒里加少量 Styrian 或 Saaz 干投，让酚香之上多一层花香。' +
             '量必须很小——三料的主角是酵母，不是酒花。',
      tags: ['修道院', '高浓度', '干投', '酚香'], conf: 'B',
      eff: 70, temp: 21, mashTemp: 64, carb: 3.2,
      malts: [['m-pilsner', 5.755], ['m-dextrose', 0.85], ['m-c20', 0.12]],
      hops: [['h-hallertau', 59.4, 'boil', 60],
             ['h-saaz', 14, 'boil', 15],
             ['h-styrian', 15, 'dryhop', 0]],
      yeast: ['y-3787', 16], att: 84.6,
      notes: '干投只放 15g，两天就捞出来；久了会盖掉丁香。' +
        ' FG 要 1.012 以下，靠糖与升温收尾。'
    },

    {
      id: 'c2-quad-dark', name: '比利时四料 · 修道院的黑', en: 'Belgian Quadrupel · Monastic Dark',
      styleId: '26D', country: '比利时', brewery: 'Westvleteren XII 风格', era: 'modern',
      story: '四料是修道院体系里最浓的一档：深色糖浆、干果、酒精暖感，但必须"浓而不燥"。' +
             'Westvleteren XII 被反复评为世界最佳，靠的不是配方秘密，而是半年的瓶中陈放。',
      tags: ['修道院', '极浓', '陈年', '干果'], conf: 'B',
      eff: 64, temp: 20, mashTemp: 65, carb: 2.8, boil: 90,
      malts: [['m-pilsner', 7.814], ['m-munich', 1], ['m-specialb', 0.22], ['m-candid180', 0.35]],
      hops: [['h-hallertau', 51.4, 'boil', 90],
             ['h-styrian', 12, 'boil', 20]],
      yeast: ['y-3787', 20], att: 79.8,
      notes: '1.095 的麦汁要扩培，且必须充氧两次。' +
        ' 瓶中陈放 6 个月后干果与雪利感才会出来，前三个月会"燥"。'
    },

    {
      id: 'c2-brett-100', name: '布雷特啤酒 · 100% 布雷特发酵', en: 'Brett Beer · 100% Brett',
      styleId: '28A', country: '美国', brewery: 'Russian River 风格（家酿版）', era: 'modern',
      story: '100% 布雷特发酵（不加酿酒酵母）与"二次接种布雷特"是两件事：前者在 20–25°C 下大约 2–3 周走完主发，风味干净、热带水果明显；后者要等几个月。' +
             '想快就用 WLP644，想复杂就用 Brett Brux。',
      tags: ['布雷特', '野菌', '热带', '干爽'], conf: 'B',
      eff: 72, temp: 22, mashTemp: 64, carb: 2.8,
      malts: [['m-pilsner', 4.502], ['m-munich', 0.4], ['m-c20', 0.15]],
      hops: [['h-styrian', 23.7, 'boil', 60],
             ['h-styrian', 18, 'dryhop', 0]],
      yeast: ['y-wlp644', 13], att: 92.7,
      notes: '布雷特会慢慢继续吃糖，装瓶前必须连续两周比重不变； 否则瓶内会过气甚至爆瓶。' +
        'FG 1.004 左右是正常的。'
    },

    {
      id: 'c2-barrel-rye', name: '过桶烈性艾尔 · 黑麦与橡木', en: 'Barrel-Aged Strong Ale · Rye & Oak',
      styleId: '33A', country: '美国', brewery: '家酿过桶版', era: 'modern',
      story: '过桶的关键不是"桶"，而是"时间与基酒强度"：木桶给香草、单宁与微氧，基酒要够烈才撑得住。' +
             '黑麦在这里的作用是给一点辛辣，让木味不至于把整杯酒压成"香草糖水"。',
      tags: ['过桶', '黑麦', '香草', '陈年'], conf: 'B',
      eff: 64, temp: 18, mashTemp: 66, carb: 2.1, boil: 90,
      malts: [['m-marisotter', 4.859], ['m-rye', 0.8], ['m-munich', 0.7], ['m-c80', 0.35], ['m-chocolate', 0.15]],
      hops: [['h-columbus', 20, 'boil', 90]],
      yeast: ['y-wlp090', 20], att: 82,
      adj: [['a-oakcubes', 40]],
      notes: '橡木块用中度烘烤，接触 10–14 天；超过 3 周会变"木屑水"。' +
        ' 基酒 OG 1.070 以上才经得起桶味。'
    },

    {
      id: 'c3-scottish-80', name: '苏格兰出口啤 · 80/- 的麦芽骨架', en: 'Scottish Export · 80/-',
      styleId: '14C', country: '苏格兰', brewery: 'Belhaven 风格', era: 'modern',
      story: '苏格兰的"80/-"是历史上的价格标记（每桶 80 先令），后来变成浓度档位的名字。' +
             '它比英式同浓度的苦啤更甜、苦味更低，靠焦糖麦芽与长煮沸撑起风味。' +
             '这类酒是理解"苦味不是啤酒唯一骨架"的最好教材。',
      tags: ['苏格兰', '麦芽', '低苦', '焦糖'], conf: 'B',
      eff: 73, temp: 18, mashTemp: 66, carb: 2,
      malts: [['m-marisotter', 3.548], ['m-c80', 0.4], ['m-roastedbarley', 0.04]],
      hops: [['h-ekg', 22.5, 'boil', 60],
             ['h-fuggle', 10, 'boil', 20]],
      yeast: ['y-wlp028', 12], att: 76.2,
      notes: '苦度只有 18 IBU 上下，是苏格兰风格的标志。' +
        ' 烘烤大麦 40g 只为上色，多了会带焦苦，破坏"甜而柔"的性格。'
    },

    {
      id: 'c3-scottish-export-caramel', name: '苏格兰出口啤 · 焦糖化的两种做法', en: 'Scottish Export · Caramelised First Runnings',
      styleId: '14C', country: '苏格兰', brewery: '历史工艺复原', era: '1900s',
      story: '传统苏格兰酒厂会把第一道麦汁单独舀出来熬煮 1–2 小时，让糖焦化后再并回主锅（kettle caramelisation）。' +
             '家酿做不到那套流程，但可以把结晶麦芽从 10% 提到 15% 来近似——这是"工艺换材料"。',
      tags: ['苏格兰', '焦糖', '历史', '低苦'], conf: 'B',
      eff: 72, temp: 18, mashTemp: 66, carb: 2, boil: 120,
      malts: [['m-marisotter', 4.212], ['m-c120', 0.35], ['m-c60', 0.25], ['m-roastedbarley', 0.05]],
      hops: [['h-ekg', 39.7, 'boil', 60]],
      yeast: ['y-1098', 12], att: 82.7,
      notes: 'C120 给葡萄干与太妃糖，C60 给圆润；两者合计 14% 是"近似焦糖化"的上限，再多就腻。' +
        '煮沸 120 分钟顺便浓缩一点。'
    },

    {
      id: 'c3-belgian-blond-leffe', name: '比利时金艾 · 蜂蜜般的日常烈性', en: 'Belgian Blond Ale · Leffe style',
      styleId: '25A', country: '比利时', brewery: 'Leffe 风格', era: 'modern',
      story: '比利时金艾是"日常烈性"：6–7.5% 的酒精度，金色、干爽、带蜂蜜般的甜感与梨的果酯。' +
             '它比三料轻、比淡艾重，是比利时餐桌上最常见的瓶装酒。' +
             '难点在"甜而不腻"——糖的比例与发酵温度都要刚刚好。',
      tags: ['比利时', '金艾', '蜂蜜', '果酯'], conf: 'B',
      eff: 72, temp: 20, mashTemp: 65, carb: 2.9,
      malts: [['m-pilsner', 4.8], ['m-munich', 0.5], ['m-c20', 0.15], ['m-candiclear', 0.3]],
      hops: [['h-hallertau', 30.8, 'boil', 60],
             ['h-styrian', 12, 'boil', 20]],
      yeast: ['y-abbaye', 14], att: 83,
      notes: '清澈糖浆（Candi Clear）给蜂蜜般的甜而不给色，比白糖多一层风味。' +
        '20°C 起发、末段 23°C 收尾。'
    },

    {
      id: 'c3-belgian-blond-homebrew', name: '比利时金艾 · 家酿单步糖化版', en: 'Belgian Blond Ale · Single Infusion',
      styleId: '25A', country: '比利时', brewery: '家酿复原', era: 'modern',
      story: '修道院与商业酒厂多用多步糖化，家酿用单步也能做出合格的金艾，差别主要在酒体的"厚度"上。' +
             '这条配方用 64°C 单步 + 5% 糖，把可发酵性提高，弥补单步糖化的不足。',
      tags: ['比利时', '金艾', '单步糖化', '干爽'], conf: 'B',
      eff: 74, temp: 20, mashTemp: 64, carb: 2.9,
      malts: [['m-pilsner', 4.712], ['m-vienna', 0.6], ['m-dextrose', 0.25]],
      hops: [['h-hallertau', 47.3, 'boil', 60],
             ['h-saaz', 14, 'boil', 15]],
      yeast: ['y-wlp550', 14], att: 81.6,
      notes: 'WLP550 的辛香比 Abbaye 更"干"，适合单步糖化的家酿。' +
        ' 目标 FG 1.010 上下，太低会显得"水"。'
    },

    {
      id: 'c3-flanders-red', name: '佛兰德斯红艾 · 红酒般的酸', en: 'Flanders Red Ale · Rodenbach style',
      styleId: '23B', country: '比利时', brewery: 'Rodenbach Grand Cru 风格', era: 'modern',
      story: '佛兰德斯红艾是"受控的污染"：酿酒酵母、乳酸菌、醋酸菌与布雷特在木桶里共存数月到数年，得到红酒般的酸、果香与橡木。' +
             '它是所有酸啤里最像葡萄酒的一支，也是家酿最容易翻车的一支——卫生稍有疏漏就变成醋。',
      tags: ['酸啤', '混合发酵', '橡木', '红酒'], conf: 'B',
      eff: 70, temp: 21, mashTemp: 65, carb: 2.5, boil: 90,
      malts: [['m-pilsner', 3.358], ['m-vienna', 0.9], ['m-c40', 0.35], ['m-specialb', 0.2], ['m-chocolate', 0.05]],
      hops: [['h-styrian', 22.9, 'boil', 60]],
      yeast: ['y-wlp644', 12], att: 93.5,
      adj: [['a-oakcubes', 30], ['a-lactic', 2]],
      notes: '家酿简化版：主发用布雷特走完，装瓶前用乳酸调 pH 到 3.4（约 2mL/20L 起试）。' +
        ' 真正的混合发酵要 12–18 个月，这条是"三个月能喝"的版本。'
    },

    {
      id: 'c3-flanders-red-simple', name: '佛兰德斯红艾 · 酸化麦芽简化版', en: 'Flanders Red · Acid Malt Shortcut',
      styleId: '23B', country: '比利时', brewery: '家酿简化版', era: 'modern',
      story: '想在不养菌的前提下做一杯"像佛兰德斯红"的酒，酸化麦芽 + 少量乳酸是唯一现实的路。' +
             '它做不出木桶的复杂度，但能得到正确的酸度骨架与颜色，适合作为进阶级酸啤的第一步。',
      tags: ['酸啤', '酸化麦芽', '简化', '果香'], conf: 'B',
      eff: 72, temp: 20, mashTemp: 66, carb: 2.5,
      malts: [['m-pilsner', 3], ['m-vienna', 0.9], ['m-c60', 0.3], ['m-specialb', 0.15]],
      hops: [['h-hallertau', 38.4, 'boil', 60]],
      yeast: ['y-s04', 12], att: 86.6,
      adj: [['a-lactic', 3]],
      notes: '乳酸在装瓶前调，边加边测 pH，到 3.4 停手——超过 3.2 会尖。' +
        ' 没有布雷特就没有"马厩与干果"，接受这一点再动手。'
    },

    {
      id: 'c3-german-leicht', name: '德式轻啤 · 2.8% 也要有骨架', en: 'German Leichtbier · Session Pils',
      styleId: '5A', country: '德国', brewery: '风格基准（家酿复原）', era: 'modern',
      story: '德式轻啤是"低酒精但不寡淡"的证明：2.4–3.6% 的酒精度，麦芽与酒花的比例与皮尔森一样，只是整体被压缩。' +
             '它比无醇啤酒诚实——靠发酵控制浓度，不靠脱醇设备。',
      tags: ['拉格', '低度', '易饮', '德式'], conf: 'B',
      eff: 74, temp: 11, mashTemp: 66, carb: 2.6,
      malts: [['m-pilsner', 2.27], ['m-munich', 0.3]],
      hops: [['h-hallertau', 23.2, 'boil', 60],
             ['h-tettnanger', 8, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 72.6,
      notes: '糖化 66°C 留一点糊精，是低度酒不"水"的关键。' +
        ' 苦度 18 IBU 上下：这个浓度下苦味很容易显尖。'
    },

    {
      id: 'c3-german-leicht-mild', name: '德式轻啤 · 更柔的巴伐利亚版', en: 'German Leichtbier · Bavarian Mild',
      styleId: '5A', country: '德国', brewery: '巴伐利亚风格', era: 'modern',
      story: '巴伐利亚的轻啤比北德版本更柔：麦芽甜更明显、苦味更低、碳酸略低。' +
             '它常被当作"午餐啤酒"——工作日中午喝一升也不影响下午干活。' +
             '这种"功能性"是德国啤酒文化里很少被外人注意的一面。',
      tags: ['拉格', '低度', '麦芽', '巴伐利亚'], conf: 'B',
      eff: 74, temp: 10, mashTemp: 67, carb: 2.4,
      malts: [['m-pilsner', 2.294], ['m-munich', 0.45], ['m-carapils', 0.12]],
      hops: [['h-hallertau', 37.3, 'boil', 60]],
      yeast: ['y-w3470', 22], att: 77.3,
      notes: '慕尼黑麦芽 15% 给"面包"，收口要干（1.010 以下）。' +
        ' 低度酒最怕氧化，装瓶时尽量少接触空气。'
    },

    {
      id: 'c3-fruit-kriek', name: '果啤 · 樱桃酸啤（Kriek 风格）', en: 'Fruit Beer · Kriek style',
      styleId: '29A', country: '比利时', brewery: 'Cantillon / Boon 风格', era: 'modern',
      story: 'Kriek 是在兰比克或小麦酸啤上叠樱桃：水果的酸与酒本身的乳酸是同一个方向，所以不会冲突。' +
             '关键是"水果要能被喝出来，但不能像果汁"——每升 200–300g 是常见比例，超过 400g 就变成樱桃酒。',
      tags: ['果啤', '樱桃', '酸', '比利时'], conf: 'B',
      eff: 72, temp: 21, mashTemp: 65, carb: 2.8,
      malts: [['m-pilsner', 3.618], ['m-wheat', 1.2], ['m-c20', 0.12]],
      hops: [['h-styrian', 19, 'boil', 60]],
      yeast: ['y-phillysour', 12], att: 79.6,
      adj: [['a-cherry', 400], ['a-oakcubes', 20]],
      notes: '樱桃在发酵结束后加（去核或果泥），浸泡 7–10 天再装瓶。' +
        ' 果酸会让 pH 再降，装瓶前测一次，低于 3.2 就别再加水果。'
    },

    {
      id: 'c3-fruit-raspberry-wheat', name: '果啤 · 树莓小麦（非酸版）', en: 'Fruit Beer · Raspberry Wheat',
      styleId: '29A', country: '美国', brewery: '家酿果味版', era: 'modern',
      story: '树莓小麦是美式精酿里最常见的果啤之一：小麦给柔和酒体，树莓给颜色与香气，苦度压到 15 IBU 以下让果味站在前面。' +
             '它的失败模式很固定——水果放太多、颜色变成"紫红墨水"，喝起来像果酱。',
      tags: ['果啤', '树莓', '小麦', '易饮'], conf: 'B',
      eff: 74, temp: 19, mashTemp: 66, carb: 2.7,
      malts: [['m-2row', 2.2], ['m-wheat', 1.6], ['m-c10', 0.15]],
      hops: [['h-hallertau', 27.3, 'boil', 60]],
      yeast: ['y-us05', 12], att: 75.5,
      adj: [['a-raspberry', 350]],
      notes: '树莓 350g/20L 是"能喝出果、但不是果酱"的比例；冷冻再解冻出汁更多。' +
        ' 想保住颜色就少接触氧气，花青素氧化会变褐。'
    },

    /* ---------------- 补齐空风格 第 1 批：2B 2C 3C 3D 4C 6C ---------------- */
    {
      id: 'c4-intl-amber-vienna', name: '国际琥珀拉格 · 维也纳面包皮', en: 'International Amber Lager · Vienna Crust',
      styleId: '2B', country: '奥地利', brewery: '维也纳拉格传统', year: 1870, conf: 'B',
      story: '琥珀拉格在国际市场上多半是维也纳拉格的直系后代：19 世纪中欧移民把维也纳麦芽带到墨西哥、南美与北美，当地酒厂再把它稀释成 4.5–6% 的日常酒。' +
             '它和维也纳拉格真正的区别不在配方，而在野心——不追求麦芽层次，只求一口焦糖面包皮配干净的收口。',
      tags: ['拉格', '琥珀', '焦糖', '易饮'],
      eff: 74, temp: 11, mashTemp: 65, carb: 2.5,
      malts: [['m-pilsner', 2.68], ['m-vienna', 1.1], ['m-c60', 0.5]],
      hops: [['h-hallertau', 23.1, 'boil', 60],
             ['h-tettnanger', 12, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 82.5,
      water: { ca: 50, mg: 8, na: 20, cl: 40, so4: 55, hco3: 50 },
      salts: [['w-gypsum', 2]],
      notes: '维也纳麦芽负责面包皮，焦糖麦芽只负责「有颜色」——琥珀拉格的甜不能压过收口。苦度 17 IBU 就是这条线，再多一分橘香就变成苦味。' +
             '发酵结束前别急着降温，双乙酰还原要在 12–14°C 多留两天。'
    },
    {
      id: 'c4-intl-amber-oscura', name: '国际琥珀拉格 · 墨西哥暗色 Oscura', en: 'International Amber Lager · Cerveza Oscura',
      styleId: '2B', country: '墨西哥', brewery: '墨西哥暗色拉格传统', era: 'modern', conf: 'B',
      story: '墨西哥的 cerveza oscura 是维也纳拉格在美洲的另一个分支：玉米或大米辅料把酒体削薄，焦糖麦芽只留一点甜，整体比中欧原版更淡、更冰、更适合配辣食。' +
             '它说明「琥珀」是一个颜色描述，不是浓度描述。',
      tags: ['拉格', '辅料', '琥珀', '清爽'],
      eff: 76, temp: 10, mashTemp: 66, carb: 2.6,
      malts: [['m-2row', 2.37], ['m-flakedcorn', 0.7], ['m-munich', 0.6], ['m-c60', 0.45]],
      hops: [['h-cluster', 16.8, 'boil', 60],
             ['h-tettnanger', 8, 'boil', 10]],
      yeast: ['y-s23', 22], att: 82.5,
      water: { ca: 40, mg: 6, na: 25, cl: 45, so4: 45, hco3: 40 },
      salts: [],
      notes: '玉米片 15% 左右是这条配方的关键：它让 10 SRM 的焦糖色不带上「厚」。糖化温度别超过 66°C，否则辅料带来的干爽会被糊精盖掉。' +
             '装瓶碳化 2.6 vol 比中欧版本高一点，冰镇后气泡感才是这类酒的主体。'
    },
    {
      id: 'c4-intl-dark-blackpils', name: '国际深色拉格 · 黑皮尔森', en: 'International Dark Lager · Black Pils',
      styleId: '2C', country: '德国', brewery: '德式黑皮尔森传统', era: 'modern', conf: 'B',
      story: '国际深色拉格是「黑皮尔森」的商业化版本：用少量去壳深色麦芽把颜色压到 14–30 SRM，风味上却刻意保持接近淡色拉格的干净。' +
             '它存在的理由很实际——喝深色酒的人不一定要喝浓酒。',
      tags: ['拉格', '深色', '干净', '低苦'],
      eff: 74, temp: 10, mashTemp: 65, carb: 2.5,
      malts: [['m-pilsner', 2.96], ['m-munich', 1.2], ['m-carafa2', 0.24]],
      hops: [['h-hallertau', 19.7, 'boil', 60],
             ['h-tettnanger', 10, 'boil', 15]],
      yeast: ['y-w3470', 22], att: 82,
      water: { ca: 45, mg: 8, na: 20, cl: 40, so4: 50, hco3: 55 },
      salts: [['w-gypsum', 2]],
      notes: '去壳深色麦芽（Carafa II）只给色不给苦，是这类酒能做到 21.9 SRM 却依然干净的原因。换成普通巧克力麦芽，同样的色度会带出明显的焦苦。' +
             '深色麦芽在糖化最后 15 分钟才下，颜色够、涩感少。'
    },
    {
      id: 'c4-intl-dark-caribbean', name: '国际深色拉格 · 加勒比黑拉格', en: 'International Dark Lager · Caribbean Dark',
      styleId: '2C', country: '牙买加', brewery: '加勒比黑拉格传统', era: 'modern', conf: 'B',
      story: '加勒比与中美的黑拉格多用玉米或大米辅料，因此比慕尼黑 Dunkel 更薄、更甜、更解渴。' +
             '它的深色来自少量巧克力麦芽而不是慕尼黑麦芽的长时间窑烤，所以喝起来先是焦糖水，再是一点点烤面包。',
      tags: ['拉格', '辅料', '深色', '易饮'],
      eff: 76, temp: 11, mashTemp: 66, carb: 2.7,
      malts: [['m-2row', 2.51], ['m-flakedcorn', 1], ['m-c40', 0.3], ['m-chocolate', 0.29]],
      hops: [['h-cluster', 15.8, 'boil', 60]],
      yeast: ['y-s23', 22], att: 86,
      water: { ca: 35, mg: 5, na: 30, cl: 50, so4: 40, hco3: 35 },
      salts: [],
      notes: '巧克力麦芽只占麦单一小截，却决定了 21.8 SRM 的全部色度；再多 100 克就会从「黑拉格」变成「淡世涛」。' +
             '玉米 20% 是这条配方敢把色度做深还不腻的底气。'
    },
    {
      id: 'c4-czech-amber-polotmave', name: '捷克琥珀拉格 · Polotmavé 13°', en: 'Czech Amber Lager · Polotmavé',
      styleId: '3C', country: '捷克', brewery: '捷克 polotmavé 传统', year: 1880, conf: 'B',
      story: '捷克琥珀拉格（polotmavé，字面意思是「半深色」）是 19 世纪皮尔森与深色拉格之间的中间档：酒厂把同一批麦汁分开发酵再勾兑，或直接用维也纳与焦糖麦芽配出 10–16 SRM。' +
             '它在捷克本土的销量一直不小，出口却很少。',
      tags: ['拉格', '琥珀', '萨兹', '捷克'],
      eff: 73, temp: 10, mashTemp: 65, carb: 2.4,
      malts: [['m-pilsner', 3.34], ['m-munich', 0.9], ['m-caramunich1', 0.5], ['m-carafa2', 0.06]],
      hops: [['h-saaz', 39.9, 'boil', 60],
             ['h-sladek', 15, 'boil', 20]],
      yeast: ['y-2278', 22], att: 77.5,
      water: { ca: 30, mg: 6, na: 15, cl: 25, so4: 30, hco3: 60 },
      salts: [['w-cacl2', 2]],
      notes: '捷克软水（低硫酸盐）是这条配方苦味圆润的原因；把石膏加到英式水平，24 IBU 会立刻显得尖。' +
             '深色麦芽只补色，真正的味道来自慕尼黑与卡拉慕尼黑的焦糖层。'
    },
    {
      id: 'c4-czech-amber-blend', name: '捷克琥珀拉格 · 双色勾兑思路', en: 'Czech Amber Lager · Blended Two-Mash',
      styleId: '3C', country: '捷克', brewery: '捷克双色勾兑传统', era: 'modern', conf: 'B',
      story: '老派捷克酒厂做 polotmavé 的办法是「勾兑」：一锅浅色麦汁、一锅深色麦汁，按比例混进发酵罐。' +
             '今天家酿不必真的煮两锅，用维也纳麦芽加少量深色麦芽就能逼近同一个结果，但比例要更小心——深色那锅的焦苦会在混合后被放大。',
      tags: ['拉格', '琥珀', '维也纳', '捷克'],
      eff: 72, temp: 9, mashTemp: 65, carb: 2.4,
      malts: [['m-pilsner', 3.14], ['m-vienna', 1.2], ['m-caraamber', 0.45], ['m-carafa2', 0.08]],
      hops: [['h-sladek', 31.5, 'boil', 60],
             ['h-saaz', 20, 'boil', 15]],
      yeast: ['y-2124', 22], att: 77.5,
      water: { ca: 32, mg: 6, na: 15, cl: 25, so4: 35, hco3: 55 },
      salts: [['w-cacl2', 3]],
      notes: '这条比前一条更「维也纳」：维也纳麦芽给圆润的麦芽甜，13.2 SRM 的琥珀色靠卡拉琥珀撑。' +
             '双乙酰休止一定要做足，捷克拉格的干净是「没有味道」的干净。'
    },
    {
      id: 'c4-czech-dark-tmave', name: '捷克深色拉格 · Tmavé 14°', en: 'Czech Dark Lager · Tmavé',
      styleId: '3D', country: '捷克', brewery: '波西米亚 tmavé 传统', year: 1842, conf: 'B',
      story: '捷克深色拉格（tmavé）的历史比皮尔森更久：1842 年之前波西米亚的酒几乎都是深色的，因为窑烤麦芽无法精确控色。' +
             'tmavé 的甜是焦糖与深色麦芽的甜，不是残糖的甜——好的 tmavé 收口其实相当干。',
      tags: ['拉格', '深色', '焦糖', '捷克'],
      eff: 72, temp: 10, mashTemp: 66, carb: 2.4,
      malts: [['m-pilsner', 3.2], ['m-munich-dark', 1.2], ['m-c60', 0.35], ['m-carafa3', 0.2]],
      hops: [['h-saaz', 44.8, 'boil', 60],
             ['h-saaz', 20, 'boil', 20]],
      yeast: ['y-w3470', 22], att: 76,
      water: { ca: 30, mg: 6, na: 15, cl: 25, so4: 30, hco3: 70 },
      salts: [['w-chalk', 2]],
      notes: '碳酸氢盐 70 ppm 是深色麦芽的缓冲：它压住烘烤麦芽的酸，让 26.1 SRM 的酒喝起来是「圆」而不是「涩」。' +
             '糖化 66°C 留一点糊精——tmavé 的酒体本来就比皮尔森厚，别用 63°C 把它做干。'
    },
    {
      id: 'c4-czech-dark-tavern', name: '捷克深色拉格 · 布拉格酒馆版', en: 'Czech Dark Lager · Prague Tavern',
      styleId: '3D', country: '捷克', brewery: '布拉格老酒厂风格', era: 'modern', conf: 'B',
      story: '布拉格至今还有酒厂用开放式发酵池与橡木桶做 tmavé，酒精度只有 4.5% 上下，颜色却有 20 SRM 以上。' +
             '这种「深而不重」的组合在别的国家很少见，因为大多数深色拉格会靠提高麦汁浓度来支撑色度。',
      tags: ['拉格', '深色', '低度', '捷克'],
      eff: 71, temp: 9, mashTemp: 67, carb: 2.3,
      malts: [['m-pilsner', 3.36], ['m-munich', 1.3], ['m-chocolate', 0.25], ['m-carafa2', 0.11]],
      hops: [['h-saaz', 36.7, 'boil', 60],
             ['h-sladek', 25, 'boil', 20]],
      yeast: ['y-2278', 22], att: 73.5,
      water: { ca: 28, mg: 5, na: 15, cl: 22, so4: 28, hco3: 80 },
      salts: [['w-chalk', 3]],
      notes: '麦汁浓度只有 1.054 上下，靠 67°C 糖化保住酒体，色度 25.9 SRM 全靠深色麦芽。低度深色酒最怕「水」，糊精是它唯一的骨架。' +
             '开放式发酵会带一点乳酸菌，风味上其实加分；家酿用密封罐也没问题，只是会少那一层复杂度。'
    },
    {
      id: 'c4-hellesbock-maltforward', name: '清亮博克 · 麦芽在前，酒花在后', en: 'Helles Bock · Malt-Forward',
      styleId: '4C', country: '德国', brewery: '巴伐利亚博克传统', year: 1900, conf: 'B',
      story: '清亮博克是 20 世纪才有的说法：传统博克都是深色的，慕尼黑的酒厂为了做一款「浅色但同样浓」的烈性拉格，把皮尔森麦芽与慕尼黑麦芽配在一起，并在春季上市，于是有了 Maibock 这个名字。' +
             '它的难点不是浓度，是在 7% 酒精下依然保持干净。',
      tags: ['拉格', '博克', '麦芽', '烈性'],
      eff: 74, temp: 10, mashTemp: 65, carb: 2.5,
      malts: [['m-pilsner', 4.49], ['m-munich', 1.26], ['m-melanoidin', 0.15]],
      hops: [['h-hallertau', 51.9, 'boil', 60],
             ['h-hersbrucker', 15, 'boil', 15]],
      yeast: ['y-w3470', 24], att: 77.5,
      water: { ca: 55, mg: 10, na: 20, cl: 45, so4: 60, hco3: 60 },
      salts: [['w-gypsum', 2]],
      notes: '美拉德麦芽 3% 就够，多了会有焦糖布丁的腻。29 IBU 在这个浓度下只是骨架，喝不出苦才是对的。' +
             '接种量按 1.5 倍算：高浓麦汁酵母不足会留下明显的乙醛。'
    },
    {
      id: 'c4-hellesbock-maibock', name: '五月博克 · 春季上新的烈性拉格', en: 'Maibock · Spring Release',
      styleId: '4C', country: '德国', brewery: '德式五月博克传统', era: 'modern', conf: 'B',
      story: 'Maibock 是德国酒厂一年一度的春季限定：11 月酿造、冬天下窖、5 月开桶。' +
             '它比传统博克浅、比皮尔森浓，酒花比同门的清亮博克再高一点，是德国啤酒节令文化里少数还在运转的传统。',
      tags: ['拉格', '博克', '季节', '德式'],
      eff: 73, temp: 9, mashTemp: 64, carb: 2.6,
      malts: [['m-pilsner', 4.53], ['m-vienna', 0.8], ['m-carapils', 0.2], ['m-melanoidin', 0.46]],
      hops: [['h-magnum-de', 18.8, 'boil', 60],
             ['h-hallertau', 20, 'boil', 15]],
      yeast: ['y-wlp833', 22], att: 78,
      water: { ca: 60, mg: 10, na: 18, cl: 40, so4: 70, hco3: 55 },
      salts: [['w-gypsum', 4]],
      notes: '64°C 糖化把这条酒的收口做得比前一条更干，酒精度 7% 才不显甜。马格努姆做主苦、哈拉道收香，是德国酒厂的标准搭配。' +
             '下窖 4 周以上再喝；两周的拉格化只能算冷处理，不算熟成。'
    },
    {
      id: 'c4-dunkelsbock-munich', name: '深色博克 · 慕尼黑双料', en: 'Dunkels Bock · Munich Double',
      styleId: '6C', country: '德国', brewery: '巴伐利亚双料博克传统', year: 1600, conf: 'B',
      story: '深色博克是博克的原始形态：巴伐利亚北部的 Einbeck 在 14 世纪就用深色窑烤麦芽酿烈性酒，巴伐利亚人接手后把它做得更甜、酒花更少。' +
             'Bock 这个词本身就是 Einbeck 的巴伐利亚口音讹变。',
      tags: ['拉格', '博克', '深色', '麦芽'],
      eff: 72, temp: 9, mashTemp: 66, carb: 2.4,
      malts: [['m-munich-dark', 4], ['m-pilsner', 1.97], ['m-c60', 0.3]],
      hops: [['h-hallertau', 37.8, 'boil', 60],
             ['h-hallertau', 15, 'boil', 20]],
      yeast: ['y-wlp833', 24], att: 77,
      water: { ca: 50, mg: 10, na: 20, cl: 50, so4: 45, hco3: 80 },
      salts: [['w-chalk', 2]],
      notes: '深慕尼黑麦芽占麦单将近一半，19.5 SRM 的深红棕色和面包干香都来自它。酒花只做平衡，24 IBU 已经是这类酒的上限。' +
             '糖化 66°C 保糊精，深色博克本来就不该「干」。'
    },
    {
      id: 'c4-dunkelsbock-chocolate', name: '深色博克 · 巧克力收尾版', en: 'Dunkels Bock · Chocolate Finish',
      styleId: '6C', country: '德国', brewery: '现代德式博克', era: 'modern', conf: 'B',
      story: '现代德国酒厂做深色博克时常掺一点巧克力麦芽来加深色度，代价是焦苦。' +
             '这条配方的做法是把巧克力麦芽压到 3% 以内、靠慕尼黑麦芽的窑烤色补足，因此收口比「全巧克力」版本甜得干净。',
      tags: ['拉格', '博克', '深色', '烤面包'],
      eff: 71, temp: 9, mashTemp: 67, carb: 2.4,
      malts: [['m-munich', 5.98], ['m-caramunich1', 0.4], ['m-chocolate', 0.08]],
      hops: [['h-magnum-de', 15.5, 'boil', 60],
             ['h-hallertau', 12, 'boil', 20]],
      yeast: ['y-w3470', 24], att: 77.5,
      water: { ca: 55, mg: 10, na: 18, cl: 55, so4: 45, hco3: 85 },
      salts: [['w-cacl2', 3]],
      notes: '氯化物偏高让麦芽甜更圆，硫酸盐压低避免深色麦芽的焦苦被拉出来。24 IBU 是这类酒的常规量，别再加。' +
             '67°C 糖化配双倍接种量，是 7% 以上拉格不产生溶剂味的两个前提。'
    },

    /* ---------------- 补齐空风格 第 2 批：7B 8A 9B 9C 10B ---------------- */
    {
      id: 'c4-altbier-duesseldorf', name: '老啤酒 · 杜塞尔多夫铜色', en: 'Altbier · Düsseldorf Copper',
      styleId: '7B', country: '德国', brewery: '杜塞尔多夫 Alt 传统', year: 1830, conf: 'B',
      story: 'Alt 在德语里就是「老」——指老式上发酵，相对于 19 世纪席卷欧洲的下发酵拉格。' +
             '杜塞尔多夫的老啤酒厂坚持用艾尔酵母在 15–16°C 低温发酵，再长时间低温熟成，做出接近拉格的干净度，却保留一点坚果与果酯。',
      tags: ['艾尔', '德式', '铜色', '苦'],
      eff: 74, temp: 16, mashTemp: 64, carb: 2.5,
      malts: [['m-munich', 3.01], ['m-pilsner', 1], ['m-caramunich1', 0.35], ['m-carafa2', 0.03]],
      hops: [['h-spalt', 50.3, 'boil', 60],
             ['h-tettnanger', 15, 'boil', 15]],
      yeast: ['y-1007', 14], att: 80,
      water: { ca: 60, mg: 10, na: 25, cl: 45, so4: 80, hco3: 60 },
      salts: [['w-gypsum', 4]],
      notes: '硫酸盐偏高是 Altbier 和科隆啤酒的分水岭：同样的苦度，30 IBU 在硫酸盐里显得干、在氯化物里显得圆。' +
             '低温发酵 15–16°C 是关键，20°C 以上会跑出明显的梨酯，那就不是 Alt 了。'
    },
    {
      id: 'c4-altbier-rhein', name: '老啤酒 · 莱茵河下游版', en: 'Altbier · Lower Rhine',
      styleId: '7B', country: '德国', brewery: '莱茵河下游 Alt 传统', era: 'modern', conf: 'B',
      story: '莱茵河下游的老啤酒比杜塞尔多夫市区版本更浅、更苦一点：皮尔森麦芽比例更高，结晶麦芽只留一点色，酒花用 Perle 与 Spalt 的组合。' +
             '这种差异在两地酒馆里是被认真争论的话题，虽然外人喝起来差别很小。',
      tags: ['艾尔', '德式', '干净', '苦'],
      eff: 75, temp: 15, mashTemp: 63, carb: 2.5,
      malts: [['m-pilsner', 2.84], ['m-munich', 0.9], ['m-c40', 0.3], ['m-chocolate', 0.09]],
      hops: [['h-perle', 27.5, 'boil', 60],
             ['h-spalt', 12, 'boil', 20]],
      yeast: ['y-wlp029', 14], att: 81,
      water: { ca: 65, mg: 10, na: 22, cl: 40, so4: 90, hco3: 55 },
      salts: [['w-gypsum', 5]],
      notes: '63°C 糖化把收口做干，13.2 SRM 的铜色只靠 30 克巧克力麦芽——再多就会往棕色艾尔跑。' +
             '发酵完在 4°C 放两周，Alt 的「拉格般干净」全靠这段冷熟成。'
    },
    {
      id: 'c4-munich-dunkel-bread', name: '慕尼黑深色拉格 · 面包干与可可', en: 'Munich Dunkel · Bread Crust',
      styleId: '8A', country: '德国', brewery: '巴伐利亚 Dunkel 传统', year: 1550, conf: 'B',
      story: '慕尼黑深色拉格是巴伐利亚在拉格化之前的日常酒：深色来自慕尼黑麦芽的长时间窑烤，不是烘烤麦芽。' +
             '1553 年巴伐利亚的夏季禁酿令逼着酒厂在冬天集中酿造、存进地窖，这套做法后来演变成拉格工艺本身。',
      tags: ['拉格', '深色', '麦芽', '巴伐利亚'],
      eff: 72, temp: 9, mashTemp: 67, carb: 2.4,
      malts: [['m-munich-dark', 3.61], ['m-pilsner', 1.2], ['m-carafa2', 0.12]],
      hops: [['h-hallertau', 35.1, 'boil', 60],
             ['h-hallertau', 12, 'boil', 15]],
      yeast: ['y-2206', 22], att: 75,
      water: { ca: 50, mg: 10, na: 15, cl: 40, so4: 40, hco3: 90 },
      salts: [['w-chalk', 3]],
      notes: '深慕尼黑麦芽给的是「烤面包皮」，不是「咖啡」——所以烘烤麦芽只放到 3% 以内，22.6 SRM 里绝大部分色度还是来自窑烤。' +
             '67°C 糖化保留糊精，Dunkel 的酒体比同浓度的皮尔森厚一档才对。'
    },
    {
      id: 'c4-munich-dunkel-double', name: '慕尼黑深色拉格 · 双慕尼黑版', en: 'Munich Dunkel · Double Munich',
      styleId: '8A', country: '德国', brewery: '现代巴伐利亚拉格', era: 'modern', conf: 'B',
      story: '巴伐利亚酒厂做 Dunkel 常见两种路线：一种全用深慕尼黑麦芽，颜色深、味道重；一种用浅慕尼黑加少量烘烤麦芽，更清爽。' +
             '这条走的是两者之间——浅慕尼黑打底、深慕尼黑补味、去壳深色麦芽只补色。',
      tags: ['拉格', '深色', '麦芽', '平衡'],
      eff: 73, temp: 8, mashTemp: 66, carb: 2.4,
      malts: [['m-munich', 3.22], ['m-munich-dark', 1.5], ['m-carafa2', 0.15]],
      hops: [['h-tettnanger', 35, 'boil', 60],
             ['h-hallertau', 10, 'boil', 20]],
      yeast: ['y-wlp833', 22], att: 75.5,
      water: { ca: 48, mg: 10, na: 15, cl: 45, so4: 38, hco3: 85 },
      salts: [['w-chalk', 2]],
      notes: '两条慕尼黑麦芽叠加，22.7 SRM 的深棕里带一点红；苦度 23 IBU 只够撑住麦芽甜，喝不出酒花味。' +
             '8°C 主发酵 + 4 周后熟，是这个风格不出硫味的最低配置。'
    },
    {
      id: 'c4-eisbock-base', name: '冰博克 · 入冻前的双料博克', en: 'Eisbock · Pre-Freeze Doppelbock',
      styleId: '9B', country: '德国', brewery: '德式冰博克传统', year: 1900, conf: 'B',
      story: '冰博克是一次意外：19 世纪末巴伐利亚有酒厂把一桶双料博克忘在冬夜的户外，酒里的水结成冰被捞走，剩下的酒更浓也更甜。' +
             '今天德国仍允许这种「冷冻浓缩」工艺，前提是酒液不能接触冰以外的任何添加物。',
      tags: ['拉格', '博克', '高浓', '甜'],
      eff: 68, temp: 10, mashTemp: 67, carb: 2.3,
      malts: [['m-munich-dark', 7.86], ['m-pilsner', 1.5], ['m-caramunich1', 0.3], ['m-carafa2', 0]],
      hops: [['h-magnum-de', 24.3, 'boil', 60],
             ['h-hallertau', 18, 'boil', 20]],
      yeast: ['y-wlp833', 30], att: 73,
      water: { ca: 55, mg: 10, na: 20, cl: 55, so4: 45, hco3: 100 },
      salts: [['w-cacl2', 4]],
      notes: '这条给的是入冻前的基酒：1.094 的麦汁、30 IBU，冻掉一成水之后，OG 约 1.104、11% 左右的酒精度——那才是冰博克本身。别指望一次糖化就做出冰博克那个酒精度——原麦汁浓度太高，糖化效率会掉。' +
             '冷冻浓缩要用宽口容器慢冻，温度 −18°C 冻 12 小时，捞冰时别把有色部分一起带走。'
    },
    {
      id: 'c4-eisbock-homefreeze', name: '冰博克 · 家酿冻提版', en: 'Eisbock · Home Freeze Concentrate',
      styleId: '9B', country: '德国', brewery: '家酿冻提做法', era: 'modern', conf: 'B',
      story: '家酿做冰博克的风险不在配方，在卫生与法规：冷冻浓缩会把酒里的酒精和风味一起浓缩，也会把任何一点杂质一起浓缩。' +
             '所以基酒必须发酵完全、澄清彻底，冻提只是最后一步，不是补救手段。',
      tags: ['拉格', '博克', '高浓', '工艺'],
      eff: 66, temp: 9, mashTemp: 66, carb: 2.2,
      malts: [['m-munich', 8.5], ['m-munich-dark', 1.8], ['m-caramunich1', 0.4], ['m-carafa3', 0]],
      hops: [['h-hallertau', 65.3, 'boil', 60],
             ['h-tettnanger', 20, 'boil', 20]],
      yeast: ['y-2206', 30], att: 75,
      water: { ca: 50, mg: 10, na: 18, cl: 60, so4: 40, hco3: 95 },
      salts: [['w-cacl2', 5]],
      notes: '66°C 糖化、66% 效率，基酒做到 1.103；冻提后酒精与甜味同时上升，23.6 SRM 的深棕也会变得更浓。冻掉一成水后，OG 约 1.114、12% 左右的酒精度。' +
             '冻提后的酒精度不好估，装瓶前用比重计实测，别按计算值算碳化糖量。'
    },
    {
      id: 'c4-baltic-porter-munich', name: '波罗的海波特 · 慕尼黑打底', en: 'Baltic Porter · Munich Base',
      styleId: '9C', country: '波兰', brewery: '波罗的海波特传统', year: 1880, conf: 'B',
      story: '波罗的海波特是英式波特在波罗的海沿岸的本地化：用下发酵酵母、慕尼黑麦芽与深色糖浆，做出比英式波特更干净、更甜、酒精度更高的版本。' +
             '它能在 19 世纪的波罗的海贸易路线上流行，靠的正是下发酵带来的耐运输稳定性。',
      tags: ['拉格', '波特', '深色', '麦芽'],
      eff: 70, temp: 12, mashTemp: 66, carb: 2.4,
      malts: [['m-munich', 5.25], ['m-pilsner', 1.5], ['m-caramunich1', 0.5], ['m-carafa2', 0.14]],
      hops: [['h-magnum-de', 19.5, 'boil', 60],
             ['h-styrian', 20, 'boil', 20]],
      yeast: ['y-wlp833', 26], att: 76.5,
      water: { ca: 60, mg: 12, na: 25, cl: 55, so4: 55, hco3: 110 },
      salts: [['w-chalk', 3]],
      notes: '下发酵让 23.4 SRM 的深色酒依然干净；慕尼黑麦芽给面包，去壳深色麦芽给颜色但不给焦苦。' +
             '12°C 主发酵比拉格常用的 9°C 高一点，是为了让麦芽甜更充分，酯不会过量。'
    },
    {
      id: 'c4-baltic-porter-candi', name: '波罗的海波特 · 深色糖浆版', en: 'Baltic Porter · Candi Syrup',
      styleId: '9C', country: '波兰', brewery: '波兰深色糖浆传统', era: 'modern', conf: 'B',
      story: '波兰与立陶宛的酒厂做波罗的海波特常用深色糖浆提浓度和颜色，而不是靠更多烘烤麦芽——糖浆带来的是葡萄干与枣的甜，烘烤麦芽带来的是焦苦。' +
             '这两条路做出来的酒，闻起来像两个风格。',
      tags: ['拉格', '波特', '糖浆', '深色'],
      eff: 72, temp: 11, mashTemp: 65, carb: 2.4,
      malts: [['m-pilsner', 4.74], ['m-munich', 1.5], ['m-candid180', 0.6], ['m-carafa3', 0]],
      hops: [['h-hallertau', 48.9, 'boil', 60],
             ['h-tettnanger', 25, 'boil', 20]],
      yeast: ['y-2206', 26], att: 74,
      water: { ca: 55, mg: 12, na: 30, cl: 60, so4: 50, hco3: 120 },
      salts: [['w-chalk', 4]],
      notes: '深色糖浆占麦单约一成，1.076 里有一部分点数来自它——糖浆不需要糖化，所以效率那一栏对它不起作用。' +
             '糖浆在煮沸最后 10 分钟加，早加会让色度再深一档、香气损失一半。'
    },
    {
      id: 'c4-dunkelweizen-clove', name: '德式深色小麦 · 丁香与烤香蕉', en: 'Dunkels Weissbier · Clove & Banana',
      styleId: '10B', country: '德国', brewery: '巴伐利亚小麦啤传统', year: 1700, conf: 'B',
      story: '德式深色小麦在巴伐利亚的地位曾经比浅色版更高：小麦啤在 16–19 世纪是巴伐利亚王室特许的专营品，深色版本靠深色小麦麦芽与少量烘烤麦芽做出李子与可可的底。' +
             '酵母的丁香（4-乙烯基愈创木酚）才是这个风格的签名。',
      tags: ['小麦', '德式', '丁香', '香蕉'],
      eff: 73, temp: 18, mashTemp: 63, carb: 2.9,
      malts: [['m-wheat', 2.45], ['m-pilsner', 1], ['m-munich', 0.8], ['m-carafa2', 0.18]],
      hops: [['h-hallertau', 20.2, 'boil', 60]],
      yeast: ['y-3068', 12], att: 77.5,
      water: { ca: 45, mg: 10, na: 15, cl: 60, so4: 35, hco3: 80 },
      salts: [['w-cacl2', 4]],
      notes: '63°C 休止 20 分钟是为了阿魏酸——它是丁香酚的前体，跳过这一步就只有香蕉没有丁香。苦度只到 12 IBU，多一点也不该尝出来。' +
             '装瓶碳化拉到 2.9 vol，小麦啤的气泡感是风格的一部分。'
    },
    {
      id: 'c4-dunkelweizen-darkwheat', name: '德式深色小麦 · 深色小麦麦芽版', en: 'Dunkels Weissbier · Dark Wheat Malt',
      styleId: '10B', country: '德国', brewery: '现代德式小麦', era: 'modern', conf: 'B',
      story: '现代酒厂做深色小麦常用深色小麦麦芽而不是烘烤麦芽：前者是窑烤出来的，带面包与蜂蜜；后者是烘出来的，带焦苦。' +
             '这条配方把深色小麦放在基麦位置，所以它的深色是「烤过的麦芽香」，不是「烤焦的壳」。',
      tags: ['小麦', '德式', '麦芽', '浑浊'],
      eff: 72, temp: 18, mashTemp: 64, carb: 2.9,
      malts: [['m-darkwheat', 1.98], ['m-wheat', 1.5], ['m-pilsner', 0.8], ['m-carafa2', 0.17]],
      hops: [['h-tettnanger', 20.2, 'boil', 60]],
      yeast: ['y-wlp300', 12], att: 77.5,
      water: { ca: 45, mg: 10, na: 15, cl: 65, so4: 30, hco3: 85 },
      salts: [['w-cacl2', 5]],
      notes: '深色小麦麦芽做基麦，18.7 SRM 的深琥珀色里没有焦苦；氯化物 65 ppm 让酒体更圆。' +
             '这个风格不追求清澈——装瓶时带一点酵母反而更接近原版。'
    },

    /* ---------------- 补齐空风格 第 3 批：10C 11A 11C 12B 13A ---------------- */
    {
      id: 'c4-weizenbock-helles', name: '小麦博克 · 浅色版', en: 'Weizenbock · Helles',
      styleId: '10C', country: '德国', brewery: '巴伐利亚小麦博克传统', year: 1907, conf: 'B',
      story: '小麦博克是巴伐利亚把博克的浓度套到小麦啤上：1907 年慕尼黑的 Schneider 酒厂推出 Aventinus 之后，这个风格才有了固定名字。' +
             '浅色版更少见，因为它要求小麦麦芽在不加深颜色的前提下撑起 7% 以上的酒体。',
      tags: ['小麦', '博克', '烈性', '德式'],
      eff: 71, temp: 18, mashTemp: 64, carb: 2.9,
      malts: [['m-wheat', 5.73], ['m-munich', 1.5], ['m-carafa2', 0.02]],
      hops: [['h-hallertau', 43.9, 'boil', 60],
             ['h-hallertau', 10, 'boil', 15]],
      yeast: ['y-3068', 16], att: 75,
      water: { ca: 50, mg: 10, na: 15, cl: 65, so4: 35, hco3: 85 },
      salts: [['w-cacl2', 4]],
      notes: '小麦比例过半，糖化时加一把稻壳防滤槽堵死。9.4 SRM 的金铜色只靠 40 克去壳深色麦芽，多一点就变深色版了。' +
             '16°C 发酵能同时保住香蕉与丁香；20°C 以上香蕉会盖掉一切，酒精度又让这件事更明显。'
    },
    {
      id: 'c4-weizenbock-dunkel', name: '小麦博克 · 深色版（Aventinus 路线）', en: 'Weizenbock · Dunkel',
      styleId: '10C', country: '德国', brewery: '慕尼黑小麦博克传统', era: 'modern', conf: 'B',
      story: '深色小麦博克几乎被一款酒定义了：慕尼黑 Schneider 的 Aventinus 从 1907 年卖到今天，李子、丁香、香蕉与巧克力的组合成了这个风格的参照系。' +
             '它证明小麦啤的酵母酯香可以承载 8% 的酒精度而不显得腻。',
      tags: ['小麦', '博克', '深色', '李子'],
      eff: 70, temp: 17, mashTemp: 65, carb: 2.9,
      malts: [['m-wheat', 4.93], ['m-munich-dark', 1.5], ['m-carafa3', 0.15]],
      hops: [['h-tettnanger', 38.5, 'boil', 60],
             ['h-hallertau', 12, 'boil', 20]],
      yeast: ['y-wlp300', 16], att: 74,
      water: { ca: 48, mg: 10, na: 18, cl: 70, so4: 35, hco3: 95 },
      salts: [['w-cacl2', 5]],
      notes: '深色来自深慕尼黑麦芽，不是烘烤麦芽——所以 21.7 SRM 的酒喝起来是李子干而不是咖啡。氯化物 70 ppm 让酒体更「厚」。' +
             '小麦博克不需要长时间后熟，但装瓶后放三周，丁香会从「冲」变得「整」。'
    },
    {
      id: 'c4-ordinary-bitter-session', name: '普通苦啤 · 3.5% 的日常口粮', en: 'Ordinary Bitter · Session',
      styleId: '11A', country: '英国', brewery: '英式酒馆苦啤传统', year: 1900, conf: 'B',
      story: '英式苦啤的「苦」在 20 世纪指的是「比淡艾尔更苦」，不是「很苦」。' +
             '普通苦啤是酒吧里按品脱续的那一档：3.2–3.8% 酒精度，一口下去先苦后干，配得上任何一顿午饭。' +
             '它被低估，是因为低度酒没有地方藏瑕疵。',
      tags: ['艾尔', '英式', '低度', '苦'],
      eff: 74, temp: 19, mashTemp: 63, carb: 2.2,
      malts: [['m-marisotter', 2.88], ['m-c60', 0.12], ['m-chocolate', 0.08]],
      hops: [['h-ekg', 36.8, 'boil', 60],
             ['h-fuggle', 10, 'boil', 15]],
      yeast: ['y-s04', 12], att: 77,
      water: { ca: 80, mg: 12, na: 25, cl: 50, so4: 150, hco3: 60 },
      salts: [['w-gypsum', 8], ['w-epsom', 2]],
      notes: '硫酸盐 150 ppm 是英式苦啤的骨架：它把 30 IBU 的苦拉成「干苦」而不是「闷苦」。结晶麦芽只放 4%，多了 FG 会顶到区间外。' +
             '63°C 糖化是为了把 3.5% 的酒做干；这个浓度下残糖一多就显得水。'
    },
    {
      id: 'c4-ordinary-bitter-london', name: '普通苦啤 · 伦敦酒馆版', en: 'Ordinary Bitter · London Pub',
      styleId: '11A', country: '英国', brewery: '伦敦苦啤传统', era: 'modern', conf: 'B',
      story: '伦敦与英格兰北部的苦啤是两种酒：南部偏重结晶麦芽与糖，颜色深、酒体圆；北部偏重干爽与苦味。' +
             '这条走伦敦路线——黄金诺言麦芽打底、一点深色结晶，收口仍然要干，因为 3.5% 的酒没有本钱甜。',
      tags: ['艾尔', '英式', '酒馆', '平衡'],
      eff: 75, temp: 19, mashTemp: 64, carb: 2.2,
      malts: [['m-goldenpromise', 2.73], ['m-c40', 0.18], ['m-chocolate-uk', 0.07]],
      hops: [['h-challenger', 23.6, 'boil', 60],
             ['h-ekg', 12, 'boil', 15]],
      yeast: ['y-nottingham', 12], att: 79,
      water: { ca: 90, mg: 12, na: 28, cl: 55, so4: 160, hco3: 65 },
      salts: [['w-gypsum', 9]],
      notes: '挑战者做主苦、EKG 收尾，是 1970 年代以后伦敦酒厂的常见组合。30 IBU 不算高，但在 1.035 的麦汁里非常显眼。' +
             '英式酵母容易双乙酰，发酵末期升到 20°C 放两天再降温。'
    },
    {
      id: 'c4-strong-bitter-esb', name: '强苦啤 · ESB 的骨架', en: 'Strong Bitter · ESB Frame',
      styleId: '11C', country: '英国', brewery: '英式强苦啤传统', year: 1971, conf: 'B',
      story: 'ESB 是 Fuller\'s 在 1971 年给自家强苦啤起的商品名，后来变成一整个子风格的代称。' +
             '它的结构很简单：把普通苦啤的麦汁浓度提高三成、酒花跟着提，但糖化温度不动——所以它比同浓度的艾尔更干，酒精感藏在苦味后面。',
      tags: ['艾尔', '英式', '烈性', '苦'],
      eff: 74, temp: 19, mashTemp: 64, carb: 2.3,
      malts: [['m-marisotter', 4.19], ['m-c60', 0.3], ['m-chocolate', 0.07]],
      hops: [['h-challenger', 33.5, 'boil', 60],
             ['h-ekg', 25, 'boil', 15],
             ['h-ekg', 20, 'dryhop', 0]],
      yeast: ['y-wlp007', 14], att: 79,
      water: { ca: 100, mg: 14, na: 30, cl: 60, so4: 200, hco3: 70 },
      salts: [['w-gypsum', 12], ['w-epsom', 3]],
      notes: '硫酸盐 200 ppm 是这条配方的性格；超过 250 会开始有「火柴头」的矿物质感。40 IBU 配 1.053 的麦汁，正好是「苦得明显但不扎嘴」。' +
             '干投 EKG 三天就够，英式酒花的香气很脆，泡久了变成干草。'
    },
    {
      id: 'c4-strong-bitter-north', name: '强苦啤 · 英格兰北部版', en: 'Strong Bitter · Northern',
      styleId: '11C', country: '英国', brewery: '英格兰北部苦啤传统', era: 'modern', conf: 'B',
      story: '北部的强苦啤比伦敦版本更干、更苦、颜色更浅：水里的硫酸盐更高，结晶麦芽更少，酒花用 Target 与 Challenger 这类高 α 品种。' +
             '它的存在说明「ESB」不是一种配方，而是一个浓度档。',
      tags: ['艾尔', '英式', '干爽', '苦'],
      eff: 75, temp: 18, mashTemp: 63, carb: 2.3,
      malts: [['m-marisotter', 4.16], ['m-c40', 0.22], ['m-blackpatent', 0.07]],
      hops: [['h-target', 22.3, 'boil', 60],
             ['h-challenger', 20, 'boil', 15]],
      yeast: ['y-1968', 14], att: 75,
      water: { ca: 110, mg: 14, na: 30, cl: 55, so4: 220, hco3: 60 },
      salts: [['w-gypsum', 14]],
      notes: '黑专利麦芽只放 50 克左右，13 SRM 的琥珀色全靠它；它对 FG 的影响几乎为零，因为用量太小。' +
             '1968 絮凝性极强，发酵结束后降温到 12°C 两天再排酵母，酒会更清。'
    },
    {
      id: 'c4-aussie-sparkling-coopers', name: '澳式起泡艾 · 南澳瓶内二次发酵', en: 'Australian Sparkling Ale · Bottle-Conditioned',
      styleId: '12B', country: '澳大利亚', brewery: '南澳起泡艾传统', year: 1862, conf: 'B',
      story: '澳式起泡艾是南澳的招牌：用非常高的表观衰减把酒做到 1.006 以下，再瓶内二次发酵产生大量气泡，所以叫 sparkling。' +
             '它的历史与 19 世纪南澳的硬水、本地六棱大麦以及「不用冷藏也能稳定运输」的需求直接相关。',
      tags: ['艾尔', '澳洲', '干爽', '气泡'],
      eff: 76, temp: 20, mashTemp: 63, carb: 3,
      malts: [['m-pilsner', 3], ['m-wheat', 0.5], ['m-c40', 0.24]],
      hops: [['h-galaxy', 8.1, 'boil', 60],
             ['h-galaxy', 15, 'boil', 15]],
      yeast: ['y-bellesaison', 14], att: 92,
      water: { ca: 70, mg: 12, na: 30, cl: 60, so4: 100, hco3: 60 },
      salts: [['w-gypsum', 6], ['w-cacl2', 3]],
      notes: '这个风格的关键不是香气而是衰减度：1.005 的收口才是「起泡艾」和「淡色艾尔」的分界。库里的酵母没有澳洲菌株，用高衰减的赛松菌株替代，酯香会略有偏差。' +
             '瓶内二次发酵按 3.0 vol 算糖，这个风格的气泡感是风格本身，不是失误。'
    },
    {
      id: 'c4-aussie-sparkling-modern', name: '澳式起泡艾 · 现代干投版', en: 'Australian Sparkling Ale · Modern Dry-Hop',
      styleId: '12B', country: '澳大利亚', brewery: '现代澳洲精酿', era: 'modern', conf: 'B',
      story: '现代澳洲酒厂会给起泡艾加一道 Galaxy 或 Topaz 的干投，把原本只有一点点果香的酒做成「低度 IPA」。' +
             '这么做有争议：老派酿酒师认为起泡艾的价值就在于「什么都不多」，多一点酒花就不再是它。',
      tags: ['艾尔', '澳洲', '干投', '热带水果'],
      eff: 76, temp: 21, mashTemp: 63, carb: 3,
      malts: [['m-2row', 3.21], ['m-wheat', 0.4], ['m-c60', 0.15]],
      hops: [['h-topaz', 9.6, 'boil', 60],
             ['h-galaxy', 20, 'whirlpool', 15, 85],
             ['h-galaxy', 30, 'dryhop', 0]],
      yeast: ['y-be134', 14], att: 90.5,
      water: { ca: 75, mg: 12, na: 28, cl: 55, so4: 120, hco3: 55 },
      salts: [['w-gypsum', 7]],
      notes: '干投 30 克 Galaxy 只泡两天，泡久了会有明显的「洋葱」。28 IBU 里有一半来自回旋，不是煮沸。' +
             '干投会让酒变浑浊，这个风格传统上是清澈的；要清就冷降两天再装瓶。'
    },
    {
      id: 'c4-dark-mild-nottingham', name: '深色温和啤酒 · 3% 的英式日常', en: 'Dark Mild · Session Dark',
      styleId: '13A', country: '英国', brewery: '英式 Mild 传统', year: 1900, conf: 'B',
      story: 'Mild 在 19 世纪原本是「不陈放的淡艾尔」，颜色并不深；到 20 世纪，英国的酒厂把 Mild 越做越淡、越做越深色，最后变成今天这种 3% 上下、深棕、几乎不苦的「工人啤酒」。' +
             '它在本土酒吧里活得比任何精酿风格都久。',
      tags: ['艾尔', '英式', '低度', '深色'],
      eff: 76, temp: 19, mashTemp: 63, carb: 2,
      malts: [['m-marisotter', 2.62], ['m-c60', 0.18], ['m-blackpatent', 0.17]],
      hops: [['h-fuggle', 21.9, 'boil', 60],
             ['h-ekg', 8, 'boil', 15]],
      yeast: ['y-nottingham', 12], att: 77,
      water: { ca: 85, mg: 12, na: 30, cl: 70, so4: 90, hco3: 110 },
      salts: [['w-chalk', 3], ['w-cacl2', 3]],
      notes: '3% 的酒最难做：18 IBU 的苦要在 1.035 的麦汁里显得「有」，又不能盖过焦糖。糖化压到 63°C 把收口做干是唯一办法。' +
             '碳酸化只到 2.0 vol，英式低度酒本来就不该有气。'
    },
    {
      id: 'c4-dark-mild-windsor', name: '深色温和啤酒 · 棕色麦芽版', en: 'Dark Mild · Brown Malt',
      styleId: '13A', country: '英国', brewery: '现代英式 Mild', era: 'modern', conf: 'B',
      story: '棕色麦芽是 18 世纪英国波特时代的遗产，今天主要活在 Mild 与老艾尔里。' +
             '它带来的不是焦苦而是「烤饼干」的干香，正好补上 Mild 缺乏中段味道的短板。' +
             '这条配方用它替代一半结晶麦芽，让 3% 的酒也有层次。',
      tags: ['艾尔', '英式', '低度', '饼干'],
      eff: 75, temp: 19, mashTemp: 63, carb: 2,
      malts: [['m-mild', 2.52], ['m-brown', 0.25], ['m-c80', 0.15], ['m-blackpatent', 0.12]],
      hops: [['h-ekg', 21.3, 'boil', 60],
             ['h-fuggle', 6, 'boil', 15]],
      yeast: ['y-windsor', 12], att: 75.5,
      water: { ca: 80, mg: 12, na: 32, cl: 75, so4: 85, hco3: 120 },
      salts: [['w-chalk', 4], ['w-cacl2', 2]],
      notes: '棕色麦芽 8% 是上限，再多就变成「小波特」。19.4 SRM 的深棕里带一点红，来自 80L 结晶。' +
             '温莎酵母衰减偏低，所以糖化一定要 63°C，否则 FG 会顶到区间上沿。'
    },

    /* ---------------- 补齐空风格 第 4 批：13B 14A 14B 15C 16C ---------------- */
    {
      id: 'c4-british-brown-nutty', name: '英式棕艾尔 · 坚果与太妃', en: 'British Brown Ale · Nutty Toffee',
      styleId: '13B', country: '英国', brewery: '英式棕艾尔传统', year: 1900, conf: 'B',
      story: '英式棕艾尔在 20 世纪几乎消失：它被更淡的 Mild 和更深的波特夹在中间，两头都不讨好。' +
             '1970 年代真实艾尔运动把它从故纸堆里翻出来，配方依据是二战前后的酒厂记录——马里斯奥特麦芽、棕色麦芽与少量巧克力麦芽。',
      tags: ['艾尔', '英式', '坚果', '焦糖'],
      eff: 75, temp: 19, mashTemp: 63, carb: 2.2,
      malts: [['m-marisotter', 3.49], ['m-c60', 0.25], ['m-brown', 0.2], ['m-chocolate', 0.13]],
      hops: [['h-ekg', 32.1, 'boil', 60],
             ['h-fuggle', 12, 'boil', 15]],
      yeast: ['y-nottingham', 12], att: 81,
      water: { ca: 90, mg: 12, na: 28, cl: 60, so4: 130, hco3: 90 },
      salts: [['w-gypsum', 6], ['w-chalk', 2]],
      notes: '棕色麦芽给「烤饼干」，巧克力麦芽只补色。17.1 SRM 的棕色如果靠巧克力麦芽堆出来，会带上焦苦，那就成了小波特。' +
             '63°C 糖化把 1.047 的麦汁做得足够干，否则 60L 结晶的甜会盖住坚果。'
    },
    {
      id: 'c4-british-brown-notts', name: '英式棕艾尔 · 诺丁汉郡版', en: 'British Brown Ale · Nottinghamshire',
      styleId: '13B', country: '英国', brewery: '诺丁汉郡棕艾尔传统', era: 'modern', conf: 'B',
      story: '诺丁汉郡的酒厂做棕艾尔偏爱琥珀麦芽而不是棕色麦芽：琥珀麦芽的色度更低、味道更「面包」，配上温和艾尔麦芽的饱满麦香，整体比南方版本轻一点。' +
             '这条配方是战后英式棕艾尔的常见骨架。',
      tags: ['艾尔', '英式', '面包', '平衡'],
      eff: 74, temp: 19, mashTemp: 64, carb: 2.2,
      malts: [['m-mild', 3.58], ['m-c40', 0.2], ['m-amber', 0.25], ['m-chocolate-uk', 0.11]],
      hops: [['h-challenger', 21.8, 'boil', 60],
             ['h-ekg', 10, 'boil', 15]],
      yeast: ['y-wlp007', 12], att: 80,
      water: { ca: 85, mg: 12, na: 26, cl: 65, so4: 120, hco3: 85 },
      salts: [['w-gypsum', 5], ['w-cacl2', 2]],
      notes: '琥珀麦芽 12% 是上限，再多会让 16.8 SRM 的棕偏「烤」。25 IBU 在这个浓度下刚好压住太妃糖的甜。' +
             '英式酵母絮凝好，装瓶前不用过滤也能清；但别为了清透去冷降太久，会把酯香一起带走。'
    },
    {
      id: 'c4-scottish-light-60sh', name: '苏格兰淡啤 · 60 先令', en: 'Scottish Light · 60 Shilling',
      styleId: '14A', country: '英国', brewery: '苏格兰 60 先令传统', year: 1850, conf: 'B',
      story: '苏格兰的「先令」标法原本是税制留下的价格分级，不是浓度标准，但酒厂沿用至今：60 先令是最轻的一档，2.5–3.3% 的酒精度。' +
             '它的特征不是烟熏，而是「高糖化温度 + 长时间煮沸」带来的焦糖化麦芽甜。',
      tags: ['艾尔', '苏格兰', '低度', '焦糖'],
      eff: 74, temp: 17, mashTemp: 68, carb: 2,
      malts: [['m-marisotter', 2.42], ['m-c80', 0.15], ['m-roastedbarley', 0.31]],
      hops: [['h-ekg', 20.3, 'boil', 60]],
      yeast: ['y-wlp028', 12], att: 72,
      water: { ca: 60, mg: 10, na: 25, cl: 60, so4: 60, hco3: 130 },
      salts: [['w-chalk', 4], ['w-cacl2', 3]],
      notes: '烘烤大麦只到 8% 左右，20.9 SRM 的深棕里要有红；再多就是世涛的方向了。苦度只到 15 IBU，苏格兰淡啤不靠苦平衡。' +
             '68°C 糖化留大量糊精，是这个 3% 的酒不显水的唯一办法。'
    },
    {
      id: 'c4-scottish-light-highland', name: '苏格兰淡啤 · 高地版', en: 'Scottish Light · Highland',
      styleId: '14A', country: '英国', brewery: '苏格兰高地传统', era: 'modern', conf: 'B',
      story: '高地与低地的苏格兰艾尔差别在水与酵母：高地水更软，酒体更圆；低地用爱丁堡的硬水，收口更干。' +
             '这条走高地的软水路线，用黄金诺言麦芽与深色结晶撑颜色，苦度压到 15 IBU 以下。',
      tags: ['艾尔', '苏格兰', '低度', '软水'],
      eff: 73, temp: 17, mashTemp: 68, carb: 2,
      malts: [['m-goldenpromise', 2.61], ['m-c120', 0.12], ['m-blackpatent', 0.18]],
      hops: [['h-fuggle', 22.2, 'boil', 60]],
      yeast: ['y-1968', 12], att: 69.5,
      water: { ca: 40, mg: 8, na: 20, cl: 55, so4: 40, hco3: 110 },
      salts: [['w-chalk', 3], ['w-cacl2', 2]],
      notes: '黑专利麦芽 1% 就能把 20.7 SRM 拉到位，同时对 FG 几乎没有影响——这是低度深色酒最省事的做法。' +
             '1968 絮凝强、衰减低，配合 68°C 糖化要小心 FG 顶上界：宁可糖化 67°C。'
    },
    {
      id: 'c4-scottish-heavy-70sh', name: '苏格兰中啤 · 70 先令', en: 'Scottish Heavy · 70 Shilling',
      styleId: '14B', country: '英国', brewery: '苏格兰 70 先令传统', year: 1850, conf: 'B',
      story: '70 先令在苏格兰的酒馆里叫「Heavy」——不是「重」，而是「比 60 先令重一档」。' +
             '它常被当作苏格兰艾尔的代表：麦芽甜、苦度低、收口干，喝起来像加了焦糖的黑面包。',
      tags: ['艾尔', '苏格兰', '焦糖', '低苦'],
      eff: 74, temp: 18, mashTemp: 67, carb: 2.1,
      malts: [['m-marisotter', 2.95], ['m-c60', 0.2], ['m-roastedbarley', 0.18]],
      hops: [['h-ekg', 21.1, 'boil', 60]],
      yeast: ['y-wlp028', 12], att: 73.5,
      water: { ca: 65, mg: 10, na: 25, cl: 65, so4: 65, hco3: 120 },
      salts: [['w-chalk', 3], ['w-cacl2', 3]],
      notes: '氯化物高于硫酸盐，是苏格兰艾尔「圆」的来源。15.8 SRM 的深琥珀配 15 IBU，苦味几乎只是背景。' +
             '传统做法要煮沸 90 分钟做焦糖化；用 60 分钟也可以，但麦芽甜会薄一点。'
    },
    {
      id: 'c4-scottish-heavy-double', name: '苏格兰中啤 · 双料结晶版', en: 'Scottish Heavy · Double Crystal',
      styleId: '14B', country: '英国', brewery: '现代苏格兰艾尔', era: 'modern', conf: 'B',
      story: '现代苏格兰艾尔常把两种结晶麦芽叠起来用：60L 给太妃糖，120L 给葡萄干。' +
             '这么做能用更少的烘烤麦芽达到同样的色度，代价是 FG 会抬高——低度酒里这一点残糖很容易被尝出来。',
      tags: ['艾尔', '苏格兰', '结晶', '麦芽'],
      eff: 75, temp: 18, mashTemp: 66, carb: 2.1,
      malts: [['m-mild', 2.93], ['m-c80', 0.18], ['m-chocolate', 0.13]],
      hops: [['h-fuggle', 19, 'boil', 60],
             ['h-ekg', 6, 'boil', 20]],
      yeast: ['y-nottingham', 12], att: 74,
      water: { ca: 70, mg: 10, na: 24, cl: 70, so4: 60, hco3: 115 },
      salts: [['w-cacl2', 4], ['w-chalk', 2]],
      notes: '温和艾尔麦芽比马里斯奥特更「麦」，配 80L 结晶刚好是葡萄干而不是咖啡。15.8 SRM 全靠 60 克巧克力麦芽补最后一格。' +
             '66°C 糖化，别再高了；这条的 FG 已经在区间上半段。'
    },
    {
      id: 'c4-irish-extra-stout-dublin', name: '爱尔兰浓世涛 · 都柏林放大版', en: 'Irish Extra Stout · Dublin Strong',
      styleId: '15C', country: '爱尔兰', brewery: '都柏林世涛传统', year: 1800, conf: 'B',
      story: '爱尔兰浓世涛是都柏林干世涛的加强版：同样的烘烤大麦骨架，麦汁浓度提高三成，酒精度到 5–6.5%。' +
             '19 世纪都柏林的酒厂把这种酒叫作「双倍世涛」，出口到英国与殖民地，是当时爱尔兰最重要的工业出口品之一。',
      tags: ['世涛', '爱尔兰', '烘烤', '浓'],
      eff: 72, temp: 19, mashTemp: 66, carb: 2.2,
      malts: [['m-marisotter', 3.91], ['m-flakedbarley', 0.5], ['m-chocolate', 0.3], ['m-roastedbarley', 0.4]],
      hops: [['h-target', 27.3, 'boil', 60],
             ['h-ekg', 20, 'boil', 15]],
      yeast: ['y-nottingham', 14], att: 85,
      water: { ca: 80, mg: 12, na: 30, cl: 60, so4: 90, hco3: 150 },
      salts: [['w-chalk', 5], ['w-gypsum', 3]],
      notes: '烘烤大麦（未发芽）是爱尔兰世涛的签名：它给的是干苦与咖啡，不是巧克力麦芽的甜。34.9 SRM 里有八成来自它。' +
             '都柏林酵母（WLP004）的衰减只有 71%，做不出 1.012 的收口，这里换成衰减更高的诺丁汉——风格要求的「干」比菌株血统更重要。'
    },
    {
      id: 'c4-irish-extra-stout-double', name: '爱尔兰浓世涛 · 双烘烤版', en: 'Irish Extra Stout · Double Roast',
      styleId: '15C', country: '爱尔兰', brewery: '现代爱尔兰世涛', era: 'modern', conf: 'B',
      story: '把烘烤大麦与烘烤小麦叠起来，是现代爱尔兰世涛常见的做法：前者给咖啡与干苦，后者给更细的烘烤感与更深的颜色。' +
             '两条路线合起来，能在不加巧克力麦芽的前提下把色度做到 35 SRM 以上。',
      tags: ['世涛', '爱尔兰', '咖啡', '浓'],
      eff: 71, temp: 19, mashTemp: 66, carb: 2.2,
      malts: [['m-marisotter', 4.09], ['m-flakedoats', 0.4], ['m-blackpatent', 0.15], ['m-roastwheat', 0.33]],
      hops: [['h-target', 26.1, 'boil', 60],
             ['h-fuggle', 25, 'boil', 15]],
      yeast: ['y-1084', 14], att: 79,
      water: { ca: 85, mg: 12, na: 32, cl: 65, so4: 95, hco3: 160 },
      salts: [['w-chalk', 6], ['w-gypsum', 3]],
      notes: '燕麦片让 34.8 SRM 的酒体不至于「瘦成黑水」；黑专利只放 3%，多了会有明显的烧焦橡皮味。' +
             '爱尔兰酵母絮凝极好，发酵结束静置两天就能装瓶，不必过滤。'
    },
    {
      id: 'c4-tropical-stout-caribbean', name: '热带世涛 · 加勒比甜世涛的浓版', en: 'Tropical Stout · Caribbean Strong',
      styleId: '16C', country: '牙买加', brewery: '加勒比热带世涛传统', year: 1900, conf: 'B',
      story: '热带世涛是英式世涛在加勒比与西非的本地化：当地气温高、发酵快，酒厂把麦汁浓度提高以抑制杂菌，又用玉米或糖把酒体收薄，做出「深色但顺口」的酒。' +
             '它比英式世涛甜、比牛奶世涛干，性格很独特。',
      tags: ['世涛', '加勒比', '深色', '顺口'],
      eff: 73, temp: 21, mashTemp: 65, carb: 2.6,
      malts: [['m-2row', 4.12], ['m-flakedcorn', 0.5], ['m-c60', 0.3], ['m-roastedbarley', 0.71]],
      hops: [['h-cluster', 50.3, 'boil', 60]],
      yeast: ['y-us05', 14], att: 85.5,
      water: { ca: 60, mg: 10, na: 35, cl: 70, so4: 60, hco3: 140 },
      salts: [['w-chalk', 4], ['w-cacl2', 3]],
      notes: '21°C 发酵是这条配方的地理属性，不是偷懒；高温带来的果酯正好和烘烤麦芽的咖啡对上。35.1 SRM 的深黑靠烘烤大麦，玉米只负责把酒体削薄。' +
             '这类酒在原产地常加糖浆增稠，家酿不必——1.064 的麦汁已经够撑起酒体。'
    },
    {
      id: 'c4-tropical-stout-jamaica', name: '热带世涛 · 牙买加浓甜版', en: 'Tropical Stout · Jamaican Sweet',
      styleId: '16C', country: '牙买加', brewery: '牙买加甜世涛传统', era: 'modern', conf: 'B',
      story: '牙买加版本的甜度更高：结晶麦芽比例上到一成以上，苦度压低，喝起来接近「黑糖水」。' +
             '这种风格在当地是配辣食与甜点的酒，不是佐餐苦酒；理解这一点，才不会把它的甜当成缺陷。',
      tags: ['世涛', '加勒比', '甜', '黑糖'],
      eff: 72, temp: 21, mashTemp: 66, carb: 2.6,
      malts: [['m-marisotter', 4.87], ['m-c80', 0.35], ['m-blackpatent', 0.39]],
      hops: [['h-galena', 25.2, 'boil', 60],
             ['h-ekg', 15, 'boil', 20]],
      yeast: ['y-s04', 14], att: 82,
      water: { ca: 55, mg: 10, na: 40, cl: 80, so4: 50, hco3: 150 },
      salts: [['w-chalk', 5], ['w-cacl2', 4]],
      notes: '80L 结晶占了麦单一成多，34.9 SRM 的深黑里带红；苦度 40 IBU 只是不让它变成糖水，不是为了苦。' +
             '钠 40 ppm 会让麦芽甜更「厚」，这是少数该主动加食盐的风格。'
    },

    /* ---------------- 补齐空风格 第 5 批：16D 17A 17B 19C 21B-Black ---------------- */
    {
      id: 'c4-foreign-extra-colonial', name: '外销浓世涛 · 殖民地出口版', en: 'Foreign Extra Stout · Colonial Export',
      styleId: '16D', country: '爱尔兰', brewery: '英式出口世涛传统', year: 1800, conf: 'B',
      story: '外销浓世涛是为长途海运做的：酒精度 6.3% 以上、酒花 50 IBU 以上，两个数字都不是为了好喝，而是为了在热带航线上不坏。' +
             '它比都柏林本地喝的要浓、要苦、要甜，是「防腐」这件事留下的风味化石。',
      tags: ['世涛', '出口', '高苦', '浓'],
      eff: 72, temp: 19, mashTemp: 65, carb: 2.3,
      malts: [['m-marisotter', 4.91], ['m-flakedbarley', 0.4], ['m-chocolate', 0.35], ['m-roastedbarley', 0.33]],
      hops: [['h-target', 11.7, 'boil', 60],
             ['h-nugget', 30, 'boil', 60]],
      yeast: ['y-nottingham', 16], att: 84.5,
      water: { ca: 90, mg: 14, na: 35, cl: 65, so4: 110, hco3: 170 },
      salts: [['w-chalk', 6], ['w-gypsum', 5]],
      notes: '两支高 α 苦花叠到 60 IBU，是这条配方唯一的目的：苦味本身就是防腐的一部分，顺便把麦芽甜压住。' +
             '诺丁汉把收口做到 1.014，才有「浓而不腻」；换成低衰减的英式酵母，这条会变成糖浆。'
    },
    {
      id: 'c4-foreign-extra-westindies', name: '外销浓世涛 · 西印度版', en: 'Foreign Extra Stout · West Indies',
      styleId: '16D', country: '爱尔兰', brewery: '西印度出口世涛传统', era: 'modern', conf: 'B',
      story: '西印度版本在配方上做了本地化：一部分基麦换成玉米，糖化更彻底，酒体更薄，以适应热带气候下的饮用习惯。' +
             '它和加勒比的热带世涛是同一条贸易路线上的两个分支，区别在于酒花量——外销版要苦得多。',
      tags: ['世涛', '出口', '玉米', '高苦'],
      eff: 74, temp: 20, mashTemp: 64, carb: 2.5,
      malts: [['m-2row', 4.56], ['m-flakedcorn', 0.4], ['m-c60', 0.3], ['m-roastwheat', 0.47]],
      hops: [['h-columbus', 19, 'boil', 60],
             ['h-chinook', 25, 'boil', 30]],
      yeast: ['y-us05', 16], att: 85,
      water: { ca: 70, mg: 12, na: 40, cl: 70, so4: 100, hco3: 150 },
      salts: [['w-chalk', 5], ['w-cacl2', 3]],
      notes: '玉米 8% 把酒体削薄，35.1 SRM 的深黑里带一点红棕；60 IBU 是这个风格的下限附近，再低就不再是「外销」了。' +
             '烘烤小麦比烘烤大麦「细」，在薄酒体里不容易显得粗糙。'
    },
    {
      id: 'c4-british-strong-winter', name: '英式烈性艾尔 · 冬季暖身酒', en: 'British Strong Ale · Winter Warmer',
      styleId: '17A', country: '英国', brewery: '英式冬季烈性艾尔传统', year: 1900, conf: 'B',
      story: '英式烈性艾尔在 19 世纪是「给冬天喝的家用酒」：麦汁浓度比苦啤高一倍，酒花跟着提，好在酒窖里放到开春。' +
             '它没有烈性波特那么黑、没有大麦酒那么甜，是英式艾尔里最「平衡」的一档高强度酒。',
      tags: ['艾尔', '英式', '烈性', '冬季'],
      eff: 72, temp: 19, mashTemp: 65, carb: 2.3,
      malts: [['m-marisotter', 5.34], ['m-c60', 0.4], ['m-brown', 0.2], ['m-chocolate', 0.05]],
      hops: [['h-challenger', 40.1, 'boil', 60],
             ['h-ekg', 30, 'boil', 20]],
      yeast: ['y-wlp007', 16], att: 76,
      water: { ca: 95, mg: 14, na: 30, cl: 65, so4: 160, hco3: 90 },
      salts: [['w-gypsum', 8], ['w-chalk', 2]],
      notes: '结晶麦芽近一成，15.2 SRM 的深铜色配 45 IBU 的苦，是「暖」而不是「甜」的配方。棕色麦芽补坚果，巧克力只补色。' +
             '接种量按 1.3 倍，高浓麦汁里酵母不足会留下明显的双乙酰。'
    },
    {
      id: 'c4-british-strong-golden', name: '英式烈性艾尔 · 金色版', en: 'British Strong Ale · Golden',
      styleId: '17A', country: '英国', brewery: '现代英式金色烈性艾尔', era: 'modern', conf: 'B',
      story: '金色版是 20 世纪后期才有的变体：用黄金诺言或马里斯奥特单独作基麦，只加少量浅色结晶，把麦芽味压到最低，让酒花与酒精感站在前面。' +
             '它在英国本土被叫作「golden strong ale」，介于烈性苦啤与大麦酒之间。',
      tags: ['艾尔', '英式', '金色', '干投'],
      eff: 74, temp: 19, mashTemp: 64, carb: 2.4,
      malts: [['m-goldenpromise', 3.76], ['m-c40', 0.3], ['m-caramunich1', 1.41]],
      hops: [['h-northdown', 38.2, 'boil', 60],
             ['h-ekg', 25, 'boil', 15],
             ['h-ekg', 20, 'dryhop', 0]],
      yeast: ['y-1968', 16], att: 75,
      water: { ca: 100, mg: 14, na: 28, cl: 60, so4: 180, hco3: 70 },
      salts: [['w-gypsum', 10]],
      notes: '卡拉慕尼黑只放 4% 左右，15 SRM 的金铜色刚好；再多就从「金色」变成「琥珀」。干投 EKG 三天，橙皮感最清楚。' +
             '1968 发酵度低，这条要靠 64°C 糖化把 FG 压在区间内，别用 67°C。'
    },
    {
      id: 'c4-old-ale-oak', name: '老艾尔 · 陈年橡木版', en: 'Old Ale · Oaked & Aged',
      styleId: '17B', country: '英国', brewery: '英式陈年艾尔传统', year: 1750, conf: 'B',
      story: '老艾尔在 18 世纪的意思是「放陈了的艾尔」：酒厂把当年喝不完的浓艾尔存进木桶，几个月后乳酸菌与布雷特带来酸、干果与皮革。' +
             '今天的老艾尔大多不带酸，但橡木与氧化带来的雪利感仍然是风格的骨架。',
      tags: ['艾尔', '英式', '陈年', '橡木'],
      eff: 71, temp: 20, mashTemp: 66, carb: 2.2,
      malts: [['m-marisotter', 5.87], ['m-c120', 0.3], ['m-brown', 0.25], ['m-blackpatent', 0.01]],
      hops: [['h-target', 30.6, 'boil', 60],
             ['h-ekg', 25, 'boil', 20]],
      yeast: ['y-wlp007', 16], att: 76,
      water: { ca: 90, mg: 14, na: 32, cl: 70, so4: 120, hco3: 110 },
      salts: [['w-gypsum', 6], ['w-chalk', 3]],
      notes: '橡木块 20 克泡两周就够，泡一个月会变成「木屑水」。15.8 SRM 的深棕与干果味本来就有，橡木只补单宁与香草。' +
             '想做出老艾尔的雪利感，装瓶前让它接触一点空气再封罐；想干净就跳过这步。'
    },
    {
      id: 'c4-old-ale-syrup', name: '老艾尔 · 深色糖浆版', en: 'Old Ale · Dark Syrup',
      styleId: '17B', country: '英国', brewery: '现代英式老艾尔', era: 'modern', conf: 'B',
      story: '现代英国酒厂做老艾尔常用深色转化糖浆：它带来葡萄干与朗姆的甜，同时把糖化效率的问题绕开——糖浆的点数不需要糖化。' +
             '代价是酒体变薄，所以还要靠结晶麦芽找回来。',
      tags: ['艾尔', '英式', '糖浆', '干果'],
      eff: 73, temp: 19, mashTemp: 66, carb: 2.2,
      malts: [['m-marisotter', 5.44], ['m-c80', 0.35], ['m-candid90', 0.4], ['m-chocolate', 0]],
      hops: [['h-fuggle', 74.6, 'boil', 60],
             ['h-ekg', 20, 'boil', 20]],
      yeast: ['y-nottingham', 16], att: 77,
      water: { ca: 85, mg: 14, na: 35, cl: 75, so4: 110, hco3: 120 },
      salts: [['w-chalk', 4], ['w-cacl2', 3]],
      notes: '深色糖浆约一成，1.071 里有一部分点数不经过糖化；16.6 SRM 的深棕也因此偏「糖」，不是「烤」。' +
             '糖浆在煮沸最后 10 分钟加，早了色度会再深一档、香气跑掉一半。'
    },
    {
      id: 'c4-american-brown-nutty', name: '美式棕艾尔 · 坚果与焦糖', en: 'American Brown Ale · Nutty Caramel',
      styleId: '19C', country: '美国', brewery: '美式家酿传统', year: 1980, conf: 'B',
      story: '美式棕艾尔是家酿运动早期造出来的风格：把英式棕艾尔的麦芽骨架拿过来，酒花换成 Cascade 这类美式品种，苦度与香气都往上提一档。' +
             '它在 1980 年代的美国家酿比赛里被单独立项，因为「英式棕艾尔 + 美式酒花」确实是个新东西。',
      tags: ['艾尔', '美式', '坚果', '柑橘'],
      eff: 74, temp: 19, mashTemp: 65, carb: 2.4,
      malts: [['m-2row', 3.78], ['m-c60', 0.35], ['m-chocolate', 0.37]],
      hops: [['h-cascade', 23.7, 'boil', 60],
             ['h-cascade', 15, 'boil', 15]],
      yeast: ['y-us05', 12], att: 82.5,
      water: { ca: 70, mg: 12, na: 28, cl: 55, so4: 100, hco3: 100 },
      salts: [['w-gypsum', 5], ['w-chalk', 2]],
      notes: '巧克力麦芽接近 5%，26.4 SRM 的深棕里要有红；再多就滑向波特了。25 IBU 是美式版本和英式版本最直接的分界。' +
             'Cascade 在棕色麦芽上会显得「橙皮 + 可可」，这是这个风格最讨喜的地方。'
    },
    {
      id: 'c4-american-brown-dryhop', name: '美式棕艾尔 · 干投版', en: 'American Brown Ale · Dry-Hopped',
      styleId: '19C', country: '美国', brewery: '现代美式精酿', era: 'modern', conf: 'B',
      story: '2000 年以后，美式棕艾尔开始向 IPA 借手法：回旋与干投都用上，苦度不变但香气强度翻倍。' +
             '争议在于它是否还算棕艾尔——当酒花盖过麦芽，它更像「深色的淡色艾尔」。',
      tags: ['艾尔', '美式', '干投', '酒花'],
      eff: 75, temp: 19, mashTemp: 65, carb: 2.4,
      malts: [['m-2row', 3.11], ['m-munich', 0.8], ['m-c40', 0.3], ['m-chocolate-uk', 0.29]],
      hops: [['h-chinook', 14, 'boil', 60],
             ['h-cascade', 20, 'whirlpool', 15, 85],
             ['h-citra', 25, 'dryhop', 0]],
      yeast: ['y-bry97', 12], att: 81,
      water: { ca: 80, mg: 12, na: 26, cl: 50, so4: 130, hco3: 95 },
      salts: [['w-gypsum', 7]],
      notes: '回旋 20 克 Cascade + 干投 25 克 Citra，香气够但苦度仍压在 25 IBU；棕艾尔的苦不该像 IPA。' +
             '干投两天就够，超过四天会有明显的青草味，把可可压没。'
    },
    {
      id: 'c4-black-ipa-westcoast', name: '黑 IPA · 西海岸黑', en: 'Black IPA · West Coast',
      styleId: '21B-Black', country: '美国', brewery: '美式西海岸精酿', year: 2005, conf: 'B',
      story: '黑 IPA 在 2005 年前后同时出现在美国东西两岸，命名之争（Black IPA 还是 Cascadian Dark Ale）比配方之争更激烈。' +
             '它的技术难点只有一个：用去壳深色麦芽把颜色做到 30 SRM 以上，同时不让烘烤的焦苦盖过酒花。',
      tags: ['IPA', '深色', '西海岸', '酒花'],
      eff: 72, temp: 19, mashTemp: 65, carb: 2.5,
      malts: [['m-2row', 5.19], ['m-c40', 0.3], ['m-carafa2', 0.45]],
      hops: [['h-columbus', 27.2, 'boil', 60],
             ['h-centennial', 25, 'boil', 15],
             ['h-citra', 30, 'whirlpool', 15, 85],
             ['h-mosaic', 50, 'dryhop', 0]],
      yeast: ['y-us05', 14], att: 85.5,
      water: { ca: 110, mg: 16, na: 30, cl: 55, so4: 220, hco3: 80 },
      salts: [['w-gypsum', 14]],
      notes: '去壳深色麦芽（Carafa II）是黑 IPA 成立的前提：它给 32.7 SRM 的颜色，几乎不给焦苦。用普通巧克力麦芽，同样的色度会毁掉 70 IBU 的酒花层次。' +
             '硫酸盐 220 ppm 把酒花的苦拉干；这个风格宁可「干苦」也不要「圆苦」。'
    },
    {
      id: 'c4-black-ipa-debittered', name: '黑 IPA · 午夜小麦版', en: 'Black IPA · Midnight Wheat',
      styleId: '21B-Black', country: '美国', brewery: '现代美式精酿', era: 'modern', conf: 'B',
      story: '午夜小麦是去苦深色麦芽里最「软」的一种：色度接近 550L，但单宁与焦苦被压到最低。' +
             '用它做黑 IPA，可以把深色麦芽比例提到 8% 而不带涩感，这也是它在家酿圈流行的原因。',
      tags: ['IPA', '深色', '去苦麦芽', '干投'],
      eff: 73, temp: 19, mashTemp: 65, carb: 2.5,
      malts: [['m-2row', 5.2], ['m-wheat', 0.4], ['m-midnightwheat', 0.37]],
      hops: [['h-warrior', 31.8, 'boil', 60],
             ['h-simcoe', 25, 'boil', 10],
             ['h-simcoe', 40, 'dryhop', 0]],
      yeast: ['y-bry97', 14], att: 82,
      water: { ca: 100, mg: 16, na: 28, cl: 60, so4: 190, hco3: 85 },
      salts: [['w-gypsum', 12], ['w-cacl2', 3]],
      notes: '午夜小麦 7% 就能做到 32.6 SRM，而且不抢酒花；小麦 5% 给一点柔和的酒体，让 190 ppm 硫酸盐不至于太尖。' +
             '这类的颜色在杯里几乎是黑的，对着光才看得出红——别为了「更黑」再加麦芽。'
    },

    /* ---------------- 补齐空风格 第 6 批：21B-Rye 22B 22D 23C 23D ---------------- */
    {
      id: 'c4-rye-ipa-piney', name: '黑麦 IPA · 松针与胡椒', en: 'Rye IPA · Pine & Pepper',
      styleId: '21B-Rye', country: '美国', brewery: '美式家酿传统', year: 2000, conf: 'B',
      story: '黑麦 IPA 是美国家酿圈在 2000 年前后的产物：把 15–20% 的黑麦麦芽加进 IPA 麦单，换来一层辛辣的胡椒感与更干的收口。' +
             '黑麦没有外壳，滤槽容易堵，所以配方里通常要配稻壳——这是它最实际的一条工艺约束。',
      tags: ['IPA', '黑麦', '辛辣', '西海岸'],
      eff: 72, temp: 19, mashTemp: 65, carb: 2.5,
      malts: [['m-2row', 4.37], ['m-rye', 1], ['m-c40', 0.3], ['m-carafa2', 0.03]],
      hops: [['h-columbus', 24.9, 'boil', 60],
             ['h-simcoe', 25, 'boil', 15],
             ['h-simcoe', 40, 'dryhop', 0]],
      yeast: ['y-us05', 14], att: 82,
      water: { ca: 105, mg: 16, na: 30, cl: 55, so4: 200, hco3: 85 },
      salts: [['w-gypsum', 12]],
      notes: '黑麦接近两成，糖化时务必加一把稻壳，否则滤槽会被黑麦的黏性堵死。9.8 SRM 的深琥珀来自 40L 结晶，黑麦本身只给一点红。' +
             '硫酸盐 200 ppm 把黑麦的辛辣放大；降到 100 以下，这条会变得很「软」。'
    },
    {
      id: 'c4-rye-ipa-kiwi', name: '黑麦 IPA · 新西兰酒花版', en: 'Rye IPA · Kiwi Hops',
      styleId: '21B-Rye', country: '美国', brewery: '现代美式精酿', era: 'modern', conf: 'B',
      story: '新西兰酒花与黑麦的组合在 2010 年代流行起来：Nelson 的白葡萄酒调与黑麦的胡椒在同一个「干」的方向上，不会互相打架。' +
             '这条配方用黑麦片而不是黑麦麦芽，辛辣感更轻，酒体更圆。',
      tags: ['IPA', '黑麦', '新西兰', '干投'],
      eff: 73, temp: 19, mashTemp: 65, carb: 2.5,
      malts: [['m-marisotter', 4.61], ['m-flakedrye', 0.8], ['m-c60', 0.25], ['m-chocolate', 0.02]],
      hops: [['h-nelson', 40, 'boil', 60],
             ['h-motueka', 30, 'whirlpool', 15, 85],
             ['h-nelson', 40, 'dryhop', 0]],
      yeast: ['y-bry97', 14], att: 81.5,
      water: { ca: 95, mg: 14, na: 28, cl: 60, so4: 170, hco3: 80 },
      salts: [['w-gypsum', 10], ['w-cacl2', 3]],
      notes: '黑麦片 12% 比黑麦麦芽温和，9.8 SRM 的琥珀色靠 60L 结晶与一点巧克力麦芽。回旋 30 克 Motueka 给柠檬皮，和 Nelson 的白葡萄酒调正好接上。' +
             '新西兰酒花的硫化物很脆，干投两天就够，久了会变成「煮白菜」。'
    },
    {
      id: 'c4-american-strong-amber', name: '美式烈性艾尔 · 深琥珀', en: 'American Strong Ale · Deep Amber',
      styleId: '22B', country: '美国', brewery: '美式精酿传统', year: 1990, conf: 'B',
      story: '美式烈性艾尔不是一个有严格定义的风格，而是 1990 年代美国精酿对「高浓度 + 高酒花」的统称。' +
             '它比双料 IPA 麦芽重、比大麦酒酒花多，落在两者之间。' +
             'BJCP 把它单列，正是因为这个「之间」有稳定的共性。',
      tags: ['艾尔', '美式', '烈性', '酒花'],
      eff: 70, temp: 19, mashTemp: 65, carb: 2.4,
      malts: [['m-2row', 5.63], ['m-munich', 1], ['m-c60', 0.4], ['m-chocolate', 0.02]],
      hops: [['h-chinook', 32.6, 'boil', 60],
             ['h-cascade', 30, 'boil', 15],
             ['h-centennial', 35, 'dryhop', 0]],
      yeast: ['y-us05', 16], att: 78.5,
      water: { ca: 100, mg: 16, na: 30, cl: 60, so4: 170, hco3: 95 },
      salts: [['w-gypsum', 9], ['w-chalk', 2]],
      notes: '慕尼黑麦芽给中段的麦芽甜，12.4 SRM 的深琥珀靠 60L 结晶；巧克力麦芽只补最后一格，多了会变成「黑烈性艾尔」。' +
             '接种量按 1.5 倍，1.077 的麦汁里酵母不足会留下明显的乙醛与双乙酰。'
    },
    {
      id: 'c4-american-strong-red', name: '美式烈性艾尔 · 红色版', en: 'American Strong Ale · Red',
      styleId: '22B', country: '美国', brewery: '现代美式精酿', era: 'modern', conf: 'B',
      story: '红色版本是 2000 年以后的分支：把结晶麦芽换成 120L 与去壳深色麦芽的组合，颜色压到深红，麦芽甜更「干果」而不是「太妃」。' +
             '它的酒花通常用 Amarillo 这类橙香品种，与红果的联想对得上。',
      tags: ['艾尔', '美式', '红色', '干果'],
      eff: 71, temp: 19, mashTemp: 65, carb: 2.4,
      malts: [['m-2row', 5.53], ['m-munich', 1.2], ['m-c120', 0.25], ['m-carafa2', 0]],
      hops: [['h-warrior', 26.1, 'boil', 60],
             ['h-amarillo', 25, 'boil', 10],
             ['h-amarillo', 35, 'dryhop', 0]],
      yeast: ['y-wlp090', 16], att: 77,
      water: { ca: 105, mg: 16, na: 28, cl: 55, so4: 160, hco3: 90 },
      salts: [['w-gypsum', 8], ['w-chalk', 2]],
      notes: '120L 结晶占 4% 左右，12.5 SRM 的深红全靠它；去壳深色麦芽只负责把色度从「红棕」推到「红黑」。' +
             'WLP090 衰减高、絮凝好，是这个风格不出「糖浆感」的关键。'
    },
    {
      id: 'c4-wheatwine-honey', name: '小麦酒 · 蜂蜜与柑橘', en: 'Wheatwine · Honey & Citrus',
      styleId: '22D', country: '美国', brewery: '美式家酿传统', year: 1995, conf: 'B',
      story: '小麦酒是「大麦酒的妹妹」：同样的 8–12% 浓度，把基麦换成小麦，得到更柔的酒体与更浅的颜色。' +
             '它最早出现在 1990 年代的美国家酿比赛里，作为「大麦酒喝腻了」的替代方案。',
      tags: ['小麦', '烈性', '蜂蜜', '高浓'],
      eff: 66, temp: 20, mashTemp: 65, carb: 2.4,
      malts: [['m-wheat', 7.25], ['m-2row', 1.5], ['m-c40', 0.4], ['m-carafa2', 0.01]],
      hops: [['h-magnum-us', 30.4, 'boil', 60],
             ['h-cascade', 25, 'boil', 20]],
      yeast: ['y-us05', 18], att: 79,
      water: { ca: 70, mg: 12, na: 25, cl: 55, so4: 80, hco3: 90 },
      salts: [['w-cacl2', 4], ['w-gypsum', 3]],
      notes: '小麦过半、效率只有 66%，麦单会很大——这是高浓小麦酒的常态。1.095 的麦汁要靠双倍接种量才发得完。' +
             '糖化加稻壳；小麦比例超过 50% 时，滤槽堵塞是这条配方最常见的失败点。'
    },
    {
      id: 'c4-wheatwine-oak', name: '小麦酒 · 橡木陈年版', en: 'Wheatwine · Oaked',
      styleId: '22D', country: '美国', brewery: '现代美式精酿', era: 'modern', conf: 'B',
      story: '小麦酒的酒精度高、单宁薄，正好适合短时间接触橡木：木头的香草与椰子能补上小麦缺少的中段味道。' +
             '度数是这条配方的难点——9% 以上，任何一点氧化都会被放大成「雪利」。',
      tags: ['小麦', '烈性', '橡木', '陈年'],
      eff: 65, temp: 20, mashTemp: 66, carb: 2.3,
      malts: [['m-wheat', 7.95], ['m-marisotter', 1.2], ['m-honey', 0.4], ['m-chocolate', 0.03]],
      hops: [['h-warrior', 27.1, 'boil', 60],
             ['h-ekg', 20, 'boil', 20]],
      yeast: ['y-wlp001', 18], att: 76,
      water: { ca: 75, mg: 12, na: 28, cl: 65, so4: 85, hco3: 100 },
      salts: [['w-cacl2', 5], ['w-gypsum', 2]],
      notes: '蜂蜜麦芽给的是「蜜味」不是「糖」，10.3 SRM 的金铜色有一半来自它。橡木块 15 克泡 10 天，超过两周会盖掉小麦的柔。' +
             '装瓶后至少放两个月再开：10.4% 的酒在瓶里还要再融合一轮。'
    },
    {
      id: 'c4-oud-bruin-east', name: '老棕啤 · 东佛兰德版', en: 'Oud Bruin · East Flanders',
      styleId: '23C', country: '比利时', brewery: '东佛兰德混合发酵传统', year: 1800, conf: 'B',
      story: '老棕啤（Oud Bruin）是西佛兰德与东佛兰德两地的混合发酵棕艾尔：先正常发酵，再进木桶让乳酸菌与布雷特慢慢作用几个月到一年。' +
             '它比兰比克柔和、比普通棕艾尔酸，甜与酸的比例是这类酒唯一的评分标准。',
      tags: ['酸啤', '比利时', '混合发酵', '棕'],
      eff: 72, temp: 20, mashTemp: 66, carb: 2.3,
      malts: [['m-marisotter', 3.59], ['m-c60', 0.3], ['m-c120', 0.2], ['m-chocolate', 0.14]],
      hops: [['h-ekg', 34, 'boil', 60]],
      yeast: ['y-phillysour', 14], att: 84.5,
      adj: [['a-oakcubes', 15]],
      water: { ca: 60, mg: 10, na: 25, cl: 55, so4: 55, hco3: 110 },
      salts: [['w-chalk', 4], ['w-cacl2', 2]],
      notes: '乳酸菌把 pH 拉到 3.5 上下，19.5 SRM 的深棕里要有红宝石的光。苦度只有 23 IBU，酸啤里任何一点苦都会被放大。' +
             '橡木块泡 3 个月是家酿的折中；真正的 Oud Bruin 在木桶里待 1 年以上。'
    },
    {
      id: 'c4-oud-bruin-west', name: '老棕啤 · 西佛兰德版', en: 'Oud Bruin · West Flanders',
      styleId: '23C', country: '比利时', brewery: '西佛兰德混合发酵传统', era: 'modern', conf: 'B',
      story: '西佛兰德版本更酸、更薄，常用慕尼黑麦芽打底、少用结晶，让乳酸的味道更干净。' +
             '它和东佛兰德版本的分歧在「甜」——西边认为老棕啤不该甜，东边认为甜是骨架。',
      tags: ['酸啤', '比利时', '乳酸', '干'],
      eff: 73, temp: 21, mashTemp: 65, carb: 2.3,
      malts: [['m-munich', 4.28], ['m-c40', 0.25], ['m-specialb', 0.15], ['m-chocolate', 0.08]],
      hops: [['h-styrian', 34.6, 'boil', 60]],
      yeast: ['y-phillysour', 14], att: 84.5,
      adj: [['a-oakcubes', 10]],
      water: { ca: 55, mg: 10, na: 22, cl: 50, so4: 50, hco3: 100 },
      salts: [['w-chalk', 3], ['w-cacl2', 2]],
      notes: '特殊 B 麦芽 2% 给葡萄干，别多；这条的甜要靠麦芽香而不是残糖。19.6 SRM 的深棕配 23 IBU，酸是主角。' +
             '发酵温度 21°C 让乳酸菌工作更快，但超过 23°C 会出醋酸味——那就不再是「酸」而是「醋」。'
    },
    {
      id: 'c4-lambic-wheat', name: '兰比克 · 小麦与陈年酒花', en: 'Lambic · Wheat & Aged Hops',
      styleId: '23D', country: '比利时', brewery: 'Pajottenland 自然发酵传统', year: 1600, conf: 'B',
      story: '兰比克是布鲁塞尔西南的 Pajottenland 独有的东西：麦汁在敞口冷却槽里过夜，靠空气里的野生酵母与菌落自然发酵，再进木桶陈 1–3 年。' +
             '酒花用的是陈年酒花——只取防腐，不要香气，所以 IBU 只有个位数。',
      tags: ['酸啤', '比利时', '自然发酵', '小麦'],
      eff: 70, temp: 18, mashTemp: 66, carb: 2.6,
      malts: [['m-pilsner', 3.51], ['m-unmaltedwheat', 1.2]],
      hops: [['h-styrian', 7.6, 'boil', 60]],
      yeast: ['y-phillysour', 14], att: 84,
      adj: [['a-oakcubes', 20]],
      water: { ca: 55, mg: 8, na: 20, cl: 40, so4: 45, hco3: 90 },
      salts: [['w-chalk', 3]],
      notes: '生小麦两成半以上是兰比克的传统配比，它给的是浑浊与一点乳酸底。苦度只到 5 IBU，用陈年酒花——新鲜酒花的香气会在三年陈放里全变成草味。' +
             '家酿没法复刻敞口冷却，用 Philly Sour 只能做到「酸」；布雷特的干草味与皮革味需要真的布雷特与时间。'
    },
    {
      id: 'c4-lambic-barrel', name: '兰比克 · 三年桶陈思路', en: 'Lambic · Three-Year Barrel',
      styleId: '23D', country: '比利时', brewery: '布鲁塞尔桶陈传统', era: 'modern', conf: 'B',
      story: '真正的兰比克要陈 1、2、3 年三个年份再混：一年给活力、两年给酸、三年给复杂度。' +
             '家酿的折中是只用布雷特与乳酸菌、在橡木块上放半年——能做出「干」与「酸」，做不出「谷仓」。',
      tags: ['酸啤', '比利时', '桶陈', '布雷特'],
      eff: 70, temp: 20, mashTemp: 66, carb: 2.6,
      malts: [['m-pilsner', 3.26], ['m-flakedwheat', 1], ['m-unmaltedwheat', 0.5]],
      hops: [['h-hersbrucker', 11.4, 'boil', 60]],
      yeast: ['y-wlp644', 14], att: 85,
      adj: [['a-oakcubes', 25]],
      water: { ca: 50, mg: 8, na: 18, cl: 38, so4: 42, hco3: 85 },
      salts: [['w-chalk', 2]],
      notes: '布雷特把残糖吃到 1.008，比同浓度的艾尔干得多——这正是兰比克的骨架。色度只有 3.7 SRM，这类酒本来就不该深。' +
             '陈放期间别用普通气闸频繁开盖；氧气是布雷特的朋友，也是醋酸菌的朋友，拿捏在「一点」上。'
    },

    /* ---------------- 补齐空风格 第 7 批：23E 24B 24C 26A 30A ---------------- */
    {
      id: 'c4-gueuze-blend', name: '贵兹 · 三个年份的勾兑', en: 'Gueuze · Three-Year Blend',
      styleId: '23E', country: '比利时', brewery: '比利时贵兹勾兑传统', year: 1800, conf: 'B',
      story: '贵兹不是「一种发酵」，而是「一次勾兑」：把陈 1 年、2 年、3 年的兰比克按比例混在一起，年轻酒提供可发酵糖给瓶内二次发酵，老酒提供酸与复杂度。' +
             '所以贵兹的泡沫比兰比克强得多——那是瓶里还在发酵的证据。',
      tags: ['酸啤', '比利时', '勾兑', '自然发酵'],
      eff: 70, temp: 18, mashTemp: 66, carb: 3,
      malts: [['m-pilsner', 3.15], ['m-unmaltedwheat', 1], ['m-c60', 0.14]],
      hops: [['h-styrian', 7.4, 'boil', 60]],
      yeast: ['y-wlp644', 14], att: 91,
      adj: [['a-oakcubes', 25]],
      water: { ca: 55, mg: 8, na: 20, cl: 40, so4: 45, hco3: 90 },
      salts: [['w-chalk', 3]],
      notes: '瓶内二次发酵按 3.0 vol 算糖，这是贵兹「泡多」的唯一来源，别用强制碳化替代。1.005 的收口几乎没有任何甜。' +
             '家酿只能用单一布雷特菌株近似「三个年份」；真正的贵兹复杂度来自同一桶里几十种菌的先后作用。'
    },
    {
      id: 'c4-gueuze-vienna', name: '贵兹 · 带维也纳麦芽的柔版', en: 'Gueuze · Vienna Softened',
      styleId: '23E', country: '比利时', brewery: '现代比利时酸啤', era: 'modern', conf: 'B',
      story: '有些现代比利时酒厂会在兰比克麦单里掺一点维也纳麦芽，让酸之外多一点麦芽的圆润。' +
             '这在传统派看来是「作弊」，但它确实让贵兹在年轻时更好入口——代价是三年后复杂度会低一档。',
      tags: ['酸啤', '比利时', '勾兑', '柔'],
      eff: 70, temp: 19, mashTemp: 66, carb: 3,
      malts: [['m-pilsner', 2.94], ['m-flakedwheat', 0.8], ['m-vienna', 0.6], ['m-carafa2', 0.02]],
      hops: [['h-hersbrucker', 11.1, 'boil', 60]],
      yeast: ['y-wlp644', 14], att: 89.5,
      adj: [['a-oakcubes', 20]],
      water: { ca: 52, mg: 8, na: 18, cl: 42, so4: 42, hco3: 88 },
      salts: [['w-chalk', 2]],
      notes: '维也纳麦芽一成半给「麦芽底」，5.9 SRM 的色度只比纯皮尔森版深一格；苦度 5 IBU 依旧是陈年酒花的功能性用量。' +
             '陈放期间橡木块别超过 25 克：贵兹的单宁本来就高，多了会涩。'
    },
    {
      id: 'c4-belgian-pale-antwerp', name: '比利时淡色艾尔 · 安特卫普', en: 'Belgian Pale Ale · Antwerp',
      styleId: '24B', country: '比利时', brewery: '安特卫普淡色艾尔传统', year: 1900, conf: 'B',
      story: '比利时淡色艾尔是安特卫普一带的日常酒：比利时淡色麦芽打底、饼干麦芽给中段、斯洛文尼亚酒花收尾，酵母用比利时艾尔菌株在 20°C 发酵，酯香温和。' +
             '它比比利时金艾尔低调得多，也正因如此更适合配饭。',
      tags: ['艾尔', '比利时', '平衡', '饼干'],
      eff: 74, temp: 20, mashTemp: 66, carb: 2.5,
      malts: [['m-belgian-pale', 3.63], ['m-biscuit', 0.3], ['m-caramunich1', 0.7]],
      hops: [['h-styrian', 32.8, 'boil', 60],
             ['h-saaz', 15, 'boil', 15]],
      yeast: ['y-wlp550', 12], att: 81.5,
      water: { ca: 60, mg: 10, na: 22, cl: 50, so4: 60, hco3: 85 },
      salts: [['w-cacl2', 3], ['w-gypsum', 2]],
      notes: '饼干麦芽 8% 是这条的「比利时感」来源；11 SRM 的琥珀色靠卡拉慕尼黑补，不能靠加深麦汁。' +
             '20°C 发酵，别上 23°C——比利时酯香在这个风格里应该只是背景。'
    },
    {
      id: 'c4-belgian-pale-abbey', name: '比利时淡色艾尔 · 修道院日常酒', en: 'Belgian Pale Ale · Abbey Table Beer',
      styleId: '24B', country: '比利时', brewery: '比利时修道院传统', era: 'modern', conf: 'B',
      story: '修道院酒厂给修士自己喝的「日常酒」通常就是比利时淡色艾尔：4.8–5.5%，酒花比单料艾尔低，麦芽比金艾尔重。' +
             '它不上货架，只在修道院食堂里出现——所以这个风格的配方一直很朴素。',
      tags: ['艾尔', '比利时', '修道院', '易饮'],
      eff: 75, temp: 20, mashTemp: 66, carb: 2.5,
      malts: [['m-pilsner', 2.96], ['m-vienna', 0.8], ['m-c20', 0.3], ['m-specialb', 0.21]],
      hops: [['h-bobek', 33.5, 'boil', 60],
             ['h-styrian', 12, 'boil', 15]],
      yeast: ['y-t58', 12], att: 78.5,
      water: { ca: 58, mg: 10, na: 24, cl: 52, so4: 55, hco3: 80 },
      salts: [['w-cacl2', 3]],
      notes: '特殊 B 麦芽只放 2%，多了会从「淡色艾尔」滑向「比利时棕艾尔」。25 IBU 在这个风格里已经算高，喝起来仍要圆。' +
             'T-58 的酚香偏重，接种量少一点、温度压到 19°C 会更接近修道院版本。'
    },
    {
      id: 'c4-biere-de-garde-amber', name: '法国北省啤酒 · 琥珀版', en: 'Bière de Garde · Ambrée',
      styleId: '24C', country: '法国', brewery: '法国北部农庄传统', year: 1800, conf: 'B',
      story: 'Bière de Garde 的字面意思是「可以存的啤酒」：法国北部农庄在冬天酿、春天拿出来喝，用软木塞封瓶、在地窖里放几个月。' +
             '它的酒花用得克制、麦芽偏重，是法式酿造里少见的「以存为本」的风格。',
      tags: ['艾尔', '法国', '农庄', '琥珀'],
      eff: 72, temp: 18, mashTemp: 66, carb: 2.6,
      malts: [['m-pilsner', 4.34], ['m-vienna', 1.2], ['m-caramunich1', 0.3], ['m-chocolate', 0.09]],
      hops: [['h-strisselspalt', 82.6, 'boil', 60],
             ['h-strisselspalt', 20, 'boil', 15]],
      yeast: ['y-wlp029', 14], att: 81,
      water: { ca: 65, mg: 10, na: 25, cl: 55, so4: 70, hco3: 90 },
      salts: [['w-gypsum', 3], ['w-cacl2', 3]],
      notes: '斯特里斯帕尔特 α 酸只有 2.2%，所以要放很多克才到 23 IBU——这是法国酒花的常态，不是配方写错。' +
             '18°C 发酵后降到 8°C 存三周，法式「garde」的干净感靠这段冷存。'
    },
    {
      id: 'c4-biere-de-garde-blonde', name: '法国北省啤酒 · 金色版', en: 'Bière de Garde · Blonde',
      styleId: '24C', country: '法国', brewery: '现代法式农庄艾尔', era: 'modern', conf: 'B',
      story: '金色版是 20 世纪后期的变化：酒厂把维也纳麦芽换成慕尼黑麦芽的浅色版本，颜色降到 6–10 SRM，酒花仍用阿尔萨斯品种。' +
             '它比琥珀版更干、更「拉格化」，很多酒厂干脆用低温发酵。',
      tags: ['艾尔', '法国', '金色', '干爽'],
      eff: 73, temp: 17, mashTemp: 65, carb: 2.6,
      malts: [['m-pilsner', 4.43], ['m-munich', 0.8], ['m-carahell', 0.3], ['m-carafa2', 0.08]],
      hops: [['h-strisselspalt', 73.3, 'boil', 60],
             ['h-ekg', 15, 'boil', 15]],
      yeast: ['y-s33', 14], att: 78.5,
      water: { ca: 62, mg: 10, na: 22, cl: 58, so4: 65, hco3: 85 },
      salts: [['w-cacl2', 4], ['w-gypsum', 2]],
      notes: '卡拉海尔 6% 给金色与一点圆润，去壳深色麦芽只补最后一格色度。1.063 的麦汁配 23 IBU，收口必须干。' +
             '软木塞封瓶是这个风格的传统；家酿用皇冠盖也行，但要留足瓶中发酵的糖。'
    },
    {
      id: 'c4-belgian-single-house', name: '比利时单料艾尔 · 修道院日常酒', en: 'Belgian Single · Monastic Table Beer',
      styleId: '26A', country: '比利时', brewery: '比利时修道院传统', year: 1850, conf: 'B',
      story: '单料艾尔是修道院啤酒体系里最低的一档：双料、三料、四料之外，修士自己日常喝的就是它。' +
             '4.8–6% 的酒精度、极浅的颜色、很高的表观衰减——它存在的意义是「能喝一整晚」，而不是「值得记一笔」。',
      tags: ['艾尔', '比利时', '修道院', '干爽'],
      eff: 76, temp: 21, mashTemp: 64, carb: 2.8,
      malts: [['m-pilsner', 3.78], ['m-candiclear', 0.35], ['m-carapils', 0.2]],
      hops: [['h-styrian', 46.9, 'boil', 60],
             ['h-saaz', 20, 'boil', 15],
             ['h-styrian', 15, 'dryhop', 0]],
      yeast: ['y-be256', 14], att: 84,
      water: { ca: 60, mg: 10, na: 22, cl: 55, so4: 75, hco3: 70 },
      salts: [['w-gypsum', 4]],
      notes: '透明糖浆把麦汁浓度拉起来又不加深颜色，是单料艾尔做到 1.01 的关键。色度只有 3.2 SRM，浅到几乎像皮尔森。' +
             '干投 15 克斯洛文尼亚酒花两天，给一点白胡椒；这个风格不追求酒花香。'
    },
    {
      id: 'c4-belgian-single-golden', name: '比利时单料艾尔 · 金版', en: 'Belgian Single · Golden',
      styleId: '26A', country: '比利时', brewery: '现代比利时修道院', era: 'modern', conf: 'B',
      story: '金版把皮尔森麦芽换成比利时淡色麦芽，加一点维也纳，色度上到 4–5 SRM，喝起来比传统版多一点麦芽甜。' +
             '它是修道院酒厂对外销售的「入门款」——同一套设备、同一株酵母，只把浓度降下来。',
      tags: ['艾尔', '比利时', '金色', '入门'],
      eff: 75, temp: 21, mashTemp: 64, carb: 2.8,
      malts: [['m-pilsner', 3.4], ['m-vienna', 0.6], ['m-candiclear', 0.3]],
      hops: [['h-bobek', 46.6, 'boil', 60],
             ['h-styrian', 18, 'boil', 15]],
      yeast: ['y-wlp550', 14], att: 83.5,
      water: { ca: 62, mg: 10, na: 24, cl: 58, so4: 78, hco3: 72 },
      salts: [['w-gypsum', 4], ['w-cacl2', 2]],
      notes: '维也纳麦芽一成半让 3.5 SRM 的金色有底，透明糖浆负责把酒精度顶到 5.7% 而不加重酒体。' +
             '比利时酵母在 21°C 会出明显的梨酯，这正是单料艾尔和皮尔森的差别。'
    },
    {
      id: 'c4-spice-ginger-lemon', name: '香料啤酒 · 姜与柠檬皮', en: 'Spiced Beer · Ginger & Lemon Peel',
      styleId: '30A', country: '美国', brewery: '美式家酿传统', era: 'modern', conf: 'B',
      story: '香料啤酒是一类「基底任意、香料定量」的风格：BJCP 把它单列，是因为评判时先看香料是否与基底协调，再看香料本身。' +
             '姜与柠檬皮是最难失手的一组——两者的挥发性都高，煮久了会变成「洗洁精」。',
      tags: ['香料', '姜', '柑橘', '易饮'],
      eff: 74, temp: 19, mashTemp: 66, carb: 2.6,
      malts: [['m-2row', 3.25], ['m-wheat', 0.5], ['m-c60', 0.61]],
      hops: [['h-saaz', 48.2, 'boil', 60]],
      yeast: ['y-us05', 12], att: 81.5,
      adj: [['a-ginger', 25], ['a-lemon', 20]],
      water: { ca: 60, mg: 8, na: 20, cl: 50, so4: 55, hco3: 60 },
      salts: [['w-cacl2', 2]],
      notes: '姜 25 克在煮沸最后 5 分钟下，柠檬皮在发酵结束后泡两天——两者的香气都怕热。苦度只到 23 IBU，香料才是主角。' +
             '小麦 10% 给一点浑浊与柔和的酒体，让姜的辛辣不至于显得尖。'
    },
    {
      id: 'c4-spice-pumpkin-pie', name: '香料啤酒 · 南瓜派香料', en: 'Spiced Beer · Pumpkin Pie Spice',
      styleId: '30A', country: '美国', brewery: '美式秋冬香料传统', era: 'modern', conf: 'B',
      story: '「南瓜派香料」其实是肉桂、姜、丁香、肉豆蔻的组合，和南瓜本身关系不大——真正用南瓜的酒，糖分与淀粉反而让发酵更难控制。' +
             '美国家酿圈早就达成共识：想要那个味道，加香料比加南瓜有效。',
      tags: ['香料', '肉桂', '秋冬', '麦芽'],
      eff: 73, temp: 19, mashTemp: 67, carb: 2.5,
      malts: [['m-marisotter', 3.54], ['m-munich', 0.6], ['m-c60', 0.3]],
      hops: [['h-ekg', 34.5, 'boil', 60]],
      yeast: ['y-s04', 12], att: 77,
      adj: [['a-cinnamon', 5], ['a-ginger', 8], ['a-clove', 2]],
      water: { ca: 65, mg: 8, na: 22, cl: 55, so4: 50, hco3: 80 },
      salts: [['w-cacl2', 3]],
      notes: '丁香 2 克是上限：它一旦过量就会盖住肉桂与麦芽，而且这个味道洗不掉。9.3 SRM 的琥珀色来自 60L 结晶，不是香料。' +
             '香料在煮沸最后 3 分钟下，或者用伏特加浸渍后装瓶前加——后者的控制力更强。'
    },
  ];

  /* ====================================================================
   * 展开成完整配方对象
   * ==================================================================*/
  BREW.DB.classicRecipes = LIST.map(function (o) {
    var r = mk(o);
    return {
      id: o.id,
      name: o.name,
      en: o.en || '',
      styleId: o.styleId,
      origin: { country: o.country || '', brewery: o.brewery || '', year: o.year || null, era: o.era || '' },
      story: o.story || '',
      tags: o.tags || [],
      conf: o.conf || 'B',
      /* 提醒：这是按风格复原的思路，不是原厂保密配方 */
      disclaimer: '本配方按该风格的通行做法复原，不是酒厂公开的原始配方。用于学习与二次创作。',
      recipe: r
    };
  }).filter(function (c) {
    return c.recipe && c.recipe.fermentables.length > 0;
  });

  /* 按风格索引，便于 UI 快速筛选 */
  BREW.DB.classicByStyle = {};
  BREW.DB.classicRecipes.forEach(function (c) {
    if (!BREW.DB.classicByStyle[c.styleId]) BREW.DB.classicByStyle[c.styleId] = [];
    BREW.DB.classicByStyle[c.styleId].push(c.id);
  });

})(typeof window !== 'undefined' ? window : globalThis);
