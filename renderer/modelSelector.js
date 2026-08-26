// renderer/modelSelector.js
// AI Model Selector Module
(function() {
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
        geminiCli: 'Gemini CLI', claudeCli: 'Claude CLI', copilotCli: 'Copilot CLI',
    };

    let CLAUDE_CLI_MODELS = [];
    let COPILOT_CLI_MODELS = [];
    let GEMINI_CLI_MODELS = [];

    function formatAgyLabel(id) {
        if (!id) return 'Gemini CLI';
        const parts = String(id).split('-');
        const BRANDS = { gemini: 'Gemini', claude: 'Claude', gpt: 'GPT', grok: 'Grok', kimi: 'Kimi' };
        const brand = BRANDS[parts[0]];
        if (!brand) return id;

        const TIERS = new Set(['high', 'medium', 'low', 'thinking', 'fast', 'mini']);
        const tier = [];
        while (parts.length > 1 && TIERS.has(parts[parts.length - 1].toLowerCase())) {
            tier.unshift(parts.pop());
        }

        const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
        let label = [brand, ...parts.slice(1).map(cap)].join(' ');
        if (tier.length) label += ` (${tier.map(cap).join(' ')})`;
        return label;
    }

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
                    label: m.label || formatAgyLabel(m.id || m.value || m)
                }));
            }
        } catch (e) {
            console.warn('Failed to load dynamic Gemini CLI models:', e);
        }
        try {
            const copilotRes = await window.electronAPI.getCopilotCliModels();
            if (Array.isArray(copilotRes) && copilotRes.length) {
                COPILOT_CLI_MODELS = copilotRes.map(m => ({
                    value: m.id || m.value || m,
                    label: m.label || m.id || m.value || m
                }));
            }
        } catch (e) {
            console.warn('Failed to load Copilot CLI models:', e);
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
            let m = '';
            try { m = (await window.electronAPI.getGeminiCliModel()) || m; } catch (_) {}
            const found = GEMINI_CLI_MODELS.find(x => x.value === m || x.id === m);
            composerModelName.textContent = found ? found.label : (m ? formatAgyLabel(m) : 'Gemini CLI');
        } else if (provider === 'claudeCli') {
            let m = 'sonnet';
            try { m = (await window.electronAPI.getClaudeCliModel()) || m; } catch (_) {}
            const found = CLAUDE_CLI_MODELS.find(x => x.value === m);
            composerModelName.textContent = found ? found.label : m;
        } else if (provider === 'copilotCli') {
            let m = 'claude-sonnet-4.5';
            try { m = (await window.electronAPI.getCopilotCliModel()) || m; } catch (_) {}
            const found = COPILOT_CLI_MODELS.find(x => x.value === m);
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

    async function showModelMenu(anchor) {
        const provider = anchor.dataset.provider || 'openIa';
        const buildMenu = window.buildModelMenu;
        const setLoad = window.setButtonLoading;

        if (provider === 'geminiCli') {
            setLoad(anchor, true);
            try {
                let currentVal = '';
                try { currentVal = await window.electronAPI.getGeminiCliModel(); } catch (_) {}

                const res = await window.electronAPI.getGeminiCliModels(true);
                if (Array.isArray(res) && res.length) {
                    GEMINI_CLI_MODELS = res.map(m => ({
                        value: m.id || m.value || m,
                        label: m.label || formatAgyLabel(m.id || m.value || m)
                    }));
                }

                const menuList = GEMINI_CLI_MODELS.length ? GEMINI_CLI_MODELS : (
                    currentVal ? [{ value: currentVal, label: formatAgyLabel(currentVal) }] : []
                );

                if (menuList.length === 0) {
                    if (typeof showToast === 'function') showToast('Nenhum modelo retornado pelo agy');
                    return;
                }

                buildMenu(anchor, menuList, () => currentVal, (opt) => {
                    currentVal = opt.value;
                    try { window.electronAPI.setGeminiCliModel(opt.value); } catch (_) {}
                    composerModelName.textContent = opt.label;
                    if (typeof showToast === 'function') showToast('Modelo Antigravity: ' + opt.label);
                });
            } catch (e) {
                console.warn('Falha ao consultar modelos do agy:', e);
                if (typeof showToast === 'function') showToast('Erro ao carregar modelos Antigravity');
            } finally {
                setLoad(anchor, false);
            }
            return;
        }

        if (provider === 'openIa' || provider === 'openIaCodex') {
            let currentVal = '';
            try { currentVal = await window.electronAPI.getOpenaiModel(); } catch (_) {}
            
            const openOpenaiMenu = (modelsList) => {
                buildMenu(anchor, modelsList, () => currentVal, (opt) => {
                    currentVal = opt.value;
                    try { window.electronAPI.setOpenaiModel(opt.value); } catch (_) {}
                    composerModelName.textContent = opt.label;
                    if (typeof showToast === 'function') showToast('Modelo: ' + opt.label);
                });
            };

            try {
                const token = await window.electronAPI.getOpeniaToken();
                if (token) {
                    setLoad(anchor, true);
                    try {
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
                    } finally {
                        setLoad(anchor, false);
                    }
                }
            } catch (e) {
                console.warn("Falha ao buscar modelos OpenAI online:", e);
            }
            
            openOpenaiMenu(OPENAI_MODELS);
            return;
        }

        if (provider === 'claudeCli') {
            if (!CLAUDE_CLI_MODELS.length) {
                setLoad(anchor, true);
                try {
                    const claudeRes = await window.electronAPI.getClaudeCliModels();
                    if (Array.isArray(claudeRes) && claudeRes.length) {
                        CLAUDE_CLI_MODELS = claudeRes.map(m => ({
                            value: m.id || m.value || m,
                            label: m.label || m.id || m.value || m
                        }));
                    }
                } catch (e) {
                    console.warn('Failed to load Claude CLI models:', e);
                } finally {
                    setLoad(anchor, false);
                }
            }
            let currentVal = '';
            try { currentVal = await window.electronAPI.getClaudeCliModel(); } catch (_) {}
            buildMenu(anchor, CLAUDE_CLI_MODELS, () => currentVal, (opt) => {
                currentVal = opt.value;
                try { window.electronAPI.setClaudeCliModel(opt.value); } catch (_) {}
                composerModelName.textContent = opt.label;
                if (typeof showToast === 'function') showToast('Modelo: ' + opt.label);
            });
            return;
        }

        if (provider === 'copilotCli') {
            if (!COPILOT_CLI_MODELS.length) {
                setLoad(anchor, true);
                try {
                    const copilotRes = await window.electronAPI.getCopilotCliModels();
                    if (Array.isArray(copilotRes) && copilotRes.length) {
                        COPILOT_CLI_MODELS = copilotRes.map(m => ({
                            value: m.id || m.value || m,
                            label: m.label || m.id || m.value || m
                        }));
                    }
                } catch (e) {
                    console.warn('Failed to load Copilot CLI models:', e);
                } finally {
                    setLoad(anchor, false);
                }
            }
            let currentVal = '';
            try { currentVal = await window.electronAPI.getCopilotCliModel(); } catch (_) {}
            buildMenu(anchor, COPILOT_CLI_MODELS, () => currentVal, (opt) => {
                currentVal = opt.value;
                try { window.electronAPI.setCopilotCliModel(opt.value); } catch (_) {}
                composerModelName.textContent = opt.label;
                if (typeof showToast === 'function') showToast('Modelo: ' + opt.label);
            });
            return;
        }

        if (provider === 'llama' || provider === 'llama-stream') {
            try {
                let currentVal = '';
                try { currentVal = await window.electronAPI.getBackendModel(); } catch (_) {}

                const url = await window.electronAPI.getBackendUrl();
                let models = [];

                if (url) {
                    const baseUrl = url.replace(/\/+$/, '');
                    const apiKey = (await window.electronAPI.getBackendApiKey()) || '';
                    const headers = { 'ngrok-skip-browser-warning': 'true' };
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

                buildMenu(anchor, menuModels, () => currentVal, (opt) => {
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
                buildMenu(anchor, menuModels, () => currentVal, (opt) => {
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
            if (window.electronAPI.openConfig) window.electronAPI.openConfig();
        }
    }

    refreshComposerModel();

    window.addEventListener('focus', () => { refreshComposerModel(); });
    if (window.electronAPI && window.electronAPI.onAiModelChanged) {
        window.electronAPI.onAiModelChanged(() => {
            refreshComposerModel();
        });
    }

    window.loadCliModels = loadCliModels;
    window.refreshComposerModel = refreshComposerModel;
    window.showModelMenu = showModelMenu;

    if (composerModelBtn) {
        composerModelBtn.addEventListener('click', (e) => { e.stopPropagation(); showModelMenu(composerModelBtn); });
    }
})();
