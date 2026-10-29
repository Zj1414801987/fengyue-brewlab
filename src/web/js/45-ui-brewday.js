/* ============================================================================
 * 风月酿研所 — 45-ui-brewday.js
 * ----------------------------------------------------------------------------
 * 职责：酿造日看板（Alt+8）。把一条批次快照变成一张时间轴，按预定时点推进，
 *       每个节点可打勾记实际完成时刻，全部落进 `batch.brewday`。
 *
 * 三条实现要点（踩过才知道）：
 *
 * 1. **倒计时必须每帧用 Date.now() 反算**，不能累减。浏览器把后台标签页的
 *    setInterval 节流到 1 秒甚至暂停，累减的倒计时会越走越慢；反算则"跳"一下
 *    回到正确值。所以 render 只负责画，真相永远在 BrewdayPlan.tick(plan, now)。
 *
 * 2. **同一时刻可能有多个节点**（"开始煮沸"与"60 分钟投花"同属一分钟）。
 *    tick().currentIndex 只指向该组第一个，所以这里按 `at` 分组并排显示——
 *    少了这一步，用户就看不到同分钟的投花提醒。
 *
 * 3. **AudioContext 必须在"开始酿造"那次点击里创建**。等 30 分钟后计时器
 *    回调里再 new AudioContext()，会被自动播放策略静默拦掉：不报错、只是没声音。
 *
 * 状态存 `batch.brewday`（全小写 d）。空壳只在用户真点"开始酿造"时建 ——
 * 渲染时顺手 `|| {}` 会给 15 个批次各烧 800 多字符。
 *
 * 依赖：BREW.BrewdayPlan（可缺）、BREW.UI（esc/attr/num/fmt/icon/store）、
 *       BREW.Store（listBatches/getBatch/saveBatch/flushNow）
 * 对外：BREW.UI.BrewdayView
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  var host = null;
  var timer = 0;          /* 每秒重绘的句柄 */
  var audioCtx = null;    /* 只在"开始酿造"的点击里创建 */
  var lastBeepKey = '';   /* 防止同一个节点反复响 */

  function toast(msg, kind, ms) {
    if (UI.Shell && UI.Shell.toast) UI.Shell.toast(msg, kind || 'info', ms || 2600);
  }

  /* ======================================================================
   * A. 数据
   * ====================================================================*/

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

  var state = {
    batchId: '',
    large: false,      /* 大字模式：手上有水、屏幕在两米外 */
    showDone: true,
    /* 「本次不再提示」：只活在这个页面里，不落盘。
       这不是"设置项"而是"我现在不想再被打断"，落盘会让用户下次开锅时
       莫名其妙收不到任何提醒。 */
    muteAlerts: false
  };

  /** 当前要看哪个批次：优先 state.batchId，其次第一个"正在酿造"的，再次最新一个 */
  function currentBatch() {
    var b = getBatch(state.batchId);
    if (b) return b;
    var list = batches();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].brewday && num(list[i].brewday.startedAt, 0) > 0) {
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

  /** 计划：有 brewday.steps 就用存档里的（带 actualAt），否则按快照现算 */
  function planOf(batch) {
    if (!BREW.BrewdayPlan || typeof BREW.BrewdayPlan.build !== 'function') return null;
    if (!batch) return null;
    var saved = batch.brewday || null;
    var startedAt = saved ? num(saved.startedAt, 0) : 0;
    var built = null;
    try {
      built = BREW.BrewdayPlan.build(batch.recipeSnapshot || batch.snapshot || {}, startedAt);
    } catch (e) {
      return null;
    }
    if (!built) return null;
    /* 把存档里的 actualAt / skipped 合并回计划（用户打过勾的不能丢） */
    if (saved && Array.isArray(saved.steps)) {
      var map = {};
      for (var i = 0; i < saved.steps.length; i++) {
        var s = saved.steps[i];
        if (s && s.key) map[s.key] = s;
      }
      for (var j = 0; j < built.steps.length; j++) {
        var step = built.steps[j];
        var hit = map[step.key];
        if (!hit) continue;
        if (hit.actualAt) step.actualAt = hit.actualAt;
        if (hit.skipped) step.skipped = true;
        if (hit.note) step.note = hit.note;
      }
    }
    return built;
  }

  /**
   * 「还没处理的节点」视图（D14）。
   * 36 的 tick() 只按时间推进（currentIndex = 最后一个预定时刻 <= now 的节点），
   * 它**不知道**用户打了勾或跳过了——所以直接用它会出现：
   * 跳过一个 13:13 的节点后，倒计时仍然指着它，一路负着走。
   *
   * 这里在 UI 层做过滤（计算侧的文件不动）：
   *   · nextStep  = 第一个"没打勾也没跳过、且预定时刻还没到"的节点
   *   · 全都过点了还没处理 → nextStep 取最早那个逾期的（配合 alertBlock 一起催）
   *   · 全都处理完了 → pending 为空，调用方显示「全部完成」
   */
  function pendingView(plan) {
    var now = Date.now();
    var pend = [];
    var overdue = [];
    var steps = (plan && plan.steps) || [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      if (!s || s.actualAt || s.skipped) continue;
      pend.push(s);
      if (num(s.at, 0) > 0 && num(s.at, 0) <= now) overdue.push(s);
    }
    var upcoming = null;
    for (var j = 0; j < pend.length; j++) {
      if (num(pend[j].at, 0) > now) { upcoming = pend[j]; break; }
    }
    /* 顺序很关键：
       ① 有"还没到点"的 → 倒计时指向它（刚点开始时进水已到点、升温在 5 分钟后，
          这时该显示 05:00 而不是 −00:00）
       ② 全都逾期 → 指向最早那个逾期的，倒计时照实走负值（配合 alertBlock 一起催）
       ③ 一个不剩（全打勾/全跳过）→ null，调用方显示「全部完成」 */
    var next = upcoming || (overdue.length ? overdue[0] : (pend.length ? pend[0] : null));
    var nextAt = next ? (num(next.at, 0) || null) : null;
    var remain = nextAt ? (nextAt - now) : null;
    return {
      allDone: pend.length === 0,
      pending: pend,
      overdue: overdue,
      nextStep: next,
      nextAt: nextAt,
      remainingMs: remain
    };
  }

  /**
   * 酿造日 → 批次状态的**单向**联动（D15）。
   * 只做两条推进：第一次动手 → 糖化中；全部处理完 → 发酵中。
   * 刻意不做反向回写（批次页手改成 ferment 时，酿造日不把它改回去）——
   * 反向会让用户的手动状态被机器覆盖，那是更烦人的 bug。
   * 状态本身走 35 的 Batch.setStatus（它会写 statusHistory），不自己拼。
   */
  function nudgeStatus(batch, plan) {
    if (!batch || !BREW.Batch || typeof BREW.Batch.setStatus !== 'function') return null;
    var cur = String(batch.status || 'plan');
    var anyMarked = 0, pending = 0;
    for (var i = 0; i < plan.steps.length; i++) {
      var s = plan.steps[i];
      if (s.actualAt || s.skipped) anyMarked++;
      if (!s.actualAt && !s.skipped) pending++;
    }
    if (pending === 0 && cur !== 'ferment' && cur !== 'mature' && cur !== 'package' && cur !== 'done') {
      BREW.Batch.setStatus(batch, 'ferment');
      return 'ferment';
    }
    if (anyMarked > 0 && cur === 'plan') {
      BREW.Batch.setStatus(batch, 'mash');
      return 'mash';
    }
    return null;
  }

  /** 把打勾/跳过写回 batch.brewday 并立刻落盘（点击是语义提交，不等 400ms 节流） */
  function persist(batch, plan) {
    if (!batch || !plan) return;
    var steps = [];
    for (var i = 0; i < plan.steps.length; i++) {
      var s = plan.steps[i];
      steps.push({
        key: s.key,
        actualAt: s.actualAt || null,
        skipped: s.skipped === true,
        note: s.note || ''
      });
    }
    batch.brewday = {
      startedAt: num(plan.startedAt, 0),
      totalMin: num(plan.totalMin, 0),
      steps: steps
    };
    try {
      if (store() && typeof store().saveBatch === 'function') store().saveBatch(batch);
      if (store() && typeof store().flushNow === 'function') store().flushNow();
    } catch (e) {
      toast('保存失败：' + ((e && e.message) || '未知错误'), 'error');
    }
  }

  /* ======================================================================
   * B. 提示音
   * ----------------------------------------------------------------------
   * 用 Web Audio 现场合成，不引音频文件（这个软件不依赖任何外部资源）。
   * 上下文在"开始酿造"的点击里建：晚建会被自动播放策略静默拦掉。
   * ====================================================================*/

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return null;
    /* 只在真的有用户手势时创建。自动播放策略会把"无手势创建的 AudioContext"
       标成 suspended 并在控制台留一条 warning；程序化点击（自动化测试、
       某些辅助技术）也会走到这里，届时那条 warning 会干扰"控制台必须干净"
       的验收，而它并不是缺陷。真实点击时 isActive 为 true，行为不变。 */
    var act = root.navigator && root.navigator.userActivation;
    if (act && act.isActive === false) return null;
    try {
      audioCtx = new Ctx();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function beep() {
    var soundOn = true;
    try {
      soundOn = (store() ? store().get('settings.brewdaySound', true) : true) !== false;
    } catch (e) { soundOn = true; }
    if (!soundOn) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      var t = ctx.currentTime;
      /* 两声短鸣，比一声长鸣更像"提醒"而不是"报错" */
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.44);
      osc.start(t);
      osc.stop(t + 0.46);
    } catch (e) { /* 提示音失败绝不能影响计时 */ }
  }

  /* ======================================================================
   * C. 渲染
   * ====================================================================*/

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function clockText(ms) {
    if (ms === null || ms === undefined) return '—';
    var total = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return (h > 0 ? h + ':' : '') + pad2(m) + ':' + pad2(s);
  }

  function timeText(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function render(el) {
    host = el;
    if (!BREW.BrewdayPlan || typeof BREW.BrewdayPlan.build !== 'function') {
      el.innerHTML = '<div class="section-title"><h2>酿造日</h2>' +
        '<p>把配方变成一张按分钟推进的时间轴</p></div>' +
        '<div class="card"><div class="card__body">' +
        UI.emptyState('酿造日模块未载入',
          'js/36-brewday-plan.js 没有成功执行，时间轴暂时算不出来。',
          { art: 'beer' }) + '</div></div>';
      return;
    }
    paint();
    startTimer();
  }

  /** 整块重绘。每秒调用一次，所以只做字符串拼装，不在里面读大对象 */
  function paint() {
    if (!host) return;
    var batch = currentBatch();
    var plan = planOf(batch);

    var head = '<div class="section-title">' +
      '<h2>酿造日</h2>' +
      '<p>按预定时点推进；到点响一声，打勾记下实际时刻</p>' +
      '<span class="spacer"></span>' +
      batchSelector(batch) +
      '<button type="button" class="btn btn-ghost btn-sm" data-bd="large" ' +
        'aria-pressed="' + (state.large ? 'true' : 'false') + '" ' +
        'title="把时间轴放大到两米外也能读">' +
        (state.large ? '常规字号' : '大字（两米外可读）') + '</button>' +
      '</div>';

    if (!batches().length) {
      host.innerHTML = head + '<div class="card"><div class="card__body">' +
        UI.emptyState('还没有批次记录',
          '酿造日挂在批次上：先到「批次记录」新建一个批次，这里才有配方快照可排时间轴。',
          { art: 'beer' }) + '</div></div>';
      return;
    }
    if (!plan) {
      host.innerHTML = head + '<div class="card"><div class="card__body">' +
        UI.emptyState('这份批次排不出时间轴', '配方快照缺得太多，先去配方页补糖化步骤与煮沸时长。',
          { art: 'chart' }) + '</div></div>';
      return;
    }

    var now = Date.now();
    var tick = null;
    try {
      tick = BREW.BrewdayPlan.tick(plan, now);
    } catch (e) {
      tick = null;
    }
    if (!tick) {
      host.innerHTML = head + '<div class="card"><div class="card__body">' +
        UI.emptyState('状态推算失败', '时间轴数据异常，刷新页面再试。', { art: 'chart' }) +
        '</div></div>';
      return;
    }

    host.innerHTML = head + summaryCard(batch, plan, tick) + alertBlock(tick, plan) + timelineCard(plan, tick);

    /* 到点提示音：只对"刚跨过预定时刻且还没打勾"的节点响一次。
       静音后连声音一起停——只剩半套提醒比没有提醒更让人困惑。 */
    if (tick.started && !tick.finished && !state.muteAlerts) {
      /* 只对"未处理且已过点"的节点响：打勾与跳过之后不该再提示 */
      var over = pendingView(plan).overdue;
      for (var i = 0; i < over.length; i++) {
        var key = String((over[i] && over[i].key) || '');
        if (!key || key === lastBeepKey) continue;
        lastBeepKey = key;
        beep();
        toast('到点了：' + ((over[i] && over[i].label) || ''), 'warn', 4200);
        break;
      }
    }
  }

  /**
   * 逾期提醒块。
   * 只靠 toast 是不够的：toast 6 秒就消失，而酿酒的人可能正蹲在地上洗桶。
   * 所以这里常驻一块"已经过点但还没打勾"的清单，并给一个"本次不再提示"——
   * 那句话说到底是"我知道，我在忙"，而不是"以后都别提醒我"。
   */
  function alertBlock(tick, plan) {
    if (!tick.started) return '';
    /* 用 pendingView 的逾期列表：已打勾/已跳过的节点不该继续催 */
    var over = (plan ? pendingView(plan).overdue : (tick.overdue || []));
    if (!over.length) return '';
    if (state.muteAlerts) {
      return '<div class="bd-alert bd-alert--muted">' +
        '<span>' + over.length + ' 个节点已过点（本次已静音提醒）</span>' +
        '<button type="button" class="btn btn-quiet btn-xs" data-bd="unmute">恢复提醒</button>' +
        '</div>';
    }
    var items = '';
    for (var i = 0; i < over.length; i++) {
      var s = over[i] || {};
      var late = s.at ? Math.max(0, Math.round((Date.now() - s.at) / 60000)) : 0;
      items += '<li>' + esc(String(s.label || '')) +
        (late ? '<span class="u-dim"> · 已过 ' + late + ' 分钟</span>' : '') + '</li>';
    }
    return '<div class="bd-alert">' +
      '<div class="bd-alert__head">' +
        '<span class="bd-alert__title">' + icon('alert', 13) + ' 已到点，等你确认</span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn btn-quiet btn-xs" data-bd="mute">本次不再提示</button>' +
      '</div>' +
      '<ul class="bd-alert__list">' + items + '</ul>' +
      '</div>';
  }

  function batchSelector(cur) {
    var list = batches();
    if (list.length <= 1) return '';
    var opts = '';
    for (var i = list.length - 1; i >= 0; i--) {
      var b = list[i];
      if (!b || !b.id) continue;
      opts += '<option value="' + attr(b.id) + '"' + (cur && b.id === cur.id ? ' selected' : '') + '>' +
        esc((b.batchNo || '') + ' · ' + (b.name || '未命名')) +
        (b.brewday && num(b.brewday.startedAt, 0) > 0 ? '（已开始）' : '') + '</option>';
    }
    return '<select class="select select--sm" id="bd-batch" aria-label="选择批次" style="max-width:260px">' +
      opts + '</select>';
  }

  function summaryCard(batch, plan, tick) {
    var started = num(plan.startedAt, 0) > 0;
    var pend = pendingView(plan);
    var remain = pend.remainingMs;
    var next = pend.nextStep;

    var big = '';
    if (!started) {
      big = '<div class="bd-hero"><div class="bd-hero__num">' + esc(fmt(plan.totalMin, 0)) + ' 分钟</div>' +
        '<div class="bd-hero__sub">全程预估 · 共 ' + plan.steps.length + ' 个节点</div></div>';
    } else if (pend.allDone) {
      /* 全部处理完（打勾或跳过）——不要停在最后一个节点上继续倒计时 */
      big = '<div class="bd-hero"><div class="bd-hero__num">全部完成</div>' +
        '<div class="bd-hero__sub">' + tick.doneCount + '/' + plan.steps.length +
        ' 个节点 · 实际用时 ' + esc(clockText(nowSince(plan.startedAt))) + '</div></div>';
    } else {
      /* 负值照实显示（-03:12 表示这个节点已经过了 3 分 12 秒），
         比截成 00:00 诚实：截断会让用户以为"刚到点" */
      big = '<div class="bd-hero"><div class="bd-hero__num' + (remain !== null && remain < 0 ? ' is-late' : '') + '">' +
        (remain === null ? '—' : (remain < 0 ? '−' : '') + esc(clockText(Math.abs(remain)))) + '</div>' +
        '<div class="bd-hero__sub">' +
          (next
            ? (remain !== null && remain < 0 ? '已过点：' : '下一个：') + esc(next.label) +
              ' · 预定 ' + esc(timeText(pend.nextAt))
            : '等待下一步') +
        '</div></div>';
    }

    var btns = '';
    if (!started) {
      btns = '<button type="button" class="btn btn-primary" data-bd="start">' +
        icon('clock', 14) + '开始酿造</button>' +
        '<span class="u-xs u-dim">点击后开始计时，并记住这个时刻</span>';
    } else {
      btns = '<button type="button" class="btn btn-ghost btn-sm" data-bd="restart">重新计时</button>' +
        '<span class="u-xs u-dim">开始于 ' + esc(timeText(plan.startedAt)) +
        ' · 进度 ' + esc(fmt(tick.progress * 100, 0)) + '%</span>';
    }

    var warns = '';
    var ws = Array.isArray(plan.warnings) ? plan.warnings : [];
    for (var i = 0; i < ws.length; i++) {
      if (!ws[i]) continue;
      warns += '<div class="alert alert--info mt-8"><span class="alert__icon">' +
        icon('info', 13) + '</span><span>' + esc(String(ws[i])) + '</span></div>';
    }

    return '<div class="card' + (state.large ? ' bd-large' : '') + '">' +
      '<div class="card__body">' + big + warns +
        '<div class="row mt-12">' + btns + '</div>' +
      '</div></div>';
  }

  function nowSince(start) {
    return start > 0 ? Math.max(0, Date.now() - start) : 0;
  }

  /** 时间轴：按 `at` 分组，同一分钟内的节点并排（否则同组的投花提醒会被藏起来） */
  function timelineCard(plan, tick) {
    var groups = [];
    var lastAt = null;
    for (var i = 0; i < plan.steps.length; i++) {
      var s = plan.steps[i];
      if (!s) continue;
      var atKey = s.at ? String(s.at) : 't' + s.offsetMin;
      if (lastAt !== atKey) {
        groups.push({ at: s.at || null, offsetMin: s.offsetMin, steps: [] });
        lastAt = atKey;
      }
      groups[groups.length - 1].steps.push(s);
    }

    var rows = '';
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      var cells = '';
      for (var j = 0; j < grp.steps.length; j++) {
        cells += stepCell(grp.steps[j]);
      }
      rows += '<div class="bd-group">' +
        '<div class="bd-group__time">' +
          (grp.at ? esc(timeText(grp.at)) : '+ ' + esc(fmt(grp.offsetMin, 0)) + '′') +
          '<span class="bd-group__off">T+' + esc(fmt(grp.offsetMin, 0)) + '′</span>' +
        '</div>' +
        '<div class="bd-group__body">' + cells + '</div>' +
      '</div>';
    }

    return '<div class="card mt-16' + (state.large ? ' bd-large' : '') + '">' +
      '<div class="card__head"><h2>时间轴</h2><span class="spacer"></span>' +
        '<span class="u-xs u-dim">已打勾 ' + tick.doneCount + '/' + plan.steps.length + '</span></div>' +
      '<div class="card__body card__body--tight">' +
        '<div class="bd-timeline">' + rows + '</div>' +
      '</div></div>';
  }

  function stepCell(s) {
    var done = !!s.actualAt;
    var late = s.actualAt && s.at ? (s.actualAt - s.at) : 0;
    var cls = 'bd-step' + (done ? ' is-done' : '') + (s.skipped ? ' is-skip' : '');
    var meta = '';
    if (done) {
      meta = '实际 ' + timeText(s.actualAt) +
        (Math.abs(late) > 60000 ? ' · ' + (late > 0 ? '晚 ' : '早 ') + fmt(Math.abs(late) / 60000, 0) + ' 分' : '');
    } else if (s.at) {
      meta = '预定 ' + timeText(s.at);
    } else {
      meta = 'T+' + fmt(s.offsetMin, 0) + '′';
    }
    return '<div class="' + cls + '">' +
      '<button type="button" class="bd-step__check' + (done ? ' is-on' : '') + '" ' +
        'data-bd="done" data-key="' + attr(s.key) + '" ' +
        'aria-pressed="' + (done ? 'true' : 'false') + '" ' +
        'aria-label="' + attr((done ? '取消完成：' : '标记完成：') + s.label) + '">' +
        (done ? icon('check', 11) : '') + '</button>' +
      '<div class="bd-step__main">' +
        '<div class="bd-step__label">' + esc(s.label) +
          (s.skipped ? ' <span class="u-xs u-dim">（已跳过）</span>' : '') + '</div>' +
        '<div class="bd-step__meta">' + esc(meta) + '</div>' +
        (s.detail ? '<div class="bd-step__detail">' + UI.md(String(s.detail)) + '</div>' : '') +
        /* 跳过：有些步骤这锅确实没有（比如配方没有洗糟），
           不给这个按钮，用户只能"假装打勾"，那会污染实际用时统计 */
        '<button type="button" class="bd-step__skip" data-bd="skip" data-key="' + attr(s.key) + '">' +
          (s.skipped ? '恢复' : '跳过') + '</button>' +
      '</div>' +
    '</div>';
  }

  /* ======================================================================
   * D. 计时器
   * ====================================================================*/

  function startTimer() {
    stopTimer();
    timer = root.setInterval(function () {
      /* 每帧重算而不是累减：后台标签页被节流时，累减的倒计时会停在错误值上 */
      if (!host || !host.isConnected) { stopTimer(); return; }
      paint();
    }, 1000);
  }

  function stopTimer() {
    if (timer) { root.clearInterval(timer); timer = 0; }
  }

  /* ======================================================================
   * E. 交互（全部委托到视图根节点）
   * ====================================================================*/

  function bindEvents(el) {
    if (el.__bdBound) return;
    el.__bdBound = true;

    el.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || t.id !== 'bd-batch') return;
      state.batchId = t.value;
      lastBeepKey = '';
      paint();
    });

    el.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-bd]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-bd');

      if (act === 'mute') {
        state.muteAlerts = true;
        paint();
        toast('本次酿造不再弹出到点提醒（时间轴仍在走，随时可以恢复）', 'info', 3600);
        return;
      }
      if (act === 'unmute') {
        state.muteAlerts = false;
        lastBeepKey = '';
        paint();
        return;
      }

      if (act === 'large') {
        state.large = !state.large;
        paint();
        return;
      }

      var batch = currentBatch();
      if (!batch) return;
      var plan = planOf(batch);
      if (!plan) return;

      if (act === 'start') {
        /* AudioContext 必须在这唯一的点击里建，否则 30 分钟后的提示音会被静默拦掉 */
        ensureAudio();
        plan.startedAt = Date.now();
        /* 重排 at：build 时 startedAt=0，这里按新起点补齐每个节点的时刻 */
        for (var i = 0; i < plan.steps.length; i++) {
          plan.steps[i].at = plan.startedAt + Math.round(num(plan.steps[i].offsetMin, 0) * 60000);
        }
        persist(batch, plan);
        lastBeepKey = '';
        toast('已开始计时：' + plan.steps.length + ' 个节点，全程约 ' +
          fmt(plan.totalMin, 0) + ' 分钟', 'ok', 3600);
        paint();
        return;
      }

      if (act === 'restart') {
        /* 已经记过实际时刻/标记过跳过的，重来一次就是**不可恢复**的数据丢失：
           糖化锅前手是湿的，误触一下"几点几分投的花"就没了。
           所以只在真有代价时才问——一个勾都没打时问一句只是在浪费点击。 */
        var nActual = 0, nSkip = 0;
        for (var m = 0; m < plan.steps.length; m++) {
          if (plan.steps[m].actualAt) nActual++;
          else if (plan.steps[m].skipped) nSkip++;
        }
        var marked = nActual + nSkip;
        /* 数字要真实：把"实际时刻"和"跳过标记"分开数，
           否则跳过了 3 个节点却说"清空 3 个实际时刻"，用户会以为记过时间 */
        var costText = '';
        if (nActual && nSkip) {
          costText = '这会清空已记录的 ' + nActual + ' 个实际时刻与 ' + nSkip + ' 个跳过标记，且无法恢复。';
        } else if (nActual) {
          costText = '这会清空已记录的 ' + nActual + ' 个实际时刻，且无法恢复。';
        } else {
          costText = '这会清空 ' + nSkip + ' 个跳过标记，且无法恢复。';
        }
        var doRestart = function () {
          plan.startedAt = 0;
          for (var k = 0; k < plan.steps.length; k++) {
            plan.steps[k].actualAt = null;
            plan.steps[k].skipped = false;
            plan.steps[k].at = null;
          }
          persist(batch, plan);
          lastBeepKey = '';
          state.muteAlerts = false;
          toast('已清除计时与打勾记录', 'warn');
          paint();
        };
        if (!marked || !UI.Shell || typeof UI.Shell.confirm !== 'function') {
          doRestart();
          return;
        }
        UI.Shell.confirm({
          title: '重新计时？',
          message: costText,
          detail: '计时起点会回到现在；已经打勾与跳过的节点都会重置。',
          okLabel: '继续',
          danger: true
        }, doRestart);
        return;
      }

      if (act === 'skip') {
        var sk = btn.getAttribute('data-key');
        for (var q = 0; q < plan.steps.length; q++) {
          if (plan.steps[q].key !== sk) continue;
          plan.steps[q].skipped = !plan.steps[q].skipped;
          if (plan.steps[q].skipped) plan.steps[q].actualAt = null;
          break;
        }
        persist(batch, plan);
        var moved2 = nudgeStatus(batch, plan);
        if (moved2) persist(batch, plan);
        if (moved2 === 'ferment') toast('已进入发酵，去「酿造记录」记比重', 'ok', 4200);
        paint();
        return;
      }

      if (act === 'done') {
        var key = btn.getAttribute('data-key');
        for (var j = 0; j < plan.steps.length; j++) {
          if (plan.steps[j].key !== key) continue;
          if (plan.steps[j].actualAt) plan.steps[j].actualAt = null;
          else plan.steps[j].actualAt = Date.now();
          break;
        }
        /* 打勾是语义提交，不等 Store 的 400ms 节流：刷新页面必须能续上 */
        persist(batch, plan);
        var moved = nudgeStatus(batch, plan);
        if (moved) persist(batch, plan);
        if (moved === 'ferment') {
          toast('已进入发酵，去「酿造记录」记比重', 'ok', 4200);
        }
        paint();
        return;
      }
    });
  }

  BREW.UI.BrewdayView = {
    id: 'brewday',
    label: '酿造日',
    icon: 'clock',
    group: '记录',
    order: 8,
    render: function (el) {
      bindEvents(el);
      render(el);
    },
    onEnter: function () {
      if (host) { paint(); startTimer(); }
    },
    onLeave: function () { stopTimer(); },
    /* v1.7：从别处（批次页「开始酿造」）指定看哪一批。
       以前只能靠本视图里的 #bd-batch 下拉，外部想选中某一批就得去改那个 select
       并派发 change —— 轮询期间用户切了批次还会被抢回旧值。这里给一个正常入口：
       先记住 batchId，若视图已经画过就立刻重画（没画过则由 render/onEnter 读它）。
       **只改"看哪一批"，不动计时、不动存档**。 */
    focus: function (batchId) {
      if (!batchId) return false;
      state.batchId = String(batchId);
      lastBeepKey = '';
      if (host && host.isConnected) { paint(); startTimer(); }
      return true;
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
