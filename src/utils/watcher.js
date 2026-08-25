/**
 * Nexus Files — Current-directory watcher bridge
 * Watches exactly one directory (the active one) via notify on the Rust side.
 * Refreshes are debounced; changes seen while unfocused are queued and
 * applied when the window regains focus — zero polling, zero cost
 * beyond a single watch handle.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import store from '../store/store.js';
import { refreshCurrent } from './tauri-bridge.js';

const DEBOUNCE_MS = 400;

let focused = true;
let watchedPath = null;
let debounceTimer = null;
let pendingWhileUnfocused = false;

async function tryRefresh() {
  const current = store.get('currentPath');
  if (current && current === watchedPath) {
    await refreshCurrent();
  }
}

async function syncWatch(path) {
  pendingWhileUnfocused = false;
  if (!path || path.startsWith('nexus://')) {
    await unwatch();
    return;
  }
  if (path === watchedPath) return;
  try {
    await invoke('watch_directory', { path });
    watchedPath = path;
  } catch (err) {
    // Network/unreadable folders — keep manual F5 as the fallback.
    console.warn('[watcher]', err);
    watchedPath = null;
  }
}

async function unwatch() {
  if (!watchedPath) return;
  watchedPath = null;
  try {
    await invoke('unwatch_directory');
  } catch { /* already dropped */ }
}

export async function initWatcher() {
  try {
    const unlistenFocus = await getCurrentWindow().onFocusChanged(async ({ payload: isFocused }) => {
      focused = isFocused;
      if (isFocused && pendingWhileUnfocused) {
        pendingWhileUnfocused = false;
        await tryRefresh();
      }
    });
    // Keep the handler alive for the app lifetime; call unlisten on cleanup if ever needed.
    void unlistenFocus;
  } catch (err) {
    console.warn('[watcher] focus tracking unavailable', err);
  }

  await listen('fs-change', () => {
    if (!focused) {
      pendingWhileUnfocused = true;
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      await tryRefresh();
    }, DEBOUNCE_MS);
  });

  store.subscribe('currentPath', (path) => syncWatch(path));
  if (store.get('currentPath')) syncWatch(store.get('currentPath'));
}

