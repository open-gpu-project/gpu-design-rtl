#include <queue>

#include "framework-cpp/axi3.h"
#include "framework-cpp/concepts.h"
#include "framework-cpp/simulation.h"

namespace partitions::tdsu {
   class EventManagerHelper;

   DECLARE_ID_TYPE(thread_id_t, EventManagerHelper, unsigned);
   DECLARE_ID_TYPE(event_id_t, EventManagerHelper, unsigned);

   class ThreadScheduler : public framework::Entity {
   public:
      ThreadScheduler(framework::EntityConfig config, unsigned max_threads);
      thread_id_t initialize();
      void resume(thread_id_t);
      void suspend(thread_id_t);
      void free(thread_id_t);

   private:
      std::vector<std::optional<uint64_t>> m_thread_pcs;
      std::queue<thread_id_t> m_free_threads;
   };

} // namespace partitions::tdsu

namespace partitions {

   class TDSU : public framework::Entity {
      using EntityConfig = framework::EntityConfig;
      using AxiInterfaceHolder = framework::axi3::AxiInterfaceHolder;

   public:
      TDSU(EntityConfig config, unsigned max_threads)
            : framework::Entity{config},
              m_ifetch_if{config.add_child<AxiInterfaceHolder>("ifetch_if")},
              m_monitor_if{config.add_child<AxiInterfaceHolder>("monitor_if")},
              m_dpq_packet_if{config.add_child<AxiInterfaceHolder>("dpq_packet_if")},
              m_thread_scheduler{
                    config.add_child<tdsu::ThreadScheduler>("thread_scheduler", max_threads)} {}

      AxiInterfaceHolder& ifetch_if() { return m_ifetch_if.second; }
      AxiInterfaceHolder& monitor_if() { return m_monitor_if.second; }
      AxiInterfaceHolder& dpq_packet_if() { return m_dpq_packet_if.second; }

   protected:
      void on_evaluate() override;
      void on_tick() override;

   private:
      framework::EntityRef<AxiInterfaceHolder> m_ifetch_if;
      framework::EntityRef<AxiInterfaceHolder> m_monitor_if;
      framework::EntityRef<AxiInterfaceHolder> m_dpq_packet_if;
      framework::EntityRef<tdsu::ThreadScheduler> m_thread_scheduler;
   };

} // namespace partitions