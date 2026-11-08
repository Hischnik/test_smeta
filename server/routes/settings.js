import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { audit } from '../lib/db.js';
import { getSettings, setSettings, DEFAULT_SETTINGS } from '../lib/data.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireCsrf, requireSameOrigin } from '../lib/auth.js';
import { asObject, hasOwn, oneOf, textValue } from '../lib/validate.js';

const CURRENCIES = ['RUB', 'KZT', 'BYN', 'USD', 'EUR', 'UAH', 'GEL', 'AMD', 'UZS'];

export function settingsRouter(db, config) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json({ settings: getSettings(db) });
    }),
  );

  router.patch(
    '/',
    requireSameOrigin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const body = asObject(req.body);
      const patch = {};
      const textFields = {
        companyName: { label: 'Название компании', max: 200 },
        companyTagline: { label: 'Подзаголовок', max: 300 },
        companyPhone: { label: 'Телефон', max: 100 },
        companyEmail: { label: 'Электронная почта', max: 200 },
        companySite: { label: 'Сайт', max: 200 },
        pdfFooter: { label: 'Текст в PDF', max: 1000 },
        publicNotice: { label: 'Примечание на клиентской странице', max: 1000 },
      };
      for (const [key, meta] of Object.entries(textFields)) {
        if (!hasOwn(body, key)) continue;
        const value = textValue(body[key], meta.label, { max: meta.max });
        patch[key] = value ?? '';
      }
      if (hasOwn(body, 'currency')) {
        patch.currency = oneOf(body.currency, CURRENCIES, 'Валюта', 'RUB');
      }
      if (!Object.keys(patch).length) throw new HttpError(422, 'Нет данных для сохранения');
      const settings = setSettings(db, patch);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'settings.updated',
        entity: 'settings',
        details: { fields: Object.keys(patch) },
        ip: req.ip,
      });
      res.json({ settings });
    }),
  );

  router.get(
    '/currencies',
    asyncHandler(async (req, res) => {
      res.json({ currencies: CURRENCIES });
    }),
  );

  router.get(
    '/audit',
    asyncHandler(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
      const rows = db
        .prepare(
          `SELECT id, login, action, entity, entity_id, details, ip, created_at
           FROM audit_log ORDER BY id DESC LIMIT ?`,
        )
        .all(limit);
      res.json({
        entries: rows.map((row) => ({
          id: row.id,
          login: row.login,
          action: row.action,
          entity: row.entity,
          entityId: row.entity_id,
          details: row.details ? JSON.parse(row.details) : null,
          ip: row.ip,
          createdAt: row.created_at,
        })),
      });
    }),
  );

  router.get(
    '/backup',
    asyncHandler(async (req, res) => {
      const backupsDir = path.join(config.dataDir, 'backups');
      fs.mkdirSync(backupsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `metrazh-${stamp}.db`;
      const destination = path.join(backupsDir, filename);
      db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'backup.created',
        entity: 'database',
        details: { filename },
        ip: req.ip,
      });
      res.download(destination, filename, (error) => {
        if (error && !res.headersSent) res.status(500).end();
      });
    }),
  );

  return router;
}

export { CURRENCIES, DEFAULT_SETTINGS };
