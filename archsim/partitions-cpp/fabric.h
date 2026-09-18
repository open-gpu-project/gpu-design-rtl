#pragma once

#include "framework-cpp/axi3.h"
#include "framework-cpp/simulation.h"

namespace axi3 = framework::axi3;

namespace partitions::fabric {
   using AxiHpIfType = std::tuple< //
         axi3::ArChannelSink,      //
         axi3::RChannelSink,       //
         axi3::AwChannelSink,      //
         axi3::WChannelSink        //
         >;
   using TdsuIfType = std::tuple< //
         axi3::ArChannelSource,   //
         axi3::RChannelSink       //
         >;
   using UpqIfType = std::tuple<axi3::RChannelSink>;
   using TcmMasterIfType = std::tuple<axi3::RChannelSink>;
   using TcmSlaveIfType = std::tuple< //
         axi3::ArChannelSink,         //
         axi3::RChannelSource,        //
         axi3::AwChannelSink,         //
         axi3::WChannelSink           //
         >;
   using DpqArbIfType = std::tuple< //
         axi3::ArChannelSource,     //
         axi3::RChannelSink,        //
         axi3::AwChannelSource      //
         >;

   /**
    * Converts a `std::tuple` instance into a tuple of references to its elements.
    */
   template <typename... Ts>
   auto to_ref_tuple(std::tuple<Ts...>& t) {
      return std::tuple<Ts&...>(std::get<Ts>(t)...);
   }
} // namespace partitions::fabric

namespace partitions {
   class Fabric : public framework::Entity {
   public:
      Fabric(fabric::AxiHpIfType&& axi_hp_if,
             fabric::TdsuIfType&& tdsu_if,
             fabric::UpqIfType&& upq_if,
             fabric::TcmMasterIfType&& tcm_master_if,
             fabric::TcmSlaveIfType&& tcm_slave_if,
             fabric::DpqArbIfType&& dpq_arb_if)
            : m_axi_hp_if{std::move(axi_hp_if)},
              m_tdsu_if{std::move(tdsu_if)},
              m_upq_if{std::move(upq_if)},
              m_tcm_master_if{std::move(tcm_master_if)},
              m_tcm_slave_if{std::move(tcm_slave_if)},
              m_dpq_arb_if{std::move(dpq_arb_if)} {}

      auto axi_hp_if() { return fabric::to_ref_tuple(m_axi_hp_if); }
      auto tdsu_if() { return fabric::to_ref_tuple(m_tdsu_if); }
      auto upq_if() { return fabric::to_ref_tuple(m_upq_if); }
      auto tcm_master_if() { return fabric::to_ref_tuple(m_tcm_master_if); }
      auto tcm_slave_if() { return fabric::to_ref_tuple(m_tcm_slave_if); }
      auto dpq_arb_if() { return fabric::to_ref_tuple(m_dpq_arb_if); }

   protected:
      void on_evaluate(framework::Simulation const&) override;
      void on_tick(framework::Simulation const&) override;

   private:
      fabric::AxiHpIfType m_axi_hp_if;
      fabric::TdsuIfType m_tdsu_if;
      fabric::UpqIfType m_upq_if;
      fabric::TcmMasterIfType m_tcm_master_if;
      fabric::TcmSlaveIfType m_tcm_slave_if;
      fabric::DpqArbIfType m_dpq_arb_if;
   };
} // namespace partitions
