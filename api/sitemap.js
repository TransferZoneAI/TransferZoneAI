export const config = { runtime: 'edge' };

const BASE_URL = 'https://transferzoneai.com';

// Top ligor (lägg till fler sen)
const LEAGUES = [
  { name: 'Premier League', slug: 'premier-league' },
  { name: 'La Liga', slug: 'la-liga' },
  { name: 'Bundesliga', slug: 'bundesliga' },
  { name: 'Serie A', slug: 'serie-a' },
  { name: 'Ligue 1', slug: 'ligue-1' }
];

// Top klubbar (lägg till fler sen)
const CLUBS = [
  { name: 'Arsenal', slug: 'arsenal' },
  { name: 'Manchester City', slug: 'manchester-city' },
  { name: 'Real Madrid', slug: 'real-madrid' },
  { name: 'Barcelona', slug: 'barcelona' },
  { name: 'Bayern Munich', slug: 'bayern-munich' },
  { name: 'PSG', slug: 'psg' }
];

function url(loc, priority = 0.5, changefreq = 'weekly') {
  return `
  <url>
    <loc>${loc}</loc>
    <priority>${priority}</priority>
    <changefreq>${changefreq}</changefreq>
  </url>`;
}

export default async function handler() {
  let urls = '';

  // 🔹 Core pages
  urls += url(`${BASE_URL}/`, 1.0, 'daily');
  urls += url(`${BASE_URL}/live`, 0.9, 'hourly');
  urls += url(`${BASE_URL}/transfers`, 0.8, 'daily');
  urls += url(`${BASE_URL}/toplists`, 0.7, 'weekly');
  urls += url(`${BASE_URL}/myclubs`, 0.4, 'monthly');

  // 🔹 Leagues
  for (const league of LEAGUES) {
    urls += url(`${BASE_URL}/league/${league.slug}`, 0.8, 'daily');
  }

  // 🔹 Clubs
  for (const club of CLUBS) {
    urls += url(`${BASE_URL}/club/${club.slug}`, 0.7, 'daily');
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml'
    }
  });
}
