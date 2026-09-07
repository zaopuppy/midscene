import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { renderNodeReference } from './node-reference';
import { loadTestProject } from './test-project';
import { discoverTestConfig, runTestProject } from './test-project-runner';
import { startTestReportServer } from './test-report-server';
import { writeTestReportViewer } from './test-report-viewer';

export interface TestCliIO {
  log(message: string): void;
  error(message: string): void;
  write?(message: string): void;
}

interface ParsedTestArgs {
  command?: 'describe-nodes' | 'report';
  cwd: string;
  projectRoot?: string;
  configPath?: string;
  resultDir?: string;
  projectNames?: string[];
  reportPort?: number;
}

export const parseTestCliArgs = (
  args: string[],
  cwd = process.cwd(),
): ParsedTestArgs => {
  const command =
    args[0] === 'describe-nodes' || args[0] === 'report' ? args[0] : undefined;
  const commandOffset = command ? 1 : 0;
  let projectRoot: string | undefined;
  let configPath: string | undefined;
  let resultDir: string | undefined;
  let reportPort: number | undefined;
  const projectNames: string[] = [];

  for (let index = commandOffset; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('-')) {
      if (projectRoot)
        throw new Error('Only one test project directory is allowed.');
      projectRoot = resolve(cwd, arg);
      continue;
    }
    if (
      arg === '--config' ||
      arg === '--result-dir' ||
      arg === '--project' ||
      arg === '--port'
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === '--config') configPath = value;
      else if (arg === '--result-dir') resultDir = resolve(cwd, value);
      else if (arg === '--project') projectNames.push(value);
      else {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new Error('--port requires an integer from 0 to 65535.');
        }
        reportPort = port;
      }
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (command === 'describe-nodes' && resultDir) {
    throw new Error('--result-dir is not supported by describe-nodes.');
  }
  if (command === 'describe-nodes' && projectNames.length > 0) {
    throw new Error('--project is not supported by describe-nodes.');
  }
  if (command === 'report') {
    if (!projectRoot) {
      throw new Error('report requires a test run directory.');
    }
    if (configPath || resultDir || projectNames.length > 0) {
      throw new Error('report only supports a run directory and --port.');
    }
  }

  return {
    ...(command ? { command } : {}),
    cwd,
    projectRoot,
    configPath,
    resultDir,
    ...(projectNames.length > 0 ? { projectNames } : {}),
    ...(reportPort === undefined ? {} : { reportPort }),
  };
};

const report = async (
  options: ParsedTestArgs,
  io: TestCliIO,
): Promise<number> => {
  writeTestReportViewer(options.projectRoot!);
  const server = await startTestReportServer(
    options.projectRoot!,
    options.reportPort,
  );
  io.log(`Test report: ${server.url}`);
  io.log('Press Ctrl+C to stop the report server.');
  // The listening server keeps the event loop active. Leave Ctrl+C to Node and
  // the shell's default interrupt handling.
  return 0;
};

const defaultCliIO: TestCliIO = {
  log: console.log,
  error: console.error,
  write: (message) => process.stdout.write(message),
};

const assertDirectory = (path: string, label: string): void => {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} does not exist or is not a directory: ${path}`);
  }
};

const describeNodes = async (
  options: ParsedTestArgs,
  io: TestCliIO,
): Promise<void> => {
  const cwd = resolve(options.cwd);
  assertDirectory(cwd, 'Test working directory');
  const projectRoot = options.projectRoot
    ? resolve(cwd, options.projectRoot)
    : undefined;
  if (projectRoot) assertDirectory(projectRoot, 'Test project directory');

  const configSearchRoot = projectRoot ?? cwd;
  const configPath = options.configPath
    ? resolve(configSearchRoot, options.configPath)
    : discoverTestConfig(configSearchRoot);
  if (options.configPath && (!configPath || !existsSync(configPath))) {
    throw new Error(`Midscene config does not exist: ${configPath}`);
  }

  const project = await loadTestProject(configPath);
  const document = renderNodeReference(project.nodes.definitions());
  for (const warning of document.warnings) {
    io.error(`midscene-test describe-nodes: ${warning}`);
  }
  if (io.write) io.write(document.markdown);
  else io.log(document.markdown.trimEnd());
};

export async function runTestCli(
  args: string[],
  io: TestCliIO = defaultCliIO,
): Promise<number> {
  try {
    const options = parseTestCliArgs(args);
    if (options.command === 'describe-nodes') {
      await describeNodes(options, io);
      return 0;
    }
    if (options.command === 'report') {
      return report(options, io);
    }
    const result = await runTestProject({
      ...options,
      onProgress: (message) => io.log(message),
    });
    io.log(
      `midscene-test: ${result.summary.passed}/${result.summary.total} cases passed, ${result.summary.failed} failed, ${result.summary.notRun} not run`,
    );
    io.log(`Results: ${result.resultDir}`);
    io.log(`Summary: ${result.summaryPath}`);
    io.log(
      `Report: midscene-test report ${JSON.stringify(dirname(result.summaryPath))}`,
    );
    return result.exitCode;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
