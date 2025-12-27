/**
 * Example usage of email notification adapter
 *
 * NOTE: This is an example file. To run it:
 * 1. Update SMTP configuration with real credentials
 * 2. Run: npx ts-node examples/email-example.ts
 */

import { sendEmailAlert, type EmailConfig, type AlertData, type SmtpConfig } from '../src';

async function main() {
  // Configure SMTP (update with your real SMTP credentials)
  const smtpConfig: SmtpConfig = {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: 'your-email@gmail.com',
    pass: 'your-app-password', // Use App Password for Gmail
    from: 'alerts@sentinel.dev'
  };

  // Configure email recipients
  const emailConfig: EmailConfig = {
    to: ['recipient@example.com']
  };

  // Example alert data
  const alert: AlertData = {
    id: 'alert-' + Date.now(),
    ruleId: 'rule-price-monitor',
    ruleName: 'Product Price Monitor',
    sourceUrl: 'https://example.com/product/12345',
    severity: 'warning',
    title: 'Price Drop Detected',
    body: 'The price of the monitored product has decreased significantly.',
    triggeredAt: new Date(),
    currentValue: { price: 99.99, currency: 'USD' },
    previousValue: { price: 149.99, currency: 'USD' },
    changeKind: 'price_decrease',
    diffSummary: 'Price decreased from $149.99 to $99.99 (33% off)'
  };

  console.log('Sending email alert...');
  console.log('Alert ID:', alert.id);
  console.log('Recipients:', emailConfig.to.join(', '));

  const result = await sendEmailAlert(emailConfig, alert, smtpConfig);

  if (result.success) {
    console.log('✓ Email sent successfully!');
    console.log('Message ID:', result.messageId);
  } else {
    console.error('✗ Failed to send email');
    console.error('Error:', result.error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);
