/**
 * This file contains the unit tests for simulation.cc/h
 * - clock edges and naming
 * - entity registration
 * - driver loop
 * - entitiy callback firing
 * - simulation throwing/error
 */

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <tuple>
#include <vector>

#include "framework-cpp/exceptions.h"
#include "framework-cpp/simulation.h"

using namespace framework;

namespace {

   using framework::Simulation;

   /// @brief One recorded framework callback: which hook fired, and on what tick.
   struct Event {
      enum class Kind { Evaluate, Tick, AfterTick, Reset };

      Kind kind;
      unsigned tick;

      bool operator==(Event const&) const = default;
   };

   using Events = std::vector<Event>;

   /// @brief Shared log used to observe callback ordering *across* entities.
   using OrderLog = std::vector<std::string>;

   std::string_view kind_name(Event::Kind kind) {
      switch (kind) {
         case Event::Kind::Evaluate:
            return "evaluate";
         case Event::Kind::Tick:
            return "tick";
         case Event::Kind::AfterTick:
            return "after_tick";
         case Event::Kind::Reset:
            return "reset";
      }
      return "unknown";
   }

   /// @brief Entity that records every callback the simulation delivers to it.
   class TestEntity : public Entity {
   public:
      explicit TestEntity(EntityConfig config, std::string tag = {}, OrderLog* log = nullptr)
            : Entity{config}, m_tag{std::move(tag)}, m_log{log} {}

      Events const& events() const { return m_events; }

      /// @brief The ticks on which on_tick() fired, i.e. this entity's rising edges.
      std::vector<unsigned> tick_edges() const {
         std::vector<unsigned> edges;
         for (auto const& event : m_events) {
            if (event.kind == Event::Kind::Tick) {
               edges.push_back(event.tick);
            }
         }
         return edges;
      }

      std::ptrdiff_t count(Event::Kind kind) const {
         return std::ranges::count(m_events, kind, &Event::kind);
      }

      void on_evaluate() override { record(Event::Kind::Evaluate); }
      void on_tick() override { record(Event::Kind::Tick); }
      void on_after_tick() override { record(Event::Kind::AfterTick); }
      void on_reset() override { record(Event::Kind::Reset); }

   private:
      void record(Event::Kind kind) {
         m_events.push_back(Event{kind, config().simulation.current_tick()});
         if (m_log != nullptr) {
            m_log->push_back(m_tag + ":" + std::string{kind_name(kind)});
         }
      }

      std::string m_tag;
      OrderLog* m_log;
      Events m_events{};
   };

   /// @brief Entity that throws out of on_evaluate() on a chosen tick.
   class ThrowingEntity : public Entity {
   public:
      enum class What { Simulation, Runtime };

      ThrowingEntity(EntityConfig config, unsigned throw_on_tick, What what)
            : Entity{config}, m_throw_on_tick{throw_on_tick}, m_what{what} {}

      /// @brief Stops the entity throwing, so an aborted run can be resumed.
      void disarm() { m_throw_on_tick = 0; } // tick 0 never occurs

      void on_evaluate() override {
         if (config().simulation.current_tick() != m_throw_on_tick) {
            return;
         }
         if (m_what == What::Simulation) {
            throw SimulationException("entity failed");
         }
         throw std::runtime_error("entity failed");
      }

   private:
      unsigned m_throw_on_tick;
      What m_what;
   };

   /// @brief An entity id paired with a non-owning pointer to the entity itself.
   struct Registered {
      entity_id_t id;
      TestEntity* entity;
   };

   /**
    * Registers a `TestEntity` and returns the id and the corresponding entity.
    * Lifetime is tied to `sim`.
    */
   Registered add_test_entity(Simulation& sim,
                              std::string_view name,
                              Clock clock,
                              std::optional<entity_id_t> parent = std::nullopt,
                              OrderLog* log = nullptr) {
      auto [id, entity] = sim.add_entity<TestEntity>(name, clock, parent, std::string{name}, log);
      return Registered{id, &entity};
   }

   /**
    * A detector plus the simulation and entity that own it. `MultiDriverDetector`
    * needs an `Entity&`, and an entity only exists once registered.
    */
   struct DetectorFixture {
      Simulation sim{};
      Entity& owner;
      MultiDriverDetector detector;

      DetectorFixture()
            : owner{*add_test_entity(sim, "owner", Clock{1, 0}).entity}, detector{owner} {}
   };

} // namespace

TEST_CASE("simulation: Clocks fire on the ticks where tick % period == phase") {
   struct Row {
      unsigned period;
      unsigned phase;
      std::vector<unsigned> expected_edges; // within ticks 0..8
   };

   // Tick 0 is included: a phase-zero clock reads as a rising edge there
   auto const rows = std::vector<Row>{
         {1, 0, {0, 1, 2, 3, 4, 5, 6, 7, 8}},
         {2, 0, {0, 2, 4, 6, 8}},
         {2, 1, {1, 3, 5, 7}},
         {3, 2, {2, 5, 8}},
         {4, 3, {3, 7}},
   };

   for (auto const& row : rows) {
      CAPTURE(row.period, row.phase);

      Clock clk{row.period, row.phase};

      std::vector<unsigned> edges;
      for (unsigned tick = 0; tick <= 8; ++tick) {
         if (clk.rising_edge(tick)) {
            edges.push_back(tick);
         }
      }

      REQUIRE(edges == row.expected_edges);
   }
}

TEST_CASE("simulation: Clocks are identified by their period and phase") {
   Clock clk{2, 1};
   Clock same{2, 1};
   Clock other_phase{2, 0};
   Clock other_period{3, 1};

   REQUIRE(clk == same);
   REQUIRE(Clock::hash{}(clk) == Clock::hash{}(same));

   REQUIRE_FALSE(clk == other_phase);
   REQUIRE_FALSE(clk == other_period);
}

TEST_CASE("simulation: Clock names are looked up by the clock's period and phase") {
   Simulation sim;
   Clock fast{1, 0};
   Clock slow{3, 0};
   sim.set_clock_name("fast", fast);
   sim.set_clock_name("slow", slow);

   REQUIRE(sim.get_clock_name(fast) == "fast");
   REQUIRE(sim.get_clock_name(slow) == "slow");

   SECTION("so a separately constructed but equal clock shares the name") {
      Clock also_slow{3, 0};
      REQUIRE(sim.get_clock_name(also_slow) == "slow");
   }

   SECTION("and naming a clock again replaces its previous name") {
      sim.set_clock_name("slow_renamed", slow);
      REQUIRE(sim.get_clock_name(slow) == "slow_renamed");
      REQUIRE(sim.get_clock_name(fast) == "fast");
   }

   SECTION("but a clock that was never named has no name to look up") {
      Clock unnamed{3, 1};
      REQUIRE_THROWS_AS(sim.get_clock_name(unnamed), std::out_of_range);
   }
}

TEST_CASE("simulation: An entity is evaluated, ticked, then after-ticked on every cycle") {
   Simulation sim;
   Clock clk{1, 0};
   auto* entity = add_test_entity(sim, "dut", clk).entity;

   sim.run(3);

   // The cycle count is incremented before any callback runs, so the first
   // cycle of a simulation is tick 1 rather than tick 0.
   REQUIRE(entity->events() == Events{
                                     {Event::Kind::Evaluate, 1},
                                     {Event::Kind::Tick, 1},
                                     {Event::Kind::AfterTick, 1},
                                     {Event::Kind::Evaluate, 2},
                                     {Event::Kind::Tick, 2},
                                     {Event::Kind::AfterTick, 2},
                                     {Event::Kind::Evaluate, 3},
                                     {Event::Kind::Tick, 3},
                                     {Event::Kind::AfterTick, 3},
                               });
}

TEST_CASE("simulation: Only on_tick is gated on the clock edge") {
   Simulation sim;

   SECTION("on a period-3 phase-0 clock") {
      Clock clk{3, 0};
      auto* entity = add_test_entity(sim, "dut", clk).entity;

      sim.run(6);

      REQUIRE(entity->tick_edges() == std::vector<unsigned>{3, 6});
      REQUIRE(entity->count(Event::Kind::Evaluate) == 6);
      REQUIRE(entity->count(Event::Kind::AfterTick) == 6);
   }

   SECTION("on a period-3 phase-1 clock") {
      Clock clk{3, 1};
      auto* entity = add_test_entity(sim, "dut", clk).entity;

      sim.run(6);

      REQUIRE(entity->tick_edges() == std::vector<unsigned>{1, 4});
      REQUIRE(entity->count(Event::Kind::Evaluate) == 6);
      REQUIRE(entity->count(Event::Kind::AfterTick) == 6);
   }
}

TEST_CASE("simulation: Entities on different clocks tick independently") {
   Simulation sim;
   Clock fast_clk{1, 0};
   Clock slow_clk{3, 0};

   auto* fast = add_test_entity(sim, "fast_dut", fast_clk).entity;
   auto* slow = add_test_entity(sim, "slow_dut", slow_clk).entity;

   sim.run(6);

   REQUIRE(fast->tick_edges() == std::vector<unsigned>{1, 2, 3, 4, 5, 6});
   REQUIRE(slow->tick_edges() == std::vector<unsigned>{3, 6});

   // Evaluation is not gated on the clock, so both entities see every cycle
   REQUIRE(fast->count(Event::Kind::Evaluate) == 6);
   REQUIRE(slow->count(Event::Kind::Evaluate) == 6);
}

TEST_CASE("simulation: Entity::config reports the registration the simulation assigned") {
   Simulation sim;
   Clock clk{2, 1};
   auto registered = add_test_entity(sim, "dut", clk);
   sim.build();
   auto const& config = registered.entity->config();

   REQUIRE(&config.simulation == &sim);
   REQUIRE(config.id == registered.id);
   REQUIRE(config.clock == clk);
   // The local name, not the qualified path: `get_entity_full_name()` joins the chain
   REQUIRE(config.name == "dut");
}

TEST_CASE("simulation: Entity names are qualified by their position in the hierarchy") {
   Simulation sim;
   Clock clk{1, 0};

   auto a = add_test_entity(sim, "a", clk).id;
   auto b = add_test_entity(sim, "b", clk, a).id;
   auto c = add_test_entity(sim, "c", clk, b).id;

   REQUIRE(sim.get_entity_full_name(a) == "a");
   REQUIRE(sim.get_entity_full_name(b) == "a.b");
   REQUIRE(sim.get_entity_full_name(c) == "a.b.c");

   SECTION("and the parent chain is walkable from any entity") {
      REQUIRE_FALSE(sim.get_entity_parent(a).has_value());

      REQUIRE(sim.get_entity_parent(b).has_value());
      REQUIRE(sim.get_entity_parent(b).value() == a);

      REQUIRE(sim.get_entity_parent(c).has_value());
      REQUIRE(sim.get_entity_parent(c).value() == b);
   }

   SECTION("so entities under different parents may share a local name") {
      auto x = add_test_entity(sim, "x", clk).id;
      auto y = add_test_entity(sim, "y", clk).id;

      auto x_leaf = add_test_entity(sim, "leaf", clk, x).id;
      auto y_leaf = add_test_entity(sim, "leaf", clk, y).id;

      REQUIRE(sim.get_entity_full_name(x_leaf) == "x.leaf");
      REQUIRE(sim.get_entity_full_name(y_leaf) == "y.leaf");
   }
}

TEST_CASE("simulation: A duplicate entity path is rejected") {
   Simulation sim;
   Clock clk{1, 0};

   auto root = add_test_entity(sim, "root", clk).id;
   add_test_entity(sim, "child", clk, root);
   sim.add_entity<TestEntity>("child", clk, root);

   // add_entity<T> constructs the entity before it validates the path, so the
   // rejected entity is destroyed here and never reaches the caller.
   REQUIRE_THROWS_AS(sim.build(), SimulationException);
}

TEST_CASE("simulation: reset() rewinds the simulation but keeps entities registered") {
   Simulation sim;
   Clock clk{2, 0};

   OrderLog reset_order;
   auto first = add_test_entity(sim, "first", clk, std::nullopt, &reset_order);
   auto second = add_test_entity(sim, "second", clk, first.id, &reset_order);

   sim.run(3);
   REQUIRE(sim.current_tick() == 3);
   REQUIRE(first.entity->tick_edges() == std::vector<unsigned>{2});

   reset_order.clear();
   sim.reset();

   REQUIRE(sim.current_tick() == 0);
   REQUIRE(first.entity->count(Event::Kind::Reset) == 1);
   REQUIRE(second.entity->count(Event::Kind::Reset) == 1);

   SECTION("resetting entities in registration order") {
      REQUIRE(reset_order == OrderLog{"first:reset", "second:reset"});
   }

   SECTION("with the tick count already zeroed by the time the hook runs") {
      REQUIRE(first.entity->events().back() == Event{Event::Kind::Reset, 0});
   }

   SECTION("leaving registration intact so the run can be repeated") {
      REQUIRE(sim.get_entity_full_name(second.id) == "first.second");
      REQUIRE(sim.get_entity_parent(second.id).value() == first.id);

      sim.run(3);

      REQUIRE(sim.current_tick() == 3);
      // The second run reproduces the first run's edge pattern
      REQUIRE(first.entity->tick_edges() == std::vector<unsigned>{2, 2});
   }
}

TEST_CASE("simulation: run() swallows a SimulationException and stops early") {
   Simulation sim;
   Clock clk{1, 0};

   // Registered ahead of the observer, so the throw pre-empts the observer's evaluate
   auto [thrower_id, thrower] = sim.add_entity<ThrowingEntity>(
         "thrower", clk, std::nullopt, 2u, ThrowingEntity::What::Simulation);
   auto* observer = add_test_entity(sim, "observer", clk).entity;

   // The cycle count is bumped before the callbacks, so the failed cycle counts
   REQUIRE_NOTHROW(sim.run(5));
   REQUIRE(sim.current_tick() == 2);

   // The throw came out of on_evaluate, before any entity was ticked that cycle
   REQUIRE(observer->tick_edges() == std::vector<unsigned>{1});
   REQUIRE(observer->count(Event::Kind::Evaluate) == 1);

   SECTION("and the run simply resumes, with the caller none the wiser") {
      thrower.disarm();
      sim.run(3);

      REQUIRE(sim.current_tick() == 5);
   }
}

TEST_CASE("simulation: run(throw_on_exception=true)") {
   Simulation sim;
   Clock clk{1, 0};

   auto [thrower_id, thrower] = sim.add_entity<ThrowingEntity>(
         "thrower", clk, std::nullopt, 2u, ThrowingEntity::What::Simulation);
   auto* observer = add_test_entity(sim, "observer", clk).entity;

   REQUIRE_THROWS_AS(sim.run(5, true), SimulationException);

   // It stops in the same place run() would, it just does not hide the reason
   REQUIRE(sim.current_tick() == 2);
   REQUIRE(observer->tick_edges() == std::vector<unsigned>{1});

   SECTION("and the run can still be resumed once the fault is cleared") {
      thrower.disarm();

      REQUIRE_NOTHROW(sim.run(3, true));
      REQUIRE(sim.current_tick() == 5);
   }
}

TEST_CASE("simulation: run() propagates exceptions that are not SimulationExceptions") {
   Simulation sim;
   Clock clk{1, 0};
   sim.add_entity<ThrowingEntity>("thrower", clk, std::nullopt, 2u, ThrowingEntity::What::Runtime);
   REQUIRE_THROWS_AS(sim.run(5), std::runtime_error);
   REQUIRE(sim.current_tick() == 2);
}

TEST_CASE("simulation: MultiDriverDetector allows a single driver per cycle") {
   DetectorFixture fixture;
   auto& detector = fixture.detector;

   REQUIRE_NOTHROW(detector.add_and_check_driver("sig"));
   REQUIRE_THROWS_AS(detector.add_and_check_driver("sig"), MultiDriverException);

   SECTION("and re-arms once reset") {
      detector.reset();

      REQUIRE_NOTHROW(detector.add_and_check_driver("sig"));
      REQUIRE_THROWS_AS(detector.add_and_check_driver("sig"), MultiDriverException);
   }
}

TEST_CASE("simulation: MultiDriverException names the signal that was double-driven") {
   DetectorFixture fixture;
   auto& detector = fixture.detector;

   detector.add_and_check_driver("reg_assign");
   try {
      detector.add_and_check_driver("reg_assign");
      FAIL("expected a MultiDriverException");
   } catch (MultiDriverException const& e) {
      REQUIRE(std::get<0>(e.get_fields()).value == "reg_assign");
   }
}

TEST_CASE("simulation: MultiDriverDetector reports every extra driver in a cycle") {
   DetectorFixture fixture;
   auto& detector = fixture.detector;

   REQUIRE_NOTHROW(detector.add_and_check_driver("sig"));
   for (int driver = 2; driver <= 5; ++driver) {
      REQUIRE_THROWS_AS(detector.add_and_check_driver("sig"), MultiDriverException);
   }

   SECTION("and goes quiet again once reset") {
      detector.reset();

      REQUIRE_NOTHROW(detector.add_and_check_driver("sig"));
   }
}

TEST_CASE("simulation: MultiDriverException keeps blaming the first driver of the cycle") {
   DetectorFixture fixture;
   auto& detector = fixture.detector;

   auto previous_trace_of_next_throw = [&detector]() -> std::string {
      try {
         detector.add_and_check_driver("sig");
      } catch (MultiDriverException const& e) {
         return std::get<1>(e.get_fields()).value;
      }
      FAIL("expected a MultiDriverException");
      return {};
   };

   detector.add_and_check_driver("sig");

   // The stash is not consumed by throwing, so the second and third drivers are
   // both reported against the same first driver.
   auto second = previous_trace_of_next_throw();
   auto third = previous_trace_of_next_throw();

   REQUIRE_FALSE(second.empty());
   REQUIRE(second == third);
}
