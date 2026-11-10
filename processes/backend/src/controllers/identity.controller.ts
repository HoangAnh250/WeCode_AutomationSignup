import type { Request, Response } from 'express';
import type { CatchallManager } from '../services/identity.service.js';
import { identitySchema } from '../contracts/schemas.js';
export class IdentityController {
  constructor(private readonly service: CatchallManager) {}
  generate = (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ items: this.service.generate(identitySchema.parse(req.body)) });
  };
}
