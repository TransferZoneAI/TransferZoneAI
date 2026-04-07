const API = '/api/football';

const state = {
  searchOpen: false,
  searchResults: [],
};

const routes = {
  '/': renderHome,
  '/transfers': renderTransfers,
  '/live': renderLive,
};

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
router();
