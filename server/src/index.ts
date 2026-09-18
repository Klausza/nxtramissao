import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const port = Number(process.env.PORT || 8080);
const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const rooms = new Map<string, { host: WebSocket | null; token: string; viewers: Map<WebSocket, string> }>();
const attempts = new Map<string, { count: number; reset: number }>();
const codePattern = /^[A-Z2-9]{6}$/;
const defaultStun = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'];

app.use(express.static(path.join(__dirname, '../web')));
app.get('/watch/:code', (_req, res) => res.sendFile(path.join(__dirname, '../web/index.html')));
app.get('/api/config', (_req, res) => res.json({ publicUrl, iceServers: iceServers(), relay: Boolean(turnConfig()) }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../web/index.html')));

function list(value: string | undefined) { return (value || '').split(',').map((entry) => entry.trim()).filter(Boolean); }

// TURN_URLS aceita varios enderecos separados por virgula (udp, tcp e turns na mesma
// credencial). TURN_URL continua valendo para nao quebrar quem ja tem a variavel antiga.
function turnConfig() {
  const urls = list(process.env.TURN_URLS || process.env.TURN_URL);
  if (!urls.length || !process.env.TURN_USERNAME || !process.env.TURN_CREDENTIAL) return undefined;
  return { urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL };
}

function iceServers() {
  const stun = list(process.env.STUN_URLS).length ? list(process.env.STUN_URLS) : defaultStun;
  const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [{ urls: stun }];
  const turn = turnConfig();
  if (turn) servers.push(turn);
  return servers;
}
function send(socket: WebSocket, message: unknown) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function newCode() { let code = ''; do { code = crypto.randomBytes(4).toString('base64').replace(/[^A-Z2-9]/gi, '').toUpperCase().slice(0, 6); } while (code.length < 6 || rooms.has(code)); return code; }
function countAttempt(ip: string) { const now = Date.now(); if (attempts.size > 5000) for (const [key, value] of attempts) if (value.reset < now) attempts.delete(key); const current = attempts.get(ip); if (!current || current.reset < now) { attempts.set(ip, { count: 1, reset: now + 60_000 }); return true; } current.count += 1; return current.count <= 30; }

wss.on('connection', (socket, request) => {
  const forwardedFor = request.headers['x-forwarded-for'];
  const ip = (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : request.socket.remoteAddress) || 'unknown';
  let role: 'host' | 'viewer' | undefined; let roomCode: string | undefined; let viewerId: string | undefined;
  let alive = true;
  socket.on('pong', () => { alive = true; });
  const heartbeat = setInterval(() => { if (!alive) return socket.terminate(); alive = false; socket.ping(); }, 20000);
  socket.on('message', (raw) => {
    let message: any; try { message = JSON.parse(raw.toString()); } catch { return send(socket, { type: 'error', message: 'Mensagem inválida.' }); }
    if (!message || typeof message.type !== 'string') return send(socket, { type: 'error', message: 'Mensagem inválida.' });
    if (message.type === 'create-room') { if (role) return; roomCode = newCode(); role = 'host'; const token = crypto.randomUUID(); rooms.set(roomCode, { host: socket, token, viewers: new Map() }); return send(socket, { type: 'room-created', code: roomCode, token, iceServers: iceServers() }); }
    if (message.type === 'resume-room') { const room = typeof message.code === 'string' ? rooms.get(message.code) : undefined; if (role || !room || room.token !== message.token) return send(socket, { type: 'error', message: 'Não foi possível retomar a sala.' }); role = 'host'; roomCode = message.code; room.host = socket; room.viewers.forEach((_, viewer) => send(viewer, { type: 'host-online' })); return send(socket, { type: 'room-resumed', code: roomCode, iceServers: iceServers() }); }
    if (message.type === 'join-room') { if (!countAttempt(ip)) return send(socket, { type: 'error', message: 'Muitas tentativas. Aguarde um minuto.' }); if (role || typeof message.code !== 'string' || !codePattern.test(message.code)) return send(socket, { type: 'error', message: 'Código inválido.' }); const room = rooms.get(message.code); if (!room) return send(socket, { type: 'error', message: 'Sala inexistente ou encerrada.' }); role = 'viewer'; roomCode = message.code; viewerId = crypto.randomUUID(); room.viewers.set(socket, viewerId); send(socket, { type: 'joined', code: roomCode, viewerId, iceServers: iceServers() }); if (room.host) return send(room.host, { type: 'viewer-joined', viewerId, iceServers: iceServers() }); }
    if (!roomCode || !rooms.has(roomCode)) return send(socket, { type: 'error', message: 'Sala indisponível.' });
    const room = rooms.get(roomCode)!;
    if (message.type === 'start' && role === 'host') { room.viewers.forEach((_, viewer) => send(viewer, { type: 'host-started' })); return; }
    if (message.type === 'stop' && role === 'host') { room.viewers.forEach((_, viewer) => send(viewer, { type: 'host-stopped' })); return; }
    if (['offer', 'answer', 'ice'].includes(message.type)) { const target = role === 'host' ? [...room.viewers.entries()].find(([, id]) => id === message.viewerId)?.[0] : room.host; if (!target) return; send(target, { ...message, viewerId: role === 'host' ? message.viewerId : viewerId, from: role }); }
  });
  socket.on('close', () => { clearInterval(heartbeat); if (!roomCode) return; const room = rooms.get(roomCode); if (!room) return; if (role === 'host') { if (room.host === socket) room.host = null; room.viewers.forEach((_, viewer) => send(viewer, { type: 'host-offline' })); setTimeout(() => { if (room.host === null) rooms.delete(roomCode!); }, 30000); } else { room.viewers.delete(socket); if (room.host) send(room.host, { type: 'viewer-left', count: room.viewers.size }); } });
});
server.listen(port, () => {
  console.log(`Screen share server listening on ${publicUrl}`);
  if (!turnConfig()) console.warn('AVISO: TURN nao configurado. Defina TURN_URLS, TURN_USERNAME e TURN_CREDENTIAL. Sem relay, quem estiver atras de NAT simetrico ou CGNAT (4G/5G, rede corporativa) nao consegue assistir.');
});
