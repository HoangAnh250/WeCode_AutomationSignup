import type { Request, Response } from 'express';
import { z } from 'zod';
import { proxyImportSchema, proxyUpdateSchema } from '../contracts/schemas.js';
import type { ProxyManager } from '../services/proxy.service.js';
import { pageSchema } from '../core/pagination.js';
import { paramId } from './helpers.js';
export class ProxyController {
  constructor(private readonly service: ProxyManager) {}
  list = async (req: Request, res: Response) => {
    res.json(await this.service.list(pageSchema.parse(req.query)));
  };
  import = async (req: Request, res: Response) => {
    const input = proxyImportSchema.parse(req.body);
    res.json(await this.service.import(input.content, input.format, input.dryRun));
  };
  check = async (req: Request, res: Response) => {
    res.json(await this.service.check(paramId(req)));
  };
  rotate = async (_req: Request, res: Response) => {
    res.json(await this.service.rotate());
  };
  statistics = async (_req: Request, res: Response) => {
    res.json(await this.service.statistics());
  };
  history = async (req: Request, res: Response) => {
    res.json(await this.service.healthHistory(paramId(req)));
  };
  update = async (req: Request, res: Response) => {
    if (req.body && Object.keys(req.body).length === 1 && typeof req.body.enabled === 'boolean')
      return this.enabled(req, res);
    res.json(await this.service.update(paramId(req), proxyUpdateSchema.parse(req.body)));
  };
  delete = async (req: Request, res: Response) => {
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    await this.service.delete(paramId(req), version);
    res.status(204).end();
  };
  enabled = async (req: Request, res: Response) => {
    res.json(
      await this.service.setEnabled(
        paramId(req),
        z.object({ enabled: z.boolean() }).strict().parse(req.body).enabled,
      ),
    );
  };
}
