// api/notify-prematch.js
// Körs var 30:e minut via cron-job.org
// Hittar matcher som startar om ~60 eller ~30 minuter
// Hämtar subscribers från Redis

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

export default async function handler(req) {
  const now   = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const data     = await fetchJSON(`https://v3.football.api-sports.io/fixtures?date=${today}`, APISPORTS_KEY);
  const fixtures = data.response || [];
  const notified = [];

  for (const f of fixtures) {
    const status = f.fixture?.status?.short;
    if (!['NS', 'TBD'].includes(status)) continue;

    const kickoff   = new Date(f.fixture.date).getTime();
    const minsUntil = Math.round((kickoff - now) / 60000);

    let label = null;
    if (minsUntil >= 55 && minsUntil <= 65) label = '1 hour';
    if (minsUntil >= 25 && minsUntil <= 35) label = '30 minutes';
    if (!label) continue;

    const home      = f.teams?.home?.name || '';
    const away      = f.teams?.away?.name || '';
    const homeId    = f.teams?.home?.id   || 0;
    const awayId    = f.teams?.away?.id   || 0;
    const league    = f.league?.name      || '';
    const fixtureId = f.fixture?.id       || 0;

    const kickoffStr = new Date(f.fixture.date).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm',
    });

    const title   = `⏰ ${home} vs ${away}`;
    const message = `Kicks off in ${label} at ${kickoffStr} — ${league}`;
    const url     = `https://transferzoneai.com/#/match/${fixtureId}`;

    // Samla unika subscribers för båda lagen
    const [homeSubs, awaySubs] = await Promise.all([
      getSubscribersForTeam(homeId),
      getSubscribersForTeam(awayId),
    ]);
    const allSubs = [...new Set([...homeSubs, ...awaySubs])];

    if (allSubs.length) {
      await sendPushToSubscribers(allSubs, title, message, url);
      notified.push({ home, away, minsUntil, label, subscribers: allSubs.length });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, checked: fixtures.length, notified }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
