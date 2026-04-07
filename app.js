const API = '/api/football';

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
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function avatar(url, alt = '') {
  return `
    <div class="avatar">
      ${url ? `<img src="${url}" alt="${escapeHtml(alt)}" />` : '👤'}
    </div>
  `;
}

function crest(url, alt = '') {
  return `
    <div class="crest">
      ${url ? `<img src="${url}" alt="${escapeHtml(alt)}" />` : '⚽'}
    </div>
  `;
}

async function apiFetch(endpoint, params = {}) {
  const query = new URLSearchParams({ endpoint, ...params });
  const res = await fetch(`${API}?${query.toString()}`);
  if (!res.ok) {
    throw new Error(`API failed: ${res.status}`);
  }
  return res.json();
}

function loadingPage() {
  return `
    <div class="page">
      <div class="card">
        <div class="empty">Loading...</div>
      </div>
    </div>
  `;
}

function card(title, inner = '', action = '') {
  return `
    <section class="card">
      <div class="card-head">
        <h2 class="title">${title}</h2>
        ${action}
      </div>
      ${inner}
    </section>
  `;
}

function appShell(content, active = '/') {
  return `
    <div class="shell">
      <header class="topbar">
        <div class="container topbar-inner">
          <a class="brand" href="/" data-link>
            <div class="brand-logo">
              <img src="/transferzoneai-logo.png" alt="TransferZoneAI logo" />
            </div>
            <div class="brand-name">TransferZone<span>AI</span></div>
          </a>

          <nav class="nav">
            <a href="/" data-link class="${active === '/' ? 'active' : ''}">Home</a>
            <a href="/transfers" data-link class="${active === '/transfers' ? 'active' : ''}">Transfers</a>
            <a href="/live" data-link class="${active === '/live' ? 'active' : ''}">Live</a>
          </nav>

          <div class="searchbox">
            <input id="global-search" type="text" placeholder="Search player, club or league..." autocomplete="off" />
            <button class="search-submit" id="global-search-btn">⌕</button>
            <div class="search-results" id="search-results"></div>
          </div>
        </div>
      </header>

      <main class="container">${content}</main>

      <footer class="container footer">
        <div>TransferZoneAI — rebuilt from scratch in Vanilla JS.</div>
      </footer>
    </div>
  `;
}

function navigate(path) {
  history.pushState({}, '', path);
  router();
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-link]');
  if (!link) return;
  e.preventDefault();
  navigate(link.getAttribute('href'));
});

window.addEventListener('popstate', router);

function bindShell() {
  const input = document.getElementById('global-search');
  const button = document.getElementById('global-search-btn');
  const results = document.getElementById('search-results');

  if (!input || !button || !results) return;

  let timer;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const value = input.value.trim();

    if (!value || value.length < 2) {
      results.classList.remove('open');
      results.innerHTML = '';
      return;
    }

    timer = setTimeout(async () => {
      try {
        const data = await apiFetch('search', { q: value });
        const players = Array.isArray(data.response) ? data.response.slice(0, 6) : [];

        if (!players.length) {
          results.innerHTML = `
            <div class="search-row">
              <div class="search-icon">?</div>
              <div>No results</div>
              <div></div>
            </div>
          `;
          results.classList.add('open');
          return;
        }

        results.innerHTML = players.map((item) => {
          const player = item.player || item;
          const stats = item.statistics?.[0] || {};
          const team = stats.team?.name || 'Unknown club';
          const league = stats.league?.name || '';
          const slug = `${slugify(player.name)}-${player.id}`;

          return `
            <div class="search-row" data-go="/player/${slug}">
              ${avatar(player.photo, player.name)}
              <div>
                <div><strong>${escapeHtml(player.name)}</strong></div>
                <div class="muted">${escapeHtml(team)}${league ? ` • ${escapeHtml(league)}` : ''}</div>
              </div>
              <div class="badge">Player</div>
            </div>
          `;
        }).join('');

        results.classList.add('open');
      } catch (err) {
        results.innerHTML = `
          <div class="search-row">
            <div class="search-icon">!</div>
            <div>Search failed</div>
            <div></div>
          </div>
        `;
        results.classList.add('open');
      }
    }, 250);
  });

  button.addEventListener('click', () => {
    const value = input.value.trim();
    if (value.length >= 2) {
      navigate(`/transfers?q=${encodeURIComponent(value)}`);
    }
  });

  results.addEventListener('click', (e) => {
    const row = e.target.closest('[data-go]');
    if (!row) return;
    results.classList.remove('open');
    navigate(row.dataset.go);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchbox')) {
      results.classList.remove('open');
    }
  });
}

async function renderHome() {
  const app = document.getElementById('app');

  try {
    const [liveData, transferData, topScorersData] = await Promise.all([
      apiFetch('fixtures', { live: 'all' }).catch(() => ({ response: [] })),
      apiFetch('transfers/global').catch(() => ({ response: [] })),
      apiFetch('players/topscorers', { league: 39, season: 2025 }).catch(() => ({ response: [] }))
    ]);

    const live = (liveData.response || []).slice(0, 6);
    const transfers = (transferData.response || []).slice(0, 6);
    const scorers = (topScorersData.response || []).slice(0, 8);
    const featured = scorers[0] || null;

    function renderLiveCards() {
      if (!live.length) {
        return `<div class="empty">No live matches right now.</div>`;
      }

      return `
        <div class="list">
          ${live.map((match) => {
            const home = match.teams?.home || {};
            const away = match.teams?.away || {};
            const league = match.league || {};
            const fixture = match.fixture || {};
            const goals = match.goals || {};
            const isLive = ['1H','2H','HT','ET','BT','P','LIVE'].includes(fixture.status?.short);

            return `
              <a class="row" data-link href="/match/${fixture.id}">
                <div class="live-row-enhanced">
                  <div class="team-line">
                    <div class="team-logo">
                      ${home.logo ? `<img src="${home.logo}" alt="${escapeHtml(home.name || '')}" />` : '🏠'}
                    </div>
                    <div class="team-copy">
                      <div><strong>${escapeHtml(home.name || 'Home')}</strong></div>
                      <div class="muted">${escapeHtml(league.name || '')}</div>
                    </div>
                  </div>

                  <div class="match-middle">
                    <div class="score">${goals.home ?? 0} - ${goals.away ?? 0}</div>
                    <div class="status-pill ${isLive ? 'live' : ''}">
                      ${escapeHtml(fixture.status?.short || 'LIVE')}
                    </div>
                  </div>

                  <div class="team-line right">
                    <div class="team-copy">
                      <div><strong>${escapeHtml(away.name || 'Away')}</strong></div>
                      <div class="muted">${escapeHtml(fixture.status?.elapsed ? `${fixture.status.elapsed}'` : '')}</div>
                    </div>
                    <div class="team-logo">
                      ${away.logo ? `<img src="${away.logo}" alt="${escapeHtml(away.name || '')}" />` : '🚌'}
                    </div>
                  </div>
                </div>
              </a>
            `;
          }).join('')}
        </div>
      `;
    }

    function renderTransfersList() {
      if (!transfers.length) {
        return `<div class="empty">No transfer data right now.</div>`;
      }

      return `
        <div class="transfer-list">
          ${transfers.map((t) => {
            const player = t.player || {};
            const move = t.transfers?.[0] || {};
            const fromName = move.teams?.out?.name || 'Unknown club';
            const toName = move.teams?.in?.name || 'Unknown club';
            const type = move.type || 'Transfer';

            let playerName =
  player.name ||
  t.player_name ||
  move.player_name;

if (!playerName || playerName === 'undefined') {
  playerName = move?.player?.name || 'Unnamed player';
}

const safeName = playerName || 'Transfer';

            const playerPhoto =
              player.photo ||
              t.player_photo ||
              '';

            const playerId =
              player.id ||
              t.player_id ||
              '';

            const playerHref = playerId
              ? `/player/${slugify(playerName)}-${playerId}`
              : '/transfers';

            return `
              <a class="transfer-item" data-link href="${playerHref}">
                ${avatar(playerPhoto, playerName)}
                <div class="transfer-copy">
                  <div><strong>${escapeHtml(safeName)}</strong></div>
                  <div class="transfer-route">
  ${escapeHtml(fromName)} 
  <span style="color:var(--gold);font-weight:900;">→</span> 
  ${escapeHtml(toName)}
</div>
                </div>
                <div class="transfer-type">${escapeHtml(type)}</div>
              </a>
            `;
          }).join('')}
        </div>
      `;
    }

    function renderScorersList() {
      if (!scorers.length) {
        return `<div class="empty">No scorer data right now.</div>`;
      }

      return `
        <div class="panel-list">
          ${scorers.map((item, index) => {
            const p = item.player || {};
            const stats = item.statistics?.[0] || {};
            const team = stats.team || {};
            const goals = stats.goals?.total || 0;

            return `
              <a class="scorer-card" data-link href="/player/${slugify(p.name || 'player')}-${p.id}">
                <div class="scorer-rank">${index + 1}</div>
                <div>
                  <div><strong>${escapeHtml(p.name || 'Unknown player')}</strong></div>
                  <div class="muted">${escapeHtml(team.name || 'Unknown club')}</div>
                </div>
                <div class="scorer-score">${goals}</div>
              </a>
            `;
          }).join('')}
        </div>
      `;
    }

    function renderFeaturedPlayer() {
      if (!featured) {
        return `
          <div class="hero-side-card">
            <h3 class="hero-side-title">Featured <span>Player</span></h3>
            <div class="empty">No featured player right now.</div>
          </div>
        `;
      }

      const p = featured.player || {};
      const stats = featured.statistics?.[0] || {};
      const team = stats.team || {};
      const league = stats.league || {};
      const goals = stats.goals?.total || 0;
      const assists = stats.goals?.assists || 0;
      const apps = stats.games?.appearences || 0;

      return `
        <a class="hero-side-card" data-link href="/player/${slugify(p.name || 'player')}-${p.id}">
          <h3 class="hero-side-title">Featured <span>Player</span></h3>

          <div class="featured-player">
            <div class="featured-player-top">
              <div class="featured-player-photo">
                ${p.photo ? `<img src="${p.photo}" alt="${escapeHtml(p.name || '')}" />` : ''}
              </div>
              <div>
                <div style="font-size:28px;font-family:'Barlow Condensed',sans-serif;line-height:.95;">
                  ${escapeHtml(p.name || 'Unknown player')}
                </div>
                <div class="muted" style="margin-top:6px;">
                  ${escapeHtml(team.name || 'Unknown club')}
                </div>
                <div class="muted">
                  ${escapeHtml(league.name || 'Unknown league')}
                </div>
              </div>
            </div>

            <div class="featured-stats">
              <div class="featured-stat">
                <div class="featured-stat-label">Goals</div>
                <div class="featured-stat-value">${goals}</div>
              </div>
              <div class="featured-stat">
                <div class="featured-stat-label">Assists</div>
                <div class="featured-stat-value">${assists}</div>
              </div>
              <div class="featured-stat">
                <div class="featured-stat-label">Apps</div>
                <div class="featured-stat-value">${apps}</div>
              </div>
            </div>
          </div>
        </a>
      `;
    }

    const content = `
      <section class="hero">
        <div class="hero-grid">
          <div class="hero-card">
            <div class="hero-kicker">Football intelligence</div>
            <h1 class="hero-title">Transfermarkt style.<br><span>Cleaner. Faster. Better.</span></h1>
            <p class="hero-sub">A rebuilt football platform with modern UI, real routing, cleaner search, better entity pages and a structure that is actually possible to grow.</p>

            <div class="hero-actions">
              <a href="/transfers" data-link class="btn primary">Explore transfers</a>
              <a href="/live" data-link class="btn">Open live centre</a>
            </div>

            <div class="kpis">
              <div class="kpi">
                <div class="kpi-label">Live matches</div>
                <div class="kpi-value">${live.length}</div>
              </div>
              <div class="kpi">
                <div class="kpi-label">Fresh transfers</div>
                <div class="kpi-value">${transfers.length}</div>
              </div>
              <div class="kpi">
                <div class="kpi-label">Top scorers shown</div>
                <div class="kpi-value">${scorers.length}</div>
              </div>
              <div class="kpi">
                <div class="kpi-label">Version</div>
                <div class="kpi-value">1.1</div>
              </div>
            </div>
          </div>

          <div class="hero-side">
            ${renderFeaturedPlayer()}
          </div>
        </div>
      </section>

      <section class="page">
        <div class="grid-home">
          <div class="stack">
            ${card('Live <span>Matches</span>', renderLiveCards())}
            ${card('Top <span>Scorers</span>', renderScorersList())}
          </div>

          <div class="stack">
            ${card(
              'Latest <span>Transfers</span>',
              renderTransfersList(),
              `<a data-link href="/transfers" class="badge">Open all</a>`
            )}

            ${card(
              'Quick <span>Links</span>',
              `
                <div class="list">
                  <a class="row league-row" data-link href="/league/premier-league-39">
                    <div class="search-icon">🏆</div>
                    <div>
                      <div><strong>Premier League</strong></div>
                      <div class="muted">England</div>
                    </div>
                    <div class="badge">League</div>
                  </a>

                  <a class="row league-row" data-link href="/league/la-liga-140">
                    <div class="search-icon">🏆</div>
                    <div>
                      <div><strong>La Liga</strong></div>
                      <div class="muted">Spain</div>
                    </div>
                    <div class="badge">League</div>
                  </a>

                  <a class="row league-row" data-link href="/league/allsvenskan-113">
                    <div class="search-icon">🏆</div>
                    <div>
                      <div><strong>Allsvenskan</strong></div>
                      <div class="muted">Sweden</div>
                    </div>
                    <div class="badge">League</div>
                  </a>
                </div>
              `
            )}
          </div>
        </div>
      </section>
    `;

    app.innerHTML = appShell(content, '/');
    bindShell();
  } catch (err) {
    app.innerHTML = appShell(`
      <div class="page">
        <div class="card">
          <div class="empty">Failed to load homepage.</div>
        </div>
      </div>
    `, '/');
    bindShell();
  }
}

async function renderTransfers() {
  const app = document.getElementById('app');

  try {
    const data = await apiFetch('transfers/global');
    const transfers = (data.response || []).slice(0, 60);

    const content = `
      <section class="page">
        <div class="entity-hero">
          <div class="entity-head">
            <div class="entity-logo">💸</div>
            <div>
              <div class="entity-type">Transfers centre</div>
              <div class="entity-title">Latest <span>Transfers</span></div>
              <div class="entity-meta">
                <div class="tag">Feed</div>
                <div class="tag">Modern UI</div>
                <div class="tag">Real entity links</div>
              </div>
            </div>
            <div class="badge">${transfers.length} items</div>
          </div>
        </div>

        <div class="layout">
          <div class="stack">
            ${card(
              'Transfer <span>Feed</span>',
              transfers.length
                ? `
                  <div class="list">
                    ${transfers.map((t) => {
                      const player = t.player || {};
                      const move = t.transfers?.[0] || {};
                      const from = move.teams?.out;
                      const to = move.teams?.in;

                      return `
                        <a class="row transfer-row" data-link href="/player/${slugify(player.name)}-${player.id}">
                          ${avatar(player.photo, player.name)}
                          <div>
                            <div><strong>${escapeHtml(player.name || 'Unknown player')}</strong></div>
                            <div class="muted">${escapeHtml(from?.name || 'Unknown')} → ${escapeHtml(to?.name || 'Unknown')}</div>
                          </div>
                          <div class="value-tag">${escapeHtml(move.type || 'Transfer')}</div>
                        </a>
                      `;
                    }).join('')}
                  </div>
                `
                : `<div class="empty">No transfers found.</div>`
            )}
          </div>

          <div class="stack">
            ${card(
              'About this <span>Page</span>',
              `<div class="muted">This is the rebuilt transfers page. Clean cards, proper spacing, better player linking and a layout that doesn’t feel like it will explode.</div>`
            )}
          </div>
        </div>
      </section>
    `;

    app.innerHTML = appShell(content, '/transfers');
    bindShell();
  } catch (err) {
    app.innerHTML = appShell(`
      <div class="page">
        <div class="card">
          <div class="empty">Failed to load transfers.</div>
        </div>
      </div>
    `, '/transfers');
    bindShell();
  }
}

async function renderLive() {
  const app = document.getElementById('app');

  try {
    const data = await apiFetch('fixtures', { live: 'all' });
    const live = data.response || [];

    const content = `
      <section class="page">
        <div class="entity-hero">
          <div class="entity-head">
            <div class="entity-logo">🔴</div>
            <div>
              <div class="entity-type">Live centre</div>
              <div class="entity-title">Live <span>Matches</span></div>
              <div class="entity-meta">
                <div class="tag">Scores</div>
                <div class="tag">Status</div>
                <div class="tag">Match links</div>
              </div>
            </div>
            <div class="badge">${live.length} live</div>
          </div>
        </div>

        <div class="section-gap"></div>

        ${card(
          'Now <span>Playing</span>',
          live.length
            ? `
              <div class="list">
                ${live.map((match) => {
                  const home = match.teams?.home;
                  const away = match.teams?.away;
                  const score = `${match.goals?.home ?? 0} - ${match.goals?.away ?? 0}`;

                  return `
                    <a class="row match-row" data-link href="/match/${match.fixture?.id}">
                      <div>
                        <div><strong>${escapeHtml(home?.name || '')}</strong></div>
                        <div class="muted">${escapeHtml(match.league?.name || '')}</div>
                      </div>
                      <div class="score">${score}</div>
                      <div style="text-align:right">
                        <div><strong>${escapeHtml(away?.name || '')}</strong></div>
                        <div class="muted">${escapeHtml(match.fixture?.status?.elapsed || '')}' ${escapeHtml(match.fixture?.status?.short || '')}</div>
                      </div>
                    </a>
                  `;
                }).join('')}
              </div>
            `
            : `<div class="empty">No live matches right now.</div>`
        )}
      </section>
    `;

    app.innerHTML = appShell(content, '/live');
    bindShell();
  } catch (err) {
    app.innerHTML = appShell(`
      <div class="page">
        <div class="card">
          <div class="empty">Failed to load live centre.</div>
        </div>
      </div>
    `, '/live');
    bindShell();
  }
}

async function renderPlayer(path) {
  const app = document.getElementById('app');
  const id = path.split('-').pop();

  try {
    const data = await apiFetch('players', { id, season: 2025 });
    const item = data.response?.[0];

    if (!item) {
      throw new Error('Player not found');
    }

    const player = item.player;
    const stat = item.statistics?.[0] || {};
    const team = stat.team || {};
    const league = stat.league || {};
    const games = stat.games || {};
    const goals = stat.goals || {};
    const cards = stat.cards || {};

    const content = `
      <section class="page">
        <div class="entity-hero">
          <div class="entity-head">
            <div class="entity-logo">
              <img src="${player.photo}" alt="${escapeHtml(player.name)}" />
            </div>
            <div>
              <div class="entity-type">Player profile</div>
              <div class="entity-title">${escapeHtml(player.name)}</div>
              <div class="entity-meta">
                <div class="tag">${escapeHtml(team.name || 'Unknown club')}</div>
                <div class="tag">${escapeHtml(league.name || 'Unknown league')}</div>
                <div class="tag">${escapeHtml(player.nationality || 'Unknown nationality')}</div>
              </div>
            </div>
            <div class="badge">#${player.id}</div>
          </div>
        </div>

        <div class="layout">
          <div class="stack">
            ${card(
              'Season <span>Stats</span>',
              `
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Club</th>
                        <th>League</th>
                        <th class="center">Apps</th>
                        <th class="center">Goals</th>
                        <th class="center">Assists</th>
                        <th class="center">Yellow</th>
                        <th class="center">Red</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>${escapeHtml(team.name || '—')}</td>
                        <td>${escapeHtml(league.name || '—')}</td>
                        <td class="center">${games.appearences ?? 0}</td>
                        <td class="center">${goals.total ?? 0}</td>
                        <td class="center">${goals.assists ?? 0}</td>
                        <td class="center">${cards.yellow ?? 0}</td>
                        <td class="center">${cards.red ?? 0}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              `
            )}
          </div>

          <div class="stack">
            ${card(
              'Player <span>Info</span>',
              `
                <div class="panel-list">
                  <div class="player-mini"><div class="search-icon">🎂</div><div>Age</div><div class="value-tag">${player.age ?? '—'}</div></div>
                  <div class="player-mini"><div class="search-icon">📏</div><div>Height</div><div class="value-tag">${escapeHtml(player.height || '—')}</div></div>
                  <div class="player-mini"><div class="search-icon">🦶</div><div>Position</div><div class="value-tag">${escapeHtml(games.position || '—')}</div></div>
                  <div class="player-mini"><div class="search-icon">🏟️</div><div>Club</div><div class="value-tag">${escapeHtml(team.name || '—')}</div></div>
                </div>
              `
            )}
          </div>
        </div>
      </section>
    `;

    app.innerHTML = appShell(content, '');
    bindShell();
  } catch (err) {
    app.innerHTML = appShell(`
      <div class="page">
        <div class="card">
          <div class="empty">Player not found.</div>
        </div>
      </div>
    `, '');
    bindShell();
  }
}

async function renderClub(path) {
  const app = document.getElementById('app');
  const id = path.split('-').pop();

  try {
    const [teamData, squadData] = await Promise.all([
      apiFetch('teams', { id }),
      apiFetch('players/squads', { team: id })
    ]);

    const club = teamData.response?.[0]?.team;
    const venue = teamData.response?.[0]?.venue;
    const squad = squadData.response?.[0]?.players || [];

    if (!club) {
      throw new Error('Club not found');
    }

    const content = `
      <section class="page">
        <div class="entity-hero">
          <div class="entity-head">
            <div class="entity-logo">
              <img src="${club.logo}" alt="${escapeHtml(club.name)}" />
            </div>
            <div>
              <div class="entity-type">Club profile</div>
              <div class="entity-title">${escapeHtml(club.name)}</div>
              <div class="entity-meta">
                <div class="tag">${escapeHtml(club.country || '')}</div>
                <div class="tag">Founded ${club.founded || '—'}</div>
                <div class="tag">${escapeHtml(venue?.name || 'Unknown stadium')}</div>
              </div>
            </div>
            <div class="badge">Team</div>
          </div>
        </div>

        <div class="layout">
          <div class="stack">
            ${card(
              'Squad <span>List</span>',
              squad.length
                ? `
                  <div class="panel-list">
                    ${squad.slice(0, 24).map((p) => `
                      <a class="player-mini" data-link href="/player/${slugify(p.name)}-${p.id}">
                        ${avatar(p.photo, p.name)}
                        <div>
                          <div><strong>${escapeHtml(p.name)}</strong></div>
                          <div class="muted">${escapeHtml(p.position || '')}</div>
                        </div>
                        <div class="value-tag">${p.age ?? '—'}</div>
                      </a>
                    `).join('')}
                  </div>
                `
                : `<div class="empty">No squad data.</div>`
            )}
          </div>

          <div class="stack">
            ${card(
              'Club <span>Info</span>',
              `
                <div class="panel-list">
                  <div class="player-mini"><div class="search-icon">🏟️</div><div>Stadium</div><div class="value-tag">${escapeHtml(venue?.name || '—')}</div></div>
                  <div class="player-mini"><div class="search-icon">👥</div><div>Capacity</div><div class="value-tag">${venue?.capacity ?? '—'}</div></div>
                  <div class="player-mini"><div class="search-icon">📍</div><div>City</div><div class="value-tag">${escapeHtml(venue?.city || '—')}</div></div>
                </div>
              `
            )}
          </div>
        </div>
      </section>
    `;

    app.innerHTML = appShell(content, '');
    bindShell();
  } catch (err) {
    app.innerHTML = appShell(`
      <div class="page">
        <div class="card">
          <div class="empty">Club not found.</div>
        </div>
      </div>
    `, '');
    bindShell();
  }
}

async function renderLeague(path) {
  const app = document.getElementById('app');
  const id = path.split('-').pop();

  try {
    const [standingsData, scorersData] = await Promise.all([
      apiFetch('standings', { league: id, season: 2025 }),
      apiFetch('players/topscorers', { league: id, season: 2025 }).catch(() => ({ response: [] }))
    ]);

    const leagueBlock = standingsData.response?.[0]?.league;
    const table = leagueBlock?.standings?.[0] || [];
    const scorers = scorersData.response || [];

    const content = `
      <section class="page">
        <div class="entity-hero">
          <div class="entity-head">
            <div class="entity-logo">🏆</div>
            <div>
              <div class="entity-type">League profile</div>
              <div class="entity-title">${escapeHtml(leagueBlock?.name || 'League')}</div>
              <div class="entity-meta">
                <div class="tag">${escapeHtml(leagueBlock?.country || '')}</div>
                <div class="tag">Season ${leagueBlock?.season || '2025'}</div>
              </div>
            </div>
            <div class="badge">League</div>
          </div>
        </div>

        <div class="layout">
          <div class="stack">
            ${card(
              'League <span>Table</span>',
              table.length
                ? `
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th class="center">#</th>
                          <th>Club</th>
                          <th class="center">Pts</th>
                          <th class="center">P</th>
                          <th class="center">GD</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${table.map((row) => `
                          <tr>
                            <td class="center">${row.rank}</td>
                            <td><a data-link href="/club/${slugify(row.team.name)}-${row.team.id}">${escapeHtml(row.team.name)}</a></td>
                            <td class="center">${row.points}</td>
                            <td class="center">${row.all.played}</td>
                            <td class="center">${row.goalsDiff}</td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                `
                : `<div class="empty">No standings found.</div>`
            )}
          </div>

          <div class="stack">
            ${card(
              'Top <span>Scorers</span>',
              scorers.length
                ? `
                  <div class="panel-list">
                    ${scorers.slice(0, 10).map((s) => `
                      <a class="player-mini" data-link href="/player/${slugify(s.player.name)}-${s.player.id}">
                        ${avatar(s.player.photo, s.player.name)}
                        <div>
                          <div><strong>${escapeHtml(s.player.name)}</strong></div>
                          <div class="muted">${escapeHtml(s.statistics?.[0]?.team?.name || '')}</div>
                        </div>
                        <div class="value-tag">${s.statistics?.[0]?.goals?.total ?? 0}</div>
                      </a>
                    `).join('')}
                  </div>
                `
                : `<div class="empty">No scorer data.</div>`
            )}
          </div>
        </div>
      </section>
    `;

    app.innerHTML = appShell(content, '');
    bindShell();
  } catch (err) {
    app.innerHTML = appShell(`
      <div class="page">
        <div class="card">
          <div class="empty">League not found.</div>
        </div>
      </div>
    `, '');
    bindShell();
  }
}

async function renderMatch(path) {
  const app = document.getElementById('app');
  const id = path.split('/').pop();

  try {
    const data = await apiFetch('fixtures', { id });
    const match = data.response?.[0];

    if (!match) {
      throw new Error('Match not found');
    }

    const home = match.teams?.home;
    const away = match.teams?.away;
    const league = match.league;
    const fixture = match.fixture;

    const content = `
      <section class="page">
        <div class="entity-hero">
          <div class="entity-head">
            <div class="entity-logo">⚽</div>
            <div>
              <div class="entity-type">Match centre</div>
              <div class="entity-title">${escapeHtml(home?.name || 'Home')} <span>vs</span> ${escapeHtml(away?.name || 'Away')}</div>
              <div class="entity-meta">
                <div class="tag">${escapeHtml(league?.name || '')}</div>
                <div class="tag">${escapeHtml(fixture?.status?.long || '')}</div>
                <div class="tag">${escapeHtml(fixture?.date || '')}</div>
              </div>
            </div>
            <div class="badge">${match.goals?.home ?? 0} - ${match.goals?.away ?? 0}</div>
          </div>
        </div>

        <div class="layout">
          <div class="stack">
            ${card(
              'Match <span>Overview</span>',
              `
                <div class="table-wrap">
                  <table>
                    <tbody>
                      <tr><td>Home</td><td>${escapeHtml(home?.name || '')}</td></tr>
                      <tr><td>Away</td><td>${escapeHtml(away?.name || '')}</td></tr>
                      <tr><td>League</td><td>${escapeHtml(league?.name || '')}</td></tr>
                      <tr><td>Status</td><td>${escapeHtml(fixture?.status?.long || '')}</td></tr>
                      <tr><td>Venue</td><td>${escapeHtml(fixture?.venue?.name || '—')}</td></tr>
                    </tbody>
                  </table>
                </div>
              `
            )}
          </div>

          <div class="stack">
            ${card(
              'Quick <span>Links</span>',
              `
                <div class="panel-list">
                  <a class="player-mini" data-link href="/club/${slugify(home?.name)}-${home?.id}">
                    <div class="search-icon">🏠</div>
                    <div>${escapeHtml(home?.name || '')}</div>
                    <div class="value-tag">Club</div>
                  </a>
                  <a class="player-mini" data-link href="/club/${slugify(away?.name)}-${away?.id}">
                    <div class="search-icon">🚌</div>
                    <div>${escapeHtml(away?.name || '')}</div>
                    <div class="value-tag">Club</div>
                  </a>
                </div>
              `
            )}
          </div>
        </div>
      </section>
    `;

    app.innerHTML = appShell(content, '');
    bindShell();
  } catch (err) {
    app.innerHTML = appShell(`
      <div class="page">
        <div class="card">
          <div class="empty">Match not found.</div>
        </div>
      </div>
    `, '');
    bindShell();
  }
}

async function router() {
  const app = document.getElementById('app');
  const path = location.pathname;

  app.innerHTML = appShell(loadingPage(), '/');
  bindShell();

  if (path === '/') {
    await renderHome();
    return;
  }

  if (path === '/transfers') {
    await renderTransfers();
    return;
  }

  if (path === '/live') {
    await renderLive();
    return;
  }

  if (path.startsWith('/player/')) {
    await renderPlayer(path);
    return;
  }

  if (path.startsWith('/club/')) {
    await renderClub(path);
    return;
  }

  if (path.startsWith('/league/')) {
    await renderLeague(path);
    return;
  }

  if (path.startsWith('/match/')) {
    await renderMatch(path);
    return;
  }

  document.getElementById('app').innerHTML = appShell(`
    <div class="page">
      <div class="card">
        <div class="empty">Page not found.</div>
      </div>
    </div>
  `, '/');
  bindShell();
}

router();
