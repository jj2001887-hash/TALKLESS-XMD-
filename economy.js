// ============================================================
//   economy.js  –  Economy/Game Commands (30+)
// ============================================================
'use strict';
const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const DB_FILE = path.resolve(__dirname, 'database/economy.json');
function loadEcon() { try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); } catch { return {}; } }
function saveEcon(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d,null,2)); }
function getUser(data, id) {
  if (!data[id]) data[id] = { wallet:0, bank:0, lastDaily:0, lastWork:0, lastRob:0, inventory:[], level:1, xp:0 };
  return data[id];
}

const ECON_CMDS = [
  'balance','bal','daily','work','deposit','withdraw','transfer','rob',
  'shop','buy','inventory','sell','slots','flip','blackjack',
  'leaderboard','richlist','give','beg','crime','lottery',
  'mine','fish','hunt','plant','harvest','craft','levelup','profile',
  'bankrob','heist',
];

async function economyHandler(sock, m, cmd, args, helpers) {
  if (!ECON_CMDS.includes(cmd)) return false;
  const { reply, ft, cfg } = helpers;
  const jid    = m.key.remoteJid;
  const prefix = cfg(sock).prefix || '.';
  const sender = m.key.fromMe
    ? (sock.__waNum || '')
    : (m.key.participant || m.key.remoteJid).split('@')[0];
  const data   = loadEcon();
  const user   = getUser(data, sender);

  const CURRENCY = '💰';
  const fmt = n => n.toLocaleString();

  switch(cmd) {
    case 'balance':
    case 'bal': {
      await reply(ft(
        `${CURRENCY} *Balance*\n\n` +
        `👛 Wallet: ${fmt(user.wallet)} coins\n` +
        `🏦 Bank: ${fmt(user.bank)} coins\n` +
        `📊 Total: ${fmt(user.wallet+user.bank)} coins\n` +
        `⭐ Level: ${user.level} (${user.xp} XP)`,
        sock
      ));
      break;
    }

    case 'daily': {
      const now     = Date.now();
      const cd      = 24*60*60*1000;
      const elapsed = now - (user.lastDaily||0);
      if (elapsed < cd) {
        const left = new Date(cd-elapsed).toISOString().slice(11,19);
        await reply(ft(`⏰ Daily cooldown: *${left}* remaining`, sock)); break;
      }
      const streak = Math.min((user.streak||0)+1, 30);
      const amount = 200 + (streak-1)*50;
      user.wallet    += amount;
      user.lastDaily  = now;
      user.streak     = streak;
      saveEcon(data);
      await reply(ft(`✅ *Daily Reward!*\n\n+${fmt(amount)} coins ${streak>1?`(🔥 ${streak} day streak!)`:''}`, sock));
      break;
    }

    case 'work': {
      const cd2 = 30*60*1000;
      if (Date.now()-(user.lastWork||0) < cd2) {
        const left2 = Math.ceil((cd2-(Date.now()-user.lastWork))/60000);
        await reply(ft(`⏰ Work cooldown: *${left2} min* remaining`, sock)); break;
      }
      const jobs    = [['Programmer','wrote code',300,600],['Driver','delivered packages',150,350],['Chef','cooked meals',200,500],['Streamer','streamed games',100,800],['Miner','mined crypto',250,450]];
      const job     = jobs[Math.floor(Math.random()*jobs.length)];
      const earned  = Math.floor(Math.random()*(job[3]-job[2]))+job[2];
      user.wallet    += earned;
      user.lastWork   = Date.now();
      user.xp        += 10;
      if (user.xp >= user.level*100) { user.level++; user.xp=0; }
      saveEcon(data);
      await reply(ft(`💼 *Work Done!*\nYou ${job[1]} as a ${job[0]}.\n+${fmt(earned)} coins earned!`, sock));
      break;
    }

    case 'deposit': {
      const amt = parseInt(args[0]);
      if (!amt || amt<=0) { await reply(`${CURRENCY} *${prefix}deposit <amount>*`); break; }
      if (amt>user.wallet) { await reply(`❌ Not enough in wallet (${fmt(user.wallet)} coins)`); break; }
      user.wallet -= amt; user.bank += amt; saveEcon(data);
      await reply(ft(`🏦 Deposited ${fmt(amt)} coins → Bank`, sock));
      break;
    }

    case 'withdraw': {
      const amt2 = parseInt(args[0]);
      if (!amt2||amt2<=0) { await reply(`${CURRENCY} *${prefix}withdraw <amount>*`); break; }
      if (amt2>user.bank) { await reply(`❌ Not enough in bank (${fmt(user.bank)} coins)`); break; }
      user.bank -= amt2; user.wallet += amt2; saveEcon(data);
      await reply(ft(`👛 Withdrew ${fmt(amt2)} coins → Wallet`, sock));
      break;
    }

    case 'rob': {
      const target = args[0]?.replace(/\D/g,'');
      if (!target) { await reply(`${CURRENCY} *${prefix}rob <number>*`); break; }
      const cd3 = 60*60*1000;
      if (Date.now()-(user.lastRob||0) < cd3) {
        const left3 = Math.ceil((cd3-(Date.now()-user.lastRob))/60000);
        await reply(ft(`⏰ Rob cooldown: *${left3} min*`, sock)); break;
      }
      const victim = getUser(data, target);
      if (victim.wallet < 100) { await reply('❌ Target is too broke to rob!'); break; }
      const success = Math.random() > 0.4;
      if (success) {
        const stolen = Math.floor(victim.wallet * (Math.random()*0.3+0.1));
        victim.wallet -= stolen; user.wallet += stolen;
      } else {
        const fine = Math.min(user.wallet, Math.floor(Math.random()*200+100));
        user.wallet -= fine; victim.wallet += fine;
      }
      user.lastRob = Date.now(); saveEcon(data);
      await reply(ft(success ? `🦹 Rob successful! You stole coins from ${target}!` : `👮 Rob failed! You paid a fine!`, sock));
      break;
    }

    case 'slots': {
      const bet = parseInt(args[0])||50;
      if (bet > user.wallet) { await reply(`❌ Not enough coins (wallet: ${fmt(user.wallet)})`); break; }
      const emojis = ['🍒','🍋','🍇','💎','7️⃣','⭐','🎰'];
      const reels  = [0,1,2].map(()=>emojis[Math.floor(Math.random()*emojis.length)]);
      let mult = 0;
      if (reels[0]===reels[1]&&reels[1]===reels[2]) {
        mult = reels[0]==='7️⃣' ? 10 : reels[0]==='💎' ? 7 : 4;
      } else if (reels[0]===reels[1]||reels[1]===reels[2]||reels[0]===reels[2]) {
        mult = 1.5;
      }
      user.wallet -= bet;
      const win = Math.floor(bet*mult);
      if (win) user.wallet += win;
      saveEcon(data);
      await reply(ft(
        `🎰 *SLOTS*\n\n[ ${reels.join(' | ')} ]\n\n` +
        (mult>0 ? `🎉 WIN! +${fmt(win)} coins (${mult}x)` : `❌ Lost ${fmt(bet)} coins`),
        sock
      ));
      break;
    }

    case 'flip': {
      const bet2 = parseInt(args[0])||50;
      const side = (args[1]||'heads').toLowerCase();
      if (!['heads','tails'].includes(side)) { await reply(`${CURRENCY} *${prefix}flip <amount> heads/tails*`); break; }
      if (bet2>user.wallet) { await reply(`❌ Not enough coins`); break; }
      const result2 = Math.random()>0.5?'heads':'tails';
      user.wallet -= bet2;
      if (result2===side) user.wallet += bet2*2;
      saveEcon(data);
      await reply(ft(`🪙 Coin: *${result2}*\n\n${result2===side?`✅ +${fmt(bet2)} coins!`:`❌ -${fmt(bet2)} coins!`}`, sock));
      break;
    }

    case 'leaderboard':
    case 'richlist': {
      const sorted = Object.entries(data)
        .map(([id,u])=>({id,total:(u.wallet||0)+(u.bank||0)}))
        .sort((a,b)=>b.total-a.total).slice(0,10);
      const list   = sorted.map((u,i)=>`${i+1}. +${u.id}: ${fmt(u.total)} coins`).join('\n');
      await reply(ft(`🏆 *Richlist*\n\n${list||'No data yet'}`, sock));
      break;
    }

    case 'give': {
      const target2 = args[0]?.replace(/\D/g,'');
      const amt3    = parseInt(args[1]);
      if (!target2||!amt3) { await reply(`${CURRENCY} *${prefix}give <number> <amount>*`); break; }
      if (amt3>user.wallet) { await reply(`❌ Not enough coins`); break; }
      const recv = getUser(data, target2);
      user.wallet -= amt3; recv.wallet += amt3; saveEcon(data);
      await reply(ft(`💸 Sent ${fmt(amt3)} coins to +${target2}!`, sock));
      break;
    }

    case 'beg': {
      const amounts = [0,0,0,10,25,50,100,200,500];
      const got     = amounts[Math.floor(Math.random()*amounts.length)];
      user.wallet  += got; saveEcon(data);
      const msgs    = ['Nobody gave you anything 😔','A stranger threw you some coins 🪙','Someone felt sorry for you 😅','Lucky day! You found coins on the ground 💰'];
      await reply(ft(`🙏 ${msgs[Math.floor(Math.random()*msgs.length)]}${got>0?`\n+${got} coins`:''}`, sock));
      break;
    }

    case 'crime': {
      const cd4  = 45*60*1000;
      if (Date.now()-(user.lastCrime||0) < cd4) {
        const left4 = Math.ceil((cd4-(Date.now()-user.lastCrime||0))/60000);
        await reply(ft(`⏰ Crime cooldown: *${left4} min*`, sock)); break;
      }
      const crimes2 = ['robbed a store','pickpocketed a tourist','hacked an ATM','sold counterfeit goods','ran a scam'];
      const success2 = Math.random() > 0.35;
      if (success2) {
        const earn = Math.floor(Math.random()*600+200);
        user.wallet += earn;
      } else {
        const fine2 = Math.floor(Math.random()*300+100);
        user.wallet = Math.max(0, user.wallet-fine2);
      }
      user.lastCrime = Date.now(); saveEcon(data);
      await reply(ft(success2?`🦹 Crime success! You ${crimes2[Math.floor(Math.random()*crimes2.length)]}!`:`👮 Caught! You paid a fine!`, sock));
      break;
    }

    case 'profile': {
      await reply(ft(
        `👤 *Profile: +${sender}*\n\n` +
        `💰 Wallet: ${fmt(user.wallet)}\n` +
        `🏦 Bank: ${fmt(user.bank)}\n` +
        `⭐ Level: ${user.level}\n` +
        `📊 XP: ${user.xp}/${user.level*100}\n` +
        `🔥 Streak: ${user.streak||0} days\n` +
        `🎒 Items: ${(user.inventory||[]).length}`,
        sock
      ));
      break;
    }

    case 'mine':
    case 'fish':
    case 'hunt': {
      const cd5 = 20*60*1000;
      const key  = `last${cmd.charAt(0).toUpperCase()+cmd.slice(1)}`;
      if (Date.now()-(user[key]||0) < cd5) {
        const left5 = Math.ceil((cd5-(Date.now()-user[key]||0))/60000);
        await reply(ft(`⏰ ${cmd} cooldown: *${left5} min*`, sock)); break;
      }
      const loot = { mine:['🪨 Stone','⛏️ Iron','💎 Diamond'], fish:['🐟 Small Fish','🐠 Tropical Fish','🐡 Pufferfish'], hunt:['🐰 Rabbit','🦌 Deer','🐗 Boar'] };
      const item = loot[cmd][Math.floor(Math.random()*3)];
      const val  = { '🪨 Stone':10,'⛏️ Iron':50,'💎 Diamond':500,'🐟 Small Fish':30,'🐠 Tropical Fish':80,'🐡 Pufferfish':200,'🐰 Rabbit':40,'🦌 Deer':150,'🐗 Boar':300 };
      user[key] = Date.now();
      if (!user.inventory) user.inventory = [];
      user.inventory.push(item); saveEcon(data);
      await reply(ft(`${cmd==='mine'?'⛏️':cmd==='fish'?'🎣':'🏹'} You got: *${item}* (worth ~${val[item]||50} coins)\nSell with *${prefix}sell ${item}*`, sock));
      break;
    }

    case 'inventory': {
      if (!user.inventory?.length) { await reply(`🎒 Inventory empty. Try *${prefix}mine*, *${prefix}fish*, or *${prefix}hunt*`); break; }
      const counts = {};
      user.inventory.forEach(i => { counts[i] = (counts[i]||0)+1; });
      await reply(ft(`🎒 *Inventory*\n\n${Object.entries(counts).map(([k,v])=>`${k} x${v}`).join('\n')}`, sock));
      break;
    }

    case 'sell': {
      const item2 = args.join(' ');
      if (!item2) { await reply(`💰 *${prefix}sell <item name>*\nSell items from your inventory.`); break; }
      const idx2 = user.inventory?.findIndex(i => i.toLowerCase().includes(item2.toLowerCase()));
      if (idx2 === -1 || idx2 === undefined) { await reply(`❌ Item not found in inventory.`); break; }
      const prices = { Stone:10,Iron:50,Diamond:500,'Small Fish':30,'Tropical Fish':80,'Pufferfish':200,Rabbit:40,Deer:150,Boar:300 };
      const name3  = user.inventory[idx2];
      const price  = Object.entries(prices).find(([k])=>name3.includes(k))?.[1] || 20;
      user.inventory.splice(idx2,1);
      user.wallet += price; saveEcon(data);
      await reply(ft(`💰 Sold *${name3}* for ${fmt(price)} coins!`, sock));
      break;
    }

    case 'lottery': {
      const ticket = 100;
      if (user.wallet < ticket) { await reply(`❌ Need ${ticket} coins for a lottery ticket.`); break; }
      user.wallet -= ticket;
      const win2 = Math.random() < 0.05;
      if (win2) { const prize = 5000+Math.floor(Math.random()*10000); user.wallet += prize; await reply(ft(`🎊 *LOTTERY JACKPOT!* You won ${fmt(prize)} coins! 🎉`, sock)); }
      else { await reply(ft(`🎟️ No luck this time. Better luck next draw!`, sock)); }
      saveEcon(data);
      break;
    }

    default: return false;
  }
  return true;
}

module.exports = { economyHandler };
