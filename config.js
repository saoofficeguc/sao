// Where the app finds its server.
// On GitHub Pages the pages and the server are separate: the server is the Supabase Edge Function.
// Anywhere else (node server.js on a computer or VPS) the server is the same address as the pages.
window.SAO_API = /\.github\.io$/.test(location.hostname)
  ? 'https://chrgfpssxaapsghcgxql.supabase.co/functions/v1/sao'
  : '';
