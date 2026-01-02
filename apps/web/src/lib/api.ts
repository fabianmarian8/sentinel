const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

interface FetchOptions extends RequestInit {
  token?: string;
}

// Core types
export type RuleType = 'price' | 'availability' | 'text' | 'number' | 'json_field';
export type WorkspaceType = 'ecommerce' | 'competitor' | 'procurement';
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface User {
  id: string;
  email: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface Workspace {
  id: string;
  ownerId: string;
  type: WorkspaceType;
  name: string;
  timezone: string;
  createdAt: string;
}

export interface Source {
  id: string;
  workspaceId: string;
  url: string;
  domain: string;
  enabled: boolean;
  createdAt: string;
  workspace?: {
    id: string;
    name: string;
  };
}

export interface ExtractionConfig {
  method: 'css' | 'xpath' | 'regex';
  selector: string;
  attribute?: string;
}

export interface ScheduleConfig {
  intervalSeconds: number;
  jitterSeconds?: number;
  cron?: string;
}

export interface AlertCondition {
  id: string;
  type: string;
  value: number | string | boolean;
  severity: 'info' | 'warning' | 'critical';
  threshold?: number;
}

export interface AlertPolicy {
  requireConsecutive: number;
  cooldownSeconds: number;
  conditions: AlertCondition[];
  channels: string[];
}

export interface RuleState {
  lastStable: unknown;
  candidate: unknown;
  candidateCount: number;
  updatedAt: string;
}

export interface Rule {
  id: string;
  sourceId: string;
  name: string;
  ruleType: RuleType;
  enabled: boolean;
  healthScore: number | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  extraction: ExtractionConfig;
  schedule: ScheduleConfig;
  alertPolicy: AlertPolicy | null;
  screenshotOnChange: boolean;
  captchaIntervalEnforced?: boolean;
  autoThrottleDisabled?: boolean;
  originalSchedule?: ScheduleConfig | null;
  source: Source;
  currentState?: RuleState | null;
  latestObservations?: Observation[];
  observationCount?: number;
}

export interface Observation {
  id: string;
  ruleId: string;
  extractedRaw: string;
  extractedNormalized: unknown;
  changeDetected: boolean;
  changeKind: string | null;
  diffSummary?: string;
  createdAt: string;
  run: {
    httpStatus: number;
    errorCode: string | null;
    screenshotPath: string | null;
  };
}

export interface Alert {
  id: string;
  ruleId: string;
  triggeredAt: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  dedupeKey: string;
}

export interface HealthSummary {
  totalRules: number;
  healthyRules: number;
  warningRules: number;
  criticalRules: number;
  averageHealthScore: number;
}

export interface TestRuleResult {
  success: boolean;
  timing?: {
    fetchMs?: number;
  };
  fetch?: {
    httpStatus?: number;
  };
  extraction?: {
    rawValue?: string;
  };
  errors?: string[];
}

// Notification Channel types
export type ChannelType = 'email' | 'slack_oauth' | 'discord' | 'push' | 'webhook';
// Legacy types - kept for backwards compatibility
export type LegacyChannelType = 'telegram' | 'slack';

export interface NotificationChannel {
  id: string;
  workspaceId: string;
  type: ChannelType | LegacyChannelType;
  name: string;
  enabled: boolean;
  createdAt: string;
  config?: {
    // Email
    email?: string;
    // Slack OAuth
    accessToken?: string;
    channelId?: string;
    channelName?: string;
    teamName?: string;
    // Discord
    webhookUrl?: string;
    // Push
    playerId?: string;
    deviceType?: string;
    // Webhook
    url?: string;
    headers?: Record<string, string>;
    // Legacy
    chatId?: string;
    channel?: string;
  };
}

export interface CreateNotificationChannelDto {
  name: string;
  type: ChannelType;
  workspaceId: string;
  // New channel configs
  emailConfig?: { email: string };
  slackOAuthConfig?: {
    accessToken: string;
    channelId: string;
    channelName: string;
    teamName?: string;
  };
  discordConfig?: { webhookUrl: string };
  pushConfig?: { playerId: string; deviceType?: string };
  webhookConfig?: { url: string; headers?: Record<string, string> };
}

export interface UpdateNotificationChannelDto {
  name?: string;
  enabled?: boolean;
  // New channel configs
  emailConfig?: { email: string };
  slackOAuthConfig?: {
    accessToken: string;
    channelId: string;
    channelName: string;
    teamName?: string;
  };
  discordConfig?: { webhookUrl: string };
  pushConfig?: { playerId: string; deviceType?: string };
  webhookConfig?: { url: string; headers?: Record<string, string> };
}

// Slack OAuth types
export interface SlackChannel {
  id: string;
  name: string;
}

export interface SlackOAuthExchangeResponse {
  accessToken: string;
  teamName: string;
  teamId: string;
}

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
    const { token, ...fetchOptions } = options;
    const authToken = token || this.token;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (authToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `API Error: ${response.status}`);
    }

    return response.json();
  }

  // Auth
  async login(email: string, password: string) {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async register(email: string, password: string) {
    return this.request<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  // Workspaces
  async getWorkspaces() {
    return this.request<Workspace[]>('/workspaces');
  }

  async getWorkspace(id: string) {
    return this.request<Workspace>(`/workspaces/${id}`);
  }

  async createWorkspace(data: { name: string; type: WorkspaceType }) {
    return this.request<Workspace>('/workspaces', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Sources
  async getSources(workspaceId: string) {
    return this.request<Source[]>(`/sources?workspaceId=${workspaceId}`);
  }

  async createSource(data: { workspaceId: string; url: string }) {
    return this.request<Source>('/sources', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Rules
  async getRules(workspaceId: string) {
    return this.request<Rule[]>(`/rules?workspaceId=${workspaceId}`);
  }

  async getRule(id: string) {
    return this.request<Rule>(`/rules/${id}`);
  }

  async createRule(data: Partial<Rule>) {
    return this.request<Rule>('/rules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRule(id: string, data: Partial<Rule>) {
    return this.request<Rule>(`/rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async testRule(id: string) {
    return this.request<TestRuleResult>(`/rules/${id}/test`, {
      method: 'POST',
    });
  }

  async pauseRule(id: string) {
    return this.request<Rule>(`/rules/${id}/pause`, {
      method: 'POST',
    });
  }

  async resumeRule(id: string) {
    return this.request<Rule>(`/rules/${id}/resume`, {
      method: 'POST',
    });
  }

  async resetRuleHealth(id: string) {
    return this.request<Rule>(`/rules/${id}/reset-health`, {
      method: 'POST',
    });
  }

  async deleteRule(id: string) {
    return this.request<{ deleted: boolean }>(`/rules/${id}`, {
      method: 'DELETE',
    });
  }

  // Alerts
  async getAlerts(workspaceId: string) {
    return this.request<Alert[]>(`/alerts?workspaceId=${workspaceId}`);
  }

  // Notification Channels
  async getNotificationChannels(workspaceId: string) {
    return this.request<NotificationChannel[]>(`/notification-channels?workspaceId=${workspaceId}`);
  }

  async getNotificationChannel(id: string) {
    return this.request<NotificationChannel>(`/notification-channels/${id}`);
  }

  async createNotificationChannel(data: CreateNotificationChannelDto) {
    return this.request<NotificationChannel>('/notification-channels', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateNotificationChannel(id: string, data: UpdateNotificationChannelDto) {
    return this.request<NotificationChannel>(`/notification-channels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteNotificationChannel(id: string) {
    return this.request<{ deleted: boolean }>(`/notification-channels/${id}`, {
      method: 'DELETE',
    });
  }

  async testNotificationChannel(id: string) {
    return this.request<{ success: boolean; message: string }>(`/notification-channels/${id}/test`, {
      method: 'POST',
    });
  }

  // Slack OAuth
  async getSlackAuthUrl(redirectUri: string) {
    return this.request<{ url: string }>(`/notification-channels/slack/auth-url?redirectUri=${encodeURIComponent(redirectUri)}`);
  }

  async exchangeSlackCode(code: string, redirectUri: string) {
    return this.request<SlackOAuthExchangeResponse>('/notification-channels/slack/exchange', {
      method: 'POST',
      body: JSON.stringify({ code, redirectUri }),
    });
  }

  async listSlackChannels(accessToken: string) {
    return this.request<SlackChannel[]>(`/notification-channels/slack/channels?accessToken=${encodeURIComponent(accessToken)}`);
  }

  // Health
  async getHealthSummary(workspaceId: string) {
    return this.request<HealthSummary>(`/rules/workspace/${workspaceId}/health-summary`);
  }

  async getLowHealthRules(workspaceId: string, threshold = 50) {
    return this.request<Rule[]>(`/rules/workspace/${workspaceId}/low-health?threshold=${threshold}`);
  }
}

export const api = new ApiClient(API_URL);
export default api;
