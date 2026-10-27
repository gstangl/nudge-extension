export default [
  {id:'existing-fast-gate',requirement:'Preserve the existing required local gate.',defined_in:'CONTRIBUTING.md#tests',harness:{kind:'command',run:'npm run test:ci --prefix test'},cadence:'on_change'},
  {id:'bridge-reference',requirement:'BR-01/02/03/05/08/12 independent external effects.',defined_in:'docs/specs/bridge-delivery.md',harness:{kind:'command',run:'node test/bridge-conformance.mjs'},cadence:'on_change'},
  {id:'bridge-negative-controls',requirement:'BR-11 rejects lost, duplicated and misrouted stored effects.',defined_in:'docs/specs/bridge-delivery.md',harness:{kind:'command',run:'node test/bridge-mutants.mjs'},cadence:'on_change'},
  {id:'rust-unit',requirement:'Experimental Rust module checks.',defined_in:'docs/specs/bridge-delivery.md',harness:{kind:'command',run:'cargo test --locked --manifest-path bridge-rust/Cargo.toml'},cadence:'on_change'},
]
