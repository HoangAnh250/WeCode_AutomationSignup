import type { Request, Response } from 'express';
import type { AccountManager } from '../services/account.service.js';
import { accountCreateSchema, accountQuerySchema } from '../contracts/schemas.js';
import { paramId } from './helpers.js';
export class AccountController {
  constructor(private readonly service: AccountManager) {}
  list = async (req: Request, res: Response) => {
    res.json(await this.service.list(accountQuerySchema.parse(req.query)));
  };
  get = async (req: Request, res: Response) => {
    res.json(await this.service.get(paramId(req)));
  };
  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.create(accountCreateSchema.parse(req.body)));
  };
  password = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ password: await this.service.password(paramId(req)) });
  };
}
