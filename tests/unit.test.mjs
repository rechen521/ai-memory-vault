/**
 * 单元测试：数据层 + 持久化层（纯逻辑，零依赖，node --test 直接跑）
 * 运行：npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, sanitizeId, formatTime, clamp, toInt } from '../src/js/util.js';
import { parseTags, parseConversation, isUserRole } from '../src/js/parser.js';
import {
  normalizeMemory, createMemory, filterMemories, collectTags, statsOf,
  mergeImported, extractMemories, toExportPayload, contentSignature,
  MAX_CONTENT, SCHEMA_VERSION
} from '../src/js/store.js';
import { buildSnapshot, scopeNote } from '../src/js/snapshot.js';
import { loadLocalState, saveLocalState, createFileSync, LS_KEY } from '../src/js/filestore.js';

/* --------------------------------- util ---------------------------------- */

test('escapeHtml 转义全部危险字符', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml("it's & <b>"), 'it&#39;s &amp; &lt;b&gt;');
  assert.equal(escapeHtml(null), '');
});

test('sanitizeId 剥离属性/选择器注入字符', () => {
  assert.equal(sanitizeId('"><img src=x onerror=alert(1)>'), 'imgsrcxonerroralert1');
  assert.equal(sanitizeId('abc-123_XY'), 'abc-123_XY');
  assert.equal(sanitizeId("a'b\\c]d"), 'abcd');
  assert.match(sanitizeId(''), /^[a-z0-9]+$/);
  assert.ok(sanitizeId('x'.repeat(80)).length <= 40);
});

test('clamp / toInt 边界', () => {
  assert.equal(clamp(9, 1, 3), 3);
  assert.equal(clamp(-1, 1, 3), 1);
  assert.equal(toInt('2', 2), 2);
  assert.equal(toInt('x', 2), 2);
  assert.equal(toInt(undefined, 5), 5);
});

test('formatTime 输出本地 YYYY-MM-DD HH:mm', () => {
  const ts = new Date(2026, 9, 16, 22, 22).getTime();
  assert.equal(formatTime(ts), '2026-10-16 22:22');
});

/* -------------------------------- parser --------------------------------- */

test('parseTags 去重、去 #、限长、限数量', () => {
  assert.deepEqual(parseTags('志愿填报, 偏好 志愿填报'), ['志愿填报', '偏好']);
  assert.deepEqual(parseTags('#a，#b、c；d'), ['a', 'b', 'c', 'd']);
  assert.equal(parseTags('t1,t2,t3,t4', 2).length, 2);
  assert.deepEqual(parseTags('   '), []);
  assert.deepEqual(parseTags(null), []);
});

test('isUserRole 识别中英文用户侧前缀', () => {
  for (const w of ['用户', '我', 'User', 'human', '人']) assert.equal(isUserRole(w), true, w);
  for (const w of ['AI', 'Assistant', '助手', 'GPT']) assert.equal(isUserRole(w), false, w);
});

test('parseConversation 按角色切分并保留多行内容', () => {
  const text = [
    '用户：我 2026 年高考，物理方向',
    'AI：好的，我来帮你分析',
    '先看分数段',
    '',
    '用户: 只看省内院校',
    'Assistant: 收到'
  ].join('\n');
  const items = parseConversation(text);
  assert.equal(items.length, 4);
  assert.equal(items[0].role, 'user');
  assert.equal(items[1].role, 'ai');
  assert.match(items[1].content, /先看分数段/);
  assert.equal(items[2].content, '只看省内院校');
  assert.equal(items[3].role, 'ai');
});

test('parseConversation 无角色前缀时返回空数组（交给调用方兜底）', () => {
  assert.deepEqual(parseConversation('随便写点什么\n没有前缀'), []);
});

/* --------------------------------- store --------------------------------- */

test('normalizeMemory 洗掉脏数据', () => {
  const m = normalizeMemory({
    id: 'a"><script>',
    role: 'robot',
    content: 'x'.repeat(MAX_CONTENT + 500),
    tags: ['a', 'A', '', '  b  '],
    weight: 99,
    pinned: 1,
    createdAt: '12345'
  });
  assert.equal(m.role, 'user');
  assert.equal(m.content.length, MAX_CONTENT);
  assert.deepEqual(m.tags, ['a', 'b']);
  assert.equal(m.weight, 3);
  assert.equal(m.pinned, true);
  assert.equal(m.createdAt, 12345);
  assert.ok(!/[^A-Za-z0-9_-]/.test(m.id));
  assert.equal(normalizeMemory({ content: '   \n  ' }).content, '', '纯空白内容应被清空');
});

test('createMemory 空内容返回 null，正常内容补齐元数据', () => {
  assert.equal(createMemory({ content: '   ' }), null);
  const m = createMemory({ role: 'ai', content: ' 记住了 ', tags: ['x'], weight: 1 });
  assert.equal(m.role, 'ai');
  assert.equal(m.content, '记住了');
  assert.deepEqual(m.tags, ['x']);
  assert.equal(m.weight, 1);
  assert.ok(m.id && m.createdAt && m.updatedAt);
});

test('filterMemories：搜索、标签、三种排序', () => {
  const base = [
    createMemory({ role: 'user', content: 'Excel 成绩单', tags: ['学习'], weight: 1 }),
    createMemory({ role: 'ai', content: '报考建议', tags: ['志愿填报'], weight: 3 }),
    createMemory({ role: 'user', content: '只考虑省内', tags: ['志愿填报', '偏好'], weight: 2 })
  ];
  base[0].createdAt = 1000;
  base[1].createdAt = 3000;
  base[2].createdAt = 2000;

  assert.equal(filterMemories(base, { q: 'excel' }).length, 1);
  assert.equal(filterMemories(base, { tag: '志愿填报' }).length, 2);
  assert.equal(filterMemories(base, { q: '不存在' }).length, 0);

  assert.deepEqual(filterMemories(base, { sort: 'new' }).map((m) => m.createdAt), [3000, 2000, 1000]);
  assert.deepEqual(filterMemories(base, { sort: 'old' }).map((m) => m.createdAt), [1000, 2000, 3000]);
  // 智能排序：置顶 > 重要度 > 时间
  assert.deepEqual(filterMemories(base, { sort: 'smart' }).map((m) => m.createdAt), [3000, 2000, 1000]);
  base[0].pinned = true;
  assert.equal(filterMemories(base, {}).at(0).content, 'Excel 成绩单');
  assert.equal(base.length, 3, 'filterMemories 不应修改原数组顺序');
});

test('collectTags 统计次数并排序', () => {
  const list = [
    createMemory({ content: 'a', tags: ['x', 'y'] }),
    createMemory({ content: 'b', tags: ['x'] })
  ];
  assert.deepEqual(collectTags(list), [{ tag: 'x', count: 2 }, { tag: 'y', count: 1 }]);
});

test('statsOf 统计总数 / 用户侧 / AI 侧 / 标签数 / 高优先级', () => {
  const list = [
    createMemory({ role: 'user', content: 'a', tags: ['x'], weight: 3 }),
    createMemory({ role: 'ai', content: 'b', tags: ['x', 'y'], weight: 2 })
  ];
  list[1].pinned = true;
  assert.deepEqual(statsOf(list), { total: 2, user: 1, ai: 1, tags: 2, top: 2, pinned: 1 });
});

test('mergeImported 按 id 与内容双重去重', () => {
  const existing = [createMemory({ role: 'user', content: '原有记忆' })];
  const result = mergeImported(existing, [
    { id: existing[0].id, role: 'user', content: '改了内容但 id 相同' },
    { id: 'brand-new', role: 'user', content: '原有记忆' },
    { id: 'fresh-1', role: 'ai', content: '全新记忆' },
    { id: 'fresh-2', role: 'ai', content: '   ' }
  ]);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 3);
  assert.equal(result.memories.length, 2);
  assert.equal(result.memories[1].content, '全新记忆');
});

test('contentSignature 折叠空白，便于识别同一条记忆', () => {
  assert.equal(
    contentSignature({ role: 'ai', content: 'a  b\n c ' }),
    contentSignature({ role: 'ai', content: 'a b c' })
  );
});

test('extractMemories 兼容三种导入格式并拒绝垃圾数据', () => {
  assert.deepEqual(extractMemories([{ content: 'x' }]).length, 1);
  assert.deepEqual(extractMemories({ memories: [{ content: 'x' }] }).length, 1);
  assert.deepEqual(extractMemories({ content: 'x' }).length, 1);
  assert.throws(() => extractMemories({ hello: 'world' }), /invalid-format/);
  assert.throws(() => extractMemories(null), /invalid-format/);
});

test('toExportPayload 结构稳定', () => {
  const payload = toExportPayload([createMemory({ content: 'x' })], '2026-10-16T00:00:00.000Z');
  assert.equal(payload.app, 'ai-memory-vault');
  assert.equal(payload.version, SCHEMA_VERSION);
  assert.equal(payload.exportedAt, '2026-10-16T00:00:00.000Z');
  assert.equal(payload.memories.length, 1);
});

/* -------------------------------- snapshot ------------------------------- */

test('buildSnapshot 生成结构完整的 Markdown', () => {
  const at = new Date(2026, 9, 16, 22, 22).getTime();
  const list = [
    createMemory({ role: 'user', content: '我 2026 年高考', tags: ['个人信息'], weight: 3 }),
    createMemory({ role: 'ai', content: '建议冲稳保三档', tags: ['志愿填报'], weight: 2 })
  ];
  // 固定时间戳：否则下面断言里的日期会跟着「今天是几号」变，零点一过就挂（CI 上就踩过）
  list.forEach(function (m) { m.createdAt = at; m.updatedAt = at; });
  list[0].pinned = true;
  const text = buildSnapshot(list, { now: at });

  assert.match(text, /^# AI 上下文快照（由 AI 记忆库生成）/);
  assert.match(text, /生成时间：2026-10-16 22:22/);
  assert.match(text, /记忆条数：2/);
  assert.match(text, /### 1\. 用户 · 2026-10-16 \d\d:\d\d  ★★★  \[置顶\]  #个人信息/);
  assert.match(text, /### 2\. AI · .* ★★☆  #志愿填报/);
  assert.match(text, /我 2026 年高考/);
  assert.match(text, /（以上为历史记忆，请在此基础上继续。）$/);
});

test('buildSnapshot 默认只导出筛选命中的记忆并注明范围', () => {
  const list = [
    createMemory({ role: 'user', content: '甲', tags: ['a'] }),
    createMemory({ role: 'user', content: '乙', tags: ['b'] })
  ];
  const filtered = buildSnapshot(list, { filter: { tag: 'a', q: '甲' } });
  assert.match(filtered, /记忆条数：1（已筛选：标签 #a \+ 关键词「甲」）/);
  assert.ok(!filtered.includes('乙'));
  const all = buildSnapshot(list, { visibleOnly: false });
  assert.match(all, /记忆条数：2/);
  assert.equal(scopeNote({}), '');
});

/* ------------------------------- filestore ------------------------------- */

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    _map: map
  };
}

test('loadLocalState 读取 / 空库 / 损坏数据', () => {
  const good = fakeStorage({ [LS_KEY]: JSON.stringify({ memories: [{ content: 'x' }], updatedAt: 7 }) });
  const loaded = loadLocalState(good);
  assert.equal(loaded.memories.length, 1);
  assert.equal(loaded.updatedAt, 7);
  assert.equal(loaded.corrupt, false);

  assert.deepEqual(loadLocalState(fakeStorage({})), { memories: [], updatedAt: 0, corrupt: false });

  const bad = loadLocalState(fakeStorage({ [LS_KEY]: '{ 坏掉的 json' }));
  assert.equal(bad.corrupt, true);
  assert.deepEqual(bad.memories, []);
});

test('saveLocalState 配额溢出时返回 false 而不抛异常', () => {
  assert.equal(saveLocalState({ memories: [] }, fakeStorage({})), true);
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(saveLocalState({ memories: [] }, full), false);
});

test('createFileSync：绑定后立即落盘，之后去抖写入', async () => {
  const writes = [];
  const handle = {
    name: 'memory.json',
    queryPermission: async () => 'granted',
    createWritable: async () => ({
      write: async (text) => { writes.push(text); },
      close: async () => {}
    })
  };
  const sync = createFileSync({
    picker: async () => handle,
    payload: () => ({ memories: [{ content: 'hello' }] })
  });

  assert.equal(sync.isSupported(), true);
  assert.equal(sync.hasHandle(), false);

  await sync.bind();
  assert.equal(sync.hasHandle(), true);
  assert.equal(sync.getState().bound, true);
  assert.equal(writes.length, 1, '绑定后应立刻写入一次');
  assert.equal(JSON.parse(writes[0]).memories[0].content, 'hello');

  sync.schedule();
  sync.schedule();
  sync.schedule();
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(writes.length, 2, '连续 schedule 只应合并成一次写入');
});

test('createFileSync：未授权时不写文件', async () => {
  let wrote = 0;
  const sync = createFileSync({
    picker: async () => ({
      name: 'x.json',
      queryPermission: async () => 'prompt',
      createWritable: async () => ({ write: async () => { wrote += 1; }, close: async () => {} })
    }),
    payload: () => ({ memories: [] })
  });
  await sync.bind();
  assert.equal(wrote, 0);
  assert.equal(sync.getState().permission, 'prompt');
  assert.equal(sync.getState().bound, true);
});

test('createFileSync：不支持的浏览器给出 supported=false', async () => {
  const sync = createFileSync({ picker: null, payload: () => ({}) });
  assert.equal(sync.isSupported(), false);
  await assert.rejects(() => sync.bind(), /unsupported/);
  assert.deepEqual(await sync.restore(), sync.getState());
});
