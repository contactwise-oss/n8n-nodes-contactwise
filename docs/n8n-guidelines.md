# n8n guidelines this package must meet

A condensed version of n8n's verification guidelines, UX guidelines and code standards, limited to what applies here. For the full text, query the `n8n-docs` MCP server (search "verification guidelines", "UX guidelines", "code standards").

## Verification: hard requirements

- Scaffolded with the n8n-node CLI; TypeScript only.
- **No runtime dependencies.**
- **No environment variables and no file-system access.**
- English only: UI text, error messages and README.
- MIT license and a public GitHub repo; the npm `repository` URL and maintainer must match GitHub.
- Published from **GitHub Actions with npm provenance** (mandatory since May 1, 2026).
- `npm run lint` and `npx @n8n/scan-community-package n8n-nodes-contactwise` pass.
- README covers usage, authentication setup and example workflows.
- Trigger nodes must be programmatic style. Declarative and programmatic nodes can share a package.

## UX rules that apply here

- Secrets (the API key) are password fields.
- **Title Case**: node name, parameter display names, dropdown option names.
- **Sentence case**: operation actions, descriptions, hints, dropdown descriptions.
- Operation naming, for a single resource "SMS" shown above the operation:
  - name: `Send`
  - action: `Send SMS` (no articles)
  - description: explains the operation in different words from the name.
- Boolean descriptions start with "Whether…".
- Placeholders start with `e.g.`.
- Use the glossary below: one term per concept, never mixed with synonyms.
- In copy, refer to parameters in single quotes, e.g. `'To'`.
- **Errors**:
  - The message says what happened. Include the parameter's display name and append `[item N]`.
  - The description says how to fix it.
  - Avoid the words "error", "problem", "failure" and "mistake".
- If output has more than 10 fields, add a `Simplify` parameter. The Send output has about 5 fields, so it doesn't need one.
- Single-item selection should use a Resource Locator defaulting to "From list" (relevant to the Phase 2 dropdowns).

## Project glossary

User-facing display names. `copy-reviewer` enforces these.

| Term | Means | Don't use in the UI |
|---|---|---|
| API Key | ContactWise API key (credential) | token, secret, auth key |
| Tenant ID | ContactWise tenant (credential) | account ID, org ID |
| Default Entity ID | Credential-level fallback DLT entity | PE ID (fine to mention in a description) |
| Sender ID | DLT-registered sender | header, sender name, from |
| To | Recipient mobile number | phone, mobile, recipient number |
| Message | SMS text | body, content, text |
| DLT Template ID | DLT content template ID | template code, template |
| DLT Entity ID | DLT principal entity ID | entity, PE ID |
| Service Type | Transactional / Promotional | route, category |
| Message Type | Auto / Text / Unicode | encoding |
| Flash | Flash SMS | — |
| Custom ID | Caller-supplied reference echoed in delivery reports | reference, external ID |
| Metadata | Up to 10 key/value pairs echoed in delivery reports | tags, attributes |
| Callback URL | Per-message delivery-report URL | webhook, DLR URL |

## Code standards

- n8n prefers declarative style and allows programmatic only when needed. See the node-style decision in `docs/architecture.md`.
- Never mutate `this.getInputData()` items; build new output items.
- Make HTTP calls only through `this.helpers.httpRequest` / `httpRequestWithAuthentication`. The old `this.helpers.request` has been removed.
- When a field means the same thing across operations, reuse its internal parameter name, so values survive when the user switches operation.
- To expose the node to AI Agents, set `usableAsTool: true`.
