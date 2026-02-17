# Configuração para Pop!_OS COSMIC

## Problema: Captura de tela não funciona

O Pop!_OS COSMIC usa Wayland e precisa de ferramentas específicas para captura de tela.

### Instale as ferramentas necessárias:

```bash
sudo apt-get update
sudo apt-get install -y grim slurp
```

**OU** se preferir usar gnome-screenshot (mais simples):

```bash
# Já vem instalado no Pop!_OS, mas pode não funcionar bem com Wayland
# Teste e veja se funciona para você
```

### Por que preciso disso?

- **grim**: Ferramenta de captura para Wayland
- **slurp**: Ferramenta de seleção de área para Wayland
- **gnome-screenshot**: Alternativa que funciona no X11 e parcialmente no Wayland

### Teste após instalação:

```bash
# Teste a captura
grim /tmp/test.png

# Teste seleção de área
grim -g "$(slurp)" /tmp/test-area.png
```

Depois reinicie o helper-node e teste Ctrl+Shift+X novamente!
