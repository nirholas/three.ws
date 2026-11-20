# Rocket engine and launch stack cutaways: line-by-line review

This is the audit of every label and every number a visitor can read in the two featured cutaways on [/anatomy](https://three.ws/anatomy). The source keys (S1 to S18) refer to the source list in [rocket-engines-sources.md](rocket-engines-sources.md).

- Engine: [three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249](https://three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249)
- Launch stack: [three.ws/anatomy/d72da3e9-8aae-47cd-a96c-45ccd33bf1a0](https://three.ws/anatomy/d72da3e9-8aae-47cd-a96c-45ccd33bf1a0)

Reviewed on 20 November 2026 against the specs in [api/_lib/anatomy/featured/](../../api/_lib/anatomy/featured/).

## How to read this review

Confidence levels:

- **High.** The text matches a source that was read directly, or it is textbook engineering covered by a general reference.
- **Medium.** The source was read indirectly (through a search index or a recap), or the text describes a typical arrangement that the source does not confirm for this exact vehicle. Medium items are worded to say so on screen ("typically", "as listed on the maker's vehicle page").
- **Low.** Nothing is shown at low confidence. Anything that could not be sourced was removed (see the last table).

Grok narration does not add facts. Each narrated step sends only the step text and the descriptions of the parts it focuses on, the system prompt forbids new facts, and [api/_lib/anatomy/narrate.js](../../api/_lib/anatomy/narrate.js) discards any answer containing a number that is not in those facts. So this review also covers everything the narrator can say.

## Engine: full-flow staged-combustion methalox rocket engine

### Numbers

| Where it appears | Number as shown | Source | Confidence |
| --- | --- | --- | --- |
| Main combustion chamber; tour step 8 | 300 bar main chamber pressure, reported January 2022 as routine | S1 | High |
| Tour step 8 | 350 bar in a single Raptor 3 test, May 2023 | S2 | Medium (read through a recap and a forum thread, not the original post) |
| Tour step 10 | 250 tonnes-force at sea level and 275 in the vacuum version, reported by the maker on 12 May 2026 | S3, S4 | High |
| Engine mount; tour step 10 | 33 engines on the booster | S5, S13 | High |
| Engine mount | 13 maneuverable centre engines, 20 around the perimeter | S5 | High |
| Title, parts | "two preburners", "two turbopumps", "two shafts" | S6 (cycle definition) | High |

### Parts

| Label | Claim in the description | Source | Confidence |
| --- | --- | --- | --- |
| Engine mount | Attaches at the top; 13 maneuverable centre engines and 20 on the perimeter of the booster | S5 | High |
| Oxygen-rich gas dome | Collects oxygen-rich turbine exhaust above the injector | S6 | High |
| Fuel-rich gas manifold | Ring that feeds fuel-rich turbine exhaust into the injector | S6 | Medium (the ring layout is the schematic arrangement; the route itself is sourced) |
| Main injector | Both propellants arrive gasified (gas-gas); faster reactions | S6 | High |
| Injector elements | Meter and mix both hot gas streams | S6 | High |
| Main combustion chamber | Gases finish burning at very high pressure; 300 bar in January 2022 | S1, S6 | High |
| Coolant outlet manifold | Collects warmed methane and sends it to the fuel-rich preburner | S8, S12 | High |
| Regeneratively cooled nozzle | Converts thermal to kinetic energy; methane cools the wall, then feeds the preburner | S8, S10, S12 | High |
| Coolant inlet manifold | Coolant enters at the nozzle exit; Raptor's exact channel path is not public | S12 | Medium (typical layout, stated as such) |
| Coolant supply line | Carries methane from the pump to the nozzle exit, as in a typical engine | S12 | Medium (typical layout, stated as such) |
| Coolant return line | Takes warmed methane into the fuel-rich preburner | S8, S12 | High |
| Methane inlet, Oxygen inlet | Propellants are sub-cooled in the launch system that uses this engine | S8 | High |
| Methane pump housing, Oxygen pump housing | Encloses inducer and impeller, collects output into the discharge line | S9 | High |
| Methane turbopump shaft, Oxygen turbopump shaft | One shaft per propellant, turbine turns the pump directly | S6, S7 | High |
| Methane inducer, Oxygen inducer | Inducer upstream of the impeller, "as on virtually every rocket turbopump", prevents cavitation | S9 | High |
| Methane pump impeller, Oxygen pump impeller | Centrifugal impeller | S9 | High |
| Fuel-rich turbine | Drives only the methane pump | S6 | High |
| Oxygen-rich turbine | Drives only the oxygen pump; oxygen-rich gas sets the strictest materials requirements | S6, S7 | High |
| Fuel-rich turbine housing, Oxygen-rich turbine housing | Holds the gas around the turbine blades | S9 | High |
| Fuel-rich preburner | All the methane, a small portion of the oxygen | S6 | High |
| Oxygen-rich preburner | All the oxygen, a small portion of the methane | S6 | High |
| Fuel-rich gas duct, Oxygen-rich gas duct | Nothing dumped overboard; all exhaust goes to the main chamber | S6 | High |
| Oxygen discharge line | Carries oxygen from the pump to the oxygen-rich preburner | S6 | High |

### Effects and flows

| Label | Source | Confidence |
| --- | --- | --- |
| Fuel-rich combustion, Oxygen-rich combustion, Main combustion | S6 | High |
| Throat (flow becomes sonic) | S10 | High |
| Exhaust plume with shock diamonds (over-expanded exhaust) | S11 | High |
| Flows: liquid methane, methane in the cooling channels, liquid oxygen, fuel-rich gas, oxygen-rich gas, main combustion gas | S6, S12 | High |

### Tour

| Step | Title | Sources | Confidence |
| --- | --- | --- | --- |
| 1 | Two cryogenic propellants | S8 | High |
| 2 | Two turbopumps, two shafts (no inter-propellant seal) | S6, S7 | High |
| 3 | Methane cools the engine | S12 | Medium (path described as typical) |
| 4 | The fuel-rich preburner | S6 | High |
| 5 | The oxygen-rich preburner | S6, S7 | High |
| 6 | Full flow, nothing dumped (cooler, lower pressure turbines) | S6 | High |
| 7 | Gas meets gas | S6 | High |
| 8 | The main chamber (300 and 350 bar) | S1, S2 | High for 300 bar, medium for 350 bar |
| 9 | Throat, bell and shock diamonds | S10, S11 | High |
| 10 | The whole loop (250 and 275 tonnes-force, 33 engines) | S3, S4, S5 | High |

## Launch stack: fully reusable two-stage super-heavy launch system

### Numbers

| Where it appears | Number as shown | Source | Confidence |
| --- | --- | --- | --- |
| Tour step 1 | 124 m stack | S4, cross-checked with S13 (124.4 m) | Medium (S4 read through the search index; S13 agrees) |
| Booster; tour step 1 | 72 m booster | S4, S13 (72.3 m) | Medium (as above) |
| Upper stage; tour step 1 | 52 m upper stage | S4, S13 (52.1 m by subtraction) | Medium (as above) |
| Booster; tour step 1 | 9 m diameter | S4, S13 | High |
| Engine section; tour steps 2, 4 and 10 | 33 booster engines | S5, S13 | High |
| Centre engines, Inner engine ring; tour step 2 | 13 maneuverable centre engines | S5 | High |
| Outer engine ring; tour step 2 | 20 perimeter engines | S5 | High |
| Tour step 2 | 8,240 tonnes-force booster thrust | S4, S13 (80.8 MN) | High |
| Booster oxygen tank; tour steps 3 and 10 | 3,650 tonnes of booster propellant | S4, S13 | High |
| Upper-stage oxygen tank; tour steps 6 and 10 | 1,600 tonnes of upper stage propellant | S4, S13 | High |
| Tour step 6 | 1,614 tonnes-force upper stage thrust | S4 | Medium (single source, read through the search index) |
| Upper-stage engine section; tour steps 6 and 10 | 6 engines: 3 sea level, 3 vacuum | S13 | High |
| Grid fins; tour step 7 | 3 grid fins, down from 4 | S13 | High |
| Tour step 5 | Hot staging first done on the second flight test, 18 November 2023 | S14 | High |
| Tour step 5 | Integrated hot stage revealed 12 May 2026 | S3 | High |
| Catch arm; tour steps 7 and 8 | First booster catch on the fifth flight test, 13 October 2024 | S15 | High |
| Catch arm; tour step 9 | Fifteenth flight test launched 13 November 2026; first upper stage catch 14 November 2026 | S17, S18 | High |
| Upper-stage flaps; tour step 9 | 4 flaps: 2 forward, 2 aft | S16 | High |
| Nose section; tour step 9 | 2 header tanks | S16 | High |

### Parts

| Label | Claim in the description | Source | Confidence |
| --- | --- | --- | --- |
| Booster | 72 m by 9 m, designed to return and be caught | S4, S13, S15 | Medium for the length, high otherwise |
| Engine section | Base of the booster, 33 engines mounted | S5 | High |
| Centre engines, Inner engine ring | The 13 maneuverable engines | S5 | High |
| Outer engine ring | The remaining 20 engines | S5 | High |
| Booster oxygen tank | Lower tank, sub-cooled liquid oxygen, 3,650 tonnes in all | S4, S8, S13 | High |
| Booster methane tank | Upper tank, sub-cooled liquid methane | S8, S13 | High |
| Grid fins | Guide the descent; three, down from four | S13 | High |
| Hot-stage ring | Vented ring; integrated hot stage exposes the forward dome of the booster's fuel tank | S3, S14 | High |
| Hot-stage vents | Let the upper stage exhaust escape while the stages are joined | S14 | High |
| Upper stage | 52 m, designed to fly again | S4, S13 | Medium for the length, high otherwise |
| Nose section | Holds the two header tanks | S16 | High |
| Oxygen header tank | At the tip of the nose | S16 | High |
| Methane header tank | Directly below the oxygen header | S16 | High |
| Upper-stage oxygen tank | Aft main tank, 1,600 tonnes in all | S4, S13 | High |
| Upper-stage methane tank | Forward main tank | S13 | High |
| Upper-stage engine section | Six engines: three sea level, three vacuum | S13 | High |
| Sea-level engines | Same type as the booster engines | S13 | High |
| Vacuum engines | Much larger nozzle, better efficiency in space | S10, S13 | High |
| Forward flaps, Aft flaps | Two forward and two aft, steer and stabilise on re-entry | S16 | High |
| Heat shield | Hexagonal tiles on the windward side | S16 | High |
| Launch and catch tower | Stacks the vehicle, catches returning stages with two arms | S15, S17 | High |
| Catch arm carriage | Rides the tower and swings its arm | S15 | Medium (the mechanism is drawn as a simple carriage; the swinging arms are sourced) |
| Catch arm | Two arms; first booster catch 13 October 2024, first upper stage catch 14 November 2026 | S15, S17 | High |

### Effects and flows

| Label | Source | Confidence |
| --- | --- | --- |
| Booster exhaust (shock diamonds at a different pressure from the surrounding air) | S11 | High |
| Upper-stage ignition, Hot-staging exhaust | S14 | High |

### Tour

| Step | Title | Sources | Confidence |
| --- | --- | --- | --- |
| 1 | Two stages, both reusable | S4, S13 | Medium (dimensions through the search index, cross-checked) |
| 2 | 33 engines on the booster | S4, S5, S13 | High |
| 3 | Propellant | S4, S13 | High |
| 4 | Liftoff | S11 | High |
| 5 | Hot staging | S3, S14 | High |
| 6 | Six engines on the upper stage | S4, S13 | High for the counts and propellant, medium for 1,614 tonnes-force |
| 7 | Boostback | S13, S15 | High |
| 8 | The catch | S15 | High |
| 9 | The upper stage comes home | S16, S17, S18 | High |
| 10 | Full reuse | S4, S5, S13 | High |

## Removed during review

| Claim | Why it was removed |
| --- | --- |
| The interstage is single-use and discarded after each flight | No source states this for the current version. S3 describes an integrated hot stage, which contradicts it. Removed from the hot-stage ring description. |
| Numbers in the share text and OG card beyond the counts above | The share text carries only counts that appear in the tables above. Nothing else was added. |

## Naming and marks

- Titles are generic: "Full-flow staged-combustion methalox rocket engine" and "Fully reusable two-stage super-heavy launch system".
- Real names appear only as nominative references in body text, for example "the Raptor engine, which uses this cycle". The words "the maker" stand in for the manufacturer.
- The models are drawn as untextured wireframe shapes with no logos, markings, liveries or trade dress.
- [tests/anatomy-featured.test.js](../../tests/anatomy-featured.test.js) fails if a featured spec or share text contains a manufacturer name or a vehicle trade name, or if a title names the engine.

## Post draft for X

This draft is for the owner to post. Nothing has been posted. Post it only after the deploy and after the Grok key from order 927 is live, because the third line depends on Grok narration being active. Until then, drop that line.

> How does a full-flow staged-combustion rocket engine work? Two preburners, two turbopumps, and every drop of propellant goes through a turbine before it burns.
>
> We built an interactive cutaway: rotate it, cut it open, explode it, and take the 10 step tour.
>
> Press Listen and Grok narrates each step, using only that step's sourced facts.
>
> Engine: https://three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249
> Launch stack, from liftoff through hot staging to the tower catch: https://three.ws/anatomy/d72da3e9-8aae-47cd-a96c-45ccd33bf1a0
>
> Every figure is sourced: https://three.ws/docs/anatomy/rocket-engines-sources

Checks the draft passes:

- It contains no coin, token, price, trading or wallet language.
- It uses no em-dash or en-dash characters.
- It names no manufacturer or vehicle, and it uses no logos.
- Every number in it (two, ten) is a count shown in the cutaways.
