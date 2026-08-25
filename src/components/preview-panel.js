/**
 * Nexus Files — Preview Panel Component
 * Image previews and file info for selected files.
 */
import { invoke } from '@tauri-apps/api/core';
import store from '../store/store.js';
import { formatFileSize, formatDate, icon, ICONS, fileIconEl } from '../utils/helpers.js';
import { readTextPreview } from '../utils/tauri-bridge.js';
import { t } from '../i18n/index.js';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif', 'tiff'];
/** Text/code preview — rendered as plain text in a <pre>, capped at 256 KB on the Rust side. */
const TEXT_EXTENSIONS = [
  'txt', 'md', 'log', 'ini', 'cfg', 'conf', 'env', 'csv',
  'json', 'xml', 'yaml', 'yml', 'toml',
  'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'c', 'cpp', 'h', 'hpp', 'java',
  'rb', 'php', 'lua', 'pl', 'tex',
  'html', 'css', 'scss', 'sh', 'bat', 'ps1', 'vue', 'svelte', 'sql',
];
// Keep in sync with read_text_preview's CAP in src-tauri/src/commands/filesystem.rs
const TEXT_PREVIEW_CAP = 256 * 1024;
const MAX_CACHE = 40;

let panelEl = null;
let isOpen = false;
let currentPreviewPath = null;
/** @type {Map<string, string>} */
const previewCache = new Map();

function cacheSet(path, base64) {
  if (previewCache.has(path)) previewCache.delete(path);
  previewCache.set(path, base64);
  while (previewCache.size > MAX_CACHE) {
    const oldest = previewCache.keys().next().value;
    previewCache.delete(oldest);
  }
}

export function initPreviewPanel() {
  panelEl = document.getElementById('preview-panel');
  if (!panelEl) return;

  renderClosedState();
  store.subscribe('selectedFiles', () => onSelectionChange());
  store.subscribe('viewMode', () => {
    if (store.get('viewMode') === 'grid') closePreview();
  });
  store.subscribe('currentPath', () => {
    previewCache.clear();
    currentPreviewPath = null;
    if (isOpen) renderClosedState();
    isOpen = false;
  });
}

export function togglePreviewPanel() {
  if (isOpen) closePreview();
  else {
    isOpen = true;
    onSelectionChange();
  }
}

function closePreview() {
  isOpen = false;
  currentPreviewPath = null;
  renderClosedState();
}

function renderClosedState() {
  if (!panelEl) return;
  panelEl.classList.remove('open');
  panelEl.innerHTML = '';
}

async function onSelectionChange() {
  if (!isOpen || !panelEl) return;

  const { selectedFiles, files } = store.getState();
  if (selectedFiles.size !== 1) {
    renderNoPreview();
    return;
  }

  const selectedPath = [...selectedFiles][0];
  const file = files.find(f => f.path === selectedPath);
  if (!file || file.isDir) {
    renderNoPreview();
    return;
  }

  const ext = (file.extension || '').toLowerCase();
  if (TEXT_EXTENSIONS.includes(ext)) {
    if (currentPreviewPath === file.path) return;
    currentPreviewPath = file.path;
    await renderTextPreview(file);
    return;
  }
  if (!IMAGE_EXTENSIONS.includes(ext)) {
    renderFileInfo(file);
    return;
  }

  if (currentPreviewPath === file.path) return;
  currentPreviewPath = file.path;
  await renderImagePreview(file);
}

function renderNoPreview() {
  if (!panelEl) return;
  panelEl.classList.add('open');
  panelEl.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'preview-empty';
  empty.appendChild(icon(ICONS.eye, 'preview-empty-icon'));
  const span = document.createElement('span');
  span.textContent = t('preview.selectImage');
  empty.appendChild(span);
  panelEl.appendChild(empty);
}

function renderFileInfo(file) {
  if (!panelEl) return;
  panelEl.classList.add('open');
  panelEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'preview-header';
  const title = document.createElement('span');
  title.className = 'preview-title';
  title.textContent = t('preview.title');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'preview-close';
  closeBtn.appendChild(icon(ICONS.x, 'icon-sm'));
  closeBtn.addEventListener('click', closePreview);
  header.append(title, closeBtn);

  const info = document.createElement('div');
  info.className = 'preview-file-info';
  const iconWrap = document.createElement('div');
  iconWrap.className = 'preview-file-icon';
  iconWrap.appendChild(fileIconEl(file, 'preview-big-icon'));

  const meta = document.createElement('div');
  meta.className = 'preview-meta';
  const nameEl = document.createElement('div');
  nameEl.className = 'preview-filename';
  nameEl.textContent = file.name;
  const extEl = document.createElement('div');
  extEl.className = 'preview-detail';
  extEl.textContent = file.extension ? file.extension.toUpperCase() : '—';
  const sizeEl = document.createElement('div');
  sizeEl.className = 'preview-detail';
  sizeEl.textContent = formatFileSize(file.size);
  const dateEl = document.createElement('div');
  dateEl.className = 'preview-detail';
  dateEl.textContent = formatDate(file.modified);
  meta.append(nameEl, extEl, sizeEl, dateEl);
  info.append(iconWrap, meta);

  panelEl.append(header, info);
}

async function renderImagePreview(file) {
  if (!panelEl) return;
  panelEl.classList.add('open');
  panelEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'preview-header';
  const title = document.createElement('span');
  title.className = 'preview-title';
  title.textContent = t('preview.title');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'preview-close';
  closeBtn.appendChild(icon(ICONS.x, 'icon-sm'));
  closeBtn.addEventListener('click', closePreview);
  header.append(title, closeBtn);

  const imgContainer = document.createElement('div');
  imgContainer.className = 'preview-image-container';
  const loading = document.createElement('div');
  loading.className = 'preview-loading';
  loading.innerHTML = '<div class="spinner"></div>';
  imgContainer.appendChild(loading);

  const meta = document.createElement('div');
  meta.className = 'preview-meta';
  const nameEl = document.createElement('div');
  nameEl.className = 'preview-filename';
  nameEl.textContent = file.name;
  const detailEl = document.createElement('div');
  detailEl.className = 'preview-detail';
  detailEl.textContent = `${file.extension ? file.extension.toUpperCase() : '—'} · ${formatFileSize(file.size)}`;
  const dateEl = document.createElement('div');
  dateEl.className = 'preview-detail';
  dateEl.textContent = formatDate(file.modified);
  meta.append(nameEl, detailEl, dateEl);

  panelEl.append(header, imgContainer, meta);

  try {
    let base64;
    if (previewCache.has(file.path)) {
      base64 = previewCache.get(file.path);
    } else {
      base64 = await invoke('read_file_base64', { path: file.path });
      cacheSet(file.path, base64);
    }

    if (currentPreviewPath !== file.path) return;

    const mime = mimeForExt(file.extension);
    imgContainer.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'preview-image';
    img.src = `data:${mime};base64,${base64}`;
    img.alt = file.name;
    img.loading = 'lazy';
    img.addEventListener('click', () => {
      invoke('open_file', { path: file.path }).catch(console.error);
    });
    imgContainer.appendChild(img);
  } catch (e) {
    console.warn('[Preview] Failed to load image:', e);
    imgContainer.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'preview-error';
    err.appendChild(icon(ICONS.image, 'preview-empty-icon'));
    const span = document.createElement('span');
    span.textContent = t('preview.loadFailed');
    err.appendChild(span);
    imgContainer.appendChild(err);
  }
}

function mimeForExt(ext) {
  const e = (ext || '').toLowerCase();
  const mimeMap = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp',
    svg: 'image/svg+xml', ico: 'image/x-icon',
    avif: 'image/avif', tiff: 'image/tiff',
  };
  return mimeMap[e] || 'image/png';
}

async function renderTextPreview(file) {
  if (!panelEl) return;
  panelEl.classList.add('open');
  panelEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'preview-header';
  const title = document.createElement('span');
  title.className = 'preview-title';
  title.textContent = t('preview.title');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'preview-close';
  closeBtn.appendChild(icon(ICONS.x, 'icon-sm'));
  closeBtn.addEventListener('click', closePreview);
  header.append(title, closeBtn);

  const codeWrap = document.createElement('div');
  codeWrap.className = 'preview-text-wrap';
  const loading = document.createElement('div');
  loading.className = 'preview-loading';
  loading.innerHTML = '<div class="spinner"></div>';
  codeWrap.appendChild(loading);

  const meta = document.createElement('div');
  meta.className = 'preview-meta';
  const nameEl = document.createElement('div');
  nameEl.className = 'preview-filename';
  nameEl.textContent = file.name;
  const detailEl = document.createElement('div');
  detailEl.className = 'preview-detail';
  detailEl.textContent = `${file.extension ? file.extension.toUpperCase() : '—'} · ${formatFileSize(file.size)}`;
  const dateEl = document.createElement('div');
  dateEl.className = 'preview-detail';
  dateEl.textContent = formatDate(file.modified);
  meta.append(nameEl, detailEl, dateEl);

  panelEl.append(header, codeWrap, meta);

  try {
    const text = await readTextPreview(file.path);
    if (currentPreviewPath !== file.path) return;
    codeWrap.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'preview-text';
    pre.textContent = file.size > TEXT_PREVIEW_CAP ? text + '\n\n— ' + t('preview.truncated') + ' —' : text;
    codeWrap.appendChild(pre);
  } catch (e) {
    console.warn('[Preview] Failed to load text:', e);
    codeWrap.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'preview-error';
    err.appendChild(icon(ICONS.file, 'preview-empty-icon'));
    const span = document.createElement('span');
    span.textContent = t('preview.loadFailed');
    err.appendChild(span);
    codeWrap.appendChild(err);
  }
}

/**
 * Load thumbnails for image files in grid view (parallel, concurrency-limited).
 */
export async function loadGridThumbnails(container) {
  const rows = [...container.querySelectorAll('.file-row')];
  const jobs = [];

  for (const row of rows) {
    const path = row.dataset.path;
    const iconEl = row.querySelector('.file-icon.image');
    if (!iconEl || !path) continue;
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) continue;
    jobs.push({ row, path, iconEl, ext });
  }

  const CONCURRENCY = 6;
  let i = 0;

  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      try {
        let base64;
        if (previewCache.has(job.path)) {
          base64 = previewCache.get(job.path);
        } else {
          base64 = await invoke('read_file_base64', { path: job.path });
          cacheSet(job.path, base64);
        }
        // Row may have been re-rendered
        if (!job.iconEl.isConnected) continue;
        const thumb = document.createElement('img');
        thumb.className = 'grid-thumbnail';
        thumb.src = `data:${mimeForExt(job.ext)};base64,${base64}`;
        thumb.alt = '';
        thumb.loading = 'lazy';
        job.iconEl.replaceWith(thumb);
      } catch {
        // keep SVG icon
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()));
}
