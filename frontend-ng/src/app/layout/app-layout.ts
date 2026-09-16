import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Router } from '@angular/router';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { SessionExpiryBanner } from '../auth/session-expiry-banner';
import { ID_CONTEUDO, RouteAnnouncer } from '../core/a11y/route-announcer';
import { ViewportService } from '../core/layout/viewport.service';
import { GlobalSearch } from '../search/global-search';
import { AuthService } from '../core/auth/auth.service';
import { PermissionsService } from '../core/authz/permissions.service';
import { SessionActivityService } from '../core/auth/session-activity.service';
import { CompanyService } from '../core/company/company.service';
import { initials } from '../core/lib/format';
import { NAVIGATION } from '../core/navigation';
import { UserPreferencesService } from '../core/prefs/user-preferences.service';
import { ThemeService } from '../theme/theme-service';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { HelpPanel } from '../ui/help-panel';

/**
 * Moldura da área autenticada (UI-004 / UI-005).
 *
 * A barra lateral vem de `core/navigation.ts` e respeita as permissões do
 * perfil: item sem permissão aparece **desabilitado**, com o aviso "Sem
 * permissão no perfil", em vez de sumir — assim o usuário sabe que o módulo
 * existe e pode pedir acesso.
 */
@Component({
  selector: 'sge-app-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ButtonModule,
    AvatarModule,
    TooltipModule,
    SessionExpiryBanner,
    ConfirmDialog,
    GlobalSearch,
    HelpPanel,
    RouteAnnouncer,
  ],
  host: { '(document:keydown.escape)': 'fecharMenu()' },
  templateUrl: './app-layout.html',
  styleUrl: './app-layout.scss',
})
export class AppLayout {
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
  protected readonly empresa = inject(CompanyService);
  private readonly permissoes = inject(PermissionsService);
  // Injetado aqui de propósito: o serviço é `providedIn: 'root'` e preguiçoso,
  // e é ele quem aplica a classe de densidade no `<html>` (UI-078). Sem alguém
  // da moldura pedindo por ele, a preferência salva não valeria no recarregar.
  private readonly prefs = inject(UserPreferencesService);
  private readonly router = inject(Router);
  private readonly viewport = inject(ViewportService);
  private readonly atividade = inject(SessionActivityService);
  private readonly injector = inject(Injector);

  private readonly botaoMenu = viewChild<ElementRef<HTMLButtonElement>>('botaoMenu');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  /** Alvo do link de pular e do foco na troca de rota (UI-082). */
  protected readonly idConteudo = ID_CONTEUDO;

  /** Ligação `aria-controls` entre o botão da gaveta e o menu (UI-083). */
  protected readonly idMenu = 'menu-modulos';

  private readonly _menuAberto = signal(false);
  protected readonly menuAberto = this._menuAberto.asReadonly();

  /**
   * A gaveta fechada sai da tela por `transform`, e o que sai por `transform`
   * continua focável: sem `inert`, o Tab do celular percorreria quinze itens
   * de menu invisíveis antes de chegar ao conteúdo. No layout largo o menu
   * nunca é inerte — ele está à vista o tempo todo.
   */
  protected readonly menuInerte = computed(() => this.viewport.compacto() && !this.menuAberto());

  protected readonly iniciais = computed(() => initials(this.auth.usuario()?.name ?? ''));

  protected readonly nomeEmpresa = computed(() => {
    const ativa = this.empresa.ativa();
    if (!ativa) return 'Nenhuma empresa ativa';
    const nome = ativa.company.tradeName ?? ativa.company.legalName;
    return ativa.branchId ? nome : `${nome} · Matriz`;
  });

  /** Cada item já resolvido: o template não chama método por iteração. */
  protected readonly itens = computed(() =>
    NAVIGATION.map((item) => ({
      ...item,
      liberado: this.permissoes.permite(item.permissions),
    })),
  );

  protected readonly bloqueados = computed(() => this.itens().filter((i) => !i.liberado).length);

  constructor() {
    // Inatividade e renovação silenciosa só valem dentro da área autenticada
    // (UI-089): na tela de login não há sessão para expirar nem para renovar.
    this.atividade.iniciar();

    // Voltar ao layout largo (girar o tablet, arrastar a janela) precisa
    // devolver o menu ao estado fixo: deixá-lo "aberto" faria o véu cobrir a
    // tela inteira num desktop, sem nada para fechar.
    effect(() => {
      if (!this.viewport.compacto()) this._menuAberto.set(false);
    });
  }

  protected async sair(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }

  /**
   * Abrir e fechar a gaveta leva o foco junto (UI-082 / UI-083).
   *
   * Abrir sem mover o foco deixaria o usuário de teclado com um menu na tela e
   * o cursor atrás dele; fechar sem devolvê-lo jogaria o foco para o início do
   * documento. O destino natural de volta é o próprio botão que abriu.
   */
  protected alternarMenu(): void {
    const abrindo = !this._menuAberto();
    this._menuAberto.set(abrindo);
    if (abrindo) {
      afterNextRender(() => this.menu()?.nativeElement.querySelector('a')?.focus(), {
        injector: this.injector,
      });
    } else {
      this.botaoMenu()?.nativeElement.focus();
    }
  }

  /** Fecha a gaveta; sem efeito quando ela já está fechada (Esc no desktop). */
  protected fecharMenu(): void {
    if (!this._menuAberto()) return;
    this._menuAberto.set(false);
    this.botaoMenu()?.nativeElement.focus();
  }

  /**
   * O link de pular move o foco por programa em vez de deixar o navegador
   * seguir a âncora: a âncora sujaria a URL com um fragmento que o router
   * carregaria para a próxima navegação, e o foco é o que realmente importa
   * aqui — é ele que decide onde o Tab seguinte cai.
   */
  protected pularParaConteudo(evento: Event): void {
    evento.preventDefault();
    // `focus()` já rola o elemento para a vista — não precisa de segundo passo.
    document.getElementById(ID_CONTEUDO)?.focus();
  }
  protected trocarEmpresa(): void {
    void this.router.navigate(['/selecionar-empresa']);
  }
}
