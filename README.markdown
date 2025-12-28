# Helper Node

Helper Node is an Electron-based application that transcribes audio queries using Whisper and displays AI-generated responses in a user-friendly interface. Features include:

- 🎙️ **Voice Transcription** with Whisper (pre-compiled)
- 🤖 **AI Responses** powered by OpenAI/LLaMA
- 📸 **OCR from Screenshots** with Tesseract
- ⌨️ **Global Hotkeys** for seamless OS integration
- 🪟 **OS Integration Mode** with floating notifications
- 💻 **Syntax-highlighted code blocks** with copy buttons

## Quick Install (Recommended)

### Pop OS / Ubuntu / Debian

Download and install the `.deb` package:

```bash
# Download the latest release
wget https://github.com/your-username/helper-node/releases/latest/download/helper-node_0.0.1_amd64.deb

# Install
sudo dpkg -i helper-node_0.0.1_amd64.deb

# Fix dependencies if needed
sudo apt-get install -f

# Launch
helper-node
```

### Garuda Linux / Arch Linux

Download and install the Arch package:

```bash
# Download the latest release
wget https://github.com/your-username/helper-node/releases/latest/download/helper-node-0.0.1-1-x86_64.pkg.tar.zst

# Install
sudo pacman -U helper-node-0.0.1-1-x86_64.pkg.tar.zst

# Launch
helper-node
```

**Note:** Global hotkeys will be configured automatically on first run!

## Global Hotkeys

After installation, the following hotkeys are available system-wide:

- **Ctrl+D** - Start/Stop audio recording
- **Ctrl+I** - Open manual input window
- **Ctrl+A** - Focus Helper Node window
- **Ctrl+Shift+C** - Open settings
- **Ctrl+Shift+X** - Capture screenshot and analyze
- **Ctrl+Shift+1** - Move to display 1
- **Ctrl+Shift+2** - Move to display 2

## Manual Installation (Development)

### Prerequisites

- **Node.js** (v18 or later)
- **FFmpeg** for audio processing
- **curl** for API requests

Install on **Arch/Garuda**:
```bash
sudo pacman -S nodejs npm ffmpeg curl
```

On **Pop OS/Ubuntu/Debian**:
```bash
sudo apt-get update
sudo apt-get install nodejs npm ffmpeg curl
```

### Setup from Source

```bash
# Clone repository
git clone https://github.com/your-username/helper-node.git
cd helper-node

# Install dependencies
npm install

# Run
npm start
```

**Note:** Whisper binaries and models are included in the repository!

## Configuration

Open settings with **Ctrl+Shift+C** to configure:

- **AI Model**: Choose between OpenAI, LLaMA, or custom backend
- **OpenAI Token**: Add your API key for OpenAI models
- **Prompt Instruction**: Customize the AI's behavior
- **Language**: Set response language (pt-br, en-us)
- **Print Mode**: Enable automatic OCR from screenshots
- **OS Integration**: Enable floating notifications mode

## Features

### Voice Transcription
- Press **Ctrl+D** to start/stop recording
- Automatically transcribes with Whisper
- Sends to AI for intelligent responses

### Screenshot OCR
- Press **Ctrl+Shift+X** to capture and analyze screen
- Automatic text extraction with Tesseract
- AI explains code or answers questions about the image

### OS Integration Mode
- Floating notifications for responses
- Works without focusing the app window
- Perfect for Hyprland/GNOME/KDE workflows

## Building Packages

To build your own packages from source:

```bash
# Build both DEB and Arch packages
./package.sh

# Build only DEB
./package.sh deb

# Build only Arch
./package.sh arch
```

Packages will be created in `dist/` directory.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Development Roadmap

For details on the current architecture, future plans, and feature implementation strategies (such as the global hotkey setup), please see the [ROADMAP.md](ROADMAP.md) file.

## License

MIT License. See [LICENSE](LICENSE) for details.