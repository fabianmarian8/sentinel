'use client';

import { useState } from 'react';
import Link from 'next/link';
import { HealthBadge } from './HealthBadge';
import { getErrorInfo } from '@sentinel/shared';

interface RuleCardProps {
  rule: {
    id: string;
    name: string;
    ruleType: string;
    enabled: boolean;
    healthScore: number | null;
    lastErrorCode: string | null;
    lastErrorAt: string | null;
    nextRunAt: string | null;
    source: {
      url: string;
      domain: string;
    };
    currentState?: {
      lastStable: any;
    } | null;
    observationCount?: number;
    captchaIntervalEnforced?: boolean;
    originalSchedule?: { intervalSeconds?: number } | null;
  };
  onPause?: (id: string) => Promise<void>;
  onResume?: (id: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export function RuleCard({ rule, onPause, onResume, onDelete }: RuleCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handlePauseResume = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLoading) return;

    setIsLoading(true);
    try {
      if (rule.enabled && onPause) {
        await onPause(rule.id);
      } else if (!rule.enabled && onResume) {
        await onResume(rule.id);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLoading || !onDelete) return;

    setIsLoading(true);
    try {
      await onDelete(rule.id);
    } finally {
      setIsLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleDeleteCancel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDeleteConfirm(false);
  };

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

  const formatTimeUntil = (dateStr: string | null) => {
    if (!dateStr) return 'Nikdy';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    // Ak je v minulosti, už prebehlo alebo práve beží
    if (diffMs < 0) return 'Teraz';

    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return `o ${diffSecs}s`;
    if (diffMins < 60) return `o ${diffMins} min`;
    if (diffHours < 24) return `o ${diffHours}h`;
    return `o ${diffDays}d`;
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
    const val = rule.currentState.lastStable;
    if (typeof val === 'object' && val !== null) {
      // Price/Number: { value: number, currency?: string }
      if ('value' in val && typeof val.value === 'number') {
        return String(val.value);
      }
      // Legacy price format: { amount: number, currency: string }
      if ('amount' in val) return String(val.amount);
      // Availability: { inStock: boolean }
      if ('inStock' in val) return val.inStock ? 'In Stock' : 'Out of Stock';
      // Text: { snippet: string, hash: string }
      if ('snippet' in val) return val.snippet?.substring(0, 50) + '...';
    }
    return String(val);
  };

  return (
    <Link href={`/dashboard/rules/${rule.id}`}>
      <div className={`relative bg-white dark:bg-neutral-800 rounded-lg shadow border hover:shadow-lg transition-all p-4 cursor-pointer ${
        rule.enabled
          ? 'border-neutral-200 dark:border-neutral-700'
          : 'border-neutral-300 bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900'
      }`}>
        {/* Delete confirmation overlay */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-white/95 dark:bg-neutral-800/95 rounded-lg flex flex-col items-center justify-center z-10 p-4">
            <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-3 text-center">Naozaj vymazať toto pravidlo?</p>
            <div className="flex gap-2">
              <button
                onClick={handleDeleteConfirm}
                disabled={isLoading}
                className="px-3 py-1.5 bg-danger-600 text-white text-sm rounded hover:bg-danger-700 disabled:opacity-50"
              >
                {isLoading ? 'Mažem...' : 'Vymazať'}
              </button>
              <button
                onClick={handleDeleteCancel}
                className="px-3 py-1.5 bg-neutral-200 text-neutral-700 text-sm rounded hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600"
              >
                Zrušiť
              </button>
            </div>
          </div>
        )}

        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {/* Status indicator */}
              <span
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  rule.enabled ? 'bg-success-500' : 'bg-neutral-400'
                }`}
                title={rule.enabled ? 'Aktívne' : 'Pozastavené'}
              />
              <span className="text-xl">{getRuleTypeIcon(rule.ruleType)}</span>
              <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 truncate">
                {rule.name}
              </h3>
              {!rule.enabled && (
                <span className="px-2 py-0.5 text-xs bg-neutral-200 text-neutral-600 rounded-full dark:bg-neutral-700 dark:text-neutral-400">
                  Pozastavené
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400 truncate">
              {rule.source.domain}
            </p>
          </div>
          <HealthBadge score={rule.healthScore} size="sm" showLabel={false} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-neutral-500 dark:text-neutral-400">Current Value:</span>
            <p className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
              {getCurrentValue()}
            </p>
          </div>
          <div>
            <span className="text-neutral-500 dark:text-neutral-400">Observations:</span>
            <p className="font-medium text-neutral-900 dark:text-neutral-100">{rule.observationCount}</p>
          </div>
        </div>

        {rule.lastErrorCode && (() => {
          const errorInfo = getErrorInfo(rule.lastErrorCode);
          return (
            <div className={`mt-3 p-2 rounded text-sm ${
              errorInfo?.severity === 'critical' ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/50 dark:text-danger-300' :
              errorInfo?.severity === 'error' ? 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400' :
              errorInfo?.severity === 'warning' ? 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400' :
              'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
            }`}>
              <div className="font-medium">{errorInfo?.title || rule.lastErrorCode}</div>
              <div className="text-xs mt-1 opacity-80">{errorInfo?.recommendation}</div>
              <div className="text-xs mt-1 opacity-60">{formatTimeAgo(rule.lastErrorAt)}</div>
            </div>
          );
        })()}

        {rule.captchaIntervalEnforced && (
          <div className="mt-3 p-2 bg-warning-50 border border-warning-200 rounded text-sm text-warning-800 flex items-center gap-2 dark:bg-warning-900/30 dark:border-warning-800 dark:text-warning-300">
            <span>🔒</span>
            <span>
              Interval zmenený na 1 deň (CAPTCHA ochrana)
              {rule.originalSchedule?.intervalSeconds && (
                <span className="text-warning-600 dark:text-warning-400 ml-1">
                  (pôvodne {Math.round(rule.originalSchedule.intervalSeconds / 60)} min)
                </span>
              )}
            </span>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-neutral-400 dark:text-neutral-500">
            {rule.enabled ? `Ďalšia kontrola: ${formatTimeUntil(rule.nextRunAt)}` : 'Pozastavené'}
          </span>
          <div className="flex items-center gap-1">
            {/* Pause/Resume button */}
            {(onPause || onResume) && (
              <button
                onClick={handlePauseResume}
                disabled={isLoading}
                className={`p-1.5 rounded transition-colors ${
                  rule.enabled
                    ? 'text-neutral-400 hover:text-warning-600 hover:bg-warning-50 dark:hover:bg-warning-900/30'
                    : 'text-neutral-400 hover:text-success-600 hover:bg-success-50 dark:hover:bg-success-900/30'
                } disabled:opacity-50`}
                title={rule.enabled ? 'Pozastaviť' : 'Spustiť'}
              >
                {rule.enabled ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </button>
            )}
            {/* Delete button */}
            {onDelete && (
              <button
                onClick={handleDeleteClick}
                disabled={isLoading}
                className="p-1.5 rounded text-neutral-400 hover:text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/30 transition-colors disabled:opacity-50"
                title="Vymazať"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            <span className="text-xs text-neutral-400 hover:text-primary-600 dark:hover:text-primary-400 ml-2">Detaily →</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
