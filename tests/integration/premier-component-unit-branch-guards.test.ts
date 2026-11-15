import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbUrl = process.env.SUPABASE_DB_URL;
const disposable = Boolean(dbUrl && (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || dbUrl.includes('[::1]')));
(disposable ? describe : describe.skip)('Premier product BOM / unit branch protection', () => {
  const db = new Client({ connectionString: dbUrl });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('rejects cross-branch components and unit links, including later branch moves', async () => {
    const org = randomUUID(), a = randomUUID(), b = randomUUID();
    const product = randomUUID(), same = randomUUID(), other = randomUUID();
    const unitA = randomUUID(), unitB = randomUUID();
    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    await db.query('BEGIN');
    try {
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [org,'CI branch integrity',`ci-branch-guard-${tag}`]);
      await db.query('insert into public.branches(id,name,organization_id) values($1,$2,$3),($4,$5,$3)',
        [a,'CI A',org,b,'CI B']);
      for (const [id, branch, code] of [
        [product,a,'ROOT'],[same,a,'SAME'],[other,b,'OTHER'],
      ]) {
        await db.query(
          `insert into public.products(id,name,sku,branch_id,product_type,cost_price,sale_price,wholesale_price)
           values($1,$2,$3,$4,'ready',1,2,2)`,
          [id,`CI-${code}`,`CI-${code}-${tag}`,branch]);
      }
      await db.query(
        `insert into public.inventory_units(id,code,name,unit_type,branch_id)
         values($1,$2,'CI Unit A','ready',$3),($4,$5,'CI Unit B','ready',$6)`,
        [unitA,`CI-UA-${tag}`,a,unitB,`CI-UB-${tag}`,b]);

      await db.query('insert into public.product_components(product_id,component_product_id,quantity) values($1,$2,1)',
        [product,same]);
      await db.query('insert into public.product_unit_links(product_id,unit_id,quantity) values($1,$2,1)',
        [product,unitA]);

      // Savepoints preserve the fixture after expected PostgreSQL check violations.
      for (const [statement, values, marker] of [
        [
          'insert into public.product_components(product_id,component_product_id,quantity) values($1,$2,1)',
          [product,other], 'PREMIER_COMPONENT_BRANCH_MISMATCH',
        ],
        [
          'insert into public.product_unit_links(product_id,unit_id,quantity) values($1,$2,1)',
          [product,unitB], 'PREMIER_PRODUCT_UNIT_BRANCH_MISMATCH',
        ],
        [
          'update public.products set branch_id=$1 where id=$2',
          [b,product], 'PREMIER_PRODUCT_BRANCH_MOVE_BREAKS_LINKS',
        ],
        [
          'update public.inventory_units set branch_id=$1 where id=$2',
          [b,unitA], 'PREMIER_INVENTORY_UNIT_BRANCH_MOVE_BREAKS_LINKS',
        ],
      ] as const) {
        await db.query('SAVEPOINT guard_test');
        await expect(db.query(statement, [...values])).rejects.toThrow(marker);
        await db.query('ROLLBACK TO SAVEPOINT guard_test');
        await db.query('RELEASE SAVEPOINT guard_test');
      }
      const {rows} = await db.query<{components:string;links:string}>(
        `select
         (select count(*)::text from public.product_components where product_id=$1) components,
         (select count(*)::text from public.product_unit_links where product_id=$1) links`,
        [product]);
      expect(rows[0]).toEqual({components:'1',links:'1'});
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
