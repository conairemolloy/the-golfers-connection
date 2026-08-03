import { cx } from "./cx";

export function Rule({ className }: { className?: string }) {
  return <hr className={cx("border-t border-stone/20", className)} />;
}
