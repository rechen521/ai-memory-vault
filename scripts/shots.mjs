#!/usr/bin/env node
/**
 * shots.mjs — 生成 README 用的真实截图（同一套 CDP 驱动，不依赖任何图形库）
 * 运行：npm run shots  → 输出到 docs/screenshots/
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { findBrowser, launch } from '../tests/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');

const SAMPLE = [
  ['user', '我 2026 年参加高考，物理方向，位次 12000 左右', '个人信息,高考', 3],
  ['user', '偏好：只考虑省内一本院校，能走读最好', '偏好', 3],
  ['ai', '已记录：位次 12000，省内一本，物理方向。后续分析以这三条为基准。', '志愿填报', 2],
  ['user', 'Excel 成绩单已上传，里面有各科分数和排名', '成绩', 2],
  ['ai', '推荐梯度：冲 2 所、稳 4 所、保 3 所；其中 A 大的计算机是王牌专业。', '志愿填报', 2],
  ['user', '不接受中外合作办学，学费预算一年 1 万以内', '偏好,预算', 3]
];

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    console.error('未找到 Chrome / Edge / Chromium，无法生成截图。');
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  const server = await startServer({ root: join(ROOT, 'dist'), port: 0 });
  const session = await launch({ executable: browserPath, width: 1440, height: 1180 });
  const T = (expr) => session.evaluate(expr);

  try {
    await session.goto(server.url + '/index.html');
    await T(`localStorage.clear(); sessionStorage.setItem('mvault.wished','1'); return true;`);
    await session.reload();
    await session.installHelpers();

    // 1) 空状态
    await session.screenshot(join(OUT, 'empty.png'));
    console.log('✔ empty.png');

    // 2) 填充示例数据后的主界面
    await T(`
      ${SAMPLE.map(([role, content, tags, weight]) =>
        `__T.add('${role}', ${JSON.stringify(content)}, '${tags}', ${weight});`).join('\n')}
      return true;
    `);
    await new Promise((r) => setTimeout(r, 400));
    await session.screenshot(join(OUT, 'main.png'));
    console.log('✔ main.png');

    // 3) 上下文快照弹窗
    await T(`document.querySelector('#btnSnapshot').click(); return true;`);
    await new Promise((r) => setTimeout(r, 350));
    await session.screenshot(join(OUT, 'snapshot.png'));
    console.log('✔ snapshot.png');
    await T(`document.querySelector('[data-close="snapMask"]').click(); return true;`);

    // 4) 开场彩蛋弹窗
    await T(`document.querySelector('#btnWish').click(); return true;`);
    await new Promise((r) => setTimeout(r, 350));
    await session.screenshot(join(OUT, 'wish.png'));
    console.log('✔ wish.png');
    await T(`document.querySelector('#wishMask [data-close]').click(); return true;`);

    // 5) 窄屏
    await session.setViewport(430, 1000);
    await new Promise((r) => setTimeout(r, 350));
    await session.screenshot(join(OUT, 'mobile.png'));
    console.log('✔ mobile.png');
    await session.clearViewport();
  } finally {
    await session.close();
    await server.close();
  }
  console.log('截图已输出到 docs/screenshots/');
}

main().catch((err) => {
  console.error('生成截图失败：' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
