import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { renderWithProviders } from '../test/render';
import { LoginPage } from './LoginPage';

describe('LoginPage (UI-002)', () => {
  it('envia as credenciais digitadas', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<LoginPage />, { user: null, auth: { login, status: 'anonymous' } });

    await userEvent.type(screen.getByLabelText('E-mail'), ' jamile@empresa.com.br ');
    await userEvent.type(screen.getByLabelText('Senha'), 'senhaSegura1');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(login).toHaveBeenCalledWith('jamile@empresa.com.br', 'senhaSegura1');
  });

  it('mostra a mensagem da API sem revelar se o e-mail existe', async () => {
    const login = vi.fn().mockRejectedValue(new ApiError(401, 'Credenciais inválidas.'));
    renderWithProviders(<LoginPage />, { user: null, auth: { login, status: 'anonymous' } });

    await userEvent.type(screen.getByLabelText('E-mail'), 'jamile@empresa.com.br');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada12345');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciais inválidas.');
  });

  it('avisa quando o servidor está fora do ar', async () => {
    const login = vi
      .fn()
      .mockRejectedValue(new ApiError(0, 'Sem conexão.', { code: 'NetworkError' }));
    renderWithProviders(<LoginPage />, { user: null, auth: { login, status: 'anonymous' } });

    await userEvent.type(screen.getByLabelText('E-mail'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senhaSegura1');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('oferece o caminho de recuperação de senha', () => {
    renderWithProviders(<LoginPage />, { user: null, auth: { status: 'anonymous' } });
    expect(screen.getByRole('link', { name: 'Esqueci minha senha' })).toHaveAttribute(
      'href',
      '/recuperar-senha',
    );
  });
});
