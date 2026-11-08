import express from 'express';
import { randomToken } from '../lib/auth.js';
import { audit, nowIso } from '../lib/db.js';
import {
  getProjectDetails,
  nextSortOrder,
  projectToJson,
  touchProject,
} from '../lib/data.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireCsrf, requireSameOrigin } from '../lib/auth.js';
import { asObject, decimalValue, hasOwn, textValue } from '../lib/validate.js';

export function projectsRouter(db) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = db
        .prepare(
          `SELECT p.*,
             (SELECT COUNT(*) FROM rooms r WHERE r.project_id = p.id) AS room_count,
             (SELECT COALESCE(SUM(l.amount_kopecks), 0) FROM estimate_lines l
                JOIN rooms r2 ON r2.id = l.room_id WHERE r2.project_id = p.id AND l.kind = 'work') AS works,
             (SELECT COALESCE(SUM(l.amount_kopecks), 0) FROM estimate_lines l
                JOIN rooms r3 ON r3.id = l.room_id WHERE r3.project_id = p.id AND l.kind = 'material') AS materials
           FROM projects p
           ORDER BY p.created_at DESC, p.id DESC`,
        )
        .all();
      res.json({
        projects: rows.map((row) => ({
          ...projectToJson(row),
          roomCount: Number(row.room_count) || 0,
          totals: {
            works: Number(row.works) || 0,
            materials: Number(row.materials) || 0,
            total: (Number(row.works) || 0) + (Number(row.materials) || 0),
          },
        })),
      });
    }),
  );

  router.post(
    '/',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const body = asObject(req.body);
      const name = textValue(body.name, 'Название объекта', { required: true, max: 200 });
      const address = textValue(body.address, 'Адрес', { max: 300 });
      const totalArea = decimalValue(body.totalArea, 'Общая площадь', { max: 10_000_000n * 1_000_000n });
      const description = textValue(body.description, 'Описание', { max: 5000 });
      const timestamp = nowIso();
      const result = db
        .prepare(
          `INSERT INTO projects (name, address, total_area, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(name, address, totalArea, description, timestamp, timestamp);
      const projectId = Number(result.lastInsertRowid);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'project.created',
        entity: 'project',
        entityId: projectId,
        details: { name },
        ip: req.ip,
      });
      res.status(201).json({ project: getProjectDetails(db, projectId) });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new HttpError(404, 'Объект не найден');
      const project = getProjectDetails(db, id);
      if (!project) throw new HttpError(404, 'Объект не найден');
      res.json({ project });
    }),
  );

  router.patch(
    '/:id',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (!existing) throw new HttpError(404, 'Объект не найден');
      const body = asObject(req.body);
      const fields = [];
      const values = [];
      if (hasOwn(body, 'name')) {
        fields.push('name = ?');
        values.push(textValue(body.name, 'Название объекта', { required: true, max: 200 }));
      }
      if (hasOwn(body, 'address')) {
        fields.push('address = ?');
        values.push(textValue(body.address, 'Адрес', { max: 300 }));
      }
      if (hasOwn(body, 'totalArea')) {
        fields.push('total_area = ?');
        values.push(decimalValue(body.totalArea, 'Общая площадь', { max: 10_000_000n * 1_000_000n }));
      }
      if (hasOwn(body, 'description')) {
        fields.push('description = ?');
        values.push(textValue(body.description, 'Описание', { max: 5000 }));
      }
      if (!fields.length) throw new HttpError(422, 'Нет данных для сохранения');
      fields.push('updated_at = ?');
      values.push(nowIso(), id);
      db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'project.updated',
        entity: 'project',
        entityId: id,
        details: { fields: fields.map((field) => field.split(' ')[0]) },
        ip: req.ip,
      });
      res.json({ project: getProjectDetails(db, id) });
    }),
  );

  router.delete(
    '/:id',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(id);
      if (!project) throw new HttpError(404, 'Объект не найден');
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'project.deleted',
        entity: 'project',
        entityId: id,
        details: { name: project.name },
        ip: req.ip,
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    '/:id/public-link',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (!project) throw new HttpError(404, 'Объект не найден');
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const regenerate = Boolean(body.regenerate);
      if (project.public_enabled && project.public_token && !regenerate) {
        return res.json({ project: getProjectDetails(db, id) });
      }
      // При повторном включении или перегенерации выпускаем новый токен:
      // ранее отозванная ссылка уже не должна работать.
      const token = randomToken(32);
      db.prepare(
        'UPDATE projects SET public_token = ?, public_enabled = 1, public_created_at = ?, updated_at = ? WHERE id = ?',
      ).run(token, nowIso(), nowIso(), id);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: regenerate ? 'public_link.regenerated' : 'public_link.created',
        entity: 'project',
        entityId: id,
        ip: req.ip,
      });
      res.json({ project: getProjectDetails(db, id) });
    }),
  );

  router.delete(
    '/:id/public-link',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
      if (!project) throw new HttpError(404, 'Объект не найден');
      db.prepare('UPDATE projects SET public_enabled = 0, public_token = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'public_link.revoked',
        entity: 'project',
        entityId: id,
        ip: req.ip,
      });
      res.json({ project: getProjectDetails(db, id) });
    }),
  );

  router.post(
    '/:id/rooms',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const projectId = Number(req.params.id);
      const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
      if (!project) throw new HttpError(404, 'Объект не найден');
      const body = asObject(req.body);
      const name = textValue(body.name, 'Название помещения', { required: true, max: 200 });
      const area = decimalValue(body.area, 'Площадь помещения', { max: 10_000_000n * 1_000_000n });
      const description = textValue(body.description, 'Описание', { max: 3000 });
      const timestamp = nowIso();
      const sortOrder = nextSortOrder(db, 'rooms', 'project_id', projectId);
      const result = db
        .prepare(
          `INSERT INTO rooms (project_id, name, area, description, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(projectId, name, area, description, sortOrder, timestamp, timestamp);
      touchProject(db, projectId);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'room.created',
        entity: 'room',
        entityId: Number(result.lastInsertRowid),
        details: { projectId, name },
        ip: req.ip,
      });
      res.status(201).json({ project: getProjectDetails(db, projectId) });
    }),
  );

  return router;
}
