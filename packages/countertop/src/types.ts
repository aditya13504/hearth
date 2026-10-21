export interface DeviceConfig {
  id: string;
  label: string;
  variant: 'display' | 'phone';
  owner: string;
  /** Who this person is, shown under the device name. */
  role?: string;
  mcpUrl: string;
  token?: string;
  idleTitle?: string;
  suggestions?: string[];
}

/** One step of a guided demo: say something on a device, or move the demo clock. */
export interface StoryStep {
  title: string;
  note?: string;
  device?: string;
  say?: string;
  time?: string;
}

export interface CountertopConfig {
  title: string;
  subtitle?: string;
  headline?: string;
  intro?: string;
  skills: Array<{ path: string; content: string }>;
  voice?: { preferred?: string[] };
  demo?: { url: string; presets: Array<{ label: string; time: string; caption?: string }> };
  story?: StoryStep[];
  links?: Array<{ label: string; href: string }>;
  devices: DeviceConfig[];
  llm: { model: string; configured: boolean };
}

/** OpenAI-compatible chat message (what the /api/llm proxy speaks). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string }; [k: string]: unknown }>;
  tool_call_id?: string;
  [k: string]: unknown;
}
