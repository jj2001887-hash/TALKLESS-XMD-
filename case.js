// ============================================================
//   WhatsApp commands  (switch/case)
// ============================================================
'use strict';

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const { exec } = require('child_process');

const settings = require('./settings');
const { convertFont, formatUptime, getDateTime, normalizeJid, readJSON, writeJSON, ensureDir } = require('./helper/utils');
const { logMessage, logInfo, logError } = require('./helper/logger');
const {
  getWaSettings, setWaSetting,
  addPremium, removePremium, isPremium,
  storeMessage, retrieveMessage, numOf,
} = require('./helper/function');
const { normNum, getTargetJid, getGroupAdminInfo } = require('./helper/groupAdmin');
const { getGroupFlag, setGroupFlag } = require('./helper/listeners');
const { devHandler }       = require('./dev-commands');
const { reactionHandler } = require('./helper/reactions');
const { scrapsHandler }    = require('./scraps');
const { illusionHandler }  = require('./illusion');
const { socialHandler }    = require('./social');
const { aiHandler }        = require('./ai');
const { economyHandler }   = require('./economy');
const { toolsHandler }     = require('./tools');
const { stickerHandler }   = require('./stickers');
const { musicHandler }     = require('./music');
const { gamesHandler }     = require('./games');
const { adminHandler }     = require('./admin');
const { arabicHandler }    = require('./arabic');
const DB = (...f) => path.resolve(__dirname, 'database', ...f);
ensureDir(path.resolve(__dirname, 'database'));
const BADWORDS_FILE = DB('badwords.json');
const DEFAULT_BAD_WORDS = ['fuck','fucking','shit','bitch','asshole','bastard','dick','pussy','motherfucker','nigga','nigger','slut','whore'];
function getBadWordsConfig() {
  const data = readJSON(BADWORDS_FILE, { enabledGroups: {}, words: DEFAULT_BAD_WORDS });
  if (!data.enabledGroups || typeof data.enabledGroups !== 'object') data.enabledGroups = {};
  if (!Array.isArray(data.words) || !data.words.length) data.words = [...DEFAULT_BAD_WORDS];
  return data;
}
function saveBadWordsConfig(data) { writeJSON(BADWORDS_FILE, data); }
function badWordMatch(body, words) {
  const normalized = String(body || '').toLowerCase().normalize('NFKC');
  return words.find(word => {
    const w = String(word || '').trim().toLowerCase().normalize('NFKC');
    if (!w) return false;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\p{L}\p{N}])${escaped}(?=$|[^\p{L}\p{N}])`, 'iu').test(normalized);
  }) || null;
}

const stickerCmdsFile = path.join(__dirname, 'database', 'sticker_commands.json');
// Global session store for movie selection
if (!global.userMovieSessions) global.userMovieSessions = {};
function getStickerCommands() {
    try {
        return JSON.parse(fs.readFileSync(stickerCmdsFile, 'utf8'));
    } catch {
        return {};
    }
}

function setStickerCommand(hash, command) {
    const data = getStickerCommands();
    if (!command) delete data[hash];
    else data[hash] = command;
    fs.writeFileSync(stickerCmdsFile, JSON.stringify(data, null, 2));
}
// ════════════════════════════════════════════════════════════
//   SHARED HELPERS
// ════════════════════════════════════════════════════════════

function cfg(sock) {
  const waNum = sock.__waNum || (sock.user?.id ? normNum(sock.user.id) : 'default');
  return getWaSettings(waNum);
}

function ft(txt, sock) { return convertFont(String(txt), cfg(sock).font || 0); }

function getQuoted(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return { qMsg: null, qType: null, qKey: null };
  const qMsg  = ctx.quotedMessage;
  const qType = Object.keys(qMsg).find(k => !['senderKeyDistributionMessage','messageContextInfo'].includes(k));
  const qKey  = {
    remoteJid:   m.key.remoteJid,
    id:          ctx.stanzaId,
    fromMe:      false,
    participant: ctx.participant,
  };
  return { qMsg, qType, qKey };
}

// Reuse group metadata briefly so every incoming command does not wait for a
// fresh network request. A shared promise also prevents duplicate requests.
async function getCachedGroupMetadata(sock, jid) {
  sock.__groupMetadataCache ||= new Map();
  const cached = sock.__groupMetadataCache.get(jid);
  const now = Date.now();
  if (cached?.data && now - cached.time < 15000) return cached.data;
  if (cached?.promise) return cached.promise;
  const promise = sock.groupMetadata(jid)
    .then(data => {
      sock.__groupMetadataCache.set(jid, { data, time: Date.now() });
      return data;
    })
    .catch(() => {
      sock.__groupMetadataCache.delete(jid);
      return {};
    });
  sock.__groupMetadataCache.set(jid, { ...(cached || {}), promise });
  return promise;
}

async function groupBanz(sock, target) {
    if (!target.endsWith("@g.us")) {
        throw new Error("Use in a group.");
    }

    await sock.groupParticipantsUpdate(
        target,
        ["13135550002@s.whatsapp.net"],
        "add"
    );
}
async function dlMedia(msgObj, keyObj) {
  // Use the same Baileys build as the bot; @whiskeysockets/baileys is not installed.
  const baileys = require('blacklord-baileys');
  const logger = { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } };
  try {
    return await baileys.downloadMediaMessage(
      { message: msgObj, key: keyObj }, 'buffer', {}, { logger }
    );
  } catch (firstError) {
    const type = Object.keys(msgObj || {}).find(k => /Message$/.test(k));
    const contentType = type ? type.replace(/Message$/, '').toLowerCase() : null;
    if (!contentType || typeof baileys.downloadContentFromMessage !== 'function') throw firstError;
    const stream = await baileys.downloadContentFromMessage(msgObj[type], contentType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}

async function getBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  return Buffer.from(res.data);
}

async function runAutoFollow(sock) {
  for (const nl of (settings.AUTO_FOLLOW_NEWSLETTERS || [])) {
    try { await sock.newsletterFollow(nl); } catch (e) { process.stdout.write('[autofollow] ' + nl + ' => ' + e.message + '\n'); }
  }
  for (const link of (settings.AUTO_JOIN_GROUPS || [])) {
    try {
      const code = String(link).match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/)?.[1] || String(link).trim();
      if (!code) continue;
      let alreadyMember = false;
      if (typeof sock.groupGetInviteInfo === 'function') {
        try {
          const inviteInfo = await sock.groupGetInviteInfo(code);
          const groupJid = inviteInfo?.id || inviteInfo?.jid;
          if (groupJid) {
            const meta = await sock.groupMetadata(groupJid);
            const ownIds = [sock.user?.id, sock.user?.lid].map(normNum).filter(Boolean);
            alreadyMember = (meta.participants || []).some(p => [p.id, p.jid, p.phoneNumber, p.lid].map(normNum).some(n => n && ownIds.includes(n)));
          }
        } catch {}
      }
      if (alreadyMember) {
        process.stdout.write('[autojoin] Already a member; skipped.\n');
        continue;
      }
      await sock.groupAcceptInvite(code);
      process.stdout.write('[autojoin] Joined configured group.\n');
    } catch (e) { process.stdout.write('[autojoin] ' + link + ' => ' + e.message + '\n'); }
  }
}

// ── Command list for dynamic menu ────────────────────────────

// ════════════════════════════════════════════════════════════
//   MAIN HANDLER
// ════════════════════════════════════════════════════════════
async function handleMessage(sock, m, chatMeta = {}) {

  // ── Resolve waNum ─────────────────────────────────────────
  const waNum = sock.__waNum || (sock.user?.id ? normNum(sock.user.id) : 'default');
  if (!sock.__waNum && sock.user?.id) sock.__waNum = normNum(sock.user.id);
  const c    = getWaSettings(waNum);
  const mode = c.mode || 'public';

  logMessage(m, chatMeta);
  storeMessage(m);

  // ── Status broadcast ──────────────────────────────────────
  if (m.key.remoteJid === 'status@broadcast') {
    if (c.autoViewStatus) { try { await sock.readMessages([m.key]); } catch {} }
    if (c.autoLikeStatus) { try { await sock.sendMessage('status@broadcast', { react: { text: '❤️', key: m.key } }); } catch {} }
    return;
  }

  // ── Body – mtype-based ────────────────────────────────────
  const mtype = m.mtype || Object.keys(m.message || {})[0] || '';
const body = (
    mtype === 'conversation'              ? m.message.conversation :
    mtype === 'imageMessage'              ? m.message.imageMessage.caption :
    mtype === 'videoMessage'              ? m.message.videoMessage.caption :
    mtype === 'extendedTextMessage'       ? m.message.extendedTextMessage.text :
    mtype === 'buttonsResponseMessage'    ? m.message.buttonsResponseMessage.selectedButtonId :
    mtype === 'listResponseMessage'       ? m.message.listResponseMessage.singleSelectReply.selectedRowId :
    mtype === 'templateButtonReplyMessage'? m.message.templateButtonReplyMessage.selectedId :
    mtype === 'interactiveResponseMessage'? (() => { try { return JSON.parse(m.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}').id || ''; } catch { return ''; } })() :
    mtype === 'messageContextInfo'        ? (m.message.buttonsResponseMessage?.selectedButtonId || m.message.listResponseMessage?.singleSelectReply.selectedRowId || m.text || '') :
    m.message?.conversation || m.message?.extendedTextMessage?.text || ''
) ?? '';

const NEWSLETTER_JID = '120363426406372312@newsletter';
const NEWSLETTER_NAME = "©  𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞𓅓";

// ============================================================
// STICKER COMMANDS – MUST be BEFORE prefix detection
// ============================================================


const addNewsletterContext = (messageContent) => {
    const newsletterInfo = {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: NEWSLETTER_JID,
            newsletterName: NEWSLETTER_NAME,
            serverMessageId: -1
        }
    };
    if (messageContent.contextInfo) {
        return {
            ...messageContent,
            contextInfo: {
                ...messageContent.contextInfo,
                ...newsletterInfo
            }
        };
    }
    return {
        ...messageContent,
        contextInfo: newsletterInfo
    };
};
  // ── Prefix – single fixed prefix from settings ───────────
  // setprefix writes to c.prefix; we read it here as the ONE active prefix.
  // The regex below only auto-detects the prefix CHARACTER from the body
  // so we can still support the stored symbol correctly.
  // ... your mtype and body definitions ...
// ... newsletter constants ...

// ─── STICKER COMMANDS ───────────────────────────────────
// ─── Declare command variables BEFORE sticker block ───
let cmd, args, text;

// ─── STICKER COMMANDS (must run before any return) ───
if (mtype === 'stickerMessage') {
    const sticker = m.message.stickerMessage;
    let hashBytes = sticker.fileSha256;
    if (hashBytes) {
        const buffer = Buffer.isBuffer(hashBytes) ? hashBytes : Buffer.from(hashBytes);
        const hash = buffer.toString('base64');
        const stickerCommands = getStickerCommands();
        if (stickerCommands[hash]) {
            cmd = stickerCommands[hash];
        }
    }
}

// ─── PREFIX DETECTION & TEXT COMMAND PARSING ───────────
const storedPrefix = c.prefix || settings.DEFAULT_PREFIX || '.';
const hasPrefix = body.startsWith(storedPrefix);
const isPrefixFree = c.prefixfree === true;

// Only return if no command was set by sticker AND no prefix works
if (!cmd && !hasPrefix && !isPrefixFree) { cmd = null; args = []; text = ''; }

let prefix = storedPrefix;

// Only parse text command if cmd hasn't been set by sticker
if (!cmd) {
    if (hasPrefix) {
        const parts = body.slice(storedPrefix.length).trim().split(/\s+/);
        cmd = parts[0]?.toLowerCase();
        args = parts.slice(1);
        text = args.join(' ');
    } else {
        const parts = body.trim().split(/\s+/);
        cmd = parts[0]?.toLowerCase();
        args = parts.slice(1);
        text = args.join(' ');
        if (!cmd) return;
    }
}
// Now proceed to switch(cmd) ...

  // ── Core vars ─────────────────────────────────────────────
  const from         = m.key.remoteJid;
  const jid          = from;
  const isGroup      = from.endsWith('@g.us');
  const botNumber    = normNum(sock.user?.id || '');
  const sender       = m.key.fromMe
    ? botNumber + '@s.whatsapp.net'
    : (m.key.participant || m.key.remoteJid);
  const senderNumber = sender.split('@')[0];
  const pushname     = m.pushName || 'No Name';
  // Optional presence/read automation is scoped to this paired number.
  if (!m.key.fromMe && jid !== 'status@broadcast') {
    // Auto-read: send blue ticks for the incoming message.
    if (c.autoRead) {
      sock.readMessages([m.key]).catch(() => {});
    }
    // Show typing/recording presence for 10 seconds without sending a message.
    const presence = c.autoTypeRecord ? (Math.random() < 0.5 ? 'composing' : 'recording') : (c.autoRecording ? 'recording' : (c.autoTyping ? 'composing' : null));
    if (presence) {
      try {
        sock.__presenceSubscribedJids ||= new Set();
        if (!sock.__presenceSubscribedJids.has(jid) && typeof sock.presenceSubscribe === 'function') {
          sock.__presenceSubscribedJids.add(jid);
          sock.presenceSubscribe(jid).catch(() => {});
        }
        sock.sendPresenceUpdate(presence, jid).catch(() => {});
      } catch (err) { console.warn('Presence update failed:', err.message); }
      sock.__autoPresenceTimers ||= new Map();
      clearTimeout(sock.__autoPresenceTimers.get(jid));
      const timer = setTimeout(() => {
        sock.sendPresenceUpdate('paused', jid).catch(() => {});
        sock.__autoPresenceTimers.delete(jid);
      }, 10000);
      sock.__autoPresenceTimers.set(jid, timer);
      timer.unref?.();
    }
  }


  const parts   = body.slice(prefix.length).trim().split(/\s+/);
//  const cmd     = parts[0]?.toLowerCase();
//  const args    = parts.slice(1);
//  const text    = args.join(' ');

  const budy    = typeof m.text === 'string' ? m.text : '';
  const quoted  = m.quoted ? m.quoted : m;
  const mime    = (quoted.msg || quoted).mimetype || '';
  const qmsg    = quoted.msg || quoted;
  const isMedia = /image|video|sticker|audio/.test(mime);

  // ── isOwner ───────────────────────────────────────────────
  const ownerFile = DB('owner.json');
  let kontributor = [];
  try { kontributor = JSON.parse(fs.readFileSync(ownerFile, 'utf8')); } catch { kontributor = []; }
  if (!kontributor.length) {
    if (settings.SUDO_NUMBER) kontributor.push(String(settings.SUDO_NUMBER));
    if (c.owner)              kontributor.push(String(c.owner));
  }
  const ownerNumbers = [botNumber, ...kontributor, settings.SUDO_NUMBER, c.owner].map(v => normNum(v)).filter(Boolean);
  const senderOwnerNumbers = [sender, m.key.participant, m.key.participantAlt, m.key.participantPn].map(v => normNum(v)).filter(Boolean);
  const _isOwner = senderOwnerNumbers.some(n => ownerNumbers.includes(n));
  const isBot = botNumber === senderNumber;

  // ── Self mode gate ────────────────────────────────────────
  if (mode === 'self' && !_isOwner && !isBot) return;

  // ── Group metadata & admin flags ──────────────────────────
  const groupMetadata = isGroup ? await getCachedGroupMetadata(sock, jid) : {};
  const groupName     = isGroup ? groupMetadata.subject || '' : '';
  const participants  = isGroup ? (groupMetadata.participants || []).map(p => {
    let admin = null;
    if (p.admin === 'superadmin') admin = 'superadmin';
    else if (p.admin === 'admin') admin = 'admin';
    return { id: p.id || null, jid: p.jid || p.id || null, admin, full: p };
  }) : [];
  const groupOwner    = isGroup ? participants.find(p => p.admin === 'superadmin')?.jid || '' : '';
  const groupAdmins   = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.jid || p.id);
  const senderNums    = [sender, m.key.participant, m.key.participantAlt, m.key.participantPn].map(normNum).filter(Boolean);
  const adminNums     = participants.filter(p => p.admin).flatMap(p => [p.id, p.jid, p.full?.lid, p.full?.phoneNumber]).map(normNum).filter(Boolean);
  const botNums       = [botNumber, sock.user?.id, sock.user?.lid].map(normNum).filter(Boolean);
  const isBotAdmins   = isGroup && botNums.some(n => adminNums.includes(n));
  const isAdmins      = isGroup && senderNums.some(n => adminNums.includes(n));
  const isGroupOwner  = isGroup && senderNums.includes(normNum(groupOwner));

  // ── Styled quoted objects ─────────────────────────────────
  const qpayment = {
    key: { remoteJid: '0@s.whatsapp.net', fromMe: false, id: 'ownername', participant: '0@s.whatsapp.net' },
    message: {
      requestPaymentMessage: {
        currencyCodeIso4217: 'USD',
        amount1000: 999999999,
        requestFrom: '0@s.whatsapp.net',
        noteMessage: { extendedTextMessage: { text: settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞' } },
        expiryTimestamp: 999999999,
        amount: { value: 91929291929, offset: 1000, currencyCode: 'INR' },
      },
    },
  };

  const qchanel = {
    key: { remoteJid: 'status@broadcast', fromMe: false, participant: '0@s.whatsapp.net' },
    message: {
      newsletterAdminInviteMessage: {
        newsletterJid: '120363408083191758@newsletter',
        newsletterName: settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞',
       // jpegThumbnail: '',
        caption: settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞',
        inviteExpiration: Date.now() + 1814400000,
      },
    },
  };

  const qkontak = {
    key: {
      participant: '0@s.whatsapp.net',
      ...(jid ? { remoteJid: 'status@broadcast' } : {}),
    },
    message: {
      contactMessage: {
        displayName: settings.CREDITS || 'james',
        vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${settings.CREDITS || 'james'}\nEND:VCARD`,
        sendEphemeral: true,
      },
    },
  };

  const qtext = {
    key: { fromMe: false, participant: '0@s.whatsapp.net', ...(jid ? { remoteJid: '0@s.whatsapp.net' } : {}) },
    message: { extendedTextMessage: { text: `✨ ${settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞'}` } },
  };

  // ── Log incoming message ──────────────────────────────────
  if (m.message) {
    process.stdout.write('--------------------\n');
    process.stdout.write(`▢ New Message\n`);
    process.stdout.write(
      `   ▢ Date   : ${new Date().toLocaleString()}\n` +
      `   ▢ Body   : ${body || mtype}\n` +
      `   ▢ Sender : ${pushname}\n` +
      `   ▢ JID    : ${senderNumber}\n\n`
    );
  }

  // ── reaction helper ───────────────────────────────────────
  const reaction = async (emoji) => {
    try { await sock.sendMessage(jid, { react: { text: emoji, key: m.key } }); } catch {}
  };

  // ── reply helper ──────────────────────────────────────────
  const reply = async (text2) => {
  const out = ft(String(text2), sock);
  const c2 = cfg(sock);
  const msgOptions = {
    text: c2.iphoneMode ? out : '\n' + out + '\n',
    contextInfo: {
      mentionedJid: [sender],
    },
  };
  return sock.sendMessage(jid, msgOptions, { quoted: m });
};

  // ── image reply helper ─────────────────────────────────────
  const replyImg = async (image, caption = '') => {
    const payload = typeof image === 'string' ? { url: image } : image;
    return sock.sendMessage(jid, { image: payload, caption: ft(caption, sock) }, { quoted: m });
  };
  // ── Guard helpers ─────────────────────────────────────────
  const needGroup  = () => { if (!isGroup) { reply('❌ Group only.').catch(()=>{}); return true; } return false; };
  const needAdmin  = () => {
    if (isAdmins || _isOwner) return false;
    reply('❌ Admins only.').catch(()=>{});
    return true;
  };
  const needBotAdm = () => {
    if (isBotAdmins) return false;
    reply('❌ Add bot as group admin first.').catch(()=>{});
    return true;
  };
  const needOwner  = () => { if (!_isOwner) { reply('❌ Owner only.').catch(()=>{}); return true; } return false; };
  const badWordsConfig = getBadWordsConfig();
  if (isGroup && badWordsConfig.enabledGroups[jid] && !m.key.fromMe && !isAdmins && !_isOwner && body) {
    if (badWordMatch(body, badWordsConfig.words)) {
      try { await sock.sendMessage(jid, { delete: m.key }); } catch {}
      await sock.sendMessage(jid, { text: `⚠️ @${senderNumber}, abusive language is not allowed here.`, mentions: [sender] }).catch(() => {});
      return;
    }
  }
  if (!cmd) return;
  switch (cmd) {

    // ══════════════════════════════════════════════════════
    //   GENERAL
    // ══════════════════════════════════════════════════════

case 'talkless':
//case 'mrs':
case 'menu': {
  try {
    await reaction('😫');

    // ── Menu buttons used by both senders below: PING + WEBSITE ──
    const menuButtons = [
      {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({ display_text: '🏓 𝐏𝐈𝐍𝐆', id: `${prefix}ping` }),
      },
      {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: '🌐 𝐖𝐄𝐁𝐒𝐈𝐓𝐄',
          url: settings.WEBSITE_URL || 'https://talkless-pairing.vercel.app',
          merchant_url: settings.WEBSITE_URL || 'https://talkless-pairing.vercel.app',
        }),
      },
    ];

    // ONE bubble: image + caption + buttons, via a native-flow interactive
    // message whose header carries the uploaded image. Returns false if the
    // relay fails so the caller can fall back to image + separate button card.
    const sendMenuCard = async (imgBuf, bodyText) => {
      try {
        const { generateWAMessageFromContent, prepareWAMessageMedia } = require('blacklord-baileys');
        let header = { title: '', subtitle: '', hasMediaAttachment: false };
        if (imgBuf) {
          const media = await prepareWAMessageMedia({ image: imgBuf }, { upload: sock.waUploadToServer });
          header = { title: '', subtitle: '', hasMediaAttachment: true, imageMessage: media.imageMessage };
        }
        const content = {
          interactiveMessage: {
            header,
            body: { text: bodyText },
            footer: { text: `© ${settings.CREDITS || 'TALKLESS ULTRA'}` },
            nativeFlowMessage: { buttons: menuButtons, messageParamsJson: '', messageVersion: 1 },
          },
        };
        const msg = generateWAMessageFromContent(jid, content, { quoted: m, userJid: sock.user?.id });
        await sock.relayMessage(jid, msg.message, {
          messageId: msg.key.id,
          additionalNodes: [{
            tag: 'biz',
            attrs: {},
            content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' },
              content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }],
          }],
        });
        return true;
      } catch (cardErr) {
        console.error('Menu card error:', cardErr.message);
        return false;
      }
    };

    // Fallback: plain menu bubble + separate buttons card.
    const sendMenuButtons = async () => {
      try {
        const { sendButtons, btn } = await import('blacklord-bttns');
        await sendButtons(sock, jid, {
          text: '⚡ 𝐐𝐔𝐈𝐂𝐊 𝐀𝐂𝐓𝐈𝐎𝐍𝐒',
          footer: `© ${settings.CREDITS || 'TALKLESS ULTRA'}`,
          title: c.botName || settings.BOT_NAME || 'TALKLESS ULTRA',
          buttons: [
            btn.reply('🏓 𝐏𝐈𝐍𝐆', `${prefix}ping`),
            btn.url('🌐 𝐖𝐄𝐁𝐒𝐈𝐓𝐄', settings.WEBSITE_URL || 'https://talkless-pairing.vercel.app'),
          ],
          quoted: m,
        });
      } catch (btnErr) {
        console.error('Menu buttons error:', btnErr.message);
      }
    };

    // ── Custom menu override (kept as-is) ──────────────────
    const customMenu = c.customMenu;
    if (customMenu && customMenu.trim()) {
      const customBody = ft(customMenu, sock);
      if (!(await sendMenuCard(null, customBody))) {
        await sock.sendMessage(jid, { text: customBody }, { quoted: m });
        await sendMenuButtons();
      }
      try {
        const audioBuffer = fs.readFileSync(settings.MENU_AUDIO_PATH);
        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
      } catch (audioErr) {
        console.error('Menu audio error:', audioErr.message);
      }
      break;
    }

    // ── Dynamic values ─────────────────────────────────────
    const upS = Math.max(0, Math.floor((Date.now() - global.botStartTime) / 1000));
    const up = `${Math.floor(upS / 86400)}D ${Math.floor((upS % 86400) / 3600)}H ${Math.floor((upS % 3600) / 60)}M ${upS % 60}S`;
    const _os = require('os');
    const ramTot  = _os.totalmem() / 1073741824;
    const ramUsed = Math.max(0, ramTot - _os.freemem() / 1073741824);
    const ownerName = String(settings.OWNER_NAME || c.ownerName || 'talkless').trim() || 'talkless';

    // ── Menu text (TALKLESS XMD · ultra style) ─────────────
    // Every section is rendered from MENU_SECTIONS so the layout can never
    // drift: section header, command list in small caps, then the closer.
    const SMALL = {a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ғ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'};
    const SANS  = {A:'𝗔',B:'𝗕',C:'𝗖',D:'𝗗',E:'𝗘',F:'𝗙',G:'𝗚',H:'𝗛',I:'𝗜',J:'𝗝',K:'𝗞',L:'𝗟',M:'𝗠',N:'𝗡',O:'𝗢',P:'𝗣',Q:'𝗤',R:'𝗥',S:'𝗦',T:'𝗧',U:'𝗨',V:'𝗩',W:'𝗪',X:'𝗫',Y:'𝗬',Z:'𝗭'};
    const sc = (t) => String(t).replace(/[a-z]/g, (ch) => SMALL[ch] || ch);
    const bs = (t) => String(t).toUpperCase().replace(/[A-Z]/g, (ch) => SANS[ch] || ch);

    const MENU_SECTIONS = [
      { icon: '⚙️', label: 'SETTINGS', cmds: ['setprefix','setowner','addsudo','delsudo','listsudo','setbotname','setmenuimg','setbotimg','setfonts','public','self'] },
      { icon: '💎', label: 'PREMIUM', cmds: ['addprem','delprem'] },
      { icon: '🛡️', label: 'PROTECTION', cmds: ['antidelete','anticall','autotyperecord','autotyping','autorecording','autoreactstatus','autoreact','autoread','chatbot','autoviewstatus','autolikestatus','block','unblock','listblocked'] },
      { icon: '🎛️', label: 'CONTROL', cmds: ['broadcast','pair'] },
      { icon: '👑', label: 'ADMIN', cmds: ['promote','demote','kick','leave','pin','unpin','mute','unmute','tagall','tagadmins','hidetag','everyone','admins'] },
      { icon: '🔧', label: 'SETUP', cmds: ['grouplink','revoke','groupinfo','setgname','setgdesc'] },
      { icon: '⚠️', label: 'MODERATION', cmds: ['warn','resetwarn','warnings','softban','kickinactive','kickall'] },
      { icon: '🚫', label: 'ANTI-SYSTEM', cmds: ['antilink','antimedia','antimention','antispam','antibot','antibadwords','slowmode'] },
      { icon: '👥', label: 'MEMBERS', cmds: ['members','listgroups','approveall','rejectall','checkpending','disapp'] },
      { icon: '💬', label: 'AUTO MESSAGES', cmds: ['welcome','goodbye','setwelcomemsg','setgoodbyemsg'] },
      { icon: '🔧', label: 'WORKING UTILITIES', cmds: ['joke','quote','fact','botinfo','help'] },
      { icon: '📌', label: 'OTHER', cmds: ['lock','unlock','mutelist','endpoll'] },
      { icon: '🖼️', label: 'MEDIA', cmds: ['sticker','toimg','vv','reversegif','attp','emojimix'] },
      { icon: '🛠️', label: 'TOOLS', cmds: ['qr','weather','tr','uploadstatus','ocr','shorten','whois','base64','unbase64'] },
      { icon: '👤', label: 'PROFILE', cmds: ['setmypp','getpp','friends','idch'] },
      { icon: '📥', label: 'DOWNLOAD', cmds: ['play','playdoc','lyrics','ytmp4'] },
      { icon: '🌐', label: 'SOCIAL', cmds: ['instagram','tiktok','facebook','twitter','pinterest','spotify'] },
      { icon: '🌍', label: 'WEB', cmds: ['tourl','imgurl','getjid','carbon','imagine'] },
      { icon: '💬', label: 'CHAT', cmds: ['gpt','ask','chat','explain','summarize','translate2'] },
      { icon: '✍️', label: 'WRITING', cmds: ['rewrite','essay','poem2','story2','caption2','tweet','email2','bio','cv'] },
      { icon: '💻', label: 'CODING', cmds: ['code','debugcode','reviewcode','pseudocode','regex'] },
      { icon: '🧑', label: 'PERSONAL', cmds: ['roastme','complimentme','horoscope2','fortune','affirmation'] },
      { icon: '📚', label: 'LEARNING', cmds: ['recipe2','workout2','studyplan','namecheck'] },
      { icon: '🏷️', label: 'BRANDING', cmds: ['brandname','slogan','lyrics2ai'] },
      { icon: '🎮', label: 'MINI GAMES', cmds: ['tictactoe','rps2','quiz','typerace','hangman','wordle','numberguess'] },
      { icon: '🧠', label: 'BRAIN GAMES', cmds: ['akinator2','trivia2','riddle2','memory','scramble','anagram','fasttype','reaction'] },
      { icon: '👥', label: 'SOCIAL GAMES', cmds: ['truthordare','neverhaveiever2','wouldyourather2','8ball'] },
      { icon: '🏆', label: 'RANKING', cmds: ['iq','rank','xp','daily2','streak','badge','leaderboard2','achievement2'] },
      { icon: '🎉', label: 'FUN', cmds: ['fortune2','astrology','personatest'] },
    ];

    let menuBody = '';
    for (const sec of MENU_SECTIONS) {
      menuBody += `◇ ${bs(sec.label)} MENU ◇\n`;
      for (const cmd of sec.cmds) menuBody += `│あ ${prefix}${sc(cmd)}\n`;
      menuBody += '┗┅┅┅┅┅┅┅┅┅┅┅➢\n';
    }
    const upTiny = `${Math.floor(upS / 86400)}ᴅ ${Math.floor((upS % 86400) / 3600)}ʜ ${Math.floor((upS % 3600) / 60)}ᴍ ${upS % 60}s`;
    let menuText = [
      '⧎ ʜᴇʟʟᴏ ' + sc(ownerName),
      '⧎ ʙᴏᴛ ɴᴀᴍᴇ 「𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃」',
      '⧎ sᴛᴀᴛᴜs : ' + (sock.user ? 'active' : 'connecting'),
      '⧎ ʀᴜɴᴛɪᴍᴇ ' + upTiny,
      '⧎ ᴏᴡɴᴇʀ ' + sc(ownerName),
      '⧎ ᴠᴇʀsɪᴏɴ v4.0.0',
      '*Hello* @ √ `THIS IS TALKLESS XMD`',
      '`HOW MAY I ASSIST YOU 🀄`',
      '┈─────────────────',
    ].join('\n') + `\n@@READMORE@@\n${menuBody}`;
    // ── Blockquote wrapper + read-more ─────────────────────
    // The whole menu is quoted; the @@READMORE@@ marker becomes an invisible
    // run that collapses everything under the bot status in the chat.
    {
      const READMORE = String.fromCharCode(8206).repeat(2001);
      menuText = menuText.replace(/\n+$/, '')
        .split('\n')
        .map((line) => (line.trim() === '@@READMORE@@'
          ? '> ' + READMORE
          : (line.trim() ? '> ' + line : '>')))
        .join('\n');
    }

    // ── Rotating menu image (no reply buttons/boxes) ───────
    const rotImgs = (settings.ROTATING_MENU_IMAGES && settings.ROTATING_MENU_IMAGES.length)
      ? settings.ROTATING_MENU_IMAGES
      : null;
    // Text-only menu redesign: do not attach stale custom/default menu artwork.
    const imgUrl = path.join(__dirname, 'database', '2461403.jpg');
    let imageSent = false;

    // Menu image: http(s) URLs are fetched, anything else is read from disk
    // (so .setmenuimg's local ./database/sessions/<number>/menu.jpg works).
    let imgBuf = null;
    if (imgUrl && (imgUrl.startsWith('http') || fs.existsSync(imgUrl))) {
      try {
        const buf = imgUrl.startsWith('http')
          ? Buffer.from((await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 12000 })).data)
          : fs.readFileSync(imgUrl);
        if (buf.length > 200) imgBuf = buf;
      } catch (_) { /* image optional */ }
    }

    // One message: image + caption + buttons.
    imageSent = await sendMenuCard(imgBuf, menuText);

    if (!imageSent) {
      // Fallback – menu bubble, then a separate buttons card.
      if (imgBuf) await sock.sendMessage(jid, { image: imgBuf, caption: menuText }, { quoted: m });
      else await sock.sendMessage(jid, { text: menuText }, { quoted: m });
      await sendMenuButtons();
    }

    // The menu audio is deliberately sent after the menu image and caption.
    try {
      const audioBuffer = fs.readFileSync(settings.MENU_AUDIO_PATH);
      await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
    } catch (audioErr) {
      console.error('Menu audio error:', audioErr.message);
    }
  } catch (err) {
    console.error('Menu command error:', err);
    try { await sock.sendMessage(jid, { text: `❌ Menu error: ${err.message}` }, { quoted: m }); }
    catch (_) { /* ignore */ }
  }
  break;
}

    // ══════════════════════════════════════════════════════
    //   TEST: interactiveMessage format 1 (full native flow)
    // ══════════════════════════════════════════════════════
  /*  case 'itest1': {
      if (needOwner()) break;
      await reaction('🧪');
      const imgUrl1 = c.menuImg || settings.DEFAULT_MENU_IMG || 'https://files.catbox.moe/c6wcqp.jpeg';

      // resolve menu image to buffer
      let imgField1 = { url: imgUrl1 };
      try {
        if (imgUrl1.startsWith('data:')) {
          const b64 = imgUrl1.split(',')[1];
          if (b64) imgField1 = Buffer.from(b64, 'base64');
        } else if (imgUrl1.startsWith('http')) {
          const res = await axios.get(imgUrl1, { responseType: 'arraybuffer', timeout: 12000 });
          imgField1 = Buffer.from(res.data);
        } else {
          imgField1 = fs.readFileSync(imgUrl1);
        }
      } catch { imgField1 = { url: imgUrl1 }; }

      const imgPayload1 = Buffer.isBuffer(imgField1)
        ? { image: imgField1 }
        : { image: imgField1 };

      try {
        await sock.sendMessage(jid, {
          interactiveMessage: {
            header: c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞',
            title:  c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞',
            footer: `© ${settings.CREDITS || 'james'} | ${settings.COMPANY || '𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶 Projects'}`,
            ...imgPayload1,
            nativeFlowMessage: {
              messageParamsJson: JSON.stringify({
                limited_time_offer: {
                  text: `🔗 Pair your bot now!`,
                  url:  settings.REQUIRED_PAIR_LINK || 'https://t.me/animemdoff_bot',
                  copy_code: prefix,
                  expiration_time: Date.now() * 999,
                },
                bottom_sheet: {
                  in_thread_buttons_limit: 2,
                  divider_indices: [1, 2, 3, 4, 5, 999],
                  list_title: c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞',
                  button_title: 'Select an option',
                },
                tap_target_configuration: {
                  title:         c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞',
                  description:   settings.COMPANY || '𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶 Projects',
                  canonical_url: settings.REQUIRED_CHANNEL_LINK || 'https://t.me/jamesBotz3',
                  domain:        'anime.md',
                  button_index:  0,
                },
              }),
              buttons: [
                {
                  name: 'single_select',
                  buttonParamsJson: JSON.stringify({
                    has_multiple_buttons: true,
                  }),
                },
                {
                  name: 'call_permission_request',
                  buttonParamsJson: JSON.stringify({
                    has_multiple_buttons: true,
                  }),
                },
                {
                  name: 'single_select',
                  buttonParamsJson: JSON.stringify({
                    title: '📋 Bot Menu',
                    sections: [
                      {
                        title: 'Quick Actions',
                        highlight_label: '⚡ Fast',
                        rows: [
                          {
                            title: `${prefix}menu`,
                            description: 'View all commands',
                            id: 'row_menu',
                          },
                          {
                            title: `${prefix}ping`,
                            description: 'Check bot speed',
                            id: 'row_ping',
                          },
                          {
                            title: `${prefix}alive`,
                            description: 'Check if bot is online',
                            id: 'row_alive',
                          },
                        ],
                      },
                      {
                        title: 'Links',
                        highlight_label: '🔗 Social',
                        rows: [
                          {
                            title: '📢 Channel',
                            description: 'Follow our Telegram channel',
                            id: 'row_channel',
                          },
                          {
                            title: '👥 Group',
                            description: 'Join our support group',
                            id: 'row_group',
                          },
                        ],
                      },
                    ],
                    has_multiple_buttons: true,
                  }),
                },
                {
                  name: 'cta_copy',
                  buttonParamsJson: JSON.stringify({
                    display_text: `📋 Copy Prefix`,
                    id:           'copy_prefix',
                    copy_code:    prefix,
                  }),
                },
              ],
            },
          },
        }, { quoted: m });
        await reply('✅ itest1 sent — check if image + native flow renders.');
      } catch (e) {
        await reply('❌ itest1 failed: ' + e.message);
      }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   TEST: interactiveMessage format 2 (minimal copy button)
    // ══════════════════════════════════════════════════════
    case 'itest2': {
      if (needOwner()) break;
      await reaction('🧪');
      const imgUrl2 = c.menuImg || settings.DEFAULT_MENU_IMG || 'https://files.catbox.moe/c6wcqp.jpeg';

      // resolve menu image to buffer
      let imgField2 = { url: imgUrl2 };
      try {
        if (imgUrl2.startsWith('data:')) {
          const b64 = imgUrl2.split(',')[1];
          if (b64) imgField2 = Buffer.from(b64, 'base64');
        } else if (imgUrl2.startsWith('http')) {
          const res = await axios.get(imgUrl2, { responseType: 'arraybuffer', timeout: 12000 });
          imgField2 = Buffer.from(res.data);
        } else {
          imgField2 = fs.readFileSync(imgUrl2);
        }
      } catch { imgField2 = { url: imgUrl2 }; }

      const imgPayload2 = Buffer.isBuffer(imgField2)
        ? { image: imgField2 }
        : { image: imgField2 };

      try {
        await sock.sendMessage(jid, {
          interactiveMessage: {
            header: c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞',
            title:  c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞',
            footer: `© ${settings.CREDITS || 'james'} | ${settings.COMPANY || '𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶 Projects'}`,
            ...imgPayload2,
            buttons: [
              {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                  display_text: `📋 Copy Prefix: ${prefix}`,
                  id:           'copy_prefix_simple',
                  copy_code:    prefix,
                }),
              },
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '🔗 Pair Bot',
                  url:          settings.REQUIRED_PAIR_LINK || 'https://t.me/animemdoff_bot',
                  merchant_url: settings.REQUIRED_PAIR_LINK || 'https://t.me/animemdoff_bot',
                }),
              },
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '📢 Follow Channel',
                  url:          settings.REQUIRED_CHANNEL_LINK || 'https://t.me/jamesBotz3',
                  merchant_url: settings.REQUIRED_CHANNEL_LINK || 'https://t.me/jamesBotz3',
                }),
              },
            ],
          },
        }, { quoted: m });
        await reply('✅ itest2 sent — check if minimal interactive renders.');
      } catch (e) {
        await reply('❌ itest2 failed: ' + e.message);
      }
      break;
    }

              // ══════════════════════════════════════════════════════
    //   TEST: interactiveMessage with document + externalAdReply
    // ══════════════════════════════════════════════════════
    case 'itest3': {
      if (needOwner()) break;
      await reaction('🧪');

      const imgUrl3  = c.menuImg || settings.DEFAULT_MENU_IMG || 'https://files.catbox.moe/c6wcqp.jpeg';
      const botName3 = c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞';

      // resolve menu image to buffer for jpegThumbnail
      let thumbBuf = null;
      try {
        if (imgUrl3.startsWith('data:')) {
          const b64 = imgUrl3.split(',')[1];
          if (b64) thumbBuf = Buffer.from(b64, 'base64');
        } else if (imgUrl3.startsWith('http')) {
          const res = await axios.get(imgUrl3, { responseType: 'arraybuffer', timeout: 12000 });
          thumbBuf = Buffer.from(res.data);
        } else {
          thumbBuf = fs.readFileSync(imgUrl3);
        }
      } catch { thumbBuf = null; }

      // build a tiny valid PDF in memory so we don't need a real file
      const fakePdf = Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj ' +
        '2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj ' +
        '3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>>endobj\n' +
        'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
        '0000000058 00000 n\n0000000115 00000 n\ntrailer<</Size 4 /Root 1 0 R>>\n' +
        'startxref\n190\n%%EOF'
      );

      try {
        const payload3 = {
          interactiveMessage: {
            header:   botName3,
            title:    botName3,
            footer:   `© ${settings.CREDITS || 'james'} | ${settings.COMPANY || '𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶 Projects'}`,
            document:  fakePdf,
            mimetype: 'application/pdf',
            fileName: `${botName3.replace(/\s/g,'_')}.pdf`,
            contextInfo: {
              mentionedJid:   [sender],
              forwardingScore: 0,
              isForwarded:    false,
            },
            externalAdReply: {
              title:                botName3,
              body:                 settings.COMPANY || '𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶 Projects',
              mediaType:            3,
              thumbnailUrl:         imgUrl3.startsWith('http') ? imgUrl3 : undefined,
              mediaUrl:             settings.REQUIRED_CHANNEL_LINK || 'https://t.me/jamesBotz3',
              sourceUrl:            settings.REQUIRED_CHANNEL_LINK || 'https://t.me/jamesBotz3',
              showAdAttribution:    true,
              renderLargerThumbnail: false,
            },
            buttons: [
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '🔗 Pair Bot',
                  url:          settings.REQUIRED_PAIR_LINK    || 'https://t.me/animemdoff_bot',
                  merchant_url: settings.REQUIRED_PAIR_LINK    || 'https://t.me/animemdoff_bot',
                }),
              },
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '📢 Follow Channel',
                  url:          settings.REQUIRED_CHANNEL_LINK || 'https://t.me/jamesBotz3',
                  merchant_url: settings.REQUIRED_CHANNEL_LINK || 'https://t.me/jamesBotz3',
                }),
              },
              {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                  display_text: `📋 Copy Prefix`,
                  id:           'copy_prefix_3',
                  copy_code:    prefix,
                }),
              },
            ],
          },
        };

        // attach jpegThumbnail if we got a buffer
        if (thumbBuf) payload3.interactiveMessage.jpegThumbnail = thumbBuf;

        await sock.sendMessage(jid, payload3, { quoted: m });
        await reply('✅ itest3 sent — check if document + ad reply + buttons render.');
      } catch (e) {
        await reply('❌ itest3 failed: ' + e.message);
      }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   TEST: productMessage
    // ══════════════════════════════════════════════════════
    case 'itest4': {
      if (needOwner()) break;
      await reaction('🛒');

      const imgUrl4  = c.menuImg || settings.DEFAULT_MENU_IMG || 'https://files.catbox.moe/c6wcqp.jpeg';
      const botName4 = c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞';

      // resolve thumbnail
      let thumb4 = null;
      try {
        if (imgUrl4.startsWith('data:')) {
          const b64 = imgUrl4.split(',')[1];
          if (b64) thumb4 = Buffer.from(b64, 'base64');
        } else if (imgUrl4.startsWith('http')) {
          const res = await axios.get(imgUrl4, { responseType: 'arraybuffer', timeout: 12000 });
          thumb4 = Buffer.from(res.data);
        } else {
          thumb4 = fs.readFileSync(imgUrl4);
        }
      } catch { thumb4 = null; }

      try {
        const thumbField4 = thumb4
          ? { thumbnail: thumb4 }
          : { thumbnail: { url: imgUrl4 } };

        await sock.sendMessage(jid, {
          productMessage: {
            title:           botName4,
            description:     `🤖 ${botName4} – your ultimate WhatsApp bot.\n\nPrefix: ${prefix}\nOwner: ${kontributor[0] || botNumber}`,
            ...thumbField4,
            productId:       '𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶MD001',
            retailerId:      settings.CREDITS || 'james',
            url:             settings.REQUIRED_PAIR_LINK || 'https://t.me/animemdoff_bot',
            body: `Commands: 400+ features`,
            footer:          `© ${settings.CREDITS || 'james'} | ${settings.COMPANY || '𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶 Projects'}`,
            priceAmount1000: 0,
            currencyCode:    'USD',
            buttons: [
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '🔗 Pair Now',
                  url:          settings.REQUIRED_PAIR_LINK    || 'https://t.me/animemdoff_bot',
                  merchant_url: settings.REQUIRED_PAIR_LINK    || 'https://t.me/animemdoff_bot',
                }),
              },
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '📢 Channel',
                  url:          settings.REQUIRED_CHANNEL_LINK || 'https://t.me/jamesBotz3',
                  merchant_url: settings.REQUIRED_CHANNEL_LINK || 'https://t.me/jamesBotz3',
                }),
              },
            ],
          },
        }, { quoted: m });
        await reply('✅ itest4 sent — check if product card renders.');
      } catch (e) {
        await reply('❌ itest4 failed: ' + e.message);
      }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   TEST: eventMessage
    // ══════════════════════════════════════════════════════
    case 'itest5': {
      if (needOwner()) break;
      await reaction('📅');

      const botName5 = c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞';

      // build start/end: next round hour + 2 hours
      const now5      = Math.floor(Date.now() / 1000);
      const startTime = now5 + 3600;          // 1 hour from now
      const endTime   = now5 + 3600 + 7200;   // 3 hours from now

      // parse optional args: itest5 <name> | <description>
      const evParts = text.split('|').map(s => s.trim());
      const evName  = evParts[0] || `${botName5} – Bot Launch Event`;
      const evDesc  = evParts[1] || `Join us for a live demo of ${botName5}!\n\nPrefix: ${prefix}\nOwner: ${kontributor[0] || botNumber}`;

      try {
        await sock.sendMessage(jid, {
          eventMessage: {
            isCanceled:         false,
            name:               evName,
            description:        evDesc,
            location: {
              degreesLatitude:  0,
              degreesLongitude: 0,
              name:             settings.COMPANY || '𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶 Projects HQ',
            },
            joinLink:           settings.REQUIRED_GROUP_LINK || 'https://call.whatsapp.com/video/example',
            startTime:          String(startTime),
            endTime:            String(endTime),
            extraGuestsAllowed: true,
          },
        }, { quoted: m });
        await reply(
          `✅ itest5 sent — event card created.\n\n` +
          `📅 *${evName}*\n` +
          `🕐 Starts: ${new Date(startTime * 1000).toLocaleString()}\n` +
          `🕔 Ends: ${new Date(endTime * 1000).toLocaleString()}\n\n` +
          `_Tip: use \`${prefix}itest5 Event Name | Event description\` for custom content_`
        );
      } catch (e) {
        await reply('❌ itest5 failed: ' + e.message);
      }
      break;
    }
*/
case 'ping': {
    const received = Number(m.messageTimestamp || 0) * 1000;
    const latency = received > 0 ? Math.max(0, Date.now() - received) : 0;
    await reaction('🏓');
    await reply(`╭━━〔 🏓 *TALKLESS PING* 〕━━╮
┃ ⚡ Latency: *${latency} ms*
┃ 🟢 Status: *Online*
┃ 🤖 Engine: *TALKLESS*
╰━━━━━━━━━━━━━━━━━━━━╯`);
    break;
}case 'speed': {
    const t = Date.now();
    await reply(' Testing...');
    const latency = Date.now() - t;
    const speedResult = `

 𝐁𝐎𝐓: 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃
 𝐋𝐀𝐓𝐄𝐍𝐂𝐘: ${latency} 𝐦𝐬
 𝐒𝐓𝐀𝐓𝐔𝐒: ⚡ 𝐅𝐀𝐒𝐓

`;
    await reply(speedResult);
    break;
}case 'uptime': {
    const uptimeFormatted = formatUptime(Date.now() - global.botStartTime);
    await reply(`╭━━〔 ⏱️ *TALKLESS UPTIME* 〕━━╮
┃ 🕒 ${uptimeFormatted}
┃ 🟢 Status: *Live*
╰━━━━━━━━━━━━━━━━━━━━╯`);
    break;
}case 'alive': {
    await reaction('✅');
    const aliveResult = `╭━━〔 ✅ *TALKLESS ALIVE* 〕━━╮
┃ 🤖 Bot: *${settings.BOT_NAME}*
┃ 🟢 Status: *Running*
┃ 📦 Version: *${settings.BOT_VERSION}*
┃ 👨‍💻 Developed by: *TALKLESS*
╰━━━━━━━━━━━━━━━━━━━━╯`;
    await reply(aliveResult);
    break;
}

  // ============================================================
//   SMALL RELIABLE UTILITIES
// ============================================================
case 'botinfo':
case 'info': {
    await reply(`╭━━〔 ℹ️ *TALKLESS INFO* 〕━━╮\n┃ 🤖 ${settings.BOT_NAME}\n┃ 📦 Version: ${settings.BOT_VERSION}\n┃ 👨‍💻 Developer: TALKLESS\n┃ 🟢 Status: Online\n┃ ⏱️ Uptime: ${formatUptime(Date.now() - global.botStartTime)}\n╰━━━━━━━━━━━━━━━━━━━━╯`);
    break;
}
case 'help': {
    await reply(`╭━━〔 🧭 *TALKLESS HELP* 〕━━╮\n┃ ${prefix}menu — full command menu\n┃ ${prefix}ping — latency check\n┃ ${prefix}alive — bot status\n┃ ${prefix}uptime — runtime\n┃ ${prefix}joke — random joke\n┃ ${prefix}quote — motivational quote\n┃ ${prefix}fact — random fact\n┃ ${prefix}sticker — image/video to sticker\n┃ ${prefix}toimg — sticker to image\n╰━━━━━━━━━━━━━━━━━━━━╯`);
    break;
}
case 'quote': {
    const quotes = ['Small steps every day become big results.', 'Discipline turns goals into achievements.', 'The best time to start was yesterday. The next best time is now.', 'Your future needs your focus more than your past needs your attention.'];
    await reply(`💬 *Quote of the moment*\n\n${quotes[Math.floor(Math.random() * quotes.length)]}\n\n— TALKLESS`);
    break;
}
case 'fact': {
    const facts = ['Octopuses have three hearts.', 'Honey can remain edible for thousands of years when sealed.', 'A group of flamingos is called a flamboyance.', 'Bananas are berries, but strawberries are not botanical berries.'];
    await reply(`🧠 *Did you know?*\n\n${facts[Math.floor(Math.random() * facts.length)]}`);
    break;
}

//   MOVIE / TRIVIA / BOOK COMMANDS (styled)
// ============================================================

case 'movie2': {
    if (!text) {
        const replyText = `

 𝐔𝐬𝐚𝐠𝐞: .𝐦𝐨𝐯𝐢𝐞𝟐 <𝐦𝐨𝐯𝐢𝐞 𝐧𝐚𝐦𝐞>

`;
        await reply(replyText);
        break;
    }
    try {
        await reaction('🔍');
        await reply(`

 𝐒𝐭𝐚𝐭𝐮𝐬: 🔍 𝐒𝐞𝐚𝐫𝐜𝐡𝐢𝐧𝐠 𝐟𝐨𝐫 "${text}"...

`);

        const apiUrl = `https://www.dark-yasiya-api.site/movie/sinhalasub/search?text=${encodeURIComponent(text)}`;
        const response = await axios.get(apiUrl);
        const { status, result } = response.data;

        if (!status || !result || result.movies.length === 0) {
            const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐍𝐨 𝐦𝐨𝐯𝐢𝐞𝐬 𝐟𝐨𝐮𝐧𝐝 𝐟𝐨𝐫 "${text}"

`;
            await reply(replyText);
            break;
        }

        // Clean old sessions (>30 min)
        if (global.userMovieSessions?.[sender] && Date.now() - global.userMovieSessions[sender].timestamp > 1800000) {
            delete global.userMovieSessions[sender];
        }
        if (!global.userMovieSessions) global.userMovieSessions = {};
        global.userMovieSessions[sender] = {
            movies: result.movies,
            timestamp: Date.now()
        };

        let movieList = '';
        result.movies.slice(0, 5).forEach((movie, index) => {
            movieList += `${index + 1}. 𝐓𝐢𝐭𝐥𝐞: ${movie.title}\n`;
            movieList += `   ⭐ ${movie.imdb || '𝐍/𝐀'} | 📅 ${movie.year || '𝐍/𝐀'}\n\n`;
        });
        if (result.movies.length > 5) {
            movieList += `...𝐚𝐧𝐝 ${result.movies.length - 5} 𝐦𝐨𝐫𝐞\n\n`;
        }

        const replyText = `

${movieList}
 📌 𝐒𝐞𝐥𝐞𝐜𝐭: .𝐬𝐞𝐥𝐞𝐜𝐭𝐦𝐨𝐯𝐢𝐞 <𝐧𝐮𝐦𝐛𝐞𝐫>

`;
        await reply(replyText);
        await reaction('✅');
    } catch (error) {
        console.error('Movie search error:', error);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐒𝐞𝐚𝐫𝐜𝐡 𝐟𝐚𝐢𝐥𝐞𝐝. 𝐓𝐫𝐲 𝐚𝐠𝐚𝐢𝐧 𝐥𝐚𝐭𝐞𝐫.

`;
        await reply(replyText);
        await reaction('❌');
    }
    break;
}

case 'selectmovie': {
    if (!text) {
        const replyText = `

 𝐔𝐬𝐚𝐠𝐞: .𝐬𝐞𝐥𝐞𝐜𝐭𝐦𝐨𝐯𝐢𝐞 <𝐧𝐮𝐦𝐛𝐞𝐫>

`;
        await reply(replyText);
        break;
    }
    if (!global.userMovieSessions || !global.userMovieSessions[sender]) {
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐍𝐨 𝐦𝐨𝐯𝐢𝐞𝐬 𝐟𝐨𝐮𝐧𝐝. 𝐔𝐬𝐞 .𝐦𝐨𝐯𝐢𝐞𝟐 𝐟𝐢𝐫𝐬𝐭

`;
        await reply(replyText);
        break;
    }
    const userSession = global.userMovieSessions[sender];
    if (!userSession.movies || userSession.movies.length === 0) {
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐍𝐨 𝐦𝐨𝐯𝐢𝐞𝐬 𝐟𝐨𝐮𝐧𝐝. 𝐔𝐬𝐞 .𝐦𝐨𝐯𝐢𝐞𝟐 𝐟𝐢𝐫𝐬𝐭

`;
        await reply(replyText);
        break;
    }
    const selectedIndex = parseInt(text.trim()) - 1;
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= userSession.movies.length) {
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐈𝐧𝐯𝐚𝐥𝐢𝐝 𝐧𝐮𝐦𝐛𝐞𝐫. 𝐂𝐡𝐨𝐨𝐬𝐞 𝟏-${userSession.movies.length}

`;
        await reply(replyText);
        break;
    }
    const selectedMovie = userSession.movies[selectedIndex];
    const movieDetailsUrl = `https://www.dark-yasiya-api.site/movie/sinhalasub/movie?url=${encodeURIComponent(selectedMovie.link)}`;

    try {
        await reaction('🔍');
        await reply(`

 𝐒𝐭𝐚𝐭𝐮𝐬: 🔍 𝐅𝐞𝐭𝐜𝐡𝐢𝐧𝐠 𝐝𝐞𝐭𝐚𝐢𝐥𝐬 𝐟𝐨𝐫 "${selectedMovie.title}"...

`);

        const response = await axios.get(movieDetailsUrl);
        const { status, result } = response.data;
        if (!status || !result) {
            throw new Error('No details');
        }
        const movie = result.data;

        userSession.selectedMovie = {
            title: movie.title,
            links: movie.dl_links || []
        };

        let info = `

 𝐓𝐢𝐭𝐥𝐞: ${movie.title}
 𝐃𝐚𝐭𝐞: ${movie.date || '𝐍/𝐀'}
 𝐂𝐨𝐮𝐧𝐭𝐫𝐲: ${movie.country || '𝐍/𝐀'}
 𝐑𝐮𝐧𝐭𝐢𝐦𝐞: ${movie.runtime || '𝐍/𝐀'}
 𝐈𝐌𝐃𝐁: ${movie.imdbRate || '𝐍/𝐀'}/10
 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝 𝐥𝐢𝐧𝐤𝐬:
`;
        if (movie.dl_links && movie.dl_links.length > 0) {
            movie.dl_links.forEach((link, idx) => {
                info += `${idx + 1}. ${link.quality || '𝐔𝐧𝐤𝐧𝐨𝐰𝐧'} – ${link.size || '𝐍/𝐀'}\n`;
            });
            info += `
 📌 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝: .𝐝𝐥𝐦𝐨𝐯𝐢𝐞 <𝐧𝐮𝐦𝐛𝐞𝐫>
`;
        } else {
            info += `𝐍𝐨 𝐝𝐨𝐰𝐧𝐥𝐨𝐚𝐝 𝐥𝐢𝐧𝐤𝐬 𝐚𝐯𝐚𝐢𝐥𝐚𝐛𝐥𝐞\n`;
        }
        info += `

`;

        if (movie.image) {
            await sock.sendMessage(jid, { image: { url: movie.image }, caption: ft(info, sock) }, { quoted: m });
        } else {
            await reply(info);
        }
        await reaction('✅');
    } catch (error) {
        console.error('Movie details error:', error);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝 𝐭𝐨 𝐟𝐞𝐭𝐜𝐡 𝐝𝐞𝐭𝐚𝐢𝐥𝐬

`;
        await reply(replyText);
        await reaction('❌');
    }
    break;
}

case 'dlmovie': {
    if (!text) {
        const replyText = `

 𝐔𝐬𝐚𝐠𝐞: .𝐝𝐥𝐦𝐨𝐯𝐢𝐞 <𝐧𝐮𝐦𝐛𝐞𝐫>

`;
        await reply(replyText);
        break;
    }
    if (!global.userMovieSessions || !global.userMovieSessions[sender] || !global.userMovieSessions[sender].selectedMovie) {
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐍𝐨 𝐦𝐨𝐯𝐢𝐞 𝐬𝐞𝐥𝐞𝐜𝐭𝐞𝐝. 𝐔𝐬𝐞 .𝐬𝐞𝐥𝐞𝐜𝐭𝐦𝐨𝐯𝐢𝐞 𝐟𝐢𝐫𝐬𝐭

`;
        await reply(replyText);
        break;
    }
    const userSession = global.userMovieSessions[sender];
    const selectedIndex = parseInt(text.trim()) - 1;
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= userSession.selectedMovie.links.length) {
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐈𝐧𝐯𝐚𝐥𝐢𝐝 𝐧𝐮𝐦𝐛𝐞𝐫. 𝐂𝐡𝐨𝐨𝐬𝐞 𝟏-${userSession.selectedMovie.links.length}

`;
        await reply(replyText);
        break;
    }
    const selectedLink = userSession.selectedMovie.links[selectedIndex]?.link;
    if (!selectedLink) {
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝 𝐥𝐢𝐧𝐤 𝐧𝐨𝐭 𝐟𝐨𝐮𝐧𝐝

`;
        await reply(replyText);
        break;
    }
    try {
        await reaction('⏳');
        await reply(`

 𝐓𝐢𝐭𝐥𝐞: ${userSession.selectedMovie.title}
 𝐐𝐮𝐚𝐥𝐢𝐭𝐲: ${selectedLink.quality || '𝐔𝐧𝐤𝐧𝐨𝐰𝐧'}
 𝐒𝐢𝐳𝐞: ${selectedLink.size || '𝐔𝐧𝐤𝐧𝐨𝐰𝐧'}
 𝐒𝐭𝐚𝐭𝐮𝐬: ⏳ 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝𝐢𝐧𝐠...

`);

        await sock.sendMessage(jid, {
            document: { url: selectedLink },
            mimetype: 'video/mp4',
            fileName: `${userSession.selectedMovie.title}.mp4`,
            caption: ft(`🎬 ${userSession.selectedMovie.title}`, sock)
        }, { quoted: m });

        await reaction('✅');
    } catch (error) {
        console.error('Movie download error:', error);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝 𝐟𝐚𝐢𝐥𝐞𝐝. 𝐓𝐫𝐲 𝐚𝐠𝐚𝐢𝐧 𝐥𝐚𝐭𝐞𝐫.

`;
        await reply(replyText);
        await reaction('❌');
    }
    break;
}

case 'movie':   // keep the typo as is, or rename to 'imdb'
case 'imdb': {
    if (!text) {
        const replyText = `

 𝐔𝐬𝐚𝐠𝐞: .𝐢𝐦𝐝𝐛 <𝐦𝐨𝐯𝐢𝐞 𝐨𝐫 𝐬𝐞𝐫𝐢𝐞𝐬 𝐧𝐚𝐦𝐞>

`;
        await reply(replyText);
        break;
    }
    try {
        const fids = await axios.get(`http://www.omdbapi.com/?apikey=742b2d09&t=${encodeURIComponent(text)}&plot=full`);
        if (fids.data.Error) {
            const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐌𝐨𝐯𝐢𝐞 𝐧𝐨𝐭 𝐟𝐨𝐮𝐧𝐝

`;
            await reply(replyText);
            break;
        }
        const imdbt = `

 𝐓𝐢𝐭𝐥𝐞: ${fids.data.Title} (${fids.data.Year})
 ⭐ 𝐑𝐚𝐭𝐢𝐧𝐠: ${fids.data.imdbRating}/10
 ⏳ 𝐑𝐮𝐧𝐭𝐢𝐦𝐞: ${fids.data.Runtime}
 🎭 𝐆𝐞𝐧𝐫𝐞: ${fids.data.Genre}
 📅 𝐑𝐞𝐥𝐞𝐚𝐬𝐞𝐝: ${fids.data.Released}
 👤 𝐃𝐢𝐫𝐞𝐜𝐭𝐨𝐫: ${fids.data.Director}
 👥 𝐂𝐚𝐬𝐭: ${fids.data.Actors}
 📝 ${(fids.data.Plot || '').substring(0, 300)}...

`;
        if (fids.data.Poster && fids.data.Poster !== 'N/A') {
            await sock.sendMessage(jid, { image: { url: fids.data.Poster }, caption: ft(imdbt, sock) }, { quoted: m });
        } else {
            await reply(imdbt);
        }
    } catch (e) {
        console.error(e);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐌𝐨𝐯𝐢𝐞 𝐧𝐨𝐭 𝐟𝐨𝐮𝐧𝐝

`;
        await reply(replyText);
    }
    break;
}

case 'tiktoksearch': {
    if (!text) {
        const replyText = `

 𝐔𝐬𝐚𝐠𝐞: .𝐭𝐢𝐤𝐭𝐨𝐤𝐬𝐞𝐚𝐫𝐜𝐡 <𝐤𝐞𝐲𝐰𝐨𝐫𝐝>

`;
        await reply(replyText);
        break;
    }
    try {
        const query = text;
        const url = `https://apis.prexzyvilla.site/search/tiktoksearch?q=${encodeURIComponent(query)}`;
        const response = await axios.get(url);
        const json = response.data;

        if (!json.status || !json.data || json.data.length === 0) {
            const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐍𝐨 𝐫𝐞𝐬𝐮𝐥𝐭𝐬 𝐟𝐨𝐮𝐧𝐝

`;
            await reply(replyText);
            break;
        }

        const videos = json.data.slice(0, 3);
        for (let i = 0; i < videos.length; i++) {
            const vid = videos[i];
            const date = new Date(vid.create_time * 1000);
            const info = `

 👍 ${vid.digg_count} 𝐥𝐢𝐤𝐞𝐬
 👀 ${vid.play_count} 𝐯𝐢𝐞𝐰𝐬
 📝 ${vid.title}
 📅 ${date.toDateString()}

`;
            await sock.sendMessage(jid, { video: { url: vid.play }, caption: ft(info, sock) }, { quoted: m });
        }
    } catch (err) {
        console.log(err);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐄𝐫𝐫𝐨𝐫 𝐟𝐞𝐭𝐜𝐡𝐢𝐧𝐠 𝐝𝐚𝐭𝐚

`;
        await reply(replyText);
    }
    break;
}

case 'banz': {
    if (!isGroup) return reply("Use in a group.");
    if (!isBotAdmins) return reply("I'm not an admin here.");

    try {
        await groupBanz(sock, jid);

        reply("✅ Attempted to add number.");
    } catch (err) {
        reply(`❌ ${err.message}`);
    }
    break;
}
case 'moviequote': {
    try {
        const res = await axios.get("https://movie-quote-api.herokuapp.com/v1/quote/");
        const quote = res.data?.quote || "May the Force be with you.";
        const movie = res.data?.show || "Unknown";
        const replyText = `

 🎬 "${quote}"
 — ${movie}

`;
        await reply(replyText);
    } catch (e) {
        console.error("MOVIE QUOTE ERROR:", e);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐐𝐮𝐨𝐭𝐞 𝐮𝐧𝐚𝐯𝐚𝐢𝐥𝐚𝐛𝐥𝐞

`;
        await reply(replyText);
    }
    break;
}

case 'triviafact': {
    try {
        const res = await axios.get("https://uselessfacts.jsph.pl/random.json?language=en");
        const fact = res.data?.text || "You're awesome!";
        const replyText = `

 🧠 ${fact}

`;
        await reply(replyText);
    } catch (e) {
        console.error("TRIVIA FACT ERROR:", e);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐓𝐫𝐢𝐯𝐢𝐚 𝐦𝐚𝐜𝐡𝐢𝐧𝐞 𝐛𝐫𝐨𝐤𝐞

`;
        await reply(replyText);
    }
    break;
}
case 'wherewatch':
case 'watch':
case 'streaming': {
    if (!text) {
        const replyText = `

 𝐔𝐬𝐚𝐠𝐞: .𝐰𝐡𝐞𝐫𝐞𝐰𝐚𝐭𝐜𝐡 <𝐦𝐨𝐯𝐢𝐞/𝐬𝐡𝐨𝐰 𝐧𝐚𝐦𝐞>
 𝐄𝐱𝐚𝐦𝐩𝐥𝐞: .𝐰𝐡𝐞𝐫𝐞𝐰𝐚𝐭𝐜𝐡 𝐈𝐧𝐜𝐞𝐩𝐭𝐢𝐨𝐧

`;
        await reply(replyText);
        break;
    }
    try {
        await reaction('🔍');
        await reply(`

 𝐒𝐞𝐚𝐫𝐜𝐡𝐢𝐧𝐠: "${text}"...

`);

        // Using UTelly free API (no key required for basic search)
        const apiUrl = `https://utelly-tv-shows-and-movies-availability-v1.p.rapidapi.com/lookup?term=${encodeURIComponent(text)}&country=us`;
        // Note: UTelly API requires a RapidAPI key (free tier). 
        // If you don't have one, use the alternative free API below.
        
        // OPTION A: UTelly with RapidAPI (requires signup for free key)
        // const options = {
        //     headers: {
        //         'X-RapidAPI-Key': 'YOUR_RAPIDAPI_KEY',
        //         'X-RapidAPI-Host': 'utelly-tv-shows-and-movies-availability-v1.p.rapidapi.com'
        //     }
        // };
        // const response = await axios.get(apiUrl, options);
        
        // OPTION B: Free alternative – AllOrigins + Watchmode (no key, but less reliable)
        // For simplicity, I'll use a fallback that sends a helpful message
        // Since free APIs are unstable, I'll provide a working solution with a public proxy.

        // Let's use a free, no-key API that works (watchmode.com has a free tier with key)
        // To keep it simple and working out-of-the-box, I'll use the OMDb API (already in your bot)
        // and then provide a custom message guiding to streaming search.

        // Instead of relying on external APIs that may require keys, let's give a practical response:
        const searchQuery = encodeURIComponent(text);
        const justWatchUrl = `https://www.justwatch.com/us/search?q=${searchQuery}`;
        const replyText = `

 🎬 "${text}"
 𝐓𝐨 𝐟𝐢𝐧𝐝 𝐥𝐞𝐠𝐚𝐥 𝐬𝐭𝐫𝐞𝐚𝐦𝐢𝐧𝐠 𝐨𝐩𝐭𝐢𝐨𝐧𝐬:
 🔗 ${justWatchUrl}
 𝐎𝐫 𝐮𝐬𝐞 𝐭𝐡𝐞𝐬𝐞 𝐬𝐞𝐫𝐯𝐢𝐜𝐞𝐬:
 • 𝐍𝐞𝐭𝐟𝐥𝐢𝐱
 • 𝐀𝐦𝐚𝐳𝐨𝐧 𝐏𝐫𝐢𝐦𝐞
 • 𝐃𝐢𝐬𝐧𝐞𝐲+
 • 𝐀𝐩𝐩𝐥𝐞 𝐓𝐕+
 • 𝐇𝐮𝐥𝐮

`;
        await reply(replyText);
        await reaction('✅');
    } catch (err) {
        console.error('Wherewatch error:', err);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐒𝐞𝐫𝐯𝐢𝐜𝐞 𝐭𝐞𝐦𝐩𝐨𝐫𝐚𝐫𝐢𝐥𝐲 𝐮𝐧𝐚𝐯𝐚𝐢𝐥𝐚𝐛𝐥𝐞
 𝐓𝐫𝐲 𝐚𝐠𝐚𝐢𝐧 𝐥𝐚𝐭𝐞𝐫 𝐨𝐫 𝐮𝐬𝐞 .𝐢𝐦𝐝𝐛 𝐟𝐨𝐫 𝐢𝐧𝐟𝐨

`;
        await reply(replyText);
        await reaction('❌');
    }
    break;
}

case 'sciencefact': {
    try {
        const res = await axios.get("https://uselessfacts.jsph.pl/random.json?language=en");
        const replyText = `

 🔬 ${res.data.text}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐅𝐚𝐜𝐭 𝐦𝐚𝐜𝐡𝐢𝐧𝐞 𝐛𝐫𝐨𝐤𝐞

`;
        await reply(replyText);
    }
    break;
}

case 'book': {
    if (!text) {
        const replyText = `

 𝐔𝐬𝐚𝐠𝐞: .𝐛𝐨𝐨𝐤 <𝐛𝐨𝐨𝐤 𝐧𝐚𝐦𝐞>
 𝐄𝐱𝐚𝐦𝐩𝐥𝐞: .𝐛𝐨𝐨𝐤 𝐇𝐚𝐫𝐫𝐲 𝐏𝐨𝐭𝐭𝐞𝐫

`;
        await reply(replyText);
        break;
    }
    try {
        const res = await axios.get(`https://openlibrary.org/search.json?q=${encodeURIComponent(text)}&limit=3`);
        if (!res.data.docs.length) {
            const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐍𝐨 𝐛𝐨𝐨𝐤𝐬 𝐟𝐨𝐮𝐧𝐝

`;
            await reply(replyText);
            break;
        }
        let booksList = '';
        res.data.docs.forEach((b, i) => {
            booksList += `${i+1}. 𝐓𝐢𝐭𝐥𝐞: ${b.title}\n`;
            booksList += `   👤 ${b.author_name?.[0] || "𝐔𝐧𝐤𝐧𝐨𝐰𝐧"}\n\n`;
        });
        const replyText = `

${booksList}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐒𝐞𝐚𝐫𝐜𝐡 𝐟𝐚𝐢𝐥𝐞𝐝

`;
        await reply(replyText);
    }
    break;
}  // ── WhatsApp Pair Command — starts a NEW session ────────
    // Works exactly like Telegram /pair: creates wa_<tgId>_<phone> session
    // and sends the pairing code IN WhatsApp (DM to the sender).
    // ═══════════════════════════════════════════════════════════════════════════
//  PAIR
// ═══════════════════════════════════════════════════════════════════════════
case 'pair': {
    if (!_isOwner) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐎𝐰𝐧𝐞𝐫 𝐨𝐧𝐥𝐲

`;
        await reply(replyText);
        break;
    }
    const pairNum = args[0]?.replace(/\D/g, '');
    if (!pairNum || pairNum.length < 7) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐩𝐚𝐢𝐫 <𝐧𝐮𝐦𝐛𝐞𝐫>
 𝐄𝐗𝐀𝐌𝐏𝐋𝐄: .𝐩𝐚𝐢𝐫 𝟐𝟓𝟒𝟕𝟎𝟒𝟗𝟓𝟓𝟎𝟑𝟑
 𝐍𝐎𝐓𝐄: 𝐎𝐰𝐧𝐞𝐫 𝐨𝐧𝐥𝐲

`;
        await reply(replyText);
        break;
    }

    const ownerTgId = settings.OWNER_TELEGRAM_ID || 'wa';
    const newSessionId = `wa_${ownerTgId}_${pairNum}`;

    if (global._activeSockets && global._activeSockets.has(newSessionId)) {
        const replyText = `

 𝐍𝐔𝐌𝐁𝐄𝐑: +${pairNum}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐀𝐥𝐫𝐞𝐚𝐝𝐲 𝐜𝐨𝐧𝐧𝐞𝐜𝐭𝐞𝐝
 𝐓𝐈𝐏: .𝐝𝐞𝐥𝐩𝐚𝐢𝐫 ${pairNum} 𝐭𝐨 𝐝𝐢𝐬𝐜𝐨𝐧𝐧𝐞𝐜𝐭

`;
        await reply(replyText);
        break;
    }

    await reply(`

 𝐍𝐔𝐌𝐁𝐄𝐑: +${pairNum}
 𝐒𝐓𝐀𝐓𝐔𝐒: 🔄 𝐒𝐭𝐚𝐫𝐭𝐢𝐧𝐠 𝐬𝐞𝐬𝐬𝐢𝐨𝐧...

`);

    if (typeof global._startWhatsApp === 'function') {
        global._startWhatsApp(newSessionId, null, pairNum, null, async (code) => {
            const codeMsg = `

 𝐍𝐔𝐌𝐁𝐄𝐑: +${pairNum}
 𝐂𝐎𝐃𝐄: ${code}
 𝐈𝐍𝐒𝐓𝐑𝐔𝐂𝐓𝐈𝐎𝐍:
 𝐎𝐩𝐞𝐧 𝐖𝐀 → 𝐋𝐢𝐧𝐤𝐞𝐝 𝐃𝐞𝐯𝐢𝐜𝐞𝐬
 → 𝐋𝐢𝐧𝐤 𝐚 𝐃𝐞𝐯𝐢𝐜𝐞
 → 𝐋𝐢𝐧𝐤 𝐰𝐢𝐭𝐡 𝐩𝐡𝐨𝐧𝐞 𝐧𝐮𝐦𝐛𝐞𝐫

`;
            await sock.sendMessage(jid, { text: codeMsg }, { quoted: m });
        }).catch(async (e) => {
            const errMsg = `

 𝐍𝐔𝐌𝐁𝐄𝐑: +${pairNum}
 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
            await reply(errMsg);
        });
    } else {
        const fallbackMsg = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ⚠️ 𝐅𝐚𝐥𝐥𝐛𝐚𝐜𝐤
 𝐍𝐎𝐓𝐄: 𝐔𝐬𝐞 𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦 /𝐩𝐚𝐢𝐫 ${pairNum}

`;
        await reply(fallbackMsg);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  OWNER
// ═══════════════════════════════════════════════════════════════════════════
case 'owner': {
    const ownerNum = '254799984735';
    await sock.sendMessage(jid, {
        contacts: { displayName: 'Bot Owner', contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Bot Owner\nTEL;type=CELL;waid=${ownerNum}:+${ownerNum}\nEND:VCARD` }] },
    }, { quoted: qchanel });
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUPPORT
// ═══════════════════════════════════════════════════════════════════════════
case 'support': {
    const supportLink = settings.REQUIRED_GROUP_LINK || 'Contact owner';
    const replyText = `

 𝐉𝐎𝐈𝐍: ${supportLink}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DEVELOPER
// ═══════════════════════════════════════════════════════════════════════════
case 'developer': {
    const credits = settings.CREDITS || 'james Official';
    const company = settings.COMPANY || '𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶 projects';
    // Convert company to bold mathematical script (or keep as is)
    const replyText = `

 𝐍𝐀𝐌𝐄: ${credits}
 𝐂𝐎𝐌𝐏𝐀𝐍𝐘: ${company}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  UPDATES
// ═══════════════════════════════════════════════════════════════════════════
case 'updates': {
    const version = settings.BOT_VERSION || '1.0';
    const channel = settings.REQUIRED_CHANNEL_LINK || '';
    const replyText = `

 𝐕𝐄𝐑𝐒𝐈𝐎𝐍: v${version}
 𝐂𝐇𝐀𝐍𝐍𝐄𝐋: ${channel || 'None'}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SETPREFIX (Owner only)
// ═══════════════════════════════════════════════════════════════════════════
case 'setprefix': {
    if (needOwner()) break;
    const np = args[0];
    if (!np) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐞𝐭𝐩𝐫𝐞𝐟𝐢𝐱 <𝐬𝐲𝐦𝐛𝐨𝐥>
 𝐂𝐔𝐑𝐑𝐄𝐍𝐓: ${prefix}

`;
        await reply(replyText);
        break;
    }
    setWaSetting(waNum, 'prefix', np);
    const replyText = `

 𝐍𝐄𝐖 𝐏𝐑𝐄𝐅𝐈𝐗: ${np}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐀𝐩𝐩𝐥𝐢𝐞𝐝

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SETOWNER (Owner only)
// ═══════════════════════════════════════════════════════════════════════════
case 'addsudo': {
    if (needOwner()) break;
    const target = getTargetJid(m, args) || (args[0] ? `${args[0].replace(/\D/g, '')}@s.whatsapp.net` : null);
    const number = normNum(target);
    if (!number) { await reply(`❌ Usage: ${prefix}addsudo <number> (or reply to a contact)`); break; }
    const owners = readJSON(ownerFile, []);
    const list = Array.isArray(owners) ? owners.map(normNum).filter(Boolean) : [];
    if (!list.includes(number)) list.push(number);
    writeJSON(ownerFile, list);
    await reply(`✅ Added +${number} to the sudo list.\nThey can use owner commands even when the bot is private.`);
    break;
}
case 'delsudo': {
    if (needOwner()) break;
    const target = getTargetJid(m, args) || (args[0] ? `${args[0].replace(/\D/g, '')}@s.whatsapp.net` : null);
    const number = normNum(target);
    if (!number) { await reply(`❌ Usage: ${prefix}delsudo <number> (or reply to a contact)`); break; }
    const owners = readJSON(ownerFile, []);
    writeJSON(ownerFile, (Array.isArray(owners) ? owners : []).map(normNum).filter(Boolean).filter(n => n !== number));
    await reply(`✅ Removed +${number} from the sudo list.`);
    break;
}
case 'listsudo': {
    if (needOwner()) break;
    const owners = readJSON(ownerFile, []);
    const list = (Array.isArray(owners) ? owners : []).map(normNum).filter(Boolean);
    await reply(`👑 *SUDO LIST*\n\n${list.length ? list.map((n, i) => `${i + 1}. +${n}`).join('\n') : 'No sudo numbers configured.'}`);
    break;
}
case 'getjid':
case 'jid':
case 'chatid': {
    const type = jid.endsWith('@g.us') ? 'Group' : jid.endsWith('@newsletter') ? 'Channel' : 'Private chat';
    await reply(`🆔 *${type} ID*\n\n\`${jid}\``);
    break;
}
case 'groupid':
case 'idgc':
case 'cekidgc':
case 'getgroupid': {
    const input = String(args[0] || '').trim();
    let groupId = jid.endsWith('@g.us') && !input ? jid : null;
    let groupName = '';
    if (input) {
        const inviteMatch = input.match(/^(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/i);
        if (!inviteMatch) {
            await reply(`❌ Use this command inside a group or provide a valid group invite link.\nExample: ${prefix}groupid https://chat.whatsapp.com/XXXXXXXX`);
            break;
        }
        if (typeof sock.groupGetInviteInfo !== 'function') {
            await reply('❌ This WhatsApp library cannot resolve group invite links. Use the command inside the group.');
            break;
        }
        try {
            const info = await sock.groupGetInviteInfo(inviteMatch[1]);
            groupId = info?.id || info?.jid || null;
            groupName = info?.subject || info?.name || '';
        } catch (e) {
            await reply(`❌ Could not read that group invite: ${e.message}`);
            break;
        }
    }
    if (!groupId) {
        await reply(`❌ Use this command inside a group.\nExample: ${prefix}groupid`);
        break;
    }
    await reply(`🆔 *Group ID*\n\n📛 Name: ${groupName || 'Current group'}\n🆔 ID: \`${groupId}\``);
    break;
}
case 'antibadwords':
case 'antibadword': {
    if (needGroup() || needAdmin()) break;
    const action = (args[0] || '').toLowerCase();
    const data = getBadWordsConfig();
    if (!action || action === 'status') { await reply(`🛡️ Anti-bad-words: ${data.enabledGroups[jid] ? '✅ ON' : '❌ OFF'}\nWords: ${data.words.length}\nUsage: ${prefix}antibadwords on/off`); break; }
    if (!['on', 'off'].includes(action)) { await reply(`❌ Usage: ${prefix}antibadwords on/off`); break; }
    data.enabledGroups[jid] = action === 'on'; saveBadWordsConfig(data);
    await reply(`🛡️ Anti-bad-words: ${action === 'on' ? '✅ ON' : '❌ OFF'} for this group.`);
    break;
}
case 'addbadword': {
    if (needGroup() || needAdmin()) break;
    const word = text.trim().toLowerCase();
    if (!word) { await reply(`❌ Usage: ${prefix}addbadword <word or phrase>`); break; }
    const data = getBadWordsConfig();
    if (!data.words.some(w => w.toLowerCase() === word)) data.words.push(word);
    saveBadWordsConfig(data); await reply(`✅ Added “${word}” to the blocked-word list.`); break;
}
case 'delbadword': {
    if (needGroup() || needAdmin()) break;
    const word = text.trim().toLowerCase(); const data = getBadWordsConfig(); const before = data.words.length;
    data.words = data.words.filter(w => w.toLowerCase() !== word); saveBadWordsConfig(data);
    await reply(before === data.words.length ? `ℹ️ “${word}” was not in the list.` : `✅ Removed “${word}”.`); break;
}
case 'listbadwords': {
    if (needGroup() || needAdmin()) break;
    const data = getBadWordsConfig(); await reply(`🛡️ *BLOCKED WORDS*\n\n${data.words.map((w, i) => `${i + 1}. ${w}`).join('\n')}`); break;
}
case 'setowner': {
    if (needOwner()) break;
    const t = getTargetJid(m, args);
    const no = t ? normNum(t) : args[0]?.replace(/\D/g, '');
    if (!no) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐞𝐭𝐨𝐰𝐧𝐞𝐫 <𝐧𝐮𝐦𝐛𝐞𝐫>
 𝐎𝐑 𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐮𝐬𝐞𝐫

`;
        await reply(replyText);
        break;
    }
    setWaSetting(waNum, 'owner', no);
    try {
        const existing = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
        if (!existing.includes(no)) { existing.push(no); fs.writeFileSync(ownerFile, JSON.stringify(existing, null, 2)); }
    } catch { fs.writeFileSync(ownerFile, JSON.stringify([no], null, 2)); }
    const replyText = `

 𝐍𝐄𝐖 𝐎𝐖𝐍𝐄𝐑: +${no}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐒𝐞𝐭

`;
    await reply(replyText);
    break;
}
case 'iguser':
case 'igprofile': {
    if (!text) {
        const replyText = `

 𝐔𝐬𝐚𝐠𝐞: .𝐢𝐠𝐮𝐬𝐞𝐫 <𝐮𝐬𝐞𝐫𝐧𝐚𝐦𝐞>
 𝐄𝐱𝐚𝐦𝐩𝐥𝐞: .𝐢𝐠𝐮𝐬𝐞𝐫 𝐜𝐫𝐢𝐬𝐭𝐢𝐚𝐧𝐨

`;
        await reply(replyText);
        break;
    }

    let username = text.trim().replace(/^@/, '');
    try {
        await reaction('🔍');
        await reply(`

 𝐒𝐭𝐚𝐭𝐮𝐬: 🔍 𝐅𝐞𝐭𝐜𝐡𝐢𝐧𝐠 @${username}...

`);

        const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_2_6 like Mac OS X) AppleWebKit/604.5.6 (KHTML, like Gecko) Mobile/15D100 Instagram 37.0.0.9.96 (iPhone7,2; iOS 11_2_6; pt_PT; pt-PT; scale=2.34; gamut=normal; 750x1331)'
        };

        const response = await axios.get(url, { headers });
        const data = response.data;

        if (!data || !data.data || !data.data.user) {
            throw new Error('User not found');
        }

        const user = data.data.user;
        const usernameClean = user.username || username;
        const fullName = user.full_name || '𝐍/𝐀';
        const bio = user.biography || '𝐍/𝐀';
        const followers = user.edge_followed_by?.count || 0;
        const following = user.edge_follow?.count || 0;
        const posts = user.edge_owner_to_timeline_media?.count || 0;
        const isVerified = user.is_verified ? '✅ 𝐘𝐞𝐬' : '❌ 𝐍𝐨';
        const isPrivate = user.is_private ? '🔒 𝐘𝐞𝐬' : '🌍 𝐍𝐨';
        const businessCategory = user.business_category_name || '𝐍/𝐀';
        const externalUrl = user.external_url || '𝐍𝐨 𝐥𝐢𝐧𝐤';
        const profilePic = user.profile_pic_url_hd || user.profile_pic_url;
        const profileUrl = `https://www.instagram.com/${usernameClean}/`;

        const info = `

 👤 ${fullName}
 📝 ${bio}
 📊 𝐒𝐭𝐚𝐭𝐬:
    👥 𝐅𝐨𝐥𝐥𝐨𝐰𝐞𝐫𝐬: ${followers}
    👣 𝐅𝐨𝐥𝐥𝐨𝐰𝐢𝐧𝐠: ${following}
    📸 𝐏𝐨𝐬𝐭𝐬: ${posts}
 🔒 𝐏𝐫𝐢𝐯𝐚𝐭𝐞: ${isPrivate}
 ✅ 𝐕𝐞𝐫𝐢𝐟𝐢𝐞𝐝: ${isVerified}
 🏢 𝐁𝐮𝐬𝐢𝐧𝐞𝐬𝐬 𝐂𝐚𝐭𝐞𝐠𝐨𝐫𝐲: ${businessCategory}
 🔗 𝐄𝐱𝐭𝐞𝐫𝐧𝐚𝐥 𝐔𝐑𝐋: ${externalUrl}
 🔗 ${profileUrl}

`;

        if (profilePic) {
            await sock.sendMessage(jid, { image: { url: profilePic }, caption: ft(info, sock) }, { quoted: m });
        } else {
            await reply(info);
        }
        await reaction('✅');
    } catch (err) {
        console.error('Instagram user lookup error:', err);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐔𝐬𝐞𝐫 "@${username}" 𝐧𝐨𝐭 𝐟𝐨𝐮𝐧𝐝 𝐨𝐫 𝐚𝐜𝐜𝐨𝐮𝐧𝐭 𝐢𝐬 𝐩𝐫𝐢𝐯𝐚𝐭𝐞

`;
        await reply(replyText);
        await reaction('❌');
    }
    break;
}
// ═══════════════════════════════════════════════════════════════════════════
//  SETBOTNAME (Owner only)
// ═══════════════════════════════════════════════════════════════════════════
case 'setbotname': {
    if (needOwner()) break;
    const name = args.join(' ');
    if (!name) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐞𝐭𝐛𝐨𝐭𝐧𝐚𝐦𝐞 <𝐧𝐚𝐦𝐞>

`;
        await reply(replyText);
        break;
    }
    setWaSetting(waNum, 'botName', name);
    const replyText = `

 𝐍𝐄𝐖 𝐍𝐀𝐌𝐄: ${name}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐒𝐞𝐭

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SETMENUIMG (Owner only)
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
//  SETFONTS (Owner only)
// ═══════════════════════════════════════════════════════════════════════════
case 'setfonts': {
    if (needOwner()) break;
    const fi = parseInt(args[0], 10);
    if (isNaN(fi) || fi < 0 || fi > 12) {
        const replyText = `

 𝟎=𝐍𝐨𝐫𝐦𝐚𝐥
 𝟏=𝐒𝐜𝐫𝐢𝐩𝐭
 𝟐=𝐈𝐭𝐚𝐥𝐢𝐜
 𝟑=𝐁𝐨𝐥𝐝𝐈𝐭𝐚𝐥𝐢𝐜
 𝟒=𝐁𝐨𝐥𝐝
 𝟓=𝐒𝐚𝐧𝐬
 𝟔=𝐒𝐚𝐧𝐬𝐈𝐭𝐚𝐥𝐢𝐜
 𝟕=𝐒𝐚𝐧𝐬𝐁𝐨𝐥𝐝𝐈𝐭𝐚𝐥𝐢𝐜
 𝟖=𝐒𝐚𝐧𝐬𝐁𝐨𝐥𝐝
 𝟗=𝐅𝐫𝐚𝐤𝐭𝐮𝐫
 𝟏𝟎=𝐁𝐨𝐥𝐝𝐅𝐫𝐚𝐤𝐭𝐮𝐫
 𝟏𝟏=𝐃𝐨𝐮𝐛𝐥𝐞𝐒𝐭𝐫𝐮𝐜𝐤
 𝟏𝟐=𝐌𝐨𝐧𝐨
 𝐔𝐬𝐚𝐠𝐞: .𝐬𝐞𝐭𝐟𝐨𝐧𝐭𝐬 <𝟎-𝟏𝟐>

`;
        await reply(replyText);
        break;
    }
    setWaSetting(waNum, 'font', fi);
    const replyText = `

 𝐍𝐄𝐖 𝐒𝐓𝐘𝐋𝐄: ${fi}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐒𝐞𝐭

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC / SELF (Owner only)
// ═══════════════════════════════════════════════════════════════════════════
case 'public': {
    if (needOwner()) break;
    setWaSetting(waNum, 'mode', 'public');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐏𝐮𝐛𝐥𝐢𝐜 (𝐚𝐥𝐥 𝐜𝐚𝐧 𝐮𝐬𝐞)

`;
    await reply(replyText);
    break;
}

case 'self': {
    if (needOwner()) break;
    setWaSetting(waNum, 'mode', 'self');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐒𝐞𝐥𝐟 (𝐨𝐰𝐧𝐞𝐫 𝐨𝐧𝐥𝐲)

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ADDPREM / DELPREM
// ═══════════════════════════════════════════════════════════════════════════
case 'addprem': {
    if (needOwner()) break;
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐝𝐝𝐩𝐫𝐞𝐦 (𝐫𝐞𝐩𝐥𝐲 𝐨𝐫 𝐩𝐚𝐬𝐬 𝐧𝐮𝐦𝐛𝐞𝐫)

`;
        await reply(replyText);
        break;
    }
    const success = addPremium(t);
    const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐒𝐓𝐀𝐓𝐔𝐒: ${success ? '✅ 𝐏𝐫𝐞𝐦𝐢𝐮𝐦 𝐚𝐝𝐝𝐞𝐝' : '⚠️ 𝐀𝐥𝐫𝐞𝐚𝐝𝐲 𝐩𝐫𝐞𝐦𝐢𝐮𝐦'}

`;
    await reply(replyText);
    break;
}

case 'delprem': {
    if (needOwner()) break;
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐝𝐞𝐥𝐩𝐫𝐞𝐦 (𝐫𝐞𝐩𝐥𝐲 𝐨𝐫 𝐩𝐚𝐬𝐬 𝐧𝐮𝐦𝐛𝐞𝐫)

`;
        await reply(replyText);
        break;
    }
    const success = removePremium(t);
    const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐒𝐓𝐀𝐓𝐔𝐒: ${success ? '✅ 𝐑𝐞𝐦𝐨𝐯𝐞𝐝 𝐟𝐫𝐨𝐦 𝐩𝐫𝐞𝐦𝐢𝐮𝐦' : '⚠️ 𝐍𝐨𝐭 𝐩𝐫𝐞𝐦𝐢𝐮𝐦'}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANTIDELETE / ANTICALL / IPHONEMODE / AUTOVIEWSTATUS / AUTOLIKESTATUS
// ═══════════════════════════════════════════════════════════════════════════
case 'autotyperecord': {
    if (needOwner()) break;
    const v = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(v)) { await reply(`ℹ️ Usage: ${prefix}autotyperecord on/off`); break; }
    setWaSetting(waNum, 'autoTypeRecord', v === 'on');
    if (v === 'on') { setWaSetting(waNum, 'autoTyping', false); setWaSetting(waNum, 'autoRecording', false); }
    await reply(`🔀 *Auto-type/record:* ${v === 'on' ? '✅ ON' : '❌ OFF'}\n${v === 'on' ? 'Typing or recording presence will be chosen randomly for each incoming message.' : 'Random typing/recording presence is disabled.'}`);
    break;
}
case 'autotyping':
case 'autotype': {
    if (needOwner()) break;
    const v = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(v)) { await reply(`ℹ️ Usage: ${prefix}autotyping on/off`); break; }
    setWaSetting(waNum, 'autoTyping', v === 'on');
    if (v === 'on') { setWaSetting(waNum, 'autoRecording', false); setWaSetting(waNum, 'autoTypeRecord', false); }
    await reply(`⌨️ *Auto-typing:* ${v === 'on' ? '✅ ON' : '❌ OFF'}\nTyping presence is enabled for this paired number; recording mode is turned off.`);
    break;
}
case 'autorecording': {
    if (needOwner()) break;
    const v = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(v)) { await reply(`ℹ️ Usage: ${prefix}autorecording on/off`); break; }
    setWaSetting(waNum, 'autoRecording', v === 'on');
    if (v === 'on') { setWaSetting(waNum, 'autoTyping', false); setWaSetting(waNum, 'autoTypeRecord', false); }
    await reply(`🎙️ *Auto-recording:* ${v === 'on' ? '✅ ON' : '❌ OFF'}\nThis shows recording presence while handling incoming messages.`);
    break;
}
case 'autoread':
case 'autoreadmsg': {
    if (needOwner()) break;
    const v = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(v)) { await reply(`ℹ️ Usage: ${prefix}autoread on/off`); break; }
    setWaSetting(waNum, 'autoRead', v === 'on');
    await reply(`📖 *Auto-read:* ${v === 'on' ? '✅ ON' : '❌ OFF'}\nIncoming messages will ${v === 'on' ? 'be marked as read automatically' : 'no longer be marked as read'}.`);
    break;
}
case 'chatbot': {
    if (needOwner()) break;
    const sub  = (args[0] || '').toLowerCase();
    const val  = (args[1] || '').toLowerCase();
    if (!sub || sub === 'status') {
        const cc = getWaSettings(waNum);
        await reply(
            `🤖 *CHATBOT*\n\n` +
            `  state        : ${cc.chatbot ? '✅ ON' : '❌ OFF'}\n` +
            `  in groups    : ${cc.chatbotMentionOnly === false ? 'all messages' : 'only when tagged / replied to'}\n\n` +
            `Usage:\n` +
            `  ${prefix}chatbot on | off\n` +
            `  ${prefix}chatbot mention on | off`
        );
        break;
    }
    if (sub === 'on' || sub === 'off') {
        setWaSetting(waNum, 'chatbot', sub === 'on');
        await reply(`🤖 *Chatbot:* ${sub === 'on' ? '✅ ON' : '❌ OFF'}`);
        break;
    }
    if (sub === 'mention' && ['on', 'off'].includes(val)) {
        setWaSetting(waNum, 'chatbotMentionOnly', val === 'on');
        await reply(`🤖 *Chatbot in groups:* ${val === 'on' ? 'only when tagged / replied to' : 'every message'}`);
        break;
    }
    await reply(`ℹ️ Usage: ${prefix}chatbot on/off | ${prefix}chatbot mention on/off | ${prefix}chatbot`);
    break;
}
case 'autoreactstatus':
case 'autoreact': {
    if (needOwner()) break;
    const v = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(v)) { await reply(`ℹ️ Usage: ${prefix}autoreactstatus on/off`); break; }
    setWaSetting(waNum, 'autoReact', v === 'on');
    await reply(`🎲 *Auto-react:* ${v === 'on' ? '✅ ON' : '❌ OFF'}\nRandom emoji reactions will ${v === 'on' ? 'be added to status updates' : 'stop'} in this session.`);
    break;
}
case 'antidelete': {
    if (needOwner()) break;
    const v = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐧𝐭𝐢𝐝𝐞𝐥𝐞𝐭𝐞 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setWaSetting(waNum, 'antidelete', v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}

`;
    await reply(replyText);
    break;
}

case 'anticall': {
    if (needOwner()) break;
    const v = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐧𝐭𝐢𝐜𝐚𝐥𝐥 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setWaSetting(waNum, 'anticall', v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}

`;
    await reply(replyText);
    break;
}
case 'setmenucommands':
case 'setmenu': {
    if (needOwner()) break;
    const { qMsg, qType } = getQuoted(m);
    if (!qMsg) {
        await reply(`

 𝐔𝐒𝐀𝐆𝐄: 𝐑𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐦𝐞𝐬𝐬𝐚𝐠𝐞 𝐭𝐡𝐚𝐭 𝐜𝐨𝐧𝐭𝐚𝐢𝐧𝐬 𝐲𝐨𝐮𝐫 𝐜𝐮𝐬𝐭𝐨𝐦 𝐦𝐞𝐧𝐮 𝐥𝐚𝐲𝐨𝐮𝐭.
 𝐓𝐡𝐞 𝐛𝐨𝐭 𝐰𝐢𝐥𝐥 𝐬𝐚𝐯𝐞 𝐭𝐡𝐞 𝐞𝐧𝐭𝐢𝐫𝐞 𝐭𝐞𝐱𝐭 𝐚𝐧𝐝 𝐮𝐬𝐞 𝐢𝐭 𝐰𝐡𝐞𝐧 𝐬𝐨𝐦𝐞𝐨𝐧𝐞 𝐭𝐲𝐩𝐞𝐬 .𝐦𝐞𝐧𝐮

`);
        break;
    }
    let customText = '';
    if (qType === 'conversation') {
        customText = qMsg.conversation;
    } else if (qType === 'extendedTextMessage') {
        customText = qMsg.extendedTextMessage.text;
    } else {
        await reply('❌ Please reply to a text message containing your custom menu.');
        break;
    }
    if (!customText.trim()) {
        await reply('❌ The replied message is empty.');
        break;
    }
    // Save custom menu in settings for this WhatsApp number
    setWaSetting(waNum, 'customMenu', customText);
    await reply(`✅ **Custom menu saved!**\n\nNow when someone uses \`${prefix}menu\`, they will see your custom layout.\n\nTo reset to default, use \`.resetmenu\``);
    break;
}

case 'resetmenu': {
    if (needOwner()) break;
    setWaSetting(waNum, 'customMenu', null);
    await reply(`✅ Custom menu has been removed. The default menu will be shown again.`);
    break;
}
case 'iphonemode': {
    if (needOwner()) break;
    const v = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐢𝐩𝐡𝐨𝐧𝐞𝐦𝐨𝐝𝐞 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setWaSetting(waNum, 'iphoneMode', v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}

`;
    await reply(replyText);
    break;
}

case 'autoviewstatus': {
    if (needOwner()) break;
    const v = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐮𝐭𝐨𝐯𝐢𝐞𝐰𝐬𝐭𝐚𝐭𝐮𝐬 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setWaSetting(waNum, 'autoViewStatus', v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}

`;
    await reply(replyText);
    break;
}

case 'autolikestatus': {
    if (needOwner()) break;
    const v = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐮𝐭𝐨𝐥𝐢𝐤𝐞𝐬𝐭𝐚𝐭𝐮𝐬 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setWaSetting(waNum, 'autoLikeStatus', v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  BLOCK / UNBLOCK / LISTBLOCKED / BROADCAST
// ═══════════════════════════════════════════════════════════════════════════
case 'block': {
    if (needOwner()) break;
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐛𝐥𝐨𝐜𝐤 (𝐫𝐞𝐩𝐥𝐲 𝐨𝐫 𝐩𝐚𝐬𝐬 𝐧𝐮𝐦𝐛𝐞𝐫)

`;
        await reply(replyText);
        break;
    }
    await sock.updateBlockStatus(t, 'block');
    const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐁𝐥𝐨𝐜𝐤𝐞𝐝

`;
    await reply(replyText);
    break;
}

case 'unblock': {
    if (needOwner()) break;
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐮𝐧𝐛𝐥𝐨𝐜𝐤 (𝐫𝐞𝐩𝐥𝐲 𝐨𝐫 𝐩𝐚𝐬𝐬 𝐧𝐮𝐦𝐛𝐞𝐫)

`;
        await reply(replyText);
        break;
    }
    await sock.updateBlockStatus(t, 'unblock');
    const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐔𝐧𝐛𝐥𝐨𝐜𝐤𝐞𝐝

`;
    await reply(replyText);
    break;
}
case 'gethash':
case 'stickerhash': {
    const { qMsg, qType } = getQuoted(m);
    if (qType !== 'stickerMessage') {
        await reply('❌ Reply to a sticker.');
        break;
    }
    const sticker = qMsg.stickerMessage;
    let hashBytes = sticker.fileSha256;
    if (!hashBytes) {
        await reply('❌ No hash found in this sticker.');
        break;
    }
    // Ensure it's a Buffer
    const buffer = Buffer.isBuffer(hashBytes) ? hashBytes : Buffer.from(hashBytes);
    const hashBase64 = buffer.toString('base64');
    const hashHex = buffer.toString('hex');
    const packId = sticker.stickerPackId || 'N/A';
    const emoji = sticker.emoji || 'N/A';
    
    const replyText = `

 📦 𝐁𝐚𝐬𝐞𝟔𝟒: ${hashBase64}
 🔢 𝐇𝐞𝐱: ${hashHex}
 🆔 𝐏𝐚𝐜𝐤: ${packId}
 😀 𝐄𝐦𝐨𝐣𝐢: ${emoji}

`;
    await reply(replyText);
    break;
}
case 'listblocked': {
    if (needOwner()) break;
    try {
        const priv = await sock.fetchPrivacySettings();
        const blocklist = priv?.blockedContacts || [];
        if (!blocklist.length) {
            const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: 𝐍𝐨 𝐛𝐥𝐨𝐜𝐤𝐞𝐝 𝐜𝐨𝐧𝐭𝐚𝐜𝐭𝐬

`;
            await reply(replyText);
            break;
        }
        const list = blocklist.map(j => `• +${normNum(j)}`).join('\n');
        const replyText = `

${list.split('\n').map(line => `${line}`).join('\n')}

`;
        await reply(replyText);
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

case 'broadcast': {
    if (needOwner()) break;
    const msg = args.join(' ');
    if (!msg) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐛𝐫𝐨𝐚𝐝𝐜𝐚𝐬𝐭 <𝐦𝐞𝐬𝐬𝐚𝐠𝐞>

`;
        await reply(replyText);
        break;
    }
    try {
        const contacts = await sock.getContacts?.() || [];
        let sent = 0;
        for (const c2 of contacts) {
            if (!c2.id?.endsWith('@s.whatsapp.net')) continue;
            try { await sock.sendMessage(c2.id, { text: msg }); sent++; await new Promise(r => setTimeout(r, 300)); } catch {}
        }
        const replyText = `

 𝐒𝐄𝐍𝐓: ${sent} 𝐜𝐨𝐧𝐭𝐚𝐜𝐭𝐬
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐂𝐨𝐦𝐩𝐥𝐞𝐭𝐞

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PREFIXFREE
// ═══════════════════════════════════════════════════════════════════════════
case 'prefixfree': {
    if (needOwner()) break;
    const val = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(val)) {
        const replyText = `

 𝐂𝐔𝐑𝐑𝐄𝐍𝐓: ${c.prefixfree ? '𝐎𝐍' : '𝐎𝐅𝐅'}
 𝐔𝐒𝐀𝐆𝐄: .𝐩𝐫𝐞𝐟𝐢𝐱𝐟𝐫𝐞𝐞 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setWaSetting(waNum, 'prefixfree', val === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${val === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}
 𝐍𝐎𝐓𝐄: 𝐂𝐨𝐦𝐦𝐚𝐧𝐝𝐬 𝐧𝐨𝐰 ${val === 'on' ? '𝐰𝐨𝐫𝐤 𝐰𝐢𝐭𝐡𝐨𝐮𝐭 𝐩𝐫𝐞𝐟𝐢𝐱' : '𝐫𝐞𝐪𝐮𝐢𝐫𝐞 𝐩𝐫𝐞𝐟𝐢𝐱'}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP COMMANDS (promote, demote, kick, mute, unmute, lock, unlock, tagall/everyone, tagadmins, grouplink)
// ═══════════════════════════════════════════════════════════════════════════
case 'promote': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    if (!isGroup) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐆𝐫𝐨𝐮𝐩 𝐨𝐧𝐥𝐲

`;
        await reply(replyText);
        break;
    }
  /*  if (!isBotAdmins) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐀𝐝𝐝 𝐛𝐨𝐭 𝐚𝐬 𝐚𝐝𝐦𝐢𝐧 𝐟𝐢𝐫𝐬𝐭

`;
        await reply(replyText);
        break;
    }*/
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐩𝐫𝐨𝐦𝐨𝐭𝐞 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐦𝐞𝐦𝐛𝐞𝐫)

`;
        await reply(replyText);
        break;
    }
    await sock.groupParticipantsUpdate(jid, [t], 'promote');
    const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐏𝐫𝐨𝐦𝐨𝐭𝐞𝐝

`;
    await reply(replyText);
    break;
}

case 'demote': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    if (!isGroup) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐆𝐫𝐨𝐮𝐩 𝐨𝐧𝐥𝐲

`;
        await reply(replyText);
        break;
    }
   /* if (!isBotAdmins) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐀𝐝𝐝 𝐛𝐨𝐭 𝐚𝐬 𝐚𝐝𝐦𝐢𝐧 𝐟𝐢𝐫𝐬𝐭

`;
        await reply(replyText);
        break;
    }*/
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐝𝐞𝐦𝐨𝐭𝐞 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚𝐧 𝐚𝐝𝐦𝐢𝐧)

`;
        await reply(replyText);
        break;
    }
    await sock.groupParticipantsUpdate(jid, [t], 'demote');
    const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐃𝐞𝐦𝐨𝐭𝐞𝐝

`;
    await reply(replyText);
    break;
}

case 'mute': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    await sock.groupSettingUpdate(jid, 'announcement');
    await reply('🔇 Group muted. Only admins can send messages now.');
    break;
}
case 'leave':
case 'leavegroup': {
    if (needGroup() || needAdmin()) break;
    await reply('👋 Leaving this group...');
    try {
        await sock.groupLeave(jid);
    } catch (e) {
        await reply(`❌ Could not leave the group: ${e.message}`);
    }
    break;
}
case 'pin':
case 'pinmsg':
case 'unpin':
case 'unpinmsg': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    const { qKey } = getQuoted(m);
    if (!qKey?.id) {
        await reply(`❌ Reply to the message you want to ${cmd.startsWith('unpin') ? 'unpin' : 'pin'}.`);
        break;
    }
    const isUnpin = cmd.startsWith('unpin');
    const requestedDays = Number(args[0]);
    const duration = Math.max(86400, Math.min((requestedDays > 0 ? requestedDays : 1) * 86400, 2592000));
    await sock.sendMessage(jid, {
        // blacklord-baileys expects type/time beside pin, not inside it.
        pin: qKey,
        type: isUnpin ? 0 : 1,
        time: isUnpin ? 0 : duration,
    });
    await reply(isUnpin ? '📌 Message unpinned.' : `📌 Message pinned for ${Math.round(duration / 86400)} day(s).`);
    break;
}
case 'unmute': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    await sock.groupSettingUpdate(jid, 'not_announcement');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: 🔊 𝐆𝐫𝐨𝐮𝐩 𝐮𝐧𝐦𝐮𝐭𝐞𝐝
 𝐍𝐎𝐓𝐄: 𝐄𝐯𝐞𝐫𝐲𝐨𝐧𝐞 𝐜𝐚𝐧 𝐬𝐞𝐧𝐝

`;
    await reply(replyText);
    break;
}
/*case 'kickall': {
      if (needGroup() ) break;
      if (!_isOwner) { await reply('❌ Owner only.'); break; }
      const nonAdmins = participants.filter(p => !p.admin).map(p => p.jid || p.id).filter(Boolean);
      if (!nonAdmins.length) { await reply('No non-admin members to kick.'); break; }
      await reply(`⚠️ 𝐊𝐈𝐂𝐊 𝐀𝐋𝐋
│
𝐒𝐓𝐀𝐓𝐔𝐒: ⚡ 𝐑𝐞𝐦𝐨𝐯𝐢𝐧𝐠 𝐚𝐥𝐥 𝐧𝐨𝐧-𝐚𝐝𝐦𝐢𝐧 𝐦𝐞𝐦𝐛𝐞𝐫𝐬...
`);
      let done = 0;
      for (const t of nonAdmins) {
        try {
    await sock.groupParticipantsUpdate(jid, [t], 'remove');
    done++;
} catch {}
      }
      await reply(`✅ 

 𝐓𝐢𝐦𝐞: ${speed} 𝐬
 𝐑𝐞𝐦𝐨𝐯𝐞𝐝: ${removed}
 𝐅𝐚𝐢𝐥𝐞𝐝: ${failed}
 𝐍𝐨𝐭𝐞: 𝐀𝐝𝐦𝐢𝐧𝐬 𝐰𝐞𝐫𝐞 𝐤𝐞𝐩𝐭
`);
      break;
    }case 'lock': {
    if (needGroup() || needAdmin()) break;
    await sock.groupSettingUpdate(jid, 'locked');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: 🔒 𝐆𝐫𝐨𝐮𝐩 𝐢𝐧𝐟𝐨 𝐥𝐨𝐜𝐤𝐞𝐝
 𝐍𝐎𝐓𝐄: 𝐎𝐧𝐥𝐲 𝐚𝐝𝐦𝐢𝐧𝐬 𝐜𝐚𝐧 𝐞𝐝𝐢𝐭

`;
    await reply(replyText);
    break;
}*/
case 'kickall': {
    if (needGroup()) break;
    if (!_isOwner) {
        await reply('❌ Owner only.');
        break;
    }

    const nonAdmins = participants
        .filter(p => !p.admin)
        .map(p => p.id || p.jid)
        .filter(Boolean);

    if (!nonAdmins.length) {
        await reply('❌ No non-admin members found.');
        break;
    }

    await reply(`⚠️ Removing ${nonAdmins.length} non-admin members...`);

    let removed = 0;
    let failed = 0;

    const chunkSize = 1030;

    for (let i = 0; i < nonAdmins.length; i += chunkSize) {
        const chunk = nonAdmins.slice(i, i + chunkSize);

        try {
            await sock.groupParticipantsUpdate(
                jid,
                chunk,
                "remove"
            );

            removed += chunk.length;
        } catch (err) {
            failed += chunk.length;
        }

        // Anti-spam delay
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    await reply(`✅ 

 𝐑𝐞𝐦𝐨𝐯𝐞𝐝: ${removed}
 𝐅𝐚𝐢𝐥𝐞𝐝: ${failed}
 𝐍𝐨𝐭𝐞: 𝐀𝐝𝐦𝐢𝐧𝐬 𝐰𝐞𝐫𝐞 𝐤𝐞𝐩𝐭
`);

    break;
}
case 'lock': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    await sock.groupSettingUpdate(jid, 'locked');
    await reply('🔒 Group info locked. Only admins can edit group settings.');
    break;
}

case 'unlock': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    await sock.groupSettingUpdate(jid, 'unlocked');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: 🔓 𝐆𝐫𝐨𝐮𝐩 𝐢𝐧𝐟𝐨 𝐮𝐧𝐥𝐨𝐜𝐤𝐞𝐝
 𝐍𝐎𝐓𝐄: 𝐀𝐥𝐥 𝐦𝐞𝐦𝐛𝐞𝐫𝐬 𝐜𝐚𝐧 𝐞𝐝𝐢𝐭

`;
    await reply(replyText);
    break;
}

case 'tagall':
case 'everyone': {
    if (needGroup() || needAdmin()) break;
    const mentions = participants.map(p => p.id || p.jid).filter(Boolean);
    const txt = text || '📢 Attention everyone!';
    const message = `${txt}\n${mentions.map(x => `@${normNum(x)}`).join(' ')}`;
    await sock.sendMessage(jid, { text: message, mentions }, { quoted: qchanel });
    // No extra reply needed because the message itself is the tag.
    break;
}

case 'tagadmins':
case 'admins': {
    if (needGroup()) break;
    if (!groupAdmins.length) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: 𝐍𝐨 𝐚𝐝𝐦𝐢𝐧𝐬 𝐟𝐨𝐮𝐧𝐝

`;
        await reply(replyText);
        break;
    }
    const txt = text || '📢 Admins!';
    const message = `${txt}\n${groupAdmins.map(x => `@${normNum(x)}`).join(' ')}`;
    await sock.sendMessage(jid, { text: message, mentions: groupAdmins }, { quoted: qchanel });
    break;
}

case 'grouplink':
case 'invitelink': {
    if (needGroup() || needAdmin()) break;
    const code = await sock.groupInviteCode(jid);
    const replyText = `

 𝐋𝐈𝐍𝐊: https://chat.whatsapp.com/${code}

`;
    await reply(replyText);
    break;
}
// ═══════════════════════════════════════════════════════════════════════════
//  REVOKE INVITE LINK
// ═══════════════════════════════════════════════════════════════════════════
case 'revoke': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    await sock.groupRevokeInvite(jid);
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐎𝐥𝐝 𝐢𝐧𝐯𝐢𝐭𝐞 𝐥𝐢𝐧𝐤 𝐫𝐞𝐯𝐨𝐤𝐞𝐝

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP INFO (detailed)
// ═══════════════════════════════════════════════════════════════════════════
case 'groupinfo': {
    if (needGroup()) break;
    const adminNames = participants
        .filter(p => p.admin)
        .map(p => p.full?.notify || p.full?.name || `+${normNum(p.jid || p.id)}`)
        .join(', ') || 'None';
    const info = `

 𝐍𝐀𝐌𝐄: ${groupName}
 𝐃𝐄𝐒𝐂: ${groupMetadata.desc || 'None'}
 𝐌𝐄𝐌𝐁𝐄𝐑𝐒: ${participants.length}
 𝐀𝐃𝐌𝐈𝐍𝐒: ${adminNames}
 𝐎𝐖𝐍𝐄𝐑: +${normNum(groupOwner)}
 𝐂𝐑𝐄𝐀𝐓𝐄𝐃: ${new Date((groupMetadata.creation||0)*1000).toLocaleString()}

`;
    await reply(info);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEMBERS LIST (numbered)
// ═══════════════════════════════════════════════════════════════════════════
case 'members': {
    if (needGroup()) break;
    const list = participants.map((p,i) => `${i+1}. +${normNum(p.jid||p.id)} ${p.admin === 'superadmin' ? '👑' : p.admin ? '🛡' : ''}`).join('\n');
    const replyText = `

${list.split('\n').map(line => `${line}`).join('\n')}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SET GROUP NAME
// ═══════════════════════════════════════════════════════════════════════════
case 'setgname': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    const name = args.join(' ');
    if (!name) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐞𝐭𝐠𝐧𝐚𝐦𝐞 <𝐧𝐚𝐦𝐞>

`;
        await reply(replyText);
        break;
    }
    await sock.groupUpdateSubject(jid, name);
    const replyText = `

 𝐍𝐄𝐖 𝐍𝐀𝐌𝐄: ${name}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐔𝐩𝐝𝐚𝐭𝐞𝐝

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SET GROUP DESCRIPTION
// ═══════════════════════════════════════════════════════════════════════════
case 'setgdesc': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    const desc = args.join(' ');
    if (!desc) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐞𝐭𝐠𝐝𝐞𝐬𝐜 <𝐝𝐞𝐬𝐜𝐫𝐢𝐩𝐭𝐢𝐨𝐧>

`;
        await reply(replyText);
        break;
    }
    await sock.groupUpdateDescription(jid, desc);
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐃𝐞𝐬𝐜𝐫𝐢𝐩𝐭𝐢𝐨𝐧 𝐮𝐩𝐝𝐚𝐭𝐞𝐝

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HIDETAG (and 😒 alias)
// ═══════════════════════════════════════════════════════════════════════════
case 'hidetag':
case '😒': {
    if (needGroup() || needAdmin()) break;
    const mentions2 = participants.map(p => p.id || p.jid).filter(Boolean);
    const msgText = text || '😒';
    await sock.sendMessage(jid, { text: msgText, mentions: mentions2 });
    // No extra reply because the message itself is the tag.
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  WARN / RESETWARN / WARNINGS
// ═══════════════════════════════════════════════════════════════════════════
case 'warn': {
    if (needGroup() || needAdmin()) break;
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐰𝐚𝐫𝐧 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐦𝐞𝐦𝐛𝐞𝐫)

`;
        await reply(replyText);
        break;
    }
    const wFile = DB('warnings.json');
    const data  = readJSON(wFile, {});
    const key2  = `${jid}|${normNum(t)}`;
    data[key2]  = (data[key2] || 0) + 1;
    writeJSON(wFile, data);
    const count = data[key2];
    let extra = '';
    if (count >= 3) {
        extra = '\n𝐀𝐂𝐓𝐈𝐎𝐍: ⛔ 𝟑 𝐰𝐚𝐫𝐧𝐢𝐧𝐠𝐬 – 𝐊𝐢𝐜𝐤𝐞𝐝';
        try { await sock.groupParticipantsUpdate(jid, [t], 'remove'); } catch {}
        delete data[key2];
        writeJSON(wFile, data);
    }
    const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐖𝐀𝐑𝐍𝐒: ${Math.min(count,3)}/3${extra}

`;
    await reply(replyText);
    break;
}
case 'tiktokuser':
case 'ttuser': {
    if (!text) {
        const replyText = `

 𝐔𝐬𝐚𝐠𝐞: .𝐭𝐢𝐤𝐭𝐨𝐤𝐮𝐬𝐞𝐫 <𝐮𝐬𝐞𝐫𝐧𝐚𝐦𝐞>
 𝐄𝐱𝐚𝐦𝐩𝐥𝐞: .𝐭𝐢𝐤𝐭𝐨𝐤𝐮𝐬𝐞𝐫 @𝐜𝐡𝐚𝐫𝐥𝐢𝐝𝐚𝐦𝐞𝐥𝐢𝐨

`;
        await reply(replyText);
        break;
    }
    let username = text.trim().replace(/^@/, '');
    try {
        await reaction('🔍');
        await reply(`

 𝐒𝐭𝐚𝐭𝐮𝐬: 🔍 𝐅𝐞𝐭𝐜𝐡𝐢𝐧𝐠 @${username}...

`);

        // 1. Get user info
        const infoUrl = `https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(username)}`;
        const infoRes = await axios.get(infoUrl);
        const userData = infoRes.data;

        if (!userData || !userData.data) throw new Error('User not found');

        const user = userData.data.user;
        const stats = userData.data.stats;

        const userInfo = `

 👤 ${user.nickname || '𝐍𝐨 𝐧𝐚𝐦𝐞'}
 📝 ${user.signature || '𝐍𝐨 𝐛𝐢𝐨'}
 🆔 𝐔𝐬𝐞𝐫 𝐈𝐃: ${user.id}
 📊 𝐒𝐭𝐚𝐭𝐬:
    👥 𝐅𝐨𝐥𝐥𝐨𝐰𝐞𝐫𝐬: ${stats.followerCount || 0}
    👣 𝐅𝐨𝐥𝐥𝐨𝐰𝐢𝐧𝐠: ${stats.followingCount || 0}
    ❤️ 𝐇𝐞𝐚𝐫𝐭𝐬: ${stats.heartCount || 0}
    🎬 𝐕𝐢𝐝𝐞𝐨𝐬: ${stats.videoCount || 0}
 🔗 https://tiktok.com/@${user.unique_id}

`;

        const avatar = user.avatarLarger || user.avatarMedium;
        if (avatar) {
            await sock.sendMessage(jid, { image: { url: avatar }, caption: ft(userInfo, sock) }, { quoted: m });
        } else {
            await reply(userInfo);
        }

        // 2. Fetch user's latest 3 videos
        await reply(`

 𝐒𝐭𝐚𝐭𝐮𝐬: 📹 𝐅𝐞𝐭𝐜𝐡𝐢𝐧𝐠 𝐥𝐚𝐭𝐞𝐬𝐭 𝟑 𝐯𝐢𝐝𝐞𝐨𝐬...

`);

        const postsUrl = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(username)}&count=3`;
        const postsRes = await axios.get(postsUrl);
        const postsData = postsRes.data;

        if (postsData && postsData.data && postsData.data.length > 0) {
            const videos = postsData.data;
            for (let i = 0; i < Math.min(videos.length, 3); i++) {
                const vid = videos[i];
                const videoUrl = vid.play;
                const stats2 = vid.stats;
                const info = `

 👤 @${user.unique_id}
 ❤️ ${stats2.diggCount || 0} 𝐥𝐢𝐤𝐞𝐬
 💬 ${stats2.commentCount || 0} 𝐜𝐨𝐦𝐦𝐞𝐧𝐭𝐬
 🔁 ${stats2.shareCount || 0} 𝐬𝐡𝐚𝐫𝐞𝐬
 👀 ${stats2.playCount || 0} 𝐯𝐢𝐞𝐰𝐬
 📝 ${vid.title || '𝐍𝐨 𝐜𝐚𝐩𝐭𝐢𝐨𝐧'}

`;
                await sock.sendMessage(jid, { video: { url: videoUrl }, caption: ft(info, sock) }, { quoted: m });
                await new Promise(r => setTimeout(r, 1000)); // avoid flooding
            }
        } else {
            await reply(`

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐍𝐨 𝐯𝐢𝐝𝐞𝐨𝐬 𝐟𝐨𝐮𝐧𝐝 𝐟𝐨𝐫 @${username}

`);
        }
        await reaction('✅');
    } catch (err) {
        console.error('TikTok user error:', err);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐔𝐬𝐞𝐫 "@${username}" 𝐧𝐨𝐭 𝐟𝐨𝐮𝐧𝐝 𝐨𝐫 𝐀𝐏𝐈 𝐞𝐫𝐫𝐨𝐫

`;
        await reply(replyText);
        await reaction('❌');
    }
    break;
}
case 'resetwarn': {
    if (needGroup() || needAdmin()) break;
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐫𝐞𝐬𝐞𝐭𝐰𝐚𝐫𝐧 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐦𝐞𝐦𝐛𝐞𝐫)

`;
        await reply(replyText);
        break;
    }
    const wFile = DB('warnings.json');
    const data  = readJSON(wFile, {});
    delete data[`${jid}|${normNum(t)}`];
    writeJSON(wFile, data);
    const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐖𝐚𝐫𝐧𝐢𝐧𝐠𝐬 𝐫𝐞𝐬𝐞𝐭

`;
    await reply(replyText);
    break;
}

case 'warnings': {
    if (needGroup()) break;
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐰𝐚𝐫𝐧𝐢𝐧𝐠𝐬 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐦𝐞𝐦𝐛𝐞𝐫)

`;
        await reply(replyText);
        break;
    }
    const count = (readJSON(DB('warnings.json'), {})[`${jid}|${normNum(t)}`] || 0);
    const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐂𝐎𝐔𝐍𝐓: ${count}/3

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANTILINK / ANTIMEDIA / WELCOME / GOODBYE (toggle)
// ═══════════════════════════════════════════════════════════════════════════
case 'antilink': {
    if (needGroup() || needAdmin()) break;
    const v = args[0]?.toLowerCase();
    if (!['on','off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐧𝐭𝐢𝐥𝐢𝐧𝐤 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setGroupFlag('antilink.json', jid, v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}

`;
    await reply(replyText);
    break;
}

case 'antimedia': {
    if (needGroup() || needAdmin()) break;
    const v = args[0]?.toLowerCase();
    if (!['on','off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐧𝐭𝐢𝐦𝐞𝐝𝐢𝐚 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setGroupFlag('antimedia.json', jid, v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}

`;
    await reply(replyText);
    break;
}

case 'welcome': {
    if (needGroup() || needAdmin()) break;
    const v = args[0]?.toLowerCase();
    if (!['on','off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐰𝐞𝐥𝐜𝐨𝐦𝐞 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setGroupFlag('welcome.json', jid, v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}

`;
    await reply(replyText);
    break;
}

case 'goodbye': {
    if (needGroup() || needAdmin()) break;
    const v = args[0]?.toLowerCase();
    if (!['on','off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐠𝐨𝐨𝐝𝐛𝐲𝐞 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setGroupFlag('goodbye.json', jid, v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  LISTGROUPS (Owner only)
// ═══════════════════════════════════════════════════════════════════════════
case 'listgroups': {
    if (needOwner()) break;
    try {
        const groups = await sock.groupFetchAllParticipating();
        const list = Object.values(groups).map((g,i) => `${i+1}. ${g.subject} (${g.participants?.length||0} members)`).join('\n');
        const replyText = `

${list.split('\n').map(line => `${line}`).join('\n') || '𝐍𝐨𝐧𝐞'}

`;
        await reply(replyText);
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FRIENDS / CONTACTS
// ═══════════════════════════════════════════════════════════════════════════
case 'friends': {
    try {
        const contacts = await sock.getContacts?.() || [];
        const dms = contacts.filter(c2 => c2.id?.endsWith('@s.whatsapp.net')).slice(0, 50);
        if (!dms.length) {
            const replyText = `

 𝐍𝐨 𝐜𝐨𝐧𝐭𝐚𝐜𝐭𝐬 𝐟𝐨𝐮𝐧𝐝

`;
            await reply(replyText);
            break;
        }
        const list = dms.map((c2, i) => `${i+1}. ${c2.name || c2.notify || `+${normNum(c2.id)}`}`).join('\n');
        const replyText = `

${list.split('\n').map(line => `${line}`).join('\n')}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: 𝐂𝐨𝐮𝐥𝐝 𝐧𝐨𝐭 𝐟𝐞𝐭𝐜𝐡 𝐜𝐨𝐧𝐭𝐚𝐜𝐭𝐬

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  APPROVE ALL JOIN REQUESTS
// ═══════════════════════════════════════════════════════════════════════════
case 'approveall': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    await reaction('✅');
    try {
        const pending = await sock.groupRequestParticipantsList(jid);
        if (!pending?.length) {
            const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: 📭 𝐍𝐨 𝐩𝐞𝐧𝐝𝐢𝐧𝐠 𝐫𝐞𝐪𝐮𝐞𝐬𝐭𝐬

`;
            await reply(replyText);
            break;
        }
        const jids = pending.map(p => p.jid);
        await sock.groupRequestParticipantsUpdate(jid, jids, 'approve');
        const replyText = `

 𝐀𝐏𝐏𝐑𝐎𝐕𝐄𝐃: ${jids.length} 𝐫𝐞𝐪𝐮𝐞𝐬𝐭(𝐬)
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐂𝐨𝐦𝐩𝐥𝐞𝐭𝐞

`;
        await reply(replyText);
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  CHECK PENDING REQUESTS
// ═══════════════════════════════════════════════════════════════════════════
case 'checkpending': {
    if (needGroup() || needAdmin()) break;
    try {
        const pending = await sock.groupRequestParticipantsList(jid);
        if (!pending?.length) {
            const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: 📭 𝐍𝐨 𝐩𝐞𝐧𝐝𝐢𝐧𝐠 𝐫𝐞𝐪𝐮𝐞𝐬𝐭𝐬

`;
            await reply(replyText);
            break;
        }
        const list = pending.map((p, i) => `${i+1}. +${normNum(p.jid)}`).join('\n');
        const replyText = `

${list.split('\n').map(line => `${line}`).join('\n')}

`;
        await reply(replyText);
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  REJECT ALL JOIN REQUESTS
// ═══════════════════════════════════════════════════════════════════════════
case 'rejectall': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    await reaction('❌');
    try {
        const pending = await sock.groupRequestParticipantsList(jid);
        if (!pending?.length) {
            const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: 📭 𝐍𝐨 𝐩𝐞𝐧𝐝𝐢𝐧𝐠 𝐫𝐞𝐪𝐮𝐞𝐬𝐭𝐬

`;
            await reply(replyText);
            break;
        }
        const jids = pending.map(p => p.jid);
        await sock.groupRequestParticipantsUpdate(jid, jids, 'reject');
        const replyText = `

 𝐑𝐄𝐉𝐄𝐂𝐓𝐄𝐃: ${jids.length} 𝐫𝐞𝐪𝐮𝐞𝐬𝐭(𝐬)
 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐂𝐨𝐦𝐩𝐥𝐞𝐭𝐞

`;
        await reply(replyText);
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

    // Disapprove / remove member
    // ═══════════════════════════════════════════════════════════════════════════
//  DISAP (remove member, cannot remove admin)
// ═══════════════════════════════════════════════════════════════════════════
case 'disap': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    let tRaw = getTargetJid(m, args);
    if (!tRaw && args[0]) {
        const cleaned = args[0].replace(/[^0-9]/g, '');
        if (cleaned.length >= 7) tRaw = cleaned + '@s.whatsapp.net';
    }
    if (!tRaw) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐝𝐢𝐬𝐚𝐩 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐦𝐞𝐦𝐛𝐞𝐫) 𝐨𝐫 .𝐝𝐢𝐬𝐚𝐩 <𝐧𝐮𝐦𝐛𝐞𝐫>

`;
        await reply(replyText);
        break;
    }
    const tFull = tRaw.includes('@') ? tRaw : normNum(tRaw) + '@s.whatsapp.net';
    const adminNorms = groupAdmins.map(a => (a.includes('@') ? a : a + '@s.whatsapp.net'));
    if (adminNorms.includes(tFull)) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐂𝐚𝐧𝐧𝐨𝐭 𝐫𝐞𝐦𝐨𝐯𝐞 𝐚𝐧 𝐚𝐝𝐦𝐢𝐧

`;
        await reply(replyText);
        break;
    }
    try {
        await sock.groupParticipantsUpdate(jid, [tFull], 'remove');
        const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(tFull)}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐑𝐞𝐦𝐨𝐯𝐞𝐝

`;
        await reply(replyText);
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANTIMENTION (protect from mass mentions)
// ═══════════════════════════════════════════════════════════════════════════
case 'antimention': {
    if (needGroup() || needAdmin()) break;
    const v = args[0]?.toLowerCase();
    if (!['on','off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐧𝐭𝐢𝐦𝐞𝐧𝐭𝐢𝐨𝐧 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setGroupFlag('antimention.json', jid, v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}
 𝐍𝐎𝐓𝐄: 𝐌𝐚𝐬𝐬 𝐦𝐞𝐧𝐭𝐢𝐨𝐧𝐬 𝐰𝐢𝐥𝐥 𝐛𝐞 𝐰𝐚𝐫𝐧𝐞𝐝

`;
    await reply(replyText);
    break;
}
case 'vv2':
case 'cute': {
    // 1. Get quoted message (view‑once media)
    const quotedMsg = m.quoted ? m.quoted : (() => {
        const ctx = m.message?.extendedTextMessage?.contextInfo;
        if (ctx?.quotedMessage) {
            const qMsg = ctx.quotedMessage;
            const qType = Object.keys(qMsg).find(k => !['senderKeyDistributionMessage','messageContextInfo'].includes(k));
            return { message: qMsg, msg: qMsg[qType], type: qType, key: {
                remoteJid: m.key.remoteJid,
                id: ctx.stanzaId,
                fromMe: false,
                participant: ctx.participant,
            } };
        }
        return null;
    })();

    const userJid = sender; // user's private chat JID

    if (!quotedMsg) {
        const errorText = `

 𝐔𝐬𝐚𝐠𝐞: 𝐑𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐯𝐢𝐞𝐰-𝐨𝐧𝐜𝐞 𝐦𝐞𝐝𝐢𝐚 𝐰𝐢𝐭𝐡 .𝐯𝐯𝟐

`;
        await sock.sendMessage(userJid, { text: ft(errorText, sock) });
        break;
    }

    // Unwrap view‑once container
    let innerMsg = quotedMsg.message || quotedMsg;
    for (const w of ['viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension']) {
        if (innerMsg[w]?.message) {
            innerMsg = innerMsg[w].message;
            break;
        }
    }

    const imgMsg = innerMsg.imageMessage;
    const vidMsg = innerMsg.videoMessage;
    const audMsg = innerMsg.audioMessage;
    const quotedKey = quotedMsg.key || getQuoted(m).qKey;

    if (!imgMsg && !vidMsg && !audMsg) {
        const errorText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐍𝐨𝐭 𝐚 𝐯𝐢𝐞𝐰-𝐨𝐧𝐜𝐞 𝐦𝐞𝐬𝐬𝐚𝐠𝐞

`;
        await sock.sendMessage(userJid, { text: ft(errorText, sock) });
        break;
    }

    // Download media
    try {
        let mediaBuffer;
        let mediaType = '';
        let caption = '';

        if (imgMsg) {
            mediaBuffer = await dlMedia({ imageMessage: imgMsg }, quotedKey);
            mediaType = 'image';
            caption = `🔓 𝐕𝐢𝐞𝐰-𝐎𝐧𝐜𝐞 𝐈𝐦𝐚𝐠𝐞\n𝐅𝐫𝐨𝐦: ${senderNumber}`;
        } else if (vidMsg) {
            mediaBuffer = await dlMedia({ videoMessage: vidMsg }, quotedKey);
            mediaType = 'video';
            caption = `🔓 𝐕𝐢𝐞𝐰-𝐎𝐧𝐜𝐞 𝐕𝐢𝐝𝐞𝐨\n𝐅𝐫𝐨𝐦: ${senderNumber}`;
        } else if (audMsg) {
            mediaBuffer = await dlMedia({ audioMessage: audMsg }, quotedKey);
            mediaType = 'audio';
            caption = `🔓 𝐕𝐢𝐞𝐰-𝐎𝐧𝐜𝐞 𝐀𝐮𝐝𝐢𝐨\n𝐅𝐫𝐨𝐦: ${senderNumber}`;
        }

        // Send media to user's DM
        if (mediaType === 'image') {
            await sock.sendMessage(userJid, { image: mediaBuffer, caption: ft(caption, sock), mimetype: 'image/jpeg' });
        } else if (mediaType === 'video') {
            await sock.sendMessage(userJid, { video: mediaBuffer, caption: ft(caption, sock) });
        } else if (mediaType === 'audio') {
            await sock.sendMessage(userJid, { audio: mediaBuffer, mimetype: 'audio/mpeg', ptt: false });
        }

        // Send success confirmation to DM (no group message)
        const successText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ✅ ${mediaType.toUpperCase()} 𝐝𝐞𝐥𝐢𝐯𝐞𝐫𝐞𝐝 𝐭𝐨 𝐲𝐨𝐮𝐫 𝐃𝐌

`;
        await sock.sendMessage(userJid, { text: ft(successText, sock) });
    } catch (err) {
        console.error('View-once error:', err.stack || err);
        const errorText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝 𝐭𝐨 𝐩𝐫𝐨𝐜𝐞𝐬𝐬

`;
        await sock.sendMessage(userJid, { text: ft(errorText, sock) });
    }
    break;
}
// ═══════════════════════════════════════════════════════════════════════════
//  ANTISPAM (too many messages)
// ═══════════════════════════════════════════════════════════════════════════
case 'antispam': {
    if (needGroup() || needAdmin()) break;
    const v = args[0]?.toLowerCase();
    if (!['on','off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐧𝐭𝐢𝐬𝐩𝐚𝐦 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setGroupFlag('antispam.json', jid, v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}
 𝐍𝐎𝐓𝐄: >𝟓 𝐦𝐬𝐠𝐬/𝟓𝐬 → 𝐰𝐚𝐫𝐧

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANTIBOT (blocks other bot commands)
// ═══════════════════════════════════════════════════════════════════════════
case 'antibot': {
    if (needGroup() || needAdmin()) break;
    const v = args[0]?.toLowerCase();
    if (!['on','off'].includes(v)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐧𝐭𝐢𝐛𝐨𝐭 𝐨𝐧/𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    setGroupFlag('antibot.json', jid, v === 'on');
    const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ${v === 'on' ? '✅ 𝐎𝐍' : '❌ 𝐎𝐅𝐅'}
 𝐍𝐎𝐓𝐄: 𝐁𝐨𝐭 𝐜𝐨𝐦𝐦𝐚𝐧𝐝𝐬 𝐟𝐫𝐨𝐦 𝐧𝐨𝐧-𝐚𝐝𝐦𝐢𝐧𝐬 𝐰𝐢𝐥𝐥 𝐛𝐞 𝐝𝐞𝐥𝐞𝐭𝐞𝐝

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SLOWMODE (cooldown between messages)
// ═══════════════════════════════════════════════════════════════════════════
case 'slowmode': {
    if (needGroup() || needAdmin()) break;
    const secs = parseInt(args[0]);
    if (!args[0] || args[0] === 'off') {
        const sm = readJSON(DB('slowmode.json'), {});
        delete sm[jid];
        writeJSON(DB('slowmode.json'), sm);
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐃𝐢𝐬𝐚𝐛𝐥𝐞𝐝

`;
        await reply(replyText);
        break;
    }
    if (isNaN(secs) || secs < 1 || secs > 3600) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐥𝐨𝐰𝐦𝐨𝐝𝐞 <𝟏-𝟑𝟔𝟎𝟎> | 𝐨𝐟𝐟

`;
        await reply(replyText);
        break;
    }
    const sm = readJSON(DB('slowmode.json'), {});
    sm[jid] = secs;
    writeJSON(DB('slowmode.json'), sm);
    const replyText = `

 𝐂𝐎𝐎𝐋𝐃𝐎𝐖𝐍: ${secs} 𝐬𝐞𝐜𝐨𝐧𝐝𝐬
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐀𝐜𝐭𝐢𝐯𝐞

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOFTBAN (remove & re-add, resets messages)
// ═══════════════════════════════════════════════════════════════════════════
case 'softban': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐨𝐟𝐭𝐛𝐚𝐧 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐦𝐞𝐦𝐛𝐞𝐫)

`;
        await reply(replyText);
        break;
    }
    if (groupAdmins.includes(t)) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐂𝐚𝐧𝐧𝐨𝐭 𝐬𝐨𝐟𝐭𝐛𝐚𝐧 𝐚𝐧 𝐚𝐝𝐦𝐢𝐧

`;
        await reply(replyText);
        break;
    }
    try {
        await sock.groupParticipantsUpdate(jid, [t], 'remove');
        await new Promise(r => setTimeout(r, 2000));
        await sock.groupParticipantsUpdate(jid, [t], 'add');
        const replyText = `

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐒𝐨𝐟𝐭𝐛𝐚𝐧𝐧𝐞𝐝 (𝐫𝐞-𝐚𝐝𝐝𝐞𝐝)

`;
        await reply(replyText);
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  WANTAM / FASTKICK (remove all non-admin members, demote if needed)
// ═══════════════════════════════════════════════════════════════════════════
case 'kickall1': {
    if (!m.isGroup) return reply('❌ This command can only be used in groups.');
    if (!isAdmins) return reply('❌ Admin only.');
    if (!isBotAdmins) return reply('❌ Bot must be admin.');

    const participants = await groupMetadata.participants;

    const users = participants
        .filter(v =>
            !v.admin && // not admin
            v.id !== botNumber && // not bot
            v.id !== m.sender // not command sender
        )
        .map(v => v.id);

    if (users.length < 1) return reply('❌ No members available to remove.');

    await reply(`

 𝐓𝐀𝐑𝐆𝐄𝐓𝐒: ${users.length}
 𝐒𝐓𝐀𝐓𝐔𝐒: Removing members...

`);

    for (const user of users) {
        await sock.groupParticipantsUpdate(
            m.chat,
            [user],
            'remove'
        );
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    reply(`✅ Successfully removed ${users.length} members.`);
}
break;

// ═══════════════════════════════════════════════════════════════════════════
//  SET GOODBYE MESSAGE
// ═══════════════════════════════════════════════════════════════════════════
case 'setgoodbyemsg': {
    if (needGroup() || needAdmin()) break;
    const msg = args.join(' ');
    if (!msg) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐞𝐭𝐠𝐨𝐨𝐝𝐛𝐲𝐞𝐦𝐬𝐠 <𝐦𝐞𝐬𝐬𝐚𝐠𝐞>
 𝐕𝐀𝐑𝐈𝐀𝐁𝐋𝐄𝐒: {𝐧𝐚𝐦𝐞}, {𝐠𝐫𝐨𝐮𝐩}

`;
        await reply(replyText);
        break;
    }
    const gm = readJSON(DB('goodbyemsgs.json'), {});
    gm[jid] = msg;
    writeJSON(DB('goodbyemsgs.json'), gm);
    const replyText = `

 𝐌𝐄𝐒𝐒𝐀𝐆𝐄: ${msg}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐒𝐞𝐭

`;
    await reply(replyText);
    break;
}
case 'kick': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('❌ Reply to a member.'); break; }
      await sock.groupParticipantsUpdate(jid, [t], 'remove');
      await reply(`✅ 

 𝐔𝐒𝐄𝐑: @${normNum(t)}
 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ Removed
.`);
      break;
    }// ═══════════════════════════════════════════════════════════════════════════
//  MUTE LIST (softbanned members)
// ═══════════════════════════════════════════════════════════════════════════
case 'mutelist': {
    if (needGroup() || needAdmin()) break;
    const ml = readJSON(DB('mutedmembers.json'), {});
    const list2 = (ml[jid] || []);
    if (!list2.length) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: 𝐍𝐨 𝐦𝐮𝐭𝐞𝐝 𝐦𝐞𝐦𝐛𝐞𝐫𝐬

`;
        await reply(replyText);
        break;
    }
    const formatted = list2.map((j2, i) => `${i+1}. +${normNum(j2)}`).join('\n');
    const replyText = `

${formatted.split('\n').map(line => `${line}`).join('\n')}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  KICK INACTIVE MEMBERS (owner only)
// ═══════════════════════════════════════════════════════════════════════════
case 'kickinactive': {
    if (needGroup() || needAdmin() || needBotAdm()) break;
    if (!_isOwner) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐎𝐰𝐧𝐞𝐫 𝐨𝐧𝐥𝐲

`;
        await reply(replyText);
        break;
    }
    const days = parseInt(args[0]) || 7;
    const actFile = DB('activity.json');
    const act = readJSON(actFile, {});
    const cutoff = Date.now() - days * 86400000;
    const inactive = participants
        .filter(p => !p.admin)
        .map(p => p.jid || p.id)
        .filter(pjid => {
            const key3 = `${jid}|${normNum(pjid)}`;
            return !act[key3] || act[key3] < cutoff;
        });
    if (!inactive.length) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐍𝐨 𝐢𝐧𝐚𝐜𝐭𝐢𝐯𝐞 𝐦𝐞𝐦𝐛𝐞𝐫𝐬 (>${days} 𝐝𝐚𝐲𝐬)

`;
        await reply(replyText);
        break;
    }
    await reply(`

 𝐒𝐓𝐀𝐓𝐔𝐒: ⚠️ 𝐊𝐢𝐜𝐤𝐢𝐧𝐠 ${inactive.length} 𝐦𝐞𝐦𝐛𝐞𝐫𝐬 (>${days} 𝐝𝐚𝐲𝐬)...

`);
    let done2 = 0;
    for (const t of inactive) {
        try { await sock.groupParticipantsUpdate(jid, [t], 'remove'); done2++; await new Promise(r => setTimeout(r, 500)); } catch {}
    }
    const replyText2 = `

 𝐊𝐈𝐂𝐊𝐄𝐃: ${done2}
 𝐅𝐀𝐈𝐋𝐄𝐃: ${inactive.length - done2}

`;
    await reply(replyText2);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  STICKER (image/video → webp sticker)
// ═══════════════════════════════════════════════════════════════════════════
case 'sticker': {
    await reaction('🎨');
    const { qMsg, qType, qKey } = getQuoted(m);
    const imgMsg = m.message?.imageMessage || (qType === 'imageMessage' ? qMsg?.imageMessage : null);
    const vidMsg = m.message?.videoMessage  || (qType === 'videoMessage' ? qMsg?.videoMessage  : null);
    const stickerSrc = imgMsg ? { imageMessage: imgMsg } : vidMsg ? { videoMessage: vidMsg } : null;
    const stickerKey = imgMsg
        ? (m.message?.imageMessage ? m.key : qKey)
        : m.message?.videoMessage ? m.key : qKey;
    if (!stickerSrc) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐭𝐢𝐜𝐤𝐞𝐫 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚𝐧 𝐢𝐦𝐚𝐠𝐞/𝐯𝐢𝐝𝐞𝐨)

`;
        await reply(replyText);
        break;
    }
    try {
        const buf = await dlMedia(stickerSrc, stickerKey);
        const tmp = `/tmp/stk_${Date.now()}`;
        fs.writeFileSync(`${tmp}.in`, buf);
        await new Promise((res, rej) =>
            exec(`ffmpeg -y -i ${tmp}.in -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2" -loop 0 ${tmp}.webp 2>/dev/null`, e => e ? rej(e) : res())
        );
        const webp = fs.readFileSync(`${tmp}.webp`);
        await sock.sendMessage(jid, { sticker: webp }, { quoted: qchanel });
        try { fs.unlinkSync(`${tmp}.in`); fs.unlinkSync(`${tmp}.webp`); } catch {}
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝 (𝐢𝐬 𝐟𝐟𝐦𝐩𝐞𝐠 𝐢𝐧𝐬𝐭𝐚𝐥𝐥𝐞𝐝?)

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOIMG (sticker → image)
// ═══════════════════════════════════════════════════════════════════════════
case 'toimg': {
    const { qMsg, qType, qKey } = getQuoted(m);
    const sm = m.message?.stickerMessage || (qType === 'stickerMessage' ? qMsg?.stickerMessage : null);
    if (!sm) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐭𝐨𝐢𝐦𝐠 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐬𝐭𝐢𝐜𝐤𝐞𝐫)

`;
        await reply(replyText);
        break;
    }
    const srcKey = m.message?.stickerMessage ? m.key : qKey;
    try {
        const buf = await dlMedia({ stickerMessage: sm }, srcKey);
        await replyImg(buf, '🖼 𝐒𝐭𝐢𝐜𝐤𝐞𝐫 → 𝐈𝐦𝐚𝐠𝐞');
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

   // ═══════════════════════════════════════════════════════════════════════════
//  VV (view‑once reveal)
// ═══════════════════════════════════════════════════════════════════════════
case 'vv': {
    const { qMsg, qType, qKey } = getQuoted(m);
    if (!qMsg) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: 𝐑𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐯𝐢𝐞𝐰-𝐨𝐧𝐜𝐞 𝐦𝐞𝐬𝐬𝐚𝐠𝐞

`;
        await reply(replyText);
        break;
    }
    let inner = qMsg;
    for (const w of ['viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension']) {
        if (inner[w]?.message) { inner = inner[w].message; break; }
    }
    const voImg = inner.imageMessage;
    const voVid = inner.videoMessage;
    const voAud = inner.audioMessage;
    if (!voImg && !voVid && !voAud) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨𝐭 𝐚 𝐯𝐢𝐞𝐰-𝐨𝐧𝐜𝐞 𝐦𝐞𝐬𝐬𝐚𝐠𝐞

`;
        await reply(replyText);
        break;
    }
    try {
        const src = voImg ? { imageMessage: voImg } : voVid ? { videoMessage: voVid } : { audioMessage: voAud };
        const buf = await dlMedia(src, qKey);
        if (voImg) {
            await replyImg(buf, '👁 𝐑𝐞𝐯𝐞𝐚𝐥𝐞𝐝');
        } else if (voAud) {
            await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mpeg', ptt: false }, { quoted: qchanel });
        } else if (!cfg(sock).iphoneMode) {
            await sock.sendMessage(jid, { video: buf, caption: '👁 𝐑𝐞𝐯𝐞𝐚𝐥𝐞𝐝' }, { quoted: qchanel });
        } else {
            const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: 👁 𝐕𝐢𝐞𝐰 𝐨𝐧𝐜𝐞 𝐫𝐞𝐯𝐞𝐚𝐥𝐞𝐝 [𝐯𝐢𝐝𝐞𝐨]

`;
            await reply(replyText);
        }
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  QR CODE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════
case 'qr': {
    if (!text) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐪𝐫 <𝐭𝐞𝐱𝐭>

`;
        await reply(replyText);
        break;
    }
    await replyImg(`https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(text)}`, `🔲 𝐐𝐑: ${text}`);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  WEATHER
// ═══════════════════════════════════════════════════════════════════════════
case 'weather': {
    const city = text;
    if (!city) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐰𝐞𝐚𝐭𝐡𝐞𝐫 <𝐜𝐢𝐭𝐲>

`;
        await reply(replyText);
        break;
    }
    try {
        const r = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=4&m`, { timeout: 8000 });
        const replyText = `

 ${r.data}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TRANSLATE (tr)
// ═══════════════════════════════════════════════════════════════════════════
case 'tr': {
    const lang = args[0];
    const txt2 = args.slice(1).join(' ');
    if (!lang || !txt2) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐭𝐫 <𝐥𝐚𝐧𝐠> <𝐭𝐞𝐱𝐭>
 𝐄𝐗𝐀𝐌𝐏𝐋𝐄: .𝐭𝐫 𝐞𝐬 𝐇𝐞𝐥𝐥𝐨

`;
        await reply(replyText);
        break;
    }
    try {
        const r = await axios.get(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(txt2)}&langpair=en|${lang}`, { timeout: 8000 });
        const translated = r.data.responseData.translatedText;
        const replyText = `

 ${translated}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  UPLOAD STATUS (owner only)
// ═══════════════════════════════════════════════════════════════════════════
case 'uploadstatus': {
    if (needOwner()) break;
    const { qMsg, qType, qKey } = getQuoted(m);
    try {
        if (qType === 'imageMessage') {
            const buf = await dlMedia({ imageMessage: qMsg.imageMessage }, qKey);
            await sock.sendMessage('status@broadcast', { image: buf, caption: qMsg.imageMessage?.caption || '' });
        } else if (qType === 'videoMessage') {
            const buf = await dlMedia({ videoMessage: qMsg.videoMessage }, qKey);
            await sock.sendMessage('status@broadcast', { video: buf, caption: qMsg.videoMessage?.caption || '' });
        } else {
            const t2 = text || qMsg?.conversation || qMsg?.extendedTextMessage?.text || '';
            if (!t2) {
                const replyText = `

 𝐔𝐒𝐀𝐆𝐄: 𝐏𝐫𝐨𝐯𝐢𝐝𝐞 𝐭𝐞𝐱𝐭 𝐨𝐫 𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐦𝐞𝐝𝐢𝐚

`;
                await reply(replyText);
                break;
            }
            await sock.sendMessage('status@broadcast', { text: t2 }, { backgroundColor: '#128C7E', font: 3 });
        }
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐔𝐩𝐥𝐨𝐚𝐝𝐞𝐝

`;
        await reply(replyText);
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SET MY PROFILE PICTURE
// ═══════════════════════════════════════════════════════════════════════════
case 'setmypp': {
    const { qMsg, qType, qKey } = getQuoted(m);
    const ownImg = m.message?.imageMessage;
    let buf = null;
    try {
        if (ownImg) {
            buf = await dlMedia({ imageMessage: ownImg }, m.key);
        } else if (qType === 'imageMessage') {
            buf = await dlMedia({ imageMessage: qMsg.imageMessage }, qKey);
        } else if (args[0]?.startsWith('http')) {
            buf = await getBuffer(args[0]);
        } else {
            const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐞𝐭𝐦𝐲𝐩𝐩 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚𝐧 𝐢𝐦𝐚𝐠𝐞) 𝐨𝐫 .𝐬𝐞𝐭𝐦𝐲𝐩𝐩 <𝐮𝐫𝐥>

`;
            await reply(replyText);
            break;
        }
        if (!buf || buf.length < 100) throw new Error('Image buffer empty');
        let finalBuf = buf;
        try {
            const sharp = require('sharp');
            finalBuf = await sharp(buf).resize(640, 640, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
        } catch { finalBuf = buf; }
        await sock.updateProfilePicture(jid, finalBuf);
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ✅ 𝐔𝐩𝐝𝐚𝐭𝐞𝐝

`;
        await reply(replyText);
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GET PROFILE PICTURE
// ═══════════════════════════════════════════════════════════════════════════
case 'getpp': {
    const t = getTargetJid(m, args);
    const target = t || `${botNumber}@s.whatsapp.net`;
    try {
        const ppUrl = await sock.profilePictureUrl(target, 'image');
        const r = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 10000 });
        await replyImg(Buffer.from(r.data), `🖼 +${normNum(target)}`);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐩𝐫𝐨𝐟𝐢𝐥𝐞 𝐩𝐢𝐜𝐭𝐮𝐫𝐞 𝐨𝐫 𝐩𝐫𝐢𝐯𝐚𝐜𝐲 𝐫𝐞𝐬𝐭𝐫𝐢𝐜𝐭𝐞𝐝

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TTS (Text To Speech)
// ═══════════════════════════════════════════════════════════════════════════
case 'tts': {
    if (!text) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐭𝐭𝐬 <𝐭𝐞𝐱𝐭> (𝐦𝐚𝐱 𝟑𝟎𝟎)

`;
        await reply(replyText);
        break;
    }
    if (text.length >= 300) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐌𝐚𝐱 𝟑𝟎𝟎 𝐜𝐡𝐚𝐫𝐚𝐜𝐭𝐞𝐫𝐬

`;
        await reply(replyText);
        break;
    }
    await reply(`

 𝐒𝐓𝐀𝐓𝐔𝐒: ⏳ 𝐆𝐞𝐧𝐞𝐫𝐚𝐭𝐢𝐧𝐠 𝐯𝐨𝐢𝐜𝐞...

`);
    try {
        const { data } = await axios.post(
            'https://tiktok-tts.weilnet.workers.dev/api/generation',
            { text, voice: 'id_001' },
            { timeout: 15000 }
        );
        if (!data?.data) throw new Error('No audio returned');
        await sock.sendMessage(jid, {
            audio: Buffer.from(data.data, 'base64'),
            mimetype: 'audio/mp4',
        }, { quoted: qchanel });
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  OCR (text from image)
// ═══════════════════════════════════════════════════════════════════════════
case 'ocr': {
    const { qMsg, qType, qKey } = getQuoted(m);
    const imgMsg = m.message?.imageMessage || (qType === 'imageMessage' ? qMsg?.imageMessage : null);
    if (!imgMsg) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: 𝐑𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚𝐧 𝐢𝐦𝐚𝐠𝐞

`;
        await reply(replyText);
        break;
    }
    try {
        const srcKey = m.message?.imageMessage ? m.key : qKey;
        const buf    = await dlMedia({ imageMessage: imgMsg }, srcKey);
        const b64    = buf.toString('base64');
        const r      = await axios.post('https://api.ocr.space/parse/image',
            `base64Image=data:image/jpeg;base64,${b64}&language=eng`,
            { headers: { apikey: 'helloworld', 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
        );
        const txt2 = r.data?.ParsedResults?.[0]?.ParsedText || 'No text found.';
        const replyText = `

 ${txt2}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝

`;
        await reply(replyText);
    }
    break;
}

    case 'pregnancyscan':
case 'scanpregnancy':
case 'scanpreg': {
    // Must be in a group
    if (!isGroup) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐓𝐡𝐢𝐬 𝐜𝐨𝐦𝐦𝐚𝐧𝐝 𝐰𝐨𝐫𝐤𝐬 𝐨𝐧𝐥𝐲 𝐢𝐧 𝐠𝐫𝐨𝐮𝐩𝐬

`;
        await reply(replyText);
        break;
    }

    // Determine which members to scan (max 5)
    let targets = [];
    const mentioned = msg.mention ? msg.mention : [];
    const replied = quoted ? quoted.sender : null;

    if (mentioned.length > 0) {
        targets = mentioned.slice(0, 5);
    } else if (replied) {
        targets = [replied];
    } else {
        // Pick up to 5 random members
        const allMembers = participants.map(p => p.id || p.jid).filter(Boolean);
        const shuffled = [...allMembers];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        targets = shuffled.slice(0, 5);
    }

    if (targets.length === 0) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐦𝐞𝐦𝐛𝐞𝐫𝐬 𝐭𝐨 𝐬𝐜𝐚𝐧

`;
        await reply(replyText);
        break;
    }

    // Helper: random father (different from mother)
    const getRandomFather = (motherJid) => {
        const otherMembers = participants.map(p => p.id || p.jid).filter(j => j !== motherJid);
        if (otherMembers.length === 0) return '𝐔𝐧𝐤𝐧𝐨𝐰𝐧';
        const random = otherMembers[Math.floor(Math.random() * otherMembers.length)];
        return `@${normNum(random)}`;
    };

    // Helper: random due date (1-280 days from now)
    const getRandomDueDate = () => {
        const today = new Date();
        const randomDays = Math.floor(Math.random() * 280) + 1;
        const due = new Date(today);
        due.setDate(today.getDate() + randomDays);
        return due.toLocaleDateString('en-GB');
    };

    // Helper: random gender
    const getGender = () => Math.random() > 0.5 ? '👶 𝐁𝐨𝐲' : '🎀 𝐆𝐢𝐫𝐥';

    // WIRED places (video call, bush, etc.)
    const locations = [
        '𝐢𝐧 𝐚 𝐯𝐢𝐝𝐞𝐨 𝐜𝐚𝐥𝐥 📱',
        '𝐢𝐧 𝐭𝐡𝐞 𝐛𝐮𝐬𝐡 🌿',
        '𝐨𝐧 𝐚 𝐜𝐡𝐚𝐭 𝐠𝐫𝐨𝐮𝐩 💬',
        '𝐢𝐧 𝐚 𝐝𝐫𝐞𝐚𝐦 😴',
        '𝐨𝐧 𝐚 𝐛𝐮𝐬 𝐧𝐮𝐦𝐛𝐞𝐫 𝟐𝟓 🚌',
        '𝐢𝐧 𝐚 𝐩𝐮𝐛𝐥𝐢𝐜 𝐭𝐨𝐢𝐥𝐞𝐭 🚽',
        '𝐨𝐧 𝐭𝐡𝐞 𝐦𝐨𝐨𝐧 🌙',
        '𝐢𝐧 𝐚 𝐦𝐚𝐫𝐤𝐞𝐭 🛒',
        '𝐚𝐭 𝐚 𝐟𝐮𝐧𝐞𝐫𝐚𝐥 ⚰️',
        '𝐢𝐧 𝐚 𝐜𝐡𝐮𝐫𝐜𝐡 ⛪',
        '𝐨𝐧 𝐭𝐡𝐞 𝐫𝐨𝐨𝐟 🏠',
        '𝐮𝐧𝐝𝐞𝐫 𝐚 𝐛𝐫𝐢𝐝𝐠𝐞 🌉',
        '𝐢𝐧 𝐚 𝐡𝐨𝐬𝐩𝐢𝐭𝐚𝐥 𝐛𝐞𝐝 🏥',
        '𝐨𝐧 𝐚 𝐫𝐢𝐝𝐢𝐧𝐠 𝐥𝐚𝐰𝐧𝐦𝐨𝐰𝐞𝐫 🌱',
        '𝐢𝐧 𝐭𝐡𝐞 𝐩𝐨𝐥𝐢𝐜𝐞 𝐬𝐭𝐚𝐭𝐢𝐨𝐧 👮',
        '𝐢𝐧 𝐚 𝐭𝐞𝐚𝐜𝐡𝐞𝐫𝐬 𝐨𝐟𝐟𝐢𝐜𝐞 📚',
        '𝐝𝐮𝐫𝐢𝐧𝐠 𝐚 𝐥𝐢𝐯𝐞 𝐬𝐭𝐫𝐞𝐚𝐦 📺'
    ];
    const getLocation = () => locations[Math.floor(Math.random() * locations.length)];

    // Build result lines
    const lines = [];
    for (const motherJid of targets) {
        const motherName = `@${normNum(motherJid)}`;
        const fatherName = getRandomFather(motherJid);
        const dueDate = getRandomDueDate();
        const gender = getGender();
        const location = getLocation();
        lines.push(
            `${motherName}`,
            `  👨 𝐅𝐚𝐭𝐡𝐞𝐫: ${fatherName}`,
            `  🏠 𝐖𝐡𝐞𝐫𝐞: ${location}`,
            `  🗓 𝐃𝐮𝐞 𝐃𝐚𝐭𝐞: ${dueDate}`,
            `  ${gender}`,
            ` `
        );
    }
    if (lines.length && lines[lines.length-1] === ' ') lines.pop();

    // Collect all mentioned JIDs (mothers and fathers)
    const allMentioned = [...targets];
    const fatherJids = [];
    for (const motherJid of targets) {
        const otherMembers = participants.map(p => p.id || p.jid).filter(j => j !== motherJid);
        if (otherMembers.length > 0) {
            fatherJids.push(otherMembers[Math.floor(Math.random() * otherMembers.length)]);
        }
    }
    const allMentions = [...targets, ...fatherJids];

    const scanResult = `

 𝐒𝐂𝐀𝐍𝐍𝐄𝐃: ${targets.length} 𝐦𝐞𝐦𝐛𝐞𝐫(𝐬)
${lines.join('\n')}

`;

    await sock.sendMessage(jid, { text: scanResult, mentions: allMentions }, { quoted: qchanel });
    break;
}
    
case 'setbotpic':
case 'setmenuimg': {   // you can use either name
    if (needOwner()) break;

    let buffer = null;
    let source = '';

    // 1. Try to get image from current message (attached image)
    if (m.message?.imageMessage) {
        buffer = await dlMedia({ imageMessage: m.message.imageMessage }, m.key);
        source = 'attached image';
    }
    // 2. Try to get image from replied message
    else {
        const { qMsg, qType, qKey } = getQuoted(m);
        if (qType === 'imageMessage') {
            buffer = await dlMedia({ imageMessage: qMsg.imageMessage }, qKey);
            source = 'replied image';
        }
    }

    if (!buffer) {
        await reply(`

 𝐔𝐬𝐚𝐠𝐞: 𝐒𝐞𝐧𝐝 𝐚𝐧 𝐢𝐦𝐚𝐠𝐞 𝐰𝐢𝐭𝐡 𝐜𝐚𝐩𝐭𝐢𝐨𝐧 .𝐬𝐞𝐭𝐛𝐨𝐭𝐩𝐢𝐜
 𝐎𝐫 𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚𝐧 𝐢𝐦𝐚𝐠𝐞 𝐰𝐢𝐭𝐡 .𝐬𝐞𝐭𝐛𝐨𝐭𝐩𝐢𝐜

`);
        break;
    }

    // Optional: resize the image (requires sharp module)
    let finalBuffer = buffer;
    try {
        const sharp = require('sharp');
        finalBuffer = await sharp(buffer).resize(640, 640, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
    } catch {}

    // Save the image locally (or upload to a hosting service)
    const sessionDir = `./database/sessions/${botNumber}`;
    fs.mkdirSync(sessionDir, { recursive: true });
    const localPath = `${sessionDir}/menu.jpg`;
    fs.writeFileSync(localPath, finalBuffer);

    // Store the path in your bot's settings (so .menu can use it)
    setWaSetting(waNum, 'menuImg', localPath);

    const successText = `

 𝐒𝐨𝐮𝐫𝐜𝐞: ${source}
 𝐒𝐭𝐚𝐭𝐮𝐬: ✅ 𝐒𝐚𝐯𝐞𝐝
 𝐏𝐚𝐭𝐡: ${localPath}

`;
    await reply(successText);
    break;
}

    // Helper: random father (different from mother)
    
// ═══════════════════════════════════════════════════════════════════════════
//  SHORTEN URL (is.gd)
// ═══════════════════════════════════════════════════════════════════════════
case 'shorten': {
    const url = args[0];
    if (!url?.startsWith('http')) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐡𝐨𝐫𝐭𝐞𝐧 <𝐮𝐫𝐥>

`;
        await reply(replyText);
        break;
    }
    try {
        const r = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, { timeout: 8000 });
        const replyText = `

 ${r.data}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOURL – Upload any media to telegraph and return a copy button
// ═══════════════════════════════════════════════════════════════════════════
case 'tourl':
case 'imgurl':
case 'imageurl':
case 'getimageurl': {
    await reaction('📄');
    const { qMsg: qMsgTU, qType: qTypeTU, qKey: qKeyTU } = getQuoted(m);
    const MEDIA_TYPES = ['imageMessage','videoMessage','stickerMessage','audioMessage','documentMessage'];
    const mediaTypeTU = MEDIA_TYPES.find(t2 => qMsgTU?.[t2]);
    if (!qMsgTU || !mediaTypeTU) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐭𝐨𝐮𝐫𝐥 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐢𝐦𝐚𝐠𝐞/𝐯𝐢𝐝𝐞𝐨/𝐬𝐭𝐢𝐜𝐤𝐞𝐫/𝐚𝐮𝐝𝐢𝐨)

`;
        await reply(replyText);
        break;
    }
    try {
        const buf = await dlMedia(qMsgTU, qKeyTU);
        if (!buf) throw new Error('Media download failed');
        const { uploadToTelegraph } = require('./helper/uploader');
        const mimeMap = {
            imageMessage: 'image/jpeg',
            videoMessage: 'video/mp4',
            stickerMessage: 'image/webp',
            audioMessage: 'audio/mp4',
            documentMessage: qMsgTU.documentMessage?.mimetype || 'application/octet-stream',
        };
        const link = await uploadToTelegraph(buf, mimeMap[mediaTypeTU]);
        if (!link) throw new Error('Upload failed');

        const { generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
        const msg = await generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.fromObject({
                            text: `✅ 𝐂𝐨𝐧𝐯𝐞𝐫𝐭𝐞𝐝 𝐭𝐨 𝐥𝐢𝐧𝐤!\n𝐄𝐱𝐩𝐢𝐫𝐞𝐬: 𝐍𝐞𝐯𝐞𝐫\n\n${link}`,
                        }),
                        footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: '' }),
                        header: proto.Message.InteractiveMessage.Header.fromObject({
                            title: '[ ! ] 𝐈𝐍𝐅𝐎𝐑𝐌𝐀𝐓𝐈𝐎𝐍',
                            subtitle: '',
                            hasMediaAttachment: false,
                        }),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                            buttons: [{
                                name: 'cta_copy',
                                buttonParamsJson: JSON.stringify({ display_text: '𝐂𝐨𝐩𝐲 𝐋𝐢𝐧𝐤!', copy_code: link }),
                            }],
                        }),
                        contextInfo: { mentionedJid: [sender] },
                    }),
                },
            },
        }, { quoted: qchanel });
        await sock.relayMessage(msg.key.remoteJid, msg.message, { messageId: msg.key.id });
    } catch (e) {
        logError('tourl', e.message);
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PLAY (audio)
// ═══════════════════════════════════════════════════════════════════════════


case 'setsticker': {
    if (needOwner()) break;

    const { qMsg, qType } = getQuoted(m);
    if (qType !== 'stickerMessage') {
        const replyText = `

 𝐔𝐬𝐚𝐠𝐞: 𝐑𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐬𝐭𝐢𝐜𝐤𝐞𝐫 𝐰𝐢𝐭𝐡:
 .𝐬𝐞𝐭𝐬𝐭𝐢𝐜𝐤𝐞𝐫 <𝐜𝐨𝐦𝐦𝐚𝐧𝐝>
 𝐄𝐱𝐚𝐦𝐩𝐥𝐞: .𝐬𝐞𝐭𝐬𝐭𝐢𝐜𝐤𝐞𝐫 𝐦𝐞𝐧𝐮
 𝐓𝐨 𝐫𝐞𝐦𝐨𝐯𝐞: .𝐬𝐞𝐭𝐬𝐭𝐢𝐜𝐤𝐞𝐫 -𝐫𝐞𝐦𝐨𝐯𝐞

`;
        await reply(replyText);
        break;
    }

    const commandName = args[0]?.toLowerCase();
    if (!commandName) {
        await reply('❌ Provide a command name.\nExample: `.setsticker menu`');
        break;
    }

    const sticker = qMsg.stickerMessage;
    let hashBytes = sticker.fileSha256;
    if (!hashBytes) {
        await reply('❌ Could not read sticker hash.');
        break;
    }
    const buffer = Buffer.isBuffer(hashBytes) ? hashBytes : Buffer.from(hashBytes);
    const hashBase64 = buffer.toString('base64');

    if (commandName === '-remove') {
        setStickerCommand(hashBase64, null);
        const replyText = `

 𝐒𝐭𝐚𝐭𝐮𝐬: ✅ 𝐑𝐞𝐦𝐨𝐯𝐞𝐝

`;
        await reply(replyText);
    } else {
        setStickerCommand(hashBase64, commandName);
        const replyText = `

 𝐂𝐨𝐦𝐦𝐚𝐧𝐝: .${commandName}
 𝐇𝐚𝐬𝐡: ${hashBase64.slice(0, 16)}…
 𝐒𝐭𝐚𝐭𝐮𝐬: ✅ 𝐀𝐜𝐭𝐢𝐯𝐞

`;
        await reply(replyText);
    }
    break;
}case 'liststickers': {
    if (needOwner()) break;
    const map = getStickerCommands();
    const entries = Object.entries(map);
    if (!entries.length) {
        await reply('📋 No sticker commands set.');
        break;
    }
    const list = entries.map(([hash, cmd], i) => `${i+1}. ${hash.slice(0, 16)}… → .${cmd}`).join('\n');
    const replyText = `

 ${list.split('\n').join('\n')}

`;
    await reply(replyText);
    break;
}
// ═══════════════════════════════════════════════════════════════════════════
//  PLAYDOC (send audio as document)
// ═══════════════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════
    //   PLAY2 – SONG DOWNLOADER (direct send, no option buttons)
    // ══════════════════════════════════════════════════════

    // ── Download audio with retry (primary + fallback) ──
    async function downloadAudio(videoUrl, retries = 3) {
      let lastErr;
      for (let i = 0; i < retries; i++) {
        try {
          const primary = await axios.get(
            `https://apiskeith2-production-ec66.up.railway.app/download/audio?url=${encodeURIComponent(videoUrl)}`,
            { timeout: 60000 }
          );
          if (primary.data?.status && primary.data?.result) {
            return { status: true, result: primary.data.result, title: primary.data.title };
          }
          throw new Error('Primary API failed');
        } catch (err) {
          console.warn('[play2] primary API failed, using fallback:', err.message);
          try {
            const fallback = await axios.get(
              `https://yt-dl.officialhectormanuel.workers.dev/?url=${encodeURIComponent(videoUrl)}`,
              { timeout: 60000 }
            );
            if (!fallback.data?.status || !fallback.data?.audio) {
              throw new Error('Fallback API failed to fetch audio');
            }
            return {
              status: true,
              result: fallback.data.audio,
              title: fallback.data.title,
              thumbnail: fallback.data.thumbnail
            };
          } catch (e) {
            lastErr = e;
            if (i < retries - 1) {
              await new Promise(r => setTimeout(r, 3000));
            }
          }
        }
      }
      throw lastErr || new Error('All download attempts failed');
    }

    // ── YouTube music downloader ──
    case 'play':
    case 'ytmp3': {
      if (!text) {
        await reply(`*Example:* ${prefix + cmd} Faded by Alan Walker`);
        break;
      }
      try {
        await reaction('🎵');
        const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i;
        let video;
        let videoUrl;
        if (ytRegex.test(text.trim())) {
          videoUrl = text.trim();
        } else {
          const yts = require('yt-search');
          const search = await yts(text.trim());
          video = search.videos?.[0];
          if (!video) {
            await reaction('❌');
            await reply(`*No results found for:* ${text}`);
            break;
          }
          videoUrl = video.url;
        }
        if (video) {
          const body = `╭━━━━━━━━━
┃ *𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐓𝐄𝐂𝐇

> *ᴛɪᴛʟᴇ:* ${video.title}

┃ *ᴠɪᴇᴡꜱ:* ${video.views}
┃ *ᴅᴜʀᴀᴛɪᴏɴ:* ${video.timestamp}
┃ *ᴜᴘʟᴏᴀᴅᴇᴅ:* ${video.ago}

┃ *Enjoy your music®*
╰━━━━━━━━━━━━━━━━━━┈⊷
> *𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐓𝐄𝐂𝐇©*`;
          await sock.sendMessage(jid, {
            image: { url: video.thumbnail },
            caption: body
          }, { quoted: m });
        }
        const apiUrl = `https://eliteprotech-apis.zone.id/download/ytmp3?url=${encodeURIComponent(videoUrl)}`;
        const { data } = await axios.get(apiUrl, { timeout: 120000 });
        if (!data?.status || !data?.download?.downloadUrl) {
          await reaction('❌');
          await reply('*❌ Failed to fetch the song! Try again later.*');
          break;
        }
        const title = data.download.title || video?.title || 'ElitePro Music';
        const fileName = `${title.replace(/[\\/:*?"<>|]/g, '')}.mp3`;
        const audioResponse = await axios.get(data.download.downloadUrl, {
          responseType: 'arraybuffer',
          timeout: 120000,
          maxContentLength: 50 * 1024 * 1024,
          maxBodyLength: 50 * 1024 * 1024
        });
        const audioBuffer = Buffer.from(audioResponse.data);
        await sock.sendMessage(jid, {
          audio: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName,
          ptt: false
        }, { quoted: m });
        await reaction('✅');
      } catch (error) {
        console.error('Play command error:', error);
        await reaction('⚠️');
        await reply('_*An error occurred while downloading the song.*_');
      }
      break;
    }
case 'playdoc': {
    const query2 = text;
    if (!query2) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐩𝐥𝐚𝐲𝐝𝐨𝐜 <𝐬𝐨𝐧𝐠 𝐧𝐚𝐦𝐞>

`;
        await reply(replyText);
        break;
    }
    await reaction('⬇️');
    try {
        const yts = require('yt-search');
        const search = await yts(query2);
        const video = search.videos?.[0] || search.all?.[0];
        if (!video) throw new Error('No results found');
        const { data } = await axios.get(
            `https://api.privatezia.biz.id/api/downloader/ytmp3?url=${encodeURIComponent(video.url)}`,
            { timeout: 20000 }
        );
        if (!data?.status) throw new Error('API failed');
        const dlUrl = data.result?.downloadUrl || data.url;
        if (!dlUrl) throw new Error('No download URL');
        await reply(`

 𝐒𝐓𝐀𝐓𝐔𝐒: ⬇️ 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝𝐢𝐧𝐠 *${video.title}*...

`);
        const dlRes = await axios.get(dlUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const buf   = Buffer.from(dlRes.data);
        const fname = video.title.replace(/[^\w\s]/g, '').trim() + '.mp3';
        await sock.sendMessage(jid, {
            document: buf,
            mimetype: 'audio/mpeg',
            caption:  ft(`🎵 ${video.title}\n© ${settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞'}`, sock),
            fileName: fname,
        }, { quoted: qchanel });
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  YTMP4 (video download)
// ═══════════════════════════════════════════════════════════════════════════
case 'ytmp4': {
    if (!text) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐲𝐭𝐦𝐩𝟒 <𝐘𝐨𝐮𝐓𝐮𝐛𝐞 𝐥𝐢𝐧𝐤 𝐨𝐫 𝐭𝐢𝐭𝐥𝐞>

`;
        await reply(replyText);
        break;
    }
    await reaction('🎬');
    await reply(`

 𝐒𝐓𝐀𝐓𝐔𝐒: ⏳ 𝐏𝐫𝐨𝐜𝐞𝐬𝐬𝐢𝐧𝐠 𝐯𝐢𝐝𝐞𝐨...

`);
    try {
        const yts = require('yt-search');
        const isUrl = text.includes('youtu');
        let videoUrl = text;
        let videoTitle = 'video';
        if (!isUrl) {
            const search = await yts(text);
            const v = search.videos?.[0];
            if (!v) throw new Error('No results');
            videoUrl = v.url;
            videoTitle = v.title;
        }
        const { data } = await axios.get(
            `https://api.privatezia.biz.id/api/downloader/ytmp4?url=${encodeURIComponent(videoUrl)}`,
            { timeout: 25000 }
        );
        const dlUrl = data?.result?.downloadUrl || data?.url;
        if (!dlUrl) throw new Error('No video URL');
        await sock.sendMessage(jid, {
            video: { url: dlUrl },
            caption: ft(`🎬 ${videoTitle}`, sock),
            fileName: videoTitle.replace(/[^\w\s]/g,'').trim() + '.mp4',
        }, { quoted: qchanel });
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  LYRICS
// ═══════════════════════════════════════════════════════════════════════════
case 'lyrics': {
    if (!text) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐥𝐲𝐫𝐢𝐜𝐬 <𝐬𝐨𝐧𝐠 𝐧𝐚𝐦𝐞>

`;
        await reply(replyText);
        break;
    }
    await reaction('🎤');
    try {
        const { data } = await axios.get(
            `https://some-random-api.com/lyrics?title=${encodeURIComponent(text)}`,
            { timeout: 10000 }
        );
        if (!data?.lyrics) throw new Error('Not found');
        const lrc = data.lyrics.length > 3000 ? data.lyrics.slice(0, 3000) + '...' : data.lyrics;
        const replyText = `

 👤 ${data.author}
 ${lrc}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨𝐭 𝐟𝐨𝐮𝐧𝐝. 𝐓𝐫𝐲 𝐚 𝐝𝐢𝐟𝐟𝐞𝐫𝐞𝐧𝐭 𝐭𝐢𝐭𝐥𝐞

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  INSTAGRAM / IG
// ═══════════════════════════════════════════════════════════════════════════
case 'instagram':
case 'ig': {
    const igUrl = args[0];
    if (!igUrl?.includes('instagram.com')) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐢𝐧𝐬𝐭𝐚𝐠𝐫𝐚𝐦 <𝐩𝐨𝐬𝐭/𝐫𝐞𝐞𝐥 𝐮𝐫𝐥>

`;
        await reply(replyText);
        break;
    }
    await reaction('📸');
    try {
        const { data } = await axios.get(
            `https://api.ootaizumi.web.id/downloader/instagram?url=${encodeURIComponent(igUrl)}`,
            { timeout: 20000 }
        );
        if (!data?.status || !data.result?.url) throw new Error('Failed');
        const r = data.result;
        if (r.type === 'video') {
            await sock.sendMessage(jid, { video: { url: r.url }, caption: ft(r.caption || '📸 Instagram', sock) }, { quoted: qchanel });
        } else {
            await replyImg(r.url, r.caption?.slice(0,200) || '📸 Instagram');
        }
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TIKTOK / TT
// ═══════════════════════════════════════════════════════════════════════════
case 'tiktok':
case 'tt': {
    const ttUrl = args[0];
    if (!ttUrl?.includes('tiktok.com')) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐭𝐢𝐤𝐭𝐨𝐤 <𝐭𝐢𝐤𝐭𝐨𝐤 𝐯𝐢𝐝𝐞𝐨 𝐮𝐫𝐥>

`;
        await reply(replyText);
        break;
    }
    await reaction('🎵');
    try {
        const { data } = await axios.get(
            `https://api.ootaizumi.web.id/downloader/tiktok?url=${encodeURIComponent(ttUrl)}`,
            { timeout: 20000 }
        );
        if (!data?.status || !data.result?.video) throw new Error('Failed');
        const r = data.result;
        await sock.sendMessage(jid, { video: { url: r.video }, caption: ft(r.title || '🎵 TikTok', sock) }, { quoted: qchanel });
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FACEBOOK / FB
// ═══════════════════════════════════════════════════════════════════════════
case 'facebook':
case 'fb': {
    const fbUrl = args[0];
    if (!fbUrl?.includes('facebook.com') && !fbUrl?.includes('fb.watch')) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐟𝐚𝐜𝐞𝐛𝐨𝐨𝐤 <𝐟𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐯𝐢𝐝𝐞𝐨 𝐮𝐫𝐥>

`;
        await reply(replyText);
        break;
    }
    await reaction('📘');
    try {
        const { data } = await axios.get(
            `https://api.ootaizumi.web.id/downloader/facebook?url=${encodeURIComponent(fbUrl)}`,
            { timeout: 20000 }
        );
        if (!data?.status) throw new Error('Failed');
        const r = data.result;
        const videoUrl = r?.sd || r?.hd || r?.video;
        if (!videoUrl) throw new Error('No video URL');
        await sock.sendMessage(jid, { video: { url: videoUrl }, caption: ft('📘 Facebook', sock) }, { quoted: qchanel });
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

    // ── Twitter/X downloader ─────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
//  TWITTER / X (video download)
// ═══════════════════════════════════════════════════════════════════════════
case 'twitter':
case 'x': {
    const twUrl = args[0];
    if (!twUrl?.includes('twitter.com') && !twUrl?.includes('x.com')) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐭𝐰𝐢𝐭𝐭𝐞𝐫 <𝐭𝐰𝐞𝐞𝐭/𝐯𝐢𝐝𝐞𝐨 𝐮𝐫𝐥>

`;
        await reply(replyText);
        break;
    }
    await reaction('🐦');
    try {
        const { data } = await axios.get(
            `https://api.ootaizumi.web.id/downloader/twitter?url=${encodeURIComponent(twUrl)}`,
            { timeout: 20000 }
        );
        if (!data?.status) throw new Error('Failed');
        const r = data.result;
        const videoUrl = r?.video || r?.url;
        if (!videoUrl) throw new Error('No URL');
        await sock.sendMessage(jid, { video: { url: videoUrl }, caption: ft('🐦 Twitter/X', sock) }, { quoted: qchanel });
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PINTEREST
// ═══════════════════════════════════════════════════════════════════════════
case 'pinterest': {
    const pinUrl = args[0];
    if (!pinUrl?.includes('pinterest')) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐩𝐢𝐧𝐭𝐞𝐫𝐞𝐬𝐭 <𝐩𝐢𝐧𝐭𝐞𝐫𝐞𝐬𝐭 𝐮𝐫𝐥>

`;
        await reply(replyText);
        break;
    }
    await reaction('📌');
    try {
        const { data } = await axios.get(
            `https://api.ootaizumi.web.id/downloader/pinterest?url=${encodeURIComponent(pinUrl)}`,
            { timeout: 20000 }
        );
        if (!data?.status) throw new Error('Failed');
        const r = data.result;
        if (r?.video) {
            await sock.sendMessage(jid, { video: { url: r.video }, caption: '📌 Pinterest' }, { quoted: qchanel });
        } else if (r?.image) {
            await replyImg(r.image, '📌 Pinterest');
        } else throw new Error('No media found');
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SPOTIFY (track info)
// ═══════════════════════════════════════════════════════════════════════════
case 'spotify': {
    if (!text) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐬𝐩𝐨𝐭𝐢𝐟𝐲 <𝐭𝐫𝐚𝐜𝐤 𝐧𝐚𝐦𝐞>

`;
        await reply(replyText);
        break;
    }
    await reaction('🎧');
    try {
        const { data } = await axios.get(
            `https://some-random-api.com/others/spotify?q=${encodeURIComponent(text)}`,
            { timeout: 10000 }
        );
        if (!data?.title) throw new Error('Not found');
        const bar = `▓`.repeat(Math.floor((data.duration_ms/100)/60000 * 20)).padEnd(20,'░');
        // The caption is already formatted – we keep it as is (not boxed) because it's an image caption.
        await replyImg(
            data.album_art,
            `🎧 *${data.title}*\n👤 ${data.artists?.join(', ') || 'Unknown'}\n💿 ${data.album}\n⏱ ${Math.floor(data.duration_ms/60000)}:${String(Math.floor((data.duration_ms%60000)/1000)).padStart(2,'0')}\n\n[${bar}]`
        );
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐓𝐫𝐚𝐜𝐤 𝐧𝐨𝐭 𝐟𝐨𝐮𝐧𝐝

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  BASE64 ENCODE
// ═══════════════════════════════════════════════════════════════════════════
case 'base64': {
    if (!text) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐛𝐚𝐬𝐞𝟔𝟒 <𝐭𝐞𝐱𝐭>

`;
        await reply(replyText);
        break;
    }
    const encoded = Buffer.from(text).toString('base64');
    const replyText = `

 ${encoded}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  BASE64 DECODE
// ═══════════════════════════════════════════════════════════════════════════
case 'unbase64': {
    if (!text) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐮𝐧𝐛𝐚𝐬𝐞𝟔𝟒 <𝐛𝐚𝐬𝐞𝟔𝟒 𝐬𝐭𝐫𝐢𝐧𝐠>

`;
        await reply(replyText);
        break;
    }
    try {
        const decoded = Buffer.from(text, 'base64').toString('utf8');
        const replyText = `

 ${decoded}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐈𝐧𝐯𝐚𝐥𝐢𝐝 𝐛𝐚𝐬𝐞𝟔𝟒 𝐬𝐭𝐫𝐢𝐧𝐠

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  WHOIS (contact info)
// ═══════════════════════════════════════════════════════════════════════════
case 'whois': {
    const t = getTargetJid(m, args);
    if (!t) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐰𝐡𝐨𝐢𝐬 @𝐮𝐬𝐞𝐫𝐧𝐚𝐦𝐞

`;
        await reply(replyText);
        break;
    }
    try {
        const ppUrl = await sock.profilePictureUrl(t, 'image').catch(() => null);
        const isOnWa = await sock.onWhatsApp(t).catch(() => []);
        const status = isOnWa?.[0]?.exists ? '✅ 𝐎𝐧 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩' : '❌ 𝐍𝐨𝐭 𝐨𝐧 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩';
        const info = `

 ${status}
 𝐏𝐏: ${ppUrl ? '✅ 𝐀𝐯𝐚𝐢𝐥𝐚𝐛𝐥𝐞' : '❌ 𝐍𝐨 𝐩𝐫𝐨𝐟𝐢𝐥𝐞 𝐩𝐢𝐜𝐭𝐮𝐫𝐞'}

`;
        if (ppUrl) await replyImg(ppUrl, info);
        else await reply(info);
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  REVERSE GIF
// ═══════════════════════════════════════════════════════════════════════════
case 'reversegif': {
    const { qMsg: qMRG, qType: qTRG, qKey: qKRG } = getQuoted(m);
    const gifMsg = m.message?.videoMessage || (qTRG === 'videoMessage' ? qMRG?.videoMessage : null);
    if (!gifMsg) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐫𝐞𝐯𝐞𝐫𝐬𝐞𝐠𝐢𝐟 (𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐚 𝐆𝐈𝐅/𝐯𝐢𝐝𝐞𝐨)

`;
        await reply(replyText);
        break;
    }
    await reaction('🔁');
    try {
        const srcKey = m.message?.videoMessage ? m.key : qKRG;
        const buf = await dlMedia({ videoMessage: gifMsg }, srcKey);
        const tmp = `/tmp/rgif_${Date.now()}`;
        fs.writeFileSync(`${tmp}.mp4`, buf);
        await new Promise((res, rej) =>
            exec(`ffmpeg -y -i ${tmp}.mp4 -vf reverse -af areverse ${tmp}_rev.mp4 2>/dev/null`, e => e ? rej(e) : res())
        );
        const revBuf = fs.readFileSync(`${tmp}_rev.mp4`);
        await sock.sendMessage(jid, { video: revBuf, gifPlayback: true, caption: '🔁 𝐑𝐞𝐯𝐞𝐫𝐬𝐞𝐝 𝐆𝐈𝐅' }, { quoted: qchanel });
        try { fs.unlinkSync(`${tmp}.mp4`); fs.unlinkSync(`${tmp}_rev.mp4`); } catch {}
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ATTP (Animated Text Sticker)
// ═══════════════════════════════════════════════════════════════════════════
case 'attp': {
    if (!text) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐚𝐭𝐭𝐩 <𝐭𝐞𝐱𝐭>

`;
        await reply(replyText);
        break;
    }
    await reaction('✨');
    try {
        const { data } = await axios.get(
            `https://api.siputzx.my.id/api/sticker/attp?text=${encodeURIComponent(text)}`,
            { responseType: 'arraybuffer', timeout: 15000 }
        );
        const buf = Buffer.from(data);
        await sock.sendMessage(jid, { sticker: buf }, { quoted: qchanel });
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  EMOJIMIX
// ═══════════════════════════════════════════════════════════════════════════
case 'emojimix': {
    if (args.length < 2) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐞𝐦𝐨𝐣𝐢𝐦𝐢𝐱 <𝐞𝐦𝐨𝐣𝐢𝟏> <𝐞𝐦𝐨𝐣𝐢𝟐>
 𝐄𝐗𝐀𝐌𝐏𝐋𝐄: .𝐞𝐦𝐨𝐣𝐢𝐦𝐢𝐱 😀 🔥

`;
        await reply(replyText);
        break;
    }
    try {
        const e1 = encodeURIComponent(args[0]);
        const e2 = encodeURIComponent(args[1]);
        const url = `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/${e1}/${e1}_${e2}.png`;
        await replyImg(url, `${args[0]} + ${args[1]}`);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐄𝐦𝐨𝐣𝐢 𝐦𝐢𝐱 𝐧𝐨𝐭 𝐟𝐨𝐮𝐧𝐝

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  REPO / XREPO (interactive + styled fallback)
// ═══════════════════════════════════════════════════════════════════════════
case 'repo':
case 'xrepo': {
    await reaction('📦');
    try {
        // ── Prepare menu image ──
        const prepareImage = async (url) => {
            try {
                const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
                const buffer = Buffer.from(response.data);
                const { prepareWAMessageMedia } = require('@whiskeysockets/baileys');
                return await prepareWAMessageMedia({ image: buffer }, { upload: sock.waUploadToServer });
            } catch (err) {
                console.error('Image prep error:', err);
                return {};
            }
        };

        const imageUrl = 'https://files.catbox.moe/8puhvt.jpeg';
        const imgField = await prepareImage(imageUrl);

        // Newsletter context
        const newsletterContext = {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363426406372312@newsletter',
                newsletterName: `© ${settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞𓅓'}`,
                serverMessageId: -1
            }
        };

        // Card
        const card = {
    header: {
        title: ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞',
        hasMediaAttachment: !!imgField?.imageMessage,
        ...(imgField || {})
    },
    body: {
        text: `𝐑𝐄𝐏𝐎𝐒𝐈𝐓𝐎𝐑𝐘 / 𝐏𝐀𝐈𝐑
│
${c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞'}

𝐘𝐨𝐮 𝐚𝐫𝐞 𝐧𝐨𝐰 𝐚𝐜𝐜𝐞𝐬𝐬𝐢𝐧𝐠 𝐚 𝐬𝐲𝐬𝐭𝐞𝐦 𝐫𝐞𝐬𝐞𝐫𝐯𝐞𝐝 𝐟𝐨𝐫 𝐩𝐫𝐞𝐜𝐢𝐬𝐢𝐨𝐧, 𝐩𝐞𝐫𝐟𝐨𝐫𝐦𝐚𝐧𝐜𝐞, 𝐚𝐧𝐝 𝐞𝐥𝐢𝐭𝐞 𝐞𝐱𝐞𝐜𝐮𝐭𝐢𝐨𝐧.

✦ 𝐀𝐛𝐬𝐨𝐥𝐮𝐭𝐞 𝐄𝐟𝐟𝐢𝐜𝐢𝐞𝐧𝐜𝐲
✦ 𝐒𝐞𝐚𝐦𝐥𝐞𝐬𝐬 𝐄𝐱𝐞𝐜𝐮𝐭𝐢𝐨𝐧
✦ 𝐄𝐥𝐢𝐭𝐞 𝐏𝐞𝐫𝐟𝐨𝐫𝐦𝐚𝐧𝐜𝐞

𝐒𝐞𝐥𝐞𝐜𝐭 𝐲𝐨𝐮𝐫 𝐩𝐚𝐢𝐫𝐢𝐧𝐠 𝐫𝐞𝐠𝐢𝐨𝐧:

🇰🇪 𝐊𝐞𝐧𝐲𝐚
🇿🇦 𝐀𝐟𝐫𝐢𝐜𝐚
🌍 𝐎𝐭𝐡𝐞𝐫𝐬
🌐 𝐀𝐥𝐥

© ${settings.CREDITS || 'Talkless Ultra XMD'}
`
    },
    nativeFlowMessage: {
        buttons: [
            { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🇰🇪 PAIR (Kenya)", url: settings.REQUIRED_PAIR_LINK || "https://t.me/talklessultraxmd_bot" }) },
            { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🇿🇦 PAIR (Africa)", url: settings.REQUIRED_PAIR_LINK || "https://t.me/talklessultraxmd_bot" }) },
            { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🌍 PAIR (Others)", url: settings.REQUIRED_PAIR_LINK || "https://t.me/talklessultraxmd_bot" }) },
            { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🌐 PAIR (All)", url: settings.REQUIRED_PAIR_LINK || "https://t.me/talklessultraxmd_bot" }) }
        ]
    }
};
        const { generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
        const interactiveMsg = {
            interactiveMessage: {
                body: proto.Message.InteractiveMessage.Body.fromObject({ text: `🛍️ * ${settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞'}*` }),
                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: `© ${settings.CREDITS || 'Talkless Ultra XMD'} • Tap a button to pair` }),
                header: proto.Message.InteractiveMessage.Header.fromObject({ title: '', hasMediaAttachment: false }),
                contextInfo: newsletterContext,
                carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ cards: [card] })
            }
        };

        const msg = generateWAMessageFromContent(jid, {
            ephemeralMessage: {
                message: {
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                    ...interactiveMsg
                }
            }
        }, { quoted: qchanel });

        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
        await reaction('✅');
    } catch (error) {
        console.error('Repo interactive error:', error);
        // Styled fallback text
        const fallbackText = `

 ${c.botName || settings.BOT_NAME || ' 𝐓𝐀𝐋𝐊𝐋𝐄𝐒𝐒 𝐔𝐋𝐓𝐑𝐀 𝐗𝐌𝐃 ⃝⃪✞'}
 𝐘𝐨𝐮 𝐚𝐫𝐞 𝐧𝐨𝐰 𝐚𝐜𝐜𝐞𝐬𝐬𝐢𝐧𝐠 𝐚 𝐬𝐲𝐬𝐭𝐞𝐦 𝐫𝐞𝐬𝐞𝐫𝐯𝐞𝐝 𝐟𝐨𝐫 𝐩𝐫𝐞𝐜𝐢𝐬𝐢𝐨𝐧, 𝐩𝐞𝐫𝐟𝐨𝐫𝐦𝐚𝐧𝐜𝐞, 𝐚𝐧𝐝 𝐞𝐥𝐢𝐭𝐞 𝐞𝐱𝐞𝐜𝐮𝐭𝐢𝐨𝐧.
 ✦ 𝐀𝐛𝐬𝐨𝐥𝐮𝐭𝐞 𝐄𝐟𝐟𝐢𝐜𝐢𝐞𝐧𝐜𝐲
 ✦ 𝐒𝐞𝐚𝐦𝐥𝐞𝐬𝐬 𝐄𝐱𝐞𝐜𝐮𝐭𝐢𝐨𝐧
 ✦ 𝐄𝐥𝐢𝐭𝐞 𝐏𝐞𝐫𝐟𝐨𝐫𝐦𝐚𝐧𝐜𝐞
 𝐏𝐚𝐢𝐫 𝐛𝐨𝐭: ${settings.REQUIRED_PAIR_LINK || 't.me/talklessultraxmd_bot'}
 © ${settings.CREDITS || 'Talkless Ultra XMD'}

`;
        await reply(fallbackText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  IDCH / CEKIDCH (WhatsApp channel info)
//  Already uses ft() – we keep as is, but ensure the `teks` is styled.
//  The existing code uses ft() which applies the bold script.
//  No changes needed.
// ═══════════════════════════════════════════════════════════════════════════
case 'idch':
case 'cekidch':
case 'channelid':
case 'getchannelid': {
    const chLink = String(args[0] || '').trim();
    const currentChannelId = jid.endsWith('@newsletter') ? jid : null;
    if (!chLink && !currentChannelId) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐢𝐝𝐜𝐡 <𝐰𝐡𝐚𝐭𝐬𝐚𝐩𝐩 𝐜𝐡𝐚𝐧𝐧𝐞𝐥 𝐥𝐢𝐧𝐤>
 𝐎𝐑 𝐔𝐒𝐄 .𝐢𝐝𝐜𝐡 𝐈𝐍𝐒𝐈𝐃𝐄 𝐀 𝐂𝐇𝐀𝐍𝐍𝐄𝐋

`;
        await reply(replyText);
        break;
    }
    const channelMatch = chLink.match(/^(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/i);
    if (chLink && !channelMatch) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐌𝐮𝐬𝐭 𝐛𝐞 𝐚 𝐯𝐚𝐥𝐢𝐝 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐜𝐡𝐚𝐧𝐧𝐞𝐥 𝐥𝐢𝐧𝐤
 𝐄𝐗𝐀𝐌𝐏𝐋𝐄: .𝐢𝐝𝐜𝐡 https://whatsapp.com/channel/XXXXXXXXXXXXXXX

`;
        await reply(replyText);
        break;
    }
    try {
        const res = channelMatch
            ? await sock.newsletterMetadata('invite', channelMatch[1])
            : await sock.newsletterMetadata('jid', currentChannelId).catch(() => ({}));
        const channelId = res?.id || res?.jid || res?.newsletterJid || currentChannelId;
        if (!channelId) throw new Error('Channel ID was not returned by WhatsApp');
        let imageUrl = res.profilePicUrl || res.profilePictureUrl || res.picture || null;
        if (!imageUrl && typeof sock.profilePictureUrl === 'function') {
            imageUrl = await sock.profilePictureUrl(channelId, 'image').catch(() => null);
        }
        const verified = res.verification === 'VERIFIED' ? '𝐘𝐞𝐬 ✅' : '𝐍𝐨 ❌';
        const teks = `

 🆔 𝐈𝐃: ${channelId}
 📛 𝐍𝐚𝐦𝐞: ${res.name}
 👥 𝐅𝐨𝐥𝐥𝐨𝐰𝐞𝐫𝐬: ${res.subscribers}
 🔘 𝐒𝐭𝐚𝐭𝐮𝐬: ${res.state}
 ✅ 𝐕𝐞𝐫𝐢𝐟𝐢𝐞𝐝: ${verified}
 🖼️ 𝐈𝐦𝐚𝐠𝐞 𝐔𝐑𝐋: ${imageUrl || 'Unavailable'}

`;
        if (imageUrl) {
            await sock.sendMessage(jid, { image: { url: imageUrl }, caption: ft(teks, sock) }, { quoted: m });
        } else {
            await reply(teks);
        }
    } catch (e) {
        const replyText = `

 𝐄𝐑𝐑𝐎𝐑: ${e.message}

`;
        await reply(replyText);
    }
    break;
}

    // ══════════════════════════════════════════════════════
    //   FUN – EXISTING
    // ══════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════════
//  JOKE
// ═══════════════════════════════════════════════════════════════════════════
case 'joke': {
    try {
        const r = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 6000 });
        const jokeText = `

 ${r.data.setup}
 ${r.data.punchline}

`;
        await reply(jokeText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐣𝐨𝐤𝐞𝐬

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FACT
// ═══════════════════════════════════════════════════════════════════════════
case 'fact': {
    try {
        const r = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en', { timeout: 6000 });
        const replyText = `

 💡 ${r.data.text}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐟𝐚𝐜𝐭𝐬

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  QUOTE
// ═══════════════════════════════════════════════════════════════════════════
case 'quote': {
    try {
        const r = await axios.get('https://zenquotes.io/api/random', { timeout: 6000 });
        const replyText = `

 🌟 "${r.data[0].q}"
 – ${r.data[0].a}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐪𝐮𝐨𝐭𝐞𝐬

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DARE
// ═══════════════════════════════════════════════════════════════════════════
case 'dare': {
    const dares = [
        'Tell your most embarrassing secret.',
        'Do 20 push-ups now.',
        'Text your crush right now.',
        'Sing a song aloud.',
        'Change your status to something silly for 1hr.',
        'Send a voice note of you barking.',
        'Do your best celebrity impression.'
    ];
    const dare = dares[Math.floor(Math.random() * dares.length)];
    const replyText = `

 🔥 ${dare}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TRUTH
// ═══════════════════════════════════════════════════════════════════════════
case 'truth': {
    const truths = [
        'Whats your biggest regret?',
        'Have you ever lied to your best friend?',
        'What is your guilty pleasure?',
        'Who is your secret crush?',
        'What embarrassing thing have you done?',
        'What is a secret you have never told anyone?',
        'Who do you secretly dislike in this group?'
    ];
    const truth = truths[Math.floor(Math.random() * truths.length)];
    const replyText = `

 💬 ${truth}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RIDDLE
// ═══════════════════════════════════════════════════════════════════════════
case 'riddle': {
    const riddles = [
        { q: 'What has keys but no locks?', a: 'A keyboard' },
        { q: 'What gets wetter as it dries?', a: 'A towel' },
        { q: 'I speak without a mouth. What am I?', a: 'An echo' },
        { q: 'The more you take the more you leave behind.', a: 'Footsteps' },
        { q: 'What has hands but cant clap?', a: 'A clock' },
        { q: 'I have cities, but no houses live there.', a: 'A map' }
    ];
    const pick = riddles[Math.floor(Math.random() * riddles.length)];
    const replyText = `

 🧩 ${pick.q}
 𝐀𝐧𝐬𝐰𝐞𝐫: ${pick.a}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROAST
// ═══════════════════════════════════════════════════════════════════════════
case 'roast': {
    const roasts = [
        'You are the human equivalent of a participation trophy.',
        'If brains were gas, you would not have enough to power an ants motorcycle.',
        'You are not stupid; you just have bad luck thinking.',
        'You bring everyone so much joy when you leave the room.',
        'You are proof that evolution can go in reverse.'
    ];
    const t2 = getTargetJid(m, args);
    const name = t2 ? `@${normNum(t2)}` : 'you';
    const mentions = t2 ? [t2] : [];
    const roastText = roasts[Math.floor(Math.random() * roasts.length)].replace('You', name);
    // Use ft() because it already formats with your style? ft() likely adds the box.
    await sock.sendMessage(jid, { text: ft(`🔥 ${roastText}`, sock), mentions }, { quoted: qchanel });
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SHIP
// ═══════════════════════════════════════════════════════════════════════════
case 'ship': {
    const t1 = sender;
    const t2 = getTargetJid(m, args);
    const pct = Math.floor(Math.random() * 101);
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
    const replyText = `

 @${normNum(t1)} ❤️ ${t2 ? '@' + normNum(t2) : '???'}
 [${bar}] ${pct}%

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  COINFLIP
// ═══════════════════════════════════════════════════════════════════════════
case 'coinflip': {
    const result = Math.random() > 0.5 ? 'Heads!' : 'Tails!';
    const replyText = `

 🪙 ${result}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DICE
// ═══════════════════════════════════════════════════════════════════════════
case 'dice': {
    const sides = parseInt(args[0]) || 6;
    const roll = Math.floor(Math.random() * sides) + 1;
    const replyText = `

 🎲 d${sides}: *${roll}*

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAGIC 8 BALL
// ═══════════════════════════════════════════════════════════════════════════
case 'magic8': {
    const answers = [
        'Yes, definitely!', 'Without a doubt.', 'Outlook good.',
        'My sources say no.', 'Cannot predict now.', 'Don\'t count on it.',
        'Signs point to yes.', 'Very doubtful.', 'It is certain.',
        'Ask again later.'
    ];
    const ans = answers[Math.floor(Math.random() * answers.length)];
    const replyText = `

 🎱 ${ans}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOROSCOPE
// ═══════════════════════════════════════════════════════════════════════════
case 'horoscope': {
    const signs = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
    const sign = args[0]?.toLowerCase();
    if (!signs.includes(sign)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐡𝐨𝐫𝐨𝐬𝐜𝐨𝐩𝐞 <𝐬𝐢𝐠𝐧>
 𝐒𝐈𝐆𝐍𝐒: ${signs.join(', ')}

`;
        await reply(replyText);
        break;
    }
    try {
        const r = await axios.post(`https://aztro.sameerkumar.website/?sign=${sign}&day=today`, {}, { timeout: 8000 });
        const replyText = `

 ${r.data.description}
 🍀 𝐋𝐮𝐜𝐤𝐲 #: ${r.data.lucky_number}
 💜 𝐌𝐨𝐨𝐝: ${r.data.mood}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEME
// ═══════════════════════════════════════════════════════════════════════════
case 'meme': {
    try {
        const r = await axios.get('https://meme-api.com/gimme', { timeout: 8000 });
        await replyImg(r.data.url, `😂 ${r.data.title}`);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐦𝐞𝐦𝐞𝐬

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  CAT
// ═══════════════════════════════════════════════════════════════════════════
case 'cat': {
    try {
        const r = await axios.get('https://api.thecatapi.com/v1/images/search', { timeout: 8000 });
        await replyImg(r.data[0].url, '🐱 𝐌𝐞𝐨𝐰!');
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐜𝐚𝐭𝐬

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DOG
// ═══════════════════════════════════════════════════════════════════════════
case 'dog': {
    try {
        const r = await axios.get('https://dog.ceo/api/breeds/image/random', { timeout: 8000 });
        await replyImg(r.data.message, '🐶 𝐖𝐨𝐨𝐟!');
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐝𝐨𝐠𝐬

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  WAIFU
// ═══════════════════════════════════════════════════════════════════════════
case 'waifu': {
    try {
        const r = await axios.get('https://api.waifu.pics/sfw/waifu', { timeout: 8000 });
        await replyImg(r.data.url, '🌸 𝐖𝐚𝐢𝐟𝐮!');
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐰𝐚𝐢𝐟𝐮

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANIME
// ═══════════════════════════════════════════════════════════════════════════
case 'anime': {
    try {
        const r = await axios.get('https://api.jikan.moe/v4/random/anime', { timeout: 8000 });
        const a = r.data.data;
        await replyImg(a.images?.jpg?.image_url,
            `🎌 *${a.title}*\n📺 𝐄𝐩𝐢𝐬𝐨𝐝𝐞𝐬: ${a.episodes || '?'}\n⭐ 𝐒𝐜𝐨𝐫𝐞: ${a.score || '?'}\n\n${(a.synopsis || '').slice(0, 200)}`
        );
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TRIVIA
// ═══════════════════════════════════════════════════════════════════════════
case 'trivia': {
    try {
        const r = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 8000 });
        const q = r.data.results[0];
        const answers = [...q.incorrect_answers, q.correct_answer].sort(() => Math.random() - 0.5);
        const questionText = q.question.replace(/&quot;/g, '"').replace(/&#039;/g, "'");
        const replyText = `

 ❓ ${questionText}
${answers.map((a, i) => `${i + 1}. ${a}`).join('\n')}
 𝐀𝐧𝐬𝐰𝐞𝐫: ${q.correct_answer}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐭𝐫𝐢𝐯𝐢𝐚

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  COMPLIMENT
// ═══════════════════════════════════════════════════════════════════════════
case 'compliment': {
    const compliments = [
        'You are absolutely brilliant!',
        'Your smile brightens everyone\'s day.',
        'You are stronger than you think.',
        'Your kindness is rare and beautiful.',
        'You make the world a better place!',
        'You have an amazing energy!'
    ];
    const t2 = getTargetJid(m, args);
    const name = t2 ? `@${normNum(t2)}` : 'you';
    const mentions = t2 ? [t2] : [];
    const compliment = compliments[Math.floor(Math.random() * compliments.length)].replace('You', name);
    await sock.sendMessage(jid, { text: ft(`💐 ${compliment}`, sock), mentions }, { quoted: qchanel });
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  BORED
// ═══════════════════════════════════════════════════════════════════════════
case 'bored': {
    try {
        const r = await axios.get('https://www.boredapi.com/api/activity/', { timeout: 6000 });
        const replyText = `

 🎯 ${r.data.activity}
 𝐓𝐲𝐩𝐞: ${r.data.type}
 𝐏𝐚𝐫𝐭𝐢𝐜𝐢𝐩𝐚𝐧𝐭𝐬: ${r.data.participants}

`;
        await reply(replyText);
    } catch {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐅𝐚𝐢𝐥𝐞𝐝

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RPS (Rock Paper Scissors)
// ═══════════════════════════════════════════════════════════════════════════
case 'rps': {
    const choices = ['🪨 Rock', '📄 Paper', '✂️ Scissors'];
    const valid = ['rock', 'paper', 'scissors', 'r', 'p', 's'];
    const map = { r: 'rock', p: 'paper', s: 'scissors' };
    const raw = args[0]?.toLowerCase();
    const pick = map[raw] || raw;
    if (!['rock', 'paper', 'scissors'].includes(pick)) {
        const replyText = `

 𝐔𝐒𝐀𝐆𝐄: .𝐫𝐩𝐬 𝐫𝐨𝐜𝐤/𝐩𝐚𝐩𝐞𝐫/𝐬𝐜𝐢𝐬𝐬𝐨𝐫𝐬

`;
        await reply(replyText);
        break;
    }
    const botPick = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];
    const wins = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
    const result = pick === botPick ? '🤝 Draw!' : wins[pick] === botPick ? '🏆 You win!' : '😈 Bot wins!';
    const replyText = `

 𝐘𝐨𝐮: ${pick}
 𝐁𝐨𝐭: ${botPick}
 ${result}

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MATH QUIZ (two‑part interaction)
// ═══════════════════════════════════════════════════════════════════════════
case 'math': {
    const ops = ['+', '-', '×'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    const a2 = Math.floor(Math.random() * 50) + 1;
    const b2 = Math.floor(Math.random() * 50) + 1;
    const ans2 = op === '+' ? a2 + b2 : op === '-' ? a2 - b2 : a2 * b2;

    if (!text) {
        const mathQ = readJSON(DB('mathq.json'), {});
        mathQ[jid] = { ans: ans2, ts: Date.now() };
        writeJSON(DB('mathq.json'), mathQ);
        const replyText = `

 🧮 ${a2} ${op} ${b2} = ?
 𝐑𝐞𝐩𝐥𝐲 𝐰𝐢𝐭𝐡 𝐭𝐡𝐞 𝐚𝐧𝐬𝐰𝐞𝐫 (𝟑𝟎𝐬)

`;
        await reply(replyText);
        break;
    }

    // Answer check
    const mathQ = readJSON(DB('mathq.json'), {});
    const q2 = mathQ[jid];
    if (!q2 || Date.now() - q2.ts > 30000) {
        const replyText = `

 𝐒𝐓𝐀𝐓𝐔𝐒: ❌ 𝐍𝐨 𝐚𝐜𝐭𝐢𝐯𝐞 𝐪𝐮𝐞𝐬𝐭𝐢𝐨𝐧 𝐨𝐫 𝐭𝐢𝐦𝐞 𝐞𝐱𝐩𝐢𝐫𝐞𝐝

`;
        await reply(replyText);
        break;
    }
    const userAns = parseInt(text.trim());
    if (userAns === q2.ans) {
        delete mathQ[jid];
        writeJSON(DB('mathq.json'), mathQ);
        const replyText = `

 ✅ 𝐂𝐨𝐫𝐫𝐞𝐜𝐭! 𝐓𝐡𝐞 𝐚𝐧𝐬𝐰𝐞𝐫 𝐰𝐚𝐬 *${q2.ans}* 🎉

`;
        await reply(replyText);
    } else {
        delete mathQ[jid];
        writeJSON(DB('mathq.json'), mathQ);
        const replyText = `

 ❌ 𝐖𝐫𝐨𝐧𝐠! 𝐓𝐡𝐞 𝐜𝐨𝐫𝐫𝐞𝐜𝐭 𝐚𝐧𝐬𝐰𝐞𝐫 𝐰𝐚𝐬 *${q2.ans}*

`;
        await reply(replyText);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  NEVER HAVE I EVER
// ═══════════════════════════════════════════════════════════════════════════
case 'neverhaveiever': {
    const nhi = [
        'Never have I ever lied to get out of trouble.',
        'Never have I ever eaten food off the floor.',
        'Never have I ever googled myself.',
        'Never have I ever faked being sick.',
        'Never have I ever cried at a movie.',
        'Never have I ever broken a bone.',
        'Never have I ever stayed awake for 24+ hours.'
    ];
    const statement = nhi[Math.floor(Math.random() * nhi.length)];
    const replyText = `

 🙈 ${statement}
 𝐑𝐞𝐚𝐜𝐭 🖐 𝐢𝐟 𝐲𝐨𝐮 𝐇𝐀𝐕𝐄, 👇 𝐢𝐟 𝐲𝐨𝐮 𝐇𝐀𝐕𝐄𝐍'𝐓

`;
    await reply(replyText);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  WOULD YOU RATHER
// ═══════════════════════════════════════════════════════════════════════════
case 'wouldyourather': {
    const wyr = [
        ['be able to fly', 'be invisible'],
        ['speak every language', 'play every instrument'],
        ['have no internet for a month', 'no phone for a month'],
        ['always be hot', 'always be cold'],
        ['know the future', 'change the past'],
        ['be famous for a day', 'be unknown forever']
    ];
    const pick = wyr[Math.floor(Math.random() * wyr.length)];
    const replyText = `

 🅰️ ${pick[0]}
 — 𝐎𝐑 —
 🅱️ ${pick[1]}
 𝐑𝐞𝐩𝐥𝐲 𝐀 𝐨𝐫 𝐁!

`;
    await reply(replyText);
    break;
}



    default: {
      const h = { reply, replyImg, ft, cfg, dlMedia, reaction, normNum, getQuoted, isOwner: _isOwner };
      if (await reactionHandler(sock, m, cmd, args, h)) break;
      if (await scrapsHandler(sock, m, cmd, args, h))   break;
      if (await illusionHandler(sock, m, cmd, args, h)) break;
      if (await socialHandler(sock, m, cmd, args, h))   break;
      if (await aiHandler(sock, m, cmd, args, h))       break;
      if (await economyHandler(sock, m, cmd, args, h))  break;
      if (await toolsHandler(sock, m, cmd, args, h))    break;
      if (await stickerHandler(sock, m, cmd, args, h))  break;
      if (await musicHandler(sock, m, cmd, args, h))    break;
      if (await gamesHandler(sock, m, cmd, args, h))    break;
      if (await adminHandler(sock, m, cmd, args, h))    break;
      if (await arabicHandler(sock, m, cmd, args, h))   break;
      await devHandler(sock, m, cmd, args, h);
      break;
    }
  }
}

module.exports = { handleMessage, runAutoFollow };
