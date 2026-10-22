import type { Metadata, Viewport } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "クレジット｜発音カラオケ" };
export const viewport: Viewport = { themeColor: "#f4f5fa" };

type Credit = { what: string; name: string; by: string; license: string; url: string; note?: string };

const CREDITS: Credit[] = [
  {
    what: "口の断面図（音のカード）",
    name: "Midsagittal articulation illustrations",
    by: "Richard Wright, Dan McCloy（University of Washington, Linguistics 450/550, 2011）",
    license: "CC0 1.0（パブリック・ドメイン）",
    url: "https://github.com/drammock/phonetics-teaching-assets",
    note: "Wikimedia Commons の「IPA … Sagittal Section.svg」と同じ図です。このアプリでは、口のまわりを切り抜き、色を変え、舌・あごの形を2つの図のあいだで動かしています。",
  },
  { what: "お手本の声", name: "Kokoro-82M（声: af_heart, am_michael）", by: "hexgrad", license: "Apache License 2.0", url: "https://huggingface.co/hexgrad/Kokoro-82M" },
  { what: "英文の読み（音素）", name: "misaki", by: "hexgrad", license: "Apache License 2.0", url: "https://github.com/hexgrad/misaki" },
  {
    what: "音の聞き取り",
    name: "whisper-base-en-phoneme-ctc",
    by: "vb223（OpenAI Whisper base.en の encoder を使用）",
    license: "MIT License",
    url: "https://huggingface.co/vb223/whisper-base-en-phoneme-ctc",
    note: "スマホで速く動く小さなモデルは、これをもとにこのアプリで作りました（教師モデル facebook/wav2vec2-lv-60-espeak-cv-ft, Apache License 2.0）。",
  },
  {
    what: "採点の調整",
    name: "speechocean762",
    by: "Junbo Zhang ほか（Interspeech 2021）",
    license: "CC BY 4.0",
    url: "https://www.openslr.org/101/",
    note: "採点の回帰モデルの学習に使っています。",
  },
  { what: "発音辞書", name: "CMU Pronouncing Dictionary（CMUdict）", by: "Carnegie Mellon University（Copyright 1993–2014）", license: "自由に利用可（出典の明記）", url: "https://github.com/cmusphinx/cmudict" },
  { what: "ブラウザでの推論", name: "ONNX Runtime Web", by: "Microsoft", license: "MIT License", url: "https://github.com/microsoft/onnxruntime" },
  { what: "書体", name: "M PLUS Rounded 1c ／ Atkinson Hyperlegible Next ／ Gentium Plus", by: "M+ FONTS PROJECT ／ Braille Institute ／ SIL International", license: "SIL Open Font License 1.1", url: "https://fonts.google.com/" },
];

/** /credits — the open work this app is built on, with its licences */
export default function Page() {
  return (
    <div className="kara field-calm flex min-h-dvh flex-col">
      <header className="mx-auto flex h-14 w-full max-w-[720px] items-center px-4">
        <Link href="/home" className="text-[15px] font-bold">
          ← ホーム
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-10">
        <h1 className="text-[24px] font-black leading-tight">クレジット</h1>
        <p className="jp mt-2 text-[15px] font-medium leading-relaxed">
          このアプリは、自由に使えるように公開された作品の上に作られています。
          <br />
          作った方々に感謝します。
        </p>
        <ul className="mt-6 flex flex-col gap-3">
          {CREDITS.map((c) => (
            <li key={c.name} className="rounded-[16px] bg-(--paper) px-4 py-4">
              <p className="text-[13px] font-medium opacity-75">{c.what}</p>
              <p className="en mt-1 text-[16px] font-bold leading-snug">{c.name}</p>
              <p className="mt-1 text-[14px] font-medium leading-snug">{c.by}</p>
              <p className="mt-1 text-[14px] font-bold">{c.license}</p>
              {c.note ? <p className="jp mt-2 text-[14px] font-medium leading-relaxed opacity-90">{c.note}</p> : null}
              <a href={c.url} target="_blank" rel="noreferrer" className="en mt-2 inline-block break-all text-[13px] font-medium underline underline-offset-2">
                {c.url}
              </a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
