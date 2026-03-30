export const config = { runtime: 'edge' };

async function fetchJSON(url, key) {
  const res = await fetch(url, { headers: { 'x-apisports-key': key } });
  const buf = await res.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}

// Map country -> continent
const CONTINENT = {
  europe: [
    'England','Spain','Germany','Italy','France','Portugal','Netherlands','Belgium',
    'Turkey','Russia','Greece','Switzerland','Austria','Poland','Czech Republic',
    'Croatia','Serbia','Ukraine','Sweden','Norway','Denmark','Finland','Scotland',
    'Romania','Hungary','Slovakia','Slovenia','Bulgaria','Bosnia','Albania',
    'North Macedonia','Montenegro','Belarus','Azerbaijan','Armenia','Georgia',
    'Kazakhstan','Cyprus','Malta','Luxembourg','Iceland','Ireland','Wales',
    'Lithuania','Latvia','Estonia','Moldova','Kosovo','Andorra','Liechtenstein',
    'San Marino','Gibraltar','Faroe Islands',
  ],
  asia: [
    'Saudi Arabia','Japan','South Korea','China','India','Iran','Qatar','UAE',
    'Thailand','Vietnam','Malaysia','Indonesia','Philippines','Singapore',
    'Australia','New Zealand','Uzbekistan','Tajikistan','Kyrgyzstan',
    'Afghanistan','Pakistan','Bangladesh','Sri Lanka','Nepal','Maldives',
    'Myanmar','Cambodia','Laos','Brunei','East Timor','Mongolia',
    'North Korea','Taiwan','Hong Kong','Macau','Palestine','Jordan',
    'Lebanon','Syria','Iraq','Yemen','Oman','Bahrain','Kuwait','Israel',
  ],
  africa: [
    'Egypt','South Africa','Morocco','Nigeria','Tunisia','Algeria','Ghana',
    'Cameroon','Senegal','Ivory Coast','Kenya','Ethiopia','Tanzania','Uganda',
    'Rwanda','Zimbabwe','Zambia','Mozambique','Angola','Congo','DR Congo',
    'Sudan','Libya','Mali','Burkina Faso','Niger','Benin','Togo','Guinea',
    'Sierra Leone','Liberia','Gambia','Mauritania','Cape Verde','Comoros',
    'Madagascar','Mauritius','Reunion','Djibouti','Somalia','Eritrea',
    'Botswana','Namibia','Lesotho','Swaziland','Malawi',
  ],
  south_america: [
    'Brazil','Argentina','Colombia','Chile','Ecuador','Uruguay','Peru',
    'Bolivia','Paraguay','Venezuela','Guyana','Suriname','French Guiana',
  ],
  north_america: [
    'United States','Mexico','Canada','Costa Rica','Panama','Honduras',
    'Guatemala','El Salvador','Nicaragua','Jamaica','Cuba','Haiti',
    'Dominican Republic','Trinidad and Tobago','Barbados','Grenada',
    'Saint Lucia','Antigua and Barbuda','Belize',
  ],
};

const REGION_ORDER = ['europe','asia','africa','south_america','north_america'];

export default async function handler(req) {
  const key = process.env.APISPORTS_KEY;
  if (!key) return new Response(JSON.stringify({ error: 'No API key' }), { status: 500 });

  const today = new Date();
  const season = today.getFullYear() - (today.getMonth() < 6 ? 1 : 0);

  // Hämta ALLA aktiva ligor från API:et
  const leaguesData = await fetchJSON(
    `https://v3.football.api-sports.io/leagues?current=true&season=${season}`,
    key
  ).catch(() => ({ response: [] }));

  const allLeagues = leaguesData.response || [];

  // Gruppera per kontinent baserat på landsnamn
  const byContinent = {};
  for (const [cont, countries] of Object.entries(CONTINENT)) {
    byContinent[cont] = allLeagues
      .filter(l => countries.includes(l.country?.name))
      .map(l => l.league.id);
  }

  // Europa alltid + roterande kontinent
  const dayIndex = today.getDate() % (REGION_ORDER.length - 1); // 0-3
  const rotatingRegion = REGION_ORDER[dayIndex + 1]; // asia, africa, south_america, north_america

  const europeIds = byContinent['europe'] || [];
  const rotatingIds = byContinent[rotatingRegion] || [];
  const leagueIds = [...new Set([...europeIds, ...rotatingIds])];

  console.log(`Fetching ${leagueIds.length} leagues (Europe: ${europeIds.length} + ${rotatingRegion}: ${rotatingIds.length})`);

  // Hämta transfers i batchar om 10
  const batchSize = 10;
  let allResponses = [];
  for (let i = 0; i < leagueIds.length; i += batchSize) {
    const batch = leagueIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(lid =>
        fetchJSON(`https://v3.football.api-sports.io/transfers?league=${lid}&season=${season}`, key)
          .catch(() => ({ response: [] }))
      )
    );
    allResponses = allResponses.concat(results);
  }

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
    .filter(t => t.date && t.player)
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
    meta: {
      europe: europeIds.length,
      rotating: rotatingRegion,
      rotatingCount: rotatingIds.length,
      total: leagueIds.length,
      season
    }
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, s-maxage=86400',
    }
  });
}
