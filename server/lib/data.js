import { nowIso } from './db.js';
import { config } from './config.js';

export const DEFAULT_SETTINGS = {
  companyName: config.appName,
  companyTagline: 'Сметы на ремонт квартир',
  companyPhone: '',
  companyEmail: '',
  companySite: '',
  currency: 'RUB',
  pdfFooter: 'Смета составлена в приложении «Метраж». Цены действительны на дату составления документа.',
  publicNotice: 'Документ доступен только для просмотра. Изменения вносит составитель сметы.',
};

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const result = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) result[row.key] = row.value;
  }
  return result;
}

export function setSettings(db, patch) {
  const statement = db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    statement.run(key, String(value ?? ''));
  }
  return getSettings(db);
}

export function projectTotals(db, projectId) {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN l.kind = 'work' THEN l.amount_kopecks ELSE 0 END), 0) AS works,
         COALESCE(SUM(CASE WHEN l.kind = 'material' THEN l.amount_kopecks ELSE 0 END), 0) AS materials,
         COUNT(l.id) AS line_count
       FROM estimate_lines l
       JOIN rooms r ON r.id = l.room_id
       WHERE r.project_id = ?`,
    )
    .get(projectId);
  return {
    works: Number(row.works) || 0,
    materials: Number(row.materials) || 0,
    total: (Number(row.works) || 0) + (Number(row.materials) || 0),
    lineCount: Number(row.line_count) || 0,
  };
}

export function roomTotals(db, roomId) {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'work' THEN amount_kopecks ELSE 0 END), 0) AS works,
         COALESCE(SUM(CASE WHEN kind = 'material' THEN amount_kopecks ELSE 0 END), 0) AS materials,
         COUNT(*) AS line_count
       FROM estimate_lines WHERE room_id = ?`,
    )
    .get(roomId);
  return {
    works: Number(row.works) || 0,
    materials: Number(row.materials) || 0,
    total: (Number(row.works) || 0) + (Number(row.materials) || 0),
    lineCount: Number(row.line_count) || 0,
  };
}

export function lineToJson(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    sourceItemId: row.source_item_id,
    name: row.name,
    category: row.category || '',
    unit: row.unit,
    priceKopecks: Number(row.price_kopecks) || 0,
    quantity: row.quantity,
    amountKopecks: Number(row.amount_kopecks) || 0,
    sortOrder: row.sort_order,
    purchaseUnit: row.purchase_unit || '',
    packageSize: row.package_size,
    consumptionUnit: row.consumption_unit || '',
    consumptionRate: row.consumption_rate,
    calcArea: row.calc_area,
    calcMode: row.calc_mode,
    description: row.description || '',
  };
}

export function roomToJson(row, totals = null) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    area: row.area,
    description: row.description || '',
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totals: totals || undefined,
  };
}

export function projectToJson(row, { totals = null, rooms = null } = {}) {
  return {
    id: row.id,
    name: row.name,
    address: row.address || '',
    totalArea: row.total_area,
    description: row.description || '',
    publicEnabled: Boolean(row.public_enabled),
    publicToken: row.public_enabled ? row.public_token : null,
    publicCreatedAt: row.public_created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totals: totals || undefined,
    rooms: rooms || undefined,
  };
}

export function listRooms(db, projectId) {
  const rows = db
    .prepare('SELECT * FROM rooms WHERE project_id = ? ORDER BY sort_order, id')
    .all(projectId);
  return rows.map((row) => roomToJson(row, roomTotals(db, row.id)));
}

export function getProjectDetails(db, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const rooms = listRooms(db, projectId);
  return projectToJson(project, { totals: projectTotals(db, projectId), rooms });
}

export function getRoomDetails(db, roomId) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) return null;
  const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(room.project_id);
  const lines = db
    .prepare('SELECT * FROM estimate_lines WHERE room_id = ? ORDER BY kind, sort_order, id')
    .all(roomId)
    .map(lineToJson);
  return {
    room: roomToJson(room, roomTotals(db, roomId)),
    project: project ? { id: project.id, name: project.name } : null,
    lines: {
      works: lines.filter((line) => line.kind === 'work'),
      materials: lines.filter((line) => line.kind === 'material'),
    },
  };
}

export function touchProject(db, projectId) {
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso(), projectId);
}

export function touchRoom(db, roomId) {
  db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(nowIso(), roomId);
}

export function nextSortOrder(db, table, whereColumn, whereValue, kind = null) {
  const kindClause = kind ? ' AND kind = ?' : '';
  const params = kind ? [whereValue, kind] : [whereValue];
  const row = db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM ${table} WHERE ${whereColumn} = ?${kindClause}`)
    .get(...params);
  return (Number(row.max_order) || 0) + 1;
}

export function listCategories(db, table) {
  const rows = db
    .prepare(
      `SELECT category, COUNT(*) AS count FROM ${table}
       WHERE category IS NOT NULL AND TRIM(category) <> '' GROUP BY category ORDER BY category COLLATE NOCASE`,
    )
    .all();
  return rows.map((row) => ({ name: row.category, count: Number(row.count) }));
}
