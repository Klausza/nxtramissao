import dgram from 'node:dgram';
import crypto from 'node:crypto';

const MAGIC = 0x2112a442;

function attr(type, value) {
  const pad = (4 - (value.length % 4)) % 4;
  const b = Buffer.alloc(4 + value.length + pad);
  b.writeUInt16BE(type, 0);
  b.writeUInt16BE(value.length, 2);
  value.copy(b, 4);
  return b;
}

function build(method, tid, attrs, key) {
  let body = Buffer.concat(attrs);
  if (key) {
    const head = Buffer.alloc(20);
    head.writeUInt16BE(method, 0);
    head.writeUInt16BE(body.length + 24, 2); // +24 = MESSAGE-INTEGRITY completo
    head.writeUInt32BE(MAGIC, 4);
    tid.copy(head, 8);
    const mac = crypto.createHmac('sha1', key).update(Buffer.concat([head, body])).digest();
    body = Buffer.concat([body, attr(0x0008, mac)]);
  }
  const head = Buffer.alloc(20);
  head.writeUInt16BE(method, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(MAGIC, 4);
  tid.copy(head, 8);
  return Buffer.concat([head, body]);
}

function parse(msg) {
  const out = { type: msg.readUInt16BE(0), attrs: {} };
  let off = 20;
  const end = 20 + msg.readUInt16BE(2);
  while (off + 4 <= end && off + 4 <= msg.length) {
    const t = msg.readUInt16BE(off);
    const len = msg.readUInt16BE(off + 2);
    out.attrs[t] = msg.subarray(off + 4, off + 4 + len);
    off += 4 + len + ((4 - (len % 4)) % 4);
  }
  return out;
}

function xorAddr(buf) {
  if (!buf || buf.length < 8) return null;
  const port = buf.readUInt16BE(2) ^ (MAGIC >>> 16);
  const ip = [];
  for (let i = 0; i < 4; i++) ip.push(buf[4 + i] ^ ((MAGIC >>> (24 - 8 * i)) & 0xff));
  return `${ip.join('.')}:${port}`;
}

export function checkTurn(host, port, username, password, timeout = 6000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const tid = crypto.randomBytes(12);
    let stage = 'probe';
    const done = (r) => { try { sock.close(); } catch {} resolve(r); };
    const timer = setTimeout(() => done({ ok: false, motivo: 'sem resposta (timeout)' }), timeout);

    sock.on('error', (e) => { clearTimeout(timer); done({ ok: false, motivo: 'socket: ' + e.message }); });
    sock.on('message', (msg) => {
      const m = parse(msg);
      if (stage === 'probe') {
        const realm = m.attrs[0x0014];
        const nonce = m.attrs[0x0015];
        if (!realm || !nonce) { clearTimeout(timer); return done({ ok: false, motivo: 'servidor respondeu sem realm/nonce', tipo: '0x' + m.type.toString(16) }); }
        stage = 'auth';
        const key = crypto.createHash('md5').update(`${username}:${realm.toString()}:${password}`).digest();
        const req = build(0x0003, tid, [
          attr(0x0019, Buffer.from([17, 0, 0, 0])),
          attr(0x0006, Buffer.from(username)),
          attr(0x0014, realm),
          attr(0x0015, nonce),
        ], key);
        sock.send(req, port, host);
        return;
      }
      clearTimeout(timer);
      if (m.type === 0x0103) return done({ ok: true, relay: xorAddr(m.attrs[0x0016]) });
      const code = m.attrs[0x0009];
      const texto = code ? `${code[2] * 100 + code[3]} ${code.subarray(4).toString()}` : '0x' + m.type.toString(16);
      done({ ok: false, motivo: 'allocate recusado: ' + texto });
    });

    sock.send(build(0x0003, tid, [attr(0x0019, Buffer.from([17, 0, 0, 0]))]), port, host);
  });
}

if (process.argv[1]?.endsWith('check-turn.mjs')) {
  const [host, port, user, pass] = process.argv.slice(2);
  if (!host || !port || !user || !pass) {
    console.log('uso: node scripts/check-turn.mjs <host> <porta> <usuario> <credencial>');
    console.log('ex.:  node scripts/check-turn.mjs turn.meuprovedor.com 3478 usuario senha');
    process.exit(2);
  }
  const r = await checkTurn(host, Number(port), user, pass);
  if (r.ok) {
    console.log(`TURN OK. Endereco de relay alocado: ${r.relay}`);
    console.log(`Pode usar: TURN_URLS=turn:${host}:${port}`);
  } else {
    console.log(`TURN FALHOU: ${r.motivo}`);
  }
  process.exit(r.ok ? 0 : 1);
}
