// api/notify-prematch.js
// Körs varje timme — hittar matcher som startar om ~60 eller ~30 minuter
// och skickar notiser till fans av inblandade lag

export const config = { runtime: 'edge' };

const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const APISPORTS_KEY     = process.env.APISPORTS_KEY;

async function fetchJSON(url, key) {
  const res = await fetch(url, { headers: { 'x-apisports-key': key } });
  const buf = await res.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}

async function sendPush({ filters, title, message, url }) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return;
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
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
    }),
  });
  return res.json();
}

export default async function handler(req) {
  const now      = Date.now();
  const today    = new Date().toISOString().slice(0, 10);

  // Hämta alla matcher idag
  const data = await fetchJSON(
    `https://v3.football.api-sports.io/fixtures?date=${today}`,
    APISPORTS_KEY
  );

  const fixtures = data.response || [];
  const notified = [];

  for (const f of fixtures) {
    // Hoppa över matcher som redan startat
    const status = f.fixture?.status?.short;
    if (!['NS', 'TBD'].includes(status)) continue;

    const kickoff    = new Date(f.fixture.date).getTime();
    const minsUntil  = Math.round((kickoff - now) / 60000);

    // Skicka notis om 55-65 min kvar (= "1 timme innan")
    // eller 25-35 min kvar (= "30 min innan")
    let label = null;
    if (minsUntil >= 55 && minsUntil <= 65) label = '1 hour';
    if (minsUntil >= 25 && minsUntil <= 35) label = '30 minutes';
    if (!label) continue;

    const home    = f.teams?.home?.name || '';
    const away    = f.teams?.away?.name || '';
    const homeId  = f.teams?.home?.id   || 0;
    const awayId  = f.teams?.away?.id   || 0;
    const league  = f.league?.name      || '';
    const fixtureId = f.fixture?.id     || 0;

    const kickoffStr = new Date(f.fixture.date).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm'
    });

    const title   = `⏰ ${home} vs ${away}`;
    const message = `Kicks off in ${label} at ${kickoffStr} — ${league}`;
    const url     = `https://transferzoneai.com/#/match/${fixtureId}`;

    // Notis till fans av hemmalaget
    if (homeId) {
      await sendPush({
        filters: [{ field: 'tag', key: `team_${homeId}`, relation: '=', value: 'true' }],
        title, message, url,
      });
    }

    // Notis till fans av bortalaget
    if (awayId) {
      await sendPush({
        filters: [{ field: 'tag', key: `team_${awayId}`, relation: '=', value: 'true' }],
        title, message, url,
      });
    }

    notified.push({ home, away, minsUntil, label });
  }

  return new Response(
    JSON.stringify({ ok: true, checked: fixtures.length, notified }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
