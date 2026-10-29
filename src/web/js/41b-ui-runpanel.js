/* ============================================================================
 * 风月酿研所 — 41b-ui-runpanel.js
 * ----------------------------------------------------------------------------
 * 职责：「运行 / 下一步 / 重置」三个动作 + 控制面板 + 可粘贴给别的 AI 的体检报告。
 *
 * ============================================================================
 * 一、为什么"运行"不是"算一次"
 * ----------------------------------------------------------------------------
 * 这个软件的配方页是**即时计算**的：敲一个数字就重算，指标格跟着跳。
 * 再造一个"点一下才算"的动作是假的——用户点了也看不出一件事发生。
 *
 * 所以这里的「运行」跑的是**检查清单**，不是计算：
 *   把本来散在四个地方、各自只知道自己那一块的红字汇总成一份有序结果：
 *     · 输入值范围      BREW.FieldRules（39a，全站唯一一份区间表）
 *     · 风格偏差        Calc.styleMatch.deviations（由 UI.calc 归一后的形状）
 *     · 配方可行性告警  Calc.warnings（20-calc，含用量审计合流）
 *     · 库存够不够      UI.InventoryPanel.check（47 → 33 的余额口径）
 *     · 发酵停滞         Batch.analyze().stalled（35，46 页也是读它）
 *     · 装瓶量 vs 入罐量 FieldRules.relation('pkgVsBatch')（39a）
 *   每一项都**只复述既有判定**，不在这里重写一遍化学/平衡/区间逻辑；
 *   只有一处是本面板自己的分级规则（见 §三），写在明处。
 *
 * ============================================================================
 * 二、为什么"下一步"是推荐序列，不是流程锁
 * ----------------------------------------------------------------------------
 * Aspen Plus 有严格输入依赖顺序（先组分、再物性、再单元操作），所以它的
 * 「下一步」能做成"没完成第 1 步就别去第 2 步"。
 * 这个软件没有那种依赖：用户可以填完酵母再回来填麦芽，也可以先存一份半成品。
 * 把"必须按顺序"套上来，等于用更低的自由度换一个更好看的引导条——
 * 用户会撞到一堵莫名其妙的墙。
 *
 * 所以这里给的是**"当前最该做的三件事"**：依据真实状态排序（有错误 → 缺风格 →
 * 缺麦芽 → 缺酵母 → 偏差最大的一项 → 有未保存修改 → 缺料 → 停滞），
 * 每条都能一键跳过去，也可以手动打勾。推荐项随状态消失，不做假进度条。
 *
 * ============================================================================
 * 三、报告的分级规则（本文件唯一自定的判断）
 * ----------------------------------------------------------------------------
 * 错误 / 警告 / 建议三档，来源各自的 level 直接映射：
 *   FieldRules hard（物理不可能） → 错误；soft（可能但异常） → 警告
 *   Calc.warnings error/warn/info  → 错误/警告/建议
 *   FieldRules.relation hard/soft  → 错误/警告
 *   风格偏差：偏离**超过一个区间宽度** → 错误，否则警告。
 *     理由：风格区间宽 30 IBU 时，你在 71 IBU 是"偏苦"，在 213 IBU 不是
 *     "更偏苦"，是这锅酒不是这个风格（或者某一项填错了一位数）。
 *     一个区间宽度是"还能靠微调救回来"和"得回头改方向"的分界。
 *   库存/停滞 → 警告。
 *
 * ============================================================================
 * 四、报告写给谁看
 * ----------------------------------------------------------------------------
 * 用户会把它粘给另一个完全不了解本软件的模型问"我哪里错了"。
 * 所以每条检查都必须自带**判定依据**（"IBU 213，高于 21A 的 40–70，高出 143，
 * 约 4.8 个区间宽度"），而不是"IBU 越界"；报告还要带版本、计算口径、
 * 关键输入明细——缺了这些，对方只能给套话。
 *
 * 长度上限 6000 字符（MAX_REPORT）。超长时按"每组最多 N 行 / 检查最多 M 条"
 * 逐级收缩，**并在正文里逐处写明省略了什么**。静默截断是最糟的：
 * 对方会以为自己看到了全部，然后基于不完整的信息下结论。
 *
 * ============================================================================
 * 五、复用了什么、没有碰什么
 * ----------------------------------------------------------------------------
 * 状态读取一律走既有出口：UI.recipe() / UI.calc() / UI.store /
 * BREW.Batch.analyze / UI.InventoryPanel.check / BREW.FieldRules。
 * 没有新写任何一条化学或平衡判定。
 * 已知的"两处各有一份"（不改，只报）：水离子预警 —— 20-calc 用
 * 钠>150 / 硫酸盐>400 / 氯化物>300，39a 的 wNa 100 / wSO4 350 / wCl 250。
 * 本面板**不**再加第三套，水离子一律走 Calc.warnings。
 *
 * 依赖：00（Bus/Store）、20（Calc）、35（Batch）、39a（FieldRules）、
 *       40（UI.Shell/UI.store/UI.calc/UI.icon）、47（InventoryPanel，可缺）
 * 对外：UI.RunPanel.{open, close, run, report, reset, diff, copy, openReport}
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var RP = UI.RunPanel = UI.RunPanel || {};

  /* 报告字符上限。6000 是"粘进任何对话框都不至于被截掉一半"的经验值：
     一份 8 麦芽 6 酒花的中等配方，完整报告约 3200–4200 字符。 */
  var MAX_REPORT = 6000;
  var MAX_CHECKS_IN_REPORT = 24;
  var MAX_DETAIL_ROWS = 8;
  var MAX_STEPS = 3;
  var DONE_KEY = 'runpanel.done';

  var panel = null;        /* 控制面板的 modal api */
  var reportModal = null;  /* 报告全文的 modal api */
  var last = null;         /* 上一次运行的结果快照 */
  var lastCopyPath = '';
  var flashTimer = 0;

  /* 弹层随时会被用户用 X / 遮罩 / Esc 关掉，而 Shell.closeModal 不会把
     我们手里的 api 置空。所有"还开着吗"的判断都要走这两个函数，
     否则会往一个已经脱离文档的节点写 innerHTML（看起来像"面板打不开"）。 */
  function panelAlive() {
    if (panel && !(panel.el && panel.el.isConnected)) panel = null;
    return !!panel;
  }
  function reportAlive() {
    if (reportModal && !(reportModal.el && reportModal.el.isConnected)) reportModal = null;
    return !!reportModal;
  }

  /* ======================================================================
   * 0. 基础工具（全部薄封装，不改变语义）
   * ====================================================================*/

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function attr(s) { return esc(s); }

  function num(v, d) {
    var n = (typeof v === 'number') ? v : parseFloat(v);
    return isFinite(n) ? n : (d === undefined ? 0 : d);
  }
  function fmt(v, d) { return (typeof UI.fmt === 'function') ? UI.fmt(v, d) : String(v); }
  function sg(v) { return (typeof UI.sg === 'function') ? UI.sg(v) : String(v); }
  function icon(n, s) { return (typeof UI.icon === 'function') ? UI.icon(n, s || 13) : ''; }
  function toast(msg, kind, ms) {
    if (UI.Shell && typeof UI.Shell.toast === 'function') UI.Shell.toast(msg, kind || 'info', ms || 3400);
  }
  /* 告警正文里带 Markdown 的 **加重**（20-calc 的碳水警告就是这么写的）。
     面板是 HTML、报告是 Markdown：两处都不吃这层星号，统一剥掉。 */
  function plain(s) { return String(s === null || s === undefined ? '' : s).replace(/\*\*/g, ''); }

  function recipe() {
    try { return (typeof UI.recipe === 'function') ? UI.recipe() : null; } catch (e) { return null; }
  }
  function calcOf(r) {
    try { return (typeof UI.calc === 'function') ? UI.calc(r) : null; } catch (e) { return null; }
  }
  function styleOf(id) {
    try { return (id && UI.byId) ? UI.byId('styles', id) : null; } catch (e) { return null; }
  }
  function savedOf(id) {
    if (!id) return null;
    try {
      if (BREW.Store && typeof BREW.Store.getRecipe === 'function') {
        var hit = BREW.Store.getRecipe(id);
        if (hit) return hit;
      }
    } catch (e) { /* 落到下面的遍历 */ }
    try {
      var list = UI.store.recipes();
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    } catch (e2) { /* 存储不可用时当作"没保存过" */ }
    return null;
  }
  function batchesOf(recipeId) {
    try {
      var list = UI.store.batches();
      if (!Array.isArray(list) || !recipeId) return [];
      return list.filter(function (b) { return b && b.recipeId === recipeId; });
    } catch (e) { return []; }
  }

  /* ======================================================================
   * 1. 取值与展示
   * ====================================================================*/

  /* key 有两种来源：39a 的键是小写（og / ibu），Calc.styleMatch 归一后
     的 field 是显示标签（OG / IBU）。统一按大写比对，免得同一条规则
     在"输入范围"和"风格偏差"两处显示成 1.1 与 1.047 两个值。 */
  function showVal(key, v) {
    var K = String(key === null || key === undefined ? '' : key).toUpperCase();
    if (K === 'OG' || K === 'FG') return sg(v);
    if (K === 'BATCHSIZE' || K === 'TRUBLOSS') return fmt(v, 1) + ' L';
    if (K === 'EFFICIENCY' || K === 'ATTENUATION') return fmt(v, 0) + '%';
    if (K === 'BOILTIME') return fmt(v, 0) + ' min';
    if (K === 'ABV') return fmt(v, 1) + '%';
    if (K === 'IBU') return fmt(v, 0) + ' IBU';
    if (K === 'SRM') return fmt(v, 1) + ' SRM';
    if (K === 'CARBONATION') return fmt(v, 1) + ' vol';
    return fmt(v, 1);
  }

  /** 显示精度：比重 3 位，其余 1 位（IBU 0 位） */
  function digitsOf(key) {
    var K = String(key === null || key === undefined ? '' : key).toUpperCase();
    if (K === 'OG' || K === 'FG') return 3;
    if (K === 'IBU') return 0;
    return 1;
  }

  /** 不带单位的名词值：风格偏差的标题里标签本身就叫 IBU / SRM，
   *  再拼一次单位会变成「IBU 205 IBU」。 */
  function bareVal(key, v) {
    var K = String(key === null || key === undefined ? '' : key).toUpperCase();
    if (K === 'OG' || K === 'FG') return sg(v);
    if (K === 'ABV') return fmt(v, 1) + '%';
    return fmt(v, digitsOf(key));
  }

  function catLabel(cat) {
    var m = { base: '基础麦芽', crystal: '结晶麦芽', roast: '烘烤谷物', grain: '未发芽谷物',
      sugar: '糖类', extract: '提取物', other: '其他' };
    return m[cat] || cat || '';
  }

  /** 配方上下文：每条告警的「判定依据」都带这段，报告对外部模型才有用 */
  function ctxLine(r) {
    return '批次量 ' + fmt(r.batchSize, 1) + ' L · 糖化效率 ' + fmt(r.efficiency, 0) + '% · ' +
      '麦芽 ' + (r.fermentables || []).length + ' 行 · 酒花 ' + (r.hops || []).length + ' 行 · ' +
      '酵母 ' + (r.yeasts || []).length + ' 行 · 碳化度 ' +
      fmt(num((r.carbonation || {}).targetVol, 2.4), 1) + ' vol';
  }

  /* ======================================================================
   * 2. 检查项来源：跳转目标
   * ----------------------------------------------------------------------
   * 用**稳定的 DOM 特征**定位（data-rows / 具名 id），不用卡片标题文字——
   * 标题是文案，会被人改；data-rows 是 42 渲染表格时写死的契约。
   * ====================================================================*/

  var BLOCK_SEL = {
    basic: '#f-name',
    style: '#f-style',
    malt: '[data-rows="fermentables"]',
    hop: '[data-rows="hops"]',
    yeast: '[data-rows="yeasts"]',
    adjunct: '[data-rows="adjuncts"]',
    water: '#water-summary',
    mash: '#mash-summary',
    warn: '#warn-block',
    metrics: '#style-match'
  };

  function tBlock(kind) {
    return kind ? { view: 'recipe', sel: BLOCK_SEL[kind] || BLOCK_SEL.warn } : null;
  }

  /** 计算告警 → 大概该去哪块改。关键词是本文件唯一的"猜位置"逻辑：
   *  猜错了只是点过去看到不该看的那张卡，不会改变任何数据。 */
  function tFromWarning(text) {
    var s = String(text || '');
    if (/麦芽|谷物|糖化水|洗糟/.test(s)) return tBlock('malt');
    if (/酒花|IBU|苦度|α 酸/.test(s)) return tBlock('hop');
    if (/酵母|接种|发酵温度|扩培/.test(s)) return tBlock('yeast');
    if (/水|钠|硫酸盐|氯化物|水料比/.test(s)) return tBlock('water');
    if (/FG|OG|比重|衰减/.test(s)) return tBlock('metrics');
    return tBlock('warn');
  }

  function tFromMetric(field) {
    if (field === 'IBU') return tBlock('hop');
    if (field === 'OG' || field === 'SRM') return tBlock('malt');
    if (field === 'FG' || field === 'ABV') return tBlock('yeast');
    return tBlock('metrics');
  }

  /* ======================================================================
   * 3. 组装检查清单
   * ====================================================================*/

  function makeRefs() {
    var arr = [];
    return {
      add: function (t) { arr.push(t || null); return arr.length - 1; },
      list: arr
    };
  }

  function buildChecks(r, c, refs) {
    var out = [];
    var pass = 0;
    var FR = BREW.FieldRules;

    function push(o) {
      o.id = o.id || ('c' + out.length);
      o.basis = plain(o.basis || '');
      o.title = plain(o.title || '');
      o.fix = plain(o.fix || '');
      o.ref = refs.add(o.target || null);
      out.push(o);
    }

    /* ---------- 3.1 输入范围（39a） ---------- */
    var FIELDS = [
      { key: 'batchSize', get: function () { return r.batchSize; }, block: 'basic' },
      { key: 'efficiency', get: function () { return r.efficiency; }, block: 'basic' },
      { key: 'boilTime', get: function () { return r.boilTime; }, block: 'basic' },
      { key: 'trubLoss', get: function () { return r.trubLoss; }, block: 'basic' },
      { key: 'carbonation', get: function () { return num((r.carbonation || {}).targetVol, NaN); }, block: 'basic' }
    ];
    /* 成品指标只有算得出来时才判：一锅没有麦芽的配方，OG 一定是 1.000，
       拿它去比"初始比重偏低"是噪声，不是发现。 */
    var hasGrain = false;
    for (var gi = 0; gi < (r.fermentables || []).length; gi++) {
      if (num(r.fermentables[gi].amount, 0) > 0) { hasGrain = true; break; }
    }
    if (hasGrain && c && c.og > 1.001) {
      FIELDS.push({ key: 'og', get: function () { return c.og; }, block: 'metrics' });
      FIELDS.push({ key: 'fg', get: function () { return c.fg; }, block: 'yeast' });
      FIELDS.push({ key: 'abv', get: function () { return c.abv; }, block: 'malt' });
      FIELDS.push({ key: 'ibu', get: function () { return c.ibu; }, block: 'hop' });
      FIELDS.push({ key: 'srm', get: function () { return c.srm; }, block: 'malt' });
      FIELDS.push({ key: 'attenuation', get: function () { return c.attenuation; }, block: 'yeast' });
    }

    for (var fi = 0; fi < FIELDS.length; fi++) {
      var f = FIELDS[fi];
      if (!FR || typeof FR.test !== 'function') break;
      var v = num(f.get(), NaN);
      if (!isFinite(v)) continue;
      var res = FR.test(f.key, v);
      if (!res || res.level === 'empty') continue;
      if (res.level === 'ok') { pass++; continue; }

      var rule = res.rule || {};
      var lvl = res.level === 'hard' ? 'error' : 'warn';
      var lo = res.level === 'hard' ? rule.lo : rule.sLo;
      var hi = res.level === 'hard' ? rule.hi : rule.sHi;
      var dir = (lo !== undefined && v < lo) ? 'low' : 'high';
      var over = dir === 'low' ? (lo - v) : (v - hi);
      var overTxt = fmt(over, digitsOf(f.key));
      var unitTxt = rule.unit ? ' ' + rule.unit : '';

      push({
        id: 'field:' + f.key,
        level: lvl,
        title: rule.label + ' ' + showVal(f.key, v) + '，' +
          (dir === 'low' ? '低于' : '高于') + (res.level === 'hard' ? '合理范围' : '常见范围') +
          ' ' + fmt(lo, 1) + '–' + fmt(hi, 1) + unitTxt,
        basis: '风月酿研所的输入区间表（FieldRules.' + f.key + '）把' + rule.label + '的' +
          (res.level === 'hard' ? '硬边界' : '软边界') + '定在 ' + fmt(lo, 1) + '–' + fmt(hi, 1) + unitTxt +
          '；本配方为 ' + showVal(f.key, v) + '，越界 ' + overTxt + unitTxt + '。' +
          rule.why,
        source: '输入范围 · FieldRules.' + f.key,
        fix: res.level === 'hard' ? '这个值物理上不太可能出现，先确认是不是填错了。' : '',
        target: tBlock(f.block)
      });
    }

    /* ---------- 3.2 关系规则（39a） ---------- */
    if (FR && typeof FR.relation === 'function') {
      var totalKg = 0, darkKg = 0;
      for (var mi = 0; mi < (r.fermentables || []).length; mi++) {
        var mrow = r.fermentables[mi];
        var kg = num(mrow.amount, 0);
        totalKg += kg;
        /* 口径与配方页 malt-rel 完全一致：结晶 + 烘烤 */
        if (mrow.cat === 'crystal' || mrow.cat === 'roast') darkKg += kg;
      }
      var rels = [
        { key: 'buGu', ctx: { og: c.og, ibu: c.ibu }, block: 'hop' },
        { key: 'so4cl', ctx: { cl: (c.water || {}).cl, so4: (c.water || {}).so4 }, block: 'water' },
        { key: 'darkGrainPct', ctx: { totalKg: totalKg, darkKg: darkKg }, block: 'malt' }
      ];
      for (var ri = 0; ri < rels.length; ri++) {
        var rel = FR.relation(rels[ri].key, rels[ri].ctx);
        if (!rel) continue;
        if (rel.level === 'empty') continue;
        if (rel.level === 'ok') { if (rel.value !== null && rel.value !== undefined) pass++; continue; }
        push({
          id: 'rel:' + rels[ri].key,
          level: rel.level === 'hard' ? 'error' : 'warn',
          title: rel.msg ? rel.msg.split('。')[0] : (rel.label || rels[ri].key),
          basis: '关系规则判定（两个数各自正常、合起来说不通的那一类）：' + plain(rel.msg),
          source: '输入范围 · FieldRules.relation(\'' + rels[ri].key + '\')',
          fix: '',
          target: tBlock(rels[ri].block)
        });
      }
    }

    /* ---------- 3.3 风格偏差（Calc.styleMatch） ---------- */
    var sm = c.styleMatch;
    if (sm && Array.isArray(sm.deviations)) {
      var st = styleOf(sm.styleId);
      var code = (st && st.id) || sm.styleId || '';
      var stName = (st && st.name) || sm.styleName || '';
      var stEn = (st && st.en) || '';
      for (var di = 0; di < sm.deviations.length; di++) {
        var d = sm.deviations[di];
        if (!d) continue;
        if (d.verdict === 'ok') { pass++; continue; }
        var dSpan = Math.max(1e-6, num(d.range.hi) - num(d.range.lo));
        var dOver = d.verdict === 'low' ? (num(d.range.lo) - num(d.actual)) : (num(d.actual) - num(d.range.hi));
        if (!(dOver > 0)) { pass++; continue; }
        var dg = digitsOf(d.field);
        var esc2 = dOver > dSpan;   /* 见文件头 §三 */
        push({
          id: 'style:' + (d.field || di),
          level: esc2 ? 'error' : 'warn',
          title: (d.field || '指标') + ' ' + bareVal(d.field, d.actual) + '，' +
            (d.verdict === 'low' ? '低于' : '高于') + ' ' + code + ' 的区间 ' +
            fmt(d.range.lo, dg) + '–' + fmt(d.range.hi, dg),
          basis: '风格 ' + code + ' ' + stName + (stEn ? '（' + stEn + '）' : '') + '的 ' + (d.field || '') +
            ' 区间为 ' + fmt(d.range.lo, dg) + '–' + fmt(d.range.hi, dg) +
            '；本配方算出 ' + bareVal(d.field, d.actual) + '，比区间' +
            (d.verdict === 'low' ? '下限低 ' : '上限高 ') + fmt(dOver, dg) +
            '（约 ' + fmt(dOver / dSpan, 1) + ' 个区间宽度）。' +
            (esc2
              ? '偏离超过一整段区间，按"错误"处理：多半是风格选错了，或者某一项参数填错了一位数。'
              : '仍在"可以靠微调救回来"的范围内。'),
          source: '风格偏差 · Calc.styleMatch.deviations[' + (d.field || di) + ']，风格匹配度 ' + fmt(sm.score, 0) + '%',
          fix: '',
          target: tFromMetric(d.field)
        });
      }
    }

    /* ---------- 3.4 配方可行性告警（Calc.warnings） ---------- */
    var warns = (c.warnings || []).slice();
    for (var wi = 0; wi < warns.length; wi++) {
      var w = warns[wi];
      if (!w) continue;
      push({
        id: 'warn:' + wi,
        level: w.level === 'error' ? 'error' : (w.level === 'warn' ? 'warn' : 'info'),
        title: plain(w.text),
        /* 有些告警正文不含数字（"没有选择酵母"）。给外部模型补上上下文，
           否则它只能回一句"你可能缺酵母"——那句话用户自己也知道。 */
        basis: 'Calc.warnings（配方能不能做出来）。当前配方：' + ctxLine(r) + '。',
        source: '计算告警 · Calc.warnings',
        fix: plain(w.fix || ''),
        target: tFromWarning(w.text)
      });
    }

    /* ---------- 3.5 完整性：风格 / 名称 ---------- */
    if (!r.styleId) {
      push({
        id: 'meta:style',
        level: 'warn',
        title: '还没有选择啤酒风格，风格区间与偏差检查无法进行',
        basis: '当前 styleId 为空；风格库共 ' + (UI.list ? UI.list('styles').length : 0) +
          ' 条可选风格。选了风格之后，OG / FG / ABV / IBU / SRM 五项会逐项比对区间。',
        source: '配方模型 · r.styleId',
        fix: '在「基本信息 → 啤酒风格」里选一个最接近的。',
        target: tBlock('style')
      });
    }
    if (!String(r.name || '').trim() || r.name === '未命名配方') {
      push({
        id: 'meta:name',
        level: 'info',
        title: '配方还没有名字（当前名称长度 ' + String(r.name || '').trim().length + '）',
        basis: '名称为空或仍是默认值「未命名配方」；保存时会要求先命名，导出与配方卡也会没有标题。',
        source: '配方模型 · r.name',
        fix: '',
        target: tBlock('basic')
      });
    }

    /* ---------- 3.6 库存（47 → 33 的余额口径） ---------- */
    var invChecks = inventoryChecks(r);
    for (var ii = 0; ii < invChecks.length; ii++) {
      var ic = invChecks[ii];
      if (ic.level === 'ok') { pass++; continue; }
      push(ic);
    }

    /* ---------- 3.7 批次上下文：停滞 / 装瓶量 ---------- */
    var bChecks = batchChecks(r);
    for (var bi = 0; bi < bChecks.length; bi++) {
      var bc = bChecks[bi];
      if (bc.level === 'ok') { pass++; continue; }
      push(bc);
    }

    /* 排序：错误 → 警告 → 建议，同级保持来源顺序（区间 → 关系 → 风格 → 告警 → …） */
    var ord = { error: 0, warn: 1, info: 2 };
    out.sort(function (a, b) { return (ord[a.level] || 3) - (ord[b.level] || 3); });

    var stats = { error: 0, warn: 0, info: 0, pass: pass, total: out.length };
    for (var si = 0; si < out.length; si++) {
      if (stats[out[si].level] !== undefined && out[si].level !== 'pass') stats[out[si].level]++;
    }

    return { checks: out, stats: stats };
  }

  /* ---------------------------------------------------------- 3.6 库存 */
  /**
   * 逐种原料问 47 号：记过账吗？够吗？
   * 为什么用 UI.InventoryPanel.check 而不是自己遍历流水：
   *   配方行的库存徽章就是它画的（42 每行一个），这里再算一遍必然出现
   *   "行上绿、报告里红"。check 内部用 balanceOf（Σ流水），是 33 那套余额口径。
   * 「没记过账」不等于「缺货」——那种情况只给一条建议，不逐条报红。
   */
  function inventoryChecks(r) {
    var P = UI.InventoryPanel;
    var out = [];
    if (!P || typeof P.check !== 'function') return out;

    var KINDS = [
      { kind: 'malts', rows: r.fermentables || [], label: '麦芽' },
      { kind: 'hops', rows: r.hops || [], label: '酒花' },
      { kind: 'yeasts', rows: r.yeasts || [], label: '酵母' },
      { kind: 'adjuncts', rows: r.adjuncts || [], label: '辅料' }
    ];

    var tracked = 0, short = 0, rowsSeen = 0;
    var shortItems = [];

    for (var k = 0; k < KINDS.length; k++) {
      var K = KINDS[k];
      var agg = {}, order = [];
      for (var i = 0; i < K.rows.length; i++) {
        var row = K.rows[i];
        if (!row || !row.id) continue;
        var need = num(row.amount, 0);
        if (!(need > 0)) continue;
        rowsSeen++;
        if (!agg[row.id]) {
          agg[row.id] = { id: row.id, name: row.name || row.id, need: 0, unit: row.unit || '' };
          order.push(row.id);
        }
        agg[row.id].need += need;
      }
      for (var j = 0; j < order.length; j++) {
        var it = agg[order[j]];
        var res = null;
        try { res = P.check(K.kind, it.id, it.need, it.unit || undefined); } catch (e) { res = null; }
        if (!res || !res.tracked) continue;
        tracked++;
        if (res.unitMismatch) {
          out.push({
            id: 'inv:' + K.kind + ':' + it.id,
            level: 'warn',
            title: it.name + '：库存单位与配方单位不能换算',
            basis: K.label + '「' + it.name + '」配方需要 ' + fmt(it.need, 2) + ' ' + (it.unit || '') +
              '，库存记录的单位族不同（如 kg 与 ml），无法比较，按 0 计。',
            source: '库存 · InventoryPanel.check（余额来自 Inventory）',
            fix: '到「原料库 → 库存」把这条物料的单位改成与配方一致。',
            target: { view: 'ingredient', sel: '[data-mode="stock"]', click: '[data-mode="stock"]' }
          });
          continue;
        }
        if (res.short > 0) {
          short++;
          shortItems.push(it.name + ' 缺 ' + fmt(res.short, 2) + (it.unit || ''));
          out.push({
            id: 'inv:' + K.kind + ':' + it.id,
            level: 'warn',
            title: it.name + ' 库存不够：缺 ' + fmt(res.short, 2) + ' ' + (it.unit || ''),
            basis: K.label + '「' + it.name + '」本批需要 ' + fmt(res.need, 2) + ' ' + (it.unit || '') +
              '，账面余额 ' + fmt(res.have, 2) + ' ' + (res.haveUnit || it.unit || '') +
              '（余额 = 库存流水的 Σdelta，不是手填的剩余量）。',
            source: '库存 · InventoryPanel.check（余额来自 Inventory）',
            fix: '补料，或把用量降到现有库存以内。',
            target: { view: 'ingredient', sel: '[data-mode="stock"]', click: '[data-mode="stock"]' }
          });
        } else {
          out.push({ id: 'inv:' + K.kind + ':' + it.id, level: 'ok' });
        }
      }
    }

    if (!tracked && rowsSeen > 0) {
      out.push({
        id: 'inv:none',
        level: 'info',
        title: '没有录入库存，缺料检查本次跳过（' + rowsSeen + ' 行原料未记账）',
        basis: '配方共 ' + rowsSeen + ' 行原料用了库存里没有记录的物料；' +
          '风月酿研所的口径是"没记过账 ≠ 缺货"，所以不在这里逐条报红。库存有 ' +
          '0 条可核对的物料。',
        source: '库存 · InventoryPanel.check',
        fix: '要用缺料检查，先到「原料库 → 库存」入库。',
        target: { view: 'ingredient', sel: '[data-mode="stock"]', click: '[data-mode="stock"]' }
      });
      out.push({ id: 'inv:short-summary', level: 'ok' });   /* 占位，不参与统计 */
    }
    out.push({ id: 'inv:stat', level: 'ok', _stat: { tracked: tracked, short: short, items: shortItems } });
    return out;
  }

  /* ------------------------------------------------- 3.7 批次上下文 */
  /**
   * 停滞与装瓶量只在"这份配方已经有批次"时才判。
   * 两者的判定都来自既有实现：35 的 analyze().stalled / 39a 的 pkgVsBatch。
   */
  function batchChecks(r) {
    var out = [];
    var list = batchesOf(r.id);
    if (!list.length) return out;

    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var tag = (b.name || b.batchNo || '批次') + (b.batchNo ? ' #' + b.batchNo : '');
      var an = null;
      try { if (BREW.Batch && BREW.Batch.analyze) an = BREW.Batch.analyze(b); } catch (e) { an = null; }
      if (an && an.stalled) {
        out.push({
          id: 'batch:' + b.id + ':stall',
          level: 'warn',
          title: '「' + tag + '」发酵可能停滞',
          basis: 'Batch.analyze() 的停滞判定（相邻两个比重点间隔 ≥48h 且变化 <2 点，' +
            '且仍高于预期 FG 4 点以上）。' + plain(an.stallReason || ''),
          source: '发酵停滞 · Batch.analyze().stalled',
          fix: '先确认温度与酵母活性；必要时轻轻摇桶悬浮酵母，或补一包同菌株。',
          target: { view: 'batch' }
        });
      }
      /* 装瓶量 vs 入罐量：39a 的硬关系，错了一定是填错了 */
      var pkg = num((b.packaging || {}).volume, 0);
      var snapBatch = num((b.recipeSnapshot || {}).batchSize, 0) || num(r.batchSize, 0);
      if (pkg > 0 && snapBatch > 0 && BREW.FieldRules && BREW.FieldRules.relation) {
        var rel = BREW.FieldRules.relation('pkgVsBatch', { pkgL: pkg, batchL: snapBatch });
        if (rel && (rel.level === 'hard' || rel.level === 'soft')) {
          out.push({
            id: 'batch:' + b.id + ':pkg',
            level: rel.level === 'hard' ? 'error' : 'warn',
            title: '「' + tag + '」' + plain(rel.msg).split('。')[0],
            basis: 'FieldRules.relation(\'pkgVsBatch\')：装瓶量必然小于批次量' +
              '（发酵会带走酵母泥、干投吸液与取样）。本批次装瓶 ' + fmt(pkg, 1) + ' L，' +
              '批次量 ' + fmt(snapBatch, 1) + ' L。',
            source: '装瓶量 · FieldRules.relation(\'pkgVsBatch\')',
            fix: '确认是不是把发酵罐总量当成了进瓶量。',
            target: { view: 'batch' }
          });
        } else {
          out.push({ id: 'batch:' + b.id + ':pkg', level: 'ok' });
        }
      }
    }
    return out;
  }

  /* 把 inventoryChecks 里那些"占位 ok"过滤掉，同时把统计取出来 */
  function refineInventory(checks) {
    var kept = [], stat = null;
    for (var i = 0; i < checks.length; i++) {
      if (checks[i]._stat) { stat = checks[i]._stat; continue; }
      if (checks[i].level === 'ok' && !checks[i].title) continue;
      kept.push(checks[i]);
    }
    return { list: kept, stat: stat };
  }

  /* ======================================================================
   * 4. 下一步：当前最该做的三件事
   * ====================================================================*/

  function buildSteps(r, c, checks, refs) {
    var cand = [];

    function add(key, title, basis, target, level) {
      cand.push({ key: key, title: plain(title), basis: plain(basis), target: target || null, level: level || 'warn' });
    }

    var saved = savedOf(r.id);
    var diff = saved ? diffRecipe(r, saved) : null;

    /* ① 先处理第一条错误：错误是"这锅做不出来"，优先级高于任何优化 */
    var firstErr = null;
    for (var i = 0; i < checks.length; i++) {
      if (checks[i].level === 'error') { firstErr = checks[i]; break; }
    }
    if (firstErr) {
      add('error', '先处理这条错误：' + firstErr.title,
        firstErr.basis, firstErr.target, 'error');
    }

    /* ② 缺什么补什么：顺序按"少了它就算不出来"的程度排 */
    if (!r.styleId) {
      add('style', '选一个啤酒风格',
        '没有风格就没有区间可比，OG/FG/ABV/IBU/SRM 五项检查全部停摆。风格只影响"判定"，不影响计算，所以随手选一个最接近的即可。',
        tBlock('style'), 'warn');
    }
    var hasMalt = false;
    for (var mi = 0; mi < (r.fermentables || []).length; mi++) {
      if (num(r.fermentables[mi].amount, 0) > 0) { hasMalt = true; break; }
    }
    if (!hasMalt) {
      add('malt', '先加一款基础麦芽',
        '麦芽表是空的（0 行），OG / FG / SRM 都算不出来。20 L 批次通常从 4–5 kg 淡色艾尔麦芽起步。',
        tBlock('malt'), 'error');
    }
    if (!(r.yeasts || []).length) {
      add('yeast', '选一株酵母',
        '没有酵母就取不到酵母标称衰减度，FG 与 ABV 只能按 75% 默认值估算（当前 FG ' + sg(c.fg) + '）。',
        tBlock('yeast'), 'warn');
    }
    if (!(r.hops || []).length) {
      add('hop', '加一次苦化酒花',
        '酒花表是空的（0 行），IBU 为 0；除少数酸啤外，没有苦度支撑的麦芽甜会显得腻。',
        tBlock('hop'), 'info');
    }

    /* ③ 偏差最大的一项（只看警告级，错误已经在第 ① 条里） */
    var worst = null;
    for (var wi = 0; wi < checks.length; wi++) {
      var ck = checks[wi];
      if (ck.level !== 'warn' || !/^style:/.test(ck.id)) continue;
      if (!worst) worst = ck;
    }
    if (worst && !firstErr) {
      add('dev', '把偏差拉回风格区间：' + worst.title,
        worst.basis, worst.target, 'warn');
    }

    /* ④ 有未保存修改就提醒保存（重置也是围绕这个状态做文章的） */
    if (!saved) {
      add('save', '保存这份配方（还没有存过档）',
        '这份配方还只在工作副本里：刷新页面靠自动草稿能回来，但它不在"我的配方"列表里，也不会进版本历史。',
        { act: 'save' }, 'info');
    } else if (diff && diff.total > 0) {
      add('save', '保存这份配方（' + diff.total + ' 处未保存的修改）',
        '当前内容与已保存的第 ' + (saved.rev || 1) + ' 版不同：' + (diff.texts.slice(0, 3).join('、') || '') +
        '。不保存的话，这些改动只存在于工作副本里。',
        { act: 'save' }, 'info');
    }

    /* ⑤ 缺料 */
    var invShort = null;
    for (var si = 0; si < checks.length; si++) {
      if (/^inv:/.test(checks[si].id) && checks[si].level === 'warn') { invShort = checks[si]; break; }
    }
    if (invShort) {
      add('inv', '补料：' + invShort.title, invShort.basis, invShort.target, 'warn');
    }

    /* ⑥ 停滞 */
    for (var bi = 0; bi < checks.length; bi++) {
      if (/^batch:.*:stall$/.test(checks[bi].id)) {
        add('stall', checks[bi].title, checks[bi].basis, checks[bi].target, 'warn');
        break;
      }
    }

    /* ⑦ 收尾：这份配方还没有批次，成品表现无从核对 */
    if (!batchesOf(r.id).length) {
      add('batch', '建一个批次，开始记实测',
        '配方只是设计值。建批次后会记录 OG / 比重曲线 / 装瓶量，' +
        '停滞检测与装瓶量检查也才有数据可用。',
        { view: 'batch' }, 'info');
    }

    /* ⑧ 库存一条都没录：不催也可以，但要让人知道缺料检查这次是空跑 */
    for (var ni = 0; ni < checks.length; ni++) {
      if (checks[ni].id === 'inv:none') {
        add('inv-setup', '把库存录一遍（缺料检查现在没有依据）',
          checks[ni].basis, checks[ni].target, 'info');
        break;
      }
    }

    /* 取前三条；同一 key 不重复 */
    var picked = [], seen = {};
    for (var pi = 0; pi < cand.length && picked.length < MAX_STEPS; pi++) {
      if (seen[cand[pi].key]) continue;
      seen[cand[pi].key] = true;
      picked.push(cand[pi]);
    }
    for (var qi = 0; qi < picked.length; qi++) picked[qi].ref = refs.add(picked[qi].target || null);
    return picked;
  }

  /* ======================================================================
   * 5. 运行
   * ====================================================================*/

  function buildSnapshot() {
    var r = recipe();
    var c = r ? calcOf(r) : null;
    var refs = makeRefs();
    var snap = {
      at: Date.now(),
      recipeId: r ? r.id : '',
      recipe: r,
      calc: c,
      checks: [],
      steps: [],
      stats: { error: 0, warn: 0, info: 0, pass: 0, total: 0 },
      refs: refs.list
    };
    if (!r || !c) {
      snap.checks = [{
        id: 'fatal', level: 'error',
        title: '没有可检查的配方（计算内核未返回结果）',
        basis: 'UI.recipe() 或 UI.calc() 返回空。页面可能还没初始化完，刷新一次再运行。',
        source: '启动顺序', fix: '', ref: -1
      }];
      snap.stats = { error: 1, warn: 0, info: 0, pass: 0, total: 1 };
      return snap;
    }

    var built = buildChecks(r, c, refs);
    /* 库存检查里有一类"占位 ok"（仅用于统计），先剥离再统计 */
    var refined = refineInventory(built.checks);
    var stats = { error: 0, warn: 0, info: 0, pass: built.stats.pass, total: 0 };
    var list = [];
    for (var i = 0; i < refined.list.length; i++) {
      var item = refined.list[i];
      if (item.level === 'ok') continue;
      list.push(item);
      stats[item.level]++;
    }
    /* 库存里的 tracked/short 计数用于摘要，不进检查列表 */
    snap.invStat = refined.stat;
    snap.checks = list;
    stats.total = list.length;
    snap.stats = stats;
    snap.steps = buildSteps(r, c, list, refs);
    return snap;
  }

  RP.snapshot = function () { return last; };
  /* 报告上限对外可见：界面文案、测试与文档都读这一个数，别各写一份 */
  RP.MAX_REPORT = MAX_REPORT;

  RP.run = function (opts) {
    last = buildSnapshot();
    if (panel && (!opts || opts.repaint !== false)) renderPanel();
    return last;
  };

  /* ======================================================================
   * 6. 报告
   * ====================================================================*/

  function mdCell(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function styleRangeNote() {
    return 'BREW.DB.styles（BJCP 2015 框架，编号与已变更区间按 BJCP 2021 迁移；' +
      'rangeSource=local 的条目是本库自定窗口，不是 BJCP 数值）';
  }

  function versionLine() {
    var v = (BREW.Config && BREW.Config.VERSION_LABEL) || '?';
    var vv = (BREW.Config && BREW.Config.VERSION) || '';
    return '风月酿研所 ' + v + (vv ? '（内核 ' + vv + '）' : '');
  }

  function engineLine(c) {
    var e = c && c.__engine;
    if (e === 'calc') return 'BREW.Calc 计算内核（Tinseth 苦度 / Morey 色度 / 酵母标称衰减度）';
    if (e === 'builtin') return '界面内置估算内核（Calc 未就绪时的降级路径，口径与 20-calc 一致）';
    return '计算内核未标注来源';
  }

  /**
   * 生成报告。
   * @param {object} opts {detailMax, checksMax, snap}
   * @returns {string}
   */
  function buildReport(opts) {
    opts = opts || {};
    var snap = opts.snap || last || buildSnapshot();
    var r = snap.recipe;
    var c = snap.calc;
    if (!r || !c) {
      return '# 风月酿研所 配方体检报告\n\n没有可用的配方数据（UI.recipe() 为空）。请在软件里打开一份配方后重新运行。\n';
    }

    var detailMax = opts.detailMax || MAX_DETAIL_ROWS;
    var checksMax = opts.checksMax || MAX_CHECKS_IN_REPORT;
    var omissions = [];       /* 每一处省略都必须落到正文里 */

    var st = styleOf(r.styleId);
    var sm = c.styleMatch;
    var L = [];
    var push = function (s) { L.push(s); };

    push('# 风月酿研所 配方体检报告');
    push('');
    push('- 生成时间：' + UI.dt(snap.at, true));
    push('- 软件：' + versionLine());
    push('- 计算内核：' + engineLine(c));
    push('- 风格区间来源：' + styleRangeNote());
    push('- 数值性质：**标称估算**，不是实验室测量。IBU 为公式计算值，实际受酒花年份、' +
      '水质、发酵与干投影响；颜色以实物为准。');
    push('');

    /* ---------- 摘要 ---------- */
    push('## 一、配方摘要');
    push('');
    push('| 项目 | 值 |');
    push('|---|---|');
    push('| 配方 | ' + mdCell(r.name || '未命名配方') + ' |');
    push('| 风格 | ' + mdCell(st ? (st.id + ' ' + st.name + (st.en ? '（' + st.en + '）' : '')) : '未指定') +
      (sm ? '，匹配度 ' + fmt(sm.score, 0) + '%' : '') + ' |');
    push('| 批次量 | ' + fmt(r.batchSize, 1) + ' L |');
    push('| 糖化效率 | ' + fmt(r.efficiency, 0) + '% |');
    push('| 煮沸 | ' + fmt(r.boilTime, 0) + ' min，蒸发 ' + fmt(r.evaporationRate, 0) + '%/h |');
    push('| OG / FG | ' + sg(c.og) + ' / ' + sg(c.fg) + ' |');
    push('| ABV | ' + fmt(c.abv, 1) + '% |');
    push('| IBU（Tinseth） | ' + fmt(c.ibu, 0) + ' |');
    push('| SRM | ' + fmt(c.srm, 1) + ' |');
    push('| BU:GU | ' + fmt(c.buGu, 2) + '（' + (c.balance || '—') + '） |');
    push('| 发酵温度 | ' + fmt(r.fermentTemp, 0) + ' °C |');
    push('| 碳化度 | ' + fmt(num((r.carbonation || {}).targetVol, 2.4), 1) + ' vol |');
    push('');

    /* ---------- 结论 ---------- */
    var s = snap.stats || { error: 0, warn: 0, info: 0, pass: 0 };
    push('## 二、结论');
    push('');
    push('错误 ' + s.error + ' 条 · 警告 ' + s.warn + ' 条 · 建议 ' + s.info + ' 条 · ' +
      '通过 ' + s.pass + ' 项区间判定。');
    push('');
    if (snap.checks.length) {
      var lead = snap.checks[0];
      push('**最先要看的**：' + lead.title + (lead.source ? '（' + lead.source + '）' : ''));
      push('');
    } else {
      push('未发现需要处理的问题：输入范围、风格区间、可行性告警、库存与批次都没有异常项。');
      push('');
    }

    /* ---------- 检查结果 ---------- */
    push('## 三、检查结果（' + snap.checks.length + ' 条）');
    push('');
    var shown = Math.min(snap.checks.length, checksMax);
    var levelName = { error: '错误', warn: '警告', info: '建议' };
    for (var i = 0; i < shown; i++) {
      var ck = snap.checks[i];
      push('### ' + (i + 1) + '. [' + (levelName[ck.level] || ck.level) + '] ' + ck.title);
      push('');
      push('- **判定依据**：' + ck.basis);
      push('- **来源**：' + ck.source);
      if (ck.fix) push('- **建议**：' + ck.fix);
      var loc = whereText(ck);
      if (loc) push('- **在软件里的位置**：' + loc);
      push('');
    }
    if (snap.checks.length > shown) {
      var rest = snap.checks.slice(shown);
      var cnt = { error: 0, warn: 0, info: 0 };
      for (var ri = 0; ri < rest.length; ri++) cnt[rest[ri].level]++;
      omissions.push('检查项共 ' + snap.checks.length + ' 条，报告只列出前 ' + shown +
        ' 条（错误 ' + cnt.error + ' / 警告 ' + cnt.warn + ' / 建议 ' + cnt.info +
        ' 条未列出，全部为靠后的低优先级项）');
      push('> 检查项共 ' + snap.checks.length + ' 条，此处只列出前 ' + shown + ' 条；' +
        '其余 ' + rest.length + ' 条已省略（错误 ' + cnt.error + '、警告 ' + cnt.warn +
        '、建议 ' + cnt.info + '），它们在软件面板里可见。');
      push('');
    }

    /* ---------- 下一步 ---------- */
    push('## 四、软件给出的下一步（按优先级）');
    push('');
    if (!snap.steps.length) {
      push('没有待办。');
    } else {
      for (var k = 0; k < snap.steps.length; k++) {
        push((k + 1) + '. **' + snap.steps[k].title + '**');
        push('   - 依据：' + snap.steps[k].basis);
      }
    }
    push('');

    /* ---------- 明细 ---------- */
    push('## 五、配方明细（供核对输入）');
    push('');
    pushDetail(push, '麦芽与谷物', fermentableLines(r), r.fermentables, detailMax, omissions);
    pushDetail(push, '酒花', hopLines(r, c), r.hops, detailMax, omissions);
    pushDetail(push, '酵母', yeastLines(r), r.yeasts, detailMax, omissions);
    pushDetail(push, '辅料', adjunctLines(r), r.adjuncts, detailMax, omissions);
    pushWater(push, r, c);
    pushMash(push, r);

    /* ---------- 口径与限制 ---------- */
    push('## 六、口径与限制');
    push('');
    push('- 本报告由 ' + versionLine() + ' 自动生成，未经人工编辑；数值为标称估算。');
    push('- 报告字符上限 ' + MAX_REPORT + ' 字符。' +
      (omissions.length
        ? '本次有 ' + omissions.length + ' 处省略：' + omissions.join('；') + '。'
        : '本次未发生省略（检查项与明细都完整）。'));
    push('- 未包含：批次实测比重曲线、品鉴记录、成本与库存流水明细；这些在软件内各自的页面。');
    push('- 如果要给调整建议，请以「配方摘要 + 检查结果」为主；明细用于核对原料用量是否填错。');
    push('');

    var text = L.join('\n');

    /* 第一轮收缩：明细每组的行数减半、检查项减半。
       只收缩一次——第二次仍然超长就不再递归，直接按上限切并写明切了多少，
       否则 detailMax / checksMax 触底之后会无限递归。 */
    if (text.length > MAX_REPORT && !opts._retry) {
      return buildReport({
        snap: snap,
        detailMax: Math.max(2, Math.floor(detailMax / 2)),
        checksMax: Math.max(6, Math.floor(checksMax / 2)),
        _retry: true
      });
    }
    if (text.length > MAX_REPORT) {
      var cut = MAX_REPORT - 160;
      var tail = '\n\n> （报告已达 ' + MAX_REPORT + ' 字符上限，末尾 ' +
        (text.length - cut) + ' 字符已省略。）';
      return text.slice(0, cut) + tail;
    }
    return text;
  }

  function whereText(ck) {
    var t = ck.target;
    if (!t) return '';
    if (t.act === 'save') return '文件 → 保存配方（Ctrl+S 之外的唯一正式入库动作）';
    if (t.view === 'recipe') {
      var m = {
        '#f-name': '配方 → 基本信息 → 配方名称',
        '#f-style': '配方 → 基本信息 → 啤酒风格',
        '[data-rows="fermentables"]': '配方 → 麦芽与谷物',
        '[data-rows="hops"]': '配方 → 酒花',
        '[data-rows="yeasts"]': '配方 → 酵母与发酵',
        '[data-rows="adjuncts"]': '配方 → 辅料与其他添加',
        '#water-summary': '配方 → 水化学',
        '#mash-summary': '配方 → 糖化方案',
        '#warn-block': '配方 → 右侧指标卡的「检查项」',
        '#style-match': '配方 → 右侧指标卡的「风格匹配」'
      };
      return m[t.sel] || ('配方 → ' + (t.sel || ''));
    }
    if (t.view === 'ingredient') return '原料库 → 库存';
    if (t.view === 'batch') return '酿造记录 → 批次列表';
    return t.view || '';
  }

  function pushDetail(push, title, lines, rows, max, omissions) {
    var total = (rows || []).length;
    push('### ' + title + '（' + total + ' 行）');
    push('');
    if (!total) {
      push('- 无');
      push('');
      return;
    }
    var show = Math.min(total, max);
    for (var i = 0; i < show; i++) push(lines[i]);
    if (total > show) {
      omissions.push('「' + title + '」共 ' + total + ' 行，只列了前 ' + show + ' 行，省略后 ' + (total - show) + ' 行');
      push('- …（本组共 ' + total + ' 行，已省略后 ' + (total - show) +
        ' 行；完整明细见软件「配方设计」里的' + title + '表）');
    }
    push('');
  }

  function fermentableLines(r) {
    var rows = r.fermentables || [];
    var totalKg = 0;
    for (var i = 0; i < rows.length; i++) totalKg += num(rows[i].amount, 0);
    return rows.map(function (f) {
      var pct = totalKg > 0 ? num(f.amount, 0) / totalKg * 100 : 0;
      return '- ' + (f.name || '未命名') + ' · ' + fmt(f.amount, 2) + ' ' + (f.unit || 'kg') +
        '（占投料 ' + fmt(pct, 1) + '%）· ' + fmt(f.lov, 0) + ' °L · ' + fmt(f.ppg, 0) + ' ppg' +
        (f.cat ? ' · ' + catLabel(f.cat) : '');
    });
  }

  function ibuOf(list, h) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it) continue;
      if (it.name === h.name && Math.abs(num(it.amount) - num(h.amount)) < 1e-6 &&
        Math.abs(num(it.time) - num(h.time)) < 1e-6) return num(it.ibu, 0);
    }
    return null;
  }

  function hopLines(r, c) {
    var rows = r.hops || [];
    return rows.map(function (h) {
      var isDry = h.stage === 'dryhop';
      var ib = ibuOf(c && c.ibuContribution, h);
      var stage = (UI.stageLabel ? UI.stageLabel(h.stage) : h.stage) || h.stage;
      return '- ' + (h.name || '未命名') + ' · ' + fmt(h.amount, 1) + ' ' + (h.unit || 'g') +
        ' · α ' + fmt(h.aa, 1) + '% · ' +
        (isDry ? stage + '（不产生苦度）' : stage + ' ' + fmt(h.time, 0) + ' min') +
        (!isDry && ib !== null ? ' · 贡献 ' + fmt(ib, 1) + ' IBU' : '');
    });
  }

  function yeastLines(r) {
    return (r.yeasts || []).map(function (y) {
      return '- ' + (y.name || '未选菌株') + ' · ' + fmt(y.amount, 1) + ' ' + (y.unit || 'g') +
        ' · 标称衰减 ' + fmt(y.att, 0) + '% · ' + fmt(y.tempC, 0) + ' °C' +
        (y.type ? ' · ' + (y.type === 'lager' ? '拉格' : y.type === 'ale' ? '艾尔' : y.type) : '');
    });
  }

  function adjunctLines(r) {
    return (r.adjuncts || []).map(function (a) {
      return '- ' + (a.name || '未命名') + ' · ' + fmt(a.amount, 1) + ' ' + (a.unit || 'g') +
        ' · ' + ((UI.stageLabel ? UI.stageLabel(a.stage) : a.stage) || a.stage || '') +
        (a.note ? ' · ' + a.note : '');
    });
  }

  function pushWater(push, r, c) {
    var w = r.water || {};
    var src = w.source || {};
    var salts = w.salts || [];
    var anySrc = num(src.ca) + num(src.mg) + num(src.na) + num(src.cl) + num(src.so4) + num(src.hco3) > 0;
    if (!anySrc && !salts.length) {
      push('### 水（未填写）');
      push('');
      push('- 源水与盐类都没填，计算按离子接近 0 的纯水处理；水化学相关检查本次不生效。');
      push('');
      return;
    }
    push('### 水（源水 + 盐类）');
    push('');
    if (anySrc) {
      push('- 源水：Ca ' + fmt(src.ca, 0) + ' / Mg ' + fmt(src.mg, 0) + ' / Na ' + fmt(src.na, 0) +
        ' / Cl ' + fmt(src.cl, 0) + ' / SO₄ ' + fmt(src.so4, 0) + ' / HCO₃ ' + fmt(src.hco3, 0) + ' mg/L');
    }
    if (salts.length) {
      var parts = salts.map(function (s) {
        return (s.name || s.id || '盐') + ' ' + fmt(s.amount, 1) + ' ' + (s.unit || 'g');
      });
      push('- 盐类：' + parts.join('、'));
    }
    var fw = c.water || {};
    push('- 成品水估算：Ca ' + fmt(fw.ca, 0) + ' / Mg ' + fmt(fw.mg, 0) + ' / Na ' + fmt(fw.na, 0) +
      ' / Cl ' + fmt(fw.cl, 0) + ' / SO₄ ' + fmt(fw.so4, 0) +
      ' mg/L · SO₄:Cl ' + fmt(fw.so4clRatio, 2) + ' · 估算糖化 pH ' + fmt(fw.mashPhEstimate, 2));
    push('');
  }

  function pushMash(push, r) {
    var steps = ((r.mash || {}).steps) || [];
    push('### 糖化（' + steps.length + ' 步）');
    push('');
    if (!steps.length) push('- 无');
    for (var i = 0; i < steps.length; i++) {
      push('- ' + (steps[i].name || '休止') + ' · ' + fmt(steps[i].tempC, 0) + ' °C · ' +
        fmt(steps[i].minutes, 0) + ' min');
    }
    push('');
  }

  /** 对外：返回报告文本（默认取当前面板那一份，保证"复制到的 = 看到的"） */
  RP.report = function (opts) {
    return buildReport(opts || {});
  };

  /* ======================================================================
   * 7. 面板
   * ====================================================================*/

  function levelIcon(level) {
    if (level === 'error') return 'alert';
    if (level === 'warn') return 'alert';
    return 'info';
  }

  function checkHtml(ck) {
    var loc = whereText(ck);
    return '<div class="alert alert--' + attr(ck.level === 'info' ? 'info' : ck.level) + '" ' +
      'data-check="' + attr(ck.id) + '" style="align-items:flex-start">' +
      '<span class="alert__icon">' + icon(levelIcon(ck.level), 13) + '</span>' +
      '<div style="min-width:0">' +
        '<div class="u-sm" style="font-weight:600;line-height:1.45">' + esc(ck.title) + '</div>' +
        '<div class="u-xs" style="margin-top:3px;line-height:1.6;color:var(--tx-2)">' +
          '<b>判定依据</b>：' + esc(ck.basis) + '</div>' +
        '<div class="u-xs u-dim" style="margin-top:3px">来源：' + esc(ck.source) + '</div>' +
        (ck.fix ? '<div class="u-xs u-dim" style="margin-top:2px">建议：' + esc(ck.fix) + '</div>' : '') +
        (ck.target
          ? '<button type="button" class="btn btn-ghost btn-sm" data-rp-go="' + ck.ref + '" ' +
            'style="margin-top:6px" title="' + attr(loc || '去处理') + '">去处理</button>'
          : '') +
      '</div></div>';
  }

  function doneMap(recipeId) {
    var all = null;
    try { all = UI.store.get(DONE_KEY, null); } catch (e) { all = null; }
    if (!all || typeof all !== 'object' || !recipeId) return {};
    var m = all[recipeId];
    return (m && typeof m === 'object') ? m : {};
  }

  function setDone(recipeId, stepKey, sig, on) {
    if (!recipeId) return;
    var all = null;
    try { all = UI.store.get(DONE_KEY, null); } catch (e) { all = null; }
    if (!all || typeof all !== 'object') all = {};
    if (!all[recipeId] || typeof all[recipeId] !== 'object') all[recipeId] = {};
    if (on) all[recipeId][stepKey] = sig;
    else delete all[recipeId][stepKey];
    try { UI.store.set(DONE_KEY, all); } catch (e2) { /* 存不下就只影响这一次的勾 */ }
  }

  function stepsHtml(snap) {
    if (!snap.steps.length) {
      return '<div class="alert alert--ok"><span class="alert__icon">' + icon('check', 13) +
        '</span><span>没有待办：配方已是可保存的状态。</span></div>';
    }
    var done = doneMap(snap.recipeId);
    var html = '';
    for (var i = 0; i < snap.steps.length; i++) {
      var stp = snap.steps[i];
      var checked = done[stp.key] === stp.title;
      html += '<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;' +
          'border:1px solid var(--line);border-radius:6px;background:var(--bg-2)">' +
        '<input type="checkbox" data-rp-done="' + i + '"' + (checked ? ' checked' : '') +
          ' aria-label="标记「' + attr(stp.title) + '」为已完成" style="margin-top:3px;flex:0 0 auto">' +
        '<div style="min-width:0;flex:1 1 auto">' +
          '<div class="u-sm" style="font-weight:600;line-height:1.45' +
            (checked ? ';text-decoration:line-through;color:var(--tx-3)' : '') + '">' +
            (i + 1) + '. ' + esc(stp.title) + '</div>' +
          '<div class="u-xs u-dim" style="margin-top:2px;line-height:1.55">依据：' + esc(stp.basis) + '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-rp-step="' + i + '">去处理</button>' +
      '</div>';
    }
    return html;
  }

  function panelHtml(snap) {
    var s = snap.stats;
    var rr = snap.recipe;
    var c = snap.calc;
    var head = '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">' +
      '<span class="tag">错误 ' + s.error + '</span>' +
      '<span class="tag">警告 ' + s.warn + '</span>' +
      '<span class="tag">建议 ' + s.info + '</span>' +
      '<span class="u-xs u-dim">通过 ' + s.pass + ' 项区间判定 · 运行于 ' +
        esc(UI.dt(snap.at, true)) + '</span>' +
      '</div>' +
      '<div class="u-mono u-xs u-dim" style="margin-top:6px;line-height:1.6">' +
        'OG ' + sg(c.og) + ' · FG ' + sg(c.fg) + ' · ABV ' + fmt(c.abv, 1) + '% · IBU ' +
        fmt(c.ibu, 0) + ' · SRM ' + fmt(c.srm, 1) + ' · BU:GU ' + fmt(c.buGu, 2) +
        ' · ' + fmt(rr.batchSize, 1) + ' L / 效率 ' + fmt(rr.efficiency, 0) + '%' +
      '</div>';

    /* 检查结果按等级分组 */
    var groups = { error: [], warn: [], info: [] };
    for (var i = 0; i < snap.checks.length; i++) {
      var g = groups[snap.checks[i].level];
      if (g) g.push(snap.checks[i]);
    }
    var names = { error: '错误', warn: '警告', info: '建议' };
    var checksHtml = '';
    if (!snap.checks.length) {
      checksHtml = '<div class="alert alert--ok"><span class="alert__icon">' + icon('check', 13) +
        '</span><span>没有发现问题。输入范围、风格区间、可行性告警、库存与批次都通过。</span></div>';
    } else {
      ['error', 'warn', 'info'].forEach(function (lv) {
        if (!groups[lv].length) return;
        checksHtml += '<div class="u-xs u-dim" style="letter-spacing:.6px;margin:2px 0 2px">' +
          names[lv] + ' · ' + groups[lv].length + '</div><div class="alerts">';
        for (var k = 0; k < groups[lv].length; k++) checksHtml += checkHtml(groups[lv][k]);
        checksHtml += '</div>';
      });
    }

    var saved = savedOf(snap.recipeId);
    var diff = saved ? diffRecipe(rr, saved) : null;
    var resetHtml = '';
    if (saved && diff && diff.total > 0) {
      resetHtml = '<button type="button" class="btn btn-ghost btn-sm" data-rp-reset="1" ' +
        'style="align-self:flex-start">重置到已保存的第 ' + (saved.rev || 1) + ' 版（撤销 ' +
        diff.total + ' 处修改）</button>';
    }

    return '<div data-rp="1" data-copy-path="' + attr(lastCopyPath) + '">' +
      head +
      '<div style="display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px;margin-top:12px">' +
        /* 检查结果自己滚：条目多的时候（20 行酒花的配方能有十几条）不能把
           底部的「复制报告」顶出屏幕——那正是这个面板唯一的出口。 */
        '<div class="stack" style="gap:8px;max-height:56vh;overflow-y:auto;padding-right:4px">' +
          '<div class="u-xs u-dim" style="letter-spacing:.6px">检查结果 · ' + snap.checks.length + ' 条</div>' +
          checksHtml +
        '</div>' +
        '<div class="stack" style="gap:8px">' +
          '<div class="u-xs u-dim" style="letter-spacing:.6px">下一步 · 当前最该做的 ' +
            Math.min(MAX_STEPS, snap.steps.length) + ' 件事</div>' +
          '<div class="stack" data-rp-steps="1" style="gap:6px">' + stepsHtml(snap) + '</div>' +
          resetHtml +
          '<div class="alert alert--info"><span class="alert__icon">' + icon('info', 13) + '</span>' +
            '<span class="u-xs" style="line-height:1.6">「复制报告」得到一份自包含的 Markdown：' +
            '含版本、计算口径、各项判定依据与原料明细，可以直接粘给别的 AI 问「我哪里错了」。' +
            '报告过长时会按上限省略，并写明省略了什么。</span></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderPanel() {
    if (!panelAlive()) return;
    if (!last) last = buildSnapshot();
    panel.body.innerHTML = panelHtml(last);
  }

  function findRef(i) {
    if (!last || !last.refs) return null;
    var t = last.refs[i];
    return t || null;
  }

  /* ------------- 跳转（视图 → 元素 → 滚动 → 高亮） ------------- */

  function whenView(viewId, sel, fn, tries) {
    tries = tries || 0;
    var Shell = UI.Shell;
    if (!Shell) return;
    if (Shell.activeId() !== viewId) {
      if (tries === 0) Shell.go(viewId);
      if (tries > 60) { toast('没能切换到「' + viewId + '」视图', 'warn'); return; }
      root.setTimeout(function () { whenView(viewId, sel, fn, tries + 1); }, 45);
      return;
    }
    var el = sel ? document.querySelector(sel) : null;
    if (sel && !el) {
      if (tries > 60) { toast('目标位置没找到：' + sel, 'warn', 4200); return; }
      root.setTimeout(function () { whenView(viewId, sel, fn, tries + 1); }, 45);
      return;
    }
    try { fn(el); } catch (e) { /* 单个跳转失败不该把面板带崩 */ }
  }

  function flashCard(card) {
    if (!card) return;
    card.classList.add('is-lp-flash');
    if (flashTimer) root.clearTimeout(flashTimer);
    flashTimer = root.setTimeout(function () {
      card.classList.remove('is-lp-flash');
      flashTimer = 0;
    }, 1200);
  }

  function goto(t) {
    if (!t) return;
    if (t.act === 'save') {
      if (BREW.Bus && BREW.Bus.emit) BREW.Bus.emit('requestSave');
      toast('已请求保存：配方名称为空时会先要求命名', 'info', 3600);
      return;
    }
    if (!t.view) return;
    var waitSel = t.click || t.sel || null;
    whenView(t.view, waitSel, function (el) {
      if (t.click && el && el.click) el.click();
      var node = t.sel ? document.querySelector(t.sel) : el;
      var card = node && node.closest ? node.closest('section.card') : null;
      var target = card || node;
      if (target) {
        try { target.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { target.scrollIntoView(); }
        var view = document.getElementById('view');
        if (view) view.scrollTop = Math.max(0, view.scrollTop - 8);
        flashCard(card);
      }
      if (t.focus && node && node.focus) { try { node.focus({ preventScroll: true }); } catch (e2) { node.focus(); } }
    });
  }

  function onPanelClick(e) {
    var node = e.target;
    while (node && node !== document) {
      if (node.getAttribute) {
        var go = node.getAttribute('data-rp-go');
        if (go !== null && go !== undefined) {
          var t = findRef(num(go, -1));
          if (t) { closePanel(); goto(t); }
          return;
        }
        var step = node.getAttribute('data-rp-step');
        if (step !== null && step !== undefined) {
          var st = last && last.steps[num(step, -1)];
          if (st) { setDone(last.recipeId, st.key, st.title, true); closePanel(); goto(st.target); }
          return;
        }
        if (node.getAttribute('data-rp-reset')) { doReset(); return; }
      }
      node = node.parentNode;
    }
  }

  function onPanelChange(e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var idx = el.getAttribute('data-rp-done');
    if (idx === null || idx === undefined) return;
    var st = last && last.steps[num(idx, -1)];
    if (!st) return;
    setDone(last.recipeId, st.key, st.title, !!el.checked);
    /* 只重画"下一步"那一段：整块重绘会让勾选框失焦，键盘用户要重新找位置 */
    var box = panelAlive() ? panel.query('[data-rp-steps]') : null;
    if (box) box.innerHTML = stepsHtml(last);
  }

  RP.open = function (opts) {
    opts = opts || {};
    closePanel();
    if (opts.run !== false || !last || (last.recipeId !== (recipe() || {}).id)) {
      last = buildSnapshot();
    }
    var r = recipe();
    panel = UI.Shell.modal({
      title: '运行检查 · ' + ((r && r.name) || '未命名配方'),
      sub: '体检清单，不是重算',
      size: 'wide',
      body: panelHtml(last),
      actions: [
        { label: '关闭', kind: 'ghost' },
        {
          label: '报告全文', kind: 'ghost',
          act: function () { openReportModal(); return false; }
        },
        {
          label: '复制报告', kind: 'primary',
          act: function () { RP.copy(); return false; }
        },
        {
          label: '重新运行', kind: 'ghost',
          act: function () { last = buildSnapshot(); renderPanel(); toast('已重新检查：' + summarize(last.stats), 'ok', 2600); return false; }
        }
      ]
    });
    if (!panel) { toast('控制面板打不开（模态框挂载点缺失）', 'warn'); return null; }
    var body = panel.body;
    body.addEventListener('click', onPanelClick);
    body.addEventListener('change', onPanelChange);
    /* 从功能区「下一步」进来的：焦点直接落到第一条待办上，
       不用用户在一屏里自己找。 */
    if (opts.focusSteps) {
      var firstStep = body.querySelector('[data-rp-step]');
      if (firstStep) {
        root.setTimeout(function () {
          try { firstStep.focus({ preventScroll: true }); } catch (e) { try { firstStep.focus(); } catch (e2) { /* ignore */ } }
        }, 80);
      }
    }
    return panel;
  };

  function closePanel() {
    if (panel) { try { panel.close(); } catch (e) { /* 已经关了 */ } }
    panel = null;
  }
  RP.close = closePanel;

  function summarize(s) {
    return '错误 ' + s.error + ' · 警告 ' + s.warn + ' · 建议 ' + s.info + ' · 通过 ' + s.pass + ' 项';
  }

  /* ======================================================================
   * 8. 报告全文（可全选的 textarea）
   * ====================================================================*/

  function openReportModal(selectAll) {
    var text = buildReport({});
    /* 必须先关面板：这个工程的 modal-root 是 grid + place-items:center，
       两个 .modal 同时在场会**上下排开**（不是叠放），第二个会被挤到视口外。
       所以"看全文"是从面板切走，不是叠一层。 */
    closePanel();
    if (reportAlive()) { try { reportModal.close(); } catch (e) { /* 已经关了 */ } }
    reportModal = null;
    reportModal = UI.Shell.modal({
      title: '体检报告（Markdown）',
      sub: text.length + ' 字符',
      size: 'wide',
      body: '<div data-rp-report="1">' +
        '<p class="u-xs u-dim" style="margin:0 0 8px">下面这段文字是自包含的：把它整个复制走，' +
        '对方不需要打开这个软件也能看懂问题在哪。</p>' +
        '<textarea id="rp-report-text" readonly wrap="soft" ' +
          'style="width:100%;height:46vh;font-family:var(--num);font-size:13px;line-height:1.6;' +
          'background:var(--bg-inset);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;' +
          'padding:10px 12px;resize:vertical">' + esc(text) + '</textarea>' +
        '<div class="u-xs u-dim" data-rp-report-len="' + text.length + '" style="margin-top:6px">' +
          '长度上限 ' + MAX_REPORT + ' 字符' +
          (text.length >= MAX_REPORT - 1 ? '（已达上限，报告里写明了省略了什么）' : '') + '</div>' +
        '</div>',
      actions: [
        { label: '关闭', kind: 'ghost' },
        {
          label: '复制这段', kind: 'primary',
          act: function () { RP.copy(); return false; }
        }
      ],
      onMount: function (api) {
        var ta = api.query('#rp-report-text');
        if (!ta) return;
        root.setTimeout(function () {
          try { ta.focus(); if (selectAll !== false) ta.select(); } catch (e) { /* ignore */ }
        }, 40);
      }
    });
    return reportModal;
  }
  RP.openReport = openReportModal;

  /* ======================================================================
   * 9. 复制（三级：clipboard → execCommand → 全选 textarea）
   * ====================================================================*/

  function execCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-2000px';
    ta.style.left = '-2000px';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.focus();
      ta.select();
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    return !!ok;
  }

  /**
   * @returns {Promise<string>} 'clipboard' | 'exec' | 'manual'
   * 为什么要有第三级：file:// 下 Chrome 的 navigator.clipboard 常常存在但
   * writeText 会以"没有用户手势/文档未聚焦"拒绝；execCommand 也依赖用户手势。
   * 两条都失败时，唯一可靠的路是"把文本全选好，让用户按 Ctrl+C"。
   */
  function copyText(text) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(p) { if (settled) return; settled = true; resolve(p); }

      function viaExec() { finish(execCopy(text) ? 'exec' : 'manual'); }

      try {
        if (root.navigator && root.navigator.clipboard &&
          typeof root.navigator.clipboard.writeText === 'function') {
          root.navigator.clipboard.writeText(text).then(
            function () { finish('clipboard'); },
            function () { viaExec(); }
          );
          /* 有的环境里 writeText 既不 resolve 也不 reject（权限对话框被吞掉）。
             1.2 秒没动静就走兜底，不能让按钮看起来"点了没反应"。 */
          root.setTimeout(function () { if (!settled) viaExec(); }, 1200);
          return;
        }
      } catch (e) { /* 落到兜底 */ }
      viaExec();
    });
  }

  function selectReportText() {
    var ta = reportAlive() && reportModal.query ? reportModal.query('#rp-report-text') : null;
    if (!ta) return false;
    try { ta.focus(); ta.select(); return true; } catch (e) { return false; }
  }

  /** 把"走了哪条复制路"写到当前看到的那个弹层上（自证用） */
  function markCopy(api, path) {
    if (!api || !api.el) return;
    api.el.setAttribute('data-copy-path', path);
    var box = api.query ? api.query('[data-rp], [data-rp-report]') : null;
    if (box) box.setAttribute('data-copy-path', path);
  }

  RP.copy = function () {
    var text = (last ? buildReport({ snap: last }) : buildReport({}));
    return copyText(text).then(function (path) {
      lastCopyPath = path;
      if (path === 'manual') {
        /* 手工兜底：把报告摊开、全选。已经在看报告就只重新全选，不再开一层。 */
        if (reportAlive()) selectReportText();
        else { openReportModal(true); }
        toast('浏览器没有授予剪贴板权限：报告已全选，按 Ctrl+C 复制', 'info', 5600);
      } else {
        toast('报告已复制（' + (path === 'clipboard' ? '系统剪贴板' : '兼容复制') +
          ' · ' + text.length + ' 字符）', 'ok', 3000);
      }
      markCopy(panelAlive() ? panel : null, path);
      markCopy(reportAlive() ? reportModal : null, path);
      return path;
    });
  };
  RP.copyPath = function () { return lastCopyPath; };

  /* ======================================================================
   * 10. 重置：回到最后一次保存
   * ----------------------------------------------------------------------
   * 不是"清空"。清空是「新建」的事，而且清空以后没有任何东西可恢复；
   * 「重置」必须能说清"会丢掉哪几处修改"，否则用户不敢点。
   * ====================================================================*/

  var SCALARS = [
    ['name', '配方名称', 'text'],
    ['styleId', '啤酒风格', 'style'],
    ['batchSize', '批次量', 'num1'],
    ['efficiency', '糖化效率', 'num0'],
    ['evaporationRate', '蒸发率', 'num0'],
    ['boilTime', '煮沸时长', 'num0'],
    ['trubLoss', '沉渣损失', 'num1'],
    ['mashThickness', '水料比', 'num1'],
    ['fermentTemp', '发酵温度', 'num0'],
    ['notes', '备注', 'text'],
    ['carbonation.targetVol', '碳化度', 'num1'],
    ['carbonation.tempC', '碳化计算温度', 'num0']
  ];

  var ARRAYS = [
    ['fermentables', '麦芽', 'amount'],
    ['hops', '酒花', 'amount'],
    ['yeasts', '酵母', 'amount'],
    ['adjuncts', '辅料', 'amount'],
    ['water.salts', '盐类', 'amount'],
    ['mash.steps', '糖化步骤', 'minutes']
  ];

  function getPath(obj, path) {
    var parts = String(path).split('.');
    var o = obj;
    for (var i = 0; i < parts.length; i++) {
      if (o === null || o === undefined) return undefined;
      o = o[parts[i]];
    }
    return o;
  }

  function fmtScalar(kind, v, path) {
    if (kind === 'style') {
      var st = styleOf(v);
      return st ? (st.id + ' ' + st.name) : (v ? String(v) : '（未指定）');
    }
    if (kind === 'text') {
      var s = String(v === null || v === undefined ? '' : v);
      return s.length > 14 ? s.slice(0, 14) + '…' : (s || '（空）');
    }
    if (kind === 'num0') return fmt(v, 0);
    return fmt(v, 1);
  }

  function scalarChanged(kind, a, b) {
    /* 文本与风格 id 都是字符串：styleId 走 num() 会变成 0，永远判"没变" */
    if (kind === 'text' || kind === 'style') return String(a === null || a === undefined ? '' : a) !==
      String(b === null || b === undefined ? '' : b);
    return num(a, 0) !== num(b, 0);
  }

  /** 当前工作副本与已保存版本的差异；返回 {total, texts} */
  RP.diff = diffRecipe;
  function diffRecipe(cur, saved) {
    var texts = [];
    if (!cur || !saved) return { total: 0, texts: texts };

    for (var i = 0; i < SCALARS.length; i++) {
      var key = SCALARS[i][0], label = SCALARS[i][1], kind = SCALARS[i][2];
      var a = getPath(cur, key), b = getPath(saved, key);
      if (scalarChanged(kind, a, b)) {
        texts.push(label + ' ' + fmtScalar(kind, b, key) + ' → ' + fmtScalar(kind, a, key));
      }
    }

    for (var j = 0; j < ARRAYS.length; j++) {
      var path = ARRAYS[j][0], name = ARRAYS[j][1], field = ARRAYS[j][2];
      var ca = getPath(cur, path) || [];
      var cb = getPath(saved, path) || [];
      var added = 0, removed = 0, changed = 0;
      var n = Math.max(ca.length, cb.length);
      for (var k = 0; k < n; k++) {
        var ra = ca[k], rb = cb[k];
        if (!ra && rb) { removed++; continue; }
        if (ra && !rb) { added++; continue; }
        if (!ra || !rb) continue;
        if (JSON.stringify(stripRow(ra)) !== JSON.stringify(stripRow(rb))) changed++;
      }
      if (!added && !removed && !changed) continue;
      var bits = [];
      if (added) bits.push('新增 ' + added + ' 行');
      if (removed) bits.push('删除 ' + removed + ' 行');
      if (changed) bits.push('改动 ' + changed + ' 行');
      texts.push(name + ' ' + bits.join('、'));
    }

    /* 源水离子：整组算一处（改一个离子通常就是换了一次水源） */
    var ionKeys = ['ca', 'mg', 'na', 'cl', 'so4', 'hco3'];
    var ionChanged = 0;
    for (var m = 0; m < ionKeys.length; m++) {
      var va = num(getPath(cur, 'water.source.' + ionKeys[m]), 0);
      var vb = num(getPath(saved, 'water.source.' + ionKeys[m]), 0);
      if (va !== vb) ionChanged++;
    }
    if (ionChanged) texts.push('水质离子 ' + ionChanged + ' 项');

    /* total 的单位是"处"：标量 1 处 = 1 个字段；数组 1 处 = 1 行 */
    var total = 0;
    for (var t = 0; t < SCALARS.length; t++) {
      var kk = SCALARS[t][0], kd = SCALARS[t][2];
      if (scalarChanged(kd, getPath(cur, kk), getPath(saved, kk))) total++;
    }
    for (var u = 0; u < ARRAYS.length; u++) {
      var p2 = ARRAYS[u][0];
      var aa = getPath(cur, p2) || [], bb = getPath(saved, p2) || [];
      var nn = Math.max(aa.length, bb.length);
      for (var v = 0; v < nn; v++) {
        if (!aa[v] || !bb[v]) { total++; continue; }
        if (JSON.stringify(stripRow(aa[v])) !== JSON.stringify(stripRow(bb[v]))) total++;
      }
    }
    if (ionChanged) total += ionChanged;

    return { total: total, texts: texts };
  }

  /* 行比较时剔掉 id 之外的易变字段（单位、显示用字段不变，id 是身份不能剔）
     实际上行是快照对象，直接全量比即可；这里只剔除 undefined，保证两次
     JSON.stringify 的键顺序一致（同一份 normalize 产出，键序稳定）。 */
  function stripRow(row) {
    var out = {};
    for (var k in row) {
      if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
      if (row[k] === undefined) continue;
      out[k] = row[k];
    }
    return out;
  }

  function applyReset(saved, diff) {
    var clone = UI.clone(saved);
    UI.setRecipe(clone);
    try {
      UI.publish();
    } catch (e) {
      if (UI.reportError) UI.reportError(e, 'runpanel.reset');
    }
    if (UI.Shell && typeof UI.Shell.refresh === 'function') {
      try { UI.Shell.refresh(); } catch (e2) { /* 视图重绘失败不影响数据已回滚 */ }
    }
    toast('已回到保存的第 ' + (saved.rev || 1) + ' 版，撤销 ' + diff.total + ' 处修改', 'ok', 3600);
    if (panelAlive()) { last = buildSnapshot(); renderPanel(); }
    return true;
  }

  RP.reset = function (opts) {
    opts = opts || {};
    var r = recipe();
    if (!r) { toast('没有打开的配方', 'warn'); return { ok: false, reason: 'no-recipe' }; }
    var saved = savedOf(r.id);
    if (!saved) {
      toast('这份配方还没保存过：没有可回到的版本。想清空请用「新建」。', 'info', 5200);
      return { ok: false, reason: 'unsaved' };
    }
    var diff = diffRecipe(r, saved);
    if (!diff.total) {
      toast('当前内容与已保存的第 ' + (saved.rev || 1) + ' 版一致，没有需要撤销的修改。', 'info', 4200);
      return { ok: false, reason: 'clean' };
    }

    var detail = diff.texts.slice(0, 5).join('；') + (diff.texts.length > 5 ? ' 等' : '');
    UI.Shell.confirm({
      title: '重置到上次保存？',
      message: '将丢弃 ' + diff.total + ' 处未保存的修改，回到已保存的第 ' +
        (saved.rev || 1) + ' 版《' + (saved.name || '未命名配方') + '》。此操作不能撤销。',
      detail: '会撤销：' + detail,
      okLabel: '丢弃修改并重置',
      danger: true
    }, function () {
      applyReset(saved, diff);
    });
    return { ok: true, pending: true, total: diff.total };
  };

  /* 面板里的「重置」入口走同一个函数 */
  function doReset() { RP.reset(); }

  /* ======================================================================
   * 11. 快捷键与启动
   * ====================================================================*/

  function initKeys() {
    if (document._runpanelKeys) return;
    document._runpanelKeys = true;
    document.addEventListener('keydown', function (e) {
      /* Ctrl/Cmd + Enter = 运行。为什么用这个组合：
         它不占浏览器任何默认行为，且与"执行"的通用心智一致（MATLAB/Julia）。
         焦点在输入框里也生效——用户刚改完一个数字就想跑一遍是常见动线。 */
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key !== 'Enter') return;
      if (document.querySelector('#modal-root .modal')) return;   /* 模态框里不抢 */
      e.preventDefault();
      RP.open({ run: true });
    });
  }

  RP.init = function () { initKeys(); };

  /* 脚本载入即挂键盘监听：本文件在 40 之后加载，document 已可用 */
  initKeys();

})(typeof window !== 'undefined' ? window : globalThis);
