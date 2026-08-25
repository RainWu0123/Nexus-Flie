/**
 * Nexus Files — Dual Pane (secondary browser)
 * Independent path/list for side-by-side browsing; drag files across panes.
 */
import { invoke } from '@tauri-apps/api/core';
import store from '../store/store.js';
import { navigateTo, movePath, refreshCurrent } from '../utils/tauri-bridge.js';
import { formatFileSize, fileIconEl, icon, ICONS, isArchiveFile } from '../utils/helpers.js';
import { t } from '../i18n/index.js';

let secondaryPath = '';
let secondaryFiles = [];

export function initDualPane() {
  const root = document.getElementById('file-list-secondary');
  const list = document.getElementById('secondary-list');
  if (!root || !list) return;

  store.subscribe('isDualPane', async (on) => {
    document.getElementById('content-area')?.classList.toggle('dual-pane', !!on);
    if (on) {
      const path = store.get('currentPath') || secondaryPath;
      if (path && !path.startsWith('nexus://')) {
        await loadSecondary(path);
      }
    }
  });

  // When primary navigates and secondary empty, seed it
  store.subscribe('currentPath', async (path) => {
    if (!store.get('isDualPane')) return;
    if (!secondaryPath && path && !path.startsWith('nexus://')) {
      await loadSecondary(path);
    }
  });

  // Drop onto secondary pane → move into secondary folder
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    list.classList.add('drag-over');
  });
  list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
  list.addEventListener('drop', async (e) => {
    e.preventDefault();
    list.classList.remove('drag-over');
    if (!secondaryPath) return;
    try {
      const json = e.dataTransfer.getData('application/json');
      const paths = json ? JSON.parse(json) : [e.dataTransfer.getData('text/plain')];
      for (const p of paths) {
        if (p && p !== secondaryPath) await movePath(p, secondaryPath);
      }
      await refreshCurrent();
      await loadSecondary(secondaryPath);
    } catch (err) {
      console.error(err);
      alert(String(err));
    }
  });

  if (store.get('isDualPane')) {
    document.getElementById('content-area')?.classList.add('dual-pane');
  }
}

async function loadSecondary(path) {
  secondaryPath = path;
  store.setState({ secondaryPath: path });
  const label = document.getElementById('secondary-path-label');
  if (label) label.textContent = path;

  const list = document.getElementById('secondary-list');
  if (!list) return;
  list.innerHTML = `<div class="file-list-loading"><div class="spinner"></div></div>`;

  try {
    if (path.startsWith('archive://') || path.startsWith('zip://')) {
      const protocol = path.startsWith('archive://') ? 'archive://' : 'zip://';
      const raw = path.slice(protocol.length);
      const qIdx = raw.indexOf('?entry=');
      let archivePath = raw;
      let internalPath = '';
      if (qIdx >= 0) {
        archivePath = raw.slice(0, qIdx);
        internalPath = decodeURIComponent(raw.slice(qIdx + '?entry='.length));
      }
      secondaryFiles = await invoke('read_archive_directory', { archivePath, internalPath });
    } else if (isArchiveFile(path)) {
      secondaryFiles = await invoke('read_archive_directory', { archivePath: path, internalPath: '' });
    } else {
      secondaryFiles = await invoke('read_directory', { path });
    }
    store.setState({ secondaryFiles });
    renderSecondary();
  } catch (err) {
    list.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'file-list-empty';
    empty.textContent = String(err);
    list.appendChild(empty);
  }
}

function renderSecondary() {
  const list = document.getElementById('secondary-list');
  if (!list) return;
  list.innerHTML = '';
  const showHidden = store.get('showHidden');
  const files = (secondaryFiles || []).filter(f => showHidden || !f.isHidden);

  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'file-list-empty';
    empty.appendChild(icon(ICONS.folder, 'icon'));
    const span = document.createElement('span');
    span.textContent = t('fileList.empty');
    empty.appendChild(span);
    list.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const file of files) {
    const row = document.createElement('div');
    row.className = `file-row ${file.isDir ? 'is-dir' : 'is-file'}`;
    row.dataset.path = file.path;
    row.draggable = true;

    row.addEventListener('dragstart', (e) => {
      try {
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('text/plain', file.path);
        e.dataTransfer.setData('text/uri-list', file.path);
        e.dataTransfer.setData('application/json', JSON.stringify([file.path]));
        e.dataTransfer.setData('application/x-nexus-isdir', file.isDir ? 'true' : 'false');
      } catch (err) {
        console.warn('[dual-pane dragstart]', err);
      }
      row.classList.add('dragging');
      document.body.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
    });

    if (file.isDir) {
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', (e) => {
        if (!row.contains(e.relatedTarget)) row.classList.remove('drag-over');
      });
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove('drag-over');
        try {
          let paths = [];
          try { paths = JSON.parse(e.dataTransfer.getData('application/json') || '[]'); } catch { /* */ }
          if (!paths.length) {
            const p = e.dataTransfer.getData('text/plain');
            if (p) paths = [p];
          }
          for (const p of paths) {
            if (p && p !== file.path) await movePath(p, file.path);
          }
          await loadSecondary(secondaryPath);
          await refreshCurrent();
        } catch (err) {
          console.error(err);
          alert(String(err));
        }
      });
    }

    const nameCell = document.createElement('div');
    nameCell.className = 'file-name';
    nameCell.appendChild(fileIconEl(file));
    const nameText = document.createElement('span');
    nameText.className = 'file-name-text';
    nameText.textContent = file.name;
    nameCell.appendChild(nameText);
    row.appendChild(nameCell);

    const sizeCell = document.createElement('div');
    sizeCell.className = 'file-size';
    sizeCell.textContent = file.isDir ? '—' : formatFileSize(file.size);
    row.appendChild(sizeCell);

    row.addEventListener('dblclick', async () => {
      if (file.isDir || isArchiveFile(file.name) || file.path.startsWith('archive://') || file.path.startsWith('zip://')) {
        await loadSecondary(file.path);
      } else {
        await invoke('open_file', { path: file.path });
      }
    });

    // Open folder in primary pane via context
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (file.isDir || isArchiveFile(file.name)) navigateTo(file.path);
    });

    fragment.appendChild(row);
  }
  list.appendChild(fragment);
}

export function getSecondaryPath() {
  return secondaryPath;
}
