/**
 * Unit tests for email notification adapter
 */

import { sendEmailAlert } from './email/email';
import { generateEmailHtml, generateEmailText } from './email/templates';
import type { EmailConfig, AlertData, SmtpConfig } from './email/types';
import nodemailer from 'nodemailer';

// Mock nodemailer
jest.mock('nodemailer');

const mockSendMail = jest.fn();
const mockCreateTransport = nodemailer.createTransport as jest.MockedFunction<
  typeof nodemailer.createTransport
>;

describe('Email Notification Adapter', () => {
  const mockSmtpConfig: SmtpConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'test@example.com',
    pass: 'password123',
    from: 'alerts@sentinel.dev'
  };

  const mockAlert: AlertData = {
    id: 'alert-123',
    ruleId: 'rule-456',
    ruleName: 'Price Monitor',
    sourceUrl: 'https://example.com/product',
    severity: 'warning',
    title: 'Price changed on product page',
    body: 'Product price has changed',
    triggeredAt: new Date('2025-01-15T10:30:00Z'),
    currentValue: { price: 99.99 },
    previousValue: { price: 149.99 },
    changeKind: 'price_change',
    diffSummary: 'Price decreased from $149.99 to $99.99'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateTransport.mockReturnValue({
      sendMail: mockSendMail
    } as any);
  });

  describe('sendEmailAlert', () => {
    it('should send email successfully', async () => {
      const config: EmailConfig = {
        to: ['user@example.com']
      };

      mockSendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>'
      });

      const result = await sendEmailAlert(config, mockAlert, mockSmtpConfig);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('<msg-123@example.com>');
      expect(mockCreateTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: {
          user: 'test@example.com',
          pass: 'password123'
        }
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'alerts@sentinel.dev',
          to: 'user@example.com',
          subject: '[WARNING] Price changed on product page'
        })
      );
    });

    it('should send to multiple recipients', async () => {
      const config: EmailConfig = {
        to: ['user1@example.com', 'user2@example.com', 'user3@example.com']
      };

      mockSendMail.mockResolvedValue({
        messageId: '<msg-456@example.com>'
      });

      await sendEmailAlert(config, mockAlert, mockSmtpConfig);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user1@example.com, user2@example.com, user3@example.com'
        })
      );
    });

    it('should use custom from address if provided', async () => {
      const config: EmailConfig = {
        to: ['user@example.com'],
        from: 'custom@example.com'
      };

      mockSendMail.mockResolvedValue({
        messageId: '<msg-789@example.com>'
      });

      await sendEmailAlert(config, mockAlert, mockSmtpConfig);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@example.com'
        })
      );
    });

    it('should handle SMTP errors gracefully', async () => {
      const config: EmailConfig = {
        to: ['user@example.com']
      };

      mockSendMail.mockRejectedValue(new Error('SMTP connection failed'));

      const result = await sendEmailAlert(config, mockAlert, mockSmtpConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('SMTP connection failed');
    });

    it('should include both HTML and text versions', async () => {
      const config: EmailConfig = {
        to: ['user@example.com']
      };

      mockSendMail.mockResolvedValue({
        messageId: '<msg-abc@example.com>'
      });

      await sendEmailAlert(config, mockAlert, mockSmtpConfig);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.any(String),
          html: expect.any(String)
        })
      );

      const call = mockSendMail.mock.calls[0][0];
      expect(call.html).toContain('<!DOCTYPE html>');
      expect(call.text).toContain('WARNING:');
    });

    it('should format subject with severity level', async () => {
      const criticalAlert: AlertData = {
        ...mockAlert,
        severity: 'critical',
        title: 'Server down'
      };

      const config: EmailConfig = {
        to: ['ops@example.com']
      };

      mockSendMail.mockResolvedValue({
        messageId: '<msg-critical@example.com>'
      });

      await sendEmailAlert(config, criticalAlert, mockSmtpConfig);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '[CRITICAL] Server down'
        })
      );
    });
  });

  describe('generateEmailHtml', () => {
    it('should generate valid HTML with escaped content', () => {
      const alertWithHtml: AlertData = {
        ...mockAlert,
        title: 'Alert with <script>alert("xss")</script>',
        ruleName: 'Test & Rule',
        diffSummary: 'Changed "value" to \'new value\''
      };

      const html = generateEmailHtml(alertWithHtml);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');
      expect(html).toContain('Test &amp; Rule');
      expect(html).toContain('&quot;value&quot;');
      expect(html).toContain('&#039;new value&#039;');
    });

    it('should use correct severity color', () => {
      const infoAlert: AlertData = { ...mockAlert, severity: 'info' };
      const warningAlert: AlertData = { ...mockAlert, severity: 'warning' };
      const criticalAlert: AlertData = { ...mockAlert, severity: 'critical' };

      expect(generateEmailHtml(infoAlert)).toContain('background: #3B82F6');
      expect(generateEmailHtml(warningAlert)).toContain('background: #F59E0B');
      expect(generateEmailHtml(criticalAlert)).toContain('background: #EF4444');
    });

    it('should include all alert details', () => {
      const html = generateEmailHtml(mockAlert);

      expect(html).toContain(mockAlert.title);
      expect(html).toContain(mockAlert.ruleName);
      expect(html).toContain(mockAlert.sourceUrl);
      expect(html).toContain(mockAlert.diffSummary);
      expect(html).toContain(mockAlert.id);
    });

    it('should fallback to body if diffSummary is empty', () => {
      const alertWithoutDiff: AlertData = {
        ...mockAlert,
        diffSummary: '',
        body: 'Fallback content'
      };

      const html = generateEmailHtml(alertWithoutDiff);

      expect(html).toContain('Fallback content');
    });
  });

  describe('generateEmailText', () => {
    it('should generate plain text version', () => {
      const text = generateEmailText(mockAlert);

      expect(text).toContain('WARNING:');
      expect(text).toContain(mockAlert.title);
      expect(text).toContain(mockAlert.ruleName);
      expect(text).toContain(mockAlert.sourceUrl);
      expect(text).toContain(mockAlert.diffSummary);
      expect(text).toContain(mockAlert.id);
    });

    it('should format severity in uppercase', () => {
      const infoAlert: AlertData = { ...mockAlert, severity: 'info' };
      const criticalAlert: AlertData = { ...mockAlert, severity: 'critical' };

      expect(generateEmailText(infoAlert)).toContain('INFO:');
      expect(generateEmailText(criticalAlert)).toContain('CRITICAL:');
    });

    it('should include alert link', () => {
      const text = generateEmailText(mockAlert);

      expect(text).toContain(`https://app.sentinel.dev/alerts/${mockAlert.id}`);
    });

    it('should fallback to body if diffSummary is empty', () => {
      const alertWithoutDiff: AlertData = {
        ...mockAlert,
        diffSummary: '',
        body: 'Fallback content'
      };

      const text = generateEmailText(alertWithoutDiff);

      expect(text).toContain('Change: Fallback content');
    });
  });
});
