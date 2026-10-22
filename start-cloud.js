// Start command on Render (free plan): first bring back the saved data from Supabase, then start the portal.
// If Supabase cannot be reached the portal does NOT start, so it never runs on an empty database by mistake.
const path = require('path');
const cloud = require('./server/cloud');

(async () => {
  if (!cloud.enabled) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (Render > Environment) before starting.');
    process.exit(1);
  }
  const dataDir = process.env.SAO_DATA_DIR || path.join(__dirname, 'data');
  try { await cloud.restore(dataDir); }
  catch (e) { console.error('Could not load the data from Supabase:', e.message); process.exit(1); }
  require('./server.js');
})();
