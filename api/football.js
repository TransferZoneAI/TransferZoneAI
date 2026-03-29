export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint');

  if (!endpoint) {
    return new Response(JSON.stringify({ error: 'Missing endpoint' }), { status: 400 });
  }

  const params = new URLSearchParams(searchParams);
  params.delete('endpoint');

  // Global transfers — hämtar från 20 stora lag i olika ligor
  if (endpoint === 'transfers/global') {
    const teamIds = [
      // Premier League
      33, 40, 42, 47, 50,
      // La Liga
      529, 530, 532, 541,
      // Bundesliga
      157, 165, 173,
      // Serie A
      489, 492, 496,
      // Ligue 1
      85, 81,
      // Övriga topplag
      559, 631 // Benfica, PSV
    ];
    try {
      const responses = await Promise.all(
        teamIds.map(id =>
          fetch(`https://v3.football.api-sports.io/transfers?team=${id}`, {
            headers: { 'x-apisports-key': process.env.APISPORTS_KEY }
          }).then(r => r.json()).catch(() => ({ response: [] }))
        )
      );

      // Platta ut och sortera på datum
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
        .filter(t => t.date !== '—')
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      // Ta bort dubletter (samma spelare+datum)
      const seen = new Set();
      const unique = all.filter(t => {
        const key = `${t.playerId}-${t.date}`;
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
