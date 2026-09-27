import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../scripts/export-apple-notes.jxa", import.meta.url), "utf8");
const date = "2026-01-01T00:00:00.000Z";
function attachment(overrides: Record<string, unknown> = {}) {
  return { id: () => "attachment-id", name: () => "../../private/photo.PNG", contentIdentifier: () => "cid:fixture-image", url: () => "", creationDate: () => date, modificationDate: () => date, shared: () => false, ...overrides };
}
function note(overrides: Record<string, unknown> = {}) {
  return { id: () => "x-coredata://fixture/ICNote/p1", name: () => "Fixture", plaintext: () => "A shared post [Attachment]", body: () => '<div>A <a href="https://example.test/post">shared post</a><img src="cid:fixture-image"></div>', container: () => ({ name: () => "Folder", id: () => "folder-id" }), creationDate: () => date, modificationDate: () => date, shared: () => true, passwordProtected: () => false, attachments: () => [attachment()], ...overrides };
}
function capture(notes: ReturnType<typeof note>[], args = ["--attachments-dir", "/private/staging/attachments"], saveFails = false, exists = true) {
  const saved: string[] = [];
  const app = { accounts: () => [{ name: () => "Account", id: () => "account-id", notes: () => notes }], save: (_value: unknown, options: { in: string }) => {
    saved.push(options.in);
    if (saveFails) throw new Error("private source detail");
  } };
  const context = vm.createContext({ ObjC: { import: () => {} }, Application: () => app, Path: (value: string) => value, $: { NSFileManager: { defaultManager: { fileExistsAtPath: () => exists } } }, args });
  vm.runInContext(source, context);
  const output = JSON.parse(vm.runInContext("run(args)", context));
  return { output, saved };
}

test("Notes capture keeps HTML links, source metadata, and saves attachments without using source names as paths", () => {
  const { output, saved } = capture([note()]);
  assert.equal(output.exportFormatVersion, 2);
  const item = output.notes[0];
  assert.match(item.html, /href="https:\/\/example.test\/post"/);
  assert.equal(item.body, "A shared post [Attachment]");
  assert.equal(item.id, "x-coredata://fixture/ICNote/p1");
  assert.equal(item.accountId, "account-id");
  assert.equal(item.folderId, "folder-id");
  assert.equal(item.shared, true);
  assert.equal(item.attachments[0].contentIdentifier, "cid:fixture-image");
  assert.equal(item.attachments[0].exportedFile, "attachments/note-0-attachment-0.png");
  assert.deepEqual(saved, ["/private/staging/attachments/note-0-attachment-0.png"]);
  assert.deepEqual(item.contentErrors, []);
});

test("Notes URL cards retain their URL even when Notes cannot export the preview", () => {
  const { output } = capture([note({ attachments: () => [attachment({ url: () => "https://x.example.test/post/1" })] })], undefined, true);
  const card = output.notes[0].attachments[0];
  assert.equal(card.url, "https://x.example.test/post/1");
  assert.equal(card.exportedFile, undefined);
  assert.equal(card.exportWarning, "link-preview-export-unavailable");
  assert.equal(card.exportError, undefined);
  assert.doesNotMatch(JSON.stringify(output), /private source detail/);
});

test("Notes capture reports inaccessible HTML and unknown attachments instead of successful empty content", () => {
  const inaccessible = () => { throw new Error("private source detail"); };
  const { output } = capture([note({ body: inaccessible, attachments: inaccessible })]);
  assert.equal(output.notes[0].hasAttachments, true);
  assert.deepEqual(output.notes[0].contentErrors, ["note-html-unavailable", "note-attachments-unavailable"]);
  assert.doesNotMatch(JSON.stringify(output), /private source detail/);
});

test("Notes capture reports failed binary saves and missing save output", () => {
  for (const [fails, exists] of [[true, true], [false, false]]) {
    const { output } = capture([note()], undefined, fails, exists);
    assert.equal(output.notes[0].attachments[0].exportError, "attachment-export-unavailable");
    assert.equal(output.notes[0].attachments[0].exportedFile, undefined);
  }
});

test("Notes inventory reads only counts and does not capture or export content", () => {
  const inaccessible = () => { throw new Error("content must not be read"); };
  const { output, saved } = capture([note({ body: inaccessible, plaintext: inaccessible, attachments: inaccessible })], ["--inventory"]);
  assert.equal(output.expectedCount, 1);
  assert.deepEqual(output.notes, []);
  assert.deepEqual(output.errors, []);
  assert.deepEqual(saved, []);
});

test("Notes capture requires an absolute staging directory and distinguishes missing source identity", () => {
  assert.deepEqual(capture([note()], []).output.errors, ["attachment-staging-unavailable"]);
  const { output } = capture([note({ id: () => { throw new Error("private"); } })]);
  assert.equal(output.notes[0].id, "");
  assert.equal(output.notes[0].exportError, "note-content-unavailable");
  assert.ok(output.notes[0].contentErrors.includes("note-id-unavailable"));
});

test("limited diagnostic capture exports only the requested notes but keeps full inventory count", () => {
  const { output, saved } = capture([note(), note(), note()], ["--attachments-dir", "/private/staging/attachments", "--limit", "2"]);
  assert.equal(output.expectedCount, 3);
  assert.equal(output.exportLimit, 2);
  assert.equal(output.notes.length, 2);
  assert.equal(saved.length, 2);
  assert.deepEqual(capture([note()], ["--attachments-dir", "/private/staging/attachments", "--limit", "bad"]).output.errors, ["invalid-export-limit"]);
});
