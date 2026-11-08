import express from 'express';
import { audit, nowIso } from '../lib/db.js';
import {
  getRoomDetails,
  lineToJson,
  projectTotals,
  roomTotals,
  touchProject,
  touchRoom,
} from '../lib/data.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireCsrf, requireSameOrigin } from '../lib/auth.js';
import {
  asObject,
  decimalValue,
  hasOwn,
  oneOf,
  priceKopecksValue,
  textValue,
} from '../lib/validate.js';
import { computeMaterialLine, computeWorkLine } from '../../shared/calc.js';
import { microToInput, parseDecimal } from '../../shared/money.js';

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Не найдено');
  return id;
}

function getLineOrThrow(db, id) {
  const line = db
    .prepare(
      `SELECT l.*, r.project_id FROM estimate_lines l
       JOIN rooms r ON r.id = l.room_id WHERE l.id = ?`,
    )
    .get(id);
  if (!line) throw new HttpError(404, 'Строка сметы не найдена');
  return line;
}

export function roomsRouter(db) {
  const router = express.Router();

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const details = getRoomDetails(db, parseId(req.params.id));
      if (!details) throw new HttpError(404, 'Помещение не найдено');
      res.json({ ...details, projectTotals: projectTotals(db, details.project.id) });
    }),
  );

  router.patch(
    '/:id',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
      if (!room) throw new HttpError(404, 'Помещение не найдено');
      const body = asObject(req.body);
      const fields = [];
      const values = [];
      if (hasOwn(body, 'name')) {
        fields.push('name = ?');
        values.push(textValue(body.name, 'Название помещения', { required: true, max: 200 }));
      }
      if (hasOwn(body, 'area')) {
        fields.push('area = ?');
        values.push(decimalValue(body.area, 'Площадь помещения', { max: 10_000_000n * 1_000_000n }));
      }
      if (hasOwn(body, 'description')) {
        fields.push('description = ?');
        values.push(textValue(body.description, 'Описание', { max: 3000 }));
      }
      if (!fields.length) throw new HttpError(422, 'Нет данных для сохранения');
      fields.push('updated_at = ?');
      values.push(nowIso(), id);
      db.prepare(`UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      touchProject(db, room.project_id);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'room.updated',
        entity: 'room',
        entityId: id,
        details: { projectId: room.project_id },
        ip: req.ip,
      });
      const details = getRoomDetails(db, id);
      res.json({ ...details, projectTotals: projectTotals(db, room.project_id) });
    }),
  );

  router.delete(
    '/:id',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
      if (!room) throw new HttpError(404, 'Помещение не найдено');
      db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
      touchProject(db, room.project_id);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'room.deleted',
        entity: 'room',
        entityId: id,
        details: { projectId: room.project_id, name: room.name },
        ip: req.ip,
      });
      res.json({ ok: true, projectId: room.project_id });
    }),
  );

  router.post(
    '/:id/lines',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const roomId = parseId(req.params.id);
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
      if (!room) throw new HttpError(404, 'Помещение не найдено');
      const body = asObject(req.body);
      const kind = oneOf(body.kind, ['work', 'material'], 'Тип позиции');
      if (!kind) throw new HttpError(422, 'Укажите тип позиции');
      const catalogId = parseId(body.catalogId);
      const timestamp = nowIso();
      const sortOrderRow = db
        .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM estimate_lines WHERE room_id = ? AND kind = ?')
        .get(roomId, kind);
      const sortOrder = (Number(sortOrderRow.max_order) || 0) + 1;

      let lineId;
      if (kind === 'work') {
        const work = db.prepare('SELECT * FROM work_catalog WHERE id = ? AND is_active = 1').get(catalogId);
        if (!work) throw new HttpError(404, 'Работа не найдена или скрыта из справочника');
        const quantityMicro = parseDecimal('1') ?? 1_000_000n;
        const computed = computeWorkLine({ quantity: quantityMicro, priceKopecks: Number(work.price_kopecks) });
        const result = db
          .prepare(
            `INSERT INTO estimate_lines
               (room_id, kind, source_item_id, name, category, unit, price_kopecks, quantity, amount_kopecks,
                sort_order, description, created_at, updated_at)
             VALUES (?, 'work', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            roomId,
            work.id,
            work.name,
            work.category,
            work.unit,
            Number(work.price_kopecks),
            '1',
            computed.amountKopecks,
            sortOrder,
            work.description,
            timestamp,
            timestamp,
          );
        lineId = Number(result.lastInsertRowid);
      } else {
        const material = db
          .prepare('SELECT * FROM material_catalog WHERE id = ? AND is_active = 1')
          .get(catalogId);
        if (!material) throw new HttpError(404, 'Материал не найден или скрыт из справочника');
        const calcArea = room.area ? parseDecimal(room.area) : null;
        const rate = material.consumption_rate ? parseDecimal(material.consumption_rate) : null;
        const packageSize = material.package_size ? parseDecimal(material.package_size) : null;
        const canAuto = calcArea !== null && rate !== null;
        const mode = canAuto ? 'auto' : 'manual';
        const manualQuantity = parseDecimal('1') ?? 1_000_000n;
        const computed = computeMaterialLine({
          mode,
          quantity: manualQuantity,
          priceKopecks: Number(material.price_kopecks),
          calcArea,
          consumptionRate: rate,
          packageSize,
        });
        const result = db
          .prepare(
            `INSERT INTO estimate_lines
               (room_id, kind, source_item_id, name, category, unit, price_kopecks, quantity, amount_kopecks,
                sort_order, purchase_unit, package_size, consumption_unit, consumption_rate, calc_area, calc_mode,
                description, created_at, updated_at)
             VALUES (?, 'material', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            roomId,
            material.id,
            material.name,
            material.category,
            material.purchase_unit,
            Number(material.price_kopecks),
            microToInput(computed.quantityMicro, 6),
            computed.amountKopecks,
            sortOrder,
            material.purchase_unit,
            material.package_size,
            material.consumption_unit,
            material.consumption_rate,
            calcArea === null ? null : microToInput(calcArea, 6),
            mode,
            material.description,
            timestamp,
            timestamp,
          );
        lineId = Number(result.lastInsertRowid);
      }

      touchRoom(db, roomId);
      touchProject(db, room.project_id);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: `line.created`,
        entity: 'estimate_line',
        entityId: lineId,
        details: { roomId, kind, catalogId },
        ip: req.ip,
      });
      const line = lineToJson(getLineOrThrow(db, lineId));
      res.status(201).json({
        line,
        room: getRoomDetails(db, roomId),
        projectTotals: projectTotals(db, room.project_id),
      });
    }),
  );

  router.post(
    '/:id/lines/reorder',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const roomId = parseId(req.params.id);
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
      if (!room) throw new HttpError(404, 'Помещение не найдено');
      const body = asObject(req.body);
      const kind = oneOf(body.kind, ['work', 'material'], 'Тип позиции');
      if (!kind) throw new HttpError(422, 'Укажите тип позиции');
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        throw new HttpError(422, 'Передайте порядок строк');
      }
      const ids = body.ids.map((id) => parseId(id));
      const existing = db
        .prepare('SELECT id FROM estimate_lines WHERE room_id = ? AND kind = ?')
        .all(roomId, kind)
        .map((row) => row.id);
      if (ids.length !== existing.length || !ids.every((id) => existing.includes(id))) {
        throw new HttpError(422, 'Некорректный порядок строк');
      }
      const timestamp = nowIso();
      const update = db.prepare('UPDATE estimate_lines SET sort_order = ?, updated_at = ? WHERE id = ?');
      for (const [index, id] of ids.entries()) update.run(index + 1, timestamp, id);
      touchRoom(db, roomId);
      touchProject(db, room.project_id);
      res.json({
        room: getRoomDetails(db, roomId),
        projectTotals: projectTotals(db, room.project_id),
      });
    }),
  );

  return router;
}

export function linesRouter(db) {
  const router = express.Router();

  router.patch(
    '/:id',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      const line = getLineOrThrow(db, id);
      const body = asObject(req.body);
      const isMaterial = line.kind === 'material';

      let name = line.name;
      let category = line.category;
      let unit = line.unit;
      let priceKopecks = Number(line.price_kopecks);
      let quantityMicro = parseDecimal(line.quantity) ?? 0n;
      let calcArea = line.calc_area ? parseDecimal(line.calc_area) : null;
      let rate = line.consumption_rate ? parseDecimal(line.consumption_rate) : null;
      let packageSize = line.package_size ? parseDecimal(line.package_size) : null;
      let mode = isMaterial ? line.calc_mode || 'manual' : null;
      let quantityTouched = false;

      if (hasOwn(body, 'name')) name = textValue(body.name, 'Название', { required: true, max: 300 });
      if (hasOwn(body, 'category')) category = textValue(body.category, 'Категория', { max: 200 });
      if (hasOwn(body, 'unit')) {
        unit = textValue(body.unit, 'Единица измерения', { required: true, max: 50 });
      }
      if (hasOwn(body, 'price')) {
        priceKopecks = priceKopecksValue(body.price, 'Цена', { required: true });
      }
      if (hasOwn(body, 'description')) {
        // Описание строки необязательно; пустое значение очищает поле.
        const description = textValue(body.description, 'Описание', { max: 3000 });
        body.description = description;
      }

      if (isMaterial) {
        if (hasOwn(body, 'mode')) {
          mode = oneOf(body.mode, ['auto', 'manual'], 'Режим расчёта', 'manual');
        }
        if (hasOwn(body, 'calcArea')) {
          calcArea = parseDecimal(
            decimalValue(body.calcArea, 'Площадь для расчёта', { max: 10_000_000n * 1_000_000n }) ?? '',
          );
        }
        if (hasOwn(body, 'consumptionRate')) {
          const normalized = decimalValue(body.consumptionRate, 'Норма расхода', { max: 10_000_000n * 1_000_000n });
          rate = normalized === null ? null : parseDecimal(normalized);
        }
        if (hasOwn(body, 'packageSize')) {
          const normalized = decimalValue(body.packageSize, 'Размер упаковки', { max: 10_000_000n * 1_000_000n });
          packageSize = normalized === null ? null : parseDecimal(normalized);
        }
        if (hasOwn(body, 'quantity')) {
          const normalized = decimalValue(body.quantity, 'Количество', { required: true, max: 10_000_000n * 1_000_000n });
          quantityMicro = parseDecimal(normalized) ?? 0n;
          quantityTouched = true;
          // Ручная правка количества переводит строку в ручной режим:
          // автоматический расчёт больше не должен затирать введённое значение.
          if (!hasOwn(body, 'mode') && mode === 'auto') mode = 'manual';
        }
        if (mode === 'auto' && (calcArea === null || rate === null)) {
          throw new HttpError(422, 'Для автоматического расчёта укажите площадь и норму расхода');
        }
        const computed = computeMaterialLine({
          mode,
          quantity: quantityMicro,
          priceKopecks,
          calcArea,
          consumptionRate: rate,
          packageSize,
        });
        quantityMicro = computed.quantityMicro;
        db.prepare(
          `UPDATE estimate_lines SET name = ?, category = ?, unit = ?, price_kopecks = ?, quantity = ?,
             amount_kopecks = ?, purchase_unit = ?, package_size = ?, consumption_unit = ?,
             consumption_rate = ?, calc_area = ?, calc_mode = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          name,
          category,
          unit,
          priceKopecks,
          microToInput(quantityMicro, 6),
          computed.amountKopecks,
          unit,
          packageSize === null ? null : microToInput(packageSize, 6),
          line.consumption_unit,
          rate === null ? null : microToInput(rate, 6),
          calcArea === null ? null : microToInput(calcArea, 6),
          mode,
          nowIso(),
          id,
        );
      } else {
        if (hasOwn(body, 'quantity')) {
          const normalized = decimalValue(body.quantity, 'Объём', { required: true, max: 10_000_000n * 1_000_000n });
          quantityMicro = parseDecimal(normalized) ?? 0n;
          quantityTouched = true;
        }
        const computed = computeWorkLine({ quantity: quantityMicro, priceKopecks });
        quantityMicro = computed.quantityMicro;
        db.prepare(
          `UPDATE estimate_lines SET name = ?, category = ?, unit = ?, price_kopecks = ?, quantity = ?,
             amount_kopecks = ?, updated_at = ? WHERE id = ?`,
        ).run(
          name,
          category,
          unit,
          priceKopecks,
          microToInput(quantityMicro, 6),
          computed.amountKopecks,
          nowIso(),
          id,
        );
      }

      if (hasOwn(body, 'description')) {
        db.prepare('UPDATE estimate_lines SET description = ? WHERE id = ?').run(body.description, id);
      }

      touchRoom(db, line.room_id);
      touchProject(db, line.project_id);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'line.updated',
        entity: 'estimate_line',
        entityId: id,
        details: {
          roomId: line.room_id,
          fields: Object.keys(body),
          quantityTouched,
        },
        ip: req.ip,
      });
      const updated = getLineOrThrow(db, id);
      res.json({
        line: lineToJson(updated),
        roomTotals: roomTotals(db, line.room_id),
        projectTotals: projectTotals(db, line.project_id),
      });
    }),
  );

  router.delete(
    '/:id',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      const line = getLineOrThrow(db, id);
      db.prepare('DELETE FROM estimate_lines WHERE id = ?').run(id);
      touchRoom(db, line.room_id);
      touchProject(db, line.project_id);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'line.deleted',
        entity: 'estimate_line',
        entityId: id,
        details: { roomId: line.room_id, name: line.name },
        ip: req.ip,
      });
      res.json({
        ok: true,
        roomTotals: roomTotals(db, line.room_id),
        projectTotals: projectTotals(db, line.project_id),
      });
    }),
  );

  return router;
}
