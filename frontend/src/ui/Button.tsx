import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  block = false,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, block ? 'btn--block' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
    >
      {loading ? 'Aguarde…' : children}
    </button>
  );
}
