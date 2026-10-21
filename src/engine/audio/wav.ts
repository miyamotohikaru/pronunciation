/**
 * RIFF/WAVE encode (debug downloads) and decode (Node tests, build-time analysis).
 * No browser or Node dependencies.
 */

/** mono PCM → WAV bytes. 16-bit integer (default, with clipping) or 32-bit float. */
export function encodeWav(pcm: Float32Array, sampleRate: number, opts: { float?: boolean } = {}): Uint8Array<ArrayBuffer> {
  const float = !!opts.float;
  const bytesPerSample = float ? 4 : 2;
  const dataBytes = pcm.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, Math.round(sampleRate), true);
  v.setUint32(28, Math.round(sampleRate) * bytesPerSample, true);
  v.setUint16(32, bytesPerSample, true);
  v.setUint16(34, bytesPerSample * 8, true);
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  let o = 44;
  if (float) {
    for (let i = 0; i < pcm.length; i++, o += 4) v.setFloat32(o, pcm[i], true);
  } else {
    for (let i = 0; i < pcm.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(o, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
    }
  }
  return new Uint8Array(buf);
}

export type DecodedWav = { sampleRate: number; channels: Float32Array[]; mono: Float32Array };

/** WAV bytes → Float32 channels (PCM 8/16/24/32-bit, IEEE float 32/64, WAVE_FORMAT_EXTENSIBLE). */
export function decodeWav(input: ArrayBuffer | Uint8Array): DecodedWav {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o: number) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  while (o + 8 <= u8.length) {
    const id = tag(o);
    const len = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === "fmt ") {
      let format = v.getUint16(body, true);
      const channels = v.getUint16(body + 2, true);
      const rate = v.getUint32(body + 4, true);
      const bits = v.getUint16(body + 14, true);
      if (format === 0xfffe && len >= 26) format = v.getUint16(body + 24, true); // extensible → sub-format GUID's first 2 bytes
      fmt = { format, channels, rate, bits };
    } else if (id === "data") {
      dataOff = body;
      dataLen = Math.min(len, u8.length - body); // tolerate streaming writers that leave len = 0xFFFFFFFF
    }
    o = body + len + (len & 1);
  }
  if (!fmt || dataOff < 0) throw new Error("WAV without fmt/data chunk");
  const { format, channels, rate, bits } = fmt;
  const bps = bits / 8;
  const frames = Math.floor(dataLen / (bps * channels));
  const chans = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const p = dataOff + (i * channels + c) * bps;
      let s: number;
      if (format === 3) s = bits === 64 ? v.getFloat64(p, true) : v.getFloat32(p, true);
      else if (bits === 16) s = v.getInt16(p, true) / 32768;
      else if (bits === 24) s = (((u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16)) << 8) >> 8) / 8388608;
      else if (bits === 32) s = v.getInt32(p, true) / 2147483648;
      else if (bits === 8) s = (u8[p] - 128) / 128;
      else throw new Error(`unsupported WAV: format ${format}, ${bits} bits`);
      chans[c][i] = s;
    }
  }
  let mono: Float32Array;
  if (channels === 1) mono = chans[0];
  else {
    mono = new Float32Array(frames);
    for (const ch of chans) for (let i = 0; i < frames; i++) mono[i] += ch[i] / channels;
  }
  return { sampleRate: rate, channels: chans, mono };
}
