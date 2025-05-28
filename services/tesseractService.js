const { exec } = require('child_process');
const Tesseract = require('tesseract.js');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

class TesseractService {
    async captureAndProcessScreenshot(mainWindow) {
        try {
            const timestamp = Date.now();
            const screenshotPath = path.join(__dirname, '..', `screenshot-${timestamp}.png`);
            console.log('Target Screenshot Path:', screenshotPath);

            // Use Spectacle to capture the active window silently
            const command = `spectacle --background --activewindow --nonotify --output "${screenshotPath}"`;
            await execPromise(command);
            console.log('Screenshot saved:', screenshotPath);

            // Verify file exists
            await fs.access(screenshotPath);

            const { data: { text } } = await Tesseract.recognize(screenshotPath, 'por', {
                logger: m => console.log(m)
            });
            console.log('OCR Result:', text);

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
}

module.exports = new TesseractService();