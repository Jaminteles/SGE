import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalThresholdsService } from './approval-thresholds.service';

@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalThresholdsService],
})
export class ApprovalsModule {}
