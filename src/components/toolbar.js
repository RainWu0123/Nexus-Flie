/**
 * Nexus Files — Windows 11 Native Toolbar & Ribbon Component
 * Restores the authentic two-row Windows 11 File Explorer toolbar and interaction model.
 */
import store from '../store/store.js';
import {
  navigateBack, navigateForward, navigateUp, navigateTo, refreshCurrent,
  createFolder, createFile, openTerminal, openTerminalAsAdmin, deletePath, executeAddressCommand,
  setAsDefaultFileManager, restoreDefaultFileManager
} from '../utils/tauri-bridge.js';
import { icon, ICONS, getTagInfo } from '../utils/helpers.js';
import { t, onLocaleChange } from '../i18n/index.js';
import { togglePreviewPanel } from './preview-panel.js';
import { startRenameSelected, getFilteredFiles } from './file-list.js';
import { cutSelection, copySelection, pasteClipboard } from '../utils/clipboard-actions.js';
import { toast } from '../utils/toast.js';
import { showPromptDialog } from '../utils/modal.js';
import { undoManager } from '../utils/undo-manager.js';

let isEditing = false;
let activeDropdown = null;

export function initToolbar() {
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;

  renderToolbar(toolbar);

  store.subscribe('currentPath', () => {
    closeDropdown();
    if (!isEditing) renderBreadcrumb();
    updateSearchPlaceholder();
  });
  store.subscribe(['tabs', 'activeTabId'], () => updateNavButtons());
  store.subscribe('selectedFiles', () => updateActionButtons());
  store.subscribe('clipboard', () => updateActionButtons());
  store.subscribe('filterQuery', () => updateSearchInput());

  onLocaleChange(() => renderToolbar(toolbar));

  document.addEventListener('click', (e) => {
    if (activeDropdown && !activeDropdown.contains(e.target) && !e.target.closest('.ribbon-menu-trigger')) {
      closeDropdown();
    }
  });

  window.addEventListener('blur', closeDropdown);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeDropdown) {
      closeDropdown();
    }
  });
}

function closeDropdown() {
  if (activeDropdown) {
    activeDropdown.remove();
    activeDropdown = null;
  }
}

function renderToolbar(toolbar) {
  closeDropdown();
  toolbar.innerHTML = '';

  // ── ROW 1: Navigation + Address Bar + Search ─────────────────────────────
  const navRow = document.createElement('div');
  navRow.className = 'toolbar-nav-row';

  // Navigation buttons: Back, Forward, Up, Refresh
  const navGroup = document.createElement('div');
  navGroup.className = 'nav-button-group';

  const backBtn = createNavBtn('btn-back', ICONS.chevronLeft, t('toolbar.back'), navigateBack);
  const fwdBtn = createNavBtn('btn-forward', ICONS.chevronRight, t('toolbar.forward'), navigateForward);
  const upBtn = createNavBtn('btn-up', ICONS.arrowUp, t('toolbar.up'), navigateUp);
  const refreshBtn = createNavBtn('btn-refresh', ICONS.refresh, t('toolbar.refresh'), refreshCurrent);

  navGroup.append(backBtn, fwdBtn, upBtn, refreshBtn);
  navRow.appendChild(navGroup);

  // Address bar (Breadcrumbs + direct input)
  const addressBar = document.createElement('div');
  addressBar.className = 'address-bar';
  addressBar.id = 'address-bar';

  const folderIcon = icon(ICONS.folder, 'address-folder-icon');
  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'breadcrumb';
  breadcrumb.id = 'breadcrumb';

  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.className = 'address-input hidden';
  pathInput.id = 'address-input';
  pathInput.spellcheck = false;
  pathInput.autocomplete = 'off';

  const dropArrow = icon(ICONS.chevronDown, 'address-dropdown-arrow');

  addressBar.append(folderIcon, breadcrumb, pathInput, dropArrow);

  breadcrumb.addEventListener('click', (e) => {
    if (e.target.classList.contains('breadcrumb-segment')) return;
    enterEditMode();
  });
  addressBar.addEventListener('dblclick', (e) => {
    e.preventDefault();
    enterEditMode();
  });

  const KNOWN_COMMANDS = new Set([
    'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
    'wt', 'wt.exe', 'bash', 'wsl', 'wsl.exe',
    'calc', 'calc.exe', 'notepad', 'notepad.exe',
    'regedit', 'regedit.exe', 'taskmgr', 'taskmgr.exe',
    'explorer', 'explorer.exe', 'control', 'control.exe',
    'mspaint', 'mspaint.exe', 'dxdiag', 'cleanmgr',
    'devmgmt.msc', 'diskmgmt.msc', 'services.msc', 'compmgmt.msc',
  ]);

  function isExplicitCommand(input) {
    const trimmed = input.trim();
    const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
    if (KNOWN_COMMANDS.has(firstWord)) return true;
    if (/^(code|git|npm|cargo|node|python|py|start|ping|ipconfig)\s+/i.test(trimmed)) return true;
    return false;
  }

  pathInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = pathInput.value.trim();
      exitEditMode();
      if (!input) return;

      const { currentPath } = store.getState();

      // If user typed a command like 'cmd', 'powershell', 'wt', 'calc', etc.
      if (isExplicitCommand(input)) {
        try {
          await executeAddressCommand(input, currentPath || 'C:\\');
          return;
        } catch (err) {
          console.error('[AddressBar Command]', err);
        }
      }

      // Otherwise try standard navigation
      try {
        await navigateTo(input);
      } catch (navErr) {
        // If navigation failed and input doesn't look like an absolute/relative path (e.g. no \ or /), try executing as command
        if (!input.includes('\\') && !input.includes('/') && !input.includes(':')) {
          try {
            await executeAddressCommand(input, currentPath || 'C:\\');
            return;
          } catch {
            // ignore
          }
        }
        toast(String(navErr?.message || navErr), 'error');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exitEditMode();
    }
  });

  pathInput.addEventListener('blur', () => {
    setTimeout(() => exitEditMode(), 150);
  });

  navRow.appendChild(addressBar);

  // Search box (Embedded client-side zero I/O filter)
  const searchBar = document.createElement('div');
  searchBar.className = 'search-bar';

  const searchIcon = icon(ICONS.search, 'search-icon');
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'search-input';
  searchInput.id = 'search-input';
  searchInput.placeholder = getSearchPlaceholder();
  searchInput.spellcheck = false;
  searchInput.autocomplete = 'off';
  searchInput.value = store.get('filterQuery') || '';

  const clearBtn = document.createElement('button');
  clearBtn.className = `search-clear-btn${searchInput.value ? '' : ' hidden'}`;
  clearBtn.title = t('filter.clear');
  clearBtn.appendChild(icon(ICONS.x, 'icon-sm'));

  searchInput.addEventListener('input', () => {
    const val = searchInput.value;
    store.setState({ filterQuery: val });
    clearBtn.classList.toggle('hidden', !val);
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    store.setState({ filterQuery: '' });
    clearBtn.classList.add('hidden');
    searchInput.focus();
  });

  searchBar.append(searchIcon, searchInput, clearBtn);
  navRow.appendChild(searchBar);

  toolbar.appendChild(navRow);

  // ── ROW 2: Ribbon Command Bar ────────────────────────────────────────────
  const cmdRow = document.createElement('div');
  cmdRow.className = 'toolbar-command-row';

  // 1. New item button
  const newBtn = document.createElement('button');
  newBtn.className = 'ribbon-btn ribbon-menu-trigger';
  newBtn.appendChild(icon(ICONS.plus, 'icon-sm text-accent'));
  const newLabel = document.createElement('span');
  newLabel.textContent = t('toolbar.new');
  newBtn.appendChild(newLabel);
  newBtn.appendChild(icon(ICONS.chevronDown, 'ribbon-chevron'));
  newBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu(newBtn, [
      {
        icon: ICONS.folder,
        label: `${t('toolbar.newFolder')} (Ctrl+Shift+N)`,
        action: async () => {
          const { currentPath } = store.getState();
          if (!currentPath || currentPath.startsWith('nexus://')) return;
          const name = await showPromptDialog({
            title: t('toolbar.newFolder') || '新增資料夾',
            message: t('context.newFolderPrompt') || '請輸入資料夾名稱：',
            defaultValue: t('context.newFolderDefault') || '新增資料夾',
          });
          if (name) {
            try {
              const createdPath = await createFolder(currentPath, name);
              undoManager.recordCreate(createdPath || `${currentPath}\\${name}`, name);
              await refreshCurrent();
            } catch (err) { toast(String(err), 'error'); }
          }
        }
      },
      {
        icon: ICONS.document,
        label: t('toolbar.newTextDoc'),
        action: async () => {
          const { currentPath } = store.getState();
          if (!currentPath || currentPath.startsWith('nexus://')) return;
          const name = await showPromptDialog({
            title: t('toolbar.newTextDoc') || '新增文字文件',
            message: t('context.newFilePrompt') || '請輸入檔案名稱：',
            defaultValue: t('context.newFileDefault') || '新增文字文件.txt',
          });
          if (name) {
            try {
              const createdPath = await createFile(currentPath, name);
              undoManager.recordCreate(createdPath || `${currentPath}\\${name}`, name);
              await refreshCurrent();
            } catch (err) { toast(String(err), 'error'); }
          }
        }
      }
    ]);
  });
  cmdRow.appendChild(newBtn);

  cmdRow.appendChild(createDivider());

  // Action buttons: Cut, Copy, Paste, Undo, Rename, Delete
  const cutBtn = createRibbonIconBtn('btn-cut', ICONS.scissors, t('toolbar.cut'), () => cutSelection());
  const copyBtn = createRibbonIconBtn('btn-copy', ICONS.copy, t('toolbar.copy'), () => copySelection());
  const pasteBtn = createRibbonIconBtn('btn-paste', ICONS.paste, t('toolbar.paste'), () => pasteClipboard());
  const undoBtn = createRibbonIconBtn('btn-undo', ICONS.undo, t('toolbar.undo') || '復原 (Ctrl+Z)', async () => {
    await undoManager.undo();
    await refreshCurrent();
  });
  const renameBtn = createRibbonIconBtn('btn-rename', ICONS.edit, t('toolbar.rename'), () => startRenameSelected());
  const deleteBtn = createRibbonIconBtn('btn-delete', ICONS.trash, t('toolbar.delete'), () => deleteSelectedItems());

  cmdRow.append(cutBtn, copyBtn, pasteBtn, undoBtn, renameBtn, deleteBtn);

  cmdRow.appendChild(createDivider());

  // 2. Sort Dropdown
  const sortBtn = document.createElement('button');
  sortBtn.className = 'ribbon-btn ribbon-menu-trigger';
  sortBtn.appendChild(icon(ICONS.sort, 'icon-sm'));
  const sortLabel = document.createElement('span');
  sortLabel.textContent = t('toolbar.sort');
  sortBtn.appendChild(sortLabel);
  sortBtn.appendChild(icon(ICONS.chevronDown, 'ribbon-chevron'));
  sortBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const { sortBy, sortOrder } = store.getState();
    toggleMenu(sortBtn, [
      { label: t('fileList.name'), checked: sortBy === 'name', action: () => store.setState({ sortBy: 'name' }) },
      { label: t('fileList.modified'), checked: sortBy === 'modified', action: () => store.setState({ sortBy: 'modified' }) },
      { label: t('fileList.type'), checked: sortBy === 'extension', action: () => store.setState({ sortBy: 'extension' }) },
      { label: t('fileList.size'), checked: sortBy === 'size', action: () => store.setState({ sortBy: 'size' }) },
      { divider: true },
      { label: t('toolbar.sortAsc') || '遞增', checked: sortOrder === 'asc', action: () => store.setState({ sortOrder: 'asc' }) },
      { label: t('toolbar.sortDesc') || '遞減', checked: sortOrder === 'desc', action: () => store.setState({ sortOrder: 'desc' }) },
    ]);
  });
  cmdRow.appendChild(sortBtn);

  // 3. View Dropdown
  const viewBtn = document.createElement('button');
  viewBtn.className = 'ribbon-btn ribbon-menu-trigger';
  viewBtn.appendChild(icon(ICONS.list, 'icon-sm'));
  const viewLabel = document.createElement('span');
  viewLabel.textContent = t('toolbar.view');
  viewBtn.appendChild(viewLabel);
  viewBtn.appendChild(icon(ICONS.chevronDown, 'ribbon-chevron'));
  viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const { viewMode, showHidden } = store.getState();
    toggleMenu(viewBtn, [
      { label: t('toolbar.viewDetails') || '詳細資料', checked: viewMode === 'list', action: () => store.setState({ viewMode: 'list' }) },
      { label: t('toolbar.viewGrid') || '大圖示', checked: viewMode === 'grid', action: () => store.setState({ viewMode: 'grid' }) },
      { label: t('toolbar.viewGridXl') || '特大圖示', checked: viewMode === 'grid-xl', action: () => store.setState({ viewMode: 'grid-xl' }) },
      { divider: true },
      { label: t('toolbar.showHidden') || '隱藏的項目', checked: !!showHidden, action: () => store.setState({ showHidden: !showHidden }) },
    ]);
  });
  cmdRow.appendChild(viewBtn);

  // 4. More Options (...)
  const moreBtn = document.createElement('button');
  moreBtn.className = 'ribbon-btn ribbon-menu-trigger';
  moreBtn.title = t('toolbar.more');
  moreBtn.appendChild(icon(ICONS.moreHorizontal, 'icon-sm'));
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const { currentPath, isDualPane } = store.getState();
    toggleMenu(moreBtn, [
      {
        label: t('toolbar.selectAll'),
        action: () => {
          const list = getFilteredFiles();
          store.setState({ selectedFiles: new Set(list.map(f => f.path)) });
        }
      },
      {
        label: t('toolbar.invertSelect'),
        action: () => {
          const { selectedFiles } = store.getState();
          const list = getFilteredFiles();
          const next = new Set();
          for (const f of list) {
            if (!selectedFiles.has(f.path)) next.add(f.path);
          }
          store.setState({ selectedFiles: next });
        }
      },
      { divider: true },
      {
        label: t('toolbar.openTerminal'),
        action: () => { if (currentPath) openTerminal(currentPath); }
      },
      {
        label: t('toolbar.openTerminalAsAdmin'),
        icon: ICONS.shield,
        action: () => { if (currentPath) openTerminalAsAdmin(currentPath); }
      },
      {
        label: t('cp.cmd.toggleDualPane'),
        checked: !!isDualPane,
        action: () => {
          const next = !store.get('isDualPane');
          store.setState({ isDualPane: next });
          document.getElementById('content-area')?.classList.toggle('dual-pane', next);
        }
      },
      { divider: true },
      {
        label: t('cp.cmd.setDefaultFileManager'),
        icon: ICONS.folder,
        action: async () => {
          try {
            await setAsDefaultFileManager();
            toast(t('cp.msg.setDefaultSuccess'), 'success');
          } catch (err) {
            toast(t('cp.msg.setDefaultFailed') + ': ' + err, 'error');
          }
        }
      },
      {
        label: t('cp.cmd.restoreDefaultFileManager'),
        icon: ICONS.refresh,
        action: async () => {
          try {
            await restoreDefaultFileManager();
            toast(t('cp.msg.restoreDefaultSuccess'), 'success');
          } catch (err) {
            toast(t('cp.msg.restoreDefaultFailed') + ': ' + err, 'error');
          }
        }
      }
    ]);
  });
  cmdRow.appendChild(moreBtn);

  // Spacer
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  cmdRow.appendChild(spacer);

  // 5. Details / Preview pane toggle
  const detailsToggle = document.createElement('button');
  detailsToggle.className = 'ribbon-btn ribbon-details-toggle';
  detailsToggle.id = 'btn-details-toggle';
  detailsToggle.title = t('toolbar.details');
  detailsToggle.appendChild(icon(ICONS.info, 'icon-sm'));
  const detailsLabel = document.createElement('span');
  detailsLabel.textContent = t('toolbar.details');
  detailsToggle.appendChild(detailsLabel);
  detailsToggle.addEventListener('click', () => {
    detailsToggle.classList.toggle('active');
    togglePreviewPanel();
  });
  cmdRow.appendChild(detailsToggle);

  toolbar.appendChild(cmdRow);

  renderBreadcrumb();
  updateNavButtons();
  updateActionButtons();
}

function getSearchPlaceholder() {
  const { currentPath } = store.getState();
  if (!currentPath) return t('toolbar.search');
  const name = currentPath.replace(/^.*[/\\]/, '') || currentPath;
  return t('toolbar.searchPlaceholder', { name }) || `搜尋 ${name}`;
}

function updateSearchPlaceholder() {
  const input = document.getElementById('search-input');
  if (input) input.placeholder = getSearchPlaceholder();
}

function updateSearchInput() {
  const input = document.getElementById('search-input');
  if (input && input.value !== (store.get('filterQuery') || '')) {
    input.value = store.get('filterQuery') || '';
  }
}

export async function deleteSelectedItems() {
  const { selectedFiles } = store.getState();
  if (!selectedFiles.size) return;
  const paths = [...selectedFiles];
  try {
    for (const p of paths) await deletePath(p);
    undoManager.recordDelete(paths);
    store.setState({ selectedFiles: new Set() });
    await refreshCurrent();
    toast(t('context.delete'), 'info');
  } catch (err) {
    toast(t('context.deleteFailed') + ': ' + err, 'error');
  }
}

function toggleMenu(targetBtn, items) {
  if (activeDropdown) {
    const isSame = activeDropdown._target === targetBtn;
    closeDropdown();
    if (isSame) return;
  }

  const menu = document.createElement('div');
  menu.className = 'fluent-dropdown-menu';
  menu._target = targetBtn;

  items.forEach(item => {
    if (item.divider) {
      const div = document.createElement('div');
      div.className = 'fluent-menu-divider';
      menu.appendChild(div);
      return;
    }

    const row = document.createElement('button');
    row.className = 'fluent-menu-item';
    if (item.checked) row.classList.add('checked');

    const checkIcon = document.createElement('span');
    checkIcon.className = 'fluent-menu-check';
    checkIcon.textContent = item.checked ? '✓' : '';
    row.appendChild(checkIcon);

    if (item.icon) {
      row.appendChild(icon(item.icon, 'icon-sm'));
    }

    const label = document.createElement('span');
    label.className = 'fluent-menu-label';
    label.textContent = item.label;
    row.appendChild(label);

    row.addEventListener('click', () => {
      closeDropdown();
      if (item.action) item.action();
    });

    menu.appendChild(row);
  });

  const rect = targetBtn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;

  document.body.appendChild(menu);
  activeDropdown = menu;
}

function createDivider() {
  const div = document.createElement('div');
  div.className = 'ribbon-divider';
  return div;
}

function createNavBtn(id, iconPath, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'nav-btn';
  btn.id = id;
  btn.title = title;
  btn.appendChild(icon(iconPath, 'icon-sm'));
  btn.addEventListener('click', onClick);
  return btn;
}

function createRibbonIconBtn(id, iconPath, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'ribbon-btn ribbon-icon-btn';
  btn.id = id;
  btn.title = title;
  btn.appendChild(icon(iconPath, 'icon-sm'));
  btn.addEventListener('click', onClick);
  return btn;
}

function enterEditMode() {
  const breadcrumb = document.getElementById('breadcrumb');
  const pathInput = document.getElementById('address-input');
  if (!breadcrumb || !pathInput) return;

  isEditing = true;
  const { currentPath } = store.getState();
  pathInput.value = currentPath || '';
  breadcrumb.classList.add('hidden');
  pathInput.classList.remove('hidden');
  requestAnimationFrame(() => {
    pathInput.focus();
    pathInput.select();
  });
}

function exitEditMode() {
  const breadcrumb = document.getElementById('breadcrumb');
  const pathInput = document.getElementById('address-input');
  if (!breadcrumb || !pathInput) return;

  isEditing = false;
  pathInput.classList.add('hidden');
  breadcrumb.classList.remove('hidden');
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  const { currentPath } = store.getState();
  bc.innerHTML = '';
  if (currentPath === 'nexus://this-pc') {
    const seg = document.createElement('button');
    seg.className = 'breadcrumb-segment';
    seg.style.display = 'inline-flex';
    seg.style.alignItems = 'center';
    seg.style.gap = '6px';
    seg.appendChild(icon(ICONS.desktop, 'icon-sm text-accent'));
    const txt = document.createElement('span');
    txt.textContent = t('sidebar.thisPc') || '本機';
    seg.appendChild(txt);
    bc.appendChild(seg);
    return;
  }

  if (currentPath.startsWith('nexus://tag/')) {
    const tagId = currentPath.replace('nexus://tag/', '');
    const info = getTagInfo(tagId);
    const seg = document.createElement('button');
    seg.className = 'breadcrumb-segment';
    seg.style.display = 'inline-flex';
    seg.style.alignItems = 'center';
    seg.style.gap = '6px';

    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    dot.style.background = info.color;
    dot.style.setProperty('--tag-glow', info.glow);

    const txt = document.createElement('span');
    txt.textContent = t(info.labelKey) || tagId;

    seg.append(dot, txt);
    bc.appendChild(seg);
    return;
  }

  const normalized = currentPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const isWin = /^[A-Za-z]:/.test(parts[0] || '');

  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      bc.appendChild(sep);
    }
    const seg = document.createElement('button');
    seg.className = 'breadcrumb-segment';
    seg.textContent = part;

    let segPath = parts.slice(0, i + 1).join('/');
    if (isWin) {
      segPath = segPath.replace(/\//g, '\\');
      if (i === 0 && /^[A-Za-z]:$/.test(parts[0])) {
        segPath = parts[0] + '\\';
      }
    } else {
      segPath = '/' + segPath;
    }

    seg.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateTo(segPath);
    });
    bc.appendChild(seg);
  });
}

function updateNavButtons() {
  const { tabs, activeTabId } = store.getState();
  const tab = tabs.find(t => t.id === activeTabId);
  const history = tab?.history || [];
  const historyIndex = tab?.historyIndex ?? history.length - 1;
  const back = document.getElementById('btn-back');
  const fwd = document.getElementById('btn-forward');
  if (back) back.disabled = historyIndex <= 0;
  if (fwd) fwd.disabled = historyIndex >= history.length - 1;
}

function updateActionButtons() {
  const { selectedFiles, clipboard } = store.getState();
  const nSel = selectedFiles?.size || 0;
  const hasClip = !!clipboard?.paths?.length;

  const cut = document.getElementById('btn-cut');
  const copy = document.getElementById('btn-copy');
  const paste = document.getElementById('btn-paste');
  const rename = document.getElementById('btn-rename');
  const del = document.getElementById('btn-delete');

  if (cut) cut.disabled = nSel === 0;
  if (copy) copy.disabled = nSel === 0;
  if (paste) paste.disabled = !hasClip;
  if (rename) rename.disabled = nSel !== 1;
  if (del) del.disabled = nSel === 0;
}
