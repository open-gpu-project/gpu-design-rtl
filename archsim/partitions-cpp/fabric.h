#pragma once

#include "framework-cpp/axi3.h"
#include "framework-cpp/simulation.h"

namespace partitions::fabric {
   using AxiHpIfType = std::tuple<        //
         framework::axi3::ArChannelSink,  //
         framework::axi3::RChannelSource, //
         framework::axi3::AwChannelSink,  //
         framework::axi3::WChannelSink    //
         >;
   using TdsuIfType = std::tuple<          //
         framework::axi3::ArChannelSource, //
         framework::axi3::RChannelSink     //
         >;
   using UpqIfType = std::tuple<framework::axi3::RChannelSink>;
   using TcmMasterIfType = std::tuple<framework::axi3::RChannelSink>;
   using TcmSlaveIfType = std::tuple<     //
         framework::axi3::ArChannelSink,  //
         framework::axi3::RChannelSource, //
         framework::axi3::AwChannelSink,  //
         framework::axi3::WChannelSink    //
         >;
   using DpqArbIfType = std::tuple<        //
         framework::axi3::ArChannelSource, //
         framework::axi3::AwChannelSource, //
         framework::axi3::WChannelSource   //
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
   enum class RequestCategory { Reserved, USE0_XU, USE1_XU, USE2_XU, TDSU_IFETCH, TCM_FILL };

   static constexpr RequestCategory AridToCategory(std::bitset<6> arid) {
      const uint8_t arid_val = static_cast<uint8_t>(arid.to_ulong());
      const uint8_t arid_pre = arid_val >> 4;
      const uint8_t arid_suf = arid_val & 0xF;
      switch (arid_pre) {
         case 0b00:
            return RequestCategory::USE0_XU;
         case 0b01:
            return RequestCategory::USE1_XU;
         case 0b10:
            return RequestCategory::USE2_XU;
         case 0b11: {
            if (arid_suf == 0b0000) return RequestCategory::TDSU_IFETCH;
            if (arid_suf == 0b0001) return RequestCategory::TCM_FILL;
            return RequestCategory::Reserved;
         }
         default:
            return RequestCategory::Reserved;
      }
   }

   class Fabric : public framework::Entity {
   public:
      Fabric(framework::EntityConfig config,
             framework::axi3::AxiInterfaceHolder& axi_hp_if,
             framework::axi3::AxiInterfaceHolder& tdsu_if,
             framework::axi3::AxiInterfaceHolder& upq_if,
             framework::axi3::AxiInterfaceHolder& tcm_master_if,
             framework::axi3::AxiInterfaceHolder& tcm_slave_if,
             framework::axi3::AxiInterfaceHolder& dpq_arb_if,
             std::pair<uint32_t, uint32_t> tcm_range)
            : framework::Entity{config},
              m_axi_hp_if{axi_hp_if.get<fabric::AxiHpIfType>()},
              m_tdsu_if{tdsu_if.get<fabric::TdsuIfType>()},
              m_upq_if{upq_if.get<fabric::UpqIfType>()},
              m_tcm_master_if{tcm_master_if.get<fabric::TcmMasterIfType>()},
              m_tcm_slave_if{tcm_slave_if.get<fabric::TcmSlaveIfType>()},
              m_dpq_arb_if{dpq_arb_if.get<fabric::DpqArbIfType>()},
              m_tcm_range(tcm_range) {}

   protected:
      void on_evaluate() override;
      void on_tick() override;

   private:
      void decide_split0(const std::bitset<32>&, bool&, bool&) const;
      void decide_split3(const framework::axi3::RChannelData&, bool&, bool&) const;
      void decide_split4(const framework::axi3::RChannelData&, bool&, bool&) const;

      template <framework::axi3::ChannelData T>
      std::optional<framework::axi3::ChannelSource<T>> arbitrate(
            framework::axi3::ChannelSource<T> if1,
            std::optional<framework::axi3::ChannelSource<T>> if2) const {
         if (if1.valid()) return if1;
         return if2;
      }

   private:
      fabric::AxiHpIfType m_axi_hp_if;
      fabric::TdsuIfType m_tdsu_if;
      fabric::UpqIfType m_upq_if;
      fabric::TcmMasterIfType m_tcm_master_if;
      fabric::TcmSlaveIfType m_tcm_slave_if;
      fabric::DpqArbIfType m_dpq_arb_if;
      std::pair<uint32_t, uint32_t> m_tcm_range;
   };
} // namespace partitions
