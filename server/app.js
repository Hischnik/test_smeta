import path from 'node:path';
import express from 'express';
import { config as defaultConfig, ROOT } from './lib/config.js';
import { audit } from './lib/db.js';
import { sessionMiddleware } from './lib/auth.js';
import { requireAuth } from './lib/auth.js';
import { errorHandler, noCache, notFound, securityHeaders } from './lib/http.js';
import { getProjectDetails } from './lib/data.js';
import { streamProjectPdf } from './lib/pdf.js';
import { renderPublicNotFound, renderPublicPage } from './lib/publicPage.js';
import { authRouter } from './routes/auth.js';
import { projectsRouter } from './routes/projects.js';
import { linesRouter, roomsRouter } from './routes/rooms.js';
import { catalogRouter } from './routes/catalog.js';
import { settingsRouter } from './routes/settings.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{24,128}$/;

function findPublicProject(db, token) {
  if (!TOKEN_RE.test(token)) return null;
  return db
    .prepare('SELECT id FROM projects WHERE public_token = ? AND public_enabled = 1')
    .get(token);
}

export function createApp(db, config = defaultConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders);

  app.use(express.json({ limit: '2mb' }));

  // Статика до авторизации: стили, шрифты, модули расчётов.
  app.use('/assets', express.static(path.join(ROOT, 'public', 'assets'), { maxAge: '1h' }));
  app.use('/fonts', express.static(path.join(ROOT, 'public', 'fonts'), { maxAge: '30d', immutable: true }));
  app.use('/shared', express.static(path.join(ROOT, 'shared'), { maxAge: '1h' }));

  app.use(sessionMiddleware(db));
  app.use((req, res, next) => {
    req.db = db;
    req.appConfig = config;
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.get('/api/meta', (req, res) => {
    noCache(res);
    res.json({
      appName: config.appName,
      demoMode: config.demoMode,
      demo: config.demoMode ? { login: config.adminLogin, password: config.adminPassword } : null,
      serverTime: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter(db, config));
  app.use('/api/projects', requireAuth, projectsRouter(db));
  app.use('/api/rooms', requireAuth, roomsRouter(db));
  app.use('/api/lines', requireAuth, linesRouter(db));
  app.use('/api/catalog', requireAuth, catalogRouter(db));
  app.use('/api/settings', requireAuth, settingsRouter(db, config));

  // Административный PDF (доступен только после входа).
  app.get('/api/projects/:id/pdf', requireAuth, (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return next();
    const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'not_found', message: 'Объект не найден' });
    try {
      const ok = streamProjectPdf(db, id, res);
      if (!ok) res.status(404).end();
      audit(db, {
        userId: req.user.id,
        login: req.user.login,
        action: 'pdf.exported',
        entity: 'project',
        entityId: id,
        ip: req.ip,
      });
    } catch (error) {
      next(error);
    }
  });

  // Публичная страница и PDF по токену — только чтение, без авторизации.
  app.get('/p/:token/pdf', (req, res, next) => {
    noCache(res);
    const project = findPublicProject(db, req.params.token);
    if (!project) {
      return res.status(404).type('html').send(renderPublicNotFound(404));
    }
    try {
      streamProjectPdf(db, project.id, res);
    } catch (error) {
      next(error);
    }
  });

  app.get('/p/:token', (req, res) => {
    noCache(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const project = findPublicProject(db, req.params.token);
    if (!project) {
      return res.status(404).type('html').send(renderPublicNotFound(404));
    }
    const details = getProjectDetails(db, project.id);
    if (!details) return res.status(404).type('html').send(renderPublicNotFound(404));
    details.publicToken = req.params.token;
    res.type('html').send(renderPublicPage(details, db));
  });

  const appHtmlPath = path.join(ROOT, 'public', 'app.html');
  function sendApp(req, res) {
    noCache(res);
    res.sendFile(appHtmlPath);
  }

  app.get('/login', sendApp);
  app.use('/app', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    sendApp(req, res);
  });

  app.get('/', (req, res) => {
    res.redirect(302, '/app');
  });

  app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(ROOT, 'public', 'assets', 'favicon.svg'));
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
