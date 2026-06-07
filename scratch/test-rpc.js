const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

async function run() {
  const shiftsRes = await fetch(`${url}/rest/v1/shifts?select=id&limit=1`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const shifts = await shiftsRes.json();
  if (!shifts || shifts.length === 0) return console.log('No shifts');
  
  const id = shifts[0].id;
  console.log('Using shift id:', id);

  const rpcRes = await fetch(`${url}/rest/v1/rpc/check_in_shift`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_shift_id: id, p_lat: -33.921136, p_lon: 151.232131 })
  });
  
  const data = await rpcRes.text();
  console.log('Status:', rpcRes.status);
  console.log('Result:', data);
}
run();
