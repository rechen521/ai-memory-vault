#!/usr/bin/env node
/**
 * build.mjs — 零依赖打包：把 src/ 下的 ES 模块内联成单个 HTML 文件
 *
 * 为什么要自己写：项目的核心承诺是「单文件、零依赖、双击即用」。
 * 引入 esbuild/webpack 会让开发链路多出 node_modules，而这里只需要
 * 「按固定顺序拼接 + 去掉 import/export 关键字」，几十行就够，且产物可读。
 *
 * 约定（src/js/*.js 必须遵守）：
 *   1. import 语句必须单行，且只写 `import { a, b } from './x.js';`
 *   2. 导出只用 `export function` / `export const` 前缀，不用 default
 *   3. 模块之间不循环依赖，顺序由下面 MODULE_ORDER 决定
 * 违反约定会在构建时报错，而不是产出一个坏文件。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

/** 依赖顺序：被依赖的放前面 */
const MODULE_ORDER = [
  'util.js',
  'parser.js',
  'store.js',
  'snapshot.js',
  'filestore.js',
  'ui.js',
  'main.js'
];

const CSS_MARKER = /[ \t]*<!-- build:css -->[\s\S]*?<!-- \/build:css -->/;
const JS_MARKER = /[ \t]*<!-- build:js -->[\s\S]*?<!-- \/build:js -->/;

function stripModuleSyntax(file, code) {
  // 支持单行与跨行的命名导入：import { a, b } from './x.js'
  const withoutImports = code
    .replace(/^[ \t]*import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?[ \t]*\n?/gm, '')
    .replace(/^[ \t]*import\s+[^;{}\n]*from\s*['"][^'"]+['"]\s*;?[ \t]*\n?/gm, '');
  const withoutExports = withoutImports.replace(/^[ \t]*export\s+/gm, '');

  const leftoverImport = withoutExports.match(/^[ \t]*import\s/m);
  const leftoverExport = withoutExports.match(/^[ \t]*export\s/m);
  const leftoverFrom = withoutExports.match(/from\s+['"]\.\//);
  if (leftoverImport || leftoverExport || leftoverFrom) {
    throw new Error(
      `${file}: 内联失败——只支持单行 import 和 export 前缀导出，` +
      `请检查是否有跨行 import / 动态 import / 相对路径 re-export。`
    );
  }
  return withoutExports.trimEnd();
}

function buildBundle() {
  const declared = readdirSync(join(SRC, 'js')).filter((f) => f.endsWith('.js')).sort();
  const missing = declared.filter((f) => !MODULE_ORDER.includes(f));
  if (missing.length) {
    throw new Error('src/js 里有未登记的模块，请加入 MODULE_ORDER：' + missing.join(', '));
  }
  const parts = MODULE_ORDER.map((name) => {
    const code = readFileSync(join(SRC, 'js', name), 'utf8');
    return `/* ---------- src/js/${name} ---------- */\n${stripModuleSyntax(name, code)}`;
  });
  return `(function () {\n'use strict';\n\n${parts.join('\n\n')}\n\n})();\n`;
}

function buildHtml(bundle, css) {
  const shell = readFileSync(join(SRC, 'index.html'), 'utf8');
  if (!CSS_MARKER.test(shell) || !JS_MARKER.test(shell)) {
    throw new Error('src/index.html 缺少 <!-- build:css --> 或 <!-- build:js --> 标记');
  }
  // 注意：必须用函数式替换，否则内联代码里的 $('#x') 会被当成 $' 替换模式
  const withCss = shell.replace(CSS_MARKER, () => `<style>\n${css.trim()}\n</style>`);
  const withJs = withCss.replace(JS_MARKER, () => `<script>\n${bundle.trim()}\n</script>`);
  return withJs
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '');
}

function main() {
  const bundle = buildBundle();
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8');

  try {
    new vm.Script(bundle);
  } catch (err) {
    throw new Error('打包产物语法错误：' + err.message);
  }

  const html = buildHtml(bundle, css);
  const bodyWithoutInlineBlocks = html
    .replace(/<style>[\s\S]*?<\/style>/gi, '')
    .replace(/<script>[\s\S]*?<\/script>/gi, '');
  const offender = bodyWithoutInlineBlocks.match(/<script[^>]+src=[^>]*>|<link[^>]+rel=["']stylesheet[^>]*>/i);
  if (offender) {
    throw new Error('产物里仍有外部资源引用，内联不完整：' + offender[0]);
  }

  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, 'index.html'), html, 'utf8');
  writeFileSync(join(DIST, 'ai-memory-vault.html'), html, 'utf8');

  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log('✔ 构建完成');
  console.log('  dist/index.html            ' + kb(Buffer.byteLength(html)));
  console.log('  dist/ai-memory-vault.html  ' + kb(Buffer.byteLength(html)) + '  (同一份产物，便于直接下载)');
  console.log('  bundle ' + kb(Buffer.byteLength(bundle)) + ' · css ' + kb(Buffer.byteLength(css)));
}

main();
