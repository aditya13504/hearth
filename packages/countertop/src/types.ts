export interface DeviceConfig {
  id: string;
  label: string;
  variant: 'display' | 'phone';
  owner: string;
  mcpUrl: string;
  token?: string;
  idleTitle?: string;
  suggestions?: string[];
}

export interface CountertopConfig {
  title: string;
  subtitle?: string;
  skills: Array<{ path: string; content: string }>;
  voice?: { preferred?: string[] };
  demo?: { url: string; presets: Array<{ label: string; time: string }> };
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
