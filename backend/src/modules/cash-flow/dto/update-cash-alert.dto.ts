import { PartialType } from '@nestjs/swagger';
import { CreateCashAlertDto } from './create-cash-alert.dto';

/** Edição do alerta de caixa (RF-105). */
export class UpdateCashAlertDto extends PartialType(CreateCashAlertDto) {}
