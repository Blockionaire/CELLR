export const PUSH_DIR: string;
export const PUSH_CERT: string;
export function ensureCertificate(): void;
export function startPushReceiver(port: number): Promise<{
  url: string;
  calls: (id: string) => unknown[];
  markGone: (id: string) => void;
  close: () => Promise<void>;
}>;
