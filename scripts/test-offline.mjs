#!/usr/bin/env node
// Synthetic data only: prove that the production child sandbox blocks network access.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import { VoiceWhisperTranscriber } from '../dist/src/backends/voice-whisper.js';
if (process.platform !== 'darwin') throw new Error('Offline sandbox verification requires macOS.');
const root = mkdtempSync(join(tmpdir(), 'offline-voice-'));
const server = createServer(socket => socket.end());
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => { const socket = connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(); }); socket.once('error', reject); });
  const binary = join(root, 'engine.cjs'), converter = join(root, 'converter.cjs'), model = join(root, 'model.bin'), calls = join(root, 'calls.txt');
  writeFileSync(model, 'synthetic model');
  writeFileSync(converter, `#!${process.execPath}\nrequire('node:fs').copyFileSync(process.argv.at(-2), process.argv.at(-1));\n`);
  writeFileSync(binary, `#!${process.execPath}
const fs=require('node:fs'),net=require('node:net'),args=process.argv.slice(2),output=args[args.indexOf('-of')+1];
const socket=net.connect(${port},'127.0.0.1');
socket.once('connect',()=>process.exit(40));
socket.once('error',()=>{fs.appendFileSync(${JSON.stringify(calls)},'blocked\\n');fs.writeFileSync(output+'.json',JSON.stringify({result:{language:'en'},params:{translate:false},model:{multilingual:true},transcription:[{text:'Synthetic offline fixture.',offsets:{from:0,to:1000}}]}));});
setTimeout(()=>process.exit(41),3000).unref();
`);
  chmodSync(binary, 0o700); chmodSync(converter, 0o700);
  const pcm = Buffer.alloc(32000); for (let i=0;i<16000;i++) pcm.writeInt16LE(1000, i*2);
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36+pcm.length,4); header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22); header.writeUInt32LE(16000,24);
  header.writeUInt32LE(32000,28); header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(pcm.length,40);
  const audio = join(root,'source.wav'); writeFileSync(audio, Buffer.concat([header,pcm]));
  const engine = new VoiceWhisperTranscriber({binaryPath:binary,modelPath:model,converterPath:converter,segmentSeconds:30,networkIsolation:true});
  const result = await engine.transcribe(audio, join(root,'work'));
  assert.equal(result.text, 'Synthetic offline fixture.'); assert.equal(result.incomplete,false);
  assert.equal(readFileSync(calls,'utf8'), 'blocked\nblocked\n');
  console.log('Offline check passed: local detector and transcriber both denied a reachable network endpoint.');
} finally { server.close(); rmSync(root,{recursive:true,force:true}); }
