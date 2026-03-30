// api/notify-transfers.js
// Körs varje natt kl 03:30 — hittar dagens transfers och skickar notiser
// till användare som följer berörda lag via OneSignal-taggar

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
    }),
  });
}

export default async function handler(req) {
  const today = new Date().toISOString().slice(0, 10);

  // Hämta dagens transfers från ett urval av ligor
  const leagues = [39, 140, 78, 135, 61, 2, 3, 94, 88, 113, 253, 307, 71, 128, 332];
  const season  = new Date().getFullYear();

  const results = await Promise.allSettled(
    leagues.map(id =>
      fetchJSON(
        `https://v3.football.api-sports.io/transfers?league=${id}&season=${season}`,
        APISPORTS_KEY
      )
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
          playerId: entry.player?.id   || 0,
          fromId:   tr.teams?.out?.id  || 0,
          fromName: tr.teams?.out?.name || '—',
          toId:     tr.teams?.in?.id   || 0,
          toName:   tr.teams?.in?.name || '—',
          type:     tr.type || '',
        });
      }
    }
  }

  // Skicka en notis per unik transfer till fans av inblandade lag
  const sent = new Set();

  for (const t of todayTransfers) {
    const key = `${t.playerId}_${t.toId}`;
    if (sent.has(key)) continue;
    sent.add(key);

    const feeLabel = (t.type || '').toLowerCase().includes('loan')
      ? 'on loan' : (t.type || '').toLowerCase() === 'free'
      ? 'on a free transfer' : 'in a confirmed transfer';

    const msg = `${t.player} joins ${t.toName} from ${t.fromName} ${feeLabel}`;

    // Notis till fans av det köpande laget
    if (t.toId) {
      await sendPush({
        filters: [{ field: 'tag', key: `team_${t.toId}`, relation: '=', value: 'true' }],
        title: `⚽ Transfer: ${t.toName}`,
        message: msg,
        url: `https://transferzoneai.com/#/club/${t.toName.toLowerCase().replace(/\s+/g,'_')}`,
      });
    }

    // Notis till fans av det säljande laget
    if (t.fromId && t.fromId !== t.toId) {
      await sendPush({
        filters: [{ field: 'tag', key: `team_${t.fromId}`, relation: '=', value: 'true' }],
        title: `⚽ Transfer: ${t.fromName}`,
        message: msg,
        url: `https://transferzoneai.com/#/club/${t.fromName.toLowerCase().replace(/\s+/g,'_')}`,
      });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, transfers: todayTransfers.length, notified: sent.size }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
