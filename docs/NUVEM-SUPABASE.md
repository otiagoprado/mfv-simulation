# Projetos na nuvem: configurar o servidor (Supabase)

O simulador guarda os projetos de cada cliente em um banco **Supabase** (Postgres + API + login por e-mail),
no plano gratuito, acessado direto pelo navegador. Depois de configurado, o menu **Ferramentas do projeto →
Projetos na nuvem** permite salvar o projeto aberto com um nome, buscar pelo nome ou cliente, abrir em
qualquer computador e manter o salvamento automático.

A configuração é feita uma única vez, em cerca de 10 minutos.

## 1. Criar o projeto no Supabase

1. Acesse <https://supabase.com>, crie a conta (pode ser com o GitHub) e clique em **New project**.
2. Nome sugerido: `mfv-simulation`. Escolha a região **South America (São Paulo)** e guarde a senha do banco.
3. Aguarde o projeto ficar pronto (1 a 2 minutos).

## 2. Criar a tabela e as permissões

No menu lateral, abra **SQL Editor → New query**, cole o SQL abaixo e clique em **Run**.

```sql
create table public.mfv_projects (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  client     text not null default '',
  workspace  jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mfv_projects_owner_updated on public.mfv_projects (owner, updated_at desc);

-- Cada usuário só vê e altera os próprios projetos.
alter table public.mfv_projects enable row level security;

create policy "dono lê"     on public.mfv_projects for select to authenticated using (owner = auth.uid());
create policy "dono cria"   on public.mfv_projects for insert to authenticated with check (owner = auth.uid());
create policy "dono altera" on public.mfv_projects for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "dono apaga"  on public.mfv_projects for delete to authenticated using (owner = auth.uid());
```

Para uma **equipe** compartilhar os mesmos projetos, troque as quatro políticas por uma só que libere todos os
usuários autenticados (`using (true) with check (true)`), e desligue o cadastro livre no passo 3.

## 3. Configurar o login por e-mail

1. **Authentication → URL Configuration**:
   - *Site URL*: `https://otiagoprado.github.io/mfv-simulation/`
   - *Redirect URLs*: adicione a mesma URL (e `http://localhost:5173/` se for usar em desenvolvimento).
2. **Authentication → Providers → Email**: deixe *Enable email provider* ligado. *Confirm email* pode ficar ligado.
3. (Opcional, recomendado) **Authentication → Email Templates → Magic Link**: inclua no texto a linha
   `Seu código: {{ .Token }}`. Assim o e-mail traz também um código de 6 dígitos, que pode ser digitado no
   simulador quando o link não abrir no navegador certo.
4. (Opcional) Depois de entrar pela primeira vez, em **Authentication → Sign In / Providers** desligue
   *Allow new users to sign up* para que só os e-mails já cadastrados consigam entrar. Novos usuários podem ser
   criados em **Authentication → Users → Add user**.

O plano gratuito envia poucos e-mails por hora pelo remetente padrão. Se precisar de mais, configure um SMTP
próprio em **Project Settings → Authentication → SMTP Settings**.

## 4. Copiar a URL e a chave

Em **Project Settings → API**:

- **Project URL**: algo como `https://abcdefghijkl.supabase.co`
- **anon public** key: começa com `eyJ…`

A chave *anon* é pública por desenho: ela só dá acesso ao que as políticas da tabela permitem, e cada
operação exige o usuário logado.

## 5. Informar ao simulador

Duas formas, à escolha:

**a) Na própria tela (sem rebuild).** Abra **Ferramentas do projeto → Projetos na nuvem**, cole a URL e a chave,
clique em **Salvar servidor**. Fica gravado naquele navegador. Repita em cada computador.

**b) No build (vale para todos os usuários do site).** No GitHub, em **Settings → Secrets and variables →
Actions → Variables**, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` e acrescente ao job de build em
`.github/workflows/pages.yml`:

```yaml
      - run: pnpm exec vite build --base=/${{ github.event.repository.name }}/
        env:
          VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}
```

## 6. Usar

1. **Projetos na nuvem → Enviar link**: digite o e-mail, abra o link recebido (ou digite o código).
2. Com o mapa do cliente aberto, **Salvar na nuvem** e dê um nome, por exemplo `Padaria Central – pães`, e o cliente.
3. A partir daí, cada alteração é enviada ao servidor alguns segundos depois (indicador "Salvo na nuvem").
4. Para trocar de cliente, busque pelo nome e clique em **Abrir**. O projeto anterior continua salvo no servidor.
5. **Salvar como novo** cria uma cópia (útil para versões "antes e depois" do mesmo cliente).
6. **Desvincular** para o projeto aberto deixar de ser salvo automaticamente; **Abrir projeto (.json)** também desvincula.

O arquivo `.json` continua funcionando como backup local e para enviar um projeto a outra pessoa.

## Como funciona por dentro

- `src/cloud-projects.ts`: cliente REST do Supabase (sem dependências): login por link mágico / código,
  renovação da sessão, busca (`ilike` em nome e cliente), carregar, criar, atualizar, excluir.
- `src/CloudProjects.tsx`: a janela "Projetos na nuvem".
- `src/App.tsx`: estado do projeto vinculado (`mfv-cloud-link:v1` no navegador) e salvamento automático
  2,5 s após a última alteração. Ao abrir um projeto da nuvem, o estado local é substituído (desfazer disponível).
- Cada linha da tabela guarda o workspace completo (estado atual, cenários futuros, imagens em base64).
