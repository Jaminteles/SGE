import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/**
 * Global: qualquer módulo que guarde segredo de terceiro cifra pela mesma porta
 * (RNF-003). Hoje é M09 (credenciais bancárias); OCR e fiscal virão pelo mesmo
 * caminho.
 */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
