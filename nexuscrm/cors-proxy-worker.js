// Cloudflare Worker: adds the CORS headers NVIDIA's and OpenAI's APIs don't
// send themselves, so a browser is allowed to read the response.
// Deploy: workers.cloudflare.com -> Create Worker -> paste this -> Deploy.
// Then paste the resulting https://xxxx.workers.dev URL into
// NexusCRM -> Settings -> AI Providers -> "CORS Proxy URL".
export default {
  async fetch(request) {
    const CORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) return new Response('Missing ?url= parameter', { status: 400, headers: CORS });

    let targetUrl;
    try { targetUrl = new URL(target); } catch (e) {
      return new Response('Invalid url parameter', { status: 400, headers: CORS });
    }

    // Only forwards to providers this app talks to, so this worker can't
    // be abused as an open relay to arbitrary sites.
    const ALLOWED_HOSTS = ['integrate.api.nvidia.com', 'api.openai.com'];
    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return new Response('Host not allowed: ' + targetUrl.hostname, { status: 403, headers: CORS });
    }

    const upstream = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': request.headers.get('Authorization') || ''
      },
      body: request.method === 'POST' ? await request.text() : undefined
    });

    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
