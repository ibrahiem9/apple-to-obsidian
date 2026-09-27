import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config.js";
import type { AppConfig } from "../src/types.js";
export function testConfig(): AppConfig & { audioDropPath: string } {
  const root = mkdtempSync(join(tmpdir(), "apple-obsidian-test-"));
  const config = { ...defaultConfig(join(root, "vault"), root), audioDropPath: join(root, "audio") };
  mkdirSync(join(config.vaultPath, config.appleNotesPath), { recursive: true });
  mkdirSync(config.audioDropPath, { recursive: true });
  return config;
}
