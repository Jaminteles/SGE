import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/auth.api';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { TextField } from '../ui/TextField';

/** Política de senha do backend (`IsStrongPassword`). */
const MIN_LENGTH = 10;

function validate(password: string, confirmation: string): string | null {
  if (password.length < MIN_LENGTH) return `A senha deve ter ao menos ${MIN_LENGTH} caracteres.`;
  if (!/[A-Za-z]/.test(password)) return 'A senha deve conter ao menos uma letra.';
  if (!/\d/.test(password)) return 'A senha deve conter ao menos um número.';
  if (password !== confirmation) return 'As senhas não conferem.';
  return null;
}

/** Redefinição de senha via token recebido por e-mail (RF-009 / UI-002). */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const invalid = validate(password, confirmation);
    setLocalError(invalid);
    if (invalid) return;

    setSubmitting(true);
    try {
      const response = await authApi.resetPassword(token, password);
      setMessage(response.message);
      setPassword('');
      setConfirmation('');
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-card__title">Definir nova senha</h1>
        <p className="auth-card__subtitle">
          Escolha uma senha com ao menos {MIN_LENGTH} caracteres, incluindo letra e número.
        </p>

        <ErrorAlert error={error} />
        {message ? <Alert tone="success" title="Senha redefinida" message={message} /> : null}
        {token === '' ? (
          <Alert
            tone="warning"
            title="Link incompleto"
            message="Abra o link exatamente como recebeu no e-mail ou solicite outro."
          />
        ) : null}

        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <TextField
            label="Nova senha"
            type="password"
            name="newPassword"
            autoComplete="new-password"
            required
            value={password}
            error={localError}
            onChange={(event) => setPassword(event.target.value)}
          />
          <TextField
            label="Confirme a nova senha"
            type="password"
            name="confirmation"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <Button type="submit" block loading={submitting} disabled={token === ''}>
            Redefinir senha
          </Button>
        </form>

        <div className="auth-card__links">
          <Link to="/login">Voltar ao login</Link>
        </div>
      </div>
    </div>
  );
}
