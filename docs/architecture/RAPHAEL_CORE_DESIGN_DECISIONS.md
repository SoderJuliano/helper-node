# Registro de Decisões de Arquitetura (ADR): Motor Visual Raphael Core (Alma da Nexa)

**Data:** 14 de Setembro de 2026  
**Status:** Aprovado & Implementado  
**Branch:** `feature/raphael-core`  
**Autor/Engenheiro:** Juliano Soder & Nexa AI  

---

## 1. Contexto e Motivação
Historicamente, a assistente **Nexa** utilizava um avatar 2D rasterizado em animações Lottie/MP4 (personagem feminina estilo anime com saia e expressões faciais). 
Embora visualmente expressivo, este modelo apresentava limitações:
1. **Percepção e Aceitação:** Reclamações de usuários em ambientes profissionais corporativos sobre o estilo anime/saia.
2. **Desacoplamento Visual vs Voz:** As animações Lottie pré-renderizadas não permitiam sincronização espectral real com os formantes e fonemas da voz do Google Cloud TTS em tempo real.
3. **Escalabilidade & Performance:** Múltiplos arquivos rasterizados em disco (centenas de webp/json) geravam complexidade no redimensionamento e consumo de memória.

---

## 2. Decisão Arquitetural
Adotou-se o modelo **Raphael (The Core / Alma Celestial da Nexa)**, inspirado no computador supremo **Raphael / Lord of Wisdom (Ciel)** do universo *Tensura*.

### Pilares Fundamentais:
- **Identidade Mantida:** A personalidade, nome, inteligência, pipelines de voz (Google Cloud TTS Neural2-C) e comandos continuam 100% como **Nexa**.
- **Modo Padrão (Default):** O Raphael Core é o novo padrão do sistema para novas instalações e inicializações.
- **Transição Não Destrutiva:** O módulo legado de animações Lottie (`renderer/nexa/`) foi mantido como fallback e formalmente marcado como `(Legado / Depreciado)`.
- **Chaveador nas Configurações:** O usuário pode alternar entre `Núcleo Raphael` e `Avatar Lottie` na tela de configurações (`nexaConfig.html`).

---

## 3. Arquitetura do Pacote `renderer/raphael/`

```
renderer/raphael/
├── raphaelMath.js            # Matrizes de rotação Euler 3D, projeção focal 3D->2D, LERP de cores RGBA/HSL
├── raphaelThemes.js          # Catálogo de estados cromáticos, raios do núcleo e velocidades
├── raphaelAudioVisualizer.js  # Analisador FFT em tempo real (Web Audio API: graves, médios, agudos)
├── raphaelRings.js           # Motor de auréolas orbitais 3D com ordenação de profundidade (Z-sorting)
├── raphaelCore.js            # Orquestrador visual, fusão de plasma, ondas de choque e ciclo de renderização
└── raphael.css               # Efeitos de difração de luz, dropshadow e camadas no DOM
```

---

## 4. Engenharia Matemática & Física Visual

### A. Projeção 3D em Perspectiva Volumétrica
Cada partícula das auréolas possui coordenadas tridimensionais $(x, y, z)$ calculadas sobre toroides orbitais. A rotação giroscópica aplica a multiplicação de matrizes nos eixos de Euler $(\theta_x, \theta_y, \theta_z)$.
A projeção 2D na tela utiliza distância focal $f = 300$:
$$\text{scale} = \frac{f}{f + z}, \quad x' = c_x + x \cdot \text{scale}, \quad y' = c_y + y \cdot \text{scale}$$
O alpha ($\alpha$) e o diâmetro da partícula são modulados pela profundidade $z$ e ordenados via **Z-Sorting** para garantir sensação volumétrica genuína no Canvas 2D a 60 FPS com zero lag e zero dependências pesadas.

### B. Sincronização Espectral com a Voz (Voice Sync)
O [`RaphaelAudioVisualizer`](../../renderer/raphael/raphaelAudioVisualizer.js) conecta-se ao canal de áudio via `AnalyserNode` com FFT de 512 amostras:
- **Graves ($20\text{Hz} - 250\text{Hz}$):** Modulam o raio do plasma central e disparam ondas de choque em picos sonoros.
- **Médios ($250\text{Hz} - 2500\text{Hz}$):** Modulam a velocidade angular dos anéis e geram ondulações harmônicas senoidais.
- **Agudos ($2500\text{Hz} - 8000\text{Hz}$):** Intensificam o brilho das partículas e emitem faíscas estelares em sibilantes.

---

## 5. Dicionário de Estados e Semântica de Cores

| Estado | Cor / Matiz HSL | Significado & Comportamento Visual |
| :--- | :--- | :--- |
| **`IDLE`** | **Ciano Etéreo & Índigo** (`#00f0ff` / `#4a00e0`) | **Standby & Vigilância:** Pulsação lenta e relaxada. Auréolas giram serenamente nos 3 eixos. |
| **`LISTENING`** | **Âmbar Solar & Ouro** (`#ffb700` / `#ffe600`) | **Captação de Microfone:** Anéis se contraem e se alinham como uma lente receptora acústica focada no usuário. |
| **`THINKING`** | **Violeta Quântico & Magenta** (`#9d00ff` / `#ff007f`) | **Processamento do Modelo:** Rotação giroscópica acelerada nos eixos X/Y/Z com ondas de choque internas. |
| **`SPEAKING`** | **Teal Luminescente & Ciano** (`#00e5ff` / `#0077fe`) | **Ressonância de Voz:** O núcleo pulsa e vibra em sincronia direta com cada frequência da voz TTS. |
| **`WORKING`** | **Esmeralda Matrix** (`#00ff88` / `#05ffa1`) | **Leitura/Edição de Arquivos & Código:** Partículas binárias e anéis computacionais operando ativamente. |
| **`SEARCHING`**| **Azul Safira & Oceânico** (`#0051ff` / `#00c8ff`) | **Acesso à Internet / Pesquisa:** Auréolas se expandem criando malha orbital simulando a rede mundial. |
| **`SLEEPING`** | **Azul Meia-Noite & Estelar** (`#1e293b` / `#3b82f6`) | **AFK / Inatividade:** Brilho reduzido e respiração estelar de baixo consumo energético. |

---

## 6. Consequências e Resultados
- **Performance:** Renderização nativa ultraleve no Canvas 2D sem consumo de GPU desnecessário.
- **Visual:** Estética moderna, sofisticada e profissional.
- **Manutenibilidade:** Código desacoplado em módulos de menos de 250 linhas, 100% testado por testes automatizados (`test-raphael-core.js`).
