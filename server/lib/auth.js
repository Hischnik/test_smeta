import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { nowIso } from './db.js';
import { audit } from './db.js';

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
export const COOKIE_NAME = 'metrazh_sid';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltHex, hashHex] = parts;
    const expected = Buffer.from(hashHex, 'hex');
    const derived = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(n) * Number(r) * 2,
    });
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function parseCookies(header = '') {
  const result = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

export function clientIp(req) {
  // X-Forwarded-For учитывается только при явно включённом trust proxy,
  // иначе клиент мог бы подделать IP и обойти ограничение попыток входа.
  if (req.app && req.app.get('trust proxy')) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.ip || req.socket?.remoteAddress || '';
}

export function createSession(db, userId, req) {
  const token = randomToken(32);
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const ttl = configSessionTtlDays() * 24 * 60 * 60 * 1000;
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  db.prepare(
    `INSERT INTO sessions (token_hash, csrf_token, user_id, created_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sha256(token), csrfToken, userId, createdAt, expiresAt, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300));
  return { token, csrfToken, expiresAt };
}

// Значение задаётся при старте из конфигурации, чтобы не тянуть циклические импорты.
let sessionTtlProvider = () => 7;
export function configureSessionTtl(days) {
  sessionTtlProvider = () => days;
}
function configSessionTtlDays() {
  return sessionTtlProvider();
}

export function getSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.user_id, u.login, u.name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }
  return row;
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function cleanupSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}

export function setSessionCookie(res, token, { secure, days = 7 }) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: days * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'lax' });
}

export function sessionMiddleware(db) {
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    req.sessionToken = token || null;
    req.session = null;
    req.user = null;
    if (token) {
      const session = getSession(db, token);
      if (session) {
        req.session = session;
        req.user = { id: session.user_id, login: session.login, name: session.name };
      }
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Требуется авторизация' });
  }
  next();
}

function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

export function requireCsrf(req, res, next) {
  if (!req.session) {
    return res.status(401).json({ error: 'unauthorized', message: 'Требуется авторизация' });
  }
  const header = req.get('x-csrf-token');
  if (!header || !safeEqual(header, req.session.csrf_token)) {
    return res.status(403).json({ error: 'csrf', message: 'Сессия устарела, обновите страницу' });
  }
  next();
}

/** Проверка Origin/Referer для изменяющих запросов — дополнительный барьер от CSRF. */
export function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: 'origin', message: 'Недопустимый источник запроса' });
  }
  if (originHost !== req.get('host')) {
    return res.status(403).json({ error: 'origin', message: 'Недопустимый источник запроса' });
  }
  next();
}

const loginAttempts = new Map();

function attemptKey(req, login) {
  return `${clientIp(req)}|${String(login || '').toLowerCase()}`;
}

export function checkLoginRate(req, login, { limit = 12, windowMinutes = 15 } = {}) {
  const key = attemptKey(req, login);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) return { allowed: true, remaining: limit };
  return { allowed: entry.count < limit, remaining: Math.max(0, limit - entry.count) };
}

export function recordLoginFailure(req, login, { limit = 12, windowMinutes = 15 } = {}) {
  const key = attemptKey(req, login);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + windowMinutes * 60 * 1000 });
  } else {
    entry.count += 1;
  }
  if (loginAttempts.size > 5000) {
    for (const [staleKey, stale] of loginAttempts) {
      if (stale.resetAt <= now) loginAttempts.delete(staleKey);
    }
  }
  return { limit };
}

export function resetLoginFailures(req, login) {
  loginAttempts.delete(attemptKey(req, login));
}

export function logAuthEvent(db, req, action, { userId = null, login = null, details = null } = {}) {
  audit(db, { userId, login, action, entity: 'auth', details, ip: clientIp(req) });
}
