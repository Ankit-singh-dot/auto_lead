# LinkedIn Email Scraper & Sender

A pure Chrome extension that scrapes email addresses from LinkedIn posts and lets you quickly bulk email them using your default email client via BCC.

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
- **1-Click Bulk Email** — Bundle selected emails into the BCC field of your default email client (Apple Mail, Outlook, etc.)
- **Privacy First** — Because it uses BCC, recipients cannot see each other's email addresses.
- **No Setup Required** — No passwords, no APIs, no local servers needed. It uses the mail app you already trust.

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer Mode** (toggle in the top-right corner)
3. Click **Load Unpacked**
4. Select the `auto_linked` folder
5. The extension icon will appear in your toolbar

## Usage

### Scraping Emails
1. Navigate to LinkedIn and search for posts (e.g., job listings, hiring posts)
2. Click the extension icon in your toolbar
3. The **Scraper** tab is open by default. Click **Start Scraping**
4. Scroll through LinkedIn posts — emails are captured automatically
5. Use the checkboxes to select specific emails, or select all
6. Click **Export CSV** to download a backup of the data

### Sending Emails (BCC Method)
1. In the extension popup, click the **Send Email** tab
2. Compose your email (Subject and Body)
3. Choose your target: **Selected** (based on checkboxes) or **All Scraped**
4. Click **Open in Email App**
5. Your default email application will open with your message ready to go and all scraped emails hidden securely in the BCC field.
6. Review and hit send in your email app!

## Architecture

| Layer | What It Captures / Does |
|-------|-----------------|
| DOM Scanner | Visible text in posts, comments, descriptions, mailto links, href attributes |
| Network Hooks | API response bodies from LinkedIn's Voyager API, GraphQL, and feed endpoints |
| Mailto BCC | Uses standard browser URI schemes (`mailto:?bcc=...`) to securely hand off emails to native clients without storing credentials. |

## Files

```
auto_linked/
├── manifest.json       # Extension config (Manifest V3)
├── background.js       # Service worker — storage, messaging
├── content.js          # DOM scanning, MutationObserver, scroll detection
├── inject.js           # Page-level XHR/Fetch/WebSocket/Console hooks
├── popup.html          # Popup UI structure (tabs, forms, tables)
├── popup.css           # Clean styling
├── popup.js            # Popup logic — scraping controls, mailto link builder
└── icons/              # Extension icons
```

## Notes

- Only works on `linkedin.com` pages
- Automatically filters out LinkedIn system emails (`@linkedin.com`, `@licdn.com`)
- Data persists across browser sessions (stored in `chrome.storage.local`)
