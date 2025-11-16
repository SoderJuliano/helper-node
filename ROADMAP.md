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

3.  **Configuração Manual (Solução Imediata):**
    *   O usuário precisa configurar manualmente seu ambiente de desktop para que o atalho `Ctrl+D` envie uma requisição para o endpoint do aplicativo.
    *   **Para Hyprland:** Adicionar ao `~/.config/hypr/hyprland.conf`:
        ```
        bind = CTRL, D, exec, curl -X POST http://localhost:3000/toggle-recording
        ```
    *   **Para GNOME:**
        1.  Vá para `Configurações` > `Teclado` > `Atalhos de Teclado`.
        2.  Role até o final e clique em `Atalhos Personalizados`.
        3.  Clique no botão `+`.
        4.  **Nome:** "Gravar Áudio Helper"
        5.  **Comando:** `curl -X POST http://localhost:3000/toggle-recording`
        6.  **Atalho:** Defina como `Ctrl+D`.

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

## Próximos Passos: Configuração Automática Pós-Instalação

Para que o aplicativo funcione "out-of-the-box" após a instalação, a configuração do atalho global deve ser automatizada.

**Plano de Ação:**

1.  **Detecção do Ambiente de Desktop (DE):**
    *   Na primeira inicialização, o aplicativo deve detectar qual DE está em uso (GNOME, KDE, Hyprland, etc.).
    *   Isso pode ser feito verificando variáveis de ambiente como `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, ou a presença de `WAYLAND_DISPLAY`.

2.  **Assistente de Configuração Guiada:**
    *   Com base no DE detectado, o aplicativo deve oferecer ao usuário a opção de configurar o atalho global automaticamente.
    *   **Exemplo para GNOME:** O aplicativo pode se oferecer para executar o seguinte comando `gsettings` para criar o atalho:
        ```bash
        gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ name 'Gravar Áudio Helper'
        gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command 'curl -X POST http://localhost:3000/toggle-recording'
        gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ binding 'Control_D'
        ```
        *(Nota: O script precisaria encontrar um slot `customX` disponível).*
    *   **Exemplo para Hyprland:** O aplicativo pode informar ao usuário que precisa adicionar uma linha ao `hyprland.conf` e, se possível, oferecer para abrir o arquivo no editor padrão ou até mesmo adicionar a linha programaticamente (com muito cuidado e backup).

3.  **Transparência e Controle do Usuário:**
    *   O aplicativo deve sempre informar ao usuário qual comando ou alteração de arquivo está prestes a fazer.
    *   Deve haver uma opção para o usuário ver as instruções e fazer a configuração manualmente se preferir.

Implementando este roadmap, o aplicativo alcançará o objetivo de ser poderoso e, ao mesmo tempo, fácil de instalar e usar para o usuário final.
