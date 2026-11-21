import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString=process.env.SUPABASE_DB_URL;
if(!connectionString) throw new Error('SUPABASE_DB_URL is required');

describe('One persistent venue QR per branch',()=>{
  const db=new Client({connectionString});
  beforeAll(async()=>{await db.connect();});
  afterAll(async()=>{await db.end();});

  it('uses the branch ID as primary identity and a unique QR token',async()=>{
    const {rows}=await db.query<{conname:string;def:string}>(`
      select conname,pg_get_constraintdef(oid) def
      from pg_constraint where conrelid='qr_private.branch_qr_links'::regclass
        and contype in ('p','u')`);
    expect(rows.some(r=>r.def==='PRIMARY KEY (branch_id)')).toBe(true);
    expect(rows.some(r=>r.def==='UNIQUE (token)')).toBe(true);
  });
  it('reuses the existing token and serializes simultaneous creation',async()=>{
    const {rows:[r]}=await db.query<{source:string}>(`
      select pg_get_functiondef('qr_private.branch_code(uuid)'::regprocedure) source`);
    expect(r.source).toContain('pg_advisory_xact_lock');
    expect(r.source).toContain('SELECT token INTO v_token');
    expect(r.source).toContain('IF v_token IS NOT NULL THEN RETURN v_token');
    expect(r.source).not.toMatch(/UPDATE\s+qr_private\.branch_qr_links/i);
  });
  it('does not authorize random customers to create or fetch a venue token',async()=>{
    const {rows:[r]}=await db.query<{allowed:boolean}>(`
      select has_function_privilege('anon','public.qr_branch_code(uuid)','EXECUTE') allowed`);
    expect(r.allowed).toBe(false);
  });
});
