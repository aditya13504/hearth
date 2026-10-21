import type { CallToolResult, Client, Tool } from '@modelcontextprotocol/client';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

export function uiResourceUri(tool: Tool | undefined): string | undefined {
  const meta = tool?._meta as any;
  const uri = meta?.ui?.resourceUri ?? meta?.['ui/resourceUri'];
  return typeof uri === 'string' && uri.startsWith('ui://') ? uri : undefined;
}

export interface MountedCard {
  iframe: HTMLIFrameElement;
  dispose: () => Promise<void>;
}

/**
 * MCP Apps host: fetch the tool's ui:// resource, render it in a sandboxed iframe and bridge it
 * to the MCP client so the card can call server tools or send a message back to the assistant.
 */
export async function mountCard(opts: {
  client: Client;
  tool: Tool;
  args: Record<string, unknown>;
  result: CallToolResult;
  container: HTMLElement;
  theme: 'light' | 'dark';
  onMessage: (text: string) => void;
}): Promise<MountedCard | null> {
  const uri = uiResourceUri(opts.tool);
  if (!uri) return null;
  const resource = await opts.client.readResource({ uri });
  const html = (resource.contents[0] as { text?: string } | undefined)?.text;
  if (!html) return null;

  const iframe = document.createElement('iframe');
  iframe.className = 'card-frame';
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
  iframe.title = opts.tool.title ?? opts.tool.name;
  opts.container.replaceChildren(iframe);

  const bridge = new AppBridge(
    opts.client,
    { name: 'countertop', version: '0.1.0' },
    { openLinks: {}, serverTools: {}, serverResources: {}, logging: {} },
    {
      hostContext: {
        theme: opts.theme,
        displayMode: 'inline',
        availableDisplayModes: ['inline'],
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        platform: 'web',
        containerDimensions: { width: opts.container.clientWidth, maxHeight: Math.max(240, opts.container.clientHeight) },
        toolInfo: { tool: opts.tool },
      } as any,
    },
  );
  bridge.onsizechange = ({ height }) => {
    if (height) iframe.style.height = `${Math.ceil(height)}px`;
  };
  bridge.onmessage = async ({ content }) => {
    const text = content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join(' ');
    if (text) opts.onMessage(text);
    return {};
  };
  bridge.onopenlink = async ({ url }) => {
    window.open(url, '_blank', 'noopener');
    return {};
  };
  bridge.oninitialized = () => {
    void bridge.sendToolInput({ arguments: opts.args });
    void bridge.sendToolResult(opts.result as any);
  };

  // The view sends `ui/initialize` as soon as its script runs, so listen before loading it.
  // (An iframe's WindowProxy stays the same object across navigations.)
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  iframe.srcdoc = html;

  return {
    iframe,
    dispose: async () => {
      await bridge.teardownResource({}).catch(() => undefined);
      await bridge.close().catch(() => undefined);
    },
  };
}
