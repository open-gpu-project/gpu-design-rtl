#include "framework-cpp/reg.h"
#include "framework-cpp/simulation.h"

namespace partitions::xu {} // namespace partitions::xu

namespace partitions {

   class XU : public framework::Entity {
      using EntityConfig = framework::EntityConfig;

   public:
      XU(EntityConfig config, framework::Reg<uint64_t> const& pcin)
            : framework::Entity{config},
              m_bram36e1(1024),
              m_pcin(pcin),
              m_pcout(config.add_child<framework::Reg<uint64_t>>("PCOUT", 0).second) {}

      XU(EntityConfig config, XU const& prev_xu)
            : framework::Entity{config},
              m_bram36e1(1024),
              m_pcin(prev_xu.m_pcout),
              m_pcout(config.add_child<framework::Reg<uint64_t>>("PCOUT", 0).second) {}

   protected:
      void on_evaluate() override;
      void on_tick() override;

   private:
      std::vector<uint64_t> m_bram36e1;
      framework::Reg<uint64_t> const& m_pcin;
      framework::Reg<uint64_t>& m_pcout;
   };

} // namespace partitions
