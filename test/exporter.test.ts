import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { applyAppleNotesExport } from "../src/services/apple-notes-export.js";
import { readMarkdown, sha256 } from "../src/files.js";
import { testConfig } from "./helpers.js";
import type { RichAppleNote } from "../src/services/apple-notes-rich.js";

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
    { id: "apple-2", title: "Same / 🧠", body: "", modifiedAt: "2026-01-02T00:00:00Z", account: "iCloud", folder: "Recently Deleted", hasAttachments: false, locked: true },
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
  assert.deepEqual(flagged.properties["source_flags"], ["local-only", "locked", "deleted", "blank"]);
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

function richNote(overrides: Partial<RichAppleNote> = {}): RichAppleNote {
  return {
    id: "synthetic-rich-note", title: "Saved research", body: "Saved research", html: "<p>Saved research</p>",
    createdAt: "2026-01-01T00:00:00Z", modifiedAt: "2026-01-02T00:00:00Z",
    account: "Example account", accountId: "example-account-id", folder: "Research", folderId: "example-folder-id",
    shared: false, locked: false, hasAttachments: false, attachments: [], ...overrides,
  };
}

function richFixture(t: TestContext) {
  const config = testConfig();
  t.after(() => rmSync(dirname(config.vaultPath), { recursive: true, force: true }));
  const input = join(config.vaultPath, "payload.json");
  const destination = join(config.vaultPath, config.appleNotesPath);
  const publish = (note: RichAppleNote) => {
    writeFileSync(input, JSON.stringify({ ...payload([note]), exportFormatVersion: 2 }));
    return applyAppleNotesExport(config, input);
  };
  const notePath = () => join(destination, readdirSync(destination).find(name => name.endsWith(".md"))!);
  return { config, input, destination, publish, notePath };
}

test("rich export retains URL cards, explicit deep links, metadata, and original source", t => {
  const fixture = richFixture(t);
  const note = richNote({
    body: "Saved research\n\uFFFC", hasAttachments: true,
    html: '<p>Saved research <a href="https://example.test/reference?a=1&amp;b=2">Reference</a></p>',
    sourceDeepLink: "applenotes:note/example-source-id",
    attachments: [{ id: "card-1", name: "Saved post title", contentIdentifier: "card-content-id", url: "https://x.com/example/status/123", exportWarning: "link-preview-export-unavailable" }],
  });
  assert.equal(fixture.publish(note).updated, 1);
  const saved = readMarkdown(fixture.notePath());
  assert.match(saved.body, /Saved post title/);
  assert.match(saved.body, /https:\/\/x\.com\/example\/status\/123/);
  assert.match(saved.body, /applenotes:note\/example-source-id/);
  assert.deepEqual(new Set(saved.properties["source_urls"] as string[]), new Set([
    "https://example.test/reference?a=1&b=2", "https://x.com/example/status/123", "applenotes:note/example-source-id",
  ]));
  assert.equal(saved.properties["apple_account_id"], note.accountId);
  assert.equal(saved.properties["apple_folder_id"], note.folderId);
  assert.equal(saved.properties["apple_created_iso"], note.createdAt);
  assert.equal(saved.properties["apple_content_complete"], true);
  assert.ok((saved.properties["apple_capture_warnings"] as string[]).length > 0);
  const attachments = saved.properties["apple_attachments"] as Record<string, unknown>[];
  assert.equal(attachments[0]!["contentIdentifier"], "card-content-id");
  const source = join(fixture.config.vaultPath, saved.properties["apple_source_json"] as string);
  assert.deepEqual(JSON.parse(readFileSync(source, "utf8")), note);
  assert.equal(readFileSync(join(fixture.config.vaultPath, saved.properties["apple_source_html"] as string), "utf8"), note.html);
  assert.equal(fixture.publish(note).unchanged, 1);
});

test("attachment byte changes publish a new immutable copy and change the note hash", t => {
  const fixture = richFixture(t);
  const staged = join(fixture.config.vaultPath, "attachments");
  mkdirSync(staged);
  const attachmentPath = join(staged, "document.pdf");
  writeFileSync(attachmentPath, "synthetic original bytes");
  const note = richNote({ hasAttachments: true, attachments: [{ id: "document-1", name: "document.pdf", exportedFile: "attachments/document.pdf" }] });
  fixture.publish(note);
  const before = readMarkdown(fixture.notePath());
  const oldAttachment = (before.properties["apple_attachments"] as Record<string, unknown>[])[0]!;
  writeFileSync(attachmentPath, "synthetic replacement bytes");
  assert.equal(fixture.publish(note).updated, 1);
  const after = readMarkdown(fixture.notePath());
  const newAttachment = (after.properties["apple_attachments"] as Record<string, unknown>[])[0]!;
  assert.notEqual(before.properties["content_hash"], after.properties["content_hash"]);
  assert.notEqual(oldAttachment["vaultPath"], newAttachment["vaultPath"]);
  assert.equal(readFileSync(join(fixture.config.vaultPath, oldAttachment["vaultPath"] as string), "utf8"), "synthetic original bytes");
  assert.equal(readFileSync(join(fixture.config.vaultPath, newAttachment["vaultPath"] as string), "utf8"), "synthetic replacement bytes");
  assert.equal(fixture.publish(note).unchanged, 1);
});

test("an incomplete update leaves the existing note byte-for-byte intact and records failure", t => {
  const fixture = richFixture(t);
  fixture.publish(richNote());
  const before = readFileSync(fixture.notePath());
  assert.throws(() => fixture.publish(richNote({
    html: "<p>Thinner export</p>", body: "Thinner export\n\uFFFC", hasAttachments: true,
    attachments: [{ id: "missing-document", name: "scan.pdf", exportError: "attachment-export-unavailable" }],
  })), /incomplete/);
  assert.deepEqual(readFileSync(fixture.notePath()), before);
  const manifest = JSON.parse(readFileSync(join(fixture.destination, ".apple-notes-export-manifest.json"), "utf8"));
  assert.equal(manifest.complete, false);
  assert.equal(manifest.updated_count, 0);
  assert.equal(manifest.failures.length, 1);
});

test("legacy backfilled content and later user edits each survive replacement in linked snapshots", t => {
  const fixture = richFixture(t);
  const note = richNote();
  const path = join(fixture.destination, "Existing backfill.md");
  const legacyBody = "# Recovered source\n\nManually recovered source https://example.test/backfill and original commentary.";
  writeFileSync(path, `---\napple_note_id: ${note.id}\ncustom_metadata: preserve-this\n---\n\n${legacyBody}\n`);
  fixture.publish(note);
  const first = readMarkdown(path);
  const firstCopies = first.properties["apple_preserved_copies"] as string[];
  assert.equal(firstCopies.length, 1);
  const firstCopy = readMarkdown(join(fixture.config.vaultPath, firstCopies[0]!));
  assert.equal(firstCopy.body.trim(), legacyBody);
  assert.equal(firstCopy.properties["custom_metadata"], "preserve-this");
  assert.equal(firstCopy.properties["apple_original_note_id"], note.id);
  assert.equal(firstCopy.properties["apple_note_id"], undefined);
  assert.ok(first.body.includes(firstCopies[0]!.replace(/\.md$/, "")));
  assert.equal(fixture.publish(note).unchanged, 1);
  assert.equal(readdirSync(join(fixture.destination, "Preserved")).length, 1);

  writeFileSync(path, `${readFileSync(path, "utf8")}\nUser-added analysis and https://example.test/user-link\n`);
  const editedOriginal = readFileSync(path, "utf8");
  const revised = richNote({ body: "New source content", html: "<p>New source content</p>", modifiedAt: "2026-01-03T00:00:00Z" });
  fixture.publish(revised);
  const latest = readMarkdown(path);
  const copies = latest.properties["apple_preserved_copies"] as string[];
  assert.equal(copies.length, 2);
  assert.ok(copies.includes(firstCopies[0]!));
  const editedCopy = readMarkdown(join(fixture.config.vaultPath, copies.find(copy => !firstCopies.includes(copy))!));
  assert.match(editedCopy.body, /User-added analysis and https:\/\/example.test\/user-link/);
  assert.equal(readFileSync(join(fixture.config.vaultPath, editedCopy.properties["apple_original_markdown"] as string), "utf8"), editedOriginal);
  for (const match of editedCopy.body.matchAll(/\]\(<(\.\.\/(?:Sources|Attachments)\/[^>]+)>\)/g)) {
    assert.ok(existsSync(join(fixture.destination, "Preserved", match[1]!)));
  }
  assert.match(latest.body, /New source content/);
  assert.equal(fixture.publish(revised).unchanged, 1);
  assert.equal(readdirSync(join(fixture.destination, "Preserved")).length, 2);

  const unchangedBody = readMarkdown(path).body;
  writeFileSync(path, readFileSync(path, "utf8").replace(/^---\n/, "---\nuser_tags: [reviewed, important]\n"));
  const metadataOriginal = readFileSync(path, "utf8");
  assert.equal(readMarkdown(path).body, unchangedBody);
  assert.equal(fixture.publish(revised).updated, 1);
  const metadataCopies = readMarkdown(path).properties["apple_preserved_copies"] as string[];
  assert.equal(metadataCopies.length, 3);
  const metadataCopy = metadataCopies.find(copy => !copies.includes(copy))!;
  const metadataSnapshot = readMarkdown(join(fixture.config.vaultPath, metadataCopy));
  assert.deepEqual(metadataSnapshot.properties["user_tags"], ["reviewed", "important"]);
  assert.equal(readFileSync(join(fixture.config.vaultPath, metadataSnapshot.properties["apple_original_markdown"] as string), "utf8"), metadataOriginal);
  assert.equal(fixture.publish(revised).unchanged, 1);
  assert.equal(readdirSync(join(fixture.destination, "Preserved")).length, 3);
});

test("limited diagnostic captures are rejected before publishing or flagging existing notes deleted", t => {
  const fixture = richFixture(t);
  fixture.publish(richNote());
  const before = readFileSync(fixture.notePath());
  const manifestPath = join(fixture.destination, ".apple-notes-export-manifest.json");
  const manifestBefore = readFileSync(manifestPath);
  writeFileSync(fixture.input, JSON.stringify({ ...payload([]), exportFormatVersion: 2, exportLimit: 1 }));
  assert.throws(() => applyAppleNotesExport(fixture.config, fixture.input), /Diagnostic limited exports/);
  assert.deepEqual(readFileSync(fixture.notePath()), before);
  assert.deepEqual(readFileSync(manifestPath), manifestBefore);
  for (const invalid of [
    { ...payload([]), inventoryOnly: true },
    { ...payload([]), exportFormatVersion: 99 },
    { ...payload([richNote(), richNote()]), exportFormatVersion: 2 },
  ]) {
    writeFileSync(fixture.input, JSON.stringify(invalid));
    assert.throws(() => applyAppleNotesExport(fixture.config, fixture.input));
    assert.deepEqual(readFileSync(fixture.notePath()), before);
    assert.deepEqual(readFileSync(manifestPath), manifestBefore);
  }
});
