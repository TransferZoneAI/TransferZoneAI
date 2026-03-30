// api/follow.js
// Hanterar follow/unfollow/sync av lag till Redis
// Redis-struktur:
//   subscriber:{subscriberId}:teams  → SET av teamIds
//   team:{teamId}:subscribers        → SET av subscriberIds

export const config = { runtime: 'edge' };

const KV_URL   = process.env.KV_REST_API_URL;
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

async function redisSAdd(key, ...members) {
  return redisCmd('SADD', key, ...members);
}

async function redisSRem(key, ...members) {
  return redisCmd('SREM', key, ...members);
}

async function redisSMembers(key) {
  return redisCmd('SMEMBERS', key);
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { subscriberId, teamIds, action } = body;

  if (!subscriberId || !teamIds?.length || !action) {
    return new Response('Missing fields', { status: 400 });
  }

  const subKey = `subscriber:${subscriberId}:teams`;

  if (action === 'follow') {
    // Lägg till lag för subscriber
    await redisSAdd(subKey, ...teamIds.map(String));
    // Lägg till subscriber för varje lag
    for (const teamId of teamIds) {
      await redisSAdd(`team:${teamId}:subscribers`, subscriberId);
    }
  }

  if (action === 'unfollow') {
    // Ta bort lag för subscriber
    await redisSRem(subKey, ...teamIds.map(String));
    // Ta bort subscriber från varje lag
    for (const teamId of teamIds) {
      await redisSRem(`team:${teamId}:subscribers`, subscriberId);
    }
  }

  if (action === 'sync') {
    // Hämta nuvarande lag i Redis
    const existing = await redisSMembers(subKey) || [];
    const incoming = teamIds.map(String);

    // Lägg till nya
    const toAdd = incoming.filter(id => !existing.includes(id));
    if (toAdd.length) {
      await redisSAdd(subKey, ...toAdd);
      for (const teamId of toAdd) {
        await redisSAdd(`team:${teamId}:subscribers`, subscriberId);
      }
    }

    // Ta bort borttagna
    const toRemove = existing.filter(id => !incoming.includes(id));
    if (toRemove.length) {
      await redisSRem(subKey, ...toRemove);
      for (const teamId of toRemove) {
        await redisSRem(`team:${teamId}:subscribers`, subscriberId);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, action, teamIds }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
