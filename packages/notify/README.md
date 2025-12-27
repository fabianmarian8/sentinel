# @sentinel/notify

Notification channel adapters for Sentinel Change Intelligence Platform.

## Features

- **Email Notifications** - Send alerts via SMTP with rich HTML templates
- **Type-safe** - Full TypeScript support
- **Template System** - Beautiful HTML emails with fallback plain text
- **Error Handling** - Graceful error handling with detailed error messages
- **Security** - Automatic HTML escaping to prevent XSS attacks

## Installation

```bash
npm install @sentinel/notify
```

## Usage

### Email Notifications

```typescript
import { sendEmailAlert, type EmailConfig, type AlertData, type SmtpConfig } from '@sentinel/notify';

// Configure SMTP
const smtpConfig: SmtpConfig = {
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  user: 'your-email@gmail.com',
  pass: 'your-app-password',
  from: 'alerts@sentinel.dev'
};

// Configure email recipients
const emailConfig: EmailConfig = {
  to: ['user@example.com', 'admin@example.com'],
  from: 'custom-sender@sentinel.dev' // optional, uses smtpConfig.from if not set
};

// Alert data
const alert: AlertData = {
  id: 'alert-123',
  ruleId: 'rule-456',
  ruleName: 'Price Monitor',
  sourceUrl: 'https://example.com/product',
  severity: 'warning', // 'info' | 'warning' | 'critical'
  title: 'Price changed on product page',
  body: 'Product price has changed',
  triggeredAt: new Date(),
  currentValue: { price: 99.99 },
  previousValue: { price: 149.99 },
  changeKind: 'price_change',
  diffSummary: 'Price decreased from $149.99 to $99.99'
};

// Send email
const result = await sendEmailAlert(emailConfig, alert, smtpConfig);

if (result.success) {
  console.log('Email sent successfully!', result.messageId);
} else {
  console.error('Failed to send email:', result.error);
}
```

## Email Templates

The email notification system includes:

- **HTML Template** - Rich, responsive HTML email with:
  - Color-coded severity badges (info: blue, warning: orange, critical: red)
  - Alert details and metadata
  - Formatted change summary
  - Link to view alert in Sentinel dashboard

- **Plain Text Template** - Clean text version for email clients that don't support HTML

## API Reference

### `sendEmailAlert(config, alert, smtpConfig)`

Sends an email alert using SMTP.

**Parameters:**
- `config: EmailConfig` - Email configuration (recipients, sender)
- `alert: AlertData` - Alert data to send
- `smtpConfig: SmtpConfig` - SMTP server configuration

**Returns:** `Promise<SendResult>`

### Types

```typescript
interface EmailConfig {
  to: string[];           // List of recipient email addresses
  from?: string;          // Optional sender email (uses smtpConfig.from if not set)
}

interface AlertData {
  id: string;            // Alert ID
  ruleId: string;        // Rule ID that triggered the alert
  ruleName: string;      // Human-readable rule name
  sourceUrl: string;     // URL being monitored
  severity: 'info' | 'warning' | 'critical';
  title: string;         // Alert title
  body: string;          // Alert body/description
  triggeredAt: Date;     // When the alert was triggered
  currentValue: any;     // Current detected value
  previousValue: any;    // Previous value
  changeKind: string;    // Type of change detected
  diffSummary: string;   // Human-readable summary of the change
}

interface SmtpConfig {
  host: string;          // SMTP server hostname
  port: number;          // SMTP server port (587 for TLS, 465 for SSL)
  secure: boolean;       // true for 465 (SSL), false for other ports (TLS)
  user: string;          // SMTP username
  pass: string;          // SMTP password
  from: string;          // Default sender email address
}

interface SendResult {
  success: boolean;      // Whether the email was sent successfully
  messageId?: string;    // Email message ID (if successful)
  error?: string;        // Error message (if failed)
}
```

## SMTP Configuration Examples

### Gmail

```typescript
const smtpConfig: SmtpConfig = {
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  user: 'your-email@gmail.com',
  pass: 'your-app-password', // Use App Password, not your regular password
  from: 'alerts@yourdomain.com'
};
```

### SendGrid

```typescript
const smtpConfig: SmtpConfig = {
  host: 'smtp.sendgrid.net',
  port: 587,
  secure: false,
  user: 'apikey',
  pass: 'your-sendgrid-api-key',
  from: 'alerts@yourdomain.com'
};
```

### Amazon SES

```typescript
const smtpConfig: SmtpConfig = {
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 587,
  secure: false,
  user: 'your-ses-smtp-username',
  pass: 'your-ses-smtp-password',
  from: 'alerts@yourdomain.com'
};
```

## Testing

```bash
npm test
npm run test:watch
npm run test:cov
```

## Building

```bash
npm run build
```

## License

MIT
