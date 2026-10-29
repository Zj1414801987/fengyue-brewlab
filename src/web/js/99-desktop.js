/**
 * 桌面版外壳补丁（仅在 Windows/macOS 桌面版内注入，网页版不受影响）
 * 作用：把产品名与版本号改成桌面版的对外信息；不改任何业务逻辑。
 */
(function () {
  'use strict';
  var APP_NAME = '风月酿研所';
  var APP_VER = 'v1.3';

  function apply() {
    // 1. 窗口/标签标题（Electron 主进程会再统一改一次，这里是兜底）
    document.title = APP_NAME + ' · 精酿配方与酿造记录';

    // 2. 侧栏品牌：BrewLab → 风月酿研所；副标题改成产品定位
    var b = document.querySelector('.brand__text b');
    if (b) b.textContent = APP_NAME;

    var i = document.querySelector('.brand__text i');
    if (i && i.firstChild && i.firstChild.nodeType === 3) {
      i.firstChild.nodeValue = '精酿配方 ';
    }

    // 3. 版本号：应用自身从 Config.VERSION_LABEL 读取，这里统一成产品版本
    try {
      if (window.BREW && window.BREW.Config) window.BREW.Config.VERSION_LABEL = APP_VER;
    } catch (e) {}
    var ver = document.getElementById('brand-ver');
    if (ver) ver.textContent = APP_VER;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(apply, 0); });
  } else {
    apply();
  }
  // 应用启动后会重刷一次徽章，晚一步再覆盖
  window.addEventListener('load', function () { setTimeout(apply, 600); });
})();
