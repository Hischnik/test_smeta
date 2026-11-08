import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3000';
const errors = [];
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU' });
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

await page.goto(`${BASE}/app/rooms/1`, { waitUntil: 'networkidle' });
const row = page.locator('#materials-panel tr[data-line-id]').first();
await row.locator('[data-toggle-calc]').click();
const calc = page.locator('[data-calc-id]').first();
console.log('initial qty', await row.locator('[data-qty-input]').inputValue());
await calc.locator('[data-line-field="calcArea"]').fill('40');
await page.keyboard.press('Tab');
await page.waitForTimeout(1200);
console.log('qty after area 40', await row.locator('[data-qty-input]').inputValue());
console.log('amount after area 40', await row.locator('[data-amount]').innerText());
if ((await row.locator('[data-qty-input]').inputValue()).trim() !== '14') throw new Error('auto recalculation by area failed');

const calc2 = page.locator('[data-calc-id]').first();
await calc2.locator('[data-line-field="calcArea"]').fill('32');
await page.keyboard.press('Tab');
await page.waitForTimeout(1200);
console.log('qty restored', await row.locator('[data-qty-input]').inputValue());

// Ручной режим и корректировка
await page.locator('[data-calc-id]').first().locator('[data-mode="manual"]').click();
await page.waitForTimeout(700);
const qty = page.locator('#materials-panel tr[data-line-id]').first().locator('[data-qty-input]');
console.log('mode manual, qty', await qty.inputValue(), 'readonly', await qty.getAttribute('readonly'));
await qty.fill('10');
await qty.blur();
await page.waitForTimeout(1000);
console.log('manual amount', await page.locator('#materials-panel tr[data-line-id]').first().locator('[data-amount]').innerText());

// Возврат в авто
await page.locator('#materials-panel tr[data-line-id]').first().locator('[data-toggle-calc]').click();
await page.waitForTimeout(200);
await page.locator('[data-calc-id]').first().locator('[data-mode="auto"]').click();
await page.waitForTimeout(900);
console.log('auto qty again', await page.locator('#materials-panel tr[data-line-id]').first().locator('[data-qty-input]').inputValue());

// Перезагрузка и проверка сохранения
await page.reload({ waitUntil: 'networkidle' });
const reloadedQty = await page.locator('#materials-panel tr[data-line-id]').first().locator('[data-qty-input]').inputValue();
console.log('qty after reload', reloadedQty);
if (reloadedQty.trim() !== '11') throw new Error('auto mode did not persist');

await browser.close();
if (errors.length) {
  console.log('\nERRORS:');
  for (const error of [...new Set(errors)]) console.log(error);
  process.exitCode = 1;
} else {
  console.log('\nNo browser errors.');
}
