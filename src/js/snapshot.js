/**
 * snapshot.js — 把记忆渲染成「可直接粘进新对话」的 Markdown 上下文
 * 这是整个工具的核心产出物，格式保持稳定，便于任何 AI 客户端理解。
 */
import { formatTime } from './util.js';
import { filterMemories } from './store.js';

export const SNAPSHOT_TITLE = '# AI 上下文快照（由 AI 记忆库生成）';
export const SNAPSHOT_RULE = '请将以下内容视为**已知上下文**，不要重复询问，并保持前后一致；如与后续描述冲突，以用户最新表述为准。';

/**
 * @param {Array} memories 记忆数组
 * @param {{ filter?: object, visibleOnly?: boolean, now?: number }} [options]
 *        visibleOnly=true 时只导出当前筛选/搜索命中的记忆（默认行为）
 */
export function buildSnapshot(memories, options) {
  var opts = options || {};
  var filter = opts.filter || {};
  var list = opts.visibleOnly === false ? (memories || []).slice() : filterMemories(memories, filter);
  var lines = [];

  lines.push(SNAPSHOT_TITLE);
  lines.push('');
  lines.push('> 生成时间：' + formatTime(opts.now || Date.now()));
  lines.push('> 记忆条数：' + list.length + scopeNote(filter));
  lines.push('');
  lines.push(SNAPSHOT_RULE);
  lines.push('');
  lines.push('---');
  lines.push('');

  list.forEach(function (m, i) {
    var flags = '★'.repeat(m.weight) + '☆'.repeat(Math.max(0, 3 - m.weight));
    var tags = m.tags.length ? '  ' + m.tags.map(function (t) { return '#' + t; }).join(' ') : '';
    lines.push('### ' + (i + 1) + '. ' + (m.role === 'user' ? '用户' : 'AI') + ' · ' +
      formatTime(m.createdAt) + '  ' + flags + (m.pinned ? '  [置顶]' : '') + tags);
    lines.push('');
    lines.push(m.content);
    lines.push('');
  });

  lines.push('---');
  lines.push('');
  lines.push('（以上为历史记忆，请在此基础上继续。）');
  return lines.join('\n');
}

/** 说明这份快照是不是被筛选过的，避免 AI 误以为拿到了全部记忆 */
export function scopeNote(filter) {
  var f = filter || {};
  var bits = [];
  if (f.tag) bits.push('标签 #' + f.tag);
  if (f.q && String(f.q).trim()) bits.push('关键词「' + String(f.q).trim() + '」');
  return bits.length ? '（已筛选：' + bits.join(' + ') + '）' : '';
}
