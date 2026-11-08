import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase, nowIso } from '../server/lib/db.js';
import { hashPassword } from '../server/lib/auth.js';
import { DEFAULT_SETTINGS, setSettings } from '../server/lib/data.js';
import { config } from '../server/lib/config.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrazh-test-'));
const dbPath = path.join(tmpDir, 'test.db');
let db;
let server;
let base;
let cookie = '';
let csrf = '';

before(async () => {
  db = openDatabase(dbPath);
  const timestamp = nowIso();
  db.prepare('INSERT INTO users (login, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    'tester',
    await hashPassword('TestPass123!'),
    'Тестовый администратор',
    timestamp,
    timestamp,
  );
  setSettings(db, DEFAULT_SETTINGS);
  const app = createApp(db, {
    ...config,
    demoMode: false,
    seedDemo: false,
    cookieSecure: false,
    trustProxy: false,
    loginRateLimit: 100,
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function request(urlPath, { method = 'GET', body, useCookie = true, useCsrf = true, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (useCookie && cookie) requestHeaders.Cookie = cookie;
  if (useCsrf && csrf) requestHeaders['X-CSRF-Token'] = csrf;
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { response, text, json };
}

async function login() {
  const { response, json } = await request('/api/auth/login', {
    method: 'POST',
    body: { login: 'tester', password: 'TestPass123!' },
    useCookie: false,
    useCsrf: false,
  });
  assert.equal(response.status, 200, 'login should succeed');
  cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  csrf = json.csrfToken;
}

test('публичные и защищённые маршруты', async () => {
  const unauthorized = await request('/api/projects');
  assert.equal(unauthorized.response.status, 401);

  const wrong = await request('/api/auth/login', {
    method: 'POST',
    body: { login: 'tester', password: 'wrong' },
    useCookie: false,
    useCsrf: false,
  });
  assert.equal(wrong.response.status, 401);

  await login();
  const me = await request('/api/auth/me');
  assert.equal(me.response.status, 200);
  assert.equal(me.json.user.login, 'tester');

  const noCsrf = await request('/api/projects', {
    method: 'POST',
    body: { name: 'Без CSRF' },
    useCsrf: false,
  });
  assert.equal(noCsrf.response.status, 403);
});

test('полный сценарий сметы, фиксацией цен и публичной ссылкой', async () => {
  const projectResponse = await request('/api/projects', {
    method: 'POST',
    body: {
      name: 'Тестовая квартира',
      address: 'Москва, ул. Тестовая, 1',
      totalArea: '35,5',
      description: 'Проверка полного сценария',
    },
  });
  assert.equal(projectResponse.response.status, 201);
  const project = projectResponse.json.project;
  assert.equal(project.totalArea, '35,5');

  const roomResponse = await request(`/api/projects/${project.id}/rooms`, {
    method: 'POST',
    body: { name: 'Кухня', area: '35' },
  });
  assert.equal(roomResponse.response.status, 201);
  const room = roomResponse.json.project.rooms[0];

  const workResponse = await request('/api/catalog/works', {
    method: 'POST',
    body: { name: 'Штукатурка тестовая', category: 'Черновые работы', unit: 'м²', price: '1000' },
  });
  assert.equal(workResponse.response.status, 201);
  const work = workResponse.json.item;

  const lineResponse = await request(`/api/rooms/${room.id}/lines`, {
    method: 'POST',
    body: { kind: 'work', catalogId: work.id },
  });
  assert.equal(lineResponse.response.status, 201);
  assert.equal(lineResponse.json.line.quantity, '1');
  const workLine = lineResponse.json.line;

  const updated = await request(`/api/lines/${workLine.id}`, {
    method: 'PATCH',
    body: { quantity: '2,5', price: '1000' },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.line.quantity, '2,5');
  assert.equal(updated.json.line.amountKopecks, 250_000);

  const materialResponse = await request('/api/catalog/materials', {
    method: 'POST',
    body: {
      name: 'Штукатурка в мешках',
      category: 'Смеси',
      purchaseUnit: 'мешок',
      packageSize: '30',
      consumptionUnit: 'кг',
      consumptionRate: '10',
      price: '450',
    },
  });
  assert.equal(materialResponse.response.status, 201);
  const material = materialResponse.json.item;

  const materialLineResponse = await request(`/api/rooms/${room.id}/lines`, {
    method: 'POST',
    body: { kind: 'material', catalogId: material.id },
  });
  assert.equal(materialLineResponse.response.status, 201);
  const materialLine = materialLineResponse.json.line;
  assert.equal(materialLine.quantity, '12');
  assert.equal(materialLine.amountKopecks, 540_000);
  assert.equal(materialLine.calcMode, 'auto');

  const manual = await request(`/api/lines/${materialLine.id}`, {
    method: 'PATCH',
    body: { quantity: '10' },
  });
  assert.equal(manual.json.line.calcMode, 'manual');
  assert.equal(manual.json.line.quantity, '10');
  assert.equal(manual.json.line.amountKopecks, 450_000);

  const autoAgain = await request(`/api/lines/${materialLine.id}`, {
    method: 'PATCH',
    body: { mode: 'auto' },
  });
  assert.equal(autoAgain.json.line.calcMode, 'auto');
  assert.equal(autoAgain.json.line.quantity, '12');
  assert.equal(autoAgain.json.line.amountKopecks, 540_000);

  // Изменение справочника не должно менять ранее добавленную строку.
  const priceChange = await request(`/api/catalog/materials/${material.id}`, {
    method: 'PATCH',
    body: { price: '999' },
  });
  assert.equal(priceChange.response.status, 200);
  const roomAfter = await request(`/api/rooms/${room.id}`);
  assert.equal(roomAfter.json.lines.materials[0].priceKopecks, 45_000);
  assert.equal(roomAfter.json.room.totals.total, 790_000);
  assert.equal(roomAfter.json.projectTotals.total, 790_000);

  const publicLink = await request(`/api/projects/${project.id}/public-link`, {
    method: 'POST',
    body: { regenerate: false },
  });
  const token = publicLink.json.project.publicToken;
  assert.ok(token && token.length >= 24);
  assert.equal(publicLink.json.project.publicEnabled, true);

  const publicPage = await request(`/p/${token}`, { useCookie: false });
  assert.equal(publicPage.response.status, 200);
  assert.match(publicPage.text, /Тестовая квартира/);
  assert.match(publicPage.text, /1\s000\s₽/);
  assert.doesNotMatch(publicPage.text, /Административная панель/);

  // Правка сметы видна заказчику по той же ссылке.
  const publicEdit = await request(`/api/lines/${workLine.id}`, {
    method: 'PATCH',
    body: { quantity: '3' },
  });
  assert.equal(publicEdit.json.line.amountKopecks, 300_000);
  const refreshedPublic = await request(`/p/${token}`, { useCookie: false });
  assert.match(refreshedPublic.text, /3\s000\s₽/);
  assert.match(refreshedPublic.text, /8\s400\s₽/);

  const pdf = await request(`/p/${token}/pdf`, { useCookie: false, useCsrf: false });
  assert.equal(pdf.response.status, 200);
  assert.match(pdf.response.headers.get('content-type') || '', /application\/pdf/);
  assert.ok(pdf.text.startsWith('%PDF'));

  const revoke = await request(`/api/projects/${project.id}/public-link`, { method: 'DELETE' });
  assert.equal(revoke.response.status, 200);
  assert.equal(revoke.json.project.publicEnabled, false);

  const revokedPage = await request(`/p/${token}`, { useCookie: false });
  assert.equal(revokedPage.response.status, 404);

  const deleted = await request(`/api/projects/${project.id}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
});

test('валидация и защита от некорректных данных', async () => {
  const missingName = await request('/api/projects', { method: 'POST', body: { address: 'Без названия' } });
  assert.equal(missingName.response.status, 422);

  const negativeArea = await request('/api/projects', {
    method: 'POST',
    body: { name: 'Отрицательная площадь', totalArea: '-5' },
  });
  assert.equal(negativeArea.response.status, 422);

  const badMaterial = await request('/api/catalog/materials', {
    method: 'POST',
    body: { name: 'Без единицы', purchaseUnit: 'шт.', consumptionRate: '10', price: '100' },
  });
  assert.equal(badMaterial.response.status, 422);

  const health = await request('/api/health', { useCookie: false });
  assert.equal(health.response.status, 200);
  assert.equal(health.json.ok, true);
});

test('смена пароля и повторный вход', async () => {
  const wrong = await request('/api/auth/password', {
    method: 'POST',
    body: { currentPassword: 'wrong-password', newPassword: 'NewPass123!' },
  });
  assert.equal(wrong.response.status, 422);

  const changed = await request('/api/auth/password', {
    method: 'POST',
    body: { currentPassword: 'TestPass123!', newPassword: 'NewPass123!' },
  });
  assert.equal(changed.response.status, 200);

  const logout = await request('/api/auth/logout', { method: 'POST' });
  assert.equal(logout.response.status, 200);
  cookie = '';
  csrf = '';

  const oldLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { login: 'tester', password: 'TestPass123!' },
    useCookie: false,
    useCsrf: false,
  });
  assert.equal(oldLogin.response.status, 401);

  const newLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { login: 'tester', password: 'NewPass123!' },
    useCookie: false,
    useCsrf: false,
  });
  assert.equal(newLogin.response.status, 200);
});

