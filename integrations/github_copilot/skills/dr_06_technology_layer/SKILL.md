---
name: LAYER_05_TECH
description: Expert knowledge for Technology Layer modeling in Documentation Robotics
triggers:
  [
    "infrastructure",
    "node",
    "kubernetes",
    "docker",
    "server",
    "database",
    "technology service",
    "network",
    "cloud",
    "terraform",
    "archimate technology"
  ]
version: 0.8.3
---

# Technology Layer Skill

**Layer Number:** 05
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Describes the technology infrastructure including hardware, software, networks, and facilities that support applications.

---

## CRITICAL: Valid Element Types

> ⚠️ Only 13 spec-defined types may be used in the technology layer.

**VALID types** (use exactly these strings in `type:` fields and element IDs):

```
artifact | communicationnetwork | device | node | path | systemsoftware |
technologycollaboration | technologyevent | technologyfunction |
technologyinteraction | technologyinterface | technologyprocess | technologyservice
```

**INVALID types** — these do NOT exist in the spec:

```
stack | framework | library | tool | runtime | cicd | deployment | protocol | worker
```

Element IDs MUST follow: `technology.{valid-spec-type}.{kebab-name}`

```
✅ technology.systemsoftware.react
✅ technology.artifact.react-flow
✅ technology.technologyprocess.github-actions
✅ technology.technologyservice.github-pages
❌ technology.framework.react          (invalid — 'framework' is not a spec type)
❌ technology.library.react-flow       (invalid — 'library' is not a spec type)
❌ technology.cicd.github-actions      (invalid)
❌ technology.stack.react              (invalid — 'stack' does not exist)
```

---

## Layer Overview

The Technology Layer captures **infrastructure and platform**:

- **COMPUTE** - Nodes, devices, system software
- **NETWORK** - Communication networks, paths, interfaces
- **STORAGE** - Artifacts (databases, files, configurations)
- **SERVICES** - Technology services (IaaS, PaaS)
- **AUTOMATION** - Infrastructure as Code (Terraform, Ansible, K8s)

This layer uses **ArchiMate 3.2 Technology Layer** standard with optional properties for Infrastructure as Code references, cloud provider specifics, and operational characteristics.

---

## Entity Types

> **CLI Introspection:** Run `dr schema types technology` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

| Entity Type                 | Description                                             | Key Attributes                                                                               |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Node**                    | Computational or physical resource that hosts artifacts | Types: server, container, vm, kubernetes-cluster, serverless-function, database-cluster      |
| **Device**                  | Physical IT resource with processing capability         | Types: server, workstation, mobile, iot-device, network-device, storage-appliance            |
| **SystemSoftware**          | Software that provides platform for applications        | Types: operating-system, database, middleware, container-runtime, web-server, message-broker |
| **TechnologyCollaboration** | Aggregate of nodes working together                     | Examples: HA Cluster, CDN Network, Service Mesh                                              |
| **TechnologyInterface**     | Point of access where technology services are available | Protocols: HTTP, HTTPS, TCP, UDP, WebSocket, AMQP, MQTT, SQL, gRPC                           |
| **Path**                    | Link between nodes through which they exchange          | Types: network, vpn, direct-connect, internet, peering                                       |
| **CommunicationNetwork**    | Set of structures that connects nodes                   | Types: lan, wan, vpn, internet, cdn, service-mesh, zero-trust-network                        |
| **TechnologyFunction**      | Collection of technology behavior                       | Examples: Load Balancing, Data Replication, Auto-scaling, Monitoring                         |
| **TechnologyProcess**       | Sequence of technology behaviors (CI/CD, provisioning)  | Automation: ansible, terraform, kubernetes, cloudformation, pulumi                           |
| **TechnologyInteraction**   | Unit of collective technology behavior                  | Examples: Database Replication, Cache Synchronization, Failover                              |
| **TechnologyEvent**         | Technology state change                                 | Types: startup, shutdown, failure, scaling, maintenance, alert                               |
| **TechnologyService**       | Externally visible unit of technology functionality     | Types: infrastructure, platform, storage, compute, network, database, messaging              |
| **Artifact**                | Physical piece of data used or produced                 | Types: database, file, configuration, binary, log, backup, docker-image, helm-chart          |

---

## Technology Classification Guide

Given what you see in the codebase, which spec type does it become?

| What You See in the Codebase                         | Spec Type                 | Required Attribute                   | Example ID                                          |
| ---------------------------------------------------- | ------------------------- | ------------------------------------ | --------------------------------------------------- |
| Framework-grade npm library (see heuristic below)    | `systemsoftware`          | `softwareType: middleware`           | `technology.systemsoftware.zustand`                 |
| Utility npm library (see heuristic below)            | `artifact`                | `artifactType: library`              | `technology.artifact.jszip`                         |
| JavaScript/CSS framework (`react`, `tailwindcss`)    | `systemsoftware`          | `softwareType: middleware`           | `technology.systemsoftware.react`                   |
| Language runtime (`node.js`, `python`, `bun`)        | `systemsoftware`          | `softwareType: middleware`           | `technology.systemsoftware.nodejs`                  |
| Container runtime (`docker`)                         | `systemsoftware`          | `softwareType: container-runtime`    | `technology.systemsoftware.docker`                  |
| Build tool / compiler (`vite`, `tsc`, `eslint`)      | `technologyprocess`       | —                                    | `technology.technologyprocess.vite`                 |
| CI/CD pipeline or workflow                           | `technologyprocess`       | —                                    | `technology.technologyprocess.github-actions`       |
| Hosted platform service (GitHub Pages, npm registry) | `technologyservice`       | `serviceType: compute` or `storage`  | `technology.technologyservice.github-pages`         |
| Browser JavaScript runtime environment               | `node`                    | `nodeType: container`                | `technology.node.browser-runtime`                   |
| Development server                                   | `node`                    | `nodeType: virtual-machine`          | `technology.node.dev-server`                        |
| Backend server                                       | `node`                    | `nodeType: virtual-machine`          | `technology.node.dr-cli-server`                     |
| Build output / distributable / npm package           | `artifact`                | `artifactType: archive` or `library` | `technology.artifact.dist-embedded`                 |
| Network protocol / communication channel             | `communicationnetwork`    | `networkType: internet` or `lan`     | `technology.communicationnetwork.websocket-channel` |
| HTTP/WebSocket port or endpoint (access point)       | `technologyinterface`     | `protocol: http/https/websocket`     | `technology.technologyinterface.vite-dev-http`      |
| Infrastructure function (HMR, caching, bundling)     | `technologyfunction`      | —                                    | `technology.technologyfunction.hot-module-reload`   |
| Off-thread Web Worker                                | `technologyfunction`      | —                                    | `technology.technologyfunction.off-thread-layout`   |
| Group of nodes/services working together             | `technologycollaboration` | —                                    | `technology.technologycollaboration.ci-cd-suite`    |

### Framework-Grade Library vs. Utility Library

When a package is an npm library, ask: does it fundamentally define the application's runtime capabilities (rendering engine, state management, routing, layout)?

**YES — use `systemsoftware` (softwareType: middleware):**
`react`, `vue`, `angular`, `@xyflow/react`, `zustand`, `@tanstack/react-router`, `@tanstack/react-query`, `tailwindcss`, `elkjs`, `dagre`, `d3-force`, `@hpcc-js/wasm`, `libavoid-js`

**NO — use `artifact` (artifactType: library):**
Utility helpers (`lodash`, `date-fns`), export utilities (`jszip`, `html-to-image`), markdown renderers (`react-markdown`), polyfills, adapters

The distinction: `systemsoftware` = runtime platform the app is built **on**; `artifact` = code the app uses for a specific utility capability.

---

## Frontend / SPA Codebase Detection Patterns

These patterns cover the actual structure of browser-based React/TypeScript SPAs. Always map to valid spec types using the Classification Guide above.

### Pattern: package.json dependencies

```json
{
  "dependencies": {
    "@xyflow/react": "12.9.3",
    "zustand": "5.0.8",
    "react": "19.2.0",
    "@tanstack/react-query": "5.51.0",
    "libavoid-js": "0.5.0-beta.5",
    "@hpcc-js/wasm": "2.30.0",
    "jszip": "3.10.1",
    "html-to-image": "1.11.13",
    "react-markdown": "9.0.1",
    "msw": "2.6.8"
  },
  "devDependencies": {
    "vite": "7.2.4",
    "typescript": "5.9.3",
    "eslint": "9.x"
  }
}
```

→ `react` → `technology.systemsoftware.react` (softwareType: middleware)
→ `@xyflow/react` → `technology.systemsoftware.react-flow` (softwareType: middleware — graph rendering engine)
→ `zustand` → `technology.systemsoftware.zustand` (softwareType: middleware — state management)
→ `@tanstack/react-query` → `technology.systemsoftware.react-query` (softwareType: middleware — server state management)
→ `libavoid-js` → `technology.systemsoftware.libavoid-js` (softwareType: middleware — WASM edge routing)
→ `@hpcc-js/wasm` → `technology.systemsoftware.graphviz-wasm` (softwareType: middleware — graph layout WASM)
→ `jszip` → `technology.artifact.jszip` (artifactType: library — ZIP export utility)
→ `html-to-image` → `technology.artifact.html-to-image` (artifactType: library — PNG/SVG export utility)
→ `react-markdown` → `technology.artifact.react-markdown` (artifactType: library — markdown rendering utility)
→ `msw` → `technology.technologyprocess.msw` (Mock Service Worker — test tooling process)
→ `vite` → `technology.technologyprocess.vite` (build tool)
→ `typescript` → `technology.systemsoftware.typescript` (softwareType: middleware — compiler)
→ `eslint` → `technology.technologyprocess.eslint` (linting process)

### Pattern: GitHub Actions CI/CD workflow

```yaml
name: CI
on: [push, pull_request]
jobs:
  build: ...
  test: ...
  deploy: ...
```

→ `technology.technologyprocess.github-actions` (top-level workflow)
→ Each job: `technology.technologyprocess.build-pipeline`, `technology.technologyprocess.deploy-pipeline`
→ NOT `technology.cicd.github-actions` — use `technologyprocess`

### Pattern: Static site hosting (GitHub Pages, Netlify, Vercel)

```yaml
# .github/workflows/deploy.yml
- name: Deploy to GitHub Pages
  uses: actions/deploy-pages@v2
```

→ `technology.technologyservice.github-pages` (serviceType: compute)
→ NOT `technology.stack.github-pages` or `technology.deployment.github-pages`

### Pattern: Vite dev server

```typescript
// vite.config.ts
export default defineConfig({
  server: { port: 3001 },
  build: { outDir: "dist" }
});
```

→ `technology.node.dev-server` (nodeType: virtual-machine, port: 3001)
→ `technology.technologyinterface.vite-dev-http` (protocol: http, port: 3001)
→ `technology.artifact.dist-standalone` (artifactType: archive) — build output

### Pattern: Web Worker

```javascript
// public/workers/layoutWorker.js
self.onmessage = function (e) {
  const result = runDagreLayout(e.data);
  self.postMessage(result);
};
```

→ `technology.technologyfunction.off-thread-layout`
→ NOT a separate `worker` type — use `technologyfunction`

### Pattern: Browser runtime

The browser that runs a React SPA is the primary Node (host):

→ `technology.node.browser-runtime` (nodeType: container)
→ It `serves` `application.applicationcomponent.viewer-app`

---

## Coverage Completeness Checklist

Before declaring technology layer extraction complete, verify each type was considered:

```
□ systemsoftware — runtimes (Node.js), frameworks (React), compilers (TypeScript), Docker
□ artifact — ALL npm library dependencies, build outputs (dist/), docker images, npm package
□ node — browser runtime, dev server, backend server, CI runner
□ technologyprocess — every CI/CD pipeline, build step, automation tool (Vite, ESLint, GitHub Actions)
□ technologyservice — hosted services: GitHub Pages, npm registry, Docker Hub, CDN
□ technologyinterface — dev server port, WebSocket endpoint, REST API endpoint
□ technologyfunction — Web Workers, HMR, caching, bundling algorithms
□ communicationnetwork — internet connection, WebSocket channel, browser network context
□ technologycollaboration — groups: CI/CD suite, deployment pipeline (multiple nodes working together)
□ artifact (configs) — configuration files as artifacts (vite.config.ts, tsconfig.json)

Types less likely to apply to a frontend SPA (still worth considering):
  - device: physical hardware (almost never for pure frontend)
  - path: explicit network paths (rare)
  - technologyevent: deployment events, build failures, alerts
  - technologyinteraction: collective behavior across nodes (e.g., CDN + origin server)
```

---

## Intra-Layer Relationships

Nodes and system software are `assigned-to` the behaviour they perform; an interface is `assigned-to`
the services it offers and `serves` the behaviour that uses it. Functions, processes and interactions
realize services; events trigger behaviour, and structure does not trigger. Artifacts are passive.
Networks realize paths, and networks and paths `connects` nodes and devices.

### Structural Relationships

| Source Type             | Predicate   | Target Type           | Example                                                 |
| ----------------------- | ----------- | --------------------- | ------------------------------------------------------- |
| Node                    | composes    | Device                | "Bare-metal Cluster" composes "Dell R740 Server"        |
| Node                    | composes    | SystemSoftware        | "Web Server VM" composes "NGINX"                        |
| Node                    | composes    | TechnologyInterface   | "API Server" composes "HTTPS Endpoint"                  |
| Node                    | composes    | Artifact              | "EKS Worker" composes "User Service Image" (deployed)   |
| SystemSoftware          | provides    | TechnologyInterface   | "PostgreSQL" provides "SQL Interface"                   |
| SystemSoftware          | depends-on  | SystemSoftware        | "Kafka" depends on "ZooKeeper"                          |
| Artifact                | composes    | Artifact              | "Helm Chart" composes "values.yaml"                     |
| Artifact                | depends-on  | Artifact              | "User Service Image" depends on "Node 20 Base Image"    |
| Artifact                | realizes    | SystemSoftware        | "postgres:16 image" realizes "PostgreSQL 16"            |
| TechnologyCollaboration | aggregates  | Node                  | "K8s Cluster" aggregates "Worker Nodes"                 |
| TechnologyCollaboration | aggregates  | SystemSoftware        | "Postgres HA Pair" aggregates "Postgres Primary"        |
| CommunicationNetwork    | aggregates  | CommunicationNetwork  | "Production VPC" aggregates "Private Subnet 1a"         |
| CommunicationNetwork    | realizes    | Path                  | "Corporate WAN" realizes "Direct Connect Link"          |
| CommunicationNetwork    | connects    | Node                  | "Production VPC" connects "EKS Cluster"                 |
| CommunicationNetwork    | connects    | Device                | "Office LAN" connects "Edge Gateway"                    |
| Path                    | connects    | Node                  | "Direct Connect Link" connects "On-Premise K8s"         |
| SystemSoftware          | realizes    | TechnologyService     | "PostgreSQL" realizes "Database Service"                |
| Node                    | realizes    | TechnologyService     | "RDS Instance" realizes "Managed Database Service"      |
| TechnologyFunction      | realizes    | TechnologyService     | "Load Balancing" realizes "Load Balancer Service"       |
| TechnologyProcess       | realizes    | TechnologyService     | "CI/CD Pipeline" realizes "Deployment Service"          |
| TechnologyInterface     | assigned-to | TechnologyService     | "Postgres Wire Endpoint" assigned to "Database Service" |
| Node                    | assigned-to | TechnologyFunction    | "Edge Server" assigned to "CDN Caching"                 |
| SystemSoftware          | assigned-to | TechnologyFunction    | "NGINX" assigned to "Load Balancing"                    |
| TechnologyCollaboration | assigned-to | TechnologyInteraction | "Postgres HA Pair" assigned to "Streaming Replication"  |

### Behavioral Relationships

| Source Type           | Predicate | Target Type        | Example                                            |
| --------------------- | --------- | ------------------ | -------------------------------------------------- |
| TechnologyEvent       | triggers  | TechnologyProcess  | "Node Failure" triggers "Failover Process"         |
| TechnologyEvent       | triggers  | TechnologyFunction | "CPU Threshold Exceeded" triggers "Auto-scaling"   |
| TechnologyProcess     | triggers  | TechnologyEvent    | "Deploy to K8s" triggers "Deployment Completed"    |
| TechnologyProcess     | composes  | TechnologyProcess  | "CI/CD Pipeline" composes "Build Image"            |
| TechnologyInterface   | serves    | TechnologyProcess  | "Kubernetes API" serves "Deploy to K8s"            |
| TechnologyFunction    | flows-to  | TechnologyProcess  | "Health Checking" flows to "Node Recovery"         |
| TechnologyService     | serves    | TechnologyService  | "Storage Service" serves "Database Service"        |
| TechnologyProcess     | accesses  | Artifact           | "Deploy to K8s" accesses "User Service Image"      |
| SystemSoftware        | accesses  | Artifact           | "PostgreSQL" accesses "Data Files"                 |
| TechnologyFunction    | accesses  | Artifact           | "Database Backup" accesses "Backup Files"          |
| TechnologyInteraction | accesses  | Artifact           | "Streaming Replication" accesses "Write-Ahead Log" |

---

## Cross-Layer References

### Outgoing References (Technology → Other Layers)

| Source Type       | Predicate | Target Type                        | Example                                                    |
| ----------------- | --------- | ---------------------------------- | ---------------------------------------------------------- |
| Node              | serves    | `application.applicationcomponent` | "EKS Cluster" serves "User Service"                        |
| SystemSoftware    | serves    | `application.applicationcomponent` | "Node.js 20 Runtime" serves "User Service"                 |
| TechnologyService | serves    | `application.applicationservice`   | "Database Service" serves "Customer Management Service"    |
| TechnologyService | serves    | `application.applicationfunction`  | "Object Storage" serves "saveAttachment"                   |
| Artifact          | realizes  | `application.applicationcomponent` | "user-service:1.4 image" realizes "User Service"           |
| TechnologyService | serves    | `api.operation`                    | "S3 Object Storage" serves "uploadAvatar"                  |
| TechnologyService | serves    | `data-store.database`              | "Amazon RDS" serves "orders-db"                            |
| TechnologyService | serves    | `apm.exporterconfig`               | "OpenTelemetry Collector" serves "OTLP Trace Exporter"     |
| TechnologyService | realizes  | `product.softwarecapability`       | "Search Cluster Service" realizes "Full-text Search"       |
| TechnologyService | realizes  | `motivation.goal`                  | "Kubernetes Orchestration" realizes "Faster Deployments"   |
| TechnologyService | satisfies | `motivation.requirement`           | "Multi-AZ Database Service" satisfies "99.9% Availability" |
| SystemSoftware    | satisfies | `motivation.principle`             | "PostgreSQL" satisfies "Prefer Open Source"                |
| SystemSoftware    | satisfies | `motivation.constraint`            | "PostgreSQL 16" satisfies "Approved License List"          |
| Node              | satisfies | `motivation.constraint`            | "EU-West Cluster" satisfies "EU Data Residency"            |
| Node              | satisfies | `security.securitypolicy`          | "Hardened Bastion Host" satisfies "CIS Benchmark Policy"   |
| SystemSoftware    | realizes  | `security.countermeasure`          | "AWS WAF" realizes "SQL Injection Filtering"               |
| SystemSoftware    | mitigates | `security.threat`                  | "Fail2ban" mitigates "Brute-force Login"                   |

Security properties such as encryption-at-rest, data classification, and PII flags are recorded as Artifact attributes, not relationships.

### Incoming References (Other Layers → Technology)

| Source Type                  | Predicate  | Target Type       | Example                                                 |
| ---------------------------- | ---------- | ----------------- | ------------------------------------------------------- |
| `api.server`                 | depends-on | Node              | "Production API Server" depends on "EKS Cluster"        |
| `api.securityscheme`         | depends-on | SystemSoftware    | "OAuth2 Scheme" depends on "Keycloak"                   |
| `data-store.database`        | depends-on | SystemSoftware    | "orders-db" depends on "PostgreSQL 16"                  |
| `data-store.database`        | depends-on | Node              | "orders-db" depends on "Postgres Cluster"               |
| `data-model.jsonschema`      | maps-to    | Artifact          | "Order Schema" maps to "orders.schema.json"             |
| `apm.resource`               | references | SystemSoftware    | "user-service resource" references "Node.js 20 Runtime" |
| `apm.span`                   | monitors   | TechnologyService | "db.query span" monitors "Database Service"             |
| `apm.metricinstrument`       | monitors   | TechnologyService | "db.query.duration" monitors "Database Service"         |
| `ux.librarycomponent`        | depends-on | SystemSoftware    | "DataGrid" depends on "Browser Runtime"                 |
| `testing.testcoveragetarget` | covers     | TechnologyService | "Database Integration" target covers "Database Service" |

---

## Codebase Detection Patterns

### Pattern 1: Kubernetes Deployment

```yaml
# Kubernetes deployment manifest
apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-service
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: user-service
  template:
    metadata:
      labels:
        app: user-service
    spec:
      containers:
        - name: user-service
          image: myregistry/user-service:1.0.0
          ports:
            - containerPort: 8080
```

**Maps to:**

- Node: "K8s Cluster Production" (type: kubernetes-cluster)
- Node: "User Service Pod" (type: container)
- Artifact: "myregistry/user-service:1.0.0" (type: docker-image)
- TechnologyInterface: "Port 8080" (protocol: HTTP)

### Pattern 2: Terraform Infrastructure

```hcl
# Terraform AWS infrastructure
resource "aws_instance" "web_server" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.medium"
  availability_zone = "us-east-1a"

  tags = {
    Name = "Web Server"
    Environment = "production"
  }
}

resource "aws_db_instance" "postgres" {
  engine         = "postgres"
  engine_version = "14.7"
  instance_class = "db.t3.medium"
  storage_type   = "gp3"
}
```

**Maps to:**

- Node: "Web Server EC2" (type: server, provider: aws, instance-type: t3.medium, region: us-east-1, az: us-east-1a)
- Node: "PostgreSQL RDS" (type: database-cluster, provider: aws)
- SystemSoftware: "PostgreSQL 14.7" (type: database, version: 14.7)
- Properties: iac-tool=terraform, iac-file=main.tf

### Pattern 3: Docker Compose

```yaml
# docker-compose.yml
version: "3.8"
services:
  api:
    image: myapp/api:latest
    ports:
      - "8080:8080"
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: admin
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres-data:
```

**Maps to:**

- TechnologyCollaboration: "Docker Compose Stack"
- Node: "API Container" (type: container)
- SystemSoftware: "PostgreSQL 14" (type: database)
- SystemSoftware: "Redis 7" (type: middleware, subtype: cache)
- Artifact: "postgres-data" (type: volume)
- TechnologyInterface: "Redis Port 6379" (protocol: TCP)

### Pattern 4: Database Configuration

```python
# Database connection configuration
DATABASE_CONFIG = {
    "host": "prod-db.example.com",
    "port": 5432,
    "database": "customer_db",
    "user": "app_user",
    "password": "${DB_PASSWORD}",
    "pool_size": 20,
    "max_overflow": 10,
    "pool_timeout": 30
}
```

**Maps to:**

- Node: "Production Database" (type: database-cluster, host: prod-db.example.com)
- SystemSoftware: "PostgreSQL" (type: database, port: 5432)
- Artifact: "customer_db" (type: database)
- TechnologyInterface: "PostgreSQL Interface" (protocol: SQL, port: 5432)
- Properties: pool-size=20, max-overflow=10

### Pattern 5: CI/CD Pipeline

```yaml
# GitHub Actions CI/CD
name: Deploy to Production
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker image
        run: docker build -t myapp:${{ github.sha }} .
      - name: Push to registry
        run: docker push myregistry/myapp:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Kubernetes
        run: kubectl apply -f k8s/deployment.yaml
```

**Maps to:**

- TechnologyProcess: "CI/CD Pipeline" (pattern: ci-cd, automation: github-actions)
- Sub-processes: "Build", "Deploy"
- TechnologyFunction: "Docker Build", "Kubernetes Deploy"
- Artifact: "Docker Image" (type: docker-image)

### Pattern 6: Load Balancer Configuration

```nginx
# NGINX load balancer
upstream backend {
    least_conn;
    server app1.example.com:8080 weight=1;
    server app2.example.com:8080 weight=1;
    server app3.example.com:8080 weight=1;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    location / {
        proxy_pass http://backend;
    }
}
```

**Maps to:**

- Node: "NGINX Load Balancer" (type: server)
- SystemSoftware: "NGINX" (type: web-server, subtype: load-balancer)
- TechnologyFunction: "Load Balancing" (strategy: least-conn)
- TechnologyInterface: "HTTPS Endpoint" (protocol: HTTPS, port: 443)
- TechnologyCollaboration: "Backend Pool" (aggregates app1, app2, app3)

---

## Modeling Workflow

### Step 1: Identify Infrastructure Nodes

```bash
# Kubernetes cluster
dr add technology node "k8s-cluster-prod" \
  --description "Production Kubernetes cluster"

# Virtual machines
dr add technology node "web-server-01" \
  --description "Web application server VM"

# Serverless function
dr add technology node "order-processor-lambda" \
  --description "Lambda function for order processing"

# Database cluster
dr add technology node "postgres-cluster" \
  --description "PostgreSQL RDS cluster"
```

### Step 2: Define System Software

```bash
# Database system
dr add technology system-software "postgresql-14" \
  --description "PostgreSQL relational database"

# Container runtime
dr add technology system-software "docker" \
  --description "Docker container runtime"

# Web server
dr add technology system-software "nginx" \
  --description "NGINX web server and load balancer"

# Message broker
dr add technology system-software "rabbitmq" \
  --description "RabbitMQ message broker"
```

### Step 3: Model Technology Services

```bash
# Infrastructure service
dr add technology service "kubernetes-orchestration" \
  --description "Container orchestration platform"

# Database service
dr add technology service "postgres-database" \
  --description "PostgreSQL database service"

# Storage service
dr add technology service "s3-object-storage" \
  --description "S3 object storage for files and backups"

# Link software to service
dr relationship add technology.systemsoftware.postgresql-14 \
  technology.technologyservice.postgres-database --predicate realizes
```

### Step 4: Define Communication Networks

```bash
# VPC network
dr add technology network "production-vpc" \
  --description "Production VPC network"

# Subnet
dr add technology network "private-subnet-1a" \
  --description "Private subnet in AZ 1a"

# VPN
dr add technology network "site-to-site-vpn" \
  --description "Site-to-site VPN to on-premise datacenter"
```

### Step 5: Model Artifacts

```bash
# Database artifact
dr add technology artifact "customer-database" \
  --description "Customer data database"

# Docker image
dr add technology artifact "user-service-image" \
  --description "User service Docker image"

# Configuration file
dr add technology artifact "app-config" \
  --description "Application configuration file"

# Log files
dr add technology artifact "application-logs" \
  --description "Application log files"

# Link artifact to node
dr relationship add technology.node.postgres-cluster \
  technology.artifact.customer-database --predicate composes
```

### Step 6: Model Infrastructure as Code

```bash
# Terraform process
dr add technology process "provision-infrastructure" \
  --description "Terraform infrastructure provisioning"

# Ansible process
dr add technology process "configure-servers" \
  --description "Ansible server configuration"

# Kubernetes deployment process
dr add technology process "deploy-to-k8s" \
  --description "Deploy application to Kubernetes"
```

### Step 7: Define Technology Functions

```bash
# Load balancing
dr add technology function "load-balancing" \
  --description "Distribute traffic across backend servers"

# Auto-scaling
dr add technology function "auto-scaling" \
  --description "Automatically scale based on CPU utilization"

# Backup
dr add technology function "database-backup" \
  --description "Automated database backup"

# Assign function to node
dr relationship add technology.node.k8s-cluster-prod \
  technology.technologyfunction.auto-scaling --predicate assigned-to
```

### Step 8: Cross-Layer Integration

```bash
# Link to application layer
dr relationship add technology.node.k8s-cluster-prod \
  application.applicationcomponent.user-service --predicate serves

# Link to motivation layer
dr relationship add technology.technologyservice.kubernetes-orchestration \
  motivation.goal.improve-deployment-frequency --predicate realizes

dr relationship add technology.systemsoftware.docker \
  motivation.principle.cloud-native-architecture --predicate satisfies

# Link to APM layer
dr relationship add apm.metricinstrument.database-query-latency \
  technology.technologyservice.postgres-database --predicate monitors
```

### Step 9: Validate

```bash
dr validate --layers technology
dr validate --relationships
```

---

## Cloud Provider Patterns

### AWS Pattern

```
TechnologyCollaboration: "AWS Production Environment"
├── aggregates → Node: "EKS Cluster" (provider: aws, region: us-east-1)
│   └── serves → ApplicationComponent: "Microservices"
├── aggregates → Node: "RDS PostgreSQL" (provider: aws, multi-az: true)
│   └── realizes → TechnologyService: "Database Service"
├── accesses → Artifact: "S3 Bucket" (provider: aws, storage-class: standard)
└── uses → CommunicationNetwork: "VPC" (cidr: 10.0.0.0/16)
    ├── aggregates → CommunicationNetwork: "Public Subnet" (cidr: 10.0.1.0/24)
    └── aggregates → CommunicationNetwork: "Private Subnet" (cidr: 10.0.2.0/24)
```

### Kubernetes Pattern

Model the cluster as a Node; namespaces, deployments and pods are usually attributes of that node or
of the application components it serves, since the catalog has no Node-to-Node composition.

```
Node: "Kubernetes Cluster" (nodeType: kubernetes-cluster)
├── composes → SystemSoftware: "containerd"
├── composes → Artifact: "ConfigMap: app-config"
├── assigned-to → TechnologyFunction: "Auto-scaling" (HPA)
└── serves → ApplicationComponent: "UserService" (namespace: production, replicas: 3)
```

### Hybrid Cloud Pattern

```
TechnologyCollaboration: "Hybrid Cloud Architecture"
├── aggregates → Node: "AWS EKS Cluster" (provider: aws)
├── aggregates → Node: "On-Premise K8s" (provider: onprem)
├── uses → Path: "Direct Connect" (type: direct-connect)
└── uses → CommunicationNetwork: "Zero-Trust Network"
```

---

## Best Practices

1. **Node Types Matter** - server vs container vs serverless have different operational characteristics
2. **Track IaC References** - Link to Terraform, Ansible, Kubernetes manifests
3. **Model HA Clusters** - Use TechnologyCollaboration for high-availability setups
4. **Network Segmentation** - Model VPCs, subnets, security zones explicitly
5. **Artifact Encryption** - Mark encryption status (at-rest, in-transit, both)
6. **Version Everything** - Track software versions, image tags, schema versions
7. **Link to Motivation** - Infrastructure choices trace to principles and constraints
8. **Monitor SLAs** - Technology services have availability and latency targets
9. **Document Automation** - Reference IaC tools and CI/CD pipelines
10. **Cloud-Agnostic When Possible** - Use ArchiMate types rather than provider-specific terms

---

## Infrastructure as Code Integration

When infrastructure is managed as code:

```yaml
technology-node:
  id: "k8s-cluster-prod"
  type: "kubernetes-cluster"
  properties:
    iac-tool: "terraform"
    iac-file: "infrastructure/eks-cluster.tf"
    iac-module: "eks-cluster"
    iac-version: "4.0.0"
    provider: "aws"
    region: "us-east-1"
```

**IaC Tools Supported:**

- **Terraform** - Declarative infrastructure
- **Ansible** - Configuration management
- **Kubernetes** - Container orchestration manifests
- **CloudFormation** - AWS-specific IaC
- **Pulumi** - Programming language IaC
- **Helm** - Kubernetes package manager

---

## Validation Tips

| Issue                  | Cause                                               | Fix                                    |
| ---------------------- | --------------------------------------------------- | -------------------------------------- |
| Orphaned Node          | Node not hosting applications or realizing services | Link to application layer or remove    |
| Unhosted Application   | ApplicationComponent not deployed to any node       | Add deployment link to technology node |
| Missing Networks       | Nodes exist but no network connectivity             | Model CommunicationNetwork and Paths   |
| Untracked Artifacts    | Databases, images, configs not modeled              | Add Artifact entities                  |
| No IaC Reference       | Infrastructure lacks automation reference           | Add iac-tool and iac-file properties   |
| Missing SLA Targets    | Services lack availability/latency targets          | Add SLA properties for monitoring      |
| No Security Properties | Artifacts lack encryption/classification            | Add security properties                |

---

## Quick Reference

**Add Commands:**

```bash
dr add technology node <name>
dr add technology system-software <name>
dr add technology service <name>
dr add technology network <name>
dr add technology artifact <name>
dr add technology function <name>
dr add technology process <name>
```

**Relationship Commands:**

```bash
dr relationship add <system-software> <service> --predicate realizes
dr relationship add <node> <function> --predicate assigned-to
dr relationship add <node> <artifact> --predicate composes
dr relationship add <network> <node> --predicate connects
```

**Cross-Layer Commands:**

```bash
dr relationship add <technology-node> <application-component> --predicate serves
dr relationship add <technology-service> <motivation-goal> --predicate realizes
dr relationship add <system-software> <motivation-principle> --predicate realizes
dr relationship add <apm-metric-instrument> <technology-service> --predicate monitors
```
