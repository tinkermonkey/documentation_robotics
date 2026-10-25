# Classification eval report: fastapi (gold@charter)

Generated 2026-10-25T19:03:49.390Z. Cards: 200. Gold labels: 200 from gold@charter.jsonl.

## Gold label distribution

| layer       | n   |
| ----------- | --- |
| none        | 80  |
| ux          | 50  |
| api         | 34  |
| data-model  | 10  |
| data-store  | 8   |
| security    | 6   |
| navigation  | 4   |
| application | 4   |
| technology  | 3   |
| testing     | 1   |

Significance histogram (0..4): 64 / 51 / 46 / 35 / 4. Gold labels with a type id not in the spec: 2.

## Summary

| backend          | n   | layer acc | type acc (end-to-end) | type acc given layer | sig MAE | sig within 1 | layer ECE | median latency | total cost | cost / card |
| ---------------- | --- | --------- | --------------------- | -------------------- | ------- | ------------ | --------- | -------------- | ---------- | ----------- |
| claude-haiku     | 200 | 72.0%     | 63.0%                 | 87.5%                | 0.41    | 99.0%        | 0.084     | 1624 ms        | $0.082     | $0.0004     |
| clef             | 200 | 76.5%     | 67.5%                 | 88.2%                | 0.54    | 88.0%        | 0.220     | 696 ms         | $0.197     | $0.0010     |
| clef-flash       | 200 | 78.5%     | 60.5%                 | 77.1%                | 0.75    | 69.0%        | 0.332     | 1190 ms        | $0.072     | $0.0004     |
| clef@enriched-v1 | 200 | 76.5%     | 67.5%                 | 88.2%                | 0.54    | 88.0%        | 0.220     | 755 ms         | $0.202     | $0.0010     |
| claude-sonnet    | 200 | 72.5%     | 60.5%                 | 83.4%                | 0.41    | 98.5%        | 0.094     | 1707 ms        | $1.478     | $0.0074     |

Type accuracy is exact match on the element type id. ECE = expected calibration error of the predicted layer's confidence (lower is better). Costs use list prices; Claude costs include cache reads at 0.1x.

## claude-haiku

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 80     | 53.8%  | 50          |
| ux          | 50     | 82.0%  | 67          |
| api         | 34     | 97.1%  | 43          |
| data-model  | 10     | 90.0%  | 10          |
| data-store  | 8      | 100.0% | 8           |
| security    | 6      | 66.7%  | 4           |
| application | 4      | 75.0%  | 9           |
| navigation  | 4      | 25.0%  | 4           |
| technology  | 3      | 33.3%  | 2           |
| testing     | 1      | 100.0% | 1           |
| product     | 0      | n/a    | 2           |

### Top confusions (layer)

| gold → predicted       | count |
| ---------------------- | ----- |
| none → ux              | 24    |
| none → api             | 9     |
| ux → none              | 5     |
| none → navigation      | 2     |
| navigation → ux        | 2     |
| security → application | 2     |
| ux → product           | 2     |
| none → application     | 2     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.0-0.1        | 1   | 0.08      | 0.00     | -0.08 |
| 0.1-0.2        | 1   | 0.10      | 0.00     | -0.10 |
| 0.3-0.4        | 10  | 0.34      | 0.20     | -0.14 |
| 0.4-0.5        | 6   | 0.45      | 0.17     | -0.28 |
| 0.5-0.6        | 21  | 0.52      | 0.52     | 0.00  |
| 0.6-0.7        | 59  | 0.60      | 0.66     | 0.06  |
| 0.7-0.8        | 18  | 0.71      | 0.89     | 0.18  |
| 0.8-0.9        | 76  | 0.81      | 0.89     | 0.08  |
| 0.9-1.0        | 8   | 0.90      | 0.88     | -0.03 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 91.0%    | 77.5%             |
| ≥0.60     | 80.5%    | 80.7%             |
| ≥0.70     | 51.0%    | 89.2%             |
| ≥0.80     | 42.0%    | 89.3%             |
| ≥0.90     | 4.0%     | 87.5%             |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 21             | 0.49      | 0.86   | 0.62       |
| authorization        | 9              | 0.80      | 0.89   | 0.84       |
| data_persistence     | 30             | 0.87      | 0.87   | 0.87       |
| external_integration | 20             | 0.53      | 0.90   | 0.67       |
| observability        | 2              | 1.00      | 0.50   | 0.67       |
| user_interface       | 68             | 0.78      | 0.99   | 0.87       |

### Sample layer disagreements

| symbol                                                                       | gold                    | predicted (conf)                  | gold rationale                                                                                                                                                     |
| ---------------------------------------------------------------------------- | ----------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Class backend.app.core.config.Settings                                       | application/dataobject  | technology/systemsoftware (0.35)  | A pydantic BaseSettings class that holds the application's central configuration: API prefix, secret key, database DSN, SMTP, Sentry and superuser settings. Its   |
| Interface frontend.src.routeTree.gen.RootRouteChildren                       | none/-                  | navigation/navigationgraph (0.45) | Generated TanStack Router type in routeTree.gen.ts that lists the root route's children for type checking. It is generated boilerplate and not itself a navigati   |
| Method frontend.src.client.sdk.gen.LoginService.testToken                    | none/-                  | api/operation (0.60)              | This is a generated OpenAPI client stub (sdk.gen.ts) that wraps POST /api/v1/login/test-token. Generated boilerplate is not an element; the operation itself wou   |
| Interface frontend.src.components.Admin.DeleteUser.DeleteUserProps           | none/-                  | ux/componentinstance (0.50)       | A props type for the DeleteUser component, holding only an id and a success callback. It is a minor detail of that UI component rather than an element in its ow   |
| Function frontend.src.routes.\_\_root.component                              | navigation/route        | ux/view (0.60)                    | The root route component in TanStack Router's \_\_root.tsx is the top-level layout that renders an Outlet for child routes, plus head content and devtools. As the |
| Interface frontend.src.components.Items.ItemActionsMenu.ItemActionsMenuProps | none/-                  | ux/componentinstance (0.50)       | A trivial props interface for the ItemActionsMenu component, with a single field holding an ItemPublic. It is component scaffolding that would be captured as at   |
| Class backend.app.models.Token                                               | data-model/objectschema | api/schema (0.50)                 | A non-table SQLModel schema defining the JSON payload returned by the login access-token route (access_token, token_type). It is a passive data shape, so it is    |
| Function frontend.src.components.ui.tooltip.TooltipProvider                  | none/-                  | ux/librarycomponent (0.70)        | Thin shadcn/ui wrapper around the Radix Tooltip Provider that only sets a default delay. It is generated-style UI boilerplate, not an architectural element. Its   |
| Function frontend.src.hooks.useCustomToast.showSuccessToast                  | none/-                  | ux/actioncomponent (0.35)         | Trivial inner wrapper inside the useCustomToast hook that delegates to toast.success with a fixed title. Widely called, but it is a UI feedback helper below mod   |
| Method frontend.src.client.sdk.gen.ItemsService.deleteItem                   | none/-                  | api/operation (0.45)              | Generated OpenAPI client stub method (sdk.gen.ts) wrapping a DELETE /api/v1/items/{id} call. As generated code, it is not an architectural element in its own ri   |

## clef

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 80     | 70.0%  | 69          |
| ux          | 50     | 88.0%  | 63          |
| api         | 34     | 85.3%  | 29          |
| data-model  | 10     | 100.0% | 14          |
| data-store  | 8      | 50.0%  | 4           |
| security    | 6      | 50.0%  | 3           |
| application | 4      | 75.0%  | 7           |
| navigation  | 4      | 75.0%  | 10          |
| technology  | 3      | 0.0%   | 0           |
| testing     | 1      | 100.0% | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → ux                | 19    |
| none → navigation        | 5     |
| api → none               | 4     |
| ux → none                | 3     |
| security → none          | 3     |
| data-store → data-model  | 2     |
| ux → navigation          | 2     |
| data-store → application | 2     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 4   | 0.28      | 0.50     | 0.22 |
| 0.3-0.4        | 19  | 0.36      | 0.42     | 0.06 |
| 0.4-0.5        | 47  | 0.46      | 0.57     | 0.12 |
| 0.5-0.6        | 56  | 0.54      | 0.79     | 0.24 |
| 0.6-0.7        | 59  | 0.65      | 0.97     | 0.32 |
| 0.7-0.8        | 13  | 0.73      | 1.00     | 0.27 |
| 0.8-0.9        | 2   | 0.81      | 1.00     | 0.19 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.0%    | 89.2%             |
| ≥0.60     | 37.0%    | 97.3%             |
| ≥0.70     | 7.5%     | 100.0%            |
| ≥0.80     | 1.0%     | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 21             | 0.90      | 0.43   | 0.58       |
| authorization        | 9              | 1.00      | 0.44   | 0.62       |
| data_persistence     | 30             | 0.93      | 0.43   | 0.59       |
| external_integration | 20             | 0.92      | 0.55   | 0.69       |
| observability        | 2              | n/a       | 0.00   | n/a        |
| user_interface       | 68             | 0.92      | 0.96   | 0.94       |

### Sample layer disagreements

| symbol                                                                       | gold                  | predicted (conf)                  | gold rationale                                                                                                                                                   |
| ---------------------------------------------------------------------------- | --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface frontend.src.components.Admin.DeleteUser.DeleteUserProps           | none/-                | ux/- (0.41)                       | A props type for the DeleteUser component, holding only an id and a success callback. It is a minor detail of that UI component rather than an element in its ow |
| Class backend.app.models.User                                                | data-store/collection | data-model/- (0.55)               | SQLModel class with table=True defines the persisted user table: primary key, hashed password and creation timestamp columns, plus a cascade-delete relationship |
| Method frontend.src.client.sdk.gen.LoginService.loginAccessToken             | api/operation         | none/- (0.49)                     | Generated API client stub for the POST /api/v1/login/access-token OAuth2 token operation. It is evidence of an API operation consumed by the frontend and is use |
| Interface frontend.src.components.Items.ItemActionsMenu.ItemActionsMenuProps | none/-                | ux/- (0.39)                       | A trivial props interface for the ItemActionsMenu component, with a single field holding an ItemPublic. It is component scaffolding that would be captured as at |
| Method frontend.src.client.sdk.gen.UsersService.updateUserMe                 | api/operation         | none/- (0.58)                     | Generated SDK client method wrapping the PATCH /api/v1/users/me operation. It is evidence for an API operation, but it is generated boilerplate in a client stub |
| Function frontend.src.components.ui.tooltip.TooltipProvider                  | none/-                | ux/librarycomponent (0.52)        | Thin shadcn/ui wrapper around the Radix Tooltip Provider that only sets a default delay. It is generated-style UI boilerplate, not an architectural element. Its |
| Interface frontend.src.components.Common.Logo.LogoProps                      | none/-                | ux/librarycomponent (0.51)        | A props type declaration for the Logo UI component. It is a typing detail of that component, not an element in its own right. Any props would be attributes of t |
| Method frontend.src.client.sdk.gen.ItemsService.createItem                   | api/operation         | none/- (0.52)                     | A generated SDK client method that binds the POST /api/v1/items/ operation, with a bearer security requirement and typed request and response. Generated API cli |
| Interface frontend.src.routeTree.gen.FileRoutesByTo                          | none/-                | navigation/navigationgraph (0.49) | Generated TanStack Router type map (routeTree.gen.ts) that keys route paths to route types for type-safe navigation. It is generated boilerplate. The routes the |
| Class backend.app.api.routes.private.PrivateUserCreate                       | api/schema            | data-model/objectschema (0.44)    | A Pydantic request-body model defined inline in the private API routes module. It describes the input shape of the private user-creation endpoint, so it is best |

## clef-flash

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 80     | 80.0%  | 76          |
| ux          | 50     | 86.0%  | 50          |
| api         | 34     | 85.3%  | 29          |
| data-model  | 10     | 100.0% | 13          |
| data-store  | 8      | 37.5%  | 3           |
| security    | 6      | 0.0%   | 0           |
| navigation  | 4      | 75.0%  | 11          |
| application | 4      | 100.0% | 17          |
| technology  | 3      | 0.0%   | 0           |
| testing     | 1      | 100.0% | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → ux                | 7     |
| none → navigation        | 6     |
| api → none               | 4     |
| security → application   | 4     |
| ux → none                | 3     |
| none → application       | 3     |
| data-store → application | 3     |
| data-store → data-model  | 2     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 9   | 0.28      | 0.67     | 0.39 |
| 0.3-0.4        | 58  | 0.35      | 0.67     | 0.32 |
| 0.4-0.5        | 67  | 0.45      | 0.72     | 0.27 |
| 0.5-0.6        | 46  | 0.54      | 0.96     | 0.41 |
| 0.6-0.7        | 18  | 0.62      | 1.00     | 0.38 |
| 0.7-0.8        | 2   | 0.71      | 1.00     | 0.29 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 33.0%    | 97.0%             |
| ≥0.60     | 10.0%    | 100.0%            |
| ≥0.70     | 1.0%     | 100.0%            |
| ≥0.80     | 0.0%     | n/a               |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 21             | 1.00      | 0.24   | 0.38       |
| authorization        | 9              | n/a       | 0.00   | n/a        |
| data_persistence     | 30             | 1.00      | 0.40   | 0.57       |
| external_integration | 20             | 1.00      | 0.60   | 0.75       |
| observability        | 2              | n/a       | 0.00   | n/a        |
| user_interface       | 68             | 0.97      | 0.91   | 0.94       |

### Sample layer disagreements

| symbol                                                           | gold                  | predicted (conf)                  | gold rationale                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface frontend.src.routeTree.gen.RootRouteChildren           | none/-                | navigation/navigationgraph (0.49) | Generated TanStack Router type in routeTree.gen.ts that lists the root route's children for type checking. It is generated boilerplate and not itself a navigati |
| Class backend.app.models.User                                    | data-store/collection | data-model/- (0.49)               | SQLModel class with table=True defines the persisted user table: primary key, hashed password and creation timestamp columns, plus a cascade-delete relationship |
| Method frontend.src.client.sdk.gen.LoginService.loginAccessToken | api/operation         | none/- (0.35)                     | Generated API client stub for the POST /api/v1/login/access-token OAuth2 token operation. It is evidence of an API operation consumed by the frontend and is use |
| Method frontend.src.client.sdk.gen.UsersService.updateUserMe     | api/operation         | none/- (0.36)                     | Generated SDK client method wrapping the PATCH /api/v1/users/me operation. It is evidence for an API operation, but it is generated boilerplate in a client stub |
| Method frontend.src.client.sdk.gen.ItemsService.createItem       | api/operation         | none/- (0.34)                     | A generated SDK client method that binds the POST /api/v1/items/ operation, with a bearer security requirement and typed request and response. Generated API cli |
| Function frontend.src.components.ui.skeleton.Skeleton            | ux/librarycomponent   | none/- (0.43)                     | A shadcn-style reusable UI primitive that renders a pulsing placeholder div. It is a library component in the UI kit, but it is trivial and generic, with a sing |
| Interface frontend.src.routeTree.gen.FileRoutesByTo              | none/-                | navigation/navigationgraph (0.46) | Generated TanStack Router type map (routeTree.gen.ts) that keys route paths to route types for type-safe navigation. It is generated boilerplate. The routes the |
| Class backend.app.api.routes.private.PrivateUserCreate           | api/schema            | data-model/objectschema (0.36)    | A Pydantic request-body model defined inline in the private API routes module. It describes the input shape of the private user-creation endpoint, so it is best |
| Interface frontend.src.routeTree.gen.FileRoutesByPath            | none/-                | navigation/navigationgraph (0.44) | This is a TanStack Router module-augmentation interface in the generated routeTree.gen.ts file. It only provides type mappings for routes; the routes themselves |
| Method frontend.src.client.sdk.gen.UsersService.readUsers        | api/operation         | none/- (0.36)                     | Generated client method binding the GET /api/v1/users/ operation, with a bearer security requirement. It is evidence of the 'read users' API operation consumed  |

## clef@enriched-v1

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 80     | 70.0%  | 69          |
| ux          | 50     | 88.0%  | 63          |
| api         | 34     | 85.3%  | 29          |
| data-model  | 10     | 100.0% | 14          |
| data-store  | 8      | 50.0%  | 4           |
| security    | 6      | 50.0%  | 3           |
| application | 4      | 75.0%  | 7           |
| navigation  | 4      | 75.0%  | 10          |
| technology  | 3      | 0.0%   | 0           |
| testing     | 1      | 100.0% | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → ux                | 19    |
| none → navigation        | 5     |
| api → none               | 4     |
| ux → none                | 3     |
| security → none          | 3     |
| data-store → data-model  | 2     |
| ux → navigation          | 2     |
| data-store → application | 2     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 4   | 0.28      | 0.50     | 0.22 |
| 0.3-0.4        | 19  | 0.36      | 0.42     | 0.06 |
| 0.4-0.5        | 47  | 0.46      | 0.57     | 0.12 |
| 0.5-0.6        | 56  | 0.54      | 0.79     | 0.24 |
| 0.6-0.7        | 59  | 0.65      | 0.97     | 0.32 |
| 0.7-0.8        | 13  | 0.73      | 1.00     | 0.27 |
| 0.8-0.9        | 2   | 0.81      | 1.00     | 0.19 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.0%    | 89.2%             |
| ≥0.60     | 37.0%    | 97.3%             |
| ≥0.70     | 7.5%     | 100.0%            |
| ≥0.80     | 1.0%     | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 21             | 0.90      | 0.43   | 0.58       |
| authorization        | 9              | 1.00      | 0.44   | 0.62       |
| data_persistence     | 30             | 0.93      | 0.43   | 0.59       |
| external_integration | 20             | 0.92      | 0.55   | 0.69       |
| observability        | 2              | n/a       | 0.00   | n/a        |
| user_interface       | 68             | 0.92      | 0.96   | 0.94       |

### Sample layer disagreements

| symbol                                                                       | gold                  | predicted (conf)                  | gold rationale                                                                                                                                                   |
| ---------------------------------------------------------------------------- | --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class backend.app.models.User                                                | data-store/collection | data-model/- (0.55)               | SQLModel class with table=True defines the persisted user table: primary key, hashed password and creation timestamp columns, plus a cascade-delete relationship |
| Interface frontend.src.components.Admin.DeleteUser.DeleteUserProps           | none/-                | ux/- (0.41)                       | A props type for the DeleteUser component, holding only an id and a success callback. It is a minor detail of that UI component rather than an element in its ow |
| Interface frontend.src.components.Items.ItemActionsMenu.ItemActionsMenuProps | none/-                | ux/- (0.39)                       | A trivial props interface for the ItemActionsMenu component, with a single field holding an ItemPublic. It is component scaffolding that would be captured as at |
| Method frontend.src.client.sdk.gen.LoginService.loginAccessToken             | api/operation         | none/- (0.49)                     | Generated API client stub for the POST /api/v1/login/access-token OAuth2 token operation. It is evidence of an API operation consumed by the frontend and is use |
| Function frontend.src.components.ui.tooltip.TooltipProvider                  | none/-                | ux/librarycomponent (0.52)        | Thin shadcn/ui wrapper around the Radix Tooltip Provider that only sets a default delay. It is generated-style UI boilerplate, not an architectural element. Its |
| Method frontend.src.client.sdk.gen.UsersService.updateUserMe                 | api/operation         | none/- (0.58)                     | Generated SDK client method wrapping the PATCH /api/v1/users/me operation. It is evidence for an API operation, but it is generated boilerplate in a client stub |
| Method frontend.src.client.sdk.gen.ItemsService.createItem                   | api/operation         | none/- (0.52)                     | A generated SDK client method that binds the POST /api/v1/items/ operation, with a bearer security requirement and typed request and response. Generated API cli |
| Interface frontend.src.components.Common.Logo.LogoProps                      | none/-                | ux/librarycomponent (0.51)        | A props type declaration for the Logo UI component. It is a typing detail of that component, not an element in its own right. Any props would be attributes of t |
| Interface frontend.src.routeTree.gen.FileRoutesByTo                          | none/-                | navigation/navigationgraph (0.49) | Generated TanStack Router type map (routeTree.gen.ts) that keys route paths to route types for type-safe navigation. It is generated boilerplate. The routes the |
| Class backend.app.api.routes.private.PrivateUserCreate                       | api/schema            | data-model/objectschema (0.44)    | A Pydantic request-body model defined inline in the private API routes module. It describes the input shape of the private user-creation endpoint, so it is best |

## claude-sonnet

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 80     | 40.0%  | 32          |
| ux          | 50     | 94.0%  | 69          |
| api         | 34     | 97.1%  | 48          |
| data-model  | 10     | 100.0% | 11          |
| data-store  | 8      | 100.0% | 9           |
| security    | 6      | 100.0% | 7           |
| application | 4      | 100.0% | 11          |
| navigation  | 4      | 75.0%  | 11          |
| technology  | 3      | 33.3%  | 1           |
| testing     | 1      | 100.0% | 1           |

### Top confusions (layer)

| gold → predicted   | count |
| ------------------ | ----- |
| none → ux          | 21    |
| none → api         | 14    |
| none → navigation  | 6     |
| none → application | 5     |
| ux → navigation    | 2     |
| none → security    | 1     |
| api → data-model   | 1     |
| ux → application   | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.3-0.4        | 3   | 0.33      | 0.00     | -0.33 |
| 0.4-0.5        | 14  | 0.40      | 0.29     | -0.12 |
| 0.5-0.6        | 21  | 0.52      | 0.43     | -0.09 |
| 0.6-0.7        | 45  | 0.60      | 0.56     | -0.04 |
| 0.7-0.8        | 20  | 0.71      | 0.75     | 0.04  |
| 0.8-0.9        | 86  | 0.82      | 0.94     | 0.12  |
| 0.9-1.0        | 11  | 0.90      | 1.00     | 0.10  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 91.5%    | 77.0%             |
| ≥0.60     | 81.0%    | 81.5%             |
| ≥0.70     | 58.5%    | 91.5%             |
| ≥0.80     | 48.5%    | 94.8%             |
| ≥0.90     | 5.5%     | 100.0%            |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 21             | 0.70      | 0.76   | 0.73       |
| authorization        | 9              | 1.00      | 0.56   | 0.71       |
| data_persistence     | 30             | 0.91      | 0.67   | 0.77       |
| external_integration | 20             | 0.73      | 0.80   | 0.76       |
| observability        | 2              | n/a       | 0.00   | n/a        |
| user_interface       | 68             | 0.90      | 0.97   | 0.94       |

### Sample layer disagreements

| symbol                                                                       | gold   | predicted (conf)                  | gold rationale                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface frontend.src.routeTree.gen.RootRouteChildren                       | none/- | navigation/navigationgraph (0.60) | Generated TanStack Router type in routeTree.gen.ts that lists the root route's children for type checking. It is generated boilerplate and not itself a navigati |
| Method frontend.src.client.sdk.gen.LoginService.testToken                    | none/- | api/operation (0.55)              | This is a generated OpenAPI client stub (sdk.gen.ts) that wraps POST /api/v1/login/test-token. Generated boilerplate is not an element; the operation itself wou |
| Interface frontend.src.components.Admin.DeleteUser.DeleteUserProps           | none/- | ux/- (0.35)                       | A props type for the DeleteUser component, holding only an id and a success callback. It is a minor detail of that UI component rather than an element in its ow |
| Method backend.app.core.config.Settings.\_check_default_secret               | none/- | security/validationrule (0.50)    | Private validation helper on the Settings config class. It rejects or warns about the default 'changethis' secret values. This is configuration hygiene below mo |
| Module frontend.src.client.client.client.gen                                 | none/- | api/- (0.40)                      | Auto-generated @hey-api/openapi-ts Axios client runtime: generic HTTP request plumbing, not an application-specific element. Generated boilerplate falls under t |
| Interface frontend.src.components.Items.ItemActionsMenu.ItemActionsMenuProps | none/- | ux/componentinstance (0.50)       | A trivial props interface for the ItemActionsMenu component, with a single field holding an ItemPublic. It is component scaffolding that would be captured as at |
| Function frontend.src.components.ui.tooltip.TooltipProvider                  | none/- | ux/librarycomponent (0.80)        | Thin shadcn/ui wrapper around the Radix Tooltip Provider that only sets a default delay. It is generated-style UI boilerplate, not an architectural element. Its |
| Method frontend.src.client.sdk.gen.ItemsService.deleteItem                   | none/- | api/operation (0.60)              | Generated OpenAPI client stub method (sdk.gen.ts) wrapping a DELETE /api/v1/items/{id} call. As generated code, it is not an architectural element in its own ri |
| Function frontend.src.hooks.useCustomToast.showSuccessToast                  | none/- | ux/actionpattern (0.50)           | Trivial inner wrapper inside the useCustomToast hook that delegates to toast.success with a fixed title. Widely called, but it is a UI feedback helper below mod |
| Method frontend.src.client.sdk.gen.UsersService.updateUser                   | none/- | api/operation (0.60)              | Generated OpenAPI client stub method (sdk.gen.ts) wrapping PATCH /api/v1/users/{user_id}. It is generated boilerplate; the operation it calls would be modelled  |
