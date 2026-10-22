"use client";

/**
 * A transcription you can ask about: tap /ráɪs/ (on the symbol you wonder about) and a small tip
 * opens under it — every symbol of the word as a chip, the tapped one explained: its name, how to
 * say it, the stress mark when it has one, and a link to its sound page. Names load on the first
 * tap (legend-data, a small separate chunk). Escape, the ×, or a tap outside closes it.
 *
 *   <IpaTip ipa="/ráɪs/" className="text-[17px]" />
 */
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import BreakText from "@/components/BreakText";
import { IconClose } from "../icons";
import { ipaTokens } from "./ipaTokens";
import type { TipSymbol } from "./legend-data";

type Data = { symbols: TipSymbol[]; primary: TipSymbol | null; secondary: TipSymbol | null };
let data: Promise<Data> | null = null;
const load = () =>
  (data ??= import("./legend-data").then((m) => ({ symbols: m.SYMBOLS, primary: m.MARKS.primary, secondary: m.MARKS.secondary })));

export type IpaTipProps = {
  /** with or without the slashes */
  ipa: string;
  className?: string;
  /** what the transcription is of (screen readers): "rice" */
  of?: string;
};

export default function IpaTip({ ipa, className, of }: IpaTipProps) {
  const tokens = useMemo(() => ipaTokens(ipa), [ipa]);
  const [open, setOpen] = useState<number | null>(null);
  const [d, setD] = useState<Data | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; arrow: number } | null>(null);
  const id = useId();

  const show = (i: number) => {
    void load().then(setD);
    setOpen(i);
  };
  const close = () => {
    setOpen(null);
    btn.current?.focus({ preventScroll: true });
  };

  // place it under the transcription, inside the screen; the arrow points at the tapped symbol
  useLayoutEffect(() => {
    if (open === null || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const sym = btn.current.querySelector<HTMLElement>(`[data-i="${open}"]`)?.getBoundingClientRect() ?? r;
    const vw = document.documentElement.clientWidth;
    const width = Math.min(340, vw - 32);
    const left = Math.min(Math.max(16, sym.left + sym.width / 2 - width / 2), vw - width - 16);
    setPos({ top: r.bottom + 10, left, width, arrow: Math.min(width - 22, Math.max(14, sym.left + sym.width / 2 - left)) });
  }, [open]);

  useEffect(() => {
    if (open === null) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(null);
    };
    const away = () => setOpen(null);
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("scroll", away, { passive: true, capture: true });
    window.addEventListener("resize", away);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("scroll", away, { capture: true });
      window.removeEventListener("resize", away);
    };
  }, [open]);

  const tok = open !== null ? tokens[open] : null;
  const info = tok?.symbol && d ? (d.symbols.find((s) => s.symbol === tok.symbol) ?? null) : null;
  const mark = tok?.stress === 1 ? d?.primary : tok?.stress === 2 ? d?.secondary : null;
  const firstSym = tokens.findIndex((t) => t.symbol);
  const face = "ipa";

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-expanded={open !== null}
        aria-controls={open !== null ? id : undefined}
        aria-label={`${of ? `${of} の` : ""}発音記号 ${ipa}。押すと記号の読み方が出ます`}
        onClick={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
          const i = el ? Number(el.dataset.i) : firstSym;
          if (open === i) setOpen(null);
          else if (i >= 0) show(i);
        }}
        onPointerEnter={() => void load()}
        className={`ipa -my-2 inline-flex min-h-11 cursor-pointer items-center rounded-[10px] py-2 underline decoration-dotted decoration-[0.06em] underline-offset-[0.25em] ${className ?? ""}`}
        style={{ textDecorationColor: "color-mix(in srgb, currentColor 45%, transparent)" }}
      >
        <span aria-hidden>/</span>
        {tokens.map((t, i) => (
          <span key={i} data-i={t.symbol ? i : undefined} aria-hidden className={open === i ? "rounded-[4px] bg-[color-mix(in_srgb,currentColor_16%,transparent)]" : undefined}>
            {t.text}
          </span>
        ))}
        <span aria-hidden>/</span>
      </button>

      {open !== null && tok && pos ? (
        <div
          ref={pop}
          id={id}
          role="dialog"
          aria-label="発音記号の読み方"
          className="anim-fade fixed z-40 rounded-[18px] bg-(--ink) px-4 pb-4 pt-3 text-(--paper) shadow-[0_10px_30px_rgba(12,15,51,0.3)]"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <span aria-hidden className="absolute -top-[6px] size-3 rotate-45 rounded-[2px] bg-(--ink)" style={{ left: pos.arrow - 6 }} />
          {/* every symbol of the word; the one explained is filled */}
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="group" aria-label="記号をえらぶ">
              {tokens.map((t, i) =>
                t.symbol ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setOpen(i)}
                    aria-pressed={i === open}
                    className={`${face} grid h-11 min-w-11 place-items-center rounded-[10px] px-2 text-[20px]`}
                    style={i === open ? { background: "var(--paper)", color: "var(--ink)" } : { background: "rgba(255,255,255,0.1)" }}
                  >
                    {t.text}
                  </button>
                ) : null,
              )}
            </div>
            <button type="button" onClick={close} aria-label="閉じる" className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full">
              <IconClose size={18} />
            </button>
          </div>
          <div className="mt-3 min-h-[64px]" aria-live="polite">
            {info ? (
              <>
                <p className="text-[16px] font-bold leading-snug">
                  <span className={`${face} mr-2 text-[18px]`}>{info.symbol}</span>
                  {info.nameJa}
                </p>
                <p className="jp mt-1 text-[14px] font-medium leading-relaxed opacity-90">
                  <BreakText text={info.howJa.replace(/\n/g, "◆")} />
                </p>
                {mark ? (
                  <p className="jp mt-2 text-[13px] font-medium leading-relaxed opacity-85">
                    <span className={`${face} mr-1 font-bold`}>{mark.symbol}</span>
                    {mark.nameJa}：{mark.howJa.replace(/\n/g, "")}
                  </p>
                ) : null}
                {info.sound ? (
                  <Link href={`/sounds/${info.sound}`} className="mt-3 inline-flex h-11 items-center rounded-full bg-[rgba(255,255,255,0.12)] px-4 text-[14px] font-bold">
                    この音のページへ
                  </Link>
                ) : null}
              </>
            ) : (
              <p className="text-[14px] font-medium opacity-80">{d ? "この記号の説明はありません。" : "読み込んでいます"}</p>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
