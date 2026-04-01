/* ================================================================
   GFIG Discord Bot — Server Management API
   ================================================================
   Environment variables required:
     BOT_TOKEN    — Discord bot token (from Developer Portal)
     GUILD_ID     — Your Discord server ID
     ADMIN_SECRET — Shared secret used by the GFIG admin panel
     PORT         — (optional) Port to listen on, default 3000

   Deployment: Railway, Render, or Replit (all have free tiers)
   ================================================================ */

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const express = require('express');
const cors    = require('cors');

const BOT_TOKEN    = process.env.BOT_TOKEN    || '';
const GUILD_ID     = process.env.GUILD_ID     || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const PORT         = parseInt(process.env.PORT || '3000', 10);

if (!BOT_TOKEN)    { console.error('ERROR: BOT_TOKEN env var is required'); process.exit(1); }
if (!GUILD_ID)     { console.error('ERROR: GUILD_ID env var is required');  process.exit(1); }
if (!ADMIN_SECRET) { console.warn('WARN: ADMIN_SECRET not set — API is unprotected!'); }

/* ── Discord Client ─────────────────────────────────────────── */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // Privileged — enable in Developer Portal
    GatewayIntentBits.GuildMessages
  ]
});

/* ── Express Server ─────────────────────────────────────────── */

const app = express();
app.use(cors());
app.use(express.json());

/* Auth middleware */
function auth(req, res, next) {
  if (!ADMIN_SECRET) return next();   // no secret = open (dev only)
  const provided = req.headers['x-admin-secret'] || req.query.secret;
  if (provided !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

/* Helper: get guild or error */
function getGuild(res) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    res && res.status(404).json({ error: 'Guild not found. Ensure the bot is in your server and GUILD_ID is correct.' });
    return null;
  }
  return guild;
}

/* ── Health / Connection Check ─────────────────────────────── */

app.get('/health', (req, res) => {
  const guild = client.guilds.cache.get(GUILD_ID);
  res.json({
    ok:          true,
    botOnline:   client.isReady(),
    botTag:      client.user?.tag || null,
    guildName:   guild?.name    || null,
    guildId:     guild?.id      || null,
    memberCount: guild?.memberCount || 0
  });
});

/* ── Server Info ────────────────────────────────────────────── */

app.get('/server-info', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const g = await guild.fetch();
    res.json({
      id:           g.id,
      name:         g.name,
      memberCount:  g.memberCount,
      iconURL:      g.iconURL({ size: 128 }) || null,
      description:  g.description,
      boostCount:   g.premiumSubscriptionCount || 0,
      premiumTier:  g.premiumTier
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Roles ──────────────────────────────────────────────────── */

app.get('/roles', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    await guild.roles.fetch();
    const roles = [...guild.roles.cache.values()]
      .filter(r => r.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map(r => ({
        id:          r.id,
        name:        r.name,
        color:       r.hexColor === '#000000' ? '#555555' : r.hexColor,
        position:    r.position,
        hoist:       r.hoist,
        mentionable: r.mentionable,
        managed:     r.managed,
        memberCount: r.members.size
      }));
    res.json(roles);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/roles', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const { name, color, hoist, mentionable } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const role = await guild.roles.create({
      name,
      color:       color || '#99AAB5',
      hoist:       !!hoist,
      mentionable: !!mentionable,
      reason:      'Created via GFIG Admin Panel'
    });
    res.status(201).json({ id: role.id, name: role.name, color: role.hexColor });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/roles/:id', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const role = guild.roles.cache.get(req.params.id);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.managed) return res.status(400).json({ error: 'Cannot delete a managed role' });
    await role.delete('Deleted via GFIG Admin Panel');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Channels ───────────────────────────────────────────────── */

app.get('/channels', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    await guild.channels.fetch();
    const channels = [...guild.channels.cache.values()]
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map(c => ({
        id:         c.id,
        name:       c.name,
        type:       c.type,
        parentId:   c.parentId   || null,
        parentName: c.parent?.name || null,
        position:   c.position   || 0,
        topic:      c.topic      || null
      }));
    res.json(channels);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/channels', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const { name, type, parentId, topic } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const typeMap = {
      text:         ChannelType.GuildText,
      voice:        ChannelType.GuildVoice,
      category:     ChannelType.GuildCategory,
      announcement: ChannelType.GuildAnnouncement,
      stage:        ChannelType.GuildStageVoice,
      forum:        ChannelType.GuildForum
    };

    const opts = {
      name,
      type:   typeMap[type] ?? ChannelType.GuildText,
      reason: 'Created via GFIG Admin Panel'
    };
    if (parentId) opts.parent = parentId;
    if (topic)    opts.topic  = topic;

    const ch = await guild.channels.create(opts);
    res.status(201).json({ id: ch.id, name: ch.name, type: ch.type });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/channels/:id', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const ch = guild.channels.cache.get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Channel not found' });
    await ch.delete('Deleted via GFIG Admin Panel');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Messages ───────────────────────────────────────────────── */

app.post('/messages', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const { channelId, content, embeds } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const ch = guild.channels.cache.get(channelId);
    if (!ch || !ch.isTextBased()) return res.status(404).json({ error: 'Text channel not found or bot lacks access' });

    const payload = {};
    if (content && content.trim()) payload.content = content;
    if (embeds && embeds.length)   payload.embeds  = embeds;
    if (!payload.content && !payload.embeds) return res.status(400).json({ error: 'content or embeds required' });

    const msg = await ch.send(payload);
    res.json({ messageId: msg.id, channelId: ch.id, channelName: ch.name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Full GFIG Server Setup ─────────────────────────────────── */

const GFIG_ROLES = [
  { name: 'Director',          color: '#FF6A00', hoist: true,  permissions: '8' },
  { name: 'Chief Inspector',   color: '#FF6A00', hoist: true  },
  { name: 'Senior Inspector',  color: '#40AAFF', hoist: true  },
  { name: 'Inspector',         color: '#00E676', hoist: true  },
  { name: 'Junior Inspector',  color: '#FFD700', hoist: true  },
  { name: 'Trainee Inspector', color: '#AAAAAA', hoist: true  },
  { name: 'GFIG Bot',          color: '#5865F2', hoist: false },
  { name: 'Member',            color: '#777777', hoist: false }
];

const GFIG_CHANNELS = [
  { name: '📋 information',        type: 'category' },
  { name: '👋 welcome',            type: 'text',         cat: '📋 information',  topic: 'Welcome to GFIG Virtual. Read the rules before proceeding.' },
  { name: '📜 rules',              type: 'text',         cat: '📋 information',  topic: 'Server rules and code of conduct.' },
  { name: '📣 announcements',      type: 'announcement', cat: '📋 information',  topic: 'Official GFIG announcements — all members follow this channel.' },
  { name: '⚠-notams',             type: 'announcement', cat: '📋 information',  topic: 'Active NOTAMs and flight inspection advisories from the GFIG portal.' },
  { name: '✈ operations',          type: 'category' },
  { name: '📋 mission-briefings',  type: 'text',         cat: '✈ operations',    topic: 'Upcoming and active GFIG missions. Auto-posted from the portal.' },
  { name: '✅ completed-ops',       type: 'text',         cat: '✈ operations',    topic: 'Completed inspection reports — auto-posted when approved.' },
  { name: '📊 leaderboard',        type: 'text',         cat: '✈ operations',    topic: 'Monthly inspector rankings and point standings.' },
  { name: '💬 community',          type: 'category' },
  { name: '💬 general',            type: 'text',         cat: '💬 community',    topic: 'General chat for GFIG members.' },
  { name: '📸 screenshots',        type: 'text',         cat: '💬 community',    topic: 'Share your best cockpit and inspection screenshots.' },
  { name: '✈ fleet-spotting',      type: 'text',         cat: '💬 community',    topic: 'GFIG fleet photos and spotting.' },
  { name: '🔊 voice',              type: 'category' },
  { name: 'Operations Briefing',   type: 'voice',        cat: '🔊 voice' },
  { name: 'General Voice',         type: 'voice',        cat: '🔊 voice' },
  { name: 'ATC Practice',          type: 'voice',        cat: '🔊 voice' },
  { name: '🔒 staff',              type: 'category' },
  { name: '📋 admin-chat',         type: 'text',         cat: '🔒 staff',        topic: 'Staff-only coordination.' },
  { name: '🤖 bot-commands',       type: 'text',         cat: '🔒 staff',        topic: 'Bot command testing.' }
];

app.post('/setup', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const log = [];

    /* ① Roles */
    for (const r of GFIG_ROLES) {
      try {
        const existing = guild.roles.cache.find(x => x.name === r.name);
        if (existing) { log.push('skip:Role already exists: ' + r.name); continue; }
        await guild.roles.create({
          name:  r.name, color: r.color || '#99AAB5',
          hoist: !!r.hoist, reason: 'GFIG Setup'
        });
        log.push('ok:Created role: ' + r.name);
      } catch(e) { log.push('err:Failed role ' + r.name + ': ' + e.message); }
    }

    /* ② Channels & Categories */
    // Re-fetch so categories are in cache after creation
    await guild.channels.fetch();
    const catMap = {};

    for (const c of GFIG_CHANNELS) {
      try {
        const existing = guild.channels.cache.find(x => x.name === c.name);
        if (existing) {
          if (c.type === 'category') catMap[c.name] = existing.id;
          log.push('skip:Channel already exists: ' + c.name);
          continue;
        }
        const typeMap = {
          text: ChannelType.GuildText, voice: ChannelType.GuildVoice,
          category: ChannelType.GuildCategory, announcement: ChannelType.GuildAnnouncement
        };
        const opts = {
          name:   c.name,
          type:   typeMap[c.type] ?? ChannelType.GuildText,
          reason: 'GFIG Setup'
        };
        if (c.cat && catMap[c.cat]) opts.parent = catMap[c.cat];
        if (c.topic) opts.topic = c.topic;

        const ch = await guild.channels.create(opts);
        if (c.type === 'category') catMap[c.name] = ch.id;
        log.push('ok:Created channel: ' + c.name);
      } catch(e) { log.push('err:Failed channel ' + c.name + ': ' + e.message); }
    }

    res.json({ ok: true, log });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Get members list ───────────────────────────────────────── */

app.get('/members', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    await guild.members.fetch({ limit: 100 });
    const members = [...guild.members.cache.values()].map(m => ({
      id:          m.id,
      username:    m.user.username,
      displayName: m.displayName,
      joinedAt:    m.joinedAt,
      roles:       [...m.roles.cache.values()].filter(r => r.name !== '@everyone').map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
      bot:         m.user.bot
    })).filter(m => !m.bot);
    res.json(members);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Assign role to member ──────────────────────────────────── */

app.post('/members/:memberId/roles/:roleId', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const member = guild.members.cache.get(req.params.memberId)
      || await guild.members.fetch(req.params.memberId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    await member.roles.add(req.params.roleId, 'Assigned via GFIG Admin Panel');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/members/:memberId/roles/:roleId', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const member = guild.members.cache.get(req.params.memberId)
      || await guild.members.fetch(req.params.memberId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    await member.roles.remove(req.params.roleId, 'Removed via GFIG Admin Panel');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Bot Events ─────────────────────────────────────────────── */

client.once('ready', () => {
  console.log(`✅ GFIG Bot online as ${client.user.tag}`);
  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    console.log(`   Managing: "${guild.name}" (${guild.memberCount} members)`);
  } else {
    console.warn(`   ⚠ Guild ${GUILD_ID} not found — ensure the bot is added to your server`);
  }
  client.user.setPresence({ status: 'online', activities: [{ name: 'GFIG Operations', type: 3 }] });
});

client.on('error', e => console.error('Discord error:', e.message));

/* ── Start ──────────────────────────────────────────────────── */

async function start() {
  app.listen(PORT, () => {
    console.log(`🚀 GFIG Bot API listening on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
  });
  await client.login(BOT_TOKEN);
}

start().catch(e => { console.error('Startup failure:', e); process.exit(1); });
