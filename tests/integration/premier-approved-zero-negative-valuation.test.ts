import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('SUPABASE_DB_URL required');

describe('Negative-stock costing respects approved zero', () => {
  const db = new Client({connectionString:url});
  beforeAll(async()=>{await db.connect();});
  afterAll(async()=>{await db.end();});

  it('never uses an old batch price when last approved material cost is zero', async () => {
    const {rows} = await db.query<{
      approved_zero_estimate:string;
      approved_zero_unpriced:string;
      missing_price_unpriced:string;
    }>(`
      with inputs as (
        select -3::numeric qty, 0::numeric latest_cost,
               45::numeric historical_batch_cost, 'pricing'::text price_source
      ),
      missing as (
        select -3::numeric qty, 0::numeric latest_cost,
               45::numeric historical_batch_cost, 'no_published_price'::text price_source
      )
      select
        (select (-qty*coalesce(latest_cost,0))::text from inputs) approved_zero_estimate,
        (select (case when qty<0 and price_source='no_published_price' then -qty else 0 end)::text from inputs) approved_zero_unpriced,
        (select (case when qty<0 and price_source='no_published_price' then -qty else 0 end)::text from missing) missing_price_unpriced
    `);
    expect(Number(rows[0].approved_zero_estimate)).toBe(0);
    expect(Number(rows[0].approved_zero_unpriced)).toBe(0);
    expect(Number(rows[0].missing_price_unpriced)).toBe(3);
  });

  it('binds the real reporting RPC to the approved price, not historical batch prices', async () => {
    const {rows} = await db.query<{definition:string}>(`
      select pg_get_functiondef(p.oid) definition
      from pg_proc p
      where p.pronamespace='public'::regnamespace
        and p.proname='get_raw_material_cost_valuation_overview'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].definition).toContain('COALESCE(pr.latest_cost, 0)');
    expect(rows[0].definition).toContain("pr.price_source = 'no_published_price'");
    expect(rows[0].definition).not.toContain('NULLIF(pr.latest_cost, 0)');
    expect(rows[0].definition).not.toContain('NULLIF(b.unit_cost, 0)');
  });
});
