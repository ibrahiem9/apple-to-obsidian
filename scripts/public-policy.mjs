// Deliberately conservative: reports categories, never matched private values.
export function findings(path, bytes) {
 const result=[];
 if (/(^|\/)(node_modules|dist|\.build|\.local|\.obsidian|apple-notes-runs|logs|reports|recordings|transcripts|diagnostics)(\/|$)/i.test(path) ||
     /(^|\/)(config(?:\.local)?\.json|\.env(?:\..*)?|\.DS_Store)$/.test(path) ||
     /\.(sqlite[^/]*|db|log|m4a|wav|mp3|aiff|flac|bin|gguf|plist|zip|tar|gz|pem|p12|key|png|jpe?g|heic|pdf|docx|mp4|mov)$/i.test(path) || /\.(app|mlmodelc)(\/|$)/.test(path)) result.push('personal/generated filename');
 if(bytes.length>2*1024*1024)result.push('oversized file');
 if(bytes.includes(0))result.push('binary file');
 let content=bytes.toString('utf8');
 // This exact synthetic sentinel tests error redaction; no directory-wide exemption.
 if(path==='test/apple-notes.test.ts')content=content.replaceAll('/Users/'+'private/vault','SYNTHETIC_PATH');
 if(/\/(?:Users|home)\/[\w.-]+/.test(content))result.push('absolute home path');
 return result;
}
