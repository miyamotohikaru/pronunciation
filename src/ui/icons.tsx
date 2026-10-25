/** Inline icons, drawn on a 24 grid with round joins to match M PLUS Rounded. Decorative: aria-hidden. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 24, rest: SVGProps<SVGSVGElement> = {}) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...rest,
});

export const IconMic = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor" stroke="none" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" />
  </svg>
);

export const IconStop = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPlay = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2Z" fill="currentColor" stroke="none" />
  </svg>
);

/** お手本: a speaker */
export const IconSpeaker = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
    <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11" />
  </svg>
);

/** ゆっくり: a turtle */
export const IconTurtle = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M4 15.5c0-4.2 3.1-7.5 7-7.5s7 3.3 7 7.5z" fill="currentColor" stroke="none" />
    <path d="M18 13.2c1.2-.2 2.2-1 2.6-2.2M6 15.5l-.8 2.6M15.5 15.5l.8 2.6M3 15.5h17" />
    <circle cx="20.4" cy="10.4" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconClose = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M6 6l12 12M18 6 6 18" strokeWidth={2.8} />
  </svg>
);

export const IconSwap = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" />
  </svg>
);

export const IconSound = ({ size, muted, ...r }: P & { muted?: boolean }) => (
  <svg {...base(size, r)}>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
    {muted ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11" />}
  </svg>
);

/** 次へ: the karaoke remote's "next song" */
export const IconNext = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M5 6.2v11.6a.8.8 0 0 0 1.25.66L14.5 13a.8.8 0 0 0 0-1.32L6.25 5.54A.8.8 0 0 0 5 6.2Z" fill="currentColor" stroke="none" />
    <path d="M18.5 6v12" strokeWidth={2.8} />
  </svg>
);

export const IconRetry = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.5H9" />
  </svg>
);

export const IconStar = ({ size, filled, ...r }: P & { filled?: boolean }) => (
  <svg {...base(size, r)} strokeWidth={2}>
    <path
      d="m12 3.2 2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9L3.4 9.5l6-.8z"
      fill={filled ? "currentColor" : "none"}
    />
  </svg>
);

export const IconCheck = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="m5 12.5 4.2 4.2L19 7" strokeWidth={3} />
  </svg>
);

export const IconFlame = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path
      d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.2 2.2-5.3 3.6-7.4.4 1.7 1.3 2.7 2.4 3.3C11.3 7.6 12.6 5 15 3c-.2 3 3.5 5.5 3.5 10.6C18.5 17.9 15.9 21 12 21Z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);
