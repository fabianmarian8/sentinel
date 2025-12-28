const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

interface FetchOptions extends RequestInit {
  token?: string;
}

// Notification Channel types
export type ChannelType = 'email' | 'telegram' | 'slack' | 'webhook';

export interface NotificationChannel {
  id: string;
  workspaceId: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  createdAt: string;
  config?: {
    email?: string;
    chatId?: string;
    channel?: string;
    url?: string;
  };
}

export interface CreateNotificationChannelDto {
  name: string;
  type: ChannelType;
  workspaceId: string;
  emailConfig?: { email: string };
  telegramConfig?: { chatId: string; botToken?: string };
  slackConfig?: { webhookUrl: string; channel?: string };
  webhookConfig?: { url: string; headers?: Record<string, string> };
}

export interface UpdateNotificationChannelDto {
  name?: string;
  enabled?: boolean;
  emailConfig?: { email: string };
  telegramConfig?: { chatId: string; botToken?: string };
  slackConfig?: { webhookUrl: string; channel?: string };
  webhookConfig?: { url: string; headers?: Record<string, string> };
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
    return this.request<{ accessToken: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async register(email: string, password: string) {
    return this.request<{ id: string; email: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  // Workspaces
  async getWorkspaces() {
    return this.request<any[]>('/workspaces');
  }

  async getWorkspace(id: string) {
    return this.request<any>(`/workspaces/${id}`);
  }

  async createWorkspace(data: { name: string; type: string }) {
    return this.request<any>('/workspaces', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Sources
  async getSources(workspaceId: string) {
    return this.request<any[]>(`/sources?workspaceId=${workspaceId}`);
  }

  async createSource(data: { workspaceId: string; url: string }) {
    return this.request<any>('/sources', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Rules
  async getRules(workspaceId: string) {
    return this.request<any[]>(`/rules?workspaceId=${workspaceId}`);
  }

  async getRule(id: string) {
    return this.request<any>(`/rules/${id}`);
  }

  async createRule(data: any) {
    return this.request<any>('/rules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRule(id: string, data: any) {
    return this.request<any>(`/rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async testRule(id: string) {
    return this.request<any>(`/rules/${id}/test`, {
      method: 'POST',
    });
  }

  async pauseRule(id: string) {
    return this.request<any>(`/rules/${id}/pause`, {
      method: 'POST',
    });
  }

  async resumeRule(id: string) {
    return this.request<any>(`/rules/${id}/resume`, {
      method: 'POST',
    });
  }

  async resetRuleHealth(id: string) {
    return this.request<any>(`/rules/${id}/reset-health`, {
      method: 'POST',
    });
  }

  // Alerts
  async getAlerts(workspaceId: string) {
    return this.request<any[]>(`/alerts?workspaceId=${workspaceId}`);
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

  // Health
  async getHealthSummary(workspaceId: string) {
    return this.request<any>(`/rules/workspace/${workspaceId}/health-summary`);
  }

  async getLowHealthRules(workspaceId: string, threshold = 50) {
    return this.request<any[]>(`/rules/workspace/${workspaceId}/low-health?threshold=${threshold}`);
  }
}

export const api = new ApiClient(API_URL);
export default api;
