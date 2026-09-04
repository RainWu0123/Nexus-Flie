/**
 * Nexus Files — Drag & Drop (Internal & External OS Drops)
 * Supports dragging files internally and dragging files from Windows Desktop / Explorer.
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import store from '../store/store.js';
import { movePath, copyPath, refreshCurrent, startNativeDrag } from './tauri-bridge.js';
import { toast } from './toast.js';
import { t } from '../i18n/index.js';
import { getTagInfo } from './helpers.js';

const THRESHOLD_PX = 5;

let drag = null; // pending or active gesture
let bound = false;

export function initDnd() {
  if (bound) return;
  bound = true;

  // Internal Drag & Drop (pure mouse tracking on window)
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('blur', () => cancel());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel();
  });

  // External OS Drag & Drop (files from Desktop / Explorer)
  initExternalDnd();

  console.log('[dnd] initialized (internal + external)');
}

export function isDragging() {
  return !!(drag && drag.active);
}

function onDown(e) {
  if (e.button !== 0) return;

  // Don't hijack form controls / interactive chrome
  if (e.target.closest?.('input, textarea, select, option, [contenteditable="true"]')) {
    return;
  }
  // Allow starting DnD only from an already selected row
  const row = e.target.closest?.('.file-row');
  if (!row || !row.dataset.path) return;

  const path = row.dataset.path;
  const selected = store.get('selectedFiles') || new Set();
  const isSelected = selected.has(path);

  // If clicked on an unselected row, do not arm DnD (let marquee handle box selection)
  if (!isSelected) {
    return;
  }

  // Ctrl/Shift click is for multi-select — don't arm drag
  if (e.ctrlKey || e.metaKey || e.shiftKey) return;
  const isDir = row.classList.contains('is-dir');
  const name =
    row.querySelector('.file-name-text')?.textContent?.trim() ||
    path.replace(/^.*[/\\]/, '') ||
    path;

  const paths =
    selected.has(path) && selected.size > 1 ? [...selected] : [path];

  drag = {
    paths,
    path,
    isDir,
    name,
    x0: e.clientX,
    y0: e.clientY,
    active: false,
    ghost: null,
    dropPath: null,
    dropKind: null, // 'folder' | 'quickAccess'
  };
}

function onMove(e) {
  if (!drag) return;

  // Mouse button released outside window without mouseup in some edge cases
  if (drag.active && e.buttons === 0) {
    onUp(e);
    return;
  }

  const dx = e.clientX - drag.x0;
  const dy = e.clientY - drag.y0;

  if (!drag.active) {
    if (dx * dx + dy * dy < THRESHOLD_PX * THRESHOLD_PX) return;
    startActive(e);
  }

  // Once active, own the pointer
  e.preventDefault();
  e.stopPropagation();

  if (drag.ghost) {
    drag.ghost.style.left = e.clientX + 12 + 'px';
    drag.ghost.style.top = e.clientY + 12 + 'px';
  }

  hitTest(e.clientX, e.clientY);
}

function startActive(e) {
  drag.active = true;
  document.documentElement.classList.add('is-dragging');
  document.body.classList.add('is-dragging');

  document.querySelectorAll('.file-row').forEach((r) => {
    if (drag.paths.includes(r.dataset.path)) r.classList.add('dragging');
  });

  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent =
    drag.paths.length > 1
      ? `${drag.name}  (+${drag.paths.length - 1})`
      : drag.name;
  ghost.style.left = e.clientX + 12 + 'px';
  ghost.style.top = e.clientY + 12 + 'px';
  document.body.appendChild(ghost);
  drag.ghost = ghost;

  status(
    drag.paths.length > 1
      ? t('dnd.dragItems', { count: drag.paths.length })
      : t('dnd.dragItem', { name: drag.name })
  );
  console.log('[dnd] drag started', drag.paths);

  // Trigger native OS Drag & Drop so user can drop to Windows Desktop / Explorer / other apps
  if (drag.paths && drag.paths.length > 0) {
    startNativeDrag(drag.paths).catch((err) => {
      console.warn('[dnd] startNativeDrag error:', err);
    });
  }
}

function hitTest(x, y) {
  clearHl();
  drag.dropPath = null;
  drag.dropKind = null;

  const prevVis = drag.ghost ? drag.ghost.style.visibility : '';
  if (drag.ghost) drag.ghost.style.visibility = 'hidden';
  const el = document.elementFromPoint(x, y);
  if (drag.ghost) drag.ghost.style.visibility = prevVis || 'visible';
  if (!el) return;

  // Folder row
  const folder = el.closest?.('.file-row.is-dir');
  if (folder?.dataset.path) {
    const dest = folder.dataset.path;
    if (canDropInto(dest)) {
      folder.classList.add('drag-over');
      drag.dropPath = dest;
      drag.dropKind = 'folder';
      status(t('dnd.dropHint', { path: short(dest) }));
      return;
    }
  }

  // Sidebar path (home, desktop, drives…)
  const nav = el.closest?.('.sidebar-item[data-path], .sidebar-drive[data-path]');
  if (nav?.dataset.path) {
    if (nav.dataset.path.startsWith('nexus://tag/')) {
      const tagId = nav.dataset.tagId || nav.dataset.path.replace('nexus://tag/', '');
      nav.classList.add('drag-over');
      drag.dropPath = tagId;
      drag.dropKind = 'tag';
      const tagInfo = getTagInfo(tagId);
      const tagLabel = t(tagInfo.labelKey) || tagId;
      status(`🏷️ ${tagLabel}`);
      return;
    }
    const dest = nav.dataset.path;
    if (canDropInto(dest)) {
      nav.classList.add('drag-over');
      drag.dropPath = dest;
      drag.dropKind = 'folder';
      status(t('dnd.dropHint', { path: short(dest) }));
      return;
    }
  }

  // Quick access zone — pin directory
  if (el.closest?.('.sidebar-qa-list') && drag.isDir && drag.paths.length === 1) {
    el.closest('.sidebar-qa-list').classList.add('drag-over');
    drag.dropKind = 'quickAccess';
    status(t('dnd.addToQuickAccess'));
    return;
  }

  // Dual pane secondary area
  if (el.closest?.('#file-list-secondary, .secondary-list')) {
    const sec = store.get('secondaryPath');
    if (sec && canDropInto(sec)) {
      el.closest('#file-list-secondary, .secondary-list')?.classList.add('drag-over');
      drag.dropPath = sec;
      drag.dropKind = 'folder';
      status(t('dnd.dropHint', { path: short(sec) }));
      return;
    }
  }

  status(
    drag.paths.length > 1
      ? t('dnd.dragItems', { count: drag.paths.length })
      : t('dnd.dragItem', { name: drag.name })
  );
}

function canDropInto(dest) {
  if (!dest || !drag) return false;
  for (const p of drag.paths) {
    if (!p) continue;
    if (p === dest) return false;
    if (dest.startsWith(p + '\\') || dest.startsWith(p + '/')) return false;
  }
  return true;
}

async function onUp(e) {
  if (!drag) return;

  const state = drag;

  if (!state.active) {
    // Click only — do not interfere
    drag = null;
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const { dropPath, dropKind, paths, name, isDir } = state;
  finishUi();
  drag = null;

  // Swallow the trailing click
  const swallow = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  window.addEventListener('click', swallow, true);
  setTimeout(() => window.removeEventListener('click', swallow, true), 50);

  try {
    if (dropKind === 'folder' && dropPath) {
      status(t('clip.moving'));
      let ok = 0;
      const errs = [];
      for (const p of paths) {
        try {
          console.log('[dnd] move', p, '->', dropPath);
          await movePath(p, dropPath);
          ok++;
        } catch (err) {
          console.error('[dnd] move failed', p, err);
          errs.push(`${p}: ${err}`);
        }
      }
      store.setState({ selectedFiles: new Set() });
      await refreshCurrent();
      if (errs.length) {
        status(t('dnd.movedPartial', { ok, fail: errs.length }));
        toast(t('dnd.moveFailed') + ': ' + errs.join(', '), 'error');
      } else {
        status(ok ? t('dnd.moved', { count: ok }) : t('dnd.movedNone'));
      }
    } else if (dropKind === 'quickAccess' && isDir && paths[0]) {
      store.addCustomQuickAccess(name, paths[0]);
      status(t('dnd.qaAdded', { name }));
    } else if (dropKind === 'tag' && dropPath) {
      const tagId = dropPath;
      const tagInfo = getTagInfo(tagId);
      const tagLabel = t(tagInfo.labelKey) || tagId;
      const fileTags = { ...(store.get('fileTags') || {}) };
      let changed = 0;
      for (const p of paths) {
        if (!p) continue;
        const current = fileTags[p] || [];
        if (!current.includes(tagId)) {
          fileTags[p] = [...current, tagId];
          changed++;
        }
      }
      if (changed > 0) {
        store.setState({ fileTags });
        toast(t('dnd.taggedFiles', { count: changed, tag: tagLabel }), 'success');
      }
      status(t('dnd.taggedFiles', { count: paths.length, tag: tagLabel }));
    } else {
      status(t('dnd.cancelHint'));
    }
  } catch (err) {
    console.error('[dnd]', err);
    status(t('dnd.moveFailed'));
    toast(t('dnd.moveFailed') + ': ' + err, 'error');
  }
}

function cancel() {
  if (!drag) return;
  const was = drag.active;
  finishUi();
  drag = null;
  if (was) status(t('dnd.cancelled'));
}

function finishUi() {
  document.documentElement.classList.remove('is-dragging');
  document.body.classList.remove('is-dragging');
  if (drag?.ghost?.parentNode) drag.ghost.remove();
  document.querySelectorAll('.file-row.dragging').forEach((r) => r.classList.remove('dragging'));
  clearHl();
}

function clearHl() {
  document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
}

function status(msg) {
  const el = document.getElementById('status-selection');
  if (el) el.textContent = msg;
}

function short(p) {
  if (!p) return '';
  return p.length > 48 ? '…' + p.slice(-46) : p;
}

// ─── External OS Drag & Drop (Windows Desktop / Explorer) ─────────────────────

function initExternalDnd() {
  let appWindow = null;
  try {
    appWindow = getCurrentWindow();
  } catch {
    // browser mode fallback
  }

  // 1. Native Tauri OS drag & drop event listener
  if (appWindow && typeof appWindow.onDragDropEvent === 'function') {
    try {
      appWindow.onDragDropEvent(async (event) => {
        const payload = event.payload;
        if (!payload) return;

        const dpr = window.devicePixelRatio || 1;

        if (payload.type === 'over' || payload.type === 'hover') {
          const { x, y } = payload.position || { x: 0, y: 0 };
          hitTestExternal(x / dpr, y / dpr);
        } else if (payload.type === 'drop') {
          clearHl();
          const { paths, position } = payload;
          if (!paths || !paths.length) return;
          const { x, y } = position || { x: 0, y: 0 };
          await handleExternalDrop(paths, x / dpr, y / dpr);
        } else if (payload.type === 'leave' || payload.type === 'cancel') {
          clearHl();
          status('');
        }
      });
      console.log('[dnd] Registered Tauri native onDragDropEvent listener');
    } catch (err) {
      console.warn('[dnd] onDragDropEvent registration failed:', err);
    }
  }

  // 2. Webview HTML5 dragover & drop fallback
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    hitTestExternal(e.clientX, e.clientY);
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) {
      clearHl();
      status('');
    }
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    clearHl();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      const paths = [];
      for (const file of e.dataTransfer.files) {
        if (file.path) paths.push(file.path);
      }
      if (paths.length) {
        await handleExternalDrop(paths, e.clientX, e.clientY);
      }
    }
  });
}

function hitTestExternal(x, y) {
  clearHl();
  const el = document.elementFromPoint(x, y);
  if (!el) return;

  // 1. Tag target in sidebar
  const tagEl = el.closest?.('.sidebar-tag-item[data-tag-id]');
  if (tagEl?.dataset.tagId) {
    tagEl.classList.add('drag-over');
    const tagInfo = getTagInfo(tagEl.dataset.tagId);
    const tagLabel = t(tagInfo.labelKey) || tagEl.dataset.tagId;
    status(`釋放以為項目套用標籤：🏷️ ${tagLabel}`);
    return;
  }

  // 2. Folder row in file list
  const folder = el.closest?.('.file-row.is-dir');
  if (folder?.dataset.path) {
    folder.classList.add('drag-over');
    status(`釋放以複製到：${short(folder.dataset.path)}`);
    return;
  }

  // 3. Navigation item in sidebar (Quick access, drive, folder)
  const nav = el.closest?.('.sidebar-item[data-path], .sidebar-drive[data-path]');
  if (nav?.dataset.path && !nav.dataset.path.startsWith('nexus://')) {
    nav.classList.add('drag-over');
    status(`釋放以複製到：${short(nav.dataset.path)}`);
    return;
  }

  // 4. Secondary dual-pane area
  const sec = el.closest?.('#file-list-secondary, .secondary-list');
  if (sec) {
    const secPath = store.get('secondaryPath');
    if (secPath && !secPath.startsWith('nexus://')) {
      sec.classList.add('drag-over');
      status(`釋放以複製到：${short(secPath)}`);
      return;
    }
  }

  // 5. Active directory container
  const cur = store.get('currentPath');
  if (cur && !cur.startsWith('nexus://')) {
    const container = document.getElementById('file-list-container');
    if (container && (container.contains(el) || el === container)) {
      container.classList.add('drag-over');
    }
    status(`釋放以複製到目前資料夾：${short(cur)}`);
  }
}

async function handleExternalDrop(paths, x, y) {
  clearHl();
  const el = document.elementFromPoint(x, y);

  // 1. Tag target in sidebar
  const tagEl = el?.closest?.('.sidebar-tag-item[data-tag-id]');
  if (tagEl?.dataset.tagId) {
    const tagId = tagEl.dataset.tagId;
    const tagInfo = getTagInfo(tagId);
    const tagLabel = t(tagInfo.labelKey) || tagId;
    const fileTags = { ...(store.get('fileTags') || {}) };
    let changed = 0;
    for (const p of paths) {
      const cur = fileTags[p] || [];
      if (!cur.includes(tagId)) {
        fileTags[p] = [...cur, tagId];
        changed++;
      }
    }
    if (changed > 0) {
      store.setState({ fileTags });
      status(`已為 ${paths.length} 個項目套用標籤：🏷️ ${tagLabel}`);
      toast(`已套用標籤：${tagLabel}`, 'success');
    } else {
      toast(`項目已包含標籤：${tagLabel}`, 'info');
    }
    return;
  }

  let dest = null;

  const folder = el?.closest?.('.file-row.is-dir');
  if (folder?.dataset.path) {
    dest = folder.dataset.path;
  } else {
    const nav = el?.closest?.('.sidebar-item[data-path], .sidebar-drive[data-path]');
    if (nav?.dataset.path && !nav.dataset.path.startsWith('nexus://')) {
      dest = nav.dataset.path;
    } else if (el?.closest?.('#file-list-secondary, .secondary-list')) {
      const secPath = store.get('secondaryPath');
      if (secPath && !secPath.startsWith('nexus://')) dest = secPath;
    }
  }

  if (!dest) {
    dest = store.get('currentPath');
  }

  if (!dest || dest.startsWith('nexus://')) {
    toast('無法複製到此位置，請先開啟實際資料夾', 'warning');
    return;
  }

  status(`正在複製 ${paths.length} 個項目至 ${short(dest)}...`);
  let ok = 0;
  const errs = [];

  for (const p of paths) {
    try {
      console.log('[external dnd] copy', p, '->', dest);
      await copyPath(p, dest, false);
      ok++;
    } catch (err) {
      console.error('[external dnd] copy failed', p, err);
      errs.push(`${p}: ${err}`);
    }
  }

  await refreshCurrent();
  if (errs.length) {
    status(`複製完成：${ok} 成功，${errs.length} 失敗`);
    toast(`已複製 ${ok} 個項目，${errs.length} 個失敗`, 'error');
  } else {
    status(`已成功複製 ${ok} 個項目至 ${short(dest)}`);
    toast(`已複製 ${ok} 個項目至 ${short(dest)}`, 'success');
  }
}
