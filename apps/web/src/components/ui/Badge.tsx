'use client';

import { type HTMLAttributes, type ReactNode } from 'react';

type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: `
    bg-neutral-100 text-neutral-700
    dark:bg-neutral-700 dark:text-neutral-300
  `,
  primary: `
    bg-primary-100 text-primary-700
    dark:bg-primary-900/50 dark:text-primary-300
  `,
  secondary: `
    bg-secondary-100 text-secondary-700
    dark:bg-secondary-900/50 dark:text-secondary-300
  `,
  success: `
    bg-success-100 text-success-700
    dark:bg-success-900/50 dark:text-success-300
  `,
  warning: `
    bg-warning-100 text-warning-700
    dark:bg-warning-900/50 dark:text-warning-300
  `,
  danger: `
    bg-danger-100 text-danger-700
    dark:bg-danger-900/50 dark:text-danger-300
  `,
};

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-neutral-500',
  primary: 'bg-primary-500',
  secondary: 'bg-secondary-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2.5 py-1 text-sm',
};

export function Badge({
  variant = 'default',
  size = 'md',
  dot = false,
  icon,
  children,
  className = '',
  ...props
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center gap-1.5 font-medium rounded-full
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `}
      {...props}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`}
          aria-hidden="true"
        />
      )}
      {icon}
      {children}
    </span>
  );
}

export type { BadgeProps, BadgeVariant, BadgeSize };
