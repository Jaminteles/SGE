import { ApiPropertyOptional } from '@nestjs/swagger';
import { PersonType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** Papel usado como filtro da listagem (RF-022/RF-023). */
export enum PartnerRole {
  CLIENTE = 'CLIENTE',
  FORNECEDOR = 'FORNECEDOR',
}

/** Filtros da listagem de parceiros. */
export class QueryPartnerDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PartnerRole, description: 'Filtra por papel exercido' })
  @IsOptional()
  @IsEnum(PartnerRole)
  role?: PartnerRole;

  @ApiPropertyOptional({ enum: PersonType })
  @IsOptional()
  @IsEnum(PersonType)
  personType?: PersonType;
}
