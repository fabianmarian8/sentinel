'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { HealthBadge } from '@/components/HealthBadge';
import api, { Rule, TestRuleResult } from '@/lib/api';
import { getErrorInfo } from '@sentinel/shared';

export default function RuleDetailClient() {
  const params = useParams();
  const router = useRouter();
  const [rule, setRule] = useState<Rule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestRuleResult | null>(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingInterval, setIsEditingInterval] = useState(false);
  const [newIntervalMinutes, setNewIntervalMinutes] = useState<number>(0);

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

  const formatCurrentValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'Žiadne dáta';
    if (typeof value === 'object') {
      const v = value as Record<string, unknown>;
      // Price/Number: { value: number }
      if ('value' in v && typeof v.value === 'number') return String(v.value);
      // Legacy: { amount: number }
      if ('amount' in v) return String(v.amount);
      // Availability: { inStock: boolean }
      if ('inStock' in v) return v.inStock ? 'Na sklade' : 'Nedostupné';
      // Text: { snippet: string }
      if ('snippet' in v) return String(v.snippet);
      // Raw value
      if ('raw' in v) return String(v.raw);
      return JSON.stringify(v);
    }
    return String(value);
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
      setError(err instanceof Error ? err.message : 'Nepodarilo sa zmeniť nastavenie screenshotov');
    }
  };

  const handleToggleCaptchaRestriction = async () => {
    if (!rule) return;
    try {
      const newValue = !rule.captchaIntervalEnforced;
      // When disabling CAPTCHA restriction, also set autoThrottleDisabled to prevent re-enabling
      // When enabling, keep autoThrottleDisabled as-is (user might want to re-enable protection)
      const updateData: { captchaIntervalEnforced: boolean; autoThrottleDisabled?: boolean } = {
        captchaIntervalEnforced: newValue,
      };
      if (!newValue) {
        updateData.autoThrottleDisabled = true; // Prevent worker from re-enabling
      }
      await api.updateRule(rule.id, updateData);
      setRule((prev) => prev ? { ...prev, captchaIntervalEnforced: newValue } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodarilo sa zmeniť CAPTCHA obmedzenie');
    }
  };

  const handleDelete = async () => {
    if (!rule) return;
    setIsDeleting(true);
    try {
      await api.deleteRule(rule.id);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodarilo sa vymazať pravidlo');
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleIntervalChange = async () => {
    const parsedInterval = Number(newIntervalMinutes);
    if (!rule || isNaN(parsedInterval) || parsedInterval <= 0) return;
    try {
      await api.updateRule(rule.id, {
        schedule: {
          intervalSeconds: newIntervalMinutes * 60,
          jitterSeconds: rule.schedule.jitterSeconds
        }
      });
      setRule((prev) => prev ? {
        ...prev,
        schedule: { ...prev.schedule, intervalSeconds: newIntervalMinutes * 60 }
      } : null);
      setIsEditingInterval(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodarilo sa zmeniť interval');
    }
  };

  const startEditingInterval = () => {
    if (rule) {
      setNewIntervalMinutes(rule.schedule.intervalSeconds / 60);
      setIsEditingInterval(true);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Načítavam pravidlo...</p>
        </div>
      </div>
    );
  }

  if (error || !rule) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">😕</div>
          <p className="text-neutral-500 dark:text-neutral-400 mb-4">{error || 'Pravidlo nenájdené'}</p>
          <Link
            href="/dashboard"
            className="text-primary-600 hover:text-primary-700 font-medium"
          >
            ← Späť na Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      {/* Header */}
      <header className="bg-white dark:bg-neutral-800 shadow-sm border-b dark:border-neutral-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link href="/" className="text-2xl font-bold text-primary-600">
                Sentinel
              </Link>
              <span className="ml-4 text-neutral-400 dark:text-neutral-500">/</span>
              <Link href="/dashboard" className="ml-4 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
                Dashboard
              </Link>
              <span className="ml-4 text-neutral-400 dark:text-neutral-500">/</span>
              <span className="ml-4 text-neutral-900 dark:text-white font-medium">{rule.name}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Rule Header */}
        <div className="bg-white dark:bg-neutral-800 rounded-lg shadow border border-neutral-200 dark:border-neutral-700 p-6 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">{rule.name}</h1>
                {!rule.enabled && (
                  <span className="px-3 py-1 text-sm bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 rounded-full">
                    Pozastavené
                  </span>
                )}
              </div>
              <p className="mt-1 text-neutral-500 dark:text-neutral-400 break-all">
                <a
                  href={rule.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary-600 hover:underline"
                >
                  {rule.source.url}
                </a>
              </p>
              <div className="mt-4 flex items-center gap-4 text-sm text-neutral-500 dark:text-neutral-400">
                <span>Typ: <strong className="text-neutral-700 dark:text-neutral-200">{rule.ruleType}</strong></span>
                <span>•</span>
                <span>Vytvorené: <strong className="text-neutral-700 dark:text-neutral-200">{formatTimeAgo(rule.createdAt)}</strong></span>
                <span>•</span>
                <span>Ďalšia kontrola: <strong className="text-neutral-700 dark:text-neutral-200">{formatTimeAgo(rule.nextRunAt)}</strong></span>
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
                  {isTestRunning ? 'Testujem...' : 'Otestovať'}
                </button>
                {rule.enabled ? (
                  <button
                    onClick={handlePause}
                    className="px-4 py-2 bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-600"
                  >
                    Pozastaviť
                  </button>
                ) : (
                  <button
                    onClick={handleResume}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    Obnoviť
                  </button>
                )}
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Vymazať
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Test Result */}
        {testResult && (
          <div className={`rounded-lg shadow border p-4 mb-6 ${testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <h3 className={`font-medium ${testResult.success ? 'text-green-800' : 'text-red-800'}`}>
              Test {testResult.success ? 'úspešný' : 'zlyhal'}
            </h3>
            <div className="mt-2 grid grid-cols-3 gap-4 text-sm text-gray-700">
              <div>
                <span className="text-gray-500">Čas načítania:</span>{' '}
                <span className="font-medium text-gray-900">{testResult.timing?.fetchMs || 'N/A'}ms</span>
              </div>
              <div>
                <span className="text-gray-500">HTTP stav:</span>{' '}
                <span className="font-medium text-gray-900">{testResult.fetch?.httpStatus || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500">Extrahovaná hodnota:</span>{' '}
                <span className="font-medium text-gray-900">{testResult.extraction?.rawValue || 'N/A'}</span>
              </div>
            </div>
            {testResult.errors && testResult.errors.length > 0 && (
              <div className="mt-2 text-red-600">
                Chyby: {testResult.errors.join(', ')}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Current Value */}
          <div className="lg:col-span-2 bg-white dark:bg-neutral-800 rounded-lg shadow border border-neutral-200 dark:border-neutral-700 p-6">
            <h2 className="text-lg font-medium text-neutral-900 dark:text-white mb-4">Aktuálna hodnota</h2>
            <div className="text-4xl font-bold text-neutral-900 dark:text-white">
              {formatCurrentValue(rule.currentState?.lastStable)}
            </div>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              Naposledy aktualizované: {formatTimeAgo(rule.currentState?.updatedAt ?? null)}
            </p>
          </div>

          {/* Configuration */}
          <div className="bg-white dark:bg-neutral-800 rounded-lg shadow border border-neutral-200 dark:border-neutral-700 p-6">
            <h2 className="text-lg font-medium text-neutral-900 dark:text-white mb-4">Konfigurácia</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-neutral-500 dark:text-neutral-400">Selektor</dt>
                <dd className="font-mono text-xs bg-neutral-100 dark:bg-neutral-700 dark:text-neutral-200 p-2 rounded mt-1">
                  {rule.extraction.selector}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500 dark:text-neutral-400">Metóda</dt>
                <dd className="font-medium text-neutral-900 dark:text-white">{rule.extraction.method.toUpperCase()}</dd>
              </div>
              <div>
                <dt className="text-neutral-500 dark:text-neutral-400">Interval kontroly</dt>
                {isEditingInterval ? (
                  <div className="mt-1 flex items-center gap-2">
                    <select
                      value={newIntervalMinutes}
                      onChange={(e) => setNewIntervalMinutes(Number(e.target.value))}
                      className="px-2 py-1 border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value={5}>5 min</option>
                      <option value={10}>10 min</option>
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={60}>1 hod</option>
                      <option value={120}>2 hod</option>
                      <option value={360}>6 hod</option>
                      <option value={720}>12 hod</option>
                      <option value={1440}>24 hod</option>
                    </select>
                    <button
                      onClick={handleIntervalChange}
                      className="px-2 py-1 bg-primary-600 text-white text-xs rounded hover:bg-primary-700"
                    >
                      Uložiť
                    </button>
                    <button
                      onClick={() => setIsEditingInterval(false)}
                      className="px-2 py-1 bg-neutral-200 dark:bg-neutral-600 text-neutral-700 dark:text-neutral-200 text-xs rounded hover:bg-neutral-300 dark:hover:bg-neutral-500"
                    >
                      Zrušiť
                    </button>
                  </div>
                ) : (
                  <dd className="font-medium text-neutral-900 dark:text-white flex items-center gap-2">
                    Každých {rule.schedule.intervalSeconds / 60} minút
                    <button
                      onClick={startEditingInterval}
                      className="text-primary-600 hover:text-primary-700 text-xs"
                    >
                      (zmeniť)
                    </button>
                  </dd>
                )}
                <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                      <span>{rule.captchaIntervalEnforced ? '🔒' : '🔓'}</span>
                      <span className="font-medium">CAPTCHA obmedzenie</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rule.captchaIntervalEnforced}
                        onChange={handleToggleCaptchaRestriction}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                    </label>
                  </div>
                  {rule.captchaIntervalEnforced ? (
                    <p className="mt-1 text-amber-600 dark:text-amber-400">
                      Stránka vyžaduje CAPTCHA. Interval bol automaticky zmenený na 1 deň pre úsporu nákladov.
                      {rule.originalSchedule?.intervalSeconds && (
                        <span className="block mt-0.5">
                          Pôvodný interval: {Math.round(rule.originalSchedule.intervalSeconds / 60)} min
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="mt-1 text-neutral-500 dark:text-neutral-400">
                      CAPTCHA obmedzenie je vypnuté. Normálny interval kontroly je aktívny.
                    </p>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-neutral-100 dark:border-neutral-700">
                <div className="flex items-center justify-between">
                  <div>
                    <dt className="text-neutral-500 dark:text-neutral-400">Snímky obrazovky</dt>
                    <dd className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">Zachytiť pri zmene</dd>
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
        <div className="mt-6 bg-white dark:bg-neutral-800 rounded-lg shadow border border-neutral-200 dark:border-neutral-700 p-6">
          <h2 className="text-lg font-medium text-neutral-900 dark:text-white mb-4">Posledné pozorovania</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">
                    Čas
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">
                    Hodnota
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">
                    Stav
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">
                    Zmena
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">
                    Snímka
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
                {(rule.latestObservations || []).map((obs) => (
                  <tr key={obs.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-700/50">
                    <td className="px-4 py-3 text-sm text-neutral-900 dark:text-neutral-100">
                      {formatTimeAgo(obs.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-neutral-900 dark:text-white">
                      {obs.extractedRaw}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {obs.run.errorCode ? (() => {
                        const errInfo = getErrorInfo(obs.run.errorCode);
                        return (
                          <span
                            className={`px-2 py-1 rounded text-xs cursor-help ${
                              errInfo?.severity === 'critical' ? 'bg-red-200 text-red-800' :
                              errInfo?.severity === 'error' ? 'bg-red-100 text-red-700' :
                              errInfo?.severity === 'warning' ? 'bg-amber-100 text-amber-700' :
                              'bg-blue-100 text-blue-700'
                            }`}
                            title={`${errInfo?.description || ''}\n\n💡 ${errInfo?.recommendation || ''}`}
                          >
                            {errInfo?.title || obs.run.errorCode}
                          </span>
                        );
                      })() : (
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
                            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{obs.diffSummary}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-neutral-400 dark:text-neutral-500">Bez zmeny</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {obs.run.screenshotPath ? (
                        <button
                          onClick={() => setSelectedScreenshot(obs.run.screenshotPath)}
                          className="group relative"
                        >
                          <img
                            src={obs.run.screenshotPath}
                            alt="Snímka obrazovky"
                            className="w-16 h-10 object-cover rounded border border-neutral-200 dark:border-neutral-600 hover:border-primary-500 transition-colors"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                            </svg>
                          </span>
                        </button>
                      ) : (
                        <span className="text-neutral-300 dark:text-neutral-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Screenshot Modal */}
      {selectedScreenshot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedScreenshot(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] w-full">
            <button
              onClick={() => setSelectedScreenshot(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={selectedScreenshot}
              alt="Screenshot"
              className="w-full h-auto max-h-[85vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <a
              href={selectedScreenshot}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-white hover:text-gray-300 text-sm flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Otvoriť v novom okne
            </a>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !isDeleting && setShowDeleteConfirm(false)}
        >
          <div
            className="bg-white dark:bg-neutral-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2">
              Vymazať pravidlo?
            </h3>
            <p className="text-neutral-600 dark:text-neutral-300 mb-4">
              Naozaj chcete vymazať pravidlo <strong>{rule.name}</strong>?
              Táto akcia je nevratná a vymaže všetky súvisiace pozorovania a alerty.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-600 disabled:opacity-50"
              >
                Zrušiť
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? 'Mazanie...' : 'Vymazať'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
