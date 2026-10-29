/* ============================================================================
 * 风月酿研所 — 52-ui-classic.js
 * ----------------------------------------------------------------------------
 * 职责：经典配方库视图（v1.7 扩到 109 条 + 用户自建配方的"自定义"条目）。
 *   1. 浏览 / 搜索 / 按风格大类、年代、国家与洲、风味标签、来源筛选 / 三种排序
 *   2. 卡片摘要 + 展开详情（完整原料表、糖化方案、背景故事、酵母的一发/二发天数）
 *   3. 一键"载入到配方设计"（经典）/ "打开"（自定义条目）
 *   4. 风格编号（1A / 21C）的悬浮解释：数字=大类，字母=大类下的第几个子风格
 *
 * 依赖：BREW.UI（esc/fmt/icon/modal/confirm/clone/uid/setRecipe/publish）
 *       BREW.DB.styles（风格名与分类，可缺失）
 *       BREW.DB.classicRecipes（配方条目，可缺失 → 走空状态）
 *       BREW.DB.yeasts（酵母的编号与发酵天数，可缺失 → 该行留空）
 *       BREW.UI.store.recipes()（用户自建配方 → "自定义"条目）
 *
 * 数据缺失时本视图只显示空状态，不抛错、不影响其它视图。
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  /* ======================================================================
   * A. 数据访问（全部做空值防护）
   * ====================================================================*/

  /** 经典库条目 */
  function classicList() {
    var d = (BREW.DB = BREW.DB || {});
    return Array.isArray(d.classicRecipes) ? d.classicRecipes : [];
  }

  /**
   * 用户自建配方 → 与经典条目同形状的条目（只在渲染层判断，不动 30 号的数据形状）。
   * 为什么在这里做：配方库列表此前只显示经典库，"我的配方"在左面板里，
   * 用户会问"我自己建的那条去哪了"。合并显示的前提是两者形状一致，
   * 所以加一层适配，并在条目上打 _src / _custom 供筛选与徽标使用。
   */
  function customList() {
    var out = [];
    try {
      var list = (UI.store && typeof UI.store.recipes === 'function') ? UI.store.recipes() : [];
      if (!Array.isArray(list)) return out;
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!r || !r.id) continue;
        out.push({
          id: 'u:' + r.id,
          uid: r.id,
          name: r.name || '未命名配方',
          en: '',
          styleId: r.styleId || '',
          origin: { country: '', brewery: r.author || '', year: null, era: '' },
          story: r.notes || '',
          tags: [],
          conf: '',
          disclaimer: '',
          recipe: r,
          _src: 'custom',
          _custom: true
        });
      }
    } catch (e) { /* 读取失败就当没有自建配方，不影响经典库 */ }
    return out;
  }

  function allRecipes() {
    var a = classicList().map(function (c) {
      if (!c._src) c._src = 'classic';
      return c;
    });
    return a.concat(customList());
  }

  function styleOf(styleId) {
    if (!styleId) return null;
    try { return UI.byId('styles', styleId) || null; } catch (e) { return null; }
  }

  /** 国家代码 → 中文名。库里的 origin.country 早期版本写过 ISO 代码 */
  var COUNTRY = {
    CZ: '捷克', DE: '德国', BE: '比利时', GB: '英国', UK: '英国', US: '美国',
    IE: '爱尔兰', AT: '奥地利', NL: '荷兰', JP: '日本', CN: '中国', DK: '丹麦',
    FR: '法国', IT: '意大利', PL: '波兰', AU: '澳大利亚', NZ: '新西兰', CA: '加拿大',
    SI: '斯洛文尼亚', ES: '西班牙', RU: '俄罗斯', MX: '墨西哥', SE: '瑞典',
    NO: '挪威', FI: '芬兰', CH: '瑞士', PT: '葡萄牙', BR: '巴西', ZA: '南非'
  };

  function countryName(code) {
    var c = String(code || '').toUpperCase();
    return COUNTRY[c] || (code ? String(code) : '—');
  }

  /** 国家 → 大洲。'国际' / '比利时/美国' 这类多国条目按拆分后的每个国家分别登记 */
  var CONTINENT = {
    英国: '欧洲', 苏格兰: '欧洲', 爱尔兰: '欧洲', 德国: '欧洲', 比利时: '欧洲',
    捷克: '欧洲', 奥地利: '欧洲', 荷兰: '欧洲', 丹麦: '欧洲', 法国: '欧洲',
    意大利: '欧洲', 波兰: '欧洲', 斯洛文尼亚: '欧洲', 西班牙: '欧洲', 俄罗斯: '欧洲',
    瑞典: '欧洲', 挪威: '欧洲', 芬兰: '欧洲', 瑞士: '欧洲', 葡萄牙: '欧洲',
    美国: '北美', 加拿大: '北美', 墨西哥: '北美',
    巴西: '南美', 阿根廷: '南美', 智利: '南美',
    日本: '亚洲', 中国: '亚洲', 韩国: '亚洲', 印度: '亚洲', 越南: '亚洲',
    澳大利亚: '大洋洲', 新西兰: '大洋洲',
    南非: '非洲',
    国际: '跨国'
  };

  var CONTINENTS = ['欧洲', '北美', '南美', '亚洲', '大洋洲', '非洲', '跨国'];

  /** 一个条目可能写了"英国/美国"，拆成数组后每个都参与筛选 */
  function countriesOf(c) {
    var raw = String(((c.origin || {}).country) || '');
    if (!raw) return [];
    var parts = raw.split(/[\/、,，]/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p && out.indexOf(p) < 0) out.push(p);
    }
    return out;
  }

  /** 年代：优先 origin.year，其次解析 origin.era（'1850s' / '1900s' / 'modern'） */
  function yearOf(c) {
    var o = c.origin || {};
    var y = num(o.year, null);
    if (y) return y;
    var era = String(o.era || '');
    if (!era) return null;
    var m = era.match(/(\d{4})/);
    if (m) return parseInt(m[1], 10);
    if (/modern|当代|现代/i.test(era)) return 2000;
    return null;
  }

  var ERAS = [
    { k: 'pre1850', zh: '1850 前', test: function (y) { return y < 1850; } },
    { k: '1850-1950', zh: '1850–1950', test: function (y) { return y >= 1850 && y < 1950; } },
    { k: '1950-2000', zh: '1950–2000', test: function (y) { return y >= 1950 && y < 2000; } },
    { k: 'post2000', zh: '2000 后', test: function (y) { return y >= 2000; } },
    { k: 'none', zh: '未标年代', test: function () { return false; } }
  ];

  function eraBucket(c) {
    var y = yearOf(c);
    if (y === null) return 'none';
    for (var i = 0; i < ERAS.length; i++) if (ERAS[i].k !== 'none' && ERAS[i].test(y)) return ERAS[i].k;
    return 'none';
  }

  function eraLabel(c) {
    var y = yearOf(c);
    if (y === null) return '';
    return String(y) + (String((c.origin || {}).year || '') ? '' : ' 年代');
  }

  /** 风格编号 "3B" → { g:3, l:'B' }，用于"按风格编号"排序 */
  function styleKey(styleId) {
    var s = String(styleId || '');
    var m = s.match(/^(\d+)\s*([A-Za-z-]*)$/);
    if (!m) return { g: 999, l: s };
    return { g: parseInt(m[1], 10), l: (m[2] || '').toUpperCase() };
  }

  /* 指标缓存：一百多个配方每次筛选都重算没有必要，首次用到时算一次即可 */
  var metricCache = {};

  function metricsOf(c) {
    if (metricCache[c.id]) return metricCache[c.id];
    var out = { og: null, ibu: null, abv: null };
    try {
      var calc = UI.calc(UI.normalizeRecipe(UI.clone(c.recipe || {})));
      out.og = num(calc.og, null);
      out.ibu = num(calc.ibu, null);
      out.abv = num(calc.abv, null);
    } catch (e) {
      /* 计算失败就退回配方自带的 target，卡片上宁可显示 "—" 也不要报错 */
      var t = (c.recipe && c.recipe.targets) || {};
      out.og = num(t.og, null);
      out.ibu = num(t.ibu, null);
      out.abv = num(t.abv, null);
    }
    metricCache[c.id] = out;
    return out;
  }

  function dropCache() { metricCache = {}; }

  /** 酵母库：配方的酵母行只存 id/name/en/lab，编号与天数要回库取 */
  function yeastDef(id) {
    try {
      var list = (BREW.DB && BREW.DB.yeasts) || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    } catch (e) { /* ignore */ }
    return null;
  }

  function daysText(d) {
    if (!Array.isArray(d) || d.length < 2) return '';
    return d[0] + '–' + d[1] + ' 天';
  }

  /* ======================================================================
   * B. 筛选与排序
   * ====================================================================*/

  var state = {
    q: '', cat: '', sort: 'style', src: 'all',
    eras: [], countries: [], continents: [], tags: [],
    yFrom: null, yTo: null
  };

  function anyFilter() {
    return !!(state.q || state.cat || state.src !== 'all' || state.eras.length ||
      state.countries.length || state.continents.length || state.tags.length ||
      state.yFrom !== null || state.yTo !== null);
  }

  /** 搜索：名称 / 英文名 / 风格 / 酒厂 / 国家 / 标签 / 年份，全部小写子串匹配 */
  function hit(c, q) {
    if (!q) return true;
    var s = String(q).toLowerCase().trim();
    if (!s) return true;
    var org = c.origin || {};
    var st = styleOf(c.styleId);
    var fields = [
      c.name, c.en, c.styleId, (st && st.name) || '', (st && st.en) || '',
      org.brewery, org.country, countryName(org.country), org.year, org.era,
      (c.tags || []).join(' ')
    ];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i] && String(fields[i]).toLowerCase().indexOf(s) >= 0) return true;
    }
    return false;
  }

  function catOf(c) {
    var st = styleOf(c.styleId);
    return (st && st.cat) ? st.cat : '其它';
  }

  /** 风味标签：多选 = 同时满足（AND） */
  function tagOk(c) {
    if (!state.tags.length) return true;
    var tags = Array.isArray(c.tags) ? c.tags : [];
    for (var i = 0; i < state.tags.length; i++) {
      if (tags.indexOf(state.tags[i]) < 0) return false;
    }
    return true;
  }

  /** 国家 / 大洲：同维度内多选 = 满足任一（OR） */
  function geoOk(c) {
    if (!state.countries.length && !state.continents.length) return true;
    var cs = countriesOf(c);
    if (!cs.length) return false;
    var i;
    for (i = 0; i < state.countries.length; i++) {
      if (cs.indexOf(state.countries[i]) >= 0) return true;
    }
    for (i = 0; i < state.continents.length; i++) {
      for (var j = 0; j < cs.length; j++) {
        if (CONTINENT[cs[j]] === state.continents[i]) return true;
      }
    }
    return false;
  }

  /** 年代：桶多选 = 满足任一（OR）；填了起止年则与桶取并集 */
  function eraOk(c) {
    if (!state.eras.length && state.yFrom === null && state.yTo === null) return true;
    var b = eraBucket(c);
    if (state.eras.length && state.eras.indexOf(b) >= 0) return true;
    if (state.yFrom === null && state.yTo === null) return false;
    var y = yearOf(c);
    if (y === null) return false;
    if (state.yFrom !== null && y < state.yFrom) return false;
    if (state.yTo !== null && y > state.yTo) return false;
    return true;
  }

  function filtered() {
    var list = allRecipes();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || !c.id) continue;
      if (state.src !== 'all' && (c._src || 'classic') !== state.src) continue;
      if (state.cat && catOf(c) !== state.cat) continue;
      if (!tagOk(c)) continue;
      if (!geoOk(c)) continue;
      if (!eraOk(c)) continue;
      if (!hit(c, state.q)) continue;
      out.push(c);
    }
    out.sort(comparator());
    return out;
  }

  function comparator() {
    if (state.sort === 'country') {
      return function (a, b) {
        var ca = countryName((a.origin || {}).country);
        var cb = countryName((b.origin || {}).country);
        var d = ca.localeCompare(cb, 'zh');
        return d !== 0 ? d : String(a.name).localeCompare(String(b.name), 'zh');
      };
    }
    if (state.sort === 'year') {
      return function (a, b) {
        var ya = yearOf(a), yb = yearOf(b);
        ya = (ya === null ? 9999 : ya);
        yb = (yb === null ? 9999 : yb);
        return ya !== yb ? ya - yb : String(a.name).localeCompare(String(b.name), 'zh');
      };
    }
    /* 默认：按 BJCP 风格编号，同号内再看名称 */
    return function (a, b) {
      var ka = styleKey(a.styleId), kb = styleKey(b.styleId);
      if (ka.g !== kb.g) return ka.g - kb.g;
      if (ka.l !== kb.l) return ka.l < kb.l ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'zh');
    };
  }

  /* ---- 筛选条要用的候选集（从数据里收集，没有就不显示那一条） ---- */

  function catList() {
    var seen = {}, out = [];
    var list = allRecipes();
    for (var i = 0; i < list.length; i++) {
      var k = catOf(list[i]);
      if (!seen[k]) { seen[k] = 1; out.push(k); }
    }
    out.sort(function (a, b) { return a.localeCompare(b, 'zh'); });
    return out;
  }

  function countBy(fn) {
    var map = {}, list = allRecipes();
    for (var i = 0; i < list.length; i++) {
      var keys = fn(list[i]);
      for (var j = 0; j < keys.length; j++) {
        if (!keys[j]) continue;
        map[keys[j]] = (map[keys[j]] || 0) + 1;
      }
    }
    return map;
  }

  function countryList() {
    var map = countBy(countriesOf);
    var out = Object.keys(map);
    out.sort(function (a, b) {
      if (map[b] !== map[a]) return map[b] - map[a];
      return a.localeCompare(b, 'zh');
    });
    return { keys: out, count: map };
  }

  function continentList() {
    var map = countBy(function (c) {
      var cs = countriesOf(c), out = [];
      for (var i = 0; i < cs.length; i++) {
        var k = CONTINENT[cs[i]];
        if (k && out.indexOf(k) < 0) out.push(k);
      }
      return out;
    });
    var out = [];
    for (var i = 0; i < CONTINENTS.length; i++) if (map[CONTINENTS[i]]) out.push(CONTINENTS[i]);
    return { keys: out, count: map };
  }

  function tagList() {
    var map = countBy(function (c) { return Array.isArray(c.tags) ? c.tags : []; });
    var out = Object.keys(map);
    out.sort(function (a, b) {
      if (map[b] !== map[a]) return map[b] - map[a];
      return a.localeCompare(b, 'zh');
    });
    return { keys: out.slice(0, 26), count: map, more: Math.max(0, out.length - 26) };
  }

  /* ======================================================================
   * C. 视图片段
   * ====================================================================*/

  /** 风格编号 chip：带 title 兜底 + 悬浮解释（复用术语浮层的样式） */
  function styleChip(styleId, extraCls) {
    if (!styleId) return '';
    var st = styleOf(styleId);
    var code = String(styleId);
    var tip = styleTip(styleId);
    return '<button type="button" class="style-chip' + (extraCls ? ' ' + extraCls : '') + '"' +
      ' data-stylepop="' + attr(styleId) + '"' +
      ' title="' + attr(tip.plain) + '"' +
      ' aria-label="' + attr(tip.plain) + '">' +
      esc(code) + (st && st.name ? '<i>' + esc(st.name) + '</i>' : '') +
      '</button>';
  }

  /** "1A" 这种串的意思：数字 = 大类，字母 = 该大类下的第几个子风格 */
  function styleTip(styleId) {
    var st = styleOf(styleId);
    var s = String(styleId || '');
    var m = s.match(/^(\d+)\s*([A-Za-z])/);
    var g = m ? parseInt(m[1], 10) : null;
    var letter = m ? m[2].toUpperCase() : '';
    var idx = letter ? (letter.charCodeAt(0) - 64) : null;
    var catZh = (st && st.cat) || '';
    var name = (st && st.name) || '';
    var en = (st && st.en) || '';

    var plain = 'BJCP 风格编号：' + s +
      (name ? '（' + name + '）' : '') +
      '。数字' + (g === null ? '' : ' ' + g) + ' 是大类序号' +
      (catZh ? '（' + catZh + '）' : '') +
      '，字母 ' + letter + ' 是该大类下的第 ' + (idx || '?') + ' 个子风格。';
    return {
      plain: plain, code: s, g: g, letter: letter, idx: idx,
      name: name, en: en, cat: catZh
    };
  }

  function toolbar() {
    var cats = catList();
    var chips = '';
    if (cats.length) {
      chips = '<div class="classic-cats" role="group" aria-label="按风格大类筛选">' +
        '<button type="button" class="chip' + (state.cat === '' ? ' is-on' : '') +
        '" data-cat="">全部</button>';
      for (var i = 0; i < cats.length; i++) {
        chips += '<button type="button" class="chip' + (state.cat === cats[i] ? ' is-on' : '') +
          '" data-cat="' + attr(cats[i]) + '">' + esc(cats[i]) + '</button>';
      }
      chips += '</div>';
    }

    var sorts = [
      { v: 'style', t: '按风格编号' },
      { v: 'country', t: '按国家' },
      { v: 'year', t: '按年代' }
    ];
    var opts = '';
    for (var j = 0; j < sorts.length; j++) {
      opts += '<option value="' + attr(sorts[j].v) + '"' +
        (state.sort === sorts[j].v ? ' selected' : '') + '>' + esc(sorts[j].t) + '</option>';
    }

    return '<div class="classic-bar">' +
      '<div class="classic-search">' +
        '<span class="classic-search__icon">' + icon('search', 15) + '</span>' +
        '<input class="input" type="search" id="classic-q" data-role="q" ' +
          'aria-label="搜索经典配方" placeholder="搜索配方名、酒厂、国家或标签…" ' +
          'value="' + attr(state.q) + '">' +
      '</div>' +
      '<select class="select select--sm" data-role="sort" aria-label="排序方式">' + opts + '</select>' +
      '</div>' +
      (chips ? '<div class="classic-bar classic-bar--chips">' + chips + '</div>' : '') +
      filterPanel();
  }

  /** 年代 / 国家 / 风味 / 来源 —— 三组 chip + 一组年份区间 */
  function filterPanel() {
    var eras = '', ico = '';
    for (var e = 0; e < ERAS.length; e++) {
      ico += '<button type="button" class="chip chip--sm' +
        (state.eras.indexOf(ERAS[e].k) >= 0 ? ' is-on' : '') +
        '" data-era="' + attr(ERAS[e].k) + '">' + esc(ERAS[e].zh) + '</button>';
    }

    var geo = continentList();
    var cts = '';
    for (var c = 0; c < geo.keys.length; c++) {
      cts += '<button type="button" class="chip chip--sm' +
        (state.continents.indexOf(geo.keys[c]) >= 0 ? ' is-on' : '') +
        '" data-continent="' + attr(geo.keys[c]) + '" title="' +
        attr(geo.keys[c] + '：' + geo.count[geo.keys[c]] + ' 条') + '">' +
        esc(geo.keys[c]) + '</button>';
    }

    var ctys = countryList();
    var cn = '';
    for (var k = 0; k < ctys.keys.length; k++) {
      cn += '<button type="button" class="chip chip--sm' +
        (state.countries.indexOf(ctys.keys[k]) >= 0 ? ' is-on' : '') +
        '" data-country="' + attr(ctys.keys[k]) + '" title="' +
        attr(ctys.keys[k] + '：' + ctys.count[ctys.keys[k]] + ' 条') + '">' +
        esc(ctys.keys[k]) + '<i>' + ctys.count[ctys.keys[k]] + '</i></button>';
    }

    var tl = tagList();
    var tags = '';
    for (var t = 0; t < tl.keys.length; t++) {
      tags += '<button type="button" class="chip chip--sm' +
        (state.tags.indexOf(tl.keys[t]) >= 0 ? ' is-on' : '') +
        '" data-tag="' + attr(tl.keys[t]) + '" title="' +
        attr(tl.keys[t] + '：' + tl.count[tl.keys[t]] + ' 条') + '">' +
        esc(tl.keys[t]) + '<i>' + tl.count[tl.keys[t]] + '</i></button>';
    }
    if (tl.more) tags += '<span class="classic-filter__more">另有 ' + tl.more + ' 个标签（用搜索框找）</span>';

    var srcs = [
      { v: 'all', t: '全部来源' },
      { v: 'classic', t: '经典库' },
      { v: 'custom', t: '自定义' }
    ];
    var srcChips = '';
    for (var s = 0; s < srcs.length; s++) {
      srcChips += '<button type="button" class="chip chip--sm' +
        (state.src === srcs[s].v ? ' is-on' : '') +
        '" data-src="' + attr(srcs[s].v) + '">' + esc(srcs[s].t) + '</button>';
    }

    return '<div class="classic-filter" id="classic-filters">' +
      '<div class="classic-filter__row">' +
        '<span class="classic-filter__label">年代</span>' +
        '<div class="classic-filter__chips">' + ico +
          '<span class="classic-filter__years">' +
            '<input class="input input--xs" type="number" inputmode="numeric" data-role="yfrom" ' +
              'aria-label="起始年" placeholder="起" value="' + attr(state.yFrom === null ? '' : state.yFrom) + '">' +
            '<span class="u-dim">—</span>' +
            '<input class="input input--xs" type="number" inputmode="numeric" data-role="yto" ' +
              'aria-label="结束年" placeholder="止" value="' + attr(state.yTo === null ? '' : state.yTo) + '">' +
          '</span>' +
        '</div>' +
        '<span class="classic-filter__hint">桶多选＝满足任一；填了起止年则按年份区间</span>' +
      '</div>' +
      '<div class="classic-filter__row">' +
        '<span class="classic-filter__label">国家 / 大洲</span>' +
        '<div class="classic-filter__chips">' + cts + cn + '</div>' +
        '<span class="classic-filter__hint">多选＝满足任一</span>' +
      '</div>' +
      '<div class="classic-filter__row">' +
        '<span class="classic-filter__label">风味标签</span>' +
        '<div class="classic-filter__chips">' + (tags || '<span class="u-dim u-xs">（无标签）</span>') + '</div>' +
        '<span class="classic-filter__hint classic-filter__hint--strong">多选＝同时满足</span>' +
      '</div>' +
      '<div class="classic-filter__row">' +
        '<span class="classic-filter__label">来源</span>' +
        '<div class="classic-filter__chips">' + srcChips + '</div>' +
        '<span class="classic-filter__hint">维度之间同时满足</span>' +
        '<button type="button" class="btn btn-ghost btn-xs classic-clear" data-clear="1">清空筛选</button>' +
      '</div>' +
      '</div>';
  }

  function customBadge() {
    return '<span class="badge badge--custom classic-card__custom" ' +
      'title="你自己创建的配方（不在经典库里）">自定义</span>';
  }

  /** 配方用的第一株酵母 + 天数，渲染成卡片下方那一行 */
  function yeastLine(c) {
    var r = c.recipe || {};
    var list = Array.isArray(r.yeasts) ? r.yeasts : [];
    if (!list.length) return '';
    var y = list[0];
    var def = yeastDef(y.id);
    var code = (def && def.code) ? def.code : '';
    /* 编号已经在中文名或英文名里出现过就不再重复（W-34/70 拉格 / SafLager W-34/70 · W-34/70 太吵） */
    if (code) {
      var hay = String(y.name || '') + ' ' + String(y.en || '');
      if (hay.indexOf(code) >= 0) code = '';
    }
    var prim = def ? daysText(def.primDays) : '';
    var sec = def ? daysText(def.secDays) : '';
    var title = [y.name, y.en, code].filter(Boolean).join(' / ');
    var days = '';
    if (prim || sec) {
      days = '<span class="classic-card__days">' +
        (prim ? '一发 <b>' + esc(prim) + '</b>' : '') +
        (prim && sec ? ' + ' : '') +
        (sec ? '二发 <b>' + esc(sec) + '</b>' : '') +
        '</span>';
    }
    return '<p class="classic-card__yeast" title="' + attr(title || '') + '">' +
      '<i>酵母</i>' + esc(title || '—') + days + '</p>';
  }

  function cardHtml(c) {
    var st = styleOf(c.styleId);
    var org = c.origin || {};
    var m = metricsOf(c);

    var tags = '';
    var tg = Array.isArray(c.tags) ? c.tags : [];
    for (var i = 0; i < tg.length && i < 4; i++) {
      tags += '<span class="tag">' + esc(tg[i]) + '</span>';
    }
    if (tg.length > 4) tags += '<span class="tag">+' + (tg.length - 4) + '</span>';

    var origin = [countryName(org.country), org.brewery, org.year ? org.year : (org.era || '')];
    var originText = [];
    for (var o = 0; o < origin.length; o++) if (origin[o]) originText.push(esc(origin[o]));

    var isCustom = c._src === 'custom';

    /* 卡片上的 data-c-* 只给"读"（自动化断言、后续排序），**不参与筛选**。
       前缀必须是 c-：早先写成 data-country / data-year 时，卡片和筛选 chip
       撞了同一个属性名，点卡片会被当成点国家 chip —— 表现为"点详情没反应"。
       断言脚本读的也是 data-c-*。 */
    return '<article class="classic-card' + (isCustom ? ' is-custom' : '') +
      '" data-classic="' + attr(c.id) + '"' +
      ' data-c-src="' + attr(c._src || 'classic') + '"' +
      ' data-c-style="' + attr(c.styleId || '') + '"' +
      ' data-c-year="' + attr(yearOf(c) === null ? '' : yearOf(c)) + '"' +
      ' data-c-country="' + attr(countriesOf(c).join('|')) + '"' +
      ' data-c-tags="' + attr(tg.join('|')) + '">' +
      '<header class="classic-card__head">' +
        '<div class="classic-card__style">' +
          (c.styleId ? styleChip(c.styleId) : '<span class="u-xs u-dim">未分类</span>') +
          (isCustom ? customBadge() : '') +
        '</div>' +
        '<button type="button" class="classic-card__title" data-classic="' + attr(c.id) + '">' +
          esc(c.name || '未命名') + '</button>' +
        (c.en ? '<p class="classic-card__en">' + esc(c.en) + '</p>' : '') +
      '</header>' +
      '<p class="classic-card__origin">' + originText.join(' · ') + '</p>' +
      (c.story ? '<p class="classic-card__story">' + UI.md(c.story) + '</p>' : '') +
      (tags ? '<div class="classic-card__tags">' + tags + '</div>' : '') +
      '<div class="classic-card__metrics">' +
        '<span><i>OG</i><b>' + esc(m.og ? UI.sg(m.og) : '—') + '</b></span>' +
        '<span><i>IBU</i><b>' + esc(m.ibu !== null ? fmt(m.ibu, 0) : '—') + '</b></span>' +
        '<span><i>ABV</i><b>' + esc(m.abv !== null ? fmt(m.abv, 1) + '%' : '—') + '</b></span>' +
      '</div>' +
      yeastLine(c) +
      '<footer class="classic-card__foot">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-classic="' + attr(c.id) + '">查看详情</button>' +
        (isCustom
          ? '<button type="button" class="btn btn-primary btn-sm" data-open="' + attr(c.uid) + '">打开</button>'
          : '<button type="button" class="btn btn-primary btn-sm" data-load="' + attr(c.id) + '">载入到配方设计</button>') +
      '</footer>' +
      '</article>';
  }

  function paintGrid() {
    var host = document.getElementById('classic-grid');
    if (!host) return;
    var list = filtered();
    var total = allRecipes().length;
    var head = document.getElementById('classic-count');
    if (head) {
      head.textContent = anyFilter()
        ? '命中 ' + list.length + ' 条 / 共 ' + total + ' 条'
        : '共 ' + total + ' 条（经典 ' + classicList().length +
          ' + 自定义 ' + customList().length + '）';
    }
    if (!list.length) {
      host.innerHTML = UI.emptyState(
        allRecipes().length ? '没有匹配的配方' : '经典配方库尚未载入',
        allRecipes().length ? '换个关键词，或点「清空筛选」把条件清掉。'
          : '数据文件（BREW.DB.classicRecipes）为空，配方库模块不影响其它功能使用。',
        { art: allRecipes().length ? 'search' : 'beer' }
      );
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) html += cardHtml(list[i]);
    host.innerHTML = '<div class="classic-grid">' + html + '</div>';
  }

  /* ======================================================================
   * D. 详情模态框
   * ====================================================================*/

  function rowsTable(title, rows, cols) {
    if (!rows || !rows.length) return '';
    var th = '', body = '';
    for (var c = 0; c < cols.length; c++) {
      th += '<th' + (cols[c].right ? ' class="u-right"' : '') + '>' + esc(cols[c].t) + '</th>';
    }
    for (var i = 0; i < rows.length; i++) {
      body += '<tr>';
      for (var j = 0; j < cols.length; j++) {
        var cell = cols[j].v(rows[i], i);
        body += '<td' + (cols[j].right ? ' class="num"' : '') + '>' + cell + '</td>';
      }
      body += '</tr>';
    }
    return '<h3 class="classic-detail__h3">' + esc(title) + '</h3>' +
      '<div class="table-wrap"><table class="table table--compact">' +
      '<thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function yeastCell(x) {
    var def = yeastDef(x.id);
    var code = (def && def.code) ? def.code : '';
    var out = '<b>' + esc(x.name || '—') + '</b>';
    if (x.en) out += ' <span class="u-dim">/ ' + esc(x.en) + '</span>';
    if (code) out += ' <span class="yeast-code">· ' + esc(code) + '</span>';
    return out;
  }

  function detailBody(c) {
    var r = UI.normalizeRecipe(UI.clone(c.recipe || {}));
    var st = styleOf(c.styleId);
    var org = c.origin || {};
    var m = metricsOf(c);
    var isCustom = c._src === 'custom';

    var tags = '';
    var tg = Array.isArray(c.tags) ? c.tags : [];
    for (var i = 0; i < tg.length; i++) tags += '<span class="tag">' + esc(tg[i]) + '</span>';

    var html = '<div class="classic-detail">';

    /* 顶部：来源 + 关键指标 */
    html += '<div class="classic-detail__top">' +
      '<div class="classic-detail__origin">' +
        (isCustom ? customBadge() : '') +
        (org.country || org.brewery ? '<span>' + esc(countryName(org.country)) + '</span>' : '') +
        (org.brewery ? '<span>' + esc(org.brewery) + '</span>' : '') +
        (org.year ? '<span>' + esc(org.year) + ' 年</span>' :
          (org.era ? '<span>' + esc(org.era) + '</span>' : '')) +
        (c.styleId ? styleChip(c.styleId) : '') +
      '</div>' +
      '<div class="classic-detail__metrics">' +
        '<span><i>OG</i><b>' + esc(m.og ? UI.sg(m.og) : '—') + '</b></span>' +
        '<span><i>IBU</i><b>' + esc(m.ibu !== null ? fmt(m.ibu, 0) : '—') + '</b></span>' +
        '<span><i>ABV</i><b>' + esc(m.abv !== null ? fmt(m.abv, 1) + '%' : '—') + '</b></span>' +
        '<span><i>批次</i><b>' + esc(fmt(r.batchSize, 0)) + ' L</b></span>' +
      '</div>' +
      '</div>';

    if (tags) html += '<div class="row row--tight classic-detail__tags">' + tags +
      (c.conf ? UI.badgeConf(c.conf) : '') + '</div>';

    /* 背景故事 */
    if (c.story) {
      html += '<h3 class="classic-detail__h3">' + (isCustom ? '备注' : '背景') + '</h3>' +
        '<p class="classic-detail__story">' + UI.md(c.story) + '</p>';
    }

    /* 麦芽 */
    html += rowsTable('原料 · 麦芽与辅料', r.fermentables, [
      { t: '原料', v: function (x) { return esc(x.name || '—'); } },
      { t: '用量', v: function (x) { return esc(fmt(x.amount, 2)); }, right: true },
      { t: '单位', v: function (x) { return esc(x.unit || 'kg'); } }
    ]);

    /* 酒花 */
    html += rowsTable('原料 · 酒花', r.hops, [
      { t: '酒花', v: function (x) { return esc(x.name || '—'); } },
      { t: '用量', v: function (x) { return esc(fmt(x.amount, 0)); }, right: true },
      { t: '阶段', v: function (x) { return esc(stageName(x.stage)); } },
      { t: '时间', v: function (x) { return esc(fmt(x.time, 0) + ' min'); }, right: true },
      { t: 'AA', v: function (x) { return esc(x.aa ? fmt(x.aa, 1) + '%' : '—'); }, right: true }
    ]);

    /* 酵母：中文名 / 英文名 · 编号 + 一发 / 二发天数 */
    html += rowsTable('原料 · 酵母', r.yeasts, [
      { t: '菌株', v: function (x) { return yeastCell(x); } },
      { t: '类型', v: function (x) { return esc(x.type === 'lager' ? '拉格' : x.type === 'ale' ? '艾尔' : (x.type || '—')); } },
      { t: '接种量', v: function (x) { return esc(fmt(x.amount, 0) + ' ' + (x.unit || 'g')); }, right: true },
      { t: '本配方衰减度', v: function (x) { return esc(fmt(x.att, 0) + '%'); }, right: true },
      { t: '温度', v: function (x) { return esc(fmt(x.tempC, 0) + ' °C'); }, right: true },
      {
        t: '一发', v: function (x) {
          var def = yeastDef(x.id);
          return def && def.primDays ? esc(daysText(def.primDays)) : '<span class="u-dim">—</span>';
        }, right: true
      },
      {
        t: '二发 / 后熟', v: function (x) {
          var def = yeastDef(x.id);
          return def && def.secDays ? esc(daysText(def.secDays)) : '<span class="u-dim">—</span>';
        }, right: true
      }
    ]);

    /* 酵母天数说明：把它写成一句人话，不然表里两个数字没人知道怎么用 */
    var yRows = r.yeasts || [];
    if (yRows.length) {
      var y0 = yeastDef(yRows[0].id);
      if (y0 && y0.primDays && y0.secDays) {
        html += '<p class="classic-detail__days">' +
          esc('这条配方用 ' + (yRows[0].name || y0.name) + '：主发酵 ' + daysText(y0.primDays) +
            '，后熟 / 二次发酵 ' + daysText(y0.secDays) + '，合计约 ' +
            (y0.primDays[0] + y0.secDays[0]) + '–' + (y0.primDays[1] + y0.secDays[1]) + ' 天可装瓶。') +
          (y0.notes ? '<span class="u-dim">' + esc(y0.notes) + '</span>' : '') +
          '</p>';
      }
    }

    /* 辅料 */
    html += rowsTable('原料 · 辅料', r.adjuncts, [
      { t: '辅料', v: function (x) { return esc(x.name || '—'); } },
      { t: '用量', v: function (x) { return esc(fmt(x.amount, 1) + ' ' + (x.unit || 'g')); }, right: true },
      { t: '阶段', v: function (x) { return esc(stageName(x.stage)); } },
      { t: '备注', v: function (x) { return UI.md(x.note || '—'); } }
    ]);

    /* 糖化方案 */
    html += rowsTable('糖化方案', (r.mash && r.mash.steps) || [], [
      { t: '休止', v: function (x) { return esc(x.name || '—'); } },
      { t: '温度', v: function (x) { return esc(fmt(x.tempC, 1) + ' °C'); }, right: true },
      { t: '时间', v: function (x) { return esc(fmt(x.minutes, 0) + ' min'); }, right: true }
    ]);

    /* 水 */
    var src = (r.water && r.water.source) || {};
    if (src.ca || src.so4 || src.cl || src.hco3) {
      html += '<h3 class="classic-detail__h3">糖化水（离子 ppm）</h3>' +
        '<div class="classic-detail__ions">' +
        '<span>Ca²⁺ <b>' + esc(fmt(src.ca, 0)) + '</b></span>' +
        '<span>Mg²⁺ <b>' + esc(fmt(src.mg, 0)) + '</b></span>' +
        '<span>Na⁺ <b>' + esc(fmt(src.na, 0)) + '</b></span>' +
        '<span>Cl⁻ <b>' + esc(fmt(src.cl, 0)) + '</b></span>' +
        '<span>SO₄²⁻ <b>' + esc(fmt(src.so4, 0)) + '</b></span>' +
        '<span>HCO₃⁻ <b>' + esc(fmt(src.hco3, 0)) + '</b></span>' +
        '</div>';
    }

    if (r.notes) {
      html += '<h3 class="classic-detail__h3">备注</h3>' +
        '<p class="classic-detail__story">' + UI.md(r.notes) + '</p>';
    }

    /* 每条配方自带的免责声明：先前只写进了数据、界面从未渲染，等于白写 */
    if (c.disclaimer) {
      html += '<div class="alert alert--warn" style="margin-top:14px">' +
        '<span class="alert__icon">' + icon('alert', 13) + '</span>' +
        '<span>' + UI.md(c.disclaimer) + '</span></div>';
    }

    html += '<p class="u-xs u-dim mt-16" style="line-height:1.6">' +
      (isCustom
        ? '这是你自己保存的配方。它不在经典库里，改它不会影响任何库条目。'
        : '载入时会深拷贝一份并换成新的配方 id，原库条目不会被改动；' +
          '溯源信息保留在 parentId（classic:' + esc(c.id) + '）。') +
      '</p>';

    return html + '</div>';
  }

  function stageName(stage) {
    var s = String(stage || '').toLowerCase();
    if (s === 'boil') return '煮沸';
    if (s === 'dryhop' || s === 'dry') return '干投';
    if (s === 'whirlpool') return '回旋';
    if (s === 'flameout') return '关火';
    if (s === 'mash') return '糖化';
    if (s === 'firstwort' || s === 'fwh') return '头道麦汁';
    if (s === 'ferment') return '发酵';
    if (s === 'package' || s === 'bottle') return '装瓶';
    return stage ? String(stage) : '—';
  }

  function openDetail(c) {
    if (!c) return;
    var isCustom = c._src === 'custom';
    var api = UI.Shell.modal({
      title: c.name || (isCustom ? '我的配方' : '经典配方'),
      sub: c.en || (isCustom ? '自定义配方' : ''),
      size: 'wide',
      body: detailBody(c),
      actions: [
        { label: '关闭', kind: 'ghost' },
        isCustom
          ? { label: '打开这份配方', kind: 'primary', act: function () { openCustom(c.uid); } }
          : { label: '载入到配方设计', kind: 'primary', act: function () { loadInto(c); } }
      ]
    });
    return api;
  }

  /* ======================================================================
   * E. 载入 / 打开（三步缺一不可）
   * ====================================================================*/

  function currentHasContent() {
    var r = UI.recipe() || {};
    var f = r.fermentables || r.malts || [];
    return !!(f.length || (r.hops || []).length || (r.yeasts || []).length || (r.adjuncts || []).length);
  }

  function loadInto(c) {
    if (!c || !c.recipe) {
      UI.Shell.toast('该条目缺少配方数据，无法载入', 'error');
      return;
    }
    if (currentHasContent()) {
      UI.Shell.confirm({
        title: '载入经典配方',
        message: '当前配方「' + (UI.recipe().name || '未命名') + '」会被这份经典配方覆盖。',
        detail: '未保存的内容将丢失。建议先保存当前配方，或导出备份。',
        okLabel: '覆盖并载入',
        danger: true
      }, function () { doLoad(c); });
      return;
    }
    doLoad(c);
  }

  function doLoad(c) {
    try {
      /* 1. 深拷贝：切断与库条目的引用，之后用户改配方不会污染经典库 */
      var r = UI.clone(c.recipe);
      /* 2. 换新 id：否则保存时会覆盖库条目（库条目不在 Store 里，但同 id 会混淆溯源） */
      r.id = UI.uid('r');
      /* 3. 保留溯源链：日后能查到这份配方来自哪个经典 */
      r.parentId = 'classic:' + c.id;
      r.name = (c.name || '经典配方') + ' · 我的版本';
      r.createdAt = Date.now();
      r.updatedAt = Date.now();
      r.rev = 1;

      UI.setRecipe(UI.normalizeRecipe(r));
      UI.publish();

      if (UI.Shell && typeof UI.Shell.closeModal === 'function') UI.Shell.closeModal();
      UI.Shell.go('recipe');
      UI.Shell.toast('已载入「' + (c.name || '经典配方') + '」，可以开始改参数了', 'ok', 3200);
    } catch (e) {
      UI.reportError(e, 'classic.load');
    }
  }

  /** 自定义条目"打开"：直接设为当前配方（它就是 Store 里的那条，不需要克隆） */
  function openCustom(uid) {
    if (!uid) return;
    try {
      var list = customList();
      var target = null;
      for (var i = 0; i < list.length; i++) if (list[i].uid === uid) { target = list[i]; break; }
      if (!target) { UI.Shell.toast('这份配方已经不在"我的配方"里了', 'error'); return; }
      UI.setRecipe(UI.normalizeRecipe(UI.clone(target.recipe)));
      UI.publish();
      if (UI.Shell && typeof UI.Shell.closeModal === 'function') UI.Shell.closeModal();
      UI.Shell.go('recipe');
      UI.Shell.toast('已打开「' + (target.name || '我的配方') + '」', 'ok', 2600);
    } catch (e) {
      UI.reportError(e, 'classic.openCustom');
    }
  }

  /* ======================================================================
   * F. 编号解释浮层（复用 .term-pop 的样式，不再造一套）
   * ====================================================================*/

  var popEl = null, popAnchor = null;

  function ensurePop() {
    if (popEl && popEl.parentNode) return popEl;
    popEl = document.createElement('div');
    popEl.className = 'term-pop term-pop--style';
    popEl.setAttribute('role', 'tooltip');
    popEl.hidden = true;
    document.body.appendChild(popEl);
    return popEl;
  }

  function placePop(anchor) {
    if (!popEl || popEl.hidden) return;
    var r = anchor.getBoundingClientRect();
    var pw = popEl.offsetWidth, ph = popEl.offsetHeight;
    var vw = root.innerWidth || document.documentElement.clientWidth || 1024;
    var vh = root.innerHeight || document.documentElement.clientHeight || 768;
    var gap = 10, edge = 8;
    var top = r.top - ph - gap, flipped = false;
    if (top < edge) {
      if (r.bottom + gap + ph <= vh - edge) { top = r.bottom + gap; flipped = true; }
      else top = edge;
    }
    if (vh > ph + edge * 2 && top > vh - ph - edge) top = vh - ph - edge;
    var left = r.left + r.width / 2 - pw / 2;
    var maxLeft = Math.max(edge, vw - pw - edge);
    if (left < edge) left = edge;
    if (left > maxLeft) left = maxLeft;
    popEl.style.left = Math.round(left) + 'px';
    popEl.style.top = Math.round(top) + 'px';
    popEl.classList.toggle('is-below', flipped);
    var arrow = popEl.querySelector('.term-pop__arrow');
    if (arrow) {
      var ax = (r.left + r.width / 2) - left;
      ax = Math.max(14, Math.min(pw - 14, ax));
      arrow.style.left = Math.round(ax) + 'px';
    }
  }

  function showPop(anchor) {
    var id = anchor.getAttribute('data-stylepop');
    if (!id) return;
    var t = styleTip(id);
    var p = ensurePop();
    p.innerHTML =
      '<div class="term-pop__head">' +
        '<b>' + esc(t.code) + '</b>' +
        '<span>' + esc(t.name || '') + (t.en ? ' / ' + esc(t.en) : '') + '</span>' +
      '</div>' +
      '<p class="term-pop__brief">大类：' +
        (t.g === null ? '—' : 'Cat.' + t.g + (t.cat ? '（' + esc(t.cat) + '）' : '')) +
        '｜子类：第 ' + esc(String(t.idx || '?')) + ' 个（' + esc(t.letter) + '）</p>' +
      '<div class="term-pop__hint">数字＝大类序号，字母＝该大类下的第几个子风格</div>' +
      '<i class="term-pop__arrow" aria-hidden="true"></i>';
    popAnchor = anchor;
    p.hidden = false;
    placePop(anchor);
  }

  function hidePop() {
    if (popEl) popEl.hidden = true;
    popAnchor = null;
  }

  /* ======================================================================
   * G. 视图
   * ====================================================================*/

  function ruleLine() {
    return '<p class="classic-rule">' +
      '<b>编号规则</b>' +
      '<span>数字是大类，字母是大类下的子风格。例：21A = 第 21 类（IPA）的第 1 个子风格（美式 IPA）。' +
      '鼠标停在任意编号上可以看它属于哪一类。</span>' +
      '</p>';
  }

  function render(el) {
    var total = allRecipes().length;

    el.innerHTML =
      '<div class="section-title">' +
        '<h2>经典配方库</h2>' +
        '<p>照着酿过的酒抄结构——载入后换 id 成为你自己的版本，原库不动</p>' +
      '</div>' +
      ruleLine() +
      '<div class="card">' +
        '<div class="card__head">' +
          '<h2>浏览</h2>' +
          '<span class="spacer"></span>' +
          '<span class="u-xs u-dim" id="classic-count">' +
            (total ? '共 ' + total + ' 条' : '') + '</span>' +
        '</div>' +
        (total ? toolbar() : '') +
        '<div class="card__body" id="classic-grid"></div>' +
        '<div class="card__hint">' +
          '故事与配方参数取自公开的酿酒史资料与各厂公开信息，参数为典型值而非厂方机密配方；' +
          '载入后请按你的设备（效率、蒸发率）微调，直接照抄通常差 2–4 个比重点。' +
          '</div>' +
      '</div>';

    paintGrid();

    if (!el.__classicBound) {
      el.__classicBound = true;

      el.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        var role = t.getAttribute('data-role');
        if (role === 'q') {
          state.q = t.value || '';
          paintGrid();
        }
      });

      el.addEventListener('change', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        var role = t.getAttribute('data-role');
        if (role === 'sort') {
          state.sort = t.value || 'style';
          paintGrid();
          return;
        }
        if (role === 'yfrom' || role === 'yto') {
          var v = t.value === '' ? null : parseInt(t.value, 10);
          if (v !== null && !isFinite(v)) v = null;
          if (role === 'yfrom') state.yFrom = v; else state.yTo = v;
          paintGrid();
        }
      });

      /* 悬浮解释：委托到容器，卡片与详情里都生效 */
      el.addEventListener('mouseover', function (e) {
        var a = closestAttr(e.target, 'data-stylepop', el);
        if (a) showPop(a);
      });
      el.addEventListener('mouseout', function (e) {
        var a = closestAttr(e.target, 'data-stylepop', el);
        if (a && popAnchor === a) hidePop();
      });
      el.addEventListener('focusin', function (e) {
        var a = closestAttr(e.target, 'data-stylepop', el);
        if (a) showPop(a);
      });
      el.addEventListener('focusout', function () { hidePop(); });

      el.addEventListener('click', function (e) {
        var node = e.target;

        /* 清空筛选：放在最前面，避免被其它 data-* 抢走 */
        var clearBtn = closestAttr(node, 'data-clear', el);
        if (clearBtn) {
          resetFilters();
          var host = document.getElementById('classic-filters');
          if (host) {
            var fresh = document.createElement('div');
            fresh.innerHTML = filterPanel();
            host.parentNode.replaceChild(fresh.firstChild, host);
          }
          paintGrid();
          return;
        }

        /* 先判断"载入/打开"按钮，再判断卡片：两者都可能命中，顺序错了会误载入 */
        var loadBtn = closestAttr(node, 'data-load', el);
        if (loadBtn) {
          var lc = findById(loadBtn.getAttribute('data-load'));
          if (lc) loadInto(lc);
          return;
        }
        var openBtn = closestAttr(node, 'data-open', el);
        if (openBtn) {
          openCustom(openBtn.getAttribute('data-open'));
          return;
        }

        var catBtn = closestAttr(node, 'data-cat', el);
        if (catBtn) {
          state.cat = catBtn.getAttribute('data-cat') || '';
          /* 只重画筛选条的高亮与网格，不整页重绘，输入框焦点才不会丢 */
          var chips = el.querySelectorAll('[data-cat]');
          for (var i = 0; i < chips.length; i++) {
            chips[i].classList.toggle('is-on', (chips[i].getAttribute('data-cat') || '') === state.cat);
          }
          paintGrid();
          return;
        }

        if (toggleChip(node, 'data-era', state.eras, el)) { paintGrid(); return; }
        if (toggleChip(node, 'data-country', state.countries, el)) { paintGrid(); return; }
        if (toggleChip(node, 'data-continent', state.continents, el)) { paintGrid(); return; }
        if (toggleChip(node, 'data-tag', state.tags, el)) { paintGrid(); return; }

        var srcBtn = closestAttr(node, 'data-src', el);
        if (srcBtn) {
          state.src = srcBtn.getAttribute('data-src') || 'all';
          var sbs = el.querySelectorAll('[data-src]');
          for (var s = 0; s < sbs.length; s++) {
            sbs[s].classList.toggle('is-on', (sbs[s].getAttribute('data-src') || '') === state.src);
          }
          paintGrid();
          return;
        }

        /* 编号 chip 自己会冒泡到这里，它不是卡片，别让 openDetail 抢走 */
        if (closestAttr(node, 'data-stylepop', el)) return;

        var cardEl = closestAttr(node, 'data-classic', el);
        if (cardEl) {
          var c = findById(cardEl.getAttribute('data-classic'));
          if (c) openDetail(c);
        }
      });

      /* 键盘 Esc 关浮层：只影响本视图的编号提示，不影响弹窗 */
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') hidePop();
      });

      /* 卡片上的标题是 <button>，键盘 Enter/Space 原生就会触发 click，
         所以不需要额外绑 keydown；这条注释防止后人误加。 */
    }
  }

  function toggleChip(node, attrName, bucket, stop) {
    var btn = closestAttr(node, attrName, stop);
    if (!btn) return false;
    var v = btn.getAttribute(attrName);
    if (!v) return false;
    var i = bucket.indexOf(v);
    if (i >= 0) bucket.splice(i, 1); else bucket.push(v);
    btn.classList.toggle('is-on', i < 0);
    return true;
  }

  function resetFilters() {
    state.q = '';
    state.cat = '';
    state.src = 'all';
    state.eras = [];
    state.countries = [];
    state.continents = [];
    state.tags = [];
    state.yFrom = null;
    state.yTo = null;
    var q = document.getElementById('classic-q');
    if (q) q.value = '';
  }

  function findById(id) {
    var list = allRecipes();
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  /** 向上找带某属性的祖先，不依赖 Element.closest（老浏览器未必有） */
  function closestAttr(node, name, stop) {
    while (node && node !== stop && node.nodeType === 1) {
      if (node.getAttribute && node.getAttribute(name) !== null) return node;
      node = node.parentNode;
    }
    return null;
  }

  BREW.UI.ClassicView = {
    id: 'classic',
    label: '经典配方库',
    icon: 'layers',
    /* 因为要保住 Alt+1..5 不变，本视图只能排在 defs 末段，
       再挂「设计」会在侧栏出现第二个「设计」分组标题。
       用「参考」独立成组：语义准确，且不制造重复标题。 */
    group: '参考',
    order: 7,
    render: render,
    onEnter: function () {
      /* 数据后到（dataReady）或用户自建配方变了 → 指标缓存可能过期 */
      dropCache();
      /* 离开再回来时浮层可能还挂在 body 上 */
      hidePop();
    }
  };

  /* 数据晚到时清缓存：首屏可能算过一次空配方 */
  if (BREW.Bus && typeof BREW.Bus.on === 'function') {
    BREW.Bus.on('dataReady', dropCache);
  }

})(typeof window !== 'undefined' ? window : globalThis);
