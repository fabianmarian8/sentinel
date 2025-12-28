/**
 * Storage client factory
 *
 * Automatically selects between S3 and Supabase storage clients
 * based on environment variables.
 */

import { createStorageClient } from './client';
import { createSupabaseStorageClient } from './supabase-client';

/**
 * Common interface for storage operations
 */
export interface IStorageClient {
  generateKey(
    ruleId: string,
    runId: string,
    type: 'html' | 'screenshot' | 'artifact',
    extension?: string,
  ): string;
  uploadScreenshot(
    ruleId: string,
    runId: string,
    screenshot: Buffer,
  ): Promise<{ key: string; url: string; etag?: string }>;
  uploadHtmlSnapshot(
    ruleId: string,
    runId: string,
    html: string,
  ): Promise<{ key: string; url: string; etag?: string }>;
  get(key: string): Promise<Buffer | null>;
  getString(key: string): Promise<string | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  getPresignedUrl(key: string, expiresIn?: number): Promise<string>;
}

/**
 * Singleton instance
 */
let storageInstance: IStorageClient | null = null;

/**
 * Get storage client automatically based on environment variables.
 *
 * Priority:
 * 1. Supabase Storage (if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set)
 * 2. S3-compatible storage (if S3_BUCKET and credentials are set)
 *
 * Returns null if no storage is configured.
 */
export function getStorageClientAuto(): IStorageClient | null {
  if (storageInstance !== null) {
    return storageInstance;
  }

  // Try Supabase first
  const supabaseClient = createSupabaseStorageClient();
  if (supabaseClient) {
    console.log('Using Supabase Storage client');
    storageInstance = supabaseClient;
    return storageInstance;
  }

  // Fall back to S3
  const s3Client = createStorageClient();
  if (s3Client) {
    console.log('Using S3 Storage client');
    storageInstance = s3Client;
    return storageInstance;
  }

  console.warn('No storage client configured - screenshots will be disabled');
  return null;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetStorageClient(): void {
  storageInstance = null;
}
