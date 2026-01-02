/**
 * @sentinel/storage - S3-compatible storage client
 *
 * Provides storage for:
 * - HTML snapshots (debugging)
 * - Screenshots from Playwright
 * - Any other binary artifacts from rule runs
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Storage client configuration
 */
export interface StorageConfig {
  /** S3-compatible endpoint URL (e.g., for MinIO, Cloudflare R2) */
  endpoint?: string;
  /** Public URL for accessing objects (e.g., via CDN or reverse proxy) */
  publicUrl?: string;
  /** AWS region or 'auto' for R2 */
  region: string;
  /** Access key ID */
  accessKeyId: string;
  /** Secret access key */
  secretAccessKey: string;
  /** S3 bucket name */
  bucket: string;
  /** Force path style (required for some S3-compatible services) */
  forcePathStyle?: boolean;
}

/**
 * Upload options
 */
export interface UploadOptions {
  /** Content type (MIME type) */
  contentType?: string;
  /** Custom metadata */
  metadata?: Record<string, string>;
  /** Cache control header */
  cacheControl?: string;
}

/**
 * Uploaded object info
 */
export interface UploadResult {
  /** Object key in bucket */
  key: string;
  /** Full URL (if public) */
  url: string;
  /** ETag from S3 */
  etag?: string;
}

/**
 * Object info from list/head operations
 */
export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
}

/**
 * S3-compatible storage client for Sentinel
 */
export class StorageClient {
  private s3: S3Client;
  private bucket: string;
  private baseUrl: string;

  constructor(config: StorageConfig) {
    const s3Config: S3ClientConfig = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };

    if (config.endpoint) {
      s3Config.endpoint = config.endpoint;
    }

    if (config.forcePathStyle) {
      s3Config.forcePathStyle = true;
    }

    this.s3 = new S3Client(s3Config);
    this.bucket = config.bucket;

    // Build base URL for object access
    // Prefer publicUrl if provided (for CDN/reverse proxy access)
    if (config.publicUrl) {
      this.baseUrl = config.publicUrl.replace(/\/$/, ''); // Remove trailing slash
    } else if (config.endpoint) {
      // For S3-compatible services (MinIO, R2, etc.)
      this.baseUrl = config.forcePathStyle
        ? `${config.endpoint}/${config.bucket}`
        : `${config.endpoint.replace('://', `://${config.bucket}.`)}`;
    } else {
      // Standard AWS S3
      this.baseUrl = `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
    }
  }

  /**
   * Generate a storage key for rule artifacts
   *
   * @param ruleId - Rule ID
   * @param runId - Run ID
   * @param type - Artifact type (html, screenshot, etc.)
   * @param extension - File extension
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
   * Upload a buffer to S3
   */
  async upload(
    key: string,
    data: Buffer | string,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const body = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType ?? 'application/octet-stream',
      Metadata: options.metadata,
      CacheControl: options.cacheControl,
    });

    const result = await this.s3.send(command);

    return {
      key,
      url: `${this.baseUrl}/${key}`,
      etag: result.ETag?.replace(/"/g, ''),
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
      metadata: {
        ruleId,
        runId,
        type: 'html-snapshot',
      },
    });
  }

  /**
   * Upload screenshot (JPEG - smaller file size)
   */
  async uploadScreenshot(
    ruleId: string,
    runId: string,
    screenshot: Buffer,
  ): Promise<UploadResult> {
    const key = this.generateKey(ruleId, runId, 'screenshot', 'jpg');
    return this.upload(key, screenshot, {
      contentType: 'image/jpeg',
      metadata: {
        ruleId,
        runId,
        type: 'screenshot',
      },
    });
  }

  /**
   * Get object as buffer
   */
  async get(key: string): Promise<Buffer | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const result = await this.s3.send(command);

      if (!result.Body) {
        return null;
      }

      // Convert readable stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
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
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Delete object
   */
  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.s3.send(command);
  }

  /**
   * List objects by prefix
   */
  async list(prefix: string, maxKeys: number = 100): Promise<ObjectInfo[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const result = await this.s3.send(command);

    return (result.Contents ?? []).map((obj) => ({
      key: obj.Key!,
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ?? new Date(),
      etag: obj.ETag?.replace(/"/g, ''),
    }));
  }

  /**
   * Generate a presigned URL for temporary access
   */
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3, command, { expiresIn });
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
   * Delete all artifacts for a rule (use with caution)
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
 * Create storage client from environment variables
 */
export function createStorageClient(): StorageClient | null {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  if (!bucket || !accessKeyId || !secretAccessKey) {
    console.warn('S3 storage not configured - missing S3_BUCKET, S3_ACCESS_KEY_ID, or S3_SECRET_ACCESS_KEY');
    return null;
  }

  return new StorageClient({
    endpoint: process.env.S3_ENDPOINT,
    publicUrl: process.env.S3_PUBLIC_URL,
    region: process.env.S3_REGION || process.env.AWS_REGION || 'auto',
    accessKeyId,
    secretAccessKey,
    bucket,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
}

/**
 * Singleton instance for use across the application
 */
let storageInstance: StorageClient | null = null;

export function getStorageClient(): StorageClient | null {
  if (storageInstance === null) {
    storageInstance = createStorageClient();
  }
  return storageInstance;
}
