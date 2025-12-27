# Alerts Module - Frontend Integration Guide

## API Client Setup

### TypeScript Types

```typescript
// types/alerts.ts
export enum AlertStatus {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  ALL = 'all'
}

export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  rule: {
    id: string;
    name: string;
    source: {
      url: string;
      domain: string;
    };
  };
}

export interface AlertsResponse {
  alerts: Alert[];
  count: number;
}

export interface AlertFilters {
  workspaceId: string;
  status?: AlertStatus;
  severity?: AlertSeverity;
  ruleId?: string;
  since?: string;
  limit?: number;
}
```

### API Client

```typescript
// api/alerts.ts
import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export class AlertsAPI {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async list(filters: AlertFilters): Promise<AlertsResponse> {
    const params = new URLSearchParams();
    params.append('workspaceId', filters.workspaceId);
    if (filters.status) params.append('status', filters.status);
    if (filters.severity) params.append('severity', filters.severity);
    if (filters.ruleId) params.append('ruleId', filters.ruleId);
    if (filters.since) params.append('since', filters.since);
    if (filters.limit) params.append('limit', filters.limit.toString());

    const { data } = await axios.get(`${API_BASE}/alerts?${params}`, {
      headers: this.headers,
    });
    return data;
  }

  async get(alertId: string): Promise<Alert> {
    const { data } = await axios.get(`${API_BASE}/alerts/${alertId}`, {
      headers: this.headers,
    });
    return data;
  }

  async acknowledge(alertId: string): Promise<Alert> {
    const { data } = await axios.post(
      `${API_BASE}/alerts/${alertId}/ack`,
      {},
      { headers: this.headers }
    );
    return data;
  }

  async resolve(alertId: string): Promise<Alert> {
    const { data } = await axios.post(
      `${API_BASE}/alerts/${alertId}/resolve`,
      {},
      { headers: this.headers }
    );
    return data;
  }

  createStream(workspaceId: string): EventSource {
    const url = `${API_BASE}/alerts/stream?workspaceId=${workspaceId}`;

    // EventSource doesn't support custom headers natively
    // Use a proxy or pass token as query param (less secure)
    // Better: Use WebSocket upgrade or authenticated SSE library

    return new EventSource(url);
  }
}
```

## React Hooks

### useAlerts Hook

```typescript
// hooks/useAlerts.ts
import { useState, useEffect } from 'react';
import { AlertsAPI } from '@/api/alerts';
import { Alert, AlertFilters } from '@/types/alerts';

export function useAlerts(filters: AlertFilters, token: string) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const api = new AlertsAPI(token);

    api.list(filters)
      .then((data) => {
        setAlerts(data.alerts);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [filters, token]);

  return { alerts, loading, error };
}
```

### useAlertStream Hook (Real-time)

```typescript
// hooks/useAlertStream.ts
import { useState, useEffect } from 'react';
import { Alert } from '@/types/alerts';

export function useAlertStream(workspaceId: string, token: string) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Note: EventSource doesn't support Authorization header
    // You'll need to implement a workaround:
    // 1. Use query param (less secure): /stream?token=xxx&workspaceId=xxx
    // 2. Use authenticated SSE library (recommended)
    // 3. Use WebSocket instead of SSE

    const url = `${process.env.NEXT_PUBLIC_API_URL}/alerts/stream?workspaceId=${workspaceId}`;
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      setConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setAlerts(data);
      } catch (err) {
        console.error('Failed to parse SSE data:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE error:', err);
      setConnected(false);
      setError(new Error('SSE connection failed'));
      eventSource.close();
    };

    return () => {
      eventSource.close();
      setConnected(false);
    };
  }, [workspaceId, token]);

  return { alerts, connected, error };
}
```

### useAlertActions Hook

```typescript
// hooks/useAlertActions.ts
import { useState } from 'react';
import { AlertsAPI } from '@/api/alerts';
import { Alert } from '@/types/alerts';

export function useAlertActions(token: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const api = new AlertsAPI(token);

  const acknowledge = async (alertId: string): Promise<Alert> => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.acknowledge(alertId);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const resolve = async (alertId: string): Promise<Alert> => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.resolve(alertId);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { acknowledge, resolve, loading, error };
}
```

## React Components

### AlertList Component

```tsx
// components/AlertList.tsx
import { useAlerts } from '@/hooks/useAlerts';
import { AlertCard } from './AlertCard';
import { AlertFilters } from '@/types/alerts';

interface AlertListProps {
  filters: AlertFilters;
  token: string;
}

export function AlertList({ filters, token }: AlertListProps) {
  const { alerts, loading, error } = useAlerts(filters, token);

  if (loading) return <div>Loading alerts...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="space-y-4">
      {alerts.length === 0 ? (
        <p className="text-gray-500">No alerts found</p>
      ) : (
        alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} token={token} />
        ))
      )}
    </div>
  );
}
```

### AlertCard Component

```tsx
// components/AlertCard.tsx
import { Alert, AlertSeverity } from '@/types/alerts';
import { useAlertActions } from '@/hooks/useAlertActions';

interface AlertCardProps {
  alert: Alert;
  token: string;
}

const severityColors = {
  [AlertSeverity.LOW]: 'bg-blue-100 text-blue-800',
  [AlertSeverity.MEDIUM]: 'bg-yellow-100 text-yellow-800',
  [AlertSeverity.HIGH]: 'bg-orange-100 text-orange-800',
  [AlertSeverity.CRITICAL]: 'bg-red-100 text-red-800',
};

export function AlertCard({ alert, token }: AlertCardProps) {
  const { acknowledge, resolve, loading } = useAlertActions(token);

  const handleAcknowledge = async () => {
    try {
      await acknowledge(alert.id);
      // Refresh or update UI
      window.location.reload();
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
    }
  };

  const handleResolve = async () => {
    try {
      await resolve(alert.id);
      window.location.reload();
    } catch (err) {
      console.error('Failed to resolve alert:', err);
    }
  };

  return (
    <div className="border rounded-lg p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-1 rounded text-xs font-medium ${severityColors[alert.severity]}`}>
              {alert.severity}
            </span>
            <span className="text-xs text-gray-500">
              {new Date(alert.triggeredAt).toLocaleString()}
            </span>
          </div>
          <h3 className="font-semibold text-lg mb-1">{alert.title}</h3>
          <p className="text-gray-600 mb-2">{alert.body}</p>
          <div className="text-sm text-gray-500">
            <p>Rule: {alert.rule.name}</p>
            <p>Source: {alert.rule.source.domain}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {!alert.acknowledgedAt && (
            <button
              onClick={handleAcknowledge}
              disabled={loading}
              className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              Acknowledge
            </button>
          )}
          {!alert.resolvedAt && (
            <button
              onClick={handleResolve}
              disabled={loading}
              className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            >
              Resolve
            </button>
          )}
          {alert.acknowledgedAt && (
            <span className="text-xs text-gray-500">✓ Acknowledged</span>
          )}
          {alert.resolvedAt && (
            <span className="text-xs text-green-600">✓ Resolved</span>
          )}
        </div>
      </div>
    </div>
  );
}
```

### Real-time Alerts Dashboard

```tsx
// components/AlertsDashboard.tsx
import { useAlertStream } from '@/hooks/useAlertStream';
import { AlertCard } from './AlertCard';

interface AlertsDashboardProps {
  workspaceId: string;
  token: string;
}

export function AlertsDashboard({ workspaceId, token }: AlertsDashboardProps) {
  const { alerts, connected, error } = useAlertStream(workspaceId, token);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-sm text-gray-600">
          {connected ? 'Live updates active' : 'Disconnected'}
        </span>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error.message}
        </div>
      )}

      <div className="space-y-4">
        {alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} token={token} />
        ))}
      </div>
    </div>
  );
}
```

## SSE Authentication Workaround

EventSource nepodporuje custom headers. Riešenia:

### Option 1: Token v Query Parameter (menej bezpečné)

```typescript
// Backend: alerts.controller.ts
@Sse('stream')
stream(
  @Query('workspaceId', ParseUUIDPipe) workspaceId: string,
  @Query('token') token?: string,
) {
  // Validate token manually
  const user = await this.authService.validateToken(token);
  // ...
}

// Frontend:
const url = `${API_BASE}/alerts/stream?workspaceId=${workspaceId}&token=${token}`;
const eventSource = new EventSource(url);
```

### Option 2: Use WebSocket Instead (recommended)

```typescript
// Implementujte WebSocket gateway v NestJS
// Lepšie pre real-time communication
```

### Option 3: Use Authenticated SSE Library

```bash
npm install @microsoft/fetch-event-source
```

```typescript
import { fetchEventSource } from '@microsoft/fetch-event-source';

await fetchEventSource(`${API_BASE}/alerts/stream?workspaceId=${workspaceId}`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
  onmessage(event) {
    const alerts = JSON.parse(event.data);
    setAlerts(alerts);
  },
});
```

## TanStack Query Integration

```typescript
// hooks/useAlertsQuery.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertsAPI } from '@/api/alerts';

export function useAlertsQuery(filters: AlertFilters, token: string) {
  const api = new AlertsAPI(token);

  return useQuery({
    queryKey: ['alerts', filters],
    queryFn: () => api.list(filters),
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

export function useAcknowledgeAlert(token: string) {
  const queryClient = useQueryClient();
  const api = new AlertsAPI(token);

  return useMutation({
    mutationFn: (alertId: string) => api.acknowledge(alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useResolveAlert(token: string) {
  const queryClient = useQueryClient();
  const api = new AlertsAPI(token);

  return useMutation({
    mutationFn: (alertId: string) => api.resolve(alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}
```

---

**Poznámka**: Pre production používajte WebSocket namiesto SSE pre lepšiu podporu autentifikácie a obojsmernú komunikáciu.
