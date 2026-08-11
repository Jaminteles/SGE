import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { onlyDigits } from './is-cnpj.validator';

/**
 * Valida os dígitos verificadores de um CPF (RF-013).
 *
 * O domínio `dom_cpf` do banco só garante 11 dígitos: um CPF inventado passaria
 * pelo CHECK e viraria matrícula, folha e, mais adiante, informação fiscal.
 */
export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // rejeita sequências repetidas

  const digit = (length: number): number => {
    const sum = cpf
      .slice(0, length)
      .split('')
      .reduce((acc, d, idx) => acc + Number(d) * (length + 1 - idx), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

@ValidatorConstraint({ name: 'isCpf', async: false })
class IsCpfConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidCpf(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} deve ser um CPF válido`;
  }
}

/** Decorator class-validator para CPF com dígitos verificadores. */
export function IsCpf(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsCpfConstraint,
    });
  };
}
