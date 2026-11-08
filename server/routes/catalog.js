import express from 'express';
import { audit, nowIso } from '../lib/db.js';
import { listCategories } from '../lib/data.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireCsrf, requireSameOrigin } from '../lib/auth.js';
import {
  asObject,
  boolValue,
  decimalValue,
  hasOwn,
  priceKopecksValue,
  textValue,
} from '../lib/validate.js';

const RESOURCES = {
  works: {
    table: 'work_catalog',
    kind: 'work',
    entity: 'work_catalog',
    label: 'Работа',
  },
  materials: {
    table: 'material_catalog',
    kind: 'material',
    entity: 'material_catalog',
    label: 'Материал',
  },
};

function workToJson(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category || '',
    unit: row.unit,
    priceKopecks: Number(row.price_kopecks) || 0,
    description: row.description || '',
    isActive: Boolean(row.is_active),
    usageCount: Number(row.usage_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function materialToJson(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category || '',
    purchaseUnit: row.purchase_unit,
    packageSize: row.package_size,
    consumptionUnit: row.consumption_unit || '',
    consumptionRate: row.consumption_rate,
    priceKopecks: Number(row.price_kopecks) || 0,
    description: row.description || '',
    isActive: Boolean(row.is_active),
    usageCount: Number(row.usage_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Позиция не найдена');
  return id;
}

function mapRow(kind, row) {
  return kind === 'work' ? workToJson(row) : materialToJson(row);
}

function buildWorkFields(db, body, existing = null) {
  const fields = [];
  const values = [];
  if (!existing || hasOwn(body, 'name')) {
    fields.push('name = ?');
    values.push(textValue(body.name, 'Название работы', { required: true, max: 300 }));
  }
  if (!existing || hasOwn(body, 'category')) {
    fields.push('category = ?');
    values.push(textValue(body.category, 'Категория', { max: 200 }));
  }
  if (!existing || hasOwn(body, 'unit')) {
    fields.push('unit = ?');
    values.push(textValue(body.unit, 'Единица измерения', { required: true, max: 30 }));
  }
  if (!existing || hasOwn(body, 'price')) {
    fields.push('price_kopecks = ?');
    values.push(priceKopecksValue(body.price, 'Базовая цена', { required: true }));
  }
  if (!existing || hasOwn(body, 'description')) {
    fields.push('description = ?');
    values.push(textValue(body.description, 'Описание', { max: 5000 }));
  }
  if (existing && hasOwn(body, 'isActive')) {
    fields.push('is_active = ?');
    values.push(boolValue(body.isActive, true) ? 1 : 0);
  }
  return { fields, values };
}

function buildMaterialFields(body, existing = null) {
  const fields = [];
  const values = [];

  let rate = null;
  let consumptionUnit = null;
  if (existing) {
    rate = existing.consumption_rate;
    consumptionUnit = existing.consumption_unit;
  }
  if (hasOwn(body, 'consumptionRate')) {
    rate = decimalValue(body.consumptionRate, 'Норма расхода', { max: 10_000_000n * 1_000_000n });
  }
  if (hasOwn(body, 'consumptionUnit')) {
    consumptionUnit = textValue(body.consumptionUnit, 'Единица расхода', { max: 30 });
  }
  if (rate !== null && !consumptionUnit) {
    throw new HttpError(422, 'Укажите единицу расхода для материала с нормой расхода');
  }

  if (!existing || hasOwn(body, 'name')) {
    fields.push('name = ?');
    values.push(textValue(body.name, 'Название материала', { required: true, max: 300 }));
  }
  if (!existing || hasOwn(body, 'category')) {
    fields.push('category = ?');
    values.push(textValue(body.category, 'Категория', { max: 200 }));
  }
  if (!existing || hasOwn(body, 'purchaseUnit')) {
    fields.push('purchase_unit = ?');
    values.push(textValue(body.purchaseUnit, 'Единица закупки', { required: true, max: 30 }));
  }
  if (hasOwn(body, 'packageSize')) {
    fields.push('package_size = ?');
    values.push(decimalValue(body.packageSize, 'Размер упаковки', { max: 10_000_000n * 1_000_000n }));
  }
  if (hasOwn(body, 'consumptionUnit')) {
    fields.push('consumption_unit = ?');
    values.push(consumptionUnit);
  }
  if (hasOwn(body, 'consumptionRate')) {
    fields.push('consumption_rate = ?');
    values.push(rate);
  }
  if (!existing || hasOwn(body, 'price')) {
    fields.push('price_kopecks = ?');
    values.push(priceKopecksValue(body.price, 'Базовая цена', { required: true }));
  }
  if (!existing || hasOwn(body, 'description')) {
    fields.push('description = ?');
    values.push(textValue(body.description, 'Описание', { max: 5000 }));
  }
  if (existing && hasOwn(body, 'isActive')) {
    fields.push('is_active = ?');
    values.push(boolValue(body.isActive, true) ? 1 : 0);
  }
  return { fields, values };
}

export function mountCatalog(router, db, type) {
  const resource = RESOURCES[type];
  const { table, kind } = resource;
  if (!resource) throw new Error(`unknown catalog type: ${type}`);
  const selectSql = `SELECT t.*, (SELECT COUNT(*) FROM estimate_lines l WHERE l.source_item_id = t.id AND l.kind = '${kind}') AS usage_count FROM ${table} t`;

  router.get(
    `/${type}`,
    asyncHandler(async (req, res) => {
      const rows = db.prepare(`${selectSql} ORDER BY t.name COLLATE NOCASE`).all();
      let items = rows.map((row) => mapRow(kind, row));
      const search = String(req.query.search || '').trim().toLowerCase();
      if (search) {
        items = items.filter((item) =>
          `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(search),
        );
      }
      const category = String(req.query.category || '').trim();
      if (category) items = items.filter((item) => item.category === category);
      if (req.query.active === '1') items = items.filter((item) => item.isActive);
      res.json({ items, categories: listCategories(db, table) });
    }),
  );

  router.post(
    `/${type}`,
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const body = asObject(req.body);
      const timestamp = nowIso();
      const name = textValue(body.name, 'Название', { required: true, max: 300 });
      const category = textValue(body.category, 'Категория', { max: 200 });
      const description = textValue(body.description, 'Описание', { max: 5000 });
      const priceKopecks = priceKopecksValue(body.price, 'Базовая цена', { required: true });
      let result;

      if (kind === 'work') {
        const unit = textValue(body.unit, 'Единица измерения', { required: true, max: 30 });
        result = db
          .prepare(
            `INSERT INTO work_catalog (name, category, unit, price_kopecks, description, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(name, category, unit, priceKopecks, description, timestamp, timestamp);
      } else {
        const purchaseUnit = textValue(body.purchaseUnit, 'Единица закупки', { required: true, max: 30 });
        const packageSize = decimalValue(body.packageSize, 'Размер упаковки', { max: 10_000_000n * 1_000_000n });
        const consumptionUnit = textValue(body.consumptionUnit, 'Единица расхода', { max: 30 });
        const consumptionRate = decimalValue(body.consumptionRate, 'Норма расхода', { max: 10_000_000n * 1_000_000n });
        if (consumptionRate !== null && !consumptionUnit) {
          throw new HttpError(422, 'Укажите единицу расхода для материала с нормой расхода');
        }
        result = db
          .prepare(
            `INSERT INTO material_catalog
               (name, category, purchase_unit, package_size, consumption_unit, consumption_rate,
                price_kopecks, description, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            name,
            category,
            purchaseUnit,
            packageSize,
            consumptionUnit,
            consumptionRate,
            priceKopecks,
            description,
            timestamp,
            timestamp,
          );
      }

      const id = Number(result.lastInsertRowid);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: `${kind}_catalog.created`,
        entity: resource.entity,
        entityId: id,
        details: { name },
        ip: req.ip,
      });
      const row = db.prepare(`${selectSql} WHERE t.id = ?`).get(id);
      res.status(201).json({ item: mapRow(kind, row) });
    }),
  );

  router.patch(
    `/${type}/:id`,
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      if (!existing) throw new HttpError(404, `${resource.label} не найдена`);
      const body = asObject(req.body);
      const built = kind === 'work' ? buildWorkFields(db, body, existing) : buildMaterialFields(body, existing);
      if (!built.fields.length) throw new HttpError(422, 'Нет данных для сохранения');
      built.fields.push('updated_at = ?');
      built.values.push(nowIso(), id);
      db.prepare(`UPDATE ${table} SET ${built.fields.join(', ')} WHERE id = ?`).run(...built.values);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: `${kind}_catalog.updated`,
        entity: resource.entity,
        entityId: id,
        details: { fields: Object.keys(body) },
        ip: req.ip,
      });
      const row = db.prepare(`${selectSql} WHERE t.id = ?`).get(id);
      res.json({ item: mapRow(kind, row) });
    }),
  );

  router.delete(
    `/${type}/:id`,
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      if (!existing) throw new HttpError(404, `${resource.label} не найдена`);
      const usage = db
        .prepare("SELECT COUNT(*) AS count FROM estimate_lines WHERE source_item_id = ? AND kind = ?")
        .get(id, kind);
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: `${kind}_catalog.deleted`,
        entity: resource.entity,
        entityId: id,
        details: { name: existing.name, usedInLines: Number(usage.count) },
        ip: req.ip,
      });
      res.json({ ok: true, usedInLines: Number(usage.count) });
    }),
  );

  router.get(
    `/${type}/categories`,
    asyncHandler(async (req, res) => {
      res.json({ categories: listCategories(db, table) });
    }),
  );

  router.post(
    `/${type}/categories/rename`,
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const body = asObject(req.body);
      const from = textValue(body.from, 'Текущая категория', { required: true, max: 200 });
      const to = textValue(body.to, 'Новая категория', { required: true, max: 200 });
      const result = db.prepare(`UPDATE ${table} SET category = ?, updated_at = ? WHERE category = ?`).run(to, nowIso(), from);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: `${kind}_catalog.category_renamed`,
        entity: 'category',
        details: { from, to, affected: Number(result.changes) },
        ip: req.ip,
      });
      res.json({ ok: true, affected: Number(result.changes) });
    }),
  );

  router.post(
    `/${type}/categories/delete`,
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const body = asObject(req.body);
      const name = textValue(body.name, 'Категория', { required: true, max: 200 });
      const result = db.prepare(`UPDATE ${table} SET category = NULL, updated_at = ? WHERE category = ?`).run(nowIso(), name);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: `${kind}_catalog.category_deleted`,
        entity: 'category',
        details: { name, affected: Number(result.changes) },
        ip: req.ip,
      });
      res.json({ ok: true, affected: Number(result.changes) });
    }),
  );
}

export function catalogRouter(db) {
  const router = express.Router();
  mountCatalog(router, db, 'works');
  mountCatalog(router, db, 'materials');
  return router;
}
