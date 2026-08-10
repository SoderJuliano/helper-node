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
};
