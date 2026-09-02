import { useEffect, useState } from 'react';
import type { SelectOption } from './SelectField';

export interface FilterDefinition {
  name: string;
  label: string;
  options: SelectOption[];
  placeholder?: string;
}

export interface FilterValues {
  q: string;
  [key: string]: string;
}

interface FilterBarProps {
  values: FilterValues;
  filters?: FilterDefinition[];
  searchPlaceholder?: string;
  onChange: (values: FilterValues) => void;
  /** Atraso do debounce da busca, em ms. */
  debounceMs?: number;
}

/**
 * Barra de busca e filtros das listagens (UI-006). A filtragem é server-side:
 * o componente só devolve os valores; quem consulta é a página.
 */
export function FilterBar({
  values,
  filters = [],
  searchPlaceholder = 'Buscar',
  onChange,
  debounceMs = 300,
}: FilterBarProps) {
  const [term, setTerm] = useState(values.q);

  // Mantém o campo em dia quando o filtro é limpo de fora.
  useEffect(() => {
    setTerm(values.q);
  }, [values.q]);

  useEffect(() => {
    if (term === values.q) return;
    const timer = setTimeout(() => onChange({ ...values, q: term }), debounceMs);
    return () => clearTimeout(timer);
  }, [term, values, onChange, debounceMs]);

  return (
    <div className="filter-bar">
      <input
        type="search"
        className="field__control filter-bar__search"
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
      {filters.map((filter) => (
        <select
          key={filter.name}
          className="field__control filter-bar__select"
          aria-label={filter.label}
          value={values[filter.name] ?? ''}
          onChange={(event) => onChange({ ...values, [filter.name]: event.target.value })}
        >
          <option value="">{filter.placeholder ?? filter.label}</option>
          {filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
