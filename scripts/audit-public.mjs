import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,lstatSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scanner} from './gitleaks.mjs';
import {findings} from './public-policy.mjs';
process.umask(0o077);
const repo=dirname(dirname(fileURLToPath(import.meta.url)));
const git=(...args)=>execFileSync('git',args,{cwd:repo,maxBuffer:64*1024*1024});
const root=mkdtempSync(join(tmpdir(),'apple-public-audit-'));
let problems=0;
function check(path,bytes){for(const kind of findings(path,bytes)){console.error(`Privacy finding: ${kind} (matched value withheld)`);problems++;}}
try{
 if(git('rev-parse','--is-shallow-repository').toString().trim()==='true')throw new Error('Fetch complete history before auditing.');
 const commits=git('rev-list','--all').toString().trim().split('\n').filter(Boolean);
 const noreply=email=>/^(?:[\w+.-]+@users\.noreply\.github\.com|noreply@github\.com)$/.test(email);
 const blobs=new Map();
 const snapshot=join(root,'snapshot');mkdirSync(snapshot);
 for(const commit of commits){
  const identities=git('show','-s','--format=%an%n%ae%n%cn%n%ce',commit).toString().trim().split('\n');
  for(let i=0;i<4;i+=2)if(!noreply(identities[i+1]))throw new Error('Non-noreply commit attribution; review before sharing.');
  const metadata=git('show','-s','--format=fuller',commit);
  check('commit-metadata',metadata);writeFileSync(join(snapshot,'commit-'+commit),metadata);
  for(const entry of git('ls-tree','-rz',commit).toString().split('\0').filter(Boolean)){
   const [header,path]=entry.split('\t');const [mode,type,oid]=header.split(' ');
   if(type!=='blob'||mode==='120000')throw new Error('Review submodules/symlinks before public sharing.');
   blobs.set(oid+' '+path,{oid,path});
  }
 }
 // Audit the index as well: staged bytes may differ from the working copy.
 for(const entry of git('ls-files','--stage','-z').toString().split('\0').filter(Boolean)){
  const [header,path]=entry.split('\t');const [mode,oid,stage]=header.split(' ');
  if(!['100644','100755'].includes(mode)||stage!=='0')throw new Error('Review index links/submodules or unresolved merges.');
  blobs.set(oid+' '+path,{oid,path});
 }
 // Scan every retained blob (also catches secrets removed before the next commit).
 let index=0;
 for(const {oid,path} of blobs.values()){
  const bytes=git('cat-file','blob',oid);check(path,bytes);
  writeFileSync(join(snapshot,String(index++)),bytes);
 }
 // Include annotated tags and ref names in the personal-path and secret scan.
 const refs=git('for-each-ref','--format=%(refname)%0a%(contents)');
 check('refs',refs);writeFileSync(join(snapshot,'refs'),refs);
 for(const email of git('for-each-ref','refs/tags','--format=%(taggeremail:trim)').toString().trim().split('\n').filter(Boolean))if(!noreply(email))throw new Error('Non-noreply tag attribution; review before sharing.');
 const files=git('ls-files','-z','--cached','--others','--exclude-standard').toString().split('\0').filter(Boolean);
 for(const path of new Set(files)){
  if(!lstatSync(join(repo,path)).isFile())throw new Error('Working files must be regular files; review links before sharing.');
  const bytes=readFileSync(join(repo,path));check(path,bytes);
  writeFileSync(join(snapshot,String(index++)),bytes);
 }
 const binary=scanner(join(repo,'.build','public-audit-tool'));
 for(const [label,args] of [['history',['git',repo,'--log-opts=--all --full-history']],['snapshot',['dir',snapshot]]]){
  const report=join(root,label+'.json');
  const result=spawnSync(binary,[...args,'--redact=100','--no-banner','--report-format=json','--report-path',report],{encoding:'utf8'});
  if(result.status!==0){
   if(result.status!==1)throw new Error(`Gitleaks ${label} could not complete (details withheld).`);
   const count=JSON.parse(readFileSync(report,'utf8')).length;
   console.error(`Gitleaks ${label}: ${count} finding(s); values withheld.`);problems+=count;
  }
 }
 if(problems)throw new Error(`${problems} unresolved public-audit findings.`);
 console.log(`Public audit passed: ${commits.length} commits, ${blobs.size} historical file versions, ${new Set(files).size} working files; Gitleaks 8.30.1 (checksum verified).`);
}catch(error){console.error(error.message);process.exitCode=1;}
finally{rmSync(root,{recursive:true,force:true});}
