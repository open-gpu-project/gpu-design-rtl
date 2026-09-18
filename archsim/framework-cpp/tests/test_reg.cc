/**
 * This file contains the unit tests for reg.cc/h
 */

#include <catch2/catch_test_macros.hpp>
#include <iostream>

#include "framework-cpp/reg.h"

namespace {
   using namespace framework;

   /// @brief Shift register chain DUT
   struct SrlDut : Entity {
      SrlDut(EntityConfig config, unsigned size) : Entity{config}, regs{} {
         for (unsigned i = 0; i < size; ++i) {
            auto [id, reg] = config.simulation.add_entity<Reg<std::string>>(
                  "reg[" + std::to_string(i) + "]", config.clock_id, config.id, "");
            regs.emplace_back(&reg);
         }
      }
      void on_evaluate(Simulation const&) override {
         for (size_t i = regs.size() - 1; i > 0; --i) {
            regs[i]->assign(regs[i - 1]->value());
         }
      }
      void assign(std::string const& value) {
         if (!regs.empty()) {
            regs[0]->assign(value);
         }
      }
      std::vector<Reg<std::string>*> regs;
   };
} // namespace

TEST_CASE("reg: Use in a shift chain") {
   // Create a shift register chain with 4 stages
   Simulation sim{};
   auto clk = sim.add_clock("clk");
   auto [dut_id, dut] = sim.add_entity<SrlDut>("srl", clk, std::nullopt, 4);
   // Assign an initial value to the first stage of the shift register
   dut.assign("initial_value");
   sim.run(1);
   for (int i = 0; i < 4; ++i) {
      // Step the simulation by one clock cycle and check the state
      for (size_t j = 0; j < dut.regs.size(); ++j) {
         std::cout << "Stage " << j << ": " << dut.regs[j]->value() << std::endl;
         REQUIRE(dut.regs[j]->value() == (i == j ? "initial_value" : ""));
      }
      dut.assign("");
      sim.run(1);
   }
}
