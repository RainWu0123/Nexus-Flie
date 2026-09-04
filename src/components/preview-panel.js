/**
 * Nexus Files — Preview Panel Component
 * Image previews and file info for selected files.
 */
import { invoke } from '@tauri-apps/api/core';
import store from '../store/store.js';
import { formatFileSize, formatDate, icon, ICONS, fileIconEl, DEFAULT_TAGS, getAllTags, createTagDot } from '../utils/helpers.js';
import { readTextPreview, getThumbnailBase64, trimMemory } from '../utils/tauri-bridge.js';
import { t } from '../i18n/index.js';
import { showTagDialog } from '../utils/modal.js';

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
const MAX_CACHE = 6;

let panelEl = null;
let isOpen = false;
let currentPreviewPath = null;
let thumbnailObserver = null;
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

export function disconnectThumbnailObserver() {
  if (thumbnailObserver) {
    thumbnailObserver.disconnect();
    thumbnailObserver = null;
  }
}

export function initPreviewPanel() {
  panelEl = document.getElementById('preview-panel');
  if (!panelEl) return;

  renderClosedState();
  store.subscribe('selectedFiles', () => onSelectionChange());
  store.subscribe('fileTags', () => {
    if (!isOpen || !currentPreviewPath) return;
    updatePreviewTagsUi(currentPreviewPath);
  });
  store.subscribe('viewMode', () => {
    if (store.get('viewMode') === 'grid') closePreview();
  });
  store.subscribe('currentPath', () => {
    previewCache.clear();
    disconnectThumbnailObserver();
    currentPreviewPath = null;
    if (isOpen) renderClosedState();
    isOpen = false;
    // Trim memory after folder navigation
    setTimeout(() => trimMemory(), 1000);
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

  panelEl.append(header, info, renderTagsSection(file));
}

function renderTagsSection(file) {
  const section = document.createElement('div');
  section.className = 'preview-tags-section';

  const header = document.createElement('div');
  header.className = 'preview-tags-header';
  header.appendChild(icon(ICONS.tag, 'icon-sm'));
  const title = document.createElement('span');
  title.textContent = t('preview.tags');
  header.appendChild(title);
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'preview-tags-list';

  const fileTags = store.get('fileTags') || {};
  const activeTags = new Set(fileTags[file.path] || []);

  const allTags = getAllTags();
  allTags.forEach(tag => {
    const isTagged = activeTags.has(tag.id);
    const btn = document.createElement('button');
    btn.className = `preview-tag-btn${isTagged ? ' active' : ''}`;
    btn.dataset.tagId = tag.id;
    btn.style.setProperty('--tag-color', tag.color);
    btn.style.setProperty('--tag-bg', tag.bg || `${tag.color}1f`);
    btn.style.setProperty('--tag-border', tag.border || `${tag.color}40`);

    const dot = createTagDot(tag.id);

    const check = document.createElement('span');
    check.className = 'preview-tag-check';
    check.textContent = '✓';

    const lbl = document.createElement('span');
    lbl.textContent = t(tag.labelKey) || tag.name || tag.id;

    btn.append(dot, check, lbl);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.toggleFileTag(file.path, tag.id);
      const updated = new Set((store.get('fileTags') || {})[file.path] || []);
      btn.classList.toggle('active', updated.has(tag.id));
    });
    list.appendChild(btn);
  });

  // Add tag quick button
  const addBtn = document.createElement('button');
  addBtn.className = 'preview-tag-btn';
  addBtn.style.borderStyle = 'dashed';
  addBtn.appendChild(icon(ICONS.plus, 'icon-sm'));
  const addLbl = document.createElement('span');
  addLbl.textContent = t('tags.addTag') || '新增標籤';
  addBtn.appendChild(addLbl);
  addBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const res = await showTagDialog();
    if (res && res.name) {
      const newTag = store.addTag(res, DEFAULT_TAGS);
      store.toggleFileTag(file.path, newTag.id);
      if (file) renderFileInfo(file);
    }
  });
  list.appendChild(addBtn);

  section.appendChild(list);
  return section;
}

function updatePreviewTagsUi(path) {
  if (!panelEl) return;
  const fileTags = store.get('fileTags') || {};
  const activeTags = new Set(fileTags[path] || []);
  panelEl.querySelectorAll('.preview-tag-btn').forEach(btn => {
    const tagId = btn.dataset.tagId;
    if (tagId) {
      btn.classList.toggle('active', activeTags.has(tagId));
    }
  });
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

  panelEl.append(header, imgContainer, meta, renderTagsSection(file));

  try {
    let base64;
    let mime = 'image/jpeg';
    if (previewCache.has(file.path)) {
      base64 = previewCache.get(file.path);
    } else {
      try {
        base64 = await getThumbnailBase64(file.path, 800);
      } catch {
        base64 = await invoke('read_file_base64', { path: file.path });
        mime = mimeForExt(file.extension);
      }
      cacheSet(file.path, base64);
    }

    if (currentPreviewPath !== file.path) return;

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

  panelEl.append(header, codeWrap, meta, renderTagsSection(file));

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
 * Load thumbnails for image files in grid view using IntersectionObserver.
 * Only loads visible items, using downsampled 128x128 JPEG (~3KB) to minimize memory.
 */
export function loadGridThumbnails(container) {
  if (!container) return;
  disconnectThumbnailObserver();

  const rows = [...container.querySelectorAll('.file-row')];
  if (!rows.length) return;

  thumbnailObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const row = entry.target;
      thumbnailObserver.unobserve(row);

      const path = row.dataset.path;
      const iconEl = row.querySelector('.file-icon.image');
      if (!iconEl || !path) continue;
      const ext = (path.split('.').pop() || '').toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) continue;

      (async () => {
        try {
          let base64;
          if (previewCache.has(path)) {
            base64 = previewCache.get(path);
          } else {
            try {
              base64 = await getThumbnailBase64(path, 128);
            } catch {
              base64 = await invoke('read_file_base64', { path });
            }
            cacheSet(path, base64);
          }
          if (!iconEl.isConnected) return;
          const thumb = document.createElement('img');
          thumb.className = 'grid-thumbnail';
          thumb.src = `data:image/jpeg;base64,${base64}`;
          thumb.alt = '';
          thumb.loading = 'lazy';
          iconEl.replaceWith(thumb);
        } catch {
          // Keep SVG icon
        }
      })();
    }
  }, {
    root: container,
    rootMargin: '150px',
  });

  for (const row of rows) {
    const iconEl = row.querySelector('.file-icon.image');
    if (iconEl && row.dataset.path) {
      thumbnailObserver.observe(row);
    }
  }
}
