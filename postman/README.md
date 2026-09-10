# Postman Collection

`Regulatory-Licensing-Platform.postman_collection.json` + the matching
`.postman_environment.json` exercise the entire API end to end: submission,
role isolation, officer review, section-scoped resubmission, the full
site-visit clarification loop, approval, and a straight-rejection alternate
path — 43 requests, 74 assertions, verified to pass 100% against a running
instance of this server.

## Import into Postman

1. Start the API: `npm run dev` (or `npm run build && npm start`).
2. Postman → **Import** → select both JSON files in this folder.
3. Pick the **"Regulatory & Licensing Platform - Local"** environment in the
   top-right environment selector.
4. Open the collection → **Run** (Collection Runner), keeping "Save
   responses" on and running requests in order (the folders are numbered
   0–7 and must run top-to-bottom — later requests read variables, like
   `applicationId`, that earlier requests set).

Each request has built-in test assertions (status code + key response
fields), including the security-relevant ones — e.g. a different operator
getting `403` on someone else's application, an officer never seeing the
internal `Route to Approval` label leak into an operator's response, and
the checklist endpoint never returning unflagged items to the operator.

## Import into Insomnia

Insomnia can import Postman v2.1 collections directly: **Application menu
→ Preferences → Data → Import Data → From File**, and select the collection
JSON. Insomnia doesn't consume `.postman_environment.json` the same way —
after import, open the generated environment and fill in the same values
from that file (`baseUrl`, `operatorId`, `officerId`, `intruderOperatorId`;
the rest are populated automatically by the chained requests).

## Run headlessly with Newman (what was used to verify this collection)

```bash
npm install --no-save newman
npx newman run postman/Regulatory-Licensing-Platform.postman_collection.json \
  -e postman/Regulatory-Licensing-Platform.postman_environment.json
```

Expected output: `43/43 requests`, `74/74 assertions`, `0 failed`.
