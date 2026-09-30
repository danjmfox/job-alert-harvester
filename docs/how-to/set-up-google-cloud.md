# Set up Google Cloud credentials

Doc type: How-To

Goal: create one Google OAuth client, save it under `~/.config/job-alert-harvester/`, and record two consents: read-only Gmail access (needed to fetch mail) and `drive.file` access (needed only if the tracker is a Google Sheet).

Steps marked **Yours to do (browser)** need you in the Google Cloud console or a browser. The console's menu names change over time and were not checked against the live console when this guide was written; the setting names below are the ones Google documents.

## Before you start

- You have run `npm install` in the repository root (see [Build the tracker workbook](build-the-tracker-workbook.md)).
- You know which kind of Google account receives the job alerts: a Google Workspace account (a work or organisation address) or a personal Google account. Step 3 depends on it.
- You are on the machine that will run the harvester. The consent step opens a listener on `127.0.0.1` of that machine.

## Steps

1. **Yours to do (browser):** In the Google Cloud console, create a project or select an existing one.

2. **Yours to do (browser):** Enable the Gmail API for the project.

3. **Yours to do (browser):** Enable the Google Sheets API for the project. Skip this step and the next if the tracker will stay an `.xlsx` file.

4. **Yours to do (browser):** Enable the Google Drive API for the project.

5. **Yours to do (browser):** Set the OAuth consent screen audience.
   - Workspace account: choose **Internal**.
   - Personal account: choose **External**, then publish the app so its status is **In production**.

6. **Yours to do (browser):** Add the scope `https://www.googleapis.com/auth/gmail.readonly` to the consent screen.

7. **Yours to do (browser):** Add the scope `https://www.googleapis.com/auth/drive.file` to the consent screen. Skip this step if the tracker will stay an `.xlsx` file.

8. **Yours to do (browser):** Create an OAuth client of application type **Desktop app**, then download its JSON file. The file must contain an `installed` object holding `client_id` and `client_secret`.

9. Create the credential directory with mode `0700`:

   ```bash
   mkdir -p ~/.config/job-alert-harvester
   chmod 700 ~/.config/job-alert-harvester
   ```

10. Move the downloaded file into place as `client.json`:

    ```bash
    mv <downloaded-file>.json ~/.config/job-alert-harvester/client.json
    ```

11. Restrict the file to its owner:

    ```bash
    chmod 600 ~/.config/job-alert-harvester/client.json
    ```

12. Record the Gmail consent:

    ```bash
    node src/cli/harvest.mjs auth
    ```

    The command prints a consent URL and waits up to five minutes.

13. **Yours to do (browser):** Open the printed URL in a browser on the same machine and approve read-only Gmail access. On an External app Google may show an unverified-app warning; continue past it.

    Expected result on the terminal: `harvest auth: consent recorded for you@example.com`, with your own address.

14. Record the Sheets consent. Skip this step if the tracker will stay an `.xlsx` file:

    ```bash
    node src/cli/harvest.mjs auth --target sheets
    ```

15. **Yours to do (browser):** Open the printed URL and approve `drive.file` access.

    Expected result on the terminal: `harvest auth --target sheets: consent recorded for drive.file`.

16. Check the directory. It holds `client.json`, `token.json` and, if you ran step 14, `sheets-token.json`, each readable only by you:

    ```bash
    ls -l ~/.config/job-alert-harvester
    ```

`sheets-target.json` appears later, when you run `import` (see [Use a Google Sheet as the tracker](use-a-google-sheet-as-the-tracker.md)).

Next: [Fetch new mail](fetch-new-mail.md).

## Why

**One client, two consents.** `auth` and `auth --target sheets` read the same `client.json` but ask for different scopes and store separate tokens, so the Gmail token stays `gmail.readonly` only. See DR-0012 (Sheets target under drive.file).

**Audience choice.** An Internal client needs no verification and its refresh token does not expire after seven days. An External client left in "Testing" expires its refresh token after seven days, so publish it to "In production". The unverified-app warning is the cost of the External route. See DR-0011 (Gmail credential is Internal OAuth). The operator's own credential is Internal; the External route is documented in that record but has not been exercised.

**Modes.** The harvester refuses a credential directory that is not exactly `0700`, and any credential file with a group or other permission bit. It also refuses symlinks in place of these files.

## If it goes wrong

Every refusal prints as `code: detail` on stderr and exits with status 1. The full list is in the [refusals reference](../reference/refusals.md).

| You see | Do this |
|---|---|
| `gmail.credential-missing` or `sheets.credential-missing` | The directory, `client.json` or the token file is absent. Repeat steps 9 to 11, or run the matching `auth` command again. |
| `gmail.credential-invalid` or `sheets.credential-invalid` | The file is unreadable JSON, a symlink, or lacks `installed.client_id` and `installed.client_secret`. Download a Desktop-type client again (step 8). |
| `gmail.credential-permissions` or `sheets.credential-permissions` | Run `chmod 700 ~/.config/job-alert-harvester` and `chmod 600` on each file inside it. |
| `auth.consent-timeout` | No approval arrived within five minutes. Run the command again and open the new URL at once. |
| `auth.consent-denied` | The browser reported an error or a refusal. Run the command again and approve. |
| `auth.state-mismatch` | You opened a URL from an earlier run. Run the command again and use only the newest URL. |
| `auth.exchange-failed` | Google rejected the approval code. Check that `client.json` is the Desktop client of the project where you enabled the APIs, then run the command again. |
| `auth.no-refresh-token` | Google approved but sent no refresh token. Remove the app's access in your Google account's third-party access settings, then run the command again. |
| `gmail.scope-mismatch` or `sheets.scope-mismatch` | Google granted a different scope from the one asked for. Run the command again and approve the scope shown. |
| `auth.unknown-target` | `--target` accepts only `gmail` or `sheets`. |
| `gmail.base-url-not-loopback` | The environment variable `HARVEST_API_BASE_URL` is set to a non-loopback host. Unset it. |
