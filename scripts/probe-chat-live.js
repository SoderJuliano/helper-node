// Probe cru do /chat do pikachu: mede quando o 1o byte chega e imprime o SSE.
// Uso: node scripts/probe-chat-live.js [modelo] [texto]
const { createUrlDiscovery } = require('../services/backendUrlDiscovery');
const configService = require('../services/configService');

(async () => {
  const model = process.argv[2] || 'qwen3.6:35b';
  const texto = process.argv[3] || 'oi';
  const url = await createUrlDiscovery().discover();
  if (!url) { console.error('sem URL'); process.exit(1); }

  const instruction = configService.getPromptInstruction();
  const prompt = `${instruction}\n\nConversation context:\nuser: ${texto}\nPlease respond to the latest human message.`;
  const endpoint = `${url}/chat?model=${encodeURIComponent(model)}`;
  console.log('POST', endpoint, `(prompt ${prompt.length} chars)`);

  const t0 = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer Y3VzdG9tY3ZvbmxpbmU=',
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      'apikey': configService.getBackendApiKey() || '',
      'x-api-key': configService.getBackendApiKey() || '',
    },
    body: JSON.stringify({ prompt, language: 'PORTUGUESE' }),
  });
  console.log(`+${Date.now() - t0}ms headers status=${res.status} ct=${res.headers.get('content-type')}`);
  if (!res.ok) { console.log(await res.text()); process.exit(1); }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let n = 0, total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) { console.log(`+${Date.now() - t0}ms STREAM DONE (${n} chunks, ${total} bytes)`); break; }
    const s = dec.decode(value, { stream: true });
    total += s.length; n++;
    if (n <= 12 || n % 50 === 0) {
      console.log(`+${Date.now() - t0}ms chunk#${n} ${JSON.stringify(s.slice(0, 220))}`);
    }
  }
})().catch((e) => { console.error('ERRO', e.message, e.cause && e.cause.message); process.exit(1); });
