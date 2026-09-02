import { useEffect, useState } from 'react';
import { config } from '../lib/config';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { useAuth } from './auth-context';

/**
 * Aviso de sessão prestes a expirar (UI-002 / UI-005): "Sua sessão expira em
 * 2 minutos. Renove para continuar." A renovação real é a rota /auth/refresh.
 */
export function SessionExpiryBanner() {
  const { expiresAt, renew } = useAuth();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [renewing, setRenewing] = useState(false);

  useEffect(() => {
    if (expiresAt === null) {
      setRemainingMs(null);
      return;
    }
    const tick = () => setRemainingMs(expiresAt - Date.now());
    tick();
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (remainingMs === null || remainingMs > config.sessionWarningMs || remainingMs <= 0) {
    return null;
  }

  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));

  return (
    <Alert
      tone="warning"
      title={`Sua sessão expira em ${minutes} minuto${minutes > 1 ? 's' : ''}.`}
      message="Renove para continuar trabalhando sem perder o que está preenchido."
      actions={
        <Button
          variant="secondary"
          loading={renewing}
          onClick={() => {
            setRenewing(true);
            void renew().finally(() => setRenewing(false));
          }}
        >
          Renovar sessão
        </Button>
      }
    />
  );
}
