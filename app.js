const app = document.getElementById('app');

function render() {
  app.innerHTML = `
    <div style="min-height:100vh;color:white;padding:40px;font-family:Arial,sans-serif;">
      <h1 style="font-size:48px;margin:0 0 16px;">TransferZoneAI</h1>
      <p style="font-size:20px;margin:0;">Vanilla rebuild is alive.</p>
    </div>
  `;
}

render();
