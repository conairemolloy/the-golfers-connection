import type { SelectHTMLAttributes } from "react";
import { cx } from "./cx";
import { LABEL_CLASSES } from "./label";

export interface SelectOption {
  value: string;
  label: string;
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: SelectOption[];
  /** Dark shell by default; "paper" for a field sitting on a PaperCard, like login's. */
  tone?: "dark" | "paper";
};

export function Select({ label, options, tone = "dark", className, id, name, ...props }: SelectProps) {
  const fieldId = id ?? name;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className={LABEL_CLASSES}>
        {label}
      </label>
      <select
        id={fieldId}
        name={name}
        className={cx(
          "min-h-11 rounded-hairline border px-3 font-sans text-base outline-none transition-colors focus:border-gilt motion-reduce:transition-none",
          tone === "paper" ? "border-ink/25 bg-paper text-ink" : "border-stone/30 bg-transparent text-paper",
          className,
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-raised text-paper">
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
