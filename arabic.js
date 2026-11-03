// arabic.js – Arabic Language Commands
'use strict';
const axios = require('axios');
const ARABIC_CMDS = ['arabicquote','arabicname','tafsir','hadith','dua','quran','prayer','qibla','hijri','islamicfact','asmaullah','nasheeds','arabicpoem','arabicproverb','arabicsticker'];

async function arabicHandler(sock, m, cmd, args, helpers) {
  if (!ARABIC_CMDS.includes(cmd)) return false;
  const { reply, ft, cfg, reaction } = helpers;
  const jid    = m.key.remoteJid;
  const prefix = cfg(sock).prefix || '.';
  const text   = args.join(' ');

  switch (cmd) {
    case 'quran': {
      const ref = text || '1:1';
      const [surah, ayah] = ref.split(':').map(Number);
      if (!surah) { await reply(`📖 *${prefix}quran <surah>:<ayah>*\nExample: ${prefix}quran 1:1`); break; }
      await reaction('📖');
      try {
        const { data } = await axios.get(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah||1}/ar.alafasy`, { timeout:10000 });
        const { data: eng } = await axios.get(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah||1}/en.asad`, { timeout:10000 });
        await reply(ft(
          `📖 *Quran ${surah}:${ayah||1}*\n\n` +
          `${data.data?.text}\n\n` +
          `_"${eng.data?.text}"_\n\n` +
          `📚 Surah: ${data.data?.surah?.englishName}`,
          sock
        ));
      } catch(e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'hadith': {
      await reaction('📜');
      try {
        const { data } = await axios.get('https://random-hadith-generator.vercel.app/bukhari/', { timeout:10000 });
        const h = data?.data;
        await reply(ft(`📜 *Hadith*\n\n_"${h?.hadith_english||'N/A'}"_\n\n📚 ${h?.refno||''}`, sock));
      } catch { await reply(ft('📜 *Hadith*\n\n_"The best of people are those who are most beneficial to people."_\n\n📚 Bukhari', sock)); }
      break;
    }
    case 'prayer': {
      if (!text) { await reply(`🕌 *${prefix}prayer <city>*\nExample: ${prefix}prayer Nairobi`); break; }
      await reaction('🕌');
      try {
        const { data } = await axios.get(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(text)}&country=&method=2`, { timeout:10000 });
        const t = data?.data?.timings;
        await reply(ft(
          `🕌 *Prayer Times: ${text}*\n\n` +
          `🌅 Fajr: ${t?.Fajr}\n` +
          `☀️ Dhuhr: ${t?.Dhuhr}\n` +
          `🌤️ Asr: ${t?.Asr}\n` +
          `🌆 Maghrib: ${t?.Maghrib}\n` +
          `🌙 Isha: ${t?.Isha}`,
          sock
        ));
      } catch(e) { await reply(`❌ ${e.message}`); }
      break;
    }
    case 'dua': {
      await reaction('🤲');
      const duas = ['رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ\n\n_"Our Lord, give us good in this world and good in the Hereafter, and protect us from the punishment of the Fire"_','اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْمًا نَافِعًا\n\n_"O Allah, I ask You for beneficial knowledge"_','رَبِّ اشْرَحْ لِي صَدْرِي\n\n_"My Lord, expand for me my chest [with assurance]"_ (20:25)'];
      await reply(ft(`🤲 *Daily Dua*\n\n${duas[Math.floor(Math.random()*duas.length)]}`, sock));
      break;
    }
    case 'islamicfact': {
      const facts2 = ['Islam is the fastest growing religion in the world.','The Quran has 114 surahs (chapters).','Masjid al-Haram in Mecca is the largest mosque in the world.','Friday (Jumu\'ah) is considered the holiest day of the week in Islam.','The word "Islam" means peace and submission.','Zamzam water has been flowing for thousands of years.'];
      await reply(ft(`🌙 *Islamic Fact*\n\n${facts2[Math.floor(Math.random()*facts2.length)]}`, sock));
      break;
    }
    case 'hijri': {
      const today = new Date();
      try {
        const { data } = await axios.get(`https://api.aladhan.com/v1/gToH/${today.getDate()}-${today.getMonth()+1}-${today.getFullYear()}`, { timeout:8000 });
        const h2 = data?.data?.hijri;
        await reply(ft(`📅 *Hijri Date*\n\n${h2?.day} ${h2?.month?.en} ${h2?.year} AH\n\n_${h2?.day} ${h2?.month?.ar} ${h2?.year} هـ_`, sock));
      } catch { await reply(`❌ Failed to get Hijri date`); }
      break;
    }
    case 'arabicquote': {
      const quotes2 = ['الصبر مفتاح الفرج\n_Patience is the key to relief_','من جد وجد\n_Whoever works hard will find_','العلم نور\n_Knowledge is light_','لا يأس مع الحياة\n_There is no despair while there is life_'];
      await reply(ft(`💎 *Arabic Quote*\n\n${quotes2[Math.floor(Math.random()*quotes2.length)]}`, sock));
      break;
    }
    case 'arabicproverb': {
      const proverbs = ['"اضرب حديدا وهو ساخن" – Strike while the iron is hot','درهم وقاية خير من قنطار علاج – Prevention is better than cure','الجار قبل الدار – Choose your neighbor before your house','العين بصيرة والأيدي قصيرة – Eyes see far but hands reach little'];
      await reply(ft(`🌹 *Arabic Proverb*\n\n${proverbs[Math.floor(Math.random()*proverbs.length)]}`, sock));
      break;
    }
    default: await reply(ft(`🌙 *${prefix}${cmd}* — Coming soon!`, sock)); return true;
  }
  return true;
}

module.exports = { arabicHandler };
