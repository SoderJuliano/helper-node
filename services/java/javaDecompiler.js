// services/java/javaDecompiler.js
const path = require('path');

function parseJavaTypeDescriptor(desc) {
  if (!desc) return 'void';
  if (desc === 'V') return 'void';
  if (desc === 'Z') return 'boolean';
  if (desc === 'B') return 'byte';
  if (desc === 'C') return 'char';
  if (desc === 'S') return 'short';
  if (desc === 'I') return 'int';
  if (desc === 'J') return 'long';
  if (desc === 'F') return 'float';
  if (desc === 'D') return 'double';
  if (desc.startsWith('[')) return parseJavaTypeDescriptor(desc.slice(1)) + '[]';
  if (desc.startsWith('L') && desc.endsWith(';')) {
    let raw = desc.slice(1, -1).replace(/\//g, '.');
    if (raw.startsWith('java.lang.')) raw = raw.slice(10);
    return raw;
  }
  return desc.replace(/\//g, '.');
}

function parseMethodDescriptor(desc) {
  if (!desc || !desc.startsWith('(')) return { params: [], returnType: 'void' };
  const closingParen = desc.indexOf(')');
  if (closingParen === -1) return { params: [], returnType: 'void' };
  const paramStr = desc.slice(1, closingParen);
  const retStr = desc.slice(closingParen + 1);
  const params = [];
  let pos = 0;
  while (pos < paramStr.length) {
    let dims = '';
    while (paramStr[pos] === '[') { dims += '[]'; pos++; }
    const ch = paramStr[pos];
    if (['Z','B','C','S','I','J','F','D'].includes(ch)) {
      params.push(parseJavaTypeDescriptor(ch) + dims);
      pos++;
    } else if (ch === 'L') {
      const end = paramStr.indexOf(';', pos);
      if (end === -1) break;
      params.push(parseJavaTypeDescriptor(paramStr.slice(pos, end + 1)) + dims);
      pos = end + 1;
    } else {
      pos++;
    }
  }
  return { params, returnType: parseJavaTypeDescriptor(retStr) };
}

function decompileClassFile(buf, jarPath, fqcn) {
  try {
    if (!buf || buf.length < 24) return null;
    if (buf.readUInt32BE(0) !== 0xCAFEBABE) return null;

    const minorVer = buf.readUInt16BE(4);
    const majorVer = buf.readUInt16BE(6);

    const cpCount = buf.readUInt16BE(8);
    const cp = new Array(cpCount);
    let offset = 10;

    for (let i = 1; i < cpCount; i++) {
      if (offset >= buf.length) break;
      const tag = buf[offset++];
      if (tag === 1) {
        if (offset + 2 > buf.length) break;
        const len = buf.readUInt16BE(offset); offset += 2;
        if (offset + len > buf.length) break;
        cp[i] = { tag: 1, val: buf.toString('utf8', offset, offset + len) };
        offset += len;
      } else if (tag === 3 || tag === 4) {
        offset += 4;
      } else if (tag === 5 || tag === 6) {
        offset += 8;
        i++;
      } else if (tag === 7) {
        if (offset + 2 > buf.length) break;
        const nameIdx = buf.readUInt16BE(offset); offset += 2;
        cp[i] = { tag: 7, nameIdx };
      } else if (tag === 8) {
        offset += 2;
      } else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) {
        offset += 4;
      } else if (tag === 15) {
        offset += 3;
      } else if (tag === 16 || tag === 19 || tag === 20) {
        offset += 2;
      } else {
        break;
      }
    }

    if (offset + 6 > buf.length) {
      const parts = (fqcn || 'UnknownClass').split('.');
      const simpleName = parts.pop();
      const pkgName = parts.join('.');
      let code = `// Decompiled from: ${path.basename(jarPath)}!${(fqcn || '').replace(/\\./g, '/')}.class\n\n`;
      if (pkgName) code += `package ${pkgName};\n\n`;
      code += `public class ${simpleName} {\n    // Bytecode format version ${majorVer}.${minorVer}\n}\n`;
      return code;
    }

    const getUtf8 = (idx) => (cp[idx] && cp[idx].tag === 1) ? cp[idx].val : '';
    const getClassName = (idx) => (cp[idx] && cp[idx].tag === 7) ? getUtf8(cp[idx].nameIdx).replace(/\//g, '.') : '';

    const accessFlags = buf.readUInt16BE(offset); offset += 2;
    const thisClassIdx = buf.readUInt16BE(offset); offset += 2;
    const superClassIdx = buf.readUInt16BE(offset); offset += 2;

    const thisClassName = getClassName(thisClassIdx) || fqcn;
    const superClassName = getClassName(superClassIdx);

    const interfacesCount = (offset + 2 <= buf.length) ? buf.readUInt16BE(offset) : 0;
    offset += 2;
    const interfaces = [];
    for (let i = 0; i < interfacesCount; i++) {
      if (offset + 2 > buf.length) break;
      const ifaceIdx = buf.readUInt16BE(offset); offset += 2;
      const ifaceName = getClassName(ifaceIdx);
      if (ifaceName) interfaces.push(ifaceName);
    }

    const isInterface = (accessFlags & 0x0200) !== 0;
    const isAnnotation = (accessFlags & 0x2000) !== 0;
    const isEnum = (accessFlags & 0x4000) !== 0;
    const isRecord = superClassName === 'java.lang.Record';
    const isAbstract = (accessFlags & 0x0400) !== 0;
    const isFinal = (accessFlags & 0x0010) !== 0;

    let classKind = 'class';
    if (isRecord) classKind = 'record';
    else if (isAnnotation) classKind = '@interface';
    else if (isInterface) classKind = 'interface';
    else if (isEnum) classKind = 'enum';

    const fieldsCount = (offset + 2 <= buf.length) ? Math.min(buf.readUInt16BE(offset), 2000) : 0;
    offset += 2;
    const fields = [];
    for (let i = 0; i < fieldsCount; i++) {
      if (offset + 8 > buf.length) break;
      const fFlags = buf.readUInt16BE(offset); offset += 2;
      const fNameIdx = buf.readUInt16BE(offset); offset += 2;
      const fDescIdx = buf.readUInt16BE(offset); offset += 2;
      const fAttrCount = buf.readUInt16BE(offset); offset += 2;

      for (let a = 0; a < fAttrCount; a++) {
        if (offset + 6 > buf.length) break;
        const attrLen = buf.readUInt32BE(offset + 2);
        offset += 6 + Math.min(attrLen, Math.max(0, buf.length - offset - 6));
      }

      const fName = getUtf8(fNameIdx);
      const fDesc = getUtf8(fDescIdx);
      if (fName && !fName.includes('$')) {
        fields.push({ flags: fFlags, name: fName, type: parseJavaTypeDescriptor(fDesc) });
      }
    }

    const methodsCount = (offset + 2 <= buf.length) ? Math.min(buf.readUInt16BE(offset), 2000) : 0;
    offset += 2;
    const methods = [];
    for (let i = 0; i < methodsCount; i++) {
      if (offset + 8 > buf.length) break;
      const mFlags = buf.readUInt16BE(offset); offset += 2;
      const mNameIdx = buf.readUInt16BE(offset); offset += 2;
      const mDescIdx = buf.readUInt16BE(offset); offset += 2;
      const mAttrCount = buf.readUInt16BE(offset); offset += 2;

      for (let a = 0; a < mAttrCount; a++) {
        if (offset + 6 > buf.length) break;
        const attrLen = buf.readUInt32BE(offset + 2);
        offset += 6 + Math.min(attrLen, Math.max(0, buf.length - offset - 6));
      }

      const mName = getUtf8(mNameIdx);
      const mDesc = getUtf8(mDescIdx);
      if (mName && mName !== '<clinit>' && !mName.includes('$')) {
        methods.push({ flags: mFlags, name: mName, parsed: parseMethodDescriptor(mDesc) });
      }
    }

    const jarFileName = path.basename(jarPath);
    const parts = (thisClassName || fqcn || 'Class').split('.');
    const simpleName = parts.pop();
    const pkgName = parts.join('.');

    let code = `// Decompiled from: ${jarFileName}!${(thisClassName || fqcn || '').replace(/\\./g, '/')}.class\n`;
    code += `// (Class file format version ${majorVer}.${minorVer})\n\n`;
    if (pkgName) code += `package ${pkgName};\n\n`;

    if (isRecord) {
      const recordParams = fields.map(f => `${f.type} ${f.name}`).join(', ');
      code += `public record ${simpleName}(${recordParams}) {\n\n`;
    } else {
      let decl = 'public ';
      if (isAbstract && classKind === 'class') decl += 'abstract ';
      if (isFinal && classKind === 'class') decl += 'final ';
      decl += `${classKind} ${simpleName}`;

      if (superClassName && superClassName !== 'java.lang.Object' && superClassName !== 'java.lang.Enum' && classKind === 'class') {
        decl += ` extends ${superClassName}`;
      }
      if (interfaces.length > 0 && classKind !== '@interface') {
        decl += ` implements ${interfaces.join(', ')}`;
      }
      decl += ' {\n\n';
      code += decl;
    }

    if (isEnum) {
      const enumConstants = fields.filter(f => (f.flags & 0x4000) !== 0 || ((f.flags & 0x0008) !== 0 && f.type === simpleName));
      if (enumConstants.length > 0) {
        code += `    ${enumConstants.map(c => c.name).join(', ')};\n\n`;
      }
    }

    if (!isRecord) {
      const normalFields = isEnum ? fields.filter(f => (f.flags & 0x4000) === 0 && f.type !== simpleName) : fields;
      for (const f of normalFields) {
        let fVisibility = 'private ';
        if ((f.flags & 0x0001) !== 0) fVisibility = 'public ';
        else if ((f.flags & 0x0004) !== 0) fVisibility = 'protected ';
        let fMod = '';
        if ((f.flags & 0x0008) !== 0) fMod += 'static ';
        if ((f.flags & 0x0010) !== 0) fMod += 'final ';
        code += `    ${fVisibility}${fMod}${f.type} ${f.name};\n`;
      }
      if (normalFields.length > 0) code += '\n';
    }

    for (const m of methods) {
      let mVisibility = 'public ';
      if ((m.flags & 0x0002) !== 0) mVisibility = 'private ';
      else if ((m.flags & 0x0004) !== 0) mVisibility = 'protected ';
      let mMod = '';
      if ((m.flags & 0x0008) !== 0) mMod += 'static ';
      if ((m.flags & 0x0010) !== 0) mMod += 'final ';
      if ((m.flags & 0x0400) !== 0 && classKind === 'class') mMod += 'abstract ';

      const paramList = m.parsed.params.map((p, idx) => `${p} arg${idx}`).join(', ');
      if (m.name === '<init>') {
        code += `    ${mVisibility}${simpleName}(${paramList}) { /* compiled code */ }\n`;
      } else {
        if (classKind === 'interface' || classKind === '@interface' || (m.flags & 0x0400) !== 0) {
          code += `    ${mVisibility}${mMod}${m.parsed.returnType} ${m.name}(${paramList});\n`;
        } else {
          code += `    ${mVisibility}${mMod}${m.parsed.returnType} ${m.name}(${paramList}) { /* compiled code */ }\n`;
        }
      }
    }

    code += '}\n';
    return code;
  } catch (err) {
    const parts = (fqcn || 'UnknownClass').split('.');
    const simpleName = parts.pop();
    const pkgName = parts.join('.');
    let code = `// Decompiled from: ${path.basename(jarPath)}!${(fqcn || '').replace(/\\./g, '/')}.class\n\n`;
    if (pkgName) code += `package ${pkgName};\n\n`;
    code += `public class ${simpleName} {\n    // Sem visualização detalhada de bytecode disponível\n}\n`;
    return code;
  }
}

module.exports = {
  parseJavaTypeDescriptor,
  parseMethodDescriptor,
  decompileClassFile,
};
