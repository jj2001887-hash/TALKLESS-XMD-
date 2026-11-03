// admin.js – 30+ Extended Admin Commands
'use strict';
const ADMIN_CMDS = [
  'setrulesimg','clearrules','setrules','rules',
  'pinmsg','unpinmsg','allmsg','delmsg',
  'mutetime','unmuteall','banlist','unbanall',
  'setjoinmsg','setleavemsg','togglewelcome','togglegoodbye',
  'setnsfw','antinsfw','antiforward','antifake',
  'autopin','autoreact','autoreply','setautoreply',
  'kickinactive2','warnreset','warnlimit','setwarnlimit',
  'groupstat','reportadmin','requestrole','voteban',
  'addbot','removebot','listbots',
];

async function adminHandler(sock, m, cmd, args, helpers) {
  if (!ADMIN_CMDS.includes(cmd)) return false;
  const { reply, ft, cfg, reaction } = helpers;
  const jid    = m.key.remoteJid;
  const prefix = cfg(sock).prefix || '.';
  const text   = args.join(' ');
  const isGrp  = jid.endsWith('@g.us');

  if (!isGrp) { await reply(`❌ This command is for groups only.`); return true; }

  switch (cmd) {
    case 'rules': {
      const rules = cfg(sock).groupRules?.[jid];
      if (!rules) { await reply(ft(`📋 No rules set.\nAdmin: *${prefix}setrules <rules>*`, sock)); break; }
      await reply(ft(`📋 *Group Rules*\n\n${rules}`, sock));
      break;
    }
    case 'setrules': {
      if (!text) { await reply(`📋 *${prefix}setrules <your rules>*`); break; }
      const config = cfg(sock);
      if (!config.groupRules) config.groupRules = {};
      config.groupRules[jid] = text;
      await reply(ft(`✅ Group rules set!`, sock));
      break;
    }
    
    case 'groupstat': {
      try {
        const meta  = await sock.groupMetadata(jid);
        const total = meta.participants?.length || 0;
        const admins2= meta.participants?.filter(p=>p.admin).length || 0;
        const bots2  = meta.participants?.filter(p=>p.id?.includes('bot')).length || 0;
        await reply(ft(
          `📊 *Group Stats*\n\n` +
          `👥 Members: ${total}\n` +
          `👑 Admins: ${admins2}\n` +
          `🤖 Bots: ${bots2}\n` +
          `📅 Created: ${new Date(meta.creation*1000).toLocaleDateString()}`,
          sock
        ));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'togglewelcome': {
      const config2 = cfg(sock);
      if (!config2.groupFlags) config2.groupFlags = {};
      if (!config2.groupFlags[jid]) config2.groupFlags[jid] = {};
      config2.groupFlags[jid].welcome = !config2.groupFlags[jid].welcome;
      const state2 = config2.groupFlags[jid].welcome;
      await reply(ft(`👋 Welcome messages: *${state2?'ON ✅':'OFF ❌'}*`, sock));
      break;
    }
    case 'togglegoodbye': {
      const config3 = cfg(sock);
      if (!config3.groupFlags) config3.groupFlags = {};
      if (!config3.groupFlags[jid]) config3.groupFlags[jid] = {};
      config3.groupFlags[jid].goodbye = !config3.groupFlags[jid].goodbye;
      const state3 = config3.groupFlags[jid].goodbye;
      await reply(ft(`👋 Goodbye messages: *${state3?'ON ✅':'OFF ❌'}*`, sock));
      break;
    }
    case 'antiforward': {
      const config4 = cfg(sock);
      if (!config4.groupFlags) config4.groupFlags = {};
      if (!config4.groupFlags[jid]) config4.groupFlags[jid] = {};
      config4.groupFlags[jid].antiforward = !config4.groupFlags[jid].antiforward;
      await reply(ft(`📤 Anti-Forward: *${config4.groupFlags[jid].antiforward?'ON ✅':'OFF ❌'}*`, sock));
      break;
    }
    case 'warnlimit':
    case 'setwarnlimit': {
      const limit = parseInt(args[0]);
      if (!limit||limit<1) { await reply(`⚠️ *${prefix}setwarnlimit <1-10>*`); break; }
      const config5 = cfg(sock);
      if (!config5.warnLimits) config5.warnLimits = {};
      config5.warnLimits[jid] = limit;
      await reply(ft(`⚠️ Warn limit set to *${limit}* (auto-kick at ${limit} warnings)`, sock));
      break;
    }
    case 'mutetime': {
      const dur = parseInt(args[0]) || 60;
      const target = args[1]?.replace(/\D/g,'');
      if (!target) { await reply(`🔇 *${prefix}mutetime <minutes> @user*`); break; }
      try {
        await sock.groupParticipantsUpdate(jid, [target+'@s.whatsapp.net'], 'demote');
        await reply(ft(`🔇 Muted @${target} for ${dur} minutes`, sock));
        setTimeout(async ()=>{
          try { await sock.groupParticipantsUpdate(jid, [target+'@s.whatsapp.net'], 'promote'); } catch {}
        }, dur*60*1000);
      } catch(e) { await reply(`❌ ${e.message}`); }
      break;
    }
    default:
      await reply(ft(`🔧 *${prefix}${cmd}* — Admin command. Coming soon!`, sock));
      return true;
  }
  return true;
}

module.exports = { adminHandler };
