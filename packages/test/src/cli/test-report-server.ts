import { existsSync, readFileSync, statSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { resolve, sep } from 'node:path';

const contentTypeFor = (path: string): string => {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
};

export interface TestReportServer {
  readonly url: string;
  close(): Promise<void>;
}

export const startTestReportServer = async (
  runDir: string,
  port = 0,
): Promise<TestReportServer> => {
  const root = resolve(runDir);
  const viewerPath = resolve(root, 'report', 'index.html');
  if (!existsSync(viewerPath)) {
    throw new Error(
      `Test report viewer does not exist: ${viewerPath}. Re-run the test with a current @midscene/test version.`,
    );
  }

  const server = createServer((request, response) => {
    const requestPath = new URL(request.url || '/', 'http://localhost')
      .pathname;
    const relativePath =
      requestPath === '/' ? '/report/index.html' : requestPath;
    const requestedPath = resolve(root, `.${relativePath}`);
    if (requestedPath !== root && !requestedPath.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const filePath =
      existsSync(requestedPath) && statSync(requestedPath).isDirectory()
        ? resolve(requestedPath, 'index.html')
        : requestedPath;
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Cache-Control': 'no-store',
    });
    response.end(
      request.method === 'HEAD' ? undefined : readFileSync(filePath),
    );
  });

  await new Promise<void>((resolveReady, rejectReady) => {
    server.once('error', rejectReady);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', rejectReady);
      resolveReady();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Test report server did not expose a TCP address.');
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      ),
  };
};
