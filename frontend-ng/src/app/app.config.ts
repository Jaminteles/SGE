import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { SGE_INTERCEPTORS } from './core/api/interceptors';
import { CompanyService } from './core/company/company.service';
import { SgePreset } from './theme/sge-preset';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
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
