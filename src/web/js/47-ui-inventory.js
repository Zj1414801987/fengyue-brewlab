/* ============================================================================
 * 风月酿研所 — 47-ui-inventory.js
 * ----------------------------------------------------------------------------
 * 职责：库存面板（挂在原料库视图的「库存 / 采购」模式下，由 44 调用 mount）。
 *   · 物料余额表：当前余额 / 补货阈值 / 本批需要 / 记入库 / 记出库
 *   · 采购清单：当前配方需求 − 余额，按品类分组，勾选状态落盘
 *
 * 数据口径（四条，改动前先看这里）：
 *   1. **余额不落盘**。只存流水 inventory.moves，每次渲染现算 Σdelta。
 *      写一个 balance 字段进 inventory 是数据层定死不允许的——流水与余额
 *      一旦有两份真值，早晚会对不上，而对不上的时候没人知道该信哪个。
 *   2. 物料元信息（补货阈值等）放 inventory.items，可以缺省；缺省时按
 *      品类默认值（麦芽 1kg / 酒花 50g / 酵母 1 包 / 辅料 1）。
 *   3. 采购勾选状态放**顶层** `shopping` 键，键格式 `<scope>:<kind>:<refId>`，
 *      值 = 勾选时间戳。scope 用配方 id——换配方就是另一张采购单。
 *      不自己发明存储键，也不挂在配方对象上（normalizeRecipe 是白名单，
 *      挂上去保存一次就没了）。
 *   4. 缺口与建议购买量交给 BREW.Inventory（33 号）算。它要的入参是
 *      `{malts:{id:{qty,unit}}, hops:…}` 这种**余额表**，而我们只存流水，
 *      所以这里做一层桥：Σdelta → 余额表 → deficits()。桥只做聚合，
 *      不做"缺多少"的判断——那是 33 号的口径，不能有两份。
 *
 * 依赖：BREW.UI（esc/attr/num/fmt/icon/recipe/pool/store）、UI.Shell（modal/toast）
 *       BREW.Inventory（**可缺**：缺了用本文件自带的缺口算法，口径写在 localDeficits）
 * 对外：UI.InventoryPanel.{mount, check, balanceOf, moves}
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  var P = UI.InventoryPanel = UI.InventoryPanel || {};

  /** 各品类的记账单位、取整步长、以及"买多少算一包" */
  var KIND_META = {
    malts: { label: '麦芽与谷物', unit: 'kg', step: 0.5, pack: 0, threshold: 1 },
    hops: { label: '酒花', unit: 'g', step: 10, pack: 0, threshold: 50 },
    yeasts: { label: '酵母', unit: 'g', step: 11, pack: 11, threshold: 11 },
    adjuncts: { label: '辅料', unit: 'g', step: 10, pack: 0, threshold: 10 }
  };
  var KIND_ORDER = ['malts', 'hops', 'yeasts', 'adjuncts'];
  /* 配方里的数组名与原料库的 kind 不是一回事（fermentables ↔ malts） */
  var ROW_KEY = { malts: 'fermentables', hops: 'hops', yeasts: 'yeasts', adjuncts: 'adjuncts' };

  function toast(msg, kind, ms) {
    if (UI.Shell && UI.Shell.toast) UI.Shell.toast(msg, kind || 'info', ms || 2800);
  }

  function store() { return BREW.Store || null; }

  function invData() {
    var s = store();
    var inv = null;
    try { inv = s ? s.get('inventory', null) : null; } catch (e) { inv = null; }
    if (!inv || typeof inv !== 'object') inv = {};
    if (!Array.isArray(inv.moves)) inv.moves = [];
    if (!Array.isArray(inv.items)) inv.items = [];
    return inv;
  }

  function shoppingData() {
    var s = store();
    var v = null;
    try { v = s ? s.get('shopping', null) : null; } catch (e) { v = null; }
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  }

  function keyOf(kind, refId) { return kind + ':' + refId; }

  /* ======================================================================
   * A. 流水 → 余额
   * ====================================================================*/

  function splitKey(key) {
    var parts = String(key || '').split(':');
    if (parts.length > 1 && KIND_META[parts[0]]) {
      return { kind: parts[0], refId: parts.slice(1).join(':') };
    }
    /* 裸 id（早期数据可能是这种形状）：默认当麦芽，但读的时候要认 */
    return { kind: 'malts', refId: parts[0] };
  }

  function sumDelta(inv, kind, refId) {
    var k1 = keyOf(kind, refId);
    var total = 0;
    for (var i = 0; i < inv.moves.length; i++) {
      var m = inv.moves[i];
      if (!m) continue;
      var k = String(m.key || '');
      if (k !== k1 && k !== String(refId)) continue;
      total += num(m.delta, 0);
    }
    return total;
  }

  P.balanceOf = function (kind, refId) {
    return sumDelta(invData(), kind, refId);
  };

  /**
   * 余额表：{ malts: { 'm-2row': {qty, unit} }, hops: {...} }
   * 这是 BREW.Inventory.deficits 要的入参形状。单位取该品类记账单位——
   * 单位换算交给 33 号（它有 convert()），这里不自己换。
   */
  function balancesMap() {
    var inv = invData();
    var map = {};
    for (var k = 0; k < KIND_ORDER.length; k++) {
      var kind = KIND_ORDER[k];
      map[kind] = {};
    }
    /* 先按 key 聚合，避免同一物料多笔流水时被后一条覆盖 */
    var agg = {};
    for (var i = 0; i < inv.moves.length; i++) {
      var m = inv.moves[i];
      if (!m || !m.key) continue;
      var sk = splitKey(m.key);
      var id = sk.kind + '|' + sk.refId;
      if (!agg[id]) {
        agg[id] = {
          kind: sk.kind,
          refId: sk.refId,
          qty: 0,
          unit: m.unit || (KIND_META[sk.kind] || KIND_META.malts).unit
        };
      }
      agg[id].qty += num(m.delta, 0);
    }
    for (var key in agg) {
      if (!Object.prototype.hasOwnProperty.call(agg, key)) continue;
      var a = agg[key];
      map[a.kind][a.refId] = { qty: a.qty, unit: a.unit };
    }
    return map;
  }

  function itemMeta(inv, kind, refId) {
    for (var i = 0; i < inv.items.length; i++) {
      var it = inv.items[i];
      if (it && it.key === keyOf(kind, refId)) return it;
    }
    return null;
  }

  function thresholdOf(inv, kind, refId) {
    var meta = itemMeta(inv, kind, refId);
    if (meta && meta.threshold !== undefined && meta.threshold !== null) return num(meta.threshold, 0);
    return num((KIND_META[kind] || KIND_META.malts).threshold, 1);
  }

  /* ======================================================================
   * B. 缺口
   * ----------------------------------------------------------------------
   * 优先问 33 号：它懂单位换算、懂"没入库 ≠ 缺货"、懂按品类取整。
   * 模块缺失时才走 localDeficits（同一套口径的简化版，只为不白屏）。
   * ====================================================================*/

  /** @returns {{items:Array, totalShort:number, itemCount:number, warnings:Array, from:'module'|'local'}} */
  function computeDeficits(recipe) {
    if (BREW.Inventory && typeof BREW.Inventory.deficits === 'function') {
      try {
        var res = BREW.Inventory.deficits(recipe, balancesMap());
        if (res && Array.isArray(res.items)) {
          res.from = 'module';
          return res;
        }
      } catch (e) { /* 落到本地算法 */ }
    }
    return localDeficits(recipe);
  }

  /* 本地兜底：只做"按 kind+id 聚合需求 − 余额"，不做单位换算也不猜取整。
     界面会标出这是估算（见 paint 里的 from === 'local' 提示）。 */
  function localDeficits(recipe) {
    var items = [];
    var inv = invData();
    if (recipe) {
      for (var o = 0; o < KIND_ORDER.length; o++) {
        var kind = KIND_ORDER[o];
        var rows = recipe[ROW_KEY[kind]];
        if (!Array.isArray(rows)) continue;
        var agg = {}, order = [];
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (!row || !row.id) continue;
          var need = num(row.amount, 0);
          if (!(need > 0)) continue;
          if (!agg[row.id]) {
            agg[row.id] = {
              kind: kind, id: row.id, name: row.name || row.id,
              need: 0, unit: row.unit || KIND_META[kind].unit
            };
            order.push(row.id);
          }
          agg[row.id].need += need;
        }
        for (var j = 0; j < order.length; j++) {
          var it = agg[order[j]];
          var have = P.balanceOf(kind, it.id);
          var short = Math.max(0, it.need - have);
          items.push({
            kind: kind, id: it.id, name: it.name, need: it.need, have: have,
            unit: it.unit, short: short,
            known: !!itemMeta(inv, kind, it.id) || have > 0
          });
        }
      }
    }
    var shortCount = 0;
    for (var t = 0; t < items.length; t++) if (items[t].short > 0) shortCount++;
    return { items: items, totalShort: shortCount, itemCount: items.length, warnings: [], from: 'local' };
  }

  /* 每次 repaint 都会问一遍"这一行够不够"，18 行的配方就是 18 次。
     缺口的入参只有配方与流水，两者一变 key 就变，所以按 key 缓存。 */
  var _cache = { key: '', data: null };

  function deficitsCached(recipe) {
    var inv = invData();
    var key = [recipe && recipe.id, recipe && recipe.updatedAt,
      inv.moves.length, inv.items.length,
      recipe && (recipe.fermentables || []).length,
      recipe && (recipe.hops || []).length].join('|');
    if (_cache.key === key && _cache.data) return _cache.data;
    _cache.key = key;
    _cache.data = computeDeficits(recipe);
    return _cache.data;
  }

  P.deficits = function (recipe) { return deficitsCached(recipe || UI.recipe()); };

  /**
   * 42 号行首徽章的唯一入口。
   * tracked=false 时一切都不显示——刚装的软件不该让每一行麦芽都顶着
   * 「✗ 缺 4kg」，那不是信息，那是噪音。
   */
  /** 单位族：kg/g 属质量、l/ml 属体积。跨族不能换算，只能报"单位不符" */
  function unitFam(u) {
    var s = String(u || '').trim().toLowerCase();
    if (s === 'kg' || s === 'g') return 'mass';
    if (s === 'l' || s === 'ml') return 'vol';
    return s;
  }

  /** 这条物料第一条流水记的是什么单位（记账单位一经写入就不该变） */
  function moveUnitOf(inv, kind, refId) {
    var k1 = keyOf(kind, refId);
    for (var i = 0; i < inv.moves.length; i++) {
      var m = inv.moves[i];
      if (!m) continue;
      var k = String(m.key || '');
      if (k === k1 || k === String(refId)) return m.unit || (KIND_META[kind] || KIND_META.malts).unit;
    }
    var it = itemMeta(inv, kind, refId);
    if (it && it.unit) return it.unit;
    return (KIND_META[kind] || KIND_META.malts).unit;
  }

  /**
   * 42 号行首徽章的入口。**四态**：
   *   {tracked:false, suppressed:true}  设置关掉了 → 什么都不显示
   *   {tracked:false}                   从没记过账 → 灰点「未录库存」
   *   {tracked:true, unitMismatch:true} 单位跨族 → 黄「单位不符」
   *   {tracked:true, enough:bool}       绿 ✓ / 红缺 X
   * "没录库存"与"缺货"必须分开：第一次打开软件库存是空的，一律红叉会劝退。
   */
  P.check = function (kind, refId, need, unit) {
    var s = store();
    var warnOn = true;
    try { warnOn = (s ? s.get('settings.lowStockWarn', true) : true) !== false; } catch (e) { warnOn = true; }
    if (!warnOn) return { tracked: false, suppressed: true };

    var inv = invData();
    var tracked = false;
    for (var i = 0; i < inv.moves.length; i++) {
      var k = String((inv.moves[i] || {}).key || '');
      if (k === keyOf(kind, refId) || k === String(refId)) { tracked = true; break; }
    }
    if (!tracked) tracked = !!itemMeta(inv, kind, refId);
    if (!tracked) return { tracked: false };

    var have = P.balanceOf(kind, refId);
    var req = num(need, 0);
    var short = req - have;
    var haveUnit = moveUnitOf(inv, kind, refId);
    var wantUnit = unit || (KIND_META[kind] || KIND_META.malts).unit;
    return {
      tracked: true,
      have: have,
      haveUnit: haveUnit,
      need: req,
      short: short > 0 ? short : 0,
      enough: short <= 0.0001,
      /* 跨族（kg vs ml）才叫不符；kg 与 g 可换算，不算 */
      unitMismatch: unitFam(haveUnit) !== unitFam(wantUnit)
    };
  };

  /* ======================================================================
   * C. 采购勾选
   * ====================================================================*/

  function shopKey(scope, kind, refId) { return scope + ':' + kind + ':' + refId; }

  function isBought(shop, scope, kind, refId) {
    return !!shop[shopKey(scope, kind, refId)];
  }

  function toggleBought(scope, kind, refId) {
    var s = store();
    if (!s) return;
    var shop = shoppingData();
    var k = shopKey(scope, kind, refId);
    if (shop[k]) delete shop[k];
    else shop[k] = Date.now();
    try { s.set('shopping', shop); } catch (e) { toast('勾选状态没存上', 'warn'); }
  }

  /* ======================================================================
   * D. 渲染
   * ====================================================================*/

  var lastMount = null;

  function refresh() {
    if (!lastMount) return;
    /* 流水变了，缓存必须失效——key 里有 moves.length，但"删一条再加一条"
       长度不变，所以这里直接清掉 */
    _cache.key = '';
    mount(lastMount.box, lastMount.opts);
  }

  P.mount = function (box, opts) { mount(box, opts); };

  /** 记过账的物料：moves 里出现过 + items 里登记过 */
  function trackedMaterials() {
    var inv = invData();
    var seen = {}, out = [];

    function add(kind, refId, name, unit) {
      if (!kind || !refId) return;
      var k = keyOf(kind, refId);
      if (seen[k]) {
        if (!seen[k].name && name) seen[k].name = name;
        return;
      }
      var ing = null;
      try { ing = UI.byId(kind, refId); } catch (e) { ing = null; }
      var meta = KIND_META[kind] || KIND_META.malts;
      var it = itemMeta(inv, kind, refId);
      seen[k] = {
        kind: kind,
        refId: refId,
        key: k,
        name: (it && it.name) || name || (ing && ing.name) || refId,
        en: (ing && ing.en) || '',
        unit: (it && it.unit) || unit || meta.unit,
        have: 0,
        threshold: 0,
        need: 0
      };
      out.push(seen[k]);
    }

    for (var i = 0; i < inv.moves.length; i++) {
      var m = inv.moves[i];
      if (!m || !m.key) continue;
      var sk = splitKey(m.key);
      add(sk.kind, sk.refId, '', m.unit);
    }
    for (var j = 0; j < inv.items.length; j++) {
      var it = inv.items[j];
      if (!it || !it.key) continue;
      var sk2 = splitKey(it.key);
      add(sk2.kind, sk2.refId, it.name || '', it.unit);
    }
    return out;
  }

  function mount(box, opts) {
    if (!box) return;
    lastMount = { box: box, opts: opts || {} };
    var recipe = UI.recipe();
    var shop = shoppingData();
    /* scope：采购勾选的作用域。换配方 → 另一张采购单。
       D5 残留：原来直接拿 recipe.id，而工作副本的 id 是临时 uid 且**每次启动都变**
       （关掉「启动时恢复上次编辑」之后尤其明显），于是勾选状态刷新就丢，
       存储里还会留一堆孤儿键（r-xxx:malts:m-2row）。
       改成走 Store.labelKeyOf 的同一套判定：库里有没有这个 id ——
       有就用真 id，没有就一律落到 '__draft__'（与酒标共用同一个占位键，
       不要各造一个，否则下次又要迁移两套）。 */
    var scope = 'inv';
    try {
      var S = BREW.Store;
      if (S && typeof S.labelKeyOf === 'function') scope = S.labelKeyOf(recipe) || 'inv';
      else if (recipe && recipe.id) scope = String(recipe.id);
    } catch (e) { scope = (recipe && recipe.id) ? String(recipe.id) : 'inv'; }

    var defs = deficitsCached(recipe);
    var mats = trackedMaterials();
    /* 余额表要显示"本批需要"，从缺口表里取（那边已经按 kind+id 聚合过） */
    var needMap = {};
    for (var i = 0; i < defs.items.length; i++) {
      var d = defs.items[i];
      needMap[d.kind + '|' + d.id] = d;
    }
    for (var j = 0; j < mats.length; j++) {
      var hit = needMap[mats[j].kind + '|' + mats[j].refId];
      mats[j].need = hit ? num(hit.need, 0) : 0;
      mats[j].have = P.balanceOf(mats[j].kind, mats[j].refId);
      mats[j].threshold = thresholdOf(invData(), mats[j].kind, mats[j].refId);
    }

    /* 两个页签各管一件事（v1.2 修 D6）：
       「库存」= 我现在有多少（余额表 + 出入库记账）
       「采购」= 这锅还差什么（缺口清单 + 勾选）
       原来两处都渲染了全部两块，于是两个页签点起来一模一样，用户会以为页签坏了。
       现在按 opts.mode 分开；opts.mode 缺失（别处直接调 mount）时两块都出，
       因为那时候没有页签语境，全给出来反而更安全。 */
    var mode = (opts && opts.mode) ? String(opts.mode) : '';
    box.innerHTML = '<div class="inv-wrap">' +
      (mode === 'shopping' ? '' : sectionStock(mats, defs)) +
      (mode === 'stock' ? '' : sectionShopping(defs, shop, scope, recipe)) +
      '</div>';

    /* 事件全部委托到面板根节点：每次 mount 都会重写 innerHTML，
       给按钮单独绑监听等于每次都要重绑一遍 */
    if (!box.__invBound) {
      box.__invBound = true;
      box.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;

        var mv = t.closest ? t.closest('[data-inv]') : null;
        if (mv) {
          var act = mv.getAttribute('data-inv');
          if (act === 'move') {
            openMove({
              kind: mv.getAttribute('data-kind') || 'malts',
              refId: mv.getAttribute('data-ref') || '',
              dir: mv.getAttribute('data-dir') || 'in'
            });
          } else if (act === 'new-move') {
            openMove({ dir: 'in' });
          }
          return;
        }

        var chk = t.closest ? t.closest('[data-buy]') : null;
        if (chk) {
          var v = chk.getAttribute('data-buy');
          if (!v) return;
          var seg = v.split('|');
          toggleBought(seg[0], seg[1], seg[2]);
          refresh();
        }
      });
    }
  }

  /** 账面为负的物料（v1.2 补 33 的 negative 字段的出口）。
      为什么单列一块、而不是混进"缺货"：这两件事的处置**相反**。
      缺货 = 该去买；账面为负 = 先别买，去盘点（入库漏了、出库记重了）。
      混在一起用户会照着"建议购买"再买一遍，账面越买越乱。
      33 那边已经保证 short 不会因为负数被放大，这里只负责把话说清楚。 */
  function negativeBlock(defs) {
    var list = (defs && defs.negative) || null;
    if (!list || !list.length) return '';
    var items = '';
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      items += '<li><b>' + esc(n.name) + '</b> 账面 ' +
        esc(fmt(n.balance, n.unit === 'kg' ? 2 : 0)) + ' ' + esc(n.unit) + '</li>';
    }
    return '<div class="alert alert--warn inv-negative" style="margin:0 0 12px">' +
        '<span class="alert__icon">' + icon('alert', 13) + '</span>' +
        '<span><b>有 ' + list.length + ' 项库存账面为负，先盘点再采购。</b>' +
          '负数通常是入库漏记或出库记重；下面的采购量已经不会因此被放大，' +
          '但余额本身是错的，建议先核对。' +
          '<ul style="margin:6px 0 0 18px">' + items + '</ul></span>' +
      '</div>';
  }

  function sectionStock(mats, defs) {
    var rows = '';
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      var low = m.have <= 0.0001 || m.have < m.threshold;
      rows += '<tr class="' + (m.have <= 0.0001 ? 'inv-row--empty' : low ? 'inv-row--low' : '') + '">' +
        '<td><b>' + esc(m.name) + '</b>' +
          (m.en ? '<div class="u-xs u-dim">' + esc(m.en) + '</div>' : '') +
        '</td>' +
        '<td class="u-nowrap u-sm u-dim">' + esc(KIND_META[m.kind].label) + '</td>' +
        '<td class="num"><span class="inv-have u-mono' + (low ? ' is-low' : '') + '">' +
          esc(fmt(m.have, m.unit === 'kg' ? 2 : 0)) + '</span>' +
          '<span class="u-dim u-xs"> ' + esc(m.unit) + '</span></td>' +
        '<td class="num u-mono u-sm u-dim">' + esc(fmt(m.threshold, m.unit === 'kg' ? 2 : 0)) + ' ' +
          esc(m.unit) + '</td>' +
        '<td class="num u-sm u-dim">' +
          (m.need > 0 ? esc(fmt(m.need, m.unit === 'kg' ? 2 : 0)) + ' ' + esc(m.unit) : '—') + '</td>' +
        '<td class="col-act u-nowrap">' +
          '<button type="button" class="btn btn-quiet btn-xs" data-inv="move" data-dir="in" ' +
            'data-kind="' + attr(m.kind) + '" data-ref="' + attr(m.refId) + '" ' +
            'aria-label="记入库：' + attr(m.name) + '">入库</button>' +
          '<button type="button" class="btn btn-quiet btn-xs" data-inv="move" data-dir="out" ' +
            'data-kind="' + attr(m.kind) + '" data-ref="' + attr(m.refId) + '" ' +
            'aria-label="记出库：' + attr(m.name) + '">出库</button>' +
        '</td>' +
        '</tr>';
    }

    var body = rows || ('<tr><td colspan="6">' + UI.emptyState('还没有记过任何物料',
      '点右上角「记一笔出入库」把手上有的料录进来；之后配方页每一行都会显示够不够。',
      { small: true, size: 48 }) + '</td></tr>');

    return negativeBlock(defs) + '<div class="inv-head">' +
        '<h3 class="inv-head__title">物料余额</h3>' +
        '<span class="u-xs u-dim">余额 = 所有出入库流水之和，实时计算，不单独存</span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-inv="new-move">' +
          icon('plus', 12) + '记一笔出入库</button>' +
      '</div>' +
      '<div class="table-wrap"><table class="table table--compact inv-table">' +
        '<thead><tr>' +
          '<th style="min-width:170px">原料</th>' +
          '<th style="width:110px">品类</th>' +
          '<th class="u-right" style="width:104px">当前余额</th>' +
          '<th class="u-right" style="width:104px">补货阈值</th>' +
          '<th class="u-right" style="width:100px">本批需要</th>' +
          '<th class="col-act" style="width:132px"></th>' +
        '</tr></thead>' +
        '<tbody>' + body + '</tbody>' +
      '</table></div>';
  }

  /** 采购项：优先用 33 号的 purchaseList（它按品类取整），没有就地按步长取整 */
  function purchaseItems(defs) {
    if (BREW.Inventory && typeof BREW.Inventory.purchaseList === 'function') {
      try {
        var list = BREW.Inventory.purchaseList(defs);
        if (Array.isArray(list)) return list;
      } catch (e) { /* 落到下面 */ }
    }
    var out = [];
    for (var i = 0; i < defs.items.length; i++) {
      var it = defs.items[i];
      if (!(it.short > 0)) continue;
      var meta = KIND_META[it.kind] || KIND_META.malts;
      var step = num(meta.step, 1);
      out.push({
        kind: it.kind, id: it.id, name: it.name,
        qty: Math.max(step, Math.ceil((it.short - 1e-9) / step) * step),
        exact: it.short, unit: it.unit
      });
    }
    return out;
  }

  function qtyText(v, unit) {
    return fmt(v, String(unit).toLowerCase() === 'kg' ? 2 : 0) + ' ' + unit;
  }

  function sectionShopping(defs, shop, scope, recipe) {
    var buys = purchaseItems(defs);

    if (!buys.length) {
      var none = !defs.items.length || !(recipe && (recipe.fermentables || []).length);
      return '<div class="inv-head mt-16"><h3 class="inv-head__title">采购清单</h3></div>' +
        '<div class="alert alert--ok" style="margin:12px 14px">' +
          '<span class="alert__icon">' + icon('check', 13) + '</span>' +
          '<span>' + (none
            ? '当前配方还没有原料，先到配方页加几行。'
            : '当前配方的原料按记录都不缺，可以直接开酿。') + '</span></div>';
    }

    /* 需求表里"没入库"的项单独标出来：known=false 不等于缺货 */
    var unknownMap = {};
    for (var u = 0; u < defs.items.length; u++) {
      if (!defs.items[u].known) unknownMap[defs.items[u].kind + '|' + defs.items[u].id] = true;
    }

    var done = 0;
    for (var c = 0; c < buys.length; c++) if (isBought(shop, scope, buys[c].kind, buys[c].id)) done++;

    var html = '<div class="inv-head mt-16">' +
        '<h3 class="inv-head__title">采购清单</h3>' +
        '<span class="u-xs u-dim">' + buys.length + ' 项待买，已勾选 ' + done + '</span>' +
        '<span class="spacer"></span>' +
        (defs.from === 'local'
          ? '<span class="u-xs" style="color:var(--warn)">缺口按简化口径估算（33 号模块未载入）</span>'
          : '<span class="u-xs u-dim">勾选状态记在本机</span>') +
      '</div>';

    for (var o = 0; o < KIND_ORDER.length; o++) {
      var kind = KIND_ORDER[o];
      var items = [];
      for (var i = 0; i < buys.length; i++) if (buys[i].kind === kind) items.push(buys[i]);
      if (!items.length) continue;

      var rows = '';
      for (var j = 0; j < items.length; j++) {
        var b = items[j];
        var bought = isBought(shop, scope, b.kind, b.id);
        var exact = (b.exact !== undefined) ? num(b.exact, 0) : num(b.qty, 0);
        var notTracked = isUntracked(b, unknownMap);
        rows += '<tr class="' + (bought ? 'buy-row--done' : '') + '">' +
          '<td class="col-act" style="width:34px">' +
            '<button type="button" class="buy-check' + (bought ? ' is-on' : '') + '" ' +
              'data-buy="' + attr(scope + '|' + b.kind + '|' + (b.id || '')) + '" ' +
              'aria-pressed="' + (bought ? 'true' : 'false') + '" ' +
              'aria-label="' + attr((bought ? '取消勾选：' : '标记已买：') + b.name) + '">' +
              (bought ? icon('check', 11) : '') + '</button>' +
          '</td>' +
          '<td><b>' + esc(b.name) + '</b>' +
            (notTracked ? '<div class="u-xs u-dim">未入库 · 按 0 计算</div>' : '') +
          '</td>' +
          '<td class="num u-mono"><span class="buy-short">' +
            esc(qtyText(exact, b.unit)) + '</span></td>' +
          '<td class="num u-mono u-sm u-dim">' + esc(qtyText(b.qty, b.unit)) + '</td>' +
          '</tr>';
      }

      html += '<div class="buy-group">' +
        '<div class="buy-group__head">' + esc(KIND_META[kind].label) +
        '<span class="u-dim u-xs"> · ' + items.length + ' 项</span></div>' +
        '<div class="table-wrap"><table class="table table--compact buy-table">' +
        '<thead><tr><th style="width:34px"></th><th>原料</th>' +
        '<th class="u-right" style="width:130px">缺口</th>' +
        '<th class="u-right" style="width:150px">建议购买</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>';
    }

    html += '<p class="u-xs u-dim" style="padding:10px 14px 14px;line-height:1.65">' +
      '建议购买量按品类取整：麦芽 0.5 kg、酒花 10 g、酵母按 11 g/包。' +
      '清单只算当前配方的缺口——多批共用的原料请分开核对。' +
      '「未入库」表示这个原料你还没录过库存，不代表确实是 0。</p>';
    return html;
  }

  function isUntracked(b, unknownMap) {
    return !!unknownMap[b.kind + '|' + (b.id || '')];
  }

  /* ======================================================================
   * E. 记一笔出入库
   * ====================================================================*/

  function poolOptions(selectedKind, selectedRef) {
    var html = '';
    for (var o = 0; o < KIND_ORDER.length; o++) {
      var kind = KIND_ORDER[o];
      var list = UI.pool(kind);
      if (!list.length) continue;
      html += '<optgroup label="' + attr(KIND_META[kind].label) + '">';
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var val = kind + ':' + it.id;
        var sel = (kind === selectedKind && it.id === selectedRef) ? ' selected' : '';
        html += '<option value="' + attr(val) + '"' + sel + '>' + esc(it.name || it.id) + '</option>';
      }
      html += '</optgroup>';
    }
    return html;
  }

  /** 记一笔的默认单位：优先跟配方行上的单位一致，否则用品类记账单位。
   *  辅料有 g 也有 ml，单位对不上的话 33 号会按"不能换算"处理，缺口头算成 0。 */
  function unitFor(kind, refId) {
    var r = UI.recipe();
    var rows = r ? r[ROW_KEY[kind]] : null;
    if (Array.isArray(rows)) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].id === refId && rows[i].unit) return rows[i].unit;
      }
    }
    return (KIND_META[kind] || KIND_META.malts).unit;
  }

  /**
   * 顺手在 inventory.items 里维护一条物料档案（名称 / 单位 / 阈值）。
   * `qty` 只是让人打开 JSON 时看得懂的缓存，**余额永远由 Σdelta 算**——
   * 任何地方读 qty 当余额，都会在 items 与 moves 不同步时给出错数。
   */
  function upsertItem(s, kind, refId, unit) {
    if (!s || !kind || !refId) return;
    var inv = invData();
    var list = inv.items.slice();
    var ing = null;
    try { ing = UI.byId(kind, refId); } catch (e) { ing = null; }
    var name = (ing && ing.name) || refId;
    var hit = -1;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].key === keyOf(kind, refId)) { hit = i; break; }
    var row = {
      key: keyOf(kind, refId),
      kind: kind,
      refId: refId,
      name: name,
      /* 单位一经写入不改：改了就等于把历史流水重新解释一遍 */
      unit: (hit > -1 && list[hit].unit) ? list[hit].unit : unit,
      qty: P.balanceOf(kind, refId),          /* 缓存快照，不参与计算 */
      par: (hit > -1 && list[hit].par !== undefined) ? list[hit].par : thresholdOf(inv, kind, refId),
      updatedAt: Date.now()
    };
    if (hit > -1) list[hit] = row; else list.push(row);
    try { s.set('inventory.items', list); } catch (e2) { /* items 是可选档案，写不进去不影响流水 */ }
  }

  /**
   * 出入库表单。写入一条 moves 记录：
   *   { id, at, key, delta, unit, reason:'purchase'|'adjust', note }
   * delta 带符号（入库正、出库负），余额永远由流水求和得出。
   */
  function openMove(pre) {
    pre = pre || {};
    var dir = pre.dir === 'out' ? 'out' : 'in';
    if (!UI.Shell || typeof UI.Shell.modal !== 'function') return;

    UI.Shell.modal({
      title: '记一笔出入库',
      sub: '入库为正、出库为负；余额永远由流水求和，不单独存',
      size: 'narrow',
      body:
        '<div class="field">' +
          '<label class="field__label" for="iv-mat">物料</label>' +
          '<select class="select" id="iv-mat">' + poolOptions(pre.kind, pre.refId) + '</select>' +
        '</div>' +
        '<div class="grid-2 mt-12">' +
          '<div class="field">' +
            '<label class="field__label" for="iv-dir">方向</label>' +
            '<select class="select" id="iv-dir">' +
              '<option value="in"' + (dir === 'in' ? ' selected' : '') + '>入库（买进来）</option>' +
              '<option value="out"' + (dir === 'out' ? ' selected' : '') + '>出库（用掉了）</option>' +
            '</select>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="iv-qty">数量</label>' +
            '<div class="input-wrap">' +
              '<input class="input input--num" id="iv-qty" type="number" min="0" step="0.1" value="1">' +
              '<span class="input-wrap__unit" id="iv-unit">kg</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="field mt-12">' +
          '<label class="field__label" for="iv-note">备注（可选）</label>' +
          '<input class="input" id="iv-note" type="text" placeholder="例如：麦芽 5kg 一袋 / 这批 IPA 用完" maxlength="60">' +
        '</div>',
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '记下来', kind: 'primary',
          act: function (api) {
            var sel = api.query('#iv-mat');
            var qtyEl = api.query('#iv-qty');
            var dirEl = api.query('#iv-dir');
            var noteEl = api.query('#iv-note');
            if (!sel || !qtyEl) return false;

            var parts = String(sel.value || '').split(':');
            var kind = parts[0], refId = parts.slice(1).join(':');
            if (!KIND_META[kind] || !refId) { toast('先选一个物料', 'warn'); return false; }

            var qty = num(qtyEl.value, 0);
            if (!(qty > 0)) { toast('数量要大于 0', 'warn'); return false; }

            var outDir = (dirEl && dirEl.value === 'out');
            var mUnit = unitFor(kind, refId);
            var move = {
              id: 'mv-' + Date.now().toString(36) + '-' + (invData().moves.length + 1),
              /* key 是主键；kind/refId 拆开写一份，读端不必再解析字符串 */
              key: keyOf(kind, refId),
              kind: kind,
              refId: refId,
              at: Date.now(),
              /* delta 是唯一的量表示，且带符号：入库正、出库负。
                 不要再写 qty+dir，两套表示并存时读端只能猜。 */
              delta: outDir ? -qty : qty,
              unit: mUnit,
              reason: outDir ? 'adjust' : 'purchase',
              batchId: null,
              note: noteEl ? String(noteEl.value || '').slice(0, 60) : ''
            };

            var s = store();
            if (!s) { toast('存储不可用，记不了账', 'error'); return false; }
            var inv2 = invData();
            var list = inv2.moves.slice();
            list.push(move);
            try {
              s.set('inventory.moves', list);
              upsertItem(s, kind, refId, mUnit);
            } catch (e) {
              toast('写入失败：' + ((e && e.message) || '未知错误'), 'error');
              return false;
            }
            toast((outDir ? '已记出库 ' : '已记入库 ') + fmt(qty, 2) + ' ' + move.unit, 'ok');
            refresh();
            /* 配方页的行首徽章也跟着变 */
            if (BREW.Bus && BREW.Bus.emit) BREW.Bus.emit('inventoryChanged', { move: move });
          }
        }
      ],
      onMount: function (api) {
        /* 单位跟着物料走：让人知道现在填的是 kg 还是 g，而不是回头自己换算 */
        function syncUnit() {
          var sel = api.query('#iv-mat');
          var unitEl = api.query('#iv-unit');
          if (!sel || !unitEl) return;
          var parts = String(sel.value || '').split(':');
          unitEl.textContent = unitFor(parts[0], parts.slice(1).join(':'));
        }
        var sel = api.query('#iv-mat');
        if (sel) sel.addEventListener('change', syncUnit);
        syncUnit();
      }
    });
  }

})(typeof window !== 'undefined' ? window : globalThis);
