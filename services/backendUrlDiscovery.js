// Descoberta da URL do backend (pikachu).
//
// Vive separado do backendService por causa da regra das 500 linhas e porque a
// lógica aqui não tem nada a ver com prompt/tool loop: é só achar um endereço
// que responde e provar que é o pikachu.
//
// Dois defeitos que este módulo corrige:
//
// 1. LOCALHOST NUNCA ERA TENTADO. Quando o app roda na MESMA máquina do pikachu
//    (o caso do server Linux), o endereço certo é 127.0.0.1:8080. O código
//    antigo só olhava o túnel do abra-api e, no fallback, montava
//    `http://<IP PÚBLICO>:8080` a partir do api.ipify.org — que esbarra em
//    NAT/firewall e só devolve timeout. Ou seja: na máquina onde o backend é
//    local, os dois caminhos testados eram justamente os que não funcionam.
//
// 2. FALHA TRANSITÓRIA APAGAVA A URL BOA. O catch fazia `apiUrl = ""`, então um
//    timeout de 5s no abra-api derrubava o backend no envio seguinte. Aqui a
//    última URL que funcionou nunca é descartada sem substituto.
//
// Coberto por scripts/test-backend-url.js (npm run test:url).

const axios = require('axios');

const TUNNEL_REGISTRY = 'https://abra-api.top/notifications/retrieve?key=ngrockurl';
const LOCAL_BACKEND = 'http://127.0.0.1:8080';
const CACHE_TTL_MS = 60000;
const PROBE_TIMEOUT_MS = 2500;

/**
 * A URL responde como pikachu? Confere /models de verdade — sem isso, qualquer
 * coisa escutando na porta 8080 era adotada e todas as requisições seguintes
 * falhavam com erro sem sentido.
 */
async function looksLikePikachu(url, timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    const res = await fetch(`${url}/models`, {
      method: 'GET',
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return !!(body && body.models);
  } catch (_) {
    return false;
  }
}

/** Busca só a string da URL no registro do túnel; falhar aqui é tolerável. */
async function fetchTunnelUrl() {
  try {
    const res = await axios.get(TUNNEL_REGISTRY, {
      timeout: 5000,
      headers: { 'Cache-Control': 'no-cache' },
    });
    const data = res.data;
    if (Array.isArray(data) && data.length > 0) {
      const last = data[data.length - 1];
      const fetched = last && last.content && String(last.content).trim().replace(/\/+$/, '');
      if (fetched && fetched.startsWith('http')) return fetched;
    }
  } catch (e) {
    console.warn('[backend-url] registro do túnel indisponível:', e && e.message);
  }
  return null;
}

/**
 * Cria um descobridor com cache próprio.
 *
 * @param {Object} deps  injetáveis pro teste (probe/tunnel)
 */
function createUrlDiscovery(deps = {}) {
  const probe = deps.looksLikePikachu || looksLikePikachu;
  const tunnel = deps.fetchTunnelUrl || fetchTunnelUrl;

  let cachedUrl = null;
  let lastFetch = 0;

  async function discover() {
    const now = Date.now();
    if (cachedUrl && now - lastFetch < CACHE_TTL_MS) return cachedUrl;

    const tunnelUrl = await tunnel();
    const candidatos = [
      // Override manual, pra depurar sem depender de descoberta nenhuma.
      process.env.HELPER_BACKEND_URL && process.env.HELPER_BACKEND_URL.replace(/\/+$/, ''),
      // Backend na própria máquina. Fora dela a recusa é imediata
      // (ECONNREFUSED), então testar primeiro não custa nada.
      LOCAL_BACKEND,
      tunnelUrl,
      cachedUrl,
    ].filter(Boolean);

    for (const cand of candidatos) {
      if (await probe(cand)) {
        if (cand !== cachedUrl) console.log(`[backend-url] backend em ${cand}`);
        cachedUrl = cand;
        lastFetch = now;
        return cachedUrl;
      }
    }

    // Nada respondeu. Se havia URL boa, MANTÉM: pode ser blip de rede, e
    // apagá-la transformava isso em "backend indisponível" pro usuário.
    if (cachedUrl) {
      console.warn(`[backend-url] nenhum candidato respondeu; mantendo ${cachedUrl}`);
      return cachedUrl;
    }

    console.log('[backend-url] nenhuma URL disponível. Candidatos: ' + candidatos.join(', '));
    return null;
  }

  return {
    discover,
    get cached() { return cachedUrl; },
    set cached(v) { cachedUrl = v; },
    get lastFetch() { return lastFetch; },
    set lastFetch(v) { lastFetch = v; },
    reset() { cachedUrl = null; lastFetch = 0; },
  };
}

module.exports = {
  createUrlDiscovery,
  looksLikePikachu,
  fetchTunnelUrl,
  LOCAL_BACKEND,
  CACHE_TTL_MS,
};
