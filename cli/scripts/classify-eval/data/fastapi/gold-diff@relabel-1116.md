# Gold diff: fastapi, baseline vs relabel-1116

Cards labelled in both: 17 (A 200, B 17)
Layer agreement: 14/17 (82.4%). Layer+type agreement: 13/17 (76.5%)
Mean significance: baseline 1.65, relabel-1116 1.65

## Layer changes (baseline -> relabel-1116)

| transition         | n   |
| ------------------ | --- |
| navigation -> ux   | 1   |
| application -> api | 1   |
| none -> api        | 1   |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Route     | 0       | 2   |
| Function  | 2       | 3   |
| Method    | 1       | 3   |
| Class     | 0       | 3   |
| Interface | 0       | 3   |
| Module    | 0       | 3   |

## Prediction files scored against each gold (layer acc / type acc)

| backend                                        | vs baseline   | vs relabel-1116 |
| ---------------------------------------------- | ------------- | --------------- |
| claude-haiku                                   | 68.0% / 59.0% | 64.7% / 52.9%   |
| claude-sonnet                                  | 68.5% / 56.5% | 58.8% / 52.9%   |
| clef-flash                                     | 76.5% / 57.5% | 76.5% / 52.9%   |
| clef                                           | 74.5% / 64.5% | 70.6% / 58.8%   |
| clef@cbm010-kind-base                          | 76.5% / 69.0% | 70.6% / 64.7%   |
| clef@cbm010-kind-tier0                         | 86.0% / 79.0% | 76.5% / 70.6%   |
| clef@cbm012-kind-base                          | 74.0% / 66.5% | 64.7% / 58.8%   |
| clef@cbm012-kind-tier0-qset2-spec012-layercrit | 86.5% / 80.5% | 76.5% / 70.6%   |
| clef@cbm012-kind-tier0-qset2-spec012           | 79.5% / 74.5% | 76.5% / 70.6%   |
| clef@cbm012-kind-tier0-qset2                   | 87.5% / 80.5% | 76.5% / 70.6%   |
| clef@cbm012-kind-tier0                         | 86.5% / 79.0% | 76.5% / 70.6%   |
| clef@diag-spec012-norules                      | 86.5% / 80.5% | 76.5% / 70.6%   |
| clef@enriched-v1                               | 74.5% / 64.5% | 70.6% / 58.8%   |
| clef@enriched-v2-kind                          | 74.5% / 65.5% | 70.6% / 58.8%   |
| clef@enriched-v2                               | 74.5% / 65.0% | 70.6% / 58.8%   |
| clef@v2-kind-base                              | 74.5% / 67.0% | 70.6% / 58.8%   |
| clef@v2-kind-core                              | 74.5% / 66.0% | 70.6% / 58.8%   |
| clef@v2-kind-tier0-facts-core                  | 86.0% / 79.0% | 76.5% / 70.6%   |
| clef@v2-kind-tier0-facts                       | 86.0% / 79.0% | 76.5% / 70.6%   |
| clef@v2-kind-tier0                             | 85.0% / 78.5% | 76.5% / 70.6%   |

## Sample of relabelled symbols

| symbol                                                    | baseline                        | relabel-1116  | relabel-1116 rationale                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Function frontend.src.routes.\_\_root.component           | navigation/route                | ux/view       | The root route's layout component in TanStack Router renders HeadContent, the Outlet for child routes, and devtools. Per the spec, a page shell that r |
| Function backend.app.api.routes.users.update_password_me  | application/applicationfunction | api/operation | HTTP route handler for PATCH /me/password, so it is an API operation. It verifies the current password credential and hashes the new one (authenticati |
| Method frontend.src.client.sdk.gen.LoginService.testToken | none/-                          | api/operation | A generated API client method bound to POST /api/v1/login/test-token with a bearer security scheme. Per the API layer definition, each generated clien |
