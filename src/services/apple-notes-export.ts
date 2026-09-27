import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AppConfig } from "../types.js";
import { atomicWrite, markdown, readMarkdown, safeFilename, sha256 } from "../files.js";

interface ExportedAppleNote {
  id: string;
  title: string;
  body: string;
  modifiedAt: string;
  createdAt?: string;
  account?: string;
  folder?: string;
  hasAttachments: boolean;
  locked: boolean;
  exportError?: string;
}

interface AppleNotesPayload {
  startedAt: string;
  expectedCount: number;
  notes: ExportedAppleNote[];
  errors: string[];
}

export function applyAppleNotesExport(config: AppConfig, payloadPath: string): { expected: number; exported: number; updated: number; unchanged: number; retainedDeleted: number; retainedDuplicates: number; failed: number; manifestPath: string } {
  const payload = JSON.parse(requireFile(payloadPath)) as AppleNotesPayload;
  if (!Array.isArray(payload.notes) || !Array.isArray(payload.errors) || typeof payload.expectedCount !== "number") throw new Error("Malformed Apple Notes export payload");
  const destination = join(config.vaultPath, config.appleNotesPath);
  const existing = mapExistingFiles(destination);
  const existingById = existing.byId;
  let updated = 0;
  let unchanged = 0;
  let retainedDeleted = 0;
  let retainedDuplicates = 0;
  const seenIds = new Set<string>();
  const failures: Array<{ id: string; error: string }> = payload.errors.map((error) => ({ id: "export", error }));
  for (const note of payload.notes) {
    try {
      if (!note.id) throw new Error("note has no Apple Notes ID");
      seenIds.add(note.id);
      const flags: string[] = ["local-only"];
      if (note.locked) flags.push("locked");
      if (note.exportError) {
        flags.push("export-error");
        failures.push({ id: note.id, error: "Unable to read note plaintext" });
        // Retain the last successful copy when Notes cannot return its body.
        if (existingById.has(note.id)) continue;
      }
      if (/recently deleted|deleted/i.test(note.folder ?? "")) flags.push("deleted");
      const meaningfulBody = note.body.replace(/\uFFFC/g, "").trim();
      if (!meaningfulBody) flags.push(note.hasAttachments ? "attachment-only" : "blank");
      const hash = sha256(note.body);
      const suffix = sha256(note.id).slice(0, 8);
      const path = existingById.get(note.id) ?? join(destination, `${safeFilename(note.title)}--${suffix}.md`);
      const properties: Record<string, unknown> = {
        source: "apple-notes", local_only: true, apple_note_id: note.id, apple_modified_iso: note.modifiedAt,
        apple_account: note.account ?? null, apple_folder: note.folder ?? null,
        has_attachments: note.hasAttachments, content_hash: hash, source_flags: flags,
      };
      if (note.createdAt) properties["apple_created_iso"] = note.createdAt;
      if (note.exportError) properties["export_error"] = note.exportError;
      const content = markdown(properties, `# ${note.title || "Untitled"}\n\n${note.body}`);
      if (existsSync(path) && requireFile(path) === content) unchanged += 1;
      else { atomicWrite(path, content); updated += 1; }
    } catch (error) {
      failures.push({ id: note.id || "unknown", error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (payload.errors.length === 0 && payload.notes.length === payload.expectedCount) {
    for (const [id, path] of existingById) {
      if (seenIds.has(id)) continue;
      try {
        const parsed = readMarkdown(path);
        const flags = Array.isArray(parsed.properties["source_flags"])
          ? parsed.properties["source_flags"].filter((item): item is string => typeof item === "string") : [];
        const nextFlags = [...new Set([...flags, "local-only", "deleted", "missing-from-current-export"])];
        if (!flags.includes("deleted") || !flags.includes("missing-from-current-export") || !flags.includes("local-only") || parsed.properties["local_only"] !== true || typeof parsed.properties["apple_deleted_detected_at"] !== "string") {
          atomicWrite(path, markdown({ ...parsed.properties, local_only: true, source_flags: nextFlags, apple_deleted_detected_at: new Date().toISOString() }, parsed.body));
        }
        retainedDeleted += 1;
      } catch (error) {
        failures.push({ id, error: `Unable to flag missing note: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
  const duplicateResult = flagDuplicateExportFiles(existing.duplicates);
  retainedDuplicates = duplicateResult.count;
  failures.push(...duplicateResult.failures);
  const result = {
    expected: payload.expectedCount,
    exported: payload.notes.length,
    updated,
    unchanged,
    retainedDeleted,
    retainedDuplicates,
    failed: failures.length,
    manifestPath: join(destination, ".apple-notes-export-manifest.json"),
  };
  const manifest = {
    version: 1, started_at: payload.startedAt, completed_at: new Date().toISOString(),
    complete: failures.length === 0 && payload.notes.length === payload.expectedCount,
    expected_count: payload.expectedCount, exported_count: payload.notes.length,
    updated_count: updated, unchanged_count: unchanged, retained_deleted_count: retainedDeleted, retained_duplicate_count: retainedDuplicates, failures,
  };
  atomicWrite(result.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (!manifest.complete) throw new Error(`Apple Notes export incomplete: expected ${payload.expectedCount}, received ${payload.notes.length}, failures ${failures.length}`);
  return result;
}

export function reconcileAppleNoteExportFiles(config: AppConfig): { retainedDuplicates: number } {
  const destination = join(config.vaultPath, config.appleNotesPath);
  const result = flagDuplicateExportFiles(mapExistingFiles(destination).duplicates);
  if (result.failures.length) throw new Error(`Unable to reconcile Apple Note export files: ${result.failures.map((failure) => `${failure.id}: ${failure.error}`).join("; ")}`);
  return { retainedDuplicates: result.count };
}

function flagDuplicateExportFiles(duplicates: Array<{ id: string; path: string; primaryPath: string }>): { count: number; failures: Array<{ id: string; error: string }> } {
  let count = 0;
  const failures: Array<{ id: string; error: string }> = [];
  for (const duplicate of duplicates) {
    try {
      const parsed = readMarkdown(duplicate.path);
      const flags = Array.isArray(parsed.properties["source_flags"])
        ? parsed.properties["source_flags"].filter((item): item is string => typeof item === "string") : [];
      if (!flags.includes("duplicate-export-file") || !flags.includes("local-only") || parsed.properties["local_only"] !== true || parsed.properties["duplicate_of"] !== basename(duplicate.primaryPath)) {
        atomicWrite(duplicate.path, markdown({ ...parsed.properties, local_only: true, source_flags: [...new Set([...flags, "local-only", "duplicate-export-file"])], duplicate_of: basename(duplicate.primaryPath) }, parsed.body));
      }
      count += 1;
    } catch (error) {
      failures.push({ id: duplicate.id, error: `Unable to flag duplicate export file: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { count, failures };
}

function mapExistingFiles(destination: string): { byId: Map<string, string>; duplicates: Array<{ id: string; path: string; primaryPath: string }> } {
  const pathsById = new Map<string, string[]>();
  if (!existsSync(destination)) return { byId: new Map(), duplicates: [] };
  for (const name of readdirSync(destination)) {
    if (!name.endsWith(".md")) continue;
    const path = join(destination, name);
    try {
      const id = readMarkdown(path).properties["apple_note_id"];
      if (typeof id === "string") pathsById.set(id, [...(pathsById.get(id) ?? []), path]);
    } catch (error) {
      throw new Error(`Cannot index existing Apple Notes export ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const byId = new Map<string, string>();
  const duplicates: Array<{ id: string; path: string; primaryPath: string }> = [];
  for (const [id, paths] of pathsById) {
    const suffix = `--${sha256(id).slice(0, 8)}.md`;
    const ordered = [...paths].sort();
    const primaryPath = ordered.find((path) => path.endsWith(suffix)) ?? ordered[0]!;
    byId.set(id, primaryPath);
    for (const path of ordered) if (path !== primaryPath) duplicates.push({ id, path, primaryPath });
  }
  return { byId, duplicates };
}

function requireFile(path: string): string {
  return readFileSync(path, "utf8");
}
