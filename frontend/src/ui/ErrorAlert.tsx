import { ApiError, errorMessage, errorTitle } from '../api/errors';
import { Alert } from './Alert';

/** Traduz qualquer erro de API para o alerta padrão da interface (UI-005). */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const details = error instanceof ApiError ? error.details : [];
  return (
    <Alert tone="error" title={errorTitle(error)} message={errorMessage(error)} details={details} />
  );
}
