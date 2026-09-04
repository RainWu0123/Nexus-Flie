/**
 * Nexus Files — Reactive Store
 * Lightweight pub/sub state management with immutable updates.
 */

const STORAGE_KEYS = {
  customQA: 'nexus_custom_qa',
  fileTags: 'nexus_file_tags',
  tags: 'nexus_custom_tags',
  theme: 'nexus_theme',
  locale: 'nexus_locale',
  viewMode: 'nexus_view_mode',
  showHidden: 'nexus_show_hidden',
  sidebarWidth: 'nexus_sidebar_width',
  sortBy: 'nexus_sort_by',
  sortOrder: 'nexus_sort_order',
  recentFolders: 'nexus_recent_folders',
  folderFrecency: 'nexus_folder_frecency',
  removedRecent: 'nexus_removed_recent',
  session: 'nexus_session',
};

const MAX_RECENT_FOLDERS = 6;
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

function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function pathsMatch(a, b) {
  if (!a || !b) return false;
  const na = normalizePath(String(a));
  const nb = normalizePath(String(b));
  if (na === nb) return true;
  const baseA = na.split('/').pop();
  const baseB = nb.split('/').pop();
  if (baseA && baseB && (na === baseB || nb === baseA || baseA === baseB)) return true;
  return false;
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
  tags: loadJson(STORAGE_KEYS.tags, null),
  locale: loadString(STORAGE_KEYS.locale, ''),
  folderFrecency: loadJson(STORAGE_KEYS.folderFrecency, []),
  removedRecent: loadJson(STORAGE_KEYS.removedRecent, []),
  recentFolders: (() => {
    const raw = loadJson(STORAGE_KEYS.recentFolders, []);
    const removed = loadJson(STORAGE_KEYS.removedRecent, []);
    return raw.filter(p => {
      if (!p || typeof p !== 'string') return false;
      if (!p.includes('/') && !p.includes('\\') && !p.includes(':')) return false;
      if (p.startsWith('nexus://') || p.startsWith('archive://')) return false;
      if (removed.some(r => pathsMatch(p, r))) return false;
      return true;
    });
  })(),
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
    if ('tags' in patch) {
      localStorage.setItem(STORAGE_KEYS.tags, JSON.stringify(patch.tags));
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
    if ('folderFrecency' in patch) {
      localStorage.setItem(STORAGE_KEYS.folderFrecency, JSON.stringify(patch.folderFrecency));
    }
    if ('removedRecent' in patch) {
      localStorage.setItem(STORAGE_KEYS.removedRecent, JSON.stringify(patch.removedRecent));
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

  getTags(defaultTags = []) {
    return this._state.tags || defaultTags;
  }

  addTag({ name, color }, defaultTags = []) {
    const id = `tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const current = this.getTags(defaultTags);
    const newTag = { id, name, color };
    const next = [...current, newTag];
    this.setState({ tags: next });
    return newTag;
  }

  updateTag(tagId, { name, color }, defaultTags = []) {
    const current = this.getTags(defaultTags);
    const next = current.map(t => {
      if (t.id === tagId) {
        return { ...t, ...(name ? { name, labelKey: undefined } : {}), ...(color ? { color } : {}) };
      }
      return t;
    });
    this.setState({ tags: next });
  }

  deleteTag(tagId, defaultTags = []) {
    const current = this.getTags(defaultTags);
    const next = current.filter(t => t.id !== tagId);

    const fileTags = { ...this.get('fileTags') };
    let changed = false;
    for (const [filePath, tags] of Object.entries(fileTags)) {
      if (Array.isArray(tags) && tags.includes(tagId)) {
        fileTags[filePath] = tags.filter(tid => tid !== tagId);
        if (fileTags[filePath].length === 0) {
          delete fileTags[filePath];
        }
        changed = true;
      }
    }
    this.setState({ tags: next, ...(changed ? { fileTags } : {}) });
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

  calculateFrecencyScore(entry) {
    const hoursAgo = (Date.now() - (entry.lastVisited || 0)) / (1000 * 60 * 60);
    let recencyWeight = 20;
    if (hoursAgo < 4) recencyWeight = 100;
    else if (hoursAgo < 24) recencyWeight = 80;
    else if (hoursAgo < 72) recencyWeight = 60;
    else if (hoursAgo < 168) recencyWeight = 40;

    const dwellBonus = Math.min(40, Math.floor((entry.dwellTotal || 0) / 10));
    return ((entry.count || 1) * recencyWeight) + dwellBonus;
  }

  isExcludedFromRecent(path) {
    if (!path || typeof path !== 'string') return true;
    if (path.startsWith('nexus://') || path.startsWith('archive://')) return true;

    const norm = normalizePath(path);
    if (!norm) return true;

    // Must be an actual path with separators or drive (exclude raw keys like "桌面", "Music")
    if (!path.includes('/') && !path.includes('\\') && !path.includes(':')) {
      return true;
    }

    // Exclude drive roots like "c:", "d:", or "/"
    if (/^[a-z]:$/i.test(norm) || norm === '/' || norm === '') return true;

    // Exclude user profile folder (e.g. C:/Users/rainw)
    const home = this.get('homeDir') || '';
    if (home && pathsMatch(path, home)) return true;

    // Exclude standard Quick Access folders (Desktop, Downloads, Documents, Pictures, Music, Videos)
    const known = this.get('knownFolders') || {};
    for (const p of Object.values(known)) {
      if (p && pathsMatch(path, p)) return true;
    }
    // Also check standard subdirectories under homeDir as backup
    if (home) {
      const standardNames = ['desktop', 'downloads', 'documents', 'pictures', 'music', 'videos', '桌面', '下載', '文件', '圖片', '音樂', '影片'];
      const base = norm.split('/').pop();
      if (standardNames.includes(base)) return true;
    }

    // Exclude custom pinned Quick Access folders
    const customQA = this.get('customQuickAccess') || [];
    for (const item of customQA) {
      if (item.path && pathsMatch(path, item.path)) return true;
    }

    // Exclude folders user explicitly removed
    const removed = this.get('removedRecent') || [];
    if (removed.some(p => pathsMatch(path, p))) return true;

    return false;
  }

  purgeInvalidRecentFolders() {
    const raw = this.get('recentFolders') || [];
    const valid = raw.filter(p => !this.isExcludedFromRecent(p));
    this.setState({ recentFolders: valid });
  }

  _computeRecentFolders(frecencyList = null) {
    const list = frecencyList || this.get('folderFrecency') || [];
    const now = Date.now();

    const qualified = list.filter(entry => {
      if (this.isExcludedFromRecent(entry.path)) return false;
      const hoursAgo = (now - (entry.lastVisited || 0)) / (1000 * 60 * 60);
      // Windows-like qualification: visited at least 2 times, OR worked in folder for >= 15s today
      return (entry.count >= 2) || (hoursAgo < 24 && (entry.dwellTotal || 0) >= 15);
    });

    qualified.sort((a, b) => this.calculateFrecencyScore(b) - this.calculateFrecencyScore(a));
    return qualified.slice(0, MAX_RECENT_FOLDERS).map(e => e.path);
  }

  /** Record a meaningful folder visit (dwell time >= 4s or user performed action). */
  recordFolderVisit(path, dwellSeconds = 4) {
    if (!path || this.isExcludedFromRecent(path)) return;

    const cleanPath = path.replace(/[/\\]+$/, '');
    const frecency = [...(this.get('folderFrecency') || [])];
    const idx = frecency.findIndex(item => item.path.toLowerCase() === cleanPath.toLowerCase());

    if (idx >= 0) {
      frecency[idx] = {
        ...frecency[idx],
        count: (frecency[idx].count || 1) + 1,
        lastVisited: Date.now(),
        dwellTotal: (frecency[idx].dwellTotal || 0) + dwellSeconds,
      };
    } else {
      frecency.push({
        path: cleanPath,
        count: 1,
        lastVisited: Date.now(),
        dwellTotal: dwellSeconds,
      });
    }

    if (frecency.length > 50) {
      frecency.sort((a, b) => this.calculateFrecencyScore(b) - this.calculateFrecencyScore(a));
      frecency.length = 50;
    }

    const nextRecent = this._computeRecentFolders(frecency);
    this.setState({
      folderFrecency: frecency,
      recentFolders: nextRecent,
    });
  }

  /** Backwards compatible alias */
  addRecentFolder(path) {
    this.recordFolderVisit(path, 4);
  }

  removeRecentFolder(path) {
    if (!path) return;
    const frecency = (this.get('folderFrecency') || []).filter(
      item => !pathsMatch(item.path, path)
    );
    const removed = [...(this.get('removedRecent') || [])];
    if (!removed.some(p => pathsMatch(p, path))) {
      removed.push(path);
      const base = String(path).replace(/\\/g, '/').split('/').pop();
      if (base && !removed.includes(base)) removed.push(base);
    }
    const nextRecent = (this.get('recentFolders') || []).filter(
      p => !pathsMatch(p, path)
    );
    this.setState({
      folderFrecency: frecency,
      removedRecent: removed,
      recentFolders: nextRecent,
    });
  }

  clearRecentFolders() {
    this.setState({
      folderFrecency: [],
      recentFolders: [],
    });
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
