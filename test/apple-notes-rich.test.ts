import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { renderRichNote, type RichAppleNote } from "../src/services/apple-notes-rich.js";
import { testConfig } from "./helpers.js";

function setup(t: { after: (callback: () => void) => void }) {
  const config = testConfig();
  const root = dirname(config.vaultPath);
  const staging = join(root, "staging"); mkdirSync(join(staging, "attachments"), { recursive: true });
  const payload = join(staging, "payload.json"); writeFileSync(payload, "{}");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const note: RichAppleNote = { id: "synthetic-note", title: "Saved source", body: "", modifiedAt: "2026-01-01", hasAttachments: false, locked: false };
  return { config, staging, payload, note };
}

test("attachment-only X card URLs become visible searchable source links with preserved metadata", t => {
  const { config, payload, note } = setup(t);
  const rich = { ...note, body: "\uFFFC", hasAttachments: true, attachments: [{ id: "card", name: "Synthetic X post", url: "https://x.com/example/status/123?ref=test", exportWarning: "Preview unavailable" }] };
  const result = renderRichNote(rich, payload, config);
  assert.equal(result.complete, true);
  assert.match(result.body, /Synthetic X post/);
  assert.match(result.body, /Preview unavailable/);
  assert.match(result.body, /Remote post text was not fetched/);
  assert.deepEqual(result.properties.apple_capture_warnings, ["Synthetic X post: Preview unavailable"]);
  assert.equal(result.properties.apple_content_completeness_scope, "exposed-fields");
  assert.match(result.body, /https:\/\/x.com\/example\/status\/123\?ref=test/);
  assert.deepEqual(result.properties.source_urls, [rich.attachments[0]!.url]);
  const source = JSON.parse(readFileSync(join(config.vaultPath, result.properties.apple_source_json as string), "utf8"));
  assert.deepEqual(source, rich);
  assert.equal(renderRichNote(rich, payload, config).contentHash, result.contentHash);
});

test("HTML formatting, labeled links, deep links and tables survive while executable HTML does not render", t => {
  const { config, payload, note } = setup(t);
  const html = '<h1>Heading</h1><ul><li>First</li><li>Second <strong>bold</strong></li></ul><a href="https://example.com/?a=1&amp;b=2">Labeled</a><a href="applenotes:note/abc">Original</a><table><tr><th>Key</th><th>Value</th></tr><tr><td>One</td><td>Two</td></tr></table><table onclick="evil()"><tr><td>Headerless</td></tr></table><script>alert("secret")</script><style>hidden-style</style><a href="javascript:alert(1)">unsafe</a><img src="https://example.com/pixel.png" alt="remote">';
  const result = renderRichNote({ ...note, html }, payload, config);
  assert.match(result.body, /# Heading/); assert.match(result.body, /-\s+First/); assert.match(result.body, /\*\*bold\*\*/);
  assert.match(result.body, /\[Labeled\]\(<https:\/\/example.com\/\?a=1&b=2>\)/);
  assert.match(result.body, /applenotes:note\/abc/); assert.match(result.body, /\| Key \| Value \|/);
  assert.doesNotMatch(result.body, /alert\(|evil\(|onclick|<table|hidden-style|!\[remote\]/);
  assert.equal(result.complete, false);
  assert.equal(readFileSync(join(config.vaultPath, result.properties.apple_source_html as string), "utf8"), html);
});

test("CID images and audio map to immutable local assets; changed bytes change the note hash", t => {
  const { config, staging, payload, note } = setup(t);
  const file = join(staging, "attachments", "image.png"); writeFileSync(file, "synthetic image bytes");
  const rich = { ...note, hasAttachments: true, html: '<img src="cid:picture" alt="Figure">', attachments: [{ id: "asset", name: "Figure.png", contentIdentifier: "picture", exportedFile: "attachments/image.png" }] };
  const first = renderRichNote(rich, payload, config);
  assert.equal(first.complete, true); assert.match(first.body, /!\[Figure\]\(<Attachments\/[a-f0-9]{64}\.png>\)/);
  const assets = first.properties.apple_attachments as Array<{ vaultPath: string }>;
  assert.equal(readFileSync(join(config.vaultPath, assets[0]!.vaultPath), "utf8"), "synthetic image bytes");
  const localTargets = [...first.body.matchAll(/\]\(<((?:Attachments|Sources)\/[^>]+)>\)/g)].map(match => decodeURIComponent(match[1]!));
  assert.ok(localTargets.length >= 3);
  for (const target of localTargets) assert.ok(readFileSync(join(config.vaultPath, config.appleNotesPath, target)).length > 0);
  writeFileSync(file, "changed image bytes");
  const second = renderRichNote(rich, payload, config);
  assert.notEqual(second.contentHash, first.contentHash);
  assert.equal(readFileSync(join(config.vaultPath, assets[0]!.vaultPath), "utf8"), "synthetic image bytes");
});

test("failed and unknown attachments cannot be mistaken for a complete export", t => {
  const { config, payload, note } = setup(t);
  for (const rich of [
    { ...note, hasAttachments: true, body: "\uFFFC" },
    { ...note, html: '<img src="cid:missing">' },
    { ...note, hasAttachments: true, attachments: [{ id: "failed", name: "File", exportError: "Export unavailable" }] },
    { ...note, hasAttachments: true, attachments: [{ id: "partial", name: "URL", url: "https://example.com", contentErrors: ["Title unavailable"] }] },
  ]) {
    const result = renderRichNote(rich, payload, config);
    assert.equal(result.complete, false); assert.ok(result.errors.length);
  }
});

test("attachment traversal, symlinks and replaced immutable assets are rejected without overwrite", t => {
  const { config, staging, payload, note } = setup(t);
  writeFileSync(join(staging, "outside.txt"), "outside");
  symlinkSync(join(staging, "outside.txt"), join(staging, "attachments", "link.txt"));
  for (const exportedFile of ["attachments/../outside.txt", "attachments/link.txt", "/tmp/file", "../outside.txt"]) {
    const result = renderRichNote({ ...note, hasAttachments: true, attachments: [{ id: "bad", name: "File.txt", exportedFile }] }, payload, config);
    assert.equal(result.complete, false);
  }
  writeFileSync(join(staging, "attachments", "safe.txt"), "original");
  const rich = { ...note, hasAttachments: true, attachments: [{ id: "good", name: "File.txt", exportedFile: "attachments/safe.txt" }] };
  const first = renderRichNote(rich, payload, config);
  const asset = (first.properties.apple_attachments as Array<{ vaultPath: string }>)[0]!;
  writeFileSync(join(config.vaultPath, asset.vaultPath), "user changed");
  const retry = renderRichNote(rich, payload, config);
  assert.equal(retry.complete, false);
  assert.equal(readFileSync(join(config.vaultPath, asset.vaultPath), "utf8"), "user changed");
});

test("webloc plist URLs and cached metadata are preserved without executing or fetching the link", t => {
  const { config, staging, payload, note } = setup(t);
  writeFileSync(join(staging, "attachments", "saved.webloc"), '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>URL</key><string>https://example.com/saved</string><key>title</key><string>Cached title</string></dict></plist>');
  const result = renderRichNote({ ...note, hasAttachments: true, attachments: [{ id: "clip", name: "saved.webloc", exportedFile: "attachments/saved.webloc" }] }, payload, config);
  assert.equal(result.complete, true);
  assert.match(result.body, /https:\/\/example.com\/saved/); assert.match(result.body, /Cached title/);
});


test("plaintext absent from HTML stays searchable rather than surviving only in a sidecar", t => {
  const { config, payload, note } = setup(t);
  const result = renderRichNote({ ...note, html: "<p>Visible</p>", body: "Visible\nExtra cached text\nhttps://example.com/source" }, payload, config);
  assert.equal(result.complete, true);
  assert.match(result.body, /Extra cached text/);
  assert.ok((result.properties.source_urls as string[]).includes("https://example.com/source"));
});


test("CID URL cards retain their link without requiring an unavailable preview", t => {
  const { config, payload, note } = setup(t);
  const result = renderRichNote({ ...note, hasAttachments: true,
    html: '<p>Saved card</p><img src="cid:card"><a href="cid:card">Open card</a>',
    attachments: [{ id: "card-id", name: "Saved card title", contentIdentifier: "card", url: "https://example.com/post", exportWarning: "Preview unavailable" }],
  }, payload, config);
  assert.equal(result.complete, true);
  assert.deepEqual(result.errors, []);
  assert.match(result.body, /\[Saved card title\]\(<https:\/\/example.com\/post>\)/);
  assert.match(result.body, /\[Open card\]\(<https:\/\/example.com\/post>\)/);
  assert.doesNotMatch(result.body, /!\[|attachment unavailable|cid:card/);
  assert.match(result.body, /Preview unavailable/);
});

test("plaintext fallback and supplement keep Markdown image syntax literal", t => {
  const { config, payload, note } = setup(t);
  const body = 'Literal ![remote](https://example.com/tracker.png) and ![[Other note]] with <img src="https://example.com/pixel">';
  for (const html of [undefined, "<p>Different HTML content</p>"]) {
    const result = renderRichNote({ ...note, body, ...(html === undefined ? {} : { html }) }, payload, config);
    assert.equal(result.complete, true);
    assert.ok(result.body.includes(String.raw`\!\[remote\]`));
    assert.ok(result.body.includes(String.raw`\!\[\[Other note\]\]`));
    assert.doesNotMatch(result.body, /!\[|<img/);
    const preserved = JSON.parse(readFileSync(join(config.vaultPath, result.properties.apple_source_json as string), "utf8"));
    assert.equal(preserved.body, body);
  }
});


test("object and embed placeholders expose safe links and flag missing references", t => {
  const { config, payload, note } = setup(t);
  const result = renderRichNote({ ...note, html: '<object data="cid:card"></object><embed src="https://example.com/embed"><a href="https://example.com/empty"></a>',
    hasAttachments: true, attachments: [{ id: "card", name: "Card", url: "https://example.com/card" }],
  }, payload, config);
  assert.equal(result.complete, true);
  for (const suffix of ["card", "embed", "empty"]) assert.ok(result.body.includes(`https://example.com/${suffix}`));
  assert.doesNotMatch(result.body, /<object|<embed/);
  const missing = renderRichNote({ ...note, html: '<object data="cid:missing"></object>' }, payload, config);
  assert.equal(missing.complete, false);
  assert.ok(missing.errors.includes("Unresolved HTML media reference"));
});
