import { useId, type SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  options: SelectOption[];
  /** Texto da opção vazia; omita para tornar a escolha obrigatória. */
  placeholder?: string;
  error?: string | null;
}

export function SelectField({
  label,
  options,
  placeholder,
  error,
  className,
  ...rest
}: SelectFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        {...rest}
        id={id}
        className={['field__control', error ? 'field__control--invalid' : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
