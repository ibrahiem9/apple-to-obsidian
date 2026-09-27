import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { readMarkdown } from "../src/files.js";
import { appleNotesScheduledDay, appleNotesStatus, checkAppleNotes, syncAppleNotes } from "../src/services/apple-notes.js";
import { testConfig } from "./helpers.js";

function fixture(body = "Synthetic fixture", errors: string[] = []) {
  return { startedAt: new Date(0).toISOString(), expectedCount: 1, errors, notes: [{ id: "synthetic-1", title: "Example اردو", body, modifiedAt: new Date(0).toISOString(), hasAttachments: false, locked: false }] };
}
function exporter(value = fixture()) { return { exportNotes: async (path: string) => { writeFileSync(path, JSON.stringify(value)); } }; }

test("Apple Notes access and dry-run inventory publish no notes and do not satisfy schedule", async t => {
  const config = testConfig();
  t.after(() => rmSync(dirname(config.vaultPath), { recursive: true, force: true }));
  let inventoryRequests = 0;
  const deps = { exportNotes: async (path: string, options: { inventoryOnly: boolean }) => {
    assert.equal(options.inventoryOnly, true); inventoryRequests += 1;
    writeFileSync(path, JSON.stringify({ ...fixture(), notes: [], inventoryOnly: true }));
  } };
  assert.deepEqual(await checkAppleNotes(config, deps), { accessible: true, expected: 1 });
  const summary = await syncAppleNotes(config, { dryRun: true }, deps);
  assert.equal(summary.expected, 1);
  assert.equal(summary.updated, 0);
  assert.equal(inventoryRequests, 2);
  assert.deepEqual(readdirSync(join(config.vaultPath, config.appleNotesPath)), []);
  assert.equal(appleNotesStatus(config).scheduledDay, null);
});

test("successful manual Apple Notes import satisfies current nightly period and next night catches up once", async t => {
  const config = testConfig();
  t.after(() => rmSync(dirname(config.vaultPath), { recursive: true, force: true }));
  const deps = exporter();
  const now = new Date(2026, 0, 3, 8);
  const first = await syncAppleNotes(config, { now }, deps);
  assert.equal(first.updated, 1);
  assert.equal((await syncAppleNotes(config, { now, scheduled: true }, deps)).skipped, 1);
  const next = new Date(2026, 0, 4, 9);
  assert.equal((await syncAppleNotes(config, { now: next, scheduled: true }, deps)).unchanged, 1);
  assert.equal((await syncAppleNotes(config, { now: next, scheduled: true }, deps)).skipped, 1);
  assert.equal(appleNotesStatus(config).scheduledDay, "2026-01-04");
});

test("Apple Notes schedule respects local hour across year rollover", () => {
  assert.equal(appleNotesScheduledDay(new Date(2026, 0, 1, 1, 59), 2), "2025-12-31");
  assert.equal(appleNotesScheduledDay(new Date(2026, 0, 1, 2), 2), "2026-01-01");
});

test("concurrent Apple Notes manual and scheduled imports share a lock that releases after failure", async t => {
  const config = testConfig();
  t.after(() => rmSync(dirname(config.vaultPath), { recursive: true, force: true }));
  let started!: () => void;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const released = new Promise<void>(resolve => { finish = resolve; });
  const first = syncAppleNotes(config, {}, { exportNotes: async () => { started(); await released; throw new Error("private source detail"); } });
  await ready;
  await assert.rejects(syncAppleNotes(config, { scheduled: true }, exporter()), /Another Apple Notes import/);
  finish();
  await assert.rejects(first, /Check Notes Automation permission/);
  assert.equal((await syncAppleNotes(config, {}, exporter())).updated, 1);
});

test("permission and malformed payload errors remain sanitized, persist failure, and retry on same day", async t => {
  const config = testConfig();
  t.after(() => rmSync(dirname(config.vaultPath), { recursive: true, force: true }));
  const privateMessage = "PRIVATE ACCOUNT TITLE /Users/private/vault";
  await assert.rejects(checkAppleNotes(config, { exportNotes: async () => { throw new Error(privateMessage); } }), error => {
    assert.ok(error instanceof Error); assert.ok(!error.message.includes(privateMessage)); return true;
  });
  for (const value of ["not json", JSON.stringify({ ...fixture(), notes: [], errors: [privateMessage] })]) {
    await assert.rejects(syncAppleNotes(config, { scheduled: true }, { exportNotes: async path => { writeFileSync(path, value); } }), /Check Notes Automation permission/);
    const status = appleNotesStatus(config);
    assert.equal(status.lastRun?.failed, 1);
    assert.equal(status.scheduledDay, null);
    assert.equal(status.diagnosticsAvailable, true);
    assert.ok(!JSON.stringify(status).includes(privateMessage));
  }
  assert.equal((await syncAppleNotes(config, { scheduled: true }, exporter())).updated, 1);
  assert.equal(appleNotesStatus(config).diagnosticsAvailable, false);
});

test("Apple Notes copies remain source-managed while deleted source copies remain locally flagged", async t => {
  const config = testConfig();
  t.after(() => rmSync(dirname(config.vaultPath), { recursive: true, force: true }));
  await syncAppleNotes(config, {}, exporter());
  const folder = join(config.vaultPath, config.appleNotesPath);
  const note = join(folder, readdirSync(folder).find(name => name.endsWith(".md"))!);
  writeFileSync(note, readFileSync(note, "utf8").replace("Synthetic fixture", "Local edit"));
  assert.equal((await syncAppleNotes(config, {}, exporter(fixture("Source update")))).updated, 1);
  assert.match(readMarkdown(note).body, /Source update/);
  await syncAppleNotes(config, {}, { exportNotes: async path => { writeFileSync(path, JSON.stringify({ ...fixture(), expectedCount: 0, notes: [] })); } });
  const retained = readMarkdown(note);
  assert.match(retained.body, /Source update/);
  assert.equal(retained.properties["local_only"], true);
  assert.ok((retained.properties["source_flags"] as string[]).includes("missing-from-current-export"));
});

test("unreadable plaintext retains a prior successful copy and leaves scheduled run retryable", async t => {
  const config = testConfig();
  t.after(() => rmSync(dirname(config.vaultPath), { recursive: true, force: true }));
  await syncAppleNotes(config, { now: new Date(2026, 0, 1, 8) }, exporter());
  const broken = fixture("");
  Object.assign(broken.notes[0]!, { exportError: "Unreadable" });
  await assert.rejects(syncAppleNotes(config, { scheduled: true, now: new Date(2026, 0, 2, 8) }, exporter(broken)), /export failed/);
  const folder = join(config.vaultPath, config.appleNotesPath);
  const note = join(folder, readdirSync(folder).find(name => name.endsWith(".md"))!);
  assert.match(readMarkdown(note).body, /Synthetic fixture/);
  assert.equal(appleNotesStatus(config).scheduledDay, "2026-01-01");
});
