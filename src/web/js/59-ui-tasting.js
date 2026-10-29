/* ============================================================================
 * 风月酿研所 — 59-ui-tasting.js
 * ----------------------------------------------------------------------------
 * 职责：BJCP 品鉴打分（Alt+9）。五段满分 12/3/20/5/10，合计 50。
 *
 * 三条口径（来自 21 号数据表的约定，不能改）：
 *
 * 1. **权威是每段的 score，子项只是提示。** BJCP 允许"整体印象"与子项相加
 *    不一致（比如五项子项都一般，但整体很讨喜），所以**绝不**把子项加总当分数。
 *    子项在这里只做"打勾提醒"——帮你回忆该找什么味道，不参与算术。
 *
 * 2. **单向回写**：写 `tasting.aroma/appearance/flavor/mouthfeel/overall` 之后，
 *    `total` 一律交给 `Batch.calcTastingTotal()`，不自己写第二套求和。
 *
 * 3. **子项明细存 `tasting.detail`**（键名全小写）。null = 还没打分。
 *
 * 为什么不塞进 46：46 的 detailHtml 已经很长，再放五个表单会变成"什么都装
 * 在里面"的巨函数。本文件只持有 batchId，每次通过 Store 取最新批次——
 * 拿深拷贝的旧副本去覆盖新读数，是这类面板最典型的丢数据方式。
 *
 * 依赖：BREW.DB.tastingGuide（21）、BREW.TastingGuide（29，可缺）、
 *       BREW.Charts.radar（48）、BREW.Batch.calcTastingTotal（35，可缺）、BREW.UI
 * 对外：BREW.UI.TastingView
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  function toast(msg, kind, ms) {
    if (UI.Shell && UI.Shell.toast) UI.Shell.toast(msg, kind || 'info', ms || 2600);
  }

  /* ======================================================================
   * A. 数据
   * ====================================================================*/

  var SCORE_KEYS = ['aroma', 'appearance', 'flavor', 'mouthfeel', 'overall'];

  var state = { batchId: '', sectionId: '' };
  var host = null;
  var saveTimer = 0;

  function store() { return BREW.Store || null; }

  function batches() {
    try {
      var list = store() ? store().listBatches() : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function getBatch(id) {
    if (!id) return null;
    var list = batches();
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  /** 当前批次：优先 state，其次"已经打过分的最近一个"，再次最新一个 */
  function currentBatch() {
    var b = getBatch(state.batchId);
    if (b) return b;
    var list = batches();
    for (var i = list.length - 1; i >= 0; i--) {
      var t = list[i] && list[i].tasting;
      if (t && SCORE_KEYS.some(function (k) { return t[k] !== null && t[k] !== undefined; })) {
        state.batchId = list[i].id;
        return list[i];
      }
    }
    if (list.length) {
      state.batchId = list[list.length - 1].id;
      return list[list.length - 1];
    }
    state.batchId = '';
    return null;
  }

  /** 21 号数据表：五段（顺序固定，不能按满分重排） */
  function sections() {
    var g = (BREW.DB && BREW.DB.tastingGuide) || null;
    var list = (g && Array.isArray(g.sections)) ? g.sections : [];
    /* 缺数据时给一份最小骨架：宁可少子项提示，也不能白屏 */
    if (!list.length) {
      return [
        { id: 'aroma', zh: '香气', max: 12, sub: [] },
        { id: 'appearance', zh: '外观', max: 3, sub: [] },
        { id: 'flavor', zh: '风味', max: 20, sub: [] },
        { id: 'mouthfeel', zh: '口感', max: 5, sub: [] },
        { id: 'overall', zh: '整体', max: 10, sub: [] }
      ];
    }
    return list;
  }

  function sectionOf(id) {
    var list = sections();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || null;
  }

  /** 评语锚点：得分 / 满分的比例落在哪一档（文案来自 21 的 bands） */
  function bandOf(ratio) {
    var g = (BREW.DB && BREW.DB.tastingGuide) || null;
    var bands = (g && Array.isArray(g.bands)) ? g.bands : [];
    for (var i = 0; i < bands.length; i++) {
      if (ratio >= num(bands[i].min, 0)) return bands[i];
    }
    return null;
  }

  function tastingOf(b) {
    var t = (b && b.tasting) || {};
    /* 只补形状，不覆盖已有值：null 表示"没打分"，0 是合法分数 */
    var out = {};
    for (var i = 0; i < SCORE_KEYS.length; i++) {
      var k = SCORE_KEYS[i];
      out[k] = (t[k] === undefined) ? null : t[k];
    }
    out.notes = (typeof t.notes === 'string') ? t.notes : '';
    out.detail = (t.detail && typeof t.detail === 'object') ? t.detail : null;
    out.total = (t.total === undefined) ? null : t.total;
    out.date = t.date === undefined ? null : t.date;
    return out;
  }

  function totalOf(t) {
    if (BREW.Batch && typeof BREW.Batch.calcTastingTotal === 'function') {
      var v = BREW.Batch.calcTastingTotal(t);
      if (v !== null && v !== undefined) return v;
    }
    /* 兜底：五段直接相加（与 35 号口径一致：只加正式分段，不加子项） */
    var sum = 0, any = false;
    for (var i = 0; i < SCORE_KEYS.length; i++) {
      var v2 = t[SCORE_KEYS[i]];
      if (v2 === null || v2 === undefined || !isFinite(v2)) continue;
      any = true;
      sum += num(v2, 0);
    }
    return any ? Math.round(sum * 10) / 10 : null;
  }

  function gradeOf(total) {
    if (BREW.Batch && typeof BREW.Batch.tastingGrade === 'function') return BREW.Batch.tastingGrade(total);
    if (total === null) return null;
    if (total >= 45) return { label: '优秀（可参赛获奖）', level: 'excellent' };
    if (total >= 38) return { label: '很好', level: 'great' };
    if (total >= 30) return { label: '良好', level: 'good' };
    if (total >= 21) return { label: '可接受，有缺陷', level: 'fair' };
    return { label: '有明显缺陷', level: 'poor' };
  }

  /**
   * 落盘。写 score 之后**单向**重算 total，绝不反向拆 total。
   * 注意：Store.saveBatch 现在按值入库，返回的可能是副本，所以这里不保留
   * 传进去的那个对象引用，下次渲染一律重新 getBatch。
   */
  function persist(batch, t, opts) {
    if (!batch || !t) return;
    batch.tasting = t;
    var total = totalOf(t);
    t.total = total;
    try {
      if (store() && typeof store().saveBatch === 'function') store().saveBatch(batch);
      /* 打字过程中不每次都 flush，停手 400ms 或切换 tab 时再落 */
      if (opts && opts.flush && typeof store().flushNow === 'function') store().flushNow();
    } catch (e) {
      toast('保存失败：' + ((e && e.message) || '未知错误'), 'error');
    }
  }

  /* ======================================================================
   * B. 渲染
   * ====================================================================*/

  function render(el) {
    host = el;
    if (!BREW.DB || !BREW.DB.tastingGuide) {
      el.innerHTML = '<div class="section-title"><h2>品鉴</h2>' +
        '<p>按 BJCP 五段打分，合计 50 分</p></div>' +
        '<div class="card"><div class="card__body">' +
        UI.emptyState('品鉴指引未载入',
          'js/21-data-tasting.js 没有成功执行，五段分值算不出来。', { art: 'beer' }) +
        '</div></div>';
      return;
    }
    paint(true);
  }

  function paint(full) {
    if (!host) return;
    var batch = currentBatch();
    var list = sections();

    if (!state.sectionId || !sectionOf(state.sectionId)) state.sectionId = (list[0] || {}).id || 'aroma';

    var head = '<div class="section-title">' +
      '<h2>品鉴</h2>' +
      '<p>五段分别给分，合计 50；子项只是打勾提醒，不参与求和</p>' +
      '<span class="spacer"></span>' +
      batchSelector(batch) +
      '</div>';

    if (!batches().length) {
      /* 没有批次时不要只丢一句"先去建批次"。
         这个风格该挑什么毛病、哪些缺陷基本不该有，本来就跟批次无关——
         直接拿当前配方的风格把检查表摊开，用户至少能先学到东西。 */
      var curStyle = '';
      try { curStyle = (UI.recipe() || {}).styleId || ''; } catch (e) { curStyle = ''; }
      var blocks = guideBlocks(curStyle);
      host.innerHTML = head +
        '<div class="card">' +
          '<div class="card__head"><h2>还没有批次可打分</h2><span class="spacer"></span>' +
            '<button type="button" class="btn btn-primary btn-sm" data-act="go-batch">先去建一个批次</button></div>' +
          '<div class="card__body">' +
            '<p class="u-sm" style="margin:0 0 10px">品鉴是打在批次上的：同样一份配方，换个酵母或换个发酵温度，喝起来就是两款酒。' +
              '先建批次，这里的分数才有归属。</p>' +
            (blocks
              ? '<div class="u-xs u-dim" style="margin:14px 0 6px">不过这张检查表现在就能用——按当前配方的风格：</div>' +
                '<div class="tst-guide__blocks">' + blocks + '</div>'
              : UI.emptyState('先把配方风格选上',
                  '配方页选定啤酒风格后，这里会给出该风格常见缺陷的排查顺序。', { art: 'search', small: true })) +
          '</div>' +
        '</div>';
      /* 这里必须就地绑定：空态在下面那段 addEventListener 之前就 return 了，
         委托监听根本没机会挂上——之前用委托，点了没反应。 */
      var goBtn = host.querySelector('[data-act="go-batch"]');
      if (goBtn) {
        goBtn.addEventListener('click', function () {
          try { BREW.UI.Shell.go('batch'); } catch (e) { /* 视图没载入就算了 */ }
        });
      }
      return;
    }
    if (!batch) {
      host.innerHTML = head + '<div class="card"><div class="card__body">' +
        UI.emptyState('选一个批次', '从右上角的下拉里挑一个。', { art: 'search' }) + '</div></div>';
      return;
    }

    var t = tastingOf(batch);

    host.innerHTML = head +
      '<div class="tst-layout">' +
        '<div class="tst-main card">' +
          '<div class="tabs" role="tablist" id="tst-tabs">' + tabsHtml(list, t) + '</div>' +
          '<div class="card__body" id="tst-panel">' + panelHtml(list, t) + '</div>' +
          '<div class="card__foot">' +
            '<span class="u-xs u-dim">给分依据写在每段提示里；改分立即保存到本机</span>' +
            '<span class="spacer"></span>' +
            '<button type="button" class="btn btn-quiet btn-xs" data-tst="clear">清空这份品鉴</button>' +
          '</div>' +
        '</div>' +
        '<div class="tst-side">' +
          '<div class="card">' +
            '<div class="card__head"><h2>总览</h2><span class="spacer"></span>' +
              '<span class="u-xs u-dim" id="tst-band"></span></div>' +
            '<div class="card__body card__body--tight">' +
              '<div class="tst-total" id="tst-total"></div>' +
              '<div class="tst-radar"><canvas id="tst-radar" role="img" ' +
                'aria-label="五段得分的雷达图"></canvas></div>' +
            '</div>' +
          '</div>' +
          '<div class="card mt-16" id="tst-guide"></div>' +
        '</div>' +
      '</div>';

    bindOnce(host);
    updateTotals();
    paintGuide(batch);
  }

  function batchSelector(cur) {
    var list = batches();
    if (list.length <= 1) return '';
    var opts = '';
    for (var i = list.length - 1; i >= 0; i--) {
      var b = list[i];
      if (!b || !b.id) continue;
      var has = b.tasting && totalOf(tastingOf(b)) !== null;
      opts += '<option value="' + attr(b.id) + '"' + (cur && b.id === cur.id ? ' selected' : '') + '>' +
        esc((b.batchNo || '') + ' · ' + (b.name || '未命名')) + (has ? '（已打分）' : '') + '</option>';
    }
    return '<select class="select select--sm" id="tst-batch" aria-label="选择批次" style="max-width:260px">' +
      opts + '</select>';
  }

  function tabsHtml(list, t) {
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var v = t[s.id];
      var got = (v === null || v === undefined) ? '—' : fmt(v, 1);
      html += '<button type="button" class="tab' + (state.sectionId === s.id ? ' is-on' : '') + '" ' +
        'role="tab" aria-selected="' + (state.sectionId === s.id) + '" data-tst-tab="' + attr(s.id) + '">' +
        esc(s.zh) + '<span class="tab__count">' + esc(got) + '/' + esc(String(s.max)) + '</span></button>';
    }
    return html;
  }

  function panelHtml(list, t) {
    var s = sectionOf(state.sectionId) || list[0];
    if (!s) return '';
    var v = t[s.id];
    var has = (v !== null && v !== undefined);
    var ratio = has ? Math.max(0, Math.min(1, num(v, 0) / num(s.max, 1))) : 0;
    var band = has ? bandOf(ratio) : null;
    var detail = (t.detail && t.detail[s.id]) || {};
    var picked = (detail.picked && typeof detail.picked === 'object') ? detail.picked : {};

    var subHtml = '';
    var subs = Array.isArray(s.sub) ? s.sub : [];
    for (var i = 0; i < subs.length; i++) {
      var sub = subs[i];
      var on = !!picked[sub.id];
      subHtml += '<button type="button" class="tst-sub' + (on ? ' is-on' : '') + '" ' +
        'data-tst-sub="' + attr(sub.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<b>' + esc(sub.zh) + '</b>' +
        (sub.hint ? '<span>' + esc(sub.hint) + '</span>' : '') +
        '</button>';
    }

    return '<div class="tst-sec">' +
        '<div class="tst-sec__head">' +
          '<div>' +
            '<div class="tst-sec__title">' + esc(s.zh) +
              '<span class="tst-sec__max">满分 ' + esc(String(s.max)) + '</span></div>' +
            (s.hint ? '<p class="tst-sec__hint">' + esc(s.hint) + '</p>' : '') +
          '</div>' +
          '<div class="tst-score">' +
            '<input class="input input--num tst-score__input" id="tst-score" type="number" ' +
              'min="0" max="' + attr(s.max) + '" step="0.5" value="' + attr(has ? v : '') + '" ' +
              'placeholder="—" aria-label="' + attr(s.zh + '得分，满分 ' + s.max) + '">' +
            '<span class="tst-score__max">/ ' + esc(String(s.max)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="tst-bar"><i style="width:' + attr(ratio * 100) + '%"></i></div>' +
        (band ? '<div class="tst-band"><b>' + esc(band.zh) + '</b>' +
          (band.hint ? '<span>' + esc(band.hint) + '</span>' : '') + '</div>' : '') +
        (subHtml ? '<div class="tst-subs-label">找什么味道（打勾只帮你回忆，不加分）</div>' +
          '<div class="tst-subs">' + subHtml + '</div>' : '') +
        '<div class="field mt-16">' +
          '<label class="field__label" for="tst-note">这一段的评语（可选）</label>' +
          '<input class="input" id="tst-note" type="text" maxlength="120" value="' +
            attr(detail.note || '') + '" placeholder="例如：酒花偏药草，收口略涩">' +
        '</div>' +
      '</div>';
  }

  /** 只更新总览与雷达：打字时不整块重绘，否则输入框会丢焦点 */
  function updateTotals() {
    var batch = currentBatch();
    if (!batch) return;
    var t = tastingOf(batch);
    var list = sections();
    var total = totalOf(t);
    var grade = gradeOf(total);

    var box = document.getElementById('tst-total');
    if (box) {
      var maxAll = 0;
      var segs = '';
      for (var i = 0; i < list.length; i++) {
        maxAll += num(list[i].max, 0);
        var v = t[list[i].id];
        var has = (v !== null && v !== undefined);
        segs += '<div class="tst-total__row">' +
          '<span>' + esc(list[i].zh) + '</span>' +
          '<span class="u-mono">' + (has ? esc(fmt(v, 1)) : '—') + ' / ' + esc(String(list[i].max)) + '</span>' +
          '</div>';
      }
      box.innerHTML = '<div class="tst-total__num">' + (total === null ? '—' : esc(fmt(total, 1))) +
          '<span> / ' + maxAll + '</span></div>' +
        '<div class="tst-total__grade' + (grade ? ' is-' + attr(grade.level) : '') + '">' +
          esc(grade ? grade.label : '还没打分') + '</div>' +
        '<div class="tst-total__rows">' + segs + '</div>';
    }

    var bandBox = document.getElementById('tst-band');
    if (bandBox) bandBox.textContent = total === null ? '' : '合计 ' + fmt(total, 1) + ' / 50';

    var cv = document.getElementById('tst-radar');
    if (cv && BREW.Charts && typeof BREW.Charts.radar === 'function') {
      var axes = [];
      for (var j = 0; j < list.length; j++) {
        axes.push({
          label: list[j].zh,
          max: num(list[j].max, 1),
          value: (t[list[j].id] === null || t[list[j].id] === undefined) ? null : num(t[list[j].id], 0)
        });
      }
      try {
        /* 雷达色走 48 的令牌缓存（v1.6）。原来是写死的 #e8a33d ——
           v1.5 那个亮橙，在纸面 + 青灰的新配色里是唯一一块"上一代的颜色"。
           取不到（48 没加载）就传空串：48 的 radar 里 opts.color || C.primary，
           空串会让它落到自己的默认主序列色，比传一个假色值安全。 */
        BREW.Charts.radar(cv, axes, {
          color: (BREW.Charts.COLORS && BREW.Charts.COLORS.primary) || ''
        });
      } catch (e) { /* 画不出图不能影响打分 */ }
    }
  }

  /* 风格缺陷清单：抽成两个共享函数，空态和右侧栏都用同一份渲染。
     原来这段逻辑嵌在 paintGuide 里，没有批次时整页只剩一句"先去建批次"——
     而"这个风格该挑什么毛病"本来不依赖任何批次就有内容。 */
  function guideList(title, arr, cls) {
    if (!arr || !arr.length) return '';
    var li = '';
    for (var i = 0; i < arr.length; i++) {
      var f = arr[i] || {};
      li += '<li class="' + cls + '"><b>' + esc(String(f.zh || f.id || '')) + '</b>' +
        (f.hint ? '<span>' + esc(String(f.hint)) + '</span>' : '') + '</li>';
    }
    return '<div class="tst-guide__block"><h4>' + esc(title) + '</h4><ul>' + li + '</ul></div>';
  }

  function guideBlocks(styleId) {
    var guide = null;
    if (styleId && BREW.TastingGuide && typeof BREW.TastingGuide.forStyle === 'function') {
      try { guide = BREW.TastingGuide.forStyle(styleId); } catch (e) { guide = null; }
    }
    if (!guide) return '';
    return guideList('这个风格常犯的', guide.common, 'is-common') +
      guideList('这个风格基本不该有', guide.rare, 'is-rare');
  }

  /** 右侧"该风格要重点排查的缺陷"：数据来自 29 的 forStyle（可缺） */
  function paintGuide(batch) {
    var box = document.getElementById('tst-guide');
    if (!box) return;
    var styleId = '';
    try {
      styleId = (batch && batch.recipeSnapshot && batch.recipeSnapshot.styleId) || '';
    } catch (e) { styleId = ''; }

    var html = guideBlocks(styleId);
    if (!html) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card__head"><h2>按风格挑毛病</h2></div>' +
      '<div class="card__body card__body--tight">' + html +
        '<p class="u-xs u-dim mt-8">清单来自风格档案，打分时当检查表用，不影响分数。</p>' +
      '</div>';
  }

  /* ======================================================================
   * C. 交互
   * ====================================================================*/

  function bindOnce(el) {
    if (el.__tstBound) return;
    el.__tstBound = true;

    el.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.id) return;
      if (t.id === 'tst-batch') {
        state.batchId = t.value;
        paint(true);
      }
    });

    /* 分数与备注走 input：边打边存，但用 400ms 防抖，不在每次击键写盘 */
    el.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.id) return;

      var batch = currentBatch();
      if (!batch) return;
      var tst = tastingOf(batch);
      var sec = sectionOf(state.sectionId);

      if (t.id === 'tst-score') {
        var raw = String(t.value).trim();
        var max = num(sec && sec.max, 50);
        var v = raw === '' ? null : Math.max(0, Math.min(max, num(raw, 0)));
        tst[state.sectionId] = v;
        persist(batch, tst);
        scheduleFlush();
        syncTabCounts(tst);
        updateTotals();
        syncBand(v, sec);
        return;
      }

      if (t.id === 'tst-note') {
        var detail = (tst.detail && typeof tst.detail === 'object') ? tst.detail : {};
        var slot = (detail[state.sectionId] && typeof detail[state.sectionId] === 'object')
          ? detail[state.sectionId] : {};
        slot.note = String(t.value || '').slice(0, 120);
        detail[state.sectionId] = slot;
        tst.detail = detail;
        persist(batch, tst);
        scheduleFlush();
      }
    });

    el.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;

      var tab = t.closest ? t.closest('[data-tst-tab]') : null;
      if (tab) {
        state.sectionId = tab.getAttribute('data-tst-tab');
        var list = sections();
        var batch = currentBatch();
        var tst = tastingOf(batch);
        var tabsBox = document.getElementById('tst-tabs');
        if (tabsBox) tabsBox.innerHTML = tabsHtml(list, tst);
        var panel = document.getElementById('tst-panel');
        if (panel) panel.innerHTML = panelHtml(list, tst);
        var inp = document.getElementById('tst-score');
        if (inp) { try { inp.focus(); } catch (err) { /* ignore */ } }
        return;
      }

      var sub = t.closest ? t.closest('[data-tst-sub]') : null;
      if (sub) {
        var batch2 = currentBatch();
        var tst2 = tastingOf(batch2);
        var sid = sub.getAttribute('data-tst-sub');
        var detail2 = (tst2.detail && typeof tst2.detail === 'object') ? tst2.detail : {};
        var slot2 = (detail2[state.sectionId] && typeof detail2[state.sectionId] === 'object')
          ? detail2[state.sectionId] : {};
        var picked = (slot2.picked && typeof slot2.picked === 'object') ? slot2.picked : {};
        if (picked[sid]) delete picked[sid]; else picked[sid] = true;
        slot2.picked = picked;
        detail2[state.sectionId] = slot2;
        /* 全删空时把 detail 收回 null，别留一堆空对象占配额 */
        var hasAny = false;
        for (var kk in detail2) {
          if (Object.prototype.hasOwnProperty.call(detail2, kk)) { hasAny = true; break; }
        }
        tst2.detail = hasAny ? detail2 : null;
        persist(batch2, tst2);
        scheduleFlush();
        sub.classList.toggle('is-on');
        sub.setAttribute('aria-pressed', sub.classList.contains('is-on') ? 'true' : 'false');
        return;
      }

      var act = t.closest ? t.closest('[data-tst]') : null;
      if (act && act.getAttribute('data-tst') === 'clear') {
        clearAll();
      }
    });
  }

  function syncBand(v, sec) {
    if (!sec) return;
    var ratio = (v === null) ? 0 : Math.max(0, Math.min(1, num(v, 0) / num(sec.max, 1)));
    var bar = document.querySelector('#tst-panel .tst-bar i');
    if (bar) bar.style.width = (ratio * 100) + '%';
  }

  function syncTabCounts(t) {
    var list = sections();
    var box = document.getElementById('tst-tabs');
    if (!box) return;
    var btns = box.querySelectorAll('[data-tst-tab]');
    for (var i = 0; i < btns.length; i++) {
      var id = btns[i].getAttribute('data-tst-tab');
      var sec = sectionOf(id);
      var v = t[id];
      var cnt = btns[i].querySelector('.tab__count');
      if (cnt) cnt.textContent = ((v === null || v === undefined) ? '—' : fmt(v, 1)) + '/' + (sec ? sec.max : '');
    }
  }

  function scheduleFlush() {
    if (saveTimer) root.clearTimeout(saveTimer);
    saveTimer = root.setTimeout(function () {
      saveTimer = 0;
      if (store() && typeof store().flushNow === 'function') {
        try { store().flushNow(); } catch (e) { /* ignore */ }
      }
    }, 400);
  }

  function clearAll() {
    var batch = currentBatch();
    if (!batch) return;
    if (!UI.Shell || typeof UI.Shell.confirm !== 'function') return;
    UI.Shell.confirm({
      title: '清空这份品鉴？',
      message: '五个分段的分数、子项勾选与评语都会被清掉，批次本身不动。',
      detail: '清空后不可恢复。',
      okLabel: '清空',
      danger: true
    }, function () {
      var b = currentBatch();
      if (!b) return;
      var empty = { aroma: null, appearance: null, flavor: null, mouthfeel: null, overall: null, total: null, notes: '', detail: null };
      b.tasting = empty;
      try {
        if (store() && typeof store().saveBatch === 'function') store().saveBatch(b);
        if (store() && typeof store().flushNow === 'function') store().flushNow();
      } catch (e) { /* ignore */ }
      paint(true);
      toast('已清空这份品鉴', 'ok');
    });
  }

  BREW.UI.TastingView = {
    id: 'tasting',
    label: '品鉴',
    icon: 'beer',
    group: '现场',
    order: 9,
    render: function (el) { render(el); },
    onEnter: function () { if (host) paint(true); },
    /* v1.7：从别处（批次页「去打品鉴分」）指定给哪一批打分。
       currentBatch() 原本优先"已打过分的最近一个"——从批次页跳过来时那不一定
      是用户眼前这一批。以前外部只能去改 #tst-batch 下拉并派发 change，
       轮询窗口里用户切批次还会被抢回旧值。这里给一个正常入口。
       **只改"给哪一批打分"，不写任何分数、不落盘**。 */
    focus: function (batchId) {
      if (!batchId) return false;
      state.batchId = String(batchId);
      if (host && host.isConnected) paint(true);
      return true;
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
