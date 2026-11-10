import type { Request, Response } from 'express';
import type { ExportManager } from '../services/export.service.js';
import { exportQuerySchema } from '../contracts/schemas.js';
export class ExportController {
  constructor(private readonly service: ExportManager) {}
  accounts = async (req: Request, res: Response) => {
    const input = exportQuerySchema.parse(req.query);
    res.setHeader(
      'Content-Type',
      input.format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="accounts-${new Date().toISOString().slice(0, 10)}.${input.format}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    const controller = new AbortController();
    const abort = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.on('close', abort);
    try {
      await this.service.write(input, res, controller.signal);
    } finally {
      res.off('close', abort);
    }
  };
}
