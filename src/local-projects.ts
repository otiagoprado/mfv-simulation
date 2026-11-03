/**
 * Projetos guardados no próprio navegador (IndexedDB): vários clientes, cada um com nome e cliente,
 * buscáveis pelo nome. Mesma interface do cliente de nuvem, para a tela de projetos servir aos dois.
 */
import type { CloudProjectRecord, CloudProjectSummary } from './cloud-projects';

export interface ProjectStore {
  search(term: string, limit?: number): Promise<CloudProjectSummary[]>;
  load<T>(id: string): Promise<CloudProjectRecord<T>>;
  create(name: string, client: string, workspace: unknown): Promise<CloudProjectSummary>;
  update(id: string, patch: { name?: string; client?: string; workspace?: unknown }): Promise<CloudProjectSummary>;
  remove(id: string): Promise<void>;
}

const DB_NAME = 'mfv-projects';
const STORE = 'projects';

interface StoredProject {
  id: string;
  name: string;
  client: string;
  workspace: unknown;
  createdAt: string;
  updatedAt: string;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Este navegador não permite guardar projetos.')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento de projetos.'));
    request.onblocked = () => reject(new Error('O armazenamento está em uso em outra aba. Feche as outras abas do simulador.'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao acessar o armazenamento de projetos.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => Promise<T>) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const result = await action(store);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao gravar o projeto.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Gravação cancelada: o armazenamento pode estar cheio.'));
    });
    return result;
  } finally {
    db.close();
  }
}

function summary(project: StoredProject): CloudProjectSummary {
  return { id: project.id, name: project.name, client: project.client, updatedAt: project.updatedAt };
}

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export class LocalProjectStore implements ProjectStore {
  async search(term: string, limit = 60): Promise<CloudProjectSummary[]> {
    const all = await withStore('readonly', (store) => requestToPromise(store.getAll() as IDBRequest<StoredProject[]>));
    const words = normalize(term).split(/\s+/).filter(Boolean);
    return all
      .filter((project) => words.every((word) => normalize(`${project.name} ${project.client}`).includes(word)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(summary);
  }

  async load<T>(id: string): Promise<CloudProjectRecord<T>> {
    const project = await withStore('readonly', (store) => requestToPromise(store.get(id) as IDBRequest<StoredProject | undefined>));
    if (!project) throw new Error('Projeto não encontrado. Ele pode ter sido excluído.');
    return { ...summary(project), workspace: project.workspace as T };
  }

  async create(name: string, client: string, workspace: unknown): Promise<CloudProjectSummary> {
    const now = new Date().toISOString();
    const project: StoredProject = { id: newId(), name: name.trim(), client: client.trim(), workspace: structuredCloneSafe(workspace), createdAt: now, updatedAt: now };
    await withStore('readwrite', (store) => requestToPromise(store.add(project)));
    return summary(project);
  }

  async update(id: string, patch: { name?: string; client?: string; workspace?: unknown }): Promise<CloudProjectSummary> {
    return withStore('readwrite', async (store) => {
      const current = await requestToPromise(store.get(id) as IDBRequest<StoredProject | undefined>);
      if (!current) throw new Error('Projeto não encontrado. Ele pode ter sido excluído.');
      const next: StoredProject = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        client: patch.client !== undefined ? patch.client.trim() : current.client,
        workspace: patch.workspace !== undefined ? structuredCloneSafe(patch.workspace) : current.workspace,
        updatedAt: new Date().toISOString(),
      };
      await requestToPromise(store.put(next));
      return summary(next);
    });
  }

  async remove(id: string) {
    await withStore('readwrite', (store) => requestToPromise(store.delete(id)));
  }
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
