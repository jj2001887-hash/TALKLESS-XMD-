// ============================================================
//   scraps.js  –  30+ Scraps API Commands
//   Downloader, utility, search, and info commands
//   All using scraps.pw / bk9 / working public APIs
// ============================================================
'use strict';

const axios = require('axios');

const SCRAPS_CMDS = [
  // Downloaders
  'ytmp3','ytmp4','fbdl','igdl','ttdl','twitterdl','pindl','spotifydl',
  // Media search
  'lyrics2','movieinfo','animeinfo','mangainfo','gameinfo',
  // Anime/manga
  'anisearch','charsearch','animequote','animefact','animechar',
  // Fun/info
  'dictionary','thesaurus','wikipedia','news','crypto',
  'currency','football','weather2',
  // Image/gen
  'waifu2','neko','animeimg','motivate','fakeid',
  // Util
  'screenshot','pastebin','shorturl2','reverseimage',
];

async function scrapsHandler(sock, m, cmd, args, helpers) {
  if (!SCRAPS_CMDS.includes(cmd)) return false;
  const { reply, ft, cfg, reaction } = helpers;
  const jid    = m.key.remoteJid;
  const prefix = cfg(sock).prefix || '.';
  const text   = args.join(' ');
  const query  = encodeURIComponent(text.slice(0,200));

  switch (cmd) {

    // ── DOWNLOADERS ─────────────────────────────────────────

    case 'ytmp3': {
      if (!text) { await reply(`🎵 *${prefix}ytmp3 <YouTube URL or name>*`); break; }
      await reaction('⬇️');
      await reply('⏳ Fetching audio...');
      try {
        let url = text;
        if (!url.includes('youtu')) {
          const yts = require('yt-search');
          const r   = await yts(text);
          url = r.videos?.[0]?.url;
          if (!url) throw new Error('No video found');
        }
        const { data } = await axios.get(
          `https://api.scraps.pw/api/tools/ytmp3?url=${encodeURIComponent(url)}`,
          { timeout: 30000 }
        );
        const dl = data?.result?.download || data?.download || data?.data?.download;
        if (!dl) throw new Error('No download URL');
        await sock.sendMessage(jid, {
          audio: { url: dl }, mimetype: 'audio/mpeg', fileName: 'audio.mp3',
        }, { quoted: m });
      } catch (e) { await reply(`❌ Failed: ${e.message}`); }
      break;
    }

    case 'ytmp4': {
      if (!text) { await reply(`🎬 *${prefix}ytmp4 <YouTube URL or name>*`); break; }
      await reaction('⬇️');
      await reply('⏳ Fetching video...');
      try {
        let url = text;
        if (!url.includes('youtu')) {
          const yts = require('yt-search');
          const r   = await yts(text);
          url = r.videos?.[0]?.url;
          if (!url) throw new Error('No video found');
        }
        const { data } = await axios.get(
          `https://api.scraps.pw/api/tools/ytmp4?url=${encodeURIComponent(url)}`,
          { timeout: 35000 }
        );
        const dl = data?.result?.download || data?.download;
        if (!dl) throw new Error('No download URL');
        await sock.sendMessage(jid, {
          video: { url: dl }, caption: ft('🎬 Downloaded via Anime MD', sock),
        }, { quoted: m });
      } catch (e) { await reply(`❌ Failed: ${e.message}`); }
      break;
    }

    case 'fbdl': {
      if (!text) { await reply(`📘 *${prefix}fbdl <Facebook video URL>*`); break; }
      await reaction('⬇️'); await reply('⏳ Downloading...');
      try {
        const { data } = await axios.get(
          `https://api.scraps.pw/api/downloader/facebook?url=${encodeURIComponent(text)}`,
          { timeout: 20000 }
        );
        const dl = data?.result?.download?.hd || data?.result?.download?.sd || data?.download;
        if (!dl) throw new Error('No URL found');
        await sock.sendMessage(jid, { video: { url: dl }, caption: '📘 Facebook Video' }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'igdl': {
      if (!text) { await reply(`📸 *${prefix}igdl <Instagram URL>*`); break; }
      await reaction('⬇️'); await reply('⏳ Downloading...');
      try {
        const { data } = await axios.get(
          `https://api.scraps.pw/api/downloader/instagram?url=${encodeURIComponent(text)}`,
          { timeout: 20000 }
        );
        const dl = data?.result?.[0]?.url || data?.download;
        if (!dl) throw new Error('No URL');
        const isVideo = dl.includes('.mp4') || data?.result?.[0]?.type === 'video';
        if (isVideo) {
          await sock.sendMessage(jid, { video: { url: dl }, caption: '📸 Instagram' }, { quoted: m });
        } else {
          await sock.sendMessage(jid, { image: { url: dl }, caption: '📸 Instagram' }, { quoted: m });
        }
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'ttdl': {
      if (!text) { await reply(`🎵 *${prefix}ttdl <TikTok URL>*`); break; }
      await reaction('⬇️'); await reply('⏳ Downloading...');
      try {
        const { data } = await axios.get(
          `https://api.scraps.pw/api/downloader/tiktok?url=${encodeURIComponent(text)}`,
          { timeout: 20000 }
        );
        const dl = data?.result?.nowm || data?.result?.wm || data?.download;
        if (!dl) throw new Error('No URL');
        await sock.sendMessage(jid, { video: { url: dl }, caption: '🎵 TikTok (no watermark)' }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'twitterdl': {
      if (!text) { await reply(`🐦 *${prefix}twitterdl <Twitter/X URL>*`); break; }
      await reaction('⬇️'); await reply('⏳ Downloading...');
      try {
        const { data } = await axios.get(
          `https://api.scraps.pw/api/downloader/twitter?url=${encodeURIComponent(text)}`,
          { timeout: 20000 }
        );
        const dl = data?.result?.download || data?.download;
        if (!dl) throw new Error('No URL');
        await sock.sendMessage(jid, { video: { url: dl }, caption: '🐦 Twitter/X Video' }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'pindl': {
      if (!text) { await reply(`📌 *${prefix}pindl <Pinterest URL>*`); break; }
      await reaction('⬇️'); await reply('⏳ Downloading...');
      try {
        const { data } = await axios.get(
          `https://api.scraps.pw/api/downloader/pinterest?url=${encodeURIComponent(text)}`,
          { timeout: 15000 }
        );
        const dl = data?.result?.download || data?.download;
        if (!dl) throw new Error('No URL');
        await sock.sendMessage(jid, { image: { url: dl }, caption: '📌 Pinterest' }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'spotifydl': {
      if (!text) { await reply(`🎧 *${prefix}spotifydl <Spotify URL or song name>*`); break; }
      await reaction('⬇️'); await reply('⏳ Fetching Spotify track...');
      try {
        const { data } = await axios.get(
          `https://api.scraps.pw/api/downloader/spotify?query=${query}`,
          { timeout: 30000 }
        );
        const dl = data?.result?.download || data?.download;
        if (!dl) throw new Error('Not found');
        await sock.sendMessage(jid, {
          audio: { url: dl }, mimetype: 'audio/mpeg',
          fileName: (data?.result?.title || 'spotify') + '.mp3',
        }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    // ── SEARCH & INFO ────────────────────────────────────────

    case 'lyrics2': {
      if (!text) { await reply(`🎵 *${prefix}lyrics2 <song name>*`); break; }
      await reaction('🎵');
      try {
        const { data } = await axios.get(
          `https://api.scraps.pw/api/search/lyrics?query=${query}`,
          { timeout: 10000 }
        );
        const d = data?.result || data;
        if (!d?.lyrics) throw new Error('Not found');
        const chunks = d.lyrics.match(/.{1,3000}/gs) || [d.lyrics];
        await reply(ft(`🎵 *${d.title || text}*\n🎤 ${d.artist || 'Unknown'}\n\n${chunks[0]}`, sock));
        for (let i = 1; i < Math.min(chunks.length, 3); i++) {
          await sock.sendMessage(jid, { text: chunks[i] }, { quoted: m });
        }
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'movieinfo': {
      if (!text) { await reply(`🎬 *${prefix}movieinfo <movie name>*`); break; }
      await reaction('🎬');
      try {
        const { data } = await axios.get(
          `https://api.scraps.pw/api/search/movie?query=${query}`,
          { timeout: 10000 }
        );
        const d = data?.result || data?.[0] || data;
        if (!d?.title) throw new Error('Not found');
        const info =
          `🎬 *${d.title}* (${d.year || 'N/A'})\n` +
          `⭐ Rating: ${d.rating || 'N/A'}\n` +
          `🎭 Genre: ${Array.isArray(d.genre) ? d.genre.join(', ') : d.genre || 'N/A'}\n` +
          `⏱ Runtime: ${d.runtime || 'N/A'}\n` +
          `🌍 Country: ${d.country || 'N/A'}\n` +
          `📝 Plot: ${d.plot || d.description || 'N/A'}`;
        if (d.poster) {
          await sock.sendMessage(jid, { image: { url: d.poster }, caption: ft(info, sock) }, { quoted: m });
        } else {
          await reply(ft(info, sock));
        }
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'animeinfo': {
      if (!text) { await reply(`🌸 *${prefix}animeinfo <anime name>*`); break; }
      await reaction('🌸');
      try {
        const { data } = await axios.get(
          `https://api.jikan.moe/v4/anime?q=${query}&limit=1`,
          { timeout: 10000 }
        );
        const d = data?.data?.[0];
        if (!d) throw new Error('Not found');
        const info =
          `🌸 *${d.title}* (${d.title_english || d.title})\n` +
          `📅 Year: ${d.year || 'N/A'} | Episodes: ${d.episodes || '?'}\n` +
          `⭐ Score: ${d.score || 'N/A'} | Rank: #${d.rank || 'N/A'}\n` +
          `🎭 Genre: ${d.genres?.map(g=>g.name).join(', ') || 'N/A'}\n` +
          `📺 Status: ${d.status || 'N/A'}\n` +
          `📝 ${(d.synopsis||'').slice(0,400)}...`;
        if (d.images?.jpg?.image_url) {
          await sock.sendMessage(jid, { image: { url: d.images.jpg.image_url }, caption: ft(info, sock) }, { quoted: m });
        } else {
          await reply(ft(info, sock));
        }
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'mangainfo': {
      if (!text) { await reply(`📚 *${prefix}mangainfo <manga name>*`); break; }
      await reaction('📚');
      try {
        const { data } = await axios.get(
          `https://api.jikan.moe/v4/manga?q=${query}&limit=1`,
          { timeout: 10000 }
        );
        const d = data?.data?.[0];
        if (!d) throw new Error('Not found');
        const info =
          `📚 *${d.title}*\n` +
          `📖 Chapters: ${d.chapters || '?'} | Volumes: ${d.volumes || '?'}\n` +
          `⭐ Score: ${d.score || 'N/A'} | Rank: #${d.rank || 'N/A'}\n` +
          `🎭 Genre: ${d.genres?.map(g=>g.name).join(', ') || 'N/A'}\n` +
          `📝 ${(d.synopsis||'').slice(0,400)}...`;
        if (d.images?.jpg?.image_url) {
          await sock.sendMessage(jid, { image: { url: d.images.jpg.image_url }, caption: ft(info, sock) }, { quoted: m });
        } else {
          await reply(ft(info, sock));
        }
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'anisearch': {
      if (!text) { await reply(`🔍 *${prefix}anisearch <anime name>*`); break; }
      await reaction('🔍');
      try {
        const { data } = await axios.get(`https://api.jikan.moe/v4/anime?q=${query}&limit=5`, { timeout: 10000 });
        const list = data?.data || [];
        if (!list.length) throw new Error('No results');
        const txt = list.map((a,i) =>
          `${i+1}. *${a.title}* (${a.year||'?'}) — ⭐${a.score||'?'} — ${a.status||''}`
        ).join('\n');
        await reply(ft(`🔍 *Anime Results for "${text}"*\n\n${txt}\n\nUse ${prefix}animeinfo <name> for details`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'charsearch': {
      if (!text) { await reply(`👤 *${prefix}charsearch <character name>*`); break; }
      await reaction('👤');
      try {
        const { data } = await axios.get(`https://api.jikan.moe/v4/characters?q=${query}&limit=1`, { timeout: 10000 });
        const d = data?.data?.[0];
        if (!d) throw new Error('Not found');
        const info = `👤 *${d.name}*\n\n📝 ${(d.about||'No info').slice(0,500)}`;
        if (d.images?.jpg?.image_url) {
          await sock.sendMessage(jid, { image: { url: d.images.jpg.image_url }, caption: ft(info, sock) }, { quoted: m });
        } else {
          await reply(ft(info, sock));
        }
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'animequote': {
      await reaction('💬');
      try {
        const { data } = await axios.get('https://animechan.io/api/v1/quotes/random', { timeout: 8000 });
        const q = data?.data || data;
        await reply(ft(`💬 *"${q.content || q.quote}"*\n\n— ${q.character?.name || q.character || 'Unknown'}\n📺 ${q.anime?.name || q.anime || 'Unknown'}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'animefact': {
      await reaction('📌');
      try {
        const facts = [
          'Dragon Ball Z was the first anime to air in Africa in the 1990s.',
          'The word "anime" is short for "animation" in Japanese.',
          'One Piece has over 1000 episodes and is still running.',
          'Spirited Away won an Academy Award in 2003.',
          'Naruto ran for 220 episodes and Shippuden for 500.',
          'Attack on Titan has sold over 100 million copies of its manga.',
          'The first anime ever broadcast on TV was Mushi Production\'s Tetsuwan Atom in 1963.',
          'Pokémon is the highest-grossing media franchise ever.',
          'Sword Art Online was inspired by a light novel published in 2002.',
          'Death Note is banned in some schools in China.',
        ];
        await reply(ft(`📌 *Anime Fact*\n\n${facts[Math.floor(Math.random()*facts.length)]}`, sock));
      } catch {}
      break;
    }

    case 'animechar': {
      await reaction('🌸');
      try {
        const chars = ['Naruto','Goku','Luffy','Ichigo','Edward Elric','Levi Ackerman','Itachi','Rem','Zero Two','Mikasa','Hinata','Saber','Killua','Gon','Light Yagami','L Lawliet','Roronoa Zoro','Kakashi','Saitama','Tanjiro'];
        const char  = chars[Math.floor(Math.random()*chars.length)];
        const { data } = await axios.get(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(char)}&limit=1`, { timeout: 8000 });
        const d = data?.data?.[0];
        if (!d) { await reply(`🌸 Random char: *${char}*`); break; }
        const info = `🌸 *${d.name}*\n\nFavorites: ${d.favorites?.toLocaleString() || '?'}\n\n${(d.about||'').slice(0,300)}`;
        if (d.images?.jpg?.image_url) {
          await sock.sendMessage(jid, { image: { url: d.images.jpg.image_url }, caption: ft(info, sock) }, { quoted: m });
        } else {
          await reply(ft(info, sock));
        }
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'gameinfo': {
      if (!text) { await reply(`🎮 *${prefix}gameinfo <game name>*`); break; }
      await reaction('🎮');
      try {
        const { data } = await axios.get(
          `https://api.rawg.io/api/games?search=${query}&key=&page_size=1`,
          { timeout: 10000 }
        );
        const d = data?.results?.[0];
        if (!d) throw new Error('Not found');
        const info =
          `🎮 *${d.name}*\n` +
          `📅 Released: ${d.released || 'N/A'}\n` +
          `⭐ Rating: ${d.rating || 'N/A'}/5\n` +
          `🖥️ Platforms: ${d.platforms?.map(p=>p.platform.name).slice(0,4).join(', ') || 'N/A'}\n` +
          `🎭 Genres: ${d.genres?.map(g=>g.name).join(', ') || 'N/A'}`;
        if (d.background_image) {
          await sock.sendMessage(jid, { image: { url: d.background_image }, caption: ft(info, sock) }, { quoted: m });
        } else {
          await reply(ft(info, sock));
        }
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    // ── LANGUAGE & KNOWLEDGE ─────────────────────────────────

    case 'dictionary': {
      if (!text) { await reply(`📖 *${prefix}dictionary <word>*`); break; }
      await reaction('📖');
      try {
        const { data } = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`, { timeout: 8000 });
        const entry = data?.[0];
        if (!entry) throw new Error('Word not found');
        const meanings = entry.meanings?.slice(0,2).map(m =>
          `*${m.partOfSpeech}*: ${m.definitions?.[0]?.definition || ''}`
        ).join('\n');
        await reply(ft(`📖 *${entry.word}*\n${entry.phonetic||''}\n\n${meanings}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'thesaurus': {
      if (!text) { await reply(`📚 *${prefix}thesaurus <word>*`); break; }
      await reaction('📚');
      try {
        const { data } = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`, { timeout: 8000 });
        const entry = data?.[0];
        const synonyms = entry?.meanings?.flatMap(m => m.definitions?.flatMap(d => d.synonyms||[])||[]).slice(0,15);
        const antonyms = entry?.meanings?.flatMap(m => m.definitions?.flatMap(d => d.antonyms||[])||[]).slice(0,10);
        await reply(ft(
          `📚 *${text}*\n\n✅ Synonyms: ${synonyms?.join(', ')||'None'}\n❌ Antonyms: ${antonyms?.join(', ')||'None'}`,
          sock
        ));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'wikipedia': {
      if (!text) { await reply(`📰 *${prefix}wikipedia <topic>*`); break; }
      await reaction('📰');
      try {
        const { data } = await axios.get(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`,
          { timeout: 10000 }
        );
        if (!data?.extract) throw new Error('Not found');
        const info = `📰 *${data.title}*\n\n${data.extract.slice(0,800)}...\n\n🔗 ${data.content_urls?.desktop?.page||''}`;
        if (data.thumbnail?.source) {
          await sock.sendMessage(jid, { image: { url: data.thumbnail.source }, caption: ft(info, sock) }, { quoted: m });
        } else {
          await reply(ft(info, sock));
        }
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'news': {
      await reaction('📰');
      try {
        const topic = text || 'technology';
        const { data } = await axios.get(
          `https://gnews.io/api/v4/search?q=${encodeURIComponent(topic)}&lang=en&max=5&apikey=free`,
          { timeout: 10000 }
        );
        const articles = data?.articles || [];
        if (!articles.length) throw new Error('No news found');
        const list = articles.slice(0,5).map((a,i) =>
          `${i+1}. *${a.title}*\n   📅 ${a.publishedAt?.slice(0,10)||''} | 🔗 ${a.url||''}`
        ).join('\n\n');
        await reply(ft(`📰 *Top News: ${topic}*\n\n${list}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    // ── FINANCE ───────────────────────────────────────────────

    case 'crypto': {
      const coin = (text || 'bitcoin').toLowerCase();
      await reaction('💰');
      try {
        const { data } = await axios.get(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd,eur&include_24hr_change=true`,
          { timeout: 8000 }
        );
        const d = data?.[coin];
        if (!d) throw new Error('Coin not found');
        const change = (d.usd_24h_change||0).toFixed(2);
        const arrow  = change >= 0 ? '📈' : '📉';
        await reply(ft(
          `💰 *${coin.toUpperCase()}*\n\n${arrow} USD: $${d.usd?.toLocaleString()}\n💶 EUR: €${d.eur?.toLocaleString()}\n📊 24h: ${change}%`,
          sock
        ));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'currency': {
      // .currency 100 USD KES
      const parts2 = text.split(/\s+/);
      const amount = parseFloat(parts2[0]) || 1;
      const from   = (parts2[1] || 'USD').toUpperCase();
      const to     = (parts2[2] || 'KES').toUpperCase();
      await reaction('💱');
      try {
        const { data } = await axios.get(
          `https://api.exchangerate-api.com/v4/latest/${from}`,
          { timeout: 8000 }
        );
        const rate   = data?.rates?.[to];
        if (!rate) throw new Error(`Rate for ${to} not found`);
        const result = (amount * rate).toFixed(2);
        await reply(ft(`💱 *Currency Converter*\n\n${amount} ${from} = *${result} ${to}*\nRate: 1 ${from} = ${rate} ${to}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'football': {
      await reaction('⚽');
      try {
        const { data } = await axios.get(
          `https://v3.football.api-sports.io/fixtures?live=all`,
          { timeout: 8000, headers: { 'x-rapidapi-key': 'free' } }
        );
        const fixtures = data?.response?.slice(0,5) || [];
        if (!fixtures.length) {
          await reply(ft('⚽ No live matches right now.', sock)); break;
        }
        const list = fixtures.map(f =>
          `⚽ *${f.teams?.home?.name}* ${f.goals?.home||0} - ${f.goals?.away||0} *${f.teams?.away?.name}*\n   ${f.fixture?.status?.elapsed||0}' | ${f.league?.name||''}`
        ).join('\n\n');
        await reply(ft(`⚽ *Live Matches*\n\n${list}`, sock));
      } catch (e) { await reply(`⚽ Live scores unavailable: ${e.message}`); }
      break;
    }

    case 'weather2': {
      if (!text) { await reply(`🌤️ *${prefix}weather2 <city>*`); break; }
      await reaction('🌤️');
      try {
        const { data } = await axios.get(
          `https://wttr.in/${encodeURIComponent(text)}?format=j1`,
          { timeout: 8000 }
        );
        const c   = data?.current_condition?.[0];
        const loc = data?.nearest_area?.[0]?.areaName?.[0]?.value || text;
        if (!c) throw new Error('Not found');
        await reply(ft(
          `🌤️ *Weather in ${loc}*\n\n` +
          `🌡️ Temp: ${c.temp_C}°C / ${c.temp_F}°F\n` +
          `💧 Humidity: ${c.humidity}%\n` +
          `💨 Wind: ${c.windspeedKmph} km/h\n` +
          `☁️ Condition: ${c.weatherDesc?.[0]?.value||'N/A'}`,
          sock
        ));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    // ── IMAGES ───────────────────────────────────────────────

    case 'waifu2': {
      await reaction('🌸');
      try {
        const { data } = await axios.get('https://api.waifu.pics/sfw/waifu', { timeout: 8000 });
        await sock.sendMessage(jid, { image: { url: data.url }, caption: ft('🌸 Waifu~', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'neko': {
      await reaction('🐱');
      try {
        const { data } = await axios.get('https://api.waifu.pics/sfw/neko', { timeout: 8000 });
        await sock.sendMessage(jid, { image: { url: data.url }, caption: ft('🐱 Neko~', sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'animeimg': {
      await reaction('🎌');
      try {
        const categories = ['waifu','neko','shinobu','megumin','bully','cuddle','cry','hug','kiss','lick','pat','smug','bonk','yeet','blush','smile','wave','highfive','handhold','nom','bite','slap','happy','wink','poke','dance','cringe'];
        const cat  = text || categories[Math.floor(Math.random()*categories.length)];
        const { data } = await axios.get(`https://api.waifu.pics/sfw/${cat}`, { timeout: 8000 });
        await sock.sendMessage(jid, { image: { url: data.url }, caption: ft(`🎌 ${cat}~`, sock) }, { quoted: m });
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'motivate': {
      await reaction('💪');
      try {
        const { data } = await axios.get('https://zenquotes.io/api/random', { timeout: 8000 });
        const q = data?.[0];
        await reply(ft(`💪 *Motivational Quote*\n\n_"${q?.q || 'Keep going!'}"_\n\n— ${q?.a || 'Unknown'}`, sock));
      } catch { await reply(ft('💪 *Keep pushing forward. Every day is a new chance to grow!*', sock)); }
      break;
    }

    case 'fakeid': {
      await reaction('🪪');
      const names = ['Alex Johnson','Maria Santos','James Kimani','Yuki Tanaka','Amara Osei'];
      const cities = ['Nairobi','Lagos','Tokyo','London','New York'];
      const name = names[Math.floor(Math.random()*names.length)];
      const city = cities[Math.floor(Math.random()*cities.length)];
      const year = 1980 + Math.floor(Math.random()*30);
      const id   = Math.floor(Math.random()*9000000000+1000000000);
      await reply(ft(
        `🪪 *Fake Identity (for testing only)*\n\n` +
        `👤 Name: ${name}\n` +
        `🗓 DOB: ${String(Math.floor(Math.random()*28)+1).padStart(2,'0')}/${String(Math.floor(Math.random()*12)+1).padStart(2,'0')}/${year}\n` +
        `📍 City: ${city}\n` +
        `🔢 ID: ${id}`,
        sock
      ));
      break;
    }

    // ── UTILITY ──────────────────────────────────────────────

    case 'screenshot': {
      if (!text) { await reply(`📸 *${prefix}screenshot <URL>*`); break; }
      await reaction('📸'); await reply('⏳ Taking screenshot...');
      try {
        const { data } = await axios.get(
          `https://api.screenshotone.com/take?url=${encodeURIComponent(text)}&format=jpg`,
          { responseType: 'arraybuffer', timeout: 20000 }
        );
        await sock.sendMessage(jid, { image: Buffer.from(data), caption: ft(`📸 ${text}`, sock) }, { quoted: m });
      } catch (e) {
        // Fallback: thum.io
        try {
          const url = `https://image.thum.io/get/width/1280/crop/900/${encodeURIComponent(text)}`;
          await sock.sendMessage(jid, { image: { url }, caption: ft(`📸 ${text}`, sock) }, { quoted: m });
        } catch { await reply(`❌ ${e.message}`); }
      }
      break;
    }

    case 'pastebin': {
      if (!text) { await reply(`📋 *${prefix}pastebin <text>*\n\nUploads your text to a paste service.`); break; }
      await reaction('📋');
      try {
        const { data } = await axios.post(
          'https://pastebin.com/api/api_post.php',
          new URLSearchParams({ api_dev_key: 'public', api_option: 'paste', api_paste_code: text, api_paste_expire_date: '1D' }).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
        );
        await reply(ft(`📋 *Pasted!*\n\n🔗 ${data}`, sock));
      } catch { await reply(`❌ Paste failed`); }
      break;
    }

    case 'shorturl2': {
      if (!text) { await reply(`🔗 *${prefix}shorturl2 <URL>*`); break; }
      await reaction('🔗');
      try {
        const { data } = await axios.get(
          `https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`,
          { timeout: 8000 }
        );
        await reply(ft(`🔗 *Shortened URL*\n\n${data}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'reverseimage': {
      await reaction('🔍');
      await reply(
        `🔍 *Reverse Image Search*\n\n` +
        `Send me an image first, then reply:\n` +
        `1. Reply to the image with *${prefix}reverseimage*\n\n` +
        `Or: ${prefix}reverseimage <image URL>\n\n` +
        `🔗 Google Lens: https://lens.google.com`
      );
      break;
    }

    default:
      return false;
  }

  return true;
}

module.exports = { scrapsHandler};
