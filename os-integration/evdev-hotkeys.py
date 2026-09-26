#!/usr/bin/env python3
"""
os-integration/evdev-hotkeys.py

Daemon universal e resiliente de atalhos globais de teclado via Linux evdev.
Funciona em qualquer compositor Wayland (KDE Plasma 6, GNOME, Hyprland, COSMIC, Sway) e X11.

Recursos:
- Auto-detecção e reconexão contínua de teclados (reage a desconexão e novos dispositivos USB).
- Nunca encerra se não encontrar teclado na inicialização (espera e tenta novamente).
- Execução direta e rápida de requisições HTTP locais via curl sem overhead.
- Mapeamento robusto de teclas modificadoras (Left/Right Ctrl, Shift, Alt, Meta).
"""

import evdev
from evdev import ecodes, InputDevice
import asyncio
import os
import subprocess
import glob

# Shortcuts e seus comandos curl para a API local do Helper-Node
SHORTCUTS = {
    # Ctrl + D (Toggle Recording / Nexa Voice)
    (frozenset([ecodes.KEY_LEFTCTRL]), frozenset([ecodes.KEY_D])): "curl -m 2 -X POST http://127.0.0.1:3000/toggle-recording -s -o /dev/null",
    # Super + D
    (frozenset([ecodes.KEY_LEFTMETA]), frozenset([ecodes.KEY_D])): "curl -m 2 -X POST http://127.0.0.1:3000/toggle-recording -s -o /dev/null",
    # Ctrl + I (Focus and Input)
    (frozenset([ecodes.KEY_LEFTCTRL]), frozenset([ecodes.KEY_I])): "curl -m 2 -X POST http://127.0.0.1:3000/bring-to-focus-and-input -s -o /dev/null",
    # Ctrl + Shift + I
    (frozenset([ecodes.KEY_LEFTCTRL, ecodes.KEY_LEFTSHIFT]), frozenset([ecodes.KEY_I])): "curl -m 2 -X POST http://127.0.0.1:3000/bring-to-focus-and-input -s -o /dev/null",
    # Ctrl + Shift + S (Capture screen auto)
    (frozenset([ecodes.KEY_LEFTCTRL, ecodes.KEY_LEFTSHIFT]), frozenset([ecodes.KEY_S])): "curl -m 2 -X POST http://127.0.0.1:3000/capture-screen-auto -s -o /dev/null",
    # Alt + S (Toggle batch screenshot overlay & process)
    (frozenset([ecodes.KEY_LEFTALT]), frozenset([ecodes.KEY_S])): "curl -m 2 -X POST http://127.0.0.1:3000/toggle-batch-screenshot -s -o /dev/null",
    # Ctrl + Shift + C (Open config / escape hatch)
    (frozenset([ecodes.KEY_LEFTCTRL, ecodes.KEY_LEFTSHIFT]), frozenset([ecodes.KEY_C])): "curl -m 2 -X POST http://127.0.0.1:3000/open-config -s -o /dev/null",
    # Ctrl + Shift + 1 (Move to display 1)
    (frozenset([ecodes.KEY_LEFTCTRL, ecodes.KEY_LEFTSHIFT]), frozenset([ecodes.KEY_1])): "curl -m 2 -X POST http://127.0.0.1:3000/move-to-display/0 -s -o /dev/null",
    # Ctrl + Shift + 2 (Move to display 2)
    (frozenset([ecodes.KEY_LEFTCTRL, ecodes.KEY_LEFTSHIFT]), frozenset([ecodes.KEY_2])): "curl -m 2 -X POST http://127.0.0.1:3000/move-to-display/1 -s -o /dev/null",
}

# Normaliza modificadores Right e Left
MODIFIERS_MAP = {
    ecodes.KEY_LEFTCTRL: ecodes.KEY_LEFTCTRL,
    ecodes.KEY_RIGHTCTRL: ecodes.KEY_LEFTCTRL,
    ecodes.KEY_LEFTSHIFT: ecodes.KEY_LEFTSHIFT,
    ecodes.KEY_RIGHTSHIFT: ecodes.KEY_LEFTSHIFT,
    ecodes.KEY_LEFTALT: ecodes.KEY_LEFTALT,
    ecodes.KEY_RIGHTALT: ecodes.KEY_LEFTALT,
    ecodes.KEY_LEFTMETA: ecodes.KEY_LEFTMETA,
    ecodes.KEY_RIGHTMETA: ecodes.KEY_LEFTMETA
}

def execute_curl(cmd):
    try:
        subprocess.Popen(cmd, shell=True)
    except Exception as e:
        print(f"[evdev-hotkeys] Erro ao executar comando: {e}")

async def monitor_device(dev_path, name):
    print(f"[evdev-hotkeys] Monitorando: {name} ({dev_path})")
    active_modifiers = set()
    try:
        device = InputDevice(dev_path)
        async for event in device.async_read_loop():
            if event.type == ecodes.EV_KEY:
                key_event = evdev.categorize(event)
                code = key_event.scancode
                state = key_event.keystate
                
                if code in MODIFIERS_MAP:
                    mapped_mod = MODIFIERS_MAP[code]
                    if state == 1: # Pressionado
                        active_modifiers.add(mapped_mod)
                    elif state == 0: # Solto
                        active_modifiers.discard(mapped_mod)
                elif state == 1: # Tecla normal pressionada
                    combo = (frozenset(active_modifiers), frozenset([code]))
                    if combo in SHORTCUTS:
                        print(f"[evdev-hotkeys] Atalho acionado: {combo}")
                        execute_curl(SHORTCUTS[combo])
    except Exception as e:
        print(f"[evdev-hotkeys] Dispositivo desconectado ou erro ({dev_path}): {e}")

def is_keyboard_device(dev_path):
    try:
        device = InputDevice(dev_path)
        caps = device.capabilities()
        if ecodes.EV_KEY in caps:
            # Tem a tecla A e tecla Enter? É um teclado real
            keys = caps[ecodes.EV_KEY]
            if ecodes.KEY_A in keys and ecodes.KEY_ENTER in keys:
                return True, device.name
    except Exception:
        pass
    return False, ""

async def main():
    print("[evdev-hotkeys] Iniciando daemon universal de atalhos...")
    monitored_tasks = {} # dev_path -> Task

    while True:
        try:
            # Lista arquivos /dev/input/event* existentes
            event_files = sorted(glob.glob("/dev/input/event*"))
            
            # Remove tarefas de dispositivos que já morreram
            dead_paths = [p for p, task in monitored_tasks.items() if task.done()]
            for p in dead_paths:
                monitored_tasks.pop(p, None)

            # Encontra novos teclados
            for path in event_files:
                if path not in monitored_tasks:
                    is_kbd, name = is_keyboard_device(path)
                    if is_kbd:
                        task = asyncio.create_task(monitor_device(path, name))
                        monitored_tasks[path] = task

        except Exception as e:
            print(f"[evdev-hotkeys] Erro na varredura de dispositivos: {e}")

        await asyncio.sleep(2)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
