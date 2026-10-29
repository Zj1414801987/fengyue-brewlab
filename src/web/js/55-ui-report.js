/* ============================================================================
 * 风月酿研所 — 55-ui-report.js
 * ----------------------------------------------------------------------------
 * 职责：配方卡视图。
 *   · 屏幕上一张"纸感"配方卡（浅底深字，与深色 UI 形成对比）
 *   · 导出 PNG：用 Canvas 逐行绘制同一份内容，2 倍像素密度
 *   · 打印：走 @media print，隐藏导航与按钮，白底黑字 A4 友好
 *
 * 依赖：BREW.UI（esc/num/fmt/calc/recipe/plato/hexFromSrm）
 * 说明：PNG 用 Canvas 手绘而不截屏，是为了让导出图在任何缩放下都清晰，
 *       且不依赖 html2canvas 这类外部库（file:// 下无法引入）。
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  var lastCalc = null;
  var lastRecipe = null;

  var INK = '#241f18';
  var MUTED = '#7a5c3a';
  var RULE = '#e3d9c6';
  var PAPER = '#fffdf8';

  /* 页脚版本号的唯一来源。
     这里以前硬编码 'v1.0'，而顶栏徽章写 'v1.2'、设置页写 'v1.2 界面包'——
     同一版软件在三个地方报三个版本号，用户拿着导出的 PDF 来问"我这是哪版"
     根本没法答。现在统一读 Config.VERSION_LABEL（00-core 里定义）。
     取不到就写 'v?'，不回落成任何具体数字：猜一个版本号比不写更糟。 */
  function appVer() {
    var cfg = BREW.Config || {};
    return cfg.VERSION_LABEL || ('v' + (cfg.VERSION || '?'));
  }

  /* ======================================================================
   * 渲染
   * ====================================================================*/

  /* v1.2：配方卡多了「酒标」页签。
     为什么放在这里而不是单开一个视图：酒标是"这份配方的另一张纸"，
     与配方卡同一个心智位置；而且它要读配方算出来的 SRM 做底色。
     页签是**新增的**，默认仍停在「配方卡」——老用户的路径一模一样。

     页签要记在 settings 里而不是只放模块变量：酒标编辑是"反复调参数"的活，
     调一半刷新一下就被弹回配方卡，用户还得重新展开——这就是要记忆的全部理由。
     （键不在 58 的 SCHEMA 里，所以不参与「恢复默认」，与 settings.analysisTab 同一个取舍） */
  var RT_TAB_KEY = 'settings.reportTab';

  function readReportTab() {
    var v = '';
    try { v = UI.store.get(RT_TAB_KEY, 'card'); } catch (e) { v = 'card'; }
    /* v1.4 加了第三个页签「酿造单」。旧存档里只可能是 card/label，
       不认识的取值一律落回 card —— 别让一个脏值把用户永远留在空白页签上。 */
    if (v === 'label' || v === 'sheet') return v;
    return 'card';
  }

  function persistTab() {
    try { UI.store.set(RT_TAB_KEY, rtState.tab); } catch (err) { /* 记不住页签不影响使用 */ }
  }

  var rtState = { tab: readReportTab() };

  /* 打印规则的注入点：判定依据是"打印出来的是成品，不是当前屏幕"——
     停在「酒标」页签按 Ctrl+P，纸上该只有那张酒标，不该带一屏参数控件。
     规则写在 JS 里而不是 style.css：style.css 是共享文件，这条只服务于
     本视图的打印分支，跟着本视图走更不容易被后来的改动冲掉。 */
  var PRINT_CSS_ID = 'rt-print-css';

  function ensurePrintCss() {
    if (document.getElementById(PRINT_CSS_ID)) return;
    var st = document.createElement('style');
    st.id = PRINT_CSS_ID;
    st.textContent =
      '@media print{' +
      '[data-print="label"] .lbl-layout{display:block!important}' +
      '[data-print="label"] .lbl-controls{display:none!important}' +
      '[data-print="label"] .lbl-preview{border:0!important;background:#fff!important;box-shadow:none!important}' +
      '[data-print="label"] .lbl-preview .card__head{display:none!important}' +
      '[data-print="label"] .lbl-preview .card__body{padding:0!important;background:#fff!important}' +
      '[data-print="label"] .lbl-stage{background:#fff!important}' +
      '}';
    document.head.appendChild(st);
  }

  /* ======================================================================
   * 酿造单（v1.4）的样式
   * ----------------------------------------------------------------------
   * 为什么也注入 <style> 而不是写进 css/style.css：
   *   1. style.css 是共享文件（本轮还有人在改），这里的规则只服务于"这张纸"；
   *   2. 酿造单要求**一页 A4 装下**，它的字号/行距是按 mm 抠出来的，
   *      跟随时调整的 UI 主题尺寸混在一个文件里，下次有人调 --fs 就会把它顶到第二页。
   *   3. 与 60-70 行那段打印规则同一个先例：打印分支跟着视图走。
   *
   * 单位全部用 mm/pt：屏幕上一律按 210mm 纸宽排版，打印时靠 @media print
   * 把外边距从"纸的内边距"改成"@page 的页边距"，两种媒体下内容宽度都是 186mm，
   * 所以屏幕看到的换行位置 = 打印出来的换行位置（这点决定了本单能不能只占一页）。
   * ====================================================================*/
  var SHEET_CSS_ID = 'bs-sheet-css';

  var SHEET_CSS = [
    /* ---------------- 屏幕：一张 A4 纸（比打印宽是允许的） ---------------- */
    /* 窗口比 A4（210mm ≈ 794px）窄时，宁可横向滚动也不要把纸裁掉：
       .view 自己 overflow-x:hidden，纸在里面是滚不动的。 */
    '.bs-wrap{padding:2px 0 22px;overflow-x:auto}',
    '.bs-paper{box-sizing:border-box;width:210mm;min-height:297mm;padding:12mm;margin:0 auto;',
    'background:#fffdf8;color:#1c1a16;border:1px solid #ded3bd;border-radius:6px;',
    'box-shadow:0 16px 40px rgba(0,0,0,.45);',
    'font-family:"Times New Roman",Times,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}',
    '.bs-paper *{box-sizing:border-box}',
    '.bs-sheet{width:186mm;margin:0 auto;font-size:8.6pt;line-height:1.32;--bs-row:5.4mm}',
    /* 原料/步骤特别多时压一档行距（阈值见 sheetIsTight），保证仍然是一页 */
    '.bs-sheet.is-tight{font-size:7.8pt;--bs-row:4.3mm}',

    /* ---------------- 抬头 ---------------- */
    '.bs-head{display:flex;align-items:flex-end;justify-content:space-between;gap:8mm;',
    'border-bottom:1.4pt solid #1c1a16;padding-bottom:2.2mm}',
    '.bs-head__main{min-width:0}',
    '.bs-name{font-size:15.5pt;font-weight:700;line-height:1.16;letter-spacing:-.2px;margin:0;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.bs-sub{font-size:8pt;color:#57462f;margin-top:1.1mm}',
    /* 右侧 6mm 安全边：与表格/收尾的手写线对齐（见 .bs-tbl 的说明）。
       纸上的规矩是"线可以画到裁切边，字和手写线不许"。 */
    '.bs-fields{flex:none;text-align:right;font-size:8pt;line-height:2.15;white-space:nowrap;',
    'padding-right:6mm}',
    '.bs-fields i{font-style:normal;color:#57462f;margin-right:1.2mm}',

    /* 空白填写线：空 <span> + border-bottom。
       不用连续下划线字符（打印机会按字距断成虚线），也不用 <input>
       （file:// 下的打印渲染会把空 input 画成灰底框）。 */
    '.bs-blank{display:inline-block;height:3.4mm;border-bottom:1px solid #333;vertical-align:baseline}',

    /* ---------------- 段标题 ---------------- */
    '.bs-sec{margin-top:2.9mm}',
    '.bs-h{display:flex;align-items:baseline;gap:2mm;margin:0 0 1.1mm;padding-bottom:.9mm;',
    'border-bottom:.9pt solid #1c1a16;font-size:7.6pt;font-weight:700;letter-spacing:.14em;',
    'text-transform:uppercase;color:#3a2d1c}',
    '.bs-h em{font-style:normal;font-weight:400;letter-spacing:0;text-transform:none;',
    'font-size:7.4pt;color:#6b5a42}',

    /* ---------------- 表 ---------------- */
    '.bs-tbl{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.4pt}',
    /* 表头不做 uppercase：这一排表头里混着单位（计划 kg / 实投 g），
       大写成 KG / G 既不是单位写法也不好看。 */
    '.bs-tbl th{text-align:left;font-size:7pt;font-weight:600;letter-spacing:.06em;',
    'color:#5c4a32;padding:.5mm 1.2mm;border-bottom:.9pt solid #8a7554;',
    'white-space:nowrap}',
    '.bs-tbl td{padding:0 1.2mm;height:var(--bs-row);border-bottom:.6pt solid #cfc2a8;',
    'vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bs-tbl tr.is-sum td{border-bottom:1.2pt solid #8a7554;font-weight:700}',
    '.bs-num{text-align:right;font-family:"SF Mono",Consolas,monospace;font-size:8pt;',
    'font-variant-numeric:tabular-nums}',
    /* 手写格：细线贴格底，行高留出手指的余量 */
    '.bs-tbl td.bs-fill{padding:0 1.2mm 1.1mm;vertical-align:bottom}',
    '.bs-tbl td.bs-fill .bs-blank{display:block;height:3.2mm}',
    /* 最右一列的手写线收到离纸边 6mm：原来那条线一直画到 186mm，
       等于压在裁切线上——打印机最外侧 3–5mm 打不到，线会被切半。
       整张单子（表格 / 水 / 收尾）都守这 6mm，右留白才是一条直线。 */
    '.bs-tbl th:last-child,.bs-tbl td.bs-fill:last-child{padding-right:6mm}',
    '.bs-tbl .bs-tag{display:inline-block;padding:0 1mm;margin-right:1.2mm;border:.6pt solid #8a7554;',
    'border-radius:1px;font-size:6.6pt;letter-spacing:.06em;color:#5c4a32}',

    /* ---------------- 水 ---------------- */
    /* 四格之间加一道细竖线：不加的话"糖化水的空线 + L"与"洗糟水的空线"
       在纸上是连成一条的，手写时会填到隔壁格子里去。 */
    '.bs-water{display:grid;grid-template-columns:repeat(4,1fr);gap:0}',
    '.bs-wf{padding:.2mm 3.2mm .6mm}',
    '.bs-wf + .bs-wf{border-left:.5pt solid #cfc2a8}',
    '.bs-wf:first-child{padding-left:0}',
    /* 与表格同样的 6mm 右侧安全边（见 .bs-tbl 那边的说明） */
    '.bs-wf:last-child{padding-right:6mm}',
    '.bs-wk{display:block;font-size:7.3pt;color:#5c4a32;white-space:nowrap;overflow:hidden}',
    '.bs-wk b{font-weight:700;color:#1c1a16;font-family:"SF Mono",Consolas,monospace;font-size:7.6pt}',
    '.bs-wv{display:flex;align-items:flex-end;gap:1mm;margin-top:1mm}',
    '.bs-wv .bs-blank{flex:1 1 auto;display:block;height:4.2mm}',
    '.bs-wv em{font-style:normal;font-size:7.4pt;color:#57462f;flex:none}',

    /* ---------------- 收尾四行 ---------------- */
    '.bs-close{width:100%;border-collapse:collapse}',
    '.bs-close td{padding:1.5mm 0 0;vertical-align:bottom}',
    '.bs-close .bs-cl{width:58mm;padding-right:3mm;font-size:8pt;font-weight:600;white-space:nowrap}',
    '.bs-close .bs-cl i{font-style:normal;font-weight:400;color:#6b5a42;margin-left:1.5mm;font-size:7.4pt}',
    '.bs-close td.bs-fill{padding-right:6mm}',
    '.bs-close td.bs-fill .bs-blank{display:block;height:5mm}',
    '.bs-close tr.is-tall td{padding-top:1mm}',
    '.bs-close tr.is-tall td.bs-fill .bs-blank{height:9mm}',

    /* ---------------- 页脚 ----------------
       左右两句都允许收缩与折行：只写 space-between 的话，右句会顶到纸边被裁掉
       （实测只印到"实际以现场为"）。flex-wrap 是兜底——真放不下时右句整体换行，
       而不是把字切在纸边外面。 */
    '.bs-foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;',
    'gap:1mm 5mm;margin-top:3.2mm;padding-top:1.6mm;border-top:.7pt solid #1c1a16;',
    'font-size:7pt;color:#5c4a32}',
    '.bs-foot span{flex:0 1 auto;min-width:0}',
    '.bs-foot span + span{text-align:right;max-width:58%;padding-right:6mm}',

    /* ================= 打印：收成 A4 一页 =================
       @page 写在这里而不是 style.css：页边距 12mm 是"酿造单按 mm 排完还剩多少"
       倒推出来的，跟着这张纸走。它同时作用于配方卡打印（14mm → 12mm），
       可打印区只会变大不会变小，不会把卡片顶到第二页。 */
    '@media print{',
    '@page{size:A4;margin:12mm}',
    /* 纸面在屏幕上带内边距和投影，打印时全部交还给 @page */
    'body[data-print="sheet"] .bs-paper{width:186mm;min-height:0;padding:0;margin:0;',
    'border:0;border-radius:0;box-shadow:none;background:#fff;color:#000}',
    'body[data-print="sheet"] .bs-wrap{padding:0;overflow:visible}',
    'body[data-print="sheet"] .bs-tbl td{border-bottom-color:#b9ab8e}',
    /* 打印时视图容器不许留内边距/滚动区，否则 186mm 会被挤成两次换行 */
    'body[data-print="sheet"] #view{padding:0!important;overflow:visible!important}',
    'body[data-print="sheet"] .bs-sheet{width:186mm}',
    '}'
  ].join('');

  function ensureSheetCss() {
    if (document.getElementById(SHEET_CSS_ID)) return;
    var st = document.createElement('style');
    st.id = SHEET_CSS_ID;
    st.textContent = SHEET_CSS;
    document.head.appendChild(st);
  }

  /* 打印开关：纸上出来的是"当前这个页签的成品"。
     酒标沿用 #rt-body[data-print="label"] 的老写法（v1.2，别动），
     卡片/酿造单记在 <body> 上 —— 酿造单要覆盖的是整个页面的版式，
     挂在 #rt-body 上管不到 @page 与 #view 的留白。 */
  function syncPrintFlag(tab) {
    try {
      document.body.setAttribute('data-print',
        tab === 'label' ? 'label' : (tab === 'sheet' ? 'sheet' : 'card'));
    } catch (e) { /* 没有 body（node 侧）就跳过 */ }
  }

  function clearPrintFlag() {
    try { document.body.removeAttribute('data-print'); } catch (e) { /* ignore */ }
  }

  function render(el) {
    var r = UI.recipe();
    var c = UI.calc(r);
    lastCalc = c;
    lastRecipe = r;

    /* 空配方：导出会得到一张"OG 1.000 / 未添加麦芽"的废卡片（④）。
       原因必须**常驻可见**——按钮 disabled 后很多浏览器不再触发 hover，
       只在 title 里写等于没写。 */
    var isEmpty = !((r.fermentables || []).length);
    ensurePrintCss();
    ensureSheetCss();
    syncPrintFlag(rtState.tab);

    el.innerHTML =
      '<div class="section-title no-print">' +
        '<h2>' + (rtState.tab === 'sheet' ? '酿造单' : '配方卡') + '</h2>' +
        '<p>' + (rtState.tab === 'sheet'
          ? '酿造当天带在手上的那张纸：计划值印好，实测值手写'
          : '给酿酒搭子看的版本：一页纸说清怎么复现这锅酒') + '</p>' +
        '<span class="spacer"></span>' +
        (rtState.tab === 'card'
          ? ((isEmpty ? '<span class="u-xs" style="color:var(--warn);margin-right:10px">' +
                '没有原料，导出的卡片会是空的</span>' : '') +
             '<button type="button" class="btn btn-ghost btn-sm" data-act="png"' +
             (isEmpty ? ' disabled aria-disabled="true" title="没有原料，导出的卡片会是空的"' : '') + '>' +
             icon('down', 13) + '导出 PNG</button>' +
             '<button type="button" class="btn btn-primary btn-sm" data-act="print">' + icon('printer', 13) + '打印</button>')
          : '') +
        (rtState.tab === 'sheet'
          ? '<button type="button" class="btn btn-primary btn-sm" data-act="print-sheet">' +
            icon('printer', 13) + '打印 A4 酿造单</button>'
          : '') +
        /* 「酿造单」入口：v1.4 的「交付」功能区会按 data-act="brew-sheet" 进来。
           停在酿造单页签时这颗按钮就多余了（下面那颗页签本身就是入口），
           所以只在别的页签上出现——而 data-act 也挂在页签上（见下），
           保证**任何时刻** querySelector('[data-act="brew-sheet"]') 都找得到，
           否则 whenReady 会等满 45 拍再弹一句"没有打开"。 */
        (rtState.tab === 'sheet' ? ''
          : '<button type="button" class="btn btn-ghost btn-sm" data-act="brew-sheet">' +
            icon('report', 13) + '酿造单</button>') +
      '</div>' +
      '<div class="tabs no-print" id="rt-tabs" role="tablist">' +
        '<button type="button" class="tab' + (rtState.tab === 'card' ? ' is-on' : '') + '" ' +
          'role="tab" aria-selected="' + (rtState.tab === 'card') + '" data-rtab="card">配方卡</button>' +
        '<button type="button" class="tab' + (rtState.tab === 'label' ? ' is-on' : '') + '" ' +
          'role="tab" aria-selected="' + (rtState.tab === 'label') + '" data-rtab="label">酒标</button>' +
        '<button type="button" class="tab' + (rtState.tab === 'sheet' ? ' is-on' : '') + '" ' +
          'role="tab" aria-selected="' + (rtState.tab === 'sheet') + '" ' +
          'data-rtab="sheet" data-act="brew-sheet">酿造单</button>' +
      '</div>' +
      '<div id="rt-body"' + (rtState.tab === 'label' ? ' data-print="label"' : '') + '>' +
        (rtState.tab === 'label' ? '<div id="rt-label"></div>'
          : (rtState.tab === 'sheet' ? brewSheetHtml(r, c) : sheetHtml(r, c))) +
      '</div>';


    if (rtState.tab === 'label') mountLabel(el, r, c);

    if (!el.__reportBound) {
      el.__reportBound = true;
      el.addEventListener('click', function (e) {
        var tabBtn = e.target.closest ? e.target.closest('[data-rtab]') : null;
        if (tabBtn) {
          rtState.tab = tabBtn.getAttribute('data-rtab');
          persistTab();
          render(el);
          return;
        }
        var btn = e.target.closest ? e.target.closest('[data-act]') : null;
        if (!btn) return;
        var act = btn.getAttribute('data-act');
        if (act === 'png') exportPng();
        else if (act === 'print') doPrint();
        else if (act === 'print-sheet') doPrintSheet();
        else if (act === 'brew-sheet') {
          /* 动作名 brew-sheet 由 v1.4 的「交付」功能区复用：
             它只负责"把酿造单拿给你看"，打印是纸上那颗按钮的事。 */
          if (rtState.tab !== 'sheet') {
            rtState.tab = 'sheet';
            persistTab();
            render(el);
          } else {
            el.scrollTop = 0;
          }
        }
      });
    }
  }

  /** 酒标面板由 49 提供；模块缺失时给一句话，不留白 */
  function mountLabel(el, r, c) {
    var box = el.querySelector('#rt-label');
    if (!box) return;
    if (!UI.LabelPanel || typeof UI.LabelPanel.mount !== 'function') {
      box.innerHTML = '<div class="card"><div class="card__body">' +
        UI.emptyState('酒标模块未载入',
          'js/49-ui-label.js 没有成功执行，酒标设计器暂时不可用。', { art: 'beer' }) +
        '</div></div>';
      return;
    }
    try {
      UI.LabelPanel.mount(box, { recipe: r, calc: c });
    } catch (e) {
      box.innerHTML = '<div class="card"><div class="card__body">' +
        '<div class="alert alert--error"><span class="alert__icon">' + icon('alert', 13) + '</span>' +
        '<span>酒标渲染失败：' + esc(String((e && e.message) || '未知错误')) + '</span></div>' +
        '</div></div>';
    }
  }

  /* ---------------------------------------------------------------------
   * 源水：填了才有数字（v1.4）
   * ---------------------------------------------------------------------
   * 20-calc 把缺失的离子当 0 参与计算，于是"没填"和"填了 0"在数字上完全一样、
   * 含义完全相反：填 0 是纯 RO 水，没填是**不知道**。纸上把"不知道"印成 0，
   * 收到卡片的人会照着这个水去算盐、去糖化。
   *
   * 所以卡上逐项判：算出来是 0 而源水里也没有非零项 → 印「—」。
   * 六项全没填的整行处理见下面的 waterUnset()，这里只管单格。
   * -------------------------------------------------------------------*/
  var WATER_ION_KEYS = ['ca', 'mg', 'na', 'cl', 'so4', 'hco3'];

  /* ⚠️ 为什么判断逻辑在显示层而不在 20-calc：`Recipe.blank()` 把 water.source
     归一成 {ca:0, mg:0, na:0, cl:0, so4:0, hco3:0} —— 六个键**永远都在**，
     于是"有没有 hasOwnProperty"这个判据恒为真，那条分支实测从未触发过
     （2026-10-26 实测：删掉 source 后仍印出 Ca 0 / … / pH 5.3）。
     显示层只剩按"值"判这一条路：六项全 0 = 没数据。
     代价：用户手填六个 0 表示纯 RO 水时，也会显示成"未设置"——
     这两件事在模型层没有区别，除非 `Recipe.blank()` 改回 `source:{}`
     或加一个 sourceEdited 标记（那是 30 号文件的事，不是显示层能补的）。 */
  function waterUnset(w) {
    w = w || {};
    for (var i = 0; i < WATER_ION_KEYS.length; i++) {
      if (Math.abs(num(w[WATER_ION_KEYS[i]], 0)) >= 0.05) return false;
    }
    return true;
  }

  /** 单项离子：0 在纸上是"不知道"而不是"确定不含"，印 — */
  function ionText(v) {
    return Math.abs(num(v, 0)) < 0.05 ? '—' : fmt(num(v, 0), 0);
  }

  /** SO₄:Cl：Cl 为 0 时比值没有意义（20-calc 会兜成 99 或 0），印 — */
  function ratioText(w) {
    return num(w && w.cl, 0) > 0 ? fmt(w.so4clRatio, 2) : '—';
  }

  /** 糖化 pH 估算：缺任意一项离子，RA 就是错的，pH 也就不该印 */
  function phText(w) {
    if (waterUnset(w)) return '—';
    for (var i = 0; i < WATER_ION_KEYS.length; i++) {
      if (Math.abs(num(w[WATER_ION_KEYS[i]], 0)) < 0.05) return '—';
    }
    return fmt(w.mashPhEstimate, 2);
  }

  function sheetHtml(r, c) {
    var styleName = '未指定风格';
    var style = null;
    if (r.styleId) {
      style = UI.byId('styles', r.styleId);
      if (style) styleName = (style.code ? style.code + ' · ' : '') + (style.name || r.styleId);
    }

    var metrics = [
      ['OG', UI.sg(c.og), '°P ' + fmt(c.ogPlato, 1)],
      ['FG', UI.sg(c.fg), '°P ' + fmt(c.fgPlato, 1)],
      ['ABV', fmt(c.abv, 1) + '%', '衰减 ' + fmt(c.attenuation, 0) + '%'],
      ['IBU', fmt(c.ibu, 0), 'Tinseth'],
      ['SRM', fmt(c.srm, 1), fmt(c.ebc, 0) + ' EBC'],
      ['BU:GU', fmt(c.buGu, 2), c.balance || '']
    ];

    var mHtml = '';
    for (var i = 0; i < metrics.length; i++) {
      mHtml += '<div class="report-metric"><span>' + esc(metrics[i][0]) + '</span>' +
        '<b>' + esc(metrics[i][1]) + '</b>' +
        '<span style="letter-spacing:0;text-transform:none">' + esc(metrics[i][2]) + '</span></div>';
    }

    /* 麦芽表 */
    var maltRows = '';
    var totalKg = 0;
    for (var m = 0; m < r.fermentables.length; m++) totalKg += num(r.fermentables[m].amount, 0);
    for (var j = 0; j < r.fermentables.length; j++) {
      var mr = r.fermentables[j];
      var kg = num(mr.amount, 0);
      var lov = isFinite(mr.lov) ? mr.lov : 0;
      maltRows += '<tr><td>' + esc(mr.name) + '</td>' +
        '<td class="num">' + fmt(kg, 2) + '</td>' +
        '<td class="num">' + fmt(totalKg > 0 ? kg / totalKg * 100 : 0, 1) + '%</td>' +
        '<td class="num">' + fmt(lov, 0) + '</td></tr>';
    }
    if (!maltRows) maltRows = '<tr><td colspan="4" style="color:' + MUTED + '">未添加麦芽</td></tr>';

    /* 酒花表 */
    var hopRows = '';
    for (var h = 0; h < r.hops.length; h++) {
      var hr = r.hops[h];
      var aa = num(hr.aa, 0);
      hopRows += '<tr><td>' + esc(hr.name) + '</td>' +
        '<td class="num">' + fmt(hr.amount, 0) + ' g</td>' +
        '<td class="num">' + esc(UI.stageLabel(hr.stage)) + '</td>' +
        '<td class="num">' + fmt(hr.time, 0) + '</td>' +
        '<td class="num">' + fmt(aa, 1) + '%</td></tr>';
    }
    if (!hopRows) hopRows = '<tr><td colspan="5" style="color:' + MUTED + '">未添加酒花</td></tr>';

    /* 步骤 */
    var steps = '';
    var mashSteps = (r.mash && r.mash.steps) || [];
    if (mashSteps.length) {
      var seq = [];
      for (var s = 0; s < mashSteps.length; s++) {
        seq.push(fmt(mashSteps[s].tempC, 0) + '°C × ' + fmt(mashSteps[s].minutes, 0) + ' min');
      }
      steps += '<li><b>糖化</b><span>' + esc(seq.join('  →  ')) + '</span></li>';
    } else {
      steps += '<li><b>糖化</b><span>单步 67°C × 60 min</span></li>';
    }
    steps += '<li><b>水料比</b><span>' + esc(fmt(totalKg > 0 ? c.mashWater / totalKg : 0, 1)) +
      ' L/kg（糖化水 ' + esc(fmt(c.mashWater, 1)) + ' L / 洗糟 ' + esc(fmt(c.spargeWater, 1)) + ' L）</span></li>';
    steps += '<li><b>煮沸</b><span>' + esc(fmt(r.boilTime, 0)) + ' min，蒸发率 ' +
      esc(fmt(num(r.evaporationRate, 10), 0)) + '%/h，煮沸前 ' + esc(fmt(c.preBoilVolume, 1)) + ' L → 入罐 ' +
      esc(fmt(c.postBoilVolume, 1)) + ' L</span></li>';

    var y = r.yeasts && r.yeasts[0];
    if (y) {
      var atten = num(y.att, 75);
      steps += '<li><b>发酵</b><span>' + esc(y.name || '未指定菌株') + ' · ' +
        esc(fmt(y.amount, 1)) + ' ' + esc(y.unit || '包') + ' · ' +
        esc(fmt(y.tempC, 0)) + '°C · 预期衰减 ' + esc(fmt(atten, 0)) + '%</span></li>';
    }
    steps += '<li><b>碳化</b><span>目标 ' + esc(fmt(num(r.carbonation.targetVol, 2.4), 1)) + ' vol，' +
      '蔗糖约 ' + esc(fmt(c.carbonation ? c.carbonation.sugarGrams.sucrose : 0, 0)) + ' g（整批）</span></li>';

    /* 辅料 */
    var adjLine = '';
    if (r.adjuncts.length) {
      var arr = [];
      for (var a = 0; a < r.adjuncts.length; a++) {
        var ar = r.adjuncts[a];
        arr.push((ar.name || '未知') + ' ' + fmt(ar.amount, 0) + ' ' + (ar.unit || 'g') + '（' + UI.stageLabel(ar.stage) + '）');
      }
      adjLine = '<li><b>辅料</b><span>' + esc(arr.join('；')) + '</span></li>';
    }

    /* 水质：填了才有数字，没填就是"不知道"。
       0 是"确定不含"（纯 RO 水），不是"没填"—— 这两种在数字上一样、含义相反。
       20-calc 不做这个判断（原因见上面 waterUnset 的注释），只给 saltCount，
       用它区分"连盐都没加"和"没填源水但加了盐"这两种不同的空。
       旧版无条件印 "Ca 0 / Mg 0 / … / 糖化 pH 估算 5.3" —— 六个 0 看着像"极软水"，
       而 5.3 是 RA=0 时公式的静默默认值。配方卡是要发给别人照着做的纸，
       印上去的每个数字都会被当成输入。没输入就没有输出，宁可说实话。 */
    var w = c.water || {};
    var waterLine;
    if (waterUnset(w)) {
      waterLine = w.saltCount
        ? '源水未设置　·　离子只含添加盐，pH 不可估算'
        : '源水未设置　·　填入后才有离子与 pH 估算';
    } else {
      waterLine = 'Ca ' + ionText(w.ca) + ' / Mg ' + ionText(w.mg) +
        ' / Na ' + ionText(w.na) + ' / Cl ' + ionText(w.cl) +
        ' / SO₄ ' + ionText(w.so4) + ' / HCO₃ ' + ionText(w.hco3) +
        ' ppm　·　SO₄:Cl ' + ratioText(w) + '　·　糖化 pH 估算 ' + phText(w);
    }

    var styleDev = '';
    if (c.styleMatch && c.styleMatch.deviations && c.styleMatch.deviations.length) {
      var okCount = 0;
      for (var d = 0; d < c.styleMatch.deviations.length; d++) {
        if (c.styleMatch.deviations[d].verdict === 'ok') okCount++;
      }
      styleDev = '风格匹配 ' + fmt(c.styleMatch.score, 0) + '%（' + okCount + '/' +
        c.styleMatch.deviations.length + ' 项落在区间内）';
    }

    return '<div class="report-sheet" id="report-sheet">' +
      '<div class="report-head">' +
        '<div>' +
          '<h2>' + esc(r.name || '未命名配方') + '</h2>' +
          '<div class="report-style">' + esc(styleName) +
            '　·　' + esc(fmt(r.batchSize, 1)) + ' L 批次　·　糖化效率 ' + esc(fmt(r.efficiency, 0)) + '%' +
          '</div>' +
        '</div>' +
        '<div class="report-head__brand">' +
          '<svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="#241f18" stroke-width="1.6" stroke-linejoin="round">' +
            '<path d="M11 5.5h10l-1.2 5.3c2.4 1.7 3.7 4.1 3.7 7 0 5-3.4 8.6-7.5 8.6S8.5 22.8 8.5 17.8c0-2.9 1.3-5.3 3.7-7L11 5.5z"/>' +
            '<path d="M11.6 18.2c2.6-1.7 6.2-1.7 8.8 0" stroke-linecap="round"/>' +
          '</svg>' +
          '<span>风月酿研所<br>配方卡</span>' +
        '</div>' +
      '</div>' +

      '<div class="report-metrics">' + mHtml + '</div>' +
      '<div class="report-colorstrip">' +
        '<div style="flex:1;background:' + attr(c.colorHex) + '"></div>' +
      '</div>' +

      '<h3>原料清单</h3>' +
      '<table class="report-table">' +
        '<thead><tr><th>麦芽 / 谷物</th><th class="num">用量 kg</th><th class="num">占比</th><th class="num">色度 °L</th></tr></thead>' +
        '<tbody>' + maltRows +
          '<tr><td style="font-weight:600">合计</td><td class="num" style="font-weight:600">' + fmt(totalKg, 2) +
          ' kg</td><td class="num">100%</td><td class="num">—</td></tr>' +
        '</tbody>' +
      '</table>' +

      '<h3>酒花</h3>' +
      '<table class="report-table">' +
        '<thead><tr><th>酒花</th><th class="num">用量</th><th class="num">阶段</th><th class="num">时间 min</th><th class="num">α 酸</th></tr></thead>' +
        '<tbody>' + hopRows + '</tbody>' +
      '</table>' +

      '<div class="report-cols">' +
        '<div>' +
          '<h3>工艺步骤</h3>' +
          '<ul class="report-steps">' + steps + adjLine + '</ul>' +
        '</div>' +
        '<div>' +
          '<h3>水质与关键参数</h3>' +
          '<ul class="report-steps">' +
            '<li><b>水质</b><span>' + esc(waterLine) + '</span></li>' +
            '<li><b>苦甜比</b><span>' + esc(fmt(c.buGu, 2)) + '　' + esc(c.balance || '') + '</span></li>' +
            '<li><b>麦糟吸水</b><span>' + esc(fmt(c.grainAbsorption, 1)) + ' L　酒花吸水 ' +
              esc(fmt(c.hopAbsorption, 2)) + ' L</span></li>' +
            (styleDev ? '<li><b>风格</b><span>' + esc(styleDev) + '</span></li>' : '') +
          '</ul>' +
          (r.notes ? '<h3>备注</h3><p style="font-size:12px;line-height:1.7;color:#4a4030">' +
            esc(r.notes) + '</p>' : '') +
        '</div>' +
      '</div>' +

      '<div class="report-foot">' +
        '<span>生成于 ' + esc(UI.dt(Date.now(), true)) + '　·　风月酿研所 ' + esc(appVer()) + '</span>' +
        '<span>参数为标称值估算，正式生产请以厂商 COA 与设备实测为准</span>' +
      '</div>' +
    '</div>';
  }

  /* ======================================================================
   * 酿造单（v1.4）— 酿造当天带在手上的那张纸
   * ----------------------------------------------------------------------
   * 和配方卡的分工：
   *   配方卡 = "给搭子看怎么复现"（成品，读完就懂）
   *   酿造单 = "我今天几点该干什么、称了多少"（工作单，要能写字）
   * 所以它**不走 canvas**：canvas 上没法选中复制，也没法让手写栏精确对齐
   * 到格子里（那正是这张纸的全部价值）。走 DOM + @media print。
   *
   * 一页装下是本功能唯一的硬指标。做法：
   *   ① 全 mm/pt 排版，屏幕与打印的内容宽度都是 186mm（@page 12mm 边距）；
   *   ② 行高写在 --bs-row 上，原料/步骤超量时整张单子降一档（.is-tight）；
   *   ③ 每个区块都有行数上限，超了在区块下方如实写"还有 N 项没印"——
   *      宁可少印几行并说明，也不要让纸变成两页（第二页往往只剩个页脚）。
   * ====================================================================*/

  /* ---- 一页装得下多少行 ----
     数值都是 printToPDF 实测反推的，不是拍的：
       A4 297 − 上下页边距 24 = 273mm 可用高；
       抬头 + 3 个表头 + 水 + 收尾四行 + 页脚 + 段间距 ≈ 128mm（常规）/ 136mm（压紧）；
       行高 5.4mm（常规）/ 4.3mm（压紧）。
     于是常规档 ≈ 26 行、压紧档 ≈ 31 行。封顶值 BS_CAP 只防脏数据，
     真正的裁剪交给 bsAlloc()（按剩余行数逐行往下砍）。 */
  var BS_PAGE_MM = 273;
  var BS_ROW_MM = { normal: 5.4, tight: 4.3 };
  var BS_OVERHEAD_MM = { normal: 128, tight: 136 };
  var BS_CAP = { malt: 10, hop: 12, step: 18, adj: 4 };

  function bsBudget(tight) {
    var k = tight ? 'tight' : 'normal';
    return Math.floor((BS_PAGE_MM - BS_OVERHEAD_MM[k]) / BS_ROW_MM[k]);
  }

  /**
   * 行分配：先按"不压行距"算总行数，放不下就整张单子压一档（.is-tight），
   * 还放不下才往回砍——砍的顺序是 辅料 → 麦芽 → 酒花 → 步骤，
   * 步骤是这张纸的主体（今天几点该干什么），最后才动，而且有下限。
   * @param {{malt,hop,adj,step}} want 各区块"想印"的行数（已按 BS_CAP 截过）
   * @param {{malt,hop,adj,step}} real 各区块**实际有**多少条
   * @param {number} fixedRows 酵母行（至少 1 行）
   * @returns {{malt,hop,adj,step,tight}}
   */
  function bsAlloc(want, real, fixedRows) {
    var cur = { malt: want.malt, hop: want.hop, adj: want.adj, step: want.step };
    /* "另有 N 项未印"本身也是行，必须算进预算——
       忘了这一步就会出现"刚好卡在边界上、因为一行说明而溢出到第二页"。
       注意比较的是**实际条数**而不是 BS_CAP：一封 26 步的配方被截到 18 步时，
       那行"另有 8 个步骤未印"是真的会印出来的，漏算它就少算一行。 */
    function total(c) {
      var notes = (c.malt < real.malt ? 1 : 0) + (c.hop < real.hop ? 1 : 0) +
                  (c.adj < real.adj ? 1 : 0) + (c.step < real.step ? 1 : 0);
      return c.malt + c.hop + fixedRows + Math.max(1, c.adj) + c.step + notes;
    }

    var tight = false;
    if (total(cur) > bsBudget(false)) {
      tight = true;
      var order = ['adj', 'malt', 'hop', 'step'];
      var floor = { adj: 1, malt: 3, hop: 3, step: 6 };
      for (var guard = 0; guard < 400; guard++) {
        if (total(cur) <= bsBudget(true)) break;
        var cut = false;
        for (var i = 0; i < order.length; i++) {
          var k = order[i];
          if (cur[k] > floor[k]) { cur[k]--; cut = true; break; }
        }
        if (!cut) break;   /* 全都到下限了：只能承认放不下，别再死循环 */
      }
    }
    cur.tight = tight;
    return cur;
  }

  /** 酿造单要的"快照"：36 读的是快照字段名（mashSteps / expectedMashWater…），
   *  而当前配方里叫 mash.steps、水量在 calc 里。这里做一次翻译，
   *  比为了打一张纸去新建一个批次干净得多。 */
  function sheetSnap(r, c) {
    var mashSteps = ((r.mash && r.mash.steps) || []).map(function (s) {
      return { name: s.name, tempC: s.tempC, minutes: s.minutes };
    });
    return {
      batchSize: num(r.batchSize, 20),
      boilTime: num(r.boilTime, 60),
      fermentTemp: num(r.fermentTemp, 20),
      expectedMashWater: num(c && c.mashWater, 0),
      expectedSpargeWater: num(c && c.spargeWater, 0),
      mashSteps: mashSteps,
      hops: (r.hops || []).map(function (h) {
        return { name: h.name, amount: h.amount, stage: h.stage, time: h.time };
      })
    };
  }

  function bsPlan(r, c) {
    var plan = null;
    try {
      if (BREW.BrewdayPlan && typeof BREW.BrewdayPlan.build === 'function') {
        /* startedAt 传 0：这张纸是**开锅之前**打的，还没有"开始时刻"。
           于是 36 只给相对偏移，正好就是"预定时刻"该有的样子。 */
        plan = BREW.BrewdayPlan.build(sheetSnap(r, c), 0);
      }
    } catch (e) { plan = null; }
    return (plan && plan.steps) || [];
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /** 偏移分钟 → +0:00 / +1:25。敢印相对时刻而不是钟点：
   *  11:20 才开始进水的人，纸上写"10:00 糖化"从第一格起就是假话。 */
  function offsetText(min) {
    var m = Math.max(0, Math.round(num(min, 0)));
    return '+' + Math.floor(m / 60) + ':' + pad2(m % 60);
  }

  /** 酒花"什么时候投"的一句话。
   *  干投要单独标出来：它**不在酿造日**，写进备料表是为了提醒"这批酒花要备、
   *  但不是今天投"，免得当天有人照着表把干投也扔进锅里。 */
  function whenText(h) {
    var stage = String((h && h.stage) || 'boil');
    var t = num(h && h.time, 0);
    if (stage === 'boil') return t > 0 ? ('煮沸 ' + fmt(t, 0) + ' min') : '关火投花';
    if (stage === 'whirlpool') return '回旋 ' + fmt(t, 0) + ' min';
    if (stage === 'dryhop') return '干投 · 发酵后';
    if (stage === 'mash') return '糖化投';
    if (stage === 'firstwort') return '头道麦汁';
    return UI.stageLabel ? UI.stageLabel(stage) : stage;
  }

  /** 一行"标签（计划值）+ 手写空线"，收尾栏用（四行都是这个形状） */
  function bsLine(label, planText, tall) {
    return '<tr' + (tall ? ' class="is-tall"' : '') + '>' +
      '<td class="bs-cl">' + esc(label) +
        (planText ? '<i>（' + esc(planText) + '）</i>' : '') + '</td>' +
      '<td class="bs-fill"><span class="bs-blank"></span></td>' +
      '</tr>';
  }

  function brewSheetHtml(r, c) {
    var styleName = '未指定风格';
    if (r.styleId) {
      var st = UI.byId('styles', r.styleId);
      if (st) styleName = (st.code ? st.code + ' · ' : '') + (st.name || r.styleId);
    }

    var ferms = r.fermentables || [];
    var hops = r.hops || [];
    var adjs = r.adjuncts || [];
    var yeasts = r.yeasts || [];
    var steps = bsPlan(r, c);

    var totalKg = 0;
    for (var t0 = 0; t0 < ferms.length; t0++) totalKg += num(ferms[t0].amount, 0);

    /* 先定"每段印几行"，再拼 HTML：行数决定字号档位；
       拼完再量就已经晚了——纸上只会多出第二页。 */
    var real = { malt: ferms.length, hop: hops.length, adj: adjs.length, step: steps.length };
    var want = {
      malt: Math.min(real.malt, BS_CAP.malt),
      hop: Math.min(real.hop, BS_CAP.hop),
      adj: Math.min(real.adj, BS_CAP.adj),
      step: Math.min(real.step, BS_CAP.step)
    };
    var alloc = bsAlloc(want, real, Math.max(1, yeasts.length));
    var maltN = alloc.malt, hopN = alloc.hop, adjN = alloc.adj, stepN = alloc.step;

    /* ---- 今日备料 · 麦芽 ---- */
    var maltRows = '';
    for (var m = 0; m < maltN; m++) {
      var f = ferms[m] || {};
      maltRows += '<tr><td>' + esc(f.name || '未命名') + '</td>' +
        '<td class="bs-num">' + fmt(num(f.amount, 0), 2) + '</td>' +
        '<td class="bs-fill"><span class="bs-blank"></span></td></tr>';
    }
    if (!ferms.length) {
      maltRows = '<tr><td colspan="3" style="color:#7a5c3a">配方里还没有麦芽</td></tr>';
    }
    if (ferms.length > maltN) {
      maltRows += '<tr class="is-sum"><td colspan="3">另有 ' + (ferms.length - maltN) +
        ' 条麦芽未印（明细见软件内）</td></tr>';
    }

    /* ---- 酒花 ---- */
    var hopRows = '';
    for (var h = 0; h < hopN; h++) {
      var hp = hops[h] || {};
      hopRows += '<tr><td>' + esc(hp.name || '未命名') + '</td>' +
        '<td class="bs-num">' + fmt(num(hp.amount, 0), 0) + ' g</td>' +
        '<td>' + esc(whenText(hp)) + '</td>' +
        '<td class="bs-fill"><span class="bs-blank"></span></td></tr>';
    }
    if (!hops.length) hopRows = '<tr><td colspan="4" style="color:#7a5c3a">配方里还没有酒花</td></tr>';
    if (hops.length > hopN) {
      hopRows += '<tr class="is-sum"><td colspan="4">另有 ' + (hops.length - hopN) +
        ' 条酒花未印（明细见软件内）</td></tr>';
    }

    /* ---- 酵母 / 辅料：各至少一行，空也留着——这是"现场核对表"，
           一行不印等于告诉酿酒的人"今天不用管它"。 ---- */
    var yeastRows = '';
    if (yeasts.length) {
      for (var y = 0; y < yeasts.length; y++) {
        var ye = yeasts[y] || {};
        yeastRows += '<tr><td>酵母</td><td>' + esc(ye.name || '未指定菌株') + ' · ' +
          fmt(num(ye.amount, 0), 1) + ' ' + esc(ye.unit || '包') +
          ' · 接种 ' + fmt(num(r.fermentTemp, 20), 0) + '°C</td>' +
          '<td class="bs-fill"><span class="bs-blank"></span></td></tr>';
      }
    } else {
      yeastRows += '<tr><td>酵母</td><td style="color:#7a5c3a">配方里没选酵母</td>' +
        '<td class="bs-fill"><span class="bs-blank"></span></td></tr>';
    }
    for (var a = 0; a < adjN; a++) {
      var ar = adjs[a] || {};
      yeastRows += '<tr><td>辅料</td><td>' + esc(ar.name || '未命名') + ' · ' +
        fmt(num(ar.amount, 0), 1) + ' ' + esc(ar.unit || 'g') + ' · ' +
        esc(UI.stageLabel(ar.stage || '')) + '</td>' +
        '<td class="bs-fill"><span class="bs-blank"></span></td></tr>';
    }
    if (!adjs.length) {
      yeastRows += '<tr><td>辅料</td><td style="color:#7a5c3a">无（不用带）</td>' +
        '<td class="bs-fill"><span class="bs-blank"></span></td></tr>';
    }
    if (adjs.length > adjN) {
      yeastRows += '<tr class="is-sum"><td colspan="3">另有 ' + (adjs.length - adjN) +
        ' 条辅料未印（明细见软件内）</td></tr>';
    }

    /* ---- 时间轴 ---- */
    var stepRows = '';
    for (var s = 0; s < stepN; s++) {
      var sp = steps[s] || {};
      var isHop = /^hop-/.test(String(sp.key || ''));
      var label = String(sp.label || '');
      /* 投花步骤：酒花名 + 克数必须在"步骤"列里看得见。
         36 的 label 形如「60 分钟投花 · 马格努姆 32 g」，把后段加粗即可；
         万一 label 形状变了，退回 key 里的索引把名字补回来。 */
      var cell;
      if (isHop) {
        var cut = label.indexOf(' · ');
        var head = cut > -1 ? label.slice(0, cut) : label;
        var tail = cut > -1 ? label.slice(cut + 3) : '';
        /* 36 的 label 已经自带"投花"二字（"60 分钟投花"），
           再加一枚「投花」标签就成了"投花 60 分钟投花"。去掉重复的那个。 */
        head = head.replace(/投花\s*$/, '').replace(/·\s*$/, '').trim();
        if (!tail) {
          var idx = parseInt(String(sp.key).replace('hop-', ''), 10);
          var hh = hops[idx];
          if (hh) tail = (hh.name || '酒花') + ' ' + fmt(num(hh.amount, 0), 0) + ' g';
        }
        cell = '<span class="bs-tag">投花</span>' + esc(head) +
          (tail ? (head ? ' · ' : '') + '<b>' + esc(tail) + '</b>' : '');
      } else {
        cell = esc(label);
      }
      stepRows += '<tr><td class="bs-num">' + esc(offsetText(sp.offsetMin)) + '</td>' +
        '<td>' + cell + '</td>' +
        '<td class="bs-fill"><span class="bs-blank"></span></td></tr>';
    }
    if (!steps.length) {
      stepRows = '<tr><td colspan="3" style="color:#7a5c3a">' +
        '时间轴没生成出来（BrewdayPlan 未载入）</td></tr>';
    }
    if (steps.length > stepN) {
      stepRows += '<tr class="is-sum"><td colspan="3">另有 ' + (steps.length - stepN) +
        ' 个步骤未印（明细见软件内）</td></tr>';
    }

    /* ---- 水 ---- */
    var w = (c && c.water) || {};
    var phLo = (w.mashPhRange && w.mashPhRange[0] !== undefined) ? w.mashPhRange[0] : null;
    var phHi = (w.mashPhRange && w.mashPhRange[1] !== undefined) ? w.mashPhRange[1] : null;
    /* 源水没填时 mashPhRange 是 RA=0 的静默默认值（恒落在 5.2–5.5），
       把它当"目标 pH"印在这张纸上，等于叫用户照一个没有依据的数去糖化。
       判定与卡片同一口径（phText）：只要有一项离子是"不知道"，pH 就不印。
       注意不能只看 waterUnset —— 只加了盐、没填源水时离子非 0，
       但 RA 里的碱度仍是无源之水，pH 一样没有意义。 */
    var phPlan = (phText(w) === '—') ? '未设'
      : (phLo !== null && phHi !== null ? fmt(phLo, 1) + '–' + fmt(phHi, 1) : '5.2–5.6');
    var mashSteps = (r.mash && r.mash.steps) || [];
    var restTemp = mashSteps.length ? num(mashSteps[0].tempC, 66) : 66;

    /* 计划值印在标签行（粗体），下面那条空线留给实测。
       单位只印一次（跟空线在一起），否则一行里出现两个 L。 */
    function waterField(label, plan, unit) {
      return '<div class="bs-wf">' +
        '<span class="bs-wk">' + esc(label) + ' <b>' + esc(plan) + '</b></span>' +
        '<span class="bs-wv"><span class="bs-blank"></span>' +
          (unit ? '<em>' + esc(unit) + '</em>' : '') + '</span>' +
        '</div>';
    }

    /* data-rows 是实测脚本与自检的抓手：纸上印了几行，一眼能对 */
    var rowCount = maltN + hopN + Math.max(1, yeasts.length) + Math.max(1, adjN) + stepN;

    return '<div class="bs-wrap">' +
      '<div class="bs-paper">' +
      '<div class="bs-sheet' + (alloc.tight ? ' is-tight' : '') + '" id="brew-sheet" ' +
        'data-rows="' + rowCount + '" data-tight="' + (alloc.tight ? '1' : '0') + '">' +

        /* ---- ① 抬头 ---- */
        '<div class="bs-head" id="bs-head">' +
          '<div class="bs-head__main">' +
            '<h1 class="bs-name" title="' + attr(r.name || '未命名配方') + '">' +
              esc(r.name || '未命名配方') + '</h1>' +
            '<div class="bs-sub">' + esc(styleName) +
              '　·　批次 ' + esc(fmt(r.batchSize, 1)) + ' L' +
              '　·　设计效率 ' + esc(fmt(r.efficiency, 0)) + '%' +
              '　·　煮沸 ' + esc(fmt(r.boilTime, 0)) + ' min' +
            '</div>' +
          '</div>' +
          '<div class="bs-fields">' +
            '<div><i>酿造日期</i><span class="bs-blank" style="width:26mm"></span></div>' +
            '<div><i>酿造人</i><span class="bs-blank" style="width:22mm"></span></div>' +
          '</div>' +
        '</div>' +

        /* ---- ② 今日备料 ---- */
        '<div class="bs-sec">' +
          '<h4 class="bs-h">今日备料<em>Grain / Hops / Yeast　计划值已印，实称请手写</em></h4>' +
          '<table class="bs-tbl">' +
            '<colgroup><col><col style="width:18mm"><col style="width:26mm"></colgroup>' +
            '<thead><tr><th>麦芽 / 谷物</th><th class="bs-num">计划 kg</th>' +
              '<th>实称 kg</th></tr></thead>' +
            '<tbody>' + maltRows +
              (ferms.length ? '<tr class="is-sum"><td>合计</td><td class="bs-num">' +
                fmt(totalKg, 2) + '</td><td></td></tr>' : '') +
            '</tbody>' +
          '</table>' +
        '</div>' +

        '<div class="bs-sec">' +
          '<table class="bs-tbl">' +
            '<colgroup><col><col style="width:20mm"><col style="width:32mm"><col style="width:26mm"></colgroup>' +
            '<thead><tr><th>酒花</th><th class="bs-num">克数</th><th>投放时刻</th>' +
              '<th>实投 g</th></tr></thead>' +
            '<tbody>' + hopRows + '</tbody>' +
          '</table>' +
        '</div>' +

        '<div class="bs-sec">' +
          '<table class="bs-tbl">' +
            '<colgroup><col style="width:14mm"><col><col style="width:26mm"></colgroup>' +
            '<thead><tr><th>酵母 / 辅料</th><th>计划</th><th>实取</th></tr></thead>' +
            '<tbody>' + yeastRows + '</tbody>' +
          '</table>' +
        '</div>' +

        /* ---- ③ 水 ---- */
        '<div class="bs-sec">' +
          '<h4 class="bs-h">水<em>Water　左为计划值，空格填实测</em></h4>' +
          '<div class="bs-water">' +
            waterField('糖化水', fmt(num(c && c.mashWater, 0), 1), 'L') +
            waterField('洗糟水', fmt(num(c && c.spargeWater, 0), 1), 'L') +
            waterField('糖化温度', fmt(restTemp, 0), '°C') +
            waterField('糖化 pH', phPlan, '') +
          '</div>' +
        '</div>' +

        /* ---- ④ 时间轴 ---- */
        '<div class="bs-sec">' +
          '<h4 class="bs-h">时间轴<em>Run Sheet　预定时刻以「糖化进水」为 +0:00，实际请手写</em></h4>' +
          '<table class="bs-tbl" id="bs-timeline">' +
            '<colgroup><col style="width:20mm"><col><col style="width:46mm"></colgroup>' +
            '<thead><tr><th>预定时刻</th><th>步骤</th><th>实际时刻 / 备注</th></tr></thead>' +
            '<tbody>' + stepRows + '</tbody>' +
          '</table>' +
        '</div>' +

        /* ---- ⑤ 收尾记录 ---- */
        '<div class="bs-sec">' +
          '<h4 class="bs-h">收尾记录<em>Wrap-up　收工后填，第二天就记不清了</em></h4>' +
          '<table class="bs-close" id="bs-close">' +
            bsLine('实际 OG', '预计 ' + UI.sg(c && c.og)) +
            bsLine('实际批次量', '计划 ' + fmt(r.batchSize, 1) + ' L') +
            bsLine('实际效率', '设计 ' + fmt(r.efficiency, 0) + '%') +
            bsLine('备注', '', true) +
          '</table>' +
        '</div>' +

        /* ---- ⑥ 页脚 ---- */
        '<div class="bs-foot">' +
          '<span>风月酿研所 · 生成于 ' + esc(UI.dt(Date.now(), true)) + '</span>' +
          /* 句子从「本单按配方推算生成，实际以现场为准」缩到 17 字：
             7pt 下每字约 2.4mm，19 字 + 左句正好把 186mm 顶满，
             右句最后一个字会落在裁切边外。少两个字换回 5mm 余量。 */
          '<span>按配方推算生成，实际以现场为准</span>' +
        '</div>' +

      '</div></div></div>';
  }

  function doPrintSheet() {
    /* 页签切走时 <body> 上的 data-print 会跟着变，这里是最后一道保险：
       打印的是"酿造单"，纸上就只能有酿造单。 */
    syncPrintFlag('sheet');
    try {
      root.print();
    } catch (e) {
      UI.Shell.toast('浏览器阻止了打印，请用 Ctrl+P 手动打印', 'warn');
    }
  }

  /* ======================================================================
   * Canvas 绘制（PNG 导出）
   * ====================================================================*/

  /* 画布高度上限：1000 逻辑宽 × 2 倍像素，2400 逻辑高 = 4800 像素高。
     超过就真的画不下了——所以必须"说出来"，不能静默裁掉（③）。 */
  var MAX_H = 2400;

  /** 高度估算：把辅料与备注也算进去，否则新加的段会把页脚挤出画布 */
  function estimateHeight(r) {
    var nF = Math.max(1, (r.fermentables || []).length);
    var nH = Math.max(1, (r.hops || []).length);
    var nA = (r.adjuncts || []).length;
    var rows = nF + nH + (nA ? nA + 1 : 0);
    var h = 720 + rows * 26 + (((r.mash && r.mash.steps) || []).length ? 30 : 0);
    var notes = String(r.notes || '').trim();
    if (notes) h += 40 + 18 * Math.min(4, Math.ceil(notes.length / 46));
    return { h: Math.min(MAX_H, h), want: h, clipped: h > MAX_H };
  }

  function exportPng() {
    var r = lastRecipe || UI.recipe();
    var c = lastCalc || UI.calc(r);

    /* 空配方不导出（④）：导出的会是一张 OG 1.000 / "未添加麦芽" 的废卡片。
       按钮那边已经 disabled，这里是第二道闸——键盘/脚本/旧 DOM 都可能绕过它。 */
    if (!(r.fermentables || []).length) {
      UI.Shell.toast('没有原料，卡片会是空的：先在配方里加麦芽再导出', 'warn', 4200);
      return;
    }

    var canvas = document.createElement('canvas');
    var W = 1000;
    var scale = 2;

    var est = estimateHeight(r);
    var H = est.h;

    canvas.width = W * scale;
    canvas.height = H * scale;
    var ctx = canvas.getContext('2d');
    if (!ctx) { UI.Shell.toast('浏览器不支持 Canvas，无法导出', 'error'); return; }
    ctx.scale(scale, scale);

    var info = drawCard(ctx, W, H, r, c, est.clipped) || {};

    var name = (r.name || '配方卡').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
    var url;
    try {
      /* 配方卡没有 cm 规格，但它的逻辑宽 1000 就是按 A4 宽 210 mm 排的，
         导出是 2 倍像素 → 2000 px / 8.2677 in ≈ 242 dpi。
         写上 pHYs 至少让排版软件按 21 cm 插入，而不是按 72dpi 放成 52.9 cm。
         （酒标有明确 cm 规格，那边固定 300 dpi。） */
      var cardDpi = Math.round(canvas.width / (210 / 25.4));
      url = (typeof UI.pngWithDpi === 'function')
        ? UI.pngWithDpi(canvas, cardDpi).url
        : canvas.toDataURL('image/png');
    } catch (e) {
      UI.reportError(e, 'toDataURL');
      UI.Shell.toast('导出失败：画布被浏览器限制', 'error');
      return;
    }
    var a = document.createElement('a');
    a.href = url;
    a.download = '风月酿研所_' + name + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    /* 把"印在纸上看不见的损失"当场说出来：标题被截断、行数超上限（③）。
       只写进图里没用——用户先看到的是导出成功的 toast。 */
    var missed = [];
    if (info.titleTruncated) missed.push('主标题过长，卡片上只印了前 ' + info.titleChars + ' 个字');
    if (est.clipped) missed.push('原料行超过单页上限，卡片底部已截断（完整内容见软件内）');
    if (info.skippedRows) missed.push('有 ' + info.skippedRows + ' 行原料没印上');
    if (missed.length) {
      UI.Shell.toast('已导出：' + missed.join('；'), 'warn', 5600);
    } else {
      UI.Shell.toast('已导出 PNG：风月酿研所_' + name + '.png', 'ok');
    }
  }

  /** 逐字折行（中文不按空格断词；不设行数上限，由调用方截） */
  function wrapLines(ctx, str, maxW) {
    var s = String(str || '');
    var out = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var test = cur + ch;
      if (ctx.measureText(test).width > maxW && cur) { out.push(cur); cur = ch; }
      else cur = test;
    }
    if (cur) out.push(cur);
    return out;
  }

  /**
   * 标题排版（②）：二分缩小 → 最小 26px → 最多 2 行 → 仍放不下才截断加省略号。
   * 为什么不是"折行不缩"：2 行以上的大标题会挤掉参数区和原料表，
   * 而标题恰恰是这张卡上最不重要的信息（内容能复现才是重点）。
   * 返回 chars 是为了把"只印了前 N 个字"说出来——静默丢字比排版难看严重得多。
   */
  function fitTitle(ctx, str, maxW, baseSize, minSize, maxLines) {
    var s = String(str || '').trim() || '未命名配方';
    var size = baseSize;
    var lines = null;
    for (;;) {
      ctx.font = '600 ' + size + 'px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      lines = wrapLines(ctx, s, maxW);
      if (lines.length <= maxLines || size <= minSize) break;
      size -= 1;
    }
    var truncated = false, chars = s.length;
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      var kept = '';
      for (var i = 0; i < last.length; i++) {
        if (ctx.measureText(kept + last.charAt(i) + '…').width > maxW) break;
        kept += last.charAt(i);
      }
      lines[maxLines - 1] = kept + '…';
      truncated = true;
      chars = lines[0].length + (maxLines > 1 ? kept.length : 0);
    }
    return { lines: lines, size: size, truncated: truncated, chars: chars };
  }

  function drawCard(ctx, W, H, r, c, clipped) {
    var pad = 52;

    /* 纸底 */
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);

    function text(str, x, y, opt) {
      opt = opt || {};
      ctx.font = opt.font || '14px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = opt.color || INK;
      ctx.textAlign = opt.align || 'left';
      ctx.textBaseline = opt.baseline || 'alphabetic';
      ctx.fillText(str, x, y);
    }
    function rule(y, color, wd) {
      ctx.strokeStyle = color || RULE;
      ctx.lineWidth = wd || 1;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(W - pad, y);
      ctx.stroke();
    }

    var y = pad + 30;
    var skippedRows = 0;      /* 因画布到顶而没印的行数 */
    var titleInfo = null;

    /* 标题：右边留出品牌标识的位置，最多 2 行（②） */
    titleInfo = fitTitle(ctx, r.name || '未命名配方', W - pad * 2 - 210, 30, 26, 2);
    var titleLH = titleInfo.size + 8;
    for (var tl = 0; tl < titleInfo.lines.length; tl++) {
      text(titleInfo.lines[tl], pad, y + tl * titleLH, {
        font: '600 ' + titleInfo.size + 'px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
        color: INK
      });
    }

    var styleName = '未指定风格';
    if (r.styleId) {
      var st = UI.byId('styles', r.styleId);
      if (st) styleName = (st.code ? st.code + ' · ' : '') + (st.name || r.styleId);
    }
    var underTitle = y + (titleInfo.lines.length - 1) * titleLH;
    text(styleName, pad, underTitle + 24, { font: '13px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif', color: MUTED });
    text(fmt(r.batchSize, 1) + ' L 批次　·　效率 ' + fmt(r.efficiency, 0) + '%　·　' + fmt(r.boilTime, 0) + ' min 煮沸',
      pad, underTitle + 44, { font: '12px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: MUTED });

    text('风月酿研所', W - pad, y - 6, {
      font: '600 13px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: INK, align: 'right'
    });
    text('配方卡 · Recipe Card', W - pad, y + 12, {
      font: '10px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: MUTED, align: 'right'
    });

    y = underTitle + 60;
    rule(y, INK, 2);
    y += 26;

    /* 指标行 */
    var metrics = [
      ['OG', UI.sg(c.og)], ['FG', UI.sg(c.fg)], ['ABV', fmt(c.abv, 1) + '%'],
      ['IBU', fmt(c.ibu, 0)], ['SRM', fmt(c.srm, 1)], ['BU:GU', fmt(c.buGu, 2)]
    ];
    var boxW = (W - pad * 2) / metrics.length;
    for (var i = 0; i < metrics.length; i++) {
      var x = pad + i * boxW;
      text(metrics[i][0], x, y, { font: '9px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: MUTED });
      text(metrics[i][1], x, y + 22, {
        font: '600 20px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: INK
      });
      if (i > 0) {
        ctx.strokeStyle = RULE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 14, y - 10);
        ctx.lineTo(x - 14, y + 28);
        ctx.stroke();
      }
    }
    y += 48;

    /* 色带 */
    ctx.fillStyle = c.colorHex || '#c8862f';
    var stripW = (W - pad * 2) * Math.min(1, Math.max(0.06, num(c.srm, 0) / 45));
    ctx.fillRect(pad, y, stripW, 5);
    ctx.fillStyle = RULE;
    ctx.fillRect(pad + stripW, y, (W - pad * 2) - stripW, 5);
    y += 34;

    /* 画布到底了没：返回 true = 再往下画就掉出画布（③）。
       只靠 Math.min 把 H 压到 2400 是不够的——那样下半截是"被切掉"，
       用户看不出少了什么，也不知道该去缩短哪里。 */
    function full(need) { return y + (need || 0) > H - 78; }

    /* 原料清单 */
    function section(title) {
      if (full(34)) return false;
      text(title, pad, y, { font: '600 11px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: MUTED });
      y += 8;
      rule(y);
      y += 18;
      return true;
    }

    var totalKg = 0;
    for (var m = 0; m < r.fermentables.length; m++) totalKg += num(r.fermentables[m].amount, 0);

    if (!section('原料清单 · GRAIN BILL')) {
      skippedRows += r.fermentables.length;
    } else if (!r.fermentables.length) {
      text('未添加麦芽', pad, y, { font: '12px sans-serif', color: MUTED });
      y += 22;
    } else {
      for (var j = 0; j < r.fermentables.length; j++) {
        if (full(16)) { skippedRows += r.fermentables.length - j; break; }
        var mr = r.fermentables[j];
        var kg = num(mr.amount, 0);
        text(trunc(ctx, mr.name, W - pad * 2 - 200, '12px sans-serif'), pad, y,
          { font: '12px sans-serif', color: INK });
        text(fmt(kg, 2) + ' kg', W - pad - 120, y, {
          font: '12px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: INK, align: 'right'
        });
        text(fmt(totalKg > 0 ? kg / totalKg * 100 : 0, 1) + '%', W - pad, y, {
          font: '12px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: MUTED, align: 'right'
        });
        y += 20;
      }
      if (!full(30)) {
        text('合计 ' + fmt(totalKg, 2) + ' kg', pad, y, { font: '600 11px sans-serif', color: MUTED });
        y += 26;
      }
    }

    /* 酒花 */
    if (!section('酒花 · HOP SCHEDULE')) {
      skippedRows += r.hops.length;
    } else if (!r.hops.length) {
      text('未添加酒花', pad, y, { font: '12px sans-serif', color: MUTED });
      y += 22;
    } else {
      for (var h = 0; h < r.hops.length; h++) {
        if (full(16)) { skippedRows += r.hops.length - h; break; }
        var hr = r.hops[h];
        var aa = num(hr.aa, 0);
        text(trunc(ctx, hr.name, W - pad * 2 - 300, '12px sans-serif'), pad, y,
          { font: '12px sans-serif', color: INK });
        text(fmt(hr.amount, 0) + ' g', W - pad - 200, y, {
          font: '12px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: INK, align: 'right'
        });
        text(UI.stageLabel(hr.stage) + ' / ' + fmt(hr.time, 0) + ' min', W - pad - 90, y, {
          font: '12px sans-serif', color: MUTED, align: 'right'
        });
        text(fmt(aa, 1) + '%', W - pad, y, {
          font: '12px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: MUTED, align: 'right'
        });
        y += 20;
      }
      y += 6;
    }

    /* 辅料（①）：有则印、无则整段不出现。
       空标题（"辅料 · ADJUNCTS" 下面一行字都没有）比没有标题更难看，
       而且会让读者以为"这段信息丢了"。
       还有更实际的一层：本函数是**顺序降级**的（full() 一触发，后面的段就少一块），
       所以多印一个空段不只是多一行字——它白占 26px，把备注推过 full() 线，
       连带把"只印前 4 行"那句说明也挤掉。反向验证时就是这么红的。 */
    if ((r.adjuncts || []).length) {
      if (!section('辅料 · ADJUNCTS')) {
        skippedRows += r.adjuncts.length;
      } else {
        for (var ai = 0; ai < r.adjuncts.length; ai++) {
          if (full(16)) { skippedRows += r.adjuncts.length - ai; break; }
          var ar = r.adjuncts[ai];
          text(trunc(ctx, ar.name, W - pad * 2 - 320, '12px sans-serif'), pad, y,
            { font: '12px sans-serif', color: INK });
          text(fmt(ar.amount, 1) + ' ' + (ar.unit || 'g'), W - pad - 190, y,
            { font: '12px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: INK, align: 'right' });
          text(UI.stageLabel(ar.stage || '') + (ar.note ? ' · ' + ar.note : ''), W - pad, y,
            { font: '12px sans-serif', color: MUTED, align: 'right' });
          y += 20;
        }
        y += 6;
      }
    }

    /* 工艺 */
    if (section('工艺 · PROCESS')) {
      var mash = (r.mash && r.mash.steps) || [];
      var mashStr = mash.length
        ? mash.map(function (s) { return fmt(s.tempC, 0) + '°C×' + fmt(s.minutes, 0) + '′'; }).join(' → ')
        : '67°C × 60 min';
      text('糖化　' + mashStr, pad, y, { font: '12px sans-serif', color: INK });
      y += 20;
      text('水量　糖化 ' + fmt(c.mashWater, 1) + ' L / 洗糟 ' + fmt(c.spargeWater, 1) + ' L / 煮沸前 ' +
        fmt(c.preBoilVolume, 1) + ' L → 入罐 ' + fmt(c.postBoilVolume, 1) + ' L', pad, y,
        { font: '12px sans-serif', color: INK });
      y += 20;

      var ye = r.yeasts && r.yeasts[0];
      if (ye) {
        var atten = num(ye.att, 75);
        text('发酵　' + (ye.name || '未指定') + ' · ' + fmt(ye.amount, 1) + ' ' + (ye.unit || 'g') +
          ' · ' + fmt(ye.tempC, 0) + '°C · 预期衰减 ' + fmt(atten, 0) + '%', pad, y,
          { font: '12px sans-serif', color: INK });
        y += 20;
      }
      text('碳化　目标 ' + fmt(num(r.carbonation.targetVol, 2.4), 1) + ' vol，蔗糖约 ' +
        fmt(c.carbonation ? c.carbonation.sugarGrams.sucrose : 0, 0) + ' g / 整批', pad, y,
        { font: '12px sans-serif', color: INK });
      y += 28;
    }

    /* 水化学。源水没填时整段换成一句实话：导出图是要发出去的，
       上面印 "Ca 0 · Mg 0 · … · 糖化 pH 估算 5.3（目标 5.2–5.6）"，
       收图的人会以为这是一款刻意做的软水配方。 */
    var w = c.water || {};
    if (section('水质 · WATER')) {
      if (waterUnset(w)) {
        var noSrc = w.saltCount
          ? '源水未设置，离子仅含添加盐贡献；糖化 pH 无法估算'
          : '源水未设置，到配方页「水质」面板填入或选水型';
        /* 先定字体再量宽度：wrapLines 用的是 ctx.measureText，
           顺序反了就是拿上一段（可能是 20px 标题）的字体去量 12px 的字。 */
        ctx.font = '12px sans-serif';
        var nl2 = wrapLines(ctx, noSrc, W - pad * 2);
        for (var ns = 0; ns < nl2.length && ns < 2; ns++) {
          if (full(16)) break;
          text(nl2[ns], pad, y, { font: '12px sans-serif', color: MUTED });
          y += 19;
        }
        y += 11;
      } else {
        /* 与 DOM 卡片同一口径（ionText / ratioText）：缺的那项印 —，不印 0 */
        text('Ca ' + ionText(w.ca) + ' · Mg ' + ionText(w.mg) +
          ' · Na ' + ionText(w.na) + ' · Cl ' + ionText(w.cl) +
          ' · SO₄ ' + ionText(w.so4) + ' · HCO₃ ' + ionText(w.hco3) + ' ppm',
          pad, y, { font: '12px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: INK });
        y += 20;
        text('SO₄:Cl ' + ratioText(w) + '　糖化 pH 估算 ' + phText(w) +
          '（目标 5.2–5.6）', pad, y, { font: '12px sans-serif', color: MUTED });
        y += 30;
      }
    }

    /* 备注（①）：有则印、无则整段不出现。屏幕上卡片有备注、导出的图没有，
       等于"发给别人的版本"比"自己看到的版本"少信息——这正是要修的那类假话。 */
    var notesTxt = String(r.notes || '').trim();
    if (notesTxt) {
      if (section('备注 · NOTES')) {
        ctx.font = '12px sans-serif';
        var nl = wrapLines(ctx, notesTxt, W - pad * 2);
        for (var ni = 0; ni < nl.length && ni < 4; ni++) {
          if (full(14)) break;
          text(nl[ni], pad, y, { font: '12px sans-serif', color: INK });
          y += 18;
        }
        if (nl.length > 4 && !full(14)) {
          text('（备注共 ' + nl.length + ' 行，卡片上只印前 4 行）', pad, y,
            { font: '11px sans-serif', color: MUTED });
          y += 18;
        }
      }
    }

    /* 页脚：
       · 说明行写明"这张图上没有什么"——风格匹配度是诊断结论，不是配方内容，
         印进 A4 会把配方卡变成体检报告，所以 PNG **明确不印**，但要留一句指向（①）。
         措辞用"本图"而不是"本卡"：网页版配方卡上仍带着那一行（改动前就有），
         说"本卡未印"会和用户手上看的东西对不上。 */
    if (y < H - 96) {
      text('本图不印风格匹配度与超量告警，见软件内配方页', pad, H - 84,
        { font: '9.5px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif', color: MUTED });
    }
    if (skippedRows || clipped) {
      text('⚠ 内容超过单页上限，有 ' + skippedRows + ' 行未打印（完整配方见软件内）',
        pad, H - 66,
        { font: '10px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif', color: '#a83628' });
    }
    if (y < H - 46) rule(H - 44);
    text('生成于 ' + UI.dt(Date.now(), true) + ' · 风月酿研所 ' + appVer(), pad, H - 28,
      { font: '10px "Times New Roman", Times, "SF Mono", Consolas, monospace', color: MUTED });
    text('标称值估算，生产前请核对厂商 COA', W - pad, H - 28,
      { font: '10px sans-serif', color: MUTED, align: 'right' });

    return {
      titleTruncated: !!(titleInfo && titleInfo.truncated),
      titleChars: titleInfo ? titleInfo.chars : 0,
      skippedRows: skippedRows
    };
  }

  function trunc(ctx, str, maxW, font) {
    var s = String(str || '');
    ctx.font = font || '12px sans-serif';
    if (ctx.measureText(s).width <= maxW) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
    }
    return s.slice(0, lo) + '…';
  }

  function doPrint() {
    /* 让打印只输出配方卡：打印样式已在 CSS 的 @media print 里处理。
       v1.4 起 <body> 上多了个 data-print 开关（酿造单要用），
       打配方卡前先把它压回 card —— 否则从酿造单页签按 Ctrl+P 再点打印，
       会用酿造单的版式打配方卡。 */
    syncPrintFlag('card');
    try {
      root.print();
    } catch (e) {
      UI.Shell.toast('浏览器阻止了打印，请用 Ctrl+P 手动打印', 'warn');
    }
  }

  BREW.UI.ReportView = {
    id: 'report',
    label: '配方卡',
    icon: 'report',
    group: '交付',
    order: 5,
    render: render,
    onEnter: function () {
      /* 从配方页切过来时内容可能已变，重绘一份 */
      if (document.getElementById('report-sheet')) {
        var r = UI.recipe();
        var c = UI.calc(r);
        lastRecipe = r; lastCalc = c;
        var sheet = document.getElementById('report-sheet');
        if (sheet && sheet.parentNode) {
          var tmp = document.createElement('div');
          tmp.innerHTML = sheetHtml(r, c);
          sheet.parentNode.replaceChild(tmp.firstChild, sheet);
        }
      } else if (document.getElementById('brew-sheet')) {
        /* 酿造单整块重绘（不是只换内容）：行数变了可能要从 .is-tight 退回来，
           页脚日期也要重新取，整块换比局部改省心。用 render 而不是 innerHTML，
           因为页签/按钮的状态也跟着配方走。 */
        var host = document.getElementById('view');
        if (host) render(host);
      }
    },
    onLeave: function () {
      /* 打印开关是挂在 <body> 上的，离开本视图必须摘掉：
         否则在别的视图按 Ctrl+P，纸上会按"酿造单"的版式排一遍别的页面。 */
      clearPrintFlag();
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
