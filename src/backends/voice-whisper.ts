import { spawn } from "node:child_process";
import { accessSync, closeSync, constants, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface VoiceTranscript {
  text: string;
  segments: Array<{ start: number; end: number; text: string; language: string }>;
  status: "ready" | "needs-review" | "no-speech";
  warnings: string[];
  engine: string;
  incomplete?: boolean;
  processingSegments?: Array<{ start: number; end: number; language: string; boundary: string }>;
}

export interface VoiceWhisperConfig {
  binaryPath: string;
  modelPath: string;
  segmentSeconds: number;
  segmentation?: "single-language";
  language?: "auto" | "en" | "ar" | "ur";
  converterPath?: string;
  timeoutMs?: number;
  /** Off only for portable test fixtures; production on macOS denies child network access. */
  networkIsolation?: boolean;
}

const SAMPLE_RATE = 16_000;
const BYTE_RATE = SAMPLE_RATE * 2;
const ENGINE = "whisper.cpp/large-v3";

export class VoiceLanguageError extends Error {
  constructor() {
    super("Could not identify English, Arabic, or Urdu. Audio retained; retry with --language en, ar, or ur if the memo uses one of those languages. Mixed-language memos are unsupported.");
  }
}

function readExactly(fd: number, size: number, position: number): Buffer {
  const result = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, result, offset, size - offset, position + offset);
    if (!count) throw new Error("Converted audio is truncated; retry the recording.");
    offset += count;
  }
  return result;
}

function wavData(fd: number, fileSize: number): { offset: number; size: number; channels: number } {
  const header = readExactly(fd, 12, 0);
  if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Audio conversion did not produce a supported PCM WAV file.");
  }
  const end = header.readUInt32LE(4) + 8;
  if (end > fileSize) throw new Error("Converted audio is truncated; retry the recording.");
  let validFormat = false;
  let channels = 0;
  let data: { offset: number; size: number } | undefined;
  for (let position = 12; position + 8 <= end;) {
    const chunk = readExactly(fd, 8, position);
    const name = chunk.toString("ascii", 0, 4);
    const size = chunk.readUInt32LE(4);
    if (position + 8 + size > end) throw new Error("Converted audio contains a truncated WAV chunk.");
    if (name === "fmt ") {
      if (size < 16) throw new Error("Converted audio has an invalid WAV format.");
      const format = readExactly(fd, Math.min(size, 40), position + 8);
      channels = format.readUInt16LE(2);
      const tag = format.readUInt16LE(0);
      // afconvert preserves channel-layout metadata from real Voice Memos with
      // WAVE_FORMAT_EXTENSIBLE. Accept its PCM subtype, never float/compressed data.
      const integerPCM = tag === 1 || (tag === 0xfffe && size >= 40
        && format.readUInt16LE(16) >= 22 && format.readUInt16LE(16) <= size - 18
        && format.readUInt16LE(18) === 16
        && format.subarray(24, 40).equals(Buffer.from("0100000000001000800000aa00389b71", "hex")));
      validFormat = integerPCM && channels > 0 && channels <= 32
        && format.readUInt32LE(4) === SAMPLE_RATE && format.readUInt32LE(8) === BYTE_RATE * channels
        && format.readUInt16LE(12) === 2 * channels && format.readUInt16LE(14) === 16;
    } else if (name === "data") {
      data = { offset: position + 8, size };
    }
    position += 8 + size + (size % 2);
  }
  if (!validFormat || !data || data.size % (2 * channels) !== 0) throw new Error("Converted audio must be 16 kHz, 16-bit PCM WAV with 1–32 channels.");
  return { ...data, channels };
}

function wavHeader(size: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(size + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(BYTE_RATE, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(size, 40);
  return header;
}

function digitallySilent(pcm: Buffer): boolean {
  // Deliberately conservative: quiet speech must not be discarded as silence.
  for (let i = 0; i < pcm.length; i += 2) if (Math.abs(pcm.readInt16LE(i)) > 1) return false;
  return true;
}

function repeated(text: string): boolean {
  const words = text.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  for (let width = 1; width <= Math.min(12, Math.floor(words.length / 4)); width++) {
    for (let offset = 0; offset + width * 4 <= words.length; offset++) {
      const phrase = words.slice(offset, offset + width).join(" ");
      if ([1, 2, 3].every((n) => words.slice(offset + n * width, offset + (n + 1) * width).join(" ") === phrase)) return true;
    }
  }
  return false;
}

/** Offline only. All child output is discarded: errors never include audio, transcript, or titles. */
export class VoiceWhisperTranscriber {
  constructor(private readonly config: VoiceWhisperConfig) {}

  get cacheKey(): string {
    return JSON.stringify(["whisper-large-v3/single-language-v1", this.config.segmentation ?? "single-language", this.config.language ?? "auto", this.config.segmentSeconds, this.config.binaryPath, this.config.modelPath]);
  }

  check(): void {
    if (!Number.isFinite(this.config.segmentSeconds) || this.config.segmentSeconds < 1 || this.config.segmentSeconds > 300) {
      throw new Error("voiceMemos.segmentSeconds must be between 1 and 300 seconds.");
    }
    if (this.config.timeoutMs !== undefined && (!Number.isFinite(this.config.timeoutMs) || this.config.timeoutMs < 1)) {
      throw new Error("Whisper timeout must be a positive finite number.");
    }
    if (this.config.segmentation !== undefined && this.config.segmentation !== "single-language") throw new Error("Unknown Voice Memos segmentation mode.");
    if (this.config.language !== undefined && !["auto", "en", "ar", "ur"].includes(this.config.language)) throw new Error("Voice Memos language must be auto, en, ar, or ur.");
    for (const [label, path, mode] of [
      ["Whisper executable", this.config.binaryPath, constants.X_OK],
      ["Whisper model", this.config.modelPath, constants.R_OK],
      ["audio converter", this.config.converterPath ?? "/usr/bin/afconvert", constants.X_OK],
    ] as const) {
      try {
        if (!isAbsolute(path) || !statSync(path).isFile() || statSync(path).size === 0) throw new Error();
        accessSync(path, mode);
      } catch { throw new Error(`Missing or inaccessible local ${label}; run Voice Memos setup and check configured paths.`); }
    }
    if (this.isolated) {
      try { accessSync("/usr/bin/sandbox-exec", constants.X_OK); }
      catch { throw new Error("Network isolation is unavailable; repair the macOS sandbox launcher before transcribing."); }
    }
  }

  private get isolated(): boolean { return this.config.networkIsolation ?? process.platform === "darwin"; }

  private run(binary: string, args: string[], label: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const executable = this.isolated ? "/usr/bin/sandbox-exec" : binary;
      const arguments_ = this.isolated ? ["-p", "(version 1) (allow default) (deny network*)", binary, ...args] : args;
      const child = spawn(executable, arguments_, { stdio: "ignore" });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, this.config.timeoutMs ?? 30 * 60_000);
      child.once("error", () => { clearTimeout(timer); reject(new Error(`${label} could not start; check local executable permissions.`)); });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (timedOut) reject(new Error(`${label} timed out; retry or increase the local processing timeout.`));
        else if (code !== 0) reject(new Error(`${label} failed (exit ${code ?? "signal"}); check local assets and available memory.`));
        else resolve();
      });
    });
  }

  private async detectLanguages(parts: Buffer[], temporary: string): Promise<string[]> {
    const prefixes = parts.map((_, index) => join(temporary, `language-probe-${index}`));
    try {
      const args = ["-m", this.config.modelPath, "-l", "auto", "-dl", "-oj", "-np"];
      for (let i = 0; i < parts.length; i++) {
        const prefix = prefixes[i]!;
        writeFileSync(`${prefix}.wav`, Buffer.concat([wavHeader(parts[i]!.length), parts[i]!]), { mode: 0o600 });
        args.push("-f", `${prefix}.wav`, "-of", prefix);
      }
      // whisper-cli loads the model once, then independently detects each input.
      // Detection-only output is never used as transcript text.
      await this.run(this.config.binaryPath, args, "Local language detection");
      return prefixes.map(prefix => {
        if (statSync(`${prefix}.json`).size > 16 * 1024 * 1024) throw new Error("Oversized language output");
        const result = JSON.parse(readFileSync(`${prefix}.json`, "utf8")) as { result?: { language?: unknown } };
        const language = result.result?.language;
        if (typeof language !== "string" || !/^[a-z]{2,3}$/.test(language)) throw new Error("Invalid detected language");
        return language;
      });
    } catch {
      throw new Error("Local language detection failed; verify the local runtime and model, then retry with --language en, ar, or ur if known.");
    } finally {
      for (const prefix of prefixes) { rmSync(`${prefix}.wav`, { force: true }); rmSync(`${prefix}.json`, { force: true }); }
    }
  }

  async transcribe(path: string, workDir: string): Promise<VoiceTranscript> {
    this.check();
    mkdirSync(workDir, { recursive: true, mode: 0o700 });
    const temporary = mkdtempSync(join(workDir, "whisper-"));
    const wav = join(temporary, "working.wav");
    let fd: number | undefined;
    try {
      // Preserve channels here: afconvert --mix fails for mono input on current macOS.
      // Downmix each bounded PCM chunk explicitly so speech on any channel is retained.
      await this.run(this.config.converterPath ?? "/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16@16000", path, wav], "Local audio conversion");
      fd = openSync(wav, "r");
      const data = wavData(fd, statSync(wav).size);
      const chunkBytes = Math.floor(this.config.segmentSeconds * SAMPLE_RATE) * 2 * data.channels;
      const segments: VoiceTranscript["segments"] = [];
      const processingSegments: NonNullable<VoiceTranscript["processingSegments"]> = [];
      const warnings = new Set<string>();
      let voicedChunks = 0;
      let successfulChunks = 0;
      let failedChunks = 0;
      let transcriptionIndex = 0;
      let recordingLanguage = this.config.language === "auto" ? undefined : this.config.language;
      for (let offset = 0; offset < data.size; offset += chunkBytes) {
        const sourcePcm = readExactly(fd, Math.min(chunkBytes, data.size - offset), data.offset + offset);
        const pcm = data.channels === 1 ? sourcePcm : Buffer.alloc(sourcePcm.length / data.channels);
        if (data.channels > 1) {
          for (let frame = 0; frame < pcm.length / 2; frame++) {
            let total = 0;
            for (let channel = 0; channel < data.channels; channel++) total += sourcePcm.readInt16LE((frame * data.channels + channel) * 2);
            pcm.writeInt16LE(Math.round(total / data.channels), frame * 2);
          }
          if (digitallySilent(pcm) && !digitallySilent(sourcePcm)) {
            // Opposite-phase channels can cancel during averaging. Preserve the
            // strongest original channel instead of silently discarding speech.
            const energy = Array<number>(data.channels).fill(0);
            for (let frame = 0; frame < pcm.length / 2; frame++) {
              for (let channel = 0; channel < data.channels; channel++) energy[channel]! += Math.abs(sourcePcm.readInt16LE((frame * data.channels + channel) * 2));
            }
            const channel = energy.indexOf(Math.max(...energy));
            for (let frame = 0; frame < pcm.length / 2; frame++) pcm.writeInt16LE(sourcePcm.readInt16LE((frame * data.channels + channel) * 2), frame * 2);
            warnings.add("Channel mixing canceled the signal; the strongest original channel was retained. Review all original channels for missing speech.");
          }
        }
        if (digitallySilent(pcm)) continue;
        voicedChunks++;
        if (!recordingLanguage) {
          // Detect once, then retain one supported language for the entire memo.
          const [detected] = await this.detectLanguages([pcm], temporary);
          if (detected !== "en" && detected !== "ar" && detected !== "ur") throw new VoiceLanguageError();
          recordingLanguage = detected;
        }
        const ranges = [{ start: 0, end: pcm.length / BYTE_RATE, language: recordingLanguage, boundary: "start" }];
        for (const range of ranges) {
          const part = pcm.subarray(Math.round(range.start * SAMPLE_RATE) * 2, Math.round(range.end * SAMPLE_RATE) * 2);
          const start = offset / (BYTE_RATE * data.channels) + range.start;
          const currentIndex = transcriptionIndex++;
          const chunk = join(temporary, `segment-${currentIndex}.wav`);
          const output = join(temporary, `segment-${currentIndex}`);
          processingSegments.push({ start, end: start + part.length / BYTE_RATE, language: range.language, boundary: range.boundary });
          writeFileSync(chunk, Buffer.concat([wavHeader(part.length), part]), { mode: 0o600 });
          try {
            // Use the supported language for this range, with no text prompt or rewriting.
            await this.run(this.config.binaryPath, ["-m", this.config.modelPath, "-f", chunk, "-l", range.language, "-oj", "-of", output, "-np", "-bs", "5"], "Local Whisper transcription");
            if (statSync(`${output}.json`).size > 16 * 1024 * 1024) throw new Error("Oversized engine output");
            const result = JSON.parse(readFileSync(`${output}.json`, "utf8")) as {
              result?: { language?: unknown }; params?: { translate?: unknown }; model?: { multilingual?: unknown };
              transcription?: Array<{ text?: unknown; offsets?: { from?: unknown; to?: unknown } }>;
            };
            if (!Array.isArray(result.transcription) || result.params?.translate === true || result.model?.multilingual === false) throw new Error("Invalid transcription mode or output");
            const language = typeof result.result?.language === "string" ? result.result.language : "und";
            if (language !== recordingLanguage) throw new Error("Engine did not retain the recording language");
            if (!["en", "ar", "ur"].includes(language)) warnings.add("Detected language is unknown or outside English, Arabic, and Urdu; review the original audio.");
            const local: VoiceTranscript["segments"] = [];
            let previousEnd = 0;
            for (const entry of result.transcription) {
              const from = entry.offsets?.from;
              const to = entry.offsets?.to;
              if (typeof entry.text !== "string" || typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from) || !Number.isFinite(to)
                || from < 0 || to < from || to > part.length / BYTE_RATE * 1000 + 1000) throw new Error("Invalid segment timing");
              if (from < previousEnd) warnings.add("Engine timestamps overlap; review segment timing.");
              previousEnd = to;
              if (entry.text.trim()) local.push({ start: start + Math.min(from / 1000, part.length / BYTE_RATE), end: start + Math.min(to / 1000, part.length / BYTE_RATE), text: entry.text, language });
            }
            if (!local.length) warnings.add("Non-silent audio produced empty output; speech may be missing.");
            else if (part.length / BYTE_RATE - previousEnd / 1000 > 10) warnings.add("The transcript ends well before a non-silent segment ends; check for missing speech.");
            segments.push(...local);
            successfulChunks++;
          } catch {
            failedChunks++;
            warnings.add(`Processing failed for segment ${currentIndex + 1}; this transcript is incomplete. Retry the recording.`);
          } finally {
            rmSync(chunk, { force: true });
            rmSync(`${output}.json`, { force: true });
          }
        }
      }
      if (failedChunks && !successfulChunks) throw new Error("Local Whisper failed for all non-silent segments; check model/runtime compatibility, available memory, and retry.");
      const text = segments.map((segment) => segment.text).join("\n");
      if (voicedChunks) warnings.add("One language is used throughout this memo. Mixed-language recordings are unsupported; review wording and original script accuracy.");
      if (processingSegments.length > 1) warnings.add("Audio was split into non-overlapping segments; review words at segment boundaries.");
      if (repeated(text)) warnings.add("Repeated text detected; review for transcription loops.");
      if (!data.size) warnings.add("The recording contains no audio frames.");
      return { text, segments, processingSegments, status: !voicedChunks && data.size ? "no-speech" : warnings.size ? "needs-review" : "ready", warnings: [...warnings], engine: ENGINE, incomplete: failedChunks > 0 };
    } finally {
      if (fd !== undefined) closeSync(fd);
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
