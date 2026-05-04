
const { db } = require('../api/_lib/db');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir).sort();

  for (const file of files) {
    if (file.endsWith('.sql')) {
      console.log(`Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await db.query(sql);
      console.log(`Finished migration: ${file}`);
    }
  }

  await db.end();
  console.log('All migrations completed.');
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
      