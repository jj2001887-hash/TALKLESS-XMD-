// ai.js – 30+ AI-powered Commands
'use strict';
const axios = require('axios');

const AI_CMDS = [
  'gpt','ask','chat','explain','summarize','translate2','rewrite',
  'code','debugcode','reviewcode','pseudocode','regex',
  'essay','poem2','story2','lyrics2ai','caption2','tweet','email2',
  'roastme','complimentme','horoscope2','fortune','affirmation',
  'recipe2','workout2','studyplan','namecheck','brandname',
  'slogan','bio','cv',
];

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL      = 'claude-sonnet-4-20250514';

async function askClaude(systemPrompt, userMsg, maxTokens = 800) {
  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text?.trim() || '';
}

async function aiHandler(sock, m, cmd, args, helpers) {
  if (!AI_CMDS.includes(cmd)) return false;
  const { reply, ft, cfg, reaction } = helpers;
  const jid    = m.key.remoteJid;
  const prefix = cfg(sock).prefix || '.';
  const text   = args.join(' ');

  const thinkMsg = async () => sock.sendMessage(jid, { text: '🤖 Thinking...' }, { quoted: m });

  switch (cmd) {
    case 'gpt':
    case 'ask':
    case 'chat': {
      if (!text) { await reply(`🤖 *${prefix}${cmd} <your question>*`); break; }
      await reaction('🤖');
      const wait = await thinkMsg();
      try {
        const ans = await askClaude('You are a helpful assistant. Be concise but thorough.', text);
        if (wait?.key) await sock.sendMessage(jid, { text: ft(ans, sock), edit: wait.key }).catch(()=>{});
        else await reply(ft(ans, sock));
      } catch (e) { await reply(`❌ AI error: ${e.message}`); }
      break;
    }
    case 'explain': {
      if (!text) { await reply(`📚 *${prefix}explain <topic>*`); break; }
      await reaction('📚');
      const wait2 = await thinkMsg();
      try {
        const ans2 = await askClaude('Explain things simply as if to a beginner. Use analogies. Keep it under 300 words.', `Explain: ${text}`);
        if (wait2?.key) await sock.sendMessage(jid, { text: ft(ans2, sock), edit: wait2.key }).catch(()=>{});
        else await reply(ft(ans2, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'summarize': {
      if (!text) { await reply(`📝 *${prefix}summarize <text or topic>*`); break; }
      await reaction('📝');
      const wait3 = await thinkMsg();
      try {
        const ans3 = await askClaude('Summarize the following in 3-5 bullet points. Be concise.', text);
        if (wait3?.key) await sock.sendMessage(jid, { text: ft(ans3, sock), edit: wait3.key }).catch(()=>{});
        else await reply(ft(ans3, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'translate2': {
      const parts = text.split(' to ');
      const src   = parts[0]?.trim();
      const lang  = parts[1]?.trim() || 'English';
      if (!src) { await reply(`🌍 *${prefix}translate2 <text> to <language>*`); break; }
      await reaction('🌍');
      const wait4 = await thinkMsg();
      try {
        const ans4 = await askClaude(`You are a translator. Translate the given text to ${lang}. Output only the translation.`, src);
        if (wait4?.key) await sock.sendMessage(jid, { text: ft(`🌍 *→ ${lang}*\n\n${ans4}`, sock), edit: wait4.key }).catch(()=>{});
        else await reply(ft(`🌍 *→ ${lang}*\n\n${ans4}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'rewrite': {
      if (!text) { await reply(`✏️ *${prefix}rewrite <text>*`); break; }
      await reaction('✏️');
      const wait5 = await thinkMsg();
      try {
        const ans5 = await askClaude('Rewrite the following text to be clearer, more professional, and better structured. Keep the same meaning.', text);
        if (wait5?.key) await sock.sendMessage(jid, { text: ft(ans5, sock), edit: wait5.key }).catch(()=>{});
        else await reply(ft(ans5, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'code': {
      if (!text) { await reply(`💻 *${prefix}code <describe what you need>*\nExample: ${prefix}code python script to sort a list`); break; }
      await reaction('💻');
      const wait6 = await thinkMsg();
      try {
        const ans6 = await askClaude('You are an expert programmer. Write clean, commented code for the user\'s request. Include a brief explanation.', text, 1000);
        if (wait6?.key) await sock.sendMessage(jid, { text: ft(ans6, sock), edit: wait6.key }).catch(()=>{});
        else await reply(ft(ans6, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'debugcode': {
      if (!text) { await reply(`🐛 *${prefix}debugcode <paste your code>*`); break; }
      await reaction('🐛');
      const wait7 = await thinkMsg();
      try {
        const ans7 = await askClaude('You are a code debugger. Find bugs in the code, explain what\'s wrong, and provide a fixed version.', text, 1000);
        if (wait7?.key) await sock.sendMessage(jid, { text: ft(ans7, sock), edit: wait7.key }).catch(()=>{});
        else await reply(ft(ans7, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'reviewcode': {
      if (!text) { await reply(`🔍 *${prefix}reviewcode <paste your code>*`); break; }
      await reaction('🔍');
      const wait8 = await thinkMsg();
      try {
        const ans8 = await askClaude('Review this code for quality, performance, security issues, and best practices. Give constructive feedback.', text, 1000);
        if (wait8?.key) await sock.sendMessage(jid, { text: ft(ans8, sock), edit: wait8.key }).catch(()=>{});
        else await reply(ft(ans8, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'pseudocode': {
      if (!text) { await reply(`📋 *${prefix}pseudocode <algorithm or task>*`); break; }
      await reaction('📋');
      const wait9 = await thinkMsg();
      try {
        const ans9 = await askClaude('Convert the following into clear pseudocode. Use standard pseudocode conventions.', text);
        if (wait9?.key) await sock.sendMessage(jid, { text: ft(ans9, sock), edit: wait9.key }).catch(()=>{});
        else await reply(ft(ans9, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'regex': {
      if (!text) { await reply(`🔤 *${prefix}regex <describe what you need to match>*`); break; }
      await reaction('🔤');
      const wait10 = await thinkMsg();
      try {
        const ans10 = await askClaude('Generate a regex pattern for the user\'s request. Explain it clearly with examples.', `Generate regex for: ${text}`);
        if (wait10?.key) await sock.sendMessage(jid, { text: ft(ans10, sock), edit: wait10.key }).catch(()=>{});
        else await reply(ft(ans10, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'essay': {
      if (!text) { await reply(`📄 *${prefix}essay <topic>*`); break; }
      await reaction('📄');
      const waitE = await thinkMsg();
      try {
        const ansE = await askClaude('Write a short 3-paragraph essay on the given topic. Include intro, body, conclusion.', text, 1000);
        if (waitE?.key) await sock.sendMessage(jid, { text: ft(ansE, sock), edit: waitE.key }).catch(()=>{});
        else await reply(ft(ansE, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'poem2': {
      const topic2 = text || 'life';
      await reaction('🎭');
      const waitP = await thinkMsg();
      try {
        const ansP = await askClaude('Write a short, beautiful poem (8-16 lines). Be creative and emotional.', `Write a poem about: ${topic2}`);
        if (waitP?.key) await sock.sendMessage(jid, { text: ft(`🎭 *Poem: ${topic2}*\n\n${ansP}`, sock), edit: waitP.key }).catch(()=>{});
        else await reply(ft(`🎭 *Poem: ${topic2}*\n\n${ansP}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'story2': {
      if (!text) { await reply(`📖 *${prefix}story2 <premise>*`); break; }
      await reaction('📖');
      const waitS = await thinkMsg();
      try {
        const ansS = await askClaude('Write a short engaging story (200-300 words) based on the premise.', text, 1000);
        if (waitS?.key) await sock.sendMessage(jid, { text: ft(ansS, sock), edit: waitS.key }).catch(()=>{});
        else await reply(ft(ansS, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'tweet': {
      if (!text) { await reply(`🐦 *${prefix}tweet <topic>*\nGenerates a viral tweet.`); break; }
      await reaction('🐦');
      const waitT = await thinkMsg();
      try {
        const ansT = await askClaude('Write a short viral tweet (under 280 chars) on the topic. Be witty, engaging, and include 1-2 hashtags.', text);
        if (waitT?.key) await sock.sendMessage(jid, { text: ft(`🐦 *Tweet*\n\n${ansT}`, sock), edit: waitT.key }).catch(()=>{});
        else await reply(ft(`🐦 *Tweet*\n\n${ansT}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'email2': {
      if (!text) { await reply(`📧 *${prefix}email2 <purpose>*\nExample: ${prefix}email2 request leave from work`); break; }
      await reaction('📧');
      const waitEM = await thinkMsg();
      try {
        const ansEM = await askClaude('Write a professional email for the given purpose. Include Subject, greeting, body, and sign-off.', text);
        if (waitEM?.key) await sock.sendMessage(jid, { text: ft(ansEM, sock), edit: waitEM.key }).catch(()=>{});
        else await reply(ft(ansEM, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'roastme': {
      const name = text || 'this person';
      await reaction('🔥');
      const waitR = await thinkMsg();
      try {
        const ansR = await askClaude('Write a funny, witty roast. Keep it playful, not mean. No slurs or genuinely hurtful content.', `Roast: ${name}`);
        if (waitR?.key) await sock.sendMessage(jid, { text: ft(`🔥 *Roast: ${name}*\n\n${ansR}`, sock), edit: waitR.key }).catch(()=>{});
        else await reply(ft(`🔥 *Roast: ${name}*\n\n${ansR}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'horoscope2': {
      const sign = text || 'Aries';
      await reaction('🔮');
      const waitH = await thinkMsg();
      try {
        const ansH = await askClaude('Give a fun, creative horoscope reading for today. Be mystical but entertaining.', `Horoscope for ${sign}`);
        if (waitH?.key) await sock.sendMessage(jid, { text: ft(`🔮 *${sign} Horoscope*\n\n${ansH}`, sock), edit: waitH.key }).catch(()=>{});
        else await reply(ft(`🔮 *${sign} Horoscope*\n\n${ansH}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'fortune': {
      await reaction('🥠');
      const waitF = await thinkMsg();
      try {
        const ansF = await askClaude('Give a short mysterious fortune cookie message. Be cryptic, wise, and slightly funny.', 'Give me a fortune cookie message');
        if (waitF?.key) await sock.sendMessage(jid, { text: ft(`🥠 *Fortune*\n\n_"${ansF}"_`, sock), edit: waitF.key }).catch(()=>{});
        else await reply(ft(`🥠 *Fortune*\n\n_"${ansF}"_`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'affirmation': {
      await reaction('💪');
      const waitAF = await thinkMsg();
      try {
        const ansAF = await askClaude('Write 5 powerful, positive daily affirmations. Be uplifting and specific.', 'Give me 5 daily affirmations');
        if (waitAF?.key) await sock.sendMessage(jid, { text: ft(`💪 *Daily Affirmations*\n\n${ansAF}`, sock), edit: waitAF.key }).catch(()=>{});
        else await reply(ft(`💪 *Daily Affirmations*\n\n${ansAF}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'recipe2': {
      if (!text) { await reply(`🍳 *${prefix}recipe2 <dish or ingredients>*`); break; }
      await reaction('🍳');
      const waitRC = await thinkMsg();
      try {
        const ansRC = await askClaude('Give a simple recipe with ingredients list and step-by-step instructions. Keep it practical.', `Recipe for: ${text}`);
        if (waitRC?.key) await sock.sendMessage(jid, { text: ft(ansRC, sock), edit: waitRC.key }).catch(()=>{});
        else await reply(ft(ansRC, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'workout2': {
      const goal = text || 'general fitness';
      await reaction('🏋️');
      const waitW = await thinkMsg();
      try {
        const ansW = await askClaude('Create a practical workout plan with exercises, sets, reps, and rest times. Be specific and beginner-friendly.', `Workout plan for: ${goal}`);
        if (waitW?.key) await sock.sendMessage(jid, { text: ft(ansW, sock), edit: waitW.key }).catch(()=>{});
        else await reply(ft(ansW, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'studyplan': {
      if (!text) { await reply(`📚 *${prefix}studyplan <subject and timeframe>*\nExample: ${prefix}studyplan Python in 30 days`); break; }
      await reaction('📚');
      const waitSP = await thinkMsg();
      try {
        const ansSP = await askClaude('Create a structured study plan with daily/weekly tasks, resources, and milestones.', text);
        if (waitSP?.key) await sock.sendMessage(jid, { text: ft(ansSP, sock), edit: waitSP.key }).catch(()=>{});
        else await reply(ft(ansSP, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'brandname': {
      if (!text) { await reply(`🏷️ *${prefix}brandname <describe your business>*`); break; }
      await reaction('🏷️');
      const waitBN = await thinkMsg();
      try {
        const ansBN = await askClaude('Generate 5 creative, catchy brand names for the business described. Explain each briefly.', text);
        if (waitBN?.key) await sock.sendMessage(jid, { text: ft(`🏷️ *Brand Names*\n\n${ansBN}`, sock), edit: waitBN.key }).catch(()=>{});
        else await reply(ft(`🏷️ *Brand Names*\n\n${ansBN}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'slogan': {
      if (!text) { await reply(`📢 *${prefix}slogan <brand or product>*`); break; }
      await reaction('📢');
      const waitSL = await thinkMsg();
      try {
        const ansSL = await askClaude('Create 5 catchy, memorable slogans for the brand/product.', text);
        if (waitSL?.key) await sock.sendMessage(jid, { text: ft(`📢 *Slogans*\n\n${ansSL}`, sock), edit: waitSL.key }).catch(()=>{});
        else await reply(ft(`📢 *Slogans*\n\n${ansSL}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'bio': {
      const bioText = text || 'a creative person';
      await reaction('👤');
      const waitBI = await thinkMsg();
      try {
        const ansBI = await askClaude('Write a short, engaging social media bio (under 150 chars). Be creative and fun.', `Bio for: ${bioText}`);
        if (waitBI?.key) await sock.sendMessage(jid, { text: ft(`👤 *Bio Suggestion*\n\n${ansBI}`, sock), edit: waitBI.key }).catch(()=>{});
        else await reply(ft(`👤 *Bio Suggestion*\n\n${ansBI}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'cv': {
      if (!text) { await reply(`📄 *${prefix}cv <your profession and skills>*`); break; }
      await reaction('📄');
      const waitCV = await thinkMsg();
      try {
        const ansCV = await askClaude('Write a professional CV summary section (3-4 sentences) and list key skills.', text);
        if (waitCV?.key) await sock.sendMessage(jid, { text: ft(`📄 *CV Summary*\n\n${ansCV}`, sock), edit: waitCV.key }).catch(()=>{});
        else await reply(ft(`📄 *CV Summary*\n\n${ansCV}`, sock));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    default: return false;
  }
  return true;
}

module.exports = { aiHandler };
