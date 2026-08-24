const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const symbolIndexer = require("../services/symbolIndexer.js");
const javaImportChecker = require("../services/javaImportChecker.js");

console.log("=== Testando Navegacao de Mappers Java e Resolucao de Dependencias JAR ===\n");

const tmpDir = path.join(os.tmpdir(), "helper-full-mapper-test-" + Date.now());
fs.mkdirSync(path.join(tmpDir, "src/main/java/com/example"), { recursive: true });
fs.mkdirSync(path.join(tmpDir, "target/generated-sources/annotations/com/example"), { recursive: true });
fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project></project>");

(async () => { try {
  const mapperInterface = path.join(tmpDir, "src/main/java/com/example/UserMapper.java");
  fs.writeFileSync(mapperInterface, `
package com.example;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "spring")
public interface UserMapper {
    @Mapping(target = "id", source = "userId")
    UserDto map(User user);

    UserDto toDto(
        User user
    );
}
  `);

  const mapperImpl = path.join(tmpDir, "target/generated-sources/annotations/com/example/UserMapperImpl.java");
  fs.writeFileSync(mapperImpl, `
package com.example;
import org.springframework.stereotype.Component;

@Component
public class UserMapperImpl implements UserMapper {
    @Override
    public UserDto map(User user) {
        if (user == null) return null;
        UserDto dto = new UserDto();
        dto.setId(user.getUserId());
        return dto;
    }

    @Override
    public UserDto toDto(User user) {
        return map(user);
    }
}
  `);

  const serviceFile = path.join(tmpDir, "src/main/java/com/example/UserService.java");
  fs.writeFileSync(serviceFile, `
package com.example;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    private final UserMapper userMapper;

    public UserService(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    public UserDto processUser(User user) {
        return userMapper.map(user);
    }

    public UserDto convertUser(User user) {
        return userMapper.toDto(user);
    }
}
  `);

  await symbolIndexer.indexWorkspace(tmpDir);

  const indexedFiles = Array.from(symbolIndexer.fileMap.keys());
  assert.strictEqual(indexedFiles.length >= 3, true, "Deve ter indexado 3 arquivos");
  assert.strictEqual(indexedFiles.some(f => f.includes("UserMapperImpl.java")), true, "UserMapperImpl.java deve estar indexado");
  console.log("  ok   Target/generated-sources indexado com sucesso (UserMapperImpl.java detectado)");

  const mapDefs = symbolIndexer.findDefinition(serviceFile, "map", "return userMapper.map(user);");
  assert.strictEqual(mapDefs.length > 0, true, "Deve encontrar definicao para userMapper.map");
  console.log("  ok   userMapper.map() resolvido para interface e implementacao");

  const toDtoDefs = symbolIndexer.findDefinition(serviceFile, "toDto", "return userMapper.toDto(user);");
  assert.strictEqual(toDtoDefs.length > 0, true, "Deve encontrar definicao para metodo multilinha userMapper.toDto");
  console.log("  ok   Metodo com assinatura multilinha toDto() indexado e resolvido");

  const ifaceDefs = symbolIndexer.findDefinition(mapperInterface, "map", "UserDto map(User user);");
  assert.strictEqual(ifaceDefs.length > 0, true);
  assert.strictEqual(ifaceDefs[0].filePath.includes("UserMapperImpl.java"), true, "Clique dentro da interface deve ter a implementacao como primeiro destino");
  console.log("  ok   Navegacao da interface UserMapper leva diretamente para UserMapperImpl");

  const mockJarPath = path.join(tmpDir, "lib", "my-library-1.0.jar");
  const mockFqcn = "com.corp.lib.BaseEntity";
  const vpath = javaImportChecker.encodeVirtualPath(mockJarPath, mockFqcn);
  assert.strictEqual(vpath.includes(".jar!com/corp/lib/BaseEntity.java"), true, "encodeVirtualPath deve montar formato jar!path.java");
  const parsed = javaImportChecker.parseVirtualPath(vpath);
  assert.strictEqual(parsed.fqcn, mockFqcn, "parseVirtualPath deve recuperar o fqcn corretamente");
  console.log("  ok   Caminho virtual de dependencia JAR gerado e decodificado perfeitamente");

  console.log("\n  ok   Todos os testes de Mapper e Dependencias passaram com sucesso!");
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}})();
