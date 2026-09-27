import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("fresh configuration is machine independent and supports paths with spaces and Unicode", t => {
  const root = mkdtempSync(join(tmpdir(), "config 空間 "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "config.json");
  assert.throws(() => loadConfig(path), /setup/);
  writeFileSync(path, '{}');
  assert.throws(() => loadConfig(path), /vaultPath/);
  writeFileSync(path, JSON.stringify({vaultPath:"Vault 空間", appPath:"Apps/Apple to Obsidian.app"}));
  const config = loadConfig(path);
  assert.equal(config.vaultPath, join(root, "Vault 空間"));
  assert.equal(config.appPath, join(root, "Apps/Apple to Obsidian.app"));
  assert.equal(config.voiceMemos.helperPath, join(config.appPath, "Contents/MacOS/voice-memos"));
  assert.equal(config.voiceMemos.segmentation, "single-language");
  assert.equal(config.voiceMemos.language, "auto");
  assert.equal(config.appleNotes.nightlyHour, 2);
  assert.equal(config.voiceMemos.nightlyHour, 3);
  assert.equal(config.statePath, join(root, "notes.sqlite"));
});

test("config rejects unsupported modes, remote paths, shared state and escaped output folders", t => {
  const root = mkdtempSync(join(tmpdir(), "config-validation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "config.json");
  for (const change of [
    { voiceMemos: { segmentation: "language-aware" } }, { voiceMemos: { language: "hi" } },
    { voiceMemos: { segmentSeconds: 31 } }, { appleNotes: { nightlyHour: 24 } },
    { appleNotesPath: "../escape" }, { voiceMemos: { outputPath: "/outside" } },
    { vaultPath: "https://example.invalid/vault" }, { voiceMemos: { statePath: "notes.sqlite" } },
  ]) {
    writeFileSync(path, JSON.stringify({ vaultPath:"vault", ...change }));
    assert.throws(() => loadConfig(path));
  }
});
