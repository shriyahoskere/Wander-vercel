/*
  wander-core.mjs - the part of the hosted site that holds your keys. Shared by Vercel
  (api/wander.mjs) and Netlify (netlify/edge-functions/wander-api.js).

  The page sends its ElevenLabs and Anthropic requests to /api/wander?route=...; this adds your
  real key, which lives only in the host's environment variables, and passes the request on.
  The key is never sent to the browser. Only the few addresses Wander uses are allowed.

  Environment variables (set them in Vercel or Netlify, then redeploy):
      ELEVENLABS_API_KEY   your ElevenLabs key
      ANTHROPIC_API_KEY    optional: lets Claude sort your thoughts
      WANDER_PASSCODE      a word only you know, so strangers with the link can't spend your credits

  Test the key: open /api/wander?route=/wander/status&check=1&pass=YOURPASSCODE
*/
const ELEVEN_PATHS = /^\/v1\/(speech-to-text$|single-use-token\/realtime_scribe$|text-to-speech\/[A-Za-z0-9]+$)/;

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

/* handle(request, env) where env(name) returns an environment variable. */
export async function handle(req, env) {
  const url = new URL(req.url);
  // /api/wander?route=/eleven/v1/... (both hosts) or /api/eleven/v1/... (older Netlify form)
  let route = url.pathname === '/api/wander' ? (url.searchParams.get('route') || '') : url.pathname.replace(/^\/api/, '');
  const q = route.indexOf('?');
  const routePath = q >= 0 ? route.slice(0, q) : route;
  const routeSearch = q >= 0 ? route.slice(q) : '';

  const eleven = String(env('ELEVENLABS_API_KEY') || '').trim().replace(/^["']|["']$/g, '');
  const anthropic = String(env('ANTHROPIC_API_KEY') || '').trim().replace(/^["']|["']$/g, '');
  const pass = String(env('WANDER_PASSCODE') || '').trim();
  const given = req.headers.get('x-wander-pass') || url.searchParams.get('pass') || '';
  const passOk = !pass || given === pass;

  if (routePath === '/wander/status') {
    const out = { eleven: !!eleven, anthropic: !!anthropic, passcode: !!pass, passOk: passOk };
    if (url.searchParams.get('check') && passOk && eleven) {
      try {
        const r = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', { method: 'POST', headers: { 'xi-api-key': eleven } });
        const t = await r.text();
        out.elevenCheck = r.ok ? 'ok: the key works for live transcription' : 'error ' + r.status + ': ' + t.slice(0, 300);
      } catch (e) { out.elevenCheck = 'The server could not reach ElevenLabs'; }
      out.keyLooksLike = eleven.slice(0, 3) + '... (' + eleven.length + ' characters)';
    }
    return json(out);
  }
  if (!passOk) { return json({ detail: { status: 'passcode', message: 'Wrong or missing Wander passcode.' } }, 401); }

  const headers = new Headers();
  ['content-type', 'accept', 'anthropic-version'].forEach((h) => { const v = req.headers.get(h); if (v) { headers.set(h, v); } });
  let upstream, wrap = false;
  if (routePath.startsWith('/eleven/')) {
    const p = routePath.slice('/eleven'.length);
    if (!ELEVEN_PATHS.test(p)) { return json({ detail: 'Not allowed' }, 403); }
    if (!eleven) { return json({ detail: { status: 'no_key', message: 'No ELEVENLABS_API_KEY is set on this site.' } }, 401); }
    headers.set('xi-api-key', eleven);
    upstream = 'https://api.elevenlabs.io' + p + routeSearch;
  } else if (routePath === '/anthropic/v1/messages') {
    if (!anthropic) { return json({ error: { type: 'authentication_error', message: 'No ANTHROPIC_API_KEY is set on this site.' } }, 401); }
    headers.set('x-api-key', anthropic);
    upstream = 'https://api.anthropic.com/v1/messages';
    wrap = true;
  } else {
    return json({ detail: 'Not found' }, 404);
  }
  if (req.method !== 'POST') { return json({ detail: 'Not allowed' }, 405); }
  const buf = await req.arrayBuffer();
  const body = buf.byteLength ? buf : undefined;

  if (!wrap) {
    try {
      const r = await fetch(upstream, { method: 'POST', headers: headers, body: body });
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' } });
    } catch (e) {
      return json({ detail: 'The server could not reach ElevenLabs.' }, 502);
    }
  }

  // Claude can take a while to start replying, so answer at once and keep the line open with
  // spaces until it is done; the page (js/hosted.js) unwraps { status, body }.
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const beat = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch (e) { /* closed */ } }, 10000);
      let out;
      try {
        const r = await fetch(upstream, { method: 'POST', headers: headers, body: body });
        out = { status: r.status, body: await r.text() };
      } catch (e) {
        out = { status: 502, body: JSON.stringify({ error: { message: 'The server could not reach Anthropic.' } }) };
      }
      clearInterval(beat);
      ctrl.enqueue(enc.encode(JSON.stringify(out)));
      ctrl.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/json', 'x-wander-wrapped': '1', 'cache-control': 'no-store' } });
}
