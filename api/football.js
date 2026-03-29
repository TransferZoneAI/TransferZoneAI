export const config = { runtime: 'edge' };

// Top 5 ligor — 5 lag per liga = 25 anrop totalt, snabbt
const TOP5_TEAMS = [
  // Premier League
  33, 40, 42, 47, 50,
  // La Liga
  529, 530, 532, 541, 548,
  // Bundesliga
  157, 165, 168, 173, 161,
  // Serie A
  489, 492, 496, 488, 487,
  // Ligue 1
  85, 81, 80, 84, 91,
];

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint');

  if (!endpoint) {
    return new Response(JSON.stringify({ error: 'Missing endpoint' }), { status: 400 });
  }

  const params = new URLSearchParams(searchParams);
  params.delete('endpoint');

  if (endpoint === 'transfers/global') {
    try {
      const cutoff = new Date('2024-06-01');

      const responses = await Promise.all(
        TOP5_TEAMS.map(id =>
          fetch(`https://v3.football.api-sports.io/transfers?team=${id}`, {
            headers: { 'x-apisports-key': process.env.APISPORTS_KEY }
          }).then(r => r.json()).catch(() => ({ response: [] }))
        )
      );

      const all = responses
        .flatMap(r => r.response || [])
        .flatMap(entry =>
          (entry.transfers || []).map(tr => ({
            player:   entry.player?.name ?? '—',
            playerId: entry.player?.id   ?? 0,
            from:     tr.teams?.out?.name ?? '—',
            to:       tr.teams?.in?.name  ?? '—',
            type:     tr.type ?? '—',
            date:     tr.date ?? '—',
          }))
        )
        .filter(t => t.date !== '—' && new Date(t.date) >= cutoff)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      // Ta bort dubletter
      const seen = new Set();
      const unique = all.filter(t => {
        const key = `${t.playerId}-${t.from}-${t.to}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return new Response(JSON.stringify({ response: unique, results: unique.length }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, s-maxage=3600',
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // Standard endpoint
  const url = `https://v3.football.api-sports.io/${endpoint}?${params.toString()}`;
  try {
    const response = await fetch(url, {
      headers: { 'x-apisports-key': process.env.APISPORTS_KEY }
    });
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=60',
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
