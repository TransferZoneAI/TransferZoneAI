// api/notify-live.js
// Körs var 60:e sekund via cron-job.org
// Pollar live-matcher och skickar notiser för:
// - Kampstart, Mål, Röda kort, Halvtid, Fulltime

export const config = { runtime: 'edge' };

const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const APISPORTS_KEY     = process.env.APISPORTS_KEY;
const KV_URL            = process.env.KV_REST_API_URL;
const KV_TOKEN          = process.env.KV_REST_API_TOKEN;

// ── KV-store för att hålla koll på vad vi redan notifierat ──
async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const data = await res.json();
  return data.result || null;
}

async function kvSet(key, value, exSeconds = 86400) {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(`${KV_URL}/set/${key}/${encodeURIComponent(value)}?ex=${exSeconds}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
}

async function fetchJSON(url, key) {
  const res = await fetch(url, { headers: { 'x-apisports-key': key } });
  const buf = await res.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}

async function sendPush({ filters, title, message, url }) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return;
  await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      filters,
      headings: { en: title },
      contents: { en: message },
      url,
      priority: 10,
    }),
  });
}

async function notifyBothTeams(homeId, awayId, fixtureId, title, message) {
  const url = `https://transferzoneai.com/#/match/${fixtureId}`;
  const teams = [homeId, awayId].filter(Boolean);
  for (const teamId of teams) {
    await sendPush({
      filters: [{ field: 'tag', key: `team_${teamId}`, relation: '=', value: 'true' }],
      title, message, url,
    });
  }
}

export default async function handler(req) {
  // Hämta alla live-matcher
  const data = await fetchJSON(
    'https://v3.football.api-sports.io/fixtures?live=all',
    APISPORTS_KEY
  );

  const fixtures = data.response || [];
  const notifications = [];

  for (const f of fixtures) {
    const fixtureId = f.fixture?.id;
    const status    = f.fixture?.status?.short;
    const elapsed   = f.fixture?.status?.elapsed || 0;
    const home      = f.teams?.home?.name || '';
    const away      = f.teams?.away?.name || '';
    const homeId    = f.teams?.home?.id   || 0;
    const awayId    = f.teams?.away?.id   || 0;
    const scoreH    = f.goals?.home ?? 0;
    const scoreA    = f.goals?.away ?? 0;
    const league    = f.league?.name || '';

    if (!fixtureId) continue;

    // ── KAMPSTART (1H börjar, elapsed 1-3) ──
    if (status === '1H' && elapsed <= 3) {
      const startKey = `notif_start_${fixtureId}`;
      const alreadySent = await kvGet(startKey);
      if (!alreadySent) {
        await notifyBothTeams(homeId, awayId, fixtureId,
          `🟢 KICK OFF — ${home} vs ${away}`,
          `${league} has started! Follow live on TransferZoneAI`
        );
        await kvSet(startKey, '1', 86400);
        notifications.push({ type: 'kickoff', home, away });
      }
    }

    // ── HALVTID ──
    if (status === 'HT') {
      const htKey = `notif_ht_${fixtureId}`;
      const alreadySent = await kvGet(htKey);
      if (!alreadySent) {
        await notifyBothTeams(homeId, awayId, fixtureId,
          `⏸ HALF TIME — ${home} ${scoreH}–${scoreA} ${away}`,
          `${league} — Half time score`
        );
        await kvSet(htKey, '1', 86400);
        notifications.push({ type: 'halftime', home, away, scoreH, scoreA });
      }
    }

    // ── FULLTIME ──
    if (['FT','AET','PEN'].includes(status)) {
      const ftKey = `notif_ft_${fixtureId}`;
      const alreadySent = await kvGet(ftKey);
      if (!alreadySent) {
        const resultLabel = scoreH > scoreA
          ? `${home} win!` : scoreA > scoreH
          ? `${away} win!` : 'Draw!';
        await notifyBothTeams(homeId, awayId, fixtureId,
          `🏁 FULL TIME — ${home} ${scoreH}–${scoreA} ${away}`,
          `${resultLabel} — ${league}`
        );
        await kvSet(ftKey, '1', 86400);
        notifications.push({ type: 'fulltime', home, away, scoreH, scoreA });
      }
    }

    // ── MÅL & RÖDA KORT — kolla events ──
    if (['1H','2H','ET'].includes(status)) {
      const eventsData = await fetchJSON(
        `https://v3.football.api-sports.io/fixtures/events?fixture=${fixtureId}`,
        APISPORTS_KEY
      ).catch(() => ({ response: [] }));

      const events = eventsData.response || [];

      for (const e of events) {
        const eventId  = `${fixtureId}_${e.time?.elapsed}_${e.type}_${e.player?.id}`;
        const notifKey = `notif_event_${eventId}`;
        const alreadySent = await kvGet(notifKey);
        if (alreadySent) continue;

        const isHomeTeam = e.team?.id === homeId;
        const scorerTeam = isHomeTeam ? home : away;
        const playerName = e.player?.name || 'Unknown';
        const minute     = e.time?.elapsed || 0;

        // MÅL
        if (e.type === 'Goal' && e.detail !== 'Missed Penalty') {
          const newScoreH = isHomeTeam ? scoreH : scoreH;
          const isOwnGoal = e.detail === 'Own Goal';
          const isPenalty = e.detail === 'Penalty';
          const goalEmoji = isOwnGoal ? '🔴' : isPenalty ? '⚽🎯' : '⚽';

          await notifyBothTeams(homeId, awayId, fixtureId,
            `${goalEmoji} GOAL! ${home} ${scoreH}–${scoreA} ${away}`,
            `${minute}' ${playerName} scores for ${scorerTeam}${isOwnGoal ? ' (OG)' : ''} — ${league}`
          );
          await kvSet(notifKey, '1', 86400);
          notifications.push({ type: 'goal', playerName, scorerTeam, minute });
        }

        // RÖTT KORT
        if (e.type === 'Card' && e.detail === 'Red Card') {
          await notifyBothTeams(homeId, awayId, fixtureId,
            `🔴 RED CARD — ${home} vs ${away}`,
            `${minute}' ${playerName} (${scorerTeam}) receives a red card — ${league}`
          );
          await kvSet(notifKey, '1', 86400);
          notifications.push({ type: 'redcard', playerName, scorerTeam, minute });
        }
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, liveFixtures: fixtures.length, notifications }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
