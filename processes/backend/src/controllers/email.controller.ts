import type { Request, Response } from 'express';
import type { EmailManager } from '../services/email.service.js';
import { emailConfigSchema, emailUpdateSchema, verificationSchema } from '../contracts/schemas.js';
import { paramId } from './helpers.js';
export class EmailController {
  constructor(private readonly service: EmailManager) {}
  list = async (_req: Request, res: Response) => {
    res.json(await this.service.list());
  };
  appPassword = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ appPassword: await this.service.appPassword(paramId(req)) });
  };
  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.create(emailConfigSchema.parse(req.body)));
  };
  update = async (req: Request, res: Response) => {
    res.json(await this.service.update(paramId(req), emailUpdateSchema.parse(req.body)));
  };
  test = async (req: Request, res: Response) => {
    res.json(await this.service.test(paramId(req)));
  };
  verification = async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        await this.service.createVerification(paramId(req), verificationSchema.parse(req.body)),
      );
  };
  status = async (req: Request, res: Response) => {
    res.json(await this.service.status(paramId(req)));
  };
  scan = async (req: Request, res: Response) => {
    res.json(await this.service.scan(paramId(req)));
  };
  code = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ code: await this.service.code(paramId(req)) });
  };
}
