import {cpSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
// Shared by production packaging and the isolated packaged-runtime smoke test.
export function copyRuntime(repo,contents){
 const resources=join(contents,'Resources');
 mkdirSync(join(contents,'MacOS'),{recursive:true});
 mkdirSync(join(resources,'dist'),{recursive:true});
 mkdirSync(join(resources,'scripts'),{recursive:true});
 cpSync(join(repo,'native/.build/release/voice-memos'),join(contents,'MacOS/voice-memos'));
 cpSync(join(repo,'dist/src'),join(resources,'dist/src'),{recursive:true});
 cpSync(join(repo,'scripts/export-apple-notes.jxa'),join(resources,'scripts/export-apple-notes.jxa'));
 for(const name of ['package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md'])cpSync(join(repo,name),join(resources,name));
 cpSync(join(repo,'licenses'),join(resources,'licenses'),{recursive:true});
 return resources;
}
