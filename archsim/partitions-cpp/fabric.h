#pragma once

#include "framework-cpp/axi3.h"
#include "framework-cpp/simulation.h"

namespace axi3 = framework::axi3;

namespace partitions::fabric {
   using AxiHpIfType = std::tuple< //
         axi3::ArChannelSink,      //
         axi3::RChannelSource,     //
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
         axi3::AwChannelSource,     //
         axi3::WChannelSource       //
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
             fabric::AxiHpIfType&& axi_hp_if,
             fabric::TdsuIfType&& tdsu_if,
             fabric::UpqIfType&& upq_if,
             fabric::TcmMasterIfType&& tcm_master_if,
             fabric::TcmSlaveIfType&& tcm_slave_if,
             fabric::DpqArbIfType&& dpq_arb_if,
             std::pair<uint32_t, uint32_t> tcm_range)
            : framework::Entity{config},
              m_axi_hp_if{std::move(axi_hp_if)},
              m_tdsu_if{std::move(tdsu_if)},
              m_upq_if{std::move(upq_if)},
              m_tcm_master_if{std::move(tcm_master_if)},
              m_tcm_slave_if{std::move(tcm_slave_if)},
              m_dpq_arb_if{std::move(dpq_arb_if)},
              m_tcm_range(tcm_range) {}

      auto axi_hp_if() { return fabric::to_ref_tuple(m_axi_hp_if); }
      auto tdsu_if() { return fabric::to_ref_tuple(m_tdsu_if); }
      auto upq_if() { return fabric::to_ref_tuple(m_upq_if); }
      auto tcm_master_if() { return fabric::to_ref_tuple(m_tcm_master_if); }
      auto tcm_slave_if() { return fabric::to_ref_tuple(m_tcm_slave_if); }
      auto dpq_arb_if() { return fabric::to_ref_tuple(m_dpq_arb_if); }

   protected:
      void on_evaluate() override;
      void on_tick() override;

   private:
      void decide_split0(const std::bitset<32>&, bool&, bool&) const;
      void decide_split3(const axi3::RChannelData&, bool&, bool&) const;
      void decide_split4(const axi3::RChannelData&, bool&, bool&) const;

      template <axi3::ChannelData T>
      std::optional<axi3::ChannelSource<T>> arbitrate(
            axi3::ChannelSource<T> if1, std::optional<axi3::ChannelSource<T>> if2) const {
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
