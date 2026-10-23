# Babylon security deployment notes

## Required Vercel environment variables
- `FIREBASE_SERVICE_ACCOUNT`: full Firebase service-account JSON.
- `FIREBASE_WEB_API_KEY`: Firebase project's Web API key (used only server-side for username/password verification).
- `GMAIL_USER` and `GMAIL_APP_PASSWORD`: Gmail sender credentials used for account-deletion confirmation and password reset.
- `APP_CHECK_ENFORCE`: keep `false` until the real Firebase App Check site key is configured in `index.html` and all API requests send an App Check token; then set to `true`.

## One-time username migration
Run `node scripts/migrate-usernames.js` in a trusted environment with the Firebase service-account JSON in `FIREBASE_SERVICE_ACCOUNT`. It copies username/email mappings to `usernameLookup` and strips email from public `usernames` documents. Do not expose the service account or put it in the browser.

## Firestore rules changes required
In the existing rules, replace the `/usernames/{name}` match with:

```firestore
match /usernames/{name} {
  allow get: if true;
  allow list: if false;
  // Only Admin SDK endpoints may create/change/delete usernames.
  allow create, update, delete: if false;
}
match /usernameLookup/{name} {
  // Email mappings must never be readable or writable by client SDKs.
  allow read, write: if false;
}
```

In `/wallets/{uid}`, retain the current `allow read` condition, but replace all `allow create` and `allow update` rules with `allow create, update, delete: if false;`. Vercel Admin SDK operations bypass client rules. This is necessary to stop client-side balance edits. Purchases and star gifts implemented in `/api/stars` run with Admin SDK.

The `giftListings` marketplace purchase now runs through `/api/stars` too. Review any additional client-side routes that transfer gift ownership before further tightening sales and gift-document rules. Do not enable `APP_CHECK_ENFORCE=true` until the client has a real App Check site key and sends `X-Firebase-AppCheck` on every API call.

## Account deletion behavior
`/api/account` sends a short-lived six-digit email confirmation code. After confirmation it compacts numbered Plush Pepe and Scared Cat items, clears the deleted account's wallet/private gift records, frees the username/email, and leaves a tombstone user record so old chats still show “حساب محذوف”. Messages and chat documents are retained. Account deletion removes the Firebase Auth identity after server-side cleanup.

Before production, test with a non-production Firebase project and backup Firestore. Account deletion intentionally reindexes numbered inventory and should be tested against any external gift history or cached UI that stores number-based IDs.

## API endpoints added
- `POST /api/auth` — username login via custom token, username claim/rename, and username-based password-reset email.
- `POST /api/stars` — base gift purchase, marketplace listing purchase, gift transfer, and developer star grants.
- `POST /api/account` — email-code account deletion.

For production, add durable rate limiting (for example, Upstash Redis or a Firestore transaction-backed limiter) to public login/reset endpoints; the in-memory limiter is only a lightweight first layer and does not persist across Vercel instances.
