import { useId, useState } from 'react';
import { formatDecimal, parseDecimalInput } from '../lib/decimal';

interface DecimalFieldProps {
  label: string;
  /** Valor canônico da API (string, ex.: "1234.50"). Nunca `number` (RN-012). */
  value: string | null;
  /** Recebe o valor já canônico — ou `null` enquanto a entrada for inválida/vazia. */
  onChange: (value: string | null) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  /** Erro vindo de fora (ex.: validação da API). */
  error?: string | null;
}

/**
 * Campo monetário (RN-012 / RNF-008).
 *
 * O usuário digita em pt-BR ("1.234,56"); o componente devolve o canônico
 * ("1234.56") como **string**. Em nenhum momento o valor passa por `number`,
 * então não há arredondamento binário entre a tela e o `numeric(18,2)`.
 */
export function DecimalField({
  label,
  value,
  onChange,
  name,
  required = false,
  disabled = false,
  hint,
  error,
}: DecimalFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [draft, setDraft] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const displayed = draft ?? formatDecimal(value);
  const shownError = error ?? localError;
  const describedBy = [hint ? hintId : null, shownError ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={[
          'field__control',
          'field__control--numeric',
          shownError ? 'field__control--invalid' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        value={displayed}
        disabled={disabled}
        required={required}
        aria-invalid={shownError ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = parseDecimalInput(next, { required });
          setLocalError(parsed.error);
          onChange(parsed.error === null ? parsed.value : null);
        }}
        onBlur={() => {
          const parsed = parseDecimalInput(draft ?? displayed, { required });
          setLocalError(parsed.error);
          if (parsed.error === null) {
            // Reexibe já formatado; o estado de fora segue canônico.
            setDraft(null);
            onChange(parsed.value);
          }
        }}
      />
      {hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {shownError ? (
        <span className="field__error" id={errorId}>
          {shownError}
        </span>
      ) : null}
    </div>
  );
}
