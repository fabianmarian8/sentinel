import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { Alert } from '@prisma/client';

export interface AlertEvent {
  alert: Alert;
  workspaceId: string;
}

/**
 * Alert Event Service for real-time notifications
 *
 * This is a simplified in-memory implementation.
 * For production with multiple instances, use Redis pub/sub:
 *
 * 1. Install: npm install ioredis
 * 2. Create RedisService with pub/sub clients
 * 3. Replace Subject with Redis pub/sub:
 *    - emit() -> redis.publish('alerts:workspace:${workspaceId}', JSON.stringify(alert))
 *    - subscribe() -> redis.subscribe('alerts:workspace:${workspaceId}')
 */
@Injectable()
export class AlertEventService {
  private readonly eventSubject = new Subject<AlertEvent>();

  /**
   * Emit new alert event
   */
  emit(alert: Alert, workspaceId: string): void {
    this.eventSubject.next({ alert, workspaceId });
  }

  /**
   * Subscribe to alert events for specific workspace
   */
  subscribe(workspaceId: string): Observable<AlertEvent> {
    return this.eventSubject.pipe(
      filter((event) => event.workspaceId === workspaceId),
    );
  }

  /**
   * Get the raw event stream (for debugging/monitoring)
   */
  getEventStream(): Observable<AlertEvent> {
    return this.eventSubject.asObservable();
  }
}
