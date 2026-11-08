import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3000';
const OUT = path.resolve('data', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const db = new DatabaseSync(path.resolve('data', 'metrazh.db'));
const project = db.prepare('SELECT id, public_token, public_enabled FROM projects ORDER BY id LIMIT 1').get();
const room = db.prepare('SELECT id FROM rooms WHERE project_id = ? ORDER BY id LIMIT 1').get(project.id);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const errors = [];

async function makePage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ru-RU' });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
  page.on('requestfailed', (request) => errors.push(`[failed] ${request.url()} ${request.failure()?.errorText}`));
  return { context, page };
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="login"]', 'admin');
  await page.fill('input[name="password"]', 'Smeta2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/app', { timeout: 10000 });
  await page.waitForLoadState('networkidle');
}

const shots = [
  { name: 'dashboard', path: '/app' },
  { name: 'project', path: `/app/projects/${project.id}` },
  { name: 'room', path: `/app/rooms/${room.id}` },
  { name: 'works', path: '/app/catalog/works' },
  { name: 'materials', path: '/app/catalog/materials' },
  { name: 'settings', path: '/app/settings' },
];

const desktop = await makePage({ width: 1440, height: 1000 });
await login(desktop.page);
for (const shot of shots) {
  await desktop.page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  await desktop.page.waitForTimeout(500);
  await desktop.page.screenshot({ path: path.join(OUT, `${shot.name}.png`), fullPage: true });
  console.log('shot', shot.name);
}

const mobile = await makePage({ width: 390, height: 844 });
await login(mobile.page);
for (const shot of [{ name: 'dashboard-mobile', path: '/app' }, { name: 'room-mobile', path: `/app/rooms/${room.id}` }]) {
  await mobile.page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  await mobile.page.waitForTimeout(400);
  await mobile.page.screenshot({ path: path.join(OUT, `${shot.name}.png`), fullPage: true });
  console.log('shot', shot.name);
}

const publicContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU' });
const publicPage = await publicContext.newPage();
if (project.public_enabled && project.public_token) {
  await publicPage.goto(`${BASE}/p/${project.public_token}`, { waitUntil: 'networkidle' });
  await publicPage.screenshot({ path: path.join(OUT, 'public.png'), fullPage: true });
  console.log('shot public');
}
const publicMobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
const publicMobilePage = await publicMobile.newPage();
if (project.public_enabled && project.public_token) {
  await publicMobilePage.goto(`${BASE}/p/${project.public_token}`, { waitUntil: 'networkidle' });
  await publicMobilePage.screenshot({ path: path.join(OUT, 'public-mobile.png'), fullPage: true });
  console.log('shot public mobile');
}

await browser.close();
if (errors.length) {
  console.log('\nERRORS:');
  for (const error of [...new Set(errors)]) console.log(error);
} else {
  console.log('\nNo browser errors.');
}
