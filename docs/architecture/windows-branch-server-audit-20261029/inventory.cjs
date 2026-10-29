const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, 'premier-com'));
const out = path.resolve(process.argv[3] || path.join(__dirname, 'audit-evidence'));
fs.mkdirSync(out, {recursive:true});
const norm = p => p.replaceAll('\\','/');
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=> e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]); }
const files = walk(path.join(root,'src')).filter(p=>/\.[cm]?[jt]sx?$/.test(p));
const rows=[];
const sources=new Map(files.map(f=>[norm(path.relative(root,f)),fs.readFileSync(f,'utf8')]));
function record(file,text,pattern,kind) { for(const m of text.matchAll(pattern)) rows.push({file,line:text.slice(0,m.index).split('\n').length,kind,name:m[1]}); }
for(const [file,text] of sources) {
 record(file,text,/\.from\(\s*['"]([^'"]+)['"]/g,'relation-literal');
 record(file,text,/\brpc(?:<[\s\S]*?>)?\(\s*['"]([^'"]+)['"]/g,'rpc-literal');
 if(text.includes('usePaginatedRows'))record(file,text,/\btable:\s*['"]([^'"]+)['"]/g,'relation-via-pagination');
 if(file.endsWith('supabaseWorkAuthorizationProvider.ts'))record(file,text.replace('function callRpc','function dispatchRpc'),/\bcallRpc(?:<[\s\S]*?>)?\(\s*['"]([^'"]+)['"]/g,'rpc-via-wrapper-feature-gated');
 record(file,text,/\.functions\.invoke\(\s*['"]([^'"]+)['"]/g,'edge-function');
 record(file,text,/\bfetch(?:WithTimeout)?\(\s*[`'"]([^`'"]+)[`'"]/g,'fetch-target');
 record(file,text,/\.storage\.from\(\s*['"]([^'"]+)['"]/g,'storage-bucket');
 record(file,text,/\.auth\.([a-zA-Z0-9_]+)\(/g,'auth-method');
 record(file,text,/\bapi\.([a-zA-Z0-9_.]+)\(/g,'api-call');
}
const routesText=sources.get('src/core/navigation/routes.ts');
const routes=Object.fromEntries([...routesText.matchAll(/\s+(\w+): '([^']+)'/g)].map(m=>[m[1],m[2]]));
const app=sources.get('src/app/routes.tsx');
const lazy=Object.fromEntries([...app.matchAll(/const (\w+) = lazy\(\(\) => import\('([^']+)'\)/g)].map(m=>[m[1],norm(path.posix.normalize(path.posix.join('src/app',m[2]))+'.tsx')]));
const routeRows=[];
for(const [i,line] of app.split('\n').entries()) {
 if(!line.includes('<Route '))continue;
 const key=line.match(/path=\{APP_ROUTES\.(\w+)\}/)?.[1];
 const permission=line.match(/permission="([^"]+)"/)?.[1]||line.match(/permissionsAny=\{(\[[^}]+\])/ )?.[1]||'';
 const component=Object.keys(lazy).find(k=>line.includes('<'+k));
 const target=line.match(/<Navigate to=\{APP_ROUTES\.(\w+)\}/)?.[1];
 const pathExpression=line.slice(line.indexOf('path=')+5,line.indexOf(' element='));
 const routePath=key?routes[key]:pathExpression.replace(/\$\{APP_ROUTES\.(\w+)\}/g,(_,k)=>routes[k]).replace(/^[{`"]+|[}`"]+$/g,'');
 routeRows.push({line:i+1,key:key||'',path:routePath,component:component||'',file:component?lazy[component]:'',permission,redirect:target?routes[target]:''});
}
const imports=new Map();
for(const [file,text] of sources) {
 const deps=[];
 for(const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) {
  const spec=m[1]; let base;
  if(spec.startsWith('@/'))base='src/'+spec.slice(2);
  else if(spec.startsWith('.'))base=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
  else continue;
  const found=[base,base+'.ts',base+'.tsx',base+'/index.ts',base+'/index.tsx'].find(p=>sources.has(p));
  if(found)deps.push(found);
 }
 imports.set(file,[...new Set(deps)]);
}
function closure(file,seen=new Set()) { if(!file||seen.has(file))return seen;seen.add(file);if(['src/api/index.ts','src/api/modules.ts'].includes(file))return seen;for(const dep of imports.get(file)||[])closure(dep,seen);return seen; }
for(const r of routeRows) {const deps=closure(r.file);r.modules=[...deps].sort();r.directRelations=[...new Set(rows.filter(x=>deps.has(x.file)&&x.kind==='relation-literal').map(x=>x.name))].sort();r.literalRpcs=[...new Set(rows.filter(x=>deps.has(x.file)&&x.kind==='rpc-literal').map(x=>x.name))].sort();}
const dynamic=[];
for(const [file,text] of sources)for(const m of text.matchAll(/\bsupabase(?:\.storage)?\s*\.(?:from|rpc)\(\s*([^'"\s][^\n)]*)/g))dynamic.push({file,line:text.slice(0,m.index).split('\n').length,expression:m[1].slice(0,160)});
const csv=(items,keys)=>[keys.join(','),...items.map(x=>keys.map(k=>'"'+String(x[k]??'').replaceAll('"','""')+'"').join(','))].join('\n')+'\n';
fs.writeFileSync(path.join(out,'direct-dependencies.csv'),csv(rows,['file','line','kind','name']));
fs.writeFileSync(path.join(out,'route-matrix.json'),JSON.stringify(routeRows,null,2)+'\n');
fs.writeFileSync(path.join(out,'dynamic-call-review.json'),JSON.stringify(dynamic,null,2)+'\n');
const sqlFiles=walk(path.join(root,'supabase/migrations')).filter(p=>p.endsWith('.sql')).sort();
const definitions=[];
for(const f of sqlFiles){const text=fs.readFileSync(f,'utf8');for(const m of text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([\w"]+)\s*\(/gi)){definitions.push({file:norm(path.relative(root,f)),line:text.slice(0,m.index).split('\n').length,name:m[1].replaceAll('"','')});}}
fs.writeFileSync(path.join(out,'rpc-definition-index.csv'),csv(definitions,['name','file','line']));
const counts={sourceFiles:files.length,routeEntries:routeRows.length,routeConstants:Object.keys(routes).length,lazyComponents:Object.keys(lazy).length,dependencyReferences:rows.length,uniqueRelationLiterals:new Set(rows.filter(r=>r.kind==='relation-literal').map(r=>r.name)).size,uniqueRelationsIncludingPagination:new Set(rows.filter(r=>r.kind.startsWith('relation-')).map(r=>r.name)).size,uniqueRpcLiterals:new Set(rows.filter(r=>r.kind==='rpc-literal').map(r=>r.name)).size,uniqueFeatureGatedRpcNames:new Set(rows.filter(r=>r.kind==='rpc-via-wrapper-feature-gated').map(r=>r.name)).size,dynamicCandidates:dynamic.length,migrationFiles:sqlFiles.length,functionDefinitions:definitions.length};
fs.writeFileSync(path.join(out,'inventory-summary.json'),JSON.stringify(counts,null,2)+'\n');
const md=['# WBS-00 route inventory — 2026-10-29','', 'Baseline: `ab0900b342a4ddc16dd41052d18142d052b23106`. This is a lexical source inventory, not proof of deployed schema or runtime behavior. The main audit explains the domain mapping and WAN classification. The route table lists calls written directly in the page file; shared hooks, services, API wrappers, auth and other providers are indexed separately below. Blank cells do not mean offline support. Imports through API barrels are deliberately not expanded into every unrelated API domain. Generated route-matrix.json includes module closures as upper bounds; a listed dependency may be conditional or unused on a particular user action. Computed calls and SQL-trigger effects require manual review.','', '| Route / expression | Screen / redirect | Guard | Page-local relation literals | Page-local RPC literals |','|---|---|---|---|---|'];
for(const r of routeRows){const direct=rows.filter(x=>x.file===r.file);md.push('| '+[r.path,r.component?`[${r.component}](../../${r.file})`:r.redirect?'→ '+r.redirect:'router/redirect',r.permission||'see route guard',[...new Set(direct.filter(x=>x.kind==='relation-literal').map(x=>x.name))].join(', ')||'—',[...new Set(direct.filter(x=>x.kind==='rpc-literal').map(x=>x.name))].join(', ')||'—'].map(s=>s.replaceAll('|','\\|')).join(' | ')+' |');}
md.push('','## Direct call inventory');
for(const file of [...new Set(rows.map(x=>x.file))]){md.push('',`### [${file}](../../${file})`,'','| Line | Kind | Name |','|---|---|---|');for(const r of rows.filter(x=>x.file===file))md.push(`| ${r.line} | ${r.kind} | ${r.name.replaceAll('|','\\|')} |`);}
md.push('','## Computed-call review candidates','', '| Source | Expression |','|---|---|');
for(const r of dynamic)md.push(`| ${r.file}:${r.line} | ${r.expression.replaceAll('|','\\|')} |`);
fs.writeFileSync(path.join(out,'WINDOWS_BRANCH_SERVER_DEPENDENCY_MATRIX_2026-10-29.md'),md.join('\n')+'\n');
console.log(JSON.stringify(counts));
