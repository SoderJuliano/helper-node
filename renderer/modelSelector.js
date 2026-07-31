// AI Model Selector Module
(function() {
            // === Seletor de modelo no composer (estilo ZCode) ===
            // Provider = ChatGPT → troca o modelo gpt inline; outros providers
            // → abre Configurações (não há lista de endpoints inline ainda).
            const OPENAI_MODELS = [
                { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
                { value: 'gpt-4.1', label: 'GPT-4.1' },
                { value: 'gpt-5.1', label: 'GPT-5.1' },
                { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
                { value: 'gpt-5.4', label: 'GPT-5.4' },
                { value: 'gpt-5.5', label: 'GPT-5.5' },
                { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
                { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
                { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
            ];
            const PROVIDER_LABELS = {
                openIa: 'ChatGPT', openIaCodex: 'OpenAI Codex', llama: 'Ollama Backend',
                'llama-stream': 'Ollama Backend (stream)', ollamaLocal: 'Ollama Local',
                geminiCli: 'Gemini CLI', claudeCli: 'Claude CLI',
            };
            // Claude Code CLI: preenchido por loadCliModels() a partir do binário `claude`.
            // Começa vazio de propósito — qualquer nome de modelo escrito aqui fica
            // desatualizado sozinho e aparece na tela diferente do que o CLI mostra.
            let CLAUDE_CLI_MODELS = [];
            // Gemini CLI model list (initially mirrored, loaded dynamically later)
            let GEMINI_CLI_MODELS = [
                { value: 'Gemini 3.5 Flash (High)',      label: 'Gemini 3.5 Flash (High)'      },
                { value: 'Gemini 3.5 Flash (Medium)',    label: 'Gemini 3.5 Flash (Medium)'    },
                { value: 'Gemini 3.5 Flash (Low)',       label: 'Gemini 3.5 Flash (Low)'       },
                { value: 'Gemini 3.1 Pro (High)',        label: 'Gemini 3.1 Pro (High)'        },
                { value: 'Gemini 3.1 Pro (Low)',         label: 'Gemini 3.1 Pro (Low)'         },
                { value: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)' },
                { value: 'Claude Opus 4.6 (Thinking)',   label: 'Claude Opus 4.6 (Thinking)'   },
                { value: 'GPT-OSS 120B (Medium)',        label: 'GPT-OSS 120B (Medium)'        },
            ];

            async function loadCliModels() {
                try {
                    const claudeRes = await window.electronAPI.getClaudeCliModels();
                    if (Array.isArray(claudeRes) && claudeRes.length) {
                        CLAUDE_CLI_MODELS = claudeRes.map(m => ({
                            value: m.id || m.value || m,
                            label: m.label || m.id || m.value || m
                        }));
                    }
                } catch (e) {
                    console.warn('Failed to load dynamic Claude CLI models:', e);
                }
                try {
                    const geminiRes = await window.electronAPI.getGeminiCliModels();
                    if (Array.isArray(geminiRes) && geminiRes.length) {
                        GEMINI_CLI_MODELS = geminiRes.map(m => ({
                            value: m.id || m.value || m,
                            label: m.label || m.id || m.value || m
                        }));
                    }
                } catch (e) {
                    console.warn('Failed to load dynamic Gemini CLI models:', e);
                }
            }

            const composerModelBtn = document.getElementById('composer-model');
            const composerModelName = document.getElementById('composer-model-name');

            async function refreshComposerModel() {
                if (!composerModelBtn || !composerModelName) return;
                await loadCliModels();
                let provider = 'openIa';
                try { provider = (await window.electronAPI.getAiModel()) || 'openIa'; } catch (_) {}
                composerModelBtn.dataset.provider = provider;
                if (provider === 'openIa' || provider === 'openIaCodex') {
                    let m = 'gpt-4.1-nano';
                    try { m = (await window.electronAPI.getOpenaiModel()) || m; } catch (_) {}
                    const found = OPENAI_MODELS.find(x => x.value === m);
                    composerModelName.textContent = found ? found.label : m;
                } else if (provider === 'geminiCli') {
                    let m = 'Gemini 3.5 Flash (Medium)';
                    try { m = (await window.electronAPI.getGeminiCliModel()) || m; } catch (_) {}
                    const found = GEMINI_CLI_MODELS.find(x => x.value === m);
                    composerModelName.textContent = found ? found.label : m;
                } else if (provider === 'claudeCli') {
                    let m = 'sonnet';
                    try { m = (await window.electronAPI.getClaudeCliModel()) || m; } catch (_) {}
                    const found = CLAUDE_CLI_MODELS.find(x => x.value === m);
                    composerModelName.textContent = found ? found.label : m;
                } else if (provider === 'llama' || provider === 'llama-stream') {
                    let m = '';
                    try { m = (await window.electronAPI.getBackendModel()) || ''; } catch (_) {}
                    if (!m) {
                        try {
                            const url = await window.electronAPI.getBackendUrl();
                            if (url) {
                                const baseUrl = url.replace(/\/+$/, '');
                                const apiKey = (await window.electronAPI.getBackendApiKey()) || '';
                                const headers = { 'ngrok-skip-browser-warning': 'true' };
                                if (apiKey) headers['x-api-key'] = apiKey;
                                const res = await fetch(`${baseUrl}/models`, { headers });
                                if (res.ok) {
                                    const data = await res.json();
                                    if (data.models && data.models.length > 0) {
                                        const first = typeof data.models[0] === 'object' ? data.models[0].name : data.models[0];
                                        if (first) {
                                            m = first;
                                            try { window.electronAPI.setBackendModel(first); } catch (_) {}
                                        }
                                    }
                                }
                            }
                        } catch (_) {}
                    }
                    composerModelName.textContent = m || (provider === 'llama-stream' ? 'Ollama Stream' : 'Ollama Backend');
                } else if (provider === 'ollamaLocal') {
                    let m = '';
                    try { m = (await window.electronAPI.getOllamaLocalModel()) || ''; } catch (_) {}
                    if (!m) {
                        try {
                            const status = await window.electronAPI.checkOllamaLocalStatus();
                            if (status && status.running && Array.isArray(status.models) && status.models.length > 0) {
                                m = status.models[0];
                                try { window.electronAPI.setOllamaLocalModel(m); } catch (_) {}
                            }
                        } catch (_) {}
                    }
                    composerModelName.textContent = m || 'Ollama Local';
                } else {
                    composerModelName.textContent = PROVIDER_LABELS[provider] || provider;
                }
            }

            function _buildModelMenu(anchor, models, getCurrentValue, onSelect) {
                document.querySelectorAll('.composer-model-menu').forEach(m => m.remove());
                const menu = document.createElement('div');
                menu.className = 'composer-model-menu';
                menu.style.cssText = 'position:absolute; z-index:9999; background:var(--bg-elevated); border:1px solid var(--border-strong); border-radius:8px; padding:4px; box-shadow:0 10px 30px rgba(0,0,0,0.55); min-width:200px; -webkit-app-region: no-drag;';
                const current = composerModelName.textContent;
                models.forEach(opt => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    const active = opt.label === current || opt.value === getCurrentValue();
                    b.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; text-align:left; background:transparent; border:none; color:' + (active ? 'var(--accent-2)' : 'var(--text-2)') + '; font-size:12px; padding:7px 10px; cursor:pointer; border-radius:5px; font-family:var(--font-ui);';
                    b.innerHTML = '<span>' + opt.label + '</span>' + (active ? '<span>✓</span>' : '');
                    b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.06)');
                    b.addEventListener('mouseleave', () => b.style.background = 'transparent');
                    b.addEventListener('click', () => {
                        menu.remove();
                        onSelect(opt);
                    });
                    menu.appendChild(b);
                });
                document.body.appendChild(menu);
                const r = anchor.getBoundingClientRect();
                menu.style.left = r.left + 'px';
                menu.style.top = (r.top - menu.offsetHeight - 6) + 'px';
                const closer = (ev) => {
                    if (!menu.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
                        menu.remove();
                        document.removeEventListener('click', closer, true);
                    }
                };
                setTimeout(() => document.addEventListener('click', closer, true), 0);
            }

            async function showModelMenu(anchor) {
                const provider = anchor.dataset.provider || 'openIa';
                await loadCliModels();
                if (provider === 'openIa' || provider === 'openIaCodex') {
                    let currentVal = '';
                    try { currentVal = await window.electronAPI.getOpenaiModel(); } catch (_) {}
                    
                    const openOpenaiMenu = (modelsList) => {
                        _buildModelMenu(anchor, modelsList, () => currentVal, (opt) => {
                            currentVal = opt.value;
                            try { window.electronAPI.setOpenaiModel(opt.value); } catch (_) {}
                            composerModelName.textContent = opt.label;
                            if (typeof showToast === 'function') showToast('Modelo: ' + opt.label);
                        });
                    };

                    try {
                        const token = await window.electronAPI.getOpeniaToken();
                        if (token) {
                            if (typeof showToast === 'function') showToast('Carregando modelos OpenAI...');
                            const res = await fetch("https://api.openai.com/v1/models", {
                                method: "GET",
                                headers: {
                                    "Authorization": `Bearer ${token}`
                                }
                            });
                            if (res.ok) {
                                const data = await res.json();
                                if (data.data && Array.isArray(data.data)) {
                                    const dynamicModels = data.data
                                        .map(m => m.id)
                                        .filter(id => id.startsWith('gpt-') || id.startsWith('o1-') || id.startsWith('o3-'))
                                        .sort()
                                        .map(id => ({ value: id, label: id }));
                                    
                                    if (dynamicModels.length > 0) {
                                        openOpenaiMenu(dynamicModels);
                                        return;
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.warn("Falha ao buscar modelos OpenAI online:", e);
                    }
                    
                    // Fallback
                    openOpenaiMenu(OPENAI_MODELS);
                } else if (provider === 'geminiCli') {
                    let currentVal = '';
                    _buildModelMenu(anchor, GEMINI_CLI_MODELS, () => currentVal, (opt) => {
                        currentVal = opt.value;
                        try { window.electronAPI.setGeminiCliModel(opt.value); } catch (_) {}
                        composerModelName.textContent = opt.label;
                        if (typeof showToast === 'function') showToast('Modelo: ' + opt.label);
                    });
                } else if (provider === 'claudeCli') {
                    let currentVal = '';
                    _buildModelMenu(anchor, CLAUDE_CLI_MODELS, () => currentVal, (opt) => {
                        currentVal = opt.value;
                        try { window.electronAPI.setClaudeCliModel(opt.value); } catch (_) {}
                        composerModelName.textContent = opt.label;
                        if (typeof showToast === 'function') showToast('Modelo: ' + opt.label);
                    });
                } else if (provider === 'llama' || provider === 'llama-stream') {
                    try {
                        let currentVal = '';
                        try { currentVal = await window.electronAPI.getBackendModel(); } catch (_) {}

                        const url = await window.electronAPI.getBackendUrl();
                        let models = [];

                        if (url) {
                            const baseUrl = url.replace(/\/+$/, '');
                            const apiKey = (await window.electronAPI.getBackendApiKey()) || '';
                            const headers = {
                                'ngrok-skip-browser-warning': 'true'
                            };
                            if (apiKey) headers['x-api-key'] = apiKey;

                            let data = null;
                            try {
                                const res = await fetch(`${baseUrl}/models`, { method: 'GET', headers });
                                if (res && res.ok) data = await res.json();
                            } catch (_) {}

                            if (!data) {
                                try {
                                    const res = await fetch(`${baseUrl}/api/tags`, { method: 'GET', headers });
                                    if (res && res.ok) data = await res.json();
                                } catch (_) {}
                            }

                            if (!data) {
                                try {
                                    const res = await fetch(`${baseUrl}/v1/models`, { method: 'GET', headers });
                                    if (res && res.ok) data = await res.json();
                                } catch (_) {}
                            }

                            if (data) {
                                if (data.models && Array.isArray(data.models)) {
                                    models = data.models;
                                } else if (data.data && Array.isArray(data.data)) {
                                    models = data.data;
                                } else if (Array.isArray(data)) {
                                    models = data;
                                }
                            }
                        }

                        let parsedNames = models.map(m => typeof m === 'object' ? (m.name || m.model || m.id || String(m)) : String(m)).filter(Boolean);

                        if (parsedNames.length === 0) {
                            const defaultFallbacks = ['qwen2.5-coder:7b', 'llama3.1:8b', 'llama3:8b', 'gemma2:9b'];
                            if (currentVal && !defaultFallbacks.includes(currentVal)) {
                                parsedNames = [currentVal, ...defaultFallbacks];
                            } else {
                                parsedNames = defaultFallbacks;
                            }
                        }

                        const menuModels = parsedNames.map(name => ({ value: name, label: name }));

                        _buildModelMenu(anchor, menuModels, () => currentVal, (opt) => {
                            currentVal = opt.value;
                            try { window.electronAPI.setBackendModel(opt.value); } catch (_) {}
                            composerModelName.textContent = opt.label;
                            if (typeof showToast === 'function') showToast('Modelo: ' + opt.label);
                        });
                    } catch (err) {
                        console.error('Erro ao buscar modelos do backend:', err);
                        if (typeof showToast === 'function') showToast('Erro ao carregar modelos do servidor');
                    }
                } else if (provider === 'ollamaLocal') {
                    try {
                        let currentVal = '';
                        try { currentVal = await window.electronAPI.getOllamaLocalModel(); } catch (_) {}
                        const status = await window.electronAPI.checkOllamaLocalStatus();
                        let models = [];
                        if (status && status.running && Array.isArray(status.models)) {
                            models = status.models;
                        }
                        if (models.length === 0) {
                            if (typeof showToast === 'function') showToast('Nenhum modelo baixado no Ollama Local');
                            if (window.electronAPI.openConfig) window.electronAPI.openConfig();
                            return;
                        }
                        const menuModels = models.map(m => ({ value: m, label: m }));
                        _buildModelMenu(anchor, menuModels, () => currentVal, (opt) => {
                            currentVal = opt.value;
                            try { window.electronAPI.setOllamaLocalModel(opt.value); } catch (_) {}
                            composerModelName.textContent = opt.label;
                            if (typeof showToast === 'function') showToast('Modelo: ' + opt.label);
                        });
                    } catch (err) {
                        console.error('Erro ao buscar modelos do Ollama Local:', err);
                        if (window.electronAPI.openConfig) window.electronAPI.openConfig();
                    }
                } else {
                    // Outro provedor: abre Configurações.
                    if (window.electronAPI.openConfig) window.electronAPI.openConfig();
                }
            }

            refreshComposerModel();

            // Reflete mudanças feitas na janela de Configurações ao voltar o foco ou via IPC
            window.addEventListener('focus', () => { refreshComposerModel(); });
            if (window.electronAPI && window.electronAPI.onAiModelChanged) {
                window.electronAPI.onAiModelChanged(() => {
                    refreshComposerModel();
                });
            }

    // Register handlers on window
    window.loadCliModels = loadCliModels;
    window.refreshComposerModel = refreshComposerModel;
    window.showModelMenu = showModelMenu;

    // Listeners
    if (composerModelBtn) {
        composerModelBtn.addEventListener('click', (e) => { e.stopPropagation(); showModelMenu(composerModelBtn); });
    }
})();
