export const config = { runtime: 'edge' };

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisCmd(...args) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([args]),
  });
  const data = await res.json();
  return data[0]?.result;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let body;
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const { subscriberId, teamIds, action } = body;
  if (!subscriberId || !Array.isArray(teamIds) || !teamIds.length || !action) {
    return new Response('Missing fields', { status: 400 });
  }
  for (const teamId of teamIds) {
    const tid = String(teamId);
    if (action === 'add') {
      await redisCmd('SADD', `subscriber:${subscriberId}:teams`, tid);
      await redisCmd('SADD', `team:${tid}:subscribers`, subscriberId);
    } else if (action === 'remove') {
      await redisCmd('SREM', `subscriber:${subscriberId}:teams`, tid);
      await redisCmd('SREM', `team:${tid}:subscribers`, subscriberId);
    }
  }
  const teams = await redisCmd('SMEMBERS', `subscriber:${subscriberId}:teams`);
  return new Response(JSON.stringify({ ok: true, teams }), { headers: { 'Content-Type': 'application/json' } });
}
