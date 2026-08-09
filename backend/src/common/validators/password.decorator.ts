import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, Matches, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Política de senha: mínimo de 10 caracteres, contendo letras e números
 * (boa prática de segurança; o armazenamento é sempre em hash — RNF-001).
 */
export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH, {
      message: `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres`,
    }),
    MaxLength(128),
    Matches(/[A-Za-z]/, { message: 'A senha deve conter ao menos uma letra' }),
    Matches(/\d/, { message: 'A senha deve conter ao menos um número' }),
  );
}
