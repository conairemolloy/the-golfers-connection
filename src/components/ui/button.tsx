import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

type ButtonVariant = "primary" | "ghost";

/**
 * Exported separately so EmptyState can style a <Link> identically —
 * an anchor styled as a button, not a <button> wrapping navigation.
 */
export function buttonClasses(variant: ButtonVariant = "primary"): string {
  const base =
    "inline-flex min-h-11 items-center justify-center rounded-hairline px-5 font-sans text-sm font-medium transition-colors motion-reduce:transition-none";
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-gilt text-deep hover:bg-bright",
    ghost: "border border-stone/40 text-stone hover:border-stone hover:text-paper",
  };
  return cx(base, variants[variant]);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return <button className={cx(buttonClasses(variant), className)} {...props} />;
}
