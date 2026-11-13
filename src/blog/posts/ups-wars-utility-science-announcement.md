## Overview
The community has voted that the next competition will be for Utility Science and for the first time we are allowing any quality science.

Deadline to submit is May 31st at 23:00 UTC.

## Rules

### Requirements
1. must produce at least 240 science per second of equivalent normal quality (or a multiple of that)
2. has to be able to accept raw ingredients only (calcite import accepted) and handle the entire production chain to produce the final science output
3. raw ingredients can be any of iron ore, copper ore, crude oil, water, coal, stone, uranium, calcite, molten iron, molten copper. All other recipes you must make yourself within your design.
4. Must be able to produce the science on Nauvis

### Stability Tests

Must be able to pass abucnasty's acceptance criteria which is as follows.
1. cold start until science belt is fully saturated
2. Run until belts are backed up then release into infinity loaders
3. Remove one input and add it back
4. Cut off all inputs and add it back
5. must be stable for 216000 ticks (60 minutes). Stable is defined as the production graph over 10 minutes shows `240*60*10` science produced. If you design makes 480/s then it would be `480*60*10`.

These issues happen commonly in real bases so it’s worth testing these things. They are signs of stable clocks if a design can pass all these tests. It also ensures that when a 36k+ tick benchmark is run, they will continue to produce science throughout the test without any hiccups. This will be verified by abucnasty and if the design does not pass the stability test it will be instantly eliminated.

### Save File

The following save file should be used as your template: [utility_science_template.zip](https://github.com/abucnasty/factorio-benchmarks/blob/master/competitions/2025-Q1-Nauvis/utility-science/maps/utility_science_template.zip)

Note that the save file upload size is limited to 10MB (unless we boost the server to get to level 2 and have 50MB uploads). 10MB should be more than enough for the template save file if you remember to wipe your blueprints before saving. The template save file for example is less than 2MB.

The save file must produce an equivalent of 2880/s normal quality science. For normal quality science, this is 12 stacked turbo belts of science. Example for quality science:
> The design produces 120/s legendary science. It will need to be copied in the save file 4 times to reach 480/s which is the equivalent of 2880/s normal quality (6 times multiplier)

## Submission

Use the following [submission form](https://tally.so/r/zx2Qo0) to enter the competition. Good luck!