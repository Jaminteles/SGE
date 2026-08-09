import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Exige que o usuário possua TODAS as permissões informadas, no contexto da
 * empresa ativa (RF-011, RNF-004). Super admins ignoram a verificação.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
