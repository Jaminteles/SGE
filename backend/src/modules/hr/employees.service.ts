import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, HrEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { toDateOnly } from '../../common/utils/date-only';
import { ReferencesService } from '../../common/references/references.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';
import { TerminateEmployeeDto } from './dto/terminate-employee.dto';

const employeeInclude = {
  position: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, code: true, name: true } },
  manager: { select: { id: true, registration: true, name: true } },
} satisfies Prisma.EmployeeInclude;

/**
 * Cadastro funcional (RF-013 a RF-016) — `gestao.funcionario`.
 *
 * Admissão e desligamento não são campos editáveis: são eventos de
 * `funcionario_evento`, e é o banco que projeta situação, salário e lotação a
 * partir deles (bd/06). Assim o histórico nunca contradiz o cadastro.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
  ) {}

  async create(companyId: string, dto: CreateEmployeeDto, recordedBy?: string) {
    await this.assertReferences(companyId, dto);

    const hireDate = toDateOnly(dto.hireDate);
    if (dto.birthDate && toDateOnly(dto.birthDate) >= hireDate) {
      throw new BadRequestException('A data de nascimento deve ser anterior à admissão.');
    }

    return this.prisma.transaction(async () => {
      const employee = await this.prisma.db.employee.create({
        data: {
          companyId,
          registration: dto.registration,
          name: dto.name,
          taxId: dto.taxId,
          rg: dto.rg,
          pis: dto.pis,
          birthDate: dto.birthDate ? toDateOnly(dto.birthDate) : null,
          corporateEmail: dto.corporateEmail,
          phone: dto.phone,
          positionId: dto.positionId,
          departmentId: dto.departmentId,
          costCenterId: dto.costCenterId,
          managerId: dto.managerId,
          branchId: dto.branchId,
          userId: dto.userId,
          hireDate,
          contractType: dto.contractType,
          baseSalary: dto.baseSalary != null ? new Prisma.Decimal(dto.baseSalary) : null,
        },
      });

      // RF-015: a admissão abre o histórico funcional. O trigger de bd/06
      // devolve o funcionário para ATIVO a partir deste evento.
      await this.prisma.db.employeeEvent.create({
        data: {
          companyId,
          employeeId: employee.id,
          type: HrEventType.ADMISSAO,
          startDate: hireDate,
          positionId: dto.positionId,
          departmentId: dto.departmentId,
          costCenterId: dto.costCenterId,
          salary: dto.baseSalary != null ? new Prisma.Decimal(dto.baseSalary) : null,
          recordedBy,
        },
      });

      return this.findOne(companyId, employee.id);
    });
  }

  async findAll(companyId: string, query: QueryEmployeeDto) {
    // Busca textual: nome, matrícula e, quando o termo é numérico, CPF.
    const taxIdTerm = (query.q ?? '').replace(/\D/g, '');
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.positionId ? { positionId: query.positionId } : {}),
      ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
      ...(query.managerId ? { managerId: query.managerId } : {}),
      // `isActive` da paginação padrão vira "não desligado": o banco modela a
      // situação do funcionário em `status`, não numa coluna booleana.
      ...(query.isActive !== undefined
        ? query.isActive
          ? { status: { not: EmployeeStatus.DESLIGADO } }
          : { status: EmployeeStatus.DESLIGADO }
        : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { registration: { contains: query.q, mode: 'insensitive' } },
              ...(taxIdTerm.length >= 3 ? [{ taxId: { startsWith: taxIdTerm } }] : []),
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.employee.findMany({
      where,
      include: employeeInclude,
      orderBy: { name: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.employee.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const employee = await this.prisma.db.employee.findFirst({
      where: { id, companyId },
      include: employeeInclude,
    });
    if (!employee) {
      throw new NotFoundException('Funcionário não encontrado.');
    }
    return employee;
  }

  async update(companyId: string, id: string, dto: UpdateEmployeeDto) {
    const current = await this.findOne(companyId, id);
    if (dto.managerId && dto.managerId === id) {
      throw new BadRequestException('Um funcionário não pode ser o próprio gestor.');
    }
    await this.assertReferences(companyId, dto);

    await this.prisma.db.employee.update({
      where: { id: current.id },
      data: {
        ...(dto.registration !== undefined ? { registration: dto.registration } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
        ...(dto.rg !== undefined ? { rg: dto.rg } : {}),
        ...(dto.pis !== undefined ? { pis: dto.pis } : {}),
        ...(dto.birthDate !== undefined
          ? { birthDate: dto.birthDate ? toDateOnly(dto.birthDate) : null }
          : {}),
        ...(dto.corporateEmail !== undefined ? { corporateEmail: dto.corporateEmail } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.positionId !== undefined ? { positionId: dto.positionId } : {}),
        ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId } : {}),
        ...(dto.costCenterId !== undefined ? { costCenterId: dto.costCenterId } : {}),
        ...(dto.managerId !== undefined ? { managerId: dto.managerId } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.userId !== undefined ? { userId: dto.userId } : {}),
        ...(dto.contractType !== undefined ? { contractType: dto.contractType } : {}),
      },
    });

    return this.findOne(companyId, id);
  }

  /** Desligamento (RF-015): registra o evento e o banco projeta a situação. */
  async terminate(companyId: string, id: string, dto: TerminateEmployeeDto, recordedBy?: string) {
    const employee = await this.findOne(companyId, id);
    if (employee.status === EmployeeStatus.DESLIGADO) {
      throw new ConflictException('Funcionário já está desligado.');
    }

    const terminationDate = toDateOnly(dto.terminationDate);
    if (terminationDate < employee.hireDate) {
      throw new BadRequestException('O desligamento não pode ser anterior à admissão.');
    }

    return this.prisma.transaction(async () => {
      await this.prisma.db.employeeEvent.create({
        data: {
          companyId,
          employeeId: employee.id,
          type: HrEventType.DESLIGAMENTO,
          startDate: terminationDate,
          note: dto.note ?? dto.reason,
          recordedBy,
        },
      });
      // O motivo é do cadastro; a data e a situação vêm do trigger do evento.
      await this.prisma.db.employee.update({
        where: { id: employee.id },
        data: { terminationReason: dto.reason },
      });

      return this.findOne(companyId, id);
    });
  }

  private async assertReferences(companyId: string, dto: CreateEmployeeDto | UpdateEmployeeDto) {
    await this.references.assert(companyId, {
      positionId: dto.positionId,
      departmentId: dto.departmentId,
      costCenterId: dto.costCenterId,
      managerId: dto.managerId,
      branchId: dto.branchId,
    });
    await this.references.assertUserBelongsToCompany(companyId, dto.userId);
  }
}
