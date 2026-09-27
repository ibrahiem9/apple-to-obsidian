import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../types.js";
import { applyAppleNotesExport } from "./apple-notes-export.js";

interface ExportOptions { inventoryOnly: boolean; attachmentsDirectory?: string }
export interface AppleNotesDependencies { exportNotes?: (path: string, options: ExportOptions) => Promise<void> }
interface Inventory { expectedCount: number; notes: unknown[]; errors: string[]; inventoryOnly?: boolean; exportLimit?: number }
export interface AppleNotesSummary {
  lastRun: string;
  expected: number;
  exported: number;
  updated: number;
  unchanged: number;
  retainedDeleted: number;
  retainedDuplicates: number;
  failed: number;
  skipped: number;
  error?: string;
}
const failureMessage = "Apple Notes export failed. Check Notes Automation permission for Apple to Obsidian.app and the vault's write access; inspect local diagnostics with the status command.";

function runDirectory(config: AppConfig): string {
  const parent = join(dirname(config.statePath), "apple-notes-runs");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(parent, "run-"));
}

async function exportNotes(path: string, options: ExportOptions): Promise<void> {
  // In both the checkout and installed app, dist/src/services sits three levels below scripts.
  const script = fileURLToPath(new URL("../../../scripts/export-apple-notes.jxa", import.meta.url));
  const attachmentsDirectory = options.attachmentsDirectory ?? join(dirname(path), "attachments");
  if (!options.inventoryOnly) mkdirSync(attachmentsDirectory, { recursive: true, mode: 0o700 });
  const output = openSync(path, "wx", 0o600);
  const stderr = openSync(join(dirname(path), "stderr.log"), "wx", 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/osascript", ["-l", "JavaScript", script, ...(options.inventoryOnly ? ["--inventory"] : ["--attachments-dir", attachmentsDirectory])], {
        stdio: ["ignore", output, stderr],
        // A stuck Automation request must not retain the importer lock indefinitely.
        timeout: 30 * 60 * 1000,
        killSignal: "SIGKILL",
      });
      child.once("error", () => reject(new Error(failureMessage)));
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(failureMessage)));
    });
  } finally { closeSync(output); closeSync(stderr); }
}

function inventory(path: string): Inventory {
  const value = JSON.parse(readFileSync(path, "utf8")) as Inventory;
  if (!value || !Number.isSafeInteger(value.expectedCount) || value.expectedCount < 0 || !Array.isArray(value.notes) || !Array.isArray(value.errors)) throw new Error(failureMessage);
  if (value.exportLimit !== undefined || value.errors.length || (!value.inventoryOnly && value.notes.length !== value.expectedCount)) throw new Error(failureMessage);
  return value;
}

export async function checkAppleNotes(config: AppConfig, dependencies: AppleNotesDependencies = {}): Promise<{ accessible: true; expected: number }> {
  const directory = runDirectory(config);
  const path = join(directory, "payload.json");
  let success = false;
  try {
    await (dependencies.exportNotes ?? exportNotes)(path, { inventoryOnly: true });
    const result = inventory(path);
    success = true;
    return { accessible: true, expected: result.expectedCount };
  } catch { throw new Error(failureMessage); }
  finally { if (success) rmSync(directory, { recursive: true, force: true }); }
}

export function appleNotesScheduledDay(now: Date, hour: number): string {
  const due = new Date(now); due.setHours(hour, 0, 0, 0);
  if (now < due) due.setDate(due.getDate() - 1);
  return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
}

function openState(config: AppConfig): DatabaseSync {
  mkdirSync(dirname(config.statePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.statePath);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS apple_notes_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
}
function get(db: DatabaseSync, key: string): unknown {
  const row = db.prepare("SELECT value FROM apple_notes_meta WHERE key=?").get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
}
function set(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare("INSERT INTO apple_notes_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
}

export function appleNotesStatus(config: AppConfig): { lastRun: AppleNotesSummary | null; scheduledDay: string | null; diagnosticsAvailable: boolean } {
  if (!existsSync(config.statePath)) return { lastRun: null, scheduledDay: null, diagnosticsAvailable: false };
  const db = new DatabaseSync(config.statePath, { readOnly: true });
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='apple_notes_meta'").get();
    if (!table) return { lastRun: null, scheduledDay: null, diagnosticsAvailable: false };
    return { lastRun: get(db, "summary") as AppleNotesSummary | null, scheduledDay: get(db, "scheduledDay") as string | null, diagnosticsAvailable: get(db, "diagnostics") !== null };
  } finally { db.close(); }
}

export async function syncAppleNotes(config: AppConfig, options: { scheduled?: boolean; dryRun?: boolean; now?: Date } = {}, dependencies: AppleNotesDependencies = {}): Promise<AppleNotesSummary> {
  const now = options.now ?? new Date();
  const summary: AppleNotesSummary = { lastRun: now.toISOString(), expected: 0, exported: 0, updated: 0, unchanged: 0, retainedDeleted: 0, retainedDuplicates: 0, failed: 0, skipped: 0 };
  mkdirSync(dirname(config.statePath), { recursive: true, mode: 0o700 });
  const lock = new DatabaseSync(`${config.statePath}.lock.sqlite`);
  try { lock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE"); } catch { lock.close(); throw new Error("Another Apple Notes import is running"); }
  let db: DatabaseSync | undefined;
  let directory: string | undefined;
  try {
    db = openState(config);
    const day = appleNotesScheduledDay(now, config.appleNotes.nightlyHour);
    if (options.scheduled && !options.dryRun && get(db, "scheduledDay") === day) return { ...summary, skipped: 1 };
    directory = runDirectory(config);
    const path = join(directory, "payload.json");
    await (dependencies.exportNotes ?? exportNotes)(path, { inventoryOnly: options.dryRun ?? false, attachmentsDirectory: join(directory, "attachments") });
    const data = inventory(path);
    summary.expected = data.expectedCount;
    if (options.dryRun) return summary;
    const result = applyAppleNotesExport(config, path);
    const { manifestPath: _manifestPath, ...counts } = result;
    Object.assign(summary, counts);
    db.exec("BEGIN IMMEDIATE");
    try {
      set(db, "summary", summary); set(db, "scheduledDay", day); set(db, "diagnostics", null);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    rmSync(directory, { recursive: true, force: true }); directory = undefined;
    return summary;
  } catch {
    summary.failed = Math.max(summary.failed, 1); summary.error = failureMessage;
    if (db && !options.dryRun) { set(db, "summary", summary); set(db, "diagnostics", directory ?? null); }
    throw new Error(failureMessage);
  } finally {
    if (options.dryRun && directory) rmSync(directory, { recursive: true, force: true });
    try { db?.close(); } finally { lock.close(); }
  }
}
