import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';
import type { PermissionCheck } from '../core/authz/permissions';

export interface AbaFiscal {
  path: string;
  label: string;
  permissions: PermissionCheck;
}

/** Sub-navegação do módulo Fiscal (UI-036 a UI-041, UI-061 a UI-064). */
export const ABAS_FISCAL: AbaFiscal[] = [
  { path: 'documentos', label: 'Documentos', permissions: { all: ['fiscal-documents:READ'] } },
  { path: 'importar', label: 'Importar XML', permissions: { all: ['fiscal-documents:CREATE'] } },
  { path: 'coleta', label: 'Coleta automática', permissions: { all: ['fiscal-documents:READ'] } },
  { path: 'parametros', label: 'Parâmetros', permissions: { all: ['tax-parameters:READ'] } },
  {
    path: 'classificacoes',
    label: 'Classificações',
    permissions: { all: ['tax-classifications:READ'] },
  },
  { path: 'regras', label: 'Regras', permissions: { all: ['tax-rules:READ'] } },
  { path: 'relatorios', label: 'Relatórios', permissions: { all: ['fiscal-reports:READ'] } },
  { path: 'transmissoes', label: 'Transmissões', permissions: { all: ['fiscal-events:READ'] } },
];

/**
 * Telas do módulo Fiscal (UI-036 a UI-041, UI-061 a UI-064).
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
  {
    path: 'parametros',
    loadComponent: () => import('./tax-parameters-page').then((m) => m.TaxParametersPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['tax-parameters:READ'] } },
    title: 'Parâmetros fiscais · SGE',
  },
  {
    path: 'classificacoes',
    loadComponent: () =>
      import('./tax-classifications-page').then((m) => m.TaxClassificationsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['tax-classifications:READ'] } },
    title: 'Classificações fiscais · SGE',
  },
  {
    path: 'regras',
    loadComponent: () => import('./tax-rules-page').then((m) => m.TaxRulesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['tax-rules:READ'] } },
    title: 'Regras fiscais · SGE',
  },
  {
    path: 'relatorios',
    loadComponent: () => import('./fiscal-reports-page').then((m) => m.FiscalReportsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['fiscal-reports:READ'] } },
    title: 'Relatórios fiscais · SGE',
  },
  {
    path: 'transmissoes',
    loadComponent: () => import('./fiscal-monitor-page').then((m) => m.FiscalMonitorPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['fiscal-events:READ'] } },
    title: 'Transmissões fiscais · SGE',
  },
];
