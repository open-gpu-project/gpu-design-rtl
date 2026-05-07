This folder contains shared HDL library components for use in both simulation and synthesis. For example,
- Shared HDL code for verification
- Shared headers and data structures
- Partition-specific data structures that needs to be included by other partitions

This folder should not include any design partition implementations. All public targets under this directory must start with `svlib_`.
