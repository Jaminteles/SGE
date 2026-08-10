import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/** Projeção pública do usuário (nunca expõe o hash da senha). */
const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  isSuperAdmin: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /** Cadastra um usuário (RF-007). */
  async create(dto: CreateUserDto) {
    const passwordHash = await this.password.hash(dto.password);
    return this.prisma.db.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        isSuperAdmin: dto.isSuperAdmin ?? false,
      },
      select: userSelect,
    });
  }

  async findAll(query: PaginationQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: 'desc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.user.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(id: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id }, select: userSelect });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    return user;
  }

  /** Atualiza dados/situação do usuário (RF-007). Ao inativar, encerra sessões. */
  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    const user = await this.prisma.db.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isSuperAdmin !== undefined ? { isSuperAdmin: dto.isSuperAdmin } : {}),
      },
      select: userSelect,
    });

    if (dto.isActive === false) {
      await this.tokens.revokeAllForUser(id);
    }
    return user;
  }
}
