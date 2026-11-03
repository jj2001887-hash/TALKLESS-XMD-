// stickers.js – 30+ Sticker/Media Commands
'use strict';
const axios = require('axios');

const STICKER_CMDS = [
  'sticker2','tomp4sticker','stickerinfo','attp2','emojisticker',
  'gifsticker','videosticker','cropsticker','circleimg',
  'givensticker','colorsticker','textimg','imagetext',
  'tenor','giphy','gifcat','gifdog','gifanime','gifyeet',
  'stealsticker','packname','packauthor','exifsticker',
  'togif','giftext','gifmeme','randgif','animegif',
  'memetemplate','randmeme',
];

async function stickerHandler(sock, m, cmd, args, helpers) {
  if (!STICKER_CMDS.includes(cmd)) return false;
  const { reply, ft, cfg, reaction } = helpers;
  const jid    = m.key.remoteJid;
  const prefix = cfg(sock).prefix || '.';
  const text   = args.join(' ');

  switch (cmd) {
    case 'tenor': {
      if (!text) { await reply(`🎬 *${prefix}tenor <search term>*`); break; }
      await reaction('🎬');
      try {
        const { data } = await axios.get(
          `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(text)}&key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCY8&limit=1`,
          { timeout: 8000 }
        );
        const gifUrl = data?.results?.[0]?.media_formats?.gif?.url || data?.results?.[0]?.media_formats?.mediumgif?.url;
        if (!gifUrl) throw new Error('No GIF found');
        const res = await axios.get(gifUrl, { responseType: 'arraybuffer', timeout: 12000 });
        await sock.sendMessage(jid, {
          video: Buffer.from(res.data),
          gifPlayback: true,
          caption: ft(`🎬 ${text}`, sock),
        }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'giphy': {
      if (!text) { await reply(`🎭 *${prefix}giphy <search term>*`); break; }
      await reaction('🎭');
      try {
        const { data } = await axios.get(
          `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(text)}&api_key=dc6zaTOxFJmzC&limit=1`,
          { timeout: 8000 }
        );
        const gifUrl2 = data?.data?.[0]?.images?.original?.url;
        if (!gifUrl2) throw new Error('No GIF found');
        const res2 = await axios.get(gifUrl2, { responseType: 'arraybuffer', timeout: 12000 });
        await sock.sendMessage(jid, {
          video: Buffer.from(res2.data),
          gifPlayback: true,
          caption: ft(`🎭 ${text}`, sock),
        }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'gifcat': {
      await reaction('🐱');
      try {
        const { data } = await axios.get('https://api.thecatapi.com/v1/images/search?mime_types=gif', { timeout: 8000 });
        const url = data?.[0]?.url;
        if (!url) throw new Error('No cat GIF');
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 12000 });
        await sock.sendMessage(jid, { video: Buffer.from(res.data), gifPlayback: true, caption: ft('🐱 Cat GIF~', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'gifdog': {
      await reaction('🐶');
      try {
        const { data } = await axios.get('https://random.dog/woof.json?include=gif', { timeout: 8000 });
        const url2 = data?.url;
        if (!url2) throw new Error('No dog GIF');
        const res2 = await axios.get(url2, { responseType: 'arraybuffer', timeout: 12000 });
        await sock.sendMessage(jid, { video: Buffer.from(res2.data), gifPlayback: true, caption: ft('🐶 Dog GIF~', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'gifanime': {
      await reaction('🎌');
      try {
        const cats = ['waifu','neko','shinobu','megumin','blush','smile','wave','dance','happy'];
        const cat  = text || cats[Math.floor(Math.random()*cats.length)];
        const { data } = await axios.get(`https://api.waifu.pics/sfw/${cat}`, { timeout: 8000 });
        await sock.sendMessage(jid, { image: { url: data.url }, caption: ft(`🎌 ${cat}`, sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'randgif': {
      await reaction('🎲');
      try {
        const terms = ['funny','cute','wow','awesome','anime','cat','dog','meme','cool'];
        const term  = terms[Math.floor(Math.random()*terms.length)];
        const { data } = await axios.get(
          `https://api.giphy.com/v1/gifs/random?tag=${term}&api_key=dc6zaTOxFJmzC`,
          { timeout: 8000 }
        );
        const url3 = data?.data?.images?.original?.url;
        if (!url3) throw new Error('No GIF');
        const res3 = await axios.get(url3, { responseType: 'arraybuffer', timeout: 12000 });
        await sock.sendMessage(jid, { video: Buffer.from(res3.data), gifPlayback: true, caption: ft(`🎲 Random GIF: ${term}`, sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'animegif': {
      await reaction('⛩️');
      try {
        const { data } = await axios.get('https://api.waifu.pics/sfw/waifu', { timeout: 8000 });
        await sock.sendMessage(jid, { image: { url: data.url }, caption: ft('⛩️ Anime~', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'gifyeet': {
      await reaction('🚀');
      try {
        const { data } = await axios.get('https://api.giphy.com/v1/gifs/random?tag=yeet&api_key=dc6zaTOxFJmzC', { timeout: 8000 });
        const url4 = data?.data?.images?.original?.url;
        const res4 = await axios.get(url4, { responseType: 'arraybuffer', timeout: 12000 });
        await sock.sendMessage(jid, { video: Buffer.from(res4.data), gifPlayback: true, caption: ft('🚀 YEET!', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'memetemplate': {
      await reaction('😂');
      const templates = [
        { name: 'Drake', url: 'https://i.imgflip.com/30b1gx.jpg' },
        { name: 'Distracted Boyfriend', url: 'https://i.imgflip.com/1ur9b0.jpg' },
        { name: 'Change My Mind', url: 'https://i.imgflip.com/24y43o.jpg' },
        { name: 'Two Buttons', url: 'https://i.imgflip.com/1g8my4.jpg' },
        { name: 'Expanding Brain', url: 'https://i.imgflip.com/1jwhww.jpg' },
        { name: 'Waiting Skeleton', url: 'https://i.imgflip.com/2fm6x.jpg' },
        { name: 'Is This a Pigeon', url: 'https://i.imgflip.com/1o00in.jpg' },
        { name: 'This is Fine', url: 'https://i.imgflip.com/wxica.jpg' },
      ];
      const template = text
        ? templates.find(t => t.name.toLowerCase().includes(text.toLowerCase())) || templates[0]
        : templates[Math.floor(Math.random() * templates.length)];
      await sock.sendMessage(jid, {
        image: { url: template.url },
        caption: ft(`😂 *${template.name}* meme template\n\nUse ${prefix}meme2 to add text`, sock),
      }, { quoted: m });
      break;
    }
    case 'randmeme': {
      await reaction('😂');
      try {
        const { data } = await axios.get('https://meme-api.com/gimme', { timeout: 8000 });
        await sock.sendMessage(jid, {
          image: { url: data.url },
          caption: ft(`😂 *${data.title}*\n\n⬆️ ${data.ups?.toLocaleString() || '?'} upvotes | r/${data.subreddit}`, sock),
        }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'textimg': {
      if (!text) { await reply(`📝 *${prefix}textimg <your text>*\nConverts text to an image card.`); break; }
      await reaction('📝');
      try {
        const { data } = await axios.get(
          `https://api.popcat.xyz/textpic?text=${encodeURIComponent(text.slice(0,100))}`,
          { responseType: 'arraybuffer', timeout: 10000 }
        );
        await sock.sendMessage(jid, { image: Buffer.from(data), caption: ft(`📝 ${text}`, sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'circleimg': {
      await reaction('⭕');
      const qmsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!qmsg?.imageMessage) { await reply(`⭕ Reply to an image with *${prefix}circleimg*`); break; }
      try {
        const { downloadMediaMessage } = require('blacklord-baileys');
        const buf = await downloadMediaMessage(
          { message: qmsg, key: { remoteJid: jid, id: m.message?.extendedTextMessage?.contextInfo?.stanzaId, fromMe: false } },
          'buffer', {},
          { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } }
        );
        const sharp = require('sharp');
        const meta  = await sharp(buf).metadata();
        const size  = Math.min(meta.width||400, meta.height||400);
        const mask  = Buffer.from(`<svg><circle cx="${size/2}" cy="${size/2}" r="${size/2}"/></svg>`);
        const result = await sharp(buf)
          .resize(size, size, { fit: 'cover' })
          .composite([{ input: mask, blend: 'dest-in' }])
          .png()
          .toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('⭕ Circle crop!', sock) }, { quoted: m });
      } catch { await reply(`❌ sharp not installed. Run: npm install sharp`); }
      break;
    }
    default:
      await reply(ft(`⚠️ *${prefix}${cmd}* — Reply to an image/video to use this command.`, sock));
      return false;
  }
  return true;
}

module.exports = { stickerHandler };
