#!/usr/bin/env python3
import evdev
from evdev import ecodes, InputDevice
import asyncio
import os
import getpass
import pwd
import subprocess

# Define os atalhos e os endpoints curl correspondentes
# KEY_LEFTCTRL = 29, KEY_LEFTSHIFT = 42
# KEY_D = 32, KEY_I = 23, KEY_C = 46, KEY_S = 31, KEY_1 = 2, KEY_2 = 3

SHORTCUTS = {
    # Ctrl + D
    (frozenset([ecodes.KEY_LEFTCTRL]), frozenset([ecodes.KEY_D])): "curl -X POST http://localhost:3000/toggle-recording -s -o /dev/null",
    # Ctrl + I
    (frozenset([ecodes.KEY_LEFTCTRL]), frozenset([ecodes.KEY_I])): "curl -X POST http://localhost:3000/bring-to-focus-and-input -s -o /dev/null",
    # Ctrl + Shift + I
    (frozenset([ecodes.KEY_LEFTCTRL, ecodes.KEY_LEFTSHIFT]), frozenset([ecodes.KEY_I])): "curl -X POST http://localhost:3000/bring-to-focus-and-input -s -o /dev/null",
    # Ctrl + Shift + S
    (frozenset([ecodes.KEY_LEFTCTRL, ecodes.KEY_LEFTSHIFT]), frozenset([ecodes.KEY_S])): "curl -X POST http://localhost:3000/capture-screen-auto -s -o /dev/null",
    # Ctrl + Shift + C
    (frozenset([ecodes.KEY_LEFTCTRL, ecodes.KEY_LEFTSHIFT]), frozenset([ecodes.KEY_C])): "curl -X POST http://localhost:3000/open-config -s -o /dev/null",
    # Ctrl + Shift + 1
    (frozenset([ecodes.KEY_LEFTCTRL, ecodes.KEY_LEFTSHIFT]), frozenset([ecodes.KEY_1])): "curl -X POST http://localhost:3000/move-to-display/0 -s -o /dev/null",
    # Ctrl + Shift + 2
    (frozenset([ecodes.KEY_LEFTCTRL, ecodes.KEY_LEFTSHIFT]), frozenset([ecodes.KEY_2])): "curl -X POST http://localhost:3000/move-to-display/1 -s -o /dev/null",
}

# Modificadores rastreados (Right e Left equivalem para nós por simplicidade)
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

# Pega o usuário principal (que não seja root) para rodar o curl na sessão dele (opcionalmente)
try:
    TARGET_USER = os.environ.get("SUDO_USER") or getpass.getuser()
    if TARGET_USER == 'root':
        # Fallback para tentar descobrir o usuário do console
        try:
            TARGET_USER = pwd.getpwnam([p.pw_name for p in pwd.getpwall() if p.pw_uid >= 1000][0]).pw_name
        except:
            pass
except:
    TARGET_USER = 'root'

def execute_curl(cmd):
    # Executa como o usuário da sessão para evitar problemas de firewall/proxy locais de root, se necessário.
    if TARGET_USER != 'root':
        full_cmd = f"su - {TARGET_USER} -c '{cmd}'"
    else:
        full_cmd = cmd
    subprocess.Popen(full_cmd, shell=True)

async def monitor_device(device):
    active_modifiers = set()
    try:
        async for event in device.async_read_loop():
            if event.type == ecodes.EV_KEY:
                key_event = evdev.categorize(event)
                code = key_event.scancode
                state = key_event.keystate
                
                # Trata modificadores
                if code in MODIFIERS_MAP:
                    mapped_mod = MODIFIERS_MAP[code]
                    if state == 1: # Pressionado
                        active_modifiers.add(mapped_mod)
                    elif state == 0: # Solto
                        if mapped_mod in active_modifiers:
                            active_modifiers.remove(mapped_mod)
                # Trata outras teclas quando pressionadas (state == 1)
                elif state == 1:
                    current_mods_frozen = frozenset(active_modifiers)
                    pressed_key_frozen = frozenset([code])
                    
                    # Checa se a combinação exata de mods + key está mapeada
                    combo = (current_mods_frozen, pressed_key_frozen)
                    if combo in SHORTCUTS:
                        print(f"Triggered: {combo}")
                        execute_curl(SHORTCUTS[combo])
                        
    except Exception as e:
        # Dispositivo pode ter sido desconectado
        pass

async def main():
    print("Starting evdev hotkey daemon for Helper-Node...")
    
    # Busca todos os dispositivos que tenham suporte a teclas de teclado (EV_KEY) e letras
    devices = [evdev.InputDevice(path) for path in evdev.list_devices()]
    keyboard_devices = []
    
    for device in devices:
        caps = device.capabilities()
        if ecodes.EV_KEY in caps:
            # Tem a tecla A? Provavelmente um teclado
            if ecodes.KEY_A in caps[ecodes.EV_KEY]:
                keyboard_devices.append(device)
                print(f"Listening on: {device.name} ({device.path})")

    if not keyboard_devices:
        print("No keyboard devices found. Make sure you run with sudo.")
        return

    # Inicia um monitor para cada teclado
    tasks = [monitor_device(dev) for dev in keyboard_devices]
    await asyncio.gather(*tasks)

if __name__ == "__main__":
    asyncio.run(main())
