'use client';

import Link from 'next/link';
import { HealthBadge } from './HealthBadge';

interface RuleCardProps {
  rule: {
    id: string;
    name: string;
    ruleType: string;
    enabled: boolean;
    healthScore: number;
    lastErrorCode: string | null;
    lastErrorAt: string | null;
    nextRunAt: string | null;
    source: {
      url: string;
      domain: string;
    };
    currentState: {
      lastStable: any;
    } | null;
    observationCount: number;
  };
}

export function RuleCard({ rule }: RuleCardProps) {
  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getRuleTypeIcon = (type: string) => {
    switch (type) {
      case 'price':
        return '💰';
      case 'availability':
        return '📦';
      case 'text':
        return '📝';
      case 'number':
        return '🔢';
      default:
        return '📊';
    }
  };

  const getCurrentValue = () => {
    if (!rule.currentState?.lastStable) return 'No data';
    const value = rule.currentState.lastStable;
    if (typeof value === 'object') {
      if ('amount' in value) return `${value.currency ?? ''}${value.amount}`;
      if ('inStock' in value) return value.inStock ? 'In Stock' : 'Out of Stock';
      if ('snippet' in value) return value.snippet?.substring(0, 50) + '...';
    }
    return String(value);
  };

  return (
    <Link href={`/dashboard/rules/${rule.id}`}>
      <div className="bg-white rounded-lg shadow border border-gray-200 hover:shadow-lg transition-shadow p-4 cursor-pointer">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl">{getRuleTypeIcon(rule.ruleType)}</span>
              <h3 className="text-lg font-medium text-gray-900 truncate">
                {rule.name}
              </h3>
              {!rule.enabled && (
                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                  Paused
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500 truncate">
              {rule.source.domain}
            </p>
          </div>
          <HealthBadge score={rule.healthScore} size="sm" showLabel={false} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Current Value:</span>
            <p className="font-medium text-gray-900 truncate">
              {getCurrentValue()}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Observations:</span>
            <p className="font-medium text-gray-900">{rule.observationCount}</p>
          </div>
        </div>

        {rule.lastErrorCode && (
          <div className="mt-3 p-2 bg-red-50 rounded text-sm text-red-700">
            Last error: {rule.lastErrorCode} ({formatTimeAgo(rule.lastErrorAt)})
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
          <span>Next check: {formatTimeAgo(rule.nextRunAt)}</span>
          <span className="hover:text-primary-600">View Details →</span>
        </div>
      </div>
    </Link>
  );
}
