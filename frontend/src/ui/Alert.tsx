import type { ReactNode } from 'react';

export type AlertTone = 'error' | 'warning' | 'info' | 'success';

interface AlertProps {
  tone?: AlertTone;
  title: string;
  message?: string;
  /** Itens de validação devolvidos pela API (uma linha por erro). */
  details?: string[];
  actions?: ReactNode;
}

/** Bloco de feedback padrão das telas (UI-005). */
export function Alert({ tone = 'error', title, message, details = [], actions }: AlertProps) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <p className="alert__title">{title}</p>
      {message ? <p className="alert__message">{message}</p> : null}
      {details.length > 1 ? (
        <ul className="alert__details">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {actions ? <div className="alert__actions">{actions}</div> : null}
    </div>
  );
}
