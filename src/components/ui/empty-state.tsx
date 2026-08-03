import type { ReactNode } from "react";
import Link from "next/link";
import { buttonClasses } from "./button";

interface EmptyStateAction {
  href: string;
  label: string;
}

/**
 * Heading, one line, an optional action. Every empty state in this
 * product is a designed screen, never a blank list — see ROADMAP.md's
 * P12 Winter Mode for why.
 */
export function EmptyState({ heading, action, children }: { heading: string; action?: EmptyStateAction; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 py-16">
      <h2 className="font-serif text-2xl text-bright">{heading}</h2>
      <p className="max-w-prose font-sans text-sm text-stone">{children}</p>
      {action && (
        <Link href={action.href} className={buttonClasses("ghost")}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
