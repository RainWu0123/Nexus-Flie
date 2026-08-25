import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import store from '../store/store.js';
import { navigateTo, readDirectory } from '../utils/tauri-bridge.js';
import { uid, icon, ICONS } from '../utils/helpers.js';
import { t, onLocaleChange } from '../i18n/index.js';

const MAX_CLOSED_STACK = 10;
/** Recently closed tabs, for Ctrl+Shift+T (session-only). */
const closedStack = [];

export function initTabs() {
  store.subscribe(['tabs', 'activeTabId'], () => renderTabs());
  onLocaleChange(() => renderTabs());
  renderTabs();
  initWindowControls();
}

function renderTabs() {
  const tabBar = document.getElementById('tab-bar');
  if (!tabBar) return;
  const { tabs, activeTabId } = store.getState();

  tabBar.innerHTML = '';

  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = `tab${tab.id === activeTabId ? ' active' : ''}${tab.isPinned ? ' pinned' : ''}`;
    el.dataset.tabId = tab.id;
    el.draggable = true;
    el.appendChild(icon(ICONS.folder, 'icon-sm tab-icon'));

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tab.label || t('tabs.newTab');
    el.appendChild(label);

    if (!tab.isPinned) {
      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '×';
      close.title = t('tabs.unpinTab');
      close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
      el.appendChild(close);
    }

    el.addEventListener('click', () => switchTab(tab.id));
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(tab.id);
      }
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      togglePin(tab.id);
    });

    // Drag reorder
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/tab-id', tab.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData('text/tab-id');
      if (!fromId || fromId === tab.id) return;
      reorderTabs(fromId, tab.id);
    });

    tabBar.appendChild(el);
  });

  const newBtn = document.createElement('button');
  newBtn.className = 'tab-new';
  newBtn.title = t('tabs.newTab');
  newBtn.appendChild(icon(ICONS.plus, 'icon-sm'));
  newBtn.addEventListener('click', () => createTab());
  tabBar.appendChild(newBtn);
}

function reorderTabs(fromId, toId) {
  const { tabs, activeTabId } = store.getState();
  const fromIdx = tabs.findIndex(t => t.id === fromId);
  const toIdx = tabs.findIndex(t => t.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  const next = [...tabs];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  store.setState({ tabs: next, activeTabId });
}

export function createTab(path) {
  const { tabs, currentPath } = store.getState();
  const targetPath = path || currentPath || 'C:\\';
  const label = pathLabel(targetPath);
  const newTab = {
    id: uid(), label, path: targetPath, isPinned: false,
    history: [targetPath], historyIndex: 0,
  };
  store.setState({ tabs: [...tabs, newTab], activeTabId: newTab.id });
  readDirectory(targetPath);
}

export function switchTab(tabId) {
  const { tabs } = store.getState();
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  // Restore directly — switching tabs must not pollute the tab's history.
  store.setState({ activeTabId: tabId, selectedFiles: new Set() });
  readDirectory(tab.path);
}

export function closeTab(tabId) {
  const { tabs, activeTabId } = store.getState();
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.isPinned) return;
  if (tabs.length <= 1) return;
  const index = tabs.findIndex(t => t.id === tabId);
  const newTabs = tabs.filter(t => t.id !== tabId);
  let newActiveId = activeTabId;
  if (tabId === activeTabId) {
    const newIndex = Math.min(index, newTabs.length - 1);
    newActiveId = newTabs[newIndex].id;
    readDirectory(newTabs[newIndex].path);
  }
  store.setState({ tabs: newTabs, activeTabId: newActiveId });
  closedStack.push({ path: tab.path, label: tab.label });
  if (closedStack.length > MAX_CLOSED_STACK) closedStack.shift();
}

/** Reopen the most recently closed tab (Ctrl+Shift+T). */
export function reopenClosedTab() {
  const last = closedStack.pop();
  if (last) createTab(last.path);
  return !!last;
}

function togglePin(tabId) {
  const { tabs } = store.getState();
  store.setState({
    tabs: tabs.map(t => t.id === tabId ? { ...t, isPinned: !t.isPinned } : t),
  });
}

export function syncActiveTab(path) {
  const { tabs, activeTabId } = store.getState();
  if (!activeTabId) return;
  const label = pathLabel(path);
  store.setState({
    tabs: tabs.map(t => t.id === activeTabId ? { ...t, path, label } : t),
  });
}

function pathLabel(path) {
  if (!path) return t('tabs.newTab');
  if (path.startsWith('nexus://tag/')) {
    const id = path.replace('nexus://tag/', '');
    return t(id) || id;
  }
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[segments.length - 1] || path;
}

function initWindowControls() {
  const btnMin = document.getElementById('win-min');
  const btnMax = document.getElementById('win-max');
  const btnClose = document.getElementById('win-close');
  const iconMax = btnMax?.querySelector('.win-icon-max');
  const iconRestore = btnMax?.querySelector('.win-icon-restore');

  let appWindow = null;
  try {
    appWindow = getCurrentWindow();
  } catch {
    // browser mode fallback
  }

  const updateMaximizeState = async () => {
    let isMax = false;
    try {
      if (appWindow && typeof appWindow.isMaximized === 'function') {
        isMax = await appWindow.isMaximized();
      } else {
        isMax = await invoke('app_is_maximized');
      }
    } catch {
      try {
        isMax = await invoke('app_is_maximized');
      } catch {
        isMax = false;
      }
    }

    if (iconMax && iconRestore) {
      iconMax.style.display = isMax ? 'none' : 'block';
      iconRestore.style.display = isMax ? 'block' : 'none';
    }
    if (btnMax) {
      btnMax.title = isMax ? '向下還原' : '最大化';
    }
    document.body.classList.toggle('is-window-maximized', isMax);
  };

  btnMin?.addEventListener('click', async () => {
    try {
      if (appWindow && typeof appWindow.minimize === 'function') await appWindow.minimize();
      else await invoke('app_minimize');
    } catch {
      await invoke('app_minimize');
    }
  });

  btnMax?.addEventListener('click', async () => {
    try {
      if (appWindow && typeof appWindow.toggleMaximize === 'function') await appWindow.toggleMaximize();
      else await invoke('app_toggle_maximize');
    } catch {
      await invoke('app_toggle_maximize');
    }
    setTimeout(updateMaximizeState, 60);
  });

  btnClose?.addEventListener('click', async () => {
    try {
      if (appWindow && typeof appWindow.close === 'function') await appWindow.close();
      else await invoke('app_close');
    } catch {
      await invoke('app_close');
    }
  });

  // Double click drag spacer to maximize/restore
  const titlebar = document.getElementById('titlebar');
  titlebar?.addEventListener('dblclick', async (e) => {
    if (e.target.closest('.tab, .tab-new, .window-control-btn, .tab-close')) return;
    try {
      if (appWindow && typeof appWindow.toggleMaximize === 'function') await appWindow.toggleMaximize();
      else await invoke('app_toggle_maximize');
    } catch {
      await invoke('app_toggle_maximize');
    }
    setTimeout(updateMaximizeState, 60);
  });

  window.addEventListener('resize', () => {
    updateMaximizeState();
  });
  updateMaximizeState();
}
