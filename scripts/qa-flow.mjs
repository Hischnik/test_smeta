import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3000';
const errors = [];

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU' });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="login"]', 'admin');
await page.fill('input[name="password"]', 'Smeta2026!');
await page.click('button[type="submit"]');
await page.waitForURL('**/app', { timeout: 10000 });
console.log('login ok');

// Создание объекта
await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
await page.click('#new-project-btn');
await page.fill('#project-form input[name="name"]', 'QA объект');
await page.fill('#project-form input[name="address"]', 'Москва, QA 1');
await page.fill('#project-form input[name="totalArea"]', '12');
await page.click('#project-form button[type="submit"]');
await page.waitForURL(/\/app\/projects\/\d+$/, { timeout: 10000 });
await page.waitForLoadState('networkidle');
const projectId = Number(page.url().match(/projects\/(\d+)/)[1]);
console.log('project created', projectId);

// Помещение
await page.click('#add-room-btn');
await page.fill('#room-form input[name="name"]', 'QA кухня');
await page.fill('#room-form input[name="area"]', '12');
await page.click('#room-form button[type="submit"]');
await page.waitForSelector('#rooms-list .room-row', { timeout: 10000 });
console.log('room created');
await page.click('#rooms-list .room-row-main');
await page.waitForURL(/\/app\/rooms\/\d+$/, { timeout: 10000 });
await page.waitForLoadState('networkidle');
const roomId = Number(page.url().match(/rooms\/(\d+)/)[1]);
console.log('room opened', roomId);

// Добавление работы через палитру
await page.click('[data-add-work]');
await page.waitForSelector('#picker-search');
await page.fill('#picker-search', 'Покраска стен');
await page.waitForTimeout(250);
await page.click('#picker-list [data-add-item]');
await page.waitForSelector('tr[data-line-id]', { timeout: 10000 });
console.log('work added');
await page.waitForTimeout(400);

// Изменение объёма и цены
const workRow = page.locator('#works-panel tr[data-line-id]').first();
await workRow.locator('[data-line-field="quantity"]').fill('10');
await workRow.locator('[data-line-field="price"]').fill('400');
await page.waitForTimeout(1200);
const workAmount = await workRow.locator('[data-amount]').innerText();
console.log('work amount', workAmount);
if (!workAmount.includes('4') || !workAmount.includes('000')) throw new Error(`unexpected work amount: ${workAmount}`);

// Добавление материала с авто-расчётом
await page.click('[data-add-material]');
await page.waitForSelector('#picker-search');
await page.fill('#picker-search', 'Штукатурка гипсовая');
await page.waitForTimeout(250);
await page.click('#picker-list [data-add-item]');
await page.waitForSelector('#materials-panel tr[data-line-id]', { timeout: 10000 });
await page.waitForTimeout(500);
const materialRow = page.locator('#materials-panel tr[data-line-id]').first();
const qtyValue = await materialRow.locator('[data-line-field="quantity"]').inputValue();
console.log('material qty', qtyValue);
if (qtyValue.trim() !== '4') throw new Error(`expected 4 bags, got ${qtyValue}`);

// Панель расчёта и ручной режим
await materialRow.locator('[data-toggle-calc]').click();
await page.waitForTimeout(200);
await page.locator('[data-calc-id]').first().locator('[data-mode="manual"]').click();
await page.waitForTimeout(700);
const qtyManual = await page.locator('#materials-panel tr[data-line-id]').first().locator('[data-line-field="quantity"]').inputValue();
console.log('manual qty', qtyManual);
await page.locator('#materials-panel tr[data-line-id]').first().locator('[data-line-field="quantity"]').fill('5');
await page.waitForTimeout(1000);
const materialAmount = await page.locator('#materials-panel tr[data-line-id]').first().locator('[data-amount]').innerText();
console.log('material amount', materialAmount);
if (!materialAmount.includes('2') || !materialAmount.includes('250')) throw new Error(`unexpected material amount: ${materialAmount}`);

// Назад к объекту, публичная ссылка
await page.click('.breadcrumbs a[href^="/app/projects/"]');
await page.waitForURL(/\/app\/projects\/\d+$/, { timeout: 10000 });
await page.waitForLoadState('networkidle');
await page.click('[data-link-action="create"]');
await page.waitForSelector('#public-url-input', { timeout: 10000 });
const publicUrl = await page.locator('#public-url-input').inputValue();
console.log('public url', publicUrl);
const publicPage = await context.newPage();
publicPage.on('pageerror', (error) => errors.push(`[public pageerror] ${error.message}`));
await publicPage.goto(publicUrl, { waitUntil: 'networkidle' });
const publicTitle = await publicPage.locator('h1').innerText();
console.log('public title', publicTitle);
if (!publicTitle.includes('QA объект')) throw new Error('public page shows wrong project');

// Проверка, что заказчик не может изменить данные
const apiResponse = await publicPage.evaluate(async () => {
  const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return response.status;
});
if (apiResponse !== 405 && apiResponse !== 401 && apiResponse !== 403) {
  throw new Error(`client can mutate API: ${apiResponse}`);
}

// Удаление тестового объекта через интерфейс
await page.bringToFront();
await page.goto(`${BASE}/app/projects/${projectId}`, { waitUntil: 'networkidle' });
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
