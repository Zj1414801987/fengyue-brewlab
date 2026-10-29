/* ============================================================================
 * 风月酿研所 — 54-ui-ab.js
 * ----------------------------------------------------------------------------
 * 职责：「分析」视图的第三个页签 —— 多批次 A/B 对比（2–4 批）。
 *   同一张图叠每批的 SG 曲线（X 轴 = 距接种天数）+ 温度线（只画第一条序列）
 *   + 设计与实测并排的指标表 + 缺口提示。
 *
 * 依赖：
 *   js/40-ui-shell.js    UI.esc/attr/num/fmt/icon/emptyState/store/dt
 *   js/48-ui-charts.js   Charts.line（多序列 + 右轴）
 *   js/38-ab-compare.js  BREW.ABCompare.align(batches) / .metrics(batches, calcs)
 *   宿主 js/51-ui-analysis.js 的 BREW.UI.Analysis.addTab()
 *
 * 谁在调：
 *   本文件在**加载期**自己往宿主注册页签；宿主缺席时静默跳过（不报错）。
 *
 * 四条不能自己发明的口径（数据层 38 已经定好，界面照抄）：
 *   1. X 轴是 align 算好的 day（距接种天数），不是日期
 *   2. tempC 只有 series[0] 有值，其余是 null —— 那是刻意设计（四条温度线叠在
 *      一起等于没有），界面不得"顺手"补全
 *   3. 缺口用 gaps 提示，绝不用 0 填充曲线（0 会掉到地板，像发酵失败）
 *   4. 设计与实测分两列，绝不合并（一个数既像设计又像实测，最后谁都不信）
 *
 * 选择记忆：settings.compareIds（数组）。这个键不在 58 的 SCHEMA 里，
 *   所以「恢复默认设置」不会清它——对比选择本来更像"上次看到哪"而不是"设置"。
 *   代价写在这里：它不会参与 reset，这是可接受的。
 *
 * 加载位置：js/53-ui-lineage.js 之后、js/55-ui-report.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;
  var A = UI.Analysis;

  var SEL_KEY = 'settings.compareIds';
  var MIN_SEL = 2;
  var MAX_SEL = 4;

  var sel = [];        /* 选中的批次 id，顺序 = 图的序列顺序 = 表的列顺序 */
  var selReady = false;

  /* 曲线颜色一律向 48 的令牌缓存要（48 refreshColors 是就地改写，引用不会过期）。
     v1.5 在这里存了一份 ['#9c5d0e','#2c6290','#376f31','#8a5a2b']，CSS 换配色后
     图例小圆点（DOM）和画布上的曲线会对不上同一个蓝——两份数组迟早不同步。 */

  /* 4 条比重曲线只用"冷热交替"的 4 个色相：琥珀 / 青 / 绿 / 蓝。
     第 4 条取 --s5 蓝而**不是** --s4 红：这是一张"比重随时间下降"的曲线，
     红色在这张图上会被读成"超标 / 异常"，而第 4 条只是一锅酒。
     留红给真正的异常（A/B 页签里没有异常态，所以红在这里没有语义位置）。 */
  var SERIES_SLOT = [0, 1, 2, 4];

  function seriesColor(i) {
    var n = SERIES_SLOT.length;
    var at = SERIES_SLOT[((i % n) + n) % n];
    return (BREW.Charts && BREW.Charts.seriesColor) ? BREW.Charts.seriesColor(at) : '';
  }

  /* 温度线：紫（--s6）。不和上面 4 条撞色；虚线只是弱区分，缩略看仍是一条紫线。 */
  function tempColor() {
    return (BREW.Charts && BREW.Charts.seriesColor) ? BREW.Charts.seriesColor(5) : '';
  }

  /* ======================================================================
   * A. 取数与选择
   * ====================================================================*/

  function batches() {
    try { return UI.store.batches() || []; } catch (e) { return []; }
  }

  function nameOf(b, i) {
    var snap = (b && b.recipeSnapshot) || {};
    return (b && b.name) || snap.name || ('批次 ' + (i + 1));
  }

  /* 选择器上的副标识：批次号 + 酿造日。
     为什么必须有：A/B 对比的核心场景就是"同一个配方酿了两锅"，
     这时两枚 chip 的文字完全相同（都叫「三代 IPA」、都是 5 读数），
     用户根本无从分辨点的是哪一锅 —— 而这个功能存在的理由就是分辨它们。
     批次号是用户脑子里的身份（"第 3 锅"），日期是第二重确认。

     批次号是 YYYYMMDD-NN 形式（35-batch 的 nextBatchNo）。整串太长，
     而前半段就是酿造日，和后面的日期重复，所以只取序号：#20261023-05 → #05。
     日期跨年时必须带年份 —— 只写 09-18 的话，去年那锅看起来像今年的。 */
  function idOf(b) {
    var raw = (b && b.batchNo != null) ? String(b.batchNo) : '';
    var no = '';
    if (raw) {
      var m = raw.match(/^\d{8}-(\d+)$/);
      no = '#' + (m ? m[1] : raw);
    }
    var d = String((b && b.brewDate) || '');
    var md = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    var day = '';
    if (md) {
      var thisYear = String(new Date().getFullYear());
      day = (md[1] === thisYear) ? (md[2] + '-' + md[3]) : (md[1] + '-' + md[2] + '-' + md[3]);
    }
    return [no, day].filter(Boolean).join(' · ');
  }

  function numOfReadings(b) {
    return (b && Array.isArray(b.readings)) ? b.readings.length : 0;
  }

  /** 酿造日，仅用于排序与显示；缺日期时退到 createdAt，再缺就排最后 */
  function dateKey(b) {
    var d = String((b && b.brewDate) || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
    var t = num(b && b.createdAt, 0);
    return t ? UI.dt(t) : '';
  }

  /* 图例去重（原地改 align 结果的 name）。
     只在"重名"时动手，唯一的批次名保持原样 —— 大多数对比是两个不同配方，
     给它们强加 #批次号 只是噪音。 */
  function disambiguate(al, chosen) {
    if (!al || !Array.isArray(al.series)) return al;
    var seen = {}, dup = {};
    al.series.forEach(function (s) {
      var k = String(s.name);
      if (seen[k]) dup[k] = true; else seen[k] = true;
    });
    if (!Object.keys(dup).length) return al;
    var byId = {};
    (chosen || []).forEach(function (b) { if (b && b.id) byId[String(b.id)] = b; });
    al.series.forEach(function (s) {
      if (!dup[String(s.name)]) return;
      var tag = idOf(byId[String(s.batchId)]);
      s.name = tag ? (s.name + ' · ' + tag) : s.name;
    });
    return al;
  }

  function sortedBatches(list) {
    return list.slice().sort(function (a, b) {
      var da = dateKey(a), db = dateKey(b);
      if (da !== db) return da < db ? 1 : -1;      /* 新的在前 */
      return String(nameOf(a, 0)).localeCompare(String(nameOf(b, 0)), 'zh');
    });
  }

  /** 默认的两批：读数最多的（并列时新的在前）。
      不用"最近两批"——最新的那两批往往还没记读数，打开就是两条空线，
      第一次见这个功能的人会以为它坏了。 */
  function bestFirst(list) {
    return list.slice().sort(function (a, b) {
      var na = numOfReadings(a), nb = numOfReadings(b);
      if (nb !== na) return nb - na;
      var da = dateKey(a), db = dateKey(b);
      if (da !== db) return da < db ? 1 : -1;
      return 0;
    });
  }

  function loadSel(list) {
    if (selReady) {
      /* 批次可能被删：把已删的 id 剔掉，剩下的顺序不动 */
      var alive = {}, out = [];
      for (var i = 0; i < list.length; i++) alive[list[i].id] = true;
      for (var j = 0; j < sel.length; j++) if (alive[sel[j]]) out.push(sel[j]);
      sel = out;
      return;
    }
    selReady = true;
    var saved = [];
    try { saved = UI.store.get(SEL_KEY, []); } catch (e) { saved = []; }
    if (!Array.isArray(saved)) saved = [];
    var have = {};
    for (var k = 0; k < list.length; k++) have[list[k].id] = true;
    for (var m = 0; m < saved.length && sel.length < MAX_SEL; m++) {
      if (have[saved[m]] && sel.indexOf(saved[m]) < 0) sel.push(saved[m]);
    }
    /* 没存过 / 存的批次都删了 → 默认挑数据最全的两批，第一次打开就能看到曲线 */
    if (sel.length < MIN_SEL) {
      var best = bestFirst(list);
      sel = [];
      for (var n = 0; n < best.length && sel.length < MIN_SEL; n++) sel.push(best[n].id);
      saveSel();
    }
  }

  function saveSel() {
    try { UI.store.set(SEL_KEY, sel.slice()); } catch (e) { /* 存不下只是记不住选择 */ }
  }

  function selBatches(list) {
    var map = {}, out = [];
    for (var i = 0; i < list.length; i++) map[list[i].id] = list[i];
    for (var j = 0; j < sel.length; j++) if (map[sel[j]]) out.push(map[sel[j]]);
    return out;
  }

  /** 第一条序列决定温度线画谁，而用户没法手动指定"哪条是第一条"。
      所以把读数最多的那批排到第一：温度线落在数据最全的那批上，
      比落在"碰巧排在前面"的那批上有意义。 */
  function orderForChart(list) {
    return list.slice().sort(function (a, b) { return numOfReadings(b) - numOfReadings(a); });
  }

  /* ======================================================================
   * B. 口径转换
   * ====================================================================*/

  /**
   * 设计侧取值：用批次创建时的快照（那一刻的计算值），不是"现在的配方"。
   * 为什么不用 UI.calc(快照)：快照里的原料行没有 id/ppg/lov，重算会得到一堆 0，
   * 反而不如快照里已经算好的 og/fg/ibu/srm 可信。
   * 设计衰减快照里没存，用 OG/FG 折算——同一个公式 38 也用在实测侧，两边可比。
   */
  function designCalc(snap) {
    var s = snap || {};
    var og = num(s.og, null), fg = num(s.fg, null);
    var att = null;
    if (og !== null && fg !== null && og > 1.000) att = (og - fg) / (og - 1.000) * 100;
    return {
      og: og, fg: fg,
      abv: num(s.abv, null),
      attenuation: att,
      ibu: num(s.ibu, null),
      srm: num(s.srm, null)
    };
  }

  function cellVal(v, row) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (row.key === 'og' || row.key === 'fg') return v.toFixed(3);
    return fmt(v, row.d);
  }

  function cellDelta(v, row) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    var txt = (row.key === 'og' || row.key === 'fg')
      ? (v > 0 ? '+' : '') + v.toFixed(3)
      : (v > 0 ? '+' : '') + fmt(v, row.d);
    return '<span class="an-delta ' + deltaCls(v, row.better) + '">' + esc(txt) + '</span>';
  }

  /* 颜色方向由 better 决定：不是所有指标都"越高越好"
     （目前 rows 里只有表观衰减是 higher，其余是 none = 中性灰） */
  function deltaCls(v, better) {
    if (!v) return 'is-flat';
    if (better === 'higher') return v > 0 ? 'is-good' : 'is-bad';
    if (better === 'lower') return v < 0 ? 'is-good' : 'is-bad';
    return 'is-neutral';
  }

  /* ======================================================================
   * C. 片段
   * ====================================================================*/

  function pickerHtml(list) {
    var chips = '';
    var ordered = sortedBatches(list);
    for (var i = 0; i < ordered.length; i++) {
      var b = ordered[i];
      var on = sel.indexOf(b.id) >= 0;
      var n = numOfReadings(b);
      chips += '<button type="button" class="chip' + (on ? ' is-on' : '') + '" ' +
        'data-batch="' + attr(b.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '" ' +
        'title="' + attr(idOf(b)) + '">' +
        esc(nameOf(b, i)) +
        '<span class="an-chip__id">' + esc(idOf(b)) + '</span>' +
        '<span class="an-chip__n">' + (n ? n + ' 读数' : '无读数') + '</span>' +
        '</button>';
    }
    return '<div class="an-picker">' +
      '<div class="an-picker__head">' +
        '<span class="an-picker__label">参与对比</span>' +
        '<span class="u-xs u-dim">选 ' + MIN_SEL + '–' + MAX_SEL + ' 个；已选 ' + sel.length + ' 个</span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="pick-best">挑数据最全的两批</button>' +
      '</div>' +
      '<div class="an-picker__chips">' + chips + '</div>' +
      '</div>';
  }

  function seriesLegendHtml(al) {
    var html = '';
    for (var i = 0; i < al.series.length; i++) {
      var s = al.series[i];
      var last = s.points.length ? s.points[s.points.length - 1] : null;
      html += '<span class="an-ab-legend__item">' +
        '<i class="an-dot" style="background:' + attr(seriesColor(i)) + '"></i>' +
        '<b>' + esc(s.name) + '</b>' +
        '<span class="u-dim">' + (s.points.length ? s.points.length + ' 点 · ' + fmt(s.days, 1) + ' 天' : '无读数') +
        (last ? ' · 末点 ' + esc(UI.sg(last.sg)) : '') +
        (s.finished ? ' · 已完成' : '') + '</span>' +
        '</span>';
    }
    return html ? '<div class="an-ab-legend">' + html + '</div>' : '';
  }

  function gapsHtml(al) {
    var lis = '';
    for (var i = 0; i < al.series.length; i++) {
      var s = al.series[i];
      for (var j = 0; j < s.gaps.length; j++) {
        var g = s.gaps[j];
        lis += '<li>「' + esc(s.name) + '」第 ' + esc(fmt(g.fromDay, 0)) + '–' +
          esc(fmt(g.toDay, 0)) + ' 天没有读数（' + esc(fmt(g.days, 0)) + ' 天）。' +
          '曲线在这里是断的，不是发酵停了。</li>';
      }
    }
    return lis ? '<ul class="an-notes">' + lis + '</ul>' : '';
  }

  /** 设计列是否至少有一个值（决定要不要显示"快照里没有设计值"的说明） */
  function hasPlanned(m) {
    for (var r = 0; r < m.rows.length; r++) {
      var vals = m.rows[r].values;
      for (var v = 0; v < vals.length; v++) if (vals[v].planned !== null) return true;
    }
    return false;
  }

  function tableHtml(list, m) {
    var best = m.summary.bestAttenuation;

    var head = '<thead><tr><th rowspan="2" class="an-ab-ind">指标</th>';
    for (var i = 0; i < list.length; i++) {
      var isBest = list[i].id === best;
      /* 表头必须带批次标识：同配方两锅时两个表头都是「三代 IPA」，
         下面的数字谁是谁全靠猜。与 chip 用同一套 idOf。 */
      head += '<th colspan="2" class="an-ab-batch">' +
        '<span class="an-ab-batch__name">' + esc(nameOf(list[i], i)) + '</span>' +
        '<span class="an-ab-batch__id">' + esc(idOf(list[i])) + '</span>' +
        (isBest ? ' <span class="an-badge is-current" title="实测表观衰减最高的一批">发得最彻底</span>' : '') +
        '</th>';
    }
    head += '</tr><tr>';
    for (var j = 0; j < list.length; j++) {
      head += '<th class="u-right">设计</th><th class="u-right">实测</th>';
    }
    head += '</tr></thead>';

    var body = '';
    for (var r = 0; r < m.rows.length; r++) {
      var row = m.rows[r];
      body += '<tr><td class="an-ab-ind">' + esc(row.label) +
        (row.unit ? ' <span class="u-xs u-dim">' + esc(row.unit) + '</span>' : '') + '</td>';
      for (var v = 0; v < row.values.length; v++) {
        var val = row.values[v];
        body += '<td class="num">' + esc(cellVal(val.planned, row)) + '</td>' +
          '<td class="num">' + esc(cellVal(val.actual, row)) + cellDelta(val.delta, row) + '</td>';
      }
      body += '</tr>';
    }

    return '<div class="table-wrap"><table class="table table--compact an-ab-table">' +
      head + '<tbody>' + body + '</tbody></table></div>';
  }

  /* ======================================================================
   * D. 主渲染
   * ====================================================================*/

  function paint() {
    var box = document.getElementById('an-ab-host');
    if (!box) return;

    if (!BREW.ABCompare || typeof BREW.ABCompare.align !== 'function') {
      box.innerHTML = UI.emptyState('对比模块未载入',
        'js/38-ab-compare.js 没有成功执行，A/B 对比无法计算。其余页签不受影响。', { art: 'chart' });
      return;
    }

    var list = batches();
    if (!list.length) {
      box.innerHTML = UI.emptyState('还没有批次记录',
        'A/B 对比比较的是同一个配方的不同批次（比如换了酵母、改了温度）。' +
        '先去「批次记录」建两锅，并给它们记读数（时间 + 比重）。', { art: 'beer' });
      return;
    }

    loadSel(list);
    var chosen = orderForChart(selBatches(list));

    var html = pickerHtml(list);

    if (chosen.length < MIN_SEL) {
      html += UI.emptyState('至少选两个批次才能对比',
        '当前选了 ' + chosen.length + ' 个。上面的标签点一下就加入对比；' +
        '只有一个批次时，没有第二条曲线可以对照。',
        { art: 'chart', size: 56, small: true });
      box.innerHTML = html;
      return;
    }

    var al, m;
    try {
      al = BREW.ABCompare.align(chosen);
      m = BREW.ABCompare.metrics(chosen, chosen.map(function (b) { return designCalc(b.recipeSnapshot); }));
      /* 图例去重：同配方两锅的名字必然一模一样，图例上并排列出两个
         「三代 IPA」等于没标。重名的在后面补 #批次号。 */
      disambiguate(al, chosen);
    } catch (e) {
      UI.reportError(e, 'ab.compare');
      box.innerHTML = html + UI.emptyState('对比算不出来',
        'BREW.ABCompare 抛错：' + ((e && e.message) || '未知错误'), { art: 'chart' });
      return;
    }

    /* --- 图 --- */
    html += '<div class="an-panel an-panel--wide">' +
      '<div class="an-panel__head"><h3>发酵曲线</h3>' +
        '<span class="u-xs u-dim">横轴＝距接种天数（每批各自的第一个读数为第 0 天）· 温度只画第一条序列（读数最全的一批）</span>' +
      '</div>' +
      '<div class="an-panel__body"><canvas class="an-canvas" id="an-c-ab" height="318"></canvas></div>' +
      '<div class="an-panel__body an-panel__body--tight">' + seriesLegendHtml(al) + '</div>' +
      '</div>';

    /* --- 指标表 --- */
    html += '<div class="an-panel">' +
      '<div class="an-panel__head"><h3>设计与实测</h3>' +
        '<span class="u-xs u-dim">设计取自批次快照（建批次那一刻的计算值），实测取自读数与实测字段</span>' +
      '</div>' +
      '<div class="an-panel__body an-panel__body--flush">' + tableHtml(chosen, m) + '</div>' +
      '</div>';

    html += gapsHtml(al);

    /* 设计列全空时要说明原因，否则用户会以为是取数 bug。
       常见于老版本建的批次：它们的快照里只有配方名与批次量，没有当时的计算值。 */
    if (!hasPlanned(m)) {
      html += '<p class="an-note-line">' + icon('info', 13) +
        '<span>这几批的快照里没有设计值（老版本批次可能只存了配方名与批次量），所以「设计」列是空的；' +
        '实测列不受影响。</span></p>';
    }

    var warns = (al.warnings || []).concat((m.summary && m.summary.warnings) || []);
    if (warns.length) {
      var lis = '';
      for (var w = 0; w < warns.length; w++) lis += '<li>' + esc(warns[w]) + '</li>';
      html += '<ul class="an-notes">' + lis + '</ul>';
    }

    html += '<p class="an-foot">' +
      '<b>口径</b>：横轴是<b>距接种天数</b>而不是绝对日期——跨月的两批放在日期轴上会挤成一团；' +
      't0 取该批第一个读数（通常就是接种当天）。' +
      '温度只画第一条序列的温度：四条温度线叠在一起等于没有，所以数据层只给第一条带值；' +
      '界面把读数最多的那批排到第一条，让这条线落在数据最全的一批上（你没法手动指定）。' +
      '缺口只提示不补点，<b>不用 0 填充</b>（0 会让曲线掉到地板，看起来像发酵失败）。' +
      '指标表的设计列来自批次快照里创建时的计算值，实测列来自读数与实测字段；' +
      'IBU 与 SRM 没有便携实测手段，实测列恒为「—」；' +
      '「实测表观衰减」的设计列由快照 OG/FG 折算（快照没存这项），实测列来自读数，两列同一个公式。' +
      'Δ 的颜色方向按指标含义定：只有「实测表观衰减」是越高越好，其余为中性灰。' +
      '</p>';

    box.innerHTML = html;
    /* 尺寸自愈由 48 的 autoFit 负责（测到宽度变了会自己用同样参数重画一次），
       调用方不再补第二遍 rAF——两套机制并存会画两次，且以后没人敢删其中一套 */
    drawChart(al);
  }

  function drawChart(al) {
    var Ch = BREW.Charts;
    var canvas = document.getElementById('an-c-ab');
    if (!Ch || !canvas || typeof Ch.line !== 'function') return;

    var series = [];
    for (var i = 0; i < al.series.length; i++) {
      var s = al.series[i];
      if (!s.points.length) continue;       /* 没有读数的批次不进图，也不补 0 */
      var pts = [];
      for (var j = 0; j < s.points.length; j++) {
        pts.push({ x: s.points[j].day, y: s.points[j].sg });
      }
      series.push({ name: s.name, points: pts, color: seriesColor(i), axis: 'left' });
    }

    /* 温度：只画 series[0]。38 刻意只给第一条带 tempC，这里不要"顺手"补全 */
    var first = al.series[0];
    if (first && first.points.length) {
      var tp = [];
      for (var k = 0; k < first.points.length; k++) {
        if (first.points[k].tempC === null || first.points[k].tempC === undefined) continue;
        tp.push({ x: first.points[k].day, y: first.points[k].tempC });
      }
      /* 温度线用紫：四条 SG 线已经占了 琥珀/青/绿/蓝，再用蓝会和第 4 条撞色
         （虚线只是弱区分，缩略看还是两条蓝线） */
      if (tp.length) series.push({ name: '温度（' + first.name + '）', points: tp, color: tempColor(), axis: 'right', dashed: true });
    }

    if (!series.length) return;   /* 全都没读数：让 48 画它的空态反而更乱，直接留白 */

    try {
      Ch.line(canvas, series, {
        xIsTime: false,            /* day 是从 0 起的序号，当时间戳格式化会变成 1/1 */
        fill: false,
        showPoints: true,
        minY: al.yRange ? al.yRange.min : undefined,
        maxY: al.yRange ? al.yRange.max : undefined,
        minY2: al.tempRange ? al.tempRange.min : undefined,
        maxY2: al.tempRange ? al.tempRange.max : undefined,
        y2Color: tempColor(),
        emptyText: '这些批次都还没有比重读数'
      });
    } catch (e) {
      UI.reportError(e, 'ab.chart');
    }
  }

  /* ======================================================================
   * E. 交互
   * ====================================================================*/

  function toggleBatch(id) {
    var at = sel.indexOf(id);
    if (at >= 0) {
      sel.splice(at, 1);
    } else {
      if (sel.length >= MAX_SEL) {
        UI.Shell.toast('最多同时对比 ' + MAX_SEL + ' 个批次，先取消一个', 'warn');
        return;
      }
      sel.push(id);
    }
    saveSel();
    paint();
  }

  function pickBest() {
    var list = bestFirst(batches());
    sel = [];
    for (var i = 0; i < list.length && sel.length < MIN_SEL; i++) sel.push(list[i].id);
    saveSel();
    paint();
  }

  function bind(box) {
    if (box.__abBound) return;
    box.__abBound = true;
    box.addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== box && node.nodeType === 1) {
        if (node.getAttribute) {
          if (node.getAttribute('data-batch') !== null) {
            toggleBatch(node.getAttribute('data-batch'));
            return;
          }
          if (node.getAttribute('data-act') === 'pick-best') {
            pickBest();
            return;
          }
        }
        node = node.parentNode;
      }
    });
  }

  function render(box) {
    if (!box) return;
    box.innerHTML = '<div id="an-ab-host"></div>';
    bind(box);
    paint();
  }

  /* ======================================================================
   * F. 注册
   * ====================================================================*/

  var Tab = UI.ABTab = { id: 'ab', label: '多批次对比', order: 30, render: render };

  if (A && typeof A.addTab === 'function') {
    A.addTab(Tab);
  } else if (root.console && console.warn) {
    console.warn('[BrewLab] 51-ui-analysis.js 未就绪，A/B 页签未注册');
  }

})(typeof window !== 'undefined' ? window : globalThis);
