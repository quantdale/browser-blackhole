## 1. Lock the three laws

- [ ] 1.1 Add a unit test that names the accretion-disk law, the stellar-explosion ramp, and the compact-merger locus.
- [ ] 1.2 Assert they are pairwise unequal at one interior temperature where the current implementations already differ.
- [ ] 1.3 Assert each capped law returns the endpoint color above its ceiling, and that the stellar-explosion ramp still accepts a temperature between 40000 K and 1e7 K.

## 2. Ceiling call sites

- [ ] 2.1 Find every compact-merger color call site. Record any argument above 40000 K.
- [ ] 2.2 If one exists, change it so it does not claim a distinguishable hotter tint. Do not change a call that already passes the ceiling except to cover it in the test.
- [ ] 2.3 Do not edit anchors, gamma shaping, or golden images.

## 3. Gate

- [ ] 3.1 Run the new unit test.
- [ ] 3.2 Run `openspec validate --change temperature-color-law-contract --strict`.
