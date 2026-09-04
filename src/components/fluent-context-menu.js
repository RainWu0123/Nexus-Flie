/**
 * Nexus Files — Windows 11 Fluent Acrylic Context Menu
 * Ultra-fast (<1ms DOM render), Mica/Acrylic blur, Windows 11 command bar, and smooth nested submenus.
 */
import { icon, ICONS } from '../utils/helpers.js';

let activeMenuInstances = [];
let activeSubmenuTimeout = null;
let currentKeyFocusIndex = -1;

export function closeContextMenu() {
  if (activeSubmenuTimeout) {
    clearTimeout(activeSubmenuTimeout);
    activeSubmenuTimeout = null;
  }
  for (const instance of activeMenuInstances) {
    if (instance.el && instance.el.parentNode) {
      instance.el.parentNode.removeChild(instance.el);
    }
  }
  activeMenuInstances = [];
  currentKeyFocusIndex = -1;
  removeGlobalDismissListeners();
}

function removeGlobalDismissListeners() {
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  window.removeEventListener('keydown', onDocKeyDown, true);
  window.removeEventListener('resize', closeContextMenu, true);
  window.removeEventListener('blur', closeContextMenu, true);
  document.removeEventListener('scroll', closeContextMenu, true);
}

function addGlobalDismissListeners() {
  removeGlobalDismissListeners();
  document.addEventListener('pointerdown', onDocPointerDown, true);
  window.addEventListener('keydown', onDocKeyDown, true);
  window.addEventListener('resize', closeContextMenu, true);
  window.addEventListener('blur', closeContextMenu, true);
  document.addEventListener('scroll', closeContextMenu, true);
}

function onDocPointerDown(e) {
  // Check if click was inside any active menu
  for (const instance of activeMenuInstances) {
    if (instance.el && instance.el.contains(e.target)) {
      return;
    }
  }
  closeContextMenu();
}

function onDocKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();
    return;
  }

  const rootInstance = activeMenuInstances[0];
  if (!rootInstance || !rootInstance.items) return;

  const currentInstance = activeMenuInstances[activeMenuInstances.length - 1];
  const itemEls = Array.from(currentInstance.el.querySelectorAll('.fluent-item:not(.disabled)'));
  if (itemEls.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    currentKeyFocusIndex = (currentKeyFocusIndex + 1) % itemEls.length;
    itemEls.forEach((el, idx) => el.classList.toggle('highlighted', idx === currentKeyFocusIndex));
    itemEls[currentKeyFocusIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    currentKeyFocusIndex = (currentKeyFocusIndex - 1 + itemEls.length) % itemEls.length;
    itemEls.forEach((el, idx) => el.classList.toggle('highlighted', idx === currentKeyFocusIndex));
    itemEls[currentKeyFocusIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowRight') {
    const highlighted = itemEls[currentKeyFocusIndex];
    if (highlighted && highlighted._openSubmenu) {
      e.preventDefault();
      highlighted._openSubmenu();
    }
  } else if (e.key === 'ArrowLeft') {
    if (activeMenuInstances.length > 1) {
      e.preventDefault();
      const last = activeMenuInstances.pop();
      if (last.el && last.el.parentNode) last.el.parentNode.removeChild(last.el);
      currentKeyFocusIndex = 0;
    }
  } else if (e.key === 'Enter') {
    const highlighted = itemEls[currentKeyFocusIndex];
    if (highlighted) {
      e.preventDefault();
      highlighted.click();
    }
  }
}

/**
 * Show a modern Windows 11 Fluent Context Menu.
 * @param {Object} options
 * @param {number} options.x - Screen X coordinate
 * @param {number} options.y - Screen Y coordinate
 * @param {Array} [options.commandBar] - Top quick action buttons [{ id, icon, title, action }]
 * @param {Array} options.items - Menu items [{ id, icon, iconHtml, text, shortcut, checked, disabled, action, submenu }]
 */
export async function showFluentContextMenu({ x, y, commandBar, items }) {
  closeContextMenu();

  const menuEl = document.createElement('div');
  menuEl.className = 'fluent-context-menu';
  menuEl.style.visibility = 'hidden';
  menuEl.style.left = '0px';
  menuEl.style.top = '0px';

  // 1. Render Top Command Bar if provided
  if (commandBar && commandBar.length > 0) {
    const barEl = document.createElement('div');
    barEl.className = 'fluent-cmd-bar';
    for (const cmd of commandBar) {
      const btn = document.createElement('button');
      btn.className = 'fluent-cmd-btn';
      if (cmd.title) btn.title = cmd.title;
      if (typeof cmd.icon === 'string') {
        if (ICONS[cmd.icon]) {
          btn.appendChild(icon(ICONS[cmd.icon]));
        } else {
          btn.innerHTML = cmd.icon;
        }
      } else if (cmd.icon instanceof Node) {
        btn.appendChild(cmd.icon);
      }
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeContextMenu();
        try { cmd.action?.(); } catch (err) { console.error(err); }
      });
      barEl.appendChild(btn);
    }
    menuEl.appendChild(barEl);
  }

  // 2. Render Items
  await renderMenuItems(menuEl, items, 0);

  document.body.appendChild(menuEl);

  // Position properly within viewport boundaries
  const rect = menuEl.getBoundingClientRect();
  let posX = x;
  let posY = y;
  const padding = 8;

  if (posX + rect.width > window.innerWidth - padding) {
    posX = Math.max(padding, window.innerWidth - rect.width - padding);
  }
  if (posY + rect.height > window.innerHeight - padding) {
    posY = Math.max(padding, window.innerHeight - rect.height - padding);
  }

  menuEl.style.left = `${posX}px`;
  menuEl.style.top = `${posY}px`;
  menuEl.style.visibility = 'visible';

  activeMenuInstances.push({ el: menuEl, items });
  addGlobalDismissListeners();
}

async function renderMenuItems(containerEl, items, depth) {
  for (const item of items) {
    if (!item) continue;

    if (item.type === 'separator' || item.item === 'Separator') {
      const sep = document.createElement('div');
      sep.className = 'fluent-sep';
      containerEl.appendChild(sep);
      continue;
    }

    const row = document.createElement('div');
    row.className = 'fluent-item';
    if (item.disabled) row.classList.add('disabled');

    // Icon on left
    const iconEl = document.createElement('div');
    iconEl.className = 'fluent-item-icon';
    if (item.iconHtml) {
      iconEl.innerHTML = item.iconHtml;
    } else if (item.checked !== undefined) {
      if (item.checked) {
        iconEl.innerHTML = '<span class="fluent-check">✓</span>';
      } else {
        iconEl.innerHTML = '';
      }
    } else if (item.icon) {
      if (typeof item.icon === 'string') {
        if (ICONS[item.icon]) {
          iconEl.appendChild(icon(ICONS[item.icon]));
        } else if (item.icon.startsWith('<')) {
          iconEl.innerHTML = item.icon;
        }
      } else if (item.icon instanceof Node) {
        iconEl.appendChild(item.icon.cloneNode(true));
      }
    }
    row.appendChild(iconEl);

    // Text Label
    const labelEl = document.createElement('div');
    labelEl.className = 'fluent-item-label';
    labelEl.textContent = item.text || item.label || '';
    row.appendChild(labelEl);

    // Shortcut
    if (item.shortcut) {
      const sc = document.createElement('div');
      sc.className = 'fluent-item-shortcut';
      sc.textContent = item.shortcut;
      row.appendChild(sc);
    }

    // Submenu Arrow
    if (item.submenu) {
      const arrow = document.createElement('div');
      arrow.className = 'fluent-item-arrow';
      arrow.appendChild(icon(ICONS.chevronRightSm || ICONS.chevronRight));
      row.appendChild(arrow);

      const openSubmenu = async () => {
        // Close deeper submenus
        while (activeMenuInstances.length > depth + 1) {
          const popped = activeMenuInstances.pop();
          if (popped.el?.parentNode) popped.el.parentNode.removeChild(popped.el);
        }

        row.classList.add('has-submenu-active');

        // Resolve subitems (can be array or async function)
        let subItems = item.submenu;
        if (typeof subItems === 'function') {
          subItems = await subItems();
        }
        if (!subItems || subItems.length === 0) return;

        const subEl = document.createElement('div');
        subEl.className = 'fluent-context-menu';
        subEl.style.visibility = 'hidden';
        subEl.style.left = '0px';
        subEl.style.top = '0px';

        await renderMenuItems(subEl, subItems, depth + 1);
        document.body.appendChild(subEl);

        const parentRect = containerEl.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const subRect = subEl.getBoundingClientRect();

        let subX = parentRect.right - 2;
        let subY = rowRect.top - 4;
        const padding = 8;

        // Auto flip horizontally if reaching right window edge
        if (subX + subRect.width > window.innerWidth - padding) {
          subX = Math.max(padding, parentRect.left - subRect.width + 2);
        }

        // Auto shift vertically if reaching bottom window edge
        if (subY + subRect.height > window.innerHeight - padding) {
          subY = Math.max(padding, window.innerHeight - subRect.height - padding);
        }

        subEl.style.left = `${subX}px`;
        subEl.style.top = `${subY}px`;
        subEl.style.visibility = 'visible';

        activeMenuInstances.push({ el: subEl, items: subItems, parentRow: row });
      };

      row._openSubmenu = openSubmenu;

      row.addEventListener('mouseenter', () => {
        if (activeSubmenuTimeout) clearTimeout(activeSubmenuTimeout);
        activeSubmenuTimeout = setTimeout(() => {
          openSubmenu();
        }, 60);
      });
    } else {
      // Normal item: clear submenus when hovering
      row.addEventListener('mouseenter', () => {
        if (activeSubmenuTimeout) clearTimeout(activeSubmenuTimeout);
        activeSubmenuTimeout = setTimeout(() => {
          while (activeMenuInstances.length > depth + 1) {
            const popped = activeMenuInstances.pop();
            if (popped.parentRow) popped.parentRow.classList.remove('has-submenu-active');
            if (popped.el?.parentNode) popped.el.parentNode.removeChild(popped.el);
          }
        }, 60);
      });

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.disabled) return;
        closeContextMenu();
        try {
          item.action?.();
        } catch (err) {
          console.error(err);
        }
      });
    }

    containerEl.appendChild(row);
  }
}
