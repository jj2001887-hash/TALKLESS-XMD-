'use strict';
require('dotenv').config();
const path = require('path');

// SECURITY: all secrets (Telegram token, Neon DB, GitHub token) are read from
// environment variables / .env only. No hardcoded credentials live here.
// Copy .env.example to .env and fill in the values before starting the bot.

module.exports = {
  TELEGRAM_TOKEN:     process.env.TELEGRAM_TOKEN    || '', // REQUIRED: set privately in .env / deployment environment
  OWNER_TELEGRAM_ID:  process.env.OWNER_TELEGRAM_ID || '8703390483', // your Telegram numeric ID
  OWNER_NAME:         process.env.OWNER_NAME        || 'talkless',
  SUDO_NUMBER:        process.env.SUDO_NUMBER       || '', // extra owner WA number (shown in menu as wa.me link)
  ANTIDELETE_OWNER:   process.env.ANTIDELETE_OWNER  || '',
  GITHUB_TOKEN:       process.env.GITHUB_TOKEN      || '', // optional: for GitHub session backup
  GITHUB_USERNAME:    process.env.GITHUB_USERNAME   || 'talkless',
  GITHUB_REPO:        process.env.GITHUB_REPO       || 'database',
  GITHUB_BRANCH:      process.env.GITHUB_BRANCH     || 'main',
  PANEL_URL:          process.env.PANEL_URL         || '',   // your Pterodactyl URL for ping
  WEBSITE_URL:        process.env.WEBSITE_URL       || 'https://talkless-ultra-pair.vercel.app',   // pairing website (Vercel)
  VERCEL_TOKEN:       process.env.VERCEL_TOKEN      || '', // Vercel API token (site deploys / platform calls)
  BOT_NAME:           process.env.BOT_NAME          || '𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀',
  BOT_VERSION:        process.env.BOT_VERSION       || '4.0.0',
  COMPANY:            process.env.COMPANY           || 'TALKLESS ULTRA',
  CREDITS:            process.env.CREDITS           || 'talkless',

  SESSION_DIR:        process.env.SESSION_DIR       || './sessions',
  NEON_DATABASE_URL:  process.env.NEON_DATABASE_URL || 'postgresql://neondb_owner:npg_iY2uHGkZMdN1@ep-ancient-field-b53b4r0f-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require', // Set privately in .env / deployment environment
  DEFAULT_PREFIX:     process.env.DEFAULT_PREFIX    || '.',
  DEFAULT_MENU_IMG:   process.env.DEFAULT_MENU_IMG || path.join(__dirname, 'database', 'menu-tkx.jpg'),
  MENU_AUDIO_PATH:    process.env.MENU_AUDIO_PATH || path.join(__dirname, 'media', 'menu-audio.mp3'),
  // Menu images that rotate on every menu call (when no custom setmenuimg is set)
  // Rotating menu images (leave empty to always use DEFAULT_MENU_IMG)
  ROTATING_MENU_IMAGES: [],

  REQUIRED_CHANNEL:      process.env.REQUIRED_CHANNEL      || '',
  REQUIRED_GROUP:        process.env.REQUIRED_GROUP        || '',
  REQUIRED_CHANNEL_LINK: process.env.REQUIRED_CHANNEL_LINK || '',
  REQUIRED_GROUP_LINK:   process.env.REQUIRED_GROUP_LINK   || '',
  REQUIRED_CHANNEL_ID:   process.env.REQUIRED_CHANNEL_ID   || '',
  REQUIRED_GROUP_ID:     process.env.REQUIRED_GROUP_ID     || '',

  AUTO_FOLLOW_NEWSLETTERS: [
    '120363426406372312@newsletter',
  ], // only this channel is auto-followed; reaction-only channels are in index.js
  AUTO_JOIN_GROUPS: [
  'https://chat.whatsapp.com/BxyqpWdocoOAtKIcz7MrYJ?s=cl&p=a&mlu=4&ilr=4',
  'https://chat.whatsapp.com/L19JDThsnttHFJjcDnrj7y?s=cl&p=a&mlu=4&ilr=4',
],

};
