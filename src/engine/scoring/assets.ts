/**
 * Loading a model folder (meta.json + regressor + mel filters + ONNX) with fetch().
 * Works in a Worker, a page or Node (http(s) URLs). The ONNX bytes are kept in the
 * Cache Storage API when available, so the second visit does not download 29 MB again.
 */
import type { MelFilterBank, ModelMeta, RegressorJson, ScorerAssets } from "./types.ts";

export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

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

type CacheLike = { match(url: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | undefined>; put(url: string, r: unknown): Promise<void> };
type CachesLike = { open(name: string): Promise<CacheLike> };

/** ONNX bytes of meta.files.onnx[variant] (default: meta.files.defaultOnnx). */
export async function loadModelBytes(
  modelBaseUrl: string,
  meta: ModelMeta,
  variant: string = meta.files.defaultOnnx,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  cacheName = "pronunciation-models-v1",
): Promise<Uint8Array> {
  const file = meta.files.onnx[variant];
  if (!file) throw new Error(`model has no ONNX variant "${variant}"`);
  const url = join(modelBaseUrl, file);
  const caches = (globalThis as { caches?: CachesLike }).caches;
  if (caches) {
    try {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(url);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
      const r = await fetchImpl(url);
      if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
      const buf = await r.arrayBuffer();
      const R = (globalThis as { Response?: new (b: ArrayBuffer) => unknown }).Response;
      if (R) await cache.put(url, new R(buf.slice(0)));
      return new Uint8Array(buf);
    } catch {
      // private mode / quota: fall through to a plain download
    }
  }
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
