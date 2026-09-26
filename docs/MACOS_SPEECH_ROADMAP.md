# Roadmap: Speech-to-Text Nativo no macOS (Apple Silicon / Neural Engine)

Este documento descreve a arquitetura, o funcionamento e as diretrizes de integração para habilitar a transcrição offline nativa do macOS no **Helper Node**, economizando 100% dos tokens de nuvem em Macs modernos.

---

## 1. Visão Geral

A partir do macOS 12 (Monterey) e especialmente no macOS 13+ (Ventura, Sonoma, Sequoia) em máquinas com **Apple Silicon (M1, M2, M3, M4)**:
- A Apple inclui modelos de reconhecimento de fala acelerados diretamente pelo **Apple Neural Engine (ANE)**.
- O reconhecimento ocorre **100% on-device** (offline), com latência próxima de zero, sem envio de pacotes de áudio para servidores externos e sem custo de tokens.

---

## 2. Limitação do Electron e Solução Adotada

- **Limitação no Electron:** O Chromium desativa as APIs nativas do `webkitSpeechRecognition` no Electron a menos que chaves privadas de serviços Google sejam embutidas no binário (e estas enviam o áudio para a nuvem da Google).
- **Solução Arquitetural no Helper Node:**
  - O Helper Node adota a interface unificada `services/transcriptionService.js` com o adapter `services/platform/macSpeechService.js`.
  - O adapter comunica-se com um pequeno utilitário nativo compilado em Swift (`macos-speech-cli`) que invoca o `SFSpeechRecognizer` oficial do macOS com `requiresOnDeviceRecognition = true`.

---

## 3. Implementação do Utilitário Swift (`macos-speech`)

Para compilar no Mac quando o ambiente estiver disponível:

```swift
// macos-speech.swift
import Foundation
import Speech

guard #available(macOS 10.15, *) else {
    fputs("macOS 10.15+ required\n", stderr)
    exit(1)
}

let args = CommandLine.arguments
var audioPath: String?
var localeStr = "pt-BR"

var i = 1
while i < args.count {
    if args[i] == "--file" && i + 1 < args.count {
        audioPath = args[i + 1]
        i += 2
    } else if args[i] == "--lang" && i + 1 < args.count {
        localeStr = args[i + 1]
        i += 2
    } else {
        i += 1
    }
}

guard let path = audioPath else {
    fputs("Usage: macos-speech --file <audio.wav> [--lang pt-BR]\n", stderr)
    exit(1)
}

let url = URL(fileURLWithPath: path)
let locale = Locale(identifier: localeStr)
guard let recognizer = SFSpeechRecognizer(locale: locale) else {
    fputs("Locale not supported: \(localeStr)\n", stderr)
    exit(2)
}

if !recognizer.isAvailable {
    fputs("Recognizer not available\n", stderr)
    exit(3)
}

let request = SFSpeechURLRecognitionRequest(url: url)
request.requiresOnDeviceRecognition = true // Força execução offline no Neural Engine

let semaphore = DispatchSemaphore(value: 0)

recognizer.recognitionTask(with: request) { result, error in
    if let err = error {
        fputs("Recognition error: \(err.localizedDescription)\n", stderr)
        exit(4)
    }
    if let res = result {
        if res.isFinal {
            print(res.bestTranscription.formattedString)
            semaphore.signal()
        }
    }
}

_ = semaphore.wait(timeout: .now() + 60.0)
```

### Compilação:
```bash
swiftc -O macos-speech.swift -o bin/darwin/macos-speech
chmod +x bin/darwin/macos-speech
```

---

## 4. Permissões Necessárias no `Info.plist` (macOS Bundle)

Para o app empacotado no macOS acessar os recursos do sistema sem travar ou ser bloqueado pelo TCC (Transparency, Consent, and Control):

```xml
<key>NSSpeechRecognitionUsageDescription</key>
<string>O Helper Node utiliza o reconhecimento de fala para transcrever seus comandos de voz e ditado.</string>
<key>NSMicrophoneUsageDescription</key>
<string>O Helper Node necessita de acesso ao microfone para transcrição de áudio e assistente em tempo real.</string>
```

---

## 5. Status no Helper Node

- [x] Serviço `transcriptionService.js` desacoplado com suporte a múltiplos provedores.
- [x] Adapter `services/platform/macSpeechService.js` pré-conectado na hierarquia de fallbacks.
- [x] Detecção inteligente de plataforma `process.platform === 'darwin'`.
- [ ] Compilação do binário `bin/darwin/macos-speech` (quando a máquina física macOS estiver disponível para teste).
