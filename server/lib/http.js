import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message, { code = null, details = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function formatIssue(issue) {
  const field = Array.isArray(issue.path) && issue.path.length ? issue.path.join('.') : 'значение';
  if (issue.code === 'too_small') return `Поле «${field}»: слишком короткое значение`;
  if (issue.code === 'too_big') return `Поле «${field}»: слишком длинное значение`;
  if (issue.code === 'invalid_type') return `Поле «${field}»: неверный тип данных`;
  return issue.message || `Поле «${field}» заполнено неверно`;
}

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: Array.isArray(issue.path) ? issue.path.join('.') : '',
      message: formatIssue(issue),
    }));
    throw new HttpError(422, issues[0]?.message || 'Проверьте заполнение полей', {
      code: 'validation',
      details: issues,
    });
  }
  return result.data;
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  );
  if (req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      error: error.code || 'error',
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'bad_json', message: 'Некорректный JSON в запросе' });
  }
  console.error('[error]', new Date().toISOString(), req.method, req.originalUrl, error);
  return res.status(500).json({
    error: 'internal',
    message: 'Внутренняя ошибка сервера. Попробуйте ещё раз.',
  });
}

export function notFound(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found', message: 'Не найдено' });
  }
  return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>404</title><p style="font-family:system-ui;padding:40px">Страница не найдена. <a href="/">На главную</a></p>');
}

export function noCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
}

export function appOrigin(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const host = req.get('host');
  const proto = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}
