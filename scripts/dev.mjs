import net from 'net';
import { spawn } from 'child_process';

const PREFERRED_PORT = 9292;

function findFreePort(start) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(start, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // Port in use — let OS pick a free one
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const { port } = fallback.address();
        fallback.close(() => resolve(port));
      });
    });
  });
}

const port = await findFreePort(PREFERRED_PORT);
if (port !== PREFERRED_PORT) {
  console.log(`Port ${PREFERRED_PORT} in use, using ${port} instead.`);
}

const child = spawn(
  'shopify',
  ['theme', 'dev', '--store', 'brightfield-2.myshopify.com', '--port', String(port)],
  { stdio: 'inherit' }
);

child.on('exit', (code) => process.exit(code ?? 0));
