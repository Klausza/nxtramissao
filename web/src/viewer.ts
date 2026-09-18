type Message = { type: string; [key: string]: any };
const form = document.querySelector<HTMLFormElement>('#join')!;
const codeInput = document.querySelector<HTMLInputElement>('#code')!;
const message = document.querySelector<HTMLElement>('#message')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const video = document.querySelector<HTMLVideoElement>('#video')!;
const state = document.querySelector<HTMLElement>('#state')!;
let socket: WebSocket; let peer: RTCPeerConnection | undefined;
const codeFromPath = location.pathname.match(/\/watch\/([A-Z2-9]{6})/i)?.[1];
if (codeFromPath) codeInput.value = codeFromPath.toUpperCase();
function show(text: string) { message.textContent = text; }
function send(data: Message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
form.addEventListener('submit', (event) => { event.preventDefault(); const code = codeInput.value.trim().toUpperCase(); if (!/^[A-Z2-9]{6}$/.test(code)) return show('Digite um código de 6 caracteres.'); stage.classList.remove('hidden'); state.textContent = 'Conectando ao servidor...'; const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host; socket = new WebSocket(wsUrl); socket.onopen = () => send({ type: 'join-room', code }); socket.onclose = () => { state.textContent = 'Servidor desconectado'; }; socket.onmessage = async (event) => handle(JSON.parse(event.data)); });
async function handle(msg: Message) { if (msg.type === 'error') return show(msg.message); if (msg.type === 'joined') { peer = new RTCPeerConnection({ iceServers: msg.iceServers }); peer.onicecandidate = (event) => event.candidate && send({ type: 'ice', candidate: event.candidate }); peer.ontrack = (event) => { video.srcObject = event.streams[0]; state.textContent = 'Transmitindo'; }; peer.onconnectionstatechange = () => { if (peer?.connectionState === 'failed') { state.textContent = 'Falha de conexão. O TURN pode estar indisponível.'; peer.restartIce(); } }; return; } if (msg.type === 'offer' && peer) { await peer.setRemoteDescription(msg.description); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); send({ type: 'answer', description: peer.localDescription }); } if (msg.type === 'ice' && peer && msg.candidate) await peer.addIceCandidate(msg.candidate); if (msg.type === 'host-offline' || msg.type === 'host-stopped') { state.textContent = 'Transmissão encerrada pelo transmissor'; video.srcObject = null; } }
