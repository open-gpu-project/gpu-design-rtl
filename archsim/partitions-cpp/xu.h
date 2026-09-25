#include "framework-cpp/simulation.h"

namespace partitions::xu {} // namespace partitions::xu

namespace partitions {

   class XU : public framework::Entity {
      using EntityConfig = framework::EntityConfig;

   public:
      XU(EntityConfig config) : framework::Entity{config}, m_bram36e1(1024) {}

   protected:
      void on_evaluate() override;
      void on_tick() override;

   private:
      std::vector<uint64_t> m_bram36e1;
   };

} // namespace partitions
