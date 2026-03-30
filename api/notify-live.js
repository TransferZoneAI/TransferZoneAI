// api/notify-live.js
// Körs var 60:e sekund via cron-job.org
// Pollar live-matcher och skickar notiser för:
// Kampstart, Mål, Röda kort, Halvtid, Fulltime

export const config = { runtime: 'edge' };

const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const APISPORTS_KEY     = process.env.APISPORTS_KEY;
const KV_URL            = process.env.KV_REST_API_URL;
const KV_TOKEN          = process.env.KV_REST_API_TOKEN;

async function fetchJSON(url, key) {
  const res = await fetch(url, { headers: { 'x-apisports-key': key } });
  const buf = await res.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['GET', key]]),
  });
  const data = await res.json();
  return data[0]?.result || null;
}

async function kvSet(key, value, exSeconds = 86400) {
  await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, value, 'EX', exSeconds]]),
  });
}

async function getSubscribersForTeam(teamId) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SMEMBERS', `team:${teamId}:subscribers`]]),
  });
  const data = await res.json();
  return data[0]?.result || [];
}

async function sendPushToSubscribers(subscriberIds, title, message, url) {
  if (!subscriberIds.length) return;
  await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      include_subscription_ids: subscriberIds,
      headings: { en: title },
      contents: { en: message },
      url,
      priority: 10,
    }),
  });
}

async function notifyTeams(homeId, awayId, fixtureId, title, message) {
  const [homeSubs, awaySubs] = await Promise.all([
    getSubscribersForTeam(homeId),
    getSubscribersForTeam(awayId),
  ]);
  const allSubs = [...new Set([...homeSubs, ...awaySubs])];
  if (allSubs.length) {
    await sendPushToSubscribers(
      allSubs, title, message,
      `https://transferzoneai.com/#/match/${fixtureId}`
    );
  }
  return allSubs.length;
}

export default async function handler(req) {
  const data     = await fetchJSON('https://v3.football.api-sports.io/fixtures?live=all', APISPORTS_KEY);
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

    // ── KAMPSTART ──
    if (status === '1H' && elapsed <= 3) {
      const key = `notif_start_${fixtureId}`;
      if (!await kvGet(key)) {
        await notifyTeams(homeId, awayId, fixtureId,
          `🟢 KICK OFF — ${home} vs ${away}`,
          `${league} has started! Follow live on TransferZoneAI`
        );
        await kvSet(key, '1', 86400);
        notifications.push({ type: 'kickoff', home, away });
      }
    }

    // ── HALVTID ──
    if (status === 'HT') {
      const key = `notif_ht_${fixtureId}`;
      if (!await kvGet(key)) {
        await notifyTeams(homeId, awayId, fixtureId,
          `⏸ HALF TIME — ${home} ${scoreH}–${scoreA} ${away}`,
          `${league} — Half time score`
        );
        await kvSet(key, '1', 86400);
        notifications.push({ type: 'halftime', home, away, scoreH, scoreA });
      }
    }

    // ── FULLTIME ──
    if (['FT','AET','PEN'].includes(status)) {
      const key = `notif_ft_${fixtureId}`;
      if (!await kvGet(key)) {
        const resultLabel = scoreH > scoreA ? `${home} win!`
          : scoreA > scoreH ? `${away} win!` : 'Draw!';
        await notifyTeams(homeId, awayId, fixtureId,
          `🏁 FULL TIME — ${home} ${scoreH}–${scoreA} ${away}`,
          `${resultLabel} — ${league}`
        );
        await kvSet(key, '1', 86400);
        notifications.push({ type: 'fulltime', home, away, scoreH, scoreA });
      }
    }

    // ── MÅL & RÖDA KORT ──
    if (['1H','2H','ET'].includes(status)) {
      const eventsData = await fetchJSON(
        `https://v3.football.api-sports.io/fixtures/events?fixture=${fixtureId}`,
        APISPORTS_KEY
      ).catch(() => ({ response: [] }));

      for (const e of eventsData.response || []) {
        const eventKey   = `notif_event_${fixtureId}_${e.time?.elapsed}_${e.type}_${e.player?.id}`;
        if (await kvGet(eventKey)) continue;

        const isHome     = e.team?.id === homeId;
        const scorerTeam = isHome ? home : away;
        const playerName = e.player?.name || 'Unknown';
        const minute     = e.time?.elapsed || 0;

        // MÅL
        if (e.type === 'Goal' && e.detail !== 'Missed Penalty') {
          const isOwnGoal = e.detail === 'Own Goal';
          const isPenalty = e.detail === 'Penalty';
          const emoji     = isOwnGoal ? '🔴' : isPenalty ? '⚽🎯' : '⚽';
          await notifyTeams(homeId, awayId, fixtureId,
            `${emoji} GOAL! ${home} ${scoreH}–${scoreA} ${away}`,
            `${minute}' ${playerName} scores for ${scorerTeam}${isOwnGoal ? ' (OG)' : ''} — ${league}`
          );
          await kvSet(eventKey, '1', 86400);
          notifications.push({ type: 'goal', playerName, scorerTeam, minute });
        }

        // RÖTT KORT
        if (e.type === 'Card' && e.detail === 'Red Card') {
          await notifyTeams(homeId, awayId, fixtureId,
            `🔴 RED CARD — ${home} vs ${away}`,
            `${minute}' ${playerName} (${scorerTeam}) receives a red card — ${league}`
          );
          await kvSet(eventKey, '1', 86400);
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
