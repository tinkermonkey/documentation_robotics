import { describe, test, expect, beforeEach } from "bun:test";
import { ArchiMateImporter } from "../../src/import/archimate-importer.js";
import { Model } from "../../src/core/model.js";

describe("ArchiMateImporter", () => {
  let importer: ArchiMateImporter;
  let model: Model;

  beforeEach(async () => {
    importer = new ArchiMateImporter();
    model = new Model();
  });

  test("imports valid ArchiMate XML with motivation elements", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <model>
        <elements>
          <element identifier="goal-1" xsi:type="Goal">
            <name>Customer Satisfaction</name>
            <documentation>Achieve high customer satisfaction</documentation>
          </element>
        </elements>
        <relationships />
      </model>`;

    const result = await importer.import(xml, model);

    expect(result.success).toBe(true);
    expect(result.nodesAdded).toBe(1);
    expect(result.edgesAdded).toBe(0);
    expect(result.errorsCount).toBe(0);

    const node = model.graph.getNode("goal-1");
    expect(node).toBeDefined();
    expect(node?.name).toBe("Customer Satisfaction");
    expect(node?.layer).toBe("motivation");
  });

  test("imports ArchiMate business elements", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <model>
        <elements>
          <element identifier="service-1" xsi:type="BusinessService">
            <name>Order Processing</name>
          </element>
        </elements>
        <relationships />
      </model>`;

    const result = await importer.import(xml, model);

    expect(result.success).toBe(true);
    const node = model.graph.getNode("service-1");
    expect(node?.layer).toBe("business");
    expect(node?.type).toBe("business-service");
  });

  test("imports ArchiMate application elements", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <model>
        <elements>
          <element identifier="app-1" xsi:type="ApplicationComponent">
            <name>Order Service</name>
          </element>
        </elements>
        <relationships />
      </model>`;

    const result = await importer.import(xml, model);

    expect(result.success).toBe(true);
    const node = model.graph.getNode("app-1");
    expect(node?.layer).toBe("application");
  });

  test("imports ArchiMate relationships", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <model>
        <elements>
          <element identifier="goal-1" xsi:type="Goal">
            <name>Goal 1</name>
          </element>
          <element identifier="goal-2" xsi:type="Goal">
            <name>Goal 2</name>
          </element>
        </elements>
        <relationships>
          <relationship identifier="rel-1" source="goal-1" target="goal-2">
            <name>supports</name>
          </relationship>
        </relationships>
      </model>`;

    const result = await importer.import(xml, model);

    expect(result.success).toBe(true);
    expect(result.nodesAdded).toBe(2);
    expect(result.edgesAdded).toBe(1);

    const edge = model.graph.getAllEdges().find((e) => e.id === "rel-1");
    expect(edge).toBeDefined();
    expect(edge?.source).toBe("goal-1");
    expect(edge?.destination).toBe("goal-2");
  });

  test("handles invalid XML", async () => {
    const xml = `<invalid>not proper</xml`;

    const result = await importer.import(xml, model);

    expect(result.success).toBe(false);
    expect(result.errorsCount).toBeGreaterThan(0);
  });

  test("handles missing root element", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <notmodel>
        <elements />
      </notmodel>`;

    const result = await importer.import(xml, model);

    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toContain("Root element must be 'model'");
  });

  test("handles missing elements section", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <model>
        <relationships />
      </model>`;

    const result = await importer.import(xml, model);

    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toContain("No elements section found");
  });

  test("handles element without identifier", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <model>
        <elements>
          <element xsi:type="Goal">
            <name>Goal without ID</name>
          </element>
        </elements>
        <relationships />
      </model>`;

    const result = await importer.import(xml, model);

    expect(result.success).toBe(false);
    expect(result.errorsCount).toBeGreaterThan(0);
  });

  test("handles unsupported element types", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <model>
        <elements>
          <element identifier="unknown-1" xsi:type="UnknownType">
            <name>Unknown</name>
          </element>
        </elements>
        <relationships />
      </model>`;

    const result = await importer.import(xml, model);

    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toContain("Unable to infer layer");
  });

  test("handles relationships referencing non-existent nodes", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <model>
        <elements>
          <element identifier="goal-1" xsi:type="Goal">
            <name>Goal 1</name>
          </element>
        </elements>
        <relationships>
          <relationship identifier="rel-1" source="goal-1" target="nonexistent">
            <name>supports</name>
          </relationship>
        </relationships>
      </model>`;

    const result = await importer.import(xml, model);

    expect(result.success).toBe(false);
    expect(result.nodesAdded).toBe(1);
    expect(result.edgesAdded).toBe(0);
    expect(result.errorsCount).toBeGreaterThan(0);
  });

  test("supports configured formats", () => {
    expect(importer.supportedFormats).toContain("xml");
    expect(importer.supportedFormats.length).toBe(1);
  });
});
