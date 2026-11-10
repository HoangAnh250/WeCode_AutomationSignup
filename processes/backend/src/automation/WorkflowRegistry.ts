import type { BrowserWorkflow } from './contracts.js';
import { AppError } from '../core/errors.js';
export class WorkflowRegistry {
  private readonly workflows = new Map<string, BrowserWorkflow>();
  register(workflow: BrowserWorkflow) {
    if (this.workflows.has(workflow.key)) throw new Error(`Duplicate workflow: ${workflow.key}`);
    this.workflows.set(workflow.key, workflow);
    return this;
  }
  get(key: string) {
    const workflow = this.workflows.get(key);
    if (!workflow)
      throw new AppError(
        'WORKFLOW_NOT_CONFIGURED',
        'No approved browser workflow adapter is registered for this task.',
        503,
        false,
      );
    return workflow;
  }
  get keys() {
    return [...this.workflows.keys()];
  }
}
