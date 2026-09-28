#pragma once

#include "framework-cpp/simulation.h"

namespace partitions {
   class DSP48E1 : public framework::Entity {
   public:
      explicit DSP48E1(framework::EntityConfig config)
         : framework::Entity(config) {}
   };
} // namespace partitions