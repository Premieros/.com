import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required');

describe('owner tenant branch isolation', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('owner can access every own branch, cannot view foreign branches or acquire cross-org grants', async () => {
    const [orgA, orgB, branchA, secondA, branchB, ownerId] = Array.from({ length: 6 }, () => randomUUID());
    const suffix = randomUUID().slice(0, 8);
    await db.query('BEGIN');
    try {
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query("INSERT INTO public.organizations(id,name,slug) VALUES($1,'CI owner scope A',$2),($3,'CI owner scope B',$4)",[orgA,'ci-a-'+suffix,orgB,'ci-b-'+suffix]);
      await db.query("INSERT INTO public.branches(id,organization_id,name,is_active) VALUES($1,$2,'A1',true),($3,$2,'A2',true),($4,$5,'B1',true)",[branchA,orgA,secondA,branchB,orgB]);
      await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)",[ownerId,'ci-owner-'+suffix+'@example.invalid']);
      await db.query("INSERT INTO public.users(id,role,branch_id,email,full_name,username,is_active) VALUES($1,'owner',$2,$3,'Owner CI',$4,true)",[ownerId,branchA,'ci-owner-'+suffix+'@example.invalid','ci-owner-'+suffix]);
      await db.query("SELECT set_config('app.user_id',$1,true)",[ownerId]);
      const flags = await db.query<{ mine: boolean; ownSecond: boolean; foreign: boolean }>(
        'SELECT public.user_may_access_branch($1) mine,public.user_may_access_branch($2) "ownSecond",public.user_may_access_branch($3) foreign',
        [branchA,secondA,branchB]);
      expect(flags.rows[0]).toEqual({ mine:true,ownSecond:true,foreign:false });
      await expect(db.query('INSERT INTO public.user_branch_access(user_id,branch_id) VALUES($1,$2)',[ownerId,branchB]))
        .rejects.toThrow(/OWNER_CROSS_ORGANIZATION_BRANCH_ACCESS_FORBIDDEN/);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
