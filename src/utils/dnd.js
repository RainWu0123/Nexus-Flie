/**
 * Nexus Files — Internal drag & drop
 * Pure mouse tracking on window (capture). Does not use HTML5 DnD.
 */
import store from '../store/store.js';
import { movePath, refreshCurrent } from './tauri-bridge.js';
import { t } from '../i18n/index.js';

const THRESHOLD_PX = 5;

let drag = null; // pending or active gesture
let bound = false;

export function initDnd() {
  if (bound) return;
  bound = true;

  // Use window + capture so we always see events, even after list re-renders
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('blur', () => cancel());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel();
  });

  console.log('[dnd] initialized');
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
  if (nav?.dataset.path && !nav.dataset.path.startsWith('nexus://')) {
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
        alert(t('dnd.moveFailed') + '\n' + errs.join('\n'));
      } else {
        status(ok ? t('dnd.moved', { count: ok }) : t('dnd.movedNone'));
      }
    } else if (dropKind === 'quickAccess' && isDir && paths[0]) {
      store.addCustomQuickAccess(name, paths[0]);
      status(t('dnd.qaAdded', { name }));
    } else {
      status(t('dnd.cancelHint'));
    }
  } catch (err) {
    console.error('[dnd]', err);
    status(t('dnd.moveFailed'));
    alert(t('dnd.moveFailed') + ': ' + err);
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
