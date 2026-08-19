// services/appRunner/buildToolDetector.js
// Identifica ferramenta de build (Gradle / Maven / Standalone Java)
// e gera os comandos de execução apropriados para Spring Boot, Main e JUnit.

const fs = require('fs');
const path = require('path');

class BuildToolDetector {
  static detect(projectDir) {
    if (!projectDir || !fs.existsSync(projectDir)) {
      return { type: 'unknown', tool: 'java', hasWrapper: false, projectDir: projectDir || '' };
    }

    const isWin = process.platform === 'win32';

    // 1. Verifica Gradle
    const hasGradleBuild = fs.existsSync(path.join(projectDir, 'build.gradle')) ||
                          fs.existsSync(path.join(projectDir, 'build.gradle.kts')) ||
                          fs.existsSync(path.join(projectDir, 'settings.gradle')) ||
                          fs.existsSync(path.join(projectDir, 'settings.gradle.kts'));

    const gradlewScript = isWin ? 'gradlew.bat' : 'gradlew';
    const hasGradlew = fs.existsSync(path.join(projectDir, gradlewScript));

    if (hasGradleBuild || hasGradlew) {
      let isSpringBoot = false;
      try {
        const bg = fs.existsSync(path.join(projectDir, 'build.gradle'))
          ? fs.readFileSync(path.join(projectDir, 'build.gradle'), 'utf8')
          : (fs.existsSync(path.join(projectDir, 'build.gradle.kts'))
              ? fs.readFileSync(path.join(projectDir, 'build.gradle.kts'), 'utf8')
              : '');
        isSpringBoot = /org\.springframework\.boot|spring-boot-gradle-plugin|id\s*['"]org\.springframework\.boot['"]/i.test(bg);
      } catch (_) {}

      return {
        type: 'gradle',
        tool: 'gradle',
        hasWrapper: hasGradlew,
        wrapperCmd: isWin ? '.\\gradlew.bat' : './gradlew',
        fallbackCmd: 'gradle',
        isSpringBoot,
        projectDir,
      };
    }

    // 2. Verifica Maven
    const hasPom = fs.existsSync(path.join(projectDir, 'pom.xml'));
    const mvnwScript = isWin ? 'mvnw.cmd' : 'mvnw';
    const hasMvnw = fs.existsSync(path.join(projectDir, mvnwScript));

    if (hasPom || hasMvnw) {
      let isSpringBoot = false;
      try {
        if (hasPom) {
          const pom = fs.readFileSync(path.join(projectDir, 'pom.xml'), 'utf8');
          isSpringBoot = /spring-boot-starter|spring-boot-maven-plugin|org\.springframework\.boot/i.test(pom);
        }
      } catch (_) {}

      return {
        type: 'maven',
        tool: 'maven',
        hasWrapper: hasMvnw,
        wrapperCmd: isWin ? '.\\mvnw.cmd' : './mvnw',
        fallbackCmd: 'mvn',
        isSpringBoot,
        projectDir,
      };
    }

    // 3. Fallback: Java standalone
    return {
      type: 'java',
      tool: 'java',
      hasWrapper: false,
      isSpringBoot: false,
      projectDir,
    };
  }

  /**
   * Constrói o comando de execução para o alvo desejado.
   * target: {
   *   kind: 'app' | 'test-all' | 'test-class' | 'test-method',
   *   mainClass?: string,     // ex: 'com.example.DemoApplication'
   *   testClass?: string,     // ex: 'com.example.DemoApplicationTests'
   *   testMethod?: string,    // ex: 'contextLoads'
   *   isSpringBoot?: boolean,
   *   args?: string[]
   * }
   */
  static buildCommand(buildInfo, target = {}) {
    const isWin = process.platform === 'win32';
    const cmd = buildInfo.hasWrapper ? buildInfo.wrapperCmd : buildInfo.fallbackCmd;
    const kind = target.kind || 'app';

    if (buildInfo.type === 'gradle') {
      let args = [];
      if (kind === 'app') {
        if (buildInfo.isSpringBoot || target.isSpringBoot) {
          args.push('bootRun');
          if (target.mainClass) {
            args.push(`--args="--spring.main.class=${target.mainClass}"`);
          }
        } else {
          args.push('run');
          if (target.mainClass) {
            args.push(`-PmainClass=${target.mainClass}`);
          }
        }
      } else if (kind === 'test-all') {
        args.push('test', '--info');
      } else if (kind === 'test-class') {
        const pattern = target.testClass || '*';
        args.push('test', '--tests', `"${pattern}"`, '--info');
      } else if (kind === 'test-method') {
        const pattern = target.testClass && target.testMethod
          ? `${target.testClass}.${target.testMethod}`
          : (target.testMethod || '*');
        args.push('test', '--tests', `"${pattern}"`, '--info');
      }

      if (target.extraArgs && target.extraArgs.length) {
        args.push(...target.extraArgs);
      }

      return {
        executable: cmd,
        args,
        fullCommand: `${cmd} ${args.join(' ')}`,
        displayName: this.getDisplayName(buildInfo, target),
      };
    }

    if (buildInfo.type === 'maven') {
      let args = [];
      if (kind === 'app') {
        if (buildInfo.isSpringBoot || target.isSpringBoot) {
          args.push('spring-boot:run');
          if (target.mainClass) {
            args.push(`-Dspring-boot.run.main-class=${target.mainClass}`);
          }
        } else {
          args.push('compile', 'exec:java');
          if (target.mainClass) {
            args.push(`-Dexec.mainClass="${target.mainClass}"`);
          }
        }
      } else if (kind === 'test-all') {
        args.push('test');
      } else if (kind === 'test-class') {
        const pattern = target.testClass || '*';
        args.push('test', `-Dtest=${pattern}`);
      } else if (kind === 'test-method') {
        const pattern = target.testClass && target.testMethod
          ? `${target.testClass}#${target.testMethod}`
          : (target.testMethod || '*');
        args.push('test', `-Dtest=${pattern}`);
      }

      if (target.extraArgs && target.extraArgs.length) {
        args.push(...target.extraArgs);
      }

      return {
        executable: cmd,
        args,
        fullCommand: `${cmd} ${args.join(' ')}`,
        displayName: this.getDisplayName(buildInfo, target),
      };
    }

    // Java standalone (sem Maven/Gradle)
    if (target.mainClass) {
      return {
        executable: 'java',
        args: [target.mainClass],
        fullCommand: `java ${target.mainClass}`,
        displayName: `Java ${target.mainClass}`,
      };
    }

    return {
      executable: 'java',
      args: ['-version'],
      fullCommand: 'java -version',
      displayName: 'Java App',
    };
  }

  static getDisplayName(buildInfo, target) {
    const toolLabel = buildInfo.type === 'gradle' ? 'Gradle' : (buildInfo.type === 'maven' ? 'Maven' : 'Java');
    if (target.kind === 'test-method') {
      return `${toolLabel}: ${target.testMethod || 'Test'}`;
    }
    if (target.kind === 'test-class') {
      const simpleClass = target.testClass ? target.testClass.split('.').pop() : 'Tests';
      return `${toolLabel}: ${simpleClass}`;
    }
    if (target.kind === 'test-all') {
      return `${toolLabel}: All Tests`;
    }
    if (target.mainClass) {
      const simpleMain = target.mainClass.split('.').pop();
      return `${toolLabel}: ${simpleMain}`;
    }
    return `${toolLabel} ${buildInfo.isSpringBoot ? 'Spring Boot' : 'App'}`;
  }
}

module.exports = BuildToolDetector;
