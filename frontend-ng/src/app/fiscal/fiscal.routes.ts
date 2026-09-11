import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';

/**
 * Telas de documentos fiscais (UI-036 a UI-041).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição.
 */
export const FISCAL_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'documentos' },
  {
    path: 'documentos',
    loadComponent: () => import('./fiscal-documents-page').then((m) => m.FiscalDocumentsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['fiscal-documents:READ'] } },
    title: 'Documentos fiscais · SGE',
  },
  {
    path: 'documentos/:id',
    loadComponent: () =>
      import('./fiscal-document-detail-page').then((m) => m.FiscalDocumentDetailPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['fiscal-documents:READ'] } },
    title: 'Documento fiscal · SGE',
  },
  {
    path: 'importar',
    loadComponent: () => import('./fiscal-import-page').then((m) => m.FiscalImportPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['fiscal-documents:CREATE'] } },
    title: 'Importar XML · SGE',
  },
  {
    path: 'coleta',
    loadComponent: () => import('./fiscal-collection-page').then((m) => m.FiscalCollectionPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['fiscal-documents:READ'] } },
    title: 'Coleta automática · SGE',
  },
];
