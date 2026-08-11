import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalThresholdsService } from './approval-thresholds.service';

@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalThresholdsService],
  // A avaliação de alçada (RN-003) é usada por quem aprova — a partir da
  // Sprint 3, o reembolso do M03.
  exports: [ApprovalThresholdsService],
})
export class ApprovalsModule {}
