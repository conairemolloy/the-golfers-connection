import type { ReactNode } from "react";
import { cx } from "./cx";

/** Same idea as Label, smaller — sits above a heading. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("font-mono text-[8px] uppercase tracking-[0.16em] text-stone", className)}>{children}</p>;
}
