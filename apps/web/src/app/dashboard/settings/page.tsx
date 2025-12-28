'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api, { NotificationChannel, ChannelType, CreateNotificationChannelDto } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const CHANNEL_TYPES: { value: ChannelType; label: string; icon: string }[] = [
  { value: 'email', label: 'Email', icon: '📧' },
  { value: 'telegram', label: 'Telegram', icon: '✈️' },
  { value: 'slack', label: 'Slack', icon: '💬' },
  { value: 'webhook', label: 'Webhook', icon: '🔗' },
];

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
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
              <Link href="/dashboard" className="ml-4 text-gray-500 hover:text-gray-700">
                Dashboard
              </Link>
              <span className="ml-4 text-gray-400">/</span>
              <span className="ml-4 text-gray-900 font-medium">Settings</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Navigation Tabs */}
        <div className="flex space-x-4 mb-8 border-b">
          <button className="px-4 py-2 border-b-2 border-primary-600 text-primary-600 font-medium">
            Notification Channels
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
            <button onClick={() => setError(null)} className="float-right text-red-500 hover:text-red-700">
              &times;
            </button>
          </div>
        )}

        {/* Notification Channels Section */}
        <div className="bg-white rounded-lg shadow border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Notification Channels</h2>
              <p className="text-sm text-gray-500">Configure where you receive alerts</p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-md text-sm font-medium"
            >
              + Add Channel
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : channels.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-4">🔔</div>
              <p className="text-gray-500 mb-4">No notification channels configured</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="text-primary-600 hover:text-primary-700 font-medium"
              >
                Add your first channel
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {channels.map((channel) => (
                <li key={channel.id} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <span className="text-2xl">
                        {CHANNEL_TYPES.find(t => t.value === channel.type)?.icon || '📢'}
                      </span>
                      <div>
                        <h3 className="font-medium text-gray-900">{channel.name}</h3>
                        <p className="text-sm text-gray-500">
                          {channel.type.charAt(0).toUpperCase() + channel.type.slice(1)}
                          {channel.config?.email && ` - ${channel.config.email}`}
                          {channel.config?.chatId && ` - Chat ID: ${channel.config.chatId}`}
                          {channel.config?.channel && ` - ${channel.config.channel}`}
                          {channel.config?.url && ` - ${channel.config.url}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      {testResult?.id === channel.id && (
                        <span className={`text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                          {testResult.message}
                        </span>
                      )}
                      <button
                        onClick={() => handleTestChannel(channel.id)}
                        disabled={testingId === channel.id}
                        className="text-gray-500 hover:text-gray-700 text-sm"
                      >
                        {testingId === channel.id ? 'Testing...' : 'Test'}
                      </button>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={channel.enabled}
                          onChange={() => handleToggleChannel(channel)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                      </label>
                      <button
                        onClick={() => handleDeleteChannel(channel.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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
  const [email, setEmail] = useState('');
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [slackChannel, setSlackChannel] = useState('');
  const [customWebhookUrl, setCustomWebhookUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const data: CreateNotificationChannelDto = {
      name: name || `${type.charAt(0).toUpperCase() + type.slice(1)} Channel`,
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
      case 'telegram':
        if (!chatId) {
          setError('Chat ID is required');
          return;
        }
        data.telegramConfig = { chatId, botToken: botToken || undefined };
        break;
      case 'slack':
        if (!webhookUrl) {
          setError('Webhook URL is required');
          return;
        }
        data.slackConfig = { webhookUrl, channel: slackChannel || undefined };
        break;
      case 'webhook':
        if (!customWebhookUrl) {
          setError('Webhook URL is required');
          return;
        }
        data.webhookConfig = { url: customWebhookUrl };
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Add Notification Channel</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
              {error}
            </div>
          )}

          {/* Channel Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Channel Type</label>
            <div className="grid grid-cols-4 gap-2">
              {CHANNEL_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  type="button"
                  onClick={() => setType(ct.value)}
                  className={`p-3 rounded-lg border text-center transition-colors ${
                    type === ct.value
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-2xl mb-1">{ct.icon}</div>
                  <div className="text-xs">{ct.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`My ${type.charAt(0).toUpperCase() + type.slice(1)} Notifications`}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Type-specific fields */}
          {type === 'email' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alerts@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
          )}

          {type === 'telegram' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chat ID</label>
                <input
                  type="text"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="123456789"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Get your chat ID from @userinfobot on Telegram
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bot Token (optional)</label>
                <input
                  type="text"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="Use default bot if empty"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </>
          )}

          {type === 'slack' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Channel (optional)</label>
                <input
                  type="text"
                  value={slackChannel}
                  onChange={(e) => setSlackChannel(e.target.value)}
                  placeholder="#monitoring"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </>
          )}

          {type === 'webhook' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
              <input
                type="url"
                value={customWebhookUrl}
                onChange={(e) => setCustomWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhook"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                We'll POST JSON data to this URL when alerts trigger
              </p>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
