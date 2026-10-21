import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

// A minimal D1Database over node:sqlite with the real migrations applied, so
// tests exercise the same SQL the worker runs on D1.

class Statement {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values.map((v) => (typeof v === 'boolean' ? Number(v) : (v as SQLInputValue))));
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all<T>() {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows.map((r) => ({ ...r })), success: true, meta: {} };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }

  runSync() {
    const stmt = this.db.prepare(this.sql);
    return /\breturning\b/i.test(this.sql) || /^\s*select/i.test(this.sql) ? stmt.all(...this.params) : stmt.run(...this.params);
  }
}

export function createTestDb(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  const dir = join(import.meta.dirname, '..', '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  const api = {
    raw: db,
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => s.runSync());
        db.exec('COMMIT');
        return results.map(() => ({ success: true, results: [], meta: {} }));
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
  return api as unknown as D1Database & { raw: DatabaseSync };
}
