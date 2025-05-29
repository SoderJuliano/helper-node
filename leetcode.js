// TESTE LEETCODE PARA PLENO JAVASCRIPT MAP
// Descrição:
// Implemente uma classe LRUCache com os seguintes métodos:

// constructor(capacity) – inicializa o cache com capacidade máxima.

// get(key) – retorna o valor da chave se existir no cache, senão retorna -1.

// put(key, value) – insere ou atualiza o valor da chave. Quando o cache atinge sua capacidade, remove o item menos recentemente usado.

class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
    this.timestamp = new Map();
  }

  get(key) {
    return this.cache.has(key) ? this.cache.get(key) : -1;
  }

  put(key, value) {
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      this.timestamp.delete(key);
    } else {
      if (this.cache.size >= this.capacity) {
        const oldest = Array.from(this.timestamp.keys())[0];
        this.cache.delete(oldest);
        this.timestamp.delete(oldest);
      }
      this.cache.set(key, value);
      this.timestamp.set(key, new Date().getTime());
    }
  }
}
const cache = new LRUCache(2);

cache.put(1, 1);
cache.put(2, 2);
console.log(cache.get(1)); // retorna 1

cache.put(3, 3); // remove chave 2
console.log(cache.get(2)); // retorna -1 (não encontrado)

cache.put(4, 4); // remove chave 1
console.log(cache.get(1)); // retorna -1
console.log(cache.get(3)); // retorna 3
console.log(cache.get(4)); // retorna 4

// Restrições:
// Todos os get e put devem ter complexidade O(1).

// Você pode usar Map, Set, ou outras estruturas.

