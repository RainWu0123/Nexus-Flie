/**
 * Nexus Files — Reactive Store
 * Lightweight pub/sub state management with immutable updates.
 */

const STORAGE_KEYS = {
  customQA: 'nexus_custom_qa',
  fileTags: 'nexus_file_tags',
  theme: 'nexus_theme',
  locale: 'nexus_locale',
  viewMode: 'nexus_view_mode',
  showHidden: 'nexus_show_hidden',
  sidebarWidth: 'nexus_sidebar_width',
  sortBy: 'nexus_sort_by',
  sortOrder: 'nexus_sort_order',
  recentFolders: 'nexus_recent_folders',
  session: 'nexus_session',
};

const MAX_RECENT_FOLDERS = 8;
const MAX_RESTORED_TABS = 20;

function loadSession() {
  const data = loadJson(STORAGE_KEYS.session, null);
  if (!data || !Array.isArray(data.tabs)) return null;
  const tabs = data.tabs
    .filter((t) => t && typeof t.path === 'string' && t.path)
    .slice(0, MAX_RESTORED_TABS)
    .map((t) => ({
      id: t.id,
      label: t.label || t.path,
      path: t.path,
      isPinned: !!t.isPinned,
      history: Array.isArray(t.history) ? t.history : [t.path],
      historyIndex:
        Number.isInteger(t.historyIndex) && t.historyIndex >= 0 && t.historyIndex < (t.history || [t.path]).length
          ? t.historyIndex
          : 0,
    }));
  if (!tabs.length) return null;
  return { tabs, activeTabId: tabs.some((t) => t.id === data.activeTabId) ? data.activeTabId : tabs[0].id };
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw != null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadString(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

const initialState = {
  // Navigation (per-tab history lives on each tab object)
  currentPath: '',

  // Files
  files: [],
  isLoading: false,
  error: null,

  // Filter (current-folder view filter; not persisted)
  filterQuery: '',

  // Tabs (restored from last session if available)
  tabs: [],
  activeTabId: null,

  // Selection
  selectedFiles: new Set(),

  // Clipboard for cut/copy-paste move (paths)
  clipboard: null, // { paths: string[], mode: 'cut' | 'copy' }

  // View
  viewMode: loadString(STORAGE_KEYS.viewMode, 'list'),
  sortBy: loadString(STORAGE_KEYS.sortBy, 'name'),
  sortOrder: loadString(STORAGE_KEYS.sortOrder, 'asc'),
  showHidden: loadJson(STORAGE_KEYS.showHidden, false),

  // Layout
  sidebarWidth: Number(loadString(STORAGE_KEYS.sidebarWidth, '240')) || 240,
  isDualPane: false,
  secondaryPath: null,
  secondaryFiles: [],
  activePane: 'primary', // 'primary' | 'secondary'

  // UI State
  commandPaletteOpen: false,
  theme: loadString(STORAGE_KEYS.theme, 'dark'),

  // Drives / features
  drives: [],
  knownFolders: {},
  customQuickAccess: loadJson(STORAGE_KEYS.customQA, []),
  fileTags: loadJson(STORAGE_KEYS.fileTags, {}),
  locale: loadString(STORAGE_KEYS.locale, ''),
  recentFolders: loadJson(STORAGE_KEYS.recentFolders, []),
};

class Store {
  constructor() {
    this._state = { ...initialState };
    this._listeners = new Map();
    this._batchDepth = 0;
    this._pendingKeys = new Set();
    this._sessionSaveTimer = null;
    // Session save races app close at most once; flush on pagehide.
    window.addEventListener('pagehide', () => this._flushSessionSave());
  }

  getState() {
    return this._state;
  }

  get(key) {
    return this._state[key];
  }

  /**
   * @param {object | ((s: object) => object)} updater
   */
  setState(updater) {
    const patch = typeof updater === 'function' ? updater(this._state) : updater;
    const changedKeys = [];

    for (const key of Object.keys(patch)) {
      if (!Object.is(this._state[key], patch[key])) {
        changedKeys.push(key);
      }
    }

    if (changedKeys.length === 0) return;

    this._state = { ...this._state, ...patch };

    // Persist preferences
    if ('customQuickAccess' in patch) {
      localStorage.setItem(STORAGE_KEYS.customQA, JSON.stringify(patch.customQuickAccess));
    }
    if ('fileTags' in patch) {
      localStorage.setItem(STORAGE_KEYS.fileTags, JSON.stringify(patch.fileTags));
    }
    if ('theme' in patch) {
      localStorage.setItem(STORAGE_KEYS.theme, patch.theme);
    }
    if ('locale' in patch && patch.locale) {
      localStorage.setItem(STORAGE_KEYS.locale, patch.locale);
    }
    if ('viewMode' in patch) {
      localStorage.setItem(STORAGE_KEYS.viewMode, patch.viewMode);
    }
    if ('showHidden' in patch) {
      localStorage.setItem(STORAGE_KEYS.showHidden, JSON.stringify(!!patch.showHidden));
    }
    if ('sidebarWidth' in patch) {
      localStorage.setItem(STORAGE_KEYS.sidebarWidth, String(patch.sidebarWidth));
    }
    if ('sortBy' in patch) {
      localStorage.setItem(STORAGE_KEYS.sortBy, patch.sortBy);
    }
    if ('sortOrder' in patch) {
      localStorage.setItem(STORAGE_KEYS.sortOrder, patch.sortOrder);
    }
    if ('recentFolders' in patch) {
      localStorage.setItem(STORAGE_KEYS.recentFolders, JSON.stringify(patch.recentFolders));
    }
    if ('tabs' in patch || 'activeTabId' in patch) {
      // Every navigation touches tabs; debouncing keeps stringify off the
      // keystroke path. Session restore: paths + per-tab history only.
      this._scheduleSessionSave();
    }

    if (this._batchDepth > 0) {
      changedKeys.forEach(k => this._pendingKeys.add(k));
      return;
    }

    this._notify(changedKeys);
  }

  /** Update tags for a specific file */
  updateFileTags(filePath, tags) {    const newTags = { ...this.get('fileTags') };
    if (!tags || tags.length === 0) {
      delete newTags[filePath];
    } else {
      newTags[filePath] = tags;
    }
    this.setState({ fileTags: newTags });
  }

  /** Toggle a single tag on a file */
  toggleFileTag(filePath, tagId) {
    const current = [...(this.get('fileTags')[filePath] || [])];
    const idx = current.indexOf(tagId);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(tagId);
    this.updateFileTags(filePath, current);
  }

  addCustomQuickAccess(label, path) {
    const qa = [...this.get('customQuickAccess')];
    if (!qa.find(item => item.path === path)) {
      qa.push({ id: `custom-${Date.now()}`, label, path });
      this.setState({ customQuickAccess: qa });
    }
  }

  removeCustomQuickAccess(id) {
    const qa = this.get('customQuickAccess').filter(item => item.id !== id);
    this.setState({ customQuickAccess: qa });
  }

  /** Record a visited folder for the sidebar "Recent" list (most recent first). */
  addRecentFolder(path) {
    if (!path || path.startsWith('nexus://')) return;
    const next = [path, ...this.get('recentFolders').filter((p) => p !== path)];
    this.setState({ recentFolders: next.slice(0, MAX_RECENT_FOLDERS) });
  }

  /** Restore last session tabs into state (called once at boot). */
  restoreSession() {
    const session = loadSession();
    if (!session) return false;
    this._state = { ...this._state, tabs: session.tabs, activeTabId: session.activeTabId };
    return true;
  }

  batch(fn) {
    this._batchDepth++;
    try {
      fn();
    } finally {
      this._batchDepth--;
      if (this._batchDepth === 0 && this._pendingKeys.size > 0) {
        const keys = [...this._pendingKeys];
        this._pendingKeys.clear();
        this._notify(keys);
      }
    }
  }

  /**
   * @param {string | string[]} keys
   * @param {Function} listener
   * @returns {Function} Unsubscribe
   */
  subscribe(keys, listener) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const key of keyList) {
      if (!this._listeners.has(key)) {
        this._listeners.set(key, new Set());
      }
      this._listeners.get(key).add(listener);
    }
    return () => {
      for (const key of keyList) {
        this._listeners.get(key)?.delete(listener);
      }
    };
  }

  _scheduleSessionSave() {
    if (this._sessionSaveTimer) return;
    this._sessionSaveTimer = setTimeout(() => {
      this._sessionSaveTimer = null;
      this._flushSessionSave();
    }, 300);
  }

  _flushSessionSave() {
    if (this._sessionSaveTimer) {
      clearTimeout(this._sessionSaveTimer);
      this._sessionSaveTimer = null;
    }
    try {
      const { tabs, activeTabId } = this._state;
      localStorage.setItem(STORAGE_KEYS.session, JSON.stringify({ tabs, activeTabId }));
    } catch { /* localStorage quota — best effort */ }
  }

  _notify(changedKeys) {
    const notified = new Set();
    for (const key of changedKeys) {
      const listeners = this._listeners.get(key);
      if (listeners) {
        for (const fn of listeners) {
          if (!notified.has(fn)) {
            notified.add(fn);
            fn(this._state[key], this._state);
          }
        }
      }
    }
    const wildcardListeners = this._listeners.get('*');
    if (wildcardListeners) {
      for (const fn of wildcardListeners) {
        if (!notified.has(fn)) {
          notified.add(fn);
          fn(this._state);
        }
      }
    }
  }
}

export const store = new Store();
export default store;
