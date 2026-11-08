import {
  formatMoney,
  formatQty,
  kopecksToInput,
  microToInput,
  parseDecimal,
} from '/shared/money.js';
import { computeMaterialQuantity } from '/shared/calc.js';
import { shortUnit } from '/shared/units.js';

/* ------------------------------------------------------------------ */
/* Состояние и утилиты                                                */
/* ------------------------------------------------------------------ */

const state = {
  meta: null,
  user: null,
  csrf: null,
  settings: null,
  projects: [],
  project: null,
  room: null,
  roomProject: null,
  roomProjectTotals: null,
  catalogs: null,
  catalog: { type: null, items: [], categories: [] },
};

const pendingSaves = new Map();
let lastSavedAt = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date).replace(/\s?г\.$/, '');
}
function formatShortDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : shortDateFormatter.format(date);
}
function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

const currency = () => state.settings?.currency || 'RUB';
const fmt = (kopecks) => formatMoney(Number(kopecks) || 0, currency());
const fmtPlain = (kopecks) => {
  const value = (Number(kopecks) || 0) / 100;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
};

function plural(count, one, few, many) {
  const n = Math.abs(Number(count)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

function qtyText(value, max = 3) {
  const micro = parseDecimal(value);
  if (micro === null) return '—';
  return formatQty(micro, max);
}

function initials(name) {
  const parts = String(name || 'А').trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || 'А';
}

function truncate(text, length = 80) {
  const value = String(text || '');
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 8a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  wrench: '<path d="M14.6 6.4a4.6 4.6 0 0 0-6 6L3.8 17.2a2.1 2.1 0 1 0 3 3l4.8-4.8a4.6 4.6 0 0 0 6-6l-2.8 2.8-2.4-2.4z"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  sliders: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.4" fill="#fff"/><circle cx="15" cy="17" r="2.4" fill="#fff"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  download: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8"/><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  fileText: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  phone: '<path d="M6 3h3l2 5-2.5 1.5a13 13 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.6 5.4 3.6 8.5S14.5 18 12 20.5C9.5 18 8.4 15.1 8.4 12S9.5 6 12 3.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3 2.8 20h18.4z"/><path d="M12 9v5M12 17h.01"/>',
  sparkle: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  printer: '<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  layout: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M3.5 10h17M10 10v10.5"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m14.8 9.2-1.5 4.1-4.1 1.5 1.5-4.1z"/>',
  shield: '<path d="M12 3l8 3v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  circleCheck: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.4 3.2M6.3 6.8A16.2 16.2 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.5 4.2-1.2"/>',
};

function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

const LOGO_SVG = `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true">
  <rect width="28" height="28" rx="7" fill="currentColor"/>
  <path d="M7 10h14M12 10v9" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
  <circle cx="18.4" cy="17.2" r="1.5" fill="#fff"/>
</svg>`;

/* ------------------------------------------------------------------ */
/* API                                                                */
/* ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверьте подключение к сети.', 0);
  }
  if (response.status === 401 && path !== '/auth/login') {
    state.user = null;
    state.csrf = null;
    navigate('/login', { replace: true });
    throw new ApiError('Сессия истекла. Войдите снова.', 401);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.message || 'Не удалось выполнить действие', response.status, data);
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Уведомления и диалоги                                              */
/* ------------------------------------------------------------------ */

function toast(message, type = 'success') {
  const container = $('#toasts');
  if (!container) return;
  const item = document.createElement('div');
  item.className = `toast toast--${type}`;
  item.innerHTML = `<span class="toast-icon">${icon(type === 'error' ? 'alert' : 'check', 16)}</span><span class="toast-text"></span>`;
  item.querySelector('.toast-text').textContent = message;
  container.appendChild(item);
  requestAnimationFrame(() => item.classList.add('is-visible'));
  setTimeout(() => {
    item.classList.remove('is-visible');
    setTimeout(() => item.remove(), 220);
  }, type === 'error' ? 5200 : 3200);
}

function openModal({ title, subtitle = '', body, size = 'md', onMount }) {
  const root = document.createElement('div');
  root.className = 'modal-root';
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-close></div>
    <div class="modal modal--${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <div>
          <h2 id="modal-title">${esc(title)}</h2>
          ${subtitle ? `<p class="modal-subtitle">${esc(subtitle)}</p>` : ''}
        </div>
        <button class="icon-btn" type="button" data-modal-close aria-label="Закрыть">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('modal-open');

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      root.remove();
      if (!document.querySelector('.modal-root')) document.body.classList.remove('modal-open');
    }, 160);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close]')) close();
  });
  requestAnimationFrame(() => root.classList.add('is-open'));
  if (onMount) onMount(root, close);
  setTimeout(() => root.querySelector('input, textarea, select, button:not([data-modal-close])')?.focus(), 60);
  return { root, close };
}

function confirmDialog({ title, message, confirmText = 'Удалить', danger = true }) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };
    const { root, close } = openModal({
      title,
      size: 'sm',
      body: `
        <p class="confirm-text">${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-modal-close>Отмена</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" id="confirm-ok">${esc(confirmText)}</button>
        </div>`,
      onMount(modalRoot) {
        modalRoot.querySelector('#confirm-ok').addEventListener('click', () => {
          finish(true);
          close();
        });
        modalRoot.querySelectorAll('[data-modal-close]').forEach((element) => {
          element.addEventListener('click', () => finish(false));
        });
        document.addEventListener(
          'keydown',
          (event) => {
            if (event.key === 'Escape') finish(false);
          },
          { once: true },
        );
      },
    });
    void root;
  });
}

function formError(root, message) {
  const box = root.querySelector('.form-error');
  if (!box) {
    toast(message, 'error');
    return;
  }
  box.hidden = false;
  box.textContent = message;
}

function clearFormError(root) {
  const box = root.querySelector('.form-error');
  if (box) box.hidden = true;
}

function bindFormSubmit(form, handler) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const original = submit?.innerHTML;
    clearFormError(form);
    if (submit) {
      submit.disabled = true;
      submit.innerHTML = '<span class="spinner"></span> Сохранение…';
    }
    try {
      await handler();
    } catch (error) {
      formError(form, error.message || 'Не удалось сохранить изменения');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.innerHTML = original;
      }
    }
  });
}

function formValue(form, name) {
  const element = form.elements[name];
  return element ? element.value.trim() : '';
}

function field({ label, name, value = '', placeholder = '', type = 'text', required = false, hint = '', span = false, inputmode = '' }) {
  return `
    <label class="field${span ? ' field--span' : ''}">
      <span class="field-label">${esc(label)}${required ? '<span class="req">*</span>' : ''}</span>
      <input class="input" type="${type}" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${inputmode ? `inputmode="${inputmode}"` : ''}>
      ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
    </label>`;
}

function textareaField({ label, name, value = '', placeholder = '', rows = 3, hint = '', span = true }) {
  return `
    <label class="field${span ? ' field--span' : ''}">
      <span class="field-label">${esc(label)}</span>
      <textarea class="input textarea" name="${esc(name)}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>
      ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
    </label>`;
}

/* ------------------------------------------------------------------ */
/* Маршрутизация и каркас                                             */
/* ------------------------------------------------------------------ */

function normalizePath() {
  const path = location.pathname.replace(/\/+$/, '');
  return path || '/app';
}

function navigate(path, { replace = false } = {}) {
  closeNav();
  if (normalizePath() === path) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  renderRoute();
  window.scrollTo(0, 0);
}

function closeNav() {
  document.body.classList.remove('nav-open');
}

function setView(html, { title } = {}) {
  const app = $('#app');
  if (app) app.innerHTML = html;
  if (title) document.title = `${title} — Метраж`;
}

function shell(content, active) {
  const navItems = [
    { key: 'projects', href: '/app', icon: 'folder', label: 'Объекты' },
    { key: 'works', href: '/app/catalog/works', icon: 'wrench', label: 'Работы' },
    { key: 'materials', href: '/app/catalog/materials', icon: 'box', label: 'Материалы' },
    { key: 'settings', href: '/app/settings', icon: 'sliders', label: 'Настройки' },
  ];
  const name = state.user?.name || state.user?.login || 'Администратор';
  return `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <a class="side-brand" href="/app" data-link>
          <span class="side-mark">${LOGO_SVG}</span>
          <span class="side-brand-text"><strong>Метраж</strong><small>сметы на ремонт</small></span>
        </a>
        <nav class="side-nav" aria-label="Основная навигация">
          <span class="side-caption">Рабочее пространство</span>
          ${navItems
            .map(
              (item) => `
            <a class="side-link${active === item.key ? ' is-active' : ''}" href="${item.href}" data-link>
              ${icon(item.icon, 19)}<span>${item.label}</span>
            </a>`,
            )
            .join('')}
        </nav>
        <div class="side-tip">
          <span class="side-tip-icon">${icon('sparkle', 16)}</span>
          <p>Цены фиксируются в момент добавления — старые сметы не меняются.</p>
        </div>
        <div class="side-user">
          <span class="avatar">${esc(initials(name))}</span>
          <div class="side-user-text"><strong>${esc(name)}</strong><small>${esc(state.user?.login || '')}</small></div>
          <button class="side-logout" type="button" data-action="logout" title="Выйти" aria-label="Выйти">${icon('logout', 18)}</button>
        </div>
      </aside>
      <div class="sidebar-overlay" id="sidebar-overlay" data-action="close-nav"></div>
      <div class="shell-main">
        <header class="mobile-bar">
          <button class="icon-btn" type="button" id="nav-toggle" aria-label="Открыть меню">${icon('menu', 20)}</button>
          <span class="mobile-brand">Метраж</span>
          <span class="avatar avatar--sm">${esc(initials(name))}</span>
        </header>
        <main class="content">${content}</main>
      </div>
    </div>`;
}

function bindShell() {
  $('#nav-toggle')?.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#sidebar-overlay')?.addEventListener('click', closeNav);
  $$('[data-action="logout"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api('/auth/logout', { method: 'POST' });
      } catch {
        /* выходим в любом случае */
      }
      state.user = null;
      state.csrf = null;
      state.settings = null;
      navigate('/login', { replace: true });
    });
  });
}

function loadingShell(active = 'projects') {
  return shell(
    `<div class="page-loading">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton-grid">${'<div class="skeleton skeleton-card"></div>'.repeat(4)}</div>
    </div>`,
    active,
  );
}

function errorView(message, active = 'projects') {
  return shell(
    `<div class="empty-state empty-state--error">
      <span class="empty-icon">${icon('alert', 28)}</span>
      <h2>Не удалось загрузить страницу</h2>
      <p>${esc(message || 'Попробуйте обновить страницу.')}</p>
      <div class="empty-actions">
        <button class="btn btn-primary" type="button" data-action="reload-page">Обновить</button>
        <a class="btn btn-ghost" href="/app" data-link>К объектам</a>
      </div>
    </div>`,
    active,
  );
}

/* ------------------------------------------------------------------ */
/* Загрузка приложения                                                */
/* ------------------------------------------------------------------ */

async function loadMeta() {
  try {
    const response = await fetch('/api/meta', { credentials: 'same-origin' });
    if (response.ok) state.meta = await response.json();
  } catch {
    state.meta = null;
  }
}

async function checkAuth() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (response.ok) {
      const data = await response.json();
      state.user = data.user;
      state.csrf = data.csrfToken;
    }
  } catch {
    state.user = null;
  }
}

async function loadSettings() {
  try {
    const { settings } = await api('/settings');
    state.settings = settings;
  } catch {
    state.settings = null;
  }
}

async function boot() {
  await loadMeta();
  await checkAuth();
  if (state.user) await loadSettings();
  const path = normalizePath();
  if (!state.user && path !== '/login') history.replaceState(null, '', '/login');
  if (state.user && path === '/login') history.replaceState(null, '', '/app');
  renderRoute();
}

function renderRoute() {
  const path = normalizePath();
  if (!state.user) {
    if (path !== '/login') {
      history.replaceState(null, '', '/login');
    }
    renderLogin();
    return;
  }
  if (path === '/login') {
    history.replaceState(null, '', '/app');
    renderDashboard();
    return;
  }
  if (path === '/app' || path === '/') {
    renderDashboard();
    return;
  }
  let match;
  if ((match = path.match(/^\/app\/projects\/(\d+)$/))) {
    renderProjectPage(Number(match[1]));
    return;
  }
  if ((match = path.match(/^\/app\/rooms\/(\d+)$/))) {
    renderRoomPage(Number(match[1]));
    return;
  }
  if (path === '/app/catalog/works') {
    renderCatalog('works');
    return;
  }
  if (path === '/app/catalog/materials') {
    renderCatalog('materials');
    return;
  }
  if (path === '/app/settings') {
    renderSettings();
    return;
  }
  renderNotFound();
}

function renderNotFound() {
  setView(
    shell(
      `<div class="empty-state">
        <span class="empty-icon">${icon('compass', 28)}</span>
        <h2>Страница не найдена</h2>
        <p>Возможно, объект был удалён или ссылка устарела.</p>
        <a class="btn btn-primary" href="/app" data-link>К объектам</a>
      </div>`,
      'projects',
    ),
    { title: 'Не найдено' },
  );
  bindShell();
}

/* ------------------------------------------------------------------ */
/* Вход                                                               */
/* ------------------------------------------------------------------ */

function renderLogin() {
  document.title = 'Вход — Метраж';
  const demo = state.meta?.demo;
  setView(`
    <div class="login">
      <aside class="login-aside">
        <div class="login-brand">
          <span class="login-mark">${LOGO_SVG}</span>
          <span class="login-brand-text"><strong>Метраж</strong><small>сметы на ремонт квартир</small></span>
        </div>
        <div class="login-copy">
          <span class="eyebrow eyebrow--light">Для тех, кто считает точно</span>
          <h1>Сметы, в которых<br>всё сходится.</h1>
          <p>Справочники работ и материалов, автоматический расчёт материалов по нормам и аккуратная ссылка для заказчика — в одном окне.</p>
        </div>
        <ul class="login-features">
          <li><span>${icon('check', 14)}</span>Цены фиксируются в смете навсегда</li>
          <li><span>${icon('check', 14)}</span>Расчёт упаковок с округлением вверх</li>
          <li><span>${icon('check', 14)}</span>Клиентская страница и PDF в один клик</li>
        </ul>
        <div class="login-plan" aria-hidden="true">
          <svg viewBox="0 0 420 260" fill="none">
            <path d="M40 218V42h150v84h190v92H40z" stroke="rgba(255,255,255,.28)" stroke-width="1.4"/>
            <path d="M190 42v84M40 126h150M270 84v134M40 170h340" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
            <path d="M96 96h38v30H96zM300 150h58v20h-58zM210 190h44v28h-44z" stroke="rgba(255,255,255,.32)" stroke-width="1.2"/>
            <circle cx="134" cy="204" r="3" fill="#D9A277"/>
            <path d="M362 42h-80M362 42v60" stroke="rgba(217,162,119,.6)" stroke-width="1.2"/>
            <text x="374" y="118" fill="rgba(255,255,255,.4)" font-family="monospace" font-size="10">7,2 м</text>
          </svg>
        </div>
        <p class="login-foot">© ${new Date().getFullYear()} Метраж · внутренний инструмент сметчика</p>
      </aside>

      <main class="login-main">
        <div class="login-card">
          <span class="eyebrow">Административная панель</span>
          <h2>Вход в систему</h2>
          <p class="login-sub">Введите логин и пароль администратора.</p>
          <div class="form-error login-error" id="login-error" hidden></div>
          <form id="login-form" class="login-form" autocomplete="on">
            <label class="field">
              <span class="field-label">Логин</span>
              <input class="input" type="text" name="login" autocomplete="username" placeholder="admin" required>
            </label>
            <label class="field">
              <span class="field-label">Пароль</span>
              <input class="input" type="password" name="password" autocomplete="current-password" placeholder="••••••••" required>
            </label>
            <button class="btn btn-primary btn-block btn-lg" type="submit">Войти в панель ${icon('arrowRight', 18)}</button>
          </form>
          ${
            demo
              ? `<div class="demo-hint">
                  <span class="demo-hint-label">Демо-доступ</span>
                  <code>${esc(demo.login)}</code> / <code>${esc(demo.password)}</code>
                  <button class="link-btn" type="button" id="fill-demo">Заполнить</button>
                </div>`
              : ''
          }
          <p class="login-security">${icon('lock', 14)} Пароли хранятся только в виде стойких хешей. Сессия защищена HttpOnly-куки.</p>
        </div>
      </main>
    </div>
  `);

  const form = $('#login-form');
  const errorBox = $('#login-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const submit = form.querySelector('[type="submit"]');
    const original = submit.innerHTML;
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner spinner--light"></span> Вход…';
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: {
          login: formValue(form, 'login'),
          password: form.elements.password.value,
        },
      });
      state.user = data.user;
      state.csrf = data.csrfToken;
      await loadSettings();
      navigate('/app', { replace: true });
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error.message;
      submit.disabled = false;
      submit.innerHTML = original;
    }
  });

  $('#fill-demo')?.addEventListener('click', () => {
    form.elements.login.value = demo.login;
    form.elements.password.value = demo.password;
    form.elements.password.focus();
  });
}

/* ------------------------------------------------------------------ */
/* Дашборд                                                            */
/* ------------------------------------------------------------------ */

async function renderDashboard() {
  setView(shell(loadingShell('projects'), 'projects'), { title: 'Объекты' });
  bindShell();
  try {
    const { projects } = await api('/projects');
    state.projects = projects;
    setView(shell(dashboardHtml(projects), 'projects'), { title: 'Объекты' });
    bindShell();
    bindDashboard();
  } catch (error) {
    setView(errorView(error.message, 'projects'), { title: 'Ошибка' });
    bindShell();
  }
}

function statCard(label, value, sub, iconName, tone = '') {
  return `
    <div class="stat-card ${tone ? `stat-card--${tone}` : ''}">
      <span class="stat-icon">${icon(iconName, 19)}</span>
      <div class="stat-body">
        <span class="stat-label">${esc(label)}</span>
        <strong class="stat-value">${esc(value)}</strong>
        <span class="stat-sub">${esc(sub)}</span>
      </div>
    </div>`;
}

function dashboardHtml(projects) {
  const roomsCount = projects.reduce((sum, project) => sum + (project.roomCount || 0), 0);
  const total = projects.reduce((sum, project) => sum + (project.totals?.total || 0), 0);
  const publicCount = projects.filter((project) => project.publicEnabled).length;

  const cards = projects.length
    ? projects
        .map(
          (project, index) => `
      <a class="project-card" href="/app/projects/${project.id}" data-link data-search="${esc(`${project.name} ${project.address}`.toLowerCase())}">
        <div class="project-card-top">
          <span class="project-num">${String(index + 1).padStart(2, '0')}</span>
          ${
            project.publicEnabled
              ? '<span class="badge badge--success"><span class="dot"></span>Ссылка активна</span>'
              : '<span class="badge badge--muted">Без ссылки</span>'
          }
        </div>
        <h3 class="project-name">${esc(project.name)}</h3>
        <p class="project-address">${project.address ? esc(project.address) : 'Адрес не указан'}</p>
        <div class="project-facts">
          ${project.totalArea ? `<span>${esc(qtyText(project.totalArea, 2))} м²</span>` : ''}
          <span>${project.roomCount || 0} ${plural(project.roomCount || 0, 'помещение', 'помещения', 'помещений')}</span>
        </div>
        <div class="project-card-foot">
          <span class="foot-label">Стоимость сметы</span>
          <strong>${fmt(project.totals?.total || 0)}</strong>
        </div>
      </a>`,
        )
        .join('')
    : '';

  return `
    <div class="page-head">
      <div class="page-head-main">
        <span class="eyebrow">Панель управления</span>
        <h1>Объекты</h1>
        <p class="page-sub">Сметы на ремонт квартир: объекты, помещения, работы и материалы.</p>
      </div>
      <div class="page-actions">
        <div class="search-field">
          ${icon('search', 17)}
          <input type="search" id="project-search" placeholder="Найти объект…" aria-label="Поиск по объектам">
        </div>
        <button class="btn btn-primary" type="button" id="new-project-btn">${icon('plus', 17)} Создать объект</button>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard('Объектов', String(projects.length), 'в работе', 'folder')}
      ${statCard('Помещений', String(roomsCount), 'во всех объектах', 'layout')}
      ${statCard('Публичных ссылок', String(publicCount), 'доступно заказчикам', 'link', 'accent')}
      ${statCard('Общая стоимость', fmt(total), 'по всем сметам', 'calculator', 'dark')}
    </div>

    <div class="section-head">
      <div class="section-title">
        <h2>Все объекты</h2>
        <span class="count-pill" id="projects-count">${projects.length}</span>
      </div>
      <span class="section-note">Данные сохраняются автоматически</span>
    </div>

    ${
      projects.length
        ? `<div class="project-grid" id="project-grid">${cards}</div>
           <div class="empty-note" id="no-search-results" hidden>По запросу ничего не найдено. <button class="link-btn" type="button" id="reset-search">Сбросить поиск</button></div>`
        : `<div class="empty-state empty-state--dash">
            <span class="empty-icon">${icon('folder', 30)}</span>
            <h2>Пока нет ни одного объекта</h2>
            <p>Создайте первый объект, добавьте помещения и соберите смету из справочников работ и материалов.</p>
            <button class="btn btn-primary" type="button" id="empty-create">${icon('plus', 17)} Создать объект</button>
          </div>`
    }
  `;
}

function bindDashboard() {
  const openCreate = () => openProjectForm(null, (project) => navigate(`/app/projects/${project.id}`));
  $('#new-project-btn')?.addEventListener('click', openCreate);
  $('#empty-create')?.addEventListener('click', openCreate);

  const search = $('#project-search');
  if (search) {
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      let visible = 0;
      $$('#project-grid .project-card').forEach((card) => {
        const match = !query || (card.dataset.search || '').includes(query);
        card.hidden = !match;
        if (match) visible += 1;
      });
      const counter = $('#projects-count');
      if (counter) counter.textContent = String(visible);
      const empty = $('#no-search-results');
      if (empty) empty.hidden = visible > 0 || !query;
    });
    $('#reset-search')?.addEventListener('click', () => {
      search.value = '';
      search.dispatchEvent(new Event('input'));
      search.focus();
    });
  }
}

/* ------------------------------------------------------------------ */
/* Объект                                                             */
/* ------------------------------------------------------------------ */

function openProjectForm(project, onSaved) {
  const isEdit = Boolean(project);
  const { root, close } = openModal({
    title: isEdit ? 'Редактировать объект' : 'Новый объект',
    subtitle: isEdit ? 'Название и параметры объекта' : 'Создайте объект и добавьте в него помещения',
    size: 'md',
    body: `
      <form class="form-grid" id="project-form" novalidate>
        <div class="form-error" hidden></div>
        ${field({ label: 'Название объекта', name: 'name', value: project?.name || '', placeholder: 'Например, Квартира на Пресне', required: true, span: true })}
        ${field({ label: 'Адрес', name: 'address', value: project?.address || '', placeholder: 'Город, улица, дом, квартира', span: true })}
        <div class="field-row">
          ${field({ label: 'Общая площадь, м²', name: 'totalArea', value: project?.totalArea ? qtyText(project.totalArea, 2) : '', placeholder: '62', inputmode: 'decimal' })}
          <div class="field field--hint">
            <span class="field-label">Подсказка</span>
            <p class="field-static">Площадь объекта можно указать вручную, а площади помещений — отдельно.</p>
          </div>
        </div>
        ${textareaField({ label: 'Описание', name: 'description', value: project?.description || '', placeholder: 'Кратко об объекте, составе работ, договорённостях', rows: 3 })}
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-modal-close>Отмена</button>
          <button class="btn btn-primary" type="submit">${isEdit ? 'Сохранить' : 'Создать объект'}</button>
        </div>
      </form>`,
    onMount(modalRoot) {
      const form = $('#project-form', modalRoot);
      bindFormSubmit(form, async () => {
        const payload = {
          name: formValue(form, 'name'),
          address: formValue(form, 'address'),
          totalArea: formValue(form, 'totalArea'),
          description: formValue(form, 'description'),
        };
        if (!payload.name) throw new ApiError('Укажите название объекта', 422);
        const result = isEdit
          ? await api(`/projects/${project.id}`, { method: 'PATCH', body: payload })
          : await api('/projects', { method: 'POST', body: payload });
        close();
        toast(isEdit ? 'Объект обновлён' : 'Объект создан');
        onSaved(result.project);
      });
    },
  });
}

async function renderProjectPage(id) {
  setView(shell(loadingShell('projects'), 'projects'), { title: 'Объект' });
  bindShell();
  try {
    const { project } = await api(`/projects/${id}`);
    state.project = project;
    paintProject(project);
  } catch (error) {
    setView(errorView(error.message, 'projects'), { title: 'Ошибка' });
    bindShell();
  }
}

function paintProject(project) {
  state.project = project;
  setView(shell(projectHtml(project), 'projects'), { title: project.name });
  bindShell();
  bindProject(project);
}

function projectHtml(project) {
  const totals = project.totals || { works: 0, materials: 0, total: 0 };
  const rooms = project.rooms || [];
  const percent = totals.total > 0 ? (totals.works / totals.total) * 100 : 0;

  return `
    <div class="breadcrumbs">
      <a href="/app" data-link>Объекты</a>${icon('chevronRight', 14)}<span>${esc(project.name)}</span>
    </div>

    <div class="page-head page-head--project">
      <div class="page-head-main">
        <span class="eyebrow">Объект</span>
        <h1>${esc(project.name)}</h1>
        <p class="page-sub">${project.address ? esc(project.address) : 'Адрес не указан'}${project.totalArea ? ` · ${qtyText(project.totalArea, 2)} м²` : ''} · обновлён ${formatDate(project.updatedAt)}</p>
        <div class="page-actions page-actions--inline">
          <button class="btn btn-ghost" type="button" id="download-pdf-btn">${icon('download', 17)} PDF</button>
          <button class="btn btn-ghost" type="button" id="edit-project-btn">${icon('pencil', 17)} Изменить</button>
          <button class="btn btn-ghost btn-ghost--danger" type="button" id="delete-project-btn">${icon('trash', 17)} Удалить</button>
        </div>
      </div>
    </div>

    <div class="summary-card">
      <div class="summary-main">
        <span class="summary-label">Стоимость сметы</span>
        <strong class="summary-total">${fmt(totals.total)}</strong>
        <span class="summary-note">${rooms.length} ${plural(rooms.length, 'помещение', 'помещения', 'помещений')} · ${totals.lineCount || 0} ${plural(totals.lineCount || 0, 'позиция', 'позиции', 'позиций')}</span>
      </div>
      <div class="summary-split">
        <div class="split-row">
          <span>Работы</span><b>${fmt(totals.works)}</b>
        </div>
        <div class="split-row">
          <span>Материалы</span><b>${fmt(totals.materials)}</b>
        </div>
        <div class="split-bar"><span class="split-bar-works" style="width:${percent.toFixed(2)}%"></span><span class="split-bar-materials"></span></div>
        <div class="split-legend"><span><i class="dot dot--accent"></i>работы</span><span><i class="dot dot--clay"></i>материалы</span></div>
      </div>
    </div>

    <div id="link-slot">${linkPanelHtml(project)}</div>

    <div class="section-head">
      <div class="section-title">
        <h2>Помещения</h2>
        <span class="count-pill">${rooms.length}</span>
      </div>
      <button class="btn btn-primary btn-sm" type="button" id="add-room-btn">${icon('plus', 16)} Добавить помещение</button>
    </div>

    ${
      rooms.length
        ? `<div class="rooms-list" id="rooms-list">${rooms.map((room, index) => roomRowHtml(room, index)).join('')}</div>`
        : `<div class="empty-state empty-state--inline">
            <span class="empty-icon">${icon('layout', 26)}</span>
            <h3>Помещений пока нет</h3>
            <p>Добавьте кухню, спальню или санузел — для каждого помещения собирается отдельная смета.</p>
            <button class="btn btn-primary" type="button" id="empty-add-room">${icon('plus', 16)} Добавить помещение</button>
          </div>`
    }
  `;
}

function roomRowHtml(room, index) {
  const totals = room.totals || { works: 0, materials: 0, total: 0, lineCount: 0 };
  return `
    <div class="room-row">
      <a class="room-row-main" href="/app/rooms/${room.id}" data-link>
        <span class="room-num">${String(index + 1).padStart(2, '0')}</span>
        <span class="room-info">
          <strong>${esc(room.name)}</strong>
          <small>${room.area ? `${qtyText(room.area, 2)} м² · ` : ''}${totals.lineCount || 0} ${plural(totals.lineCount || 0, 'позиция', 'позиции', 'позиций')}</small>
        </span>
        <span class="room-money">
          <span>Работы <b>${fmt(totals.works)}</b></span>
          <span>Материалы <b>${fmt(totals.materials)}</b></span>
        </span>
        <span class="room-total">${fmt(totals.total)}</span>
        <span class="room-chevron">${icon('chevronRight', 18)}</span>
      </a>
      <div class="room-row-actions">
        <button class="icon-btn" type="button" data-edit-room="${room.id}" title="Редактировать помещение" aria-label="Редактировать помещение">${icon('pencil', 16)}</button>
        <button class="icon-btn icon-btn--danger" type="button" data-delete-room="${room.id}" title="Удалить помещение" aria-label="Удалить помещение">${icon('trash', 16)}</button>
      </div>
    </div>`;
}

function linkPanelHtml(project) {
  if (project.publicEnabled && project.publicToken) {
    const url = `${location.origin}/p/${project.publicToken}`;
    return `
      <section class="link-panel link-panel--active">
        <div class="link-icon">${icon('link', 20)}</div>
        <div class="link-body">
          <div class="link-head">
            <h3>Клиентская ссылка</h3>
            <span class="badge badge--success"><span class="dot"></span>Активна</span>
          </div>
          <p class="link-desc">Заказчик открывает смету без регистрации и видит только этот объект. Ссылка всегда показывает актуальные данные.</p>
          <div class="copy-field">
            <input type="text" readonly value="${esc(url)}" id="public-url-input" aria-label="Публичная ссылка">
            <button class="btn btn-soft btn-sm" type="button" data-link-action="copy">${icon('copy', 15)} Копировать</button>
          </div>
          <div class="link-actions">
            <a class="btn btn-ghost btn-sm" href="/p/${esc(project.publicToken)}" target="_blank" rel="noopener">${icon('external', 15)} Открыть</a>
            <button class="btn btn-ghost btn-sm" type="button" data-link-action="regenerate">${icon('refresh', 15)} Обновить ссылку</button>
            <button class="btn btn-ghost btn-sm btn-ghost--danger" type="button" data-link-action="revoke">${icon('x', 15)} Отозвать</button>
          </div>
        </div>
      </section>`;
  }
  return `
    <section class="link-panel">
      <div class="link-icon link-icon--muted">${icon('lock', 20)}</div>
      <div class="link-body">
        <div class="link-head">
          <h3>Клиентская ссылка</h3>
          <span class="badge badge--muted">Отключена</span>
        </div>
        <p class="link-desc">Создайте публичную ссылку, чтобы отправить смету заказчику. Доступ будет только для чтения.</p>
        <div class="link-actions">
          <button class="btn btn-primary btn-sm" type="button" data-link-action="create">${icon('link', 15)} Создать ссылку</button>
        </div>
      </div>
    </section>`;
}

function refreshLinkPanel() {
  const slot = $('#link-slot');
  if (slot && state.project) slot.innerHTML = linkPanelHtml(state.project);
}

function bindProject(project) {
  $('#edit-project-btn')?.addEventListener('click', () => {
    openProjectForm(project, (updated) => paintProject(updated));
  });

  $('#delete-project-btn')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Удалить объект?',
      message: `Объект «${project.name}» и все его помещения со сметами будут удалены безвозвратно.`,
      confirmText: 'Удалить объект',
    });
    if (!confirmed) return;
    try {
      await api(`/projects/${project.id}`, { method: 'DELETE' });
      toast('Объект удалён');
      navigate('/app');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#download-pdf-btn')?.addEventListener('click', () => downloadPdf(project.id));

  $('#add-room-btn')?.addEventListener('click', () => openRoomForm(project, null, (updated) => paintProject(updated)));
  $('#empty-add-room')?.addEventListener('click', () => openRoomForm(project, null, (updated) => paintProject(updated)));

  $('#rooms-list')?.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-room]');
    if (edit) {
      event.preventDefault();
      const room = project.rooms.find((item) => item.id === Number(edit.dataset.editRoom));
      if (room) openRoomForm(project, room, () => renderProjectPage(project.id));
      return;
    }
    const remove = event.target.closest('[data-delete-room]');
    if (remove) {
      event.preventDefault();
      const room = project.rooms.find((item) => item.id === Number(remove.dataset.deleteRoom));
      if (!room) return;
      const confirmed = await confirmDialog({
        title: 'Удалить помещение?',
        message: `Помещение «${room.name}» и все его работы и материалы будут удалены.`,
        confirmText: 'Удалить помещение',
      });
      if (!confirmed) return;
      try {
        await api(`/rooms/${room.id}`, { method: 'DELETE' });
        toast('Помещение удалено');
        const { project: updated } = await api(`/projects/${project.id}`);
        paintProject(updated);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  $('#link-slot')?.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-link-action]')?.dataset.linkAction;
    if (!action) return;
    if (action === 'copy') {
      const input = $('#public-url-input');
      try {
        await navigator.clipboard.writeText(input.value);
        toast('Ссылка скопирована');
      } catch {
        input.select();
        document.execCommand('copy');
        toast('Ссылка скопирована');
      }
      return;
    }
    if (action === 'create' || action === 'regenerate') {
      if (action === 'regenerate') {
        const confirmed = await confirmDialog({
          title: 'Обновить ссылку?',
          message: 'Старая ссылка перестанет работать. Отправьте заказчику новую.',
          confirmText: 'Обновить ссылку',
          danger: false,
        });
        if (!confirmed) return;
      }
      try {
        const { project: updated } = await api(`/projects/${project.id}/public-link`, {
          method: 'POST',
          body: { regenerate: action === 'regenerate' },
        });
        state.project = updated;
        refreshLinkPanel();
        toast(action === 'create' ? 'Ссылка создана' : 'Ссылка обновлена');
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    if (action === 'revoke') {
      const confirmed = await confirmDialog({
        title: 'Отозвать ссылку?',
        message: 'Заказчик больше не сможет открыть смету по этой ссылке. При необходимости создайте новую.',
        confirmText: 'Отозвать',
      });
      if (!confirmed) return;
      try {
        const { project: updated } = await api(`/projects/${project.id}/public-link`, { method: 'DELETE' });
        state.project = updated;
        refreshLinkPanel();
        toast('Ссылка отозвана');
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
}

function openRoomForm(project, room, onSaved) {
  const isEdit = Boolean(room);
  const { close } = openModal({
    title: isEdit ? 'Редактировать помещение' : 'Новое помещение',
    subtitle: isEdit ? 'Название, площадь и заметка' : `Объект «${project.name}»`,
    size: 'md',
    body: `
      <form class="form-grid" id="room-form" novalidate>
        <div class="form-error" hidden></div>
        ${field({ label: 'Название помещения', name: 'name', value: room?.name || '', placeholder: 'Кухня, спальня, санузел…', required: true, span: true })}
        <div class="field-row">
          ${field({ label: 'Площадь, м²', name: 'area', value: room?.area ? qtyText(room.area, 2) : '', placeholder: '12', inputmode: 'decimal' })}
          <div class="field field--hint">
            <span class="field-label">Как это работает</span>
            <p class="field-static">Площадь подставляется в новые материалы как база для расчёта по норме расхода.</p>
          </div>
        </div>
        ${textareaField({ label: 'Описание', name: 'description', value: room?.description || '', placeholder: 'Необязательно', rows: 2 })}
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-modal-close>Отмена</button>
          <button class="btn btn-primary" type="submit">${isEdit ? 'Сохранить' : 'Добавить помещение'}</button>
        </div>
      </form>`,
    onMount(modalRoot) {
      const form = $('#room-form', modalRoot);
      bindFormSubmit(form, async () => {
        const payload = {
          name: formValue(form, 'name'),
          area: formValue(form, 'area'),
          description: formValue(form, 'description'),
        };
        if (!payload.name) throw new ApiError('Укажите название помещения', 422);
        const result = isEdit
          ? await api(`/rooms/${room.id}`, { method: 'PATCH', body: payload })
          : await api(`/projects/${project.id}/rooms`, { method: 'POST', body: payload });
        close();
        toast(isEdit ? 'Помещение обновлено' : 'Помещение добавлено');
        onSaved(isEdit ? result : result.project);
      });
    },
  });
}

async function downloadPdf(projectId) {
  try {
    const response = await fetch(`/api/projects/${projectId}/pdf`, { credentials: 'same-origin' });
    if (response.status === 401) {
      navigate('/login', { replace: true });
      return;
    }
    if (!response.ok) throw new Error('Не удалось сформировать PDF');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `smeta-${projectId}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('PDF сформирован');
  } catch (error) {
    toast(error.message || 'Ошибка экспорта PDF', 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Помещение и конструктор сметы                                      */
/* ------------------------------------------------------------------ */

async function renderRoomPage(id) {
  setView(shell(loadingShell('projects'), 'projects'), { title: 'Помещение' });
  bindShell();
  try {
    const data = await api(`/rooms/${id}`);
    state.room = { ...data.room, lines: data.lines };
    state.roomProject = data.project;
    state.roomProjectTotals = data.projectTotals;
    const { project } = await api(`/projects/${data.project.id}`);
    state.project = project;
    paintRoom();
  } catch (error) {
    setView(errorView(error.message, 'projects'), { title: 'Ошибка' });
    bindShell();
  }
}

function paintRoom() {
  setView(shell(roomHtml(), 'projects'), { title: `${state.room.name} — смета` });
  bindShell();
  bindRoomPage();
  lastSavedAt = null;
  setSaveState('saved', { silent: true });
}

function roomHtml() {
  const room = state.room;
  const project = state.project;
  const totals = room.totals || { works: 0, materials: 0, total: 0, lineCount: 0 };
  const projectLinkEnabled = Boolean(project?.publicEnabled && project?.publicToken);

  return `
    <div class="breadcrumbs">
      <a href="/app" data-link>Объекты</a>${icon('chevronRight', 14)}
      <a href="/app/projects/${project?.id}" data-link>${esc(project?.name || state.roomProject?.name || 'Объект')}</a>${icon('chevronRight', 14)}
      <span>${esc(room.name)}</span>
    </div>

    <div class="page-head page-head--room">
      <div class="page-head-main">
        <span class="eyebrow">Смета помещения</span>
        <h1>${esc(room.name)}</h1>
        <p class="page-sub">${room.area ? `${qtyText(room.area, 2)} м² · ` : ''}${totals.lineCount || 0} ${plural(totals.lineCount || 0, 'позиция', 'позиции', 'позиций')} · <span class="save-inline" id="save-inline">все изменения сохранены</span></p>
        ${room.description ? `<p class="room-note">${esc(room.description)}</p>` : ''}
      </div>
      <div class="page-actions page-actions--inline">
        <button class="btn btn-ghost" type="button" id="edit-room-btn">${icon('pencil', 16)} Изменить</button>
        <button class="btn btn-ghost btn-ghost--danger" type="button" id="delete-room-btn">${icon('trash', 16)} Удалить</button>
      </div>
    </div>

    <div class="builder">
      <div class="builder-main">
        <section class="panel" id="works-panel">${worksPanelInner()}</section>
        <section class="panel" id="materials-panel">${materialsPanelInner()}</section>
      </div>
      <aside class="builder-aside">
        <div class="totals-card">
          <div class="totals-head">
            <span>Итого по помещению</span>
            <strong id="totals-grand">${fmt(totals.total)}</strong>
          </div>
          <div class="totals-rows">
            <div class="total-row"><span>Работы</span><b id="totals-works">${fmt(totals.works)}</b></div>
            <div class="total-row"><span>Материалы</span><b id="totals-materials">${fmt(totals.materials)}</b></div>
          </div>
          <div class="mini-bar"><span id="mini-bar-works" style="width:${totals.total > 0 ? ((totals.works / totals.total) * 100).toFixed(1) : 0}%"></span></div>
          <div class="totals-foot">
            <span id="line-count">${totals.lineCount || 0} ${plural(totals.lineCount || 0, 'позиция', 'позиции', 'позиций')}</span>
            <span class="save-state" id="save-state">Сохранено</span>
          </div>
        </div>
        <div class="aside-actions">
          ${
            projectLinkEnabled
              ? `<a class="btn btn-ghost btn-block" href="/p/${esc(project.publicToken)}" target="_blank" rel="noopener">${icon('external', 16)} Клиентская версия</a>`
              : `<span class="aside-hint">${icon('lock', 15)} Публичная ссылка не создана</span>`
          }
          <button class="btn btn-ghost btn-block" type="button" id="pdf-room-btn">${icon('download', 16)} Скачать PDF</button>
        </div>
      </aside>
    </div>`;
}

function worksPanelInner() {
  const works = state.room.lines.works;
  const sum = state.room.totals?.works || 0;
  return `
    <div class="panel-head">
      <div>
        <h2>Работы <span class="count-pill">${works.length}</span></h2>
        <p>Объём × цена. Цена и единица подставлены из справочника.</p>
      </div>
      <button class="btn btn-soft btn-sm" type="button" data-add-work>${icon('plus', 16)} Добавить работу</button>
    </div>
    ${works.length ? `
      <div class="table-wrap">
        <table class="line-table">
          <thead>
            <tr>
              <th class="cell-num">№</th>
              <th>Работа</th>
              <th class="cell-qty">Объём</th>
              <th class="cell-unit">Ед.</th>
              <th class="cell-price">Цена</th>
              <th class="cell-amount">Сумма</th>
              <th class="cell-actions"></th>
            </tr>
          </thead>
          <tbody>${works.map((line, index) => workRowHtml(line, index)).join('')}</tbody>
        </table>
      </div>` : `
      <div class="empty-strip">
        <span>${icon('wrench', 20)}</span>
        <p>Пока нет ни одной работы. Добавьте первую позицию из справочника.</p>
        <button class="btn btn-soft btn-sm" type="button" data-add-work>${icon('plus', 15)} Добавить</button>
      </div>`}
    <div class="panel-sum">Работы: <b>${fmt(sum)}</b></div>`;
}

function materialsPanelInner() {
  const materials = state.room.lines.materials;
  const sum = state.room.totals?.materials || 0;
  return `
    <div class="panel-head">
      <div>
        <h2>Материалы <span class="count-pill">${materials.length}</span></h2>
        <p>Ручной ввод или автоматический расчёт по норме расхода.</p>
      </div>
      <button class="btn btn-soft btn-sm" type="button" data-add-material>${icon('plus', 16)} Добавить материал</button>
    </div>
    ${materials.length ? `
      <div class="table-wrap">
        <table class="line-table line-table--materials">
          <thead>
            <tr>
              <th class="cell-num">№</th>
              <th>Материал</th>
              <th class="cell-qty">Кол-во</th>
              <th class="cell-unit">Ед.</th>
              <th class="cell-price">Цена</th>
              <th class="cell-amount">Сумма</th>
              <th class="cell-actions"></th>
            </tr>
          </thead>
          <tbody>${materials.map((line, index) => materialRowHtml(line, index)).join('')}</tbody>
        </table>
      </div>` : `
      <div class="empty-strip">
        <span>${icon('box', 20)}</span>
        <p>Материалов пока нет. Добавьте штукатурку, плитку или клей из справочника.</p>
        <button class="btn btn-soft btn-sm" type="button" data-add-material>${icon('plus', 15)} Добавить</button>
      </div>`}
    <div class="panel-sum">Материалы: <b>${fmt(sum)}</b></div>`;
}

function workRowHtml(line, index) {
  return `
    <tr data-line-id="${line.id}" data-kind="work">
      <td class="cell-num" data-label="№">${index + 1}</td>
      <td class="cell-name" data-label="Работа">
        <div class="line-title">${esc(line.name)}</div>
        <div class="line-sub">${esc(line.category || 'Без категории')}</div>
      </td>
      <td class="cell-qty" data-label="Объём" data-unit="${esc(shortUnit(line.unit))}">
        <input class="input input--cell" type="text" inputmode="decimal" value="${esc(qtyText(line.quantity))}" data-line-field="quantity" data-qty-input aria-label="Объём">
      </td>
      <td class="cell-unit" data-label="Ед.">${esc(shortUnit(line.unit))}</td>
      <td class="cell-price" data-label="Цена">
        <div class="money-input">
          <input class="input input--cell input--money" type="text" inputmode="decimal" value="${esc(kopecksToInput(line.priceKopecks))}" data-line-field="price" data-price-input aria-label="Цена за единицу">
          <span>${esc(currencySymbolForInput())}</span>
        </div>
      </td>
      <td class="cell-amount" data-label="Сумма"><b data-amount>${fmt(line.amountKopecks)}</b></td>
      <td class="cell-actions">
        <div class="row-actions">
          <button class="icon-btn icon-btn--xs" type="button" data-move-line="up" title="Выше" aria-label="Переместить выше" ${index === 0 ? 'disabled' : ''}>${icon('arrowUp', 14)}</button>
          <button class="icon-btn icon-btn--xs" type="button" data-move-line="down" title="Ниже" aria-label="Переместить ниже">${icon('arrowDown', 14)}</button>
          <button class="icon-btn icon-btn--xs icon-btn--danger" type="button" data-delete-line title="Удалить" aria-label="Удалить строку">${icon('trash', 14)}</button>
        </div>
      </td>
    </tr>`;
}

function materialRowHtml(line, index) {
  const isAuto = line.calcMode === 'auto';
  return `
    <tr data-line-id="${line.id}" data-kind="material" class="${isAuto ? 'is-auto' : ''}">
      <td class="cell-num" data-label="№">${index + 1}</td>
      <td class="cell-name" data-label="Материал">
        <div class="line-title">${esc(line.name)}</div>
        <div class="line-sub">
          <span class="mode-badge ${isAuto ? 'mode-badge--auto' : ''}">${isAuto ? 'авто' : 'вручную'}</span>
          <span data-line-detail>${lineDetailHtml(line)}</span>
        </div>
        <button class="calc-toggle" type="button" data-toggle-calc aria-expanded="false">${icon('calculator', 14)} Расчёт</button>
      </td>
      <td class="cell-qty" data-label="Кол-во" data-unit="${esc(shortUnit(line.unit))}">
        <input class="input input--cell" type="text" inputmode="decimal" value="${esc(qtyText(line.quantity))}" data-line-field="quantity" data-qty-input aria-label="Количество упаковок" ${isAuto ? 'readonly' : ''}>
      </td>
      <td class="cell-unit" data-label="Ед.">${esc(shortUnit(line.unit))}</td>
      <td class="cell-price" data-label="Цена">
        <div class="money-input">
          <input class="input input--cell input--money" type="text" inputmode="decimal" value="${esc(kopecksToInput(line.priceKopecks))}" data-line-field="price" data-price-input aria-label="Цена за единицу">
          <span>${esc(currencySymbolForInput())}</span>
        </div>
      </td>
      <td class="cell-amount" data-label="Сумма"><b data-amount>${fmt(line.amountKopecks)}</b></td>
      <td class="cell-actions">
        <div class="row-actions">
          <button class="icon-btn icon-btn--xs" type="button" data-move-line="up" title="Выше" aria-label="Переместить выше" ${index === 0 ? 'disabled' : ''}>${icon('arrowUp', 14)}</button>
          <button class="icon-btn icon-btn--xs" type="button" data-move-line="down" title="Ниже" aria-label="Переместить ниже">${icon('arrowDown', 14)}</button>
          <button class="icon-btn icon-btn--xs icon-btn--danger" type="button" data-delete-line title="Удалить" aria-label="Удалить строку">${icon('trash', 14)}</button>
        </div>
      </td>
    </tr>
    ${calcRowHtml(line)}`;
}

function calcRowHtml(line) {
  const hasRate = Boolean(line.consumptionRate);
  return `
    <tr class="calc-row" data-calc-id="${line.id}" hidden>
      <td colspan="7">
        <div class="calc-panel">
          <div class="calc-head">
            <div>
              <strong>Расчёт количества</strong>
              <span class="mode-badge ${line.calcMode === 'auto' ? 'mode-badge--auto' : ''}">${line.calcMode === 'auto' ? 'автоматический' : 'ручной'}</span>
            </div>
            <div class="segmented" role="group" aria-label="Режим расчёта">
              <button type="button" data-mode="auto" class="${line.calcMode === 'auto' ? 'is-active' : ''}">Авто</button>
              <button type="button" data-mode="manual" class="${line.calcMode !== 'auto' ? 'is-active' : ''}">Вручную</button>
            </div>
          </div>
          <div class="calc-grid">
            <label class="field field--compact">
              <span class="field-label">Площадь, м²</span>
              <input class="input" type="text" inputmode="decimal" value="${line.calcArea ? esc(qtyText(line.calcArea, 2)) : ''}" data-line-field="calcArea" aria-label="Площадь для расчёта">
            </label>
            <label class="field field--compact">
              <span class="field-label">Норма расхода, ${esc(line.consumptionUnit || 'ед.')}/м²</span>
              <input class="input" type="text" inputmode="decimal" value="${line.consumptionRate ? esc(qtyText(line.consumptionRate, 3)) : ''}" data-line-field="consumptionRate" aria-label="Норма расхода">
            </label>
            <label class="field field--compact">
              <span class="field-label">Упаковка, ${esc(line.consumptionUnit || 'ед.')}</span>
              <input class="input" type="text" inputmode="decimal" value="${line.packageSize ? esc(qtyText(line.packageSize, 3)) : ''}" data-line-field="packageSize" aria-label="Размер упаковки">
            </label>
          </div>
          <div class="calc-formula" data-formula="${line.id}">${formulaHtml(line)}</div>
          <p class="calc-hint">${hasRate ? 'Количество упаковок округляется вверх. Рассчитанное количество можно скорректировать вручную.' : 'В справочнике не задана норма расхода — количество вводится вручную.'}</p>
          ${line.calcMode === 'auto' ? `<button class="link-btn" type="button" data-edit-quantity>Скорректировать количество вручную</button>` : ''}
        </div>
      </td>
    </tr>`;
}

function lineDetailHtml(line) {
  if (line.calcMode === 'auto' && line.calcArea && line.consumptionRate) {
    return `${qtyText(line.calcArea, 2)} м² × ${qtyText(line.consumptionRate, 3)} ${esc(line.consumptionUnit || '')}/м²`;
  }
  if (line.packageSize) {
    return `упаковка ${qtyText(line.packageSize, 3)} ${esc(line.consumptionUnit || '')}`;
  }
  return 'количество вводится вручную';
}

function formulaHtml(line) {
  const area = parseDecimal(line.calcArea);
  const rate = parseDecimal(line.consumptionRate);
  const pack = parseDecimal(line.packageSize);
  if (area === null || rate === null) return 'Задайте площадь и норму расхода для автоматического расчёта.';
  const required = computeMaterialQuantity({ calcArea: area, consumptionRate: rate, packageSize: pack });
  const requiredText = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(required.requiredMicro) / 1e6);
  const unit = esc(line.consumptionUnit || '');
  if (pack && Number(pack) > 0) {
    return `${qtyText(line.calcArea, 2)} м² × ${qtyText(line.consumptionRate, 3)} ${unit}/м² = ${requiredText} ${unit} · ${required.packages} ${esc(line.unit)} по ${qtyText(line.packageSize, 3)} ${unit}`;
  }
  return `${qtyText(line.calcArea, 2)} м² × ${qtyText(line.consumptionRate, 3)} ${unit}/м² = ${requiredText} ${unit}`;
}

function currencySymbolForInput() {
  const symbols = { RUB: '₽', USD: '$', EUR: '€', KZT: '₸', BYN: 'Br', UAH: '₴', GEL: '₾', AMD: '֏', UZS: 'soʻm' };
  return symbols[currency()] || currency();
}

function bindRoomPage() {
  const room = state.room;
  const project = state.project;

  $('#add-work-btn')?.addEventListener('click', () => openLinePicker('work'));

  $('#works-panel')?.addEventListener('click', handleLinePanelClick);
  $('#materials-panel')?.addEventListener('click', handleLinePanelClick);

  $('#edit-room-btn')?.addEventListener('click', () => openRoomForm(project, state.room, async () => {
    const data = await api(`/rooms/${room.id}`);
    state.room = { ...data.room, lines: data.lines };
    paintRoom();
  }));

  $('#delete-room-btn')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Удалить помещение?',
      message: `Помещение «${room.name}» и все его позиции будут удалены.`,
      confirmText: 'Удалить помещение',
    });
    if (!confirmed) return;
    try {
      await api(`/rooms/${room.id}`, { method: 'DELETE' });
      toast('Помещение удалено');
      navigate(`/app/projects/${project.id}`);
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#pdf-room-btn')?.addEventListener('click', () => downloadPdf(project.id));
}

async function handleLinePanelClick(event) {
  const target = event.target;
  if (target.closest('[data-add-work]')) {
    openLinePicker('work');
    return;
  }
  if (target.closest('[data-add-material]')) {
    openLinePicker('material');
    return;
  }
  const toggle = target.closest('[data-toggle-calc]');
  if (toggle) {
    const row = toggle.closest('tr[data-line-id]');
    const calcRow = document.querySelector(`[data-calc-id="${row.dataset.lineId}"]`);
    if (calcRow) {
      calcRow.hidden = !calcRow.hidden;
      toggle.setAttribute('aria-expanded', String(!calcRow.hidden));
      toggle.classList.toggle('is-open', !calcRow.hidden);
    }
    return;
  }

  const context = lineContext(target);
  if (!context) return;
  const { lineId, kind } = context;

  const modeButton = target.closest('[data-mode]');
  if (modeButton) {
    const mode = modeButton.dataset.mode;
    const item = findLine(lineId);
    if (!item || item.calcMode === mode) return;
    await flushLinePatch(lineId);
    try {
      const response = await api(`/lines/${lineId}`, { method: 'PATCH', body: { mode } });
      applyLineUpdate(response.line);
      state.room.totals = response.roomTotals;
      state.roomProjectTotals = response.projectTotals;
      refreshRoomSections();
      updateTotalsDom();
      setSaveState('saved');
    } catch (error) {
      toast(error.message, 'error');
    }
    return;
  }

  if (target.closest('[data-edit-quantity]')) {
    await flushLinePatch(lineId);
    try {
      const response = await api(`/lines/${lineId}`, { method: 'PATCH', body: { mode: 'manual' } });
      applyLineUpdate(response.line);
      state.room.totals = response.roomTotals;
      state.roomProjectTotals = response.projectTotals;
      refreshRoomSections();
      updateTotalsDom();
      setSaveState('saved');
      setTimeout(() => document.querySelector(`tr[data-line-id="${lineId}"] [data-qty-input]`)?.focus(), 50);
    } catch (error) {
      toast(error.message, 'error');
    }
    return;
  }

  const move = target.closest('[data-move-line]');
  if (move) {
    const key = kind === 'work' ? 'works' : 'materials';
    const lines = [...state.room.lines[key]];
    const index = lines.findIndex((line) => line.id === lineId);
    const direction = move.dataset.moveLine === 'up' ? -1 : 1;
    const next = index + direction;
    if (index < 0 || next < 0 || next >= lines.length) return;
    [lines[index], lines[next]] = [lines[next], lines[index]];
    try {
      const response = await api(`/rooms/${state.room.id}/lines/reorder`, {
        method: 'POST',
        body: { kind, ids: lines.map((line) => line.id) },
      });
      state.room = { ...response.room.room, lines: response.room.lines };
      state.roomProjectTotals = response.projectTotals;
      refreshRoomSections();
      updateTotalsDom();
    } catch (error) {
      toast(error.message, 'error');
    }
    return;
  }

  const remove = target.closest('[data-delete-line]');
  if (remove) {
    const item = findLine(lineId);
    const confirmed = await confirmDialog({
      title: 'Удалить строку?',
      message: `«${item?.name || 'Позиция'}» будет удалена из сметы помещения.`,
      confirmText: 'Удалить строку',
    });
    if (!confirmed) return;
    const pending = pendingSaves.get(lineId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingSaves.delete(lineId);
    }
    try {
      const response = await api(`/lines/${lineId}`, { method: 'DELETE' });
      const key = kind === 'work' ? 'works' : 'materials';
      state.room.lines[key] = state.room.lines[key].filter((line) => line.id !== lineId);
      state.room.totals = response.roomTotals;
      state.roomProjectTotals = response.projectTotals;
      refreshRoomSections();
      updateTotalsDom();
      setSaveState('saved');
      toast('Строка удалена');
    } catch (error) {
      toast(error.message, 'error');
    }
  }
}

function lineContext(target) {
  const row = target.closest('tr[data-line-id]');
  if (row) return { lineId: Number(row.dataset.lineId), kind: row.dataset.kind };
  const calcRow = target.closest('tr[data-calc-id]');
  if (!calcRow) return null;
  const lineId = Number(calcRow.dataset.calcId);
  const line = findLine(lineId);
  return { lineId, kind: line?.kind };
}

function findLine(lineId) {
  if (!state.room) return null;
  return [...state.room.lines.works, ...state.room.lines.materials].find((line) => line.id === lineId) || null;
}

function refreshRoomSections() {
  const worksPanel = $('#works-panel');
  const materialsPanel = $('#materials-panel');
  if (worksPanel) worksPanel.innerHTML = worksPanelInner();
  if (materialsPanel) materialsPanel.innerHTML = materialsPanelInner();
  updateTotalsDom();
}

function updateTotalsDom() {
  if (!state.room?.totals) return;
  const totals = state.room.totals;
  const setText = (selector, value) => {
    const element = $(selector);
    if (element) element.textContent = value;
  };
  setText('#totals-grand', fmt(totals.total));
  setText('#totals-works', fmt(totals.works));
  setText('#totals-materials', fmt(totals.materials));
  setText('#line-count', `${totals.lineCount || 0} ${plural(totals.lineCount || 0, 'позиция', 'позиции', 'позиций')}`);
  const bar = $('#mini-bar-works');
  if (bar) bar.style.width = `${totals.total > 0 ? ((totals.works / totals.total) * 100).toFixed(1) : 0}%`;
}

function setSaveState(status, { silent = false } = {}) {
  const element = $('#save-state');
  const inline = $('#save-inline');
  if (!element && !inline) return;
  let text = 'Сохранено';
  let inlineText = 'все изменения сохранены';
  if (status === 'saving') {
    text = 'Сохранение…';
    inlineText = 'сохранение…';
  } else if (status === 'error') {
    text = 'Ошибка сохранения';
    inlineText = 'не удалось сохранить';
  } else if (status === 'saved') {
    lastSavedAt = new Date();
    text = `Сохранено в ${timeFormatter.format(lastSavedAt)}`;
    inlineText = 'все изменения сохранены';
  }
  if (element) {
    element.textContent = text;
    element.classList.toggle('is-saving', status === 'saving');
    element.classList.toggle('is-error', status === 'error');
  }
  if (inline && !silent) inline.textContent = inlineText;
}

function queueLinePatch(lineId, patch) {
  let entry = pendingSaves.get(lineId);
  if (!entry) {
    entry = { patch: {}, timer: null };
    pendingSaves.set(lineId, entry);
  }
  Object.assign(entry.patch, patch);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushLinePatch(lineId), 550);
  setSaveState('saving');
}

async function flushLinePatch(lineId) {
  const entry = pendingSaves.get(lineId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingSaves.delete(lineId);
  if (!Object.keys(entry.patch).length) return;
  setSaveState('saving');
  try {
    const response = await api(`/lines/${lineId}`, { method: 'PATCH', body: entry.patch });
    applyLineUpdate(response.line);
    state.room.totals = response.roomTotals;
    state.roomProjectTotals = response.projectTotals;
    updateTotalsDom();
    setSaveState('saved');
  } catch (error) {
    setSaveState('error');
    toast(error.message, 'error');
  }
}

function applyLineUpdate(line) {
  if (!state.room) return;
  const key = line.kind === 'work' ? 'works' : 'materials';
  const lines = state.room.lines[key];
  const index = lines.findIndex((item) => item.id === line.id);
  if (index >= 0) lines[index] = line;
  const row = document.querySelector(`tr[data-line-id="${line.id}"]`);
  if (!row) return;
  const qty = row.querySelector('[data-qty-input]');
  if (qty && document.activeElement !== qty) qty.value = qtyText(line.quantity);
  const price = row.querySelector('[data-price-input]');
  if (price && document.activeElement !== price) price.value = kopecksToInput(line.priceKopecks);
  const amount = row.querySelector('[data-amount]');
  if (amount) amount.textContent = fmt(line.amountKopecks);
  const detail = row.querySelector('[data-line-detail]');
  if (detail) detail.innerHTML = lineDetailHtml(line);
  const formula = document.querySelector(`[data-formula="${line.id}"]`);
  if (formula) formula.innerHTML = formulaHtml(line);
}

async function flashRow(lineId) {
  const row = document.querySelector(`tr[data-line-id="${lineId}"]`);
  if (!row) return;
  row.classList.add('is-flashing');
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => row.classList.remove('is-flashing'), 1600);
}

async function ensureCatalogs(force = false) {
  if (!force && state.catalogs) return state.catalogs;
  const [works, materials] = await Promise.all([api('/catalog/works'), api('/catalog/materials')]);
  state.catalogs = { works: works.items, materials: materials.items };
  return state.catalogs;
}

async function openLinePicker(kind) {
  let catalogs;
  try {
    catalogs = await ensureCatalogs(true);
  } catch (error) {
    toast(error.message, 'error');
    return;
  }
  const items = (kind === 'work' ? catalogs.works : catalogs.materials).filter((item) => item.isActive);
  const title = kind === 'work' ? 'Добавить работу' : 'Добавить материал';
  const subtitle = kind === 'work' ? 'Выберите позицию из справочника работ' : 'Выберите материал из справочника';
  const empty = kind === 'work' ? 'В справочнике работ пока нет активных позиций.' : 'В справочнике материалов пока нет активных позиций.';
  const catalogHref = kind === 'work' ? '/app/catalog/works' : '/app/catalog/materials';

  if (!items.length) {
    openModal({
      title,
      subtitle,
      size: 'sm',
      body: `<div class="empty-state empty-state--inline"><span class="empty-icon">${icon(kind === 'work' ? 'wrench' : 'box', 26)}</span><h3>Справочник пуст</h3><p>${empty}</p><a class="btn btn-primary" href="${catalogHref}" data-link data-modal-close>Перейти в справочник</a></div>`,
    });
    return;
  }

  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const { root, close } = openModal({
    title,
    subtitle,
    size: 'lg',
    body: `
      <div class="picker">
        <div class="picker-search">
          ${icon('search', 18)}
          <input class="input" type="search" id="picker-search" placeholder="Начните вводить название…" aria-label="Поиск по справочнику">
          <kbd>Esc</kbd>
        </div>
        <div class="picker-categories" id="picker-categories">
          <button class="chip-button is-active" type="button" data-category="">Все</button>
          ${categories.map((category) => `<button class="chip-button" type="button" data-category="${esc(category)}">${esc(category)}</button>`).join('')}
        </div>
        <div class="picker-list" id="picker-list"></div>
        <p class="picker-hint">Единица измерения и цена подставятся автоматически и сохранятся в смете.</p>
      </div>`,
    onMount(modalRoot) {
      const list = $('#picker-list', modalRoot);
      const search = $('#picker-search', modalRoot);
      const categoryBar = $('#picker-categories', modalRoot);
      let activeCategory = '';
      let query = '';

      const render = () => {
        const filtered = items.filter((item) => {
          const matchesQuery = !query || `${item.name} ${item.category}`.toLowerCase().includes(query);
          const matchesCategory = !activeCategory || item.category === activeCategory;
          return matchesQuery && matchesCategory;
        });
        if (!filtered.length) {
          list.innerHTML = `<div class="picker-empty">${icon('search', 22)}<p>Ничего не найдено. Попробуйте другой запрос.</p></div>`;
          return;
        }
        list.innerHTML = filtered
          .map((item) => {
            const isMaterial = kind === 'material';
            const meta = isMaterial
              ? `${esc(item.purchaseUnit)}${item.packageSize ? ` · ${qtyText(item.packageSize, 3)} ${esc(item.consumptionUnit || '')}` : ''}${item.consumptionRate ? ` · норма ${qtyText(item.consumptionRate, 3)} ${esc(item.consumptionUnit || '')}/м²` : ' · ручной ввод'}`
              : `${esc(item.unit)} · ${esc(item.category || 'Без категории')}`;
            return `
              <button class="picker-item" type="button" data-add-item="${item.id}">
                <span class="picker-item-main">
                  <strong>${esc(item.name)}</strong>
                  <small>${meta}</small>
                </span>
                <span class="picker-item-price">${fmt(item.priceKopecks)}</span>
                <span class="picker-item-plus">${icon('plus', 16)}</span>
              </button>`;
          })
          .join('');
      };

      search.addEventListener('input', () => {
        query = search.value.trim().toLowerCase();
        render();
      });
      search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          const first = list.querySelector('[data-add-item]');
          if (first) {
            event.preventDefault();
            first.click();
          }
        }
      });
      categoryBar.addEventListener('click', (event) => {
        const button = event.target.closest('[data-category]');
        if (!button) return;
        activeCategory = button.dataset.category;
        $$('.chip-button', categoryBar).forEach((chip) => chip.classList.toggle('is-active', chip === button));
        render();
      });

      list.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-add-item]');
        if (!button) return;
        button.disabled = true;
        button.classList.add('is-loading');
        try {
          const response = await api(`/rooms/${state.room.id}/lines`, {
            method: 'POST',
            body: { kind, catalogId: Number(button.dataset.addItem) },
          });
          state.room = { ...response.room.room, lines: response.room.lines };
          state.roomProjectTotals = response.projectTotals;
          close();
          refreshRoomSections();
          updateTotalsDom();
          setSaveState('saved');
          toast(kind === 'work' ? 'Работа добавлена' : 'Материал добавлен');
          setTimeout(() => flashRow(response.line.id), 60);
        } catch (error) {
          button.disabled = false;
          button.classList.remove('is-loading');
          toast(error.message, 'error');
        }
      });

      render();
      setTimeout(() => search.focus(), 80);
    },
  });
  void root;
}

/* Глобальная обработка полей строк сметы */
document.addEventListener('input', (event) => {
  const field = event.target.closest('[data-line-field]');
  if (!field || !state.room) return;
  const context = lineContext(field);
  if (!context) return;
  const value = field.value;
  if (value.trim() === '') return;
  const map = {
    quantity: 'quantity',
    price: 'price',
    calcArea: 'calcArea',
    consumptionRate: 'consumptionRate',
    packageSize: 'packageSize',
  };
  const key = map[field.dataset.lineField];
  if (!key) return;
  queueLinePatch(context.lineId, { [key]: value });
});

document.addEventListener('focusout', (event) => {
  const field = event.target.closest('[data-line-field]');
  if (!field || !state.room) return;
  const context = lineContext(field);
  if (!context) return;
  flushLinePatch(context.lineId);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state.room) {
    for (const lineId of [...pendingSaves.keys()]) void flushLinePatch(lineId);
  }
});

/* ------------------------------------------------------------------ */
/* Справочники                                                        */
/* ------------------------------------------------------------------ */

async function renderCatalog(type) {
  const isWorks = type === 'works';
  setView(shell(loadingShell(isWorks ? 'works' : 'materials'), isWorks ? 'works' : 'materials'), {
    title: isWorks ? 'Справочник работ' : 'Справочник материалов',
  });
  bindShell();
  try {
    const data = await api(`/catalog/${type}`);
    state.catalog = { type, items: data.items, categories: data.categories };
    setView(shell(catalogHtml(type), isWorks ? 'works' : 'materials'), {
      title: isWorks ? 'Справочник работ' : 'Справочник материалов',
    });
    bindShell();
    bindCatalog(type);
  } catch (error) {
    setView(errorView(error.message, isWorks ? 'works' : 'materials'), { title: 'Ошибка' });
    bindShell();
  }
}

function catalogHtml(type) {
  const isWorks = type === 'works';
  const items = state.catalog.items;
  const activeCount = items.filter((item) => item.isActive).length;
  const categories = state.catalog.categories;

  return `
    <div class="page-head">
      <div class="page-head-main">
        <span class="eyebrow">Справочники</span>
        <h1>${isWorks ? 'Работы' : 'Материалы'}</h1>
        <p class="page-sub">${
          isWorks
            ? 'Базовые цены и единицы измерения. Изменения применяются к новым позициям смет.'
            : 'Параметры закупки и расхода. По нормам расхода количество упаковок считается автоматически.'
        }</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" type="button" id="manage-categories">${icon('sliders', 16)} Категории</button>
        <button class="btn btn-primary" type="button" id="add-catalog-item">${icon('plus', 16)} ${isWorks ? 'Добавить работу' : 'Добавить материал'}</button>
      </div>
    </div>

    <div class="catalog-stats">
      <span><b>${items.length}</b> ${plural(items.length, 'позиция', 'позиции', 'позиций')}</span>
      <span><b>${activeCount}</b> в работе</span>
      <span><b>${categories.length}</b> ${plural(categories.length, 'категория', 'категории', 'категорий')}</span>
    </div>

    <div class="panel">
      <div class="catalog-toolbar">
        <div class="search-field search-field--wide">
          ${icon('search', 17)}
          <input type="search" id="catalog-search" placeholder="Поиск по названию, категории или описанию…" aria-label="Поиск по справочнику">
        </div>
        <select class="input select" id="catalog-category" aria-label="Фильтр по категории">
          <option value="">Все категории</option>
          ${categories.map((category) => `<option value="${esc(category.name)}">${esc(category.name)} (${category.count})</option>`).join('')}
        </select>
        <label class="switch-line"><input type="checkbox" id="catalog-show-inactive" checked> <span>Показывать скрытые</span></label>
      </div>

      ${
        items.length
          ? `<div class="table-wrap">
              <table class="catalog-table" data-catalog-type="${type}">
                <thead>
                  <tr>
                    <th>Наименование</th>
                    ${isWorks ? '<th>Ед.</th><th class="num">Цена</th>' : '<th>Закупка</th><th>Расход</th><th class="num">Цена</th>'}
                    <th>Статус</th>
                    <th class="cell-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map((item) => catalogRowHtml(type, item)).join('')}
                </tbody>
              </table>
            </div>
            <div class="empty-note" id="catalog-no-results" hidden>По запросу ничего не найдено.</div>`
          : `<div class="empty-state empty-state--inline">
              <span class="empty-icon">${icon(isWorks ? 'wrench' : 'box', 28)}</span>
              <h3>Справочник пуст</h3>
              <p>Добавьте первую позицию — она сразу станет доступна в конструкторе смет.</p>
              <button class="btn btn-primary" type="button" data-empty-add>${icon('plus', 16)} Добавить</button>
            </div>`
      }
    </div>
    <p class="catalog-note">${icon('info', 15)} Изменение цены в справочнике не меняет ранее созданные сметы — в строках сохраняется снимок параметров.</p>
  `;
}

function catalogRowHtml(type, item) {
  const isWorks = type === 'works';
  const purchase = isWorks
    ? esc(item.unit)
    : `${esc(item.purchaseUnit)}${item.packageSize ? ` · ${qtyText(item.packageSize, 3)} ${esc(item.consumptionUnit || '')}` : ''}`;
  const consumption = isWorks
    ? ''
    : item.consumptionRate
      ? `${qtyText(item.consumptionRate, 3)} ${esc(item.consumptionUnit || '')}/м²`
      : 'ручной ввод';
  return `
    <tr data-item-row data-item-id="${item.id}" data-search="${esc(`${item.name} ${item.category} ${item.description}`.toLowerCase())}" data-category="${esc(item.category)}" data-active="${item.isActive ? '1' : '0'}">
      <td class="cell-name" data-label="Наименование">
        <div class="line-title">${esc(item.name)}</div>
        <div class="line-sub">
          ${item.category ? `<span class="tag">${esc(item.category)}</span>` : '<span class="tag tag--muted">Без категории</span>'}
          ${item.description ? `<span class="item-desc">${esc(truncate(item.description, 90))}</span>` : ''}
        </div>
      </td>
      ${isWorks ? `<td data-label="Ед.">${purchase}</td>` : `<td data-label="Закупка">${purchase}</td><td data-label="Расход">${consumption}</td>`}
      <td class="num" data-label="Цена">${fmt(item.priceKopecks)}</td>
      <td data-label="Статус">
        <span class="status ${item.isActive ? 'status--active' : 'status--muted'}"><span class="dot"></span>${item.isActive ? 'Активна' : 'Скрыта'}</span>
      </td>
      <td class="cell-actions">
        <div class="row-actions">
          <button class="icon-btn icon-btn--xs" type="button" data-toggle-item title="${item.isActive ? 'Скрыть' : 'Вернуть в работу'}" aria-label="Переключить статус">${icon(item.isActive ? 'eyeOff' : 'eye', 15)}</button>
          <button class="icon-btn icon-btn--xs" type="button" data-edit-item title="Изменить" aria-label="Изменить">${icon('pencil', 15)}</button>
          <button class="icon-btn icon-btn--xs icon-btn--danger" type="button" data-delete-item title="Удалить" aria-label="Удалить">${icon('trash', 15)}</button>
        </div>
      </td>
    </tr>`;
}

function bindCatalog(type) {
  const isWorks = type === 'works';

  const add = () => openCatalogForm(type, null, () => renderCatalog(type));
  $('#add-catalog-item')?.addEventListener('click', add);
  $$('[data-empty-add]').forEach((button) => button.addEventListener('click', add));

  $('#manage-categories')?.addEventListener('click', () => openCategoriesModal(type));

  const applyFilters = () => {
    const query = ($('#catalog-search')?.value || '').trim().toLowerCase();
    const category = $('#catalog-category')?.value || '';
    const showInactive = $('#catalog-show-inactive')?.checked ?? true;
    let visible = 0;
    $$('[data-item-row]').forEach((row) => {
      const matchesQuery = !query || (row.dataset.search || '').includes(query);
      const matchesCategory = !category || row.dataset.category === category;
      const matchesActive = showInactive || row.dataset.active === '1';
      const match = matchesQuery && matchesCategory && matchesActive;
      row.hidden = !match;
      if (match) visible += 1;
    });
    const empty = $('#catalog-no-results');
    if (empty) empty.hidden = visible > 0;
  };

  $('#catalog-search')?.addEventListener('input', applyFilters);
  $('#catalog-category')?.addEventListener('change', applyFilters);
  $('#catalog-show-inactive')?.addEventListener('change', applyFilters);

  $('table[data-catalog-type]')?.addEventListener('click', async (event) => {
    const row = event.target.closest('[data-item-row]');
    if (!row) return;
    const item = state.catalog.items.find((entry) => entry.id === Number(row.dataset.itemId));
    if (!item) return;

    if (event.target.closest('[data-edit-item]')) {
      openCatalogForm(type, item, () => renderCatalog(type));
      return;
    }
    if (event.target.closest('[data-toggle-item]')) {
      try {
        await api(`/catalog/${type}/${item.id}`, { method: 'PATCH', body: { isActive: !item.isActive } });
        toast(item.isActive ? 'Позиция скрыта из справочника' : 'Позиция снова активна');
        renderCatalog(type);
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    if (event.target.closest('[data-delete-item]')) {
      const used = item.usageCount > 0;
      const confirmed = await confirmDialog({
        title: 'Удалить позицию?',
        message: used
          ? `«${item.name}» используется в ${item.usageCount} ${plural(item.usageCount, 'строке', 'строках', 'строках')} смет. В сметах сохранятся прежние названия и цены, но позиция исчезнет из справочника.`
          : `«${item.name}» будет удалена из справочника.`,
        confirmText: 'Удалить позицию',
      });
      if (!confirmed) return;
      try {
        await api(`/catalog/${type}/${item.id}`, { method: 'DELETE' });
        toast('Позиция удалена');
        renderCatalog(type);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  void isWorks;
}

function openCatalogForm(type, item, onSaved) {
  const isWorks = type === 'works';
  const isEdit = Boolean(item);
  const categories = state.catalog.categories.map((category) => category.name);
  const datalistId = `categories-${type}-${Date.now()}`;

  const workFields = `
    ${field({ label: 'Название работы', name: 'name', value: item?.name || '', placeholder: 'Например, Штукатурка стен по маякам', required: true, span: true })}
    <div class="field-row">
      ${field({ label: 'Категория', name: 'category', value: item?.category || '', placeholder: 'Черновые работы' })}
      ${field({ label: 'Единица измерения', name: 'unit', value: item?.unit || 'м²', placeholder: 'м², пог. м, шт.', required: true })}
    </div>
    ${field({ label: `Базовая цена, ${currencySymbolForInput()}`, name: 'price', value: item ? kopecksToInput(item.priceKopecks) : '', placeholder: '650', required: true, inputmode: 'decimal' })}
    ${textareaField({ label: 'Описание', name: 'description', value: item?.description || '', placeholder: 'Необязательное пояснение для сметчика', rows: 3 })}`;

  const materialFields = `
    ${field({ label: 'Название материала', name: 'name', value: item?.name || '', placeholder: 'Например, Штукатурка гипсовая', required: true, span: true })}
    <div class="field-row">
      ${field({ label: 'Категория', name: 'category', value: item?.category || '', placeholder: 'Смеси и растворы' })}
      ${field({ label: 'Единица закупки', name: 'purchaseUnit', value: item?.purchaseUnit || 'мешок', placeholder: 'мешок, упаковка, рулон, шт.', required: true })}
    </div>
    <div class="form-section-title">Параметры расхода</div>
    <div class="field-row">
      ${field({ label: 'Размер упаковки', name: 'packageSize', value: item?.packageSize ? qtyText(item.packageSize, 3) : '', placeholder: '30', hint: 'Например, 30 кг или 5,3 м². Оставьте пустым, если упаковка не нужна.', inputmode: 'decimal' })}
      ${field({ label: 'Единица расхода', name: 'consumptionUnit', value: item?.consumptionUnit || '', placeholder: 'кг, л, м²', hint: 'В чём измеряется норма расхода.' })}
    </div>
    ${field({ label: 'Норма расхода на 1 м²', name: 'consumptionRate', value: item?.consumptionRate ? qtyText(item.consumptionRate, 3) : '', placeholder: '10', inputmode: 'decimal', hint: 'Если заполнена, материал рассчитывается автоматически. Без нормы — только ручной ввод.' })}
    ${field({ label: `Базовая цена за единицу закупки, ${currencySymbolForInput()}`, name: 'price', value: item ? kopecksToInput(item.priceKopecks) : '', placeholder: '450', required: true, inputmode: 'decimal' })}
    ${textareaField({ label: 'Описание', name: 'description', value: item?.description || '', placeholder: 'Необязательное пояснение', rows: 2 })}`;

  const { close } = openModal({
    title: isEdit ? (isWorks ? 'Редактировать работу' : 'Редактировать материал') : isWorks ? 'Новая работа' : 'Новый материал',
    subtitle: 'Позиция справочника. Уже добавленные строки смет не изменятся.',
    size: 'md',
    body: `
      <form class="form-grid" id="catalog-form" novalidate>
        <div class="form-error" hidden></div>
        ${isWorks ? workFields : materialFields}
        <datalist id="${datalistId}">${categories.map((category) => `<option value="${esc(category)}"></option>`).join('')}</datalist>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-modal-close>Отмена</button>
          <button class="btn btn-primary" type="submit">${isEdit ? 'Сохранить' : 'Добавить в справочник'}</button>
        </div>
      </form>`,
    onMount(modalRoot) {
      const form = $('#catalog-form', modalRoot);
      const categoryInput = form.elements.category;
      if (categoryInput) categoryInput.setAttribute('list', datalistId);
      bindFormSubmit(form, async () => {
        const payload = {
          name: formValue(form, 'name'),
          category: formValue(form, 'category'),
          price: formValue(form, 'price'),
          description: formValue(form, 'description'),
        };
        if (isWorks) {
          payload.unit = formValue(form, 'unit');
        } else {
          payload.purchaseUnit = formValue(form, 'purchaseUnit');
          payload.packageSize = formValue(form, 'packageSize');
          payload.consumptionUnit = formValue(form, 'consumptionUnit');
          payload.consumptionRate = formValue(form, 'consumptionRate');
        }
        if (!payload.name) throw new ApiError('Укажите название позиции', 422);
        if (isEdit) await api(`/catalog/${type}/${item.id}`, { method: 'PATCH', body: payload });
        else await api(`/catalog/${type}`, { method: 'POST', body: payload });
        close();
        toast(isEdit ? 'Изменения сохранены' : 'Позиция добавлена');
        onSaved();
      });
    },
  });
}

function openCategoriesModal(type) {
  const isWorks = type === 'works';
  const categories = state.catalog.categories;
  const { root, close } = openModal({
    title: isWorks ? 'Категории работ' : 'Категории материалов',
    subtitle: 'Переименование обновит категорию у всех позиций справочника.',
    size: 'md',
    body: `
      <div class="category-list">
        ${
          categories.length
            ? categories
                .map(
                  (category) => `
              <div class="category-row" data-category-row data-original="${esc(category.name)}">
                <input class="input" type="text" value="${esc(category.name)}" aria-label="Название категории">
                <span class="category-count">${category.count} ${plural(category.count, 'позиция', 'позиции', 'позиций')}</span>
                <button class="btn btn-soft btn-sm" type="button" data-save-category>Сохранить</button>
                <button class="icon-btn icon-btn--danger" type="button" data-delete-category title="Удалить категорию">${icon('trash', 16)}</button>
              </div>`,
                )
                .join('')
            : '<p class="empty-note">Категорий пока нет. Добавьте их при создании позиций.</p>'
        }
      </div>
      <p class="modal-hint">Удаление категории не удаляет позиции — они останутся без категории.</p>`,
    onMount(modalRoot) {
      modalRoot.addEventListener('click', async (event) => {
        const row = event.target.closest('[data-category-row]');
        if (!row) return;
        const original = row.dataset.original;
        if (event.target.closest('[data-save-category]')) {
          const input = row.querySelector('input');
          const next = input.value.trim();
          if (!next) {
            toast('Название категории не может быть пустым', 'error');
            return;
          }
          if (next === original) return;
          try {
            await api(`/catalog/${type}/categories/rename`, { method: 'POST', body: { from: original, to: next } });
            toast('Категория переименована');
            close();
            renderCatalog(type);
          } catch (error) {
            toast(error.message, 'error');
          }
          return;
        }
        if (event.target.closest('[data-delete-category]')) {
          const confirmed = await confirmDialog({
            title: 'Удалить категорию?',
            message: `Позиции категории «${original}» останутся в справочнике без категории.`,
            confirmText: 'Удалить категорию',
          });
          if (!confirmed) return;
          try {
            await api(`/catalog/${type}/categories/delete`, { method: 'POST', body: { name: original } });
            toast('Категория удалена');
            close();
            renderCatalog(type);
          } catch (error) {
            toast(error.message, 'error');
          }
        }
      });
    },
  });
  void root;
}

/* ------------------------------------------------------------------ */
/* Настройки                                                          */
/* ------------------------------------------------------------------ */

const AUDIT_LABELS = {
  login: 'Вход в панель',
  logout: 'Выход',
  login_failed: 'Неудачная попытка входа',
  password_changed: 'Смена пароля',
  'project.created': 'Создан объект',
  'project.updated': 'Изменён объект',
  'project.deleted': 'Удалён объект',
  'room.created': 'Добавлено помещение',
  'room.updated': 'Изменено помещение',
  'room.deleted': 'Удалено помещение',
  'line.created': 'Добавлена строка сметы',
  'line.updated': 'Изменена строка сметы',
  'line.deleted': 'Удалена строка сметы',
  'public_link.created': 'Создана клиентская ссылка',
  'public_link.regenerated': 'Обновлена клиентская ссылка',
  'public_link.revoked': 'Отозвана клиентская ссылка',
  'settings.updated': 'Изменены настройки',
  'work_catalog.created': 'Добавлена работа в справочник',
  'work_catalog.updated': 'Изменена работа в справочнике',
  'work_catalog.deleted': 'Удалена работа из справочника',
  'material_catalog.created': 'Добавлен материал в справочник',
  'material_catalog.updated': 'Изменён материал в справочнике',
  'material_catalog.deleted': 'Удалён материал из справочника',
  'work_catalog.category_renamed': 'Переименована категория работ',
  'material_catalog.category_renamed': 'Переименована категория материалов',
  'work_catalog.category_deleted': 'Удалена категория работ',
  'material_catalog.category_deleted': 'Удалена категория материалов',
  'pdf.exported': 'Экспорт PDF',
  'backup.created': 'Создана резервная копия',
};

const AUDIT_ENTITIES = {
  project: 'объект',
  room: 'помещение',
  estimate_line: 'строка сметы',
  work_catalog: 'справочник работ',
  material_catalog: 'справочник материалов',
  category: 'категория',
  settings: 'настройки',
  database: 'база данных',
  user: 'пользователь',
};

function renderSettings() {
  document.title = 'Настройки — Метраж';
  const settings = state.settings || {};
  setView(
    shell(
      `
    <div class="page-head">
      <div class="page-head-main">
        <span class="eyebrow">Настройки</span>
        <h1>Оформление и доступ</h1>
        <p class="page-sub">Данные организации, валюта и правила отображения сметы.</p>
      </div>
    </div>

    <div class="settings-grid">
      <section class="panel settings-panel">
        <div class="panel-head"><div><h2>Организация</h2><p>Показывается на клиентской странице и в PDF.</p></div></div>
        <form class="form-grid" id="settings-form">
          <div class="form-error" hidden></div>
          ${field({ label: 'Название компании', name: 'companyName', value: settings.companyName || '', placeholder: 'Метраж', required: true, span: true })}
          ${field({ label: 'Подзаголовок', name: 'companyTagline', value: settings.companyTagline || '', placeholder: 'Сметы на ремонт квартир', span: true })}
          <div class="field-row">
            ${field({ label: 'Телефон', name: 'companyPhone', value: settings.companyPhone || '', placeholder: '+7 900 000-00-00' })}
            ${field({ label: 'Электронная почта', name: 'companyEmail', value: settings.companyEmail || '', placeholder: 'info@example.ru' })}
          </div>
          ${field({ label: 'Сайт', name: 'companySite', value: settings.companySite || '', placeholder: 'example.ru' })}
          <div class="field">
            <span class="field-label">Валюта смет</span>
            <select class="input select" name="currency">
              ${[
                ['RUB', 'Российский рубль — ₽'],
                ['KZT', 'Казахстанский тенге — ₸'],
                ['BYN', 'Белорусский рубль — Br'],
                ['USD', 'Доллар США — $'],
                ['EUR', 'Евро — €'],
                ['UAH', 'Гривна — ₴'],
                ['GEL', 'Лари — ₾'],
                ['AMD', 'Драм — ֏'],
                ['UZS', 'Сум — soʻm'],
              ]
                .map(([value, label]) => `<option value="${value}" ${settings.currency === value ? 'selected' : ''}>${label}</option>`)
                .join('')}
            </select>
            <span class="field-hint">Меняется формат отображения во всей смете и PDF.</span>
          </div>
          ${textareaField({ label: 'Текст в PDF', name: 'pdfFooter', value: settings.pdfFooter || '', rows: 2 })}
          ${textareaField({ label: 'Примечание на клиентской странице', name: 'publicNotice', value: settings.publicNotice || '', rows: 2 })}
          <div class="modal-actions modal-actions--flush">
            <button class="btn btn-primary" type="submit">Сохранить настройки</button>
          </div>
        </form>
      </section>

      <div class="settings-column">
        <section class="panel settings-panel">
          <div class="panel-head"><div><h2>Безопасность</h2><p>Пароль администратора.</p></div></div>
          <form class="form-grid" id="password-form">
            <div class="form-error" hidden></div>
            ${field({ label: 'Текущий пароль', name: 'currentPassword', type: 'password', required: true, span: true })}
            ${field({ label: 'Новый пароль', name: 'newPassword', type: 'password', required: true, hint: 'Не менее 8 символов.', span: true })}
            <div class="modal-actions modal-actions--flush">
              <button class="btn btn-ghost" type="submit">Изменить пароль</button>
            </div>
          </form>
        </section>

        <section class="panel settings-panel">
          <div class="panel-head"><div><h2>Данные</h2><p>Резервная копия базы данных.</p></div></div>
          <p class="settings-text">Скачайте снимок базы SQLite. Копию можно восстановить по инструкции из README.</p>
          <button class="btn btn-soft" type="button" id="backup-btn">${icon('database', 16)} Скачать резервную копию</button>
          <div class="settings-meta">
            <span>Строк в журнале: <b id="audit-count">—</b></span>
            <span>Валюта: <b>${esc(settings.currency || 'RUB')}</b></span>
          </div>
        </section>
      </div>
    </div>

    <section class="panel settings-panel settings-panel--audit">
      <div class="panel-head"><div><h2>Журнал действий</h2><p>Последние операции администратора.</p></div></div>
      <div class="audit-list" id="audit-list"><div class="skeleton skeleton-text"></div></div>
    </section>
  `,
      'settings',
    ),
    { title: 'Настройки' },
  );
  bindShell();
  bindSettings();
}

function bindSettings() {
  const form = $('#settings-form');
  if (form) {
    bindFormSubmit(form, async () => {
      const payload = {
        companyName: formValue(form, 'companyName'),
        companyTagline: formValue(form, 'companyTagline'),
        companyPhone: formValue(form, 'companyPhone'),
        companyEmail: formValue(form, 'companyEmail'),
        companySite: formValue(form, 'companySite'),
        currency: formValue(form, 'currency'),
        pdfFooter: formValue(form, 'pdfFooter'),
        publicNotice: formValue(form, 'publicNotice'),
      };
      const { settings } = await api('/settings', { method: 'PATCH', body: payload });
      state.settings = settings;
      toast('Настройки сохранены');
      renderSettings();
    });
  }

  const passwordForm = $('#password-form');
  if (passwordForm) {
    bindFormSubmit(passwordForm, async () => {
      const currentPassword = passwordForm.elements.currentPassword.value;
      const newPassword = passwordForm.elements.newPassword.value;
      if (newPassword.length < 8) throw new ApiError('Новый пароль: минимум 8 символов', 422);
      await api('/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
      passwordForm.reset();
      toast('Пароль изменён');
    });
  }

  $('#backup-btn')?.addEventListener('click', async () => {
    const button = $('#backup-btn');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> Формирование…';
    try {
      const response = await fetch('/api/settings/backup', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Не удалось создать резервную копию');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `metrazh-backup-${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Резервная копия скачана');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });

  loadAudit();
}

async function loadAudit() {
  const container = $('#audit-list');
  if (!container) return;
  try {
    const { entries } = await api('/settings/audit?limit=40');
    const counter = $('#audit-count');
    if (counter) counter.textContent = String(entries.length);
    if (!entries.length) {
      container.innerHTML = '<p class="empty-note">Журнал пока пуст.</p>';
      return;
    }
    container.innerHTML = entries
      .map((entry) => {
        const entityLabel = entry.entity ? AUDIT_ENTITIES[entry.entity] : '';
        const meta = [
          entry.login || 'система',
          entityLabel ? `${entityLabel}${entry.entityId ? ` №${entry.entityId}` : ''}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `
      <div class="audit-row">
        <span class="audit-dot"></span>
        <div class="audit-main">
          <strong>${esc(AUDIT_LABELS[entry.action] || entry.action)}</strong>
          <span>${esc(meta)}</span>
        </div>
        <time>${formatDateTime(entry.createdAt)}</time>
      </div>`;
      })
      .join('');
  } catch (error) {
    container.innerHTML = `<p class="empty-note">Не удалось загрузить журнал: ${esc(error.message)}</p>`;
  }
}

/* ------------------------------------------------------------------ */
/* Глобальные обработчики                                             */
/* ------------------------------------------------------------------ */

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[data-link]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#')) return;
  event.preventDefault();
  navigate(href);
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="reload-page"]')) window.location.reload();
});

window.addEventListener('popstate', renderRoute);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
