#!/usr/bin/env node
/**
 * serve.mjs — 极简静态服务器（零依赖）
 * 开发预览：npm run dev  →  默认 http://127.0.0.1:8777 （根目录 src/，支持 ES 模块）
 * E2E 测试也复用这里的 startServer()。
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

export function startServer(options) {
  const opts = options || {};
  const root = resolve(opts.root || join(ROOT, 'src'));
  const port = opts.port === undefined ? 8777 : opts.port;
  const host = opts.host || '127.0.0.1';

  const server = createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
      res.writeHead(400).end('bad request');
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = join(root, normalize(pathname).replace(/^([/\\])+/, ''));
    if (!target.startsWith(root + sep) && target !== root) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + pathname);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    createReadStream(target).pipe(res);
  });

  return new Promise((resolvePromise, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolvePromise({
        port: actual,
        url: `http://${host}:${actual}`,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const root = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'src');
  const port = Number(process.env.PORT || 8777);
  startServer({ root, port }).then((s) => {
    console.log('AI 记忆库开发服务器已启动：' + s.url + '/');
    console.log('（根目录 ' + root + '，Ctrl+C 停止）');
  }).catch((err) => {
    console.error('启动失败：' + err.message);
    process.exit(1);
  });
}
