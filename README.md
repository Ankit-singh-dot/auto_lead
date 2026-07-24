# LinkedIn Email Scraper & Sender

A Chrome extension that scrapes email addresses from LinkedIn posts and exports them to CSV, now with **built-in bulk email sending** capabilities.

## Features

### Scraper
- **DOM Scanning** — Scans all visible text in LinkedIn posts, comments, and profiles for email addresses
- **Network Interception** — Hooks into XHR, Fetch, and WebSocket to capture emails from LinkedIn API responses
- **Obfuscated Email Detection** — Catches emails written as `user [at] domain [dot] com`
- **Console Capture** — Monitors console output for emails
- **Auto-scroll Detection** — Automatically scans new content as you scroll
- **CSV Export** — Export all found emails with context (poster name, source, timestamp)
- **Search & Filter** — Filter through scraped emails in the popup

### Sender
- **Local SMTP Server** — Uses a lightweight local Node.js server (zero dependencies) to send emails directly via your provider (Gmail, Outlook, Yahoo)
- **Bulk Sending** — Send an email to all scraped addresses with one click
- **Selective Sending** — Select specific emails from the list to send to
- **Rate Limiting** — Configurable delay between emails to avoid spam filters
- **Progress Tracking** — Real-time progress bar and success/failure logs

## Installation

### 1. Install the Chrome Extension
1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer Mode** (toggle in the top-right corner)
3. Click **Load Unpacked**
4. Select the `auto_linked` folder
5. The extension icon will appear in your toolbar

### 2. Start the Local SMTP Server
To use the email sending feature, you must run the local companion server. This server handles the raw SMTP connections to your email provider.

1. Open your terminal
2. Navigate to the extension folder: `cd /path/to/auto_linked`
3. Run the server: `node server/start.js`
4. The server will run on `http://localhost:3847`

## Usage

### Scraping Emails
1. Navigate to LinkedIn and search for posts (e.g., job listings, hiring posts)
2. Click the extension icon in your toolbar
3. The **Scraper** tab is open by default. Click **Start Scraping**
4. Scroll through LinkedIn posts — emails are captured automatically
5. Use the checkboxes to select specific emails, or select all
6. Click **Export CSV** to download a backup of the data

### Sending Emails
1. Make sure your local server is running (`node server/start.js`)
2. In the extension popup, click the **Send Email** tab
3. Select your provider preset (Gmail, Outlook, Yahoo) or enter custom SMTP details
4. Enter your email address and password. **For Gmail, you MUST use an App Password** (see below)
5. Click **Test Connection** to verify your credentials
6. Compose your email (Subject and Body). Basic HTML is supported in the body
7. Choose your target: **Selected** (based on checkboxes) or **All Scraped**
8. Set a safe delay (e.g., 2000ms = 2 seconds between emails)
9. Click **Send Emails** and watch the progress bar

## Important: Gmail Setup (App Passwords)

Google no longer allows you to sign in with just your regular password for SMTP connections. You must generate an **App Password**:

1. Go to your Google Account settings (myaccount.google.com)
2. Navigate to **Security**
3. Ensure **2-Step Verification** is turned on
4. Click on **2-Step Verification** -> Scroll to bottom -> **App Passwords**
5. Create a new App Password (name it "LinkedIn Scraper")
6. Copy the 16-character password generated and use *that* in the extension instead of your regular password.

## Architecture

| Layer | What It Captures / Does |
|-------|-----------------|
| DOM Scanner | Visible text in posts, comments, descriptions, mailto links, href attributes |
| Network Hooks | API response bodies from LinkedIn's Voyager API, GraphQL, and feed endpoints |
| Local Node API | HTTP server running on `localhost:3847` to bridge extension to TCP sockets |
| Raw SMTP Client | Custom implementation of SMTP protocol using Node's `net` and `tls` modules (zero dependencies) |

## Files

```
auto_linked/
├── manifest.json       # Extension config (Manifest V3)
├── background.js       # Service worker — storage, messaging, settings
├── content.js          # DOM scanning, MutationObserver, scroll detection
├── inject.js           # Page-level XHR/Fetch/WebSocket/Console hooks
├── popup.html          # Popup UI structure (tabs, forms, tables)
├── popup.css           # Clean styling
├── popup.js            # Popup logic — scraping controls, sender API calls
├── icons/              # Extension icons
└── server/             # Local API Server
    ├── start.js        # Entry point
    ├── http-api.js     # Express-like routing without Express
    └── smtp-client.js  # Raw SMTP/TLS client
```

## Notes

- Only works on `linkedin.com` pages
- Automatically filters out LinkedIn system emails (`@linkedin.com`, `@licdn.com`)
- Data persists across browser sessions (stored in `chrome.storage.local`)
