import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { VoiceLanguageError, type VoiceTranscript } from "../src/backends/voice-whisper.js";
import { readMarkdown, sha256 } from "../src/files.js";
import { VoiceDeferredError, findVoiceNotes, scheduledDay, syncVoiceMemos, voiceMemosStatus, type VoiceEngine, type VoiceLibrary, type VoiceRecording } from "../src/services/voice-memos.js";
import { testConfig } from "./helpers.js";

const transcript: VoiceTranscript = {
  text: "Original English. العربية اردو",
  segments: [{ start: 0, end: 2, text: "Original English.", language: "en" }, { start: 2, end: 4, text: "العربية اردو", language: "ar" }],
  status: "ready", warnings: [], engine: "local-fixture",
};

class FakeLibrary implements VoiceLibrary {
  records: VoiceRecording[] = [];
  copies: string[] = [];
  inventories = 0;
  inventoryError?: Error;
  async inventory(): Promise<VoiceRecording[]> {
    this.inventories++;
    if (this.inventoryError) throw this.inventoryError;
    return this.records.map(record => ({ ...record }));
  }
  async copy(id: string, output: string): Promise<void> {
    this.copies.push(id);
    const record = this.records.find(record => record.id === id);
    if (!record) throw new Error("Recording unavailable");
    copyFileSync(record.audioPath, output);
  }
}

class FakeEngine implements VoiceEngine {
  cacheKey?: string;
  checks = 0;
  calls: string[] = [];
  result = transcript;
  failure?: Error;
  gate?: Promise<void>;
  check(): void { this.checks++; }
  async transcribe(path: string): Promise<VoiceTranscript> {
    this.calls.push(path);
    if (this.gate) await this.gate;
    if (this.failure) throw this.failure;
    return this.result;
  }
}

function fixture(t: TestContext) {
  const config = testConfig();
  const root = dirname(config.vaultPath);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  config.voiceMemos = {
    libraryPath: join(root, "fixture-library"), outputPath: "Notes/Voice Memos",
    statePath: join(root, "voice-history.sqlite"), helperPath: join(root, "unused-native-helper"),
    binaryPath: join(root, "unused-whisper"), modelPath: join(root, "unused-model"), segmentSeconds: 30, nightlyHour: 3, segmentation: "single-language", language: "auto",
  };
  const library = new FakeLibrary();
  const engine = new FakeEngine();
  const output = join(config.vaultPath, config.voiceMemos.outputPath);
  function add(id: string, bytes = `original audio for ${id}`, ready = true) {
    const audioPath = join(config.audioDropPath, `${id}.m4a`);
    writeFileSync(audioPath, bytes);
    const recording: VoiceRecording = { id, title: `Memo ${id}`, audioPath, ready, createdAt: "2026-09-01T10:00:00.000Z", durationSeconds: 4 };
    library.records.push(recording);
    return recording;
  }
  function notePaths(): string[] {
    if (!existsSync(output)) return [];
    return readdirSync(output).filter(name => name.endsWith(".md"))
      .map(name => join(output, name)).filter(path => readMarkdown(path).properties["voice_memo_id"]);
  }
  function audioPaths(): string[] {
    const attachments = join(output, "Attachments");
    return existsSync(attachments) ? readdirSync(attachments).map(name => join(attachments, name)) : [];
  }
  return { config, library, engine, output, add, notePaths, audioPaths, dependencies: { library, engine } };
}

test("Voice Memos imports original audio and metadata once across source edits, renames, and deletion", async t => {
  const f = fixture(t);
  const source = f.add("stable-1");
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 1);
  const path = f.notePaths()[0]!;
  const original = readFileSync(path, "utf8");
  const note = readMarkdown(path);
  assert.equal(note.properties["voice_memo_id"], source.id);
  assert.equal(note.properties["original_title"], source.title);
  assert.equal(note.properties["duration_seconds"], 4);
  assert.equal(note.properties["local_only"], true);
  assert.deepEqual(note.properties["source_flags"], ["local-only"]);
  assert.deepEqual(note.properties["segments"], transcript.segments);
  assert.match(note.body, /!\[\[Notes\/Voice Memos\/Attachments\//);
  assert.ok(note.body.includes(transcript.text));
  assert.equal(readFileSync(f.audioPaths()[0]!, "utf8"), "original audio for stable-1");
  source.title = "Renamed at source";
  writeFileSync(source.audioPath, "later source edit");
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).skipped, 1);
  f.library.records = [];
  rmSync(source.audioPath);
  await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(readFileSync(path, "utf8"), original);
  assert.equal(readFileSync(f.audioPaths()[0]!, "utf8"), "original audio for stable-1");
  assert.equal(f.engine.calls.length, 1);
  assert.deepEqual(f.library.copies, ["stable-1"]);
});

test("Voice Memos duplicate audio gets separate recording notes and one transcription", async t => {
  const f = fixture(t);
  f.add("duplicate-a", "same recording bytes");
  f.add("duplicate-b", "same recording bytes");
  const result = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(result.imported, 2);
  assert.equal(f.notePaths().length, 2);
  assert.equal(f.audioPaths().length, 1);
  assert.equal(f.engine.calls.length, 1);
  assert.equal(findVoiceNotes(f.config.vaultPath).size, 2);
});

test("Voice Memos cache separates engine versions and preserves existing imported notes", async t => {
  const f = fixture(t);
  f.engine.cacheKey = "segmenter-v1";
  f.add("version-a", "same versioned audio");
  f.add("version-b", "same versioned audio");
  const first = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(first.imported, 2);
  assert.equal(f.engine.calls.length, 1, "identical audio with the same engine key should reuse cached transcription");

  const existingNote = f.notePaths()[0]!;
  const userEdit = `${readFileSync(existingNote, "utf8")}\nUser additions stay here.\n`;
  writeFileSync(existingNote, userEdit);
  f.engine.cacheKey = "segmenter-v2";
  f.engine.result = { ...transcript, text: "Reprocessed with the new segmenter." };
  f.add("version-c", "same versioned audio");
  const changed = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(changed.imported, 1);
  assert.equal(f.engine.calls.length, 2, "a changed engine key must recompute identical audio for a new recording");
  assert.equal(readFileSync(existingNote, "utf8"), userEdit, "existing imported notes must remain untouched");
  assert.equal(f.notePaths().length, 3);
  const newNote = f.notePaths().find(path => readMarkdown(path).properties["voice_memo_id"] === "version-c")!;
  assert.ok(readMarkdown(newNote).body.includes("Reprocessed with the new segmenter."));
});

test("Voice Memos resumes a retained copied checkpoint after the source is deleted", async t => {
  const f = fixture(t);
  const bytes = "audio retained immediately before process interruption";
  const recording = f.add("copied-checkpoint", bytes);
  // Create the normal database schema, then restore the durable pre-transcription checkpoint.
  await syncVoiceMemos(f.config, { dryRun: true }, f.dependencies);
  const hash = sha256(bytes);
  const audioPath = join(f.output, "Attachments", `${hash}.m4a`);
  mkdirSync(dirname(audioPath), { recursive: true });
  copyFileSync(recording.audioPath, audioPath);
  const history = new DatabaseSync(f.config.voiceMemos!.statePath);
  try {
    history.prepare("INSERT INTO imports(id, data) VALUES (?, ?)").run(recording.id, JSON.stringify({ recording, audioPath, hash, status: "copied" }));
  } finally { history.close(); }
  f.library.records = [];
  rmSync(recording.audioPath);
  const resumed = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(resumed.imported, 1);
  assert.equal(resumed.pending, 0);
  assert.equal(f.notePaths().length, 1);
  assert.equal(readFileSync(audioPath, "utf8"), bytes);
  assert.equal(f.library.copies.length, 0, "recovery must use the independent retained audio");
  assert.deepEqual(f.engine.calls, [audioPath]);
});

test("Voice Memos incomplete transcripts stay retryable without caching and later success preserves partial notes", async t => {
  const f = fixture(t);
  f.add("partial-a", "same partial audio");
  f.add("partial-b", "same partial audio");
  f.engine.result = { ...transcript, text: "Only the first segment survived.", status: "needs-review", incomplete: true, warnings: ["Processing failed for segment 2."] };
  const first = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(first.failed, 2);
  assert.equal(first.pending, 2);
  assert.equal(f.engine.calls.length, 2, "an incomplete result must not populate the duplicate-audio cache");
  const partialPaths = f.notePaths();
  assert.equal(partialPaths.length, 2);
  const originals = new Map(partialPaths.map(path => [path, readFileSync(path, "utf8")]));
  for (const path of partialPaths) {
    const note = readMarkdown(path);
    assert.equal(note.properties["status"], "needs-review");
    assert.equal(note.properties["retryable"], true);
    assert.ok(note.body.includes("Only the first segment survived."));
  }
  f.engine.result = transcript;
  const retry = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(retry.imported, 2);
  assert.equal(retry.failed, 0);
  assert.equal(f.engine.calls.length, 3, "successful retry may supply the cache for the duplicate recording");
  assert.equal(f.notePaths().length, 4);
  for (const [path, original] of originals) assert.equal(readFileSync(path, "utf8"), original);
  for (const path of f.notePaths().filter(path => !originals.has(path))) {
    const note = readMarkdown(path);
    assert.equal(note.properties["status"], "ready");
    assert.equal(note.properties["retryable"], false);
    assert.ok(note.body.includes(transcript.text));
  }
  assert.equal(f.library.copies.length, 2);
});

test("Voice Memos long Unicode titles fit filesystem limits while retaining full metadata", async t => {
  const f = fixture(t);
  const recording = f.add("unicode");
  recording.title = "مرحبا اردو 🎙️ ".repeat(60);
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 1);
  assert.equal((await syncVoiceMemos(f.config, { retry: recording.id }, f.dependencies)).imported, 1);
  assert.equal(f.notePaths().length, 2);
  for (const path of f.notePaths()) {
    assert.ok(Buffer.byteLength(basename(path)) <= 255);
    assert.equal(readMarkdown(path).properties["original_title"], recording.title);
  }
});

test("Voice Memos recognizes edited and moved notes by ID and does not recreate a deleted note", async t => {
  const f = fixture(t);
  f.add("move-delete");
  await syncVoiceMemos(f.config, {}, f.dependencies);
  const original = f.notePaths()[0]!;
  const edited = `${readFileSync(original, "utf8")}\nUser additions stay here.\n`;
  writeFileSync(original, edited);
  const moved = join(f.config.vaultPath, "Personal", "renamed voice note.md");
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(original, moved);
  await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(readFileSync(moved, "utf8"), edited);
  assert.equal(f.notePaths().length, 0);
  rmSync(moved);
  await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(findVoiceNotes(f.config.vaultPath).size, 0);
  assert.equal(f.engine.calls.length, 1);
  assert.equal(f.audioPaths().length, 1);
});

test("Voice Memos failures retain audio and automatic retry survives source deletion without overwriting edits", async t => {
  const f = fixture(t);
  const source = f.add("retry");
  f.engine.failure = new Error("Engine unavailable");
  const failed = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(failed.failed, 1);
  assert.equal(failed.imported, 0);
  assert.equal(f.audioPaths().length, 1);
  const failurePath = f.notePaths()[0]!;
  assert.equal(readMarkdown(failurePath).properties["status"], "failed");
  const edited = `${readFileSync(failurePath, "utf8")}\nMy review notes.\n`;
  writeFileSync(failurePath, edited);
  await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(f.notePaths().length, 1, "repeated failures must not create duplicate failure notes");
  f.library.records = [];
  rmSync(source.audioPath);
  delete f.engine.failure;
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 1);
  assert.equal(readFileSync(failurePath, "utf8"), edited);
  assert.equal(f.notePaths().length, 2);
  const retried = f.notePaths().find(path => path !== failurePath)!;
  assert.equal(readMarkdown(retried).properties["status"], "ready");
  assert.ok(readMarkdown(retried).body.includes(transcript.text));
  assert.equal(f.library.copies.length, 1);
});

test("Voice Memos deleting a failed note suppresses automatic retries, with explicit retry still available", async t => {
  const f = fixture(t);
  f.add("failed-deleted");
  f.engine.failure = new Error("Temporary failure");
  await syncVoiceMemos(f.config, {}, f.dependencies);
  rmSync(f.notePaths()[0]!);
  delete f.engine.failure;
  const suppressed = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(suppressed.imported, 0);
  assert.equal(f.engine.calls.length, 1);
  assert.equal(f.notePaths().length, 0);
  assert.equal((await syncVoiceMemos(f.config, { retry: "failed-deleted" }, f.dependencies)).imported, 1);
  assert.equal(f.notePaths().length, 1);
  assert.equal(f.library.copies.length, 1);
});

test("Voice Memos explicit retry writes a separate result and bypasses the audio cache", async t => {
  const f = fixture(t);
  f.add("explicit");
  await syncVoiceMemos(f.config, {}, f.dependencies);
  const original = f.notePaths()[0]!;
  const edited = `${readFileSync(original, "utf8")}\nHand-edited passage.\n`;
  writeFileSync(original, edited);
  f.engine.result = { ...transcript, text: "Second local engine result" };
  await syncVoiceMemos(f.config, { retry: "explicit" }, f.dependencies);
  assert.equal(readFileSync(original, "utf8"), edited);
  assert.equal(f.notePaths().length, 2);
  assert.equal(f.engine.calls.length, 2);
  assert.ok(f.notePaths().some(path => readMarkdown(path).body.includes("Second local engine result")));
});

test("Voice Memos defers incomplete audio, then imports it when fully available", async t => {
  const f = fixture(t);
  const source = f.add("download", "partial", false);
  const first = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(first.deferred, 1);
  assert.equal(first.pending, 1);
  assert.equal(f.library.copies.length, 0);
  assert.equal(f.engine.calls.length, 0);
  source.ready = true;
  writeFileSync(source.audioPath, "fully available");
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 1);
  assert.equal(readFileSync(f.audioPaths()[0]!, "utf8"), "fully available");
});

test("Voice Memos dry run inventories without checking models, copying audio, or transcribing", async t => {
  const f = fixture(t);
  f.add("available");
  f.add("incomplete", "partial", false);
  const result = await syncVoiceMemos(f.config, { dryRun: true }, f.dependencies);
  assert.equal(result.pending, 2);
  assert.equal(result.deferred, 1);
  assert.equal(f.library.inventories, 1);
  assert.equal(f.library.copies.length, 0);
  assert.equal(f.engine.checks, 0);
  assert.equal(f.engine.calls.length, 0);
  assert.equal(existsSync(f.output), false);
});

test("Voice Memos pilot limit leaves remaining recordings pending for another run", async t => {
  const f = fixture(t);
  f.add("pilot-a"); f.add("pilot-b");
  const first = await syncVoiceMemos(f.config, { limit: 1 }, f.dependencies);
  assert.equal(first.imported, 1);
  assert.equal(first.pending, 1);
  assert.equal(f.engine.calls.length, 1);
  const second = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(second.imported, 1);
  assert.equal(second.pending, 0);
  assert.equal(f.notePaths().length, 2);
});

test("Voice Memos rejects overlapping imports and releases its lock after completion", async t => {
  const f = fixture(t);
  f.add("locked");
  let release!: () => void;
  f.engine.gate = new Promise<void>(resolve => { release = resolve; });
  const first = syncVoiceMemos(f.config, {}, f.dependencies);
  try {
    await assert.rejects(syncVoiceMemos(f.config, {}, f.dependencies), /Another Voice Memos import is running/);
  } finally { release(); }
  assert.equal((await first).imported, 1);
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).skipped, 1);
  assert.equal(f.engine.calls.length, 1);
});

test("Voice Memos recovers an interruption after publication without duplicating notes or transcription", async t => {
  const f = fixture(t);
  f.add("interrupted");
  const first = await syncVoiceMemos(f.config, {}, { ...f.dependencies, afterPublish: () => { throw new Error("Simulated interruption"); } });
  assert.equal(first.failed, 1);
  assert.equal(f.notePaths().length, 1);
  const original = readFileSync(f.notePaths()[0]!, "utf8");
  await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(f.notePaths().length, 1);
  assert.equal(readFileSync(f.notePaths()[0]!, "utf8"), original);
  assert.equal(f.engine.calls.length, 1);
  assert.equal((voiceMemosStatus(f.config) as { total: number }).total, 1);
});

test("Voice Memos interrupted publication deleted by the user remains deleted", async t => {
  const f = fixture(t);
  f.add("interrupted-deleted");
  await syncVoiceMemos(f.config, {}, { ...f.dependencies, afterPublish: () => { throw new Error("Simulated interruption"); } });
  rmSync(f.notePaths()[0]!);
  await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(f.notePaths().length, 0);
  assert.equal(f.engine.calls.length, 1);
  assert.equal((voiceMemosStatus(f.config) as { suppressed: number }).suppressed, 1);
});

test("Voice Memos retries publication after a filesystem failure before any note was created", async t => {
  const f = fixture(t);
  const recording = f.add("publication-failed");
  const destination = join(f.output, `2026-09-01 ${recording.title}--${sha256(recording.id).slice(0, 16)}.md`);
  // A directory collision makes exclusive publication fail without publishing a note.
  mkdirSync(destination, { recursive: true });
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).failed, 1);
  assert.equal(findVoiceNotes(f.config.vaultPath).size, 0);
  assert.equal(f.audioPaths().length, 1);
  rmSync(destination, { recursive: true });
  const retried = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(retried.imported, 1, "a note that was never published must remain retryable");
  assert.equal(f.notePaths().length, 1);
  assert.equal(f.engine.calls.length, 1, "publication retry should reuse the successful local transcription");
});

test("Voice Memos tolerates malformed frontmatter in unrelated vault notes", async t => {
  const f = fixture(t);
  f.add("unrelated-yaml");
  const unrelated = join(f.config.vaultPath, "Unfinished draft.md");
  const original = "---\ntags: [unfinished\n---\n\nA draft I am still editing.\n";
  writeFileSync(unrelated, original);
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 1);
  assert.equal(readFileSync(unrelated, "utf8"), original);
});

test("Voice Memos reports inaccessible libraries as failures and releases its lock for retry", async t => {
  const f = fixture(t);
  f.library.inventoryError = new Error("PRIVATE title and /private/example-path");
  await assert.rejects(syncVoiceMemos(f.config, {}, f.dependencies), /Check Full Disk Access/);
  assert.equal(f.engine.calls.length, 0);
  const status = readMarkdown(join(f.output, "Voice Memos Status.md"));
  assert.match(String(status.properties["error"]), /Check Full Disk Access/);
  assert.ok(!String(status.properties["error"]).includes("PRIVATE"));
  delete f.library.inventoryError;
  f.add("after-permission");
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 1);
});

test("Voice Memos saves distinct review and no-speech outcomes", async t => {
  const f = fixture(t);
  f.add("review");
  f.engine.result = { ...transcript, status: "needs-review", warnings: ["Incomplete processing"] };
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).needsReview, 1);
  f.add("silent");
  f.engine.result = { ...transcript, text: "", segments: [], status: "no-speech" };
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 1);
  const notes = f.notePaths().map(readMarkdown);
  assert.ok(notes.some(note => note.properties["status"] === "needs-review"));
  assert.ok(notes.some(note => note.properties["status"] === "no-speech" && note.body.includes("No speech detected.")));
});

test("Voice Memos continues processing later recordings after an engine failure", async t => {
  const f = fixture(t);
  f.add("first-fails");
  f.add("second-succeeds");
  const transcribe = f.engine.transcribe.bind(f.engine);
  f.engine.transcribe = async path => {
    if (f.engine.calls.length === 0) f.engine.failure = new Error("First recording could not be processed");
    else delete f.engine.failure;
    return transcribe(path);
  };
  const result = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(result.failed, 1);
  assert.equal(result.imported, 1);
  assert.equal(result.pending, 1);
  assert.equal(f.audioPaths().length, 2);
  assert.equal(f.notePaths().length, 2);
  const notes = findVoiceNotes(f.config.vaultPath);
  assert.equal(readMarkdown(notes.get("first-fails")!).properties["status"], "failed");
  assert.equal(readMarkdown(notes.get("second-succeeds")!).properties["status"], "ready");
});

test("Voice Memos scheduled catch-up runs once per local 3 AM period", async t => {
  const f = fixture(t);
  f.add("nightly-first");
  const missedRunCatchup = new Date(2026, 8, 24, 12);
  assert.equal(scheduledDay(new Date(2026, 8, 24, 2, 59), 3), "2026-09-23");
  assert.equal(scheduledDay(new Date(2026, 8, 24, 3), 3), "2026-09-24");
  assert.equal((await syncVoiceMemos(f.config, { scheduled: true, now: missedRunCatchup }, f.dependencies)).imported, 1);
  f.add("nightly-next");
  const samePeriod = await syncVoiceMemos(f.config, { scheduled: true, now: new Date(2026, 8, 25, 2) }, f.dependencies);
  assert.equal(samePeriod.imported, 0);
  assert.equal(f.library.inventories, 1);
  assert.equal((await syncVoiceMemos(f.config, { scheduled: true, now: new Date(2026, 8, 25, 9) }, f.dependencies)).imported, 1);
  assert.equal(f.engine.calls.length, 2);
});


test("Voice Memos defers a changing recording without reporting an actionable failure", async t => {
  const f = fixture(t); f.add("changing");
  const copy = f.library.copy.bind(f.library);
  f.library.copy = async () => { throw new VoiceDeferredError("changed during copy"); };
  const deferred = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(deferred.failed, 0);
  assert.equal(deferred.deferred, 1);
  assert.equal(deferred.pending, 1);
  assert.equal(f.engine.calls.length, 0);
  assert.equal(f.notePaths().length, 0);
  f.library.copy = copy;
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 1);
});


test("unsupported language retains audio with a safe explicit-language retry instruction", async t => {
  const f = fixture(t);
  f.add("unsupported", "original recording");
  f.engine.failure = new VoiceLanguageError();
  const result = await syncVoiceMemos(f.config, {}, f.dependencies);
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
  const note = readMarkdown(f.notePaths()[0]!);
  assert.match(note.body, /retry with --language en, ar, or ur/);
  assert.equal(note.properties["retryable"], true);
  assert.equal(readFileSync(f.engine.calls[0]!, "utf8"), "original recording");
});


test("missing import history requires restoration before writing into a previously imported vault", async t => {
  const f = fixture(t);
  f.add("retained-note");
  await syncVoiceMemos(f.config, {}, f.dependencies);
  const saved = readFileSync(f.config.voiceMemos.statePath);
  const originalNote = readFileSync(f.notePaths()[0]!);
  rmSync(f.config.voiceMemos.statePath);
  f.add("new-note");
  await assert.rejects(syncVoiceMemos(f.config, {}, f.dependencies), /Restore the original Voice Memos history/);
  assert.equal(existsSync(f.config.voiceMemos.statePath), false);
  assert.deepEqual(readFileSync(f.notePaths()[0]!), originalNote);
  assert.equal(f.library.copies.length, 1);
  writeFileSync(f.config.voiceMemos.statePath, saved);
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 1);
});

test("an empty replacement history cannot silently reconstruct deleted-note suppression", async t => {
  const f = fixture(t);
  f.add("visible");
  await syncVoiceMemos(f.config, {}, f.dependencies);
  rmSync(f.config.voiceMemos.statePath);
  const empty = new DatabaseSync(f.config.voiceMemos.statePath); empty.close();
  await assert.rejects(syncVoiceMemos(f.config, {}, f.dependencies), /Restore the original Voice Memos history/);
  assert.equal(f.library.copies.length, 1);
});


test("restored history locates verified retained audio after a vault moves to another Mac", async t => {
  const f = fixture(t);
  const record = f.add("migrated");
  f.engine.failure = new Error("Synthetic failure before migration");
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).failed, 1);
  const original = readFileSync(f.notePaths()[0]!, "utf8");
  const history = new DatabaseSync(f.config.voiceMemos.statePath);
  try {
    const row = history.prepare("SELECT data FROM imports WHERE id=?").get(record.id) as { data: string };
    const entry = JSON.parse(row.data);
    entry.audioPath = join(dirname(f.config.vaultPath), "former-vault", "Attachments", basename(entry.audioPath));
    history.prepare("UPDATE imports SET data=? WHERE id=?").run(JSON.stringify(entry), record.id);
  } finally { history.close(); }
  f.library.records = [];
  delete f.engine.failure;
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 1);
  assert.equal(f.engine.calls.length, 2);
  assert.equal(f.library.copies.length, 1);
  assert.equal(readFileSync(f.notePaths().find(path => !basename(path).includes("--retry-"))!, "utf8"), original);
  for (const path of f.notePaths()) rmSync(path);
  f.library.records = [record];
  assert.equal((await syncVoiceMemos(f.config, {}, f.dependencies)).imported, 0);
  assert.equal(f.notePaths().length, 0);
  assert.equal(f.engine.calls.length, 2);
});
