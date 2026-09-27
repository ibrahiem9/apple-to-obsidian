import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VoiceWhisperTranscriber, VoiceLanguageError, type VoiceWhisperConfig } from "../src/backends/voice-whisper.js";

function fixture(t: { after(fn: () => void): void }, engineBody?: string) {
  const root = mkdtempSync(join(tmpdir(), "voice-whisper-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binaryPath = join(root, "engine.cjs");
  const converterPath = join(root, "converter.cjs");
  const modelPath = join(root, "model.bin");
  const calls = join(root, "calls.jsonl");
  writeFileSync(modelPath, "local test model");
  writeFileSync(converterPath, `#!${process.execPath}\nrequire('node:fs').copyFileSync(process.argv.at(-2), process.argv.at(-1));\n`);
  writeFileSync(binaryPath, `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); const output=args[args.indexOf('-of')+1]; const index=Number(output.match(/segment-(\\d+)$/)[1]); fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');\n${engineBody ?? `fs.writeFileSync(output+'.json',JSON.stringify({result:{language:'en'},params:{translate:false},model:{multilingual:true},transcription:[{text:' Hello.',offsets:{from:0,to:1000}}]}));`}`);
  chmodSync(binaryPath, 0o700); chmodSync(converterPath, 0o700);
  const config: VoiceWhisperConfig = { segmentation: "single-language", language: "en", binaryPath, converterPath, modelPath, segmentSeconds: 1, networkIsolation: false };
  return { root, config, calls, transcriber: new VoiceWhisperTranscriber(config) };
}

function audio(root: string, amplitudes: number[], trailingBytes = 0, channels = 1): string {
  const size = amplitudes.length * 32000 * channels;
  const buffer = Buffer.alloc(44 + size);
  buffer.write("RIFF"); buffer.writeUInt32LE(size + 36, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000 * channels, 28); buffer.writeUInt16LE(2 * channels, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(size, 40);
  for (let second = 0; second < amplitudes.length; second++) for (let frame = 0; frame < 16000; frame++) buffer.writeInt16LE(amplitudes[second]!, 44 + (second * 16000 + frame) * 2 * channels + (channels - 1) * 2);
  const path = join(root, "source.wav");
  writeFileSync(path, buffer.subarray(0, buffer.length - trailingBytes));
  return path;
}

test("Whisper retains one language and original timing with local transcription", async (t) => {
  const f = fixture(t);
  const path = audio(f.root, [100, 100, 100]);
  const original = readFileSync(path);
  const work = join(f.root, "work");
  const result = await f.transcriber.transcribe(path, work);
  assert.equal(result.text, " Hello.\n Hello.\n Hello.");
  assert.deepEqual(result.segments.map(({ start, end, language }) => [start, end, language]), [[0, 1, "en"], [1, 2, "en"], [2, 3, "en"]]);
  assert.equal(result.status, "needs-review");
  assert.match(result.warnings.join(" "), /boundaries/);
  const calls = readFileSync(f.calls, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  assert.equal(calls.length, 3);
  for (const args of calls) {
    assert.equal(args[args.indexOf("-l") + 1], "en");
    assert.equal(args[args.indexOf("-m") + 1], f.config.modelPath);
    assert(!args.includes("-tr") && !args.includes("--translate") && !args.includes("-dl"));
    assert(!args.some((arg) => /^https?:/.test(arg)));
  }
  assert.deepEqual(readFileSync(path), original);
  assert.deepEqual(readdirSync(work), []);
});

test("digital silence skips inference; empty non-silent output requires review", async (t) => {
  const f = fixture(t, "fs.writeFileSync(output+'.json',JSON.stringify({result:{language:'en'},transcription:[]}));");
  const silence = await f.transcriber.transcribe(audio(f.root, [0]), join(f.root, "work"));
  assert.equal(silence.status, "no-speech");
  assert.equal(existsSync(f.calls), false);
  const empty = await f.transcriber.transcribe(audio(f.root, [2]), join(f.root, "work"));
  assert.equal(empty.status, "needs-review");
  assert.match(empty.warnings.join(" "), /empty output/);
});

test("a failed middle segment retains later results with an incomplete flag", async (t) => {
  const f = fixture(t, `if(index===1) { console.error('PRIVATE TRANSCRIPT'); process.exit(12); } fs.writeFileSync(output+'.json',JSON.stringify({result:{language:'en'},transcription:[{text:'Kept',offsets:{from:0,to:1000}}]}));`);
  const result = await f.transcriber.transcribe(audio(f.root, [100, 100, 100]), join(f.root, "work"));
  assert.deepEqual(result.segments.map((entry) => entry.start), [0, 2]);
  assert.match(result.warnings.join(" "), /segment 2.*incomplete/);
  assert.equal(result.incomplete, true);
  assert(!JSON.stringify(result).includes("PRIVATE"));
});

test("total failure and timeout are sanitized, and temporary audio is cleaned", async (t) => {
  const f = fixture(t, "console.error('PRIVATE TRANSCRIPT'); process.exit(17);");
  const path = audio(f.root, [100]);
  const work = join(f.root, "work");
  await assert.rejects(f.transcriber.transcribe(path, work), (error: unknown) => error instanceof Error && /failed for all/.test(error.message) && !error.message.includes("PRIVATE"));
  assert.deepEqual(readdirSync(work), []);
  writeFileSync(f.config.binaryPath, `#!${process.execPath}\nsetTimeout(()=>{},60000);`);
  const slow = new VoiceWhisperTranscriber({ ...f.config, timeoutMs: 100 });
  await assert.rejects(slow.transcribe(path, work), /failed for all/);
  assert.deepEqual(readdirSync(work), []);
});

test("invalid and translated engine results cannot be published as successful", async (t) => {
  const f = fixture(t, "fs.writeFileSync(output+'.json',JSON.stringify({params:{translate:true},transcription:[]}));");
  await assert.rejects(f.transcriber.transcribe(audio(f.root, [100]), join(f.root, "work")), /failed for all/);
  writeFileSync(f.config.binaryPath, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.argv[process.argv.indexOf('-of')+1]+'.json','{PRIVATE INVALID JSON');`);
  await assert.rejects(f.transcriber.transcribe(audio(f.root, [100]), join(f.root, "work")), /failed for all/);
});

test("repetition, truncated WAV files, and missing local assets are detected", async (t) => {
  const f = fixture(t, "fs.writeFileSync(output+'.json',JSON.stringify({result:{language:'en'},transcription:[{text:'loop loop loop loop',offsets:{from:0,to:1000}}]}));");
  const result = await f.transcriber.transcribe(audio(f.root, [100]), join(f.root, "work"));
  assert.match(result.warnings.join(" "), /Repeated text/);
  await assert.rejects(f.transcriber.transcribe(audio(f.root, [100], 10), join(f.root, "work")), /truncated/);
  rmSync(f.config.modelPath);
  assert.throws(() => f.transcriber.check(), /Missing or inaccessible local Whisper model/);
  assert.throws(() => new VoiceWhisperTranscriber({ ...f.config, segmentSeconds: 1e9 }).check(), /between 1 and 300/);
});

test("the real macOS converter produces PCM accepted by the bounded reader", { skip: process.platform !== "darwin" }, async (t) => {
  const f = fixture(t);
  const backend = new VoiceWhisperTranscriber({ ...f.config, converterPath: "/usr/bin/afconvert" });
  const result = await backend.transcribe(audio(f.root, [100]), join(f.root, "work"));
  assert.equal(result.text, " Hello.");
});

test("downmixing retains speech from the second channel and correct chunk offsets", async (t) => {
  const f = fixture(t, `const pcm=fs.readFileSync(args[args.indexOf('-f')+1]); if(pcm.readUInt16LE(22)!==1 || pcm.readInt16LE(44)!==50 || pcm.length!==32044) process.exit(21); fs.writeFileSync(output+'.json',JSON.stringify({result:{language:'en'},transcription:[{text:'Second channel',offsets:{from:0,to:1000}}]}));`);
  const result = await f.transcriber.transcribe(audio(f.root, [100, 100], 0, 2), join(f.root, "work"));
  assert.deepEqual(result.segments.map((s) => [s.start, s.end]), [[0, 1], [1, 2]]);
});

test("Voice Memos extensible PCM is accepted while float subtypes and invalid extensions are rejected", async (t) => {
  const f = fixture(t);
  const path = audio(f.root, [100]);
  const original = readFileSync(path);
  const extensible = Buffer.concat([original.subarray(0, 36), Buffer.alloc(24), original.subarray(36)]);
  extensible.writeUInt32LE(extensible.length - 8, 4);
  extensible.writeUInt32LE(40, 16); extensible.writeUInt16LE(0xfffe, 20);
  extensible.writeUInt16LE(22, 36); extensible.writeUInt16LE(16, 38);
  Buffer.from("0100000000001000800000aa00389b71", "hex").copy(extensible, 44);
  writeFileSync(path, extensible);
  const result = await f.transcriber.transcribe(path, join(f.root, "work"));
  assert.equal(result.text, " Hello.");
  assert.deepEqual(readFileSync(path), extensible);
  for (const [offset, value] of [[44, 3], [36, 23], [38, 24]] as const) {
    const invalid = Buffer.from(extensible); invalid.writeUInt16LE(value, offset); writeFileSync(path, invalid);
    await assert.rejects(f.transcriber.transcribe(path, join(f.root, "work")), /16 kHz, 16-bit PCM/);
  }
});

test("opposite-phase channels retain original speech and require review instead of declaring silence", async (t) => {
  const f = fixture(t, `const pcm=fs.readFileSync(args[args.indexOf('-f')+1]); if(pcm.readInt16LE(44)!==100) process.exit(21); fs.writeFileSync(output+'.json',JSON.stringify({result:{language:'en'},transcription:[{text:'Retained speech',offsets:{from:0,to:1000}}]}));`);
  const path = audio(f.root, [100], 0, 2);
  const source = readFileSync(path);
  for (let frame = 0; frame < 16000; frame++) {
    source.writeInt16LE(100, 44 + frame * 4);
    source.writeInt16LE(-100, 46 + frame * 4);
  }
  writeFileSync(path, source);
  const result = await f.transcriber.transcribe(path, join(f.root, "work"));
  assert.equal(result.text, "Retained speech");
  assert.equal(result.status, "needs-review");
  assert.match(result.warnings.join(" "), /mixing canceled/);
  assert.deepEqual(readFileSync(path), source);
});

function singleLanguageFixture(t: { after(fn: () => void): void }, detected: string) {
  const f = fixture(t);
  // Omit segmentation intentionally: exercise the production default.
  delete f.config.segmentation;
  delete f.config.language;
  writeFileSync(f.config.binaryPath, `#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2),output=args[args.indexOf('-of')+1];
fs.appendFileSync(${JSON.stringify(f.calls)},JSON.stringify(args)+'\\n');
const language=args.includes('-dl')?${JSON.stringify(detected)}:args[args.indexOf('-l')+1];
fs.writeFileSync(output+'.json',JSON.stringify({result:{language},params:{translate:false},model:{multilingual:true},transcription:[{text:args.includes('-dl')?'PRIVATE_DETECTION_TEXT':({en:'English words.',ar:'كلمات عربية.',ur:'اردو الفاظ.'}[language]),offsets:{from:0,to:1000}}]}));
`);
  return f;
}

test("single-language default detects once after silence and locks English, Arabic, or Urdu across the memo", async t => {
  for (const language of ["en", "ar", "ur"]) {
    const f = singleLanguageFixture(t, language);
    const source = audio(f.root, [0, 100, 100, 100]);
    const original = readFileSync(source);
    const result = await f.transcriber.transcribe(source, join(f.root, "work"));
    assert.equal(result.incomplete, false);
    assert.deepEqual(result.segments.map(s => s.language), [language, language, language]);
    assert.deepEqual(result.processingSegments?.map(({ start, end }) => [start, end]), [[1, 2], [2, 3], [3, 4]]);
    assert.match(result.warnings.join(" "), /Mixed-language recordings are unsupported/);
    assert.ok(!result.text.includes("PRIVATE_DETECTION_TEXT"));
    const calls: string[][] = readFileSync(f.calls, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(calls.filter(args => args.includes("-dl")).length, 1);
    assert.deepEqual(calls.filter(args => !args.includes("-dl")).map(args => args[args.indexOf("-l") + 1]), [language, language, language]);
    assert.ok(calls.every(args => !args.includes("-tr") && !args.includes("--translate")));
    assert.deepEqual(readFileSync(source), original);
    assert.deepEqual(readdirSync(join(f.root, "work")), []);
  }
});

test("explicit supported language bypasses detection and cannot share an automatic or other-language cache", async t => {
  const f = singleLanguageFixture(t, "hi");
  const automaticKey = f.transcriber.cacheKey;
  f.config.language = "ur";
  const result = await f.transcriber.transcribe(audio(f.root, [100, 100]), join(f.root, "work"));
  assert.equal(result.text, "اردو الفاظ.\nاردو الفاظ.");
  assert.notEqual(f.transcriber.cacheKey, automaticKey);
  assert.notEqual(f.transcriber.cacheKey, new VoiceWhisperTranscriber({ ...f.config, language: "ar" }).cacheKey);
  const calls: string[][] = readFileSync(f.calls, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(args => !args.includes("-dl") && args[args.indexOf("-l") + 1] === "ur"));
  assert.throws(() => new VoiceWhisperTranscriber({ ...f.config, segmentation: "fixed" as "single-language" }).check(), /Unknown Voice Memos segmentation/);
});

test("unsupported single-language detection stops safely and leaves the original audio intact", async t => {
  const f = singleLanguageFixture(t, "hi");
  const source = audio(f.root, [100, 100]);
  const original = readFileSync(source);
  await assert.rejects(f.transcriber.transcribe(source, join(f.root, "work")), VoiceLanguageError);
  const calls: string[][] = readFileSync(f.calls, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.includes("-dl"));
  assert.deepEqual(readFileSync(source), original);
  assert.deepEqual(readdirSync(join(f.root, "work")), []);
});
