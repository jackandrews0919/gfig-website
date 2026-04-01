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

const { Client, GatewayIntentBits, ChannelType, AuditLogEvent, Events, PermissionsBitField } = require('discord.js');
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
    GatewayIntentBits.GuildMembers,       // Privileged — enable in Developer Portal
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,     // Privileged — enable in Developer Portal
    GatewayIntentBits.GuildModeration
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
  // ── Display ranks (hoisted, shown in sidebar) ──
  { name: 'Director',            color: '#FF6A00', hoist: true,  permissions: '8' },
  { name: 'Chief Inspector',     color: '#FF6A00', hoist: true  },
  { name: 'Senior Inspector',    color: '#40AAFF', hoist: true  },
  { name: 'Inspector',           color: '#00E676', hoist: true  },
  { name: 'Junior Inspector',    color: '#FFD700', hoist: true  },
  { name: 'Trainee Inspector',   color: '#AAAAAA', hoist: true  },
  // ── Staff tags (hoisted) ──
  { name: 'Flight Examiner',     color: '#E040FB', hoist: true  },
  { name: 'Training Officer',    color: '#FF80AB', hoist: true  },
  { name: 'HR Officer',          color: '#29B6F6', hoist: true  },
  // ── Specialty tags (not hoisted — not displayed separately) ──
  { name: 'Fleet Manager',       color: '#18FFFF', hoist: false },
  { name: 'Drone Operator',      color: '#76FF03', hoist: false },
  { name: 'Helicopter Pilot',    color: '#FFAB40', hoist: false },
  { name: 'VATSIM Controller',   color: '#26A69A', hoist: false },
  // ── Status tags ──
  { name: 'On LOA',              color: '#F44336', hoist: true  },
  { name: 'Applicant',           color: '#E67E22', hoist: true  },
  { name: 'Guest',               color: '#95A5A6', hoist: false },
  { name: 'Suspended',           color: '#555555', hoist: false },
  // ── Base tags (bottom, not displayed separately) ──
  { name: 'Member',              color: '#2ECC71', hoist: false },
  { name: 'GFIG Bot',            color: '#5865F2', hoist: false },
];

/* ── Permission Profiles (applied to categories, inherited by child channels) ── */
const P = PermissionsBitField.Flags;
const PERM_PROFILES = {
  info: [
    { role: '@everyone', deny:  [P.ViewChannel] },
    { role: 'Guest',     allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.AddReactions] },
    { role: 'Applicant', allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.AddReactions] },
    { role: 'On LOA',    allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] },
    { role: 'Member',    allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] }
  ],
  ops: [
    { role: '@everyone', deny:  [P.ViewChannel] },
    { role: 'Member',    allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AddReactions, P.AttachFiles] }
  ],
  ops_readonly: [
    { role: '@everyone', deny:  [P.ViewChannel] },
    { role: 'Member',    allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions], deny: [P.SendMessages, P.AttachFiles] },
    { role: 'Director',         allow: [P.SendMessages, P.AttachFiles] },
    { role: 'Chief Inspector',  allow: [P.SendMessages, P.AttachFiles] }
  ],
  instructor: [
    { role: '@everyone',        deny:  [P.ViewChannel] },
    { role: 'Director',         allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages] },
    { role: 'Chief Inspector',  allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
    { role: 'Senior Inspector', allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
    { role: 'Flight Examiner',  allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
    { role: 'Training Officer', allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] }
  ],
  training: [
    { role: '@everyone', deny:  [P.ViewChannel] },
    { role: 'Member',    allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions], deny: [P.SendMessages] },
    { role: 'Director',         allow: [P.SendMessages, P.AttachFiles] },
    { role: 'Chief Inspector',  allow: [P.SendMessages, P.AttachFiles] },
    { role: 'Flight Examiner',  allow: [P.SendMessages, P.AttachFiles] },
    { role: 'Training Officer', allow: [P.SendMessages, P.AttachFiles] }
  ],
  community: [
    { role: '@everyone', deny:  [P.ViewChannel] },
    { role: 'Guest',     allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.AddReactions] },
    { role: 'Applicant', allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.AddReactions] },
    { role: 'On LOA',    allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AddReactions, P.AttachFiles] },
    { role: 'Member',    allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AddReactions, P.AttachFiles] }
  ],
  community_intro: [
    { role: 'Guest',     allow: [P.SendMessages] },
    { role: 'Applicant', allow: [P.SendMessages] }
  ],
  voice: [
    { role: '@everyone', deny:  [P.ViewChannel, P.Connect] },
    { role: 'Member',    allow: [P.ViewChannel, P.Connect, P.Speak] },
    { role: 'On LOA',    allow: [P.ViewChannel, P.Connect, P.Speak] }
  ],
  staff: [
    { role: '@everyone',        deny:  [P.ViewChannel] },
    { role: 'Director',         allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages] },
    { role: 'Chief Inspector',  allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
    { role: 'Senior Inspector', allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
    { role: 'Flight Examiner',  allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
    { role: 'Training Officer', allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] }
  ]
};

const GFIG_CHANNELS = [
  /* ── INFORMATION ── */
  { name: '📋 information',              type: 'category', perms: 'info' },
  { name: '👋-welcome',                  type: 'text',         cat: '📋 information',  topic: 'Welcome to the Global Flight Inspection Group. Read the rules before proceeding.' },
  { name: '📜-rules',                    type: 'text',         cat: '📋 information',  topic: 'Server rules and code of conduct for all GFIG members.' },
  { name: '📣-announcements',            type: 'announcement', cat: '📋 information',  topic: 'Official GFIG announcements — follow this channel for updates.' },
  { name: '⚠-notams',                   type: 'announcement', cat: '📋 information',  topic: 'Active NOTAMs and flight inspection advisories from the GFIG portal.' },
  { name: '📇-staff-directory',          type: 'text',         cat: '📋 information',  topic: 'GFIG leadership, department heads, and contact information.' },

  /* ── OPERATIONS HQ ── */
  { name: '✈ operations-hq',             type: 'category', perms: 'ops' },
  { name: '📋-mission-briefings',        type: 'text',         cat: '✈ operations-hq', topic: 'Auto-posted from GFIG portal — upcoming and active inspection missions.', perms: 'ops_readonly' },
  { name: '✅-completed-ops',             type: 'text',         cat: '✈ operations-hq', topic: 'Completed inspection reports — auto-posted when approved by staff.', perms: 'ops_readonly' },
  { name: '📊-leaderboard',              type: 'text',         cat: '✈ operations-hq', topic: 'Monthly inspector rankings and point standings.', perms: 'ops_readonly' },
  { name: '🗂-flight-dispatch',           type: 'text',         cat: '✈ operations-hq', topic: 'Flight plans, route coordination, and dispatch notes.' },
  { name: '📡-operational-validation',    type: 'text',         cat: '✈ operations-hq', topic: 'Navaids, ILS, and procedure validation discussion.' },

  /* ── SPECIALIST OPERATIONS ── */
  { name: '🚁 specialist-ops',           type: 'category', perms: 'ops' },
  { name: '🚁-helicopter-aerial-media',  type: 'text',         cat: '🚁 specialist-ops', topic: 'Helicopter flight inspection and aerial media operations.' },
  { name: '🔍-surveillance-ops',         type: 'text',         cat: '🚁 specialist-ops', topic: 'Surveillance, monitoring, and observation flight operations.' },
  { name: '🇬🇧-uk-operations',           type: 'text',         cat: '🚁 specialist-ops', topic: 'UK-specific operations, airspace, and coordination.' },
  { name: '🤖-drone-inspections',        type: 'text',         cat: '🚁 specialist-ops', topic: 'UAS/drone-based inspection missions and procedures.' },
  { name: '🔧-calibration-flights',      type: 'text',         cat: '🚁 specialist-ops', topic: 'Instrument calibration and validation flight ops.' },

  /* ── FLEET & STANDARDS ── */
  { name: '🛩 fleet-standards',           type: 'category', perms: 'ops' },
  { name: '🛩-fleet-management',          type: 'text',         cat: '🛩 fleet-standards',  topic: 'Fleet status, aircraft assignments, and maintenance tracking.' },
  { name: '✈-validation-fleet',           type: 'text',         cat: '🛩 fleet-standards',  topic: 'Operational validation fleet — certified inspection aircraft only.' },
  { name: '📈-performance-tracking',      type: 'text',         cat: '🛩 fleet-standards',  topic: 'KPIs, pass rates, and operational efficiency metrics.' },
  { name: '⚠-safety-reports',            type: 'text',         cat: '🛩 fleet-standards',  topic: 'Safety occurrence reports and hazard tracking.', perms: 'ops_readonly' },

  /* ── TRAINING DEPARTMENT ── */
  { name: '🎓 training-dept',            type: 'category', perms: 'training' },
  { name: '📢-training-announcements',   type: 'announcement', cat: '🎓 training-dept', topic: 'Training schedule, new courses, and department updates.' },
  { name: '📚-course-materials',         type: 'text',         cat: '🎓 training-dept', topic: 'SOPs, manuals, study guides, and reference documents.' },
  { name: '📝-checkride-schedule',       type: 'text',         cat: '🎓 training-dept', topic: 'Upcoming skill checks and examiner availability.' },
  { name: '📊-trainee-progress',         type: 'text',         cat: '🎓 training-dept', topic: 'Trainee milestones, notes, and progress tracking.' },
  { name: '🧑‍🏫-mentor-chat',            type: 'text',         cat: '🎓 training-dept', topic: 'Private coordination between mentors and training officers.', perms: 'instructor' },

  /* ── COMMUNITY ── */
  { name: '💬 community',                type: 'category', perms: 'community' },
  { name: '👋-introductions',            type: 'text',         cat: '💬 community',    topic: 'Introduce yourself to the GFIG community!', perms: 'community_intro' },
  { name: '💬-general',                  type: 'text',         cat: '💬 community',    topic: 'General chat for GFIG members.' },
  { name: '📸-screenshots',              type: 'text',         cat: '💬 community',    topic: 'Share your best cockpit and inspection screenshots.' },
  { name: '✈-fleet-spotting',            type: 'text',         cat: '💬 community',    topic: 'Real and virtual fleet photos.' },
  { name: '🎮-off-topic',                type: 'text',         cat: '💬 community',    topic: 'Non-aviation chat — keep it friendly.' },

  /* ── VOICE ── */
  { name: '🔊 voice-channels',           type: 'category', perms: 'voice' },
  { name: 'Operations Briefing',         type: 'voice',        cat: '🔊 voice-channels' },
  { name: 'General Voice',               type: 'voice',        cat: '🔊 voice-channels' },
  { name: 'ATC Practice',                type: 'voice',        cat: '🔊 voice-channels' },
  { name: 'Training Room',               type: 'voice',        cat: '🔊 voice-channels' },
  { name: 'Specialist Ops',              type: 'voice',        cat: '🔊 voice-channels' },

  /* ── STAFF ── */
  { name: '🔒 staff',                    type: 'category', perms: 'staff' },
  { name: '🏢-director-office',          type: 'text',         cat: '🔒 staff',        topic: 'Director-level coordination and strategic planning.' },
  { name: '📋-admin-chat',               type: 'text',         cat: '🔒 staff',        topic: 'Staff-only coordination and moderation.' },
  { name: '👥-hr-management',            type: 'text',         cat: '🔒 staff',        topic: 'Member applications, promotions, and HR records.' },
  { name: '📬-applications',             type: 'text',         cat: '🔒 staff',        topic: 'Incoming applications — auto-posted from the GFIG portal.' },
  { name: '📋-loa-requests',             type: 'text',         cat: '🔒 staff',        topic: 'Leave of Absence requests — auto-posted when members submit LOA forms.' },
  { name: '🤖-bot-commands',             type: 'text',         cat: '🔒 staff',        topic: 'Bot command testing.' },
  { name: '📜-audit-log',                type: 'text',         cat: '🔒 staff',        topic: 'Auto-posted audit trail — message edits, deletes, member events.' }
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

    /* ①b Re-order & update existing role hoist flags to match GFIG_ROLES array */
    try {
      await guild.roles.fetch();
      const botMember = guild.members.me;
      const botTop = botMember ? botMember.roles.highest.position : 0;
      const positionUpdates = [];
      GFIG_ROLES.forEach((r, idx) => {
        const role = guild.roles.cache.find(x => x.name === r.name);
        if (!role || role.managed) return;
        const desiredPos = Math.max(1, botTop - 1 - idx);
        if (role.position !== desiredPos) positionUpdates.push({ role: role.id, position: desiredPos });
        if (role.hoist !== !!r.hoist) role.setHoist(!!r.hoist).catch(() => {});
      });
      if (positionUpdates.length) {
        await guild.roles.setPositions(positionUpdates);
        log.push('ok:Re-ordered ' + positionUpdates.length + ' roles');
      }
    } catch(e) { log.push('err:Role reorder: ' + e.message); }

    /* ② Channels & Categories */
    // Re-fetch so categories are in cache after creation
    await guild.channels.fetch();
    await guild.roles.fetch();
    const catMap = {};

    // Build role-name → ID map for permission overwrites
    const roleMap = {};
    guild.roles.cache.forEach(r => { roleMap[r.name] = r.id; });

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

        // Apply permission overwrites from profile
        if (c.perms && PERM_PROFILES[c.perms]) {
          opts.permissionOverwrites = PERM_PROFILES[c.perms].map(p => {
            const id = p.role === '@everyone' ? guild.id : roleMap[p.role];
            if (!id) return null;
            return { id, allow: p.allow || [], deny: p.deny || [] };
          }).filter(Boolean);
        }

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

/* ── Member Sync: Website → Discord (rank + nickname) ───────── */

app.post('/sync-member', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const { discordId, name, memberNumber, rank } = req.body;
    if (!discordId) return res.status(400).json({ error: 'discordId is required' });

    // Fetch the member
    let member;
    try { member = await guild.members.fetch(discordId); }
    catch(e) { return res.status(404).json({ error: 'Discord user not found in server. They must join the server first.' }); }

    const log = [];

    // Set nickname to "Name | GFIG-XXXX"
    if (name && memberNumber) {
      const nick = name + ' | ' + memberNumber;
      try {
        await member.setNickname(nick, 'Synced from GFIG Portal');
        log.push('ok:Nickname set to: ' + nick);
      } catch(e) { log.push('err:Cannot set nickname: ' + e.message); }
    }

    // Assign rank role (remove old rank roles first)
    if (rank) {
      const rankNames = ['Director', 'Chief Inspector', 'Senior Inspector', 'Inspector',
                         'Junior Inspector', 'Trainee Inspector', 'Flight Examiner', 'Training Officer'];
      await guild.roles.fetch();

      // Remove existing rank roles
      const currentRankRoles = [...member.roles.cache.values()]
        .filter(r => rankNames.includes(r.name));
      for (const r of currentRankRoles) {
        try { await member.roles.remove(r, 'Rank sync from GFIG Portal'); log.push('ok:Removed old role: ' + r.name); }
        catch(e) { log.push('err:Failed to remove ' + r.name); }
      }

      // Add new rank role
      const newRole = guild.roles.cache.find(r => r.name === rank);
      if (newRole) {
        try { await member.roles.add(newRole, 'Rank sync from GFIG Portal'); log.push('ok:Assigned role: ' + rank); }
        catch(e) { log.push('err:Failed to assign ' + rank + ': ' + e.message); }
      } else {
        log.push('err:Role "' + rank + '" not found — run Setup first');
      }

      // Also ensure Member role is assigned and Guest removed
      const memberRole = guild.roles.cache.find(r => r.name === 'Member');
      if (memberRole && !member.roles.cache.has(memberRole.id)) {
        try { await member.roles.add(memberRole, 'Auto-assign Member role'); }
        catch(e) { /* silent */ }
      }
      const guestRole = guild.roles.cache.find(r => r.name === 'Guest');
      if (guestRole && member.roles.cache.has(guestRole.id)) {
        try { await member.roles.remove(guestRole, 'Promoted from Guest to Member'); log.push('ok:Removed Guest role'); }
        catch(e) { /* silent */ }
      }
      const applicantRole = guild.roles.cache.find(r => r.name === 'Applicant');
      if (applicantRole && member.roles.cache.has(applicantRole.id)) {
        try { await member.roles.remove(applicantRole, 'Application approved'); log.push('ok:Removed Applicant role'); }
        catch(e) { /* silent */ }
      }
    }

    res.json({ ok: true, log, nickname: member.nickname });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Bulk Sync: Sync all linked members ─────────────────────── */

app.post('/sync-all', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const { members } = req.body; // Array of { discordId, name, memberNumber, rank }
    if (!members || !members.length) return res.status(400).json({ error: 'members array required' });

    await guild.roles.fetch();
    const rankNames = ['Director', 'Chief Inspector', 'Senior Inspector', 'Inspector',
                       'Junior Inspector', 'Trainee Inspector', 'Flight Examiner', 'Training Officer'];
    const log = [];

    for (const m of members) {
      if (!m.discordId) { log.push('skip:No Discord ID for ' + (m.name || '?')); continue; }
      try {
        const member = await guild.members.fetch(m.discordId).catch(() => null);
        if (!member) { log.push('skip:' + (m.name || m.discordId) + ' not in server'); continue; }

        // Nickname
        if (m.name && m.memberNumber) {
          const nick = m.name + ' | ' + m.memberNumber;
          try { await member.setNickname(nick, 'Bulk sync'); } catch(e) { /* silent */ }
        }

        // Roles
        if (m.rank) {
          const toRemove = [...member.roles.cache.values()].filter(r => rankNames.includes(r.name));
          for (const r of toRemove) { try { await member.roles.remove(r); } catch(e) { /* */ } }
          const newRole = guild.roles.cache.find(r => r.name === m.rank);
          if (newRole) { try { await member.roles.add(newRole); } catch(e) { /* */ } }
        }

        log.push('ok:Synced ' + (m.name || m.discordId));
      } catch(e) { log.push('err:Failed ' + (m.name || m.discordId) + ': ' + e.message); }
    }

    res.json({ ok: true, synced: log.filter(l => l.startsWith('ok:')).length, log });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── LOA Role Management ────────────────────────────────────── */

app.post('/loa', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const { discordId, action } = req.body;  // action: 'add' | 'remove'
    if (!discordId) return res.status(400).json({ error: 'discordId required' });
    if (!['add', 'remove'].includes(action)) return res.status(400).json({ error: 'action must be add or remove' });

    let member;
    try { member = await guild.members.fetch(discordId); }
    catch(e) { return res.status(404).json({ error: 'Member not found in server' }); }

    await guild.roles.fetch();
    const loaRole    = guild.roles.cache.find(r => r.name === 'On LOA');
    const memberRole = guild.roles.cache.find(r => r.name === 'Member');
    const log = [];

    if (action === 'add') {
      // Assign On LOA, remove Member (restricts access to read-only)
      if (loaRole)    { try { await member.roles.add(loaRole, 'LOA approved'); log.push('ok:Added On LOA role'); } catch(e) { log.push('err:' + e.message); } }
      if (memberRole) { try { await member.roles.remove(memberRole, 'LOA — pausing membership'); log.push('ok:Removed Member role'); } catch(e) { /* silent */ } }

      // Post notification to LOA channel
      const ch = guild.channels.cache.find(c => c.isTextBased() && c.name.includes('loa-requests'));
      if (ch) {
        ch.send({ embeds: [{ color: 0xF44336, title: '📋 Leave of Absence', description: `**${member.displayName}** has been placed on Leave of Absence.`, timestamp: new Date().toISOString() }] }).catch(() => {});
      }
    } else {
      // Remove On LOA, restore Member
      if (loaRole)    { try { await member.roles.remove(loaRole, 'LOA ended'); log.push('ok:Removed On LOA role'); } catch(e) { log.push('err:' + e.message); } }
      if (memberRole) { try { await member.roles.add(memberRole, 'LOA ended — restoring membership'); log.push('ok:Restored Member role'); } catch(e) { /* silent */ } }

      const ch = guild.channels.cache.find(c => c.isTextBased() && c.name.includes('loa-requests'));
      if (ch) {
        ch.send({ embeds: [{ color: 0x2ECC71, title: '✅ LOA Ended', description: `**${member.displayName}** has returned from Leave of Absence.`, timestamp: new Date().toISOString() }] }).catch(() => {});
      }
    }

    auditPush({ type: 'role_change', user: member.user.tag, summary: `LOA ${action === 'add' ? 'started' : 'ended'} for **${member.user.tag}**` });
    res.json({ ok: true, log });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Notify: Post form submissions to staff channels ────────── */

app.post('/notify-form', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const { type, memberName, memberNumber, details } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });

    const channelMap = {
      leave:       'loa-requests',
      resignation: 'hr-management',
      calibration: 'hr-management',
      application: 'applications'
    };
    const colorMap = { leave: 0xF44336, resignation: 0xFF5252, calibration: 0x40AAFF, application: 0xE67E22 };
    const titleMap = { leave: '📋 LOA Request', resignation: '🚪 Resignation', calibration: '🔧 Calibration Request', application: '📬 New Application' };

    const chName = channelMap[type] || 'hr-management';
    const ch = guild.channels.cache.find(c => c.isTextBased() && c.name.includes(chName));
    if (!ch) return res.json({ ok: true, posted: false, reason: 'Channel not found' });

    const fields = [];
    if (memberName)   fields.push({ name: 'Member', value: memberName, inline: true });
    if (memberNumber) fields.push({ name: 'ID', value: memberNumber, inline: true });
    if (details)      Object.entries(details).forEach(([k, v]) => { if (v) fields.push({ name: k, value: String(v).substring(0, 1024), inline: true }); });

    await ch.send({ embeds: [{
      color: colorMap[type] || 0x5865F2,
      title: titleMap[type] || '📋 Form Submission',
      fields,
      footer: { text: 'GFIG Portal' },
      timestamp: new Date().toISOString()
    }] });

    res.json({ ok: true, posted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Delete ALL channels (rebuild) ───────────────────────────── */

app.delete('/channels/all', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    await guild.channels.fetch();
    const channels = [...guild.channels.cache.values()];
    const log = [];
    // Delete non-category channels first, then categories
    const nonCats = channels.filter(c => c.type !== ChannelType.GuildCategory);
    const cats    = channels.filter(c => c.type === ChannelType.GuildCategory);
    for (const ch of [...nonCats, ...cats]) {
      try {
        await ch.delete('Purge via GFIG Admin Panel');
        log.push('ok:Deleted: ' + ch.name);
      } catch(e) { log.push('err:Failed to delete ' + ch.name + ': ' + e.message); }
    }
    res.json({ ok: true, deleted: log.filter(l => l.startsWith('ok:')).length, log });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Mission Embed (auto-post from website) ─────────────────── */

app.post('/mission-embed', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const { missionId, title, type, airport, region, date, assignedTo, status, channelName, brief } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    // Find the target channel (default: mission-briefings)
    const target = channelName || 'mission-briefings';
    await guild.channels.fetch();
    const ch = guild.channels.cache.find(c =>
      c.isTextBased() && c.name.toLowerCase().replace(/[^a-z0-9-]/g, '').includes(target.replace(/[^a-z0-9-]/g, ''))
    );
    if (!ch) return res.status(404).json({ error: 'Channel "' + target + '" not found' });

    const statusColors = { active: 0x00E676, scheduled: 0x40AAFF, completed: 0xFF6A00, cancelled: 0xFF4444 };

    /* Build main embed */
    const embed = {
      title:       '✈️ ' + title,
      color:       statusColors[(status || '').toLowerCase()] || 0x40AAFF,
      fields:      [],
      footer:      { text: 'GFIG Mission System' },
      timestamp:   new Date().toISOString()
    };
    if (type)       embed.fields.push({ name: 'Type',       value: type,       inline: true });
    if (airport)    embed.fields.push({ name: 'Airport',    value: airport,    inline: true });
    if (region)     embed.fields.push({ name: 'Region',     value: region,     inline: true });
    if (date)       embed.fields.push({ name: 'Date',       value: date,       inline: true });
    if (assignedTo) embed.fields.push({ name: 'Assigned',   value: assignedTo, inline: true });
    if (status)     embed.fields.push({ name: 'Status',     value: status,     inline: true });
    if (missionId)  embed.fields.push({ name: 'Mission ID', value: '`' + missionId + '`', inline: false });

    const embeds = [embed];

    /* If a structured brief was supplied, add a second detailed embed */
    if (brief && brief.sections && brief.sections.length) {
      const briefEmbed = {
        title:       '📋 Mission Briefing — ' + (brief.missionId || missionId || ''),
        description: brief.summary || '',
        color:       0x1a237e,
        fields:      brief.sections.map(s => ({ name: s.heading, value: s.content.substring(0, 1024), inline: false })),
        footer:      { text: 'Classification: ' + (brief.classification || 'N/A') + '  |  Issued: ' + (brief.issuedDate || '—') + '  |  Expires: ' + (brief.expiryDate || '—') }
      };
      if (brief.priority) briefEmbed.fields.unshift({ name: 'Priority', value: brief.priority, inline: true });
      if (brief.points)   briefEmbed.fields.push({ name: 'Points', value: String(brief.points), inline: true });
      if (brief.region)   briefEmbed.fields.push({ name: 'Region', value: brief.region, inline: true });
      embeds.push(briefEmbed);
    }

    const msg = await ch.send({ embeds });
    res.json({ ok: true, messageId: msg.id, channelId: ch.id, channelName: ch.name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Report Completed Embed (auto-post) ─────────────────────── */

app.post('/report-embed', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const { title, inspector, airport, result, points, date } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    await guild.channels.fetch();
    const ch = guild.channels.cache.find(c => c.isTextBased() && c.name.includes('completed'));
    if (!ch) return res.status(404).json({ error: 'completed-ops channel not found' });

    const resultColors = { pass: 0x00E676, 'minor findings': 0xFFD700, 'major findings': 0xFF6A00, fail: 0xFF4444 };
    const embed = {
      title:     '✅ Inspection Complete — ' + title,
      color:     resultColors[(result || '').toLowerCase()] || 0x00E676,
      fields:    [],
      footer:    { text: 'GFIG Report System' },
      timestamp: new Date().toISOString()
    };
    if (inspector) embed.fields.push({ name: 'Inspector', value: inspector, inline: true });
    if (airport)   embed.fields.push({ name: 'Airport',   value: airport,   inline: true });
    if (result)    embed.fields.push({ name: 'Result',    value: result,    inline: true });
    if (points)    embed.fields.push({ name: 'Points',    value: String(points), inline: true });
    if (date)      embed.fields.push({ name: 'Date',      value: date,      inline: true });

    const msg = await ch.send({ embeds: [embed] });
    res.json({ ok: true, messageId: msg.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Trainee Thread System ──────────────────────────────────── */

app.post('/trainee-thread', auth, async (req, res) => {
  try {
    const guild = getGuild(res); if (!guild) return;
    const { discordId, traineeName, courseTitle } = req.body;
    if (!traineeName) return res.status(400).json({ error: 'traineeName is required' });

    await guild.channels.fetch();
    const progressCh = guild.channels.cache.find(c => c.isTextBased() && c.name.includes('trainee-progress'));
    if (!progressCh) return res.status(404).json({ error: 'trainee-progress channel not found' });

    // Check if thread already exists for this trainee
    const threads = await progressCh.threads.fetchActive();
    const existingThread = threads.threads.find(t => t.name.includes(traineeName));
    if (existingThread) {
      // Post update to existing thread
      await existingThread.send({
        embeds: [{
          color: 0x40AAFF,
          title: '📚 Course Enrolled',
          description: `**${traineeName}** has started: **${courseTitle || 'a new course'}**`,
          timestamp: new Date().toISOString()
        }]
      });
      return res.json({ ok: true, threadId: existingThread.id, existed: true });
    }

    // Create new private thread for the trainee
    const thread = await progressCh.threads.create({
      name: '📋 ' + traineeName + ' — Training',
      type: ChannelType.PrivateThread,
      reason: 'GFIG Trainee Progress Thread'
    });

    // Add trainee to thread if discordId provided
    if (discordId) {
      try { await thread.members.add(discordId); } catch(e) { /* silent */ }
    }

    // Add instructors/training officers to the thread
    const instructorRoles = ['Training Officer', 'Flight Examiner', 'Chief Inspector', 'Director'];
    await guild.roles.fetch();
    for (const roleName of instructorRoles) {
      const role = guild.roles.cache.find(r => r.name === roleName);
      if (role) {
        for (const [, member] of role.members) {
          try { await thread.members.add(member.id); } catch(e) { /* silent */ }
        }
      }
    }

    // Post welcome message
    await thread.send({
      embeds: [{
        color: 0xFF6A00,
        title: '🎓 Training Progress — ' + traineeName,
        description: 'This thread tracks training progress for **' + traineeName + '**.\n\n'
          + '**Instructors** — post feedback, checkride results, and notes here.\n'
          + '**Trainee** — ask questions and track your progress.\n\n'
          + (courseTitle ? '📚 First course: **' + courseTitle + '**' : ''),
        footer: { text: 'GFIG Training Department' },
        timestamp: new Date().toISOString()
      }]
    });

    res.json({ ok: true, threadId: thread.id, threadName: thread.name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Audit Log System ───────────────────────────────────────── */

const AUDIT_LOG = [];       // In-memory ring buffer (last 500 entries)
const AUDIT_MAX = 500;

function auditPush(entry) {
  entry.timestamp = new Date().toISOString();
  AUDIT_LOG.push(entry);
  if (AUDIT_LOG.length > AUDIT_MAX) AUDIT_LOG.shift();
  // Also post to #audit-log channel if it exists
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    const ch = guild.channels.cache.find(c => c.isTextBased() && c.name.includes('audit-log'));
    if (!ch) return;
    const icon = { 'message_delete': '🗑️', 'message_edit': '✏️', 'channel_create': '📂+', 'channel_delete': '📂−', 'member_join': '📥', 'member_leave': '📤', 'role_change': '👑' };
    const emoji = icon[entry.type] || '📋';
    ch.send({ embeds: [{
      color: entry.type.includes('delete') || entry.type === 'member_leave' ? 0xFF4444 : entry.type.includes('edit') ? 0xFFD700 : 0x00E676,
      description: `${emoji} **${entry.type.replace(/_/g,' ').toUpperCase()}**\n${entry.summary}`,
      fields: entry.details ? [{ name: 'Details', value: entry.details.substring(0, 1024) }] : [],
      footer: { text: entry.user || 'System' },
      timestamp: entry.timestamp
    }] }).catch(() => {});
  } catch(e) { /* silent */ }
}

app.get('/audit-log', auth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), AUDIT_MAX);
  const type  = req.query.type || '';
  let entries = [...AUDIT_LOG].reverse();
  if (type) entries = entries.filter(e => e.type === type);
  res.json(entries.slice(0, limit));
});

/* ═══════════════════════════════════════════════════════════════
   REAL-WORLD NOTAM PROXY — fetches from FAA API & caches results
   ═══════════════════════════════════════════════════════════════ */

const NOTAM_CACHE = {};
const NOTAM_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Fetches NOTAMs from the FAA NOTAM API v1
 * Env: FAA_NOTAM_API_KEY (optional — falls back to public endpoint)
 */
async function fetchFAANotams(icaoList) {
  const apiKey = process.env.FAA_NOTAM_API_KEY || '';
  const results = [];

  for (const icao of icaoList) {
    const cacheKey = 'faa_' + icao.toUpperCase();
    if (NOTAM_CACHE[cacheKey] && Date.now() - NOTAM_CACHE[cacheKey].ts < NOTAM_CACHE_TTL) {
      results.push(...NOTAM_CACHE[cacheKey].data);
      continue;
    }

    try {
      const url = `https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=${icao.toUpperCase()}&sortBy=effectiveStartDate&sortOrder=Desc&pageSize=20`;
      const headers = { 'Accept': 'application/json' };
      if (apiKey) headers['client_id'] = apiKey;

      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        console.warn(`FAA NOTAM API ${resp.status} for ${icao}`);
        continue;
      }
      const json = await resp.json();
      const items = (json.items || []).map(item => {
        const props = item.properties || {};
        return {
          id: props.coreNOTAMData?.notam?.id || item.id || '',
          icao: icao.toUpperCase(),
          source: 'FAA',
          classification: props.coreNOTAMData?.notam?.classification || '',
          text: props.coreNOTAMData?.notam?.text || props.coreNOTAMData?.notam?.translatedText?.simpleText || '',
          effectiveStart: props.coreNOTAMData?.notam?.effectiveStart || '',
          effectiveEnd: props.coreNOTAMData?.notam?.effectiveEnd || '',
          type: props.coreNOTAMData?.notam?.type || '',
          issued: props.coreNOTAMData?.notam?.issued || '',
          location: props.coreNOTAMData?.notam?.location || icao.toUpperCase(),
          severity: _classifyNotamSeverity(props.coreNOTAMData?.notam?.classification, props.coreNOTAMData?.notam?.text || '')
        };
      });
      NOTAM_CACHE[cacheKey] = { ts: Date.now(), data: items };
      results.push(...items);
    } catch (e) {
      console.warn(`FAA NOTAM fetch error for ${icao}:`, e.message);
    }
  }
  return results;
}

/**
 * Fetches UK NOTAMs from NATS AIS (public JSON endpoint)
 */
async function fetchUKNotams(icaoList) {
  const results = [];
  for (const icao of icaoList) {
    const cacheKey = 'uk_' + icao.toUpperCase();
    if (NOTAM_CACHE[cacheKey] && Date.now() - NOTAM_CACHE[cacheKey].ts < NOTAM_CACHE_TTL) {
      results.push(...NOTAM_CACHE[cacheKey].data);
      continue;
    }

    try {
      // NATS Websocket / pilotweb uses a query format
      const url = `https://pilotweb.nas.faa.gov/PilotWeb/notamRetrievalByICAOAction.do?method=displayByICAO&reportType=REPORT&formatType=DOMESTIC&actionType=notamRetrievalByICAOs&retrieveLocId=${icao.toUpperCase()}&openItems=`;
      // Since the UK NATS doesn't have a simple public JSON API, we'll tag UK airports
      // served via the FAA international feed or use the same FAA endpoint for ICAO codes
      const items = await fetchFAANotams([icao]);
      items.forEach(i => { i.source = icao.toUpperCase().startsWith('EG') ? 'UK-NATS' : i.source; });
      NOTAM_CACHE[cacheKey] = { ts: Date.now(), data: items };
      results.push(...items);
    } catch (e) {
      console.warn(`UK NOTAM fetch error for ${icao}:`, e.message);
    }
  }
  return results;
}

function _classifyNotamSeverity(classification, text) {
  const t = (text + ' ' + (classification || '')).toUpperCase();
  if (t.includes('CLOSED') || t.includes('UNSERVICEABLE') || t.includes('OUT OF SERVICE') || t.includes('U/S')
    || t.includes('NOT AVBL') || t.includes('NOT AVAILABLE') || t.includes('CLSD')) return 'critical';
  if (t.includes('CHANGED') || t.includes('LIMITED') || t.includes('RESTRICTED') || t.includes('CAUTION')
    || t.includes('WARNING') || t.includes('OBST') || t.includes('CRANE') || t.includes('WORK IN PROGRESS')) return 'advisory';
  return 'info';
}

/**
 * GET /notams/live?icao=KJFK,EGLL,KLAX  — Fetch real-world NOTAMs
 * Public endpoint (no auth needed) — returns cached NOTAM data
 */
app.get('/notams/live', async (req, res) => {
  try {
    const icaoParam = (req.query.icao || '').toUpperCase().replace(/[^A-Z,]/g, '');
    if (!icaoParam) {
      return res.json({ notams: [], error: 'Provide ?icao=KJFK,EGLL etc.' });
    }
    const icaoList = icaoParam.split(',').filter(Boolean).slice(0, 10); // max 10 airports

    const notams = await fetchFAANotams(icaoList);
    res.json({
      notams,
      count: notams.length,
      icao: icaoList,
      cached: true,
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('NOTAM live endpoint error:', e);
    res.status(500).json({ error: 'Failed to fetch NOTAMs', message: e.message });
  }
});

/**
 * POST /notams/discord — Post a NOTAM summary to the #notams Discord channel
 * Auth required
 */
app.post('/notams/discord', auth, async (req, res) => {
  try {
    const { icao, notamId, text, severity, source } = req.body;
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return res.status(500).json({ error: 'Guild not found' });

    const channel = guild.channels.cache.find(c => c.name === '⚠-notams');
    if (!channel) return res.status(404).json({ error: '#⚠-notams channel not found' });

    const colors = { critical: 0xED4245, advisory: 0xFEE75C, info: 0x5865F2 };
    const sevLabel = { critical: '🔴 CRITICAL', advisory: '🟡 ADVISORY', info: '🔵 INFORMATIONAL' };

    await channel.send({
      embeds: [{
        title: `⚠ NOTAM: ${notamId || 'N/A'}`,
        color: colors[severity] || 0x5865F2,
        description: (text || '').substring(0, 2000),
        fields: [
          { name: 'ICAO', value: icao || '—', inline: true },
          { name: 'Severity', value: sevLabel[severity] || 'INFO', inline: true },
          { name: 'Source', value: source || 'FAA', inline: true }
        ],
        footer: { text: 'GFIG Real-World NOTAM Feed' },
        timestamp: new Date().toISOString()
      }]
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('NOTAM Discord post error:', e);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   DIRECT MESSAGE (DM) NOTIFICATION SYSTEM
   ═══════════════════════════════════════════════════════════════ */

/**
 * POST /dm — Send a DM to a Discord user
 * Body: { discordId?, discordUsername?, type, title, message, fields?, color? }
 * Provide discordId OR discordUsername (bot will search guild members by username)
 * Types: registration, approved, denied, training_booked, training_reminder,
 *        mission_assigned, rank_promotion, event_reminder, generic
 */
app.post('/dm', auth, async (req, res) => {
  try {
    const { discordId, discordUsername, type, title, message, fields, color } = req.body;
    if (!discordId && !discordUsername) return res.status(400).json({ error: 'discordId or discordUsername is required' });
    if (!type && !message) return res.status(400).json({ error: 'type or message is required' });

    // Resolve user — by ID or by username search
    let user;
    if (discordId) {
      try { user = await client.users.fetch(discordId); }
      catch(e) { return res.status(404).json({ error: 'Discord user not found by ID' }); }
    } else {
      // Search guild members by username
      const guild = getGuild(res); if (!guild) return;
      await guild.members.fetch();
      const cleanName = discordUsername.replace(/^@/, '').toLowerCase();
      const member = guild.members.cache.find(m =>
        m.user.username.toLowerCase() === cleanName ||
        m.user.tag.toLowerCase() === cleanName ||
        m.displayName.toLowerCase() === cleanName
      );
      if (!member) return res.status(404).json({ error: 'Discord user "' + discordUsername + '" not found in server' });
      user = member.user;
    }

    const DM_TEMPLATES = {
      registration: {
        color: 0xE67E22,
        title: '📬 Application Received — GFIG',
        description: 'Your application to **Global Flight Inspection Group** has been received!\n\nOur HR team will review your application and get back to you shortly. You can track your application status on the GFIG website.\n\n*Thank you for your interest in joining GFIG!*'
      },
      approved: {
        color: 0x00E676,
        title: '✅ Application Approved — GFIG',
        description: 'Congratulations! Your application to **GFIG** has been **approved**! 🎉\n\nYou are now a full member of the Global Flight Inspection Group. Here\'s what to do next:\n\n• Visit your **Dashboard** to see your member profile\n• Check out the **Training** page to begin your courses\n• Browse **Missions** for available inspections\n• Join events on the **Events** page\n\nWelcome aboard, Inspector!'
      },
      denied: {
        color: 0xFF4444,
        title: '❌ Application Update — GFIG',
        description: 'Thank you for your interest in GFIG. Unfortunately, your application has not been approved at this time.\n\nYou are welcome to reapply in the future. If you have questions, please reach out to our HR team.'
      },
      training_booked: {
        color: 0x40AAFF,
        title: '📚 Training Session Booked — GFIG',
        description: 'Your training session has been booked! Here are the details:'
      },
      training_reminder: {
        color: 0xFFD700,
        title: '⏰ Training Reminder — GFIG',
        description: 'This is a reminder that you have an upcoming training session:'
      },
      mission_assigned: {
        color: 0xFF6A00,
        title: '✈️ Mission Assigned — GFIG',
        description: 'You have been assigned to a new mission! Check the Missions page for full details.'
      },
      rank_promotion: {
        color: 0xE040FB,
        title: '⭐ Rank Promotion — GFIG',
        description: 'Congratulations on your promotion! Your dedication to GFIG has been recognised.'
      },
      event_reminder: {
        color: 0x5865F2,
        title: '📅 Event Reminder — GFIG',
        description: 'Reminder: You have an upcoming GFIG event!'
      }
    };

    const template = DM_TEMPLATES[type] || {};
    const embed = {
      color: color || template.color || 0x5865F2,
      title: title || template.title || '📋 GFIG Notification',
      description: message || template.description || '',
      footer: { text: 'Global Flight Inspection Group', iconURL: 'https://jackandrews0919.github.io/gfig-website/logo.png' },
      timestamp: new Date().toISOString()
    };

    // Add custom fields if provided
    if (fields && Array.isArray(fields)) {
      embed.fields = fields.map(f => ({
        name: String(f.name || '').substring(0, 256),
        value: String(f.value || '').substring(0, 1024),
        inline: !!f.inline
      }));
    }

    await user.send({ embeds: [embed] });
    auditPush({ type: 'dm_sent', user: user.tag, summary: `DM sent to **${user.tag}**: ${embed.title}` });
    res.json({ ok: true, sent: true, userId: user.id, userTag: user.tag });
  } catch(e) {
    // User may have DMs disabled
    if (e.code === 50007) {
      return res.json({ ok: false, sent: false, reason: 'User has DMs disabled' });
    }
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /dm/bulk — Send a DM to multiple users
 * Body: { userIds: [discordId,...], type, title, message, fields?, color? }
 */
app.post('/dm/bulk', auth, async (req, res) => {
  try {
    const { userIds, type, title, message, fields, color } = req.body;
    if (!userIds || !userIds.length) return res.status(400).json({ error: 'userIds array is required' });

    const log = [];
    for (const discordId of userIds.slice(0, 50)) { // Max 50 per batch
      try {
        const user = await client.users.fetch(discordId);
        const DM_TEMPLATES = {
          registration: { color: 0xE67E22, title: '📬 Application Received — GFIG' },
          approved:     { color: 0x00E676, title: '✅ Application Approved — GFIG' },
          event_reminder: { color: 0x5865F2, title: '📅 Event Reminder — GFIG' }
        };
        const template = DM_TEMPLATES[type] || {};
        const embed = {
          color: color || template.color || 0x5865F2,
          title: title || template.title || '📋 GFIG Notification',
          description: message || '',
          footer: { text: 'Global Flight Inspection Group' },
          timestamp: new Date().toISOString()
        };
        if (fields && Array.isArray(fields)) embed.fields = fields;
        await user.send({ embeds: [embed] });
        log.push('ok:' + user.tag);
      } catch(e) {
        log.push('err:' + discordId + ': ' + e.message);
      }
    }

    res.json({ ok: true, sent: log.filter(l => l.startsWith('ok:')).length, failed: log.filter(l => l.startsWith('err:')).length, log });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════
   DISCORD CHANNEL CONTENT MANAGEMENT
   Post/update rich embeds to information channels (welcome, rules,
   staff-directory, announcements, notams)
   ═══════════════════════════════════════════════════════════════ */

/**
 * POST /channel-message — Post or update a rich embed in a named channel
 * Body: { channelName, title, description, color?, fields?, footer?, messageId? }
 * If messageId is provided, edits that message; otherwise sends a new one.
 * Returns: { ok, messageId }
 */
app.post('/channel-message', auth, async (req, res) => {
  try {
    const { channelName, title, description, color, fields, footer, messageId } = req.body;
    if (!channelName) return res.status(400).json({ error: 'channelName is required' });
    if (!title && !description) return res.status(400).json({ error: 'title or description is required' });

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return res.status(500).json({ error: 'Guild not found' });

    // Find channel by name (supports emoji prefixed names like 👋-welcome)
    const channel = guild.channels.cache.find(c =>
      c.isTextBased() && (
        c.name === channelName ||
        c.name.includes(channelName) ||
        c.name.replace(/[^\w-]/g, '') === channelName.replace(/[^\w-]/g, '')
      )
    );
    if (!channel) return res.status(404).json({ error: `Channel "${channelName}" not found` });

    const embed = {
      color: color || 0x0077FF,
      title: (title || '').substring(0, 256),
      description: (description || '').substring(0, 4096),
      footer: { text: footer || 'Global Flight Inspection Group', iconURL: 'https://jackandrews0919.github.io/gfig-website/logo.png' },
      timestamp: new Date().toISOString()
    };

    if (fields && Array.isArray(fields)) {
      embed.fields = fields.slice(0, 25).map(f => ({
        name: String(f.name || '').substring(0, 256),
        value: String(f.value || '').substring(0, 1024),
        inline: !!f.inline
      }));
    }

    let msg;
    if (messageId) {
      // Try to edit existing message
      try {
        msg = await channel.messages.fetch(messageId);
        await msg.edit({ embeds: [embed] });
      } catch(e) {
        // Message not found — send new one
        msg = await channel.send({ embeds: [embed] });
      }
    } else {
      msg = await channel.send({ embeds: [embed] });
    }

    auditPush({
      type: 'channel_message',
      channel: '#' + channel.name,
      summary: `Channel content ${messageId ? 'updated' : 'posted'} in **#${channel.name}**: ${title || '(no title)'}`
    });

    res.json({ ok: true, messageId: msg.id, channelId: channel.id, channelName: channel.name });
  } catch(e) {
    console.error('Channel message error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /channel-clear — Delete recent bot messages in a channel
 * Body: { channelName, limit? }
 */
app.post('/channel-clear', auth, async (req, res) => {
  try {
    const { channelName, limit } = req.body;
    if (!channelName) return res.status(400).json({ error: 'channelName is required' });

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return res.status(500).json({ error: 'Guild not found' });

    const channel = guild.channels.cache.find(c =>
      c.isTextBased() && (
        c.name === channelName ||
        c.name.includes(channelName) ||
        c.name.replace(/[^\w-]/g, '') === channelName.replace(/[^\w-]/g, '')
      )
    );
    if (!channel) return res.status(404).json({ error: `Channel "${channelName}" not found` });

    const messages = await channel.messages.fetch({ limit: Math.min(limit || 10, 50) });
    const botMessages = messages.filter(m => m.author.id === client.user.id);
    let deleted = 0;
    for (const [, m] of botMessages) {
      await m.delete();
      deleted++;
    }

    res.json({ ok: true, deleted });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
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

/* Audit: Message Deleted */
client.on(Events.MessageDelete, (msg) => {
  if (!msg.guild || msg.guild.id !== GUILD_ID) return;
  if (msg.author?.bot) return;
  auditPush({
    type:    'message_delete',
    user:    msg.author?.tag || 'Unknown',
    channel: '#' + (msg.channel?.name || '?'),
    summary: `Message by **${msg.author?.tag || 'Unknown'}** deleted in **#${msg.channel?.name || '?'}**`,
    details: msg.content ? msg.content.substring(0, 500) : '(content unavailable — message not cached)'
  });
});

/* Audit: Message Edited */
client.on(Events.MessageUpdate, (oldMsg, newMsg) => {
  if (!newMsg.guild || newMsg.guild.id !== GUILD_ID) return;
  if (newMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;
  auditPush({
    type:    'message_edit',
    user:    newMsg.author?.tag || 'Unknown',
    channel: '#' + (newMsg.channel?.name || '?'),
    summary: `Message by **${newMsg.author?.tag || 'Unknown'}** edited in **#${newMsg.channel?.name || '?'}**`,
    details: `**Before:**\n${(oldMsg.content || '(unavailable)').substring(0, 250)}\n\n**After:**\n${(newMsg.content || '').substring(0, 250)}`
  });
});

/* Audit: Channel Created */
client.on(Events.ChannelCreate, (ch) => {
  if (!ch.guild || ch.guild.id !== GUILD_ID) return;
  auditPush({
    type:    'channel_create',
    channel: '#' + ch.name,
    summary: `Channel **#${ch.name}** created (${ch.type === ChannelType.GuildCategory ? 'category' : ch.type === ChannelType.GuildVoice ? 'voice' : 'text'})`
  });
});

/* Audit: Channel Deleted */
client.on(Events.ChannelDelete, (ch) => {
  if (!ch.guild || ch.guild.id !== GUILD_ID) return;
  auditPush({
    type:    'channel_delete',
    channel: '#' + ch.name,
    summary: `Channel **#${ch.name}** deleted`
  });
});

/* Audit: Member Join — auto-assign Guest role */
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  auditPush({
    type:    'member_join',
    user:    member.user.tag,
    summary: `**${member.user.tag}** joined the server`
  });

  // Auto-assign Guest role
  try {
    const guestRole = member.guild.roles.cache.find(r => r.name === 'Guest');
    if (guestRole) {
      await member.roles.add(guestRole, 'Auto-assign Guest on join');
    }
  } catch(e) { console.warn('Failed to assign Guest role:', e.message); }

  // Welcome message in #welcome channel
  try {
    const welcomeCh = member.guild.channels.cache.find(c => c.isTextBased() && c.name.includes('welcome'));
    if (welcomeCh) {
      await welcomeCh.send({ embeds: [{
        color: 0x2ECC71,
        title: '👋 Welcome to GFIG!',
        description: `Welcome **${member.user.username}**! You've been given the **Guest** role.\n\nTo become a full member, visit our website and submit an application at **gfig.org/join**.\n\nFeel free to browse our community channels and introduce yourself in <#${member.guild.channels.cache.find(c => c.name.includes('introductions'))?.id || 'introductions'}>!`,
        thumbnail: { url: member.user.displayAvatarURL({ size: 128 }) },
        footer: { text: 'Global Flight Inspection Group' },
        timestamp: new Date().toISOString()
      }] });
    }
  } catch(e) { console.warn('Failed to send welcome message:', e.message); }

  // Send welcome DM to new member
  try {
    await member.user.send({ embeds: [{
      color: 0x2ECC71,
      title: '👋 Welcome to GFIG!',
      description: `Hi **${member.user.username}**! Welcome to the **Global Flight Inspection Group** Discord server.\n\n`
        + `You've been given the **Guest** role. To become a full member and gain access to all channels, you'll need to apply on our website:\n\n`
        + `🌐 **Apply here:** https://jackandrews0919.github.io/gfig-website/join.html\n\n`
        + `Once approved, you'll receive your member rank, access to missions, training, and all GFIG operations.\n\n`
        + `If you have any questions, feel free to ask in our community channels!`,
      thumbnail: { url: member.guild.iconURL({ size: 128 }) || '' },
      footer: { text: 'Global Flight Inspection Group' },
      timestamp: new Date().toISOString()
    }] });
  } catch(e) { /* User may have DMs disabled — silent fail */ }
});

/* Audit: Member Leave */
client.on(Events.GuildMemberRemove, (member) => {
  if (member.guild.id !== GUILD_ID) return;
  auditPush({
    type:    'member_leave',
    user:    member.user.tag,
    summary: `**${member.user.tag}** left the server`
  });
});

client.on('error', e => console.error('Discord error:', e.message));

/* ── Start ──────────────────────────────────────────────────── */

async function start() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 GFIG Bot API listening on 0.0.0.0:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
  });
  try {
    await client.login(BOT_TOKEN);
  } catch(e) {
    console.error('⚠ Discord login failed:', e.message);
    console.error('  The API server is still running. Fix the issue and redeploy.');
  }
}

start();
