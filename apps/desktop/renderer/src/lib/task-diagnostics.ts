export function taskErrorMessage(code?: string) {
  const messages: Record<string, string> = {
    PAUSED: 'Execution paused at a safe checkpoint.',
    WORKFLOW_NOT_CONFIGURED:
      'Signup is unavailable in this build: the Weverse workflow module has not been installed. The browser was not opened. Retry requires that module first.',
    AUTOMATION_NOT_INSTALLED:
      'The browser workflow is not installed. Update the workflow before retrying.',
    BATCH_REQUIRES_CHILD_TASKS:
      'This worker supports one account per run. Use an account count of 1 or separate tasks.',
    BROWSER_LAUNCH_FAILED: 'The browser could not start. Check its installation before retrying.',
    BROWSER_OPERATION_TIMEOUT:
      'A browser operation timed out. Check the task logs before retrying.',
    NO_PROXY_CAPACITY: 'No healthy proxy slot is available. Check the proxy pool or use Local.',
    PROFILE_PROXY_CONFLICT: 'Local requires a browser profile without an assigned proxy.',
    PROFILE_BUSY: 'The selected browser profile is in use or awaiting review.',
    RESOURCE_QUARANTINED:
      'Browser cleanup could not be confirmed. Review the profile before restarting.',
    STALE_EXECUTION: 'An earlier worker execution needs review before this task can run again.',
    BUSINESS_OUTCOME_UNKNOWN:
      'The external account result is uncertain. Review it before attempting another signup.',
    OTP_TIMEOUT: 'No matching verification code arrived before the request expired.',
    OTP_AMBIGUOUS: 'Multiple verification codes matched. A code was not guessed.',
    IMAP_SCAN_FAILED: 'The OTP inbox could not be read. Check the mailbox connection.',
    EXECUTION_TIMEOUT: 'The workflow exceeded its time limit.',
    WORKER_SHUTDOWN: 'The worker stopped during execution.',
    NO_ACCOUNT_RESULT: 'The workflow ended without a saved account result.',
  };
  return code
    ? (messages[code] ?? 'Execution stopped. Check task logs and configuration before retrying.')
    : undefined;
}
export function taskEventMessage(event: string, code?: string) {
  const messages: Record<string, string> = {
    'task.created': 'Task created.',
    'task.start': 'Start requested; waiting for queue delivery.',
    'task.retry': 'Manual retry requested; a new run was queued.',
    'task.resume': 'Resume requested.',
    'task.pause_requested': 'Pause requested; waiting for a safe checkpoint.',
    'task.job_enqueued': 'Job delivered to the queue.',
    'task.worker_started': 'Worker picked up this run.',
    'task.workflow_check': 'Checking whether the signup workflow is available.',
    'task.workflow_available': 'Signup workflow found. Validating task configuration.',
    'task.resources_waiting': 'Acquiring a browser profile and connection slot.',
    'task.browser_opened': 'Browser context opened.',
    'task.workflow_started': 'Running the browser workflow.',
    'task.account_saved': 'Confirmed account saved.',
    'task.session_saved': 'Browser session saved.',
    'task.succeeded': 'Task completed successfully.',
    'task.retry_scheduled': 'A safe automatic retry was scheduled.',
    'task.execution_stopped': 'Execution stopped.',
    'task.deleted': 'Task deleted.',
  };
  return `${messages[event] ?? event}${code ? ' [' + code + '] ' + taskErrorMessage(code) : ''}`;
}
