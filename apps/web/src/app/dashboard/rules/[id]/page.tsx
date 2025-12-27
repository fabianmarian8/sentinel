'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { HealthBadge } from '@/components/HealthBadge';
import api from '@/lib/api';

interface RuleDetail {
  id: string;
  name: string;
  ruleType: string;
  enabled: boolean;
  healthScore: number;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  screenshotOnChange: boolean;
  extraction: {
    method: string;
    selector: string;
    attribute?: string;
  };
  schedule: {
    intervalSeconds: number;
    jitterSeconds: number;
  };
  source: {
    id: string;
    url: string;
    domain: string;
    workspace: {
      id: string;
      name: string;
    };
  };
  currentState: {
    lastStable: any;
    candidate: any;
    candidateCount: number;
    updatedAt: string;
  } | null;
  latestObservations: Array<{
    id: string;
    extractedRaw: string;
    extractedNormalized: any;
    changeDetected: boolean;
    changeKind: string | null;
    diffSummary?: string;
    createdAt: string;
    run: { httpStatus: number; errorCode: string | null };
  }>;
}

export default function RuleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [rule, setRule] = useState<RuleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    if (params.id) {
      loadRule(params.id as string);
    }
  }, [params.id]);

  const loadRule = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getRule(id);
      setRule(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rule');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString();
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
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    return `${diffDays} days ago`;
  };

  const handleTest = async () => {
    if (!rule) return;
    setIsTestRunning(true);
    setTestResult(null);

    try {
      const result = await api.testRule(rule.id);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        errors: [err instanceof Error ? err.message : 'Test failed'],
      });
    } finally {
      setIsTestRunning(false);
    }
  };

  const handlePause = async () => {
    if (!rule) return;
    try {
      await api.pauseRule(rule.id);
      setRule((prev) => prev ? { ...prev, enabled: false } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause rule');
    }
  };

  const handleResume = async () => {
    if (!rule) return;
    try {
      await api.resumeRule(rule.id);
      setRule((prev) => prev ? { ...prev, enabled: true } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume rule');
    }
  };

  const handleToggleScreenshots = async () => {
    if (!rule) return;
    try {
      await api.updateRule(rule.id, { screenshotOnChange: !rule.screenshotOnChange });
      setRule((prev) => prev ? { ...prev, screenshotOnChange: !prev.screenshotOnChange } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update screenshots setting');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading rule...</p>
        </div>
      </div>
    );
  }

  if (error || !rule) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">😕</div>
          <p className="text-gray-500 mb-4">{error || 'Rule not found'}</p>
          <Link
            href="/dashboard"
            className="text-primary-600 hover:text-primary-700 font-medium"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

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
              <Link href="/dashboard" className="ml-4 text-gray-600 hover:text-gray-900">
                Dashboard
              </Link>
              <span className="ml-4 text-gray-400">/</span>
              <span className="ml-4 text-gray-900 font-medium">{rule.name}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Rule Header */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">{rule.name}</h1>
                {!rule.enabled && (
                  <span className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-full">
                    Paused
                  </span>
                )}
              </div>
              <p className="mt-1 text-gray-500">
                <a
                  href={rule.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary-600 hover:underline"
                >
                  {rule.source.url}
                </a>
              </p>
              <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
                <span>Type: <strong className="text-gray-700">{rule.ruleType}</strong></span>
                <span>•</span>
                <span>Created: <strong className="text-gray-700">{formatTimeAgo(rule.createdAt)}</strong></span>
                <span>•</span>
                <span>Next check: <strong className="text-gray-700">{formatTimeAgo(rule.nextRunAt)}</strong></span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <HealthBadge score={rule.healthScore} size="lg" />
              <div className="flex gap-2">
                <button
                  onClick={handleTest}
                  disabled={isTestRunning}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isTestRunning ? 'Testing...' : 'Test Now'}
                </button>
                {rule.enabled ? (
                  <button
                    onClick={handlePause}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={handleResume}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    Resume
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Test Result */}
        {testResult && (
          <div className={`rounded-lg shadow border p-4 mb-6 ${testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <h3 className={`font-medium ${testResult.success ? 'text-green-800' : 'text-red-800'}`}>
              Test {testResult.success ? 'Successful' : 'Failed'}
            </h3>
            <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Fetch Time:</span>{' '}
                <span className="font-medium">{testResult.timing.fetchMs}ms</span>
              </div>
              <div>
                <span className="text-gray-500">HTTP Status:</span>{' '}
                <span className="font-medium">{testResult.fetch.httpStatus}</span>
              </div>
              <div>
                <span className="text-gray-500">Extracted Value:</span>{' '}
                <span className="font-medium">{testResult.extraction.rawValue || 'N/A'}</span>
              </div>
            </div>
            {testResult.errors.length > 0 && (
              <div className="mt-2 text-red-600">
                Errors: {testResult.errors.join(', ')}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Current Value */}
          <div className="lg:col-span-2 bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Current Value</h2>
            <div className="text-4xl font-bold text-gray-900">
              {rule.currentState?.lastStable?.raw || 'No data'}
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Last updated: {formatTimeAgo(rule.currentState?.updatedAt ?? null)}
            </p>
          </div>

          {/* Configuration */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Configuration</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Selector</dt>
                <dd className="font-mono text-xs bg-gray-100 p-2 rounded mt-1">
                  {rule.extraction.selector}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Method</dt>
                <dd className="font-medium text-gray-900">{rule.extraction.method.toUpperCase()}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Check Interval</dt>
                <dd className="font-medium text-gray-900">
                  Every {rule.schedule.intervalSeconds / 60} minutes
                </dd>
              </div>
              <div className="pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <dt className="text-gray-500">Screenshots</dt>
                    <dd className="text-xs text-gray-400 mt-0.5">Capture on change</dd>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rule.screenshotOnChange}
                      onChange={handleToggleScreenshots}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>
              </div>
            </dl>
          </div>
        </div>

        {/* Observation History */}
        <div className="mt-6 bg-white rounded-lg shadow border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Recent Observations</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Time
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Value
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {rule.latestObservations.map((obs) => (
                  <tr key={obs.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {formatTimeAgo(obs.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {obs.extractedRaw}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {obs.run.errorCode ? (
                        <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">
                          {obs.run.errorCode}
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                          HTTP {obs.run.httpStatus}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {obs.changeDetected ? (
                        <div>
                          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                            {obs.changeKind}
                          </span>
                          {obs.diffSummary && (
                            <p className="mt-1 text-xs text-gray-500">{obs.diffSummary}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">No change</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
