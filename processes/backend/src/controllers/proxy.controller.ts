import type { Request, Response } from 'express';
import { z } from 'zod';
import { proxyImportSchema } from '../contracts/schemas.js';
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
  enabled = async (req: Request, res: Response) => {
    res.json(
      await this.service.setEnabled(
        paramId(req),
        z.object({ enabled: z.boolean() }).strict().parse(req.body).enabled,
      ),
    );
  };
}
