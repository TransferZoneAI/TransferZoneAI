// api/notify-transfers.js
// Körs via cron, t.ex. var 30:e minut eller några gånger per dag
// Hittar nya transfers och skickar notiser till följare

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

function transfersUrl() {
  return 'https://transferzoneai.com/transfers';
}

function normalizeTransferType(type) {
  const t = String(type || '').toLowerCase();

  if (t.includes('loan')) return 'loan';
  if (t === 'free' || t.includes('free')) return 'free';
  return 'confirmed';
}

function transferTypeLabel(type) {
  const normalized = normalizeTransferType(type);
  if (normalized === 'loan') return 'on loan';
  if (normalized === 'free') return 'on a free transfer';
  return 'in a confirmed transfer';
}

function makeTransferDedupeKey(t) {
  return [
    'notif_transfer',
    t.playerId || t.player,
    t.fromId || 0,
    t.toId || 0,
    t.date || 'nodate',
    normalizeTransferType(t.type || '')
  ].join('_');
}

// ===== MAIN =====

export default async function handler() {
  const today = new Date();
  const year = today.getFullYear();

  // Kör på samma ligor som du redan använder i appen
  const leagues = [39, 140, 78, 135, 61, 2, 3, 94, 88, 113, 253, 307, 71, 128, 332];

  const results = await Promise.allSettled(
    leagues.map(id =>
      fetchJSON(`https://v3.football.api-sports.io/transfers?league=${id}&season=${year}`, APISPORTS_KEY)
    )
  );

  const transferMap = new Map();

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;

    for (const entry of result.value.response || []) {
      const playerId = entry.player?.id || 0;
      const playerName = entry.player?.name || 'Unknown player';

      for (const tr of entry.transfers || []) {
        if (!tr.date) continue;

        const item = {
          player: playerName,
          playerId,
          fromId: tr.teams?.out?.id || 0,
          fromName: tr.teams?.out?.name || '—',
          toId: tr.teams?.in?.id || 0,
          toName: tr.teams?.in?.name || '—',
          type: tr.type || '',
          date: tr.date,
        };

        const dedupeKey = makeTransferDedupeKey(item);
        if (!transferMap.has(dedupeKey)) {
          transferMap.set(dedupeKey, item);
        }
      }
    }
  }

  const allTransfers = Array.from(transferMap.values())
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const notifications = [];

  for (const t of allTransfers) {
    const redisKey = makeTransferDedupeKey(t);
    const alreadySent = await kvGet(redisKey);
    if (alreadySent) continue;

    const label = transferTypeLabel(t.type);
    const message = `${t.player} joins ${t.toName} from ${t.fromName} ${label}`;

    let sentTo = 0;

    // Köpande lag
    if (t.toId) {
      const subs = await getSubscribersForTeam(t.toId);
      if (subs.length) {
        await sendPushToSubscribers(
          subs,
          `⚽ Transfer: ${t.toName}`,
          message,
          transfersUrl(),
          {
            type: 'transfer_in',
            playerId: t.playerId,
            teamId: t.toId
          }
        );
        sentTo += subs.length;
      }
    }

    // Säljande lag
    if (t.fromId && t.fromId !== t.toId) {
      const subs = await getSubscribersForTeam(t.fromId);
      if (subs.length) {
        await sendPushToSubscribers(
          subs,
          `⚽ Transfer: ${t.fromName}`,
          message,
          transfersUrl(),
          {
            type: 'transfer_out',
            playerId: t.playerId,
            teamId: t.fromId
          }
        );
        sentTo += subs.length;
      }
    }

    // Sätt dedupe bara om vi faktiskt försökt skicka
    if (sentTo > 0) {
      await kvSet(redisKey, '1', 86400 * 14); // 14 dagar
      notifications.push({
        player: t.player,
        from: t.fromName,
        to: t.toName,
        date: t.date,
        type: normalizeTransferType(t.type),
        sentTo
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      transfersChecked: allTransfers.length,
      notifications
    }),
    {
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
