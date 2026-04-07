export const config = { runtime: 'edge' };

// =========================
// TransferZoneAI API Layer
// =========================

const DEFAULT_CACHE = 'public, s-maxage=120, stale-while-revalidate=300';
const LONG_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';

// Bred transfertäckning inspirerad av din nuvarande transfers-daily.js
const EUROPE_TRANSFER_LEAGUES = [
  39, 40, 41,        // England
  140, 141,          // Spain
  78, 79,            // Germany
  135, 136,          // Italy
  61, 62,            // France
  94, 95,            // Portugal
  88, 89,            // Belgium
  144, 145,          // Netherlands
  113, 114,          // Sweden
  103, 104,          // Norway
  119, 120,          // Denmark
  203, 204,          // Turkey
  235,               // Russia
  179,               // Scotland
  197,               // Greece
  207,               // Switzerland
  218,               // Austria
  333,               // Poland
  345,               // Czechia
  357,               // Croatia
  291,               // Serbia
  244,               // Ukraine
  106,               // Finland
  271,               // Romania
  169,               // Hungary
];

const ROTATING_REGIONS = {
  asia: [98, 292, 17, 323, 307],
  africa: [233, 288, 200, 263, 265, 299],
  south_america: [71, 72, 128, 239, 240, 242],
  north_america: [253, 262, 321],
};

const REGION_NAMES = Object.keys(ROTATING_REGIONS);

// =========================
// Helpers
// =========================

function json(data, status = 200, cache = DEFAULT_CACHE) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': cache,
    }
  });
}

function error(message, status = 500) {
  return json({ error: message }, status, 'no-store');
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function cleanStr(v, fallback = '') {
  return String(v ?? fallback).trim();
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchText(url, key) {
  const res = await fetch(url, {
    headers: { 'x-apisports-key': key }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status} for ${url}${text ? `: ${text}` : ''}`);
  }

  const buf = await res.arrayBuffer();
  return new TextDecoder('utf-8').decode(buf);
}

async function fetchJSON(url, key) {
  const text = await fetchText(url, key);
  return JSON.parse(text);
}

async function apiGet(endpoint, key, params = {}) {
  const qs = new URLSearchParams();

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }

  const url = `https://v3.football.api-sports.io/${endpoint}${qs.toString() ? `?${qs.toString()}` : ''}`;
  return fetchJSON(url, key);
}

function getRotatingTransferLeagues() {
  const today = new Date();
  const dayIndex = today.getDate() % REGION_NAMES.length;
  const regionName = REGION_NAMES[dayIndex];
  return {
    regionName,
    leagueIds: ROTATING_REGIONS[regionName] || [],
  };
}

function parseSeason(searchParams) {
  const season = num(searchParams.get('season'));
  const currentYear = new Date().getFullYear();
  return season > 2000 ? season : currentYear;
}

// =========================
// Rich endpoints
// =========================

async function handleTransfersGlobal(key, searchParams) {
  const limit = Math.min(num(searchParams.get('limit'), 200), 500);
  const yearsBack = Math.min(Math.max(num(searchParams.get('yearsBack'), 2), 1), 5);

  const { regionName, leagueIds: rotatingLeagues } = getRotatingTransferLeagues();
  const allLeagues = [...new Set([...EUROPE_TRANSFER_LEAGUES, ...rotatingLeagues])];

  const batchSize = 15;
  let allResponses = [];

  for (let i = 0; i < allLeagues.length; i += batchSize) {
    const batch = allLeagues.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(lid =>
        apiGet('transfers', key, { league: lid }).catch(() => ({ response: [] }))
      )
    );
    allResponses = allResponses.concat(results);
  }

  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setFullYear(today.getFullYear() - yearsBack);

  const all = allResponses
    .flatMap(r => r.response || [])
    .flatMap(entry =>
      (entry.transfers || []).map(tr => ({
        player: cleanStr(entry.player?.name),
        playerId: num(entry.player?.id),
        photo: cleanStr(entry.player?.photo),
        from: cleanStr(tr.teams?.out?.name),
        fromId: num(tr.teams?.out?.id),
        fromLogo: cleanStr(tr.teams?.out?.logo),
        to: cleanStr(tr.teams?.in?.name),
        toId: num(tr.teams?.in?.id),
        toLogo: cleanStr(tr.teams?.in?.logo),
        type: cleanStr(tr.type, 'Transfer'),
        date: cleanStr(tr.date),
      }))
    )
    .filter(t => {
      if (!t.player || !t.date) return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return false;

      const d = new Date(t.date);
      if (Number.isNaN(d.getTime())) return false;
      if (d > today) return false;
      if (d < cutoff) return false;

      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const unique = uniqBy(all, t => `${t.playerId}-${t.fromId}-${t.toId}-${t.date}`).slice(0, limit);

  return json({
    response: unique,
    results: unique.length,
    meta: {
      region: regionName,
      leagues: allLeagues.length,
      yearsBack,
    }
  }, 200, 'public, s-maxage=3600, stale-while-revalidate=86400');
}

async function handleCountriesList(key) {
  const data = await apiGet('leagues', key, { current: true });

  const countries = uniqBy(
    (data.response || [])
      .map(row => ({
        name: cleanStr(row.country?.name),
        code: cleanStr(row.country?.code),
        flag: cleanStr(row.country?.flag),
      }))
      .filter(c => c.name),
    c => c.name.toLowerCase()
  ).sort((a, b) => a.name.localeCompare(b.name));

  return json({
    response: countries,
    results: countries.length
  }, 200, LONG_CACHE);
}

async function handleLeaguesList(key, searchParams) {
  const country = cleanStr(searchParams.get('country'));
  const search = cleanStr(searchParams.get('search'));
  const current = searchParams.get('current');
  const type = cleanStr(searchParams.get('type'));
  const season = searchParams.get('season');

  const params = {};
  if (country) params.country = country;
  if (search) params.search = search;
  if (current) params.current = current;
  if (type) params.type = type;
  if (season) params.season = season;

  const data = await apiGet('leagues', key, params);

  const leagues = (data.response || [])
    .map(row => ({
      league: {
        id: num(row.league?.id),
        name: cleanStr(row.league?.name),
        type: cleanStr(row.league?.type),
        logo: cleanStr(row.league?.logo),
        season: num(row.seasons?.find(s => s.current)?.year || row.seasons?.slice(-1)?.[0]?.year || season),
      },
      country: {
        name: cleanStr(row.country?.name),
        code: cleanStr(row.country?.code),
        flag: cleanStr(row.country?.flag),
      }
    }))
    .filter(row => row.league.id && row.league.name);

  return json({
    response: leagues,
    results: leagues.length
  }, 200, LONG_CACHE);
}

async function handleTeamsList(key, searchParams) {
  const league = num(searchParams.get('league'));
  const season = parseSeason(searchParams);
  const country = cleanStr(searchParams.get('country'));
  const search = cleanStr(searchParams.get('search'));

  const params = {};
  if (league) {
    params.league = league;
    params.season = season;
  }
  if (country) params.country = country;
  if (search) params.search = search;

  const data = await apiGet('teams', key, params);

  const teams = (data.response || [])
    .map(row => ({
      team: {
        id: num(row.team?.id),
        name: cleanStr(row.team?.name),
        code: cleanStr(row.team?.code),
        country: cleanStr(row.team?.country),
        founded: num(row.team?.founded, null),
        national: !!row.team?.national,
        logo: cleanStr(row.team?.logo),
      },
      venue: {
        id: num(row.venue?.id),
        name: cleanStr(row.venue?.name),
        city: cleanStr(row.venue?.city),
        address: cleanStr(row.venue?.address),
        capacity: num(row.venue?.capacity, null),
        surface: cleanStr(row.venue?.surface),
        image: cleanStr(row.venue?.image),
      }
    }))
    .filter(row => row.team.id && row.team.name);

  return json({
    response: teams,
    results: teams.length
  }, 200, LONG_CACHE);
}

async function handlePlayersSearchGlobal(key, searchParams) {
  const q = cleanStr(searchParams.get('q'));
  const season = parseSeason(searchParams);
  if (!q || q.length < 2) {
    return error('Missing q', 400);
  }

  const variants = [...new Set([
    q,
    q.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  ])];

  const calls = [];
  for (const variant of variants) {
    calls.push(apiGet('players/profiles', key, { search: variant }).catch(() => ({ response: [] })));
    calls.push(apiGet('players', key, { search: variant, season }).catch(() => ({ response: [] })));
    calls.push(apiGet('players', key, { search: variant, season: season - 1 }).catch(() => ({ response: [] })));
    calls.push(apiGet('players', key, { search: variant }).catch(() => ({ response: [] })));
  }

  const responses = await Promise.all(calls);

  const rows = responses
    .flatMap(r => r.response || [])
    .map(item => {
      const player = item.player || item;
      const stats = item.statistics?.[0] || {};
      return {
        player: {
          id: num(player.id),
          name: cleanStr(player.name),
          firstname: cleanStr(player.firstname),
          lastname: cleanStr(player.lastname),
          age: num(player.age, null),
          nationality: cleanStr(player.nationality),
          photo: cleanStr(player.photo),
        },
        statistics: item.statistics || [],
        team: {
          id: num(stats.team?.id),
          name: cleanStr(stats.team?.name),
          logo: cleanStr(stats.team?.logo),
        },
        league: {
          id: num(stats.league?.id),
          name: cleanStr(stats.league?.name),
          logo: cleanStr(stats.league?.logo),
        }
      };
    })
    .filter(row => row.player.id && row.player.name);

  const unique = uniqBy(rows, row => row.player.id).slice(0, 50);

  return json({
    response: unique,
    results: unique.length
  }, 200, DEFAULT_CACHE);
}

async function handleHomeBootstrap(key, searchParams) {
  const season = parseSeason(searchParams);
  const featuredLeagueIds = [39, 140, 135, 78, 61, 179, 113, 94];

  const [leagues, live, next, transfers] = await Promise.all([
    Promise.all(
      featuredLeagueIds.map(id =>
        apiGet('leagues', key, { id, current: true }).then(r => r.response?.[0] || null).catch(() => null)
      )
    ),
    apiGet('fixtures', key, { live: 'all' }).catch(() => ({ response: [] })),
    apiGet('fixtures', key, { next: 12 }).catch(() => ({ response: [] })),
    handleTransfersGlobal(key, new URLSearchParams({ limit: '12' })).then(async res => JSON.parse(await res.text())).catch(() => ({ response: [] })),
  ]);

  const scorerCalls = await Promise.all(
    [39, 140, 135, 78].map(leagueId =>
      apiGet('players/topscorers', key, { league: leagueId, season }).catch(() => ({ response: [] }))
    )
  );

  const scorers = uniqBy(
    scorerCalls.flatMap(r => r.response || []),
    row => num(row.player?.id)
  )
  .slice(0, 12);

  return json({
    response: {
      leagues: leagues.filter(Boolean),
      live: live.response || [],
      upcoming: next.response || [],
      transfers: transfers.response || [],
      scorers,
    }
  }, 200, DEFAULT_CACHE);
}

// =========================
// Main handler
// =========================

export default async function handler(req) {
  try {
    const key = process.env.APISPORTS_KEY;
    if (!key) return error('Missing APISPORTS_KEY', 500);

    const { searchParams } = new URL(req.url);
    const endpoint = cleanStr(searchParams.get('endpoint'));

    if (!endpoint) {
      return error('Missing endpoint', 400);
    }

    if (endpoint === 'transfers/global') {
  try {
    const today = new Date();
    const cutoff = new Date();
    cutoff.setFullYear(today.getFullYear() - 2);

    const limit = Math.min(Number(searchParams.get('limit') || 200), 500);
    const season = new Date().getFullYear();

    const TOP_LEAGUES = [39, 140, 78, 135, 61, 113, 94, 179]; // bra täckning

    // =========================
    // 1. Hämta lag från ligor
    // =========================
    let teams = [];

    const leagueResponses = await Promise.all(
      TOP_LEAGUES.map(l =>
        fetchJSON(`https://v3.football.api-sports.io/teams?league=${l}&season=${season}`, key)
          .catch(() => ({ response: [] }))
      )
    );

    teams = leagueResponses
      .flatMap(r => r.response || [])
      .map(t => t.team?.id)
      .filter(Boolean);

    // limitera så vi inte dödar API
    teams = [...new Set(teams)].slice(0, 80);

    // =========================
    // 2. Hämta transfers per team
    // =========================
    const teamResponses = await Promise.all(
      teams.map(id =>
        fetchJSON(`https://v3.football.api-sports.io/transfers?team=${id}`, key)
          .catch(() => ({ response: [] }))
      )
    );

    // =========================
    // 3. Normalisera
    // =========================
    function validDate(d) {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
      const date = new Date(d);
      if (isNaN(date)) return false;
      if (date > today) return false;
      if (date < cutoff) return false;
      return true;
    }

    const all = teamResponses
      .flatMap(r => r.response || [])
      .flatMap(entry =>
        (entry.transfers || []).map(tr => ({
          player: entry.player?.name ?? '',
          playerId: entry.player?.id ?? 0,
          photo: entry.player?.photo ?? '',
          from: tr.teams?.out?.name ?? '',
          fromId: tr.teams?.out?.id ?? 0,
          fromLogo: tr.teams?.out?.logo ?? '',
          to: tr.teams?.in?.name ?? '',
          toId: tr.teams?.in?.id ?? 0,
          toLogo: tr.teams?.in?.logo ?? '',
          type: tr.type ?? 'Transfer',
          date: tr.date ?? '',
        }))
      )
      .filter(t => t.player && validDate(t.date))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // =========================
    // 4. dedupe
    // =========================
    const seen = new Set();
    const unique = all.filter(t => {
      const k = `${t.playerId}-${t.fromId}-${t.toId}-${t.date}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, limit);

    return new Response(JSON.stringify({
      response: unique,
      results: unique.length,
      meta: {
        source: "teams-from-leagues",
        teamsUsed: teams.length,
        leagues: TOP_LEAGUES.length
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=3600'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

    if (endpoint === 'countries/list') {
      return handleCountriesList(key);
    }

    if (endpoint === 'leagues/list') {
      return handleLeaguesList(key, searchParams);
    }

    if (endpoint === 'teams/list') {
      return handleTeamsList(key, searchParams);
    }

    if (endpoint === 'players/search-global') {
      return handlePlayersSearchGlobal(key, searchParams);
    }

    if (endpoint === 'home/bootstrap') {
      return handleHomeBootstrap(key, searchParams);
    }

    // Standard proxy fallback
    const params = new URLSearchParams(searchParams);
    params.delete('endpoint');

    const text = await fetchText(
      `https://v3.football.api-sports.io/${endpoint}${params.toString() ? `?${params.toString()}` : ''}`,
      key
    );

    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': DEFAULT_CACHE,
      }
    });
  } catch (err) {
    return error(err.message || 'Unknown error', 500);
  }
}
