import fs from 'node:fs';
import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3000';
const errors = [];
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU', acceptDownloads: true });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('401')) errors.push(`[console] ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="login"]', 'admin');
await page.fill('input[name="password"]', 'Smeta2026!');
await page.click('button[type="submit"]');
await page.waitForURL('**/app', { timeout: 10000 });

// Справочник: создание/редактирование/скрытие/удаление
await page.goto(`${BASE}/app/catalog/works`, { waitUntil: 'networkidle' });
await page.click('#add-catalog-item');
await page.fill('#catalog-form input[name="name"]', 'QA работа');
await page.fill('#catalog-form input[name="category"]', 'QA категория');
await page.fill('#catalog-form input[name="unit"]', 'шт.');
await page.fill('#catalog-form input[name="price"]', '123,45');
await page.click('#catalog-form button[type="submit"]');
await page.waitForSelector('#catalog-form', { state: 'detached', timeout: 10000 });
console.log('catalog item created');
await page.fill('#catalog-search', 'QA работа');
await page.waitForTimeout(300);
const row = page.locator('[data-item-row]').filter({ hasText: 'QA работа' }).first();
if (!(await row.isVisible())) throw new Error('created item not visible');
const priceText = await row.locator('td[data-label="Цена"]').innerText();
console.log('price cell', priceText);
if (!priceText.includes('123,45')) throw new Error(`unexpected price ${priceText}`);

await row.locator('[data-edit-item]').click();
await page.waitForSelector('#catalog-form');
await page.fill('#catalog-form input[name="price"]', '200');
await page.click('#catalog-form button[type="submit"]');
await page.waitForSelector('#catalog-form', { state: 'detached', timeout: 10000 });
await page.fill('#catalog-search', 'QA работа');
await page.waitForTimeout(500);
const row2 = page.locator('[data-item-row]').filter({ hasText: 'QA работа' }).first();
console.log('edited price', await row2.locator('td[data-label="Цена"]').innerText());

await row2.locator('[data-toggle-item]').click();
await page.waitForTimeout(500);
await page.fill('#catalog-search', 'QA работа');
await page.waitForTimeout(300);
const row3 = page.locator('[data-item-row]').filter({ hasText: 'QA работа' }).first();
console.log('status after toggle', await row3.locator('td[data-label="Статус"]').innerText());
await row3.locator('[data-toggle-item]').click();
await page.waitForTimeout(400);

// Удаление
await page.fill('#catalog-search', 'QA работа');
await page.waitForTimeout(300);
const row4 = page.locator('[data-item-row]').filter({ hasText: 'QA работа' }).first();
await row4.locator('[data-delete-item]').click();
await page.click('#confirm-ok');
await page.waitForTimeout(600);
const remaining = await page.locator('[data-item-row]').filter({ hasText: 'QA работа' }).count();
console.log('remaining QA rows', remaining);
if (remaining !== 0) throw new Error('QA work was not deleted');

// Категории
await page.click('#manage-categories');
await page.waitForSelector('.category-row');
const categoryCount = await page.locator('.category-row').count();
console.log('category rows', categoryCount);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Настройки и резервная копия
await page.goto(`${BASE}/app/settings`, { waitUntil: 'networkidle' });
const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
await page.click('#backup-btn');
const download = await downloadPromise;
const target = await download.path();
const size = fs.statSync(target).size;
console.log('backup download size', size);
if (size < 1000) throw new Error('backup file too small');

// Сохранение настроек без изменений
await page.click('#settings-form button[type="submit"]');
await page.waitForTimeout(800);
console.log('settings saved');

// Выход
await page.click('[data-action="logout"]');
await page.waitForURL('**/login', { timeout: 10000 });
console.log('logout ok');

await browser.close();
if (errors.length) {
  console.log('\nERRORS:');
  for (const error of [...new Set(errors)]) console.log(error);
  process.exitCode = 1;
} else {
  console.log('\nNo browser errors.');
}
