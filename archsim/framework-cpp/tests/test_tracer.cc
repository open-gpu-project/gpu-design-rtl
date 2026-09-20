/**
 * This file contains the unit tests for tracer.cc/h
 */

#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "framework-cpp/exceptions.h"
#include "framework-cpp/reg.h"
#include "framework-cpp/tracer.h"
#include "trace_records.h"

namespace {

   using namespace framework;
   using trace_test::parse_records;
   using trace_test::value_records;

   /// @brief Sink that keeps everything in memory so a test can inspect it.
   class MockTraceSink : public TraceSink {
   public:
      // Made public so a test can assert on the registration tables.
      using TraceSink::schemas;
      using TraceSink::signals;

      void commit_header() override {
         ++header_commits;
         // Snapshotted here rather than read afterwards: the point is that the
         // table is already complete by the time the header is written.
         header_signals = signals();
         header_schema_count = schemas().size();
      }

      void commit_body_data(std::string_view data) override { body += data; }

      void commit_file_end() override { ++file_end_commits; }

      int header_commits = 0;
      int file_end_commits = 0;
      std::size_t header_schema_count = 0;
      std::vector<std::pair<std::string, uint32_t>> header_signals{};
      std::string body{};
   };

   /// @brief Entity that owns a tracer and drives it on demand.
   struct Probe : Entity {
      Probe(EntityConfig config, std::string local_name)
            : Entity{config}, tracer{config, local_name} {}

      Tracer<int> tracer;
   };

   /// @brief The names in a sink's signal table, in signal-id order.
   std::vector<std::string> signal_names(MockTraceSink const& sink) {
      std::vector<std::string> names{};
      for (auto const& [name, schema_id] : sink.signals()) {
         names.push_back(name);
      }
      return names;
   }

} // namespace

TEST_CASE("tracer: A tracer registers with its sink when the simulation is built") {
   MockTraceSink sink{};
   Simulation sim{&sink};
   auto clk = sim.add_clock("clk");
   auto [dut_id, dut] = sim.add_entity<Probe>("dut", clk, std::nullopt, "value");

   SECTION("registering nothing before the simulation is built") {
      REQUIRE(sink.signals().empty());
      REQUIRE(sink.schemas().empty());
      REQUIRE(sink.header_commits == 0);
   }

   SECTION("registering one schema and one signal for the tracer") {
      sim.build();
      REQUIRE(sink.schemas().size() == 1);
      REQUIRE(sink.signals().size() == 1);
   }

   SECTION("qualifying the signal name with the owning entity's path") {
      sim.add_entity<Probe>("other", clk, dut_id, "");
      sim.build();
      REQUIRE(signal_names(sink) == std::vector<std::string>{"dut.value", "dut.other"});
   }

   SECTION("sharing one schema between two tracers of the same type") {
      sim.add_entity<Probe>("second", clk, std::nullopt, "value");
      sim.build();
      REQUIRE(sink.schemas().size() == 1);
      REQUIRE(sink.signals().size() == 2);
      REQUIRE(sink.signals()[0].second == sink.signals()[1].second);
   }

   SECTION("committing the header once, after every tracer has registered") {
      sim.add_entity<Probe>("second", clk, std::nullopt, "value");
      sim.build();
      REQUIRE(sink.header_commits == 1);
      REQUIRE(sink.header_schema_count == 1);
      REQUIRE(sink.header_signals.size() == 2);
   }

   SECTION("committing the header only once across repeated builds") {
      sim.build();
      sim.build();
      REQUIRE(sink.header_commits == 1);
   }
}

TEST_CASE("tracer: A tracer writes value changes to its sink") {
   MockTraceSink sink{};
   Simulation sim{&sink};
   auto clk = sim.add_clock("clk");
   auto [first_id, first] = sim.add_entity<Probe>("first", clk, std::nullopt, "");
   auto [second_id, second] = sim.add_entity<Probe>("second", clk, std::nullopt, "");
   sim.build();

   SECTION("stamping each record with the id of the signal that changed") {
      first.tracer.on_value_change(11);
      second.tracer.on_value_change(22);

      auto records = value_records(sink.body);
      REQUIRE(records.size() == 2);
      REQUIRE(records[0].signal_id == 0);
      REQUIRE(records[1].signal_id == 1);
   }

   SECTION("carrying a payload that decodes back to the value written") {
      first.tracer.on_value_change(1234);

      auto records = value_records(sink.body);
      REQUIRE(records.size() == 1);
      REQUIRE(TracerCodec<int>::decode(records[0].payload) == 1234);
   }

   SECTION("interleaving value records with the simulation's tick records") {
      sim.run(1);
      first.tracer.on_value_change(7);

      auto records = parse_records(sink.body);
      REQUIRE(records.size() == 2);
      REQUIRE(records[0].is_tick);
      REQUIRE(records[0].tick == 1);
      REQUIRE_FALSE(records[1].is_tick);
   }
}

TEST_CASE("tracer: A tracer keeps its sink across a simulation reset") {
   MockTraceSink sink{};
   Simulation sim{&sink};
   auto clk = sim.add_clock("clk");
   auto [dut_id, dut] = sim.add_entity<Probe>("dut", clk, std::nullopt, "");
   sim.build();

   dut.tracer.on_value_change(1);
   sim.reset();
   sink.body.clear();

   SECTION("still reaching the sink afterwards") {
      dut.tracer.on_value_change(2);
      REQUIRE(value_records(sink.body).size() == 1);
   }

   SECTION("keeping the registration it was built with") {
      REQUIRE(sink.signals().size() == 1);
      REQUIRE(sink.header_commits == 1);
   }
}

TEST_CASE("tracer: A tracer without a sink is inert") {
   Simulation sim{};
   auto clk = sim.add_clock("clk");
   auto [dut_id, dut] = sim.add_entity<Probe>("dut", clk, std::nullopt, "");
   sim.build();

   SECTION("recording value changes without throwing") {
      REQUIRE_NOTHROW(dut.tracer.on_value_change(3));
   }
}

TEST_CASE("tracer: Registering a tracer after the build is rejected") {
   MockTraceSink sink{};
   Simulation sim{&sink};
   auto clk = sim.add_clock("clk");
   sim.build();

   SECTION("throwing a simulation exception") {
      REQUIRE_THROWS_AS(sim.add_entity<Probe>("late", clk, std::nullopt, ""), SimulationException);
   }
}

TEST_CASE("tracer: The sink is finalized when the simulation stops") {
   MockTraceSink sink{};
   Simulation sim{&sink};
   sim.build();

   SECTION("committing the file end exactly once") {
      sim.stop();
      REQUIRE(sink.file_end_commits == 1);
   }
}
