'use client';

import { useState, useEffect } from 'react';
import api, { NotificationChannel, ChannelType, CreateNotificationChannelDto, SlackChannel } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { requestPushPermission, isPushEnabled, getPlayerId, initOneSignal } from '@/lib/onesignal';
import { Header } from '@/components/layout';
import { Button, Card, Spinner, Modal, ModalFooter, Input } from '@/components/ui';

const CHANNEL_TYPES: { value: ChannelType; label: string; icon: string; description: string }[] = [
  { value: 'email', label: 'Email', icon: '📧', description: 'Receive alerts via email' },
  { value: 'slack_oauth', label: 'Slack', icon: '💬', description: 'Connect your Slack workspace' },
  { value: 'discord', label: 'Discord', icon: '🎮', description: 'Paste Discord webhook URL' },
  { value: 'push', label: 'Push', icon: '🔔', description: 'Browser push notifications' },
  { value: 'webhook', label: 'Webhook', icon: '🔗', description: 'Custom HTTP endpoint' },
];

function getChannelTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    email: 'Email',
    slack_oauth: 'Slack',
    discord: 'Discord',
    push: 'Push Notifications',
    webhook: 'Webhook',
    // Legacy
    telegram: 'Telegram (Legacy)',
    slack: 'Slack Webhook (Legacy)',
  };
  return labels[type] || type;
}

export default function SettingsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      loadWorkspaceAndChannels();
    }
  }, [authLoading, user]);

  const loadWorkspaceAndChannels = async () => {
    try {
      setLoading(true);
      // Get user's workspace
      let workspaces = await api.getWorkspaces();
      if (workspaces.length === 0) {
        const newWorkspace = await api.createWorkspace({ name: 'My Workspace', type: 'ecommerce' });
        workspaces = [newWorkspace];
      }
      const wsId = workspaces[0].id;
      setWorkspaceId(wsId);

      // Load channels
      const data = await api.getNotificationChannels(wsId);
      setChannels(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleChannel = async (channel: NotificationChannel) => {
    try {
      await api.updateNotificationChannel(channel.id, { enabled: !channel.enabled });
      setChannels(channels.map(c =>
        c.id === channel.id ? { ...c, enabled: !c.enabled } : c
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update channel');
    }
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm('Are you sure you want to delete this notification channel?')) return;

    try {
      await api.deleteNotificationChannel(id);
      setChannels(channels.filter(c => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete channel');
    }
  };

  const handleTestChannel = async (id: string) => {
    try {
      setTestingId(id);
      setTestResult(null);
      const result = await api.testNotificationChannel(id);
      setTestResult({ id, ...result });
    } catch (err) {
      setTestResult({ id, success: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTestingId(null);
    }
  };

  const handleAddChannel = async (data: CreateNotificationChannelDto) => {
    try {
      const newChannel = await api.createNotificationChannel(data);
      setChannels([newChannel, ...channels]);
      setShowAddModal(false);
    } catch (err) {
      throw err;
    }
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
      <Header />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page title */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Settings</h1>
          <p className="text-neutral-500 dark:text-neutral-400">Configure your notification preferences</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-danger-50 border border-danger-200 text-danger-700 px-4 py-3 rounded-lg dark:bg-danger-900/30 dark:border-danger-800 dark:text-danger-300">
            {error}
            <button onClick={() => setError(null)} className="float-right text-danger-500 hover:text-danger-700 dark:text-danger-400 dark:hover:text-danger-200">
              &times;
            </button>
          </div>
        )}

        {/* Notification Channels Section */}
        <Card padding="none">
          <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Notification Channels</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Configure where you receive alerts</p>
            </div>
            <Button
              onClick={() => setShowAddModal(true)}
              size="sm"
              leftIcon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              }
            >
              Add Channel
            </Button>
          </div>

          {loading ? (
            <div className="p-8 text-center">
              <Spinner size="lg" color="primary" />
            </div>
          ) : channels.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-4">🔔</div>
              <p className="text-neutral-500 dark:text-neutral-400 mb-4">No notification channels configured</p>
              <Button variant="ghost" onClick={() => setShowAddModal(true)}>
                Add your first channel
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {channels.map((channel) => (
                <li key={channel.id} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <span className="text-2xl">
                        {CHANNEL_TYPES.find(t => t.value === channel.type)?.icon || '📢'}
                      </span>
                      <div>
                        <h3 className="font-medium text-neutral-900 dark:text-neutral-100">{channel.name}</h3>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400">
                          {getChannelTypeLabel(channel.type)}
                          {channel.config?.email && ` • ${channel.config.email}`}
                          {channel.config?.channelName && ` • #${channel.config.channelName}`}
                          {channel.config?.teamName && ` (${channel.config.teamName})`}
                          {channel.config?.webhookUrl && ` • Discord`}
                          {channel.config?.playerId && ` • Browser`}
                          {channel.config?.url && ` • ${new URL(channel.config.url).hostname}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      {testResult?.id === channel.id && (
                        <span className={`text-sm ${testResult.success ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                          {testResult.message}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleTestChannel(channel.id)}
                        disabled={testingId === channel.id}
                      >
                        {testingId === channel.id ? 'Testing...' : 'Test'}
                      </Button>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={channel.enabled}
                          onChange={() => handleToggleChannel(channel)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-neutral-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 dark:after:border-neutral-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteChannel(channel.id)}
                        className="text-danger-500 hover:text-danger-700 dark:text-danger-400 dark:hover:text-danger-300"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>

      {/* Add Channel Modal */}
      {showAddModal && workspaceId && (
        <AddChannelModal
          workspaceId={workspaceId}
          onAdd={handleAddChannel}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

function AddChannelModal({
  workspaceId,
  onAdd,
  onClose,
}: {
  workspaceId: string;
  onAdd: (data: CreateNotificationChannelDto) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<ChannelType>('email');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email
  const [email, setEmail] = useState('');

  // Slack OAuth
  const [slackStep, setSlackStep] = useState<'connect' | 'select_channel' | 'done'>('connect');
  const [slackAccessToken, setSlackAccessToken] = useState('');
  const [slackTeamName, setSlackTeamName] = useState('');
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([]);
  const [selectedSlackChannel, setSelectedSlackChannel] = useState<SlackChannel | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);

  // Discord
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');

  // Push - placeholder for now
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPlayerId, setPushPlayerId] = useState('');

  // Webhook
  const [webhookUrl, setWebhookUrl] = useState('');

  // Listen for Slack OAuth callback
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'slack-oauth-callback' && event.data?.code) {
        try {
          setLoadingChannels(true);
          const redirectUri = `${window.location.origin}/oauth/slack/callback`;
          const result = await api.exchangeSlackCode(event.data.code, redirectUri);
          setSlackAccessToken(result.accessToken);
          setSlackTeamName(result.teamName);

          // Fetch channels
          const channels = await api.listSlackChannels(result.accessToken);
          setSlackChannels(channels);
          setSlackStep('select_channel');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to connect Slack');
        } finally {
          setLoadingChannels(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Check push notification status on modal open
  useEffect(() => {
    const checkPushStatus = async () => {
      const enabled = await isPushEnabled();
      if (enabled) {
        const playerId = await getPlayerId();
        if (playerId) {
          setPushEnabled(true);
          setPushPlayerId(playerId);
        }
      }
    };
    checkPushStatus();
  }, []);

  const handleConnectSlack = async () => {
    try {
      const redirectUri = `${window.location.origin}/oauth/slack/callback`;
      const { url } = await api.getSlackAuthUrl(redirectUri);
      // Open popup
      const popup = window.open(url, 'slack-oauth', 'width=600,height=700');
      if (!popup) {
        setError('Please allow popups to connect Slack');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Slack connection');
    }
  };

  const handleEnablePush = async () => {
    try {
      setError(null);
      // Initialize OneSignal and request permission
      const playerId = await requestPushPermission();
      if (playerId) {
        setPushPlayerId(playerId);
        setPushEnabled(true);
      } else {
        setError('Push notifications permission denied or unavailable');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable push notifications');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const channelName = name || `${CHANNEL_TYPES.find(t => t.value === type)?.label || type} Channel`;

    const data: CreateNotificationChannelDto = {
      name: channelName,
      type,
      workspaceId,
    };

    switch (type) {
      case 'email':
        if (!email) {
          setError('Email is required');
          return;
        }
        data.emailConfig = { email };
        break;

      case 'slack_oauth':
        if (!slackAccessToken || !selectedSlackChannel) {
          setError('Please connect Slack and select a channel');
          return;
        }
        data.slackOAuthConfig = {
          accessToken: slackAccessToken,
          channelId: selectedSlackChannel.id,
          channelName: selectedSlackChannel.name,
          teamName: slackTeamName,
        };
        break;

      case 'discord':
        if (!discordWebhookUrl) {
          setError('Discord webhook URL is required');
          return;
        }
        if (!discordWebhookUrl.startsWith('https://discord.com/api/webhooks/')) {
          setError('Invalid Discord webhook URL');
          return;
        }
        data.discordConfig = { webhookUrl: discordWebhookUrl };
        break;

      case 'push':
        if (!pushPlayerId) {
          setError('Push notifications not enabled');
          return;
        }
        data.pushConfig = { playerId: pushPlayerId, deviceType: 'web' };
        break;

      case 'webhook':
        if (!webhookUrl) {
          setError('Webhook URL is required');
          return;
        }
        data.webhookConfig = { url: webhookUrl };
        break;
    }

    try {
      setSaving(true);
      await onAdd(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add channel');
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = () => {
    switch (type) {
      case 'email':
        return !!email;
      case 'slack_oauth':
        return !!slackAccessToken && !!selectedSlackChannel;
      case 'discord':
        return !!discordWebhookUrl;
      case 'push':
        return !!pushPlayerId;
      case 'webhook':
        return !!webhookUrl;
      default:
        return false;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
          <h3 className="text-lg font-medium text-gray-900">Add Notification Channel</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
              {error}
            </div>
          )}

          {/* Channel Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Select Channel Type</label>
            <div className="grid grid-cols-5 gap-2">
              {CHANNEL_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  type="button"
                  onClick={() => {
                    setType(ct.value);
                    setError(null);
                  }}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    type === ct.value
                      ? 'border-primary-500 bg-primary-50 text-primary-700 ring-2 ring-primary-200'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-2xl mb-1">{ct.icon}</div>
                  <div className="text-xs font-medium">{ct.label}</div>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {CHANNEL_TYPES.find(t => t.value === type)?.description}
            </p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Channel Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`My ${CHANNEL_TYPES.find(t => t.value === type)?.label || ''} Alerts`}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Email Configuration */}
          {type === 'email' && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <label className="block text-sm font-medium text-gray-700">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alerts@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
              <p className="text-xs text-gray-500">
                You'll receive alerts at this email address via Resend.
              </p>
            </div>
          )}

          {/* Slack OAuth Configuration */}
          {type === 'slack_oauth' && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              {slackStep === 'connect' && (
                <>
                  <button
                    type="button"
                    onClick={handleConnectSlack}
                    disabled={loadingChannels}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#4A154B] text-white rounded-md hover:bg-[#3e1240] transition-colors disabled:opacity-50"
                  >
                    {loadingChannels ? (
                      <span>Connecting...</span>
                    ) : (
                      <>
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                        </svg>
                        <span className="font-medium">Connect Slack</span>
                      </>
                    )}
                  </button>
                  <p className="text-xs text-gray-500 text-center">
                    Click to authorize Sentinel to post to your Slack workspace
                  </p>
                </>
              )}

              {slackStep === 'select_channel' && (
                <>
                  <div className="flex items-center gap-2 text-sm text-green-600 mb-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Connected to {slackTeamName}
                  </div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Select Channel</label>
                  <select
                    value={selectedSlackChannel?.id || ''}
                    onChange={(e) => {
                      const channel = slackChannels.find(c => c.id === e.target.value);
                      setSelectedSlackChannel(channel || null);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select a channel...</option>
                    {slackChannels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        #{channel.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}

          {/* Discord Configuration */}
          {type === 'discord' && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <label className="block text-sm font-medium text-gray-700">Discord Webhook URL</label>
              <input
                type="url"
                value={discordWebhookUrl}
                onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
              <p className="text-xs text-gray-500">
                In Discord: Server Settings → Integrations → Webhooks → Create Webhook → Copy URL
              </p>
            </div>
          )}

          {/* Push Configuration */}
          {type === 'push' && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              {!pushEnabled ? (
                <>
                  <button
                    type="button"
                    onClick={handleEnablePush}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    <span className="font-medium">Enable Push Notifications</span>
                  </button>
                  <p className="text-xs text-gray-500 text-center">
                    Your browser will ask for permission to send notifications
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Push notifications enabled for this browser
                </div>
              )}
            </div>
          )}

          {/* Webhook Configuration */}
          {type === 'webhook' && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <label className="block text-sm font-medium text-gray-700">Webhook URL</label>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhook"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
              <p className="text-xs text-gray-500">
                We'll POST JSON data to this URL when alerts trigger
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !canSubmit()}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Adding...' : 'Add Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
