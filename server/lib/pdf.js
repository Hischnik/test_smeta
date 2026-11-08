import path from 'node:path';
import PDFDocument from 'pdfkit';
import { ROOT } from './config.js';
import { getProjectDetails, getSettings } from './data.js';
import { formatMoney, formatQty, parseDecimal } from '../../shared/money.js';
import { shortUnit } from '../../shared/units.js';

const PAGE = { width: 595.28, height: 841.89 };
const M = { left: 46, right: 46, top: 50, bottom: 74 };
const CONTENT_WIDTH = PAGE.width - M.left - M.right;

const COLORS = {
  ink: '#1E1D1A',
  muted: '#6E685E',
  faint: '#9A9387',
  line: '#DCD5C7',
  hairline: '#EAE4D8',
  accent: '#2E5B4B',
  accentDark: '#24483B',
  soft: '#F4F0E7',
  white: '#FFFFFF',
};

const FONT_REGULAR = 'PTSans';
const FONT_BOLD = 'PTSans-Bold';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

function cleanMoney(value) {
  return String(value).replace(/[\u202f\u2009\u00a0]/g, ' ');
}

function money(kopecks, currency) {
  return cleanMoney(formatMoney(kopecks, currency));
}

function dateText(iso, short = false) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const text = short ? shortDateFormatter.format(date) : dateFormatter.format(date);
  return text.replace(/\s?г\.$/, '');
}

function quantityText(line) {
  const micro = parseDecimal(line.quantity);
  return micro === null ? line.quantity : formatQty(micro, 3);
}

function pluralRooms(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'помещение';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'помещения';
  return 'помещений';
}

function pluralPositions(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'позиция';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'позиции';
  return 'позиций';
}

function materialDetail(line) {
  if (line.kind !== 'material' || line.calcMode !== 'auto') return '';
  const area = parseDecimal(line.calcArea);
  const rate = parseDecimal(line.consumptionRate);
  const pack = parseDecimal(line.packageSize);
  if (area === null || rate === null) return '';
  const areaText = formatQty(area, 2);
  const rateText = formatQty(rate, 3);
  const req = Number(area) / 1e6 * (Number(rate) / 1e6);
  const reqText = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(req);
  const unit = line.consumptionUnit || '';
  if (pack && Number(pack) > 0) {
    return `${areaText} м² × ${rateText} ${unit}/м² = ${reqText} ${unit} ÷ ${formatQty(pack, 3)} ${unit} в упаковке`;
  }
  return `${areaText} м² × ${rateText} ${unit}/м² = ${reqText} ${unit}`;
}

function ensureSpace(doc, height, onNewPage) {
  if (doc.y + height <= PAGE.height - M.bottom) return false;
  doc.addPage();
  doc.y = M.top;
  if (onNewPage) onNewPage();
  return true;
}

function drawBrand(doc, x, y, { compact = false } = {}) {
  const size = compact ? 22 : 28;
  doc.save();
  doc.roundedRect(x, y, size, size, size * 0.24).fill(COLORS.accent);
  // Стилизованный план: две линии и точка.
  doc.strokeColor(COLORS.white).lineWidth(1.1);
  doc.moveTo(x + size * 0.27, y + size * 0.34).lineTo(x + size * 0.73, y + size * 0.34).stroke();
  doc.moveTo(x + size * 0.43, y + size * 0.34).lineTo(x + size * 0.43, y + size * 0.7).stroke();
  doc.fillColor(COLORS.white).circle(x + size * 0.68, y + size * 0.62, 1.3).fill();
  doc.restore();

  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(compact ? 10.5 : 12.5);
  doc.text('МЕТРАЖ', x + size + 9, y + (compact ? 2 : 3), {
    characterSpacing: compact ? 1.2 : 1.8,
    lineBreak: false,
  });
  if (!compact) {
    doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(7.6);
    doc.text('СМЕТЫ НА РЕМОНТ КВАРТИР', x + size + 9, y + 16, { characterSpacing: 1.1, lineBreak: false });
  }
}

function drawContinuationHeader(doc, project) {
  drawBrand(doc, M.left, 26, { compact: true });
  doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(8);
  doc.text(project.name, M.left + 100, 30, {
    width: CONTENT_WIDTH - 100,
    align: 'right',
    lineBreak: false,
    ellipsis: true,
  });
  doc.strokeColor(COLORS.line).lineWidth(0.6);
  doc.moveTo(M.left, 44).lineTo(PAGE.width - M.right, 44).stroke();
}

function drawPageFooter(doc, pageIndex, pageCount, settings) {
  doc.switchToPage(pageIndex);
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  const y = PAGE.height - 44;
  doc.strokeColor(COLORS.line).lineWidth(0.6);
  doc.moveTo(M.left, y - 10).lineTo(PAGE.width - M.right, y - 10).stroke();

  const parts = [settings.companyName];
  if (settings.companyPhone) parts.push(settings.companyPhone);
  if (settings.companySite) parts.push(settings.companySite);
  doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(7.5);
  doc.text(parts.join('  ·  '), M.left, y, {
    width: CONTENT_WIDTH - 90,
    lineBreak: false,
    ellipsis: true,
  });
  doc.text(`Стр. ${pageIndex + 1} из ${pageCount}`, PAGE.width - M.right - 90, y, {
    width: 90,
    align: 'right',
    lineBreak: false,
  });
  doc.page.margins.bottom = bottom;
}

function drawInfoPanel(doc, project, totals) {
  const top = doc.y;
  const height = 52;
  doc.save();
  doc.roundedRect(M.left, top, CONTENT_WIDTH, height, 8).fill(COLORS.soft);
  doc.restore();

  const columns = [
    { label: 'ОБЩАЯ ПЛОЩАДЬ', value: project.totalArea ? `${formatQty(parseDecimal(project.totalArea), 2)} м²` : '—' },
    { label: 'ПОМЕЩЕНИЙ', value: `${project.rooms.length}` },
    { label: 'ПОЗИЦИЙ В СМЕТЕ', value: `${totals.lineCount}` },
    { label: 'ОБНОВЛЕНО', value: dateText(project.updatedAt, true) },
  ];
  const columnWidth = CONTENT_WIDTH / columns.length;
  columns.forEach((column, index) => {
    const x = M.left + index * columnWidth + 14;
    doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(6.6);
    doc.text(column.label, x, top + 12, { characterSpacing: 0.7, lineBreak: false });
    doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(11);
    doc.text(column.value, x, top + 26, { lineBreak: false, width: columnWidth - 20 });
  });
  doc.y = top + height;
}

function drawTableHeader(doc, columns) {
  const y = doc.y;
  doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(6.8);
  for (const column of columns) {
    doc.text(column.label, column.x, y, {
      width: column.width,
      align: column.align || 'left',
      characterSpacing: 0.6,
      lineBreak: false,
    });
  }
  doc.strokeColor(COLORS.line).lineWidth(0.7);
  doc.moveTo(M.left, y + 12).lineTo(PAGE.width - M.right, y + 12).stroke();
  doc.y = y + 17;
}

function drawTableRow(doc, columns, line, index, columnsDef, onPageBreak) {
  doc.font(FONT_REGULAR).fontSize(8.6);
  const nameColumn = columnsDef[1];
  const detail = materialDetail(line);
  const nameHeight = doc.heightOfString(line.name, { width: nameColumn.width - 2 });
  const rowHeight = Math.max(17, nameHeight + (detail ? 10 : 0) + 7);

  if (ensureSpace(doc, rowHeight, onPageBreak)) {
    return drawTableRow(doc, columns, line, index, columnsDef, onPageBreak);
  }

  const y = doc.y;
  if (index % 2 === 1) {
    doc.save();
    doc.rect(M.left, y - 2, CONTENT_WIDTH, rowHeight).fill('#FBF9F4');
    doc.restore();
  }

  const cells = {
    index: String(index + 1),
    name: line.name,
    qty: quantityText(line),
    unit: shortUnit(line.unit),
    price: money(line.priceKopecks, columns.currency),
    amount: money(line.amountKopecks, columns.currency),
  };

  for (const column of columnsDef) {
    doc.fillColor(column.key === 'amount' ? COLORS.ink : COLORS.ink);
    doc.font(column.key === 'amount' ? FONT_BOLD : FONT_REGULAR).fontSize(8.6);
    doc.text(cells[column.key] ?? '', column.x, y, {
      width: column.width,
      align: column.align || 'left',
      lineBreak: column.key === 'name',
    });
  }
  if (detail) {
    doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(6.9);
    doc.text(detail, nameColumn.x, y + nameHeight + 1, { width: nameColumn.width, lineBreak: false, ellipsis: true });
  }
  doc.strokeColor(COLORS.hairline).lineWidth(0.5);
  doc.moveTo(M.left, y + rowHeight - 2).lineTo(PAGE.width - M.right, y + rowHeight - 2).stroke();
  doc.y = y + rowHeight;
}

function drawSectionLabel(doc, label, count, color = COLORS.muted) {
  const y = doc.y;
  doc.fillColor(color).font(FONT_BOLD).fontSize(7);
  doc.text(label.toUpperCase(), M.left, y, { characterSpacing: 1.3, lineBreak: false });
  const width = doc.widthOfString(label.toUpperCase(), { characterSpacing: 1.3 });
  doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(7);
  doc.text(`${count}`, M.left + width + 6, y + 0.5, { lineBreak: false });
  doc.y = y + 12;
}

function drawTable(doc, lines, currency, project, onNewPage, contextLabel = '') {
  if (!lines.length) {
    doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(8).text('Позиции не добавлены', M.left, doc.y + 2);
    doc.y += 12;
    return;
  }
  const columns = [
    { key: 'index', label: '№', x: M.left, width: 22 },
    { key: 'name', label: 'НАИМЕНОВАНИЕ', x: M.left + 24, width: 209 },
    { key: 'qty', label: 'КОЛ-ВО', x: M.left + 237, width: 52, align: 'right' },
    { key: 'unit', label: 'ЕД.', x: M.left + 293, width: 40 },
    { key: 'price', label: 'ЦЕНА', x: M.left + 337, width: 78, align: 'right' },
    { key: 'amount', label: 'СУММА', x: M.left + 419, width: 84, align: 'right' },
  ];
  columns.currency = currency;
  drawTableHeader(doc, columns);
  const onPageBreak = () => {
    onNewPage();
    if (contextLabel) {
      doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(7);
      doc.text(contextLabel, M.left, doc.y, { characterSpacing: 0.8, lineBreak: false });
      doc.y += 12;
    }
    drawTableHeader(doc, columns);
  };
  lines.forEach((line, index) => drawTableRow(doc, columns, line, index, columns, onPageBreak));
}

function drawRoomTotal(doc, totals, currency, onNewPage) {
  const height = 34;
  ensureSpace(doc, height + 12, onNewPage);
  const top = doc.y + 4;
  doc.save();
  doc.roundedRect(PAGE.width - M.right - 320, top, 320, height, 6).fill(COLORS.soft);
  doc.restore();
  const items = [
    { label: 'Работы', value: money(totals.works, currency) },
    { label: 'Материалы', value: money(totals.materials, currency) },
    { label: 'Итого', value: money(totals.total, currency), bold: true },
  ];
  const startX = PAGE.width - M.right - 320;
  items.forEach((item, index) => {
    const x = startX + 12 + index * 100;
    doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(6.4);
    doc.text(item.label.toUpperCase(), x, top + 8, { characterSpacing: 0.5, lineBreak: false });
    doc.fillColor(item.bold ? COLORS.accent : COLORS.ink).font(item.bold ? FONT_BOLD : FONT_REGULAR).fontSize(8.8);
    doc.text(item.value, x, top + 18, { width: 92, align: 'right', lineBreak: false });
  });
  doc.y = top + height + 12;
}

function drawRoomHeader(doc, room, index) {
  const y = doc.y;
  doc.fillColor(COLORS.accent).font(FONT_BOLD).fontSize(9);
  doc.text(String(index + 1).padStart(2, '0'), M.left, y + 3, { lineBreak: false });
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(13.5);
  doc.text(room.name, M.left + 24, y, { width: CONTENT_WIDTH - 120, lineBreak: false, ellipsis: true });
  if (room.area) {
    doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(8.5);
    doc.text(`${formatQty(parseDecimal(room.area), 2)} м²`, PAGE.width - M.right - 70, y + 4, {
      width: 70,
      align: 'right',
      lineBreak: false,
    });
  }
  doc.strokeColor(COLORS.line).lineWidth(0.8);
  doc.moveTo(M.left, y + 22).lineTo(PAGE.width - M.right, y + 22).stroke();
  doc.y = y + 30;
}

function drawGrandTotal(doc, project, totals, currency) {
  ensureSpace(doc, 90);
  doc.y += 4;
  const top = doc.y;
  const height = 80;
  doc.save();
  doc.roundedRect(M.left, top, CONTENT_WIDTH, height, 10).fill(COLORS.accentDark);
  doc.restore();

  doc.fillColor('#BFD3C8').font(FONT_REGULAR).fontSize(7.2);
  doc.text('ИТОГО ПО СМЕТЕ', M.left + 22, top + 13, { characterSpacing: 1.4, lineBreak: false });
  doc.fillColor(COLORS.white).font(FONT_BOLD).fontSize(22);
  doc.text(money(totals.total, currency), M.left + 22, top + 25, { lineBreak: false });

  const rightX = M.left + CONTENT_WIDTH - 210;
  const rows = [
    { label: 'Работы', value: money(totals.works, currency) },
    { label: 'Материалы', value: money(totals.materials, currency) },
  ];
  rows.forEach((row, index) => {
    doc.fillColor('#BFD3C8').font(FONT_REGULAR).fontSize(7);
    doc.text(row.label, rightX, top + 18 + index * 21, { width: 80, lineBreak: false });
    doc.fillColor(COLORS.white).font(FONT_BOLD).fontSize(10);
    doc.text(row.value, rightX + 74, top + 16 + index * 21, { width: 136, align: 'right', lineBreak: false });
  });
  doc.fillColor('#9DB8AA').font(FONT_REGULAR).fontSize(6.8);
  doc.text(
    `${project.rooms.length} ${pluralRooms(project.rooms.length)} · ${totals.lineCount} ${pluralPositions(totals.lineCount)} в смете`,
    M.left + 22,
    top + 61,
    { lineBreak: false },
  );
  doc.y = top + height;
}

function drawFirstPageHeader(doc, project, totals) {
  const startY = M.top;
  drawBrand(doc, M.left, startY);

  doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(6.8);
  doc.text('СМЕТА НА РЕМОНТ', PAGE.width - M.right - 170, startY + 3, {
    width: 170,
    align: 'right',
    characterSpacing: 1.2,
    lineBreak: false,
  });
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(13);
  doc.text(`№ ${String(project.id).padStart(4, '0')}`, PAGE.width - M.right - 170, startY + 12, {
    width: 170,
    align: 'right',
    lineBreak: false,
  });
  doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(7.5);
  doc.text(dateText(project.updatedAt || project.createdAt), PAGE.width - M.right - 170, startY + 28, {
    width: 170,
    align: 'right',
    lineBreak: false,
  });

  doc.strokeColor(COLORS.line).lineWidth(0.8);
  doc.moveTo(M.left, startY + 44).lineTo(PAGE.width - M.right, startY + 44).stroke();

  doc.y = startY + 66;
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(21);
  doc.text(project.name, M.left, doc.y, { width: CONTENT_WIDTH - 20 });
  doc.moveDown(0.15);
  if (project.address) {
    doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(9.5);
    doc.text(project.address, M.left, doc.y, { width: CONTENT_WIDTH });
    doc.y += 6;
  }
  if (project.description) {
    doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(8.2);
    const description = project.description.length > 600
      ? `${project.description.slice(0, 600).trimEnd()}…`
      : project.description;
    doc.text(description, M.left, doc.y + 2, { width: CONTENT_WIDTH, lineGap: 1 });
    doc.y += 4;
  }
  doc.y += 12;
  drawInfoPanel(doc, project, totals);
  doc.y += 24;
}

export function streamProjectPdf(db, projectId, res) {
  const project = getProjectDetails(db, projectId);
  if (!project) return false;
  const settings = getSettings(db);
  const currency = settings.currency || 'RUB';

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: M.top, bottom: M.bottom, left: M.left, right: M.right },
    bufferPages: true,
    info: {
      Title: `Смета — ${project.name}`,
      Author: settings.companyName,
      Subject: 'Смета на ремонт квартиры',
      Creator: 'Метраж',
    },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="smeta-${project.id}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  doc.pipe(res);

  doc.registerFont(FONT_REGULAR, path.join(ROOT, 'assets', 'fonts', 'PTSans-Regular.ttf'));
  doc.registerFont(FONT_BOLD, path.join(ROOT, 'assets', 'fonts', 'PTSans-Bold.ttf'));
  doc.font(FONT_REGULAR).fillColor(COLORS.ink);

  const totals = project.totals;
  drawFirstPageHeader(doc, project, totals);

  const onNewPage = () => {
    drawContinuationHeader(doc, project);
    doc.y = 56;
  };

  const allRooms = project.rooms;
  for (const [index, room] of allRooms.entries()) {
    ensureSpace(doc, 120, onNewPage);
    drawRoomHeader(doc, room, index);

    const lines = db
      .prepare('SELECT * FROM estimate_lines WHERE room_id = ? ORDER BY kind DESC, sort_order, id')
      .all(room.id)
      .map((row) => ({
        kind: row.kind,
        name: row.name,
        unit: row.unit,
        quantity: row.quantity,
        priceKopecks: Number(row.price_kopecks),
        amountKopecks: Number(row.amount_kopecks),
        calcMode: row.calc_mode,
        calcArea: row.calc_area,
        consumptionRate: row.consumption_rate,
        packageSize: row.package_size,
        consumptionUnit: row.consumption_unit,
        sortOrder: row.sort_order,
      }));
    const works = lines.filter((line) => line.kind === 'work');
    const materials = lines.filter((line) => line.kind === 'material');

    drawSectionLabel(doc, 'Работы', works.length);
    drawTable(doc, works, currency, project, onNewPage, `${room.name} · работы`);
    doc.y += 10;
    if (ensureSpace(doc, 40, onNewPage)) {
      doc.fillColor(COLORS.faint).font(FONT_REGULAR).fontSize(7.2);
      doc.text(`${room.name} · материалы`, M.left, doc.y, { characterSpacing: 0.8, lineBreak: false });
      doc.y += 13;
    }
    drawSectionLabel(doc, 'Материалы', materials.length);
    drawTable(doc, materials, currency, project, onNewPage, `${room.name} · материалы`);
    drawRoomTotal(doc, room.totals, currency, onNewPage);
    doc.y += 6;
  }

  drawGrandTotal(doc, project, totals, currency);

  if (settings.pdfFooter) {
    doc.font(FONT_REGULAR).fontSize(7);
    const footerHeight = doc.heightOfString(settings.pdfFooter, { width: CONTENT_WIDTH, lineGap: 1.5 });
    if (doc.y + 8 + footerHeight <= PAGE.height - M.bottom) {
      doc.fillColor(COLORS.faint);
      doc.text(settings.pdfFooter, M.left, doc.y + 8, { width: CONTENT_WIDTH, lineGap: 1.5 });
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    drawPageFooter(doc, i, range.count, settings);
  }

  doc.end();
  return true;
}

export { PAGE, M };
