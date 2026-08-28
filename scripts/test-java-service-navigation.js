// scripts/test-java-service-navigation.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const symbolIndexer = require('../services/symbolIndexer.js');
const javaSourceResolver = require('../services/java/javaSourceResolver.js');

console.log('=== Testando Navegação de Código em Serviços Java e Resolução de Fontes Locais ===\n');

const tmpDir = path.join(os.tmpdir(), 'helper-java-nav-test-' + Date.now());
const srcDir = path.join(tmpDir, 'src', 'main', 'java', 'com', 'example', 'demo');
fs.mkdirSync(srcDir, { recursive: true });

try {
  // 1. Cria arquivos Java de exemplo (Controller, Service Interface, Service Impl)
  const serviceJava = path.join(srcDir, 'UserService.java');
  fs.writeFileSync(serviceJava, `package com.example.demo;

import java.util.List;
import java.util.Map;

public interface UserService {
    UserDto saveUser(UserDto dto);
    ResponseEntity<List<UserDto>> listAllUsers();
    Map<String, Object> getUserMetadata(Long id);
}
`, 'utf8');

  const implJava = path.join(srcDir, 'UserServiceImpl.java');
  fs.writeFileSync(implJava, `package com.example.demo;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class UserServiceImpl implements UserService {
    @Override
    public UserDto saveUser(UserDto dto) {
        return dto;
    }

    @Override
    public ResponseEntity<List<UserDto>> listAllUsers() {
        return null;
    }

    @Override
    public Map<String, Object> getUserMetadata(Long id) {
        return null;
    }
}
`, 'utf8');

  const controllerJava = path.join(srcDir, 'UserController.java');
  fs.writeFileSync(controllerJava, `package com.example.demo;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;

@RestController
public class UserController {
    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping("/users")
    public void createUser(UserDto dto) {
        userService.saveUser(dto);
        userService.listAllUsers();
        userService.getUserMetadata(1L);
    }
}
`, 'utf8');

  // 2. Indexa o workspace
  symbolIndexer.reset();
  symbolIndexer.indexSingleFile(serviceJava);
  symbolIndexer.indexSingleFile(implJava);
  symbolIndexer.indexSingleFile(controllerJava);

  // 3. Testa indexação de métodos com generics complexos
  const saveUserSyms = symbolIndexer.symbolMap.get('saveUser');
  assert(saveUserSyms && saveUserSyms.length >= 1, 'saveUser deve ser indexado');
  console.log('  ok   Metodo simples saveUser indexado com sucesso');

  const listAllUsersSyms = symbolIndexer.symbolMap.get('listAllUsers');
  assert(listAllUsersSyms && listAllUsersSyms.length >= 1, 'listAllUsers com ResponseEntity<List<UserDto>> deve ser indexado');
  console.log('  ok   Metodo com generics complexos (ResponseEntity<List<UserDto>>) indexado com sucesso');

  const getMetadataSyms = symbolIndexer.symbolMap.get('getUserMetadata');
  assert(getMetadataSyms && getMetadataSyms.length >= 1, 'getUserMetadata com Map<String, Object> deve ser indexado');
  console.log('  ok   Metodo com espacos no generic (Map<String, Object>) indexado com sucesso');

  // 4. Testa findDefinition com resolução para classe e método local
  const controllerContent = fs.readFileSync(controllerJava, 'utf8');
  const defSaveUser = symbolIndexer.findDefinition(controllerJava, 'saveUser', '        userService.saveUser(dto);');
  assert(defSaveUser && defSaveUser.length > 0, 'findDefinition deve encontrar saveUser');
  assert(!defSaveUser[0].filePath.includes('.jar!'), 'NUNCA deve retornar caminho virtual .jar! para fonte local');
  assert(defSaveUser[0].filePath.endsWith('.java'), 'Deve apontar para arquivo .java real');
  console.log('  ok   findDefinition retornou caminho real do arquivo .java para saveUser');

  // 5. Testa fallback de javaSourceResolver para fontes locais
  const resolvedDirect = javaSourceResolver.resolveSymbolToJar(controllerJava, 'saveUser', 'userService.saveUser(dto);', controllerContent);
  assert(resolvedDirect, 'resolveSymbolToJar deve resolver o simbolo');
  assert(resolvedDirect.isSource, 'Deve ser marcado como isSource: true');
  assert(resolvedDirect.filePath && fs.existsSync(resolvedDirect.filePath), 'Arquivo de codigo fonte local deve existir no disco');
  assert(!resolvedDirect.filePath.includes('.jar!'), 'Caminho nao pode conter .jar!');
  console.log('  ok   javaSourceResolver resolveu fonte local do projeto em vez de criar stub descompilado');

  // 6. Testa estilo da barra de abas sem scrollbar visivel
  const terminalCss = fs.readFileSync('styles/terminal.css', 'utf8');
  assert(terminalCss.includes('scrollbar-width: none'), 'terminal.css deve conter scrollbar-width: none');
  assert(terminalCss.includes('.fv-tabs-container::-webkit-scrollbar') && terminalCss.includes('display: none'), 'webkit-scrollbar deve ser display: none');
  console.log('  ok   Scrollbar das abas configurada como invisivel para nao obstruir botao fechar');

  console.log('\nTodos os testes de Navegacao Java e Abas passaram com sucesso! 🎉\n');
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
}
