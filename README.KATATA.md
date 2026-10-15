# Katata Draw

Fork pessoal do Excalidraw com login por e-mail e senha, quadros privados e salvamento automático em PostgreSQL. Aplicação e banco rodam no seu servidor. Não exige Google Cloud, Firebase, Jira ou um provedor externo de autenticação. O editor continua usando o código deste fork em `packages/excalidraw`.

## O que está incluído

- Login, logout, senha com hash pelo Better Auth e sessão em cookie HttpOnly.
- Cadastro público bloqueado. Contas são criadas por um comando administrativo.
- Alteração de senha dentro de **Minha conta**, revogando as outras sessões.
- Lista de quadros com busca, criação, renomeação e exclusão com confirmação.
- Desenhos, configurações da tela e imagens gravados em JSONB no PostgreSQL.
- Salvamento automático com indicador, tentativa manual após falha e alerta ao fechar uma aba com alterações pendentes.
- Controle otimista de versão: duas abas não sobrescrevem silenciosamente o mesmo quadro. Em conflito, exporte uma cópia antes de reabrir a versão salva.
- Importação e exportação de arquivos `.excalidraw` pelo editor.

Não há colaboração em tempo real nem compartilhamento entre contas nesta versão. As miniaturas na lista são ilustrações, não previews do conteúdo. O salvamento tem limite de 25 MB por requisição. Uma alteração ainda pendente não está protegida contra encerramento abrupto do navegador ou do computador. Não há envio de e-mail nem recuperação de senha por e-mail nesta versão.

## Desenvolvimento

Use Node 24 e Yarn 1.22.22.

```sh
yarn install --frozen-lockfile
cp katata-server/.env.example katata-server/.env
```

Configure `DATABASE_URL` para um PostgreSQL local e substitua `BETTER_AUTH_SECRET` por pelo menos 32 caracteres aleatórios. Não versione o arquivo `.env`. Inicie o backend e o frontend em terminais separados:

```sh
yarn katata:dev
```

```sh
VITE_APP_KATATA=true yarn --cwd excalidraw-app start
```

Abra `http://localhost:3000`. O Vite encaminha `/api` para a porta 3001. As tabelas são criadas na inicialização, com lock de migração no PostgreSQL. O servidor aguarda o banco aceitar conexões antes de migrar e atender requisições. Crie a primeira conta no terminal; a senha é solicitada sem exibir o que foi digitado:

```sh
cd katata-server
node --env-file=.env src/create-user.mjs
```

## Docker e Coolify

O `Dockerfile.katata` gera o frontend e um servidor Node que entrega o site e a API na porta 3001. O processo roda como usuário sem privilégios. O compose mantém o PostgreSQL em rede interna, sem publicar sua porta.

Defina no Coolify ou no ambiente do compose:

- `APP_URL=https://draw.katata.click`
- `BETTER_AUTH_SECRET`: segredo aleatório com pelo menos 32 caracteres.
- `POSTGRES_PASSWORD`: senha aleatória em caracteres seguros para URL, por exemplo o resultado de `openssl rand -hex 32`.

```sh
docker compose -f docker-compose.katata.yml up -d --build
docker compose -f docker-compose.katata.yml exec draw node katata-server/src/create-user.mjs
```

No Coolify, configure o domínio HTTPS no container `draw`, com destino à porta 3001. O servidor usa cookies Secure em produção, valida a origem das alterações e limita tentativas de login. Não publique a porta 3001 diretamente fora do proxy. O healthcheck `/api/health` valida a conexão com o PostgreSQL.

O cadastro por comando usa a API interna do Better Auth. O endpoint público `/api/auth/sign-up/email` permanece bloqueado. Execute o comando novamente para cada conta adicional. O e-mail funciona como identificador local: não exige uma conta Google nem serviço de e-mail.

Não substitua a instalação original antes de testar a nova imagem. Desenhos salvos apenas no navegador da instalação anterior não são migrados automaticamente: exporte-os como `.excalidraw`, crie um quadro na nova versão e importe o arquivo pelo menu do editor.

## Backup

O volume `katata_draw_postgres` contém contas, sessões, quadros e imagens. Guarde também os segredos de configuração fora do repositório. Não remova o volume ao recriar containers.

```sh
docker compose -f docker-compose.katata.yml exec -T postgres \
  pg_dump -U katata -d katata_draw -Fc > katata-draw.dump
```

Guarde os dumps em armazenamento privado e valide uma restauração em um banco separado antes de depender do backup. Backup recorrente deve ser configurado no ambiente de hospedagem; o compose não instala um agendador.

## Verificação

Use um banco dedicado para os testes, nunca o banco de produção:

```sh
TEST_DATABASE_URL=postgresql://localhost/katata_draw_test yarn katata:test
yarn vitest run excalidraw-app/katata/autosave.test.ts
yarn tsc --pretty false
yarn katata:build
docker build -f Dockerfile.katata -t katata-draw:local .
```

Os testes da API usam um PostgreSQL real para conferir autenticação, isolamento entre contas, persistência de imagens, conflitos de versão, validação de origem, cadastro bloqueado e revogação de sessão. Os testes de autosave verificam serialização de requisições, falha de rede e conflito entre abas.

Para o aplicativo original, `yarn start` e `yarn build` continuam disponíveis. O modo Katata é selecionado pela flag de build `VITE_APP_KATATA=true`.
