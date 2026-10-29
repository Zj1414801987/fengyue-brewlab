/* ============================================================================
 * 风月酿研所 — 43-ui-diff.js
 * ----------------------------------------------------------------------------
 * 职责：配方版本对比（一个模态框）。左侧选"旧"，右侧选"新"，逐行看差异。
 *
 * 三个来源（下拉里就是这三类）：
 *   cur                 当前工作副本（正在编辑、可能还没保存的那份）
 *   saved:<id>          已保存的任意配方；同 id 的那份就是「我刚才改了什么」
 *
 * 真正的比对在 32-recipe-diff.js（BREW.RecipeDiff.compare）。本文件只做
 * 三件事：取对象、渲染、导出 Markdown。**不重复实现比对逻辑**——两套比对
 * 引擎迟早会因为阈值不同（4.5→5.0 算不算"改"？）给出不一致的结论。
 *
 * v1.4 增加「这次为什么改」：版本条目上的 intent（见 30-recipe 的 §八）。
 *   三处入口都在本文件：
 *     · 对比页顶部一行（在摘要行上方，先看为什么再看改了多少）
 *     · 保存成功后 toast 里的「补一句为什么改 ›」（不弹模态、不点即放弃）
 *     · 版本来源选到历史版本时，同一行上的「补一句 ›」事后回填
 *   读写口径（截断、空白折叠、老条目没有该字段）**只在 30-recipe 一处实现**，
 *   本文件与 53 都调它——两处各写一遍，两个界面迟早显示成两个样子。
 *
 * 依赖：BREW.UI（esc/attr/num/fmt/icon/recipe/calc/store/Settings?）、UI.Shell
 *       BREW.RecipeDiff（**可缺**：缺了模态框照样开，里面显示"模块未载入"）
 *       BREW.Recipe（**可缺**：缺了整个 intent 功能降级成"未填写"，其余照常）
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  var Diff = UI.Diff = UI.Diff || {};

  function toast(msg, kind, ms) {
    if (UI.Shell && UI.Shell.toast) UI.Shell.toast(msg, kind || 'info', ms || 2600);
  }

  /* ======================================================================
   * A0. 改动意图 intent 的读写口径（v1.4）
   * ----------------------------------------------------------------------
   * 全部转手给 30-recipe（`BREW.Recipe.intentOfVersion / normIntent /
   * setVersionIntent / INTENT_MAX`）。本文件只负责**显示**与**收集**。
   * 为什么不在这个文件里直接读 entry.intent：
   *   60 字码点截断、空白折叠、老条目（v1.3 存的没有这个字段）这三条口径
   *   必须只有一处实现。对比页、谱系节点、导出 Markdown 三处各写一遍的话，
   *   同一个版本在三个地方会显示成长度不同的三句话。
   * 模块缺席（脚本顺序被打乱 / 被裁掉的构建）→ 一律降级成"未填写"，不报错。
   * ====================================================================*/

  function intentApi() {
    var M = BREW.Recipe;
    return (M && typeof M.intentOfVersion === 'function') ? M : null;
  }

  /** 一条版本条目的理由；老条目/没填 → ''（显示层把它翻成"未填写"） */
  function intentText(entry) {
    var M = intentApi();
    if (!M || !entry) return '';
    try { return M.intentOfVersion(entry); } catch (e) { return ''; }
  }

  function intentMax() {
    var M = intentApi();
    return (M && M.INTENT_MAX) || 60;
  }

  function intentLen(v) {
    var M = intentApi();
    if (M && typeof M.intentLen === 'function') return M.intentLen(v);
    return String(v === undefined || v === null ? '' : v).length;
  }

  /** 未填写时的统一样子：淡色"未填写"，而不是留空——留空会被读成"加载失败" */
  var INTENT_EMPTY = '<span class="u-dim">未填写</span>';

  function intentOrEmpty(text) {
    return text ? esc(text) : INTENT_EMPTY;
  }

  /* ======================================================================
   * A. 来源
   * ====================================================================*/

  function savedList() {
    try {
      var arr = UI.store && UI.store.recipes ? UI.store.recipes() : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function findSaved(id) {
    var list = savedList();
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  /* ---------------- 历史版本（v1.2 第 4 个来源） ----------------
     存在顶层 versions.<recipeId>；条目形如
       { rev, at, hash, notesHash, notesLen, partial, rec }
     rec 为 null 表示 oversize（裁完仍超上限，没存快照）——这种不能进 compare，
     否则会得到一张全空表，用户会以为"两版一模一样"。
     它同样不能出现在版本下拉里：选了它只会得到一句"没有快照"，
     而选项本身就是在说"这一版可以比"。 */
  function versionsOf(id) {
    if (!id) return [];
    try {
      var arr = BREW.Store ? BREW.Store.get('versions.' + id, null) : null;
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  /** 只有带快照的版本能参与对比；下拉与索引都基于这一份，保证 idx 前后一致 */
  function usableVersionsOf(id) {
    var all = versionsOf(id);
    var out = [];
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].rec) out.push(all[i]);
    return out;
  }

  function unusableVersionCount(id) {
    return Math.max(0, versionsOf(id).length - usableVersionsOf(id).length);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function versionLabel(entry, i) {
    if (!entry) return '第 ' + (i + 1) + ' 版';
    var d = entry.at ? new Date(entry.at) : null;
    var when = d ? (pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes())) : '时间未知';
    var tail = entry.rec === null ? ' · 无快照'
      : entry.partial ? ' · 压缩存档' : '';
    return '第 ' + (num(entry.rev, i + 1)) + ' 版 · ' + when + tail;
  }

  /** 统一解析一个"来源"：返回 {recipe, meta} 或 null */
  function resolve(value, verIdx) {
    /* 非版本来源的 meta.intent 置 null（不是 ''）：
       null = "这不是版本，没有理由可读"，'' = "是版本但没填"。
       两者在界面上的话不一样，混成一个值就说不清是哪一种。 */
    if (value === 'cur') return { recipe: UI.recipe(), meta: { isVersion: false, intent: null } };

    var m = /^saved:(.+)$/.exec(String(value || ''));
    if (m) {
      var r = findSaved(m[1]);
      return r ? { recipe: r, meta: { isVersion: false, intent: null } } : null;
    }

    if (value === 'ver') {
      var curId = (UI.recipe() || {}).id;
      var list = usableVersionsOf(curId);
      var idx = Math.max(0, num(verIdx, 0));
      var entry = list[idx] || null;
      if (!entry) return null;
      return {
        recipe: entry.rec || null,
        meta: {
          isVersion: true,
          rev: num(entry.rev, idx + 1),
          at: num(entry.at, 0),
          partial: entry.partial === true,
          oversize: entry.rec === null,
          notesLen: num(entry.notesLen, 0),
          notesHash: String(entry.notesHash || ''),
          /* v1.4：这一版为什么改。老条目读到 ''（未填写），不补写、不报错 */
          intent: intentText(entry),
          /* 条目本身（活对象）：对比页上"补一句为什么改"要写回它，
             靠 hash/rev 再去查一遍会在条目被压掉时写错版本 */
          entry: entry
        }
      };
    }
    return null;
  }

  function labelOf(recipe) {
    if (!recipe) return '—';
    return recipe.name || '未命名配方';
  }

  /**
   * 下拉选项。**默认值绝不能是另一份配方**（见 defaultPair），但"跨配方对比"
   * 本身是合法需求，所以其它配方放在单独一组里——分组标题把"这不是你的版本"
   * 写在明面上，用户点它时是明确意图，而不是被默认值骗进去的。
   */
  function optionsHtml(cur, selected) {
    var curId = (cur && cur.id) || '';
    var same = curId ? findSaved(curId) : null;
    var vers = usableVersionsOf(curId);

    var html = '<option value="cur"' + (selected === 'cur' ? ' selected' : '') + '>' +
      '当前工作副本 · ' + esc(labelOf(cur)) + '</option>';

    if (same) {
      html += '<option value="' + attr('saved:' + same.id) + '"' +
        (selected === ('saved:' + same.id) ? ' selected' : '') + '>' +
        '同 id 上次保存 · ' + esc(labelOf(same)) + '</option>';
    }
    /* 第 4 个来源：历史版本。没有可用版本就不出现这个选项（不显示空下拉） */
    if (vers.length) {
      html += '<option value="ver"' + (selected === 'ver' ? ' selected' : '') + '>' +
        '历史版本…（' + vers.length + ' 条）</option>';
    }
    /* 新配方、从没保存过：下拉里只剩工作副本，并明说下一步该干什么 */
    if (!same && !vers.length) {
      html += '<option value="" disabled>— 这份配方还没有已保存版本，先保存一次才能和历史对比 —</option>';
    }

    var others = '';
    var list = savedList();
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || !it.id || it.id === curId) continue;
      others += '<option value="' + attr('saved:' + it.id) + '"' +
        (selected === ('saved:' + it.id) ? ' selected' : '') + '>' + esc(labelOf(it)) + '</option>';
    }
    if (others) {
      html += '<optgroup label="其它配方（跨配方对比，不是你的版本）">' + others + '</optgroup>';
    }
    return html;
  }

  /** 版本下拉：只有在来源选到「历史版本」时才显示（默认 display:none） */
  function versionSelectHtml(id, vers, idx, sourceValue) {
    if (!vers.length) return '';
    var opts = '';
    for (var i = 0; i < vers.length; i++) {
      opts += '<option value="' + attr(String(i)) + '"' +
        (num(idx, 0) === i ? ' selected' : '') + '>' + esc(versionLabel(vers[i], i)) + '</option>';
    }
    return '<select class="select select--sm mt-8" id="' + attr(id) + '" aria-label="选择历史版本"' +
      ' style="' + (sourceValue === 'ver' ? '' : 'display:none') + '">' + opts + '</select>';
  }

  /** 默认选法：左 = 同 id 的已保存版，右 = 工作副本。
      绝不跨配方自动选中：那会让用户以为在看自己的版本演进，
      实际是在拿两个不相干的配方做 diff（D1）。
      同 id 没保存过就退回「工作副本 vs 工作副本」，界面上另给提示。 */
  function defaultPair(cur) {
    var same = (cur && cur.id) ? findSaved(cur.id) : null;
    return { left: same ? ('saved:' + same.id) : 'cur', right: 'cur' };
  }

  /* ======================================================================
   * B. 归一化
   * ----------------------------------------------------------------------
   * 32 号模块返回的结构在并行开发中可能微调（字段名/嵌套层）。这里做一层
   * 收口的归一化：渲染与导出只认 model，不再关心原始形状。缺什么就降级成
   * 空数组，绝不在这里补算物理量。
   * ====================================================================*/

  var KINDS = [
    { key: 'fermentables', label: '麦芽与谷物', unit: 'kg' },
    { key: 'hops', label: '酒花', unit: 'g' },
    { key: 'yeasts', label: '酵母', unit: 'g' },
    { key: 'adjuncts', label: '辅料', unit: '' }
  ];

  /* 目标值是用户填的"我想要"，32 号模块只比设备与水离子，不覆盖 targets。
     这一段是纯读字段，不是第二套比对引擎。 */
  var TARGET_DEFS = [
    { k: 'og', label: '目标 OG', kind: 'sg' },
    { k: 'fg', label: '目标 FG', kind: 'sg' },
    { k: 'abv', label: '目标 ABV', kind: 'pct' },
    { k: 'ibu', label: '目标 IBU', kind: 'int' },
    { k: 'srm', label: '目标 SRM', kind: 'dec' }
  ];

  /** 32 号模块的 status 是 added / removed / changed / same，这里映射成三种渲染态 */
  function pickOp(status) {
    var s = String(status || '').toLowerCase();
    if (s === 'added') return 'add';
    if (s === 'removed') return 'del';
    if (s === 'same') return 'same';
    return 'chg';
  }

  function normItem(x, kindMeta) {
    if (!x) return null;
    var op = pickOp(x.status);
    var left = x.left || null;
    var right = x.right || null;
    var from = left ? left.amount : null;
    var to = right ? right.amount : null;
    /* 除了用量，其它字段的变化（ppg / α酸 / 阶段 / 时间）单独列出来——
       只显示用量会漏掉"同一个原料换了投放阶段"这类改动 */
    var extra = [];
    var fields = Array.isArray(x.fields) ? x.fields : [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f || !f.changed || f.k === 'amount') continue;
      extra.push({
        label: f.label || f.k,
        from: f.leftLabel !== undefined ? f.leftLabel : f.left,
        to: f.rightLabel !== undefined ? f.rightLabel : f.right,
        unit: f.unit || ''
      });
    }
    var unit = (right && right.unit) || (left && left.unit) || kindMeta.unit;
    /* 辅料的单位跟着行走（有 g 也有 ml），所以优先取行上的 unit */
    if (kindMeta.key === 'adjuncts') unit = (right && right.unit) || unit;
    return {
      op: op,
      name: x.name || x.id || '（未命名）',
      from: from,
      to: to,
      unit: unit,
      delta: x.delta,
      extra: extra
    };
  }

  function normRows(d, unavailableKinds) {
    var src = (d && (d.rows || d.tables)) || d || {};
    var missing = {};
    var un = (d && d.unavailable && d.unavailable.kinds) || unavailableKinds || [];
    for (var u = 0; u < un.length; u++) missing[String(un[u])] = true;
    var out = [];
    for (var i = 0; i < KINDS.length; i++) {
      var k = KINDS[i];
      var arr = src[k.key] || [];
      if (!Array.isArray(arr)) arr = [];
      var items = [];
      var sameCount = 0;
      for (var j = 0; j < arr.length; j++) {
        var it = normItem(arr[j], k);
        if (!it) continue;
        if (it.op === 'same') { sameCount++; continue; }
        items.push(it);
      }
      out.push({
        key: k.key, label: k.label, items: items, sameCount: sameCount,
        /* 这一整段没保存（partial 版本）：不是"删光了"，要单独说明 */
        missing: !!missing[k.key]
      });
    }
    return out;
  }

  function numOrNull(v) {
    var n = num(v, NaN);
    return isFinite(n) ? n : null;
  }

  function normFields(d, a, b) {
    var arr = (d && (d.params || d.fields || d.equipment)) || [];
    var out = [];
    if (Array.isArray(arr)) {
      for (var i = 0; i < arr.length; i++) {
        var f = arr[i];
        if (!f) continue;
        /* 某一侧整段没保存（partial 版本）：显示成「—」而不是 0，
           否则用户会以为"你把钙从 40 删成了 0"，而只是没存那一段 */
        if (f.unavailable === true) {
          out.push({
            label: f.label || f.key || '',
            from: '—', to: '—', unit: f.unit || '',
            unavailable: true
          });
          continue;
        }
        /* 未变化的字段在 15 个参数里占绝大多数，全列出来等于没重点 */
        if (f.changed === false) continue;
        out.push({
          label: f.label || f.name || f.key || '',
          from: (f.left !== undefined) ? f.left : f.from,
          to: (f.right !== undefined) ? f.right : f.to,
          unit: f.unit || ''
        });
      }
    }
    /* 目标值：只列真的填过、并且两侧不同的项 */
    var ta = (a && a.targets) || {};
    var tb = (b && b.targets) || {};
    for (var t = 0; t < TARGET_DEFS.length; t++) {
      var def = TARGET_DEFS[t];
      var va = numOrNull(ta[def.k]);
      var vb = numOrNull(tb[def.k]);
      if (va === null && vb === null) continue;
      if (va !== null && vb !== null && Math.abs(va - vb) < 1e-6) continue;
      out.push({
        label: def.label,
        from: va === null ? '—' : fmtMetric(def.kind, va),
        to: vb === null ? '—' : fmtMetric(def.kind, vb),
        unit: ''
      });
    }
    /* 风格：把风格从「美式琥珀拉格」改成「美式 IPA」，等于把这锅酒的目标整个换掉
       （目标区间、风格匹配度、告警阈值全跟着变），比批次量重要得多。32 号的
       PARAM_DEFS 只比数值参数，没有 styleId，所以这里按 TARGET_DEFS 的先例做
       纯读字段——只把两个 id 翻成名字并排，不实现第二套比对。 */
    var styleRow = styleFieldRow(a, b, out);
    if (styleRow) out.push(styleRow);
    return out;
  }

  /** 风格 id → 「编号 · 名称」；查不到名称就退回 id 本身，绝不显示空白。
      编号用传进来的 id（下拉里选的就是 20B / 21A 这串），不用 st.code——
      风格表里有的条目根本没有 code 字段（21A 就没有），拿它当主键会漏编号。 */
  function styleLabel(id) {
    if (!id) return '未指定';
    var st = null;
    try { st = (BREW.DB && BREW.DB.getStyle) ? BREW.DB.getStyle(String(id)) : null; } catch (e) { st = null; }
    if (!st || !st.name) return String(id);
    return String(id) + ' · ' + st.name;
  }

  /** 风格行。两侧同 id（含都为空）返回 null，不占一行 */
  function styleFieldRow(a, b, existing) {
    /* 模块哪天把 styleId 加进 PARAM_DEFS 了，这里就不要再出一行，免得重复 */
    for (var i = 0; i < existing.length; i++) {
      if (/风格/.test(String((existing[i] && existing[i].label) || ''))) return null;
    }
    var ia = String((a && a.styleId) || '');
    var ib = String((b && b.styleId) || '');
    if (ia === ib) return null;
    return { label: '风格', from: styleLabel(ia), to: styleLabel(ib), unit: '' };
  }

  function fmtMetric(kind, v) {
    var n = num(v, NaN);
    if (!isFinite(n)) return '—';
    if (kind === 'sg') return n.toFixed(3);
    if (kind === 'pct') return fmt(n, 2) + '%';
    if (kind === 'int') return fmt(n, 0);
    if (kind === 'dec2') return fmt(n, 2);
    return fmt(n, 1);
  }

  /** 指标：32 号给的是一维数组 [{key,label,left,right,delta,pct,major,changed}] */
  function normMetrics(d, calcA, calcB) {
    var arr = (d && (d.metrics || d.indices)) || [];
    var list = Array.isArray(arr) ? arr : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m) continue;
      var key = String(m.key || '');
      var kind = key === 'og' || key === 'fg' ? 'sg'
        : key === 'abv' || key === 'attenuation' ? 'pct'
          : key === 'buGu' ? 'dec2'
            : key === 'ibu' ? 'int' : 'dec';
      out.push({
        key: key,
        label: m.label || key,
        kind: kind,
        a: (m.left !== undefined) ? m.left : m.a,
        b: (m.right !== undefined) ? m.right : m.b,
        delta: num(m.delta, 0),
        pct: num(m.pct, 0),
        big: (m.major === true) || Math.abs(num(m.pct, 0)) >= 5
      });
    }
    /* 模块没给指标（缺 calc）时，至少把两边 calc 的六个数并排出来 */
    if (!out.length && calcA && calcB) {
      var FALLBACK = [
        { key: 'og', label: 'OG', kind: 'sg' },
        { key: 'fg', label: 'FG', kind: 'sg' },
        { key: 'abv', label: 'ABV', kind: 'pct' },
        { key: 'ibu', label: 'IBU', kind: 'int' },
        { key: 'srm', label: 'SRM', kind: 'dec' },
        { key: 'buGu', label: 'BU:GU', kind: 'dec2' }
      ];
      for (var f = 0; f < FALLBACK.length; f++) {
        var df = FALLBACK[f];
        var va = num(calcA[df.key], 0), vb = num(calcB[df.key], 0);
        var dd = vb - va;
        var pp = va !== 0 ? Math.abs(dd / va) * 100 : 0;
        out.push({
          key: df.key, label: df.label, kind: df.kind,
          a: va, b: vb, delta: dd, pct: pp, big: pp >= 5
        });
      }
    }
    return out;
  }

  function normModel(d, calcA, calcB, a, b, metaA, metaB) {
    var rows = normRows(d);
    var added = 0, removed = 0, changed = 0;
    for (var i = 0; i < rows.length; i++) {
      var items = rows[i].items;
      for (var j = 0; j < items.length; j++) {
        if (items[j].op === 'add') added++;
        else if (items[j].op === 'del') removed++;
        else changed++;
      }
    }
    var sum = (d && (d.summary || d.counts)) || {};
    var fields = normFields(d, a, b);
    /* 备注：版本条目里只有 notesHash / notesLen，没有原文，所以只比字数与哈希。
       措辞上不许出现"备注已删除"——我们根本不知道内容，只知道长度与指纹。 */
    var nr = notesRow(metaA, metaB, a, b);
    if (nr) fields.push(nr);

    var metrics = normMetrics(d, calcA, calcB);

    /* 32 的 summary 只统计原料行，所以"只改了名字"或"只改了批次量"在那里都是
       0 处改动 —— 界面照着说就会变成"两份配方完全一致"（D2）。
       这里把名称、参数、指标三类改动各自数出来，结论句才有依据。 */
    var nameFrom = (a && a.name) || '';
    var nameTo = (b && b.name) || '';
    /* 判定以 32 的 nameChanged 为准（它已把名称并入 hasChanges），
       这里只在拿到旧版 diff 结果（没有该字段）时兜底自己比一次。
       为什么要这么写：同一个事实两处各算一遍，迟早在某处出现 trim / 默认名
       差异而分叉。显示用的 nameFrom/nameTo 仍然自己取，那是文案不是判定。 */
    var nameChanged = (d && typeof d.nameChanged === 'boolean')
      ? d.nameChanged
      : (nameFrom !== nameTo);
    var fieldsChanged = 0;
    var notesChanged = false;
    for (var p = 0; p < fields.length; p++) {
      var fd = fields[p];
      /* 备注单独算：它不是"参数"，混进"参数改动 N 项"会让人以为改了设备 */
      if (fd.notes) { if (fd.changed) notesChanged = true; continue; }
      if (fd.unavailable) continue;               /* 没参与对比的不算"改动" */
      if (fd.changed === false) continue;
      fieldsChanged++;
    }
    var metricsChanged = 0;
    for (var q = 0; q < metrics.length; q++) {
      if (Math.abs(num(metrics[q].delta, 0)) > 1e-9) metricsChanged++;
    }
    var unavailableKinds = (d && d.unavailable && Array.isArray(d.unavailable.kinds))
      ? d.unavailable.kinds : [];
    var unavailableParams = (d && d.unavailable && Array.isArray(d.unavailable.params))
      ? d.unavailable.params : [];

    return {
      rows: rows,
      fields: fields,
      metrics: metrics,
      nameFrom: nameFrom,
      nameTo: nameTo,
      nameChanged: nameChanged,
      fieldsChanged: fieldsChanged,
      notesChanged: notesChanged,
      metricsChanged: metricsChanged,
      /* 有多少项"根本没比过"：计数行不能假装它们不存在（D3） */
      notComparedCount: unavailableKinds.length + unavailableParams.length,
      summary: {
        added: num(sum.added, added),
        removed: num(sum.removed, removed),
        changed: num(sum.changed, changed)
      },
      warnings: (d && Array.isArray(d.warnings)) ? d.warnings : [],
      unavailableKinds: unavailableKinds,
      unavailableParams: unavailableParams
    };
  }

  /**
   * 备注行的口径：只比"字数 + 指纹"，不猜内容。
   * 两侧都拿得到 notesLen（工作副本用 recipe.notes.length），
   * 哈希只有版本条目才有，所以"同字数不同哈希"也能判成有改动。
   */
  function notesRow(metaA, metaB, a, b) {
    function lenOf(meta, recipe) {
      if (meta && meta.isVersion) return num(meta.notesLen, null);
      if (recipe && typeof recipe.notes === 'string') return recipe.notes.length;
      return null;
    }
    function hashOf(meta) {
      return (meta && meta.isVersion) ? String(meta.notesHash || '') : '';
    }
    var la = lenOf(metaA, a), lb = lenOf(metaB, b);
    if (la === null && lb === null) return null;
    var ha = hashOf(metaA), hb = hashOf(metaB);
    var sameLen = la !== null && lb !== null && la === lb;
    var sameHash = ha && hb && ha === hb;
    var changed = sameHash ? false : !sameLen;
    var text;
    if (changed) {
      text = '备注 ' + fmtAny(la) + ' → ' + fmtAny(lb) + ' 字（有改动）';
    } else if (sameLen) {
      text = '备注 ' + fmtAny(la) + ' 字（无改动）';
    } else {
      text = '备注 ' + fmtAny(la) + ' 字 → 另一侧未记录';
    }
    return { label: '备注', from: '', to: '', unit: '', notes: text, changed: changed };
  }

  /* ======================================================================
   * C. 渲染
   * ====================================================================*/

  var OP_TEXT = { add: '新增', del: '删除', chg: '改量' };

  function deltaCell(it) {
    if (it.op === 'add') return '<span class="diff-cell diff-cell--add">' + esc(fmtAny(it.to)) + '</span>';
    if (it.op === 'del') return '<span class="diff-cell diff-cell--del">' + esc(fmtAny(it.from)) + '</span>';
    var text = fmtAny(it.from) + ' → ' + fmtAny(it.to);
    var extra = '';
    var f = num(it.from, 0), t = num(it.to, 0);
    if (f !== 0) {
      var p = (t - f) / f * 100;
      extra = ' (' + (p >= 0 ? '+' : '') + fmt(p, 0) + '%)';
    }
    return '<span class="diff-cell diff-cell--chg">' + esc(text) + esc(extra) + '</span>';
  }

  /** 非用量字段的变化（α 酸 / 投放阶段 / ppg…）用小字并进同一格 */
  function extraCell(it) {
    if (!Array.isArray(it.extra) || !it.extra.length) return '';
    var bits = [];
    for (var i = 0; i < it.extra.length; i++) {
      var e = it.extra[i];
      bits.push(e.label + ' ' + fmtAny(e.from) + (e.unit ? ' ' + e.unit : '') +
        ' → ' + fmtAny(e.to) + (e.unit ? ' ' + e.unit : ''));
    }
    return '<div class="u-xs u-dim">' + esc(bits.join(' · ')) + '</div>';
  }

  /**
   * 用量差：右 − 左，带符号。
   * 现在只有"原 → 现 +12%"和颜色，用户得自己在脑子里减一遍（D6）。
   * 新增/删除两行没有"另一侧"，差就是整行用量，用 ±全量的形式表达。
   */
  function dqHtml(it) {
    var unit = it.unit ? ' ' + it.unit : '';
    if (it.op === 'add') {
      return '<span class="diff-cell--add u-xs" style="margin-left:6px">+' +
        esc(fmtAny(it.to)) + esc(unit) + '</span>';
    }
    if (it.op === 'del') {
      return '<span class="diff-cell--del u-xs" style="margin-left:6px">−' +
        esc(fmtAny(it.from)) + esc(unit) + '</span>';
    }
    var d = num(it.to, 0) - num(it.from, 0);
    if (!d) return '';
    var cls = d > 0 ? 'diff-cell--add' : 'diff-cell--del';
    return '<span class="' + cls + ' u-xs" style="margin-left:6px">' +
      (d > 0 ? '+' : '−') + esc(fmtAny(Math.abs(d))) + esc(unit) + '</span>';
  }

  function fmtAny(v) {
    if (v === undefined || v === null || v === '') return '—';
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
    return String(v);
  }

  function rowsHtml(model) {
    var html = '';
    for (var i = 0; i < model.rows.length; i++) {
      var sec = model.rows[i];
      /* 这一整段在某一侧没保存（partial 版本）：说清楚"没参与对比"，
         不能什么都不显示——用户会以为那一段"没有变化" */
      if (sec.missing) {
        html += '<div class="diff-sec">' +
          '<h4 class="diff-sec__title">' + esc(sec.label) + '</h4>' +
          '<div class="diff-na">这一版没有保存' + esc(sec.label) +
          '（压缩存档），未参与对比——不是被删掉了。</div></div>';
        continue;
      }
      if (!sec.items.length) continue;
      var body = '';
      for (var j = 0; j < sec.items.length; j++) {
        var it = sec.items[j];
        body += '<tr class="diff-row diff-row--' + attr(it.op) + '">' +
          '<td class="diff-row__op">' + esc(OP_TEXT[it.op] || '改量') + '</td>' +
          '<td>' + esc(String(it.name)) + dqHtml(it) + extraCell(it) + '</td>' +
          '<td class="u-right">' + deltaCell(it) +
            (it.unit ? ' <span class="u-dim u-xs">' + esc(String(it.unit)) + '</span>' : '') +
          '</td>' +
          '</tr>';
      }
      html += '<div class="diff-sec">' +
        '<h4 class="diff-sec__title">' + esc(sec.label) + '<span class="diff-sec__n">' +
        sec.items.length + ' 处变化</span>' +
        (sec.sameCount ? '<span class="diff-sec__hint">另有 ' + sec.sameCount + ' 行未变</span>' : '') +
        '</h4>' +
        '<div class="diff-table-wrap"><table class="diff-table">' +
        '<thead><tr><th style="width:64px">变化</th><th>原料</th>' +
        '<th class="u-right" style="width:190px">原 → 现</th></tr></thead>' +
        '<tbody>' + body + '</tbody></table></div></div>';
    }
    return html;
  }

  function fieldsHtml(model) {
    if (!model.fields.length) return '';
    var rows = '';
    var naCount = 0;
    for (var i = 0; i < model.fields.length; i++) {
      var f = model.fields[i];
      /* 备注只有字数可比：整行跨三列，别假装有"旧值/新值" */
      if (f.notes) {
        rows += '<tr class="diff-row ' + (f.changed ? 'diff-row--chg' : 'diff-row--same') + '">' +
          '<td colspan="3">' + esc(String(f.notes)) + '</td></tr>';
        continue;
      }
      if (f.unavailable) {
        naCount++;
        rows += '<tr class="diff-row diff-row--same diff-row--na">' +
          '<td>' + esc(String(f.label || '')) + '</td>' +
          '<td class="u-right diff-cell">—</td>' +
          '<td class="u-right diff-cell">—</td>' +
          '</tr>';
        continue;
      }
      var same = String(f.from) === String(f.to);
      rows += '<tr class="diff-row' + (same ? ' diff-row--same' : ' diff-row--chg') + '">' +
        '<td>' + esc(String(f.label || '')) + '</td>' +
        '<td class="u-right diff-cell">' + esc(fmtAny(f.from) + (f.unit ? ' ' + f.unit : '')) + '</td>' +
        '<td class="u-right diff-cell diff-cell--chg">' + esc(fmtAny(f.to) + (f.unit ? ' ' + f.unit : '')) + '</td>' +
        '</tr>';
    }
    if (naCount) {
      rows = '<tr class="diff-row diff-row--same"><td colspan="3" class="diff-na">' +
        '其中 ' + naCount + ' 项在某一侧没有保存（显示为 —），未参与对比</td></tr>' + rows;
    }
    return '<div class="diff-sec">' +
      '<h4 class="diff-sec__title">设备参数与目标值</h4>' +
      '<div class="diff-table-wrap"><table class="diff-table">' +
      '<thead><tr><th>字段</th><th class="u-right" style="width:130px">旧</th>' +
      '<th class="u-right" style="width:130px">新</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  function metricsHtml(model) {
    var rows = '';
    for (var i = 0; i < model.metrics.length; i++) {
      var m = model.metrics[i];
      var dTxt = (num(m.delta, 0) > 0 ? '+' : '') + fmtMetric(m.kind, m.delta).replace('%', '');
      rows += '<tr>' +
        '<td>' + esc(m.label) + '</td>' +
        '<td class="u-right u-mono">' + esc(fmtMetric(m.kind, m.a)) + '</td>' +
        '<td class="u-right u-mono">' + esc(fmtMetric(m.kind, m.b)) + '</td>' +
        '<td class="u-right u-mono' + (m.big ? ' diff-delta--big' : '') + '">' +
        esc(dTxt) + (m.big ? ' (' + esc(fmt(m.pct, 0)) + '%)' : '') + '</td>' +
        '</tr>';
    }
    return '<div class="diff-sec">' +
      '<h4 class="diff-sec__title">关键指标<span class="diff-sec__hint">Δ 超过 5% 标红</span></h4>' +
      '<div class="diff-table-wrap"><table class="diff-table diff-table--metrics">' +
      '<thead><tr><th>指标</th><th class="u-right" style="width:110px">旧</th>' +
      '<th class="u-right" style="width:110px">新</th>' +
      '<th class="u-right" style="width:150px">Δ</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  /** 版本来源在名字旁边补一个「第 N 版 · 压缩存档」的小标，别让人以为是另一份配方 */
  function sideLabel(recipe, meta) {
    var base = labelOf(recipe);
    if (!meta || !meta.isVersion) return base;
    return base + '（第 ' + num(meta.rev, 0) + ' 版' + (meta.partial ? ' · 压缩存档' : '') + '）';
  }

  /**
   * 对比页顶部那行「这次为什么改」（v1.4）。
   *
   * 位置在摘要行**上方**：先看"为什么"，再看"改了多少"，这个顺序和人复盘
   * 的顺序一致。也不能塞进下面那两张表——它不是被比出来的字段，
   * 一旦并进去，用户会奇怪"为什么这一项只有新值没有旧值"。
   *
   * 四种形态（A = 左 = 旧，B = 右 = 新）：
   *   · 两侧都是历史版本 → 并列「A：… / B：…」（需求原话）
   *   · 一侧是版本       → 单句；右侧优先（"这次"指新那一版）
   *   · 两侧都不是版本    → 用**当前配方最新一版**的理由兜底，并注明是第几版写的。
   *     为什么要这个兜底：默认配对是「同 id 上次保存 vs 工作副本」，两个都不是版本。
   *     不给兜底的话，用户刚填完理由打开对比页，看到的是"未填写"——他会以为
   *     自己那句话丢了。兜底那句是**当时写下的原话**，只是标注了出处，不算编造。
   *   · 全都没有         → 「未填写」+ 一句"理由跟着版本走"的说明
   */
  function intentRowHtml(metaA, metaB, curId) {
    var va = !!(metaA && metaA.isVersion);
    var vb = !!(metaB && metaB.isVersion);
    var ia = va ? String(metaA.intent || '') : '';
    var ib = vb ? String(metaB.intent || '') : '';

    /* 当前配方最新一版的理由（两侧都不是版本时的兜底） */
    var latest = null;
    if (curId) {
      var vers = usableVersionsOf(curId);
      if (vers.length) {
        var lastEntry = vers[vers.length - 1];
        latest = { rev: num(lastEntry.rev, vers.length), intent: intentText(lastEntry), entry: lastEntry };
      }
    }

    var body = '';
    var tail = '';
    var fillBtn = '';

    if (va && vb) {
      body = '<b>A：</b>' + intentOrEmpty(ia) +
        '<span class="u-dim"> / </span>' +
        '<b>B：</b>' + intentOrEmpty(ib);
      if (!ia && !ib) tail = '两版都没写理由。';
      /* 事后回填：右侧是当前配方的某一版、且还没写，就给入口。
         不给入口的话，用户只有"保存那一瞬间"的一次机会——那太苛刻。 */
      if (!ib && metaB.entry && String(metaB.rev) === String(metaB.entry.rev)) {
        fillBtn = ' <button type="button" class="btn btn-quiet btn-xs" data-diff-intent="right">' +
          '补一句 ›</button>';
      }
    } else if (vb) {
      body = intentOrEmpty(ib);
      if (!ib) {
        tail = '这一版没写理由。';
        if (metaB.entry) {
          fillBtn = ' <button type="button" class="btn btn-quiet btn-xs" data-diff-intent="right">' +
            '补一句 ›</button>';
        }
      }
    } else if (va) {
      body = intentOrEmpty(ia);
      if (ia) body += '<span class="u-xs u-dim">（第 ' + num(metaA.rev, 0) + ' 版写的）</span>';
      if (!ia) tail = '这一版没写理由。';
    } else if (latest) {
      body = intentOrEmpty(latest.intent);
      if (latest.intent) {
        body += '<span class="u-xs u-dim">（第 ' + latest.rev + ' 版写的理由）</span>';
      } else {
        tail = '最新一版（第 ' + latest.rev + ' 版）还没写理由。' +
          '理由跟着版本走，把某一侧选成「历史版本…」可以逐版对比。';
        fillBtn = ' <button type="button" class="btn btn-quiet btn-xs" data-diff-intent="latest">' +
          '补一句 ›</button>';
      }
    } else {
      body = INTENT_EMPTY;
      tail = '这份配方还没有历史版本，先保存一次才会有"为什么改"。';
    }

    return '<div class="diff-intent" data-intent-row="1" ' +
      'style="display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;' +
      'margin:0 0 10px;padding:8px 11px;border:1px solid var(--line);' +
      'border-left:3px solid var(--amber);border-radius:var(--r-sm);' +
      'background:var(--bg-2);font-size:14px;line-height:1.6">' +
      '<span class="u-xs" style="color:var(--amber-soft);flex:0 0 auto">这次为什么改</span>' +
      '<span style="min-width:0">' + body + '</span>' + fillBtn +
      (tail ? '<span class="u-xs u-dim" style="flex:1 1 100%">' + esc(tail) + '</span>' : '') +
      '</div>';
  }

  /** 导出 Markdown 用的纯文本版（Markdown 里贴标签是灾难，这里一律纯文本）。
      口径必须与屏幕上那行一致，否则同一个对比导出前后说的不是一句话。 */
  function mdIntentOf(metaA, metaB, curId) {
    var va = !!(metaA && metaA.isVersion);
    var vb = !!(metaB && metaB.isVersion);
    var ia = va ? String(metaA.intent || '') : '';
    var ib = vb ? String(metaB.intent || '') : '';
    if (va && vb) return '为什么改：A：' + (ia || '未填写') + ' / B：' + (ib || '未填写');
    if (vb) return '为什么改：' + (ib || '未填写');
    if (va) return '为什么改：' + (ia || '未填写') + '（第 ' + num(metaA.rev, 0) + ' 版写的）';
    var vers = curId ? usableVersionsOf(curId) : [];
    if (vers.length) {
      var lastEntry = vers[vers.length - 1];
      var li = intentText(lastEntry);
      if (li) return '为什么改：' + li + '（第 ' + num(lastEntry.rev, 0) + ' 版写的理由）';
      return '为什么改：未填写（最新一版第 ' + num(lastEntry.rev, 0) + ' 版还没写理由）';
    }
    return '为什么改：未填写（还没有历史版本）';
  }

  /**
   * 结论行。判据必须覆盖"名称 / 参数 / 指标"，不能只看原料行：
   * 只改了个名字就报「两份配方完全一致」，等于告诉用户"你没改过"（D2）。
   */
  function summaryHtml(model, a, b, metaA, metaB) {
    var s = model.summary;
    var head = '<div class="diff-summary">' +
      '<span class="diff-summary__name">' + esc(sideLabel(a, metaA)) + '</span>' +
      '<span class="diff-summary__arrow">' + icon('arrow', 13) + '</span>' +
      '<span class="diff-summary__name">' + esc(sideLabel(b, metaB)) + '</span>' +
      '</div>';
    var bits = [];
    if (s.added) bits.push('<span class="diff-count diff-count--add">新增 ' + s.added + ' 行</span>');
    if (s.removed) bits.push('<span class="diff-count diff-count--del">删除 ' + s.removed + ' 行</span>');
    if (s.changed) bits.push('<span class="diff-count diff-count--chg">修改 ' + s.changed + ' 处</span>');
    if (model.fieldsChanged) {
      bits.push('<span class="diff-count diff-count--chg">参数改动 ' + model.fieldsChanged + ' 项</span>');
    }
    if (model.metricsChanged) {
      bits.push('<span class="diff-count diff-count--chg">指标变化 ' + model.metricsChanged + ' 项</span>');
    }
    if (model.notesChanged) {
      bits.push('<span class="diff-count diff-count--chg">备注有改动</span>');
    }
    if (!bits.length) {
      if (model.nameChanged) {
        bits.push('<span class="diff-count diff-count--chg">只有名称不同</span>');
      } else if (model.notesChanged) {
        bits.push('<span class="diff-count diff-count--chg">只有备注不同</span>');
      } else {
        bits.push('<span class="diff-count diff-count--same">两份配方完全一致</span>');
      }
    } else if (model.nameChanged) {
      bits.push('<span class="diff-count diff-count--chg">名称也有改动</span>');
    }
    /* 「有 N 项没参与对比」必须挂在计数旁边：只少算不说明，
       用户会把"没法比"读成"没变化"（D3） */
    var tail = model.notComparedCount
      ? '<span class="diff-count diff-count--same">（另有 ' + model.notComparedCount + ' 项未参与对比）</span>'
      : '';
    return head + '<div class="diff-counts">' + bits.join('') + tail + '</div>';
  }

  /** 名称单独一行放在最上面：它是用户第一个要看的东西，混在"设备参数"里没人找得到 */
  function nameRowHtml(model) {
    var same = !model.nameChanged;
    return '<div class="diff-namerow" style="display:flex;align-items:center;gap:8px;' +
      'flex-wrap:wrap;margin:0 0 10px;font-size:13px">' +
      '<span class="u-xs u-dim" style="min-width:32px">名称</span>' +
      '<span style="color:' + (same ? 'var(--tx-2)' : 'var(--tx-3)') + '">' +
        esc(model.nameFrom || '（未命名）') + '</span>' +
      '<span class="diff-summary__arrow">' + icon('arrow', 12) + '</span>' +
      '<span style="font-weight:600;color:' + (same ? 'var(--tx-1)' : 'var(--amber-soft)') + '">' +
        esc(model.nameTo || '（未命名）') + '</span>' +
      (same
        ? '<span class="diff-count diff-count--same">相同</span>'
        : '<span class="diff-count diff-count--chg">已改</span>') +
      '</div>';
  }

  /** partial 版本的表头提示：这三段的缺失是"没存"，不是"被改了" */
  function partialNote(metaA, metaB) {
    var parts = [];
    if (metaA && metaA.isVersion && metaA.partial) parts.push('左');
    if (metaB && metaB.isVersion && metaB.partial) parts.push('右');
    if (!parts.length) return '';
    return '<div class="alert alert--warn" style="margin-bottom:8px">' +
      '<span class="alert__icon">' + icon('alert', 13) + '</span>' +
      '<span>' + parts.join(' / ') + '侧是压缩存档版本，未包含水质 / 糖化 / 碳化段；' +
      '这些项显示为「—」，不代表你把它们删掉了。</span></div>';
  }

  function renderInto(box, left, right, calcA, calcB) {
    if (!box) return null;
    var a = left.recipe, b = right.recipe;
    var metaA = left.meta || {}, metaB = right.meta || {};

    /* oversize 的版本 rec === null：**不许进 compare**。
       传了不会报错，但会得到一张全空的对比表，用户会以为"两版一模一样"。 */
    if (metaA.oversize || metaB.oversize) {
      var which = metaA.oversize ? '左' : '右';
      var rev = metaA.oversize ? metaA.rev : metaB.rev;
      box.innerHTML = '<div class="alert alert--info"><span class="alert__icon">' +
        icon('info', 13) + '</span><span>' + which + '侧选中的是第 ' + esc(String(rev)) +
        ' 版 · 体积过大，这一版没有保存快照，无法参与对比。换一版，或与当前内容对比。</span></div>';
      return null;
    }
    if (!a || !b) {
      box.innerHTML = '<div class="alert alert--warn"><span class="alert__icon">' +
        icon('alert', 13) + '</span><span>有一侧取不到配方内容。可能是那一版体积过大没存快照，' +
        '或者那份配方已经被删除——换一个来源再试。</span></div>';
      return null;
    }

    if (!BREW.RecipeDiff || typeof BREW.RecipeDiff.compare !== 'function') {
      box.innerHTML = '<div class="alert alert--warn"><span class="alert__icon">' +
        icon('alert', 13) + '</span><span>对比模块未载入（js/32-recipe-diff.js）。' +
        '界面已经就位，模块落盘后刷新即可用。</span></div>';
      return null;
    }

    var raw;
    try {
      raw = BREW.RecipeDiff.compare(a, b, calcA, calcB);
    } catch (e) {
      box.innerHTML = '<div class="alert alert--error"><span class="alert__icon">' +
        icon('alert', 13) + '</span><span>对比失败：' +
        esc(String((e && e.message) || '未知错误')) + '</span></div>';
      return null;
    }
    if (!raw || typeof raw !== 'object') {
      box.innerHTML = '<div class="alert alert--warn"><span class="alert__icon">' +
        icon('alert', 13) + '</span><span>对比模块没有返回结果。</span></div>';
      return null;
    }

    var model = normModel(raw, calcA, calcB, a, b, metaA, metaB);
    var warnHtml = '';
    var ws = model.warnings;
    for (var i = 0; i < ws.length; i++) {
      if (!ws[i]) continue;
      /* "两侧是同一个 id" 这种提示只在真的点开对比时才有意义，逐条列出 */
      warnHtml += '<div class="alert alert--info" style="margin-bottom:8px">' +
        '<span class="alert__icon">' + icon('info', 13) + '</span>' +
        '<span>' + esc(String(ws[i])) + '</span></div>';
    }

    /* 体积过大、只记了账的版本：它和 partial（裁过段）是两件不同的事，
       必须各说各的——partial 是"存了但缺段"，oversize 是"根本没存快照" */
    var unusable = unusableVersionCount((UI.recipe() || {}).id);
    var unusableHtml = unusable
      ? '<div class="alert alert--warn" style="margin-bottom:8px">' +
        '<span class="alert__icon">' + icon('alert', 13) + '</span>' +
        '<span>另有 ' + unusable + ' 个历史版本体积过大，没有保存快照，未参与对比' +
        '（也没有出现在「历史版本」下拉里，免得选了才发现比不了）。</span></div>'
      : '';

    /* 「这次为什么改」在摘要行**上方**：先看为什么，再看改了多少。
       两侧都不是版本时它显示"未填写 + 理由跟着版本走"，不是一行空白。 */
    box.innerHTML = intentRowHtml(metaA, metaB, (UI.recipe() || {}).id) +
      summaryHtml(model, a, b, metaA, metaB) +
      nameRowHtml(model) +
      partialNote(metaA, metaB) + unusableHtml + warnHtml +
      rowsHtml(model) + fieldsHtml(model) + metricsHtml(model) +
      '<p class="u-xs u-dim mt-12">只对比原料行、设备参数、目标值与关键指标。' +
      '批次记录、品鉴、成本属于批次数据，不参与配方对比。</p>';
    return model;
  }

  /* ======================================================================
   * D. 导出 Markdown
   * ====================================================================*/

  function mdCell(v) {
    return String(v === undefined || v === null ? '—' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function toMarkdown(model, a, b, metaA, metaB) {
    var L = [];
    L.push('# 配方对比：' + labelOf(a) + ' → ' + labelOf(b));
    L.push('');
    L.push('> 风月酿研所 导出 · ' + UI.dt(Date.now(), true));
    L.push('> 旧：' + sideLabel(a, metaA) + (a && a.id ? '（' + a.id + '）' : ''));
    L.push('> 新：' + sideLabel(b, metaB) + (b && b.id ? '（' + b.id + '）' : ''));
    L.push('> ' + mdIntentOf(metaA, metaB, (a && a.id) || (b && b.id) || ''));
    if ((metaA && metaA.partial) || (metaB && metaB.partial)) {
      L.push('> ⚠️ 其中一侧是压缩存档版本，未包含水质 / 糖化 / 碳化段，相关项未参与对比');
    }
    L.push('');
    var s = model.summary;
    var bits = [];
    bits.push('新增 ' + s.added + ' 行');
    bits.push('删除 ' + s.removed + ' 行');
    bits.push('修改 ' + s.changed + ' 处');
    if (model.fieldsChanged) bits.push('参数改动 ' + model.fieldsChanged + ' 项');
    if (model.metricsChanged) bits.push('指标变化 ' + model.metricsChanged + ' 项');
    if (model.notesChanged) bits.push('备注有改动');
    if (model.nameChanged) bits.push('名称已改');
    if (model.notComparedCount) bits.push('另有 ' + model.notComparedCount + ' 项未参与对比');
    L.push('**摘要**：' + bits.join(' · '));
    var anyChange = s.added || s.removed || s.changed || model.fieldsChanged ||
      model.metricsChanged || model.nameChanged || model.notesChanged;
    if (!anyChange) {
      L.push('');
      L.push('两份配方在上述所有维度上完全一致。');
    } else if (model.nameChanged && !s.added && !s.removed && !s.changed &&
        !model.fieldsChanged && !model.metricsChanged && !model.notesChanged) {
      L.push('');
      L.push('**只有名称不同**（其余原料、参数、指标都没有变化）。');
    }
    L.push('');

    for (var i = 0; i < model.rows.length; i++) {
      var sec = model.rows[i];
      if (sec.missing) {
        L.push('## ' + sec.label);
        L.push('');
        L.push('这一版没有保存' + sec.label + '（压缩存档），未参与对比。');
        L.push('');
        continue;
      }
      if (!sec.items.length) continue;
      L.push('## ' + sec.label);
      L.push('');
      L.push('| 变化 | 原料 | 原 → 现 |');
      L.push('| --- | --- | --- |');
      for (var j = 0; j < sec.items.length; j++) {
        var it = sec.items[j];
        var val;
        if (it.op === 'add') val = '— → ' + fmtAny(it.to);
        else if (it.op === 'del') val = fmtAny(it.from) + ' → —';
        else {
          val = fmtAny(it.from) + ' → ' + fmtAny(it.to);
          var f = num(it.from, 0), t = num(it.to, 0);
          if (f !== 0) {
            var p = (t - f) / f * 100;
            val += ' (' + (p >= 0 ? '+' : '') + fmt(p, 0) + '%)';
          }
        }
        if (it.unit) val += ' ' + it.unit;
        if (Array.isArray(it.extra) && it.extra.length) {
          var ebits = [];
          for (var q = 0; q < it.extra.length; q++) {
            var e = it.extra[q];
            ebits.push(e.label + ' ' + fmtAny(e.from) + ' → ' + fmtAny(e.to));
          }
          val += '；' + ebits.join(' · ');
        }
        L.push('| ' + (OP_TEXT[it.op] || '改量') + ' | ' + mdCell(it.name) + ' | ' + mdCell(val) + ' |');
      }
      L.push('');
    }

    if (model.fields.length) {
      L.push('## 设备参数与目标值');
      L.push('');
      L.push('| 字段 | 旧 | 新 |');
      L.push('| --- | --- | --- |');
      for (var k = 0; k < model.fields.length; k++) {
        var fd = model.fields[k];
        if (fd.notes) {
          L.push('| ' + mdCell(fd.notes) + ' | — | — |');
          continue;
        }
        L.push('| ' + mdCell(fd.label) + ' | ' +
          mdCell(fd.unavailable ? '—' : fmtAny(fd.from) + (fd.unit ? ' ' + fd.unit : '')) + ' | ' +
          mdCell(fd.unavailable ? '—' : fmtAny(fd.to) + (fd.unit ? ' ' + fd.unit : '')) + ' |');
      }
      L.push('');
    }

    L.push('## 关键指标');
    L.push('');
    L.push('| 指标 | 旧 | 新 | Δ |');
    L.push('| --- | --- | --- | --- |');
    for (var m = 0; m < model.metrics.length; m++) {
      var mt = model.metrics[m];
      var d = (num(mt.delta, 0) > 0 ? '+' : '') + fmtMetric(mt.kind, mt.delta).replace('%', '');
      if (mt.big) d += ' (' + fmt(mt.pct, 0) + '%)';
      L.push('| ' + mt.label + ' | ' + fmtMetric(mt.kind, mt.a) + ' | ' +
        fmtMetric(mt.kind, mt.b) + ' | ' + d + ' |');
    }
    L.push('');
    L.push('---');
    L.push('');
    L.push('*Δ 超过 5% 的项在软件内标红。数值来自 BrewLab 计算内核，非实测。*');
    return L.join('\n');
  }

  function download(name, text) {
    try {
      var Blob = root.Blob;
      if (!Blob || !root.URL || !root.URL.createObjectURL) throw new Error('no-blob');
      var url = root.URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      root.setTimeout(function () {
        try { root.URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 200);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ======================================================================
   * E. 模态框
   * ====================================================================*/

  Diff.open = function (opt) {
    opt = opt || {};
    var cur = UI.recipe() || UI.recipe();
    var pair = defaultPair(cur);
    var sel = {
      left: opt.left || pair.left,
      right: opt.right || pair.right,
      leftVer: 0,
      rightVer: 0
    };
    var lastModel = null;
    var lastPair = null;
    /* 只把"带快照"的版本放进下拉与索引；rec === null 的选不了（D1） */
    var vers = usableVersionsOf(cur && cur.id);

    var api = UI.Shell.modal({
      title: '版本对比',
      sub: '「我刚才改了什么」＝ 左边选同 id 的已保存版，右边保持工作副本',
      size: 'wide',
      body:
        /* 新配方、从没保存过：下拉里只剩工作副本，另给一行明说下一步。
           只把提示塞进下拉的 disabled 选项里没用——不点开根本看不见。 */
        ((!findSaved(cur && cur.id) && !usableVersionsOf(cur && cur.id).length)
          ? '<p class="u-xs u-dim" id="diff-nobase" style="margin:0 0 8px">' +
            '这份配方还没有已保存版本，先保存一次才能和历史对比。</p>'
          : '') +
        '<div class="diff-bar">' +
          '<div class="field">' +
            '<label class="field__label" for="diff-left">旧（基准）</label>' +
            '<select class="select select--sm" id="diff-left">' + optionsHtml(cur, sel.left) + '</select>' +
            versionSelectHtml('diff-left-ver', vers, sel.leftVer, sel.left) +
          '</div>' +
          '<span class="diff-bar__arrow">' + icon('arrow', 15) + '</span>' +
          '<div class="field">' +
            '<label class="field__label" for="diff-right">新（对比）</label>' +
            '<select class="select select--sm" id="diff-right">' + optionsHtml(cur, sel.right) + '</select>' +
            versionSelectHtml('diff-right-ver', vers, sel.rightVer, sel.right) +
          '</div>' +
          '<div class="diff-bar__quick">' +
            '<button type="button" class="btn btn-ghost btn-xs" data-diff="quick">' +
              icon('sparkle', 12) + '我刚才改了什么</button>' +
          '</div>' +
        '</div>' +
        '<div id="diff-out" class="mt-12"></div>',
      actions: [
        {
          label: '导出 Markdown',
          kind: 'ghost',
          /* close:false —— 导出不是"完成"，导完还要继续看 */
          close: false,
          act: function () {
            if (!lastModel || !lastPair) {
              toast('还没有可导出的对比结果', 'warn');
              return false;
            }
            var md = toMarkdown(lastModel, lastPair.a, lastPair.b, lastPair.metaA, lastPair.metaB);
            var name = 'fengyue-diff-' + UI.dt(Date.now()) + '.md';
            if (download(name, md)) {
              toast('已导出 ' + name + '（' + fmt(md.length / 1024, 1) + ' KB）', 'ok', 3000);
            } else {
              /* file:// 下个别浏览器禁下载：退回"复制文本"，别让按钮点了没反应 */
              UI.Shell.modal({
                title: '导出 Markdown',
                sub: '当前浏览器不允许直接下载，请手动复制',
                size: 'wide',
                body: '<textarea class="input" readonly rows="14" ' +
                  'style="width:100%;font-family:var(--mono);font-size:12.5px">' +
                  esc(md) + '</textarea>',
                actions: [{ label: '关闭', kind: 'ghost' }]
              });
            }
          }
        },
        { label: '关闭', kind: 'ghost' }
      ],
      onMount: function (a) {
        var out = a.query('#diff-out');
        var selL = a.query('#diff-left');
        var selR = a.query('#diff-right');

        /**
         * 算指标前先补默认值：历史版本的 rec 是**片段**（partial 版连 water 段都没有），
         * 直接丢给 UI.calc 会让 40 的兜底估算在 `recipe.water.source` 上抛 TypeError
         * （控制台会留一条 error，虽然界面不白）。归一化只补形状、不改数值，
         * 用来算 OG/FG/ABV/IBU/SRM 这些不依赖水段的指标是安全的。
         * 注意：比对行仍然用**原始 rec**，否则缺失段会被默认值填平，
         * 得出"钙 0 → 40"这种假差异。
         */
        function calcOf(ctx) {
          if (!ctx || !ctx.recipe) return null;
          try {
            /* 两侧都先归一化再算：Store 里可能有早期保存的配方缺 water 段，
               直接丢给 UI.calc 会让 40 的兜底估算在 `recipe.water.source` 上抛
               TypeError（控制台留一条 error，界面虽然不白但会让人以为坏了）。
               归一化只补形状、不改数值，不影响 OG/FG/ABV/IBU/SRM 的结论。
               注意：比对行仍然用**原始 rec**，否则缺失段会被默认值填平。 */
            var src = UI.normalizeRecipe(UI.clone(ctx.recipe));
            return UI.calc(src);
          } catch (e) {
            return null;
          }
        }

        /** 来源切换时显示/隐藏版本下拉，并同步它的选项 */
        function syncVerSelects() {
          var pairs = [
            { side: 'left', sel: selL, ver: a.query('#diff-left-ver') },
            { side: 'right', sel: selR, ver: a.query('#diff-right-ver') }
          ];
          for (var i = 0; i < pairs.length; i++) {
            var it = pairs[i];
            if (!it.ver) continue;
            var isVer = it.sel && it.sel.value === 'ver';
            it.ver.style.display = isVer ? '' : 'none';
            if (!isVer) continue;
            var html = '';
            for (var v = 0; v < vers.length; v++) {
              html += '<option value="' + attr(String(v)) + '">' +
                esc(versionLabel(vers[v], v)) + '</option>';
            }
            it.ver.innerHTML = html;
            it.ver.value = String(sel[it.side + 'Ver'] || 0);
          }
        }

        function run() {
          var leftCtx = resolve(sel.left, sel.leftVer);
          var rightCtx = resolve(sel.right, sel.rightVer);
          if (!leftCtx || !rightCtx) {
            if (out) {
              /* 历史版本为空时不要报错，给"还没有历史"的说明 */
              var isEmptyVer = (sel.left === 'ver' && !vers.length) ||
                (sel.right === 'ver' && !vers.length);
              out.innerHTML = '<div class="alert alert--' + (isEmptyVer ? 'info' : 'warn') + '">' +
                '<span class="alert__icon">' + icon(isEmptyVer ? 'info' : 'alert', 13) + '</span><span>' +
                (isEmptyVer
                  ? '这个配方还没有历史版本，下次保存开始记录。'
                  : '有一侧选的配方已经找不到（可能被删除了），请重新选择。') +
                '</span></div>';
            }
            lastModel = null;
            return;
          }
          var calcA = calcOf(leftCtx), calcB = calcOf(rightCtx);
          lastModel = renderInto(out, leftCtx, rightCtx, calcA, calcB);
          lastPair = {
            a: leftCtx.recipe, b: rightCtx.recipe,
            metaA: leftCtx.meta, metaB: rightCtx.meta
          };
        }

        /* 只在内容真的变了才重算：select 的 change 在键盘上下键连按时会连发 */
        a.body.addEventListener('change', function (e) {
          if (!e.target) return;
          var id = e.target.id;
          if (id === 'diff-left') { sel.left = e.target.value; syncVerSelects(); run(); return; }
          if (id === 'diff-right') { sel.right = e.target.value; syncVerSelects(); run(); return; }
          if (id === 'diff-left-ver') { sel.leftVer = num(e.target.value, 0); run(); return; }
          if (id === 'diff-right-ver') { sel.rightVer = num(e.target.value, 0); run(); return; }
        });

        a.body.addEventListener('click', function (e) {
          /* 「补一句 ›」：事后给右侧那一版补理由。
             写回的是 metaB.entry 这个活对象，不是按 rev 再查一遍——
             条目可能刚被水位压掉，按 rev 查会查到别的版本上。 */
          var fill = e.target.closest ? e.target.closest('[data-diff-intent]') : null;
          if (fill) {
            var curR = UI.recipe() || {};
            var which = fill.getAttribute('data-diff-intent');
            var mB = lastPair && lastPair.metaB;
            /* latest = 两侧都不是版本时的兜底：写回当前配方最新那一版 */
            var target = null;
            if (which === 'latest') {
              var vs = usableVersionsOf(curR.id);
              target = vs.length ? vs[vs.length - 1] : null;
            } else if (mB && mB.entry) {
              target = mB.entry;
            }
            if (target && curR.id) {
              openIntentEditor(curR.id, target, function () { run(); });
            } else {
              toast('这一版不在这份配方的历史里，没法在这里补', 'warn', 3000);
            }
            return;
          }
          var btn = e.target.closest ? e.target.closest('[data-diff]') : null;
          if (!btn) return;
          if (btn.getAttribute('data-diff') !== 'quick') return;
          var c = UI.recipe();
          var same = (c && c.id) ? findSaved(c.id) : null;
          if (!same) {
            toast('这份配方还没保存过，没有"改动前"的版本可比', 'warn', 3200);
            return;
          }
          sel.left = 'saved:' + same.id;
          sel.right = 'cur';
          if (selL) selL.value = sel.left;
          if (selR) selR.value = sel.right;
          syncVerSelects();
          run();
        });

        syncVerSelects();
        run();
      }
    });

    return api;
  };

  Diff.available = function () {
    return !!(BREW.RecipeDiff && typeof BREW.RecipeDiff.compare === 'function');
  };

  /* ======================================================================
   * F. 改动理由：一行摘要 + 保存后的入口（v1.4）
   * ====================================================================*/

  /** 归一化 + 算指标，任一步失败都返回 null。
      老配方可能缺 water 段，UI.calc 会抛——摘要宁可不显示，也不能让
      整个谱系页因为一个节点而白屏。 */
  function safeCalc(recipe) {
    if (!recipe) return null;
    try {
      if (typeof UI.normalizeRecipe !== 'function' || typeof UI.calc !== 'function') return null;
      return UI.calc(UI.normalizeRecipe(UI.clone(recipe)));
    } catch (e) { return null; }
  }

  /** 一行里怎么说"这一行原料变了"：改量 X +0.5 kg / 新增 X 30 g / 删除 X 0.2 kg */
  function rowDigest(it) {
    var unit = it.unit ? ' ' + it.unit : '';
    if (it.op === 'add') return '新增 ' + it.name + ' ' + fmtAny(it.to) + unit;
    if (it.op === 'del') return '删除 ' + it.name + ' ' + fmtAny(it.from) + unit;
    var d = num(it.to, 0) - num(it.from, 0);
    if (!d) return '改量 ' + it.name;
    return '改量 ' + it.name + ' ' + (d > 0 ? '+' : '−') + fmtAny(Math.abs(d)) + unit;
  }

  /**
   * 「这一版改了什么」的一行摘要 —— 谱系节点在没有 intent 时用它兜底。
   * 复用 32 的 compare + 本文件的 normModel，**不实现第二套比对**：
   * 两套阈值迟早分叉（4.5→5.0 算不算改？），那时同一版改动会在谱系和对比页
   * 说出两句不一样的话。
   * @returns {string} 无事可说时返回 ''（调用方据此显示"未填写"）
   */
  function digestBetween(a, b) {
    if (!a || !b) return '';
    if (!BREW.RecipeDiff || typeof BREW.RecipeDiff.compare !== 'function') return '';
    var ca = safeCalc(a), cb = safeCalc(b);
    var raw;
    try { raw = BREW.RecipeDiff.compare(a, b, ca, cb); } catch (e) { return ''; }
    var model = normModel(raw, ca, cb, a, b, {}, {});
    var out = [], i, j;

    for (i = 0; i < model.rows.length && out.length < 2; i++) {
      var sec = model.rows[i];
      if (sec.missing || !sec.items.length) continue;
      for (j = 0; j < sec.items.length && out.length < 2; j++) out.push(rowDigest(sec.items[j]));
    }
    if (!out.length) {
      for (i = 0; i < model.fields.length; i++) {
        var f = model.fields[i];
        if (f.notes) { if (f.changed) out.push('备注有改动'); continue; }
        if (f.unavailable || f.changed === false) continue;
        out.push(String(f.label || '') + ' ' + fmtAny(f.from) + (f.unit ? ' ' + f.unit : '') +
          ' → ' + fmtAny(f.to) + (f.unit ? ' ' + f.unit : ''));
        break;
      }
    }
    if (!out.length) {
      for (i = 0; i < model.metrics.length; i++) {
        var mt = model.metrics[i];
        var dv = num(mt.delta, 0);
        if (Math.abs(dv) < 1e-9) continue;
        out.push(mt.label + ' ' + (dv > 0 ? '+' : '−') +
          fmtMetric(mt.kind, Math.abs(dv)).replace('%', ''));
        break;
      }
    }
    if (!out.length && model.nameChanged) {
      out.push('改名：' + (model.nameFrom || '未命名') + ' → ' + (model.nameTo || '未命名'));
    }
    /* 还空着，说明改动不在 32 的对比面（原料行 / 设备参数 / 目标值 / 指标）里。
       糖化步骤温度、备注措辞就是这种：内容指纹变了，diff 一无所获。
       如实返回空串，别硬编一句"改了一点点"——那种话对复盘毫无用处。 */
    return out.join('；');
  }

  /**
   * 谱系节点用：某份配方**最新一版**的理由 + 改动摘要。
   * @returns {null | {rev, at, intent, digest, hasPrev, entry}}
   *   null   = 这份配方还没有历史版本
   *   digest = '' 表示"没有上一版"或"对比面里看不出来"
   */
  Diff.reasonOf = function (recipeId) {
    var vers = usableVersionsOf(recipeId);
    if (!vers.length) return null;
    var last = vers[vers.length - 1];
    var prev = vers.length > 1 ? vers[vers.length - 2] : null;
    return {
      rev: num(last.rev, vers.length),
      at: num(last.at, 0),
      intent: intentText(last),
      /* 只有一版时不拿工作副本凑数：那会变成"和没保存的改动比"，
         同一个节点每次看都给出不同结论 */
      digest: prev ? digestBetween(prev.rec, last.rec) : '',
      hasPrev: !!prev,
      entry: last
    };
  };

  /* ---------------- F.2 保存后的入口：不打断，点了才问 ---------------- */

  var nudgeShown = {};   /* recipeId@hash → 1：同一版只邀请一次 */

  function latestEntryOf(recipeId) {
    var arr = versionsOf(recipeId);
    return arr.length ? arr[arr.length - 1] : null;
  }

  /**
   * 这条版本是"这次保存刚建出来的"吗？
   * 判据是时间窗：pushVersion 在 saveRecipe 的调用栈里跑，条目时间戳就是
   * "刚刚"。1800ms 足够宽（同一次保存的事件循环 + 下面 240ms 的延迟），
   * 又足够窄（不会把昨天那一版认成刚建的）。
   * 不用"条数变多"判断：水位裁剪会 shift()，条数可能不变。
   */
  function isFreshEntry(entry) {
    var at = num(entry && entry.at, 0);
    if (!at) return false;
    var d = Date.now() - at;
    return d >= 0 && d <= 1800;
  }

  /**
   * 保存成功后那条 toast 里的「补一句为什么改 ›」。
   *
   * 为什么自己造一个 toast 节点，而不是给 Shell.toast 加参数：
   *   40-ui-shell 的 toast 是纯通知（一段文字 + 关闭）。要让它"能带按钮"，
   *   得改它的签名和样式表，而这两处本版都不归本文件动。
   *   这里只往 #toasts（公开挂载点）追加一个**同构**节点：类名、图标、
   *   关闭按钮、最多 4 条的上限全照它的规矩来，所以看上去是同一个东西。
   *
   * 为什么延迟 240ms 出现：
   *   42 的「已保存《X》」是在 saveRecipe **返回之后**才 Toast 的，
   *   而 recipeSaved 事件在 saveRecipe **里面**就发了。不延迟的话这条邀请
   *   会排在上一条前面（#toasts 是 append 的列），读起来像"先提醒、后确认"。
   */
  function showIntentNudge(recipe, entry) {
    var host = document.getElementById('toasts');
    if (!host) return null;
    var key = String(recipe.id) + '@' + String(entry.hash || entry.at || '');
    var t = document.createElement('div');
    t.className = 'toast toast--ok';
    t.setAttribute('role', 'status');
    /* 测试与排查用：这一条是"邀请"，不是通知 */
    t.setAttribute('data-intent-nudge', key);

    var timer = null;
    function kill() {
      if (timer) { root.clearTimeout(timer); timer = null; }
      if (!t.parentNode) return;
      t.classList.add('is-out');
      root.setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 180);
    }

    t.innerHTML =
      '<span class="toast__icon">' + icon('check', 15) + '</span>' +
      '<div class="toast__body">' +
        '<div class="toast__msg">已记下第 ' + esc(String(num(entry.rev, 1))) + ' 版</div>' +
        '<button type="button" class="btn btn-ghost btn-xs" data-intent-open ' +
          'style="margin-top:6px">补一句为什么改 ›</button>' +
      '</div>' +
      '<button type="button" class="toast__close" aria-label="关闭提示">' + icon('x', 13) + '</button>';

    t.querySelector('.toast__close').addEventListener('click', kill);
    t.querySelector('[data-intent-open]').addEventListener('click', function () {
      if (timer) { root.clearTimeout(timer); timer = null; }
      t.setAttribute('data-intent-clicked', '1');
      openIntentEditor(recipe.id, entry, kill);
    });

    host.appendChild(t);
    while (host.children.length > 4) host.removeChild(host.firstChild);
    /* 12s，比普通 toast（3s）长得多：这是一次邀请，不是通知。
       12s 内没点就等于"未填写"——绝不为了收集理由去弹模态打断保存。 */
    timer = root.setTimeout(kill, 12000);
    return t;
  }

  /**
   * 这次保存要不要发邀请。三条任一不满足就安静：
   *   ① 真的建出了新版本（内容没变不建版本，见 00-core 规则③）
   *   ② 不是第 1 版——基线版的"理由"就是配方本身，问了也是废话
   *   ③ 这一版还没写（带 intent 保存的、刚补过的不再问）
   */
  function maybeOfferIntent(recipe) {
    if (!recipe || !recipe.id) return;
    var entry = latestEntryOf(recipe.id);
    if (!entry || !isFreshEntry(entry)) return;
    if (num(entry.rev, 0) <= 1) return;
    if (intentText(entry)) return;
    var key = String(recipe.id) + '@' + String(entry.hash || entry.at || '');
    if (nudgeShown[key]) return;
    nudgeShown[key] = 1;
    root.setTimeout(function () { showIntentNudge(recipe, entry); }, 240);
  }

  /**
   * 单行输入框：≤60 字、带字数计数、示例占位符。
   * 只有用户点了 toast 上的按钮（或对比页的「补一句 ›」）才会出现——
   * 保存本身永远不打断。
   */
  function openIntentEditor(recipeId, entry, after) {
    var M = intentApi();
    if (!M || typeof M.setVersionIntent !== 'function') {
      toast('改动意图模块未载入（js/30-recipe.js），这句理由暂时存不下来', 'warn', 3600);
      return null;
    }
    if (!UI.Shell || typeof UI.Shell.modal !== 'function' || !entry) return null;

    var max = intentMax();
    var rev = num(entry.rev, 0);
    var val = intentText(entry);

    var api = UI.Shell.modal({
      title: '这一版为什么改',
      sub: '第 ' + rev + ' 版 · 一句话就够（≤' + max + ' 字），留空等于不填',
      size: 'narrow',
      body:
        '<label class="field__label" for="intent-input">改动意图</label>' +
        '<input class="input" id="intent-input" type="text" autocomplete="off" ' +
          'maxlength="' + max + '" value="' + attr(val) + '" ' +
          'placeholder="例如：提高糖化温度到 67°C 换更多酒体">' +
        '<div class="u-xs u-dim" style="display:flex;gap:8px;justify-content:space-between;margin-top:8px">' +
          '<span>写给三个月后的自己：当时想解决什么问题</span>' +
          '<span><b id="intent-count">' + intentLen(val) + '</b>/' + max + '</span>' +
        '</div>' +
        '<p class="u-xs u-dim" style="margin:8px 0 0">' +
          '理由只挂在这一版上，不会覆盖别的版本；它不参与内容指纹，' +
          '补写理由不会产生新版本。</p>',
      actions: [
        { label: '跳过', kind: 'ghost' },
        {
          /* ⚠️ 这里**不要**写 close:false。40 的 Shell 语义是"def.close === false
             ⇒ 永远保留模态"，它压过 act 的返回值——那样点「存入这一版」会把
             理由写进去、却留一个空输入框在屏幕上。act 返回非 false 即可关闭。 */
          label: '存入这一版', kind: 'primary',
          act: function () { return commit(); }
        }
      ],
      onMount: function (a) {
        var input = a.query('#intent-input');
        var count = a.query('#intent-count');
        if (!input) return;
        /* maxlength 按 UTF-16 计，一个 emoji 会被算成 2 个字。
           超了就用 30 的口径（码点）截断回写，用户看到的数才是真的。 */
        input.addEventListener('input', function () {
          if (intentLen(input.value) > max && typeof M.normIntent === 'function') {
            input.value = M.normIntent(input.value);
          }
          if (count) count.textContent = String(intentLen(input.value));
        });
      }
    });

    function commit() {
      var input = api && api.query ? api.query('#intent-input') : null;
      var text = M.setVersionIntent(recipeId, entry, input ? input.value : '');
      if (typeof after === 'function') { try { after(); } catch (e) { /* ignore */ } }
      if (text) toast('已记下这一版为什么改', 'ok', 2600);
      else toast('这一版留空了，随时可以在版本对比页补', 'info', 3000);
      return true;   /* Shell 只在 act 返回 false 时保留模态，true = 关掉 */
    }

    return api;
  }

  Diff.openIntentEditor = openIntentEditor;

  /* 保存 → 邀请。包一层 try：这是界面上的小事，
     绝不能让一个 toast 的问题把"保存"这条主路径搞挂。 */
  if (BREW.Bus && typeof BREW.Bus.on === 'function') {
    BREW.Bus.on('recipeSaved', function (stored) {
      try { maybeOfferIntent(stored); } catch (e) { /* ignore */ }
    });
  }

})(typeof window !== 'undefined' ? window : globalThis);
