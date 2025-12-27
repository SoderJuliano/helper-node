const { exec } = require('child_process');
const Tesseract = require('tesseract.js');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const sharp = require('sharp');

const execPromise = util.promisify(exec);

class TesseractService {
    /**
     * Captures a screenshot using the default system command (spectacle) and processes it.
     * This is intended for environments like KDE.
     */
    async captureAndProcessScreenshot(mainWindow) {
        const timestamp = Date.now();
        const originalScreenshotPath = path.join(__dirname, '..', `screenshot-original-${timestamp}.png`);

        try {
            console.log('Using spectacle for screenshot');
            const command = `spectacle --background --activewindow --nonotify --output "${originalScreenshotPath}"`;
            await execPromise(command);
            console.log('Original screenshot saved with spectacle:', originalScreenshotPath);

            // Process the saved file, indicating it's NOT a pasted image (it needs cropping)
            await this._processImageFile(originalScreenshotPath, mainWindow, false);

        } catch (error) {
            console.error('Error during spectacle capture:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ocr-error', 'Failed to capture screenshot with Spectacle.');
            }
        }
    }

    /**
     * Decodes a base64 image, saves it temporarily, and processes it.
     * This is for the new paste-from-clipboard functionality.
     */
    async processPastedImage(base64Image, mainWindow) {
        const timestamp = Date.now();
        const originalScreenshotPath = path.join(__dirname, '..', `screenshot-pasted-${timestamp}.png`);
        
        try {
            const buffer = Buffer.from(base64Image.split(';base64,').pop(), 'base64');
            await fs.writeFile(originalScreenshotPath, buffer);
            console.log('Pasted image saved to temporary file:', originalScreenshotPath);

            // Process the saved file, indicating it IS a pasted image (it should NOT be cropped)
            await this._processImageFile(originalScreenshotPath, mainWindow, true);

        } catch (error) {
            console.error('Error processing pasted image:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ocr-error', 'Failed to process pasted image.');
            }
        }
    }

    async getTextFromImage(base64Image) {
        const timestamp = Date.now();
        const imagePath = path.join(__dirname, '..', `screenshot-manual-${timestamp}.png`);
    
        try {
            // Validar entrada
            if (!base64Image || typeof base64Image !== 'string') {
                throw new Error('Invalid base64Image provided');
            }

            const buffer = Buffer.from(base64Image.split(';base64,').pop(), 'base64');
            
            // Verificar se o buffer tem um tamanho mínimo válido
            if (buffer.length < 100) {
                throw new Error('Image buffer too small, probably corrupted');
            }

            await fs.writeFile(imagePath, buffer);
            console.log('Manual input image saved to temporary file:', imagePath);

            // Verificar se o arquivo foi criado com sucesso
            const stats = await fs.stat(imagePath);
            if (stats.size === 0) {
                throw new Error('Written image file is empty');
            }
    
            // Tentar processar a imagem com múltiplas configurações
            console.log('🔍 Tentando OCR com configuração otimizada...');
            
            // Primeira tentativa: configuração simplificada para texto matemático
            let ocrPromise = Tesseract.recognize(imagePath, 'eng', {
                logger: m => console.log(m),
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_WORD,
                tessedit_char_whitelist: '0123456789+-=x÷×',
            });
            
            try {
                let result = await Promise.race([ocrPromise, new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('OCR timeout')), 15000);
                })]);
                
                if (result && result.data && result.data.text && result.data.text.trim()) {
                    console.log('✅ OCR sucesso com configuração matemática:', result.data.text.trim());
                    const text = result.data.text.trim();
                    fs.unlink(imagePath).catch(console.error);
                    return text;
                }
                
                // Segunda tentativa: configuração mais ampla
                console.log('🔄 Tentando OCR com configuração ampla...');
                ocrPromise = Tesseract.recognize(imagePath, 'eng+por', {
                    logger: m => console.log(m),
                    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
                });
                
                result = await Promise.race([ocrPromise, new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('OCR timeout')), 15000);
                })]);
                
                if (result && result.data && result.data.text && result.data.text.trim()) {
                    console.log('✅ OCR sucesso com configuração ampla:', result.data.text.trim());
                    const text = result.data.text.trim();
                    fs.unlink(imagePath).catch(console.error);
                    return text;
                }
                
            } catch (error) {
                console.error('❌ Erro em ambas tentativas de OCR:', error.message);
            }
            
            // Se chegou até aqui, nenhuma das tentativas funcionou
            console.log('⚠️ Nenhuma configuração de OCR conseguiu detectar texto');
            fs.unlink(imagePath).catch(console.error);
            return '';
    
        } catch (error) {
            console.error('Error getting text from image:', error);
            // Cleanup on error
            fs.unlink(imagePath).catch(console.error);
            
            // Return empty string instead of throwing to prevent app crash
            return '';
        }
    }

    /**
     * Private helper method to process an image file from a given path.
     * Conditionally crops the image based on the isPasted flag.
     */
    async _processImageFile(originalPath, mainWindow, isPasted = false) {
        let imageToProcessPath = originalPath;
        let croppedPath = null; // Will only be set if we actually crop

        try {
            await fs.access(originalPath);

            // Verificar se o arquivo tem um tamanho mínimo válido
            const stats = await fs.stat(originalPath);
            if (stats.size < 100) {
                throw new Error('Image file too small, probably corrupted');
            }

            if (!isPasted) {
                console.log('Image is from capture, applying crop.');
                const timestamp = Date.now();
                croppedPath = path.join(__dirname, '..', `screenshot-cropped-${timestamp}.png`);
                await this._cuttingImg(originalPath, croppedPath);
                await fs.access(croppedPath);
                imageToProcessPath = croppedPath; // OCR will use the cropped image
            } else {
                console.log('Image is from paste, skipping crop.');
            }

            console.log('Starting OCR processing for:', imageToProcessPath);

            // Processar OCR com múltiplas tentativas para melhor detecção
            console.log('🔍 Processando OCR com tentativas otimizadas...');
            
            // Primeira tentativa: otimizada para matemática/números
            let ocrPromise = Tesseract.recognize(imageToProcessPath, 'eng', {
                logger: m => console.log(m),
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_WORD,
                tessedit_char_whitelist: '0123456789+-=x÷×().,',
            });
            
            let result = null;
            let text = '';
            
            try {
                result = await Promise.race([ocrPromise, new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('OCR timeout')), 15000);
                })]);
                
                if (result && result.data && result.data.text && result.data.text.trim()) {
                    text = result.data.text.trim();
                    console.log('✅ OCR matemático detectou:', text);
                }
            } catch (mathOcrError) {
                console.log('🔄 OCR matemático falhou, tentando configuração completa...');
            }
            
            // Segunda tentativa se a primeira falhou
            if (!text) {
                try {
                    ocrPromise = Tesseract.recognize(imageToProcessPath, 'eng+por', {
                        logger: m => console.log(m),
                        tessedit_pageseg_mode: Tesseract.PSM.AUTO
                    });
                    
                    result = await Promise.race([ocrPromise, new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('OCR timeout')), 15000);
                    })]);
                    
                    if (result && result.data && result.data.text && result.data.text.trim()) {
                        text = result.data.text.trim();
                        console.log('✅ OCR completo detectou:', text);
                    }
                } catch (fullOcrError) {
                    console.log('❌ Ambas tentativas de OCR falharam');
                }
            }

            console.log('OCR Result:', text);

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ocr-result', { text, screenshotPath: imageToProcessPath });
            }

            // Cleanup
            if (croppedPath) {
                // If we cropped, the original from spectacle is also temporary
                await fs.unlink(originalPath);
                setTimeout(() => {
                    fs.unlink(croppedPath).catch(console.error);
                }, 8000);
            } else {
                // If it was a pasted image, only the originalPath exists
                setTimeout(() => {
                    fs.unlink(originalPath).catch(console.error);
                }, 8000);
            }

            return { text, screenshotPath: imageToProcessPath };

        } catch (error) {
            console.error('Error processing image file:', error);
            
            // Sempre enviar um resultado, mesmo que seja erro
            const errorText = error.message.includes('timeout') ? 
                'OCR processing timeout - image may be too complex' : 
                'Could not process image';
            
            if (mainWindow && !mainWindow.isDestroyed()) {
                // Em vez de enviar erro, enviar resultado vazio
                mainWindow.webContents.send('ocr-result', { 
                    text: '', 
                    screenshotPath: imageToProcessPath || originalPath,
                    error: errorText
                });
            }
            
            // Ensure temp files are deleted on error too
            fs.unlink(originalPath).catch(console.error);
            if (croppedPath) {
                fs.unlink(croppedPath).catch(console.error);
            }
            
            // Return empty result instead of throwing
            return { text: '', screenshotPath: imageToProcessPath || originalPath };
        }
    }

    async _cuttingImg(originalScreenshotPath, outputPath) {
        try {
            const image = sharp(originalScreenshotPath);
            const metadata = await image.metadata();
    
            // Calcula as margens
            const cutTop = 120;
            const cutBottom = 80;
            const cutLeft = Math.floor(metadata.width * 0.10);
            const cutRight = Math.floor(metadata.width * 0.10);
    
            const newWidth = metadata.width - cutLeft - cutRight;
            const newHeight = metadata.height - cutTop - cutBottom;

            // Prevenção de erro: não corta se a imagem for muito pequena
            if (newWidth <= 0 || newHeight <= 0) {
                console.warn('Image is too small to crop, using original dimensions.');
                await image.toFile(outputPath); // Salva uma cópia sem cortar
                return;
            }
    
            await image
                .extract({
                    left: cutLeft,
                    top: cutTop,
                    width: newWidth,
                    height: newHeight
                })
                .toFile(outputPath);
    
            console.log('Cropped screenshot saved:', outputPath);
        } catch (error) {
            console.error('Error in image cropping:', error);
            throw error;
        }
    }
}

module.exports = new TesseractService();