import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, openSync, closeSync, renameSync, rmSync, writeFileSync, readFileSync, fsyncSync } from "node:fs";
import { dirname } from "node:path";
import YAML from "yaml";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}-${sha256(value).slice(0, 12)}`;
}

export function atomicWrite(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temp, content);
    const fd = openSync(temp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function readMarkdown(path: string): { properties: Record<string, unknown>; body: string } {
  const raw = readFileSync(path, "utf8");
  if (!raw.startsWith("---\n")) return { properties: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) return { properties: {}, body: raw };
  const parsed = YAML.parse(raw.slice(4, end)) as unknown;
  const properties = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
  return { properties, body: raw.slice(end + 5) };
}

export function markdown(properties: Record<string, unknown>, body: string): string {
  return `---\n${YAML.stringify(properties, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trim()}\n`;
}

export function safeFilename(value: string, fallback = "Untitled"): string {
  const normalized = value.normalize("NFC").replace(/[\u0000-\u001f/:\\*?"<>|]/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  let result = "";
  for (const character of normalized || fallback) {
    if (Buffer.byteLength(result + character) > 140) break;
    result += character;
  }
  return result;
}
