// api/notify-transfers.js
// Körs dagligen (eller oftare om du vill)
// Skickar notiser när nya transfers upptäcks

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

async function kvSet(key, value, exSeconds = 86400 * 7) {
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

// ===== MAIN =====

export default async function handler() {
  const notifications = [];

  // 🔥 Hämta transfers (senaste)
  const data = await fetchJSON(
    'https://v3.football.api-sports.io/transfers?player=1', // fallback (kräver loop i verklighet)
    APISPORTS_KEY
  ).catch(() => ({ response: [] }));

  const transfers = data.response || [];

  for (const player of transfers) {
    const playerName = player.player?.name || 'Unknown player';

    for (const t of player.transfers || []) {
      const toTeam   = t.teams?.in;
      const fromTeam = t.teams?.out;

      const toId   = toTeam?.id || 0;
      const fromId = fromTeam?.id || 0;

      const date = t.date || '';
      const dedupeKey = `transfer_${player.player?.id}_${toId}_${date}`;

      const alreadySent = await kvGet(dedupeKey);
      if (alreadySent) continue;

      // 🔥 Hämta subscribers (båda lag)
      const [subsIn, subsOut] = await Promise.all([
        getSubscribersForTeam(toId),
        getSubscribersForTeam(fromId)
      ]);

      const subscribers = [...new Set([...(subsIn || []), ...(subsOut || [])])];
      if (!subscribers.length) continue;

      const fee = t.type || 'Transfer';

      await sendPush(
        subscribers,
        `💰 New transfer`,
        `${playerName} → ${toTeam?.name || 'Unknown club'} (${fee})`,
        `https://transferzoneai.com/transfers`,
        {
          type: 'transfer',
          playerName,
          toId,
          fromId
        }
      );

      await kvSet(dedupeKey, '1', 86400 * 7);

      notifications.push({
        playerName,
        to: toTeam?.name,
        from: fromTeam?.name
      });
    }
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
