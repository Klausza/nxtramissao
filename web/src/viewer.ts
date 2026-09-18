type Message = { type: string; [key: string]: any };
const form = document.querySelector<HTMLFormElement>('#join')!;
const codeInput = document.querySelector<HTMLInputElement>('#code')!;
const message = document.querySelector<HTMLElement>('#message')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const video = document.querySelector<HTMLVideoElement>('#video')!;
const state = document.querySelector<HTMLElement>('#state')!;
let socket: WebSocket | undefined;
let peer: RTCPeerConnection | undefined;
let salaAtual = '';
let jaConectou = false;
let tentarDeNovo: ReturnType<typeof setTimeout> | undefined;
const codeFromPath = location.pathname.match(/\/watch\/([A-Z2-9]{6})/i)?.[1];
if (codeFromPath) codeInput.value = codeFromPath.toUpperCase();
function show(text: string) { message.textContent = text; }
function hasRelay(servers: RTCIceServer[]) { return (servers || []).some((server) => [server.urls].flat().some((url) => /^turns?:/i.test(String(url)))); }
function failureText(relay: boolean) { return relay ? 'Falha de conexão. Tentando restabelecer...' : 'Falha de conexão. O servidor está sem TURN, e redes móveis ou corporativas costumam precisar dele.'; }
function send(data: Message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }

/* O codigo da sala e estavel, entao insistir vale a pena: se o servidor reiniciar ou o
   transmissor cair, a mesma sala volta e o espectador reconecta sozinho. */
function agendarRetry(motivo: string) {
  // Codigo que nunca chegou a existir e provavelmente erro de digitacao: nao fica em loop.
  if (!salaAtual || !jaConectou) return;
  state.textContent = motivo;
  clearTimeout(tentarDeNovo);
  tentarDeNovo = setTimeout(() => conectar(salaAtual), 3000);
}

function conectar(code: string) {
  salaAtual = code;
  clearTimeout(tentarDeNovo);
  peer?.close();
  peer = undefined;
  if (socket) { socket.onclose = null; try { socket.close(); } catch {} }
  stage.classList.remove('hidden');
  state.textContent = 'Conectando ao servidor...';
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  socket = new WebSocket(wsUrl);
  socket.onopen = () => send({ type: 'join-room', code });
  socket.onclose = () => agendarRetry('Servidor desconectado. Tentando de novo...');
  socket.onerror = () => {};
  socket.onmessage = async (event) => handle(JSON.parse(event.data));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = codeInput.value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) return show('Digite um código de 6 caracteres.');
  show('');
  conectar(code);
});

async function handle(msg: Message) {
  if (msg.type === 'error') {
    show(msg.message);
    // Sala ainda nao existe ou acabou de cair junto com o servidor: continua tentando.
    return agendarRetry('Sala indisponível. Tentando de novo...');
  }
  if (msg.type === 'joined') {
    show('');
    jaConectou = true;
    const relay = hasRelay(msg.iceServers);
    peer = new RTCPeerConnection({ iceServers: msg.iceServers });
    peer.onicecandidate = (event) => event.candidate && send({ type: 'ice', candidate: event.candidate });
    peer.ontrack = (event) => { video.srcObject = event.streams[0]; state.textContent = 'Transmitindo'; };
    peer.onconnectionstatechange = () => { if (peer?.connectionState === 'failed') state.textContent = failureText(relay); };
    state.textContent = 'Aguardando a transmissão...';
    return;
  }
  if (msg.type === 'offer' && peer) {
    await peer.setRemoteDescription(msg.description);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    send({ type: 'answer', description: peer.localDescription });
  }
  if (msg.type === 'ice' && peer && msg.candidate) await peer.addIceCandidate(msg.candidate).catch(() => {});
  // Depois que o transmissor volta os peers antigos estao mortos do lado dele; so um
  // join novo faz ele criar a conexao de novo para este espectador.
  if (msg.type === 'host-online') { state.textContent = 'Transmissor voltou. Reconectando...'; clearTimeout(tentarDeNovo); tentarDeNovo = setTimeout(() => conectar(salaAtual), 500); }
  if (msg.type === 'host-offline') { video.srcObject = null; agendarRetry('Transmissor caiu. Tentando de novo...'); }
  if (msg.type === 'host-stopped') { video.srcObject = null; state.textContent = 'Transmissão encerrada pelo transmissor'; }
}

if (codeFromPath) conectar(codeFromPath.toUpperCase());
