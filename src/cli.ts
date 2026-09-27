#!/usr/bin/env node
import { mkdirSync, existsSync, linkSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { atomicWrite } from "./files.js";
import { checkVoiceMemos, syncVoiceMemos, voiceMemosStatus } from "./services/voice-memos.js";
import { checkAppleNotes, syncAppleNotes, appleNotesStatus } from "./services/apple-notes.js";

process.umask(0o077);
const help = `apple-to-obsidian [--config FILE] COMMAND

Commands:
  apple-notes-check
  apple-notes-sync [--dry-run] [--scheduled]
  apple-notes-status
  voice-memos-check
  voice-memos-sync [--dry-run] [--limit N] [--retry ID] [--language auto|en|ar|ur] [--scheduled]
  voice-memos-status

Use scripts/run for installed-app permissions. Each voice memo must use one language.
`;
function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}
function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const configPath = option(args, "--config");
  if (configPath) args.splice(args.indexOf("--config"), 2);
  const command = args.shift() ?? "help";
  if (["help", "--help", "-h"].includes(command)) { process.stdout.write(help); return; }
  const supported = ["apple-notes-check", "apple-notes-sync", "apple-notes-status", "voice-memos-check", "voice-memos-sync", "voice-memos-status"];
  if (!supported.includes(command)) throw new Error("Unknown command. Run --help for the supported local import commands.");
  const config = loadConfig(configPath);
  if (command === "voice-memos-check") { print(await checkVoiceMemos(config)); return; }
  if (command === "voice-memos-status") { print(voiceMemosStatus(config)); return; }
  if (command === "apple-notes-check") { print(await checkAppleNotes(config)); return; }
  if (command === "apple-notes-status") { print(appleNotesStatus(config)); return; }
  if (command === "apple-notes-sync") {
    const result = await syncAppleNotes(config, { dryRun: args.includes("--dry-run"), scheduled: args.includes("--scheduled") });
    print(result); return;
  }
  const language = option(args, "--language");
  if (language !== undefined) {
    if (language !== "auto" && language !== "en" && language !== "ar" && language !== "ur") throw new Error("--language requires auto, en, ar, or ur.");
    config.voiceMemos.language = language;
  }
  const limit = option(args, "--limit"), retry = option(args, "--retry"), receipt = option(args, "--receipt");
  if (receipt && (args.includes("--scheduled") || args.includes("--dry-run") || !limit)) throw new Error("A pilot receipt requires a limited manual import.");
  if (receipt && existsSync(resolve(receipt))) throw new Error("Pilot receipt already exists; use a fresh destination.");
  const result = await syncVoiceMemos(config, {
    dryRun: args.includes("--dry-run"), scheduled: args.includes("--scheduled"),
    ...(limit ? { limit: Number(limit) } : {}), ...(retry ? { retry } : {}),
  });
  if (receipt && !result.failed && result.imported > 0) {
    const destination = resolve(receipt);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.tmp-${randomUUID()}`;
    try {
      atomicWrite(temporary, JSON.stringify({schemaVersion: 1, success: true, imported: result.imported, failures: 0, reviewed: false, completedAt: new Date().toISOString()}, null, 2));
      linkSync(temporary, destination);
    } finally { rmSync(temporary, { force: true }); }
  }
  print(result);
  if (result.failed || (receipt && !result.imported)) process.exitCode = 1;
}
main().catch(error => {
  // Services sanitize process failures; never print a stack or captured child output.
  process.stderr.write(`${error instanceof Error ? error.message : "Local import failed; inspect local setup and permissions."}\n`);
  process.exitCode = 1;
});
