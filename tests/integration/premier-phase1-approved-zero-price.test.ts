import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL is required for integration tests');

describe('Last approved material price — explicit zero is a valid price', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('overrides previous nonzero pricing with approved zero, without weighted-average fallback', async () => {
    const org=randomUUID(), branch=randomUUID(), material=randomUUID();
    const suffix=randomUUID().slice(0,8);
    await db.query('BEGIN');
    try {
      await db.query("insert into public.organizations(id,name,slug) values($1,'CI Zero Pricing',$2)", [org,`ci-zero-pricing-${suffix}`]);
      await db.query("insert into public.branches(id,name,organization_id) values($1,'CI Zero Pricing Branch',$2)",[branch,org]);
      await db.query(
        "insert into public.raw_materials(id,branch_id,code,name,default_cost) values($1,$2,$3,'CI Zero Pricing Material',999)",
        [material,branch,`CI-ZERO-${suffix}`],
      );
      const read=async()=>{
        const {rows}=await db.query<{
          context:{unit_cost:number;source:string;reference_number:string|null};
          cost:string;legacy_average:string;
        }>(`select public._raw_cost_context_for_costing($1,$2) context,
                  public._raw_cost_for_costing($1,$2)::text cost,
                  public._raw_wavg_cost($1,$2)::text legacy_average`,[material,branch]);
        return rows[0];
      };
      expect(Number((await read()).cost)).toBe(0);
      expect(Number((await read()).legacy_average)).toBe(0);
      await db.query(`insert into public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
         values($1,$2,25,'pricing',$3,'2026-11-14T00:00:00Z')`,[material,branch,`OLD-${suffix}`]);
      expect(Number((await read()).cost)).toBe(25);
      expect(Number((await read()).legacy_average)).toBe(25);

      // Zero is a PUBLISHED price: it supersedes prior nonzero price, not 'no price'.
      await db.query(`insert into public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
         values($1,$2,0,'pricing',$3,'2026-11-15T00:00:00Z')`,[material,branch,`ZERO-${suffix}`]);
      const zero=await read();
      expect(Number(zero.cost)).toBe(0);
      expect(Number(zero.legacy_average)).toBe(0);
      expect(zero.context.source).toBe('published_price');
      expect(zero.context.reference_number).toBe(`ZERO-${suffix}`);
      const {rows:events}=await db.query<{value:string}>(
        `select unit_cost::text value from public._raw_cost_events_for_costing($1,$2)
          where source='pricing' order by priced_at desc limit 1`,[material,branch]);
      expect(Number(events[0].value)).toBe(0);

      // The authorized API must accept zero as an explicit approval, too.
      await db.query('SET LOCAL ROLE service_role');
      const {rows:approved}=await db.query<{res:{success:boolean;unit_cost:number}}> (
        'select public.set_raw_material_price($1,$2,0,$3) res',
        [material,branch,'CI explicit approved zero'],
      );
      expect(approved[0].res.success).toBe(true);
      expect(Number(approved[0].res.unit_cost)).toBe(0);
      await db.query('RESET ROLE');
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
