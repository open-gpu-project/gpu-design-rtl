/**
 * This file contains the unit tests for fifo.cc/h
 */

#include <catch2/catch_test_macros.hpp>
#include <iostream>

#include "framework-cpp/fifo.h"

using namespace framework;

TEST_CASE("fifo: Basic functionality") {
   Simulation sim{};
   constexpr int N = 4;
   auto clk = sim.add_clock("clk");
   auto [dut_id, dut] = sim.add_entity<Fifo<int, N>>("fifo", clk, std::nullopt);

   // Write to the FIFO x4
   REQUIRE(!dut.can_read());
   for(unsigned i = 0; i < N; i++) {
      REQUIRE(dut.can_write());
      dut.assign_write(42, i);
      sim.run(1);
      REQUIRE(dut.can_read());
   }
   REQUIRE(!dut.can_write());

   // Read from the FIFO
   for(unsigned i = 0; i < N; i++) {
      REQUIRE(dut.can_read());
      auto [value, tag] = dut.read();
      REQUIRE(value == 42);
      REQUIRE(tag == i);
      sim.run(1);
   }

   // FIFO should now be empty
   REQUIRE(!dut.can_read());
   REQUIRE(dut.can_write());
}
