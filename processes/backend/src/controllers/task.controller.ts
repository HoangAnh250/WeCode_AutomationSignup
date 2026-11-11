import type { Request, Response } from 'express';
import {
  taskCreateSchema,
  taskUpdateSchema,
  commandSchema,
  taskBatchCreateSchema,
} from '../contracts/schemas.js';
import { pageSchema } from '../core/pagination.js';
import type { TaskManager } from '../services/task.service.js';
import { paramId, idempotencyKey } from './helpers.js';
export class TaskController {
  constructor(private readonly service: TaskManager) {}
  list = async (req: Request, res: Response) => {
    res.json(await this.service.list(pageSchema.parse(req.query)));
  };
  get = async (req: Request, res: Response) => {
    res.json(await this.service.get(paramId(req)));
  };
  create = async (req: Request, res: Response) => {
    res
      .status(201)
      .json(await this.service.create(taskCreateSchema.parse(req.body), idempotencyKey(req)));
  };
  createBatch = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createBatch(taskBatchCreateSchema.parse(req.body)));
  };
  update = async (req: Request, res: Response) => {
    const input = taskUpdateSchema.parse(req.body);
    res.json(await this.service.update(paramId(req), input, input.version));
  };
  delete = async (req: Request, res: Response) => {
    await this.service.delete(paramId(req), commandSchema.parse(req.body).version);
    res.status(204).end();
  };
  command =
    (action: 'start' | 'pause' | 'resume' | 'retry') => async (req: Request, res: Response) => {
      res
        .status(202)
        .json(
          await this.service.command(paramId(req), action, commandSchema.parse(req.body).version),
        );
    };
}
