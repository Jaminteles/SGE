import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './api/errors';
import { AuthProvider } from './auth/AuthProvider';
import { CompanyProvider } from './company/CompanyProvider';
import { AppRoutes } from './routes/AppRoutes';
import { ErrorBoundary } from './ui/ErrorBoundary';

/**
 * Composição do app: roteador → sessão → empresa ativa → rotas.
 *
 * Erro 4xx não é repetido: renovar sessão é responsabilidade do cliente HTTP e
 * permissão negada não muda com nova tentativa.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <CompanyProvider>
              <AppRoutes />
            </CompanyProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
