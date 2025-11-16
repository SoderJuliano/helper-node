# Helper Node

Helper Node is an Electron-based application that transcribes audio queries using Whisper and displays AI-generated responses (powered by LLaMA) in a user-friendly interface. Features include syntax-highlighted code blocks with copy buttons, a responsive transcription panel, and smooth scrolling without visible scrollbars.

## Prerequisites

- **Git**: To clone repositories.
- **Node.js** (v24 or later): For running the Electron app.
- **make** and **g++**: For building Whisper.
- **curl**: For downloading models.
- **FFmpeg**: For audio processing (required by Whisper).
- **CMake**: For building Whisper dependencies (optional, if using CMake).

Install prerequisites on **Garuda Linux/Arch Linux**:
```bash
sudo pacman -S git nodejs npm make gcc curl ffmpeg cmake
```

On **Ubuntu/Debian**:
```bash
sudo apt-get update
sudo apt-get install git nodejs make g++ curl ffmpeg cmake
```

On **macOS** (using Homebrew):
```bash
brew install git node make gcc curl ffmpeg cmake
```

For Windows, see [Windows Notes](#windows-notes) below.

## Setup Instructions

### 1. Clone the Helper Node Repository

Clone this repository to your local machine:
```bash
git clone https://github.com/your-username/helper-node.git
cd helper-node
```

### 2. Install Node Dependencies

Install project dependencies:
```bash
npm install
```

### 3. Download and Build Whisper

Clone the `whisper.cpp` repository to the project root:
```bash
git clone https://github.com/ggerganov/whisper.cpp.git whisper
cd whisper
```

Build Whisper using `make`:
```bash
make
```

This creates the `main` binary in `whisper/bin/` for transcription.

### 4. Download Whisper Models

Download the `ggml-tiny.bin` and `ggml-small.bin` models to `whisper/models/`:
```bash
mkdir -p models
curl -L -o models/ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin
curl -L -o models/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

These models are optimized for `whisper.cpp` and used for audio transcription.

### 5. Run the Application

Return to the project root:
```bash
cd ..
```

Start the Electron app:
```bash
npm start
```

The app will launch a window displaying a transcription panel (`#transcription`). Record or upload audio (e.g., saying "Dá um exemplo de código main em Java"), and the app will transcribe it using `whisper/bin/main` and display AI responses from LLaMA, with code blocks featuring "[Copy]" buttons.

## Usage

- **Transcription**: Audio is processed by `whisper.cpp` using `ggml-tiny.bin` (faster, less accurate) or `ggml-small.bin` (more accurate, slower). Update `index.js` to specify the model path (e.g., `whisper/models/ggml-small.bin`).
- **AI Responses**: LLaMA generates responses via `http://localhost:11434/api/generate`. Ensure the LLaMA server is running (see [LLaMA Setup](#llama-setup)).
- **UI Features**:
  - Code blocks (e.g., Java code) are syntax-highlighted with a "[Copy]" button to copy content.
  - The transcription panel has no horizontal scroll and an invisible vertical scroll on hover.
  - Responses are formatted with bold, italic, lists, and paragraphs for clarity.

## LLaMA Setup

1. Install and run the LLaMA server (e.g., `llama.cpp` or Ollama):
   ```bash
   # Example with Ollama
   curl https://ollama.ai/install.sh | sh
   ollama run llama3
   ```
2. Update `services/llamaService.js` if the LLaMA endpoint differs from `http://localhost:11434`.

## Windows Notes

- **Building Whisper**: Windows users need MinGW or MSYS2 for `make`. Alternatively, use CMake:
  ```bash
  cd whisper
  mkdir build
  cd build
  cmake ..
  cmake --build .
  ```
- **Model Downloads**: The `curl` commands work in PowerShell or WSL.
- **FFmpeg**: Install via `choco install ffmpeg` (Chocolatey) or download from [FFmpeg.org](https://ffmpeg.org).

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Development Roadmap

For details on the current architecture, future plans, and feature implementation strategies (such as the global hotkey setup), please see the [ROADMAP.md](ROADMAP.md) file.

## License

MIT License. See [LICENSE](LICENSE) for details.