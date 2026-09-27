import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { AppConfig } from "../types.js";
import { atomicWrite, markdown, readMarkdown, safeFilename, sha256 } from "../files.js";

import { publishAppleNoteArtifact, renderRichNote, type RichAppleNote } from "./apple-notes-rich.js";

type ExportedAppleNote = RichAppleNote;

interface AppleNotesPayload {
  exportFormatVersion?: number;
  exportLimit?: number;
  inventoryOnly?: boolean;
  startedAt: string;
  expectedCount: number;
  notes: ExportedAppleNote[];
  errors: string[];
}

export function applyAppleNotesExport(config: AppConfig, payloadPath: string): { expected: number; exported: number; updated: number; unchanged: number; retainedDeleted: number; retainedDuplicates: number; failed: number; manifestPath: string } {
  const payload = JSON.parse(requireFile(payloadPath)) as AppleNotesPayload;
  if (!Array.isArray(payload.notes) || !Array.isArray(payload.errors) || !Number.isSafeInteger(payload.expectedCount) || payload.expectedCount < 0) throw new Error("Malformed Apple Notes export payload");
  if (payload.exportLimit !== undefined) throw new Error("Diagnostic limited exports cannot publish into a vault");
  if (payload.inventoryOnly) throw new Error("Inventory-only exports cannot publish into a vault");
  if (payload.exportFormatVersion !== undefined && payload.exportFormatVersion !== 2) throw new Error("Unsupported Apple Notes export format");
  const identifiers = payload.notes.map(note => note.id).filter(Boolean);
  if (new Set(identifiers).size !== identifiers.length) throw new Error("Duplicate Apple Notes source IDs in export");
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
      if (/recently deleted|deleted/i.test(note.folder ?? "")) flags.push("deleted");
      const meaningfulBody = note.body.replace(/\uFFFC/g, "").trim();
      if (!meaningfulBody) flags.push(note.hasAttachments ? "attachment-only" : "blank");
      const suffix = sha256(note.id).slice(0, 8);
      const path = existingById.get(note.id) ?? join(destination, `${safeFilename(note.title)}--${suffix}.md`);
      const rich = payload.exportFormatVersion === 2 || note.hasAttachments || /\uFFFC/.test(note.body)
        ? renderRichNote(note, payloadPath, config) : undefined;
      const errors = [...(rich?.errors ?? []), ...(note.exportError ? ["note-content-unavailable"] : [])];
      if (errors.length) {
        flags.push("incomplete-content", "export-error");
        failures.push({ id: note.id, error: "Note content or attachments could not be completely exported" });
        // Never replace a richer prior copy with a thinner or incomplete export.
        if (existsSync(path)) continue;
      }
      const properties: Record<string, unknown> = {
        source: "apple-notes", local_only: true, apple_note_id: note.id, apple_modified_iso: note.modifiedAt,
        apple_account: note.account ?? null, apple_folder: note.folder ?? null,
        has_attachments: note.hasAttachments, content_hash: rich?.contentHash ?? sha256(note.body), source_flags: flags,
        ...(rich?.properties ?? {}),
        apple_export_format_version: rich ? 2 : 1,
        apple_content_complete: errors.length === 0,
      };
      if (note.createdAt) properties["apple_created_iso"] = note.createdAt;
      if (errors.length) properties["export_errors"] = errors;
      let body = rich?.body ?? note.body;
      if (!body.startsWith(`# ${note.title}\n`)) body = `# ${note.title || "Untitled"}\n\n${body}`;
      if (errors.length) body = `> Import incomplete: some content or attachments could not be exported. The source remains in Apple Notes.\n\n${body}`;
      const preserved = new Set<string>();
      if (existsSync(path)) {
        const previous = readMarkdown(path);
        for (const value of Array.isArray(previous.properties["apple_preserved_copies"]) ? previous.properties["apple_preserved_copies"] : []) {
          if (typeof value === "string") preserved.add(value);
        }
        const baseChanged = previous.properties["content_hash"] !== properties["content_hash"] || previous.properties["apple_export_format_version"] !== properties["apple_export_format_version"];
        const { apple_export_content_hash: previousExportHash, ...previousMetadata } = previous.properties;
        const wasEdited = typeof previousExportHash === "string"
          ? previousExportHash !== sha256(markdown(previousMetadata, previous.body))
          : previous.properties["apple_export_body_hash"] !== sha256(previous.body.trim());
        // Preserve legacy/backfilled copies and externally edited content before
        // a complete rich export replaces them. Normal generated updates stay lean.
        if (rich && (wasEdited || (baseChanged && previous.properties["apple_export_format_version"] !== 2))) {
          const { apple_note_id: _id, ...metadata } = previous.properties;
          // Generated local assets remain clickable from the Preserved subfolder.
          // Retain the original Markdown too, including arbitrary user link syntax.
          const original = publishAppleNoteArtifact(config, "Sources", Buffer.from(requireFile(path)), ".md.txt");
          const backupBody = previous.body.replace(/\]\(<((?:Sources|Attachments)\/[a-f0-9]{64}\.[a-z0-9.]+)>\)/g, "](<../$1>)");
          const backup = markdown({ ...metadata, kind: "apple-notes-preserved", local_only: true, apple_original_note_id: note.id,
            apple_original_path: relative(config.vaultPath, path), apple_original_markdown: original.vaultPath,
            source_flags: ["local-only", "preserved-export"] }, backupBody);
          const snapshot = publishAppleNoteArtifact(config, "Preserved", Buffer.from(backup), ".md");
          preserved.add(snapshot.vaultPath);
        }
      }
      if (preserved.size) {
        properties["apple_preserved_copies"] = [...preserved].sort();
        body += `\n\n## Preserved earlier copies\n\n${[...preserved].sort().map(value => `- [[${value.replace(/\.md$/, "")}]]`).join("\n")}`;
      }
      properties["apple_export_body_hash"] = sha256(body.trim());
      properties["apple_export_content_hash"] = sha256(markdown(properties, body));
      const content = markdown(properties, body);
      if (existsSync(path) && requireFile(path) === content) unchanged += 1;
      else { atomicWrite(path, content); updated += 1; }
    } catch (error) {
      failures.push({ id: note.id || "unknown", error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failures.length === 0 && payload.notes.length === payload.expectedCount) {
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
