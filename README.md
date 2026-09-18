# Internet Screen Share

Aplicativo Windows de compartilhamento de tela pela internet usando Electron, WebRTC, WebSocket, STUN e TURN. O transmissor nunca solicita captura de microfone.

## Requisitos

- Windows 10/11
- Node.js 22+
- Um servidor publico com HTTPS/WSS para o backend
- Coturn ou outro servico TURN para redes restritivas

## Desenvolvimento

```powershell
npm install
npm run dev
```

O servidor local e usado somente para desenvolvimento. Ele nao e a arquitetura final de internet.

## Configuracao publica

Copie `.env.example` para `.env` no servidor:

```env
PUBLIC_URL=https://stream.seudominio.com
PORT=8080
TURN_URLS=turn:turn.seudominio.com:3478,turns:turn.seudominio.com:5349
TURN_USERNAME=usuario-turn
TURN_CREDENTIAL=credencial-turn
NODE_ENV=production
```

`TURN_URLS` aceita varios enderecos separados por virgula usando a mesma credencial. A
variavel antiga `TURN_URL` continua sendo lida. `STUN_URLS` e opcional; sem ela o
servidor usa os STUN publicos do Google.

Coloque o proxy HTTPS na frente do Node (por exemplo, Render, Railway, Fly.io, Caddy ou Nginx). O WebSocket deve ser encaminhado como WSS. O Electron usa `PUBLIC_URL` no ambiente em que for iniciado; para uma distribuicao, defina essa variavel antes de abrir o app.

## TURN com Coturn

Use credenciais temporarias em producao, geradas por um pequeno endpoint autenticado ou por um provedor TURN gerenciado. As variaveis acima sao lidas apenas pelo servidor e retornadas na negociacao ICE; nao inclua segredos no codigo fonte do cliente. Um exemplo minimo de Coturn:

```text
listening-port=3478
fingerprint
lt-cred-mech
realm=stream.seudominio.com
use-auth-secret
static-auth-secret=troque-este-segredo
no-loopback-peers
no-multicast-peers
```

Para um primeiro deploy, `TURN_USERNAME` e `TURN_CREDENTIAL` podem ser credenciais de curta duracao criadas pelo operador. Configure tambem TLS em `turns:...:5349` quando disponivel.

## Deploy

- `Dockerfile` inicia o servidor em `PORT`.
- `render.yaml` fornece uma base para Render.
- Railway e Fly.io podem usar o mesmo Dockerfile.
- Configure DNS `stream.seudominio.com` apontando para o servico e ative HTTPS automatico.

### Checklist do Render

As variaveis marcadas como `sync: false` no `render.yaml` **nao vem preenchidas**: elas
precisam ser digitadas em Environment no painel do servico. Confira o que esta valendo em
`/api/config` — se a resposta trouxer `"relay": false`, o TURN nao esta configurado e o
servidor tambem registra um aviso no log ao subir.

O plano `free` hiberna o servico depois de cerca de 15 minutos sem trafego, e todo
restart (hibernacao ou deploy) **apaga as salas**, porque elas so existem em memoria. O
app do transmissor detecta isso, cria uma sala nova automaticamente e mostra o codigo
novo, mas o link antigo deixa de funcionar e precisa ser reenviado. Para transmissao
continua, use um plano que nao hiberne.

## Fluxo

1. Abra o Electron.
2. Selecione monitor ou janela.
3. Escolha 720p30, 1080p30 ou 1080p60.
4. Selecione audio completo, audio da fonte selecionada ou sem audio.
5. Crie a sala e inicie a transmissao.
6. Envie o codigo ou `https://stream.seudominio.com/watch/ABC123`.

A opcao de audio por aplicativo depende do suporte de captura do Windows/Electron para a fonte selecionada. O app nao pede permissao nem abre stream de microfone. Conteudo protegido pode aparecer preto por decisao do sistema ou do provedor.

## Build do instalador

```powershell
npm run build
npm run package:win
```

O instalador NSIS `.exe` sera criado em `dist/`.

## Seguranca operacional

Salas sao mantidas somente em memoria, o host encerra a sala ao desconectar, codigos sao aleatorios, mensagens WebSocket sao validadas e tentativas de codigo sao limitadas por IP. Para producao, use HTTPS/WSS, limite de conexoes no proxy e TURN com credenciais rotativas.
