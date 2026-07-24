#!/usr/bin/env node

/*
 * start.js — Entry Point
 * 
 * Usage: node server/start.js
 * 
 * Starts the SMTP HTTP API server on localhost:3847
 */

const HTTPApi = require('./http-api');

const PORT = parseInt(process.env.PORT) || 3847;
const api = new HTTPApi(PORT);

// Start server
api.start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  api.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] Shutting down...');
  api.stop();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('[Server] Unhandled rejection:', err);
});
