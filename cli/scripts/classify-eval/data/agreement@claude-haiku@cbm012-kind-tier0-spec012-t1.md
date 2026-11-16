# Agreement as a gate: claude-haiku@cbm012-kind-tier0-spec012-t1 beside clef@cbm012-kind-tier0-qset2-spec012-layercrit

Generated 2026-11-16T19:08:16.269Z by `agreement-report.ts`. A = `clef@cbm012-kind-tier0-qset2-spec012-layercrit` (dr-qset-2, served by cloudflare-workers-ai), B = `claude-haiku@cbm012-kind-tier0-spec012-t1`, B2 = `claude-haiku@cbm012-kind-tier0-spec012-t2` (a second take of B). A's bands at T_layer 0.6, T_type 0.4, T_none 0.6 (the defaults in `bands.ts`). Intervals are Wilson 95%. A card whose call failed has no answer: it counts as wrong, and agrees with nothing.

## Accuracy on every gold card

| scope                                          | run | cards | layer                         | type, end to end              | layer against A: lost / gained (p) | type against A: lost / gained (p) |
| ---------------------------------------------- | --- | ----- | ----------------------------- | ----------------------------- | ---------------------------------- | --------------------------------- |
| viewer (held out)                              | A   | 300   | 250 of 300, 83.3% (78.7-87.1) | 222 of 300, 74.0% (68.8-78.6) |                                    |                                   |
|                                                | B   | 300   | 199 of 300, 66.3% (60.8-71.4) | 164 of 300, 54.7% (49.0-60.2) | 68 / 17 (< 0.001)                  | 85 / 27 (< 0.001)                 |
|                                                | B2  | 300   | 205 of 300, 68.3% (62.9-73.3) | 171 of 300, 57.0% (51.3-62.5) | 64 / 19 (< 0.001)                  | 79 / 28 (< 0.001)                 |
| in-sample, pooled (dr-cli, fastapi, petclinic) | A   | 606   | 539 of 606, 88.9% (86.2-91.2) | 485 of 606, 80.0% (76.7-83.0) |                                    |                                   |
|                                                | B   | 606   | 427 of 606, 70.5% (66.7-74.0) | 382 of 606, 63.0% (59.1-66.8) | 152 / 40 (< 0.001)                 | 152 / 49 (< 0.001)                |
|                                                | B2  | 606   | 439 of 606, 72.4% (68.8-75.8) | 396 of 606, 65.3% (61.5-69.0) | 138 / 38 (< 0.001)                 | 136 / 47 (< 0.001)                |
| dr-cli                                         | A   | 300   | 264 of 300, 88.0% (83.8-91.2) | 224 of 300, 74.7% (69.5-79.3) |                                    |                                   |
|                                                | B   | 300   | 202 of 300, 67.3% (61.8-72.4) | 169 of 300, 56.3% (50.7-61.8) | 88 / 26 (< 0.001)                  | 91 / 36 (< 0.001)                 |
|                                                | B2  | 300   | 207 of 300, 69.0% (63.6-74.0) | 176 of 300, 58.7% (53.0-64.1) | 81 / 24 (< 0.001)                  | 82 / 34 (< 0.001)                 |
| fastapi                                        | A   | 200   | 173 of 200, 86.5% (81.1-90.6) | 161 of 200, 80.5% (74.5-85.4) |                                    |                                   |
|                                                | B   | 200   | 148 of 200, 74.0% (67.5-79.6) | 137 of 200, 68.5% (61.8-74.5) | 38 / 13 (< 0.001)                  | 36 / 12 (< 0.001)                 |
|                                                | B2  | 200   | 154 of 200, 77.0% (70.7-82.3) | 143 of 200, 71.5% (64.9-77.3) | 32 / 13 (0.007)                    | 30 / 12 (0.008)                   |
| petclinic                                      | A   | 106   | 102 of 106, 96.2% (90.7-98.5) | 100 of 106, 94.3% (88.2-97.4) |                                    |                                   |
|                                                | B   | 106   | 77 of 106, 72.6% (63.5-80.2)  | 76 of 106, 71.7% (62.5-79.4)  | 26 / 1 (< 0.001)                   | 25 / 1 (< 0.001)                  |
|                                                | B2  | 106   | 78 of 106, 73.6% (64.5-81.0)  | 77 of 106, 72.6% (63.5-80.2)  | 25 / 1 (< 0.001)                   | 24 / 1 (< 0.001)                  |

## Gates on A's model-asked cards

An element answer is right when its layer and type match gold; a `none` answer when gold says `none`. Coverage is of the scope's model-asked cards.

### viewer (held out): 290 asked cards

| gate                               | passed as an element (coverage) | right                         | passed as none (coverage) | right                       |
| ---------------------------------- | ------------------------------- | ----------------------------- | ------------------------- | --------------------------- |
| A's bands (0.6 / 0.4 / 0.6)        | 55 (19.0%)                      | 46 of 55, 83.6% (71.7-91.1)   | 51 (17.6%)                | 48 of 51, 94.1% (84.1-98.0) |
| A and B agree                      | 137 (47.2%)                     | 103 of 137, 75.2% (67.3-81.7) | 29 (10.0%)                | 25 of 29, 86.2% (69.4-94.5) |
| A and B2 agree                     | 134 (46.2%)                     | 105 of 134, 78.4% (70.6-84.5) | 31 (10.7%)                | 29 of 31, 93.5% (79.3-98.2) |
| B and B2 agree                     | 216 (74.5%)                     | 119 of 216, 55.1% (48.4-61.6) | 29 (10.0%)                | 26 of 29, 89.7% (73.6-96.4) |
| A, B and B2 agree                  | 122 (42.1%)                     | 96 of 122, 78.7% (70.6-85.0)  | 26 (9.0%)                 | 24 of 26, 92.3% (75.9-97.9) |
| A's bands, where B agrees          | 52 (17.9%)                      | 44 of 52, 84.6% (72.5-92.0)   | 22 (7.6%)                 | 21 of 22, 95.5% (78.2-99.2) |
| B, every answer                    | 257 (88.6%)                     | 128 of 257, 49.8% (43.7-55.9) | 33 (11.4%)                | 27 of 33, 81.8% (65.6-91.4) |
| B, self-reported confidence >= 0.8 | 28 (9.7%)                       | 17 of 28, 60.7% (42.4-76.4)   | 22 (7.6%)                 | 20 of 22, 90.9% (72.2-97.5) |

- Where A and B disagree (124 cards): A is right on 85, B on 27, neither on 12.
- A answers none for 17 of 182 gold elements and gives an element for 20 of 108 gold none; B answers none for 6 of 182 gold elements and gives an element for 81 of 108 gold none.
- Between B and B2, 44 of 289 asked cards (15.2%) change layer or type; 10 of them flip between an element and none.

### in-sample, pooled (dr-cli, fastapi, petclinic): 521 asked cards

| gate                               | passed as an element (coverage) | right                         | passed as none (coverage) | right                         |
| ---------------------------------- | ------------------------------- | ----------------------------- | ------------------------- | ----------------------------- |
| A's bands (0.6 / 0.4 / 0.6)        | 103 (19.8%)                     | 97 of 103, 94.2% (87.9-97.3)  | 105 (20.2%)               | 100 of 105, 95.2% (89.3-97.9) |
| A and B agree                      | 231 (44.3%)                     | 200 of 231, 86.6% (81.6-90.4) | 50 (9.6%)                 | 48 of 50, 96.0% (86.5-98.9)   |
| A and B2 agree                     | 240 (46.1%)                     | 207 of 240, 86.3% (81.3-90.0) | 59 (11.3%)                | 57 of 59, 96.6% (88.5-99.1)   |
| B and B2 agree                     | 400 (76.8%)                     | 236 of 400, 59.0% (54.1-63.7) | 53 (10.2%)                | 43 of 53, 81.1% (68.6-89.4)   |
| A, B and B2 agree                  | 224 (43.0%)                     | 197 of 224, 87.9% (83.0-91.6) | 44 (8.4%)                 | 43 of 44, 97.7% (88.2-99.6)   |
| A's bands, where B agrees          | 94 (18.0%)                      | 88 of 94, 93.6% (86.8-97.0)   | 41 (7.9%)                 | 39 of 41, 95.1% (83.9-98.7)   |
| B, every answer                    | 458 (87.9%)                     | 249 of 458, 54.4% (49.8-58.9) | 63 (12.1%)                | 48 of 63, 76.2% (64.4-85.0)   |
| B, self-reported confidence >= 0.8 | 96 (18.4%)                      | 77 of 96, 80.2% (71.1-86.9)   | 41 (7.9%)                 | 37 of 41, 90.2% (77.5-96.1)   |

- Where A and B disagree (240 cards): A is right on 152, B on 49, neither on 39.
- A answers none for 38 of 339 gold elements and gives an element for 9 of 182 gold none; B answers none for 15 of 339 gold elements and gives an element for 134 of 182 gold none.
- Between B and B2, 68 of 521 asked cards (13.1%) change layer or type; 27 of them flip between an element and none.

### dr-cli: 300 asked cards

| gate                               | passed as an element (coverage) | right                         | passed as none (coverage) | right                         |
| ---------------------------------- | ------------------------------- | ----------------------------- | ------------------------- | ----------------------------- |
| A's bands (0.6 / 0.4 / 0.6)        | 53 (17.7%)                      | 52 of 53, 98.1% (90.1-99.7)   | 45 (15.0%)                | 43 of 45, 95.6% (85.2-98.8)   |
| A and B agree                      | 138 (46.0%)                     | 119 of 138, 86.2% (79.5-91.0) | 14 (4.7%)                 | 14 of 14, 100.0% (78.5-100.0) |
| A and B2 agree                     | 141 (47.0%)                     | 122 of 141, 86.5% (79.9-91.2) | 21 (7.0%)                 | 20 of 21, 95.2% (77.3-99.2)   |
| B and B2 agree                     | 238 (79.3%)                     | 144 of 238, 60.5% (54.2-66.5) | 20 (6.7%)                 | 12 of 20, 60.0% (38.7-78.1)   |
| A, B and B2 agree                  | 132 (44.0%)                     | 116 of 132, 87.9% (81.2-92.4) | 12 (4.0%)                 | 12 of 12, 100.0% (75.7-100.0) |
| A's bands, where B agrees          | 44 (14.7%)                      | 43 of 44, 97.7% (88.2-99.6)   | 9 (3.0%)                  | 9 of 9, 100.0% (70.1-100.0)   |
| B, every answer                    | 275 (91.7%)                     | 155 of 275, 56.4% (50.5-62.1) | 25 (8.3%)                 | 14 of 25, 56.0% (37.1-73.3)   |
| B, self-reported confidence >= 0.8 | 37 (12.3%)                      | 24 of 37, 64.9% (48.8-78.2)   | 15 (5.0%)                 | 11 of 15, 73.3% (48.0-89.1)   |

- Where A and B disagree (148 cards): A is right on 91, B on 36, neither on 21.
- A answers none for 22 of 210 gold elements and gives an element for 3 of 90 gold none; B answers none for 11 of 210 gold elements and gives an element for 76 of 90 gold none.
- Between B and B2, 42 of 300 asked cards (14.0%) change layer or type; 16 of them flip between an element and none.

### fastapi: 148 asked cards

| gate                               | passed as an element (coverage) | right                        | passed as none (coverage) | right                       |
| ---------------------------------- | ------------------------------- | ---------------------------- | ------------------------- | --------------------------- |
| A's bands (0.6 / 0.4 / 0.6)        | 48 (32.4%)                      | 43 of 48, 89.6% (77.8-95.5)  | 22 (14.9%)                | 20 of 22, 90.9% (72.2-97.5) |
| A and B agree                      | 71 (48.0%)                      | 61 of 71, 85.9% (76.0-92.2)  | 14 (9.5%)                 | 12 of 14, 85.7% (60.1-96.0) |
| A and B2 agree                     | 76 (51.4%)                      | 64 of 76, 84.2% (74.4-90.7)  | 16 (10.8%)                | 15 of 16, 93.8% (71.7-98.9) |
| B and B2 agree                     | 116 (78.4%)                     | 71 of 116, 61.2% (52.1-69.6) | 14 (9.5%)                 | 12 of 14, 85.7% (60.1-96.0) |
| A, B and B2 agree                  | 70 (47.3%)                      | 61 of 70, 87.1% (77.3-93.1)  | 13 (8.8%)                 | 12 of 13, 92.3% (66.7-98.6) |
| A's bands, where B agrees          | 48 (32.4%)                      | 43 of 48, 89.6% (77.8-95.5)  | 11 (7.4%)                 | 9 of 11, 81.8% (52.3-94.9)  |
| B, every answer                    | 132 (89.2%)                     | 73 of 132, 55.3% (46.8-63.5) | 16 (10.8%)                | 12 of 16, 75.0% (50.5-89.8) |
| B, self-reported confidence >= 0.8 | 46 (31.1%)                      | 40 of 46, 87.0% (74.3-93.9)  | 7 (4.7%)                  | 7 of 7, 100.0% (64.6-100.0) |

- Where A and B disagree (63 cards): A is right on 36, B on 12, neither on 15.
- A answers none for 14 of 103 gold elements and gives an element for 5 of 45 gold none; B answers none for 4 of 103 gold elements and gives an element for 33 of 45 gold none.
- Between B and B2, 18 of 148 asked cards (12.2%) change layer or type; 5 of them flip between an element and none.

### petclinic: 73 asked cards

| gate                               | passed as an element (coverage) | right                         | passed as none (coverage) | right                         |
| ---------------------------------- | ------------------------------- | ----------------------------- | ------------------------- | ----------------------------- |
| A's bands (0.6 / 0.4 / 0.6)        | 2 (2.7%)                        | 2 of 2, 100.0% (34.2-100.0)   | 38 (52.1%)                | 37 of 38, 97.4% (86.5-99.5)   |
| A and B agree                      | 22 (30.1%)                      | 20 of 22, 90.9% (72.2-97.5)   | 22 (30.1%)                | 22 of 22, 100.0% (85.1-100.0) |
| A and B2 agree                     | 23 (31.5%)                      | 21 of 23, 91.3% (73.2-97.6)   | 22 (30.1%)                | 22 of 22, 100.0% (85.1-100.0) |
| B and B2 agree                     | 46 (63.0%)                      | 21 of 46, 45.7% (32.2-59.8)   | 19 (26.0%)                | 19 of 19, 100.0% (83.2-100.0) |
| A, B and B2 agree                  | 22 (30.1%)                      | 20 of 22, 90.9% (72.2-97.5)   | 19 (26.0%)                | 19 of 19, 100.0% (83.2-100.0) |
| A's bands, where B agrees          | 2 (2.7%)                        | 2 of 2, 100.0% (34.2-100.0)   | 21 (28.8%)                | 21 of 21, 100.0% (84.5-100.0) |
| B, every answer                    | 51 (69.9%)                      | 21 of 51, 41.2% (28.8-54.8)   | 22 (30.1%)                | 22 of 22, 100.0% (85.1-100.0) |
| B, self-reported confidence >= 0.8 | 13 (17.8%)                      | 13 of 13, 100.0% (77.2-100.0) | 19 (26.0%)                | 19 of 19, 100.0% (83.2-100.0) |

- Where A and B disagree (29 cards): A is right on 25, B on 1, neither on 3.
- A answers none for 2 of 26 gold elements and gives an element for 1 of 47 gold none; B answers none for 0 of 26 gold elements and gives an element for 25 of 47 gold none.
- Between B and B2, 8 of 73 asked cards (11.0%) change layer or type; 6 of them flip between an element and none.

## viewer: the cards where A's bands disagree with gold

The cards a maintainer's ruling would settle, with every run's answer (A's with its layer and type probability).

### Accept band, layer or type not gold's: 9

| card                                                                   | A                                          | B                            | B2                           | gold                    |
| ---------------------------------------------------------------------- | ------------------------------------------ | ---------------------------- | ---------------------------- | ----------------------- |
| Interface `ErrorLogEntry`, src/apps/embedded/services/errorTracker.ts  | application.dataobject (0.81 / 0.77)       | application.dataobject       | application.dataobject       | apm.logrecord           |
| Interface `Annotation`, src/apps/embedded/types/annotations.ts         | application.dataobject (0.76 / 0.79)       | application.dataobject       | application.dataobject       | data-model.objectschema |
| Interface `NavigationError`, src/core/stores/crossLayerStore.ts        | application.dataobject (0.73 / 0.74)       | application.dataobject       | application.dataobject       | none                    |
| Interface `Layer`, src/core/types/model.ts                             | application.dataobject (0.73 / 0.74)       | application.dataobject       | application.dataobject       | data-model.objectschema |
| Interface `PageRow`, src/apps/embedded/data/pageData.ts                | application.dataobject (0.61 / 0.83)       | application.dataobject       | ux (no type)                 | none                    |
| Interface `WebSocketEventMap`, src/apps/embedded/types/websocket.ts    | application.applicationevent (0.74 / 0.45) | application.applicationevent | application.applicationevent | application.dataobject  |
| Interface `ParsedViewportParam`, src/apps/embedded/ui/graphViewport.ts | application.dataobject (0.65 / 0.77)       | application.dataobject       | application.dataobject       | none                    |
| Interface `UnsubscribeMessage`, src/apps/embedded/types/websocket.ts   | application.applicationevent (0.70 / 0.48) | application.dataobject       | application.dataobject       | application.dataobject  |
| Interface `ScopedViewport`, src/apps/embedded/ui/graphViewport.ts      | application.dataobject (0.68 / 0.65)       | application.dataobject       | application.dataobject       | none                    |

### Not-element band, gold an element: 3

| card                                                                                  | A           | B                      | B2                     | gold                   |
| ------------------------------------------------------------------------------------- | ----------- | ---------------------- | ---------------------- | ---------------------- |
| Method `postapichangesetschangesetIddiscard`, src/core/services/generatedApiClient.ts | none (0.62) | api.operation          | api.operation          | api.operation          |
| Interface `DeleteAnnotationInput`, src/apps/embedded/data/useAnnotations.ts           | none (0.62) | application.dataobject | application.dataobject | application.dataobject |
| Interface `paths`, src/core/types/api-client.ts                                       | none (0.78) | none                   | none                   | api.paths              |
