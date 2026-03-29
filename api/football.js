export const config = { runtime: 'edge' };

// Lag från många olika ligor och länder för global täckning
const GLOBAL_TEAMS = [
  // Premier League
  33, 40, 42, 47, 50, 49, 51, 34, 48, 55,
  // La Liga
  529, 530, 532, 541, 543, 546, 548,
  // Bundesliga
  157, 165, 173, 168, 161, 162,
  // Serie A
  489, 492, 496, 488, 487, 502,
  // Ligue 1
  85, 81, 80, 84, 91,
  // Eredivisie
  194, 197, 210,
  // Primeira Liga
  212, 228, 211,
  // Süper Lig
  611, 614, 612,
  // Saudi Pro League
  2932, 2931, 7007,
  // MLS
  1615, 1603, 1599,
  // Brasileirão
  119, 118, 121,
  // Allsvenskan
  371, 372,
  // Champions League deltagare utanför top 5
  559, 631, 487, 569, // Benfica, PSV, Napoli, Rangers
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
      // Hämta i batchar om 10 lag åt gången för att inte överbelasta
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < GLOBAL_TEAMS.length; i += batchSize) {
        batches.push(GLOBAL_TEAMS.slice(i, i + batchSize));
      }

      const allResponses = await Promise.all(
        batches.map(batch =>
          Promise.all(
            batch.map(id =>
              fetch(`https://v3.football.api-sports.io/transfers?team=${id}`, {
                headers: { 'x-apisports-key': process.env.APISPORTS_KEY }
              }).then(r => r.json()).catch(() => ({ response: [] }))
            )
          )
        )
      );

      const cutoff = new Date('2024-06-01'); // Bara transfers från säsongen 2024/25

      const all = allResponses
        .flat()
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
        const key = `${t.playerId}-${t.date}-${t.to}`;
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
