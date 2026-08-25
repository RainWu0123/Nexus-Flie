/**
 * Nexus Files — Command Palette (Ctrl+K)
 */
import store from '../store/store.js';
import { navigateTo, getHomeDir, openFile } from '../utils/tauri-bridge.js';
import { fuzzyMatch, icon, ICONS, fileIconEl } from '../utils/helpers.js';
import { t, setLocale, onLocaleChange } from '../i18n/index.js';
import { createTab, reopenClosedTab } from './tabs.js';
import { getFilteredFiles, openFilterBar } from './file-list.js';

function getCommands() {
  const folders = store.get('knownFolders') || {};

  return [
    {
      id: 'new-tab', label: t('cp.cmd.newTab'), icon: ICONS.plus,
      shortcut: 'Ctrl+T', group: t('cp.group.tabs'),
      action: () => createTab(),
    },
    {
      id: 'reopen-tab', label: t('cp.cmd.reopenTab'), icon: ICONS.folder,
      shortcut: 'Ctrl+Shift+T', group: t('cp.group.tabs'),
      action: () => reopenClosedTab(),
    },
    {
      id: 'filter-folder', label: t('cp.cmd.filterFolder'), icon: ICONS.search,
      shortcut: 'Ctrl+F', group: t('cp.group.view'),
      action: () => openFilterBar(),
    },
    {
      id: 'toggle-theme', label: t('cp.cmd.toggleTheme'), icon: ICONS.moon,
      group: t('cp.group.appearance'),
      action: () => {
        const theme = store.get('theme') === 'dark' ? 'light' : 'dark';
        store.setState({ theme });
        document.documentElement.setAttribute('data-theme', theme);
      },
    },
    {
      id: 'toggle-dual-pane', label: t('cp.cmd.toggleDualPane'), icon: ICONS.columns,
      group: t('cp.group.layout'),
      action: () => {
        const next = !store.get('isDualPane');
        store.setState({ isDualPane: next });
        document.getElementById('content-area')?.classList.toggle('dual-pane', next);
      },
    },
    {
      id: 'view-list', label: t('cp.cmd.viewList'), icon: ICONS.list,
      group: t('cp.group.view'),
      action: () => store.setState({ viewMode: 'list' }),
    },
    {
      id: 'view-grid', label: t('cp.cmd.viewGrid') || '大圖示', icon: ICONS.grid,
      group: t('cp.group.view'),
      action: () => store.setState({ viewMode: 'grid' }),
    },
    {
      id: 'view-grid-xl', label: t('toolbar.viewGridXl') || '特大圖示', icon: ICONS.grid,
      group: t('cp.group.view'),
      action: () => store.setState({ viewMode: 'grid-xl' }),
    },
    {
      id: 'toggle-hidden', label: t('cp.cmd.toggleHidden'), icon: ICONS.file,
      group: t('cp.group.view'),
      action: () => store.setState(s => ({ showHidden: !s.showHidden })),
    },
    {
      id: 'go-home', label: t('cp.cmd.goHome'), icon: ICONS.home,
      group: t('cp.group.navigate'),
      action: async () => {
        try {
          const home = await getHomeDir();
          navigateTo(home);
        } catch { /* ignore */ }
      },
    },
    {
      id: 'go-desktop', label: t('cp.cmd.goDesktop'), icon: ICONS.desktop,
      group: t('cp.group.navigate'),
      action: async () => {
        if (folders.desktop) {
          navigateTo(folders.desktop);
          return;
        }
        try {
          const home = await getHomeDir();
          navigateTo(home + '\\Desktop');
        } catch { /* ignore */ }
      },
    },
    {
      id: 'go-downloads', label: t('cp.cmd.goDownloads'), icon: ICONS.download,
      group: t('cp.group.navigate'),
      action: async () => {
        if (folders.downloads) {
          navigateTo(folders.downloads);
          return;
        }
        try {
          const home = await getHomeDir();
          navigateTo(home + '\\Downloads');
        } catch { /* ignore */ }
      },
    },
    {
      id: 'go-path', label: t('cp.cmd.goPath'), icon: ICONS.chevronRight,
      group: t('cp.group.navigate'),
      action: () => {
        const path = prompt(t('cp.cmd.goPath'));
        if (path) navigateTo(path);
      },
    },
    { id: 'lang-en', label: t('cp.cmd.langEn'), icon: ICONS.command,
      group: t('cp.group.language'), action: () => { setLocale('en'); store.setState({ locale: 'en' }); } },
    { id: 'lang-zh-tw', label: t('cp.cmd.langZhTW'), icon: ICONS.command,
      group: t('cp.group.language'), action: () => { setLocale('zh-TW'); store.setState({ locale: 'zh-TW' }); } },
    { id: 'lang-zh-cn', label: t('cp.cmd.langZhCN'), icon: ICONS.command,
      group: t('cp.group.language'), action: () => { setLocale('zh-CN'); store.setState({ locale: 'zh-CN' }); } },
    { id: 'lang-ja', label: t('cp.cmd.langJa'), icon: ICONS.command,
      group: t('cp.group.language'), action: () => { setLocale('ja'); store.setState({ locale: 'ja' }); } },
  ];
}

let activeIndex = 0;

export function initCommandPalette() {
  const overlay = document.getElementById('command-palette-overlay');
  const input = document.getElementById('cp-input');
  if (!overlay || !input) return;

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      toggle();
    }
    if (e.key === 'Escape' && store.get('commandPaletteOpen')) {
      e.preventDefault();
      close();
    }
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  input.addEventListener('input', () => {
    activeIndex = 0;
    renderResults(input.value);
  });

  input.addEventListener('keydown', (e) => {
    const items = document.querySelectorAll('.cp-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      updateActive(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[activeIndex]) items[activeIndex].click();
    }
  });

  store.subscribe('commandPaletteOpen', (isOpen) => { isOpen ? show() : hide(); });
  onLocaleChange(() => updateFooter());
}

function toggle() { store.setState(s => ({ commandPaletteOpen: !s.commandPaletteOpen })); }
function close() { store.setState({ commandPaletteOpen: false }); }

function show() {
  const overlay = document.getElementById('command-palette-overlay');
  const input = document.getElementById('cp-input');
  overlay.classList.remove('hidden', 'hiding');
  input.value = '';
  input.placeholder = t('cp.placeholder');
  activeIndex = 0;
  renderResults('');
  updateFooter();
  requestAnimationFrame(() => input.focus());
}

function hide() {
  const overlay = document.getElementById('command-palette-overlay');
  overlay.classList.add('hiding');
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('hiding');
  }, 150);
}

function updateFooter() {
  const footer = document.querySelector('.cp-footer');
  if (footer) {
    footer.innerHTML = `
      <span><kbd>↑↓</kbd> ${t('cp.navigate')}</span>
      <span><kbd>↵</kbd> ${t('cp.execute')}</span>
      <span><kbd>Esc</kbd> ${t('cp.close')}</span>
    `;
  }
}

function renderResults(query) {
  const results = document.getElementById('cp-results');
  if (!results) return;

  let commands = getCommands();
  if (query.trim()) {
    commands = commands.filter(c => fuzzyMatch(query, c.label) || fuzzyMatch(query, c.id));
  }

  // Files in the current folder — client-side over the already-loaded list.
  let fileHits = [];
  const q = query.trim().toLowerCase();
  if (q) {
    fileHits = getFilteredFiles()
      .filter(f => f.name.toLowerCase().includes(q))
      .slice(0, 10);
  }

  const groups = {};
  commands.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  results.innerHTML = '';

  if (commands.length === 0 && fileHits.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding: 24px; text-align: center; color: var(--text-tertiary); font-size: var(--fs-sm);';
    empty.textContent = t('cp.noResults');
    results.appendChild(empty);
    return;
  }

  let globalIdx = 0;
  const orderedGroups = [];
  if (fileHits.length > 0) orderedGroups.push([t('cp.group.files'), fileHits]);
  for (const [groupName, cmds] of Object.entries(groups)) {
    orderedGroups.push([groupName, cmds]);
  }

  for (const [groupName, items] of orderedGroups) {
    const title = document.createElement('div');
    title.className = 'cp-result-group-title';
    title.textContent = groupName;
    results.appendChild(title);

    items.forEach(entry => {
      const isFileEntry = 'isDir' in entry && 'path' in entry;
      const item = document.createElement('div');
      item.className = `cp-item${globalIdx === activeIndex ? ' active' : ''}`;
      item.dataset.idx = globalIdx;

      if (isFileEntry) {
        item.appendChild(fileIconEl(entry));
        const label = document.createElement('span');
        label.className = 'cp-item-label';
        label.textContent = entry.name;
        item.appendChild(label);
        const kind = document.createElement('span');
        kind.className = 'cp-item-shortcut';
        kind.textContent = entry.isDir ? t('fileList.folder') : (entry.extension || '');
        item.appendChild(kind);
        item.addEventListener('click', () => {
          if (entry.isDir) navigateTo(entry.path);
          else openFile(entry.path).catch(console.error);
          close();
        });
      } else {
        item.appendChild(icon(entry.icon, 'cp-item-icon'));

        const label = document.createElement('span');
        label.className = 'cp-item-label';
        label.textContent = entry.label;
        item.appendChild(label);

        if (entry.shortcut) {
          const shortcut = document.createElement('span');
          shortcut.className = 'cp-item-shortcut';
          entry.shortcut.split('+').forEach(k => {
            const kbd = document.createElement('kbd');
            kbd.textContent = k;
            shortcut.appendChild(kbd);
          });
          item.appendChild(shortcut);
        }

        item.addEventListener('click', () => { entry.action(); close(); });
      }

      item.addEventListener('mouseenter', () => {
        activeIndex = parseInt(item.dataset.idx, 10);
        updateActive(document.querySelectorAll('.cp-item'));
      });

      results.appendChild(item);
      globalIdx++;
    });
  }
}

function updateActive(items) {
  items.forEach((item, i) => item.classList.toggle('active', i === activeIndex));
  if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
}
