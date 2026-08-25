/**
 * Lightweight toast — no framework, auto-dismiss.
 * Performance: single DOM node, no layout thrash.
 */

let host = null;
let hideTimer = null;

function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.id = 'nexus-toast-host';
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);
  return host;
}

/**
 * @param {string} message
 * @param {'info'|'success'|'error'} [type]
 * @param {number} [ms]
 */
export function toast(message, type = 'info', ms = 2400) {
  const h = ensureHost();
  h.textContent = message;
  h.dataset.type = type;
  h.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    h.classList.remove('show');
  }, ms);
}

export function statusMsg(message) {
  const el = document.getElementById('status-selection');
  if (el) el.textContent = message;
}
