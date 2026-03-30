// api/notify-transfers.js
// Körs varje natt kl 03:30 — hittar dagens transfers och skickar notiser
// Hämtar subscribers från Redis istället för OneSignal-taggar

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
    }),
  });
}

export default async function handler(req) {
  const today   = new Date().toISOString().slice(0, 10);
  const leagues = [39, 140, 78, 135, 61, 2, 3, 94, 88, 113, 253, 307, 71, 128, 332];
  const season  = new Date().getFullYear();

  const results = await Promise.allSettled(
    leagues.map(id =>
      fetchJSON(`https://v3.football.api-sports.io/transfers?league=${id}&season=${season}`, APISPORTS_KEY)
    )
  );

  const todayTransfers = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const entry of r.value.response || []) {
      for (const tr of entry.transfers || []) {
        if (!tr.date || !tr.date.startsWith(today)) continue;
        todayTransfers.push({
          player:   entry.player?.name || 'Unknown',
          fromId:   tr.teams?.out?.id  || 0,
          fromName: tr.teams?.out?.name || '—',
          toId:     tr.teams?.in?.id   || 0,
          toName:   tr.teams?.in?.name || '—',
          type:     tr.type || '',
        });
      }
    }
  }

  const sent = new Set();

  for (const t of todayTransfers) {
    const key = `${t.player}_${t.toId}`;
    if (sent.has(key)) continue;
    sent.add(key);

    const feeLabel = (t.type || '').toLowerCase().includes('loan')
      ? 'on loan' : (t.type || '').toLowerCase() === 'free'
      ? 'on a free transfer' : 'in a confirmed transfer';

    const msg = `${t.player} joins ${t.toName} from ${t.fromName} ${feeLabel}`;
    const url = `https://transferzoneai.com/#/transfers`;

    if (t.toId) {
      const subs = await getSubscribersForTeam(t.toId);
      if (subs.length) await sendPushToSubscribers(subs, `⚽ Transfer: ${t.toName}`, msg, url);
    }

    if (t.fromId && t.fromId !== t.toId) {
      const subs = await getSubscribersForTeam(t.fromId);
      if (subs.length) await sendPushToSubscribers(subs, `⚽ Transfer: ${t.fromName}`, msg, url);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, transfers: todayTransfers.length, notified: sent.size }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
