'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Spinner } from './Spinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-primary-600 text-white
    hover:bg-primary-700 active:bg-primary-800
    focus-visible:ring-primary-500
    shadow-sm hover:shadow-md
    dark:bg-primary-500 dark:hover:bg-primary-600
  `,
  secondary: `
    bg-neutral-100 text-neutral-700
    hover:bg-neutral-200 active:bg-neutral-300
    dark:bg-neutral-700 dark:text-neutral-200
    dark:hover:bg-neutral-600
    focus-visible:ring-neutral-500
  `,
  ghost: `
    bg-transparent text-neutral-600
    hover:bg-neutral-100 active:bg-neutral-200
    dark:text-neutral-300 dark:hover:bg-neutral-800
    focus-visible:ring-neutral-500
  `,
  danger: `
    bg-danger-600 text-white
    hover:bg-danger-700 active:bg-danger-800
    focus-visible:ring-danger-500
    dark:bg-danger-500 dark:hover:bg-danger-600
  `,
  success: `
    bg-success-600 text-white
    hover:bg-success-700 active:bg-success-800
    focus-visible:ring-success-500
    dark:bg-success-500 dark:hover:bg-success-600
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs gap-1',
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
  xl: 'px-6 py-3 text-lg gap-2.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      children,
      className = '',
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={`
          inline-flex items-center justify-center font-medium rounded-md
          transition-all duration-150 ease-out
          focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed
          dark:focus-visible:ring-offset-neutral-900
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${fullWidth ? 'w-full' : ''}
          ${className}
        `}
        {...props}
      >
        {isLoading ? (
          <Spinner size={size === 'xs' || size === 'sm' ? 'sm' : 'md'} />
        ) : (
          leftIcon
        )}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';

export type { ButtonProps, ButtonVariant, ButtonSize };
