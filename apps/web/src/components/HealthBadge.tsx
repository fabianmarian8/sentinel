'use client';

interface HealthBadgeProps {
  score: number | null;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function HealthBadge({ score, size = 'md', showLabel = true }: HealthBadgeProps) {
  const actualScore = score ?? 0;

  const getHealthColor = (s: number) => {
    if (s >= 80) return 'bg-success-100 text-success-700 border-success-200 dark:bg-success-900/50 dark:text-success-300 dark:border-success-800';
    if (s >= 50) return 'bg-warning-100 text-warning-700 border-warning-200 dark:bg-warning-900/50 dark:text-warning-300 dark:border-warning-800';
    return 'bg-danger-100 text-danger-700 border-danger-200 dark:bg-danger-900/50 dark:text-danger-300 dark:border-danger-800';
  };

  const getHealthLabel = (s: number) => {
    if (s >= 80) return 'Healthy';
    if (s >= 50) return 'Warning';
    return 'Critical';
  };

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium transition-colors ${getHealthColor(actualScore)} ${sizeClasses[size]}`}
    >
      <span className="font-bold">{Math.round(actualScore)}</span>
      {showLabel && (
        <span className="ml-1 font-normal">({getHealthLabel(actualScore)})</span>
      )}
    </span>
  );
}
