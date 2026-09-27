/** Acoustic/language planning only. No speech is discarded or rewritten. */
export interface LanguageProbe { start: number; end: number; language: string }
export interface LanguageRange { start: number; end: number; language: string; boundary: "start" | "pause" | "estimated" }
const RATE = 16_000;

export function languageProbeWindows(seconds: number): Array<{ start: number; end: number }> {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) throw new Error("Invalid bounded audio duration");
  const windows = [];
  for (let start = 0; start === 0 || start + 1 < seconds; start++) {
    windows.push({ start, end: Math.min(start + 2, seconds) });
    if (start + 2 >= seconds) break;
  }
  return windows;
}

function acousticEnergy(pcm: Buffer): { energy: number[]; threshold?: number } {
  const frameBytes = RATE * 0.02 * 2;
  const energy: number[] = [];
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    const end = Math.min(offset + frameBytes, pcm.length);
    let sum = 0;
    for (let p = offset; p < end; p += 2) sum += pcm.readInt16LE(p) ** 2;
    energy.push(20 * Math.log10(Math.sqrt(sum / ((end - offset) / 2)) / 32768 + 1e-10));
  }
  const sorted = [...energy].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)]!;
  const speech = sorted[Math.floor(sorted.length * 0.9)]!;
  // A steady tone/noise is not evidence of pauses. Quiet speech is never removed.
  if (speech - floor < 12) return { energy };
  const threshold = Math.min(floor + 12, speech - 12);
  return { energy, threshold };
}

function acousticPauses(pcm: Buffer, energy: number[], threshold: number | undefined): Array<{ start: number; end: number }> {
  if (threshold === undefined) return [];
  const pauses: Array<{ start: number; end: number }> = [];
  let first: number | undefined;
  for (let i = 0; i <= energy.length; i++) {
    if (i < energy.length && energy[i]! < threshold) { first ??= i; continue; }
    if (first !== undefined) {
      const span = { start: first * 0.02, end: Math.min(i * 0.02, pcm.length / (RATE * 2)) };
      const last = pauses.at(-1);
      if (last && span.start - last.end <= 0.040001) last.end = span.end;
      else pauses.push(span);
      first = undefined;
    }
  }
  return pauses.filter(pause => pause.end - pause.start >= 0.119999);
}

/** Wider checks for isolated or acoustically weak short-window guesses. */
export function languageConfirmationWindows(pcm: Buffer, probes: LanguageProbe[]): Array<{ start: number; end: number }> {
  const { energy, threshold } = acousticEnergy(pcm);
  return probes.filter((probe, i) => {
    const isolated = probes[i - 1]?.language !== probe.language && probes[i + 1]?.language !== probe.language;
    return isolated || !hasSpeechEvidence(energy, threshold, probe);
  }).map(probe => ({ start: probe.start, end: Math.min(probe.start + 4, pcm.length / (RATE * 2)) }))
    .filter(window => window.end > Math.min(window.start + 2, pcm.length / (RATE * 2)) + 0.25);
}

function hasSpeechEvidence(energy: number[], threshold: number | undefined, window: { start: number; end: number }): boolean {
  const frames = energy.slice(Math.floor(window.start / 0.02), Math.ceil(window.end / 0.02));
  return threshold === undefined || frames.filter(level => level >= threshold).length * 0.02 >= (window.end - window.start) * 0.3;
}

export function planLanguageRanges(pcm: Buffer, probes: LanguageProbe[], confirmations: LanguageProbe[] = []): { ranges: LanguageRange[]; uncertain: boolean } {
  if (!pcm.length || pcm.length % 2 || pcm.length > RATE * 2 * 300) throw new Error("Invalid bounded PCM audio");
  const duration = pcm.length / (RATE * 2);
  const expected = languageProbeWindows(duration);
  if (probes.length !== expected.length || probes.some((p, i) => p.start !== expected[i]!.start || p.end !== expected[i]!.end || !/^[a-z]{2,3}$/.test(p.language))) {
    throw new Error("Incomplete language probe coverage");
  }
  const requested = languageConfirmationWindows(pcm, probes);
  const confirmed = new Map<number, LanguageProbe>();
  for (const confirmation of confirmations) {
    if (confirmed.has(confirmation.start) || !/^[a-z]{2,3}$/.test(confirmation.language)
      || !requested.some(w => w.start === confirmation.start && w.end === confirmation.end)) throw new Error("Invalid language confirmation");
    confirmed.set(confirmation.start, confirmation);
  }
  const runs: Array<{ first: LanguageProbe; count: number; corroborated: boolean }> = [];
  const { energy, threshold } = acousticEnergy(pcm);
  let weakEvidence = false;
  for (const probe of probes) {
    const confirmation = confirmed.get(probe.start);
    const corroborated = confirmation?.language === probe.language && hasSpeechEvidence(energy, threshold, confirmation);
    // Noise-only windows often acquire arbitrary language labels. Exclude those
    // labels from switch decisions, never the corresponding audio from the output.
    if (!hasSpeechEvidence(energy, threshold, probe) && !corroborated) {
      weakEvidence = true;
      continue;
    }
    const last = runs.at(-1);
    if (last?.first.language === probe.language) { last.count++; last.corroborated ||= corroborated; }
    else runs.push({ first: probe, count: 1, corroborated });
  }
  // An isolated hint requires a matching wider-window check with speech evidence.
  // Keep brief real switches without treating every noisy label as a new language.
  const supported = runs.filter(run => run.count >= 2 || run.corroborated || probes.length === 1);
  let uncertain = weakEvidence || supported.length !== runs.length || supported.some(run => run.count === 1 && probes.length > 1);
  if (!supported.length) return { ranges: [{ start: 0, end: duration, language: "auto", boundary: "start" }], uncertain: true };
  const ranges: LanguageRange[] = [{ start: 0, end: duration, language: supported[0]!.first.language, boundary: "start" }];
  const pauses = acousticPauses(pcm, energy, threshold);
  for (const run of supported.slice(1)) {
    const last = ranges.at(-1)!;
    if (last.language === run.first.language) continue;
    const estimate = run.first.start + 0.5;
    const candidates = pauses.filter(p => {
      const midpoint = (p.start + p.end) / 2;
      return midpoint >= run.first.start - 0.5 && midpoint <= run.first.start + 1.5 && midpoint > last.start + 0.25 && midpoint < duration - 0.25;
    });
    // Within the detector's uncertain transition interval, prefer a substantial
    // acoustic pause. Equal-length pauses use the earlier edge deterministically.
    candidates.sort((a, b) => {
      const frames = (pause: { start: number; end: number }) => Math.round((pause.end - pause.start) / 0.02);
      return frames(b) - frames(a) || a.start - b.start;
    });
    const pause = candidates[0];
    const cut = Math.round((pause ? (pause.start + pause.end) / 2 : estimate) * RATE) / RATE;
    if (cut <= last.start || cut >= duration) { uncertain = true; continue; }
    last.end = cut;
    ranges.push({ start: cut, end: duration, language: run.first.language, boundary: pause ? "pause" : "estimated" });
    if (!pause) uncertain = true;
  }
  return { ranges, uncertain };
}
