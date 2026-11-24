import { describe, it } from 'vitest'

// S§D1 surface. Live assertion (verified RED against the empty stubs in the scaffold PR):
//   Object.keys(main).sort()    -> ['defineTarget', 'defineTemplate', 'ogImagePlugin']
//   Object.keys(next).sort()    -> ['createOgRoute', 'ogMetadata', 'withHead']
//   Object.keys(testing).sort() -> ['installTestRuntime', 'ogKit']
// Flipped to a real test in the task that wires the last export (plan Task 8).
describe('public surface (S§D1)', () => {
  it.todo('exports exactly the agreed runtime names')
})
