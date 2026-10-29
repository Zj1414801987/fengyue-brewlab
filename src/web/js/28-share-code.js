/* ============================================================================
 * 风月酿研所 — 28 配方分享码（Share Code）
 * ----------------------------------------------------------------------------
 * 目标：把一个配方压成一段可粘贴的字符串，对方粘进输入框就能还原成可编辑配方。
 * 无服务端、无网络、无二维码编码器。
 *
 * 编码链：紧凑投影（短键 + 只留会被计算的字段） → UTF-8 → base64url
 *        → BL1.<crc16 4位十六进制>.<payload>
 *
 * 为什么不做 LZ 压缩：手写 LZ77 一旦有 bug 是**静默解出错误配方**，
 *   而省下的只有一百多个字符。宁可码长一点，也不要一个沉默的错误源。
 * 为什么 CRC 放在 payload 前面：微信/QQ 转发会断行、会被截断，
 *   先验校验再解 payload，能给出"码被截断"而不是"JSON 解析失败"。
 * 为什么 CRC 算在 base64 字符串上而不是解码后的字节上：
 *   base64url 末尾字符的低位在解码时会被丢弃，改末尾字符可能不改变字节，
 *   但一定改变字符串本身 —— 算字符串才能保证"改任意一个字符必被检出"。
 *
 * 体积：路线图写的"约 250 字符"做不到（那要二进制索引编码，库版本一变索引就错）。
 *   实测见 tools/test-calc-v12.js 的三份真实配方。
 *
 * 纯度：只吃入参、只吐返回值。不读 DOM / Store，不取当前时间。
 *
 * 前置依赖：00-core（可选，只借 Util 的 round；库里查名字需要 10–13 的数据，缺失时退化为"全部带名字"）
 * 加载位置：应在 js/24-data-usage-overrides.js 之后、js/30-recipe.js 之前
 * ==========================================================================*/
(function (root) {
  'use strict';

  var BREW = root.BREW = root.BREW || {};
  var ShareCode = BREW.ShareCode = {};

  var PREFIX = 'BL1';
  var MAX_PAYLOAD = 20000;
  var NOTES_MAX = 240;              /* 备注在码里的字符上限（超了截断并置 notesTruncated） */
  /* 长度策略（v1.2 定案）：
     ≤1200        正常
     1200–4000    照常生成，但返回 sizeLevel:'long' + 一句提示（聊天软件可能截断）
     >4000        拒绝生成，抛 code:'too-large'，引导改用 JSON 导出
     为什么不是硬顶 1200：截断的码会被 CRC 拦住并抛错，失败模式本来就是安全的；
     用户可能就是要贴论坛或发邮件，那里没有 1200 限制。4000 是给输入框可用性兜底。 */
  var SIZE_WARN = 1200;
  var SIZE_MAX = 4000;

  /* 01 的 Util 若存在就用它；单独 require 本文件时用内置兜底 */
  function rnd(v, d) {
    var p = Math.pow(10, d || 0);
    return Math.round(v * p) / p;
  }
  function toNum(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  /* ======================================================================
   * 一、编码原语（纯 JS，node 与浏览器同一套）
   * ====================================================================*/

  function utf8Encode(str) {
    var out = [], i, c, c2, cp;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
            0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
        } else {
          out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function utf8Decode(bytes) {
    var s = '', i = 0, b, cp;
    while (i < bytes.length) {
      b = bytes[i++];
      if (b < 0x80) {
        s += String.fromCharCode(b);
      } else if (b >= 0xC0 && b < 0xE0) {
        if (i + 1 > bytes.length) throw new Error('分享码内容不完整（UTF-8 被截断）');
        s += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
      } else if (b >= 0xE0 && b < 0xF0) {
        if (i + 2 > bytes.length) throw new Error('分享码内容不完整（UTF-8 被截断）');
        s += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      } else if (b >= 0xF0) {
        if (i + 3 > bytes.length) throw new Error('分享码内容不完整（UTF-8 被截断）');
        cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        cp -= 0x10000;
        s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023));
      } else {
        throw new Error('分享码内容损坏（非法 UTF-8 字节 ' + b + '）');
      }
    }
    return s;
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function b64uEncode(bytes) {
    var out = '', i, b0, b1, b2;
    for (i = 0; i < bytes.length; i += 3) {
      b0 = bytes[i];
      b1 = bytes[i + 1];
      b2 = bytes[i + 2];
      out += B64.charAt(b0 >> 2);
      out += B64.charAt(((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4));
      if (b1 === undefined) break;
      out += B64.charAt(((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6));
      if (b2 === undefined) break;
      out += B64.charAt(b2 & 63);
    }
    return out;
  }

  function b64uDecode(str) {
    var out = [], i, v0, v1, v2, v3, buf = 0, bits = 0;
    for (i = 0; i < str.length; i++) {
      var idx = B64.indexOf(str.charAt(i));
      if (idx < 0) throw new Error('分享码内容损坏（含非法字符「' + str.charAt(i) + '」）');
      buf = (buf << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buf >> bits) & 0xFF);
      }
    }
    return out;
  }

  /** CRC-16/CCITT-FALSE，算在 ASCII payload 字符串上 */
  function crc16(str) {
    var crc = 0xFFFF, i, j;
    for (i = 0; i < str.length; i++) {
      crc ^= (str.charCodeAt(i) & 0xFF) << 8;
      for (j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
      }
    }
    return crc;
  }

  function crcHex(str) {
    var h = crc16(str).toString(16);
    while (h.length < 4) h = '0' + h;
    return h;
  }

  /** 同一套多项式，算在**字节数组**上（压缩帧要校验解压后的原始字节）。
   *  与 crc16 的关系：crc16 把字符串逐字符 &0xFF 后按同样的多项式滚动，
   *  也就是说对纯 ASCII 串两者结果完全相同。这里另写一份是因为 crc16 的入参
   *  是字符串，把 20 万字节拼成字符串只为了算 CRC 既慢又多一次内存峰值。 */
  function crc16Bytes(bytes) {
    var crc = 0xFFFF, i, j;
    for (i = 0; i < bytes.length; i++) {
      crc ^= (bytes[i] & 0xFF) << 8;
      for (j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
      }
    }
    return crc;
  }

  /* ======================================================================
   * 二、紧凑投影
   * ----------------------------------------------------------------------
   * 原则：只留「参与计算或被界面渲染」的字段；等于库默认值的不写。
   * 行用数组而不是对象：数组没有键名，一个麦芽行省 30 多个字节。
   * ====================================================================*/

  /** 库里已经有这个名字就不写进码里；自建原料/自定义必须写 */
  function needName(kind, row) {
    if (!row || !row.name) return false;
    if (row.custom) return true;
    var pool = (BREW.DB && BREW.DB[kind]) || [];
    for (var i = 0; i < pool.length; i++) {
      if (pool[i] && pool[i].id === row.id) {
        return String(pool[i].name || '') !== String(row.name || '');
      }
    }
    return true;                       /* 库里找不到（自建或已删除）→ 必须自带名字 */
  }

  var FER = { high: 2, med: 1, low: 0 };

  function ferCode(v) {
    if (v === null || v === undefined || v === '') return null;
    if (FER[v] !== undefined) return FER[v];
    return String(v);                  /* 未知取值原样带，别丢信息 */
  }
  function ferFromCode(v) {
    if (v === 2) return 'high';
    if (v === 1) return 'med';
    if (v === 0) return 'low';
    if (typeof v === 'string') return v;
    return null;
  }

  function num(v, d) {
    var x = toNum(v);
    return x === null ? null : rnd(x, d);
  }

  /** 去掉行尾的空值，省字符 */
  function trimRow(arr) {
    var i = arr.length - 1;
    while (i >= 0 && (arr[i] === null || arr[i] === undefined || arr[i] === '')) i--;
    return arr.slice(0, i + 1);
  }

  function putNum(o, key, v, d) {
    var x = num(v, d);
    if (x !== null) o[key] = x;
  }
  function putStr(o, key, v) {
    if (v === null || v === undefined) return;
    var s = String(v);
    if (!s) return;
    o[key] = s;
  }

  /** 配方 → 紧凑对象 */
  function project(r) {
    r = r || {};
    var o = { v: 1 };

    putStr(o, 'n', r.name);
    putStr(o, 's', r.styleId);
    putStr(o, 'a', r.author);
    putStr(o, 'no', r.notes);

    putNum(o, 'bs', r.batchSize, 1);
    putNum(o, 'ef', r.efficiency, 0);
    putNum(o, 'er', r.evaporationRate, 1);
    putNum(o, 'bt', r.boilTime, 0);
    putNum(o, 'tl', r.trubLoss, 1);
    putNum(o, 'fl', r.fermenterLoss, 1);
    putNum(o, 'ga', r.grainAbsorption, 2);
    putNum(o, 'ha', r.hopAbsorption, 1);
    putNum(o, 'mt', r.mashThickness, 1);
    putNum(o, 'ft', r.fermentTemp, 1);

    /* 原料行 */
    var f = [];
    var i, x;
    for (i = 0; i < (r.fermentables || []).length; i++) {
      x = r.fermentables[i];
      if (!x) continue;
      f.push(trimRow([
        x.id || null,
        num(x.amount, 3),
        num(x.ppg, 1),
        num(x.lov, 1),
        x.cat || null,
        x.mustMash === false ? 0 : null,   /* 只写"明确不糖化"的例外，其余交给库默认值 */
        ferCode(x.fermentable),
        needName('malts', x) ? String(x.name) : undefined
      ]));
    }
    if (f.length) o.f = f;

    var h = [];
    for (i = 0; i < (r.hops || []).length; i++) {
      x = r.hops[i];
      if (!x) continue;
      h.push(trimRow([
        x.id || null,
        num(x.amount, 3),
        num(x.aa, 2),
        x.stage || null,
        num(x.time, 0),
        needName('hops', x) ? String(x.name) : undefined,
        /* 第 7 位：回旋温度。20-calc 按它分利用率档（有 85°C 与没写差一档），
           不带就等于"同一份配方换台机器算出不同 IBU"。
           老码只有前 6 位，多一位对旧客户端是"不认识的尾项"，不会读错。 */
        num(x.whirlpoolTemp, 0)
      ]));
    }
    if (h.length) o.h = h;

    var y = [];
    for (i = 0; i < (r.yeasts || []).length; i++) {
      x = r.yeasts[i];
      if (!x) continue;
      y.push(trimRow([
        x.id || null,
        num(x.amount, 2),
        num((BREW.UI && BREW.UI.yeastAtt) ? BREW.UI.yeastAtt(x, 75) : x.att, 1),   /* v2.0：兼容老字段 atten */
        x.type || null,
        needName('yeasts', x) ? String(x.name) : undefined
      ]));
    }
    if (y.length) o.y = y;

    var ad = [];
    for (i = 0; i < (r.adjuncts || []).length; i++) {
      x = r.adjuncts[i];
      if (!x) continue;
      ad.push(trimRow([
        x.id || null,
        num(x.amount, 3),
        x.unit || null,
        x.stage || null,
        num(x.extraSugarPct, 1),
        needName('adjuncts', x) ? String(x.name) : undefined
      ]));
    }
    if (ad.length) o.ad = ad;

    /* 水 */
    var w = r.water || {};
    var src = w.source || {};
    var wi = [
      num(src.ca, 1), num(src.mg, 1), num(src.na, 1),
      num(src.cl, 1), num(src.so4, 1), num(src.hco3, 1)
    ];
    var ws = [];
    for (i = 0; i < (w.salts || []).length; i++) {
      x = w.salts[i];
      if (!x || !x.id) continue;
      ws.push([x.id, num(x.amount, 2)]);
    }
    var wObj = {};
    putStr(wObj, 'p', w.profileId);
    if (wi.some(function (v) { return v !== null; })) wObj.i = trimRow(wi);
    if (ws.length) wObj.s = ws;
    if (wObj.p || wObj.i || wObj.s) o.w = wObj;

    /* 糖化 */
    var m = [];
    for (i = 0; i < ((r.mash && r.mash.steps) || []).length; i++) {
      x = r.mash.steps[i];
      if (!x) continue;
      m.push(trimRow([x.name || null, num(x.tempC, 1), num(x.minutes, 0)]));
    }
    if (m.length) o.m = m;

    /* 碳化 */
    var c = r.carbonation || {};
    var cArr = trimRow([num(c.targetVol, 1), num(c.tempC, 0), c.sugarType || null]);
    if (cArr.length) o.c = cArr;

    /* 设计目标 */
    var t = r.targets || {};
    var tArr = trimRow([num(t.og, 3), num(t.fg, 3), num(t.abv, 1), num(t.ibu, 0), num(t.srm, 0)]);
    if (tArr.length) o.t = tArr;

    return o;
  }

  /* ======================================================================
   * 三、对外接口
   * ====================================================================*/

  /**
   * 配方 → 分享码
   * @returns {{text:string, bytes:number, chars:number, payload:string,
   *            notesTruncated:boolean, sizeLevel:'ok'|'long', message:string}}
   *   bytes = 紧凑 JSON 的 UTF-8 字节数；chars = 最终分享码长度
   *   sizeLevel='long' 时 message 是给用户看的提示（1200–4000 字符）
   *   超过 4000 字符直接抛 Error（code:'too-large'），让界面引导改用 JSON 导出
   */
  ShareCode.encode = function (recipe) {
    var o = project(recipe);
    var notesTruncated = false;
    /* 备注是唯一可能无限长的字段。给个上限，否则一段设计笔记就能把码顶到几千字符。
       截断要显式告诉调用方，不能悄悄丢。 */
    if (o.no && o.no.length > NOTES_MAX) {
      o.no = o.no.slice(0, NOTES_MAX) + '…';
      notesTruncated = true;
    }
    var json = JSON.stringify(o);
    var bytes = utf8Encode(json);
    var payload = b64uEncode(bytes);
    var text = PREFIX + '.' + crcHex(payload) + '.' + payload;

    var chars = text.length;
    if (chars > SIZE_MAX) {
      throwFail('too-large',
        '配方太大，分享码会有 ' + chars + ' 字符（上限 ' + SIZE_MAX + '），' +
        '粘贴和转发都不可靠。请改用「导出 JSON」把配方存成文件发给对方');
    }
    var sizeLevel = chars > SIZE_WARN ? 'long' : 'ok';
    var message = sizeLevel === 'long'
      ? '码较长（' + chars + ' 字符），部分聊天软件会截断。建议用剪贴板直接粘贴，或改用 JSON 文件导出'
      : '';

    return {
      text: text,
      bytes: bytes.length,
      chars: chars,
      payload: payload,
      notesTruncated: notesTruncated,
      sizeLevel: sizeLevel,
      message: message
    };
  };

  /**
   * 分享码 → 配方（部分字段，交给 UI.normalizeRecipe 补默认值）
   * 非法输入一律 throw，**绝不返回半个配方**。
   * 抛出的 Error 带 `code`，界面可以据此翻人话（不必匹配中文串）：
   *   'empty' | 'not-share-code' | 'bad-version' | 'too-large' |
   *   'crc' | 'bad-payload' | 'bad-json' | 'bad-content'
   * @returns {{recipe:object, version:number, crcOk:boolean}}
   */
  ShareCode.decode = function (text) {
    var s = String(text === null || text === undefined ? '' : text)
      .replace(/[\s\u3000]+/g, '');        /* 聊天软件会插换行，先清掉 */
    if (!s) throwFail('empty', '分享码是空的');

    /* v1.7：BL2 的配方码也认。
       为什么这条要加在老 decode 上：decode() 是"给我一个配方"这个老契约，
       工地上的调用方（配方页、控制台、测试）都还按它取 .recipe。
       v1.7 起生成端改用 BL2，如果 decode() 只认 BL1，同一个软件里
       "刚生成出来的码自己解不开" —— 这不是兼容性策略，是自相矛盾。
       BL1 分支一个字没改（在下面），所以老码的读取路径完全不变。 */
    if (s.indexOf(PREFIX2 + '.') === 0) {
      var any = ShareCode.decodeAny(s);
      if (!any.ok) throwFail(any.code || 'bad-payload', any.reason);
      if (any.type !== 'recipe') {
        throwFail('bad-type', '这是一段「' + ShareCode.typeLabel(any.type) + '」分享码，不是配方码');
      }
      return { recipe: any.data, version: V2, crcOk: true };
    }

    /* v1.8：BZ1（压缩分享包）也要能被老契约读出"里面那个配方"——
       否则同一个软件里"生成出来的码自己解不开"，和 v1.7 加 BL2 时是同一个坑。
       包里没有配方时明确说清楚，而不是返回半个对象。 */
    if (s.indexOf(PREFIX3 + '.') === 0) {
      var zany = ShareCode.decodeAny(s);
      if (!zany.ok) throwFail(zany.code || 'bad-payload', zany.reason);
      if (zany.type !== 'bundle') {
        if (zany.type !== 'recipe') {
          throwFail('bad-type', '这是一段「' + ShareCode.typeLabel(zany.type) + '」压缩码，不是配方码');
        }
        return { recipe: zany.data, version: V2, crcOk: true };
      }
      var zp = (zany.data && zany.data.parts) || {};
      var pickR = zp.recipe || (Array.isArray(zp.recipes) ? zp.recipes[0] : null);
      if (!pickR) {
        throwFail('bad-type', '这段压缩分享包里有 ' + ((zany.blocks || []).length) +
          ' 块内容，但没有配方：请到「分享中心」导入，按块分别写入');
      }
      return { recipe: pickR, version: V2, crcOk: true };
    }

    var m = /^BL(\d{1,2})\.([0-9a-fA-F]{4})\.([A-Za-z0-9_-]+)$/.exec(s);
    if (!m) throwFail('not-share-code', '分享码格式不正确：应以 BL1. 开头，形如 BL1.1a2b.<码>');

    var version = parseInt(m[1], 10);
    if (version !== 1) throwFail('bad-version', '分享码版本 ' + version + ' 不支持（当前版本只认 BL1）');

    var crcIn = m[2].toLowerCase();
    var payload = m[3];
    if (payload.length > MAX_PAYLOAD) {
      throwFail('too-large', '分享码过长（' + payload.length + ' 字符），不像是配方码');
    }
    if (crcHex(payload) !== crcIn) {
      throwFail('crc', '分享码校验失败：码被截断或被修改过（CRC 不符）');
    }

    var bytes, json;
    try {
      bytes = b64uDecode(payload);
      json = utf8Decode(bytes);
    } catch (e) {
      throwFail('bad-payload', '分享码内容损坏：' + ((e && e.message) || '无法解码'));
    }

    var o;
    try {
      o = JSON.parse(json);
    } catch (e2) {
      throwFail('bad-json', '分享码内容损坏：不是有效的 JSON');
    }
    if (!o || o.v !== 1) throwFail('bad-content', '分享码内容版本不符（期望 v=1）');

    return { recipe: expand(o), version: version, crcOk: true };
  };

  /** 带错误码的抛错。错误码是给界面用的，message 是给人看的 */
  function throwFail(code, msg) {
    var e = new Error(msg);
    e.code = code;
    try { e.shareCode = true; } catch (e2) { /* 老环境忽略 */ }
    throw e;
  }

  /** 紧凑对象 → 配方字段（长键名 + 行对象） */
  function expand(o) {
    var r = {};
    if (o.n !== undefined) r.name = String(o.n);
    if (o.s !== undefined) r.styleId = String(o.s);
    if (o.a !== undefined) r.author = String(o.a);
    if (o.no !== undefined) r.notes = String(o.no);

    var params = [['bs', 'batchSize'], ['ef', 'efficiency'], ['er', 'evaporationRate'],
      ['bt', 'boilTime'], ['tl', 'trubLoss'], ['fl', 'fermenterLoss'],
      ['ga', 'grainAbsorption'], ['ha', 'hopAbsorption'], ['mt', 'mashThickness'],
      ['ft', 'fermentTemp']];
    for (var i = 0; i < params.length; i++) {
      if (o[params[i][0]] !== undefined) r[params[i][1]] = o[params[i][0]];
    }

    r.fermentables = (o.f || []).map(function (a) {
      var row = {
        id: a[0] || '',
        amount: a[1] === null || a[1] === undefined ? 0 : a[1],
        ppg: a[2] === null || a[2] === undefined ? undefined : a[2],
        lov: a[3] === null || a[3] === undefined ? undefined : a[3],
        cat: a[4] || '',
        mustMash: a[5] === null || a[5] === undefined ? undefined : a[5] === 1,
        fermentable: ferFromCode(a[6])
      };
      if (a[7] !== undefined) row.name = String(a[7]);
      return row;
    });

    r.hops = (o.h || []).map(function (a) {
      var row = {
        id: a[0] || '',
        amount: a[1] === null || a[1] === undefined ? 0 : a[1],
        aa: a[2] === null || a[2] === undefined ? undefined : a[2],
        stage: a[3] || 'boil',
        time: a[4] === null || a[4] === undefined ? 0 : a[4]
      };
      /* a[5] 是"名字槽"，可能是一个洞（有回旋温度但名字在库里时是 null）。
         老代码写的是 `!== undefined`，遇到洞会得到 "null" 这个字符串名字 —— 
         v1.7 起带第 7 位，空洞就成了常态，所以这里同时排除 null。 */
      if (a[5] !== undefined && a[5] !== null) row.name = String(a[5]);
      if (a[6] !== undefined && a[6] !== null) row.whirlpoolTemp = a[6];
      return row;
    });

    r.yeasts = (o.y || []).map(function (a) {
      var row = {
        id: a[0] || '',
        amount: a[1] === null || a[1] === undefined ? 11 : a[1],
        att: a[2] === null || a[2] === undefined ? undefined : a[2],
        type: a[3] || 'ale'
      };
      if (a[4] !== undefined) row.name = String(a[4]);
      return row;
    });

    r.adjuncts = (o.ad || []).map(function (a) {
      var row = {
        id: a[0] || '',
        amount: a[1] === null || a[1] === undefined ? 0 : a[1],
        unit: a[2] || 'g',
        stage: a[3] || 'boil',
        extraSugarPct: a[4] === null || a[4] === undefined ? 0 : a[4]
      };
      if (a[5] !== undefined) row.name = String(a[5]);
      return row;
    });

    var w = o.w || {};
    var wi = w.i || [];
    r.water = {
      profileId: w.p || null,
      source: {
        ca: wi[0] || 0, mg: wi[1] || 0, na: wi[2] || 0,
        cl: wi[3] || 0, so4: wi[4] || 0, hco3: wi[5] || 0
      },
      salts: (w.s || []).map(function (a) { return { id: a[0], amount: a[1] || 0 }; })
    };

    if (o.m) {
      r.mash = {
        steps: o.m.map(function (a) {
          return { name: a[0] || '糖化', tempC: a[1] || 66, minutes: a[2] === undefined ? 60 : a[2] };
        })
      };
    }

    if (o.c) {
      r.carbonation = {
        targetVol: o.c[0] === undefined ? 2.4 : o.c[0],
        tempC: o.c[1] === undefined ? 20 : o.c[1],
        sugarType: o.c[2] || 'sucrose'
      };
    }

    if (o.t) {
      r.targets = {
        og: o.t[0] || null, fg: o.t[1] || null, abv: o.t[2] || null,
        ibu: o.t[3] || null, srm: o.t[4] || null
      };
    }

    return r;
  }

  /* ======================================================================
   * 三·五、v2 对象码（BL2）：从「配方分享码」升级成「什么都能分享」
   * ----------------------------------------------------------------------
   * 为什么**不**把类型字段塞进 BL1、也不改 BL1 的解析：
   *   老的 BL1 载荷里没有"我是什么"这个字段。任何读过 BL1 的客户端（包括
   *   用户手上那份旧版、以及论坛里已经贴出去的码）拿到一串 BL1. 都会
   *   **当配方解析并写进配方库**。如果给 BL1 加一个类型字段，
   *   ① 旧客户端读不懂新字段，却仍然会把它当配方写进去 —— 覆盖用户的配方；
   *   ② 新客户端读旧码时又缺少类型，只能猜。
   *   两种猜法都会造成"静默写错"：不报错、不提示，用户的配方被别的东西覆盖。
   *   所以 BL1 **冻结、只读**，v2 一律走新前缀 BL2。
   *   老码永远能读（decodeAny 对 BL1 转调老 decode），新码不会污染老客户端
   *   的配方库（旧版不认识 BL2 前缀，会直接说"格式不正确"而不是写进去）。
   *
   * BF1 是公式码（js/43a-formulas.js 的领域）。这里**只认前缀不解析**：
   *   两套编码各自演进，把公式码塞进分享中心解析等于把两个团队的格式
   *   耦在一起，将来改哪边都要动两边。
   *
   * 载荷：{ t:'<类型>', v:2, app:'BrewLab', at:'<ISO 时间>', d:{...} }
   *   at 由**调用方**传入（本文件不取当前时间，保持纯函数：同一份输入
   *   永远产出同一串码，测试才能拿固定字符串做断言）。
   * ====================================================================*/

  var PREFIX2 = 'BL2';
  var FORMULA_PREFIX = 'BF1';
  var PREFIX3 = 'BZ1';          /* v1.8：本地压缩过的分享包（见 §三·六） */
  var V2 = 2;

  /* 11 种可分享对象。数组顺序 = 分享中心胶囊按钮的顺序：
     配方（最常用）→ 四类原料 → 原料库 → 记录类 → 产出类。 */
  var TYPES = [
    { t: 'recipe', label: '配方', icon: 'recipe', hint: '单条配方：原料、设备参数、目标值' },
    { t: 'malt', label: '麦芽', icon: 'sack', hint: '一条麦芽参数' },
    { t: 'hop', label: '酒花', icon: 'flask', hint: '一条酒花的 α 酸与用法' },
    { t: 'yeast', label: '酵母', icon: 'beaker', hint: '一颗酵母的衰减与温度区间' },
    { t: 'adjunct', label: '辅料', icon: 'drop', hint: '一条辅料（香料 / 澄清剂 …）' },
    { t: 'library', label: '原料库', icon: 'layers', hint: '自建原料集合（整库）' },
    { t: 'batches', label: '批次', icon: 'record', hint: '批次列表（配方只留名字与关键值）' },
    { t: 'brewday', label: '酿造日', icon: 'clock', hint: '一锅的工艺时间轴与实测' },
    { t: 'label', label: '酒标', icon: 'sparkle', hint: '酒标设计（图片本体不随码传输）' },
    { t: 'analysis', label: '分析', icon: 'chart', hint: '年度统计与花费的数值快照' },
    { t: 'inventory', label: '库存', icon: 'home', hint: '库存物料与出入库流水' }
  ];

  function typeMeta(t) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].t === t) return TYPES[i];
    return null;
  }

  /** 供界面渲染胶囊按钮 / 生成说明用。返回副本，调用方改不坏这张表。 */
  ShareCode.types = function () {
    return TYPES.map(function (x) { return { t: x.t, label: x.label, icon: x.icon, hint: x.hint }; });
  };
  ShareCode.typeLabel = function (t) {
    /* bundle 不在这 11 颗胶囊里（它是"多个对象装一个信封"），但界面要给它名字 */
    if (t === 'bundle') return '分享包';
    var m = typeMeta(t);
    return m ? m.label : '未知类型';
  };
  ShareCode.limits = function () { return { warn: SIZE_WARN, max: SIZE_MAX }; };

  /* 单字段字符上限：一条原料的 story / craft 通常是 60–200 字，
     但用户自建原料的备注可以是任意长。一个字段 1200 字就能把码顶到上限，
     所以在**进入码之前**收口，而不是等整体超限再拒绝。 */
  var FIELD_MAX = 1200;
  /* 图片本体在 base64/dataURL 形态下的典型长度是 26 万字符（见 49 的注释）。
     识别它不靠"是不是以 data: 开头"（有人会存成裸 base64），
     而是"字段名像图片 + 值很长"两条同时成立。 */
  var IMG_KEYS = { data: 1, dataurl: 1, src: 1, base64: 1, image: 1, png: 1, jpg: 1, jpeg: 1, blob: 1 };

  function looksLikeImageBody(k, v) {
    if (typeof v !== 'string') return false;
    if (v.slice(0, 5) === 'data:') return true;
    if (!IMG_KEYS[String(k).toLowerCase()]) return false;
    return v.length > 512;
  }

  /**
   * 把任意数据捏成"可进码"的形状：
   *   · 丢掉 undefined / 函数（JSON 里它们本来就消失，但会留下空洞）
   *   · 图片本体替换成空串 + 记一笔（否则一张图就超上限）
   *   · 超长字符串截断到 FIELD_MAX（显式标 …，不静默）
   * opts.stripped 会被置为 true —— 调用方靠它决定要不要提示用户
   */
  function sanitize(v, opts, depth) {
    depth = depth || 0;
    if (depth > 8) return null;                 /* 防环：酒标的 elements 理论上可自引用 */
    if (v === null || v === undefined) return null;
    var ty = typeof v;
    if (ty === 'number') return isFinite(v) ? v : null;
    if (ty === 'boolean') return v;
    if (ty === 'string') {
      if (v.length > FIELD_MAX) return v.slice(0, FIELD_MAX) + '…';
      return v;
    }
    if (ty === 'function') return undefined;
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var arr = [];
      for (var i = 0; i < v.length; i++) {
        var x = sanitize(v[i], opts, depth + 1);
        if (x !== undefined) arr.push(x);
      }
      return arr;
    }
    if (ty === 'object') {
      var o = {};
      for (var k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
        if (looksLikeImageBody(k, v[k])) {
          o[k] = '';
          if (opts) opts.stripped = true;
          continue;
        }
        var y = sanitize(v[k], opts, depth + 1);
        if (y !== undefined) o[k] = y;
      }
      return o;
    }
    return null;
  }

  /* 各类型的投影。原则：只留"对方拿到以后能看懂 / 能复用"的字段。
     不是把整个对象塞进去 —— 一个批次带 recipeSnapshot 就有 3 KB，
     base64 之后 4 KB，一条就顶满上限。 */
  function pick(o, keys) {
    var out = {};
    if (!o) return out;
    for (var i = 0; i < keys.length; i++) {
      if (o[keys[i]] !== undefined) out[keys[i]] = o[keys[i]];
    }
    return out;
  }

  function slimBatch(b) {
    b = b || {};
    var snap = b.recipeSnapshot || {};
    var out = pick(b, ['batchNo', 'recipeId', 'brewDate', 'status', 'statusHistory',
      'actual', 'packaging', 'tasting', 'cost', 'notes', 'failure']);
    out.name = b.name || snap.name || '';
    out.styleId = snap.styleId || '';
    /* 快照要带**原料骨架**，不能只带几个数：批次详情靠 recipeSnapshot 重算
       "设计值"（46 的 planOf → UI.calc(snap)），没有 fermentables 就会算出
       1.000 并把一条 TypeError 写进控制台。所以这里保留参与计算的字段，
       丢掉的是 story / craft / psrc 这类长文本。
       体量：一锅约 1.6 K 字符，两锅刚好在 4000 以内，再多就由超限错误挡住。 */
    out.snap = {
      name: snap.name || out.name, styleId: snap.styleId || '', styleName: snap.styleName || '',
      batchSize: snap.batchSize, efficiency: snap.efficiency, boilTime: snap.boilTime,
      og: snap.og, fg: snap.fg, abv: snap.abv, ibu: snap.ibu, srm: snap.srm,
      fermentables: (snap.fermentables || []).map(function (x) {
        return pick(x, ['name', 'amount', 'unit', 'cat', 'ppg', 'lov', 'mustMash', 'fermentable']);
      }),
      hops: (snap.hops || []).map(function (x) {
        return pick(x, ['name', 'amount', 'unit', 'aa', 'stage', 'time']);
      }),
      yeasts: (snap.yeasts || []).map(function (x) {
        return pick(x, ['name', 'amount', 'att', 'type']);
      }),
      adjuncts: (snap.adjuncts || []).map(function (x) {
        return pick(x, ['name', 'amount', 'unit', 'stage']);
      }),
      carbonation: snap.carbonation || null,
      mashSteps: (snap.mashSteps || []).map(function (x) {
        return pick(x, ['name', 'tempC', 'minutes']);
      }),
      water: snap.water ? {
        source: pick(snap.water.source || {}, ['ca', 'mg', 'na', 'cl', 'so4', 'hco3']),
        salts: (snap.water.salts || []).map(function (x) { return pick(x, ['id', 'amount']); })
      } : null
    };
    out.readings = (b.readings || []).slice(0, 60);      /* 曲线点最多 60 个，超了截断 */
    return out;
  }

  /** 单条原料的紧凑投影（整库分享用）。
   *  为什么单条分享用全量、整库分享用投影：一条原料的 story / craft 是用户
   *  想传给对方的东西（"这麦芽为什么合适"），整库分享里几十条 story 就是
   *  几万字符 —— 一条也传不出去。整库只留"能重新建出这条原料"的参数。 */
  var SLIM_KEYS = {
    malts: ['id', 'name', 'en', 'cat', 'origin', 'ppg', 'lov', 'mustMash', 'maxPct', 'dp', 'fermentable', 'flavor', 'conf'],
    hops: ['id', 'name', 'en', 'origin', 'type', 'aa', 'aaMin', 'aaMax', 'beta', 'coh', 'aroma', 'use', 'grp', 'conf'],
    yeasts: ['id', 'name', 'en', 'lab', 'type', 'form', 'att', 'attMin', 'attMax', 'tempMin', 'tempMax', 'abvTol', 'floc', 'conf'],
    adjuncts: ['id', 'name', 'en', 'cat', 'useMin', 'useMax', 'unit', 'stage', 'flavor', 'conf']
  };

  function slimLibrary(src) {
    var out = {};
    var kinds = ['malts', 'hops', 'yeasts', 'adjuncts'];
    for (var k = 0; k < kinds.length; k++) {
      var arr = src && Array.isArray(src[kinds[k]]) ? src[kinds[k]] : [];
      var list = [];
      for (var i = 0; i < arr.length; i++) {
        if (!arr[i]) continue;
        var row = pick(arr[i], SLIM_KEYS[kinds[k]]);
        row.custom = arr[i].custom !== false;
        list.push(row);
      }
      out[kinds[k]] = list;
    }
    return out;
  }

  function prepare(type, data) {
    var opts = { stripped: false };
    var d;
    if (type === 'recipe') {
      /* 复用 v1 的紧凑投影：配方码越小越好，而那张表已经为"省字符"调过三轮 */
      d = project(data || {});
    } else if (type === 'label') {
      d = sanitize(data || {}, opts);
    } else if (type === 'library') {
      d = sanitize(slimLibrary(data || {}), opts);
    } else if (type === 'batches') {
      var list = (Object.prototype.toString.call(data) === '[object Array]') ? data : [];
      d = { n: list.length, items: list.slice(0, 50).map(function (b) { return sanitize(slimBatch(b), opts); }) };
    } else if (type === 'brewday') {
      var bb = data || {};
      d = sanitize({
        batchNo: bb.batchNo || '', name: bb.name || (bb.recipeSnapshot || {}).name || '',
        brewDate: bb.brewDate || '', status: bb.status || '',
        brewday: bb.brewday || null, actual: bb.actual || null,
        readings: (bb.readings || []).slice(0, 60)
      }, opts);
    } else if (type === 'analysis') {
      d = sanitize(analysisSnapshot(data || {}), opts);
    } else if (type === 'inventory') {
      var inv = data || {};
      d = sanitize({
        items: (inv.items || []).slice(0, 400),
        moves: (inv.moves || []).slice(-400)     /* 只留最近 400 笔：更早的账对"现在有多少"没有贡献 */
      }, opts);
    } else {
      /* malt / hop / yeast / adjunct / library：原样带，但过一遍 sanitize */
      d = sanitize(data === undefined ? {} : data, opts);
    }
    return { d: d, stripped: opts.stripped };
  }

  /** 分析快照：**只收数字**，绝不把原始批次塞进去（那是用户全部家当） */
  function analysisSnapshot(src) {
    var out = { annual: null, cost: null };
    if (src.annual) {
      out.annual = pick(src.annual, ['year', 'count', 'volumeL', 'avgEfficiency', 'costPerL',
        'completedCount', 'estimatedVolume', 'totalCost', 'costedVolumeL', 'warnings']);
      out.annual.styleDist = (src.annual.styleDist || []).map(function (s) {
        return pick(s, ['styleId', 'name', 'count', 'pct']);
      });
      out.annual.monthly = (src.annual.monthly || []).map(function (m) {
        return pick(m, ['month', 'count', 'volumeL']);
      });
    }
    if (src.cost) {
      out.cost = pick(src.cost, ['year', 'total', 'perLiter', 'perBatch', 'costedBatches',
        'costedVolumeL', 'estimatedVolume', 'warnings']);
      out.cost.byMonth = (src.cost.byMonth || []).map(function (m) {
        return pick(m, ['month', 'cost', 'volumeL', 'batches', 'costed']);
      });
    }
    return out;
  }

  /** 载荷里有几条"可数对象"，用来给超限提示算"建议只分享其中 N 条" */
  function countOf(d) {
    if (Object.prototype.toString.call(d) === '[object Array]') return d.length;
    if (!d || typeof d !== 'object') return 0;
    if (Array.isArray(d.items)) return d.items.length;
    var n = 0, k;
    for (k in d) {
      if (Array.isArray(d[k])) n += d[k].length;
    }
    return n;
  }

  /**
   * 任意对象 → BL2 码
   * @param {string} type TYPES 里的 t
   * @param {*} data  该类型的对象 / 数组
   * @param {{at?:string}} opts at = 生成时间（ISO 串，由调用方给）
   */
  ShareCode.encodeAny = function (type, data, opts) {
    opts = opts || {};
    var meta = typeMeta(String(type || ''));
    if (!meta) {
      throwFail('bad-type', '不支持分享「' + String(type) + '」：可分享的是配方、原料、批次、酒标、分析、库存');
    }

    var prep = prepare(meta.t, data);
    var body = { t: meta.t, v: V2, app: 'BrewLab', d: prep.d };
    /* at 只在调用方给了才写：本文件不取当前时间（见文件头的"纯度"一条） */
    if (opts.at) body.at = String(opts.at);
    /* 图片被剔除是一个"必须让用户知道"的事实，写进载荷让导入端也能提示 */
    if (prep.stripped) body.img = 0;

    var json = JSON.stringify(body);
    var bytes = utf8Encode(json);
    var payload = b64uEncode(bytes);
    var text = PREFIX2 + '.' + crcHex(payload) + '.' + payload;
    var chars = text.length;

    if (chars > SIZE_MAX) {
      var cnt = countOf(prep.d);
      var tip = '';
      if (cnt > 1) {
        var n = Math.max(1, Math.floor(cnt * SIZE_MAX / chars));
        tip = '；建议只分享其中 ' + n + ' 条（约能装下 ' + n + ' 条）';
      }
      var err = new Error('内容太大：当前 ' + chars + ' 字符 / 上限 ' + SIZE_MAX + ' 字符' + tip +
        '。也可以改用「导出 JSON」存成文件发给对方');
      err.code = 'too-large';
      err.chars = chars;
      err.max = SIZE_MAX;
      err.count = cnt;
      err.shareCode = true;
      throw err;
    }

    var notes = [];
    if (prep.stripped) {
      notes.push('图片本体没有放进分享码（一张图约 26 万字符，塞进去码就废了）：对方导入后需要自己重新选图');
    }
    if (meta.t === 'batches' && (Array.isArray(data) && data.length > 50)) {
      notes.push('批次很多，只带了前 50 条');
    }

    var sizeLevel = chars > SIZE_WARN ? 'long' : 'ok';
    return {
      text: text,
      type: meta.t,
      chars: chars,
      bytes: bytes.length,
      payload: payload,
      sizeLevel: sizeLevel,
      message: sizeLevel === 'long'
        ? '码较长（' + chars + ' 字符），部分聊天软件会截断。建议用剪贴板直接粘贴，或改用 JSON 文件导出'
        : '',
      notes: notes,
      imagesStripped: !!prep.stripped
    };
  };

  /** 只认前缀。不做正则全匹配 —— "只看前缀"是刻意的：
   *  用户粘错内容时，我们希望先告诉他"这是公式码 / 这不是分享码"，
   *  而不是丢一句"格式不正确"。 */
  ShareCode.detect = function (text) {
    var s = normalization(text);
    if (!s) return 'unknown';
    if (s.indexOf(PREFIX + '.') === 0) return PREFIX;
    if (s.indexOf(PREFIX2 + '.') === 0) return PREFIX2;
    if (s.indexOf(PREFIX3 + '.') === 0) return PREFIX3;
    if (s.indexOf(FORMULA_PREFIX + '.') === 0) return FORMULA_PREFIX;
    return 'unknown';
  };

  function normalization(text) {
    return String(text === null || text === undefined ? '' : text).replace(/[\s\u3000]+/g, '');
  }

  /** 错误码 → 人话。**每一句都要能指导下一步动作**，
   *  不许出现 undefined / NaN / 英文堆栈（那是把调试信息丢给用户）。 */
  var REASON = {
    'crc': '校验位不符，可能复制时少了字符：请让对方重新完整复制一次',
    'bad-version': '这个码是更高版本生成的，当前版本读不了；请升级 BrewLab 后再导入',
    'bad-payload': '码的中段解不开，多半是复制时漏了一段：请重新完整复制',
    'bad-json': '码的内容损坏，解出来不是有效数据：请重新复制',
    'bad-content': '这个码的内部格式当前版本读不了，可能是更早或更晚的版本生成的',
    'bad-type': '这个码里的对象类型当前版本不认识，请升级后再试',
    'too-large': '这段文本太长了，不像是分享码：确认复制的是分享码，而不是导出的 JSON 文件',
    'not-share-code': '这不是 BrewLab 分享码：分享码以 BL1. / BL2. / BZ1. 开头，是一长串字母数字',
    'empty': '分享码是空的，先把对方发的那段粘进来',
    'formula-code': '这是公式分享码（BF1），请到公式编辑器里导入',
    'kind-mismatch': '这串码是配方分享码（BL1），不是 v2 对象码',
    'corrupt': '这段压缩码损坏了（解压后的长度或校验位对不上）：请让对方重新生成一次',
    'empty-bundle': '这个分享包里一块内容都没有'
  };

  function fail(kind, code, reason) {
    return { ok: false, kind: kind, code: code, reason: String(reason || REASON[code] || '这段码读不了') };
  }

  /**
   * 任意码 → { ok, kind, type, data, ... }
   * **不抛错**：失败一律返回 {ok:false, reason}（reason 是人话）。
   * BL1 走老的 decode 并原样返回 {type:'recipe'} —— 老码必须永远能读。
   */
  ShareCode.decodeAny = function (text, opts) {
    opts = opts || {};
    var s = normalization(text);
    if (!s) return fail('unknown', 'empty');

    var kind = ShareCode.detect(s);
    if (kind === 'unknown') return fail('unknown', 'not-share-code');
    if (kind === 'BF1') return fail('BF1', 'formula-code');
    if (kind === 'BL1') {
      /* 调用方明确要 v2 对象码时，BL1 要给出"这是什么"，而不是含糊的失败 */
      if (opts.expect === 'BL2') return fail('BL1', 'kind-mismatch');
      try {
        var one = ShareCode.decode(s);
        return {
          ok: true, kind: 'BL1', type: 'recipe', data: one.recipe,
          version: one.version, crcOk: one.crcOk, chars: s.length,
          imagesStripped: false
        };
      } catch (e) {
        return fail('BL1', e && e.code, REASON[(e && e.code) || '']);
      }
    }

    /* ---- BZ1：压缩过的分享包 ----
       只认分享包：压缩的是"一个信封"，解出来必须还是信封。
       万一将来压缩别的对象，这里会明确说"这不是分享包"，而不是把它当配方。 */
    if (kind === 'BZ1') {
      var zm = /^BZ1\.([0-9a-fA-F]{4})\.([A-Za-z0-9_-]+)$/.exec(s);
      if (!zm) return fail('BZ1', 'not-share-code', '码的形状不对：BZ1. 后面应该是 4 位校验位，再接内容');
      if (zm[2].length > BUNDLE_PAYLOAD_MAX) return fail('BZ1', 'too-large');
      if (crcHex(zm[2]) !== zm[1].toLowerCase()) return fail('BZ1', 'crc');
      var zo;
      try {
        zo = unpackText(zm[2]);
      } catch (e4) {
        /* 压缩帧自带的三种校验（长度 / 字节 CRC / UTF-8）都在 unpackText 里，
           报错文案已经是人话，直接透出 —— 用户需要知道"这段码坏了"，
           而不是"解不开"。 */
        return fail('BZ1', (e4 && e4.code) || 'bad-payload', (e4 && e4.message) || REASON['corrupt']);
      }
      if (!zo || typeof zo !== 'object') return fail('BZ1', 'bad-content');
      if (zo.type === 'bundle') return bundleFromObject(zo, 'BZ1', s);
      /* 兼容：万一有人把单对象压了（本项目自己不产出），按 BL2 的规则认类型 */
      var zmeta = typeMeta(String(zo.t || ''));
      if (!zmeta) return fail('BZ1', 'bad-type', '这段压缩码里没有分享包，也没有认识的对象类型');
      return {
        ok: true, kind: 'BZ1', type: zmeta.t,
        data: zmeta.t === 'recipe' ? expand(zo.d || {}) : zo.d,
        at: String(zo.at || ''), app: String(zo.app || ''),
        version: V2, crcOk: true, chars: s.length, imagesStripped: zo.img === 0
      };
    }

    /* ---- BL2 ---- */
    var m = /^BL2\.([0-9a-fA-F]{4})\.([A-Za-z0-9_-]+)$/.exec(s);
    if (!m) return fail('BL2', 'not-share-code', '码的形状不对：BL2. 后面应该是 4 位校验位，再接内容');

    var crcIn = m[1].toLowerCase();
    var payload = m[2];
    /* v1.8：分享包（bundle）比单对象大得多，明文档也可能超过 20000。
       所以"过长"不再提前拒绝，而是解出来再判 —— 是分享包就放行，
       不是分享包仍然报 too-large（保持原有文案与优先级）。 */
    var overLong = payload.length > MAX_PAYLOAD;
    if (payload.length > BUNDLE_PAYLOAD_MAX) return fail('BL2', 'too-large');
    if (crcHex(payload) !== crcIn) return fail('BL2', 'crc');

    var json;
    try {
      json = utf8Decode(b64uDecode(payload));
    } catch (e2) {
      return fail('BL2', 'bad-payload');
    }
    var o;
    try { o = JSON.parse(json); } catch (e3) { return fail('BL2', 'bad-json'); }
    if (!o || typeof o !== 'object') return fail('BL2', 'bad-content');

    /* 分享包在明文态走 BL2 前缀（压缩态走 BZ1），它的版本字段是 schema/v 而不是
       对象码的 v=2，所以必须在版本判定**之前**分流。 */
    if (o.type === 'bundle') return bundleFromObject(o, 'BL2', s);
    if (overLong) return fail('BL2', 'too-large');

    var ver = num(o.v, 0);
    if (ver > V2) return fail('BL2', 'bad-version');
    if (ver !== V2) return fail('BL2', 'bad-content', '分享码内容版本不符（期望 v=2，实际 ' + ver + '）');

    var meta = typeMeta(String(o.t || ''));
    if (!meta) {
      return fail('BL2', 'bad-type', '码里说的是「' + String(o.t || '未标注类型') + '」，当前版本不认识这种对象');
    }

    var data = o.d;
    if (meta.t === 'recipe') {
      /* recipe 的载荷是 v1 的紧凑投影，要展开成完整配方字段才能交给界面 */
      data = expand(o.d || {});
    }
    return {
      ok: true, kind: 'BL2', type: meta.t, data: data,
      at: String(o.at || ''), app: String(o.app || ''),
      version: V2, crcOk: true, chars: s.length,
      imagesStripped: o.img === 0
    };
  };

  /* ======================================================================
   * 三·六、v1.8：分享包（bundle）+ 本地压缩（BZ1）
   * ----------------------------------------------------------------------
   * 用户的原话是"我们得到的太长的分享码能不能试着本地压缩一下再给对方，
   * 对方拿到之后再本地解压"、"用户不论点击几个勾选项，最终给出的分享码
   * 或者是 JSON 文件最好都是一个"。
   *
   * 为什么不用 CompressionStream：
   *   它是 **async** 的（compress() 返回 Promise<ReadableStream>），而
   *   encode / encodeAny / decode / decodeAny / detect / describe 全是同步
   *   契约 —— 41 号界面、42 号配方页、43a 公式模块、tools 下 7 套断言都按
   *   同步返回值写。改成异步等于把整条链路变成 Promise：一处漏了 await 就是
   *   "码没生成出来、界面却显示成功"，而且这种错不会抛异常，只会让输入框空着。
   *   换来的只是省掉下面这 120 行。不值。
   *   另外 file:// 下 CompressionStream 在 Safari 15-16 与少量国产内核里没有，
   *   手写实现反而更"离线可跑"。
   *
   * 为什么手写 LZ 现在可以接受（v1.2 时文件头写过"不做压缩"）：
   *   那条理由针对的是 **BL1**，理由是"LZ 一旦有 bug 就是静默解出错误配方"。
   *   现在的前提变了：① BL1 冻结只读，压缩只作用在新前缀 BZ1 上；② 三重校验
   *   让"解错"变成"报错"——前缀里 4 位 CRC（算在 base64 串上，改任意一个字符
   *   必被检出）、帧头里的原文字节数、帧头里的原有字节 CRC16。任何一道不过都
   *   抛错，**绝不返回半个对象**。
   *
   * 帧结构（在 base64url 之前的字节里，见 packText）：
   *   [0]      版本 = 1
   *   [1]      标志位 bit0：1 = LZSS 压缩，0 = 原样存放
   *   [2..]    varint 原文字节数
   *   [..]     原文字节的 CRC16（大端 2 字节）
   *   [..]     正文（压缩后 / 原样）
   * 压缩算法：LZSS。12 位回溯距离（1–4096）、4 位长度字段（3–17，
   *   15 是逃逸位 → 再读 8 位表示 18–273）、每个记号前面 1 位标志。
   *   输出走字节，再 base64url —— 与 LZ-string 的 URI 变体同一个效率
   *   （每 6 位一个字符），但不需要那套 65 字符表。
   * ====================================================================*/

  var BUNDLE_WARN = 4000;            /* 超过就提示"建议改用 JSON 文件" */
  var BUNDLE_MAX = 200000;           /* 再大就不生成码了（JSON 文件无此限） */
  var BUNDLE_PAYLOAD_MAX = 300000;   /* 解码端的荒谬值兜底 */

  /* ---------------- 位流 ---------------- */
  function BitW() { this.buf = 0; this.n = 0; this.out = []; }
  BitW.prototype.put = function (v, bits) {
    this.buf = (this.buf << bits) | (v & ((1 << bits) - 1));
    this.n += bits;
    while (this.n >= 8) {
      this.n -= 8;
      this.out.push((this.buf >>> this.n) & 0xFF);
    }
    this.buf &= (1 << this.n) - 1;      /* 只留剩下的低位，否则下一轮会把旧位带出来 */
  };
  BitW.prototype.done = function () {
    if (this.n > 0) {
      this.out.push((this.buf << (8 - this.n)) & 0xFF);
      this.n = 0;
      this.buf = 0;
    }
    return this.out;
  };

  function BitR(bytes) { this.b = bytes; this.pos = 0; this.buf = 0; this.n = 0; }
  BitR.prototype.get = function (bits) {
    while (this.n < bits) {
      if (this.pos >= this.b.length) throw lzErr('这段码损坏了（压缩数据提前结束）');
      this.buf = (this.buf << 8) | this.b[this.pos++];
      this.n += 8;
    }
    this.n -= bits;
    var v = (this.buf >>> this.n) & ((1 << bits) - 1);
    this.buf &= (1 << this.n) - 1;
    return v;
  };

  function lzErr(msg) {
    var e = new Error(msg);
    e.code = 'corrupt';
    return e;
  }

  var LZ_WIN = 4096, LZ_MIN = 3, LZ_MAX = 273, LZ_HSIZE = 4096, LZ_CHAIN = 24;

  function lzHash(a, i) {
    var h = Math.imul(a[i], 0x9E3779B1) ^ Math.imul(a[i + 1], 0x85EBCA77) ^ Math.imul(a[i + 2], 0xC2B2AE3D);
    return (h >>> 12) & (LZ_HSIZE - 1);
  }

  /** 字节数组 → 字节数组（确定性：同一输入永远同一输出，测试才能钉死长度） */
  function lzCompress(src) {
    var n = src.length, out = new BitW();
    var head = new Int32Array(LZ_HSIZE), prev = new Int32Array(n);
    var i, k;

    function insert(p) {
      if (p + LZ_MIN > n) return;
      var h = lzHash(src, p);
      prev[p] = head[h];
      head[h] = p;
    }

    for (i = 0; i < LZ_HSIZE; i++) head[i] = -1;
    for (i = 0; i < n; i++) prev[i] = -1;

    i = 0;
    while (i < n) {
      var bestLen = 0, bestOff = 0;
      if (i + LZ_MIN <= n) {
        var maxLen = Math.min(LZ_MAX, n - i);
        var cand = head[lzHash(src, i)], tries = 0;
        while (cand >= 0 && tries < LZ_CHAIN) {
          var off = i - cand;
          /* 链上的位置是单调递减的：一旦超出窗口，后面的只会更远 → 直接收工 */
          if (off > LZ_WIN) break;
          if (src[cand] === src[i] && src[cand + bestLen] === src[i + bestLen]) {
            var l = 0;
            while (l < maxLen && src[cand + l] === src[i + l]) l++;
            if (l > bestLen) {
              bestLen = l;
              bestOff = off;
              if (l >= maxLen) break;
            }
          }
          cand = prev[cand];
          tries++;
        }
      }
      if (bestLen >= LZ_MIN) {
        out.put(1, 1);
        out.put(bestOff - 1, 12);
        if (bestLen <= 17) {
          out.put(bestLen - LZ_MIN, 4);              /* 0..14 */
        } else {
          out.put(15, 4);                            /* 逃逸位 */
          out.put(Math.min(bestLen - 18, 255), 8);
        }
        for (k = 0; k < bestLen; k++) insert(i + k);
        i += bestLen;
      } else {
        out.put(0, 1);
        out.put(src[i], 8);
        insert(i);
        i++;
      }
    }
    return out.done();
  }

  /** 字节数组 + 期望长度 → 字节数组。cap 来自帧头，是唯一的终止条件
   *  （编码端不写结束符：多一个结束符就多一种"解到底了但以为还没结束"的错法）。 */
  function lzExpand(src, cap) {
    var r = new BitR(src), out = [], k;
    while (out.length < cap) {
      if (r.get(1) === 0) {
        out.push(r.get(8));
        continue;
      }
      var off = r.get(12) + 1;
      var lf = r.get(4);
      var len = lf < 15 ? lf + LZ_MIN : 18 + r.get(8);
      if (off > out.length) throw lzErr('这段码损坏了（压缩数据引用了不存在的位置）');
      for (k = 0; k < len; k++) out.push(out[out.length - off]);
      if (out.length > cap) throw lzErr('这段码损坏了（解出的内容比声明的长）');
    }
    return out;
  }

  /* ---------------- 帧打包 ---------------- */
  function varintPut(arr, v) {
    while (v >= 0x80) {
      arr.push((v & 0x7F) | 0x80);
      v = Math.floor(v / 128);
    }
    arr.push(v);
  }
  function varintGet(arr, p) {
    var v = 0, mul = 1, b, guard = 0;
    do {
      if (p >= arr.length) throw lzErr('这段码损坏了（帧头被截断）');
      b = arr[p++];
      v += (b & 0x7F) * mul;
      mul *= 128;
      if (++guard > 4) throw lzErr('这段码损坏了（帧头的长度字段不合法）');
    } while (b & 0x80);
    return { v: v, next: p };
  }

  /** JSON 串 → { bytes: 帧字节数组, head: 帧头长度 }
   *  自动决定压不压：压完不变短就原样存放（flags bit0 = 0）。 */
  function packText(json) {
    var raw = utf8Encode(json);
    var comp = lzCompress(raw);
    var useComp = comp.length < raw.length;
    var body = useComp ? comp : raw;
    var head = [1, useComp ? 1 : 0];
    varintPut(head, raw.length);
    var c = crc16Bytes(raw);
    head.push((c >> 8) & 0xFF, c & 0xFF);
    return { bytes: head.concat(body), head: head.length, packed: useComp };
  }

  /** 帧字节（base64url 串） → 对象。任何一道校验不过都抛 code:'corrupt' */
  function unpackText(payload) {
    var bytes;
    try {
      bytes = b64uDecode(payload);
    } catch (e) {
      throw lzErr('这段码损坏了（内容不是合法的 base64：' + ((e && e.message) || '含非法字符') + '）');
    }
    if (bytes.length < 4) throw lzErr('这段码损坏了（内容太短，多半被截断）');
    if (bytes[0] !== 1) throw lzErr('这段压缩码的帧格式当前软件读不了（帧版本 ' + bytes[0] + '）');

    var flags = bytes[1];
    var got = varintGet(bytes, 2);
    var p = got.next;
    var rawLen = got.v;
    if (p + 2 > bytes.length) throw lzErr('这段码损坏了（帧头不完整）');
    var crcIn = (bytes[p] << 8) | bytes[p + 1];
    p += 2;

    var body = bytes.slice(p);
    var raw = (flags & 1) ? lzExpand(body, rawLen) : body;
    if (raw.length !== rawLen) {
      throw lzErr('这段码损坏了（解出 ' + raw.length + ' 字节，帧头声明的却是 ' + rawLen + ' 字节）');
    }
    if (crc16Bytes(raw) !== crcIn) {
      throw lzErr('这段码损坏了（解压后的内容和帧头的校验位对不上）');
    }
    var json;
    try {
      json = utf8Decode(raw);
    } catch (e2) {
      throw lzErr('这段码损坏了（内容不是有效文本）');
    }
    try {
      return JSON.parse(json);
    } catch (e3) {
      throw lzErr('这段码损坏了（解出来不是有效数据）');
    }
  }

  /* ---------------- 分享包的块清单 ----------------
   * 顺序 = 勾选面板的显示顺序 = 落库顺序。
   * 12 块，分 5 组：原料 / 配方 / 记录 / 产出 / 设置。 */
  var PART_META = {
    malts: { label: '自建麦芽', unit: '条', group: '原料' },
    hops: { label: '自建酒花', unit: '条', group: '原料' },
    yeasts: { label: '自建酵母', unit: '条', group: '原料' },
    adjuncts: { label: '自建辅料', unit: '条', group: '原料' },
    recipe: { label: '当前配方', unit: '份', group: '配方' },
    recipes: { label: '已保存配方', unit: '份', group: '配方' },
    batches: { label: '批次列表', unit: '锅', group: '记录' },
    brewday: { label: '酿造日记录', unit: '锅', group: '记录' },
    label: { label: '酒标', unit: '张', group: '产出' },
    analysis: { label: '分析快照', unit: '份', group: '产出' },
    inventory: { label: '库存', unit: '项', group: '产出' },
    settings: { label: '本地设置', unit: '项', group: '设置' }
  };
  var PART_ORDER = ['malts', 'hops', 'yeasts', 'adjuncts', 'recipe', 'recipes',
    'batches', 'brewday', 'label', 'analysis', 'inventory', 'settings'];

  function partCount(k, v) {
    if (v === null || v === undefined) return 0;
    if (k === 'malts' || k === 'hops' || k === 'yeasts' || k === 'adjuncts') {
      return Array.isArray(v) ? v.length : 0;
    }
    if (k === 'recipes' || k === 'batches') return Array.isArray(v) ? v.length : 0;
    if (k === 'settings') {
      var n = 0, kk;
      for (kk in v) if (Object.prototype.hasOwnProperty.call(v, kk)) n++;
      return n;
    }
    if (k === 'inventory') return ((v.items || []).length ? (v.items || []).length : 1);
    if (k === 'recipe') return v.name || v.f || v.h || v.y || v.ad || v.m ? 1 : 0;
    return 1;
  }

  /** 每块按"对方拿到能重建"的口径投影，与 encodeAny 的投影完全同源 */
  function shapePart(k, v, opts) {
    var i, out;
    if (v === null || v === undefined) return undefined;
    if (k === 'malts' || k === 'hops' || k === 'yeasts' || k === 'adjuncts') {
      var arr = Array.isArray(v) ? v : [];
      out = [];
      for (i = 0; i < arr.length && i < 400; i++) {
        if (!arr[i]) continue;
        var row = sanitize(pick(arr[i], SLIM_KEYS[k]), opts);
        row.custom = arr[i].custom !== false;
        out.push(row);
      }
      return out;
    }
    if (k === 'recipe') return sanitize(project(v), opts);
    if (k === 'recipes') {
      var src = Array.isArray(v) ? v : [];
      out = [];
      for (i = 0; i < src.length && i < 200; i++) {
        if (src[i]) out.push(sanitize(project(src[i]), opts));
      }
      return out;
    }
    if (k === 'batches') {
      var list = Array.isArray(v) ? v : [];
      return list.slice(0, 50).map(function (x) { return sanitize(slimBatch(x), opts); });
    }
    if (k === 'brewday') {
      var bb = v || {};
      return sanitize({
        batchNo: bb.batchNo || '', name: bb.name || (bb.recipeSnapshot || {}).name || '',
        brewDate: bb.brewDate || '', status: bb.status || '',
        brewday: bb.brewday || null, actual: bb.actual || null,
        readings: (bb.readings || []).slice(0, 60)
      }, opts);
    }
    if (k === 'label') return sanitize(v, opts);
    if (k === 'analysis') return sanitize(analysisSnapshot(v || {}), opts);
    if (k === 'inventory') {
      var inv = v || {};
      return sanitize({
        items: (inv.items || []).slice(0, 400),
        moves: (inv.moves || []).slice(-400)
      }, opts);
    }
    if (k === 'settings') return sanitize(v, opts);
    return undefined;
  }

  function bundleBlocksOf(parts) {
    var out = [], i, k, n;
    for (i = 0; i < PART_ORDER.length; i++) {
      k = PART_ORDER[i];
      if (!Object.prototype.hasOwnProperty.call(parts, k)) continue;
      n = partCount(k, parts[k]);
      if (!n) continue;
      out.push({ key: k, label: PART_META[k].label, group: PART_META[k].group, unit: PART_META[k].unit, count: n });
    }
    return out;
  }

  /** 供 41 号界面渲染勾选面板 */
  ShareCode.partMeta = function () {
    return PART_ORDER.map(function (k) {
      return { key: k, label: PART_META[k].label, unit: PART_META[k].unit, group: PART_META[k].group };
    });
  };

  /**
   * 分享包 → 一个码（或一份 JSON）
   * @param {object} rawParts 形如 { malts:[…], recipe:{…}, settings:{…} }
   * @param {{at?:string, jsonOnly?:boolean}} opts
   *   jsonOnly = true 时不生成码、不做长度拦截，只把信封吐出来。
   *   为什么需要这个开关（v1.8 用户第 3 条要求）：
   *     全库压缩后实测 67,653 字符，远超分享码能用的长度。用户在勾选面板里
   *     选了 8 块，如果只得到一句"太大，不能生成"，那就是把这个功能**做成了
   *     一个死胡同**。用户的原话是"分享码或者 JSON 文件最好都是一个"——
   *     所以"太大了"必须能**直接换成另一种交付形式**，而不是结束。
   *     这时候码本身不用算了（算了也发不出去），只把同一份 parts 序列化成文件。
   * @returns {{text, format:'BZ1'|'BL2'|'', chars, plainChars, packedChars,
   *            blocks, json, env, sizeLevel, message, notes, imagesStripped}}
   *   format：自动选短的那个。压缩后不比明文短时走 BL2 明文（这时 describe
   *   会说"分享包（BL2 明文）"），因为 BZ1 即使 flags=0 也多 5 字节帧头。
   */
  ShareCode.encodeBundle = function (rawParts, opts) {
    opts = opts || {};
    var optsS = { stripped: false };
    var src = rawParts || {};
    var parts = {}, i, k, shaped, n;

    for (i = 0; i < PART_ORDER.length; i++) {
      k = PART_ORDER[i];
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      shaped = shapePart(k, src[k], optsS);
      n = partCount(k, shaped);
      if (shaped === undefined || !n) continue;
      parts[k] = shaped;
    }

    var blocks = bundleBlocksOf(parts);
    if (!blocks.length) throwFail('empty-bundle', '没有勾选任何有内容的块：至少选一块再生成');

    var env = { app: 'BrewLab', schema: 1, type: 'bundle', v: 1, parts: parts };
    if (opts.at) env.at = String(opts.at);
    if (optsS.stripped) env.img = 0;

    var notes = [];
    if (optsS.stripped) {
      notes.push('图片本体没有放进分享包（一张图约 26 万字符）：对方导入后需要自己重新选图');
    }
    for (i = 0; i < blocks.length; i++) {
      if (blocks[i].key === 'batches' && Array.isArray(src.batches) && src.batches.length > 50) {
        notes.push('批次只带了前 50 锅');
      }
      if (blocks[i].key === 'recipes' && Array.isArray(src.recipes) && src.recipes.length > 200) {
        notes.push('已保存配方只带了前 200 份');
      }
    }

    var json = JSON.stringify(env);
    var jsonBytes = utf8Encode(json);

    /* 只要文件：跳过压缩（67 KB 的内容算了也发不出去，白等 200ms） */
    if (opts.jsonOnly) {
      return {
        text: '', format: '', chars: 0, plainChars: 0, packedChars: 0,
        bytes: jsonBytes.length, payload: '',
        blocks: blocks, env: env, json: json,
        frameHead: 0, framePacked: false,
        sizeLevel: 'ok', message: '', notes: notes,
        imagesStripped: !!optsS.stripped
      };
    }

    var frame = packText(json);
    var payloadZ = b64uEncode(frame.bytes);
    var textZ = PREFIX3 + '.' + crcHex(payloadZ) + '.' + payloadZ;
    var payloadP = b64uEncode(jsonBytes);
    var textP = PREFIX2 + '.' + crcHex(payloadP) + '.' + payloadP;

    var usePacked = textZ.length < textP.length;
    var text = usePacked ? textZ : textP;
    var chars = text.length;

    if (chars > BUNDLE_MAX) {
      var e = new Error('勾选的内容太大：分享码会有 ' + chars + ' 字符（上限 ' + BUNDLE_MAX + '）。' +
        '请取消几个块，或改用「导出 JSON 文件」—— 文件没有长度限制');
      e.code = 'too-large';
      e.chars = chars;
      e.max = BUNDLE_MAX;
      e.shareCode = true;
      throw e;
    }

    var sizeLevel = chars > BUNDLE_WARN ? 'long' : 'ok';
    return {
      text: text,
      format: usePacked ? PREFIX3 : PREFIX2,
      chars: chars,
      plainChars: textP.length,
      packedChars: textZ.length,
      bytes: jsonBytes.length,
      payload: usePacked ? payloadZ : payloadP,
      blocks: blocks,
      env: env,
      json: json,
      frameHead: frame.head,
      framePacked: frame.packed,
      sizeLevel: sizeLevel,
      message: sizeLevel === 'long'
        ? '码较长（' + chars + ' 字符），粘贴到聊天软件可能被截断。建议改用「导出 JSON 文件」发给对方'
        : '',
      notes: notes,
      imagesStripped: !!optsS.stripped
    };
  };

  /** 分享包对象 → decodeAny 的统一结果（BZ1 与明文 BL2 共用） */
  function bundleFromObject(o, kind, raw) {
    if (String(o.app || '') !== 'BrewLab') {
      return fail(kind, 'bad-content', '这个分享包里没有 BrewLab 标识，可能不是本软件生成的');
    }
    if (o.type !== 'bundle') return fail(kind, 'bad-content', '这个分享包的类型字段不对');
    var sc = num(o.schema, 0);
    if (sc > 1) {
      return fail(kind, 'bad-version', '这个分享包是 schema ' + sc + ' 生成的，当前软件只认 schema 1；请升级后再导入');
    }
    if (sc !== 1) {
      return fail(kind, 'bad-content', '分享包的 schema 字段不对（期望 1，实际 ' + sc + '）');
    }
    var src = (o.parts && typeof o.parts === 'object') ? o.parts : null;
    if (!src) return fail(kind, 'bad-content', '分享包里没有 parts 段');

    var parts = {}, blocks = [], i, k, v;
    for (i = 0; i < PART_ORDER.length; i++) {
      k = PART_ORDER[i];
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      v = src[k];
      if (v === null || v === undefined) continue;
      /* 配方在码里是 v1 紧凑投影，要展开成完整字段才能交给界面 */
      if (k === 'recipe') v = expand(v || {});
      else if (k === 'recipes') {
        v = (Array.isArray(v) ? v : []).map(function (x) { return expand(x || {}); });
      }
      if (!partCount(k, v)) continue;
      parts[k] = v;
    }
    blocks = bundleBlocksOf(parts);
    if (!blocks.length) return fail(kind, 'bad-content', '这个分享包里一块内容都没有');

    return {
      ok: true, kind: kind, type: 'bundle',
      data: { parts: parts },
      blocks: blocks,
      at: String(o.at || ''), app: String(o.app || ''),
      version: 1, crcOk: true, chars: String(raw || '').length,
      imagesStripped: o.img === 0
    };
  }

  /**
   * 分享文件（已 JSON.parse 的对象）→ 与 decodeAny 同形的结果。
   * 单独开这个入口而不是让界面自己判 app/schema：JSON 文件与分享码必须是
   * **同一套校验**，否则"码进得来、文件进不来"或者反过来，两边就此分叉。
   * 陌生 JSON 一律给中文理由（e.code='not-share-file'），绝不抛异常。
   */
  ShareCode.readBundle = function (obj) {
    if (!obj || typeof obj !== 'object' || Object.prototype.toString.call(obj) === '[object Array]') {
      return { ok: false, kind: 'JSON', code: 'not-share-file',
        reason: '这个文件不是本软件的分享文件：里面不是一条 JSON 对象' };
    }
    if (String(obj.app || '') !== 'BrewLab') {
      return { ok: false, kind: 'JSON', code: 'not-share-file',
        reason: '这个文件不是本软件的分享文件：没有 BrewLab 标识（它可能是别的软件导出的 JSON）' };
    }
    if (obj.type !== 'bundle') {
      return { ok: false, kind: 'JSON', code: 'not-share-file',
        reason: '这个 JSON 是 BrewLab 的，但不是分享包（type=' + String(obj.type || '空') + '）' };
    }
    return bundleFromObject(obj, 'JSON', '');
  };

  /** 一串码的基本信息（不解析内容，只给界面用来"先说我认出了什么"） */  ShareCode.describe = function (text) {
    var kind = ShareCode.detect(text);
    if (kind === 'unknown') return { kind: kind, label: '认不出', type: '' };
    if (kind === 'BF1') return { kind: kind, label: '公式码', type: 'formula' };
    if (kind === 'BL1') return { kind: kind, label: '配方（BL1 老码）', type: 'recipe' };

    /* BZ1 与"明文态是分享包的 BL2"都要真解一次才知道块数；
       解不开就不猜（猜错比不知道更糟）。 */
    var got = ShareCode.decodeAny(text);
    if (kind === 'BZ1') {
      if (!got.ok) return { kind: kind, label: '压缩分享包（内容读不出）', type: 'bundle' };
      var zb = (got.blocks || []).length;
      return {
        kind: kind, type: got.type,
        label: got.type === 'bundle' ? ('压缩分享包（BZ1）：含 ' + zb + ' 块') : (ShareCode.typeLabel(got.type) + '（BZ1 压缩）'),
        blocks: zb
      };
    }
    if (!got.ok) return { kind: kind, label: 'v2 对象码（内容读不出）', type: '' };
    if (got.type === 'bundle') {
      var nb = (got.blocks || []).length;
      return { kind: kind, type: 'bundle', label: '分享包（BL2 明文）：含 ' + nb + ' 块', blocks: nb };
    }
    return { kind: kind, label: ShareCode.typeLabel(got.type) + '（BL2）', type: got.type };
  };

  /* ======================================================================
   * 四、自检
   * ====================================================================*/
  ShareCode.selfCheck = function () {
    var errors = [], warns = [], total = 0;
    function ok(name, cond, detail) {
      total++;
      if (!cond) errors.push(name + (detail ? '：' + detail : ''));
    }

    var sample = {
      name: '测试 IPA · 中文名字要能往返',
      styleId: '21A',
      batchSize: 20,
      efficiency: 72,
      boilTime: 60,
      notes: '第一版：西楚 + 马赛克，干投 3 天',
      fermentables: [
        { id: 'm-2row', amount: 5, ppg: 37, lov: 2, cat: 'base', mustMash: true, fermentable: 'high' },
        { id: 'm-c40', amount: 0.4, ppg: 34, lov: 40, cat: 'crystal', mustMash: false, fermentable: 'low' }
      ],
      hops: [{ id: 'h-citra', amount: 30, aa: 12.5, stage: 'boil', time: 15 }],
      yeasts: [{ id: 'y-us05', amount: 11, att: 79.5, type: 'ale' }],
      adjuncts: [],
      water: { profileId: 'wp-shanghai', source: { ca: 40, mg: 8, na: 30, cl: 35, so4: 40, hco3: 90 }, salts: [{ id: 'w-gypsum', amount: 4 }] },
      mash: { steps: [{ name: '糖化', tempC: 66, minutes: 60 }, { name: '出糖', tempC: 76, minutes: 10 }] },
      carbonation: { targetVol: 2.5, tempC: 20, sugarType: 'sucrose' },
      targets: { og: 1.056, fg: null, abv: null, ibu: 45, srm: null }
    };

    /* 1. 往返 */
    var enc = ShareCode.encode(sample);
    var dec = ShareCode.decode(enc.text);
    ok('往返后名字一致', dec.recipe.name === sample.name, dec.recipe.name);
    ok('往返后麦芽行数一致', dec.recipe.fermentables.length === 2);
    ok('往返后用量一致', dec.recipe.fermentables[0].amount === 5);
    ok('往返后水量一致', dec.recipe.water.source.so4 === 40);
    ok('crcOk 为 true', dec.crcOk === true);
    ok('版本为 1', dec.version === 1);

    /* 2. 篡改必须抛错（不是静默返回半个配方） */
    var tampered = enc.text.slice(0, -1) + (enc.text.slice(-1) === 'A' ? 'B' : 'A');
    var threw = false;
    try { ShareCode.decode(tampered); } catch (e) { threw = true; }
    ok('改最后一字符会抛错', threw);

    var mid = enc.text.length >> 1;
    var t2 = enc.text.slice(0, mid) + (enc.text.charAt(mid) === 'x' ? 'y' : 'x') + enc.text.slice(mid + 1);
    var threw2 = false;
    try { ShareCode.decode(t2); } catch (e2) { threw2 = true; }
    ok('改中间字符会抛错', threw2);

    /* 3. 截断 */
    var threw3 = false;
    try { ShareCode.decode(enc.text.slice(0, enc.text.length - 20)); } catch (e3) { threw3 = true; }
    ok('截断会抛错', threw3);

    /* 4. 脏输入 */
    ['', null, undefined, 'hello', 'BL1.zzzz.abc', 'BL9.0000.abc'].forEach(function (bad, i) {
      var t = false;
      try { ShareCode.decode(bad); } catch (e) { t = true; }
      ok('脏输入 #' + i + ' 会抛错', t);
    });

    /* 5. 空配方也能往返 */
    var empty = ShareCode.encode({ name: '空配方' });
    ok('空配方可往返', ShareCode.decode(empty.text).recipe.name === '空配方');
    ok('空配方码很短', empty.chars < 60, 'chars=' + empty.chars);

    /* 6. 错误码：界面靠 code 翻人话，不靠匹配中文串 */
    function codeOf(t) {
      try { ShareCode.decode(t); return null; } catch (e) { return e.code || null; }
    }
    ok('空串 → empty', codeOf('') === 'empty', String(codeOf('')));
    ok('乱文本 → not-share-code', codeOf('hello') === 'not-share-code', String(codeOf('hello')));
    ok('未知版本 → bad-version', codeOf('BL9.0000.abc') === 'bad-version', String(codeOf('BL9.0000.abc')));
    ok('被篡改 → crc', codeOf(tampered) === 'crc', String(codeOf(tampered)));

    /* 7. 长度分档：≤1200 ok / 1200–4000 long / >4000 抛 too-large */
    function hopsN(n) {
      var arr = [];
      for (var i = 0; i < n; i++) {
        arr.push({ id: 'h-citra', amount: 20, aa: 12.5, stage: 'boil', time: 60 });
      }
      return arr;
    }
    var mid = ShareCode.encode({ name: '中等', hops: hopsN(30) });
    ok('1200–4000 标 long', mid.chars > 1200 && mid.chars <= 4000 && mid.sizeLevel === 'long',
      mid.chars + '/' + mid.sizeLevel);
    ok('long 带提示文案', /聊天软件/.test(mid.message));
    var small = ShareCode.encode({ name: '小' });
    ok('短码标 ok 且无提示', small.sizeLevel === 'ok' && small.message === '');
    var tooBig = null;
    try { ShareCode.encode({ name: '巨大', hops: hopsN(120) }); } catch (e) { tooBig = e; }
    ok('>4000 抛 too-large', !!tooBig && tooBig.code === 'too-large', tooBig && tooBig.code);
    ok('too-large 提示改用 JSON 导出', !!tooBig && /JSON/.test(tooBig.message));

    /* 8. BL2 对象码：往返 + 前缀识别 + 与 BL1 的分工 */
    var b2 = ShareCode.encodeAny('malt', { id: 'mx', name: '测试麦芽', ppg: 37, lov: 2 }, { at: '2026-01-01T00:00:00.000Z' });
    ok('BL2 前缀正确', b2.text.indexOf('BL2.') === 0, b2.text.slice(0, 8));
    var d2 = ShareCode.decodeAny(b2.text);
    ok('BL2 麦芽往返一致', d2.ok === true && d2.type === 'malt' && d2.data.name === '测试麦芽');
    ok('detect 认 BL2', ShareCode.detect(b2.text) === 'BL2');
    ok('detect 认 BL1', ShareCode.detect(enc.text) === 'BL1');
    ok('detect 认公式码', ShareCode.detect('BF1.1a2b.abc') === 'BF1');
    ok('detect 认乱码', ShareCode.detect('hello world') === 'unknown');
    var b1 = ShareCode.decodeAny(enc.text);
    ok('decodeAny 对 BL1 返回 ok（老码不许报错）',
      b1.ok === true && b1.kind === 'BL1' && b1.type === 'recipe' && b1.data.name === sample.name);
    var formula = ShareCode.decodeAny('BF1.1a2b.abc');
    ok('公式码给出去公式编辑器的提示', formula.ok === false && /公式/.test(formula.reason));
    var tamper2 = b2.text.slice(0, -1) + (b2.text.slice(-1) === 'A' ? 'B' : 'A');
    var bad2 = ShareCode.decodeAny(tamper2);
    ok('BL2 篡改被检出（reason 是人话，不含 undefined/NaN）',
      bad2.ok === false && /校验位/.test(bad2.reason) && !/undefined|NaN/.test(bad2.reason));
    var bigErr = null;
    try {
      var huge = [];
      for (var q = 0; q < 300; q++) huge.push({ id: 'x' + q, name: '麦芽' + q, ppg: 37, lov: 2, flavor: '谷物' });
      ShareCode.encodeAny('library', { malts: huge });
    } catch (e) { bigErr = e; }
    ok('BL2 超限报错并带"当前 X / 上限 Y"',
      !!bigErr && /当前 \d+ 字符 \/ 上限 \d+ 字符/.test(bigErr.message), bigErr && bigErr.message);
    var smallLib = ShareCode.encodeAny('library', { malts: [{ id: 'a', name: '小库', ppg: 37 }] });
    ok('BL2 小库正常生成（对照，证明上一条不是全都超限）',
      smallLib.chars > 0 && smallLib.chars < 4000, smallLib.chars);

    /* 9. v1.8 分享包：多块装一个码 + 本地压缩往返 */
    var manyMalts = [];
    for (var mi = 0; mi < 60; mi++) {
      manyMalts.push({ id: 'cm' + mi, name: '自建麦芽 ' + mi, ppg: 37, lov: 3, cat: 'base', custom: true });
    }
    var pack = ShareCode.encodeBundle({
      malts: manyMalts,
      recipe: sample,
      settings: { units: 'metric', fontScale: 'std', resPreset: '1080' }
    }, { at: '2026-01-01T00:00:00.000Z' });
    ok('分享包是一个码（不是每块一个）', typeof pack.text === 'string' && pack.text.split('.').length === 3);
    ok('分享包把 3 块都装进了 parts', pack.blocks.length === 3, pack.blocks.length);
    ok('大对象自动选压缩格式 BZ1', pack.format === 'BZ1' && pack.text.indexOf('BZ1.') === 0, pack.format);
    ok('压缩后确实更短（压缩比 < 0.85）',
      pack.chars / pack.plainChars < 0.85, (pack.chars / pack.plainChars).toFixed(3));

    var back = ShareCode.decodeAny(pack.text);
    ok('BZ1 能被 decodeAny 读回', back.ok === true && back.kind === 'BZ1' && back.type === 'bundle',
      back.ok ? back.kind : back.reason);
    ok('读回后 3 块都在', (back.blocks || []).length === 3, (back.blocks || []).length);
    ok('读回后麦芽条数逐条一致', ((back.data.parts.malts) || []).length === 60);
    ok('读回后配方名逐字一致', ((back.data.parts.recipe) || {}).name === sample.name);
    ok('读回后设置逐键一致',
      ((back.data.parts.settings) || {}).fontScale === 'std' &&
      ((back.data.parts.settings) || {}).units === 'metric');

    var bzDesc = ShareCode.describe(pack.text);
    ok('describe 说得清这是压缩分享包、含 3 块',
      bzDesc.kind === 'BZ1' && /压缩分享包/.test(bzDesc.label) && /3 块/.test(bzDesc.label), bzDesc.label);

    /* 篡改：① 改前缀里的校验位 → crc；② 改正文里的一个字节再补对校验位 → corrupt。
       第②条才是真考验：它证明"前缀 CRC 对了也不等于内容对"。 */
    var wrongCrc = pack.text.slice(4, 8) === '0000' ? '1111' : '0000';
    var badCrc = ShareCode.decodeAny('BZ1.' + wrongCrc + pack.text.slice(8));
    ok('改前缀校验位 → 被检出（crc）', badCrc.ok === false && /校验位/.test(badCrc.reason), badCrc.reason);

    var zpayload = pack.payload;
    var zbytes = b64uDecode(zpayload);
    /* 改正文的第一个字节（帧头之后），再把前缀校验位重算对 ——
       这一步专门证明"前缀 CRC 对得上也不等于内容对得上" */
    zbytes[pack.frameHead] = (zbytes[pack.frameHead] + 1) & 0xFF;
    var ztamper = PREFIX3 + '.' + crcHex(b64uEncode(zbytes)) + '.' + b64uEncode(zbytes);
    var hitTamper = ShareCode.decodeAny(ztamper);
    ok('改正文一个字节（校验位重算对）→ 仍被检出，且不返回半个对象',
      hitTamper.ok === false && hitTamper.data === undefined && /损坏/.test(hitTamper.reason),
      hitTamper.reason);

    /* 小对象不该被压缩撑大：走明文 BL2 */
    var tiny = ShareCode.encodeBundle({ malts: manyMalts.slice(0, 1) }, {});
    ok('单条麦芽不压缩（自动挑短的那个，走 BL2 明文）',
      tiny.format === 'BL2' && tiny.text.indexOf('BL2.') === 0 && tiny.chars === tiny.plainChars,
      tiny.format + ' ' + tiny.plainChars + '/' + tiny.packedChars);
    ok('单条麦芽的分享包能被读回', ShareCode.decodeAny(tiny.text).ok === true);
    ok('空勾选直接报错（不产出空包）', (function () {
      try { ShareCode.encodeBundle({}, {}); return false; } catch (e) { return e.code === 'empty-bundle'; }
    })());

    return { ok: errors.length === 0, total: total, errors: errors, warns: warns };
  };


  /* ======================================================================
   * 编解码原语导出（v1.7）
   * ----------------------------------------------------------------------
   * 导出的理由不是"方便复用"，是**只留一份**。
   *
   * 公式分享码（BF1，见 js/43a-formulas.js）与对象码（BL2）用的是同一套
   * CRC16 与 base64url。43a 写的时候这几个函数在本文件里是私有的，够不着，
   * 于是在 43a:2399 一带又实现了一份。两份各自都能过测试，却可能在边界上
   * 给出不同结果 —— 那时 BL1 与 BF1 会变成互相读不了的码，**而且没有任何
   * 断言会红**。这个项目已经因为"同一件事两处实现"翻过两次车
   * （SRM↔EBC 各写一份、fallbackCalc 成了第二份引擎），不能再翻第三次。
   *
   * 只导出，不改行为：encode / encodeAny / decode / decodeAny / detect
   * 一个字符都没动，BL1 的字节级输出与导出前完全一致 —— 用户手里已有的码
   * 是既成事实，不许因为这次重构而变。
   *
   * 43a 侧的取用方式（它自己实现的那份降级为兜底）：
   *   var p = BREW.ShareCode && BREW.ShareCode.primitives;
   *   var f = (p && p.crc16) || crc16Local;
   * 每次调用现查，不抓快照 —— 抓快照会让"28 晚一步加载"永久降级且无人察觉。
   * ====================================================================*/
  ShareCode.primitives = {
    crc16: crc16,
    crcHex: crcHex,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    b64uEncode: b64uEncode,
    b64uDecode: b64uDecode,
    /* v1.8：压缩内核。导出的理由同上面那条 —— 只留一份。
       tools/test-share.js 要拿它做"压缩函数改成恒等返回，压缩比断言必须变红"
       的反向验证，就得能直接调；否则只能靠改文件，那没法自动化。 */
    crc16Bytes: crc16Bytes,
    lzCompress: lzCompress,
    lzExpand: lzExpand
  };

})(typeof window !== 'undefined' ? window : globalThis);
