// 単語のつながり（リンキング）を、決まった例と教材の全文で確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { findLinks, type Link } from "../../src/engine/prosody/linking.ts";

const DIR = new URL("../../public/content/items/", import.meta.url).pathname;

type W = { text: string; phones: string[] };
const w = (text: string, phones: string) => ({ text, phones: phones.split(" ") });
/** 「I have‿an‿idea.」の形に戻す（‿ がつながり） */
const show = (text: string, links: Link[]) =>
  text
    .split(/\s+/)
    .map((t, i) => t + (links.some((l) => l.after === i) ? "‿" : " "))
    .join("")
    .trim();

test("子音 → 母音、区切りの記号ではつなげない", () => {
  const words: W[] = [w("I", "AY1"), w("have", "HH AE1 V"), w("an", "AH0 N"), w("idea.", "AY0 D IY1 AH0")];
  assert.equal(show("I have an idea.", findLinks("I have an idea.", words)), "I have‿an‿idea.");
  const tired: W[] = [
    w("When", "W EH1 N"), w("I", "AY1"), w("got", "G AA1 T"), w("home,", "HH OW1 M"),
    w("I", "AY1"), w("was", "W AA1 Z"), w("really", "R IY1 L IY0"), w("tired.", "T AY1 ER0 D"),
  ];
  const text = "When I got home, I was really tired.";
  assert.equal(show(text, findLinks(text, tired)), "When‿I got home, I was really tired.");
});

test("母音 → 母音は y / w をはさむ、the は ði", () => {
  const links = findLinks("Go out to the end of it", [
    w("Go", "G OW1"), w("out", "AW1 T"), w("to", "T UW1"), w("the", "DH AH0"), w("end", "EH1 N D"), w("of", "AH1 V"), w("it", "IH1 T"),
  ]);
  assert.deepEqual(links.find((l) => l.after === 0), { after: 0, kind: "vv", glide: "w" });
  assert.equal(links.some((l) => l.after === 2), false); // to the: 母音 → 子音
  assert.deepEqual(links.find((l) => l.after === 3), { after: 3, kind: "vv", glide: "j" });
  assert.deepEqual(links.find((l) => l.after === 4), { after: 4, kind: "cv" }); // end‿of（n d の後なので弾かない）
  assert.deepEqual(links.find((l) => l.after === 5), { after: 5, kind: "cv" });
});

test("t が母音にはさまれると弾く音、同じ子音・you の前", () => {
  const get = findLinks("Get up at the bus stop", [
    w("Get", "G EH1 T"), w("up", "AH1 P"), w("at", "AE1 T"), w("the", "DH AH0"), w("bus", "B AH1 S"), w("stop", "S T AA1 P"),
  ]);
  assert.deepEqual(get.find((l) => l.after === 0), { after: 0, kind: "cv", flap: true });
  assert.deepEqual(get.find((l) => l.after === 4), { after: 4, kind: "cc" });
  const did = findLinks("Did you want to go", [w("Did", "D IH1 D"), w("you", "Y UW1"), w("want", "W AA1 N T"), w("to", "T UW1"), w("go", "G OW1")]);
  assert.deepEqual(did.find((l) => l.after === 0), { after: 0, kind: "cy" });
  assert.deepEqual(did.find((l) => l.after === 2), { after: 2, kind: "cc" });
  const hot = findLinks("a hot dog", [w("a", "AH0"), w("hot", "HH AA1 T"), w("dog", "D AO1 G")]);
  assert.deepEqual(hot, [{ after: 1, kind: "cc" }]);
});

test("語末の r（ɚ）は次の母音へつながる、次が子音ならつながらない", () => {
  const t = findLinks("Your teacher is never late", [
    w("Your", "Y AO1 R"), w("teacher", "T IY1 CH ER0"), w("is", "IH1 Z"), w("never", "N EH1 V ER0"), w("late", "L EY1 T"),
  ]);
  assert.deepEqual(t, [{ after: 1, kind: "cv" }]);
});

test("教材の全文: 語の数が合い、つながりの数がほどほど", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  let items = 0, mismatched = 0, gaps = 0, linked = 0;
  const byKind: Record<string, number> = {};
  const samples: string[] = [];
  for (const f of files) {
    const d = JSON.parse(readFileSync(DIR + f, "utf8"));
    if (!d.text || !Array.isArray(d.words)) continue;
    items++;
    const tokens = d.text.split(/\s+/).filter(Boolean);
    if (tokens.length !== d.words.length) {
      mismatched++;
      continue;
    }
    const links = findLinks(d.text, d.words);
    gaps += Math.max(0, d.words.length - 1);
    linked += links.length;
    for (const l of links) byKind[l.kind + (l.flap ? "+flap" : "") + (l.glide ? "+" + l.glide : "")] = (byKind[l.kind + (l.flap ? "+flap" : "") + (l.glide ? "+" + l.glide : "")] ?? 0) + 1;
    if (samples.length < 40 && links.length && files.indexOf(f) % 17 === 0) samples.push(show(d.text, links));
  }
  console.log({ items, mismatched, gaps, linked, share: +(linked / gaps).toFixed(3), byKind });
  console.log(samples.join("\n"));
  assert.equal(mismatched, 0, "文の空白区切りと語の数が合わない文がある");
  assert.ok(linked / gaps > 0.1 && linked / gaps < 0.45, `つながりの割合 ${linked / gaps}`);
});
