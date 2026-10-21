/**
 * Target phones -> model units.
 *
 * A "unit" is a set of model tokens scored together (logsumexp of their log-probs).
 * The model's meta.units says which tokens make up each ARPAbet phone (this is where
 * stress variants are merged). Flap (DX) and glottal T (Q) accept T or D.
 */
import type { LogProbs, ModelMeta } from "./types.ts";

export type PhoneToken = {
  /** As written in the variant, without the "?" (e.g. "AH0", "DX"). */
  symbol: string;
  /** Stress digit removed (e.g. "AH"). */
  base: string;
  optional: boolean;
};

export const VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);

/** Symbols that are not ARPAbet phones of the model but accepted in targets. */
const ALIASES: Record<string, string[]> = { DX: ["T", "D"], Q: ["T", "D"] };
/** One-hot class used for an alias. */
const ALIAS_CLASS: Record<string, string> = { DX: "T", Q: "T" };

export function baseOf(symbol: string): string {
  return /[0-2]$/.test(symbol) ? symbol.slice(0, -1) : symbol;
}

export function isVowel(symbol: string): boolean {
  return VOWELS.has(baseOf(symbol));
}

export function parseVariant(v: string | string[]): PhoneToken[] {
  const raw = typeof v === "string" ? v.trim().split(/\s+/).filter(Boolean) : v;
  return raw.map((r) => {
    let s = r.trim().toUpperCase();
    let optional = false;
    if (s.endsWith("?")) {
      optional = true;
      s = s.slice(0, -1);
    }
    const base = baseOf(s);
    if (base === "Q") optional = true; // a glottal stop may leave no trace at all
    return { symbol: s, base, optional };
  });
}

/** Unit registry for one utterance: column 0 is the blank. */
export type UnitSpace = {
  /** token ids per column (column 0 = [blank]) */
  tokens: number[][];
  /** column label, e.g. "AA", "T|D" */
  names: string[];
  /** column index per ARPAbet base symbol in meta.units */
  baseColumn: Map<string, number>;
  /** columns that compete in GOP (every meta unit), blank excluded */
  phoneColumns: number[];
};

export function makeUnitSpace(meta: ModelMeta): UnitSpace {
  const tokens: number[][] = [[meta.blank]];
  const names = ["<blank>"];
  const baseColumn = new Map<string, number>();
  const phoneColumns: number[] = [];
  for (const [sym, ids] of Object.entries(meta.units)) {
    baseColumn.set(sym, tokens.length);
    phoneColumns.push(tokens.length);
    tokens.push(ids.slice());
    names.push(sym);
  }
  return { tokens, names, baseColumn, phoneColumns };
}

/** Column for a target phone symbol (adds alias columns such as T|D on demand). */
export function columnFor(space: UnitSpace, symbol: string): number {
  const exact = space.baseColumn.get(symbol);
  if (exact !== undefined) return exact;
  const base = baseOf(symbol);
  const b = space.baseColumn.get(base);
  if (b !== undefined) return b;
  const alias = ALIASES[base];
  if (!alias) throw new Error(`phone ${symbol} is not in the model's units`);
  const name = alias.join("|");
  const existing = space.names.indexOf(name);
  if (existing >= 0) return existing;
  const ids: number[] = [];
  for (const a of alias) {
    const col = space.baseColumn.get(a);
    if (col === undefined) throw new Error(`alias ${base} needs unit ${a}`);
    for (const id of space.tokens[col]) if (!ids.includes(id)) ids.push(id);
  }
  space.tokens.push(ids);
  space.names.push(name);
  return space.tokens.length - 1;
}

/** One-hot class of a phone for the regressor (exact symbol, then base, then alias). */
export function regressorClass(meta: ModelMeta, symbol: string): number {
  const c = meta.regressor.classOf;
  if (symbol in c) return c[symbol];
  const base = baseOf(symbol);
  if (base in c) return c[base];
  const alias = ALIAS_CLASS[base];
  if (alias && alias in c) return c[alias];
  throw new Error(`no regressor class for ${symbol}`);
}

/** True if two columns share a model token (then they never compete with each other). */
export function overlaps(space: UnitSpace, a: number, b: number): boolean {
  const ta = space.tokens[a];
  for (const id of space.tokens[b]) if (ta.includes(id)) return true;
  return false;
}

/**
 * Emission matrix [frames, columns] (row-major float32): column c = logsumexp of the
 * model log-probs over space.tokens[c], computed in float64 and stored as float32.
 */
export function buildEmissions(lp: LogProbs, frames: number, space: UnitSpace): Float32Array {
  const C = space.tokens.length;
  const V = lp.vocabSize;
  const out = new Float32Array(frames * C);
  const src = lp.data;
  for (let t = 0; t < frames; t++) {
    const row = t * V;
    for (let c = 0; c < C; c++) {
      const ids = space.tokens[c];
      if (ids.length === 1) {
        out[t * C + c] = src[row + ids[0]];
        continue;
      }
      let m = -Infinity;
      for (const id of ids) if (src[row + id] > m) m = src[row + id];
      if (m === -Infinity) {
        out[t * C + c] = -Infinity;
        continue;
      }
      let s = 0;
      for (const id of ids) s += Math.exp(src[row + id] - m);
      out[t * C + c] = m + Math.log(s);
    }
  }
  return out;
}
