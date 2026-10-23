import { baseOf, isVowel } from "./syllables.ts";

/**
 * 単語と単語のつながり（リンキング）。文の中で、前の語の終わりと次の語の始まりを切らずに続けて言う所。
 * - cv: 子音 → 母音（an‿idea, turn‿it‿off, for‿a）。語末の r の母音（ɚ）もここ
 * - vv: 母音 → 母音（go‿out, the‿end, I‿am）。間に軽い y / w が入ることが多い
 * - cc: 同じ子音、または同じ場所で作る破裂音が続く（bus‿stop, want‿to, hot‿dog）。前の音は出し切らずにひとつながり
 * - cy: t / d / s / z → you の y（did‿you → ディジュ, meet‿you → ミーチュ）
 * 読点・句点などで区切れている所はつなげない。
 */
export type LinkKind = "cv" | "vv" | "cc" | "cy";

export type Link = {
  /** つながる所の前の語の番号（after と after+1 の間） */
  after: number;
  kind: LinkKind;
  /** vv のときに間に入る軽い音（発音記号で j / w）。決まらないときはなし */
  glide?: "j" | "w";
  /** 前の語の最後の t / d が母音にはさまれて、軽くはじく音（ラ行に近い）になる（get‿up, what‿is） */
  flap?: boolean;
};

/** ここで切れる記号（前の語の終わり、次の語の始まり） */
const ENDS_CLAUSE = /[,.!?;:…—–)"”]$/;
const STARTS_CLAUSE = /^["“(—–]/;

const GLIDE_Y = new Set(["IY", "IH", "EY", "AY", "OY"]);
const GLIDE_W = new Set(["UW", "UH", "OW", "AW"]);
/** 同じ場所で作る破裂音の組（前の音は出し切らない） */
const SAME_PLACE: Record<string, string> = { T: "D", D: "T", P: "B", B: "P", K: "G", G: "K" };
const BLEND_INTO_Y = new Set(["T", "D", "S", "Z"]);

const clean = (s: string) => s.toLowerCase().replace(/[^a-z']/g, "");

/**
 * 文の語どうしのつながりを探す。
 * `text` は表示する文（区切りの記号を見るため）、`words` はデータの語（text と同じ順で、phones は ARPAbet）。
 * 文の空白区切りと語の数が合わないときは、記号が見られないので何も返さない。
 */
export function findLinks(text: string, words: readonly { text: string; phones: readonly string[] }[]): Link[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length !== words.length) return [];
  const out: Link[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i].phones;
    const b = words[i + 1].phones;
    if (!a.length || !b.length) continue;
    if (ENDS_CLAUSE.test(tokens[i]) || STARTS_CLAUSE.test(tokens[i + 1])) continue;

    const last = baseOf(a[a.length - 1]);
    const first = baseOf(b[0]);
    const before = a.length > 1 ? baseOf(a[a.length - 2]) : null;

    // 語末の ɚ（ER）は r として次の母音へつながる
    const lastIsConsonant = !isVowel(last) || last === "ER";

    if (isVowel(first)) {
      if (lastIsConsonant) {
        const flap = (last === "T" || last === "D") && before !== null && (isVowel(before) || before === "R");
        out.push(flap ? { after: i, kind: "cv", flap } : { after: i, kind: "cv" });
      } else {
        const w = clean(words[i].text);
        const glide = GLIDE_Y.has(last) || w === "the" ? "j" : GLIDE_W.has(last) || w === "to" ? "w" : undefined;
        out.push(glide ? { after: i, kind: "vv", glide } : { after: i, kind: "vv" });
      }
      continue;
    }
    if (!lastIsConsonant || last === "ER") continue;
    if (first === "Y" && BLEND_INTO_Y.has(last) && clean(words[i + 1].text).startsWith("you")) {
      out.push({ after: i, kind: "cy" });
      continue;
    }
    if (first === last || SAME_PLACE[last] === first) out.push({ after: i, kind: "cc" });
  }
  return out;
}
