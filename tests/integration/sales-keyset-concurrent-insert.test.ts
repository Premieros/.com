import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
const disposable = Boolean(url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname));
(disposable ? describe : describe.skip)('sales keyset PostgreSQL boundary', () => {
  it('does not shift the next page when a newer invoice appears, and keeps timestamp ties', async () => {
    const db = new Client({ connectionString: url });
    await db.connect();
    try {
      // Temporary table is isolated to this CI connection; no real sales mutations.
      await db.query('CREATE TEMP TABLE keyset_sales_test(id uuid PRIMARY KEY, created_at timestamptz NOT NULL)');
      const ids = [1, 2, 3, 4, 5].map(n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`);
      await db.query(`INSERT INTO keyset_sales_test VALUES
        ($1,'2026-11-24T12:00:00.123455Z'), ($2,'2026-11-24T12:00:00.123456Z'),
        ($3,'2026-11-24T12:00:00.123456Z'), ($4,'2026-11-24T12:00:01Z')`, ids.slice(0, 4));
      const first = await db.query<{ id: string; stamp: string }>(
        'SELECT id, created_at::text stamp FROM keyset_sales_test ORDER BY created_at DESC, id DESC LIMIT 2');
      expect(first.rows.map(row => row.id)).toEqual([ids[3], ids[2]]);
      // Simulate a new sale becoming visible between requests.
      await db.query("INSERT INTO keyset_sales_test VALUES ($1,'2026-11-24T12:01:00Z')", [ids[4]]);
      const boundary = first.rows[1];
      const second = await db.query<{ id: string }>(
        `SELECT id FROM keyset_sales_test
          WHERE created_at < $1::timestamptz OR (created_at = $1::timestamptz AND id < $2::uuid)
          ORDER BY created_at DESC, id DESC LIMIT 2`, [boundary.stamp, boundary.id]);
      expect(second.rows.map(row => row.id)).toEqual([ids[1], ids[0]]);
    } finally { await db.end(); }
  });
});
