/**
 * 预加载脚本：只向渲染进程暴露极少数外壳能力，不开放 Node。
 * 目前仅「关于」窗口的「使用说明」按钮需要跨窗口调用。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fyShell', {
  openHelp: () => ipcRenderer.send('fy:open-help'),
  closeSelf: () => ipcRenderer.send('fy:close-self'),
  copy: (text) => ipcRenderer.send('fy:copy', String(text || ''))
});
