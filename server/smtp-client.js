/*
 * smtp-server.js — Raw SMTP Client
 * 
 * Pure Node.js SMTP implementation using ONLY built-in modules.
 * Zero third-party dependencies.
 * 
 * Supports:
 * - STARTTLS (port 587)
 * - Direct TLS/SSL (port 465)
 * - AUTH LOGIN / AUTH PLAIN
 * - MIME message construction
 * - HTML + plain text emails
 */

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const os = require('os');

class SMTPClient {
  /**
   * @param {Object} config
   * @param {string} config.host - SMTP server hostname
   * @param {number} config.port - SMTP port (465 for SSL, 587 for STARTTLS, 25 for plain)
   * @param {string} config.user - SMTP username (email)
   * @param {string} config.pass - SMTP password or app password
   * @param {boolean} [config.secure] - Use direct TLS (true for port 465)
   */
  constructor(config) {
    this.host = config.host;
    this.port = config.port;
    this.user = config.user;
    this.pass = config.pass;
    this.secure = config.secure !== undefined ? config.secure : (config.port === 465);
    this.socket = null;
    this.debug = config.debug || false;
  }

  /**
   * Log debug messages
   */
  _log(direction, msg) {
    if (this.debug) {
      const prefix = direction === 'S' ? '  S: ' : '  C: ';
      console.log(prefix + msg.trim());
    }
  }

  /**
   * Create a TCP or TLS connection
   */
  _connect() {
    return new Promise((resolve, reject) => {
      const onConnect = () => {
        this._readResponse().then(resolve).catch(reject);
      };

      if (this.secure) {
        // Direct TLS (port 465)
        this.socket = tls.connect({
          host: this.host,
          port: this.port,
          rejectUnauthorized: false
        }, onConnect);
      } else {
        // Plain TCP first (port 587/25), will upgrade with STARTTLS
        this.socket = net.createConnection({
          host: this.host,
          port: this.port
        }, onConnect);
      }

      this.socket.setEncoding('utf8');
      this.socket.setTimeout(30000);

      this.socket.on('error', (err) => {
        reject(new Error(`SMTP connection error: ${err.message}`));
      });

      this.socket.on('timeout', () => {
        this.socket.destroy();
        reject(new Error('SMTP connection timeout'));
      });
    });
  }

  /**
   * Read a full SMTP response (may be multi-line)
   */
  _readResponse() {
    return new Promise((resolve, reject) => {
      let buffer = '';

      const onData = (data) => {
        buffer += data;

        // SMTP responses end with \r\n
        // Multi-line responses have dash after code (e.g., 250-SIZE)
        // Final line has space after code (e.g., 250 OK)
        const lines = buffer.split('\r\n');
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;

          // Check if this is the final line (code followed by space, not dash)
          const match = line.match(/^(\d{3})([ -])(.*)/);
          if (match && match[2] === ' ') {
            // Final line found
            this.socket.removeListener('data', onData);
            this._log('S', buffer.trim());
            
            const code = parseInt(match[1]);
            resolve({ code, message: buffer.trim(), lines: buffer.trim().split('\r\n') });
            return;
          }
        }
        // If no final line yet, keep waiting for more data
      };

      this.socket.on('data', onData);

      // Safety timeout
      const timeout = setTimeout(() => {
        this.socket.removeListener('data', onData);
        if (buffer) {
          this._log('S', buffer.trim());
          const match = buffer.match(/^(\d{3})/);
          resolve({ code: match ? parseInt(match[1]) : 0, message: buffer.trim(), lines: buffer.trim().split('\r\n') });
        } else {
          reject(new Error('SMTP response timeout'));
        }
      }, 15000);

      // Clear timeout on data receipt that completes
      const origResolve = resolve;
      resolve = (val) => {
        clearTimeout(timeout);
        origResolve(val);
      };
    });
  }

  /**
   * Send a command and read the response
   */
  _command(cmd) {
    return new Promise((resolve, reject) => {
      this._log('C', cmd);
      this.socket.write(cmd + '\r\n', () => {
        this._readResponse().then(resolve).catch(reject);
      });
    });
  }

  /**
   * Upgrade connection to TLS (STARTTLS)
   */
  _upgradeToTLS() {
    return new Promise((resolve, reject) => {
      const plainSocket = this.socket;

      this.socket = tls.connect({
        socket: plainSocket,
        host: this.host,
        rejectUnauthorized: false
      }, () => {
        this.socket.setEncoding('utf8');
        resolve();
      });

      this.socket.on('error', (err) => {
        reject(new Error(`TLS upgrade error: ${err.message}`));
      });
    });
  }

  /**
   * Build a MIME email message
   */
  _buildMessage(from, to, subject, body, options = {}) {
    const boundary = '----=_Part_' + crypto.randomBytes(16).toString('hex');
    const messageId = '<' + crypto.randomBytes(16).toString('hex') + '@' + this.host + '>';
    const date = new Date().toUTCString();
    const senderName = options.senderName || '';
    const fromHeader = senderName ? `"${senderName}" <${from}>` : from;
    const isHTML = options.html || false;

    let headers = [
      `From: ${fromHeader}`,
      `To: ${to}`,
      `Subject: ${this._encodeSubject(subject)}`,
      `Date: ${date}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `X-Mailer: AutoLinked/1.0`
    ];

    if (options.replyTo) {
      headers.push(`Reply-To: ${options.replyTo}`);
    }

    let messageBody;

    if (isHTML) {
      // Multipart message with both plain text and HTML
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      
      // Strip HTML tags for plain text version
      const plainText = body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

      messageBody = [
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        plainText,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        body,
        '',
        `--${boundary}--`
      ].join('\r\n');
    } else {
      headers.push('Content-Type: text/plain; charset="UTF-8"');
      headers.push('Content-Transfer-Encoding: 7bit');
      messageBody = '\r\n' + body;
    }

    return headers.join('\r\n') + '\r\n' + messageBody;
  }

  /**
   * Encode subject for non-ASCII characters
   */
  _encodeSubject(subject) {
    // Check if subject contains non-ASCII
    if (/^[\x20-\x7E]*$/.test(subject)) {
      return subject;
    }
    // UTF-8 Base64 encoding
    return '=?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=';
  }

  /**
   * Test SMTP connection and authentication
   */
  async testConnection() {
    try {
      // Connect
      const greeting = await this._connect();
      if (greeting.code !== 220) {
        throw new Error(`Unexpected greeting: ${greeting.message}`);
      }

      // EHLO
      let ehlo = await this._command(`EHLO ${os.hostname()}`);
      if (ehlo.code !== 250) {
        throw new Error(`EHLO failed: ${ehlo.message}`);
      }

      // STARTTLS if not already secure
      if (!this.secure) {
        const starttls = await this._command('STARTTLS');
        if (starttls.code !== 220) {
          throw new Error(`STARTTLS failed: ${starttls.message}`);
        }
        await this._upgradeToTLS();

        // Re-EHLO after TLS
        ehlo = await this._command(`EHLO ${os.hostname()}`);
        if (ehlo.code !== 250) {
          throw new Error(`EHLO after TLS failed: ${ehlo.message}`);
        }
      }

      // AUTH LOGIN
      const authResponse = await this._command('AUTH LOGIN');
      if (authResponse.code !== 334) {
        throw new Error(`AUTH LOGIN failed: ${authResponse.message}`);
      }

      // Send username (base64)
      const userResponse = await this._command(Buffer.from(this.user).toString('base64'));
      if (userResponse.code !== 334) {
        throw new Error(`Username rejected: ${userResponse.message}`);
      }

      // Send password (base64)
      const passResponse = await this._command(Buffer.from(this.pass).toString('base64'));
      if (passResponse.code !== 235) {
        throw new Error(`Authentication failed: ${passResponse.message}`);
      }

      // QUIT
      await this._command('QUIT');
      this.socket.destroy();

      return { success: true, message: 'SMTP connection and authentication successful' };
    } catch (err) {
      if (this.socket) this.socket.destroy();
      return { success: false, message: err.message };
    }
  }

  /**
   * Send a single email
   * 
   * @param {Object} email
   * @param {string} email.from - Sender email
   * @param {string} email.to - Recipient email
   * @param {string} email.subject - Email subject
   * @param {string} email.body - Email body (plain text or HTML)
   * @param {Object} [email.options] - Additional options
   * @param {string} [email.options.senderName] - Display name for sender
   * @param {boolean} [email.options.html] - Whether body is HTML
   * @param {string} [email.options.replyTo] - Reply-to address
   */
  async sendEmail(email) {
    try {
      // Connect
      const greeting = await this._connect();
      if (greeting.code !== 220) {
        throw new Error(`Server rejected connection: ${greeting.message}`);
      }

      // EHLO
      let ehlo = await this._command(`EHLO ${os.hostname()}`);
      if (ehlo.code !== 250) {
        throw new Error(`EHLO failed: ${ehlo.message}`);
      }

      // STARTTLS if not already secure
      if (!this.secure) {
        const starttls = await this._command('STARTTLS');
        if (starttls.code !== 220) {
          throw new Error(`STARTTLS failed: ${starttls.message}`);
        }
        await this._upgradeToTLS();

        // Re-EHLO after TLS
        ehlo = await this._command(`EHLO ${os.hostname()}`);
        if (ehlo.code !== 250) {
          throw new Error(`EHLO after TLS failed: ${ehlo.message}`);
        }
      }

      // AUTH LOGIN
      const authResponse = await this._command('AUTH LOGIN');
      if (authResponse.code !== 334) {
        throw new Error(`AUTH LOGIN not supported: ${authResponse.message}`);
      }

      const userResponse = await this._command(Buffer.from(this.user).toString('base64'));
      if (userResponse.code !== 334) {
        throw new Error(`Username rejected: ${userResponse.message}`);
      }

      const passResponse = await this._command(Buffer.from(this.pass).toString('base64'));
      if (passResponse.code !== 235) {
        throw new Error(`Authentication failed: ${passResponse.message}`);
      }

      // MAIL FROM
      const fromAddr = email.from || this.user;
      const mailFrom = await this._command(`MAIL FROM:<${fromAddr}>`);
      if (mailFrom.code !== 250) {
        throw new Error(`MAIL FROM rejected: ${mailFrom.message}`);
      }

      // RCPT TO
      const rcptTo = await this._command(`RCPT TO:<${email.to}>`);
      if (rcptTo.code !== 250) {
        throw new Error(`RCPT TO rejected for ${email.to}: ${rcptTo.message}`);
      }

      // DATA
      const dataCmd = await this._command('DATA');
      if (dataCmd.code !== 354) {
        throw new Error(`DATA command rejected: ${dataCmd.message}`);
      }

      // Build and send the message
      const message = this._buildMessage(
        fromAddr,
        email.to,
        email.subject,
        email.body,
        email.options || {}
      );

      // Send message body — ensure lines starting with '.' are escaped
      const escapedMessage = message.replace(/\r\n\./g, '\r\n..');
      
      // Write message + terminator
      this._log('C', '[MESSAGE DATA]');
      const sendResult = await new Promise((resolve, reject) => {
        this.socket.write(escapedMessage + '\r\n.\r\n', () => {
          this._readResponse().then(resolve).catch(reject);
        });
      });

      if (sendResult.code !== 250) {
        throw new Error(`Message rejected: ${sendResult.message}`);
      }

      // QUIT
      await this._command('QUIT');
      this.socket.destroy();

      return { success: true, message: `Email sent to ${email.to}` };
    } catch (err) {
      if (this.socket) this.socket.destroy();
      return { success: false, message: err.message, to: email.to };
    }
  }
}

module.exports = SMTPClient;
