/*
 * http-api.js — HTTP API Server
 * 
 * Built with Node.js built-in `http` module — zero dependencies.
 * Provides REST endpoints for the Chrome extension to send emails.
 * 
 * Endpoints:
 *   POST /test-connection  — Test SMTP credentials
 *   POST /send             — Send a single email
 *   POST /send-bulk        — Send to multiple recipients with rate limiting
 *   GET  /status           — Server health + active bulk send progress
 *   POST /cancel           — Cancel an active bulk send
 */

const http = require('http');
const SMTPClient = require('./smtp-client');

class HTTPApi {
  constructor(port = 3847) {
    this.port = port;
    this.server = null;

    // Bulk send state
    this.bulkSendActive = false;
    this.bulkSendCancelled = false;
    this.bulkProgress = {
      total: 0,
      sent: 0,
      failed: 0,
      current: '',
      results: [],
      status: 'idle' // idle | sending | done | cancelled
    };
  }

  /**
   * Parse JSON request body
   */
  _parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Send JSON response with CORS headers
   */
  _respond(res, statusCode, data) {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    res.end(json);
  }

  /**
   * Sleep helper
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Handle POST /test-connection
   */
  async _handleTestConnection(req, res) {
    try {
      const body = await this._parseBody(req);
      const { host, port, user, pass, secure } = body;

      if (!host || !port || !user || !pass) {
        return this._respond(res, 400, { success: false, message: 'Missing required fields: host, port, user, pass' });
      }

      const client = new SMTPClient({ host, port: Number(port), user, pass, secure, debug: true });
      const result = await client.testConnection();
      this._respond(res, result.success ? 200 : 400, result);
    } catch (err) {
      this._respond(res, 500, { success: false, message: err.message });
    }
  }

  /**
   * Handle POST /send
   */
  async _handleSend(req, res) {
    try {
      const body = await this._parseBody(req);
      const { smtp, email } = body;

      if (!smtp || !email) {
        return this._respond(res, 400, { success: false, message: 'Missing smtp config or email data' });
      }

      if (!smtp.host || !smtp.port || !smtp.user || !smtp.pass) {
        return this._respond(res, 400, { success: false, message: 'Incomplete SMTP config' });
      }

      if (!email.to || !email.subject) {
        return this._respond(res, 400, { success: false, message: 'Missing email to or subject' });
      }

      const client = new SMTPClient({
        host: smtp.host,
        port: Number(smtp.port),
        user: smtp.user,
        pass: smtp.pass,
        secure: smtp.secure,
        debug: true
      });

      const result = await client.sendEmail({
        from: smtp.user,
        to: email.to,
        subject: email.subject,
        body: email.body || '',
        options: {
          senderName: email.senderName || '',
          html: email.html || false,
          replyTo: email.replyTo || ''
        }
      });

      this._respond(res, result.success ? 200 : 500, result);
    } catch (err) {
      this._respond(res, 500, { success: false, message: err.message });
    }
  }

  /**
   * Handle POST /send-bulk
   */
  async _handleSendBulk(req, res) {
    try {
      if (this.bulkSendActive) {
        return this._respond(res, 409, {
          success: false,
          message: 'A bulk send is already in progress. Cancel it first or wait.'
        });
      }

      const body = await this._parseBody(req);
      const { smtp, email, recipients, delayMs } = body;

      if (!smtp || !email || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return this._respond(res, 400, {
          success: false,
          message: 'Missing smtp, email, or recipients array'
        });
      }

      const delay = Math.max(Number(delayMs) || 2000, 500); // Minimum 500ms between sends

      // Reset progress
      this.bulkSendActive = true;
      this.bulkSendCancelled = false;
      this.bulkProgress = {
        total: recipients.length,
        sent: 0,
        failed: 0,
        current: '',
        results: [],
        status: 'sending'
      };

      // Respond immediately — sending happens in background
      this._respond(res, 202, {
        success: true,
        message: `Bulk send started for ${recipients.length} recipients`,
        total: recipients.length
      });

      // Send emails in background
      this._executeBulkSend(smtp, email, recipients, delay);
    } catch (err) {
      this._respond(res, 500, { success: false, message: err.message });
    }
  }

  /**
   * Execute bulk send (runs in background after HTTP response)
   */
  async _executeBulkSend(smtp, email, recipients, delayMs) {
    console.log(`\n[Bulk Send] Starting: ${recipients.length} recipients, ${delayMs}ms delay\n`);

    for (let i = 0; i < recipients.length; i++) {
      if (this.bulkSendCancelled) {
        console.log('[Bulk Send] Cancelled by user');
        this.bulkProgress.status = 'cancelled';
        break;
      }

      const to = recipients[i];
      this.bulkProgress.current = to;

      console.log(`[Bulk Send] ${i + 1}/${recipients.length} → ${to}`);

      const client = new SMTPClient({
        host: smtp.host,
        port: Number(smtp.port),
        user: smtp.user,
        pass: smtp.pass,
        secure: smtp.secure,
        debug: false
      });

      const result = await client.sendEmail({
        from: smtp.user,
        to: to,
        subject: email.subject,
        body: email.body || '',
        options: {
          senderName: email.senderName || '',
          html: email.html || false,
          replyTo: email.replyTo || ''
        }
      });

      this.bulkProgress.results.push({
        to,
        success: result.success,
        message: result.message,
        timestamp: new Date().toISOString()
      });

      if (result.success) {
        this.bulkProgress.sent++;
        console.log(`  ✓ Sent to ${to}`);
      } else {
        this.bulkProgress.failed++;
        console.log(`  ✗ Failed: ${to} — ${result.message}`);
      }

      // Delay between sends (skip delay on last email)
      if (i < recipients.length - 1 && !this.bulkSendCancelled) {
        await this._sleep(delayMs);
      }
    }

    if (this.bulkProgress.status !== 'cancelled') {
      this.bulkProgress.status = 'done';
    }
    this.bulkProgress.current = '';
    this.bulkSendActive = false;

    console.log(`\n[Bulk Send] Complete: ${this.bulkProgress.sent} sent, ${this.bulkProgress.failed} failed\n`);
  }

  /**
   * Handle GET /status
   */
  _handleStatus(req, res) {
    this._respond(res, 200, {
      server: 'running',
      version: '1.0.0',
      bulk: { ...this.bulkProgress }
    });
  }

  /**
   * Handle POST /cancel
   */
  _handleCancel(req, res) {
    if (!this.bulkSendActive) {
      return this._respond(res, 400, { success: false, message: 'No bulk send in progress' });
    }
    this.bulkSendCancelled = true;
    this._respond(res, 200, { success: true, message: 'Bulk send cancellation requested' });
  }

  /**
   * Start the HTTP server
   */
  start() {
    this.server = http.createServer(async (req, res) => {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        return this._respond(res, 204, '');
      }

      const url = req.url.split('?')[0]; // Strip query params

      try {
        switch (`${req.method} ${url}`) {
          case 'POST /test-connection':
            await this._handleTestConnection(req, res);
            break;
          case 'POST /send':
            await this._handleSend(req, res);
            break;
          case 'POST /send-bulk':
            await this._handleSendBulk(req, res);
            break;
          case 'GET /status':
            this._handleStatus(req, res);
            break;
          case 'POST /cancel':
            this._handleCancel(req, res);
            break;
          default:
            this._respond(res, 404, { error: 'Not found' });
        }
      } catch (err) {
        console.error('[HTTP] Error:', err.message);
        this._respond(res, 500, { error: err.message });
      }
    });

    this.server.listen(this.port, '127.0.0.1', () => {
      console.log(`\n╔════════════════════════════════════════════╗`);
      console.log(`║  LinkedIn Email Scraper — SMTP Server      ║`);
      console.log(`║  Running on http://localhost:${this.port}        ║`);
      console.log(`╚════════════════════════════════════════════╝\n`);
      console.log(`Endpoints:`);
      console.log(`  POST /test-connection  — Test SMTP credentials`);
      console.log(`  POST /send            — Send single email`);
      console.log(`  POST /send-bulk       — Send bulk emails`);
      console.log(`  GET  /status          — Server status + progress`);
      console.log(`  POST /cancel          — Cancel bulk send\n`);
    });

    return this.server;
  }

  /**
   * Stop the server
   */
  stop() {
    if (this.server) {
      this.server.close();
      console.log('[HTTP] Server stopped');
    }
  }
}

module.exports = HTTPApi;
