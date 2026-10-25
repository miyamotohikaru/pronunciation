import { readFileSync } from "node:fs";

/** PCM WAV（16bit 整数 or 32bit 浮動小数、モノラル/ステレオ）を読み、モノラルの Float32Array にする。 */
export function readWav(path: string): { sampleRate: number; samples: Float32Array } {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error(`not a WAV: ${path}`);
  let off = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = { format: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true), sampleRate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
      // WAVE_FORMAT_EXTENSIBLE は中のサブフォーマットを見る
      if (fmt.format === 0xfffe) fmt.format = dv.getUint16(body + 24, true);
    } else if (id === "data" && fmt) {
      const { channels, bits, format } = fmt;
      const bytes = bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - body) / (bytes * channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * bytes;
          s += format === 3 && bits === 32 ? dv.getFloat32(p, true) : bits === 16 ? dv.getInt16(p, true) / 32768 : bits === 32 ? dv.getInt32(p, true) / 2147483648 : 0;
        }
        out[i] = s / channels;
      }
      return { sampleRate: fmt.sampleRate, samples: out };
    }
    off = body + size + (size % 2);
  }
  throw new Error(`no data chunk: ${path}`);
}
