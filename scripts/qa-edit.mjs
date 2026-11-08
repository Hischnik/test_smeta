import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3000';
const errors = [];
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('401')) errors.push(`[console] ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="login"]', 'admin');
await page.fill('input[name="password"]', 'Smeta2026!');
await page.click('button[type="submit"]');
await page.waitForURL('**/app');

// Создать временный объект
await page.click('#new-project-btn');
await page.fill('#project-form input[name="name"]', 'QA объект редактирования');
await page.fill('#project-form input[name="totalArea"]', '10');
await page.click('#project-form button[type="submit"]');
await page.waitForURL(/\/app\/projects\/\d+$/);
const projectUrl = page.url();
const projectId = Number(projectUrl.match(/projects\/(\d+)/)[1]);
await page.waitForLoadState('networkidle');

// Редактировать объект
await page.click('#edit-project-btn');
await page.fill('#project-form input[name="name"]', 'QA объект изменён');
await page.fill('#project-form textarea[name="description"]', 'Новое описание');
await page.click('#project-form button[type="submit"]');
await page.waitForTimeout(700);
const title = await page.locator('.page-head h1').innerText();
console.log('project title after edit:', title);
if (title !== 'QA объект изменён') throw new Error('project edit failed');

// Добавить помещение и переименовать
await page.click('#add-room-btn');
await page.fill('#room-form input[name="name"]', 'QA комната');
await page.fill('#room-form input[name="area"]', '10');
await page.click('#room-form button[type="submit"]');
await page.waitForSelector('#rooms-list .room-row');
await page.locator('#rooms-list .room-row').hover();
await page.locator('[data-edit-room]').click();
await page.fill('#room-form input[name="name"]', 'QA комната 2');
await page.click('#room-form button[type="submit"]');
await page.waitForTimeout(800);
const roomName = await page.locator('#rooms-list .room-info strong').innerText();
console.log('room name after edit:', roomName);
if (roomName !== 'QA комната 2') throw new Error('room edit failed');

// Удалить объект
await page.click('#delete-project-btn');
await page.click('#confirm-ok');
await page.waitForURL('**/app', { timeout: 10000 });
console.log('cleanup done');

await browser.close();
if (errors.length) {
  console.log('\nERRORS:');
  for (const error of [...new Set(errors)]) console.log(error);
  process.exitCode = 1;
} else {
  console.log('\nNo browser errors.');
}
