# Gold diff: fastapi, baseline vs

Cards labelled in both: 200 (A 200, B 200)
Layer agreement: 190/200 (95.0%). Layer+type agreement: 182/200 (91.0%)
Mean significance: baseline 1.34, 1.32

## Layer changes (baseline -> )

| transition                | n   |
| ------------------------- | --- |
| none -> api               | 4   |
| ux -> none                | 3   |
| application -> none       | 1   |
| ux -> navigation          | 1   |
| technology -> application | 1   |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Module    | 1       | 57  |
| Class     | 1       | 15  |
| Interface | 0       | 34  |
| Method    | 4       | 17  |
| Function  | 4       | 58  |
| Route     | 0       | 19  |

## Prediction files scored against each gold (layer acc / type acc)

| backend          | vs baseline   | vs            |
| ---------------- | ------------- | ------------- |
| claude-haiku     | 72.0% / 63.5% | 72.0% / 63.0% |
| claude-sonnet    | 71.5% / 62.0% | 72.5% / 60.5% |
| clef-flash       | 78.5% / 59.5% | 78.5% / 60.5% |
| clef             | 78.5% / 69.5% | 76.5% / 67.5% |
| clef@enriched-v1 | 78.5% / 69.5% | 76.5% / 67.5% |

## Sample of relabelled symbols

| symbol                                                                   | baseline                        |                        | rationale                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Method frontend.src.client.sdk.gen.LoginService.loginAccessToken         | none/-                          | api/operation          | Generated API client stub for the POST /api/v1/login/access-token OAuth2 token operation. It is evidence of an API operation consumed by the frontend  |
| Method frontend.src.client.sdk.gen.ItemsService.createItem               | none/-                          | api/operation          | A generated SDK client method that binds the POST /api/v1/items/ operation, with a bearer security requirement and typed request and response. Generat |
| Function backend.app.utils.render_email_template                         | application/applicationfunction | none/-                 | A small utility that reads an email template file bundled with the code and renders it with Jinja. Its only callers are the email-generation helpers.  |
| Function frontend.src.components.ui.tooltip.TooltipProvider              | ux/librarycomponent             | none/-                 | Thin shadcn/ui wrapper around the Radix Tooltip Provider that only sets a default delay. It is generated-style UI boilerplate, not an architectural el |
| Function frontend.src.components.ui.dropdown-menu.DropdownMenuSubContent | ux/librarycomponent             | none/-                 | A shadcn/ui-style styling wrapper around a Radix dropdown sub-content primitive. It is generated-style boilerplate within a UI kit file and has no cal |
| Method frontend.src.client.sdk.gen.UsersService.updateUserMe             | none/-                          | api/operation          | Generated SDK client method wrapping the PATCH /api/v1/users/me operation. It is evidence for an API operation, but it is generated boilerplate in a c |
| Module frontend.src.routes.recover-password                              | ux/view                         | navigation/route       | A TanStack file-route module defining the /recover-password route, with a beforeLoad redirect when logged in, and a page component rendering the recov |
| Method frontend.src.client.sdk.gen.UsersService.readUsers                | none/-                          | api/operation          | Generated client method binding the GET /api/v1/users/ operation, with a bearer security requirement. It is evidence of the 'read users' API operation |
| Function frontend.src.components.ui.dropdown-menu.DropdownMenuShortcut   | ux/librarycomponent             | none/-                 | This is a shadcn/ui-style generated primitive: a styled span wrapper for a dropdown menu shortcut label. It has no callers, no logic and no applicatio |
| Class backend.app.core.config.Settings                                   | technology/artifact             | application/dataobject | A pydantic BaseSettings class that holds the application's central configuration: API prefix, secret key, database DSN, SMTP, Sentry and superuser set |
