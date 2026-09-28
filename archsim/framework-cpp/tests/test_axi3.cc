/**
 * This file contains the unit tests for axi3.cc/h
 */

#include <catch2/catch_test_macros.hpp>

#include "framework-cpp/axi3.h"
#include "framework-cpp/simulation.h"

using namespace framework;
using namespace framework::axi3;

namespace {

   /// Stimulus builders, filled in so a beat looks like a plausible single-beat burst.
   ArChannelData ar(uint8_t id, uint32_t addr) { return {id, addr, 0, 0b010, BurstType::Incr}; }
   RChannelData rd(uint8_t id, uint32_t data) { return {id, data, 0b1111, 1}; }

   /// Stand-ins for the interface aliases a partition declares, e.g.
   /// `partitions::fabric::AxiHpIfType`.
   using SlaveIfSubset = std::tuple<ArChannelSink, RChannelSource, AwChannelSink, WChannelSink>;
   using MasterIfSubset = std::tuple<ArChannelSource, RChannelSink>;

} // namespace

// Either side on its own is a subset of itself, in any order
static_assert(MasterSubset<ArChannelSource, RChannelSink>);
static_assert(SlaveSubset<ArChannelSink, RChannelSource>);
static_assert(MasterSubset<ArChannelSource, AwChannelSource, WChannelSource, RChannelSink>);

// ...but never a subset of the other side
static_assert(!MasterSubset<ArChannelSink>);
static_assert(!SlaveSubset<ArChannelSource>);

// A request naming one side, in whatever order, picks that side
static_assert(InterfaceSubset<WChannelSource, ArChannelSource>);
static_assert(InterfaceSubset<ArChannelSink, AwChannelSink, WChannelSink, RChannelSource>);
static_assert(InterfaceSubset<RChannelSink>);

static_assert(!InterfaceSubset<ArChannelSource, ArChannelSink>);   // mixes the two sides
static_assert(!InterfaceSubset<>);                                 // empty pack
static_assert(!InterfaceSubset<ArChannelSource, ArChannelSource>); // not a subset: repeat
static_assert(!InterfaceSubset<int>);                              // not a channel view

// The tuple-typed forms accept exactly the packs their variadic counterparts do
static_assert(MasterSubsetTuple<std::tuple<ArChannelSource, RChannelSink>>);
static_assert(SlaveSubsetTuple<std::tuple<ArChannelSink, RChannelSource>>);
static_assert(InterfaceSubsetTuple<SlaveIfSubset>);
static_assert(InterfaceSubsetTuple<MasterIfSubset>);

static_assert(!InterfaceSubsetTuple<std::tuple<ArChannelSource, ArChannelSink>>); // mixed
static_assert(!InterfaceSubsetTuple<std::tuple<>>);                               // empty
static_assert(!InterfaceSubsetTuple<std::tuple<int>>);                            // not a view

// A bare view is not a tuple, and a tuple is not a view: the two `get()`
// overloads are never both viable for the same request.
static_assert(!InterfaceSubsetTuple<ArChannelSink>);
static_assert(!InterfaceSubset<SlaveIfSubset>);

TEST_CASE("axi3: get() returns the requested views in the requested order") {
   Simulation sim{};
   auto clk = sim.add_clock("clk");
   auto& dut = sim.add_entity<AxiInterfaceHolder>("axi", clk, std::nullopt).second;

   // Deliberately not the declaration order of either interface tuple, so the
   // bindings below only line up if the result follows the requested order.
   auto [r_source, ar_sink] = dut.get<RChannelSource, ArChannelSink>();
   auto [ar_source, r_sink] = dut.get<ArChannelSource, RChannelSink>();

   // AR flows slave-sink -> master-source, R flows master-sink -> slave-source:
   // the two calls hand back views onto the very same pair of channel FIFOs.
   ar_sink.write(ar(0x2a, 0xdead));
   r_sink.write(rd(0x2a, 0xbeef));
   sim.run(1);

   REQUIRE(ar_source.valid());
   REQUIRE(ar_source.peek_data().value().araddr == std::bitset<32>{0xdead});
   REQUIRE(r_source.valid());
   REQUIRE(r_source.peek_data().value().rdata == std::bitset<32>{0xbeef});
}

TEST_CASE("axi3: get() accepts a named tuple alias in place of its elements") {
   Simulation sim{};
   auto clk = sim.add_clock("clk");
   auto& dut = sim.add_entity<AxiInterfaceHolder>("axi", clk, std::nullopt).second;

   // Requesting the alias must give back exactly the alias type, not some
   // reordered tuple that merely happens to hold the same elements.
   auto slave_if = dut.get<SlaveIfSubset>();
   auto master_if = dut.get<MasterIfSubset>();
   static_assert(std::is_same_v<decltype(slave_if), SlaveIfSubset>);
   static_assert(std::is_same_v<decltype(master_if), MasterIfSubset>);

   // ...and it must be wired to the same channels the variadic form hands out.
   std::get<ArChannelSink>(slave_if).write(ar(0x07, 0xfeed));
   sim.run(1);

   REQUIRE(std::get<ArChannelSource>(master_if).valid());
   REQUIRE(std::get<ArChannelSource>(master_if).peek_data().value().araddr == std::bitset<32>{0xfeed});

   auto [ar_source] = dut.get<ArChannelSource>();
   REQUIRE(ar_source.peek_data().value().araddr == std::bitset<32>{0xfeed});
}

TEST_CASE("axi3: get() views stay bound to one channel across calls") {
   Simulation sim{};
   auto clk = sim.add_clock("clk");
   auto& dut = sim.add_entity<AxiInterfaceHolder>("axi", clk, std::nullopt).second;

   // Independently requested views are copies of the same cheap handle, so a
   // write through one is visible to a source fetched by a later, separate call.
   auto [ar_sink] = dut.get<ArChannelSink>();
   ar_sink.write(ar(0x11, 0xcafe));
   sim.run(1);

   auto [ar_source] = dut.get<ArChannelSource>();
   REQUIRE(ar_source.valid());

   auto [data, tag] = ar_source.read();
   REQUIRE(data.araddr == std::bitset<32>{0xcafe});
   REQUIRE(data.arid == std::bitset<6>{0x11});
   sim.run(1);

   REQUIRE_FALSE(std::get<0>(dut.get<ArChannelSource>()).valid());
}
