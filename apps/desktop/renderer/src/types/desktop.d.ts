import type { DesktopClient } from './domain';
declare global {
  interface Window {
    wecode?: { protocolVersion: 1; client: Omit<DesktopClient, 'mode'> };
  }
}
export {};
