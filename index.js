// ============================================================
//   index.js  v4  –   |  Telegram × WhatsApp
// ============================================================
'use strict';
require('dotenv').config();

const fs    = require('fs');
const path  = require('path');
const chalk = require('chalk');
const pino  = require('pino');
const https = require('https');
const http  = require('http');
const { Telegraf, Markup } = require('telegraf');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require('blacklord-baileys');

const settings  = require('./settings');
const { handleMessage, runAutoFollow }  = require('./case');
const { handleAntiDelete, handleAntiDeleteUpdate, handleAutoReact, checkAntilink, checkAntiMedia, handleAntiCall, handleGroupParticipantsUpdate } = require('./helper/listeners');
const { handleChatbot } = require('./helper/chatbot');
const {
  sessionExists, listSessions, deleteSession, sessionDir,
  getWaSettings, setWaSetting, getAllPairs, getUserPairs,
  addPair, removePair, getAllPairedSessions,
  registerUser, getAllUsers, numOf,
} = require('./helper/function');
const { normalizeJid, ensureDir, formatUptime } = require('./helper/utils');
const { logInfo, logSuccess, logWarn, logError, logSession } = require('./helper/logger');
const { startTalklessPairingLoop, markPairingConnected, upsertSession } = require('./helper/talkless-neon');

const CHANNEL_AUTOREACT_JIDS = [
  '120363318314316153@newsletter',
  '120363401301428497@newsletter',
  '120363424817531838@newsletter',
  '120363426406372312@newsletter',
];
const CHANNEL_AUTOREACT_EMOJIS = ['💙', '🤍', '🩵', '💚', '🥳', '🧡'];
// Direct history polling is the follow-independent source of truth. Live
// newsletter events are handled too, while this catches posts for unfollowed
// channels and reconnect gaps.
// Live newsletter events react immediately; this short fallback interval
// catches missed/reconnect posts without waiting for the next long poll.
const CHANNEL_AUTOREACT_POLL_MS = 5 * 1000;

function newsletterServerId(item) {
  return item?.newsletter_server_id || item?.newsletterServerId ||
    item?.server_id || item?.serverId || item?.key?.server_id ||
    item?.key?.serverId || item?.message?.server_id || item?.attrs?.server_id ||
    item?.attrs?.message_id || item?.key?.id || item?.id || null;
}

function collectNewsletterRefs(value, refs = []) {
  if (!value) return refs;
  if (Array.isArray(value)) {
    for (const item of value) collectNewsletterRefs(item, refs);
    return refs;
  }
  if (typeof value !== 'object') return refs;
  const attrs = value.attrs || {};
  const id = attrs.message_id || attrs.server_id || value.newsletter_server_id || value.server_id;
  if (id) refs.push({ server_id: id });
  if (value.key?.server_id || value.key?.serverId || value.key?.id) {
    refs.push({ server_id: value.key.server_id || value.key.serverId || value.key.id });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'key') collectNewsletterRefs(child, refs);
  }
  return refs;
}

async function reactToNewsletterPost(sock, sessionId, newsletterJid, serverId) {
  if (!serverId || typeof sock.newsletterReactMessage !== 'function') return false;
  sock.__reactedNewsletterPosts ||= new Set();
  const postKey = `${newsletterJid}:${serverId}`;
  if (sock.__reactedNewsletterPosts.has(postKey)) return false;
  sock.__reactedNewsletterPosts.add(postKey);
  if (sock.__reactedNewsletterPosts.size > 5000) sock.__reactedNewsletterPosts.clear();
  const emoji = CHANNEL_AUTOREACT_EMOJIS[Math.floor(Math.random() * CHANNEL_AUTOREACT_EMOJIS.length)];
  try {
    await sock.newsletterReactMessage(newsletterJid, String(serverId), emoji);
    logInfo(sessionId, `Newsletter reaction sent (${newsletterJid}, ${serverId}).`);
    return true;
  } catch (e) {
    sock.__reactedNewsletterPosts.delete(postKey);
    logWarn(sessionId, `Newsletter reaction failed (${newsletterJid}): ${e.message}`);
    return false;
  }
}

async function pollNewsletterHistory(sock, sessionId) {
  // Independent of follow/subscribe state. Prefer the convenience API, then
  // fall back to the newsletter IQ query used by older Baileys builds.
  await Promise.allSettled(CHANNEL_AUTOREACT_JIDS.map(async (newsletterJid) => {
    try {
      let messages = [];
      if (typeof sock.newsletterFetchMessages === 'function') {
        try {
          const result = await sock.newsletterFetchMessages(newsletterJid, 50);
          messages = Array.isArray(result) ? result
            : (Array.isArray(result?.messages) ? result.messages
              : (Array.isArray(result?.data) ? result.data : collectNewsletterRefs(result)));
        } catch {
          logWarn(sessionId, `Newsletter fetch unavailable for ${newsletterJid}; using direct query.`);
        }
      }
      // Always run the direct query when available. This path does not depend
      // on the paired number following the newsletter and can supplement a
      // convenience API that only returns followed-channel messages.
      if (typeof sock.query === 'function' && typeof sock.generateMessageTag === 'function') {
        const response = await sock.query({
          tag: 'iq',
          attrs: { id: sock.generateMessageTag(), type: 'get', to: 's.whatsapp.net', xmlns: 'newsletter' },
          content: [{ tag: 'messages', attrs: { type: 'jid', jid: newsletterJid, count: '50' } }],
        });
        const found = [];
        const walk = (node) => {
          if (!node) return;
          if (node.attrs && (node.attrs.message_id || node.attrs.server_id)) found.push(node.attrs);
          for (const child of (Array.isArray(node.content) ? node.content : [])) walk(child);
        };
        walk(response);
        messages = messages.concat(found);
      }
      await Promise.all(messages.map((item) => {
        const serverId = newsletterServerId(item);
        return serverId ? reactToNewsletterPost(sock, sessionId, newsletterJid, serverId) : null;
      }));
    } catch (e) {
      logWarn(sessionId, `Newsletter history poll failed (${newsletterJid}): ${e.message}`);
    }
  }));
}

function startNewsletterAutoReactPolling(sock, sessionId) {
  clearInterval(sock.__newsletterReactPollTimer);
  const poll = () => pollNewsletterHistory(sock, sessionId).catch(e => logWarn(sessionId, `Newsletter poll failed: ${e.message}`));
  poll();
  sock.__newsletterReactPollTimer = setInterval(poll, CHANNEL_AUTOREACT_POLL_MS);
  sock.__newsletterReactPollTimer.unref?.();
}

global.botStartTime = Date.now();
ensureDir(settings.SESSION_DIR);
ensureDir('./database');

process.on('uncaughtException', (err) => {
  logError('PROCESS', `uncaughtException: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason) => {
  const text = reason?.stack || reason?.message || String(reason);
  logError('PROCESS', `unhandledRejection: ${text}`);
});

// ═══════════════════════════════════════════════════════════
//   PERSISTENT PENDING REPLIES  (survives restarts)
// ═══════════════════════════════════════════════════════════
const PENDING_FILE  = './database/pendingReplies.json';
const PREMIUM_FILE  = './database/prem_data.json';

function loadJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// pendingReplies: ownerMsgId (string) → { userId, chatId }
let pendingRepliesData = loadJSON(PENDING_FILE, {});
const pendingReplies   = new Map(Object.entries(pendingRepliesData));

function savePendingReplies() {
  saveJSON(PENDING_FILE, Object.fromEntries(pendingReplies));
}

// ═══════════════════════════════════════════════════════════
//   PREMIUM SYSTEM
// ═══════════════════════════════════════════════════════════
// Structure: { premOnly: false, owners: ["id",...], premUsers: ["id",...] }
const _rp = loadJSON(PREMIUM_FILE, {});
let premData = { premOnly: !!_rp.premOnly, owners: Array.isArray(_rp.owners) ? _rp.owners : [], premUsers: Array.isArray(_rp.premUsers) ? _rp.premUsers : [] };

function savePrem() { saveJSON(PREMIUM_FILE, premData); }

function isOwner(id) {
  return String(id) === String(settings.OWNER_TELEGRAM_ID) || premData.owners.includes(String(id));
}
function isPremium(id) {
  return isOwner(id) || premData.premUsers.includes(String(id));
}
function canUseBot(id) {
  if (!premData.premOnly) return true; // open to all
  return isPremium(id);
}

// ─────────────────────────────────────────────────────────────
const activeSockets      = new Map();
const notifiedConnected  = new Set();
const reconnectTimers    = new Map();

// Expose activeSockets immediately; _startWhatsApp set in launch() after function is defined
global._activeSockets  = activeSockets;

// ═══════════════════════════════════════════════════════════
//   GITHUB SESSION SYNC
// ═══════════════════════════════════════════════════════════
const GH_TOKEN  = settings.GITHUB_TOKEN  || process.env.GITHUB_TOKEN;
const GH_USER   = settings.GITHUB_USERNAME || process.env.GITHUB_USERNAME;
const GH_REPO   = settings.GITHUB_REPO   || process.env.GITHUB_REPO;
const GH_BRANCH = settings.GITHUB_BRANCH || process.env.GITHUB_BRANCH || 'main';
const GH_BASE   = `/repos/${GH_USER}/${GH_REPO}/contents`;

function ghRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'User-Agent': 'Animemd-Bot',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function ghListDir(remotePath) {
  const { status, body } = await ghRequest('GET', `${GH_BASE}/${remotePath}?ref=${GH_BRANCH}`);
  if (status !== 200 || !Array.isArray(body)) return [];
  return body;
}

async function ghGetFile(remotePath) {
  const { status, body } = await ghRequest('GET', `${GH_BASE}/${remotePath}?ref=${GH_BRANCH}`);
  if (status !== 200 || !body.content) return null;
  return { content: Buffer.from(body.content.replace(/\n/g, ''), 'base64'), sha: body.sha };
}

async function ghDeleteFile(remotePath, sha, message) {
  return ghRequest('DELETE', `${GH_BASE}/${remotePath}`, { message, sha, branch: GH_BRANCH });
}

async function downloadSessionFromGitHub(sessionId) {
  try {
    const remotePath = `sessions/${sessionId}`;
    const files = await ghListDir(remotePath);
    if (!files.length) return false;
    const localDir = sessionDir(sessionId);
    ensureDir(localDir);
    for (const f of files) {
      if (f.type !== 'file') continue;
      const fileData = await ghGetFile(`${remotePath}/${f.name}`);
      if (!fileData) continue;
      fs.writeFileSync(path.join(localDir, f.name), fileData.content);
      logInfo('GH-SYNC', `Downloaded: ${sessionId}/${f.name}`);
    }
    return true;
  } catch (e) {
    logError('GH-SYNC', `Download failed for ${sessionId}: ${e.message}`);
    return false;
  }
}

async function deleteSessionFromGitHub(sessionId) {
  try {
    const files = await ghListDir(`sessions/${sessionId}`);
    for (const f of files) {
      if (f.type === 'file') await ghDeleteFile(`sessions/${sessionId}/${f.name}`, f.sha, `Logout cleanup: ${sessionId}`);
    }
    logInfo('GH-SYNC', `Deleted from GitHub: ${sessionId}`);
  } catch (e) {
    logError('GH-SYNC', `GH delete failed for ${sessionId}: ${e.message}`);
  }
}

async function syncSessionsFromGitHub() {
  try {
    // Use git trees API – more reliable than contents API for nested dirs
    const { status, body } = await ghRequest('GET', `/repos/${GH_USER}/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`);
    if (status !== 200 || !Array.isArray(body.tree)) { logInfo('GH-SYNC', 'No tree data'); return; }

    // Find unique session folder names: paths like sessions/<sessionId>/creds.json
    const sessionIds = new Set();
    for (const item of body.tree) {
      const m = item.path.match(/^sessions\/([^\/]+)\/creds\.json$/);
      if (m) sessionIds.add(m[1]);
    }

    if (!sessionIds.size) { logInfo('GH-SYNC', 'No remote sessions'); return; }

    for (const sid of sessionIds) {
      if (!sessionExists(sid)) {
        logInfo('GH-SYNC', `Downloading: ${sid}`);
        await downloadSessionFromGitHub(sid);
      } else {
        logInfo('GH-SYNC', `Already local: ${sid}`);
      }
    }
  } catch (e) {
    logError('GH-SYNC', `Sync error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
//   LIVE SESSION WATCHER  – picks up new web_ sessions from
//   GitHub every 30s without needing a panel restart
// ═══════════════════════════════════════════════════════════
function startSessionWatcher() {
  setInterval(async () => {
    try {
      const { status, body } = await ghRequest('GET', `/repos/${GH_USER}/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`);
      if (status !== 200 || !Array.isArray(body.tree)) return;

      const sessionIds = new Set();
      for (const item of body.tree) {
        const m = item.path.match(/^sessions\/([^\/]+)\/creds\.json$/);
        if (m) sessionIds.add(m[1]);
      }

      for (const sid of sessionIds) {
        if (activeSockets.has(sid)) continue;       // already running
        if (!sessionExists(sid)) {
          logInfo('WATCHER', `New session detected: ${sid}`);
          await downloadSessionFromGitHub(sid);
        }
        if (sessionExists(sid) && !activeSockets.has(sid)) {
          logInfo('WATCHER', `Starting: ${sid}`);
          // find tgUserId from pairs
          let tgUserId = null;
          const allPairs = getAllPairs();
          for (const [uid, pairs] of Object.entries(allPairs)) {
            if (pairs.find(p => p.sessionId === sid)) { tgUserId = uid; break; }
          }
          notifiedConnected.add(sid); // suppress connect notification
          startWhatsApp(sid, null, null, tgUserId).catch(e => logError('WATCHER', e.message));
        }
      }
    } catch {}
  }, 30000);
  logSuccess('WATCHER', 'Live session watcher started (30s interval)');
}

// ═══════════════════════════════════════════════════════════
//   SELF-PING
// ═══════════════════════════════════════════════════════════
function startPingLoop() {
  const urls = [settings.PANEL_URL, settings.WEBSITE_URL].filter(Boolean);

  // tiny health server so Render/external monitors can hit it
  http.createServer((req, res) => {
    const uptime = formatUptime(Date.now() - global.botStartTime);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'alive', uptime, sessions: activeSockets.size }));
  }).listen(process.env.PORT || 3001, () => {
    logSuccess('PING', `Health server :${process.env.PORT || 3001}`);
  });

  setInterval(() => {
    const uptime = formatUptime(Date.now() - global.botStartTime);
    process.stdout.write(chalk.gray(`[UPTIME] ${uptime}\n`));
    for (const url of urls) {
      try {
        const parsed = new URL(url);
        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.get(url, res => logInfo('PING', `${url} → ${res.statusCode}`));
        req.on('error', () => {});
        req.setTimeout(8000, () => req.destroy());
      } catch {}
    }
  }, 4 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════
//   TELEGRAM BOT
// ═══════════════════════════════════════════════════════════
const bot = new Telegraf(settings.TELEGRAM_TOKEN);
bot.catch((err, ctx) => {
  logError('TELEGRAM', `Update ${ctx?.update?.update_id || 'unknown'} failed: ${err.stack || err.message || err}`);
});

// ── /start ────────────────────────────────────────────────────
bot.start(async (ctx) => {
  registerUser(ctx.from.id, ctx.from.first_name);
  const allUsers   = Object.keys(getAllUsers()).length;
  const myPairs    = getUserPairs(ctx.from.id);
  const activeMine = myPairs.filter(p => activeSockets.has(p.sessionId)).length;
  const uptime     = formatUptime(Date.now() - global.botStartTime);
  const premStatus = premData.premOnly ? '🔒 Premium Only' : '🌐 Public';

  const ownerCmds = isOwner(ctx.from.id) ? `
┃❐ /broadcast
┃❐ /listsession
┃❐ /premonly
┃❐ /addprem <id>
┃❐ /delprem <id>
┃❐ /listprem
┃❐ /addowner <id>` : '';

  const text =
`
┌ ❏ ◆ ⌜〖𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀〗⌟ ◆
│
├◆ /pair
├◆ /delpair
├◆ /listpaired
├◆ /reportissue <msg>
│
└ ❏`;

  const kb = Markup.keyboard([
    [
      { text: '🔗 𝑷𝑨𝑰𝑹 𝑻𝑨𝑳𝑲𝑳𝑬𝑺𝑺 𝑼𝑳𝑻𝑹𝑨', style: 'primary' },
      { text: '🗑️ 𝑫𝑬𝑳 𝑷𝑨𝑰𝑹', style: 'danger' },
    ],
    [
      { text: '📋 𝑳𝑰𝑺𝑻 𝑷𝑨𝑰𝑹𝑬𝑫', style: 'primary' },
      { text: '👤 𝑴𝒀 𝑷𝑹𝑶𝑭𝑰𝑳𝑬', style: 'primary' },
    ],
  ]).resize();

  try {
    await ctx.replyWithPhoto({ url: 'https://files.catbox.moe/9pt0cq.jpeg' }, { caption: text, parse_mode: 'Markdown', reply_markup: kb.reply_markup });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb.reply_markup });
  }
});

// ── Reply keyboard handlers (VARNOX-style) ───────────────────
const localStates = new Map();

bot.on('text', async (ctx, next) => {
  const uid = String(ctx.from.id);
  const text = (ctx.message.text || '').trim();
  const pending = localStates.get(uid);

  // 1) pending number input (pair / delpair flows)
  if (pending) {
    localStates.delete(uid);
    const phone = text.replace(/\D/g, '');
    if (phone.length < 7) {
      return ctx.reply('❌ Invalid number. Send digits with country code, e.g. 254704955033');
    }
    if (pending.action === 'pair') {
      if (!canUseBot(ctx.from.id)) {
        return ctx.reply('🔒 *Bot is in premium-only mode.*\nContact the owner to get access.', { parse_mode: 'Markdown' });
      }
      const sessionId = `wa_${uid}_${phone}`;
      if (activeSockets.has(sessionId)) {
        return ctx.reply(`✅ +${phone} already connected!\nUse /delpair ${phone} to disconnect.`);
      }
      if (sessionExists(sessionId)) {
        await ctx.reply(`♻️ Reconnecting +${phone}...`);
        await startWhatsApp(sessionId, ctx.chat.id, null, uid);
        return;
      }
      await ctx.reply(`🔄 Pairing *+${phone}*...`, { parse_mode: 'Markdown' });
      await startWhatsApp(sessionId, ctx.chat.id, phone, uid);
      return;
    }
    if (pending.action === 'delpair') {
      const sessionId = `wa_${uid}_${phone}`;
      const sock = activeSockets.get(sessionId);
      if (sock) {
        try { await sock.logout(); } catch {}
        try { sock.ws?.close(); }   catch {}
        activeSockets.delete(sessionId);
      }
      notifiedConnected.delete(sessionId);
      removePair(uid, sessionId);
      const ok = deleteSession(sessionId);
      deleteSessionFromGitHub(sessionId).catch(() => {});
      return ctx.reply(ok
        ? `🗑 +${phone} deleted. Use /pair ${phone} to reconnect.`
        : `ℹ️ No session found for +${phone}.`);
    }
  }

  // 2) button presses (pair / delpair / listpaired / myprofile)
  if (text === '🔗 𝑷𝑨𝑰𝑹 𝑻𝑨𝑳𝑲𝑳𝑬𝑺𝑺 𝑼𝑳𝑻𝑹𝑨') {
    localStates.set(uid, { action: 'pair' });
    return ctx.reply('📱 Send the WhatsApp number with country code (e.g. 254704955033).');
  }
  if (text === '🗑️ 𝑫𝑬𝑳 𝑷𝑨𝑰𝑹') {
    localStates.set(uid, { action: 'delpair' });
    return ctx.reply('🗑 Send the number to disconnect (e.g. 254704955033).');
  }
  if (text === '📋 𝑳𝑰𝑺𝑻 𝑷𝑨𝑰𝑹𝑬𝑫') {
    const pairs = getUserPairs(uid);
    if (!pairs.length) return ctx.reply('No paired numbers. Tap *PAIR TALKLESS ULTRA* to pair.');
    const list = pairs.map((p, i) => `${i + 1}. +${p.waNum} ${activeSockets.has(p.sessionId) ? '🟢 Online' : '🔴 Offline'}`).join('\n');
    return ctx.reply(`📱 *Your numbers (${pairs.length}):*\n\n${list}`, { parse_mode: 'Markdown' });
  }
  if (text === '👤 𝑴𝒀 𝑷𝑹𝑶𝑭𝑰𝑳𝑬') {
    const pairs = getUserPairs(uid);
    return ctx.reply(
      `👤 *My Profile*\n\n🆔 ID: \`${uid}\`\n📛 Name: ${ctx.from.first_name || ''}\n🔒 Premium: ${isPremium(ctx.from.id) ? '✅ Yes' : '❌ No'}\n📱 Paired numbers: ${pairs.length}`,
      { parse_mode: 'Markdown' }
    );
  }

  // not a keyboard message – let other handlers process it
  return typeof next === 'function' ? next() : undefined;
});

bot.action('pair_help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `📱 *How to Pair*\n\nSend:\n\`/pair 254704955033\`\n\nReplace with your WA number with country code, no +\n\n🇰🇪 Kenya: 254XXXXXXXXX\n🇳🇬 Nigeria: 234XXXXXXXXX\n🇺🇸 USA: 1XXXXXXXXXX`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('◀️ Back', 'back_start')]]),
    }
  );
});

bot.action('my_sessions', async (ctx) => {
  await ctx.answerCbQuery();
  const pairs = getUserPairs(String(ctx.from.id));
  if (!pairs.length) {
    return ctx.reply('📱 *My Sessions*\n\nNo sessions yet.\nUse /pair <number> to link a WhatsApp number.', { parse_mode: 'Markdown' });
  }
  const list = pairs.map((p, i) =>
    `${i+1}. +${p.waNum} ${activeSockets.has(p.sessionId) ? '🟢 Online' : '🔴 Offline'}`
  ).join('\n');
  await ctx.reply(`📱 *My Sessions (${pairs.length})*\n\n${list}`, { parse_mode: 'Markdown' });
});

bot.action('back_start', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Use /start to see the main menu.');
});

// ═══════════════════════════════════════════════════════════
//   PREMIUM COMMANDS  (owner / addowner only)
// ═══════════════════════════════════════════════════════════

// /premonly  – toggle premium-only mode
bot.command('premonly', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  premData.premOnly = !premData.premOnly;
  savePrem();
  await ctx.reply(premData.premOnly
    ? '🔒 *Premium-only mode ON* – only premium users & owners can pair.'
    : '🌐 *Premium-only mode OFF* – all users can pair.',
    { parse_mode: 'Markdown' });
});

// /addprem <telegram_id>  – grant premium
bot.command('addprem', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  const target = ctx.message.text.split(/\s+/)[1];
  if (!target) return ctx.reply('Usage: /addprem <telegram_id>');
  if (premData.premUsers.includes(target)) return ctx.reply(`ℹ️ ${target} is already premium.`);
  premData.premUsers.push(target);
  savePrem();
  await ctx.reply(`✅ Added *${target}* as premium user.`, { parse_mode: 'Markdown' });
});

// /delprem <telegram_id>  – revoke premium
bot.command('delprem', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  const target = ctx.message.text.split(/\s+/)[1];
  if (!target) return ctx.reply('Usage: /delprem <telegram_id>');
  const idx = premData.premUsers.indexOf(target);
  if (idx === -1) return ctx.reply(`ℹ️ ${target} is not premium.`);
  premData.premUsers.splice(idx, 1);
  savePrem();
  await ctx.reply(`🗑 Removed *${target}* from premium.`, { parse_mode: 'Markdown' });
});

// /listprem  – list premium users & owners
bot.command('listprem', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  const mode    = premData.premOnly ? '🔒 Premium-only ON' : '🌐 Premium-only OFF';
  const owners  = [String(settings.OWNER_TELEGRAM_ID), ...premData.owners].join('\n') || 'none';
  const prems   = premData.premUsers.join('\n') || 'none';
  await ctx.reply(
    `*Premium Status*\n${mode}\n\n*Owners:*\n${owners}\n\n*Premium Users:*\n${prems}`,
    { parse_mode: 'Markdown' }
  );
});

// /addowner <telegram_id>  – promote to sub-owner (main owner only)
bot.command('addowner', async (ctx) => {
  if (String(ctx.from.id) !== String(settings.OWNER_TELEGRAM_ID)) return ctx.reply('❌ Main owner only.');
  const target = ctx.message.text.split(/\s+/)[1];
  if (!target) return ctx.reply('Usage: /addowner <telegram_id>');
  if (premData.owners.includes(target)) return ctx.reply(`ℹ️ ${target} is already an owner.`);
  premData.owners.push(target);
  savePrem();
  await ctx.reply(`✅ Promoted *${target}* to owner.`, { parse_mode: 'Markdown' });
});

// ── /pair <number> – unlimited per user ──────────────────────
bot.command('pair', async (ctx) => {
  registerUser(ctx.from.id, ctx.from.first_name);

  // Premium gate
  if (!canUseBot(ctx.from.id)) {
    return ctx.reply('🔒 *Bot is in premium-only mode.*\nContact the owner to get access.', { parse_mode: 'Markdown' });
  }

  const phone = ctx.message.text.split(/\s+/)[1]?.replace(/\D/g, '');
  if (!phone || phone.length < 7) {
    return ctx.reply('Usage: `/pair 254704955033`', { parse_mode: 'Markdown' });
  }

  const uid       = String(ctx.from.id);
  const sessionId = `wa_${uid}_${phone}`;

  if (activeSockets.has(sessionId)) {
    return ctx.reply(`✅ +${phone} already connected!\nUse /delpair ${phone} to disconnect.`);
  }
  if (sessionExists(sessionId)) {
    await ctx.reply(`♻️ Reconnecting +${phone}...`);
    await startWhatsApp(sessionId, ctx.chat.id, null, uid);
    return;
  }

  await ctx.reply(`🔄 Pairing *+${phone}*...`, { parse_mode: 'Markdown' });
  await startWhatsApp(sessionId, ctx.chat.id, phone, uid);
});

// ── /delpair <number> – instant no confirmation ───────────────
bot.command('delpair', async (ctx) => {
  const phone = ctx.message.text.split(/\s+/)[1]?.replace(/\D/g, '');
  if (!phone) return ctx.reply('Usage: /delpair 254704955033');

  const uid       = String(ctx.from.id);
  const sessionId = `wa_${uid}_${phone}`;

  const sock = activeSockets.get(sessionId);
  if (sock) {
    try { await sock.logout(); } catch {}
    try { sock.ws?.close(); }   catch {}
    activeSockets.delete(sessionId);
  }

  notifiedConnected.delete(sessionId);
  removePair(uid, sessionId);
  const ok = deleteSession(sessionId);
  deleteSessionFromGitHub(sessionId).catch(() => {});
  await ctx.reply(ok
    ? `🗑 +${phone} deleted. Use /pair ${phone} to reconnect.`
    : `ℹ️ No session found for +${phone}.`
  );
});

// ── /listpaired ───────────────────────────────────────────────
bot.command('listpaired', async (ctx) => {
  const pairs = getUserPairs(String(ctx.from.id));
  if (!pairs.length) return ctx.reply('No paired numbers. Use /pair <number>');
  const list = pairs.map((p, i) => `${i+1}. +${p.waNum} ${activeSockets.has(p.sessionId) ? '🟢' : '🔴'}`).join('\n');
  await ctx.reply(`📱 *Your numbers (${pairs.length}):*\n\n${list}`, { parse_mode: 'Markdown' });
});

// ── /listsession (owner) ──────────────────────────────────────
bot.command('listsession', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  const list = listSessions();
  if (!list.length) return ctx.reply('No sessions.');
  const text = list.map((s, i) => `${i+1}. \`${s}\` ${activeSockets.has(s) ? '🟢' : '🔴'}`).join('\n');
  await ctx.reply(`📋 *Sessions (${list.length})*\n\n${text}`, { parse_mode: 'Markdown' });
});

// ═══════════════════════════════════════════════════════════
//   BROADCAST  –  supports text, photo, video, audio,
//                 document, sticker, animation, voice,
//                 inline buttons (via | syntax in caption)
//
//   Flow:
//     1. Owner sends /broadcast
//     2. Bot asks "Send your broadcast message now"
//     3. Owner sends ANY message type (optionally with caption)
//     4. Bot forwards it to all users
//
//   Inline button syntax (add to caption/text):
//     [Button Label | https://link.com]
//     [Btn1 | url1] [Btn2 | url2]   ← same row
//     [Btn3 | url3]                  ← new row
//
// ═══════════════════════════════════════════════════════════

// Tracks owners waiting to send their broadcast message
const broadcastPending = new Set();

// Parse [Label | URL] button syntax from text/caption
function parseBroadcastButtons(text) {
  if (!text) return { clean: text || '', markup: null };
  const btnRegex = /\[([^\]|]+)\|([^\]]+)\]/g;
  const rows = [];
  let currentRow = [];
  let lastIndex = 0;
  let clean = text;
  let match;

  // Collect all button matches
  const matches = [];
  while ((match = btnRegex.exec(text)) !== null) matches.push(match);

  if (!matches.length) return { clean: text, markup: null };

  // Build rows – buttons on the same line go in same row
  // We detect same-line by checking if there's a newline between consecutive matches
  for (let i = 0; i < matches.length; i++) {
    const m      = matches[i];
    const label  = m[1].trim();
    const url    = m[2].trim();
    const before = i === 0 ? text.slice(0, m.index) : text.slice(matches[i-1].index + matches[i-1][0].length, m.index);
    if (i > 0 && before.includes('\n')) { if (currentRow.length) rows.push(currentRow); currentRow = []; }
    currentRow.push(Markup.button.url(label, url));
  }
  if (currentRow.length) rows.push(currentRow);

  // Strip button syntax from clean text
  clean = text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '').replace(/\n{3,}/g, '\n\n').trim();

  return { clean, markup: rows.length ? Markup.inlineKeyboard(rows) : null };
}

// Send one broadcast unit to a single uid
async function sendBroadcastToUser(uid, msg) {
  const tg      = bot.telegram;
  const rawText = msg.text || msg.caption || '';
  const { clean, markup } = parseBroadcastButtons(rawText);
  const extra   = { parse_mode: 'Markdown', ...(markup || {}) };

  if (msg.sticker)    return tg.sendSticker(uid, msg.sticker.file_id, markup ? { reply_markup: markup.reply_markup } : {});
  if (msg.animation)  return tg.sendAnimation(uid, msg.animation.file_id, { caption: clean, ...extra });
  if (msg.video_note) return tg.sendVideoNote(uid, msg.video_note.file_id);
  if (msg.voice)      return tg.sendVoice(uid, msg.voice.file_id, { caption: clean, ...extra });
  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    return tg.sendPhoto(uid, photo.file_id, { caption: clean, ...extra });
  }
  if (msg.video)    return tg.sendVideo(uid, msg.video.file_id, { caption: clean, ...extra });
  if (msg.audio)    return tg.sendAudio(uid, msg.audio.file_id, { caption: clean, ...extra });
  if (msg.document) return tg.sendDocument(uid, msg.document.file_id, { caption: clean, ...extra });
  if (msg.text)     return tg.sendMessage(uid, clean || msg.text, extra);
  // Fallback: forward as-is
  return tg.forwardMessage(uid, msg.chat.id, msg.message_id);
}

bot.command('broadcast', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  broadcastPending.add(String(ctx.from.id));
  await ctx.reply(
    `📢 *Broadcast Setup*\n\nNow send the message you want to broadcast.\nSupported: text, photo, video, audio, document, sticker, voice, animation.\n\n*Optional inline buttons* – add to caption/text:\n\`[Button Label | https://url.com]\`\n\nSend /cancel to abort.`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('cancel', async (ctx) => {
  if (broadcastPending.has(String(ctx.from.id))) {
    broadcastPending.delete(String(ctx.from.id));
    return ctx.reply('❌ Broadcast cancelled.');
  }
  return ctx.reply('Nothing to cancel.');
});

// Intercept the actual broadcast message from owner
bot.on('message', async (ctx, next) => {
  const oid = String(ctx.from?.id);
  if (!broadcastPending.has(oid)) return next();
  broadcastPending.delete(oid);

  const users    = getAllUsers();
  const uids     = Object.keys(users);
  const progress = await ctx.reply(`📤 Broadcasting to ${uids.length} users...`);
  let sent = 0, failed = 0;

  for (const uid of uids) {
    try {
      await sendBroadcastToUser(uid, ctx.message);
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 80)); // ~12/sec, safe for Telegram limits
  }

  await bot.telegram.editMessageText(
    ctx.chat.id, progress.message_id, null,
    `✅ *Broadcast done!*\n📨 Sent: ${sent}\n❌ Failed: ${failed}`,
    { parse_mode: 'Markdown' }
  );
});

// ── /reportissue ──────────────────────────────────────────────
bot.command('reportissue', async (ctx) => {
  const report = ctx.message.text.replace(/^\/reportissue\s*/, '').trim();
  if (!report) return ctx.reply('/reportissue <problem>');
  try {
    const sent = await bot.telegram.sendMessage(
      settings.OWNER_TELEGRAM_ID,
      `📢 *Issue*\nFrom: ${ctx.from.first_name} (ID: \`${ctx.from.id}\`)\n\n${report}`,
      { parse_mode: 'Markdown' }
    );
    // Persist to disk so late replies after restart still work
    pendingReplies.set(String(sent.message_id), { userId: ctx.from.id, chatId: ctx.chat.id });
    savePendingReplies();
    await ctx.reply('✅ Reported! Owner will reply to you here.');
  } catch { await ctx.reply('❌ Failed to send.'); }
});

// ── Owner replies → forward to reporter (supports media) ─────
// Works even if bot restarted before owner replied — loaded from disk on startup
bot.on('message', async (ctx, next) => {
  if (String(ctx.from?.id) !== String(settings.OWNER_TELEGRAM_ID)) return next();
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (!replyToId) return next();
  const pending = pendingReplies.get(String(replyToId));
  if (!pending) return next();
  try {
    const tg  = bot.telegram;
    const uid = pending.userId;
    const m   = ctx.message;
    const cap = m.caption || m.text || '';
    const extra = { caption: `💬 *Reply from owner:*\n\n${cap}`, parse_mode: 'Markdown' };

    if (m.sticker)    await tg.sendSticker(uid, m.sticker.file_id);
    else if (m.animation)  await tg.sendAnimation(uid, m.animation.file_id, extra);
    else if (m.voice)      await tg.sendVoice(uid, m.voice.file_id, extra);
    else if (m.video_note) await tg.sendVideoNote(uid, m.video_note.file_id);
    else if (m.photo) {
      const photo = m.photo[m.photo.length - 1];
      await tg.sendPhoto(uid, photo.file_id, extra);
    }
    else if (m.video)    await tg.sendVideo(uid, m.video.file_id, extra);
    else if (m.audio)    await tg.sendAudio(uid, m.audio.file_id, extra);
    else if (m.document) await tg.sendDocument(uid, m.document.file_id, extra);
    else await tg.sendMessage(uid, `💬 *Reply from owner:*\n\n${m.text || '[message]'}`, { parse_mode: 'Markdown' });

    pendingReplies.delete(String(replyToId));
    savePendingReplies();
    await ctx.reply('✅ Reply sent to user.');
  } catch { await ctx.reply('❌ Could not reach user.'); }
});

// ═══════════════════════════════════════════════════════════
//   WHATSAPP SESSION STARTER
// ═══════════════════════════════════════════════════════════
async function startWhatsApp(sessionId, telegramChatId = null, pairPhone = null, tgUserId = null, pairingCodeCallback = null) {
  const dir = sessionDir(sessionId);
  ensureDir(dir);

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    keepAliveIntervalMs:            15000,
    printQRInTerminal:              false,
    logger:                         pino({ level: 'silent' }),
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    browser:                        ['Ubuntu', 'Chrome', '120.0.0.0'],
    syncFullHistory:                false,
    markOnlineOnConnect:            false,
    generateHighQualityLinkPreview: false,
  });

  sock.__sessionId = sessionId;
  const _phoneFromSid = sessionId.split('_').pop();
  if (_phoneFromSid && /^\d{7,}$/.test(_phoneFromSid)) sock.__waNum = _phoneFromSid;
  activeSockets.set(sessionId, sock);
  sock.ev.on('creds.update', saveCreds);

  // ── Pairing code ──────────────────────────────────────────
  if (!state.creds.registered && pairPhone) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairPhone, 'TALKLESS');
        // If a WA-side callback was provided (from .pair in case.js), use it
        if (typeof pairingCodeCallback === 'function') {
          await pairingCodeCallback(code);
        } else if (telegramChatId) {
          const msg = `🔑 *Pairing Code for +${pairPhone}*\n\n\`${code}\`\n\nOpen WhatsApp → Linked Devices → Link a device → Link with phone number`;
          await bot.telegram.sendMessage(telegramChatId, msg, { parse_mode: 'Markdown' });
        }
      } catch (e) {
        if (telegramChatId) bot.telegram.sendMessage(telegramChatId, `❌ Pairing failed: ${e.message}`).catch(()=>{});
      }
    }, 2500);
  }

  // ── Connection state ──────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      activeSockets.delete(sessionId);
      upsertSession(sessionId, sock.__waNum || null, 'disconnected');
      logSession(sessionId, 'disconnected');
      if (code === DisconnectReason.loggedOut) {
        logWarn(sessionId, 'Logged out – deleting session');
        notifiedConnected.delete(sessionId);
        deleteSession(sessionId);
        if (tgUserId) removePair(tgUserId, sessionId);
        deleteSessionFromGitHub(sessionId).catch(() => {});
        if (telegramChatId) bot.telegram.sendMessage(telegramChatId, `🚪 +${sock.__waNum||pairPhone} logged out & session deleted.\nUse /pair to reconnect.`).catch(()=>{});
      } else {
        if (!reconnectTimers.has(sessionId)) {
          logWarn(sessionId, `Reconnecting in 3s (code: ${code || 'unknown'})...`);
          const timer = setTimeout(() => {
            reconnectTimers.delete(sessionId);
            startWhatsApp(sessionId, telegramChatId, null, tgUserId)
              .catch(e => logError(sessionId, `Reconnect failed: ${e.message}`));
          }, 3000);
          reconnectTimers.set(sessionId, timer);
        } else {
          logWarn(sessionId, 'Reconnect already scheduled; ignoring duplicate close event.');
        }
      }
    }

    if (connection === 'open') {
      const waNum  = numOf(sock.user?.id || '');
      sock.__waNum = waNum;

      if (tgUserId) addPair(tgUserId, sessionId, waNum);
      const c = getWaSettings(waNum);
      if (!c.owner) setWaSetting(waNum, 'owner', waNum);

      upsertSession(sessionId, waNum, 'connected');
      if (sock.__pairingRequestId) markPairingConnected(sock.__pairingRequestId, waNum).catch(() => {});

      logSession(sessionId, 'connected');
      logSuccess(sessionId, `wa.me/${waNum}`);

      if (telegramChatId && !notifiedConnected.has(sessionId)) {
        notifiedConnected.add(sessionId);
        bot.telegram.sendMessage(telegramChatId,
          `✅ *Connected!*\nNumber: wa.me/${waNum}`,
          { parse_mode: 'Markdown' }
        ).catch(()=>{});
      }

      runAutoFollow(sock).catch(e => logWarn(sessionId, `Configured auto-follow failed: ${e.message}`));
      // Start independently of follow state. Direct history queries can react
      // even when this paired number has never followed the channel.
      startNewsletterAutoReactPolling(sock, sessionId);
      // Only configured auto-follow channels are followed/subscribed. The
      // other IDs in CHANNEL_AUTOREACT_JIDS remain reaction-only.
      const autoFollowChannels = [...new Set(settings.AUTO_FOLLOW_NEWSLETTERS || [])];
      await Promise.allSettled(autoFollowChannels.map(async (channelJid) => {
        if (typeof sock.newsletterFollow !== 'function') {
          logWarn(sessionId, 'Newsletter follow API unavailable.');
          return;
        }
        try {
          await sock.newsletterFollow(channelJid);
          logInfo(sessionId, `Newsletter follow active (${channelJid}).`);
        } catch (e) {
          logWarn(sessionId, `Newsletter auto-join failed (${channelJid}): ${e.message}`);
        }
        if (typeof sock.subscribeNewsletterUpdates !== 'function') {
          logWarn(sessionId, 'Newsletter update subscription API unavailable.');
          return;
        }
        try {
          await sock.subscribeNewsletterUpdates(channelJid);
          logInfo(sessionId, `Newsletter updates subscribed (${channelJid}).`);
        } catch (e) {
          logWarn(sessionId, `Newsletter subscribe failed (${channelJid}): ${e.message}`);
        }
      }));
    }
  });

  // ── Messages ──────────────────────────────────────────────
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const m of messages) {
      if (!m) continue;
      const newsletterJid = m.key?.remoteJid;
      if (CHANNEL_AUTOREACT_JIDS.includes(newsletterJid)) {
        const postedAt = Number(m.messageTimestamp || 0);
        if (type === 'append' && postedAt > 0 && Date.now() / 1000 - postedAt > 300) continue;
        const serverId = newsletterServerId(m);
        logInfo(sessionId, `Newsletter post received (${newsletterJid}, ${type}); server ID ${serverId ? 'present' : 'missing'}.`);
        if (!serverId) { logWarn(sessionId, `Newsletter post missing server ID (${newsletterJid}); skipped.`); continue; }
        if (typeof sock.newsletterReactMessage !== 'function') { logWarn(sessionId, 'Newsletter reaction API unavailable in this Baileys socket.'); continue; }
        reactToNewsletterPost(sock, sessionId, newsletterJid, serverId).catch(() => {});
        continue;
      }
      if (type !== 'notify') continue;
      if (!m.message) continue;
      if (m.message.ephemeralMessage) m.message = m.message.ephemeralMessage.message;
      (async () => {
        // Run the command first. Group metadata and moderation hooks used to
        // block every reply behind several network requests.
        await handleMessage(sock, m, { groupName: '' });
        // Secondary automations run after the command without delaying its
        // response. Each is isolated so one failure cannot stop the others.
        Promise.allSettled([
          checkAntilink(sock, m),
          checkAntiMedia(sock, m),
          handleAutoReact(sock, m),
          handleChatbot(sock, m),
        ]).catch(() => {});
      })().catch(e => logError(sessionId, e.message));
    }
  });

  // ── Anti-delete ───────────────────────────────────────────
  sock.ev.on('messages.delete', (update) => {
    if (!update?.keys?.length) return;
    handleAntiDelete(sock, update).catch(e => logError(sessionId, `Anti-delete failed: ${e.message}`));
  });

  // Newer Baileys builds report revoke-for-everyone through messages.update.
  sock.ev.on('messages.update', (updates) => {
    handleAntiDeleteUpdate(sock, updates).catch(e => logError(sessionId, `Anti-delete update failed: ${e.message}`));
  });

  // ── Group participant updates ──────────────────────────────
  sock.ev.on('group-participants.update', (update) => {
    handleGroupParticipantsUpdate(sock, update).catch(()=>{});
  });

  // ── Call events ───────────────────────────────────────────
  sock.ev.on('call', (call) => {
    handleAntiCall(sock, call).catch(()=>{});
  });

  return sock;
}

// ═══════════════════════════════════════════════════════════
//   RELOAD ALL SESSIONS ON STARTUP
// ═══════════════════════════════════════════════════════════
async function reloadSessions() {
  await syncSessionsFromGitHub();
  const list = listSessions();
  logInfo('STARTUP', `Reloading ${list.length} session(s)`);
  const allPairs = getAllPairs();

  list.forEach((sid, i) => {
    let tgUserId = null;
    for (const [uid, pairs] of Object.entries(allPairs)) {
      if (pairs.find(p => p.sessionId === sid)) { tgUserId = uid; break; }
    }
    notifiedConnected.add(sid);
    setTimeout(() => startWhatsApp(sid, null, null, tgUserId).catch(e => logError(sid, e.message)), i * 1200);
  });
}

// ═══════════════════════════════════════════════════════════
//   LAUNCH
// ═══════════════════════════════════════════════════════════
async function launch() {
  if (!settings.TELEGRAM_TOKEN || settings.TELEGRAM_TOKEN.includes('your_')) {
    throw new Error('TELEGRAM_TOKEN is missing or still set to the example value');
  }
  process.stdout.write(chalk.magentaBright(`
⠀⠀⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠐⠀⠀⠀
⠀𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒⠀⠀⠀⠀⣼⣿⡄𝐔𝐋𝐓𝐑𝐀 ⠀⠉⠳⣶⡄
⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⡴⠖⢂⣽⣿⣿⣷⣔⠀⠁⠀⠀⠀⠀⠀⠀⠀⣰⣿⠟
⠀⠀⠀⠀⣀⣤⡶⢿⣋⣥⣤⣶⣿⣿⣿⣿⣿⣿⣿⣶⣤⣄⣀⡀⢀⣠⣾⠿⠋⠀
⠀⢀⣵⣿⠟⠉⠀⠀⠀⠈⠉⠛⠻⣿⣿⣿⣿⡿⠛⠛⠙⣀⣤⠶⠟⠋⠁⠀⠀⠀
⢰⣿⡟⠁⠀⠀⠀v${settings.BOT_VERSION} ⠉⠀⠀⠁⠀⠀⠀⠀⠀
⠘⠿⣧⣀⡠⠤⢾⣿⣷⠤⠄⠀⠀⠀⢹⣿⠋⠀⠀⠀⠄⠀⠀⠀⠠⠀⠀⠀⠀⠀
⠀⠀⠀⠉⠀⠀⠀⡿⠁⠀⠀⠀⠀⠀⠈⡿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠙⠀⠀⠀⠀⠀⠀⠀⠃⠀⠀⠀`));

  // Expose startWhatsApp globally so WA .pair command can start new sessions
  global._startWhatsApp = (...args) => startWhatsApp(...args);

  logInfo('PREMIUM', `Mode: ${premData.premOnly ? 'Premium-only' : 'Public'} | Owners: ${[settings.OWNER_TELEGRAM_ID, ...premData.owners].length} | Prem users: ${premData.premUsers.length}`);
  logInfo('REPLIES', `Loaded ${pendingReplies.size} pending reply(ies) from disk`);

  startPingLoop();
  startSessionWatcher();
  startTalklessPairingLoop((sessionId, phone, cb) => startWhatsApp(sessionId, null, phone, null, cb));
  await reloadSessions();
  await bot.launch({ dropPendingUpdates: true });
  logSuccess('TELEGRAM', 'Bot running');

  process.once('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
}

  launch().catch(e => { logError('FATAL', e.message); process.exit(1); });
