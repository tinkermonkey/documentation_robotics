#!/usr/bin/env node
/**
 * Script to populate the baseline test model with elements and relationships
 * Used to ensure the golden copy has test data for integration tests
 */

import { Model } from '../src/core/model.js';
import { Element } from '../src/core/element.js';
import { Layer } from '../src/core/layer.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Resolve the workspace root directory from the script's location
 * This script is located at cli/scripts/populate-baseline-model.ts
 * @returns The workspace root path
 */
function resolveWorkspaceRoot(): string {
  // Get the directory where this script is located
  const __filename = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(__filename);

  // Navigate from cli/scripts/ -> cli/ -> workspace root
  return path.resolve(scriptDir, '../../');
}

async function populateBaseline() {
  const workspaceRoot = resolveWorkspaceRoot();
  const baselineDir = path.join(workspaceRoot, 'cli-validation/test-project/baseline');

  try {
    // Verify the baseline directory exists
    try {
      await fs.stat(baselineDir);
    } catch (error) {
      throw new Error(
        `Baseline directory not found at: ${baselineDir}\n` +
        `Resolved workspace root: ${workspaceRoot}\n` +
        `Please ensure you are running this script from the workspace root or that the baseline directory exists.`
      );
    }

    // Load or create model
    let model = await Model.load(baselineDir);
    if (!model) {
      throw new Error('Could not load or create model');
    }

    // Add motivation layer elements
    const motivationLayer = new Layer('motivation');
    motivationLayer.addElement(
      new Element({
        id: 'motivation.goal.manage-tasks',
        path: 'manage-tasks',
        name: 'Manage Personal Tasks',
        type: 'goal',
        description: 'Allow users to manage their personal task lists',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'motivation',
      })
    );
    model.addLayer(motivationLayer);
    await model.saveLayer('motivation');
    console.log('✓ Populated motivation layer');

    // Add business layer elements
    const businessLayer = new Layer('business');
    businessLayer.addElement(
      new Element({
        id: 'business.service.task-management',
        path: 'task-management',
        name: 'Task Management Service',
        type: 'service',
        description: 'Business capability for task management',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'business',
      })
    );
    businessLayer.addElement(
      new Element({
        id: 'business.process.create-task-process',
        path: 'create-task-process',
        name: 'Create Task Process',
        type: 'process',
        description: 'Business process for creating tasks',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'business',
      })
    );
    businessLayer.addElement(
      new Element({
        id: 'business.actor.end-user',
        path: 'end-user',
        name: 'End User',
        type: 'actor',
        description: 'End user of the task management system',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'business',
      })
    );
    model.addLayer(businessLayer);
    await model.saveLayer('business');
    console.log('✓ Populated business layer');

    // Add application layer elements
    const applicationLayer = new Layer('application');
    applicationLayer.addElement(
      new Element({
        id: 'application.service.todo-api-service',
        path: 'todo-api-service',
        name: 'Todo API Service',
        type: 'service',
        description: 'Application service implementing task management',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'application',
      })
    );
    model.addLayer(applicationLayer);
    await model.saveLayer('application');
    console.log('✓ Populated application layer');

    // Add API layer elements
    const apiLayer = new Layer('api');
    apiLayer.addElement(
      new Element({
        id: 'api.operation.list-todos',
        path: 'list-todos',
        name: 'List Todos',
        type: 'operation',
        description: 'List all todos',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'api',
      })
    );
    apiLayer.addElement(
      new Element({
        id: 'api.operation.create-todo',
        path: 'create-todo',
        name: 'Create Todo',
        type: 'operation',
        description: 'Create a new todo',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'api',
      })
    );
    apiLayer.addElement(
      new Element({
        id: 'api.operation.update-todo',
        path: 'update-todo',
        name: 'Update Todo',
        type: 'operation',
        description: 'Update an existing todo',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'api',
      })
    );
    apiLayer.addElement(
      new Element({
        id: 'api.operation.delete-todo',
        path: 'delete-todo',
        name: 'Delete Todo',
        type: 'operation',
        description: 'Delete a todo',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'api',
      })
    );
    model.addLayer(apiLayer);
    await model.saveLayer('api');
    console.log('✓ Populated api layer');

    // Add data-model layer elements
    const dataModelLayer = new Layer('data-model');
    dataModelLayer.addElement(
      new Element({
        id: 'data-model.entity.todo-object',
        path: 'todo-object',
        name: 'Todo Object',
        type: 'entity',
        description: 'Todo data model object',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'data-model',
      })
    );
    model.addLayer(dataModelLayer);
    await model.saveLayer('data-model');
    console.log('✓ Populated data-model layer');

    // Add data-store layer elements
    const dataStoreLayer = new Layer('data-store');
    dataStoreLayer.addElement(
      new Element({
        id: 'data-store.table.todos-table',
        path: 'todos-table',
        name: 'Todos Table',
        type: 'table',
        description: 'Database table for todos',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'data-store',
      })
    );
    dataStoreLayer.addElement(
      new Element({
        id: 'data-store.column.todos-id-column',
        path: 'todos-id-column',
        name: 'Id Column',
        type: 'column',
        description: 'Primary key column',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'data-store',
      })
    );
    dataStoreLayer.addElement(
      new Element({
        id: 'data-store.column.todos-title-column',
        path: 'todos-title-column',
        name: 'Title Column',
        type: 'column',
        description: 'Title column',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'data-store',
      })
    );
    dataStoreLayer.addElement(
      new Element({
        id: 'data-store.column.todos-done-column',
        path: 'todos-done-column',
        name: 'Done Column',
        type: 'column',
        description: 'Done status column',
        attributes: {},
        relationships: [],
        references: [],
        layer: 'data-store',
      })
    );
    model.addLayer(dataStoreLayer);
    await model.saveLayer('data-store');
    console.log('✓ Populated data-store layer');

    // Add relationships
    model.relationships.add({
      source: 'business.service.task-management',
      target: 'motivation.goal.manage-tasks',
      predicate: 'supports-goals',
      layer: 'business',
      targetLayer: 'motivation',
      category: 'traceability',
    });

    model.relationships.add({
      source: 'application.service.todo-api-service',
      target: 'business.service.task-management',
      predicate: 'realizes-services',
      layer: 'application',
      targetLayer: 'business',
      category: 'structural',
    });

    model.relationships.add({
      source: 'api.operation.list-todos',
      target: 'application.service.todo-api-service',
      predicate: 'exposes',
      layer: 'api',
      targetLayer: 'application',
      category: 'structural',
    });

    model.relationships.add({
      source: 'api.operation.create-todo',
      target: 'application.service.todo-api-service',
      predicate: 'exposes',
      layer: 'api',
      targetLayer: 'application',
      category: 'structural',
    });

    model.relationships.add({
      source: 'api.operation.update-todo',
      target: 'application.service.todo-api-service',
      predicate: 'exposes',
      layer: 'api',
      targetLayer: 'application',
      category: 'structural',
    });

    model.relationships.add({
      source: 'api.operation.delete-todo',
      target: 'application.service.todo-api-service',
      predicate: 'exposes',
      layer: 'api',
      targetLayer: 'application',
      category: 'structural',
    });

    model.relationships.add({
      source: 'data-model.entity.todo-object',
      target: 'data-store.table.todos-table',
      predicate: 'maps-to',
      layer: 'data-model',
      targetLayer: 'data-store',
      category: 'data',
    });

    // Intra-layer relationships
    model.relationships.add({
      source: 'data-store.table.todos-table',
      predicate: 'composes',
      target: 'data-store.column.todos-id-column',
      category: 'structural',
      layer: 'data-store',
    });

    model.relationships.add({
      source: 'data-store.table.todos-table',
      predicate: 'composes',
      target: 'data-store.column.todos-title-column',
      category: 'structural',
      layer: 'data-store',
    });

    model.relationships.add({
      source: 'data-store.table.todos-table',
      predicate: 'composes',
      target: 'data-store.column.todos-done-column',
      category: 'structural',
      layer: 'data-store',
    });

    model.relationships.add({
      source: 'business.process.create-task-process',
      predicate: 'serves',
      target: 'business.actor.end-user',
      category: 'behavioral',
      layer: 'business',
    });

    await model.saveRelationships();
    await model.saveManifest();
    console.log('✓ Added relationships');

    console.log('\n✅ Baseline model successfully populated!');
  } catch (error) {
    console.error('❌ Error populating baseline:', error);
    process.exit(1);
  }
}

populateBaseline();
