// ============================================================
//   illusion.js  –  Image Illusion & Visual Effect Commands
//   Uses canvas, sharp, and public image APIs
// ============================================================
'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const ILLUSION_CMDS = [
  // Filters & effects
  'blur','sharpen','grayscale','invert','sepia','pixelate','mirror','flip','rotate90',
  // Overlays & frames
  'wanted','jail','rip','triggered','beauty','shine','rainbow',
  // Text on image
  'caption','meme2','demotivator','achievement',
  // Distort / illusion
  'glitch','deepfry','oil','sketch','neon','vaporwave','fisheye','zoom',
  // Anime / art style
  'animefy','cartoon','pop','comic',
  // Fun generators
  'burntext','spintext','neontext',
];

// ── Fetch buffer from quoted/arg image ──────────────────────
async function getImageBuf(m, args) {
  // Try quoted image
  const qmsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (qmsg?.imageMessage) {
    try {
      const { downloadMediaMessage } = require('blacklord-baileys');
      return await downloadMediaMessage(
        { message: qmsg, key: { remoteJid: m.key.remoteJid, id: m.message?.extendedTextMessage?.contextInfo?.stanzaId, fromMe: false } },
        'buffer', {},
        { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } }
      );
    } catch {}
  }
  // Try URL in args
  const url = args.find(a => a.startsWith('http'));
  if (url) {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    return Buffer.from(res.data);
  }
  return null;
}

// ── Apply effect via photon API (free tier) ──────────────────
async function applyPhotonEffect(imgBuf, effect) {
  try {
    const form = new (require('form-data'))();
    form.append('file', imgBuf, { filename: 'image.jpg', contentType: 'image/jpeg' });
    form.append('filter', effect);
    const { data } = await axios.post(
      'https://api.photonhq.io/v1/filter',
      form,
      { headers: form.getHeaders(), timeout: 15000, responseType: 'arraybuffer' }
    );
    return Buffer.from(data);
  } catch { return null; }
}

async function illusionHandler(sock, m, cmd, args, helpers) {
  if (!ILLUSION_CMDS.includes(cmd)) return false;
  const { reply, ft, cfg, reaction } = helpers;
  const jid    = m.key.remoteJid;
  const prefix = cfg(sock).prefix || '.';
  const text   = args.join(' ');

  // ── Helper: need an image ───────────────────────────────
  const needImg = async () => {
    const buf = await getImageBuf(m, args).catch(()=>null);
    if (!buf) {
      await reply(`🖼️ Reply to an image with *${prefix}${cmd}* or provide a URL.\nExample: *${prefix}${cmd} https://example.com/image.jpg*`);
      return null;
    }
    return buf;
  };

  switch (cmd) {

    // ── FILTERS ─────────────────────────────────────────────

    case 'blur': {
      await reaction('🌫️');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf).blur(10).toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🌫️ Blur effect', sock) }, { quoted: m });
      } catch {
        // API fallback
        try {
          const { data } = await axios.post(
            'https://api.imgbb.com/1/upload',
            new URLSearchParams({ key: 'demo', image: buf.toString('base64') }),
            { timeout: 10000 }
          );
          await reply(`🌫️ Blur: ${data?.data?.url || 'Use a local editor'}`);
        } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      }
      break;
    }

    case 'grayscale': {
      await reaction('⬛');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf).grayscale().toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('⬛ Grayscale', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'invert': {
      await reaction('🔄');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf).negate().toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🔄 Inverted', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'sepia': {
      await reaction('🟤');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        // Sepia via tint
        const result = await sharp(buf).grayscale().tint({ r: 112, g: 66, b: 20 }).toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🟤 Sepia', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'sharpen': {
      await reaction('🔪');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf).sharpen(5).toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🔪 Sharpened', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'mirror': {
      await reaction('🪞');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf).flop().toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🪞 Mirrored', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'flip': {
      await reaction('🙃');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf).flip().toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🙃 Flipped', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'rotate90': {
      await reaction('↩️');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf).rotate(90).toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('↩️ Rotated 90°', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'pixelate': {
      await reaction('🟫');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp = require('sharp');
        const meta  = await sharp(buf).metadata();
        const W = meta.width  || 400;
        const H = meta.height || 400;
        const px = Math.max(4, Math.floor(W / 40));
        const result = await sharp(buf)
          .resize(Math.floor(W/px), Math.floor(H/px), { kernel: 'nearest' })
          .resize(W, H, { kernel: 'nearest' })
          .toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🟫 Pixelated', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    // ── OVERLAY / FRAMES ─────────────────────────────────────

    case 'wanted': {
      await reaction('🤠');
      const buf = await needImg(); if (!buf) break;
      try {
        const { data } = await axios.get(
          `https://some-random-api.com/canvas/misc/wanted?avatar=${Buffer.from(buf).toString('base64')}`,
          { responseType: 'arraybuffer', timeout: 12000 }
        );
        await sock.sendMessage(jid, { image: Buffer.from(data), caption: ft('🤠 WANTED', sock) }, { quoted: m });
      } catch {
        // Use nekobot as fallback
        try {
          // Upload image to imgbb first
          const b64   = buf.toString('base64');
          const { data: up } = await axios.post(
            'https://api.imgbb.com/1/upload?key=free',
            new URLSearchParams({ image: b64 }),
            { timeout: 10000 }
          );
          const imgUrl = up?.data?.url;
          if (!imgUrl) throw new Error('Upload failed');
          const { data: nb } = await axios.get(
            `https://nekobot.xyz/api/imagegen?type=wanted&url=${encodeURIComponent(imgUrl)}`,
            { timeout: 12000 }
          );
          await sock.sendMessage(jid, { image: { url: nb.message }, caption: ft('🤠 WANTED', sock) }, { quoted: m });
        } catch (e) { await reply(`❌ Failed: ${e.message}`); }
      }
      break;
    }

    case 'jail': {
      await reaction('🔒');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const imgUrl = up?.data?.url;
        const { data } = await axios.get(
          `https://nekobot.xyz/api/imagegen?type=jail&url=${encodeURIComponent(imgUrl)}`,
          { timeout: 12000 }
        );
        await sock.sendMessage(jid, { image: { url: data.message }, caption: ft('🔒 You\'re in jail!', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'triggered': {
      await reaction('😡');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const imgUrl = up?.data?.url;
        const { data } = await axios.get(
          `https://nekobot.xyz/api/imagegen?type=triggered&url=${encodeURIComponent(imgUrl)}`,
          { timeout: 12000 }
        );
        await sock.sendMessage(jid, { image: { url: data.message }, caption: ft('😡 TRIGGERED', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'rip': {
      await reaction('🪦');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const imgUrl = up?.data?.url;
        const { data } = await axios.get(
          `https://nekobot.xyz/api/imagegen?type=rip&url=${encodeURIComponent(imgUrl)}`,
          { timeout: 12000 }
        );
        await sock.sendMessage(jid, { image: { url: data.message }, caption: ft('🪦 R.I.P', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'beauty': {
      await reaction('✨');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const imgUrl = up?.data?.url;
        const score  = Math.floor(Math.random() * 30 + 70);
        await sock.sendMessage(jid, {
          image: { url: imgUrl },
          caption: ft(`✨ *Beauty Score*\n\n${'⭐'.repeat(Math.round(score/20))} ${score}/100\n\n_Powered by Anime MD_`, sock),
        }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'rainbow': {
      await reaction('🌈');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const imgUrl = up?.data?.url;
        const { data } = await axios.get(
          `https://nekobot.xyz/api/imagegen?type=colorfy&color=rainbow&url=${encodeURIComponent(imgUrl)}`,
          { timeout: 12000 }
        );
        await sock.sendMessage(jid, { image: { url: data.message }, caption: ft('🌈 Rainbow', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    // ── TEXT EFFECTS ─────────────────────────────────────────

    case 'caption': {
      if (!text) { await reply(`📝 *${prefix}caption <text>*\nReply to an image.`); break; }
      await reaction('📝');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const imgUrl = up?.data?.url;
        const { data } = await axios.get(
          `https://nekobot.xyz/api/imagegen?type=captcha&url=${encodeURIComponent(imgUrl)}&username=${encodeURIComponent(text.slice(0,50))}`,
          { timeout: 12000 }
        );
        await sock.sendMessage(jid, { image: { url: data.message }, caption: ft(`📝 ${text}`, sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'meme2': {
      const parts3 = text.split('|');
      const top    = (parts3[0]||'Top text').trim();
      const bottom = (parts3[1]||'Bottom text').trim();
      if (!text) { await reply(`😂 *${prefix}meme2 top text | bottom text*\nReply to an image.`); break; }
      await reaction('😂');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const { data } = await axios.get(
          `https://nekobot.xyz/api/imagegen?type=meme&image=${encodeURIComponent(up?.data?.url)}&top=${encodeURIComponent(top)}&bottom=${encodeURIComponent(bottom)}`,
          { timeout: 12000 }
        );
        await sock.sendMessage(jid, { image: { url: data.message }, caption: ft(`😂 ${top} / ${bottom}`, sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'demotivator': {
      const parts4 = text.split('|');
      if (!text) { await reply(`😔 *${prefix}demotivator title | subtitle*\nReply to an image.`); break; }
      await reaction('😔');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const title    = (parts4[0]||'Title').trim();
        const subtitle = (parts4[1]||'Subtitle').trim();
        const { data } = await axios.get(
          `https://nekobot.xyz/api/imagegen?type=demotivational&image=${encodeURIComponent(up?.data?.url)}&title=${encodeURIComponent(title)}&text=${encodeURIComponent(subtitle)}`,
          { timeout: 12000 }
        );
        await sock.sendMessage(jid, { image: { url: data.message }, caption: ft(`😔 ${title}`, sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'achievement': {
      if (!text) { await reply(`🏆 *${prefix}achievement <text>*`); break; }
      await reaction('🏆');
      try {
        const { data } = await axios.get(
          `https://api.popcat.xyz/achievement?icon=1&text=${encodeURIComponent(text.slice(0,50))}`,
          { responseType: 'arraybuffer', timeout: 10000 }
        );
        await sock.sendMessage(jid, { image: Buffer.from(data), caption: ft(`🏆 ${text}`, sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    // ── DISTORT / ILLUSION ───────────────────────────────────

    case 'glitch': {
      await reaction('📺');
      const buf = await needImg(); if (!buf) break;
      try {
        // Simple glitch via channel shift with sharp
        const sharp  = require('sharp');
        const raw    = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
        const pixels = raw.data;
        const W2     = raw.info.width;
        const H2     = raw.info.height;
        // Shift red channel by random offset
        for (let y = 0; y < H2; y += Math.floor(Math.random()*20)) {
          const shift = Math.floor(Math.random()*30)-15;
          for (let x = 0; x < W2; x++) {
            const srcX = Math.max(0, Math.min(W2-1, x+shift));
            const dst  = (y*W2+x)*raw.info.channels;
            const src  = (y*W2+srcX)*raw.info.channels;
            pixels[dst] = pixels[src];
          }
        }
        const result = await sharp(pixels, { raw: raw.info }).jpeg().toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('📺 Glitch effect', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'deepfry': {
      await reaction('🍟');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf)
          .jpeg({ quality: 1 })
          .sharpen(20)
          .gamma(2.5)
          .toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🍟 Deep Fried 🔥', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'sketch': {
      await reaction('✏️');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf).grayscale().sharpen(15).toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('✏️ Sketch effect', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'neon': {
      await reaction('💡');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const { data } = await axios.get(
          `https://api.photor.io/photo_editor?source=${encodeURIComponent(up?.data?.url)}&effect=neon`,
          { timeout: 12000, responseType: 'arraybuffer' }
        );
        await sock.sendMessage(jid, { image: Buffer.from(data), caption: ft('💡 Neon effect', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'vaporwave': {
      await reaction('🌊');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        // Vaporwave: boost saturation, pink/purple tint
        const result = await sharp(buf)
          .modulate({ saturation: 2.5, brightness: 1.1 })
          .tint({ r: 255, g: 0, b: 200 })
          .toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🌊 Vaporwave', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'fisheye': {
      await reaction('🐟');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const meta   = await sharp(buf).metadata();
        const W3     = meta.width  || 400;
        const H3     = meta.height || 400;
        // Approximate fisheye: resize up then crop center
        const result = await sharp(buf)
          .resize(Math.floor(W3*1.5), Math.floor(H3*1.5))
          .extract({ left: Math.floor(W3*0.25), top: Math.floor(H3*0.25), width: W3, height: H3 })
          .toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🐟 Fisheye lens', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'zoom': {
      await reaction('🔍');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const meta   = await sharp(buf).metadata();
        const W4     = meta.width  || 400;
        const H4     = meta.height || 400;
        const result = await sharp(buf)
          .extract({ left: Math.floor(W4*0.25), top: Math.floor(H4*0.25), width: Math.floor(W4*0.5), height: Math.floor(H4*0.5) })
          .resize(W4, H4)
          .toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🔍 Zoomed in 2x', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'oil': {
      await reaction('🖼️');
      const buf = await needImg(); if (!buf) break;
      // Use online API
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const { data } = await axios.get(
          `https://api.photor.io/photo_editor?source=${encodeURIComponent(up?.data?.url)}&effect=oil_painting`,
          { responseType: 'arraybuffer', timeout: 12000 }
        );
        await sock.sendMessage(jid, { image: Buffer.from(data), caption: ft('🖼️ Oil Painting', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    // ── ART STYLE ────────────────────────────────────────────

    case 'animefy': {
      await reaction('🎌');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const { data } = await axios.get(
          `https://api.cartoonizer.net/api/cartoon?imageurl=${encodeURIComponent(up?.data?.url)}&style=anime`,
          { responseType: 'arraybuffer', timeout: 20000 }
        );
        await sock.sendMessage(jid, { image: Buffer.from(data), caption: ft('🎌 Anime style!', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}\n\nTry another image or URL`); }
      break;
    }

    case 'cartoon': {
      await reaction('🎨');
      const buf = await needImg(); if (!buf) break;
      try {
        const b64 = buf.toString('base64');
        const { data: up } = await axios.post(
          'https://api.imgbb.com/1/upload?key=free',
          new URLSearchParams({ image: b64 }),
          { timeout: 10000 }
        );
        const { data } = await axios.get(
          `https://nekobot.xyz/api/imagegen?type=colorfy&image=${encodeURIComponent(up?.data?.url)}`,
          { timeout: 12000 }
        );
        await sock.sendMessage(jid, { image: { url: data.message }, caption: ft('🎨 Cartoon style', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'pop': {
      await reaction('🎭');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf).modulate({ saturation: 4, brightness: 1.2 }).toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('🎭 Pop Art', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    case 'comic': {
      await reaction('💥');
      const buf = await needImg(); if (!buf) break;
      try {
        const sharp  = require('sharp');
        const result = await sharp(buf)
          .grayscale()
          .threshold(128)
          .toBuffer();
        await sock.sendMessage(jid, { image: result, caption: ft('💥 Comic style', sock) }, { quoted: m });
      } catch { await reply(`❌ Sharp not installed. Run: npm install sharp`); }
      break;
    }

    // ── TEXT GENERATORS ──────────────────────────────────────

    case 'burntext': {
      if (!text) { await reply(`🔥 *${prefix}burntext <your text>*`); break; }
      await reaction('🔥');
      try {
        const { data } = await axios.get(
          `https://api.popcat.xyz/burn?text=${encodeURIComponent(text.slice(0,50))}`,
          { responseType: 'arraybuffer', timeout: 10000 }
        );
        await sock.sendMessage(jid, { image: Buffer.from(data), caption: ft(`🔥 ${text}`, sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'neontext': {
      if (!text) { await reply(`💡 *${prefix}neontext <your text>*`); break; }
      await reaction('💡');
      try {
        const { data } = await axios.get(
          `https://api.popcat.xyz/neon?text=${encodeURIComponent(text.slice(0,30))}`,
          { responseType: 'arraybuffer', timeout: 10000 }
        );
        await sock.sendMessage(jid, { image: Buffer.from(data), caption: ft(`💡 ${text}`, sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'spintext': {
      if (!text) { await reply(`🔄 *${prefix}spintext <your text>*`); break; }
      await reaction('🔄');
      const spins = ['◢◣◤◥','↑↗→↘↓↙←↖','⠁⠂⠄⡀⢀⠠⠐⠈','⣾⣽⣻⢿⡿⣟⣯⣷'];
      const spinner = spins[Math.floor(Math.random()*spins.length)];
      await reply(ft(`🔄 Spinning: *${text}*\n\n${spinner.split('').join(' ')} ${text} ${spinner.split('').reverse().join(' ')}`, sock));
      break;
    }

    default:
      return false;
  }
  return true;
}

module.exports = { illusionHandler};
