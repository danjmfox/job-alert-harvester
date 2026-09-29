# Run the drive.file Sheets probe

How-To. Validates the three unverified assumptions in DR-0012 (Sheets target uses drive.file scope). The probe is throwaway code in `/tmp`; it is not part of the repo.

## Prerequisites

- In the GCP project behind `~/.config/job-alert-harvester/client.json`: the **Google Sheets API** and the **Google Drive API** are enabled.
- The OAuth consent screen lists `https://www.googleapis.com/auth/drive.file`.
- Node 22, run from any directory (the probe imports from this repo by absolute path).

## Run

```
node /tmp/spike_sheets-api-target/probe.mjs
```

Add `--keep` to leave the spike file in Drive (default: it is deleted at the end).

First run prints a consent URL. Open it, grant `drive.file`, and the loopback listener finishes the flow. The refresh token is stored at `~/.config/job-alert-harvester/spike-drive-file-token.json` (mode 0600) and reused on later runs. Delete that file to force a fresh consent.

## What it touches

- Creates one Drive file named `harvester-spike (safe to delete)`: a native Sheet converted from a generated `.xlsx` with six synthetic rows (`linkedin:1000001..6`).
- Edits only that file: value writes, developer metadata, a sort, a row insert, and scratch cells in columns F and G.
- Deletes it at the end (step F) unless `--keep`. If the run aborts and the delete fails, delete the file by hand.
- Reads no tracker, no `.cache/`, no Gmail data. Prints no token, code, secret or file id.

## Paste back

The block after the line `=== ASSUMPTIONS (paste this back) ===`. It contains no secrets or ids. If any step printed `FAIL`, paste that step's lines as well (HTTP status and Google `reason` only).
