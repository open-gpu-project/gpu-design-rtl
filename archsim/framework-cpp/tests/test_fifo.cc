/**
 * This file contains the unit tests for fifo.cc/h
 */

#include <catch2/catch_test_macros.hpp>

#include "framework-cpp/exceptions.h"
#include "framework-cpp/fifo.h"

using namespace framework;

TEST_CASE("fifo: Basic functionality") {
   Simulation sim{};
   constexpr int N = 4;
   Clock clk{1, 0};
   auto [dut_id, dut] = sim.add_entity<Fifo<int, N>>("fifo", clk, std::nullopt);

   // Write to the FIFO x4
   REQUIRE(!dut.can_read());
   for (unsigned i = 0; i < N; i++) {
      REQUIRE(dut.can_write());
      dut.assign_write(42, i);
      sim.run(1);
      REQUIRE(dut.can_read());
   }
   REQUIRE(!dut.can_write());

   // Read from the FIFO
   for (unsigned i = 0; i < N; i++) {
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

TEST_CASE("fifo: peek() reads the head without popping it") {
   Simulation sim{};
   Clock clk{1, 0};
   auto& dut = sim.add_entity<Fifo<int, 2>>("fifo", clk, std::nullopt).second;

   REQUIRE_FALSE(dut.peek_data().has_value());

   dut.assign_write(7);
   sim.run(1);

   // Peeking is non-destructive, so it stays readable however often we look
   REQUIRE(dut.peek_data().value() == 7);
   REQUIRE(dut.peek_data().value() == 7);
   REQUIRE(dut.can_read());

   dut.read();
   sim.run(1);

   REQUIRE_FALSE(dut.peek_data().has_value());
}

TEST_CASE("fifo: overrunning the fifo throws") {
   Simulation sim{};
   Clock clk{1, 0};
   auto& dut = sim.add_entity<Fifo<int, 2>>("fifo", clk, std::nullopt).second;

   SECTION("reading while empty") {
      REQUIRE_FALSE(dut.can_read());
      REQUIRE_THROWS_AS(dut.read(), SimulationException);
   }

   SECTION("writing while full") {
      for (int i = 0; i < 2; ++i) {
         dut.assign_write(i);
         sim.run(1);
      }

      REQUIRE_FALSE(dut.can_write());
      REQUIRE_THROWS_AS(dut.assign_write(99), SimulationException);

      // The rejected write left the existing contents alone
      REQUIRE(dut.peek_data().value() == 0);
   }
}
