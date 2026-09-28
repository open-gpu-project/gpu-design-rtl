#include <queue>

#include "framework-cpp/axi3.h"
#include "framework-cpp/simulation.h"

namespace partitions::xu {} // namespace partitions::xu

namespace partitions {

   /**
    * Unlike a normal AXI3 buffer, this is a read-only buffer (for now). That
    * way we don't need to track write operations.
    *
    * Motivation: Outside of the deferred vertex buffer, we don't have a need to
    * model read-after-writes (rare in GPUs).
    */
   class Axi3HpBuffer : public framework::Entity {
      using EntityConfig = framework::EntityConfig;
      using AxiInterfaceHolder = framework::axi3::AxiInterfaceHolder;
      using ArAndTag = std::pair<framework::axi3::ArChannelData, framework::tag_t>;
      using RAndTag = std::pair<framework::axi3::RChannelData, framework::tag_t>;

   public:
      Axi3HpBuffer(EntityConfig config);

   protected:
      void on_evaluate() override;
      void on_tick() override;
      void evaluate_ar(ArAndTag const& ar);
      uint32_t read_data(uint32_t addr) const;

   private:
      AxiInterfaceHolder& m_axi_interface;
      std::queue<RAndTag> m_r_channel_queue;
   };

} // namespace partitions
