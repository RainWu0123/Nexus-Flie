/**
 * Nexus Files — Sidebar Component
 * Glassmorphism navigation panel with quick access, drives, and tags.
 */
import store from '../store/store.js';
import { navigateTo, getDrives } from '../utils/tauri-bridge.js';
import { icon, ICONS, DEFAULT_TAGS, formatFileSize } from '../utils/helpers.js';
import { t, onLocaleChange } from '../i18n/index.js';

const QUICK_ACCESS = [
  { id: 'home', labelKey: 'sidebar.home', icon: ICONS.home, folderId: null },
  { id: 'desktop', labelKey: 'sidebar.desktop', icon: ICONS.desktop, folderId: 'desktop' },
  { id: 'documents', labelKey: 'sidebar.documents', icon: ICONS.document, folderId: 'documents' },
  { id: 'downloads', labelKey: 'sidebar.downloads', icon: ICONS.download, folderId: 'downloads' },
  { id: 'pictures', labelKey: 'sidebar.pictures', icon: ICONS.image, folderId: 'pictures' },
  { id: 'music', labelKey: 'sidebar.music', icon: ICONS.music, folderId: 'music' },
  { id: 'videos', labelKey: 'sidebar.videos', icon: ICONS.video, folderId: 'videos' },
];

let homeDir = '';
let knownFolders = {};

export function initSidebar() {
  const el = document.getElementById('sidebar');
  if (!el) return;

  const width = store.get('sidebarWidth');
  if (width) el.style.width = width + 'px';

  render(el);
  store.subscribe('currentPath', () => highlightActive(el));
  store.subscribe(['customQuickAccess', 'fileTags', 'recentFolders'], () => render(el));
  onLocaleChange(() => render(el));
  initResizeHandle();
}

function resolvePath(item) {
  if (!item.folderId) return homeDir;
  if (knownFolders[item.folderId]) return knownFolders[item.folderId];
  const name = item.folderId.charAt(0).toUpperCase() + item.folderId.slice(1);
  return homeDir ? `${homeDir}\\${name}` : '';
}

function render(el) {
  el.innerHTML = '';

  // Quick Access
  const qaSection = createSection(t('sidebar.quickAccess'));
  const qaList = document.createElement('div');
  qaList.className = 'sidebar-qa-list';

  qaList.addEventListener('dragover', (e) => {
    e.preventDefault();
    qaList.classList.add('drag-over');
  });
  qaList.addEventListener('dragleave', () => qaList.classList.remove('drag-over'));
  qaList.addEventListener('drop', (e) => {
    e.preventDefault();
    qaList.classList.remove('drag-over');
    const path = e.dataTransfer.getData('text/plain');
    const isDir = e.dataTransfer.getData('application/x-nexus-isdir');
    if (path && isDir === 'true') {
      const name = path.split(/[/\\]/).pop() || path;
      store.addCustomQuickAccess(name, path);
    }
  });

  QUICK_ACCESS.forEach(item => {
    const fullPath = resolvePath(item);
    const btn = createNavItem(item.id, t(item.labelKey), item.icon, fullPath);
    qaList.appendChild(btn);
  });

  const customQA = store.get('customQuickAccess') || [];
  customQA.forEach(item => {
    const btn = createNavItem(item.id, item.label, ICONS.folder, item.path);
    btn.title = item.path;
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm((t('context.removeFromQA') || 'Remove') + `\n\n${item.label}?`)) {
        store.removeCustomQuickAccess(item.id);
      }
    });
    qaList.appendChild(btn);
  });

  qaSection.appendChild(qaList);
  el.appendChild(qaSection);

  // Recent folders (most-recent-first, capped — hidden entirely when empty)
  const recent = store.get('recentFolders') || [];
  if (recent.length > 0) {
    const recentSection = createSection(t('sidebar.recent'));
    const recentList = document.createElement('div');
    recentList.className = 'sidebar-qa-list';
    recent.forEach((path, i) => {
      const name = path.replace(/^.*[/\\]/, '') || path;
      const btn = createNavItem(`recent-${i}`, name, ICONS.folder, path);
      btn.title = path;
      recentList.appendChild(btn);
    });
    recentSection.appendChild(recentList);
    el.appendChild(recentSection);
  }

  // Drives
  const driveSection = createSection(t('sidebar.drives'));
  const driveList = document.createElement('div');
  driveList.id = 'sidebar-drives';
  driveSection.appendChild(driveList);
  el.appendChild(driveSection);
  loadDrives(driveList);

  // Tags
  const tagSection = createSection(t('sidebar.tags'));
  const tagList = document.createElement('div');
  DEFAULT_TAGS.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'sidebar-item';
    const tagPath = `nexus://tag/${tag.id}`;
    btn.dataset.path = tagPath;
    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    dot.style.background = tag.color;
    const lbl = document.createElement('span');
    lbl.className = 'sidebar-item-label';
    lbl.textContent = t(tag.labelKey);
    btn.append(dot, lbl);
    btn.addEventListener('click', () => navigateTo(tagPath));
    tagList.appendChild(btn);
  });
  tagSection.appendChild(tagList);
  el.appendChild(tagSection);

  highlightActive(el);
}

function createSection(titleText) {
  const section = document.createElement('div');
  section.className = 'sidebar-section';
  const h = document.createElement('div');
  h.className = 'sidebar-section-title';
  h.textContent = titleText;
  section.appendChild(h);
  return section;
}

function createNavItem(id, label, iconPath, path) {
  const btn = document.createElement('button');
  btn.className = 'sidebar-item';
  btn.id = `nav-${id}`;
  btn.dataset.path = path || '';
  btn.appendChild(icon(iconPath, 'icon-sm'));
  const lbl = document.createElement('span');
  lbl.className = 'sidebar-item-label';
  lbl.textContent = label;
  btn.appendChild(lbl);
  btn.addEventListener('click', () => {
    if (path) navigateTo(path);
  });
  return btn;
}

async function loadDrives(container) {
  try {
    const drives = await getDrives();
    container.innerHTML = '';
    drives.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'sidebar-drive';
      btn.dataset.path = d.mountPoint;
      btn.appendChild(icon(ICONS.drive, 'icon-sm'));
      const lbl = document.createElement('span');
      lbl.textContent = `${d.label}  (${d.mountPoint})`;
      btn.appendChild(lbl);
      if (d.total > 0) {
        const free = document.createElement('span');
        free.className = 'drive-free';
        free.textContent = formatFileSize(d.free);
        free.title = `${formatFileSize(d.free)} / ${formatFileSize(d.total)}`;
        btn.appendChild(free);
      }
      btn.addEventListener('click', () => navigateTo(d.mountPoint));
      container.appendChild(btn);
    });
  } catch (e) {
    console.warn('Could not load drives:', e);
  }
}

function highlightActive(el) {
  const { currentPath } = store.getState();
  el.querySelectorAll('.sidebar-item[data-path], .sidebar-drive[data-path]').forEach(item => {
    item.classList.toggle('active', item.dataset.path === currentPath);
  });
}

function initResizeHandle() {
  const handle = document.getElementById('sidebar-resize');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;
  let startX, startWidth;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('active');
    const onMove = (e) => {
      const w = Math.min(400, Math.max(180, startWidth + e.clientX - startX));
      sidebar.style.width = w + 'px';
      store.setState({ sidebarWidth: w });
    };
    const onUp = () => {
      handle.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

export function updateSidebarHomePath(dir, folders = {}) {
  homeDir = dir;
  knownFolders = folders;
  store.setState({ knownFolders: folders });
  const el = document.getElementById('sidebar');
  if (el) render(el);
}
