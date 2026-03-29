export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint');

  if (!endpoint) {
    return new Response(JSON.stringify({ error: 'Missing endpoint' }), { status: 400 });
  }

  const params = new URLSearchParams(searchParams);
  params.delete('endpoint');

  // Special case: transfers/global — hämtar från 6 stora ligor parallellt
  if (endpoint === 'transfers/global') {
    const season = params.get('season') || '2024';
    const leagueIds = [39, 140, 78, 135, 61, 94]; // PL, La Liga, Bundesliga, Serie A, Ligue 1, Primeira Liga
    try {
      const responses = await Promise.all(
        leagueIds.map(id =>
          fetch(`https://v3.football.api-sports.io/transfers?league=${id}&season=${season}`, {
            headers: { 'x-apisports-key': process.env.APISPORTS_KEY }
          }).then(r => r.json()).catch(() => ({ response: [] }))
        )
      );
      const merged = responses.flatMap(r => r.response || []);
      return new Response(JSON.stringify({ response: merged, results: merged.length }), {
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
