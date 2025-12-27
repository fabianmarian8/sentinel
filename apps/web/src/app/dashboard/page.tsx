'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RuleCard } from '@/components/RuleCard';
import { HealthBadge } from '@/components/HealthBadge';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';

interface Rule {
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
    lastStable: unknown;
  } | null;
  observationCount: number;
}

interface HealthSummary {
  totalRules: number;
  healthyRules: number;
  warningRules: number;
  criticalRules: number;
  averageScore: number;
}

export default function DashboardPage() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [healthSummary, setHealthSummary] = useState<HealthSummary>({
    totalRules: 0,
    healthyRules: 0,
    warningRules: 0,
    criticalRules: 0,
    averageScore: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'healthy' | 'warning' | 'critical'>('all');

  // Use user's workspace or fallback
  const workspaceId = 'demo-workspace'; // TODO: Get from user's workspaces

  // Show loading while auth is checking
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Try to load from API, fall back to empty state
      try {
        const [rulesData, healthData] = await Promise.all([
          api.getRules(workspaceId),
          api.getHealthSummary(workspaceId),
        ]);
        setRules(rulesData);
        setHealthSummary(healthData);
      } catch (apiError) {
        // If API fails, show empty state with message
        console.error('API error:', apiError);
        setError('Could not connect to API. Showing empty dashboard.');
        setRules([]);
        setHealthSummary({
          totalRules: 0,
          healthyRules: 0,
          warningRules: 0,
          criticalRules: 0,
          averageScore: 0,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const filteredRules = rules.filter((rule) => {
    if (filter === 'all') return true;
    if (filter === 'healthy') return rule.healthScore >= 80;
    if (filter === 'warning') return rule.healthScore >= 50 && rule.healthScore < 80;
    if (filter === 'critical') return rule.healthScore < 50;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link href="/" className="text-2xl font-bold text-primary-600">
                Sentinel
              </Link>
              <span className="ml-4 text-gray-400">/</span>
              <span className="ml-4 text-gray-900 font-medium">Dashboard</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/dashboard/rules/new"
                className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-md text-sm font-medium"
              >
                + New Rule
              </Link>
              <Link
                href="/dashboard/settings"
                className="text-gray-500 hover:text-gray-700"
                title="Settings"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </Link>
              <button className="text-gray-500 hover:text-gray-700">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </button>
              {user && (
                <div className="flex items-center space-x-3 pl-3 border-l border-gray-200">
                  <span className="text-sm text-gray-600">{user.email}</span>
                  <button
                    onClick={logout}
                    className="text-gray-500 hover:text-gray-700"
                    title="Logout"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={loadData}
              className="text-yellow-600 hover:text-yellow-800 font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
              <p className="mt-4 text-gray-500">Loading dashboard...</p>
            </div>
          </div>
        ) : (
          <>
        {/* Health Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <SummaryCard
            title="Total Rules"
            value={healthSummary.totalRules}
            icon="📊"
          />
          <SummaryCard
            title="Healthy"
            value={healthSummary.healthyRules}
            icon="✅"
            color="green"
          />
          <SummaryCard
            title="Warning"
            value={healthSummary.warningRules}
            icon="⚠️"
            color="yellow"
          />
          <SummaryCard
            title="Critical"
            value={healthSummary.criticalRules}
            icon="🚨"
            color="red"
          />
        </div>

        {/* Average Health */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Overall Health</h2>
              <p className="text-sm text-gray-500">Average across all rules</p>
            </div>
            <HealthBadge score={healthSummary.averageScore} size="lg" />
          </div>
          <div className="mt-4 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                healthSummary.averageScore >= 80
                  ? 'bg-green-500'
                  : healthSummary.averageScore >= 50
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
              }`}
              style={{ width: `${healthSummary.averageScore}%` }}
            />
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex space-x-2 mb-6">
          {(['all', 'healthy', 'warning', 'critical'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== 'all' && (
                <span className="ml-1 text-xs opacity-75">
                  ({f === 'healthy' ? healthSummary.healthyRules :
                    f === 'warning' ? healthSummary.warningRules :
                    healthSummary.criticalRules})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Rules Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} />
          ))}
        </div>

        {filteredRules.length === 0 && (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">📊</div>
            <p className="text-gray-500 mb-4">
              {rules.length === 0
                ? 'No monitoring rules yet. Create your first rule to get started!'
                : 'No rules match the selected filter'}
            </p>
            {rules.length === 0 && (
              <Link
                href="/dashboard/rules/new"
                className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                + Create First Rule
              </Link>
            )}
          </div>
        )}
          </>
        )}
      </main>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: string;
  color?: 'green' | 'yellow' | 'red';
}) {
  const colorClasses = {
    green: 'bg-green-50 border-green-100',
    yellow: 'bg-yellow-50 border-yellow-100',
    red: 'bg-red-50 border-red-100',
  };

  return (
    <div
      className={`rounded-lg shadow border p-4 ${
        color ? colorClasses[color] : 'bg-white border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        <span className="text-2xl font-bold text-gray-900">{value}</span>
      </div>
      <p className="mt-2 text-sm text-gray-600">{title}</p>
    </div>
  );
}
