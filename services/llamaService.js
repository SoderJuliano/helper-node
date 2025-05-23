const axios = require('axios');

class LlamaService {
    async responder(texto) {
        try {
            const prompt = `Responda esta questão em com até 50 palavras: ${texto}`;
            const response = await axios.post('http://localhost:11434/api/generate', {
                model: 'llama3',
                prompt: prompt,
                stream: false
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            });

            const resposta = response.data.response;
            console.log('LLaMA response:', response.data);
            // Opcional: substituir \n por <br> para renderização em HTML
            const formattedResposta = resposta.replace(/\n/g, '<br>');
            return formattedResposta;
        } catch (error) {
            console.error('Erro ao chamar LLaMA:', error.message);
            throw new Error('Falha ao processar a resposta do LLaMA');
        }
    }
}

module.exports = new LlamaService();