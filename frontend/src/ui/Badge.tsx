import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

/** Selo de situação usado nas listagens (coluna "Situação"). */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
