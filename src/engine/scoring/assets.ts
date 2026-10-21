/**
 * Loading a model folder (meta.json + regressor + mel filters + ONNX) with fetch().
 * Works in a Worker, a page or Node (http(s) URLs). The ONNX bytes are kept in the Cache
 * Storage API when available (keyed by the file's hash, older copies are dropped), so a
 * second visit does not download the 24 MB again.
 */
import type { MelFilterBank, ModelMeta, RegressorJson, ScorerAssets } from "./types.ts";

type BodyReader = { read(): Promise<{ done: boolean; value?: Uint8Array }> };
type ResponseLike = {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  body?: { getReader(): BodyReader } | null;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
};
export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<ResponseLike>;

export type ModelProgress = { loaded: number; total: number; cached: boolean };

const join = (base: string, file: string) => (base.endsWith("/") ? base : base + "/") + file;

export async function loadAssets(modelBaseUrl: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<ScorerAssets> {
  const get = async <T>(url: string): Promise<T> => {
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
    return (await r.json()) as T;
  };
  const meta = await get<ModelMeta>(join(modelBaseUrl, "meta.json"));
  if (meta.schema !== 1) throw new Error(`unsupported meta schema ${meta.schema}`);
  const [regressor, melFilters] = await Promise.all([
    get<RegressorJson>(join(modelBaseUrl, meta.files.regressor)),
    get<MelFilterBank>(join(modelBaseUrl, meta.files.melFilters)),
  ]);
  return { meta, regressor, melFilters };
}

type CacheLike = {
  match(url: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | undefined>;
  put(url: string, r: unknown): Promise<void>;
  keys(): Promise<readonly { url: string }[]>;
  delete(url: string): Promise<boolean>;
};
type CachesLike = { open(name: string): Promise<CacheLike> };

/** Reads a response body, reporting progress (content-length when the server sends it). */
async function readBody(r: ResponseLike, onProgress?: (p: ModelProgress) => void): Promise<Uint8Array> {
  const total = Number(r.headers?.get("content-length") ?? 0) || 0;
  const reader = r.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await r.arrayBuffer());
    onProgress?.({ loaded: buf.length, total: buf.length, cached: false });
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total: Math.max(total, loaded), cached: false });
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Bytes of `url`, kept in the Cache Storage API under `url?v=<version>`: the first visit
 * downloads (with progress), later visits read the cache; older versions of the same file
 * are dropped. Falls back to a plain download where storage is blocked.
 */
export async function fetchCached(
  url: string,
  version: string | undefined,
  onProgress?: (p: ModelProgress) => void,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  cacheName = "pronunciation-models-v1",
): Promise<Uint8Array> {
  const key = version ? `${url}?v=${version}` : url;
  const caches = (globalThis as unknown as { caches?: CachesLike }).caches;
  const R = (globalThis as unknown as { Response?: new (b: Uint8Array) => unknown }).Response;
  let cache: CacheLike | null = null;
  if (caches) {
    try {
      cache = await caches.open(cacheName);
      const hit = await cache.match(key);
      if (hit) {
        const buf = new Uint8Array(await hit.arrayBuffer());
        onProgress?.({ loaded: buf.length, total: buf.length, cached: true });
        return buf;
      }
    } catch {
      cache = null; // private mode / blocked storage: plain download
    }
  }
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
  const bytes = await readBody(r, onProgress);
  if (cache && R) {
    try {
      await cache.put(key, new R(bytes.slice()));
      const file = url.split("?")[0].split("/").pop() ?? "";
      for (const k of await cache.keys()) {
        const path = k.url.split("?")[0];
        if (path.endsWith("/" + file) && k.url !== new URL(key, k.url).href) await cache.delete(k.url);
      }
    } catch {
      // quota: keep going without the cache
    }
  }
  return bytes;
}

/** ONNX bytes of meta.files.onnx[variant] (default: meta.files.defaultOnnx), cached by hash. */
export async function loadModelBytes(
  modelBaseUrl: string,
  meta: ModelMeta,
  variant: string = meta.files.defaultOnnx,
  onProgress?: (p: ModelProgress) => void,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<Uint8Array> {
  const file = meta.files.onnx[variant];
  if (!file) throw new Error(`model has no ONNX variant "${variant}"`);
  return fetchCached(join(modelBaseUrl, file), meta.files.hash?.[variant], onProgress, fetchImpl);
}
