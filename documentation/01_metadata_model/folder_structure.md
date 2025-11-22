# Suggested Folder Structure

```plaintext
project/
├── model/                          # The canonical model
│   ├── manifest.yaml              # Model metadata & layer registry
│   ├── motivation/
│   │   ├── goals.yaml
│   │   ├── stakeholders.yaml
│   │   └── requirements.yaml
│   ├── business/
│   │   ├── services.yaml
│   │   ├── processes.yaml
│   │   └── actors.yaml
│   ├── security/
│   │   ├── roles.yaml
│   │   ├── permissions.yaml
│   │   └── policies.yaml
│   ├── application/
│   │   ├── components.yaml
│   │   └── services.yaml
│   ├── technology/
│   │   └── stack.yaml
│   ├── api/
│   │   ├── operations.yaml       # References to OpenAPI files
│   │   └── endpoints.yaml
│   ├── data/
│   │   ├── entities.yaml         # References to JSON Schema files
│   │   └── relationships.yaml
│   ├── ux/
│   │   ├── screens.yaml
│   │   └── states.yaml
│   └── navigation/
│       ├── routes.yaml
│       └── guards.yaml
│
├── specs/                          # Generated/exported specifications
│   ├── archimate/
│   │   └── model.archimate
│   ├── openapi/
│   │   ├── customer-api.yaml
│   │   └── product-api.yaml
│   ├── schemas/
│   │   ├── customer.schema.json
│   │   └── product.schema.json
│   ├── ux/
│   │   ├── customer-list.ux.yaml
│   │   └── customer-edit.ux.yaml
│   └── security/
│       └── security-model.yaml
│
├── projection-rules.yaml           # Rules for cross-layer projection
├── dr.config.yaml                 # Configuration for dr tool
└── dr                             # The CLI tool (Python/Node/Bash)
```