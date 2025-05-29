const { exec } = require('child_process');
const Tesseract = require('tesseract.js');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const sharp = require('sharp');

const execPromise = util.promisify(exec);

class TesseractService {
    async captureAndProcessScreenshot(mainWindow) {
        let screenshotPath;
        try {
            const timestamp = Date.now();
            const originalScreenshotPath = path.join(__dirname, '..', `screenshot-original-${timestamp}.png`);
            screenshotPath = path.join(__dirname, '..', `screenshot-${timestamp}.png`);
            
            console.log('Target Screenshot Path:', screenshotPath);

            // Use Spectacle to capture the active window silently
            const command = `spectacle --background --activewindow --nonotify --output "${originalScreenshotPath}"`;
            await execPromise(command);
            console.log('Original screenshot saved:', originalScreenshotPath);
            
            // Verify original file exists first
            await fs.access(originalScreenshotPath);

            // Process the image cropping
            await this._cuttingImg(originalScreenshotPath, screenshotPath);

            // Now verify the cropped file exists
            await fs.access(screenshotPath);

            const { data: { text } } = await Tesseract.recognize(screenshotPath, 'por', {
                logger: m => console.log(m)
            });
            console.log('OCR Result:', text);

            // Remove the original image
            await fs.unlink(originalScreenshotPath);
            setTimeout(() => {
                fs.unlink(screenshotPath).catch(console.error);
            }, 8000);

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ocr-result', { text, screenshotPath });
            }

            return { text, screenshotPath };
        } catch (error) {
            console.error('Error capturing or processing screenshot:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ocr-error', error.message);
            }
            throw error;
        }
    }

    async _cuttingImg(originalScreenshotPath, outputPath) {
        try {
            const image = sharp(originalScreenshotPath);
            const metadata = await image.metadata();
    
            // Calcula as margens
            const cutTop = 120;
            const cutBottom = 80;
            const cutLeft = Math.floor(metadata.width * 0.10);  // 10% da esquerda
            const cutRight = Math.floor(metadata.width * 0.10); // 10% da direita
    
            const newWidth = metadata.width - cutLeft - cutRight;
            const newHeight = metadata.height - cutTop - cutBottom;
    
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