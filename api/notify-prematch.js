// api/notify-prematch.js
// Körs var 5:e minut – skickar notiser 1h och 30 min innan match

export const config = { runtime: 'edge' };

const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const APISPORTS_KEY     = process.env.APISPORTS_KEY;
const KV_URL            = process.env.KV_REST_API_URL;
const KV_TOKEN          = process.env.KV_REST_API_TOKEN;

// ===== HELPERS =====

async function fetchJSON(url, key) {
  const res = await fetch(url, { headers: { 'x-apisports-key': key } });
  const buf = await res.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}

async function getSubscribersForTeam(teamId) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([['SMEMBERS', `team:${teamId}:subscribers`]]),
  });
  const data = await res.json();
  return data[0]?.result || [];
}

async function sendPushToSubscribers(subscriberIds, title, message, url) {
  if (!subscriberIds.length) return;

  await fetch('https://api.onesignal.com/notifications', {
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
    }),
  });
}

// ===== KV DEDUPE =====

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([['GET', key]]),
  });
  const data = await res.json();
  return data[0]?.result || null;
}

async function kvSet(key, value, ex = 3600) {
  await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([['SET', key, value, 'EX', ex]]),
  });
}

// ===== MAIN =====

export default async function handler() {
  const now = new Date();

  const fixturesData = await fetchJSON(
    `https://v3.football.api-sports.io/fixtures?next=50`,
    APISPORTS_KEY
  );

  const fixtures = fixturesData.response || [];

  for (const f of fixtures) {
    const fixtureId = f.fixture.id;
    const start = new Date(f.fixture.date);
    const diffMin = Math.floor((start - now) / 60000);

    let label = null;

    if (diffMin <= 60 && diffMin > 55) label = '1h';
    if (diffMin <= 30 && diffMin > 25) label = '30m';

    if (!label) continue;

    const homeId = f.teams.home.id;
    const awayId = f.teams.away.id;

    const homeSubs = await getSubscribersForTeam(homeId);
    const awaySubs = await getSubscribersForTeam(awayId);

    const allSubs = [...new Set([...homeSubs, ...awaySubs])];

    const title = '⚽ Match Starting Soon';
    const message = `${f.teams.home.name} vs ${f.teams.away.name} starts in ${label === '1h' ? '1 hour' : '30 minutes'}`;
    const url = `https://transferzoneai.com/#/fixture/${fixtureId}`;

    const dedupeKey = `prematch_${fixtureId}_${label}`;

    if (!(await kvGet(dedupeKey)) && allSubs.length) {
      await sendPushToSubscribers(allSubs, title, message, url);
      await kvSet(dedupeKey, '1', 7200); // 2h
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
