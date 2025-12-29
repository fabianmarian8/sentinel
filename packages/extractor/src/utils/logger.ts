type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  prefix?: string;
  enabled?: boolean;
}

class ExtractorLogger {
  private prefix: string;
  private enabled: boolean;

  constructor(options: LoggerOptions = {}) {
    this.prefix = options.prefix || '[Extractor]';
    this.enabled = options.enabled ?? process.env.NODE_ENV !== 'test';
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `${timestamp} ${this.prefix} [${level.toUpperCase()}] ${message}`;
  }

  debug(message: string): void {
    if (this.enabled && process.env.LOG_LEVEL === 'debug') {
      console.debug(this.formatMessage('debug', message));
    }
  }

  info(message: string): void {
    if (this.enabled) {
      console.info(this.formatMessage('info', message));
    }
  }

  warn(message: string): void {
    if (this.enabled) {
      console.warn(this.formatMessage('warn', message));
    }
  }

  error(message: string, error?: Error): void {
    if (this.enabled) {
      console.error(this.formatMessage('error', message), error?.stack || '');
    }
  }
}

export const logger = new ExtractorLogger({ prefix: '[SmartFetch]' });
export const headlessLogger = new ExtractorLogger({ prefix: '[Headless]' });
export const httpLogger = new ExtractorLogger({ prefix: '[HTTP]' });

export function createLogger(prefix: string): ExtractorLogger {
  return new ExtractorLogger({ prefix });
}

export { ExtractorLogger };
