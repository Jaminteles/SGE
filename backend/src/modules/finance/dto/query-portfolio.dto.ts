import { ApiPropertyOptional } from '@nestjs/swagger';
import { EntryType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Filtros da posição da carteira e da inadimplência (RF-055/RF-058). */
export class QueryPortfolioDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EntryType })
  @IsOptional()
  @IsEnum(EntryType)
  type?: EntryType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Vencimento a partir de (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  dueFrom?: string;

  @ApiPropertyOptional({ description: 'Vencimento até (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  dueTo?: string;

  @ApiPropertyOptional({ description: 'Somente parcelas vencidas' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  overdueOnly?: boolean;
}
