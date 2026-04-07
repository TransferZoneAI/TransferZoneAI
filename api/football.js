export const config = { runtime: 'edge' };

const TOP5_TEAMS = [
  33, 40, 42, 47, 50,
  529, 530, 532, 541, 548,
  157, 165, 168, 173, 161,
  489, 492, 496, 488, 487,
  85, 81, 80, 84, 91,
];

async function fetchJSON(url, key) {
  const res = await fetch(url, { headers: { 'x-apisports-key': key } });
  if (!res.ok) throw new Error(`API error ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}

function json(data, cache = 60, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, s-maxage=${cache}`,
    }
  });
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const endpoint = searchParams.get('endpoint');
    const key = process.env.APISPORTS_KEY;
    if (!key) return json({ error: 'Missing APISPORTS_KEY' }, 0, 500);
    if (!endpoint) return json({ error: 'Missing endpoint' }, 0, 400);

    const params = new URLSearchParams(searchParams);
    params.delete('endpoint');

    if (endpoint === 'transfers/global') {
      const today = new Date();
      const cutoff = new Date(today);
      cutoff.setFullYear(today.getFullYear() - 2);

      const responses = await Promise.all(
        TOP5_TEAMS.map(id => fetchJSON(`https://v3.football.api-sports.io/transfers?team=${id}`, key).catch(() => ({ response: [] })))
      );

      const all = responses
        .flatMap(r => r.response || [])
        .flatMap(entry =>
          (entry.transfers || []).map(tr => ({
            player: entry.player?.name ?? '',
            playerId: entry.player?.id ?? 0,
            photo: entry.player?.photo ?? '',
            from: tr.teams?.out?.name ?? '',
            fromLogo: tr.teams?.out?.logo ?? '',
            to: tr.teams?.in?.name ?? '',
            toLogo: tr.teams?.in?.logo ?? '',
            type: tr.type ?? '',
            date: tr.date ?? '',
          }))
        )
        .filter(t => {
          if (!t.player || !t.date) return false;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return false;
          const d = new Date(t.date);
          if (isNaN(d.getTime()) || d > today || d < cutoff) return false;
          return true;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      const seen = new Set();
      const unique = all.filter(t => {
        const k = `${t.playerId}-${t.from}-${t.to}-${t.date}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      return json({ response: unique, results: unique.length }, 3600);
    }

    const url = `https://v3.football.api-sports.io/${endpoint}?${params.toString()}`;
    const res = await fetch(url, { headers: { 'x-apisports-key': key } });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buf);
    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=60',
      }
    });
  } catch (err) {
    return json({ error: err.message }, 0, 500);
  }
}
