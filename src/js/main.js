/**
 * main.js — 入口：创建应用实例并启动
 * 单文件产物由 scripts/build.mjs 把上面所有模块内联成一段脚本后执行，逻辑完全一致。
 */
import { createApp } from './ui.js';

var VERSION = '1.0.0';

function boot() {
  var app = createApp({ document: document, window: window });
  app.init();
  // 调试 / 自动化测试钩子（只读，不参与业务逻辑）
  window.__MVault__ = {
    version: VERSION,
    app: app,
    stats: function () { return app.state.memories.length; }
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
