/**
 * ui.js — 界面控制器：DOM 渲染 + 事件绑定
 * 业务规则全部来自 store / parser / snapshot，本文件只负责「把状态画出来」和「把操作转成状态变更」。
 */
import { copyText, downloadBlob, escapeHtml, formatTime, toInt, uid } from './util.js';
import { parseConversation, parseTags } from './parser.js';
import { createMemory, extractMemories, filterMemories, collectTags, mergeImported, normalizeMemory, statsOf, toExportPayload } from './store.js';
import { buildSnapshot } from './snapshot.js';
import { createFileSync, loadLocalState, saveLocalState } from './filestore.js';

export function createApp(env) {
  var context = env || {};
  var doc = context.document || document;
  var win = context.window || window;

  var $ = function (sel) { return doc.querySelector(sel); };
  var state = { memories: [], updatedAt: 0 };
  var filter = { q: '', tag: '', sort: 'smart' };
  var draft = { role: 'user', weight: 2 };
  var editingId = null;
  var editDrafts = {};
  var storageFailed = false;
  var toastTimer = null;
  var wishTimer = null;

  var fileSync = createFileSync({
    payload: function () { return toExportPayload(state.memories, new Date().toISOString()); },
    onStatus: function () { renderBadge(); }
  });

  /* ------------------------------- 小工具 -------------------------------- */

  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
  }

  function persist() {
    state.updatedAt = Date.now();
    var ok = saveLocalState({ memories: state.memories, updatedAt: state.updatedAt });
    if (!ok && !storageFailed) {
      storageFailed = true;
      toast('本地存储写入失败（可能已满），请导出备份');
    } else if (ok) {
      storageFailed = false;
    }
    fileSync.schedule();
  }

  /* ------------------------------- 渲染 --------------------------------- */

  function visible() {
    return filterMemories(state.memories, filter);
  }

  function memoryCard(m) {
    var stars = '★'.repeat(m.weight) + '☆'.repeat(3 - m.weight);
    var id = escapeHtml(m.id);
    var editing = editingId === m.id;
    var tags = m.tags.length
      ? '<div class="mem-tags">' + m.tags.map(function (t) {
        var on = filter.tag && filter.tag.toLowerCase() === t.toLowerCase();
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-tag="' + escapeHtml(t) +
          '" aria-pressed="' + (on ? 'true' : 'false') + '">#' + escapeHtml(t) + '</button>';
      }).join('') + '</div>'
      : '';

    var body = editing
      ? '<textarea class="mem-edit" data-edit="' + id + '" rows="3" aria-label="编辑记忆内容">' +
        escapeHtml(editDrafts[m.id] !== undefined ? editDrafts[m.id] : m.content) + '</textarea>' +
        '<div class="mem-edit-foot">' +
        '<button class="btn primary" type="button" data-save="' + id + '">保存</button>' +
        '<button class="btn ghost" type="button" data-cancel="' + id + '">取消</button>' +
        '</div>'
      : '<p class="mem-body">' + escapeHtml(m.content) + '</p>' + tags;

    return '<article class="mem' + (m.pinned ? ' pinned' : '') + '" data-role="' + escapeHtml(m.role) +
      '" data-id="' + id + '">' +
      '<div class="mem-head">' +
      '<span class="role-name">' + (m.role === 'user' ? '用户' : 'AI') + '</span>' +
      '<span class="mem-time">' + formatTime(m.createdAt) + '</span>' +
      '<span class="stars-mini" aria-label="重要度 ' + m.weight + ' 星">' + stars + '</span>' +
      '<div class="mem-ops">' +
      '<button class="icon-btn" type="button" data-pin="' + id + '" title="' +
      (m.pinned ? '取消置顶' : '置顶') + '" aria-label="' + (m.pinned ? '取消置顶' : '置顶') + '">' +
      (m.pinned ? '📌' : '📍') + '</button>' +
      '<button class="icon-btn" type="button" data-edit-btn="' + id + '" title="编辑" aria-label="编辑">✎</button>' +
      '<button class="icon-btn" type="button" data-del="' + id + '" title="删除" aria-label="删除">✕</button>' +
      '</div>' +
      '</div>' + body +
      '</article>';
  }

  function renderList() {
    var box = $('#list');
    if (!box) return;
    var list = visible();
    if (!list.length) {
      var hasAny = state.memories.length > 0;
      box.innerHTML = '<div class="empty"><b>' + (hasAny ? '没有匹配的记忆' : '还没有任何记忆') + '</b>' +
        (hasAny ? '换个关键词或清空筛选试试' : '在左侧写下第一条需要长期记住的内容') + '</div>';
      return;
    }
    box.innerHTML = list.map(memoryCard).join('');
  }

  function renderTags() {
    var sel = $('#tagFilter');
    if (!sel) return;
    var tags = collectTags(state.memories);
    var options = ['<option value="">全部标签' + (tags.length ? '（' + tags.length + '）' : '') + '</option>'];
    tags.forEach(function (t) {
      options.push('<option value="' + escapeHtml(t.tag) + '"' +
        (filter.tag.toLowerCase() === t.tag.toLowerCase() ? ' selected' : '') + '>#' +
        escapeHtml(t.tag) + ' · ' + t.count + '</option>');
    });
    sel.innerHTML = options.join('');
  }

  function renderStats() {
    var box = $('#stats');
    if (!box) return;
    var s = statsOf(state.memories);
    box.innerHTML =
      '<div class="stat"><b>' + s.total + '</b><span>记忆总数</span></div>' +
      '<div class="stat"><b>' + s.tags + '</b><span>标签数</span></div>' +
      '<div class="stat"><b>' + s.user + '</b><span>用户侧</span></div>' +
      '<div class="stat"><b>' + s.ai + '</b><span>AI 侧</span></div>' +
      '<div class="stats-foot"><span>高优先级 ' + s.top + ' 条 · 更新于 ' +
      (state.updatedAt ? formatTime(state.updatedAt) : '—') + '</span>' +
      '<button class="icon-btn" type="button" id="btnWish" title="✦" aria-label="彩蛋">✦</button></div>';
  }

  function renderBadge() {
    var badge = $('#storageBadge');
    if (!badge) return;
    var st = fileSync.getState();
    badge.className = 'badge';
    if (!st.supported) {
      badge.textContent = '仅浏览器存储';
      badge.classList.add('warn');
      badge.title = '当前浏览器不支持文件绑定（需 Chrome / Edge），请定期导出 JSON 备份';
      return;
    }
    if (!st.bound) {
      badge.textContent = '仅浏览器存储';
      badge.classList.add('warn');
      badge.title = '建议点击「绑定本地文件」落盘备份';
      return;
    }
    if (st.permission === 'granted' || st.permission === 'unknown') {
      badge.textContent = '已同步：' + st.name;
      badge.classList.add('ok');
      badge.title = '每次修改后自动写入 ' + st.name + '（最近 ' +
        (st.lastSyncAt ? formatTime(st.lastSyncAt) : '尚未') + '）';
      return;
    }
    badge.textContent = st.lastError ? '同步失败，点击重试' : '点击恢复文件同步';
    badge.classList.add('warn');
    badge.title = '浏览器需要一次点击来重新授权写入 ' + st.name;
  }

  function renderStars() {
    var nodes = doc.querySelectorAll('#stars .star');
    for (var i = 0; i < nodes.length; i++) {
      var on = i < draft.weight;
      nodes[i].classList.toggle('on', on);
      nodes[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function renderRole() {
    var nodes = doc.querySelectorAll('#roleSeg .seg-btn');
    for (var i = 0; i < nodes.length; i++) {
      var on = nodes[i].getAttribute('data-role') === draft.role;
      nodes[i].classList.toggle('active', on);
      nodes[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function renderAll() {
    renderTags();
    renderList();
    renderStats();
    renderStars();
    renderRole();
    renderBadge();
  }

  /* ------------------------------ 模态框 -------------------------------- */

  function openModal(id) {
    var mask = $('#' + id);
    if (!mask) return;
    var active = doc.activeElement;
    mask.__returnFocus = active && active.focus ? active : null;
    mask.hidden = false;
    mask.classList.add('show');
    var focusable = mask.querySelector('button, [href], textarea, input, select');
    if (focusable) focusable.focus();
  }

  function closeModal(id) {
    var mask = $('#' + id);
    if (!mask) return;
    mask.classList.remove('show');
    mask.hidden = true;
    var back = mask.__returnFocus;
    mask.__returnFocus = null;
    if (back && back.focus) { try { back.focus(); } catch (e) { /* 忽略 */ } }
  }

  function closeAllModals() {
    closeModal('snapMask');
    closeModal('wishMask');
  }

  function anyModalOpen() {
    return !!doc.querySelector('.modal-mask.show');
  }

  /* ------------------------------ 记忆操作 ------------------------------ */

  function addMemory(role, content, tags, weight) {
    var m = createMemory({ role: role, content: content, tags: tags, weight: weight });
    if (m) state.memories.push(m);
    return m;
  }

  /** 列表局部刷新：只重画列表（搜索/筛选时用，避免打断输入） */
  function refreshList() {
    renderList();
    renderTags();
  }

  function commitSave() {
    var input = $('#contentInput');
    var content = input.value;
    if (!content.trim()) {
      toast('请先填写记忆内容');
      input.focus();
      return false;
    }
    addMemory(draft.role, content, parseTags($('#tagInput').value), draft.weight);
    input.value = '';
    $('#tagInput').value = '';
    persist();
    renderAll();
    toast('已保存 1 条记忆');
    return true;
  }

  function handleBulkImport() {
    var box = $('#bulkInput');
    var text = box.value;
    if (!text.trim()) { toast('请先粘贴对话内容'); return; }
    var items = parseConversation(text);
    if (!items.length) {
      addMemory('user', text.trim(), ['批量导入'], 2);
      persist();
      renderAll();
      box.value = '';
      toast('未识别角色前缀，已作为单条记忆保存');
      return;
    }
    items.forEach(function (it) { addMemory(it.role, it.content, ['批量导入'], 2); });
    persist();
    renderAll();
    box.value = '';
    toast('已解析并保存 ' + items.length + ' 条记忆');
  }

  function handleExport() {
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(JSON.stringify(toExportPayload(state.memories), null, 2),
      'ai-memory-vault-' + stamp + '.json', 'application/json');
    toast('已导出 JSON 备份（' + state.memories.length + ' 条）');
  }

  function handleImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var incoming = extractMemories(JSON.parse(String(reader.result)));
        var result = mergeImported(state.memories, incoming);
        state.memories = result.memories;
        persist();
        renderAll();
        toast('导入完成：新增 ' + result.added + ' 条' + (result.skipped ? '，跳过重复/空 ' + result.skipped + ' 条' : ''));
      } catch (e) {
        toast('导入失败：文件不是有效的记忆库 JSON');
      }
      $('#fileInput').value = '';
    };
    reader.onerror = function () { toast('文件读取失败'); };
    reader.readAsText(file, 'utf-8');
  }

  function showSnapshot() {
    if (!state.memories.length) { toast('还没有记忆，先生成几条吧'); return; }
    $('#snapText').textContent = buildSnapshot(state.memories, { filter: filter });
    openModal('snapMask');
  }

  function bindEvents() {
    $('#roleSeg').addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn) return;
      draft.role = btn.getAttribute('data-role');
      renderRole();
    });

    $('#stars').addEventListener('click', function (e) {
      var btn = e.target.closest('.star');
      if (!btn) return;
      draft.weight = toInt(btn.getAttribute('data-w'), 2);
      renderStars();
    });

    $('#btnAdd').addEventListener('click', commitSave);

    $('#tagInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitSave(); }
    });

    $('#contentInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitSave(); }
    });

    $('#btnBulk').addEventListener('click', handleBulkImport);

    $('#search').addEventListener('input', function (e) {
      filter.q = e.target.value;
      renderList();
    });

    $('#tagFilter').addEventListener('change', function (e) {
      filter.tag = e.target.value;
      refreshList();
    });

    $('#sortSel').addEventListener('change', function (e) {
      filter.sort = e.target.value;
      renderList();
    });

    $('#list').addEventListener('click', onListClick);
    $('#list').addEventListener('input', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-edit');
      if (id) editDrafts[id] = e.target.value;
    });

    $('#btnSnapshot').addEventListener('click', showSnapshot);

    $('#btnCopySnap').addEventListener('click', function () {
      copyText($('#snapText').textContent).then(function () {
        toast('已复制，粘贴到新对话开头即可');
      }, function () {
        toast('复制失败，请手动全选复制');
      });
    });

    $('#btnDownloadSnap').addEventListener('click', function () {
      var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadBlob($('#snapText').textContent, 'ai-context-snapshot-' + stamp + '.md', 'text/markdown');
    });

    $('#btnExport').addEventListener('click', handleExport);

    $('#btnImport').addEventListener('click', function () { $('#fileInput').click(); });

    $('#fileInput').addEventListener('change', function (e) {
      handleImportFile(e.target.files && e.target.files[0]);
    });

    $('#btnBind').addEventListener('click', function () {
      if (!fileSync.isSupported()) {
        toast('当前浏览器不支持文件绑定，请用 Chrome / Edge 打开');
        return;
      }
      fileSync.bind().then(function () {
        renderBadge();
        toast('已绑定并写入本地文件，之后每次修改自动同步');
      }, function (err) {
        if (err && err.name !== 'AbortError') toast('绑定失败：' + (err.message || err.name || '未知错误'));
        renderBadge();
      });
    });

    $('#storageBadge').addEventListener('click', function () {
      var st = fileSync.getState();
      if (!st.supported) { toast('当前浏览器不支持文件绑定，请用 Chrome / Edge 打开'); return; }
      if (!st.bound) { $('#btnBind').click(); return; }
      fileSync.requestPermission().then(function (ok) {
        renderBadge();
        toast(ok ? '已恢复文件同步' : '授权被拒绝，仍可用导出备份');
      });
    });

    $('#stats').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#btnWish')) openModal('wishMask');
    });

    doc.addEventListener('click', function (e) {
      var closer = e.target.closest && e.target.closest('[data-close]');
      if (closer) { closeModal(closer.getAttribute('data-close')); return; }
      if (e.target.classList && e.target.classList.contains('modal-mask')) {
        e.target.classList.remove('show');
        e.target.hidden = true;
      }
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && anyModalOpen()) closeAllModals();
    });

    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') fileSync.flush();
    });

    win.addEventListener('beforeunload', function () {
      if (fileSync.hasHandle()) fileSync.flush();
    });
  }

  function onListClick(e) {
    var target = e.target;
    var id;
    if ((id = target.getAttribute('data-del'))) {
      var victim = findMemory(id);
      if (victim && win.confirm('确定删除这条记忆？\n\n' + victim.content.slice(0, 60) +
        (victim.content.length > 60 ? '…' : ''))) {
        state.memories = state.memories.filter(function (x) { return x.id !== id; });
        delete editDrafts[id];
        persist();
        renderAll();
        toast('已删除');
      }
      return;
    }
    if ((id = target.getAttribute('data-pin'))) {
      var pinned = findMemory(id);
      if (pinned) {
        pinned.pinned = !pinned.pinned;
        pinned.updatedAt = Date.now();
        persist();
        renderAll();
      }
      return;
    }
    if ((id = target.getAttribute('data-edit-btn'))) {
      editingId = id;
      renderList();
      var ta = doc.querySelector('[data-edit="' + cssEscape(id) + '"]');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      return;
    }
    if ((id = target.getAttribute('data-save'))) {
      var box = doc.querySelector('[data-edit="' + cssEscape(id) + '"]');
      var memory = findMemory(id);
      if (box && memory) {
        var value = box.value.trim();
        if (!value) { toast('内容不能为空'); return; }
        memory.content = value;
        memory.updatedAt = Date.now();
        editingId = null;
        delete editDrafts[id];
        persist();
        renderAll();
        toast('已更新');
      }
      return;
    }
    if ((id = target.getAttribute('data-cancel'))) {
      editingId = null;
      delete editDrafts[id];
      renderList();
      return;
    }
    var tag = target.getAttribute('data-tag');
    if (tag) {
      filter.tag = (filter.tag && filter.tag.toLowerCase() === tag.toLowerCase()) ? '' : tag;
      refreshList();
    }
  }

  function findMemory(id) {
    for (var i = 0; i < state.memories.length; i++) {
      if (state.memories[i].id === id) return state.memories[i];
    }
    return null;
  }

  /** CSS.escape 在旧环境可能缺失，用最小实现兜底 */
  function cssEscape(value) {
    if (win.CSS && typeof win.CSS.escape === 'function') return win.CSS.escape(value);
    return String(value).replace(/["\\\]]/g, '\\$&');
  }

  /* ------------------------------- 启动 --------------------------------- */

  function init() {
    var loaded = loadLocalState();
    state.memories = loaded.memories.map(normalizeMemory);
    state.updatedAt = loaded.updatedAt;
    if (loaded.corrupt) {
      setTimeout(function () { toast('本地记忆读取失败，已从空库开始（建议检查备份）'); }, 400);
    }
    bindEvents();
    renderAll();

    fileSync.restore().then(function () { renderBadge(); });

    clearTimeout(wishTimer);
    wishTimer = setTimeout(function () {
      var seen = false;
      try {
        seen = !!win.sessionStorage.getItem('mvault.wished');
        if (!seen) win.sessionStorage.setItem('mvault.wished', '1');
      } catch (e) { seen = false; }
      if (!seen) openModal('wishMask');
    }, 900);
  }

  return {
    init: init,
    state: state,
    filter: filter,
    renderAll: renderAll,
    refreshList: refreshList,
    showSnapshot: showSnapshot,
    addMemory: addMemory,
    snapshotText: function () { return buildSnapshot(state.memories, { filter: filter }); },
    fileSync: fileSync,
    uid: uid
  };
}
