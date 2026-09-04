/**
 * Nexus Files — Fluent Modal System
 * Provides Windows 11 Fluent modal dialogs (Confirm, Prompt, Custom Tag Selector)
 * replacing native browser confirm() / prompt() / alert() completely.
 */
import { icon, ICONS } from './helpers.js';
import { t } from '../i18n/index.js';

const PRESET_TAG_COLORS = [
  '#f87171', // Red / Coral
  '#fb923c', // Orange
  '#fbbf24', // Amber / Yellow
  '#4ade80', // Mint / Green
  '#34d399', // Emerald
  '#2dd4bf', // Teal
  '#38bdf8', // Sky
  '#60a5fa', // Blue / Cobalt
  '#818cf8', // Indigo
  '#c084fc', // Purple / Violet
  '#f472b6', // Pink
  '#94a3b8', // Slate / Gray
];

function createBackdrop() {
  const backdrop = document.createElement('div');
  backdrop.className = 'fluent-modal-backdrop';
  return backdrop;
}

/**
 * Show a Fluent confirm modal dialog.
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.message
 * @param {string} [options.confirmText]
 * @param {string} [options.cancelText]
 * @param {boolean} [options.isDanger]
 * @returns {Promise<boolean>}
 */
export function showConfirmDialog({
  title,
  message,
  confirmText,
  cancelText,
  isDanger = false,
}) {
  return new Promise((resolve) => {
    const backdrop = createBackdrop();
    const card = document.createElement('div');
    card.className = 'fluent-modal-card';

    const h = document.createElement('div');
    h.className = 'fluent-modal-title';
    h.textContent = title || t('common.confirm') || '確認';

    const body = document.createElement('div');
    body.className = 'fluent-modal-body';
    body.textContent = message || '';

    const actions = document.createElement('div');
    actions.className = 'fluent-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'fluent-btn fluent-btn-secondary';
    cancelBtn.textContent = cancelText || t('common.cancel') || '取消';

    const okBtn = document.createElement('button');
    okBtn.className = `fluent-btn ${isDanger ? 'fluent-btn-danger' : 'fluent-btn-primary'}`;
    okBtn.textContent = confirmText || t('common.confirm') || '確定';

    actions.append(cancelBtn, okBtn);
    card.append(h, body, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      okBtn.focus();
    });

    const cleanup = (result) => {
      backdrop.classList.remove('visible');
      setTimeout(() => {
        backdrop.remove();
        resolve(result);
      }, 150);
    };

    cancelBtn.addEventListener('click', () => cleanup(false));
    okBtn.addEventListener('click', () => cleanup(true));

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup(false);
    });

    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        cleanup(true);
      }
    });
  });
}

/**
 * Show a Fluent alert modal dialog (replaces native alert).
 * @param {object} options
 * @param {string} [options.title]
 * @param {string} options.message
 * @param {string} [options.okText]
 * @returns {Promise<void>}
 */
export function showAlertDialog({ title, message, okText }) {
  return new Promise((resolve) => {
    const backdrop = createBackdrop();
    const card = document.createElement('div');
    card.className = 'fluent-modal-card';

    const h = document.createElement('div');
    h.className = 'fluent-modal-title';
    h.textContent = title || t('common.ok') || '提示';

    const body = document.createElement('div');
    body.className = 'fluent-modal-body';
    body.textContent = message || '';

    const actions = document.createElement('div');
    actions.className = 'fluent-modal-actions';

    const okBtn = document.createElement('button');
    okBtn.className = 'fluent-btn fluent-btn-primary';
    okBtn.textContent = okText || t('common.ok') || '確定';

    actions.appendChild(okBtn);
    card.append(h, body, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      okBtn.focus();
    });

    const cleanup = () => {
      backdrop.classList.remove('visible');
      setTimeout(() => {
        backdrop.remove();
        resolve();
      }, 150);
    };

    okBtn.addEventListener('click', cleanup);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup();
    });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        cleanup();
      }
    });
  });
}

/**
 * Show a Fluent prompt modal dialog.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {string} [options.defaultValue]
 * @param {string} [options.placeholder]
 * @param {string} [options.confirmText]
 * @param {string} [options.cancelText]
 * @returns {Promise<string | null>}
 */
export function showPromptDialog({
  title,
  message,
  defaultValue = '',
  placeholder = '',
  confirmText,
  cancelText,
}) {
  return new Promise((resolve) => {
    const backdrop = createBackdrop();
    const card = document.createElement('div');
    card.className = 'fluent-modal-card';

    const h = document.createElement('div');
    h.className = 'fluent-modal-title';
    h.textContent = title || '';

    card.appendChild(h);

    if (message) {
      const body = document.createElement('div');
      body.className = 'fluent-modal-body';
      body.textContent = message;
      card.appendChild(body);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fluent-modal-input';
    input.value = defaultValue;
    input.placeholder = placeholder;
    input.spellcheck = false;
    card.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'fluent-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'fluent-btn fluent-btn-secondary';
    cancelBtn.textContent = cancelText || t('common.cancel') || '取消';

    const okBtn = document.createElement('button');
    okBtn.className = 'fluent-btn fluent-btn-primary';
    okBtn.textContent = confirmText || t('common.confirm') || '確定';

    actions.append(cancelBtn, okBtn);
    card.appendChild(actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      input.focus();
      input.select();
    });

    const cleanup = (value) => {
      backdrop.classList.remove('visible');
      setTimeout(() => {
        backdrop.remove();
        resolve(value);
      }, 150);
    };

    cancelBtn.addEventListener('click', () => cleanup(null));
    okBtn.addEventListener('click', () => cleanup(input.value.trim()));

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup(null);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        cleanup(input.value.trim());
      }
    });
  });
}

/**
 * Show a Fluent Tag Creation / Editing Modal.
 * @param {object} [options]
 * @param {object} [options.tag]
 * @returns {Promise<{ name: string, color: string } | null>}
 */
export function showTagDialog(options = {}) {
  const existing = options.tag || null;
  const initialName = existing ? (t(existing.labelKey) || existing.name || existing.id) : '';
  let selectedColor = existing?.color || PRESET_TAG_COLORS[0];

  return new Promise((resolve) => {
    const backdrop = createBackdrop();
    const card = document.createElement('div');
    card.className = 'fluent-modal-card tag-editor-card';

    const h = document.createElement('div');
    h.className = 'fluent-modal-title';
    h.textContent = existing ? (t('tags.editTag') || '編輯標籤') : (t('tags.addTag') || '新增標籤');

    // Name input with preview dot
    const inputWrap = document.createElement('div');
    inputWrap.className = 'tag-modal-input-wrap';

    const previewDot = document.createElement('span');
    previewDot.className = 'tag-dot';
    previewDot.style.setProperty('--tag-color', selectedColor);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fluent-modal-input tag-name-input';
    input.value = initialName;
    input.placeholder = t('tags.tagName') || '輸入標籤名稱…';
    input.spellcheck = false;

    inputWrap.append(previewDot, input);

    // Color Swatches
    const colorLabel = document.createElement('div');
    colorLabel.className = 'tag-modal-subtitle';
    colorLabel.textContent = t('tags.tagColor') || '挑選顏色';

    const swatches = document.createElement('div');
    swatches.className = 'tag-color-swatches';

    PRESET_TAG_COLORS.forEach(color => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = `tag-color-swatch${color.toLowerCase() === selectedColor.toLowerCase() ? ' active' : ''}`;
      swatch.style.backgroundColor = color;
      swatch.addEventListener('click', () => {
        selectedColor = color;
        previewDot.style.setProperty('--tag-color', color);
        swatches.querySelectorAll('.tag-color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
      });
      swatches.appendChild(swatch);
    });

    const actions = document.createElement('div');
    actions.className = 'fluent-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'fluent-btn fluent-btn-secondary';
    cancelBtn.textContent = t('common.cancel') || '取消';

    const okBtn = document.createElement('button');
    okBtn.className = 'fluent-btn fluent-btn-primary';
    okBtn.textContent = t('common.save') || '儲存';

    actions.append(cancelBtn, okBtn);
    card.append(h, inputWrap, colorLabel, swatches, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      input.focus();
      if (input.value) input.select();
    });

    const cleanup = (value) => {
      backdrop.classList.remove('visible');
      setTimeout(() => {
        backdrop.remove();
        resolve(value);
      }, 150);
    };

    cancelBtn.addEventListener('click', () => cleanup(null));
    okBtn.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      cleanup({ name, color: selectedColor });
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup(null);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const name = input.value.trim();
        if (name) cleanup({ name, color: selectedColor });
      }
    });
  });
}
