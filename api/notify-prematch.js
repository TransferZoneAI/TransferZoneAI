// api/notify-prematch.js
// Körs var 5:e minut
// Skickar notiser 1h och 30m innan matchstart

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

async function kvSet(key, value, exSeconds = 7200) {
  await kvPipeline([['SET', key, value, 'EX', exSeconds]]);
}

async function getSubscribersForTeam(teamId) {
  if (!teamId) return [];
  const data = await kvPipeline([['SMEMBERS', `team:${teamId}:subscribers`]]);
  return data[0]?.result || [];
}

async function sendPush(subscriberIds, title, message, url, extraData = {}) {
  if (!subscriberIds?.length) return;

  const res = await fetch('https://api.onesignal.com/notifications', {
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
      data: extraData
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OneSignal error ${res.status}: ${text}`);
  }
}

function matchUrl(fixtureId) {
  return `https://transferzoneai.com/match/${fixtureId}`;
}

async function getMatchSubscribers(homeId, awayId) {
  const [homeSubs, awaySubs] = await Promise.all([
    getSubscribersForTeam(homeId),
    getSubscribersForTeam(awayId),
  ]);

  return [...new Set([...(homeSubs || []), ...(awaySubs || [])])];
}

// ===== MAIN =====

export default async function handler() {
  const now = new Date();

  const fixturesData = await fetchJSON(
    'https://v3.football.api-sports.io/fixtures?next=50',
    APISPORTS_KEY
  );

  const fixtures = fixturesData.response || [];
  const notifications = [];

  for (const f of fixtures) {
    const fixtureId = f.fixture?.id;
    if (!fixtureId) continue;

    const start = new Date(f.fixture.date);
    const diffMin = Math.floor((start - now) / 60000);

    let label = null;
    let title = '';
    let message = '';

    if (diffMin <= 60 && diffMin > 55) {
      label = '1h';
      title = `⏰ Match starts in 1 hour`;
      message = `${f.teams.home.name} vs ${f.teams.away.name} starts in 1 hour.`;
    }

    if (diffMin <= 30 && diffMin > 25) {
      label = '30m';
      title = `⏰ Match starts in 30 minutes`;
      message = `${f.teams.home.name} vs ${f.teams.away.name} starts in 30 minutes.`;
    }

    if (!label) continue;

    const homeId = f.teams?.home?.id || 0;
    const awayId = f.teams?.away?.id || 0;

    const subscribers = await getMatchSubscribers(homeId, awayId);
    if (!subscribers.length) continue;

    const dedupeKey = `prematch_${fixtureId}_${label}`;
    const alreadySent = await kvGet(dedupeKey);
    if (alreadySent) continue;

    await sendPush(
      subscribers,
      title,
      message,
      matchUrl(fixtureId),
      {
        type: 'prematch',
        fixtureId,
        homeId,
        awayId,
        label
      }
    );

    await kvSet(dedupeKey, '1', 7200);

    notifications.push({
      fixtureId,
      home: f.teams.home.name,
      away: f.teams.away.name,
      label
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      notifications
    }),
    {
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
