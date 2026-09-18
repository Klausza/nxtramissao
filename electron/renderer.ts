type Source = { id: string; name: string; handle: number; thumbnail: string };
type AudioStart = { ok: boolean; pid?: number; message?: string };
type HostApi = { listSources: () => Promise<Source[]>; openExternal: (url: string) => Promise<void>; publicUrl: () => Promise<string>; roomSecret: () => Promise<string>; rotateRoomSecret: () => Promise<string>; startProcessAudio: (handle: number) => Promise<AudioStart>; stopProcessAudio: () => Promise<void>; onAudioChunk: (listener: (chunk: Uint8Array) => void) => () => void };
declare global { interface Window { screenShare: HostApi } }
export {};
type Quality = { width: number; height: number; frameRate: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const preview = $('preview') as HTMLVideoElement;
const sourceLabel = $('sourceLabel'); const picker = $('sourcePicker'); const sources = $('sources');
const message = $('message'); const roomCode = $('roomCode'); const connectionStatus = $('connectionStatus'); const viewerCount = $('viewerCount');
const audioStatus = $('audioStatus'); const screenStatus = $('screenStatus'); const startButton = $('start') as HTMLButtonElement; const stopButton = $('stop') as HTMLButtonElement;
let selected: Source | undefined; let stream: MediaStream | undefined; let socket: WebSocket; let publicUrl = ''; let code = ''; let roomToken = ''; let roomSecret = ''; let resuming = false; let recreated = false; let claimFailed = false; let reconnectTimer: ReturnType<typeof setTimeout> | undefined; let processAudioContext: AudioContext | undefined; let processAudioNode: AudioWorkletNode | undefined; let processAudioDestination: MediaStreamAudioDestinationNode | undefined; let removeAudioListener: (() => void) | undefined; const peers = new Map<string, RTCPeerConnection>();
const qualities: Record<string, Quality> = { '720p30': { width: 1280, height: 720, frameRate: 30 }, '1080p30': { width: 1920, height: 1080, frameRate: 30 }, '1080p60': { width: 1920, height: 1080, frameRate: 60 } };
queueMicrotask(() => syncAudioModeForSource());
function notify(text: string) { message.textContent = text; }

// Audio por janela depende do HWND, que so existe em fonte do tipo janela. Com uma tela
// inteira selecionada a opcao vira um beco sem saida: transmite video e nenhum som.
function syncAudioModeForSource() {
  const select = $('audioMode') as HTMLSelectElement;
  const appOption = select.querySelector<HTMLOptionElement>('option[value="app"]');
  if (!appOption) return;
  // So trava quando a fonte atual e comprovadamente uma tela. Sem nada selecionado a
  // opcao fica livre, senao ela nasce cinza e parece indisponivel.
  const isScreen = Boolean(selected) && !selected!.handle;
  appOption.disabled = isScreen;
  appOption.textContent = isScreen ? 'Áudio da janela selecionada (a fonte atual é uma tela)' : 'Áudio da janela selecionada';
  if (isScreen && select.value === 'app') {
    select.value = 'system';
    notify('Tela inteira não tem áudio por janela. Troquei para áudio do sistema; para o som só do Opera, selecione a janela dele.');
  }
}
function send(value: unknown) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
$('selectSource').addEventListener('click', async () => { sources.innerHTML = ''; for (const source of await window.screenShare.listSources()) { const button = document.createElement('button'); button.className = 'source'; button.innerHTML = `<img src="${source.thumbnail}" alt=""><span>${source.name}</span>`; button.onclick = async () => { selected = source; sourceLabel.textContent = source.name; picker.classList.add('hidden'); syncAudioModeForSource(); await refreshCapture(); }; sources.appendChild(button); } picker.classList.remove('hidden'); });
$('closePicker').addEventListener('click', () => picker.classList.add('hidden'));
$('netflix').addEventListener('click', () => window.screenShare.openExternal('https://www.netflix.com/'));
$('createRoom').addEventListener('click', async () => { if (!selected) return notify('Selecione uma tela ou janela antes de criar a sala.'); publicUrl = await window.screenShare.publicUrl(); roomSecret = await window.screenShare.roomSecret(); connectHost(false); });
$('start').addEventListener('click', async () => { if (!selected || !code) return; if (await refreshCapture()) { startButton.disabled = true; stopButton.disabled = false; send({ type: 'start' }); } });
$('quality').addEventListener('change', () => { void refreshCapture(); });
$('audioMode').addEventListener('change', () => { if (($('audioMode') as HTMLSelectElement).value === 'app' && !selected) { notify('Escolha a janela em "Selecionar tela" para o áudio dela entrar na transmissão.'); $('selectSource').click(); return; } void refreshCapture(); });
$('stop').addEventListener('click', () => { stream?.getTracks().forEach((track) => track.stop()); stream = undefined; preview.srcObject = null; peers.forEach((peer) => peer.close()); peers.clear(); send({ type: 'stop' }); screenStatus.textContent = 'PARADA'; audioStatus.textContent = 'DESATIVADO'; startButton.disabled = false; stopButton.disabled = true; });
$('copyCode').addEventListener('click', () => navigator.clipboard.writeText(code)); $('copyLink').addEventListener('click', () => navigator.clipboard.writeText(`${publicUrl}/watch/${code}`));
async function captureProcessAudio() { if (!selected) return undefined; if (!selected.handle) { notify('Tela inteira nao tem audio por aplicativo. Escolha a janela, ou troque para audio do sistema.'); return undefined; } const started = await window.screenShare.startProcessAudio(selected.handle); if (!started?.ok) { notify(started?.message || 'Nao consegui capturar o audio desta janela.'); return undefined; } processAudioContext?.close(); processAudioContext = new AudioContext({ sampleRate: 48000 }); await processAudioContext.audioWorklet.addModule('audio-worklet.js'); processAudioNode = new AudioWorkletNode(processAudioContext, 'pcm-worklet', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }); processAudioDestination = processAudioContext.createMediaStreamDestination(); processAudioNode.connect(processAudioDestination); removeAudioListener?.(); removeAudioListener = window.screenShare.onAudioChunk((chunk) => { const copy = new Uint8Array(chunk).buffer; processAudioNode?.port.postMessage(copy, [copy]); }); return processAudioDestination.stream.getAudioTracks()[0]; }
async function stopProcessAudio() { removeAudioListener?.(); removeAudioListener = undefined; await window.screenShare.stopProcessAudio(); await processAudioContext?.close(); processAudioContext = undefined; processAudioNode = undefined; processAudioDestination = undefined; }
async function captureSelectedSource() { if (!selected) return undefined; const quality = qualities[($('quality') as HTMLSelectElement).value]; const mode = ($('audioMode') as HTMLSelectElement).value; const desktopAudio = mode === 'system' ? ({ mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: selected.id } } as MediaTrackConstraints) : false; const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: selected.id, minWidth: quality.width, maxWidth: quality.width, minHeight: quality.height, maxHeight: quality.height, maxFrameRate: quality.frameRate } } as MediaTrackConstraints; const nextStream = await navigator.mediaDevices.getUserMedia({ audio: desktopAudio, video }); if (mode === 'app') { const processAudio = await captureProcessAudio(); if (processAudio) nextStream.addTrack(processAudio); } else { await stopProcessAudio(); } return nextStream; }
async function refreshCapture() { if (!selected || (!stream && !code)) return false; try { const nextStream = await captureSelectedSource(); if (!nextStream) return false; const previousStream = stream; const nextVideo = nextStream.getVideoTracks()[0] || null; const nextAudio = nextStream.getAudioTracks()[0] || null; peers.forEach((peer) => { const videoSender = peer.getSenders().find((sender) => sender.track?.kind === 'video'); const audioSender = peer.getSenders().find((sender) => sender.track?.kind === 'audio'); if (videoSender) void videoSender.replaceTrack(nextVideo); if (audioSender) void audioSender.replaceTrack(nextAudio); }); stream = nextStream; preview.srcObject = nextStream; previousStream?.getTracks().forEach((track) => track.stop()); screenStatus.textContent = 'TRANSMITINDO'; audioStatus.textContent = nextAudio ? 'TRANSMITINDO' : 'DESATIVADO'; if (previousStream) notify('Transmissão atualizada sem criar outra sala.'); return true; } catch { notify('Não foi possível aplicar esta alteração. Conteúdo protegido pode aparecer preto pelo sistema ou provedor.'); return false; } }
// claim-room e idempotente: o codigo vem do segredo guardado no app, entao reivindicar
// depois de um restart do servidor devolve exatamente o mesmo codigo e o link ja
// compartilhado continua valendo. So colisao de codigo ou segredo invalido falham, e ai
// insistir nao adianta.
function handleServerError(msg: any) {
  resuming = false;
  claimFailed = true;
  peers.forEach((peer) => peer.close()); peers.clear(); viewerCount.textContent = '0';
  notify(msg.message || 'O servidor recusou a operação.');
}

function connectHost(_resume?: boolean) {
  const url = new URL(publicUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(url.toString());
  socket.onopen = () => send({ type: 'claim-room', secret: roomSecret });
  socket.onclose = () => {
    connectionStatus.textContent = 'RECONECTANDO';
    connectionStatus.className = '';
    if (!claimFailed) reconnectTimer = setTimeout(() => connectHost(), 1000);
  };
  socket.onerror = () => notify('Conexão com o servidor público instável. Tentando reconectar...');
  socket.onmessage = async (event) => handle(JSON.parse(event.data));
}
async function handle(msg: any) { if (msg.type === 'error') return handleServerError(msg); if (msg.type === 'room-created') { resuming = false; code = msg.code; roomToken = msg.token; roomCode.textContent = code; connectionStatus.textContent = 'CONECTADO'; connectionStatus.className = 'ok'; $('copyCode').removeAttribute('disabled'); $('copyLink').removeAttribute('disabled'); startButton.disabled = Boolean(stream); stopButton.disabled = !stream; $('createRoom').setAttribute('disabled', 'true'); notify(recreated ? `Servidor reiniciou, mas o codigo continua ${code}. O link ja enviado segue valendo.` : `Compartilhe ${publicUrl}/watch/${code}`); recreated = true; } if (msg.type === 'room-resumed') { resuming = false; connectionStatus.textContent = 'CONECTADO'; connectionStatus.className = 'ok'; notify(`Sala reconectada: ${publicUrl}/watch/${code}`); } if (msg.type === 'viewer-joined') { viewerCount.textContent = String(Number(viewerCount.textContent) + 1); await createPeer(msg.viewerId, msg.iceServers); } if (msg.type === 'answer') { const peer = peers.get(msg.viewerId) || [...peers.values()][0]; if (peer) await peer.setRemoteDescription(msg.description); } if (msg.type === 'ice') { const peer = peers.get(msg.viewerId) || [...peers.values()][0]; if (peer && msg.candidate) await peer.addIceCandidate(msg.candidate); } if (msg.type === 'viewer-left') viewerCount.textContent = String(msg.count); }
function hostHasRelay(servers: RTCIceServer[]) { return (servers || []).some((server) => [server.urls].flat().some((url) => /^turns?:/i.test(String(url)))); }
async function sendOffer(peer: RTCPeerConnection, viewerId: string) { const offer = await peer.createOffer(); await peer.setLocalDescription(offer); send({ type: 'offer', viewerId, description: peer.localDescription }); }
async function createPeer(viewerId: string, iceServers: RTCIceServer[]) {
  if (!stream) return;
  const peer = new RTCPeerConnection({ iceServers });
  peers.set(viewerId, peer);
  stream.getTracks().forEach((track) => peer.addTrack(track, stream!));
  peer.onicecandidate = (event) => event.candidate && send({ type: 'ice', viewerId, candidate: event.candidate });
  peer.onconnectionstatechange = () => {
    if (peer.connectionState !== 'failed') return;
    notify(hostHasRelay(iceServers)
      ? 'Falha ICE com um espectador. Renegociando...'
      : 'Falha ICE com um espectador. O servidor esta sem TURN: se ele estiver em rede movel ou corporativa, so um relay resolve.');
    peer.restartIce();
  };
  // restartIce() so troca as credenciais da PROXIMA oferta, entao a renegociacao precisa
  // sair por aqui para a recuperacao valer de algo. A trava cobre a oferta inicial: o
  // addTrack acima ja agenda um negotiationneeded, e sem ela sairiam duas ofertas.
  let negotiating = true;
  peer.onnegotiationneeded = () => { if (!negotiating) void sendOffer(peer, viewerId); };
  await sendOffer(peer, viewerId);
  negotiating = false;
}
