import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync, linkSync, unlinkSync, openSync, closeSync, fsyncSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import TurndownService from "turndown";
import type { AppConfig } from "../types.js";
import { sha256 } from "../files.js";

const require = createRequire(import.meta.url);
const { gfm } = require("turndown-plugin-gfm") as { gfm: TurndownService.Plugin };
export interface RichAppleAttachment {
  id: string; name: string; contentIdentifier?: string; url?: string;
  createdAt?: string; modifiedAt?: string; shared?: boolean;
  exportedFile?: string; exportError?: string; exportWarning?: string; contentErrors?: string[];
}
export interface RichAppleNote {
  id: string; title: string; body: string; html?: string; modifiedAt: string; createdAt?: string;
  account?: string; accountId?: string; folder?: string; folderId?: string; shared?: boolean;
  locked: boolean; hasAttachments: boolean; attachments?: RichAppleAttachment[];
  contentErrors?: string[]; exportError?: string; sourceDeepLink?: string;
}
interface PublishedAttachment extends RichAppleAttachment { vaultPath?: string; sha256?: string; recoveredUrls?: string[]; cachedText?: string[] }
export interface RichNoteResult { body: string; properties: Record<string, unknown>; complete: boolean; errors: string[]; contentHash: string }

/** Safe clickable destinations. Relative references are resolved only through staged attachments. */
function safeUrl(raw: string): string | undefined {
  const value = raw.trim();
  if (/[\u0000-\u0020\u007f<>]/u.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value)) return;
  if (/^(?:javascript|data|vbscript|file|blob|cid):/i.test(value)) return;
  return value;
}
function label(value: string): string { return value.replace(/[\\[\]<>]/g, "\\$&").replace(/[\r\n]+/g, " "); }
function plaintextMarkdown(value: string): string {
  // Notes plaintext is literal content, never instructions to fetch/embed media.
  return value.replace(/[\\`*_[\]#!^~$]/g, "\\$&").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function destination(value: string): string { return value.replace(/ /g, "%20").replace(/[()<>\\]/g, char => encodeURIComponent(char).replace(/\(/g, "%28").replace(/\)/g, "%29")); }
function link(title: string, url: string): string { return `[${label(title || url)}](<${destination(url)}>)`; }
function inside(root: string, path: string): boolean { const rel = relative(root, path); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); }
function noSymlinks(root: string, path: string): void {
  if (!inside(root, path)) throw new Error("Attachment path escapes its permitted directory");
  let current = root;
  for (const part of ["", ...relative(root, path).split(sep).filter(Boolean)]) {
    current = part ? join(current, part) : current;
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Symlinked attachment or output path is not permitted");
  }
}
export function publishAppleNoteArtifact(config: AppConfig, subfolder: string, bytes: Buffer, suffix: string): { vaultPath: string; hash: string } {
  const vault = realpathSync(config.vaultPath);
  const folder = resolve(vault, config.appleNotesPath, subfolder);
  noSymlinks(vault, folder);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const hash = sha256(bytes);
  const path = join(folder, `${hash}${suffix}`);
  noSymlinks(vault, path);
  const check = () => { if (!lstatSync(path).isFile() || sha256(readFileSync(path)) !== hash) throw new Error("Existing immutable source or attachment has changed; retained without overwrite"); };
  if (existsSync(path)) check();
  else {
    const temp = join(folder, `.publish-${randomUUID()}`);
    try {
      writeFileSync(temp, bytes, { mode: 0o600, flag: "wx" });
      const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
      try { linkSync(temp, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; check(); }
    } finally { if (existsSync(temp)) unlinkSync(temp); }
  }
  return { vaultPath: relative(vault, path).split(sep).join("/"), hash };
}
function stagedFile(payloadPath: string, exportedFile: string): string {
  if (isAbsolute(exportedFile) || exportedFile.includes("\\") || exportedFile.split("/").some(part => part === "..") || !exportedFile.startsWith("attachments/")) throw new Error("Unsafe attachment staging path");
  const root = realpathSync(dirname(payloadPath));
  const path = resolve(root, exportedFile);
  noSymlinks(root, path);
  if (!inside(join(root, "attachments"), realpathSync(path)) || !lstatSync(path).isFile()) throw new Error("Attachment is not a regular staged file");
  return path;
}
/** Decode plist data only; never unarchive native objects or open a URL. */
function linkMetadata(path: string, name: string): { urls: string[]; text: string[] } {
  if (!/\.(?:webloc|richlink)$/i.test(name) || lstatSync(path).size > 16 * 1024 * 1024) return { urls: [], text: [] };
  try {
    const parsed: unknown = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8", timeout: 5000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
    const urls = new Set<string>(); const text = new Set<string>();
    function walk(value: unknown, key = "", depth = 0): void {
      if (depth > 50) return;
      if (typeof value === "string") {
        const url = safeUrl(value); if (url && /^https?:/i.test(url)) urls.add(url);
        else if (/^(?:title|name|summary|description|text)$/i.test(key) && value.trim()) text.add(value);
      } else if (Array.isArray(value)) value.forEach(item => walk(item, key, depth + 1));
      else if (value && typeof value === "object") for (const [field, item] of Object.entries(value)) walk(item, field, depth + 1);
    }
    walk(parsed); return { urls: [...urls], text: [...text] };
  } catch { return { urls: [], text: [] }; }
}

export function renderRichNote(note: RichAppleNote, payloadPath: string, config: AppConfig): RichNoteResult {
  const errors = [...(note.contentErrors ?? [])];
  if (note.exportError) errors.push(note.exportError);
  const localLink = (title: string, vaultPath: string) => link(title, relative(resolve(config.vaultPath, config.appleNotesPath), resolve(config.vaultPath, vaultPath)).split(sep).join("/"));
  const warnings: string[] = [];
  const urls = new Set<string>();
  const attachments: PublishedAttachment[] = [];
  const media = new Map<string, PublishedAttachment>();
  for (const attachment of note.attachments ?? []) {
    const result: PublishedAttachment = { ...attachment };
    for (const error of attachment.contentErrors ?? []) errors.push(`Attachment metadata incomplete (${attachment.id}): ${error}`);
    if (attachment.exportWarning) warnings.push(`${attachment.name || "Attachment"}: ${attachment.exportWarning}`);
    if (attachment.exportError) errors.push(`Attachment export failed: ${attachment.id}`);
    if (attachment.url) { const url = safeUrl(attachment.url); if (url) urls.add(url); else errors.push(`Unsafe attachment URL: ${attachment.id}`); }
    if (attachment.exportedFile) {
      try {
        const path = stagedFile(payloadPath, attachment.exportedFile);
        const extension = extname(attachment.name || path).toLowerCase();
        const suffix = /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : ".bin";
        const published = publishAppleNoteArtifact(config, "Attachments", readFileSync(path), suffix);
        result.vaultPath = published.vaultPath; result.sha256 = published.hash;
        const metadata = linkMetadata(path, attachment.name); result.recoveredUrls = metadata.urls; result.cachedText = metadata.text;
        metadata.urls.forEach(url => urls.add(url));
        if (/\.(?:webloc|richlink)$/i.test(attachment.name) && !metadata.urls.length && !safeUrl(attachment.url ?? "")) errors.push(`Link attachment URL unavailable: ${attachment.id}`);
      } catch { errors.push(`Attachment could not be preserved safely: ${attachment.id}`); }
    }
    if (!result.vaultPath && !safeUrl(attachment.url ?? "")) errors.push(`Attachment content unavailable: ${attachment.id}`);
    attachments.push(result);
    for (const identifier of [attachment.id, attachment.contentIdentifier].filter((item): item is string => Boolean(item))) {
      media.set(identifier, result); media.set(`cid:${identifier.replace(/^cid:/, "")}`, result);
    }
  }
  if (note.hasAttachments && !attachments.length) errors.push("Attachment enumeration missing");
  if (note.body.includes("\uFFFC") && !attachments.length) errors.push("Unresolved attachment placeholder in plaintext");
  const renderMedia: TurndownService.ReplacementFunction = (_content, node) => {
      const raw = node.getAttribute("src") ?? node.getAttribute("data") ?? "";
      if (!raw && node.nodeName !== "IMG" && _content.trim()) return _content;
      const attachment = media.get(raw);
      const name = node.getAttribute("alt") || node.getAttribute("title") || attachment?.name || "Attachment";
      if (attachment?.vaultPath) return `${node.nodeName === "IMG" || node.nodeName === "AUDIO" ? "!" : ""}${localLink(name, attachment.vaultPath)}`;
      const url = safeUrl(attachment?.url ?? raw);
      if (url) { urls.add(url); return link(name, url); }
      errors.push("Unresolved HTML media reference"); return `[${label(name)} — attachment unavailable]`;
  };
  const renderLink: TurndownService.ReplacementFunction = (content, node) => {
    const raw = node.getAttribute("href") ?? "";
    const attachment = media.get(raw);
    if (attachment?.vaultPath) return localLink(content || attachment.name, attachment.vaultPath);
    const url = safeUrl(attachment?.url ?? raw);
    if (!url) { if (raw) errors.push("Unresolved or unsafe HTML link"); return content; }
    urls.add(url); return link(content || attachment?.name || url, url);
  };
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-",
    blankReplacement(content, node, options) {
      if (/^(?:IMG|AUDIO|VIDEO|SOURCE|OBJECT|EMBED)$/.test(node.nodeName)) return renderMedia(content, node, options);
      if (node.nodeName === "A") return renderLink(content, node, options);
      return /^(?:P|DIV|H[1-6]|LI|TR|TABLE|BLOCKQUOTE|PRE)$/.test(node.nodeName) ? "\n\n" : "";
    },
  });
  td.use(gfm);
  td.remove(["script", "style", "form", "iframe"]);
  td.addRule("safeLinks", { filter: "a", replacement: renderLink });
  td.addRule("safeMedia", { filter: ["img", "audio", "video", "source", "object", "embed"], replacement: renderMedia });
  // GFM's default table fallback keeps raw HTML for headerless tables. Always render
  // table cells through the same safe rules, including links and nested formatting.
  td.addRule("safeTables", {
    filter: "table",
    replacement(_content, node) {
      const rowNodes = node.querySelectorAll("tr") as ArrayLike<{ children: ArrayLike<{ nodeName: string; innerHTML: string }> }>;
      const rows = Array.from(rowNodes).map(row => Array.from(row.children)
        .filter(cell => cell.nodeName === "TD" || cell.nodeName === "TH")
        .map(cell => td.turndown(cell.innerHTML).replace(/\n+/g, " ").replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      const width = Math.max(...rows.map(row => row.length));
      const rowText = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`;
      return `\n\n${rowText(rows[0]!)}\n${rowText(Array(width).fill("---") as string[])}\n${rows.slice(1).map(rowText).join("\n")}\n\n`;
    },
  });
  let body = td.turndown(note.html || "").trim() || plaintextMarkdown(note.body.replace(/\uFFFC/g, "[Attachment]"));
  const plaintext = note.body.replace(/\uFFFC/g, "").trim();
  const searchable = (value: string) => value.normalize("NFC").replace(/[#*_`\[\]()>|]/g, "").replace(/\s+/g, " ").trim();
  if (note.html && plaintext && !searchable(body).includes(searchable(plaintext))) {
    body += `\n\n## Original plaintext\n\n${plaintextMarkdown(plaintext)}`;
  }
  for (const match of note.body.matchAll(/(?:https?:\/\/|applenotes:)[^\s<>"']+/gi)) {
    const url = safeUrl(match[0]); if (url) urls.add(url);
  }
  if (note.sourceDeepLink) { const source = safeUrl(note.sourceDeepLink); if (source) { urls.add(source); body += `\n\n${link("Open original Apple Note", source)}`; } }
  if (attachments.length) body += `\n\n## Attachments\n\n${attachments.map(attachment => {
    const entries: string[] = [];
    if (attachment.vaultPath) {
      const embed = /\.(?:png|jpe?g|gif|webp|heic|svg|mp3|m4a|wav|ogg|flac|mp4|mov)$/i.test(attachment.vaultPath);
      entries.push(`${embed ? "!" : ""}${localLink(attachment.name || "Attachment", attachment.vaultPath)}`);
    }
    const url = safeUrl(attachment.url ?? ""); if (url) entries.push(link(attachment.name || url, url));
    for (const recovered of attachment.recoveredUrls ?? []) entries.push(link(recovered, recovered));
    for (const cached of attachment.cachedText ?? []) entries.push(label(cached));
    return entries.length ? entries.join("\n\n") : `${label(attachment.name || "Attachment")} — content unavailable`;
  }).join("\n\n")}`;
  if (urls.size) body += `\n\n## Source links\n\n${[...urls].map(url => `- ${link(url, url)}`).join("\n")}`;
  if (warnings.length) body += `\n\n## Capture warnings\n\n${warnings.map(warning => `- ${label(warning)}`).join("\n")}\n\nLink titles and URLs are retained when available. A missing preview does not remove its link. Remote post text was not fetched.`;
  const properties: Record<string, unknown> = {
    apple_export_format_version: 2, apple_account_id: note.accountId ?? null, apple_folder_id: note.folderId ?? null,
    apple_content_completeness_scope: "exposed-fields", apple_capture_warnings: warnings,
    apple_shared: note.shared ?? null, source_urls: [...urls], apple_attachments: attachments,
  };
  try {
    const source = publishAppleNoteArtifact(config, "Sources", Buffer.from(`${JSON.stringify(note, null, 2)}\n`), ".json");
    properties["apple_source_json"] = source.vaultPath;
    body += `\n\n## Preserved source\n\n${localLink("Original metadata and plaintext", source.vaultPath)}`;
    if (note.html !== undefined) {
      const html = publishAppleNoteArtifact(config, "Sources", Buffer.from(note.html), ".html.txt");
      properties["apple_source_html"] = html.vaultPath;
      body += ` · ${localLink("Original HTML (text)", html.vaultPath)}`;
    }
  } catch { errors.push("Original source could not be preserved safely"); }
  const uniqueErrors = [...new Set(errors)];
  properties["apple_content_complete"] = uniqueErrors.length === 0;
  const contentHash = sha256(JSON.stringify({ note, attachments, body, errors: uniqueErrors }));
  return { body: body.trim(), properties, complete: uniqueErrors.length === 0, errors: uniqueErrors, contentHash };
}
