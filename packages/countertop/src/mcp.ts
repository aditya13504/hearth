import { Client, StreamableHTTPClientTransport, type Transport } from '@modelcontextprotocol/client';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/app-bridge';
import { log } from './inspector';
import type { DeviceConfig } from './types';

/** Wraps a transport so every JSON-RPC message in either direction lands in the inspector. */
class InspectedTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport['onmessage'];

  constructor(
    private readonly inner: Transport,
    private readonly device: string,
  ) {}

  get sessionId() {
    return this.inner.sessionId;
  }

  setProtocolVersion = (version: string) => this.inner.setProtocolVersion?.(version);

  async start() {
    this.inner.onmessage = (message, extra) => {
      log(this.device, 'in', message);
      this.onmessage?.(message, extra);
    };
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (e) => this.onerror?.(e);
    await this.inner.start();
  }

  async send(message: Parameters<Transport['send']>[0], options?: Parameters<Transport['send']>[1]) {
    log(this.device, 'out', message);
    await this.inner.send(message, options);
  }

  async close() {
    await this.inner.close();
  }
}

export async function connectDevice(device: DeviceConfig): Promise<Client> {
  const client = new Client(
    { name: 'countertop', title: `Countertop — ${device.label}`, version: '0.1.0' },
    {
      capabilities: {
        // Purchases and other confirmations are asked of the person on the device.
        elicitation: { form: {} },
        // Advertise MCP Apps support so servers send interactive cards.
        extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [RESOURCE_MIME_TYPE] } },
      } as any,
    },
  );
  const headers: Record<string, string> = {};
  if (device.token) headers.Authorization = `Bearer ${device.token}`;
  const transport = new StreamableHTTPClientTransport(new URL(device.mcpUrl), { requestInit: { headers } });
  await client.connect(new InspectedTransport(transport, device.id));
  return client;
}
