import type { ReactNode } from "react";

/**
 * The one piece of chrome every module shares: a hairline-bordered box with a
 * small uppercase caption bar. Keeping it in one place is what makes the grid
 * read as a single instrument rather than a page of cards.
 */
export function Panel({
  title,
  accessory,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: string;
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    // No outer border: the grid draws 1px seams with `gap-px bg-border`, so a
    // border here would double every divider.
    <section className={`flex min-h-0 min-w-0 flex-col bg-panel ${className}`}>
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border bg-panel-raised px-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
          {title}
        </h2>
        {accessory}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Centred placeholder for a panel that has nothing to show yet. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted">
      {children}
    </div>
  );
}
