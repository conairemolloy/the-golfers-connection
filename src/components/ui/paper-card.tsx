import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Paper background, ink text — the one place a shadow is allowed. What
 * the login form, the ledger and the round card sit on.
 */
export function PaperCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-hairline bg-paper p-6 text-ink shadow-[0_12px_28px_-8px_rgba(6,23,19,0.45)]", className)}>
      {children}
    </div>
  );
}
