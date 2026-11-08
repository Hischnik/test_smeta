import { getSettings } from './data.js';
import { formatMoney, formatQty, parseDecimal } from '../../shared/money.js';
import { shortUnit } from '../../shared/units.js';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function dateText(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return dateFormatter.format(date).replace(/\s?г\.$/, '');
}

function qtyText(micro, max = 3) {
  if (micro === null) return '—';
  return formatQty(micro, max);
}

function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function brandMarkup(compact = false) {
  return `
    <span class="brand-mark${compact ? ' brand-mark--sm' : ''}" aria-hidden="true">
      <svg viewBox="0 0 28 28" width="26" height="26" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" rx="7" fill="currentColor"/>
        <path d="M7 10h14M12 10v9" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
        <circle cx="18.4" cy="17.2" r="1.5" fill="#fff"/>
      </svg>
    </span>
    <span class="brand-text">Метраж</span>`;
}

function lineRow(line, currency, index) {
  const qty = parseDecimal(line.quantity);
  const isMaterial = line.kind === 'material';
  const detail = isMaterial && line.calc_mode === 'auto' && line.calc_area && line.consumption_rate
    ? `${qtyText(parseDecimal(line.calc_area), 2)} м² × ${qtyText(parseDecimal(line.consumption_rate))} ${escapeHtml(line.consumption_unit || '')}/м²`
    : '';
  const unit = shortUnit(isMaterial ? line.purchase_unit : line.unit);
  return `
    <tr>
      <td class="cell-num" data-label="№">${index + 1}</td>
      <td class="cell-name" data-label="Наименование">
        <span class="line-name">${escapeHtml(line.name)}</span>
        ${detail ? `<span class="line-detail">${detail}</span>` : ''}
      </td>
      <td class="cell-qty" data-label="Кол-во" data-unit="${escapeHtml(shortUnit(unit))}">${qtyText(qty)}</td>
      <td class="cell-unit" data-label="Ед.">${escapeHtml(unit || '')}</td>
      <td class="cell-price" data-label="Цена">${formatMoney(Number(line.price_kopecks), currency)}</td>
      <td class="cell-sum" data-label="Сумма">${formatMoney(Number(line.amount_kopecks), currency)}</td>
    </tr>`;
}

function itemsTable(lines, currency) {
  if (!lines.length) {
    return '<p class="empty-note">Позиции не добавлены.</p>';
  }
  return `
    <div class="table-wrap">
      <table class="items-table">
        <thead>
          <tr>
            <th class="cell-num">№</th>
            <th>Наименование</th>
            <th class="num">Кол-во</th>
            <th>Ед.</th>
            <th class="num">Цена</th>
            <th class="num">Сумма</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((line, index) => lineRow(line, currency, index)).join('')}
        </tbody>
      </table>
    </div>`;
}

function groupBlock(title, lines, currency) {
  return `
    <div class="group">
      <div class="group-title"><span>${title}</span><span class="group-count">${lines.length}</span></div>
      ${itemsTable(lines, currency)}
    </div>`;
}

function roomMarkup(room, index, currency) {
  const lines = room.lines;
  const works = lines.filter((line) => line.kind === 'work');
  const materials = lines.filter((line) => line.kind === 'material');
  const totals = room.totals;
  return `
    <section class="public-room">
      <div class="room-head">
        <span class="room-index">${String(index + 1).padStart(2, '0')}</span>
        <h2>${escapeHtml(room.name)}</h2>
        ${room.area ? `<span class="room-area">${qtyText(parseDecimal(room.area), 2)} м²</span>` : ''}
      </div>
      ${room.description ? `<p class="room-desc">${escapeHtml(room.description)}</p>` : ''}
      ${groupBlock('Работы', works, currency)}
      ${groupBlock('Материалы', materials, currency)}
      <div class="room-sum">
        <div><span>Работы</span><b>${formatMoney(totals.works, currency)}</b></div>
        <div><span>Материалы</span><b>${formatMoney(totals.materials, currency)}</b></div>
        <div class="room-sum-total"><span>Итого по помещению</span><b>${formatMoney(totals.total, currency)}</b></div>
      </div>
    </section>`;
}

export function renderPublicPage(project, db) {
  const settings = getSettings(db);
  const currency = settings.currency || 'RUB';
  const totals = project.totals;
  const roomCount = project.rooms.length;

  const rooms = project.rooms.map((room) => {
    const rows = db
      .prepare('SELECT * FROM estimate_lines WHERE room_id = ? ORDER BY kind DESC, sort_order, id')
      .all(room.id);
    return {
      ...room,
      lines: rows.map((row) => ({
        ...row,
        amount_kopecks: Number(row.amount_kopecks),
        price_kopecks: Number(row.price_kopecks),
        calc_mode: row.calc_mode,
        calc_area: row.calc_area,
        consumption_rate: row.consumption_rate,
        consumption_unit: row.consumption_unit,
        purchase_unit: row.purchase_unit,
      })),
    };
  });

  const metaChips = [
    project.totalArea ? `<span class="chip"><span class="chip-label">Площадь</span>${qtyText(parseDecimal(project.totalArea), 2)} м²</span>` : '',
    `<span class="chip"><span class="chip-label">Помещений</span>${roomCount}</span>`,
    `<span class="chip"><span class="chip-label">Позиций</span>${totals.lineCount}</span>`,
    `<span class="chip"><span class="chip-label">Обновлено</span>${dateText(project.updatedAt || project.createdAt)}</span>`,
  ]
    .filter(Boolean)
    .join('');

  const contacts = [settings.companyPhone, settings.companyEmail, settings.companySite].filter(Boolean);
  const companyLine = [settings.companyName, ...contacts].join('  ·  ');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#f4f1e9">
  <title>${escapeHtml(project.name)} — смета на ремонт</title>
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body class="public-page">
  <div class="page-grain" aria-hidden="true"></div>
  <header class="public-topbar">
    <a class="brand" href="/" aria-label="Метраж — на главную">${brandMarkup()}</a>
    <div class="public-actions">
      <span class="badge badge-quiet"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.4"/></svg>Только просмотр</span>
      <a class="btn btn-soft" href="/p/${escapeHtml(project.publicToken)}/pdf">Скачать PDF</a>
      <button class="btn btn-primary" type="button" id="print-btn">Печать</button>
    </div>
  </header>

  <main class="paper">
    <div class="paper-head">
      <div class="overline">Смета на ремонт квартиры</div>
      <h1>${escapeHtml(project.name)}</h1>
      ${project.address ? `<p class="paper-address">${escapeHtml(project.address)}</p>` : ''}
      <div class="meta-row">${metaChips}</div>
    </div>

    <div class="public-summary">
      <div class="summary-cell">
        <span class="summary-label">Работы</span>
        <strong>${formatMoney(totals.works, currency)}</strong>
      </div>
      <div class="summary-cell">
        <span class="summary-label">Материалы</span>
        <strong>${formatMoney(totals.materials, currency)}</strong>
      </div>
      <div class="summary-cell summary-cell--total">
        <span class="summary-label">Итого по смете</span>
        <strong>${formatMoney(totals.total, currency)}</strong>
      </div>
    </div>

    ${project.description ? `<p class="paper-desc">${escapeHtml(project.description)}</p>` : ''}

    <div class="rooms">
      ${rooms.map((room, index) => roomMarkup(room, index, currency)).join('')}
    </div>

    <div class="public-grand">
      <div class="grand-text">
        <span class="grand-label">Общая стоимость ремонта</span>
        <span class="grand-note">${roomCount} ${plural(roomCount, 'помещение', 'помещения', 'помещений')} · ${totals.lineCount} ${plural(totals.lineCount, 'позиция', 'позиции', 'позиций')} в смете</span>
      </div>
      <div class="grand-value">
        <span>Работы ${formatMoney(totals.works, currency)}</span>
        <span>Материалы ${formatMoney(totals.materials, currency)}</span>
        <strong>${formatMoney(totals.total, currency)}</strong>
      </div>
    </div>

    <div class="public-note">
      <p>${escapeHtml(settings.publicNotice)}</p>
      <p>Смета актуальна на ${dateText(project.updatedAt || project.createdAt)}. Цены и объёмы могут быть уточнены после осмотра объекта.</p>
    </div>

    <footer class="public-footer">
      <div class="public-footer-brand">${brandMarkup(true)}</div>
      <div class="public-footer-text">
        <span>${escapeHtml(companyLine)}</span>
        ${settings.companyTagline ? `<span>${escapeHtml(settings.companyTagline)}</span>` : ''}
      </div>
    </footer>
  </main>

  <script src="/assets/public.js" defer></script>
</body>
</html>`;
}

export function renderPublicNotFound(status = 404) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Смета не найдена — Метраж</title>
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body class="public-page public-page--message">
  <main class="message-card">
    <div class="brand">${brandMarkup()}</div>
    <div class="message-code">${status}</div>
    <h1>Смета недоступна</h1>
    <p>Ссылка недействительна или доступ к смете был отозван. Запросите актуальную ссылку у составителя сметы.</p>
    <a class="btn btn-primary" href="/">Перейти на главную</a>
  </main>
</body>
</html>`;
}
