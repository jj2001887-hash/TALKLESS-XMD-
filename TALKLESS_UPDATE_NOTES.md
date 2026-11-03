# TALKLESS ULTRA update

## Added and fixed

- Added owner commands `.autotyping on|off` and `.autoreact on|off`, persisted per paired WhatsApp number.
- Auto-typing sends WhatsApp composing presence while processing incoming messages.
- Auto-react sends a random emoji reaction to new non-status, non-self messages.
- Reworked `.ping`, `.alive`, and `.uptime` replies with consistent TALKLESS styling and developer attribution.
- Added reliable `.botinfo`, `.help`, `.quote`, and `.fact` commands. `.joke` was already present and remains available.
- Restored the command registries for admin, AI, Arabic, economy, games, illusion, music, scraps, social, sticker, tools, reactions, and developer handlers; this prevents dispatch-time `ReferenceError`s.
- Improved group admin command guards for promote/demote and kept group-only/admin/bot-admin checks in place.
- Fixed sticker/media handler imports to use the installed `blacklord-baileys` package.
- Anti-delete now supports both `messages.delete` and Baileys `messages.update` revoke events, recovers text/media from the message store, and sends recovery only to the configured private owner WhatsApp DM.
- Removed embedded credentials from `settings.js` and `.env.example`; configure them through `.env`.

## Configuration

Set `ANTIDELETE_OWNER` (and `SUDO_NUMBER` if desired) in `.env` to the private WhatsApp number that should receive recoveries. The bot must be a WhatsApp session with access to that private chat.

Run:

```bash
npm install
npm start
```
