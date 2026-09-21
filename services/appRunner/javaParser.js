// services/appRunner/javaParser.js
// Analisador leve e rápido de arquivos Java para detecção de métodos main(),
// classes Spring Boot, testes JUnit 4/5 e métodos isolados 'void main()' (Java 21/25+ Unnamed Classes).

class JavaParser {
  /**
   * Analisa o código fonte Java e retorna metadados de execução.
   * @param {string} source Código fonte Java
   * @param {string} [filePath] Caminho do arquivo para contexto
   * @returns {Object}
   */
  static parse(source, filePath = '') {
    if (!source || typeof source !== 'string') {
      return {
        packageName: '',
        className: '',
        fullClassName: '',
        isSpringBoot: false,
        isTestClass: false,
        isUnnamedClass: false,
        mainMethods: [],
        testMethods: [],
        classLine: 1,
      };
    }

    const lines = source.split(/\r?\n/);
    let packageName = '';
    let className = '';
    let classLine = 1;
    let hasExplicitClass = false;
    let isSpringBoot = false;
    let isTestClass = false;
    const mainMethods = [];
    const testMethods = [];

    // 1. Extração do package
    const pkgMatch = source.match(/package\s+([a-zA-Z0-9_.]+)\s*;/);
    if (pkgMatch) {
      packageName = pkgMatch[1].trim();
    }

    // 2. Extração da classe principal
    const classMatch = source.match(/(?:public\s+|abstract\s+|final\s+)*class\s+([a-zA-Z0-9_]+)/);
    if (classMatch) {
      className = classMatch[1].trim();
      hasExplicitClass = true;
    } else if (filePath) {
      const base = filePath.split(/[/\\]/).pop();
      className = base.replace(/\.java$/i, '');
    }

    // 3. Detecção precisa de Spring Boot
    if (
      /@SpringBootApplication\b/.test(source) ||
      /\bSpringApplication\.run\s*\(/.test(source) ||
      /@EnableAutoConfiguration\b/.test(source)
    ) {
      isSpringBoot = true;
    }

    // 4. Detecção de classe de teste JUnit 4/5
    if (
      /@SpringBootTest\b/.test(source) ||
      /@ExtendWith\b/.test(source) ||
      /@RunWith\b/.test(source) ||
      /@WebMvcTest\b/.test(source) ||
      /@DataJpaTest\b/.test(source) ||
      (className && (className.endsWith('Test') || className.endsWith('Tests') || className.endsWith('TestCase'))) ||
      filePath.includes('/test/') || filePath.includes('\\test\\')
    ) {
      isTestClass = true;
    }

    // 5. Varredura por linha para identificar métodos e números de linha
    let pendingTestAnnotation = false;
    let pendingTestLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1; // 1-indexed
      const line = lines[i].trim();

      // Identifica declaração da classe
      if (!classLine && /(?:public\s+|abstract\s+|final\s+)*class\s+[a-zA-Z0-9_]+/.test(line)) {
        classLine = lineNum;
      }

      // Identifica anotações de teste JUnit 4/5
      if (/@(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b/.test(line)) {
        pendingTestAnnotation = true;
        pendingTestLine = lineNum;
      }

      // Identifica main()
      // Padrões aceitos:
      // 1. Clássico: public static void main(String[] args) / static public void main(...)
      // 2. Moderno (Java 21/25+ JEP 445/463/477/495): void main(), void main(String[] args), int main()
      const isClassicMain = /(?:public\s+static|static\s+public)\s+(?:void|int)\s+main\s*\([^)]*\)/.test(line);
      const isInstanceMain = /(?:^|\s)(?:void|int)\s+main\s*\(\s*(?:String\s*\[\s*\]\s*[a-zA-Z0-9_]+|String\.\.\.\s*[a-zA-Z0-9_]+)?\s*\)/.test(line);

      if (isClassicMain || isInstanceMain) {
        const methodIsSpringBoot = isSpringBoot && (
          source.includes('@SpringBootApplication') ||
          source.includes('SpringApplication.run')
        );
        const isIsolated = !methodIsSpringBoot;

        mainMethods.push({
          name: 'main',
          line: lineNum,
          isSpringBoot: methodIsSpringBoot,
          isInstanceMain: isInstanceMain && !isClassicMain,
          isIsolatedMain: isIsolated,
          className,
          fullClassName: packageName ? `${packageName}.${className}` : className,
          signature: line,
        });
      }

      // Se temos uma anotação de teste pendente, procuramos a assinatura do método logo abaixo
      if (pendingTestAnnotation) {
        const methodMatch = line.match(/(?:public\s+|protected\s+|private\s+|default\s+)*(?:void|CompletableFuture|Mono|Flux|[a-zA-Z0-9_<>]+)\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\s*\{?/);
        if (methodMatch && methodMatch[1] && methodMatch[1] !== 'if' && methodMatch[1] !== 'while' && methodMatch[1] !== 'for') {
          const methodName = methodMatch[1];
          testMethods.push({
            name: methodName,
            line: pendingTestLine || lineNum,
            methodLine: lineNum,
            className,
            fullClassName: packageName ? `${packageName}.${className}` : className,
          });
          isTestClass = true;
          pendingTestAnnotation = false;
          pendingTestLine = -1;
        } else if (line && !line.startsWith('@') && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*')) {
          pendingTestAnnotation = false;
        }
      }
    }

    const fullClassName = packageName && className ? `${packageName}.${className}` : (className || '');

    return {
      packageName,
      className,
      fullClassName,
      isSpringBoot,
      isTestClass,
      isUnnamedClass: !hasExplicitClass && mainMethods.length > 0,
      mainMethods,
      testMethods,
      classLine: classLine || 1,
    };
  }
}

module.exports = JavaParser;
