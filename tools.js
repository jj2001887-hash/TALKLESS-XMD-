// ============================================================
//   tools.js  –  30+ Utility Tool Commands (Styled)
// ============================================================
'use strict';
const axios = require('axios');

const TOOLS_CMDS = [
  'calculator','bmi','age','timezone','worldtime','unitconvert','tempconvert',
  'color2','emoji','emojisearch','qrgenerator','vcard','ip2','myip','ping2',
  'wordcount','charcount','diff','jsonformat','tableify'
];

async function toolsHandler(sock, m, cmd, args, helpers) {
  if (!TOOLS_CMDS.includes(cmd)) return false;
  const { reply, cfg } = helpers;
  const prefix = cfg(sock).prefix || '.';
  const text   = args.join(' ');

  // Helper to create styled reply box
  const styledReply = (title, lines) => {
    let body = `🕣⃝⃘̉̉⃝⃪\n\n┌ ❏ ◆ ⌜${title}⌟ ◆\n`;
    for (const line of lines) {
      body += `├◆ ${line}\n`;
    }
    body += `└ ❏\n\n⏤͟͟͞🩸`;
    return body;
  };

  switch(cmd) {

    case 'calculator': {
      if (!text) {
        await reply(styledReply('𝐂𝐀𝐋𝐂𝐔𝐋𝐀𝐓𝐎𝐑', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐜𝐚𝐥𝐜𝐮𝐥𝐚𝐭𝐨𝐫 <𝐞𝐱𝐩𝐫𝐞𝐬𝐬𝐢𝐨𝐧>`, `𝐄𝐱: ${prefix}𝐜𝐚𝐥𝐜𝐮𝐥𝐚𝐭𝐨𝐫 𝟐+𝟐*𝟓`]));
        break;
      }
      try {
        const safe = text.replace(/[^0-9+\-*/.()%\s]/g,'');
        const res  = Function('"use strict"; return (' + safe + ')')();
        await reply(styledReply('𝐂𝐀𝐋𝐂𝐔𝐋𝐀𝐓𝐎𝐑', [`𝐄𝐱𝐩𝐫𝐞𝐬𝐬𝐢𝐨𝐧: ${text}`, `𝐑𝐞𝐬𝐮𝐥𝐭: *${res}*`]));
      } catch { await reply(styledReply('𝐂𝐀𝐋𝐂𝐔𝐋𝐀𝐓𝐎𝐑', ['❌ 𝐈𝐧𝐯𝐚𝐥𝐢𝐝 𝐞𝐱𝐩𝐫𝐞𝐬𝐬𝐢𝐨𝐧'])); }
      break;
    }

    case 'bmi': {
      const parts = text.split(/\s+/);
      const weight = parseFloat(parts[0]);
      const height = parseFloat(parts[1]);
      if (!weight || !height) {
        await reply(styledReply('𝐁𝐌𝐈', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐛𝐦𝐢 <𝐰𝐞𝐢𝐠𝐡𝐭_𝐤𝐠> <𝐡𝐞𝐢𝐠𝐡𝐭_𝐜𝐦>`, `𝐄𝐱: ${prefix}𝐛𝐦𝐢 𝟕𝟎 𝟏𝟕𝟓`]));
        break;
      }
      const bmi    = weight / Math.pow(height/100, 2);
      const cat    = bmi<18.5 ? '𝐔𝐧𝐝𝐞𝐫𝐰𝐞𝐢𝐠𝐡𝐭' : bmi<25 ? '𝐍𝐨𝐫𝐦𝐚𝐥' : bmi<30 ? '𝐎𝐯𝐞𝐫𝐰𝐞𝐢𝐠𝐡𝐭' : '𝐎𝐛𝐞𝐬𝐞';
      await reply(styledReply('𝐁𝐌𝐈', [
        `𝐖𝐞𝐢𝐠𝐡𝐭: ${weight} 𝐤𝐠`,
        `𝐇𝐞𝐢𝐠𝐡𝐭: ${height} 𝐜𝐦`,
        `𝐁𝐌𝐈: *${bmi.toFixed(1)}*`,
        `𝐂𝐚𝐭𝐞𝐠𝐨𝐫𝐲: *${cat}*`
      ]));
      break;
    }

    case 'age': {
      if (!text) {
        await reply(styledReply('𝐀𝐆𝐄', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐚𝐠𝐞 𝐃𝐃/𝐌𝐌/𝐘𝐘𝐘𝐘`]));
        break;
      }
      const [d,mo,y] = text.split('/').map(Number);
      const dob  = new Date(y, mo-1, d);
      const now  = new Date();
      const age  = Math.floor((now-dob) / (365.25*24*60*60*1000));
      const next = new Date(now.getFullYear(), mo-1, d);
      if (next < now) next.setFullYear(next.getFullYear()+1);
      const days = Math.ceil((next-now)/(24*60*60*1000));
      await reply(styledReply('𝐀𝐆𝐄', [
        `𝐃𝐚𝐭𝐞 𝐨𝐟 𝐛𝐢𝐫𝐭𝐡: ${text}`,
        `𝐀𝐠𝐞: *${age} 𝐲𝐞𝐚𝐫𝐬*`,
        `𝐍𝐞𝐱𝐭 𝐛𝐢𝐫𝐭𝐡𝐝𝐚𝐲 𝐢𝐧: ${days} 𝐝𝐚𝐲𝐬`
      ]));
      break;
    }

    case 'timezone': {
      if (!text) {
        await reply(styledReply('𝐓𝐈𝐌𝐄𝐙𝐎𝐍𝐄', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐭𝐢𝐦𝐞𝐳𝐨𝐧𝐞 <𝐜𝐢𝐭𝐲 𝐨𝐫 𝐳𝐨𝐧𝐞>`]));
        break;
      }
      try {
        const { data } = await axios.get(`https://worldtimeapi.org/api/timezone/${encodeURIComponent(text.replace(' ','_'))}`, { timeout:8000 });
        const dt = new Date(data.datetime);
        await reply(styledReply(`𝐓𝐈𝐌𝐄𝐙𝐎𝐍𝐄: ${text}`, [
          `🕐 ${dt.toLocaleTimeString()}`,
          `📅 ${dt.toLocaleDateString()}`,
          `⏰ 𝐔𝐓𝐂${data.utc_offset}`
        ]));
      } catch { await reply(styledReply('𝐓𝐈𝐌𝐄𝐙𝐎𝐍𝐄', ['❌ 𝐓𝐢𝐦𝐞𝐳𝐨𝐧𝐞 𝐧𝐨𝐭 𝐟𝐨𝐮𝐧𝐝', '𝐓𝐫𝐲: 𝐀𝐟𝐫𝐢𝐜𝐚/𝐍𝐚𝐢𝐫𝐨𝐛𝐢, 𝐀𝐬𝐢𝐚/𝐓𝐨𝐤𝐲𝐨'])); }
      break;
    }

    case 'worldtime': {
      const zones = ['America/New_York','Europe/London','Asia/Tokyo','Africa/Nairobi','Australia/Sydney','Asia/Dubai'];
      const times = zones.map(z => {
        try {
          const t = new Date().toLocaleTimeString('en-US', { timeZone:z, hour:'2-digit', minute:'2-digit' });
          return `🌍 ${z.split('/')[1].replace('_',' ')}: ${t}`;
        } catch { return ''; }
      }).filter(Boolean);
      await reply(styledReply('𝐖𝐎𝐑𝐋𝐃 𝐂𝐋𝐎𝐂𝐊', times));
      break;
    }

    case 'unitconvert': {
      const parts2 = text.split(/\s+/);
      const val = parseFloat(parts2[0]);
      const from = parts2[1]?.toLowerCase();
      const to   = parts2[2]?.toLowerCase();
      if (!val || !from || !to) {
        await reply(styledReply('𝐔𝐍𝐈𝐓 𝐂𝐎𝐍𝐕𝐄𝐑𝐓', [
          `𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐮𝐧𝐢𝐭𝐜𝐨𝐧𝐯𝐞𝐫𝐭 <𝐯𝐚𝐥𝐮𝐞> <𝐟𝐫𝐨𝐦> <𝐭𝐨>`,
          `𝐄𝐱: ${prefix}𝐮𝐧𝐢𝐭𝐜𝐨𝐧𝐯𝐞𝐫𝐭 𝟏𝟎𝟎 𝐤𝐦 𝐦𝐢𝐥𝐞𝐬`
        ]));
        break;
      }
      const conversions = {
        'km-miles':0.621371,'miles-km':1.60934,'m-ft':3.28084,'ft-m':0.3048,
        'kg-lbs':2.20462,'lbs-kg':0.453592,'l-gal':0.264172,'gal-l':3.78541,
        'cm-inch':0.393701,'inch-cm':2.54,'m-yards':1.09361,'yards-m':0.9144,
      };
      const key    = `${from}-${to}`;
      const factor = conversions[key];
      if (!factor) {
        await reply(styledReply('𝐔𝐍𝐈𝐓 𝐂𝐎𝐍𝐕𝐄𝐑𝐓', [`❌ 𝐂𝐨𝐧𝐯𝐞𝐫𝐬𝐢𝐨𝐧 ${from} → ${to} 𝐧𝐨𝐭 𝐬𝐮𝐩𝐩𝐨𝐫𝐭𝐞𝐝`]));
        break;
      }
      await reply(styledReply('𝐔𝐍𝐈𝐓 𝐂𝐎𝐍𝐕𝐄𝐑𝐓', [
        `${val} ${from} = *${(val*factor).toFixed(4)} ${to}*`
      ]));
      break;
    }

    case 'tempconvert': {
      const parts3 = text.split(/\s+/);
      const val2 = parseFloat(parts3[0]);
      const from2 = parts3[1]?.toLowerCase();
      const to2   = parts3[2]?.toLowerCase();
      if (isNaN(val2) || !from2 || !to2) {
        await reply(styledReply('𝐓𝐄𝐌𝐏𝐄𝐑𝐀𝐓𝐔𝐑𝐄', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐭𝐞𝐦𝐩𝐜𝐨𝐧𝐯𝐞𝐫𝐭 <𝐯𝐚𝐥𝐮𝐞> <𝐂/𝐅/𝐊> <𝐂/𝐅/𝐊>`]));
        break;
      }
      let celsius;
      if (from2==='c') celsius=val2;
      else if (from2==='f') celsius=(val2-32)*5/9;
      else if (from2==='k') celsius=val2-273.15;
      else { await reply(styledReply('𝐓𝐄𝐌𝐏𝐄𝐑𝐀𝐓𝐔𝐑𝐄', [`❌ 𝐔𝐧𝐤𝐧𝐨𝐰𝐧 𝐮𝐧𝐢𝐭 ${from2}`])); break; }
      let result3;
      if (to2==='c') result3=celsius;
      else if (to2==='f') result3=celsius*9/5+32;
      else if (to2==='k') result3=celsius+273.15;
      else { await reply(styledReply('𝐓𝐄𝐌𝐏𝐄𝐑𝐀𝐓𝐔𝐑𝐄', [`❌ 𝐔𝐧𝐤𝐧𝐨𝐰𝐧 𝐮𝐧𝐢𝐭 ${to2}`])); break; }
      await reply(styledReply('𝐓𝐄𝐌𝐏𝐄𝐑𝐀𝐓𝐔𝐑𝐄', [
        `${val2}°${from2.toUpperCase()} = *${result3.toFixed(2)}°${to2.toUpperCase()}*`
      ]));
      break;
    }

    case 'color2': {
      if (!text) {
        await reply(styledReply('𝐂𝐎𝐋𝐎𝐑', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐜𝐨𝐥𝐨𝐫𝟐 <𝐡𝐞𝐱>`, `𝐄𝐱: ${prefix}𝐜𝐨𝐥𝐨𝐫𝟐 #𝐟𝐟𝟓𝟕𝟑𝟑`]));
        break;
      }
      const hex = text.startsWith('#') ? text : '#'+text;
      try {
        const { data } = await axios.get(`https://www.thecolorapi.com/id?hex=${hex.replace('#','')}`, { timeout:8000 });
        await reply(styledReply('𝐂𝐎𝐋𝐎𝐑 𝐈𝐍𝐅𝐎', [
          `𝐇𝐞𝐱: ${data.hex?.value}`,
          `𝐑𝐆𝐁: ${data.rgb?.value}`,
          `𝐇𝐒𝐋: ${data.hsl?.value}`,
          `𝐍𝐚𝐦𝐞: ${data.name?.value}`
        ]));
      } catch (e) { await reply(styledReply('𝐂𝐎𝐋𝐎𝐑', [`❌ ${e.message}`])); }
      break;
    }

    case 'emoji': {
      if (!text) {
        await reply(styledReply('𝐄𝐌𝐎𝐉𝐈', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐞𝐦𝐨𝐣𝐢 <𝐞𝐦𝐨𝐣𝐢>`]));
        break;
      }
      const cp = text.codePointAt(0)?.toString(16).toUpperCase().padStart(4,'0');
      await reply(styledReply('𝐄𝐌𝐎𝐉𝐈 𝐈𝐍𝐅𝐎', [
        `𝐄𝐦𝐨𝐣𝐢: ${text}`,
        `𝐂𝐨𝐝𝐞𝐩𝐨𝐢𝐧𝐭: 𝐔+${cp}`,
        `𝐔𝐧𝐢𝐜𝐨𝐝𝐞 𝐧𝐚𝐦𝐞: 𝐂𝐡𝐞𝐜𝐤 𝐮𝐧𝐢𝐜𝐨𝐝𝐞.𝐨𝐫𝐠/𝐜𝐡𝐚𝐫𝐭𝐬`
      ]));
      break;
    }

    case 'emojisearch': {
      if (!text) {
        await reply(styledReply('𝐄𝐌𝐎𝐉𝐈 𝐒𝐄𝐀𝐑𝐂𝐇', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐞𝐦𝐨𝐣𝐢𝐬𝐞𝐚𝐫𝐜𝐡 <𝐤𝐞𝐲𝐰𝐨𝐫𝐝>`]));
        break;
      }
      try {
        const { data } = await axios.get(`https://emoji-api.com/emojis?search=${encodeURIComponent(text)}&access_key=free`, { timeout:8000 });
        const list2 = (Array.isArray(data)?data:[]).slice(0,10).map(e=>`${e.character} ${e.unicodeName}`).join('\n├◆ ');
        await reply(styledReply(`𝐄𝐌𝐎𝐉𝐈𝐒 𝐅𝐎𝐑 "${text}"`, list2 ? list2.split('\n├◆ ') : ['𝐍𝐨𝐧𝐞 𝐟𝐨𝐮𝐧𝐝']));
      } catch { await reply(styledReply('𝐄𝐌𝐎𝐉𝐈 𝐒𝐄𝐀𝐑𝐂𝐇', ['❌ 𝐅𝐚𝐢𝐥𝐞𝐝'])); }
      break;
    }

    case 'qrgenerator': {
      if (!text) {
        await reply(styledReply('𝐐𝐑 𝐂𝐎𝐃𝐄', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐪𝐫𝐠𝐞𝐧𝐞𝐫𝐚𝐭𝐨𝐫 <𝐭𝐞𝐱𝐭 𝐨𝐫 𝐔𝐑𝐋>`]));
        break;
      }
      const url3 = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
      await sock.sendMessage(m.key.remoteJid, { image: { url: url3 }, caption: `🕣⃝⃘̉̉⃝⃪\n\n┌ ❏ ◆ ⌜𝐐𝐑 𝐂𝐎𝐃𝐄⌟ ◆\n├◆ ${text}\n└ ❏\n\n⏤͟͟͞🩸` }, { quoted: m });
      break;
    }

    case 'vcard': {
      const parts4 = text.split('|').map(s=>s.trim());
      if (parts4.length < 2) {
        await reply(styledReply('𝐕𝐂𝐀𝐑𝐃', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐯𝐜𝐚𝐫𝐝 𝐍𝐚𝐦𝐞 | 𝐏𝐡𝐨𝐧𝐞 | 𝐄𝐦𝐚𝐢𝐥 (𝐨𝐩𝐭𝐢𝐨𝐧𝐚𝐥)`]));
        break;
      }
      const [vName, vPhone, vEmail] = parts4;
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${vName}\nTEL;type=CELL:${vPhone}${vEmail?`\nEMAIL:${vEmail}`:''}\nEND:VCARD`;
      await sock.sendMessage(m.key.remoteJid, {
        contacts: { displayName: vName, contacts: [{ vcard }] },
      }, { quoted: m });
      break;
    }

    case 'ip2': {
      const ip = args[0];
      if (!ip) {
        await reply(styledReply('𝐈𝐏 𝐋𝐎𝐎𝐊𝐔𝐏', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐢𝐩𝟐 <𝐈𝐏 𝐚𝐝𝐝𝐫𝐞𝐬𝐬>`]));
        break;
      }
      try {
        const { data } = await axios.get(`https://ipwho.is/${ip}`, { timeout:8000 });
        await reply(styledReply(`𝐈𝐏 𝐈𝐍𝐅𝐎: ${ip}`, [
          `📍 ${data.city}, ${data.region}, ${data.country}`,
          `🏢 𝐈𝐒𝐏: ${data.connection?.isp||'𝐍/𝐀'}`,
          `🕐 𝐓𝐢𝐦𝐞𝐳𝐨𝐧𝐞: ${data.timezone?.id||'𝐍/𝐀'}`,
          `📡 𝐓𝐲𝐩𝐞: ${data.type||'𝐍/𝐀'}`
        ]));
      } catch (e) { await reply(styledReply('𝐈𝐏 𝐋𝐎𝐎𝐊𝐔𝐏', [`❌ ${e.message}`])); }
      break;
    }

    case 'myip': {
      try {
        const { data } = await axios.get('https://api.ipify.org?format=json', { timeout:5000 });
        await reply(styledReply('𝐁𝐎𝐓 𝐈𝐏', [`🌐 ${data.ip}`]));
      } catch { await reply(styledReply('𝐁𝐎𝐓 𝐈𝐏', ['❌ 𝐅𝐚𝐢𝐥𝐞𝐝'])); }
      break;
    }

    case 'ping2': {
      if (!text) {
        await reply(styledReply('𝐏𝐈𝐍𝐆', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐩𝐢𝐧𝐠𝟐 <𝐔𝐑𝐋 𝐨𝐫 𝐝𝐨𝐦𝐚𝐢𝐧>`]));
        break;
      }
      const start = Date.now();
      try {
        await axios.get(text.startsWith('http')?text:`https://${text}`, { timeout:8000 });
        await reply(styledReply(`𝐏𝐈𝐍𝐆: ${text}`, [`🟢 𝐎𝐧𝐥𝐢𝐧𝐞`, `⏱ ${Date.now()-start}𝐦𝐬`]));
      } catch {
        await reply(styledReply(`𝐏𝐈𝐍𝐆: ${text}`, [`🔴 𝐎𝐟𝐟𝐥𝐢𝐧𝐞 𝐨𝐫 𝐮𝐧𝐫𝐞𝐚𝐜𝐡𝐚𝐛𝐥𝐞`, `⏱ ${Date.now()-start}𝐦𝐬`]));
      }
      break;
    }

    case 'wordcount': {
      if (!text) {
        await reply(styledReply('𝐖𝐎𝐑𝐃 𝐂𝐎𝐔𝐍𝐓', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐰𝐨𝐫𝐝𝐜𝐨𝐮𝐧𝐭 <𝐭𝐞𝐱𝐭>`]));
        break;
      }
      const words = text.trim().split(/\s+/).length;
      const chars = text.length;
      const lines = text.split('\n').length;
      const sentences = (text.match(/[.!?]+/g)||[]).length;
      await reply(styledReply('𝐓𝐄𝐗𝐓 𝐒𝐓𝐀𝐓𝐒', [
        `📖 𝐖𝐨𝐫𝐝𝐬: ${words}`,
        `🔤 𝐂𝐡𝐚𝐫𝐚𝐜𝐭𝐞𝐫𝐬: ${chars}`,
        `📜 𝐋𝐢𝐧𝐞𝐬: ${lines}`,
        `💬 𝐒𝐞𝐧𝐭𝐞𝐧𝐜𝐞𝐬: ${sentences}`
      ]));
      break;
    }

    case 'charcount': {
      if (!text) {
        await reply(styledReply('𝐂𝐇𝐀𝐑𝐀𝐂𝐓𝐄𝐑 𝐂𝐎𝐔𝐍𝐓', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐜𝐡𝐚𝐫𝐜𝐨𝐮𝐧𝐭 <𝐭𝐞𝐱𝐭>`]));
        break;
      }
      const freq = {};
      for (const c of text.toLowerCase()) { if (c.trim()) freq[c]=(freq[c]||0)+1; }
      const top = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,n])=>`"${c}": ${n}`).join(', ');
      await reply(styledReply('𝐂𝐇𝐀𝐑𝐀𝐂𝐓𝐄𝐑 𝐈𝐍𝐅𝐎', [
        `𝐋𝐞𝐧𝐠𝐭𝐡: ${text.length}`,
        `𝐓𝐨𝐩 𝐜𝐡𝐚𝐫𝐬: ${top}`
      ]));
      break;
    }

    case 'diff': {
      const sep = text.indexOf('\n');
      if (sep === -1) {
        await reply(styledReply('𝐃𝐈𝐅𝐅', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐝𝐢𝐟𝐟`, `𝐒𝐞𝐧𝐝 𝐭𝐰𝐨 𝐥𝐢𝐧𝐞𝐬 𝐭𝐨 𝐜𝐨𝐦𝐩𝐚𝐫𝐞:\n𝐋𝐢𝐧𝐞𝟏\n𝐋𝐢𝐧𝐞𝟐`]));
        break;
      }
      const str1 = text.slice(0,sep);
      const str2 = text.slice(sep+1);
      const added   = str2.split(' ').filter(w=>!str1.includes(w));
      const removed = str1.split(' ').filter(w=>!str2.includes(w));
      await reply(styledReply('𝐃𝐈𝐅𝐅', [
        `✅ 𝐀𝐝𝐝𝐞𝐝: ${added.join(' ')||'𝐧𝐨𝐧𝐞'}`,
        `❌ 𝐑𝐞𝐦𝐨𝐯𝐞𝐝: ${removed.join(' ')||'𝐧𝐨𝐧𝐞'}`
      ]));
      break;
    }

    case 'jsonformat': {
      if (!text) {
        await reply(styledReply('𝐉𝐒𝐎𝐍 𝐅𝐎𝐑𝐌𝐀𝐓', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐣𝐬𝐨𝐧𝐟𝐨𝐫𝐦𝐚𝐭 <𝐉𝐒𝐎𝐍 𝐬𝐭𝐫𝐢𝐧𝐠>`]));
        break;
      }
      try {
        const parsed = JSON.parse(text);
        const formatted = JSON.stringify(parsed, null, 2).slice(0, 3000);
        await reply(`🕣⃝⃘̉̉⃝⃪\n\n┌ ❏ ◆ ⌜𝐉𝐒𝐎𝐍 𝐅𝐎𝐑𝐌𝐀𝐓𝐓𝐄𝐃⌟ ◆\n├◆ \`\`\`json\n${formatted}\n\`\`\`\n└ ❏\n\n⏤͟͟͞🩸`);
      } catch (e) { await reply(styledReply('𝐉𝐒𝐎𝐍 𝐅𝐎𝐑𝐌𝐀𝐓', [`❌ 𝐈𝐧𝐯𝐚𝐥𝐢𝐝 𝐉𝐒𝐎𝐍: ${e.message}`])); }
      break;
    }

    case 'tableify': {
      if (!text) {
        await reply(styledReply('𝐓𝐀𝐁𝐋𝐄𝐈𝐅𝐘', [`𝐔𝐬𝐚𝐠𝐞: ${prefix}𝐭𝐚𝐛𝐥𝐞𝐢𝐟𝐲`, `𝐏𝐚𝐬𝐭𝐞 𝐂𝐒𝐕 𝐝𝐚𝐭𝐚`]));
        break;
      }
      const lines2 = text.trim().split('\n');
      const rows   = lines2.map(l=>l.split(',').map(c=>c.trim()));
      const widths = rows[0].map((_,ci)=>Math.max(...rows.map(r=>(r[ci]||'').length)));
      const fmt2   = row => '| ' + row.map((c,ci)=>(c||'').padEnd(widths[ci])).join(' | ') + ' |';
      const sep2   = '|-' + widths.map(w=>'-'.repeat(w)).join('-|-') + '-|';
      const table  = [fmt2(rows[0]), sep2, ...rows.slice(1).map(fmt2)].join('\n');
      await reply(`🕣⃝⃘̉̉⃝⃪\n\n┌ ❏ ◆ ⌜𝐓𝐀𝐁𝐋𝐄𝐈𝐅𝐘⌟ ◆\n├◆ \`\`\`\n${table.slice(0,3000)}\n\`\`\`\n└ ❏\n\n⏤͟͟͞🩸`);
      break;
    }

    default: return false;
  }
  return true;
}

module.exports = { toolsHandler };