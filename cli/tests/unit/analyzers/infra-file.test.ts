/**
 * INFRA_FILE: the files infrastructure nodes come from, which a `since` extraction keeps in scope
 * beside source files (#1107 review).
 */

import { describe, it, expect } from "bun:test";
import { INFRA_FILE } from "../../../src/analyzers/cards/build.js";

describe("INFRA_FILE", () => {
  it("takes compose, Kubernetes, Helm, Chart.yaml, SQL and Dockerfiles", () => {
    for (const file of [
      "compose.yml",
      "docker-compose.override.yaml",
      "deploy/compose.prod.yml",
      "k8s/web.yml",
      "k8s/block-storage.yaml",
      "kubernetes/clock-deployment.yaml",
      "helm/app/templates/deployment.yaml",
      "charts/app/values.yaml",
      "charts/app/Chart.yaml",
      "Chart.yaml",
      "db/h2/schema.sql",
      "Dockerfile",
      "backend/Dockerfile.dev",
      "Containerfile",
    ]) {
      expect({ file, infra: INFRA_FILE.test(file) }).toEqual({ file, infra: true });
    }
  });

  it("leaves out lockfiles, CI workflows and other YAML", () => {
    for (const file of [
      "pnpm-lock.yaml",
      "k8s/pnpm-lock.yaml",
      "deploy/app.lock.yml",
      "yarn.lock",
      ".github/workflows/deploy.yml",
      ".github/workflows/k8s/deploy.yml",
      ".gitlab/ci/k8s/deploy.yml",
      "src/main/resources/application.yml",
      "block-storage.yaml",
      "clock-deployment.yaml",
    ]) {
      expect({ file, infra: INFRA_FILE.test(file) }).toEqual({ file, infra: false });
    }
  });
});
