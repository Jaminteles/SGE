import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethodType, PaymentTransactionStatus, TransactionDirection } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';

/** Filtros das ordens de pagamento (RF-064). `q` busca favorecido e descrição. */
export class QueryPaymentDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentTransactionStatus })
  @IsOptional()
  @IsEnum(PaymentTransactionStatus)
  status?: PaymentTransactionStatus;

  @ApiPropertyOptional({ enum: TransactionDirection })
  @IsOptional()
  @IsEnum(TransactionDirection)
  direction?: TransactionDirection;

  @ApiPropertyOptional({ enum: PaymentMethodType })
  @IsOptional()
  @IsEnum(PaymentMethodType)
  method?: PaymentMethodType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ description: 'Ordens que liquidam esta parcela' })
  @IsOptional()
  @IsUUID()
  installmentId?: string;

  @ApiPropertyOptional({ description: 'Criadas a partir desta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Criadas até esta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  createdTo?: string;
}
