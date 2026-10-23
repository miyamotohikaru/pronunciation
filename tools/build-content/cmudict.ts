import { readFileSync } from "node:fs";

/** CMUdict を読み、語 → 発音の候補（ARPAbet の配列）の表にする。 */
export function loadCmudict(path: string): Map<string, string[][]> {
  const dict = new Map<string, string[][]>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith(";;;")) continue;
    const [head, ...rest] = line.split("#")[0].trim().split(/\s+/);
    if (!head || rest.length === 0) continue;
    const word = head.replace(/\(\d+\)$/, "");
    const list = dict.get(word) ?? [];
    list.push(rest);
    dict.set(word, list);
  }
  return dict;
}
