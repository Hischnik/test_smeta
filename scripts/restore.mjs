#!/usr/bin/env node
/**
 * Восстановление базы данных из резервной копии.
 * ВНИМАНИЕ: остановите сервер перед запуском, иначе SQLite может повредить данные.
 *
 * Запуск: npm run restore -- data/backups/metrazh-2026-11-08T09-00-00.db
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir } from '../server/lib/config.js';

const source = process.argv[2];
if (!source) {
  console.error('Укажите путь к резервной копии: npm run restore -- <файл.db>');
  process.exit(1);
}

const sourcePath = path.resolve(source);
if (!fs.existsSync(sourcePath)) {
  console.error(`Файл не найден: ${sourcePath}`);
  process.exit(1);
}
const header = fs.readFileSync(sourcePath, { encoding: null }).subarray(0, 16).toString('utf8');
if (!header.startsWith('SQLite format 3')) {
  console.error('Это не похоже на базу данных SQLite.');
  process.exit(1);
}

ensureDataDir();
const target = config.dbPath;
if (path.resolve(sourcePath) === path.resolve(target)) {
  console.error('Источник и целевая база совпадают.');
  process.exit(1);
}

if (fs.existsSync(target)) {
  const safety = `${target}.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(target, safety);
  console.log(`Текущая база сохранена: ${safety}`);
}

for (const suffix of ['-wal', '-shm']) {
  const sidecar = `${target}${suffix}`;
  if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
}
fs.copyFileSync(sourcePath, target);
console.log(`База восстановлена из ${sourcePath}`);
console.log(`Целевой файл: ${target}`);
console.log('Запустите сервер: npm start');
