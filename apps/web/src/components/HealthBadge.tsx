'use client';

interface HealthBadgeProps {
  score: number | null;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function HealthBadge({ score, size = 'md', showLabel = true }: HealthBadgeProps) {
  const actualScore = score ?? 0;

  const getHealthColor = (s: number) => {
    if (s >= 80) return 'bg-green-100 text-green-800 border-green-200';
    if (s >= 50) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return 'bg-red-100 text-red-800 border-red-200';
  };

  const getHealthLabel = (s: number) => {
    if (s >= 80) return 'Zdravé';
    if (s >= 50) return 'Varovanie';
    return 'Kritické';
  };

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${getHealthColor(actualScore)} ${sizeClasses[size]}`}
    >
      <span className="font-bold">{Math.round(actualScore)}</span>
      {showLabel && (
        <span className="ml-1 font-normal">({getHealthLabel(actualScore)})</span>
      )}
    </span>
  );
}
