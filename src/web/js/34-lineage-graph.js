/* ============================================================================
 * 风月酿研所 — 34 配方谱系图（Lineage Graph）
 * ----------------------------------------------------------------------------
 * 职责：把一堆配方按 parentId 整理成一张可画的森林，并把三件脏事处理掉：
 *       断链（父配方被删）、外来源（classic:*）、环（导入的 JSON 可能自指）。
 *
 * 为什么单独一个纯模块：树怎么排、环怎么截断，这些是算法不是绘画。
 *   埋在 DOM 代码里就没法在 node 里验"3 代 + orphan + 环"这种构造数据。
 *
 * 只产出结构，不产出坐标：节点坐标由界面算（DOM + SVG 连线，不用 canvas）。
 * **不读 DB、不读 Store、不取当前时间**——经典库的名字由调用方按 `kind/id` 去补。
 *
 * 前置依赖：30-recipe.js（Recipe.parentRef —— 解析来源只认它，本文件不自己拆前缀）
 * 加载位置：应在 js/33-inventory.js 之后、js/35-batch.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var Lineage = BREW.Lineage = {};

  var MAX_NODES = 200;
  var MAX_REASONABLE_DEPTH = 4;

  function s(v) {
    return (v === null || v === undefined) ? '' : String(v);
  }

  /* ======================================================================
   * 主函数
   * ----------------------------------------------------------------------
   * @param {Array} recipes 配方数组（普通对象即可，只要 id / parentId / name / rev）
   * @returns {{
   *   nodes: Array<{id,name,rev,updatedAt,parentId,kind,depth,childIds,
   *                 orphan,cycle,blankParent,stray,parentIssue}>,
   *   roots: string[], orphans: string[], blankParent: string[], stray: string[],
   *   cycles: string[][],
   *   stats: {total,maxDepth,rootCount,orphanCount,cycleCount,
   *           blankParentCount,strayCount},
   *   warnings: string[]
   * }}
   *
   * 三种"来源有问题"必须分开，因为对用户说的话完全不同：
   *   orphan      = 来源指向一个**确实不存在**的本地配方 → 「已被删除」
   *   blankParent = 来源字段是纯空白（'   '）        → 「字段是空白，改一下就能接回」
   *   stray       = 来源长得像别的东西（'Classic:x'）→ 「格式不认识」
   * 判据：警告里的每个词都要能被数据支撑。把空白说成"已被删除"，是在陈述
   * 一件用户没做过的事。
   *   kind: 'recipe'  输入里的真实配方
   *         'classic' 由 parentId='classic:<id>' 造出来的外部根节点（不在 recipes 里）
   *         'root'    父引用无法归类时的兜底节点（脏数据，正常不该出现）
   * ====================================================================*/
  Lineage.build = function (recipes) {
    var list = Array.isArray(recipes) ? recipes.filter(function (r) { return r && r.id; }) : [];
    var warnings = [];
    var cycles = [];

    var parentRef = BREW.Recipe && BREW.Recipe.parentRef;
    if (typeof parentRef !== 'function') {
      /* 不自己实现一套前缀解析：两份解析器一定会漂。宁可整体降级成"全是根"并说清楚。 */
      warnings.push('BREW.Recipe.parentRef 未加载（检查脚本顺序），本次不解析来源，全部按根节点显示');
      parentRef = function () { return { kind: 'root', id: null }; };
    }

    var byId = {};
    var nodes = [];

    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var n = {
        id: String(r.id),
        name: s(r.name) || '未命名配方',
        rev: isFinite(parseFloat(r.rev)) ? parseFloat(r.rev) : 1,
        updatedAt: isFinite(parseFloat(r.updatedAt)) ? parseFloat(r.updatedAt) : 0,
        parentId: r.parentId === undefined ? null : r.parentId,
        kind: 'recipe',
        depth: 0,
        childIds: [],
        orphan: false,
        cycle: false,
        blankParent: false,
        stray: false,
        parentIssue: null
      };
      byId[n.id] = n;
      nodes.push(n);
    }

    /* ---- 1. 建边（同时造 classic / root 兜底节点） ---- */
    var extra = [];
    function ensureNode(id, kind) {
      if (byId[id]) return byId[id];
      var n = {
        id: id, name: '', rev: 1, updatedAt: 0,
        parentId: null, kind: kind, depth: 0,
        childIds: [], orphan: false, cycle: false,
        blankParent: false, stray: false, parentIssue: null
      };
      byId[id] = n;
      extra.push(n);
      return n;
    }

    var blankParent = [];   /* parentId 是纯空白：用户"没填对"，不是"删了" */
    var stray = [];         /* parentId 长得像别的东西（如 'Classic:x'）：也不是"删了" */

    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];

      /* 先判"空白来源"。必须在调 parentRef 之前判：parentRef 不做 trim
         （那是 30-recipe 的既定语义，改它要动 35/46 的回归），
         而 ' ' 会被它当成一个普通的 recipe id，最后落进"父配方已被删除"——
         那句话是**错的**：用户没删任何东西，只是有个字段填了空格。
         判据：警告里的每个词都要能被数据支撑。 */
      var rawParent = (node.parentId === null || node.parentId === undefined)
        ? '' : String(node.parentId);
      if (rawParent.length > 0 && rawParent.trim() === '') {
        node.blankParent = true;
        node.parentIssue = 'blank';
        node.parentId = null;
        blankParent.push(node.id);
        continue;
      }

      var ref;
      try {
        ref = parentRef(node.parentId);
      } catch (e) {
        ref = { kind: 'root', id: null };
        warnings.push('节点 ' + node.id + ' 的来源引用解析失败（' + (e && e.message) + '），按根节点处理');
      }
      if (!ref || !ref.kind) ref = { kind: 'root', id: null };

      if (ref.kind === 'root') {
        node.parentId = null;
        continue;
      }

      if (ref.kind === 'classic') {
        /* 'classic:  '（前缀后面只有空白）也算空白来源，不要造一个名字为空的灰节点 */
        if (s(ref.id).trim() === '') {
          node.blankParent = true;
          node.parentIssue = 'blank';
          node.parentId = null;
          blankParent.push(node.id);
          continue;
        }
        var cid = 'classic:' + s(ref.id);
        var cnode = ensureNode(cid, 'classic');
        node.parentId = cid;
        cnode.childIds.push(node.id);
        continue;
      }

      if (ref.kind === 'recipe') {
        var pid = s(ref.id);
        if (pid === node.id) {
          /* 自指：一个节点不可能自己是自己的来源 */
          node.cycle = true;
          node.parentId = null;
          cycles.push([node.id]);
          continue;
        }
        if (!byId[pid]) {
          /* 分两种情况，因为对用户说的话完全不同：
             · 含冒号但不是 classic: 前缀（'Classic:x' / '  classic:x'）→ 来源写错了格式
             · 其它（'r-xxx'）→ 指向一个确实不存在的本地配方，才是"已被删除" */
          if (pid.indexOf(':') >= 0) {
            node.stray = true;
            node.parentIssue = 'stray';
            node.parentId = null;
            stray.push(node.id);
          } else {
            node.orphan = true;
            node.parentIssue = 'missing';
            node.parentId = null;
          }
          continue;
        }
        node.parentId = pid;
        byId[pid].childIds.push(node.id);
        continue;
      }

      /* 认不出的 kind：造一个兜底根节点，别把关系悄悄丢掉 */
      var rid = s(ref.id) || ('unknown:' + node.id);
      var rnode = ensureNode(rid, 'root');
      node.parentId = rid;
      rnode.childIds.push(node.id);
    }

    var all = nodes.concat(extra);

    /* ---- 2. 深度：从所有根 BFS（每个节点只有一个父，所以是森林不是图） ---- */
    var roots = [];
    for (var k = 0; k < all.length; k++) {
      if (!all[k].parentId) roots.push(all[k].id);
    }

    var visited = {};
    function bfsFrom(startIds, depth0) {
      var queue = [];
      for (var q = 0; q < startIds.length; q++) {
        var id = startIds[q];
        if (visited[id]) continue;
        visited[id] = true;
        byId[id].depth = depth0 || 0;
        queue.push(id);
      }
      var head = 0;
      while (head < queue.length) {
        var cur = byId[queue[head++]];
        for (var c = 0; c < cur.childIds.length; c++) {
          var cid2 = cur.childIds[c];
          if (visited[cid2]) continue;
          visited[cid2] = true;
          byId[cid2].depth = cur.depth + 1;
          queue.push(cid2);
        }
      }
    }

    bfsFrom(roots, 0);

    /* ---- 3. 环：剩下的未访问节点必然在有环的连通块里 ----
       每个节点只有一个父，所以"沿父链一直走"一定会撞回自己。 */
    for (var m = 0; m < all.length; m++) {
      var start = all[m];
      if (visited[start.id]) continue;

      var path = [], pos = {};
      var cur2 = start.id;
      while (cur2 && !visited[cur2] && pos[cur2] === undefined) {
        pos[cur2] = path.length;
        path.push(cur2);
        cur2 = byId[cur2].parentId;
      }

      if (cur2 && pos[cur2] !== undefined) {
        var loop = path.slice(pos[cur2]);
        for (var c2 = 0; c2 < loop.length; c2++) byId[loop[c2]].cycle = true;
        loop = loop.slice().sort();
        /* 同一个环可能从不同入口被走两遍，按排序后的 id 串去重 */
        var sig = loop.join('>');
        var dup = false;
        for (var d = 0; d < cycles.length; d++) {
          if (cycles[d].join('>') === sig) { dup = true; break; }
        }
        if (!dup) cycles.push(loop);
        /* 环上的节点按"根"来排版（深度 0），挂在环下面的子树从它们往下长 */
        bfsFrom(loop, 0);
      }
      /* 整块标记已访问，避免重复检出同一个环 */
      for (var p2 = 0; p2 < path.length; p2++) visited[path[p2]] = true;
    }

    /* ---- 4. 统计 ---- */
    var maxDepth = 0;
    for (var t = 0; t < all.length; t++) {
      if (all[t].depth > maxDepth) maxDepth = all[t].depth;
    }

    var orphans = [];
    for (var o = 0; o < all.length; o++) {
      if (all[o].orphan) orphans.push(all[o].id);
    }

    var stats = {
      total: all.length,
      maxDepth: maxDepth,
      rootCount: roots.length,
      orphanCount: orphans.length,
      cycleCount: cycles.length,
      blankParentCount: blankParent.length,
      strayCount: stray.length
    };

    /* ---- 5. 警告：都写成"界面要做什么"，不是"发生了什么" ---- */
    if (maxDepth > MAX_REASONABLE_DEPTH) {
      warnings.push('谱系有 ' + (maxDepth + 1) + ' 代（深度 ' + maxDepth + '），界面应默认折叠到 2 层');
    }
    if (all.length > MAX_NODES) {
      warnings.push('节点数 ' + all.length + ' 超过 ' + MAX_NODES + '，界面应只显示当前配方的谱系而不是全图');
    }
    if (orphans.length) {
      warnings.push(orphans.length + ' 个配方的来源已被删除，它们按根节点显示（不是数据损坏）');
    }
    if (blankParent.length) {
      warnings.push(blankParent.length + ' 个配方的来源字段是空白，按根节点显示（改一下这个字段就能接回谱系）');
    }
    if (stray.length) {
      warnings.push(stray.length + ' 个配方的来源字段格式不认识（既不是本地配方 id 也不是 classic: 前缀），按根节点显示');
    }
    if (cycles.length) {
      warnings.push('检测到 ' + cycles.length + ' 个环（数据里有循环引用），已在环上截断，不阻塞显示');
    }

    return {
      nodes: all,
      roots: roots,
      orphans: orphans,
      blankParent: blankParent,
      stray: stray,
      cycles: cycles,
      stats: stats,
      warnings: warnings
    };
  };

  /* ======================================================================
   * 自检
   * ====================================================================*/
  Lineage.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    /* 1. 三代链 + orphan + 环 + 经典来源 */
    var recipes = [
      { id: 'r1', name: '初代', parentId: null, rev: 1 },
      { id: 'r2', name: '二代', parentId: 'r1', rev: 1 },
      { id: 'r3', name: '三代', parentId: 'r2', rev: 1 },
      /* orphan：父 r-gone 不存在 */
      { id: 'r4', name: '孤儿', parentId: 'r-gone', rev: 1 },
      /* 环：r5 ↔ r6 */
      { id: 'r5', name: '环甲', parentId: 'r6', rev: 1 },
      { id: 'r6', name: '环乙', parentId: 'r5', rev: 1 },
      /* 经典来源 */
      { id: 'r7', name: '来自经典', parentId: 'classic:c-stout', rev: 1 }
    ];
    var g = Lineage.build(recipes);

    ok('节点数 = 7 配方 + 1 经典', g.stats.total === 8, String(g.stats.total));
    /* 环上的两个节点有父（互为父），所以不算根：根 = r1 / r4(孤儿) / classic */
    ok('根节点 3 个（r1 / r4 / classic）', g.stats.rootCount === 3 && g.roots.indexOf('r1') >= 0,
      JSON.stringify(g.roots));
    ok('orphan 1 个', g.stats.orphanCount === 1 && g.orphans[0] === 'r4', JSON.stringify(g.orphans));
    ok('环 1 个', g.stats.cycleCount === 1, JSON.stringify(g.cycles));
    ok('环内 id 升序且含 r5/r6', g.cycles[0] && g.cycles[0].join(',') === 'r5,r6', JSON.stringify(g.cycles[0]));
    ok('环上节点标 cycle', (function () {
      var m = {};
      g.nodes.forEach(function (n) { m[n.id] = n; });
      return m.r5.cycle === true && m.r6.cycle === true;
    })());

    var m2 = {};
    g.nodes.forEach(function (n) { m2[n.id] = n; });
    ok('三代深度 0/1/2', m2.r1.depth === 0 && m2.r2.depth === 1 && m2.r3.depth === 2,
      [m2.r1.depth, m2.r2.depth, m2.r3.depth].join('/'));
    ok('maxDepth = 2', g.stats.maxDepth === 2, String(g.stats.maxDepth));
    ok('经典节点 kind=classic 且不在 recipes 里', m2['classic:c-stout'] && m2['classic:c-stout'].kind === 'classic');
    ok('classic 是根节点', m2['classic:c-stout'].parentId === null);
    ok('childIds 正确', m2.r1.childIds.length === 1 && m2.r1.childIds[0] === 'r2');
    ok('有 orphan 警告', g.warnings.some(function (w) { return /来源已被删除/.test(w); }));
    ok('有环警告', g.warnings.some(function (w) { return /循环引用/.test(w); }));

    /* 2. 自指：不能死循环 */
    var self = Lineage.build([{ id: 'x', name: '自指', parentId: 'x' }]);
    ok('自指被判为环', self.stats.cycleCount === 1 && self.nodes[0].cycle === true,
      JSON.stringify(self.stats));

    /* 3. 深链 >4 代要警告 */
    var deep = [];
    for (var i = 0; i < 6; i++) {
      deep.push({ id: 'd' + i, name: '第' + i + '代', parentId: i === 0 ? null : 'd' + (i - 1) });
    }
    var gd = Lineage.build(deep);
    ok('深链深度 = 5', gd.stats.maxDepth === 5, String(gd.stats.maxDepth));
    ok('深链触发折叠警告', gd.warnings.some(function (w) { return /折叠/.test(w); }));

    /* 4. 脏输入 */
    var empty = Lineage.build(null);
    ok('null 入参不崩', empty.stats.total === 0 && empty.roots.length === 0);
    var junk = Lineage.build([null, {}, { id: 'ok', name: '', parentId: '' }]);
    ok('空对象被过滤', junk.stats.total === 1, String(junk.stats.total));
    ok('空名字有兜底', junk.nodes[0].name === '未命名配方', junk.nodes[0].name);

    /* 5. 空白来源 / 怪格式来源：不能混进"已被删除" */
    var gBlank = Lineage.build([{ id: 'w1', name: '空白来源', parentId: '   ' }]);
    ok('空白 parentId 进 blankParent', gBlank.blankParent.length === 1 && gBlank.blankParent[0] === 'w1',
      JSON.stringify(gBlank.blankParent));
    ok('空白 parentId 不算 orphan', gBlank.stats.orphanCount === 0, String(gBlank.stats.orphanCount));
    ok('空白来源的节点打 parentIssue=blank', gBlank.nodes[0].parentIssue === 'blank');
    ok('空白来源的警告不提"删除"', (function () {
      var w = gBlank.warnings.join(' ');
      return /空白/.test(w) && !/删除/.test(w);
    })(), gBlank.warnings.join(' | '));
    ok('空白来源仍按根显示', gBlank.nodes[0].parentId === null && gBlank.roots[0] === 'w1');

    var gStray = Lineage.build([{ id: 's1', name: '怪前缀', parentId: 'Classic:x' }]);
    ok('Classic:x 进 stray', gStray.stray.length === 1 && gStray.stray[0] === 's1',
      JSON.stringify(gStray.stray));
    ok('怪格式不算 orphan', gStray.stats.orphanCount === 0, String(gStray.stats.orphanCount));
    ok('怪格式的警告不提"删除"', !/删除/.test(gStray.warnings.join(' ')), gStray.warnings.join(' | '));

    /* 真正的断链仍然是 orphan，措辞不变 */
    var gGone = Lineage.build([{ id: 'o1', name: '父被删', parentId: 'r-gone' }]);
    ok('父不存在仍是 orphan', gGone.orphans[0] === 'o1' && gGone.stats.orphanCount === 1);
    ok('断链的警告仍是"已被删除"', /已被删除/.test(gGone.warnings.join(' ')));
    var gClassicBlank = Lineage.build([{ id: 'cb', name: 'classic 空 id', parentId: 'classic:  ' }]);
    ok('classic: 后只有空白 → blankParent', gClassicBlank.blankParent[0] === 'cb' &&
      gClassicBlank.nodes.length === 1, JSON.stringify(gClassicBlank.stats));

    ok('三种情况互不重叠',
      gBlank.blankParent.length + gBlank.stray.length + gBlank.orphans.length === 1 &&
      gStray.blankParent.length + gStray.stray.length + gStray.orphans.length === 1);

    /* 6. 大图警告 */
    var big = [];
    for (var b = 0; b < 205; b++) big.push({ id: 'b' + b, name: 'n' + b, parentId: null });
    var gb = Lineage.build(big);
    ok('超 200 节点有警告', gb.warnings.some(function (w) { return /超过 200/.test(w); }));

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
