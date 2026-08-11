import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { EmployeeStatus, HrEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { toDateOnly } from '../../common/utils/date-only';
import { HrReferencesService } from './hr-references.service';
import { EmployeesService } from './employees.service';
import { CreateEmployeeEventDto } from './dto/create-employee-event.dto';

/** Eventos que a API não aceita por esta rota — têm caminho próprio. */
const RESERVED_EVENTS: HrEventType[] = [HrEventType.ADMISSAO, HrEventType.DESLIGAMENTO];

/** Eventos que só fazem sentido com um valor de salário informado. */
const SALARY_EVENTS: HrEventType[] = [HrEventType.ALTERACAO_SALARIAL];

/**
 * Histórico funcional (RF-015, RF-020) — `gestao.funcionario_evento`.
 *
 * Append-only: bd/06 recusa UPDATE e DELETE na tabela, e por isso este serviço
 * não expõe edição. Um registro equivocado é corrigido com um novo evento — é
 * assim que o histórico continua contando o que de fato aconteceu (RN-009).
 */
@Injectable()
export class EmployeeEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly references: HrReferencesService,
  ) {}

  async create(
    companyId: string,
    employeeId: string,
    dto: CreateEmployeeEventDto,
    recordedBy?: string,
  ) {
    const employee = await this.employees.findOne(companyId, employeeId);

    if (RESERVED_EVENTS.includes(dto.type)) {
      throw new ForbiddenException(
        'Admissão é registrada no cadastro e desligamento em POST /employees/:id/terminate.',
      );
    }
    if (employee.status === EmployeeStatus.DESLIGADO) {
      throw new BadRequestException('Funcionário desligado não recebe novos eventos.');
    }
    if (SALARY_EVENTS.includes(dto.type) && dto.salary == null) {
      throw new BadRequestException('Alteração salarial exige o novo salário.');
    }

    const startDate = toDateOnly(dto.startDate);
    const endDate = dto.endDate ? toDateOnly(dto.endDate) : null;
    if (startDate < employee.hireDate) {
      throw new BadRequestException('O evento não pode ser anterior à admissão.');
    }
    if (endDate && endDate < startDate) {
      throw new BadRequestException('O fim do evento não pode ser anterior ao início.');
    }

    await this.references.assert(companyId, {
      positionId: dto.positionId,
      departmentId: dto.departmentId,
      costCenterId: dto.costCenterId,
    });

    // O trigger de bd/06 projeta situação, cargo, lotação e salário a partir
    // deste insert — não há UPDATE em `funcionario` aqui de propósito.
    return this.prisma.db.employeeEvent.create({
      data: {
        companyId,
        employeeId: employee.id,
        type: dto.type,
        startDate,
        endDate,
        positionId: dto.positionId,
        departmentId: dto.departmentId,
        costCenterId: dto.costCenterId,
        salary: dto.salary != null ? new Prisma.Decimal(dto.salary) : null,
        note: dto.note,
        recordedBy,
      },
    });
  }

  async findAll(companyId: string, employeeId: string, query: PaginationQueryDto) {
    await this.employees.findOne(companyId, employeeId);

    const where: Prisma.EmployeeEventWhereInput = { companyId, employeeId };

    const data = await this.prisma.db.employeeEvent.findMany({
      where,
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.employeeEvent.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }
}
