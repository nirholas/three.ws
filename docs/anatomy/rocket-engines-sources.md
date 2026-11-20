# Rocket engine and launch stack cutaways: sources

Sources for the two featured cutaways on [/anatomy](https://three.ws/anatomy):

- Engine: `85160213-4c15-4b00-ba96-5990b9385249`, spec in [api/_lib/anatomy/featured/ffsc-engine.js](../../api/_lib/anatomy/featured/ffsc-engine.js).
- Launch stack: `d72da3e9-8aae-47cd-a96c-45ccd33bf1a0`, spec in [api/_lib/anatomy/featured/launch-stack.js](../../api/_lib/anatomy/featured/launch-stack.js).

These rules apply to every visible fact:

- Every figure a visitor can read is listed here, with the source and date of the public statement.
- A figure that belongs to a specific engine or vehicle is marked **publicly reported**. General physics is marked **general engineering**.
- Real vehicles are named only as nominative references. The models carry no logos, markings or trade dress.
- Sources were read on 20 November 2026.

Where a source could not be fetched directly, the table says how its text was read. The line-by-line audit is in [rocket-engines-review.md](rocket-engines-review.md). [tests/anatomy-featured.test.js](../../tests/anatomy-featured.test.js) fails when a number appears in a featured spec without appearing in that design's table below.

## Source list

| Key | Source | Date of statement | How it was read |
| --- | --- | --- | --- |
| S1 | Teslarati, "Elon Musk says SpaceX making good progress on Starship's upgraded Raptor 2 engines", https://www.teslarati.com/elon-musk-spacex-starship-raptor-2-engine-progress/ | 3 January 2022 (article 4 January 2022) | Direct |
| S2 | Elon Musk post on X, https://x.com/elonmusk/status/1657249739925258240 ("Raptor V3 just achieved 350 bar chamber pressure (269 tons of thrust)"), recapped at https://newspaceeconomy.ca/2026/04/16/spacex-raptor-3-engines-and-the-next-step-in-starship-propulsion/ | about 13 May 2023 | Via the recap and a forum thread dated 15 May 2023 |
| S3 | Spaceflight Now, Will Robinson-Smith, "SpaceX targets May 19 for debut of Starship Super Heavy Version 3", https://spaceflightnow.com/2026/05/12/spacex-targets-may-19-for-debut-of-starship-super-heavy-version-3-launch-pad-2/ | 12 May 2026 | Direct |
| S4 | The maker's vehicle page, https://www.spacex.com/vehicles/starship | Undated page, read 20 November 2026 | The page renders client-side, so its specification text was read from the search index. Every figure was cross-checked against S13. |
| S5 | Wikipedia, "SpaceX Super Heavy", https://en.wikipedia.org/wiki/SpaceX_Super_Heavy (gimbal layout cites NASASpaceFlight, 12 October 2024) | 12 October 2024 | Direct |
| S6 | Wikipedia, "Staged combustion cycle", https://en.wikipedia.org/wiki/Staged_combustion_cycle (full-flow section cites Sippel et al., 2012) | 2012 | Direct |
| S7 | Starbench, "Full Flow Staged Combustion and the King of the Engines", https://starbench.substack.com/p/full-flow-staged-combustion-and-the | 14 October 2026 | Direct |
| S8 | Wikipedia, "SpaceX Raptor", https://en.wikipedia.org/wiki/SpaceX_Raptor (sub-cooling cites Musk, 28 September 2017) | 28 September 2017 | Direct |
| S9 | Wikipedia, "Turbopump", https://en.wikipedia.org/wiki/Turbopump | not applicable | Direct |
| S10 | Wikipedia, "De Laval nozzle", https://en.wikipedia.org/wiki/De_Laval_nozzle | not applicable | Direct |
| S11 | Wikipedia, "Shock diamond", https://en.wikipedia.org/wiki/Shock_diamond | not applicable | Direct |
| S12 | Wikipedia, "Regenerative cooling (rocketry)", https://en.wikipedia.org/wiki/Regenerative_cooling_(rocketry) | not applicable | Direct |
| S13 | Wikipedia, "SpaceX Starship", https://en.wikipedia.org/wiki/SpaceX_Starship (Block 3 table and infobox) | read 20 November 2026 | Direct |
| S14 | Wikipedia, "Starship flight test 2", https://en.wikipedia.org/wiki/Starship_flight_test_2 | 18 November 2023 | Direct |
| S15 | Wikipedia, "Starship flight test 5", https://en.wikipedia.org/wiki/Starship_flight_test_5 | 13 October 2024 | Direct |
| S16 | Wikipedia, "SpaceX Starship (spacecraft)", https://en.wikipedia.org/wiki/SpaceX_Starship_(spacecraft) (tiles cite CNBC, 2021) | 2021 onward | Direct |
| S17 | Wikipedia, "Starship flight 15", https://en.wikipedia.org/wiki/Starship_flight_15, citing NASASpaceFlight (13 November 2026), the maker's post on X (14 November 2026) and CBS News, William Harwood (14 November 2026) | 13 and 14 November 2026 | Direct |
| S18 | Phys.org (Associated Press), "SpaceX's Starship soars into orbit after booster explosion prevents an unprecedented double catch", https://phys.org/news/2026-11-spacex-starship-soars-orbit-booster.html | 14 November 2026 | Direct |

## Engine: full-flow staged-combustion methalox rocket engine

### Figures

| As shown | Status | Source | Date |
| --- | --- | --- | --- |
| 300 bar main chamber pressure, "operates routinely", reported in January 2022 | publicly reported | S1 | 3 January 2022 |
| 350 bar in a single Raptor 3 test, May 2023 (the version number 3 is part of the name) | publicly reported | S2 | about 13 May 2023 |
| 250 tonnes-force at sea level, 275 in the vacuum version, reported by the maker on 12 May 2026 | publicly reported | S3 (S4 also lists 250 tf) | 12 May 2026 |
| 33 engines on the booster | publicly reported | S5, S13 | 2024 onward |
| 13 maneuverable centre engines, the other 20 around the perimeter | publicly reported | S5 | 12 October 2024 |
| Mach 1 at the throat (the gas becomes sonic) | general engineering | S10 | not applicable |

### Statements

| As shown | Status | Source |
| --- | --- | --- |
| Separate fuel-rich and oxygen-rich preburners, one turbopump per propellant on its own shaft | general engineering | S6 |
| The full flow of both propellants passes through the turbines | general engineering | S6 |
| Both propellants reach the injector fully gasified (gas-gas), and full gasification leads to faster reactions in the chamber | general engineering | S6 |
| No seal between the two propellants is needed inside a turbine | general engineering | S7 |
| With more mass flow the turbines run cooler and at lower pressure | general engineering | S6 |
| Hot oxygen-rich gas is harsh on turbines and plumbing and sets strict materials requirements | general engineering | S6, S7 |
| Propellants are sub-cooled in the launch system that uses this engine | publicly reported | S8 (Musk, 28 September 2017) |
| Inducer upstream of the impeller, "as on virtually every rocket turbopump", to prevent cavitation | general engineering | S9 |
| The bell turns thermal energy into kinetic energy, and the flow is sonic at the throat | general engineering | S10 |
| Shock diamonds form when the exhaust leaves at a lower pressure than the surrounding air (over-expanded) | general engineering | S11 |
| Methane cools the chamber and nozzle walls regeneratively, then feeds the fuel-rich preburner | general engineering | S8, S12 |
| Coolant typically enters at the nozzle exit and flows up past the throat toward the injector; Raptor's exact channel path is not publicly documented | general engineering | S12 |

## Launch stack: fully reusable two-stage super-heavy launch system

### Figures

| As shown | Status | Source | Date |
| --- | --- | --- | --- |
| 124 m stack | publicly reported | S4 (S13 gives 124.4 m for Block 3) | page read November 2026 |
| 72 m booster | publicly reported | S4 (S13 gives 72.3 m) | page read November 2026 |
| 52 m upper stage | publicly reported | S4 (124.4 m minus 72.3 m in S13 is 52.1 m) | page read November 2026 |
| 9 m diameter | publicly reported | S4, S13 | page read November 2026 |
| 33 booster engines: 13 maneuverable in the centre, 20 around the perimeter | publicly reported | S5 | 12 October 2024 |
| 8,240 tonnes-force booster thrust | publicly reported | S4 (S13: 80.8 MN, which is 8,240 tf) | page read November 2026 |
| 3,650 tonnes of booster propellant | publicly reported | S4, S13 | page read November 2026 |
| 1,600 tonnes of upper stage propellant | publicly reported | S4, S13 | page read November 2026 |
| 1,614 tonnes-force upper stage thrust | publicly reported | S4 | page read November 2026 |
| 6 upper stage engines: 3 sea level and 3 vacuum | publicly reported | S13 | read November 2026 |
| 3 grid fins, down from 4 | publicly reported | S13 ("three grid fins instead of the prior four") | read November 2026 |
| Hot staging first done on the second flight test, 18 November 2023 | publicly reported | S14 | 18 November 2023 |
| Integrated hot stage revealed 12 May 2026 | publicly reported | S3 | 12 May 2026 |
| Boostback listed among the successes of the fifth flight test | publicly reported | S15 | 13 October 2024 |
| First booster catch on the fifth flight test, 13 October 2024 | publicly reported | S15 | 13 October 2024 |
| Fifteenth flight test launched 13 November 2026; the tower arms caught the upper stage on 14 November 2026, a first | publicly reported | S17 | 13 and 14 November 2026 |
| The booster on the fifteenth flight did not complete its catch and was diverted to a splashdown | publicly reported | S17, S18 | 14 November 2026 |
| Four flaps: 2 forward and 2 aft | publicly reported | S16 | not applicable |
| Two header tanks in the nose, oxygen at the tip and methane directly below | publicly reported | S16 | not applicable |

### Statements

| As shown | Status | Source |
| --- | --- | --- |
| Hot staging fires the next stage before separation, with most booster engines already shut down | publicly reported | S14 |
| The integrated hot stage exposes the forward dome of the booster's fuel tank during hot staging | publicly reported | S3 |
| The vacuum engine variant has a much larger nozzle that improves efficiency in space | general engineering | S13 |
| Hexagonal heat shield tiles face the airflow on re-entry | publicly reported | S16 |
| Two tower arms close around a returning stage and hold it | publicly reported | S15, S17 |
| Shock diamonds form when the exhaust leaves at a different pressure from the surrounding air | general engineering | S11 |
| Both stages are designed to return and fly again | publicly reported (design intent) | S4, S13 |
