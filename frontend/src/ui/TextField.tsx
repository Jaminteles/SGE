import { useId, type InputHTMLAttributes } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string | null;
  hint?: string;
}

/** Campo de texto com rótulo, dica e erro ligados por aria (UI-006). */
export function TextField({ label, error, hint, className, ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        {...rest}
        id={id}
        className={['field__control', error ? 'field__control--invalid' : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
      />
      {hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
