/**
 * tests/file-protocol.mjs — 验证「双击即用」：直接用 file:// 打开 dist 产物
 * 运行：node tests/file-protocol.mjs
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { findBrowser, launch } from './lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distFile = join(ROOT, 'dist', 'index.html');

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ✔ ' + name);
  else { failed += 1; console.error('  ✘ ' + name + (detail ? ' → ' + detail : '')); }
}

const browserPath = findBrowser();
if (!browserPath) {
  console.warn('⚠ 未找到浏览器，跳过 file:// 测试');
  process.exit(0);
}

const session = await launch({ executable: browserPath });
try {
  await session.goto(pathToFileURL(distFile).href);
  await session.installHelpers();

  check('file:// 下应用正常挂载',
    await session.evaluate(`return !!window.__MVault__;`));

  await session.evaluate(`__T.add('user', 'file 协议下的记忆', '本地', 2); return true;`);
  check('file:// 下可以录入记忆', (await session.evaluate(`return __T.cards().length;`)) === 1);

  const persisted = await session.evaluate(`
    try { return JSON.parse(localStorage.getItem('mvault.v1')).memories.length; } catch (e) { return -1; }
  `);
  check('file:// 下 localStorage 可用', persisted === 1, '实际 ' + persisted);

  await session.evaluate(`document.querySelector('#btnSnapshot').click(); return true;`);
  const snap = await session.evaluate(`return __T.text('#snapText') || '';`);
  check('file:// 下快照可生成', snap.indexOf('AI 上下文快照') !== -1);

  await session.evaluate(`document.querySelector('[data-close="snapMask"]').click(); return true;`);
  await session.evaluate(`document.querySelector('#btnExport').click(); return true;`);
  check('file:// 下导出不抛异常', (await session.pageErrors).length === 0);
} finally {
  await session.close();
}

console.log('');
if (failed) {
  console.error('✘ file:// 测试失败：' + failed + ' 项');
  process.exit(1);
}
console.log('✔ file://（双击打开）测试全部通过');
