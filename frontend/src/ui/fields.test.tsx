import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../api/errors';
import { Alert } from './Alert';
import { ErrorAlert } from './ErrorAlert';
import { SelectField } from './SelectField';
import { TextField } from './TextField';

describe('TextField', () => {
  it('liga rótulo, dica e erro ao campo', () => {
    render(<TextField label="E-mail" hint="Use o e-mail corporativo" error="Campo obrigatório" />);

    const input = screen.getByLabelText('E-mail');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/Use o e-mail corporativo/);
    expect(screen.getByText('Campo obrigatório')).toBeInTheDocument();
  });
});

describe('SelectField', () => {
  it('emite o valor escolhido', async () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="Situação"
        placeholder="Todas"
        options={[
          { value: 'ATIVO', label: 'Ativo' },
          { value: 'INATIVO', label: 'Inativo' },
        ]}
        onChange={onChange}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Situação'), 'INATIVO');
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Todas' })).toBeInTheDocument();
  });
});

describe('Alert / ErrorAlert (UI-005)', () => {
  it('anuncia erro com papel de alerta', () => {
    render(<Alert title="Não foi possível salvar o registro" message="O CNPJ já existe." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível salvar o registro');
  });

  it('lista os erros de validação devolvidos pela API', () => {
    render(
      <ErrorAlert
        error={
          new ApiError(400, 'email inválido', {
            code: 'BadRequest',
            details: ['email inválido', 'senha curta'],
          })
        }
      />,
    );
    expect(screen.getByText('senha curta')).toBeInTheDocument();
  });

  it('traduz falha de rede', () => {
    render(<ErrorAlert error={new NetworkError()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão com o servidor');
  });

  it('não desenha nada sem erro', () => {
    const { container } = render(<ErrorAlert error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
