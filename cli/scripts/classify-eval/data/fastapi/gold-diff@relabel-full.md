# Gold diff: fastapi, baseline vs relabel-full

Cards labelled in both: 200 (A 200, B 200)
Layer agreement: 183/200 (91.5%). Layer+type agreement: 171/200 (85.5%)
Mean significance: baseline 1.32, relabel-full 1.35

## Layer changes (baseline -> relabel-full)

| transition                | n   |
| ------------------------- | --- |
| none -> api               | 8   |
| application -> api        | 6   |
| navigation -> ux          | 1   |
| technology -> application | 1   |
| ux -> none                | 1   |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Interface | 0       | 34  |
| Module    | 1       | 57  |
| Class     | 0       | 15  |
| Function  | 8       | 58  |
| Route     | 0       | 19  |
| Method    | 8       | 17  |

## Prediction files scored against each gold (layer acc / type acc)

| backend                                        | vs baseline   | vs relabel-full |
| ---------------------------------------------- | ------------- | --------------- |
| claude-haiku                                   | 68.0% / 59.0% | 75.5% / 66.5%   |
| claude-sonnet                                  | 68.5% / 56.5% | 75.0% / 66.5%   |
| clef-flash                                     | 76.5% / 57.5% | 75.0% / 56.0%   |
| clef                                           | 74.5% / 64.5% | 73.0% / 63.0%   |
| clef@cbm010-kind-base                          | 76.5% / 69.0% | 75.0% / 69.0%   |
| clef@cbm010-kind-tier0                         | 86.0% / 79.0% | 79.0% / 73.0%   |
| clef@cbm012-kind-base                          | 74.0% / 66.5% | 72.5% / 66.0%   |
| clef@cbm012-kind-tier0-qset2-spec012-layercrit | 86.5% / 80.5% | 79.0% / 74.0%   |
| clef@cbm012-kind-tier0-qset2-spec012           | 79.5% / 74.5% | 71.5% / 68.0%   |
| clef@cbm012-kind-tier0-qset2                   | 87.5% / 80.5% | 80.0% / 74.0%   |
| clef@cbm012-kind-tier0                         | 86.5% / 79.0% | 79.0% / 72.5%   |
| clef@diag-spec012-norules                      | 86.5% / 80.5% | 79.0% / 74.0%   |
| clef@enriched-v1                               | 74.5% / 64.5% | 73.0% / 63.0%   |
| clef@enriched-v2-kind                          | 74.5% / 65.5% | 73.0% / 64.5%   |
| clef@enriched-v2                               | 74.5% / 65.0% | 73.0% / 64.0%   |
| clef@v2-kind-base                              | 74.5% / 67.0% | 73.0% / 66.0%   |
| clef@v2-kind-core                              | 74.5% / 66.0% | 73.0% / 65.0%   |
| clef@v2-kind-tier0-facts-core                  | 86.0% / 79.0% | 78.5% / 71.5%   |
| clef@v2-kind-tier0-facts                       | 86.0% / 79.0% | 78.5% / 73.0%   |
| clef@v2-kind-tier0                             | 85.0% / 78.5% | 78.0% / 72.0%   |

## Sample of relabelled symbols

| symbol                                                          | baseline                        | relabel-full                     | relabel-full rationale                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Function backend.app.api.routes.login.recover_password          | application/applicationfunction | api/operation                    | FastAPI route handler for POST /password-recovery/{email}, which makes it an API operation. It is part of the credential-recovery flow: it issues a pa |
| Function backend.app.api.routes.login.test_token                | application/applicationfunction | api/operation                    | FastAPI route handler for POST /login/test-token. It is an API operation that validates the bearer token through the CurrentUser dependency and return |
| Method frontend.src.client.sdk.gen.PrivateService.createUser    | none/-                          | api/operation                    | This is a generated SDK client method bound to POST /api/v1/private/users/, and the spec counts generated client methods tied to a distinct method and |
| Function frontend.src.routes.\_\_root.component                 | navigation/route                | ux/view                          | This is the root route's render function in TanStack Router. It acts as the application page shell, rendering head content, the router Outlet and deve |
| Method frontend.src.client.sdk.gen.UsersService.deleteUserMe    | none/-                          | api/operation                    | A generated API client method bound to DELETE /api/v1/users/me. The spec treats each generated client method on a distinct method and path as evidence |
| Module backend.app.core.config                                  | technology/artifact             | application/applicationcomponent | This is the central application configuration module. It loads environment settings through pydantic-settings and exposes a singleton used across the  |
| Function backend.app.api.routes.users.update_password_me        | application/applicationfunction | api/operation                    | FastAPI route handler for PATCH /me/password, an HTTP operation contract. It verifies the current password credential and hashes the new one, so it im |
| Method frontend.src.client.sdk.gen.UsersService.updateUser      | none/-                          | api/operation                    | Generated SDK client method bound to PATCH /api/v1/users/{user_id}. Per the API layer definition, a generated client method tied to one method-path pa |
| Function backend.app.api.routes.items.update_item               | application/applicationfunction | api/operation                    | FastAPI route handler for PUT /items/{id}, an HTTP operation contract. It performs an inline ownership/superuser permission check (authorization) and  |
| Method frontend.src.client.sdk.gen.LoginService.recoverPassword | none/-                          | api/operation                    | A generated client method bound to POST /api/v1/password-recovery/{email}. The spec counts each generated client method on a distinct method and path  |
| Function frontend.src.components.ui.dialog.DialogFooter         | ux/librarycomponent             | none/-                           | A shadcn-style styled div wrapper for a dialog footer. It is generated boilerplate design-system scaffolding with no props schema or behaviour of its  |
| Method frontend.src.client.sdk.gen.UsersService.readUserMe      | none/-                          | api/operation                    | Generated client method bound to GET /api/v1/users/me with a bearer security requirement. Per the api layer rules it is evidence for that operation. I |
