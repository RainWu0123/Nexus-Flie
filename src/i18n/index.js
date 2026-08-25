/**
 * Nexus Files — i18n Engine
 * Detects system locale and provides translation helpers.
 */

const locales = {};
let currentLocale = 'en';
const listeners = new Set();

/** Register a locale pack. */
export function registerLocale(code, translations) {
  locales[code] = translations;
}

/** Set the active locale. */
export function setLocale(code) {
  currentLocale = locales[code] ? code : 'en';
  document.documentElement.setAttribute('lang', currentLocale);
  listeners.forEach(fn => fn(currentLocale));
}

export function getLocale() { return currentLocale; }

/**
 * Translate a key. Supports {param} interpolation.
 * @param {string} key
 * @param {Record<string, string|number>} params
 */
export function t(key, params = {}) {
  const dict = locales[currentLocale] || locales['en'] || {};
  let text = dict[key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

/** Subscribe to locale changes. Returns unsubscribe fn. */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Detect system/browser locale and map to best available. */
export function detectSystemLocale() {
  const lang = navigator.language || 'en';
  if (lang.startsWith('zh')) {
    return (lang.includes('CN') || lang.includes('Hans')) ? 'zh-CN' : 'zh-TW';
  }
  if (lang.startsWith('ja')) return 'ja';
  return 'en';
}

/** Get list of available locales with display names. */
export function getAvailableLocales() {
  return Object.keys(locales).map(code => ({
    code,
    name: locales[code].__name || code,
  }));
}
