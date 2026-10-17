/**
 * tests/lib/browser.mjs — 用系统自带浏览器 + CDP 做真实端到端测试（零 npm 依赖）
 *
 * 为什么不用 Playwright：这个项目承诺零依赖，装 Playwright 要拉几百 MB Chromium。
 * 系统里已经有 Edge / Chrome，Node 18+ 又自带 fetch 和全局 WebSocket，
 * 直接用 DevTools Protocol 驱动就够，且 CI 和本机行为一致。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/** 各平台常见的浏览器位置，可用环境变量 BROWSER_PATH 覆盖 */
const CANDIDATES = {
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium'
  ]
};

export function findBrowser() {
  if (process.env.BROWSER_PATH) {
    return existsSync(process.env.BROWSER_PATH) ? process.env.BROWSER_PATH : null;
  }
  const list = CANDIDATES[process.platform] || [];
  for (const candidate of list) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BrowserSession {
  constructor(proc, client, profileDir) {
    this.proc = proc;
    this.cdp = client;
    this.profileDir = profileDir;
    this.consoleErrors = [];
    this.pageErrors = [];
  }

  /** 页面上下文求值；始终包在 IIFE 里，避免重复声明污染全局作用域 */
  async evaluate(expression) {
    const result = await this.cdp.send('Runtime.evaluate', {
      expression: `(function(){ ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      throw new Error('页面内异常：' + (desc || result.exceptionDetails.text));
    }
    return result.result ? result.result.value : undefined;
  }

  async goto(url) {
    await this.cdp.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"');
    await this.waitFor('!!window.__MVault__');
  }

  async reload() {
    await this.cdp.send('Page.reload', { ignoreCache: true });
    await this.waitFor('document.readyState === "complete"');
    await this.waitFor('!!window.__MVault__');
  }

  async waitFor(expression, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(`return !!(${expression});`)) return true;
      } catch (err) {
        lastError = err;
      }
      await sleep(80);
    }
    throw new Error('等待超时：' + expression + (lastError ? '（' + lastError.message + '）' : ''));
  }

  /** 把测试用的小工具注入页面（页面每次导航后都要重新注入） */
  async installHelpers() {
    await this.evaluate(`
      window.__T = {
        q: function (s) { return document.querySelector(s); },
        qa: function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); },
        text: function (s) { var el = document.querySelector(s); return el ? el.textContent : null; },
        click: function (s) { var el = typeof s === 'string' ? document.querySelector(s) : s; el.click(); return true; },
        set: function (s, v) {
          var el = typeof s === 'string' ? document.querySelector(s) : s;
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        },
        add: function (role, content, tags, weight) {
          var seg = document.querySelector('#roleSeg .seg-btn[data-role="' + role + '"]');
          if (seg) seg.click();
          var ta = document.querySelector('#contentInput');
          ta.value = content;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          var tag = document.querySelector('#tagInput');
          tag.value = tags || '';
          var star = document.querySelector('#stars .star[data-w="' + (weight || 2) + '"]');
          if (star) star.click();
          document.querySelector('#btnAdd').click();
          return true;
        },
        cards: function () { return Array.prototype.slice.call(document.querySelectorAll('#list .mem')); },
        cardText: function () {
          return Array.prototype.map.call(document.querySelectorAll('#list .mem-body'), function (el) { return el.textContent; });
        }
      };
      return true;
    `);
  }

  async setViewport(width, height) {
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false
    });
  }

  async clearViewport() {
    await this.cdp.send('Emulation.clearDeviceMetricsOverride');
  }

  async screenshot(file, options) {
    const opts = options || {};
    const result = await this.cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: !!opts.fullPage
    });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  }

  async close() {
    try { this.cdp.close(); } catch (e) { /* 忽略 */ }
    if (this.proc && !this.proc.killed) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          this.proc.kill('SIGKILL');
        }
      } catch (e) { /* 忽略 */ }
    }
    try { rmSync(this.profileDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

function createClient(ws) {
  let counter = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result || {});
      return;
    }
    listeners.forEach((fn) => fn(msg));
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++counter;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  return {
    send,
    on: (fn) => listeners.push(fn),
    close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } }
  };
}

async function fetchWsUrl(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* 浏览器还没起来 */ }
    await sleep(150);
  }
  throw new Error('连不上 CDP 调试端口 ' + port);
}

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export async function launch(options) {
  const opts = options || {};
  const executable = opts.executable || findBrowser();
  if (!executable) {
    throw Object.assign(new Error('未找到 Chrome / Edge / Chromium'), { code: 'NO_BROWSER' });
  }
  const port = await freePort();
  const profileDir = join(opts.profileDir || tmpdir(), 'mvault-e2e-' + Date.now());
  mkdirSync(profileDir, { recursive: true });

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=' + (opts.width || 1440) + ',' + (opts.height || 1150),
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--user-data-dir=' + profileDir,
    'about:blank'
  ];
  // 以 root 运行（部分容器 / CI）时 Chromium 沙箱无法启动
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    args.unshift('--no-sandbox');
  }
  const proc = spawn(executable, args, { stdio: 'ignore', detached: false });

  const wsUrl = await fetchWsUrl(port, opts.timeoutMs);
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
  });

  const cdp = createClient(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  // 让页面认为自己处于前台：剪贴板 API 等需要焦点
  try { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) { /* 旧版本浏览器不支持 */ }

  const session = new BrowserSession(proc, cdp, profileDir);
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      session.pageErrors.push((d.exception && d.exception.description) || d.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      session.consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  });
  return session;
}
