/**
 * Public API for @sentinel/worker
 * Export services and types for use in other apps (e.g., API)
 */

export { WorkerModule } from './worker.module';
export { QueueService } from './services/queue.service';
export { WorkerConfigService } from './config/config.service';

// Export types
export {
  RunJobPayload,
  AlertDispatchPayload,
  QueueName,
  QUEUE_NAMES,
} from './types/jobs';
