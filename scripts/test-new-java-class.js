const assert = require('assert');
const path = require('path');

// Mock browser window environment for testing
global.window = {};
require('../renderer/newJavaClassModal.js');

const { resolveJavaClassTarget, generateJavaTemplate } = global.window;

console.log('=== Testando New Java Class Resolution & Templates (IntelliJ Style) ===\n');

// 1. Testando resolveJavaClassTarget em pacote padrão
{
  const parent = 'C:/MyProject/src/main/java/com/empresa/service';
  const root = 'C:/MyProject';
  const res = resolveJavaClassTarget(parent, 'UserService', root);

  assert.strictEqual(res.typeName, 'UserService', 'typeName deve ser UserService');
  assert.strictEqual(res.packageName, 'com.empresa.service', 'packageName deve ser com.empresa.service');
  assert.strictEqual(res.filePath.replace(/\\/g, '/'), 'C:/MyProject/src/main/java/com/empresa/service/UserService.java');
  console.log('  [OK] Criação simples de classe no pacote atual');
}

// 2. Testando subpacote via notação de ponto (ex: dto.UserDto)
{
  const parent = 'C:/MyProject/src/main/java/com/empresa';
  const root = 'C:/MyProject';
  const res = resolveJavaClassTarget(parent, 'dto.UserDto', root);

  assert.strictEqual(res.typeName, 'UserDto', 'typeName deve ser UserDto');
  assert.strictEqual(res.packageName, 'com.empresa.dto', 'packageName deve ser com.empresa.dto');
  assert.strictEqual(res.filePath.replace(/\\/g, '/'), 'C:/MyProject/src/main/java/com/empresa/dto/UserDto.java');
  console.log('  [OK] Criação com subpacote relativo (dto.UserDto)');
}

// 3. Testando pacote completo a partir da raiz de fontes
{
  const parent = 'C:/MyProject/src/main/java';
  const root = 'C:/MyProject';
  const res = resolveJavaClassTarget(parent, 'br.com.app.controller.ApiController', root);

  assert.strictEqual(res.typeName, 'ApiController');
  assert.strictEqual(res.packageName, 'br.com.app.controller');
  assert.strictEqual(res.filePath.replace(/\\/g, '/'), 'C:/MyProject/src/main/java/br/com/app/controller/ApiController.java');
  console.log('  [OK] Criação com pacote completo (br.com.app.controller.ApiController)');
}

// 4. Testando raiz de testes (src/test/java)
{
  const parent = 'C:/MyProject/src/test/java/com/empresa/service';
  const root = 'C:/MyProject';
  const res = resolveJavaClassTarget(parent, 'UserServiceTest', root);

  assert.strictEqual(res.typeName, 'UserServiceTest');
  assert.strictEqual(res.packageName, 'com.empresa.service');
  assert.strictEqual(res.filePath.replace(/\\/g, '/'), 'C:/MyProject/src/test/java/com/empresa/service/UserServiceTest.java');
  console.log('  [OK] Criação dentro de src/test/java');
}

// 5. Testando Templates Java
{
  const tClass = generateJavaTemplate('com.example', 'UserService', 'class');
  assert.ok(tClass.includes('package com.example;'), 'Template Class deve conter package');
  assert.ok(tClass.includes('public class UserService {'), 'Template Class deve conter public class');

  const tInterface = generateJavaTemplate('com.example', 'UserRepository', 'interface');
  assert.ok(tInterface.includes('public interface UserRepository {'), 'Template Interface');

  const tEnum = generateJavaTemplate('com.example', 'Status', 'enum');
  assert.ok(tEnum.includes('public enum Status {'), 'Template Enum');

  const tRecord = generateJavaTemplate('com.example', 'UserRecord', 'record');
  assert.ok(tRecord.includes('public record UserRecord() {'), 'Template Record');

  const tAnnotation = generateJavaTemplate('com.example', 'Audited', 'annotation');
  assert.ok(tAnnotation.includes('public @interface Audited {'), 'Template Annotation');

  console.log('  [OK] Templates Java para Class, Interface, Enum, Record e @interface gerados com perfeição');
}

console.log('\nTodos os testes de New Java Class passaram com 100% de sucesso!');
