# Known Issues

The current alpha-readiness scope intentionally leaves the following items unresolved.

- Request validation: invalid limits, empty or huge source, and invalid policy values are not rejected up front.
- Size limits: source size, stdin size, testcase count, and output policy upper bounds are not centrally enforced.
- Checker timeout/cancellation: custom checkers can hang or block without a runtime-managed timeout.
- Progress hooks: artifact fetch/load, compile, and execute lifecycle events are not exposed.
- Structured error classes: public errors are still message-based except for the node runtime not-implemented error.
- Node runtime implementation: `@cupya.me/wasm-judge-runtime-node` is an explicit not-implemented package.
