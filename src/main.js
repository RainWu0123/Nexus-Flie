/**
 * Nexus Files — Application Entry Point
 * Lean boot: shell → i18n/theme → components → home list.
 */
import store from './store/store.js';
import { getHomeDir, getKnownFolders, getLaunchArgs, navigateBack, navigateForward, navigateUp, refreshCurrent, deletePath, createFolder, trimMemory } from './utils/tauri-bridge.js';
import { initSidebar, updateSidebarHomePath } from './components/sidebar.js';
import { initTabs, createTab, switchTab, syncActiveTab, closeTab, reopenClosedTab } from './components/tabs.js';
import { initFileList, startRenameSelected, openFilterBar, openPropertiesForSelection } from './components/file-list.js';
import { initToolbar, deleteSelectedItems } from './components/toolbar.js';
import { initCommandPalette } from './components/command-palette.js';
import { initPreviewPanel } from './components/preview-panel.js';
import { initDualPane } from './components/dual-pane.js';
import { initDnd } from './utils/dnd.js';
import { initWatcher } from './utils/watcher.js';
import { cutSelection, copySelection, pasteClipboard } from './utils/clipboard-actions.js';
import { toast } from './utils/toast.js';
import { showPromptDialog } from './utils/modal.js';
import { undoManager } from './utils/undo-manager.js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

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
  const name = await showPromptDialog({
    title: t('context.newFolder') || '新增資料夾',
    message: t('context.newFolderPrompt') || '請輸入資料夾名稱：',
    defaultValue: t('context.newFolderDefault') || '新增資料夾',
  });
  if (!name) return;
  try {
    const createdPath = await createFolder(currentPath, name);
    undoManager.recordCreate(createdPath || `${currentPath}\\${name}`, name);
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
    if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      undoManager.undo();
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      deleteSelectedItems();
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

    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      openPropertiesForSelection();
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

  // Listen for external folder open requests via Single Instance
  listen('single-instance-launch', (event) => {
    const target = event.payload;
    if (target?.folderPath) {
      createTab(target.folderPath);
      if (target.selectFile) {
        setTimeout(() => {
          store.setState({ selectedFiles: new Set([target.selectFile]) });
        }, 150);
      }
    }
  }).catch(() => {});

  // 1. Fast path: Restore session immediately so directory reading starts at tick 0
  let sessionRestored = false;
  try {
    if (store.restoreSession()) {
      sessionRestored = true;
      const { tabs, activeTabId } = store.getState();
      const active = tabs.find(tb => tb.id === activeTabId) || tabs[0];
      if (active) switchTab(active.id);
    }
  } catch (err) {
    console.warn('Session restore error:', err);
  }

  // Reveal window on first frame once DOM is rendered — eliminates white flash
  requestAnimationFrame(() => {
    const win = getCurrentWindow();
    win.show().then(() => {
      win.setFocus().catch(() => {});
    }).catch(() => {});
  });

  // 2. Fetch system paths and CLI arguments in parallel (non-blocking)
  (async () => {
    try {
      const [homeDir, folders, launchArgs] = await Promise.all([
        getHomeDir().catch(() => 'C:\\'),
        getKnownFolders().catch(() => ({})),
        getLaunchArgs().catch(() => null),
      ]);

      updateSidebarHomePath(homeDir, folders);

      if (launchArgs?.folderPath) {
        createTab(launchArgs.folderPath);
        if (launchArgs.selectFile) {
          setTimeout(() => {
            store.setState({ selectedFiles: new Set([launchArgs.selectFile]) });
          }, 100);
        }
      } else if (!sessionRestored) {
        createTab(homeDir || 'C:\\');
      }
    } catch (err) {
      console.warn('System paths init error:', err);
      if (!sessionRestored) createTab('C:\\');
    }
  })();
}

window.addEventListener('error', (e) => {
  import('@tauri-apps/api/core').then((m) => {
    m.invoke('log_error', { msg: `[window.error] ${e.message}` }).catch(() => {});
  });
});

// Auto-trim working set memory when window is unfocused or hidden
let trimTimer = null;
function scheduleMemoryTrim(delay = 1500) {
  if (trimTimer) clearTimeout(trimTimer);
  trimTimer = setTimeout(() => {
    trimMemory();
  }, delay);
}

window.addEventListener('blur', () => scheduleMemoryTrim(1000));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) scheduleMemoryTrim(500);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

