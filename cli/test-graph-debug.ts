import { Element } from "@/core/element";
import { ReferenceRegistry } from "@/core/reference-registry";
import { DependencyTracker } from "@/core/dependency-tracker";

const registry = new ReferenceRegistry();

const elem01 = new Element({
  id: '01-motivation-goal-create-customer',
  type: 'goal',
  name: 'Create Customer Goal',
  references: [
    {
      source: '01-motivation-goal-create-customer',
      target: '02-business-process-create-order',
      type: 'realizes',
    },
  ],
});

const elem02 = new Element({
  id: '02-business-process-create-order',
  type: 'process',
  name: 'Create Order Process',
  references: [
    {
      source: '02-business-process-create-order',
      target: '03-security-policy-access-control',
      type: 'requires',
    },
  ],
});

const elem03 = new Element({
  id: '03-security-policy-access-control',
  type: 'policy',
  name: 'Access Control Policy',
});

registry.registerElement(elem01);
registry.registerElement(elem02);
registry.registerElement(elem03);

const graph = registry.getDependencyGraph();

console.log("Graph nodes:", graph.nodes());
console.log("Graph edges:", graph.edges());
console.log("Graph order:", graph.order);
console.log("Graph size:", graph.size);

const tracker = new DependencyTracker(graph);

// Test the first failure
const dependents = tracker.getTransitiveDependents('03-security-policy-access-control');
console.log("Transitive dependents of 03-security-policy-access-control:", dependents);

// Test the second failure
const cycles = tracker.detectCycles();
console.log("Cycles:", cycles);
