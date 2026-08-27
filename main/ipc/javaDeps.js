// main/ipc/javaDeps.js
// Handlers IPC pro nó "Dependencies" da árvore do modo IDE (Maven/Gradle) —
// lista os jars do classpath resolvido e as classes dentro de cada um.
// Abrir uma classe passa pelo read-file-content normal (ver main/ipc/workspace.js),
// não tem handler próprio: o caminho virtual (jar!Classe.java) já basta.

const { ipcMain } = require('electron');
const javaImportChecker = require('../../services/javaImportChecker.js');

module.exports = function registerJavaDepsIPC() {
  ipcMain.handle('java-deps:list-jars', async (_event, { dirPath } = {}) => {
    try {
      if (!dirPath) return { status: 'error', error: 'pasta vazia' };
      return javaImportChecker.listDependencyJars(dirPath);
    } catch (e) {
      console.warn('[javaDeps] Erro ao listar jars:', e.message);
      return { status: 'error', error: e.message };
    }
  });

  ipcMain.handle('java-deps:list-classes', async (_event, { jarPath } = {}) => {
    try {
      if (!jarPath) return { classes: [] };
      const classes = javaImportChecker.listJarClasses(jarPath);
      return {
        classes: classes.map((fqcn) => ({ fqcn, virtualPath: javaImportChecker.encodeVirtualPath(jarPath, fqcn) })),
      };
    } catch (e) {
      console.warn('[javaDeps] Erro ao listar classes do jar:', e.message);
      return { classes: [], error: e.message };
    }
  });

  ipcMain.handle('java-deps:detect', async (_event, { projectDir } = {}) => {
    try {
      if (!projectDir) return { isJavaProject: false };
      return javaImportChecker.detectProjectType(projectDir);
    } catch (e) {
      console.warn('[javaDeps] Erro ao detectar tipo de projeto:', e.message);
      return { isJavaProject: false, error: e.message };
    }
  });

  ipcMain.handle('java-deps:sync', async (_event, { projectDir, forceDownload = true } = {}) => {
    try {
      if (!projectDir) return { ok: false, error: 'Diretório do projeto não especificado.' };
      return await javaImportChecker.syncDependencies(projectDir, { forceDownload });
    } catch (e) {
      console.warn('[javaDeps] Erro ao sincronizar dependências:', e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('java-deps:get-sync-log', async (_event, { projectDir } = {}) => {
    try {
      if (!projectDir) return '';
      return javaImportChecker.getSyncLog(projectDir);
    } catch (e) {
      return 'Erro ao obter logs: ' + e.message;
    }
  });
};
