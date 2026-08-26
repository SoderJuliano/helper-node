// services/java/autoImport/javaImportInjector.js
// Insere declaracoes de import no codigo Java de forma organizada, ordenada e sem duplicacoes (estilo IntelliJ).

function injectImport(content, fqnToImport) {
  if (!content || !fqnToImport) return content || '';
  const fqn = fqnToImport.trim();

  const lines = content.split('\n');
  const importLines = [];
  let packageLineIdx = -1;
  let firstImportLineIdx = -1;
  let lastImportLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^package\s+[a-zA-Z0-9_.]+\s*;/.test(trimmed)) {
      packageLineIdx = i;
      continue;
    }

    const impMatch = trimmed.match(/^import(?:\s+static)?\s+([a-zA-Z0-9_.]+)(\.\*)?\s*;/);
    if (impMatch) {
      if (firstImportLineIdx === -1) firstImportLineIdx = i;
      lastImportLineIdx = i;

      const importedFqn = impMatch[1];
      const isWildcard = !!impMatch[2];

      if (!isWildcard && importedFqn === fqn) return content;
      if (isWildcard) {
        const pkg = fqn.substring(0, fqn.lastIndexOf('.'));
        if (importedFqn === pkg) return content;
      }

      importLines.push({ lineIdx: i, text: trimmed, fqn: importedFqn, isStatic: trimmed.startsWith('import static') });
    }
  }

  const newImportText = `import ${fqn};`;

  // Caso 1: Ja existem imports no arquivo
  if (firstImportLineIdx !== -1 && lastImportLineIdx !== -1) {
    const allImports = importLines.map(item => item.text);
    allImports.push(newImportText);

    allImports.sort((a, b) => {
      const aIsStatic = a.startsWith('import static');
      const bIsStatic = b.startsWith('import static');
      if (aIsStatic !== bIsStatic) return aIsStatic ? 1 : -1;
      return a.localeCompare(b);
    });

    const uniqueImports = Array.from(new Set(allImports));
    const before = lines.slice(0, firstImportLineIdx);
    const after = lines.slice(lastImportLineIdx + 1);

    return [...before, ...uniqueImports, ...after].join('\n');
  }

  // Caso 2: Nao ha imports, mas ha package
  if (packageLineIdx !== -1) {
    const before = lines.slice(0, packageLineIdx + 1);
    const after = lines.slice(packageLineIdx + 1);
    return [...before, '', newImportText, ...after].join('\n');
  }

  // Caso 3: Nao ha package nem imports
  return `${newImportText}\n\n${content}`;
}

module.exports = {
  injectImport,
};