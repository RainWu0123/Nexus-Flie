/**
 * Nexus Files — Navigation Engine
 * Encapsulates tab navigation, history back/forward stack, and directory loading.
 */
import store from '../../store/store.js';
import FileSystemGateway from '../fs/gateway.js';
import { parentPath, isArchiveFile } from '../../utils/path.js';

const MAX_TAB_HISTORY = 100;

export const NavigationEngine = {
  /**
   * Load directory or virtual tagged paths into store.
   */
  async loadDirectory(path) {
    if (!path) return [];
    store.setState({ isLoading: true, error: null });

    try {
      let files;
      if (path.startsWith('nexus://tag/')) {
        const tagId = path.split('nexus://tag/')[1];
        const fileTags = store.get('fileTags') || {};
        const taggedPaths = [];
        for (const [fPath, tags] of Object.entries(fileTags)) {
          if (tags.includes(tagId)) {
            taggedPaths.push(fPath);
          }
        }
        if (taggedPaths.length > 0) {
          files = await FileSystemGateway.statPaths(taggedPaths);
        } else {
          files = [];
        }
      } else if (path.startsWith('archive://') || path.startsWith('zip://')) {
        const protocol = path.startsWith('archive://') ? 'archive://' : 'zip://';
        const raw = path.slice(protocol.length);
        const qIdx = raw.indexOf('?entry=');
        let archivePath = raw;
        let internalPath = '';
        if (qIdx >= 0) {
          archivePath = raw.slice(0, qIdx);
          internalPath = decodeURIComponent(raw.slice(qIdx + '?entry='.length));
        }
        files = await FileSystemGateway.readArchiveDirectory(archivePath, internalPath);
      } else if (isArchiveFile(path)) {
        files = await FileSystemGateway.readArchiveDirectory(path, '');
      } else {
        files = await FileSystemGateway.readDirectory(path);
      }

      store.setState({ files, isLoading: false, currentPath: path });
      if (!path.startsWith('nexus://')) {
        store.addRecentFolder(path);
      }
      return files;
    } catch (err) {
      const message = typeof err === 'string' ? err : err.message || 'Unknown error';
      store.setState({ isLoading: false, error: message });
      console.error('[NavigationEngine.loadDirectory]', message);
      throw err;
    }
  },

  /** Refresh the currently active directory without modifying history */
  async refreshCurrent() {
    const { currentPath } = store.getState();
    if (currentPath) {
      await this.loadDirectory(currentPath);
    }
  },

  /** Navigate to a new directory, pushing into current tab history */
  async navigateTo(path) {
    if (!path) return;
    const { tabs, activeTabId } = store.getState();
    const idx = tabs.findIndex((t) => t.id === activeTabId);

    if (idx < 0) {
      await this.loadDirectory(path);
      return;
    }

    const tab = tabs[idx];
    const history = tab.history || [tab.path];
    const historyIndex = tab.historyIndex ?? history.length - 1;

    // Avoid duplicate consecutive entries
    if (history[historyIndex] === path) {
      await this.loadDirectory(path);
      return;
    }

    let newHistory = [...history.slice(0, historyIndex + 1), path];
    if (newHistory.length > MAX_TAB_HISTORY) {
      newHistory = newHistory.slice(newHistory.length - MAX_TAB_HISTORY);
    }

    store.setState({
      tabs: tabs.map((t, i) => i === idx ? { ...t, history: newHistory, historyIndex: newHistory.length - 1 } : t),
      selectedFiles: new Set(),
    });

    await this.loadDirectory(path);
  },

  async navigateBack() {
    const { tabs, activeTabId } = store.getState();
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    if (idx < 0) return;

    const tab = tabs[idx];
    const historyIndex = tab.historyIndex ?? 0;
    if (historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    store.setState({
      tabs: tabs.map((t, i) => i === idx ? { ...t, historyIndex: newIndex } : t),
      selectedFiles: new Set(),
    });
    await this.loadDirectory(tab.history[newIndex]);
  },

  async navigateForward() {
    const { tabs, activeTabId } = store.getState();
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    if (idx < 0) return;

    const tab = tabs[idx];
    const history = tab.history || [];
    const historyIndex = tab.historyIndex ?? history.length - 1;
    if (historyIndex >= history.length - 1) return;

    const newIndex = historyIndex + 1;
    store.setState({
      tabs: tabs.map((t, i) => i === idx ? { ...t, historyIndex: newIndex } : t),
      selectedFiles: new Set(),
    });
    await this.loadDirectory(history[newIndex]);
  },

  async navigateUp() {
    const { currentPath } = store.getState();
    if (!currentPath || currentPath.startsWith('nexus://')) return;

    if (currentPath.startsWith('archive://') || currentPath.startsWith('zip://')) {
      const protocol = currentPath.startsWith('archive://') ? 'archive://' : 'zip://';
      const raw = currentPath.slice(protocol.length);
      const qIdx = raw.indexOf('?entry=');
      if (qIdx < 0) {
        await this.navigateTo(parentPath(raw));
        return;
      }
      const archivePath = raw.slice(0, qIdx);
      const internalPath = raw.slice(qIdx + '?entry='.length).replace(/\/+$/, '');
      const lastSlash = internalPath.lastIndexOf('/');
      if (lastSlash < 0 || internalPath === '') {
        await this.navigateTo(parentPath(archivePath));
      } else {
        const parentInternal = internalPath.slice(0, lastSlash + 1);
        await this.navigateTo(`${protocol}${archivePath}?entry=${parentInternal}`);
      }
      return;
    }

    if (isArchiveFile(currentPath)) {
      await this.navigateTo(parentPath(currentPath));
      return;
    }

    const parent = parentPath(currentPath);
    if (parent && parent !== currentPath) {
      await this.navigateTo(parent);
    }
  },
};

export default NavigationEngine;
