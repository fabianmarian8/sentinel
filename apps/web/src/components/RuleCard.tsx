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
      <div className={`relative bg-white rounded-lg shadow border hover:shadow-lg transition-shadow p-4 cursor-pointer ${
        rule.enabled ? 'border-gray-200' : 'border-gray-300 bg-gray-50'
      }`}>
        {/* Delete confirmation overlay */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-white/95 rounded-lg flex flex-col items-center justify-center z-10 p-4">
            <p className="text-sm text-gray-700 mb-3 text-center">Naozaj vymazať toto pravidlo?</p>
            <div className="flex gap-2">
              <button
                onClick={handleDeleteConfirm}
                disabled={isLoading}
                className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
              >
                {isLoading ? 'Mažem...' : 'Vymazať'}
              </button>
              <button
                onClick={handleDeleteCancel}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
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
                  rule.enabled ? 'bg-green-500' : 'bg-gray-400'
                }`}
                title={rule.enabled ? 'Aktívne' : 'Pozastavené'}
              />
              <span className="text-xl">{getRuleTypeIcon(rule.ruleType)}</span>
              <h3 className="text-lg font-medium text-gray-900 truncate">
                {rule.name}
              </h3>
              {!rule.enabled && (
                <span className="px-2 py-0.5 text-xs bg-gray-200 text-gray-600 rounded-full">
                  Pozastavené
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

        {rule.lastErrorCode && (() => {
          const errorInfo = getErrorInfo(rule.lastErrorCode);
          return (
            <div className={`mt-3 p-2 rounded text-sm ${
              errorInfo?.severity === 'critical' ? 'bg-red-100 text-red-800' :
              errorInfo?.severity === 'error' ? 'bg-red-50 text-red-700' :
              errorInfo?.severity === 'warning' ? 'bg-amber-50 text-amber-700' :
              'bg-blue-50 text-blue-700'
            }`}>
              <div className="font-medium">{errorInfo?.title || rule.lastErrorCode}</div>
              <div className="text-xs mt-1 opacity-80">{errorInfo?.recommendation}</div>
              <div className="text-xs mt-1 opacity-60">{formatTimeAgo(rule.lastErrorAt)}</div>
            </div>
          );
        })()}

        {rule.captchaIntervalEnforced && (
          <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800 flex items-center gap-2">
            <span>🔒</span>
            <span>
              Interval zmenený na 1 deň (CAPTCHA ochrana)
              {rule.originalSchedule?.intervalSeconds && (
                <span className="text-amber-600 ml-1">
                  (pôvodne {Math.round(rule.originalSchedule.intervalSeconds / 60)} min)
                </span>
              )}
            </span>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {rule.enabled ? `Ďalšia kontrola: ${formatTimeAgo(rule.nextRunAt)}` : 'Pozastavené'}
          </span>
          <div className="flex items-center gap-1">
            {/* Pause/Resume button */}
            {(onPause || onResume) && (
              <button
                onClick={handlePauseResume}
                disabled={isLoading}
                className={`p-1.5 rounded transition-colors ${
                  rule.enabled
                    ? 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
                    : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
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
                className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                title="Vymazať"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            <span className="text-xs text-gray-400 hover:text-primary-600 ml-2">Detaily →</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
