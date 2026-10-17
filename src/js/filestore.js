/**
 * filestore.js — 持久化层
 * 1) localStorage：永远可用的兜底存储
 * 2) IndexedDB：记住用户授权过的文件句柄
 * 3) File System Access API：把记忆实时落盘成 JSON 文件（Chrome / Edge）
 */
import { idbAvailable } from './util.js';

export const LS_KEY = 'mvault.v1';
export const IDB_NAME = 'mvault';
export const IDB_STORE = 'kv';
export const IDB_HANDLE_KEY = 'handle';
export const SYNC_DEBOUNCE_MS = 400;

/* ----------------------------- localStorage ----------------------------- */

export function loadLocalState(storage) {
  var ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  var empty = { memories: [], updatedAt: 0, corrupt: false };
  if (!ls) return empty;
  var raw;
  try {
    raw = ls.getItem(LS_KEY);
  } catch (e) {
    return empty;
  }
  if (!raw) return empty;
  try {
    var data = JSON.parse(raw);
    var list = Array.isArray(data) ? data : (data && data.memories);
    if (!Array.isArray(list)) throw new Error('invalid-shape');
    return {
      memories: list,
      updatedAt: Number(data && data.updatedAt) || 0,
      corrupt: false
    };
  } catch (e) {
    return { memories: [], updatedAt: 0, corrupt: true };
  }
}

/** @returns {boolean} 是否写入成功（配额满会 false） */
export function saveLocalState(payload, storage) {
  var ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return false;
  try {
    ls.setItem(LS_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    return false;
  }
}

/* -------------------------------- IndexedDB ------------------------------ */

function openDb() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') { reject(new Error('no-indexeddb')); return; }
    var req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('idb-open-failed')); };
  });
}

export function idbSet(key, value) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error || new Error('idb-write-failed')); };
    });
  });
}

export function idbGet(key) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, 'readonly');
      var req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb-read-failed')); };
    });
  });
}

/* --------------------------- 文件句柄同步管理 ---------------------------- */

/**
 * @param {{
 *   payload: () => object,          // 生成要写入文件的 JSON
 *   picker?: Function,              // 覆盖 showSaveFilePicker（测试用）
 *   onStatus?: (status: object) => void
 * }} options
 */
export function createFileSync(options) {
  var opts = options || {};
  var picker = opts.picker !== undefined
    ? opts.picker
    : (typeof window !== 'undefined' ? window.showSaveFilePicker : null);
  var onChange = opts.onStatus || function () {};
  var handle = null;
  var timer = null;
  var status = {
    supported: typeof picker === 'function',
    bound: false,
    name: '',
    permission: 'unknown',   // unknown | granted | denied | prompt
    lastSyncAt: 0,
    lastError: ''
  };

  function emit(patch) {
    if (patch) {
      for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) status[k] = patch[k]; }
    }
    onChange(status);
    return status;
  }

  function getState() {
    var copy = {};
    for (var k in status) { if (Object.prototype.hasOwnProperty.call(status, k)) copy[k] = status[k]; }
    return copy;
  }

  function queryPermission() {
    if (!handle) return Promise.resolve('unknown');
    if (typeof handle.queryPermission !== 'function') return Promise.resolve('granted');
    return Promise.resolve(handle.queryPermission({ mode: 'readwrite' })).catch(function () {
      return 'unknown';
    });
  }

  function requestPermission() {
    if (!handle) return Promise.resolve('unknown');
    if (typeof handle.requestPermission !== 'function') return Promise.resolve('granted');
    return Promise.resolve(handle.requestPermission({ mode: 'readwrite' })).catch(function () {
      return 'denied';
    });
  }

  function writeNow() {
    if (!handle) return Promise.resolve(false);
    return queryPermission().then(function (perm) {
      emit({ permission: perm });
      if (perm !== 'granted') return false;
      return Promise.resolve(handle.createWritable()).then(function (writable) {
        return Promise.resolve(writable.write(JSON.stringify(opts.payload ? opts.payload() : {}, null, 2)))
          .then(function () { return writable.close(); });
      }).then(function () {
        emit({ lastSyncAt: Date.now(), lastError: '' });
        return true;
      });
    }).catch(function (err) {
      emit({ lastError: (err && err.message) || 'write-failed' });
      return false;
    });
  }

  /** 去抖写入：连续编辑只落盘一次 */
  function schedule() {
    if (!handle) return;
    clearTimeout(timer);
    timer = setTimeout(function () { writeNow(); }, SYNC_DEBOUNCE_MS);
  }

  /** 立即写入（页面隐藏 / 关闭前调用） */
  function flush() {
    clearTimeout(timer);
    return writeNow();
  }

  function bind() {
    if (typeof picker !== 'function') {
      return Promise.reject(new Error('unsupported'));
    }
    return Promise.resolve(picker({
      suggestedName: 'ai-memory-vault.json',
      types: [{ description: '记忆库 JSON', accept: { 'application/json': ['.json'] } }]
    })).then(function (picked) {
      handle = picked;
      emit({ bound: true, name: (picked && picked.name) || 'memory.json', lastError: '' });
      return idbSet(IDB_HANDLE_KEY, picked).catch(function () { return null; });
    }).then(function () {
      return writeNow();
    });
  }

  /** 页面重新打开时恢复上次绑定的文件 */
  function restore() {
    if (typeof picker !== 'function' || !idbAvailable()) {
      return Promise.resolve(getState());
    }
    return idbGet(IDB_HANDLE_KEY).then(function (saved) {
      if (!saved) return getState();
      handle = saved;
      emit({ bound: true, name: saved.name || 'memory.json' });
      return queryPermission().then(function (perm) {
        emit({ permission: perm });
        if (perm === 'granted') return writeNow();
        return getState();
      });
    }).catch(function () {
      return getState();
    });
  }

  function rebindPermission() {
    return requestPermission().then(function (perm) {
      emit({ permission: perm });
      if (perm !== 'granted') return false;
      return writeNow();
    });
  }

  return {
    getState: getState,
    isSupported: function () { return typeof picker === 'function'; },
    hasHandle: function () { return !!handle; },
    bind: bind,
    restore: restore,
    requestPermission: rebindPermission,
    schedule: schedule,
    flush: flush,
    writeNow: writeNow
  };
}
