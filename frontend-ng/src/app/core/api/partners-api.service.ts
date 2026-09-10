import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  BankAccount,
  BankAccountInput,
  PaginatedResult,
  Partner,
  PartnerAddress,
  PartnerAddressInput,
  PartnerContact,
  PartnerContactInput,
  PartnerHistory,
  PartnerInput,
  PartnerRole,
  PersonType,
} from './types';

/** Filtros próprios da listagem de parceiros (`QueryPartnerDto`). */
export interface PartnerQuery extends ListQuery {
  role?: PartnerRole;
  personType?: PersonType;
}

/** Recorte do histórico comercial e financeiro (`QueryPartnerHistoryDto`). */
export interface PartnerHistoryQuery {
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Clientes e fornecedores (RF-022 a RF-026 — UI-018).
 *
 * Um cadastro só, com os papéis em `isCustomer`/`isSupplier`: não há rota de
 * "cliente" nem de "fornecedor" separada, e o filtro `role` recorta a mesma
 * listagem. Endereços, contatos e dados bancários são rotas aninhadas em
 * `partners/:id`, onde o backend confere o vínculo com a empresa ativa antes de
 * tocar no filho.
 *
 * A conta bancária compartilha o contrato de `employee-bank-accounts` (o
 * backend usa o mesmo DTO); muda só o dono e a permissão exigida.
 */
@Injectable({ providedIn: 'root' })
export class PartnersApiService {
  private readonly http = inject(HttpClient);

  list(query: PartnerQuery = {}): Observable<PaginatedResult<Partner>> {
    return this.http.get<PaginatedResult<Partner>>('partners', { params: toHttpParams(query) });
  }

  get(id: string): Observable<Partner> {
    return this.http.get<Partner>(`partners/${id}`);
  }

  create(body: PartnerInput): Observable<Partner> {
    return this.http.post<Partner>('partners', body);
  }

  update(id: string, body: Partial<PartnerInput>): Observable<Partner> {
    return this.http.patch<Partner>(`partners/${id}`, body);
  }

  /** Inativação lógica: o parceiro continua nos títulos e pedidos já emitidos. */
  inactivate(id: string): Observable<void> {
    return this.http.delete<void>(`partners/${id}`);
  }

  listAddresses(partnerId: string): Observable<PartnerAddress[]> {
    return this.http.get<PartnerAddress[]>(`partners/${partnerId}/addresses`);
  }

  createAddress(partnerId: string, body: PartnerAddressInput): Observable<PartnerAddress> {
    return this.http.post<PartnerAddress>(`partners/${partnerId}/addresses`, body);
  }

  updateAddress(
    partnerId: string,
    id: string,
    body: Partial<PartnerAddressInput>,
  ): Observable<PartnerAddress> {
    return this.http.patch<PartnerAddress>(`partners/${partnerId}/addresses/${id}`, body);
  }

  removeAddress(partnerId: string, id: string): Observable<void> {
    return this.http.delete<void>(`partners/${partnerId}/addresses/${id}`);
  }

  listContacts(partnerId: string): Observable<PartnerContact[]> {
    return this.http.get<PartnerContact[]>(`partners/${partnerId}/contacts`);
  }

  createContact(partnerId: string, body: PartnerContactInput): Observable<PartnerContact> {
    return this.http.post<PartnerContact>(`partners/${partnerId}/contacts`, body);
  }

  updateContact(
    partnerId: string,
    id: string,
    body: Partial<PartnerContactInput>,
  ): Observable<PartnerContact> {
    return this.http.patch<PartnerContact>(`partners/${partnerId}/contacts/${id}`, body);
  }

  removeContact(partnerId: string, id: string): Observable<void> {
    return this.http.delete<void>(`partners/${partnerId}/contacts/${id}`);
  }

  listBankAccounts(partnerId: string): Observable<BankAccount[]> {
    return this.http.get<BankAccount[]>(`partners/${partnerId}/bank-accounts`);
  }

  createBankAccount(partnerId: string, body: BankAccountInput): Observable<BankAccount> {
    return this.http.post<BankAccount>(`partners/${partnerId}/bank-accounts`, body);
  }

  updateBankAccount(
    partnerId: string,
    id: string,
    body: Partial<BankAccountInput>,
  ): Observable<BankAccount> {
    return this.http.patch<BankAccount>(`partners/${partnerId}/bank-accounts/${id}`, body);
  }

  removeBankAccount(partnerId: string, id: string): Observable<void> {
    return this.http.delete<void>(`partners/${partnerId}/bank-accounts/${id}`);
  }

  /** Histórico comercial e financeiro consolidado (RF-025), somente leitura. */
  history(partnerId: string, query: PartnerHistoryQuery = {}): Observable<PartnerHistory> {
    return this.http.get<PartnerHistory>(`partners/${partnerId}/history`, {
      params: toHttpParams({ ...query }),
    });
  }
}
