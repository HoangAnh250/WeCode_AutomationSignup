import type { Request, Response } from 'express';
import { z } from 'zod';
import { idSchema, profileCreateSchema } from '../contracts/schemas.js';
import type { ProfileManager } from '../automation/ProfileManager.js';
export class ProfileController {
  constructor(private readonly profiles: ProfileManager) {}
  list = async (_req: Request, res: Response) => {
    res.json(await this.profiles.list());
  };
  create = async (req: Request, res: Response) => {
    const body = profileCreateSchema.parse(req.body);
    res.status(201).json(await this.profiles.create(body.name, body.mode, body.proxyId));
  };
  delete = async (req: Request, res: Response) => {
    await this.profiles.delete(idSchema.parse(req.params.id));
    res.status(204).end();
  };
  assignProxy = async (req: Request, res: Response) => {
    const { proxyId } = z.object({ proxyId: idSchema.nullable() }).strict().parse(req.body);
    res.json(await this.profiles.assignProxy(idSchema.parse(req.params.id), proxyId));
  };
}
