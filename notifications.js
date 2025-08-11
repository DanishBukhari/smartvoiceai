const { Webhook } = require('slack-webhook');

// Initialize Slack webhook
let slack = null;

// Initialize Slack webhook if URL is provided
function initializeSlack() {
  if (process.env.SLACK_WEBHOOK_URL && !slack) {
    try {
      slack = new Webhook(process.env.SLACK_WEBHOOK_URL);
      console.log('✅ Slack notifications initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Slack webhook:', error.message);
    }
  }
}

/**
 * Send error notification to Slack
 * @param {Error} error - The error object
 * @param {string} context - Context where the error occurred
 * @param {Object} additionalData - Additional data to include
 */
async function notifyError(error, context, additionalData = {}) {
  try {
    // Initialize Slack if not already done
    if (!slack && process.env.SLACK_WEBHOOK_URL) {
      initializeSlack();
    }

    // If no Slack webhook configured, log locally
    if (!slack) {
      console.error(`🚨 CRITICAL ERROR in ${context}:`, {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        ...additionalData
      });
      return;
    }

    // Prepare error message for Slack
    const errorMessage = {
      text: `🚨 *Critical Error in SmartVoiceAI*`,
      attachments: [
        {
          color: 'danger',
          fields: [
            {
              title: 'Context',
              value: context,
              short: true
            },
            {
              title: 'Error Message',
              value: error.message || 'Unknown error',
              short: true
            },
            {
              title: 'Timestamp',
              value: new Date().toISOString(),
              short: true
            },
            {
              title: 'Environment',
              value: process.env.NODE_ENV || 'development',
              short: true
            }
          ]
        }
      ]
    };

    // Add additional data if provided
    if (Object.keys(additionalData).length > 0) {
      errorMessage.attachments[0].fields.push({
        title: 'Additional Data',
        value: JSON.stringify(additionalData, null, 2),
        short: false
      });
    }

    // Add stack trace if available (truncated for Slack)
    if (error.stack) {
      const stackTrace = error.stack.split('\n').slice(0, 10).join('\n');
      errorMessage.attachments[0].fields.push({
        title: 'Stack Trace (truncated)',
        value: `\`\`\`${stackTrace}\`\`\``,
        short: false
      });
    }

    // Send to Slack
    await slack.send(errorMessage);
    console.log('✅ Error notification sent to Slack');

  } catch (slackError) {
    console.error('❌ Failed to send Slack notification:', slackError.message);
    // Fallback to console logging
    console.error(`🚨 CRITICAL ERROR in ${context}:`, {
      originalError: error.message,
      slackError: slackError.message,
      timestamp: new Date().toISOString(),
      ...additionalData
    });
  }
}

/**
 * Send success notification to Slack (for important milestones)
 * @param {string} message - Success message
 * @param {Object} data - Additional data
 */
async function notifySuccess(message, data = {}) {
  try {
    if (!slack && process.env.SLACK_WEBHOOK_URL) {
      initializeSlack();
    }

    if (!slack) {
      console.log(`✅ SUCCESS: ${message}`, data);
      return;
    }

    const successMessage = {
      text: `✅ *SmartVoiceAI Success*`,
      attachments: [
        {
          color: 'good',
          fields: [
            {
              title: 'Message',
              value: message,
              short: false
            },
            {
              title: 'Timestamp',
              value: new Date().toISOString(),
              short: true
            }
          ]
        }
      ]
    };

    if (Object.keys(data).length > 0) {
      successMessage.attachments[0].fields.push({
        title: 'Data',
        value: JSON.stringify(data, null, 2),
        short: false
      });
    }

    await slack.send(successMessage);
    console.log('✅ Success notification sent to Slack');

  } catch (error) {
    console.error('❌ Failed to send success notification:', error.message);
  }
}

/**
 * Send warning notification to Slack
 * @param {string} message - Warning message
 * @param {Object} data - Additional data
 */
async function notifyWarning(message, data = {}) {
  try {
    if (!slack && process.env.SLACK_WEBHOOK_URL) {
      initializeSlack();
    }

    if (!slack) {
      console.warn(`⚠️ WARNING: ${message}`, data);
      return;
    }

    const warningMessage = {
      text: `⚠️ *SmartVoiceAI Warning*`,
      attachments: [
        {
          color: 'warning',
          fields: [
            {
              title: 'Message',
              value: message,
              short: false
            },
            {
              title: 'Timestamp',
              value: new Date().toISOString(),
              short: true
            }
          ]
        }
      ]
    };

    if (Object.keys(data).length > 0) {
      warningMessage.attachments[0].fields.push({
        title: 'Data',
        value: JSON.stringify(data, null, 2),
        short: false
      });
    }

    await slack.send(warningMessage);
    console.log('✅ Warning notification sent to Slack');

  } catch (error) {
    console.error('❌ Failed to send warning notification:', error.message);
  }
}

module.exports = {
  notifyError,
  notifySuccess,
  notifyWarning,
  initializeSlack
};
