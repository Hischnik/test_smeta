#!/usr/bin/env node
/**
 * Резервная копия базы данных «Метраж».
 * Использует VACUUM INTO — согласованный снимок SQLite без остановки сервера.
 *
 * Запуск: npm run backup
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../server/lib/db.js';
import { config, ensureDataDir } from '../server/lib/config.js';

ensureDataDir();
if (!fs.existsSync(config.dbPath)) {
  console.error(`База данных не найдена: ${config.dbPath}`);
  console.error('Запустите приложение один раз, чтобы создать базу.');
  process.exit(1);
}
const backupDir = path.join(config.dataDir, 'backups');
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(backupDir, `metrazh-${stamp}.db`);

const db = openDatabase();
try {
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
} finally {
  db.close();
}

const stats = fs.statSync(destination);
console.log(`Резервная копия создана: ${destination}`);
console.log(`Размер: ${(stats.size / 1024).toFixed(1)} КБ`);

// Храним последние 30 копий, созданных этим скриптом.
const copies = fs
  .readdirSync(backupDir)
  .filter((name) => /^metrazh-.*\.db$/.test(name))
  .map((name) => ({ name, time: fs.statSync(path.join(backupDir, name)).mtimeMs }))
  .sort((a, b) => b.time - a.time);
for (const old of copies.slice(30)) {
  fs.rmSync(path.join(backupDir, old.name), { force: true });
}
