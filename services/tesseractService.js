/**
 * services/tesseractService.js
 * Adaptador de captura e processamento direto de imagem (Direct Vision Stream).
 * Tesseract.js e modelos locais de OCR foram descontinuados e purgados em favor
 * da visão multimodal nativa dos modelos de IA (Gemini, ChatGPT, Copilot CLI).
 */

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const sharp = require('sharp');

const execPromise = util.promisify(exec);

class TesseractService {
    /**
     * Captura tela e envia diretamente para o canal multimodal.
     */
    async captureAndProcessScreenshot(mainWindow) {
        const timestamp = Date.now();
        const originalScreenshotPath = path.join(__dirname, '..', `screenshot-original-${timestamp}.png`);

        try {
            console.log('[VisionService] Capturando tela para visão direta...');
            const command = `spectacle --background --activewindow --nonotify --output "${originalScreenshotPath}"`;
            await execPromise(command);
            console.log('[VisionService] Screenshot salvo:', originalScreenshotPath);

            await this._processImageFile(originalScreenshotPath, mainWindow, false);
        } catch (error) {
            console.error('[VisionService] Erro na captura:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ocr-error', 'Falha ao capturar tela.');
            }
        }
    }

    /**
     * Salva imagem colada e envia para o canal de visão direta.
     */
    async processPastedImage(base64Image, mainWindow) {
        const timestamp = Date.now();
        const originalScreenshotPath = path.join(__dirname, '..', `screenshot-pasted-${timestamp}.png`);
        
        try {
            const buffer = Buffer.from(base64Image.split(';base64,').pop(), 'base64');
            await fs.writeFile(originalScreenshotPath, buffer);
            console.log('[VisionService] Imagem colada salva para visão direta:', originalScreenshotPath);

            await this._processImageFile(originalScreenshotPath, mainWindow, true);
        } catch (error) {
            console.error('[VisionService] Erro ao salvar imagem colada:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ocr-error', 'Falha ao processar imagem colada.');
            }
        }
    }

    /**
     * Extrai conteúdo textual e visual via Google Gemini Vision ou OpenAI Vision.
     */
    async getTextFromImage(base64Image) {
        try {
            const visionService = require('./visionService');
            return await visionService.extractContentFromImage(base64Image);
        } catch (e) {
            console.warn('[VisionService] Falha na extração de texto da imagem:', e.message);
            return '';
        }
    }

    async _processImageFile(originalPath, mainWindow, isPasted = false) {
        try {
            const visionService = require('./visionService');
            let text = '';
            try {
                text = await visionService.extractContentFromImage(originalPath);
            } catch (err) {
                console.warn('[VisionService] Não foi possível extrair visão do arquivo:', err.message);
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ocr-result', { 
                    text: text || '', 
                    screenshotPath: originalPath,
                    isDirectVision: true
                });
            }
            return { text: text || '', screenshotPath: originalPath };
        } catch (error) {
            console.error('[VisionService] Erro no processamento de imagem:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ocr-result', {
                    text: '',
                    screenshotPath: originalPath,
                    isDirectVision: true
                });
            }
            return { text: '', screenshotPath: originalPath };
        }
    }
}

module.exports = new TesseractService();