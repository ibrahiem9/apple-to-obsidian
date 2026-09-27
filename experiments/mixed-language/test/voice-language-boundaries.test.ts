import assert from "node:assert/strict";
import test from "node:test";
import { languageConfirmationWindows, languageProbeWindows, planLanguageRanges, type LanguageProbe } from "../src/voice-language-boundaries.js";

const RATE = 16_000;

function pcm(seconds: number, quiet: Array<[number, number]> = [], amplitude = 3000): Buffer {
  const frames = Math.round(seconds * RATE);
  const audio = Buffer.alloc(frames * 2);
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / RATE;
    const isQuiet = quiet.some(([start, end]) => time >= start && time < end);
    audio.writeInt16LE(isQuiet ? 0 : amplitude, frame * 2);
  }
  return audio;
}

function probes(seconds: number, languageAt: (start: number, end: number) => string): LanguageProbe[] {
  return languageProbeWindows(seconds).map(window => ({ ...window, language: languageAt(window.start, window.end) }));
}

test("2-second overlapping probe windows cover arbitrary durations without gaps", () => {
  for (const duration of [0.25, 2, 2.37, 8.625, 300]) {
    const windows = languageProbeWindows(duration);
    assert.equal(windows[0]!.start, 0);
    assert.equal(windows.at(-1)!.end, duration);
    for (let i = 0; i < windows.length; i++) {
      assert.ok(windows[i]!.end > windows[i]!.start);
      assert.ok(windows[i]!.end - windows[i]!.start <= 2);
      if (i) assert.equal(windows[i]!.start, windows[i - 1]!.start + 1);
    }
  }
  assert.throws(() => languageProbeWindows(0), /duration/);
  assert.throws(() => languageProbeWindows(301), /duration/);
});

test("sustained language switch snaps to a non-integer local pause and covers the full clip", () => {
  const duration = 11.375;
  const audio = pcm(duration, [[5.08, 6.25]]);
  const result = planLanguageRanges(audio, probes(duration, start => start < 5 ? "en" : "ur"));
  assert.equal(result.uncertain, false);
  assert.equal(result.ranges.length, 2);
  assert.equal(result.ranges[0]!.language, "en");
  assert.equal(result.ranges[1]!.language, "ur");
  assert.equal(result.ranges[1]!.boundary, "pause");
  assert.ok(result.ranges[1]!.start >= 5.07 && result.ranges[1]!.start <= 6.26);
  assert.equal(result.ranges[0]!.start, 0);
  assert.equal(result.ranges[0]!.end, result.ranges[1]!.start);
  assert.equal(result.ranges.at(-1)!.end, duration);
});

test("an isolated noisy label is ignored and marked uncertain", () => {
  const duration = 9.25;
  const labels = ["en", "en", "ar", "en", "en", "ur", "ur", "ur", "ur", "ur"];
  const result = planLanguageRanges(pcm(duration, [[6.3, 6.7]]), probes(duration, (_start, _end) => labels[Math.min(Math.floor(_start), labels.length - 1)]!));
  assert.equal(result.uncertain, true);
  assert.deepEqual(result.ranges.map(range => range.language), ["en", "ur"]);
  assert.ok(result.ranges.every(range => range.language !== "ar"));
});

test("unsupported detected languages are preserved instead of coerced", () => {
  const duration = 4.5;
  const result = planLanguageRanges(pcm(duration), probes(duration, () => "fa"));
  assert.equal(result.ranges.length, 1);
  assert.equal(result.ranges[0]!.language, "fa");
});

test("steady and no-pause audio stays intact; uncertain language changes use an estimated boundary", () => {
  const duration = 7.75;
  const steady = planLanguageRanges(pcm(duration, [], 3), probes(duration, () => "en"));
  assert.deepEqual(steady.ranges.map(({ start, end, language }) => [start, end, language]), [[0, duration, "en"]]);
  assert.equal(steady.uncertain, false);

  const changing = planLanguageRanges(pcm(duration), probes(duration, start => start < 3 ? "en" : "ar"));
  assert.equal(changing.ranges.length, 2);
  assert.equal(changing.ranges[1]!.boundary, "estimated");
  assert.equal(changing.uncertain, true);
  assert.ok(changing.ranges[1]!.start > 0 && changing.ranges[1]!.start < duration);
});

test("quiet speech and digital silence remain covered by planned ranges", () => {
  const duration = 3.4;
  const quiet = planLanguageRanges(pcm(duration, [], 2), probes(duration, () => "en"));
  assert.deepEqual(quiet.ranges.map(({ start, end }) => [start, end]), [[0, duration]]);
  const silence = planLanguageRanges(Buffer.alloc(Math.round(duration * RATE) * 2), probes(duration, () => "en"));
  assert.deepEqual(silence.ranges.map(({ start, end }) => [start, end]), [[0, duration]]);
});

test("misleading labels on quiet lead-in and gap windows do not create switches or drop audio", () => {
  const duration = 9;
  const audio = pcm(duration, [[0, 1.5], [4.2, 5.8]]);
  const result = planLanguageRanges(audio, probes(duration, start => {
    if (start === 0) return "ur";
    if (start === 4) return "ar";
    return "en";
  }));
  assert.equal(result.uncertain, true);
  assert.equal(result.ranges.length, 1);
  assert.equal(result.ranges[0]!.language, "en");
  assert.equal(result.ranges[0]!.start, 0);
  assert.equal(result.ranges[0]!.end, duration);
  assert.equal(result.ranges[0]!.boundary, "start");
  assert.equal(audio.length, duration * RATE * 2, "the original PCM remains intact and represented by the full range");
});

test("wider speech-backed confirmation preserves brief initial and interior language runs", () => {
  const duration = 10;
  const audio = pcm(duration);
  for (const [isolatedStart, language] of [[0, "ur"], [4, "ur"]] as const) {
    const detected = probes(duration, start => start === isolatedStart ? language : "en");
    const windows = languageConfirmationWindows(audio, detected);
    const target = windows.find(window => window.start === isolatedStart);
    assert.ok(target, `the isolated probe at ${isolatedStart}s should receive a wider check`);
    const confirmation: LanguageProbe = { ...target, language };
    const result = planLanguageRanges(audio, detected, [confirmation]);
    assert.ok(result.uncertain);
    assert.ok(result.ranges.some(range => range.language === language));
    assert.equal(result.ranges[0]!.start, 0);
    assert.equal(result.ranges.at(-1)!.end, duration);
    for (let i = 1; i < result.ranges.length; i++) assert.equal(result.ranges[i - 1]!.end, result.ranges[i]!.start);
  }
});

test("mismatched wider confirmation cannot promote an isolated or quiet-window label", () => {
  const duration = 8;
  const audio = pcm(duration, [[0, 1.5]]);
  const detected = probes(duration, start => start === 0 ? "ur" : "en");
  const window = languageConfirmationWindows(audio, detected).find(candidate => candidate.start === 0)!;
  const result = planLanguageRanges(audio, detected, [{ ...window, language: "en" }]);
  assert.equal(result.uncertain, true);
  assert.equal(result.ranges.length, 1);
  assert.equal(result.ranges[0]!.language, "en");
  assert.equal(result.ranges[0]!.start, 0);
  assert.equal(result.ranges[0]!.end, duration);
});

test("unrequested and misaligned wider confirmations are rejected", () => {
  const duration = 8;
  const audio = pcm(duration);
  const detected = probes(duration, start => start === 0 ? "ur" : "en");
  const requested = languageConfirmationWindows(audio, detected).find(candidate => candidate.start === 0)!;
  assert.throws(() => planLanguageRanges(audio, detected, [{ ...requested, end: requested.end - 0.5, language: "ur" }]), /confirmation/);
  assert.throws(() => planLanguageRanges(audio, detected, [{ ...requested, language: "unknown-language" }]), /confirmation/);
  assert.throws(() => planLanguageRanges(audio, detected, [
    { ...requested, language: "ur" }, { ...requested, language: "ur" },
  ]), /confirmation/);
  assert.throws(() => planLanguageRanges(audio, detected, [{ start: 1, end: 5, language: "ur" }]), /confirmation/);
});

test("invalid, missing, or misaligned probe outputs fail closed", () => {
  const audio = pcm(4.25);
  const valid = probes(4.25, () => "en");
  assert.throws(() => planLanguageRanges(audio, valid.slice(1)), /coverage/);
  assert.throws(() => planLanguageRanges(audio, valid.map((probe, i) => i ? probe : { ...probe, start: 0.1 })), /coverage/);
  assert.throws(() => planLanguageRanges(audio, valid.map((probe, i) => i ? probe : { ...probe, language: "unknown-language" })), /coverage/);
  assert.throws(() => planLanguageRanges(Buffer.alloc(0), []), /PCM/);
  assert.throws(() => planLanguageRanges(Buffer.alloc(3), []), /PCM/);
});
