// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {expect,it} from 'vitest';

it('publishes branch text with permissions, validation and revision protection',async()=>{
 const db=new PGlite();
 const branch='10000000-0000-4000-8000-000000000001';
 const other='10000000-0000-4000-8000-000000000002';
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create schema qr_private;
   grant usage on schema qr_private to anon,authenticated,service_role;
   create function public.can_permission(text) returns boolean language sql as $$ select true $$;
   create table public.roles(role text,permissions jsonb);
   insert into public.roles values('manager','["settings.manage"]'),('cashier','[]');
   create table public.branch_website_photos(branch_id uuid primary key,images jsonb,updated_at timestamptz default now());
   create function qr_private.require_staff(p_branch uuid,p_permission text) returns void language plpgsql as $$
   begin if p_branch::text is distinct from current_setting('test.branch',true) or
    p_permission is distinct from current_setting('test.permission',true) then raise exception 'FORBIDDEN'; end if; end $$;
   create table public.organizations(id uuid primary key,is_active boolean);
   create table public.branches(id uuid primary key,organization_id uuid,is_active boolean);
   create function qr_private.require_settings(p_branch uuid) returns void language plpgsql as $$
   begin if p_branch::text is distinct from current_setting('test.branch',true) then raise exception 'FORBIDDEN'; end if; end $$;
   insert into public.organizations values('${branch}',true);
   insert into public.branches values('${branch}','${branch}',true),('${other}','${branch}',true);`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261121130032_branch_website_central_content.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261121131705_branch_website_content_private_execution.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261121160253_website_inline_edit_permission.sql',import.meta.url),'utf8'));
  const interfaces=await db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where pronamespace='public'::regnamespace and proname like 'branch_website_content_%'");
  expect(interfaces.rows).toHaveLength(3);
  expect(interfaces.rows.every(row=>!row.prosecdef)).toBe(true);
  await db.query("select set_config('test.branch',$1,false)",[branch]);
  await db.query("select set_config('test.permission','website.edit',false)");
  expect((await db.query<{allowed:boolean}>("select permissions ? 'website.edit' allowed from public.roles where role='manager'")).rows[0].allowed).toBe(true);
  expect((await db.query<{allowed:boolean}>("select permissions ? 'website.edit' allowed from public.roles where role='cashier'")).rows[0].allowed).toBe(false);
  const save=(id:string,content:unknown,version:number)=>db.query<{revision:number}>(
   'select public.branch_website_content_save($1,$2::jsonb,$3) revision',[id,JSON.stringify(content),version]);
  expect((await save(branch,{heroCopy:'A new public description',navOrder:'Order'},0)).rows[0].revision).toBe(1);
  const uploadPath=`${branch}/heroImage/20000000-0000-4000-8000-000000000001.jpg`;
  expect((await db.query<{allowed:boolean}>('select public.branch_website_photo_upload_allowed($1) allowed',[uploadPath])).rows[0].allowed).toBe(true);
  await db.query("select set_config('test.permission','settings.manage',false)");
  await expect(save(branch,{heroCopy:'Unauthorized settings-only writer'},1)).rejects.toThrow('FORBIDDEN');
  await expect(db.query('select public.branch_website_photos_save($1,$2::jsonb)',[branch,'{}'])).rejects.toThrow('FORBIDDEN');
  expect((await db.query<{allowed:boolean}>('select public.branch_website_photo_upload_allowed($1) allowed',[uploadPath])).rows[0].allowed).toBe(false);
  await db.query("select set_config('test.permission','website.edit',false)");
  await expect(save(branch,{heroCopy:'Stale write'},0)).rejects.toThrow('WEBSITE_CONTENT_CONFLICT');
  await expect(save(other,{heroCopy:'Wrong branch'},0)).rejects.toThrow('FORBIDDEN');
  await expect(save(branch,{heroCopy:123},1)).rejects.toThrow('INVALID_WEBSITE_TEXT');
  await expect(save(branch,{unexpected:'x'},1)).rejects.toThrow('INVALID_WEBSITE_TEXT');
  await db.exec('set role anon');
  const read=await db.query<{content:{heroCopy:string}}>('select public.branch_website_content_public($1) content',[branch]);
  expect(read.rows[0].content.heroCopy).toBe('A new public description');
  await expect(save(branch,{heroCopy:'Anonymous'},1)).rejects.toThrow('permission denied');
  await expect(db.query('select * from public.branch_website_content')).rejects.toThrow('permission denied');
  await db.exec('reset role');
  await db.query('update public.branches set is_active=false where id=$1',[branch]);
  expect((await db.query<{content:object}>('select public.branch_website_content_public($1) content',[branch])).rows[0].content).toEqual({});
 }finally{await db.close();}
});
