/* ============================================================================
 * 风月酿研所 — 49-ui-label.js
 * ----------------------------------------------------------------------------
 * 职责：酒标设计器（挂在 55 配方卡的「酒标」页签里）。
 *
 * v1.2 为什么是模板制（历史，别删）：
 *   自由的文本块要配命中测试、对齐线、撤销栈、z 序，成本是模板制的五倍，
 *   而当时用户真正缺的是"能体面地印出来"，不是"能摆到任意位置"。所以那时
 *   只有三种版式 + 四个文本框，位置由版式算，一个像素都不存。
 *
 * v1.5 为什么改成自由布局、这次为什么值得付：
 *   v1.5 的用户已经用模板印过几轮了。他们拿着自己的图（手绘标、老照片、
 *   酒花特写）来，模板制对他们等于"只能用我们的排版"。这不是审美偏好：
 *   产品从"生成器"变成"设计器"，第一件必须让出来的就是排版权。
 *   代价也确实付了：命中测试、中线吸附、40 步撤销、两级图片压缩、图片配额
 *   账本 —— 本文件因此从 940 行涨到 1600 行，是模板制的四倍。
 *
 * 但底线没变：**老的模板路径原样保留**。
 *   没有 elements 字段的存档，一个新字段都不读，draw() 里走 template 分支，
 *   位置/字号/配色与 v1.2 逐字一致（test-wave2 §8b 的对比度用例还在盯这条）。
 *   自由布局是**每张标自己选的模式**，不是全局开关：老标打开还是老样子，
 *   新标点「转为自由布局」才换成可拖的。这样升级不会让任何人手上的旧标变样。
 *
 * 三种版式（300dpi）：
 *   square  1181 × 1181   10 cm 见方
 *   a6      1181 × 1772   10 × 15 cm @300dpi
 *   round   827 × 827     正方形画布画圆，导出后按圆裁切
 *
 * 存储（三条铁律，改之前先读）：
 *   ① 参数：`labels[<recipeId>] = [{ id,name,at,format,style,text,bg,elements }]`，
 *      每配方最多 3 张。style/text 是 v1.2 的四个文本框，bg/elements 是 v1.5 新增；
 *      **没有 elements 的标走模板路径**，所以这四段老字段一个字都不能少。
 *   ② 图片：**不进 labels**，存独立的顶层键 `brewlab.studio.v1.labelimg.<imgId>`。
 *      塞进 labels 的话，每次读 labels 都要反序列化几 MB —— 面板一刷新就卡。
 *   ③ 坐标：x/y 是 0–1 相对值，size 是"占画布短边的比例"。绝对像素在
 *      方形↔4×6 之间切换会全部错位，而 300dpi 导出又要求位置精确；
 *      只有相对坐标能同时满足这两件事。
 *
 * 依赖：BREW.UI（esc/attr/num/fmt/icon/recipe/uid/dt/store）、BREW.UI.Resizer
 * 对外：BREW.UI.LabelPanel.mount(box, opts)
 *       BREW.UI.LabelPanel.draw(canvas, spec)
 *       BREW.UI.LabelPanel.imageStats()
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  BREW.UI = BREW.UI || {};
  var UI = BREW.UI;
  var esc = UI.esc, attr = UI.attr, num = UI.num, fmt = UI.fmt, icon = UI.icon;

  var L = UI.LabelPanel = UI.LabelPanel || {};

  var MAX_PER_RECIPE = 3;
  var UNDO_MAX = 40;              /* 需求写"至少 20 步"，给到 40 —— 一份快照才 1–2 KB */

  /* 草稿：切到「配方卡」页签再切回来时，用户刚选的版式与文案不能丢（⑧）。
     只放内存、按配方 id 归属——换配方就自动换成那份配方的草稿，
     不写 settings 是因为它是"编辑中"而不是"默认值"，写进去会污染新酒标的默认版式。 */
  var draft = { recipeId: '', spec: null, editingId: '' };

  var FORMATS = {
    square: { w: 1181, h: 1181, zh: '方形 1:1（10×10 cm）' },
    a6: { w: 1181, h: 1772, zh: '4×6 竖版（10×15 cm @300dpi）' },
    /* 7 cm 直径：330ml 瓶身约 62 mm，市售圆标纸常见 50/60/70/80 mm，70 是主流。
       10 cm 会绕过大半个瓶身。827 px ≈ 70 mm @300dpi */
    round: { w: 827, h: 827, zh: '圆标 ⌀7 cm（约 827×827 px）' }
  };

  /* 宋体族：酒标是有纸质感的印刷品，无衬线在这件事上永远像 PPT */
  var SERIF = "'Songti SC','STSong','SimSun','Noto Serif CJK SC',serif";
  var SANS = "-apple-system,'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif";

  var TEXT_LABELS = { title: '主标题', sub: '副标题', line1: '参数行', foot: '底部署名' };

  function toast(msg, kind, ms) {
    if (UI.Shell && UI.Shell.toast) UI.Shell.toast(msg, kind || 'info', ms || 2600);
  }

  function store() { return BREW.Store || null; }

  function clamp(v, lo, hi) {
    v = num(v, lo);
    if (lo !== undefined && v < lo) v = lo;
    if (hi !== undefined && v > hi) v = hi;
    return v;
  }

  function clamp01(v) { return clamp(v, 0, 1); }

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ---------------------------------------------------------------
   * D5：键要经过 Store.labelKeyOf 解析。
   * 未保存的配方，工作副本 id 是 UI.blankRecipe() 每次刷新现发的 uid——
   * 直接拿它当键，等于把酒标写进一个下次就再也找不到的抽屉。
   * Store 会把"库里没有这个 id"的配方统一解析到固定的 '__draft__'，
   * 并在第一次真正保存时把草稿桶迁到真 id 下（adoptDraftLabels，幂等）。
   * 注意：这里只改键的解析，不改任何存储结构。
   * --------------------------------------------------------------- */
  function keyOf(recipeId) {
    var s = store();
    if (s && typeof s.labelKeyOf === 'function') {
      return s.labelKeyOf({ id: recipeId });
    }
    return recipeId || null;
  }

  function labelsOf(recipeId) {
    var key = keyOf(recipeId);
    if (!key) return [];
    try {
      var all = store() ? store().get('labels', null) : null;
      var arr = (all && all[key]) || [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveLabelsFor(recipeId, list) {
    var key = keyOf(recipeId);
    if (!key) return false;
    var s = store();
    if (!s) return false;
    try {
      var all = s.get('labels', null);
      if (!all || typeof all !== 'object') all = {};
      all[key] = (list || []).slice(0, MAX_PER_RECIPE);
      s.set('labels', all);
      if (typeof s.flushNow === 'function') s.flushNow();
      return true;
    } catch (e) {
      toast('保存失败：' + ((e && e.message) || '未知错误'), 'error');
      return false;
    }
  }

  /* ======================================================================
   * 0. 图片仓库（独立顶层键 + 三级预算）
   * ----------------------------------------------------------------------
   * 预算是这么算出来的，改数字之前先复核一遍（换成别的浏览器要重测）：
   *
   *   总容量        5,242,867 字符（BREW.Config QUOTA_CHARS，Chrome file:// 实测）
   *   单张硬上限      260,000 字符   —— 一张 1181×1772 的 JPEG q0.85 有 40–70 万字符，
   *                                    base64 后一张就吃掉总容量的 1/6，所以必须压。
   *   全局图片预算  1,600,000 字符   —— 约占总容量 30%，给配方/批次/库存/快照留 70%。
   *                                    超过就**明确拒绝**，不许静默降质。
   *
   * 压缩阶梯（逐级降，命中 26 万就停）：
   *   JPEG：长边 900 / 760 / 640 / 520 / 420 × 质量 0.75 / 0.65 / 0.55 / 0.45 / 0.35
   *   PNG （勾"保留透明"）：长边 700 / 560 / 440 / 360 / 280（PNG 无质量档）
   * 全都压不下来 → 拒绝，并告诉用户三条可做的事。
   *
   * 为什么用 base64 dataURL 而不是 Blob：Blob 不能进 localStorage，
   * 而 IndexedDB 在 file:// 下的可用性在各浏览器之间不一致（实测有 Promise
   * 直接 reject 的），这个应用的全部存储都在 localStorage 这一条链上，
   * 多开一条不可靠的存储路径，等于给"刷新后图没了"埋雷。
   * ==================================================================== */

  var IMG_PREFIX = ((BREW.Config && BREW.Config.STORAGE_KEY) || 'brewlab.studio.v1') + '.labelimg.';
  var IMG_SINGLE_MAX = 260000;
  var IMG_BUDGET = 1600000;
  var IMG_SIDE_JPEG = [900, 760, 640, 520, 420];
  var IMG_Q_JPEG = [0.75, 0.65, 0.55, 0.45, 0.35];
  var IMG_SIDE_PNG = [700, 560, 440, 360, 280];

  var IMG_CACHE = {};   /* imgId → { img, ok, started, failed, waiters:[] } */

  function lsGet(k) {
    try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { root.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }
  function lsDel(k) {
    try { root.localStorage.removeItem(k); return true; } catch (e) { return false; }
  }
  function lsKeys() {
    var out = [], ls;
    try { ls = root.localStorage; } catch (e) { return out; }
    if (!ls) return out;
    try {
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (k) out.push(k);
      }
    } catch (e2) { /* 读一半失败就返回已读到的 */ }
    return out;
  }

  function imgKey(id) { return IMG_PREFIX + id; }
  function imgGet(id) { return id ? lsGet(imgKey(id)) : null; }
  function imgChars(id) { var v = imgGet(id); return v ? v.length : 0; }

  /** 图片占用现状。界面上的"已用 X / 剩余可放 N 张"就是拿它算的 */
  function imageStats() {
    var keys = lsKeys(), chars = 0, count = 0, i, v;
    for (i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(IMG_PREFIX) !== 0) continue;
      v = lsGet(keys[i]) || '';
      chars += v.length;
      count++;
    }
    var capacity = (BREW.Config && BREW.Config.QUOTA_CHARS) || 5242867;
    return {
      count: count,
      chars: chars,
      budget: IMG_BUDGET,
      remaining: Math.max(0, IMG_BUDGET - chars),
      singleMax: IMG_SINGLE_MAX,
      capacity: capacity
    };
  }

  /** 回收没有被任何酒标引用的图。**必须调用**：图换了、标删了都要回收，
      否则 localStorage 里会攒下一堆再也取不出来的几百万字符。 */
  function gcImages(keep) {
    var keys = lsKeys(), drop = [], i, id;
    for (i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(IMG_PREFIX) !== 0) continue;
      id = keys[i].slice(IMG_PREFIX.length);
      if (keep && keep[id]) continue;
      drop.push(keys[i]);
    }
    for (i = 0; i < drop.length; i++) {
      lsDel(drop[i]);
      delete IMG_CACHE[drop[i].slice(IMG_PREFIX.length)];
    }
    return drop.length;
  }

  /** 取已解码的图；没加载过就返回 null 并**顺手开始加载**。
      用 new Image() + onload 而不是 createImageBitmap —— file:// 下后者
      在部分 Chrome 版本里会因为跨源判定直接 reject，而 dataURL 的 <img>
      是稳的。不设 crossOrigin：dataURL 不需要，设了反而可能触发失败分支。 */
  function imageReady(id) {
    if (!id) return null;
    var c = IMG_CACHE[id];
    if (c && c.ok) return c.img;
    if (!c) withImage(id, function () {});
    return null;
  }

  function withImage(id, cb) {
    if (!id) { cb(null); return; }
    var c = IMG_CACHE[id];
    if (c && c.ok) { cb(c.img); return; }
    if (!c) c = IMG_CACHE[id] = { img: null, ok: false, started: false, failed: false, waiters: [] };
    if (typeof cb === 'function') c.waiters.push(cb);
    if (c.started || c.failed) return;

    c.started = true;
    var url = imgGet(id);
    if (!url) { c.failed = true; flush(null); return; }

    var img = new Image();
    c.img = img;
    img.onload = function () { c.ok = true; flush(img); };
    img.onerror = function () { c.failed = true; flush(null); };
    img.src = url;

    function flush(got) {
      var ws = c.waiters.slice();
      c.waiters.length = 0;
      for (var i = 0; i < ws.length; i++) {
        try { ws[i](got); } catch (e) { /* 单个回调抛错不该拖垮其余的 */ }
      }
      if (got && typeof L.onImageLoad === 'function') {
        try { L.onImageLoad(id); } catch (e2) { /* 面板已卸载 */ }
      }
    }
  }

  function scaledSize(w, h, maxSide) {
    var long = Math.max(w, h);
    if (!long || long <= maxSide) return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
    var s = maxSide / long;
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  function encodeAt(img, maxSide, type, q) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var d = scaledSize(iw, ih, maxSide);
    var cv = document.createElement('canvas');
    cv.width = d.w; cv.height = d.h;
    var ctx = cv.getContext('2d');
    /* JPEG 没有 alpha：不先铺白底的话透明区会被编码成黑色，
       用户传一张带透明边的 PNG 会得到一圈黑框，而且他不知道为什么。 */
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, d.w, d.h);
    }
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, d.w, d.h);
    return { url: cv.toDataURL(type, q), w: d.w, h: d.h };
  }

  /** 压进单张预算。返回 {ok,url,w,h,chars,ladder} 或 {ok:false,reason,smallest} */
  function compressFor(img, keepAlpha) {
    var sides = keepAlpha ? IMG_SIDE_PNG : IMG_SIDE_JPEG;
    var qs = keepAlpha ? [undefined] : IMG_Q_JPEG;
    var type = keepAlpha ? 'image/png' : 'image/jpeg';
    var smallest = 0, lastLadder = '';
    for (var i = 0; i < sides.length; i++) {
      for (var j = 0; j < qs.length; j++) {
        var out = encodeAt(img, sides[i], type, qs[j]);
        var chars = out.url.length;
        smallest = chars;
        lastLadder = sides[i] + 'px' + (qs[j] === undefined ? '' : (' q' + qs[j]));
        if (chars <= IMG_SINGLE_MAX) {
          return { ok: true, url: out.url, w: out.w, h: out.h, chars: chars, ladder: lastLadder };
        }
      }
    }
    return { ok: false, reason: 'single', smallest: smallest, ladder: lastLadder };
  }

  /** 读文件 → 解码 → 压缩 → 落键。回调式：整条链上全是异步 */
  function importImage(file, opts, done) {
    var keepAlpha = !!(opts && opts.keepAlpha);
    if (!file) { done({ ok: false, reason: 'empty' }); return; }
    if (root.FileReader && !/^image\//.test(String(file.type || ''))) {
      done({ ok: false, reason: 'type', type: String(file.type || '') });
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { done({ ok: false, reason: 'read' }); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { done({ ok: false, reason: 'decode' }); };
      img.onload = function () {
        var pack = compressFor(img, keepAlpha);
        if (!pack.ok) { done(pack); return; }
        var st = imageStats();
        if (st.chars + pack.chars > IMG_BUDGET) {
          done({ ok: false, reason: 'budget', chars: pack.chars, stats: st, ladder: pack.ladder });
          return;
        }
        var id = 'li-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        if (!lsSet(imgKey(id), pack.url)) {
          done({ ok: false, reason: 'write', chars: pack.chars, stats: st });
          return;
        }
        done({ ok: true, id: id, chars: pack.chars, w: pack.w, h: pack.h, ladder: pack.ladder });
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  }

  function kfmt(n) {
    n = num(n, 0);
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(1) + ' K';
    return (n / 1000000).toFixed(2) + ' M';
  }

  /* ======================================================================
   * A. 默认参数与颜色
   * ====================================================================*/

  function defaultFormat() {
    var f = 'square';
    try {
      if (store()) f = String(store().get('settings.labelFormat', 'square') || 'square');
    } catch (e) { f = 'square'; }
    return FORMATS[f] ? f : 'square';
  }

  /**
   * 解析 `#rrggbb` / `#rgb` / `rgb(...)` → [r,g,b]；认不出返回 null。
   * 必须同时认三种写法：只按"数字串"抠的话，`#f2b21e` 会被解析成 (2,2,1)，
   * 判成深色底 → 在亮金色标签上排白字，等于看不见。
   */
  function parseRGB(colorLike) {
    var str = String(colorLike || '').trim();
    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str);
    if (hex) {
      var h = hex[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
    }
    var m = str.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3) {
      var rgb = [num(m[0], 128), num(m[1], 128), num(m[2], 128)];
      return isFinite(rgb[0]) && isFinite(rgb[1]) && isFinite(rgb[2]) ? rgb : null;
    }
    return null;
  }

  /**
   * WCAG 相对亮度（0–1）。**不能**用 0.2126R+0.7152G+0.0722B 直接除以 255 代替——
   * 那只是感知亮度的粗略近似，拿它当"深底还是浅底"的分界（原先 >0.55）会选错墨色：
   *   SRM 10 的 #de7c00 粗亮度 0.53 → 判成深底配白字，实测 2.83:1；
   *   同一底色配深墨是 5.46:1。整段 10–14 号色都在这个错判区间里（琥珀/铜色，
   *   恰恰是最常见的酒体颜色）。所以决策走真亮度，不信近似值。
   */
  function relLuminance(rgb) {
    var f = function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }

  /** 两色的 WCAG 对比度（1–21）。参数接受 '#rrggbb' / 'rgb(...)' / [r,g,b]，认不出返 0 */
  function contrastRatio(a, b) {
    var x = Array.isArray(a) ? a : parseRGB(a);
    var y = Array.isArray(b) ? b : parseRGB(b);
    if (!x || !y) return 0;
    var l1 = relLuminance(x), l2 = relLuminance(y);
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** a → b 线性混合，t=0 取 a，t=1 取 b，返回 '#rrggbb' */
  function mixRGB(a, b, t) {
    var x = parseRGB(a) || [0, 0, 0];
    var y = parseRGB(b) || [0, 0, 0];
    var out = '#';
    for (var i = 0; i < 3; i++) {
      out += ('0' + Math.round(x[i] + (y[i] - x[i]) * t).toString(16)).slice(-2);
    }
    return out;
  }

  /* 两个品牌墨色 + 两个强调色。深墨不是纯黑、浅墨不是纯白：印刷上纯黑会死板、
     纯白会刺眼，所以用暖调。但当底色落在"深墨浅墨都不够"的中间带时，
     必须往纯黑/纯白升级才能达标 —— 这是印刷品，看不清就是废纸。 */
  var INK_DARK = '#241f18', INK_LIGHT = '#fbf8f1';
  var ACCENT_DARK = '#8a4b1f', ACCENT_LIGHT = '#e8a33d';
  var MIN_CONTRAST = 4.5;      /* WCAG AA 正文 */

  /**
   * 底色 → 可读的墨色。
   * ① 方向按**纯黑 / 纯白**判：用品牌墨判会偏 —— 品牌深墨 #241f18 自身亮度
   *    0.014，它和浅墨的交界在底色亮度 0.209，而黑白的交界在 0.179；
   *    按品牌墨判会在 0.179–0.209 这段选到浅墨，上限只有 4.05:1（不达标）。
   * ② 先试品牌墨；不够就往纯黑/纯白逐级升级，够 4.5 就停。
   */
  function pickInk(bg) {
    var goDark = contrastRatio(bg, '#000000') >= contrastRatio(bg, '#ffffff');
    var base = goDark ? INK_DARK : INK_LIGHT;
    var target = goDark ? '#000000' : '#ffffff';
    if (contrastRatio(bg, base) >= MIN_CONTRAST) return base;
    for (var t = 0.35; t <= 1.0001; t += 0.325) {
      var c = mixRGB(base, target, t);
      if (contrastRatio(bg, c) >= MIN_CONTRAST) return c;
    }
    return target;
  }

  /**
   * 底色 → 可读的强调色（风格副标题、分隔线用它）。
   * 强调色是"要好看"的那一层，所以先挑原色；不达标才往墨色靠，
   * 一轮轮加，够 4.5 就停 —— 尽量保住装饰性，但绝不留看不清的字。
   */
  function pickAccent(bg, fg) {
    var best = contrastRatio(bg, ACCENT_DARK) >= contrastRatio(bg, ACCENT_LIGHT) ? ACCENT_DARK : ACCENT_LIGHT;
    if (contrastRatio(bg, best) >= MIN_CONTRAST) return best;
    for (var t = 0.15; t <= 1.0001; t += 0.15) {
      var c = mixRGB(best, fg, t);
      if (contrastRatio(bg, c) >= MIN_CONTRAST) return c;
    }
    return fg;
  }

  /**
   * 半透明文字的替代：**先把透明度算进颜色**再画，别用 globalAlpha。
   * 原因：globalAlpha 让最终对比度不可预知 —— 0.66 的白字压在中琥珀底上，
   * 合成出来的对比度只有 1.9:1，屏幕上勉强能认出"风月酿研所"，
   * 印在纸上是灰雾。这里从给定 alpha 起往上抬，取第一个仍然 ≥4.5 的实色。
   */
  function readableBlend(bg, fg, alpha) {
    for (var t = alpha; t <= 1.0001; t += 0.05) {
      var c = mixRGB(bg, fg, t);
      if (contrastRatio(bg, c) >= MIN_CONTRAST) return c;
    }
    return fg;
  }

  /** 已保存的旧酒标可能带着不达标的墨色：只在明显看不清时才兜底纠正 */
  function safeInk(bg, ink) {
    if (contrastRatio(bg, ink) >= MIN_CONTRAST) return ink;
    return pickInk(bg);
  }

  function safeAccent(bg, accent, fg) {
    if (contrastRatio(bg, accent) >= MIN_CONTRAST) return accent;
    return pickAccent(bg, fg);
  }

  /**
   * 底色取「配方算出来的酒色」。
   * 优先用 calc.colorHex（计算内核给的成品色），**不用 UI.hexFromSrm**——
   * 那个函数当前会把数字当字符串拼接，返回 `rgb(NaN,NaN,387)` 这种非法色值。
   * 非法色值在 canvas 里被静默忽略，表现为"底色一片黑"，很难查。
   */
  function bgForCalc(c) {
    var direct = c && c.colorHex ? String(c.colorHex) : '';
    if (direct && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(direct)) return direct;
    if (direct && /^rgba?\(/.test(direct) && direct.indexOf('NaN') < 0) return direct;
    /* 兜底：按 SRM 粗略分档（只在 calc 没给出颜色时用） */
    var srm = num(c && c.srm, 8);
    if (srm <= 3) return '#f2d78a';
    if (srm <= 6) return '#e0a72c';
    if (srm <= 12) return '#c8862f';
    if (srm <= 20) return '#8a4b1f';
    if (srm <= 30) return '#4f2a12';
    return '#2b1608';
  }

  function defaultSpec(recipe, calc) {
    var r = recipe || {};
    var c = calc || {};
    var bg = bgForCalc(c);
    /* 浅色酒底配白字会看不见，所以按底色亮度选墨色——这一步不能省，
       SRM 3 的皮尔森和 SRM 35 的帝国世涛用的是同一套模板。 */
    var fg = pickInk(bg);
    return {
      format: defaultFormat(),
      style: {
        /* 底色跟着酒色走：这是唯一"不用解释就说得通"的默认值 */
        bg: bg,
        fg: fg,
        accent: pickAccent(bg, fg)
      },
      text: {
        title: r.name || '未命名配方',
        sub: styleLabel(r.styleId),
        line1: 'OG ' + (UI.sg ? UI.sg(c.og) : '—') + ' · ABV ' + fmt(c.abv, 1) + '% · IBU ' + fmt(c.ibu, 0),
        foot: '风月酿研所'
      },
      bg: {
        type: 'color', color: bg, imageId: '', fit: 'cover',
        offsetX: 0.5, offsetY: 0.5, zoom: 1,
        tint: { color: '#000000', alpha: 0 }
      },
      elements: []
    };
  }

  function styleLabel(styleId) {
    if (!styleId) return '';
    var st = null;
    try { st = UI.byId('styles', styleId); } catch (e) { st = null; }
    if (!st) return String(styleId);
    return (st.code ? st.code + ' · ' : '') + (st.name || styleId);
  }

  /* ======================================================================
   * B. 数据模型
   * ----------------------------------------------------------------------
   * 图片：bg = { type:'color'|'image', color, imageId, fit, offsetX, offsetY,
   *             zoom, tint:{color, alpha} }
   * 元素：{ id, kind:'text'|'rule', key, text, x, y, size, color, align,
   *         weight, italic, spacing, serif }
   *   x/y     0–1，**元素中心**在画布里的相对位置（中心锚点：拖动时手感最稳，
   *           换版式时也不会因为"左上角固定"而整体偏出去）
   *   size    占画布短边的比例（文字是字号，rule 是长度比例）
   *   serif   额外字段：模板里主标题是宋体、其余是无衬线，转自由布局必须保住
   *           这件事，否则标题立刻掉价。不给开关，跟着预设走。
   * ====================================================================*/

  /* 预设：把模板版式的四个文本框（+分割线）折算成相对坐标。
     数值是照着 drawTemplate 的 pad/字号/基线反推的，所以"转为自由布局"之后
     第一眼看上去和模板几乎一样——不这样的话用户会以为功能把排版弄坏了。 */
  var PRESET = [
    { key: 'sub', x: 0.5, y: 0.147, size: 0.026, weight: 600, serif: false, spacing: 0.10, accent: true },
    { key: 'title', x: 0.5, y: 0.385, size: 0.080, weight: 700, serif: true, spacing: 0.015 },
    { kind: 'rule', x: 0.5, y: 0.545, size: 0.22, accent: true },
    { key: 'line1', x: 0.5, y: 0.600, size: 0.028, weight: 400, serif: false, spacing: 0.02 },
    { key: 'foot', x: 0.5, y: 0.905, size: 0.022, weight: 400, serif: false, spacing: 0.06 }
  ];

  var elSeq = 0;
  function newElId() {
    elSeq++;
    return 'el-' + Date.now().toString(36) + '-' + elSeq + Math.random().toString(36).slice(2, 4);
  }

  function normEl(e, i) {
    if (!e || typeof e !== 'object') return null;
    var kind = e.kind === 'rule' ? 'rule' : 'text';
    var size = num(e.size, kind === 'rule' ? 0.22 : 0.05);
    if (!isFinite(size) || size <= 0) size = kind === 'rule' ? 0.22 : 0.05;
    var color = String(e.color || '');
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) color = '';
    return {
      id: e.id ? String(e.id) : ('el-' + Date.now().toString(36) + '-' + i + Math.random().toString(36).slice(2, 5)),
      kind: kind,
      key: e.key ? String(e.key) : '',
      text: e.text === undefined || e.text === null ? '' : String(e.text),
      x: clamp01(num(e.x, 0.5)),
      y: clamp01(num(e.y, 0.5)),
      size: clamp(size, 0.008, 1),
      color: color,
      align: (e.align === 'left' || e.align === 'right') ? e.align : 'center',
      weight: (e.weight === 400 || e.weight === 600) ? e.weight : 700,
      italic: !!e.italic,
      spacing: clamp(num(e.spacing, 0), 0, 0.3),
      serif: e.serif !== false
    };
  }

  function normBg(b, style) {
    var st = style || {};
    var src = (b && typeof b === 'object') ? b : null;
    var color = src && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(src.color || ''))
      ? String(src.color) : (st.bg || '#8a4b1f');
    var tint = (src && src.tint) || {};
    return {
      type: src && src.type === 'image' ? 'image' : 'color',
      color: color,
      imageId: src && src.imageId ? String(src.imageId) : '',
      fit: (src && (src.fit === 'fill' || src.fit === 'contain')) ? src.fit : 'cover',
      offsetX: clamp01(num(src && src.offsetX, 0.5)),
      offsetY: clamp01(num(src && src.offsetY, 0.5)),
      zoom: clamp(num(src && src.zoom, 1), 1, 3),
      tint: {
        color: (tint.color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(tint.color))) ? String(tint.color) : '#000000',
        alpha: clamp01(num(tint.alpha, 0))
      }
    };
  }

  /**
   * 把任意来源（存档、草稿、默认值）捏成唯一形状。
   * 两条不变量：
   *   ① style.bg 永远等于 bg.color —— "底色"只有一个真相，老渲染路径、
   *      老存档、新面板读到的必须是同一个数，否则会出现"面板显示红、
   *      印出来是褐"这种没人查得出来的错位。
   *   ② 有 elements 时，四段老文案回填到 text.* —— 标签名、旧字段都靠它。
   */
  function normSpec(s) {
    var src = s || {};
    var style = {
      bg: (src.style && src.style.bg) || '#8a4b1f',
      fg: (src.style && src.style.fg) || '#fbf8f1',
      accent: (src.style && src.style.accent) || '#e8a33d'
    };
    var text = {
      title: (src.text && src.text.title) || '',
      sub: (src.text && src.text.sub) || '',
      line1: (src.text && src.text.line1) || '',
      foot: (src.text && src.text.foot) || ''
    };
    var bg = normBg(src.bg, style);
    style.bg = bg.color;

    var els = [];
    if (Array.isArray(src.elements)) {
      for (var i = 0; i < src.elements.length; i++) {
        var el = normEl(src.elements[i], i);
        if (el) els.push(el);
      }
    }
    for (var j = 0; j < els.length; j++) {
      if (els[j].kind === 'text' && els[j].key && has(text, els[j].key) && els[j].text) {
        text[els[j].key] = els[j].text;
      }
    }

    return {
      format: FORMATS[src.format] ? src.format : 'square',
      style: style,
      text: text,
      bg: bg,
      elements: els
    };
  }

  function cloneSpec(src) { return normSpec(src); }

  function isFree(spec) {
    return !!(spec && Array.isArray(spec.elements) && spec.elements.length);
  }

  /* 模板 → 自由布局的第一次物化 */
  function freeFromTemplate(sp) {
    var out = [];
    for (var i = 0; i < PRESET.length; i++) {
      var p = PRESET[i];
      out.push({
        id: newElId(),
        kind: p.kind || 'text',
        key: p.key || '',
        text: p.key ? String((sp.text && sp.text[p.key]) || '') : '',
        x: p.x, y: p.y, size: p.size,
        color: p.accent ? (sp.style.accent || '#e8a33d') : '',
        align: 'center',
        weight: p.weight || 400,
        italic: false,
        spacing: p.spacing || 0,
        serif: !!p.serif
      });
    }
    return out;
  }

  /** 「重新适配版式」：把已知的四段文案 + 分隔线摆回预设位置。自定义块保持不动。
      ⚠️ 只在用户点按钮时调用。切版式时**不**自动重排坐标 —— 相对坐标本来就会
      跟着画布走，偷偷改用户拖好的位置比错位更让人恼火。 */
  function refitElements(sp) {
    var els = sp.elements || [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      for (var j = 0; j < PRESET.length; j++) {
        var p = PRESET[j];
        if ((p.key && p.key === el.key) || (p.kind === 'rule' && el.kind === 'rule' && !el.key)) {
          el.x = p.x; el.y = p.y; el.size = p.size;
          break;
        }
      }
    }
  }

  /* ======================================================================
   * C. 绘制
   * ====================================================================*/

  /** 按宽度折行（逐字测量，中文不需要按空格断词） */
  function wrap(ctx, text, maxWidth, maxLines) {
    var str = String(text || '');
    var lines = [];
    var cur = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var test = cur + ch;
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, maxLines || 4);
  }

  function setFont(ctx, px, el) {
    ctx.font = (el.italic ? 'italic ' : '') + (el.weight || 400) + ' ' + px + 'px ' +
      (el.serif ? SERIF : SANS);
    /* letterSpacing 是较新的 canvas 属性（Chrome 99+）。不支持时字距静默失效，
       但不影响字号/位置 —— 宁可少一个排版细节，也不为它去手写逐字推进
       （那会让 wrap() 的测量和绘制两套逻辑，迟早不一致）。 */
    if ('letterSpacing' in ctx) {
      try { ctx.letterSpacing = (px * num(el.spacing, 0)).toFixed(2) + 'px'; } catch (e) { /* 忽略 */ }
    }
  }

  /** 量一个元素占的矩形（画布像素）。绘制与命中测试**必须**共用它，
      否则会出现"看着在框里、点不到"这种最难查的错。 */
  function measureEl(ctx, W, H, el) {
    var short = Math.min(W, H);
    if (el.kind === 'rule') {
      var len = clamp(el.size, 0.05, 1) * W;
      var th = Math.max(10, Math.round(short * 0.012));
      return { px: 0, lines: [], lineH: 0, boxW: len, boxH: th, left: el.x * W - len / 2, top: el.y * H - th / 2 };
    }
    var px = Math.max(6, Math.round(short * clamp(el.size, 0.008, 0.6)));
    setFont(ctx, px, el);
    var lines = wrap(ctx, el.text || '', W * 0.92, 6);
    var boxW = 0, i, mw;
    for (i = 0; i < lines.length; i++) {
      mw = ctx.measureText(lines[i]).width;
      if (mw > boxW) boxW = mw;
    }
    if (!lines.length) boxW = Math.max(px * 0.6, 8);
    var lineH = Math.round(px * 1.22);
    var boxH = Math.max(lineH, lines.length * lineH);
    return {
      px: px, lines: lines, lineH: lineH, boxW: boxW, boxH: boxH,
      left: el.x * W - boxW / 2, top: el.y * H - boxH / 2
    };
  }

  var _measureCv = null;
  function measureCtx() {
    if (!_measureCv) {
      _measureCv = document.createElement('canvas');
      _measureCv.width = 8; _measureCv.height = 8;
    }
    return _measureCv.getContext('2d');
  }

  function layoutBoxes(spec) {
    var f = FORMATS[spec.format] || FORMATS.square;
    var ctx = measureCtx();
    var out = [], els = spec.elements || [];
    for (var i = 0; i < els.length; i++) {
      out.push({ id: els[i].id, el: els[i], m: measureEl(ctx, f.w, f.h, els[i]) });
    }
    return out;
  }

  /** 背景图按 cover/fill/contain + 偏移 + 缩放画上去，再叠一层 tint。
      偏移的口径统一成 `dx = (W - dw) * offsetX`：
        offsetX=0.5 → 居中；0 → 贴左；1 → 贴右。
      cover 时 dw>W，所以 0 和 1 正好把两侧的裁切分别露出来，拖动方向直觉一致。 */
  function drawImageBg(ctx, W, H, b, img) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return false;
    var z = clamp(num(b.zoom, 1), 1, 3);
    var dw, dh;
    if (b.fit === 'fill') {
      dw = W * z; dh = H * z;
    } else {
      var s = b.fit === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
      dw = iw * s * z; dh = ih * s * z;
    }
    var dx = (W - dw) * clamp01(num(b.offsetX, 0.5));
    var dy = (H - dh) * clamp01(num(b.offsetY, 0.5));

    /* 先铺底色：contain 会留边，fill/cover 也有取整误差的缝。
       留边如果是透明的，导出的 PNG 在印刷软件里会变成白/黑不定色。 */
    ctx.fillStyle = b.color || '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, dx, dy, dw, dh);

    if (b.tint && b.tint.alpha > 0) {
      var rgb = parseRGB(b.tint.color) || [0, 0, 0];
      /* 用 rgba 而不是 globalAlpha：globalAlpha 会漏到后面的文字绘制上，
         而"半透明文字落在纸上就是一层灰雾"是 test-wave2 盯着的老问题。 */
      ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' +
        clamp01(b.tint.alpha).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    return true;
  }

  function drawElements(ctx, W, H, spec, fallback) {
    var els = spec.elements || [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el) continue;
      var m = measureEl(ctx, W, H, el);
      if (el.kind === 'rule') {
        ctx.strokeStyle = el.color || fallback;
        ctx.lineWidth = Math.max(2, Math.round(Math.min(W, H) * 0.004));
        ctx.beginPath();
        ctx.moveTo(m.left, el.y * H);
        ctx.lineTo(m.left + m.boxW, el.y * H);
        ctx.stroke();
        continue;
      }
      setFont(ctx, m.px, el);
      ctx.fillStyle = el.color || fallback;
      ctx.textAlign = el.align === 'left' ? 'left' : (el.align === 'right' ? 'right' : 'center');
      var tx = el.align === 'left' ? m.left
        : (el.align === 'right' ? m.left + m.boxW : m.left + m.boxW / 2);
      for (var k = 0; k < m.lines.length; k++) {
        ctx.fillText(m.lines[k], tx, m.top + m.px * 0.78 + k * m.lineH);
      }
    }
    ctx.textAlign = 'center';
    if ('letterSpacing' in ctx) {
      try { ctx.letterSpacing = '0px'; } catch (e) { /* 忽略 */ }
    }
  }

  /** v1.2 的模板排版，逐字保留。**这段是回归基线，不要为了"统一"重写它**：
      test-wave2 §8 量三种版式的出图尺寸、§8b 量全色域的每一行文字对比度，
      两处都是拿这份几何当基准的。想加东西请加在 drawElements，别动这里。 */
  function drawTemplate(ctx, W, H, spec, bg, fg, accent, overImage) {
    /* 内描边：纸质标签总有一条压印边 */
    var pad = Math.round(Math.min(W, H) * 0.065);
    ctx.strokeStyle = 'rgba(255,255,255,.42)';
    ctx.lineWidth = Math.max(2, Math.round(Math.min(W, H) * 0.004));
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

    var cx = W / 2;
    var innerW = W - pad * 4;

    /* 顶部小字：风格 */
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = '600 ' + Math.round(W * 0.026) + 'px ' + SANS;
    if (spec.text.sub) {
      ctx.fillText(String(spec.text.sub).toUpperCase(), cx, pad + Math.round(H * 0.075));
    }

    /* 主标题：宋体，最多 3 行，字号按版式比例给 */
    var titleSize = Math.round(W * (spec.format === 'a6' ? 0.075 : 0.082));
    ctx.font = '700 ' + titleSize + 'px ' + SERIF;
    ctx.fillStyle = fg;
    var lines = wrap(ctx, spec.text.title, innerW, 3);
    var lineH = Math.round(titleSize * 1.22);
    var startY = Math.round(H * (spec.format === 'a6' ? 0.30 : 0.34));
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx, startY + i * lineH);
    }

    /* 分隔线：短横，居中 */
    var ruleY = startY + lines.length * lineH + Math.round(H * 0.035);
    var ruleW = Math.round(innerW * 0.22);
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, Math.round(W * 0.004));
    ctx.beginPath();
    ctx.moveTo(cx - ruleW / 2, ruleY);
    ctx.lineTo(cx + ruleW / 2, ruleY);
    ctx.stroke();

    /* 技术参数一行 */
    if (spec.text.line1) {
      ctx.font = '400 ' + Math.round(W * 0.028) + 'px ' + SANS;
      /* 不用 globalAlpha：透明度会把对比度拖到不可预知（0.92 还勉强，
         0.66 的小字印出来是灰雾）。用预先混好的实色，见到多少就是印出多少。
         图底上算不出对比度，就直接用实色 —— 宁可重一点，也不给灰雾。 */
      ctx.fillStyle = overImage ? fg : readableBlend(bg, fg, 0.92);
      ctx.fillText(String(spec.text.line1), cx, ruleY + Math.round(H * 0.065));
    }

    /* 底部小字 */
    if (spec.text.foot) {
      ctx.font = '400 ' + Math.round(W * 0.022) + 'px ' + SANS;
      ctx.fillStyle = overImage ? fg : readableBlend(bg, fg, 0.66);
      ctx.fillText(String(spec.text.foot), cx, H - pad - Math.round(H * 0.035));
    }
  }

  /** 在给定画布上按 spec 画一张酒标。preview 与导出走同一个函数，所见即所得 */
  function draw(canvas, spec) {
    if (!canvas || !canvas.getContext) return;
    var sp = spec || {};
    var f = FORMATS[sp.format] || FORMATS.square;
    var W = f.w, H = f.h;

    /* 只在尺寸真的变了才重设 width：给 canvas.width 赋值会重新分配整块
       backing store（1181²×4 ≈ 5.6 MB），拖动时每帧都做一次会掉帧。 */
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    } else {
      canvas.getContext('2d').clearRect(0, 0, W, H);
    }

    var ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    if ('letterSpacing' in ctx) {
      try { ctx.letterSpacing = '0px'; } catch (e) { /* 忽略 */ }
    }

    var b = normBg(sp.bg, sp.style);
    var isImage = b.type === 'image';
    var bg = b.color;
    var img = isImage ? imageReady(b.imageId) : null;

    /* 旧存档可能带着不达标的配色（老版本按粗亮度选出来的白字压中琥珀，
       SRM 10 上只有 2.83:1）。渲染时兜底纠正，**不回写 store** ——
       spec.style.* 是用户的东西，我们不偷改；但也不把看不清的东西印出去。
       ⚠️ 图底上没有"底色"可算对比度，所以这一层纠正只对纯色底成立；
       图底的文字颜色由用户在面板里自己定（他看得到预览）。 */
    var rawFg = (sp.style && sp.style.fg) || '#fbf8f1';
    var rawAccent = (sp.style && sp.style.accent) || '#e8a33d';
    var fg = isImage ? rawFg : safeInk(bg, rawFg);
    var accent = isImage ? rawAccent : safeAccent(bg, rawAccent, fg);

    /* 圆标：整块裁成圆，圆外保持透明（PNG 的 alpha 就是这么用的）。
       注意：个别印刷软件会把透明当白底显示，那是预览差异，不是导出错误。 */
    var round = sp.format === 'round';
    if (round) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    }

    var painted = false;
    if (isImage && img) painted = drawImageBg(ctx, W, H, b, img);
    if (!painted) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    }
    if (isImage && !img && b.imageId) {
      /* 首帧图还没解码完：先铺底色，加载完由 onImageLoad 触发重绘。
         这比"卡住不画"好 —— 用户能看到面板在动，而不是以为界面死了。 */
      withImage(b.imageId, function () {});
    }

    if (isFree(sp)) {
      drawElements(ctx, W, H, sp, fg);
    } else {
      drawTemplate(ctx, W, H, sp, bg, fg, accent, isImage);
    }

    if (round) ctx.restore();
  }

  /* ======================================================================
   * D. 面板
   * ====================================================================*/

  function mount(box, opts) {
    if (!box) return;
    var option = opts || {};
    var recipe = option.recipe || UI.recipe() || {};
    var calc = option.calc || (function () { try { return UI.calc(recipe); } catch (e) { return {}; } })();

    var list = labelsOf(recipe.id);
    /* 优先接上次的草稿（同一份配方 + 同一个页签会话），没有才回落到
       "最近保存的一张"或默认值。不能每次 mount 都重取 list[0]：
       那正是"切走再切回来，刚选的 a6 变回 square"的原因（⑧）。 */
    if (draft.recipeId !== recipe.id || !draft.spec) {
      draft.recipeId = recipe.id;
      draft.spec = list.length ? cloneSpec(list[0]) : defaultSpec(recipe, calc);
      draft.editingId = list.length ? list[0].id : '';
    }

    var cur = normSpec(draft.spec);
    var editingId = draft.editingId;
    var activeId = '';                    /* 画布上选中的元素 */
    var undoStack = [], redoStack = [];
    var undoTag = '', undoAt = 0;
    var alive = true;

    box.innerHTML =
      '<div class="lbl-layout lbl-layout--v2">' +
        '<div class="lbl-preview card">' +
          '<div class="card__head"><h2>预览</h2><span class="spacer"></span>' +
            '<span class="u-xs u-dim" id="lbl-dims"></span></div>' +
          '<div class="card__body lbl-stagewrap">' +
            '<div class="lbl-stagebar">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-lbl="undo" id="lbl-undo">撤销</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-lbl="redo" id="lbl-redo">重做</button>' +
              '<span class="lbl-stagebar__hint u-xs u-dim" id="lbl-tip"></span>' +
            '</div>' +
            '<div class="lbl-stage" id="lbl-stage">' +
              '<div class="lbl-canvas-wrap" id="lbl-canvas-wrap">' +
                '<canvas id="lbl-canvas" class="lbl-canvas" role="img" aria-label="酒标预览" ' +
                  'tabindex="0"></canvas>' +
                '<div class="lbl-overlay" id="lbl-overlay"></div>' +
                '<div class="lbl-guide lbl-guide--v" id="lbl-guide-v"></div>' +
                '<div class="lbl-guide lbl-guide--h" id="lbl-guide-h"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="resizer resizer--x lbl-resizer" id="lbl-resizer" ' +
          'aria-label="调整酒标侧栏宽度"></div>' +
        '<div class="lbl-controls card lbl-side" id="lbl-side">' +
          '<div class="card__head"><h2>酒标</h2><span class="spacer"></span>' +
            '<span class="u-xs u-dim">每配方最多 ' + MAX_PER_RECIPE + ' 张</span></div>' +
          '<div class="card__body lbl-side__body">' +
            '<div class="field">' +
              '<label class="field__label" for="lbl-format">版式</label>' +
              '<select class="select" id="lbl-format">' + formatOptions(cur.format) + '</select>' +
              '<span class="field__hint" id="lbl-size-hint"></span>' +
            '</div>' +

            '<div class="lbl-sec">' +
              '<div class="lbl-sec__head"><span>文字</span><span class="spacer"></span>' +
                '<span class="u-xs u-dim" id="lbl-mode-tag"></span></div>' +

              '<div id="lbl-tpl">' +
                '<div class="field">' +
                  '<label class="field__label" for="lbl-title">主标题</label>' +
                  '<input class="input" id="lbl-title" type="text" maxlength="40">' +
                '</div>' +
                '<div class="field">' +
                  '<label class="field__label" for="lbl-sub">副标题（风格）</label>' +
                  '<input class="input" id="lbl-sub" type="text" maxlength="40">' +
                '</div>' +
                '<div class="field">' +
                  '<label class="field__label" for="lbl-line1">参数行</label>' +
                  '<input class="input" id="lbl-line1" type="text" maxlength="48">' +
                '</div>' +
                '<div class="field">' +
                  '<label class="field__label" for="lbl-foot">底部署名</label>' +
                  '<input class="input" id="lbl-foot" type="text" maxlength="30">' +
                '</div>' +
                '<p class="u-xs u-dim mt-8">模板版式：位置与字号由版式算，四段文案可改。' +
                '要自己摆位置、改字号就转成自由布局——老标不会被自动改。</p>' +
                '<button type="button" class="btn btn-ghost btn-sm mt-8" data-lbl="free">' +
                  icon('layers', 13) + '转为自由布局（可拖动）</button>' +
              '</div>' +

              '<div id="lbl-free" hidden>' +
                '<div class="lbl-layers" id="lbl-layers"></div>' +
                '<div class="lbl-elctl" id="lbl-elctl">' +
                  '<div class="field" id="lbl-el-textwrap">' +
                    '<label class="field__label" for="lbl-el-text">文案</label>' +
                    '<input class="input" id="lbl-el-text" type="text" maxlength="48">' +
                  '</div>' +
                  '<div class="field">' +
                    '<label class="field__label" for="lbl-el-size">' +
                      '<span id="lbl-el-size-label">字号</span>' +
                      '<span class="lbl-val" id="lbl-el-size-val"></span></label>' +
                    '<input class="lbl-range" type="range" id="lbl-el-size" min="0.5" max="20" step="0.1">' +
                  '</div>' +
                  '<div class="field">' +
                    '<label class="field__label" for="lbl-el-color">颜色</label>' +
                    '<div class="lbl-color">' +
                      '<input type="color" id="lbl-el-color" class="lbl-color__pick">' +
                      '<input class="input lbl-color__hex" id="lbl-el-hex" type="text" maxlength="7" ' +
                        'spellcheck="false" aria-label="颜色十六进制值">' +
                    '</div>' +
                    '<div class="lbl-swrow" data-target="el"></div>' +
                  '</div>' +
                  '<div class="row row--tight">' +
                    '<select class="select select--sm" id="lbl-el-align" aria-label="对齐">' +
                      '<option value="left">左对齐</option>' +
                      '<option value="center">居中</option>' +
                      '<option value="right">右对齐</option>' +
                    '</select>' +
                    '<select class="select select--sm" id="lbl-el-weight" aria-label="字重">' +
                      '<option value="400">常规</option>' +
                      '<option value="600">半粗</option>' +
                      '<option value="700">粗体</option>' +
                    '</select>' +
                    '<label class="lbl-check"><input type="checkbox" id="lbl-el-italic">斜体</label>' +
                  '</div>' +
                  '<div class="field">' +
                    '<label class="field__label" for="lbl-el-spacing">' +
                      '字距<span class="lbl-val" id="lbl-el-spacing-val"></span></label>' +
                    '<input class="lbl-range" type="range" id="lbl-el-spacing" min="0" max="0.3" step="0.01">' +
                  '</div>' +
                  '<div class="row row--tight mt-8">' +
                    '<button type="button" class="btn btn-ghost btn-sm" data-lbl="add-text">' +
                      icon('plus', 12) + '文字</button>' +
                    '<button type="button" class="btn btn-ghost btn-sm" data-lbl="add-rule">' +
                      icon('plus', 12) + '线条</button>' +
                    '<button type="button" class="btn btn-ghost btn-sm" data-lbl="del-el">' +
                      icon('trash', 12) + '删除</button>' +
                  '</div>' +
                  '<div class="row row--tight mt-8">' +
                    '<button type="button" class="btn btn-ghost btn-sm" data-lbl="fit-fmt">' +
                      '重新适配版式</button>' +
                    '<button type="button" class="btn btn-ghost btn-sm" data-lbl="back-tpl">' +
                      '还原模板</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<div class="lbl-sec">' +
              '<div class="lbl-sec__head"><span>背景</span></div>' +
              '<div class="lbl-seg" role="group" aria-label="背景类型">' +
                '<button type="button" data-lbl="bg-color" id="lbl-seg-color">纯色</button>' +
                '<button type="button" data-lbl="bg-image" id="lbl-seg-image">图片</button>' +
              '</div>' +
              '<div class="field mt-8">' +
                '<label class="field__label" for="lbl-bg-color">底色</label>' +
                '<div class="lbl-color">' +
                  '<input type="color" id="lbl-bg-color" class="lbl-color__pick">' +
                  '<input class="input lbl-color__hex" id="lbl-bg-hex" type="text" maxlength="7" ' +
                    'spellcheck="false" aria-label="底色十六进制值">' +
                '</div>' +
                '<div class="lbl-swrow" data-target="bg"></div>' +
              '</div>' +
              '<div id="lbl-bgi">' +
                '<input type="file" id="lbl-file" accept="image/*" class="lbl-file">' +
                '<div class="row row--tight mt-8">' +
                  '<button type="button" class="btn btn-ghost btn-sm" data-lbl="pick">' +
                    icon('drop', 13) + '选择图片…</button>' +
                  '<button type="button" class="btn btn-ghost btn-sm" data-lbl="img-del">移除图片</button>' +
                '</div>' +
                '<label class="lbl-check mt-8"><input type="checkbox" id="lbl-keep-alpha">' +
                  '保留透明（PNG，长边压到 700px）</label>' +
                '<div class="field mt-8">' +
                  '<label class="field__label" for="lbl-fit">填充方式</label>' +
                  '<select class="select" id="lbl-fit">' +
                    '<option value="cover">铺满 · 保比例裁切（可拖位置）</option>' +
                    '<option value="fill">拉伸 · 铺满整块（会变形）</option>' +
                    '<option value="contain">完整放下 · 留边</option>' +
                  '</select>' +
                  '<span class="field__hint" id="lbl-fit-hint"></span>' +
                '</div>' +
                '<div class="field">' +
                  '<label class="field__label" for="lbl-zoom">' +
                    '缩放<span class="lbl-val" id="lbl-zoom-val"></span></label>' +
                  '<input class="lbl-range" type="range" id="lbl-zoom" min="1" max="3" step="0.02">' +
                '</div>' +
                '<div class="field">' +
                  '<label class="field__label" for="lbl-ox">水平位置</label>' +
                  '<input class="lbl-range" type="range" id="lbl-ox" min="0" max="1" step="0.005">' +
                '</div>' +
                '<div class="field">' +
                  '<label class="field__label" for="lbl-oy">垂直位置</label>' +
                  '<input class="lbl-range" type="range" id="lbl-oy" min="0" max="1" step="0.005">' +
                '</div>' +
                '<div class="field">' +
                  '<label class="field__label" for="lbl-tint">' +
                    '叠色<span class="lbl-val" id="lbl-tint-val"></span></label>' +
                  '<div class="lbl-color">' +
                    '<input type="color" id="lbl-tint" class="lbl-color__pick">' +
                    '<input class="input lbl-color__hex" id="lbl-tint-hex" type="text" maxlength="7" ' +
                      'spellcheck="false" aria-label="叠色十六进制值">' +
                  '</div>' +
                  '<input class="lbl-range mt-8" type="range" id="lbl-tint-alpha" min="0" max="100" step="1">' +
                  '<span class="field__hint">叠色压在图上面压字下面：压暗图片、统一色调、救回看不清的字</span>' +
                '</div>' +
              '</div>' +
              '<div class="lbl-budget" id="lbl-budget"></div>' +
              '<div class="lbl-imgmsg" id="lbl-img-msg" hidden></div>' +
            '</div>' +

            '<div class="row mt-12">' +
              '<button type="button" class="btn btn-primary btn-sm" data-lbl="save">' +
                icon('save', 13) + '保存这张</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-lbl="new">' +
                icon('plus', 13) + '新建一张</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-lbl="export">' +
                icon('down', 13) + '导出 PNG</button>' +
            '</div>' +
            '<p class="u-xs u-dim mt-8" id="lbl-mode"></p>' +
            /* 字体预览：本机缺宋体时排版会和设计稿不同（但不会崩），
               让人先看到实际字形，比事后解释便宜 */
            '<div class="lbl-fontnote">' +
              '<span class="u-xs u-dim">字体预览</span>' +
              '<div class="lbl-fontnote__sample">酿研所 · 精酿啤酒</div>' +
              '<div class="u-xs u-dim">宋体族（Songti SC / SimSun / Noto Serif CJK）；' +
              '导出是 PNG，字形已栅格化，换机器不会变</div>' +
            '</div>' +
          '</div>' +
          '<div class="card__hint" id="lbl-list"></div>' +
        '</div>' +
      '</div>';

    var canvas = box.querySelector('#lbl-canvas');
    var stage = box.querySelector('#lbl-stage');
    var wrap = box.querySelector('#lbl-canvas-wrap');
    var overlay = box.querySelector('#lbl-overlay');
    var guideV = box.querySelector('#lbl-guide-v');
    var guideH = box.querySelector('#lbl-guide-h');
    var side = box.querySelector('#lbl-side');

    L.onImageLoad = function () { if (alive) paint(); };

    /* ---------------- 侧栏调宽 ----------------
       组件在 39b，四条行为（拖 / 双击复位 / 方向键 / 记忆）都由它统一给。
       这里只管三件只有酒标知道的事：上下限（200–420：再窄放不下两个色块，
       再宽预览就没了）、默认 260、以及"拖完要重新量画布"。
       dir:-1 —— 手柄在侧栏的**左边**，往左拖是变宽。 */
    var resizer = null;
    if (UI.Resizer && typeof UI.Resizer.attach === 'function') {
      try {
        if (typeof UI.Resizer.installGlobalStyle === 'function') UI.Resizer.installGlobalStyle();
        resizer = UI.Resizer.attach({
          handle: box.querySelector('#lbl-resizer'),
          target: side,
          axis: 'x',
          dir: -1,
          min: 200, max: 420, def: 260,
          key: 'labelPanel',
          label: '调整酒标侧栏宽度',
          onResize: function () { fitCanvas(); }
        });
      } catch (e) { resizer = null; }
    }

    /* ---------------- 基础状态 ---------------- */

    function fmtDef() { return FORMATS[cur.format] || FORMATS.square; }

    function els() { return cur.elements || []; }

    function elById(id) {
      var a = els();
      for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
      return null;
    }

    function elByKey(key) {
      var a = els();
      for (var i = 0; i < a.length; i++) if (a[i].kind === 'text' && a[i].key === key) return a[i];
      return null;
    }

    function activeEl() { return activeId ? elById(activeId) : null; }

    /* ---------------- 撤销 ---------------- */

    function snapshot() { return JSON.stringify(cur); }

    function pushUndo() {
      var s = snapshot();
      if (undoStack.length && undoStack[undoStack.length - 1] === s) return false;
      undoStack.push(s);
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      redoStack.length = 0;
      return true;
    }

    /* 连续输入（打字、拖色盘、拖滑杆）合并成一步：否则敲 20 个字要按 20 次撤销，
       "撤销"就成了摆设。同一个 tag 900ms 内只记一次起点。 */
    function pushUndoTagged(tag) {
      var now = Date.now();
      if (tag && tag === undoTag && now - undoAt < 900) { undoAt = now; return; }
      undoTag = tag || '';
      undoAt = now;
      pushUndo();
    }

    function applySnapshot(str) {
      cur = normSpec(JSON.parse(str));
      if (activeId && !elById(activeId)) activeId = els().length ? els()[0].id : '';
      draft.spec = normSpec(cur);
      renderAll();
    }

    function undo() {
      if (!undoStack.length) { toast('没有可撤销的操作了', 'info', 1600); return; }
      redoStack.push(snapshot());
      applySnapshot(undoStack.pop());
    }

    function redo() {
      if (!redoStack.length) return;
      undoStack.push(snapshot());
      applySnapshot(redoStack.pop());
    }

    /* ---------------- 变更入口 ---------------- */
    /* 所有改 cur 的地方都从这里走：这样"重画 / 同步草稿 / 刷新面板"三件事
       不可能漏掉一件。light=1 是拖动中的高频路径，跳过读 store 的活。 */
    function afterChange(light) {
      draft.spec = normSpec(cur);
      draft.editingId = editingId;
      paint();
      if (!light) {
        updateMode();
        updateImgUI();
        updateBudget();
        renderLayers();
        /* 必须同步元素编辑器：滚轮/拖手柄改的是 el.size，而"字号 136 px"
           这行字只有 syncElCtl 会写 —— 少了它，画布在变、面板上的数字不动，
           用户会以为滚轮没生效，然后一直滚下去。 */
        syncElCtl();
      }
    }

    function applySpec(sp) {
      cur = normSpec(sp);
      undoStack.length = 0; redoStack.length = 0;
      undoTag = ''; undoAt = 0;
      activeId = els().length ? els()[0].id : '';
      draft.spec = normSpec(cur);
      draft.editingId = editingId;
      renderAll();
    }

    /* ---------------- 画布尺寸 ---------------- */
    /* 画布内部是 300dpi 真实像素（1181 等），屏幕上必须缩到容器里。
       用 JS 算而不是纯 CSS，是因为覆盖层（选中框、手柄）要叠在**同一块矩形**上：
       两个元素各自算尺寸，迟早差 1px，手柄就会浮在框外。 */
    function fitCanvas() {
      if (!stage || !wrap) return;
      var f = fmtDef();
      var avail = stage.clientWidth - 32;     /* .lbl-stage 左右各 16px 内边距 */
      if (!avail || avail < 120) avail = 420; /* 页签还没显示时量不到宽度 */
      /* 高度上限 560px（= 打印时的 148.2mm 基准），但还要**看得下**：
         酒标一半在窗口外的话，用户拖着拖着就把元素拖到屏幕外面去了。
         用 stage 的顶边位置反推剩余高度 —— 它不依赖 wrap 自身的高度
         （wrap 只会往下长），所以不存在循环依赖。 */
      var top = 0;
      try { top = stage.getBoundingClientRect().top; } catch (e) { top = 0; }
      var room = (root.innerHeight || 900) - top - 52;
      var maxH = Math.max(260, Math.min(560, room));
      var s = Math.min(avail / f.w, maxH / f.h, 1);
      if (!(s > 0) || !isFinite(s)) s = 1;
      wrap.style.width = Math.max(80, Math.round(f.w * s)) + 'px';
      wrap.style.height = Math.max(80, Math.round(f.h * s)) + 'px';
    }

    /* ---------------- 画 ---------------- */

    function paint() {
      if (!alive) return;
      fitCanvas();
      draw(canvas, cur);
      var f = fmtDef();
      var hint = box.querySelector('#lbl-size-hint');
      if (hint) hint.textContent = f.zh + ' · 出图 ' + f.w + '×' + f.h + 'px（300dpi）';
      var dims = box.querySelector('#lbl-dims');
      if (dims) {
        dims.textContent = f.w + '×' + f.h + (isFree(cur) ? ' · 自由布局' : ' · 模板版式');
      }
      var tag = box.querySelector('#lbl-mode-tag');
      if (tag) tag.textContent = isFree(cur) ? '自由布局' : '模板版式';
      var und = box.querySelector('#lbl-undo');
      if (und) und.disabled = !undoStack.length;
      var red = box.querySelector('#lbl-redo');
      if (red) red.disabled = !redoStack.length;
      var tip = box.querySelector('#lbl-tip');
      if (tip) {
        tip.textContent = isFree(cur)
          ? '点选文字后拖动位置 · 拖四角改字号 · 滚轮微调 · 方向键 1px（Shift 10px）· Delete 删除'
          : '模板版式不能拖。点右侧「转为自由布局」后可自由摆放。';
      }
      renderOverlay();
    }

    /* ---------------- 覆盖层（选中框 + 手柄 + 参考线） ---------------- */

    function renderOverlay() {
      if (!overlay) return;
      var el = activeEl();
      if (!el) { overlay.innerHTML = ''; return; }
      var f = fmtDef();
      var m = measureEl(measureCtx(), f.w, f.h, el);
      /* 用百分比定位：画布一缩放，选中框/手柄自动跟着走，不需要再算一遍 */
      var l = clamp(m.left / f.w * 100, 0, 100);
      var t = clamp(m.top / f.h * 100, 0, 100);
      var w = clamp(m.boxW / f.w * 100, 0, 100 - l);
      var h = clamp(m.boxH / f.h * 100, 0, 100 - t);
      overlay.innerHTML =
        '<div class="lbl-sel' + (el.kind === 'rule' ? ' lbl-sel--rule' : '') + '" data-el="' + attr(el.id) + '" ' +
          'style="left:' + l.toFixed(3) + '%;top:' + t.toFixed(3) + '%;' +
          'width:' + w.toFixed(3) + '%;height:' + h.toFixed(3) + '%">' +
          '<span class="lbl-h lbl-h--nw" data-handle="nw"></span>' +
          '<span class="lbl-h lbl-h--ne" data-handle="ne"></span>' +
          '<span class="lbl-h lbl-h--sw" data-handle="sw"></span>' +
          '<span class="lbl-h lbl-h--se" data-handle="se"></span>' +
        '</div>';
    }

    function showGuide(which, on) {
      var g = which === 'v' ? guideV : guideH;
      if (g) g.classList.toggle('is-on', !!on);
    }

    function hideGuides() { showGuide('v', false); showGuide('h', false); }

    /* ---------------- 命中测试 ---------------- */

    function canvasPoint(e) {
      var rect = overlay.getBoundingClientRect();
      var f = fmtDef();
      return {
        x: (e.clientX - rect.left) / (rect.width || 1) * f.w,
        y: (e.clientY - rect.top) / (rect.height || 1) * f.h,
        rect: rect
      };
    }

    function hitTest(cx, cy) {
      var boxes = layoutBoxes(cur);
      var pad = 6;   /* 细线的点按容差，否则要瞄得像素级准 */
      for (var i = boxes.length - 1; i >= 0; i--) {
        var m = boxes[i].m;
        if (cx >= m.left - pad && cx <= m.left + m.boxW + pad &&
            cy >= m.top - pad && cy <= m.top + m.boxH + pad) {
          return boxes[i];
        }
      }
      return null;
    }

    /* ---------------- 拖动 / 缩放 ---------------- */

    var drag = null;

    function onOverlayDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      var p = canvasPoint(e);
      var handle = e.target.closest ? e.target.closest('[data-handle]') : null;
      var sel = e.target.closest ? e.target.closest('[data-el]') : null;

      if (handle && sel) {
        var nel = elById(sel.getAttribute('data-el'));
        if (!nel) return;
        activeId = nel.id;
        var box = measureEl(measureCtx(), fmtDef().w, fmtDef().h, nel);
        drag = {
          mode: 'scale', id: nel.id, moved: false,
          sx: e.clientX, sy: e.clientY, rect: p.rect,
          size0: nel.size,
          d0: Math.max(8, Math.hypot(p.x - nel.x * fmtDef().w, p.y - nel.y * fmtDef().h))
        };
        e.preventDefault();
        bindDrag();
        return;
      }

      var hit = hitTest(p.x, p.y);
      if (hit) {
        activeId = hit.id;
        renderOverlay();
        renderLayers();
        syncElCtl();
        drag = {
          mode: 'move', id: hit.id, moved: false,
          sx: e.clientX, sy: e.clientY, rect: p.rect,
          x0: hit.el.x, y0: hit.el.y
        };
        e.preventDefault();
        bindDrag();
      } else {
        activeId = '';
        renderOverlay();
        renderLayers();
        syncElCtl();
      }
      if (canvas && canvas.focus) { try { canvas.focus({ preventScroll: true }); } catch (e2) { canvas.focus(); } }
    }

    function bindDrag() {
      document.addEventListener('pointermove', onDragMove);
      document.addEventListener('pointerup', onDragUp);
      document.addEventListener('pointercancel', onDragUp);
    }

    function unbindDrag() {
      document.removeEventListener('pointermove', onDragMove);
      document.removeEventListener('pointerup', onDragUp);
      document.removeEventListener('pointercancel', onDragUp);
    }

    function onDragMove(e) {
      if (!drag) return;
      var el = elById(drag.id);
      if (!el) { drag = null; unbindDrag(); return; }
      var f = fmtDef();

      if (drag.mode === 'move') {
        var dx = (e.clientX - drag.sx) / drag.rect.width;
        var dy = (e.clientY - drag.sy) / drag.rect.height;
        if (!drag.moved) {
          if (Math.abs(e.clientX - drag.sx) < 2 && Math.abs(e.clientY - drag.sy) < 2) return;
          drag.moved = true;
          pushUndo();
        }
        var nx = clamp01(drag.x0 + dx), ny = clamp01(drag.y0 + dy);
        /* 中线吸附：阈值是**屏幕** 6px，换算成相对量要除以画布宽高 ——
           写成固定的 0.006 在方形（1181）和 4×6（1772）上吸附手感会不一样。 */
        var tv = 6 / (drag.rect.width || 1), th = 6 / (drag.rect.height || 1);
        var snapV = Math.abs(nx - 0.5) <= tv;
        var snapH = Math.abs(ny - 0.5) <= th;
        if (snapV) nx = 0.5;
        if (snapH) ny = 0.5;
        el.x = nx; el.y = ny;
        afterChange(1);
        showGuide('v', snapV);
        showGuide('h', snapH);
        return;
      }

      /* 缩放手柄：按"当前指针到元素中心的距离 / 起始距离"算比例。
         用距离而不是投影，是因为四个角方向不同，距离对四个角都成立。 */
      if (drag.mode === 'scale') {
        if (!drag.moved) { drag.moved = true; pushUndo(); }
        var p = canvasPoint(e);
        var d = Math.hypot(p.x - el.x * f.w, p.y - el.y * f.h);
        var ratio = d / drag.d0;
        var next = drag.size0 * ratio;
        el.size = clamp(next, el.kind === 'rule' ? 0.05 : 0.008, el.kind === 'rule' ? 1 : 0.4);
        afterChange(1);
        return;
      }
    }

    function onDragUp() {
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      unbindDrag();
      hideGuides();
      if (moved) afterChange();
    }

    /* 滚轮微调字号：只在指针**落在选中元素上**时接管，否则让页面滚。
       不做全局接管的原因很直接——侧栏比画布高，用户滚页面滚到一半
       字号突然变了，会以为界面出错。 */
    function onWheel(e) {
      var el = activeEl();
      if (!el) return;
      var p = canvasPoint(e);
      var boxes = layoutBoxes(cur);
      var over = null;
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].id !== el.id) continue;
        var m = boxes[i].m;
        if (p.x >= m.left - 6 && p.x <= m.left + m.boxW + 6 &&
            p.y >= m.top - 6 && p.y <= m.top + m.boxH + 6) over = boxes[i];
      }
      if (!over) return;
      e.preventDefault();
      pushUndoTagged('wheel:' + el.id);
      var step = e.deltaY < 0 ? 1.04 : 1 / 1.04;
      el.size = clamp(el.size * step, el.kind === 'rule' ? 0.05 : 0.008, el.kind === 'rule' ? 1 : 0.4);
      afterChange();
    }

    /* ---------------- 键盘 ---------------- */

    function onKey(e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }

      var el = activeEl();
      if (!el) return;
      var f = fmtDef();
      var dxs = 0, dys = 0;
      var stepPx = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') dxs = -stepPx;
      else if (e.key === 'ArrowRight') dxs = stepPx;
      else if (e.key === 'ArrowUp') dys = -stepPx;
      else if (e.key === 'ArrowDown') dys = stepPx;
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteActive();
        return;
      } else {
        return;
      }
      e.preventDefault();
      pushUndoTagged('nudge');
      if (dxs) el.x = clamp01(el.x + dxs / f.w);
      if (dys) el.y = clamp01(el.y + dys / f.h);
      afterChange();
    }

    function deleteActive() {
      var el = activeEl();
      if (!el) return;
      pushUndo();
      cur.elements = els().filter(function (x) { return x.id !== el.id; });
      activeId = els().length ? els()[0].id : '';
      afterChange();
      renderLayers();
      syncElCtl();
      toast('已删除这个文字块（可撤销）', 'ok', 1800);
    }

    /* ---------------- 侧栏渲染 ---------------- */

    function elName(el) {
      if (el.kind === 'rule') return '分隔线';
      if (el.key && TEXT_LABELS[el.key]) return TEXT_LABELS[el.key];
      var t = String(el.text || '').replace(/\s+/g, ' ').slice(0, 8);
      return t || '文字块';
    }

    function renderLayers() {
      var holder = box.querySelector('#lbl-layers');
      var freeBlock = box.querySelector('#lbl-free');
      var tplBlock = box.querySelector('#lbl-tpl');
      var free = isFree(cur);
      if (freeBlock) freeBlock.hidden = !free;
      if (tplBlock) tplBlock.hidden = free;
      if (!holder) return;
      if (!free) { holder.innerHTML = ''; return; }
      var html = '';
      var f = fmtDef();
      for (var i = 0; i < els().length; i++) {
        var el = els()[i];
        var meta = el.kind === 'rule'
          ? ('长 ' + Math.round(el.size * 100) + '%')
          : (Math.round(el.size * Math.min(f.w, f.h)) + 'px');
        html += '<button type="button" class="lbl-layer' + (el.id === activeId ? ' is-on' : '') + '" ' +
          'data-lbl="sel" data-id="' + attr(el.id) + '">' +
          '<span class="lbl-layer__dot" style="background:' + attr(el.color || cur.style.fg) + '"></span>' +
          '<span class="lbl-layer__name">' + esc(elName(el)) + '</span>' +
          '<span class="lbl-layer__meta">' + esc(meta) + '</span></button>';
      }
      holder.innerHTML = html || '<p class="u-xs u-dim">还没有文字块，点下面的「＋文字」加一个。</p>';
    }

    function setVal(sel, v) {
      var el = box.querySelector(sel);
      if (!el) return;
      /* 正在编辑的控件不回写：给 input[type=color] 赋值会把它刚打开的
         取色面板关掉，给 range 赋值会打断拖动。 */
      if (document.activeElement === el) return;
      var sv = String(v);
      if (String(el.value) !== sv) el.value = sv;
    }

    function setText(sel, v) {
      var el = box.querySelector(sel);
      if (!el) return;
      if (document.activeElement === el) return;
      if (el.value !== v) el.value = v;
    }

    function syncElCtl() {
      var el = activeEl();
      var panel = box.querySelector('#lbl-elctl');
      if (panel) panel.hidden = !el;
      if (!el) return;
      var isRule = el.kind === 'rule';
      var tw = box.querySelector('#lbl-el-textwrap');
      if (tw) tw.hidden = isRule;
      setText('#lbl-el-text', el.text || '');
      setVal('#lbl-el-color', /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(el.color) ? el.color : cur.style.fg);
      setText('#lbl-el-hex', el.color || '');
      setVal('#lbl-el-align', el.align);
      setVal('#lbl-el-weight', String(el.weight));
      var cb = box.querySelector('#lbl-el-italic');
      if (cb && document.activeElement !== cb) cb.checked = !!el.italic;
      var sp = box.querySelector('#lbl-el-spacing');
      if (sp) {
        if (document.activeElement !== sp) sp.value = el.spacing;
        var spv = box.querySelector('#lbl-el-spacing-val');
        if (spv) spv.textContent = ' ' + (el.spacing * 100).toFixed(0) + '%';
      }
      var sizeInput = box.querySelector('#lbl-el-size');
      var label = box.querySelector('#lbl-el-size-label');
      var valEl = box.querySelector('#lbl-el-size-val');
      if (label) label.textContent = isRule ? '长度' : '字号';
      if (sizeInput) {
        if (isRule) { sizeInput.min = '5'; sizeInput.max = '100'; sizeInput.step = '1'; }
        else { sizeInput.min = '0.5'; sizeInput.max = '20'; sizeInput.step = '0.1'; }
        var v = isRule ? (el.size * 100) : (el.size * 100);
        if (document.activeElement !== sizeInput) sizeInput.value = v;
        if (valEl) {
          valEl.textContent = isRule
            ? ' ' + Math.round(el.size * 100) + '% 画布宽'
            : ' ' + Math.round(el.size * Math.min(fmtDef().w, fmtDef().h)) + ' px';
        }
      }
    }

    function updateImgUI() {
      var b = cur.bg;
      var segC = box.querySelector('#lbl-seg-color');
      var segI = box.querySelector('#lbl-seg-image');
      if (segC) segC.classList.toggle('is-on', b.type !== 'image');
      if (segI) segI.classList.toggle('is-on', b.type === 'image');
      setVal('#lbl-bg-color', b.color);
      setText('#lbl-bg-hex', b.color);
      setVal('#lbl-fit', b.fit);
      var hint = box.querySelector('#lbl-fit-hint');
      if (hint) {
        hint.textContent = b.fit === 'fill' ? '拉伸会变形（圆的会变椭圆），只在原图本来就该铺满时用'
          : (b.fit === 'contain' ? '完整放下，四周留底色' : '保比例裁切，用下面的滑杆挪位置');
      }
      var z = box.querySelector('#lbl-zoom');
      if (z && document.activeElement !== z) z.value = b.zoom;
      var zv = box.querySelector('#lbl-zoom-val');
      if (zv) zv.textContent = ' ' + b.zoom.toFixed(2) + '×';
      var ox = box.querySelector('#lbl-ox');
      if (ox && document.activeElement !== ox) ox.value = b.offsetX;
      var oy = box.querySelector('#lbl-oy');
      if (oy && document.activeElement !== oy) oy.value = b.offsetY;
      setVal('#lbl-tint', b.tint.color);
      setText('#lbl-tint-hex', b.tint.color);
      var ta = box.querySelector('#lbl-tint-alpha');
      if (ta && document.activeElement !== ta) ta.value = Math.round(b.tint.alpha * 100);
      var tv = box.querySelector('#lbl-tint-val');
      if (tv) tv.textContent = ' ' + Math.round(b.tint.alpha * 100) + '%';
      var info = box.querySelector('#lbl-img-info');
      if (info) info.textContent = b.imageId ? ('本张 ' + kfmt(imgChars(b.imageId)) + ' 字符') : '';
      var bgi = box.querySelector('#lbl-bgi');
      if (bgi) bgi.hidden = b.type !== 'image';
    }

    function updateBudget() {
      var holder = box.querySelector('#lbl-budget');
      if (!holder) return;
      var st = imageStats();
      var per = 200000;
      var can = Math.floor(st.remaining / per);
      var pct = Math.round(st.chars / st.budget * 100);
      holder.className = 'lbl-budget' + (st.remaining < 300000 ? ' is-tight' : '');
      holder.innerHTML =
        '<div class="lbl-budget__bar"><span style="width:' + Math.min(100, pct) + '%"></span></div>' +
        '<div class="lbl-budget__txt">图片已用 <b>' + kfmt(st.chars) + '</b> / ' + kfmt(st.budget) +
        ' 字符（' + pct + '%）· 现有 ' + st.count + ' 张 · 约还能放 <b>' + can + '</b> 张' +
        '<span class="u-dim">（每张按 ' + kfmt(per) + ' 估，单张上限 ' + kfmt(st.singleMax) + '）</span></div>';
    }

    function showImgMsg(text, kind) {
      var el = box.querySelector('#lbl-img-msg');
      if (!el) return;
      el.hidden = !text;
      el.className = 'lbl-imgmsg' + (kind ? ' is-' + kind : '');
      el.innerHTML = text || '';
    }

    function renderChips() {
      var holder = box.querySelector('#lbl-list');
      if (!holder) return;
      var arr = labelsOf(recipe.id);
      if (!arr.length) {
        holder.innerHTML = '还没有保存过酒标。设计好点「保存这张」，最多存 ' + MAX_PER_RECIPE + ' 张。';
        return;
      }
      var html = '';
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i] || {};
        html += '<span class="lbl-chip' + (it.id === editingId ? ' is-on' : '') + '">' +
          '<button type="button" class="lbl-chip__load" data-lbl="load" data-id="' + attr(it.id) + '">' +
            esc(it.name || '未命名') + '<span class="u-dim"> · ' + esc(UI.dt(it.at)) + '</span></button>' +
          '<button type="button" class="lbl-chip__del" data-lbl="del" data-id="' + attr(it.id) + '" ' +
            'aria-label="删除这张酒标">' + icon('x', 11) + '</button>' +
          '</span>';
      }
      holder.innerHTML = '<div class="lbl-chips">' + html + '</div>';
    }

    /* 「是否已保存」在渲染时**现算**：拿当前参数和已保存列表逐张比。
       以前靠 editingId 这个标记，切一次页签面板重建、标记被重置成 list[0]，
       提示就会说"正在编辑已保存的 X"——而屏幕上根本不是 X 的参数（⑧）。 */
    function updateMode() {
      var mode = box.querySelector('#lbl-mode');
      if (!mode) return;
      var arrAll = labelsOf(recipe.id);
      var edited = null, same = null;
      for (var q = 0; q < arrAll.length; q++) {
        if (arrAll[q] && arrAll[q].id === editingId) edited = arrAll[q];
        if (!same && arrAll[q] && specEquals(cur, arrAll[q])) same = arrAll[q];
      }
      if (edited && specEquals(cur, edited)) {
        mode.textContent = '与已保存的「' + (edited.name || '未命名') + '」完全一致——' +
          '「保存这张」会更新它；要另存一张点「新建一张」。';
      } else if (edited) {
        mode.textContent = '在「' + (edited.name || '未命名') + '」的基础上改过——' +
          '「保存这张」会更新它；要另存一张点「新建一张」。';
      } else if (same) {
        mode.textContent = '当前参数与已保存的「' + (same.name || '未命名') + '」相同。';
      } else {
        mode.textContent = '当前参数还没有保存过，点「保存这张」会新增（每配方最多 ' +
          MAX_PER_RECIPE + ' 张）。';
      }
    }

    function renderAll() {
      syncFields();
      renderLayers();
      syncElCtl();
      updateImgUI();
      updateBudget();
      updateMode();
      renderChips();
      paint();
    }

    function syncFields() {
      setVal('#lbl-format', cur.format);
      setText('#lbl-title', cur.text.title);
      setText('#lbl-sub', cur.text.sub);
      setText('#lbl-line1', cur.text.line1);
      setText('#lbl-foot', cur.text.foot);
    }

    /* ---------------- 侧栏事件 ---------------- */

    var HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
    function normHex(v) {
      var m = HEX.exec(String(v || '').trim());
      if (!m) return null;
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return '#' + h.toLowerCase();
    }

    function setTextKey(key, val, tag) {
      pushUndoTagged(tag);
      cur.text[key] = val;
      var e2 = elByKey(key);
      if (e2) e2.text = val;
      afterChange();
    }

    function setElField(field, val, tag) {
      var el = activeEl();
      if (!el) return;
      pushUndoTagged(tag || field);
      el[field] = val;
      if (field === 'text' && el.key && has(cur.text, el.key)) cur.text[el.key] = val;
      afterChange();
    }

    function setBgField(field, val, tag) {
      pushUndoTagged(tag || ('bg.' + field));
      cur.bg[field] = val;
      if (field === 'color') cur.style.bg = val;
      afterChange();
    }

    function setTint(field, val, tag) {
      pushUndoTagged(tag || ('tint.' + field));
      cur.bg.tint[field] = val;
      afterChange();
    }

    function onInput(e) {
      var t = e.target;
      if (!t || !t.id) return;
      var id = t.id, v = t.value;

      if (id === 'lbl-title') { setTextKey('title', v, 'txt:title'); return; }
      if (id === 'lbl-sub') { setTextKey('sub', v, 'txt:sub'); return; }
      if (id === 'lbl-line1') { setTextKey('line1', v, 'txt:line1'); return; }
      if (id === 'lbl-foot') { setTextKey('foot', v, 'txt:foot'); return; }

      if (id === 'lbl-el-text') { setElField('text', v, 'el:text'); return; }
      if (id === 'lbl-el-size') { setElField('size', num(v, 5) / 100, 'el:size'); return; }
      if (id === 'lbl-el-color') { setElField('color', v, 'el:color'); return; }
      if (id === 'lbl-el-spacing') { setElField('spacing', clamp(num(v, 0), 0, 0.3), 'el:spacing'); return; }

      if (id === 'lbl-bg-color') { setBgField('color', v, 'bg:color'); return; }
      if (id === 'lbl-bg-tint') { setTint('color', v, 'bg:tint'); return; }
      if (id === 'lbl-tint-alpha') { setTint('alpha', clamp(num(v, 0) / 100, 0, 1), 'bg:alpha'); return; }
      if (id === 'lbl-zoom') { setBgField('zoom', clamp(num(v, 1), 1, 3), 'bg:zoom'); return; }
      if (id === 'lbl-ox') { setBgField('offsetX', clamp01(v), 'bg:ox'); return; }
      if (id === 'lbl-oy') { setBgField('offsetY', clamp01(v), 'bg:oy'); return; }
    }

    function onChange(e) {
      var t = e.target;
      if (!t || !t.id) return;
      var id = t.id, v = t.value;

      if (id === 'lbl-format') {
        pushUndo();
        cur.format = FORMATS[v] ? v : 'square';
        /* 只换画布尺寸，**不动元素的相对坐标**：0–1 的坐标本来就会跟着走。
           这里如果顺手"帮忙重排"，用户拖好的位置会在切版式时被悄悄改掉。 */
        afterChange();
        return;
      }
      if (id === 'lbl-fit') {
        setBgField('fit', (v === 'fill' || v === 'contain') ? v : 'cover', 'bg:fit');
        return;
      }
      if (id === 'lbl-el-align') { setElField('align', (v === 'left' || v === 'right') ? v : 'center'); return; }
      if (id === 'lbl-el-weight') { setElField('weight', num(v, 400) >= 700 ? 700 : (num(v, 400) >= 600 ? 600 : 400)); return; }
      if (id === 'lbl-el-italic') { setElField('italic', !!t.checked); return; }
      if (id === 'lbl-el-hex') {
        var h = normHex(v);
        if (h) setElField('color', h, 'el:color');
        else syncElCtl();
        return;
      }
      if (id === 'lbl-bg-hex') {
        var h2 = normHex(v);
        if (h2) { setBgField('color', h2, 'bg:color'); }
        else syncFields();
        return;
      }
      if (id === 'lbl-tint-hex') {
        var h3 = normHex(v);
        if (h3) setTint('color', h3, 'bg:tint');
        else updateImgUI();
        return;
      }
      if (id === 'lbl-keep-alpha' || id === 'lbl-file') return;
    }

    box.addEventListener('input', onInput);
    box.addEventListener('change', onChange);

    box.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || t.id !== 'lbl-file') return;
      var file = (t.files && t.files[0]) || null;
      /* 允许重新选同一个文件（否则第二次选它不会触发 change） */
      var keepAlpha = !!((box.querySelector('#lbl-keep-alpha') || {}).checked);
      if (!file) return;
      showImgMsg('<span class="lbl-imgmsg__spin">正在压缩…（长边先压到 900px，超预算会自动再降一档）</span>', 'info');
      importImage(file, { keepAlpha: keepAlpha }, function (res) {
        try { t.value = ''; } catch (e2) { /* 有的浏览器禁止清空 file */ }
        if (!res.ok) {
          var why = imgFailText(res);
          showImgMsg(why, 'error');
          toast(res.reason === 'budget' ? '图片预算不足，没有导入' : '这张图放不下，没有导入', 'error', 5200);
          return;
        }
        pushUndo();
        var old = cur.bg.imageId;
        cur.bg.type = 'image';
        cur.bg.imageId = res.id;
        cur.bg.fit = cur.bg.fit || 'cover';
        cur.bg.offsetX = 0.5; cur.bg.offsetY = 0.5; cur.bg.zoom = 1;
        afterChange();
        showImgMsg('已导入：' + res.w + '×' + res.h + ' px · ' + res.ladder + ' · <b>' +
          kfmt(res.chars) + '</b> 字符。' +
          (old && old !== res.id ? '旧图会在保存后回收。' : ''), 'ok');
        gcImages(keepIds());
        updateBudget();
      });
    });

    /** 失败的说明必须**能照着做**：写"导入失败"等于没写 */
    function imgFailText(res) {
      var st = res.stats || imageStats();
      if (res.reason === 'budget') {
        return '<b>放不下了，这张图没有存进去。</b><br>' +
          '这张压到 ' + kfmt(res.chars) + ' 字符，图片总预算 ' + kfmt(st.budget) + ' 里只剩 ' +
          kfmt(st.remaining) + '（已用 ' + kfmt(st.chars) + '，共 ' + st.count + ' 张）。<br>' +
          '可以：① 先「移除图片」或删掉不用的旧酒标，回收空间再传；' +
          '② 换一张更简单的图（大面积纯色/渐变最省，手机直出的照片最费）；' +
          '③ 先用别的工具把图缩到 900px 以内再传。';
      }
      if (res.reason === 'single') {
        return '<b>这张图压不下来。</b><br>' +
          '一路压到 ' + (res.ladder || '最小档') + ' 仍有 ' + kfmt(res.smallest) +
          ' 字符，超过单张上限 ' + kfmt(IMG_SINGLE_MAX) + '。<br>' +
          '图片细节太多（噪点、树叶、布料纹理）时 JPEG 省不下来，' +
          '可以换一张图，或先用别的工具缩小/降噪再传。';
      }
      if (res.reason === 'type') return '<b>这不是图片文件</b>（读到的是 ' + esc(res.type || '未知类型') + '）。';
      if (res.reason === 'read') return '<b>文件读不出来</b>：浏览器拒绝访问这个文件。试试把图先复制到桌面再选。';
      if (res.reason === 'decode') return '<b>这张图解不开</b>：文件可能损坏，或格式浏览器不支持（试 JPG/PNG/WebP）。';
      if (res.reason === 'write') return '<b>浏览器拒绝了这次写入</b>：localStorage 可能已满。到设置里清理历史备份后再试。';
      return '<b>导入失败</b>：' + esc(res.reason || '未知原因') + '。';
    }

    /* ---------------- 点击动作 ---------------- */

    box.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-lbl]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-lbl');

      if (act === 'undo') { undo(); return; }
      if (act === 'redo') { redo(); return; }

      if (act === 'sel') {
        activeId = btn.getAttribute('data-id');
        renderLayers();
        syncElCtl();
        paint();
        return;
      }

      if (act === 'free') {
        pushUndo();
        cur.elements = freeFromTemplate(cur);
        activeId = cur.elements.length ? cur.elements[0].id : '';
        afterChange();
        toast('已转为自由布局：可以拖动、改字号了（可撤销）', 'ok', 2600);
        return;
      }

      if (act === 'back-tpl') {
        pushUndo();
        cur.elements = [];
        activeId = '';
        afterChange();
        toast('已还原为模板版式', 'ok');
        return;
      }

      if (act === 'add-text') {
        pushUndo();
        var ne = {
          id: newElId(), kind: 'text', key: '', text: '新文字',
          x: 0.5, y: 0.5, size: 0.05, color: '', align: 'center',
          weight: 400, italic: false, spacing: 0, serif: false
        };
        cur.elements = els().concat([ne]);
        activeId = ne.id;
        afterChange();
        var ti = box.querySelector('#lbl-el-text');
        if (ti) { try { ti.focus(); ti.select(); } catch (e2) { /* 忽略 */ } }
        return;
      }

      if (act === 'add-rule') {
        pushUndo();
        var nr = {
          id: newElId(), kind: 'rule', key: '', text: '',
          x: 0.5, y: 0.5, size: 0.3, color: cur.style.accent, align: 'center',
          weight: 400, italic: false, spacing: 0, serif: false
        };
        cur.elements = els().concat([nr]);
        activeId = nr.id;
        afterChange();
        return;
      }

      if (act === 'del-el') { deleteActive(); return; }

      if (act === 'fit-fmt') {
        pushUndo();
        refitElements(cur);
        afterChange();
        toast('已按当前版式重新摆放四段文案（自定义块没动）', 'ok', 2600);
        return;
      }

      if (act === 'bg-color') {
        if (cur.bg.type !== 'color') { pushUndo(); cur.bg.type = 'color'; afterChange(); }
        return;
      }
      if (act === 'bg-image') {
        if (cur.bg.type !== 'image') { pushUndo(); cur.bg.type = 'image'; afterChange(); }
        return;
      }
      if (act === 'pick') {
        var fi = box.querySelector('#lbl-file');
        if (fi) fi.click();
        return;
      }
      if (act === 'img-del') {
        if (!cur.bg.imageId && cur.bg.type !== 'image') return;
        pushUndo();
        cur.bg.type = 'color';
        cur.bg.imageId = '';
        afterChange();
        gcImages(keepIds());
        updateBudget();
        showImgMsg('图片已移除，回到纯色底。', 'ok');
        return;
      }

      if (act === 'new') {
        editingId = '';
        var def = defaultSpec(recipe, calc);
        def.text.title = '';       /* 老行为：新建一张标题留空，让用户自己填 */
        applySpec(def);
        return;
      }

      if (act === 'save') {
        /* 酒标挂在配方 id 上；配方还没保存过时 id 为空，写进去等于扔进黑洞。
           原来的实现只 return false —— 按钮点了什么都不发生，用户会反复点。
           这里改成明确告知 + 提供"先去保存配方"的动作。 */
        if (!recipe.id) {
          if (UI.Shell && typeof UI.Shell.confirm === 'function') {
            UI.Shell.confirm({
              title: '先保存配方？',
              message: '酒标要存在配方上，而当前配方还没有保存过。',
              detail: '先保存配方，再回来存这张酒标；取消则什么都不做。',
              okLabel: '保存配方'
            }, function () {
              try {
                var r2 = UI.recipe();
                /* id 为空时先补一个：SaveRecipe 遇到空 id 会当新配方 push，
                   结果库里多出一条 id 为空的记录，而工作副本仍然没有 id。 */
                if (!r2.id) r2.id = UI.uid('r');
                if (!r2.createdAt) r2.createdAt = Date.now();
                if (UI.store && typeof UI.store.saveRecipe === 'function') {
                  UI.store.saveRecipe(UI.clone ? UI.clone(r2) : r2);
                }
                recipe.id = r2.id;
                toast('配方已保存，现在可以存酒标了', 'ok', 3200);
              } catch (err) {
                toast('保存配方失败：' + ((err && err.message) || '未知错误'), 'error');
              }
            });
          } else {
            toast('未保存：请先保存配方', 'warn', 3200);
          }
          return;
        }

        var arr = labelsOf(recipe.id).slice();
        var id = editingId || ('lb-' + Date.now().toString(36));
        var rec = {
          id: id,
          name: String(cur.text.title || '未命名').slice(0, 40),
          at: Date.now(),
          format: cur.format,
          /* style.bg 永远等于 bg.color（normSpec 保证），老读取方不会错位 */
          style: { bg: cur.bg.color, fg: cur.style.fg, accent: cur.style.accent },
          text: cur.text,
          bg: cur.bg
        };
        /* 只有自由布局才写 elements：模板版式保持 v1.2 的存档形状，
           这样"老标还是老样子"这件事连存档层面都是真的。 */
        if (isFree(cur)) rec.elements = cur.elements;

        var hit = -1;
        for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) { hit = i; break; }
        if (hit > -1) arr[hit] = rec;
        else {
          if (arr.length >= MAX_PER_RECIPE) {
            toast('每份配方最多 ' + MAX_PER_RECIPE + ' 张，先删一张再存', 'warn', 3600);
            return;
          }
          arr.push(rec);
        }
        if (!saveLabelsFor(recipe.id, arr)) return;
        var wasUpdate = !!editingId && hit > -1;
        editingId = id;
        draft.editingId = id;
        /* 必须重画而不是只刷列表：保存之后「当前参数是否已保存」这句提示
           会从"还没有保存过"变成"与已保存的「X」一致"，而那句话是渲染时现算的（⑧）。 */
        afterChange();
        renderChips();
        gcImages(keepIds());
        updateBudget();
        toast(wasUpdate ? ('已更新酒标「' + rec.name + '」') : ('已新建酒标「' + rec.name + '」'), 'ok');
        return;
      }

      if (act === 'load') {
        var lid = btn.getAttribute('data-id');
        var arr2 = labelsOf(recipe.id);
        for (var j = 0; j < arr2.length; j++) {
          if (!arr2[j] || arr2[j].id !== lid) continue;
          editingId = lid;
          applySpec(cloneSpec(arr2[j]));
          renderChips();
          return;
        }
        return;
      }

      if (act === 'del') {
        var did = btn.getAttribute('data-id');
        var arr3 = labelsOf(recipe.id).filter(function (x) { return x && x.id !== did; });
        if (!saveLabelsFor(recipe.id, arr3)) return;
        if (editingId === did) { editingId = ''; draft.editingId = ''; }
        /* 删掉的可能是"正在编辑的那一张"：提示要跟着重算，不能停在旧文案 */
        afterChange();
        renderChips();
        gcImages(keepIds());
        updateBudget();
        toast('已删除（这张标的图也回收了）', 'ok');
        return;
      }

      if (act === 'export') {
        var imgId = cur.bg && cur.bg.type === 'image' ? cur.bg.imageId : '';
        if (!imgId) { exportPng(cur); return; }
        /* 导出前必须等图解码完，否则会导出一张"少了背景"的 PNG，
           而且用户看不出来 —— 他只会觉得"打印店把我的图弄丢了"。 */
        withImage(imgId, function () { exportPng(cur); });
        return;
      }
    });

    /* 色块快捷点：常用色给三个（墨/纸/琥珀），点一下比开取色盘快 */
    var SWATCHES = ['#241f18', '#fbf8f1', '#8a4b1f', '#e8a33d', '#c8862f', '#2b1608'];
    (function buildSwatches() {
      var rows = box.querySelectorAll('.lbl-swrow');
      for (var i = 0; i < rows.length; i++) {
        var target = rows[i].getAttribute('data-target');
        var html = '';
        for (var s = 0; s < SWATCHES.length; s++) {
          html += '<button type="button" class="lbl-sw" data-sw="' + attr(target) + '" ' +
            'data-color="' + attr(SWATCHES[s]) + '" style="background:' + attr(SWATCHES[s]) + '" ' +
            'aria-label="用色 ' + attr(SWATCHES[s]) + '"></button>';
        }
        rows[i].innerHTML = html;
      }
    })();

    box.addEventListener('click', function (e) {
      var sw = e.target.closest ? e.target.closest('[data-sw]') : null;
      if (!sw) return;
      var c = sw.getAttribute('data-color');
      if (sw.getAttribute('data-sw') === 'bg') setBgField('color', c, 'bg:color');
      else setElField('color', c, 'el:color');
    });

    /* ---------------- 画布交互绑定 ---------------- */

    if (overlay) {
      overlay.addEventListener('pointerdown', onOverlayDown);
      overlay.addEventListener('wheel', onWheel, { passive: false });
    }
    if (wrap) {
      wrap.addEventListener('keydown', onKey);
    }
    root.addEventListener('resize', function () { if (alive) fitCanvas(); });

    /* ---------------- 图片回收 ----------------
       把"所有已保存酒标引用的图 + 当前编辑中的图 + 撤销栈里的图"作为存活集合。
       少算任何一类都会造成：撤销回到上一步，图没了（本地还有那个 id，
       但键已经被回收），表现为"撤销以后背景变回纯色"。 */
    function keepIds() {
      var keep = {};
      try {
        var all = store() ? store().get('labels', null) : null;
        for (var k in all) {
          if (!has(all, k)) continue;
          var arr = all[k];
          if (!Array.isArray(arr)) continue;
          for (var i = 0; i < arr.length; i++) {
            var b = arr[i] && arr[i].bg;
            if (b && b.imageId) keep[b.imageId] = 1;
          }
        }
      } catch (e) { /* 读不到就先不回收，宁可漏也不能误删 */ }
      if (cur.bg.imageId) keep[cur.bg.imageId] = 1;
      var stacks = [undoStack, redoStack];
      for (var s = 0; s < stacks.length; s++) {
        for (var u = 0; u < stacks[s].length; u++) {
          try {
            var sp = JSON.parse(stacks[s][u]);
            if (sp && sp.bg && sp.bg.imageId) keep[sp.bg.imageId] = 1;
          } catch (e2) { /* 坏快照忽略 */ }
        }
      }
      return keep;
    }

    /* ---------------- 导出 ---------------- */

    function exportPng(sp) {
      /* 导出用**独立画布**：预览画布的 CSS 尺寸可能被缩放，
         直接 toDataURL 会拿到预览分辨率；这里按版式真实尺寸重画一次。
         ⚠️ 必须调同一个 draw()：配色兜底（safeInk / safeAccent）与背景图
         的绘制都在里面。另写一条"导出专用绘制"会导致屏上黑字、纸上印白字。 */
      var off = document.createElement('canvas');
      draw(off, sp);
      var fmtDef2 = FORMATS[sp.format] || FORMATS.square;

      /* 圆标必须四角透明（靠 clip 保证）。这里是**兜底自检**：
         以后谁调了绘制顺序（比如先 restore 再 fillRect），透明角会被填满，
         而这种破坏在界面上几乎看不出来。成本几毫秒，换一条明确提示。 */
      var cornersOk = true;
      if (sp.format === 'round') {
        cornersOk = checkCornersTransparent(off);
        if (!cornersOk) {
          if (root.console && root.console.warn) {
            root.console.warn('[label] 圆标四角不透明，绘制顺序可能被改动（应为 clip 内绘制）');
          }
        }
      }
      /* 文件名里不能出现路径分隔符，Windows 下会直接失败 */
      var name = String((sp.text && sp.text.title) || recipe.name || '配方').replace(/[\\/:*?"<>|]/g, '_');
      var fname = name + '-酒标' + (cornersOk ? '' : '-请检查底图') + '.png';
      try {
        /* 走带 pHYs 的导出：文件自己就能证明"这是 300dpi 的 10cm 酒标"，
           否则排版软件按 72/96dpi 解释会把 10 cm 放成 31–42 cm */
        var packed = (typeof pngWithDpi === 'function')
          ? pngWithDpi(off, 300)
          : { url: off.toDataURL('image/png'), ok: false };
        var url = packed.url;
        var a = document.createElement('a');
        a.href = url;
        a.download = fname;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        root.setTimeout(function () {
          if (a.parentNode) a.parentNode.removeChild(a);
        }, 200);
        toast('已导出 ' + fname + '（' + fmtDef2.w + '×' + fmtDef2.h + '）', 'ok', 3200);
      } catch (err) {
        toast('导出失败：' + ((err && err.message) || '浏览器拒绝下载'), 'error', 4200);
      }
    }

    renderAll();
    /* 首次挂载时回收孤儿图（上次没保存就关页签留下的）；
       放在 renderAll 之后，能拿到最新的 labels 与当前编辑态 */
    gcImages(keepIds());
    updateBudget();
    return { unmount: function () { alive = false; L.onImageLoad = null; } };
  }

  /* ======================================================================
   * PNG 的 dpi 元数据（pHYs）
   * ----------------------------------------------------------------------
   * 浏览器 `canvas.toDataURL('image/png')` **不写 pHYs**（实测分块序列是
   * IHDR / IDAT×N / IEND）。后果不是"印出来糊"，而是**尺寸被读错**：
   * 多数排版软件缺 pHYs 时按 72 或 96 dpi 解释，1181 px 的 10 cm 酒标
   * 会被当成 31.2 cm（96dpi）或 41.7 cm（72dpi）插进文档，用户得手动缩。
   *
   * 这里手工插一个 pHYs（纯本地、不引库）：
   *   数据 9 字节 = ppuX(4, 大端) + ppuY(4, 大端) + 单位(1, =1 表示"每米")
   *   300 dpi = 300 / 0.0254 = 11811.02 → 11811 ppm
   *   chunk = 长度(4) + 'pHYs'(4) + 数据(9) + CRC(4)，CRC 覆盖 类型+数据
   * 插入位置固定在第 33 字节（8 字节签名 + IHDR 的 25 字节）之后，
   * IHDR 永远是第一个块且数据恒为 13 字节，所以这个偏移是稳定的。
   * ====================================================================*/

  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
    return CRC_TABLE;
  }

  function crc32(bytes, start, len) {
    var t = crcTable();
    var c = 0xFFFFFFFF;
    for (var i = 0; i < len; i++) {
      c = t[(c ^ bytes[start + i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function writeU32(arr, at, v) {
    arr[at] = (v >>> 24) & 0xFF;
    arr[at + 1] = (v >>> 16) & 0xFF;
    arr[at + 2] = (v >>> 8) & 0xFF;
    arr[at + 3] = v & 0xFF;
  }

  function readU32(arr, at) {
    return ((arr[at] << 24) | (arr[at + 1] << 16) | (arr[at + 2] << 8) | arr[at + 3]) >>> 0;
  }

  function bytesFromBase64(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function base64FromBytes(bytes) {
    var s = '';
    var CHUNK = 0x8000;   /* 一次 32K：再大就有浏览器对 apply 参数上限的顾虑 */
    for (var i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  /** 在 PNG 字节流里插 pHYs，返回新字节数组 */
  function withPhys(bytes, dpi) {
    var ppm = Math.round(num(dpi, 300) / 0.0254);
    var chunk = new Uint8Array(21);
    writeU32(chunk, 0, 9);                       /* 数据长度 */
    chunk[4] = 0x70; chunk[5] = 0x48;            /* 'p' 'H' */
    chunk[6] = 0x59; chunk[7] = 0x73;            /* 'Y' 's' */
    writeU32(chunk, 8, ppm);                     /* ppuX */
    writeU32(chunk, 12, ppm);                    /* ppuY */
    chunk[16] = 1;                               /* 单位：1 = 米 */
    writeU32(chunk, 17, crc32(chunk, 4, 13));    /* CRC 覆盖 类型+数据 */

    var at = 33;                                 /* 8 签名 + IHDR(4+4+13+4) */
    var out = new Uint8Array(bytes.length + chunk.length);
    out.set(bytes.subarray(0, at), 0);
    out.set(chunk, at);
    out.set(bytes.subarray(at), at + chunk.length);
    return out;
  }

  /**
   * UI.pngWithDpi(canvas, dpi) → { url, ok, ppm }
   * 失败时退回原始 toDataURL（绝不让导出因为元数据而失败）。
   * 自检：把生成的字节再解析一遍，确认 pHYs 存在、ppm 正确、IHDR 尺寸没变。
   */
  function pngWithDpi(canvas, dpi) {
    var raw = canvas.toDataURL('image/png');
    var want = Math.round(num(dpi, 300) / 0.0254);
    try {
      var b64 = raw.slice(raw.indexOf(',') + 1);
      var src = bytesFromBase64(b64);
      var out = withPhys(src, dpi);
      var url = 'data:image/png;base64,' + base64FromBytes(out);

      /* 自检：重新走一遍分块 */
      var chk = bytesFromBase64(url.slice(url.indexOf(',') + 1));
      var pos = 8, found = null, w = 0, h = 0;
      while (pos + 8 <= chk.length) {
        var len = readU32(chk, pos);
        var type = String.fromCharCode(chk[pos + 4], chk[pos + 5], chk[pos + 6], chk[pos + 7]);
        if (type === 'IHDR') { w = readU32(chk, pos + 8); h = readU32(chk, pos + 12); }
        if (type === 'pHYs') {
          found = { ppuX: readU32(chk, pos + 8), ppuY: readU32(chk, pos + 12), unit: chk[pos + 16] };
        }
        pos += 12 + len;
        if (type === 'IEND') break;
      }
      var ok = !!(found && found.ppuX === want && found.ppuY === want && found.unit === 1 &&
        w === canvas.width && h === canvas.height);
      if (!ok) {
        if (root.console && root.console.warn) {
          root.console.warn('[label] pHYs 自检未通过，回退到无元数据的 PNG', { found: found, want: want, w: w, h: h });
        }
        return { url: raw, ok: false, ppm: 0 };
      }
      return { url: url, ok: true, ppm: want };
    } catch (e) {
      if (root.console && root.console.warn) root.console.warn('[label] 写 pHYs 失败，回退：', e && e.message);
      return { url: raw, ok: false, ppm: 0 };
    }
  }

  UI.pngWithDpi = pngWithDpi;
  L.pngWithDpi = pngWithDpi;

  /** 读四个角的 alpha：圆标导出前必须都是 0 */
  function checkCornersTransparent(canvas) {
    try {
      var ctx = canvas.getContext('2d');
      var pts = [[1, 1], [canvas.width - 2, 1], [1, canvas.height - 2], [canvas.width - 2, canvas.height - 2]];
      for (var i = 0; i < pts.length; i++) {
        var d = ctx.getImageData(pts[i][0], pts[i][1], 1, 1).data;
        if (d[3] !== 0) return false;
      }
      return true;
    } catch (e) {
      /* getImageData 在跨域画布上会抛；本应用全本地绘制，不会走到这里 */
      return true;
    }
  }

  function formatOptions(cur2) {
    var html = '';
    for (var k in FORMATS) {
      if (!has(FORMATS, k)) continue;
      html += '<option value="' + attr(k) + '"' + (k === cur2 ? ' selected' : '') + '>' +
        esc(FORMATS[k].zh) + '</option>';
    }
    return html;
  }

  /**
   * 两张酒标参数是否完全一致（版式 + 配色 + 四段文案 + 背景 + 元素）。
   * 用来在渲染时**现算**"当前参数是不是已经存过了"，而不是维护一个会被
   * 页签切换重置掉的 editingId 标记（⑧）。
   * 两侧都先 normSpec 再比：老存档没有 bg/elements 字段，直接比字符串会
   * 把"同一个参数"判成不同，于是每张老标打开都显示"改过了"。
   */
  function specEquals(a, b) {
    if (!a || !b) return false;
    function sig(x) {
      var n = normSpec(x);
      return [
        n.format, n.style.bg, n.style.fg, n.style.accent,
        n.text.title, n.text.sub, n.text.line1, n.text.foot,
        n.bg.type, n.bg.color, n.bg.imageId, n.bg.fit,
        n.bg.offsetX, n.bg.offsetY, n.bg.zoom, n.bg.tint.color, n.bg.tint.alpha,
        JSON.stringify(n.elements)
      ].join('\u0001');
    }
    return sig(a) === sig(b);
  }

  L.draw = draw;
  L.mount = mount;
  L.FORMATS = FORMATS;
  L.PRESET = PRESET;
  L.imageStats = imageStats;
  L.gcImages = gcImages;
  L.IMG_PREFIX = IMG_PREFIX;
  L.LIMITS = { single: IMG_SINGLE_MAX, budget: IMG_BUDGET, side: IMG_SIDE_JPEG[0], sidePng: IMG_SIDE_PNG[0] };
  /** 把一份 spec 量成矩形（画布像素）。**只读**，给测试与排查用：
      "元素有没有越界""换成 4×6 之后还在不在画布里"这两件事没有别的办法验
      —— 覆盖层里的百分比是夹过 0–100 的，越界也会被显示成贴着边。 */
  L.layout = function (spec) {
    var sp = normSpec(spec);
    var f = FORMATS[sp.format] || FORMATS.square;
    var boxes = layoutBoxes(sp);
    var out = [];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      out.push({
        id: b.id, kind: b.el.kind, key: b.el.key,
        left: b.m.left, top: b.m.top, w: b.m.boxW, h: b.m.boxH,
        right: b.m.left + b.m.boxW, bottom: b.m.top + b.m.boxH,
        W: f.w, H: f.h
      });
    }
    return out;
  };

})(typeof window !== 'undefined' ? window : globalThis);
