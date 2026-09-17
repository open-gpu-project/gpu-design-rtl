#pragma once

#include <cassert>
#include <cpptrace/cpptrace.hpp>
#include <memory>
#include <unordered_map>
#include <vector>

#include "exceptions.h"

namespace framework {

   class Simulation;

   /**
    * Represents a clock signal in the simulation. See also `Simulation::add_clock()`.
    */
   class Clock {
      friend class Simulation;

   public:
      bool rising_edge() const { return m_cycle % m_period == m_phase; }

   private:
      Clock(std::string_view name, int period, int phase)
            : m_name(name), m_period(period), m_phase(phase) {
         assert(period > 0 && "Clock period must be positive");
      }
      void tick() { m_cycle++; }

   private:
      std::string m_name{};
      int m_period{1};
      int m_phase{0};
      int m_cycle{0};
   };

   /**
    * Configuration for a simulation entity, assigned by `Simulation` when
    * registering the entity.
    */
   struct EntityConfig {
      Clock const& clock;
   };

   /**
    * Represents a simulation entity that reacts to clock ticks and can be evaluated.
    * Entities are expected to be driven by the `Simulation` class.
    */
   class Entity {
      friend class Simulation;

   public:
      Entity() = default;
      virtual ~Entity() = default;

      /**
       * Read-only access to the entity's configuration.
       */
      EntityConfig const& config() const {
         if (!m_config.has_value()) {
            throw SimulationException(
                  "Entity configuration is not set. "
                  "Have you registered this entity with the simulation?");
         }
         return m_config.value();
      }

   protected:
      /**
       * Called to evaluate the entity's combinational state graphs before
       * `on_tick()` is called on the clock edge. Ordering of evaluation
       * relative to other entities is not guaranteed.
       */
      virtual void on_evaluate() {}

      /**
       * Called on the rising edge of the clock. This is when any staged updates
       * or assignments should be applied to the entity's state and made available
       * for the next cycle.
       *
       * Ordering of tick updates relative to other entities is not guaranteed.
       */
      virtual void on_tick() {}

      /**
       * Called to reset the tick state after `on_tick()` is called. Any staged
       * updates or assignments should be cleared.
       */
      virtual void on_after_tick() {}

   private:
      std::optional<EntityConfig> m_config;
   };

   /**
    * Represents the top-level simulation that manages and drives all entities
    * based on their clocks. Contains the main simulation loop driver.
    */
   class Simulation {
      struct clock_id_t {
         unsigned value;
      };

   public:
      Clock& get_clock(clock_id_t id) { return m_clocks.at(id.value); }
      Clock const& get_clock(clock_id_t id) const { return m_clocks.at(id.value); }

      /**
       * Creates a new clock with the specified name, period, and phase, and
       * returns its clock ID.
       */
      clock_id_t add_clock(std::string_view name, int period = 1, int phase = 0);

      /**
       * Adds a new synchronous hardware entity to the simulation whose tick is
       * driven by the specified clock.
       */
      Entity& add_entity(std::unique_ptr<Entity>&& entity, clock_id_t clock);

      /**
       * Run the simulation for the specified number of cycles.
       */
      void run(int cycles);

   private:
      void run_one_tick();

      std::unordered_map<unsigned, Clock> m_clocks{};
      std::vector<std::unique_ptr<Entity>> m_entities{};
   };

   /**
    * Detects multiple drivers for a single signal. Throws a `MultiDriverException`
    * if more than one driver is detected.
    */
   class MultiDriverDetector {
   public:
      MultiDriverDetector(Entity& owner) : m_owner{owner} {}

      /**
       * Adds a driver and checks for multiple drivers.
       *
       * @param signal_name The name of the signal being driven.
       * @throws MultiDriverException if more than one driver is detected.
       */
      void add_and_check_driver(std::string_view signal_name);

      /**
       * Resets the driver detection, usually called inside `on_after_tick()`
       */
      void reset() { m_caller.reset(); }

   private:
      std::unique_ptr<cpptrace::stacktrace> m_caller{};
      Entity& m_owner;
   };

} // namespace framework
