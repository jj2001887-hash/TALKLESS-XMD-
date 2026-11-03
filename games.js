// games.js – 30+ Mini-Game Commands
'use strict';
const fs   = require('fs');
const path = require('path');

const DB  = path.resolve(__dirname, 'database/games.json');
const load = () => { try { return JSON.parse(fs.readFileSync(DB,'utf8')); } catch { return {}; } };
const save = d => fs.writeFileSync(DB, JSON.stringify(d,null,2));
const uid  = m => (m.key.participant||m.key.remoteJid).split('@')[0];

const GAMES_CMDS = [
  'tictactoe','rps2','quiz','typerace','hangman',
  'wordle','numberguess','akinator2','trivia2','riddle2',
  'memory','reaction','fasttype','scramble','anagram',
  'truthordare','neverhaveiever2','wouldyourather2',
  '8ball','fortune2','astrology','personatest','iq',
  'rank','xp','daily2','streak','badge',
  'leaderboard2','achievement2',
];

const TRIVIA_Q = [
  {q:'What is the capital of Japan?',a:'tokyo',opts:['Beijing','Tokyo','Seoul','Bangkok']},
  {q:'How many sides does a hexagon have?',a:'6',opts:['5','6','7','8']},
  {q:'Who painted the Mona Lisa?',a:'da vinci',opts:['Picasso','Da Vinci','Monet','Raphael']},
  {q:'What is the fastest land animal?',a:'cheetah',opts:['Lion','Cheetah','Horse','Leopard']},
  {q:'What gas do plants absorb?',a:'co2',opts:['Oxygen','CO2','Nitrogen','Hydrogen']},
  {q:'In what year did WW2 end?',a:'1945',opts:['1943','1944','1945','1946']},
  {q:'What is the largest planet?',a:'jupiter',opts:['Saturn','Jupiter','Uranus','Neptune']},
  {q:'What is H2O?',a:'water',opts:['Salt','Water','Acid','Oxygen']},
  {q:'Who wrote Harry Potter?',a:'rowling',opts:['Tolkien','Rowling','Martin','King']},
  {q:'What color is the sky?',a:'blue',opts:['Green','Blue','Red','Yellow']},
];

const RIDDLES = [
  {q:'I have hands but can\'t clap. What am I?',a:'clock'},
  {q:'The more you take, the more you leave behind. What am I?',a:'footsteps'},
  {q:'What has a head, a tail, but no body?',a:'coin'},
  {q:'I speak without a mouth and hear without ears. What am I?',a:'echo'},
  {q:'What can travel around the world while staying in a corner?',a:'stamp'},
  {q:'What gets wetter as it dries?',a:'towel'},
  {q:'What has cities but no houses, mountains but no trees, water but no fish?',a:'map'},
  {q:'Forward I am heavy, backwards I am not. What am I?',a:'ton'},
];

const SCRAMBLE_WORDS = ['𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶','MANGA','RAMEN','SUSHI','TOKYO','SAKURA','NINJA','SAMURAI','KATANA','KAWAII'];

async function gamesHandler(sock, m, cmd, args, helpers) {
  if (!GAMES_CMDS.includes(cmd)) return false;
  const { reply, ft, cfg, reaction } = helpers;
  const jid    = m.key.remoteJid;
  const prefix = cfg(sock).prefix || '.';
  const text   = args.join(' ');
  const sender = uid(m);
  const data   = load();

  switch (cmd) {
    case 'trivia2': {
      await reaction('🧠');
      const q    = TRIVIA_Q[Math.floor(Math.random()*TRIVIA_Q.length)];
      const opts = q.opts.map((o,i)=>`${i+1}. ${o}`).join('\n');
      // Store answer in game state
      if (!data.trivia) data.trivia = {};
      data.trivia[jid] = { answer: q.a, expires: Date.now()+30000 };
      save(data);
      await reply(ft(`🧠 *Trivia!*\n\n${q.q}\n\n${opts}\n\nReply with the number or answer in *30 seconds*!`, sock));
      break;
    }
    case 'riddle2': {
      await reaction('🔮');
      const r = RIDDLES[Math.floor(Math.random()*RIDDLES.length)];
      if (!data.riddle) data.riddle = {};
      data.riddle[jid] = { answer: r.a, expires: Date.now()+60000 };
      save(data);
      await reply(ft(`🔮 *Riddle!*\n\n_${r.q}_\n\nReply with the answer in *60 seconds*!`, sock));
      break;
    }
    case 'scramble': {
      await reaction('🔤');
      const word = SCRAMBLE_WORDS[Math.floor(Math.random()*SCRAMBLE_WORDS.length)];
      const scrambled = word.split('').sort(()=>Math.random()-0.5).join('');
      if (!data.scramble) data.scramble = {};
      data.scramble[jid] = { answer: word.toLowerCase(), expires: Date.now()+30000 };
      save(data);
      await reply(ft(`🔤 *Word Scramble!*\n\nUnscramble: *${scrambled}*\n\nReply with the answer in *30 seconds*!`, sock));
      break;
    }
    case 'numberguess': {
      await reaction('🎲');
      const num = Math.floor(Math.random()*100)+1;
      if (!data.guess) data.guess = {};
      data.guess[jid] = { number: num, tries: 5, expires: Date.now()+120000 };
      save(data);
      await reply(ft(`🎲 *Number Guess!*\n\nI'm thinking of a number between 1-100.\nYou have *5 tries*!\n\nUse *${prefix}guess <number>*`, sock));
      break;
    }
    case 'hangman': {
      await reaction('🎭');
      const words2 = ['JAVASCRIPT','TYPESCRIPT','NODEJS','EXPRESS','MONGODB','PYTHON','FLUTTER','ANDROID','FIREBASE','CLOUDFLARE'];
      const word2  = words2[Math.floor(Math.random()*words2.length)];
      const blanks = '_'.repeat(word2.length).split('').join(' ');
      if (!data.hangman) data.hangman = {};
      data.hangman[jid] = { word: word2, guessed: [], tries: 6, expires: Date.now()+300000 };
      save(data);
      await reply(ft(`🎭 *Hangman!*\n\n${blanks}\n\nLength: ${word2.length} letters\nTries left: 6\n\nUse *${prefix}guess <letter>*`, sock));
      break;
    }
    case 'rps2': {
      const choices = ['rock','paper','scissors'];
      const userChoice = args[0]?.toLowerCase();
      if (!choices.includes(userChoice)) { await reply(ft(`✊ *${prefix}rps2 rock/paper/scissors*`, sock)); break; }
      const botChoice  = choices[Math.floor(Math.random()*3)];
      const emoji      = { rock:'✊', paper:'✋', scissors:'✌️' };
      let result4;
      if (userChoice===botChoice) result4 = '🤝 Draw!';
      else if ((userChoice==='rock'&&botChoice==='scissors')||(userChoice==='paper'&&botChoice==='rock')||(userChoice==='scissors'&&botChoice==='paper')) result4 = '🎉 You win!';
      else result4 = '❌ You lose!';
      await reply(ft(`✊ *Rock Paper Scissors*\n\nYou: ${emoji[userChoice]} ${userChoice}\nBot: ${emoji[botChoice]} ${botChoice}\n\n${result4}`, sock));
      break;
    }
    case '8ball': {
      if (!text) { await reply(`🎱 *${prefix}8ball <question>*`); break; }
      const answers = ['It is certain ✅','Without a doubt ✅','Yes definitely ✅','You may rely on it ✅','Most likely ✅','Outlook good 🟡','Ask again later 🟡','Cannot predict now 🟡','Don\'t count on it ❌','My reply is no ❌','My sources say no ❌','Outlook not so good ❌','Very doubtful ❌'];
      await reply(ft(`🎱 *8-Ball*\n\n❓ ${text}\n\n💬 ${answers[Math.floor(Math.random()*answers.length)]}`, sock));
      break;
    }
    case 'iq': {
      const target2 = text || 'you';
      let h = 0;
      for (let i = 0; i < (sender+target2).length; i++) h = Math.imul(31,h)+(sender+target2).charCodeAt(i)|0;
      const iq = 70 + Math.abs(h) % 80;
      const level = iq>130?'🧠 Genius!':iq>110?'✨ Above average':iq>90?'😊 Average':iq>70?'😐 Below average':'🤔 Hmm...';
      await reply(ft(`🧠 *IQ Test: ${target2}*\n\nIQ: *${iq}*\n${level}`, sock));
      break;
    }
    case 'truthordare': {
      const truths  = ['What\'s your biggest fear?','Who was your first crush?','What\'s the most embarrassing thing you\'ve done?','What\'s your biggest secret?','When did you last lie?'];
      const dares   = ['Send a voice note singing for 10 seconds','Change your WhatsApp status to something embarrassing for 1 hour','Text your crush right now','Do 20 pushups','Call someone and say "I love you"'];
      const choice2 = Math.random()>0.5 ? 'Truth' : 'Dare';
      const list2   = choice2==='Truth' ? truths : dares;
      await reply(ft(`🎭 *Truth or Dare*\n\n${choice2==='Truth'?'🤔 TRUTH:':'💪 DARE:'}\n\n${list2[Math.floor(Math.random()*list2.length)]}`, sock));
      break;
    }
    case 'neverhaveiever2': {
      const statements = ['Never have I ever sent a text to the wrong person','Never have I ever pretended to be busy to avoid someone','Never have I ever lied about my age','Never have I ever stalked someone\'s social media for hours','Never have I ever faked being sick to skip work/school','Never have I ever cheated on a test','Never have I ever ghosted someone','Never have I ever cried watching an anime'];
      await reply(ft(`🍹 *Never Have I Ever*\n\n${statements[Math.floor(Math.random()*statements.length)]}\n\n_Drink if you have! 🤭_`, sock));
      break;
    }
    case 'wouldyourather2': {
      const questions = [['Have unlimited money but no friends','Have amazing friends but no money'],['Be able to fly','Be able to become invisible'],['Know how you die','Know when you die'],['Live in the past','Live in the future'],['Be famous but hated','Unknown but loved'],['Never use social media again','Never watch TV/Netflix again']];
      const q2 = questions[Math.floor(Math.random()*questions.length)];
      await reply(ft(`🤔 *Would You Rather*\n\nA: ${q2[0]}\n\nOR\n\nB: ${q2[1]}\n\nReply A or B!`, sock));
      break;
    }
    case 'personatest': {
      const personas = ['You are a chaotic thinker who thrives on creativity and hates routine.','You are a quiet observer who sees things others miss.','You are a social butterfly who lights up every room.','You are a strategic planner who always thinks 10 steps ahead.','You are a dreamer who lives between reality and imagination.','You are a natural leader who people gravitate toward.'];
      await reply(ft(`🌟 *Persona Reading*\n\n${personas[Math.floor(Math.random()*personas.length)]}`, sock));
      break;
    }
    case 'quiz': {
      const q3 = TRIVIA_Q[Math.floor(Math.random()*TRIVIA_Q.length)];
      await reply(ft(`📝 *Quick Quiz*\n\n${q3.q}\n\n${q3.opts.map((o,i)=>`${String.fromCharCode(65+i)}. ${o}`).join('\n')}`, sock));
      break;
    }
    case 'rank': {
      if (!data.xp) data.xp = {};
      const u  = data.xp[sender] || { xp:0, level:1 };
      const progress = Math.floor((u.xp / (u.level*100)) * 10);
      const bar2 = '█'.repeat(progress) + '░'.repeat(10-progress);
      await reply(ft(`⭐ *Your Rank*\n\n🏆 Level: ${u.level}\n📊 XP: ${u.xp}/${u.level*100}\n${bar2}`, sock));
      break;
    }
    case 'xp': {
      if (!data.xp) data.xp = {};
      if (!data.xp[sender]) data.xp[sender] = { xp:0, level:1 };
      data.xp[sender].xp += 10;
      if (data.xp[sender].xp >= data.xp[sender].level*100) {
        data.xp[sender].level++;
        data.xp[sender].xp = 0;
        save(data);
        await reply(ft(`🎉 *Level Up!* You are now Level ${data.xp[sender].level}!`, sock));
      } else {
        save(data);
        await reply(ft(`+10 XP! Total: ${data.xp[sender].xp}/${data.xp[sender].level*100}`, sock));
      }
      break;
    }
    default: return false;
  }
  return true;
}

module.exports = { gamesHandler };
