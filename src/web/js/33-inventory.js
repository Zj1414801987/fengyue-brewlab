/* ============================================================================
 * 风月酿研所 — 33 库存与采购（Inventory）
 * ----------------------------------------------------------------------------
 * 职责：算「这个配方还缺多少料」，以及按品类聚合成采购清单。
 *
 * 设计原则（三个明确不做的事）：
 *   1. 不做自动扣减。配方改了、批次取消了、酿失败了——自动扣减都要回滚，
 *      而这个项目没有撤销栈。改成手动「记入库 / 记出库」+「按此配方出库」，
 *      算错了用户自己改得回来。
 *   2. 不猜单位。麦芽存 kg、酒花存 g、酵母存包；跨单位只在计算时换算，
 *      换算不了（ml 对 g）就明说"单位不一致"，不要硬算成一个数。
 *   3. 不把"没入库"当成"缺货"。没记录过的原料 known=false，界面要能把
 *      「你还没录库存」和「你确实不够了」分开显示——否则第一次打开全是红叉。
 *
 * 纯度：只吃入参、只吐返回值。不读 DOM / Store，不取当前时间。
 *
 * 前置依赖：00-core（可选）
 * 加载位置：应在 js/30-recipe.js 之后、js/35-batch.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var Inventory = BREW.Inventory = {};

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

  var KINDS = ['malts', 'hops', 'yeasts', 'adjuncts'];

  var KIND_META = {
    malts: { label: '麦芽与谷物', needKey: 'fermentables', unit: 'kg', step: 0.5, d: 3 },
    hops: { label: '酒花', needKey: 'hops', unit: 'g', step: 10, d: 1 },
    yeasts: { label: '酵母', needKey: 'yeasts', unit: 'g', step: 1, d: 1 },
    adjuncts: { label: '辅料', needKey: 'adjuncts', unit: 'g', step: 10, d: 1 }
  };

  /* 可互换的单位（质量 / 体积）。不在这张表里的一律不换算 */
  var UNIT_FAMILY = {
    kg: { fam: 'mass', toBase: 1000 },
    g: { fam: 'mass', toBase: 1 },
    l: { fam: 'vol', toBase: 1000 },
    ml: { fam: 'vol', toBase: 1 }
  };

  function normUnit(u) {
    return String(u === null || u === undefined ? '' : u).trim().toLowerCase();
  }

  /**
   * 把 qty（单位 from）换算成 unit。
   * @returns {number|null} 不能换算时返回 null（不要静默返回原数）
   */
  function convert(qty, from, to) {
    var a = UNIT_FAMILY[normUnit(from)];
    var b = UNIT_FAMILY[normUnit(to)];
    if (!a || !b) return normUnit(from) === normUnit(to) ? U.toNum(qty, 0) : null;
    if (a.fam !== b.fam) return null;
    return U.toNum(qty, 0) * a.toBase / b.toBase;
  }

  /**
   * 从一条库存记录里取出 { kind, id }。
   *
   * 字段契约（team-lead 冻结 v1.2）：
   *   item.key = kind + ':' + refId（主键）；item 必有 kind / refId / unit
   *   move 必有 delta（带符号，入库正、出库负）/ unit / key|kind+refId
   * **主键以 key 为准**，key 与 kind+refId 不一致时按 key 修正。
   *
   * 下面这段取值链里，refId 之后那几个别名是**临时兼容**：
   * 00-core 的 normalizeInventory 落地后只认 kind / refId，届时删掉别名分支。
   * （宽容读取的失败模式是"库存静默算成 0"，只能当止损手段，不能当方案。）
   */
  function idOf(e) {
    if (!e) return null;
    var key = String(e.key || '');
    var parts = key.split(':');
    /* key 是主键：有 key 就以它为准 */
    var kind = (parts.length >= 2 && parts[0]) ? parts[0] : e.kind;
    var id = (parts.length >= 2 && parts[1]) ? parts[1]
      : (e.refId || e.ingId || e.ingredientId || e.id || '');
    if (!kind || !id) return null;
    return { kind: String(kind), id: String(id) };
  }

  /**
   * 把库存整理成 map：'kind|id' → {qty, unit}
   *
   * 形状（v1.2 冻结）：{ items:[…], moves:[…] }
   *   **余额 = Σ moves.delta**，items[].qty 是缓存快照，读端**不许**拿它算余额。
   *   两个都加会把同一笔出入库算两遍（v1.2 第一版就是这个 bug）。
   *   items 只贡献 unit（以及"这条原料存在"这个事实）。
   *
   * 另外两种形状（{malts:{id:{qty}}} / {malts:[{id,qty}]}）是**临时兼容**，
   * 等 normalizeInventory 上线后删除 —— 两套形状长期并存就是下一个"哪个优先"。
   *
   * @returns {{map:object, warnings:string[]}}
   */
  function indexInventory(inv) {
    var map = {};
    var warnings = [];
    if (!inv) return { map: map, warnings: warnings };

    if (Array.isArray(inv.items) || Array.isArray(inv.moves)) {
      var ensure = function (kind, id, unit) {
        var k = kind + '|' + id;
        if (!map[k]) map[k] = { qty: 0, unit: unit || (KIND_META[kind] || {}).unit || 'g' };
        else if (unit) map[k].unit = unit;
        return map[k];
      };

      /* 1) items：只取 unit，不取 qty（qty 是缓存，见上） */
      (inv.items || []).forEach(function (it) {
        if (!it) return;
        var p = idOf(it);
        if (!p) return;
        ensure(p.kind, p.id, it.unit);
      });

      /* 2) moves：唯一权威。delta 必须带符号 */
      var legacyWarned = false;
      (inv.moves || []).forEach(function (m) {
        if (!m) return;
        var p = idOf(m);
        if (!p) return;
        var entry = ensure(p.kind, p.id, m.unit);
        var delta;
        if (isFinite(parseFloat(m.delta))) {
          delta = U.toNum(m.delta, 0);
        } else {
          /* 旧格式兜底：qty + dir/type。不是静默容忍——每次都报，让数据方修 */
          var q = U.toNum(m.qty !== undefined ? m.qty : m.amount, 0);
          var dir = String(m.dir || m.type || m.sign || '').toLowerCase();
          var out = (dir === 'out' || dir === 'consume' || dir === 'use' || dir === '-' || m.sign === -1);
          delta = out ? -Math.abs(q) : Math.abs(q);
          if (!legacyWarned) {
            warnings.push('有流水缺少带符号的 delta（按 qty+dir 解释）。' +
              '新格式要求 delta 为唯一量表示，请在写入端修正');
            legacyWarned = true;
          }
        }
        /* 单位冲突：契约要求 move.unit === item.unit，读端不换算，只报 */
        if (m.unit && entry.unit && normUnit(m.unit) !== normUnit(entry.unit)) {
          warnings.push('同一原料出现两种单位（' + entry.unit + ' / ' + m.unit +
            '）：' + p.id + '。按写入端的第一个单位计，不做换算');
        }
        entry.qty += delta;
      });

      return { map: map, warnings: warnings };
    }

    /* ---- 临时兼容：余额形状（normalizeInventory 上线后删） ---- */
    KINDS.forEach(function (kind) {
      var bucket = inv[kind];
      if (!bucket) return;
      if (Array.isArray(bucket)) {
        for (var i = 0; i < bucket.length; i++) {
          var it = bucket[i] || {};
          if (!it.id) continue;
          map[kind + '|' + it.id] = { qty: U.toNum(it.qty !== undefined ? it.qty : it.amount, 0), unit: it.unit || KIND_META[kind].unit };
        }
      } else if (typeof bucket === 'object') {
        for (var id in bucket) {
          if (!Object.prototype.hasOwnProperty.call(bucket, id)) continue;
          var v = bucket[id];
          if (v === null || v === undefined) continue;
          if (typeof v === 'number') {
            map[kind + '|' + id] = { qty: v, unit: KIND_META[kind].unit };
          } else {
            map[kind + '|' + id] = {
              qty: U.toNum(v.qty !== undefined ? v.qty : v.amount, 0),
              unit: v.unit || KIND_META[kind].unit
            };
          }
        }
      }
    });

    /* 临时兼容分支的返回（normalizeInventory 上线后整段删除） */
    return { map: map, warnings: warnings };
  }

  /* ======================================================================
   * 主函数：需求 vs 库存
   * ----------------------------------------------------------------------
   * @param {object} recipe 配方对象
   * @param {object} inv    v1.2 冻结形状 { items:[…], moves:[…] }
   *                        （临时兼容 { malts:{id:{qty}} } / { malts:[{id,qty}] }）
   * @returns {{
   *   items:Array<{kind,id,name,need,have,unit,short,known,unitMismatch}>,
   *   byKind:object, totalShort:number, itemCount:number, warnings:string[],
   *   negative:Array<{key,kind,id,name,balance,unit}>
   * }}
   *   known=false 表示"库存里没有这条记录"，不等于缺货；
   *   界面必须区分这两种状态，否则第一次用全是红叉。
   *   have 保留真实值（可以是负数），short 按 max(0,have) 算；
   *   负数同时进 negative 与 warnings —— 既不放大采购量，也不把问题藏起来。
   * ====================================================================*/
  Inventory.deficits = function (recipe, inv) {
    recipe = recipe || {};
    var idx = indexInventory(inv);
    var map = idx.map;
    var warnings = idx.warnings || [];
    var items = [];
    var byKind = {};
    var negative = [];
    var rowName = {};                 /* 'kind|id' → 配方里那一行的名字 */

    /* 同一原料在配方里可能分两行加（例如分批投放），先按 kind+id 聚合需求 */
    for (var k = 0; k < KINDS.length; k++) {
      var kind = KINDS[k];
      var meta = KIND_META[kind];
      var rows = recipe[meta.needKey] || [];
      var agg = {}, order = [];

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row) continue;
        var need = U.toNum(row.amount, 0);
        if (!(need > 0)) continue;
        var key = row.id || ('name:' + (row.name || ''));
        if (!agg[key]) {
          agg[key] = {
            kind: kind,
            id: row.id || '',
            name: row.name || '',
            need: 0,
            unit: row.unit || meta.unit
          };
          order.push(key);
        }
        agg[key].need += need;
      }

      var shortCount = 0;
      for (var j = 0; j < order.length; j++) {
        var it = agg[order[j]];
        var hit = it.id ? map[kind + '|' + it.id] : null;
        var have = 0, known = !!hit, mismatch = false;

        if (hit) {
          var cv = convert(hit.qty, hit.unit, it.unit);
          if (cv === null) {
            mismatch = true;
            have = 0;
            warnings.push(it.name + '：库存单位「' + hit.unit + '」与配方单位「' + it.unit +
              '」不能换算，按库存 0 计算');
          } else {
            have = cv;
          }
        }

        /* **账面负数不能放大短缺**：出库记多了、盘亏、导入脏数据都会让余额变负。
           have=-4、need=5 时，直接用 need-have 会得到 9（多买 4 公斤）；
           实际只差 5。所以短缺按 max(0, have) 算。
           但负数**不糊成 0**：它在下面「整仓扫一遍」里统一报出来——
           不能只在这个循环里报，理由见 negative 那一段的注释。 */
        var usable = Math.max(0, have);
        var short = Math.max(0, it.need - usable);
        if (short > 1e-9) shortCount++;

        /* 顺手把"配方里这一行的名字"记下来，整仓扫描时优先用它（比 id 好看） */
        if (it.id) rowName[kind + '|' + it.id] = it.name || '';

        items.push({
          kind: kind,
          id: it.id,
          name: it.name || '（未命名原料）',
          need: U.round(it.need, meta.d),
          have: U.round(have, meta.d),
          unit: it.unit,
          short: U.round(short, meta.d),
          known: known,
          unitMismatch: mismatch
        });
      }

      byKind[kind] = {
        label: meta.label,
        unit: meta.unit,
        items: order.length,
        short: shortCount
      };
    }

    var totalShort = 0;
    for (var t = 0; t < items.length; t++) if (items[t].short > 0) totalShort++;

    /* ==================================================================
     * 账面负数：**整仓扫一遍**，不是在"配方行循环"里顺手报
     * ----------------------------------------------------------------
     * 老实现把这段写在配方行的循环里，于是三个漏报（都发生过）：
     *   ① 原料不在当前配方里 → 根本不会进循环 → 负余额看不见。
     *      而"先盘点再采购"说的是**整仓**的事，跟当前打开哪个配方无关；
     *   ② 单位不能换算（配方写 g、库存记 kg 且不认识）→ have 被置 0，
     *      负数被"归零"，告警跟着消失；
     *   ③ 只在某一种入参形状下生效的错觉：两种形状（{items,moves} 与
     *      预计算余额表）最后都汇进同一个 map，所以扫描必须放在 map 上，
     *      而不是放在"哪种形状走哪个分支"上。
     * 这里只认 map（余额），不看配方。
     * ==================================================================*/
    function dbName(kind, id) {
      try {
        var pool = (BREW.DB && BREW.DB[kind]) || null;
        if (!pool || !id) return '';
        for (var q = 0; q < pool.length; q++) if (pool[q] && pool[q].id === id) return pool[q].name || '';
      } catch (e) { /* 数据缺失就当没名字 */ }
      return '';
    }

    var negKeys = [];
    for (var nk in map) if (Object.prototype.hasOwnProperty.call(map, nk)) negKeys.push(nk);
    negKeys.sort();                    /* 稳定顺序：自检与界面都好对 */
    for (var nq = 0; nq < negKeys.length; nq++) {
      var nkey = negKeys[nq];
      var ent = map[nkey] || {};
      var bal = U.toNum(ent.qty, 0);
      if (!(bal < -1e-9)) continue;
      var bar = nkey.indexOf('|');
      var nKind = bar < 0 ? '' : nkey.slice(0, bar);
      var nId = bar < 0 ? nkey : nkey.slice(bar + 1);
      var nMeta = KIND_META[nKind] || KIND_META.adjuncts;
      var nName = rowName[nkey] || dbName(nKind, nId) || nId || '（未命名原料）';
      var nUnit = ent.unit || nMeta.unit;
      negative.push({
        /* key 用项目的库存键约定 `kind:refId`（与 Store / 47 的 keyOf 一致），
           不是入参 map 内部的 `kind|refId`——这个分隔符是 33 的内部实现细节，
           不该泄到返回值里。 */
        key: nKind + ':' + nId,
        kind: nKind,
        id: nId,
        name: nName,
        balance: U.round(bal, nMeta.d),
        unit: nUnit
      });
      warnings.push(nName + ' 库存账面为负（' + U.round(bal, nMeta.d) + ' ' + nUnit +
        '）：多半是入库/出库记错了，建议先盘点');
    }

    return {
      items: items,
      byKind: byKind,
      totalShort: totalShort,
      itemCount: items.length,
      warnings: warnings,
      /* 账面为负的条目：47 要单独显示「先盘点」，不要混进"缺货"里 */
      negative: negative
    };
  };

  /* ======================================================================
   * 采购清单
   * ----------------------------------------------------------------------
   * 只列真缺的；按品类合并；建议量向上取整到便于采购的刻度
   * （麦芽 0.5kg、酒花/辅料 10g、酵母 1 单位）。
   * 需求恰好等于库存 → short=0 → **不出现在清单里**。
   * ====================================================================*/
  Inventory.purchaseList = function (deficits) {
    var list = (deficits && deficits.items) ? deficits.items : (Array.isArray(deficits) ? deficits : []);
    var agg = {}, order = [];

    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || !(it.short > 0)) continue;
      var key = it.kind + '|' + (it.id || it.name);
      var meta = KIND_META[it.kind] || KIND_META.adjuncts;
      if (!agg[key]) {
        agg[key] = { kind: it.kind, id: it.id || '', name: it.name, qty: 0, unit: it.unit || meta.unit };
        order.push(key);
      }
      agg[key].qty += it.short;
    }

    var out = [];
    for (var j = 0; j < order.length; j++) {
      var a = agg[order[j]];
      var meta2 = KIND_META[a.kind] || KIND_META.adjuncts;
      var step = meta2.step || 1;
      var qty = Math.ceil((a.qty - 1e-9) / step) * step;
      if (qty <= 0) qty = step;                 /* 还差一点也要买一个最小包装 */
      out.push({
        kind: a.kind,
        id: a.id,
        name: a.name,
        qty: U.round(qty, meta2.d),
        unit: a.unit,
        exact: U.round(a.qty, meta2.d)
      });
    }

    /* 按品类排序：麦芽 → 酒花 → 酵母 → 辅料 */
    out.sort(function (x, y) {
      var ix = KINDS.indexOf(x.kind), iy = KINDS.indexOf(y.kind);
      return ix - iy;
    });

    return out;
  };

  /** 某条原料的库存状态，供配方行内联徽章用（42-ui-recipe 调用） */
  Inventory.statusOf = function (deficits, kind, id) {
    var items = (deficits && deficits.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === kind && items[i].id === id) return items[i];
    }
    return null;
  };

  /* ======================================================================
   * 自检
   * ====================================================================*/
  Inventory.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    var recipe = {
      name: '测试配方',
      fermentables: [
        { id: 'm-2row', name: '淡色艾尔', amount: 5, unit: 'kg' },
        { id: 'm-c40', name: '结晶40', amount: 0.4, unit: 'kg' }
      ],
      hops: [{ id: 'h-citra', name: '西楚', amount: 30, unit: 'g' }],
      yeasts: [{ id: 'y-us05', name: 'US-05', amount: 11, unit: 'g' }],
      adjuncts: []
    };

    /* 1. 正常：够 / 不够 / 没记录 */
    var inv1 = { malts: { 'm-2row': { qty: 3, unit: 'kg' }, 'm-c40': { qty: 0.4, unit: 'kg' } } };
    var d1 = Inventory.deficits(recipe, inv1);
    var m2 = Inventory.statusOf(d1, 'malts', 'm-2row');
    var c40 = Inventory.statusOf(d1, 'malts', 'm-c40');
    var citra = Inventory.statusOf(d1, 'hops', 'h-citra');
    ok('缺 2kg 麦芽', m2 && Math.abs(m2.short - 2) < 1e-9, m2 && String(m2.short));
    ok('刚好够 → short 0', c40 && c40.short === 0);
    ok('没记录 → known=false', citra && citra.known === false);

    /* 2. 需求恰好等于库存 → 不进采购清单 */
    var list1 = Inventory.purchaseList(d1);
    ok('刚好够的原料不在采购清单里',
      !list1.some(function (x) { return x.id === 'm-c40'; }), JSON.stringify(list1));
    ok('缺的原料在清单里', list1.some(function (x) { return x.id === 'm-2row'; }));

    /* 3. 采购量向上取整到 0.5kg */
    var m2Buy = list1.filter(function (x) { return x.id === 'm-2row'; })[0];
    ok('2kg 缺口 → 建议买 2kg（0.5 的整数倍）',
      m2Buy && Math.abs(m2Buy.qty - 2) < 1e-9, m2Buy && String(m2Buy.qty));

    /* 4. 单位换算：库存 g、需求 kg */
    var d2 = Inventory.deficits(recipe, { malts: { 'm-2row': { qty: 6000, unit: 'g' } } });
    var m2b = Inventory.statusOf(d2, 'malts', 'm-2row');
    ok('6000g 换算成 6kg', m2b && Math.abs(m2b.have - 6) < 1e-9, m2b && String(m2b.have));
    ok('换算后不缺', m2b && m2b.short === 0);

    /* 5. 单位不可换算 → 不硬算，给警告 */
    var d3 = Inventory.deficits(
      { adjuncts: [{ id: 'a-honey', name: '蜂蜜', amount: 500, unit: 'g' }] },
      { adjuncts: { 'a-honey': { qty: 1, unit: 'l' } } }
    );
    ok('体积与质量不换算', d3.items[0].unitMismatch === true);
    ok('不可换算时给警告', d3.warnings.length > 0);

    /* 6. 同一原料两行 → 需求合并 */
    var d4 = Inventory.deficits({
      hops: [
        { id: 'h-citra', name: '西楚', amount: 20, unit: 'g' },
        { id: 'h-citra', name: '西楚', amount: 30, unit: 'g' }
      ]
    }, { hops: { 'h-citra': { qty: 10, unit: 'g' } } });
    ok('同一原料两行合并需求 50g', d4.items.length === 1 && d4.items[0].need === 50, JSON.stringify(d4.items));

    /* 7. 脏输入 */
    var d5 = Inventory.deficits(null, null);
    ok('null 入参不崩', d5 && d5.items.length === 0 && d5.totalShort === 0);
    var d6 = Inventory.deficits({ fermentables: [{ amount: 0 }] }, {});
    ok('用量为 0 的行被跳过', d6.items.length === 0);
    ok('采购清单空输入不崩', Inventory.purchaseList(null).length === 0);

    /* 8. 数组形式库存也能读 */
    var d7 = Inventory.deficits(recipe, { malts: [{ id: 'm-2row', qty: 5, unit: 'kg' }] });
    ok('数组形式库存可用', Inventory.statusOf(d7, 'malts', 'm-2row').have === 5);

    /* 9. v1.2 冻结形状：余额只来自 Σmoves.delta，items.qty 是缓存不参与 */
    var d8 = Inventory.deficits(recipe, {
      items: [{ key: 'malts:m-2row', kind: 'malts', refId: 'm-2row', qty: 2, unit: 'kg' }],
      moves: [
        { id: 'mv-1', key: 'malts:m-2row', kind: 'malts', refId: 'm-2row', delta: 4, unit: 'kg' },
        { id: 'mv-2', key: 'malts:m-2row', kind: 'malts', refId: 'm-2row', delta: -1, unit: 'kg' }
      ]
    });
    var h8 = Inventory.statusOf(d8, 'malts', 'm-2row').have;
    ok('{items,moves}：余额 = Σdelta = 3kg', Math.abs(h8 - 3) < 1e-9, String(h8));
    ok('items.qty 不参与余额（否则 2+4-1=5，双算）', Math.abs(h8 - 5) > 1e-9, String(h8));

    /* 10. 只有 items 没有 moves → 余额 0（宁可显示"未录"，也不能拿缓存当权威） */
    var d8b = Inventory.deficits(recipe, {
      items: [{ key: 'malts:m-2row', kind: 'malts', refId: 'm-2row', qty: 9, unit: 'kg' }]
    });
    ok('只有 items 时余额为 0', Inventory.statusOf(d8b, 'malts', 'm-2row').have === 0);

    /* 11. 旧格式 move（qty+dir）能用，但必须报出来 */
    var d9 = Inventory.deficits(recipe, {
      moves: [
        { id: 'mv-3', key: 'hops:h-citra', kind: 'hops', refId: 'h-citra', qty: 50, dir: 'in', unit: 'g' },
        { id: 'mv-4', key: 'hops:h-citra', kind: 'hops', refId: 'h-citra', qty: 20, dir: 'out', unit: 'g' }
      ]
    });
    var h9 = Inventory.statusOf(d9, 'hops', 'h-citra').have;
    ok('旧格式 qty+dir 仍可算：50-20=30g', Math.abs(h9 - 30) < 1e-9, String(h9));
    ok('旧格式会给出警告（不静默容忍）', d9.warnings.length > 0);
    ok('没有 items 时 moves 也能独立成账', Inventory.statusOf(d9, 'hops', 'h-citra').short === 0);

    /* 12. key 是主键：key 与 kind/refId 不一致时按 key 修正 */
    var d10 = Inventory.deficits(recipe, {
      moves: [{ id: 'mv-5', key: 'malts:m-2row', kind: 'hops', refId: 'h-wrong', delta: 5, unit: 'kg' }]
    });
    ok('key 优先于 kind/refId', Inventory.statusOf(d10, 'malts', 'm-2row').have === 5,
      JSON.stringify(d10.items.map(function (x) { return x.kind + ':' + x.id; })));

    /* 13. 账面为负（D4）：不放大采购量，也不把问题糊成 0
       改前：short = need − have = 5 − (−4) = 9 → 多买 4 公斤。 */
    var d11 = Inventory.deficits(
      { fermentables: [{ id: 'm-2row', name: '淡色艾尔', amount: 5, unit: 'kg' }] },
      {
        items: [{ key: 'malts:m-2row', kind: 'malts', refId: 'm-2row', unit: 'kg' }],
        moves: [{ id: 'mv-6', key: 'malts:m-2row', kind: 'malts', refId: 'm-2row', delta: -4, unit: 'kg' }]
      }
    );
    var m11 = Inventory.statusOf(d11, 'malts', 'm-2row');
    ok('账面 −4 时短缺 = 5（不是 5+4=9）', m11 && Math.abs(m11.short - 5) < 1e-9, m11 && String(m11.short));
    ok('账面 −4 原样保留在 have（不糊成 0）', m11 && m11.have === -4, m11 && String(m11.have));
    ok('negative 里有一条', d11.negative.length === 1, JSON.stringify(d11.negative));
    ok('negative 记的是 −4 与单位', d11.negative[0] && d11.negative[0].balance === -4 &&
      d11.negative[0].unit === 'kg', JSON.stringify(d11.negative[0]));
    ok('warnings 说清「账面为负…建议先盘点」',
      d11.warnings.some(function (w) { return /账面为负/.test(w) && /盘点/.test(w); }), d11.warnings.join('|'));
    var pl11 = Inventory.purchaseList(d11);
    ok('采购量用夹过的短缺（5kg 向上取整 = 5）', pl11[0] && pl11[0].qty === 5, JSON.stringify(pl11));
    ok('exact 语义不变（仍是未取整的 5）', pl11[0] && Math.abs(pl11[0].exact - 5) < 1e-9, JSON.stringify(pl11));
    /* 反证：正数库存不该被夹子影响 */
    var d11b = Inventory.deficits(
      { fermentables: [{ id: 'm-2row', name: '淡色艾尔', amount: 5, unit: 'kg' }] },
      { moves: [{ key: 'malts:m-2row', delta: 2, unit: 'kg' }] }
    );
    ok('正数库存不受影响：−4 改成 +2 → 短缺 3', Inventory.statusOf(d11b, 'malts', 'm-2row').short === 3,
      String(Inventory.statusOf(d11b, 'malts', 'm-2row').short));
    ok('正数库存不会进 negative', d11b.negative.length === 0);

    /* 13b. **预计算余额表入参**——47-ui-inventory 走的正是这一条。
       这条以前没有，所以"整仓扫描"漏在配方行循环里时自检全绿、界面全空。
       形状来自 Store.inventoryBalance()：{malts:{id:{qty,unit}}, ...} */
    var d12 = Inventory.deficits(
      { fermentables: [{ id: 'm-2row', name: '淡色艾尔', amount: 5, unit: 'kg' }] },
      { malts: { 'm-2row': { qty: -4, unit: 'kg' } }, hops: {}, yeasts: {}, adjuncts: {} }
    );
    ok('【余额表入参，47 走这条】negative 仍有一条', d12.negative.length === 1, JSON.stringify(d12.negative));
    ok('【余额表入参】short 同样是 5',
      Math.abs(Inventory.statusOf(d12, 'malts', 'm-2row').short - 5) < 1e-9,
      String(Inventory.statusOf(d12, 'malts', 'm-2row').short));
    ok('【余额表入参】warnings 同样有「账面为负」',
      d12.warnings.some(function (w) { return /账面为负/.test(w); }), d12.warnings.join('|'));

    /* 13c. negative 是"整仓"的事，与当前打开哪个配方无关 */
    var d13 = Inventory.deficits(
      recipe,
      { malts: { 'm-pils': { qty: -2, unit: 'kg' } }, hops: {}, yeasts: {}, adjuncts: {} }
    );
    ok('不在配方里的负余额也要报（整仓盘点）',
      d13.negative.length === 1 && d13.negative[0].id === 'm-pils', JSON.stringify(d13.negative));

    /* 13d. 单位换算不了时 had 会被归零，但负数仍要报出来 */
    var d14 = Inventory.deficits(
      { fermentables: [{ id: 'm-2row', name: '淡色艾尔', amount: 5, unit: 'kg' }] },
      { malts: { 'm-2row': { qty: -4, unit: '桶' } }, hops: {}, yeasts: {}, adjuncts: {} }
    );
    ok('单位不能换算时，负余额仍要报（别被"按 0 计算"吞掉）',
      d14.negative.length === 1 && d14.negative[0].unit === '桶', JSON.stringify(d14.negative));
    /* 断言失败时要**报红**，不能先抛 TypeError——否则"守卫坏了"和"守卫抓到了"
       在日志里长得一样。所以取值一律加存在性判断。 */
    ok('negative.key 用项目约定 kind:refId（不是内部 map 的 kind|refId）',
      !!(d14.negative[0] && d14.negative[0].key === 'malts:m-2row'),
      d14.negative[0] && d14.negative[0].key);

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
