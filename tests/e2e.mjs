/**
 * tests/e2e.mjs — 真实浏览器端到端测试（零依赖：系统 Edge/Chrome + CDP）
 *
 * 覆盖：录入 / 批量导入 / 搜索 / 标签筛选 / 置顶 / 编辑 / 删除 / 快照 / 复制 /
 *       导入导出往返 / XSS 防护 / 开场弹窗 / 持久化 / 损坏数据恢复 / 响应式 / 无障碍 / 控制台报错
 *
 * 运行：npm run test:e2e          找不到浏览器时跳过（退出码 0）
 *      REQUIRE_BROWSER=1 ...     找不到浏览器时视为失败
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../scripts/serve.mjs';
import { findBrowser, launch } from './lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  ✔ ' + name);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.error('  ✘ ' + name + '\n      ' + err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg ? msg + '：' : '') + '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}

function includes(haystack, needle, msg) {
  if (String(haystack).indexOf(needle) === -1) {
    throw new Error((msg ? msg + '：' : '') + '期望包含 ' + JSON.stringify(needle) + '，实际 ' + JSON.stringify(String(haystack).slice(0, 200)));
  }
}

function section(title) {
  console.log('\n· ' + title);
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    console.warn('⚠ 未找到 Chrome / Edge / Chromium，跳过浏览器测试。');
    console.warn('  设置 BROWSER_PATH=/path/to/chrome 可指定可执行文件；CI 里设置 REQUIRE_BROWSER=1 可让缺失变成失败。');
    if (process.env.REQUIRE_BROWSER === '1') process.exit(1);
    return;
  }
  console.log('浏览器：' + browserPath);

  const server = await startServer({ root: DIST, port: 0 });
  const url = server.url + '/index.html';
  console.log('被测页面：' + url);

  const session = await launch({ executable: browserPath });
  const workDir = mkdtempSync(join(tmpdir(), 'mvault-fixtures-'));
  const storageKey = 'mvault.v1';
  const T = (expr) => session.evaluate(expr);

  try {
    /* ------------------------------ Phase 1 · 启动 ------------------------------ */
    section('启动与空状态');
    await session.goto(url);
    await T(`localStorage.clear(); sessionStorage.clear(); return true;`);
    await session.reload();
    await session.installHelpers();

    await check('应用挂载并暴露版本号', async () => {
      const version = await T(`return window.__MVault__ && window.__MVault__.version;`);
      eq(version, '1.0.0');
    });

    await check('空库渲染空状态提示', async () => {
      const text = await T(`return __T.text('#list');`);
      includes(text, '还没有任何记忆');
    });

    await check('存储徽标初始为「仅浏览器存储」', async () => {
      const text = await T(`return __T.text('#storageBadge');`);
      eq(text.trim(), '仅浏览器存储');
    });

    await check('统计面板四项归零', async () => {
      const nums = await T(`return __T.qa('#stats .stat b').map(function (el) { return el.textContent; });`);
      eq(JSON.stringify(nums), JSON.stringify(['0', '0', '0', '0']));
    });

    await check('角色与重要度按钮带 aria-pressed', async () => {
      const roles = await T(`return __T.qa('#roleSeg .seg-btn').map(function (el) { return el.getAttribute('aria-pressed'); });`);
      eq(JSON.stringify(roles), JSON.stringify(['true', 'false']));
      // 默认重要度 2 星：前两颗点亮
      const stars = await T(`return __T.qa('#stars .star').map(function (el) { return el.getAttribute('aria-pressed'); });`);
      eq(JSON.stringify(stars), JSON.stringify(['true', 'true', 'false']));
    });

    await check('模态框具备 dialog 语义且默认隐藏', async () => {
      const info = await T(`
        return __T.qa('.modal-mask').map(function (el) {
          var d = el.querySelector('[role="dialog"]');
          return { hidden: el.hidden, modal: d && d.getAttribute('aria-modal') };
        });
      `);
      eq(info.length, 2);
      for (const item of info) {
        eq(item.hidden, true, '默认应隐藏');
        eq(item.modal, 'true', '应标记 aria-modal');
      }
    });

    /* ------------------------------ Phase 2 · 录入 ------------------------------ */
    section('录入 5 条记忆（走真实 UI 事件）');
    await T(`
      __T.add('user', '我 2026 年参加高考，物理方向', '个人信息,高考', 3);
      __T.add('user', '偏好：只考虑省内院校', '偏好', 2);
      __T.add('ai', '省内推荐：XX 大学、YY 大学', '志愿填报', 2);
      __T.add('user', 'Excel 成绩单已上传，位次 12000', '成绩', 2);
      __T.add('ai', '已记录，后续分析以位次 12000 为基准', '成绩', 1);
      return true;
    `);

    await check('列表渲染 5 张记忆卡', async () => {
      eq(await T(`return __T.cards().length;`), 5);
    });

    await check('localStorage 落盘 5 条', async () => {
      const count = await T(`return JSON.parse(localStorage.getItem('${storageKey}')).memories.length;`);
      eq(count, 5);
    });

    await check('标签下拉统计出 5 个标签 + 全部标签', async () => {
      const options = await T(`return __T.qa('#tagFilter option').length;`);
      eq(options, 6);
    });

    await check('统计面板 5 条 / 用户侧 3 / AI 侧 2 / 标签 5', async () => {
      const nums = await T(`return __T.qa('#stats .stat b').map(function (el) { return el.textContent; });`);
      eq(JSON.stringify(nums), JSON.stringify(['5', '5', '3', '2']));
    });

    await check('输入框保存后被清空', async () => {
      const left = await T(`return document.querySelector('#contentInput').value + '|' + document.querySelector('#tagInput').value;`);
      eq(left, '|');
    });

    await check('空内容提交被拦截并提示', async () => {
      await T(`document.querySelector('#contentInput').value = '   '; document.querySelector('#btnAdd').click(); return true;`);
      const toast = await T(`return __T.text('#toast');`);
      includes(toast, '请先填写记忆内容');
      eq(await T(`return __T.cards().length;`), 5);
    });

    /* --------------------------- Phase 3 · 检索与操作 --------------------------- */
    section('搜索 / 置顶 / 标签筛选 / 编辑 / 删除');

    await check('搜索 Excel 精确命中 1 条', async () => {
      await T(`__T.set('#search', 'Excel'); return true;`);
      eq(await T(`return __T.cards().length;`), 1);
      includes(await T(`return __T.text('.mem-body');`), 'Excel');
    });

    await check('清空搜索恢复 5 条', async () => {
      await T(`__T.set('#search', ''); return true;`);
      eq(await T(`return __T.cards().length;`), 5);
    });

    await check('搜索无结果时显示空状态', async () => {
      await T(`__T.set('#search', 'zzz-不存在'); return true;`);
      includes(await T(`return __T.text('#list');`), '没有匹配的记忆');
      await T(`__T.set('#search', ''); return true;`);
    });

    await check('置顶后该卡片排到首位并高亮', async () => {
      const first = `__T.cards()[0].getAttribute('data-id')`;
      const lastId = await T(`return __T.cards()[4].getAttribute('data-id');`);
      await T(`document.querySelector('[data-pin="${lastId}"]').click(); return true;`);
      eq(await T(`return ${first};`), lastId);
      const pinned = await T(`return __T.cards()[0].classList.contains('pinned');`);
      eq(pinned, true);
    });

    await check('置顶状态写入 localStorage', async () => {
      const pinnedCount = await T(`
        var data = JSON.parse(localStorage.getItem('${storageKey}'));
        return data.memories.filter(function (m) { return m.pinned; }).length;
      `);
      eq(pinnedCount, 1);
    });

    await check('标签筛选只留命中项', async () => {
      await T(`
        var sel = document.querySelector('#tagFilter');
        sel.value = '志愿填报';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      `);
      eq(await T(`return __T.cards().length;`), 1);
      includes(await T(`return __T.text('.mem-body');`), '省内推荐');
    });

    await check('点击标签 chip 取消筛选并同步下拉框', async () => {
      await T(`
        var sel = document.querySelector('#tagFilter');
        sel.value = '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#list .chip[data-tag="成绩"]').click();
        return true;
      `);
      eq(await T(`return __T.cards().length;`), 2);
      eq(await T(`return document.querySelector('#tagFilter').value;`), '成绩');
      await T(`document.querySelector('#list .chip[data-tag="成绩"]').click(); return true;`);
      eq(await T(`return __T.cards().length;`), 5);
    });

    await check('内联编辑回显并可保存', async () => {
      const id = await T(`return __T.cards().filter(function (el) { return el.textContent.indexOf('高考') !== -1; })[0].getAttribute('data-id');`);
      await T(`document.querySelector('[data-edit-btn="${id}"]').click(); return true;`);
      const shown = await T(`return document.querySelector('[data-edit="${id}"]').value;`);
      includes(shown, '2026 年参加高考');
      await T(`
        var ta = document.querySelector('[data-edit="${id}"]');
        ta.value = '我 2026 年参加高考，物理方向，目标省内一本';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-save="${id}"]').click();
        return true;
      `);
      const saved = await T(`
        return JSON.parse(localStorage.getItem('${storageKey}')).memories.filter(function (m) { return m.id === '${id}'; })[0].content;
      `);
      eq(saved, '我 2026 年参加高考，物理方向，目标省内一本');
      eq(await T(`return __T.qa('.mem-edit').length;`), 0, '保存后应退出编辑态');
    });

    await check('编辑取消不改动内容', async () => {
      const id = await T(`return __T.cards()[0].getAttribute('data-id');`);
      const before = await T(`return JSON.parse(localStorage.getItem('${storageKey}')).memories.filter(function (m) { return m.id === '${id}'; })[0].content;`);
      await T(`
        document.querySelector('[data-edit-btn="${id}"]').click();
        var ta = document.querySelector('[data-edit="${id}"]');
        ta.value = '被丢弃的修改';
        document.querySelector('[data-cancel="${id}"]').click();
        return true;
      `);
      const after = await T(`return JSON.parse(localStorage.getItem('${storageKey}')).memories.filter(function (m) { return m.id === '${id}'; })[0].content;`);
      eq(after, before);
    });

    await check('删除需确认，确认后从列表与存储中移除', async () => {
      await T(`window.confirm = function () { return true; }; return true;`);
      const id = await T(`return __T.cards().filter(function (el) { return el.textContent.indexOf('Excel') !== -1; })[0].getAttribute('data-id');`);
      await T(`document.querySelector('[data-del="${id}"]').click(); return true;`);
      eq(await T(`return __T.cards().length;`), 4);
      const remains = await T(`
        return JSON.parse(localStorage.getItem('${storageKey}')).memories.filter(function (m) { return m.id === '${id}'; }).length;
      `);
      eq(remains, 0);
    });

    await check('删除取消时保留记忆', async () => {
      await T(`window.confirm = function () { return false; }; return true;`);
      const id = await T(`return __T.cards()[0].getAttribute('data-id');`);
      await T(`document.querySelector('[data-del="${id}"]').click(); return true;`);
      eq(await T(`return __T.cards().length;`), 4);
    });

    /* ---------------------------- Phase 4 · 批量导入 ---------------------------- */
    section('批量导入整段对话');

    await check('识别 用户：/AI： 前缀并切分入库', async () => {
      await T(`
        __T.set('#bulkInput', '用户：我更喜欢南方城市\\nAI：明白，会优先南方院校\\n补充：气候也要考虑\\n用户: 学费也要看');
        document.querySelector('#btnBulk').click();
        return true;
      `);
      eq(await T(`return __T.cards().length;`), 7);
      const aiCount = await T(`
        return JSON.parse(localStorage.getItem('${storageKey}')).memories.filter(function (m) { return m.role === 'ai' && m.tags.indexOf('批量导入') !== -1; }).length;
      `);
      eq(aiCount, 1, '应解析出 1 条 AI 记忆');
      const longOne = await T(`
        return JSON.parse(localStorage.getItem('${storageKey}')).memories.filter(function (m) { return m.content.indexOf('气候也要考虑') !== -1; })[0].content;
      `);
      includes(longOne, '明白，会优先南方院校');
    });

    await check('无前缀时兜底存为单条并打标签', async () => {
      await T(`
        __T.set('#bulkInput', '这是一段没有任何角色前缀的随手记录');
        document.querySelector('#btnBulk').click();
        return true;
      `);
      eq(await T(`return __T.cards().length;`), 8);
      const tagged = await T(`
        return JSON.parse(localStorage.getItem('${storageKey}')).memories.filter(function (m) { return m.tags.indexOf('批量导入') !== -1; }).length;
      `);
      eq(tagged, 4);
    });

    await check('批量输入框清空并提示条数', async () => {
      const left = await T(`return document.querySelector('#bulkInput').value;`);
      eq(left, '');
    });

    /* ------------------------------ Phase 5 · 快照 ------------------------------ */
    section('上下文快照');

    await check('打开快照模态并生成 Markdown', async () => {
      await T(`
        __T.set('#search', '');
        var sel = document.querySelector('#tagFilter');
        sel.value = '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#btnSnapshot').click();
        return true;
      `);
      const shown = await T(`return document.querySelector('#snapMask').classList.contains('show');`);
      eq(shown, true);
      const text = await T(`return __T.text('#snapText');`);
      includes(text, '# AI 上下文快照（由 AI 记忆库生成）');
      includes(text, '记忆条数：8');
      includes(text, '请将以下内容视为**已知上下文**');
      includes(text, '### 1. ');
      includes(text, '（以上为历史记忆，请在此基础上继续。）');
    });

    await check('快照包含置顶标记与星级', async () => {
      const text = await T(`return __T.text('#snapText');`);
      includes(text, '[置顶]');
      includes(text, '★★★');
    });

    await check('筛选状态下快照只含命中项并注明范围', async () => {
      await T(`document.querySelector('[data-close="snapMask"]').click(); return true;`);
      await T(`
        var sel = document.querySelector('#tagFilter');
        sel.value = '成绩';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#btnSnapshot').click();
        return true;
      `);
      const text = await T(`return __T.text('#snapText');`);
      includes(text, '已筛选：标签 #成绩');
      assert(!text.includes('省内推荐'), '不应包含被筛掉的记忆');
      await T(`
        document.querySelector('[data-close="snapMask"]').click();
        var sel = document.querySelector('#tagFilter');
        sel.value = '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      `);
    });

    await check('Esc 关闭模态框', async () => {
      await T(`document.querySelector('#btnSnapshot').click(); return true;`);
      eq(await T(`return document.querySelector('#snapMask').classList.contains('show');`), true);
      await T(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;`);
      eq(await T(`return document.querySelector('#snapMask').classList.contains('show');`), false);
      eq(await T(`return document.querySelector('#snapMask').hidden;`), true);
    });

    await check('复制按钮把 Markdown 写入剪贴板', async () => {
      await session.cdp.send('Browser.grantPermissions', {
        origin: server.url,
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
      });
      await T(`document.querySelector('#btnSnapshot').click(); return true;`);
      const expected = await T(`return __T.text('#snapText');`);
      await T(`document.querySelector('#btnCopySnap').click(); return true;`);
      await new Promise((r) => setTimeout(r, 400));
      const clip = await T(`return navigator.clipboard.readText();`);
      // Windows 剪贴板会把换行规范化为 CRLF，比较前统一一下
      eq(String(clip).replace(/\r\n/g, '\n'), expected);
      includes(await T(`return __T.text('#toast');`), '已复制');
      await T(`document.querySelector('[data-close="snapMask"]').click(); return true;`);
    });

    /* --------------------------- Phase 6 · 导出 / 导入 --------------------------- */
    section('导出与导入');

    await check('导出 JSON 可被解析且结构完整', async () => {
      await T(`
        window.__cap = { blob: null, name: null };
        URL.createObjectURL = function (blob) { window.__cap.blob = blob; return 'blob:captured'; };
        HTMLAnchorElement.prototype.click = function () { window.__cap.name = this.download; };
        document.querySelector('#btnExport').click();
        return true;
      `);
      const raw = await T(`return window.__cap.blob.text();`);
      const data = JSON.parse(raw);
      eq(data.app, 'ai-memory-vault');
      eq(data.version, 1);
      eq(data.memories.length, 8);
      assert(typeof data.exportedAt === 'string' && data.exportedAt.length > 10, 'exportedAt 缺失');
      const name = await T(`return window.__cap.name;`);
      assert(/^ai-memory-vault-.*\.json$/.test(name), '下载文件名异常：' + name);
      writeFileSync(join(workDir, 'backup.json'), raw, 'utf8');
    });

    await check('导入备份文件：去重且跳过重复条目', async () => {
      const backup = readFileSync(join(workDir, 'backup.json'), 'utf8');
      writeFileSync(join(workDir, 'same-again.json'), backup, 'utf8');
      await setFileInput(session, join(workDir, 'same-again.json'));
      await new Promise((r) => setTimeout(r, 500));
      eq(await T(`return __T.cards().length;`), 8, '同一份备份再次导入不应新增');
      includes(await T(`return __T.text('#toast');`), '跳过重复');
    });

    await check('导入新数据文件会追加记忆', async () => {
      const payload = {
        app: 'ai-memory-vault',
        version: 1,
        memories: [
          { id: 'imported-1', role: 'user', content: '导入的新记忆：家住杭州', tags: ['个人信息'], weight: 3 },
          { id: 'imported-2', role: 'ai', content: '已记录杭州', tags: ['个人信息'], weight: 1 }
        ]
      };
      writeFileSync(join(workDir, 'fresh.json'), JSON.stringify(payload), 'utf8');
      await setFileInput(session, join(workDir, 'fresh.json'));
      await new Promise((r) => setTimeout(r, 500));
      eq(await T(`return __T.cards().length;`), 10);
      includes(await T(`return __T.text('#toast');`), '新增 2 条');
    });

    await check('导入非法 JSON 时给出错误提示且不崩', async () => {
      writeFileSync(join(workDir, 'broken.json'), '{ 这不是 json', 'utf8');
      await setFileInput(session, join(workDir, 'broken.json'));
      await new Promise((r) => setTimeout(r, 500));
      includes(await T(`return __T.text('#toast');`), '导入失败');
      eq(await T(`return __T.cards().length;`), 10);
    });

    /* ------------------------------ Phase 7 · 安全 ------------------------------ */
    section('XSS 防护');

    await check('记忆内容中的脚本标签按纯文本渲染', async () => {
      await T(`
        __T.add('user', '<img src=x onerror="window.__xss=1">', '安全', 2);
        return true;
      `);
      eq(await T(`return document.querySelectorAll('#list img').length;`), 0, '不应生成 img 节点');
      eq(await T(`return typeof window.__xss;`), 'undefined', 'onerror 不应执行');
      includes(await T(`return __T.cardText().join('\\n');`), '<img src=x onerror="window.__xss=1">');
    });

    await check('导入数据里的恶意 id 被净化，无法注入属性', async () => {
      const payload = {
        memories: [{
          id: '"><img src=x onerror="window.__xss2=1">',
          role: 'user',
          content: '带恶意 id 的记忆',
          tags: ['x']
        }]
      };
      writeFileSync(join(workDir, 'evil.json'), JSON.stringify(payload), 'utf8');
      await setFileInput(session, join(workDir, 'evil.json'));
      await new Promise((r) => setTimeout(r, 500));
      eq(await T(`return document.querySelectorAll('#list img').length;`), 0);
      eq(await T(`return typeof window.__xss2;`), 'undefined');
      const ids = await T(`return __T.cards().map(function (el) { return el.getAttribute('data-id'); });`);
      ids.forEach((id) => assert(!/[^A-Za-z0-9_-]/.test(id), '存在未净化 id：' + id));
    });

    await check('标签内容同样被转义', async () => {
      await T(`__T.add('ai', '标签转义测试', '<b>x</b>', 1); return true;`);
      eq(await T(`return document.querySelectorAll('#list .chip b').length;`), 0);
      includes(await T(`return __T.text('#list');`), '<b>x</b>');
    });

    /* ----------------------------- Phase 8 · 彩蛋 ----------------------------- */
    section('开场弹窗与彩蛋');

    await check('首次打开自动弹出英文彩蛋且可关闭', async () => {
      await T(`sessionStorage.removeItem('mvault.wished'); return true;`);
      await session.reload();
      await session.installHelpers();
      await session.waitFor(`document.querySelector('#wishMask').classList.contains('show')`, 4000);
      const text = await T(`return document.querySelector('#wishText').innerText;`);
      assert(/May you one day be reunited\s+with the people who matter most to you\./.test(text),
        '彩蛋文案不匹配：' + JSON.stringify(text));
      await T(`document.querySelector('#wishMask [data-close]').click(); return true;`);
      eq(await T(`return document.querySelector('#wishMask').hidden;`), true);
    });

    await check('同一会话内不重复弹出，统计面板 ✦ 可重现', async () => {
      await session.reload();
      await session.installHelpers();
      await new Promise((r) => setTimeout(r, 1400));
      eq(await T(`return document.querySelector('#wishMask').classList.contains('show');`), false);
      await T(`document.querySelector('#btnWish').click(); return true;`);
      eq(await T(`return document.querySelector('#wishMask').classList.contains('show');`), true);
      await T(`document.querySelector('#wishMask [data-close]').click(); return true;`);
    });

    /* --------------------------- Phase 9 · 持久化 --------------------------- */
    section('持久化与容错');

    await check('刷新后记忆从 localStorage 恢复', async () => {
      const before = await T(`return __T.cards().length;`);
      eq(before, 13, '前置步骤应留下 13 条记忆');
      await session.reload();
      await session.installHelpers();
      eq(await T(`return __T.cards().length;`), before);
      const total = await T(`return __T.text('#stats .stat b');`);
      eq(total, String(before));
    });

    await check('localStorage 损坏时仍能启动并提示', async () => {
      await T(`localStorage.setItem('${storageKey}', '{ 坏掉的 json'); return true;`);
      await session.reload();
      await session.installHelpers();
      eq(await T(`return __T.cards().length;`), 0);
      includes(await T(`return __T.text('#list');`), '还没有任何记忆');
      await session.waitFor(`__T.text('#toast').indexOf('读取失败') !== -1`, 3000);
      await T(`localStorage.clear(); return true;`);
      await session.reload();
      await session.installHelpers();
    });

    /* --------------------------- Phase 10 · 适配与收尾 --------------------------- */
    section('响应式 / 无障碍 / 控制台');

    await T(`
      __T.add('user', '响应式测试记忆一', 'r', 2);
      __T.add('ai', '响应式测试记忆二', 'r', 2);
      return true;
    `);

    await check('窄屏切换为单列布局', async () => {
      await session.setViewport(420, 900);
      await new Promise((r) => setTimeout(r, 200));
      const columns = await T(`return getComputedStyle(document.querySelector('.grid')).gridTemplateColumns;`);
      assert(columns.trim().split(/\s+/).length === 1, '窄屏应为单列，实际：' + columns);
      await session.clearViewport();
      await new Promise((r) => setTimeout(r, 300));
      const wide = await T(`return getComputedStyle(document.querySelector('.grid')).gridTemplateColumns;`);
      assert(wide.trim().split(/\s+/).length === 2, '宽屏应为两列，实际：' + wide);
    });

    await check('图标按钮都有可读名称', async () => {
      const unnamed = await T(`
        return __T.qa('#list .icon-btn').filter(function (el) {
          return !el.getAttribute('aria-label') && !el.getAttribute('title');
        }).length;
      `);
      eq(unnamed, 0);
    });

    await check('整个测试过程没有未捕获异常', async () => {
      eq(session.pageErrors.length, 0, '页面异常：' + session.pageErrors.join(' | '));
    });

    await check('控制台没有 error 级别输出', async () => {
      const real = session.consoleErrors.filter((line) => line && line.indexOf('favicon') === -1);
      eq(real.length, 0, '控制台错误：' + real.join(' | '));
    });
  } finally {
    await session.close();
    await server.close();
  }

  console.log('\n' + '─'.repeat(52));
  if (failures.length) {
    console.error(`✘ 浏览器测试失败：${failures.length} 项失败 / 共 ${passed + failures.length} 项`);
    failures.forEach((f) => console.error('  · ' + f.name + ' → ' + f.message));
    process.exit(1);
  }
  console.log(`✔ 浏览器测试全部通过：${passed} 项断言组`);
}

/** 通过 CDP 给 <input type=file> 塞一个真实文件，触发真实的 change 流程 */
async function setFileInput(session, filePath) {
  const { root } = await session.cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await session.cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
  if (!nodeId) throw new Error('找不到 #fileInput');
  await session.cdp.send('DOM.setFileInputFiles', { files: [filePath], nodeId });
}

main().catch((err) => {
  console.error('测试运行失败：' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
