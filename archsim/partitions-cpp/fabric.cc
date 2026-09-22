#include "fabric.h"

#include <tuple>

#include "framework-cpp/axi3.h"

using namespace partitions;
using namespace framework::axi3;
using std::get;
using std::optional;

void Fabric::on_evaluate() {
   // First step is to evaluate all the routing and arbitration decisions
   optional<ArChannelData> arb0 = std::nullopt;

   // SPLIT[0] between TCM_Slave.AR and ARB[0] from DPQ_ARB.AR
   bool split0_granted_arb0 = false;
   bool split0_granted_tcm_slave = false;
   auto dpq_arb_r_data = get<ArChannelSource>(m_dpq_arb_if).peek();
   if (get<ArChannelSource>(m_dpq_arb_if).valid() && dpq_arb_r_data.has_value()) {
      decide_split0(*dpq_arb_r_data, split0_granted_tcm_slave, split0_granted_arb0);
   }

   // SPLIT[1] between TCM_Slave.AW and AXI_HP.AW from DPQ_ARB.AW
   bool split1_granted_tcm_slave = false;
   bool split1_granted_axi_hp_arb = false;
   auto dpq_arb_aw_data = get<AwChannelSource>(m_dpq_arb_if).peek();
   if (get<AwChannelSource>(m_dpq_arb_if).valid() && dpq_arb_aw_data.has_value()) {
      decide_split1(*dpq_arb_aw_data, split1_granted_tcm_slave, split1_granted_axi_hp_arb);
   }

   // SPLIT[2] between TCM_Slave.W and AXI_HP.W from DPQ_ARB.W
   bool split2_granted_tcm_slave = false;
   bool split2_granted_axi_hp_arb = false;
   auto dpq_arb_w_data = get<WChannelSource>(m_dpq_arb_if).peek();
   if (get<WChannelSource>(m_dpq_arb_if).valid() && dpq_arb_w_data.has_value()) {
      decide_split2(*dpq_arb_w_data, split2_granted_tcm_slave, split2_granted_axi_hp_arb);
   }

   // SPLIT[3] between SPLIT[4] and ARB[1] from AXI_HP.R
   bool split3_granted_split4 = false;
   bool split3_granted_arb1 = false;
   auto axi_hp_r_data = get<RChannelSource>(m_axi_hp_if).peek();
   if (get<RChannelSource>(m_axi_hp_if).valid() && axi_hp_r_data.has_value()) {
      decide_split3(*axi_hp_r_data, split3_granted_split4, split3_granted_arb1);
   }

   // SPLIT[4] between TCM_Master.R and TDSU.R from SPLIT[3]
   bool split4_granted_tcm_master = false;
   bool split4_granted_tdsu = false;
   auto split3_r_data = axi_hp_r_data;
   if (get<RChannelSource>(m_axi_hp_if).valid() && split3_r_data.has_value()) {
      decide_split4(*split3_r_data, split4_granted_tcm_master, split4_granted_tdsu);
   }

   // ARB[0] between DPQ_ARB.AR and TDSU.AR towards AXI_HP.AR
   auto arb0_if = arbitrate(get<ArChannelSource>(m_tdsu_if),
                            split0_granted_arb0
                                  ? optional<ArChannelSource>{get<ArChannelSource>(m_dpq_arb_if)}
                                  : std::nullopt);

   // ARB[1] between AXI_HP.R and TCM_Slave.R towards UPQ.R
   auto arb1_if =
         arbitrate(get<RChannelSource>(m_tcm_slave_if),
                   split3_granted_arb1 ? optional<RChannelSource>{get<RChannelSource>(m_axi_hp_if)}
                                       : std::nullopt);

   // Second step is to wire up all the interfaces
   if (std::get<ArChannelSink>(m_tcm_slave_if).ready() && split0_granted_tcm_slave) {
      std::get<ArChannelSink>(m_tcm_slave_if).write(get<ArChannelSource>(m_dpq_arb_if).read());
   }
   if (std::get<AwChannelSink>(m_tcm_slave_if).ready() && split1_granted_tcm_slave) {
      std::get<AwChannelSink>(m_tcm_slave_if).write(get<AwChannelSource>(m_dpq_arb_if).read());
   }
   if (std::get<WChannelSink>(m_tcm_slave_if).ready() && split2_granted_tcm_slave) {
      std::get<WChannelSink>(m_tcm_slave_if).write(get<WChannelSource>(m_dpq_arb_if).read());
   }
   if (std::get<ArChannelSink>(m_axi_hp_if).ready() && arb0_if.has_value()) {
      std::get<ArChannelSink>(m_axi_hp_if).write(arb0_if->read());
   }
   if (std::get<AwChannelSink>(m_axi_hp_if).ready() && split1_granted_axi_hp_arb) {
      std::get<AwChannelSink>(m_axi_hp_if).write(get<AwChannelSource>(m_dpq_arb_if).read());
   }
   if (std::get<WChannelSink>(m_axi_hp_if).ready() && split2_granted_axi_hp_arb) {
      std::get<WChannelSink>(m_axi_hp_if).write(get<WChannelSource>(m_dpq_arb_if).read());
   }
   if (std::get<RChannelSink>(m_upq_if).ready() && arb1_if.has_value()) {
      std::get<RChannelSink>(m_upq_if).write(arb1_if->read());
   }
   if (std::get<RChannelSink>(m_tcm_master_if).ready() && split3_granted_split4) {
      if (split4_granted_tcm_master) {
         std::get<RChannelSink>(m_tcm_master_if).write(get<RChannelSource>(m_axi_hp_if).read());
      } else if (split4_granted_tdsu) {
         std::get<RChannelSink>(m_tcm_master_if).write(get<RChannelSource>(m_tdsu_if).read());
      }
   }
}

void Fabric::on_tick() {
   // Implement the tick behavior for the Fabric entity here
}

bool Fabric::decide_split0(const ArChannelData& data, bool& tcm_granted, bool& arb0_granted) const {
   // Implement the decision logic for SPLIT[0] here
   return true; // Placeholder implementation
}

bool Fabric::decide_split1(const AwChannelData& data, bool& tcm_granted, bool& hp_granted) const {
   // Implement the decision logic for SPLIT[1] here
   return true; // Placeholder implementation
}

bool Fabric::decide_split2(const WChannelData& data, bool& tcm_granted, bool& hp_granted) const {
   // Implement the decision logic for SPLIT[2] here
   return true; // Placeholder implementation
}

bool Fabric::decide_split3(const RChannelData& data,
                           bool& split4_granted,
                           bool& arb1_granted) const {
   // Implement the decision logic for SPLIT[3] here
   return true; // Placeholder implementation
}

bool Fabric::decide_split4(const RChannelData& data, bool& tcm_granted, bool& tdsu_granted) const {
   // Implement the decision logic for SPLIT[4] here
   return true; // Placeholder implementation
}
