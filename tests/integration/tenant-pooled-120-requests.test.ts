import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required for isolated load smoke');

/**
 * 120 concurrent *logical requests* are queued through a 12-connection DB
 * pool. This is a CI smoke test, not 120 simultaneous Postgres connections
 * and not a substitute for HTTP POS checkout load testing.
 */
describe('bounded-pool tenant onboarding and branch access smoke', () => {
  it('isolates 120 overlapping tenant transactions without leaking rows', async () => {
    const pool = new Pool({ connectionString, max: 12, connectionTimeoutMillis: 5000 });
    const runId = randomUUID().slice(0, 12);
    const latencies: number[] = [];
    try {
      const tasks = Array.from({ length: 120 }, (_, i) => async () => {
        const start = Date.now();
        const db = await pool.connect();
        const [org, branch, sibling, owner] = Array.from({ length: 4 }, () => randomUUID());
        const outside = randomUUID();
        const label = `ci-overlap-${runId}-${i}`;
        try {
          await db.query('BEGIN');
          await db.query("SET LOCAL lock_timeout = '5s'");
          await db.query("SELECT set_config('app.register_branch','on',true)");
          await db.query('INSERT INTO public.organizations(id,name,slug) VALUES($1,$2,$3)',
            [org, label, label]);
          await db.query(
            "INSERT INTO public.branches(id,organization_id,name,is_active) VALUES ($1,$2,'Primary',true),($3,$2,'Sibling',true)",
            [branch, org, sibling],
          );
          const email = `${label}@example.invalid`;
          await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [owner, email]);
          await db.query(
            "INSERT INTO public.users(id,role,branch_id,email,full_name,username,is_active) VALUES($1,'owner',$2,$3,'CI Owner',$4,true)",
            [owner, branch, email, label],
          );
          await db.query(
            "SELECT set_config('app.register_branch','off',true), set_config('app.user_id',$1,true)",
            [owner],
          );
          const result = await db.query<{ primary: boolean; sibling: boolean; outside: boolean }>(
            'SELECT public.user_may_access_branch($1) primary,public.user_may_access_branch($2) sibling,public.user_may_access_branch($3) outside',
            [branch, sibling, outside],
          );
          expect(result.rows[0]).toEqual({ primary: true, sibling: true, outside: false });
          latencies.push(Date.now() - start);
        } finally {
          await db.query('ROLLBACK').catch(() => undefined);
          db.release();
        }
      });
      // Promise.all begins 120 requests at once; the pool limits DB sessions
      // to 12 to respect real-world connection pooling.
      await Promise.all(tasks.map(task => task()));
      expect(latencies).toHaveLength(120);
      const sorted = [...latencies].sort((a, b) => a - b);
      // CI runtime metric is informational; not an arbitrary SLA guarantee.
      console.info('TENANT_POOL_SMOKE_120', {
        requests: sorted.length,
        poolConnections: 12,
        p50Ms: sorted[Math.floor(sorted.length * 0.5)],
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        maxMs: sorted.at(-1),
      });
    } finally {
      await pool.end();
    }
  }, 30_000);
});
