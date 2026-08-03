import type { ReactNode } from "react";
import { cx } from "./cx";

/** Raised surface, hairline border, 2px radius. No shadow — that's PaperCard's. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-hairline border border-stone/20 bg-raised p-6", className)}>{children}</div>;
}
