/**
 * Clipboard cut/copy/paste — zero idle cost; only runs on user action.
 */
import store from '../store/store.js';
import { movePath, copyPath, refreshCurrent, deletePath, extractArchiveEntries, setClipboardFiles } from './tauri-bridge.js';
import { toast, statusMsg } from './toast.js';
import { t } from '../i18n/index.js';
import { showConfirmDialog } from './modal.js';
import { undoManager } from './undo-manager.js';

export function cutSelection() {
  const { selectedFiles } = store.getState();
  if (!selectedFiles.size) return false;
  const paths = [...selectedFiles];
  store.setState({ clipboard: { paths, mode: 'cut' } });
  syncCutClass(paths);
  setClipboardFiles(paths, true);
  statusMsg(t('clip.cut', { count: paths.length }));
  toast(t('clip.cut', { count: paths.length }), 'info');
  return true;
}

export function copySelection() {
  const { selectedFiles } = store.getState();
  if (!selectedFiles.size) return false;
  const paths = [...selectedFiles];
  store.setState({ clipboard: { paths, mode: 'copy' } });
  syncCutClass([]);
  setClipboardFiles(paths, false);
  statusMsg(t('clip.copy', { count: paths.length }));
  toast(t('clip.copy', { count: paths.length }), 'info');
  return true;
}

function syncCutClass(paths) {
  const set = new Set(paths);
  document.querySelectorAll('.file-row').forEach((row) => {
    row.classList.toggle('is-cut', set.has(row.dataset.path));
  });
}

function parseArchiveVirtualPath(url) {
  if (!url || !url.startsWith('archive://')) return null;
  const raw = url.slice('archive://'.length);
  const idx = raw.indexOf('?entry=');
  if (idx === -1) {
    return { archivePath: raw, entry: '' };
  }
  return {
    archivePath: raw.slice(0, idx),
    entry: raw.slice(idx + '?entry='.length),
  };
}

export async function pasteClipboard() {
  const { clipboard, currentPath } = store.getState();
  if (!clipboard?.paths?.length || !currentPath || currentPath.startsWith('nexus://')) {
    return false;
  }

  const mode = clipboard.mode;
  statusMsg(mode === 'cut' ? t('clip.moving') : t('clip.copying'));
  let ok = 0;
  let fail = 0;
  const movedItems = [];
  const copiedPaths = [];

  // Group archive items vs physical file items
  const archiveGroups = new Map(); // archivePath -> entry[]
  const regularPaths = [];

  for (const src of clipboard.paths) {
    if (!src) continue;
    const arch = parseArchiveVirtualPath(src);
    if (arch) {
      if (!archiveGroups.has(arch.archivePath)) {
        archiveGroups.set(arch.archivePath, []);
      }
      archiveGroups.get(arch.archivePath).push(arch.entry);
    } else {
      regularPaths.push(src);
    }
  }

  // 1. Handle archive entry extraction to current directory
  for (const [archivePath, entries] of archiveGroups.entries()) {
    try {
      const extracted = await extractArchiveEntries(archivePath, entries, currentPath);
      if (extracted && extracted.length > 0) {
        ok += extracted.length;
        copiedPaths.push(...extracted);
      } else {
        ok += entries.length;
      }
    } catch (err) {
      console.warn('[paste archive entry]', archivePath, entries, err);
      fail += entries.length;
    }
  }

  // 2. Handle regular physical files
  for (const src of regularPaths) {
    if (src === currentPath) continue;
    if (currentPath.startsWith(src + '\\') || currentPath.startsWith(src + '/')) {
      fail++;
      continue;
    }
    const name = src.replace(/^.*[/\\]/, '');
    const dest = `${currentPath.replace(/[/\\]$/, '')}\\${name}`;
    try {
      const result = mode === 'copy'
        ? await copyInto(src, currentPath)
        : await moveInto(src, currentPath);
      if (result === 'ok') {
        ok++;
        if (mode === 'cut') {
          movedItems.push({ from: src, to: dest });
        } else {
          copiedPaths.push(dest);
        }
      }
    } catch (err) {
      console.warn('[paste]', src, err);
      fail++;
    }
  }

  if (mode === 'cut' && regularPaths.length > 0) {
    store.setState({ clipboard: null, selectedFiles: new Set() });
    syncCutClass([]);
    if (movedItems.length > 0) {
      undoManager.recordMove(movedItems);
    }
  } else if (copiedPaths.length > 0) {
    undoManager.recordCopy(copiedPaths);
  }

  await refreshCurrent();

  // If items were extracted or copied, select them
  if (copiedPaths.length > 0) {
    store.setState({ selectedFiles: new Set(copiedPaths) });
  }

  if (fail && ok) {
    toast(t('clip.partial', { ok, fail }), 'error', 4000);
  } else if (fail && !ok) {
    toast(t('clip.failed'), 'error');
  } else {
    toast(mode === 'cut' ? t('clip.moved', { count: ok }) : t('clip.copied', { count: ok }), 'success');
  }
  statusMsg(ok ? (mode === 'cut' ? t('clip.moved', { count: ok }) : t('clip.copied', { count: ok })) : '');
  return true;
}

/** @returns {Promise<'ok'|'skip'>} */
async function copyInto(src, destDir) {
  try {
    await copyPath(src, destDir, false);
    return 'ok';
  } catch (err) {
    if (!/already exists/i.test(String(err))) throw err;
    const name = src.replace(/^.*[/\\]/, '');
    const ok = await showConfirmDialog({
      title: t('clip.conflict', { name }),
      message: `${t('clip.overwrite')} / ${t('clip.skip')}`,
      confirmText: t('clip.overwrite') || '覆寫',
      cancelText: t('clip.skip') || '略過',
    });
    if (!ok) return 'skip';
    await copyPath(src, destDir, true);
    return 'ok';
  }
}

/** @returns {Promise<'ok'|'skip'>} */
async function moveInto(src, destDir) {
  try {
    await movePath(src, destDir);
    return 'ok';
  } catch (err) {
    if (!/already exists/i.test(String(err))) throw err;
    const name = src.replace(/^.*[/\\]/, '');
    const ok = await showConfirmDialog({
      title: t('clip.conflict', { name }),
      message: `${t('clip.overwrite')} / ${t('clip.skip')}`,
      confirmText: t('clip.overwrite') || '覆寫',
      cancelText: t('clip.skip') || '略過',
    });
    if (!ok) return 'skip';
    await copyPath(src, destDir, true);
    await deletePath(src);
    return 'ok';
  }
}
