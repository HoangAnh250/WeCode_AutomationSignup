export function taskErrorMessage(code?: string) {
  const messages: Record<string, string> = {
    PAUSED: 'Execution paused at a safe checkpoint.',
    WORKFLOW_NOT_CONFIGURED:
      'The active worker has no adapter registered for this task; the browser was not opened. Restart it with the current production backend before retrying.',
    AUTOMATION_NOT_INSTALLED:
      'The browser workflow is not installed. Update the workflow before retrying.',
    BATCH_REQUIRES_CHILD_TASKS:
      'This worker supports one account per run. Use an account count of 1 or separate tasks.',
    BROWSER_LAUNCH_FAILED: 'The browser could not start. Check its installation before retrying.',
    BROWSER_OPERATION_TIMEOUT:
      'A browser operation timed out. Check the task logs before retrying.',
    NO_HEALTHY_PROXY:
      'Auto assign needs a healthy enabled proxy. Check the pool or select Local explicitly.',
    NO_PROXY_CAPACITY: 'No healthy proxy slot is available. Check the proxy pool or use Local.',
    PROFILE_PROXY_CONFLICT: 'Local requires a browser profile without an assigned proxy.',
    PROFILE_BUSY: 'The selected browser profile is in use or awaiting review.',
    RESOURCE_QUARANTINED:
      'Browser cleanup could not be confirmed. Review the profile before restarting.',
    STALE_EXECUTION: 'An earlier worker execution needs review before this task can run again.',
    BUSINESS_OUTCOME_UNKNOWN:
      'The external account result is uncertain. Review it before attempting another signup.',
    WEVERSE_CONSENT_NOT_SELECTED: 'The Agree to All control was not selected.',
    WEVERSE_OVERSEAS_BLOCK_ENABLED:
      'Signup stopped because Block Overseas Logins was still enabled.',
    WEVERSE_PASSWORD_POLICY:
      'Weverse requires a password of at most 32 characters with letters, numbers and symbols.',
    WEVERSE_SELECTOR_CHANGED: 'The Weverse page controls changed. Review the adapter selectors.',
    WEVERSE_SELECTOR_AMBIGUOUS:
      'More than one Weverse control matched; execution stopped before guessing.',
    WEVERSE_PROTOCOL_CHANGED: 'A Weverse response changed. The adapter requires review.',
    WEVERSE_RATE_LIMITED: 'Weverse rate-limited this operation. Wait before trying again.',
    WEVERSE_CHALLENGE_REQUIRED:
      'Weverse rejected or challenged this session. Operator review is required.',
    WEVERSE_SUBMISSION_MISMATCH:
      'The final signup payload did not match the active identity or consent policy.',
    WEVERSE_SIGNUP_TRANSPORT_ERROR:
      'The final signup response was lost. Review the result before another signup.',
    WORKFLOW_STATE_CORRUPT:
      'Saved workflow state could not be authenticated. Check the encryption key and stored data.',
    WORKFLOW_LEASE_LOST: 'This worker no longer owns the task.',
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
    'task.proxy_waiting':
      'Waiting for the assigned proxy to become available; the connection will not switch to Local.',
    'task.resources_waiting': 'Acquiring a browser profile and connection slot.',
    'task.browser_opened': 'Browser context opened.',
    'task.workflow_started': 'Running the browser workflow.',
    'task.account_saved': 'Confirmed account saved.',
    'task.weverse.identity_ready': 'Generated account identity prepared securely.',
    'task.weverse.overseas_signin_allowed': 'Block Overseas Logins turned off and checked.',
    'task.weverse.signup_ready': 'Weverse signup form filled.',
    'task.weverse.otp_requested': 'Verification email requested for the generated account email.',
    'task.weverse.otp_received': 'Matching OTP received from the configured inbox.',
    'task.weverse.email_verified': 'Weverse accepted the verification code.',
    'task.weverse.consent_ready': 'All signup terms selected using Agree to All.',
    'task.weverse.signup_confirmed': 'Weverse confirmed account creation.',
    'task.weverse.authenticated': 'The new account session passed token validation.',
    'task.weverse.session_unverified':
      'Account creation confirmed; browser authentication was not confirmed.',
    'task.session_unavailable': 'Account saved without a verified session snapshot.',
    'task.session_saved': 'Browser session saved.',
    'task.succeeded': 'Task completed successfully.',
    'task.retry_scheduled': 'A safe automatic retry was scheduled.',
    'task.execution_stopped': 'Execution stopped.',
    'task.deleted': 'Task deleted.',
  };
  return `${messages[event] ?? event}${code ? ' [' + code + '] ' + taskErrorMessage(code) : ''}`;
}
