# Cloth test fixtures

`gigawatt_fe.json` is a decoded Source 2 FeModel sidecar (the `m_feModel` cloth-solver
block) for one shipped hero, captured as ground truth for the cloth rest-pose and harness
regressions (`useClothSim.restpose.test.ts`, `useClothSim.harness.test.ts`).

Regenerate it from a Deadlock VPK with the sibling vpkmerge CLI (JSON output of the
`model femodel` command). The JSON shape matches the FeModel field map documented in
vpkmerge `docs/source2-preview-data-contract.md`.
