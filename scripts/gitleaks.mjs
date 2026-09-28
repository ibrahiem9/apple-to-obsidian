import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
export const version='8.30.1';
const checksum='b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5';
export function scanner(directory){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('Public audit requires macOS arm64.');
 mkdirSync(directory,{recursive:true});
 const archive=join(directory,'gitleaks.tar.gz');
 if(!existsSync(archive))execFileSync('/usr/bin/curl',['--fail','--location','--silent','--show-error','--retry','3',`https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_darwin_arm64.tar.gz`,'--output',archive],{stdio:'pipe'});
 if(createHash('sha256').update(readFileSync(archive)).digest('hex')!==checksum)throw new Error('Gitleaks archive checksum mismatch.');
 execFileSync('/usr/bin/tar',['-xzf',archive,'-C',directory],{stdio:'pipe'});
 const binary=join(directory,'gitleaks');
 if(execFileSync(binary,['version'],{encoding:'utf8'}).trim()!==version)throw new Error('Unexpected Gitleaks version.');
 return binary;
}
