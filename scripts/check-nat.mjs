import dgram from 'node:dgram';
import crypto from 'node:crypto';
const MAGIC = 0x2112a442;

// Binding request pela MESMA porta local para varios STUN.
// Endereco mapeado diferente por destino = NAT simetrico = TURN obrigatorio.
function bind(sock, host, port) {
  return new Promise((res) => {
    const tid = crypto.randomBytes(12);
    const req = Buffer.alloc(20);
    req.writeUInt16BE(0x0001, 0); req.writeUInt16BE(0, 2); req.writeUInt32BE(MAGIC, 4); tid.copy(req, 8);
    const t = setTimeout(() => res(null), 5000);
    const onMsg = (msg) => {
      if (!msg.subarray(8, 20).equals(tid)) return;
      clearTimeout(t); sock.off('message', onMsg);
      let off = 20; const end = 20 + msg.readUInt16BE(2);
      while (off + 4 <= end) {
        const ty = msg.readUInt16BE(off), len = msg.readUInt16BE(off + 2);
        const v = msg.subarray(off + 4, off + 4 + len);
        if (ty === 0x0020 || ty === 0x0001) {
          const xor = ty === 0x0020;
          const p = v.readUInt16BE(2) ^ (xor ? MAGIC >>> 16 : 0);
          const ip = [];
          for (let i = 0; i < 4; i++) ip.push(v[4 + i] ^ (xor ? (MAGIC >>> (24 - 8 * i)) & 0xff : 0));
          return res(`${ip.join('.')}:${p}`);
        }
        off += 4 + len + ((4 - (len % 4)) % 4);
      }
      res(null);
    };
    sock.on('message', onMsg);
    sock.send(req, port, host);
  });
}

const sock = dgram.createSocket('udp4');
await new Promise((r) => sock.bind(0, r));
console.log('porta local:', sock.address().port);
const servidores = [['stun.l.google.com', 19302], ['stun1.l.google.com', 19302], ['stun.cloudflare.com', 3478]];
const vistos = [];
for (const [h, p] of servidores) {
  const a = await bind(sock, h, p);
  console.log(`${h}:${p}`.padEnd(30), a || 'sem resposta');
  if (a) vistos.push(a);
}
sock.close();
const unicos = [...new Set(vistos)];
console.log('\nenderecos distintos:', unicos.length);
console.log(unicos.length <= 1 ? 'NAT NAO-SIMETRICO -> STUN sozinho deve conectar' : 'NAT SIMETRICO -> TURN e obrigatorio');
process.exit(0);
