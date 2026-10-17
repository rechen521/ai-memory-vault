#!/usr/bin/env node
/**
 * check.mjs — 静态自检（零依赖，CI 里跑）
 *   1. src/js/*.js 逐个做语法校验
 *   2. src/index.html 与 JS 里用到的 #id 交叉引用，防止改了 id 忘了改代码
 *   3. dist/ 产物自检：无外链、只有一个内联脚本、语法可解析
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

/** 由 JS 动态生成、不会出现在 index.html 里的 id */
const DYNAMIC_IDS = new Set(['btnWish']);

let failures = 0;
function ok(msg) { console.log('  ✔ ' + msg); }
function fail(msg) { failures += 1; console.error('  ✘ ' + msg); }

/* ------------------------------ 1. 语法 ------------------------------ */
console.log('· JS 语法');
const jsFiles = readdirSync(join(SRC, 'js')).filter((f) => f.endsWith('.js')).sort();
for (const file of jsFiles) {
  const full = join(SRC, 'js', file);
  try {
    execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
    ok('src/js/' + file);
  } catch (err) {
    fail('src/js/' + file + ' 语法错误：' + String(err.stderr || err.message).split('\n')[0]);
  }
}

/* --------------------------- 2. id 交叉引用 --------------------------- */
console.log('· DOM id 交叉引用');
const html = readFileSync(join(SRC, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const jsSource = jsFiles.map((f) => readFileSync(join(SRC, 'js', f), 'utf8')).join('\n');
const usedIds = new Set([
  ...[...jsSource.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]),
  ...[...jsSource.matchAll(/querySelector\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]),
  // openModal('snapMask') 这类以字符串传 id 的调用
  ...[...jsSource.matchAll(/['"]([A-Za-z0-9_-]+)['"]/g)].map((m) => m[1]).filter((id) => htmlIds.has(id))
]);
const missing = [...usedIds].filter((id) => !htmlIds.has(id) && !DYNAMIC_IDS.has(id));
if (missing.length) fail('JS 引用了 index.html 里不存在的 id：' + missing.join(', '));
else ok(`${usedIds.size} 个 id 全部有对应元素`);
const unused = [...htmlIds].filter((id) => !usedIds.has(id) && !DYNAMIC_IDS.has(id));
if (unused.length) console.log('  · 提示：HTML 里有未被 JS 直接引用的 id（可能仅用于样式/无障碍）：' + unused.join(', '));

/* ------------------------------ 3. 产物 ------------------------------ */
console.log('· dist 产物');
const distFile = join(DIST, 'index.html');
if (!existsSync(distFile)) {
  fail('dist/index.html 不存在，请先运行 npm run build');
} else {
  const dist = readFileSync(distFile, 'utf8');
  if (/<script[^>]+src=/i.test(dist)) fail('产物仍有外部脚本引用');
  else ok('脚本已完全内联');
  if (/<link[^>]+rel=["']stylesheet/i.test(dist)) fail('产物仍有外部样式引用');
  else ok('样式已完全内联');

  const scripts = [...dist.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (scripts.length !== 1) fail('产物内联脚本数量异常：' + scripts.length);
  else {
    try {
      new vm.Script(scripts[0]);
      ok('内联脚本语法可解析（' + (Buffer.byteLength(scripts[0]) / 1024).toFixed(1) + ' KB）');
    } catch (err) {
      fail('内联脚本语法错误：' + err.message);
    }
  }

  if (!/<style>[\s\S]*?<\/style>/.test(dist)) fail('产物缺少内联样式');
  else ok('内联样式存在');

  const size = Buffer.byteLength(dist);
  if (size > 200 * 1024) fail('产物过大：' + (size / 1024).toFixed(1) + ' KB（预期 < 200 KB）');
  else ok('体积 ' + (size / 1024).toFixed(1) + ' KB');
}

/* ------------------------------ 汇总 ------------------------------ */
console.log('');
if (failures) {
  console.error(`✘ 自检失败：${failures} 项`);
  process.exit(1);
}
console.log('✔ 自检全部通过');
