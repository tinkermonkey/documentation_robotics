# Agreement as a gate: claude-haiku@cbm012-tier0-spec012-nokindnote beside clef@cbm012-kind-tier0-qset2-spec012-layercrit

Generated 2026-11-16T19:08:16.380Z by `agreement-report.ts`. A = `clef@cbm012-kind-tier0-qset2-spec012-layercrit` (dr-qset-2, served by cloudflare-workers-ai), B = `claude-haiku@cbm012-tier0-spec012-nokindnote`. A's bands at T_layer 0.6, T_type 0.4, T_none 0.6 (the defaults in `bands.ts`). Intervals are Wilson 95%. A card whose call failed has no answer: it counts as wrong, and agrees with nothing.

## Accuracy on every gold card

| scope             | run | cards | layer                         | type, end to end              | layer against A: lost / gained (p) | type against A: lost / gained (p) |
| ----------------- | --- | ----- | ----------------------------- | ----------------------------- | ---------------------------------- | --------------------------------- |
| viewer (held out) | A   | 300   | 250 of 300, 83.3% (78.7-87.1) | 222 of 300, 74.0% (68.8-78.6) |                                    |                                   |
|                   | B   | 300   | 193 of 300, 64.3% (58.8-69.5) | 168 of 300, 56.0% (50.3-61.5) | 73 / 16 (< 0.001)                  | 79 / 25 (< 0.001)                 |

## Gates on A's model-asked cards

An element answer is right when its layer and type match gold; a `none` answer when gold says `none`. Coverage is of the scope's model-asked cards.

### viewer (held out): 290 asked cards

| gate                               | passed as an element (coverage) | right                         | passed as none (coverage) | right                       |
| ---------------------------------- | ------------------------------- | ----------------------------- | ------------------------- | --------------------------- |
| A's bands (0.6 / 0.4 / 0.6)        | 55 (19.0%)                      | 46 of 55, 83.6% (71.7-91.1)   | 51 (17.6%)                | 48 of 51, 94.1% (84.1-98.0) |
| A and B agree                      | 106 (36.6%)                     | 85 of 106, 80.2% (71.6-86.7)  | 52 (17.9%)                | 49 of 52, 94.2% (84.4-98.0) |
| A's bands, where B agrees          | 49 (16.9%)                      | 42 of 49, 85.7% (73.3-92.9)   | 39 (13.4%)                | 38 of 39, 97.4% (86.8-99.5) |
| B, every answer                    | 219 (75.5%)                     | 110 of 219, 50.2% (43.7-56.8) | 70 (24.1%)                | 49 of 70, 70.0% (58.5-79.5) |
| B, self-reported confidence >= 0.8 | 22 (7.6%)                       | 17 of 22, 77.3% (56.6-89.9)   | 43 (14.8%)                | 37 of 43, 86.0% (72.7-93.4) |

- Where A and B disagree (131 cards): A is right on 79, B on 25, neither on 27.
- A answers none for 17 of 182 gold elements and gives an element for 20 of 108 gold none; B answers none for 21 of 182 gold elements and gives an element for 59 of 108 gold none.

## viewer: the cards where A's bands disagree with gold

The cards a maintainer's ruling would settle, with every run's answer (A's with its layer and type probability).

### Accept band, layer or type not gold's: 9

| card                                                                   | A                                          | B                            | gold                    |
| ---------------------------------------------------------------------- | ------------------------------------------ | ---------------------------- | ----------------------- |
| Interface `ErrorLogEntry`, src/apps/embedded/services/errorTracker.ts  | application.dataobject (0.81 / 0.77)       | application.dataobject       | apm.logrecord           |
| Interface `Annotation`, src/apps/embedded/types/annotations.ts         | application.dataobject (0.76 / 0.79)       | application.dataobject       | data-model.objectschema |
| Interface `NavigationError`, src/core/stores/crossLayerStore.ts        | application.dataobject (0.73 / 0.74)       | application.dataobject       | none                    |
| Interface `Layer`, src/core/types/model.ts                             | application.dataobject (0.73 / 0.74)       | application.dataobject       | data-model.objectschema |
| Interface `PageRow`, src/apps/embedded/data/pageData.ts                | application.dataobject (0.61 / 0.83)       | ux (no type)                 | none                    |
| Interface `WebSocketEventMap`, src/apps/embedded/types/websocket.ts    | application.applicationevent (0.74 / 0.45) | application.applicationevent | application.dataobject  |
| Interface `ParsedViewportParam`, src/apps/embedded/ui/graphViewport.ts | application.dataobject (0.65 / 0.77)       | application.dataobject       | none                    |
| Interface `UnsubscribeMessage`, src/apps/embedded/types/websocket.ts   | application.applicationevent (0.70 / 0.48) | application.dataobject       | application.dataobject  |
| Interface `ScopedViewport`, src/apps/embedded/ui/graphViewport.ts      | application.dataobject (0.68 / 0.65)       | application.dataobject       | none                    |

### Not-element band, gold an element: 3

| card                                                                                  | A           | B                      | gold                   |
| ------------------------------------------------------------------------------------- | ----------- | ---------------------- | ---------------------- |
| Method `postapichangesetschangesetIddiscard`, src/core/services/generatedApiClient.ts | none (0.62) | api.operation          | api.operation          |
| Interface `DeleteAnnotationInput`, src/apps/embedded/data/useAnnotations.ts           | none (0.62) | application.dataobject | application.dataobject |
| Interface `paths`, src/core/types/api-client.ts                                       | none (0.78) | none                   | api.paths              |
