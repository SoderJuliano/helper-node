// services/java/autoImport/javaRanker.js
// Algoritmo de ranking e priorizacao de imports no ecossistema Spring Boot e Java SE (IntelliJ Style).

const { SPRING_BOOT_CANONICAL_TYPES, JDK_CANONICAL_TYPES } = require('./javaSpringDictionary.js');
const { JDK_FQN_MAP } = require('../javaJdkConstants.js');

function calculatePriorityScore(fqn, simpleName, projectPackage) {
  let score = 0;

  // 1. Spring Framework / Spring Boot standard annotations & classes
  if (fqn.startsWith('org.springframework.boot.') || fqn.startsWith('org.springframework.web.') || fqn.startsWith('org.springframework.stereotype.') || fqn.startsWith('org.springframework.beans.')) {
    score += 1000;
  } else if (fqn.startsWith('org.springframework.')) {
    score += 800;
  }

  // 2. Core Java SE (util, time, math, io, nio, net, concurrent, stream)
  if (fqn.startsWith('java.util.') || fqn.startsWith('java.time.') || fqn.startsWith('java.math.') || fqn.startsWith('java.io.') || fqn.startsWith('java.nio.') || fqn.startsWith('java.net.')) {
    if (fqn === 'java.sql.Date' || fqn === 'java.sql.Timestamp') {
      score += 200;
    } else if (fqn === 'java.awt.List' || fqn === 'java.awt.Component') {
      score -= 500;
    } else {
      score += 900;
    }
  }

  // 3. Current project packages
  if (projectPackage && fqn.startsWith(projectPackage)) {
    score += 850;
  }

  // 4. Jakarta & Javax Persistence / Validation
  if (fqn.startsWith('jakarta.persistence.') || fqn.startsWith('jakarta.validation.')) {
    score += 750;
  } else if (fqn.startsWith('javax.persistence.') || fqn.startsWith('javax.validation.')) {
    score += 700;
  }

  // 5. Popular Ecosystem Libraries (Lombok, Jackson, SLF4J, JUnit 5)
  if (fqn.startsWith('lombok.') || fqn.startsWith('org.slf4j.') || fqn.startsWith('com.fasterxml.jackson.')) {
    score += 650;
  } else if (fqn.startsWith('org.junit.jupiter.') || fqn.startsWith('org.mockito.')) {
    score += 650;
  }

  // 6. Deprioritize obscure or internal third-party packages
  if (fqn.startsWith('com.sun.') || fqn.startsWith('sun.') || fqn.startsWith('jdk.internal.')) {
    score -= 800;
  }
  if (fqn.includes('.internal.') || fqn.includes('.impl.')) {
    score -= 200;
  }

  return score;
}

function rankCandidates(simpleName, projectIndex = null, currentPackage = '') {
  const candidatesMap = new Map();

  // 1. Dicionario Canonico Spring Boot
  const springMatches = SPRING_BOOT_CANONICAL_TYPES.get(simpleName);
  if (springMatches) {
    for (const fqn of springMatches) {
      const score = calculatePriorityScore(fqn, simpleName, currentPackage) + 100;
      candidatesMap.set(fqn, {
        fqn,
        label: fqn,
        package: fqn.substring(0, fqn.lastIndexOf('.')),
        score,
        source: 'spring-dict',
      });
    }
  }

  // 2. Dicionario Canonico JKD
  const jdkMatches = JDK_CANONICAL_TYPES.get(simpleName);
  if (jdkMatches) {
    for (const fqn of jdkMatches) {
      if (!candidatesMap.has(fqn)) {
        const score = calculatePriorityScore(fqn, simpleName, currentPackage) + 50;
        candidatesMap.set(fqn, {
          fqn,
          label: fqn,
          package: fqn.substring(0, fqn.lastIndexOf('.')),
          score,
          source: 'jdk-dict',
        });
      }
    }
  }

  // 3. Mapa Classico JDK Constants
  const jdkConstant = JDK_FQN_MAP.get(simpleName);
  if (jdkConstant && !candidatesMap.has(jdkConstant)) {
    candidatesMap.set(jdkConstant, {
      fqn: jdkConstant,
      label: jdkConstant,
      package: jdkConstant.substring(0, jdkConstant.lastIndexOf('.')),
      score: calculatePriorityScore(jdkConstant, simpleName, currentPackage) + 50,
      source: 'jdk-const',
    });
  }

  // 4. Indice do Projeto (classes locais e dependencias JAR)
  if (projectIndex && projectIndex.simpleNameIndex) {
    const indexed = projectIndex.simpleNameIndex.get(simpleName);
    if (indexed) {
      for (const fqn of indexed) {
        if (!candidatesMap.has(fqn)) {
          const score = calculatePriorityScore(fqn, simpleName, currentPackage);
          candidatesMap.set(fqn, {
            fqn,
            label: fqn,
            package: fqn.substring(0, fqn.lastIndexOf('.')),
            score,
            source: 'project-index',
          });
        }
      }
    }
  }

  const sorted = Array.from(candidatesMap.values()).sort((a, b) => b.score - a.score);

  if (sorted.length > 0) {
    sorted[0].isRecommended = true;
  }

  return sorted;
}

module.exports = {
  calculatePriorityScore,
  rankCandidates,
};