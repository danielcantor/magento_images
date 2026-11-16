// Ajustes compartidos (servidor y cliente) del modo de subida.
export type UploadMode = "direct" | "bulk";

export interface QueueSettings {
  pollMs: number;
  timeoutMs: number;
}

export const DEFAULT_QUEUE: QueueSettings = { pollMs: 5000, timeoutMs: 15 * 60 * 1000 };
