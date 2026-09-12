import mysql from 'mysql2/promise';

let pool;

export function getDb() {
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
      charset: 'utf8mb4'
    });
  }
  return pool;
}

export async function dbPing() {
  if (!process.env.DB_NAME || !process.env.DB_USER) return false;
  const db = getDb();
  const [rows] = await db.query('SELECT 1 AS ok');
  return rows?.[0]?.ok === 1;
}
