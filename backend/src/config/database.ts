import mysql, { ResultSetHeader } from 'mysql2/promise';
import { config } from './env';

const pool = mysql.createPool({
  host: config.DATABASE_HOST,
  port: config.DATABASE_PORT,
  user: config.DATABASE_USER,
  password: config.DATABASE_PASSWORD,
  database: config.DATABASE_NAME,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  supportBigNumbers: true,
  bigNumberStrings: true,
  typeCast: function (field: any, next: () => void) {
    // Convert TINYINT(1) to boolean
    if (field.type === 'TINY' && field.length === 1) {
      return field.string() === '1';
    }
    return next();
  },
});

// Log connection events
pool.on('connection', () => {
  console.log('[Database] New MySQL connection established');
});

/**
 * Unified query result interface.
 * Compatible with the existing service code that uses result.rows[0], result.rowCount, etc.
 */
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
  insertId?: string;
}

/**
 * Execute a parameterized SQL query.
 * Uses MySQL `?` placeholders.
 * Returns { rows, rowCount, insertId } for compatibility with existing service patterns.
 */
async function query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const [result] = await pool.execute(sql, params || []);
    const duration = Date.now() - start;

    if (process.env.NODE_ENV === 'development') {
      console.log('[Database] Query:', {
        sql: sql.substring(0, 120),
        duration: `${duration}ms`,
      });
    }

    if (Array.isArray(result)) {
      // SELECT query — result is RowDataPacket[]
      return {
        rows: result as unknown as T[],
        rowCount: result.length,
      };
    } else {
      // INSERT / UPDATE / DELETE — result is ResultSetHeader
      const header = result as ResultSetHeader;
      return {
        rows: [] as unknown as T[],
        rowCount: header.affectedRows,
        insertId: header.insertId > 0 ? String(header.insertId) : undefined,
      };
    }
  } catch (error) {
    const duration = Date.now() - start;
    console.error('[Database] Query error:', {
      sql: sql.substring(0, 120),
      duration: `${duration}ms`,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Get a dedicated connection from the pool (for transactions).
 */
async function getClient() {
  return pool.getConnection();
}

export { pool, query, getClient };
