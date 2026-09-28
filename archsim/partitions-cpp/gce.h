#include "framework-cpp/simulation.h"

namespace partitions {

   class GCE : public framework::Entity {
   public:
      explicit GCE(framework::EntityConfig config) : framework::Entity{config} {}
   };

} // namespace partitions