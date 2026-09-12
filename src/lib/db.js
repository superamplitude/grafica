import mysql from 'mysql2/promise';

let pool;

export function isDbConfigured() {
  return Boolean(process.env.DB_NAME && process.env.DB_USER);
}

export function getDb() {
  if (!isDbConfigured()) {
    throw new Error('DATABASE_NOT_CONFIGURED');
  }
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 5000,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

export async function dbPing() {
  if (!isDbConfigured()) return null;
  try {
    const db = getDb();
    const [rows] = await db.query('SELECT 1 AS ok');
    return rows?.[0]?.ok === 1;
  } catch {
    return false;
  }
}

export async function dbStatus() {
  const result = await dbPing();
  if (result === null) return 'unconfigured';
  return result ? 'ok' : 'error';
}
