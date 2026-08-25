/**
 * Nexus Files — Application Entry Point
 * Lean boot: shell → i18n/theme → components → home list.
 */
import store from './store/store.js';
import { getHomeDir, getKnownFolders, navigateBack, navigateForward, navigateUp, refreshCurrent, deletePath, createFolder } from './utils/tauri-bridge.js';
import { initSidebar, updateSidebarHomePath } from './components/sidebar.js';
import { initTabs, createTab, switchTab, syncActiveTab, closeTab, reopenClosedTab } from './components/tabs.js';
import { initFileList, startRenameSelected, openFilterBar } from './components/file-list.js';
import { initToolbar } from './components/toolbar.js';
import { initCommandPalette } from './components/command-palette.js';
import { initPreviewPanel } from './components/preview-panel.js';
import { initDualPane } from './components/dual-pane.js';
import { initDnd } from './utils/dnd.js';
import { initWatcher } from './utils/watcher.js';
import { cutSelection, copySelection, pasteClipboard } from './utils/clipboard-actions.js';
import { toast } from './utils/toast.js';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { registerLocale, setLocale, detectSystemLocale, t } from './i18n/index.js';
import en from './i18n/locales/en.js';
import zhTW from './i18n/locales/zh-TW.js';
import zhCN from './i18n/locales/zh-CN.js';
import ja from './i18n/locales/ja.js';

function initI18n() {
  registerLocale('en', en);
  registerLocale('zh-TW', zhTW);
  registerLocale('zh-CN', zhCN);
  registerLocale('ja', ja);
  const saved = store.get('locale');
  const locale = saved || detectSystemLocale();
  setLocale(locale);
  if (!saved) store.setState({ locale });
}

function initTheme() {
  let theme = store.get('theme');
  if (!theme || theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  store.setState({ theme });
  document.documentElement.setAttribute('data-theme', theme);
}

function initPathSync() {
  store.subscribe('currentPath', (path) => {
    if (path) syncActiveTab(path);
  });
}

/** Shared "New Folder" flow for Ctrl+Shift+N (same behavior as the context menu). */
async function promptNewFolder() {
  const { currentPath } = store.getState();
  if (!currentPath || currentPath.startsWith('nexus://')) return;
  const name = prompt(t('context.newFolderPrompt'), t('context.newFolderDefault'));
  if (!name) return;
  try {
    await createFolder(currentPath, name);
    await refreshCurrent();
  } catch (err) {
    toast(t('context.createFailed') + ': ' + err, 'error');
  }
}

function isTypingTarget(el) {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable;
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (store.get('commandPaletteOpen') && e.key !== 'Escape') return;

    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.shiftKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault();
      reopenClosedTab();
      return;
    }
    if (mod && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
      e.preventDefault();
      promptNewFolder();
      return;
    }
    if (mod && e.key === 't') {
      e.preventDefault();
      createTab();
      return;
    }
    if (mod && e.key === 'w') {
      e.preventDefault();
      const { tabs, activeTabId } = store.getState();
      if (tabs.length > 1) closeTab(activeTabId);
      return;
    }
    if (mod && e.key === 'f') {
      e.preventDefault();
      openFilterBar();
      return;
    }
    // Ctrl+1..9 — jump to tab
    if (mod && e.key >= '1' && e.key <= '9') {
      const { tabs } = store.getState();
      const idx = Number(e.key) - 1;
      if (tabs[idx]) {
        e.preventDefault();
        switchTab(tabs[idx].id);
      }
      return;
    }
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateBack();
      return;
    }
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      navigateForward();
      return;
    }
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      navigateUp();
      return;
    }
    if (mod && e.key === 'h') {
      e.preventDefault();
      store.setState((s) => ({ showHidden: !s.showHidden }));
      return;
    }

    // Clipboard (also in file-list; keep both for reliability)
    if (mod && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      copySelection();
      return;
    }
    if (mod && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      cutSelection();
      return;
    }
    if (mod && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      pasteClipboard();
      return;
    }

    if (e.key === 'Delete') {
      const { selectedFiles } = store.getState();
      if (!selectedFiles.size) return;
      e.preventDefault();
      const paths = [...selectedFiles];
      const name = paths.length === 1
        ? (paths[0].split(/[/\\]/).pop() || paths[0])
        : `${paths.length}`;
      if (!confirm(t('context.deleteConfirm', { name }))) return;
      (async () => {
        try {
          for (const p of paths) await deletePath(p);
          store.setState({ selectedFiles: new Set() });
          await refreshCurrent();
          toast(t('context.delete'), 'success');
        } catch (err) {
          toast(t('context.deleteFailed') + ': ' + err, 'error');
        }
      })();
      return;
    }

    if (e.key === 'F2') {
      e.preventDefault();
      startRenameSelected();
      return;
    }

    if (e.key === 'F5') {
      e.preventDefault();
      refreshCurrent();
      return;
    }
  });
}

async function init() {
  console.log('%c✦ Nexus Files', 'color: #818cf8; font-size: 18px; font-weight: bold;');
  console.log('%c  Lean · Fast · Useful', 'color: #8888a0; font-size: 12px;');

  initI18n();
  initTheme();

  initSidebar();
  initTabs();
  initToolbar();
  initFileList();
  initCommandPalette();
  initPreviewPanel();
  initDualPane();
  initDnd();
  initPathSync();
  initKeyboardShortcuts();
  initWatcher();

  try {
    const [homeDir, folders] = await Promise.all([getHomeDir(), getKnownFolders()]);
    updateSidebarHomePath(homeDir, folders);

    // Session restore: bring back last session's tabs (paths + histories).
    if (store.restoreSession()) {
      const { tabs, activeTabId } = store.getState();
      const active = tabs.find(tb => tb.id === activeTabId) || tabs[0];
      switchTab(active.id);
    } else {
      createTab(homeDir);
    }
  } catch (err) {
    console.warn('Home fallback', err);
    createTab('C:\\');
  }

  setTimeout(async () => {
    try {
      await getCurrentWindow().show();
    } catch (e) {
      console.warn('show window', e);
    }
  }, 50);
}

window.addEventListener('error', (e) => {
  import('@tauri-apps/api/core').then((m) => {
    m.invoke('log_error', { msg: `[window.error] ${e.message}` }).catch(() => {});
  });
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

