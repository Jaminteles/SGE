import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CostCentersController } from './cost-centers.controller';
import { CostCentersService } from './cost-centers.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [CategoriesController, CostCentersController, SettingsController],
  providers: [CategoriesService, CostCentersService, SettingsService],
})
export class ConfigurationsModule {}
