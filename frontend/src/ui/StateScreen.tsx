import type { ReactNode } from 'react';

/** Tela de estado (vazio, sem permissão, erro fatal, 404). */
export function StateScreen({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-screen">
      <p className="state-screen__title">{title}</p>
      {message ? <p>{message}</p> : null}
      {action}
    </div>
  );
}
