import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required for financial integration');

describe('Phase 1 — positive-data journal integrity fixtures (rollback only)', () => {
  const client = new Client({ connectionString });
  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });

  it('finds a balanced posted journal and detects a deliberately imbalanced draft', async () => {
    const org = randomUUID(), branch = randomUUID(), journal = randomUUID();
    const debitAccount = randomUUID(), creditAccount = randomUUID();
    const marker = randomUUID().slice(0, 8).toUpperCase();

    await client.query('BEGIN');
    try {
      await client.query(
        "insert into public.organizations(id,name,slug) values($1,'CI Finance Positive Fixture',$2)",
        [org, `ci-finance-${marker.toLowerCase()}`]);
      await client.query(
        "insert into public.branches(id,name,organization_id) values($1,'CI Financial Branch',$2)",
        [branch, org]);
      await client.query(
        `insert into public.chart_of_accounts(id,branch_id,code,name,account_type)
         values ($1,$3,$4,'CI Cash','asset'),($2,$3,$5,'CI Revenue','income')`,
        [debitAccount, creditAccount, branch, `CF${marker}A`, `CF${marker}R`]);
      await client.query(
        `insert into public.journal_entries(id,branch_id,entry_number,description,posting_status)
         values($1,$2,$3,'CI rollback-only positive journal','DRAFT')`,
        [journal,branch,`CI-JRN-${marker}`]);
      await client.query(
        `insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit)
         values($1,$2,125.50,0),($1,$3,0,125.50)`,
        [journal,debitAccount,creditAccount]);
      await client.query(
        "update public.journal_entries set posting_status='POSTED' where id=$1",
        [journal]);

      const sql = `select j.posting_status, count(l.id)::int as lines,
        coalesce(sum(l.debit),0)::numeric as debit, coalesce(sum(l.credit),0)::numeric as credit,
        coalesce(sum(l.debit-l.credit),0)::numeric as variance
        from public.journal_entries j
        join public.journal_entry_lines l on l.journal_entry_id=j.id
        where j.id=$1 group by j.posting_status`;
      const { rows: posted } = await client.query<{
        posting_status:string; lines:number; debit:string; credit:string; variance:string;
      }>(sql,[journal]);
      expect(posted[0]).toMatchObject({
        posting_status:'POSTED',lines:2,
      });
      expect(Number(posted[0].debit)).toBe(125.5);
      expect(Number(posted[0].credit)).toBe(125.5);
      expect(Number(posted[0].variance)).toBe(0);

      // A deliberate anomaly must be observable; nonempty data is required.
      await client.query(
        `insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit)
         values($1,$2,3,0)`,
        [journal,debitAccount]);
      const { rows: detected } = await client.query<{variance:string}>(sql,[journal]);
      expect(Number(detected[0].variance)).toBe(3);
      const { rows: anomalies } = await client.query<{n:string}>(
        `select count(*)::text n from (
           select journal_entry_id from public.journal_entry_lines
           where journal_entry_id=$1 group by journal_entry_id
           having round(sum(coalesce(debit,0)-coalesce(credit,0)),2) <> 0
         ) flagged`,[journal]);
      expect(anomalies[0].n).toBe('1');
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
