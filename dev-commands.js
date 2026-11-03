// ============================================================
//   dev-commands.js  –  Developer & Encryption Commands
//   Drop-in alongside case.js – imported in index.js
//   Covers: enc/decrypt for JS/HTML/PY/JSON, + 20+ dev tools
// ============================================================
'use strict';

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const { exec, execSync } = require('child_process');

// ── Reuse helpers from case.js context ───────────────────────
// (these are passed in via the handler call – see bottom of file)

// ── Obfuscation config factory ───────────────────────────────
function makeJsConfuserOpts(preset = 'high') {
  // Safe options compatible with js-confuser v2 and v3
  // Options that were removed in newer versions are excluded
  const base = {
    target:  'node',
    compact: true,
    minify:  true,
    identifierGenerator: function () {
      const seed  = '𝑻𝑨𝑳𝑲𝑳𝑬𝑺𝑺 × 𝑱𝑨𝑮𝑼𝑨𝑹';
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
      const rand  = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      return '_' + seed.slice(0, 6) + rand;
    },
    renameVariables:    true,
    renameGlobals:      true,
    stringConcealing:   true,
    stringEncoding:     true,
    controlFlowFlattening: 0.75,
    deadCode:           false,
    dispatcher:         true,
    opaquePredicates:   0.5,
    duplicateLiteralsRemoval: 0.5,
    shuffle:            true,
    globalConcealing:   true,
    objectExtraction:   true,
  };

  if (preset === 'high') {
    base.controlFlowFlattening = 1.0;
    base.opaquePredicates      = 0.9;
    base.duplicateLiteralsRemoval = 1.0;
  }

  return base;
}

// ── HTML minifier / obfuscator ────────────────────────────────
function obfuscateHtml(html) {
  // Comment removal, whitespace collapse, inline script obfuscation
  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')         // remove comments
    .replace(/\s{2,}/g, ' ')                 // collapse whitespace
    .replace(/>\s+</g, '><')                 // remove space between tags
    .trim();
  // Base64-encode inline scripts
  out = out.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (match, code) => {
    if (!code.trim()) return match;
    const b64 = Buffer.from(code.trim()).toString('base64');
    return `<script>eval(atob('${b64}'))</script>`;
  });
  return out;
}

// ── Python obfuscator (pyarmor-style manual) ──────────────────
function obfuscatePython(code) {
  // Encode the entire script in base64, wrap in exec(compile(...))
  const b64  = Buffer.from(code).toString('base64');
  const stub = `import base64,marshal,types\nexec(compile(base64.b64decode('${b64}').decode(),'<string>','exec'))`;
  return stub;
}

// ── JSON obfuscator – variable-map encoding ───────────────────
function obfuscateJson(jsonStr) {
  try {
    const obj  = JSON.parse(jsonStr);
    const keys = [];
    const vals = [];
    const flattenObj = (o, prefix = '') => {
      for (const [k, v] of Object.entries(o)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          flattenObj(v, fullKey);
        } else {
          keys.push(fullKey);
          vals.push(JSON.stringify(v));
        }
      }
    };
    flattenObj(obj);
    const varName = '_a' + Math.random().toString(36).slice(2, 7);
    const encoded = Buffer.from(jsonStr).toString('base64');
    return `// Encoded JSON – Anime MD\nconst ${varName}='${encoded}';\nmodule.exports=JSON.parse(Buffer.from(${varName},'base64').toString());`;
  } catch {
    // Fallback if not valid JSON
    const encoded = Buffer.from(jsonStr).toString('base64');
    return `// Encoded – Anime MD\nconst _d='${encoded}';\nmodule.exports=JSON.parse(Buffer.from(_d,'base64').toString());`;
  }
}

// ── JS decryptor – remove obfuscation artifacts ───────────────
function deobfuscateJs(code) {
  // Basic: unescape hex, decode base64 strings, remove control flow bloat
  let out = code;
  // Hex string literals  "\x41\x42" → "AB"
  out = out.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // Unicode escapes \u0041 → A
  out = out.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // atob(...) calls → decode
  out = out.replace(/atob\(['"`]([A-Za-z0-9+/=]+)['"`]\)/g, (_, b64) => {
    try { return `'${Buffer.from(b64, 'base64').toString()}'`; } catch { return _; }
  });
  // Remove obvious dead code: if(false){...}
  out = out.replace(/if\s*\(\s*false\s*\)\s*\{[^}]*\}/g, '');
  // Remove void 0 assignments
  out = out.replace(/void\s+0/g, 'undefined');
  return out;
}

// ── HTML decoder ──────────────────────────────────────────────
function deobfuscateHtml(html) {
  // Decode base64 script blocks
  return html.replace(/<script[^>]*>\s*eval\(atob\(['"`]([A-Za-z0-9+/=]+)['"`]\)\)\s*<\/script>/gi,
    (_, b64) => {
      try {
        const decoded = Buffer.from(b64, 'base64').toString();
        return `<script>\n${decoded}\n</script>`;
      } catch { return _; }
    }
  );
}

// ── Python decoder ────────────────────────────────────────────
function deobfuscatePython(code) {
  const m = code.match(/base64\.b64decode\('([A-Za-z0-9+/=]+)'\)/);
  if (m) {
    try { return Buffer.from(m[1], 'base64').toString(); } catch {}
  }
  return code;
}

// ── JSON decoder ──────────────────────────────────────────────
function deobfuscateJson(code) {
  const m = code.match(/_[a-z0-9]+='([A-Za-z0-9+/=]+)'/);
  if (m) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString();
      return JSON.stringify(JSON.parse(decoded), null, 2);
    } catch {}
  }
  return code;
}

// ════════════════════════════════════════════════════════════
//   DEV COMMAND HANDLER
//   Call: await devHandler(sock, m, cmd, args, helpers)
//   helpers = { reply, replyImg, ft, cfg, dlMedia, react, normNum, getQuoted }
// ════════════════════════════════════════════════════════════
async function devHandler(sock, m, cmd, args, helpers) {
  const { reply, replyImg, ft, cfg, dlMedia, react, normNum, getQuoted } = helpers;
  const jid = m.key.remoteJid;
  const c   = cfg(sock);

  // Helper: send document reply
  async function replyDoc(buf, fileName, caption = '', mimetype = 'application/octet-stream') {
    if (c.iphoneMode) return reply(sock, m, caption || fileName);
    return sock.sendMessage(jid, { document: buf, fileName, mimetype, caption: ft(caption, sock) }, { quoted: m });
  }

  // Helper: get code from quoted document or inline text
  async function getCode() {
    const { qMsg, qType, qKey } = getQuoted(m);
    // Quoted document – download directly
    if (qType === 'documentMessage') {
      const { downloadMediaMessage: _dlCode } = require('@whiskeysockets/baileys');
      const _buf = await _dlCode(
        { message: { documentMessage: qMsg.documentMessage }, key: qKey },
        'buffer', {},
        { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } }
      );
      if (!Buffer.isBuffer(_buf) || _buf.length < 1) return null;
      return { code: _buf.toString('utf8'), fileName: qMsg.documentMessage?.fileName || 'file.txt' };
    }
    // Quoted text
    if (qMsg) {
      const txt = qMsg.conversation || qMsg.extendedTextMessage?.text || '';
      if (txt) return { code: txt, fileName: 'code.txt' };
    }
    // Inline args
    const inline = args.join(' ');
    if (inline) return { code: inline, fileName: 'code.txt' };
    return null;
  }

  switch (cmd) {

    // ── ENCRYPT JS ───────────────────────────────────────────
    case 'encjs':
    case 'enc':
    case 'encrypt': {
      const { qMsg, qType, qKey } = getQuoted(m);
      if (!qMsg || qType !== 'documentMessage') {
        await reply(sock, m, '❌ Reply to a .js document with .encjs'); break;
      }
      const docMsg = qMsg.documentMessage;
      if (!docMsg?.fileName?.endsWith('.js')) {
        await reply(sock, m, '❌ Only .js files. Use .enchtml .encpy .encjson for others.'); break;
      }
      await react(sock, m, '🕛');
      try {
        // Download using baileys directly – guaranteed Buffer
        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        const rawBuf = await downloadMediaMessage(
          { message: { documentMessage: docMsg }, key: qKey },
          'buffer', {},
          { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } }
        );
        // Ensure we have a real Buffer with actual content
        if (!rawBuf || !Buffer.isBuffer(rawBuf) || rawBuf.length < 2) {
          throw new Error('Download returned empty buffer – try sending the file again');
        }
        const code = rawBuf.toString('utf8');
        if (!code || code.trim().length === 0) {
          throw new Error('File appears empty');
        }
        const JsConfuser = require('js-confuser');
        const obfuscated = await JsConfuser.obfuscate(code, makeJsConfuserOpts('high'));
        // obfuscate returns a string in v2, object with code property in some builds
        const outCode = typeof obfuscated === 'string' ? obfuscated : (obfuscated?.code || String(obfuscated));
        await react(sock, m, '✅');
        await replyDoc(
          Buffer.from(outCode, 'utf8'),
          docMsg.fileName,
          ft('✅ Encrypted\nType: Hard (js-confuser)\nBy: Anime MD', sock),
          'application/javascript'
        );
      } catch (e) {
        await react(sock, m, '❌');
        await reply(sock, m, '❌ Encrypt failed: ' + e.message);
      }
      break;
    }

    // ── ENCRYPT HTML ─────────────────────────────────────────
    case 'enchtml': {
      const { qMsg, qType, qKey } = getQuoted(m);
      if (!qMsg || qType !== 'documentMessage') { await reply(sock, m, '❌ Reply to an .html file.'); break; }
      await react(sock, m, '🕛');
      try {
        const { downloadMediaMessage: _dlHtml } = require('@whiskeysockets/baileys');
        const _bufHtml = await _dlHtml({ message: { documentMessage: qMsg.documentMessage }, key: qKey }, 'buffer', {}, { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } });
        if (!Buffer.isBuffer(_bufHtml) || _bufHtml.length < 2) throw new Error('Download failed');
        const result   = obfuscateHtml(_bufHtml.toString('utf8'));
        await react(sock, m, '✅');
        await replyDoc(
          Buffer.from(result, 'utf8'),
          qMsg.documentMessage.fileName || 'encrypted.html',
          ft('✅ HTML encrypted\nBy: Anime MD', sock),
          'text/html'
        );
      } catch (e) { await react(sock, m, '❌'); await reply(sock, m, '❌ ' + e.message); }
      break;
    }

    // ── ENCRYPT PYTHON ───────────────────────────────────────
    case 'encpy':
    case 'encpython': {
      const { qMsg, qType, qKey } = getQuoted(m);
      if (!qMsg || qType !== 'documentMessage') { await reply(sock, m, '❌ Reply to a .py file.'); break; }
      await react(sock, m, '🕛');
      try {
        const { downloadMediaMessage: _dlPy } = require('@whiskeysockets/baileys');
        const _bufPy = await _dlPy({ message: { documentMessage: qMsg.documentMessage }, key: qKey }, 'buffer', {}, { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } });
        if (!Buffer.isBuffer(_bufPy) || _bufPy.length < 2) throw new Error('Download failed');
        const result = obfuscatePython(_bufPy.toString('utf8'));
        await react(sock, m, '✅');
        await replyDoc(
          Buffer.from(result, 'utf8'),
          qMsg.documentMessage.fileName || 'encrypted.py',
          ft('✅ Python encrypted\nBy: Anime MD', sock),
          'text/x-python'
        );
      } catch (e) { await react(sock, m, '❌'); await reply(sock, m, '❌ ' + e.message); }
      break;
    }

    // ── ENCRYPT JSON ─────────────────────────────────────────
    case 'encjson': {
      const { qMsg, qType, qKey } = getQuoted(m);
      if (!qMsg || qType !== 'documentMessage') { await reply(sock, m, '❌ Reply to a .json file.'); break; }
      await react(sock, m, '🕛');
      try {
        const { downloadMediaMessage: _dlJson } = require('@whiskeysockets/baileys');
        const _bufJson = await _dlJson({ message: { documentMessage: qMsg.documentMessage }, key: qKey }, 'buffer', {}, { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } });
        if (!Buffer.isBuffer(_bufJson) || _bufJson.length < 2) throw new Error('Download failed');
        const result = obfuscateJson(_bufJson.toString('utf8'));
        await react(sock, m, '✅');
        await replyDoc(
          Buffer.from(result, 'utf8'),
          (qMsg.documentMessage.fileName || 'encrypted') + '.js',
          ft('✅ JSON encrypted/encoded\nBy: Anime MD', sock),
          'application/javascript'
        );
      } catch (e) { await react(sock, m, '❌'); await reply(sock, m, '❌ ' + e.message); }
      break;
    }

    // ── DECRYPT JS ───────────────────────────────────────────
    case 'decjs':
    case 'decrypt': {
      const { qMsg, qType, qKey } = getQuoted(m);
      if (!qMsg || qType !== 'documentMessage') { await reply(sock, m, '❌ Reply to an obfuscated .js file.'); break; }
      await react(sock, m, '🕛');
      try {
        const { downloadMediaMessage: _dlDecJs } = require('@whiskeysockets/baileys');
        const _bufDecJs = await _dlDecJs({ message: { documentMessage: qMsg.documentMessage }, key: qKey }, 'buffer', {}, { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } });
        if (!Buffer.isBuffer(_bufDecJs) || _bufDecJs.length < 2) throw new Error('Download failed');
        const result = deobfuscateJs(_bufDecJs.toString('utf8'));
        await react(sock, m, '✅');
        await replyDoc(
          Buffer.from(result, 'utf8'),
          qMsg.documentMessage.fileName || 'decrypted.js',
          ft('✅ JS de-obfuscated\nNote: Full reversal not possible for heavy obfuscation\nBy: Anime MD', sock),
          'application/javascript'
        );
      } catch (e) { await react(sock, m, '❌'); await reply(sock, m, '❌ ' + e.message); }
      break;
    }

    // ── DECRYPT HTML ─────────────────────────────────────────
    case 'dechtml': {
      const { qMsg, qType, qKey } = getQuoted(m);
      if (!qMsg || qType !== 'documentMessage') { await reply(sock, m, '❌ Reply to an encoded .html file.'); break; }
      await react(sock, m, '🕛');
      try {
        const { downloadMediaMessage: _dlDecHtml } = require('@whiskeysockets/baileys');
        const _bufDecHtml = await _dlDecHtml({ message: { documentMessage: qMsg.documentMessage }, key: qKey }, 'buffer', {}, { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } });
        if (!Buffer.isBuffer(_bufDecHtml) || _bufDecHtml.length < 2) throw new Error('Download failed');
        const result = deobfuscateHtml(_bufDecHtml.toString('utf8'));
        await react(sock, m, '✅');
        await replyDoc(Buffer.from(result, 'utf8'), qMsg.documentMessage.fileName || 'decoded.html', ft('✅ HTML decoded\nBy: Anime MD', sock), 'text/html');
      } catch (e) { await react(sock, m, '❌'); await reply(sock, m, '❌ ' + e.message); }
      break;
    }

    // ── DECRYPT PYTHON ───────────────────────────────────────
    case 'decpy': {
      const { qMsg, qType, qKey } = getQuoted(m);
      if (!qMsg || qType !== 'documentMessage') { await reply(sock, m, '❌ Reply to an encoded .py file.'); break; }
      await react(sock, m, '🕛');
      try {
        const { downloadMediaMessage: _dlDecPy } = require('@whiskeysockets/baileys');
        const _bufDecPy = await _dlDecPy({ message: { documentMessage: qMsg.documentMessage }, key: qKey }, 'buffer', {}, { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } });
        if (!Buffer.isBuffer(_bufDecPy) || _bufDecPy.length < 2) throw new Error('Download failed');
        const result = deobfuscatePython(_bufDecPy.toString('utf8'));
        await react(sock, m, '✅');
        await replyDoc(Buffer.from(result, 'utf8'), qMsg.documentMessage.fileName || 'decoded.py', ft('✅ Python decoded\nBy: Anime MD', sock), 'text/x-python');
      } catch (e) { await react(sock, m, '❌'); await reply(sock, m, '❌ ' + e.message); }
      break;
    }

    // ── DECRYPT JSON ─────────────────────────────────────────
    case 'decjson': {
      const src = await getCode();
      if (!src) { await reply(sock, m, '❌ Reply to encoded JSON/JS or paste code.'); break; }
      await react(sock, m, '🕛');
      try {
        const result = deobfuscateJson(src.code);
        await react(sock, m, '✅');
        await replyDoc(Buffer.from(result, 'utf8'), 'decoded.json', ft('✅ JSON decoded\nBy: Anime MD', sock), 'application/json');
      } catch (e) { await react(sock, m, '❌'); await reply(sock, m, '❌ ' + e.message); }
      break;
    }

    // ── MINIFY JS ────────────────────────────────────────────
    case 'minifyjs':
    case 'minify': {
      const src = await getCode();
      if (!src) { await reply(sock, m, '❌ Reply to a .js file or paste code.'); break; }
      await react(sock, m, '🕛');
      try {
        const { minify } = require('terser');
        const result = await minify(src.code, { compress: true, mangle: true });
        await react(sock, m, '✅');
        const original = Buffer.byteLength(src.code);
        const minified = Buffer.byteLength(result.code);
        const saving   = Math.round((1 - minified / original) * 100);
        await replyDoc(
          Buffer.from(result.code, 'utf8'),
          src.fileName.replace(/\.js$/, '.min.js'),
          ft(`✅ Minified JS\nOriginal: ${original}B → Minified: ${minified}B (${saving}% smaller)\nBy: Anime MD`, sock),
          'application/javascript'
        );
      } catch (e) { await react(sock, m, '❌'); await reply(sock, m, '❌ Minify failed (install terser): ' + e.message); }
      break;
    }

    // ── FORMAT / PRETTIFY JS ─────────────────────────────────
    case 'prettify':
    case 'formatjs':
    case 'beautify': {
      const src = await getCode();
      if (!src) { await reply(sock, m, '❌ Reply to a file or paste code.'); break; }
      await react(sock, m, '🕛');
      try {
        const prettier = require('prettier');
        const result   = await prettier.format(src.code, { parser: 'babel', tabWidth: 2, semi: true, singleQuote: true });
        await react(sock, m, '✅');
        await replyDoc(Buffer.from(result, 'utf8'), src.fileName, ft('✅ Code formatted\nBy: Anime MD', sock), 'application/javascript');
      } catch (e) {
        // Fallback basic indent
        await react(sock, m, '❌');
        await reply(sock, m, '❌ Prettier failed (install prettier): ' + e.message);
      }
      break;
    }

    // ── FORMAT JSON ──────────────────────────────────────────
    case 'formatjson':
    case 'prettyjson': {
      const src = await getCode();
      if (!src) { await reply(sock, m, '❌ Reply to a JSON file or paste JSON.'); break; }
      try {
        const pretty = JSON.stringify(JSON.parse(src.code), null, 2);
        await replyDoc(Buffer.from(pretty, 'utf8'), 'formatted.json', ft('✅ JSON formatted\nBy: Anime MD', sock), 'application/json');
      } catch (e) { await reply(sock, m, '❌ Invalid JSON: ' + e.message); }
      break;
    }

    // ── VALIDATE JSON ────────────────────────────────────────
    case 'jsoncheck':
    case 'validatejson': {
      const src = await getCode();
      if (!src) { await reply(sock, m, '❌ Reply to or paste JSON.'); break; }
      try {
        const parsed = JSON.parse(src.code);
        const keys   = Object.keys(parsed).length;
        await reply(sock, m, ft(`✅ Valid JSON\nKeys: ${keys}\nSize: ${Buffer.byteLength(src.code)}B`, sock));
      } catch (e) { await reply(sock, m, ft(`❌ Invalid JSON\nError: ${e.message}`, sock)); }
      break;
    }

    // ── BASE64 ENCODE ────────────────────────────────────────
    case 'b64enc':
    case 'base64encode': {
      const text = args.join(' ');
      if (!text) { await reply(sock, m, '.b64enc <text>'); break; }
      await reply(sock, m, ft('🔒 Base64:\n' + Buffer.from(text).toString('base64'), sock));
      break;
    }

    // ── BASE64 DECODE ────────────────────────────────────────
    case 'b64dec':
    case 'base64decode': {
      const text = args.join(' ');
      if (!text) { await reply(sock, m, '.b64dec <base64>'); break; }
      try { await reply(sock, m, ft('🔓 Decoded:\n' + Buffer.from(text, 'base64').toString(), sock)); }
      catch (e) { await reply(sock, m, '❌ Invalid base64: ' + e.message); }
      break;
    }

    // ── HEX ENCODE ───────────────────────────────────────────
    case 'hexenc': {
      const text = args.join(' ');
      if (!text) { await reply(sock, m, '.hexenc <text>'); break; }
      await reply(sock, m, ft('🔒 Hex:\n' + Buffer.from(text).toString('hex'), sock));
      break;
    }

    // ── HEX DECODE ───────────────────────────────────────────
    case 'hexdec': {
      const text = args.join(' ');
      if (!text) { await reply(sock, m, '.hexdec <hex>'); break; }
      try { await reply(sock, m, ft('🔓 Decoded:\n' + Buffer.from(text, 'hex').toString(), sock)); }
      catch (e) { await reply(sock, m, '❌ Invalid hex: ' + e.message); }
      break;
    }

    // ── MD5 HASH ─────────────────────────────────────────────
    case 'md5': {
      const text = args.join(' ');
      if (!text) { await reply(sock, m, '.md5 <text>'); break; }
      const { createHash } = require('crypto');
      await reply(sock, m, ft('🔐 MD5:\n' + createHash('md5').update(text).digest('hex'), sock));
      break;
    }

    // ── SHA256 HASH ──────────────────────────────────────────
    case 'sha256': {
      const text = args.join(' ');
      if (!text) { await reply(sock, m, '.sha256 <text>'); break; }
      const { createHash } = require('crypto');
      await reply(sock, m, ft('🔐 SHA256:\n' + createHash('sha256').update(text).digest('hex'), sock));
      break;
    }

    // ── SHA512 ───────────────────────────────────────────────
    case 'sha512': {
      const text = args.join(' ');
      if (!text) { await reply(sock, m, '.sha512 <text>'); break; }
      const { createHash } = require('crypto');
      await reply(sock, m, ft('🔐 SHA512:\n' + createHash('sha512').update(text).digest('hex'), sock));
      break;
    }

    // ── UUID GENERATE ────────────────────────────────────────
    case 'uuid': {
      const { randomUUID } = require('crypto');
      const count = Math.min(parseInt(args[0]) || 1, 10);
      const list  = Array.from({ length: count }, () => randomUUID()).join('\n');
      await reply(sock, m, ft(`🆔 UUID${count > 1 ? 's' : ''}:\n${list}`, sock));
      break;
    }

    // ── RANDOM PASSWORD ──────────────────────────────────────
    case 'genpass':
    case 'password': {
      const len    = Math.min(parseInt(args[0]) || 16, 64);
      const chars  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
      const { randomBytes } = require('crypto');
      const bytes  = randomBytes(len);
      const pass   = Array.from(bytes, b => chars[b % chars.length]).join('');
      await reply(sock, m, ft(`🔑 Generated password (${len} chars):\n${pass}`, sock));
      break;
    }

    // ── IP LOOKUP ────────────────────────────────────────────
    case 'iplookup':
    case 'ipinfo': {
      const ip = args[0];
      if (!ip) { await reply(sock, m, '.ipinfo <ip address>'); break; }
      try {
        const r = await axios.get(`http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,isp,org,lat,lon,timezone,query`, { timeout: 8000 });
        if (r.data.status !== 'success') throw new Error(r.data.message || 'Failed');
        const d = r.data;
        await reply(sock, m, ft(
          `🌐 IP Info: ${d.query}\n\n` +
          `🗺 Country: ${d.country}\n` +
          `🏙 Region: ${d.regionName}\n` +
          `🏛 City: ${d.city}\n` +
          `📡 ISP: ${d.isp}\n` +
          `🏢 Org: ${d.org}\n` +
          `🕒 Timezone: ${d.timezone}\n` +
          `📍 Coords: ${d.lat}, ${d.lon}`, sock
        ));
      } catch (e) { await reply(sock, m, '❌ IP lookup failed: ' + e.message); }
      break;
    }

    // ── WHOIS ────────────────────────────────────────────────
    case 'whois': {
      const domain = args[0];
      if (!domain) { await reply(sock, m, '.whois <domain>'); break; }
      try {
        const r = await axios.get(`https://api.domainsdb.info/v1/domains/search?domain=${domain}&zone=com`, { timeout: 10000 });
        const d = r.data.domains?.[0];
        if (!d) { await reply(sock, m, '❌ No WHOIS data found.'); break; }
        await reply(sock, m, ft(
          `🔍 WHOIS: ${domain}\n\n` +
          `📛 Domain: ${d.domain}\n` +
          `🌐 Zone: ${d.zone}\n` +
          `📅 Created: ${d.create_date}\n` +
          `🔄 Updated: ${d.update_date}\n` +
          `🔒 Country: ${d.country || 'N/A'}`, sock
        ));
      } catch (e) { await reply(sock, m, '❌ WHOIS failed: ' + e.message); }
      break;
    }

    // ── DNS LOOKUP ───────────────────────────────────────────
    case 'dns': {
      const domain = args[0];
      const type   = (args[1] || 'A').toUpperCase();
      if (!domain) { await reply(sock, m, '.dns <domain> [type]\nTypes: A AAAA MX TXT NS'); break; }
      try {
        const r = await axios.get(`https://cloudflare-dns.com/dns-query?name=${domain}&type=${type}`, {
          headers: { Accept: 'application/dns-json' }, timeout: 8000,
        });
        const answers = r.data.Answer || [];
        if (!answers.length) { await reply(sock, m, `❌ No ${type} records for ${domain}`); break; }
        const result = answers.map(a => `• ${a.data} (TTL: ${a.TTL}s)`).join('\n');
        await reply(sock, m, ft(`🔍 DNS ${type} for ${domain}:\n\n${result}`, sock));
      } catch (e) { await reply(sock, m, '❌ DNS lookup failed: ' + e.message); }
      break;
    }

    // ── PORT SCANNER (basic) ─────────────────────────────────
    case 'portscan': {
      const host    = args[0];
      const ports   = [21,22,23,25,53,80,110,143,443,3306,3389,5432,6379,8080,8443,27017];
      if (!host) { await reply(sock, m, '.portscan <host>'); break; }
      await reply(sock, m, ft(`🔍 Scanning ${host}...`, sock));
      try {
        const net     = require('net');
        const results = await Promise.all(ports.map(port =>
          new Promise(resolve => {
            const s = net.createConnection({ host, port, timeout: 1500 });
            s.on('connect', () => { s.destroy(); resolve({ port, open: true }); });
            s.on('timeout', () => { s.destroy(); resolve({ port, open: false }); });
            s.on('error',   () => { resolve({ port, open: false }); });
          })
        ));
        const open   = results.filter(r => r.open).map(r => `✅ ${r.port}`).join('\n') || 'None found';
        const closed = results.filter(r => !r.open).length;
        await reply(sock, m, ft(`🔍 Port Scan: ${host}\n\nOpen ports:\n${open}\n\nClosed/Filtered: ${closed}`, sock));
      } catch (e) { await reply(sock, m, '❌ Scan failed: ' + e.message); }
      break;
    }

    // ── HTTP STATUS CHECK ────────────────────────────────────
    case 'httpstatus':
    case 'checkurl': {
      const url = args[0];
      if (!url?.startsWith('http')) { await reply(sock, m, '.checkurl <url>'); break; }
      try {
        const start = Date.now();
        const r     = await axios.get(url, { timeout: 10000, validateStatus: () => true, maxRedirects: 5 });
        const ms    = Date.now() - start;
        const emoji = r.status < 300 ? '✅' : r.status < 400 ? '🔄' : '❌';
        await reply(sock, m, ft(
          `${emoji} URL: ${url}\n\nStatus: ${r.status} ${r.statusText}\nResponse time: ${ms}ms\nContent-Type: ${r.headers['content-type'] || 'N/A'}`,
          sock
        ));
      } catch (e) { await reply(sock, m, '❌ Request failed: ' + e.message); }
      break;
    }

    // ── REGEX TESTER ─────────────────────────────────────────
    case 'regex': {
      // Usage: .regex /pattern/flags text to test
      const full = args.join(' ');
      const m2   = full.match(/^\/(.+)\/([gimsuy]*)\s+([\s\S]+)$/);
      if (!m2) { await reply(sock, m, '.regex /<pattern>/<flags> <text>\nExample: .regex /hello/i Hello World'); break; }
      try {
        const [, pattern, flags, text] = m2;
        const re      = new RegExp(pattern, flags);
        const matches = [...text.matchAll(new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'))];
        if (!matches.length) { await reply(sock, m, ft(`❌ No matches for /${pattern}/${flags}`, sock)); break; }
        const result = matches.map((m3, i) => `Match ${i+1}: "${m3[0]}" at index ${m3.index}`).join('\n');
        await reply(sock, m, ft(`✅ Regex /${pattern}/${flags}\n\n${result}`, sock));
      } catch (e) { await reply(sock, m, '❌ Invalid regex: ' + e.message); }
      break;
    }

    // ── CODE EXECUTE (JS sandbox) ────────────────────────────
    case 'eval':
    case 'exec': {
      const isOwnerCheck = helpers.isOwner(m, sock);
      if (!isOwnerCheck) { await reply(sock, m, '❌ Owner only.'); break; }
      const code = args.join(' ');
      if (!code) { await reply(sock, m, '.eval <js code>'); break; }
      try {
        const result = await eval(`(async()=>{${code}})()`);
        const out    = result !== undefined ? JSON.stringify(result, null, 2) : 'undefined';
        await reply(sock, m, ft('✅ Result:\n' + String(out).slice(0, 3000), sock));
      } catch (e) { await reply(sock, m, ft('❌ Error:\n' + e.message, sock)); }
      break;
    }

    // ── NPM PACKAGE INFO ─────────────────────────────────────
    case 'npm':
    case 'npminfo': {
      const pkg = args[0];
      if (!pkg) { await reply(sock, m, '.npm <package-name>'); break; }
      try {
        const r = await axios.get(`https://registry.npmjs.org/${pkg}/latest`, { timeout: 8000 });
        const d = r.data;
        await reply(sock, m, ft(
          `📦 ${d.name}@${d.version}\n\n` +
          `📝 ${d.description || 'No description'}\n` +
          `👤 Author: ${typeof d.author === 'object' ? d.author?.name : d.author || 'N/A'}\n` +
          `📜 License: ${d.license || 'N/A'}\n` +
          `🔗 https://npmjs.com/package/${pkg}`, sock
        ));
      } catch (e) { await reply(sock, m, '❌ Package not found: ' + pkg); }
      break;
    }

    // ── GITHUB REPO INFO ─────────────────────────────────────
    case 'github':
    case 'ghrepo': {
      const query = args[0];
      if (!query || !query.includes('/')) { await reply(sock, m, '.github <owner/repo>'); break; }
      try {
        const r = await axios.get(`https://api.github.com/repos/${query}`, {
          headers: { 'User-Agent': 'AnimeMD-Bot' }, timeout: 8000,
        });
        const d = r.data;
        await reply(sock, m, ft(
          `🐙 ${d.full_name}\n\n` +
          `📝 ${d.description || 'No description'}\n` +
          `⭐ Stars: ${d.stargazers_count}\n` +
          `🍴 Forks: ${d.forks_count}\n` +
          `👁 Watchers: ${d.watchers_count}\n` +
          `🔤 Language: ${d.language || 'N/A'}\n` +
          `📅 Updated: ${new Date(d.updated_at).toLocaleDateString()}\n` +
          `🔗 ${d.html_url}`, sock
        ));
      } catch (e) { await reply(sock, m, '❌ Repo not found: ' + query); }
      break;
    }

    // ── CRON EXPRESSION EXPLAINER ────────────────────────────
    case 'cron': {
      const expr = args.join(' ');
      if (!expr) { await reply(sock, m, '.cron <expression>\nExample: .cron 0 9 * * 1-5'); break; }
      const parts = expr.split(' ');
      if (parts.length !== 5) { await reply(sock, m, '❌ Cron needs 5 parts: min hour day month weekday'); break; }
      const [min, hour, day, month, weekday] = parts;
      const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      await reply(sock, m, ft(
        `⏰ Cron: ${expr}\n\n` +
        `Minute:  ${min}\nHour:    ${hour}\nDay:     ${day}\nMonth:   ${month}\nWeekday: ${weekday}\n\n` +
        `Runs: ${ hour === '*' ? 'Every hour' : `At ${hour}:${min.padStart(2,'0')}`}` +
        `${ weekday !== '*' ? ` on ${weekday.split(',').map(d => days[d]||d).join(', ')}` : '' }` +
        `${ month !== '*' ? ` in ${month.split(',').map(mo => months[mo]||mo).join(', ')}` : '' }`, sock
      ));
      break;
    }

    // ── JWT DECODE (no verify) ───────────────────────────────
    case 'jwtdecode':
    case 'jwt': {
      const token = args[0];
      if (!token) { await reply(sock, m, '.jwt <token>'); break; }
      try {
        const parts   = token.split('.');
        if (parts.length !== 3) throw new Error('Not a valid JWT');
        const header  = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        await reply(sock, m, ft(
          `🔑 JWT Decoded\n\nHeader:\n${JSON.stringify(header, null, 2)}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`,
          sock
        ));
      } catch (e) { await reply(sock, m, '❌ ' + e.message); }
      break;
    }

    // ── COLOR HEX INFO ───────────────────────────────────────
    case 'color':
    case 'hexcolor': {
      const hex = (args[0] || '').replace('#', '');
      if (!/^[0-9a-fA-F]{6}$/.test(hex)) { await reply(sock, m, '.color <hex>\nExample: .color FF5733'); break; }
      const r = parseInt(hex.slice(0,2), 16);
      const g = parseInt(hex.slice(2,4), 16);
      const b = parseInt(hex.slice(4,6), 16);
      try {
        const imgUrl = `https://singlecolorimage.com/get/${hex}/200x200`;
        await replyImg(sock, m, imgUrl, ft(`🎨 #${hex.toUpperCase()}\n\nRGB: ${r}, ${g}, ${b}\nDecimal: ${parseInt(hex,16)}`, sock));
      } catch {
        await reply(sock, m, ft(`🎨 #${hex.toUpperCase()}\nRGB: ${r}, ${g}, ${b}`, sock));
      }
      break;
    }

    // ── TIMESTAMP CONVERTER ──────────────────────────────────
    case 'timestamp':
    case 'ts': {
      const input = args[0];
      const now   = Date.now();
      if (!input) {
        await reply(sock, m, ft(`🕒 Current timestamp\n\nUnix (s): ${Math.floor(now/1000)}\nUnix (ms): ${now}\nISO: ${new Date(now).toISOString()}`, sock));
        break;
      }
      try {
        const ts  = /^\d{10}$/.test(input) ? parseInt(input)*1000 : parseInt(input);
        const dt  = new Date(ts);
        await reply(sock, m, ft(`🕒 ${input}\n\nDate: ${dt.toDateString()}\nTime: ${dt.toTimeString()}\nISO: ${dt.toISOString()}`, sock));
      } catch { await reply(sock, m, '❌ Invalid timestamp'); }
      break;
    }

    // ── LOREM IPSUM GENERATOR ────────────────────────────────
    case 'lorem': {
      const words = Math.min(parseInt(args[0]) || 50, 500);
      try {
        const r = await axios.get(`https://loremipsum.io/api/?what=words&amount=${words}`, { timeout: 6000 });
        await reply(sock, m, ft(`📝 Lorem Ipsum (${words} words):\n\n${r.data}`, sock));
      } catch {
        // Fallback local
        const sample = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua';
        const w = sample.split(' ');
        const out = Array.from({ length: words }, (_, i) => w[i % w.length]).join(' ');
        await reply(sock, m, ft(`📝 Lorem Ipsum (${words} words):\n\n${out}`, sock));
      }
      break;
    }

    // ── SLUG GENERATOR ───────────────────────────────────────
    case 'slug': {
      const text = args.join(' ');
      if (!text) { await reply(sock, m, '.slug <text>'); break; }
      const slug = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
      await reply(sock, m, ft(`🔗 Slug:\n${slug}`, sock));
      break;
    }

    // ── RANDOM STRING ────────────────────────────────────────
    case 'randstr':
    case 'randomstring': {
      const len   = Math.min(parseInt(args[0]) || 16, 128);
      const type  = args[1] || 'alnum';
      const sets  = { alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', num: '0123456789', hex: '0123456789abcdef' };
      const chars = sets[type] || sets.alnum;
      const { randomBytes } = require('crypto');
      const bytes = randomBytes(len);
      const str   = Array.from(bytes, b => chars[b % chars.length]).join('');
      await reply(sock, m, ft(`🎲 Random ${type} (${len}):\n${str}`, sock));
      break;
    }

    // ── DEV HELP MENU ────────────────────────────────────────
    case 'devmenu':
    case 'devhelp': {
      const prefix = c.prefix || '.';
      await reply(sock, m, ft(
        `╭━━━━━━━━━━━━━━━━╮\n┃  *Developer Tools*\n╰━━━━━━━━━━━━━━━━╯\n\n` +
        `*━━ ENCRYPT ━━*\n» ${prefix}encjs – Obfuscate JS file\n» ${prefix}enchtml – Obfuscate HTML\n» ${prefix}encpy – Encode Python\n» ${prefix}encjson – Encode JSON\n\n` +
        `*━━ DECRYPT ━━*\n» ${prefix}decjs – Decode JS\n» ${prefix}dechtml – Decode HTML\n» ${prefix}decpy – Decode Python\n» ${prefix}decjson – Decode JSON\n\n` +
        `*━━ CODE TOOLS ━━*\n» ${prefix}minify – Minify JS (terser)\n» ${prefix}beautify – Format JS (prettier)\n» ${prefix}formatjson – Format JSON\n» ${prefix}jsoncheck – Validate JSON\n» ${prefix}regex – Test regex\n» ${prefix}eval – Run JS code (owner)\n\n` +
        `*━━ ENCODE/HASH ━━*\n» ${prefix}b64enc / ${prefix}b64dec\n» ${prefix}hexenc / ${prefix}hexdec\n» ${prefix}md5 / ${prefix}sha256 / ${prefix}sha512\n» ${prefix}jwt – Decode JWT\n\n` +
        `*━━ NETWORK ━━*\n» ${prefix}ipinfo – IP lookup\n» ${prefix}whois – Domain WHOIS\n» ${prefix}dns – DNS lookup\n» ${prefix}portscan – Open ports\n» ${prefix}checkurl – HTTP status\n\n` +
        `*━━ GENERATORS ━━*\n» ${prefix}uuid – Generate UUID\n» ${prefix}password – Random password\n» ${prefix}lorem – Lorem ipsum\n» ${prefix}slug – URL slug\n» ${prefix}randstr – Random string\n» ${prefix}timestamp – Unix timestamp\n» ${prefix}color – Hex color info\n» ${prefix}cron – Explain cron\n» ${prefix}npm – NPM package info\n» ${prefix}github – GitHub repo info`,
        sock
      ));
      break;
    }

    default:
      return false; // not handled
  }

  return true; // handled
}

// ── List of all dev commands (for menu) ──────────────────────
const DEV_CMDS = [
  'encjs','enchtml','encpy','encjson',
  'decjs','dechtml','decpy','decjson',
  'minify','beautify','formatjson','jsoncheck',
  'regex','eval','npm','github','cron',
  'b64enc','b64dec','hexenc','hexdec',
  'md5','sha256','sha512','jwt',
  'ipinfo','whois','dns','portscan','checkurl',
  'uuid','password','lorem','slug','randstr','timestamp','color',
  'devmenu',
 ];

module.exports = { devHandler };
