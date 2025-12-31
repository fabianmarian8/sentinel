'use client';

import { useState, useEffect } from 'react';
import { RuleCard } from '@/components/RuleCard';
import { HealthBadge } from '@/components/HealthBadge';
import { useAuth } from '@/contexts/AuthContext';
import { Header } from '@/components/layout';
import { Button, Card, Spinner } from '@/components/ui';
import api, { Rule } from '@/lib/api';

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
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      loadWorkspaceAndData();
    }
  }, [authLoading, user]);

  const loadWorkspaceAndData = async () => {
    try {
      setLoading(true);
      setError(null);

      // First, get user's workspaces
      let workspaces = await api.getWorkspaces();

      // If no workspace exists, create one
      if (workspaces.length === 0) {
        const newWorkspace = await api.createWorkspace({ name: 'My Workspace', type: 'ecommerce' });
        workspaces = [newWorkspace];
      }

      const wsId = workspaces[0].id;
      setWorkspaceId(wsId);

      // Load rules for this workspace
      try {
        const rulesData = await api.getRules(wsId);
        setRules(rulesData);

        // Calculate health summary from rules
        const total = rulesData.length;
        const healthy = rulesData.filter((r: Rule) => (r.healthScore ?? 0) >= 80).length;
        const warning = rulesData.filter((r: Rule) => (r.healthScore ?? 0) >= 50 && (r.healthScore ?? 0) < 80).length;
        const critical = rulesData.filter((r: Rule) => (r.healthScore ?? 0) < 50).length;
        const avgScore = total > 0
          ? Math.round(rulesData.reduce((sum: number, r: Rule) => sum + (r.healthScore ?? 0), 0) / total)
          : 0;

        setHealthSummary({
          totalRules: total,
          healthyRules: healthy,
          warningRules: warning,
          criticalRules: critical,
          averageScore: avgScore,
        });
      } catch (apiError) {
        console.error('API error:', apiError);
        setRules([]);
        setHealthSummary({
          totalRules: 0,
          healthyRules: 0,
          warningRules: 0,
          criticalRules: 0,
          averageScore: 0,
        });
      }
    } catch (err) {
      console.error('Failed to load workspace:', err);
      setError('Could not connect to API. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const filteredRules = rules.filter((rule) => {
    const score = rule.healthScore ?? 0;
    if (filter === 'all') return true;
    if (filter === 'healthy') return score >= 80;
    if (filter === 'warning') return score >= 50 && score < 80;
    if (filter === 'critical') return score < 50;
    return true;
  });

  const handlePauseRule = async (id: string) => {
    try {
      await api.pauseRule(id);
      // Update local state
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled: false } : r))
      );
    } catch (err) {
      console.error('Failed to pause rule:', err);
      alert('Nepodarilo sa pozastaviť pravidlo');
    }
  };

  const handleResumeRule = async (id: string) => {
    try {
      await api.resumeRule(id);
      // Update local state
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled: true } : r))
      );
    } catch (err) {
      console.error('Failed to resume rule:', err);
      alert('Nepodarilo sa spustiť pravidlo');
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await api.deleteRule(id);
      // Remove from local state
      setRules((prev) => prev.filter((r) => r.id !== id));
      // Update health summary
      setHealthSummary((prev) => ({
        ...prev,
        totalRules: prev.totalRules - 1,
      }));
    } catch (err) {
      console.error('Failed to delete rule:', err);
      alert('Nepodarilo sa vymazať pravidlo');
    }
  };

  const handleNewRule = () => {
    alert('Use the Sentinel browser extension to create new rules.\n\n1. Install the extension\n2. Navigate to any webpage\n3. Click the Sentinel icon\n4. Select an element to monitor');
  };

  // Show loading while auth is checking
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="xl" color="primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header onNewRule={handleNewRule} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-warning-50 border border-warning-200 text-warning-800 px-4 py-3 rounded-lg flex items-center justify-between dark:bg-warning-900/30 dark:border-warning-800 dark:text-warning-300">
            <span>{error}</span>
            <button
              onClick={loadWorkspaceAndData}
              className="text-warning-600 hover:text-warning-800 font-medium dark:text-warning-400 dark:hover:text-warning-200"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Spinner size="xl" color="primary" />
              <p className="mt-4 text-neutral-500 dark:text-neutral-400">Loading dashboard...</p>
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
        <Card className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Overall Health</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Average across all rules</p>
            </div>
            <HealthBadge score={healthSummary.averageScore} size="lg" />
          </div>
          <div className="mt-4 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                healthSummary.averageScore >= 80
                  ? 'bg-success-500'
                  : healthSummary.averageScore >= 50
                  ? 'bg-warning-500'
                  : 'bg-danger-500'
              }`}
              style={{ width: `${healthSummary.averageScore}%` }}
            />
          </div>
        </Card>

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {(['all', 'healthy', 'warning', 'critical'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-primary-600 text-white dark:bg-primary-500'
                  : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700 dark:hover:bg-neutral-700'
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
            <RuleCard
              key={rule.id}
              rule={rule}
              onPause={handlePauseRule}
              onResume={handleResumeRule}
              onDelete={handleDeleteRule}
            />
          ))}
        </div>

        {filteredRules.length === 0 && (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">📊</div>
            <p className="text-neutral-500 dark:text-neutral-400 mb-4">
              {rules.length === 0
                ? 'No monitoring rules yet. Create your first rule to get started!'
                : 'No rules match the selected filter'}
            </p>
            {rules.length === 0 && (
              <Button onClick={handleNewRule}>
                + Create First Rule
              </Button>
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
    green: 'bg-success-50 border-success-100 dark:bg-success-900/30 dark:border-success-800',
    yellow: 'bg-warning-50 border-warning-100 dark:bg-warning-900/30 dark:border-warning-800',
    red: 'bg-danger-50 border-danger-100 dark:bg-danger-900/30 dark:border-danger-800',
  };

  return (
    <div
      className={`rounded-lg shadow border p-4 transition-colors ${
        color ? colorClasses[color] : 'bg-white border-neutral-200 dark:bg-neutral-800 dark:border-neutral-700'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{value}</span>
      </div>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{title}</p>
    </div>
  );
}
