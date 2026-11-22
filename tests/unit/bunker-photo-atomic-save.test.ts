// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {expect,it} from 'vitest';

it('updates individual Bunker images without overwriting other edits',async()=>{
 const db=new PGlite();
 const branch='10000000-0000-4000-8000-000000000001';
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create schema qr_private;
   create table public.branch_website_photos(
     branch_id uuid primary key, images jsonb not null default '{}'::jsonb,
     updated_at timestamptz default now()
   );
   create function qr_private.require_website(p_branch uuid) returns void
   language plpgsql as $$
   begin if p_branch::text is distinct from current_setting('test.branch',true)
   then raise exception 'FORBIDDEN'; end if; end $$;`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261122090000_bunker_photo_atomic_save.sql',import.meta.url),'utf8'));
  await db.query("select set_config('test.branch',$1,false)",[branch]);
  const save=(key:string,url:string,previous:string,id=branch)=>
   db.query('select public.branch_website_photo_save_one($1,$2,$3,$4)',[id,key,url,previous]);
  await save('heroImage','https://cdn.example.com/hero-a.jpg','');
  await save('gallery1','https://cdn.example.com/gallery.jpg','');
  await save('heroImage','https://cdn.example.com/hero-b.jpg','https://cdn.example.com/hero-a.jpg');
  await expect(save('heroImage','https://cdn.example.com/old.jpg','https://cdn.example.com/hero-a.jpg')).rejects.toThrow('WEBSITE_PHOTO_CONFLICT');
  await expect(save('badKey','https://cdn.example.com/x.jpg','')).rejects.toThrow('INVALID_BRANCH_PHOTO_KEY');
  await expect(save('gallery2','javascript:alert(1)','')).rejects.toThrow('INVALID_BRANCH_PHOTO_URL');
  await expect(save('gallery2','https://cdn.example.com/x.jpg','','10000000-0000-4000-8000-000000000002')).rejects.toThrow('FORBIDDEN');
  const data=await db.query<{images:Record<string,string>}>('select images from public.branch_website_photos where branch_id=$1',[branch]);
  expect(data.rows[0].images).toEqual({heroImage:'https://cdn.example.com/hero-b.jpg',gallery1:'https://cdn.example.com/gallery.jpg'});
  await db.exec('set role anon');
  await expect(save('gallery2','https://cdn.example.com/anon.jpg','')).rejects.toThrow('permission denied');
 } finally {await db.close();}
});
