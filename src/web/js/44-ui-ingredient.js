/* ============================================================================
 * 风月酿研所 — 44-ui-ingredient.js
 * ----------------------------------------------------------------------------
 * 职责：原料库浏览视图。
 *   · 五个 Tab：麦芽 / 酒花 / 酵母 / 辅料 / 水与盐
 *   · 中文名 + 英文名模糊搜索，分类筛选，按关键参数排序
 *   · 列表顶部「品类导览」：按 cat（酒花按香型 grp、酵母按 type）分组的通识长文，
 *     筛选到某一类时自动展开那一篇——用户拿着 51 条麦芽时，最缺的是"这一类怎么用"
 *   · 表格行展开详情（简介导览 / 酿造要点 / 来历 / 风味 / 用法 / 注意事项 / 数据来源）
 *   · 置信度徽章 A / B / C —— 让用户一眼看出哪条数据可以直接用
 *   · 一键追加到当前配方；支持用户自建原料并存到 localStorage
 *   · 水与盐页签只做参数查询：不提供"添加到配方"，入口在配方页的水质面板
 *
 * 依赖：BREW.UI（esc/num/fmt/pool/byId/store/saveCustom/recipe/publish）
 *       BREW.DB.malts/hops/yeasts/adjuncts/waterSalts 与对应 *Cats 字典
 *       BREW.DB.catGuides（v1.4：{malt/hop/yeast/adjunct: [{key,zh,keys,lead,what,role,dose,mistakes}]}）
 *
 * v1.7：
 *   · 详情里新增两组折叠参数（酿造性能 / 储存与风味），摘要写"N/M 项有数据"，
 *     没填的项显示「—」而不是 0（PARAMS + paramText / paramRow / paramGroup）
 *   · 自建表单改成"必填极少 + 选填折叠"：必填只有 名称 + ppg / aa / att，
 *     其余按同样两组折叠；空串不写入 item，所以永远不会出现 0 冒充没填
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  var host = null;

  var state = {
    tab: 'malts',
    /* v1.2：目录 / 库存 / 采购三模式。
       刻意**不做成第 6 个 data-tab**——tools/cdp.js 有一条断言「页签共 5 个」，
       多一个页签就红。模式是页签之上的另一层开关，两者互不影响：
       切模式不动 tab/q/cat，切回来还是原来那一屏。 */
    mode: 'catalog',
    q: '',
    cat: 'all',
    sortKey: '',
    sortDir: 1,
    openId: '',
    /* 品类导览：guideKey 记住用户点开的是哪一篇，guideOpen 记住折叠状态。
       两者都放在 state 里而不是 DOM 上——paintGuide 会整块重绘 innerHTML，
       折叠状态放在 <details> 里会在任何一次重绘后丢失。 */
    guideKey: '',
    guideOpen: false
  };

  var MODES = [
    { id: 'catalog', label: '目录', icon: 'layers' },
    { id: 'stock', label: '库存', icon: 'sack' },
    { id: 'shopping', label: '采购', icon: 'scale' }
  ];

  var TABS = [
    { id: 'malts', label: '麦芽与谷物', icon: 'sack' },
    { id: 'hops', label: '酒花', icon: 'drop' },
    { id: 'yeasts', label: '酵母', icon: 'flask' },
    { id: 'adjuncts', label: '辅料', icon: 'layers' },
    /* id 必须叫 waterSalts：UI.pool(kind) / UI.list(kind) 直接拿 kind 当
       BREW.DB 的键去取，改成 waters 会拿到空数组 */
    { id: 'waterSalts', label: '水与盐', icon: 'beaker' }
  ];

  /* 页签 → catGuides 的键。水与盐没有导览（它不是投料，讲不出"用多少"） */
  var GUIDE_KEY = { malts: 'malt', hops: 'hop', yeasts: 'yeast', adjuncts: 'adjunct' };

  /* 每条原料落在导览的哪一组：麦芽看 cat，酒花看香型 grp，酵母看 type，辅料看 cat。
     grp 是 11 号文件里新增的字段，与 type（苦花/香花/双用途）正交，别混用。 */
  function groupValueOf(it) {
    if (state.tab === 'hops') return it.grp || '';
    if (state.tab === 'yeasts') return it.type || '';
    return it.cat || '';
  }

  /** 当前页签的导览篇列表（数据未载入时返回空数组） */
  function guidesFor(tab) {
    var box = (UI.db().catGuides || {})[GUIDE_KEY[tab]];
    return Array.isArray(box) ? box : [];
  }

  /** 某条原料所属的导览篇；找不到就返回 null（自建原料、水盐都会走到这里） */
  function guideOf(it) {
    var v = groupValueOf(it);
    if (!v) return null;
    var list = guidesFor(state.tab);
    for (var i = 0; i < list.length; i++) {
      if (list[i].keys && list[i].keys.indexOf(v) >= 0) return list[i];
    }
    return null;
  }

  /** 分类筛选后能唯一确定的导览篇：多于一篇就不猜（酒花按香型分组，与苦花/香花正交） */
  function autoGuide() {
    if (state.cat === 'all') return null;
    var list = guidesFor(state.tab), hit = null, n = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].keys && list[i].keys.indexOf(state.cat) >= 0) { hit = list[i]; n++; }
    }
    return n === 1 ? hit : null;
  }


  /* 每种原料的列定义与分类字典 */
  var SCHEMA = {
    malts: {
      catsKey: 'maltCats',
      sortKey: 'ppg',
      cols: [
        {
          head: '名称', cell: function (it) {
            return '<b>' + esc(it.name || it.id) + '</b>' +
              (it.en ? '<div class="u-xs u-dim">' + esc(it.en) + '</div>' : '');
          }
        },
        {
          head: '分类', cls: 'u-nowrap', cell: function (it) {
            var cats = UI.db().maltCats || {};
            var c = cats[it.cat];
            var col = c && c.color ? c.color : '#8a7b60';
            return '<span class="tag"><span class="tag__dot" style="background:' + attr(col) + '"></span>' +
              esc(c ? c.zh : (it.cat || '—')) + '</span>';
          }
        },
        { head: '产地', cls: 'u-nowrap u-muted', cell: function (it) { return esc(it.origin || '—'); } },
        { head: 'ppg', cls: 'num', cell: function (it) { return fmt(it.ppg, 0); } },
        {
          head: '色度', cls: 'num', cell: function (it) {
            return '<span style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end">' +
              '<span class="tag__dot" style="background:' + attr(UI.colorOfSrm(it.lov * 1.3546 - 0.76)) + '"></span>' +
              fmt(it.lov, 1) + '<span class="u-dim u-xs">L</span></span>';
          }
        },
        {
          head: '糖化', cls: 'u-nowrap u-xs u-dim', cell: function (it) {
            return it.mustMash === false ? '否（免糖化）' : '需糖化';
          }
        }
      ]
    },

    hops: {
      catsKey: 'hopCats',
      sortKey: 'aa',
      cols: [
        {
          head: '名称', cell: function (it) {
            return '<b>' + esc(it.name || it.id) + '</b>' +
              (it.en ? '<div class="u-xs u-dim">' + esc(it.en) + '</div>' : '');
          }
        },
        { head: '产地', cls: 'u-nowrap u-muted', cell: function (it) { return esc(it.origin || '—'); } },
        {
          head: 'α 酸', cls: 'num', cell: function (it) {
            return fmt(it.aa, 1) + '<span class="u-dim u-xs">%</span>';
          }
        },
        {
          head: '用途', cls: 'u-nowrap', cell: function (it) {
            var t = it.type || it.use || '';
            var map = { bittering: '苦花', aroma: '香花', dual: '双用途' };
            return '<span class="badge badge--neutral">' + esc(map[t] || t || '—') + '</span>';
          }
        },
        {
          head: '风味指向', cls: 'u-sm u-muted', cell: function (it) {
            /* 酒花的描述在 aroma 数组里，不是 flavor —— 早先只读 flavor，
               这一列对 75 支酒花恒为"—"。自建酒花仍可能只填 flavor，所以两条都兜。 */
            var txt = it.flavor ||
              (Array.isArray(it.aroma) ? it.aroma.join(' · ') : (it.aroma || ''));
            return UI.md(txt ? String(txt).slice(0, 26) : '—');
          }
        }
      ]
    },

    yeasts: {
      catsKey: 'yeastCats',
      sortKey: 'att',
      cols: [
        {
          head: '菌株', cell: function (it) {
            /* 英文名与产品编号是两件事，都要给（v1.7）：
               原来写的是 `it.code || it.en`，一旦有编号就把英文名吞掉了 ——
               用户按 "US-05" 搜得到，按 "California Ale" 却搜不到第二行看不着的名字。
               现在排成「英文名 · 编号」，缺哪个就省哪个，不补占位符。 */
            var sub = [it.en, it.code].filter(function (x) { return !!x; }).join(' · ');
            return '<b>' + esc(it.name || it.id) + '</b>' +
              (sub ? '<div class="u-xs u-dim">' + esc(sub) + '</div>' : '');
          }
        },
        {
          head: '类型', cls: 'u-nowrap', cell: function (it) {
            var t = it.type || it.form || '';
            return '<span class="badge badge--neutral">' + esc(t || '—') + '</span>';
          }
        },
        {
          head: '酵母标称衰减度', cls: 'num', cell: function (it) {
            /* v2.0 更正：内置酵母的字段叫 att（12-data-yeast），**自建条目现在写的也是 att**
               （保存逻辑 `item.att = att`）。`atten` 只可能来自更早版本存下的老数据，
               所以这里必须两个都能读——现统一走 UI.yeastAtt（40 里的唯一取数口）。
               写死 it.att 会让老自建酵母这一列恒为默认值；写死 it.atten 会让内置酵母恒为「—%」。 */
            return fmt(UI.yeastAtt(it), 0) + '<span class="u-dim u-xs">%</span>';
          }
        },
        {
          head: '温度区间', cls: 'num u-nowrap', cell: function (it) {
            return esc(it.tempRange || (isFinite(it.tempMin) ? fmt(it.tempMin, 0) + '–' + fmt(it.tempMax, 0) + ' °C' : '—'));
          }
        },
        { head: '发酵度', cls: 'u-nowrap u-muted u-sm', cell: function (it) { return esc(it.attenGroup || it.floc || '—'); } }
      ]
    },

    adjuncts: {
      catsKey: 'adjunctCats',
      sortKey: '',
      cols: [
        {
          head: '名称', cell: function (it) {
            return '<b>' + esc(it.name || it.id) + '</b>' +
              (it.en ? '<div class="u-xs u-dim">' + esc(it.en) + '</div>' : '');
          }
        },
        { head: '分类', cls: 'u-nowrap u-muted', cell: function (it) { return esc(it.cat || '—'); } },
        { head: '用途', cls: 'u-sm u-muted', cell: function (it) { return UI.md(it.use || '—'); } },
        {
          head: '建议用量', cls: 'num u-nowrap', cell: function (it) {
            return it.dose ? esc(it.dose) : '—';
          }
        }
      ]
    },

    /* 水与盐：只做参数查询，不提供"添加到配方"——水盐不是投料，
       它是按 g / ml 加到糖化水里的，入口在配方页的水质面板。 */
    waterSalts: {
      catsKey: '',
      sortKey: '',
      cols: [
        {
          head: '名称', cell: function (it) {
            return '<b>' + esc(it.name || it.id) + '</b>' +
              (it.formula ? '<div class="u-xs u-dim">' + esc(it.formula) + '</div>' : '');
          }
        },
        {
          head: '有效成分', cls: 'u-sm', cell: function (it) {
            return saltIonCell(it);
          }
        },
        { head: '作用', cls: 'u-sm u-muted', cell: function (it) { return UI.md(it.effect || '—'); } },
        { head: '常用量', cls: 'u-sm', cell: function (it) { return UI.md(it.use || '—'); } }
      ]
    }
  };

  /* ======================================================================
   * v1.7 原料参数层（**全部选填**）
   * ----------------------------------------------------------------------
   * 三个分组，与界面上的三块一一对应：
   *   basic 基础        —— 色度 EBC（其余基础项在 SCHEMA 的列里已经有）；
   *   brew  酿造性能    —— 糖化与发酵时真会翻着看的数；
   *   keep  储存与风味  —— 储存稳定性、香气潜力。
   * brew / keep 默认折叠，摘要写"3/5 项有数据"：不展开也知道这批数据填了多少。
   *
   * **空值一律显示「—」，绝不显示 0。** fmt() 对 undefined 返回「—」，
   * 而 num(v, 0) 会返回 0 —— 后者正是"0 冒充没填"的根源，所以这里只用 fmt。
   *
   * 每条数据是否该填、填多少，以 src / psrc 为准。没有厂商规格表就留空。
   * ====================================================================*/
  var PARAMS = {
    malts: [
      { grp: 'basic', key: 'ebc', zh: '色度 EBC', unit: 'EBC',
        why: '袋上标 EBC 时直接对照，省得除以 1.97' },
      { grp: 'brew', key: 'extractFG', zh: '细粉浸出率', unit: '%',
        why: '理论 ppg 的上限，实测出糖偏低时先查它' },
      { grp: 'brew', key: 'protein', zh: '总蛋白', unit: '%',
        why: '>12% 泡沫更厚，但浑浊与过滤风险上升' },
      { grp: 'brew', key: 'kolbach', zh: 'Kolbach 指数', unit: '%',
        why: '蛋白溶解度，36–42 为溶解良好，偏低要延长蛋白休止' },
      { grp: 'brew', key: 'friability', zh: '脆度', unit: '%',
        why: '反映溶解与粉碎难易，<80 说明这批麦溶解不足' },
      { grp: 'brew', key: 'dpLintner', zh: '糖化力', unit: '°Lintner',
        why: '≥35 能自给自足；辅料多时靠它判断还要不要补酶' },
      { grp: 'keep', key: 'moisture', zh: '水分', unit: '%',
        why: '>6% 易霉变，称量要按干物质折算' }
    ],

    hops: [
      { grp: 'brew', key: 'beta', zh: 'β 酸', unit: '%',
        why: '陈化后苦味会往上走，β 高更耐放' },
      { grp: 'brew', key: 'coh', zh: '合葎草酮', unit: '%',
        why: '>30 苦味偏尖锐，<25 更圆润' },
      { grp: 'brew', key: 'totalOil', zh: '总精油', unit: 'mL/100g',
        why: '香气强度上限：干投能出多少香，先看它' },
      { grp: 'keep', key: 'myrcene', zh: '月桂烯', unit: '% 油',
        why: '柑橘与松针的前体，高则香气外放、也更容易氧化' },
      { grp: 'keep', key: 'humulene', zh: '葎草烯', unit: '% 油',
        why: '辛香与"酒花香"的骨架，低则香气偏单薄' },
      { grp: 'keep', key: 'caryophyllene', zh: '石竹烯', unit: '% 油',
        why: '胡椒与木质调，与葎草烯一起决定贵族感' },
      { grp: 'keep', key: 'hsi', zh: '储存指数', unit: '%',
        why: '20°C 放 6 个月后 α 的保留率；低就该趁新鲜用' },
      { grp: 'keep', key: 'year', zh: '年份', unit: '年',
        why: '酒花是农产品，同一品种不同年份能差 3 个点 α' }
    ],

    yeasts: [
      { grp: 'brew', key: 'phenolic', zh: '酚香（POF）', unit: '',
        why: 'POF+ 产丁香酚：别和干净拉格共用桶，酚味洗不掉',
        opts: [['POF+', 'POF+（产酚）'], ['POF−', 'POF−（不产酚）']] },
      { grp: 'brew', key: 'abvTol', zh: '酒精耐受', unit: '%',
        why: '超过这个酒精度，发酵会停在半路' },
      { grp: 'brew', key: 'pitchRate', zh: '建议接种率', unit: 'M/mL/°P',
        why: '20L 12°P 的艾尔约 1800 亿细胞；拉格要翻倍' },
      { grp: 'keep', key: 'ester', zh: '酯香风格', unit: '', text: true,
        why: '选菌时的第一直觉：做"干净"还是做"果香"' },
      { grp: 'keep', key: 'rehydration', zh: '是否需活化', unit: '', text: true,
        why: '干酵母多数可直接撒；液体酵母不适用' }
    ],

    adjuncts: [
      { grp: 'brew', key: 'extractYield', zh: '可发酵浸出物', unit: '%',
        why: '投多少会抬多少 OG —— 果泥与蜂蜜先按它算糖' },
      { grp: 'brew', key: 'fermentability', zh: '可发酵性', unit: '',
        why: '高 = 变酒精把酒体做薄；低 = 留在酒里当甜与口感',
        opts: [['high', '高（几乎全发酵）'], ['med', '中'], ['low', '低'], ['none', '不可发酵']] },
      { grp: 'keep', key: 'allergen', zh: '过敏原', unit: '', text: true,
        why: '贴标与待客时必须能说出来（甲壳类 / 亚硫酸盐）' }
    ]
  };

  function paramDefs() { return PARAMS[state.tab] || []; }

  /** 参数值 → 显示串；没填返回 null，调用方决定显示「—」还是整行不显示 */
  function paramText(it, p) {
    var v = it[p.key];
    if (v === undefined || v === null || v === '') return null;
    var s = (typeof v === 'number') ? fmt(v, 1) : String(v);
    return p.unit ? s + ' ' + p.unit : s;
  }

  /* 每 1 g（酸剂 1 ml）盐加入 20L 水后的离子增量，按这个顺序拼，最多 3 项 */
  var ION_ORDER = [
    ['ca', 'Ca'], ['so4', 'SO₄'], ['cl', 'Cl'],
    ['mg', 'Mg'], ['na', 'Na'], ['hco3', 'HCO₃']
  ];

  /** 有效成分单元：离子贡献 + 碱度影响。酸剂没有离子贡献，只显示碱度变化 */
  function ionParts(it) {
    var ion = it.ion || {};
    var parts = [];
    for (var i = 0; i < ION_ORDER.length; i++) {
      var v = num(ion[ION_ORDER[i][0]], 0);
      if (v !== 0) parts.push(ION_ORDER[i][1] + ' ' + fmt(v, 1));
    }
    return parts;
  }

  /** 碱度变化（纯文本）。碳酸钙提高碱度，酸剂降低碱度，其余为空 */
  function alkText(it) {
    var alkMl = num(it.alkalinityPerMl, NaN);
    if (isFinite(alkMl)) return '降低碱度 ' + fmt(Math.abs(alkMl), 1) + ' mg/L · 每 1 ml';
    var alk = num(it.alkalinityPerG, NaN);
    if (isFinite(alk)) return '提高碱度 ' + fmt(alk, 1) + ' mg/L · 每 1 g';
    return '';
  }

  function saltIonCell(it) {
    var parts = ionParts(it);
    var unit = it.unit === 'ml' ? 'ml' : 'g';
    var alk = alkText(it);
    var html = '';

    if (parts.length) {
      html += '<span class="u-mono">' + esc(parts.slice(0, 3).join(' · ')) + '</span>' +
        '<div class="u-xs u-dim">mg/L · 每 1 ' + unit + '</div>';
    }
    if (alk) {
      html += '<div class="u-xs' + (parts.length ? ' u-dim' : '') + '">' + esc(alk) + '</div>';
    }
    return html || '—';
  }

  /** 详情行用的纯文本版本 */
  function saltIonText(it) {
    var parts = ionParts(it);
    var out = parts.length ? parts.join(' · ') + ' mg/L' : '';
    var alk = alkText(it);
    if (alk) out += (out ? '；' : '') + alk;
    return out;
  }

  /* ======================================================================
   * 渲染
   * ====================================================================*/

  function render(el) {
    host = el;
    el.innerHTML =
      '<div class="section-title">' +
        '<h2>原料库</h2>' +
        '<p>参数为标称值；A 级可直用，C 级请先查厂商 COA</p>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="ing-new-custom" data-act="new-custom">' + icon('plus', 13) + '自建原料</button>' +
      '</div>' +
      '<div class="card">' +
        /* 页签与模式开关并排：两者是不同的东西，视觉上分开但不各占一行 */
        '<div class="tabs-row">' +
          '<div class="tabs" id="ing-tabs" role="tablist">' + tabsHtml() + '</div>' +
          '<div class="mode-switch" id="ing-modes" role="group" aria-label="资料视图模式">' + modesHtml() + '</div>' +
        '</div>' +
        '<div class="toolbar" id="ing-toolbar">' +
          '<div class="input-wrap" style="max-width:280px">' +
            '<input class="input has-icon" id="ing-q" type="search" placeholder="搜索中文名 / 英文名 / 产地…" ' +
            'aria-label="搜索原料" value="' + attr(state.q) + '">' +
            '<span class="input-wrap__icon">' + icon('search', 14) + '</span>' +
          '</div>' +
          '<div class="row row--tight" id="ing-cats"></div>' +
          '<span class="spacer"></span>' +
          '<span class="u-xs u-dim" id="ing-count"></span>' +
        '</div>' +
        /* 品类导览：挂在工具栏与表格之间，不进 tbody——
           tools/cdp.js 用 #ing-tbody tr[data-expand] 数行数（麦芽 51 / 水盐 10），
           往 tbody 里塞任何行都会让这两条断言红掉。 */
        '<div id="ing-guide" style="display:none;padding:10px 14px;background:var(--bg-inset);' +
          'border-top:1px solid var(--line);border-bottom:1px solid var(--line)"></div>' +
        '<div class="table-wrap" id="ing-table-wrap"><table class="table">' +
          '<thead id="ing-thead"></thead>' +
          '<tbody id="ing-tbody"></tbody>' +
        '</table></div>' +
        /* 库存 / 采购模式的挂载点：整块由 47-ui-inventory.js 填充，
           44 只负责显示与隐藏，不碰里面的任何 DOM */
        '<div id="ing-panel" class="ing-panel" style="display:none"></div>' +
        '<div class="card__foot" id="ing-foot">' +
          '<span class="u-xs u-dim">置信度：</span>' + UI.badgeConf('A') + UI.badgeConf('B') + UI.badgeConf('C') +
          '<span class="spacer"></span>' +
          '<span class="u-xs u-dim" id="ing-foot-hint">点击任意一行查看风味、用法与数据来源</span>' +
        '</div>' +
      '</div>';

    bind(el);
    paintCats();
    paintTable();
    syncChrome();
    syncMode();
  }

  /* ======================================================================
   * 品类导览
   * --------------------------------------------------------------------
   * 三层分工：列表回答"有哪些"，分类筛选回答"要哪一类"，导览回答"这一类怎么用"。
   * 导览正文只在展开时渲染——7 篇加起来 3000 余字，常驻展开会把表格顶出屏幕。
   * ====================================================================*/

  /** 一篇导览的正文：一句话定位 + 分段小标题 + 三个常见错误
   *  分段是"有什么写什么"：麦芽/酵母/辅料讲"在配方里 / 用多少"，
   *  酒花讲"什么时候投 / 用量与 IBU"——两种措辞不能硬套成同一组标题。 */
  function guideBody(g) {
    var html = '<p class="u-sm" style="margin:0 0 8px">' + UI.md(g.lead || '') + '</p>';
    var blocks = [
      ['是什么', g.what],
      ['在配方里', g.role],
      ['什么时候投', g.when],
      ['用量与 IBU', g.ibu],
      ['用多少', g.dose]
    ];
    for (var i = 0; i < blocks.length; i++) {
      if (!blocks[i][1]) continue;
      html += '<div style="margin-bottom:8px">' +
        '<div class="u-xs u-dim">' + esc(blocks[i][0]) + '</div>' +
        '<p class="u-sm" style="margin:2px 0 0;line-height:1.7">' + UI.md(blocks[i][1]) + '</p></div>';
    }
    var ms = g.mistakes || [];
    if (ms.length) {
      /* 不用 <ol>：style.css 有全局 `ul, ol { list-style: none }`，
         有序列表在界面上会退化成三行没有编号的段落。序号自己画，
         也不依赖 ::marker 的浏览器差异。 */
      html += '<div><div class="u-xs u-dim">最容易错的三件事</div>';
      for (var j = 0; j < ms.length; j++) {
        html += '<div style="display:flex;gap:8px;align-items:baseline;margin-top:4px">' +
          '<span class="u-xs u-dim" style="flex:0 0 14px;text-align:right">' + (j + 1) + '</span>' +
          '<span class="u-sm" style="flex:1 1 auto;line-height:1.7">' + UI.md(ms[j]) + '</span></div>';
      }
      html += '</div>';
    }
    return html;
  }

  /** 列表顶部的导览入口。折叠状态来自 state，重绘不会把用户展开的那一篇折回去 */
  function paintGuide() {
    var box = document.getElementById('ing-guide');
    if (!box) return;
    var list = guidesFor(state.tab);
    if (state.mode !== 'catalog' || !list.length) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }

    var cur = null;
    for (var i = 0; i < list.length; i++) if (list[i].key === state.guideKey) cur = list[i];
    if (!cur) cur = list[0];
    var open = !!state.guideOpen;

    var html = '<div class="row row--tight" style="align-items:baseline">' +
      '<button type="button" class="btn btn-ghost btn-xs" data-guide-toggle="1" ' +
        'aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span style="display:inline-block;width:10px;color:var(--amber-dim)">' + (open ? '▾' : '▸') + '</span>' +
        (open ? '品类导览 · ' + esc(cur.zh) : '品类导览 · 共 ' + list.length + ' 篇') +
      '</button>' +
      '<span class="u-xs u-dim">' +
        (open ? '这一类是什么、在配方里干什么、用多少、最容易错在哪'
              : '先弄清这一类怎么用，再挑具体品种——筛到某一类会自动展开') +
      '</span>' +
      '</div>';

    if (open) {
      html += '<div class="row row--tight mt-8">';
      for (var k = 0; k < list.length; k++) {
        html += '<button type="button" class="chip' + (list[k].key === cur.key ? ' is-on' : '') + '" ' +
          'data-guide="' + attr(list[k].key) + '">' + esc(list[k].zh) + '</button>';
      }
      html += '</div><div class="mt-12">' + guideBody(cur) + '</div>';
    }

    box.style.display = '';
    box.innerHTML = html;
  }

  function modesHtml() {
    var html = '';
    for (var i = 0; i < MODES.length; i++) {
      var m = MODES[i];
      html += '<button type="button" class="mode-btn' + (state.mode === m.id ? ' is-on' : '') + '" ' +
        'data-mode="' + attr(m.id) + '" aria-pressed="' + (state.mode === m.id) + '">' +
        icon(m.icon, 12) + '<span>' + esc(m.label) + '</span></button>';
    }
    return html;
  }

  /**
   * 目录 ↔ 库存 ↔ 采购。
   * 只切可见性，不动 state.q / state.cat / state.tab，所以切回目录时
   * 搜索词、分类筛选、展开行都还在——这是"切模式"而不是"换页面"。
   */
  function syncMode() {
    var isCatalog = state.mode === 'catalog';

    var box = document.getElementById('ing-modes');
    if (box) box.innerHTML = modesHtml();

    var toolbar = document.getElementById('ing-toolbar');
    if (toolbar) toolbar.style.display = isCatalog ? '' : 'none';
    var table = document.getElementById('ing-table-wrap');
    if (table) table.style.display = isCatalog ? '' : 'none';

    /* 品类导览只属于目录：库存 / 采购模式下它既没有落点，也没有意义 */
    var guide = document.getElementById('ing-guide');
    if (guide && !isCatalog) { guide.style.display = 'none'; guide.innerHTML = ''; }
    if (isCatalog) paintGuide();

    /* 置信度徽章是"原料库"的口径说明，库存面板用不上 */
    var foot = document.getElementById('ing-foot');
    if (foot) foot.style.display = isCatalog ? '' : 'none';

    var panel = document.getElementById('ing-panel');
    if (!panel) return;

    if (isCatalog) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }

    panel.style.display = '';
    if (!UI.InventoryPanel || typeof UI.InventoryPanel.mount !== 'function') {
      panel.innerHTML = '<div class="alert alert--warn" style="margin:14px">' +
        '<span class="alert__icon">' + icon('alert', 13) + '</span>' +
        '<span>库存模块未载入（js/47-ui-inventory.js）。界面已经就位，' +
        '模块落盘后刷新即可用。</span></div>';
      return;
    }
    try {
      UI.InventoryPanel.mount(panel, { mode: state.mode });
    } catch (e) {
      panel.innerHTML = '<div class="alert alert--error" style="margin:14px">' +
        '<span class="alert__icon">' + icon('alert', 13) + '</span>' +
        '<span>库存面板渲染失败：' + esc(String((e && e.message) || '未知错误')) + '</span></div>';
    }
  }

  /** 页签影响到的"页头与页脚"部分：自建按钮、搜索占位、脚注文案。
   *  用 style.display 而不是 hidden 属性——.btn 自带 display:inline-flex，
   *  作者样式会盖掉 UA 的 [hidden]{display:none}，看起来像没生效。 */
  function syncChrome() {
    var isSalt = state.tab === 'waterSalts';
    /* 库存 / 采购模式下"自建原料"没有落点（它属于目录），一起收起来 */
    var isCatalog = state.mode === 'catalog';

    var btn = document.getElementById('ing-new-custom');
    if (btn) btn.style.display = (isSalt || !isCatalog) ? 'none' : '';

    var q = document.getElementById('ing-q');
    if (q) {
      q.placeholder = isSalt
        ? '搜索名称 / 化学式 / 作用…（试试 CaSO、乳酸）'
        : '搜索中文名 / 英文名 / 产地…';
    }

    var hint = document.getElementById('ing-foot-hint');
    if (hint) {
      hint.textContent = isSalt
        ? '点击任意一行查看化学式、离子贡献与换算口径'
        : '点击任意一行查看简介、酿造要点、来历与数据来源';
    }
  }

  function tabsHtml() {
    var html = '';
    for (var i = 0; i < TABS.length; i++) {
      var t = TABS[i];
      var n = UI.pool(t.id).length;
      html += '<button type="button" class="tab' + (state.tab === t.id ? ' is-on' : '') + '" ' +
        'role="tab" aria-selected="' + (state.tab === t.id) + '" data-tab="' + attr(t.id) + '">' +
        esc(t.label) + '<span class="tab__count">' + n + '</span></button>';
    }
    return html;
  }

  function paintCats() {
    var box = document.getElementById('ing-cats');
    if (!box) return;
    var schema = SCHEMA[state.tab];
    var cats = UI.db()[schema.catsKey] || {};
    var used = {};
    var pool = UI.pool(state.tab);
    for (var i = 0; i < pool.length; i++) {
      var c = pool[i].cat;
      if (c) used[c] = true;
    }
    var keys = Object.keys(cats).length ? Object.keys(cats) : Object.keys(used);
    if (!keys.length) { box.innerHTML = ''; return; }

    var html = '<button type="button" class="chip' + (state.cat === 'all' ? ' is-on' : '') + '" data-cat="all">全部</button>';
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (Object.keys(cats).length && !used[k]) continue;
      var label = cats[k] && cats[k].zh ? cats[k].zh : k;
      html += '<button type="button" class="chip' + (state.cat === k ? ' is-on' : '') + '" data-cat="' + attr(k) + '">' +
        esc(label) + '</button>';
    }
    box.innerHTML = html;
  }

  function filtered() {
    var pool = UI.pool(state.tab);
    var q = state.q.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < pool.length; i++) {
      var it = pool[i];
      if (state.cat !== 'all' && it.cat !== state.cat) continue;
      if (q) {
        /* formula / effect 也要能搜：搜 "CaSO" 要出石膏，搜 "降碱" 要出酸剂 */
        var hay = ((it.name || '') + ' ' + (it.en || '') + ' ' + (it.code || '') + ' ' +
          (it.origin || '') + ' ' + (it.flavor || '') + ' ' + (it.use || '') + ' ' +
          (it.formula || '') + ' ' + (it.effect || '')).toLowerCase();
        if (hay.indexOf(q) === -1) continue;
      }
      out.push(it);
    }
    var sk = state.sortKey || SCHEMA[state.tab].sortKey;
    if (sk) {
      out.sort(function (a, b) {
        var av = num(a[sk], -1), bv = num(b[sk], -1);
        if (av === bv) return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
        return (av - bv) * state.sortDir;
      });
    } else {
      out.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'zh'); });
    }
    return out;
  }

  function paintTable() {
    var thead = document.getElementById('ing-thead');
    var tbody = document.getElementById('ing-tbody');
    if (!thead || !tbody) return;

    var schema = SCHEMA[state.tab];
    var pool = UI.list(state.tab);
    var list = filtered();

    /* 导览在空列表时也要留着：用户筛出 0 条时，最需要的恰恰是"这一类的正确姿势" */
    paintGuide();

    var headHtml = '<tr>';
    for (var c = 0; c < schema.cols.length; c++) {
      var col = schema.cols[c];
      headHtml += '<th class="' + (col.cls || '') + '">' + esc(col.head) + '</th>';
    }
    headHtml += '<th class="num" style="width:74px">置信度</th><th style="width:96px"></th></tr>';
    thead.innerHTML = headHtml;

    var cnt = document.getElementById('ing-count');
    if (cnt) cnt.textContent = '共 ' + list.length + ' 条' + (state.q || state.cat !== 'all' ? '（已筛选）' : '');

    if (!pool.length) {
      tbody.innerHTML = '<tr><td colspan="' + (schema.cols.length + 2) + '">' +
        UI.emptyState('这一类原料还没载入',
          state.tab === 'malts'
            ? '麦芽库应当最先就绪。如果这里为空，说明数据文件未成功加载。'
            : state.tab === 'waterSalts'
              ? '数据文件 14-data-water.js 未成功加载，盐类与酸剂都在那个文件里。'
              : '数据文件 11-data-hop / 12-data-yeast / 13-data-adjunct 可能尚未写入，稍后会自动出现。',
          { art: 'search' }) + '</td></tr>';
      return;
    }
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="' + (schema.cols.length + 2) + '">' +
        UI.emptyState('没有匹配的原料', '换个关键词，或把分类筛选切回"全部"。', { art: 'search', small: true }) +
        '</td></tr>';
      return;
    }

    var r = UI.recipe();
    /* 水盐没有"在配方里"的概念：它在配方里是 water.salts 的子项、
       行结构是 {id, amount, unit}，与 inRecipeIndex 的其他分支不兼容，
       直接传空表，避免误落到 r.adjuncts 把所有水盐标成"已在配方" */
    var inRecipe = state.tab === 'waterSalts' ? {} : inRecipeIndex(r, state.tab);
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var open = state.openId === it.id;
      /* v1.8：每块板自己的色标。取的是这一条原料**分类**的颜色
         （DB.maltCats / hopCats / yeastCats / adjunctCats 里已有的 color，
         与「分类」列那个小圆点是同一个值），所以板左侧的竖条与圆点永远同色，
         不会出现"两个地方说两种分类"。
         只写一个 CSS 变量、不写颜色本身：颜色仍然只有 :root 一处定义，
         这里只做"搬运"。水盐没有分类字典，留空 → CSS 落回中性线。 */
      var accent = rowAccent(schema, it);
      html += '<tr class="is-clickable' + (open ? ' is-open' : '') + '" data-expand="' + attr(it.id) + '" ' +
        (accent ? 'style="--row-accent:' + attr(accent) + '" ' : '') +
        'tabindex="0" role="button" aria-expanded="' + (open ? 'true' : 'false') + '">';
      for (var k = 0; k < schema.cols.length; k++) {
        html += '<td class="' + (schema.cols[k].cls || '') + '">' + schema.cols[k].cell(it) + '</td>';
      }
      html += '<td class="num">' + (it.custom ? '<span class="badge badge--neutral">自建</span>' : UI.badgeConf(it.conf)) + '</td>' +
        '<td class="u-right">' + rowAction(it, inRecipe) + '</td></tr>';
      if (open) html += detailRow(it, schema);
    }
    tbody.innerHTML = html;
  }

  /** v1.8：这一行原料的分类色（搬运 DB 里的 color，不在这里定义颜色）。
   *  没有分类字典的 tab（水盐）返回空串，CSS 会落回中性分隔线。 */
  function rowAccent(schema, it) {
    if (!schema || !schema.catsKey || !it.cat) return '';
    var cats = UI.db()[schema.catsKey] || {};
    var c = cats[it.cat];
    return (c && c.color) ? c.color : '';
  }

  /** 行尾动作：水盐不给"添加到配方"，改为指向水质面板 */
  function rowAction(it, inRecipe) {
    if (state.tab === 'waterSalts') {
      return '<span class="badge badge--neutral" title="在「配方设计 → 水质」里按 g / ml 添加">水质面板</span>';
    }
    if (inRecipe[it.id]) return '<span class="badge badge--amber">已在配方</span>';
    return '<button type="button" class="btn btn-ghost btn-xs" data-add="' + attr(it.id) + '">添加到配方</button>';
  }

  /** 一行参数：名称 / 数值（没填是「—」）/ 这一项酿酒师拿来干什么 */
  function paramRow(it, p) {
    var txt = paramText(it, p);
    return '<div class="row row--tight" style="align-items:baseline;gap:10px;padding:3px 0">' +
      '<span class="u-xs u-dim" style="flex:0 0 86px">' + esc(p.zh) + '</span>' +
      '<span class="u-sm' + (txt === null ? ' u-dim' : '') + '" style="flex:0 0 96px">' +
        esc(txt === null ? '—' : txt) + '</span>' +
      '<span class="u-xs u-dim" style="flex:1 1 auto">' + esc(p.why) + '</span></div>';
  }

  /** 一个折叠组：摘要里直接给出"N/M 项有数据"，不展开也知道这批数据的密度 */
  function paramGroup(it, grp, title) {
    var all = paramDefs(), defs = [], i;
    for (i = 0; i < all.length; i++) if (all[i].grp === grp) defs.push(all[i]);
    if (!defs.length) return '';

    var filled = 0, body = '';
    for (i = 0; i < defs.length; i++) {
      if (paramText(it, defs[i]) !== null) filled++;
      body += paramRow(it, defs[i]);
    }
    return '<details class="style-dossier" style="margin-top:10px">' +
      '<summary>' + esc(title) + ' · ' + filled + '/' + defs.length + ' 项有数据</summary>' +
      '<div class="style-dossier__body">' + body + '</div></details>';
  }

  /** 行展开后的三段文案：简介（品类导览，折叠）/ 酿造要点 / 来历
   *  - 简介用 <details>：默认收起，展开就在原地读，不必跳到筛选去
   *  - craft 一定有（211 条全量），story 只有有据可查的 26 条，缺失时明确说明
   *  - 全部走 UI.md()，**强调** 渲染成 <strong>，界面上不露星号 */
  function copySections(it) {
    var html = '';
    var g = guideOf(it);

    if (g) {
      html += '<details class="style-dossier" style="margin-top:10px">' +
        '<summary>简介 · ' + esc(g.zh) + '这一类怎么用</summary>' +
        '<div class="style-dossier__body">' + guideBody(g) + '</div>' +
        '</details>';
    }

    if (it.craft) {
      html += '<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">' +
        '<div class="u-xs u-dim">酿造要点</div>' +
        '<p class="u-sm" style="margin:2px 0 0;line-height:1.7">' + UI.md(it.craft) + '</p></div>';
    }

    html += '<div style="margin-top:8px">' +
      '<div class="u-xs u-dim">来历</div>' +
      (it.story
        ? '<p class="u-sm" style="margin:2px 0 0;line-height:1.7">' + UI.md(it.story) + '</p>'
        : '<p class="u-sm u-dim" style="margin:2px 0 0">' +
          (it.custom ? '自建原料，没有内置的来历文案。' : '这一条是通用品类，没有单独的来历。') +
          '</p>') +
      '</div>';

    return html;
  }

  function detailRow(it, schema) {
    var cols = schema.cols.length + 2;
    var notes = '';
    if (it.note) {
      notes += '<div class="alert alert--warn" style="margin-top:8px">' +
        '<span class="alert__icon">' + icon('alert', 13) + '</span>' +
        '<span>' + UI.md(it.note) + '</span></div>';
    }
    var pairs = [];

    if (state.tab === 'waterSalts') {
      if (it.formula) pairs.push(['化学式', it.formula]);
      var contrib = saltIonText(it);
      if (contrib) pairs.push(['每 1 ' + (it.unit === 'ml' ? 'ml' : 'g'), contrib]);
      if (it.effect) pairs.push(['作用', it.effect]);
      if (it.limit) pairs.push(['使用上限', it.limit]);
      if (it.calc) pairs.push(['换算口径', it.calc]);
    } else {
      if (it.flavor) pairs.push(['风味', it.flavor]);
      if (it.use) pairs.push(['典型用法', it.use]);
      if (it.fermentable) pairs.push(['可发酵性', it.fermentable]);
      if (it.maxPct) pairs.push(['建议上限', it.maxPct + '%']);
      if (it.cat && !UI.db()[schema.catsKey]) pairs.push(['分类', it.cat]);
      if (it.conf && it.conf === 'C') pairs.push(['使用提示', 'C 级为区间估值，投料前请核对厂商 COA 的实际 ppg / 色度']);

      /* basic 组的新参数（目前只有色度 EBC）：有值才拼进基础表。
         没值的项不占行——基础表要保持"一眼看完"，缺失由下面两个折叠组的
         "N/M 项有数据"来交代。 */
      var basics = paramDefs();
      for (var b = 0; b < basics.length; b++) {
        if (basics[b].grp !== 'basic') continue;
        var bt = paramText(it, basics[b]);
        if (bt !== null) pairs.push([basics[b].zh, bt]);
      }
    }

    var body = '';
    if (pairs.length) {
      body += '<div class="grid-2" style="gap:6px 20px">';
      for (var i = 0; i < pairs.length; i++) {
        body += '<div class="row row--tight" style="align-items:baseline;gap:10px">' +
          '<span class="u-xs u-dim" style="min-width:66px">' + esc(pairs[i][0]) + '</span>' +
          '<span class="u-sm">' + UI.md(String(pairs[i][1])) + '</span></div>';
      }
      body += '</div>';
    }
    /* v1.4：新增的简介 / 酿造要点 / 来历接在参数表下面；
       数据来源仍然是最后一行（它是脚注，放在正文中间会把三段文案切断）。
       src 的渲染逻辑一个字没改，只调整了它与新分区的先后。 */
    if (state.tab !== 'waterSalts') {
      /* v1.7：两个折叠组放在基础参数之后、文案之前——先给数，再讲用法 */
      body += paramGroup(it, 'brew', '酿造性能');
      body += paramGroup(it, 'keep', '储存与风味');
      if (it.psrc) {
        body += '<p class="u-xs u-dim mt-8">参数出处：' + UI.md(it.psrc) + '</p>';
      }
      body += copySections(it);
    }
    if (it.src) {
      body += '<p class="u-xs u-dim mt-8">数据来源：' + UI.md(it.src) + '</p>';
    }
    if (!body && !notes) body = '<p class="u-sm u-dim">这条记录没有补充说明。</p>';

    /* 水盐不提供"添加到配方"：它不是投料，入口在配方页的水质面板 */
    var foot = state.tab === 'waterSalts'
      ? '<p class="u-xs u-dim" style="margin-top:10px">' +
        '水盐在「配方设计 → 水质」里按 g / ml 添加，这里只做参数查询。</p>'
      : '<div class="row mt-12">' +
        '<button type="button" class="btn btn-primary btn-sm" data-add="' + attr(it.id) + '">' +
          icon('plus', 12) + '添加到当前配方</button>' +
        '<span class="u-xs u-dim">加入后可到"配方设计"里调整用量</span>' +
        '</div>';

    return '<tr class="is-open" data-detail="' + attr(it.id) + '">' +
      '<td colspan="' + cols + '" style="background:var(--bg-inset);padding:12px 14px">' +
        body + notes + foot +
      '</td></tr>';
  }

  /** 当前配方已包含哪些原料 id
   *  兼容两种行结构：库里快照行用 id，视图层模型行可能用 ingId；
   *  麦芽数组也可能叫 fermentables（标准）或 malts（旧字段）。 */
  function inRecipeIndex(r, kind) {
    var map = {};
    if (!r) return map;
    var arr = kind === 'malts' ? (r.fermentables || r.malts)
      : kind === 'hops' ? r.hops
        : kind === 'yeasts' ? r.yeasts
          : r.adjuncts;
    if (!arr || typeof arr.length !== 'number') return map;
    for (var i = 0; i < arr.length; i++) {
      var row = arr[i];
      if (!row) continue;
      var key = row.id || row.ingId;
      if (key) map[key] = true;
    }
    return map;
  }

  /* ======================================================================
   * 交互
   * ====================================================================*/

  function bind(el) {
    /* 视图根节点在应用生命周期内不变，只绑一次；所有子元素事件走委托，
       这样局部 innerHTML 重绘不会丢监听 */
    if (el.__ingBound) return;
    el.__ingBound = true;

    el.addEventListener('click', function (e) {
      var t = e.target;

      /* 模式切换：必须排在 [data-tab] 之前判断——两边都靠"按钮上的属性"识别，
         模式按钮没有 data-tab，但顺序还是写清楚，避免以后有人给模式键加 tab */
      var modeBtn = t.closest ? t.closest('[data-mode]') : null;
      if (modeBtn) {
        var next = modeBtn.getAttribute('data-mode');
        if (next && next !== state.mode) {
          state.mode = next;
          syncMode();
          syncChrome();
        }
        return;
      }

      /* Tab */
      var tab = t.closest ? t.closest('[data-tab]') : null;
      if (tab) {
        state.tab = tab.getAttribute('data-tab');
        state.cat = 'all';
        state.openId = '';
        state.q = '';
        /* 换页签等于换了一套导览：折叠状态与当前篇都要重置，否则会停在上一页的 key 上 */
        state.guideKey = '';
        state.guideOpen = false;
        /* 点页签的语义就是"我要看目录"，顺手切回目录模式 */
        state.mode = 'catalog';
        var qEl = document.getElementById('ing-q');
        if (qEl) qEl.value = '';
        var tabsBox = document.getElementById('ing-tabs');
        if (tabsBox) tabsBox.innerHTML = tabsHtml();
        paintCats();
        paintTable();
        syncChrome();
        syncMode();
        return;
      }

      /* 品类导览：折叠开关与篇目切换。都只重绘导览本身，不动表格，
         用户正展开的行不会被收起来 */
      var gToggle = t.closest ? t.closest('[data-guide-toggle]') : null;
      if (gToggle) {
        state.guideOpen = !state.guideOpen;
        paintGuide();
        return;
      }
      var gChip = t.closest ? t.closest('[data-guide]') : null;
      if (gChip) {
        state.guideKey = gChip.getAttribute('data-guide');
        state.guideOpen = true;
        paintGuide();
        return;
      }

      /* 分类筛选 */
      var chip = t.closest ? t.closest('[data-cat]') : null;
      if (chip) {
        state.cat = chip.getAttribute('data-cat');
        /* 筛到某一类就直接展开那一篇——这一屏的 51 条里，用户最需要先看的是"这一类怎么用"。
           酒花按香型分组，与苦花/香花正交，autoGuide 找不到唯一篇时就不猜。 */
        var auto = autoGuide();
        if (auto) {
          state.guideKey = auto.key;
          state.guideOpen = true;
        }
        paintCats();
        paintTable();
        return;
      }

      /* 添加到配方（行内或详情里） */
      var addBtn = t.closest ? t.closest('[data-add]') : null;
      if (addBtn) {
        e.stopPropagation();
        addToRecipe(addBtn.getAttribute('data-add'));
        return;
      }

      /* 自建原料 */
      var actBtn = t.closest ? t.closest('[data-act]') : null;
      if (actBtn && actBtn.getAttribute('data-act') === 'new-custom') {
        openCustomForm();
        return;
      }

      /* 展开 / 收起 */
      var row = t.closest ? t.closest('[data-expand]') : null;
      if (row) {
        var id = row.getAttribute('data-expand');
        state.openId = (state.openId === id) ? '' : id;
        paintTable();
      }
    });

    el.addEventListener('keydown', function (e) {
      var row = e.target.closest ? e.target.closest('[data-expand]') : null;
      if (!row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var id = row.getAttribute('data-expand');
        state.openId = (state.openId === id) ? '' : id;
        paintTable();
      }
    });

    var search = UI.debounce(function (v) {
      state.q = v;
      state.openId = '';
      paintTable();
    }, 140);

    el.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || t.id !== 'ing-q') return;
      search(t.value);
    });
  }

  function addToRecipe(id) {
    var kind = state.tab;
    /* 水盐不是投料，配方里由 water.salts 单独承载（入口在配方页水质面板）。
       这里兜一道：万一通过键盘或残留 DOM 触发了 data-add，别掉进辅料分支。 */
    if (kind === 'waterSalts') {
      UI.Shell.toast('水盐在「配方设计 → 水质」里添加', 'info');
      return;
    }
    var it = UI.byId(kind, id) || findCustom(kind, id);
    if (!it) { UI.Shell.toast('没找到这条原料记录', 'error'); return; }

    var r = UI.recipe();
    var Recipe = BREW.Recipe;

    if (kind === 'malts') {
      var kg = it.cat === 'base' ? 4 : (num(it.maxPct, 10) <= 8 ? 0.15 : 0.4);
      if (Recipe && Recipe.addFermentable) Recipe.addFermentable(r, it, kg);
      else r.fermentables.push({ id: id, amount: kg });
      UI.Shell.toast('已把「' + it.name + '」加入麦芽表（' + fmt(kg, 2) + ' kg）', 'ok');
    } else if (kind === 'hops') {
      var isAroma = String(it.type || '').toLowerCase() === 'aroma';
      var mins = isAroma ? 5 : 60;
      if (Recipe && Recipe.addHop) Recipe.addHop(r, it, 20, 'boil', mins);
      else r.hops.push({ id: id, amount: 20, stage: 'boil', time: mins });
      UI.Shell.toast('已加入酒花表（20 g / ' + mins + ' 分钟）', 'ok');
    } else if (kind === 'yeasts') {
      var grams = it.form === 'liquid' ? 100 : 11;
      if (Recipe && Recipe.addYeast) Recipe.addYeast(r, it, grams);
      else r.yeasts.push({ id: id, amount: grams, tempC: 19, att: num(it.att, 75) });
      UI.Shell.toast('已设为发酵菌株：' + it.name, 'ok');
    } else {
      if (Recipe && Recipe.addAdjunct) Recipe.addAdjunct(r, it);
      else r.adjuncts.push({ id: id, amount: num(it.useMin, 5), stage: it.stage || 'boil' });
      UI.Shell.toast('已加入辅料表', 'ok');
    }

    UI.setRecipe(r);
    UI.publish();
    paintTable();
  }

  function findCustom(kind, id) {
    var arr = UI.customList(kind);
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  /* ======================================================================
   * 自建原料表单
   * ====================================================================*/

  /* 必填项只留"没有它就算不出酒"的那几个。其余全部选填，按 PARAMS 的分组折叠。
     选填为空时**根本不写入 item**——详情页会显示「—」，而不是 0。 */
  var REQUIRED_HINT = {
    malts: '带 * 的两项必填：没有 ppg 就参与不了 OG 计算。其余全部可以留空。',
    hops: '带 * 的一项必填：没有 α 酸就参与不了 IBU 计算。其余全部可以留空。',
    yeasts: '带 * 的一项必填：没有衰减度就参与不了 FG 计算。其余全部可以留空。',
    adjuncts: '只有名称必填。用量区间建议填，填了才会触发"用量超了"的提醒。'
  };

  function openCustomForm() {
    var kind = state.tab;
    var fields = '';

    fields += fieldText('c-name', '名称', '', true, '例如：本地酒厂特种麦芽');
    fields += fieldText('c-en', '英文名 / 编号', '', false, '可留空');

    if (kind === 'malts') {
      fields += fieldText('c-ppg', 'ppg（比重点数）', '', true, '常见 34-37；无糖贡献的谷物（稻壳）填 0');
      fields += fieldText('c-lov', '色度 °Lovibond', '', false, '袋上若标 EBC，请先除以 1.97');
      fields += fieldSel('c-cat', '分类', [
        ['base', '基础麦芽'], ['kiln', '窑烤麦芽'], ['crystal', '结晶麦芽'],
        ['roast', '烘烤谷物'], ['grain', '未发芽谷物'], ['sugar', '糖与糖浆'],
        ['extract', '麦芽提取物']
      ], 'crystal', false);
      fields += '<label class="check" style="align-self:end;padding-bottom:6px">' +
        '<input type="checkbox" id="c-mash" checked> 需要参与糖化（不勾选则按 100% 效率计）</label>';
    } else if (kind === 'hops') {
      fields += fieldText('c-aa', 'α 酸 %', '', true, '以厂商 COA 为准，通常 3-18');
      fields += fieldSel('c-type', '用途', [
        ['bitter', '苦花'], ['aroma', '香花'], ['dual', '双用途']
      ], 'dual', false);
      fields += fieldText('c-origin', '产地', '', false, '例如：美国 华盛顿州');
    } else if (kind === 'yeasts') {
      fields += fieldText('c-att', '酵母标称衰减度 %', '', true, '厂商标称值，通常 70-80');
      fields += fieldSel('c-type', '类型', [
        ['ale', '艾尔'], ['lager', '拉格'], ['wheat', '小麦'],
        ['belgian', '比利时'], ['sour', '酸啤'], ['brett', '布雷特']
      ], 'ale', false);
      fields += fieldText('c-temp-min', '最低温 °C', '', false, '可留空');
      fields += fieldText('c-temp-max', '最高温 °C', '', false, '可留空');
    } else {
      fields += fieldSel('c-cat', '类别', [
        ['spice', '香料'], ['fruit', '水果'], ['clarifier', '澄清剂'], ['acid', '酸剂'],
        ['nutrient', '营养盐'], ['oak', '橡木'], ['enzyme', '酶'], ['other', '其他']
      ], 'other', false);
      fields += fieldText('c-use', '用途', '', false, '例如：煮沸 15 分钟投放，助澄清');
      fields += fieldText('c-use-min', '用量下限', '', false, '20L 批次，单位见下一格');
      fields += fieldText('c-use-max', '用量上限', '', false, '20L 批次');
      fields += fieldSel('c-unit', '单位', [['g', 'g'], ['ml', 'ml'], ['片', '片']], 'g', false);
      fields += fieldSel('c-stage', '投放阶段', [
        ['mash', '糖化'], ['boil', '煮沸'], ['whirlpool', '回旋'],
        ['primary', '主发酵'], ['secondary', '二发'], ['packaging', '装瓶前']
      ], 'boil', false);
    }

    /* basic 组（目前只有麦芽的色度 EBC）：有值才有意义，所以放在可见区 */
    var basics = [], defs = paramDefs(), i;
    for (i = 0; i < defs.length; i++) if (defs[i].grp === 'basic') basics.push(defs[i]);
    for (i = 0; i < basics.length; i++) fields += optField(basics[i]);

    fields += '<div class="field" style="grid-column:1/-1">' +
      '<label class="field__label" for="c-flavor">风味描述</label>' +
      '<input class="input" id="c-flavor" type="text" placeholder="可选，帮助你以后回忆"></div>';

    UI.Shell.modal({
      size: 'wide',
      title: '自建' + (kind === 'malts' ? '麦芽' : kind === 'hops' ? '酒花' : kind === 'yeasts' ? '酵母' : '辅料'),
      sub: '保存在本机浏览器',
      body: '<p class="u-xs u-dim" style="margin:0 0 10px">' + esc(REQUIRED_HINT[kind] || '') + '</p>' +
        '<div class="grid-2">' + fields + '</div>' +
        optGroup(kind, 'brew', '酿造性能') +
        optGroup(kind, 'keep', '储存与风味') +
        '<p class="u-xs u-dim mt-12">自建原料会被标记为"自建"，不参与 A/B/C 置信度评级；' +
        '如果你从 COA 拿到了准确参数，它就是可信的一手数据。留空的项在详情里显示「—」，不会被当成 0。</p>',
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '保存', kind: 'primary',
          act: function (api) {
            var name = val(api, '#c-name');
            if (!name) { UI.Shell.toast('名称不能为空', 'warn'); return false; }

            var item = {
              id: 'x-' + kind + '-' + Date.now().toString(36),
              name: name,
              en: optText(val(api, '#c-en')),
              conf: 'S', src: '用户自建', custom: true,
              flavor: optText(val(api, '#c-flavor'))
            };

            if (kind === 'malts') {
              var ppg = optNum(val(api, '#c-ppg'));
              if (ppg === undefined) {
                UI.Shell.toast('ppg 必填；无糖贡献的谷物（稻壳）请填 0', 'warn');
                return false;
              }
              item.ppg = ppg;
              item.cat = val(api, '#c-cat') || 'base';
              item.mustMash = api.query('#c-mash') ? api.query('#c-mash').checked : true;
              item.origin = '自建';
              item.lov = optNum(val(api, '#c-lov'));   /* 没填就不写这个键 */
            } else if (kind === 'hops') {
              var aa = optNum(val(api, '#c-aa'));
              if (aa === undefined) { UI.Shell.toast('α 酸必填（以厂商 COA 为准）', 'warn'); return false; }
              item.aa = aa;
              item.type = val(api, '#c-type') || 'dual';
              item.origin = val(api, '#c-origin') || '自建';
            } else if (kind === 'yeasts') {
              var att = optNum(val(api, '#c-att'));
              if (att === undefined) { UI.Shell.toast('酵母标称衰减度必填（厂商数据表上有）', 'warn'); return false; }
              item.att = att;
              item.type = val(api, '#c-type') || 'ale';
              item.form = 'dry';
              var tmin = optNum(val(api, '#c-temp-min'));
              var tmax = optNum(val(api, '#c-temp-max'));
              if (tmin !== undefined) item.tempMin = tmin;
              if (tmax !== undefined) item.tempMax = tmax;
              if (tmin !== undefined && tmax !== undefined) {
                item.tempRange = fmt(tmin, 0) + '–' + fmt(tmax, 0) + ' °C';
              }
            } else {
              item.cat = val(api, '#c-cat') || '其他';
              item.use = optText(val(api, '#c-use'));
              item.unit = val(api, '#c-unit') || 'g';
              item.stage = val(api, '#c-stage') || 'boil';
              var umin = optNum(val(api, '#c-use-min'));
              var umax = optNum(val(api, '#c-use-max'));
              if (umax !== undefined) {
                item.useMax = umax;
                item.useMin = umin === undefined ? 0 : umin;
              }
            }

            /* 选填参数：一个循环收口，避免 20 个 if。
               空串直接跳过 —— key 不存在，界面就是「—」。 */
            for (var d = 0; d < defs.length; d++) {
              var p = defs[d];
              var raw = val(api, '#c-p-' + p.key);
              if (!raw) continue;
              if (p.opts || p.text) { item[p.key] = raw; continue; }
              var nv = optNum(raw);
              if (nv !== undefined) item[p.key] = nv;
            }

            /* ppg 填 0 不阻断（稻壳、壳类确实无糖贡献），但提醒一句 */
            if (kind === 'malts' && item.ppg === 0) {
              UI.Shell.toast('ppg 为 0：这款原料不会贡献糖度', 'warn');
            }

            /* 收尾：删掉值为 undefined 的键。
               赋值 item.lov = undefined 会**建出这个键**（JSON 里看不见、in 却有），
               后面的判空与"有没有填"就会走岔。删干净才是"没填就是没填"。 */
            for (var kk in item) {
              if (Object.prototype.hasOwnProperty.call(item, kk) && item[kk] === undefined) delete item[kk];
            }

            UI.saveCustom(kind, item);
            paintCats();
            paintTable();
            UI.Shell.toast('已保存自建原料：' + name, 'ok');
          }
        }
      ]
    });
  }

  /** 一个折叠的选填组：默认收起，摘要写清有几项、都是选填 */
  function optGroup(kind, grp, title) {
    var defs = PARAMS[kind] || [], list = [], i;
    for (i = 0; i < defs.length; i++) if (defs[i].grp === grp) list.push(defs[i]);
    if (!list.length) return '';
    var body = '';
    for (i = 0; i < list.length; i++) body += optField(list[i]);
    return '<details class="style-dossier" style="margin-top:10px">' +
      '<summary>' + esc(title) + ' · 选填 ' + list.length + ' 项（可以全部留空）</summary>' +
      '<div class="style-dossier__body"><div class="grid-2">' + body + '</div></div></details>';
  }

  function optField(p) {
    var id = 'c-p-' + p.key;
    var label = p.zh + (p.unit ? '（' + p.unit + '）' : '');
    if (p.opts) {
      var opts = [['', '（未填）']].concat(p.opts);
      return fieldSel(id, label, opts, '', false);
    }
    return fieldText(id, label, '', false, p.why);
  }

  function fieldText(id, label, value, required, hint) {
    return '<div class="field">' +
      '<label class="field__label" for="' + id + '">' + esc(label) +
      (required ? ' <span class="req">*</span>' : '') + '</label>' +
      '<input class="input" id="' + id + '" type="text" value="' + attr(value) + '"' +
      (hint ? ' placeholder="' + attr(hint) + '"' : '') + '>' +
      '</div>';
  }

  function fieldSel(id, label, opts, cur, required) {
    var h = '<div class="field"><label class="field__label" for="' + id + '">' + esc(label) +
      (required ? ' <span class="req">*</span>' : '') + '</label>' +
      '<select class="select" id="' + id + '">';
    for (var i = 0; i < opts.length; i++) {
      h += '<option value="' + attr(opts[i][0]) + '"' +
        (opts[i][0] === cur ? ' selected' : '') + '>' + esc(opts[i][1]) + '</option>';
    }
    return h + '</select></div>';
  }

  /** 选填数值：空串返回 undefined。**不要用 num(v, 0)** —— 那把"没填"变成 0 */
  function optNum(s) {
    var t = String(s === null || s === undefined ? '' : s).trim();
    if (!t) return undefined;
    var n = parseFloat(t);
    return isFinite(n) ? n : undefined;
  }

  function optText(s) {
    var t = String(s === null || s === undefined ? '' : s).trim();
    return t ? t : undefined;
  }

  function val(api, sel) {
    var el = api.query(sel);
    return el ? String(el.value).trim() : '';
  }

  /* ======================================================================
   * 视图定义
   * ====================================================================*/

  BREW.UI.IngredientView = {
    id: 'ingredient',
    label: '原料库',
    icon: 'sack',
    group: '酿造',
    order: 2,
    render: function (el) { render(el); },
    onEnter: function () {
      paintTable();
      /* 回到本视图时如果停在库存/采购：余额可能已被配方页的改动带偏，重挂一次。
         目录模式什么都不做，避免把用户正在看的展开行冲掉。 */
      if (state.mode !== 'catalog') syncMode();
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
