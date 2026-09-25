import type { SVGProps } from "react";

function IconBase({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const TodayIcon = (p: SVGProps<SVGSVGElement>) => (
  <IconBase {...p}><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></IconBase>
);
export const DumpIcon = (p: SVGProps<SVGSVGElement>) => (
  <IconBase {...p}><path d="M5 6h14M5 10h9M5 14h12M5 18h7"/></IconBase>
);
export const PlansIcon = (p: SVGProps<SVGSVGElement>) => (
  <IconBase {...p}><path d="M5 18V7m0 0h8l-1.5 3L13 13H5"/></IconBase>
);
export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => (
  <IconBase {...p}><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></IconBase>
);
export const DirectionIcon = (p: SVGProps<SVGSVGElement>) => (
  <IconBase {...p}><circle cx="12" cy="12" r="8"/><path d="m14.6 9.4-1.5 3.7-3.7 1.5 1.5-3.7 3.7-1.5Z"/></IconBase>
);
export const ReviewIcon = (p: SVGProps<SVGSVGElement>) => (
  <IconBase {...p}><path d="M4 18V9M9 18V5M14 18v-6M19 18V8"/></IconBase>
);
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <IconBase {...p}><path d="M12 5v14M5 12h14"/></IconBase>
);
export const SparkIcon = (p: SVGProps<SVGSVGElement>) => (
  <IconBase {...p}><path d="m12 3 1.15 4.2L17 9l-3.85 1.8L12 15l-1.15-4.2L7 9l3.85-1.8L12 3ZM18.5 14l.55 1.95L21 17l-1.95 1.05L18.5 20l-.55-1.95L16 17l1.95-1.05L18.5 14Z"/></IconBase>
);
