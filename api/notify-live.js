// api/notify-live.js
// Körs varje minut via Vercel cron
// Skickar notiser för:
// - Matchstart
// - Mål
// - Rött kort
// - Halvtid
// - Fulltid

export const config = { runtime: 'edge' };

const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const APISPORTS_KEY     = process.env.APISPORTS_KEY;
const KV_URL            = process.env.KV_REST_API_URL;
const KV_TOKEN          = process.env.KV_REST_API_TOKEN;

// ===== HELPERS =====

async function fetchJSON(url, key) {
  const res = await fetch(url, {
    headers: { 'x-apisports-key': key }
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status} for ${url}`);
  }

  const buf = await res.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}

async function kvPipeline(commands) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    throw new Error(`KV error ${res.status}`);
  }

  return res.json();
}

async function kvGet(key) {
  const data = await kvPipeline([['GET', key]]);
  return data[0]?.result || null;
}

async function kvSet(key, value, exSeconds = 86400) {
  await kvPipeline([['SET', key, value, 'EX', exSeconds]]);
}

async function getSubscribersForTeam(teamId) {
  if (!teamId) return [];
  const data = await kvPipeline([['SMEMBERS', `team:${teamId}:subscribers`]]);
  return data[0]?.result || [];
}

async function sendPushToSubscribers(subscriptionIds, title, message, url, data = {}) {
  if (!subscriptionIds?.length) return;

  const res = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      include_subscription_ids: subscriptionIds,
      headings: { en: title },
      contents: { en: message },
      url,
      data,
      priority: 10,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OneSignal error ${res.status}: ${txt}`);
  }
}

function matchUrl(fixtureId) {
  return `https://transferzoneai.com/match/${fixtureId}`;
}

async function notifyTeams(homeId, awayId, fixtureId, title, message, data = {}) {
  const [homeSubs, awaySubs] = await Promise.all([
    getSubscribersForTeam(homeId),
    getSubscribersForTeam(awayId),
  ]);

  const allSubs = [...new Set([...(homeSubs || []), ...(awaySubs || [])])];

  if (!allSubs.length) return 0;

  await sendPushToSubscribers(
    allSubs,
    title,
    message,
    matchUrl(fixtureId),
    data
  );

  return allSubs.length;
}

function isLiveStatus(status) {
  return ['1H', 'HT', '2H', 'ET', 'P', 'BT'].includes(status);
}

function isFinishedStatus(status) {
  return ['FT', 'AET', 'PEN'].includes(status);
}

function isKickoffWindow(status, elapsed) {
  return status === '1H' && Number(elapsed || 0) <= 3;
}

function getEventDedupeKey(fixtureId, e) {
  const minute = e?.time?.elapsed || 0;
  const extra  = e?.time?.extra || 0;
  const type   = e?.type || 'unknown';
  const detail = e?.detail || 'unknown';
  const teamId = e?.team?.id || 0;
  const player = e?.player?.id || e?.player?.name || 'unknown';
  return `notif_event_${fixtureId}_${minute}_${extra}_${type}_${detail}_${teamId}_${player}`;
}

// ===== MAIN =====

export default async function handler() {
  const notifications = [];

  const liveData = await fetchJSON(
    'https://v3.football.api-sports.io/fixtures?live=all',
    APISPORTS_KEY
  );

  const fixtures = liveData.response || [];

  for (const f of fixtures) {
    const fixtureId = f.fixture?.id;
    if (!fixtureId) continue;

    const status  = f.fixture?.status?.short || '';
    const elapsed = Number(f.fixture?.status?.elapsed || 0);

    const home   = f.teams?.home?.name || '';
    const away   = f.teams?.away?.name || '';
    const homeId = f.teams?.home?.id || 0;
    const awayId = f.teams?.away?.id || 0;

    const scoreH = f.goals?.home ?? 0;
    const scoreA = f.goals?.away ?? 0;
    const league = f.league?.name || '';

    // ===== MATCHSTART =====
    if (isKickoffWindow(status, elapsed)) {
      const key = `notif_start_${fixtureId}`;
      const alreadySent = await kvGet(key);

      if (!alreadySent) {
        const count = await notifyTeams(
          homeId,
          awayId,
          fixtureId,
          `🟢 KICK OFF — ${home} vs ${away}`,
          `${league} has started! Follow it live on TransferZoneAI.`,
          {
            type: 'kickoff',
            fixtureId,
            homeId,
            awayId
          }
        );

        if (count > 0) {
          await kvSet(key, '1', 86400);
          notifications.push({ type: 'kickoff', fixtureId, home, away, subscribers: count });
        }
      }
    }

    // ===== HALVTID =====
    if (status === 'HT') {
      const key = `notif_ht_${fixtureId}`;
      const alreadySent = await kvGet(key);

      if (!alreadySent) {
        const count = await notifyTeams(
          homeId,
          awayId,
          fixtureId,
          `⏸ HALF TIME — ${home} ${scoreH}–${scoreA} ${away}`,
          `${league} — half time score.`,
          {
            type: 'halftime',
            fixtureId,
            scoreH,
            scoreA
          }
        );

        if (count > 0) {
          await kvSet(key, '1', 86400);
          notifications.push({ type: 'halftime', fixtureId, home, away, subscribers: count });
        }
      }
    }

    // ===== FULLTID =====
    if (isFinishedStatus(status)) {
      const key = `notif_ft_${fixtureId}`;
      const alreadySent = await kvGet(key);

      if (!alreadySent) {
        const resultLabel =
          scoreH > scoreA ? `${home} win!`
          : scoreA > scoreH ? `${away} win!`
          : 'Draw!';

        const count = await notifyTeams(
          homeId,
          awayId,
          fixtureId,
          `🏁 FULL TIME — ${home} ${scoreH}–${scoreA} ${away}`,
          `${resultLabel} — ${league}`,
          {
            type: 'fulltime',
            fixtureId,
            scoreH,
            scoreA
          }
        );

        if (count > 0) {
          await kvSet(key, '1', 172800);
          notifications.push({ type: 'fulltime', fixtureId, home, away, subscribers: count });
        }
      }
    }

    // ===== LIVE EVENTS =====
    if (isLiveStatus(status)) {
      const eventsData = await fetchJSON(
        `https://v3.football.api-sports.io/fixtures/events?fixture=${fixtureId}`,
        APISPORTS_KEY
      ).catch(() => ({ response: [] }));

      const events = eventsData.response || [];

      for (const e of events) {
        const eventKey = getEventDedupeKey(fixtureId, e);
        const alreadySent = await kvGet(eventKey);
        if (alreadySent) continue;

        const minute = e?.time?.elapsed || 0;
        const scorerTeam = e?.team?.name || '';
        const scorerTeamId = e?.team?.id || 0;
        const playerName = e?.player?.name || 'Unknown player';

        // MÅL
        if (e.type === 'Goal' && e.detail !== 'Missed Penalty') {
          const isOwnGoal = e.detail === 'Own Goal';
          const isPenalty = e.detail === 'Penalty';
          const emoji = isOwnGoal ? '🔴⚽' : isPenalty ? '⚽🎯' : '⚽';

          const count = await notifyTeams(
            homeId,
            awayId,
            fixtureId,
            `${emoji} GOAL! ${home} ${scoreH}–${scoreA} ${away}`,
            `${minute}' ${playerName} scores for ${scorerTeam}${isOwnGoal ? ' (own goal)' : ''} — ${league}`,
            {
              type: 'goal',
              fixtureId,
              teamId: scorerTeamId,
              playerName,
              minute
            }
          );

          if (count > 0) {
            await kvSet(eventKey, '1', 259200);
            notifications.push({
              type: 'goal',
              fixtureId,
              home,
              away,
              playerName,
              minute,
              subscribers: count
            });
          }
        }

        // RÖTT KORT
        if (
          e.type === 'Card' &&
          (e.detail === 'Red Card' || e.detail === 'Second Yellow card')
        ) {
          const count = await notifyTeams(
            homeId,
            awayId,
            fixtureId,
            `🔴 RED CARD — ${home} vs ${away}`,
            `${minute}' ${playerName} (${scorerTeam}) is sent off — ${league}`,
            {
              type: 'redcard',
              fixtureId,
              teamId: scorerTeamId,
              playerName,
              minute
            }
          );

          if (count > 0) {
            await kvSet(eventKey, '1', 259200);
            notifications.push({
              type: 'redcard',
              fixtureId,
              home,
              away,
              playerName,
              minute,
              subscribers: count
            });
          }
        }
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      liveFixtures: fixtures.length,
      notifications
    }),
    {
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
