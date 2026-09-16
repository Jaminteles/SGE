import { registerLocaleData } from '@angular/common';
import ptBr from '@angular/common/locales/pt';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  ErrorHandler,
  LOCALE_ID,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { SGE_INTERCEPTORS } from './core/api/interceptors';
import { CompanyService } from './core/company/company.service';
import { SgeErrorHandler } from './core/observability/client-errors.service';
import { SgePreset } from './theme/sge-preset';

// Locale pt-BR do Angular (UI-084). Dinheiro, data e número da aplicação são
// formatados pelas funções de `core/lib` — que trabalham sobre a string
// canônica e nunca passam por `number`. O locale registrado aqui é o piso: o
// que o framework formatar sozinho (`DatePipe` de uma biblioteca, mensagem de
// validação, `toLocaleString` de terceiro) também sai em pt-BR, em vez de cair
// no 'en-US' padrão e escrever "1,234.56" no meio de uma tela em português.
registerLocaleData(ptBr, 'pt-BR');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Captura de erros do cliente (RNF-010 — UI-090). Entra depois do
    // `provideBrowserGlobalErrorListeners`: são ele e o `ErrorHandler` juntos
    // que cobrem erro de renderização, `Promise` rejeitada e `window.onerror`.
    { provide: ErrorHandler, useClass: SgeErrorHandler },
    { provide: LOCALE_ID, useValue: 'pt-BR' },
    provideRouter(routes),
    provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
    // Services `providedIn: 'root'` são preguiçosos: só existem quando alguém
    // os injeta. A auto-seleção da empresa ativa mora no construtor do
    // `CompanyService`, então ele precisa existir desde o bootstrap — não pode
    // depender de algum componente lembrar de injetá-lo.
    provideAppInitializer(() => {
      inject(CompanyService);
    }),
    providePrimeNG({
      theme: {
        preset: SgePreset,
        options: {
          // O tema segue a classe no <html>, não a preferência do sistema.
          // O app nasce escuro (a classe já vem no index.html) e o botão da
          // barra superior vai apenas alternar essa classe quando for ligado.
          darkModeSelector: '.sge-dark',
          cssLayer: false,
        },
      },
      ripple: true,
    }),
  ],
};
