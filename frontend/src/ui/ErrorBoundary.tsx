import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';
import { StateScreen } from './StateScreen';

interface State {
  hasError: boolean;
}

/**
 * Rede de segurança da interface (UI-005): um erro de render não pode deixar a
 * tela em branco. A mensagem exibida é genérica — detalhe técnico só no console
 * do desenvolvedor, nunca com dado do usuário.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Falha inesperada na interface:', error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <StateScreen
        title="Algo deu errado"
        message="Não foi possível exibir esta tela. Recarregue a página e tente de novo."
        action={
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Recarregar
          </Button>
        }
      />
    );
  }
}
