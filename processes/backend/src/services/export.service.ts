import { ExportRepository } from '../repositories/export.repository.js';
import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import type { AccountManager } from './account.service.js';
import type { z } from 'zod';
import type { exportQuerySchema } from '../contracts/schemas.js';
import { audit } from '../core/events.js';
export function csvCell(value: string) {
  const safe = /^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export class ExportManager {
  private readonly repository: ExportRepository;
  constructor(private readonly accounts: AccountManager) {
    this.repository = new ExportRepository(accounts.repo);
  }
  async write(input: z.infer<typeof exportQuerySchema>, output: Writable, signal?: AbortSignal) {
    const cutoff = new Date();
    await audit(this.accounts.repo.db, 'accounts.exported', 'accounts', {
      format: input.format,
      includePasswords: input.includePasswords,
    });
    const headers = ['email', 'username', 'password', 'proxy_used', 'created_at', 'status'];
    const workbook =
      input.format === 'xlsx'
        ? new ExcelJS.stream.xlsx.WorkbookWriter({
            stream: output,
            useStyles: false,
            useSharedStrings: false,
          })
        : undefined;
    const sheet = workbook?.addWorksheet('Accounts');
    sheet?.addRow(headers).commit();
    if (!workbook) await this.chunk(output, '\uFEFF' + headers.map(csvCell).join(',') + '\r\n');
    let cursor: string | undefined;
    let exported = 0;
    while (!signal?.aborted && !output.destroyed) {
      const batch = await this.repository.batch(input, cutoff, cursor);
      if (!batch.length) break;
      for (const a of batch) {
        if (signal?.aborted || output.destroyed) break;
        const row = [
          a.email,
          a.username,
          input.includePasswords ? this.accounts.decrypt(a.id, a.passwordCipher) : '********',
          a.proxyUsed ?? '',
          a.createdAt.toISOString(),
          a.status,
        ];
        if (sheet) sheet.addRow(row).commit();
        else await this.chunk(output, row.map(csvCell).join(',') + '\r\n');
        exported++;
      }
      cursor = batch.at(-1)!.id;
      if (batch.length < 250) break;
    }
    if (signal?.aborted || output.destroyed) return;
    if (workbook) {
      sheet!.commit();
      await workbook.commit();
    } else output.end();
    return exported;
  }
  private async chunk(output: Writable, chunk: string) {
    if (output.destroyed) return;
    await new Promise<void>((resolve, reject) =>
      output.write(chunk, (error) => (error ? reject(error) : resolve())),
    );
  }
}
