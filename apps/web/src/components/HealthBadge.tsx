'use client';

interface HealthBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function HealthBadge({ score, size = 'md', showLabel = true }: HealthBadgeProps) {
  const getHealthColor = (score: number) => {
    if (score >= 80) return 'bg-green-100 text-green-800 border-green-200';
    if (score >= 50) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return 'bg-red-100 text-red-800 border-red-200';
  };

  const getHealthLabel = (score: number) => {
    if (score >= 80) return 'Healthy';
    if (score >= 50) return 'Warning';
    return 'Critical';
  };

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${getHealthColor(score)} ${sizeClasses[size]}`}
    >
      <span className="font-bold">{Math.round(score)}</span>
      {showLabel && (
        <span className="ml-1 font-normal">({getHealthLabel(score)})</span>
      )}
    </span>
  );
}
