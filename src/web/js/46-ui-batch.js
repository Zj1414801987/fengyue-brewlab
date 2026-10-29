/* ============================================================================
 * 风月酿研所 — 46-ui-batch.js
 * ----------------------------------------------------------------------------
 * 职责：酿造记录视图。
 *   · 左侧批次列表，右侧批次详情（配方快照 + 指标 + 发酵曲线 + 时间线）
 *   · 新建批次时对配方做快照，之后配方改动不影响历史记录
 *   · 快速添加读数：时间 / 阶段 / 比重 / 温度 / pH / 备注
 *   · 状态机：计划 → 糖化中 → 发酵中 → 熟成 → 装瓶 → 已饮完 / 失败
 *
 * 依赖：BREW.UI（esc/num/fmt/store/recipe/db）
 *       BREW.Charts.line（可选；缺失时用本文件内置的画布渲染，保证曲线可见）
 *       BREW.Batch.blank（可选，缺失时用本文件内置模型）
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  var host = null;
  var activeId = '';
  var chartCanvas = null;

  /** 关系规则的一条提示（v1.5）。
   *  只在 hard/soft 时返回 HTML；ok / empty 返回空串——"还没填"不标黄。
   *  文案由 39a 的 why 直接拼好，界面这里不再改写判据。 */
  function relLine(key, ctx) {
    var FR = BREW.FieldRules;
    if (!FR || typeof FR.relation !== 'function') return '';
    var rel = FR.relation(key, ctx);
    if (!rel || (rel.level !== 'hard' && rel.level !== 'soft')) return '';
    return '<p class="fld-msg fld-msg--rel" data-lvl="' +
      (rel.level === 'hard' ? 'hard' : 'soft') + '" data-rel="' + attr(key) + '">' +
      esc(rel.msg) + '</p>';
  }

  /* 状态机按钮：v 用 Config.STAGES 的 id（v1.2 起唯一事实来源），
     t 是显示文案 —— **中文一个字都不改**，用户看到的必须和 v1.1 完全一致。
     只保留 6 个主节点 + 失败：糖化/洗糟/煮沸/冷却/干投这些细粒度阶段
     由读数记录去表达，不塞进这条状态条。

     v1.6 配色：slot 是 48 令牌缓存里的槽位名，色值**不写在这里**。
     状态的颜色该跟"什么意思"走，不该跟"第几个"走：未开始/进行中/已完成/
     失败 各自有语义色，而"第 3 个"不是一种含义。 */
  var STATUS = [
    { v: 'plan',    t: '计划',   slot: 'text' },    /* 未开始：三级字灰 */
    { v: 'mash',    t: '糖化中', slot: 'struct' },  /* 进行中：青（结构色） */
    { v: 'ferment', t: '发酵中', slot: 'amber' },   /* 现行阶段：琥珀（激活/强调） */
    { v: 'mature',  t: '熟成',   slot: 'olive' },   /* 陈化等待：橄榄（= --s7） */
    { v: 'package', t: '装瓶',   slot: 'blue' },    /* 收尾交付：蓝（= --s5 位） */
    { v: 'done',    t: '已饮完', slot: 'ok' },      /* 已完成 */
    { v: 'failed',  t: '失败',   slot: 'bad' }      /* 异常 */
  ];

  /* 语义槽位 → 实际色值（现取，48 refreshColors 是就地改写，引用不会过期）。
     ⚠️ 为什么熟成不用 --struct-dim / --struct-soft（同族不同明度）：
        实测 CIEDE2000 --struct↔--struct-dim = 4.1、--struct↔--struct-soft = 5.4，
        远低于"同一张列表里能目视分开"的 10。三个"进行中"阶段全压在青族里，
        用户在小圆点上根本分不出糖化和熟成。所以只让 糖化 用青，发酵 用琥珀
        （激活态），熟成 用橄榄、装瓶 用蓝——四段相邻 ΔE 最小 19.9，
        全对最小 17.0（比图表系列色自己的 16.2 还松）。 */
  function slotColor(slot) {
    var C = BREW.Charts && BREW.Charts.COLORS;
    if (!C) return '';
    switch (slot) {
      case 'olive': return C.palette[6];      /* --s7 橄榄 */
      case 'blue':  return C.palette[4];      /* --s5 蓝 */
      default:      return C[slot] || '';
    }
  }

  /* 图表取色：46 自带一份 fallback 画笔（48 缺失时用），所以这里也要取色。
     一律走 48 的令牌缓存，本文件不存第二份色值。48 没加载时返回空串，
     画布会沿用上一次的样式——比画成黑色好，而且 48 是硬依赖，见文件头。 */
  function col(key) {
    var C = BREW.Charts && BREW.Charts.COLORS;
    return C ? (C[key] || '') : '';
  }

  /* #rrggbb + alpha → rgba()。48 有实现，这里只是转发，不另写一份。 */
  function hexA(c, a) {
    if (BREW.Charts && typeof BREW.Charts.hexA === 'function') return BREW.Charts.hexA(c, a);
    return 'rgba(0,0,0,0)';   /* 兜底透明：装饰性渐变压不出来也不该变黑块 */
  }

  /* 旧枚举兜底：35 没加载、或读到降级数据时，这里还能自己映射。
     与 Config.STATUS_ALIAS 同源，重复一份是为了 46 单文件可用。 */
  var LEGACY_STATUS = {
    planned: 'plan', mashing: 'mash', fermenting: 'ferment',
    conditioning: 'mature', packaged: 'package', finished: 'done'
  };

  function canon(v) {
    if (BREW.Batch && typeof BREW.Batch.normalizeStatus === 'function') {
      return BREW.Batch.normalizeStatus(v);
    }
    return LEGACY_STATUS[v] || v || 'plan';
  }

  /** 阶段在时间轴上的序号，用于"哪些节点已走过"。用 Config.STAGES 的顺序，
   *  所以 b.status 是 boil/chill 这类不在这条状态条上的中间态时也能正确高亮。 */
  function stageRank(v) {
    var stages = (BREW.Config && BREW.Config.STAGES) || [];
    var s = canon(v);
    for (var i = 0; i < stages.length; i++) if (stages[i].id === s) return i;
    return -1;
  }

  var READING_STAGES = ['糖化', '洗糟', '煮沸', '冷却', '接种', '发酵', '干投', '倒罐', '装瓶', '品饮'];

  function statusOf(v) {
    var s = canon(v);
    for (var i = 0; i < STATUS.length; i++) if (STATUS[i].v === s) return STATUS[i];
    return STATUS[0];
  }

  /* ======================================================================
   * 批次模型（对 BREW.Batch 做归一化包装）
   * ----------------------------------------------------------------------
   * 归一化 = 深拷贝 + 补默认值，**不是白名单**。
   * 这里原来是白名单截断（只留 id/name/recipeId/recipeSnapshot/status/volume/
   * notes/createdAt/updatedAt/readings 十个），而 Batch.blank() 产出二十多个字段：
   * batchNo / brewDate / statusHistory / actual / packaging / tasting / cost 全被丢掉。
   * 当时 UI 不读这些字段所以看不出来，但只要存一次再打开，数据就永久没了——
   * 实测值、装瓶记录、品鉴评分一个都接不上。
   * 现在的规则：认识的字段保证有正确类型与默认值，不认识的字段原样带下去。
   * ====================================================================*/

  /* 与 35-batch.js 的 Batch.blank() 逐字段对齐，别另起一套命名 */
  var ACTUAL_DEFAULTS = {
    og: null, fg: null, preBoilVolume: null, postBoilVolume: null,
    mashPh: null, boilPh: null, efficiency: null,
    mashWaterUsed: null, spargeWaterUsed: null, grainWeight: null, notes: ''
  };
  var PACKAGING_DEFAULTS = {
    date: null, volume: null, method: 'bottle', primingSugarType: 'sucrose',
    primingSugarGrams: null, co2Vol: null, bottles: null, notes: ''
  };
  var TASTING_DEFAULTS = {
    date: null, aroma: null, appearance: null, flavor: null,
    mouthfeel: null, overall: null, total: null, notes: '',
    /* v1.2：BJCP 子项细则。null = 还没打分；withDefaults 只补缺失键，
       已经存在的 detail 对象原样保留（老批次补一次空壳也没关系）。 */
    detail: null
  };
  var COST_DEFAULTS = { ingredients: null, other: null, total: null };
  /* v1.4：失败档案。三个字段与 35 的 Batch.blank() / Batch.blankFailure() 逐字段对齐 */
  var FAILURE_DEFAULTS = { type: null, note: '', learned: '' };

  /** 只补缺失的键，已有的值一律不覆盖 */
  function withDefaults(obj, defaults) {
    var out = (obj && typeof obj === 'object') ? obj : {};
    for (var k in defaults) {
      if (!Object.prototype.hasOwnProperty.call(defaults, k)) continue;
      if (out[k] === undefined) out[k] = defaults[k];
    }
    return out;
  }

  function normalizeBatch(src) {
    var raw = (src && typeof src === 'object') ? src : {};
    /* 深拷贝：界面改 b.actual.og 不能顺带改到 store 里那份对象的引用 */
    var b = UI.clone(raw);

    b.id = b.id || UI.uid('batch');
    b.name = b.name || '未命名批次';
    b.recipeId = b.recipeId || '';
    b.recipeSnapshot = b.recipeSnapshot || b.recipe || null;
    /* 读取时归一：这里同时是"迁移漏了"和"降级又写脏了"两道口的兜底 */
    b.status = canon(b.status);
    b.volume = num(b.volume, num((b.recipeSnapshot || {}).batchSize, 20));
    b.notes = b.notes || '';
    b.createdAt = b.createdAt || Date.now();
    b.updatedAt = b.updatedAt || Date.now();

    /* v1.1：这几项以前会被丢掉，现在补默认并保留已有值 */
    b.batchNo = b.batchNo || '';
    b.brewDate = b.brewDate || '';
    b.statusHistory = Array.isArray(b.statusHistory) ? b.statusHistory : [];
    b.actual = withDefaults(b.actual, ACTUAL_DEFAULTS);
    b.packaging = withDefaults(b.packaging, PACKAGING_DEFAULTS);
    b.tasting = withDefaults(b.tasting, TASTING_DEFAULTS);
    b.cost = withDefaults(b.cost, COST_DEFAULTS);
    /* v1.2：酿造日看板状态。null = 没开始；有对象就原样带下去
       （这里不补壳，理由同 35 · Batch.blank：空壳白占空间）。
       键名冻结：brewday / tasting.detail，v1.2 Wave 2 起不许再改名。
       （一度计划改成 brewDay / bjcp，因协调成本大于收益撤回，两个名字不要并存。） */
    b.brewday = (b.brewday && typeof b.brewday === 'object') ? b.brewday : null;
    /* v1.4：失败档案。老批次根本没有这个字段——补一份空壳，已有内容原样保留。
       withDefaults 只填 undefined 的键，所以"用户填过、但类型空着"这种半成品
       不会被冲成默认值（那是记录，不是缺省）。 */
    b.failure = withDefaults(b.failure, FAILURE_DEFAULTS);

    b.readings = [];
    var arr = Array.isArray(raw.readings) ? raw.readings : (Array.isArray(raw.log) ? raw.log : []);
    for (var i = 0; i < arr.length; i++) {
      var rd = arr[i] || {};
      /* 先整条深拷贝，再把认识的字段归一化：
         这样 sgRaw / sampleTemp / ts / corrected 这些原始信息不会被截掉
         （CSV 导出要用到"原始读数"和"样品温度"两列） */
      var o = UI.clone(rd);
      o.id = rd.id || UI.uid('rd');
      o.at = rd.at || rd.time || rd.date || new Date().toISOString();
      o.stage = rd.stage || '发酵';
      o.sg = isFinite(num(rd.sg, NaN)) ? num(rd.sg, 0) : null;
      o.tempC = isFinite(num(rd.tempC !== undefined ? rd.tempC : rd.temp, NaN))
        ? num(rd.tempC !== undefined ? rd.tempC : rd.temp, 0) : null;
      o.ph = isFinite(num(rd.ph, NaN)) ? num(rd.ph, 0) : null;
      o.note = rd.note || '';
      b.readings.push(o);
    }
    b.readings.sort(function (a, b2) { return new Date(a.at) - new Date(b2.at); });
    return b;
  }

  function blankBatch(recipe) {
    var raw = null;
    try {
      /* Batch.blank 要的是**整份配方对象**：它内部第一句就是 calcRecipe(recipe)。
         从前这里传的是 recipe.id（字符串），等于拿 id 当配方算，calc 全 NaN 或抛异常，
         被 catch 吞成 raw=null，再靠后面手工补快照掩盖。 */
      if (BREW.Batch && typeof BREW.Batch.blank === 'function') raw = BREW.Batch.blank(recipe || null);
    } catch (e) { raw = null; }

    var b = normalizeBatch(raw || {});
    if (recipe) {
      b.recipeId = recipe.id;
      /* 优先用 Batch.blank 生成的快照：它带 og/fg/abv/ibu/srm/原料清单/糖化步骤/
         水/预期水量等二十多个字段，比裸配方值钱。只有生成失败才退回裸配方。 */
      if (!b.recipeSnapshot) b.recipeSnapshot = UI.clone(recipe);
      b.volume = num(recipe.batchSize, b.volume);
      if (!b.name || b.name === '未命名批次') b.name = (recipe.name || '未命名配方') + ' · 第 1 批';
    }
    return b;
  }

  /** 批次统计：OG / 当前 SG / 衰减度 / 酒精度 / 天数 / 用水量
   *  取值优先级：用户在「酿造实测」里填的 actual.* > 读数序列。
   *  actual.og 是"整批入罐后测的一次"，比"假设第一个读数就是 OG"可信得多；
   *  以前只能靠读数猜，第一个人为补的读数（甚至是接种时的空点）都会把它带偏。 */
  function stats(b) {
    var act = b.actual || {};
    var readingOg = null, cur = null, firstAt = null, lastAt = null;
    for (var i = 0; i < b.readings.length; i++) {
      var rd = b.readings[i];
      if (rd.sg !== null && isFinite(rd.sg) && rd.sg > 1) {
        if (readingOg === null) { readingOg = rd.sg; firstAt = rd.at; }
        cur = rd.sg;
        lastAt = rd.at;
      }
    }

    var og = readingOg, ogSource = readingOg ? 'reading' : null;
    if (isFinite(num(act.og, NaN)) && num(act.og, 0) > 1) {
      og = num(act.og, 0);
      ogSource = 'actual';
    }

    var fg = cur, fgSource = cur ? 'reading' : null;
    var actFg = num(act.fg, NaN);
    if (isFinite(actFg) && actFg > 0.98 && actFg < 1.2) {
      fg = actFg;
      fgSource = 'actual';
    }

    var snap = b.recipeSnapshot;
    var plan = planOf(snap);
    var planOg = plan ? plan.og : null;
    var atten = (og && fg && og > 1) ? (og - fg) / (og - 1) * 100 : null;
    var abv = (og && fg) ? (og - fg) * 131.25 : null;
    var days = firstAt ? Math.max(0, Math.round((Date.now() - new Date(firstAt).getTime()) / 86400000)) : 0;

    /* 用水量：糖化 + 洗糟，两个都空就是没记 */
    var mashW = num(act.mashWaterUsed, NaN);
    var spargeW = num(act.spargeWaterUsed, NaN);
    var hasMash = isFinite(mashW), hasSparge = isFinite(spargeW);

    /* 发酵预测与停滞判断交给引擎的 analyze()，这里只取要展示的字段。
       点少（<4）时引擎不返回 prediction，界面会显示"—"，这是预期行为。 */
    var prediction = null, stalled = false, diag = null;
    try {
      if (BREW.Batch && typeof BREW.Batch.analyze === 'function') {
        var an = BREW.Batch.analyze(b);
        diag = an;                 /* 整份判词留给诊断卡：以前只取 prediction 与 stalled，剩下的算完就扔 */
        prediction = an.prediction || null;
        stalled = !!an.stalled;
      }
    } catch (e) { prediction = null; }

    return {
      og: og, ogSource: ogSource,
      cur: cur, fg: fg, fgSource: fgSource,
      planOg: planOg,
      plan: plan,
      atten: atten, abv: abv, days: days,
      prediction: prediction, stalled: stalled,
      diag: diag,
      firstAt: firstAt, lastAt: lastAt,
      water: {
        mash: hasMash ? mashW : null,
        sparge: hasSparge ? spargeW : null,
        total: (hasMash || hasSparge) ? (hasMash ? mashW : 0) + (hasSparge ? spargeW : 0) : null
      },
      lastTemp: (function () {
        for (var j = b.readings.length - 1; j >= 0; j--) {
          if (b.readings[j].tempC !== null) return b.readings[j].tempC;
        }
        return null;
      })()
    };
  }

  /* ======================================================================
   * 渲染
   * ====================================================================*/

  function render(el) {
    host = el;
    var list = UI.store.batches().map(normalizeBatch);
    if (!activeId && list.length) activeId = list[0].id;
    var cur = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === activeId) cur = list[i];

    if (!cur && list.length) { cur = list[0]; activeId = cur.id; }

    /* v1.7：三段式。左＝哪几批（我的坑跟在列表之后），中＝主列（今天要填什么），
       右＝系统告诉你什么（诊断 / 失败档案 / 时间轴）。
       为什么把「添加读数」从第 6 位提到第 2 位：它是唯一每天都要做的动作，
       改前实测它在 1680×1050 下的 offsetTop 是 2101（第 2.4 屏），
       而首屏**一个可输入控件都没有**——用户打开"酿造记录"却无处下笔。 */
    el.innerHTML =
      '<div class="section-title">' +
        '<h2>酿造记录</h2>' +
        '<p>每一批都是一次实验：记录比重与温度，才能把配方调到自己的设备上</p>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn btn-primary btn-sm" data-act="new-batch">' + icon('plus', 13) + '新建批次</button>' +
      '</div>' +
      '<div class="batch-grid' + (cur ? '' : ' batch-grid--solo') + '">' +
        '<div class="stack stack--batch">' +
          batchListCard(list) +
          pitfallsCard(list) +
        '</div>' +
        '<div class="stack stack--batch" id="batch-detail">' + (cur ? detailHtml(cur) : emptyDetail()) + '</div>' +
        (cur ? '<div class="batch-rail" id="batch-rail">' + railHtml(cur) + '</div>' : '') +
      '</div>';

    bind(el);
    /* v1.5：给 unitWrap 生成的数值框补 .fld / 宽度 / 校验键，并按当前值
       恢复提示。46 的 change 会整页重画，不跑这一遍，红字会在失焦后消失。 */
    if (UI.FieldHint) {
      UI.FieldHint.wire();
      UI.FieldHint.afterRender(el);
    }
    if (cur) {
      /* 先画再挂观察者：观察者一挂上会立刻回调一次（初始尺寸），
         这时画布已经是新宽度，再画一遍是空转但无害；
         反过来（先挂后画）会在首帧画两遍。 */
      drawChart(cur);
      bindChartResize();
      observeChartBox();
    }
  }

  function listItem(b) {
    var st = statusOf(b.status);
    var s = stats(b);
    return '<button type="button" class="batch-item' + (b.id === activeId ? ' is-on' : '') + '" data-batch="' + attr(b.id) + '">' +
      '<span class="status-dot" style="background:' + attr(slotColor(st.slot)) + '"></span>' +
      '<span class="batch-item__body">' +
        '<span class="batch-item__name">' + esc(b.name) + '</span>' +
        '<span class="batch-item__meta">' + esc(st.t) + ' · ' +
          (s.cur ? 'SG ' + UI.sg(s.cur) : '无读数') + ' · ' + esc(UI.dt(b.createdAt)) + '</span>' +
        failureLine(b) +
      '</span>' +
      '</button>';
  }

  /** 列表行里的失败回看入口：失败批次的第二行小字。
   *  三种实况分别说清——分过类的报类型名，只写了现象的标"未分类"，
   *  一个字都没留的标"还没填"。不写"未知"，因为那三种状态都是确定的。 */
  function failureLine(b) {
    if (canon(b.status) !== 'failed') return '';
    var f = (BREW.Batch && typeof BREW.Batch.failureOf === 'function')
      ? BREW.Batch.failureOf(b) : null;
    var text, cls = '';
    if (f && f.typeLabel) {
      text = '失败档案 · ' + f.typeLabel + (f.learned ? ' · 已写改进' : '');
    } else if (f) {
      text = '失败档案 · 未分类';
      cls = ' is-empty';
    } else {
      text = '失败档案 · 还没填';
      cls = ' is-empty';
    }
    return '<span class="batch-item__fail' + cls + '">' + esc(text) + '</span>';
  }

  function emptyDetail() {
    return '<div class="card"><div class="card__body">' +
      UI.emptyState('记录一批酒的全过程',
        '酿造记录和配方是分开的：同一个配方酿三次，可能因为酵母代数、水温、发酵温度而完全不同。' +
        '记录才能知道差异从哪来。',
        {
          art: 'chart',
          action: '<button type="button" class="btn btn-primary btn-sm" data-act="new-batch">' +
            icon('plus', 13) + '新建第一个批次</button>'
        }) +
      '</div></div>';
  }

  /** 左列：哪几批。单独抽出来是因为「我的坑」现在跟在它后面（v1.7） */
  function batchListCard(list) {
    return '<div class="card">' +
      '<div class="card__head"><h2>批次列表</h2><span class="spacer"></span>' +
      '<span class="u-xs u-dim">' + list.length + ' 批</span></div>' +
      '<div class="card__body card__body--tight">' +
        (list.length ? '<div class="batch-list">' + list.map(listItem).join('') + '</div>'
          : UI.emptyState('还没有批次', '新建批次会保存一份配方快照，之后每次测比重都记在这里。',
            { art: 'chart', small: true })) +
      '</div>' +
      '</div>';
  }

  /** 主列：六张卡，顺序 = 一天里的动作顺序
   *  ①头卡（这一批是谁）→ ②添加读数（每天做）→ ③时间线（刚记的立刻能看见、能删）
   *  → ④酿造实测（开酿那天填一次）→ ⑤装瓶 → ⑥成本。
   *  以前是「头卡 → 这批怎么样 → 酿造实测 → 装瓶 → 成本 → 添加读数 →
   *  时间轴 → 时间线」：把"今天要做的"排在"一年做一次"的后面。 */
  function detailHtml(b) {
    return headCard(b) +
      addReadingCard() +
      readingsCard(b) +
      actualCard(b) +
      packagingCard(b) +
      costCard(b);
  }

  /** 右栏：系统对这一批的判断。
   *  为什么「酿造实测」不放这里（诊断时算过）：7 个字段在 372px 里只能 1 列，
   *  7×(label 21 + 5 + input 40 + 5 + hint 20) = 637px，卡高约 740 ——
   *  比放在 1fr 主列里还高一截，是负优化。右栏只放"读出来"的东西。 */
  function railHtml(b) {
    var s = stats(b);
    return diagCard(b, s) + failureCard(b) + timelineCard(b);
  }

  /* 指标格里的「去填写 →」：格子本身是只读的（改成可编辑会绕过 stats() 的
     actual.* 优先级，出现"格子里 1.055、实测卡还是空"的双源冲突），
     所以给它一条通往真正写入位置的链接。 */
  function figLink(card, focus) {
    return '<button type="button" class="metric__go" data-goto="' + attr(card) + '"' +
      (focus ? ' data-goto-focus="' + attr(focus) + '"' : '') + '>去填写 →</button>';
  }

  /** 批次头卡（v1.7 瘦身）：状态机 + 4 格 + 一行摘要 + 曲线
   *  改前 8 格排 2 行（152px）+ 728px 整卡，把第一个输入框推到 1090px。
   *  8 格里 4 格是纯派生值（衰减 / 酒精度 / 天数 / 预测 FG），
   *  和 4 个有去处的格子混排，用户挨个点过去一个都点不动 ——
   *  现在只留"现在这一刻是多少"的 4 格，其余折成一行摘要，信息一条不少。 */
  function headCard(b) {
    var st = statusOf(b.status);
    var s = stats(b);
    var snap = b.recipeSnapshot;

    /* 状态机 + 「开始酿造」并排。按钮放在**状态机里面**、最后的箭头之后，
       而不是另起一行的右侧：实测 1440 档下 `row--between` 会让这一块
       从 32px 涨到 106px（状态机自己折两行，按钮再占一行），
       正好把「添加读数」挤出首屏。放进来之后状态机折行它跟着折，高度只有一个。 */
    var machine = '<div class="state-machine">';
    var curRank = stageRank(b.status);
    var curV = canon(b.status);
    for (var i = 0; i < STATUS.length; i++) {
      var cls = '';
      if (STATUS[i].v === curV) cls = 'is-now';
      else if (curRank >= 0 && stageRank(STATUS[i].v) < curRank && curV !== 'failed') cls = 'is-done';
      if (STATUS[i].v === 'failed') cls = (curV === 'failed' ? 'is-failed' : '');
      machine += '<button type="button" class="state-step ' + cls + '" data-status="' + attr(STATUS[i].v) + '">' +
        (cls === 'is-done' ? icon('check', 11) : '') + esc(STATUS[i].t) + '</button>';
      if (i < STATUS.length - 2) machine += '<span class="state-step__arrow">→</span>';
    }
    /* 「开始酿造」：docs/00 从 v1.2 起就写着"批次头卡挂了开始酿造日入口"，
       但那个入口从来没有存在过。只在还没开始计时时出现——已经开过的批次再点它没有意义。 */
    var started = !!(b.brewday && num(b.brewday.startedAt, 0) > 0);
    var canStart = !started && curV !== 'failed' && curV !== 'done';
    if (canStart) {
      machine += '<span class="sm-sep" aria-hidden="true"></span>' +
        '<button type="button" class="btn btn-primary btn-sm" data-act="start-brew" ' +
        'title="去酿造日：按分钟推进今天的步骤">' + icon('clock', 13) + '开始酿造</button>';
    }
    machine += '</div>';

    /* 一行摘要（4 项）：实测 OG / 预估酒精度 / 用水量 / 预测终点 FG。
       这四项原来各占一格，其中两项（OG / 用水量）的真正写入位置在「酿造实测」卡，
       放到那一行里反而离输入框更近。 */
    var bits = [];
    bits.push('<span class="bh" title="' + attr(ogSub(s)) + '">实测 OG <b data-metric="og" data-src="' +
      attr(s.ogSource || '') + '">' + (s.og ? UI.sg(s.og) : '—') + '</b></span>');
    bits.push('<span class="bh">预估酒精度 <b data-metric="abv">' +
      (s.abv !== null ? fmt(s.abv, 2) + '%' : '—') + '</b></span>');
    bits.push('<span class="bh">用水量 <b data-metric="water" title="' + attr(waterSub(s)) + '">' +
      (s.water.total !== null ? fmt(s.water.total, 1) + ' L' : '—') + '</b></span>');
    bits.push('<span class="bh">预测终点 FG <b data-metric="fg">' +
      (s.prediction ? UI.sg(s.prediction.fg) : '—') + '</b></span>');

    return '<div class="card" data-card="head">' +
        '<div class="card__head">' +
          '<h2>' + esc(b.name) + '</h2>' +
          '<span class="badge" style="color:' + attr(slotColor(st.slot)) + ';border-color:' + attr(slotColor(st.slot)) + '55;background:' + attr(slotColor(st.slot)) + '18">' +
            esc(st.t) + '</span>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="rename">重命名</button>' +
          '<button type="button" class="btn btn-danger btn-sm" data-act="del-batch">删除</button>' +
        '</div>' +
        '<div class="card__body">' +
          machine +
          '<div class="grid-4 mt-12 batch-figs">' +
            statCard('当前比重', s.cur ? UI.sg(s.cur) : '—',
              s.lastAt ? UI.dt(s.lastAt, true) : '尚无读数', figLink('add-reading', 'r-sg')) +
            statCard('实测表观衰减', s.atten !== null ? fmt(s.atten, 1) + '%' : '—', attenSub(s, snap)) +
            statCard('已发酵天数', s.days + ' 天', s.firstAt ? '自 ' + UI.dt(s.firstAt) : '未开始') +
            statCard('最近温度', s.lastTemp !== null ? fmt(s.lastTemp, 1) + ' °C' : '—',
              snap && snap.yeasts && snap.yeasts[0] ? '目标 ' + fmt(num(snap.yeasts[0].tempC, 19), 1) + ' °C' : '',
              figLink('add-reading', 'r-temp')) +
          '</div>' +
          /* 酿造日期：以前只在建批那一刻写一次（newBatchDialog），事后无法修改，
             而分析页的年份分组、月度图、年度花费全都按它归类——填错一天，
             那一锅就整年对不上账。放在这行"这一批的事实"里，而不是脚注：
             1280 档下头卡脚注要滚一屏才看得见，这行在 1/3 屏处。 */
          '<p class="batch-headline">' +
            '<label class="batch-date" for="bd-date">酿造日期' +
              '<input class="input" id="bd-date" type="date" value="' +
                attr(String(b.brewDate || '').slice(0, 10)) + '"></label>' +
            '<span class="bh-sep">·</span>' +
            bits.join('<span class="bh-sep">·</span>') +
            '<span class="bh-sep">·</span>' +
            '<button type="button" class="goto" data-goto="actual" data-goto-focus="ac-og">去填实测 →</button>' +
            '<button type="button" class="goto" data-act="to-tasting">去打品鉴分 →</button>' +
          '</p>' +
          '<div class="mt-16">' +
            '<div class="row row--between" style="margin-bottom:6px">' +
              '<span class="u-xs u-dim" style="letter-spacing:.6px">发酵曲线</span>' +
              '<span class="u-xs u-dim" id="chart-note"></span>' +
            '</div>' +
            '<div class="chart-frame"><canvas id="ferm-chart" role="img" aria-label="比重与温度随时间的发酵曲线"></canvas></div>' +
            '<div class="chart-legend">' +
              '<span class="legend__item"><span class="legend__sw" style="background:' + attr(col('primary')) + '"></span>比重 SG</span>' +
              '<span class="legend__item"><span class="legend__sw" style="background:' + attr(col('blue')) + '"></span>温度 °C</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="u-xs u-dim batch-snap">配方快照：' + (snap ? esc(snap.name || '—') : '无') + '</span>' +
          '<span class="spacer"></span>' +
          (snap ? '<button type="button" class="btn btn-quiet btn-sm" data-act="load-recipe">在编辑器中打开该配方</button>' : '') +
        '</div>' +
      '</div>';
  }

  /** 添加读数（主列第 2 张）：每天都要用，所以"记录"按钮放卡头右侧，
     不再占栅格最后一个格子——那样在 2 列布局下会独自占掉一整行。 */
  function addReadingCard() {
    return '<div class="card" data-card="add-reading">' +
        '<div class="card__head"><h2>添加读数</h2><span class="spacer"></span>' +
          '<span class="u-xs u-dim">测一次记一次，比回忆可靠</span>' +
          '<button type="button" class="btn btn-primary btn-sm" data-act="add-reading">' +
            icon('plus', 13) + '记录</button>' +
        '</div>' +
        '<div class="card__body">' +
          '<div class="grid-4">' +
            '<div class="field"><label class="field__label" for="r-at">时间</label>' +
              '<input class="input" id="r-at" type="datetime-local" value="' + attr(UI.todayInput()) + '"></div>' +
            '<div class="field"><label class="field__label" for="r-stage">阶段</label>' +
              '<select class="select" id="r-stage">' +
                READING_STAGES.map(function (s2) {
                  return '<option value="' + attr(s2) + '"' + (s2 === '发酵' ? ' selected' : '') + '>' + esc(s2) + '</option>';
                }).join('') + '</select></div>' +
            '<div class="field"><label class="field__label" for="r-sg">比重 SG</label>' +
              UI.fldWrap('r-sg', '', 'SG', { step: '0.001', min: 0.98, max: 1.2, ariaLabel: '比重' }) + '</div>' +
            '<div class="field"><label class="field__label" for="r-temp">温度</label>' +
              UI.fldWrap('r-temp', '', '°C', { step: '0.5', min: -5, max: 45, ariaLabel: '温度' }) + '</div>' +
            '<div class="field"><label class="field__label" for="r-ph">pH</label>' +
              UI.fldWrap('r-ph', '', 'pH', { step: '0.01', min: 0, max: 14, ariaLabel: 'pH' }) + '</div>' +
            '<div class="field" style="grid-column:span 2"><label class="field__label" for="r-note">备注</label>' +
              '<input class="input" id="r-note" type="text" placeholder="闻到什么、泡盖状态、是否有硫味…"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /** 时间线（主列第 3 张）：读数明细，刚记的就在最上面，可删、可导 CSV */
  function readingsCard(b) {
    return '<div class="card" data-card="readings">' +
        '<div class="card__head"><h2>时间线</h2><span class="spacer"></span>' +
          '<span class="u-xs u-dim">' + b.readings.length + ' 条记录</span>' +
          (b.readings.length
            ? '<button type="button" class="btn btn-ghost btn-sm" data-act="export-csv">' +
              icon('down', 12) + '导出 CSV</button>'
            : '') +
        '</div>' +
        '<div class="card__body">' + timelineHtml(b) + '</div>' +
      '</div>';
  }

  /* ---------------------------------------------------------- 酿造实测 */

  /* 字段表：一张表驱动渲染与回写，避免 8 个 if 手写两遍 */
  var ACTUAL_FIELDS = [
    { key: 'og', id: 'ac-og', label: '实际 OG', unit: 'SG', step: '0.001', min: 0.98, max: 1.2, sg: true, hint: '整批入罐后测的比重' },
    { key: 'fg', id: 'ac-fg', label: '实际 FG', unit: 'SG', step: '0.001', min: 0.98, max: 1.2, sg: true, hint: '装瓶前测的比重' },
    { key: 'mashWaterUsed', id: 'ac-mash-water', label: '糖化用水', unit: 'L', step: '0.5', min: 0, max: 60, hint: '实际进了多少糖化水' },
    { key: 'spargeWaterUsed', id: 'ac-sparge-water', label: '洗糟用水', unit: 'L', step: '0.5', min: 0, max: 60, hint: '实际用了多少洗糟水' },
    { key: 'grainWeight', id: 'ac-grain', label: '麦芽总重', unit: 'kg', step: '0.1', min: 0, max: 50, hint: '称了多少麦芽' },
    { key: 'mashPh', id: 'ac-ph', label: '糖化 pH', unit: 'pH', step: '0.01', min: 0, max: 14, hint: '室温取样测的 pH' },
    { key: 'efficiency', id: 'ac-eff', label: '实际效率', unit: '%', step: '1', min: 10, max: 100, hint: '填了麦芽总重与实际 OG 会自动回填' }
  ];

  function actualCard(b) {
    var a = b.actual || {};
    var fields = '';
    for (var i = 0; i < ACTUAL_FIELDS.length; i++) {
      var f = ACTUAL_FIELDS[i];
      var v = a[f.key];
      var shown = (v === null || v === undefined || v === '') ? ''
        : (f.sg ? UI.sg(v) : fmt(v, f.key === 'mashPh' ? 2 : 1));
      /* v1.7：字段级 hint 收口到卡片底部一条 .card__hint。
         每条 hint 独占一行时是 label 21 + 5 + input 40 + 5 + hint 20 = 91px，
         去掉 hint 后 66px —— 7 个字段省 175px，信息一条没删（见上面的清单）。 */
      fields += '<div class="field">' +
        '<label class="field__label" for="' + attr(f.id) + '">' + esc(f.label) + '</label>' +
        UI.fldWrap(f.id, shown, f.unit, {
          step: f.step, min: f.min, max: f.max,
          ariaLabel: f.label, inputmode: 'decimal'
        }) +
        '</div>';
    }
    /* span 3 → 1/-1：栅格在窄档退 2 列时，span 3 会凭空造出**第三条隐式列**，
       备注框溢出卡片（1440 档实测）。1/-1 = "占满当前列数"，两档都对。 */
    fields += '<div class="field" style="grid-column:1/-1">' +
      '<label class="field__label" for="ac-notes">备注</label>' +
      '<input class="input" id="ac-notes" type="text" value="' + attr(a.notes || '') + '" ' +
        'placeholder="与计划不符的地方：水质、粉碎度、实际煮沸时间…"></div>';

    return '<div class="card" data-card="actual">' +
      '<div class="card__head"><h2>酿造实测</h2><span class="spacer"></span>' +
        '<span class="u-xs u-dim">实测优先于推算：填了实际 OG，上面的表观衰减与酒精度就按它算</span></div>' +
      '<div class="card__body"><div class="grid-4">' + fields + '</div>' +
        /* FG > OG 是"两格单看都正常、合起来是另一锅酒"的典型。
           放在实测卡里，与两个比重框同屏，改完立刻能看到。 */
        '<div class="fld-rel" id="rel-actual">' +
          relLine('fgVsOg', { og: a.og, fg: a.fg }) +
        '</div>' +
      '</div>' +
      '<div class="card__hint">' +
        /* 逐字段说明由字段表拼出来：文案只有一份（ACTUAL_FIELDS[i].hint），
           收口的是**位置**，不是内容。 */
        fieldHintLine(ACTUAL_FIELDS) + '。' +
        '留空表示「还没测」，不会被当成 0。用水量与麦芽总重是复盘效率的关键：' +
        '同一份配方酿三次，差异多半出在这两个数上。' +
        '<br>库存口径：余额按「原料库 → 库存」里的出入库流水逐笔累加，' +
        '手填的数量只用于首次盘点；导出/导入不会重算它。' +
      '</div>' +
      '</div>';
  }


  /* ---------------------------------------------------------- 装瓶与成本
   * 这两块以前**完全没有界面**：packaging 8 个字段、cost 3 个字段只被读、
   * 永远写不进去。后果不是"少两个框"，而是分析页的"总产量"永远标着估算、
   * "每升成本"永远显示 —。这里把入口补上，字段表驱动渲染与回写。 */

  var PKG_FIELDS = [
    { key: 'date', id: 'pk-date', label: '装瓶日期', type: 'date', hint: '实际装瓶那天' },
    { key: 'volume', id: 'pk-volume', label: '装瓶量', unit: 'L', step: '0.1', min: 0, max: 200, hint: '真正进瓶/进桶的升数' },
    { key: 'bottles', id: 'pk-bottles', label: '瓶数', unit: '瓶', step: '1', min: 0, max: 500, hint: '按 330/500 ml 折算的瓶数' },
    { key: 'co2Vol', id: 'pk-co2', label: '目标碳酸', unit: 'vol', step: '0.1', min: 0.5, max: 5, hint: '拉格 2.5 / 艾尔 2.3 / 小麦 3.3' }
  ];

  var COST_FIELDS = [
    { key: 'ingredients', id: 'co-ing', label: '原料成本', unit: '元', step: '1', min: 0, max: 100000, hint: '麦芽+酒花+酵母+辅料' },
    { key: 'other', id: 'co-other', label: '其它成本', unit: '元', step: '1', min: 0, max: 100000, hint: '气、电、清洗剂、瓶盖' }
  ];

  /** 字段级 hint 的收口写法：一条「**字段** 说明 · **字段** 说明」。
   *  只改位置（框下独占一行 → 卡片底部一行），不改一个字。 */
  function fieldHintLine(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push('<b>' + esc(list[i].label) + '</b> ' + esc(list[i].hint));
    }
    return out.join(' · ');
  }


  /* ---------------------------------------------------------- 批次诊断
   * 引擎的 analyze() 早就算好了 vsDesign / stalled / readyToPackage / tempStats，
   * 界面却只取走了 prediction 和 stalled 一个布尔——"算完扔掉"。
   * 这里把判断结果rendering 出来：用户要的不是数字，是"下一锅改什么"。 */

  function diagCard(b, s) {
    var d = s && s.diag;
    if (!d) return '';
    var vs = d.vsDesign || null;
    var rows = [];

    if (vs && vs.ogDiffPoints !== null && vs.ogDiffPoints !== undefined) {
      var diff = vs.ogDiffPoints;
      var tone = (diff <= -8) ? 'bad' : (diff >= 8) ? 'warn' : 'ok';
      rows.push({
        tone: tone,
        title: vs.verdict || '与设计对比',
        body: (diff === 0 ? '实测与设计完全一致。'
          : '实测 OG ' + UI.sg(vs.ogActual) + '，设计 ' + UI.sg(vs.ogDesign) +
            '（差 ' + (diff > 0 ? '+' : '') + diff + ' 点）。') +
          (vs.efficiencyActual !== null && vs.efficiencyActual !== undefined
            ? ' 反推实际效率 ' + fmt(vs.efficiencyActual, 1) + '%，设定 ' + fmt(vs.efficiencyDesign, 0) + '%。' : ''),
        advice: vs.advice || ''
      });
    }

    if (d.stalled && d.stallReason) {
      rows.push({ tone: 'warn', title: '发酵可能停滞', body: d.stallReason,
        advice: '先测一次比重确认，再考虑升温 2–3°C 并轻摇罐体把酵母重新悬浮；别贸然补酵母。' });
    }
    if (d.readyToPackage && d.packageNote) {
      rows.push({ tone: 'ok', title: '可以考虑装瓶', body: d.packageNote, advice: '' });
    }

    var ts = d.tempStats;
    if (ts && ts.min !== null && ts.min !== undefined) {
      var snap2 = b.recipeSnapshot || {};
      /* 目标温度优先取酵母行，退到配方的发酵温度——两者都可能缺，缺了就不判 */
      var target = num((snap2.yeasts || [])[0] && snap2.yeasts[0].tempC, null);
      if (target === null) target = num(snap2.fermentTemp, null);
      var spread = BREW.Util.round(ts.max - ts.min, 1);
      if (target !== null && (ts.max - target > 2 || target - ts.min > 2)) {
        rows.push({ tone: 'warn', title: '发酵温度偏离目标',
          body: '实测 ' + fmt(ts.min, 1) + '–' + fmt(ts.max, 1) + '°C（均 ' + fmt(ts.avg, 1) +
            '°C），目标 ' + fmt(target, 1) + '°C。',
          advice: spread > 4 ? '波动 ' + fmt(spread, 1) + '°C 偏大：酯香与高级醇会明显变化，下次控温更严一些。' : '' });
      }
    }

    if (!rows.length) {
      return '<div class="card"><div class="card__head"><h2>这批怎么样</h2><span class="spacer"></span>' +
        '<span class="u-xs u-dim">引擎判过一遍，没发现异常</span></div>' +
        '<div class="card__body"><div class="u-sm u-dim">读数还太少或一切正常。' +
        '记满 4 个比重点后这里会给出：与设计的偏差、是否停滞、该不该装瓶。</div></div></div>';
    }

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<div class="diag-row diag-row--' + attr(r.tone) + '">' +
        '<div class="diag-row__t">' + esc(r.title) + '</div>' +
        '<div class="diag-row__b">' + UI.md(r.body || '') + '</div>' +
        (r.advice ? '<div class="diag-row__a">' + UI.md(r.advice) + '</div>' : '') +
        '</div>';
    }

    return '<div class="card"><div class="card__head"><h2>这批怎么样</h2><span class="spacer"></span>' +
      '<span class="u-xs u-dim">' + rows.length + ' 条判断 · 依据实测读数，不看设定值</span></div>' +
      '<div class="card__body diag-list">' + html + '</div></div>';
  }

  /** 装瓶卡：顺带给出"该放多少糖"，这是装瓶当天真正需要算的数 */
  function packagingCard(b) {
    var p = b.packaging || {};
    var fields = '';
    for (var i = 0; i < PKG_FIELDS.length; i++) {
      var f = PKG_FIELDS[i];
      var v = p[f.key];
      if (f.type === 'date') {
        fields += '<div class="field"><label class="field__label" for="' + attr(f.id) + '">' + esc(f.label) + '</label>' +
          '<input class="input" id="' + attr(f.id) + '" type="date" value="' + attr(v || '') + '"></div>';
      } else {
        fields += '<div class="field"><label class="field__label" for="' + attr(f.id) + '">' + esc(f.label) + '</label>' +
          UI.fldWrap(f.id, (v === null || v === undefined) ? '' : fmt(v, f.key === 'bottles' ? 0 : 1), f.unit,
            { step: f.step, min: f.min, max: f.max, ariaLabel: f.label, inputmode: 'decimal' }) +
          '</div>';
      }
    }

    /* 糖量：按体积 + 目标碳酸 + 最高温度算，别让用户自己去查表 */
    var sugarLine = '';
    var vol = num(p.volume, null) || num((b.actual || {}).postBoilVolume, null) || num((b.recipeSnapshot || {}).batchSize, 20);
    var target = num(p.co2Vol, null) || num(((b.recipeSnapshot || {}).carbonation || {}).targetVol, 2.4);
    var tempC = num((b.recipeSnapshot || {}).fermentTemp, 20);
    try {
      var carb = BREW.Calc.carbonation({
        batchSize: vol,
        carbonation: { targetVol: target, tempC: tempC, sugarType: p.primingSugarType || 'sucrose' }
      });
      var g = num(p.primingSugarGrams, null);
      sugarLine = '<div class="pkg-sugar">' +
        '<div><span class="u-xs u-dim">按 ' + fmt(vol, 1) + ' L / ' + fmt(target, 1) + ' vol / 最高 ' +
          fmt(tempC, 0) + ' °C 估算</span>' +
        '<div class="pkg-sugar__v"><b>' + fmt(carb.recommended, 1) + ' g</b> 蔗糖' +
        (g !== null ? '　<span class="u-xs u-dim">已手工填 ' + fmt(g, 1) + ' g</span>' : '') + '</div></div>' +
        '<button type="button" class="btn btn-quiet btn-sm" data-act="use-priming">用这个数</button>' +
        '</div>' +
        '<div class="u-xs u-dim" style="margin-top:6px">' + esc(carb.note) + '</div>' +
        (carb.warning ? '<div class="alert alert--warn" style="margin-top:8px">' + esc(carb.warning) + '</div>' : '');
    } catch (e) { /* 计算失败就不显示糖量，不影响其它字段 */ }

    return '<div class="card" data-card="pkg">' +
      '<div class="card__head"><h2>装瓶</h2><span class="spacer"></span>' +
        '<span class="u-xs u-dim">填了它，分析页的产量与每升成本就不再是估算</span></div>' +
      '<div class="card__body">' +
        '<div class="grid-4">' + fields +
          '<div class="field"><label class="field__label" for="pk-sugar">碳化糖量</label>' +
            UI.fldWrap('pk-sugar', (p.primingSugarGrams === null || p.primingSugarGrams === undefined) ? '' :
              fmt(p.primingSugarGrams, 1), 'g', { step: '0.5', min: 0, max: 2000, ariaLabel: '碳化糖量', inputmode: 'decimal' }) +
            '</div>' +
        '</div>' +
        sugarLine +
        /* 装瓶量 > 入罐量：发酵会带走一批（酵母泥、干投吸液、取样），
           所以这个不等式只有填错或拿错批次数据两种可能。 */
        '<div class="fld-rel" id="rel-pkg">' +
          relLine('pkgVsBatch', {
            pkgL: p.volume,
            batchL: (b.recipeSnapshot || {}).batchSize
          }) +
        '</div>' +
      '</div>' +
      '<div class="card__hint">' + fieldHintLine(PKG_FIELDS) +
        ' · <b>碳化糖量</b> 蔗糖；用葡萄糖 ×1.16。' +
        '装瓶量填"真正进瓶的升数"，不是发酵罐里的总量——桶底酵母泥不算酒。</div>' +
      '</div>';
  }

  /** 成本卡：每升成本是长期用户唯一会拿去和别人比的数 */
  function costCard(b) {
    var c = b.cost || {};
    var fields = '';
    for (var i = 0; i < COST_FIELDS.length; i++) {
      var f = COST_FIELDS[i];
      var v = c[f.key];
      fields += '<div class="field"><label class="field__label" for="' + attr(f.id) + '">' + esc(f.label) + '</label>' +
        UI.fldWrap(f.id, (v === null || v === undefined) ? '' : fmt(v, 0), f.unit,
          { step: f.step, min: f.min, max: f.max, ariaLabel: f.label, inputmode: 'decimal' }) +
        '</div>';
    }
    var total = (num(c.total, null) !== null) ? num(c.total, 0) : num(c.ingredients, 0) + num(c.other, 0);
    var p = b.packaging || {};
    var vol = num(p.volume, null) || num((b.actual || {}).postBoilVolume, null);
    var perL = (total > 0 && vol && vol > 0) ? total / vol : null;

    return '<div class="card" data-card="cost">' +
      '<div class="card__head"><h2>成本</h2><span class="spacer"></span>' +
        '<span class="u-xs u-dim">' + (perL !== null
          ? '合计 ¥' + fmt(total, 0) + ' · 每升 ¥' + fmt(perL, 2)
          : '填了成本与装瓶量，就能算出每升多少钱') + '</span></div>' +
      '<div class="card__body"><div class="grid-4">' + fields + '</div></div>' +
      '<div class="card__hint">' + fieldHintLine(COST_FIELDS) + '。' +
        '原料单价库里没有，按你实际买的算；连运费一起摊进去更接近真实成本。</div>' +
      '</div>';
  }

  function writePackaging(el) {
    var b = currentBatch();
    if (!b) return;
    if (!b.packaging) b.packaging = withDefaults(null, { date: null, volume: null, method: 'bottle', primingSugarType: 'sucrose', primingSugarGrams: null, co2Vol: null, bottles: null, notes: '' });
    var key = null;
    for (var i = 0; i < PKG_FIELDS.length; i++) if (PKG_FIELDS[i].id === el.id) key = PKG_FIELDS[i].key;
    if (el.id === 'pk-sugar') key = 'primingSugarGrams';
    if (!key) return;

    var raw = String(el.value || '').trim();
    if (key === 'date') {
      b.packaging.date = raw || null;
    } else {
      var v = raw === '' ? null : num(raw, null);
      if (v !== null && !isFinite(v)) v = null;
      b.packaging[key] = v;
    }
    persist(b);
    render(host);
  }

  function writeCost(el) {
    var b = currentBatch();
    if (!b) return;
    if (!b.cost) b.cost = { ingredients: null, other: null, total: null };
    var key = null;
    for (var i = 0; i < COST_FIELDS.length; i++) if (COST_FIELDS[i].id === el.id) key = COST_FIELDS[i].key;
    if (!key) return;
    var raw = String(el.value || '').trim();
    var v = raw === '' ? null : num(raw, null);
    if (v !== null && !isFinite(v)) v = null;
    b.cost[key] = v;
    /* total 让它在读侧自己求和（37 的 costOf 会退到 ingredients+other），
       这里显式清掉，避免"改了分项、合计还是旧值" */
    b.cost.total = null;
    persist(b);
    render(host);
  }

  /* ---------------------------------------------------------- 失败档案（v1.4）
   * 三个字段都走 Store.saveBatch（内部有 flush 节流），不直接改内存。
   * 只有"值真的变了"才落盘 + 重绘：textare 的 change 在每次失焦都触发，
   * 无条件重绘会让用户在几个框之间 Tab 时不断丢焦点。 */
  function writeFailure(el) {
    var b = currentBatch();
    if (!b) return;
    if (!b.failure || typeof b.failure !== 'object') b.failure = withDefaults(null, FAILURE_DEFAULTS);
    var f = b.failure;

    var key = null, val = '';
    if (el.id === 'fa-type') key = 'type';
    else if (el.id === 'fa-note') key = 'note';
    else if (el.id === 'fa-learned') key = 'learned';
    if (!key) return;

    if (key === 'type') {
      /* 空字符串存 null：'' 不是枚举值，混进来会让聚合多出一个空桶 */
      val = el.value ? String(el.value) : null;
    } else {
      val = String(el.value || '').trim().slice(0, 200);
    }

    var before = f[key] === undefined ? (key === 'type' ? null : '') : f[key];
    if (before === val) return;          /* 没改就不碰存储 */

    f[key] = val;
    persist(b);                          /* → UI.store.saveBatch（节流落盘） */

    /* 重绘后把焦点还回原处：类型下拉要重绘（左侧列表小字和「我的坑」都得跟着变），
       文本域也要重绘（「我的坑」里显示的就是刚写的 learned）。 */
    renderAndRestoreFocus(el.id);
  }

  /** 整页重绘 + 焦点/光标复位。焦点丢了比数据晚刷一秒更烦人。 */
  function renderAndRestoreFocus(id) {
    render(host);
    var el = id ? document.getElementById(id) : null;
    if (!el || typeof el.focus !== 'function') return;
    try {
      el.focus();
      var n = String(el.value || '').length;
      if (el.setSelectionRange) el.setSelectionRange(n, n);
    } catch (e) { /* 有些控件不支持选区，聚焦到就算成功 */ }
  }

  /** 把估算糖量写进字段 */
  function usePriming() {
    var b = currentBatch();
    if (!b) return;
    if (!b.packaging) b.packaging = withDefaults(null, { date: null, volume: null, method: 'bottle', primingSugarType: 'sucrose', primingSugarGrams: null, co2Vol: null, bottles: null, notes: '' });
    var p = b.packaging;
    var vol = num(p.volume, null) || num((b.actual || {}).postBoilVolume, null) || num((b.recipeSnapshot || {}).batchSize, 20);
    var target = num(p.co2Vol, null) || num(((b.recipeSnapshot || {}).carbonation || {}).targetVol, 2.4);
    var tempC = num((b.recipeSnapshot || {}).fermentTemp, 20);
    try {
      var carb = BREW.Calc.carbonation({
        batchSize: vol,
        carbonation: { targetVol: target, tempC: tempC, sugarType: p.primingSugarType || 'sucrose' }
      });
      p.primingSugarGrams = carb.recommended;
      if (!p.co2Vol) p.co2Vol = carb.targetVol;
      persist(b);
      render(host);
      UI.Shell.toast('已填入 ' + fmt(carb.recommended, 1) + ' g 蔗糖（' + fmt(vol, 1) + ' L / ' + fmt(target, 2) + ' vol）', 'ok', 2600);
    } catch (e) { UI.reportError(e, 'priming'); }
  }

  /** 指标卡副标题：把"值从哪来"说清楚，别让用户猜 */
  function ogSub(s) {
    var design = (s.plan && s.plan.og) ? UI.sg(s.plan.og) : null;
    if (!s.og) return design ? '设计 ' + design + ' · 等实测' : '尚无读数';
    if (s.ogSource === 'actual') return '实测值' + (design ? ' · 设计 ' + design : '');
    return design ? '取自读数 · 设计 ' + design : '取自第一条读数';
  }

  function attenSub(s, snap) {
    if (s.atten === null) return '';
    if (s.fgSource === 'actual') return '按实测 FG 计算';
    if (snap && snap.yeasts && snap.yeasts[0]) return '标称 ' + fmt(yeastAtten(snap), 0) + '% · 当前读数';
    return '按当前读数';
  }

  /* 设计值：新批次一进来 8 个格子全是"—"，看着像空壳。
     其实配方快照里 OG/FG/ABV/用水都是算得出来的，只是以前没渲染。
     这里统一取一份，只在"实测缺失"时当副标题用——不覆盖实测。 */
  function planOf(snap) {
    if (!snap) return null;
    var c = null;
    try { c = UI.calc(snap); } catch (e) { return null; }
    if (!c) return null;
    /* 注意：Calc 返回的 mashWater / spargeWater 是**数字**（升），不是对象。
       这里踩过一次——按对象取 .mash 拿到 undefined，用水那格就永远不显示设计值。 */
    var mw = num(c.mashWater, null), sw = num(c.spargeWater, null);
    return {
      og: num(c.og, null), fg: num(c.fg, null), abv: num(c.abv, null),
      mash: mw, sparge: sw,
      water: (mw || sw) ? (mw || 0) + (sw || 0) : null
    };
  }

  function waterSub(s) {
    var w = s.water || {};
    if (w.total === null) {
      var p = s.plan;
      if (p && p.water) {
        var bits = [];
        if (p.mash) bits.push('糖化 ' + fmt(p.mash, 1) + ' L');
        if (p.sparge) bits.push('洗糟 ' + fmt(p.sparge, 1) + ' L');
        return '设计 ' + bits.join(' + ') + ' · 实测待填';
      }
      return '在「酿造实测」里填';
    }
    var parts = [];
    if (w.mash !== null) parts.push('糖化 ' + fmt(w.mash, 1) + ' L');
    if (w.sparge !== null) parts.push('洗糟 ' + fmt(w.sparge, 1) + ' L');
    return parts.join(' + ');
  }

  /**
   * 用实际 OG 与麦芽总重反推效率。
   * 理论点数 = Σ(ppg × kg × 8.3454) / 体积（8.3454 是 lb/gal → kg/L 的换算）。
   * 只在 efficiency 为空时回填，绝不覆盖用户手填的值。
   */
  function autoEfficiency(b) {
    var a = b.actual || {};
    if (a.efficiency !== null && a.efficiency !== undefined && a.efficiency !== '') return;

    var og = num(a.og, NaN);
    var grain = num(a.grainWeight, NaN);
    if (!isFinite(og) || og <= 1 || !isFinite(grain) || grain <= 0) return;

    var snap = b.recipeSnapshot || {};
    var volume = num(b.volume, num(snap.batchSize, 20));
    if (!(volume > 0)) return;

    var ferm = snap.fermentables || [];
    var points = 0, snapGrain = 0;
    for (var i = 0; i < ferm.length; i++) {
      var f = ferm[i];
      if (f.cat === 'sugar' || f.cat === 'extract') continue;   /* 糖与提取物不参与效率 */
      var kg = num(f.amount, 0);
      points += num(f.ppg, 0) * kg * 8.3454 / volume;
      snapGrain += kg;
    }
    if (points <= 0) return;

    /* 用户称的麦芽总量与快照不一致时，按比例缩放理论点数 */
    if (snapGrain > 0 && Math.abs(grain - snapGrain) > 0.05) {
      points = points * (grain / snapGrain);
    }

    var eff = (og - 1) * 1000 / points * 100;
    if (!isFinite(eff) || eff < 5 || eff > 120) return;
    a.efficiency = Math.round(eff * 10) / 10;
  }

  /** 只读指标格。v1.7 去掉 border + radius：原来和数值输入框同款 8px 圆角 + 1px 边，
      点过去一个都点不动——"看起来能填"是最坏的一种诚实。
      go 有值时右上角挂一条「去填写 →」，指向真正能写的那张卡。 */
  function statCard(label, value, sub, go) {
    return '<div class="metric batch-fig">' +
      '<div class="metric__label">' + esc(label) + (go || '') + '</div>' +
      '<div class="metric__val">' + esc(value) + '</div>' +
      '<div class="metric__sub">' + esc(sub || '') + '</div>' +
      '</div>';
  }

  function yeastAtten(snap) {
    var y = snap.yeasts && snap.yeasts[0];
    if (!y) return 75;
    return num(y.att !== undefined ? y.att : y.atten, 75);
  }

  function timelineHtml(b) {
    if (!b.readings.length) {
      return UI.emptyState('还没有读数', '第一次测比重通常在主发酵开始后 24–48 小时。', { small: true, art: 'chart', size: 48 });
    }
    var html = '<div class="timeline">';
    for (var i = b.readings.length - 1; i >= 0; i--) {
      var rd = b.readings[i];
      var vals = [];
      if (rd.sg !== null) vals.push('SG ' + UI.sg(rd.sg));
      if (rd.tempC !== null) vals.push(fmt(rd.tempC, 1) + ' °C');
      if (rd.ph !== null) vals.push('pH ' + fmt(rd.ph, 2));
      html += '<div class="tl-item' + (vals.length ? '' : ' tl-item--muted') + '">' +
        '<span class="tl-item__dot"></span>' +
        '<div class="tl-item__head">' +
          '<span class="tl-item__stage">' + esc(rd.stage) + '</span>' +
          '<span class="tl-item__time">' + esc(UI.dt(rd.at, true)) + '</span>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn btn-quiet btn-icon" data-del-reading="' + attr(rd.id) + '" ' +
            'title="删除这条记录" aria-label="删除这条记录">' + icon('trash', 12) + '</button>' +
        '</div>' +
        (vals.length ? '<div class="tl-item__vals">' + esc(vals.join('  ·  ')) + '</div>' : '') +
        (rd.note ? '<div class="tl-item__note">' + esc(rd.note) + '</div>' : '') +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  /* ======================================================================
   * 时间轴（v1.4）
   * ----------------------------------------------------------------------
   * 与上面「时间线」的分工，写清楚免得以后被合并掉：
   *   时间轴 = 四类事件合流（读数 + 酿造日步骤 + 状态 + 品鉴），回答"这一锅经历了什么"；
   *   时间线 = 读数明细，逐条可删、可导 CSV，回答"我记了哪些数"。
   * 两块都留：删错读数要用时间线，找因果要看时间轴。合成一块会两头都不好用。
   * ====================================================================*/

  var EV_KIND_ZH = { reading: '读数', brewstep: '酿造日', status: '状态', tasting: '品鉴' };

  function timelineOf(b) {
    if (BREW.Batch && typeof BREW.Batch.timelineSummary === 'function') {
      try { return BREW.Batch.timelineSummary(b); } catch (e) { UI.reportError(e, 'timelineSummary'); }
    }
    return { events: [], unrecorded: [], count: 0, byKind: {}, firstAt: null, lastAt: null, days: null };
  }

  /** 卡头右侧那句「共 N 天 · M 条记录」。
   *  起止取事件流首尾；跨度不足一天时按小时/分钟说，别硬写"共 0 天"——
   *  一锅当天出糖当天接种的酒，写 0 天是在撒谎。 */
  function spanSummary(tl) {
    var n = tl.count || 0;
    if (!n) return '0 条记录';
    if (n === 1 || !(tl.lastAt > tl.firstAt)) return '1 条记录 · 只有 1 个时刻';
    var ms = tl.lastAt - tl.firstAt;
    var span;
    if (ms < 3600000) span = '共 ' + Math.max(1, Math.round(ms / 60000)) + ' 分钟';
    else if (ms < 86400000) span = '共 ' + fmt(ms / 3600000, 1) + ' 小时';
    else {
      var d = ms / 86400000;
      span = '共 ' + (d >= 10 ? Math.round(d) : fmt(d, 1)) + ' 天';
    }
    return span + ' · ' + n + ' 条记录';
  }

  function hhmm(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function weekday(ts) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(ts).getDay()];
  }

  function timelineCard(b) {
    var tl = timelineOf(b);
    var events = tl.events || [];

    var head = '<div class="card__head"><h2>时间轴</h2><span class="spacer"></span>' +
      '<span class="u-xs u-dim">' + esc(spanSummary(tl)) + '</span>' +
      (events.length
        ? '<button type="button" class="btn btn-ghost btn-sm" data-act="export-md">' +
          icon('down', 12) + '导出 Markdown</button>'
        : '') +
      '</div>';

    if (!events.length) {
      return '<div class="card">' + head +
        '<div class="card__body">' +
          UI.emptyState('还没有可回看的记录',
            '记一条读数、在酿造日打一个勾、或推进一次状态，这条线就开始长了。' +
            '它和下面的读数列表不是一回事：这条线把四类事按真实发生时间排在一起。',
            { small: true, art: 'chart', size: 48 }) +
        '</div></div>';
    }

    var html = '<div class="ev-tl">';
    var lastDay = '';
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var day = UI.dt(e.at);
      if (day !== lastDay) {
        html += '<div class="ev-tl__day">' + esc(day) +
          '<span class="ev-tl__wd">' + esc(weekday(e.at)) + '</span></div>';
        lastDay = day;
      }
      html += '<div class="ev-tl__item ev-tl__item--' + attr(e.tone || 'muted') + '">' +
        '<span class="ev-tl__dot"></span>' +
        '<div class="ev-tl__head">' +
          '<span class="ev-tl__time">' + esc(hhmm(e.at)) + '</span>' +
          '<span class="ev-tl__kind">' + esc(EV_KIND_ZH[e.kind] || e.kind) + '</span>' +
          '<span class="ev-tl__title">' + esc(e.title) + '</span>' +
        '</div>' +
        (e.detail ? '<div class="ev-tl__detail">' + esc(e.detail) + '</div>' : '') +
        '</div>';
    }
    html += '</div>';

    /* 没记实际时刻的项：如实列在末尾，并说清为什么它们不在线上。
       这是这张卡最容易被"优化"掉的一段——一旦拿预定时刻补位，
       整条线就从"记录"变成了"计划"，再也没法用来复盘。 */
    var miss = tl.unrecorded || [];
    if (miss.length) {
      var shown = [];
      for (var m = 0; m < miss.length && m < 4; m++) {
        shown.push(miss[m].title + '（' + miss[m].reason + '）');
      }
      html += '<div class="ev-tl__miss">' +
        '另有 ' + miss.length + ' 项没有实际时刻，<b>没有</b>进这条线：' +
        esc(shown.join('；')) + (miss.length > 4 ? ' 等' : '') +
        '<span class="ev-tl__missnote">预定时刻不算实际发生——计划不是历史。</span>' +
        '</div>';
    }

    return '<div class="card">' + head + '<div class="card__body">' + html + '</div></div>';
  }

  /* ======================================================================
   * 我的坑（v1.4）：失败档案的聚合视图
   * ====================================================================*/

  function pitfallsCard(list) {
    var st = (BREW.Batch && typeof BREW.Batch.failureStats === 'function')
      ? BREW.Batch.failureStats(list)
      : { total: 0, typed: 0, untyped: 0, rows: [] };

    var head = '<div class="card__head"><h2>我的坑</h2><span class="spacer"></span>' +
      '<span class="u-xs u-dim">' + esc(st.total
        ? st.total + ' 次失败 · ' + st.rows.length + ' 类原因'
        : '还没有失败批次') + '</span></div>';

    if (!st.total) {
      /* v1.7：空态从 274px 的插画块压成一行 chip。
         它永远没有内容（除非真的失败过），却占到左列 1/4 的高度，
         把「批次列表」挤到了下面。文案保留原来那句判词，不写"暂无数据"。 */
      return '<div class="card">' + head +
        '<div class="card__body card__body--tight">' +
          '<p class="pit-empty">还没有失败批次，这是好事——真失败了，在那一批里记一句原因和下次怎么改。</p>' +
        '</div></div>';
    }

    var max = st.rows[0] ? st.rows[0].count : 1;
    var rows = '';
    for (var i = 0; i < st.rows.length; i++) {
      var r = st.rows[i];
      var pct = Math.max(10, Math.round(r.count / max * 100));
      rows += '<button type="button" class="pit" data-pit="' + attr(r.lastBatchId || '') + '">' +
        '<span class="pit__top">' +
          '<span class="pit__label">' + esc(r.label) + '</span>' +
          '<span class="pit__count">' + r.count + ' 次</span>' +
          '<span class="pit__bar"><i style="width:' + attr(pct) + '%"></i></span>' +
        '</span>' +
        '<span class="pit__learned' + (r.learned ? '' : ' is-empty') + '">' +
          esc(r.learned || '还没写下次怎么改') +
        '</span>' +
        '</button>';
    }

    var foot = '点一项进去看那一次的完整档案。';
    if (st.untyped) {
      foot += '其中 ' + st.untyped + ' 次还没分类——补上之后这份清单才数得清。';
    }

    return '<div class="card">' + head +
      '<div class="card__body card__body--tight"><div class="pit-list">' + rows + '</div></div>' +
      '<div class="card__hint">' + esc(foot) + '</div></div>';
  }

  /* ======================================================================
   * 失败档案卡（v1.4）
   * ----------------------------------------------------------------------
   * 只在 status === 'failed' 时出现。三个字段各有分工：
   *   type    → 可聚合，"我的坑"靠它计数；枚举值冻结在 35 的 Batch.FAILURE_TYPES
   *   note    → 当时看到什么（现象），半年后自己才看得懂的那种具体
   *   learned → 下次怎么改，允许空
   * ====================================================================*/

  function failureCard(b) {
    if (canon(b.status) !== 'failed') return '';

    var f = b.failure && typeof b.failure === 'object'
      ? withDefaults(b.failure, FAILURE_DEFAULTS)
      : withDefaults(null, FAILURE_DEFAULTS);

    var types = (BREW.Batch && Array.isArray(BREW.Batch.FAILURE_TYPES))
      ? BREW.Batch.FAILURE_TYPES : [];

    var opts = '<option value=""' + (f.type ? '' : ' selected') + '>还没分类</option>';
    var typeHint = '选一个最接近的，「我的坑」按它聚合。';
    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      opts += '<option value="' + attr(t.v) + '"' + (t.v === f.type ? ' selected' : '') + '>' +
        esc(t.zh) + '</option>';
      if (t.v === f.type && t.hint) typeHint = t.hint;
    }

    var hasAny = !!(f.type || f.note || f.learned);

    return '<div class="card card--fail">' +
      '<div class="card__head">' +
        '<h2>失败档案</h2>' +
        '<span class="badge badge--bad">失败</span>' +
        '<span class="spacer"></span>' +
        '<span class="u-xs u-dim">' + (hasAny ? '已记录 · 再改会自动覆盖' : '失焦即存 · 存在本机') + '</span>' +
      '</div>' +
      '<div class="card__body">' +
        '<div class="grid-2">' +
          '<div class="field">' +
            '<label class="field__label" for="fa-type">失败类型</label>' +
            '<select class="select" id="fa-type">' + opts + '</select>' +
            '<span class="field__hint">' + esc(typeHint) + '</span>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="fa-note">当时的现象 <span class="u-xs u-dim">' +
              String(f.note || '').length + '/200</span></label>' +
            '<textarea class="textarea" id="fa-note" maxlength="200" rows="3" ' +
              'placeholder="看到什么、闻到什么、第几天开始不对：第三天液面起白膜，凑近有酸味">' +
              esc(f.note || '') + '</textarea>' +
            '<span class="field__hint">只写你亲眼看到的。写具体，半年后才看得懂。</span>' +
          '</div>' +
        '</div>' +
        '<div class="field mt-12">' +
          '<label class="field__label" for="fa-learned">下次怎么改 <span class="u-xs u-dim">' +
            String(f.learned || '').length + '/200</span></label>' +
          '<textarea class="textarea" id="fa-learned" maxlength="200" rows="2" ' +
            'placeholder="一句能直接照做的动作：冷却盘管用沸水循环 10 分钟再下水；装瓶前测一次 FG">' +
            esc(f.learned || '') + '</textarea>' +
          '<span class="field__hint">可以空着——但空着的失败，下次大概率还会再犯一次。</span>' +
        '</div>' +
      '</div>' +
      '<div class="card__hint">' +
        '这张卡只在批次处于「失败」时出现。填完不用点保存：切走就会写进本机数据，' +
        '并在左侧「我的坑」里按类型累计。' +
      '</div>' +
      '</div>';
  }


  /* ======================================================================
   * 图表：优先用 BREW.Charts，缺失时用内置画布渲染
   * ====================================================================*/

  function drawChart(b) {
    var canvas = document.getElementById('ferm-chart');
    if (!canvas) return;
    chartCanvas = canvas;

    var pts = [];
    for (var i = 0; i < b.readings.length; i++) {
      var rd = b.readings[i];
      if (rd.sg !== null) pts.push({ x: new Date(rd.at), y: rd.sg });
    }
    var temps = [];
    for (var j = 0; j < b.readings.length; j++) {
      var r2 = b.readings[j];
      if (r2.tempC !== null) temps.push({ x: new Date(r2.at), y: r2.tempC });
    }

    var note = document.getElementById('chart-note');
    if (!pts.length && !temps.length) {
      if (note) note.textContent = '暂无数据';
      clearCanvas(canvas);
      return;
    }
    if (note) note.textContent = pts.length ? pts.length + ' 个数据点' : '';

    var series = [];
    if (pts.length) series.push({ name: '比重', points: pts, color: col('primary'), axis: 'y' });
    if (temps.length) series.push({ name: '温度', points: temps, color: col('blue'), axis: 'y2' });

    /* 外部引擎优先（接口契约见 48-ui-charts.js） */
    if (BREW.Charts && typeof BREW.Charts.line === 'function') {
      try {
        BREW.Charts.line(canvas, series, { yLabel: 'SG', y2Label: '°C' });
        return;
      } catch (e) {
        UI.reportError(e, 'charts.line');
      }
    }
    fallbackLine(canvas, series);
  }

  function clearCanvas(canvas) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    sizeCanvas(canvas, ctx);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function sizeCanvas(canvas, ctx) {
    var dpr = root.devicePixelRatio || 1;
    var w = canvas.clientWidth || canvas.parentNode.clientWidth || 400;
    var h = canvas.clientHeight || 200;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h };
  }

  /** 内置折线渲染：网格 + 双轴 + 折线 + 数据点 */
  function fallbackLine(canvas, series) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    var box = sizeCanvas(canvas, ctx);
    var W = box.w, H = box.h;
    ctx.clearRect(0, 0, W, H);

    var padL = 44, padR = series.length > 1 ? 40 : 14, padT = 12, padB = 26;
    var plotW = Math.max(10, W - padL - padR);
    var plotH = Math.max(10, H - padT - padB);

    /* 时间范围 */
    var tMin = Infinity, tMax = -Infinity;
    for (var i = 0; i < series.length; i++) {
      for (var j = 0; j < series[i].points.length; j++) {
        var t = series[i].points[j].x.getTime();
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      }
    }
    if (!isFinite(tMin)) return;
    if (tMin === tMax) { tMin -= 43200000; tMax += 43200000; }

    /* 网格与左轴 */
    ctx.strokeStyle = col('grid');
    ctx.lineWidth = 1;
    ctx.font = '12px "Times New Roman", Times, "SF Mono", Consolas, monospace';
    ctx.fillStyle = col('text');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    var s0 = series[0];
    var y0Min = Infinity, y0Max = -Infinity;
    for (var k = 0; k < s0.points.length; k++) {
      var yv = s0.points[k].y;
      if (yv < y0Min) y0Min = yv;
      if (yv > y0Max) y0Max = yv;
    }
    if (!isFinite(y0Min)) { y0Min = 1; y0Max = 1.1; }
    var span0 = Math.max(0.004, y0Max - y0Min);
    y0Min -= span0 * 0.18;
    y0Max += span0 * 0.18;

    for (var g = 0; g <= 4; g++) {
      var gy = padT + plotH * (g / 4);
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + plotW, gy);
      ctx.stroke();
      var val = y0Max - (y0Max - y0Min) * (g / 4);
      ctx.fillText(val.toFixed(3), padL - 7, gy);
    }

    /* 右轴（第二条序列） */
    if (series.length > 1) {
      var s1 = series[1];
      var y1Min = Infinity, y1Max = -Infinity;
      for (var m = 0; m < s1.points.length; m++) {
        var yv1 = s1.points[m].y;
        if (yv1 < y1Min) y1Min = yv1;
        if (yv1 > y1Max) y1Max = yv1;
      }
      if (!isFinite(y1Min)) { y1Min = 15; y1Max = 25; }
      var span1 = Math.max(1, y1Max - y1Min);
      y1Min -= span1 * 0.15;
      y1Max += span1 * 0.15;
      ctx.textAlign = 'left';
      ctx.fillStyle = col('blue');   /* 跟着第二条序列（温度）走 */
      for (var g2 = 0; g2 <= 4; g2++) {
        var gy2 = padT + plotH * (g2 / 4);
        var v2 = y1Max - (y1Max - y1Min) * (g2 / 4);
        ctx.fillText(v2.toFixed(0) + '°', padL + plotW + 6, gy2);
      }
      s1._min = y1Min; s1._max = y1Max;
    }

    /* 折线与填充 */
    for (var si = 0; si < series.length; si++) {
      var ser = series[si];
      var lo = si === 0 ? y0Min : ser._min;
      var hi = si === 0 ? y0Max : ser._max;
      var pts = ser.points.slice().sort(function (a, b) { return a.x - b.x; });

      function X(t) { return padL + (t - tMin) / (tMax - tMin) * plotW; }
      function Y(v) { return padT + plotH - (v - lo) / Math.max(0.0001, hi - lo) * plotH; }

      if (si === 0) {
        var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, hexA(col('primary'), 0.20));
        grad.addColorStop(1, hexA(col('primary'), 0));
        ctx.beginPath();
        ctx.moveTo(X(pts[0].x.getTime()), padT + plotH);
        for (var p1 = 0; p1 < pts.length; p1++) ctx.lineTo(X(pts[p1].x.getTime()), Y(pts[p1].y));
        ctx.lineTo(X(pts[pts.length - 1].x.getTime()), padT + plotH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.beginPath();
      for (var p2 = 0; p2 < pts.length; p2++) {
        var px = X(pts[p2].x.getTime()), py = Y(pts[p2].y);
        if (p2 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = ser.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      for (var p3 = 0; p3 < pts.length; p3++) {
        var dx = X(pts[p3].x.getTime()), dy = Y(pts[p3].y);
        ctx.beginPath();
        ctx.arc(dx, dy, 3, 0, Math.PI * 2);
        ctx.fillStyle = col('paper');
        ctx.fill();
        ctx.strokeStyle = ser.color;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
    }

    /* 时间轴标签 */
    ctx.fillStyle = col('text');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var mid = (tMin + tMax) / 2;
    var labels = [tMin, mid, tMax];
    for (var L = 0; L < labels.length; L++) {
      var d = new Date(labels[L]);
      var txt = (d.getMonth() + 1) + '/' + d.getDate();
      var lx = padL + (labels[L] - tMin) / (tMax - tMin) * plotW;
      ctx.fillText(txt, Math.min(padL + plotW - 12, Math.max(padL + 12, lx)), padT + plotH + 8);
    }
  }

  var resizeBound = false;
  function bindChartResize() {
    if (resizeBound) return;
    resizeBound = true;
    root.addEventListener('resize', fnChartRedraw());
  }

  /** 重画当前批次：window.resize 与 ResizeObserver 共用**同一个**去抖实例。
   *  两个监听器各建一份去抖的话，拖窗口时 window.resize 与容器 resize 会同时命中，
   *  150ms 后连画两次（幂等但白费）。懒建一次，后面都取同一份。 */
  var chartRedrawFn = null;
  function fnChartRedraw() {
    if (!chartRedrawFn) {
      chartRedrawFn = UI.debounce(function () {
        if (!activeId) return;
        var list = UI.store.batches().map(normalizeBatch);
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === activeId) { drawChart(list[i]); return; }
        }
      }, 150);
    }
    return chartRedrawFn;
  }

  /* 曲线容器的尺寸变化（v1.7）。
     原来只有 window.resize 一个触发点，而 `drawChart` 是靠 `#ferm-chart` 的
     clientWidth 定画布宽度的：容器自己变宽/变窄（切换分辨率预设、右栏出现或
     消失、1500 断点上下、用户拖左面板）**不会触发 window.resize**，
     画布就按旧宽度拉伸，线被压扁或拉长。
     这次批次页改成三栏，容器宽度第一次不再等于"窗口宽度减常数"，
     所以必须补上；监听的是画布的父节点（.chart-frame），不是画布本身——
     画布尺寸是自己写的，监听它会自激。
     回调与 window.resize 共用 150ms 去抖，拖窗口时不会每帧重绘。 */
  var chartRO = null;
  function observeChartBox() {
    if (!root.ResizeObserver) return;          /* 老浏览器：退回 window.resize 一条路 */
    var canvas = document.getElementById('ferm-chart');
    if (!canvas) return;
    var box = canvas.parentNode || canvas;
    if (chartRO) { try { chartRO.disconnect(); } catch (e) { /* ignore */ } chartRO = null; }
    chartRO = new root.ResizeObserver(fnChartRedraw());
    chartRO.observe(box);
  }

  /* ======================================================================
   * 交互
   * ====================================================================*/

  function bind(el) {
    if (el.__batchBound) return;
    el.__batchBound = true;

    el.addEventListener('click', function (e) {
      var t = e.target;

      var batchBtn = t.closest ? t.closest('[data-batch]') : null;
      if (batchBtn) {
        activeId = batchBtn.getAttribute('data-batch');
        render(host);
        return;
      }

      var statBtn = t.closest ? t.closest('[data-status]') : null;
      if (statBtn) {
        setStatus(statBtn.getAttribute('data-status'));
        return;
      }

      var delRd = t.closest ? t.closest('[data-del-reading]') : null;
      if (delRd) {
        delReading(delRd.getAttribute('data-del-reading'));
        return;
      }

      /* 「我的坑」的一项 = 那一类最近一次的失败批次，点进去看完整档案 */
      var pitBtn = t.closest ? t.closest('[data-pit]') : null;
      if (pitBtn) {
        var pid = pitBtn.getAttribute('data-pit');
        if (pid) { activeId = pid; render(host); }
        return;
      }

      /* 「去填写 →」：滚到真正能写的那张卡，并把光标放进对应的框。
         格子只读是**故意**的（见 figLink 的注释），所以这里不改成可编辑。 */
      var goBtn = t.closest ? t.closest('[data-goto]') : null;
      if (goBtn) {
        goToCard(goBtn.getAttribute('data-goto'), goBtn.getAttribute('data-goto-focus'));
        return;
      }

      var actBtn = t.closest ? t.closest('[data-act]') : null;
      if (!actBtn) return;
      var act = actBtn.getAttribute('data-act');
      if (act === 'new-batch') newBatchDialog();
      else if (act === 'add-reading') addReading();
      else if (act === 'del-batch') delBatch();
      else if (act === 'rename') renameBatch();
      else if (act === 'load-recipe') loadSnapshotIntoEditor();
      else if (act === 'export-csv') exportCSV();
      else if (act === 'export-md') exportMarkdown();
      else if (act === 'use-priming') usePriming();
      else if (act === 'start-brew') startBrewday();
      else if (act === 'to-tasting') toTasting();
    });

    /* 酿造实测 / 装瓶 / 成本 / 失败档案：改值即存。用 change 而不是 input——
       input 会在每敲一个字符时重画整页，输入框会被打回上一次的值。
       textarea 的 change 天然只在失焦时触发，正好是"失焦即存"。 */
    el.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.id) return;
      if (t.id === 'bd-date') { writeBrewDate(t); return; }
      if (t.id.indexOf('ac-') === 0) { writeActual(t); return; }
      if (t.id.indexOf('pk-') === 0) { writePackaging(t); return; }
      if (t.id.indexOf('co-') === 0) { writeCost(t); return; }
      if (t.id.indexOf('fa-') === 0) { writeFailure(t); return; }
    });

    /* 失败档案的字数：只更新计数，不落盘（落盘交给上面的 change） */
    el.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || (t.id !== 'fa-note' && t.id !== 'fa-learned')) return;
      var box = t.parentNode ? t.parentNode.querySelector('.field__label .u-xs') : null;
      if (box) box.textContent = String(t.value || '').length + '/200';
    });

    /* Enter 直接提交读数（备注框内例外）。
       酿造实测的输入框也必须排除，否则在那儿按回车会凭空多出一条读数。 */
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var t = e.target;
      if (!t || t.tagName !== 'INPUT') return;
      if (t.id === 'r-note' || t.id === 'r-at') return;
      if (t.id.indexOf('ac-') === 0) return;
      e.preventDefault();
      addReading();
    });
  }

  function currentBatch() {
    var list = UI.store.batches().map(normalizeBatch);
    for (var i = 0; i < list.length; i++) if (list[i].id === activeId) return list[i];
    return null;
  }

  function persist(b) {
    b.updatedAt = Date.now();
    UI.store.saveBatch(b);
  }

  /* ------------------------------------------------------- 跨卡跳转（v1.7）
   * 「去填写 →」只做两件事：把目标卡拉进视野、把光标放进那个框。
   * 为什么不用 Shell.go：两张卡都在同一个视图里，换视图等于把用户
   * 刚看的上下文（这一批的记录）全丢掉。
   * 为什么滚完还要等 320ms 再 focus：`.view` 是 scroll-behavior:smooth，
   * 立刻 focus 会打断正在跑的平滑滚动（焦点一动浏览器就把滚动目标改成"让焦点可见"）。 */
  function goToCard(card, focusId) {
    var c = document.querySelector('#batch-detail [data-card="' + card + '"]');
    if (c && c.scrollIntoView) {
      try { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      catch (e) { c.scrollIntoView(); }
    }
    if (!focusId) return;
    root.setTimeout(function () {
      var el = document.getElementById(focusId);
      if (!el || typeof el.focus !== 'function') return;
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }, 320);
  }

  /* --------------------------------------------------- 酿造日期（v1.7）
   * 只写 brewDate。**不动 createdAt / statusHistory**：
   * 37 的 dateOf() 用 brewDate 优先，改它就是改分析页的年份归属；
   * createdAt 是"这条记录什么时候进的库"，两者是不同的事实。 */
  function writeBrewDate(el) {
    var b = currentBatch();
    if (!b) return;
    var v = String(el.value || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) v = '';
    if ((b.brewDate || '') === v) return;
    b.brewDate = v;
    persist(b);
    renderAndRestoreFocus('bd-date');
    UI.Shell.toast(v ? '酿造日期改为 ' + v + '（分析页按它分年）' : '酿造日期已清空，分析页改用建批时间', 'ok', 2600);
  }

  /* ------------------------------------------------- 两个跨视图入口（v1.7）
   * docs/00 写着批次头卡"挂了品鉴卡与开始酿造日入口"，实际一个都没有。
   * 45 / 59 各有一个 `focus(batchId)`（v1.7 新增）：它只改"这个视图看哪一批"，
   * 不改计时、不写分数、不落盘。这里先 focus 再 go ——
   * 先把状态放好，视图渲染时自然就落在这一批上。
   *
   * 为什么不沿用"改 #bd-batch 下拉 + 派发 change"那条路：
   * 那条路要轮询等视图渲染完（最长 2.5s），而轮询期间用户如果切了批次，
   * 回调会把他的选择抢回旧值。有正常入口就不要用 DOM 顶替。 */
  function openWithBatch(viewId, viewObj, batchId) {
    if (viewObj && typeof viewObj.focus === 'function') viewObj.focus(batchId);
    UI.Shell.go(viewId);
  }

  function startBrewday() {
    var b = currentBatch();
    if (!b) return;
    openWithBatch('brewday', UI.BrewdayView, b.id);
    UI.Shell.toast('已切到酿造日：这一步按分钟推进，到点会响一声', 'ok', 3000);
  }

  function toTasting() {
    var b = currentBatch();
    if (!b) return;
    openWithBatch('tasting', UI.TastingView, b.id);
  }

  /* ------------------------------------------------------------ 酿造实测 */
  function writeActual(el) {
    var b = currentBatch();
    if (!b) return;
    if (!b.actual) b.actual = withDefaults(null, ACTUAL_DEFAULTS);

    if (el.id === 'ac-notes') {
      b.actual.notes = String(el.value || '').trim();
      persist(b);
      return;
    }

    var field = null;
    for (var i = 0; i < ACTUAL_FIELDS.length; i++) {
      if (ACTUAL_FIELDS[i].id === el.id) { field = ACTUAL_FIELDS[i]; break; }
    }
    if (!field) return;

    /* 空串存 null，不要存 0：0 在业务上是一个合法测量值，跟"没测"必须区分开 */
    var raw = String(el.value || '').trim();
    var v = raw === '' ? null : num(raw, null);
    if (v !== null && !isFinite(v)) v = null;
    b.actual[field.key] = v;

    /* 实际效率：填了麦芽总重 + 实际 OG 就自动回填（只填空值） */
    autoEfficiency(b);

    persist(b);
    render(host);

    if (field.key === 'efficiency' && b.actual.efficiency !== null) {
      UI.Shell.toast('实际效率按实测 OG / 麦芽总重回填为 ' + fmt(b.actual.efficiency, 1) + '%', 'ok', 2400);
    }
  }

  /* ------------------------------------------------------------ CSV 导出 */
  function exportCSV() {
    var b = currentBatch();
    if (!b) return;
    if (!b.readings.length) { UI.Shell.toast('还没有读数可导出', 'warn'); return; }

    var csv = '';
    try {
      csv = (BREW.Batch && typeof BREW.Batch.readingsToCSV === 'function')
        ? BREW.Batch.readingsToCSV(b)
        : localCSV(b);
    } catch (e) {
      UI.reportError(e, 'readingsToCSV');
      csv = localCSV(b);
    }

    /* 带 BOM，Excel 打开中文表头才不会乱码 */
    var text = '\ufeff' + csv;
    var stamp = UI.today ? String(UI.today()).replace(/-/g, '') : 'export';
    var safe = String(b.name || 'batch').replace(/[\\/:*?"<>|]/g, '-').slice(0, 40);
    var filename = safe + '-readings-' + stamp + '.csv';

    try {
      if (!root.Blob || !root.URL || !root.URL.createObjectURL) throw new Error('no-blob');
      var blob = new root.Blob([text], { type: 'text/csv;charset=utf-8' });
      var url = root.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      root.setTimeout(function () {
        try { root.URL.revokeObjectURL(url); } catch (e2) { /* ignore */ }
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 200);
      UI.Shell.toast('已导出 ' + filename + '（' + b.readings.length + ' 条）', 'ok');
    } catch (e3) {
      /* file:// 下个别浏览器禁下载，退回"复制文本" */
      UI.Shell.modal({
        title: '导出 CSV',
        sub: '当前浏览器不支持直接下载，请手动复制',
        size: 'wide',
        body: '<p class="u-sm u-muted" style="margin-bottom:8px">用记事本存成 .csv 即可。</p>' +
          '<textarea class="input" readonly rows="12" style="width:100%;font-family:var(--mono);font-size:12.5px">' +
          esc(text) + '</textarea>',
        actions: [{ label: '关闭', kind: 'ghost' }]
      });
    }
  }

  /* ---------------------------------------------------------- Markdown 导出
   * 导的是「时间轴」那张卡（四类事件合流），不是读数 CSV——
   * 读数 CSV 已经有了，这条 .md 是给"回头看这一锅怎么回事"用的。
   * 文本由 35 的 Batch.timelineToMarkdown 生成：数据层管内容，界面层管下载。 */
  function exportMarkdown() {
    var b = currentBatch();
    if (!b) return;

    var md = '';
    try {
      if (BREW.Batch && typeof BREW.Batch.timelineToMarkdown === 'function') {
        md = BREW.Batch.timelineToMarkdown(b);
      }
    } catch (e) { UI.reportError(e, 'timelineToMarkdown'); }

    if (!md) {
      UI.Shell.toast('这条时间轴还没有内容可导出', 'warn');
      return;
    }

    var stamp = UI.today ? String(UI.today()).replace(/-/g, '') : 'export';
    var safe = String(b.name || 'batch').replace(/[\\/:*?"<>|]/g, '-').slice(0, 40);
    var filename = safe + '-timeline-' + stamp + '.md';

    if (downloadText(filename, md)) {
      UI.Shell.toast('已导出 ' + filename, 'ok');
      return;
    }

    /* file:// 下个别浏览器禁下载，退回"复制文本"（与 CSV 导出同一套兜底） */
    UI.Shell.modal({
      title: '导出 Markdown',
      sub: '当前浏览器不支持直接下载，请手动复制',
      size: 'wide',
      body: '<p class="u-sm u-muted" style="margin-bottom:8px">用记事本存成 .md 即可。</p>' +
        '<textarea class="input" readonly rows="14" style="width:100%;font-family:var(--mono);font-size:12.5px">' +
        esc(md) + '</textarea>',
      actions: [{ label: '关闭', kind: 'ghost' }]
    });
  }

  /** Blob 下载。写法与 43-ui-diff.js 的 download() 一致：
   *  先 append 到 body 再 click（部分浏览器对游离节点的 click 不生效），
   *  200ms 后回收 URL，避免 file:// 下堆积 blob 句柄。 */
  function downloadText(filename, text) {
    try {
      if (!root.Blob || !root.URL || !root.URL.createObjectURL) throw new Error('no-blob');
      var blob = new root.Blob([text], { type: 'text/markdown;charset=utf-8' });
      var url = root.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      root.setTimeout(function () {
        try { root.URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 200);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 引擎缺失时的兜底：字段与 Batch.readingsToCSV 保持一致 */
  function localCSV(b) {
    var rows = [['时间', '阶段', '比重', '原始读数', '样品温度', '发酵温度', 'pH', '备注']];
    for (var i = 0; i < b.readings.length; i++) {
      var r = b.readings[i];
      rows.push([
        new Date(r.at).toLocaleString('zh-CN'),
        r.stage || '',
        r.sg === null || r.sg === undefined ? '' : r.sg,
        r.sgRaw === null || r.sgRaw === undefined ? (r.sg === null || r.sg === undefined ? '' : r.sg) : r.sgRaw,
        r.sampleTemp === null || r.sampleTemp === undefined ? (r.tempC === null || r.tempC === undefined ? '' : r.tempC) : r.sampleTemp,
        r.tempC === null || r.tempC === undefined ? '' : r.tempC,
        r.ph === null || r.ph === undefined ? '' : r.ph,
        String(r.note || '').replace(/"/g, '""')
      ]);
    }
    return rows.map(function (row) {
      return row.map(function (cell) {
        var s = String(cell === undefined || cell === null ? '' : cell);
        return /[",\n]/.test(s) ? '"' + s + '"' : s;
      }).join(',');
    }).join('\n');
  }

  function setStatus(v) {
    var b = currentBatch();
    if (!b) return;
    v = canon(v);
    var changed = canon(b.status) !== v;
    b.status = v;

    /* 状态流转要落进 statusHistory：Batch.stageDurations() 完全依赖它，
       而这个字段此前一直是建批时那一条，改状态也不增长（等于空转）。
       normalizeBatch 现在会保留它，这里负责把它写起来。 */
    if (changed) {
      b.statusHistory = Array.isArray(b.statusHistory) ? b.statusHistory : [];
      var last = b.statusHistory[b.statusHistory.length - 1];
      if (!last || last.status !== v) b.statusHistory.push({ status: v, at: Date.now() });
    }

    /* 进入发酵状态时自动补一条起点读数，避免曲线空白 */
    if (v === 'ferment' && !b.readings.length) {
      b.readings.push({
        id: UI.uid('rd'), at: new Date().toISOString(), stage: '接种',
        sg: null, tempC: null, ph: null, note: '进入发酵阶段'
      });
    }
    persist(b);
    render(host);
    UI.Shell.toast('批次状态：' + statusOf(v).t, 'ok', 1600);
  }

  function addReading() {
    var b = currentBatch();
    if (!b) return;
    var atEl = document.getElementById('r-at');
    var stageEl = document.getElementById('r-stage');
    var sgEl = document.getElementById('r-sg');
    var tempEl = document.getElementById('r-temp');
    var phEl = document.getElementById('r-ph');
    var noteEl = document.getElementById('r-note');

    var sg = sgEl && sgEl.value !== '' ? num(sgEl.value, NaN) : null;
    var temp = tempEl && tempEl.value !== '' ? num(tempEl.value, NaN) : null;
    var ph = phEl && phEl.value !== '' ? num(phEl.value, NaN) : null;

    if ((sg === null || !isFinite(sg)) && (temp === null || !isFinite(temp)) &&
      (ph === null || !isFinite(ph)) && !(noteEl && noteEl.value.trim())) {
      UI.Shell.toast('至少填一个数值或写点备注', 'warn');
      if (sgEl) sgEl.focus();
      return;
    }
    if (sg !== null && isFinite(sg) && (sg < 0.9 || sg > 1.3)) {
      UI.Shell.toast('比重 ' + UI.sg(sg) + ' 看起来不太对，请再确认', 'warn');
      return;
    }

    var at = atEl && atEl.value ? new Date(atEl.value).toISOString() : new Date().toISOString();
    b.readings.push({
      id: UI.uid('rd'),
      at: at,
      stage: stageEl ? stageEl.value : '发酵',
      sg: (sg !== null && isFinite(sg)) ? sg : null,
      tempC: (temp !== null && isFinite(temp)) ? temp : null,
      ph: (ph !== null && isFinite(ph)) ? ph : null,
      note: noteEl ? noteEl.value.trim() : ''
    });
    b.readings.sort(function (a, b2) { return new Date(a.at) - new Date(b2.at); });

    /* 有实测 OG 后自动推进状态 */
    if (canon(b.status) === 'plan' || canon(b.status) === 'mash') b.status = 'ferment';

    persist(b);
    render(host);
    UI.Shell.toast('已记录', 'ok', 1500);
  }

  function delReading(id) {
    var b = currentBatch();
    if (!b) return;
    var left = [];
    for (var i = 0; i < b.readings.length; i++) if (b.readings[i].id !== id) left.push(b.readings[i]);
    b.readings = left;
    persist(b);
    render(host);
  }

  function delBatch() {
    var b = currentBatch();
    if (!b) return;
    UI.Shell.confirm({
      title: '删除这个批次？',
      message: '《' + b.name + '》的 ' + b.readings.length + ' 条记录将一并删除。',
      danger: true, okLabel: '删除'
    }, function () {
      UI.store.removeBatch(b.id);
      activeId = '';
      render(host);
      UI.Shell.toast('已删除批次', 'ok');
    });
  }

  function renameBatch() {
    var b = currentBatch();
    if (!b) return;
    UI.Shell.modal({
      title: '重命名批次',
      size: 'narrow',
      body: '<div class="field"><label class="field__label" for="b-name">批次名称</label>' +
        '<input class="input" id="b-name" type="text" value="' + attr(b.name) + '"></div>',
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '保存', kind: 'primary',
          act: function (api) {
            var el = api.query('#b-name');
            var v = el ? el.value.trim() : '';
            if (!v) return false;
            b.name = v;
            persist(b);
            render(host);
          }
        }
      ]
    });
  }

  function loadSnapshotIntoEditor() {
    var b = currentBatch();
    if (!b || !b.recipeSnapshot) return;
    UI.Shell.confirm({
      title: '用这份快照覆盖当前编辑器？',
      message: '当前编辑器里的未保存修改会丢失。快照是批次创建时的配方状态。'
    }, function () {
      UI.setRecipe(UI.clone(b.recipeSnapshot));
      UI.Shell.go('recipe');
      UI.Shell.toast('已载入快照到编辑器', 'ok');
    });
  }

  /* ------------------------------------------------------------ 新建批次
   * 这里多做一件事：选完"基于哪个配方"之后，如果这个配方历史上失败过，
   * 就把最近两次的失败档案顶到对话框里。
   * 为什么放在这里而不是酿造日看板：新建批次是**唯一**会重犯同一个错误的时刻——
   * 配方没变、设备没变、心气也没变。真开酿了再提醒已经晚了。
   * 只读：数据来自 batch.failure（failureOf / failedAt），不新增任何字段。 */
  function recipeFailedList(recipeId) {
    if (!recipeId || !BREW.Batch || typeof BREW.Batch.failureOf !== 'function') return [];
    var list = UI.store.batches() || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      /* 只认"配方 id 相同 + 状态确实是失败"的批次。同名不同配方不算——
         名字是用户随手起的，id 才是身份。 */
      if (!b || b.recipeId !== recipeId) continue;
      if (canon(b.status) !== 'failed') continue;
      var f = BREW.Batch.failureOf(b);
      out.push({
        at: (typeof BREW.Batch.failedAt === 'function')
          ? num(BREW.Batch.failedAt(b), 0) : num(b.updatedAt, 0),
        type: (f && f.typeLabel) || '',
        learned: (f && f.learned) || '',
        name: b.name || ''
      });
    }
    /* 时间倒序：最近一次排最前。时间相同就保持入库顺序（稳定排序） */
    out.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
    return out;
  }

  /** 一条失败记录 → 一句话。
   *  类型没记就直说"没记类型"，不拿"其他"顶替；learned 没写就直说没写——
   *  这两句都是真话，而且正好提示用户回去补。 */
  function failLineText(rec) {
    var head = rec.type ? '栽在「' + rec.type + '」' : '失败（没记类型）';
    return head + '：' + (rec.learned || '还没写下次怎么改');
  }

  function failHintHtml(recipeId) {
    var list = recipeFailedList(recipeId);
    /* 没有失败历史 → 返回空串，整块不出现。
       写"暂无记录"是纯噪音：用户在新建批次，不是在查档案。 */
    if (!list.length) return '';

    var n = list.length;
    var title, body = '', more = '';

    if (n === 1) {
      /* 只有一次：一行说完，最接近用户嘴里的说法 */
      title = '这配方上次' + esc(failLineText(list[0]));
    } else {
      title = '这配方失败过 ' + n + ' 次，最近两次：';
      var rows = '';
      for (var i = 0; i < 2 && i < n; i++) {
        rows += '<li>' + esc(failLineText(list[i])) + '</li>';
      }
      body = '<ul class="fail-hint__list">' + rows + '</ul>';
      if (n > 2) {
        more = '<button type="button" class="fail-hint__more" data-fail-more>' +
          '还有 ' + (n - 2) + ' 条，见批次列表 ›</button>';
      }
    }

    return '<div class="fail-hint__title">' + title + '</div>' + body + more;
  }

  function newBatchDialog() {
    var recipes = UI.store.recipes();
    var cur = UI.recipe();
    var hasUnsaved = true;
    for (var i = 0; i < recipes.length; i++) if (recipes[i].id === cur.id) hasUnsaved = false;

    var opts = '';
    if (hasUnsaved) {
      opts += '<option value="__current">当前编辑器内容 · ' + esc(cur.name) + '（未保存）</option>';
    }
    for (var j = 0; j < recipes.length; j++) {
      opts += '<option value="' + attr(recipes[j].id) + '">' + esc(recipes[j].name || '未命名') + '</option>';
    }
    if (!hasUnsaved && !recipes.length) {
      opts = '<option value="__current">当前编辑器内容 · ' + esc(cur.name) + '</option>';
    }
    if (!opts) opts = '<option value="__current">当前编辑器内容</option>';

    var list = UI.store.batches().map(normalizeBatch);
    var seq = 1;
    for (var k = 0; k < list.length; k++) if (list[k].recipeId === cur.id) seq++;
    var defaultName = cur.name + ' · 第 ' + seq + ' 批';

    UI.Shell.modal({
      title: '新建酿造批次',
      sub: '会保存一份配方快照',
      body:
        '<div class="grid-2">' +
          '<div class="field"><label class="field__label" for="nb-recipe">基于哪个配方</label>' +
            '<select class="select" id="nb-recipe">' + opts + '</select></div>' +
          '<div class="field"><label class="field__label" for="nb-name">批次名称</label>' +
            '<input class="input" id="nb-name" type="text" value="' + attr(defaultName) + '"></div>' +
          '<div class="field"><label class="field__label" for="nb-vol">实际批次量</label>' +
            UI.fldWrap('nb-vol', fmt(num(cur.batchSize, 20), 1), 'L', { step: '0.5', min: 1, max: 200 }) + '</div>' +
          '<div class="field"><label class="field__label" for="nb-status">起始状态</label>' +
            '<select class="select" id="nb-status">' +
              STATUS.slice(0, 4).map(function (s) {
                return '<option value="' + s.v + '"' + (s.v === 'plan' ? ' selected' : '') + '>' + esc(s.t) + '</option>';
              }).join('') + '</select></div>' +
        '</div>' +
        /* 历史失败提示：内容由 failHintHtml 决定，没有就整块隐藏（hidden 属性） */
        '<div class="fail-hint" id="nb-failhint" hidden></div>' +
        '<p class="u-xs u-dim mt-12">快照的意义：以后改配方不会污染历史记录，回头才能解释"这批为什么不一样"。</p>',
      onMount: function (api) {
        var sel = api.query('#nb-recipe');
        var box = api.query('#nb-failhint');
        if (!sel || !box) return;

        function sync() {
          /* __current = 编辑器里那份（可能还没保存）。它没有 id 就查不到历史，
             自然也不显示提示——不猜、不拿同名配方顶替。 */
          var rid = (sel.value === '__current') ? (UI.recipe() || {}).id : sel.value;
          var html = failHintHtml(rid);
          box.innerHTML = html;
          box.hidden = !html;
        }

        sel.addEventListener('change', sync);
        box.addEventListener('click', function (e) {
          var more = e.target.closest ? e.target.closest('[data-fail-more]') : null;
          if (!more) return;
          /* 「见批次列表」= 关掉这个弹窗。弹窗本来就从批次页打开，
             关掉就回到列表，不需要额外导航。 */
          api.close();
        });
        sync();
      },
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '创建批次', kind: 'primary',
          act: function (api) {
            var recSel = api.query('#nb-recipe');
            var src = null;
            if (recSel && recSel.value === '__current') src = UI.recipe();
            else if (recSel) {
              for (var m = 0; m < recipes.length; m++) if (recipes[m].id === recSel.value) src = recipes[m];
            }
            if (!src) src = UI.recipe();

            /* 传整份配方，让 Batch.blank 自己算快照（它要 calcRecipe(recipe)） */
            var b = blankBatch(src);
            b.name = (api.query('#nb-name') ? api.query('#nb-name').value.trim() : '') || defaultName;
            b.volume = num(api.query('#nb-vol') ? api.query('#nb-vol').value : src.batchSize, 20);
            b.status = canon(api.query('#nb-status') ? api.query('#nb-status').value : 'plan');
            b.statusHistory = [{ status: b.status, at: Date.now() }];
            b.brewDate = UI.today ? UI.today() : b.brewDate;
            b.createdAt = Date.now();
            b.updatedAt = Date.now();

            UI.store.saveBatch(b);
            activeId = b.id;
            render(host);
            UI.Shell.toast('已创建批次《' + b.name + '》', 'ok');
          }
        }
      ]
    });
  }

  /* ======================================================================
   * 视图定义
   * ====================================================================*/

  BREW.UI.BatchView = {
    id: 'batch',
    label: '酿造记录',
    icon: 'record',
    group: '记录',
    order: 3,
    render: render,
    onEnter: function () {
      if (host) render(host);
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
