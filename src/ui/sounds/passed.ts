/** 発音一覧: the sounds you passed (said the word and the sound was heard as itself), on this device */
const KEY = "kara.v1.sounds-passed";

export function loadPassed(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function savePassed(s: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* private mode: it stays for this visit */
  }
}
