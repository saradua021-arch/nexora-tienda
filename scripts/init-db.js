// Crea las tablas y carga los productos de ejemplo (se puede ejecutar varias veces sin duplicar datos)
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});
(async () => {
  for (const f of ['schema.sql', 'seed.sql']) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', f), 'utf8'));
    console.log('OK', f);
  }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
