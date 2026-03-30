export const config = { runtime: 'edge' };

async function fetchJSON(url, key) {
  const res = await fetch(url, { headers: { 'x-apisports-key': key } });
  const buf = await res.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}

// Handplockade ligor som faktiskt har transfer-data — bred täckning
const EUROPE_LEAGUES = [
  39, 40, 41,       // England: PL, Championship, League One
  140, 141,         // Spanien: La Liga, Segunda
  78, 79,           // Tyskland: Bundesliga, 2. Bundesliga
  135, 136,         // Italien: Serie A, Serie B
  61, 62,           // Frankrike: Ligue 1, Ligue 2
  94, 95,           // Portugal: Primeira Liga, Segunda
  88, 89,           // Belgien: Pro League
  144, 145,         // Nederländerna: Eredivisie, Eerste Div
  113, 114,         // Sverige: Allsvenskan, Superettan
  103, 104,         // Norge: Eliteserien, 1. div
  119, 120,         // Danmark: Superligaen
  203, 204,         // Turkiet: Süper Lig
  235,              // Ryssland: Premier League
  179,              // Skottland: Premiership
  197,              // Grekland: Super League
  207,              // Schweiz: Super League
  218,              // Österrike: Bundesliga
  333,              // Polen: Ekstraklasa
  345,              // Tjeckien: Czech Liga
  357,              // Kroatien: HNL
  291,              // Serbien: Super liga
  244,              // Ukraina: Premier League
  106,              // Finland: Veikkausliiga
  271,              // Rumänien: Liga 1
  169,              // Ungern: NB I
];

const ROTATING_REGIONS = {
  asia: [98, 292, 169, 17, 323, 307],           // J-League, K-League, Saudi, China, India, Qatar
  africa: [233, 288, 200, 263, 265, 299],        // Egypt, S.Africa, Morocco, Nigeria, Tunisia, Algeria
  south_america: [71, 72, 128, 239, 240, 242],   // Brazil, Arg, Colombia, Chile, Ecuador
  north_america: [253, 262, 321],                // MLS, Liga MX, Canada
};

const REGION_NAMES = Object.keys(ROTATING_REGIONS);

export default async function handler(req) {
  const key = process.env.APISPORTS_KEY;
  if (!key) return new Response(JSON.stringify({ error: 'No API key' }), { status: 500 });

  const today = new Date();
  const dayIndex = today.getDate() % REGION_NAMES.length;
  const rotatingRegion = REGION_NAMES[dayIndex];
  const rotatingLeagues = ROTATING_REGIONS[rotatingRegion];

  const allLeagues = [...new Set([...EUROPE_LEAGUES, ...rotatingLeagues])];

  // Hämta utan säsongsfilter — API returnerar senaste data automatiskt
  // Fungerar oavsett säsong, behöver aldrig uppdateras
  const fetchLeague = (lid) =>
    fetchJSON(`https://v3.football.api-sports.io/transfers?league=${lid}`, key)
      .catch(() => ({ response: [] }));

  const batchSize = 15;
  let allResponses = [];

  for (let i = 0; i < allLeagues.length; i += batchSize) {
    const batch = allLeagues.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(lid => fetchLeague(lid)));
    allResponses = allResponses.concat(results);
  }

  // Cutoff: senaste 2 åren
  const cutoff = new Date(today);
  cutoff.setFullYear(today.getFullYear() - 2);

  const all = allResponses
    .flatMap(r => r.response || [])
    .flatMap(entry =>
      (entry.transfers || []).map(tr => ({
        player:   entry.player?.name  ?? '',
        playerId: entry.player?.id    ?? 0,
        photo:    entry.player?.photo ?? '',
        from:     tr.teams?.out?.name ?? '',
        fromLogo: tr.teams?.out?.logo ?? '',
        to:       tr.teams?.in?.name  ?? '',
        toLogo:   tr.teams?.in?.logo  ?? '',
        type:     tr.type ?? '',
        date:     tr.date ?? '',
      }))
    )
    .filter(t => {
      if (!t.date || !t.player) return false;
      // Validera datumformat YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return false;
      const d = new Date(t.date);
      if (isNaN(d.getTime())) return false;
      // Rimlighetskoll: inte i framtiden, inte äldre än 2 år
      if (d > today) return false;
      if (d < cutoff) return false;
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const seen = new Set();
  const unique = all.filter(t => {
    const k = `${t.playerId}-${t.from}-${t.to}-${t.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 200);

  return new Response(JSON.stringify({
    response: unique,
    results: unique.length,
    meta: { region: rotatingRegion, leagues: allLeagues.length }
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, s-maxage=86400',
    }
  });
}
