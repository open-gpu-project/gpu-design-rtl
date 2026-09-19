#pragma once

#include <cassert>
#include <cpptrace/cpptrace.hpp>
#include <deque>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace framework {

   class Simulation;
   class Entity;
   class TracerBase;
   class TraceSink;

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
      void reset() { m_cycle = 0; }

   private:
      const std::string m_name{};
      const int m_period{1};
      const int m_phase{0};
      int m_cycle{0};
   };

   /**
    * Opaque handle to a clock registered with the simulation. Only the
    * simulation that issued it can resolve it back to a `Clock`.
    */
   struct clock_id_t {
      bool operator==(clock_id_t const&) const = default;

   private:
      friend class Simulation;
      explicit clock_id_t(unsigned value) : value{value} {}
      unsigned value;
   };

   /**
    * Opaque handle to an entity registered with the simulation. Only the
    * simulation that issued it can resolve it back to an `Entity`.
    */
   struct entity_id_t {
      bool operator==(entity_id_t const&) const = default;

      /// @brief Hash functor, for using an entity id as an unordered container key.
      struct hash {
         std::size_t operator()(entity_id_t id) const { return std::hash<unsigned>{}(id.value); }
      };

   private:
      friend class Simulation;
      explicit entity_id_t(unsigned value) : value{value} {}
      unsigned value;
   };

   /**
    * Configuration for a simulation entity, assigned by `Simulation` when
    * registering the entity.
    */
   struct EntityConfig {
      Simulation& simulation;
      Clock const& clock;
      clock_id_t clock_id;
      entity_id_t id;
      std::string name;
   };

   /**
    * Represents a simulation entity that reacts to clock ticks and can be evaluated.
    * Entities are expected to be driven by the `Simulation` class.
    */
   class Entity {
      friend class Simulation;

   public:
      Entity(EntityConfig config) : m_config(config) {}
      virtual ~Entity() = default;

      /**
       * Read-only access to the entity's configuration.
       */
      EntityConfig const& config() const { return m_config; }

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

      /**
       * Called when the simulation is reset. Any state should be restored to its
       * initial value. The simulation's tick count and clocks are already reset
       * by the time this is called.
       */
      virtual void on_reset() {}

   private:
      EntityConfig m_config;
   };

   /**
    * Represents the top-level simulation that manages and drives all entities
    * based on their clocks. Contains the main simulation loop driver.
    */
   class Simulation {
   public:
      explicit Simulation(TraceSink* sink = nullptr) : m_sink(sink) {}

      Clock& get_clock(clock_id_t id) { return m_clocks.at(id.value); }
      Clock const& get_clock(clock_id_t id) const { return m_clocks.at(id.value); }

      /**
       * Creates a new clock with the specified name, period, and phase, and
       * returns its clock ID. The clock's rising edge falls on every tick where
       * `tick % period == phase`.
       */
      clock_id_t add_clock(std::string_view name, int period = 1, int phase = 0);

      /**
       * Adds a new synchronous hardware entity to the simulation whose tick is
       * driven by the specified clock.
       */
      template <typename T, typename... Args>
         requires std::is_base_of_v<Entity, T>
      std::pair<entity_id_t, T&> add_entity(std::string_view name,
                                            clock_id_t clock,
                                            std::optional<entity_id_t> parent,
                                            Args&&... args) {
         auto entity_id = entity_id_t{static_cast<unsigned>(m_entities.size())};
         m_entities.push_back(nullptr);
         auto& entity = add_entity_impl(entity_id,
                                        name,
                                        std::move(std::make_unique<T>(
                                              EntityConfig{
                                                    .simulation = *this,
                                                    .clock = m_clocks.at(clock.value),
                                                    .clock_id = clock,
                                                    .id = entity_id,
                                                    // name is computed in the next step
                                              },
                                              std::forward<Args>(args)...)),
                                        parent);
         return {entity_id, static_cast<T&>(entity)};
      }

      /// @brief Builds the simulation, preparing it for execution.
      void build();

      /// @brief Registers a tracer with the simulation.
      void register_tracer(TracerBase& tracer);

      /// @brief Run the simulation for the specified number of cycles.
      void run(int cycles);

      /// @brief Reset the simulation to its initial state.
      void reset();

      /// @brief Stops the simulation.
      void stop();

      /// @brief Gets the current simulation tick count
      auto current_tick() const { return m_cycle_count; }

      /// @brief Gets the fully qualified name of the entity
      std::string get_entity_full_name(entity_id_t id) const;

      /// @brief Gets the parent entity of the specified entity, if it exists.
      std::optional<entity_id_t> get_entity_parent(entity_id_t id) const;

   private:
      void run_one_tick();

   private:
      Entity& add_entity_impl(entity_id_t entity_id,
                              std::string_view name,
                              std::unique_ptr<Entity> entity,
                              std::optional<entity_id_t> parent);

      // A deque, not a vector: `EntityConfig` holds a `Clock const&` into this
      // container, so adding a clock must not invalidate existing references.
      std::deque<Clock> m_clocks{};
      std::vector<std::unique_ptr<Entity>> m_entities{};
      std::unordered_map<entity_id_t, std::string, entity_id_t::hash> m_entity_names{};
      std::unordered_map<entity_id_t, entity_id_t, entity_id_t::hash> m_entity_tree{};
      std::unordered_map<std::string, entity_id_t> m_name_to_entity{};
      std::vector<TracerBase*> m_tracers{};
      unsigned m_cycle_count{0};
      bool built = false;
      TraceSink* m_sink = nullptr;
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
       * Throwing does not disarm the detector: it stays armed until `reset()`,
       * so every extra driver in the cycle is reported, and the first driver of
       * the cycle is always the one reported as `previous`.
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
      std::optional<cpptrace::stacktrace> m_caller{};
      Entity& m_owner;
   };

} // namespace framework
