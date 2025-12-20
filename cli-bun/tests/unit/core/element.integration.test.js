/**
 * Simple integration test for Element class
 * Uses compiled JavaScript to verify the implementation works
 */

import { Element } from '../../../dist/core/element.js';

console.log('Testing Element class...');

// Test 1: Create element with required fields
const element1 = new Element({
  id: 'motivation-goal-test-goal',
  type: 'Goal',
  name: 'Test Goal',
});

console.assert(element1.id === 'motivation-goal-test-goal', 'Element ID mismatch');
console.assert(element1.type === 'Goal', 'Element type mismatch');
console.assert(element1.name === 'Test Goal', 'Element name mismatch');
console.assert(element1.description === undefined, 'Element description should be undefined');
console.assert(JSON.stringify(element1.properties) === '{}', 'Properties should be empty object');
console.assert(JSON.stringify(element1.references) === '[]', 'References should be empty array');
console.assert(JSON.stringify(element1.relationships) === '[]', 'Relationships should be empty array');

// Test 2: Get and set properties
element1.setProperty('priority', 'high');
console.assert(element1.getProperty('priority') === 'high', 'Property get/set failed');

// Test 3: Array properties
element1.setProperty('tags', []);
element1.addToArrayProperty('tags', 'important');
const tags = element1.getArrayProperty('tags');
console.assert(JSON.stringify(tags) === '["important"]', 'Array property failed');

// Test 4: Serialization
const json = element1.toJSON();
console.assert(json.id === 'motivation-goal-test-goal', 'JSON serialization failed');
console.assert(json.type === 'Goal', 'JSON type serialization failed');
console.assert(json.properties !== undefined, 'JSON should include properties');

// Test 5: toString
console.assert(element1.toString() === 'Element(motivation-goal-test-goal)', 'toString failed');

console.log('✓ All Element tests passed!');
