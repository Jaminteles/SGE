import { Global, Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';

/** Armazenamento de arquivos (RF-019), disponível a qualquer módulo. */
@Global()
@Module({
  providers: [FileStorageService],
  exports: [FileStorageService],
})
export class StorageModule {}
