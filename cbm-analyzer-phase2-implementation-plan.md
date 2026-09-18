# CbmAnalyzer Phase 2 Implementation Plan

## Executive Summary

Phase 2 refactors CbmAnalyzer to support optional `codebaseRoot` parameter (for monorepo scenarios where git operations should reference a different root than project metadata storage). The pattern is:
- **Public methods**: Accept optional `options?.codebaseRoot` parameter
- **Private methods**: Rename `projectRoot` parameter to `codebaseRoot` for clarity
- **Effective root resolution**: Each method derives `effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot`
- **Selective usage**: Use effectiveCodebaseRoot for git ops, path.relative() calls, resolveProjectName matching; keep projectRoot for metadata I/O (readIndexMeta/writeIndexMeta, StagingAreaManager)

---

## Method Signature Changes

### 1. status() — Line 335
**Current:**
```typescript
async status(projectRoot: string): Promise<AnalyzerStatus>
```

**Changes:**
- Add options parameter with optional codebaseRoot
- Resolve effectiveCodebaseRoot at method start
- Use effectiveCodebaseRoot for git operations only (line 356-358)
- Keep projectRoot for readIndexMeta (line 340)

**Updated signature:**
```typescript
async status(
  projectRoot: string,
  options?: { codebaseRoot?: string }
): Promise<AnalyzerStatus>
```

**Internal parameter flow:**
- Line 336: `const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;`
- Line 356: Replace `cwd: projectRoot` with `cwd: effectiveCodebaseRoot` in git rev-parse

---

### 2. index() — Line 405
**Current:**
```typescript
async index(
  projectRoot: string,
  options?: { force?: boolean }
): Promise<IndexResult>
```

**Changes:**
- Extend options type to include codebaseRoot
- Resolve effectiveCodebaseRoot at method start
- Use effectiveCodebaseRoot for:
  - Git operations (line 509-510)
  - index_repository repo_path (line 546-547)
  - resolveProjectName matching (implicit in call)
- Keep projectRoot for:
  - readIndexMeta/writeIndexMeta (lines 340, 598)
  - StagingAreaManager (line 531)

**Updated signature:**
```typescript
async index(
  projectRoot: string,
  options?: { force?: boolean; codebaseRoot?: string }
): Promise<IndexResult>
```

**Internal parameter flow:**
- Line 409: `const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;`
- Line 410: Keep `this.status(projectRoot, options)` as-is (pass options through)
- Line 509: Replace `cwd: projectRoot` with `cwd: effectiveCodebaseRoot` in git rev-parse
- Line 546: Replace `repo_path: projectRoot` with `repo_path: effectiveCodebaseRoot` in index_repository tool call
- Line 531: Keep `projectRoot` in StagingAreaManager constructor

---

### 3. endpoints() — Line 690
**Current:**
```typescript
async endpoints(projectRoot: string): Promise<EndpointCandidate[]>
```

**Changes:**
- Add options parameter with optional codebaseRoot
- Resolve effectiveCodebaseRoot at method start
- Use effectiveCodebaseRoot for:
  - resolveProjectName matching (line 736)
  - Pass to transformNodeToEndpoint() as codebaseRoot (line 757)
- Keep projectRoot for:
  - status() call (line 692) — but pass options through

**Updated signature:**
```typescript
async endpoints(
  projectRoot: string,
  options?: { codebaseRoot?: string }
): Promise<EndpointCandidate[]>
```

**Internal parameter flow:**
- Line 692: Keep `this.status(projectRoot, options)` (pass options through)
- Line 710: `const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;`
- Line 736: Replace `this.resolveProjectName(client, projectRoot)` with `this.resolveProjectName(client, effectiveCodebaseRoot)`
- Line 757: Replace `this.transformNodeToEndpoint(node, routeMapping, projectRoot)` with `this.transformNodeToEndpoint(node, routeMapping, effectiveCodebaseRoot)`
- Line 804: Replace `this.shapeClientSideEndpoint(node, projectRoot)` with `this.shapeClientSideEndpoint(node, effectiveCodebaseRoot)`

---

### 4. services() — Line 1188
**Current:**
```typescript
async services(projectRoot: string): Promise<ServiceCandidate[]>
```

**Changes:**
- Add options parameter with optional codebaseRoot
- Resolve effectiveCodebaseRoot at method start
- Use effectiveCodebaseRoot for:
  - resolveProjectName matching (line 1251)
  - Pass to transformNodeToService() as codebaseRoot (line 1278-1282)
- Keep projectRoot for:
  - status() call (line 1190) — but pass options through

**Updated signature:**
```typescript
async services(
  projectRoot: string,
  options?: { codebaseRoot?: string }
): Promise<ServiceCandidate[]>
```

**Internal parameter flow:**
- Line 1190: Keep `this.status(projectRoot, options)` (pass options through)
- Line 1210: `const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;`
- Line 1251: Replace `this.resolveProjectName(client, projectRoot)` with `this.resolveProjectName(client, effectiveCodebaseRoot)`
- Line 1278-1282: Update transformNodeToService call to pass `effectiveCodebaseRoot` instead of `projectRoot`

---

### 5. datastores() — Line 1510
**Current:**
```typescript
async datastores(projectRoot: string): Promise<DatastoreCandidate[]>
```

**Changes:**
- Add options parameter with optional codebaseRoot
- Resolve effectiveCodebaseRoot at method start
- Use effectiveCodebaseRoot for:
  - resolveProjectName matching (line 1575)
  - path.relative() calls (lines 1693, 1812)
- Keep projectRoot for:
  - status() call (line 1512) — but pass options through

**Updated signature:**
```typescript
async datastores(
  projectRoot: string,
  options?: { codebaseRoot?: string }
): Promise<DatastoreCandidate[]>
```

**Internal parameter flow:**
- Line 1512: Keep `this.status(projectRoot, options)` (pass options through)
- Line 1532: `const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;`
- Line 1575: Replace `this.resolveProjectName(client, projectRoot)` with `this.resolveProjectName(client, effectiveCodebaseRoot)`
- Line 1693: Replace `path.relative(projectRoot, filePath)` with `path.relative(effectiveCodebaseRoot, filePath)`
- Line 1812: Replace `path.relative(projectRoot, node.file_path)` with `path.relative(effectiveCodebaseRoot, node.file_path)`

---

### 6. callers() — Line 1933
**Current:**
```typescript
async callers(
  projectRoot: string,
  qualifiedName: string,
  depth?: number
): Promise<CallGraphNode[]>
```

**Changes:**
- Add options parameter with optional codebaseRoot
- Delegate to traceCallPath with options parameter

**Updated signature:**
```typescript
async callers(
  projectRoot: string,
  qualifiedName: string,
  depth?: number,
  options?: { codebaseRoot?: string }
): Promise<CallGraphNode[]>
```

**Internal parameter flow:**
- Line 1938: Replace `return this.traceCallPath(projectRoot, qualifiedName, depth, "inbound");` with `return this.traceCallPath(projectRoot, qualifiedName, depth, "inbound", options);`

---

### 7. callees() — Line 1955
**Current:**
```typescript
async callees(
  projectRoot: string,
  qualifiedName: string,
  depth?: number
): Promise<CallGraphNode[]>
```

**Changes:**
- Add options parameter with optional codebaseRoot
- Delegate to traceCallPath with options parameter

**Updated signature:**
```typescript
async callees(
  projectRoot: string,
  qualifiedName: string,
  depth?: number,
  options?: { codebaseRoot?: string }
): Promise<CallGraphNode[]>
```

**Internal parameter flow:**
- Line 1960: Replace `return this.traceCallPath(projectRoot, qualifiedName, depth, "outbound");` with `return this.traceCallPath(projectRoot, qualifiedName, depth, "outbound", options);`

---

### 8. traceCallPath() — Line 2040
**Current:**
```typescript
private async traceCallPath(
  projectRoot: string,
  qualifiedName: string,
  depth: number | undefined,
  direction: "outbound" | "inbound"
): Promise<CallGraphNode[]>
```

**Changes:**
- Rename projectRoot parameter to codebaseRoot for consistency with private method pattern
- Add options parameter to handle optional override
- Use codebaseRoot for:
  - resolveProjectName matching (line 2084)
  - callGraphViaCypher call (line 2125)
  - shapeCallGraphNode calls (line 2166)
- Keep original projectRoot for: status() call (line 2047)

**Updated signature:**
```typescript
private async traceCallPath(
  projectRoot: string,
  qualifiedName: string,
  depth: number | undefined,
  direction: "outbound" | "inbound",
  options?: { codebaseRoot?: string }
): Promise<CallGraphNode[]>
```

**Internal parameter flow:**
- Line 2047: Keep `this.status(projectRoot, options)` (pass options through)
- Line 2074: `const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;`
- Line 2084: Replace `this.resolveProjectName(client, projectRoot)` with `this.resolveProjectName(client, effectiveCodebaseRoot)`
- Line 2125: Replace `this.callGraphViaCypher(..., projectRoot)` with `this.callGraphViaCypher(..., effectiveCodebaseRoot)`
- Line 2166: Replace `shapeCallGraphNode(node, projectRoot)` with `shapeCallGraphNode(node, effectiveCodebaseRoot)`

---

### 9. callGraphViaCypher() — Line 1971
**Current:**
```typescript
private async callGraphViaCypher(
  binaryPath: string,
  projectName: string,
  qualifiedName: string,
  direction: "outbound" | "inbound",
  depth: number,
  projectRoot: string
): Promise<CallGraphNode[]>
```

**Changes:**
- Rename projectRoot parameter to codebaseRoot for consistency
- Use codebaseRoot for:
  - shapeCallGraphNode call (line 2015)

**Updated signature:**
```typescript
private async callGraphViaCypher(
  binaryPath: string,
  projectName: string,
  qualifiedName: string,
  direction: "outbound" | "inbound",
  depth: number,
  codebaseRoot: string
): Promise<CallGraphNode[]>
```

**Internal parameter flow:**
- Line 2015: Replace `shapeCallGraphNode(obj, projectRoot)` with `shapeCallGraphNode(obj, codebaseRoot)`

---

### 10. query() — Line 838
**Current:**
```typescript
async query(projectRoot: string, rawQuery: string): Promise<unknown>
```

**Changes:**
- Add options parameter with optional codebaseRoot
- Resolve effectiveCodebaseRoot at method start
- Use effectiveCodebaseRoot for:
  - resolveProjectName matching (line 874)
- Keep projectRoot for:
  - status() call (line 840) — but pass options through

**Updated signature:**
```typescript
async query(
  projectRoot: string,
  rawQuery: string,
  options?: { codebaseRoot?: string }
): Promise<unknown>
```

**Internal parameter flow:**
- Line 840: Keep `this.status(projectRoot, options)` (pass options through)
- Line 862: `const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;`
- Line 874: Replace `this.resolveProjectName(client, projectRoot)` with `this.resolveProjectName(client, effectiveCodebaseRoot)`

---

### 11. verify() — Line 2260
**Current:**
```typescript
async verify(
  projectRoot: string,
  options: VerifyOptions
): Promise<VerifyReport>
```

**Changes:**
- Extend VerifyOptions type to include optional codebaseRoot field (or handle via local options object)
- Resolve effectiveCodebaseRoot at method start
- Use effectiveCodebaseRoot for:
  - resolveProjectName matching (line 2309)
- Keep projectRoot for:
  - status() call (line 2265) — already passes options
  - engine.computeReport() call (line 2335)

**Updated signature:**
```typescript
async verify(
  projectRoot: string,
  options: VerifyOptions & { codebaseRoot?: string }
): Promise<VerifyReport>
```

**Internal parameter flow:**
- Line 2265: Keep `this.status(projectRoot, options)` as-is (VerifyOptions will include codebaseRoot)
- Line 2286: `const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;`
- Line 2309: Replace `this.resolveProjectName(client, projectRoot)` with `this.resolveProjectName(client, effectiveCodebaseRoot)`

---

## Supporting Private Methods (Renamed Parameters)

### resolveProjectName() — Line 658
**Current:**
```typescript
private async resolveProjectName(
  client: StdioClient,
  projectRoot: string
): Promise<string>
```

**Changes:**
- Rename projectRoot parameter to codebaseRoot for clarity in private methods
- Update the matching logic to use codebaseRoot (line 666)

**Updated signature:**
```typescript
private async resolveProjectName(
  client: StdioClient,
  codebaseRoot: string
): Promise<string>
```

**Internal changes:**
- Line 666: Update `p.root_path === projectRoot` to `p.root_path === codebaseRoot`
- Line 671: Update `Project root: ${projectRoot}` to `Project root: ${codebaseRoot}`

---

### transformNodeToEndpoint() — Line 951
**Current:**
```typescript
private async transformNodeToEndpoint(
  node: CbmGraphNode,
  mapping: AnalyzerNodeMapping,
  projectRoot: string
): Promise<EndpointCandidate>
```

**Changes:**
- Rename projectRoot parameter to codebaseRoot
- Use codebaseRoot for path.relative() call (line 1036)

**Updated signature:**
```typescript
private async transformNodeToEndpoint(
  node: CbmGraphNode,
  mapping: AnalyzerNodeMapping,
  codebaseRoot: string
): Promise<EndpointCandidate>
```

**Internal changes:**
- Line 1034: Update condition from `if (sourceFile && projectRoot)` to `if (sourceFile && codebaseRoot)`
- Line 1036: Update `path.relative(projectRoot, sourceFile)` to `path.relative(codebaseRoot, sourceFile)`

---

### shapeClientSideEndpoint() — Line 1096
**Current:**
```typescript
private shapeClientSideEndpoint(node: CbmGraphNode, projectRoot: string): EndpointCandidate | null
```

**Changes:**
- Rename projectRoot parameter to codebaseRoot
- Use codebaseRoot for path.relative() call (line 1103)

**Updated signature:**
```typescript
private shapeClientSideEndpoint(node: CbmGraphNode, codebaseRoot: string): EndpointCandidate | null
```

**Internal changes:**
- Line 1101: Update condition from `if (sourceFile && projectRoot)` to `if (sourceFile && codebaseRoot)`
- Line 1103: Update `path.relative(projectRoot, sourceFile)` to `path.relative(codebaseRoot, sourceFile)`

---

### transformNodeToService() — Line 1323
**Current:**
```typescript
private async transformNodeToService(
  node: CbmGraphNode,
  mapping: AnalyzerNodeMapping,
  projectRoot: string,
  promotionHeuristicNames: string[]
): Promise<ServiceCandidate>
```

**Changes:**
- Rename projectRoot parameter to codebaseRoot
- Use codebaseRoot for path.relative() call (line 1341)

**Updated signature:**
```typescript
private async transformNodeToService(
  node: CbmGraphNode,
  mapping: AnalyzerNodeMapping,
  codebaseRoot: string,
  promotionHeuristicNames: string[]
): Promise<ServiceCandidate>
```

**Internal changes:**
- Line 1339: Update condition from `if (sourceFile && projectRoot)` to `if (sourceFile && codebaseRoot)`
- Line 1341: Update `path.relative(projectRoot, sourceFile)` to `path.relative(codebaseRoot, sourceFile)`

---

## Call Graph & Parameter Flow

### Call Chain Diagram

```
Public API Layer:
├── status(projectRoot, options?) → resolveProjectName(effectiveCodebaseRoot)
├── index(projectRoot, options?) → status() → resolveProjectName(effectiveCodebaseRoot)
├── endpoints(projectRoot, options?) → status() → transformNodeToEndpoint(effectiveCodebaseRoot) → shapeClientSideEndpoint(effectiveCodebaseRoot)
├── services(projectRoot, options?) → status() → transformNodeToService(effectiveCodebaseRoot)
├── datastores(projectRoot, options?) → status() → [uses effectiveCodebaseRoot in path.relative calls]
├── callers(projectRoot, qualifiedName, depth?, options?) → traceCallPath(..., options)
├── callees(projectRoot, qualifiedName, depth?, options?) → traceCallPath(..., options)
├── query(projectRoot, rawQuery, options?) → status() → resolveProjectName(effectiveCodebaseRoot)
└── verify(projectRoot, options) → status() → resolveProjectName(effectiveCodebaseRoot)

Private Coordination Layer:
├── traceCallPath(projectRoot, ..., direction, options?) 
│   ├── status(projectRoot, options) [keep projectRoot]
│   ├── resolveProjectName(effectiveCodebaseRoot)
│   └── callGraphViaCypher(binaryPath, projectName, ..., codebaseRoot)
│       └── shapeCallGraphNode(node, codebaseRoot)
└── resolveProjectName(codebaseRoot) [renamed parameter]
```

### Options Parameter Propagation

**Pattern**: Options object flows through method call chains to support monorepo scenarios.

```
callers/callees (receive options)
  ↓ pass options to
traceCallPath (receive options)
  ↓ pass options to
status (receive options, extract codebaseRoot)
  ↓ and pass options to
status → uses effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot
```

**Methods that pass options down:**
- callers() → traceCallPath()
- callees() → traceCallPath()
- endpoints() → status()
- services() → status()
- datastores() → status()
- query() → status()
- verify() → status()
- traceCallPath() → status()
- index() → status()

**Methods that use options locally:**
- status() → extract effectiveCodebaseRoot
- index() → extract effectiveCodebaseRoot
- endpoints() → extract effectiveCodebaseRoot
- services() → extract effectiveCodebaseRoot
- datastores() → extract effectiveCodebaseRoot
- query() → extract effectiveCodebaseRoot
- verify() → extract effectiveCodebaseRoot
- traceCallPath() → extract effectiveCodebaseRoot

---

## Detailed Line-by-Line Implementation Changes

### File: /workspace/cli/src/analyzers/cbm-analyzer.ts

#### Change 1: status() signature and implementation (Line 335-391)
```
OLD (line 335):
  async status(projectRoot: string): Promise<AnalyzerStatus> {

NEW:
  async status(projectRoot: string, options?: { codebaseRoot?: string }): Promise<AnalyzerStatus> {

OLD (line 356-358):
    const currentHeadResult = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf-8",
    });

NEW (add at line 336):
  const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;
  
NEW (line 356-358, after adding effectiveCodebaseRoot):
    const currentHeadResult = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: effectiveCodebaseRoot,
      stdio: "pipe",
      encoding: "utf-8",
    });

KEEP (line 340):
    const indexMeta = await readIndexMeta(projectRoot, analyzerName);
      [uses projectRoot, not effectiveCodebaseRoot]
```

#### Change 2: index() signature and implementation (Line 405-609)
```
OLD (line 405-408):
  async index(
    projectRoot: string,
    options?: { force?: boolean }
  ): Promise<IndexResult> {

NEW:
  async index(
    projectRoot: string,
    options?: { force?: boolean; codebaseRoot?: string }
  ): Promise<IndexResult> {

OLD (line 410):
    const status = await this.status(projectRoot);

NEW (add at line 409):
  const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;
  
KEEP (line 410):
    const status = await this.status(projectRoot, options);
      [pass options through]

OLD (line 509-510):
      const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: projectRoot,

NEW:
      const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: effectiveCodebaseRoot,

OLD (line 546-548):
      const indexResponse = (await client.invokeTool("index_repository", {
        repo_path: projectRoot,
      })) as {

NEW:
      const indexResponse = (await client.invokeTool("index_repository", {
        repo_path: effectiveCodebaseRoot,
      })) as {

KEEP (line 531):
        const stagingManager = new StagingAreaManager(projectRoot);
          [uses projectRoot, not effectiveCodebaseRoot]

KEEP (line 598):
      await writeIndexMeta(meta, projectRoot, analyzerName);
        [uses projectRoot, not effectiveCodebaseRoot]
```

#### Change 3: endpoints() signature and implementation (Line 690-824)
```
OLD (line 690):
  async endpoints(projectRoot: string): Promise<EndpointCandidate[]> {

NEW:
  async endpoints(projectRoot: string, options?: { codebaseRoot?: string }): Promise<EndpointCandidate[]> {

OLD (line 692):
    const status = await this.status(projectRoot);

NEW (add at line 691):
  const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;
  
KEEP (line 692):
    const status = await this.status(projectRoot, options);
      [pass options through]

OLD (line 736):
      const projectName = await this.resolveProjectName(client, projectRoot);

NEW:
      const projectName = await this.resolveProjectName(client, effectiveCodebaseRoot);

OLD (line 757):
        const candidate = await this.transformNodeToEndpoint(
          node,
          routeMapping,
          projectRoot
        );

NEW:
        const candidate = await this.transformNodeToEndpoint(
          node,
          routeMapping,
          effectiveCodebaseRoot
        );

OLD (line 804):
              const candidate = this.shapeClientSideEndpoint(node, projectRoot);

NEW:
              const candidate = this.shapeClientSideEndpoint(node, effectiveCodebaseRoot);
```

#### Change 4: services() signature and implementation (Line 1188-1311)
```
OLD (line 1188):
  async services(projectRoot: string): Promise<ServiceCandidate[]> {

NEW:
  async services(projectRoot: string, options?: { codebaseRoot?: string }): Promise<ServiceCandidate[]> {

OLD (line 1190):
    const status = await this.status(projectRoot);

NEW (add at line 1189):
  const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;
  
KEEP (line 1190):
    const status = await this.status(projectRoot, options);
      [pass options through]

OLD (line 1251):
      const projectName = await this.resolveProjectName(client, projectRoot);

NEW:
      const projectName = await this.resolveProjectName(client, effectiveCodebaseRoot);

OLD (line 1278-1282):
          const candidate = await this.transformNodeToService(
            node,
            nodeMapping,
            projectRoot,
            promotionHeuristicNames
          );

NEW:
          const candidate = await this.transformNodeToService(
            node,
            nodeMapping,
            effectiveCodebaseRoot,
            promotionHeuristicNames
          );
```

#### Change 5: datastores() signature and implementation (Line 1510-1855)
```
OLD (line 1510):
  async datastores(projectRoot: string): Promise<DatastoreCandidate[]> {

NEW:
  async datastores(projectRoot: string, options?: { codebaseRoot?: string }): Promise<DatastoreCandidate[]> {

OLD (line 1512):
    const status = await this.status(projectRoot);

NEW (add at line 1511):
  const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;
  
KEEP (line 1512):
    const status = await this.status(projectRoot, options);
      [pass options through]

OLD (line 1575):
      const projectName = await this.resolveProjectName(client, projectRoot);

NEW:
      const projectName = await this.resolveProjectName(client, effectiveCodebaseRoot);

OLD (line 1691-1693):
        let relativeFile = filePath;
        if (filePath && projectRoot) {
          try {
            relativeFile = path.relative(projectRoot, filePath);

NEW:
        let relativeFile = filePath;
        if (filePath && effectiveCodebaseRoot) {
          try {
            relativeFile = path.relative(effectiveCodebaseRoot, filePath);

OLD (line 1811-1812):
            let relFile = node.file_path;
            try { relFile = path.relative(projectRoot, node.file_path); } catch { /* keep absolute */ }

NEW:
            let relFile = node.file_path;
            try { relFile = path.relative(effectiveCodebaseRoot, node.file_path); } catch { /* keep absolute */ }
```

#### Change 6: callers() signature and implementation (Line 1933-1939)
```
OLD (line 1933-1937):
  async callers(
    projectRoot: string,
    qualifiedName: string,
    depth?: number
  ): Promise<CallGraphNode[]> {
    return this.traceCallPath(projectRoot, qualifiedName, depth, "inbound");

NEW:
  async callers(
    projectRoot: string,
    qualifiedName: string,
    depth?: number,
    options?: { codebaseRoot?: string }
  ): Promise<CallGraphNode[]> {
    return this.traceCallPath(projectRoot, qualifiedName, depth, "inbound", options);
```

#### Change 7: callees() signature and implementation (Line 1955-1961)
```
OLD (line 1955-1959):
  async callees(
    projectRoot: string,
    qualifiedName: string,
    depth?: number
  ): Promise<CallGraphNode[]> {
    return this.traceCallPath(projectRoot, qualifiedName, depth, "outbound");

NEW:
  async callees(
    projectRoot: string,
    qualifiedName: string,
    depth?: number,
    options?: { codebaseRoot?: string }
  ): Promise<CallGraphNode[]> {
    return this.traceCallPath(projectRoot, qualifiedName, depth, "outbound", options);
```

#### Change 8: traceCallPath() signature and implementation (Line 2040-2187)
```
OLD (line 2040-2045):
  private async traceCallPath(
    projectRoot: string,
    qualifiedName: string,
    depth: number | undefined,
    direction: "outbound" | "inbound"
  ): Promise<CallGraphNode[]> {

NEW:
  private async traceCallPath(
    projectRoot: string,
    qualifiedName: string,
    depth: number | undefined,
    direction: "outbound" | "inbound",
    options?: { codebaseRoot?: string }
  ): Promise<CallGraphNode[]> {

OLD (line 2047):
    const status = await this.status(projectRoot);

NEW (add at line 2046):
  const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;
  
KEEP (line 2047):
    const status = await this.status(projectRoot, options);
      [pass options through]

OLD (line 2084):
      const projectName = await this.resolveProjectName(client, projectRoot);

NEW:
      const projectName = await this.resolveProjectName(client, effectiveCodebaseRoot);

OLD (line 2125):
        return this.callGraphViaCypher(detection.binary_path, projectName, qualifiedName, direction, clampedDepth, projectRoot);

NEW:
        return this.callGraphViaCypher(detection.binary_path, projectName, qualifiedName, direction, clampedDepth, effectiveCodebaseRoot);

OLD (line 2166):
        let callGraphNode = shapeCallGraphNode(node, projectRoot);

NEW:
        let callGraphNode = shapeCallGraphNode(node, effectiveCodebaseRoot);
```

#### Change 9: callGraphViaCypher() signature and implementation (Line 1971-2030)
```
OLD (line 1971-1977):
  private async callGraphViaCypher(
    binaryPath: string,
    projectName: string,
    qualifiedName: string,
    direction: "outbound" | "inbound",
    depth: number,
    projectRoot: string
  ): Promise<CallGraphNode[]> {

NEW:
  private async callGraphViaCypher(
    binaryPath: string,
    projectName: string,
    qualifiedName: string,
    direction: "outbound" | "inbound",
    depth: number,
    codebaseRoot: string
  ): Promise<CallGraphNode[]> {

OLD (line 2015):
        return shapeCallGraphNode(obj, projectRoot);

NEW:
        return shapeCallGraphNode(obj, codebaseRoot);
```

#### Change 10: query() signature and implementation (Line 838-906)
```
OLD (line 838):
  async query(projectRoot: string, rawQuery: string): Promise<unknown> {

NEW:
  async query(projectRoot: string, rawQuery: string, options?: { codebaseRoot?: string }): Promise<unknown> {

OLD (line 840):
    const status = await this.status(projectRoot);

NEW (add at line 839):
  const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;
  
KEEP (line 840):
    const status = await this.status(projectRoot, options);
      [pass options through]

OLD (line 874):
      const projectName = await this.resolveProjectName(client, projectRoot);

NEW:
      const projectName = await this.resolveProjectName(client, effectiveCodebaseRoot);
```

#### Change 11: verify() signature and implementation (Line 2260-2341)
```
OLD (line 2260-2263):
  async verify(
    projectRoot: string,
    options: VerifyOptions
  ): Promise<VerifyReport> {

NEW:
  async verify(
    projectRoot: string,
    options: VerifyOptions & { codebaseRoot?: string }
  ): Promise<VerifyReport> {

OLD (line 2265):
    const status = await this.status(projectRoot);

NEW (add at line 2264):
  const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;
  
KEEP (line 2265):
    const status = await this.status(projectRoot, options);
      [already passes options]

OLD (line 2309):
      const projectName = await this.resolveProjectName(client, projectRoot);

NEW:
      const projectName = await this.resolveProjectName(client, effectiveCodebaseRoot);
```

#### Change 12: resolveProjectName() signature and implementation (Line 658-678)
```
OLD (line 658-661):
  private async resolveProjectName(
    client: StdioClient,
    projectRoot: string
  ): Promise<string> {

NEW:
  private async resolveProjectName(
    client: StdioClient,
    codebaseRoot: string
  ): Promise<string> {

OLD (line 666):
    const match = projects.find((p) => p.root_path === projectRoot);

NEW:
    const match = projects.find((p) => p.root_path === codebaseRoot);

OLD (line 671):
          `Project root: ${projectRoot}`,

NEW:
          `Project root: ${codebaseRoot}`,
```

#### Change 13: transformNodeToEndpoint() signature and implementation (Line 951-1076)
```
OLD (line 951-955):
  private async transformNodeToEndpoint(
    node: CbmGraphNode,
    mapping: AnalyzerNodeMapping,
    projectRoot: string
  ): Promise<EndpointCandidate> {

NEW:
  private async transformNodeToEndpoint(
    node: CbmGraphNode,
    mapping: AnalyzerNodeMapping,
    codebaseRoot: string
  ): Promise<EndpointCandidate> {

OLD (line 1034-1036):
    let sourceFile = String(node.file_path ?? properties.file_path ?? properties.source_file ?? "");
    if (sourceFile && projectRoot) {
      try {
        sourceFile = path.relative(projectRoot, sourceFile);

NEW:
    let sourceFile = String(node.file_path ?? properties.file_path ?? properties.source_file ?? "");
    if (sourceFile && codebaseRoot) {
      try {
        sourceFile = path.relative(codebaseRoot, sourceFile);
```

#### Change 14: shapeClientSideEndpoint() signature and implementation (Line 1096-1132)
```
OLD (line 1096):
  private shapeClientSideEndpoint(node: CbmGraphNode, projectRoot: string): EndpointCandidate | null {

NEW:
  private shapeClientSideEndpoint(node: CbmGraphNode, codebaseRoot: string): EndpointCandidate | null {

OLD (line 1100-1103):
    let sourceFile = String(node.file_path ?? "");
    if (sourceFile && projectRoot) {
      try {
        sourceFile = path.relative(projectRoot, sourceFile);

NEW:
    let sourceFile = String(node.file_path ?? "");
    if (sourceFile && codebaseRoot) {
      try {
        sourceFile = path.relative(codebaseRoot, sourceFile);
```

#### Change 15: transformNodeToService() signature and implementation (Line 1323-1444)
```
OLD (line 1323-1328):
  private async transformNodeToService(
    node: CbmGraphNode,
    mapping: AnalyzerNodeMapping,
    projectRoot: string,
    promotionHeuristicNames: string[]
  ): Promise<ServiceCandidate> {

NEW:
  private async transformNodeToService(
    node: CbmGraphNode,
    mapping: AnalyzerNodeMapping,
    codebaseRoot: string,
    promotionHeuristicNames: string[]
  ): Promise<ServiceCandidate> {

OLD (line 1338-1341):
    let sourceFile = node.file_path ?? "";
    if (sourceFile && projectRoot) {
      try {
        sourceFile = path.relative(projectRoot, sourceFile);

NEW:
    let sourceFile = node.file_path ?? "";
    if (sourceFile && codebaseRoot) {
      try {
        sourceFile = path.relative(codebaseRoot, sourceFile);
```

---

## Implementation Order

1. **Update method signatures first** (non-breaking for public API if options params are optional):
   - status()
   - index()
   - endpoints()
   - services()
   - datastores()
   - callers()
   - callees()
   - query()
   - verify()

2. **Update private method signatures** (internal refactoring):
   - resolveProjectName()
   - transformNodeToEndpoint()
   - shapeClientSideEndpoint()
   - transformNodeToService()
   - traceCallPath()
   - callGraphViaCypher()

3. **Add effectiveCodebaseRoot resolution** in each public method that needs it

4. **Replace projectRoot with effectiveCodebaseRoot** in the specific operations (git ops, path.relative, resolveProjectName matching)

5. **Update all call sites** to pass effectiveCodebaseRoot to private methods and options through call chains

6. **Test coverage** (existing tests should continue to work since options is optional; add new tests for monorepo scenarios)

---

## Summary Table

| Method | Signature Change | effectiveCodebaseRoot Usage | Keep projectRoot For |
|--------|-----------------|-------------------------|----------------------|
| status | Add options param | git rev-parse | readIndexMeta |
| index | Extend options | git rev-parse, index_repository, resolveProjectName | readIndexMeta, writeIndexMeta, StagingAreaManager |
| endpoints | Add options param | resolveProjectName, transformNodeToEndpoint calls | status (via projectRoot param) |
| services | Add options param | resolveProjectName, transformNodeToService calls | status (via projectRoot param) |
| datastores | Add options param | resolveProjectName, path.relative calls | status (via projectRoot param) |
| callers | Add options param | Pass to traceCallPath | traceCallPath chain |
| callees | Add options param | Pass to traceCallPath | traceCallPath chain |
| query | Add options param | resolveProjectName | status (via projectRoot param) |
| verify | Extend options (VerifyOptions) | resolveProjectName | engine.computeReport |
| traceCallPath | Rename projectRoot→codebaseRoot, add options | resolveProjectName, callGraphViaCypher, shapeCallGraphNode | status (via projectRoot param) |
| callGraphViaCypher | Rename projectRoot→codebaseRoot | shapeCallGraphNode | — |
| resolveProjectName | Rename projectRoot→codebaseRoot | root_path matching | — |
| transformNodeToEndpoint | Rename projectRoot→codebaseRoot | path.relative() | — |
| shapeClientSideEndpoint | Rename projectRoot→codebaseRoot | path.relative() | — |
| transformNodeToService | Rename projectRoot→codebaseRoot | path.relative() | — |
