# OTP parsing, batch rows and visible browser update (0.1.5)

The observed OTP_AMBIGUOUS failure matched one real verification email. Its rendered text contained the actual verification code and a different six-digit identifier in repeated policy tracking URLs. OTP extraction now excludes URL destinations (including wrapped bracket links) and email addresses before collecting codes. Multiple distinct codes in actual message text or multiple matching messages remain ambiguous; no newest-code guess was introduced.

Create Task batch size N now calls the atomic/idempotent POST /api/v1/tasks/batch endpoint using a stable creation UUID. It inserts N draft rows, each with config.count=1, numbered names and batch metadata in the existing JSON config. Max batch size is 1000. Replaying the same request does not duplicate rows; a changed request with the same identifier conflicts. Explicit shared profiles are rejected for batches; Auto assign provides independent profile leases. No database schema migration is needed for batch metadata.

Tasks automatically focus the newly created batch. The batch selector and search/status filters determine Start all eligibility. Start all queues only matching draft rows, bounds command request concurrency and reports unconfirmed commands without hiding partial progress. The workspace refreshes after errors too. The table shows up to 25 rows per page, so a ten-row batch appears together. These rows are jobs, not ten unconditional concurrent browser processes; BullMQ/browser pool capacity still controls simultaneous execution.

Show browser while running is enabled by default for newly created tasks. It persists as browser.headless=false. The browser pool replaces an idle process when changing between hidden/visible modes. Browser visibility does not change profile isolation or proxy assignment.

Block Overseas Logins is actively unchecked on the signup form. The mutation gate independently requires blockOverseasSignin=false and blocks any true/missing value before the account-creation fence. A live form check confirmed that the site default was true and the helper changed it to false without entering identity data or requesting OTP.

Historical OTP_AMBIGUOUS/OTP_TIMEOUT failures can be retried manually only while their business outcome is NOT_CREATED. Automatic retry policy is unchanged; UNKNOWN/CREATED outcomes remain protected. Failed batch-count tasks from older builds are not silently expanded or replayed; create a new batch using the updated form.

Verification includes MIME/URL regressions, actual verification-email candidate counts (values redacted), PostgreSQL idempotent batch races, legacy safe retry, browser-mode switching, overseas payload tampering, desktop IPC and browser UI tests. No signup was started by the update or its tests. Live account completion remains operator-driven.

Update 0.1.6: signup consent now follows the operator-requested Agree to All control, including collapsed required/optional groups. The payload gate was updated with the same policy. Overseas login blocking remains false.
