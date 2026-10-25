/**
 * Test audio for tools/e2e (written to .work/e2e/, which is git-ignored).
 *
 *   node tools/e2e/make-wavs.mjs [--force]
 *
 * speech/<id>.wav  — macOS `say` output, 16 kHz mono 16-bit (the "clean" source)
 * fake/<id>.wav    — the same, padded for Chrome's --use-file-for-fake-audio-capture:
 *                    LEAD s of room tone, speech, TRAIL s of room tone. Chrome loops the file,
 *                    so the trail must outlast VAD auto-stop (0.8 s) with a wide margin.
 *                    Room tone = deterministic white noise at NOISE_DB dBFS, added everywhere.
 * manifest.json    — speech region of every fake file (file time, from the clean source)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeWav, encodeWav } from "../../src/engine/audio/wav.ts";
import { findSilenceTrim } from "../../src/engine/audio/dsp.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const E2E_DIR = join(ROOT, ".work/e2e");
export const LEAD = 1.2;
export const TRAIL = 3.0;
export const NOISE_DB = -66;

export const UTTERANCES = [
  { id: "sam_think", voice: "Samantha", text: "I think the weather is getting better." },
  { id: "sam_rice", voice: "Samantha", text: "Could I have some rice, please?" },
  { id: "sam_shells", voice: "Samantha", text: "She sells sea shells by the seashore." },
  { id: "fred_fish", voice: "Fred", text: "Very fresh fish, three for five dollars." },
];

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeAll({ force = false } = {}) {
  mkdirSync(join(E2E_DIR, "speech"), { recursive: true });
  mkdirSync(join(E2E_DIR, "fake"), { recursive: true });
  const manifest = {};
  for (const u of UTTERANCES) {
    const clean = join(E2E_DIR, "speech", `${u.id}.wav`);
    const fake = join(E2E_DIR, "fake", `${u.id}.wav`);
    if (force || !existsSync(clean)) {
      execFileSync("say", ["-v", u.voice, "--file-format=WAVE", "--data-format=LEI16@16000", "-o", clean, u.text]);
    }
    const { sampleRate, mono } = decodeWav(readFileSync(clean));
    if (sampleRate !== 16000) throw new Error(`${clean}: expected 16 kHz, got ${sampleRate}`);
    // speech region of the clean source: 10 ms frames above max(-50 dBFS, peak − 40 dB)
    const { start, end } = findSilenceTrim(mono, sampleRate, { padStart: 0, padEnd: 0 });
    const lead = Math.round(LEAD * sampleRate);
    const out = new Float32Array(lead + mono.length + Math.round(TRAIL * sampleRate));
    out.set(mono, lead);
    const rnd = prng(0x5eed + out.length);
    const amp = Math.pow(10, NOISE_DB / 20) * Math.sqrt(3); // uniform noise with that RMS
    for (let i = 0; i < out.length; i++) out[i] += (rnd() * 2 - 1) * amp;
    writeFileSync(fake, encodeWav(out, sampleRate));
    manifest[u.id] = {
      ...u,
      clean,
      fake,
      sampleRate,
      fileDuration: out.length / sampleRate,
      speech: { start: (lead + start) / sampleRate, end: (lead + end) / sampleRate },
    };
  }
  writeFileSync(join(E2E_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const m = makeAll({ force: process.argv.includes("--force") });
  for (const [id, v] of Object.entries(m)) {
    console.log(`${id.padEnd(12)} ${v.fileDuration.toFixed(2)} s, speech ${v.speech.start.toFixed(3)}–${v.speech.end.toFixed(3)} s  "${v.text}"`);
  }
}
