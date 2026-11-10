# Task retry and execution diagnostics (0.1.3)

The observed signup attempts stopped with WORKFLOW_NOT_CONFIGURED and backend status BLOCKED. No Weverse browser workflow is registered. This module is application code that still needs implementation; it is not a Playwright dependency or downloadable plugin. Installing Chromium, retrying, or changing proxies cannot supply that missing workflow.

Changes:

- Keep BLOCKED and NEEDS_RECONCILIATION distinct from FAILED in the desktop task model and filters.
- Return a safe currentRun projection in task lists: ID/status/errorCode/retryable/outcome/timing, without lease tokens or checkpoints.
- Show the failure code and a plain-language explanation next to the task status.
- Offer manual Retry only when backend run metadata permits it and outcome is NOT_CREATED; send the versioned TaskManager retry command, never raw BullMQ job.retry.
- Show disabled Retry for unsafe cases. Unknown/created external outcomes still require review and cannot be replayed through the API.
- Clear the current error when a new attempt starts or a run succeeds; previous errors remain in durable logs.
- Persist actual queue/worker/workflow/resource/browser/account/session milestones. A missing workflow stops after the workflow check and does not invent browser or signup activity.
- Poll and forward new log records through Electron IPC every two seconds, preserving timestamp/ID order and avoiding duplicate events.
- Translate event names and legacy error metadata into readable messages with task IDs; raw metadata, OTPs and secrets are not copied into the renderer.
- Open full log details by clicking a message, so longer explanations are readable beyond the single-line log viewport.
- Default new task account count to 1, matching the existing single-account-per-run worker.

Verification: 69 backend tests, nine desktop adapter tests and 17 UI tests passed. Targeted real BullMQ retry confirmed a successful retry clears the old error code. Actual Electron checks cover a blocked task explanation, manual Retry through IPC, queue-state refresh and the full log detail dialog. Source/compiled API and worker were updated only after confirming zero active jobs and zero RUNNING database executions, preserving the prior queue pause state.

The signup workflow itself remains missing. This release makes the task failure and retry rules visible; it does not claim a working Weverse registration flow.
