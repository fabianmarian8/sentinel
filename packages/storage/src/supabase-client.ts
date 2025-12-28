/**
 * @sentinel/storage - Supabase Storage client
 *
 * Uses Supabase's native REST API for storage operations.
 * This is an alternative to the S3 client when using Supabase Storage.
 */

import { UploadOptions, UploadResult, ObjectInfo } from './client';

/**
 * Supabase Storage configuration
 */
export interface SupabaseStorageConfig {
  /** Supabase project URL (e.g., https://xyz.supabase.co) */
  projectUrl: string;
  /** Service role key for server-side access */
  serviceRoleKey: string;
  /** Default bucket name */
  bucket: string;
}

/**
 * Supabase Storage client for Sentinel
 */
export class SupabaseStorageClient {
  private storageUrl: string;
  private serviceRoleKey: string;
  private bucket: string;
  private baseUrl: string;

  constructor(config: SupabaseStorageConfig) {
    this.storageUrl = `${config.projectUrl}/storage/v1`;
    this.serviceRoleKey = config.serviceRoleKey;
    this.bucket = config.bucket;
    this.baseUrl = `${this.storageUrl}/object/public/${config.bucket}`;
  }

  /**
   * Generate a storage key for rule artifacts
   */
  generateKey(
    ruleId: string,
    runId: string,
    type: 'html' | 'screenshot' | 'artifact',
    extension: string = 'bin',
  ): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `rules/${ruleId}/${date}/${runId}/${type}.${extension}`;
  }

  /**
   * Upload a buffer to Supabase Storage
   */
  async upload(
    key: string,
    data: Buffer | string,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const body = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;

    const response = await fetch(`${this.storageUrl}/object/${this.bucket}/${key}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.serviceRoleKey}`,
        'Content-Type': options.contentType ?? 'application/octet-stream',
        ...(options.cacheControl && { 'Cache-Control': options.cacheControl }),
      },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Supabase Storage upload failed: ${response.status} - ${error}`);
    }

    const result = await response.json() as { Id?: string; Key?: string };

    return {
      key,
      url: `${this.baseUrl}/${key}`,
      etag: result.Id,
    };
  }

  /**
   * Upload HTML snapshot
   */
  async uploadHtmlSnapshot(
    ruleId: string,
    runId: string,
    html: string,
  ): Promise<UploadResult> {
    const key = this.generateKey(ruleId, runId, 'html', 'html');
    return this.upload(key, html, {
      contentType: 'text/html; charset=utf-8',
    });
  }

  /**
   * Upload screenshot (PNG)
   */
  async uploadScreenshot(
    ruleId: string,
    runId: string,
    screenshot: Buffer,
  ): Promise<UploadResult> {
    const key = this.generateKey(ruleId, runId, 'screenshot', 'png');
    return this.upload(key, screenshot, {
      contentType: 'image/png',
    });
  }

  /**
   * Get object as buffer
   */
  async get(key: string): Promise<Buffer | null> {
    try {
      const response = await fetch(`${this.storageUrl}/object/${this.bucket}/${key}`, {
        headers: {
          'Authorization': `Bearer ${this.serviceRoleKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get object: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get object as string
   */
  async getString(key: string): Promise<string | null> {
    const buffer = await this.get(key);
    return buffer ? buffer.toString('utf-8') : null;
  }

  /**
   * Check if object exists
   */
  async exists(key: string): Promise<boolean> {
    const response = await fetch(`${this.storageUrl}/object/info/${this.bucket}/${key}`, {
      method: 'HEAD',
      headers: {
        'Authorization': `Bearer ${this.serviceRoleKey}`,
      },
    });
    return response.ok;
  }

  /**
   * Delete object
   */
  async delete(key: string): Promise<void> {
    const response = await fetch(`${this.storageUrl}/object/${this.bucket}/${key}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.serviceRoleKey}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete object: ${response.status}`);
    }
  }

  /**
   * List objects by prefix
   */
  async list(prefix: string, maxKeys: number = 100): Promise<ObjectInfo[]> {
    const response = await fetch(`${this.storageUrl}/object/list/${this.bucket}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefix,
        limit: maxKeys,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to list objects: ${response.status}`);
    }

    interface SupabaseListItem {
      name: string;
      id?: string;
      metadata?: { size?: number };
      updated_at?: string;
      created_at?: string;
    }

    const items = await response.json() as SupabaseListItem[];
    return items.map((item) => ({
      key: `${prefix}${item.name}`,
      size: item.metadata?.size ?? 0,
      lastModified: new Date(item.updated_at ?? item.created_at ?? Date.now()),
      etag: item.id,
    }));
  }

  /**
   * Get public URL for an object
   */
  getPublicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  /**
   * Get signed URL for temporary access (not yet implemented in Supabase REST API)
   * Falls back to public URL for public buckets
   */
  async getPresignedUrl(key: string, _expiresIn: number = 3600): Promise<string> {
    // For public buckets, just return the public URL
    return this.getPublicUrl(key);
  }

  /**
   * List artifacts for a specific rule run
   */
  async listRunArtifacts(ruleId: string, runId: string): Promise<ObjectInfo[]> {
    const date = new Date().toISOString().split('T')[0];
    const prefix = `rules/${ruleId}/${date}/${runId}/`;
    return this.list(prefix);
  }

  /**
   * Delete all artifacts for a rule
   */
  async deleteRuleArtifacts(ruleId: string): Promise<number> {
    const objects = await this.list(`rules/${ruleId}/`, 1000);

    for (const obj of objects) {
      await this.delete(obj.key);
    }

    return objects.length;
  }

  /**
   * Get storage usage stats for a rule
   */
  async getRuleStorageStats(ruleId: string): Promise<{
    objectCount: number;
    totalSize: number;
  }> {
    const objects = await this.list(`rules/${ruleId}/`, 1000);

    return {
      objectCount: objects.length,
      totalSize: objects.reduce((sum, obj) => sum + obj.size, 0),
    };
  }
}

/**
 * Create Supabase storage client from environment variables
 */
export function createSupabaseStorageClient(): SupabaseStorageClient | null {
  const projectUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'screenshots';

  if (!projectUrl || !serviceRoleKey) {
    return null;
  }

  return new SupabaseStorageClient({
    projectUrl,
    serviceRoleKey,
    bucket,
  });
}
