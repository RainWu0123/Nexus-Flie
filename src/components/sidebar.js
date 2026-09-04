import store from '../store/store.js';
import { navigateTo, getDrives, openTerminalAsAdmin } from '../utils/tauri-bridge.js';
import { icon, ICONS, DEFAULT_TAGS, getAllTags, formatFileSize, createTagDot } from '../utils/helpers.js';
import { t, onLocaleChange } from '../i18n/index.js';
import { showTagDialog, showConfirmDialog } from '../utils/modal.js';
import { showFluentContextMenu } from './fluent-context-menu.js';
import { showPropertiesDialog } from './properties-dialog.js';
import { toast } from '../utils/toast.js';

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
let isThisPcExpanded = true;

export function initSidebar() {
  const el = document.getElementById('sidebar');
  if (!el) return;

  const width = store.get('sidebarWidth');
  if (width) el.style.width = width + 'px';

  render(el);
  store.subscribe('currentPath', () => highlightActive(el));
  store.subscribe(['customQuickAccess', 'fileTags', 'tags', 'recentFolders'], () => render(el));
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

  // 1. Quick Access
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
    btn.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await showFluentContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            id: 'unpinFromQA',
            icon: 'unpin',
            text: t('context.removeFromQA') || '從快速存取中移除',
            action: () => {
              store.removeCustomQuickAccess(item.id);
            },
          },
          { type: 'separator' },
          {
            id: 'copyPath',
            icon: 'clipboard',
            text: t('context.copyPath') || '複製路徑',
            action: async () => {
              try {
                await navigator.clipboard.writeText(item.path);
                toast(t('context.pathCopied') || '已複製路徑', 'success');
              } catch {
                toast('複製失敗', 'error');
              }
            },
          },
          {
            id: 'openTerminalAsAdmin',
            icon: 'shield',
            text: t('context.openTerminalAsAdmin') || '以系統管理員身分開啟終端機',
            action: () => {
              openTerminalAsAdmin(item.path).catch(err => toast(String(err), 'error'));
            },
          },
          {
            id: 'properties',
            icon: 'info',
            text: t('context.properties') || '屬性',
            shortcut: 'Alt+Enter',
            action: () => {
              showPropertiesDialog({ name: item.label, path: item.path, isDir: true });
            },
          },
        ],
      });
    });
    qaList.appendChild(btn);
  });

  qaSection.appendChild(qaList);
  el.appendChild(qaSection);

  // 2. Recent folders (Windows-style frecency & stability)
  const recent = store.get('recentFolders') || [];
  if (recent.length > 0) {
    const recentSection = createSection(t('sidebar.recent'));
    const recentList = document.createElement('div');
    recentList.className = 'sidebar-qa-list';

    // Right-click section title to clear history
    const secTitle = recentSection.querySelector('.sidebar-section-title');
    if (secTitle) {
      secTitle.style.cursor = 'context-menu';
      secTitle.title = t('context.clearRecent') || '清除近期資料夾歷程記錄';
      secTitle.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await showFluentContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            {
              id: 'clearRecentHistory',
              icon: 'trash',
              text: t('context.clearRecent') || '清除近期資料夾歷程記錄',
              action: () => {
                store.clearRecentFolders();
                toast(t('sidebar.recentCleared') || '已清除近期資料夾記錄', 'info');
              },
            },
          ],
        });
      });
    }

    recent.forEach((path, i) => {
      const name = path.replace(/^.*[/\\]/, '') || path;
      const btn = createNavItem(`recent-${i}`, name, ICONS.folder, path);
      btn.title = path;

      // Windows 11 Fluent Context Menu on Recent Folders
      btn.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await showFluentContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            {
              id: 'pinToQA',
              icon: 'pin',
              text: t('context.pinToQA') || '釘選到快速存取',
              action: () => {
                store.addCustomQuickAccess(name, path);
                store.removeRecentFolder(path);
                toast(t('sidebar.pinnedToQA') || '已釘選到快速存取', 'success');
              },
            },
            {
              id: 'removeFromRecent',
              icon: 'x',
              text: t('context.removeFromRecent') || '從近期資料夾中移除',
              action: () => {
                store.removeRecentFolder(path);
                toast(t('sidebar.removedFromRecent') || '已從近期資料夾中移除', 'info');
              },
            },
            {
              id: 'clearRecent',
              icon: 'trash',
              text: t('context.clearRecent') || '清除近期資料夾歷程記錄',
              action: () => {
                store.clearRecentFolders();
                toast(t('sidebar.recentCleared') || '已清除近期資料夾記錄', 'info');
              },
            },
            { type: 'separator' },
            {
              id: 'copyPath',
              icon: 'clipboard',
              text: t('context.copyPath') || '複製路徑',
              action: async () => {
                try {
                  await navigator.clipboard.writeText(path);
                  toast(t('context.pathCopied') || '已複製路徑', 'success');
                } catch {
                  toast('複製失敗', 'error');
                }
              },
            },
            {
              id: 'openTerminalAsAdmin',
              icon: 'shield',
              text: t('context.openTerminalAsAdmin') || '以系統管理員身分開啟終端機',
              action: () => {
                openTerminalAsAdmin(path).catch(err => toast(String(err), 'error'));
              },
            },
            {
              id: 'properties',
              icon: 'info',
              text: t('context.properties') || '屬性',
              shortcut: 'Alt+Enter',
              action: () => {
                showPropertiesDialog({ name, path, isDir: true });
              },
            },
          ],
        });
      });

      recentList.appendChild(btn);
    });
    recentSection.appendChild(recentList);
    el.appendChild(recentSection);
  }

  // 3. This PC & Drives (Tree hierarchy)
  const thisPcSection = createSection(t('sidebar.drives'));
  const thisPcTree = document.createElement('div');
  thisPcTree.className = 'sidebar-tree';

  const thisPcRoot = document.createElement('button');
  thisPcRoot.className = 'sidebar-item sidebar-tree-root';
  thisPcRoot.dataset.path = 'nexus://this-pc';

  const arrowBtn = document.createElement('span');
  arrowBtn.className = `sidebar-tree-arrow${isThisPcExpanded ? ' expanded' : ''}`;
  arrowBtn.appendChild(icon(ICONS.chevronRightSm || ICONS.chevronRight, 'icon'));
  arrowBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isThisPcExpanded = !isThisPcExpanded;
    arrowBtn.classList.toggle('expanded', isThisPcExpanded);
    driveChildren.classList.toggle('collapsed', !isThisPcExpanded);
  });

  const thisPcIcon = icon(ICONS.desktop, 'icon-sm text-accent');
  const thisPcLabel = document.createElement('span');
  thisPcLabel.className = 'sidebar-item-label';
  thisPcLabel.textContent = t('sidebar.thisPc') || '本機';

  thisPcRoot.append(arrowBtn, thisPcIcon, thisPcLabel);
  thisPcRoot.addEventListener('click', () => navigateTo('nexus://this-pc'));

  const driveChildren = document.createElement('div');
  driveChildren.className = `sidebar-tree-children${isThisPcExpanded ? '' : ' collapsed'}`;
  loadDrives(driveChildren);

  thisPcTree.append(thisPcRoot, driveChildren);
  thisPcSection.appendChild(thisPcTree);
  el.appendChild(thisPcSection);

  // 4. Tags with Add Button & Management
  const tagSection = createSectionWithAction(
    t('sidebar.tags'),
    ICONS.plus,
    t('tags.addTag') || '新增標籤',
    async () => {
      const res = await showTagDialog();
      if (res && res.name) {
        store.addTag(res, DEFAULT_TAGS);
        render(el);
      }
    }
  );

  const tagList = document.createElement('div');
  const fileTags = store.get('fileTags') || {};

  // Single-pass O(N) tag count calculation
  const tagCountMap = Object.create(null);
  for (const tags of Object.values(fileTags)) {
    if (Array.isArray(tags)) {
      for (let i = 0; i < tags.length; i++) {
        const tid = tags[i];
        tagCountMap[tid] = (tagCountMap[tid] || 0) + 1;
      }
    }
  }

  const allTags = getAllTags();
  allTags.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'sidebar-item sidebar-tag-item';
    const tagPath = `nexus://tag/${tag.id}`;
    btn.dataset.path = tagPath;
    btn.dataset.tagId = tag.id;
    btn.style.setProperty('--tag-color', tag.color);

    const dot = createTagDot(tag.id);
    const lbl = document.createElement('span');
    lbl.className = 'sidebar-item-label';
    lbl.textContent = t(tag.labelKey) || tag.name || tag.id;

    btn.append(dot, lbl);

    const count = tagCountMap[tag.id] || 0;
    if (count > 0) {
      const countBadge = document.createElement('span');
      countBadge.className = 'sidebar-tag-count';
      countBadge.textContent = count > 999 ? '999+' : String(count);
      btn.appendChild(countBadge);
    }

    btn.addEventListener('click', () => navigateTo(tagPath));

    // Right-click context menu to edit / delete tag
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTagContextMenu(e, tag, el);
    });

    tagList.appendChild(btn);
  });

  tagSection.appendChild(tagList);
  el.appendChild(tagSection);

  highlightActive(el);
}

function showTagContextMenu(e, tag, sidebarEl) {
  // Remove existing dropdown if any
  document.querySelector('.fluent-dropdown-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'fluent-dropdown-menu';
  menu.style.position = 'fixed';
  menu.style.top = `${e.clientY}px`;
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  menu.style.zIndex = '10000';

  const tagName = t(tag.labelKey) || tag.name || tag.id;

  // Edit item
  const editRow = document.createElement('button');
  editRow.className = 'fluent-menu-item';
  editRow.appendChild(icon(ICONS.edit, 'icon-sm'));
  const editLbl = document.createElement('span');
  editLbl.className = 'fluent-menu-label';
  editLbl.textContent = t('tags.editTag') || '編輯標籤';
  editRow.appendChild(editLbl);
  editRow.addEventListener('click', async () => {
    menu.remove();
    const res = await showTagDialog({ tag });
    if (res && res.name) {
      store.updateTag(tag.id, res, DEFAULT_TAGS);
      render(sidebarEl);
    }
  });

  // Delete item
  const deleteRow = document.createElement('button');
  deleteRow.className = 'fluent-menu-item';
  deleteRow.appendChild(icon(ICONS.trash, 'icon-sm text-danger'));
  const deleteLbl = document.createElement('span');
  deleteLbl.className = 'fluent-menu-label text-danger';
  deleteLbl.textContent = t('tags.deleteTag') || '刪除標籤';
  deleteRow.appendChild(deleteLbl);
  deleteRow.addEventListener('click', async () => {
    menu.remove();
    const ok = await showConfirmDialog({
      title: t('tags.deleteTag') || '刪除標籤',
      message: (t('tags.deleteConfirm', { name: tagName }) || `確定要刪除「${tagName}」標籤嗎？這將自所有檔案中清除。`),
      confirmText: t('common.delete') || '刪除',
      cancelText: t('common.cancel') || '取消',
      isDanger: true,
    });
    if (ok) {
      store.deleteTag(tag.id, DEFAULT_TAGS);
      render(sidebarEl);
    }
  });

  menu.append(editRow, deleteRow);
  document.body.appendChild(menu);

  const closeHandler = (evt) => {
    if (!menu.contains(evt.target)) {
      menu.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 10);
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

function createSectionWithAction(titleText, actionIcon, actionTitle, onAction) {
  const section = document.createElement('div');
  section.className = 'sidebar-section';

  const header = document.createElement('div');
  header.className = 'sidebar-section-header';

  const title = document.createElement('div');
  title.className = 'sidebar-section-title';
  title.textContent = titleText;

  const btn = document.createElement('button');
  btn.className = 'sidebar-section-action';
  btn.title = actionTitle;
  btn.appendChild(icon(actionIcon, 'icon-sm'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onAction();
  });

  header.append(title, btn);
  section.appendChild(header);
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
      
      const isSystemDrive = /^[Cc]:/.test(d.mountPoint);
      btn.appendChild(icon(isSystemDrive ? ICONS.desktop : ICONS.drive, 'icon-sm'));
      
      const lbl = document.createElement('span');
      lbl.className = 'sidebar-item-label';
      lbl.textContent = `${d.label || '本機磁碟'} (${d.mountPoint.replace(/\\$/, '')})`;
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
  store.setState({ homeDir: dir, knownFolders: folders });
  store.purgeInvalidRecentFolders();
  const el = document.getElementById('sidebar');
  if (el) render(el);
}

