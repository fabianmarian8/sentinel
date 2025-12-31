'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Spinner } from './Spinner';

type IconButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type IconButtonSize = 'sm' | 'md' | 'lg';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  isLoading?: boolean;
  'aria-label': string;
  children: ReactNode;
}

const variantStyles: Record<IconButtonVariant, string> = {
  primary: `
    bg-primary-600 text-white
    hover:bg-primary-700 active:bg-primary-800
    focus-visible:ring-primary-500
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
    bg-transparent text-danger-600
    hover:bg-danger-50 active:bg-danger-100
    dark:text-danger-400 dark:hover:bg-danger-900/30
    focus-visible:ring-danger-500
  `,
};

const sizeStyles: Record<IconButtonSize, string> = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
};

const iconSizes: Record<IconButtonSize, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'md',
  lg: 'md',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      variant = 'ghost',
      size = 'md',
      isLoading = false,
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
          inline-flex items-center justify-center rounded-md
          transition-all duration-150 ease-out
          focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed
          dark:focus-visible:ring-offset-neutral-900
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...props}
      >
        {isLoading ? <Spinner size={iconSizes[size]} /> : children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';

export type { IconButtonProps, IconButtonVariant, IconButtonSize };
