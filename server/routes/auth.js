import express from 'express';
import {
  checkLoginRate,
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  logAuthEvent,
  recordLoginFailure,
  requireAuth,
  requireCsrf,
  requireSameOrigin,
  resetLoginFailures,
  setSessionCookie,
  verifyPassword,
} from '../lib/auth.js';
import { asyncHandler, noCache } from '../lib/http.js';
import { audit, nowIso } from '../lib/db.js';
import { asObject, passwordValue, textValue } from '../lib/validate.js';
import { HttpError } from '../lib/http.js';

function userJson(user) {
  return { id: user.id, login: user.login, name: user.name };
}

export function authRouter(db, config) {
  const router = express.Router();

  router.post(
    '/login',
    requireSameOrigin,
    asyncHandler(async (req, res) => {
      noCache(res);
      const body = asObject(req.body);
      const login = textValue(body.login, 'Логин', { required: true, max: 100 });
      const password = passwordValue(body.password, 'Пароль');

      const rate = checkLoginRate(req, login, {
        limit: config.loginRateLimit,
        windowMinutes: config.loginRateWindowMinutes,
      });
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(config.loginRateWindowMinutes * 60));
        throw new HttpError(429, 'Слишком много попыток входа. Попробуйте позже.');
      }

      const user = db
        .prepare('SELECT id, login, name, password_hash FROM users WHERE login = ?')
        .get(login);
      const passwordOk = user ? await verifyPassword(password, user.password_hash) : false;
      if (!user || !passwordOk) {
        recordLoginFailure(req, login, {
          limit: config.loginRateLimit,
          windowMinutes: config.loginRateWindowMinutes,
        });
        logAuthEvent(db, req, 'login_failed', { login, details: { reason: 'invalid_credentials' } });
        throw new HttpError(401, 'Неверный логин или пароль');
      }

      // Защита от фиксации сессии: старую сессию удаляем.
      if (req.sessionToken) destroySession(db, req.sessionToken);
      const session = createSession(db, user.id, req);
      setSessionCookie(res, session.token, { secure: config.cookieSecure, days: config.sessionTtlDays });
      resetLoginFailures(req, login);
      audit(db, {
        userId: user.id,
        login: user.login,
        action: 'login',
        entity: 'auth',
        ip: req.ip,
      });
      res.json({
        user: userJson(user),
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      });
    }),
  );

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      noCache(res);
      res.json({ user: req.user, csrfToken: req.session.csrf_token });
    }),
  );

  router.post(
    '/logout',
    requireAuth,
    requireCsrf,
    asyncHandler(async (req, res) => {
      destroySession(db, req.sessionToken);
      clearSessionCookie(res);
      audit(db, { userId: req.user.id, login: req.user.login, action: 'logout', entity: 'auth', ip: req.ip });
      res.json({ ok: true });
    }),
  );

  router.post(
    '/password',
    requireAuth,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const body = asObject(req.body);
      const currentPassword = passwordValue(body.currentPassword, 'Текущий пароль');
      const newPassword = passwordValue(body.newPassword, 'Новый пароль');
      if (newPassword.length < 8) throw new HttpError(422, 'Новый пароль: минимум 8 символов');
      const user = db.prepare('SELECT id, password_hash, login FROM users WHERE id = ?').get(req.user.id);
      const valid = await verifyPassword(currentPassword, user.password_hash);
      if (!valid) throw new HttpError(422, 'Текущий пароль указан неверно');
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        await hashPassword(newPassword),
        nowIso(),
        user.id,
      );
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(user.id, req.session.session_id);
      audit(db, {
        userId: user.id,
        login: user.login,
        action: 'password_changed',
        entity: 'user',
        entityId: user.id,
        ip: req.ip,
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
