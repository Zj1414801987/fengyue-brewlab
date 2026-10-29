/* ============================================================================
 * 风月酿研所 — 48 图表引擎（Charts）
 * ----------------------------------------------------------------------------
 * 职责：手写 Canvas 图表，不依赖任何图表库。
 * 依赖：00-core
 *
 * 为什么手写：
 *   file:// + 离线 + 十年后可运行，这三个条件排除了所有外链库。
 *   而且家酿只需要四种图：折线、条形、环形、色块。手写比引库更可控。
 *
 * 性能注意：
 *   1. 不用 shadowBlur（在低端机上会把整个页面拖到个位数帧率）
 *   2. 每次都 resetTransform，避免重复绘制时变换累积
 *   3. devicePixelRatio 适配，保证高分屏不模糊
 * ==========================================================================*/
(function (root) {
  'use strict';
  var BREW = root.BREW = root.BREW || {};
  var U = BREW.Util;

  /* ======================================================================
   * 零、配色令牌（v1.6）
   * ----------------------------------------------------------------------
   * 颜色只有一个来源：css/style.css 的 :root。js 里不再存第二份色值。
   *   v1.5 就是在这里抄了一份，CSS 换成新配色之后画布还是黄的，而且没人发现：
   *   canvas 上的颜色错了不报错、不红断言，只会"看起来还行但说不出的怪"。
   *
   * 为什么必须缓存：
   *   getComputedStyle 每调一次都会强制一次样式重算。一张图要取十几个颜色，
   *   而图表在 resize / 切页签 / 改一个输入框时都会整张重画——逐次去问浏览器
   *   等于把重算摊到每一帧上。所以模块加载时读一次，存成普通字符串。
   *
   * 什么情况需要重读：主题/令牌变了（目前没有），或样式表是后注入的。
   *   分辨率档（[data-res]）与字号档（[data-font]）只动尺寸和字体、不动颜色，
   *   所以**不监听**这两个属性——视图重绘时直接用缓存值即可。
   * ====================================================================*/

  /* 语义槽位 → 令牌名。改配色只改这张表，下面画图的代码一行都不用动。 */
  var TOKEN = {
    grid:    '--line',       /* 网格：最轻的发丝线 */
    axis:    '--line-2',     /* 轴线/刻度：比网格实一档 */
    text:    '--tx-3',       /* 刻度数字（三级字） */
    textHi:  '--tx-2',       /* 标签 / 图例 */
    paper:   '--bg-2',       /* 卡纸白：数据点的白心 */
    track:   '--bg-inset',   /* 条形图的轨道 */
    primary: '--s1',         /* 主序列 = 琥珀 */
    copper:  '--s1',
    blue:    '--s2',         /* 第二序列 = 青（右轴数值跟着它） */
    green:   '--s3',
    red:     '--s4',
    purple:  '--s6',
    /* 语义色：批次状态条（46）用。状态是"什么意思"，不是"第几个"，
       所以不跟着系列索引走。 */
    ok:         '--ok',
    warn:       '--warn',
    bad:        '--bad',
    info:       '--info',
    struct:     '--struct',
    structSoft: '--struct-soft',
    structDim:  '--struct-dim',
    amber:      '--amber'
  };

  /* 系列 8 色，**顺序即语义**：1 琥珀 / 2 青 / 3 绿 / 4 红 / 5 蓝 / 6 紫
     / 7 橄榄 / 8 中性灰（灰留给"其它 / 未分类"，国际惯例）。 */
  var SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];

  /* 兜底：令牌读空（样式表还没生效）时退回 v1.5 的旧值。
     宁可画成旧配色，也不要画成黑色或透明——那看上去像"功能坏了"而不是"配色没加载"。
     ⚠️ 兜底表里 --s2 与 --s5 同值：v1.5 只有一种蓝，没有青色可用。
        这只在 CSS 完全没加载时出现，那时整页本来就长得不对，warn 会说明原因。 */
  var FALLBACK = {
    '--line': '#e3d9c6', '--line-2': '#cbbd9c', '--tx-3': '#6e6553', '--tx-2': '#4a4234',
    '--bg-2': '#fffdf8', '--bg-inset': '#f2ecdd',
    '--s1': '#9c5d0e', '--s2': '#2c6290', '--s3': '#376f31', '--s4': '#a83628',
    '--s5': '#2c6290', '--s6': '#5b4a8c', '--s7': '#8a6a1f', '--s8': '#6e6553',
    /* 语义色在 v1.5 里没有独立令牌，用当年最接近的那几个值顶上 */
    '--ok': '#376f31', '--warn': '#8a5a2b', '--bad': '#a83628', '--info': '#2c6290',
    '--struct': '#2c6290', '--struct-soft': '#2c6290', '--struct-dim': '#2c6290',
    '--amber': '#9c5d0e'
  };

  var C = {
    grid: '', axis: '', text: '', textHi: '', paper: '', track: '',
    primary: '', copper: '', blue: '', green: '', red: '', purple: '',
    ok: '', warn: '', bad: '', info: '',
    struct: '', structSoft: '', structDim: '', amber: '',
    palette: ['', '', '', '', '', '', '', '']
  };

  var warnedMissing = false;

  function readColors() {
    var cs = null;
    try {
      cs = (root.getComputedStyle && document.documentElement)
        ? root.getComputedStyle(document.documentElement) : null;
    } catch (e) { cs = null; }

    var missing = [];
    function take(tok) {
      var v = '';
      if (cs) { try { v = cs.getPropertyValue(tok); } catch (e2) { v = ''; } }
      v = (v || '').trim();
      if (!v) {
        missing.push(tok);
        v = FALLBACK[tok] || '#000000';
      }
      return v;
    }

    for (var k in TOKEN) {
      if (Object.prototype.hasOwnProperty.call(TOKEN, k)) C[k] = take(TOKEN[k]);
    }
    /* palette 就地改写（不换数组引用）：外部若拿过 Charts.COLORS.palette 仍有效 */
    for (var i = 0; i < SERIES.length; i++) C.palette[i] = take(SERIES[i]);

    if (missing.length && !warnedMissing) {
      warnedMissing = true;   /* 只 warn 一次：每图每页刷一遍会把真报错淹掉 */
      if (root.console && root.console.warn) {
        root.console.warn('[charts] 配色令牌读不到，已退回 v1.5 兜底色：' + missing.join(', '));
      }
    }
    return C;
  }

  readColors();

  var Charts = BREW.Charts = {};

  /* ======================================================================
   * 一、画布初始化
   * ====================================================================*/
  function setup(canvas) {
    if (!canvas || !canvas.getContext) return null;
    var dpr = (root.devicePixelRatio || 1);
    /* 优先用 CSS 尺寸；若容器隐藏导致为 0，退回属性值 */
    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    var w = Math.round(rect.width) || canvas.width || 600;
    var h = Math.round(rect.height) || canvas.height || 240;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  }

  /* ----------------------------------------------------------------------
   * 画布尺寸自愈
   * ----------------------------------------------------------------------
   * 症状：视图刚往里塞完 DOM 就在同一帧里调图表，getBoundingClientRect 还拿到
   *       旧宽度（或 0，退回 canvas 属性值），画布被按错误宽度定格；之后只有
   *       窗口 resize 才会恢复，用户看到的是一张被拉扁的图。
   *
   * 做法：画完在下一帧再测一次；宽度真的变了就用**同样的参数**重画一次，然后停手
   *       （宽度相等就什么都不做，所以最多多画一次，不会循环）。
   *
   * 为什么放在引擎里而不是让每个调用方各补一次 rAF：
   *       这是所有图表的共性问题。每个调用方各写一遍，就是两套机制并存——
   *       要么画两次，要么以后没人知道哪一次是必要的，谁都不敢删。
   * -------------------------------------------------------------------- */
  function autoFit(canvas, redraw) {
    if (!root.requestAnimationFrame || canvas.__fitRaf) return;
    canvas.__fitRaf = root.requestAnimationFrame(function () {
      canvas.__fitRaf = 0;
      var w = 0;
      try { w = Math.round(canvas.getBoundingClientRect().width); } catch (e) { w = 0; }
      if (!w || Math.abs(w - (canvas.__fitW || 0)) <= 1) {
        canvas.__fitTries = 0;      /* 收敛了：下次布局再变还能自愈 */
        return;
      }
      if ((canvas.__fitTries || 0) >= 3) return;   /* 布局在抖（父容器动画等）：认了，别追 */
      canvas.__fitTries = (canvas.__fitTries || 0) + 1;
      redraw();
    });
  }

  /** 每个图表函数在 setup 之后调一次：记下这次测到的宽度，并安排下一帧复核 */
  function watchSize(canvas, s, redraw) {
    if (!s) return;
    canvas.__fitW = s.w;
    autoFit(canvas, redraw);
  }

  /** 空状态 */
  function drawEmpty(ctx, w, h, msg) {
    ctx.save();
    ctx.fillStyle = C.text;
    ctx.font = '14px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg || '暂无数据', w / 2, h / 2);

    /* 画一个空杯子轮廓，比纯文字好看 */
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 22, h / 2 - 34);
    ctx.lineTo(w / 2 - 16, h / 2 - 8);
    ctx.quadraticCurveTo(w / 2, h / 2 + 2, w / 2 + 16, h / 2 - 8);
    ctx.lineTo(w / 2 + 22, h / 2 - 34);
    ctx.stroke();
    ctx.restore();
  }

  /** 好看的坐标刻度：把范围切成 4 段，每段取 1/2/5×10^n */
  function niceTicks(min, max, count) {
    var span = max - min;
    if (span <= 0) { span = Math.abs(max) || 1; }
    var rough = span / (count || 4);
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var norm = rough / mag;
    var step = norm <= 1.5 ? 1 : (norm <= 3 ? 2 : (norm <= 7 ? 5 : 10));
    step *= mag;

    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step * 0.001; v += step) {
      ticks.push(Math.round(v * 1e6) / 1e6);
    }
    return { lo: lo, hi: hi, step: step, ticks: ticks };
  }

  /* ======================================================================
   * 二、折线图（发酵曲线：比重 + 温度双轴）
   * ----------------------------------------------------------------------
   * @param {canvas} canvas
   * @param {Array}  series   [{ name, points:[{x:ts, y:number}], color, axis:'left'|'right', dashed }]
   * @param {object} opts     { yLabel, y2Label, xIsTime, showPoints, minY, maxY }
   * ====================================================================*/

  /* 轴名归一化。
     不同调用方写法五花八门（left/right、y/y2、primary/secondary），
     不认识就直接当左轴，否则整条线会被静默丢弃、图上什么都看不到。 */
  function axisOf(sr) {
    var a = sr && sr.axis;
    if (a === 'right' || a === 'y2' || a === 'secondary' || a === 2 || a === 'r') return 'right';
    return 'left';
  }

  Charts.line = function (canvas, series, opts) {
    var s = setup(canvas);
    if (!s) return;
    var ctx = s.ctx, w = s.w, h = s.h;
    opts = opts || {};
    watchSize(canvas, s, function () { Charts.line(canvas, series, opts); });

    series = (series || []).filter(function (x) {
      return x && x.points && x.points.length > 0;
    });

    if (series.length === 0) {
      drawEmpty(ctx, w, h, opts.emptyText || '还没有数据点');
      return;
    }

    var pad = { top: 18, right: 52, bottom: 30, left: 50 };
    var plotW = w - pad.left - pad.right;
    var plotH = h - pad.top - pad.bottom;
    if (plotW <= 10 || plotH <= 10) return;

    /* --- X 范围（时间是数值时间戳） --- */
    var allX = [];
    series.forEach(function (sr) {
      sr.points.forEach(function (p) { allX.push(p.x); });
    });
    var xMin = Math.min.apply(null, allX);
    var xMax = Math.max.apply(null, allX);
    if (xMax === xMin) { xMin -= 3600000; xMax += 3600000; }

    /* --- 左右轴各自的范围 --- */
    function rangeOf(axisName) {
      var vals = [];
      series.forEach(function (sr) {
        if (axisOf(sr) !== axisName) return;
        sr.points.forEach(function (p) {
          var y = Number(p.y);
          if (isFinite(y)) vals.push(y);
        });
      });
      if (vals.length === 0) return null;
      var mn = opts[axisName === 'left' ? 'minY' : 'minY2'];
      var mx = opts[axisName === 'left' ? 'maxY' : 'maxY2'];
      var lo = (mn !== undefined && mn !== null) ? mn : Math.min.apply(null, vals);
      var hi = (mx !== undefined && mx !== null) ? mx : Math.max.apply(null, vals);
      if (hi - lo < 0.002) { lo -= 0.002; hi += 0.002; }   /* 全平的线也要能看见 */
      var padRatio = (hi - lo) * 0.12;
      var outLo = lo - padRatio;
      var outHi = hi + padRatio;
      /* 下界不许被外扩成负数 —— 当原始数据本来就没有负值的时候。
         12% 外扩在 lo=0 时造出 -4.8，再经 niceTicks 的
         Math.floor(min/step)*step 往下取整，刻度就变成 "-10 IBU / -5 天 / -5 °C"
         这种不可能存在的值（审计实测：IBU [0,20,40] → [-10,0,…,50]）。
         判据用"原始 lo >= 0"而不是"钳到某个最小值"：
         温差这类**本来就有负值**的序列仍然是 lo<0，走正常扩边，不受影响。 */
      if (lo >= 0 && outLo < 0) outLo = 0;
      return { lo: outLo, hi: outHi };
    }

    var rl = rangeOf('left'), rr = rangeOf('right');

    /* 判断左轴是不是比重轴 */
    opts = opts || {};
    if (opts._sgAxis === undefined) {
      opts._sgAxis = !!(rl && rl.lo > 0.95 && rl.hi < 1.30);
    }

    /* --- 网格与左轴 --- */
    var tickInfo = rl ? niceTicks(rl.lo, rl.hi, 4) : null;
    if (!tickInfo) { tickInfo = { lo: 0, hi: 1, ticks: [0, 0.5, 1] }; rl = { lo: 0, hi: 1 }; }

    ctx.font = '12.5px "Times New Roman", Times, "SF Mono", Consolas, monospace';
    ctx.textAlign = 'right';

    for (var i = 0; i < tickInfo.ticks.length; i++) {
      var tv = tickInfo.ticks[i];
      var yy = pad.top + plotH - (tv - tickInfo.lo) / (tickInfo.hi - tickInfo.lo) * plotH;
      if (yy < pad.top - 1 || yy > pad.top + plotH + 1) continue;

      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, Math.round(yy) + 0.5);
      ctx.lineTo(pad.left + plotW, Math.round(yy) + 0.5);
      ctx.stroke();

      ctx.fillStyle = C.text;
      /* 标签小数位由两步决定：
         1) 若左轴整体落在 0.95–1.30，几乎一定是比重（SG），固定 3 位小数——
            家酿习惯读 1.062 而不是 1.06，少一位就丢信息。
         2) 否则按刻度步长定：步长越大位数越少，避免出现"1.0 / 1.0 / 1.0"。 */
      var label;
      if (opts.yDigits !== undefined) {
        label = tv.toFixed(opts.yDigits);
      } else if (opts._sgAxis) {
        label = tv.toFixed(3);
      } else {
        var st = tickInfo.step;
        label = st >= 1 ? tv.toFixed(0)
              : (st >= 0.1 ? tv.toFixed(1)
              : (st >= 0.01 ? tv.toFixed(2) : tv.toFixed(3)));
      }
      ctx.fillText(label, pad.left - 8, yy);
    }

    /* --- 右轴 --- */
    if (rr) {
      var tickR = niceTicks(rr.lo, rr.hi, 4);
      ctx.textAlign = 'left';
      for (var j = 0; j < tickR.ticks.length; j++) {
        var tv2 = tickR.ticks[j];
        var yy2 = pad.top + plotH - (tv2 - tickR.lo) / (tickR.hi - tickR.lo) * plotH;
        if (yy2 < pad.top - 1 || yy2 > pad.top + plotH + 1) continue;
        ctx.fillStyle = opts.y2Color || C.blue;
        ctx.fillText(tv2.toFixed(0), pad.left + plotW + 8, yy2);
      }
      rr = { lo: tickR.lo, hi: tickR.hi };
    }

    /* --- X 轴标签（时间） --- */
    ctx.textAlign = 'center';
    ctx.fillStyle = C.text;
    var xLabelCount = Math.min(5, Math.max(2, Math.floor(plotW / 90)));
    for (var k = 0; k <= xLabelCount; k++) {
      var frac = k / xLabelCount;
      var tx = pad.left + plotW * frac;
      var tval = xMin + (xMax - xMin) * frac;
      ctx.strokeStyle = C.axis;
      ctx.beginPath();
      ctx.moveTo(Math.round(tx) + 0.5, pad.top + plotH);
      ctx.lineTo(Math.round(tx) + 0.5, pad.top + plotH + 4);
      ctx.stroke();

      var d = new Date(tval);
      var lab = opts.xIsTime === false
        ? String(Math.round(tval))
        : (String(d.getMonth() + 1) + '/' + String(d.getDate()));
      ctx.fillText(lab, tx, pad.top + plotH + 16);
    }

    /* --- 画线 --- */
    series.forEach(function (sr, idx) {
      var isRight = (axisOf(sr) === 'right');
      var rng = isRight ? rr : rl;
      if (!rng) return;
      var color = sr.color || C.palette[idx % C.palette.length];

      var pts = sr.points.slice().sort(function (a, b) { return a.x - b.x; });
      var mapped = pts.map(function (p) {
        return {
          x: pad.left + (p.x - xMin) / (xMax - xMin) * plotW,
          y: pad.top + plotH - (p.y - rng.lo) / (rng.hi - rng.lo) * plotH,
          raw: p
        };
      });

      /* 面积填充（只有一条左轴线时画，避免视觉混乱） */
      if (opts.fill !== false && !isRight) {
        ctx.beginPath();
        ctx.moveTo(mapped[0].x, pad.top + plotH);
        for (var m = 0; m < mapped.length; m++) ctx.lineTo(mapped[m].x, mapped[m].y);
        ctx.lineTo(mapped[mapped.length - 1].x, pad.top + plotH);
        ctx.closePath();
        var grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
        grad.addColorStop(0, hexA(color, 0.22));
        grad.addColorStop(1, hexA(color, 0.01));
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = opts.lineWidth || 2;
      if (sr.dashed) {
        ctx.setLineDash([5, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      for (var n = 0; n < mapped.length; n++) {
        if (n === 0) ctx.moveTo(mapped[n].x, mapped[n].y);
        else {
          /* 平滑曲线：用中点二次贝塞尔，避免尖角 */
          if (opts.smooth !== false && mapped.length > 2) {
            var prev = mapped[n - 1], cur = mapped[n];
            var mx = (prev.x + cur.x) / 2, my = (prev.y + cur.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
            if (n === mapped.length - 1) ctx.lineTo(cur.x, cur.y);
          } else {
            ctx.lineTo(mapped[n].x, mapped[n].y);
          }
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      /* 数据点 */
      if (opts.showPoints !== false) {
        for (var q = 0; q < mapped.length; q++) {
          ctx.beginPath();
          ctx.arc(mapped[q].x, mapped[q].y, 2.6, 0, Math.PI * 2);
          ctx.fillStyle = C.paper;   /* 白心压住穿过的线，点才读得清 */
          ctx.fill();
          ctx.beginPath();
          ctx.arc(mapped[q].x, mapped[q].y, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
    });

    /* --- 图例 --- */
    if (series.length > 1 && opts.legend !== false) {
      ctx.textAlign = 'left';
      ctx.font = '13px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      var lx = pad.left + 6, ly = pad.top + 8;
      series.forEach(function (sr, idx) {
        var color = sr.color || C.palette[idx % C.palette.length];
        ctx.fillStyle = color;
        ctx.fillRect(lx, ly - 1, 10, 3);
        ctx.fillStyle = C.textHi;
        ctx.fillText(sr.name || ('序列 ' + (idx + 1)), lx + 15, ly + 1);
        lx += ctx.measureText(sr.name || ('序列 ' + (idx + 1))).width + 34;
      });
    }

    /* --- 边框 --- */
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + plotH + 0.5);
    ctx.lineTo(pad.left + plotW, pad.top + plotH + 0.5);
    ctx.stroke();
  };

  /* ======================================================================
   * 三、水平条形图（原料贡献占比 / 月度分布）
   * ----------------------------------------------------------------------
   * @param {canvas} canvas
   * @param {Array}  items  [{ label, value, color, sub }]
   * @param {object} opts   { maxBars, unit, showPct, digits, labelWidth, sort }
   *
   * opts.sort === false 时**保持传入顺序**，不做排序。
   *   为什么需要这个参数：月度分布的时间轴必须按时间序。默认的"按值降序"会把
   *   3 月排到 1 月前面，读起来像"最近在增长"，而实际可能只是 3 月恰好酿得多。
   *   柱状图的第一属性是时间顺序，不是数值大小。
   *   缺省（不传）仍是按值降序 —— 既有调用方全都依赖旧行为，这个参数只加不改。
   * ====================================================================*/
  Charts.bar = function (canvas, items, opts) {
    var s = setup(canvas);
    if (!s) return;
    var ctx = s.ctx, w = s.w, h = s.h;
    opts = opts || {};
    watchSize(canvas, s, function () { Charts.bar(canvas, items, opts); });

    items = (items || []).filter(function (it) { return it && isFinite(it.value); });
    if (items.length === 0) {
      drawEmpty(ctx, w, h, opts.emptyText || '暂无数据');
      return;
    }

    var maxBars = opts.maxBars || Math.floor((h - 10) / 26);
    if (opts.sort === false) {
      items = items.slice(0, maxBars);
    } else {
      items = items.slice().sort(function (a, b) { return b.value - a.value; }).slice(0, maxBars);
    }

    var total = items.reduce(function (a, c) { return a + c.value; }, 0);
    var maxV = Math.max.apply(null, items.map(function (x) { return x.value; })) || 1;

    var labelW = opts.labelWidth || 104;
    var valueW = 62;
    var barMaxW = w - labelW - valueW - 12;
    var rowH = Math.min(26, (h - 10) / items.length);

    ctx.font = '13.5px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var y = 5 + i * rowH + rowH / 2;

      /* 标签（超长截断） */
      ctx.textAlign = 'right';
      ctx.fillStyle = C.textHi;
      var lab = String(it.label || '');
      while (ctx.measureText(lab).width > labelW - 8 && lab.length > 3) {
        lab = lab.slice(0, -2) + '…';
      }
      ctx.fillText(lab, labelW - 8, y);

      /* 条 */
      var bw = Math.max(2, it.value / maxV * barMaxW);
      var color = it.color || C.palette[i % C.palette.length];

      /* 轨道 */
      ctx.fillStyle = C.track;
      ctx.fillRect(labelW, y - rowH * 0.3, barMaxW, rowH * 0.6);

      /* 值条 */
      ctx.fillStyle = color;
      ctx.fillRect(labelW, y - rowH * 0.3, bw, rowH * 0.6);

      /* 数值 */
      ctx.textAlign = 'left';
      ctx.fillStyle = C.textHi;
      var txt = (opts.showPct && total > 0)
        ? U.fixed(it.value / total * 100, 1) + '%'
        : U.fixed(it.value, opts.digits === undefined ? 1 : opts.digits) + (opts.unit || '');
      ctx.fillText(txt, labelW + bw + 8, y);
    }
  };

  /* ======================================================================
   * 四、环形图（成本构成、酒花阶段分布）
   * ====================================================================*/
  Charts.donut = function (canvas, items, opts) {
    var s = setup(canvas);
    if (!s) return;
    var ctx = s.ctx, w = s.w, h = s.h;
    opts = opts || {};
    watchSize(canvas, s, function () { Charts.donut(canvas, items, opts); });

    items = (items || []).filter(function (it) { return it && isFinite(it.value) && it.value > 0; });
    if (items.length === 0) {
      drawEmpty(ctx, w, h, opts.emptyText || '暂无数据');
      return;
    }

    var total = items.reduce(function (a, c) { return a + c.value; }, 0);
    var cx = opts.cx !== undefined ? opts.cx : Math.min(w * 0.36, h * 0.55);
    var cy = h / 2;
    var outer = Math.min(h * 0.42, (opts.cx !== undefined ? h * 0.42 : w * 0.30));
    var inner = outer * 0.58;

    var start = -Math.PI / 2;
    for (var i = 0; i < items.length; i++) {
      var frac = items[i].value / total;
      var end = start + frac * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, outer, start, end);
      ctx.arc(cx, cy, inner, end, start, true);
      ctx.closePath();
      ctx.fillStyle = items[i].color || C.palette[i % C.palette.length];
      ctx.fill();
      start = end;
    }

    /* 中心文字 */
    ctx.textAlign = 'center';
    ctx.fillStyle = C.textHi;
    ctx.font = '12px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(opts.centerLabel || '合计', cx, cy - 8);
    ctx.fillStyle = C.primary;
    ctx.font = 'bold 19px "Times New Roman", Times, "SF Mono", Consolas, monospace';
    ctx.fillText(opts.centerValue || String(total), cx, cy + 10);

    /* 图例 */
    ctx.textAlign = 'left';
    ctx.font = '13.5px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    var lx = cx + outer + 22;
    var ly = cy - (items.length * 19) / 2 + 6;
    for (var j = 0; j < items.length; j++) {
      var color = items[j].color || C.palette[j % C.palette.length];
      ctx.fillStyle = color;
      ctx.fillRect(lx, ly - 4, 9, 9);
      ctx.fillStyle = C.textHi;
      var label = String(items[j].label || '') + '  ' + U.fixed(items[j].value / total * 100, 0) + '%';
      ctx.fillText(label, lx + 14, ly);
      ly += 19;
    }
  };

  /* ======================================================================
   * 五、色度色块（配方颜色预览）
   * ----------------------------------------------------------------------
   * 画成"一杯酒"的样子：杯身填充酒色，上方留泡沫。
   * ====================================================================*/
  Charts.beerGlass = function (canvas, srm, opts) {
    var s = setup(canvas);
    if (!s) return;
    var ctx = s.ctx, w = s.w, h = s.h;
    opts = opts || {};
    /* 酒杯同样是"插进 DOM 就画"，尺寸自愈一并接上（签名不变） */
    watchSize(canvas, s, function () { Charts.beerGlass(canvas, srm, opts); });

    var color = BREW.color.fromSRM(srm);
    var hex = BREW.color.hexFromSRM(srm);

    var gw = Math.min(w * 0.52, h * 0.62);   /* 杯宽 */
    var gh = h * 0.78;
    var gx = (w - gw) / 2;
    var gy = (h - gh) / 2 + h * 0.04;

    ctx.save();

    /* 杯身路径（上宽下窄的梯形 + 圆角底） */
    function glassPath() {
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + gw, gy);
      ctx.lineTo(gx + gw * 0.86, gy + gh * 0.94);
      ctx.quadraticCurveTo(gx + gw * 0.5, gy + gh * 1.02, gx + gw * 0.14, gy + gh * 0.94);
      ctx.closePath();
    }

    /* 酒液（从 18% 高度开始，上面是泡沫） */
    var liquidTop = gy + gh * 0.20;
    ctx.save();
    glassPath();
    ctx.clip();

    /* 液体渐变，模拟透光 */
    var grad = ctx.createLinearGradient(0, liquidTop, 0, gy + gh);
    grad.addColorStop(0, hexA(hex, 0.92));
    grad.addColorStop(1, hexA(hex, 0.72));
    ctx.fillStyle = grad;
    ctx.fillRect(gx, liquidTop, gw, gh);

    /* 泡沫 */
    ctx.fillStyle = 'rgba(248,242,230,0.90)';
    ctx.fillRect(gx, gy, gw, gh * 0.22);

    /* 泡沫下沿的起伏 */
    ctx.beginPath();
    ctx.moveTo(gx, liquidTop);
    for (var x = 0; x <= gw; x += 6) {
      ctx.lineTo(gx + x, liquidTop + Math.sin(x / 9) * 3.2);
    }
    ctx.lineTo(gx + gw, liquidTop + 8);
    ctx.lineTo(gx, liquidTop + 8);
    ctx.closePath();
    ctx.fillStyle = hexA(hex, 0.95);
    ctx.fill();

    /* 高光 */
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.ellipse(gx + gw * 0.24, gy + gh * 0.55, gw * 0.07, gh * 0.26, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    /* 杯壁 */
    glassPath();
    ctx.strokeStyle = 'rgba(240,230,210,0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 把手 */
    ctx.beginPath();
    ctx.arc(gx + gw * 0.96, gy + gh * 0.42, gw * 0.20, -Math.PI * 0.42, Math.PI * 0.42);
    ctx.strokeStyle = 'rgba(240,230,210,0.22)';
    ctx.lineWidth = 3;
    ctx.stroke();

    /* SRM 数值 */
    ctx.textAlign = 'center';
    ctx.fillStyle = C.textHi;
    ctx.font = '13px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(U.fixed(srm, 1) + ' SRM · ' + BREW.color.nameFromSRM(srm), w / 2, h - 8);

    ctx.restore();
  };

  /* ======================================================================
   * 六、迷你火花线（用于列表里的趋势提示）
   * ====================================================================*/
  Charts.sparkline = function (canvas, values, opts) {
    var s = setup(canvas);
    if (!s) return;
    var ctx = s.ctx, w = s.w, h = s.h;
    opts = opts || {};
    watchSize(canvas, s, function () { Charts.sparkline(canvas, values, opts); });

    values = (values || []).filter(function (v) { return isFinite(v); });
    if (values.length < 2) return;

    var mn = Math.min.apply(null, values);
    var mx = Math.max.apply(null, values);
    var span = mx - mn || 1;
    var pad = 3;

    ctx.beginPath();
    for (var i = 0; i < values.length; i++) {
      var x = pad + (w - pad * 2) * (i / (values.length - 1));
      var y = h - pad - (values[i] - mn) / span * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = opts.color || C.primary;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    /* 末点 */
    var lx = pad + (w - pad * 2);
    var ly = h - pad - (values[values.length - 1] - mn) / span * (h - pad * 2);
    ctx.beginPath();
    ctx.arc(lx - 1, ly, 2, 0, Math.PI * 2);
    ctx.fillStyle = opts.color || C.primary;
    ctx.fill();
  };

  /* ======================================================================
   * 六点五、雷达图（BJCP 品鉴：五段得分）
   * ----------------------------------------------------------------------
   * @param {canvas} canvas
   * @param {Array}  axes  [{ label:'香气', value:9, max:12 }, …]，3–8 轴
   * @param {object} opts  { color, showValues }
   *
   * ⚠️ **归一化必须按 value/max**，不能按原始分数：
   *   风味满分 20、外观满分 3，直接用原始分数画，外观那一轴会被压成一条线，
   *   整张图形状完全由风味决定——看起来像"这酒只有风味"，那是画法错误，
   *   不是酒的问题。归一化后每个轴都是"拿到该项满分的百分之几"。
   * ====================================================================*/
  Charts.radar = function (canvas, axes, opts) {
    var s = setup(canvas);
    if (!s) return;
    var ctx = s.ctx, w = s.w, h = s.h;
    opts = opts || {};

    var list = (axes || []).filter(function (a) { return a && isFinite(a.max) && a.max > 0; });
    if (list.length < 3) {
      drawEmpty(ctx, w, h, '至少需要 3 个评分段');
      return;
    }
    /* 全都没打分时不画空雷达：空图形会被读成"得了 0 分" */
    var any = false;
    for (var i = 0; i < list.length; i++) {
      if (isFinite(list[i].value) && list[i].value !== null) { any = true; break; }
    }
    if (!any) {
      drawEmpty(ctx, w, h, '还没有打分');
      return;
    }

    var cx = w / 2;
    var cy = h / 2 + 4;
    /* 留出标签的空间：半径取短边的 32%，标签才不会被裁掉 */
    var R = Math.min(w, h) * 0.32;
    var n = list.length;
    var color = opts.color || C.primary;

    function pt(idx, ratio) {
      /* 从 12 点方向开始顺时针，符合"香气在顶"的阅读习惯 */
      var ang = -Math.PI / 2 + idx * (Math.PI * 2 / n);
      return { x: cx + Math.cos(ang) * R * ratio, y: cy + Math.sin(ang) * R * ratio, ang: ang };
    }

    /* 1) 网格：4 圈 */
    for (var ring = 4; ring >= 1; ring--) {
      var r = ring / 4;
      ctx.beginPath();
      for (var g = 0; g < n; g++) {
        var p = pt(g, r);
        if (g === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.strokeStyle = ring === 4 ? C.axis : C.grid;
      ctx.lineWidth = ring === 4 ? 1.2 : 1;
      ctx.stroke();
    }

    /* 2) 轴线 */
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (var a = 0; a < n; a++) {
      var pa = pt(a, 1);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(pa.x, pa.y);
      ctx.stroke();
    }

    /* 3) 数据多边形（先算比率，缺值按 0 画但标签标「—」） */
    var ratios = [];
    for (var d = 0; d < n; d++) {
      var v = list[d].value;
      var ok = isFinite(v) && v !== null;
      ratios.push(ok ? Math.max(0, Math.min(1, v / list[d].max)) : 0);
    }

    ctx.beginPath();
    for (var q = 0; q < n; q++) {
      var pq = pt(q, ratios[q]);
      if (q === 0) ctx.moveTo(pq.x, pq.y); else ctx.lineTo(pq.x, pq.y);
    }
    ctx.closePath();
    ctx.fillStyle = hexA(color, 0.22);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 4) 顶点 + 该段得分（小字，紧贴顶点外侧） */
    ctx.font = '12px "Times New Roman", Times, "SF Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    for (var k = 0; k < n; k++) {
      var pk = pt(k, ratios[k]);
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (opts.showValues === false) continue;
      var vv = list[k].value;
      var txt = (isFinite(vv) && vv !== null) ? String(Math.round(vv * 10) / 10) : '—';
      ctx.fillStyle = C.textHi;
      ctx.fillText(txt, pk.x, pk.y - 8);
    }

    /* 5) 轴标签：贴在网格外沿，左右两侧按位置对齐，避免互相压字 */
    ctx.font = '13.5px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    for (var t = 0; t < n; t++) {
      var pt2 = pt(t, 1.18);
      var cosv = Math.cos(pt2.ang);
      ctx.textAlign = cosv > 0.3 ? 'left' : (cosv < -0.3 ? 'right' : 'center');
      ctx.fillStyle = C.textHi;
      ctx.fillText(String(list[t].label || ''), pt2.x, pt2.y);
      /* 满分也标出来：读者要看的是"拿到了满分里的多少" */
      ctx.font = '12px "Times New Roman", Times, "SF Mono", Consolas, monospace';
      ctx.fillStyle = C.text;
      ctx.fillText('满 ' + list[t].max, pt2.x, pt2.y + 13);
      ctx.font = '13.5px "Times New Roman", Times, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    }

    /* 与其他图表同一套尺寸自愈：刚插进 DOM 就画时宽度可能还是旧的，
       这里交给引擎统一复核一次，不在调用方另写 rAF（两套机制会画两次） */
    watchSize(canvas, s, function () { Charts.radar(canvas, axes, opts); });
  };

  /* ======================================================================
   * 七、工具
   * ====================================================================*/

  /** 把 #rrggbb 转成 rgba() */
  function hexA(hex, alpha) {
    if (!hex) return 'rgba(156,93,14,' + alpha + ')';
    if (hex.indexOf('rgb') === 0) {
      var nums = hex.match(/\d+/g) || [232, 163, 61];
      return 'rgba(' + nums[0] + ',' + nums[1] + ',' + nums[2] + ',' + alpha + ')';
    }
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16);
    var g = parseInt(h.substr(2, 2), 16);
    var b = parseInt(h.substr(4, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }
  Charts.hexA = hexA;

  /** 窗口尺寸变化时重绘所有图表：视图应该监听这个事件 */
  Charts.autoRedraw = function (drawFn, delay) {
    if (!root.addEventListener) return;
    var t = null;
    root.addEventListener('resize', function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; drawFn(); }, delay || 180);
    });
  };

  Charts.COLORS = C;

  /** 重读配色令牌（换主题 / 后注入样式表时调用）。返回同一个 C 对象。
   *  ⚠️ 重读**不会**自动重绘：已经画在画布上的像素是死的，谁画的谁重画。 */
  Charts.refreshColors = function () { return readColors(); };

  /** 第 i 个系列的颜色（环形图、条形图、A/B 多序列都用这一处取色，
   *  不要再在界面文件里另抄一份数组——两份数组迟早不同步）。 */
  Charts.seriesColor = function (i) {
    var n = C.palette.length;
    return C.palette[((i % n) + n) % n];
  };

  /* 分类占比用的 6 个槽位：--s1 琥珀 / --s2 青 / --s3 绿 / --s5 蓝 /
     --s6 紫 / --s7 橄榄 —— **刻意跳过 --s4（红）与 --s8（灰）**。
     · 红在这套系统里是语义色（--bad）：风格分布里第 4 个风格被涂成红，
       读起来像"这个风格有问题"，而它只是一锅世涛。
     · 灰留给"其它 / 未分类"（第 7 项及以后一律灰），这是国际惯例，
       也和 51 里"未拆分"用灰的口径一致。
     有序序列（折线、多序列对比）不走这张表：那里的红是"第 4 锅酒"，
     有位置含义，见 54 的说明。 */
  var CAT_SLOT = [0, 1, 2, 4, 5, 6];

  /** 分类占比（环形图 / 带"其它"的图例）的颜色。第 7 项起一律中性灰。 */
  Charts.categoricalColor = function (i) {
    var at = (i | 0);
    if (at < 0) at = 0;
    return at < CAT_SLOT.length ? C.palette[CAT_SLOT[at]] : C.palette[7];
  };

})(typeof window !== 'undefined' ? window : globalThis);
