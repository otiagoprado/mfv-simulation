import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, CloudOff, FolderOpen, Loader2, LogOut, Plus, Save, Search, Settings2, Trash2, X } from 'lucide-react';
import { CloudClient, type CloudConfig, type CloudProjectSummary } from './cloud-projects';
import type { ProjectStore } from './local-projects';

export interface CloudLink {
  id: string;
  name: string;
  client: string;
  /** Onde o projeto vinculado está guardado. */
  mode: 'local' | 'cloud';
}

export type CloudSaveState = 'idle' | 'saving' | 'saved' | 'error';

interface CloudProjectsModalProps {
  /** Onde os projetos estão: no navegador (padrão) ou no servidor, quando configurado e conectado. */
  mode: 'local' | 'cloud';
  store: ProjectStore;
  config: CloudConfig | null;
  client: CloudClient | null;
  signedIn: boolean;
  email: string;
  link: CloudLink | null;
  saveState: CloudSaveState;
  saveError: string;
  onConfigChange: (config: CloudConfig | null) => void;
  onOpen: (id: string) => Promise<void>;
  onSaveAsNew: (name: string, client: string) => Promise<void>;
  onSaveCurrent: () => Promise<void>;
  onRename: (name: string, client: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUnlink: () => void;
  onClose: () => void;
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function CloudProjectsModal(props: CloudProjectsModalProps) {
  const { mode, store, config, client, signedIn, email, link, saveState, saveError, onClose } = props;
  const [configuring, setConfiguring] = useState(false);
  const [urlInput, setUrlInput] = useState(config?.url ?? '');
  const [keyInput, setKeyInput] = useState(config?.anonKey ?? '');
  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<CloudProjectSummary[] | null>(null);
  const [newName, setNewName] = useState(link?.name ?? '');
  const [newClient, setNewClient] = useState(link?.client ?? '');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CloudProjectSummary | null>(null);
  const searchTimer = useRef<number | null>(null);

  const run = async (action: () => Promise<void>, successNotice = '') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (successNotice) setNotice(successNotice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Operação não concluída.');
    } finally {
      setBusy(false);
    }
  };

  const refresh = (search: string) => {
    void run(async () => { setResults(await store.search(search)); });
  };

  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => refresh(term), results === null ? 0 : 350);
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, store]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveConfig = () => {
    const url = urlInput.trim().replace(/\/+$/, '');
    if (!/^https:\/\/.+/.test(url) || keyInput.trim().length < 20) {
      setError('Informe a URL do projeto Supabase (https://xxxx.supabase.co) e a chave anon.');
      return;
    }
    props.onConfigChange({ url, anonKey: keyInput.trim() });
    setConfiguring(false);
    setError('');
    setNotice('Servidor configurado. Agora entre com seu e-mail.');
  };

  const sendLink = () => {
    if (!client) return;
    const address = emailInput.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) { setError('Digite um e-mail válido.'); return; }
    void run(async () => { await client.requestMagicLink(address); setLinkSent(true); },
      'E-mail enviado. Abra o link no e-mail (ou digite o código abaixo) para entrar.');
  };

  const verify = () => {
    if (!client) return;
    void run(async () => { await client.verifyCode(emailInput.trim(), codeInput); setCodeInput(''); setLinkSent(false); }, 'Você entrou.');
  };

  const createProject = () => {
    const name = newName.trim();
    if (!name) { setError('Dê um nome ao projeto, por exemplo o nome do cliente e da linha.'); return; }
    void run(async () => { await props.onSaveAsNew(name, newClient.trim()); setCreating(false); refresh(term); }, `Projeto “${name}” guardado.`);
  };

  const renameProject = () => {
    const name = newName.trim();
    if (!name) { setError('O nome não pode ficar vazio.'); return; }
    void run(async () => { await props.onRename(name, newClient.trim()); setRenaming(false); refresh(term); }, 'Nome atualizado.');
  };

  const openProject = (item: CloudProjectSummary) => {
    void run(async () => { await props.onOpen(item.id); }, `Projeto “${item.name}” aberto.`);
  };

  const deleteProject = (item: CloudProjectSummary) => {
    void run(async () => { await props.onDelete(item.id); setPendingDelete(null); refresh(term); }, `Projeto “${item.name}” excluído.`);
  };

  const where = mode === 'cloud' ? 'no servidor' : 'neste navegador';
  const stateLabel = saveState === 'saving' ? `Salvando ${where}…` : saveState === 'saved' ? `Salvo ${where}` : saveState === 'error' ? `Não salvo: ${saveError}` : 'Salvamento automático ligado';
  const saveLabel = mode === 'cloud' ? 'Salvar na nuvem' : 'Guardar projeto';

  return createPortal(
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-labelledby="cloud-title">
      <button className="editor-backdrop" onClick={onClose} aria-label="Fechar meus projetos" />
      <section className="editor-window cloud-modal">
        <header>
          <div><h2 id="cloud-title">Meus projetos</h2><p>{mode === 'cloud'
            ? 'Cada cliente guardado no servidor; reabra em qualquer computador buscando pelo nome.'
            : 'Guarde um projeto por cliente neste navegador e reabra buscando pelo nome. Para levar a outro computador, use Salvar projeto (.json).'}</p></div>
          <div className="cloud-header-actions">
            <button className="quiet-button" onClick={() => { setConfiguring((value) => !value); setError(''); }} title="Servidor (opcional)"><Settings2 size={15}/></button>
            <button className="icon-button" onClick={onClose}><X size={20}/></button>
          </div>
        </header>

        {configuring && <div className="cloud-section cloud-config">
          <h3><Settings2 size={15}/> Servidor (opcional)</h3>
          <p>Sem servidor, os projetos ficam neste navegador. Para compartilhar entre computadores, crie um banco Supabase gratuito seguindo <code>docs/NUVEM-SUPABASE.md</code> e cole aqui a URL e a chave <em>anon</em>.</p>
          <label>URL do projeto<input value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="https://xxxxxxxx.supabase.co" spellCheck={false} /></label>
          <label>Chave anon (pública)<input value={keyInput} onChange={(event) => setKeyInput(event.target.value)} placeholder="eyJhbGciOi…" spellCheck={false} /></label>
          <div className="cloud-actions">
            {config && <button className="quiet-button" onClick={() => { props.onConfigChange(null); setUrlInput(''); setKeyInput(''); setNotice('Configuração removida.'); }}>Remover</button>}
            {config && <button className="quiet-button" onClick={() => setConfiguring(false)}>Cancelar</button>}
            <button className="primary-button" onClick={saveConfig}>Salvar servidor</button>
          </div>
        </div>}

        {config && !configuring && !signedIn && client && <div className="cloud-section cloud-login">
          <h3><Cloud size={15}/> Entrar no servidor</h3>
          <p>Digite seu e-mail. Você recebe um link de acesso; ao clicar, volta para o simulador já conectado. Se o e-mail trouxer um código de 6 dígitos, pode digitá-lo aqui.</p>
          <div className="cloud-inline">
            <input type="email" value={emailInput} onChange={(event) => setEmailInput(event.target.value)} placeholder="seu@email.com" onKeyDown={(event) => { if (event.key === 'Enter') sendLink(); }} />
            <button className="primary-button" onClick={sendLink} disabled={busy}>{busy ? <Loader2 size={15} className="spin"/> : null}{linkSent ? 'Reenviar link' : 'Enviar link'}</button>
          </div>
          {linkSent && <div className="cloud-inline">
            <input inputMode="numeric" value={codeInput} onChange={(event) => setCodeInput(event.target.value)} placeholder="Código de 6 dígitos (opcional)" onKeyDown={(event) => { if (event.key === 'Enter') verify(); }} />
            <button className="quiet-button" onClick={verify} disabled={busy || codeInput.trim().length < 6}>Entrar com o código</button>
          </div>}
        </div>}

        {!configuring && <>
          <div className="cloud-current">
            <div className="cloud-current-copy">
              {link ? <>
                <span>Projeto aberto</span>
                <strong>{link.name}</strong>
                <small>{link.client ? `${link.client} · ` : ''}<i className={`cloud-dot ${saveState}`}/>{stateLabel}</small>
              </> : <>
                <span>Projeto aberto</span>
                <strong>Ainda não guardado</strong>
                <small>Guarde com um nome para reabrir depois e trabalhar com vários clientes.</small>
              </>}
            </div>
            <div className="cloud-current-actions">
              {link && <button className="quiet-button" onClick={() => void run(props.onSaveCurrent, 'Projeto salvo.')} disabled={busy} title="Enviar agora as alterações"><Save size={15}/>Salvar agora</button>}
              {link && <button className="quiet-button" onClick={() => { setRenaming(true); setCreating(false); setNewName(link.name); setNewClient(link.client); }} disabled={busy}>Renomear</button>}
              {link && <button className="quiet-button" onClick={props.onUnlink} disabled={busy} title="Deixa de salvar automaticamente neste projeto"><CloudOff size={15}/>Desvincular</button>}
              <button className="primary-button" onClick={() => { setCreating(true); setRenaming(false); setNewName(link ? `${link.name} (cópia)` : ''); setNewClient(link?.client ?? ''); }} disabled={busy}><Plus size={15}/>{link ? 'Salvar como novo' : saveLabel}</button>
            </div>
          </div>

          {(creating || renaming) && <div className="cloud-section cloud-form">
            <h3>{renaming ? 'Renomear projeto' : 'Guardar como novo projeto'}</h3>
            <div className="cloud-form-grid">
              <label>Nome do projeto<input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Ex.: Padaria Central – linha de pães" onKeyDown={(event) => { if (event.key === 'Enter') (renaming ? renameProject : createProject)(); }} /></label>
              <label>Cliente (opcional)<input value={newClient} onChange={(event) => setNewClient(event.target.value)} placeholder="Ex.: Padaria Central" onKeyDown={(event) => { if (event.key === 'Enter') (renaming ? renameProject : createProject)(); }} /></label>
            </div>
            <div className="cloud-actions">
              <button className="quiet-button" onClick={() => { setCreating(false); setRenaming(false); }}>Cancelar</button>
              <button className="primary-button" onClick={renaming ? renameProject : createProject} disabled={busy}>{busy ? <Loader2 size={15} className="spin"/> : null}{renaming ? 'Salvar nome' : saveLabel}</button>
            </div>
          </div>}

          <div className="cloud-search">
            <Search size={16}/>
            <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Buscar por nome do projeto ou cliente…" autoFocus={!creating && !renaming} />
            {busy && <Loader2 size={16} className="spin"/>}
          </div>

          <div className="cloud-list">
            {results === null && <p className="cloud-empty">Carregando…</p>}
            {results !== null && results.length === 0 && <p className="cloud-empty">{term ? 'Nenhum projeto com esse nome.' : 'Nenhum projeto salvo ainda. Use “Guardar projeto” para guardar o projeto aberto.'}</p>}
            {results?.map((item) => <div key={item.id} className={`cloud-item ${link?.id === item.id ? 'active' : ''}`}>
              <div className="cloud-item-copy">
                <strong>{item.name}</strong>
                <small>{item.client ? `${item.client} · ` : ''}atualizado em {formatDate(item.updatedAt)}{link?.id === item.id ? ' · aberto' : ''}</small>
              </div>
              {pendingDelete?.id === item.id ? <div className="cloud-item-actions">
                <span className="cloud-confirm">Excluir definitivamente?</span>
                <button className="quiet-button" onClick={() => setPendingDelete(null)}>Não</button>
                <button className="primary-button destructive" onClick={() => deleteProject(item)} disabled={busy}>Excluir</button>
              </div> : <div className="cloud-item-actions">
                <button className="quiet-button" onClick={() => setPendingDelete(item)} disabled={busy} title="Excluir do servidor"><Trash2 size={15}/></button>
                <button className="primary-button" onClick={() => openProject(item)} disabled={busy || link?.id === item.id}><FolderOpen size={15}/>Abrir</button>
              </div>}
            </div>)}
          </div>
        </>}

        {(error || notice) && <p className={`cloud-message ${error ? 'error' : ''}`}>{error || notice}</p>}

        <footer className="cloud-footer">
          {signedIn ? <>
            <span><Cloud size={14}/> Servidor conectado como <strong>{email || 'usuário'}</strong></span>
            <button className="quiet-button" onClick={() => void run(async () => { await client!.signOut(); })}><LogOut size={14}/>Sair</button>
          </> : <span><CloudOff size={14}/> Projetos guardados neste navegador{config ? ' · servidor configurado, entre para usá-lo' : ''}</span>}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
