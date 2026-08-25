/**
 * Clipboard cut/copy/paste — zero idle cost; only runs on user action.
 */
import store from '../store/store.js';
import { movePath, copyPath, refreshCurrent, deletePath } from './tauri-bridge.js';
import { toast, statusMsg } from './toast.js';
import { t } from '../i18n/index.js';

export function cutSelection() {
  const { selectedFiles } = store.getState();
  if (!selectedFiles.size) return false;
  const paths = [...selectedFiles];
  store.setState({ clipboard: { paths, mode: 'cut' } });
  syncCutClass(paths);
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

export async function pasteClipboard() {
  const { clipboard, currentPath } = store.getState();
  if (!clipboard?.paths?.length || !currentPath || currentPath.startsWith('nexus://')) {
    return false;
  }

  const mode = clipboard.mode;
  statusMsg(mode === 'cut' ? t('clip.moving') : t('clip.copying'));
  let ok = 0;
  let fail = 0;

  for (const src of clipboard.paths) {
    if (!src || src === currentPath) continue;
    if (currentPath.startsWith(src + '\\') || currentPath.startsWith(src + '/')) {
      fail++;
      continue;
    }
    try {
      const result = mode === 'copy'
        ? await copyInto(src, currentPath)
        : await moveInto(src, currentPath);
      if (result === 'ok') ok++;
    } catch (err) {
      console.warn('[paste]', src, err);
      fail++;
    }
  }

  if (mode === 'cut') {
    store.setState({ clipboard: null, selectedFiles: new Set() });
    syncCutClass([]);
  }

  await refreshCurrent();

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
    if (!confirm(t('clip.conflict', { name }) + '\n\nOK = ' + t('clip.overwrite') + '\nCancel = ' + t('clip.skip'))) {
      return 'skip';
    }
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
    if (!confirm(t('clip.conflict', { name }) + '\n\nOK = ' + t('clip.overwrite') + '\nCancel = ' + t('clip.skip'))) {
      return 'skip';
    }
    await copyPath(src, destDir, true);
    await deletePath(src);
    return 'ok';
  }
}
