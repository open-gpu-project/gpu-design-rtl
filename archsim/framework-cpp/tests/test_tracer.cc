/**
 * This file contains the unit tests for tracer.cc/h
 */

#include <catch2/catch_test_macros.hpp>
#include <utility>
#include <vector>

#include "framework-cpp/exceptions.h"
#include "framework-cpp/tracer.h"

namespace {

   using Changes = std::vector<std::pair<unsigned, int>>;

   /// @brief Minimal recorder that satisfies RecordableTrait<int> for testing
   class TestRecorder : public framework::RecorderBase {
   public:
      void print() const override {}

      void record_value_change(unsigned tick, int const& value) {
         m_recorded.emplace_back(tick, value);
      }

      Changes const& recorded() const { return m_recorded; }

   private:
      Changes m_recorded;
   };

   static_assert(framework::RecordableTrait<TestRecorder, int>,
                 "TestRecorder must satisfy the RecordableTrait for int");

} // namespace

TEST_CASE("tracer: Tracer records and dumps value changes") {
   framework::Tracer<int> tracer{"sig"};
   tracer.on_value_change(0, 1);
   tracer.on_value_change(3, 2);
   tracer.on_value_change(3, 5); // same tick is allowed

   TestRecorder recorder;
   tracer.dump(recorder);

   REQUIRE(recorder.recorded() == Changes{{0, 1}, {3, 2}, {3, 5}});

   SECTION("equals() ignores the tracer name") {
      framework::Tracer<int> same_changes{"other_name"};
      same_changes.on_value_change(0, 1);
      same_changes.on_value_change(3, 2);
      same_changes.on_value_change(3, 5);

      REQUIRE(tracer.equals(same_changes));
   }

   SECTION("equals() is false when the changes differ") {
      framework::Tracer<int> different{"sig"};
      different.on_value_change(0, 1);

      REQUIRE_FALSE(tracer.equals(different));
   }
}

TEST_CASE("tracer: Tracer rejects decreasing ticks") {
   framework::Tracer<int> tracer{"sig"};
   tracer.on_value_change(7, 1);

   REQUIRE_THROWS_AS(tracer.on_value_change(6, 2), framework::SimulationException);
}
