const API = '/api/football';
const CURRENT_SEASON = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const TOP_LEAGUES = [
  { id: 39, name: 'Premier League', country: 'England' },
  { id: 140, name: 'La Liga', country: 'Spain' },
  { id: 78, name: 'Bundesliga', country: 'Germany' },
  { id: 135, name: 'Serie A', country: 'Italy' },
  { id: 61, name: 'Ligue 1', country: 'France' },
  { id: 113, name: 'Allsvenskan', country: 'Sweden' },
  { id: 94, name: 'Primeira Liga', country: 'Portugal' },
  { id: 179, name: 'Premiership', country: 'Scotland' }
];

const state = {
  myClubs: JSON.parse(localStorage.getItem('tz_myclubs') || '[]'),
  searchTimer: null,
  searchOpen: false,
  transfers: [],
};

function saveMyClubs() {
  localStorage.setItem('tz_myclubs', JSON.stringify(state.myClubs));
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function slugify(str = '') {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDate(dateStr = '') {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr || '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr = '') {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr || '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function avatar(url, alt = '') {
  return `<div class="avatar">${url ? `<img src="${url}" alt="${escapeHtml(alt)}" />` : '👤'}</div>`;
}
function teamLogo(url, alt = '') {
  return `<div class="team-logo">${url ? `<img src="${url}" alt="${escapeHtml(alt)}" />` : '⚽'}</div>`;
}

async function apiFetch(endpoint, params = {}) {
  const query = new URLSearchParams({ endpoint, ...params });
  const res = await fetch(`${API}?${query.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API failed: ${res.status} ${text}`);
  }
  return res.json();
}

function appShell(content, active = '/') {
  const nav = [
    ['/', 'Home'],
    ['/transfers', 'Transfers'],
    ['/live', 'Live'],
    ['/leagues', 'Leagues'],
    ['/toplists', 'Toplists'],
    ['/myclubs', 'My Clubs'],
    ['/assistant', 'AI']
  ].map(([href, label]) => `<a class="nav-link ${active === href ? 'active' : ''}" href="${href}" data-link>${label}</a>`).join('');

  return `
    <header class="topbar">
      <div class="container topbar-inner">
        <a class="brand" href="/" data-link>
          <div class="brand-mark"><img src="/transferzoneai-logo-192.png" alt="TransferZoneAI" /></div>
          <div class="brand-name">TransferZone<span>AI</span></div>
        </a>
        <nav class="nav">${nav}</nav>
        <div class="searchbar">
          <input id="global-search" placeholder="Search player, club or league" autocomplete="off" />
          <button id="search-button">⌕</button>
          <div id="search-results" class="search-results"></div>
        </div>
      </div>
    </header>
    <main class="container">${content}</main>
    <footer class="container footer">TransferZoneAI — rebuilt with a new frontend architecture, cleaner data flows and stronger football pages.</footer>
  `;
}

function loadingPage() {
  return `<div class="page"><div class="card"><div class="loading">Loading...</div></div></div>`;
}

function card(title, body, action = '') {
  return `<section class="card"><div class="card-head"><h2 class="section-title">${title}</h2>${action}</div>${body}</section>`;
}

function setApp(content, active) {
  document.getElementById('app').innerHTML = appShell(content, active);
  bindShell();
}

function navigate(path) {
  history.pushState({}, '', path);
  router();
}

window.addEventListener('popstate', router);
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-link]');
  if (!link) return;
  e.preventDefault();
  navigate(link.getAttribute('href'));
});

document.addEventListener('click', async (e) => {
  const followBtn = e.target.closest('[data-follow-team]');
  if (!followBtn) return;
  const teamId = Number(followBtn.dataset.followTeam || 0);
  const teamName = followBtn.dataset.teamName || 'Club';
  if (!teamId) return;
  await toggleFollow(teamId, teamName);
});

function getSubscriberId() {
  let id = localStorage.getItem('tz_subscriber_id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `tz_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('tz_subscriber_id', id);
  }
  return id;
}

async function toggleFollow(teamId, teamName) {
  const exists = state.myClubs.find((c) => c.id === teamId);
  const subscriberId = getSubscriberId();
  const action = exists ? 'remove' : 'add';
  try {
    await fetch('/api/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriberId, action, teamIds: [teamId] })
    });
  } catch {}

  if (exists) {
    state.myClubs = state.myClubs.filter((c) => c.id !== teamId);
  } else {
    state.myClubs.push({ id: teamId, name: teamName });
  }
  saveMyClubs();
  router();
}

function followButton(teamId, teamName) {
  const followed = state.myClubs.some((c) => c.id === Number(teamId));
  return `<button class="btn ${followed ? '' : 'primary'}" data-follow-team="${teamId}" data-team-name="${escapeHtml(teamName)}">${followed ? 'Following' : 'Follow club'}</button>`;
}

async function bindShell() {
  const input = document.getElementById('global-search');
  const results = document.getElementById('search-results');
  const button = document.getElementById('search-button');
  if (!input || !results || !button) return;

  const runSearch = async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      results.classList.remove('open');
      results.innerHTML = '';
      return;
    }

    try {
      const [playersRes, teamsRes, leaguesRes] = await Promise.all([
        apiFetch('players/profiles', { search: q }).catch(() => ({ response: [] })),
        apiFetch('teams', { search: q }).catch(() => ({ response: [] })),
        apiFetch('leagues', { search: q, current: 'true' }).catch(() => ({ response: [] }))
      ]);

      const players = (playersRes.response || []).slice(0, 4).map((p) => ({
        type: 'player',
        label: p.player?.name || 'Player',
        sub: p.statistics?.[0]?.team?.name || p.player?.nationality || '',
        image: p.player?.photo || '',
        href: `/player/${slugify(p.player?.name || 'player')}-${p.player?.id}`
      }));

      const teams = (teamsRes.response || []).slice(0, 4).map((t) => ({
        type: 'club',
        label: t.team?.name || 'Club',
        sub: t.team?.country || '',
        image: t.team?.logo || '',
        href: `/club/${slugify(t.team?.name || 'club')}-${t.team?.id}`
      }));

      const leagues = (leaguesRes.response || []).slice(0, 4).map((l) => ({
        type: 'league',
        label: l.league?.name || 'League',
        sub: l.country?.name || '',
        image: l.league?.logo || '',
        href: `/league/${slugify(l.league?.name || 'league')}-${l.league?.id}`
      }));

      const merged = [...players, ...teams, ...leagues].slice(0, 10);
      if (!merged.length) {
        results.innerHTML = `<div class="search-item"><div class="search-avatar">?</div><div>No results</div><div class="pill">Search</div></div>`;
      } else {
        results.innerHTML = merged.map((item) => `
          <div class="search-item" data-go="${item.href}">
            <div class="search-avatar">${item.image ? `<img src="${item.image}" alt="${escapeHtml(item.label)}">` : '•'}</div>
            <div>
              <div><strong>${escapeHtml(item.label)}</strong></div>
              <div class="muted">${escapeHtml(item.sub)}</div>
            </div>
            <div class="pill">${escapeHtml(item.type)}</div>
          </div>
        `).join('');
      }
      results.classList.add('open');
    } catch {
      results.innerHTML = `<div class="search-item"><div class="search-avatar">!</div><div>Search failed</div><div class="pill">Error</div></div>`;
      results.classList.add('open');
    }
  };

  input.oninput = () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(runSearch, 260);
  };
  button.onclick = runSearch;
  results.onclick = (e) => {
    const row = e.target.closest('[data-go]');
    if (!row) return;
    results.classList.remove('open');
    navigate(row.dataset.go);
  };
}

function renderFeaturedPlayer(item) {
  if (!item) {
    return `<div class="side-card"><h3 class="side-title">Featured <span>Player</span></h3><div class="empty">No featured player available.</div></div>`;
  }
  const p = item.player || {};
  const s = item.statistics?.[0] || {};
  return `
    <a class="side-card" href="/player/${slugify(p.name || 'player')}-${p.id}" data-link>
      <h3 class="side-title">Featured <span>Player</span></h3>
      <div class="featured-top">
        <div class="featured-photo">${p.photo ? `<img src="${p.photo}" alt="${escapeHtml(p.name || '')}" />` : ''}</div>
        <div>
          <div class="featured-name">${escapeHtml(p.name || 'Player')}</div>
          <div class="muted">${escapeHtml(s.team?.name || '')}</div>
          <div class="muted">${escapeHtml(s.league?.name || '')}</div>
        </div>
      </div>
      <div class="featured-stats">
        <div class="featured-stat"><small>Goals</small><strong>${s.goals?.total ?? 0}</strong></div>
        <div class="featured-stat"><small>Assists</small><strong>${s.goals?.assists ?? 0}</strong></div>
        <div class="featured-stat"><small>Apps</small><strong>${s.games?.appearences ?? 0}</strong></div>
      </div>
    </a>
  `;
}

function renderTransferList(transfers) {
  if (!transfers.length) return `<div class="empty">No transfer data right now.</div>`;
  return `<div class="transfer-list">${transfers.map((t) => {
    const href = t.playerId ? `/player/${slugify(t.player)}-${t.playerId}` : '/transfers';
    return `
      <a class="transfer-item" href="${href}" data-link>
        ${avatar(t.photo || '', t.player || '')}
        <div class="transfer-copy">
          <div><strong>${escapeHtml(t.player || 'Transfer')}</strong></div>
          <div class="transfer-route">
            <span style="display:inline-flex;align-items:center;gap:6px;">${t.fromLogo ? `<img src="${t.fromLogo}" alt="" style="width:16px;height:16px;border-radius:50%;">` : ''}<span>${escapeHtml(t.from || 'Unknown club')}</span></span>
            <span style="color:var(--gold);font-weight:900;">→</span>
            <span style="display:inline-flex;align-items:center;gap:6px;">${t.toLogo ? `<img src="${t.toLogo}" alt="" style="width:16px;height:16px;border-radius:50%;">` : ''}<span>${escapeHtml(t.to || 'Unknown club')}</span></span>
          </div>
          <div class="muted small">${escapeHtml(formatDate(t.date || ''))}</div>
        </div>
        <div class="transfer-type">${escapeHtml(t.type || 'Transfer')}</div>
      </a>
    `;
  }).join('')}</div>`;
}

async function renderHome() {
  setApp(loadingPage(), '/');
  try {
    const [liveRes, transfersRes, scorerRes] = await Promise.all([
      apiFetch('fixtures', { live: 'all' }).catch(() => ({ response: [] })),
      apiFetch('transfers/global').catch(() => ({ response: [] })),
      apiFetch('players/topscorers', { league: 39, season: CURRENT_SEASON }).catch(() => ({ response: [] }))
    ]);
    const live = (liveRes.response || []).slice(0, 6);
    const transfers = (transfersRes.response || []).slice(0, 6);
    const scorers = (scorerRes.response || []).slice(0, 8);
    state.transfers = transfers;

    const liveMarkup = live.length ? `<div class="list">${live.map((m) => {
      const home = m.teams?.home || {};
      const away = m.teams?.away || {};
      const status = m.fixture?.status?.short || 'LIVE';
      const elapsed = m.fixture?.status?.elapsed ? `${m.fixture.status.elapsed}'` : '';
      return `
        <a class="row" href="/match/${m.fixture?.id}" data-link>
          <div class="live-row">
            <div class="team-line">${teamLogo(home.logo, home.name)}<div class="team-copy"><strong>${escapeHtml(home.name || 'Home')}</strong><div class="muted">${escapeHtml(m.league?.name || '')}</div></div></div>
            <div class="match-mid"><div class="score">${m.goals?.home ?? 0} - ${m.goals?.away ?? 0}</div><div class="status-pill live">${escapeHtml(status)}</div></div>
            <div class="team-line right"><div class="team-copy"><strong>${escapeHtml(away.name || 'Away')}</strong><div class="muted">${escapeHtml(elapsed)}</div></div>${teamLogo(away.logo, away.name)}</div>
          </div>
        </a>`;
    }).join('')}</div>` : `<div class="empty">No live matches right now.</div>`;

    const scorersMarkup = scorers.length ? `<div class="panel-list">${scorers.map((s, idx) => `
      <a class="player-mini" href="/player/${slugify(s.player?.name || 'player')}-${s.player?.id}" data-link style="display:grid;grid-template-columns:42px 1fr auto;gap:12px;align-items:center;">
        <div class="pill" style="width:42px;height:42px;padding:0;border-radius:50%;justify-content:center;color:#07111f;background:linear-gradient(180deg,var(--gold-2),var(--gold));">${idx + 1}</div>
        <div><div><strong>${escapeHtml(s.player?.name || '')}</strong></div><div class="muted">${escapeHtml(s.statistics?.[0]?.team?.name || '')}</div></div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:38px;color:var(--gold);line-height:1;">${s.statistics?.[0]?.goals?.total ?? 0}</div>
      </a>`).join('')}</div>` : `<div class="empty">No scorer data available.</div>`;

    const quickLinks = `<div class="list">${TOP_LEAGUES.slice(0, 6).map((l) => `
      <a class="quick-link" href="/league/${slugify(l.name)}-${l.id}" data-link><div class="avatar">🏆</div><div><div><strong>${escapeHtml(l.name)}</strong></div><div class="muted">${escapeHtml(l.country)}</div></div><div class="pill">League</div></a>`).join('')}</div>`;

    const content = `
      <div class="page">
        <section class="hero-grid">
          <div class="hero-card">
            <div class="hero-kicker">Football intelligence</div>
            <h1 class="hero-title">Transfermarkt style.<br><span>Cleaner. Faster. Better.</span></h1>
            <p class="hero-sub">A complete football intelligence hub for clubs, players, leagues, transfers, live scores and match pages — rebuilt with a cleaner design system and stronger routing.</p>
            <div class="hero-actions">
              <a class="btn primary" href="/transfers" data-link>Explore transfers</a>
              <a class="btn" href="/live" data-link>Open live centre</a>
            </div>
            <div class="kpis">
              <div class="kpi"><div class="kpi-label">Live matches</div><div class="kpi-value">${live.length}</div></div>
              <div class="kpi"><div class="kpi-label">Transfers</div><div class="kpi-value">${transfers.length}</div></div>
              <div class="kpi"><div class="kpi-label">Top scorers</div><div class="kpi-value">${scorers.length}</div></div>
              <div class="kpi"><div class="kpi-label">Followed clubs</div><div class="kpi-value">${state.myClubs.length}</div></div>
            </div>
          </div>
          <div class="hero-side">${renderFeaturedPlayer(scorers[0])}</div>
        </section>
        <section class="main-grid">
          <div class="stack">
            ${card('Live <span>Matches</span>', liveMarkup)}
            ${card('Top <span>Scorers</span>', scorersMarkup)}
          </div>
          <div class="stack">
            ${card('Latest <span>Transfers</span>', renderTransferList(transfers), `<a href="/transfers" data-link class="pill">Open all</a>`)}
            ${card('Quick <span>Links</span>', quickLinks)}
          </div>
        </section>
      </div>`;
    setApp(content, '/');
  } catch (err) {
    setApp(`<div class="page"><div class="card"><div class="error">${escapeHtml(err.message)}</div></div></div>`, '/');
  }
}

async function renderTransfers() {
  setApp(loadingPage(), '/transfers');
  try {
    const data = await apiFetch('transfers/global');
    const transfers = data.response || [];
    state.transfers = transfers;
    const content = `
      <div class="page">
        <section class="entity-hero">
          <div class="entity-head">
            <div class="entity-logo">💸</div>
            <div>
              <div class="entity-type">Transfer centre</div>
              <div class="entity-title">Latest <span>Transfers</span></div>
              <div class="entity-meta"><div class="tag">Rich transfer feed</div><div class="tag">Club logos</div><div class="tag">Real player links</div></div>
            </div>
            <div class="pill">${transfers.length} items</div>
          </div>
        </section>
        <section class="page-layout">
          <div class="stack">${card('Transfer <span>Feed</span>', renderTransferList(transfers))}</div>
          <div class="stack">
            ${card('About <span>Coverage</span>', `<div class="muted">Transfers are aggregated across major European leagues plus rotating regional coverage, deduplicated and sorted by date.</div>`)}
            ${card('Pages <span>Nearby</span>', `<div class="list"><a class="quick-link" href="/live" data-link><div class="avatar">🔴</div><div><strong>Live centre</strong><div class="muted">Now playing</div></div><div class="pill">Open</div></a><a class="quick-link" href="/toplists" data-link><div class="avatar">📊</div><div><strong>Toplists</strong><div class="muted">Scorers & assists</div></div><div class="pill">Open</div></a></div>`)}
          </div>
        </section>
      </div>`;
    setApp(content, '/transfers');
  } catch (err) {
    setApp(`<div class="page"><div class="card"><div class="error">${escapeHtml(err.message)}</div></div></div>`, '/transfers');
  }
}

async function renderLive() {
  setApp(loadingPage(), '/live');
  try {
    const liveRes = await apiFetch('fixtures', { live: 'all' });
    const live = liveRes.response || [];
    const feed = live.length ? `<div class="list">${live.map((m) => `
      <a class="row" href="/match/${m.fixture?.id}" data-link>
        <div class="live-row">
          <div class="team-line">${teamLogo(m.teams?.home?.logo, m.teams?.home?.name)}<div class="team-copy"><strong>${escapeHtml(m.teams?.home?.name || '')}</strong><div class="muted">${escapeHtml(m.league?.name || '')}</div></div></div>
          <div class="match-mid"><div class="score">${m.goals?.home ?? 0} - ${m.goals?.away ?? 0}</div><div class="status-pill live">${escapeHtml(m.fixture?.status?.short || 'LIVE')}</div></div>
          <div class="team-line right"><div class="team-copy"><strong>${escapeHtml(m.teams?.away?.name || '')}</strong><div class="muted">${escapeHtml(m.fixture?.status?.elapsed ? `${m.fixture.status.elapsed}'` : '')}</div></div>${teamLogo(m.teams?.away?.logo, m.teams?.away?.name)}</div>
        </div>
      </a>`).join('')}</div>` : `<div class="empty">No live matches right now.</div>`;

    const content = `<div class="page"><section class="entity-hero"><div class="entity-head"><div class="entity-logo">🔴</div><div><div class="entity-type">Live centre</div><div class="entity-title">Live <span>Matches</span></div><div class="entity-meta"><div class="tag">Real-time scores</div><div class="tag">Fast refresh via API</div></div></div><div class="pill">${live.length} live</div></div></section><section class="page-layout"><div class="stack">${card('Matches <span>Now</span>', feed)}</div><div class="stack">${card('Followed <span>Clubs</span>', await renderMyClubFeed(true))}</div></section></div>`;
    setApp(content, '/live');
  } catch (err) {
    setApp(`<div class="page"><div class="card"><div class="error">${escapeHtml(err.message)}</div></div></div>`, '/live');
  }
}

async function renderLeagues() {
  setApp(loadingPage(), '/leagues');
  try {
    const rows = await Promise.all(TOP_LEAGUES.map(async (l) => {
      const info = await apiFetch('standings', { league: l.id, season: CURRENT_SEASON }).catch(() => ({ response: [] }));
      const table = info.response?.[0]?.league?.standings?.[0] || [];
      return { ...l, clubs: table.length, leader: table[0]?.team?.name || '—' };
    }));
    const body = `<div class="table-wrap"><table><thead><tr><th>League</th><th>Country</th><th class="center">Clubs</th><th>Leader</th></tr></thead><tbody>${rows.map((l) => `<tr><td><a href="/league/${slugify(l.name)}-${l.id}" data-link>${escapeHtml(l.name)}</a></td><td>${escapeHtml(l.country)}</td><td class="center">${l.clubs}</td><td>${escapeHtml(l.leader)}</td></tr>`).join('')}</tbody></table></div>`;
    setApp(`<div class="page">${card('Top <span>Leagues</span>', body)}</div>`, '/leagues');
  } catch (err) {
    setApp(`<div class="page"><div class="card"><div class="error">${escapeHtml(err.message)}</div></div></div>`, '/leagues');
  }
}

async function renderLeague(path) {
  setApp(loadingPage(), '');
  const id = Number(path.split('-').pop());
  try {
    const [standingsRes, scorersRes, assistsRes, fixturesRes, leagueInfoRes] = await Promise.all([
      apiFetch('standings', { league: id, season: CURRENT_SEASON }).catch(() => ({ response: [] })),
      apiFetch('players/topscorers', { league: id, season: CURRENT_SEASON }).catch(() => ({ response: [] })),
      apiFetch('players/topassists', { league: id, season: CURRENT_SEASON }).catch(() => ({ response: [] })),
      apiFetch('fixtures', { league: id, season: CURRENT_SEASON, next: 10 }).catch(() => ({ response: [] })),
      apiFetch('leagues', { id, current: 'true' }).catch(() => ({ response: [] }))
    ]);

    const leagueInfo = leagueInfoRes.response?.[0] || {};
    const table = standingsRes.response?.[0]?.league?.standings?.[0] || [];
    const scorers = scorersRes.response || [];
    const assists = assistsRes.response || [];
    const fixtures = fixturesRes.response || [];
    const bodyTable = table.length ? `<div class="table-wrap"><table><thead><tr><th class="center">#</th><th>Club</th><th class="center">Pts</th><th class="center">P</th><th class="center">GD</th></tr></thead><tbody>${table.map((row) => `<tr><td class="center">${row.rank}</td><td><a href="/club/${slugify(row.team?.name || 'club')}-${row.team?.id}" data-link>${escapeHtml(row.team?.name || '')}</a></td><td class="center">${row.points}</td><td class="center">${row.all?.played ?? 0}</td><td class="center">${row.goalsDiff ?? 0}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">No standings found.</div>`;
    const scorerBody = scorers.length ? `<div class="panel-list">${scorers.slice(0, 8).map((s, i) => `<a class="player-mini" href="/player/${slugify(s.player?.name || 'player')}-${s.player?.id}" data-link style="display:grid;grid-template-columns:42px 1fr auto;gap:12px;align-items:center;"><div class="pill" style="width:42px;height:42px;padding:0;border-radius:50%;justify-content:center;color:#07111f;background:linear-gradient(180deg,var(--gold-2),var(--gold));">${i + 1}</div><div><strong>${escapeHtml(s.player?.name || '')}</strong><div class="muted">${escapeHtml(s.statistics?.[0]?.team?.name || '')}</div></div><div style="font-family:'Barlow Condensed',sans-serif;font-size:34px;color:var(--gold);">${s.statistics?.[0]?.goals?.total ?? 0}</div></a>`).join('')}</div>` : `<div class="empty">No scorer data.</div>`;
    const assistBody = assists.length ? `<div class="panel-list">${assists.slice(0, 8).map((s, i) => `<a class="player-mini" href="/player/${slugify(s.player?.name || 'player')}-${s.player?.id}" data-link style="display:grid;grid-template-columns:42px 1fr auto;gap:12px;align-items:center;"><div class="pill" style="width:42px;height:42px;padding:0;border-radius:50%;justify-content:center;color:#07111f;background:linear-gradient(180deg,var(--gold-2),var(--gold));">${i + 1}</div><div><strong>${escapeHtml(s.player?.name || '')}</strong><div class="muted">${escapeHtml(s.statistics?.[0]?.team?.name || '')}</div></div><div style="font-family:'Barlow Condensed',sans-serif;font-size:34px;color:var(--gold);">${s.statistics?.[0]?.goals?.assists ?? 0}</div></a>`).join('')}</div>` : `<div class="empty">No assist data.</div>`;
    const fixtureBody = fixtures.length ? `<div class="list">${fixtures.map((f) => `<a class="row" href="/match/${f.fixture?.id}" data-link><div class="live-row"><div class="team-line">${teamLogo(f.teams?.home?.logo, f.teams?.home?.name)}<div class="team-copy"><strong>${escapeHtml(f.teams?.home?.name || '')}</strong><div class="muted">${escapeHtml(formatDateTime(f.fixture?.date || ''))}</div></div></div><div class="match-mid"><div class="pill">vs</div></div><div class="team-line right"><div class="team-copy"><strong>${escapeHtml(f.teams?.away?.name || '')}</strong><div class="muted">${escapeHtml(f.league?.round || '')}</div></div>${teamLogo(f.teams?.away?.logo, f.teams?.away?.name)}</div></div></a>`).join('')}</div>` : `<div class="empty">No upcoming fixtures.</div>`;

    const content = `
      <div class="page">
        <section class="entity-hero"><div class="entity-head"><div class="entity-logo">${leagueInfo.league?.logo ? `<img src="${leagueInfo.league.logo}" alt="">` : '🏆'}</div><div><div class="entity-type">League profile</div><div class="entity-title">${escapeHtml(leagueInfo.league?.name || 'League')}</div><div class="entity-meta"><div class="tag">${escapeHtml(leagueInfo.country?.name || '')}</div><div class="tag">Season ${CURRENT_SEASON}</div><div class="tag">${table.length} clubs</div></div></div><div class="pill">League</div></div></section>
        <section class="page-layout">
          <div class="stack">${card('League <span>Table</span>', bodyTable)}${card('Upcoming <span>Fixtures</span>', fixtureBody)}</div>
          <div class="stack">${card('Top <span>Scorers</span>', scorerBody)}${card('Top <span>Assists</span>', assistBody)}</div>
        </section>
      </div>`;
    setApp(content, '');
  } catch (err) {
    setApp(`<div class="page"><div class="card"><div class="error">${escapeHtml(err.message)}</div></div></div>`, '');
  }
}

async function renderClub(path) {
  setApp(loadingPage(), '');
  const id = Number(path.split('-').pop());
  try {
    const [teamsRes, squadRes, fixturesNextRes, fixturesLastRes, transferRes] = await Promise.all([
      apiFetch('teams', { id }).catch(() => ({ response: [] })),
      apiFetch('players/squads', { team: id }).catch(() => ({ response: [] })),
      apiFetch('fixtures', { team: id, next: 8 }).catch(() => ({ response: [] })),
      apiFetch('fixtures', { team: id, last: 8 }).catch(() => ({ response: [] })),
      apiFetch('transfers', { team: id }).catch(() => ({ response: [] }))
    ]);
    const row = teamsRes.response?.[0] || {};
    const team = row.team || {};
    const venue = row.venue || {};
    const squad = squadRes.response?.[0]?.players || [];
    const upcoming = fixturesNextRes.response || [];
    const results = fixturesLastRes.response || [];
    const transfers = (transferRes.response || []).flatMap((entry) => (entry.transfers || []).slice(0,1).map((tr) => ({
      player: entry.player?.name || 'Player', playerId: entry.player?.id || 0, photo: entry.player?.photo || '',
      from: tr.teams?.out?.name || '', fromLogo: tr.teams?.out?.logo || '', to: tr.teams?.in?.name || '', toLogo: tr.teams?.in?.logo || '',
      type: tr.type || 'Transfer', date: tr.date || ''
    }))).slice(0, 12);

    const squadBody = squad.length ? `<div class="table-wrap"><table><thead><tr><th>Player</th><th>Position</th><th class="center">Age</th><th class="right">Height</th></tr></thead><tbody>${squad.map((p) => `<tr><td><a href="/player/${slugify(p.name || 'player')}-${p.id}" data-link>${escapeHtml(p.name || '')}</a></td><td>${escapeHtml(p.position || '')}</td><td class="center">${p.age ?? '—'}</td><td class="right">${escapeHtml(p.height || '—')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">No squad data.</div>`;

    const upcomingBody = upcoming.length ? `<div class="list">${upcoming.map((f) => `<a class="row" href="/match/${f.fixture?.id}" data-link><div class="live-row"><div class="team-line">${teamLogo(f.teams?.home?.logo, f.teams?.home?.name)}<div class="team-copy"><strong>${escapeHtml(f.teams?.home?.name || '')}</strong><div class="muted">${escapeHtml(formatDateTime(f.fixture?.date || ''))}</div></div></div><div class="match-mid"><div class="pill">vs</div></div><div class="team-line right"><div class="team-copy"><strong>${escapeHtml(f.teams?.away?.name || '')}</strong><div class="muted">${escapeHtml(f.league?.name || '')}</div></div>${teamLogo(f.teams?.away?.logo, f.teams?.away?.name)}</div></div></a>`).join('')}</div>` : `<div class="empty">No upcoming fixtures.</div>`;
    const resultBody = results.length ? `<div class="list">${results.map((f) => `<a class="row" href="/match/${f.fixture?.id}" data-link><div class="live-row"><div class="team-line">${teamLogo(f.teams?.home?.logo, f.teams?.home?.name)}<div class="team-copy"><strong>${escapeHtml(f.teams?.home?.name || '')}</strong><div class="muted">${escapeHtml(f.league?.name || '')}</div></div></div><div class="match-mid"><div class="score">${f.goals?.home ?? 0} - ${f.goals?.away ?? 0}</div><div class="status-pill">FT</div></div><div class="team-line right"><div class="team-copy"><strong>${escapeHtml(f.teams?.away?.name || '')}</strong><div class="muted">${escapeHtml(formatDate(f.fixture?.date || ''))}</div></div>${teamLogo(f.teams?.away?.logo, f.teams?.away?.name)}</div></div></a>`).join('')}</div>` : `<div class="empty">No recent matches.</div>`;

    const content = `
      <div class="page">
        <section class="entity-hero">
          <div class="entity-head">
            <div class="entity-logo">${team.logo ? `<img src="${team.logo}" alt="${escapeHtml(team.name || '')}">` : '🏟️'}</div>
            <div>
              <div class="entity-type">Club profile</div>
              <div class="entity-title">${escapeHtml(team.name || 'Club')}</div>
              <div class="entity-meta"><div class="tag">${escapeHtml(team.country || '')}</div><div class="tag">Founded ${team.founded || '—'}</div><div class="tag">${escapeHtml(venue.name || 'Unknown stadium')}</div></div>
            </div>
            ${followButton(team.id, team.name || 'Club')}
          </div>
        </section>
        <section class="page-layout">
          <div class="stack">
            <div class="meta-grid">
              <div class="meta-box"><small>Stadium</small><strong>${escapeHtml(venue.name || '—')}</strong></div>
              <div class="meta-box"><small>Capacity</small><strong>${venue.capacity || '—'}</strong></div>
              <div class="meta-box"><small>City</small><strong>${escapeHtml(venue.city || '—')}</strong></div>
              <div class="meta-box"><small>Squad size</small><strong>${squad.length}</strong></div>
            </div>
            ${card('Squad <span>List</span>', squadBody)}
            ${card('Recent <span>Results</span>', resultBody)}
          </div>
          <div class="stack">
            ${card('Upcoming <span>Fixtures</span>', upcomingBody)}
            ${card('Latest <span>Transfers</span>', renderTransferList(transfers))}
          </div>
        </section>
      </div>`;
    setApp(content, '');
  } catch (err) {
    setApp(`<div class="page"><div class="card"><div class="error">${escapeHtml(err.message)}</div></div></div>`, '');
  }
}

async function renderPlayer(path) {
  setApp(loadingPage(), '');
  const id = Number(path.split('-').pop());
  try {
    const [playerRes, transferRes] = await Promise.all([
      apiFetch('players', { id, season: CURRENT_SEASON }).catch(() => ({ response: [] })),
      apiFetch('transfers', { player: id }).catch(() => ({ response: [] }))
    ]);
    const item = playerRes.response?.[0];
    if (!item) throw new Error('Player not found');
    const p = item.player || {};
    const s = item.statistics?.[0] || {};
    const transferRows = (transferRes.response?.[0]?.transfers || []).map((tr) => ({
      player: p.name || 'Player', playerId: p.id || 0, photo: p.photo || '',
      from: tr.teams?.out?.name || '', fromLogo: tr.teams?.out?.logo || '',
      to: tr.teams?.in?.name || '', toLogo: tr.teams?.in?.logo || '', type: tr.type || 'Transfer', date: tr.date || ''
    }));

    const content = `
      <div class="page">
        <section class="entity-hero">
          <div class="entity-head">
            <div class="entity-logo">${p.photo ? `<img src="${p.photo}" alt="${escapeHtml(p.name || '')}">` : '👤'}</div>
            <div>
              <div class="entity-type">Player profile</div>
              <div class="entity-title">${escapeHtml(p.name || 'Player')}</div>
              <div class="entity-meta"><div class="tag">${escapeHtml(p.nationality || '')}</div><div class="tag">${escapeHtml(s.team?.name || '')}</div><div class="tag">${escapeHtml(s.games?.position || '')}</div></div>
            </div>
            <a class="btn" href="/club/${slugify(s.team?.name || 'club')}-${s.team?.id}" data-link>Open club</a>
          </div>
        </section>
        <section class="page-layout">
          <div class="stack">
            <div class="meta-grid">
              <div class="meta-box"><small>Age</small><strong>${p.age ?? '—'}</strong></div>
              <div class="meta-box"><small>Height</small><strong>${escapeHtml(p.height || '—')}</strong></div>
              <div class="meta-box"><small>Goals</small><strong>${s.goals?.total ?? 0}</strong></div>
              <div class="meta-box"><small>Assists</small><strong>${s.goals?.assists ?? 0}</strong></div>
            </div>
            ${card('Season <span>Stats</span>', `<div class="table-wrap"><table><thead><tr><th>Club</th><th>League</th><th class="center">Apps</th><th class="center">Minutes</th><th class="center">Goals</th><th class="center">Assists</th><th class="center">Yellow</th><th class="center">Red</th></tr></thead><tbody><tr><td>${escapeHtml(s.team?.name || '')}</td><td>${escapeHtml(s.league?.name || '')}</td><td class="center">${s.games?.appearences ?? 0}</td><td class="center">${s.games?.minutes ?? 0}</td><td class="center">${s.goals?.total ?? 0}</td><td class="center">${s.goals?.assists ?? 0}</td><td class="center">${s.cards?.yellow ?? 0}</td><td class="center">${s.cards?.red ?? 0}</td></tr></tbody></table></div>`) }
          </div>
          <div class="stack">${card('Transfer <span>History</span>', renderTransferList(transferRows))}</div>
        </section>
      </div>`;
    setApp(content, '');
  } catch (err) {
    setApp(`<div class="page"><div class="card"><div class="error">${escapeHtml(err.message)}</div></div></div>`, '');
  }
}

async function renderMatch(path) {
  setApp(loadingPage(), '');
  const id = Number(path.split('/').pop());
  try {
    const [fixtureRes, eventsRes, statsRes, lineupsRes] = await Promise.all([
      apiFetch('fixtures', { id }).catch(() => ({ response: [] })),
      apiFetch('fixtures/events', { fixture: id }).catch(() => ({ response: [] })),
      apiFetch('fixtures/statistics', { fixture: id }).catch(() => ({ response: [] })),
      apiFetch('fixtures/lineups', { fixture: id }).catch(() => ({ response: [] }))
    ]);
    const m = fixtureRes.response?.[0];
    if (!m) throw new Error('Match not found');
    const events = eventsRes.response || [];
    const stats = statsRes.response || [];
    const lineups = lineupsRes.response || [];
    const eventBody = events.length ? `<div class="list">${events.map((e) => `<div class="row"><div class="form-inline" style="justify-content:space-between;"><strong>${escapeHtml(e.time?.elapsed ? `${e.time.elapsed}'` : '•')}</strong><span>${escapeHtml(e.team?.name || '')}</span><span class="muted">${escapeHtml(e.type || '')}${e.detail ? ` — ${escapeHtml(e.detail)}` : ''}</span><span>${escapeHtml(e.player?.name || '')}</span></div></div>`).join('')}</div>` : `<div class="empty">No event feed.</div>`;
    const statsBody = stats.length ? `<div class="table-wrap"><table><thead><tr><th>Stat</th><th class="center">${escapeHtml(stats[0]?.team?.name || 'Home')}</th><th class="center">${escapeHtml(stats[1]?.team?.name || 'Away')}</th></tr></thead><tbody>${(stats[0]?.statistics || []).map((s, i) => `<tr><td>${escapeHtml(s.type || '')}</td><td class="center">${escapeHtml(String(s.value ?? '—'))}</td><td class="center">${escapeHtml(String(stats[1]?.statistics?.[i]?.value ?? '—'))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">No statistics available.</div>`;
    const lineupBody = lineups.length ? `<div class="list">${lineups.map((l) => `<div class="row"><strong>${escapeHtml(l.team?.name || '')}</strong><div class="muted">Formation ${escapeHtml(l.formation || '')}</div><div class="muted">Coach: ${escapeHtml(l.coach?.name || '')}</div></div>`).join('')}</div>` : `<div class="empty">No lineups available.</div>`;

    const content = `
      <div class="page">
        <section class="entity-hero"><div class="entity-head"><div class="entity-logo">⚽</div><div><div class="entity-type">Match centre</div><div class="entity-title">${escapeHtml(m.teams?.home?.name || 'Home')} <span>vs</span> ${escapeHtml(m.teams?.away?.name || 'Away')}</div><div class="entity-meta"><div class="tag">${escapeHtml(m.league?.name || '')}</div><div class="tag">${escapeHtml(m.fixture?.status?.long || '')}</div><div class="tag">${escapeHtml(formatDateTime(m.fixture?.date || ''))}</div></div></div><div class="pill">${m.goals?.home ?? 0} - ${m.goals?.away ?? 0}</div></div></section>
        <section class="page-layout">
          <div class="stack">${card('Match <span>Events</span>', eventBody)}${card('Team <span>Statistics</span>', statsBody)}</div>
          <div class="stack">${card('Starting <span>Info</span>', lineupBody)}${card('Quick <span>Links</span>', `<div class="list"><a class="quick-link" href="/club/${slugify(m.teams?.home?.name || 'club')}-${m.teams?.home?.id}" data-link><div class="avatar">🏠</div><div><strong>${escapeHtml(m.teams?.home?.name || '')}</strong><div class="muted">Home club</div></div><div class="pill">Open</div></a><a class="quick-link" href="/club/${slugify(m.teams?.away?.name || 'club')}-${m.teams?.away?.id}" data-link><div class="avatar">🚌</div><div><strong>${escapeHtml(m.teams?.away?.name || '')}</strong><div class="muted">Away club</div></div><div class="pill">Open</div></a></div>`)}</div>
        </section>
      </div>`;
    setApp(content, '');
  } catch (err) {
    setApp(`<div class="page"><div class="card"><div class="error">${escapeHtml(err.message)}</div></div></div>`, '');
  }
}

async function renderToplists() {
  setApp(loadingPage(), '/toplists');
  try {
    const leagues = [39, 140, 78, 135, 61, 113];
    const data = await Promise.all(leagues.map((id) => Promise.all([
      apiFetch('players/topscorers', { league: id, season: CURRENT_SEASON }).catch(() => ({ response: [] })),
      apiFetch('players/topassists', { league: id, season: CURRENT_SEASON }).catch(() => ({ response: [] }))
    ])));
    const scorers = data.flatMap((d) => (d[0].response || []).slice(0, 3)).sort((a,b)=>(b.statistics?.[0]?.goals?.total||0)-(a.statistics?.[0]?.goals?.total||0)).slice(0, 12);
    const assists = data.flatMap((d) => (d[1].response || []).slice(0, 3)).sort((a,b)=>(b.statistics?.[0]?.goals?.assists||0)-(a.statistics?.[0]?.goals?.assists||0)).slice(0, 12);
    const scorerBody = `<div class="table-wrap"><table><thead><tr><th>Player</th><th>Club</th><th class="center">Goals</th></tr></thead><tbody>${scorers.map((p) => `<tr><td><a href="/player/${slugify(p.player?.name || 'player')}-${p.player?.id}" data-link>${escapeHtml(p.player?.name || '')}</a></td><td>${escapeHtml(p.statistics?.[0]?.team?.name || '')}</td><td class="center">${p.statistics?.[0]?.goals?.total ?? 0}</td></tr>`).join('')}</tbody></table></div>`;
    const assistBody = `<div class="table-wrap"><table><thead><tr><th>Player</th><th>Club</th><th class="center">Assists</th></tr></thead><tbody>${assists.map((p) => `<tr><td><a href="/player/${slugify(p.player?.name || 'player')}-${p.player?.id}" data-link>${escapeHtml(p.player?.name || '')}</a></td><td>${escapeHtml(p.statistics?.[0]?.team?.name || '')}</td><td class="center">${p.statistics?.[0]?.goals?.assists ?? 0}</td></tr>`).join('')}</tbody></table></div>`;
    setApp(`<div class="page"><section class="main-grid"><div class="stack">${card('Top <span>Scorers</span>', scorerBody)}</div><div class="stack">${card('Top <span>Assists</span>', assistBody)}</div></section></div>`, '/toplists');
  } catch (err) {
    setApp(`<div class="page"><div class="card"><div class="error">${escapeHtml(err.message)}</div></div></div>`, '/toplists');
  }
}

async function renderMyClubFeed(compact = false) {
  if (!state.myClubs.length) {
    return `<div class="empty">No followed clubs yet. Open a club page and tap Follow club.</div>`;
  }
  const rows = await Promise.all(state.myClubs.map(async (club) => {
    const data = await apiFetch('fixtures', { team: club.id, next: 2 }).catch(() => ({ response: [] }));
    return { club, fixtures: data.response || [] };
  }));
  const html = `<div class="list">${rows.map(({ club, fixtures }) => `
    <div class="row">
      <div class="form-inline" style="justify-content:space-between;"><strong>${escapeHtml(club.name)}</strong><a href="/club/${slugify(club.name)}-${club.id}" data-link class="pill">Open</a></div>
      ${fixtures.length ? fixtures.map((f) => `<div class="muted small">${escapeHtml(formatDateTime(f.fixture?.date || ''))} — ${escapeHtml(f.teams?.home?.name || '')} vs ${escapeHtml(f.teams?.away?.name || '')}</div>`).join('') : `<div class="muted small">No upcoming fixtures found.</div>`}
    </div>`).join('')}</div>`;
  return compact ? html : card('My <span>Clubs</span>', html);
}

async function renderMyClubs() {
  setApp(loadingPage(), '/myclubs');
  const body = await renderMyClubFeed(false);
  setApp(`<div class="page">${body}</div>`, '/myclubs');
}

async function renderAssistant() {
  setApp(`<div class="page"><section class="main-grid"><div class="stack">${card('AI <span>Assistant</span>', `<div class="chat-wrap"><div id="chat-log" class="chat-log"><div class="chat-msg ai">Ask about players, clubs, transfers or leagues.</div></div><form id="chat-form" class="chat-form"><textarea id="chat-input" placeholder="Ask something about football..."></textarea><button class="btn primary" type="submit">Send</button></form></div>`)}</div><div class="stack">${card('What it can <span>do</span>', `<div class="list"><div class="row"><strong>Transfers</strong><div class="muted">Summaries and context</div></div><div class="row"><strong>Leagues</strong><div class="muted">Tables, players and stats</div></div><div class="row"><strong>Players</strong><div class="muted">Profiles and comparisons</div></div></div>`)}</div></section></div>`, '/assistant');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const log = document.getElementById('chat-log');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    log.insertAdjacentHTML('beforeend', `<div class="chat-msg user">${escapeHtml(query)}</div>`);
    input.value = '';
    log.insertAdjacentHTML('beforeend', `<div class="chat-msg ai" id="ai-loading">Thinking...</div>`);
    log.scrollTop = log.scrollHeight;
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      document.getElementById('ai-loading')?.remove();
      log.insertAdjacentHTML('beforeend', `<div class="chat-msg ai">${escapeHtml(data.answer || data.error || 'No response.')}</div>`);
      log.scrollTop = log.scrollHeight;
    } catch {
      document.getElementById('ai-loading')?.remove();
      log.insertAdjacentHTML('beforeend', `<div class="chat-msg ai">AI request failed.</div>`);
    }
  });
}

async function router() {
  const path = location.pathname;
  if (path === '/') return renderHome();
  if (path === '/transfers') return renderTransfers();
  if (path === '/live') return renderLive();
  if (path === '/leagues') return renderLeagues();
  if (path === '/toplists') return renderToplists();
  if (path === '/myclubs') return renderMyClubs();
  if (path === '/assistant') return renderAssistant();
  if (path.startsWith('/league/')) return renderLeague(path);
  if (path.startsWith('/club/')) return renderClub(path);
  if (path.startsWith('/player/')) return renderPlayer(path);
  if (path.startsWith('/match/')) return renderMatch(path);
  setApp(`<div class="page"><div class="card"><div class="error">Page not found.</div></div></div>`, '');
}

router();
