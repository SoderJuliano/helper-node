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
            const buffer = Buffer.from(base64Image.split(';base64,').pop(), 'base64');
            await fs.writeFile(imagePath, buffer);
            console.log('Manual input image saved to temporary file:', imagePath);
    
            // Since this is a pasted image for manual input, we treat it as `isPasted = true` to skip cropping.
            const { data: { text } } = await Tesseract.recognize(imagePath, 'por', {
                logger: m => console.log(m)
            });
            console.log('OCR Result for manual input:', text);
    
            // Cleanup the temporary file
            fs.unlink(imagePath).catch(console.error);
    
            return text;
    
        } catch (error) {
            console.error('Error getting text from image:', error);
            // Cleanup on error
            fs.unlink(imagePath).catch(console.error);
            throw error; // Re-throw the error to be caught in main.js
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

            const { data: { text } } = await Tesseract.recognize(imageToProcessPath, 'por', {
                logger: m => console.log(m)
            });
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
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ocr-error', error.message);
            }
            // Ensure temp files are deleted on error too
            fs.unlink(originalPath).catch(console.error);
            if (croppedPath) {
                fs.unlink(croppedPath).catch(console.error);
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