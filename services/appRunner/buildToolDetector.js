// services/appRunner/buildToolDetector.js
// Identifica ferramenta de build (Gradle / Maven / Standalone Java)
// e gera os comandos de execução apropriados para Spring Boot, Main isolado e JUnit.

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
    const wrapperPath = path.join(projectDir, gradlewScript);
    const hasGradlew = fs.existsSync(wrapperPath);

    if (!isWin && hasGradlew) {
      try { fs.chmodSync(wrapperPath, 0o755); } catch (_) {}
    }

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
        wrapperCmd: hasGradlew ? wrapperPath : (isWin ? 'gradle.bat' : 'gradle'),
        fallbackCmd: isWin ? 'gradle.bat' : 'gradle',
        isSpringBoot,
        projectDir,
      };
    }

    // 2. Verifica Maven
    const hasPom = fs.existsSync(path.join(projectDir, 'pom.xml'));
    const mvnwScript = isWin ? 'mvnw.cmd' : 'mvnw';
    const mvnwPath = path.join(projectDir, mvnwScript);
    const hasMvnw = fs.existsSync(mvnwPath);

    if (!isWin && hasMvnw) {
      try { fs.chmodSync(mvnwPath, 0o755); } catch (_) {}
    }

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
        wrapperCmd: hasMvnw ? mvnwPath : (isWin ? 'mvn.cmd' : 'mvn'),
        fallbackCmd: isWin ? 'mvn.cmd' : 'mvn',
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
   *   kind: 'app' | 'isolated-main' | 'test-all' | 'test-class' | 'test-method',
   *   mainClass?: string,     // ex: 'com.example.DemoApplication'
   *   testClass?: string,     // ex: 'com.example.DemoApplicationTests'
   *   testMethod?: string,    // ex: 'contextLoads'
   *   filePath?: string,      // caminho do arquivo .java
   *   isSpringBoot?: boolean,
   *   isIsolatedMain?: boolean,
   *   isInstanceMain?: boolean,
   *   args?: string[],
   *   extraArgs?: string[]
   * }
   * projectConfig?: {
   *   activeProfiles?: string,
   *   vmOptions?: string,
   *   programArgs?: string,
   *   selectedJdkPath?: string
   * }
   * jdkInfo?: { javaPath, majorVersion, isPreviewSupported }
   */
  static buildCommand(buildInfo, target = {}, projectConfig = {}, jdkInfo = null) {
    const isWin = process.platform === 'win32';
    const kind = target.kind || 'app';

    const activeProfiles = (projectConfig && projectConfig.activeProfiles) ? String(projectConfig.activeProfiles).trim() : '';
    const vmOptions = (projectConfig && projectConfig.vmOptions) ? String(projectConfig.vmOptions).trim() : '';
    const programArgs = (projectConfig && projectConfig.programArgs) ? String(projectConfig.programArgs).trim() : '';

    // 1. Execução de Main Isolado / Teste Local Single-File (Java 21/25+ instance main ou main isolado sem Spring)
    if (kind === 'isolated-main' || (target.isIsolatedMain && (target.filePath || target.mainClass))) {
      const javaExe = (jdkInfo && jdkInfo.javaPath) ? jdkInfo.javaPath : 'java';
      const args = [];

      // Passa --enable-preview se Java 21+ ou se método for instance main (void main())
      const isPreview = (jdkInfo && jdkInfo.majorVersion >= 21) || target.isInstanceMain || (jdkInfo && jdkInfo.isPreviewSupported);
      if (isPreview) {
        args.push('--enable-preview');
      }

      if (vmOptions) {
        args.push(...vmOptions.split(/\s+/).filter(Boolean));
      }
      if (activeProfiles) {
        args.push(`-Dspring.profiles.active=${activeProfiles}`);
      }

      const fileOrClass = target.filePath || target.mainClass;
      args.push(fileOrClass);

      if (programArgs) {
        args.push(...programArgs.split(/\s+/).filter(Boolean));
      }

      if (target.extraArgs && target.extraArgs.length) {
        args.push(...target.extraArgs);
      }

      const displayCmd = `java ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
      const baseName = path.basename(fileOrClass, '.java');

      return {
        executable: javaExe,
        args,
        fullCommand: displayCmd,
        displayName: `${baseName}.main() (Local)`,
      };
    }

    const cmd = buildInfo.hasWrapper ? buildInfo.wrapperCmd : buildInfo.fallbackCmd;

    // 2. Execução via Gradle
    if (buildInfo.type === 'gradle') {
      let args = [];
      if (kind === 'app') {
        if (buildInfo.isSpringBoot || target.isSpringBoot) {
          args.push('bootRun', '--console=plain');

          if (activeProfiles) {
            args.push(`-Dspring.profiles.active=${activeProfiles}`);
            args.push(`-Dspring-boot.run.profiles=${activeProfiles}`);
          }
          if (target.mainClass) {
            args.push(`-PmainClass=${target.mainClass}`);
            args.push(`-Dspring-boot.run.main-class=${target.mainClass}`);
          }
          if (programArgs) {
            args.push(`--args=${programArgs}`);
          }

          if (vmOptions) {
            const vmParts = vmOptions.split(/\s+/).filter(Boolean);
            vmParts.forEach(vp => {
              if (vp.startsWith('-D')) {
                args.push(vp);
              } else {
                args.push(`-Dorg.gradle.jvmargs=${vmOptions}`);
              }
            });
          }
        } else {
          args.push('run', '--console=plain');
          if (activeProfiles) {
            args.push(`-Dspring.profiles.active=${activeProfiles}`);
          }
          if (target.mainClass) {
            args.push(`-PmainClass=${target.mainClass}`);
          }
          if (programArgs) {
            args.push(`--args=${programArgs}`);
          }
          if (vmOptions) {
            const vmParts = vmOptions.split(/\s+/).filter(Boolean);
            args.push(...vmParts);
          }
        }
      } else if (kind === 'test-all') {
        args.push('test', '--rerun-tasks', '--info', '--console=plain');
        if (activeProfiles) {
          args.push(`-Dspring.profiles.active=${activeProfiles}`);
        }
        if (vmOptions) {
          const vmParts = vmOptions.split(/\s+/).filter(Boolean);
          args.push(...vmParts);
        }
      } else if (kind === 'test-class') {
        const pattern = target.testClass || '*';
        args.push('test', '--rerun-tasks', '--tests', pattern, '--info', '--console=plain');
        if (activeProfiles) {
          args.push(`-Dspring.profiles.active=${activeProfiles}`);
        }
        if (vmOptions) {
          const vmParts = vmOptions.split(/\s+/).filter(Boolean);
          args.push(...vmParts);
        }
      } else if (kind === 'test-method') {
        const pattern = target.testClass && target.testMethod
          ? `${target.testClass}.${target.testMethod}`
          : (target.testMethod || '*');
        args.push('test', '--rerun-tasks', '--tests', pattern, '--info', '--console=plain');
        if (activeProfiles) {
          args.push(`-Dspring.profiles.active=${activeProfiles}`);
        }
        if (vmOptions) {
          const vmParts = vmOptions.split(/\s+/).filter(Boolean);
          args.push(...vmParts);
        }
      }

      if (target.extraArgs && target.extraArgs.length) {
        args.push(...target.extraArgs);
      }

      return {
        executable: cmd,
        args,
        fullCommand: `${path.basename(cmd)} ${args.join(' ')}`,
        displayName: this.getDisplayName(buildInfo, target),
      };
    }

    // 3. Execução via Maven
    if (buildInfo.type === 'maven') {
      let args = ['-B'];
      if (kind === 'app') {
        if (buildInfo.isSpringBoot || target.isSpringBoot) {
          args.push('spring-boot:run');
          if (activeProfiles) {
            args.push(`-Dspring-boot.run.profiles=${activeProfiles}`);
            args.push(`-Dspring.profiles.active=${activeProfiles}`);
          }
          if (target.mainClass) {
            args.push(`-Dspring-boot.run.main-class=${target.mainClass}`);
          }
          if (vmOptions) {
            args.push(`-Dspring-boot.run.jvmArguments=${vmOptions}`);
          }
          if (programArgs) {
            args.push(`-Dspring-boot.run.arguments=${programArgs}`);
          }
        } else {
          args.push('compile', 'exec:java');
          if (target.mainClass) {
            args.push(`-Dexec.mainClass=${target.mainClass}`);
          }
          if (programArgs) {
            args.push(`-Dexec.args=${programArgs}`);
          }
          if (vmOptions) {
            const vmParts = vmOptions.split(/\s+/).filter(Boolean);
            args.push(...vmParts);
          }
        }
      } else if (kind === 'test-all') {
        args.push('test');
        if (activeProfiles) {
          args.push(`-Dspring.profiles.active=${activeProfiles}`);
        }
        if (vmOptions) {
          args.push(`-DargLine=${vmOptions}`);
        }
      } else if (kind === 'test-class') {
        const pattern = target.testClass || '*';
        args.push('test', `-Dtest=${pattern}`);
        if (activeProfiles) {
          args.push(`-Dspring.profiles.active=${activeProfiles}`);
        }
        if (vmOptions) {
          args.push(`-DargLine=${vmOptions}`);
        }
      } else if (kind === 'test-method') {
        const pattern = target.testClass && target.testMethod
          ? `${target.testClass}#${target.testMethod}`
          : (target.testMethod || '*');
        args.push('test', `-Dtest=${pattern}`);
        if (activeProfiles) {
          args.push(`-Dspring.profiles.active=${activeProfiles}`);
        }
        if (vmOptions) {
          args.push(`-DargLine=${vmOptions}`);
        }
      }

      if (target.extraArgs && target.extraArgs.length) {
        args.push(...target.extraArgs);
      }

      return {
        executable: cmd,
        args,
        fullCommand: `${path.basename(cmd)} ${args.join(' ')}`,
        displayName: this.getDisplayName(buildInfo, target),
      };
    }

    // 4. Java standalone (sem Maven/Gradle)
    const javaExe = (jdkInfo && jdkInfo.javaPath) ? jdkInfo.javaPath : 'java';
    if (target.mainClass || target.filePath) {
      const standaloneArgs = [];
      if (jdkInfo && jdkInfo.majorVersion >= 21) {
        standaloneArgs.push('--enable-preview');
      }
      if (vmOptions) {
        standaloneArgs.push(...vmOptions.split(/\s+/).filter(Boolean));
      }
      if (activeProfiles) {
        standaloneArgs.push(`-Dspring.profiles.active=${activeProfiles}`);
      }
      standaloneArgs.push(target.filePath || target.mainClass);
      if (programArgs) {
        standaloneArgs.push(...programArgs.split(/\s+/).filter(Boolean));
      }

      return {
        executable: javaExe,
        args: standaloneArgs,
        fullCommand: `java ${standaloneArgs.join(' ')}`,
        displayName: `Java ${path.basename(target.filePath || target.mainClass, '.java')}`,
      };
    }

    return {
      executable: javaExe,
      args: ['-version'],
      fullCommand: 'java -version',
      displayName: 'Java App',
    };
  }

  static getDisplayName(buildInfo, target) {
    if (target.kind === 'isolated-main') {
      const name = path.basename(target.filePath || target.mainClass || 'Main', '.java');
      return `${name}.main() (Local)`;
    }
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
