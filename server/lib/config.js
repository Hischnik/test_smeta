import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// .env читается, если файл существует (Node 22+).
for (const file of ['.env.local', '.env']) {
  const envPath = path.join(ROOT, file);
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      /* некорректный .env не должен ронять приложение */
    }
    break;
  }
}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  root: ROOT,
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  dbPath: path.resolve(ROOT, process.env.DATA_DIR || 'data', process.env.DB_FILE || 'metrazh.db'),
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  // За обратным прокси с HTTPS включите TRUST_PROXY=1 и COOKIE_SECURE=true.
  trustProxy: bool(process.env.TRUST_PROXY, false),
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 7),
  adminLogin: process.env.ADMIN_LOGIN || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'Smeta2026!',
  demoMode: bool(process.env.DEMO_MODE, true),
  seedDemo: bool(process.env.SEED_DEMO, true),
  appName: process.env.APP_NAME || 'Метраж',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  loginRateLimit: int(process.env.LOGIN_RATE_LIMIT, 12),
  loginRateWindowMinutes: int(process.env.LOGIN_RATE_WINDOW_MINUTES, 15),
  logLevel: process.env.LOG_LEVEL || 'info',
};

export function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
