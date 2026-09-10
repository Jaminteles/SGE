import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';

/**
 * Telas do módulo Cadastros (UI-018 a UI-020).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição.
 */
export const CADASTROS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'parceiros' },
  {
    path: 'parceiros',
    loadComponent: () => import('./partners-page').then((m) => m.PartnersPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['partners:READ'] } },
    title: 'Clientes e fornecedores · SGE',
  },
  {
    // ":id" também aceita "novo": o formulário decide pelo parâmetro.
    path: 'parceiros/:id',
    loadComponent: () => import('./partner-form-page').then((m) => m.PartnerFormPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['partners:READ'] } },
    title: 'Parceiro · SGE',
  },
  {
    path: 'condicoes',
    loadComponent: () => import('./payment-conditions-page').then((m) => m.PaymentConditionsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { any: ['payment-terms:READ', 'payment-methods:READ'] } },
    title: 'Condições de pagamento · SGE',
  },
  {
    path: 'catalogo',
    loadComponent: () => import('./products-page').then((m) => m.ProductsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['products:READ'] } },
    title: 'Catálogo · SGE',
  },
  {
    path: 'catalogo/:id',
    loadComponent: () => import('./product-form-page').then((m) => m.ProductFormPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['products:READ'] } },
    title: 'Item do catálogo · SGE',
  },
  {
    path: 'classificacao',
    loadComponent: () => import('./taxonomy-page').then((m) => m.TaxonomyPage),
    canActivate: [permissaoGuard],
    data: { permissions: { any: ['product-categories:READ', 'units-of-measure:READ'] } },
    title: 'Categorias e unidades · SGE',
  },
];
