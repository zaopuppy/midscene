import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type HarmonyAgent,
  agentFromHdcDevice,
  getConnectedDevices,
} from '@midscene/harmony';
import { defineNode, z } from '@midscene/test';
import { defineProjectSetup, defineTestProject } from '@midscene/test/config';
import {
  type AgentProvider,
  createMidsceneNodes,
} from '@midscene/test/midscene';
import { config as loadEnv } from 'dotenv';

const configDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(configDir, '.env') });
loadEnv({ path: resolve(configDir, '../../.env') });

interface ProjectContext {
  deviceId: string;
}

const aiActionContext =
  'This is a HarmonyOS device. The system language is Chinese. The app under test is Huawei Browser (华为浏览器). The browser homepage is a news feed with a top search bar, topic tabs such as 推荐, and a bottom bar with 首页, 视频, 好物, and 我的. If any popup appears, dismiss or agree to it.';

const activeAgents = new Map<string, HarmonyAgent>();

const agentProvider = {
  async getAgent(runId, { context }) {
    const existing = activeAgents.get(runId);
    if (existing) return existing;

    const agent = await agentFromHdcDevice(context.deviceId, {
      aiActionContext,
      reportFileName: `harmony-${runId}`,
      outputFormat: 'html-and-external-assets',
    });
    activeAgents.set(runId, agent);
    return agent;
  },
  async releaseAgent(runId) {
    const agent = activeAgents.get(runId);
    if (!agent) return;
    try {
      await agent.destroy();
      if (!agent.reportFile) {
        throw new Error(`Harmony Agent ${runId} did not produce a report.`);
      }
      return { reportPath: agent.reportFile };
    } finally {
      activeAgents.delete(runId);
    }
  },
} satisfies AgentProvider<ProjectContext>;

const terminateInputSchema = z
  .strictObject({
    prompt: z
      .string()
      .regex(/\S/)
      .optional()
      .describe('String shorthand for the app to terminate.'),
    uri: z
      .string()
      .regex(/\S/)
      .optional()
      .describe('The bundle name or mapped app name to terminate.'),
  })
  .superRefine((input, ctx) => {
    if ((input.prompt === undefined) === (input.uri === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'exactly one of prompt and uri is required',
      });
    }
  });

const terminateApp = defineNode<
  typeof terminateInputSchema,
  unknown,
  ProjectContext
>({
  name: 'terminate',
  title: 'Terminate a HarmonyOS app',
  description:
    'Force-stop a HarmonyOS app by bundle name or mapped app name. This does not uninstall the app or clear its data.',
  inputSchema: terminateInputSchema,
  async execute(ctx) {
    const { input } = ctx;
    const uri = input.uri ?? input.prompt!;
    const runId =
      ctx.scope === 'case' ? ctx.case.runId : ctx.document.documentRunId;
    const agent = await agentProvider.getAgent(runId, ctx);
    await agent.terminate(uri);
    return { summary: `Terminated ${uri}` };
  },
});

const midsceneNodes = createMidsceneNodes<ProjectContext>({
  agentProvider,
});

const harmonySetup = defineProjectSetup<ProjectContext>({
  name: 'harmony-device',
  async setup({ env }) {
    const requestedDeviceId = env.MIDSCENE_HARMONY_DEVICE_ID?.trim();
    if (requestedDeviceId) return { deviceId: requestedDeviceId };

    const [device] = await getConnectedDevices();
    if (!device) {
      throw new Error(
        'No HarmonyOS devices found. Please connect a HarmonyOS device and ensure HDC is properly configured. Run `hdc list targets` to verify device connection.',
      );
    }
    return { deviceId: device.deviceId };
  },
});

export default defineTestProject<ProjectContext>({
  projects: [
    {
      name: 'harmonyos-browser',
      platform: 'android',
      setup: harmonySetup,
      files: { include: ['cases/**/*.{yaml,yml}'] },
      variables: {
        browserBundle: 'com.huawei.hmos.browser',
      },
    },
  ],
  test: {
    testTimeout: 240_000,
  },
  nodes: [terminateApp, ...midsceneNodes],
});
