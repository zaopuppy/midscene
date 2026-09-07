import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestReportServer } from '../src/cli/test-report-server';
import { testReportViewerHtml } from '../src/cli/test-report-viewer';

const directories: string[] = [];

const createRun = (): string => {
  const runDir = mkdtempSync(join(tmpdir(), 'midscene-report-viewer-'));
  directories.push(runDir);
  mkdirSync(join(runDir, 'report'), { recursive: true });
  writeFileSync(join(runDir, 'report', 'index.html'), testReportViewerHtml);
  return runDir;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('test report viewer', () => {
  it('emits a parseable client script with the replay URL contract', () => {
    const script = testReportViewerHtml.match(
      /<script>([\s\S]*)<\/script>/,
    )?.[1];

    expect(script).toBeTruthy();
    expect(() => Function(script!)).not.toThrow();
    expect(testReportViewerHtml).toContain("set('player-only','1')");
    expect(testReportViewerHtml).toContain("set('play-control','1')");
    expect(testReportViewerHtml).toContain("set('auto-play','0')");
    expect(testReportViewerHtml).toContain('Open full report');
    expect(testReportViewerHtml).toContain('No replay artifact');
    expect(testReportViewerHtml).toContain('expandedProjects:new Set()');
    expect(testReportViewerHtml).toContain('expandedDocuments:new Set()');
    expect(testReportViewerHtml).toContain('Unsupported test report schema');
  });

  it('serves directory reports, HEAD checks, and screenshot content types', async () => {
    const runDir = createRun();
    const traceDir = join(runDir, 'artifacts', 'trace');
    mkdirSync(traceDir, { recursive: true });
    writeFileSync(join(traceDir, 'index.html'), '<html>trace</html>');
    writeFileSync(join(traceDir, 'screen.jpg'), 'jpeg-data');
    const server = await startTestReportServer(runDir);

    try {
      const directoryResponse = await fetch(`${server.url}artifacts/trace/`);
      expect(directoryResponse.status).toBe(200);
      expect(await directoryResponse.text()).toBe('<html>trace</html>');

      const headResponse = await fetch(`${server.url}artifacts/trace/`, {
        method: 'HEAD',
      });
      expect(headResponse.status).toBe(200);
      expect(await headResponse.text()).toBe('');

      const imageResponse = await fetch(
        `${server.url}artifacts/trace/screen.jpg`,
      );
      expect(imageResponse.headers.get('content-type')).toBe('image/jpeg');
    } finally {
      await server.close();
    }
  });
});
