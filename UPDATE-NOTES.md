# Photo zoom update

Open a saved pledge and tap **Customer photo** or **Ornament / item photo** above the receipt. The viewer supports + / −, Fit, mouse wheel, dragging and touch pinch gestures. It displays only the selected photo. Existing pledges use the same viewer immediately; their photos do not need to be retaken or resaved.

## Deploying the update

- Deploy the files in this project root. The `deploy/` directory and ZIP are older copies and have not been updated.
- Keep the existing production URL and Google OAuth client. Browser data belongs to that URL; a new Vercel preview URL has separate local storage.
- The IndexedDB name (`ga_pledge_db`), database version, pledge IDs and photo fields are unchanged. Updating app assets does not clear pledge data.
- The service-worker cache version is now `ga-pledge-v11`. Future updates can refresh an open app when it is not editing a form or saving. Users coming directly from the previous version may need to reopen the app once after its new service worker installs, because that previous JavaScript did not include the update listener.

## Existing Google Drive data

The first successful authorized sync in this version checks all per-pledge files, even if the previous download checkpoint was ahead of older files. It also checks legacy single-file backups and merges missing records by their existing sync IDs. Current per-pledge files take precedence over legacy backups. Failed restores retry without marking the restore complete, and uploads no longer advance the download checkpoint. Viewing or zooming a photo does not write to pledge records.

Sync still starts on app opening, returning to the app and reconnecting to the internet. Offline records remain available on the device. This update cannot bypass Google's authorization: expired or revoked access, or a browser-blocked authorization popup, can require **Settings → Sync / Reconnect**. The current app uses Google's browser token model, which does not provide a permanent refresh token. See [Google's token-model documentation](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Verification

Run `node --test tests/sync.test.cjs` for the isolated sync regression suite. It uses mock Drive responses and in-memory records, without touching a real account. Browser checks additionally cover old/new pledges, photo controls, mobile gestures, printing and sharing. Receipt images are compared with the previous version. A real production Google sign-in still needs to be checked on the deployed URL.
