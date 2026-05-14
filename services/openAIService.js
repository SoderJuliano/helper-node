const { ipcMain } = require('electron');
const axios = require('axios');

class OpenAIService {
    constructor() {
        this.sessions = {};
    }

    initialize() {
        // This service is now initialized in main.js, but the request handling is done via direct calls,
        // not via ipc events to the service itself. This initialize method is kept for consistency.
    }

    async makeOpenAIRequest(prompt, token, instruction, model, imageBase64) {
        const sessionId = 'default'; // Using a single session for now
        const now = Date.now();
        const twoHours = 2 * 60 * 60 * 1000;

        // Clear session if inactive for more than 2 hours
        if (this.sessions[sessionId] && (now - this.sessions[sessionId].lastActivity > twoHours)) {
            delete this.sessions[sessionId];
            console.log('OpenAI session expired and was cleared.');
        }

        // Create a new session if it doesn't exist
        if (!this.sessions[sessionId]) {
            console.log('Creating new OpenAI session.');
            this.sessions[sessionId] = {
                messages: [{ role: 'system', content: instruction || 'You are a helpful assistant.' }],
                lastActivity: now
            };
        }

        // Build user message — multimodal if image fornecida
        let userMessage;
        if (imageBase64) {
            // Detecta prefixo data: já presente; senão assume PNG
            const dataUrl = imageBase64.startsWith('data:')
                ? imageBase64
                : `data:image/png;base64,${imageBase64}`;
            userMessage = {
                role: 'user',
                content: [
                    { type: 'text', text: prompt || 'Analise a imagem e responda diretamente.' },
                    { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
                ],
            };
        } else {
            userMessage = { role: 'user', content: prompt };
        }

        this.sessions[sessionId].messages.push(userMessage);
        this.sessions[sessionId].lastActivity = now;

        console.log('Sending request to OpenAI API...');
        const requestPayload = {
            model: model || 'gpt-4.1-nano',
            messages: this.sessions[sessionId].messages,
        };
        // Log enxuto quando há imagem (não printar base64 inteiro nos logs)
        if (imageBase64) {
            console.log('OpenAI Request Payload (with image, base64 omitted):', JSON.stringify({
                ...requestPayload,
                messages: requestPayload.messages.map(m =>
                    Array.isArray(m.content)
                        ? { ...m, content: m.content.map(c => c.type === 'image_url'
                            ? { type: 'image_url', image_url: { url: '[base64 omitted]', detail: 'high' } }
                            : c) }
                        : m
                ),
            }, null, 2));
        } else {
            console.log('OpenAI Request Payload:', JSON.stringify(requestPayload, null, 2));
        }

        try {
            const response = await axios.post('https://api.openai.com/v1/chat/completions', requestPayload, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('Received response from OpenAI API.');
            const assistantResponse = response.data.choices[0].message.content;
            // Add assistant's response to the session history
            this.sessions[sessionId].messages.push({ role: 'assistant', content: assistantResponse });

            return assistantResponse;
        } catch (error) {
            console.error('Error calling OpenAI API:', error.response ? error.response.data : error.message);
            // Remove the last user message if the API call fails to avoid cluttering the history
            this.sessions[sessionId].messages.pop();
            throw new Error('Failed to get a response from OpenAI.');
        }
    }
}

module.exports = new OpenAIService();
