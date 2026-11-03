// social.js – 30+ Social/Group Commands
'use strict';
const axios = require('axios');

const SOCIAL_CMDS = [
  'ship2','crush','compatibility','lovemeter','heartrate',
  'advice','rant','confession','compliment2','insult2',
  'pickup','rizz','wouldyou','neverhave','hotornot',
  'simp','toxic','villain','hero','npccheck',
  'zodiac','personality','mbti','vibe','aura',
  'rate','ratemyname','ratemy','aesthetic','drip',
  'ratio','clout','slay','flop',
];

async function socialHandler(sock, m, cmd, args, helpers) {
  if (!SOCIAL_CMDS.includes(cmd)) return false;
  const { reply, ft, cfg } = helpers;
  const jid    = m.key.remoteJid;
  const prefix = cfg(sock).prefix || '.';
  const text   = args.join(' ');

  const pct = (seed) => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
    return Math.abs(h) % 101;
  };
  const bar = (n) => '█'.repeat(Math.round(n/10)) + '░'.repeat(10-Math.round(n/10));

  switch (cmd) {
    case 'ship2': {
      const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const p1 = args[0] || (mentioned[0]?.split('@')[0]) || 'Person1';
      const p2 = args[1] || (mentioned[1]?.split('@')[0]) || 'Person2';
      const score = pct(p1+p2);
      const emoji = score>80?'💞':score>60?'💕':score>40?'💛':score>20?'💔':'😬';
      await reply(ft(`💑 *Ship: ${p1} × ${p2}*\n\n${emoji} ${bar(score)} ${score}%\n\n${score>70?'Perfect match! 💍':score>50?'Good vibes 😊':score>30?'It\'s complicated 🤔':'Not meant to be 💔'}`, sock));
      break;
    }
    case 'lovemeter': {
      const name = text || 'someone';
      const score2 = pct('love'+name);
      await reply(ft(`❤️ *Love Meter for ${name}*\n\n${bar(score2)} ${score2}%\n\n${score2>80?'Head over heels! 😍':score2>60?'Strong feelings 💕':score2>40?'Just a crush 😊':score2>20?'Mild interest 💛':'Friendzone 😅'}`, sock));
      break;
    }
    case 'compatibility': {
      const p1b = args[0]||'You', p2b = args[1]||'Them';
      const s = pct(p1b+p2b+'compat');
      await reply(ft(`🔮 *Compatibility*\n\n${p1b} & ${p2b}\n\n${bar(s)} ${s}%\n\n${s>80?'Soulmates! ✨':s>60?'Very compatible 💯':s>40?'Some differences 🤝':s>20?'Opposites attract? 🤷':'Different worlds 🌍'}`, sock));
      break;
    }
    case 'heartrate': {
      const bpm = 60 + Math.floor(Math.random()*100);
      const status = bpm<70?'💤 Resting':bpm<100?'😊 Normal':bpm<130?'😤 Elevated':'💓 Excited!';
      await reply(ft(`💓 *Heart Rate*\n\n${bpm} BPM\nStatus: ${status}`, sock));
      break;
    }
    case 'advice': {
      try {
        const { data } = await axios.get('https://api.adviceslip.com/advice', { timeout:8000 });
        await reply(ft(`💡 *Advice*\n\n_"${data.slip?.advice || 'Keep going, you got this!'}"_`, sock));
      } catch { await reply(ft('💡 *Advice*\n\n_"Every day is a new opportunity."_', sock)); }
      break;
    }
    case 'compliment2': {
      const compliments = ['You\'re an absolute legend 👑','Your energy is unmatched ✨','You make everything better 💛','You\'re built different 💪','You\'re the main character fr 🌟','Lowkey one of the realest ones 💯','You\'re that girl/guy fr fr 🔥','Your drip is immaculate 💧','You\'re giving what it needs to give 💅','Big brain energy 🧠'];
      const target = text || 'you';
      await reply(ft(`💛 *Compliment for ${target}*\n\n${compliments[Math.floor(Math.random()*compliments.length)]}`, sock));
      break;
    }
    case 'insult2': {
      const insults = ['You\'re a human participation trophy 🏆','Your vibe is on mute 📵','You give off 404 personality not found energy 💻','You\'re the loading screen of people 🔄','Built like a WiFi signal in a basement 📶','Your fashion sense called — it wants a refund 👕','You\'re giving discount energy 💸','Main character? More like deleted scene 🎬','You\'re a background NPC and you know it 🎮','Running on Windows 98 energy 🖥️'];
      const target2 = text || 'you';
      await reply(ft(`😤 *Insult for ${target2}*\n\n${insults[Math.floor(Math.random()*insults.length)]}\n\n_(Just for fun!)_`, sock));
      break;
    }
    case 'pickup': {
      const lines = ['Are you a parking ticket? You\'ve got fine written all over you 🎫','Do you have a map? I keep getting lost in your eyes 🗺️','Are you a magician? Because whenever I look at you, everyone else disappears ✨','Are you Wi-Fi? Because I\'m feeling a connection 📶','Is your name Google? Because you have everything I\'ve been searching for 🔍','Do you believe in love at first swipe? 📱','Are you a camera? Because every time I see you, I smile 📸','Is your name Bluetooth? Because I feel a connection when you\'re near me 💙'];
      await reply(ft(`😏 *Pick-up Line*\n\n${lines[Math.floor(Math.random()*lines.length)]}`, sock));
      break;
    }
    case 'rizz': {
      const rizzLines = ['My love for you is like dividing by zero — it can\'t be defined 🧮','Are you a function? Because you complete me 📐','I must be a snowflake, because I\'ve fallen for you ❄️','If beauty were time, you\'d be an eternity ⏳','I\'m not a photographer, but I can picture us together 📷'];
      const score3 = Math.floor(Math.random()*100);
      await reply(ft(`🗣️ *Rizz Level: ${score3}/100*\n\n${score3>80?'W rizz 🔥':score3>50?'Mid rizz 😐':'L rizz 😬'}\n\nLine: _"${rizzLines[Math.floor(Math.random()*rizzLines.length)]}"_`, sock));
      break;
    }
    case 'simp': {
      const target3 = text || 'you';
      const s2 = pct(target3+'simp');
      await reply(ft(`🥺 *Simp Meter for ${target3}*\n\n${bar(s2)} ${s2}%\n\n${s2>80?'Certified simp 😔':s2>50?'Simp in denial 🤡':s2>30?'Borderline simp 🧐':'Not a simp 😤'}`, sock));
      break;
    }
    case 'toxic': {
      const target4 = text || 'you';
      const t = pct(target4+'toxic');
      await reply(ft(`☠️ *Toxicity Level for ${target4}*\n\n${bar(t)} ${t}%\n\n${t>80?'Highly toxic ☠️':t>60?'Pretty toxic 😈':t>40?'Neutral energy 😐':t>20?'Pretty wholesome 💚':'Angel energy 😇'}`, sock));
      break;
    }
    case 'villain': {
      const villains = ['Overconfident but charming','Silent but deadly','Chaotic neutral energy','Cold and calculated','Misunderstood genius','Drama queen with power','Anime final boss vibes'];
      await reply(ft(`😈 *Your Villain Arc*\n\n${villains[Math.floor(Math.random()*villains.length)]}\n\nVillain score: ${Math.floor(Math.random()*100)}%`, sock));
      break;
    }
    case 'hero': {
      const types = ['The reluctant hero','The overconfident champion','The quiet protector','The chaotic good wildcard','The strategic mastermind','The one who never gives up'];
      await reply(ft(`🦸 *Your Hero Type*\n\n${types[Math.floor(Math.random()*types.length)]}`, sock));
      break;
    }
    case 'zodiac': {
      const signs = ['♈ Aries','♉ Taurus','♊ Gemini','♋ Cancer','♌ Leo','♍ Virgo','♎ Libra','♏ Scorpio','♐ Sagittarius','♑ Capricorn','♒ Aquarius','♓ Pisces'];
      const traits = ['Bold and impulsive','Patient and stubborn','Witty and two-faced (in a fun way)','Emotional and nurturing','Dramatic and loyal','Perfectionist and overthinks everything','Balanced but indecisive','Intense and mysterious','Adventurous and honest','Ambitious and cold','Original and rebellious','Dreamy and empathetic'];
      if (!text) { await reply(ft(`♑ *${prefix}zodiac <sign>*\n\nSigns: ${signs.join(', ')}`, sock)); break; }
      const idx = signs.findIndex(s=>s.toLowerCase().includes(text.toLowerCase()));
      if (idx===-1) { await reply(`❌ Sign not found. Try: aries, leo, scorpio...`); break; }
      await reply(ft(`${signs[idx]}\n\n${traits[idx]}`, sock));
      break;
    }
    case 'mbti': {
      const types2 = ['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'];
      const type2  = text.toUpperCase();
      if (!types2.includes(type2)) { await reply(ft(`🧠 *${prefix}mbti <type>*\nTypes: ${types2.join(', ')}`, sock)); break; }
      const descriptions = { INTJ:'The Architect — Strategic mastermind',INTP:'The Logician — Innovative thinker',ENTJ:'The Commander — Natural leader',ENTP:'The Debater — Devil\'s advocate',INFJ:'The Advocate — Quietly insightful',INFP:'The Mediator — Creative idealist',ENFJ:'The Protagonist — Charismatic mentor',ENFP:'The Campaigner — Enthusiastic connector',ISTJ:'The Logistician — Reliable and thorough',ISFJ:'The Defender — Warm protector',ESTJ:'The Executive — Organized and direct',ESFJ:'The Consul — Caring and social',ISTP:'The Virtuoso — Bold experimenter',ISFP:'The Adventurer — Flexible and charming',ESTP:'The Entrepreneur — Action-oriented',ESFP:'The Entertainer — Spontaneous and fun' };
      await reply(ft(`🧠 *MBTI: ${type2}*\n\n${descriptions[type2]||'Unknown type'}`, sock));
      break;
    }
    case 'vibe': {
      const vibes = ['Main character energy 🌟','Villain arc activated 😈','Soft life mode on ☁️','Chaotic good energy ⚡','NPC mode 🎮','Sigma grindset 💼','Chill vibes only 🌊','Unmatched aura ✨','Giving final boss 🏆','Lowkey iconic 💅'];
      await reply(ft(`✨ *Vibe Check*\n\n${vibes[Math.floor(Math.random()*vibes.length)]}`, sock));
      break;
    }
    case 'aura': {
      const colors = ['💜 Purple — Mysterious and powerful','🔵 Blue — Calm and trustworthy','🟢 Green — Healing and balanced','🔴 Red — Passionate and intense','🟡 Yellow — Creative and joyful','⚪ White — Pure and spiritual','🖤 Black — Protective and misunderstood','🟠 Orange — Energetic and social'];
      await reply(ft(`🌈 *Your Aura Color*\n\n${colors[Math.floor(Math.random()*colors.length)]}`, sock));
      break;
    }
    case 'rate': {
      const target5 = text || 'you';
      const r = pct(target5+'rate2024');
      await reply(ft(`⭐ *Rating for ${target5}*\n\n${'⭐'.repeat(Math.round(r/20))} ${r}/100\n\n${r>80?'Exceptional 🔥':r>60?'Pretty good 👍':r>40?'Average 😐':r>20?'Needs work 😬':'Yikes 💀'}`, sock));
      break;
    }
    case 'drip': {
      const target6 = text || 'your fit';
      const d = pct(target6+'drip');
      await reply(ft(`💧 *Drip Check: ${target6}*\n\n${bar(d)} ${d}%\n\n${d>80?'Absolutely drenched 💧🔥':d>60?'Nice drip 😤':d>40?'Mid fit 😐':d>20?'Dry as a desert 🏜️':'No drip at all 💀'}`, sock));
      break;
    }
    case 'clout': {
      const target7 = text || 'you';
      const c = pct(target7+'clout');
      await reply(ft(`📢 *Clout Level: ${target7}*\n\n${bar(c)} ${c}%\n\n${c>80?'Celebrity status 🌟':c>60?'Micro-influencer 📱':c>40?'Local legend 🏘️':c>20?'Friend group famous 👥':'Who? 🤷'}`, sock));
      break;
    }
    case 'ratio': {
      const target8 = text || 'that tweet';
      await reply(ft(`🗳️ *Ratio Check*\n\nL + ratio + ${target8} + you fell off + stay mad + touch grass + nobody asked`, sock));
      break;
    }
    case 'slay': {
      const slay = ['You ate and left no crumbs 🍽️','Slay all day every day 💅','You understood the assignment 📋','Absolutely iconic behavior 👑','Pure excellence, no notes ✨','You said it and meant it 💯'];
      await reply(ft(`💅 *Slay Check*\n\n${slay[Math.floor(Math.random()*slay.length)]}`, sock));
      break;
    }
    case 'npccheck': {
      const target9 = text || 'you';
      const n = pct(target9+'npc');
      await reply(ft(`🎮 *NPC Check: ${target9}*\n\n${bar(n)} ${n}%\n\n${n>80?'Total NPC 🎮':n>60?'Background character energy 😶':n>40?'Sometimes NPC 🤔':n>20?'Main character moments 🌟':'100% main character ✨'}`, sock));
      break;
    }
    case 'hotornot': {
      const target10 = text || 'you';
      const h = pct(target10+'hot2024');
      await reply(ft(`🔥 *Hot or Not: ${target10}*\n\n${h>50?`🔥 HOT — ${h}%`:`❄️ NOT — ${h}% (${100-h}% hot)`}`, sock));
      break;
    }
    default: return false;
  }
  return true;
}

module.exports = { socialHandler };
