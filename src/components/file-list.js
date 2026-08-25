/**
 * Nexus Files — File List
 * Lean: virtual list, keyboard nav, inline rename, selection stats.
 * Heavy work (thumbs) only when grid + visible.
 */
import store from '../store/store.js';
import {
  navigateTo, refreshCurrent, navigateUp,
  openFile, deletePath, renamePath, createFolder, createFile,
  calcFolderSize, openTerminal, revealInExplorer, emptyRecycleBin,
  extractArchive, extractZip,
} from '../utils/tauri-bridge.js';
import {
  formatFileSize, formatDate, getFileTypeDescription, getDateGroupKey, fileIconEl, icon, ICONS,
  DEFAULT_TAGS, TAG_COLORS, parentPath, joinPath, isArchiveFile, stripArchiveExt,
} from '../utils/helpers.js';
import { t, onLocaleChange } from '../i18n/index.js';
import { loadGridThumbnails } from './preview-panel.js';
import { isDragging } from '../utils/dnd.js';
import { cutSelection, copySelection, pasteClipboard } from '../utils/clipboard-actions.js';
import { toast, statusMsg } from '../utils/toast.js';
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';

const ROW_HEIGHT = 36;
/** Virtualize earlier — large dirs must stay cheap (PHILOSOPHY) */
const VIRTUAL_THRESHOLD = 80;
const OVERSCAN = 10;
/** Grid renders in chunks with a sentinel — no measurement math, capped DOM. */
const GRID_CHUNK = 240;
/** Manual folder-size results are cached (LRU, hard cap). */
const FOLDER_SIZE_CACHE_MAX = 200;

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
      await showBackgroundMenu();
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

function render() {
  if (!containerEl) return;
  disconnectGridObserver();
  const { isLoading, viewMode, error, files, sortBy } = store.getState();
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
    const empty = document.createElement('div');
    empty.className = 'file-list-empty';
    empty.appendChild(icon(filterQueryActive() ? ICONS.search : ICONS.folder, 'icon'));
    const span = document.createElement('span');
    span.textContent = filterQueryActive() ? t('filter.noResults') : t('fileList.empty');
    empty.appendChild(span);
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
        await renamePath(file.path, newName);
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
  const tags = fileTags[file.path] || [];
  if (tags.length > 0 && renamingPath !== file.path) {
    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'file-tags-inline';
    tags.forEach((tId) => {
      const dot = document.createElement('span');
      dot.className = 'tag-dot';
      dot.style.background = TAG_COLORS[tId] || '#888';
      dot.title = t(tId);
      tagsWrap.appendChild(dot);
    });
    nameCell.appendChild(tagsWrap);
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
    if (file.isDir || isArchiveFile(file.name) || file.path.startsWith('archive://') || file.path.startsWith('zip://')) {
      navigateTo(file.path);
    } else {
      try { await openFile(file.path); } catch (err) { console.error(err); }
    }
  });
  row.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleClick(file, idx, e);
    await showFileMenu(file);
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
    if (file.isDir || isArchiveFile(file.name) || file.path.startsWith('archive://') || file.path.startsWith('zip://')) {
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

async function showFileMenu(file) {
  try {
    const items = [
      await MenuItem.new({
        id: 'open',
        text: t('context.open'),
        action: async () => {
          if (file.isDir) navigateTo(file.path);
          else await openFile(file.path);
        },
      }),
      await MenuItem.new({
        id: 'copyPath',
        text: t('context.copyPath'),
        action: async () => {
          try {
            await navigator.clipboard.writeText(file.path);
            toast(t('context.copyPath'), 'success');
          } catch { /* ignore */ }
        },
      }),
      await MenuItem.new({
        id: 'reveal',
        text: t('context.showInExplorer'),
        action: () => revealInExplorer(file.path).catch((err) => toast(String(err), 'error')),
      }),
      ...(isArchiveFile(file.name) ? [
        await MenuItem.new({
          id: 'browseArchive',
          text: '瀏覽壓縮檔內容',
          action: () => navigateTo(file.path),
        }),
        await MenuItem.new({
          id: 'extractHere',
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
        }),
        await MenuItem.new({
          id: 'extractToFolder',
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
        }),
      ] : []),
      ...(file.isDir ? [
        await MenuItem.new({
          id: 'openTerminalHere',
          text: t('context.openTerminal'),
          action: () => openTerminal(file.path).catch((err) => toast(String(err), 'error')),
        }),
        await MenuItem.new({
          id: 'calcSize',
          text: t('context.calculateSize'),
          action: () => calculateFolderSize(file),
        }),
      ] : []),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        id: 'cut',
        text: t('context.cut') || 'Cut',
        action: () => {
          store.setState({ selectedFiles: new Set([file.path]) });
          cutSelection();
        },
      }),
      await MenuItem.new({
        id: 'copy',
        text: t('context.copy') || 'Copy',
        action: () => {
          store.setState({ selectedFiles: new Set([file.path]) });
          copySelection();
        },
      }),
      await MenuItem.new({
        id: 'paste',
        text: t('context.paste') || 'Paste',
        action: () => pasteClipboard(),
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        id: 'rename',
        text: t('context.rename'),
        action: () => beginInlineRename(file),
      }),
      await MenuItem.new({
        id: 'delete',
        text: t('context.deleteToBin') || t('context.delete'),
        action: async () => {
          if (!confirm(t('context.deleteConfirm', { name: file.name }))) return;
          try {
            await deletePath(file.path);
            store.setState({ selectedFiles: new Set() });
            await refreshCurrent();
            toast(t('context.delete'), 'success');
          } catch (err) {
            toast(t('context.deleteFailed') + ': ' + err, 'error');
          }
        },
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await buildTagSubmenu(file),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        id: 'properties',
        text: t('context.properties'),
        action: () => {
          const sizeText = file.isDir
            ? (() => { const s = folderSizeCacheGet(file.path); return s != null ? formatFileSize(s) : '—'; })()
            : formatFileSize(file.size);
          alert([
            `${t('context.propName')}: ${file.name}`,
            `${t('context.propPath')}: ${file.path}`,
            `${t('context.propType')}: ${file.isDir ? t('fileList.folder') : (file.extension || '—')}`,
            `${t('context.propSize')}: ${sizeText}`,
            `${t('context.propModified')}: ${formatDate(file.modified)}`,
          ].join('\n'));
        },
      }),
    ];
    await (await Menu.new({ items })).popup();
  } catch (err) {
    console.warn('Native menu failed', err);
  }
}

async function buildTagSubmenu(file) {
  const current = store.get('fileTags')[file.path] || [];
  const tagItems = [];
  for (const tag of DEFAULT_TAGS) {
    const checked = current.includes(tag.id);
    tagItems.push(await MenuItem.new({
      id: `tag-${tag.id}`,
      text: (checked ? '✓ ' : '   ') + t(tag.labelKey),
      action: () => {
        store.toggleFileTag(file.path, tag.id);
        render();
      },
    }));
  }
  return await Submenu.new({ text: t('context.tags'), items: tagItems });
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

function selectByPattern() {
  const pattern = prompt(t('context.selectPatternPrompt'), '*');
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

async function showBackgroundMenu() {
  const { currentPath } = store.getState();
  if (!currentPath || currentPath.startsWith('nexus://')) return;
  try {
    const items = [
      await MenuItem.new({ id: 'refresh', text: t('context.refresh'), action: () => refreshCurrent() }),
      await MenuItem.new({ id: 'paste', text: t('context.paste') || 'Paste', action: () => pasteClipboard() }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        id: 'newFolder',
        text: t('context.newFolder'),
        action: async () => {
          const name = prompt(t('context.newFolderPrompt'), t('context.newFolderDefault'));
          if (!name) return;
          try {
            await createFolder(currentPath, name);
            await refreshCurrent();
          } catch (err) {
            toast(t('context.createFailed') + ': ' + err, 'error');
          }
        },
      }),
      await MenuItem.new({
        id: 'newFile',
        text: t('context.newTextFile'),
        action: async () => {
          const name = prompt(t('context.newFilePrompt'), t('context.newFileDefault'));
          if (!name) return;
          try {
            await createFile(currentPath, name);
            await refreshCurrent();
          } catch (err) {
            toast(t('context.createFailed') + ': ' + err, 'error');
          }
        },
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        id: 'copyCurrentPath',
        text: t('context.copyCurrentPath'),
        action: async () => {
          try {
            await navigator.clipboard.writeText(currentPath);
            toast(t('context.copyCurrentPath'), 'success');
          } catch { /* */ }
        },
      }),
      await MenuItem.new({
        id: 'openTerminal',
        text: t('context.openTerminal'),
        action: () => openTerminal(currentPath).catch((err) => toast(String(err), 'error')),
      }),
      await MenuItem.new({
        id: 'revealFolder',
        text: t('context.revealFolder'),
        action: () => revealInExplorer(currentPath).catch((err) => toast(String(err), 'error')),
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        id: 'selectPattern',
        text: t('context.selectByPattern'),
        action: () => selectByPattern(),
      }),
      await MenuItem.new({
        id: 'invertSelection',
        text: t('context.invertSelection'),
        action: () => invertSelection(),
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        id: 'emptyBin',
        text: t('context.emptyBin'),
        action: async () => {
          if (!confirm(t('context.emptyBinConfirm'))) return;
          try {
            await emptyRecycleBin();
            toast(t('context.emptyBin'), 'success');
          } catch (err) {
            toast(t('context.emptyBinFailed') + ': ' + err, 'error');
          }
        },
      }),
    ];
    await (await Menu.new({ items })).popup();
  } catch (err) {
    console.warn('Background menu failed', err);
  }
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
