import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '..', '..', 'migrations');

if (!process.env.DB_NAME || !process.env.DB_USER) {
  throw new Error('DB_NAME e DB_USER sao obrigatorios para migracao.');
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
  charset: 'utf8mb4'
});

try {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      checksum_sha256 CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'));

  for (const filename of files) {
    const fullPath = path.join(migrationsDir, filename);
    const sql = await fs.readFile(fullPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const [rows] = await connection.execute(
      'SELECT checksum_sha256 FROM schema_migrations WHERE filename = ? LIMIT 1',
      [filename]
    );

    if (rows.length) {
      if (rows[0].checksum_sha256 !== checksum) {
        throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${filename}`);
      }
      console.log(`[SKIP] ${filename}`);
      continue;
    }

    console.log(`[APPLY] ${filename}`);
    await connection.query(sql);
    await connection.execute(
      'INSERT INTO schema_migrations (filename, checksum_sha256) VALUES (?, ?)',
      [filename, checksum]
    );
    console.log(`[OK] ${filename}`);
  }

  console.log(`Migracoes concluídas: ${files.length} arquivo(s) verificado(s).`);
} finally {
  await connection.end();
}
