import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { TextField } from '../ui/TextField';
import { useAuth } from './auth-context';

/** Tela de login (RF-008 / UI-002). */
export function LoginPage() {
  const { login, status } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (caught) {
      // A API responde 401 genérico: não dá para saber se o e-mail existe.
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-card__title">Gestão empresarial</h1>
        <p className="auth-card__subtitle">Entre com suas credenciais</p>

        <ErrorAlert error={error} />

        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <TextField
            label="E-mail"
            type="email"
            name="email"
            autoComplete="username"
            placeholder="nome@empresa.com.br"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            label="Senha"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" block loading={submitting}>
            Entrar
          </Button>
        </form>

        <div className="auth-card__links">
          <Link to="/recuperar-senha">Esqueci minha senha</Link>
        </div>
      </div>
    </div>
  );
}
