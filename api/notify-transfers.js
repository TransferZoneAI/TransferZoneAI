export const config = { runtime: 'edge' };

const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const APISPORTS_KEY     = process.env.APISPORTS_KEY;
const KV_URL            = process.env.KV_REST_API_URL;
const KV_TOKEN          = process.env.KV_REST_API_TOKEN;

async function fetchJSON(url, key) {
  const res = await fetch(url, { headers: { 'x-apisports-key': key } });
  if (!res.ok) throw new Error(`API error ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}
async function kvPipeline(commands) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`KV error ${res.status}`);
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
    headers: { 'Authorization': `Basic ${ONESIGNAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: ONESIGNAL_APP_ID, include_subscription_ids: subscriberIds, headings: { en: title }, contents: { en: message }, url, data: extraData })
  });
  if (!res.ok) throw new Error(`OneSignal error ${res.status}: ${await res.text()}`);
}

export default async function handler() {
  const data = await fetchJSON('https://v3.football.api-sports.io/transfers?team=33', APISPORTS_KEY).catch(() => ({ response: [] }));
  const notifications = [];
  for (const entry of data.response || []) {
    const playerName = entry.player?.name || 'Unknown player';
    for (const t of entry.transfers || []) {
      const toId = t.teams?.in?.id || 0;
      const fromId = t.teams?.out?.id || 0;
      const date = t.date || '';
      const dedupeKey = `transfer_${entry.player?.id}_${toId}_${date}`;
      if (await kvGet(dedupeKey)) continue;
      const [subsIn, subsOut] = await Promise.all([getSubscribersForTeam(toId), getSubscribersForTeam(fromId)]);
      const subscribers = [...new Set([...(subsIn || []), ...(subsOut || [])])];
      if (!subscribers.length) continue;
      await sendPush(subscribers, '💰 New transfer', `${playerName} → ${t.teams?.in?.name || 'Unknown club'} (${t.type || 'Transfer'})`, 'https://transferzoneai.com/transfers', { type: 'transfer', playerName, toId, fromId });
      await kvSet(dedupeKey, '1', 86400 * 7);
      notifications.push({ playerName, to: t.teams?.in?.name || '', from: t.teams?.out?.name || '' });
    }
  }
  return new Response(JSON.stringify({ ok: true, notifications }), { headers: { 'Content-Type': 'application/json' } });
}
