/** Inline SVG icons. Kept in one file so sizes and stroke weights stay consistent. */

type P = { size?: number; className?: string };
const box = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor" });

export const MenuIcon = ({ size = 20 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" /></svg>
);
export const PlusIcon = ({ size = 18 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6z" /></svg>
);
export const HistoryIcon = ({ size = 18 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M12 3a9 9 0 1 1-9 9h2a7 7 0 1 0 7-7v3L8 5l4-4v2z" /></svg>
);
export const DocIcon = ({ size = 19 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm10 1.5V10h4.5L14 5.5z" /></svg>
);
export const GearIcon = ({ size = 19 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.9 4a8.9 8.9 0 0 1-.1 1.3l2.1 1.6-2 3.5-2.5-1a9 9 0 0 1-2.2 1.3l-.4 2.6h-4l-.4-2.6a9 9 0 0 1-2.2-1.3l-2.5 1-2-3.5 2.1-1.6a9 9 0 0 1 0-2.6L1.7 8.1l2-3.5 2.5 1a9 9 0 0 1 2.2-1.3L8.8 1.7h4l.4 2.6a9 9 0 0 1 2.2 1.3l2.5-1 2 3.5-2.1 1.6c.06.43.1.86.1 1.3z" /></svg>
);
export const ThemeIcon = ({ size = 19 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" /></svg>
);
export const SendIcon = ({ size = 19 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M3 20.5v-6l8-2.5-8-2.5v-6L21 12 3 20.5z" /></svg>
);
export const CaretIcon = ({ size = 16, className }: P) => (
  <svg {...box(size)} className={className} aria-hidden="true"><path d="M7 10l5 5 5-5z" /></svg>
);
export const InfoIcon = ({ size = 15 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-6h2zm0-8h-2V7h2z" /></svg>
);
export const WarnIcon = ({ size = 17 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z" /></svg>
);
export const CheckIcon = ({ size = 16 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
);
export const XIcon = ({ size = 16 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></svg>
);
export const ThumbUpIcon = ({ size = 17 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M1 21h4V9H1v12zM23 10a2 2 0 0 0-2-2h-6.31l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L14.17 1 7.59 7.59A2 2 0 0 0 7 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" /></svg>
);
export const ThumbDownIcon = ({ size = 17 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M15 3H6a2 2 0 0 0-1.84 1.22L1.14 11.27c-.09.23-.14.47-.14.73v2a2 2 0 0 0 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59A2 2 0 0 0 17 15V5a2 2 0 0 0-2-2zm4 0v12h4V3h-4z" /></svg>
);
export const CopyIcon = ({ size = 17 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" /></svg>
);
export const PencilIcon = ({ size = 15 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
);
export const TrashIcon = ({ size = 15 }: P) => (
  <svg {...box(size)} aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
);

/** The brand mark. Gradient is inlined so it survives being rendered in isolation. */
export function Sparkle({ size = 30, spinning = false }: { size?: number; spinning?: boolean }) {
  const id = "spark-grad";
  return (
    <svg
      className={`spark${spinning ? " spin" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4285f4" />
          <stop offset=".5" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} d="M12 2l2.2 6.1L20.5 10l-6.3 1.9L12 18l-2.2-6.1L3.5 10l6.3-1.9L12 2z" />
    </svg>
  );
}
