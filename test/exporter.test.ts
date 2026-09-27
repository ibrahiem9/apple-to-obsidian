import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { applyAppleNotesExport } from "../src/services/apple-notes-export.js";
import { readMarkdown, sha256 } from "../src/files.js";
import { testConfig } from "./helpers.js";

function payload(notes: unknown[], errors: string[] = []) {
  return { startedAt: new Date(0).toISOString(), expectedCount: notes.length, notes, errors };
}

test("Apple Notes export is atomic, idempotent, Unicode-safe, and reuses paths after title changes", t => {
  const config = testConfig();
  t.after(() => rmSync(dirname(config.vaultPath), { recursive: true, force: true }));
  const input = join(config.vaultPath, "payload.json");
  writeFileSync(join(config.vaultPath, config.appleNotesPath, "Legacy export.md"), "# Legacy export\n\nPreserved but not canonical after hardened export.");
  writeFileSync(join(config.vaultPath, config.appleNotesPath, "Removed--old.md"), "---\napple_note_id: apple-removed\nsource_flags: []\n---\n\n# Removed\n\nPreserve me.\n");
  const notes = [
    { id: "apple-1", title: "Same / 🧠", body: "first", modifiedAt: "2026-01-01T00:00:00Z", account: "iCloud", folder: "Ideas", hasAttachments: false, locked: false },
    { id: "apple-2", title: "Same / 🧠", body: "", modifiedAt: "2026-01-02T00:00:00Z", account: "iCloud", folder: "Recently Deleted", hasAttachments: true, locked: true },
  ];
  writeFileSync(input, JSON.stringify(payload(notes)));
  const first = applyAppleNotesExport(config, input);
  assert.equal(first.updated, 2);
  const files = readdirSync(join(config.vaultPath, config.appleNotesPath)).filter((name) => name.endsWith(".md"));
  assert.equal(files.length, 4);
  assert.equal(first.retainedDeleted, 1);
  assert.notEqual(files[0], files[1]);
  const firstPath = join(config.vaultPath, config.appleNotesPath, files.find((name) => readMarkdown(join(config.vaultPath, config.appleNotesPath, name)).properties["apple_note_id"] === "apple-1")!);
  writeFileSync(join(config.vaultPath, config.appleNotesPath, "Duplicate old export.md"), readFileSync(firstPath));
  const secondRun = applyAppleNotesExport(config, input);
  assert.equal(secondRun.unchanged, 2);
  assert.equal(secondRun.retainedDuplicates, 1);
  notes[0] = { ...notes[0]!, title: "Renamed title" };
  writeFileSync(input, JSON.stringify(payload(notes)));
  applyAppleNotesExport(config, input);
  assert.ok(existsSync(firstPath));
  assert.match(readFileSync(firstPath, "utf8"), /# Renamed title/);
  const flagged = readdirSync(join(config.vaultPath, config.appleNotesPath)).map((name) => join(config.vaultPath, config.appleNotesPath, name)).filter((path) => path.endsWith(".md")).map(readMarkdown).find((note) => note.properties["apple_note_id"] === "apple-2")!;
  assert.deepEqual(flagged.properties["source_flags"], ["local-only", "locked", "deleted", "attachment-only"]);
  assert.equal(flagged.properties["content_hash"], sha256(""));
  assert.equal(flagged.properties["local_only"], true);
  assert.ok((readMarkdown(join(config.vaultPath, config.appleNotesPath, "Duplicate old export.md")).properties["source_flags"] as string[]).includes("duplicate-export-file"));
  assert.deepEqual(readMarkdown(join(config.vaultPath, config.appleNotesPath, "Removed--old.md")).properties["source_flags"], ["local-only", "deleted", "missing-from-current-export"]);
});

test("Apple Notes export writes an incomplete manifest and exits through an error on export failure", t => {
  const config = testConfig();
  t.after(() => rmSync(dirname(config.vaultPath), { recursive: true, force: true }));
  const input = join(config.vaultPath, "failed.json");
  writeFileSync(input, JSON.stringify({ ...payload([], ["Operation not permitted"]), expectedCount: 1 }));
  assert.throws(() => applyAppleNotesExport(config, input), /incomplete/);
  const manifest = JSON.parse(readFileSync(join(config.vaultPath, config.appleNotesPath, ".apple-notes-export-manifest.json"), "utf8"));
  assert.equal(manifest.complete, false);
  assert.equal(manifest.failures.length, 1);
});

test("long Arabic and Urdu titles retain full note headings while filenames fit filesystem limits", t => {
  const config = testConfig();
  t.after(() => rmSync(dirname(config.vaultPath), { recursive: true, force: true }));
  const titles = ["عنوان طويل باللغة العربية ".repeat(25), "یہ اردو میں ایک لمبا عنوان ہے ".repeat(25)];
  const input = join(config.vaultPath, "long-titles.json");
  const notes = titles.map((title, index) => ({ id: `long-title-${index}`, title, body: "Synthetic body", modifiedAt: new Date(0).toISOString(), hasAttachments: false, locked: false }));
  writeFileSync(input, JSON.stringify(payload(notes)));
  assert.equal(applyAppleNotesExport(config, input).updated, 2);
  const destination = join(config.vaultPath, config.appleNotesPath);
  const names = readdirSync(destination).filter(name => name.endsWith(".md"));
  assert.equal(names.length, 2);
  for (const name of names) {
    // Atomic publication appends a temporary-file suffix before rename.
    assert.ok(Buffer.byteLength(name, "utf8") <= 170);
    const note = readMarkdown(join(destination, name));
    const original = notes.find(item => item.id === note.properties["apple_note_id"])!;
    assert.ok(note.body.includes(`# ${original.title}\n`));
    assert.ok(!name.includes("\uFFFD"));
  }
  assert.equal(applyAppleNotesExport(config, input).unchanged, 2);
});
