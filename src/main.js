/**
 * 风月酿研所 · Windows 桌面外壳
 * ---------------------------------------------------------------
 * 职责：只做「让现有网页应用像一款 Windows 软件」这件事，
 *      不改动应用自身的任何业务代码（web/ 目录原样来自 BrewLab 项目）。
 *
 * 提供：单实例、窗口大小位置记忆、中文原生菜单、使用说明 / 关于、
 *      数据目录与自动备份、外链走系统浏览器、崩溃兜底。
 */
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = '风月酿研所';
const APP_VERSION = require('./package.json').version;
const BUILD_DATE = '2026-10-28';

const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'web');
const INDEX_FILE = path.join(WEB_DIR, 'index.html');
const HELP_FILE = path.join(WEB_DIR, 'desktop', 'help.html');
const ABOUT_FILE = path.join(WEB_DIR, 'desktop', 'about.html');
const ICON_FILE = path.join(ROOT, 'assets', 'app.ico');

const USER_DATA = app.getPath('userData');
const BACKUP_DIR = path.join(USER_DATA, 'backups');
const STATE_FILE = path.join(USER_DATA, 'window-state.json');
const SETTINGS_FILE = path.join(USER_DATA, 'app-settings.json');
const LOG_FILE = path.join(USER_DATA, 'renderer.log');

let mainWin = null;
let helpWin = null;
let aboutWin = null;
let quitting = false;

/* ---------------- 诊断日志（仅 FY_DEBUG=1 时写文件） ---------------- */

const DEBUG = process.env.FY_DEBUG === '1';
const DEBUG_LOG = path.join(app.getPath('temp'), 'fengyue-desktop.log');

function log() {
  if (!DEBUG) return;
  const line = '[' + new Date().toISOString() + '] ' + Array.prototype.join.call(arguments, ' ') + '\n';
  try { fs.appendFileSync(DEBUG_LOG, line); } catch (e) {}
}


/* ---------------- 小工具 ---------------- */

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { /* 写入失败不阻断使用 */ }
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* ---------------- 窗口状态 ---------------- */

function loadWindowState() {
  const s = readJson(STATE_FILE, null);
  const def = { width: 1280, height: 840 };
  if (!s || !s.width || !s.height) return def;
  return s;
}

function saveWindowState() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const b = mainWin.getNormalBounds ? mainWin.getNormalBounds() : mainWin.getBounds();
  writeJson(STATE_FILE, {
    width: b.width, height: b.height, x: b.x, y: b.y,
    maximized: mainWin.isMaximized()
  });
}

/* ---------------- 数据备份 ---------------- */

// 把网页里的 localStorage 全量快照成 JSON，放在用户数据目录的 backups 下，最多留 10 份。
async function backupData(silent) {
  if (!mainWin || mainWin.isDestroyed()) return null;
  let payload = null;
  try {
    payload = await mainWin.webContents.executeJavaScript(
      `(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(o); })()`,
      true
    );
  } catch (e) {
    if (!silent) dialog.showErrorBox('备份失败', '无法读取应用数据：' + e.message);
    return null;
  }
  ensureDir(BACKUP_DIR);
  const file = path.join(BACKUP_DIR, `风月酿研所-数据-${stamp()}.json`);
  try {
    fs.writeFileSync(file, payload, 'utf8');
  } catch (e) {
    if (!silent) dialog.showErrorBox('备份失败', '写入备份文件失败：' + e.message);
    return null;
  }
  // 只保留最近 10 份
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('风月酿研所-数据-') && f.endsWith('.json'))
      .sort();
    while (files.length > 10) {
      const old = files.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    }
  } catch (e) {}
  if (!silent) {
    dialog.showMessageBox(mainWin, {
      type: 'info',
      title: '备份完成',
      message: '数据已备份',
      detail: file,
      buttons: ['好', '打开所在文件夹'],
      defaultId: 0,
      cancelId: 0
    }).then((r) => { if (r.response === 1) shell.openPath(BACKUP_DIR); });
  }
  return file;
}

/* ---------------- 子窗口 ---------------- */

function openHelp() {
  if (helpWin && !helpWin.isDestroyed()) { helpWin.focus(); return; }
  const hwa = screen.getPrimaryDisplay().workAreaSize;
  helpWin = new BrowserWindow({
    width: Math.min(900, hwa.width - 40), height: Math.min(760, hwa.height - 40),
    minWidth: Math.min(720, hwa.width - 40), minHeight: Math.min(520, hwa.height - 40),
    title: '使用说明 · ' + APP_NAME,
    icon: ICON_FILE,
    parent: mainWin || undefined,
    backgroundColor: '#12100d',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  helpWin.setMenu(null);
  helpWin.loadFile(HELP_FILE, {
    query: { version: APP_VERSION, dataDir: USER_DATA, backupDir: BACKUP_DIR }
  });
  helpWin.on('closed', () => { helpWin = null; });
}

function openAbout() {
  if (aboutWin && !aboutWin.isDestroyed()) { aboutWin.focus(); return; }
  const awa = screen.getPrimaryDisplay().workAreaSize;
  aboutWin = new BrowserWindow({
    width: Math.min(560, awa.width - 40),
    height: Math.min(880, awa.height - 20),
    resizable: false, minimizable: false, maximizable: false,
    title: '关于 ' + APP_NAME,
    icon: ICON_FILE,
    parent: mainWin || undefined,
    backgroundColor: '#12100d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  aboutWin.setMenu(null);
  aboutWin.loadFile(ABOUT_FILE, {
    query: {
      version: APP_VERSION,
      build: BUILD_DATE,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      dataDir: USER_DATA
    }
  });
  aboutWin.on('closed', () => { aboutWin = null; });
}

/* ---------------- 子窗口联动 ---------------- */

ipcMain.on('fy:open-help', () => {
  if (aboutWin && !aboutWin.isDestroyed()) aboutWin.close();
  openHelp();
});

ipcMain.on('fy:copy', (e, text) => {
  try { clipboard.writeText(String(text || '')); } catch (err) {}
});

ipcMain.on('fy:close-self', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isDestroyed()) w.close();
});

/* ---------------- 菜单 ---------------- */

function buildMenu() {
  const template = [
    {
      label: '文件(&F)',
      submenu: [
        { label: '立即备份数据…', accelerator: 'CmdOrCtrl+Shift+B', click: () => backupData(false) },
        { type: 'separator' },
        { label: '打开数据文件夹', click: () => { ensureDir(USER_DATA); shell.openPath(USER_DATA); } },
        { label: '打开备份文件夹', click: () => { ensureDir(BACKUP_DIR); shell.openPath(BACKUP_DIR); } },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => { quitting = true; app.quit(); } }
      ]
    },
    {
      label: '编辑(&E)',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图(&V)',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => mainWin && mainWin.reload() },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWin && mainWin.reloadIgnoringCache() },
        { type: 'separator' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.1) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.1) },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', click: () => mainWin && mainWin.webContents.setZoomLevel(0) },
        { label: '重置窗口位置与缩放…', click: resetWindow },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { label: '开发者工具', accelerator: 'F12', visible: process.argv.includes('--debug'), click: () => mainWin && mainWin.webContents.toggleDevTools() }
      ]
    },
    {
      label: '帮助(&H)',
      submenu: [
        { label: '使用说明', accelerator: 'F1', click: openHelp },
        { label: '关于' + APP_NAME, click: openAbout }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 把窗口拉回屏幕中央，缩放归零（窗口被拖到屏幕外的救援入口）
function resetWindow() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(1280, wa.width - 24);
  const h = Math.min(840, wa.height - 24);
  mainWin.unmaximize();
  mainWin.setBounds({
    width: w, height: h,
    x: Math.round((wa.width - w) / 2),
    y: Math.round((wa.height - h) / 2)
  });
  mainWin.webContents.setZoomLevel(0);
  mainWin.show();
  mainWin.focus();
}

function zoom(delta) {
  if (!mainWin) return;
  const wc = mainWin.webContents;
  const next = Math.min(2, Math.max(-3, wc.getZoomLevel() + delta * 2));
  wc.setZoomLevel(next);
}

/* ---------------- 主窗口 ---------------- */

function createMainWindow() {
  const st = loadWindowState();
  // v1.1：按屏幕可用区域钳制窗口大小。1280×840 在 1080p@125% 缩放下会超出工作区，
  // 之前会把窗口顶出屏幕底部，属于真实缺陷。
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const winW = Math.max(900, Math.min(st.width || 1280, wa.width - 24));
  const winH = Math.max(560, Math.min(st.height || 840, wa.height - 24));
  const opts = {
    width: winW, height: winH,
    minWidth: Math.min(900, wa.width - 24), minHeight: Math.min(560, wa.height - 24),
    show: false,
    title: APP_NAME + ' v' + APP_VERSION,
    icon: ICON_FILE,
    backgroundColor: '#12100d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  };
  // 记住的位置若已不在任何屏幕上（拔了副屏），丢弃它，回到居中
  if (typeof st.x === 'number' && typeof st.y === 'number' &&
      st.x > -winW + 120 && st.y > -80 && st.x < wa.width - 120 && st.y < wa.height - 80) {
    opts.x = st.x; opts.y = st.y;
  }
  mainWin = new BrowserWindow(opts);

  mainWin.loadFile(INDEX_FILE);
  log('loadFile issued:', INDEX_FILE);

  const savedZoom = readJson(SETTINGS_FILE, {}).zoomLevel;
  if (typeof savedZoom === 'number' && savedZoom >= -3 && savedZoom <= 2) {
    mainWin.webContents.setZoomLevel(savedZoom);
  }
  mainWin.webContents.on('did-finish-load', () => {
    log('did-finish-load');
    if (typeof savedZoom === 'number') mainWin.webContents.setZoomLevel(savedZoom);
  });
  mainWin.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    log('did-fail-load', code, desc, url, 'main=' + isMain);
  });
  mainWin.webContents.on('console-message', (e, level, message, line, source) => {
    if (level >= 2) log('renderer console:', message, source + ':' + line);
  });

  mainWin.once('ready-to-show', () => {
    log('ready-to-show');
    if (st.maximized) mainWin.maximize();
    mainWin.show();
    mainWin.focus();
  });

  // 兜底：若 4 秒内还没显示（例如页面卡在首屏脚本），也把窗口显示出来，至少让用户看到界面
  setTimeout(() => {
    if (mainWin && !mainWin.isDestroyed() && !mainWin.isVisible()) {
      log('fallback show triggered');
      mainWin.show();
    }
  }, 4000);

  // 页面标题由应用自己设置时，统一改回产品名 + 当前配方名
  mainWin.on('page-title-updated', (e) => {
    e.preventDefault();
    const t = mainWin.webContents.getTitle() || '';
    const recipe = t.split('·').pop().trim();
    mainWin.setTitle(APP_NAME + ' v' + APP_VERSION + (recipe && recipe !== t ? ' · ' + recipe : ''));
  });

  // 应用内的 window.open / target=_blank 一律交给系统浏览器
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 禁止把窗口导航到外部地址（防止拖入文件或误点链接把应用顶掉）
  mainWin.webContents.on('will-navigate', (e, url) => {
    const target = path.resolve(decodeURIComponent(url.replace(/^file:\/\//i, '')));
    if (!target.toLowerCase().startsWith(WEB_DIR.toLowerCase())) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // 渲染进程异常兜底
  mainWin.webContents.on('render-process-gone', (e, details) => {
    const choice = dialog.showMessageBoxSync(mainWin, {
      type: 'error',
      title: '界面进程异常',
      message: '应用界面意外退出（' + details.reason + '）',
      detail: '你的配方数据保存在本地，不会因此丢失。可以重新加载界面继续使用。',
      buttons: ['重新加载', '退出'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice === 0) mainWin.reload(); else { quitting = true; app.quit(); }
  });

  mainWin.on('close', () => {
    saveWindowState();
    const cfg = readJson(SETTINGS_FILE, {});
    cfg.zoomLevel = mainWin.webContents.getZoomLevel();
    writeJson(SETTINGS_FILE, cfg);
  });

  // 启动 4 秒后静默备份一次（把上一次会话的数据留档）
  mainWin.webContents.on('did-finish-load', () => {
    setTimeout(() => { backupData(true); }, 4000);
  });

  mainWin.webContents.on('render-process-gone', () => {});
  mainWin.webContents.on('preload-error', (e, p, err) => {
    try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] preload error: ${err}\n`); } catch (e2) {}
  });
}

/* ---------------- 自检模式（打包验收用，不影响正常使用） ---------------- */

async function runSmokeTest() {
  const out = process.env.FY_SMOKE_OUT || path.join(app.getPath('temp'), 'fengyue-smoke.png');
  const lines = [];
  try {
    await new Promise((r) => setTimeout(r, 3500));
    const probe = await mainWin.webContents.executeJavaScript(`(() => ({
      title: document.title,
      brand: (document.querySelector('.brand__text b') || {}).textContent || '',
      ver: (document.getElementById('brand-ver') || {}).textContent || '',
      bootVisible: !!document.querySelector('#boot'),
      views: document.querySelectorAll('.view, #view').length
    }))()`, true);
    const img = await mainWin.webContents.capturePage();
    fs.writeFileSync(out, img.toPNG());
    lines.push('SHOT=' + out);
    lines.push('TITLE=' + probe.title);
    lines.push('BRAND=' + probe.brand);
    lines.push('VER=' + probe.ver);
    const menu = Menu.getApplicationMenu();
    lines.push('MENU=' + (menu ? menu.items.map((i) => i.label).join('|') : 'none'));
    lines.push('OK');
  } catch (e) {
    lines.push('FAIL=' + (e && e.message));
  }
  try { fs.writeFileSync(path.join(app.getPath('temp'), 'fengyue-smoke.txt'), lines.join('\n'), 'utf8'); } catch (e) {}
  app.exit(0);
}

/* ---------------- 启动 ---------------- */

app.setAppUserModelId('com.fengyue.brewlab');

process.on('uncaughtException', (err) => {
  log('uncaughtException:', err && err.stack ? err.stack : String(err));
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
    }
  });

  app.whenReady().then(() => {
    log('=== app ready ===');
    log('userData:', USER_DATA);
    ensureDir(USER_DATA);
    ensureDir(BACKUP_DIR);
    buildMenu();
    createMainWindow();
    log('window created');

    if (process.env.FY_SMOKE === '1') {
      mainWin.webContents.once('did-finish-load', () => { runSmokeTest(); });
    }

    // 首次启动自动打开使用说明
    const settings = readJson(SETTINGS_FILE, {});
    if (!settings.helpShown) {
      mainWin.webContents.once('did-finish-load', () => {
        setTimeout(() => openHelp(), 1200);
        settings.helpShown = true;
        settings.firstRunAt = new Date().toISOString();
        writeJson(SETTINGS_FILE, settings);
      });
    }
  });

  app.on('window-all-closed', () => { app.quit(); });

  app.on('before-quit', (e) => {
    if (!quitting) { quitting = true; }
  });
}
