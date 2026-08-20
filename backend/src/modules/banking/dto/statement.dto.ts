import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionDirection } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';

export const STATEMENT_FORMATS = ['OFX', 'CSV'] as const;

/** Importação de extrato (RF-060). O arquivo vai no campo `file`. */
export class ImportStatementDto {
  @ApiProperty({ description: 'Conta bancária a que o extrato pertence' })
  @IsUUID()
  bankAccountId!: string;

  @ApiPropertyOptional({
    enum: STATEMENT_FORMATS,
    description: 'Ausente: deduzido pela extensão e pelo conteúdo do arquivo',
  })
  @IsOptional()
  @IsIn(STATEMENT_FORMATS)
  format?: (typeof STATEMENT_FORMATS)[number];
}

/** Filtros das importações já realizadas (RF-060). */
export class QueryStatementImportDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ description: 'Importações cujo período termina a partir desta data' })
  @IsOptional()
  @IsDateOnly()
  periodFrom?: string;

  @ApiPropertyOptional({ description: 'Importações cujo período começa até esta data' })
  @IsOptional()
  @IsDateOnly()
  periodTo?: string;
}

/** Filtros dos movimentos bancários (RF-060). `q` busca descrição e documento. */
export class QueryBankTransactionDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statementImportId?: string;

  @ApiPropertyOptional({ enum: TransactionDirection })
  @IsOptional()
  @IsEnum(TransactionDirection)
  direction?: TransactionDirection;

  @ApiPropertyOptional({ description: 'Movimentos a partir desta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'Movimentos até esta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;
}
