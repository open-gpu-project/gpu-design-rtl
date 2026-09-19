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

      void on_evaluate() override {
         for (size_t i = regs.size() - 1; i > 0; --i) {
            regs[i]->assign(regs[i - 1]->value());
         }
      }

      /// @brief Assign to register 0
      void assign(std::string const& value) {
         if (!regs.empty()) {
            regs[0]->assign(value);
         }
      }
      
      /// @brief Dump entire state + print simulation cycle
      void dump() const {
         std::cout << "Cycle: " << config().simulation.current_tick() << " [ ";
         for (size_t i = 0; i < regs.size(); ++i) {
            std::cout << "\"" << regs[i]->value() << "\"" << (i < regs.size() - 1 ? ", " : "");
         }
         std::cout << " ]" << std::endl;
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
   std::string canary = "A";
   dut.assign(canary);
   sim.run(1);

   SECTION("assign on each cycle") {
      for (int i = 0; i < 4; ++i) {
         dut.dump();

         // Step the simulation by one clock cycle and check the state
         for (size_t j = 0; j < dut.regs.size(); ++j) {
            REQUIRE(dut.regs[j]->value() == (i == j ? canary : ""));
         }

         // Assign empty value so the initial register is cleared
         dut.assign("");
         sim.run(1);
      }
   }

   SECTION("do not assign on each cycle") {
      for (int i = 0; i < 4; ++i) {
         dut.dump();

         // Step the simulation by one clock cycle and check the state
         for (size_t j = 0; j < dut.regs.size(); ++j) {
            REQUIRE(dut.regs[j]->value() == (j <= i ? canary : ""));
         }

         // Not assignment, so the initial register stays latched
         sim.run(1);
      }
   }
}

TEST_CASE("reg: Tracing works") {
   Simulation sim{};
   auto clk = sim.add_clock("clk");
   auto [dut_id, dut] = sim.add_entity<SrlDut>("srl", clk, std::nullopt, 4);

   std::string canary = "A";
   dut.assign(canary);
   sim.run(1);

}
