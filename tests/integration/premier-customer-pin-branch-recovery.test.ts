import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
const disposable = Boolean(url && ['localhost','127.0.0.1','[::1]'].some(host => url.includes(host)));
(disposable ? describe : describe.skip)('Premier customer recovery PIN across permanent branch QR', () => {
  const db = new Client({connectionString:url});
  beforeAll(async()=>{await db.connect();});
  afterAll(async()=>{await db.end();});

  it('accepts a correct old two-digit PIN with a permanent QR for the same branch, but not another branch', async()=>{
    const org=randomUUID(),branch=randomUUID(),foreignBranch=randomUUID();
    const table=randomUUID(),foreignTable=randomUUID();
    const profile=randomUUID(),visit=randomUUID(),legacyGeneration=randomUUID();
    const oldToken=randomUUID().replace(/-/g,'') + randomUUID().replace(/-/g,'');
    const stableToken=randomUUID().replace(/-/g,'') + randomUUID().replace(/-/g,'');
    const foreignToken=randomUUID().replace(/-/g,'') + randomUUID().replace(/-/g,'');
    const previousSession='a'.repeat(64),nextSession='b'.repeat(64);
    const phone='01012345678';
    await db.query('BEGIN');
    try {
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [org,'Recovery CI',`recovery-ci-${randomUUID().slice(0,8)}`]);
      await db.query('insert into public.branches(id,name,organization_id) values($1,$2,$3),($4,$5,$3)',
        [branch,'Recovery branch',org,foreignBranch,'Different branch']);
      await db.query('insert into public.dining_tables(id,branch_id,name) values($1,$2,$3),($4,$5,$6)',
        [table,branch,'Table A',foreignTable,foreignBranch,'Table B']);
      // Existing legacy PIN recovery expectation applies only to explicitly
      // opted-in branches. Unconfigured branches now default to PIN OFF.
      await db.query(
        'insert into qr_private.branch_settings(branch_id,recovery_pin_enabled) values($1,true)',
        [branch]);
      await db.query(
        `insert into qr_private.table_links(table_id,branch_id,token_hash,enabled,generation)
         values($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),true,$4)`,
        [table,branch,oldToken,legacyGeneration]);
      await db.query(
        `insert into qr_private.branch_qr_links(branch_id,anchor_table_id,token,token_hash)
         values($1,$2,$3,encode(sha256(convert_to($3,'UTF8')),'hex')),
               ($4,$5,$6,encode(sha256(convert_to($6,'UTF8')),'hex'))`,
        [branch,table,stableToken,foreignBranch,foreignTable,foreignToken]);
      const normalPhone=await db.query<{value:string}>('select qr_private.phone($1) value',[phone]);
      await db.query(
        'insert into qr_private.customer_profiles(id,branch_id,phone,name) values($1,$2,$3,$4)',
        [profile,branch,normalPhone.rows[0].value,'CI guest']);
      await db.query(
        `insert into qr_private.visits(id,branch_id,generation,profile_id,guest_hash,origin_table_id,order_type,table_id)
         values($1,$2,$3,$4,encode(sha256(convert_to($5,'UTF8')),'hex'),$6,'dine_in',$6)`,
        [visit,branch,legacyGeneration,profile,previousSession,table]);
      const {rows:codes}=await db.query<{pin:string}>('select qr_private.new_pin($1) pin',[visit]);
      const pin=codes[0].pin;
      expect(pin).toMatch(/^[0-9]{2}$/);
      const persian=Array.from(pin,digit=>'۰۱۲۳۴۵۶۷۸۹'[Number(digit)]).join('');
      const unauthorized=await db.query<{data:{success:boolean;error:string}}>(
        'select public.qr_guest_resume($1,$2,$3,$4) data',
        [foreignToken,nextSession,phone,persian]);
      expect(unauthorized.rows[0].data).toMatchObject({success:false,error:'QR_PIN_INVALID'});

      const result=await db.query<{data:{success:boolean;visit:{id:string}}}>(
        'select public.qr_guest_resume($1,$2,$3,$4) data',
        [stableToken,nextSession,phone,persian]);
      expect(result.rows[0].data).toMatchObject({success:true,visit:{id:visit}});
      const {rows}=await db.query<{generation:string;origin_table_id:string;pin_failures:number}>(
        'select generation,origin_table_id,pin_failures from qr_private.visits where id=$1',[visit]);
      const {rows:link}=await db.query<{generation:string}>(
        'select generation from qr_private.branch_qr_links where branch_id=$1',[branch]);
      expect(rows[0]).toEqual({generation:link[0].generation,origin_table_id:table,pin_failures:0});

      // Neither generating a fresh device session nor reprinting the branch code rotates its generation.
      const again=await db.query<{data:{success:boolean}}> (
        'select public.qr_guest_resume($1,$2,$3,$4) data',
        [stableToken,nextSession,phone,pin]);
      expect(again.rows[0].data.success).toBe(true);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
