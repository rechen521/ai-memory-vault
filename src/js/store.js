/**
 * store.js — 记忆数据层（纯函数）
 * 没有 DOM、没有存储副作用，便于 Node 端单元测试。
 */
import { clamp, sanitizeId, toInt, uid } from './util.js';

export const SCHEMA_VERSION = 1;
export const MAX_CONTENT = 20000;
export const MAX_TAGS = 12;

/** 把任意来源（localStorage / 导入文件 / 手工对象）的记忆对象洗成规范结构 */
export function normalizeMemory(raw) {
  var src = raw && typeof raw === 'object' ? raw : {};
  var createdAt = Number(src.createdAt) || Date.now();
  var role = src.role === 'ai' ? 'ai' : 'user';
  var content = String(src.content == null ? '' : src.content).trim().slice(0, MAX_CONTENT);
  return {
    id: sanitizeId(src.id),
    role: role,
    content: content,
    tags: dedupeTags(src.tags).slice(0, MAX_TAGS),
    weight: clamp(toInt(src.weight, 2), 1, 3),
    pinned: !!src.pinned,
    createdAt: createdAt,
    updatedAt: Number(src.updatedAt) || createdAt
  };
}

export function dedupeTags(tags) {
  var seen = {};
  var out = [];
  (Array.isArray(tags) ? tags : []).forEach(function (t) {
    var tag = String(t == null ? '' : t).trim().slice(0, 24);
    if (!tag) return;
    var key = tag.toLowerCase();
    if (seen[key]) return;
    seen[key] = 1;
    out.push(tag);
  });
  return out;
}

/** 新建一条记忆；内容为空时返回 null */
export function createMemory(input) {
  var src = input || {};
  var content = String(src.content == null ? '' : src.content).trim();
  if (!content) return null;
  return normalizeMemory({
    id: uid(),
    role: src.role,
    content: content,
    tags: src.tags,
    weight: src.weight,
    pinned: !!src.pinned,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
}

/** 搜索 + 标签筛选 + 排序，返回新数组（不改原数组） */
export function filterMemories(memories, filter) {
  var f = filter || {};
  var q = String(f.q == null ? '' : f.q).trim().toLowerCase();
  var list = (memories || []).slice();

  if (q) {
    list = list.filter(function (m) {
      return (m.content + ' ' + m.tags.join(' ')).toLowerCase().indexOf(q) !== -1;
    });
  }
  if (f.tag) {
    list = list.filter(function (m) { return m.tags.indexOf(f.tag) !== -1; });
  }

  if (f.sort === 'new') {
    list.sort(function (a, b) { return b.createdAt - a.createdAt; });
  } else if (f.sort === 'old') {
    list.sort(function (a, b) { return a.createdAt - b.createdAt; });
  } else {
    list.sort(function (a, b) {
      return (b.pinned - a.pinned) || (b.weight - a.weight) || (b.createdAt - a.createdAt);
    });
  }
  return list;
}

/** [{ tag, count }]，按出现次数降序、同次数按名称排序 */
export function collectTags(memories) {
  var counts = {};
  var names = {};
  (memories || []).forEach(function (m) {
    (m.tags || []).forEach(function (t) {
      var key = t.toLowerCase();
      names[key] = names[key] || t;
      counts[key] = (counts[key] || 0) + 1;
    });
  });
  return Object.keys(counts).map(function (key) {
    return { tag: names[key], count: counts[key] };
  }).sort(function (a, b) {
    return (b.count - a.count) || a.tag.localeCompare(b.tag);
  });
}

export function statsOf(memories) {
  var list = memories || [];
  var user = 0;
  list.forEach(function (m) { if (m.role === 'user') user += 1; });
  return {
    total: list.length,
    user: user,
    ai: list.length - user,
    tags: collectTags(list).length,
    top: list.filter(function (m) { return m.weight === 3 || m.pinned; }).length,
    pinned: list.filter(function (m) { return m.pinned; }).length
  };
}

/** 内容指纹：用于导入时识别「换过 id 的同一条记忆」 */
export function contentSignature(memory) {
  return String(memory.role) + '\u0000' + String(memory.content).trim().replace(/\s+/g, ' ');
}

/**
 * 合并导入数据：按 id 去重，再按内容指纹去重。
 * @returns {{ memories: Array, added: number, skipped: number }}
 */
export function mergeImported(existing, incoming) {
  var list = (existing || []).slice();
  var byId = {};
  var bySignature = {};
  list.forEach(function (m) {
    byId[m.id] = true;
    bySignature[contentSignature(m)] = true;
  });

  var added = 0;
  var skipped = 0;
  (incoming || []).forEach(function (raw) {
    var m = normalizeMemory(raw);
    if (!m.content) { skipped += 1; return; }
    var sig = contentSignature(m);
    if (byId[m.id] || bySignature[sig]) { skipped += 1; return; }
    byId[m.id] = true;
    bySignature[sig] = true;
    list.push(m);
    added += 1;
  });
  return { memories: list, added: added, skipped: skipped };
}

/** 导出文件结构 */
export function toExportPayload(memories, exportedAt) {
  return {
    app: 'ai-memory-vault',
    version: SCHEMA_VERSION,
    exportedAt: exportedAt || new Date().toISOString(),
    memories: (memories || []).slice()
  };
}

/** 从导入文件里取出记忆数组，兼容纯数组 / {memories:[...]} / 单条对象 */
export function extractMemories(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.memories)) return data.memories;
  if (data && typeof data === 'object' && data.content) return [data];
  throw new Error('invalid-format');
}
