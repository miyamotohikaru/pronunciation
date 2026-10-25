/** Test clips and what each one should show. */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { WORK } from "./lib.mts";

export type Expect =
  | { kind: "native" } // every word >= 90, nothing flagged
  | { kind: "error"; word: number; phone?: number; heardAs?: string[]; insertion?: boolean; deletion?: boolean }
  | { kind: "accent" }; // Japanese voice: at least one word < 60 or a finding

/** sentence: a Kokoro reference id (targets from its misaki + CMUdict + learned variants);
 *  text: a plain sentence (targets from CMUdict + connected speech only, nothing learned). */
export type Case = { file: string; sentence: string; text?: string; expect: Expect; note?: string };

const A = (f: string) => join(WORK, "audio", f);

/** Kokoro reference JSONs that define the targets of a sentence. */
export function kokoroJsons(sentence: string): string[] {
  return ["af_heart", "am_michael"].map((v) => join(WORK, "tts", v, `${sentence}.json`));
}

export function cases(): Case[] {
  const out: Case[] = [
    { file: A("sam_rice.wav"), sentence: "t01_rice", expect: { kind: "native" } },
    { file: A("sam_lice.wav"), sentence: "t01_rice", expect: { kind: "error", word: 3, phone: 0, heardAs: ["L"] }, note: "rice -> lice (and really -> lilly)" },
    { file: A("kyo_rice.wav"), sentence: "t01_rice", expect: { kind: "accent" } },
    { file: A("sam_think.wav"), sentence: "t02_think", expect: { kind: "native" } },
    { file: A("sam_sink.wav"), sentence: "t02_think", expect: { kind: "error", word: 0, phone: 0, heardAs: ["S"] }, note: "think -> sink" },
    { file: A("kyo_think.wav"), sentence: "t02_think", expect: { kind: "accent" } },
    { file: A("sam_very.wav"), sentence: "t03_very", expect: { kind: "native" } },
    { file: A("sam_berry.wav"), sentence: "t03_very", expect: { kind: "error", word: 0, phone: 0, heardAs: ["B"] }, note: "very -> berry" },
    { file: A("kyo_very.wav"), sentence: "t03_very", expect: { kind: "accent" } },
    { file: A("sam_street.wav"), sentence: "t04_street", expect: { kind: "native" } },
    { file: A("sam_sutoreeto.wav"), sentence: "t04_street", expect: { kind: "error", word: 0, insertion: true }, note: "su-to-ree-to" },
    { file: A("kyo_street.wav"), sentence: "t04_street", expect: { kind: "accent" } },
  ];
  // extra clips generated with `say` (gen-say.sh), if present
  for (const extra of extraSayCases()) if (existsSync(extra.file)) out.push(extra);
  // Kokoro native references
  for (const voice of ["af_heart", "am_michael"]) {
    const dir = join(WORK, "tts", voice);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      const m = f.match(/^(t\d\d_[a-z_]+?)(\.slow)?\.16k\.wav$/);
      if (!m) continue;
      out.push({ file: join(dir, f), sentence: m[1], expect: { kind: "native" } });
    }
  }
  const cand = join(WORK, "tts", "candidates");
  if (existsSync(cand)) {
    for (const voice of readdirSync(cand).sort()) {
      if (voice === "audio" || voice === "af_heart" || voice === "am_michael") continue;
      const dir = join(cand, voice);
      for (const f of readdirSync(dir).sort()) {
        const m = f.match(/^(t\d\d_[a-z_]+?)\.16k\.wav$/);
        if (m) out.push({ file: join(dir, f), sentence: m[1], expect: { kind: "native" }, note: `candidate ${voice}` });
      }
    }
  }
  return out;
}

/** More clips made with macOS `say` (.work/audio/extra; see README). CMUdict targets only. */
export function extraSayCases(): Case[] {
  const X = (f: string) => join(WORK, "audio", "extra", f);
  const sets: [string, string, string, Expect][] = [
    ["thank_you", "Thank you.", "sank_you", { kind: "error", word: 0, phone: 0, heardAs: ["S"] }],
    ["this_one", "This one.", "zis_one", { kind: "error", word: 0, phone: 0, heardAs: ["Z"] }],
    ["light", "Turn on the light.", "right", { kind: "error", word: 3, phone: 0, heardAs: ["R"] }],
    ["black_cat", "A black cat.", "black_cut", { kind: "error", word: 2, phone: 1, heardAs: ["AH"] }],
    ["my_desk", "My desk.", "my_desuku", { kind: "error", word: 1, insertion: true }],
    ["milk", "A cup of milk.", "miruku", { kind: "error", word: 3, insertion: true }],
    ["big_bed", "A big bed.", "big_beddo", { kind: "error", word: 2, insertion: true }],
    ["sheep", "A white sheep.", "ship", { kind: "error", word: 2, phone: 1, heardAs: ["IH"] }],
    ["voice", "Your voice.", "boice", { kind: "error", word: 1, phone: 0, heardAs: ["B"] }],
    ["world", "The world.", "", { kind: "native" }],
  ];
  const out: Case[] = [];
  for (const [id, text, err, ex] of sets) {
    out.push({ file: X(`sam_${id}.wav`), sentence: `x_${id}`, text, expect: { kind: "native" } });
    if (err) out.push({ file: X(`sam_${err}.wav`), sentence: `x_${id}`, text, expect: ex, note: `said "${err.replace(/_/g, " ")}"` });
    out.push({ file: X(`kyo_${id}.wav`), sentence: `x_${id}`, text, expect: { kind: "accent" }, note: "Kyoko, katakana" });
  }
  return out;
}
