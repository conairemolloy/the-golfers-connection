import type { ReactNode } from "react";
import { cx } from "./cx";

/** Exported so Field's own <label> can share the exact same styling. */
export const LABEL_CLASSES = "font-mono text-[9px] uppercase tracking-[0.14em] text-gilt";

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(LABEL_CLASSES, className)}>{children}</span>;
}
