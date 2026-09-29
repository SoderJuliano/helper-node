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
     * Extrai texto via OCR usando tesseract binário local como fallback ultrarrápido
     */
    async extractTextLocalTesseract(imageInput) {
        const fsSync = require('fs');
        const os = require('os');
        let tempFile = null;
        let imagePath = null;

        try {
            if (typeof imageInput === 'string' && fsSync.existsSync(imageInput)) {
                imagePath = imageInput;
            } else if (typeof imageInput === 'string' && (imageInput.startsWith('data:image/') || imageInput.length > 200)) {
                const base64Data = imageInput.replace(/^data:image\/\w+;base64,/, '');
                tempFile = path.join(os.tmpdir(), `tess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`);
                await fs.writeFile(tempFile, Buffer.from(base64Data, 'base64'));
                imagePath = tempFile;
            } else if (Buffer.isBuffer(imageInput)) {
                tempFile = path.join(os.tmpdir(), `tess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`);
                await fs.writeFile(tempFile, imageInput);
                imagePath = tempFile;
            }

            if (!imagePath) return '';

            const projectRoot = path.join(__dirname, '..');
            const hasPorTrained = fsSync.existsSync(path.join(projectRoot, 'por.traineddata'));
            const tessDataArg = hasPorTrained ? `--tessdata-dir "${projectRoot}" -l por+eng` : '-l por+eng';

            const cmd = `tesseract "${imagePath}" stdout ${tessDataArg} 2>/dev/null`;
            const { stdout } = await execPromise(cmd, { timeout: 6000 });
            return (stdout || '').trim();
        } catch (e) {
            try {
                if (imagePath) {
                    const { stdout } = await execPromise(`tesseract "${imagePath}" stdout 2>/dev/null`, { timeout: 4000 });
                    return (stdout || '').trim();
                }
            } catch (_) {}
            return '';
        } finally {
            if (tempFile) {
                try { await fs.unlink(tempFile); } catch (_) {}
            }
        }
    }

    /**
     * Extrai conteúdo textual e visual via Google Gemini Vision ou OpenAI Vision com fallback para Tesseract local.
     */
    async getTextFromImage(base64Image) {
        try {
            const visionService = require('./visionService');
            const cloudText = await visionService.extractContentFromImage(base64Image);
            if (cloudText && cloudText.trim()) return cloudText.trim();
        } catch (e) {
            console.warn('[VisionService] Falha na extração de texto da imagem:', e.message);
        }

        try {
            const localText = await this.extractTextLocalTesseract(base64Image);
            if (localText && localText.trim()) {
                console.log(`[TesseractService] ✅ OCR local extraiu ${localText.length} caracteres com sucesso`);
                return localText.trim();
            }
        } catch (err) {
            console.warn('[TesseractService] OCR local tesseract falhou:', err.message);
        }

        return '';
    }

    async _processImageFile(originalPath, mainWindow, isPasted = false) {
        try {
            let text = '';
            try {
                text = await this.getTextFromImage(originalPath);
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