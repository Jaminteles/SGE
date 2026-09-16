import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { AuthService } from '../core/auth/auth.service';
import { CompanyService } from '../core/company/company.service';
import { formatCnpj } from '../core/lib/format';

/**
 * Seleção da empresa ativa (RF-005 / UI-003).
 *
 * Só aparece quando o usuário tem mais de um vínculo e nenhum é padrão — nos
 * outros casos o `CompanyService` já escolheu sozinho. O isolamento real
 * continua sendo a RLS do PostgreSQL; o `x-company-id` apenas informa o
 * contexto.
 */
@Component({
  selector: 'sge-company-select-page',
  imports: [ButtonModule],
  styleUrl: '../auth/auth-page.scss',
  template: `
    <div class="auth">
      <div class="auth__inner">
        <div class="brand">
          <span class="brand__mark">SGE</span>
          <span class="brand__name">Gestão Empresarial e Financeira</span>
        </div>

        <div class="card auth__card">
          <div class="auth__titulo">
            <h1>Selecione a empresa</h1>
            <p>
              {{ auth.usuario()?.name }} · {{ empresa.empresas().length }} empresa(s) vinculada(s)
              ao seu usuário.
            </p>
          </div>

          @for (vinculo of empresa.empresas(); track vinculo.companyId) {
            <button
              type="button"
              class="empresa"
              [class.empresa--ativa]="vinculo.companyId === empresa.ativaId()"
              (click)="escolher(vinculo.companyId)"
            >
              <span>
                <span class="empresa__nome">{{
                  vinculo.company.tradeName ?? vinculo.company.legalName
                }}</span>
                <span class="empresa__dados">
                  {{ cnpj(vinculo.company.taxId) }} · {{ vinculo.role.name }}
                </span>
              </span>
              @if (vinculo.companyId === empresa.ativaId()) {
                <i class="pi pi-check empresa__check" aria-hidden="true"></i>
                <span class="sr-only">Empresa ativa</span>
              }
            </button>
          } @empty {
            @if (auth.superAdmin()) {
              <p class="auth__rodape">
                Nenhuma empresa cadastrada ainda. Comece cadastrando a primeira (RF-001).
              </p>
            } @else {
              <p class="auth__rodape">
                Seu usuário não tem vínculo com nenhuma empresa ativa. Fale com o administrador.
              </p>
            }
          }

          @if (auth.superAdmin() && empresa.empresas().length === 0) {
            <p-button
              label="Cadastrar empresa"
              icon="pi pi-plus"
              [fluid]="true"
              (onClick)="cadastrarEmpresa()"
            />
          } @else {
            <p-button
              label="Continuar"
              [fluid]="true"
              [disabled]="empresa.ativaId() === null"
              (onClick)="continuar()"
            />
          }
        </div>

        <p class="auth__rodape">O isolamento real é garantido pela RLS do PostgreSQL.</p>
      </div>
    </div>
  `,
})
export class CompanySelectPage {
  protected readonly auth = inject(AuthService);
  protected readonly empresa = inject(CompanyService);
  private readonly router = inject(Router);

  protected cnpj(taxId: string | null): string {
    return taxId ? `CNPJ ${formatCnpj(taxId)}` : 'Sem CNPJ cadastrado';
  }

  protected escolher(companyId: string): void {
    this.empresa.selecionar(companyId);
  }

  protected continuar(): void {
    void this.router.navigate(['/']);
  }

  /** Saída do ovo e da galinha: o super admin cadastra a primeira empresa. */
  protected cadastrarEmpresa(): void {
    void this.router.navigate(['/administracao/empresas/nova']);
  }
}
