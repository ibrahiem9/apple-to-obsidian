// Synthetic installer verification: never bootstraps or changes real jobs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultConfig,loadConfig} from '../dist/src/config.js';
import {copyRuntime} from './app-lib.mjs';
import {labels,program,plist,fingerprint,jobState,requireAccess,requirePilot,disableJob,enableJob} from './launchd-lib.mjs';
const repo=dirname(dirname(fileURLToPath(import.meta.url)));
const root=mkdtempSync(join(tmpdir(),'apple-to-obsidian نصب '));
try{
 const vault=join(root,'Vault & notes'),support=join(root,'Application Support'),app=join(root,'Applications','Apple to Obsidian.app');
 mkdirSync(vault,{recursive:true});mkdirSync(support,{recursive:true});
 const config=defaultConfig(vault,support);config.appPath=app;config.voiceMemos.helperPath=join(app,'Contents/MacOS/voice-memos');
 config.voiceMemos.libraryPath=join(root,'Synthetic library');
 for(const [path,text] of [[config.voiceMemos.helperPath,'fixture-native'],[join(app,'Contents/Info.plist'),'fixture-info'],[join(app,'Contents/Resources/dist/src/cli.js'),'fixture-cli'],[join(app,'Contents/Resources/scripts/export-apple-notes.jxa'),'fixture-exporter'],[join(app,'Contents/Resources/package-lock.json'),'{}'],[config.voiceMemos.binaryPath,'fixture-whisper'],[config.voiceMemos.modelPath,'fixture-model']]){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
 const configPath=join(support,'config.json');writeFileSync(configPath,JSON.stringify(config));
 const loaded=loadConfig(configPath);assert.deepEqual(loaded,config);
 const log=join(support,'logs');
 for(const source of ['notes','voice-memos']){
  const path=join(root,source+'.plist');writeFileSync(path,plist(config,configPath,source,log));
  execFileSync('/usr/bin/plutil',['-lint',path],{stdio:'pipe'});
  const parsed=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path],{encoding:'utf8'}));
  assert.equal(parsed.StartCalendarInterval.Hour,source==='notes'?2:3);assert.equal(parsed.RunAtLoad,true);
  assert.equal(parsed.ProgramArguments[0],config.voiceMemos.helperPath);assert.equal(parsed.ProgramArguments.at(-1),'--scheduled');
  assert.equal(parsed.ProgramArguments[7],configPath);
  assert.ok(!parsed.ProgramArguments.some(value=>value.includes(repo)),'scheduled jobs must not reference checkout');
  assert.equal(parsed.WorkingDirectory,app);
 }
 const baseline=readFileSync(configPath);
 // The default operation only stages files in isolated support, never launchctl.
 execFileSync(process.execPath,[join(repo,'scripts/install-launchd'),'--config',configPath],{stdio:'pipe'});
 assert.ok(existsSync(join(support,'launchd-staged',labels.notes+'.plist')));
 assert.deepEqual(readFileSync(configPath),baseline);
 const marker=join(support,'history.sqlite');writeFileSync(marker,'durable import history');
 const actions=[];const mockRun=argv=>{actions.push(argv);return '';};
 disableJob(mockRun,'gui/fixture',labels.notes);
 assert.deepEqual(actions.map(x=>x[0]),['bootout','disable']);assert.equal(readFileSync(marker,'utf8'),'durable import history');
 actions.length=0;enableJob(mockRun,'gui/fixture',labels.notes,'/fixture/staged.plist');
 assert.deepEqual(actions.map(x=>x[0]),['bootout','enable','bootstrap']);
 assert.equal(jobState('state = running\nlast exit code = 0'),'running');
 assert.equal(jobState('state = not running\nlast exit code = 0'),0);assert.equal(jobState('last exit code = 75'),75);assert.equal(jobState('state = waiting'),'waiting');
 const before=fingerprint(config,'voice-memos');
 requireAccess({success:true,fingerprint:before},before);
 assert.throws(()=>requireAccess({success:true,fingerprint:'stale'},before));
 assert.throws(()=>requireAccess(undefined,before));
 const review={success:true,reviewed:true,imported:1,failures:0,fingerprint:before};
 requirePilot(review,before,true);
 for(const bad of [{...review,reviewed:false},{...review,imported:0},{...review,failures:1},{...review,fingerprint:'stale'}])assert.throws(()=>requirePilot(bad,before,true));
 assert.throws(()=>requirePilot(review,before,false));
 writeFileSync(config.voiceMemos.modelPath,'new model');assert.notEqual(fingerprint(config,'voice-memos'),before);
 const codeBefore=fingerprint(config,'notes');writeFileSync(join(app,'Contents/Resources/dist/src/cli.js'),'changed-cli');assert.notEqual(fingerprint(config,'notes'),codeBefore);
 // An empty config must not silently choose a vault or publish data.
 writeFileSync(join(root,'empty.json'),'{}');assert.throws(()=>loadConfig(join(root,'empty.json')),/vaultPath/);
 // Exercise the actual native parent + bundled JavaScript at an independent path.
 const packaged=join(root,'Independent packaged app.app');
 const resources=copyRuntime(repo,join(packaged,'Contents'));
 mkdirSync(join(resources,'node_modules'),{recursive:true});
 cpSync(join(repo,'node_modules/yaml'),join(resources,'node_modules/yaml'),{recursive:true});
 const installedConfig={...config,appPath:packaged,voiceMemos:{...config.voiceMemos,helperPath:join(packaged,'Contents/MacOS/voice-memos')}};
 const installedConfigPath=join(support,'packaged-config.json');writeFileSync(installedConfigPath,JSON.stringify(installedConfig));
 for(const command of ['apple-notes-status','voice-memos-status']){
  const stdout=execFileSync(installedConfig.voiceMemos.helperPath,['run','--node',process.execPath,'--cli',join(resources,'dist/src/cli.js'),'--config',installedConfigPath,command],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  assert.ok(JSON.parse(stdout));
 }
 assert.equal(existsSync(join(resources,'node_modules/typescript')),false);
 const source=readFileSync(join(repo,'scripts/setup'),'utf8');assert.ok(source.includes('--support-path')&&source.includes('--app-path'));
 console.log('Installer checks passed: isolated staging, paths with spaces/Unicode, both schedules, disable retention, receipts, code/model invalidation, simulated launchctl, and native packaged-runtime smoke.');
}finally{rmSync(root,{recursive:true,force:true});}
