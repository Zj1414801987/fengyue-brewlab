/* ============================================================================
 * 风月酿研所 — 27 水质报告解析与目标水匹配（Water Report / Target Match）
 * ----------------------------------------------------------------------------
 * 四件事：
 *   1. parseReport(text)  把用户从供水公司报告里复制来的文本解析成 6 个离子
 *   2. match(ions)        找到最接近的历史名城水型（给差值表，不给"像伯顿"这种空话）
 *   3. suggest(...)       按目标水反算该加多少盐
 *   4. reverseLookup(ions) 反推：这套水能酿什么酒（v1.4 追加，见文件末第 4 节）
 *
 * 为什么没有 OCR：file:// 下不引 CDN、不引 worker，PDF/截图识别做不了。
 *   所以走"粘贴文本 + 正则" + "手工填"。用户拿到的报告如果是扫描件，
 *   就退回手工填 6 个数字——这也是原界面已有的能力。
 *
 * 为什么盐建议不用解方程：线性方程组会给出负的盐量和
 *   「加 3.2g 石膏同时减 1.1g 氯化钙」这种没法执行的结果。
 *   这里用贪心：一次补最缺的那个离子，最多 3 种盐，给不到就说给不到。
 *
 * 纯度：只吃入参、只吐返回值。数据从 BREW.DB 只读（缺失时降级而不抛错）。
 *
 * 前置依赖：00-core（可不用）、14-data-water.js（waterSalts / waterProfiles / waterTargets，缺失时 match 返回空）
 * 加载位置：应在 js/24-data-usage-overrides.js 之后、js/30-recipe.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var WaterMatch = BREW.WaterMatch = {};

  var U = (BREW.Util && typeof BREW.Util.round === 'function') ? BREW.Util : {
    toNum: function (v, d) {
      var n = parseFloat(v);
      return isFinite(n) ? n : (d === undefined ? 0 : d);
    },
    round: function (v, d) {
      var p = Math.pow(10, d || 0);
      return Math.round(v * p) / p;
    },
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); }
  };

  var ION_KEYS = ['ca', 'mg', 'na', 'cl', 'so4', 'hco3'];
  var ION_META = {
    ca:   { zh: '钙',     mw: 40.08, eq: 2, scale: 200, unit: 'ppm' },
    mg:   { zh: '镁',     mw: 24.31, eq: 2, scale: 60,  unit: 'ppm' },
    na:   { zh: '钠',     mw: 22.99, eq: 1, scale: 100, unit: 'ppm' },
    cl:   { zh: '氯化物',   mw: 35.45, eq: 1, scale: 200, unit: 'ppm' },
    so4:  { zh: '硫酸盐',  mw: 96.06, eq: 2, scale: 400, unit: 'ppm' },
    hco3: { zh: '碳酸氢盐', mw: 61.02, eq: 1, scale: 300, unit: 'ppm' }
  };

  /* 识别顺序：多字的化学名先判，避免「硫酸钙」被当成钙、「CaCO3」被当成钙 */
  var ION_PATTERNS = [
    { k: 'hco3', re: /碳酸氢|重碳酸|bicarbonate|hco\s*3|hco₃/i },
    { k: 'so4',  re: /硫酸|sulfate|sulphate|so\s*4|so₄/i },
    { k: 'cl',   re: /氯|chloride|cl(?![a-z])/i },
    { k: 'mg',   re: /镁|magnesium|mg(?![a-z])/i },
    { k: 'na',   re: /钠|sodium|na(?![a-z])/i },
    { k: 'ca',   re: /钙|calcium|ca(?![a-z])/i }
  ];

  /* 带 g 的副本，只给"循环 exec 找全部命中"用（不带 g 会死循环，见 nearestIon） */
  var ION_GLOBAL = ION_PATTERNS.map(function (p) { return new RegExp(p.re.source, 'gi'); });

  /* 三类"不是单离子浓度"的上下文。**顺序有意义**：先碱性、再硬度、最后盐类。
     因为报告里常写「总硬度（以 CaCO₃ 计）」，如果先判 CaCO₃ 当盐名跳过，
     整条硬度信息就丢了。 */
  var ALKALINITY_RE = /碱度|alkalinity|\bkh\b/i;
  var HARDNESS_RE = /总硬度|硬度|total\s*hardness|\bgh\b/i;
  var SALT_RE = /硫酸钙|石膏|氯化钙|氯化镁|碳酸氢钠|小苏打|乳酸|磷酸|余氯|chlorine\s*residual|gypsum|calcium\s*chloride|epsom/i;

  /* 德国硬度：1 °dH = 17.848 mg/L as CaCO₃；
     CaCO₃ 当量浓度（50.04 g/eq）折成 HCO₃⁻（61.02 g/eq）= ×1.2194。
     这两个系数是本文件里唯一允许出现"经验系数"的地方，注释写明来源。 */
  var DH_TO_CACO3 = 17.848;
  var CACO3_TO_HCO3 = 61.02 / 50.04;

  function normalizeText(t) {
    var s = String(t === null || t === undefined ? '' : t);
    /* 全角数字与标点（中文报告里很常见）。**全角括号也要转**：
       「95（mg/L）」如果括号不转，单位永远匹配不上，六个离子全按"无单位"处理。 */
    s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    s = s.replace(/[：]/g, ':').replace(/[．]/g, '.').replace(/[，]/g, ',');
    s = s.replace(/[（]/g, '(').replace(/[）]/g, ')');
    return s;
  }

  /* 单位归一：报告里同一个单位有十几种写法，先收敛成 5 个内部标记 */
  function unitKey(raw) {
    var u = String(raw || '').toLowerCase().replace(/\s|·/g, '');
    if (!u) return '';
    if (/^mg\/?l$|^mg\/升$|^毫克\/升$|^ppm$/.test(u)) return 'mgl';
    if (/^mmol\/?l$|^mmol\/升$/.test(u)) return 'mmoll';
    if (/^meq\/?l$|^meq\/升$/.test(u)) return 'meql';
    if (/^°?dh$|^德国硬度$/.test(u)) return 'dh';
    return '';
  }

  /* 一行里声明的默认单位（「单位：mg/L」「(mg/L)」写在行尾时，管这一整行） */
  function declaredUnit(line) {
    var s = String(line || '');
    var m = /单位\s*[:=]?\s*(mg\s*\/?\s*l|ppm|mmol\s*\/?\s*l|meq\s*\/?\s*l|°?\s*dh)/i.exec(s);
    if (m) return unitKey(m[1]);
    m = /\(\s*(mg\s*\/?\s*l|ppm|mmol\s*\/?\s*l|meq\s*\/?\s*l|°?\s*dh)\s*\)\s*$/i.exec(s);
    if (m) return unitKey(m[1]);
    return '';
  }

  /**
   * 在这个数字**前面**的一段文字里找最近的离子名。
   * 为什么要"最近"而不是"包含"：一行里可能有多个离子（`钙 42　镁 9`），
   * 也可能有干扰词（`氯化物 Cl- 35` 里同时有「氯」和 `Cl`）。
   * 取"结束位置最靠右"的那个关键词，等于取离数字最近的那个名字，
   * 这是唯一能同时处理 `Ca 40 Mg 8` 和 `碳酸氢盐 95` 的简单规则。
   */
  function nearestIon(window) {
    var best = null, bestEnd = -1, bestRank = 99;
    for (var p = 0; p < ION_PATTERNS.length; p++) {
      /* **必须用带 g 的副本**：不带 g 的正则 exec 永远从 0 开始、永远返回同一个
         结果，lastIndex 不前进 → 死循环。原来那个死循环就是这个原因。 */
      var re = ION_GLOBAL[p];
      re.lastIndex = 0;
      var m;
      /* 同一个关键词可能在窗口里出现多次，取最后一次 */
      while ((m = re.exec(window)) !== null) {
        if (!m[0]) { re.lastIndex++; continue; }
        var end = m.index + m[0].length;
        /* 结束位置更靠右则胜出；同位置时按 ION_PATTERNS 的顺序（长名优先） */
        if (end > bestEnd || (end === bestEnd && p < bestRank)) {
          bestEnd = end; bestRank = p; best = ION_PATTERNS[p].k;
        }
      }
    }
    return best;
  }

  function toMgL(value, uk, key) {
    var meta = ION_META[key];
    if (uk === 'mmoll') return value * meta.mw;
    if (uk === 'meql') return value * (meta.mw / meta.eq);
    if (uk === 'dh') {
      /* °dH 是"以 CaCO₃ 计的硬度"，要按当量换成该离子自己的 mg/L */
      var asCaco3 = value * DH_TO_CACO3;
      return asCaco3 * (meta.mw / meta.eq) / 50.04;
    }
    /* mgl、无单位 一律按 mg/L（报告里最常见） */
    return value;
  }

  /* ======================================================================
   * 1. 解析报告
   * ----------------------------------------------------------------------
   * **全文扫描，不是按行扫**。真实报告里最常见的两种排法，按行解析都读不全：
   *   「Ca 40  Mg 8  Na 12」      一行三个离子 → 按行只能取到一个
   *   「钙 40    镁 8」两列表格    同一行两列     → 按行只能取到一个
   * 所以做法是：在整个文本里找所有「数字 + 可选单位」，再**回头看左边的窗口**
   * 找最近的离子名。这样"一列数值 + 一列数值"和"每行一个"用同一套规则。
   *
   * 单位三层优先级：数字自带的单位 > 该行声明的默认单位（`单位：mg/L`）>
   * 全文第一处声明的单位 > 按 mg/L。
   *
   * ---- unparsed 的语义（v1.2 收口时改过一次，别按老口径理解）----
   * 只装「读了但一点用都没有」的行：既不是六离子、也不是 pH / 总硬度 / 碱度、
   * 也不是「未检出」、也没声明单位。例如一句「这是一张扫描件」。
   * **不装**这四类——它们都有落点，只是不属于六离子：
   *   pH          → 返回 `pH`
   *   总硬度       → 返回 `hardness`（**不折成碱度**，见下）
   *   碱度         → 返回 `alkalinity`，并在没有实测 HCO₃ 时折成 `ions.hco3`
   *   未检出/ND/<1 → `ions[k] = 0` + `notes`，并记进 `undetected`
   * 为什么改：老口径是"这行没解析出东西"，于是 `pH 7.2` 这种**报告里最该留的数**
   * 被当成"未识别"，界面上一堆红字，用户不知道该补什么、也不知道其实已经读到了。
   *
   * @param {string} text
   * @returns {{ions:object, found:string[], unparsed:string[], notes:string[],
   *            missing:string[], missingZh:string[], message:string,
   *            pH:number|null, hardness:object|null, alkalinity:object|null,
   *            undetected:string[]}}
   *   ions 里**没出现**的键是 null（不是 0）——把"没测"当成 0 会让匹配算法
   *   以为你的水是纯水。"未检出"是 0，那是报告给的结论，两者不能混。
   *   missing 是"没认出来的离子键"，missingZh 是中文名，message 是一句人话。
   * ====================================================================*/
  WaterMatch.parseReport = function (text) {
    var src = normalizeText(text);
    var ions = { ca: null, mg: null, na: null, cl: null, so4: null, hco3: null };
    var found = [], unparsed = [], notes = [];
    var pH = null, hardness = null, alkalinity = null;
    var undetected = [], pendingUndetected = [];

    /* 行边界：用来做"该行声明的默认单位"与"这行到底用上了没有" */
    var lines = src.split(/\r?\n/);
    var lineStarts = [], lineOf = [], acc = 0;
    for (var li = 0; li < lines.length; li++) {
      lineStarts.push(acc);
      for (var c = 0; c < lines[li].length; c++) lineOf.push(li);
      lineOf.push(li);                            /* 换行符本身 */
      acc += lines[li].length + 1;
    }
    for (var la = acc; la <= src.length; la++) lineOf.push(lines.length - 1);

    var lineUnit = [], lineUsed = [];
    var globalUnit = '';
    for (var lu = 0; lu < lines.length; lu++) {
      lineUnit.push(declaredUnit(lines[lu]));
      /* 声明了单位的行本身就是"有用信息"，不该再算未识别 */
      lineUsed.push(!!lineUnit[lu]);
      if (!globalUnit && lineUnit[lu]) globalUnit = lineUnit[lu];
    }

    /* 全文所有「数字 + 可选单位」 */
    var NUM_RE = /(\d+(?:[.,]\d+)?)\s*(mg\s*\/?\s*l|mg\/升|毫克\/升|ppm|mmol\s*\/?\s*l|mmol\/升|meq\s*\/?\s*l|meq\/升|°?\s*dh|德国硬度)?/gi;
    var cands = [], mm;
    while ((mm = NUM_RE.exec(src)) !== null) {
      if (!mm[0]) { NUM_RE.lastIndex++; continue; }
      var val = parseFloat(String(mm[1]).replace(',', '.'));
      if (!isFinite(val)) continue;
      /* **跳过化学式里的下标**：SO4 的 4、HCO3 的 3、Ca2+ 的 2。
         判据是"数字前面紧挨着字母，中间没有空格"。不跳的话
         「Ca 40 Mg 8 Na 12 Cl 20 SO4 30 HCO3 60」会把 Cl 读成 4、
         把 SO4 读成 3，而且不报错——最坏的一类错。 */
      if (/[a-z]/i.test(src.charAt(mm.index - 1))) continue;
      /* 「<1 mg/L」= 低于检出限，是"未检出"的一种写法，不能读成 1 */
      var lt = /<\s*$/.test(src.slice(Math.max(0, mm.index - 4), mm.index));
      cands.push({ value: val, unit: unitKey(mm[2]), at: mm.index, lt: lt });
    }

    var seenUnparsed = {};
    function markUnparsed(lineText) {
      var t = String(lineText || '').trim();
      if (!t || seenUnparsed[t]) return;
      seenUnparsed[t] = true;
      unparsed.push(t);
    }
    /** 行里第一个出现的离子名（用于「钙 未检出」这种只有词没有数的行） */
    function firstIonIn(s) {
      var best = null, bestAt = 1e9;
      for (var p = 0; p < ION_GLOBAL.length; p++) {
        var re = ION_GLOBAL[p];
        re.lastIndex = 0;
        var m0 = re.exec(s);
        if (m0 && m0.index < bestAt) { bestAt = m0.index; best = ION_PATTERNS[p].k; }
      }
      return best;
    }

    for (var i = 0; i < cands.length; i++) {
      var cd = cands[i];
      var lineIdx = lineOf[cd.at] === undefined ? (lines.length - 1) : lineOf[cd.at];
      var winFrom = Math.max(lineStarts[lineIdx] === undefined ? 0 : lineStarts[lineIdx], cd.at - 24);
      var win = src.slice(winFrom, cd.at);
      var uk = cd.unit || lineUnit[lineIdx] || globalUnit;

      /* 上下文分类：碱性 > 硬度 > 盐类 > pH > 离子 */
      if (ALKALINITY_RE.test(win)) {
        if (!alkalinity) alkalinity = { value: cd.value, unit: uk || 'mgl', dH: uk === 'dh' };
        lineUsed[lineIdx] = true;
        continue;
      }
      if (HARDNESS_RE.test(win)) {
        var asCaco3 = (uk === 'dh') ? cd.value * DH_TO_CACO3 : cd.value;
        if (!hardness) hardness = { value: cd.value, unit: uk || 'mgl', dH: uk === 'dh', asCaCO3: U.round(asCaco3, 1) };
        notes.push('总硬度 ' + (uk === 'dh' ? cd.value + ' °dH ≈ ' : '') + U.round(asCaco3, 0) +
          ' mg/L as CaCO₃：硬度**不能**当碱度用，HCO₃⁻ 请单独填，否则目标水匹配会偏');
        lineUsed[lineIdx] = true;
        continue;
      }
      if (SALT_RE.test(win)) {
        notes.push('「' + lines[lineIdx].trim() + '」是加盐/药剂记录，不是水质数值，未计入');
        lineUsed[lineIdx] = true;
        continue;
      }
      /* pH 必须**紧贴**这个数字才算（`pH 7.4`）。用整段窗口判会把
         「pH 7.4　钙 42」里的 42 也读成 pH——那是这类解析最经典的串味。 */
      if (/(?:^|[^a-z])ph\s*[:=]?\s*$/i.test(src.slice(Math.max(0, cd.at - 10), cd.at)) ||
          /酸碱度\s*[:=]?\s*$/.test(src.slice(Math.max(0, cd.at - 10), cd.at))) {
        pH = U.round(cd.value, 2);
        lineUsed[lineIdx] = true;
        continue;
      }

      var hit = nearestIon(win);
      if (!hit) continue;               /* 温度、浊度、余量……不记 used，也不吵 */
      lineUsed[lineIdx] = true;

      if (cd.lt) {                      /* 「<1」：低于检出限，等第二轮统一按 0 处理 */
        if (pendingUndetected.indexOf(hit) < 0) pendingUndetected.push(hit);
        continue;
      }
      if (ions[hit] !== null) notes.push('「' + ION_META[hit].zh + '」出现多次，取最后一次');
      ions[hit] = U.round(toMgL(cd.value, uk, hit), 2);
      if (uk === 'mmoll') notes.push('「' + ION_META[hit].zh + '」按 mmol/L 换算为 mg/L');
      if (uk === 'meql') notes.push('「' + ION_META[hit].zh + '」按 meq/L 换算为 mg/L');
      if (uk === 'dh') notes.push('「' + ION_META[hit].zh + '」按 °dH 折算为 mg/L');
      if (found.indexOf(hit) < 0) found.push(hit);
    }

    /* 第二轮 A：碱度折 HCO₃⁻。**只在没直接读到碳酸氢盐时才算**——
       两份数据同时存在时，显式写的 HCO₃ 永远优先于折算值。 */
    if (alkalinity && ions.hco3 === null) {
      var aUk = alkalinity.unit;
      var asCaco3b = (aUk === 'dh') ? alkalinity.value * DH_TO_CACO3 : alkalinity.value;
      alkalinity.asCaCO3 = U.round(asCaco3b, 1);
      alkalinity.hco3 = U.round(asCaco3b * CACO3_TO_HCO3, 2);
      ions.hco3 = alkalinity.hco3;
      if (found.indexOf('hco3') < 0) found.push('hco3');
      notes.push('碱度 ' + alkalinity.value + (aUk === 'dh' ? ' °dH' : ' mg/L') +
        '（as CaCO₃）折合 HCO₃⁻ ' + ions.hco3 + ' mg/L；有碳酸氢盐实测值时请直接填那一项');
    }

    /* 第二轮 B：未检出。两类来源合流——行里的「未检出 / ND / n.d.」，
       与数字前面的「<」（已在上面收进 pendingUndetected）。 */
    var UNDET_RE = /未检出|未测出|低于检出限|not\s*detected|\bnd\b|n\.?\s*d\./i;
    function markUndetected(k, raw) {
      if (!k || ions[k] !== null) return;      /* 有实测值就不覆盖 */
      undetected.push(k);
      ions[k] = 0;                             /* 未检出 = 0，是报告给的结论 */
      if (found.indexOf(k) < 0) found.push(k);
      notes.push('「' + ION_META[k].zh + '」未检出（按 0 计）' + (raw ? '：' + raw : ''));
    }
    for (var pU = 0; pU < pendingUndetected.length; pU++) markUndetected(pendingUndetected[pU], '');
    for (var u = 0; u < lines.length; u++) {
      var luTxt = String(lines[u] || '').trim();
      if (!luTxt || !UNDET_RE.test(luTxt)) continue;
      var kU = firstIonIn(luTxt);
      if (!kU) continue;
      lineUsed[u] = true;
      markUndetected(kU, luTxt);
    }

    /* 第三轮：真正没用上的行。**只有这里才进 unparsed** */
    for (var ln = 0; ln < lines.length; ln++) {
      var lineTxt = String(lines[ln] || '').trim();
      if (!lineTxt) continue;
      if (lineUsed[ln]) continue;
      markUnparsed(lineTxt);
    }

    /* ---- 人话总结 ---- */
    var missing = [], missingZh = [];
    for (var mk = 0; mk < ION_KEYS.length; mk++) {
      if (ions[ION_KEYS[mk]] === null) { missing.push(ION_KEYS[mk]); missingZh.push(ION_META[ION_KEYS[mk]].zh); }
    }
    var message = '';
    if (!found.length) {
      message = '没认出任何离子。可以试试每行一个，例如「钙 40」';
    } else if (missingZh.length) {
      message = '没认出的：' + missingZh.join('、');
    } else {
      message = '六个离子都认出来了';
    }
    if (missingZh.length) notes.push(message);
    if (found.length && missingZh.length) {
      notes.push('共解析到 ' + found.length + '/6 个离子，未解析的项会让目标水匹配产生偏差，建议手工补齐');
    }

    return {
      ions: ions, found: found, unparsed: unparsed, notes: notes,
      missing: missing, missingZh: missingZh, message: message,
      pH: pH, hardness: hardness, alkalinity: alkalinity, undetected: undetected
    };
  };

  /* ======================================================================
   * 2. 匹配历史名城水型
   * ----------------------------------------------------------------------
   * 距离 = 已知离子上的加权欧氏距离（按每个离子的典型量级归一化，
   * 否则 SO4 动辄几百会单独主导结果）。
   * 只看双方都已知的离子——没测的项不参与，也不当成 0。
   * ====================================================================*/
  WaterMatch.match = function (ions, topN) {
    var pool = (BREW.DB && BREW.DB.waterProfiles) || [];
    if (!ions || !pool.length) return [];
    var limit = topN > 0 ? topN : 3;

    var out = [];
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (!p || p.id === 'wp-custom') continue;

      var sum = 0, n = 0, diff = {};
      for (var k = 0; k < ION_KEYS.length; k++) {
        var key = ION_KEYS[k];
        var mine = ions[key];
        if (mine === null || mine === undefined || !isFinite(mine)) continue;
        var theirs = U.toNum(p[key], 0);
        var d = theirs - mine;
        diff[key] = U.round(d, 1);
        sum += Math.pow(d / ION_META[key].scale, 2);
        n++;
      }
      if (!n) continue;
      out.push({
        profileId: p.id,
        name: p.name,
        conf: p.conf || '',
        distance: U.round(Math.sqrt(sum / n), 3),
        compared: n,
        diff: diff
      });
    }

    out.sort(function (a, b) { return a.distance - b.distance; });
    return out.slice(0, limit);
  };

  /* ======================================================================
   * 3. 盐类建议
   * ----------------------------------------------------------------------
   * @param {object} ions      parseReport 的 ions（也接受手工填的对象）
   * @param {string} targetId  'wt-*' 风格目标 / 'wp-*' 具体水型 / 或直接传目标离子对象
   * @param {number} volumeL   批次量（盐量的基准，因为数据是「每克每 20L」）
   * @returns {{salts:Array, residual:Array, reachable:boolean, note:string, target:object,
   *            mode:string, worst:object|null}}
   *   salts[i] = {id, name, grams, unit, volL, deltas:{ca:+12.3, so4:+140}} ——
   *   deltas 是"这克数加到 volL 升里，各离子涨多少 mg/L"，界面直接显示，不让用户自己算。
   *   worst 只在 reachable=false 时有值：差得最多（left 最大）的那一项。
   * ====================================================================*/
  WaterMatch.suggest = function (ions, targetId, volumeL) {
    ions = ions || {};
    var vol = U.toNum(volumeL, 20);
    if (!(vol > 0)) vol = 20;

    var target = null, mode = 'absolute', targetName = '';
    var salts = (BREW.DB && BREW.DB.waterSalts) || [];

    if (targetId && typeof targetId === 'object') {
      target = {};
      for (var t0 = 0; t0 < ION_KEYS.length; t0++) {
        var k0 = ION_KEYS[t0];
        target[k0] = targetId[k0] === undefined ? null : targetId[k0];
      }
      targetName = targetId.name || '自定义目标';
      mode = 'absolute';
    } else {
      var id = String(targetId || '');
      var wt = findById((BREW.DB && BREW.DB.waterTargets) || [], id);
      if (wt) {
        /* 风格目标只定义 SO4/Cl 区间：取中值，其余离子保持源水不变。
           这样不会凭空给出「该有多少钙」这种目标里根本没有的数。 */
        var so4Mid = (U.toNum(wt.so4 && wt.so4[0], 0) + U.toNum(wt.so4 && wt.so4[1], 0)) / 2;
        var clMid = (U.toNum(wt.cl && wt.cl[0], 0) + U.toNum(wt.cl && wt.cl[1], 0)) / 2;
        target = { ca: null, mg: null, na: null, cl: U.round(clMid, 1), so4: U.round(so4Mid, 1), hco3: null };
        targetName = wt.name;
        mode = 'range';
      } else {
        var wp = findById((BREW.DB && BREW.DB.waterProfiles) || [], id);
        if (wp) {
          target = {};
          for (var t1 = 0; t1 < ION_KEYS.length; t1++) target[ION_KEYS[t1]] = U.toNum(wp[ION_KEYS[t1]], 0);
          targetName = wp.name;
          mode = 'absolute';
        }
      }
    }

    if (!target) {
      return {
        salts: [], residual: [], reachable: false, mode: 'none', target: null, worst: null,
        note: '没有找到目标水型。传入 waterTargets / waterProfiles 的 id，或直接传一个离子对象'
      };
    }

    /* 当前离子：没测的按 0 处理但记下来，结论里要说清 */
    var cur = {};
    var unknown = [];
    for (var i = 0; i < ION_KEYS.length; i++) {
      var k = ION_KEYS[i];
      var v = ions[k];
      if (v === null || v === undefined || !isFinite(v)) { unknown.push(k); cur[k] = 0; }
      else cur[k] = U.toNum(v, 0);
    }

    /* 只用「只影响目标离子、不明显改碱度」的盐。
       小苏打/碳酸钙/乳酸是调 pH 的，和"匹配水型"是两件事，混在一起会互相打架。 */
    var CANDIDATES = ['w-gypsum', 'w-cacl2', 'w-epsom', 'w-nacl', 'w-mgcl2'];
    var PREF = { 'w-gypsum': 0, 'w-cacl2': 1, 'w-epsom': 2, 'w-nacl': 3, 'w-mgcl2': 4 };
    var CAP = { ca: 200, mg: 40, na: 100, cl: 250, so4: 400 };
    var pool = [];
    for (var c = 0; c < CANDIDATES.length; c++) {
      var salt = findById(salts, CANDIDATES[c]);
      if (salt && salt.ion) pool.push(salt);
    }

    var used = {};
    var plan = [];
    var MAX_SALTS = 3;

    for (var round = 0; round < MAX_SALTS; round++) {
      /* 找当前最缺的离子（按典型量级归一化） */
      var pickKey = null, pickScore = 0;
      for (var q = 0; q < ION_KEYS.length; q++) {
        var kk = ION_KEYS[q];
        if (target[kk] === null || target[kk] === undefined) continue;
        var need = U.toNum(target[kk], 0) - cur[kk];
        var score = need / ION_META[kk].scale;
        if (score > pickScore && need > 10) { pickScore = score; pickKey = kk; }
      }
      if (!pickKey) break;

      var bestSalt = null, bestGrams = 0, bestScore = Infinity;
      for (var s = 0; s < pool.length; s++) {
        var cand = pool[s];
        if (used[cand.id]) continue;
        var perG = U.toNum(cand.ion[pickKey], 0);
        if (perG <= 0) continue;

        var needMgL = U.toNum(target[pickKey], 0) - cur[pickKey];
        /* 数据是「每克每 20L」：δ(mg/L) = g × ion × 20 / V */
        var grams = needMgL * vol / (20 * perG);

        /* 用其它离子的上限截断：宁可不达标，也不能把某一项顶爆 */
        for (var k2 = 0; k2 < ION_KEYS.length; k2++) {
          var kk2 = ION_KEYS[k2];
          var per2 = U.toNum(cand.ion[kk2], 0);
          if (per2 <= 0) continue;
          if (CAP[kk2] === undefined) continue;
          var headroom = CAP[kk2] - cur[kk2];
          if (headroom <= 0) { grams = 0; break; }
          var maxG = headroom * vol / (20 * per2);
          if (maxG < grams) grams = maxG;
        }
        if (grams > 60) grams = 60;                   /* 单种盐一次别超过 60g，超过多半是目标水不现实 */
        if (grams <= 0) continue;

        /* 选盐不能只看"要加多少克"——那样会选中含量低的盐，因为它要加更多。
           判据：① 常规优先级（石膏 > 氯化钙 > 泻盐 > 食盐 > 氯化镁）——
           这是家酿的通行习惯，不是数学结果；② 副作用：把"目标里真有的离子"
           顶过头的程度；③ 用量越小越好（只是微调项）。
           注：目标里没有的离子（风格目标只给 SO4/Cl）不计副作用——
           否则会因为"钙快到上限"而推荐往 IPA 里加食盐，那是错的。 */
        var waste = 0;
        for (var w2 = 0; w2 < ION_KEYS.length; w2++) {
          var kw = ION_KEYS[w2];
          if (kw === pickKey) continue;
          if (target[kw] === null || target[kw] === undefined) continue;
          var perW = U.toNum(cand.ion[kw], 0);
          if (perW <= 0) continue;
          var capW = CAP[kw] === undefined ? 1e9 : CAP[kw];
          var roomW = Math.max(1, capW - cur[kw]);
          waste += (perW * grams) / roomW;
        }
        var score = (PREF[cand.id] === undefined ? 9 : PREF[cand.id]) + waste * 10 + grams * 0.01;

        if (score < bestScore) { bestScore = score; bestGrams = grams; bestSalt = cand; }
      }

      if (!bestSalt || bestGrams < 0.3) break;

      used[bestSalt.id] = true;
      /* 每种盐"加到 V 升里会让各离子涨多少"——界面要直接显示这一列，
         不能只给克数让用户自己算。只列真会动的离子（perG > 0）。 */
      var deltas = {};
      for (var dk = 0; dk < ION_KEYS.length; dk++) {
        var kd = ION_KEYS[dk];
        var perD = U.toNum(bestSalt.ion[kd], 0);
        if (perD > 0) deltas[kd] = U.round(perD * bestGrams * 20 / vol, 1);
      }
      plan.push({
        id: bestSalt.id, name: bestSalt.name, grams: U.round(bestGrams, 1),
        unit: bestSalt.unit || 'g', volL: vol, deltas: deltas
      });
      for (var a = 0; a < ION_KEYS.length; a++) {
        var ka = ION_KEYS[a];
        cur[ka] += U.toNum(bestSalt.ion[ka], 0) * bestGrams * 20 / vol;
      }
    }

    /* ---- 残差 ---- */
    var residual = [];
    var allOk = true;
    var worst = null, worstAbs = null;
    for (var r = 0; r < ION_KEYS.length; r++) {
      var kr = ION_KEYS[r];
      if (target[kr] === null || target[kr] === undefined) continue;
      var left = U.toNum(target[kr], 0) - cur[kr];
      var item = {
        ion: kr,
        label: ION_META[kr].zh,
        target: U.round(target[kr], 1),
        got: U.round(cur[kr], 1),
        left: U.round(left, 1)
      };
      residual.push(item);
      if (Math.abs(left) > 10) allOk = false;
      /* 差得最多的是谁。**两个方向都要能说**：
         left > 0 = 还差这么多（加盐能补）；
         left < 0 = 已经超了（加盐只会更超，只能兑 RO 水稀释）。
         只报"还差"会把"源水 SO4 已经 600、目标 250"说成"没有差距"——
         那是最误导的一种沉默。 */
      if (!worstAbs || Math.abs(left) > Math.abs(worstAbs.left)) {
        worstAbs = { ion: kr, label: ION_META[kr].zh, left: U.round(left, 1), over: left < 0,
                     target: U.round(target[kr], 1), got: U.round(cur[kr], 1) };
      }
    }
    /* 只在不可达时给：可达的时候"差 3 ppm"是噪声，不该占版面 */
    worst = allOk ? null : worstAbs;

    /* ---- 说明 ---- */
    var notes = [];
    if (mode === 'range') {
      notes.push('「' + targetName + '」只给出 SO4 与 Cl 的目标区间，这里取区间中值；' +
        '钙、镁、钠、碱度保持你的源水不变。糖化 pH 请单独用乳酸/磷酸调，不要靠加盐去凑');
    }
    if (!allOk) {
      notes.push('加盐到不了目标：最多只给 3 种盐，且每种都受离子上限约束。' +
        '差得多的离子（例如源水 SO4 已经 400 还要往 600 走）只能靠兑 RO 水稀释后再加盐');
    }
    if (unknown.length) {
      notes.push('源水里 ' + unknown.map(function (k) { return ION_META[k].zh; }).join('、') +
        ' 没有数值，按 0 参与计算——结论会偏，先补齐水质报告');
    }
    notes.push('盐量按 ' + vol + ' L 批次计算。数据口径是"每克盐加入 20L 水后的 mg/L 增量"，已按批次量缩放');

    return {
      salts: plan,
      residual: residual,
      reachable: allOk,
      /* 界面必须原样显示这句。不可达时如果只给方案不标注，用户会以为
         "按这个加完就到了目标水"——那是这个功能最容易造成的实质错误。 */
      headline: allOk
        ? '按以下加盐可达到目标水'
        : '目标水质超出加盐可达范围（需兑 RO 水或换水源），以下是朝该方向能做的最大调整',
      note: notes.join('；'),
      target: target,
      targetName: targetName,
      mode: mode,
      volumeL: vol,
      usedCount: plan.length,
      /* 不可达时"差得最多的是谁"（residual 里 left 最大的那项），可达时为 null。
         界面用它拼那句「这组离子用这几种盐调不到，差得最多的是 X（还差 N ppm）」。 */
      worst: worst
    };
  };

  function findById(list, id) {
    if (!id || !list) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  /* ======================================================================
   * 4. 反向查询：从"我的水"推到"能酿什么酒"（v1.4）
   * ----------------------------------------------------------------------
   * 正推是「水质报告 → 匹配水型 → 建议加盐」。家酿真实的第一问是反的：
   *   「我这儿的水能做什么酒」——先有水源，才谈得上选风格。
   *
   * ---- 数据边界（先划清，否则下面每一步都可能被误读成"算出来的结论"）----
   * BREW.DB.styles 的字段只有 {id,name,en,cat,group,og,fg,abv,ibu,srm,
   * overall,key,fault,ex}——**没有任何水质离子区间**。所以"按风格的水质
   * 区间给风格打分"这件事，靠现有数据做不到；硬做只能靠编数字。
   * 于是这里把两件事分开：
   *   ① 相似度 fitPercent 只对水型(waterProfiles)算 —— 那边是真有六个离子值，
   *      可以算距离；
   *   ② 风格推荐来自下面这张**显式映射表** PROFILE_STYLE_HINTS ——
   *      产区水型与代表风格的常识性对应，不是打分算出来的。
   * 任何"风格水质评分"都不许出现，因为那没有数据支撑。
   *
   * @param {object} ions  {ca,mg,na,cl,so4,hco3}，缺项用 null / undefined（不是 0）
   * @param {object} [opts] {volumeL:加盐建议的批次量, adjustTarget:'wp-*' 指定的调整目标}
   * @returns {{nearest:Array, recommended:Array, adjust:object|null,
   *            filled:string[], missing:string[], message:string, note:string,
   *            caveat:string, ions:object, comparedAll:number}}
   * ====================================================================*/

  /* ---- 4.1 归一化尺度 ----
   * 距离用**相对差**：d_k = (水型值 − 我的值) / (|水型值| + ION_FLOOR[k])，
   * 再取六个离子的均方根（RMS）。三项都要交代：
   *
   * ① 为什么不用固定尺度（suggest 里那套 ION_META.scale）：
   *    SO4 在这 12 个水型里跨 5–610，HCO₃ 跨 0–320，Ca 跨 0–275。固定尺度下
   *    「伯顿 SO4 差 200」与「都柏林 HCO₃ 差 20」谁更重要完全由分母决定——
   *    Ca 的量级会把 HCO₃ 压死，用户看到"最像慕尼黑"却不知道自己差在碱度上。
   * ② 为什么也不是单纯"除以水型值"：
   *    皮尔森的 SO4 只有 5。任何 SO4=40 的水（很普通）按 35/5 算就是 700%，
   *    于是"有一点硫酸盐的水"全部被推离皮尔森，方向反了。
   * ③ 所以分母 = 水型值 + 地板量。地板量取 12 个水型该离子中位量级的一半左右，
   *    含义是"这个离子到这个浓度才算有意义"：
   *      ca 中位 ~82 → 40、mg 中位 ~21 → 10、hco3 中位 ~135 → 70、so4 → 60、cl → 40。
   *      na 特意取大（25）：钠对风味的权重明显低于 Ca/Mg/SO4/Cl（100 以上才有咸味），
   *      地板给小了会让"钠差 20"跟"硫酸盐差 200"同权。
   *    这些数字是**写死的经验参数**，不是拟合出来的；换一套地板会改变百分数，
   *    但实测三组水（软水 / 均衡 / 伯顿型）的排序不变。 */
  var ION_FLOOR = { ca: 40, mg: 10, na: 25, cl: 40, so4: 60, hco3: 70 };

  /* ---- 4.2 相似度口径 ----
   * fitPercent = 100 / (1 + d)，d 是上面的 RMS 归一化距离。
   *   d=0 → 100（离子一项不差）；d=0.35 → 74；d=1.0（各离子平均差一个量级）→ 50；
   *   d=2 → 33。单调、有界、不需要人为设上限。
   * ⚠️ 这是**相对相似度**，不是"水质达标率/饮用安全评分"。没有哪个国标可以用
   *    来给"你的水 92 分"下结论，所以界面文案必须写"相对相似度/像不像"，
   *    不许写成"匹配度 92%"这种像验收结论的说法。 */
  function fitOf(distance) {
    var d = distance < 0 ? 0 : distance;
    return U.round(100 / (1 + d), 0);
  }

  var FIT_CAVEAT = '相似度 = 100 / (1 + 归一化距离)，只表示"你的水与这套产区水型有多像"，' +
    '不是水质达标率、不是饮用安全评分，也不能读成"我的水 XX 分"。' +
    '它只用你填了的离子参与比较：缺项越多，这个百分数越不可靠。';

  /* ---- 4.3 水型 ↔ 代表风格映射表（v1.4 新增，12 个水型全覆盖）----
   * 产区水型与代表风格的对应，是常识性对应，不是计算出来的；风格里没有水质
   * 区间数据，所以这里不做数值打分。每条的 id 必须是 BREW.DB.styles 里真实存在
   * 的风格编号（写完用 grep 校验过；悬空 id 会让界面点出一个空白条目）。
   * 顺序有意义：同一水型下**最有代表性**的风格写在前（推荐列表按这个顺序出）。
   * why 是给用户看的一句话，必须说清"为什么这水配这酒"，不许只给"很搭"。 */
  var PROFILE_STYLE_HINTS = {
    'wp-ro': {
      note: '零矿物起点：水本身不给任何风味，靠加盐走到目标',
      styles: [
        { id: '1A', why: '零矿物质起点做淡爽拉格最稳：这种酒任何矿物杂味都藏不住，而纯水本来就没有' },
        { id: '1C', why: '干净底水让你能精确加盐，把奶油艾尔的麦芽甜与轻微果酯调到你想的位置' },
        { id: '23A', why: '柏林白啤要的就是极低矿化，纯水不会跟乳酸菌发酵的酸爽打架' }
      ]
    },
    'wp-pilsen': {
      note: '极软、低碱：浅色酒的颜色与酒花清晰度的来源',
      styles: [
        { id: '3B', why: '极软低碱的水让皮尔森的麦芽干净、萨兹酒花锐利，颜色也不会被碱度拉深' },
        { id: '3A', why: '同一套软水骨架，酒体更轻、更易饮，是捷克淡色拉格的原生水质' },
        { id: '23A', why: '低矿化是柏林白啤的前提，稍有碱度就会把它的酸爽压钝' }
      ]
    },
    'wp-munich': {
      note: '中等硬度、碱度偏高：深色拉格的舒适区，浅色酒要先降碱',
      styles: [
        { id: '8B', why: '碱度能中和烘烤麦芽的酸，黑啤的焦香才不尖酸，同时钙把酒体托住' },
        { id: '4A', why: '钙与麦芽感正合适；但碱度 150 偏高，做浅色清亮啤酒要先煮沸或加乳酸降碱' },
        { id: '6A', why: '三月啤酒的麦芽厚度需要中等硬水撑住，纯软水会让它显得单薄' }
      ]
    },
    'wp-vienna': {
      note: '硬水：琥珀色与饱满麦芽感的直接来源',
      styles: [
        { id: '7A', why: '维也纳拉格的琥珀色与饱满麦芽感，正是这套硬水（Ca 200）撑起来的' },
        { id: '6A', why: '硬水骨架配三月啤酒的麦芽甜与烘烤尾韵，酒体不容易塌' },
        { id: '4B', why: '钙与硫酸盐把三月节啤酒的"饼干感"推得更清楚，收口也更利落' }
      ]
    },
    'wp-dortmund': {
      note: '高硫酸盐硬水：干爽收口、苦味干净',
      styles: [
        { id: '5C', why: '多特蒙德型高硫酸盐硬水就是德式出口啤酒的原始水质，苦味干爽、收口干净' },
        { id: '5D', why: '硫酸盐偏高会让德式皮尔森比捷克版更"干"——这正是两个皮尔森最典型的差别' },
        { id: '8B', why: '硬水做黑啤，碱度压得住烘烤麦芽的酸，同时收口利落不粘' }
      ]
    },
    'wp-burton': {
      note: '硫酸盐极高（SO₄ 600+）：把苦味推得干脆、锐利',
      styles: [
        { id: '12C', why: '硫酸盐 600+ 正是英式 IPA 干爽锐利苦味的来源，伯顿水最著名的用法就是这个' },
        { id: '11B', why: '优质苦啤要苦味清晰但不尖锐：高硫酸盐把苦感推到前段，收口干净' },
        { id: '17D', why: '英式大麦酒的酒精与麦芽甜很厚，需要高硫酸盐把收口拉干，否则会腻' }
      ]
    },
    'wp-london': {
      note: '碱度偏高的中硬水：深色麦芽中和碱度之后正好',
      styles: [
        { id: '13C', why: '伦敦碱度偏高，波特里的烘烤麦芽酸正好中和它，酒体圆润而不涩' },
        { id: '15B', why: '世涛用烘烤大麦的酸去对水的碱，深色酒在碱性水里比在纯水里更好喝' },
        { id: '20A', why: '美式波特的巧克力与焦糖感需要一点碱度托着，纯软水会让它发薄' }
      ]
    },
    'wp-dublin': {
      note: '高碱度（HCO₃ 320）：只能靠大量烘烤麦芽的酸来平衡',
      styles: [
        { id: '15B', why: '都柏林的高碱水就是爱尔兰世涛的成因：必须用大量烘烤大麦的酸去中和它' },
        { id: '16A', why: '甜世涛有乳糖的甜兜底，碱度带来的圆润反而衬得出可可与焦糖' },
        { id: '20B', why: '美式世涛烘烤度够高，能吃掉碱度，同时留住厚实的酒体' }
      ]
    },
    'wp-edinburgh': {
      note: '中高矿化度的苏格兰水：适合浓厚的麦芽型艾尔',
      styles: [
        { id: '17C', why: '苏格兰重艾靠麦芽甜与焦糖厚度取胜，中高矿化的水能把这份厚度撑起来' },
        { id: '17D', why: '英式大麦酒要"厚而不腻"，爱丁堡的中高矿化度正好压住甜感' },
        { id: '15A', why: '爱尔兰红艾的焦糖尾韵在中高矿化水里更清楚，不会被软水冲淡' }
      ]
    },
    'wp-seattle': {
      note: '极软、低矿：干净但没有任何风味推力',
      styles: [
        { id: '1D', why: '极软水不会把美式小麦啤的柔和口感压成矿物味，小麦的甜最干净' },
        { id: '18A', why: '金发艾尔只有麦芽与一点点酒花，软水让这份干净不被矿物味干扰' },
        { id: '5B', why: '科隆啤酒用软水，发酵的果香与酒花的清亮感才立得住' }
      ]
    },
    'wp-shanghai': {
      note: '中等矿化、各项都不极端：中性底水，什么风格都能起步',
      styles: [
        { id: '18A', why: '钙 40 / 硫酸盐 40 都不极端，做金发艾尔不用调水就能落在平衡点上' },
        { id: '5B', why: '科隆啤酒要的中性偏软底水，上海这组数只差一点，直接酿也不会跑偏' },
        { id: '24A', why: '比利时小麦白啤靠酵母的酚香与橙皮香菜籽，中性的水刚好不抢戏' }
      ]
    },
    /* wp-custom 在数据里是全 0 的占位（"用我的报告"的入口），match() 本来就跳过它，
       这里同样不给风格推荐——否则"全 0 的自定义水型"会拿走一大票 soft water 推荐，
       而那套数值根本不是任何真实水源。表里保留这一行是为了 12 个水型全覆盖可核查。 */
    'wp-custom': {
      note: '占位水型（六离子全 0），不参与推荐：它是"填我的报告"的入口，不是一套真实水源',
      styles: []
    }
  };

  /* 让映射表可被外部核查/测试引用（audit-data、node 直调都靠它） */
  WaterMatch.PROFILE_STYLE_HINTS = PROFILE_STYLE_HINTS;
  WaterMatch.ION_FLOOR = ION_FLOOR;

  /** 单个水型的归一化距离。返回 null = 没有一个可比离子（不该入榜） */
  function profileDistance(ions, p) {
    var sum = 0, n = 0, parts = {};
    for (var k = 0; k < ION_KEYS.length; k++) {
      var key = ION_KEYS[k];
      var mine = ions[key];
      if (mine === null || mine === undefined || !isFinite(mine)) continue;
      var theirs = U.toNum(p[key], 0);
      var denom = Math.abs(theirs) + ION_FLOOR[key];
      var d = (theirs - mine) / denom;
      parts[key] = { mine: U.round(mine, 1), theirs: U.round(theirs, 1), rel: U.round(d, 2) };
      sum += d * d;
      n++;
    }
    if (!n) return null;
    return { distance: Math.sqrt(sum / n), compared: n, parts: parts };
  }

  WaterMatch.reverseLookup = function (ions, opts) {
    opts = opts || {};
    ions = ions || {};
    var pool = (BREW.DB && BREW.DB.waterProfiles) || [];
    var styles = (BREW.DB && BREW.DB.styles) || [];

    var out = {
      nearest: [], recommended: [], adjust: null,
      filled: [], missing: [], message: '', note: '', caveat: FIT_CAVEAT,
      ions: {}, comparedAll: 0
    };
    for (var k0 = 0; k0 < ION_KEYS.length; k0++) {
      var key0 = ION_KEYS[k0];
      var v0 = ions[key0];
      var known = (v0 !== null && v0 !== undefined && isFinite(v0));
      out.ions[key0] = known ? U.round(U.toNum(v0, 0), 1) : null;
      if (known) out.filled.push(key0); else out.missing.push(key0);
    }

    /* ---- 空输入：绝不"算一堆 0" ----
     * 六项全空时任何水型都能"最像"（全按 0 比，结果就是纯水），算出来没有意义。
     * 这里直接返回提示，而不是给一个看起来像结论的结果。 */
    if (!out.filled.length) {
      out.message = '先填至少 Ca / Mg / SO₄ / Cl 四项——六个框全空时，任何水型都能"最像"，' +
        '算出来只是"纯水最像纯水"，对你的选酒没有帮助。';
      return out;
    }
    out.comparedAll = out.filled.length;
    if (out.filled.length < 4) {
      out.note = '只填了 ' + out.filled.length + ' 项（' + out.filled.map(function (x) {
        return ION_META[x].zh;
      }).join('、') + '）。缺的项不参与比较，所以下面的相似度会偏高、排序也可能变——' +
        '至少补齐 Ca / Mg / SO₄ / Cl 四项再看结论。';
    }

    /* ---- 4.4 排距离 ---- */
    var ranked = [];
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (!p || p.id === 'wp-custom') continue;      /* 与 match() 同口径：自定义是全 0 占位 */
      var r = profileDistance(out.ions, p);
      if (!r) continue;
      ranked.push({ p: p, distance: r.distance, compared: r.compared });
    }
    ranked.sort(function (a, b) { return a.distance - b.distance; });
    if (!ranked.length) {
      out.message = '水型库里没有可比较的数据（BREW.DB.waterProfiles 为空）。';
      return out;
    }

    for (var j = 0; j < ranked.length && out.nearest.length < 3; j++) {
      var rp = ranked[j], pp = rp.p;
      var ionsCopy = {};
      for (var ik = 0; ik < ION_KEYS.length; ik++) {
        var kk = ION_KEYS[ik];
        ionsCopy[kk] = U.round(U.toNum(pp[kk], 0), 1);
      }
      out.nearest.push({
        id: pp.id,                                  /* = waterProfiles 的 id（match() 里叫 profileId） */
        name: pp.name,
        en: pp.en || '',
        distance: U.round(rp.distance, 3),
        fitPercent: fitOf(rp.distance),
        ions: ionsCopy,
        desc: pp.desc || '',
        conf: pp.conf || '',
        compared: rp.compared
      });
    }

    /* ---- 4.5 推荐风格 ----
     * 从最近的水型往外取，每个水型按映射表顺序出 2–4 个风格。
     * 停止条件：凑够 8 个就停（任务要求的下限），硬上限 12 个。
     * **为什么凑够 8 就停、而不是填满 12**：往外多取一个水型，就等于把一套
     * 和你差得更多的水的代表风格塞进来——软水（皮尔森/西雅图/RO 都在 90%+）
     * 再往外取就是慕尼黑，于是"软水也能做黑啤"这种推不出来的结论就出现了。
     * 宁少不多：少的那几个用户自己也能想到，多出来的那些是错的。 */
    var MIN_REC = 8, MAX_REC = 12, MAX_PROFILES = 6;
    var seenStyle = {}, dangling = [], visited = 0;
    for (var q = 0; q < ranked.length && visited < MAX_PROFILES; q++) {
      if (out.recommended.length >= MIN_REC) break;
      var rq = ranked[q];
      var hint = PROFILE_STYLE_HINTS[rq.p.id];
      visited++;
      if (!hint || !Array.isArray(hint.styles) || !hint.styles.length) continue;
      for (var si = 0; si < hint.styles.length && out.recommended.length < MAX_REC; si++) {
        var hr = hint.styles[si];
        if (!hr || !hr.id || seenStyle[hr.id]) continue;
        var st = findById(styles, hr.id);
        /* 悬空 id 绝不渲染：界面上点出一个空条目比少一条推荐糟得多 */
        if (!st) { if (dangling.indexOf(hr.id) < 0) dangling.push(hr.id); continue; }
        seenStyle[hr.id] = true;
        out.recommended.push({
          styleId: hr.id,
          nameZh: st.name || hr.id,
          styleEn: st.en || '',
          cat: st.cat || '',
          profileId: rq.p.id,
          profileName: rq.p.name,
          fitPercent: fitOf(rq.distance),
          why: hr.why || ''
        });
      }
    }
    if (out.recommended.length < MIN_REC) {
      out.note = (out.note ? out.note + ' ' : '') +
        '可推荐的风格只有 ' + out.recommended.length + ' 个（映射表覆盖不足），' +
        '不是"只有这些能做"，而是这些是目前能说清理由的。';
    }
    if (dangling.length) {
      out.note = (out.note ? out.note + ' ' : '') +
        'PROFILE_STYLE_HINTS 里有风格编号在 BREW.DB.styles 中不存在（' + dangling.join('、') + '），已跳过';
    }

    /* ---- 4.6 调整建议（复用 suggest）----
     * 默认目标：**第一套"和你确实不一样"的水型**（距离 ≥ 0.12，约等于相似度 ≤ 89%）。
     * 为什么不直接用最近的那个：最近的那个就是你自己，拿它当目标算出来的盐量永远是 0，
     * 于是"想更接近 X 需要加石膏 3.2 g"这句根本不会出现（42-ui-recipe 的水质面板
     * 已经踩过这个坑，那里也是把「自动 = 最接近的水型」标成"通常不需要加盐"）。
     *
     * 三层口径，逐层退化，**每一层都写明自己在做什么**：
     *   ① full  ：六离子全对齐（suggest 的默认能力）——最好，但钙/碱度这一档
     *              经常"加了盐反而把别的离子顶爆"，于是会有方案为空的情况；
     *   ② knobs ：只对齐 SO₄/Cl 这两个真正由加盐控制的风味旋钮（石膏/氯化钙/
     *              食盐能精确调的就是它们）——家酿实际调水也主要调这两个；
     *   ③ none  ：连 SO₄/Cl 都不用动，直接说"你已经在目标上/加盐只会更远"，
     *              并点出差得最多的是哪个离子、那个方向要靠什么手段。
     * 只给"方向"不给克数是不合格的；给不出克数时，必须说清为什么给不出。 */
    var vol = U.toNum(opts.volumeL, 20);
    if (!(vol > 0)) vol = 20;
    var ADJUST_MIN = 0.12;

    function safeSuggest(ionSrc, target, v) {
      if (typeof WaterMatch.suggest !== 'function') return null;
      try { return WaterMatch.suggest(ionSrc, target, v) || null; } catch (e) { return null; }
    }
    function copySalts(list) {
      var arr = [];
      for (var i2 = 0; i2 < (list || []).length; i2++) {
        var s3 = list[i2];
        arr.push({
          id: s3.id, name: s3.name, grams: s3.grams, unit: s3.unit || 'g',
          volL: s3.volL, deltas: s3.deltas
        });
      }
      return arr;
    }
    function gramsText(arr) {
      var bits = [];
      for (var i3 = 0; i3 < arr.length; i3++) {
        bits.push(arr[i3].name + ' ' + U.round(arr[i3].grams, 1) + ' ' + arr[i3].unit);
      }
      return bits.join(' + ');
    }
    /* 每个离子"要动它该用什么手段"——给不出克数时，这句话就是用户下一步 */
    var ION_FIX = {
      ca: '加石膏或氯化钙', mg: '加泻盐或氯化镁', na: '加食盐（或兑 RO 水稀释）',
      cl: '加氯化钙或食盐', so4: '加石膏或泻盐',
      hco3: '小苏打/碳酸钙提碱度，或兑 RO 水稀释降碱'
    };

    var tgt = null, tgtRank = null, auto = true, chosenSug = null;
    if (opts.adjustTarget) {
      var want = findById(pool, String(opts.adjustTarget));
      if (want && want.id !== 'wp-custom') {
        tgt = want; auto = false;
        for (var w1 = 0; w1 < ranked.length; w1++) if (ranked[w1].p.id === want.id) tgtRank = ranked[w1];
      }
    }
    if (!tgt) {
      /* 候选：明显不同的水型（近到远）。一个都没有（你的水本身就是某个水型）时，
         退回最近的那个，后面会明说"你已经在它上面"。 */
      var cands = [];
      for (var c1 = 0; c1 < ranked.length; c1++) {
        if (ranked[c1].distance >= ADJUST_MIN) cands.push(ranked[c1]);
      }
      if (!cands.length) cands = [ranked[0]];
      /* 优先选"加盐真有得加"的那套（最多试前 3 个）：
         否则会挑到一套碱度差 130 的水型，方案为空，界面上只剩一句"不用加盐"，
         而用户真正想要的是"那我该加什么"。 */
      var chosen = null;
      for (var c2 = 0; c2 < cands.length && c2 < 3; c2++) {
        var trySug = safeSuggest(out.ions, cands[c2].p.id, vol);
        if (!chosen) chosen = { r: cands[c2], sug: trySug };
        if (trySug && trySug.salts && trySug.salts.length) { chosen = { r: cands[c2], sug: trySug }; break; }
      }
      tgt = chosen.r.p;
      tgtRank = chosen.r;
      chosenSug = chosen.sug;      /* 挑候选时已经算过一次，别为同一套水型再跑一遍 */
    }

    if (tgt) {
      var full = chosenSug || safeSuggest(out.ions, tgt.id, vol);
      var tDist = tgtRank ? tgtRank.distance : 0;
      if (!tDist) {
        for (var a2 = 0; a2 < ranked.length; a2++) if (ranked[a2].p.id === tgt.id) tDist = ranked[a2].distance;
      }
      var tFit = fitOf(tDist);

      var salts = full ? copySalts(full.salts) : [];
      var basis = salts.length ? 'full' : 'none';
      var knob = null;
      if (!salts.length) {
        knob = safeSuggest(out.ions, {
          name: tgt.name + '（只对齐 SO₄/Cl）',
          ca: null, mg: null, na: null, so4: U.toNum(tgt.so4, 0), cl: U.toNum(tgt.cl, 0), hco3: null
        }, vol);
        if (knob) { salts = copySalts(knob.salts); if (salts.length) basis = 'knobs'; }
      }

      var worst = (full && full.worst) || null;
      var note;
      if (basis === 'full') {
        note = '想更接近「' + tgt.name + '」（现在像 ' + tFit + '%）：加 ' + gramsText(salts) +
          '，按 ' + vol + ' L 批次计。';
        if (full && full.reachable === false && worst) {
          note += '只能做到这一步：' + worst.label +
            (worst.over ? '会超出 ' + Math.abs(worst.left) + ' ppm' : '还差 ' + Math.abs(worst.left) + ' ppm') +
            '——这个方向加盐补不上，只能靠兑 RO 水稀释。';
        }
      } else if (basis === 'knobs') {
        note = '想更接近「' + tgt.name + '」的风味取向（SO₄/Cl 这两个旋钮）：加 ' + gramsText(salts) +
          '，按 ' + vol + ' L 批次计。六离子全对齐做不到，这里的方案只动硫酸盐与氯化物。';
        if (worst) {
          note += '钙/碱度那一档的差距（' + worst.label +
            (worst.over ? ' 超出 ' + Math.abs(worst.left) : ' 还差 ' + Math.abs(worst.left)) +
            ' ppm）要用' + (ION_FIX[worst.ion] || '别的手段') + '，不在加盐方案里。';
        }
      } else {
        /* 连 SO₄/Cl 都不用动：要么你已经在目标上，要么加盐只会更远 */
        var mySo4 = U.round(U.toNum(out.ions.so4, 0), 0);
        var myCl = U.round(U.toNum(out.ions.cl, 0), 0);
        var near = tDist < ADJUST_MIN;
        note = '目标「' + tgt.name + '」的 SO₄/Cl 是 ' + U.toNum(tgt.so4, 0) + ' / ' + U.toNum(tgt.cl, 0) +
          '，你现在是 ' + mySo4 + ' / ' + myCl + '：加盐只会把它推得更远，所以这里不给克数。';
        if (near) {
          note += '你的水本来就很接近它（像 ' + tFit + '%），不需要调。';
        } else if (worst) {
          note += '真正的差距在' + worst.label + '（' +
            (worst.over ? '超出 ' + Math.abs(worst.left) : '还差 ' + Math.abs(worst.left)) +
            ' ppm），要靠' + (ION_FIX[worst.ion] || '别的手段') + '。';
        }
      }

      out.adjust = {
        profileId: tgt.id,
        profileName: tgt.name,
        auto: auto,                     /* true = 算法替你挑的（第一套明显不同的水型） */
        fitPercent: tFit,
        basis: basis,                   /* full / knobs / none：方案覆盖到哪一层 */
        salts: salts,
        note: note,
        detail: (full && full.note) || '',
        reachable: !!(full && full.reachable !== false),
        worst: worst,
        volumeL: vol
      };
    }

    out.message = '最像的是「' + out.nearest[0].name + '」（相对相似度 ' +
      out.nearest[0].fitPercent + '%），推荐 ' + out.recommended.length + ' 个风格';
    return out;
  };

  /* ======================================================================
   * 自检
   * ====================================================================*/
  WaterMatch.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    /* 1. 文本解析：三种单位混排 */
    var text = [
      'pH 7.4',
      '钙 Ca2+ 40 mg/L',
      '镁 Mg 8 ppm',
      '钠 30',
      '氯化物 Cl- 35 mg/L',
      '硫酸盐 SO4 40 mg/L',
      '碳酸氢盐 HCO3 90 mg/L'
    ].join('\n');
    var p1 = WaterMatch.parseReport(text);
    ok('解析到 6 个离子', p1.found.length === 6, p1.found.join(','));
    ok('钙 = 40', p1.ions.ca === 40, String(p1.ions.ca));
    ok('无单位的钠按 mg/L = 30', p1.ions.na === 30, String(p1.ions.na));

    /* 2. mmol/L 与 meq/L 换算 */
    var p2 = WaterMatch.parseReport('Ca 1 mmol/L\nSO4 2 meq/L');
    ok('1 mmol/L 钙 = 40.08', Math.abs(p2.ions.ca - 40.08) < 0.05, String(p2.ions.ca));
    ok('2 meq/L 硫酸根 = 96.06', Math.abs(p2.ions.so4 - 96.06) < 0.05, String(p2.ions.so4));

    /* 3. 四类"读到了但不属于六离子"的东西，各有落点；unparsed 只装真正没用的行。
       这条曾经是 `unparsed.length >= 2`——那个口径把 pH 和碱度都算"未识别"，
       等于把"我们丢了两个信息"当成正常。v1.2 收口改成按落点分类。 */
    var p3 = WaterMatch.parseReport('这是一份扫描件\n钙 未检出\npH 7.2\n碱度 120 mg/L\n硬度 200');
    ok('乱文本不抛', !!p3 && Array.isArray(p3.unparsed));
    ok('unparsed 只剩真正没用上的那行', p3.unparsed.length === 1 && /扫描件/.test(p3.unparsed[0]),
      JSON.stringify(p3.unparsed));
    ok('pH 有独立字段（不再算未识别）', p3.pH === 7.2, String(p3.pH));
    ok('pH 不进 unparsed', !p3.unparsed.some(function (l) { return /pH/i.test(l); }));
    ok('「未检出」按 0 计，不是 null', p3.ions.ca === 0, String(p3.ions.ca));
    ok('未检出记进 undetected', p3.undetected.length === 1 && p3.undetected[0] === 'ca',
      JSON.stringify(p3.undetected));
    ok('未检出在 notes 里说清楚', p3.notes.some(function (n) { return /未检出/.test(n); }), p3.notes.join('|'));
    ok('碱度有独立字段且折了 HCO₃⁻', !!p3.alkalinity && Math.abs(p3.ions.hco3 - 146.33) < 0.1,
      JSON.stringify(p3.alkalinity));
    ok('碱度不进 unparsed', !p3.unparsed.some(function (l) { return /碱度/.test(l); }));
    ok('总硬度有独立字段、不进 unparsed',
      !!p3.hardness && p3.hardness.asCaCO3 === 200 && !p3.unparsed.some(function (l) { return /硬度/.test(l); }),
      JSON.stringify(p3.hardness));
    /* 「<1」= 低于检出限，不能读成 1 */
    var p3b = WaterMatch.parseReport('钙 <1 mg/L\n镁 8');
    ok('「<1」读成未检出 0，不是 1', p3b.ions.ca === 0 && p3b.undetected[0] === 'ca', String(p3b.ions.ca));
    ok('「没测」仍然是 null（与未检出区分开）',
      WaterMatch.parseReport('镁 8').ions.ca === null);
    ok('null 入参不崩', WaterMatch.parseReport(null).found.length === 0);

    /* 3b. **界面示例必须自洽**：占位符原文照抄（js/50-ui-tools.js:776），六个离子全中。
       这条是 D9 的验收点：示例自己都解析不出来，用户照抄一定失败。 */
    var SAMPLE = 'pH 7.4　钙 42　镁 9　钠 28　氯 35　硫酸盐 40　碳酸氢盐 95（mg/L）';
    var p4 = WaterMatch.parseReport(SAMPLE);
    ok('界面示例六个离子全中', p4.found.length === 6, p4.found.join(','));
    ok('示例 钙=42', p4.ions.ca === 42, String(p4.ions.ca));
    ok('示例 碳酸氢盐=95（全角括号里的单位没吃掉数值）', p4.ions.hco3 === 95, String(p4.ions.hco3));
    ok('示例 硫酸盐=40 没被当成别的离子', p4.ions.so4 === 40, String(p4.ions.so4));
    ok('六项齐全时 message 说齐全', /都认出来了/.test(p4.message), p4.message);

    /* 3c. 一行多列 / 一行多离子：按行解析时这里只能读到 1 个 */
    var p5 = WaterMatch.parseReport('钙 40    镁 8\n钠 12    氯 20\n硫酸盐 30  碳酸氢盐 60');
    ok('两列表格六个全中', p5.found.length === 6, JSON.stringify(p5.ions));
    var p6 = WaterMatch.parseReport('Ca 40 Mg 8 Na 12 Cl 20 SO4 30 HCO3 60');
    ok('英文单行六个全中', p6.found.length === 6, JSON.stringify(p6.ions));
    /* 化学式下标不能当浓度：SO4 的 4、HCO3 的 3、Ca2+ 的 2 */
    ok('SO4 的 4 没被读成浓度', p6.ions.so4 === 30, String(p6.ions.so4));
    ok('Cl 没被 SO4 的 4 覆盖', p6.ions.cl === 20, String(p6.ions.cl));
    var p7 = WaterMatch.parseReport('Ca2+ 40  Mg2+ 8  SO4-2 30  HCO3- 60  Na+ 12  Cl- 20');
    ok('离子符号（Ca2+ / SO4-2）六个全中', p7.found.length === 6, JSON.stringify(p7.ions));
    ok('Ca2+ 的电荷 2 没被读成浓度', p7.ions.ca === 40, String(p7.ions.ca));

    /* 3d. 单位：行级声明 + °dH */
    var p8 = WaterMatch.parseReport('单位：mmol/L\n钙 1 镁 0.3 钠 0.5 氯 0.6 硫酸盐 0.4 碳酸氢盐 1.5');
    ok('行级单位声明对整行生效（1 mmol/L 钙 = 40.08）',
      Math.abs(p8.ions.ca - 40.08) < 0.01, String(p8.ions.ca));
    var p9 = WaterMatch.parseReport('pH 7.6\n碱度 10 °dH');
    ok('碱度 °dH 折 CaCO₃ 再折 HCO₃（10×17.848×1.2194 ≈ 217.6）',
      Math.abs(p9.ions.hco3 - 217.6) < 0.5, String(p9.ions.hco3));
    var p10 = WaterMatch.parseReport('总硬度 12 °dH\n钙 30');
    ok('总硬度 °dH 不当碱度用（hco3 仍为 null）', p10.ions.hco3 === null, String(p10.ions.hco3));
    ok('总硬度行会解释为什么不能当碱度',
      p10.notes.some(function (n) { return /不能\*\*当碱度|不能当碱度/.test(n); }), p10.notes.join('|'));

    /* 3e. 失败要说人话 */
    var p11 = WaterMatch.parseReport('随便一段话');
    ok('一个都没解析出来 → 给可操作的提示', /没认出任何离子/.test(p11.message) && /钙 40/.test(p11.message), p11.message);
    var p12 = WaterMatch.parseReport('钙 40\n镁 8');
    ok('部分解析 → 列出没认出的', /没认出的/.test(p12.message) && p12.missingZh.length === 4,
      p12.message + ' / ' + p12.missingZh.join(','));
    ok('missing 按 ION_KEYS 顺序给出没解析的键',
      p12.missing.indexOf('hco3') >= 0 && p12.missing.indexOf('ca') < 0, p12.missing.join(','));

    /* 4. 匹配：上海水质应最接近上海档案 */
    var sh = { ca: 40, mg: 8, na: 30, cl: 35, so4: 40, hco3: 90 };
    var m = WaterMatch.match(sh);
    ok('匹配返回 3 条', m.length === 3, 'got ' + m.length);
    ok('第一名是上海', m[0] && m[0].profileId === 'wp-shanghai', m[0] && m[0].profileId);
    ok('距离为 0', m[0] && m[0].distance === 0, m[0] && String(m[0].distance));

    /* 5. 建议：给 IPA 目标加硫酸盐 */
    var sug = WaterMatch.suggest(sh, 'wt-ipa', 20);
    ok('给出盐类建议', sug.salts.length > 0, JSON.stringify(sug.salts));
    ok('至少一种含石膏', sug.salts.some(function (s) { return s.id === 'w-gypsum'; }));
    ok('SO4 残差变小', (function () {
      var before = Math.abs(250 - sh.so4);
      var after = sug.residual.filter(function (r) { return r.ion === 'so4'; })[0];
      return after && Math.abs(after.left) <= before;
    })());

    /* 6. 不可达：源水 SO4 已经 600，目标 250 → 不能靠加盐降下来 */
    var high = { ca: 100, mg: 20, na: 20, cl: 20, so4: 600, hco3: 100 };
    var sug2 = WaterMatch.suggest(high, 'wt-ipa', 20);
    ok('超量时 reachable=false', sug2.reachable === false);
    ok('超量时 note 提到 RO', /RO|稀释/.test(sug2.note));
    /* 不可达时只给方案不标注，用户会以为"按这个加完就到了目标水" */
    ok('不可达必须显式标注', /超出加盐可达范围/.test(sug2.headline), sug2.headline);
    ok('可达时也有标题', /可达到目标水/.test(sug.headline), sug.headline);

    /* 7. 脏输入 */
    ok('未知目标不崩', WaterMatch.suggest(sh, 'wt-nope', 20).salts.length === 0);
    ok('null 离子不崩', WaterMatch.suggest(null, 'wt-ipa', 20).salts.length > 0);
    ok('体积为 0 时按 20L 兜底', WaterMatch.suggest(sh, 'wt-ipa', 0).volumeL === 20);

    /* 8. D10：每味盐必须能说清"加到多少升、让哪个离子涨多少" */
    ok('盐建议带 volL', sug.salts[0] && sug.salts[0].volL === 20, sug.salts[0] && String(sug.salts[0].volL));
    ok('盐建议带 deltas', !!(sug.salts[0] && sug.salts[0].deltas), JSON.stringify(sug.salts[0]));
    ok('石膏的 deltas 里有 so4 且为正', (function () {
      var g = sug.salts.filter(function (x) { return x.id === 'w-gypsum'; })[0];
      return g && g.deltas && g.deltas.so4 > 0;
    })(), JSON.stringify(sug.salts));
    /* deltas 要能对上"加完之后每个离子落在哪" */
    ok('deltas 与 residual 自洽', (function () {
      var add = 0;
      for (var q = 0; q < sug.salts.length; q++) add += U.toNum(sug.salts[q].deltas && sug.salts[q].deltas.so4, 0);
      var res = sug.residual.filter(function (x) { return x.ion === 'so4'; })[0];
      if (!res) return false;
      return Math.abs((sh.so4 + add) - res.got) < 2;
    })());
    /* 不可达时必须点名"差得最多的是谁"，否则用户会以为方案没做完 */
    ok('不可达时给出 worst', !!sug2.worst, JSON.stringify(sug2.worst));
    /* 超量这个场景里源水 SO4=600 > 目标 250，方向是"超"不是"还差"——
       worst 必须报"超了"，不能因为"没有正差"就报 null */
    ok('超量时 worst 标记为 over（超了，不是还差）', !!sug2.worst && sug2.worst.over === true, JSON.stringify(sug2.worst));
    ok('超量时 worst.left 为负且幅度 = 600−250 左右',
      !!sug2.worst && sug2.worst.left < -100, sug2.worst && String(sug2.worst.left));
    ok('可达时 worst 为 null（小残差是噪声，不占版面）', sug.worst === null, JSON.stringify(sug.worst));

    /* 9. 反向查询：我的水能酿什么（v1.4）
       这一节的核心不是"代码能跑"，而是**推荐得有理由、有边界**：
       软水不该冒出一堆 IPA（那说明我们偷偷给风格编了水质区间），
       伯顿型必须推荐英式 IPA / 苦啤（那才说明映射表与距离是对的）。 */
    ok('映射表覆盖 12 个水型', (function () {
      var pool = (BREW.DB && BREW.DB.waterProfiles) || [];
      var miss = [];
      for (var i = 0; i < pool.length; i++) if (!PROFILE_STYLE_HINTS[pool[i].id]) miss.push(pool[i].id);
      return pool.length === 12 && !miss.length;
    })(), Object.keys(PROFILE_STYLE_HINTS).join(','));
    ok('映射表里的风格编号在 BREW.DB.styles 里都真实存在', (function () {
      var bad = [];
      var keys = Object.keys(PROFILE_STYLE_HINTS);
      for (var i = 0; i < keys.length; i++) {
        var sts = PROFILE_STYLE_HINTS[keys[i]].styles || [];
        for (var j = 0; j < sts.length; j++) {
          if (!findById((BREW.DB && BREW.DB.styles) || [], sts[j].id)) bad.push(keys[i] + '→' + sts[j].id);
          if (!sts[j].why) bad.push(keys[i] + '→' + sts[j].id + '(缺 why)');
        }
      }
      return !bad.length;
    })(), '悬空 id 会让界面点出空白条目');

    var SOFT = { ca: 10, mg: 2, na: 2, cl: 4, so4: 8, hco3: 20 };
    var BAL = { ca: 40, mg: 8, na: 30, cl: 35, so4: 40, hco3: 90 };
    var BUR = { ca: 275, mg: 25, na: 25, cl: 35, so4: 610, hco3: 200 };

    var rvEmpty = WaterMatch.reverseLookup({});
    ok('六项全空 → 不算 0，直接给提示', rvEmpty.nearest.length === 0 && /四项/.test(rvEmpty.message),
      rvEmpty.message);
    ok('null 入参不崩', WaterMatch.reverseLookup(null).nearest.length === 0);

    var rvSoft = WaterMatch.reverseLookup(SOFT);
    ok('软水最近的三个水型里有皮尔森或西雅图或 RO', (function () {
      var ids = rvSoft.nearest.map(function (x) { return x.id; });
      return ids.indexOf('wp-pilsen') >= 0 || ids.indexOf('wp-seattle') >= 0 || ids.indexOf('wp-ro') >= 0;
    })(), JSON.stringify(rvSoft.nearest.map(function (x) { return x.id; })));
    ok('软水最像的就是极软水型（距离最近的那个是 pilsen/seattle/ro）',
      ['wp-pilsen', 'wp-seattle', 'wp-ro'].indexOf(rvSoft.nearest[0].id) >= 0, rvSoft.nearest[0].id);
    /* 关键一条：软水不许推荐 IPA。推荐 IPA 就等于在暗示"软水适合 IPA"，
       而英式/美式 IPA 的水质前提是高硫酸盐——那是我们编出来的结论。 */
    ok('软水不推荐 IPA（不编风格水质区间）', (function () {
      var IPA = ['21A', '22A', '12C', '21C', '18B'];
      for (var i = 0; i < rvSoft.recommended.length; i++) {
        if (IPA.indexOf(rvSoft.recommended[i].styleId) >= 0) return false;
      }
      return true;
    })(), rvSoft.recommended.map(function (x) { return x.styleId; }).join(','));

    var rvBur = WaterMatch.reverseLookup(BUR);
    ok('伯顿型水最像伯顿', rvBur.nearest[0].id === 'wp-burton', rvBur.nearest[0].id);
    ok('伯顿型水推荐英式 IPA 与苦啤（映射表第 1、2 位）', (function () {
      var ids = rvBur.recommended.map(function (x) { return x.styleId; });
      return ids[0] === '12C' && ids[1] === '11B';
    })(), rvBur.recommended.map(function (x) { return x.styleId; }).join(','));

    var rvBal = WaterMatch.reverseLookup(BAL);
    ok('均衡水最像它自己（上海）', rvBal.nearest[0].id === 'wp-shanghai' && rvBal.nearest[0].fitPercent === 100,
      rvBal.nearest[0].id + ' ' + rvBal.nearest[0].fitPercent);

    /* 8–12 条，是任务给的下限，也是"别一次糊用户一脸"的上限 */
    var recCounts = [rvSoft.recommended.length, rvBal.recommended.length, rvBur.recommended.length];
    ok('三组水推荐数都在 8–12 之间', recCounts.every(function (c) { return c >= 8 && c <= 12; }),
      recCounts.join(','));
    ok('推荐条目都带 why（不许只给结论不给理由）',
      rvBal.recommended.every(function (x) { return !!x.why && x.why.length > 8; }));
    ok('推荐条目都有真实风格名（不是空的 nameZh）',
      rvBal.recommended.every(function (x) { return !!x.nameZh && x.nameZh !== x.styleId; }));

    /* 相似度：有界、单调。**不测"达标率"**，因为这个数本来就不是达标率 */
    ok('相似度在 0–100 且有界', rvBur.nearest.every(function (x) {
      return x.fitPercent >= 0 && x.fitPercent <= 100;
    }), JSON.stringify(rvBur.nearest.map(function (x) { return x.fitPercent; })));
    ok('距离越大相似度越小（单调）', (function () {
      var l = rvBur.nearest;
      return l[0].fitPercent >= l[1].fitPercent && l[1].fitPercent >= l[2].fitPercent;
    })());
    ok('相似度不是达标率：文案里有"不是"的说明', /不是水质达标率/.test(rvBal.caveat), rvBal.caveat);

    /* 只填四项也要能算（界面提示的最低要求） */
    var rv4 = WaterMatch.reverseLookup({ ca: 40, mg: 8, na: null, cl: 35, so4: 40, hco3: null });
    ok('只填 4 项也能算，且 compared = 4', rv4.nearest[0].compared === 4, rv4.nearest[0].compared);
    var rv2 = WaterMatch.reverseLookup({ ca: 40, mg: 8 });
    ok('只填 2 项时明说结论会偏', /只填了 2 项/.test(rv2.note), rv2.note);

    /* 加盐建议：目标不能是"你自己"，否则永远 0 g */
    ok('均衡水的默认调整目标不是它自己', !!rvBal.adjust && rvBal.adjust.profileId !== 'wp-shanghai',
      rvBal.adjust && rvBal.adjust.profileId);
    ok('调整建议一定带一句人话 note（给不出克数也要说清为什么）',
      !!rvBal.adjust && /想更接近|加盐只会|不需要调/.test(rvBal.adjust.note),
      rvBal.adjust && rvBal.adjust.note);
    ok('软水给了具体克数（石膏）', !!(rvSoft.adjust && rvSoft.adjust.salts.some(function (x) {
      return x.id === 'w-gypsum';
    })), rvSoft.adjust && JSON.stringify(rvSoft.adjust.salts));
    ok('伯顿型水给了具体克数', !!(rvBur.adjust && rvBur.adjust.salts.length > 0),
      rvBur.adjust && JSON.stringify(rvBur.adjust.salts));
    ok('调整目标一定来自真实水型', !!(rvBal.adjust && findById(BREW.DB.waterProfiles, rvBal.adjust.profileId)),
      rvBal.adjust && rvBal.adjust.profileId);
    ok('basis 只会是 full / knobs / none', !!(rvBal.adjust &&
      ['full', 'knobs', 'none'].indexOf(rvBal.adjust.basis) >= 0), rvBal.adjust && rvBal.adjust.basis);
    ok('指定调整目标时 auto=false 且听用户的', (function () {
      var x = WaterMatch.reverseLookup(BAL, { adjustTarget: 'wp-burton', volumeL: 20 });
      return x.adjust && x.adjust.profileId === 'wp-burton' && x.adjust.auto === false;
    })());
    ok('不存在的调整目标会退回自动（不崩）', (function () {
      var x = WaterMatch.reverseLookup(BAL, { adjustTarget: 'wp-nope' });
      return x.adjust && x.adjust.auto === true;
    })());

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
