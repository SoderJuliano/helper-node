# Roadmap do Aplicativo Helper

Este documento descreve a arquitetura atual para funcionalidades que dependem do sistema e o plano para melhorias futuras, visando uma experiência de usuário mais integrada.

## Arquitetura Atual: Atalho Global via Servidor IPC

Para permitir que o atalho de gravação (`Ctrl+D`) funcione globalmente (fora do foco do aplicativo), a seguinte arquitetura foi implementada:

1.  **Servidor IPC Interno:**
    *   Um pequeno servidor web usando `Express.js` é executado dentro do processo principal do Electron (`main.js`).
    *   Este servidor é modularizado em `services/ipcService.js`.
    *   Ele expõe um endpoint local, como `POST http://localhost:3000/toggle-recording`.

2.  **Comunicação:**
    *   Quando o endpoint é acionado, ele chama a função interna `toggleRecording()`, que gerencia o início e o fim da gravação de áudio.

3.  **Configuração Automática (`setup-hotkey.sh`):**
    *   Para configurar o atalho global `Ctrl+D`, utilize o script de configuração automática `setup-hotkey.sh`. Este script detectará seu ambiente de desktop (GNOME ou Hyprland) e aplicará as configurações necessárias.
    *   **Como usar:** Execute o script na raiz do projeto: `./setup-hotkey.sh`

Esta abordagem funciona de forma robusta em Wayland e X11, mas exige configuração manual.

## Arquitetura Atual: Notificações de Desktop Robustas

Para garantir usabilidade e a entrega completa das informações quando o aplicativo não está em foco, uma nova estratégia de notificações foi implementada, priorizando a clareza e a robustez em detrimento da formatação rica.

1.  **Tecnologia:**
    *   A funcionalidade continua usando a API `Notification` nativa do Electron.

2.  **Estratégia de Entrega Sequencial:**
    *   Para evitar problemas de truncamento de texto e incompatibilidade com diferentes daemons de notificação (como `mako` em Hyprland ou o do GNOME), todas as respostas da IA são processadas da mesma maneira.
    *   A resposta, que pode conter HTML, é primeiramente convertida para um formato de texto puro. Tags como `<p>`, `<li>` e `<br>` são transformadas em quebras de linha (`\n`).
    *   O texto puro resultante é então dividido em um array de linhas (parágrafos ou itens de lista).
    *   O aplicativo itera sobre esse array e envia **cada linha como uma notificação separada**, com um pequeno atraso de 2 segundos entre elas.
    *   Cada notificação é titulada com um contador (ex: "Resposta (1/3)"), para que o usuário saiba o contexto.

3.  **Benefícios:**
    *   **Entrega Completa:** Garante que respostas longas, especialmente listas, sejam exibidas por completo.
    *   **Compatibilidade Universal:** Funciona de forma idêntica e previsível em todos os ambientes de desktop, eliminando a necessidade de detectar o DE.
    *   **Legibilidade:** A entrega sequencial permite que o usuário leia cada ponto da resposta com calma.

4.  **Eventos de Notificação:**
    *   **Início da Gravação:** Uma notificação "Gravando..." é enviada.
    *   **Fim da Gravação/Início do Processamento:** Uma notificação "Ok, aguarde..." é enviada.
    *   **Pós-Transcrição:** Uma notificação é enviada no formato "Usuário perguntou: [texto transcrito]".
    *   **Espera pela Resposta da IA:** Enquanto aguarda a resposta, uma notificação "Aguarde, gerando uma resposta..." é enviada a cada 10 segundos.
    *   **Pós-Resposta da IA:** A resposta é dividida por linhas e enviada em múltiplas notificações sequenciais, conforme descrito acima.

4.  **Controle da Funcionalidade:**
    *   A exibição de notificações é controlada por uma flag no `main.js`: `appConfig.notificationsEnabled`.
    *   Atualmente, esta flag está fixada como `true`, mas foi estruturada para ser facilmente conectada a um arquivo de configurações ou a uma opção na interface do usuário no futuro.

## Arquitetura Atual: Lógica de Serviço de IA com Fallback

Para oferecer flexibilidade e robustez na geração de respostas de IA, o aplicativo agora implementa uma lógica de seleção de serviço com fallback automático. O objetivo é priorizar um backend customizado (remoto) quando disponível, e usar um modelo local como alternativa segura.

1.  **Múltiplos Serviços de IA:**
    *   O aplicativo mantém referências a múltiplos serviços de IA, incluindo `services/backendService.js` (para o backend customizado) e `services/geminiService.js` (para o modelo local).

2.  **Verificação de Disponibilidade (Health Check):**
    *   Ao iniciar, e depois periodicamente a cada 60 segundos, o aplicativo realiza uma verificação de status (`ping`) no endpoint `/ping` do backend customizado.
    *   Uma variável de estado global (`backendIsOnline`) armazena o resultado dessa verificação.

3.  **Lógica de Seleção e Fallback:**
    *   Quando uma nova resposta de IA é solicitada, o aplicativo verifica a flag `backendIsOnline`.
    *   **Se o backend estiver online:** O `BackendService` é acionado para processar a requisição. Se, mesmo assim, a chamada falhar (por exemplo, erro de rede ou resposta inválida), o erro é capturado, a flag `backendIsOnline` é temporariamente definida como `false`, e o sistema **automaticamente recorre ao `GeminiService` local** para garantir que o usuário receba uma resposta.
    *   **Se o backend estiver offline:** O aplicativo utiliza diretamente o `GeminiService` local sem tentar contato com o backend.

4.  **URL Dinâmica do Backend:**
    *   O `backendService` obtém a URL do backend de forma dinâmica através de um serviço externo (`https://abra-api.top/notifications/retrieve?key=ngrockurl`), o que permite que o endereço do servidor mude sem necessidade de reconfigurar o aplicativo.

Este sistema híbrido garante que o aplicativo continue funcional mesmo que o backend remoto esteja indisponível, combinando a preferência por um serviço remoto customizado com a confiabilidade de um modelo local.

## Arquitetura Atual: Atalhos Globais para Gerenciamento de Janela

Assim como o atalho de gravação, os atalhos para mover a janela entre monitores (`Ctrl+Shift+1`, `Ctrl+Shift+2`) também foram movidos para a arquitetura de servidor IPC para garantir o funcionamento em diferentes ambientes, especialmente em Wayland (Hyprland, GNOME).

1.  **Endpoints IPC:**
    *   O `ipcService` agora expõe dois novos endpoints:
        *   `POST http://localhost:3000/move-to-display/0` (para o primeiro monitor)
        *   `POST http://localhost:3000/move-to-display/1` (para o segundo monitor)

2.  **Configuração Automática (`setup-hotkey.sh`):**
    *   Para configurar os atalhos globais para gerenciamento de janela, utilize o script de configuração automática `setup-hotkey.sh`. Este script detectará seu ambiente de desktop e aplicará as configurações necessárias para os atalhos de movimentação de janela (`Ctrl+Shift+1`, `Ctrl+Shift+2`) e para focar o aplicativo com input (`Ctrl+I`, `Ctrl+Shift+I`).
    *   **Como usar:** Execute o script na raiz do projeto: `./setup-hotkey.sh`

Esta solução remove a dependência do módulo `globalShortcut` do Electron para essas ações, que é notoriamente instável entre diferentes gerenciadores de janela, e centraliza a lógica de atalhos globais em uma única arquitetura robusta e configurável pelo usuário.



3.  **Comportamento Específico para Hyprland:**
    *   O aplicativo detecta automaticamente se está sendo executado no Hyprland.
    *   Se for o caso, o comportamento dos endpoints muda: em vez de mover a janela para um monitor físico, ele a move para um *workspace* (área de trabalho) do Hyprland.
    *   O endpoint `.../move-to-display/0` moverá a janela para o workspace 1.
    *   O endpoint `.../move-to-display/1` moverá a janela para o workspace 2, e assim por diante.
    *   Isso permite uma integração mais nativa com o fluxo de trabalho do Hyprland, que é centrado em workspaces. A configuração no `hyprland.conf` permanece a mesma.

## Configuração Automática de Atalhos Globais (`setup-hotkey.sh`)

Para configurar todos os atalhos globais do Helper-Node de forma automática, utilize o script `setup-hotkey.sh` localizado na raiz do projeto.

**O que o script faz:**
*   **Verifica dependências:** Garante que o `curl` esteja instalado, pois é essencial para a comunicação com o servidor IPC do aplicativo.
*   **Detecta Ambiente de Desktop (DE):** Identifica automaticamente se você está usando GNOME ou Hyprland.
*   **Configura Atalhos:**
    *   **GNOME:** Utiliza `gsettings` para criar e registrar os atalhos globais, incluindo:
        *   `Ctrl+D` para iniciar/parar a gravação.
        *   `Ctrl+Shift+1` e `Ctrl+Shift+2` para mover a janela entre monitores/workspaces.
        *   `Ctrl+I` e `Ctrl+Shift+I` para trazer o aplicativo para o foco e abrir o input manual.
    *   **Hyprland:** Adiciona as linhas `bind` necessárias diretamente ao seu arquivo `~/.config/hypr/hyprland.conf`, utilizando:
        *   `SUPER, D` para iniciar/parar a gravação.
        *   `SUPER_SHIFT, 1` e `SUPER_SHIFT, 2` para mover a janela entre workspaces.
        *   `SUPER, I` e `SUPER_SHIFT, I` para trazer o aplicativo para o foco e abrir o input manual.
*   **Evita Duplicatas:** O script verifica se os atalhos já existem antes de adicioná-los, prevenindo configurações redundantes.

**Como executar:**
1.  Abra um terminal na raiz do projeto `helper-node`.
2.  Execute o script com permissões de execução:
    ```bash
    ./setup-hotkey.sh
    ```
3.  **Após a execução:**
    *   **GNOME:** Pode ser necessário fazer logout e login novamente para que os novos atalhos sejam reconhecidos pelo sistema.
    *   **Hyprland:** Recarregue sua configuração do Hyprland. Você pode fazer isso geralmente com `hyprctl reload` no terminal, ou usando seu atalho configurado para recarregar o Hyprland (ex: `Super+R`).

**Benefícios:**
Este script automatiza o processo de configuração complexo e garante que o aplicativo funcione "out-of-the-box" com todos os atalhos globais esperados nos ambientes suportados.

