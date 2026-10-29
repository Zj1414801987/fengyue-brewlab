/* ============================================================================
 * 风月酿研所 — 36 酿造日流程计划（Brew Day Plan）
 * ----------------------------------------------------------------------------
 * 职责：把一份批次快照（recipeSnapshot）展开成一条带时间偏移的工序时间轴，
 *       并提供一个纯函数 tick(plan, now) 反算"现在在哪一步、还差多久、哪些超时了"。
 *
 * 两条关键设计（都是踩坑换来的）：
 *   1. **只存"起点 + 偏移"，不存"剩余秒数"**。倒计时每帧用 (now - startedAt) 反算，
 *      后台标签页的 setInterval 被浏览器节流到 1 次/分钟也不会走偏；
 *      存剩余秒数则一定会漂。
 *   2. **不调 Date.now()**。now 由调用方传，node 侧才能用固定时间做确定性单测
 *      （否则测一次倒计时得真等 60 分钟）。
 *
 * 与存储的关系：本模块不碰 Store。UI 的用法是
 *     var plan = BrewdayPlan.build(batch.recipeSnapshot, batch.brewday.startedAt);
 *     plan.steps.forEach(function (s) {              // 把已打勾的状态合并进来
 *       var saved = findIn(batch.brewday.steps, s.id);
 *       if (saved) { s.actualAt = saved.actualAt; s.skipped = saved.skipped; }
 *     });
 *     var view = BrewdayPlan.tick(plan, Date.now());
 *   build 只产出"应该做什么、什么时候"，tick 只读，不写回。
 *
 * 前置依赖：00-core（可选，只用 Util.round）
 * 加载位置：应在 js/35-batch.js 之后、js/40-ui-shell.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var BrewdayPlan = BREW.BrewdayPlan = {};

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

  /* 默认时长（分钟）。这些是家用三桶系统的经验值，不是唯一正确值——
     用户可以在后面版本里改，但目前不给设置项，避免第一次打开要填一堆参数。 */
  var D = {
    strikeMin: 10,      /* 进水 + 搅拌 */
    heatMin: 15,        /* 从常温升到糖化温度 */
    spargeMin: 30,
    whirlpoolMin: 20,
    chillMin: 20,
    pitchMin: 15,
    overdueGraceMin: 5  /* 超过预定时间 5 分钟还没打勾才算"超时" */
  };

  function num(v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  }

  function isMashout(step) {
    if (!step) return false;
    var name = String(step.name || '');
    var temp = num(step.tempC, 0);
    return /出糖|mash.?out|糖化结束/.test(name) || temp >= 75;
  }

  /* ======================================================================
   * 一、生成计划
   * ----------------------------------------------------------------------
   * @param {object} snapshot   批次快照（recipeSnapshot），可缺字段
   * @param {number} startedAt  开始时刻（毫秒时间戳）。传 0 表示"还没开始"，
   *                            此时只算相对偏移，at 全部为 null。
   * @returns {{
   *   steps:Array<{id,key,label,offsetMin,durMin,kind,at,seq,detail}>,
   *   totalMin:number, startedAt:number, warnings:string[]
   * }}
   * ====================================================================*/
  BrewdayPlan.build = function (snapshot, startedAt) {
    var snap = snapshot || {};
    var warnings = [];
    var start = num(startedAt, 0);
    var seq = 0;

    var nodes = [];
    function push(key, label, offsetMin, durMin, kind, detail) {
      nodes.push({
        id: 'bd-' + key,
        key: key,
        label: label,
        offsetMin: U.round(offsetMin, 0),
        durMin: U.round(durMin, 0),
        kind: kind,
        seq: seq++,
        detail: detail || '',
        at: start > 0 ? start + Math.round(offsetMin * 60000) : null
      });
    }

    /* ---- 1. 糖化前的准备 ---- */
    var mashSteps = (snap.mashSteps || []).filter(function (s) {
      return s && num(s.minutes, 0) > 0;
    });
    if (!mashSteps.length) {
      if (!snap || !Object.keys(snap).length) {
        warnings.push('批次没有配方快照，下面是一条通用时间轴（糖化 66°C / 60 分钟 / 煮沸 60 分钟）');
      } else {
        warnings.push('配方没有糖化步骤，已按一步 66°C / 60 分钟生成');
      }
      mashSteps = [{ name: '糖化', tempC: 66, minutes: 60 }];
    }

    var boilTime = num(snap.boilTime, 0);
    if (!(boilTime > 0)) {
      boilTime = 60;
      warnings.push('快照里没有煮沸时长（boilTime），按 60 分钟生成');
    }

    var masWater = num(snap.expectedMashWater, 0);
    var spargeWater = num(snap.expectedSpargeWater, 0);
    var t = 0;

    push('strike', '糖化进水' + (masWater > 0 ? '（约 ' + U.round(masWater, 1) + ' L）' : ''),
      t, D.strikeMin, 'transfer');
    t += D.strikeMin;

    /* 如果第一个糖化步骤是"出糖"，说明用户没写糖化休止，别硬造一个升温步 */
    var firstTemp = num(mashSteps[0].tempC, 66);
    if (!isMashout(mashSteps[0])) {
      push('heat', '升温至 ' + U.round(firstTemp, 0) + '°C', t, D.heatMin, 'heat');
      t += D.heatMin;
    }

    /* ---- 2. 糖化各休止 ---- */
    for (var i = 0; i < mashSteps.length; i++) {
      var st = mashSteps[i];
      var mins = num(st.minutes, 60);
      var temp = num(st.tempC, 66);
      var out = isMashout(st);
      push(
        'rest-' + i,
        (out ? '出糖 ' : '糖化休止 ') + U.round(temp, 0) + '°C · ' + U.round(mins, 0) + ' 分钟',
        t, mins, out ? 'transfer' : 'rest',
        st.name || ''
      );
      t += mins;
    }

    /* ---- 3. 洗糟 ---- */
    push('sparge', '洗糟' + (spargeWater > 0 ? '（约 ' + U.round(spargeWater, 1) + ' L）' : ''),
      t, D.spargeMin, 'transfer');
    t += D.spargeMin;

    /* ---- 4. 煮沸 ---- */
    var boilStart = t;
    push('boil', '开始煮沸 · ' + U.round(boilTime, 0) + ' 分钟', boilStart, boilTime, 'boil');
    t += boilTime;

    var hops = snap.hops || [];
    if (!hops.length) {
      warnings.push('配方没有酒花，时间轴上不会有投花节点');
    }

    /* ---- 5. 投花节点：按"距煮沸结束还剩多少分钟"反推 ----
       60 分钟苦花 → 煮沸开始那一刻；15 分钟香花 → 开始后 45 分钟。 */
    var hopCount = 0;
    for (var h = 0; h < hops.length; h++) {
      var hop = hops[h] || {};
      var stage = String(hop.stage || 'boil');
      if (stage !== 'boil') continue;
      var timeLeft = num(hop.time, 0);
      var clamped = false;
      if (timeLeft > boilTime) { timeLeft = boilTime; clamped = true; }
      if (timeLeft < 0) timeLeft = 0;
      if (clamped) {
        warnings.push('酒花「' + (hop.name || '未命名') + '」标注 ' + hop.time +
          ' 分钟，超过煮沸时长 ' + boilTime + ' 分钟，已按整段煮沸处理');
      }
      var off = boilStart + (boilTime - timeLeft);
      var label = (timeLeft > 0 ? timeLeft + ' 分钟' : '关火') + '投花 · ' +
        (hop.name || '酒花') + ' ' + U.round(num(hop.amount, 0), 0) + ' g';
      push('hop-' + h, label, off, 2, 'hop', hop.name || '');
      hopCount++;
    }
    if (!hopCount && hops.length) {
      warnings.push('配方里的酒花都不是煮沸投放（可能全是回旋/干投），煮沸段没有投花节点');
    }

    /* ---- 6. 回旋 + 冷却 + 接种 ---- */
    var whirl = 0;
    for (var w = 0; w < hops.length; w++) {
      if (String(hops[w].stage || '') !== 'whirlpool') continue;
      whirl = Math.max(whirl, num(hops[w].time, 0));
    }
    var whirlMin = Math.max(D.whirlpoolMin, whirl);
    push('whirlpool', '回旋沉淀 · ' + U.round(whirlMin, 0) + ' 分钟', t, whirlMin, 'transfer');
    t += whirlMin;

    var dryHops = 0;
    for (var d = 0; d < hops.length; d++) {
      if (String(hops[d].stage || '') === 'dryhop') dryHops++;
    }

    push('chill', '冷却至接种温度' + (num(snap.fermentTemp, 0) > 0
      ? '（' + U.round(num(snap.fermentTemp, 20), 0) + '°C）' : ''), t, D.chillMin, 'chill');
    t += D.chillMin;

    push('pitch', '接种酵母', t, D.pitchMin, 'pitch',
      dryHops ? '干投在发酵后期另做（不在酿造日）' : '');
    t += D.pitchMin;

    /* ---- 7. 排序：按偏移，偏移相同按生成顺序 ----
       （同一时刻的多个节点，例如关火投花 + 回旋开始，顺序要稳定） */
    nodes.sort(function (a, b) {
      if (a.offsetMin !== b.offsetMin) return a.offsetMin - b.offsetMin;
      return a.seq - b.seq;
    });

    return {
      steps: nodes,
      totalMin: U.round(t, 0),
      startedAt: start,
      warnings: warnings
    };
  };

  /* ======================================================================
   * 二、反算当前状态
   * ----------------------------------------------------------------------
   * @param {object} plan  build 的返回值（steps 上可能已被调用方合并了 actualAt / skipped）
   * @param {number} now   当前时刻（毫秒时间戳，由调用方传）
   * @returns {{
   *   started:boolean, currentIndex:number,
   *   currentStep:object|null, nextIndex:number, nextStep:object|null,
   *   nextAt:number|null, remainingMs:number|null,
   *   overdue:Array<object>, progress:number, doneCount:number,
   *   totalMin:number, elapsedMin:number|null, finished:boolean
   * }}
   *   currentIndex 是**按时间推进的**：取最后一个"预定时刻 <= now"的节点。
   *   也就是说它随 now 单调前进，与"用户有没有打勾"无关——
   *   该不该催用户，看 pendingIndex / overdue。
   * ====================================================================*/
  BrewdayPlan.tick = function (plan, now) {
    var steps = (plan && plan.steps) || [];
    var t = num(now, 0);
    var start = num(plan && plan.startedAt, 0);

    var out = {
      started: start > 0,
      currentIndex: -1,
      currentStep: null,
      nextIndex: -1,
      nextStep: null,
      nextAt: null,
      pendingIndex: -1,
      remainingMs: null,
      nextLateMs: 0,
      overdue: [],
      progress: 0,
      doneCount: 0,
      totalMin: num(plan && plan.totalMin, 0),
      elapsedMin: null,
      finished: false
    };

    if (!steps.length) return out;

    /* 已完成的判定：打过勾或标记跳过 */
    var doneCount = 0;
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] && (steps[i].actualAt || steps[i].skipped)) doneCount++;
    }
    out.doneCount = doneCount;
    out.progress = U.round(doneCount / steps.length, 3);
    out.finished = doneCount === steps.length;

    /* 没开始：只给"第一步是什么"，不给倒计时 */
    if (!(start > 0)) {
      out.currentIndex = 0;
      out.currentStep = steps[0] || null;
      out.nextIndex = steps.length > 1 ? 1 : -1;
      out.nextStep = out.nextIndex >= 0 ? steps[out.nextIndex] : null;
      return out;
    }

    /* 时间基准推进：取最后一个"预定时刻 <= now"的节点 */
    var cur = 0;
    for (var j = 0; j < steps.length; j++) {
      var at = num(steps[j] && steps[j].at, 0);
      if (at > 0 && t >= at) cur = j;
    }
    /* 同一时刻可能有多步（"开始煮沸"和"60 分钟投花"都落在 T+125）。
       回退到这一组的第一个 —— 让用户先看到"现在进入煮沸"，
       投花作为"下一步（就是现在）"出现。否则"开始煮沸"永远不会被高亮。 */
    while (cur > 0) {
      var prevAt = num(steps[cur - 1] && steps[cur - 1].at, 0);
      var curAt = num(steps[cur] && steps[cur].at, 0);
      if (prevAt > 0 && prevAt === curAt) cur--;
      else break;
    }
    out.currentIndex = cur;
    out.currentStep = steps[cur] || null;
    out.elapsedMin = U.round(Math.max(0, t - start) / 60000, 0);

    var ni = cur + 1;
    if (ni < steps.length) {
      out.nextIndex = ni;
      out.nextStep = steps[ni];
      out.nextAt = num(steps[ni].at, 0) || null;
      if (out.nextAt) {
        /* 倒计时不返回负数：到点之后 remainingMs 归 0，
           超出部分放进 nextLateMs。界面上出现"-3 分钟"是最容易被当成 bug 的。 */
        var delta = out.nextAt - t;
        out.remainingMs = delta > 0 ? delta : 0;
        out.nextLateMs = delta > 0 ? 0 : -delta;
      }
    }

    /* 第一个还没打勾的节点（与 currentIndex 不同：允许用户跳步或补勾） */
    for (var k = 0; k < steps.length; k++) {
      if (!steps[k].actualAt && !steps[k].skipped) { out.pendingIndex = k; break; }
    }

    /* 超时：超过预定时刻 5 分钟仍未打勾 */
    for (var o = 0; o < steps.length; o++) {
      var s = steps[o];
      if (!s || s.actualAt || s.skipped) continue;
      var due = num(s.at, 0);
      if (!due) continue;
      if (t > due + D.overdueGraceMin * 60000) {
        out.overdue.push({
          id: s.id,
          key: s.key,
          label: s.label,
          lateMin: U.round((t - due) / 60000, 0)
        });
      }
    }

    return out;
  };

  /** 计划总时长（分钟）——UI 做"预计几点结束"用 */
  BrewdayPlan.duration = function (plan) {
    return num(plan && plan.totalMin, 0);
  };

  /* ======================================================================
   * 三、自检
   * ====================================================================*/
  BrewdayPlan.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    var snap = {
      batchSize: 20,
      boilTime: 60,
      fermentTemp: 19,
      expectedMashWater: 16,
      expectedSpargeWater: 12,
      mashSteps: [
        { name: '糖化', tempC: 66, minutes: 60 },
        { name: '出糖', tempC: 76, minutes: 10 }
      ],
      hops: [
        { name: '马格努姆', amount: 30, stage: 'boil', time: 60 },
        { name: '西楚', amount: 20, stage: 'boil', time: 15 },
        { name: '西楚', amount: 40, stage: 'whirlpool', time: 20 },
        { name: '马赛克', amount: 60, stage: 'dryhop', time: 0 }
      ]
    };

    var T = 1760000000000;
    var plan = BrewdayPlan.build(snap, T);

    /* 1. 结构 */
    ok('有工序节点', plan.steps.length >= 8, String(plan.steps.length));
    ok('总时长 > 3 小时', plan.totalMin > 180, String(plan.totalMin));
    ok('节点按偏移升序', (function () {
      for (var i = 1; i < plan.steps.length; i++) {
        if (plan.steps[i].offsetMin < plan.steps[i - 1].offsetMin) return false;
      }
      return true;
    })());

    /* 2. 关键节点存在且时刻正确：60 分钟苦花应在煮沸开始时 */
    var boil = plan.steps.filter(function (s) { return s.key === 'boil'; })[0];
    var hop60 = plan.steps.filter(function (s) { return s.key === 'hop-0'; })[0];
    var hop15 = plan.steps.filter(function (s) { return s.key === 'hop-1'; })[0];
    ok('有煮沸节点', !!boil, boil && boil.offsetMin);
    ok('60 分钟苦花 = 煮沸开始时刻', !!hop60 && hop60.offsetMin === boil.offsetMin,
      hop60 && (hop60.offsetMin + ' vs ' + boil.offsetMin));
    ok('15 分钟香花晚 45 分钟', !!hop15 && hop15.offsetMin - boil.offsetMin === 45,
      hop15 && String(hop15.offsetMin - boil.offsetMin));
    ok('煮沸用 snapshot.boilTime 而非猜', Math.abs(boil.durMin - 60) < 1e-9, String(boil.durMin));

    /* 3. 干投不进酿造日 */
    ok('干投不出现在时间轴', !plan.steps.some(function (s) { return /马赛克/.test(s.label); }));
    ok('回旋在煮沸之后', (function () {
      var wp = plan.steps.filter(function (s) { return s.key === 'whirlpool'; })[0];
      return wp && wp.offsetMin >= boil.offsetMin + boil.durMin;
    })());

    /* 4. 注入固定 now：currentIndex 必须单调前进 */
    var seq = [];
    var times = [0, 5, 20, 40, 70, 120, 180, 240, 300, 360];
    for (var i = 0; i < times.length; i++) {
      seq.push(BrewdayPlan.tick(plan, T + times[i] * 60000).currentIndex);
    }
    var mono = true;
    for (var j = 1; j < seq.length; j++) if (seq[j] < seq[j - 1]) mono = false;
    ok('currentIndex 随 now 单调前进', mono, seq.join('→'));
    ok('currentIndex 最终走到最后一步', seq[seq.length - 1] === plan.steps.length - 1,
      String(seq[seq.length - 1]));
    ok('开始时刻 currentIndex = 0', seq[0] === 0, String(seq[0]));

    /* 5. 倒计时与超时 */
    var tk = BrewdayPlan.tick(plan, T + 12 * 60000);   /* 12 分钟：应在"升温"或"糖化" */
    ok('倒计时为正', tk.remainingMs > 0, String(tk.remainingMs));
    var late = BrewdayPlan.tick(plan, T + 40 * 60000);
    ok('超时列表非空', late.overdue.length > 0, String(late.overdue.length));
    ok('超时带迟到分钟数', late.overdue[0].lateMin > 0, String(late.overdue[0].lateMin));

    /* 6. 打勾后进度前进 */
    plan.steps[0].actualAt = T + 10 * 60000;
    var t2 = BrewdayPlan.tick(plan, T + 12 * 60000);
    ok('打勾后 doneCount=1', t2.doneCount === 1, String(t2.doneCount));
    ok('打勾后 progress > 0', t2.progress > 0, String(t2.progress));
    ok('打勾的第一步不再报超时', !t2.overdue.some(function (x) { return x.id === plan.steps[0].id; }));
    plan.steps[0].actualAt = 0;

    /* 7. 脏输入 */
    var empty = BrewdayPlan.build(null, 0);
    ok('空快照也能出通用时间轴', empty.steps.length >= 5, String(empty.steps.length));
    ok('空快照有警告', empty.warnings.length > 0);
    var t3 = BrewdayPlan.tick(empty, T);
    ok('未开始时不倒计时', t3.started === false && t3.remainingMs === null);
    ok('tick(null) 不崩', BrewdayPlan.tick(null, T).currentIndex === -1);

    /* 8. 缺 boilTime 时用 60 并警告 */
    var noBoil = BrewdayPlan.build({ mashSteps: [{ name: '糖化', tempC: 65, minutes: 45 }] }, T);
    var b2 = noBoil.steps.filter(function (s) { return s.key === 'boil'; })[0];
    ok('缺 boilTime → 60 分钟', b2 && b2.durMin === 60, b2 && String(b2.durMin));
    ok('缺 boilTime 有警告', noBoil.warnings.some(function (w) { return /煮沸时长/.test(w); }));

    /* 9. 酒花时间超过煮沸时长要被夹住并警告 */
    var over = BrewdayPlan.build({
      boilTime: 60, mashSteps: [{ name: '糖化', tempC: 66, minutes: 60 }],
      hops: [{ name: '苦花', amount: 30, stage: 'boil', time: 90 }]
    }, T);
    ok('超长投花被夹到煮沸开始', over.steps.filter(function (s) { return s.key === 'hop-0'; })[0].offsetMin ===
      over.steps.filter(function (s) { return s.key === 'boil'; })[0].offsetMin);
    ok('超长投花有警告', over.warnings.some(function (w) { return /超过煮沸时长/.test(w); }));

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
