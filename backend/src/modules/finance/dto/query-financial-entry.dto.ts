import { ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalStatus, EntryStatus, EntryType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Filtros da carteira (RF-051/RF-052/RF-058). */
export class QueryFinancialEntryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EntryType })
  @IsOptional()
  @IsEnum(EntryType)
  type?: EntryType;

  @ApiPropertyOptional({ enum: EntryStatus })
  @IsOptional()
  @IsEnum(EntryStatus)
  status?: EntryStatus;

  @ApiPropertyOptional({ enum: ApprovalStatus })
  @IsOptional()
  @IsEnum(ApprovalStatus)
  approvalStatus?: ApprovalStatus;

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

  @ApiPropertyOptional({ description: 'Emitidos a partir desta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  issuedFrom?: string;

  @ApiPropertyOptional({ description: 'Emitidos até esta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  issuedTo?: string;

  @ApiPropertyOptional({ description: 'Com parcela vencendo a partir desta data' })
  @IsOptional()
  @IsDateOnly()
  dueFrom?: string;

  @ApiPropertyOptional({ description: 'Com parcela vencendo até esta data' })
  @IsOptional()
  @IsDateOnly()
  dueTo?: string;

  @ApiPropertyOptional({ description: 'Somente títulos com saldo em aberto' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  openOnly?: boolean;
}
