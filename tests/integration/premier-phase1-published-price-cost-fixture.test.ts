import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error('SUPABASE_DB_URL is required for integration tests');

/** Non-vacuous positive-data policy check. Never uses a production tenant. */
describe('Phase 1 — published raw-price costing source', () => {
  const db = new Client({ connectionString: dbUrl });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('uses zero without a published price and the latest published price instead of catalog default', async () => {
    const org = randomUUID(), branch = randomUUID(), material = randomUUID();
    const firstEvent = randomUUID(), secondEvent = randomUUID();
    const label = randomUUID().slice(0, 8);
    await db.query('BEGIN');
    try {
      await db.query(
        "insert into public.organizations(id,name,slug) values($1,'CI Published Price',$2)",
        [org, `ci-cost-${label}`],
      );
      await db.query(
        "insert into public.branches(id,name,organization_id) values($1,'CI Cost Branch',$2)",
        [branch,org],
      );
      await db.query(
        `insert into public.raw_materials(id,branch_id,code,name,default_cost)
         values($1,$2,$3,'CI Pricing Material',999)`,
        [material,branch,`CI-COST-${label}`],
      );

      const readCost = async () => {
        const { rows } = await db.query<{
          details:{ unit_cost:number; source:string; reference_number:string|null };
          cost:string;
        }>(`select public._raw_cost_context_for_costing($1,$2) details,
                   public._raw_cost_for_costing($1,$2)::text cost`,[material,branch]);
        return rows[0];
      };
      const noPrice = await readCost();
      expect(Number(noPrice.cost)).toBe(0);
      expect(Number(noPrice.details.unit_cost)).toBe(0);
      expect(noPrice.details.source).toBe('no_published_price');

      await db.query(
        `insert into public.raw_material_price_events(
           id,raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
         values($1,$3,$4,12.75,'pricing',$5,'2026-01-02T00:00:00Z'),
               ($2,$3,$4,18.25,'pricing',$6,'2026-01-03T00:00:00Z')`,
        [firstEvent,secondEvent,material,branch,`CI-OLD-${label}`,`CI-NEW-${label}`],
      );
      const priced = await readCost();
      expect(Number(priced.cost)).toBe(18.25);
      expect(Number(priced.details.unit_cost)).toBe(18.25);
      expect(priced.details.source).toBe('published_price');
      expect(priced.details.reference_number).toBe(`CI-NEW-${label}`);

      // Never return a material cost from an unrelated branch.
      const foreign = await db.query<{ value:string }>(
        'select coalesce(public._raw_cost_for_costing($1,$2),0)::text value',
        [material,randomUUID()],
      );
      expect(Number(foreign.rows[0].value)).toBe(0);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
