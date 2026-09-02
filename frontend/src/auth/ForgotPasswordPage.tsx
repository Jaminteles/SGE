import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/auth.api';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { TextField } from '../ui/TextField';

/**
 * Recuperação de senha (RF-009 / UI-002). A API responde sempre a mesma
 * mensagem — a tela não pode revelar se o e-mail está cadastrado.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await authApi.forgotPassword(email.trim());
      setMessage(response.message);
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-card__title">Recuperar acesso</h1>
        <p className="auth-card__subtitle">
          Enviaremos um link de redefinição válido por 30 minutos.
        </p>

        <ErrorAlert error={error} />
        {message ? <Alert tone="success" title="Solicitação registrada" message={message} /> : null}

        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <TextField
            label="E-mail cadastrado"
            type="email"
            name="email"
            autoComplete="username"
            placeholder="nome@empresa.com.br"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button type="submit" block loading={submitting}>
            Enviar link
          </Button>
        </form>

        <div className="auth-card__links">
          <Link to="/login">Voltar ao login</Link>
        </div>
      </div>
    </div>
  );
}
