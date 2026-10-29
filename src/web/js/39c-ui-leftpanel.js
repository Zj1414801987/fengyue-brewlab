/* ============================================================================
 * 风月酿研所 — 39c-ui-leftpanel.js
 * ----------------------------------------------------------------------------
 * 职责：左侧面板 = 常驻搜索 + 三棵树（配方 / 工艺 / 实操）。
 *
 * 为什么这一列不再是导航（v1.6 的产品决定，写在这里免得下一个人加回去）：
 *   用户的原话是「左侧的目录栏功能和正上方的功能区功能重复了」。
 *   重复确实存在：功能区「设计」页签里的四个按钮点下去就是左侧那四项。
 *   所以视图入口统一收归功能区（「视图」页签 + Alt+1..0），
 *   左侧空出来回答另一个问题：**"我手头有什么、下一步做什么"**。
 *   仿 Aspen Plus 的左树：配方（我有什么）= 原料与结构，
 *   工艺（怎么走）= 糖化/发酵/酿造日，实操（做到哪了）= 批次与待办。
 *
 * 数据来源（每一行都写明，改之前先确认源头还在）：
 *   我的配方       UI.store.recipes()                     —— 已保存配方
 *   当前配方结构   UI.recipe().fermentables/hops/yeasts/adjuncts/water/mash.steps
 *   经典配方库     跳转到 classic 视图
 *   糖化方案       当前配方 mash.steps
 *   发酵计划       当前配方 yeasts[0] + fermentTemp；天数读 Batch.analyze().prediction
 *   酿造日步骤     BREW.BrewdayPlan.build(snapshot, 0).steps（36 号的反推逻辑）
 *   进行中/已完成  UI.store.batches() + BREW.Batch.normalizeStatus
 *   今天要做什么   酿造日 tick 的下一步 + "多久没测比重"
 *   失败档案       BREW.Batch.failureStats()（35 号的聚合，不另写一份）
 *
 * 三条硬规矩：
 *   ① 任何数字都现读模型，不写死。左面板是"当前状态"的镜子。
 *   ② 搜索框不抢焦点：init 里**没有** focus()。用户打开应用先能 Tab 到别处。
 *   ③ 点左面板的"加入当前配方"走 Recipe.addX + publish，
 *      不在 42 里另开一条写模型的路径（两条路必然分叉）。
 *
 * 依赖：00-core（Store/Bus）、30（Recipe.addX）、35/36（Batch/BrewdayPlan）、
 *       40（UI.icon / UI.store / Shell.go）
 * 加载位置：紧跟 40-ui-shell.js（编号 39c 只是"契约层"的命名，见 index.html）
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var LP = UI.LeftPanel = UI.LeftPanel || {};

  /* 每棵树最多显示多少行。不是性能考虑，是"一屏能认全"：
     我的配方 30 份时若全铺开，下面两棵树会被推到几百像素之外，
     用户会以为左侧只有配方。超出的部分给一行"还有 N 份"。
     这几行数是在 720 档（200px 宽 / 约 600px 高的可见区）里定的：
     配方树 ~200 + 工艺树 ~300 + 实操树 ~200，三棵树一屏都能碰到。 */
  var CAP = { recipes: 6, batches: 4, failed: 4, done: 3, steps: 5, mash: 4 };

  var host = null;        /* #leftpanel */
  var inputEl = null;
  var clearEl = null;
  var treeEl = null;
  var resEl = null;
  var query = '';         /* 当前搜索词（空 = 显示三棵树） */
  var refreshTimer = 0;
  var flashTimer = 0;

  /* ---------------------------------------------------------------- 小工具 */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function attr(s) { return esc(s); }

  function num(v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (d === undefined ? 0 : d);
  }

  function icon(name, size) { return (UI.icon ? UI.icon(name, size || 14) : ''); }

  function recipe() {
    try { return (typeof UI.recipe === 'function') ? UI.recipe() : null; } catch (e) { return null; }
  }
  function savedRecipes() {
    try {
      var a = UI.store.recipes();
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function batches() {
    try {
      var a = UI.store.batches();
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function stOf(b) {
    try { return BREW.Batch.normalizeStatus(b && b.status); } catch (e) { return 'plan'; }
  }

  /** 读配方里的工艺段参数（回旋 / 冷却充氧 / 后熟冷降）。
   *  实现只有一份：42 的 UI.recipeProc（含默认值回落）。42 加载在 39c 之后、
   *  但两者都在启动时装载完毕，而这里只在**渲染时**调用，所以取得到。
   *  取不到就返回空对象 —— 左面板少显示一个数，不在本地另抄一份默认值。 */
  function proc(r, key) {
    try {
      if (UI.recipeProc) return UI.recipeProc(r, key) || {};
    } catch (e) { /* 落到空对象 */ }
    return {};
  }
  function procLabel(kind, v) {
    try {
      if (UI.procLabel && UI.procLabel[kind]) return UI.procLabel[kind](v);
    } catch (e) { /* 落到原值 */ }
    return v === undefined || v === null || v === '' ? '—' : String(v);
  }
  function wpRowsOf(r) {
    var out = [];
    var hops = (r && r.hops) || [];
    for (var i = 0; i < hops.length; i++) {
      if (String(hops[i] && hops[i].stage) === 'whirlpool') out.push(hops[i]);
    }
    return out;
  }
  function stLabel(s) {
    try { return BREW.Batch.statusLabel(s); } catch (e) { return s; }
  }

  /** 当前配方是否就是这一份（用于"我的配方"里点亮当前项） */
  function isCurrent(r) {
    var cur = recipe();
    return !!(cur && r && cur.id === r.id);
  }

  /* -------------------------------------------------------------- 行构件 */

  function itemHtml(o) {
    /* o: { act, arg, arg2, label, meta, icon, on, child, warn, title } */
    return '<button type="button" class="lp-item' +
        (o.child ? ' lp-item--child' : '') +
        (o.on ? ' is-on' : '') +
        (o.warn ? ' lp-item--warn' : '') + '"' +
      ' data-lp="' + attr(o.act) + '"' +
      (o.arg !== undefined && o.arg !== null && o.arg !== '' ? ' data-arg="' + attr(o.arg) + '"' : '') +
      (o.arg2 !== undefined && o.arg2 !== null && o.arg2 !== '' ? ' data-arg2="' + attr(o.arg2) + '"' : '') +
      ' title="' + attr(o.title || o.label) + '">' +
      (o.icon ? icon(o.icon, 14) : '') +
      '<span class="lp-item__t">' + esc(o.label) + '</span>' +
      (o.meta !== undefined && o.meta !== null && o.meta !== ''
        ? '<span class="lp-item__m">' + esc(o.meta) + '</span>' : '') +
      '</button>';
  }

  /* 折叠状态：存 `settings.lpCollapsedSecs`（区名数组）。
     为什么用区名当键而不是下标：区是按内容动态生成的（"进行中批次"可能没有），
     用下标会在下一次渲染时错位——折叠了"糖化方案"，展开的却是"发酵计划"。 */
  var collapsedSecs = [];
  function loadCollapsed() {
    try {
      var v = BREW.Store && BREW.Store.get ? BREW.Store.get('settings.lpCollapsedSecs') : null;
      collapsedSecs = Array.isArray(v) ? v.slice() : [];
    } catch (e) { collapsedSecs = []; }
  }
  function saveCollapsed() {
    try {
      if (BREW.Store && BREW.Store.set) BREW.Store.set('settings.lpCollapsedSecs', collapsedSecs.slice());
    } catch (e) { /* 存不下不影响折叠本身 */ }
  }
  function toggleSec(key) {
    var i = collapsedSecs.indexOf(key);
    if (i >= 0) collapsedSecs.splice(i, 1); else collapsedSecs.push(key);
    saveCollapsed();
    if (!host) return;
    var sec = null;
    var all = host.querySelectorAll('.lp-sec');
    for (var k = 0; k < all.length; k++) {
      if (all[k].getAttribute('data-sec') === key) { sec = all[k]; break; }
    }
    if (!sec) return;
    var closed = collapsedSecs.indexOf(key) >= 0;
    sec.classList.toggle('is-closed', closed);
    var btn = sec.querySelector('.lp-sec__h');
    if (btn) btn.setAttribute('aria-expanded', closed ? 'false' : 'true');
  }

  /* v1.8：分区从"一个 h3 + 一串项"改成**可折叠的带框区块**。
     原来的分区只有 4px 外边距、没有边框底色（css 里 `.lp-sec{margin-bottom:4px}`），
     一屏十几项连成一片，用户的原话是"全是一样的东西"。现在每区：
       · 有 1px 边框 + 圆角 + 3px 领域色左边条（8 色循环，见 css 追加块）
       · 标题整行是按钮，点一下折叠，状态记在 localStorage
       · 折叠后只留标题行，长列表（原料分类、已完成批次）可以收起来 */
  function secHtml(title, count, body) {
    var key = String(title);
    var closed = collapsedSecs.indexOf(key) >= 0;
    return '<section class="lp-sec' + (closed ? ' is-closed' : '') + '" data-sec="' + attr(key) + '">' +
      '<button type="button" class="lp-sec__h" data-lp="sec" data-arg="' + attr(key) + '"' +
        ' aria-expanded="' + (closed ? 'false' : 'true') + '"' +
        ' title="点击折叠 / 展开「' + attr(key) + '」">' +
        '<span class="lp-sec__caret" aria-hidden="true">' + icon('chevron', 12) + '</span>' +
        '<span class="lp-sec__t">' + esc(title) + '</span>' +
        (count === null || count === undefined ? '' : '<span class="lp-sec__n">' + esc(count) + '</span>') +
      '</button>' +
      '<div class="lp-sec__b">' + body + '</div></section>';
  }

  function emptyHtml(text) {
    return '<div class="lp-empty">' + esc(text) + '</div>';
  }

  /* ==========================================================================
   * 一、配方树
   * ========================================================================*/

  function secRecipe() {
    var r = recipe();
    var html = '';

    /* ---- 我的配方 ---- */
    var list = savedRecipes();
    var body = '';
    if (!list.length) {
      body = emptyHtml('还没有保存的配方。配方页里填完点「保存配方」，这里会出现它。');
    } else {
      var shown = Math.min(list.length, CAP.recipes);
      for (var i = 0; i < shown; i++) {
        var it = list[i] || {};
        body += itemHtml({
          act: 'recipe', arg: it.id,
          label: it.name || '未命名配方',
          meta: (it.rev && it.rev > 1) ? ('r' + it.rev) : '',
          icon: 'recipe',
          on: isCurrent(it),
          title: '打开《' + (it.name || '未命名配方') + '》（当前正在编辑的那份会高亮）'
        });
      }
      if (list.length > shown) {
        body += itemHtml({
          act: 'go', arg: 'recipe',
          label: '还有 ' + (list.length - shown) + ' 份…',
          icon: 'arrow',
          title: '在配方页的「打开已保存配方」里查看全部'
        });
      }
    }
    html += secHtml('我的配方', list.length, body);

    /* ---- 当前配方结构 ----
       行数全部现读：麦芽/酒花/酵母/辅料的数组长度、水（有 water 对象算 1）、
       糖化步骤（mash.steps 长度）。写死一个 8 就会在用户加了一行之后说谎。

       ⚠️ 这里的**顺序 = 配方页主列的顺序**（v1.9 起）：
         基本信息 → 麦芽 → 酒花 → 辅料 → 水化学 → 糖化方案
         → 回旋沉淀 → 冷却与充氧 → 酵母与发酵 → 后熟与冷降
       两处不一致时，用户按左面板的顺序读页面会发现第三个就对不上。
       tools/test-leftpanel.js 里有一条显式有序断言（不是数个数）钉住它。 */
    var maltN = (r && r.fermentables ? r.fermentables.length : 0);
    var hopN = (r && r.hops ? r.hops.length : 0);
    var yeastN = (r && r.yeasts ? r.yeasts.length : 0);
    var adjN = (r && r.adjuncts ? r.adjuncts.length : 0);
    var hasWater = !!(r && r.water);
    var mashN = (r && r.mash && r.mash.steps ? r.mash.steps.length : 0);
    var wpN = 0;
    if (r && r.hops) {
      for (var wi = 0; wi < r.hops.length; wi++) {
        if (String(r.hops[wi] && r.hops[wi].stage) === 'whirlpool') wpN++;
      }
    }
    /* 工艺段参数：读法与配方页同一个出口（UI.recipeProc，见 42 的 PROC_DEFAULTS）。
       42 还没载入时退回空对象，宁可少一个数字，也不在这里另抄一份默认值。 */
    var chillP = proc(r, 'chill');
    var matureP = proc(r, 'mature');
    var rName = r && r.name ? r.name : '未命名配方';

    html += secHtml('当前配方结构', null,
      itemHtml({ act: 'jump', arg: 'malt', label: '麦芽', meta: maltN, icon: 'sack', title: '跳到配方页「麦芽与谷物」' }) +
      itemHtml({ act: 'jump', arg: 'hop', label: '酒花', meta: hopN, icon: 'drop', title: '跳到配方页「酒花」' }) +
      itemHtml({ act: 'jump', arg: 'adjunct', label: '辅料', meta: adjN, icon: 'layers', title: '跳到配方页「辅料与其他添加」' }) +
      itemHtml({ act: 'jump', arg: 'water', label: '水', meta: hasWater ? '有' : '—', icon: 'drop', title: '跳到配方页「水化学」' }) +
      itemHtml({ act: 'jump', arg: 'mash', label: '糖化步骤', meta: mashN, icon: 'thermo', title: '跳到配方页「糖化方案」' }) +
      itemHtml({ act: 'jump', arg: 'whirlpool', label: '回旋沉淀', meta: wpN ? (wpN + ' 行') : '—', icon: 'beaker', title: '跳到配方页「回旋沉淀」' }) +
      itemHtml({ act: 'jump', arg: 'chill', label: '冷却与充氧', meta: chillP.targetC !== undefined ? (num(chillP.targetC, 0) + '°C') : '—', icon: 'thermo', title: '跳到配方页「冷却与充氧」' }) +
      itemHtml({ act: 'jump', arg: 'yeast', label: '酵母', meta: yeastN, icon: 'flask', title: '跳到配方页「酵母与发酵」' }) +
      itemHtml({ act: 'jump', arg: 'mature', label: '后熟与冷降', meta: matureP.days !== undefined ? (num(matureP.days, 0) + ' 天') : '—', icon: 'clock', title: '跳到配方页「后熟与冷降」' }) +
      '<div class="lp-cap" title="' + attr(rName) + '">正在编辑：' + esc(rName) + '</div>'
    );

    /* ---- 经典配方库入口 ---- */
    html += secHtml('参考', null,
      itemHtml({ act: 'go', arg: 'classic', label: '经典配方库', icon: 'beer', title: '按风格抄一份可酿的基线' })
    );

    return html;
  }

  /* ==========================================================================
   * 二、工艺树
   * ========================================================================*/

  /** 用当前配方拼一个"像批次快照"的对象喂给 BrewdayPlan.build。
   *  只用 36 号真正读的字段（mashSteps / boilTime / hops / fermentTemp /
   *  expectedMashWater / expectedSpargeWater），不伪造别的。
   *  水量能拿到计算值就给，拿不到就省略 —— 36 号会自己退化成不带水量的标签。 */
  function snapshotOf(r) {
    var calc = UI.lastCalc || null;
    var snap = {
      mashSteps: (r && r.mash && r.mash.steps) ? r.mash.steps : [],
      boilTime: num(r && r.boilTime, 60),
      fermentTemp: num(r && r.fermentTemp, 20),
      hops: (r && r.hops) ? r.hops : []
    };
    if (calc) {
      if (isFinite(calc.mashWater)) snap.expectedMashWater = calc.mashWater;
      if (isFinite(calc.spargeWater)) snap.expectedSpargeWater = calc.spargeWater;
    }
    return snap;
  }

  /** 窄栏里的短标签：去掉括注，再把 "A · B" 收成 A。
   *  36 号的标签是给宽屏时间轴写的（"糖化休止 65°C · 60 分钟"），
   *  放进 200px 的左面板只会剩"糖化休止 65°C · 6…"。完整标签留在 title 里。 */
  function shortLabel(s) {
    var t = String(s || '');
    t = t.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
    var parts = t.split(' · ');
    if (parts.length > 1 && parts[0].length >= 4) t = parts[0];
    return t.trim() || String(s || '');
  }

  function secProcess() {
    var r = recipe();
    var html = '';

    /* ---- 糖化方案 ---- */
    var steps = (r && r.mash && r.mash.steps) ? r.mash.steps : [];
    var mb = '';
    if (!steps.length) {
      mb = emptyHtml('配方里没有糖化步骤，酿造日会按 66°C / 60 分钟生成一条。');
    } else {
      for (var i = 0; i < Math.min(steps.length, CAP.mash); i++) {
        var s = steps[i] || {};
        mb += itemHtml({
          act: 'jump', arg: 'mash', child: true,
          label: (s.name || ('第 ' + (i + 1) + ' 步')),
          meta: num(s.tempC, 0) + '°C · ' + num(s.minutes, 0) + '′',
          title: '跳到配方页「糖化方案」（双击温度可改）'
        });
      }
    }
    html += secHtml('糖化方案', steps.length + ' 步', mb);

    /* ---- 回旋沉淀（v1.9）----
       温度/时长读的是 hops[].whirlpoolTemp / hops[].time，与配方页「回旋沉淀」
       区和「酒花」区同一份数据，这里只读、不另存。 */
    var wps = wpRowsOf(r);
    var wb = '';
    if (!wps.length) {
      wb = emptyHtml('没有回旋投花。熄火后的回旋段可以只沉淀不投花，也可以补一次香气投放。');
    } else {
      for (var wj = 0; wj < Math.min(wps.length, CAP.mash); wj++) {
        var wh = wps[wj] || {};
        var wt = num(wh.whirlpoolTemp, 0);
        wb += itemHtml({
          act: 'jump', arg: 'whirlpool', child: true,
          label: wh.name || '回旋投花',
          meta: num(wh.amount, 0) + ' g' + (wt > 0 ? ' · ' + wt + '°C' : ''),
          title: '跳到配方页「回旋沉淀」（温度在这里改，酒花区显示同一个数）'
        });
      }
    }
    var wt0 = wps.length ? num(wps[0].whirlpoolTemp, 0) : 0;
    html += secHtml('回旋沉淀',
      wps.length ? (wps.length + ' 行' + (wt0 > 0 ? ' · ' + wt0 + '°C' : '')) : null, wb);

    /* ---- 冷却与充氧（v1.9）---- */
    var cp = proc(r, 'chill');
    var cb = itemHtml({
      act: 'jump', arg: 'chill', child: true,
      label: '冷却目标',
      meta: cp.targetC !== undefined ? (num(cp.targetC, 0) + '°C') : '—',
      title: '跳到配方页「冷却与充氧」'
    }) + itemHtml({
      act: 'jump', arg: 'chill', child: true,
      label: '冷却方式',
      meta: procLabel('chillMethod', cp.method),
      title: '板换 / 浸入盘管 / 逆流 / 自然冷却，决定冷却时长与沉淀效果'
    }) + itemHtml({
      act: 'jump', arg: 'chill', child: true,
      label: '充氧',
      meta: (cp.o2ppm !== undefined ? (num(cp.o2ppm, 0) + ' ppm') : '—'),
      title: '充氧方式：' + procLabel('chillOxygen', cp.oxygen) + '。接种前做一次，发酵开始后加氧只会促氧化'
    }) + itemHtml({
      act: 'jump', arg: 'chill', child: true,
      label: '预计冷却时长',
      meta: cp.minutes !== undefined ? (num(cp.minutes, 0) + '′') : '—',
      title: '跳到配方页「冷却与充氧」'
    });
    html += secHtml('冷却与充氧', null, cb);

    /* ---- 发酵计划 ----
       菌株与温度是配方里的确定值；"预计天数"只在**有实测读数**时给
       —— 那是 Batch.analyze 用指数拟合算出来的 daysToGo。
       没读数就写"接种后按读数拟合"，不编一个 7 天出来。 */
    var y = (r && r.yeasts && r.yeasts.length) ? r.yeasts[0] : null;
    var tMin = y && y.tempMin !== null && y.tempMin !== undefined ? num(y.tempMin, 0) : null;
    var tMax = y && y.tempMax !== null && y.tempMax !== undefined ? num(y.tempMax, 0) : null;
    var ft = num(r && r.fermentTemp, 20);
    var outOfRange = (tMin !== null && ft < tMin) || (tMax !== null && ft > tMax);

    var b = activeBatchOf(r);
    var days = null;
    if (b) {
      try {
        var an = BREW.Batch.analyze(b);
        if (an && an.prediction && an.prediction.daysToGo !== null && isFinite(an.prediction.daysToGo)) {
          days = an.prediction.daysToGo;
        }
      } catch (e) { days = null; }
    }

    var fb = itemHtml({
      act: 'jump', arg: 'yeast', child: true,
      label: y ? y.name : '未选酵母',
      meta: y && y.att !== null && y.att !== undefined ? (num(y.att, 0) + '% ADF') : '',
      title: '跳到配方页「酵母与发酵」'
    }) + itemHtml({
      act: 'jump', arg: 'yeast', child: true,
      label: '发酵温度',
      meta: ft + '°C',
      warn: outOfRange,
      title: outOfRange
        ? ('超出这株酵母的舒适区 ' + (tMin === null ? '?' : tMin) + '–' + (tMax === null ? '?' : tMax) + '°C')
        : '跳到配方页「酵母与发酵」'
    }) + itemHtml({
      act: days === null ? 'jump' : 'go', arg: days === null ? 'yeast' : 'batch',
      child: true,
      label: '预计天数',
      meta: days === null ? '待读数' : (days <= 0 ? '可收尾' : ('约 ' + days + ' 天')),
      title: days === null
        ? '接种后每测一次比重，这里会给出"还差几天到 FG"（指数拟合，35 号 Batch.analyze）'
        : '按最近读数拟合的预计剩余天数；点一下去批次页'
    });
    html += secHtml('发酵计划', null, fb);

    /* ---- 后熟与冷降（v1.9）----
       天数与温度从 targets.process.mature 读（配方页同一个出口），
       可饮日期由 42 那边的 paintMature 算 —— 这里不重复那套加法，
       只给"后熟多久、冷降到几度"这两个用户要照着做的事。 */
    var mp = proc(r, 'mature');
    var mtb = itemHtml({
      act: 'jump', arg: 'mature', child: true,
      label: '后熟',
      meta: mp.days !== undefined ? (num(mp.days, 0) + ' 天 @ ' + num(mp.tempC, 0) + '°C') : '—',
      title: '跳到配方页「后熟与冷降」'
    }) + itemHtml({
      act: 'jump', arg: 'mature', child: true,
      label: '冷降',
      meta: String(mp.coldCrash) === 'no' ? '不冷降'
        : (mp.ccDays !== undefined ? (num(mp.ccDays, 0) + ' 天 @ ' + num(mp.ccTempC, 0) + '°C') : '—'),
      title: '冷降到 0–4°C 让酵母与浑浊物沉降；配方页「后熟与冷降」里有可饮日期'
    });
    html += secHtml('后熟与冷降', null, mtb);

    /* ---- 酿造日步骤 ----
       步骤名由 36 号的 BrewdayPlan.build 反推（进水→升温→休止→出糖→洗糟
       →煮沸→投花→回旋→冷却→接种），这里只负责显示，
       绝不在 39c 里另写一份"标准流程"——两份一定会分叉。 */
    var bd = '';
    var pSteps = [];
    try {
      if (BREW.BrewdayPlan && typeof BREW.BrewdayPlan.build === 'function') {
        pSteps = BREW.BrewdayPlan.build(snapshotOf(r), 0).steps || [];
      }
    } catch (e) { pSteps = []; }

    if (!pSteps.length) {
      bd = emptyHtml('酿造日计划没算出来（36 号模块可能未载入）。');
    } else {
      var shownS = Math.min(pSteps.length, CAP.steps);
      for (var k = 0; k < shownS; k++) {
        var ps = pSteps[k] || {};
        bd += itemHtml({
          act: 'go', arg: 'brewday', child: true,
          label: shortLabel(ps.label) || ('第 ' + (k + 1) + ' 步'),
          meta: ps.offsetMin ? ('+' + ps.offsetMin + '′') : '起步',
          title: '去「酿造日」按分钟推进这张时间轴：' + (ps.label || '')
        });
      }
      if (pSteps.length > shownS) {
        bd += itemHtml({
          act: 'go', arg: 'brewday', child: true,
          label: '还有 ' + (pSteps.length - shownS) + ' 步…',
          icon: 'arrow', title: '去「酿造日」看完整时间轴'
        });
      }
    }
    html += secHtml('酿造日步骤', pSteps.length + ' 步', bd);

    return html;
  }

  /** 当前配方对应的"正在酿"的那一批（用来算预计天数、待办）。
   *  没有就返回 null —— 不拿"最新一批"顶替，那是别的配方的数据。 */
  function activeBatchOf(r) {
    if (!r || !r.id) return null;
    var list = batches();
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || b.recipeId !== r.id) continue;
      var st = stOf(b);
      if (st === 'done' || st === 'failed') continue;
      if (!best || num(b.createdAt, 0) > num(best.createdAt, 0)) best = b;
    }
    return best;
  }

  /* ==========================================================================
   * 三、实操树
   * ========================================================================*/

  /* v1.7：plan 必须在这里面。原来只列"已经在跑"的阶段，于是下面 ③
     （计划中且今天就是酿造日）那条分支永远进不去——实测：新建
     status=plan、brewDate=今天 的批次后，左面板仍显示"今天没有待办"。
     "建了批次但还没开酿"正是最需要提醒的状态，漏掉它等于这条待办不存在。
     （46 现在也在批次头卡上真的给了「开始酿造」按钮，③ 的文案才不再是死路。） */
  var RUNNING = { plan: 1, mash: 1, lauter: 1, boil: 1, chill: 1, ferment: 1, dryhop: 1, mature: 1, package: 1 };

  function batchRow(b, child) {
    var st = stOf(b);
    return itemHtml({
      act: 'batch', arg: b.id, child: !!child,
      label: (b.batchNo ? '#' + b.batchNo : '') + ' ' + (b.name || ''),
      meta: stLabel(st),
      title: '在「酿造记录」里打开这一批'
    });
  }

  function secOps() {
    var list = batches();
    var running = [];
    var done = [];
    var failed = 0;
    for (var i = 0; i < list.length; i++) {
      var st = stOf(list[i]);
      if (RUNNING[st]) running.push(list[i]);
      else if (st === 'done') done.push(list[i]);
      if (st === 'failed') failed++;
    }
    /* 进行中按"最早开始"在前：先开的那锅更该被看 */
    running.sort(function (a, b) { return num(a.createdAt, 0) - num(b.createdAt, 0); });
    done.sort(function (a, b) { return num(b.updatedAt || b.createdAt, 0) - num(a.updatedAt || a.createdAt, 0); });

    var html = '';

    var rb = '';
    if (!running.length) rb = emptyHtml('没有进行中的批次。新建批次会存一份当前配方的快照。');
    else {
      for (var j = 0; j < Math.min(running.length, CAP.batches); j++) rb += batchRow(running[j], true);
      if (running.length > CAP.batches) {
        rb += itemHtml({ act: 'go', arg: 'batch', child: true, label: '还有 ' + (running.length - CAP.batches) + ' 批…', icon: 'arrow' });
      }
    }
    html += secHtml('进行中批次', running.length, rb);

    var db = '';
    if (!done.length) db = emptyHtml('还没有喝完的批次。');
    else {
      for (var k = 0; k < Math.min(done.length, CAP.done); k++) db += batchRow(done[k], true);
      if (done.length > CAP.done) {
        db += itemHtml({ act: 'go', arg: 'batch', child: true, label: '还有 ' + (done.length - CAP.done) + ' 批…', icon: 'arrow' });
      }
    }
    html += secHtml('已完成批次', done.length, db);

    /* ---- 今天要做什么 ----
       两条来源，都能指回具体对象：
         ① 已开酿的批次：酿造日 tick 给出"下一步 + 还要多久"；
         ② 主发酵中且 3 天没测比重：提醒测比重（发酵曲线靠这个）。
       都没有就明写"今天没有待办"，不留空白。 */
    var todo = todoItems();
    var tb = '';
    if (!todo.length) {
      tb = emptyHtml('今天没有待办。酿着的那几批都按计划在走。');
    } else {
      for (var t = 0; t < todo.length; t++) {
        tb += itemHtml({
          act: todo[t].view === 'brewday' ? 'go' : 'batch',
          arg: todo[t].view === 'brewday' ? 'brewday' : todo[t].batchId,
          label: todo[t].text,
          meta: todo[t].meta || '',
          icon: todo[t].icon || 'clock',
          warn: !!todo[t].warn,
          title: todo[t].title || todo[t].text
        });
      }
    }
    html += secHtml('今天要做什么', todo.length ? todo.length : null, tb);

    /* ---- 失败档案 ----
       聚合交给 35 号的 Batch.failureStats（类型计数、未分类兜底、
       最近一次的 learned 都在那里）。39c 只显示，不重算 ——
       重算一份就会出现"左面板说失败 3 次、批次页说 4 次"。 */
    var fstat = null;
    try {
      if (BREW.Batch && typeof BREW.Batch.failureStats === 'function') {
        fstat = BREW.Batch.failureStats(list);
      }
    } catch (e) { fstat = null; }

    var fbtml = '';
    if (!fstat || !fstat.total) {
      fbtml = emptyHtml('没有失败记录。真出事时在批次页填一份档案，这里会按类型归档。');
    } else {
      var rows = fstat.rows.slice(0, CAP.failed);
      for (var f = 0; f < rows.length; f++) {
        var row = rows[f];
        fbtml += itemHtml({
          act: row.lastBatchId ? 'batch' : 'go',
          arg: row.lastBatchId || 'batch',
          child: true,
          label: row.label,
          meta: row.count + ' 次',
          title: row.lastBatchNo ? ('最近一次：' + row.lastBatchNo) : '看完整的失败档案'
        });
      }
      if (fstat.rows.length > rows.length) {
        fbtml += itemHtml({ act: 'go', arg: 'batch', child: true, label: '还有 ' + (fstat.rows.length - rows.length) + ' 类…', icon: 'arrow' });
      }
    }
    html += secHtml('失败档案', fstat ? fstat.total + ' 次' : '0', fbtml);

    return html;
  }

  function todoItems() {
    var out = [];
    var now = Date.now();
    var list = batches();

    for (var i = 0; i < list.length && out.length < 3; i++) {
      var b = list[i];
      var st = stOf(b);
      if (!b || !RUNNING[st]) continue;

      /* ① 酿造日进行中：下一步 + 还剩多久 */
      if (b.brewday && b.brewday.startedAt && BREW.BrewdayPlan) {
        try {
          var plan = BREW.BrewdayPlan.build(b.recipeSnapshot || {}, b.brewday.startedAt);
          (b.brewday.steps || []).forEach(function (saved) {
            for (var s = 0; s < plan.steps.length; s++) {
              if (plan.steps[s].id === saved.id) {
                plan.steps[s].actualAt = saved.actualAt;
                plan.steps[s].skipped = saved.skipped;
              }
            }
          });
          var tick = BREW.BrewdayPlan.tick(plan, now);
          if (tick && !tick.finished && tick.nextStep) {
            var left = tick.remainingMs;
            out.push({
              view: 'brewday',
              batchId: b.id,
              text: tick.nextStep.label,
              meta: (left !== null && left !== undefined && left > 0)
                ? (left >= 60000 ? ('约 ' + Math.round(left / 60000) + ' 分钟后') : '就是现在')
                : '现在',
              icon: 'clock',
              warn: !!(left !== null && left !== undefined && left < 0),
              title: '「' + (b.batchNo ? '#' + b.batchNo + ' ' : '') + (b.name || '') + '」的酿造日下一步'
            });
          }
        } catch (e) { /* 计划算不出来就跳过这一条，不影响别的待办 */ }
        continue;
      }

      /* ② 主发酵中且太久没测：没有读数，就没有 FG 预测与发酵曲线 */
      if (st === 'ferment' || st === 'dryhop' || st === 'mature') {
        var last = 0;
        var rd = (b.readings || []);
        for (var j = 0; j < rd.length; j++) {
          var ts = num(rd[j].ts || rd[j].at, 0);
          if (ts > last) last = ts;
        }
        var days = last ? (now - last) / 86400000 : 0;
        if (!last || days >= 3) {
          out.push({
            view: 'batch',
            batchId: b.id,
            text: last ? (Math.floor(days) + ' 天没测比重了') : '还没记过读数',
            meta: (b.batchNo ? '#' + b.batchNo : ''),
            icon: 'chart',
            title: '发酵曲线与 FG 预测都靠测量点，隔几天测一次'
          });
        }
      }

      /* ③ 计划中且今天就是酿造日 */
      if (st === 'plan' && b.brewDate) {
        var today = new Date();
        var iso = today.getFullYear() + '-' +
          ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
        if (String(b.brewDate).slice(0, 10) === iso) {
          out.push({
            view: 'batch', batchId: b.id,
            text: '今天的批次：' + (b.name || b.batchNo || ''),
            meta: '待开酿', icon: 'beer',
            title: '去批次页点「开始酿造」，酿造日会按分钟推进'
          });
        }
      }
    }
    return out.slice(0, 3);
  }

  /* ==========================================================================
   * 四、搜索
   * --------------------------------------------------------------------------
   * 语法只有三种（写清"不支持什么"比"支持很多半成品"重要）：
   *
   *   ① 关键词            citra / 柑橘 / 赛松 / 秋分
   *      对名称、英文名、风味、用途、风格描述做子串匹配（不区分大小写）。
   *      多个关键词 = AND（都要命中）。
   *   ② aa 12            酒花的 α 酸区间包含 12（12 落在 aaMin..aaMax 之间）
   *      别名：α / alpha / α酸。也接受 aa=12。
   *   ③ 苦度 40          酒花的"参考苦度"≈ 40 IBU。
   *      参考苦度的口径写死在这里，界面上也会写出来：
   *        20 g 投入、煮沸 60 分钟、Tinseth、当前配方的批次量与煮沸比重
   *      匹配带 ±20%（至少 ±2 IBU），因为 IBU 本身是估算。
   *
   * 不支持（会明确回一句"不支持"而不是静默给空结果）：
   *   · 比较符：aa>10 / 苦度<30
   *   · 区间：aa 10-14 / 苦度 30~50
   *   · 多字段组合以外的布尔：aa 10 OR aa 14
   *   · 类别限定前缀：hop:citra
   * ========================================================================*/

  var FIELD_ALIAS = {
    'aa': 'aa', 'α': 'aa', 'alpha': 'aa', 'α酸': 'aa',
    '苦度': 'ibu', 'ibu': 'ibu'
  };
  var FIELD_ZH = { aa: 'α 酸', ibu: '参考苦度' };

  function parseQ(raw) {
    var out = { text: [], nums: [], bad: null, empty: false };
    var s = String(raw || '').trim();
    if (!s) { out.empty = true; return out; }

    /* 比较符与区间先拦：这两类写法的意图可以猜，但猜错比不猜更糟 */
    var cmp = s.match(/(aa|α|alpha|α酸|苦度|ibu)\s*[<>]/i);
    if (cmp) { out.bad = '不支持 > < 比较符：请写「' + cmp[1] + ' 12」这种"某值落在我给的区间里"的写法'; return out; }
    if (/(aa|α|alpha|α酸|苦度|ibu)\s*\d+(\.\d+)?\s*[-~–—]\s*\d+/i.test(s)) {
      out.bad = '不支持数值区间：请写「aa 12」（12 落在酒花自身的 α 区间里才算命中）'; return out;
    }
    if (/\bOR\b|｜|\|/i.test(s)) { out.bad = '不支持 OR：多个关键词之间是 AND（都要命中）'; return out; }
    if (/^[a-z\u4e00-\u9fa5]+\s*[:：]\s*\S+/i.test(s) && /[:：]/.test(s)) {
      var pfx = s.split(/[:：]/)[0];
      if (!FIELD_ALIAS[String(pfx).toLowerCase()]) {
        out.bad = '不支持类别前缀「' + pfx + '：」：六类（麦芽/酒花/酵母/辅料/风格/配方）一起搜'; return out;
      }
    }

    /* 把「字段 数字」规范成「字段=数字」，这样空格分隔与等号写法是同一件事 */
    var norm = s.replace(/(aa|alpha|α酸|α|苦度|ibu)\s*[:：=]?\s*(-?\d+(?:\.\d+)?)/gi,
      function (m0, f, v) { return f + '=' + v; });

    var toks = norm.split(/[\s,，、]+/);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t) continue;
      var eq = t.match(/^([^=]+)=(-?\d+(?:\.\d+)?)$/);
      if (eq) {
        var key = FIELD_ALIAS[String(eq[1]).toLowerCase()] || FIELD_ALIAS[eq[1]];
        if (key) { out.nums.push({ field: key, v: parseFloat(eq[2]) }); continue; }
      }
      /* 字段名后面跟了非数字：aa abc → 明确说不支持，不要当普通关键词搜 */
      var fld = FIELD_ALIAS[String(t).toLowerCase()] || FIELD_ALIAS[t];
      if (fld && i + 1 < toks.length) {
        out.bad = '「' + t + '」后面要跟一个数字：例如「' + t + ' 12」'; return out;
      }
      if (!eq && /^\d+(\.\d+)?$/.test(t) && out.nums.length === 0 && i > 0) {
        /* 纯数字且前面不是字段名：按文本搜（用户可能就想找"12"这个名字） */
      }
      out.text.push(t.toLowerCase());
    }
    if (!out.text.length && !out.nums.length) out.empty = true;
    return out;
  }

  /** 酒花的"参考苦度"：20 g / 60 分钟 / Tinseth / 当前配方的批次量与煮沸比重 */
  function refIbuOf(h) {
    var r = recipe();
    var vol = (r && num(r.batchSize, 0) > 0) ? num(r.batchSize, 0) : 20;
    var og = 1.050;
    if (UI.lastCalc && isFinite(UI.lastCalc.boilGravity) && UI.lastCalc.boilGravity > 1) og = UI.lastCalc.boilGravity;
    var u = 0.2;
    try {
      if (BREW.Calc && typeof BREW.Calc.tinsethUtil === 'function') u = BREW.Calc.tinsethUtil(og, 60);
    } catch (e) { u = 0.2; }
    return num(h.aa, 0) * 20 * u * 10 / vol;
  }

  function hasText(hay, tokens) {
    for (var i = 0; i < tokens.length; i++) {
      if (hay.indexOf(tokens[i]) < 0) return false;
    }
    return true;
  }

  var DB_KINDS = [
    { kind: 'malt', key: 'malts', zh: '麦芽', icon: 'sack' },
    { kind: 'hop', key: 'hops', zh: '酒花', icon: 'drop' },
    { kind: 'yeast', key: 'yeasts', zh: '酵母', icon: 'flask' },
    { kind: 'adjunct', key: 'adjuncts', zh: '辅料', icon: 'layers' },
    { kind: 'style', key: 'styles', zh: '风格', icon: 'beer' }
  ];

  function hayOf(kind, it) {
    var parts = [it.name, it.en, it.cat, it.origin, it.flavor, it.use, it.note, it.overall,
      it.subs, it.lab, it.stage];
    if (it.aroma && it.aroma.join) parts.push(it.aroma.join(' '));
    if (it.styles && it.styles.join) parts.push(it.styles.join(' '));
    if (it.key && it.key.join) parts.push(it.key.join(' '));
    if (kind === 'hop') parts.push('aa' + it.aa, 'α' + it.aa);
    return parts.join(' ').toLowerCase();
  }

  function metaOf(kind, it) {
    if (kind === 'hop') {
      /* 只留 α 与参考苦度两个数：aaMin–aaMax 与 α 重复，在 232px 里会折行 */
      var r = Math.round(refIbuOf(it) * 10) / 10;
      return 'α ' + num(it.aa, 0) + '% · 苦度 ' + r;
    }
    if (kind === 'malt') return '°L ' + num(it.lov, 0) + ' · ' + num(it.ppg, 0) + ' ppg · ' + (it.origin || '');
    /* v2.0：走唯一取数口，兼容只有 atten 的老自建酵母 */
    if (kind === 'yeast') return (it.lab || '') + ' · ' + num(UI.yeastAtt(it), 0) + '% ADF · ' +
      num(it.tempMin, 0) + '–' + num(it.tempMax, 0) + '°C';
    if (kind === 'adjunct') return (it.cat || '') + ' · ' + num(it.useMin, 0) + '–' + num(it.useMax, 0) + ' ' + (it.unit || 'g');
    if (kind === 'style') return 'OG ' + (it.og ? it.og[0] + '–' + it.og[1] : '') +
      ' · IBU ' + (it.ibu ? it.ibu[0] + '–' + it.ibu[1] : '');
    return '';
  }

  function searchAll(q) {
    var p = parseQ(q);
    if (p.bad) return { bad: p.bad, groups: [], total: 0, nums: [] };
    if (p.empty) return { bad: null, groups: [], total: 0, nums: [], empty: true };

    var db = BREW.DB || {};
    var groups = [];
    var total = 0;

    for (var g = 0; g < DB_KINDS.length; g++) {
      var spec = DB_KINDS[g];
      var arr = Array.isArray(db[spec.key]) ? db[spec.key] : [];
      var hits = [];
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        if (!it) continue;
        if (!hasText(hayOf(spec.kind, it), p.text)) continue;

        /* 数值条件：只有酒花有 aa / 苦度，别的类别直接不参与 */
        var ok = true;
        for (var n = 0; n < p.nums.length; n++) {
          var cond = p.nums[n];
          if (spec.kind !== 'hop') { ok = false; break; }
          if (cond.field === 'aa') {
            var lo = (it.aaMin !== undefined && it.aaMin !== null) ? num(it.aaMin, 0) : num(it.aa, 0) - 0.5;
            var hi = (it.aaMax !== undefined && it.aaMax !== null) ? num(it.aaMax, 0) : num(it.aa, 0) + 0.5;
            if (cond.v < lo || cond.v > hi) { ok = false; break; }
          } else if (cond.field === 'ibu') {
            var ref = refIbuOf(it);
            var tol = Math.max(2, Math.abs(cond.v) * 0.2);
            if (Math.abs(ref - cond.v) > tol) { ok = false; break; }
          }
        }
        if (!ok) continue;
        hits.push(it);
        if (hits.length >= 40) break;   /* 单类上限：再多也看不过来 */
      }
      if (hits.length) {
        groups.push({ kind: spec.kind, zh: spec.zh, icon: spec.icon, items: hits });
        total += hits.length;
      }
    }

    /* 配方名（第六类）：只匹配名字与备注，不匹配原料 */
    var rs = savedRecipes();
    var rhits = [];
    for (var k = 0; k < rs.length; k++) {
      var rec = rs[k];
      if (!rec) continue;
      var hay = (String(rec.name || '') + ' ' + String(rec.notes || '')).toLowerCase();
      if (p.nums.length) break;          /* 带数值条件时不搜配方 */
      if (!hasText(hay, p.text)) continue;
      rhits.push(rec);
    }
    if (rhits.length) {
      groups.push({ kind: 'recipe', zh: '我的配方', icon: 'recipe', items: rhits });
      total += rhits.length;
    }

    return { bad: null, groups: groups, total: total, nums: p.nums, text: p.text };
  }

  /* ---------------------------------------------------------- 搜索结果渲染 */

  function resultRow(kind, it) {
    var isRecipe = (kind === 'recipe');
    var name = it.name || '未命名';
    var en = isRecipe ? '' : (it.en || '');
    var meta = isRecipe
      ? (it.batchSize ? (num(it.batchSize, 0) + ' L') : '')
      : metaOf(kind, it);

    /* 原料类给「加入」，配方/风格类给「打开」 */
    var act = isRecipe ? 'recipe' : (kind === 'style' ? 'use-style' : 'add');
    var btn = isRecipe ? '打开' : (kind === 'style' ? '套用' : '加入');

    return '<div class="lp-res">' +
      '<span class="lp-res__body">' +
        '<span class="lp-res__t">' + esc(name) + (en ? '<i>' + esc(en) + '</i>' : '') + '</span>' +
        '<span class="lp-res__m">' + esc(meta) + '</span>' +
      '</span>' +
      '<button type="button" class="lp-res__add" data-lp="' + attr(act) + '"' +
        ' data-kind="' + attr(kind) + '" data-id="' + attr(it.id) + '"' +
        ' title="' + attr(btn === '加入' ? ('把「' + name + '」加入当前配方') : ('打开「' + name + '」')) + '">' +
        esc(btn) + '</button>' +
      '</div>';
  }

  function resultsHtml(q) {
    var res = searchAll(q);
    var head = '';

    if (res.bad) {
      return '<div class="lp-none"><span class="lp-none__t">这个写法不支持</span>' +
        '<span class="lp-none__d">' + esc(res.bad) + '</span></div>' +
        syntaxHelp();
    }

    if (res.empty) return '';

    if (res.nums && res.nums.length) {
      /* 只写"口径"，不重复用户刚输入的数字（搜索框里就是他的查询词）。
         这一行能放下是硬要求：说明若占 5 行，结果会被推到屏幕外。 */
      var nf = res.nums[0].field;
      head += '<div class="lp-note">' + (nf === 'aa'
        ? '按 ' + FIELD_ZH.aa + ' 区间筛选：值落在酒花自身的 aaMin–aaMax 内。'
        : FIELD_ZH.ibu + '口径：20 g / 60 分钟 / Tinseth · 批次 ' +
          num(recipe() && recipe().batchSize, 20) + ' L · 容差 ±20%') + '</div>';
    }

    if (!res.total) {
      return head +
        '<div class="lp-none"><span class="lp-none__t">没找到「' + esc(String(q).trim()) + '」</span>' +
        '<span class="lp-none__d">' +
          '六类都查过了：麦芽、酒花、酵母、辅料、风格、我的配方。' +
          '可以少写一个字试试（比如只写「citra」而不是「citra 酒花」），' +
          '或者换一个更宽的词（「柑橘」而不是「西柚皮」）。' +
        '</span></div>' + syntaxHelp();
    }

    var html = head;
    var left = 30;
    for (var g = 0; g < res.groups.length && left > 0; g++) {
      var grp = res.groups[g];
      var rows = '';
      var n = Math.min(grp.items.length, 8, left);
      for (var k = 0; k < n; k++) rows += resultRow(grp.kind, grp.items[k]);
      left -= n;
      html += secHtml(grp.zh, grp.items.length, rows);
      if (grp.items.length > n) {
        html += '<div class="lp-empty">还有 ' + (grp.items.length - n) + ' 条没显示，把关键词写具体一点。</div>';
      }
    }
    return html;
  }

  function syntaxHelp() {
    return '<div class="lp-none"><span class="lp-none__t">支持的三种写法</span>' +
      '<span class="lp-none__d">' +
        '<code>citra</code> 关键词（名称 / 风味 / 用途，多个词 = 同时命中）<br>' +
        '<code>aa 12</code> 酒花的 α 酸区间包含 12%<br>' +
        '<code>苦度 40</code> 酒花在 20 g / 60 分钟下的参考苦度 ≈ 40 IBU（±20%）<br>' +
        '不支持：<code>aa&gt;10</code>、<code>aa 10-14</code>、<code>hop:citra</code>。' +
      '</span></div>';
  }

  /* ==========================================================================
   * 五、动作
   * ========================================================================*/

  /** 切视图后等目标元素出现再动手（轮询而不是 setTimeout：渲染耗时不定） */
  function whenView(viewId, sel, fn, tries) {
    tries = tries || 0;
    var Shell = UI.Shell;
    if (!Shell) return;
    if (Shell.activeId() !== viewId) {
      if (tries === 0) Shell.go(viewId);
      if (tries > 60) return;
      root.setTimeout(function () { whenView(viewId, sel, fn, tries + 1); }, 45);
      return;
    }
    /* sel 为空 = 只等视图渲染完，不等某个元素。
       写成 `if (!el)` 会把"没给选择器"当成"元素没找到"而永远重试 —— 这条踩过。 */
    var el = sel ? document.querySelector(sel) : null;
    if (sel && !el) {
      if (tries > 60) return;
      root.setTimeout(function () { whenView(viewId, sel, fn, tries + 1); }, 45);
      return;
    }
    try { fn(el); } catch (e) { /* 单个动作失败不该把整个面板带崩 */ }
  }

  var BLOCK_TITLE = {
    malt: '麦芽与谷物', hop: '酒花', yeast: '酵母与发酵',
    adjunct: '辅料与其他添加', water: '水化学', mash: '糖化方案',
    /* v1.9 三个新工艺段的跳转锚点。标题必须与 42 里 card() 的 title 逐字一致
       （findCardByTitle 用 indexOf 匹配 card__head 的 h2）。 */
    whirlpool: '回旋沉淀', chill: '冷却与充氧', mature: '后熟与冷降'
  };

  /** 在配方页里找到标题为 title 的那张卡（卡片没有 id/class 区分区块，
   *  这是 42 号唯一的稳定标识：card__head 里的 h2 文本）。 */
  function findCardByTitle(title) {
    var cards = document.querySelectorAll('#view section.card');
    for (var i = 0; i < cards.length; i++) {
      var h = cards[i].querySelector('.card__head h2');
      if (h && (h.textContent || '').indexOf(title) >= 0) return cards[i];
    }
    return null;
  }

  function jumpToBlock(kind) {
    var title = BLOCK_TITLE[kind];
    if (!title) return;
    whenView('recipe', null, function () {
      var card = findCardByTitle(title);
      if (!card) {
        toast('配方页的「' + title + '」区块没找到', 'warn');
        return;
      }
      /* v1.7：**只滚这一次**。
         ⚠️ 这里原来还有两行 `view.scrollTop = Math.max(0, view.scrollTop - 8)`，
         本意是"顶边留 8px 呼吸位"。但 `.view` 上有 `scroll-behavior:smooth`，
         那次同步回写会**打断**上面刚启动的平滑滚动，并且以"旧 scrollTop − 8"
         作为新目标 —— 从页顶点任何一项，落点恒为 0，用户看到的是"点了没反应"
         （实测六个结构节点 scrollTop 全 0）。呼吸位改由 CSS 的
         `scroll-margin-top` 承担（见 css 里 `#view section.card`）：
         它在布局阶段就把目标位置抬高 8px，全过程只有一次滚动。 */
      try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { card.scrollIntoView(); }

      card.classList.add('is-lp-flash');
      if (flashTimer) root.clearTimeout(flashTimer);
      flashTimer = root.setTimeout(function () {
        card.classList.remove('is-lp-flash');
        flashTimer = 0;
      }, 1200);
    });
  }

  function toast(msg, kind) {
    if (UI.Shell && typeof UI.Shell.toast === 'function') UI.Shell.toast(msg, kind || 'info', 3200);
  }

  /** 打开一份已保存配方：点配方页自己的 #f-open 下拉，
   *  走它现成的 loadRecipe 路径（不在这里另写一份 setRecipe + render）。 */
  function openRecipe(id) {
    whenView('recipe', '#f-open', function (sel) {
      sel.value = id;
      if (sel.value !== id) { toast('这份配方不在「打开已保存配方」列表里', 'warn'); return; }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  /** 把某条原料加进当前配方 */
  function addItem(kind, id) {
    var r = recipe();
    if (!r) { toast('当前没有打开的配方', 'warn'); return; }
    var db = BREW.DB || {};
    var arr, row = null, label = '';

    if (kind === 'malt') {
      arr = db.malts || [];
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { row = BREW.Recipe.addFermentable(r, arr[i], 0.5); break; }
      label = '麦芽 0.5 kg';
    } else if (kind === 'hop') {
      arr = db.hops || [];
      for (var j = 0; j < arr.length; j++) if (arr[j].id === id) { row = BREW.Recipe.addHop(r, arr[j], 20, 'boil', 60); break; }
      label = '酒花 20 g · 60 分钟';
    } else if (kind === 'yeast') {
      arr = db.yeasts || [];
      for (var k = 0; k < arr.length; k++) if (arr[k].id === id) { row = BREW.Recipe.addYeast(r, arr[k], 11); break; }
      label = '酵母 11 g';
    } else if (kind === 'adjunct') {
      arr = db.adjuncts || [];
      for (var m = 0; m < arr.length; m++) if (arr[m].id === id) { row = BREW.Recipe.addAdjunct(r, arr[m]); break; }
      label = '辅料（按建议下限）';
    }
    if (!row) { toast('这条原料没有找到（原料库可能未载入）', 'warn'); return; }

    try { UI.publish(); } catch (e) { /* 计算失败也要让用户看到行已加上 */ }
    toast('已加入「' + (row.name || id) + '」· ' + label, 'ok');
    /* 配方页开着就重画一次：42 号不听 recipeChanged（它自己是发起方），
       不重画的话用户点完"加入"看不到新行，会以为没生效。 */
    if (UI.Shell.activeId() === 'recipe' && typeof UI.Shell.refresh === 'function') {
      UI.Shell.refresh();
    }
    LP.refresh();
  }

  /** 把某个风格套用到当前配方（走配方页自己的风格下拉，避免两套 fromStyle 路径） */
  function useStyle(styleId) {
    whenView('recipe', '#f-style', function (sel) {
      sel.value = styleId;
      if (sel.value !== styleId) { toast('配方页的风格下拉里没有这一项', 'warn'); return; }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function openBatch(id) {
    whenView('batch', '[data-batch="' + id + '"]', function (el) { el.click(); });
  }

  /* ==========================================================================
   * 六、装配与刷新
   * ========================================================================*/

  function treeHtml() {
    return secRecipe() + secProcess() + secOps();
  }

  function renderResults() {
    if (!resEl) return;
    resEl.innerHTML = query ? resultsHtml(query) : '';
  }

  function paint() {
    if (!treeEl) return;
    treeEl.innerHTML = treeHtml();
    if (query) renderResults();
  }

  /** 外部触发（配方变了 / 批次变了 / 切视图）。合并 150ms 内的多次调用：
   *  配方页每敲一个数字都会 publish 一次，逐次重建三棵树是白烧。 */
  LP.refresh = function () {
    if (refreshTimer) root.clearTimeout(refreshTimer);
    refreshTimer = root.setTimeout(function () {
      refreshTimer = 0;
      paint();
    }, 150);
  };

  LP.setQuery = function (q) {
    if (!inputEl) return;
    inputEl.value = String(q || '');
    onQuery();
  };
  LP.query = function () { return query; };

  function onQuery() {
    query = String(inputEl.value || '');
    if (clearEl) clearEl.hidden = !query;
    if (host) host.classList.toggle('is-search', !!query);
    if (treeEl) treeEl.hidden = !!query;
    if (resEl) {
      resEl.hidden = !query;
      if (query) renderResults();
      else resEl.innerHTML = '';
    }
  }

  function onClick(e) {
    var node = e.target;
    while (node && node !== host) {
      if (node.getAttribute && node.getAttribute('data-lp')) {
        var act = node.getAttribute('data-lp');
        var arg = node.getAttribute('data-arg');
        var kind = node.getAttribute('data-kind');
        var id = node.getAttribute('data-id');

        if (act === 'go') { if (UI.Shell) UI.Shell.go(arg); return; }
        if (act === 'sec') { toggleSec(arg); return; }
        if (act === 'jump') { jumpToBlock(arg); return; }
        if (act === 'recipe') { openRecipe(id || arg); return; }
        if (act === 'batch') { openBatch(arg || id); return; }
        if (act === 'add') { addItem(kind, id); return; }
        if (act === 'use-style') { useStyle(id); return; }
        return;
      }
      node = node.parentNode;
    }
  }

  LP.init = function () {
    host = document.getElementById('leftpanel');
    if (!host) return LP;

    loadCollapsed();   /* v1.8：折叠状态要在第一次渲染前读出来，否则会闪一下全展开 */

    host.innerHTML =
      '<div class="lp__search" role="search">' +
        '<span class="lp__search-ico">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
          'stroke-width="1.8" stroke-linecap="round"><circle cx="10.6" cy="10.6" r="6.4"/>' +
          '<path d="M15.4 15.4L20 20"/></svg>' +
        '</span>' +
        '<input class="lp__input" id="lp-q" type="search" autocomplete="off" spellcheck="false" ' +
          'aria-label="搜索麦芽、酒花、酵母、辅料、风格、配方" ' +
          'placeholder="搜原料 / 风格 / 配方…">' +
        '<button class="lp__clear" id="lp-clear" type="button" hidden aria-label="清空搜索">×</button>' +
      '</div>' +
      '<div class="lp__hint" id="lp-hint">试：<b>aa 12</b> · <b>苦度 40</b> · <b>citra</b></div>' +
      '<div class="lp__body">' +
        '<div id="lp-trees"></div>' +
        '<div class="lp__results" id="lp-results" hidden></div>' +
      '</div>';

    inputEl = document.getElementById('lp-q');
    clearEl = document.getElementById('lp-clear');
    treeEl = document.getElementById('lp-trees');
    resEl = document.getElementById('lp-results');

    var timer = 0;
    inputEl.addEventListener('input', function () {
      if (timer) root.clearTimeout(timer);
      timer = root.setTimeout(function () { timer = 0; onQuery(); }, 130);
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        inputEl.value = '';
        onQuery();
        inputEl.blur();
      }
    });
    clearEl.addEventListener('click', function () {
      inputEl.value = '';
      onQuery();
      inputEl.focus();     /* 这里可以抢焦点：用户刚点了"清空" */
    });
    host.addEventListener('click', onClick);

    paint();
    bindBus();
    return LP;
  };

  function bindBus() {
    if (!BREW.Bus || typeof BREW.Bus.on !== 'function' || LP._bound) return;
    LP._bound = true;
    var events = ['recipeChanged', 'recipeSaved', 'recipeDeleted',
      'batchSaved', 'batchDeleted', 'batchStatusChanged', 'dataReady',
      'dataImported', 'dataReset', 'customIngredientAdded', 'customIngredientRemoved'];
    for (var i = 0; i < events.length; i++) {
      (function (ev) {
        BREW.Bus.on(ev, function () { LP.refresh(); });
      })(events[i]);
    }
    /* 切视图只影响"当前项高亮"，重画一次很便宜（几十个节点） */
    BREW.Bus.on('viewChanged', function () { LP.refresh(); });
  }

})(typeof window !== 'undefined' ? window : globalThis);
