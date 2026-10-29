/* ============================================================================
 * 风月酿研所 — 53-ui-lineage.js
 * ----------------------------------------------------------------------------
 * 职责：「分析」视图的第二个页签 —— 配方谱系。
 *   把 BREW.Lineage.build(recipes) 的森林画成 DOM + SVG 的树：
 *   节点可点（载入到编辑器）、可 Tab，默认展开 2 层，支持逐节点展开 / 全部展开。
 *
 * 依赖：
 *   js/40-ui-shell.js      UI.esc/attr/num/fmt/icon/dt/clone/emptyState/store
 *                          UI.Shell.{confirm,toast,go}
 *   js/34-lineage-graph.js BREW.Lineage.build(recipes)（只出结构，不出坐标）
 *   js/31-classic-recipes.js BREW.DB.classicRecipes（补 classic: 节点的名字，可缺失）
 *   js/43-ui-diff.js       UI.Diff.reasonOf(id)（**可缺**：这一版为什么改 + 改动摘要；
 *                          缺了整块降级成"未填写"，树照画）
 *   宿主 js/51-ui-analysis.js 的 BREW.UI.Analysis.addTab()
 *
 * v1.4：节点上多了一层「为什么改」——谱系从"一串快照"变成"有理由的演化链"。
 *   两个层面显示，都是只读：
 *     · 悬浮：节点 title 的**第一行**就是这一版为什么改（原生 tooltip 认换行）
 *     · 选中：点节点里那行灰字，图下方出现一块详情，第一行同样是"为什么改"
 *   为什么不把这段字塞进节点里：.an-node 是固定 176×40 的绝对定位盒子，
 *   它的高度和 SVG 连线几何（NODE_H / ROW_H）是一对常量绑定，加第三行必然溢出；
 *   而 css/ 这一版不归本文件动。
 *
 * 谁在调：
 *   本文件在**加载期**自己往宿主注册页签；宿主缺席时静默跳过（不报错）。
 *
 * 为什么 DOM + SVG 而不是 canvas：
 *   节点要能点击、能键盘 Tab、能出 tooltip。canvas 里这些全要手写命中测试。
 *
 * 为什么容器必须带 .no-annotate：
 *   19-terms-annotate.js 的 EXCLUDE_SEL 不含 svg / 也不认我这些按钮，
 *   术语标注会把 <abbr> 塞进节点标题里，撑破单行省略号布局，且往 <text> 里塞
 *   内联元素是非法结构。
 *
 * 布局：每行一个节点（DFS 序），x 由层级决定、y 由行号决定。
 *   不用紧凑树算法（Reingold-Tilford）：家酿的谱系通常 3–6 代、一层没几个兄弟，
 *   紧凑算法换来的那点横向空间，不足以抵消它在环/孤儿/深链上的复杂度。
 *
 * 加载位置：js/52-ui-classic.js 之后、js/55-ui-report.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, fmt = UI.fmt, icon = UI.icon, num = UI.num;
  var A = UI.Analysis;

  var MAX_SAFE_NODES = 200;   /* 与 34-lineage-graph 的 MAX_NODES 对齐 */

  /* 几何量：与 v12-analysis.css 里的 .an-node 尺寸是一对，改一处要改两处 */
  var ROW_H = 50;
  var COL_W = 200;
  var NODE_W = 176;
  var NODE_H = 40;
  var PAD = 8;

  var openMap = {};        /* nodeId → true 表示子节点可见 */
  var sig = '';            /* 数据指纹：变了就重置展开状态 */
  var focusOnly = null;    /* true/false 手动切换；null 表示跟数据量自动决定 */

  /* ---------------- v1.4：为什么改 ----------------
     selectedId 是**视图状态**，不落库：它只表示"我现在在看哪个节点"。
     默认跟当前配方（curId），所以刚进这个页签时详情面板就有内容。 */
  var selectedId = '';

  /* reasonOf 会跑两次 calc + 一次 compare。200 个节点每次 paint 都重算是
     几百次计算换一句悬浮提示，不值。指纹用 rev + updatedAt；
     补写理由这两个都不变，所以另外订阅两个事件直接清表。 */
  var reasonCache = {};

  if (BREW.Bus && typeof BREW.Bus.on === 'function') {
    BREW.Bus.on('versionIntent', function () { reasonCache = {}; });
    BREW.Bus.on('recipeSaved', function () { reasonCache = {}; });
  }

  /** 这一版为什么改：优先 intent，其次改动摘要，都没有就是"未填写"。
   *  实现在 43（diff 与摘要的全部口径都在那儿），这里只取两个字段。 */
  function reasonOfNode(n) {
    if (!n || n.kind !== 'recipe' || !n.id) return null;
    if (!UI.Diff || typeof UI.Diff.reasonOf !== 'function') return null;
    var key = n.id + '#' + (n.rev || 1) + '#' + (n.updatedAt || 0);
    var c = reasonCache[n.id];
    if (c && c.sig === key) return c.reason;
    var reason = null;
    try { reason = UI.Diff.reasonOf(n.id); } catch (e) { reason = null; }
    reasonCache[n.id] = { sig: key, reason: reason };
    return reason;
  }

  /** 详情与提示的第一行。没有理由但有改动摘要时，**先说未填写再说改了什么**：
   *  把摘要直接顶到"为什么"的位置，用户会以为那是他当初写的理由。 */
  function reasonHeadline(reason) {
    if (reason && reason.intent) return reason.intent;
    if (reason && reason.digest) return '未填写（这一版改的是：' + reason.digest + '）';
    return '未填写';
  }

  /* ======================================================================
   * A. 取数与降级
   * ====================================================================*/

  function recipes() {
    try { return UI.store.recipes() || []; } catch (e) { return []; }
  }

  function buildGraph(list) {
    if (!BREW.Lineage || typeof BREW.Lineage.build !== 'function') return null;
    try { return BREW.Lineage.build(list); } catch (e) {
      UI.reportError(e, 'lineage.build');
      return null;
    }
  }

  /** classic:<id> 的名字要去经典库补；补不到就显示 id，不要显示空字符串 */
  function classicName(id) {
    var key = String(id || '').replace(/^classic:/, '');
    var list = (BREW.DB && Array.isArray(BREW.DB.classicRecipes)) ? BREW.DB.classicRecipes : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === key) return list[i].name || key;
    }
    return '经典配方 · ' + key;
  }

  function nodeTitle(n) {
    if (n.kind === 'classic') return classicName(n.id);
    if (n.name) return n.name;
    return n.kind === 'root' ? '（来源无法解析）' : '未命名配方';
  }

  /* ======================================================================
   * B. 可见行（DFS 序）+ 可达性
   * ----------------------------------------------------------------------
   * 为什么先算可达性：34 只把"父链能走到 null"的节点放进 roots，环上的节点
   * 父链互相指向，一个都不在 roots 里 —— 直接从 roots 走，环上那批节点会整个
   * 消失。所以要把"从根走不到"的节点补成一排伪根，否则用户会以为配方丢了。
   * ====================================================================*/

  function reachability(g) {
    var seen = {}, stack = g.roots.slice();
    while (stack.length) {
      var id = stack.pop();
      if (seen[id]) continue;
      seen[id] = true;
      var n = byId(g, id);
      if (!n) continue;
      for (var i = 0; i < n.childIds.length; i++) if (!seen[n.childIds[i]]) stack.push(n.childIds[i]);
    }
    return seen;
  }

  var byIdCache = {};
  function byId(g, id) {
    if (byIdCache.__g !== g) { byIdCache = { __g: g }; }
    if (!byIdCache[id]) {
      for (var i = 0; i < g.nodes.length; i++) if (g.nodes[i].id === id) { byIdCache[id] = g.nodes[i]; break; }
    }
    return byIdCache[id] || null;
  }

  /** 沿父链找根；环里会绕回自己，用 visited 兜住 */
  function rootOf(g, id) {
    var seen = {}, cur = id;
    while (cur && !seen[cur]) {
      seen[cur] = true;
      var n = byId(g, cur);
      if (!n) return null;
      if (!n.parentId) return n.id;
      cur = n.parentId;
    }
    return null;   /* 在环里：没有根 */
  }

  function displayRoots(g, focusId) {
    var seen = reachability(g);
    var extra = [];
    for (var i = 0; i < g.nodes.length; i++) {
      var n = g.nodes[i];
      /* classic 节点若不可达，说明它挂在一个走不到的地方，补成伪根比丢掉好 */
      if (!seen[n.id]) extra.push(n.id);
    }
    if (focusId) {
      var r = rootOf(g, focusId);
      if (r) return { ids: [r], focused: true };
      /* 当前配方不在图里（比如还没保存）：退回第一个根，并如实说明 */
      return { ids: g.roots.length ? [g.roots[0]] : extra.slice(0, 1), focused: false, missing: true };
    }
    return { ids: g.roots.concat(extra), focused: false };
  }

  function buildRows(g, rootIds) {
    var rows = [];
    var visited = {};   /* 已经出现在行里的节点 */
    var entered = {};   /* 走进去过的节点（在环里第二次遇到的不算） */

    /* 返回是否真的压了一行：父节点靠这个数判断"展开按钮按下去有没有东西" */
    function walk(id, depth) {
      if (visited[id]) return false;   /* 环在这里截断：第二次遇到就不再展开 */
      visited[id] = true;
      entered[id] = true;
      var n = byId(g, id);
      if (!n) return false;
      var open = !!openMap[id] && n.childIds.length > 0;
      var row = { n: n, depth: depth, open: open, shownKids: 0 };
      rows.push(row);
      if (!open) return true;
      for (var i = 0; i < n.childIds.length; i++) {
        if (walk(n.childIds[i], depth + 1)) row.shownKids++;
      }
      return true;
    }

    for (var i = 0; i < rootIds.length; i++) walk(rootIds[i], 0);

    /* 有没有"还能展开的东西"决定要不要画那个三角。
       两种情况会给一个按下去什么都不变的死按钮：
         · 环上的节点，子节点其实已经画在别处（visited 挡住了）
         · 全部子节点都已可见，再"展开"也不会多一行
       死按钮比没有按钮更糟——用户会以为界面卡了。 */
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var more = r.shownKids > 0;
      if (!more) {
        for (var c = 0; c < r.n.childIds.length; c++) {
          if (!entered[r.n.childIds[c]]) { more = true; break; }
        }
      }
      r.expandable = more;
    }
    return rows;
  }

  /* ======================================================================
   * C. 片段
   * ====================================================================*/

  var ISSUE = {
    missing: { badge: '来源已删', cls: 'is-missing', tip: '这条配方的来源指向一个已经不存在的配方（父配方被删了）。它按根节点显示，不会丢内容；想接回谱系，手工把来源改成现存配方。' },
    blank: { badge: '来源空白', cls: 'is-blank', tip: '来源字段是空白（不是被删）。这一条通常是复制粘贴或导入时带进来的，把来源字段改成某个配方即可接回谱系。' },
    stray: { badge: '来源格式不认', cls: 'is-stray', tip: '来源字段的格式不认识：既不是本地配方 id，也不是 classic: 前缀。常见于手工改过 JSON 或从旧版本迁入。' }
  };

  function legendHtml(g) {
    var items = [
      '<span class="an-legend__item"><i class="an-swatch an-swatch--recipe"></i>本地配方</span>',
      '<span class="an-legend__item"><i class="an-swatch an-swatch--classic"></i>经典配方库</span>',
      '<span class="an-legend__item"><i class="an-swatch an-swatch--root"></i>来源无法解析</span>'
    ];
    if (g.stats.orphanCount) {
      items.push('<span class="an-legend__item"><i class="an-swatch an-swatch--missing"></i>来源已删（' + g.stats.orphanCount + '）</span>');
    }
    if (g.stats.blankParentCount) {
      items.push('<span class="an-legend__item"><i class="an-swatch an-swatch--blank"></i>来源空白（' + g.stats.blankParentCount + '）</span>');
    }
    if (g.stats.strayCount) {
      items.push('<span class="an-legend__item"><i class="an-swatch an-swatch--stray"></i>来源格式不认（' + g.stats.strayCount + '）</span>');
    }
    if (g.stats.cycleCount) {
      items.push('<span class="an-legend__item"><i class="an-swatch an-swatch--cycle">↺</i>在环里（' + g.stats.cycleCount + ' 个环）</span>');
    }
    return '<div class="an-legend no-annotate">' + items.join('') + '</div>';
  }

  function nodeHtml(row, g, curId) {
    var n = row.n;
    var name = nodeTitle(n);
    var cls = 'an-node an-node--' + n.kind;
    if (n.cycle) cls += ' is-cycle';
    var issue = n.parentIssue && ISSUE[n.parentIssue] ? ISSUE[n.parentIssue] : null;
    if (issue) cls += ' ' + issue.cls;
    if (n.id === curId) cls += ' is-current';

    var left = PAD + row.depth * COL_W;
    var top = PAD + (row.idx === undefined ? 0 : row.idx) * ROW_H;

    var meta = [];
    if (n.kind === 'classic') meta.push('经典配方库');
    else if (n.kind === 'root') meta.push('来源无法解析');
    else if (n.rev > 1) meta.push('rev ' + fmt(n.rev, 0));
    if (n.updatedAt) meta.push(UI.dt(n.updatedAt));

    var badges = '';
    if (issue) {
      badges += '<span class="an-badge ' + issue.cls + '" title="' + attr(issue.tip) + '">' +
        esc(issue.badge) + '</span>';
    }
    if (n.cycle) {
      badges += '<span class="an-badge is-cycle" title="这条配方在一个循环引用里（A 的来源是 B，B 的来源是 A）。已在环上截断，不阻塞显示。">↺ 环</span>';
    }
    if (n.id === curId) {
      badges += '<span class="an-badge is-current" title="这是编辑器里正在编辑的配方">当前</span>';
    }

    /* v1.4：悬浮提示。**第一行是"为什么改"**（原始需求就是这么定的），
       完整配方名放最后一行——名字在节点里会被省略号截掉，得有个地方能看全。
       原生 title 认换行，所以这里直接用 '\n' 分行，不额外造 tooltip 组件。 */
    var reason = reasonOfNode(n);
    var tipLines = [];
    if (n.kind === 'recipe') {
      tipLines.push('为什么改：' + reasonHeadline(reason));
      if (reason && reason.digest) tipLines.push('改了什么：' + reason.digest);
      tipLines.push('第 ' + fmt(num(reason ? reason.rev : n.rev, 1), 0) + ' 版' +
        (n.updatedAt ? ' · ' + UI.dt(n.updatedAt) : ''));
    } else {
      tipLines.push(n.kind === 'classic'
        ? '来自经典配方库（不在这台机器的配方列表里，没有版本与理由）'
        : '来源无法解析，只是一个占位节点');
    }
    tipLines.push(name);
    var nodeTip = tipLines.join('\n');

    /* 可载入的只有本地配方：经典库条目不在 recipes 里，点了也没有可编辑的对象 */
    var sub = badges + (meta.length ? '<span class="an-node__meta">' + esc(meta.join(' · ')) + '</span>' : '');
    /* 灰字那行同时是"选中"的把手：点它看详情，点名字仍然是载入配方。
       data-intent 挂在这里而**不是**节点根上，就是为了不抢掉 data-load。 */
    var subHtml = sub
      ? '<span class="an-node__sub" data-intent="' + attr(n.id) + '" title="' +
        attr(nodeTip) + '">' + sub + '</span>'
      : '';
    var inner =
      '<span class="an-node__name" title="' + attr(nodeTip) + '">' + esc(name) + '</span>' +
      subHtml;

    /* 选中的节点给一圈虚线（is-current 已经有琥珀底色，两种状态可以叠加） */
    var selId = selectedId || curId;
    var selStyle = (n.kind === 'recipe' && n.id === selId)
      ? ';outline:1px dashed var(--amber-line);outline-offset:1px' : '';

    var body;
    if (n.kind === 'recipe') {
      body = '<button type="button" class="an-node__body" data-load="' + attr(n.id) + '" ' +
        'aria-label="载入配方：' + attr(name) + '">' + inner + '</button>';
    } else {
      body = '<span class="an-node__body an-node__body--static" ' +
        'title="' + attr(n.kind === 'classic' ? '来自经典配方库，不在这台机器的配方列表里，无法载入' : '来源无法解析，只是一个占位节点') + '">' + inner + '</span>';
    }

    var toggle = '';
    if (row.expandable) {
      toggle = '<button type="button" class="an-node__toggle" data-toggle="' + attr(n.id) + '" ' +
        'aria-expanded="' + (row.open ? 'true' : 'false') + '" ' +
        'aria-label="' + (row.open ? '折叠' : '展开') + '子配方（' + n.childIds.length + ' 个）">' +
        (row.open ? '▾' : '▸') + '</button>';
    }

    return '<div class="' + cls + '" style="left:' + left + 'px;top:' + top + 'px' + selStyle + '"' +
      ' data-node="' + attr(n.id) + '">' + body + toggle + '</div>';
  }

  /**
   * 图下方的「节点详情」（v1.4）。第一行永远是"为什么改"：
   * 看谱系时想知道的是"当时为什么改这一版"，比"改了几个字段"更靠前。
   * 选中态默认跟当前配方，所以刚进页签时这里就有内容，不会是一块空白。
   * 点节点里那行灰字切换选中的节点（点名字仍然是载入配方，两条路分开）。
   */
  function intentPanelHtml(g, curId) {
    var id = selectedId || curId;
    if (!id) return '';
    var n = byId(g, id);
    if (!n || n.kind !== 'recipe') return '';
    var reason = reasonOfNode(n);
    var headline = reasonHeadline(reason);
    /* 只能给"当前配方"补一句：别的配方不在编辑器里，
       30 的 setVersionIntent 写得进去，但用户看不到上下文，容易写错版本。 */
    var canFill = !!(reason && !reason.intent && reason.entry &&
      String(id) === String(curId) &&
      UI.Diff && typeof UI.Diff.openIntentEditor === 'function');
    var whatChanged = reason
      ? (reason.digest || (reason.hasPrev ? '这一版的改动不在原料/参数/指标里（可能是糖化步骤或备注）'
        : '这是第 1 版，没有上一版可比'))
      : '这份配方还没有历史版本';

    return '<div class="an-intent-panel no-annotate" data-intent-panel="' + attr(id) + '" ' +
      'style="margin-top:10px;padding:9px 12px;border:1px solid var(--line);' +
      'border-left:3px solid var(--amber);border-radius:var(--r-sm);background:var(--bg-2)">' +
      '<div style="font-size:14px;line-height:1.65">' +
        '<span class="u-xs" style="color:var(--amber-soft);margin-right:6px">为什么改</span>' +
        '<span data-intent-headline="' + attr(id) + '"' +
          (reason && reason.intent ? '' : ' class="u-dim"') + '>' + esc(headline) + '</span>' +
        (canFill ? ' <button type="button" class="btn btn-quiet btn-xs" ' +
          'data-intent-fill="' + attr(id) + '">补一句 ›</button>' : '') +
      '</div>' +
      '<div class="u-xs u-dim" style="margin-top:4px">改了什么：' + esc(whatChanged) + '</div>' +
      '<div class="u-xs u-dim" style="margin-top:2px">' + esc(nodeTitle(n)) +
        ' · 第 ' + fmt(num(reason ? reason.rev : n.rev, 1), 0) + ' 版' +
        (n.updatedAt ? ' · ' + UI.dt(n.updatedAt) : '') +
        (String(id) === String(curId) ? ' · 当前配方的节点' : '') +
      '</div>' +
      '</div>';
  }

  /** 连线的肘形路径：父右中 → 子左中。只画"下一层"的边：
      环上的反向边（子的父其实在更深一层）如果照画，会得到一段向左倒着走的线。 */
  function linesHtml(rows) {
    var pos = {};
    for (var i = 0; i < rows.length; i++) pos[rows[i].n.id] = rows[i];

    var d = '';
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (!r.n.parentId) continue;
      var p = pos[r.n.parentId];
      if (!p) continue;
      if (r.depth !== p.depth + 1) continue;
      var x1 = PAD + p.depth * COL_W + NODE_W;
      var y1 = PAD + p.idx * ROW_H + NODE_H / 2;
      var x2 = PAD + r.depth * COL_W - 6;
      var y2 = PAD + r.idx * ROW_H + NODE_H / 2;
      var mx = Math.round((x1 + x2) / 2);
      d += 'M' + x1 + ' ' + y1 + 'H' + mx + 'V' + y2 + 'H' + x2;
    }
    return d;
  }

  /* ======================================================================
   * D. 主渲染
   * ====================================================================*/

  function syncOpen(g) {
    var s = g.nodes.length + '|' + g.stats.maxDepth + '|' + g.roots.length + '|' +
      g.stats.orphanCount + '|' + g.stats.cycleCount + '|' + g.stats.blankParentCount + '|' + g.stats.strayCount;
    if (s === sig) return;
    sig = s;
    openMap = {};
    newDefaults(g);
  }

  /* 默认展开 2 层：深度 0 与 1 的节点展开，所以第 3 代也看得见 */
  function newDefaults(g) {
    for (var i = 0; i < g.nodes.length; i++) {
      var n = g.nodes[i];
      if (n.childIds.length && n.depth <= 1) openMap[n.id] = true;
    }
  }

  function expandAll(g) {
    openMap = {};
    for (var i = 0; i < g.nodes.length; i++) if (g.nodes[i].childIds.length) openMap[g.nodes[i].id] = true;
    paint();
  }

  /** 把某个节点的祖先链全部展开，让它出现在行里（环里会绕回自己，用 seen 兜） */
  function openAncestors(g, id) {
    var seen = {}, cur = id;
    while (cur && !seen[cur]) {
      seen[cur] = true;
      var n = byId(g, cur);
      if (!n || !n.parentId) break;
      openMap[n.parentId] = true;
      cur = n.parentId;
    }
  }

  function paint() {
    var host = document.getElementById('an-tree-host');
    if (!host) return;

    var list = recipes();
    if (!list.length) {
      host.innerHTML = UI.emptyState('还没有保存的配方',
        '谱系只统计已保存的配方：来源关系（parentId）写在配方对象上，草稿还没有 id 关系可连。' +
        '先保存一两份配方，或从经典配方库载入一份再保存，这里就会长出树来。', { art: 'chart' });
      return;
    }

    var g = buildGraph(list);
    if (!g) {
      host.innerHTML = UI.emptyState('谱系模块未载入',
        'js/34-lineage-graph.js 没有成功执行，谱系无法计算。其余页签不受影响。', { art: 'chart' });
      return;
    }
    if (!g.stats.total) {
      host.innerHTML = UI.emptyState('这份数据里没有节点', '配方列表存在，但没有任何带 id 的配方。', { art: 'chart' });
      return;
    }

    syncOpen(g);

    var cur = UI.recipe() || {};
    var curId = cur.id || '';

    /* 大图：只显示当前配方所在的谱系。判定放在这里而不是 CSS，因为
       把 200+ 个节点渲染出来再隐藏，滚动区还是 200 行高 */
    var big = g.stats.total > MAX_SAFE_NODES;
    var focus = (focusOnly === null) ? big : focusOnly;
    var pick = displayRoots(g, focus ? curId : null);

    var rows = buildRows(g, pick.ids);
    for (var i = 0; i < rows.length; i++) rows[i].idx = i;

    /* 行数变化时给"当前配方"定位：谱系长起来后用户最想立刻看到自己那一格 */
    var maxDepth = 0;
    for (var m = 0; m < rows.length; m++) if (rows[m].depth > maxDepth) maxDepth = rows[m].depth;

    var width = PAD * 2 + maxDepth * COL_W + NODE_W;
    var height = PAD * 2 + rows.length * ROW_H;

    var html = '';

    /* 大图聚焦模式下，当前配方可能埋在没展开的分支里：给一个一键展开到它的入口 */
    var curHidden = false;
    if (focus && curId) {
      curHidden = true;
      for (var q = 0; q < rows.length; q++) if (rows[q].n.id === curId) { curHidden = false; break; }
    }

    /* --- 概况 --- */
    /* 有多少节点写了"为什么改"。放在概况里而不是藏进 tooltip：
       这是 v1.4 唯一一条"数据质量"信号——全都没写，说明这条谱系只有快照没有理由。 */
    var intentN = 0;
    for (var z = 0; z < rows.length; z++) {
      var zr = reasonOfNode(rows[z].n);
      if (zr && zr.intent) intentN++;
    }

    html += '<div class="an-treebar">' +
      '<span class="an-treebar__stat">' + fmt(g.stats.total, 0) + ' 个节点</span>' +
      '<span class="an-treebar__stat">' + fmt(g.stats.rootCount, 0) + ' 条根</span>' +
      '<span class="an-treebar__stat">最深 ' + fmt(g.stats.maxDepth + 1, 0) + ' 代</span>' +
      '<span class="an-treebar__stat" data-intent-stat="' + intentN + '">' +
        fmt(intentN, 0) + ' 个写了理由</span>' +
      '<span class="spacer"></span>' +
      (curHidden ? '<button type="button" class="btn btn-ghost btn-sm" data-act="reveal">展开到当前配方</button>' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="expand-all">全部展开</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="collapse">收起到 2 层</button>' +
      (big
        ? '<button type="button" class="btn btn-ghost btn-sm" data-act="toggle-focus">' +
          (focus ? '看整张图' : '只看当前谱系') + '</button>'
        : '') +
      '</div>';

    if (big) {
      html += '<p class="an-note-line">' + icon('alert', 13) +
        '<span>共 ' + fmt(g.stats.total, 0) + ' 个节点，超过 ' + MAX_SAFE_NODES +
        ' 个后默认只画当前配方所在的那一支（整张图画出来既慢也没法读）。' +
        (pick.missing ? '当前配方不在谱系里（可能还没保存），先显示第一支。' : '') +
        '</span></p>';
    }

    if (g.stats.cycleCount) {
      html += '<p class="an-note-line an-note-line--warn">' + icon('alert', 13) +
        '<span>检测到 ' + fmt(g.stats.cycleCount, 0) + ' 个环（配方互相把对方当来源）。' +
        '已在这里截断，环上的节点标了 <b>↺ 环</b>；它们没有真正的根，所以单独排在图上。</span></p>';
    }

    html += legendHtml(g);

    /* --- 树 --- */
    html += '<div class="an-tree-scroll no-annotate">' +
      '<div class="an-tree" style="width:' + width + 'px;height:' + height + 'px">' +
        '<svg class="an-tree__lines" width="' + width + '" height="' + height + '" aria-hidden="true">' +
          '<path d="' + linesHtml(rows) + '"></path>' +
        '</svg>';
    for (var k = 0; k < rows.length; k++) html += nodeHtml(rows[k], g, curId);
    html += '</div></div>';

    /* --- 选中节点的详情（v1.4）：第一行是"为什么改" --- */
    html += intentPanelHtml(g, curId);

    /* --- 统计口径 & 提示 --- */
    if (!g.stats.maxDepth && g.stats.rootCount === g.stats.total) {
      html += '<p class="an-note-line">' + icon('info', 13) +
        '<span>这些配方之间还没有来源关系。从经典配方载入、或在配方页「另存为新版本」之后，来源（parentId）才会连起来。</span></p>';
    }

    if (g.warnings && g.warnings.length) {
      var lis = '';
      for (var w = 0; w < g.warnings.length; w++) lis += '<li>' + esc(g.warnings[w]) + '</li>';
      html += '<ul class="an-notes">' + lis + '</ul>';
    }

    html += '<p class="an-foot">' +
      '<b>口径</b>：谱系只认配方对象的 <code>parentId</code>：' +
      '本地配方显示为「父配方 id」，从经典库载入的显示为 <code>classic:&lt;id&gt;</code>（图上灰显，不在这台机器的配方列表里）。' +
      '来源指向不存在的配方、字段空白、格式不认识是三种不同情况，图例里分开标——' +
      '它们要做的动作分别是「认了」「去补字段」「去改格式」，不是同一件事。' +
      '点节点标题会把该配方载入编辑器；编辑器里有未保存内容时会先确认。' +
      '<br><b>为什么改</b>：节点悬浮时提示的第一行、以及图下方详情的第一行，都是<b>最新一版</b>的改动理由（保存时可选填，≤60 字）。' +
      '没写理由的节点显示它的改动摘要（复用版本对比的比对结果），两者都没有才是「未填写」。' +
      '点节点里那行灰字查看详情，点名字仍然是载入配方。' +
      '</p>';

    host.innerHTML = html;

    /* 首次进来把当前配方滚进视野（只在有当前节点时滚，避免刚打开就跳走） */
    var curEl = host.querySelector('.an-node.is-current');
    if (curEl && curEl.parentNode) {
      var sc = host.querySelector('.an-tree-scroll');
      if (sc) {
        var want = curEl.offsetTop - sc.clientHeight / 2;
        if (want > 0) sc.scrollTop = want;
      }
    }
  }

  /* ======================================================================
   * E. 交互
   * ====================================================================*/

  function currentHasUnsaved() {
    var cur = UI.recipe() || {};
    var rows = (cur.fermentables || []).length + (cur.hops || []).length +
      (cur.yeasts || []).length + (cur.adjuncts || []).length;
    if (!rows) return false;
    var list = recipes();
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === cur.id) return false;
    return true;   /* 有内容但列表里找不到这份 id → 没保存过 */
  }

  function findRecipe(id) {
    var list = recipes();
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  function loadInto(id) {
    var r = findRecipe(id);
    if (!r) {
      UI.Shell.toast('这条配方已经不在配方列表里了', 'error');
      return;
    }
    if (currentHasUnsaved()) {
      UI.Shell.confirm({
        title: '载入配方',
        message: '当前配方「' + ((UI.recipe() || {}).name || '未命名') + '」有未保存的改动，载入别的配方会覆盖它。',
        detail: '建议先点右上角「保存配方」，或导出备份后再切换。',
        okLabel: '覆盖并载入',
        danger: true
      }, function () { doLoad(r); });
      return;
    }
    doLoad(r);
  }

  function doLoad(r) {
    try {
      /* 深拷贝：编辑器之后的改动不应该写回列表里的同一份对象 */
      UI.setRecipe(UI.clone(r));
      UI.publish();
      UI.Shell.toast('已载入《' + (r.name || '未命名') + '》', 'ok');
      UI.Shell.go('recipe');
    } catch (e) {
      UI.reportError(e, 'lineage.load');
    }
  }

  function bind(box) {
    if (box.__lineageBound) return;
    box.__lineageBound = true;

    box.addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== box && node.nodeType === 1) {
        if (node.getAttribute) {
          /* v1.4：点节点里那行灰字 = 选中它（看图下方详情）。
             必须排在 data-load 之前：那行灰字在 <button data-load> 里面，
             从下往上走会先遇到它。点名字仍然是载入配方，两条路分开。 */
          if (node.getAttribute('data-intent') !== null) {
            var pick = node.getAttribute('data-intent');
            selectedId = (selectedId === pick) ? '' : pick;
            paint();
            return;
          }
          /* 详情里的「补一句 ›」：只有当前配方会出这个按钮（见 intentPanelHtml） */
          if (node.getAttribute('data-intent-fill') !== null) {
            var cid = (UI.recipe() || {}).id;
            var gg = buildGraph(recipes());
            var reason = reasonOfNode(gg ? byId(gg, cid) : null);
            if (reason && reason.entry && UI.Diff && UI.Diff.openIntentEditor) {
              UI.Diff.openIntentEditor(cid, reason.entry, function () {
                reasonCache = {};
                paint();
              });
            } else {
              UI.Shell.toast('这一版没有可写的条目（先保存一次）', 'warn', 3000);
            }
            return;
          }
          if (node.getAttribute('data-toggle') !== null) {
            var tid = node.getAttribute('data-toggle');
            if (openMap[tid]) delete openMap[tid]; else openMap[tid] = true;
            paint();
            return;
          }
          if (node.getAttribute('data-load') !== null) {
            loadInto(node.getAttribute('data-load'));
            return;
          }
          var act = node.getAttribute('data-act');
          if (act === 'expand-all') {
            var g = buildGraph(recipes());
            if (g) expandAll(g);
            return;
          }
          if (act === 'collapse') {
            var g2 = buildGraph(recipes());
            if (g2) { openMap = {}; newDefaults(g2); paint(); }
            return;
          }
          if (act === 'toggle-focus') {
            var g3 = buildGraph(recipes());
            var on = (focusOnly === null) ? (g3 && g3.stats.total > MAX_SAFE_NODES) : focusOnly;
            focusOnly = !on;
            paint();
            return;
          }
          if (act === 'reveal') {
            var g4 = buildGraph(recipes());
            if (g4) { openAncestors(g4, (UI.recipe() || {}).id); paint(); }
            return;
          }
        }
        node = node.parentNode;
      }
    });
  }

  function render(box) {
    if (!box) return;
    box.innerHTML = '<div id="an-tree-host"></div>';
    bind(box);
    paint();
  }

  /* ======================================================================
   * F. 注册
   * ====================================================================*/

  var Tab = UI.LineageTab = { id: 'lineage', label: '配方谱系', order: 20, render: render };

  if (A && typeof A.addTab === 'function') {
    A.addTab(Tab);
  } else if (root.console && console.warn) {
    /* 宿主没加载时只留一句提示，绝不抛错：另两个页签还要能用 */
    console.warn('[BrewLab] 51-ui-analysis.js 未就绪，谱系页签未注册');
  }

})(typeof window !== 'undefined' ? window : globalThis);
