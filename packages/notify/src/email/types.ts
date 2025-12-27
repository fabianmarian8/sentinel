/**
 * Email notification types for Sentinel alerts
 */

export interface EmailConfig {
  to: string[];
  from?: string; // Use default if not set
}

export interface AlertData {
  id: string;
  ruleId: string;
  ruleName: string;
  sourceUrl: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  triggeredAt: Date;
  currentValue: any;
  previousValue: any;
  changeKind: string;
  diffSummary: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true for 465, false for other ports
  user: string;
  pass: string;
  from: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}
