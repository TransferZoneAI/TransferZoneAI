export const config = { runtime: 'edge' };

const BASE_URL = 'https://transferzoneai.com';

export default function handler() {
  const urls = [
    `${BASE_URL}/`,
    `${BASE_URL}/live`,
    `${BASE_URL}/transfers`,
    `${BASE_URL}/toplists`,
    `${BASE_URL}/myclubs`,
    `${BASE_URL}/league/premier-league`,
    `${BASE_URL}/league/la-liga`,
    `${BASE_URL}/league/bundesliga`,
    `${BASE_URL}/league/serie-a`,
    `${BASE_URL}/league/ligue-1`,
    `${BASE_URL}/club/arsenal`,
    `${BASE_URL}/club/manchester-city`,
    `${BASE_URL}/club/real-madrid`,
    `${BASE_URL}/club/barcelona`,
    `${BASE_URL}/club/bayern-munich`,
    `${BASE_URL}/club/psg`
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `
  <url>
    <loc>${url}</loc>
  </url>
`).join('')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml'
    }
  });
}
