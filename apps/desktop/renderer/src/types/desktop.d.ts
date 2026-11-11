import type { DesktopClient } from './domain';
declare global {
  interface Window {
    wecode?: { protocolVersion: 1; appVersion?: string; client: Omit<DesktopClient, 'mode'> };
  }
}
export {};
