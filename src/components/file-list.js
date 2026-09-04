/**
 * Nexus Files — File List
 * Lean: virtual list, keyboard nav, inline rename, selection stats.
 * Heavy work (thumbs) only when grid + visible.
 */
import store from '../store/store.js';
import {
  navigateTo, refreshCurrent, navigateUp,
  openFile, deletePath, renamePath, createFolder, createFile,
  calcFolderSize, openTerminal, openTerminalAsAdmin, revealInExplorer, emptyRecycleBin,
  extractArchive, extractZip, openFileAsAdmin,
  getOpenWithApps, openFileWith, showOpenWithDialog, pickExecutableFile,
} from '../utils/tauri-bridge.js';
import {
  formatFileSize, formatDate, getFileTypeDescription, getDateGroupKey, fileIconEl, icon, ICONS,
  DEFAULT_TAGS, TAG_COLORS, getTagInfo, getAllTags, createTagDot, parentPath, joinPath, isArchiveFile, stripArchiveExt,
} from '../utils/helpers.js';
import { t, onLocaleChange } from '../i18n/index.js';
import { loadGridThumbnails, disconnectThumbnailObserver } from './preview-panel.js';
import { isDragging } from '../utils/dnd.js';
import { cutSelection, copySelection, pasteClipboard } from '../utils/clipboard-actions.js';
import { toast, statusMsg } from '../utils/toast.js';
import { showConfirmDialog, showPromptDialog, showTagDialog } from '../utils/modal.js';
import { undoManager } from '../utils/undo-manager.js';
import { showFluentContextMenu } from './fluent-context-menu.js';
import { showPropertiesDialog } from './properties-dialog.js';

const ROW_HEIGHT = 36;
/** Virtualize earlier — large dirs must stay cheap (PHILOSOPHY) */
const VIRTUAL_THRESHOLD = 80;
const OVERSCAN = 10;
/** Grid renders in chunks with a sentinel — tuned to 60 for low memory. */
const GRID_CHUNK = 60;
/** Manual folder-size results are cached (LRU, hard cap). */
const FOLDER_SIZE_CACHE_MAX = 100;

let containerEl = null;
let virtualState = { files: [], viewMode: 'list' };
/** Focus index within filtered list (-1 = none) */
let focusIndex = -1;
let typeaheadBuf = '';
let typeaheadTimer = null;
let renamingPath = null;
/** Filter bar element (Ctrl+F); persists across re-renders via re-append. */
let filterBarEl = null;
/** Grid chunked-render state { files, rendered, observer, sentinel } */
let gridChunkState = null;
/** @type {Map<string, number>} */
const folderSizeCache = new Map();

function folderSizeCacheSet(path, size) {
  if (folderSizeCache.has(path)) folderSizeCache.delete(path);
  folderSizeCache.set(path, size);
  while (folderSizeCache.size > FOLDER_SIZE_CACHE_MAX) {
    folderSizeCache.delete(folderSizeCache.keys().next().value);
  }
}

/** Read-through LRU: a hit refreshes recency so cap eviction evicts cold entries. */
function folderSizeCacheGet(path) {
  if (!folderSizeCache.has(path)) return null;
  const size = folderSizeCache.get(path);
  folderSizeCacheSet(path, size);
  return size;
}

export function initFileList() {
  containerEl = document.getElementById('file-list-container');
  if (!containerEl) return;

  store.subscribe(
    ['files', 'isLoading', 'sortBy', 'sortOrder', 'showHidden', 'viewMode', 'fileTags', 'error', 'clipboard', 'filterQuery'],
    () => render()
  );
  store.subscribe('selectedFiles', () => updateSelectionUi());
  store.subscribe('currentPath', () => {
    // A stale query in a new folder is noise — reset on navigation.
    if (store.get('filterQuery')) {
      store.setState({ filterQuery: '' });
      filterBarEl?.classList.add('hidden');
    }
  });
  onLocaleChange(() => render());

  containerEl.addEventListener('contextmenu', async (e) => {
    if (e.target === containerEl || e.target.classList.contains('file-list-header')
      || e.target.classList.contains('file-list-viewport')
      || e.target.classList.contains('file-list-rows-host')
      || e.target.classList.contains('grid-group-items')
      || e.target.classList.contains('file-list-empty')) {
      e.preventDefault();
      await showBackgroundMenu(e);
    }
  });

  initMarqueeSelection();

  containerEl.addEventListener('scroll', () => {
    if (virtualState.viewMode !== 'list') return;
    if (virtualState.files.length < VIRTUAL_THRESHOLD) return;
    renderVirtualRows();
  }, { passive: true });

  document.addEventListener('keydown', onListKeydown);

  // Status bar view buttons
  const btnDetails = document.getElementById('status-btn-details');
  const btnGrid = document.getElementById('status-btn-grid');
  if (btnDetails) {
    btnDetails.addEventListener('click', () => store.setState({ viewMode: 'list' }));
  }
  if (btnGrid) {
    btnGrid.addEventListener('click', () => {
      const mode = store.get('viewMode');
      store.setState({ viewMode: mode === 'grid' ? 'grid-xl' : 'grid' });
    });
  }
  const syncViewBtns = (mode) => {
    if (btnDetails) btnDetails.classList.toggle('active', mode === 'list');
    if (btnGrid) {
      btnGrid.classList.toggle('active', mode === 'grid' || mode === 'grid-xl');
      btnGrid.title = mode === 'grid-xl' ? '特大圖示 (點擊切換大圖示)' : '大圖示 (點擊切換特大圖示)';
    }
  };
  store.subscribe('viewMode', syncViewBtns);
  syncViewBtns(store.get('viewMode'));

  render();
}

let justMarqueed = false;

/**
 * Rubberband / Marquee selection (drag-to-box-select on empty area)
 */
function initMarqueeSelection() {
  let isMarquee = false;
  let startX = 0;
  let startY = 0;
  let marqueeEl = null;
  let initialSelected = new Set();
  let currentMarqueeSelected = new Set();
  let autoScrollRaf = null;

  containerEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;

    // Ignore interactive chrome
    if (e.target.closest('.rename-input, .group-toggle-btn, .file-group-header, .file-list-header, button, input, .filter-bar')) {
      return;
    }

    const row = e.target.closest('.file-row');
    const selected = store.get('selectedFiles') || new Set();
    const isSelected = row && selected.has(row.dataset.path);

    // If clicking on an ALREADY selected row (without modifier keys), let DnD move it
    if (isSelected && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      return;
    }

    startX = e.clientX;
    startY = e.clientY;
    isMarquee = false;
    justMarqueed = false;
    initialSelected = (e.ctrlKey || e.metaKey || e.shiftKey)
      ? new Set(store.get('selectedFiles') || [])
      : new Set();
    currentMarqueeSelected = new Set();

    const updateMarqueeBounds = (clientX, clientY, moveEvent) => {
      if (!marqueeEl) return;
      const minX = Math.min(startX, clientX);
      const maxX = Math.max(startX, clientX);
      const minY = Math.min(startY, clientY);
      const maxY = Math.max(startY, clientY);

      marqueeEl.style.left = `${minX}px`;
      marqueeEl.style.top = `${minY}px`;
      marqueeEl.style.width = `${Math.max(0, maxX - minX)}px`;
      marqueeEl.style.height = `${Math.max(0, maxY - minY)}px`;

      // Hit-testing visible rows
      const rows = containerEl.querySelectorAll('.file-row[data-path]');
      const intersectedPaths = new Set();

      rows.forEach((r) => {
        const rect = r.getBoundingClientRect();
        const intersects = !(rect.right < minX || rect.left > maxX || rect.bottom < minY || rect.top > maxY);
        if (intersects && r.dataset.path) {
          intersectedPaths.add(r.dataset.path);
        }
      });

      const nextSelected = new Set(initialSelected);
      if (moveEvent && (moveEvent.ctrlKey || moveEvent.metaKey)) {
        intersectedPaths.forEach((path) => {
          if (initialSelected.has(path)) nextSelected.delete(path);
          else nextSelected.add(path);
        });
      } else if (moveEvent && moveEvent.shiftKey) {
        intersectedPaths.forEach((path) => nextSelected.add(path));
      } else {
        nextSelected.clear();
        intersectedPaths.forEach((path) => nextSelected.add(path));
      }

      currentMarqueeSelected = nextSelected;

      rows.forEach((r) => {
        const path = r.dataset.path;
        r.classList.toggle('selected', nextSelected.has(path));
      });

      const selSpan = document.getElementById('status-selection');
      if (selSpan) {
        const count = nextSelected.size;
        selSpan.textContent = count > 0 ? t('status.selected', { count }) : '';
        const divider = document.getElementById('status-bar-divider');
        if (divider) divider.style.display = count > 0 ? 'inline' : 'none';
      }
    };

    const handleAutoScroll = (clientY) => {
      if (!containerEl) return;
      const rect = containerEl.getBoundingClientRect();
      const edgeSize = 36;
      let scrollDelta = 0;

      if (clientY < rect.top + edgeSize) {
        const factor = Math.max(0.2, (rect.top + edgeSize - clientY) / edgeSize);
        scrollDelta = -Math.round(16 * factor);
      } else if (clientY > rect.bottom - edgeSize) {
        const factor = Math.max(0.2, (clientY - (rect.bottom - edgeSize)) / edgeSize);
        scrollDelta = Math.round(16 * factor);
      }

      if (scrollDelta !== 0) {
        containerEl.scrollTop += scrollDelta;
        if (virtualState.viewMode === 'list' && virtualState.files.length >= VIRTUAL_THRESHOLD) {
          renderVirtualRows();
        }
      }
    };

    let lastClientX = startX;
    let lastClientY = startY;

    const onMouseMove = (moveEvent) => {
      lastClientX = moveEvent.clientX;
      lastClientY = moveEvent.clientY;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      if (!isMarquee) {
        if (dx * dx + dy * dy < 16) return;
        isMarquee = true;
        document.body.classList.add('is-marquee-selecting');
        if (!marqueeEl) {
          marqueeEl = document.createElement('div');
          marqueeEl.className = 'selection-marquee';
          document.body.appendChild(marqueeEl);
        }
      }

      updateMarqueeBounds(lastClientX, lastClientY, moveEvent);
      handleAutoScroll(lastClientY);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      if (autoScrollRaf) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }

      if (marqueeEl?.parentNode) {
        marqueeEl.parentNode.removeChild(marqueeEl);
        marqueeEl = null;
      }
      document.body.classList.remove('is-marquee-selecting');

      if (isMarquee) {
        justMarqueed = true;
        isMarquee = false;
        store.setState({ selectedFiles: currentMarqueeSelected });
        updateSelectionUi();
        setTimeout(() => { justMarqueed = false; }, 60);
      }
    };

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
  });

  // Click empty area → clear selection (Explorer-like)
  containerEl.addEventListener('click', (e) => {
    if (justMarqueed) return;
    if (e.target === containerEl
      || e.target.classList.contains('file-list-header')
      || e.target.classList.contains('file-list-viewport')
      || e.target.classList.contains('file-list-rows-host')
      || e.target.classList.contains('grid-group-items')
      || e.target.classList.contains('file-list-empty')) {
      store.setState({ selectedFiles: new Set() });
      focusIndex = -1;
      updateSelectionUi();
    }
  });
}

/** Used by main.js F2 */
export function startRenameSelected() {
  const { selectedFiles } = store.getState();
  if (selectedFiles.size !== 1) return;
  const path = [...selectedFiles][0];
  const filtered = getFilteredFiles();
  const file = filtered.find((f) => f.path === path);
  if (file) beginInlineRename(file);
}

export function getFilteredFiles() {
  const { files, sortBy, sortOrder, showHidden, filterQuery } = store.getState();
  let filtered = showHidden ? (files || []) : (files || []).filter((f) => !f.isHidden);
  const q = (filterQuery || '').trim().toLowerCase();
  if (q) filtered = filtered.filter((f) => f.name.toLowerCase().includes(q));
  return sortFiles(filtered, sortBy, sortOrder);
}

// ── Filter bar (Ctrl+F, current folder only — zero I/O) ──────────────────────

function ensureFilterBar() {
  if (filterBarEl) return;
  filterBarEl = document.createElement('div');
  filterBarEl.className = 'filter-bar hidden';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'filter-input';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = t('filter.placeholder');

  const count = document.createElement('span');
  count.className = 'filter-count';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'filter-close';
  closeBtn.title = t('filter.clear');
  closeBtn.appendChild(icon(ICONS.x, 'icon-sm'));
  closeBtn.addEventListener('click', clearFilter);

  filterBarEl.append(input, count, closeBtn);

  input.addEventListener('input', () => {
    store.setState({ filterQuery: input.value });
    updateFilterCount();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      clearFilter();
    } else if (e.key === 'Enter') {
      // Keep the filter active, just get out of the input.
      e.preventDefault();
      filterBarEl.classList.add('hidden');
      containerEl?.focus({ preventScroll: true });
    }
  });

  onLocaleChange(() => {
    input.placeholder = t('filter.placeholder');
    closeBtn.title = t('filter.clear');
  });

  // Lives on #panes (never cleared by list re-renders) so typing keeps focus.
  containerEl.parentElement?.appendChild(filterBarEl);
}

export function openFilterBar() {
  if (!containerEl) return;
  ensureFilterBar();
  filterBarEl.classList.remove('hidden');
  // Same host as ensureFilterBar (#panes): re-renders wipe containerEl,
  // which would destroy the focused input mid-keystroke.
  const panes = containerEl.parentElement;
  if (panes && filterBarEl.parentElement !== panes) panes.appendChild(filterBarEl);
  const input = filterBarEl.querySelector('input');
  input.value = store.get('filterQuery') || '';
  updateFilterCount();
  input.focus();
  input.select();
}

function clearFilter() {
  store.setState({ filterQuery: '' });
  filterBarEl?.classList.add('hidden');
  containerEl?.focus({ preventScroll: true });
}

function updateFilterCount() {
  if (!filterBarEl) return;
  const count = filterBarEl.querySelector('.filter-count');
  if (count) count.textContent = t('filter.count', { count: getFilteredFiles().length });
}

/** The bar lives on #panes and survives list re-renders; keep it attached when visible. */
function attachFilterBar() {
  if (!filterBarEl || filterBarEl.classList.contains('hidden')) return;
  const panes = containerEl?.parentElement;
  if (panes && filterBarEl.parentElement !== panes) panes.appendChild(filterBarEl);
}

function renderThisPcView(container) {
  container.replaceChildren();
  container.className = 'this-pc-container';

  const { drives = [], knownFolders = {} } = store.getState();

  // 1. Folders Section
  const foldersSection = document.createElement('div');
  foldersSection.className = 'this-pc-section';

  const foldersTitle = document.createElement('div');
  foldersTitle.className = 'this-pc-section-title';
  foldersTitle.appendChild(icon(ICONS.folder, 'icon-sm'));
  const foldersTitleText = document.createElement('span');
  foldersTitleText.textContent = t('thisPc.folders') || '資料夾';
  foldersTitle.appendChild(foldersTitleText);
  foldersSection.appendChild(foldersTitle);

  const foldersGrid = document.createElement('div');
  foldersGrid.className = 'this-pc-folders-grid';

  const FOLDER_ITEMS = [
    { key: 'desktop', labelKey: 'sidebar.desktop', icon: ICONS.desktop, defaultName: 'Desktop' },
    { key: 'downloads', labelKey: 'sidebar.downloads', icon: ICONS.download, defaultName: 'Downloads' },
    { key: 'documents', labelKey: 'sidebar.documents', icon: ICONS.document, defaultName: 'Documents' },
    { key: 'pictures', labelKey: 'sidebar.pictures', icon: ICONS.image, defaultName: 'Pictures' },
    { key: 'music', labelKey: 'sidebar.music', icon: ICONS.music, defaultName: 'Music' },
    { key: 'videos', labelKey: 'sidebar.videos', icon: ICONS.video, defaultName: 'Videos' },
  ];

  FOLDER_ITEMS.forEach(f => {
    const fPath = knownFolders[f.key] || '';
    const card = document.createElement('div');
    card.className = 'this-pc-folder-card';
    card.title = fPath;

    const ico = icon(f.icon, 'this-pc-folder-icon');
    const name = document.createElement('span');
    name.className = 'this-pc-folder-name';
    name.textContent = t(f.labelKey) || f.defaultName;

    card.append(ico, name);
    card.addEventListener('click', () => {
      if (fPath) navigateTo(fPath);
    });
    foldersGrid.appendChild(card);
  });

  foldersSection.appendChild(foldersGrid);
  container.appendChild(foldersSection);

  // 2. Drives & Devices Section
  const drivesSection = document.createElement('div');
  drivesSection.className = 'this-pc-section';

  const drivesTitle = document.createElement('div');
  drivesTitle.className = 'this-pc-section-title';
  drivesTitle.appendChild(icon(ICONS.drive, 'icon-sm'));
  const drivesTitleText = document.createElement('span');
  drivesTitleText.textContent = t('thisPc.devicesAndDrives') || '裝置與磁碟機';
  drivesTitle.appendChild(drivesTitleText);
  drivesSection.appendChild(drivesTitle);

  const drivesGrid = document.createElement('div');
  drivesGrid.className = 'this-pc-drives-grid';

  drives.forEach(d => {
    const card = document.createElement('div');
    card.className = 'this-pc-drive-card';
    card.title = `${d.label || '本機磁碟'} (${d.mountPoint})`;

    const isSystemDrive = /^[Cc]:/.test(d.mountPoint);
    const iconWrap = document.createElement('div');
    iconWrap.className = 'this-pc-drive-icon-wrap';
    iconWrap.appendChild(icon(isSystemDrive ? ICONS.desktop : ICONS.drive, 'icon'));

    const info = document.createElement('div');
    info.className = 'this-pc-drive-info';

    const title = document.createElement('div');
    title.className = 'this-pc-drive-title';
    title.textContent = `${d.label || '本機磁碟'} (${d.mountPoint.replace(/\\$/, '')})`;
    info.appendChild(title);

    if (d.total > 0) {
      const used = d.total - d.free;
      const pct = Math.min(100, Math.max(0, (used / d.total) * 100));

      const bar = document.createElement('div');
      bar.className = 'this-pc-progress-bar';

      const fill = document.createElement('div');
      fill.className = `this-pc-progress-fill${pct >= 90 ? ' danger' : ''}`;
      fill.style.width = `${pct.toFixed(1)}%`;
      bar.appendChild(fill);
      info.appendChild(bar);

      const cap = document.createElement('div');
      cap.className = 'this-pc-drive-capacity';
      cap.textContent = `${formatFileSize(d.free)} 可用，共 ${formatFileSize(d.total)}`;
      info.appendChild(cap);
    }

    card.append(iconWrap, info);
    card.addEventListener('click', () => navigateTo(d.mountPoint));
    drivesGrid.appendChild(card);
  });

  drivesSection.appendChild(drivesGrid);
  container.appendChild(drivesSection);

  updateStatusBar([]);
}

function render() {
  if (!containerEl) return;
  disconnectGridObserver();
  const { isLoading, viewMode, error, files, sortBy, currentPath } = store.getState();

  if (currentPath === 'nexus://this-pc') {
    renderThisPcView(containerEl);
    attachFilterBar();
    return;
  }

  const filtered = getFilteredFiles();

  const isGrid = viewMode === 'grid' || viewMode === 'grid-xl';
  const isGrouped = sortBy === 'modified';
  let containerClasses = isGrid ? 'grid-view' : 'list-view';
  if (viewMode === 'grid-xl') containerClasses += ' grid-xl-view';
  if (isGrid && isGrouped) containerClasses += ' is-grouped';

  containerEl.className = containerClasses;
  virtualState.files = filtered;
  virtualState.viewMode = viewMode;

  // Keep focus index in range
  if (focusIndex >= filtered.length) focusIndex = filtered.length - 1;

  if (isLoading) {
    containerEl.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'file-list-loading';
    loading.innerHTML = '<div class="spinner"></div>';
    const loadText = document.createElement('span');
    loadText.textContent = t('fileList.loading');
    loading.appendChild(loadText);
    containerEl.appendChild(loading);
    attachFilterBar();
    return;
  }

  if (error && (!files || files.length === 0)) {
    containerEl.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'file-list-empty';
    empty.appendChild(icon(ICONS.info, 'icon'));
    const span = document.createElement('span');
    span.textContent = error;
    empty.appendChild(span);
    containerEl.appendChild(empty);
    updateStatusBar([]);
    attachFilterBar();
    return;
  }

  if (!filtered.length) {
    containerEl.replaceChildren();
    const currentPath = store.get('currentPath') || '';
    const empty = document.createElement('div');
    empty.className = 'file-list-empty';
    if (currentPath.startsWith('nexus://tag/')) {
      const tagId = currentPath.replace('nexus://tag/', '');
      const tagInfo = getTagInfo(tagId);
      empty.appendChild(icon(ICONS.tag, 'icon'));
      const title = document.createElement('div');
      title.style.fontWeight = '600';
      title.style.color = 'var(--text-primary)';
      title.textContent = t('tagView.emptyTitle');
      const hint = document.createElement('div');
      hint.style.fontSize = 'var(--fs-xs)';
      hint.style.color = 'var(--text-secondary)';
      hint.style.maxWidth = '360px';
      hint.style.textAlign = 'center';
      hint.textContent = t('tagView.emptyHint');
      empty.append(title, hint);
    } else {
      empty.appendChild(icon(filterQueryActive() ? ICONS.search : ICONS.folder, 'icon'));
      const span = document.createElement('span');
      span.textContent = filterQueryActive() ? t('filter.noResults') : t('fileList.empty');
      empty.appendChild(span);
    }
    containerEl.appendChild(empty);
    updateStatusBar([]);
    attachFilterBar();
    return;
  }

  if (isGrid) {
    renderGrid(filtered);
  } else if (filtered.length >= VIRTUAL_THRESHOLD) {
    renderVirtualList(filtered);
  } else {
    renderFullList(filtered);
  }

  updateStatusBar(filtered);
  updateSelectionUi();
  attachFilterBar();
}

function filterQueryActive() {
  return !!(store.get('filterQuery') || '').trim();
}

const collapsedGroups = new Set();

function buildGroupHeader(groupKey, count, isCollapsed) {
  const header = document.createElement('div');
  header.className = `file-group-header${isCollapsed ? ' collapsed' : ''}`;
  header.dataset.groupKey = groupKey;

  const btn = document.createElement('button');
  btn.className = 'group-toggle-btn';
  btn.appendChild(icon(ICONS.chevronDown, 'group-chevron'));
  header.appendChild(btn);

  const title = document.createElement('span');
  title.className = 'group-title';
  title.textContent = t(groupKey);
  header.appendChild(title);

  const countBadge = document.createElement('span');
  countBadge.className = 'group-count';
  countBadge.textContent = `(${count})`;
  header.appendChild(countBadge);

  const line = document.createElement('div');
  line.className = 'group-line';
  header.appendChild(line);

  header.addEventListener('click', (e) => {
    e.stopPropagation();
    if (collapsedGroups.has(groupKey)) {
      collapsedGroups.delete(groupKey);
    } else {
      collapsedGroups.add(groupKey);
    }
    render();
  });

  return header;
}

function renderFullList(filtered) {
  const { sortBy, selectedFiles } = store.getState();
  containerEl.innerHTML = '';
  containerEl.appendChild(buildHeader(sortBy));
  const fragment = document.createDocumentFragment();

  if (sortBy === 'modified') {
    const groupMap = new Map();
    filtered.forEach((file, idx) => {
      const key = getDateGroupKey(file.modified);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push({ file, idx });
    });

    for (const [key, items] of groupMap.entries()) {
      const isCollapsed = collapsedGroups.has(key);
      fragment.appendChild(buildGroupHeader(key, items.length, isCollapsed));
      if (!isCollapsed) {
        items.forEach(({ file, idx }) => {
          fragment.appendChild(buildRow(file, idx, selectedFiles));
        });
      }
    }
  } else {
    filtered.forEach((file, idx) => {
      fragment.appendChild(buildRow(file, idx, selectedFiles));
    });
  }

  containerEl.appendChild(fragment);
}

function renderVirtualList(filtered) {
  const { sortBy, selectedFiles } = store.getState();
  if (sortBy === 'modified') {
    // For date-modified grouping, use the grouped list rendering
    renderFullList(filtered);
    return;
  }

  containerEl.innerHTML = '';
  containerEl.appendChild(buildHeader(sortBy));

  const viewport = document.createElement('div');
  viewport.className = 'file-list-viewport';
  viewport.style.height = `${filtered.length * ROW_HEIGHT}px`;

  const rowsHost = document.createElement('div');
  rowsHost.className = 'file-list-rows-host';
  rowsHost.id = 'file-list-rows-host';
  viewport.appendChild(rowsHost);
  containerEl.appendChild(viewport);
  renderVirtualRows();
}

function renderVirtualRows() {
  const host = document.getElementById('file-list-rows-host');
  if (!host || !containerEl) return;

  const filtered = virtualState.files;
  const { selectedFiles } = store.getState();
  const scrollTop = containerEl.scrollTop;
  const headerOffset = 32;
  const visibleTop = Math.max(0, scrollTop - headerOffset);
  const clientH = containerEl.clientHeight;
  const start = Math.max(0, Math.floor(visibleTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(filtered.length, Math.ceil((visibleTop + clientH) / ROW_HEIGHT) + OVERSCAN);

  host.innerHTML = '';
  host.style.paddingTop = `${start * ROW_HEIGHT}px`;
  host.style.paddingBottom = `${Math.max(0, (filtered.length - end) * ROW_HEIGHT)}px`;

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    fragment.appendChild(buildRow(filtered[i], i, selectedFiles));
  }
  host.appendChild(fragment);
}

function renderGrid(filtered) {
  containerEl.innerHTML = '';
  const { sortBy, selectedFiles } = store.getState();

  if (sortBy === 'modified') {
    const fragment = document.createDocumentFragment();
    const groupMap = new Map();
    filtered.forEach((file, idx) => {
      const key = getDateGroupKey(file.modified);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push({ file, idx });
    });

    for (const [key, items] of groupMap.entries()) {
      const isCollapsed = collapsedGroups.has(key);
      fragment.appendChild(buildGroupHeader(key, items.length, isCollapsed));
      if (!isCollapsed) {
        const gridBox = document.createElement('div');
        gridBox.className = 'grid-group-items';
        items.forEach(({ file, idx }) => {
          gridBox.appendChild(buildRow(file, idx, selectedFiles));
        });
        fragment.appendChild(gridBox);
      }
    }
    containerEl.appendChild(fragment);
  } else {
    gridChunkState = { files: filtered, rendered: Math.min(GRID_CHUNK, filtered.length) };
    containerEl.appendChild(buildGridFragment(0, gridChunkState.rendered));

    if (gridChunkState.rendered < filtered.length) {
      const sentinel = document.createElement('div');
      sentinel.className = 'grid-sentinel';
      containerEl.appendChild(sentinel);

      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((en) => en.isIntersecting) || !gridChunkState) return;
        const start = gridChunkState.rendered;
        if (start >= gridChunkState.files.length) {
          disconnectGridObserver();
          return;
        }
        gridChunkState.rendered = Math.min(start + GRID_CHUNK, gridChunkState.files.length);
        gridChunkState.sentinel?.parentNode?.insertBefore(
          buildGridFragment(start, gridChunkState.rendered),
          gridChunkState.sentinel
        );
        loadGridThumbnails(containerEl);
        if (gridChunkState.rendered >= gridChunkState.files.length) disconnectGridObserver();
      }, { root: containerEl, rootMargin: '600px' });

      observer.observe(sentinel);
      gridChunkState.observer = observer;
      gridChunkState.sentinel = sentinel;
    }
  }

  requestAnimationFrame(() => loadGridThumbnails(containerEl));
}

function buildGridFragment(start, end) {
  const fragment = document.createDocumentFragment();
  const selectedFiles = store.getState().selectedFiles;
  for (let i = start; i < end; i++) {
    fragment.appendChild(buildRow(gridChunkState.files[i], i, selectedFiles));
  }
  return fragment;
}

function disconnectGridObserver() {
  disconnectThumbnailObserver();
  if (gridChunkState?.observer) gridChunkState.observer.disconnect();
  gridChunkState = null;
}

function buildHeader(sortBy) {
  const { sortOrder } = store.getState();
  const headerCols = [
    { label: t('fileList.name'), key: 'name' },
    { label: t('fileList.modified'), key: 'modified' },
    { label: t('fileList.type'), key: 'extension' },
    { label: t('fileList.size'), key: 'size' },
  ];
  const header = document.createElement('div');
  header.className = 'file-list-header';
  headerCols.forEach((col) => {
    const span = document.createElement('span');
    span.textContent = col.label;
    if (sortBy === col.key) {
      span.classList.add('sorted');
      span.textContent = col.label + (sortOrder === 'asc' ? ' ↑' : ' ↓');
    }
    span.addEventListener('click', () => {
      const newOrder = sortBy === col.key && sortOrder === 'asc' ? 'desc' : 'asc';
      store.setState({ sortBy: col.key, sortOrder: newOrder });
    });
    header.appendChild(span);
  });
  return header;
}

function buildRow(file, idx, selectedFiles) {
  const row = document.createElement('div');
  row.className = `file-row ${file.isDir ? 'is-dir' : 'is-file'}`;
  row.dataset.path = file.path;
  row.dataset.index = String(idx);
  if (selectedFiles.has(file.path)) row.classList.add('selected');
  if (idx === focusIndex) row.classList.add('focused');

  const clip = store.get('clipboard');
  if (clip?.mode === 'cut' && clip.paths?.includes(file.path)) {
    row.classList.add('is-cut');
  }

  const nameCell = document.createElement('div');
  nameCell.className = 'file-name';
  nameCell.appendChild(fileIconEl(file));

  if (renamingPath === file.path) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = file.name;
    input.spellcheck = false;
    nameCell.appendChild(input);
    requestAnimationFrame(() => {
      input.focus();
      const dot = file.isDir ? -1 : file.name.lastIndexOf('.');
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    });
    const commit = async () => {
      const newName = input.value.trim();
      renamingPath = null;
      if (!newName || newName === file.name) {
        render();
        return;
      }
      try {
        const newPath = await renamePath(file.path, newName);
        undoManager.recordRename(file.path, newPath || file.path.replace(/[^\\/]+$/, newName), file.name, newName);
        toast(t('context.rename') + ': ' + newName, 'success');
        await refreshCurrent();
      } catch (err) {
        toast(t('context.renameFailed') + ': ' + err, 'error');
        render();
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renamingPath = null;
        render();
      }
    });
    input.addEventListener('blur', () => {
      if (renamingPath === file.path) commit();
    });
  } else {
    const nameText = document.createElement('span');
    nameText.className = 'file-name-text';
    nameText.textContent = file.name;
    nameCell.appendChild(nameText);
  }

  const fileTags = store.get('fileTags') || {};
  const tags = fileTags[file.path];
  if (tags && tags.length > 0 && renamingPath !== file.path) {
    const isGrid = store.get('viewMode') === 'grid' || store.get('viewMode') === 'grid-xl';
    if (isGrid) {
      const badge = document.createElement('div');
      badge.className = 'grid-tags-badge';
      for (let i = 0; i < tags.length; i++) {
        const dot = createTagDot(tags[i]);
        dot.title = t(getTagInfo(tags[i]).labelKey) || tags[i];
        badge.appendChild(dot);
      }
      row.appendChild(badge);
    } else {
      const tagsWrap = document.createElement('div');
      tagsWrap.className = 'file-tags-inline';
      if (tags.length <= 2) {
        for (let i = 0; i < tags.length; i++) {
          const info = getTagInfo(tags[i]);
          const label = t(info.labelKey) || tags[i];
          const chip = document.createElement('span');
          chip.className = 'tag-chip';
          chip.style.setProperty('--tag-color', info.color);
          chip.style.setProperty('--tag-bg', info.bg);
          chip.style.setProperty('--tag-border', info.border);
          chip.title = label;

          const dot = createTagDot(tags[i]);
          const txt = document.createElement('span');
          txt.textContent = label;
          chip.append(dot, txt);
          tagsWrap.appendChild(chip);
        }
      } else {
        const cluster = document.createElement('div');
        cluster.className = 'tag-cluster-chip';
        const names = [];
        for (let i = 0; i < tags.length; i++) {
          const info = getTagInfo(tags[i]);
          names.push(t(info.labelKey) || tags[i]);
          cluster.appendChild(createTagDot(tags[i]));
        }
        cluster.title = names.join(', ');
        tagsWrap.appendChild(cluster);
      }
      nameCell.appendChild(tagsWrap);
    }
  }
  row.appendChild(nameCell);

  const dateCell = document.createElement('div');
  dateCell.className = 'file-date';
  dateCell.textContent = formatDate(file.modified);
  row.appendChild(dateCell);

  const typeCell = document.createElement('div');
  typeCell.className = 'file-type';
  typeCell.textContent = getFileTypeDescription(file);
  row.appendChild(typeCell);

  const sizeCell = document.createElement('div');
  sizeCell.className = 'file-size';
  sizeCell.textContent = file.isDir
    ? (() => { const s = folderSizeCacheGet(file.path); return s != null ? formatFileSize(s) : ''; })()
    : formatFileSize(file.size);
  row.appendChild(sizeCell);

  row.addEventListener('click', (e) => {
    if (renamingPath || justMarqueed) return;
    handleClick(file, idx, e);
  });
  row.addEventListener('dblclick', async (e) => {
    if (renamingPath || e.target.classList.contains('rename-input')) return;
    if (file.isDir || isArchiveFile(file.name)) {
      navigateTo(file.path);
    } else {
      try { await openFile(file.path); } catch (err) { console.error(err); }
    }
  });
  row.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleClick(file, idx, e);
    await showFileMenu(file, e);
  });

  return row;
}

function beginInlineRename(file) {
  renamingPath = file.path;
  store.setState({ selectedFiles: new Set([file.path]) });
  const filtered = getFilteredFiles();
  focusIndex = filtered.findIndex((f) => f.path === file.path);
  render();
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

function onListKeydown(e) {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
  if (store.get('commandPaletteOpen')) return;
  if (renamingPath) return;

  const filtered = getFilteredFiles();
  if (!filtered.length && e.key !== 'Backspace') return;

  // Ctrl+A select all
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    store.setState({ selectedFiles: new Set(filtered.map((f) => f.path)) });
    return;
  }

  // Ctrl+C / X / V handled in main + here for focus
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    copySelection();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
    e.preventDefault();
    cutSelection();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
    e.preventDefault();
    pasteClipboard();
    return;
  }

  if (e.key === 'F2') {
    e.preventDefault();
    startRenameSelected();
    return;
  }

  if (e.key === 'Enter' && filtered.length) {
    e.preventDefault();
    const file = focusedOrSelected(filtered);
    if (!file) return;
    if (file.isDir || isArchiveFile(file.name)) {
      navigateTo(file.path);
    } else {
      openFile(file.path).catch(console.error);
    }
    return;
  }

  if (e.key === 'Backspace' && !e.ctrlKey) {
    e.preventDefault();
    navigateUp();
    return;
  }

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    if (!filtered.length) return;
    let next = focusIndex;
    if (e.key === 'ArrowDown') next = Math.min(filtered.length - 1, Math.max(0, focusIndex) + 1);
    if (e.key === 'ArrowUp') next = Math.max(0, (focusIndex < 0 ? 0 : focusIndex) - 1);
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = filtered.length - 1;
    focusIndex = next;
    const file = filtered[focusIndex];
    if (e.shiftKey) {
      const sel = new Set(store.get('selectedFiles'));
      sel.add(file.path);
      store.setState({ selectedFiles: sel });
    } else {
      store.setState({ selectedFiles: new Set([file.path]) });
    }
    ensureFocusVisible();
    updateSelectionUi();
    return;
  }

  // Type-ahead: printable character
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    typeaheadBuf += e.key.toLowerCase();
    clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => { typeaheadBuf = ''; }, 800);
    const idx = filtered.findIndex((f) => f.name.toLowerCase().startsWith(typeaheadBuf));
    if (idx >= 0) {
      focusIndex = idx;
      store.setState({ selectedFiles: new Set([filtered[idx].path]) });
      ensureFocusVisible();
      updateSelectionUi();
    }
  }
}

function focusedOrSelected(filtered) {
  if (focusIndex >= 0 && filtered[focusIndex]) return filtered[focusIndex];
  const sel = store.get('selectedFiles');
  if (sel.size === 1) {
    const p = [...sel][0];
    return filtered.find((f) => f.path === p) || store.get('files').find((f) => f.path === p);
  }
  return null;
}

function ensureFocusVisible() {
  if (focusIndex < 0 || !containerEl) return;
  // Virtual list: scroll so row is in view
  if (virtualState.files.length >= VIRTUAL_THRESHOLD && virtualState.viewMode === 'list') {
    const top = focusIndex * ROW_HEIGHT;
    const viewTop = containerEl.scrollTop;
    const viewBottom = viewTop + containerEl.clientHeight - 40;
    if (top < viewTop) containerEl.scrollTop = top;
    else if (top + ROW_HEIGHT > viewBottom) containerEl.scrollTop = top - containerEl.clientHeight + ROW_HEIGHT + 48;
    renderVirtualRows();
  } else {
    const row = containerEl.querySelector(`.file-row[data-index="${focusIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }
  document.querySelectorAll('.file-row.focused').forEach((r) => r.classList.remove('focused'));
  containerEl.querySelector(`.file-row[data-index="${focusIndex}"]`)?.classList.add('focused');
}

// ── Context menus ────────────────────────────────────────────────────────────

async function showFileMenu(file, e) {
  const x = e ? e.clientX : window.innerWidth / 2;
  const y = e ? e.clientY : window.innerHeight / 2;

  // Windows 11 Signature Top Command Bar
  const commandBar = [
    {
      id: 'cut',
      icon: 'scissors',
      title: `${t('context.cut') || '剪下'} (Ctrl+X)`,
      action: () => {
        store.setState({ selectedFiles: new Set([file.path]) });
        cutSelection();
      },
    },
    {
      id: 'copy',
      icon: 'copy',
      title: `${t('context.copy') || '複製'} (Ctrl+C)`,
      action: () => {
        store.setState({ selectedFiles: new Set([file.path]) });
        copySelection();
      },
    },
    {
      id: 'rename',
      icon: 'edit',
      title: `${t('context.rename') || '重新命名'} (F2)`,
      action: () => beginInlineRename(file),
    },
    {
      id: 'copyPath',
      icon: 'clipboard',
      title: t('context.copyPath') || '複製路徑',
      action: async () => {
        try {
          await navigator.clipboard.writeText(file.path);
          toast(t('context.copyPath'), 'success');
        } catch { /* ignore */ }
      },
    },
    {
      id: 'delete',
      icon: 'trash',
      title: `${t('context.deleteToBin') || t('context.delete') || '刪除'} (Delete)`,
      action: async () => {
        try {
          await deletePath(file.path);
          undoManager.recordDelete([file.path], file.name);
          store.setState({ selectedFiles: new Set() });
          await refreshCurrent();
          toast(t('context.delete'), 'info');
        } catch (err) {
          toast(t('context.deleteFailed') + ': ' + err, 'error');
        }
      },
    },
  ];

  const items = [
    {
      id: 'open',
      icon: 'externalLink',
      text: t('context.open') || '開啟',
      shortcut: 'Enter',
      action: async () => {
        if (file.isDir) navigateTo(file.path);
        else await openFile(file.path);
      },
    },
    ...(!file.isDir ? [{
      id: 'runAsAdmin',
      icon: 'shield',
      text: t('context.runAsAdmin') || '以系統管理員身分執行',
      action: async () => {
        try {
          await openFileAsAdmin(file.path);
        } catch (err) {
          toast(String(err), 'error');
        }
      },
    }] : []),
    ...(!file.isDir ? [{
      id: 'openWith',
      icon: 'moreHorizontal',
      text: t('context.openWith') || '以…開啟',
      submenu: async () => {
        const subItems = [];
        try {
          const apps = await getOpenWithApps(file.path);
          if (apps && apps.length > 0) {
            for (const app of apps) {
              subItems.push({
                id: `open-with-${app.path}`,
                icon: 'file',
                text: app.name,
                action: async () => {
                  try {
                    await openFileWith(file.path, app.path);
                  } catch (err) {
                    toast(String(err), 'error');
                  }
                },
              });
            }
            subItems.push({ type: 'separator' });
          }
        } catch (err) {
          console.warn('getOpenWithApps failed:', err);
        }

        subItems.push({
          id: 'open-with-dialog',
          icon: 'settings',
          text: t('context.chooseAnotherApp') || '選擇其他應用程式…',
          action: async () => {
            try {
              await showOpenWithDialog(file.path);
            } catch (err) {
              toast(String(err), 'error');
            }
          },
        });

        subItems.push({
          id: 'open-with-browse',
          icon: 'search',
          text: t('context.browseForApp') || '瀏覽應用程式 (.exe)…',
          action: async () => {
            try {
              const picked = await pickExecutableFile();
              if (picked) {
                await openFileWith(file.path, picked);
              }
            } catch (err) {
              toast(String(err), 'error');
            }
          },
        });

        return subItems;
      },
    }] : []),
    ...(isArchiveFile(file.name) ? [
      {
        id: 'browseArchive',
        icon: 'folder',
        text: '瀏覽壓縮檔內容',
        action: () => navigateTo(file.path),
      },
      {
        id: 'extractHere',
        icon: 'archive',
        text: '解壓縮至此',
        action: async () => {
          try {
            const dest = parentPath(file.path);
            await extractArchive(file.path, dest);
            await refreshCurrent();
            toast('解壓縮完成', 'success');
          } catch (err) {
            toast('解壓縮失敗: ' + err, 'error');
          }
        },
      },
      {
        id: 'extractToFolder',
        icon: 'archive',
        text: `解壓縮至 "${stripArchiveExt(file.name)}"`,
        action: async () => {
          try {
            const dest = joinPath(parentPath(file.path), stripArchiveExt(file.name));
            await extractArchive(file.path, dest);
            await refreshCurrent();
            toast('解壓縮完成', 'success');
          } catch (err) {
            toast('解壓縮失敗: ' + err, 'error');
          }
        },
      },
    ] : []),
    ...(file.isDir ? [
      {
        id: 'openTerminalHere',
        icon: 'command',
        text: t('context.openTerminal'),
        action: () => openTerminal(file.path).catch((err) => toast(String(err), 'error')),
      },
      {
        id: 'openTerminalHereAsAdmin',
        icon: 'shield',
        text: t('context.openTerminalAsAdmin') || '以系統管理員身分開啟終端機',
        action: () => openTerminalAsAdmin(file.path).catch((err) => toast(String(err), 'error')),
      },
      {
        id: 'calcSize',
        icon: 'info',
        text: t('context.calculateSize'),
        action: () => calculateFolderSize(file),
      },
    ] : []),
    { type: 'separator' },
    {
      id: 'paste',
      icon: 'paste',
      text: t('context.paste') || '貼上',
      shortcut: 'Ctrl+V',
      action: () => pasteClipboard(),
    },
    { type: 'separator' },
    {
      id: 'reveal',
      icon: 'desktop',
      text: t('context.showInExplorer'),
      action: () => revealInExplorer(file.path).catch((err) => toast(String(err), 'error')),
    },
    {
      id: 'tags',
      icon: 'tag',
      text: t('context.tags'),
      submenu: () => buildTagSubmenuItems(file),
    },
    { type: 'separator' },
    {
      id: 'properties',
      icon: 'info',
      text: t('context.properties'),
      shortcut: 'Alt+Enter',
      action: () => showPropertiesDialog(file),
    },
  ];

  await showFluentContextMenu({ x, y, commandBar, items });
}

function buildTagSubmenuItems(file) {
  const current = store.get('fileTags')[file.path] || [];
  const tagItems = [];
  const allTags = getAllTags();
  for (const tag of allTags) {
    const checked = current.includes(tag.id);
    const tagName = t(tag.labelKey) || tag.name || tag.id;
    tagItems.push({
      id: `tag-${tag.id}`,
      iconHtml: `<span class="fluent-tag-dot" style="background:${tag.color}"></span>`,
      text: tagName,
      checked,
      action: () => {
        store.toggleFileTag(file.path, tag.id);
        render();
      },
    });
  }
  tagItems.push({ type: 'separator' });
  tagItems.push({
    id: 'add-new-tag',
    icon: 'plus',
    text: t('tags.addTag') || '新增標籤…',
    action: async () => {
      const res = await showTagDialog();
      if (res && res.name) {
        const newTag = store.addTag(res, DEFAULT_TAGS);
        store.toggleFileTag(file.path, newTag.id);
        render();
      }
    },
  });
  return tagItems;
}

/** Manual recursive size — only for the asked folder, spawn_blocking on the Rust side. */
async function calculateFolderSize(file) {
  statusMsg(t('context.calculatingSize'));
  try {
    const size = await calcFolderSize(file.path);
    folderSizeCacheSet(file.path, size);
    toast(`${file.name}: ${formatFileSize(size)}`, 'success', 4000);
    statusMsg(`${file.name}: ${formatFileSize(size)}`);
    render();
  } catch (err) {
    // Superseded by a newer calc request — latest one reports the result.
    if (String(err).includes('cancelled')) return;
    toast(t('context.calcSizeFailed') + ': ' + err, 'error');
    statusMsg('');
  }
}

/** Convert a simple glob (* and ?) to a case-insensitive RegExp. */
function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

async function selectByPattern() {
  const pattern = await showPromptDialog({
    title: t('context.selectByPattern') || '按模式選取',
    message: t('context.selectPatternPrompt') || '選取符合條件的項目（可用 * 和 ?）：',
    defaultValue: '*',
  });
  if (!pattern) return;
  const re = globToRegex(pattern);
  const sel = new Set(store.get('selectedFiles'));
  getFilteredFiles().forEach((f) => {
    if (re.test(f.name)) sel.add(f.path);
  });
  store.setState({ selectedFiles: sel });
}

function invertSelection() {
  const sel = store.get('selectedFiles');
  const inverted = new Set(
    getFilteredFiles().filter((f) => !sel.has(f.path)).map((f) => f.path)
  );
  store.setState({ selectedFiles: inverted });
}

async function showBackgroundMenu(e) {
  const { currentPath, viewMode } = store.getState();
  if (!currentPath || currentPath.startsWith('nexus://')) return;

  const x = e ? e.clientX : window.innerWidth / 2;
  const y = e ? e.clientY : window.innerHeight / 2;

  const items = [
    {
      id: 'view',
      icon: 'grid',
      text: t('toolbar.view') || '檢視',
      submenu: [
        {
          id: 'view-list',
          icon: 'list',
          text: t('context.viewList') || '清單檢視',
          checked: viewMode === 'list',
          action: () => store.setState({ viewMode: 'list' }),
        },
        {
          id: 'view-grid',
          icon: 'grid',
          text: t('context.viewGrid') || '大圖示',
          checked: viewMode === 'grid',
          action: () => store.setState({ viewMode: 'grid' }),
        },
        {
          id: 'view-grid-xl',
          icon: 'grid',
          text: '特大圖示',
          checked: viewMode === 'grid-xl',
          action: () => store.setState({ viewMode: 'grid-xl' }),
        },
      ],
    },
    { type: 'separator' },
    {
      id: 'refresh',
      icon: 'refresh',
      text: t('context.refresh'),
      shortcut: 'F5',
      action: () => refreshCurrent(),
    },
    {
      id: 'paste',
      icon: 'paste',
      text: t('context.paste') || '貼上',
      shortcut: 'Ctrl+V',
      action: () => pasteClipboard(),
    },
    { type: 'separator' },
    {
      id: 'newFolder',
      icon: 'folderPlus',
      text: t('context.newFolder'),
      action: async () => {
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
      },
    },
    {
      id: 'newFile',
      icon: 'filePlus',
      text: t('context.newTextFile'),
      action: async () => {
        const name = await showPromptDialog({
          title: t('context.newTextFile') || '新增文字文件',
          message: t('context.newFilePrompt') || '請輸入檔案名稱：',
          defaultValue: t('context.newFileDefault') || '新增文字文件.txt',
        });
        if (!name) return;
        try {
          const createdPath = await createFile(currentPath, name);
          undoManager.recordCreate(createdPath || `${currentPath}\\${name}`, name);
          await refreshCurrent();
        } catch (err) {
          toast(t('context.createFailed') + ': ' + err, 'error');
        }
      },
    },
    { type: 'separator' },
    {
      id: 'copyCurrentPath',
      icon: 'clipboard',
      text: t('context.copyCurrentPath'),
      action: async () => {
        try {
          await navigator.clipboard.writeText(currentPath);
          toast(t('context.copyCurrentPath'), 'success');
        } catch { /* ignore */ }
      },
    },
    {
      id: 'openTerminal',
      icon: 'command',
      text: t('context.openTerminal'),
      action: () => openTerminal(currentPath).catch((err) => toast(String(err), 'error')),
    },
    {
      id: 'openTerminalAsAdmin',
      icon: 'shield',
      text: t('context.openTerminalAsAdmin') || '以系統管理員身分開啟終端機',
      action: () => openTerminalAsAdmin(currentPath).catch((err) => toast(String(err), 'error')),
    },
    {
      id: 'revealFolder',
      icon: 'desktop',
      text: t('context.revealFolder'),
      action: () => revealInExplorer(currentPath).catch((err) => toast(String(err), 'error')),
    },
    { type: 'separator' },
    {
      id: 'selectPattern',
      icon: 'search',
      text: t('context.selectByPattern'),
      action: () => selectByPattern(),
    },
    {
      id: 'invertSelection',
      icon: 'sort',
      text: t('context.invertSelection'),
      action: () => invertSelection(),
    },
    ...(currentPath === 'nexus://trash' ? [
      { type: 'separator' },
      {
        id: 'emptyBin',
        icon: 'trash',
        text: t('context.emptyBin'),
        action: async () => {
          const ok = await showConfirmDialog({
            title: t('context.emptyBin') || '清空回收筒',
            message: t('context.emptyBinConfirm') || '確定要永久刪除資源回收筒中的所有項目嗎？',
            confirmText: t('context.emptyBin') || '清空',
            cancelText: t('common.cancel') || '取消',
            isDanger: true,
          });
          if (!ok) return;
          try {
            await emptyRecycleBin();
            toast(t('context.emptyBin'), 'success');
          } catch (err) {
            toast(t('context.emptyBinFailed') + ': ' + err, 'error');
          }
        },
      }
    ] : []),
  ];

  await showFluentContextMenu({ x, y, items });
}

// ── Selection / status ───────────────────────────────────────────────────────

function handleClick(file, idx, e) {
  if (isDragging()) return;
  focusIndex = idx;
  const { selectedFiles } = store.getState();
  const newSet = new Set(selectedFiles);
  if (e.ctrlKey || e.metaKey) {
    newSet.has(file.path) ? newSet.delete(file.path) : newSet.add(file.path);
  } else if (e.shiftKey && newSet.size > 0) {
    const filtered = getFilteredFiles();
    const paths = filtered.map((f) => f.path);
    const anchor = focusIndex >= 0 ? focusIndex : paths.indexOf([...newSet].pop());
    const a = paths.indexOf(filtered[Math.max(0, anchor)]?.path || file.path);
    // Use last selected as anchor if possible
    let start = paths.findIndex((p) => selectedFiles.has(p));
    if (start < 0) start = idx;
    const [lo, hi] = start < idx ? [start, idx] : [idx, start];
    newSet.clear();
    for (let i = lo; i <= hi; i++) newSet.add(paths[i]);
  } else {
    newSet.clear();
    newSet.add(file.path);
  }
  store.setState({ selectedFiles: newSet });
}

function updateSelectionUi() {
  const { selectedFiles, files, clipboard } = store.getState();
  document.querySelectorAll('.file-row').forEach((row) => {
    row.classList.toggle('selected', selectedFiles.has(row.dataset.path));
    row.classList.toggle('focused', Number(row.dataset.index) === focusIndex);
    const cut = clipboard?.mode === 'cut' && clipboard.paths?.includes(row.dataset.path);
    row.classList.toggle('is-cut', !!cut);
  });

  // Selection size (files only — lean, no recursive folder size)
  let bytes = 0;
  let nFiles = 0;
  if (selectedFiles.size && files?.length) {
    const map = new Map(files.map((f) => [f.path, f]));
    for (const p of selectedFiles) {
      const f = map.get(p);
      if (f && !f.isDir) {
        bytes += f.size || 0;
        nFiles++;
      }
    }
  }

  const divider = document.getElementById('status-bar-divider');
  const selSpan = document.getElementById('status-selection');
  if (selSpan) {
    if (selectedFiles.size === 0) {
      if (divider) divider.style.display = 'none';
      selSpan.textContent = '';
    } else {
      if (divider) divider.style.display = 'inline';
      let text = t('status.selected', { count: selectedFiles.size });
      if (nFiles > 0) text += ` ${formatFileSize(bytes)}`;
      selSpan.textContent = text;
    }
  }
}

function updateStatusBar(fileList) {
  const countSpan = document.getElementById('status-item-count');
  const { filterQuery } = store.getState();
  if (countSpan) {
    let text = t('status.items', { count: fileList.length });
    if (filterQuery?.trim()) {
      const total = (store.get('files') || []).length;
      text += ` (${t('status.filtered', { count: fileList.length, total })})`;
    }
    countSpan.textContent = text;
  }
}

function sortFiles(files, sortBy, order) {
  const dir = order === 'desc' ? -1 : 1;
  return [...files].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'modified':
        // Pure chronological ordering across ALL items (folders and files alike)
        cmp = (a.modified || 0) - (b.modified || 0);
        break;
      case 'size':
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        cmp = a.size - b.size;
        break;
      case 'extension':
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        cmp = (a.extension || '').localeCompare(b.extension || '');
        break;
      case 'name':
      default:
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        break;
    }
    if (cmp !== 0) return cmp * dir;
    // Equal keys always fall back to name tiebreaker
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function openPropertiesForSelection() {
  const { selectedFiles } = store.getState();
  const filtered = getFilteredFiles();
  if (selectedFiles.size > 0) {
    const firstPath = selectedFiles.values().next().value;
    const file = filtered.find(f => f.path === firstPath);
    if (file) {
      showPropertiesDialog(file);
      return;
    }
  }
  if (focusIndex >= 0 && filtered[focusIndex]) {
    showPropertiesDialog(filtered[focusIndex]);
  }
}
