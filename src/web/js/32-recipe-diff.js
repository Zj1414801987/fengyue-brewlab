/* ============================================================================
 * 风月酿研所 — 32 配方差异对比（Recipe Diff）
 * ----------------------------------------------------------------------------
 * 比的是**两份配方对象**，不是操作日志。
 *
 * 第三个来源「历史版本」v1.2 已经落地：00-core 在 saveRecipe 里往 `versions[recipeId]`
 * 归档快照（每配方常规 ≤5 条；700K / 900K / 1.0M 三档水位自动压到 5 / 2 / 1 条；
 * 单条超 8K 先裁剪标 partial，裁完仍超 16K 就 rec:null 只记账）。实测单条中位 1.5K、
 * 最大 2.3K（11 份样本），20 配方满 5 版约 154–230K，离 L0 水位 700K 还有数倍余量。
 *
 * ⚠️ v1.1 在这里写过「要做真历史就得归档快照，50 份 × 10 版 = 1.3MB，会顶到 5MB 天花板」。
 * 那句话**已经过期**，别再据此判定"历史做不了"——现在能存，只是水位到了自动压条数。
 *
 * 所以本模块回答三个真实问题（第三个由 43 组装，本模块仍然只吃两份对象）：
 *   「这份和已保存的那份差在哪」   —— 工作副本 vs 同 id 的存档
 *   「这两份配方差在哪」           —— 任意两份（含经典库载入的副本）
 *   「第 3 版和第 5 版差在哪」     —— versions[id][i].rec vs versions[id][j].rec
 *
 * 历史条目的三条语义（调用方必须守住，别当成"可以简化"）：
 *   · `rec === null`（oversize）**不能**传进来比——会得出"删光了所有原料"
 *   · `partial: true` 缺 water/mash/carbonation，对应段落走 `unavailable`，不是"被删除"
 *   · 没有 notes 原文，备注差异只能表达成"320 → 410 字，有改动"
 *
 * 差异粒度：
 *   · 原料行按 row.id 对齐（没有 id 的老数据退化为按名字对齐），给出增/删/改量
 *   · 设备参数与水质离子做字段级对比
 *   · 糖化步骤按 index 逐条对齐（v1.4 补）：温度/时间**各出一行**，
 *     未变的步骤不出现；条数不同时多出来的出「新增第 N 步 / 删除第 N 步」。
 *     温度用绝对阈值（0.05°C）、不给百分比——66→67 只有 1.5%，
 *     按比例判断会把它吞掉，而 1°C 就是可感知的酒体差异（见 diffMashSteps）
 *   · 指标（OG/FG/ABV/IBU/SRM/BU:GU/衰减）由调用方传进来的两次 calc 结果对比——
 *     本模块**不自己算**，避免和 20-calc 出现第二套口径
 *
 * 纯度：只吃入参、只吐返回值。不读 DOM / Store，不取当前时间。
 *
 * 前置依赖：00-core（可选）
 * 加载位置：应在 js/30-recipe.js 之后、js/35-batch.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var RecipeDiff = BREW.RecipeDiff = {};

  var U = (BREW.Util && typeof BREW.Util.round === 'function') ? BREW.Util : {
    toNum: function (v, d) {
      var n = parseFloat(v);
      return isFinite(n) ? n : (d === undefined ? 0 : d);
    },
    round: function (v, d) {
      var p = Math.pow(10, d || 0);
      return Math.round(v * p) / p;
    }
  };

  var KINDS = ['fermentables', 'hops', 'yeasts', 'adjuncts'];

  var KIND_LABEL = {
    fermentables: '麦芽与谷物',
    hops: '酒花',
    yeasts: '酵母',
    adjuncts: '辅料'
  };

  /* 每种行的可比字段：key / 中文名 / 小数位 / 判定阈值 */
  var ROW_FIELDS = {
    fermentables: [
      { k: 'amount', label: '用量', d: 3, eps: 0.001, unit: 'kg' },
      { k: 'ppg', label: 'ppg', d: 1, eps: 0.05 },
      { k: 'lov', label: '色度', d: 1, eps: 0.05, unit: '°L' },
      { k: 'cat', label: '分类', text: true }
    ],
    hops: [
      { k: 'amount', label: '用量', d: 3, eps: 0.01, unit: 'g' },
      { k: 'aa', label: 'α酸', d: 2, eps: 0.01, unit: '%' },
      { k: 'stage', label: '阶段', text: true },
      { k: 'time', label: '时间', d: 0, eps: 0.5, unit: 'min' }
    ],
    yeasts: [
      { k: 'amount', label: '用量', d: 2, eps: 0.01, unit: 'g' },
      /* 叫「本配方衰减度」而不是「酵母标称衰减度」（v1.7）：
         这里比对的是 r.yeasts[].att —— 配方里这颗酵母在这锅糖化方案下**实际**达到的
         表观衰减，会与 12-data-yeast 里厂商标称的 att 差 2–8 个点（糖化温度影响）。
         原料库 js/44-ui-ingredient.js 那张表才是「标称」，同一个字段名、两种语义，
         所以两处标签必须不同 —— 统一成一个反而是错的。同理见 52-ui-classic.js:760。 */
      { k: 'att', label: '本配方衰减度', d: 1, eps: 0.05, unit: '%' },
      { k: 'type', label: '类型', text: true }
    ],
    adjuncts: [
      { k: 'amount', label: '用量', d: 3, eps: 0.001, unit: '' },
      { k: 'unit', label: '单位', text: true },
      { k: 'stage', label: '阶段', text: true },
      { k: 'extraSugarPct', label: '额外糖分', d: 1, eps: 0.05, unit: '%' }
    ]
  };

  var STAGE_LABEL = {
    boil: '煮沸', whirlpool: '回旋', dryhop: '干投', mash: '糖化',
    flameout: '关火', first: '头道', keg: '桶中', bottle: '瓶中'
  };

  /* ======================================================================
   * 工具
   * ====================================================================*/

  function arr(v) { return Array.isArray(v) ? v : []; }

  function pick(row, kind) {
    row = row || {};
    var out = {};
    var fields = ROW_FIELDS[kind] || [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      out[f.k] = f.text ? String(row[f.k] === undefined ? '' : row[f.k])
        : U.round(U.toNum(row[f.k], 0), f.d);
    }
    return out;
  }

  /** 比较两行，返回 {changed, delta, fields:[{k,label,left,right,changed,delta,unit}]} */
  function compareRow(left, right, kind) {
    var fields = ROW_FIELDS[kind] || [];
    var l = pick(left, kind), r = pick(right, kind);
    var changed = false, delta = null;
    var detail = [];

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var same;
      if (f.text) {
        same = l[f.k] === r[f.k];
      } else {
        same = Math.abs((l[f.k] || 0) - (r[f.k] || 0)) <= (f.eps || 0);
      }
      if (!same) changed = true;
      var item = {
        k: f.k,
        label: f.label,
        left: l[f.k],
        right: r[f.k],
        changed: !same,
        unit: f.unit || ''
      };
      if (!f.text) {
        var dv = U.round((r[f.k] || 0) - (l[f.k] || 0), f.d);
        item.delta = dv;
        if (f.k === 'amount') delta = dv;
      }
      /* 阶段名换成中文，方便表格直接渲染 */
      if (f.k === 'stage') {
        item.leftLabel = STAGE_LABEL[l[f.k]] || l[f.k] || '—';
        item.rightLabel = STAGE_LABEL[r[f.k]] || r[f.k] || '—';
      }
      detail.push(item);
    }

    return { changed: changed, delta: delta, fields: detail };
  }

  function findMatch(pool, used, row, fallbackByName) {
    var i;
    if (row && row.id) {
      for (i = 0; i < pool.length; i++) {
        if (!used[i] && pool[i] && pool[i].id === row.id) return i;
      }
    }
    if (fallbackByName) {
      for (i = 0; i < pool.length; i++) {
        if (used[i] || !pool[i]) continue;
        if (!pool[i].id && row && row.name && pool[i].name === row.name) return i;
      }
    }
    return -1;
  }

  function diffRows(left, right, kind) {
    left = arr(left); right = arr(right);
    var used = {}, out = [];
    var i, j, r;

    for (i = 0; i < left.length; i++) {
      var l = left[i] || {};
      j = findMatch(right, used, l, true);
      if (j < 0) {
        out.push({
          kind: kind,
          status: 'removed',
          id: l.id || '',
          name: l.name || '（未命名）',
          left: pick(l, kind),
          right: null,
          delta: null,
          fields: []
        });
        continue;
      }
      used[j] = true;
      r = right[j] || {};
      var cmp = compareRow(l, r, kind);
      out.push({
        kind: kind,
        status: cmp.changed ? 'changed' : 'same',
        id: l.id || r.id || '',
        name: l.name || r.name || '（未命名）',
        left: pick(l, kind),
        right: pick(r, kind),
        delta: cmp.delta,
        fields: cmp.fields
      });
    }

    for (var j2 = 0; j2 < right.length; j2++) {
      if (used[j2]) continue;
      r = right[j2] || {};
      out.push({
        kind: kind,
        status: 'added',
        id: r.id || '',
        name: r.name || '（未命名）',
        left: null,
        right: pick(r, kind),
        delta: null,
        fields: []
      });
    }

    return out;
  }

  function getPath(obj, path) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /** 这一段在对象里到底存不存在（不是"值为空"，是"键都没有"） */
  function hasPath(obj, path) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return false;
      if (!Object.prototype.hasOwnProperty.call(cur, parts[i])) return false;
      cur = cur[parts[i]];
    }
    return true;
  }

  var PARAM_DEFS = [
    { p: 'batchSize', label: '批次量', unit: 'L', d: 1 },
    { p: 'efficiency', label: '糖化效率', unit: '%', d: 1 },
    { p: 'evaporationRate', label: '蒸发率', unit: '%/h', d: 1 },
    { p: 'boilTime', label: '煮沸时长', unit: 'min', d: 0 },
    { p: 'trubLoss', label: '沉渣损失', unit: 'L', d: 2 },
    { p: 'fermenterLoss', label: '发酵罐残液', unit: 'L', d: 2 },
    { p: 'mashThickness', label: '水料比', unit: 'L/kg', d: 2 },
    { p: 'fermentTemp', label: '发酵温度', unit: '°C', d: 1 },
    { p: 'carbonation.targetVol', label: '碳化度', unit: 'vol', d: 2 },
    { p: 'water.source.ca', label: '钙 Ca', unit: 'ppm', d: 1 },
    { p: 'water.source.mg', label: '镁 Mg', unit: 'ppm', d: 1 },
    { p: 'water.source.na', label: '钠 Na', unit: 'ppm', d: 1 },
    { p: 'water.source.cl', label: '氯化物 Cl', unit: 'ppm', d: 1 },
    { p: 'water.source.so4', label: '硫酸盐 SO₄', unit: 'ppm', d: 1 },
    { p: 'water.source.hco3', label: '碳酸氢盐 HCO₃', unit: 'ppm', d: 1 }
  ];

  function diffParams(a, b) {
    var out = [], changed = 0, unavailable = [];
    for (var i = 0; i < PARAM_DEFS.length; i++) {
      var def = PARAM_DEFS[i];
      /* 版本历史里 partial 的条目会缺整段（water / mash / carbonation）。
         缺的那段不能当 0 比——那会得出"你把钙从 40 改成了 0"，是假差异。 */
      var hasA = hasPath(a, def.p);
      var hasB = hasPath(b, def.p);
      if (!hasA || !hasB) {
        unavailable.push(def.p);
        out.push({
          key: def.p,
          label: def.label,
          unit: def.unit,
          left: null,
          right: null,
          delta: null,
          changed: false,
          pct: null,
          unavailable: true
        });
        continue;
      }
      var lv = getPath(a, def.p);
      var rv = getPath(b, def.p);
      var l = U.round(U.toNum(lv, 0), def.d);
      var r = U.round(U.toNum(rv, 0), def.d);
      var isCh = Math.abs(l - r) > 1e-6;
      if (isCh) changed++;
      out.push({
        key: def.p,
        label: def.label,
        unit: def.unit,
        left: l,
        right: r,
        delta: U.round(r - l, def.d),
        changed: isCh,
        pct: l !== 0 ? U.round((r - l) / l * 100, 1) : null,
        unavailable: false
      });
    }
    return { list: out, changed: changed, unavailable: unavailable };
  }

  /* ======================================================================
   * 糖化步骤（v1.4 补）
   * ----------------------------------------------------------------------
   * 为什么必须单独一组、不能塞进 PARAM_DEFS：
   *   PARAM_DEFS 是"字段路径 → 一行"的**静态**表，而糖化步骤是**动态数组**，
   *   条数随配方变。写死 mash.steps.0.tempC 只能覆盖第 1 步，
   *   三步（蛋白质休止 / 糖化 / 出糖）的配方第 3 步就永远比不到。
   *
   * 字段名：30-recipe 的 blank()/fromStyle()、31-classic、28-share-code 三处
   *   写出的形状一致 —— mash.steps[i] = { name, tempC, minutes }。
   *   （grep 确认过，别改成 temp / target：20-calc 与 35-batch 不认别的名字。）
   *
   * 为什么按 index 对齐、而不是按步骤名：
   *   家酿改的就是"同一步的温度"——66 → 67。两步都叫「糖化」时按名字对齐会
   *   抢匹配（A 的糖化配到 B 的第二段糖化），得出一句读着像真的的假差异；
   *   按 index 对齐在"不动条数"这个绝大多数场景里是对的。代价是**在中间插入
   *   一步会让后面所有步骤都算"改了"**。所以条数不同时，多出来的那几步单独
   *   出「新增第 N 步 / 删除第 N 步」，不去猜是哪一步被插进来的——那需要 LCS
   *   对齐，猜错的代价比"新增第 3 步"这种笨说法高得多。
   *
   * 温度为什么不按百分比阈值：
   *   66→67 只有 1.5%，任何 5% 的门槛都会把它吞掉；但糖化温度差 1°C 就是
   *   可感知的酒体差异（出糖率、残糖、酒精度全跟着变）。所以温度用**绝对阈值**
   *   （0.05°C，只用来吃浮点噪声），并且**不给百分比**——给了就会诱导界面
   *   按比例判断"变化大不大"，而这件事在温度上根本不成立。
   *   时间同理用绝对阈值（0.5 min）。
   * ====================================================================*/
  var MASH_STEP_FIELDS = [
    { k: 'name',    label: '步骤名', text: true },
    { k: 'tempC',   label: '温度',   unit: '°C',  d: 1, eps: 0.05, noPct: true },
    { k: 'minutes', label: '时间',   unit: 'min', d: 0, eps: 0.5 }
  ];

  function mashStepsOf(r) {
    if (!r || typeof r !== 'object') return null;
    var m = r.mash;
    if (!m || typeof m !== 'object') return null;
    return Array.isArray(m.steps) ? m.steps : null;
  }

  function numOrNaN(v) {
    if (v === undefined || v === null || v === '') return NaN;
    var n = parseFloat(v);
    return isFinite(n) ? n : NaN;
  }

  /** 一步的人话摘要：「糖化 66 °C / 60 min」。只给"新增/删除"那两行用 */
  function stepSummary(step) {
    if (!step || typeof step !== 'object') return '（空步骤）';
    var name = String(step.name || '未命名步骤');
    var t = numOrNaN(step.tempC);
    var mi = numOrNaN(step.minutes);
    return name +
      ' ' + (isFinite(t) ? U.round(t, 1) + ' °C' : '— °C') +
      ' / ' + (isFinite(mi) ? U.round(mi, 0) + ' min' : '— min');
  }

  function diffMashSteps(a, b) {
    var la = mashStepsOf(a), lb = mashStepsOf(b);

    /* 两侧都没有糖化段（手工造的裸对象、极老的导入数据）：无可奉告。
       这里**不出** unavailable 行——那是"有一侧没存"的说法，两边都没有时
       硬报一句"糖化步骤未参与对比"只是噪音。 */
    if (!la && !lb) return { list: [], changed: 0, unavailable: [] };

    /* 只有一侧有（partial 存档版本把 mash 整段裁掉了）：
       不能按"0 步"比，那会得出"你把糖化步骤全删了"。 */
    if (!la || !lb) {
      return {
        list: [{
          key: 'mash.steps', label: '糖化步骤', unit: '',
          left: null, right: null, delta: null,
          changed: false, pct: null, unavailable: true
        }],
        changed: 0,
        unavailable: ['mash.steps']
      };
    }

    var out = [], changed = 0;
    var n = Math.max(la.length, lb.length);

    for (var i = 0; i < n; i++) {
      var sa = la[i] || null;
      var sb = lb[i] || null;
      var seq = i + 1;

      /* ---- 条数不同：多出来的那一步单独一行，不参与字段级对比 ---- */
      if (!sa || !sb) {
        var only = sb || sa;
        var isAdd = !sa;
        changed++;
        out.push({
          key: 'mash.steps.' + i,
          /* 把这一步的温度/时间一起写进 label：只写"新增第 3 步"等于没说，
             用户要看的正是"新加的那一步是多少度"。 */
          label: (isAdd ? '新增第 ' + seq + ' 步' : '删除第 ' + seq + ' 步') +
            '：' + stepSummary(only),
          unit: '',
          left: null,
          right: null,
          delta: null,
          changed: true,
          pct: null,
          stepOp: isAdd ? 'add' : 'del'
        });
        continue;
      }

      /* 行标签用**旧**那一步的名字：用户是从旧版读起，而且名字若也改了，
         下面紧跟的「第 N 步名称」那行会把新名字写出来。 */
      var stepName = String(sa.name || sb.name || '');
      var prefix = '第 ' + seq + ' 步' + (stepName ? '「' + stepName + '」' : '');

      for (var f = 0; f < MASH_STEP_FIELDS.length; f++) {
        var def = MASH_STEP_FIELDS[f];
        var key = 'mash.steps.' + i + '.' + def.k;

        if (def.text) {
          var ta = String(sa[def.k] === undefined || sa[def.k] === null ? '' : sa[def.k]);
          var tb = String(sb[def.k] === undefined || sb[def.k] === null ? '' : sb[def.k]);
          var textCh = ta !== tb;
          if (textCh) changed++;
          out.push({
            key: key,
            label: prefix + '名称',
            unit: '',
            left: ta, right: tb,
            delta: null,
            changed: textCh,
            pct: null,
            unavailable: false
          });
          continue;
        }

        var na = numOrNaN(sa[def.k]);
        var nb = numOrNaN(sb[def.k]);
        /* 单侧缺值（老数据没有 minutes，或手改过 JSON）：标 unavailable，
           不要把它当 0 比——"60 → 0 分钟"和"这一版没记时间"是两回事。 */
        if (!isFinite(na) || !isFinite(nb)) {
          out.push({
            key: key,
            label: prefix + def.label,
            unit: def.unit,
            left: null, right: null,
            delta: null,
            changed: false,
            pct: null,
            unavailable: true
          });
          continue;
        }

        var l = U.round(na, def.d);
        var r = U.round(nb, def.d);
        var isCh = Math.abs(l - r) > def.eps;
        if (isCh) changed++;
        out.push({
          key: key,
          label: prefix + def.label,
          unit: def.unit,
          left: l,
          right: r,
          delta: U.round(r - l, def.d),
          changed: isCh,
          /* 温度不给百分比（见本段头注释）：1°C 在 66°C 上只有 1.5%，
             任何按比例判断"够不够大"的地方都会把它判成没变 */
          pct: def.noPct || l === 0 ? null : U.round((r - l) / l * 100, 1),
          unavailable: false
        });
      }
    }

    return { list: out, changed: changed, unavailable: [] };
  }

  var METRIC_DEFS = [
    { k: 'og', label: 'OG', d: 3, styled: true },
    { k: 'fg', label: 'FG', d: 3, styled: true },
    { k: 'abv', label: 'ABV', d: 2, unit: '%' },
    { k: 'ibu', label: 'IBU', d: 1 },
    { k: 'srm', label: 'SRM', d: 1 },
    { k: 'buGu', label: 'BU:GU', d: 2 },
    { k: 'attenuation', label: '酵母标称衰减度', d: 1, unit: '%' }
  ];

  function diffMetrics(calcA, calcB) {
    if (!calcA || !calcB) {
      return {
        list: [], changed: 0, available: false,
        reason: '缺少任一侧的计算结果，指标对比不可用（请把两份配方的 calcRecipe 结果一起传进来）'
      };
    }
    var out = [], changed = 0;
    for (var i = 0; i < METRIC_DEFS.length; i++) {
      var def = METRIC_DEFS[i];
      var l = U.round(U.toNum(calcA[def.k], 0), def.d);
      var r = U.round(U.toNum(calcB[def.k], 0), def.d);
      var isCh = Math.abs(l - r) > Math.pow(10, -def.d) / 2;
      var pct = l !== 0 ? U.round((r - l) / l * 100, 1) : null;
      if (isCh) changed++;
      out.push({
        key: def.k,
        label: def.label,
        unit: def.unit || '',
        left: l,
        right: r,
        delta: U.round(r - l, def.d),
        pct: pct,
        changed: isCh,
        major: pct !== null && Math.abs(pct) >= 5
      });
    }
    return { list: out, changed: changed, available: true, reason: '' };
  }

  /* ======================================================================
   * 主函数
   * ----------------------------------------------------------------------
   * @param {object} a      左配方（旧）
   * @param {object} b      右配方（新）
   * @param {object} calcA  左配方的 Calc.calcRecipe 结果（可选）
   * @param {object} calcB  右配方的 Calc.calcRecipe 结果（可选）
   * @returns {{
   *   rows:object, params:Array, metrics:Array, summary:object,
   *   paramsChanged:number, metricsChanged:number,
   *   hasChanges:boolean, labels:object, warnings:string[]
   * }}
   * ====================================================================*/
  RecipeDiff.compare = function (a, b, calcA, calcB) {
    a = a || {};
    b = b || {};
    var warnings = [];

    var rows = {}, summary = { added: 0, removed: 0, changed: 0, same: 0 };
    var unavailableKinds = [];

    for (var i = 0; i < KINDS.length; i++) {
      var kind = KINDS[i];
      /* 整段缺失（partial 版本快照）：不能按"空数组"比，否则会报成"你删光了所有原料" */
      if (!Array.isArray(a[kind]) || !Array.isArray(b[kind])) {
        rows[kind] = [];
        unavailableKinds.push(kind);
        continue;
      }
      var list = diffRows(a[kind], b[kind], kind);
      rows[kind] = list;
      for (var j = 0; j < list.length; j++) {
        summary[list[j].status] = (summary[list[j].status] || 0) + 1;
      }
    }

    var params = diffParams(a, b);
    /* 糖化步骤并进 params.list（界面只认这一个数组，不必为它加第二条渲染路径）。
       位置在设备参数之后、指标之前：它既属于"参数"这一类，
       又是 v1.4 之前**完全比不到**的一块（详见 diffMashSteps 头注释）。
       changed / unavailable 也一起并进去，这样 hasChanges、界面上的
       「参数改动 N 项」、「另有 N 项未参与对比」三处都自动跟着对，不用各自再数一遍。 */
    var mashSteps = diffMashSteps(a, b);
    params.list = params.list.concat(mashSteps.list);
    params.changed += mashSteps.changed;
    params.unavailable = params.unavailable.concat(mashSteps.unavailable);

    var metrics = diffMetrics(calcA, calcB);

    if (!metrics.available) warnings.push(metrics.reason);
    if (a.id && a.id === b.id) {
      warnings.push('两侧是同一个配方 ID：这是「工作副本 vs 已保存版本」的对比');
    }
    if (unavailableKinds.length) {
      warnings.push(unavailableKinds.length + ' 段原料在这一版里没有保存（' +
        unavailableKinds.join('、') + '），未参与对比——不是被删掉了');
    }
    if (params.unavailable.length) {
      /* 把真正缺的那几项名字出来。原来写死"（如 water / carbonation）"，
         现在多了 mash.steps，一句话点不到名字会让用户以为自己没改糖化。 */
      var missingSample = params.unavailable.slice(0, 3).join('、');
      warnings.push(params.unavailable.length + ' 个参数在某一侧没有保存（' +
        missingSample + (params.unavailable.length > 3 ? ' 等' : '') + '），未参与对比');
    }

    /* 配方名也是一处改动（v1.2 补）。
       D2 的成因：原来 compare() 只把名字塞进 labels 用来当标题，从不参与差异判定，
       于是"只把配方改了个名"会得到"两份配方完全一致"——用户拿这句话判断
       "我到底改了什么"，而它是假的。名字不同就是不同，这一行必须进结论。
       注意：名字不进 params.list（那一组是设备参数，混进去会被误读成"设备改了"），
       单独用 nameChanged 表达，由界面决定怎么显示。 */
    var nameChanged = String(a.name || '') !== String(b.name || '');

    var hasChanges = nameChanged ||
      summary.added + summary.removed + summary.changed > 0 ||
      params.changed > 0 || metrics.changed > 0;

    return {
      rows: rows,
      params: params.list,
      metrics: metrics.list,
      summary: summary,
      paramsChanged: params.changed,
      metricsChanged: metrics.changed,
      metricsAvailable: metrics.available,
      hasChanges: hasChanges,
      /* 名称是否改了。hasChanges 已含它；单列出来是为了让界面能说
         「只有名称不同」这种精确结论，而不是笼统的「有 1 处改动」。 */
      nameChanged: nameChanged,
      /* 哪些段落因为缺数据而没比（界面应显示"该版本未保存此段落"） */
      unavailable: { kinds: unavailableKinds, params: params.unavailable },
      labels: {
        kinds: KIND_LABEL,
        leftName: a.name || '（旧配方）',
        rightName: b.name || '（新配方）',
        leftRev: a.rev || null,
        rightRev: b.rev || null
      },
      warnings: warnings
    };
  };

  /* ======================================================================
   * 自检
   * ====================================================================*/
  RecipeDiff.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    function base() {
      return {
        id: 'r-1', name: '基线 IPA',
        batchSize: 20, efficiency: 72, evaporationRate: 10, boilTime: 60,
        trubLoss: 1.5, fermenterLoss: 0.8, mashThickness: 3, fermentTemp: 19,
        carbonation: { targetVol: 2.4 },
        water: { source: { ca: 40, mg: 8, na: 30, cl: 35, so4: 40, hco3: 90 } },
        fermentables: [
          { id: 'm-2row', name: '淡色艾尔麦芽', amount: 5, ppg: 37, lov: 2, cat: 'base' },
          { id: 'm-c40', name: '结晶40', amount: 0.4, ppg: 34, lov: 40, cat: 'crystal' }
        ],
        hops: [{ id: 'h-citra', name: '西楚', amount: 30, aa: 12.5, stage: 'boil', time: 15 }],
        yeasts: [{ id: 'y-us05', name: 'US-05', amount: 11, att: 79.5, type: 'ale' }],
        adjuncts: []
      };
    }

    /* 1. 自己比自己：全 0 */
    var r0 = RecipeDiff.compare(base(), base(), { og: 1.05 }, { og: 1.05 });
    ok('自己比自己无变化', r0.hasChanges === false);
    ok('summary 全 0', r0.summary.added === 0 && r0.summary.removed === 0 && r0.summary.changed === 0);
    ok('相同行计数正确', r0.summary.same === 4, 'same=' + r0.summary.same);
    ok('参数无变化', r0.paramsChanged === 0);

    /* 2. 加一行麦芽 → added 1 */
    var b1 = base();
    b1.fermentables = b1.fermentables.concat([{ id: 'm-munich', name: '慕尼黑', amount: 0.5, ppg: 35, lov: 10, cat: 'base' }]);
    var r1 = RecipeDiff.compare(base(), b1, { og: 1.05 }, { og: 1.052 });
    ok('加一行麦芽 → added 1', r1.summary.added === 1, JSON.stringify(r1.summary));
    ok('加行后 changed 0', r1.summary.changed === 0);

    /* 3. 改一个用量 → changed 1，且 Δ 正确 */
    var b2 = base();
    b2.fermentables[0].amount = 5.5;
    var r2 = RecipeDiff.compare(base(), b2, { og: 1.05 }, { og: 1.056 });
    ok('改用量 → changed 1', r2.summary.changed === 1, JSON.stringify(r2.summary));
    var changedRow = r2.rows.fermentables.filter(function (x) { return x.status === 'changed'; })[0];
    ok('Δ 用量 = 0.5', changedRow && Math.abs(changedRow.delta - 0.5) < 1e-9, changedRow && String(changedRow.delta));

    /* 4. 删一行 → removed 1 */
    var b3 = base();
    b3.fermentables = b3.fermentables.slice(0, 1);
    var r3 = RecipeDiff.compare(base(), b3);
    ok('删一行 → removed 1', r3.summary.removed === 1, JSON.stringify(r3.summary));

    /* 5. 指标对比 */
    var r4 = RecipeDiff.compare(base(), base(), { og: 1.050, fg: 1.012, abv: 5, ibu: 40, srm: 6, buGu: 0.8, attenuation: 76 },
      { og: 1.055, fg: 1.012, abv: 5.6, ibu: 45, srm: 6, buGu: 0.82, attenuation: 77 });
    ok('指标有变化', r4.metricsChanged >= 2, String(r4.metricsChanged));
    var ogM = r4.metrics.filter(function (m) { return m.key === 'og'; })[0];
    ok('OG Δ = 0.005', ogM && Math.abs(ogM.delta - 0.005) < 1e-9, ogM && String(ogM.delta));

    /* 6. 缺 calc 时不崩、给原因 */
    var r5 = RecipeDiff.compare(base(), base());
    ok('缺 calc 时 metrics 为空', r5.metrics.length === 0);
    ok('缺 calc 时有原因', r5.warnings.length > 0);

    /* 7. 脏输入 */
    var r6 = RecipeDiff.compare(null, undefined);
    ok('null 入参不崩', r6 && r6.summary.added === 0);
    var r7 = RecipeDiff.compare({ fermentables: [{}] }, { fermentables: [{ id: '' }] });
    ok('空行不崩', r7.rows.fermentables.length >= 1);

    /* 8. 同 id 提示 */
    ok('同 id 会提示工作副本对比', r0.warnings.some(function (w) { return /工作副本/.test(w); }));

    /* 9. partial 版本快照：整段缺失不能报成"被删光" */
    var partial = { name: '裁剪过的版本' };   /* 只有名字：没有原料表、没有 water */
    var rp = RecipeDiff.compare(base(), partial);
    ok('partial：原料段不进对比', rp.rows.fermentables.length === 0 && rp.summary.removed === 0,
      JSON.stringify(rp.summary));
    ok('partial：标记为 unavailable', rp.unavailable.kinds.indexOf('fermentables') >= 0,
      JSON.stringify(rp.unavailable.kinds));
    var caP = rp.params.filter(function (x) { return x.key === 'water.source.ca'; })[0];
    ok('partial：缺 water 时该参数不可比', caP && caP.unavailable === true && caP.changed === false,
      JSON.stringify(caP));
    ok('partial：参数不可比不算变化', rp.paramsChanged === 0, String(rp.paramsChanged));
    ok('partial：有解释性警告', rp.warnings.some(function (w) { return /没有保存/.test(w); }));

    /* ---- 名称是否参与差异判定（v1.2 补 D2） ----
       回归价值：原实现只把 name 当标题用，于是"只改名"会得到"完全一致"。
       这三条断言能锁住它——尤其第二条，它正是验收人点出来的那个场景。 */
    var nA = base(), nB = base();
    nA.name = '测试 A'; nB.name = '测试 A+';
    var rn = RecipeDiff.compare(nA, nB, null, null);
    ok('只改名 → nameChanged 为 true', rn.nameChanged === true, String(rn.nameChanged));
    ok('只改名 → hasChanges 为 true（不能说"完全一致"）', rn.hasChanges === true, String(rn.hasChanges));
    ok('只改名 → 原料段仍是全 same', rn.summary.added === 0 && rn.summary.removed === 0 &&
      rn.summary.changed === 0, JSON.stringify(rn.summary));

    var nC = base();
    nC.name = '测试 A';           /* 必须与 nA 同名，否则测的是"名字不同" */
    var rn2 = RecipeDiff.compare(nA, nC, null, null);
    ok('名字相同 → nameChanged 为 false', rn2.nameChanged === false, String(rn2.nameChanged));

    /* ---- 糖化步骤（v1.4） ----
       改糖化温度是家酿最常见的改动，而 v1.3 的 PARAM_DEFS 里**根本没有它**
       （只有发酵温度）。这组断言锁三件事：能比出来、按 index 对齐、1°C 不被吞。 */
    function mashBase() {
      var r = base();
      r.mash = { steps: [
        { name: '糖化', tempC: 66, minutes: 60 },
        { name: '出糖', tempC: 76, minutes: 10 }
      ] };
      return r;
    }
    var m1 = mashBase();
    var m2 = mashBase();
    m2.mash.steps[0].tempC = 67;          /* 只改第 1 步，差 1°C */
    var rm = RecipeDiff.compare(m1, m2, null, null);
    var tempRow = rm.params.filter(function (x) { return x.key === 'mash.steps.0.tempC'; })[0];
    ok('糖化步骤：改了 1°C 能读出来',
      tempRow && tempRow.changed === true && tempRow.left === 66 && tempRow.right === 67,
      tempRow && JSON.stringify(tempRow));
    ok('糖化步骤：1°C 不被百分比阈值吞掉（温度不给 pct）',
      tempRow && tempRow.pct === null && tempRow.changed === true,
      tempRow && String(tempRow.pct));
    ok('糖化步骤：算进 paramsChanged', rm.paramsChanged === 1, String(rm.paramsChanged));
    ok('糖化步骤：hasChanges 为 true（不能报"完全一致"）', rm.hasChanges === true);
    ok('糖化步骤：没改的第 2 步不出现',
      !rm.params.filter(function (x) {
        return x.key.indexOf('mash.steps.1') === 0 && x.changed === true;
      }).length);

    /* 按 index 对齐：改第 2 步只出第 2 步那行，第 1 步不动 */
    var m3 = mashBase();
    m3.mash.steps[1].minutes = 15;
    var rm2 = RecipeDiff.compare(mashBase(), m3, null, null);
    ok('糖化步骤：改第 2 步只报第 2 步',
      rm2.paramsChanged === 1 &&
      !!rm2.params.filter(function (x) { return x.key === 'mash.steps.1.minutes' && x.changed; }).length,
      String(rm2.paramsChanged));

    /* 条数不同：第 3 步是新增，单独一行，不参与逐字段对比 */
    var m4 = mashBase();
    m4.mash.steps.push({ name: '蛋白质休止', tempC: 45, minutes: 15 });
    var rm3 = RecipeDiff.compare(mashBase(), m4, null, null);
    var addRow = rm3.params.filter(function (x) { return x.stepOp === 'add'; })[0];
    ok('糖化步骤：新增一步出「新增第 3 步」',
      addRow && /新增第 3 步/.test(addRow.label) && /45/.test(addRow.label),
      addRow && addRow.label);

    /* partial 存档缺 mash：不能报"删光了糖化步骤" */
    var rp2 = RecipeDiff.compare(mashBase(), { name: '裁剪版', fermentables: [], hops: [], yeasts: [], adjuncts: [] });
    ok('糖化步骤：partial 缺 mash 时不可比而非"删光"',
      !rp2.params.filter(function (x) { return x.stepOp === 'del'; }).length,
      JSON.stringify(rp2.unavailable.params));

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
