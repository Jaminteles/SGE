import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';

import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeEventsController } from './employee-events.controller';
import { EmployeeEventsService } from './employee-events.service';
import { BankAccountsController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';
import { PayrollItemsController } from './payroll-items.controller';
import { PayrollItemsService } from './payroll-items.service';
import { CompensationController } from './compensation.controller';
import { CompensationService } from './compensation.service';
import { ReimbursementsController } from './reimbursements.controller';
import { ReimbursementsService } from './reimbursements.service';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/**
 * M03 — Funcionários e Recursos Humanos (RF-013 a RF-021).
 *
 * Depende de ApprovalsModule para avaliar a alçada na aprovação de reembolso
 * (RN-003); auditoria, armazenamento e validação de referências chegam pelos
 * módulos globais.
 */
@Module({
  imports: [ApprovalsModule],
  controllers: [
    DepartmentsController,
    PositionsController,
    EmployeesController,
    EmployeeEventsController,
    BankAccountsController,
    PayrollItemsController,
    CompensationController,
    ReimbursementsController,
    ReceiptsController,
    PayrollController,
  ],
  providers: [
    DepartmentsService,
    PositionsService,
    EmployeesService,
    EmployeeEventsService,
    BankAccountsService,
    PayrollItemsService,
    CompensationService,
    ReimbursementsService,
    ReceiptsService,
    PayrollService,
  ],
})
export class HrModule {}
