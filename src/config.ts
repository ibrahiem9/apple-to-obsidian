import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AppConfig } from "./types.js";

export function defaultSupportPath(): string {
  return join(homedir(), "Library", "Application Support", "apple-to-obsidian");
}
export function defaultConfigPath(): string {
  return process.env["APPLE_TO_OBSIDIAN_CONFIG"] ?? join(defaultSupportPath(), "config.json");
}
export function defaultConfig(vaultPath: string, supportPath = defaultSupportPath()): AppConfig {
  const appPath = join(homedir(), "Applications", "Apple to Obsidian.app");
  return {
    vaultPath, appleNotesPath: "Notes/Apple Notes", statePath: join(supportPath, "notes.sqlite"),
    appPath, nodePath: process.execPath, appleNotes: { nightlyHour: 2 },
    voiceMemos: {
      libraryPath: join(homedir(), "Library", "Group Containers", "group.com.apple.VoiceMemos.shared", "Recordings"),
      outputPath: "Notes/Voice Memos", statePath: join(supportPath, "voice-memos", "history.sqlite"),
      helperPath: join(appPath, "Contents", "MacOS", "voice-memos"),
      binaryPath: join(supportPath, "whisper", "bin", "whisper-cli"),
      modelPath: join(supportPath, "whisper", "models", "ggml-large-v3.bin"),
      segmentSeconds: 30, segmentation: "single-language", language: "auto", nightlyHour: 3,
    },
  };
}
function expandHome(value: string): string {
  return value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}
export function loadConfig(configPath = defaultConfigPath()): AppConfig {
  let supplied: Partial<Omit<AppConfig, "voiceMemos" | "appleNotes">> & {
    voiceMemos?: Partial<AppConfig["voiceMemos"]>; appleNotes?: Partial<AppConfig["appleNotes"]>;
  };
  try { supplied = JSON.parse(readFileSync(configPath, "utf8")); }
  catch { throw new Error("Configuration is missing or invalid. Run scripts/setup --vault PATH, or select a local config with --config."); }
  if (!supplied || typeof supplied.vaultPath !== "string" || !supplied.vaultPath.trim()) throw new Error("Configure a nonempty vaultPath before importing.");
  const base = dirname(resolve(configPath));
  const defaults = defaultConfig(supplied.vaultPath, base);
  const config: AppConfig = {
    ...defaults, ...supplied,
    appleNotes: { ...defaults.appleNotes, ...supplied.appleNotes },
    voiceMemos: { ...defaults.voiceMemos, ...supplied.voiceMemos },
  };
  function absolute(value: string): string {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new Error("Configured paths must be nonempty local paths.");
    const expanded = expandHome(value);
    if (/^[a-z]+:\/\//i.test(expanded)) throw new Error("Configured paths must be local filesystem paths.");
    return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
  }
  for (const key of ["vaultPath", "statePath", "appPath", "nodePath"] as const) config[key] = absolute(config[key]);
  if (supplied.voiceMemos?.helperPath === undefined) config.voiceMemos.helperPath = join(config.appPath, "Contents", "MacOS", "voice-memos");
  for (const key of ["libraryPath", "statePath", "helperPath", "binaryPath", "modelPath"] as const) config.voiceMemos[key] = absolute(config.voiceMemos[key]);
  for (const value of [config.appleNotesPath, config.voiceMemos.outputPath]) {
    if (typeof value !== "string" || !value.trim() || value === "." || isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error("Output folders must be relative folders inside the vault.");
  }
  if (resolve(config.vaultPath, config.appleNotesPath) === resolve(config.vaultPath, config.voiceMemos.outputPath)) throw new Error("Notes and Voice Memos need separate output folders.");
  if (config.statePath === config.voiceMemos.statePath) throw new Error("Notes and Voice Memos need separate state databases.");
  for (const hour of [config.appleNotes.nightlyHour, config.voiceMemos.nightlyHour]) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("Nightly hours must be integers from 0 through 23.");
  }
  const voice = config.voiceMemos;
  if (!Number.isInteger(voice.segmentSeconds) || voice.segmentSeconds < 5 || voice.segmentSeconds > 30) throw new Error("voiceMemos.segmentSeconds must be 5–30.");
  if (voice.segmentation !== "single-language") throw new Error("Only single-language transcription is supported; mixed-language experiments are not production options.");
  if (!["auto", "en", "ar", "ur"].includes(voice.language)) throw new Error("voiceMemos.language must be auto, en, ar, or ur.");
  return config;
}
