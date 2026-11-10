import sys,json,hashlib,difflib,collections,argparse
from pathlib import Path
from pglast import parser
args_parser=argparse.ArgumentParser(description='Offline metadata comparison only; requires pglast==7.22')
args_parser.add_argument('--capture',action='append',required=True,type=Path,help='Private JSON array of version/name/statements/statement_hashes from read-only history capture')
args=args_parser.parse_args()
root=Path(__file__).resolve().parents[2]
audit=root/'docs/database/migration-history-audit-20261110'
matrix=json.loads((audit/'matrix.json').read_text(encoding='utf-8'))
remote={r['version']:r for n in args.capture for r in json.loads(n.read_text(encoding='utf-8'))}
sha=lambda b:hashlib.sha256(b).hexdigest()
def clean(x):
    if isinstance(x,dict):return {k:clean(v) for k,v in x.items() if k not in ('location','stmt_location','stmt_len','arg_location')}
    if isinstance(x,list):return [clean(v) for v in x]
    return x
def ast(sql):return clean(json.loads(parser.parse_sql_json(sql)))['stmts']
def envelope(sql):
    lines=sql.strip().splitlines()
    while lines and (not lines[0].strip() or lines[0].lstrip().startswith('--')):lines.pop(0)
    while lines and (not lines[-1].strip() or lines[-1].lstrip().startswith('--')):lines.pop()
    return '\n'.join(lines).strip()
def paths(a,b,path=''):
    if type(a)!=type(b):return [path]
    if isinstance(a,dict):
        return [p for k in sorted(a.keys()|b.keys()) for p in ([path+'/'+k] if k not in a or k not in b else paths(a[k],b[k],path+'/'+k))]
    if isinstance(a,list):
        out=[] if len(a)==len(b) else [path+'/length']
        return out+[p for i,(x,y) in enumerate(zip(a,b)) for p in paths(x,y,path+'/'+str(i))]
    return [] if a==b else [path]
receipts=[]
for r in remote.values():
    hashes=[sha(s.encode()) for s in r['statements']]
    assert hashes==r['statement_hashes'],r['version']
    receipts.append(dict(version=r['version'],name=r['name'],statement_hashes=hashes))
results=[]
for f in matrix['files']:
    if f['category']=='byte_exact':continue
    sql=(root/f['canonical_path']).read_bytes().decode()
    assert sha(sql.encode())==f['canonical_sha256']
    row=dict(canonical_path=f['canonical_path'],canonical_sha256=f['canonical_sha256'],original_category=f['category'],candidates=[])
    try:ca=ast(sql);row['canonical_statements']=len(ca);row['normalized_ast_sha256']=sha(json.dumps(ca,sort_keys=True,separators=(',',':')).encode())
    except Exception as e:ca=None;row['parse_error']=str(e)
    for m in f['matches']+f['unverified_candidates']:
        r=remote.get(m['version'])
        if r is None:row['candidates'].append(dict(version=m['version'],result='remote_record_absent'));continue
        source='\n'.join(r['statements'])
        c=dict(version=m['version'],statement_hashes=r['statement_hashes'])
        if 'production_statement_sha256' in m:assert m['production_statement_sha256'] in r['statement_hashes']
        c['outer_whitespace_equal']=sql.replace('\r\n','\n').strip()==source.replace('\r\n','\n').strip()
        c['outer_comment_envelope_equal']=envelope(sql)==envelope(source)
        try:
            ra=ast(source);c['remote_statements']=len(ra);c['normalized_ast_sha256']=sha(json.dumps(ra,sort_keys=True,separators=(',',':')).encode())
            c['full_ast_equal']=ca==ra
            windows=[] if ca is None else [i for i in range(len(ra)-len(ca)+1) if ra[i:i+len(ca)]==ca]
            c['matching_contiguous_ast_windows']=windows
            if ca is not None and not c['full_ast_equal']:
                diff=paths(ca,ra);c['ast_difference_count']=len(diff);c['first_ast_difference_paths']=diff[:12]
        except Exception as e:c['remote_parse_error']=str(e)
        if f['category']!='unresolved':
            assert c.get('full_ast_equal'),(f['canonical_path'],c)
            if f['category']=='outer_whitespace_only':assert c['outer_whitespace_equal']
            if f['category']=='outer_comments_only':assert c['outer_comment_envelope_equal']
            # Retain exact textual differences for these already-equivalent pairs only.
            diff=''.join(difflib.unified_diff(sql.splitlines(True),source.splitlines(True),fromfile='canonical/'+Path(f['canonical_path']).name,tofile='history/'+m['version']+'.sql'))
            c['diff_sha256']=sha(diff.encode())
            (audit/'equivalent-diffs').mkdir(exist_ok=True)
            (audit/'equivalent-diffs'/(Path(f['canonical_path']).stem+'.diff')).write_text(diff,encoding='utf-8',newline='\n')
        row['candidates'].append(c)
    if f['category']=='unresolved':
        proven=[c for c in row['candidates'] if c.get('matching_contiguous_ast_windows')]
        row['resolution']=('new_full_ast_match_review_required' if any(c.get('full_ast_equal') for c in proven) else 'contiguous_batch_ast_match_review_required') if proven else 'blocked_no_proven_history_match'
        row['flags']=f['flags']
        row['next_gate']=('Review batch boundaries and independent original statement hashes; do not acknowledge automatically.' if proven else
          'Review absent automatic-close helpers and desired scheduling behavior.' if 'referenced_private_functions_absent_in_live_catalog' in f['flags'] else
          'Review historical terminator correction and CI-only compatibility evidence; preserve canonical bytes.' if ca is None else
          'Review KDS client impact and separately approve permission correction.' if 'expected_authenticated_revoke_not_present_live' in f['flags'] else
          'Locate original history or later supersession evidence; inspect all reported AST differences, including literal function bodies.')
    else:row['resolution']='fresh_read_reverified_equivalent_not_approved'
    results.append(row)
output=dict(captured_on='2026-11-11',project_ref='hvqlkapynjfjikqithvd',parser='pglast 7.22',
  method='Remove only location/stmt_location/stmt_len/arg_location (source offsets); preserve constants, identifiers, order and literal bodies. Search contiguous statement windows in candidate batches.',
  production_writes=False,custom_ledger_rows=452,remote_history_rows=727,
  summary=dict(collections.Counter(r['resolution'] for r in results)),receipts=sorted(receipts,key=lambda r:r['version']),files=results)
(audit/'FOLLOWUP_EVIDENCE.json').write_text(json.dumps(output,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps(output['summary']))
print('\n'.join(r['canonical_path'] for r in results if r['resolution']=='contiguous_batch_ast_match_review_required'))
