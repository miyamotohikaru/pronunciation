/**
 * DAM-style two-sided slider: says which way you were off, not just "bad".
 * Seven steps, the centre is the model.
 */
export type DirectionSliderProps = {
  label: string;
  left: string;
  right: string;
  /** -3 … +3 */
  step: number;
};

const AMOUNT = ["", "ほんの少し", "少し", "かなり"];

export function readSlider(step: number, left: string, right: string) {
  if (step === 0) return "お手本どおり";
  return `${AMOUNT[Math.min(3, Math.abs(step))]}${step < 0 ? left : right}`;
}

export default function DirectionSlider({ label, left, right, step }: DirectionSliderProps) {
  const pos = ((Math.max(-3, Math.min(3, step)) + 3) / 6) * 100;
  const reading = readSlider(step, left, right);
  return (
    <div className="w-full pb-3">
      <p className="flex items-baseline gap-3 leading-none">
        <span className="text-[15px] font-black">{label}</span>
        <span className="text-[14px] font-extrabold">{reading}</span>
      </p>
      {/* fixed label columns so every slider's centre (the model) lines up */}
      <div className="mt-[14px] grid grid-cols-[56px_1fr_56px] items-center gap-2" aria-hidden>
        <span className="text-right text-[12px] font-extrabold leading-none">{left}</span>
        <div className="relative h-[34px]">
          <span className="absolute inset-x-0 top-[16px] h-[4px] rounded-full bg-(--field-deep)" />
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={i}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--field-deep)"
              style={{ left: `${(i / 6) * 100}%`, width: i === 3 ? 4 : 3, height: i === 3 ? 22 : 10 }}
            />
          ))}
          <span className="absolute left-1/2 top-[34px] -translate-x-1/2 whitespace-nowrap text-[10px] font-extrabold leading-none">お手本</span>
          <span
            className="absolute top-1/2 grid size-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-(--ink) bg-(--voice)"
            style={{ left: `${pos}%` }}
          />
        </div>
        <span className="text-[12px] font-extrabold leading-none">{right}</span>
      </div>
      <span className="sr-only">{`${label}：${reading}`}</span>
    </div>
  );
}
