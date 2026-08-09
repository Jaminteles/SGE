import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Remove tudo que não for dígito. */
export function onlyDigits(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Valida os dígitos verificadores de um CNPJ. */
export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false; // rejeita sequências repetidas

  const calc = (base: string, weights: number[]): number => {
    const sum = base.split('').reduce((acc, digit, idx) => acc + Number(digit) * weights[idx], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(cnpj.slice(0, 12), w1);
  const d2 = calc(cnpj.slice(0, 12) + d1, w2);
  return cnpj.endsWith(`${d1}${d2}`);
}

@ValidatorConstraint({ name: 'isCnpj', async: false })
class IsCnpjConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidCnpj(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} deve ser um CNPJ válido`;
  }
}

/** Decorator class-validator para CNPJ com dígitos verificadores. */
export function IsCnpj(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsCnpjConstraint,
    });
  };
}
