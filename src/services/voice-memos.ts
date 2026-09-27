import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, linkSync, rmSync, lstatSync, openSync, fsyncSync, closeSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../types.js";
import { atomicWrite, markdown, readMarkdown, safeFilename, sha256 } from "../files.js";
import { VoiceLanguageError, VoiceWhisperTranscriber, type VoiceTranscript } from "../backends/voice-whisper.js";

export interface VoiceRecording { id: string; title: string; createdAt: string; durationSeconds: number; audioPath: string; ready: boolean }
export interface VoiceLibrary { inventory(): Promise<VoiceRecording[]>; copy(id: string, output: string): Promise<void> }
export interface VoiceEngine { readonly cacheKey?: string; check(): void; transcribe(path: string, workDir: string): Promise<VoiceTranscript> }
export class VoiceDeferredError extends Error {}
export class VoiceImportError extends Error {}
const MISSING_HISTORY = "Voice Memos history is missing but imported notes already exist. Restore the original Voice Memos history database from backup before importing into this vault; existing notes cannot recover deleted-note history.";
const IMPORT_FAILURE = "Voice Memos import failed. Check Full Disk Access, local model/runtime access, available storage, and the configured library. No private diagnostics were logged.";
type Entry = { recording: VoiceRecording; audioPath: string; hash: string; status: string; notePath?: string; result?: VoiceTranscript; error?: string; publication?: string };
export type VoiceSummary = { lastRun: string; imported: number; pending: number; failed: number; deferred: number; skipped: number; needsReview: number; error?: string };
function titleForFilename(title: string): string {
  let result = "";
  for (const character of safeFilename(title)) {
    if (Buffer.byteLength(result + character) > 120) break;
    result += character;
  }
  return result;
}
export function voiceConfig(config: AppConfig): NonNullable<AppConfig["voiceMemos"]> {
  if (!config.voiceMemos) throw new VoiceImportError("Voice Memos configuration is missing");
  return config.voiceMemos;
}
function helper(path: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(path, args, { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 }, (error, stdout) => {
    // Native diagnostics contain only actionable error categories, never transcripts.
    if (error && error.code === 75) reject(new VoiceDeferredError("Recording is changing or not fully available; deferred until the next run"));
    else if (error) reject(new VoiceImportError("Voice Memos helper failed. Run voice-memos-check from the packaged app; check Full Disk Access and catalogue support."));
    else resolve(stdout);
  }));
}
export class NativeVoiceLibrary implements VoiceLibrary {
  private observed = new Map<string, VoiceRecording>();
  constructor(private readonly config: NonNullable<AppConfig["voiceMemos"]>) {}
  async inventory(): Promise<VoiceRecording[]> {
    const parsed = JSON.parse(await helper(this.config.helperPath, ["inventory", "--library", this.config.libraryPath])) as {schemaVersion: number; catalogueRecognized: boolean; recordings: VoiceRecording[]};
    if (parsed.schemaVersion !== 1 || parsed.catalogueRecognized !== true || !Array.isArray(parsed.recordings)) throw new VoiceImportError("Unrecognized Voice Memos catalogue response");
    const ids = new Set<string>();
    for (const r of parsed.recordings) {
      if (!r.id || ids.has(r.id) || typeof r.title !== "string" || !Number.isFinite(Date.parse(r.createdAt)) || !Number.isFinite(r.durationSeconds) || r.durationSeconds < 0 || typeof r.audioPath !== "string" || typeof r.ready !== "boolean") throw new VoiceImportError("Invalid Voice Memos catalogue metadata");
      ids.add(r.id);
    }
    this.observed = new Map(parsed.recordings.map(r => [r.id, r]));
    return parsed.recordings;
  }
  async copy(id: string, output: string): Promise<void> {
    const response = JSON.parse(await helper(this.config.helperPath, ["copy", "--library", this.config.libraryPath, "--id", id, "--output", output])) as { recording?: VoiceRecording };
    const expected = this.observed.get(id);
    const actual = response.recording;
    if (!expected || !actual || !actual.ready || ["id", "title", "createdAt", "durationSeconds", "audioPath"].some(key => actual[key as keyof VoiceRecording] !== expected[key as keyof VoiceRecording])) {
      rmSync(output, {force: true});
      throw new VoiceDeferredError("Recording metadata changed during the copy; retry on the next run");
    }
  }
}
export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function durableDirectory(path: string): void { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function publishNew(stage: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.voice-stage-${randomUUID()}`);
  try {
    copyFileSync(stage, temporary); // Stage on the destination volume, including external vaults.
    const fd = openSync(temporary, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
    linkSync(temporary, destination); // Exclusive, atomic publication; never overwrite a user's file.
    durableDirectory(dirname(destination));
  } finally { rmSync(temporary, {force: true}); }
}
class History {
  readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try { this.db.exec("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cache(hash TEXT PRIMARY KEY, result TEXT NOT NULL)"); }
    catch (error) { this.db.close(); throw error; }
  }
  get(id: string): Entry | undefined { const row = this.db.prepare("SELECT data FROM imports WHERE id=?").get(id) as {data:string}|undefined; return row ? JSON.parse(row.data) as Entry : undefined; }
  entries(): Entry[] { return (this.db.prepare("SELECT data FROM imports").all() as {data:string}[]).map(row => JSON.parse(row.data) as Entry); }
  put(entry: Entry): void { this.db.prepare("INSERT OR REPLACE INTO imports VALUES (?,?)").run(entry.recording.id, JSON.stringify(entry)); }
  meta<T>(key: string): T | undefined { const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key) as {value:string}|undefined; return row ? JSON.parse(row.value) as T : undefined; }
  set(key: string, value: unknown): void { this.db.prepare("INSERT OR REPLACE INTO meta VALUES (?,?)").run(key, JSON.stringify(value)); }
  cached(key: string): VoiceTranscript | undefined { const row = this.db.prepare("SELECT result FROM cache WHERE hash=?").get(key) as {result:string}|undefined; return row ? JSON.parse(row.result) as VoiceTranscript : undefined; }
  cache(key: string, result: VoiceTranscript): void { this.db.prepare("INSERT OR REPLACE INTO cache VALUES (?,?)").run(key, JSON.stringify(result)); }
}
export function findVoiceNotes(root: string): Map<string, string> {
  const found = new Map<string, string>();
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root, {recursive: true, encoding: "utf8"})) {
    if (!entry.endsWith(".md")) continue;
    const path = join(root, entry);
    if (!lstatSync(path).isFile()) continue;
    let parsed: ReturnType<typeof readMarkdown>;
    try { parsed = readMarkdown(path); } catch { continue; }
    if (typeof parsed.properties["voice_memo_id"] === "string") found.set(parsed.properties["voice_memo_id"], path);
  }
  return found;
}
export function scheduledDay(now: Date, hour: number): string {
  const due = new Date(now); due.setHours(hour, 0, 0, 0);
  if (now < due) due.setDate(due.getDate() - 1);
  return `${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,"0")}-${String(due.getDate()).padStart(2,"0")}`;
}
export async function checkVoiceMemos(config: AppConfig): Promise<unknown> {
  const voice = voiceConfig(config);
  const library = new NativeVoiceLibrary(voice);
  const recordings = await library.inventory();
  const available = recordings.find(r => r.ready);
  mkdirSync(dirname(voice.statePath), {recursive: true, mode: 0o700});
  const probe = mkdtempSync(join(dirname(voice.statePath), "access-probe-"));
  try {
    if (available) {
      const destination = join(probe, "original");
      await library.copy(available.id, destination);
      if (lstatSync(destination).size === 0) throw new VoiceImportError("Scheduled audio copy produced an empty file");
    }
  } finally { rmSync(probe, {recursive:true, force:true}); }
  new VoiceWhisperTranscriber(voice).check();
  if (!available) throw new VoiceImportError("No fully downloaded recording is available to verify scheduled audio copying");
  return { ok: true, recordings: recordings.length, available: recordings.filter(r => r.ready).length, copyVerified: true, localOnly: true };
}
export function voiceMemosStatus(config: AppConfig): unknown {
  const path = voiceConfig(config).statePath;
  if (!existsSync(path)) return { configured: true, hasRun: false };
  const history = new History(path);
  try { const entries = history.entries(); return { lastRun: history.meta("summary"), total: entries.length, failed: entries.filter(e => e.status === "failed").length, suppressed: entries.filter(e => e.status === "suppressed").length }; } finally { history.db.close(); }
}
export async function syncVoiceMemos(config: AppConfig, options: { dryRun?: boolean; limit?: number; retry?: string; scheduled?: boolean; now?: Date } = {}, dependencies: {library?: VoiceLibrary; engine?: VoiceEngine; afterPublish?: () => void} = {}): Promise<VoiceSummary> {
  const voice = voiceConfig(config);
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) throw new VoiceImportError("--limit must be a positive integer");
  if (options.retry && options.scheduled) throw new VoiceImportError("A scheduled run cannot explicitly retry an ID");
  const library = dependencies.library ?? new NativeVoiceLibrary(voice);
  const engine: VoiceEngine = dependencies.engine ?? new VoiceWhisperTranscriber(voice);
  const now = options.now ?? new Date();
  const summary: VoiceSummary = {lastRun: now.toISOString(), imported: 0, pending: 0, failed: 0, deferred: 0, skipped: 0, needsReview: 0};
  mkdirSync(dirname(voice.statePath), { recursive: true, mode: 0o700 });
  const lock = new DatabaseSync(`${voice.statePath}.lock.sqlite`);
  try { lock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE"); } catch { lock.close(); throw new VoiceImportError("Another Voice Memos import is running"); }
  let history: History;
  try {
    if (!existsSync(voice.statePath) && findVoiceNotes(config.vaultPath).size) throw new VoiceImportError(MISSING_HISTORY);
    history = new History(voice.statePath);
    // An empty replacement database is also not valid migration history.
    if (!history.entries().length && findVoiceNotes(config.vaultPath).size) {
      history.db.close();
      throw new VoiceImportError(MISSING_HISTORY);
    }
  } catch (error) { lock.close(); throw error instanceof VoiceImportError ? error : new VoiceImportError(IMPORT_FAILURE); }
  const output = join(config.vaultPath, voice.outputPath);
  let work: string | undefined;
  try {
    const day = scheduledDay(now, voice.nightlyHour);
    if (options.scheduled && history.meta<string>("scheduledDay") === day) return {...summary, skipped: 1};
    const inventory = await library.inventory();
    const notes = findVoiceNotes(config.vaultPath);
    // An interrupted publication may already have been deleted or moved by the user.
    // Suppress ambiguous absent notes; explicit retry can recover retained audio.
    if (!options.dryRun) for (const entry of history.entries().filter(e => e.status === "publishing")) {
      entry.status = notes.has(entry.recording.id) ? (entry.error ? "failed" : entry.result?.status ?? "failed") : "suppressed";
      if (notes.has(entry.recording.id)) entry.notePath = notes.get(entry.recording.id)!;
      history.put(entry);
    }
    const candidates = new Map(inventory.map(r => [r.id, r]));
    // Retained failed imports can retry even after Apple deletes the original.
    for (const e of history.entries()) if (["failed", "copied"].includes(e.status) || options.retry === e.recording.id) candidates.set(e.recording.id, e.recording);
    if (options.retry && !candidates.has(options.retry)) throw new VoiceImportError("Unknown recording ID for retry");
    const pending: VoiceRecording[] = [];
    for (const r of candidates.values()) {
      if (options.retry && r.id !== options.retry) continue;
      const entry = history.get(r.id);
      if (!options.retry && entry?.notePath && !notes.has(r.id)) {
        if (!options.dryRun) { entry.status = "suppressed"; history.put(entry); }
        summary.skipped++; continue;
      }
      if (!options.retry && (entry ? !["failed", "copied"].includes(entry.status) : notes.has(r.id))) { summary.skipped++; continue; }
      if (!entry && !r.ready) { summary.deferred++; continue; }
      pending.push(r);
    }
    summary.pending = pending.length + summary.deferred;
    if (options.dryRun) return summary;
    if (pending.length) engine.check();
    mkdirSync(output, { recursive: true });
    work = mkdtempSync(join(dirname(voice.statePath), "work-"));
    for (const r of pending.slice(0, options.limit)) {
      let entry = history.get(r.id);
      try {
        if (!entry) {
          const copied = join(work, `${randomUUID()}${extname(r.audioPath) || ".m4a"}`);
          await library.copy(r.id, copied);
          const hash = await hashFile(copied);
          const audioPath = join(output, "Attachments", `${hash}${extname(r.audioPath).toLowerCase() || ".m4a"}`);
          if (!existsSync(audioPath)) publishNew(copied, audioPath);
          else if (await hashFile(audioPath) !== hash) throw new VoiceImportError("Retained audio integrity failure");
          rmSync(copied);
          entry = {recording: r, audioPath, hash, status: "copied"}; history.put(entry);
        }
        if (!existsSync(entry.audioPath)) {
          // A restored history may refer to the previous Mac's vault location.
          // Rebase only an existing content-addressed attachment, verifying bytes.
          const restored = join(output, "Attachments", `${entry.hash}${extname(entry.audioPath).toLowerCase() || ".m4a"}`);
          if (existsSync(restored) && await hashFile(restored) === entry.hash) {
            entry.audioPath = restored;
            history.put(entry);
          }
        }
        if (!existsSync(entry.audioPath) || await hashFile(entry.audioPath) !== entry.hash) throw new VoiceImportError("Retained audio missing or modified");
        let result: VoiceTranscript;
        try {
          const cacheKey = engine.cacheKey === undefined ? entry.hash : `${entry.hash}:${engine.cacheKey}`;
          result = (!options.retry && history.cached(cacheKey)) || await engine.transcribe(entry.audioPath, work);
          if (!result.incomplete) history.cache(cacheKey, result);
        } catch (error) {
          entry.status = "failed"; entry.error = error instanceof VoiceLanguageError ? new VoiceLanguageError().message : "Local transcription failed; audio retained. Verify the engine and retry.";
          // Publish a failure note once; subsequent attempts always preserve it.
          result = {text: "", segments: [], status: "needs-review", warnings: [entry.error], engine: "whisper-large-v3"};
        }
        const failed = result.incomplete === true || (entry.status === "failed" && !result.text && result.warnings.includes(entry.error ?? ""));
        if (result.incomplete) entry.error = "Some segments failed; retained audio will be retried.";
        if (!failed) delete entry.error;
        entry.result = result;
        const outcome = failed ? "failed" : result.status;
        const previouslyPublished = Boolean(entry.notePath) || notes.has(r.id);
        const suffix = previouslyPublished || options.retry ? `--retry-${randomUUID()}` : "";
        const notePath = join(output, `${r.createdAt.slice(0,10)} ${titleForFilename(entry.recording.title)}--${sha256(r.id).slice(0,16)}${suffix}.md`);
        // Avoid a new failure note on every overnight retry.
        if (!(failed && previouslyPublished && !options.retry)) {
          const rendered = markdown({kind: "voice-memo", voice_memo_id: r.id, local_only: true, source_flags: ["local-only"], original_title: entry.recording.title, created_at: entry.recording.createdAt, duration_seconds: entry.recording.durationSeconds, audio_sha256: entry.hash, status: result.incomplete ? "needs-review" : outcome, retryable: failed, transcription_engine: result.engine, review_reasons: result.warnings, segments: result.segments, processing_segments: result.processingSegments ?? [], imported_at: now.toISOString()}, `# ${entry.recording.title.replace(/[\r\n]/g," ")}\n\n![[${relative(config.vaultPath, entry.audioPath)}]]\n\n${failed ? "Transcription failed or is incomplete. Original audio is retained; retry is automatic." : result.status === "no-speech" ? "No speech detected." : ""}\n\n${failed && entry.error ? `${entry.error}\n\n` : ""}${result.text}`);
          const stagedNote = join(work, "note.md"); atomicWrite(stagedNote, rendered);
          entry.status = "publishing"; entry.publication = notePath; history.put(entry);
          try { publishNew(stagedNote, notePath); }
          catch { entry.status = "failed"; history.put(entry); throw new VoiceImportError("Note publication failed; retained audio will be retried"); }
          dependencies.afterPublish?.();
          entry.notePath ??= notePath;
          rmSync(stagedNote);
        }
        entry.status = outcome; if (!failed) delete entry.error; history.put(entry);
        if (failed) summary.failed++; else { summary.imported++; summary.pending--; if (outcome === "needs-review") summary.needsReview++; }
      } catch (error) {
        if (!entry && error instanceof VoiceDeferredError) { summary.deferred++; continue; }
        // Leave publication reservations intact for conservative recovery.
        if (entry && entry.status !== "publishing") { entry.status = "failed"; entry.error = "Import failed; retained audio will be retried. Check local permissions and storage."; history.put(entry); }
        summary.failed++;
      }
    }
    if (options.scheduled) history.set("scheduledDay", day);
    if (!options.dryRun) history.set("summary", summary);
    writeStatus(output, summary);
    return summary;
  } catch (error) {
    const safe = error instanceof VoiceImportError ? error : new VoiceImportError(IMPORT_FAILURE);
    summary.error = safe.message;
    if (!options.dryRun) history.set("summary", summary);
    if (!options.dryRun) writeStatus(output, summary);
    throw safe;
  } finally {
    try { if (work) rmSync(work, {recursive:true,force:true}); }
    finally { try { history.db.close(); } finally { lock.close(); } }
  }
}
function writeStatus(output: string, summary: VoiceSummary): void {
  atomicWrite(join(output, "Voice Memos Status.md"), markdown({kind: "voice-memos-status", local_only: true, ...summary}, `# Voice Memos\n\nLast run: ${summary.lastRun}\n\nImported this run: ${summary.imported}\nPending: ${summary.pending}\nDeferred downloads: ${summary.deferred}\nFailures: ${summary.failed}\nNeeds review: ${summary.needsReview}\n\n${summary.error ?? "Transcripts are local, unedited engine output. Review flags cannot guarantee accuracy."}`));
}
