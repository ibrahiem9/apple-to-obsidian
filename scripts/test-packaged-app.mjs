// Actual build, isolated paths, and the installed native parent. No Apple library access.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=dirname(dirname(fileURLToPath(import.meta.url)));
export async function checkApp(app,root){
 const resources=join(app,'Contents/Resources'),helper=join(app,'Contents/MacOS/voice-memos');
 for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md','licenses'])assert.ok(existsSync(join(resources,name)),`Missing notice: ${name}`);
 assert.equal(existsSync(join(resources,'node_modules/typescript')),false);
 assert.equal(existsSync(join(resources,'experiments')),false);
 execFileSync('/usr/bin/codesign',['--verify','--strict',app],{stdio:'pipe'});
 // Import configuration code from the bundle, not dist in the checkout.
 const {defaultConfig}=await import(pathToFileURL(join(resources,'dist/src/config.js')).href);
 const support=join(root,'smoke support'),vault=join(root,'smoke vault');
 mkdirSync(support,{recursive:true});mkdirSync(vault,{recursive:true});
 const config=defaultConfig(vault,support);config.appPath=app;config.voiceMemos.helperPath=helper;
 config.voiceMemos.libraryPath=join(root,'synthetic library');
 const configPath=join(support,'config.json');writeFileSync(configPath,JSON.stringify(config));
 for(const command of ['apple-notes-status','voice-memos-status']){
  const result=execFileSync(helper,['run','--node',process.execPath,'--cli',join(resources,'dist/src/cli.js'),'--config',configPath,command],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_PATH:''}});
  assert.equal(typeof JSON.parse(result),'object');
 }
 execFileSync(join(repo,'scripts/test-voice-memos-native'),[],{cwd:root,stdio:'inherit',env:{...process.env,APPLE_TO_OBSIDIAN_VOICE_HELPER:helper}});
 const lock=JSON.parse(readFileSync(join(resources,'package-lock.json'),'utf8'));
 for(const [path,metadata] of Object.entries(lock.packages))if(path&&!metadata.dev)assert.ok(existsSync(join(resources,path)),`Missing production dependency: ${path}`);
 console.log('Actual signed app passed bundled status commands, dependency/notices checks, and native catalogue/copy tests outside the checkout.');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root=mkdtempSync(join(tmpdir(),'apple-packaged نصب '));
 try{
  const app=join(root,'Applications','Apple to Obsidian.app');
  execFileSync(process.execPath,[join(repo,'scripts/build-app'),'--output',app],{cwd:root,stdio:'inherit'});
  await checkApp(app,root);
 }finally{rmSync(root,{recursive:true,force:true});}
}
