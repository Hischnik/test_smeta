import { createApp } from './app.js';
import { config, ensureDataDir } from './lib/config.js';
import { openDatabase } from './lib/db.js';
import { configureSessionTtl, cleanupSessions } from './lib/auth.js';
import { seedDatabase } from './lib/seed.js';

async function main() {
  ensureDataDir();
  configureSessionTtl(config.sessionTtlDays);
  const db = openDatabase();
  const { adminCreated } = await seedDatabase(db);
  const app = createApp(db, config);

  const server = app.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    console.log('');
    console.log('  Метраж — сметы на ремонт квартир');
    console.log(`  Сайт:        http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${port}`);
    console.log(`  База данных: ${config.dbPath}`);
    console.log(`  Режим:       ${config.env}${config.demoMode ? ' (демо-данные)' : ''}`);
    if (adminCreated) {
      console.log(`  Администратор: ${config.adminLogin} / ${config.adminPassword}`);
    }
    console.log('');
  });

  const cleanup = setInterval(() => {
    try {
      cleanupSessions(db);
    } catch (error) {
      console.error('[sessions] cleanup failed', error);
    }
  }, 60 * 60 * 1000);
  cleanup.unref();

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[server] ${signal}, завершение работы…`);
    server.close(() => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[startup] не удалось запустить приложение', error);
  process.exit(1);
});
