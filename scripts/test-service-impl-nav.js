// scripts/test-service-impl-nav.js
// Testa a navegação direta de interfaces/services para implementações (Go to Implementation) e calha (gutter icons).

const assert = require('assert');
const symbolIndexer = require('../services/symbolIndexer.js');

console.log('=== Testando Navegação de Código Java: Interfaces -> Implementações (IntelliJ-Style) ===\n');

symbolIndexer.reset();

// 1. UserService (Interface)
const userServiceIface = `
package com.example.demo.service;

import java.util.List;
import com.example.demo.dto.UserDto;

public interface UserService {
    void createUser(UserDto user);
    UserDto findById(Long id);
    List<UserDto> findAll();
}
`;

// 2. UserServiceImpl (Implementação com anotações e extends com generics)
const userServiceImpl = `
package com.example.demo.service.impl;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.example.demo.service.UserService;
import com.example.demo.dto.UserDto;
import java.util.List;

@Service
@Transactional
public class UserServiceImpl
    extends BaseServiceImpl<UserDto, Long>
    implements UserService {

    @Override
    public void createUser(UserDto user) {
        System.out.println("User created");
    }

    @Override
    public UserDto findById(Long id) {
        return null;
    }

    @Override
    public List<UserDto> findAll() {
        return null;
    }
}
`;

// 3. UserServiceTest (Classe de teste em /src/test/java)
const userServiceTest = `
package com.example.demo.service;

import org.junit.jupiter.api.Test;

public class UserServiceTest {
    @Test
    public void createUser() {
    }
}
`;

// 4. UserRepositoryCustom (Interface de Repositório Customizado Spring Data)
const userRepoCustomIface = `
package com.example.demo.repository;

import java.util.List;
import com.example.demo.model.User;
import com.example.demo.dto.UserFilter;

public interface UserRepositoryCustom {
    List<User> searchCustom(UserFilter filter);
}
`;

// 5. UserRepositoryImpl (Implementação Spring Data do UserRepositoryCustom)
const userRepoImpl = `
package com.example.demo.repository.impl;

import org.springframework.stereotype.Repository;
import com.example.demo.repository.UserRepositoryCustom;
import com.example.demo.model.User;
import com.example.demo.dto.UserFilter;
import java.util.List;

@Repository
public class UserRepositoryImpl implements UserRepositoryCustom {
    @Override
    public List<User> searchCustom(UserFilter filter) {
        return null;
    }
}
`;

const ifacePath = 'C:/project/src/main/java/com/example/demo/service/UserService.java';
const implPath = 'C:/project/src/main/java/com/example/demo/service/impl/UserServiceImpl.java';
const testPath = 'C:/project/src/test/java/com/example/demo/service/UserServiceTest.java';
const repoIfacePath = 'C:/project/src/main/java/com/example/demo/repository/UserRepositoryCustom.java';
const repoImplPath = 'C:/project/src/main/java/com/example/demo/repository/impl/UserRepositoryImpl.java';

symbolIndexer.indexSingleFile(ifacePath, userServiceIface);
symbolIndexer.indexSingleFile(implPath, userServiceImpl);
symbolIndexer.indexSingleFile(testPath, userServiceTest);
symbolIndexer.indexSingleFile(repoIfacePath, userRepoCustomIface);
symbolIndexer.indexSingleFile(repoImplPath, userRepoImpl);

// Teste 1: Ctrl+Click no método createUser dentro de UserService.java
console.log('1. Testando Ctrl+Click em método de interface (UserService.createUser)...');
const defsCreateUser = symbolIndexer.findDefinition(ifacePath, 'createUser', '    void createUser(UserDto user);');
assert.ok(Array.isArray(defsCreateUser) && defsCreateUser.length > 0, 'Deve encontrar definições para createUser');
assert.strictEqual(defsCreateUser[0].filePath, implPath, 'Primeiro resultado DEVE ser a implementação concreta UserServiceImpl.java');
assert.strictEqual(defsCreateUser[0].line, 17, 'Linha do método createUser na implementação');
console.log('  ok   Pulo direto para UserServiceImpl.createUser (linha 17) sem abrir modal ou escolher arquivo');

// Teste 2: O arquivo de teste NUNCA deve ser o primeiro resultado
console.log('2. Testando supressão de arquivos de teste...');
assert.notStrictEqual(defsCreateUser[0].filePath, testPath, 'Arquivo de teste não deve ser o primeiro resultado');
console.log('  ok   Arquivo de teste despriorizado com sucesso');

// Teste 3: Gutter icons para a interface e para os métodos
console.log('3. Testando ícones de calha (Gutter markers)...');
const gutters = symbolIndexer.getGutterInfo(ifacePath);
assert.ok(Array.isArray(gutters) && gutters.length === 4, `Esperado 4 gutters (1 interface + 3 métodos), recebido ${gutters.length}`);

const ifaceGutter = gutters.find(g => g.kind === 'interface');
assert.ok(ifaceGutter, 'Gutter da interface deve existir');
assert.strictEqual(ifaceGutter.target.filePath, implPath);

const methodGutters = gutters.filter(g => g.kind === 'interface-method');
assert.strictEqual(methodGutters.length, 3, 'Deve haver gutter em cada um dos 3 métodos da interface');
assert.strictEqual(methodGutters[0].symbol, 'createUser');
assert.strictEqual(methodGutters[0].target.line, 17);
assert.strictEqual(methodGutters[1].symbol, 'findById');
assert.strictEqual(methodGutters[1].target.line, 22);
assert.strictEqual(methodGutters[2].symbol, 'findAll');
assert.strictEqual(methodGutters[2].target.line, 27);
console.log('  ok   Calha exibe setas ↓ nos 3 métodos e I↓ na interface apontando para as linhas exatas');

// Teste 4: Spring Data Custom Repositories (UserRepositoryCustom -> UserRepositoryImpl)
console.log('4. Testando Repositório Customizado Spring Data (UserRepositoryCustom -> UserRepositoryImpl)...');
const defsRepo = symbolIndexer.findDefinition(repoIfacePath, 'searchCustom', '    List<User> searchCustom(UserFilter filter);');
assert.ok(Array.isArray(defsRepo) && defsRepo.length > 0, 'Deve encontrar definição para searchCustom');
assert.strictEqual(defsRepo[0].filePath, repoImplPath, 'Primeiro resultado DEVE ser UserRepositoryImpl.java');
assert.strictEqual(defsRepo[0].line, 13, 'Linha do método searchCustom na implementação');

const repoGutters = symbolIndexer.getGutterInfo(repoIfacePath);
assert.strictEqual(repoGutters.length, 2, 'Deve haver gutter para interface e método custom');
assert.strictEqual(repoGutters[1].symbol, 'searchCustom');
assert.strictEqual(repoGutters[1].target.line, 13);
console.log('  ok   Spring Data Custom Repository navega perfeitamente para UserRepositoryImpl');

console.log('\nTodos os testes de Navegação de Código Java (Interface -> Impl) passaram com sucesso! 🎉\n');
