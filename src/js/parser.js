/**
 * parser.js — 纯文本 → 结构化记忆
 * 只做数据转换，不碰 DOM，可被单元测试直接 import。
 */
/** 批量导入时识别的角色前缀（中英混排都吃） */
export const BULK_LINE_RE = /^\s*(用户|我|User|Human|人|提问|AI|Assistant|助手|GPT|模型|机器人|Bot|Claude|DeepSeek)\s*[：:]\s*(.*)$/;

const USER_WORDS = /^(用户|我|User|Human|人|提问)$/i;

/** 标签串 → 去重后的标签数组 */
export function parseTags(raw, limit) {
  var max = limit || 12;
  var seen = {};
  var out = [];
  String(raw == null ? '' : raw).split(/[,，、;；\s]+/).forEach(function (piece) {
    var tag = piece.replace(/^#+/, '').trim().slice(0, 24);
    if (!tag) return;
    var key = tag.toLowerCase();
    if (seen[key]) return;
    seen[key] = 1;
    if (out.length < max) out.push(tag);
  });
  return out;
}

export function isUserRole(word) {
  return USER_WORDS.test(String(word || '').trim());
}

/**
 * 把一整段对话切分成 [{ role, content }]。
 * 识别不了任何角色前缀时返回空数组，由调用方决定怎么兜底。
 */
export function parseConversation(text) {
  var items = [];
  var current = null;
  String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
    var matched = line.match(BULK_LINE_RE);
    if (matched) {
      if (current && current.content.trim()) items.push(current);
      current = {
        role: isUserRole(matched[1]) ? 'user' : 'ai',
        content: matched[2]
      };
    } else if (current) {
      current.content += '\n' + line;
    }
  });
  if (current && current.content.trim()) items.push(current);
  return items.map(function (it) {
    return { role: it.role, content: it.content.trim() };
  }).filter(function (it) {
    return it.content.length > 0;
  });
}
