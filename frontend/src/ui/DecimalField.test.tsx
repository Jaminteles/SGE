import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DecimalField } from './DecimalField';

function Harness({ onChange }: { onChange: (value: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <DecimalField
      label="Valor"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('DecimalField', () => {
  it('entrega o valor canônico em string, nunca number (RN-012)', async () => {
    const onChange = vi.fn<(value: string | null) => void>();
    render(<Harness onChange={onChange} />);

    const input = screen.getByLabelText('Valor');
    await userEvent.type(input, '1.234,56');
    await userEvent.tab();

    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toBe('1234.56');
    expect(typeof last).toBe('string');
  });

  it('reexibe o valor formatado em pt-BR ao sair do campo', async () => {
    render(<Harness onChange={vi.fn()} />);
    const input = screen.getByLabelText<HTMLInputElement>('Valor');

    await userEvent.type(input, '45900');
    await userEvent.tab();

    expect(input.value).toBe('45.900,00');
  });

  it('acusa mais de duas casas decimais e não propaga valor', async () => {
    const onChange = vi.fn<(value: string | null) => void>();
    render(<Harness onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Valor'), '10,999');

    expect(screen.getByText('Use no máximo 2 casas decimais.')).toBeInTheDocument();
    expect(onChange.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('marca o campo como inválido para acessibilidade', async () => {
    render(<Harness onChange={vi.fn()} />);
    const input = screen.getByLabelText('Valor');

    await userEvent.type(input, 'abc');

    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
