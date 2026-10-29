/* ============================================================================
 * 风月酿研所 — 19 术语自动标注引擎
 * ----------------------------------------------------------------------------
 * 职责：把正文里的专业术语标成 <abbr class="term" data-term="...">，供 56-ui-terms
 *       挂悬停浮层与点击卡片。只负责"标"，不负责"显示"。
 * 依赖：16/17/18 号术语库（BREW.DB.glossary）
 *
 * 四条关键设计（都是踩坑换来的）：
 *
 * 1. **表格只标表头（th），表体（td）一律不标注。**
 *    `.table-wrap{overflow-x:auto}` 会裁切任何内部浮层；表格里数字密集、空间
 *    局促，加虚线下划线会让人分不清"术语"还是"可编辑字段"。而且原料库页有
 *    5000+ 文本节点，全标会掉到 20ms。
 *    这一条同时是布局决策和性能决策。
 *
 *    v1.9 修正：原来整张 `table` 都排除，结果"ppg""色度 °L""BU"这些**表头**
 *    也没有悬停 —— 而表头恰恰是读者最需要查一个词的地方（列名叫 ppg，不懂就是
 *    不懂）。现在只放行 `th`：
 *      · th 上没有点击语义（原料库的排序走独立的 state.sort 控件，不是点表头），
 *        所以加标注不会抢点击；
 *      · td 相反 —— 原料库的行是 `<tr role="button">`，标注会干扰"点一行展开"，
 *        所以 td 继续排除；
 *      · 表头数量是每表十几个，不是 5000 个，性能上等价于没放开。
 *
 * 2. **容器级去重，每个术语最多标 2 次。**
 *    起初我想按"每段落各标一次"，但那是块级粒度，比容器级更细 —— 一篇 8 段
 *    的正文里"糖化"最多会标 8 次，正好造成要避免的视觉灾难。
 *    改为整个容器内计数。上限 2 而不是 1：长文里首现可能已经滚出视口，
 *    "隔太远读者忘了"确实需要第二次机会。
 *
 *    v1.9 修正（重要）：这条注释一直这么写，但代码里的计数器是**整个 root
 *    共享一份**（原 `hydrate` 里的 `var seen = {}` 在循环外）。后果有两个，
 *    都在浏览器里实测到了：
 *      · 一个术语在整页最多只能标 2 次，第 3 处起永远标不上 —— 设置页
 *        "默认 IBU 模型"的 IBU 就是因为同页前两处吃光了配额而没有被标。
 *      · 不幂等：每次 hydrate 都重置计数，已标的被 TreeWalker 跳过、剩下的
 *        重新从 0 数，于是**每调一次就再多标一批**（经典配方页 76 → 122）。
 *    现在改成真正的容器级（容器 = 最近的块级祖先），并且计数会先读容器里
 *    **已有的** `abbr.term` 数量作为起点 —— 这样重复调用是幂等的，标过的
 *    不会翻倍。
 *
 * 3. **长词优先匹配。**
 *    "糖化休止"必须先于"糖化"命中，否则会被切成两段错标。
 *    靠正则 alternation 的顺序保证（长的排前面）。
 *
 * 4. **只拆分文本节点，绝不重写容器 innerHTML。**
 *    容器里有惰性下拉的 __filled 标记、有绑好事件的节点、有正在编辑的 input。
 *    重写 innerHTML 会让这些全部失效，并且让输入框失焦。
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  BREW.DB = BREW.DB || {};

  var Annotate = BREW.Annotate = {};

  /* 永不标注的容器。
     注意这里**没有 table**：表格改成"只放行 th"，判定在 acceptNode 里做
     （见本文件开头的第 1 条）。
     `.report-sheet` 是**打印卡本体**：屏幕上它就是那张要打出来的纸。给它加
     交互下划线，屏幕预览与打印结果就不一致了（打印侧 `@media print .term`
     会把下划线去掉）。v1.8 之前这张卡里有 9 处标注，改成容器级配额后会涨到
     28 处 —— 与其让它越标越花，不如按"预览=成品"的规矩整块排除。 */
  var EXCLUDE_SEL = '.term,.no-annotate,.report-sheet,code,pre,script,style,textarea,input,select,option,abbr,button';

  /* 表格内允许标注的单元格：只有表头。td 里有 role="button" 的行，不碰。 */
  var TABLE_CELL_SEL = 'th,td';

  /* 容器边界：判断"最近的块级祖先"用。容器级配额靠它划定。
     只列**块级**标签，不含 span/b/i 这类行内标签 —— 否则"初始比重 OG"这种
     一格里的两个写法会被拆到两个容器，配额就按行内碎片算了。 */
  var BLOCK_TAG = /^(DIV|SECTION|ARTICLE|ASIDE|LI|P|TD|TH|DT|DD|BLOCKQUOTE|FIGURE|FIGCAPTION|H1|H2|H3|H4|H5|H6|HEADER|FOOTER|MAIN|FORM|FIELDSET|DETAILS|SUMMARY|CAPTION)$/;

  /* 每个术语在一个容器内的最大标注次数 */
  var MAX_PER_TERM = 2;

  var _re = null;          /* 合并后的匹配正则 */
  var _nameToId = null;    /* 显示名 → 术语 id */
  var _maxLen = 0;         /* 最长术语长度，用于快速预筛 */
  var _enabled = true;

  /* --------------------------------------------------------------------
   * closest 兼容包：代码库里其它模块都是手写祖先循环，这里保持一致
   * ------------------------------------------------------------------*/
  function closestSafe(el, sel) {
    if (!el) return null;
    if (el.closest) {
      try { return el.closest(sel); } catch (e) { /* 某些老引擎对复杂选择器会抛 */ }
    }
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 30) {
      if (node.matches && node.matches(sel)) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* --------------------------------------------------------------------
   * 构建匹配表
   * ------------------------------------------------------------------*/
  function build() {
    if (_re && _nameToId) return;

    var list = BREW.DB.glossary || [];
    var map = {};
    var names = [];

    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (!g || !g.id || g.noAuto) continue;

      /* 主显示名（如 "IBU"、"糖化"） */
      if (g.term && String(g.term).length >= 2) {
        if (!map[g.term]) { map[g.term] = g.id; names.push(g.term); }
      }
      /* 中文名（如 "苦度"），与 term 不同时才加 */
      if (g.zh && g.zh !== g.term && String(g.zh).length >= 2) {
        if (!map[g.zh]) { map[g.zh] = g.id; names.push(g.zh); }
      }
      /* v1.9：别名表。`zh` 现在统一用**界面叫法**（"苦度"而不是"国际苦度单位"），
         于是学名就失去了被标注的能力 —— 而学名在术语库正文、论文引用里是会出现
         的。alias 把它们补回来：仍可悬停，只是不再作为卡片标题。
         同名冲突时先到先得，与 term/zh 的规则一致。 */
      if (g.alias && g.alias.length) {
        for (var a = 0; a < g.alias.length; a++) {
          var al = g.alias[a];
          if (al && String(al).length >= 2 && !map[al]) { map[al] = g.id; names.push(al); }
        }
      }
    }

    /* 长词优先：保证 "糖化休止" 不被 "糖化" 抢先 */
    names.sort(function (a, b) { return b.length - a.length; });

    _nameToId = map;
    _maxLen = names.length ? names[0].length : 0;
    if (names.length === 0) { _re = null; return; }

    _re = new RegExp('(' + names.map(escapeRe).join('|') + ')', 'g');
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* 英文术语的前后字符检查：避免 "OG" 命中 "LOG"、"IBU" 命中 "IBUs" */
  function isWordBoundary(text, start, end) {
    var isAsciiWord = /[A-Za-z0-9]/;
    var before = start > 0 ? text.charAt(start - 1) : '';
    var after = end < text.length ? text.charAt(end) : '';
    var first = text.charAt(start);
    var last = text.charAt(end - 1);

    if (isAsciiWord.test(first) && before && isAsciiWord.test(before)) return false;
    if (isAsciiWord.test(last) && after && isAsciiWord.test(after)) return false;
    return true;
  }

  /* --------------------------------------------------------------------
   * 容器级配额
   * --------------------------------------------------------------------
   * 容器 = 文本节点最近的**块级**祖先。给每个容器一张 id→次数 的表。
   * 表的初始值不是 0，而是容器里**已经存在的** `abbr.term` 数量 ——
   * 这样重复调用 hydrate 是幂等的：已经标过的不再计一次新配额。
   * （原实现每次从 0 重新数，而已标的节点被 walker 跳过，于是每调一次
   *   就把剩下的节点再标一批，经典配方页实测 76 → 122。）
   * ------------------------------------------------------------------*/
  var _countCache = null;

  function containerOf(el) {
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 40) {
      if (node.tagName && BLOCK_TAG.test(node.tagName)) return node;
      node = node.parentNode;
    }
    return el;
  }

  function countsOf(container) {
    if (_countCache) {
      var hit = _countCache.get(container);
      if (hit) return hit;
    }
    var counts = {};
    var els = container.querySelectorAll('abbr.term[data-term]');
    for (var i = 0; i < els.length; i++) {
      var id = els[i].getAttribute('data-term');
      if (id) counts[id] = (counts[id] || 0) + 1;
    }
    if (_countCache) _countCache.set(container, counts);
    return counts;
  }

  /* --------------------------------------------------------------------
   * 标注
   * ------------------------------------------------------------------*/
  Annotate.hydrate = function (rootEl) {
    if (!_enabled || !rootEl || rootEl.nodeType !== 1) return 0;
    build();
    if (!_re) return 0;

    /* 每次调用一张新的容器表：跨调用的幂等性由 countsOf 读 DOM 里的
       既有标注来保证，不靠这张表。 */
    _countCache = (typeof WeakMap === 'function') ? new WeakMap() : null;

    /* 先把所有文本节点收集起来。边遍历边改 DOM 会让 TreeWalker 错乱。 */
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p || p.nodeType !== 1) return NodeFilter.FILTER_REJECT;
        if (closestSafe(p, EXCLUDE_SEL)) return NodeFilter.FILTER_REJECT;
        /* 表格：只放行表头。td（尤其 role="button" 的行）不碰 */
        var table = closestSafe(p, 'table');
        if (table) {
          var cell = closestSafe(p, TABLE_CELL_SEL);
          if (!cell || !cell.tagName || cell.tagName.toUpperCase() !== 'TH') {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);

    var targets = [];
    var n;
    while ((n = walker.nextNode())) targets.push(n);

    var count = 0;

    for (var i = 0; i < targets.length; i++) {
      var textNode = targets[i];
      if (!textNode.parentNode) continue;      /* 可能已被前一轮替换掉 */
      count += annotateNode(textNode);
    }

    _countCache = null;
    return count;
  };

  /** 处理单个文本节点，返回标注个数 */
  function annotateNode(textNode) {
    var text = textNode.nodeValue;
    if (!text || text.length < 2) return 0;

    /* 快速排除：文本里不可能有术语就直接跳过（省掉大部分正则开销） */
    _re.lastIndex = 0;
    if (!_re.test(text)) return 0;

    var seen = countsOf(containerOf(textNode.parentNode));

    _re.lastIndex = 0;
    var hits = [];
    var m;
    while ((m = _re.exec(text)) !== null) {
      var word = m[1];
      var id = _nameToId[word];

      /* 防零宽匹配死循环：先推进，再判断 */
      if (m.index === _re.lastIndex) _re.lastIndex++;

      if (!id) continue;
      if ((seen[id] || 0) >= MAX_PER_TERM) continue;
      if (!isWordBoundary(text, m.index, m.index + word.length)) continue;

      seen[id] = (seen[id] || 0) + 1;
      hits.push({ start: m.index, len: word.length, id: id, word: word });
    }

    if (hits.length === 0) return 0;

    /* 一次性重建该文本节点：前面的文本 + <abbr> + 中间的文本 + ... + 尾部
       比"从后往前多次 replaceChild"简单得多，也不会踩到父节点引用失效的坑。 */
    var frag = document.createDocumentFragment();
    var cursor = 0;

    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (h.start > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, h.start)));
      }
      var abbr = document.createElement('abbr');
      abbr.className = 'term';
      abbr.setAttribute('data-term', h.id);
      abbr.setAttribute('tabindex', '0');
      abbr.setAttribute('aria-label', h.word + '，按回车查看释义');
      abbr.textContent = h.word;
      frag.appendChild(abbr);
      cursor = h.start + h.len;
    }

    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }

    if (textNode.parentNode) {
      textNode.parentNode.replaceChild(frag, textNode);
    }

    return hits.length;
  }

  /* --------------------------------------------------------------------
   * 反向：去掉所有标注（设置里关掉"自动标注"时用）
   * ------------------------------------------------------------------*/
  Annotate.strip = function (rootEl) {
    if (!rootEl) return 0;
    var marks = rootEl.querySelectorAll('abbr.term[data-term]');
    var count = 0;
    for (var i = marks.length - 1; i >= 0; i--) {
      var el = marks[i];
      var parent = el.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      count++;
      if (parent.normalize) parent.normalize();
    }
    return count;
  };

  /* --------------------------------------------------------------------
   * 开关
   * ------------------------------------------------------------------*/
  Annotate.setEnabled = function (on) { _enabled = !!on; };
  Annotate.isEnabled = function () { return _enabled; };

  /* --------------------------------------------------------------------
   * 供 UI 层查询
   * ------------------------------------------------------------------*/
  Annotate.getTerm = function (id) {
    var list = BREW.DB.glossary || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  };

  /* 分类中文名，给术语卡的分类徽章用 */
  BREW.DB.glossaryCats = {
    metric:     { zh: '指标与单位', color: '#7398ab' },
    mash:       { zh: '糖化',       color: '#ab9f73' },
    ferment:    { zh: '发酵',       color: '#769873' },
    process:    { zh: '工艺',       color: '#be9558' },
    ingredient: { zh: '原料',       color: '#a17852' },
    water:      { zh: '水化学',     color: '#7698ab' },
    style:      { zh: '感官与风格', color: '#867ca1' }
  };

  /* --------------------------------------------------------------------
   * 清理悬空的 related 引用
   * --------------------------------------------------------------------
   * 术语卡的"相关术语"是渲染成可点击 chip 的。如果 related 指向一个不存在的
   * id，用户点下去会没反应——比不显示更糟。加载时统一过滤一遍。
   * ------------------------------------------------------------------*/
  Annotate.sanitizeRelated = function () {
    var list = BREW.DB.glossary || [];
    var ids = {};
    var i;
    for (i = 0; i < list.length; i++) { if (list[i] && list[i].id) ids[list[i].id] = true; }

    var removed = 0;
    for (i = 0; i < list.length; i++) {
      var g = list[i];
      if (!g || !g.related || !g.related.length) continue;
      var before = g.related.length;
      g.related = g.related.filter(function (r) { return !!ids[r]; });
      removed += before - g.related.length;
    }
    return removed;
  };

  /* 模块加载时自清理：此时 16/17/18 三个词库都已就绪 */
  if (BREW.DB.glossary && BREW.DB.glossary.length) {
    Annotate.sanitizeRelated();
  }

  /* --------------------------------------------------------------------
   * 自检（供 tools/selftest.js 调用）
   * ------------------------------------------------------------------*/
  Annotate.selfCheck = function () {
    var list = BREW.DB.glossary || [];
    var ids = {}, errors = [], warns = [];
    var catCount = {};

    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (!g.id) { errors.push('第 ' + i + ' 条缺 id'); continue; }
      if (ids[g.id]) errors.push('重复 id: ' + g.id);
      ids[g.id] = true;

      if (!g.term) errors.push(g.id + ' 缺 term');
      if (!g.brief) errors.push(g.id + ' 缺 brief（悬停浮层会空白）');
      if (!g.def) errors.push(g.id + ' 缺 def');
      /* en 与 role 是术语卡上真会渲染的字段（56-ui-terms.js 的「英文对照」「在酿造中的作用」），
         缺了不会报错，只会让卡片空一块——比崩更难发现，所以这里必须拦。 */
      if (!g.en) warns.push(g.id + ' 缺 en（卡片上的英文对照会是空的）');
      if (!g.role) warns.push(g.id + ' 缺 role（卡片上的"在酿造中的作用"会是空的）');
      if (g.brief && g.brief.length > 80) warns.push(g.id + ' brief 超 80 字符（' + g.brief.length + '）');
      if (!g.myth) warns.push(g.id + ' 缺 myth（这是最有价值的字段）');
      if (!g.cat) warns.push(g.id + ' 缺 cat');

      catCount[g.cat] = (catCount[g.cat] || 0) + 1;
    }

    /* related 引用完整性 */
    for (var j = 0; j < list.length; j++) {
      var rel = list[j].related || [];
      for (var k = 0; k < rel.length; k++) {
        if (!ids[rel[k]]) warns.push(list[j].id + ' 的 related 指向不存在的 ' + rel[k]);
      }
    }

    return {
      total: list.length,
      byCat: catCount,
      errors: errors,
      warns: warns,
      ok: errors.length === 0
    };
  };

})(typeof window !== 'undefined' ? window : globalThis);
