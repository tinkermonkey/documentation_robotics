# Gap analysis: clef@cbm012-kind-tier0-qset2-spec012-layercrit, viewer against the in-sample corpora

Thresholds (0.6, 0.4, 0.6); model-asked cards; Wilson 95%; in-sample gold gold@relabel-full.jsonl. Analysis only.

## Bands by symbol kind

| scope     | group     | asked | accept (correct) | accept precision | not-element (correct) | not-element precision |
| --------- | --------- | ----- | ---------------- | ---------------- | --------------------- | --------------------- |
| viewer    | Class     | 10    | 2 (2)            | 100.0%           | 1 (1)                 | 100.0%                |
| viewer    | Function  | 88    | 1 (1)            | 100.0%           | 33 (33)               | 100.0%                |
| viewer    | Interface | 79    | 50 (41)          | 82.0%            | 7 (5)                 | 71.4%                 |
| viewer    | Method    | 28    | 0 (0)            | n/a              | 8 (7)                 | 87.5%                 |
| viewer    | Module    | 85    | 2 (2)            | 100.0%           | 2 (2)                 | 100.0%                |
| in-sample | Class     | 69    | 17 (17)          | 100.0%           | 0 (0)                 | n/a                   |
| in-sample | Function  | 111   | 22 (16)          | 72.7%            | 29 (29)               | 100.0%                |
| in-sample | Interface | 61    | 29 (27)          | 93.1%            | 6 (6)                 | 100.0%                |
| in-sample | Method    | 129   | 2 (1)            | 50.0%            | 53 (52)               | 98.1%                 |
| in-sample | Module    | 117   | 17 (17)          | 100.0%           | 17 (14)               | 82.4%                 |
| in-sample | Route     | 34    | 16 (16)          | 100.0%           | 0 (0)                 | n/a                   |

## Bands by predicted layer (accept) / all (not-element)

| scope     | group       | asked | accept (correct) | accept precision | not-element (correct) | not-element precision |
| --------- | ----------- | ----- | ---------------- | ---------------- | --------------------- | --------------------- |
| viewer    | application | 125   | 52 (43)          | 82.7%            | 0 (0)                 | n/a                   |
| viewer    | data-model  | 5     | 0 (0)            | n/a              | 0 (0)                 | n/a                   |
| viewer    | navigation  | 5     | 3 (3)            | 100.0%           | 0 (0)                 | n/a                   |
| viewer    | none        | 105   | 0 (0)            | n/a              | 51 (48)               | 94.1%                 |
| viewer    | ux          | 50    | 0 (0)            | n/a              | 0 (0)                 | n/a                   |
| in-sample | api         | 38    | 16 (16)          | 100.0%           | 0 (0)                 | n/a                   |
| in-sample | apm         | 4     | 2 (2)            | 100.0%           | 0 (0)                 | n/a                   |
| in-sample | application | 183   | 49 (46)          | 93.9%            | 0 (0)                 | n/a                   |
| in-sample | data-model  | 14    | 3 (3)            | 100.0%           | 0 (0)                 | n/a                   |
| in-sample | data-store  | 8     | 0 (0)            | n/a              | 0 (0)                 | n/a                   |
| in-sample | navigation  | 6     | 2 (2)            | 100.0%           | 0 (0)                 | n/a                   |
| in-sample | none        | 211   | 0 (0)            | n/a              | 105 (101)             | 96.2%                 |
| in-sample | security    | 7     | 0 (0)            | n/a              | 0 (0)                 | n/a                   |
| in-sample | testing     | 3     | 0 (0)            | n/a              | 0 (0)                 | n/a                   |
| in-sample | ux          | 47    | 31 (25)          | 80.6%            | 0 (0)                 | n/a                   |

## Bands by corpus part

| scope | group                       | asked | accept (correct) | accept precision | not-element (correct) | not-element precision |
| ----- | --------------------------- | ----- | ---------------- | ---------------- | --------------------- | --------------------- |
| all   | dr-cli                      | 300   | 53 (50)          | 94.3%            | 45 (44)               | 97.8%                 |
| all   | fastapi backend (Python)    | 52    | 16 (16)          | 100.0%           | 4 (4)                 | 100.0%                |
| all   | fastapi frontend (TS/React) | 96    | 32 (26)          | 81.3%            | 18 (16)               | 88.9%                 |
| all   | petclinic                   | 73    | 2 (2)            | 100.0%           | 38 (37)               | 97.4%                 |
| all   | viewer                      | 290   | 55 (46)          | 83.6%            | 51 (48)               | 94.1%                 |

## Bands by code part and symbol kind

| scope | group               | asked | accept (correct) | accept precision | not-element (correct) | not-element precision |
| ----- | ------------------- | ----- | ---------------- | ---------------- | --------------------- | --------------------- |
| all   | UI client Class     | 10    | 2 (2)            | 100.0%           | 1 (1)                 | 100.0%                |
| all   | UI client Function  | 131   | 21 (15)          | 71.4%            | 40 (40)               | 100.0%                |
| all   | UI client Interface | 80    | 50 (41)          | 82.0%            | 7 (5)                 | 71.4%                 |
| all   | UI client Method    | 40    | 0 (0)            | n/a              | 8 (7)                 | 87.5%                 |
| all   | UI client Module    | 125   | 14 (14)          | 100.0%           | 13 (11)               | 84.6%                 |
| all   | other Class         | 69    | 17 (17)          | 100.0%           | 0 (0)                 | n/a                   |
| all   | other Function      | 68    | 2 (2)            | 100.0%           | 22 (22)               | 100.0%                |
| all   | other Interface     | 60    | 29 (27)          | 93.1%            | 6 (6)                 | 100.0%                |
| all   | other Method        | 117   | 2 (1)            | 50.0%            | 53 (52)               | 98.1%                 |
| all   | other Module        | 77    | 5 (5)            | 100.0%           | 6 (5)                 | 83.3%                 |
| all   | other Route         | 34    | 16 (16)          | 100.0%           | 0 (0)                 | n/a                   |

## Wrong cards in viewer's bands

| band        | kind      | symbol                              | file                                       | predicted (layer p / type p)               | gold                    |
| ----------- | --------- | ----------------------------------- | ------------------------------------------ | ------------------------------------------ | ----------------------- |
| accept      | Interface | ErrorLogEntry                       | src/apps/embedded/services/errorTracker.ts | application.dataobject (0.81 / 0.77)       | apm.logrecord           |
| accept      | Interface | Annotation                          | src/apps/embedded/types/annotations.ts     | application.dataobject (0.76 / 0.79)       | data-model.objectschema |
| accept      | Interface | NavigationError                     | src/core/stores/crossLayerStore.ts         | application.dataobject (0.73 / 0.74)       | none                    |
| accept      | Interface | Layer                               | src/core/types/model.ts                    | application.dataobject (0.73 / 0.74)       | data-model.objectschema |
| accept      | Interface | PageRow                             | src/apps/embedded/data/pageData.ts         | application.dataobject (0.61 / 0.83)       | none                    |
| accept      | Interface | WebSocketEventMap                   | src/apps/embedded/types/websocket.ts       | application.applicationevent (0.74 / 0.45) | application.dataobject  |
| accept      | Interface | ParsedViewportParam                 | src/apps/embedded/ui/graphViewport.ts      | application.dataobject (0.65 / 0.77)       | none                    |
| accept      | Interface | UnsubscribeMessage                  | src/apps/embedded/types/websocket.ts       | application.applicationevent (0.70 / 0.48) | application.dataobject  |
| accept      | Interface | ScopedViewport                      | src/apps/embedded/ui/graphViewport.ts      | application.dataobject (0.68 / 0.65)       | none                    |
| not-element | Method    | postapichangesetschangesetIddiscard | src/core/services/generatedApiClient.ts    | none (0.62)                                | api.operation           |
| not-element | Interface | DeleteAnnotationInput               | src/apps/embedded/data/useAnnotations.ts   | none (0.62)                                | application.dataobject  |
| not-element | Interface | paths                               | src/core/types/api-client.ts               | none (0.78)                                | api.paths               |

In-sample wrong accepts, for comparison:

| corpus  | kind      | symbol                 | predicted                      | gold                            |
| ------- | --------- | ---------------------- | ------------------------------ | ------------------------------- |
| dr-cli  | Interface | VersionData            | application.dataobject         | data-model.objectschema         |
| dr-cli  | Method    | collect                | application.applicationprocess | application.applicationfunction |
| dr-cli  | Interface | LayerDistFile          | application.dataobject         | none                            |
| fastapi | Function  | TooltipProvider        | ux.librarycomponent            | none                            |
| fastapi | Function  | DropdownMenuSubContent | ux.librarycomponent            | none                            |
| fastapi | Function  | DialogFooter           | ux.librarycomponent            | none                            |
| fastapi | Function  | DropdownMenuShortcut   | ux.librarycomponent            | none                            |
| fastapi | Function  | DialogDescription      | ux.librarycomponent            | none                            |
| fastapi | Function  | SidebarTrigger         | ux.actioncomponent             | ux.librarycomponent             |

## In-sample accept precision re-weighted to viewer's accept-band mix

| stratum                      | in-sample precision at viewer's mix | viewer accepted cards covered | strata with no in-sample accepts                                 |
| ---------------------------- | ----------------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| none (raw pool)              | 91.3%                               | -                             | -                                                                |
| code part (UI client or not) | 81.3%                               | 55 of 55                      | -                                                                |
| symbol kind                  | 93.2%                               | 55 of 55                      | -                                                                |
| predicted layer              | 94.2%                               | 55 of 55                      | -                                                                |
| predicted type               | 93.6%                               | 52 of 55                      | application.applicationevent (2), navigation.navigationgraph (1) |

## The fit's optimism, measured in-sample

Leave one corpus out: fit on the other two, score the left-out corpus at that fit.

| left out  | fit on the others | in-fit accept precision | left-out accept (correct) | left-out precision | in-fit not-element precision | left-out not-element (correct) | left-out precision |
| --------- | ----------------- | ----------------------- | ------------------------- | ------------------ | ---------------------------- | ------------------------------ | ------------------ |
| dr-cli    | (0.6, 0.3, 0.6)   | 88.5%                   | 79 (65)                   | 82.3%              | 95.0%                        | 45 (44)                        | 97.8%              |
| fastapi   | (0.5, 0.4, 0.5)   | 92.6%                   | 58 (48)                   | 82.8%              | 92.7%                        | 39 (26)                        | 66.7%              |
| petclinic | (0.8, 0.5, 0.6)   | 100.0%                  | 0 (0)                     | n/a                | 95.5%                        | 38 (37)                        | 97.4%              |

Bootstrap (1000 resamples within each corpus, 1000 with a fit): precision at each resample's own fit, in the resample (in-bag) and on the cards it left out (out-of-bag), card-weighted over resamples.

| band        | in-bag precision | out-of-bag precision | optimism (points) |
| ----------- | ---------------- | -------------------- | ----------------- |
| accept      | 92.7%            | 87.6%                | 5.1               |
| not-element | 97.8%            | 96.5%                | 1.3               |

## viewer over the in-sample fit's bootstrap distribution

The thresholds the in-sample bootstrap picks (most common first), and viewer's bands at each: how much the held-out result depends on which fastapi cards the fit happened to see. Not used to choose thresholds.

| in-sample fit               | share of resamples | viewer accept (correct) | precision (95%)   | viewer not-element (correct) | precision (95%)   |
| --------------------------- | ------------------ | ----------------------- | ----------------- | ---------------------------- | ----------------- |
| (0.8, 0.5, 0.6)             | 18.4%              | 8 (7)                   | 87.5% (52.9-97.8) | 51 (48)                      | 94.1% (84.1-98.0) |
| (0.6, 0.4, 0.6)             | 16.2%              | 55 (46)                 | 83.6% (71.7-91.1) | 51 (48)                      | 94.1% (84.1-98.0) |
| (0.8, 0.5, 0.7)             | 10.7%              | 8 (7)                   | 87.5% (52.9-97.8) | 24 (23)                      | 95.8% (79.8-99.3) |
| (0.6, 0.4, 0.7)             | 10.6%              | 55 (46)                 | 83.6% (71.7-91.1) | 24 (23)                      | 95.8% (79.8-99.3) |
| (0.8, 0.6, 0.6)             | 10.4%              | 6 (5)                   | 83.3% (43.6-97.0) | 51 (48)                      | 94.1% (84.1-98.0) |
| (0.5, 0.4, 0.6)             | 8.1%               | 73 (61)                 | 83.6% (73.4-90.3) | 51 (48)                      | 94.1% (84.1-98.0) |
| (0.8, 0.6, 0.7)             | 6.4%               | 6 (5)                   | 83.3% (43.6-97.0) | 24 (23)                      | 95.8% (79.8-99.3) |
| (0.5, 0.4, 0.7)             | 5.6%               | 73 (61)                 | 83.6% (73.4-90.3) | 24 (23)                      | 95.8% (79.8-99.3) |
| (0.6, 0.1, 0.6)             | 2.3%               | 94 (80)                 | 85.1% (76.5-90.9) | 51 (48)                      | 94.1% (84.1-98.0) |
| **all resamples, weighted** | 100%               | 35.9 per run            | 84.3%             | 40.3 per run                 | 94.5%             |

## The labelling-process confound on the relabelled in-sample cards (`gold@relabel-1116.jsonl`)

| corpus    | relabelled, model-asked | in accept band | correct vs October gold | vs today's gold | in not-element band | correct vs October | vs today's |
| --------- | ----------------------- | -------------- | ----------------------- | --------------- | ------------------- | ------------------ | ---------- |
| dr-cli    | 17                      | 5              | 5                       | 5               | 4                   | 4                  | 4          |
| fastapi   | 11                      | 2              | 2                       | 2               | 2                   | 2                  | 2          |
| petclinic | 8                       | 0              | 0                       | 0               | 2                   | 2                  | 2          |
| pooled    | 36                      | 7              | 7                       | 7               | 8                   | 8                  | 8          |
