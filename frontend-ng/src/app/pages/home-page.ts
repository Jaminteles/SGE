import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { AuthService } from '../core/auth/auth.service';
import { PermissionsService } from '../core/authz/permissions.service';
import { CompanyService } from '../core/company/company.service';
import { formatCurrency } from '../core/lib/decimal';
import { NAVIGATION } from '../core/navigation';
import { OnboardingBanner } from '../onboarding/onboarding-banner';

interface Kpi {
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
}

/**
 * Início da área autenticada (UI-005).
 *
 * Enquanto as telas de cada módulo não chegam (sprints 19 a 24), mostra o
 * contexto da sessão e o que o perfil libera. Os KPIs são de exemplo; a tabela
 * de acessos é real, derivada das permissões do perfil na empresa ativa.
 */
@Component({
  selector: 'sge-home-page',
  imports: [RouterLink, ButtonModule, TableModule, TagModule, OnboardingBanner],
  templateUrl: './home-page.html',
})
export class HomePage {
  private readonly auth = inject(AuthService);
  private readonly permissoes = inject(PermissionsService);
  protected readonly empresa = inject(CompanyService);

  protected readonly primeiroNome = computed(
    () => this.auth.usuario()?.name.split(' ')[0] ?? 'visitante',
  );

  protected readonly nomeEmpresa = computed(() => {
    const ativa = this.empresa.ativa();
    return ativa ? (ativa.company.tradeName ?? ativa.company.legalName) : '—';
  });

  // Valores no canônico da API (string, RN-012); só viram texto na exibição.
  protected readonly kpis = signal<Kpi[]>([
    {
      label: 'A pagar em aberto',
      value: formatCurrency('384210.55'),
      detail: '12 títulos vencendo em 7 dias',
      tone: 'warn',
    },
    {
      label: 'A receber em aberto',
      value: formatCurrency('512880.00'),
      detail: '+8,4% vs. agosto',
      tone: 'good',
    },
    {
      label: 'Saldo em caixa',
      value: formatCurrency('128470.30'),
      detail: '3 contas bancárias',
      tone: 'neutral',
    },
    {
      label: 'Aprovações pendentes',
      value: '7',
      detail: '2 acima da sua alçada',
      tone: 'bad',
    },
  ]);

  /** Módulos e o que o perfil libera na empresa ativa (RF-011). */
  protected readonly acessos = computed(() =>
    NAVIGATION.filter((item) => item.path !== '/').map((item) => ({
      label: item.label,
      path: item.path,
      exigencia:
        [...(item.permissions.all ?? []), ...(item.permissions.any ?? [])].join(', ') || '—',
      liberado: this.permissoes.permite(item.permissions),
    })),
  );

  protected readonly liberados = computed(() => this.acessos().filter((a) => a.liberado).length);
}
