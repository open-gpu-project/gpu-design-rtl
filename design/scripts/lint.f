# Compiler flags
-lint-only
-sv
--no-timing

# Warnings
-Wall
-Wno-DECLFILENAME
-Wno-STMTDLY
-Wno-GENUNNAMED
# Suppress duplicate module warnings because linting re-includes the same file
# twice, as the filelist includes it once already.
-Wno-MODDUP

# Waivers
waiver.vlt

# Add module search paths
-y ../libraries/unisim/
-y ../partitions/xu/rtl/
