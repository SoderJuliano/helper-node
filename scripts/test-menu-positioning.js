// scripts/test-menu-positioning.js
// Testa o cálculo e ajuste de posicionamento do menu de projetos e outros popovers

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== Testando Posicionamento do Menu de Projetos e Popovers ===\n');

// Função auxiliar para testar o algoritmo de posicionamento
function calculateMenuPosition({ anchorRect, menuWidth, menuHeight, windowWidth, windowHeight, preferUp = false }) {
    const spaceBelow = windowHeight - anchorRect.bottom - 8;
    const spaceAbove = anchorRect.top - 8;

    let top;
    if (preferUp) {
        if (spaceAbove >= menuHeight || spaceAbove >= spaceBelow) {
            top = anchorRect.top - menuHeight - 6;
        } else {
            top = anchorRect.bottom + 6;
        }
    } else {
        if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
            top = anchorRect.bottom + 6;
        } else {
            top = anchorRect.top - menuHeight - 6;
        }
    }

    if (top + menuHeight > windowHeight - 8) {
        top = windowHeight - menuHeight - 8;
    }
    if (top < 8) {
        top = 8;
    }

    let left = anchorRect.left;
    if (left + menuWidth > windowWidth - 8) {
        left = windowWidth - menuWidth - 8;
    }
    if (left < 8) {
        left = 8;
    }

    return { top: Math.round(top), left: Math.round(left) };
}

// 1. Teste: Botão de projeto na Sidebar (topo da janela)
console.log('1. Testando clique no botão de projeto da Sidebar (topo da tela)...');
const sidebarPos = calculateMenuPosition({
    anchorRect: { top: 50, bottom: 82, left: 16, right: 180 },
    menuWidth: 200,
    menuHeight: 220,
    windowWidth: 1024,
    windowHeight: 768,
    preferUp: false
});

// Deve abrir para baixo (top = 88) e nunca com valor negativo ou cortando
assert.strictEqual(sidebarPos.top, 88);
assert.strictEqual(sidebarPos.left, 16);
console.log('  ok   Menu abre para baixo (top = ' + sidebarPos.top + 'px), sem cortar o topo');

// 2. Teste: Botão de projeto no Footer do Composer (parte inferior da janela)
console.log('2. Testando clique no botão de projeto do Composer (rodapé da tela)...');
const composerPos = calculateMenuPosition({
    anchorRect: { top: 720, bottom: 746, left: 300, right: 420 },
    menuWidth: 200,
    menuHeight: 220,
    windowWidth: 1024,
    windowHeight: 768,
    preferUp: false
});

// Como não cabe para baixo (espaço = 14px), deve abrir para cima (top = 720 - 220 - 6 = 494)
assert.strictEqual(composerPos.top, 494);
assert.strictEqual(composerPos.left, 300);
console.log('  ok   Menu abre para cima (top = ' + composerPos.top + 'px), sem vazar o rodapé');

// 3. Teste: Janela de tamanho reduzido onde o menu é maior que o espaço
console.log('3. Testando janela com altura reduzida (limite mínimo e máximo)...');
const smallWindowPos = calculateMenuPosition({
    anchorRect: { top: 10, bottom: 35, left: 10, right: 150 },
    menuWidth: 200,
    menuHeight: 300,
    windowWidth: 800,
    windowHeight: 320,
    preferUp: false
});

assert.strictEqual(smallWindowPos.top >= 8, true);
assert.strictEqual(smallWindowPos.top + 300 <= 320 - 8 || smallWindowPos.top === 8, true);
console.log('  ok   Menu é contido com segurança dentro dos limites da janela (top = ' + smallWindowPos.top + 'px)');

// 4. Teste: Ajuste horizontal quando o botão está no canto direito
console.log('4. Testando ajuste horizontal quando o elemento está no canto direito...');
const rightEdgePos = calculateMenuPosition({
    anchorRect: { top: 100, bottom: 130, left: 950, right: 1010 },
    menuWidth: 200,
    menuHeight: 150,
    windowWidth: 1024,
    windowHeight: 768,
    preferUp: false
});

assert.strictEqual(rightEdgePos.left + 200 <= 1024 - 8, true);
assert.strictEqual(rightEdgePos.left, 1024 - 200 - 8);
console.log('  ok   Menu é reposicionado para não vazar a borda direita (left = ' + rightEdgePos.left + 'px)');

// 5. Testando arquivo workspaceContext.js carregado em DOM simulado
console.log('5. Testando execução real de showProjectMenu em DOM simulado...');
const workspaceContextCode = fs.readFileSync(path.join(__dirname, '../renderer/workspaceContext.js'), 'utf8');

let createdMenu = null;
const mockDoc = {
    getElementById: (id) => {
        if (id === 'ws-project-main') {
            return {
                dataset: { path: '/fake/project', id: 'proj-1' },
                getBoundingClientRect: () => ({ top: 60, bottom: 90, left: 20, right: 180 }),
                addEventListener: () => {}
            };
        }
        return {
            style: {},
            dataset: {},
            addEventListener: () => {},
            appendChild: () => {},
            querySelector: () => null
        };
    },
    querySelectorAll: () => [],
    createElement: (tag) => {
        const el = {
            tagName: tag.toUpperCase(),
            className: '',
            style: {},
            appendChild: (child) => el.children.push(child),
            children: [],
            addEventListener: () => {},
            remove: () => {},
            offsetHeight: 220,
            offsetWidth: 190
        };
        return el;
    },
    body: {
        appendChild: (el) => {
            createdMenu = el;
        }
    },
    addEventListener: () => {},
    removeEventListener: () => {}
};

const mockWin = {
    innerWidth: 1200,
    innerHeight: 800,
    electronAPI: {
        getWorkspaceAccessEnabled: async () => true,
        getProjectContext: async () => ({ id: 'proj-1', name: 'my-project', path: '/fake/project' })
    }
};

const runContext = new Function('window', 'document', 'process', workspaceContextCode);
runContext(mockWin, mockDoc, { platform: 'win32' });

const anchorBtn = mockDoc.getElementById('ws-project-main');
mockWin.showProjectMenu(anchorBtn);

assert.ok(createdMenu, 'Menu deve ter sido criado no body');
assert.strictEqual(createdMenu.className, 'ctx-project-menu');
assert.strictEqual(createdMenu.style.top, '96px'); // 90 + 6
assert.strictEqual(createdMenu.style.left, '20px');
console.log('  ok   showProjectMenu posicionou o menu perfeitamente em top: 96px, left: 20px');

console.log('\n Todos os testes de posicionamento passaram com sucesso!');
