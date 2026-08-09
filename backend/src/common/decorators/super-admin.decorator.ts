import { SetMetadata } from '@nestjs/common';

export const SUPER_ADMIN_KEY = 'requireSuperAdmin';

/**
 * Restringe a rota ao administrador de plataforma (super admin).
 * Usado em operações de plataforma como criação de empresas e usuários.
 */
export const RequireSuperAdmin = () => SetMetadata(SUPER_ADMIN_KEY, true);
