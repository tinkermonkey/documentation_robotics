# Classification eval report: fastapi

Generated 2026-10-25T11:28:27.582Z. Cards: 200. Gold labels: 200.

## Gold label distribution

| layer       | n   |
| ----------- | --- |
| none        | 80  |
| ux          | 54  |
| api         | 30  |
| data-model  | 10  |
| data-store  | 8   |
| security    | 6   |
| application | 4   |
| technology  | 4   |
| navigation  | 3   |
| testing     | 1   |

Significance histogram (0..4): 56 / 62 / 43 / 35 / 4. Gold labels with a type id not in the spec: 0.

## Summary

| backend          | n   | layer acc | type acc (end-to-end) | type acc given layer | sig MAE | sig within 1 | layer ECE | median latency | total cost | cost / card |
| ---------------- | --- | --------- | --------------------- | -------------------- | ------- | ------------ | --------- | -------------- | ---------- | ----------- |
| claude-haiku     | 200 | 72.0%     | 63.5%                 | 88.2%                | 0.41    | 99.0%        | 0.103     | 1624 ms        | $0.082     | $0.0004     |
| clef             | 200 | 78.5%     | 69.5%                 | 88.5%                | 0.49    | 91.5%        | 0.240     | 696 ms         | $0.197     | $0.0010     |
| clef-flash       | 200 | 78.5%     | 59.5%                 | 75.8%                | 0.73    | 70.5%        | 0.332     | 1190 ms        | $0.072     | $0.0004     |
| clef@enriched-v1 | 200 | 78.5%     | 69.5%                 | 88.5%                | 0.49    | 91.5%        | 0.240     | 755 ms         | $0.202     | $0.0010     |
| claude-sonnet    | 200 | 71.5%     | 62.0%                 | 86.7%                | 0.37    | 99.5%        | 0.144     | 1707 ms        | $1.478     | $0.0074     |

Type accuracy is exact match on the element type id. ECE = expected calibration error of the predicted layer's confidence (lower is better). Costs use list prices; Claude costs include cache reads at 0.1x.

## claude-haiku

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 80     | 53.8%  | 50          |
| ux          | 54     | 81.5%  | 67          |
| api         | 30     | 96.7%  | 43          |
| data-model  | 10     | 90.0%  | 10          |
| data-store  | 8      | 100.0% | 8           |
| security    | 6      | 66.7%  | 4           |
| technology  | 4      | 50.0%  | 2           |
| application | 4      | 100.0% | 9           |
| navigation  | 3      | 0.0%   | 4           |
| testing     | 1      | 100.0% | 1           |
| product     | 0      | n/a    | 2           |

### Top confusions (layer)

| gold → predicted       | count |
| ---------------------- | ----- |
| none → ux              | 21    |
| none → api             | 13    |
| ux → none              | 5     |
| none → navigation      | 2     |
| navigation → ux        | 2     |
| ux → navigation        | 2     |
| security → application | 2     |
| ux → product           | 2     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.0-0.1        | 1   | 0.08      | 0.00     | -0.08 |
| 0.1-0.2        | 1   | 0.10      | 0.00     | -0.10 |
| 0.3-0.4        | 10  | 0.34      | 0.30     | -0.04 |
| 0.4-0.5        | 6   | 0.45      | 0.17     | -0.28 |
| 0.5-0.6        | 21  | 0.52      | 0.38     | -0.14 |
| 0.6-0.7        | 59  | 0.60      | 0.66     | 0.06  |
| 0.7-0.8        | 18  | 0.71      | 0.94     | 0.24  |
| 0.8-0.9        | 76  | 0.81      | 0.91     | 0.10  |
| 0.9-1.0        | 8   | 0.90      | 0.88     | -0.03 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 91.0%    | 76.9%             |
| ≥0.60     | 80.5%    | 82.0%             |
| ≥0.70     | 51.0%    | 91.2%             |
| ≥0.80     | 42.0%    | 90.5%             |
| ≥0.90     | 4.0%     | 87.5%             |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 24             | 0.54      | 0.83   | 0.66       |
| authorization        | 9              | 0.80      | 0.89   | 0.84       |
| data_persistence     | 32             | 0.87      | 0.81   | 0.84       |
| external_integration | 22             | 0.59      | 0.91   | 0.71       |
| observability        | 3              | 1.00      | 0.33   | 0.50       |
| user_interface       | 70             | 0.80      | 0.99   | 0.88       |

### Sample layer disagreements

| symbol                                                                       | gold                    | predicted (conf)                  | gold rationale                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ----------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface frontend.src.routeTree.gen.RootRouteChildren                       | none/-                  | navigation/navigationgraph (0.45) | Generated TanStack Router type in routeTree.gen.ts that only lists the root's child route types for type-checking. It is generated code with no behaviour, so it |
| Method frontend.src.client.sdk.gen.LoginService.testToken                    | none/-                  | api/operation (0.60)              | Generated OpenAPI SDK client method wrapping POST /api/v1/login/test-token. Generated code is boilerplate. The real API operation lives in the backend route. It |
| Interface frontend.src.components.Admin.DeleteUser.DeleteUserProps           | none/-                  | ux/componentinstance (0.50)       | A props type for the DeleteUser React component, holding only an id and an onSuccess callback. It is an implementation detail of that component's signature, not |
| Function frontend.src.routes.\_\_root.component                              | navigation/route        | ux/view (0.60)                    | Root route component of the TanStack Router tree, rendering the Outlet that hosts all child routes plus devtools. It acts as the root of the app's navigation st |
| Interface frontend.src.components.Items.ItemActionsMenu.ItemActionsMenuProps | none/-                  | ux/componentinstance (0.50)       | A trivial React props interface with a single item field, used only to type the ItemActionsMenu component. It is a boilerplate implementation detail of that UI  |
| Class backend.app.models.Token                                               | data-model/objectschema | api/schema (0.50)                 | A SQLModel DTO (non-table) that defines the JSON response shape for the login access token endpoint. It is a data schema with access_token and token_type fields |
| Method frontend.src.client.sdk.gen.LoginService.loginAccessToken             | none/-                  | api/operation (0.50)              | Generated OpenAPI client SDK method that wraps a POST to /api/v1/login/access-token. As generated code it is not modelled as an element itself. The real API ope |
| Method frontend.src.client.sdk.gen.UsersService.updateUserMe                 | none/-                  | api/operation (0.50)              | Generated OpenAPI client SDK method (sdk.gen.ts) wrapping a PATCH to /api/v1/users/me. Generated code is not recorded as an architecture element on its own; the |
| Function frontend.src.hooks.useCustomToast.showSuccessToast                  | none/-                  | ux/actioncomponent (0.35)         | This is a trivial inner wrapper inside the useCustomToast hook that calls toast.success with a fixed title. It is widely used but has no architectural weight of |
| Method frontend.src.client.sdk.gen.ItemsService.deleteItem                   | none/-                  | api/operation (0.45)              | Generated OpenAPI client SDK method wrapping DELETE /api/v1/items/{id}. Generated code is boilerplate; the API operation itself is modelled on the backend. It d |

## clef

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 80     | 73.8%  | 69          |
| ux          | 54     | 87.0%  | 63          |
| api         | 30     | 96.7%  | 29          |
| data-model  | 10     | 100.0% | 14          |
| data-store  | 8      | 50.0%  | 4           |
| security    | 6      | 50.0%  | 3           |
| technology  | 4      | 0.0%   | 0           |
| application | 4      | 50.0%  | 7           |
| navigation  | 3      | 66.7%  | 10          |
| testing     | 1      | 100.0% | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → ux                | 16    |
| none → navigation        | 5     |
| ux → navigation          | 3     |
| ux → none                | 3     |
| security → none          | 3     |
| technology → application | 2     |
| data-store → data-model  | 2     |
| data-store → application | 2     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 4   | 0.28      | 0.50     | 0.22 |
| 0.3-0.4        | 19  | 0.36      | 0.42     | 0.06 |
| 0.4-0.5        | 47  | 0.46      | 0.57     | 0.12 |
| 0.5-0.6        | 56  | 0.54      | 0.86     | 0.31 |
| 0.6-0.7        | 59  | 0.65      | 0.97     | 0.32 |
| 0.7-0.8        | 13  | 0.73      | 1.00     | 0.27 |
| 0.8-0.9        | 2   | 0.81      | 1.00     | 0.19 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.0%    | 92.3%             |
| ≥0.60     | 37.0%    | 97.3%             |
| ≥0.70     | 7.5%     | 100.0%            |
| ≥0.80     | 1.0%     | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 24             | 0.90      | 0.38   | 0.53       |
| authorization        | 9              | 1.00      | 0.44   | 0.62       |
| data_persistence     | 32             | 1.00      | 0.44   | 0.61       |
| external_integration | 22             | 0.92      | 0.50   | 0.65       |
| observability        | 3              | n/a       | 0.00   | n/a        |
| user_interface       | 70             | 0.93      | 0.94   | 0.94       |

### Sample layer disagreements

| symbol                                                                       | gold                  | predicted (conf)                  | gold rationale                                                                                                                                                   |
| ---------------------------------------------------------------------------- | --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class backend.app.core.config.Settings                                       | technology/artifact   | application/dataobject (0.54)     | Central application configuration loaded from environment/.env via pydantic BaseSettings: database DSN, SMTP, Sentry, secret key, token expiry. It is a deployme |
| Interface frontend.src.components.Admin.DeleteUser.DeleteUserProps           | none/-                | ux/- (0.41)                       | A props type for the DeleteUser React component, holding only an id and an onSuccess callback. It is an implementation detail of that component's signature, not |
| Class backend.app.models.User                                                | data-store/collection | data-model/- (0.55)               | SQLModel table=True class defining the physical user table with a primary key, a hashed password column, a timestamp and a cascading relationship to items. It i |
| Interface frontend.src.components.Items.ItemActionsMenu.ItemActionsMenuProps | none/-                | ux/- (0.39)                       | A trivial React props interface with a single item field, used only to type the ItemActionsMenu component. It is a boilerplate implementation detail of that UI  |
| Interface frontend.src.components.Common.Logo.LogoProps                      | none/-                | ux/librarycomponent (0.51)        | A small props interface for the Logo UI component. It only declares the component's input shape (variant, className, asLink) and is an implementation detail of  |
| Interface frontend.src.routeTree.gen.FileRoutesByTo                          | none/-                | navigation/navigationgraph (0.49) | This is a TanStack Router type map generated in routeTree.gen.ts. Generated code is excluded from architectural modelling. The routes it lists would be modelled |
| Class backend.app.api.routes.private.PrivateUserCreate                       | api/schema            | data-model/objectschema (0.44)    | Pydantic request body model defined inline in the private routes module, describing the payload for a private user-creation endpoint. It is an API-local request |
| Interface frontend.src.routeTree.gen.FileRoutesByPath                        | none/-                | navigation/navigationgraph (0.46) | This is a TanStack Router module-augmentation interface inside the generated routeTree.gen.ts file. It only provides compile-time typing for the route map. Gene |
| Module frontend.src.routes.\_layout.settings                                 | ux/view               | navigation/route (0.45)           | A file-based route module defining the routable User Settings page, which composes profile, password and delete-account tabs. As a complete routable screen it i |
| Interface frontend.src.components.Admin.EditUser.EditUserProps               | none/-                | ux/- (0.42)                       | A props type declaration for the EditUser React component, with only two fields (user, onSuccess). It is a component-local type detail, not an architectural ele |

## clef-flash

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 80     | 81.3%  | 76          |
| ux          | 54     | 81.5%  | 50          |
| api         | 30     | 96.7%  | 29          |
| data-model  | 10     | 100.0% | 13          |
| data-store  | 8      | 37.5%  | 3           |
| security    | 6      | 0.0%   | 0           |
| technology  | 4      | 0.0%   | 0           |
| application | 4      | 75.0%  | 17          |
| navigation  | 3      | 66.7%  | 11          |
| testing     | 1      | 100.0% | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → navigation        | 6     |
| none → ux                | 6     |
| ux → none                | 5     |
| security → application   | 4     |
| ux → navigation          | 3     |
| none → application       | 3     |
| data-store → application | 3     |
| technology → application | 2     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 9   | 0.28      | 0.56     | 0.28 |
| 0.3-0.4        | 58  | 0.35      | 0.74     | 0.39 |
| 0.4-0.5        | 67  | 0.45      | 0.72     | 0.27 |
| 0.5-0.6        | 46  | 0.54      | 0.89     | 0.35 |
| 0.6-0.7        | 18  | 0.62      | 1.00     | 0.38 |
| 0.7-0.8        | 2   | 0.71      | 1.00     | 0.29 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 33.0%    | 92.4%             |
| ≥0.60     | 10.0%    | 100.0%            |
| ≥0.70     | 1.0%     | 100.0%            |
| ≥0.80     | 0.0%     | n/a               |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 24             | 1.00      | 0.21   | 0.34       |
| authorization        | 9              | n/a       | 0.00   | n/a        |
| data_persistence     | 32             | 1.00      | 0.38   | 0.55       |
| external_integration | 22             | 1.00      | 0.55   | 0.71       |
| observability        | 3              | n/a       | 0.00   | n/a        |
| user_interface       | 70             | 0.97      | 0.89   | 0.93       |

### Sample layer disagreements

| symbol                                                         | gold                  | predicted (conf)                        | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------- | --------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface frontend.src.routeTree.gen.RootRouteChildren         | none/-                | navigation/navigationgraph (0.49)       | Generated TanStack Router type in routeTree.gen.ts that only lists the root's child route types for type-checking. It is generated code with no behaviour, so it |
| Class backend.app.core.config.Settings                         | technology/artifact   | application/dataobject (0.29)           | Central application configuration loaded from environment/.env via pydantic BaseSettings: database DSN, SMTP, Sentry, secret key, token expiry. It is a deployme |
| Class backend.app.models.User                                  | data-store/collection | data-model/- (0.49)                     | SQLModel table=True class defining the physical user table with a primary key, a hashed password column, a timestamp and a cascading relationship to items. It i |
| Function frontend.src.components.ui.tooltip.TooltipProvider    | ux/librarycomponent   | none/- (0.44)                           | A shadcn-style thin wrapper around the Radix Tooltip Provider that sets a default delay. It is a reusable UI library component, but it is trivial boilerplate us |
| Function frontend.src.components.ui.skeleton.Skeleton          | ux/librarycomponent   | none/- (0.43)                           | A shadcn-style reusable UI primitive that renders a pulsing placeholder div. It is a library component in the UX layer, but it is trivial, generated-style boile |
| Interface frontend.src.routeTree.gen.FileRoutesByTo            | none/-                | navigation/navigationgraph (0.46)       | This is a TanStack Router type map generated in routeTree.gen.ts. Generated code is excluded from architectural modelling. The routes it lists would be modelled |
| Class backend.app.api.routes.private.PrivateUserCreate         | api/schema            | data-model/objectschema (0.36)          | Pydantic request body model defined inline in the private routes module, describing the payload for a private user-creation endpoint. It is an API-local request |
| Interface frontend.src.routeTree.gen.FileRoutesByPath          | none/-                | navigation/navigationgraph (0.44)       | This is a TanStack Router module-augmentation interface inside the generated routeTree.gen.ts file. It only provides compile-time typing for the route map. Gene |
| Module frontend.src.routes.\_layout.settings                   | ux/view               | navigation/route (0.41)                 | A file-based route module defining the routable User Settings page, which composes profile, password and delete-account tabs. As a complete routable screen it i |
| Interface frontend.src.components.Admin.EditUser.EditUserProps | none/-                | application/applicationcomponent (0.31) | A props type declaration for the EditUser React component, with only two fields (user, onSuccess). It is a component-local type detail, not an architectural ele |

## clef@enriched-v1

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 80     | 73.8%  | 69          |
| ux          | 54     | 87.0%  | 63          |
| api         | 30     | 96.7%  | 29          |
| data-model  | 10     | 100.0% | 14          |
| data-store  | 8      | 50.0%  | 4           |
| security    | 6      | 50.0%  | 3           |
| technology  | 4      | 0.0%   | 0           |
| application | 4      | 50.0%  | 7           |
| navigation  | 3      | 66.7%  | 10          |
| testing     | 1      | 100.0% | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → ux                | 16    |
| none → navigation        | 5     |
| ux → navigation          | 3     |
| ux → none                | 3     |
| security → none          | 3     |
| technology → application | 2     |
| data-store → data-model  | 2     |
| data-store → application | 2     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 4   | 0.28      | 0.50     | 0.22 |
| 0.3-0.4        | 19  | 0.36      | 0.42     | 0.06 |
| 0.4-0.5        | 47  | 0.46      | 0.57     | 0.12 |
| 0.5-0.6        | 56  | 0.54      | 0.86     | 0.31 |
| 0.6-0.7        | 59  | 0.65      | 0.97     | 0.32 |
| 0.7-0.8        | 13  | 0.73      | 1.00     | 0.27 |
| 0.8-0.9        | 2   | 0.81      | 1.00     | 0.19 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.0%    | 92.3%             |
| ≥0.60     | 37.0%    | 97.3%             |
| ≥0.70     | 7.5%     | 100.0%            |
| ≥0.80     | 1.0%     | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 24             | 0.90      | 0.38   | 0.53       |
| authorization        | 9              | 1.00      | 0.44   | 0.62       |
| data_persistence     | 32             | 1.00      | 0.44   | 0.61       |
| external_integration | 22             | 0.92      | 0.50   | 0.65       |
| observability        | 3              | n/a       | 0.00   | n/a        |
| user_interface       | 70             | 0.93      | 0.94   | 0.94       |

### Sample layer disagreements

| symbol                                                                       | gold                  | predicted (conf)                  | gold rationale                                                                                                                                                   |
| ---------------------------------------------------------------------------- | --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class backend.app.core.config.Settings                                       | technology/artifact   | application/dataobject (0.54)     | Central application configuration loaded from environment/.env via pydantic BaseSettings: database DSN, SMTP, Sentry, secret key, token expiry. It is a deployme |
| Class backend.app.models.User                                                | data-store/collection | data-model/- (0.55)               | SQLModel table=True class defining the physical user table with a primary key, a hashed password column, a timestamp and a cascading relationship to items. It i |
| Interface frontend.src.components.Admin.DeleteUser.DeleteUserProps           | none/-                | ux/- (0.41)                       | A props type for the DeleteUser React component, holding only an id and an onSuccess callback. It is an implementation detail of that component's signature, not |
| Interface frontend.src.components.Items.ItemActionsMenu.ItemActionsMenuProps | none/-                | ux/- (0.39)                       | A trivial React props interface with a single item field, used only to type the ItemActionsMenu component. It is a boilerplate implementation detail of that UI  |
| Interface frontend.src.components.Common.Logo.LogoProps                      | none/-                | ux/librarycomponent (0.51)        | A small props interface for the Logo UI component. It only declares the component's input shape (variant, className, asLink) and is an implementation detail of  |
| Interface frontend.src.routeTree.gen.FileRoutesByTo                          | none/-                | navigation/navigationgraph (0.49) | This is a TanStack Router type map generated in routeTree.gen.ts. Generated code is excluded from architectural modelling. The routes it lists would be modelled |
| Class backend.app.api.routes.private.PrivateUserCreate                       | api/schema            | data-model/objectschema (0.44)    | Pydantic request body model defined inline in the private routes module, describing the payload for a private user-creation endpoint. It is an API-local request |
| Interface frontend.src.routeTree.gen.FileRoutesByPath                        | none/-                | navigation/navigationgraph (0.46) | This is a TanStack Router module-augmentation interface inside the generated routeTree.gen.ts file. It only provides compile-time typing for the route map. Gene |
| Module frontend.src.routes.\_layout.settings                                 | ux/view               | navigation/route (0.45)           | A file-based route module defining the routable User Settings page, which composes profile, password and delete-account tabs. As a complete routable screen it i |
| Interface frontend.src.components.Admin.EditUser.EditUserProps               | none/-                | ux/- (0.42)                       | A props type declaration for the EditUser React component, with only two fields (user, onSuccess). It is a component-local type detail, not an architectural ele |

## claude-sonnet

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 80     | 40.0%  | 32          |
| ux          | 54     | 92.6%  | 69          |
| api         | 30     | 96.7%  | 48          |
| data-model  | 10     | 100.0% | 11          |
| data-store  | 8      | 100.0% | 9           |
| security    | 6      | 100.0% | 7           |
| technology  | 4      | 25.0%  | 1           |
| application | 4      | 100.0% | 11          |
| navigation  | 3      | 66.7%  | 11          |
| testing     | 1      | 100.0% | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → api               | 18    |
| none → ux                | 18    |
| none → navigation        | 6     |
| none → application       | 4     |
| ux → navigation          | 3     |
| technology → application | 2     |
| none → security          | 1     |
| api → data-model         | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.3-0.4        | 3   | 0.33      | 0.00     | -0.33 |
| 0.4-0.5        | 14  | 0.40      | 0.21     | -0.19 |
| 0.5-0.6        | 21  | 0.52      | 0.38     | -0.14 |
| 0.6-0.7        | 45  | 0.60      | 0.47     | -0.13 |
| 0.7-0.8        | 20  | 0.71      | 0.75     | 0.04  |
| 0.8-0.9        | 86  | 0.82      | 0.99     | 0.17  |
| 0.9-1.0        | 11  | 0.90      | 1.00     | 0.10  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 91.5%    | 76.5%             |
| ≥0.60     | 81.0%    | 81.5%             |
| ≥0.70     | 58.5%    | 94.9%             |
| ≥0.80     | 48.5%    | 99.0%             |
| ≥0.90     | 5.5%     | 100.0%            |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 24             | 0.78      | 0.75   | 0.77       |
| authorization        | 9              | 1.00      | 0.56   | 0.71       |
| data_persistence     | 32             | 0.91      | 0.63   | 0.74       |
| external_integration | 22             | 0.73      | 0.73   | 0.73       |
| observability        | 3              | n/a       | 0.00   | n/a        |
| user_interface       | 70             | 0.93      | 0.97   | 0.95       |

### Sample layer disagreements

| symbol                                                                       | gold                | predicted (conf)                        | gold rationale                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class backend.app.core.config.Settings                                       | technology/artifact | application/applicationcomponent (0.60) | Central application configuration loaded from environment/.env via pydantic BaseSettings: database DSN, SMTP, Sentry, secret key, token expiry. It is a deployme |
| Interface frontend.src.routeTree.gen.RootRouteChildren                       | none/-              | navigation/navigationgraph (0.60)       | Generated TanStack Router type in routeTree.gen.ts that only lists the root's child route types for type-checking. It is generated code with no behaviour, so it |
| Method frontend.src.client.sdk.gen.LoginService.testToken                    | none/-              | api/operation (0.55)                    | Generated OpenAPI SDK client method wrapping POST /api/v1/login/test-token. Generated code is boilerplate. The real API operation lives in the backend route. It |
| Interface frontend.src.components.Admin.DeleteUser.DeleteUserProps           | none/-              | ux/- (0.35)                             | A props type for the DeleteUser React component, holding only an id and an onSuccess callback. It is an implementation detail of that component's signature, not |
| Method backend.app.core.config.Settings.\_check_default_secret               | none/-              | security/validationrule (0.50)          | Private validation helper on the Settings class that rejects or warns about the placeholder 'changethis' secret value. It is a small configuration sanity check  |
| Module frontend.src.client.client.client.gen                                 | none/-              | api/- (0.40)                            | This is an auto-generated @hey-api/openapi-ts Axios client factory, which counts as generated boilerplate rather than a hand-authored architectural element. It  |
| Interface frontend.src.components.Items.ItemActionsMenu.ItemActionsMenuProps | none/-              | ux/componentinstance (0.50)             | A trivial React props interface with a single item field, used only to type the ItemActionsMenu component. It is a boilerplate implementation detail of that UI  |
| Method frontend.src.client.sdk.gen.LoginService.loginAccessToken             | none/-              | api/operation (0.50)                    | Generated OpenAPI client SDK method that wraps a POST to /api/v1/login/access-token. As generated code it is not modelled as an element itself. The real API ope |
| Method frontend.src.client.sdk.gen.UsersService.updateUserMe                 | none/-              | api/operation (0.60)                    | Generated OpenAPI client SDK method (sdk.gen.ts) wrapping a PATCH to /api/v1/users/me. Generated code is not recorded as an architecture element on its own; the |
| Method frontend.src.client.sdk.gen.ItemsService.deleteItem                   | none/-              | api/operation (0.60)                    | Generated OpenAPI client SDK method wrapping DELETE /api/v1/items/{id}. Generated code is boilerplate; the API operation itself is modelled on the backend. It d |
