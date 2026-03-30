export const config = { runtime: 'edge' };

const BASE_URL = 'https://transferzoneai.com';

// Samma slug-logik som i appen
function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .replace(/é/g, 'e')
    .replace(/ü/g, 'u')
    .replace(/ø/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchJSON(url, key) {
  const res = await fetch(url, {
    headers: { 'x-apisports-key': key }
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status} for ${url}`);
  }

  const buf = await res.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buf);
  return JSON.parse(text);
}

function urlTag(loc, priority = '0.5', changefreq = 'weekly') {
  return `
  <url>
    <loc>${loc}</loc>
    <priority>${priority}</priority>
    <changefreq>${changefreq}</changefreq>
  </url>`;
}

// Toppligor
const LEAGUES = [
  'premier-league',
  'la-liga',
  'bundesliga',
  'serie-a',
  'ligue-1'
];

// Topplubbar
const CLUBS = [
  'arsenal',
  'manchester-city',
  'real-madrid',
  'barcelona',
  'bayern-munich',
  'psg'
];

// Lag-ID:n att hämta trupper från
const TOP_TEAMS = [
  33, 40, 42, 47, 50,       // Premier League
  529, 530, 532, 541, 548,  // La Liga
  157, 165, 168, 173, 161,  // Bundesliga
  489, 492, 496, 488, 487,  // Serie A
  85, 81, 80, 84, 91        // Ligue 1
];

export default async function handler() {
  const key = process.env.APISPORTS_KEY;

  if (!key) {
    return new Response('Missing APISPORTS_KEY', { status: 500 });
  }

  const urls = [];

  // Core pages
  urls.push(urlTag(`${BASE_URL}/`, '1.0', 'daily'));
  urls.push(urlTag(`${BASE_URL}/live`, '0.9', 'hourly'));
  urls.push(urlTag(`${BASE_URL}/transfers`, '0.8', 'daily'));
  urls.push(urlTag(`${BASE_URL}/toplists`, '0.7', 'weekly'));
  urls.push(urlTag(`${BASE_URL}/myclubs`, '0.4', 'monthly'));
  urls.push(urlTag(`${BASE_URL}/leagues`, '0.7', 'weekly'));

  // League pages
  for (const league of LEAGUES) {
    urls.push(urlTag(`${BASE_URL}/league/${league}`, '0.8', 'daily'));
  }

  // Club pages
  for (const club of CLUBS) {
    urls.push(urlTag(`${BASE_URL}/club/${club}`, '0.7', 'daily'));
  }

  // Auto players från topplagens trupper
  const seenPlayers = new Set();

  const squadResponses = await Promise.all(
    TOP_TEAMS.map(teamId =>
      fetchJSON(`https://v3.football.api-sports.io/players/squads?team=${teamId}`, key)
        .catch(() => ({ response: [] }))
    )
  );

  for (const squadRes of squadResponses) {
    const players = squadRes?.response?.[0]?.players || [];

    for (const player of players) {
      const name = player?.name || '';
      if (!name) continue;

      const slug = slugify(name);
      if (!slug) continue;

      // Unik per namn-slug för att undvika dubletter i sitemap
      if (seenPlayers.has(slug)) continue;
      seenPlayers.add(slug);

      urls.push(urlTag(`${BASE_URL}/player/${slug}`, '0.6', 'daily'));
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400'
    }
  });
}
