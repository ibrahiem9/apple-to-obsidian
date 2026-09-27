import {createHash} from 'node:crypto';
import {closeSync,openSync,readSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
export const labels={notes:'org.appletoobsidian.apple-notes','voice-memos':'org.appletoobsidian.voice-memos'};
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function program(config,configPath,source,extra=[]){return [config.voiceMemos.helperPath,'run','--node',config.nodePath,'--cli',join(config.appPath,'Contents/Resources/dist/src/cli.js'),'--config',configPath,source==='notes'?'apple-notes-sync':'voice-memos-sync',...extra];}
export function plist(config,configPath,source,logs,{label=labels[source],commandArgs=program(config,configPath,source,['--scheduled']),schedule=true}={}){
 const hour=source==='notes'?config.appleNotes.nightlyHour:config.voiceMemos.nightlyHour;
 return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${commandArgs.map(x=>`<string>${xml(x)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(config.appPath)}</string>
<key>RunAtLoad</key><true/>
${schedule?`<key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>0</integer></dict><key>ProcessType</key><string>Background</string><key>LowPriorityIO</key><true/>`:''}
<key>StandardOutPath</key><string>${xml(join(logs,label+'.out.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(logs,label+'.err.log'))}</string>
</dict></plist>\n`;
}
export function fingerprint(config,source){
 const hash=createHash('sha256').update(JSON.stringify(config));
 function file(path){hash.update(path);const descriptor=openSync(path,'r');try{const buffer=Buffer.alloc(1024*1024);let bytes;while((bytes=readSync(descriptor,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,bytes));}finally{closeSync(descriptor);}}
 function tree(path){for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const next=join(path,entry.name);if(entry.isDirectory())tree(next);else if(entry.isFile())file(next);}}
 file(config.voiceMemos.helperPath);file(join(config.appPath,'Contents/Info.plist'));
 tree(join(config.appPath,'Contents/Resources/dist'));tree(join(config.appPath,'Contents/Resources/scripts'));
 file(join(config.appPath,'Contents/Resources/package-lock.json'));
 if(source==='voice-memos'){file(config.voiceMemos.binaryPath);file(config.voiceMemos.modelPath);}
 return hash.digest('hex');
}
export function jobState(output){
 if(/state = running/.test(output))return 'running';
 const exit=output.match(/last exit code = (-?\d+)\b/);return exit?Number(exit[1]):'waiting';
}
export function requireAccess(receipt,expected){if(!receipt||receipt.success!==true||receipt.fingerprint!==expected)throw new Error('Run --check-access for this source after changing configuration or rebuilding the app.');}
export function requirePilot(receipt,expected,accepted){
 if(!accepted)throw new Error('Voice Memos enable requires --accept-single-language-limitations.');
 if(!receipt||receipt.fingerprint!==expected||receipt.reviewed!==true||receipt.success!==true||receipt.imported<1||receipt.failures!==0)throw new Error('Run --pilot, listen to its imported transcript, then --review-voice-pilot before enabling Voice Memos.');
}

export function disableJob(run,domain,label){
 try{run(['bootout',`${domain}/${label}`]);}catch{}
 run(['disable',`${domain}/${label}`]);
}
export function enableJob(run,domain,label,path){
 try{run(['bootout',`${domain}/${label}`]);}catch{}
 run(['enable',`${domain}/${label}`]);
 run(['bootstrap',domain,path]);
}
