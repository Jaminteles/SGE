import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { RecordStatus } from '@prisma/client';
import { CreateApprovalThresholdDto } from './create-approval-threshold.dto';

export class UpdateApprovalThresholdDto extends PartialType(CreateApprovalThresholdDto) {
  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
