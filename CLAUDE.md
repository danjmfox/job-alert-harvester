# job-alert-harvester

## Development Paradigm

This project follows the **functional programming** paradigm. Use
@nw-functional-software-crafter for implementation.

`src/core/` is pure: no classes, no mutation, no `node:` builtins. All I/O lives
in `src/adapters/`; `src/cli/` is the composition root.

## Mutation Testing Strategy

nightly-delta
