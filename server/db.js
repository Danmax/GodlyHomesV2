import mysql from 'mysql2/promise';
import { databaseTLS } from './database-tls.js';

export const db = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'godly_homes',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'godly_homes',
  ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : {}),
  ...databaseTLS(),
  connectionLimit: 8,
  charset: 'utf8mb4',
  timezone: 'Z',
});

export async function rows(sql, values = [], connection = db) {
  const [result] = await connection.execute(sql, values);
  return result;
}

export async function transaction(fn) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export const json = value => typeof value === 'string' ? JSON.parse(value) : value;
