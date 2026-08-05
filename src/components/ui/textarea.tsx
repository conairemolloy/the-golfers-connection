import type { TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import { LABEL_CLASSES } from "./label";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  /** Dark shell by default; "paper" for a field sitting on a PaperCard, like login's. */
  tone?: "dark" | "paper";
};

export function Textarea({ label, tone = "dark", className, id, name, rows = 3, ...props }: TextareaProps) {
  const fieldId = id ?? name;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className={LABEL_CLASSES}>
        {label}
      </label>
      <textarea
        id={fieldId}
        name={name}
        rows={rows}
        className={cx(
          "rounded-hairline border px-3 py-2 font-sans text-base outline-none transition-colors focus:border-gilt motion-reduce:transition-none",
          tone === "paper"
            ? "border-ink/25 bg-paper text-ink placeholder:text-ink/40"
            : "border-stone/30 bg-transparent text-paper placeholder:text-stone/50",
          className,
        )}
        {...props}
      />
    </div>
  );
}
