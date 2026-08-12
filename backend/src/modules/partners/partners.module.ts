import { Module } from '@nestjs/common';

import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';
import { PartnerContactsController } from './partner-contacts.controller';
import { PartnerContactsService } from './partner-contacts.service';
import { PartnerAddressesController } from './partner-addresses.controller';
import { PartnerAddressesService } from './partner-addresses.service';
import { PartnerBankAccountsController } from './partner-bank-accounts.controller';
import { PartnerBankAccountsService } from './partner-bank-accounts.service';
import { PartnerHistoryController } from './partner-history.controller';
import { PartnerHistoryService } from './partner-history.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentTermsController } from './payment-terms.controller';
import { PaymentTermsService } from './payment-terms.service';

/**
 * M04 — Clientes e Fornecedores (RF-022 a RF-027).
 *
 * O vínculo fornecedor ↔ produto (RF-027) vive no M05 (CatalogModule): o dono
 * do dado é o item, e é por ele que a consulta acontece na compra.
 *
 * `PartnersService` é exportado porque o catálogo precisa confirmar o papel de
 * fornecedor antes de aceitar o vínculo.
 */
@Module({
  controllers: [
    PartnersController,
    PartnerContactsController,
    PartnerAddressesController,
    PartnerBankAccountsController,
    PartnerHistoryController,
    PaymentMethodsController,
    PaymentTermsController,
  ],
  providers: [
    PartnersService,
    PartnerContactsService,
    PartnerAddressesService,
    PartnerBankAccountsService,
    PartnerHistoryService,
    PaymentMethodsService,
    PaymentTermsService,
  ],
  exports: [PartnersService],
})
export class PartnersModule {}
