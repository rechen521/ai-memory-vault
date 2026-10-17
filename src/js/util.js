/**
 * util.js — 与业务无关的小工具
 * 构建脚本会把本文件内联进单文件产物，因此：import 必须单行、导出只能用 `export ` 前缀。
 */

/** HTML 转义，所有用户输入进 innerHTML 前必须经过它 */
export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** 生成短 id（时间戳 + 随机串，足够单机去重） */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 只保留安全 id：导入数据里的 id 会进入 HTML 属性与 CSS 选择器，必须净化 */
export function sanitizeId(value) {
  var cleaned = String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned.slice(0, 40) || uid();
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 本地时间 YYYY-MM-DD HH:mm */
export function formatTime(ts) {
  var d = new Date(Number(ts) || Date.now());
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function toInt(value, fallback) {
  var n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

/** 去掉首尾空白，并把连续空白压成一个空格 */
export function squeeze(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

export function idbAvailable() {
  return typeof indexedDB !== 'undefined';
}

/** 触发一次浏览器下载 */
export function downloadBlob(text, filename, mime) {
  var blob = new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
}

/** 复制文本，优先 Clipboard API，失败回退 execCommand */
export function copyText(text) {
  return new Promise(function (resolve, reject) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { fallback(); });
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve(true) : reject(new Error('copy-failed'));
    }
  });
}
