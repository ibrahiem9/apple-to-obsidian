// Explicit online verification. The only setup targets are disposable directories.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {checkApp} from './test-packaged-app.mjs';
import {labels} from './launchd-lib.mjs';
const repo=dirname(dirname(fileURLToPath(import.meta.url)));
const root=mkdtempSync(join(tmpdir(),'apple-clean نصب '));
const hash=async path=>{const h=createHash('sha256');for await(const block of createReadStream(path))h.update(block);return h.digest('hex');};
try{
 const vault=join(root,'Vault & notes'),support=join(root,'Application Support'),app=join(root,'Applications','Apple to Obsidian.app');
 mkdirSync(vault,{recursive:true});
 const runSetup=()=>execFileSync(process.execPath,[join(repo,'scripts/setup'),'--vault',vault,'--support-path',support,'--app-path',app],{cwd:root,stdio:'inherit'});
 runSetup();
 const configPath=join(support,'config.json'),config=JSON.parse(readFileSync(configPath,'utf8'));
 assert.equal(config.vaultPath,vault);assert.equal(config.appPath,app);
 const manifest=JSON.parse(readFileSync(join(support,'whisper/manifest.json'),'utf8'));
 assert.equal(manifest.commit,'2eeeba56e9edd762b4b38467bab96c2517163158');
 assert.equal(manifest.modelRevision,'5359861c739e955e79d9a303bcbc70fb988958b1');
 assert.equal(await hash(config.voiceMemos.modelPath),'64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2');
 assert.equal(await hash(config.voiceMemos.binaryPath),manifest.binarySha256);
 execFileSync(config.voiceMemos.binaryPath,['--help'],{cwd:root,stdio:'pipe'});
 // Create actual SQLite state through installed services using invented empty exports.
 config.voiceMemos.libraryPath=join(root,'synthetic unused library');
 config.appleNotes.nightlyHour=4;config.voiceMemos.language='ur';
 writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
 const bundled=relative=>import(pathToFileURL(join(app,'Contents/Resources/dist/src',relative)).href);
 const {syncAppleNotes}=await bundled('services/apple-notes.js');
 await syncAppleNotes(config,{}, {exportNotes:async path=>writeFileSync(path,JSON.stringify({expectedCount:0,notes:[],errors:[]}))});
 const {syncVoiceMemos}=await bundled('services/voice-memos.js');
 await syncVoiceMemos(config,{}, {library:{inventory:async()=>[],copy:async()=>{throw new Error('Unexpected synthetic copy');}},engine:{transcribe:async()=>{throw new Error('Unexpected synthetic transcription');}}});
 for(const command of ['apple-notes-status','voice-memos-status'])execFileSync(config.voiceMemos.helperPath,['run','--node',process.execPath,'--cli',join(app,'Contents/Resources/dist/src/cli.js'),'--config',configPath,command],{cwd:root,stdio:'pipe'});
 const retained=join(vault,'Retained synthetic note.md');writeFileSync(retained,'Synthetic retained content.\n');
 const paths=[configPath,config.statePath,config.voiceMemos.statePath,retained];
 const before=paths.map(path=>readFileSync(path));
 runSetup();
 paths.forEach((path,i)=>assert.deepEqual(readFileSync(path),before[i],`Repeated setup changed retained state at index ${i}`));
 for(const source of ['notes','voice-memos']){
  const plistPath=join(support,'launchd-staged',labels[source]+'.plist');
  assert.ok(existsSync(plistPath));
  const plist=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',plistPath],{encoding:'utf8'}));
  assert.equal(plist.ProgramArguments[0],config.voiceMemos.helperPath);
  assert.ok(!plist.ProgramArguments.some(value=>value.includes(repo)));
 }
 await checkApp(app,root);
 console.log('Clean setup passed twice: pinned downloads/checksums, real Whisper executable, retained config/SQLite/content, Unicode paths, and installed app. No schedules enabled.');
}finally{rmSync(root,{recursive:true,force:true});}
